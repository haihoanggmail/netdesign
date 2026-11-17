import type { CableEdge, CablePoint } from '../types/infrastructure';
import { resolveCableLabelTransform, type CableBundleInfo } from './cableRouting';
import { isSafeRect, parseSvgPathBounds, transformedLocalRectBounds, unionRects, MAX_ABS_COORD } from './geometryResolver';
import type { Rect } from './viewportMath';
import {
  ADD_LABEL_BOX, ADD_WAYPOINT_HANDLE, BUNDLE_JACKET, ENDPOINT_HANDLE, LABEL_SHADOW, LABEL_STROKE, WAYPOINT_HANDLE,
  bundleBadgeGeometry, cableStrokeWidths, dropShadowExtent, handleOuterRadius, normalizeCableStrokeWidth,
  resolveCableLabelPresentation
} from './cableRenderMetrics';

/**
 * Footprint of everything DesignCanvas draws for a cable, measured with the SAME constants (cableRenderMetrics)
 * and the SAME geometry (CablePathResult / CableBundleInfo). Pure: no selection, visibility or project policy lives
 * here — callers say what is drawn through CableBoundsContext.
 *
 * Contract: every function returns { ok:true, bounds } or { ok:false, reason }. A non-finite or out-of-range
 * intermediate value is never turned into a number.
 */
export { MAX_STROKE_WIDTH } from './cableRenderMetrics';

export interface CablePathLike {
  d: string;
  midPoint: { x: number; y: number };
  midAngleDeg: number;
  /** needed only for edit overlays (add-waypoint handles sit on the midpoints of consecutive pts) */
  pts?: CablePoint[];
  x1?: number; y1?: number; x2?: number; y2?: number;
}

export interface CableBoundsContext {
  /** neither 'cable_labels' nor 'labels' layer hidden */
  labelLayerVisible: boolean;
  showCableCodes: boolean;
  isBundled: boolean;
  /** default true: Zoom to Selection measures a selected cable */
  isSelected?: boolean;
  isHovered?: boolean;
  /** read-only hides the "+ Thêm nhãn" button and all edit handles (as the canvas does) */
  isReadOnly?: boolean;
  /** inline label editor open → the canvas draws no badge/button for this cable */
  isEditingLabel?: boolean;
  /** caller opt-in for edit overlays (they are still only measured if selected && !readOnly) */
  includeEditHandles: boolean;
}

export type CableBoundsResult = { ok: true; bounds: Rect } | { ok: false; reason: string };
const fail = (reason: string): CableBoundsResult => ({ ok: false, reason });
const ok = (bounds: Rect): CableBoundsResult => ({ ok: true, bounds });
const labelOf = (c: CableEdge) => c.cableCode || c.id;
const goodPoint = (p: { x: number; y: number } | undefined): p is { x: number; y: number } =>
  !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) <= MAX_ABS_COORD && Math.abs(p.y) <= MAX_ABS_COORD;
const circleRect = (p: { x: number; y: number }, r: number): Rect => ({ minX: p.x - r, minY: p.y - r, maxX: p.x + r, maxY: p.y + r });

/** Route + BOTH strokes (halo = strokeWidth+8 and main = strokeWidth+1.5 when selected); round caps/joins never exceed half the widest stroke. */
export function computeCableStrokeBounds(cable: CableEdge, path: Pick<CablePathLike, 'd'>, state: { isSelected: boolean; isHovered: boolean }): CableBoundsResult {
  const name = labelOf(cable);
  const w = normalizeCableStrokeWidth(cable.strokeWidth);
  if (w === null) return fail(`Độ dày nét (strokeWidth) của tuyến ${name} không hợp lệ: ${String(cable.strokeWidth)}`);
  const pb = parseSvgPathBounds(path.d);
  if (!pb.ok) return fail(`Hình học tuyến ${name} không hợp lệ: ${pb.reason}`);
  const { main, halo } = cableStrokeWidths(w, state);
  const half = Math.max(main, halo ?? 0) / 2;
  return ok({ minX: pb.bounds.minX - half, minY: pb.bounds.minY - half, maxX: pb.bounds.maxX + half, maxY: pb.bounds.maxY + half });
}

/** Badge (rotated, outline stroke, drop-shadow footprint) or "+ Thêm nhãn" button — whichever is really drawn; null when neither. */
export function computeCableLabelBounds(cable: CableEdge, path: CablePathLike, ctx: CableBoundsContext): { ok: true; bounds: Rect | null } | { ok: false; reason: string } {
  const name = labelOf(cable);
  if (!ctx.labelLayerVisible) return { ok: true, bounds: null };
  const isSelected = ctx.isSelected !== false;
  const presentation = resolveCableLabelPresentation({
    isSelected,
    isHovered: Boolean(ctx.isHovered),
    isBundled: ctx.isBundled,
    isReadOnly: Boolean(ctx.isReadOnly),
    isEditingLabel: Boolean(ctx.isEditingLabel),
    showCableCodes: ctx.showCableCodes,
    hasCustomLabel: Boolean(cable.label && cable.label.trim().length > 0)
  });
  if (presentation === 'none') return { ok: true, bounds: null };
  const mid = path.midPoint;
  if (!goodPoint(mid) || !Number.isFinite(path.midAngleDeg)) return { ok: false, reason: `Vị trí nhãn của tuyến ${name} không hợp lệ` };
  const lt = resolveCableLabelTransform(cable, { midPoint: mid, midAngleDeg: path.midAngleDeg });
  if (![lt.x, lt.y, lt.angleDeg, lt.badgeWidth, lt.badgeHeight].every(Number.isFinite)) {
    return { ok: false, reason: `Kích thước/góc nhãn của tuyến ${name} không hợp lệ` };
  }
  if (presentation === 'add-button') {
    const hx = ADD_LABEL_BOX.width / 2 + ADD_LABEL_BOX.stroke / 2;
    const hy = ADD_LABEL_BOX.height / 2 + ADD_LABEL_BOX.stroke / 2;
    return { ok: true, bounds: transformedLocalRectBounds(lt.x, lt.y, lt.angleDeg, -hx, -hy, hx, hy) };
  }
  const stroke = isSelected ? LABEL_STROKE.selected : LABEL_STROKE.idle;
  const sh = dropShadowExtent(isSelected ? LABEL_SHADOW.selected : LABEL_SHADOW.idle);
  const hx = lt.badgeWidth / 2 + stroke / 2;
  const hy = lt.badgeHeight / 2 + stroke / 2;
  return { ok: true, bounds: transformedLocalRectBounds(lt.x, lt.y, lt.angleDeg, -hx - sh.left, -hy - sh.top, hx + sh.right, hy + sh.bottom) };
}

