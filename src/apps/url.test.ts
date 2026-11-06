import { expect, test, describe } from "bun:test";
import { normalizeUrl } from "./url";

describe("normalizeUrl", () => {
  test("bare hosts get https", () => {
    expect(normalizeUrl("banking.southbag.cc")).toBe("https://banking.southbag.cc/");
  });

  test("full urls pass through", () => {
    expect(normalizeUrl("https://southbag.cc/x?y=1")).toBe("https://southbag.cc/x?y=1");
  });

  test("http is allowed (loopback device pages)", () => {
    expect(normalizeUrl("http://127.0.0.1:8080/")).toBe("http://127.0.0.1:8080/");
  });

  test("non-url schemes are refused", () => {
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("file:///etc/passwd")).toBeNull();
  });

  test("empty input goes nowhere", () => {
    expect(normalizeUrl("   ")).toBeNull();
  });
});
