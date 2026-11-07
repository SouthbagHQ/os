/**
 * The customer.
 *
 * A Southbag device has no local user. It has an account, and the account is
 * the device. Everything downstream of this file assumes that: there is no
 * "logged out" state to represent, because there is no moment at which the
 * machine does not know who it belongs to.
 *
 * The customer is the OIDC claim set returned by Southbag Identity
 * (identity.southbag.cc, Better Auth OAuth provider, scopes: openid profile
 * email money accounts transfer_everything). `oidc.ts` runs the sign-in;
 * this file is what a signed-in session is and how long it counts for.
 */

export interface Customer {
  /** OIDC `sub`. Stable account identifier across every Southbag product. */
  sub: string;
  name: string;
  email: string;
  picture?: string;
}

export interface Session {
  customer: Customer;
  accessToken: string;
  idToken: string;
  /** Epoch ms after which this stops counting as a session. */
  expiresAt: number;
  scope: string;
}

const SESSION_KEY = "southbag.session";
const GENERATION_KEY = "southbag.device-generation";

const onDevice = import.meta.env.MODE === "device";

/**
 * Serialize sign-in storage and sign-out cleanup. A DEVICE callback is not
 * complete until the independently verified userinfo identity matches the
 * signed ID-token subject and the current generation has been bound.
 */
let accountUpdate: Promise<void> = Promise.resolve();
let signingOut = false;

async function clearAccount(generation: string): Promise<void> {
  if (!onDevice) return;
  // A late login write must not recreate the note after logout clears it.
  await accountUpdate.catch(() => {});
  const response = await fetch("/cgi-bin/account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clear: true, generation }),
    keepalive: true,
  });
  if (!response.ok) throw new Error("Account cleanup failed. Please try signing out again.");
}

export function currentSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as Session;
    if (!session.customer?.sub || !session.expiresAt || session.expiresAt <= Date.now()) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function storeSession(session: Session): Promise<void> {
  if (signingOut) return Promise.reject(new Error("Device sign-out is in progress. Try signing in afterward."));
  const update = accountUpdate.catch(() => {}).then(async () => {
    const serialized = JSON.stringify(session);
    if (!onDevice) {
      localStorage.setItem(SESSION_KEY, serialized);
      return;
    }
    const current = await fetch("/cgi-bin/device-session?generation", { method: "POST" });
    if (!current.ok) throw new Error("Device session state unavailable. Try signing in again.");
    const { generation } = (await current.json()) as { generation: string };
    if (typeof generation !== "string" || !generation) throw new Error("Device session generation missing.");
    const response = await fetch("/cgi-bin/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // expectedSubject is a consistency fence, never the binding authority.
      // The CGI independently verifies accessToken and writes only userinfo.
      body: JSON.stringify({ accessToken: session.accessToken, generation, expectedSubject: session.customer.sub }),
    });
    if (!response.ok) throw new Error("Account binding failed. Try signing in again.");
    try {
      localStorage.setItem(GENERATION_KEY, generation);
      localStorage.setItem(SESSION_KEY, serialized);
    } catch {
      // No successful callback or readable partial session after storage fails.
      let storageCleared = true;
      try {
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(GENERATION_KEY);
      } catch { storageCleared = false; }
      const cleanup = await fetch("/cgi-bin/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear: true, generation }),
      }).catch(() => null);
      if (!storageCleared || !cleanup?.ok) throw new Error("Session storage failed and account cleanup failed. Device recovery is needed.");
      throw new Error("Session storage failed. Sign-in was not saved; try again.");
    }
  });
  accountUpdate = update;
  void update.catch(() => {});
  return update;
}

/**
 * Local sign-out. Revocation is not attempted: the revocation endpoint wants
 * a client secret, and a public client on a customer device cannot hold one.
 * The token is short-lived and bearer; forgetting it is the honest version of
 * logging out that a secretless client can do.
 */
/**
 * Device session teardown. Every app and this shell run as tracked scopes
 * with private profiles under the device-session root. Reset stops the
 * scopes against a bounded deadline, refuses (blocked) while any writer -
 * tracked or escaped - still references the profiles, and only then wipes
 * them, clears the account binding and rotates the generation. It never
 * calls Identity: signing out stays this device only.
 *
 * A successful reset stops this shell's own scope, so nothing after the
 * response is guaranteed to run: the supervisor restarts the shell with a
 * clean profile (login surface), or the recovery surface when the reset
 * blocked. A reset that fails before teardown answers non-ok and the
 * caller keeps the desktop open for a retry, same as account cleanup.
 */
async function resetDeviceSession(generation: string): Promise<void> {
  const response = await fetch("/cgi-bin/device-session?reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ generation }),
    keepalive: true,
  });
  if (!response.ok) throw new Error("Device session cleanup failed. Please try signing out again.");
}

async function performLogout(): Promise<void> {
  // Do not reload or forget the UI session until the binding is removed.
  // On failure the caller keeps the desktop open so cleanup can be retried.
  if (onDevice) {
    // The login chain stores the era; let it settle before reading it.
    await accountUpdate.catch(() => {});
    const generation = localStorage.getItem(GENERATION_KEY);
    if (!generation) {
      throw new Error("This session's device generation is unknown; sign in again to reset this device safely.");
    }
    // Ordered before the teardown: the binding goes first so a refused
    // reset leaves only the local session for retry, never a bound device
    // with no apps to show for it. Both calls name this session's era;
    // the CGI and the manager re-check it under the same lock, so a page
    // from a dead era can neither clear nor wipe its replacement.
    // A successful reset kills this renderer, so the session removal below
    // is the non-device path and, on device, only runs when teardown
    // already failed and the desktop stays open for a retry.
    await clearAccount(generation);
    await resetDeviceSession(generation);
    localStorage.removeItem(GENERATION_KEY);
  }
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem("southbag.identity.pending");
}

export async function logout(): Promise<void> {
  if (signingOut) throw new Error("Device sign-out is already in progress.");
  signingOut = true;
  try { await performLogout(); }
  finally { signingOut = false; }
}

export function firstName(customer: Customer): string {
  return customer.name.split(" ")[0] ?? customer.name;
}
