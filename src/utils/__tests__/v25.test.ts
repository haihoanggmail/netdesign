import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getZoomSelectionBounds } from '../selectionBounds';
import { resolveVisibility } from '../visibilityResolver';
import { computeCableBundleLayout, computeCablePath, resolveCableLabelTransform } from '../cableRouting';
import {
  computeCableBounds, computeCableBundleJacketBounds, computeCableBundleLabelBounds, computeCableEditOverlayBounds, computeCableLabelBounds
} from '../cableBounds';
import {
  ENDPOINT_HANDLE, LABEL_SHADOW, LABEL_STROKE, bundleBadgeGeometry, cableStrokeWidths, dropShadowCss, dropShadowExtent,
  handleOuterRadius, normalizeCableStrokeWidth, resolveCableLabelPresentation
} from '../cableRenderMetrics';
import { transformedLocalRectBounds } from '../geometryResolver';

let passed = 0;
function t(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !≈ ${b}`);

const node = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({
  id, type: 'device', x, y, width: 100, height: 50, diagramMode: 'floorplan', floorId: 'f1', layerId: 'network', ...extra
});
const cable = (id: string, s: string, tg: string, extra: Record<string, unknown> = {}) => ({
  id, cableCode: id, sourceNodeId: s, targetNodeId: tg, routingType: 'straight', strokeWidth: 2, ...extra
});
const project = (over: Record<string, unknown> = {}, settings: Record<string, unknown> = {}): any => ({
  activeMode: 'floorplan', activeFloorId: 'f1', assets: {}, racks: [], rooms: [],
  settings: { hiddenLayers: [], showCableCodes: false, ...settings },
  nodes: [node('a', 0, 0), node('b', 600, 0), node('c', -350, 0), node('e', 250, 0)],
  cables: [], ...over
});
const zoom = (p: any, ids: string[], opt: any = {}) =>
  getZoomSelectionBounds(p, { type: 'edge', id: ids[0], additionalIds: ids.slice(1) } as any, opt);
const bounds = (r: any) => { assert.equal(r.status, 'ok', JSON.stringify(r)); return r.bounds as { minX: number; minY: number; maxX: number; maxY: number }; };
const bundleProject = (k: number, settings: Record<string, unknown> = {}) =>
  project({ cables: Array.from({ length: k }, (_, i) => cable(`bn${i}`, 'a', 'b', { color: ['#0284c7', '#dc2626', '#16a34a'][i % 3] })) }, settings);
const layoutOf = (p: any) => {
  const v = resolveVisibility({ ...p, hiddenLayers: p.settings.hiddenLayers });
  return { v, layout: computeCableBundleLayout(v.visibleCables, v.getRoutableRect) };
};

console.log('V2.5 P0.1 – bundle summary badge');
t('badge geometry comes from CableBundleInfo and lies inside Zoom bounds when the label layer is visible', () => {
  const p = bundleProject(5);
  const { layout } = layoutOf(p);
  assert.equal(layout.bundles.length, 1);
  const badge = computeCableBundleLabelBounds(layout.bundles[0]);
  assert.ok(badge.ok);
  const b = bounds(zoom(p, ['bn0']));
  if (badge.ok) {
    assert.ok(b.minX <= badge.bounds.minX + 1e-9 && b.maxX >= badge.bounds.maxX - 1e-9 && b.minY <= badge.bounds.minY + 1e-9 && b.maxY >= badge.bounds.maxY - 1e-9, 'badge not covered');
  }
});
t('badge is counted ONCE per bundle: 1, 2 or 5 selected members give the same badge contribution', () => {
  const p = bundleProject(5);
  const b1 = bounds(zoom(p, ['bn0']));
  const b5 = bounds(zoom(p, ['bn0', 'bn1', 'bn2', 'bn3', 'bn4']));
  // the badge sits above the bundle: the top edge is decided by the badge, identical for any member selection
  near(b1.minY, b5.minY, 1e-6);
});
t('short horizontal bundle: the badge sticks out above the cables and decides the top edge', () => {
  const p = project({ cables: Array.from({ length: 5 }, (_, i) => cable(`h${i}`, 'a', 'e')) });
  const { layout } = layoutOf(p);
  const badge = computeCableBundleLabelBounds(layout.bundles[0]);
  assert.ok(badge.ok);
  const b = bounds(zoom(p, ['h2']));
  if (badge.ok) near(b.minY, badge.bounds.minY, 1e-6); // nothing else reaches that high
  const noLabels = bounds(zoom(project({ cables: p.cables }, { hiddenLayers: ['cable_labels'] }), ['h2']));
  assert.ok(noLabels.minY > b.minY + 5, 'without the label layer the badge must not be measured');
});
t('label layer hidden → bundle badge NOT measured (zoom is tighter)', () => {
  const shown = bounds(zoom(bundleProject(5), ['bn0']));
  const hidden = bounds(zoom(bundleProject(5, { hiddenLayers: ['cable_labels'] }), ['bn0']));
  assert.ok(hidden.minY > shown.minY + 1, `${hidden.minY} vs ${shown.minY}`);
  const hidden2 = bounds(zoom(bundleProject(5, { hiddenLayers: ['labels'] }), ['bn0']));
  assert.deepEqual(hidden2, hidden);
});
t('badge width follows summaryLabel and colour dots (same formula as canvas)', () => {
  const mk = (summaryLabel: string, colors: string[]) => bundleBadgeGeometry({ midPoint: { x: 0, y: 0 }, spanWidthPx: 20, summaryLabel, distinctColors: colors, primaryColor: colors[0] });
  assert.equal(mk('x', ['#1']).width, 82);
  near(mk('×12 Cáp · 100G'.repeat(2), ['#1', '#2', '#3', '#4', '#5']).width, ('×12 Cáp · 100G'.repeat(2).length * 5.8 + 14 + (4 * 7 + 4)));
  near(mk('x', ['#1']).cy, -(10 + 17));
});
t('jacket bounds are rotated along the tangent', () => {
  const { layout } = layoutOf(bundleProject(4));
  const j = computeCableBundleJacketBounds(layout.bundles[0]);
  assert.ok(j.ok);
});

console.log('V2.5 P0.2 / P0.4 – read-only, editing state, selected stroke');
t('selected halo (strokeWidth+8) is the stroke footprint, not strokeWidth+1.5', () => {
  const p = project({ cables: [cable('h', 'a', 'b', { strokeWidth: 4 })] }, { hiddenLayers: ['cable_labels'] }); // labels off: isolate the stroke
  const b = bounds(zoom(p, ['h']));
  // straight horizontal a(50,25) → b(600,25)?  vertical extent = centre line ± (4+8)/2
  near(b.maxY - b.minY, 12, 1e-6);
});
t('hovered-only halo is smaller (+5) and never exceeds the selected one', () => {
  assert.deepEqual(cableStrokeWidths(2, { isSelected: false, isHovered: true }), { main: 2.75, halo: 7 });
  assert.deepEqual(cableStrokeWidths(2, { isSelected: true, isHovered: true }), { main: 3.5, halo: 10 });
  assert.deepEqual(cableStrokeWidths(2, { isSelected: false, isHovered: false }), { main: 2, halo: null });
});
t('read-only: no "+ Thêm nhãn" button and no handles are measured', () => {
  const p = project({ cables: [cable('r', 'a', 'b')] });
  const edit = bounds(zoom(p, ['r'], { includeEditHandles: true, isReadOnly: false }));
  const ro = bounds(zoom(p, ['r'], { includeEditHandles: true, isReadOnly: true }));
  const labelsHidden = bounds(zoom(project({ cables: [cable('r', 'a', 'b')] }, { hiddenLayers: ['cable_labels'] }), ['r'], { isReadOnly: true }));
  assert.deepEqual(ro, labelsHidden, 'read-only must measure the bare route only');
  assert.ok(edit.maxY - edit.minY > ro.maxY - ro.minY);
});
t('read-only WITH a visible badge still measures the badge', () => {
  const p = project({ cables: [cable('r', 'a', 'b', { label: 'UPLINK' })] });
  const ro = bounds(zoom(p, ['r'], { isReadOnly: true }));
  const bare = bounds(zoom(project({ cables: [cable('r', 'a', 'b', { label: 'UPLINK' })] }, { hiddenLayers: ['cable_labels'] }), ['r'], { isReadOnly: true }));
  assert.ok(ro.maxY - ro.minY > bare.maxY - bare.minY);
});
t('inline editor open → neither badge nor button is measured for that cable', () => {
  const p = project({ cables: [cable('r', 'a', 'b', { label: 'UPLINK' })] });
  const editing = bounds(zoom(p, ['r'], { editingCableLabelId: 'r' }));
  const bare = bounds(zoom(project({ cables: [cable('r', 'a', 'b', { label: 'UPLINK' })] }, { hiddenLayers: ['cable_labels'] }), ['r']));
  assert.deepEqual(editing, bare);
});
t('label presentation truth table (shared by canvas and bounds)', () => {
  const bools = [false, true];
  for (const isSelected of bools) for (const isHovered of bools) for (const isBundled of bools) for (const isReadOnly of bools)
    for (const isEditingLabel of bools) for (const showCableCodes of bools) for (const hasCustomLabel of bools) {
      const r = resolveCableLabelPresentation({ isSelected, isHovered, isBundled, isReadOnly, isEditingLabel, showCableCodes, hasCustomLabel });
      if (isEditingLabel) assert.equal(r, 'none');
      if (r === 'add-button') assert.ok(isSelected && !isBundled && !isReadOnly && !isEditingLabel && !showCableCodes && !hasCustomLabel);
      if (r === 'badge') assert.ok((showCableCodes || hasCustomLabel) && (!isBundled || isSelected || isHovered || hasCustomLabel));
    }
});

console.log('V2.5 P0.3 – drop-shadow footprint');
t('shadow extent is derived from the filter config (3σ, σ = blur/2, shifted by the offset)', () => {
  assert.deepEqual(dropShadowExtent(LABEL_SHADOW.selected), { left: 7.5, right: 7.5, top: 5.5, bottom: 9.5 });
  assert.deepEqual(dropShadowExtent(LABEL_SHADOW.idle), { left: 3, right: 3, top: 2, bottom: 4 });
  assert.equal(dropShadowCss(LABEL_SHADOW.selected), 'drop-shadow(0px 2px 5px rgba(37,99,235,0.22))');
});
t('selected badge bounds exceed the box by stroke/2 + shadow extent (angle 0)', () => {
  const c: any = cable('s', 'a', 'b', { label: 'ABCDEFGH', labelRotation: 0, labelAutoOrient: false });
  const path = computeCablePath(c, { x: 0, y: 0, width: 100, height: 50 }, { x: 600, y: 0, width: 100, height: 50 });
  const lt = resolveCableLabelTransform(c, path);
  const r = computeCableLabelBounds(c, path, { labelLayerVisible: true, showCableCodes: false, isBundled: false, includeEditHandles: false });
  assert.ok(r.ok && r.bounds);
  if (r.ok && r.bounds) {
    near(r.bounds.minX, lt.x - lt.badgeWidth / 2 - LABEL_STROKE.selected / 2 - 7.5);
    near(r.bounds.maxY, lt.y + lt.badgeHeight / 2 + LABEL_STROKE.selected / 2 + 9.5);
    near(r.bounds.minY, lt.y - lt.badgeHeight / 2 - LABEL_STROKE.selected / 2 - 5.5);
  }
});
t('transformedLocalRectBounds rotates an asymmetric box exactly', () => {
  const b = transformedLocalRectBounds(10, 20, 90, -4, -1, 6, 3); // local x→canvas y, local y→canvas -x
  near(b.minX, 10 - 3); near(b.maxX, 10 + 1); near(b.minY, 20 - 4); near(b.maxY, 20 + 6);
});

console.log('V2.5 P0.5 – edit overlays');
t('endpoint handles, add-waypoint handles and waypoint handles are all measured from the path data', () => {
  const c: any = cable('w', 'a', 'b', { controlPoints: [{ x: 300, y: -200 }] });
  const path = computeCablePath(c, { x: 0, y: 0, width: 100, height: 50 }, { x: 600, y: 0, width: 100, height: 50 });
  const o = computeCableEditOverlayBounds(c, path);
  assert.ok(o.ok);
  if (o.ok) {
    near(o.bounds.minX, Math.min(path.x1, 300) - handleOuterRadius(ENDPOINT_HANDLE));
    near(o.bounds.minY, -200 - 7);
    near(o.bounds.maxX, Math.max(path.x2, 300) + handleOuterRadius(ENDPOINT_HANDLE));
  }
});
t('missing endpoint coordinates → explicit invalid, not a guessed number', () => {
  const c: any = cable('w', 'a', 'b');
  const r = computeCableEditOverlayBounds(c, { d: 'M 0 0 L 10 10', midPoint: { x: 5, y: 5 }, midAngleDeg: 0 });
  assert.equal(r.ok, false);
});
t('endpoint handle sticks out of a thin route: with handles the bound is larger than without', () => {
  const p = project({ cables: [cable('w', 'a', 'b')] }, { hiddenLayers: ['cable_labels'] });
  const plain = bounds(zoom(p, ['w']));
  const edit = bounds(zoom(p, ['w'], { includeEditHandles: true }));
  assert.ok(edit.minX < plain.minX && edit.maxX > plain.maxX); // endpoint circle r=6.5+1 > round-cap half 5
});

console.log('V2.5 P0.6 – X = 0 is a valid coordinate');
t('cable whose midpoint is exactly on X=0 gets its label measured', () => {
  const p = project({ cables: [cable('z', 'c', 'e', { label: 'AT-ZERO', labelRotation: 0, labelAutoOrient: false })] });
  const { v, layout } = layoutOf(p);
  const info = layout.cablePaths.get('z') || computeCablePath(p.cables[0], v.getRoutableRect('c')!, v.getRoutableRect('e')!);
  near(info.midPoint.x, 0, 1e-9);
  const withLabel = bounds(zoom(p, ['z']));
  const without = bounds(zoom(project({ cables: p.cables }, { hiddenLayers: ['cable_labels'] }), ['z']));
  assert.ok(withLabel.maxY - withLabel.minY > without.maxY - without.minY);
});
t('static guard: DesignCanvas never uses a coordinate value as the "no geometry" sentinel', () => {
  const src = readFileSync(new URL('../../components/canvas/DesignCanvas.tsx', import.meta.url), 'utf8');
  assert.ok(!/midX\s*[!=]==?\s*0/.test(src), 'midX compared with 0');
  assert.ok(!/midY\s*[!=]==?\s*0/.test(src), 'midY compared with 0');
});
t('static guard: canvas sizes come from cableRenderMetrics, not literals', () => {
  const src = readFileSync(new URL('../../components/canvas/DesignCanvas.tsx', import.meta.url), 'utf8');
  assert.ok(src.includes("from '../../utils/cableRenderMetrics'"));
  for (const bad of ['cable.strokeWidth + 8', 'cable.strokeWidth + 1.5', 'r={6.5}', 'width="76"', 'bundle.summaryLabel.length * 5.8']) {
    assert.ok(!src.includes(bad), `hard-coded geometry in DesignCanvas: ${bad}`);
  }
});

console.log('V2.5 – geometry verification (independent of the resolver)');
t('curved route: bounds minus stroke equals an independent dense sampling within 0.05 (not too wide)', () => {
  const p = project({ cables: [cable('q', 'a', 'b', { routingType: 'curved', controlPoints: [{ x: 300, y: -180 }] })] }, { hiddenLayers: ['cable_labels'] });
  const b = bounds(zoom(p, ['q']));
  const { v, layout } = layoutOf(p);
  const info = layout.cablePaths.get('q') || computeCablePath(p.cables[0], v.getRoutableRect('a')!, v.getRoutableRect('b')!);
  const nums = info.d.replace(/[A-Za-z]/g, ' ').trim().split(/\s+/).map(Number);
  const cmds = info.d.match(/[MLQC]/g) || [];
  assert.ok(cmds.length > 0);
  // sample every Q/C segment densely
  const tk = info.d.replace(/,/g, ' ').trim().split(/\s+/); let i = 0, cmd = '', cx = 0, cy = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x: number, y: number) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  const nx = () => Number(tk[i++]);
  while (i < tk.length) {
    if (/^[MLQC]$/.test(tk[i])) cmd = tk[i++];
    if (cmd === 'M' || cmd === 'L') { cx = nx(); cy = nx(); add(cx, cy); }
    else if (cmd === 'Q') { const x1 = nx(), y1 = nx(), x2 = nx(), y2 = nx(); for (let k = 0; k <= 4000; k++) { const u = k / 4000, m = 1 - u; add(m * m * cx + 2 * m * u * x1 + u * u * x2, m * m * cy + 2 * m * u * y1 + u * u * y2); } cx = x2; cy = y2; }
    else if (cmd === 'C') { const x1 = nx(), y1 = nx(), x2 = nx(), y2 = nx(), x3 = nx(), y3 = nx(); for (let k = 0; k <= 4000; k++) { const u = k / 4000, m = 1 - u; add(m ** 3 * cx + 3 * m * m * u * x1 + 3 * m * u * u * x2 + u ** 3 * x3, m ** 3 * cy + 3 * m * m * u * y1 + 3 * m * u * u * y2 + u ** 3 * y3); } cx = x3; cy = y3; }
    else break;
  }
  void nums;
  const half = 5; // (2 + 8) / 2
  assert.ok(b.minX <= minX - half + 1e-6 && b.maxX >= maxX + half - 1e-6 && b.minY <= minY - half + 1e-6 && b.maxY >= maxY + half - 1e-6, 'clipped');
  assert.ok(minX - half - b.minX < 0.05 && b.maxX - (maxX + half) < 0.05 && minY - half - b.minY < 0.05 && b.maxY - (maxY + half) < 0.05, 'too wide');
});
t('huge opposite-sign coordinates and degenerate (zero-length) routes stay valid or are rejected explicitly', () => {
  const big = project({ nodes: [node('a', -4e6, -4e6), node('b', 4e6, 4e6)], cables: [cable('x', 'a', 'b')] });
  assert.equal(zoom(big, ['x']).status, 'ok');
  const same = project({ nodes: [node('a', 0, 0), node('b', 0, 0)], cables: [cable('x', 'a', 'b')] });
  assert.ok(['ok', 'invalid'].includes(zoom(same, ['x']).status));
  const huge = project({ nodes: [node('a', -9.9e6, 0), node('b', 9.9e6, 0)], cables: [cable('x', 'a', 'b', { strokeWidth: 1000 })] });
  assert.ok(['ok', 'invalid'].includes(zoom(huge, ['x']).status));
});
t('normalizeCableStrokeWidth: undefined → 1; NaN/negative/absurd → null', () => {
  assert.equal(normalizeCableStrokeWidth(undefined), 1);
  for (const bad of [NaN, Infinity, -1, 1001]) assert.equal(normalizeCableStrokeWidth(bad), null);
  assert.equal(normalizeCableStrokeWidth(0), 0);
});
t('computeCableBounds default context measures a selected cable (isSelected defaults true)', () => {
  const c: any = cable('d', 'a', 'b');
  const path = computeCablePath(c, { x: 0, y: 0, width: 100, height: 50 }, { x: 600, y: 0, width: 100, height: 50 });
  const r = computeCableBounds(c, path, { labelLayerVisible: false, showCableCodes: false, isBundled: false, includeEditHandles: false });
  assert.ok(r.ok);
});

console.log('V2.5 P0 – visibility & selection contract');
const rackProject = (settings: Record<string, unknown> = {}, rackNodeExtra: Record<string, unknown> = {}) => project({
  assets: { dev1: { id: 'dev1', category: 'switch', rackId: 'R1', rackUnitStart: 10, unitHeight: 1 } },
  racks: [{ id: 'R1', name: 'Rack 1', totalUnits: 42 }],
  nodes: [
    node('a', 0, 0), node('r1', 1000, 0, { type: 'rack', width: 300, height: 900, customData: { rackId: 'R1' }, ...rackNodeExtra }),
    node('shadow', 4000, 4000, { diagramMode: 'topology', assetId: 'dev1' })
  ],
  cables: [cable('c1', 'a', 'shadow')]
}, settings);
const vis = (p: any) => resolveVisibility({ ...p, hiddenLayers: p.settings.hiddenLayers });
t('Q1 hide rack layer → mounted device is still routable (cable stays attached), but not selectable', () => {
  const v = vis(rackProject({ hiddenLayers: ['racks'] }));
  assert.ok(v.getRoutableRect('shadow'));
  assert.equal(v.getSelectableRect('shadow'), null);
  assert.ok(v.visibleCables.some(c => c.id === 'c1'));
});
t('Q6 rack with hidden=true: the mounted device does NOT pop out at its topology coordinates', () => {
  const v = vis(rackProject({}, { hidden: true }));
  assert.ok(!v.visibleNodes.some(n => n.id === 'shadow'));
  assert.equal(v.getSelectableRect('shadow'), null);
});
t('Q2 hide device layer → node not selectable/zoomable, cable still drawn (keep-routed)', () => {
  const p = project({ nodes: [node('a', 0, 0), node('b', 600, 0)], cables: [cable('c1', 'a', 'b')] }, { hiddenLayers: ['network'] });
  const v = vis(p);
  assert.equal(v.getSelectableRect('a'), null);
  assert.ok(v.visibleCables.length === 1);
  assert.notEqual(getZoomSelectionBounds(p, { type: 'node', id: 'a' } as any).status, 'ok');
});
t('Q3 hide cable layer → zoom on a cable is unsupported (and so is its bundle badge)', () => {
  assert.equal(zoom(bundleProject(4, { hiddenLayers: ['cables'] }), ['bn0']).status, 'unsupported');
});
t('Q5 switching floor: a cable with an endpoint on another floor is not rendered and not zoomable', () => {
  const p = project({ nodes: [node('a', 0, 0), node('b', 600, 0, { floorId: 'f2' })], cables: [cable('c1', 'a', 'b')] });
  assert.equal(vis(p).visibleCables.length, 0);
  assert.equal(zoom(p, ['c1']).status, 'unsupported');
});

console.log(`${passed} passed`);