/** Waypoint handles + add-waypoint (+) handles on every segment midpoint + source/target reconnect handles. */
export function computeCableEditOverlayBounds(cable: CableEdge, path: CablePathLike): CableBoundsResult {
  const name = labelOf(cable);
  const parts: Rect[] = [];
  for (const cp of cable.controlPoints || []) {
    if (!goodPoint(cp)) return fail(`Điểm điều khiển của tuyến ${name} không hợp lệ`);
    parts.push(circleRect(cp, handleOuterRadius(WAYPOINT_HANDLE)));
  }
  const pts = path.pts || [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (!goodPoint(a) || !goodPoint(b)) return fail(`Điểm tuyến ${name} không hợp lệ`);
    parts.push(circleRect({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, handleOuterRadius(ADD_WAYPOINT_HANDLE)));
  }
  const src = { x: path.x1 as number, y: path.y1 as number };
  const tgt = { x: path.x2 as number, y: path.y2 as number };
  if (!goodPoint(src) || !goodPoint(tgt)) return fail(`Thiếu tọa độ đầu cuối của tuyến ${name} để tính tay nắm nối lại`);
  parts.push(circleRect(src, handleOuterRadius(ENDPOINT_HANDLE)), circleRect(tgt, handleOuterRadius(ENDPOINT_HANDLE)));
  const u = unionRects(parts)!;
  return isSafeRect(u) ? ok(u) : fail(`Bounds tay nắm của tuyến ${name} vượt giới hạn tọa độ`);
}

/** Summary badge (name + count + colour dots) of a bundle, from the SAME CableBundleInfo + formula the canvas uses. Not rotated. */
export function computeCableBundleLabelBounds(bundle: CableBundleInfo): CableBoundsResult {
  if (!goodPoint(bundle.midPoint) || !Number.isFinite(bundle.spanWidthPx) || typeof bundle.summaryLabel !== 'string') {
    return fail(`Nhãn tổng hợp của bó ${bundle.bundleId} không hợp lệ`);
  }
  const g = bundleBadgeGeometry(bundle);
  const hx = g.width / 2 + g.strokeWidth / 2;
  const hy = g.height / 2 + g.strokeWidth / 2;
  const r = { minX: g.cx - hx, minY: g.cy - hy, maxX: g.cx + hx, maxY: g.cy + hy };
  return isSafeRect(r) ? ok(r) : fail(`Bounds nhãn bó ${bundle.bundleId} vượt giới hạn tọa độ`);
}

/** The dashed jacket rectangle drawn around a bundle (rotated along the bundle tangent). */
export function computeCableBundleJacketBounds(bundle: CableBundleInfo): CableBoundsResult {
  if (!goodPoint(bundle.midPoint) || !goodPoint(bundle.tangent) || !Number.isFinite(bundle.spanWidthPx)) {
    return fail(`Hình học vỏ bó ${bundle.bundleId} không hợp lệ`);
  }
  const angleDeg = (Math.atan2(bundle.tangent.y, bundle.tangent.x) * 180) / Math.PI;
  const s = BUNDLE_JACKET.stroke.active / 2; // widest outline used by the canvas
  const hx = BUNDLE_JACKET.halfWidth + s;
  const hy = bundle.spanWidthPx / 2 + BUNDLE_JACKET.padY + s;
  const r = transformedLocalRectBounds(bundle.midPoint.x, bundle.midPoint.y, angleDeg, -hx, -hy, hx, hy);
  return isSafeRect(r) ? ok(r) : fail(`Bounds vỏ bó ${bundle.bundleId} vượt giới hạn tọa độ`);
}

/** Visible footprint of ONE cable (strokes + label + edit overlay). Bundle summary badge/jacket are added once per bundle by the caller. */
export function computeCableBounds(cable: CableEdge, path: CablePathLike, ctx: CableBoundsContext): CableBoundsResult {
  const isSelected = ctx.isSelected !== false;
  const stroke = computeCableStrokeBounds(cable, path, { isSelected, isHovered: Boolean(ctx.isHovered) });
  if (!stroke.ok) return stroke;
  const parts: Rect[] = [stroke.bounds];

  const label = computeCableLabelBounds(cable, path, ctx);
  if (!label.ok) return fail(label.reason);
  if (label.bounds) parts.push(label.bounds);

  if (ctx.includeEditHandles && isSelected && !ctx.isReadOnly) {
    const overlay = computeCableEditOverlayBounds(cable, path);
    if (!overlay.ok) return overlay;
    parts.push(overlay.bounds);
  }

  const union = unionRects(parts)!;
  return isSafeRect(union) ? ok(union) : fail(`Bounds của tuyến ${labelOf(cable)} vượt giới hạn tọa độ sau khi cộng nét/nhãn`);
}
