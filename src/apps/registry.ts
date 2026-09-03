import type { AppManifest } from "./types";

/**
 * The full Southbag app set. Apps without a `mount` open a placeholder.
 *
 * Order is the order they appear in the launcher.
 */
export const APPS: AppManifest[] = [
  { id: "files", name: "Files", size: { width: 760, height: 480 }, min: { width: 420, height: 280 } },
  { id: "banking", name: "Banking", size: { width: 680, height: 520 }, min: { width: 400, height: 320 } },
  { id: "office", name: "Office", size: { width: 820, height: 560 }, min: { width: 440, height: 320 } },
  { id: "chat", name: "Chat", size: { width: 560, height: 600 }, min: { width: 360, height: 320 } },
  { id: "code", name: "Code", size: { width: 880, height: 580 }, min: { width: 480, height: 320 } },
  { id: "terminal", name: "Terminal", size: { width: 640, height: 420 }, min: { width: 360, height: 240 } },
  { id: "branches", name: "Branch locator", size: { width: 720, height: 520 }, min: { width: 400, height: 320 } },
  { id: "lore", name: "Lore", size: { width: 700, height: 540 }, min: { width: 400, height: 320 } },
  { id: "kevin", name: "Kevin", size: { width: 520, height: 560 }, min: { width: 360, height: 320 } },
  { id: "settings", name: "Settings", size: { width: 640, height: 560 }, min: { width: 400, height: 320 } },
];

export function appById(id: string): AppManifest | undefined {
  return APPS.find((app) => app.id === id);
}
