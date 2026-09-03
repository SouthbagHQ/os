/**
 * The customer.
 *
 * A Southbag device has no local user. It has an account, and the account is
 * the device. Everything downstream of this file assumes that: there is no
 * "logged out" state to represent, because there is no moment at which the
 * machine does not know who it belongs to.
 *
 * The shape below is the OIDC claim set returned by Southbag Identity
 * (identity.southbag.cc, Better Auth OAuth provider, scopes: openid profile
 * email money accounts transfer_everything). Swapping the seeded provider for
 * the registered OAuth app is a field mapping, not a rewrite.
 */

export interface Customer {
  /** OIDC `sub`. Stable account identifier across every Southbag product. */
  sub: string;
  name: string;
  email: string;
  picture?: string;
}

export interface IdentityProvider {
  current(): Customer;
}

const STORAGE_KEY = "southbag.customer";

/** Placeholder until the Southbag OAuth app is registered. */
const SEED: Customer = {
  sub: "sb_9f2c41a7e0b3",
  name: "Ana Reyes",
  email: "ana.reyes@southbag.cc",
};

function read(): Customer | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Customer) : null;
  } catch {
    return null;
  }
}

export function seededIdentity(): IdentityProvider {
  let customer = read();
  if (!customer) {
    customer = SEED;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(customer));
    } catch {
      /* A device with no writable storage still has an account. */
    }
  }
  const resolved = customer;
  return { current: () => resolved };
}

export function firstName(customer: Customer): string {
  return customer.name.split(" ")[0] ?? customer.name;
}
