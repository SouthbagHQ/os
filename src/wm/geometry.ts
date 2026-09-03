/**
 * Window geometry.
 *
 * Pure functions over rectangles. No DOM, no viewport, no globals: the shell
 * measures its work area once and passes it in. Under labwc the compositor
 * owns geometry and most of this goes unused, so it must not be entangled
 * with anything that only exists in a browser.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export type SnapZone =
  | "none"
  | "left"
  | "right"
  | "maximise"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export type ResizeEdge =
  | "n"
  | "s"
  | "e"
  | "w"
  | "ne"
  | "nw"
  | "se"
  | "sw";

/** How close to an edge a pointer must be for a snap to arm. */
export const SNAP_THRESHOLD = 16;

/**
 * Which snap a drag would commit to if released at `pointer`.
 *
 * Corners win over edges, and the top edge maximises — the same order of
 * precedence labwc uses, so the browser build and the real compositor agree.
 */
export function snapZoneFor(
  pointer: Point,
  area: Rect,
  threshold = SNAP_THRESHOLD,
): SnapZone {
  const left = pointer.x - area.x <= threshold;
  const right = area.x + area.width - pointer.x <= threshold;
  const top = pointer.y - area.y <= threshold;
  const bottom = area.y + area.height - pointer.y <= threshold;

  // Outside the work area entirely: nothing is armed.
  if (
    pointer.x < area.x - threshold ||
    pointer.x > area.x + area.width + threshold ||
    pointer.y < area.y - threshold ||
    pointer.y > area.y + area.height + threshold
  ) {
    return "none";
  }

  if (top && left) return "top-left";
  if (top && right) return "top-right";
  if (bottom && left) return "bottom-left";
  if (bottom && right) return "bottom-right";
  if (top) return "maximise";
  if (left) return "left";
  if (right) return "right";
  return "none";
}

/** The rectangle a zone resolves to, or null for `none`. */
export function rectForZone(zone: SnapZone, area: Rect): Rect | null {
  // Floor the near half and give the remainder to the far half, so halves
  // and quarters tile the area exactly on odd sizes: no seam, no overlap.
  const leftWidth = Math.floor(area.width / 2);
  const rightWidth = area.width - leftWidth;
  const rightX = area.x + leftWidth;
  const topHeight = Math.floor(area.height / 2);
  const bottomHeight = area.height - topHeight;
  const bottomY = area.y + topHeight;

  switch (zone) {
    case "maximise":
      return { ...area };
    case "left":
      return { x: area.x, y: area.y, width: leftWidth, height: area.height };
    case "right":
      return { x: rightX, y: area.y, width: rightWidth, height: area.height };
    case "top-left":
      return { x: area.x, y: area.y, width: leftWidth, height: topHeight };
    case "top-right":
      return { x: rightX, y: area.y, width: rightWidth, height: topHeight };
    case "bottom-left":
      return { x: area.x, y: bottomY, width: leftWidth, height: bottomHeight };
    case "bottom-right":
      return {
        x: rightX,
        y: bottomY,
        width: rightWidth,
        height: bottomHeight,
      };
    case "none":
      return null;
  }
}

/** Grows a rectangle to satisfy a minimum size. */
export function applyMin(rect: Rect, min: Size): Rect {
  return {
    ...rect,
    width: Math.max(rect.width, min.width),
    height: Math.max(rect.height, min.height),
  };
}

/**
 * Keeps a window reachable. A window may hang off an edge, but never so far
 * that there is nothing left to grab.
 */
export function clampToArea(rect: Rect, area: Rect, keepVisible = 96): Rect {
  const maxX = area.x + area.width - keepVisible;
  const maxY = area.y + area.height - keepVisible;
  return {
    ...rect,
    x: Math.min(Math.max(rect.x, area.x - rect.width + keepVisible), maxX),
    y: Math.min(Math.max(rect.y, area.y), maxY),
  };
}

/** Applies a resize drag to the edge that was grabbed. */
export function resizeRect(
  start: Rect,
  edge: ResizeEdge,
  dx: number,
  dy: number,
  min: Size,
): Rect {
  let { x, y, width, height } = start;

  if (edge.includes("e")) width = start.width + dx;
  if (edge.includes("s")) height = start.height + dy;

  // Dragging a top or left edge moves the origin as well as the size, and
  // must stop moving it once the minimum is reached.
  if (edge.includes("w")) {
    width = Math.max(start.width - dx, min.width);
    x = start.x + start.width - width;
  }
  if (edge.includes("n")) {
    height = Math.max(start.height - dy, min.height);
    y = start.y + start.height - height;
  }

  return applyMin({ x, y, width, height }, min);
}

/** Where a newly opened window goes, stepped so windows do not stack exactly. */
export function placeNew(size: Size, area: Rect, index: number): Rect {
  const step = 28;
  const offset = (index % 5) * step;
  const width = Math.min(size.width, area.width);
  const height = Math.min(size.height, area.height);
  return clampToArea(
    {
      x: Math.round(area.x + (area.width - width) / 2) + offset,
      y: Math.round(area.y + (area.height - height) / 2.6) + offset,
      width,
      height,
    },
    area,
  );
}
