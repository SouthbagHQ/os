/**
 * Sign-in with Southbag Identity.
 *
 * The shell is a public OIDC client: authorization code + PKCE (S256), no
 * client secret anywhere, because code on a customer device cannot keep one.
 * Identity allows unauthenticated dynamic client registration, so each
 * deployment registers itself once and remembers its client id; registration
 * is a public endpoint, not an administrative act.
 *
 * On the web (https://southbaghq.github.io, already a trusted origin) the
 * token exchange and key fetch go straight to Identity. On the device
 * (http://127.0.0.1:8080, not trusted) they go through a fixed allowlist
 * proxy on the device's own httpd — see image/shell-extra/cgi-bin/identity-auth.
 *
 * `?identity=<origin>` points the whole flow at another Identity (used to
 * test against a local instance); `?identity=reset` clears that override.
 */

import { storeSession, type Customer, type Session } from "./identity";
import {
  base64urlDecode,
  challengeFor,
  createVerifier,
  decodeJsonSegment,
  randomToken,
} from "./pkce";

const DEFAULT_ISSUER = "https://identity.southbag.cc";
const ISSUER_KEY = "southbag.identity.issuer";
const CLIENT_KEY = "southbag.identity.client";
const PENDING_KEY = "southbag.identity.pending";
const PENDING_TTL_MS = 10 * 60 * 1000;

export const SCOPES = "openid profile email";

const onDevice = import.meta.env.MODE === "device";

export function issuer(): string {
  try {
    const override = new URLSearchParams(location.search).get("identity");
    if (override === "reset") {
      localStorage.removeItem(ISSUER_KEY);
    } else if (override) {
      const parsed = new URL(override);
      const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
      if (parsed.protocol !== "https:" && !local) {
        throw new Error("Identity must be https (localhost excepted for testing).");
      }
      localStorage.setItem(ISSUER_KEY, parsed.origin);
      return parsed.origin;
    }
    return localStorage.getItem(ISSUER_KEY) ?? DEFAULT_ISSUER;
  } catch (error) {
    if (error instanceof TypeError) return DEFAULT_ISSUER;
    throw error;
  }
}

export interface Endpoints {
  register: string;
  authorize: string;
  token: string;
  jwks: string;
}

export function endpoints(iss: string): Endpoints {
  const base = `${iss}/api/auth`;
  if (onDevice) {
    // Loopback origin: CORS-blocked, so the device's own httpd forwards a
    // fixed set of Identity calls. The authorize redirect is a top-level
    // navigation and needs no proxy.
    return {
      register: "/cgi-bin/identity-auth?ep=register",
      authorize: `${base}/oauth2/authorize`,
      token: "/cgi-bin/identity-auth?ep=token",
      jwks: "/cgi-bin/identity-auth?ep=jwks",
    };
  }
  return {
    register: `${base}/oauth2/register`,
    authorize: `${base}/oauth2/authorize`,
    token: `${base}/oauth2/token`,
    jwks: `${base}/jwks`,
  };
}

export function redirectUri(): string {
  return location.origin + import.meta.env.BASE_URL;
}

async function ensureClient(ep: Endpoints, iss: string, redirect: string): Promise<string> {
  const key = `${CLIENT_KEY}:${iss}:${redirect}`;
  try {
    const cached = localStorage.getItem(key);
    if (cached) {
      const client = JSON.parse(cached) as { client_id?: string };
      if (client.client_id) return client.client_id;
    }
  } catch {
    /* A bad cache just registers again. */
  }

  const response = await fetch(ep.register, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Southbag OS",
      redirect_uris: [redirect],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: SCOPES,
    }),
  });
  if (!response.ok) {
    throw new Error(`Identity refused to register this device (${response.status}).`);
  }
  const client = (await response.json()) as { client_id?: string };
  if (!client.client_id) throw new Error("Identity answered registration without a client id.");
  try {
    localStorage.setItem(key, JSON.stringify(client));
  } catch {
    /* Registration repeats next sign-in. */
  }
  return client.client_id;
}

interface Pending {
  verifier: string;
  state: string;
  nonce: string;
  clientId: string;
  redirect: string;
  iss: string;
  createdAt: number;
}

export async function beginLogin(): Promise<void> {
  const iss = issuer();
  const ep = endpoints(iss);
  const redirect = redirectUri();
  const clientId = await ensureClient(ep, iss, redirect);

  const pending: Pending = {
    verifier: createVerifier(),
    state: randomToken(16),
    nonce: randomToken(16),
    clientId,
    redirect,
    iss,
    createdAt: Date.now(),
  };
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));

  const url = new URL(ep.authorize);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirect,
    scope: SCOPES,
    state: pending.state,
    nonce: pending.nonce,
    code_challenge: await challengeFor(pending.verifier),
    code_challenge_method: "S256",
  }).toString();
  location.assign(url.toString());
}

export interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  nonce?: string;
  name?: string;
  email?: string;
  picture?: string;
  [key: string]: unknown;
}

