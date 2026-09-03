/**
 * The app contract.
 *
 * An app receives a DOM node and a context, and nothing else. It cannot reach
 * the shell, the window host, or another app: everything it is allowed to do
 * arrives through `AppContext`.
 *
 * The boundary is a DOM node rather than a component so that the same manifest
 * works when an app is a `cog` window of its own, or an iframe, and the only
 * change is what `mount` does with the node it is handed.
 */

import type { Customer } from "../platform/identity";

export interface AppWindow {
  setTitle(title: string): void;
  close(): void;
}

export interface AppContext {
  customer: Customer;
  window: AppWindow;
}

export interface AppManifest {
  id: string;
  name: string;
  size: { width: number; height: number };
  min: { width: number; height: number };
  /**
   * Absent for an app that has not been built yet. The shell shows a
   * placeholder; the app itself is unaware there was ever a difference.
   */
  mount?: (root: HTMLElement, context: AppContext) => (() => void) | void;
}
