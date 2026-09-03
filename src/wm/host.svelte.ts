/**
 * Window lifecycle.
 *
 * `WindowHost` is the seam. Today it is implemented in TypeScript over a
 * single document. Under labwc the compositor owns geometry and input, and the
 * implementation becomes a thin adapter over the foreign-toplevel protocol:
 * `setRect` and `snapTo` stop doing anything, and the window list is populated
 * by the compositor instead. Apps must not be able to tell the difference, so
 * nothing outside this file may touch window state directly.
 */

import {
  clampToArea,
  placeNew,
  rectForZone,
  type Rect,
  type Size,
  type SnapZone,
} from "./geometry";

export interface ManagedWindow {
  id: number;
  appId: string;
  title: string;
  rect: Rect;
  min: Size;
  z: number;
  minimised: boolean;
  zone: SnapZone;
  /** Where an unsnap returns the window to. */
  restore: Rect | null;
}

export interface WindowHost {
  readonly windows: ManagedWindow[];
  readonly focusedId: number | null;
  readonly area: Rect;
  open(appId: string, spec: { title: string; size: Size; min: Size }): number;
  close(id: number): void;
  focus(id: number): void;
  toggleMinimise(id: number): void;
  toggleMaximise(id: number): void;
  snapTo(id: number, zone: SnapZone): void;
  setRect(id: number, rect: Rect): void;
  setTitle(id: number, title: string): void;
}

/** A work area narrower than this is a measurement that has not happened yet. */
const MEASURABLE = 200;

export class DomWindowHost implements WindowHost {
  windows = $state<ManagedWindow[]>([]);
  area = $state<Rect>({ x: 0, y: 0, width: 0, height: 0 });

  #nextId = 1;
  #nextZ = 1;
  #opened = 0;

  readonly focusedId = $derived.by(() => {
    const candidates = this.windows.filter((w) => !w.minimised);
    if (candidates.length === 0) return null;
    return candidates.reduce((top, w) => (w.z > top.z ? w : top)).id;
  });

  /**
   * Called by the shell when the work area changes. Degenerate measurements
   * are ignored rather than propagated: a zero-sized area would move every
   * window to the origin, and the previous value is always a better guess.
   */
  setArea(area: Rect) {
    if (area.width < MEASURABLE || area.height < MEASURABLE) return;
    const previous = this.area;
    this.area = area;
    if (previous.width < MEASURABLE) return;

    for (const window of this.windows) {
      if (window.zone !== "none") {
        const snapped = rectForZone(window.zone, area);
        if (snapped) window.rect = snapped;
      } else {
        window.rect = clampToArea(window.rect, area);
      }
    }
  }

  #get(id: number) {
    return this.windows.find((w) => w.id === id);
  }

  open(appId: string, spec: { title: string; size: Size; min: Size }): number {
    const existing = this.windows.find((w) => w.appId === appId);
    if (existing) {
      // One window per app for now. Asking again brings it forward rather
      // than opening a second copy.
      existing.minimised = false;
      this.focus(existing.id);
      return existing.id;
    }

    const id = this.#nextId++;
    this.windows.push({
      id,
      appId,
      title: spec.title,
      rect: placeNew(spec.size, this.area, this.#opened++),
      min: spec.min,
      z: this.#nextZ++,
      minimised: false,
      zone: "none",
      restore: null,
    });
    return id;
  }

  close(id: number) {
    this.windows = this.windows.filter((w) => w.id !== id);
  }

  focus(id: number) {
    const window = this.#get(id);
    if (!window || window.minimised) return;
    if (window.id === this.focusedId) return;
    window.z = this.#nextZ++;
  }

  toggleMinimise(id: number) {
    const window = this.#get(id);
    if (!window) return;
    window.minimised = !window.minimised;
    if (!window.minimised) window.z = this.#nextZ++;
  }

  toggleMaximise(id: number) {
    const window = this.#get(id);
    if (!window) return;
    this.snapTo(id, window.zone === "maximise" ? "none" : "maximise");
  }

  snapTo(id: number, zone: SnapZone) {
    const window = this.#get(id);
    if (!window) return;

    if (zone === "none") {
      if (window.restore) window.rect = clampToArea(window.restore, this.area);
      window.restore = null;
      window.zone = "none";
      return;
    }

    const rect = rectForZone(zone, this.area);
    if (!rect) return;
    // Remember the free-floating rectangle, but only the first time: snapping
    // from one zone straight to another must not forget where it started.
    if (window.zone === "none") window.restore = { ...window.rect };
    window.rect = rect;
    window.zone = zone;
    this.focus(id);
  }

  setRect(id: number, rect: Rect) {
    const window = this.#get(id);
    if (!window) return;
    window.rect = clampToArea(rect, this.area);
    // Moving or resizing by hand releases the snap; the window is now where
    // the customer put it.
    window.zone = "none";
    window.restore = null;
  }

  setTitle(id: number, title: string) {
    const window = this.#get(id);
    if (window) window.title = title;
  }
}
