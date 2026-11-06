import { expect, test, describe } from "bun:test";
import { claimsToCustomer, endpoints, SCOPES } from "./oidc";

describe("endpoints", () => {
  test("web endpoints live on the issuer", () => {
    const ep = endpoints("https://identity.southbag.cc");
    expect(ep.authorize).toBe("https://identity.southbag.cc/api/auth/oauth2/authorize");
    expect(ep.token).toBe("https://identity.southbag.cc/api/auth/oauth2/token");
    expect(ep.register).toBe("https://identity.southbag.cc/api/auth/oauth2/register");
    expect(ep.jwks).toBe("https://identity.southbag.cc/api/auth/jwks");
  });
});

describe("claimsToCustomer", () => {
  test("maps the documented claim set", () => {
    expect(
      claimsToCustomer({
        iss: "https://identity.southbag.cc",
        sub: "sb_123",
        aud: "client",
        exp: 1,
        name: "Ana Reyes",
        email: "ana.reyes@southbag.cc",
        picture: "https://identity.southbag.cc/p.png",
      }),
    ).toEqual({
      sub: "sb_123",
      name: "Ana Reyes",
      email: "ana.reyes@southbag.cc",
      picture: "https://identity.southbag.cc/p.png",
    });
  });

  test("drops a missing picture instead of inventing one", () => {
    const customer = claimsToCustomer({ iss: "i", sub: "s", aud: "a", exp: 1, name: "A" });
    expect("picture" in customer).toBe(false);
  });

  test("falls back to the email local part for a name", () => {
    expect(claimsToCustomer({ iss: "i", sub: "s", aud: "a", exp: 1, email: "ana@southbag.cc" }).name).toBe("ana");
  });

  test("refuses a token without a subject", () => {
    expect(() => claimsToCustomer({ iss: "i", aud: "a", exp: 1 } as never)).toThrow();
  });
});

describe("scopes", () => {
  test("the shell asks only for what identifies the customer", () => {
    expect(SCOPES.split(" ").sort()).toEqual(["email", "openid", "profile"]);
  });
});
