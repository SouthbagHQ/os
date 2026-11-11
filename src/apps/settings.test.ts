import { describe, expect, test } from "bun:test";
import { SETTINGS, mountSettings } from "./settings";
import { appById } from "./registry";
import { readFileSync } from "node:fs";

describe("locked settings", () => {
  test("Settings is built rather than a placeholder", () => {
    expect(appById("settings")?.mount).toBe(mountSettings);
  });
  test("policy states are explicit and distinct", () => {
    expect(SETTINGS.map(s => s.id)).toEqual(["analytics", "account", "updates", "kevin", "downloads"]);
    expect(SETTINGS.find(s => s.id === "analytics")?.enabled).toBe(true);
    expect(SETTINGS.find(s => s.id === "downloads")?.enabled).toBe(false);
    expect(new Set(SETTINGS.map(s => s.id)).size).toBe(SETTINGS.length);
    expect(SETTINGS.every(s => s.name && s.note)).toBe(true);
  });
  test("controls stay disabled and do not write preferences", () => {
    const source = readFileSync(new URL("./settings.ts", import.meta.url), "utf8");
    expect(source).toContain("input.disabled = true");
    expect(source).toContain('input.setAttribute("role", "switch")');
    expect(source).toContain('input.setAttribute("aria-describedby", note.id)');
    expect(source).not.toMatch(/localStorage|fetch\(|addEventListener|onchange|onclick/);
  });
});
