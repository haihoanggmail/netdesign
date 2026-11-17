/**
 * Pure 2D viewport math (Screen = Pan + World × Zoom).
 * No React / DOM dependencies so that coordinate behaviour can be unit-tested exactly.
 */
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 3.0;

export interface Point {
  x: number;
  y: number;
}
export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
export interface ViewTransform {
  pan: Point;
  zoom: number;
}

/** Wheel / button step. Zoom-out uses the exact inverse so N in + N out returns to the start. */
export const ZOOM_STEP = 1.1;
export const zoomInFactor = ZOOM_STEP;
export const zoomOutFactor = 1 / ZOOM_STEP;

/** Pan beyond this is certainly corrupt data (same bound as geometryResolver.MAX_ABS_COORD × max zoom headroom). */
export const MAX_ABS_PAN = 1e8;

/**
 * Viewport invariant guard. Returns a safe ViewTransform or null when `next` cannot be trusted
 * (missing/!object, zoom or pan missing, NaN/±Infinity, absurd pan). A finite zoom outside
 * [MIN_ZOOM, MAX_ZOOM] is clamped (never silently replaced by 1 like clampZoom does for NaN).
 */
export function normalizeViewportTransform(next: unknown): ViewTransform | null {
  if (typeof next !== 'object' || next === null) return null;
  const { zoom, pan } = next as { zoom?: unknown; pan?: unknown };
  if (typeof zoom !== 'number' || !Number.isFinite(zoom) || zoom <= 0) return null;
  if (typeof pan !== 'object' || pan === null) return null;
  const { x, y } = pan as { x?: unknown; y?: unknown };
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (Math.abs(x) > MAX_ABS_PAN || Math.abs(y) > MAX_ABS_PAN) return null;
  return { zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)), pan: { x, y } };
}

/**
 * Pure reducer behind every viewport setter. Invalid input keeps the previous state (same reference,
 * so React does not re-render); an unchanged valid value also keeps the reference.
 */
export function reduceViewport(prev: ViewTransform, next: unknown): ViewTransform {
  const safe = normalizeViewportTransform(next);
  if (!safe) return prev;
  if (safe.zoom === prev.zoom && safe.pan.x === prev.pan.x && safe.pan.y === prev.pan.y) return prev;
  return safe;
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function screenToWorld(screen: Point, view: ViewTransform): Point {
  return { x: (screen.x - view.pan.x) / view.zoom, y: (screen.y - view.pan.y) / view.zoom };
}

export function worldToScreen(world: Point, view: ViewTransform): Point {
  return { x: view.pan.x + world.x * view.zoom, y: view.pan.y + world.y * view.zoom };
}

/** Change zoom to `targetZoom` (clamped) keeping the world point under `anchor` (screen px) fixed. */
export function zoomAtPoint(view: ViewTransform, targetZoom: number, anchor: Point): ViewTransform {
  const zoom = clampZoom(targetZoom);
  if (zoom === view.zoom) return view;
  const world = screenToWorld(anchor, view);
  return { zoom, pan: { x: anchor.x - world.x * zoom, y: anchor.y - world.y * zoom } };
}

/** Multiply zoom by `factor` around `anchor`. */
export function zoomByFactorAtPoint(view: ViewTransform, factor: number, anchor: Point): ViewTransform {
  return zoomAtPoint(view, view.zoom * factor, anchor);
}

/** Zoom 100% keeping the viewport centre fixed. */
export function resetZoomAtCenter(view: ViewTransform, viewport: { w: number; h: number }): ViewTransform {
  return zoomAtPoint(view, 1, { x: viewport.w / 2, y: viewport.h / 2 });
}

/** View that centres `bounds` in the viewport with `padding` px, zoom within [minZoom, maxZoom]. */
export function fitRect(
  bounds: Rect,
  viewport: { w: number; h: number },
  options: { padding?: number; minZoom?: number; maxZoom?: number; minContent?: number } = {}
): ViewTransform {
  const padding = options.padding ?? 56;
  const minContent = options.minContent ?? 120;
  const contentW = Math.max(minContent, bounds.maxX - bounds.minX);
  const contentH = Math.max(minContent, bounds.maxY - bounds.minY);
  const raw = Math.min((viewport.w - padding * 2) / contentW, (viewport.h - padding * 2) / contentH);
  const zoom = Math.min(options.maxZoom ?? MAX_ZOOM, Math.max(options.minZoom ?? MIN_ZOOM, raw));
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { zoom, pan: { x: viewport.w / 2 - cx * zoom, y: viewport.h / 2 - cy * zoom } };
}

export function boundsOfRects(rects: Array<{ x: number; y: number; width: number; height: number }>): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { minX, minY, maxX, maxY };
}
