import { expect, test, describe } from "bun:test";
import {
  applyMin,
  clampToArea,
  placeNew,
  rectForZone,
  resizeRect,
  snapZoneFor,
  type Rect,
} from "./geometry";

// A 1280x800 screen with the 44px panel taken off the bottom.
const AREA: Rect = { x: 0, y: 0, width: 1280, height: 756 };
const MIN = { width: 320, height: 200 };

describe("snapZoneFor", () => {
  test("arms nothing in open space", () => {
    expect(snapZoneFor({ x: 600, y: 400 }, AREA)).toBe("none");
  });

  test("arms halves on the side edges", () => {
    expect(snapZoneFor({ x: 4, y: 400 }, AREA)).toBe("left");
    expect(snapZoneFor({ x: 1276, y: 400 }, AREA)).toBe("right");
  });

  test("arms maximise on the top edge", () => {
    expect(snapZoneFor({ x: 600, y: 2 }, AREA)).toBe("maximise");
  });

  test("corners win over edges", () => {
    expect(snapZoneFor({ x: 2, y: 2 }, AREA)).toBe("top-left");
    expect(snapZoneFor({ x: 1278, y: 2 }, AREA)).toBe("top-right");
    expect(snapZoneFor({ x: 2, y: 754 }, AREA)).toBe("bottom-left");
    expect(snapZoneFor({ x: 1278, y: 754 }, AREA)).toBe("bottom-right");
  });

  test("respects the threshold boundary", () => {
    expect(snapZoneFor({ x: 16, y: 400 }, AREA)).toBe("left");
    expect(snapZoneFor({ x: 17, y: 400 }, AREA)).toBe("none");
  });

  test("arms nothing far outside the area", () => {
    expect(snapZoneFor({ x: -400, y: 400 }, AREA)).toBe("none");
    expect(snapZoneFor({ x: 600, y: 2000 }, AREA)).toBe("none");
  });

  test("does not snap to the bottom edge as a half", () => {
    // The panel lives below the work area; a drag toward it must not maximise.
    expect(snapZoneFor({ x: 600, y: 754 }, AREA)).toBe("none");
  });
});

describe("rectForZone", () => {
  test("halves tile the area exactly, with no seam", () => {
    const left = rectForZone("left", AREA)!;
    const right = rectForZone("right", AREA)!;
    expect(left.x + left.width).toBe(right.x);
    expect(left.width + right.width).toBe(AREA.width);
  });

  test("quarters tile the area exactly", () => {
    const zones = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
    const total = zones
      .map((zone) => rectForZone(zone, AREA)!)
      .reduce((sum, rect) => sum + rect.width * rect.height, 0);
    expect(total).toBe(AREA.width * AREA.height);
  });

  test("halves tile an odd width with no seam and no overlap", () => {
    const odd: Rect = { x: 0, y: 0, width: 1281, height: 755 };
    const left = rectForZone("left", odd)!;
    const right = rectForZone("right", odd)!;
    expect(left.x + left.width).toBe(right.x);
    expect(left.width + right.width).toBe(odd.width);
  });

  test("maximise fills the work area, not the screen", () => {
    expect(rectForZone("maximise", AREA)).toEqual(AREA);
  });

  test("none resolves to nothing", () => {
    expect(rectForZone("none", AREA)).toBeNull();
  });
});

describe("clampToArea", () => {
  test("leaves a window that is fully inside alone", () => {
    const rect = { x: 100, y: 100, width: 400, height: 300 };
    expect(clampToArea(rect, AREA)).toEqual(rect);
  });

  test("keeps a grabbable edge on screen", () => {
    const far = clampToArea({ x: -900, y: 100, width: 400, height: 300 }, AREA);
    expect(far.x + far.width).toBeGreaterThanOrEqual(96);
  });

  test("never lets a titlebar go above the top of the area", () => {
    expect(clampToArea({ x: 0, y: -200, width: 400, height: 300 }, AREA).y).toBe(0);
  });

  test("keeps a window from being dragged fully behind the panel", () => {
    const low = clampToArea({ x: 0, y: 5000, width: 400, height: 300 }, AREA);
    expect(low.y).toBeLessThanOrEqual(AREA.height - 96);
  });
});

describe("resizeRect", () => {
  test("east edge grows width only", () => {
    const out = resizeRect({ x: 10, y: 20, width: 400, height: 300 }, "e", 50, 0, MIN);
    expect(out).toEqual({ x: 10, y: 20, width: 450, height: 300 });
  });

  test("west edge moves the origin and keeps the far edge still", () => {
    const start = { x: 100, y: 20, width: 400, height: 300 };
    const out = resizeRect(start, "w", -50, 0, MIN);
    expect(out.x).toBe(50);
    expect(out.x + out.width).toBe(start.x + start.width);
  });

  test("north edge keeps the bottom edge still", () => {
    const start = { x: 100, y: 100, width: 400, height: 300 };
    const out = resizeRect(start, "n", 0, 40, MIN);
    expect(out.y).toBe(140);
    expect(out.y + out.height).toBe(start.y + start.height);
  });

  test("a west drag past the minimum stops moving the origin", () => {
    const start = { x: 100, y: 20, width: 400, height: 300 };
    const out = resizeRect(start, "w", 900, 0, MIN);
    expect(out.width).toBe(MIN.width);
    // The far edge stays put, so the window does not walk off to the right.
    expect(out.x + out.width).toBe(start.x + start.width);
  });

  test("corner drags apply both axes", () => {
    const out = resizeRect({ x: 0, y: 0, width: 400, height: 300 }, "se", 60, 40, MIN);
    expect(out).toEqual({ x: 0, y: 0, width: 460, height: 340 });
  });

  test("never returns a size below the minimum", () => {
    const out = resizeRect({ x: 0, y: 0, width: 400, height: 300 }, "se", -9999, -9999, MIN);
    expect(out.width).toBe(MIN.width);
    expect(out.height).toBe(MIN.height);
  });
});

describe("placeNew", () => {
  test("steps successive windows so they do not stack exactly", () => {
    const first = placeNew({ width: 600, height: 420 }, AREA, 0);
    const second = placeNew({ width: 600, height: 420 }, AREA, 1);
    expect(second.x).toBeGreaterThan(first.x);
    expect(second.y).toBeGreaterThan(first.y);
  });

  test("a window larger than the area is brought down to fit", () => {
    const huge = placeNew({ width: 4000, height: 4000 }, AREA, 0);
    expect(huge.width).toBeLessThanOrEqual(AREA.width);
    expect(huge.height).toBeLessThanOrEqual(AREA.height);
  });

  test("stays inside the work area", () => {
    for (let i = 0; i < 12; i++) {
      const rect = placeNew({ width: 600, height: 420 }, AREA, i);
      expect(rect.y).toBeGreaterThanOrEqual(AREA.y);
      expect(rect.y).toBeLessThanOrEqual(AREA.height - 96);
    }
  });
});

describe("applyMin", () => {
  test("grows a rectangle below the minimum and leaves position alone", () => {
    expect(applyMin({ x: 5, y: 6, width: 10, height: 10 }, MIN)).toEqual({
      x: 5,
      y: 6,
      width: 320,
      height: 200,
    });
  });
});
