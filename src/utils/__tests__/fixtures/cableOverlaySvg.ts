/**
 * Test fixture: serialises what DesignCanvas draws for SELECTED cables (strokes, label/"+ Thêm nhãn", edit handles,
 * bundle jacket + summary badge) using the SAME shared metrics (cableRenderMetrics) and resolvers as the app.
 * It is the Chromium-side half of the Render-to-Bounds parity test. The real-app half lives in e2e/render-parity.spec.ts.
 * If DesignCanvas changes an attribute that is not driven by cableRenderMetrics, update BOTH places (the e2e spec catches drift).
 */
import type { CableEdge } from '../../../types/infrastructure';
import { resolveCableLabelTransform, normalizeCableColor, type CableBundleInfo, type CablePathResult } from '../../cableRouting';
import {
  ADD_LABEL_BOX, ADD_WAYPOINT_HANDLE, BUNDLE_BADGE, BUNDLE_JACKET, ENDPOINT_HANDLE, LABEL_SHADOW, LABEL_STROKE, WAYPOINT_HANDLE,
  bundleBadgeGeometry, bundleDotsWidth, cableLabelTextLength, cableStrokeWidths, dropShadowCss, normalizeCableStrokeWidth, resolveCableLabelPresentation
} from '../../cableRenderMetrics';

export interface OverlayInput {
  cables: Array<{ cable: CableEdge; path: CablePathResult; isBundled: boolean }>;
  bundles: CableBundleInfo[];
  labelLayerVisible: boolean;
  showCableCodes: boolean;
  isReadOnly: boolean;
  /** caller opted in to edit overlays (the canvas then draws them for a selected cable unless read-only) */
  showHandles: boolean;
}
const n = (v: number) => String(Math.round(v * 1000) / 1000);

