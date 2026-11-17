/**
 * Single source of truth for the SIZE of everything the canvas draws around a cable.
 * DesignCanvas.tsx renders with these constants/functions and cableBounds.ts measures with the SAME ones,
 * so a change to the renderer cannot silently diverge from "Zoom to Selection" (What You See Is What You Zoom).
 * Pure module: no React, no project state, no visibility policy.
 */
import type { CableEdge } from '../types/infrastructure';
import type { CableBundleInfo } from './cableRouting';

export const MAX_STROKE_WIDTH = 1000;
export const DEFAULT_CABLE_STROKE = 1;

/* ── cable strokes ─────────────────────────────────────────────── */
export const CABLE_MAIN_EXTRA = { selected: 1.5, hovered: 0.75, idle: 0 } as const;
export const CABLE_HALO_EXTRA = { selected: 8, hovered: 5 } as const;

/** undefined/null → default; NaN, negative or absurd values → null (caller must report invalid, never guess). */
export function normalizeCableStrokeWidth(raw: unknown): number | null {
  if (raw === undefined || raw === null) return DEFAULT_CABLE_STROKE;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= MAX_STROKE_WIDTH ? n : null;
}

export interface CableStrokeState {
  isSelected: boolean;
  isHovered: boolean;
}

/** Widths of the two visible strokes (halo is drawn only while selected/hovered). Round caps + round joins are used. */
export function cableStrokeWidths(width: number, s: CableStrokeState): { main: number; halo: number | null } {
  const main = width + (s.isSelected ? CABLE_MAIN_EXTRA.selected : s.isHovered ? CABLE_MAIN_EXTRA.hovered : CABLE_MAIN_EXTRA.idle);
  const halo = s.isSelected ? width + CABLE_HALO_EXTRA.selected : s.isHovered ? width + CABLE_HALO_EXTRA.hovered : null;
  return { main, halo };
}

/* ── edit handles (outer radius = r + strokeWidth / 2) ─────────── */
export const WAYPOINT_HANDLE = { r: 6, stroke: 2 } as const;
export const ADD_WAYPOINT_HANDLE = { r: 5, stroke: 1.5 } as const;
export const ENDPOINT_HANDLE = { r: 6.5, stroke: 2 } as const;
export const handleOuterRadius = (h: { r: number; stroke: number }) => h.r + h.stroke / 2;

/* ── "+ Thêm nhãn" button ──────────────────────────────────────── */
export const ADD_LABEL_BOX = { width: 76, height: 20, stroke: 1.1 } as const;

/* ── cable badge ───────────────────────────────────────────────── */
export const LABEL_STROKE = { selected: 1.8, idle: 1.1 } as const;
export interface DropShadowSpec { dx: number; dy: number; blur: number; color: string }
export const LABEL_SHADOW = {
  selected: { dx: 0, dy: 2, blur: 5, color: 'rgba(37,99,235,0.22)' },
  idle: { dx: 0, dy: 1, blur: 2, color: 'rgba(15,23,42,0.10)' }
} as const satisfies Record<string, DropShadowSpec>;
export const dropShadowCss = (s: DropShadowSpec) => `drop-shadow(${s.dx}px ${s.dy}px ${s.blur}px ${s.color})`;
/**
 * Extent of a CSS drop-shadow beyond its source box. CSS blur radius B is a Gaussian with σ = B/2; the Gaussian kernel
 * is truncated at 3σ (Chromium/Skia use 3σ), so the shadow reaches (3σ ∓ offset) past each side. Derived from the
 * filter config itself, not from an arbitrary padding.
 */
export function dropShadowExtent(s: DropShadowSpec): { left: number; right: number; top: number; bottom: number } {
  const reach = 3 * (s.blur / 2);
  return {
    left: Math.max(0, reach - s.dx),
    right: Math.max(0, reach + s.dx),
    top: Math.max(0, reach - s.dy),
    bottom: Math.max(0, reach + s.dy)
  };
}

/**
 * resolveCableLabelTransform caps badgeWidth at 360px, but long text is not capped, so it used to spill out of the badge
 * (found by the Chromium parity test). When the natural width (same 0.64em estimate the badge width uses) exceeds the
 * room inside the badge, the text is squeezed to fit through SVG textLength. Returns undefined when the text already fits.
 */
export function cableLabelTextLength(textChars: number, fontSize: number, badgeWidth: number): number | undefined {
  const available = badgeWidth - fontSize * 2.2 - 8;
  return available > 0 && textChars * fontSize * 0.64 > available + 0.5 ? available : undefined;
}

/* ── what is drawn for a cable's label, in a given UI state ────── */
export interface CableLabelState {
  isSelected: boolean;
  isHovered: boolean;
  isBundled: boolean;
  isReadOnly: boolean;
  /** the inline editor is open for this cable → the canvas draws neither badge nor button */
  isEditingLabel: boolean;
  showCableCodes: boolean;
  hasCustomLabel: boolean;
}
export type CableLabelPresentation = 'badge' | 'add-button' | 'none';

/** Used by DesignCanvas to decide what to render AND by cableBounds to decide what to measure. */
export function resolveCableLabelPresentation(s: CableLabelState): CableLabelPresentation {
  if (s.isEditingLabel) return 'none';
  const showBadge = (s.showCableCodes || s.hasCustomLabel) && (!s.isBundled || s.isSelected || s.isHovered || s.hasCustomLabel);
  if (showBadge) return 'badge';
  if (s.isSelected && !s.isBundled && !s.isReadOnly) return 'add-button';
  return 'none';
}

/* ── bundle summary badge + jacket ─────────────────────────────── */
export const BUNDLE_BADGE = { minWidth: 82, height: 19, stroke: 1.3, charW: 5.8, padX: 14, dotStep: 7, dotPad: 4, maxDots: 4, yGap: 17 } as const;
export const BUNDLE_JACKET = { halfWidth: 11, padY: 4, stroke: { idle: 1.1, active: 1.8 } } as const;

export interface BundleBadgeGeometry {
  /** centre of the badge in canvas coordinates (the badge is NOT rotated) */
  cx: number;
  cy: number;
  width: number;
  height: number;
  strokeWidth: number;
}

export function bundleBadgeGeometry(bundle: Pick<CableBundleInfo, 'midPoint' | 'spanWidthPx' | 'summaryLabel' | 'distinctColors' | 'primaryColor'>): BundleBadgeGeometry {
  const dots = (bundle.distinctColors || [bundle.primaryColor]).slice(0, BUNDLE_BADGE.maxDots).length;
  const dotsW = dots * BUNDLE_BADGE.dotStep + BUNDLE_BADGE.dotPad;
  return {
    cx: bundle.midPoint.x,
    cy: bundle.midPoint.y - (bundle.spanWidthPx / 2 + BUNDLE_BADGE.yGap),
    width: Math.max(BUNDLE_BADGE.minWidth, bundle.summaryLabel.length * BUNDLE_BADGE.charW + BUNDLE_BADGE.padX + dotsW),
    height: BUNDLE_BADGE.height,
    strokeWidth: BUNDLE_BADGE.stroke
  };
}
export const bundleDotsWidth = (n: number) => Math.min(n, BUNDLE_BADGE.maxDots) * BUNDLE_BADGE.dotStep + BUNDLE_BADGE.dotPad;
