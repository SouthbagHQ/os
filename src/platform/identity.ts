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

const onDevice = import.meta.env.MODE === "device";

/**
 * Tells the device who is signed in so the session lock can demand that same
 * account's password. The CGI re-verifies the token with Identity and records
 * what the server answers - the page's word is never what gets written.
 * Fire-and-forget: if the note does not land, the lock simply refuses to
 * engage rather than locking for the wrong account.
 */
let accountUpdate: Promise<void> = Promise.resolve();

function recordAccount(accessToken: string): void {
  if (!onDevice) return;
  accountUpdate = accountUpdate.catch(() => {}).then(async () => {
    const response = await fetch("/cgi-bin/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken }),
    });
    if (!response.ok) throw new Error("Account binding failed");
  });
  // Keep rejection handled until logout joins this operation.
  void accountUpdate.catch(() => {});
}

async function clearAccount(): Promise<void> {
  if (!onDevice) return;
  // A late login write must not recreate the note after logout clears it.
  await accountUpdate.catch(() => {});
  const response = await fetch("/cgi-bin/account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clear: true }),
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

export function storeSession(session: Session): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    recordAccount(session.accessToken);
  } catch {
    /* A device with no writable storage cannot stay signed in. */
  }
}

/**
 * Local sign-out. Revocation is not attempted: the revocation endpoint wants
 * a client secret, and a public client on a customer device cannot hold one.
 * The token is short-lived and bearer; forgetting it is the honest version of
 * logging out that a secretless client can do.
 */
export async function logout(): Promise<void> {
  // Do not reload or forget the UI session until the binding is removed.
  // On failure the caller keeps the desktop open so cleanup can be retried.
  await clearAccount();
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem("southbag.identity.pending");
}

export function firstName(customer: Customer): string {
  return customer.name.split(" ")[0] ?? customer.name;
}