export function cableOverlayMarkup(inp: OverlayInput): string {
  const out: string[] = [];
  for (const b of inp.bundles) {
    const ang = (Math.atan2(b.tangent.y, b.tangent.x) * 180) / Math.PI;
    out.push(`<g data-part="bundle-jacket" transform="translate(${n(b.midPoint.x)}, ${n(b.midPoint.y)}) rotate(${n(ang)})">
      <rect x="${-BUNDLE_JACKET.halfWidth}" y="${n(-(b.spanWidthPx / 2 + BUNDLE_JACKET.padY))}" width="${BUNDLE_JACKET.halfWidth * 2}" height="${n(b.spanWidthPx + BUNDLE_JACKET.padY * 2)}" rx="6" fill="#eff6ff" fill-opacity="0.85" stroke="#2563eb" stroke-width="${BUNDLE_JACKET.stroke.active}" stroke-dasharray="3 2"/>
      <line x1="-5" y1="${n(-(b.spanWidthPx / 2 + 2))}" x2="-5" y2="${n(b.spanWidthPx / 2 + 2)}" stroke="#1d4ed8" stroke-width="1.5"/>
      <line x1="5" y1="${n(-(b.spanWidthPx / 2 + 2))}" x2="5" y2="${n(b.spanWidthPx / 2 + 2)}" stroke="#1d4ed8" stroke-width="1.5"/></g>`);
  }
  for (const { cable, path, isBundled } of inp.cables) {
    const color = normalizeCableColor(cable.color || '#0284c7');
    const w = cableStrokeWidths(normalizeCableStrokeWidth(cable.strokeWidth) ?? 1, { isSelected: true, isHovered: false });
    out.push(`<g data-part="cable-${cable.id}">
      <path d="${path.d}" fill="none" stroke="${color}" stroke-opacity="0.3" stroke-width="${w.halo}" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${path.d}" fill="none" stroke="${color}" stroke-width="${w.main}" ${cable.lineStyle === 'dashed' ? 'stroke-dasharray="6 4"' : ''} stroke-linecap="round" stroke-linejoin="round"/>`);
    if (inp.showHandles && !inp.isReadOnly) {
      for (const cp of cable.controlPoints || []) out.push(`<circle cx="${cp.x}" cy="${cp.y}" r="${WAYPOINT_HANDLE.r}" fill="#f59e0b" stroke="#ffffff" stroke-width="${WAYPOINT_HANDLE.stroke}"/>`);
      path.pts.slice(0, -1).forEach((a, i) => {
        const b = path.pts[i + 1];
        out.push(`<g transform="translate(${n((a.x + b.x) / 2)}, ${n((a.y + b.y) / 2)})"><circle r="${ADD_WAYPOINT_HANDLE.r}" fill="#eff6ff" stroke="#2563eb" stroke-width="${ADD_WAYPOINT_HANDLE.stroke}" stroke-dasharray="2 1"/><text x="0" y="3" text-anchor="middle" fill="#1d4ed8" font-size="9" font-weight="bold">+</text></g>`);
      });
      out.push(`<circle cx="${path.x1}" cy="${path.y1}" r="${ENDPOINT_HANDLE.r}" fill="#10b981" stroke="#ffffff" stroke-width="${ENDPOINT_HANDLE.stroke}"/>`);
      out.push(`<circle cx="${path.x2}" cy="${path.y2}" r="${ENDPOINT_HANDLE.r}" fill="#06b6d4" stroke="#ffffff" stroke-width="${ENDPOINT_HANDLE.stroke}"/>`);
    }
    out.push('</g>');
    if (inp.labelLayerVisible) {
      const hasCustom = Boolean(cable.label && cable.label.trim().length > 0);
      const pres = resolveCableLabelPresentation({ isSelected: true, isHovered: false, isBundled, isReadOnly: inp.isReadOnly, isEditingLabel: false, showCableCodes: inp.showCableCodes, hasCustomLabel: hasCustom });
      const lt = resolveCableLabelTransform(cable, { midPoint: path.midPoint, midAngleDeg: path.midAngleDeg });
      if (pres === 'add-button') {
        out.push(`<g data-part="add-label" transform="translate(${n(lt.x)}, ${n(lt.y)}) rotate(${lt.angleDeg})"><rect x="${-ADD_LABEL_BOX.width / 2}" y="${-ADD_LABEL_BOX.height / 2}" width="${ADD_LABEL_BOX.width}" height="${ADD_LABEL_BOX.height}" rx="4" fill="#f8fafc" stroke="${color}" stroke-width="${ADD_LABEL_BOX.stroke}" stroke-dasharray="3 2"/><text x="0" y="3" text-anchor="middle" fill="#334155" font-size="8.5" font-weight="600">+ Thêm nhãn</text></g>`);
      } else if (pres === 'badge') {
        const dotR = Math.max(2.4, Math.min(4.2, lt.fontSize * 0.28));
        out.push(`<g data-part="badge" transform="translate(${n(lt.x)}, ${n(lt.y)}) rotate(${lt.angleDeg})">
          <rect x="${-lt.badgeWidth / 2}" y="${-lt.badgeHeight / 2}" width="${lt.badgeWidth}" height="${lt.badgeHeight}" rx="4" fill="#ffffff" fill-opacity="0.99" stroke="${color}" stroke-width="${LABEL_STROKE.selected}" style="filter:${dropShadowCss(LABEL_SHADOW.selected)}"/>
          <circle cx="${n(-lt.badgeWidth / 2 + dotR + 5.5)}" cy="0" r="${dotR}" fill="${color}"/>
          <text x="${n(dotR * 0.9 + 2)}" y="${n(lt.fontSize * 0.35)}" text-anchor="middle" ${(() => { const tl = cableLabelTextLength(lt.text.length, lt.fontSize, lt.badgeWidth); return tl === undefined ? '' : `textLength="${n(tl)}" lengthAdjust="spacingAndGlyphs"`; })()} fill="#0f172a" font-size="${lt.fontSize}" font-weight="${hasCustom ? 700 : 600}" font-family="${hasCustom ? 'system-ui, sans-serif' : 'monospace'}">${lt.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></g>`);
      }
    }
  }
  if (inp.labelLayerVisible) {
    for (const b of inp.bundles) {
      const g = bundleBadgeGeometry(b);
      const dots = (b.distinctColors || [b.primaryColor]).slice(0, BUNDLE_BADGE.maxDots);
      const dotsW = bundleDotsWidth(dots.length);
      out.push(`<g data-part="bundle-badge" transform="translate(${n(g.cx)}, ${n(g.cy)})"><rect x="${n(-g.width / 2)}" y="${-g.height / 2}" width="${n(g.width)}" height="${g.height}" rx="4" fill="#ffffff" stroke="${b.primaryColor}" stroke-width="${g.strokeWidth}"/>
        ${dots.map((c, i) => `<circle cx="${n(-g.width / 2 + 9 + i * BUNDLE_BADGE.dotStep)}" cy="0" r="2.6" fill="${c}" stroke="#0f172a" stroke-opacity="0.25" stroke-width="0.6"/>`).join('')}
        <text x="${n(dotsW / 2 - 2)}" y="3" text-anchor="middle" fill="#1e3a8a" font-size="8.5" font-weight="700" font-family="monospace">${b.summaryLabel}</text></g>`);
    }
  }
  return out.join('\n');
}
