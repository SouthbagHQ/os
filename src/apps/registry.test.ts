import { expect, test, describe } from "bun:test";
import { APPS } from "./registry";

describe("app registry", () => {
  test("ids are unique", () => {
    expect(new Set(APPS.map((app) => app.id)).size).toBe(APPS.length);
  });

  test("every url app is a southbag.cc service over https", () => {
    for (const app of APPS) {
      if (!app.url) continue;
      const url = new URL(app.url);
      expect(url.protocol).toBe("https:");
      expect(url.hostname.endsWith(".southbag.cc")).toBe(true);
    }
  });

  test("nothing frames a service: no app carries a mount for its url", () => {
    // Services open top-level through the Browser web app (Desktop on the
    // web, cgi-bin/launch on the device), never inside a frame.
    for (const app of APPS) {
      if (app.url) expect(app.mount).toBeUndefined();
      expect("external" in app).toBe(false);
    }
  });

  test("seven apps are live services", () => {
    expect(
      APPS.filter((app) => app.url).map((app) => app.id).sort(),
    ).toEqual(["banking", "branches", "chat", "code", "files", "lore", "office"]);
  });

  test("the apps that are not built stay explicit placeholders", () => {
    expect(
      APPS.filter((app) => !app.mount && !app.url && app.id !== "browser").map((app) => app.id).sort(),
    ).toEqual(["kevin", "settings", "terminal"]);
  });

  test("the launcher set is the eleven apps", () => {
    expect(APPS.map((app) => app.id)).toEqual([
      "files", "banking", "office", "chat", "code", "terminal",
      "branches", "lore", "kevin", "browser", "settings",
    ]);
  });
});