async function verifyIdToken(
  idToken: string,
  ep: Endpoints,
  iss: string,
  clientId: string,
): Promise<IdTokenClaims> {
  const parts = idToken.split(".");
  const [head, payload, signature] = parts;
  if (parts.length !== 3 || !head || !payload || !signature) throw new Error("Identity returned a malformed id token.");
  const header = decodeJsonSegment(head) as { alg?: string; kid?: string };
  if (header.alg !== "EdDSA") {
    throw new Error(`Unexpected id token algorithm: ${header.alg ?? "none"}.`);
  }

  const jwksResponse = await fetch(ep.jwks);
  if (!jwksResponse.ok) throw new Error("Identity's signing keys are unreachable.");
  const jwks = (await jwksResponse.json()) as { keys?: { kid?: string; kty?: string }[] };
  const jwk = jwks.keys?.find((key) => key.kid === header.kid && key.kty === "OKP");
  if (!jwk) throw new Error("Identity signed this token with a key it does not publish.");

  const key = await crypto.subtle.importKey("jwk", jwk, "Ed25519", false, ["verify"]);
  const verified = await crypto.subtle.verify(
    "Ed25519",
    key,
    base64urlDecode(signature) as BufferSource,
    new TextEncoder().encode(`${head}.${payload}`),
  );
  if (!verified) throw new Error("The id token's signature did not verify.");

  const claims = decodeJsonSegment(payload) as IdTokenClaims;
  if (claims.iss !== iss) throw new Error("The id token names the wrong issuer.");
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audience.length || !audience.every((item) => typeof item === "string" && item.length > 0)
      || !audience.includes(clientId)) throw new Error("The id token was not minted for this device.");
  if ((audience.length > 1 || claims.azp !== undefined) && claims.azp !== clientId) {
    throw new Error("The id token names the wrong authorized party.");
  }
  if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now()) {
    throw new Error("The id token is already expired.");
  }
  return claims;
}

export function claimsToCustomer(claims: IdTokenClaims): Customer {
  if (typeof claims.sub !== "string" || !claims.sub.trim()) throw new Error("The id token has no subject.");
  const email = typeof claims.email === "string" ? claims.email : "";
  const name =
    (typeof claims.name === "string" && claims.name.trim()) ||
    email.split("@")[0] ||
    "Customer";
  return {
    sub: claims.sub,
    name,
    email,
    ...(typeof claims.picture === "string" && claims.picture ? { picture: claims.picture } : {}),
  };
}

/**
 * Completes a sign-in when the current page load is the Identity callback.
 * Returns the new session, or null when this load is not a callback.
 */
export async function completeLogin(): Promise<Session | null> {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  if (!code) {
    const error = params.get("error");
    if (error) {
      throw new Error(`Identity said no: ${params.get("error_description") ?? error}.`);
    }
    return null;
  }

  const rawPending = sessionStorage.getItem(PENDING_KEY);
  if (!rawPending) {
    throw new Error("Sign-in finished, but this device has no sign-in in progress. Try again.");
  }
  // Consume even malformed transactions once. Never exchange with a partial,
  // future-dated, wrong-origin or invalid-PKCE transaction from storage.
  sessionStorage.removeItem(PENDING_KEY);
  const pending = JSON.parse(rawPending) as Pending;
  const now = Date.now();
  if (!pending || typeof pending !== "object"
      || typeof pending.createdAt !== "number" || !Number.isFinite(pending.createdAt)
      || pending.createdAt > now
      || typeof pending.verifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(pending.verifier)
      || typeof pending.state !== "string" || !pending.state
      || typeof pending.nonce !== "string" || !pending.nonce
      || typeof pending.clientId !== "string" || !pending.clientId
      || typeof pending.iss !== "string" || !pending.iss
      || pending.redirect !== redirectUri()) {
    throw new Error("Invalid sign-in transaction. Try again.");
  }

  if (now - pending.createdAt > PENDING_TTL_MS) {
    throw new Error("Sign-in took too long. Try again.");
  }
  if (params.get("state") !== pending.state) {
    throw new Error("Sign-in state mismatch. Try again.");
  }
  const issParam = params.get("iss");
  if (issParam && issParam !== pending.iss) {
    throw new Error("Sign-in came back from the wrong issuer.");
  }

  const ep = endpoints(pending.iss);
  const tokenResponse = await fetch(ep.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: pending.redirect,
      client_id: pending.clientId,
      code_verifier: pending.verifier,
    }),
  });
  const body = (await tokenResponse.json().catch(() => null)) as {
    access_token?: string;
    id_token?: string;
    expires_in?: number;
    scope?: string;
    error_description?: string;
  } | null;
  if (!tokenResponse.ok) {
    throw new Error(
      `Identity refused the code exchange (${tokenResponse.status})` +
        (body?.error_description ? `: ${body.error_description}` : "."),
    );
  }
  if (!body?.id_token) throw new Error("Identity returned no id token.");

  const claims = await verifyIdToken(body.id_token, ep, pending.iss, pending.clientId);
  if (claims.nonce !== pending.nonce) throw new Error("Sign-in nonce mismatch. Try again.");

  const session: Session = {
    customer: claimsToCustomer(claims),
    accessToken: body.access_token ?? "",
    idToken: body.id_token,
    expiresAt: Date.now() + (typeof body.expires_in === "number" ? body.expires_in : 3600) * 1000,
    scope: body.scope ?? SCOPES,
  };
  await storeSession(session);
  history.replaceState(null, "", pending.redirect);
  return session;
}
