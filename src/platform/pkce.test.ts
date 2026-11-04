import { expect, test, describe } from "bun:test";
import {
  base64url,
  base64urlDecode,
  challengeFor,
  createVerifier,
  decodeJsonSegment,
  randomToken,
} from "./pkce";

describe("pkce", () => {
  test("a verifier is 43 url-safe characters", () => {
    expect(createVerifier()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test("the challenge is the S256 of the verifier", async () => {
    // RFC 4648 test-vector SHA-256("abc"), base64url-encoded.
    expect(await challengeFor("abc")).toBe("ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0");
  });

  test("base64url round-trips", () => {
    const bytes = crypto.getRandomValues(new Uint8Array(64));
    expect(base64urlDecode(base64url(bytes))).toEqual(bytes);
  });

  test("decodeJsonSegment decodes url-safe JSON", () => {
    expect(decodeJsonSegment(base64url(new TextEncoder().encode('{"a":1}')))).toEqual({ a: 1 });
  });

  test("tokens differ", () => {
    expect(randomToken()).not.toBe(randomToken());
  });
});
