/**
 * Boot choreography.
 *
 * The surfaces do not drive each other. Each one reads the stage and responds,
 * exactly as they will when they are four separate layer-shell clients and the
 * sequence is owned by the session rather than by a page.
 */

export type Stage =
  | "black"
  | "mark"
  | "reveal"
  | "panel"
  | "land"
  | "greeting"
  | "done";

/** Milliseconds from power-on. */
export const BEATS: Record<Exclude<Stage, "black">, number> = {
  /** The mark fades up, centred. Nothing else is on screen. */
  mark: 250,
  /** It begins to travel; the curtain lifts and the wallpaper resolves. */
  reveal: 1100,
  /** The panel draws up to meet it. */
  panel: 1300,
  /** Mark and launcher cross over. The travel ends as the panel settles. */
  land: 1560,
  /** Good evening. */
  greeting: 1800,
  done: 2600,
};

const REDUCED = "(prefers-reduced-motion: reduce)";

class Sequence {
  stage = $state<Stage>("black");

  reduced = matchMedia(REDUCED).matches;

  run() {
    // Development only: ?boot=4 stretches the timeline for inspection.
    // Stripped from the production bundle.
    const factor = import.meta.env.DEV
      ? Number(new URLSearchParams(location.search).get("boot")) || 1
      : 1;

    if (this.reduced) {
      // Same beats, no travel. Two hundred milliseconds, and you are at work.
      this.stage = "greeting";
      setTimeout(() => (this.stage = "done"), 200);
      return;
    }
    for (const [stage, at] of Object.entries(BEATS)) {
      setTimeout(() => (this.stage = stage as Stage), at * factor);
    }
  }

  /** True once the stage has reached `at` or passed it. */
  atLeast(at: Stage): boolean {
    const order: Stage[] = [
      "black",
      "mark",
      "reveal",
      "panel",
      "land",
      "greeting",
      "done",
    ];
    return order.indexOf(this.stage) >= order.indexOf(at);
  }
}

export const sequence = new Sequence();
