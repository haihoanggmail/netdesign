import assert from 'node:assert/strict';
import { getZoomSelectionBounds } from '../selectionBounds';
import { svgPathBounds, boundsOfValidRects } from '../geometryResolver';
import { computeVisibleNodes, computeVisibleRooms } from '../visibilityResolver';

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
  settings: { hiddenLayers: [] },
  assets: {
    'asset-in-rack': { id: 'asset-in-rack', category: 'switch', rackId: 'R1', rackUnitStart: 10, unitHeight: 1 }
  },
  racks: [{ id: 'R1', name: 'Rack 1', totalUnits: 42 }],
  nodes: [
    node('a', 0, 0),
    node('b', 500, 300),
    node('other-floor', 900, 900, { floorId: 'f2' }),
    node('hidden-flag', 700, 700, { hidden: true }),
    node('lan', 200, 200, { layerId: 'network' }),
    node('rn', 1000, 100, { type: 'rack', width: 300, height: 900, customData: { rackId: 'R1' } }),
    // topology shadow of a device mounted in rack R1 (far away from the rack on purpose)
    node('shadow', 4000, 4000, { diagramMode: 'topology', assetId: 'asset-in-rack' })
  ],
  rooms: [
    { id: 'room1', floorId: 'f1', x: 10, y: 20, width: 300, height: 200 },
    { id: 'room2', floorId: 'f2', x: 0, y: 0, width: 50, height: 50 }
  ],
  cables: [cable('c1', 'a', 'b'), cable('c2', 'a', 'other-floor'), cable('c3', 'a', 'lan'), cable('c4', 'a', 'ghost')],
  ...over
});

console.log('selectionBounds');

t('single and multi node', () => {
  const r1 = getZoomSelectionBounds(project(), { type: 'node', id: 'a' });
  assert.equal(r1.status, 'ok');
  assert.deepEqual(r1.bounds, { minX: 0, minY: 0, maxX: 100, maxY: 50 });
  const r2 = getZoomSelectionBounds(project(), { type: 'node', id: 'a', additionalIds: ['b'] });
  assert.deepEqual(r2.bounds, { minX: 0, minY: 0, maxX: 600, maxY: 350 });
});

t('floor filter applies only in floor-scoped modes (same rule as canvas) – nodes AND rooms', () => {
  const fp = project();
  assert.equal(getZoomSelectionBounds(fp, { type: 'node', id: 'other-floor' }).status, 'unsupported');
  assert.equal(getZoomSelectionBounds(fp, { type: 'room', id: 'room2' }).status, 'unsupported');
  const topo = project({ activeMode: 'topology' });
  // canvas shows both in topology, so zoom must too
  assert.equal(getZoomSelectionBounds(topo, { type: 'node', id: 'other-floor' }).status, 'ok');
  assert.equal(getZoomSelectionBounds(topo, { type: 'room', id: 'room2' }).status, 'ok');
});

t('selection agrees with the canvas visible lists for every node and room', () => {
  for (const mode of ['floorplan', 'topology', 'cctv', 'rack']) {
    const p = project({ activeMode: mode });
    const vis = new Set(computeVisibleNodes(p).map((n: any) => n.id));
    const visRooms = new Set(computeVisibleRooms({ ...p, hiddenLayers: [] }).map((r: any) => r.id));
    for (const n of p.nodes) {
      const r = getZoomSelectionBounds(p, { type: 'node', id: n.id });
      if (!vis.has(n.id) && n.id !== 'shadow') assert.notEqual(r.status, 'ok', `${mode}:${n.id}`);
    }
    for (const room of p.rooms) {
      const r = getZoomSelectionBounds(p, { type: 'room', id: room.id });
      assert.equal(r.status === 'ok', visRooms.has(room.id), `${mode}:${room.id}`);
    }
  }
});

t('device mounted in a rack (shadow node) zooms to its slot INSIDE the rack, not to the hidden node', () => {
  const r = getZoomSelectionBounds(project(), { type: 'node', id: 'shadow' });
  assert.equal(r.status, 'ok');
  assert.ok(r.bounds && r.bounds.minX >= 1000 && r.bounds.maxX <= 1300 && r.bounds.minY >= 100 && r.bounds.maxY <= 1000, JSON.stringify(r.bounds));
  assert.ok(r.bounds!.minX < 4000);
});

t('hidden layer hides its objects; racks layer hides rack-mounted device', () => {
  assert.equal(getZoomSelectionBounds(project({ settings: { hiddenLayers: ['network'] } }), { type: 'node', id: 'lan' }).status, 'unsupported');
  assert.equal(getZoomSelectionBounds(project({ settings: { hiddenLayers: ['racks'] } }), { type: 'rack', id: 'R1' }).status, 'unsupported');
  assert.equal(getZoomSelectionBounds(project({ settings: { hiddenLayers: ['rooms'] } }), { type: 'room', id: 'room1' }).status, 'unsupported');
});

t('mixed selection reports omitted objects instead of silently zooming', () => {
  const r = getZoomSelectionBounds(project(), { type: 'node', id: 'a', additionalIds: ['other-floor'] });
  assert.equal(r.status, 'ok');
  assert.equal((r as any).omitted, 1);
});

t('rack selection resolves through node_<rackId> or node id', () => {
  const p = project({ nodes: [node('node_R1', 100, 400, { type: 'rack', customData: { rackId: 'R1' } })] });
  assert.equal(getZoomSelectionBounds(p, { type: 'rack', id: 'R1' }).status, 'ok');
});

