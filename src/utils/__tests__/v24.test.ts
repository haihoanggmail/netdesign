import assert from 'node:assert/strict';
import { getZoomSelectionBounds } from '../selectionBounds';
import { parseSvgPathBounds, svgPathBounds, rotatedRectBounds, MAX_ABS_COORD } from '../geometryResolver';
import { resolveVisibility } from '../visibilityResolver';
import { computeCableBundleLayout } from '../cableRouting';
import { normalizeViewportTransform, reduceViewport, MIN_ZOOM, MAX_ZOOM } from '../viewportMath';

let passed = 0;
function t(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !≈ ${b}`);

const node = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({
  id, type: 'device', x, y, width: 100, height: 50, diagramMode: 'floorplan', floorId: 'f1', ...extra
});
const cable = (id: string, s: string, tg: string, extra: Record<string, unknown> = {}) => ({
  id, cableCode: id, sourceNodeId: s, targetNodeId: tg, routingType: 'straight', strokeWidth: 2, ...extra
});
const project = (over: Record<string, unknown> = {}): any => ({
  activeMode: 'floorplan',
  activeFloorId: 'f1',
  settings: { hiddenLayers: [], showCableCodes: false },
  assets: { 'asset-in-rack': { id: 'asset-in-rack', category: 'switch', rackId: 'R1', rackUnitStart: 10, unitHeight: 1 } },
  racks: [{ id: 'R1', name: 'Rack 1', totalUnits: 42 }],
  nodes: [
    node('a', 0, 0), node('b', 500, 300), node('near', 150, 0),
    node('rn', 1000, 100, { type: 'rack', width: 300, height: 900, customData: { rackId: 'R1' } }),
    node('shadow', 4000, 4000, { diagramMode: 'topology', assetId: 'asset-in-rack' })
  ],
  rooms: [],
  cables: [],
  ...over
});
const edge = (id: string, extra: any = {}, p = project()) => getZoomSelectionBounds(p, { type: 'edge', id, ...extra } as any);

// independent cubic/quadratic sampler (does NOT share code with geometryResolver)
function samplePath(d: string): Array<[number, number]> {
  const tk = d.replace(/,/g, ' ').trim().split(/\s+/);
  const pts: Array<[number, number]> = [];
  let i = 0, cmd = '', cx = 0, cy = 0;
  const n = () => Number(tk[i++]);
  while (i < tk.length) {
    if (/^[MLQC]$/.test(tk[i])) cmd = tk[i++];
    if (cmd === 'M' || cmd === 'L') { cx = n(); cy = n(); pts.push([cx, cy]); }
    else if (cmd === 'Q') {
      const x1 = n(), y1 = n(), x2 = n(), y2 = n();
      for (let k = 1; k <= 2000; k++) { const u = k / 2000, m = 1 - u;
        pts.push([m * m * cx + 2 * m * u * x1 + u * u * x2, m * m * cy + 2 * m * u * y1 + u * u * y2]); }
      cx = x2; cy = y2;
    } else if (cmd === 'C') {
      const x1 = n(), y1 = n(), x2 = n(), y2 = n(), x3 = n(), y3 = n();
      for (let k = 1; k <= 2000; k++) { const u = k / 2000, m = 1 - u;
        pts.push([m ** 3 * cx + 3 * m * m * u * x1 + 3 * m * u * u * x2 + u ** 3 * x3,
                  m ** 3 * cy + 3 * m * m * u * y1 + 3 * m * u * u * y2 + u ** 3 * y3]); }
      cx = x3; cy = y3;
    }
  }
  return pts;
}

console.log('V2.4 P0.1 – cable label bounds come from the real label box');

t('T04 long label (360px badge) is not cut off', () => {
  // a,near centres are only 150px apart; a 360px label must stick out on both sides of the route
  const p = project({ cables: [cable('c', 'a', 'near', { label: 'x'.repeat(200), labelRotation: 0, labelAutoOrient: false })] });
  const r = edge('c', {}, p);
  assert.equal(r.status, 'ok');
  // mid = (125,25); badge width 360 → [-55, 305] (+ outline margin)
  assert.ok(r.bounds!.minX <= -55 && r.bounds!.maxX >= 305, JSON.stringify(r.bounds));
});

t('T05 label rotated 90° is covered vertically', () => {
  const p = project({ cables: [cable('c', 'a', 'b', { label: 'x'.repeat(200), labelRotation: 90, labelAutoOrient: false })] });
  const r = edge('c', {}, p);
  assert.equal(r.status, 'ok');
  // path y ∈ [25,325], mid y = 175, rotated badge half-height 180 → [-5, 355]
  assert.ok(r.bounds!.minY <= -5 && r.bounds!.maxY >= 355, JSON.stringify(r.bounds));
});

t('rotatedRectBounds is exact for 0°, 90°, 45°', () => {
  const z = rotatedRectBounds(0, 0, 100, 20, 0);
  near(z.maxX, 50); near(z.maxY, 10);
  const n90 = rotatedRectBounds(0, 0, 100, 20, 90);
  near(n90.maxX, 10); near(n90.maxY, 50);
  const d = rotatedRectBounds(0, 0, 100, 20, 45);
  near(d.maxX, (50 + 10) * Math.SQRT1_2); near(d.maxY, (50 + 10) * Math.SQRT1_2);
});

t('label layer hidden → label NOT added; shown → added; handles only when editing', () => {
  const base = project({ cables: [cable('c', 'a', 'near', { label: 'x'.repeat(200), labelRotation: 0, labelAutoOrient: false })] });
  const withLbl = edge('c', {}, base).bounds!;
  const hiddenCable = project({ ...base, settings: { hiddenLayers: ['cable_labels'] } });
  const noLbl = edge('c', {}, hiddenCable).bounds!;
  assert.ok(noLbl.maxX - noLbl.minX < withLbl.maxX - withLbl.minX);
  const hiddenLabels = project({ ...base, settings: { hiddenLayers: ['labels'] } });
  assert.deepEqual(edge('c', {}, hiddenLabels).bounds, noLbl);
  // handles
  // label layer hidden here so that only the handle effect is measured (the 'add label' box would otherwise dominate)
  const cp = project({ settings: { hiddenLayers: ['cable_labels'] }, cables: [cable('c', 'a', 'near', { controlPoints: [{ x: 75, y: -200 }] })] });
  const plain = getZoomSelectionBounds(cp, { type: 'edge', id: 'c' } as any).bounds!;
  const edit = getZoomSelectionBounds(cp, { type: 'edge', id: 'c' } as any, { includeEditHandles: true }).bounds!;
  near(plain.minY, -205); near(edit.minY, -207); // V2.5: selected halo (strokeWidth+8 → half 5) vs waypoint handle radius 7
});

console.log('V2.4 P0.2 / P0.3 – invalid data is rejected with a reason');

t('T06 control point at 1e12 → invalid', () => {
  const p = project({ cables: [cable('c', 'a', 'b', { controlPoints: [{ x: 1e12, y: 0 }] })] });
  const r = edge('c', {}, p);
  assert.equal(r.status, 'invalid');
  assert.ok(r.status === 'invalid' && r.reason.length > 0);
  for (const rt of ['curved', 'orthogonal']) {
    assert.equal(edge('c', {}, project({ cables: [cable('c', 'a', 'b', { routingType: rt, controlPoints: [{ x: 1e12, y: 5 }, { x: 1, y: 1 }] })] })).status, 'invalid');
  }
});

t('T07 strokeWidth Infinity / NaN / negative / absurd → invalid', () => {
  for (const sw of [Infinity, -Infinity, NaN, -3, 1e9]) {
    const r = edge('c', {}, project({ cables: [cable('c', 'a', 'b', { strokeWidth: sw })] }));
    assert.equal(r.status, 'invalid', `strokeWidth=${sw}`);
  }
  assert.equal(edge('c', {}, project({ cables: [cable('c', 'a', 'b', { strokeWidth: undefined })] })).status, 'ok');
});

t('final bounds after stroke+label+padding must stay inside MAX_ABS_COORD', () => {
  // far's centre is at MAX-10: the route itself is legal, but stroke (≈20px) + label push the bounds over the limit
  const p = project({ nodes: [node('a', 0, 0), node('far', MAX_ABS_COORD - 60, 0)], cables: [cable('c', 'a', 'far', { label: 'x', strokeWidth: 40 })] });
  const r = edge('c', {}, p);
  assert.equal(r.status, 'invalid'); // endpoint rect is fine, padding pushes it over the limit
  assert.ok(r.status === 'invalid' && /giới hạn/.test(r.reason));
});

t('node/rack beyond coordinate limit is invalid, not zoomed to', () => {
  const p = project({ nodes: [node('huge', 1e12, 0)] });
  assert.equal(getZoomSelectionBounds(p, { type: 'node', id: 'huge' }).status, 'invalid');
});

console.log('V2.4 P1 – strict SVG path parser');

t('T08 missing / extra arguments are rejected (never mis-measured)', () => {
  for (const d of ['M 0 0 L 10', 'M 0 0 L 10 20 30', 'M 0 0 Q 1 2 3', 'M 0 0 C 1 2 3 4 5', 'M 1', 'M 0 0 L']) {
    assert.equal(parseSvgPathBounds(d).ok, false, d);
  }
});
t('unsupported / relative / stray characters are rejected with a reason', () => {
  for (const d of ['M 0 0 Z', 'M 0 0 S 1 2 3 4', 'M 0 0 H 5', 'M 0 0 V 5', 'M 0 0 A 1 1 0 0 0 5 5', 'm 0 0 l 5 5',
    'M 0 0 L 1 x', 'M NaN 0 L 1 1', 'M 0 0 L Infinity 1', 'L 1 2', 'M 0 0 # 5 5', 'Q 1 2 3 4']) {
    const r = parseSvgPathBounds(d);
    assert.equal(r.ok, false, d);
    assert.ok(!r.ok && r.reason.length > 0);
  }
});
t('accepts what computeCablePath emits: exponents, commas, implicit repeats, negative', () => {
  assert.deepEqual(svgPathBounds('M 1e-7 2 L 3.5 -4'), { minX: 1e-7, minY: -4, maxX: 3.5, maxY: 2 });
  assert.deepEqual(svgPathBounds('M 0,0 L 10,10 20,5'), { minX: 0, minY: 0, maxX: 20, maxY: 10 });
  assert.ok(svgPathBounds('M 0 0 C 1 2, 3 4, 5 6 7 8, 9 10, 11 12'));
  assert.equal(svgPathBounds('M 0 0 L 1e+12 5'), null); // beyond MAX_ABS_COORD
});

console.log('V2.4 P1 – path shapes: bounds vs independently sampled real route');

const shapes: Array<[string, any]> = [
  ['curved, 1 control point (quadratic)', { routingType: 'curved', controlPoints: [{ x: 250, y: -150 }] }],
  ['curved, many control points (Catmull-Rom → several cubics)', { routingType: 'curved', controlPoints: [{ x: 100, y: -200 }, { x: 300, y: 400 }, { x: 420, y: -100 }, { x: 480, y: 500 }] }],
  ['curved, no control points (default cubic)', { routingType: 'curved' }],
  ['orthogonal, many bends', { routingType: 'orthogonal', controlPoints: [{ x: 100, y: 200 }, { x: 350, y: -80 }, { x: 600, y: 420 }] }],
  ['orthogonal, default elbow', { routingType: 'orthogonal' }],
  ['straight with manual polyline', { routingType: 'straight', controlPoints: [{ x: 10, y: 400 }, { x: 700, y: 20 }] }]
];
for (const [name, extra] of shapes) {
  t(`shape: ${name}`, () => {
    const p = project({ cables: [cable('c', 'a', 'b', extra)] });
    const vis = resolveVisibility({ ...p, hiddenLayers: [] });
    const layout = computeCableBundleLayout(vis.visibleCables, vis.getRoutableRect);
    const d = layout.cablePaths.get('c')!.d;
    const pts = samplePath(d);
    const sx = pts.map(q => q[0]), sy = pts.map(q => q[1]);
    const real = { minX: Math.min(...sx), maxX: Math.max(...sx), minY: Math.min(...sy), maxY: Math.max(...sy) };
    const pb = parseSvgPathBounds(d);
    assert.ok(pb.ok);
    if (!pb.ok) return;
    // never cut (≥ sampled), and tight (within 0.5 px of dense sampling)
    for (const k of ['minX', 'minY'] as const) { assert.ok(pb.bounds[k] <= real[k] + 1e-6, `${k} cut`); assert.ok(real[k] - pb.bounds[k] < 0.5, `${k} loose`); }
    for (const k of ['maxX', 'maxY'] as const) { assert.ok(pb.bounds[k] >= real[k] - 1e-6, `${k} cut`); assert.ok(pb.bounds[k] - real[k] < 0.5, `${k} loose`); }
    // and the zoom result covers the whole route
    const z = edge('c', {}, p);
    assert.equal(z.status, 'ok');
    for (const [x, y] of pts) assert.ok(x >= z.bounds!.minX && x <= z.bounds!.maxX && y >= z.bounds!.minY && y <= z.bounds!.maxY);
  });
}

t('reverse direction (B→A) gives the same bounds as A→B for a symmetric straight route', () => {
  const f = edge('c', {}, project({ cables: [cable('c', 'a', 'b')] }));
  const r = edge('c', {}, project({ cables: [cable('c', 'b', 'a')] }));
  assert.deepEqual(f.bounds, r.bounds);
});

t('very long, zero-length and near-vertical routes stay finite and ok', () => {
  const long = edge('c', {}, project({ nodes: [node('a', 0, 0), node('b', 9e6, 9e6)], cables: [cable('c', 'a', 'b')] }));
  assert.equal(long.status, 'ok');
  const zero = edge('c', {}, project({ nodes: [node('a', 5, 5), node('b', 5, 5)], cables: [cable('c', 'a', 'b')] }));
  assert.equal(zero.status, 'ok');
  const vert = edge('c', {}, project({ nodes: [node('a', 0, 0), node('b', 0.001, 800)], cables: [cable('c', 'a', 'b', { routingType: 'curved' })] }));
  assert.equal(vert.status, 'ok');
  for (const r of [long, zero, vert]) assert.ok(Object.values(r.bounds!).every(Number.isFinite));
});

t('T09 bundle with more than 6 cables: selecting all covers every route', () => {
  const cs = Array.from({ length: 9 }, (_, i) => cable(`b${i}`, 'a', 'b', { label: `link-${i}` }));
  const p = project({ cables: cs });
  const vis = resolveVisibility({ ...p, hiddenLayers: [] });
  const layout = computeCableBundleLayout(vis.visibleCables, vis.getRoutableRect);
  const r = getZoomSelectionBounds(p, { type: 'edge', id: 'b0', additionalIds: cs.slice(1).map(c => c.id) } as any);
  assert.equal(r.status, 'ok');
  for (const c of cs) {
    for (const [x, y] of samplePath(layout.cablePaths.get(c.id)!.d)) {
      assert.ok(x >= r.bounds!.minX - 1e-6 && x <= r.bounds!.maxX + 1e-6 && y >= r.bounds!.minY - 1e-6 && y <= r.bounds!.maxY + 1e-6, `${c.id} cut`);
    }
  }
});

console.log('V2.4 P0.4 – visibility contract (rendered / routable / selectable)');

t('T02 layer of a device hidden: object not selectable, cable stays and is zoomable (keep-routed)', () => {
  const net = project().nodes.map((n: any) => (n.id === 'a' || n.id === 'b' ? { ...n, layerId: 'network' } : n));
  const p = project({ nodes: net, cables: [cable('c', 'a', 'b')], settings: { hiddenLayers: ['network'] } });
  const vis = resolveVisibility({ ...p, hiddenLayers: ['network'] });
  assert.equal(vis.isNodeRendered('a'), false);
  assert.ok(vis.getRoutableRect('a'));
  assert.equal(vis.getSelectableRect('a'), null);
  assert.deepEqual(vis.visibleCables.map(c => c.id), ['c']);
  assert.equal(getZoomSelectionBounds(p, { type: 'node', id: 'a' }).status, 'unsupported');
  assert.equal(edge('c', {}, p).status, 'ok');
});

t('T03 racks layer hidden: cable to the rack AND cable to a rack-mounted device behave the same (both stay)', () => {
  const p = project({ cables: [cable('c1', 'a', 'rn'), cable('c2', 'a', 'shadow')], settings: { hiddenLayers: ['racks'] } });
  const vis = resolveVisibility({ ...p, hiddenLayers: ['racks'] });
  assert.deepEqual(vis.visibleCables.map(c => c.id).sort(), ['c1', 'c2']);
  assert.equal(vis.isNodeRendered('rn'), false);
  assert.equal(vis.isNodeRendered('shadow'), false); // drawn inside a rack that is not drawn
  assert.equal(getZoomSelectionBounds(p, { type: 'rack', id: 'rn' }).status, 'unsupported');
  assert.equal(getZoomSelectionBounds(p, { type: 'node', id: 'shadow' }).status, 'unsupported');
  assert.equal(edge('c2', {}, p).status, 'ok');
});

t('T01 rack hidden by flag: mounted device has no geometry → cable disappears, zoom refuses (no stale position)', () => {
  const p = project({
    nodes: project().nodes.map((n: any) => (n.id === 'rn' ? { ...n, hidden: true } : n)),
    cables: [cable('c', 'a', 'shadow')]
  });
  const vis = resolveVisibility({ ...p, hiddenLayers: [] });
  assert.equal(vis.getRoutableRect('shadow'), null);
  assert.equal(vis.visibleCables.length, 0);
  assert.equal(getZoomSelectionBounds(p, { type: 'node', id: 'shadow' }).status, 'unsupported');
  assert.equal(edge('c', {}, p).status, 'unsupported');
});

t('mounted device whose own layer is hidden: not rendered even though its rack is drawn', () => {
  const nodes = project().nodes.map((n: any) => (n.id === 'shadow' ? { ...n, layerId: 'network' } : n));
  const vis = resolveVisibility({ ...project({ nodes }), hiddenLayers: ['network'] });
  assert.equal(vis.isNodeRendered('rn'), true);
  assert.equal(vis.isNodeRendered('shadow'), false);
  assert.ok(vis.getRoutableRect('shadow'));
});

t('T11 switching floors repeatedly never reuses a stale result', () => {
  const base = project({
    nodes: [node('a', 0, 0, { floorId: 'f1' }), node('b', 700, 0, { floorId: 'f2' })],
    rooms: [{ id: 'r1', floorId: 'f1', x: 0, y: 0, width: 10, height: 10 }, { id: 'r2', floorId: 'f2', x: 700, y: 0, width: 10, height: 10 }]
  });
  for (let i = 0; i < 20; i++) {
    const floor = i % 2 === 0 ? 'f1' : 'f2';
    const p = { ...base, activeFloorId: floor };
    const mine = floor === 'f1' ? 'a' : 'b';
    const other = floor === 'f1' ? 'b' : 'a';
    assert.equal(getZoomSelectionBounds(p, { type: 'node', id: mine }).status, 'ok');
    assert.equal(getZoomSelectionBounds(p, { type: 'node', id: other }).status, 'unsupported');
  }
});

console.log('V2.4 P0 – viewport state invariants');

t('normalizeViewportTransform rejects NaN/Infinity/missing/garbage, clamps finite zoom', () => {
  const bad: unknown[] = [null, undefined, 5, 'x', {}, { zoom: 1 }, { pan: { x: 0, y: 0 } }, { zoom: NaN, pan: { x: 0, y: 0 } },
    { zoom: Infinity, pan: { x: 0, y: 0 } }, { zoom: 0, pan: { x: 0, y: 0 } }, { zoom: -1, pan: { x: 0, y: 0 } },
    { zoom: 1, pan: { x: NaN, y: 0 } }, { zoom: 1, pan: { x: 0, y: Infinity } }, { zoom: 1, pan: { x: '1', y: 0 } },
    { zoom: 1, pan: null }, { zoom: 1, pan: { x: 1e12, y: 0 } }];
  for (const b of bad) assert.equal(normalizeViewportTransform(b), null, JSON.stringify(b));
  assert.equal(normalizeViewportTransform({ zoom: 99, pan: { x: 1, y: 2 } })!.zoom, MAX_ZOOM);
  assert.equal(normalizeViewportTransform({ zoom: 0.001, pan: { x: 1, y: 2 } })!.zoom, MIN_ZOOM);
});

t('reduceViewport: invalid input keeps the SAME previous state; unchanged value keeps reference', () => {
  const prev = { zoom: 1.5, pan: { x: 10, y: 20 } };
  assert.equal(reduceViewport(prev, { zoom: NaN, pan: { x: 0, y: 0 } }), prev);
  assert.equal(reduceViewport(prev, { zoom: 2 } as any), prev);
  assert.equal(reduceViewport(prev, { zoom: 1.5, pan: { x: 10, y: 20 } }), prev);
  const next = reduceViewport(prev, { zoom: 2, pan: { x: 0, y: 0 } });
  assert.deepEqual(next, { zoom: 2, pan: { x: 0, y: 0 } });
});

t('legacy single-field setters (setZoom/setPan) cannot corrupt state', () => {
  let state = { zoom: 1, pan: { x: 5, y: 5 } };
  const setZoom = (z: number) => { state = reduceViewport(state, { zoom: z, pan: state.pan }); };
  const setPan = (p: { x: number; y: number }) => { state = reduceViewport(state, { zoom: state.zoom, pan: p }); };
  setZoom(NaN); setZoom(Infinity); setPan({ x: NaN, y: 1 }); setPan(undefined as any);
  assert.deepEqual(state, { zoom: 1, pan: { x: 5, y: 5 } });
  setZoom(50); assert.equal(state.zoom, MAX_ZOOM);
  setPan({ x: -40, y: 9 }); assert.deepEqual(state.pan, { x: -40, y: 9 });
});

console.log(`${passed} passed`);