t('invalid geometry never poisons the result', () => {
  const p = project({ nodes: [node('ok', 10, 10), node('nan', NaN, 0), node('inf', 0, Infinity), node('neg', 0, 0, { width: -5 }), node('huge', 1e12, 0)] });
  const r = getZoomSelectionBounds(p, { type: 'node', id: 'ok', additionalIds: ['nan', 'inf', 'neg', 'huge'] });
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.bounds, { minX: 10, minY: 10, maxX: 110, maxY: 60 });
  assert.equal((r as any).omitted, 4);
  const only = getZoomSelectionBounds(p, { type: 'node', id: 'nan' });
  assert.equal(only.status, 'invalid');
  assert.equal(boundsOfValidRects([{ x: 0, y: 0, width: NaN, height: 1 }]).bounds, null);
});

t('straight cable covers both endpoints (+ stroke padding)', () => {
  const r = getZoomSelectionBounds(project(), { type: 'edge', id: 'c1' });
  assert.equal(r.status, 'ok');
  // endpoints are node centres: (50,25) → (550,325)
  assert.ok(r.bounds!.minX <= 50 && r.bounds!.maxX >= 550 && r.bounds!.minY <= 25 && r.bounds!.maxY >= 325);
});

t('cable with control points: bounds include the real route, not just the endpoint rectangle', () => {
  const p = project({
    cables: [cable('cc', 'a', 'b', { routingType: 'curved', controlPoints: [{ x: 250, y: -400 }, { x: 300, y: 900 }] })]
  });
  const r = getZoomSelectionBounds(p, { type: 'edge', id: 'cc' });
  assert.equal(r.status, 'ok');
  // route goes well above y=0 and below y=325, outside the endpoint rect
  assert.ok(r.bounds!.minY < -100, `minY=${r.bounds!.minY}`);
  assert.ok(r.bounds!.maxY > 400, `maxY=${r.bounds!.maxY}`);
});

t('orthogonal and manual polyline cables include every bend', () => {
  const p = project({
    cables: [cable('po', 'a', 'b', { routingType: 'orthogonal', controlPoints: [{ x: -300, y: 25 }, { x: -300, y: 700 }] })]
  });
  const r = getZoomSelectionBounds(p, { type: 'edge', id: 'po' });
  assert.equal(r.status, 'ok');
  assert.ok(r.bounds!.minX <= -300 && r.bounds!.maxY >= 700);
});

t('multiple cables sharing an endpoint: union of all routes', () => {
  const p = project({ nodes: [node('a', 0, 0), node('b', 500, 300), node('c', 0, 800)], cables: [cable('x1', 'a', 'b'), cable('x2', 'a', 'c')] });
  const r = getZoomSelectionBounds(p, { type: 'edge', id: 'x1', additionalIds: ['x2'] });
  assert.equal(r.status, 'ok');
  assert.ok(r.bounds!.maxX >= 550 && r.bounds!.maxY >= 825);
});

t('cable is strict: hidden layer, endpoint off-floor, endpoint missing, partial multi-select → unavailable with reason', () => {
  assert.equal(getZoomSelectionBounds(project({ settings: { hiddenLayers: ['cables'] } }), { type: 'edge', id: 'c1' }).status, 'unsupported');
  assert.equal(getZoomSelectionBounds(project(), { type: 'edge', id: 'c2' }).status, 'unsupported');
  assert.equal(getZoomSelectionBounds(project(), { type: 'edge', id: 'c4' }).status, 'unsupported');
  const partial = getZoomSelectionBounds(project(), { type: 'edge', id: 'c1', additionalIds: ['c2'] });
  assert.equal(partial.status, 'unsupported');
  assert.ok(partial.reason.length > 0); // assert.equal ở trên đã thu hẹp kiểu về 'unsupported'
});

t('cable whose endpoint is rack-mounted resolves to the slot inside the rack', () => {
  const p = project({ cables: [cable('cr', 'a', 'shadow')] });
  const r = getZoomSelectionBounds(p, { type: 'edge', id: 'cr' });
  assert.equal(r.status, 'ok');
  assert.ok(r.bounds!.maxX < 2000, `maxX=${r.bounds!.maxX}`);
});

t('locked objects can still be zoomed to', () => {
  const p = project({ nodes: [node('lk', 5, 5, { locked: true })] });
  assert.equal(getZoomSelectionBounds(p, { type: 'node', id: 'lk' }).status, 'ok');
});

t('empty selection and unsupported type give a reason', () => {
  for (const sel of [{ type: 'none' }, { type: 'tray', id: 't' }, { type: 'floor', id: 'f1' }] as any[]) {
    const r = getZoomSelectionBounds(project(), sel);
    assert.equal(r.status, 'unsupported');
    assert.ok(r.status === 'unsupported' && r.reason.length > 0);
  }
});

console.log('geometryResolver.svgPathBounds');

t('cubic Bezier extrema beyond endpoints and control hull handled exactly', () => {
  // M 0 0 C 0 100, 100 100, 100 0 → max y = 75 at t=.5, control points reach 100
  const b = svgPathBounds('M 0 0 C 0 100, 100 100, 100 0')!;
  near(b.minX, 0); near(b.maxX, 100); near(b.minY, 0); near(b.maxY, 75);
});
t('quadratic Bezier and polyline', () => {
  const q = svgPathBounds('M 0 0 Q 50 100 100 0')!;
  near(q.maxY, 50);
  const l = svgPathBounds('M 10 20 L 30 -5 L 40 60')!;
  assert.deepEqual(l, { minX: 10, minY: -5, maxX: 40, maxY: 60 });
});
t('malformed or non-finite paths return null', () => {
  assert.equal(svgPathBounds(''), null);
  assert.equal(svgPathBounds('M NaN 1 L 2 3'), null);
  assert.equal(svgPathBounds('Q 1 2 3 4'), null);
});

console.log(`${passed} passed`);
