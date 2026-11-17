/**
 * Pure-compute performance gate for Zoom-to-Selection (Node; NOT React render/paint – see e2e/perf-browser.spec.ts for that).
 * Reports median / p95 / p99, heap growth and GC time per case, on random AND designed worst-case datasets.
 * Run: tsx src/utils/__tests__/perf.bench.ts [--enforce] [--json=path]
 * Budgets (p95, ms) are the V2.5 targets and are enforced for EVERY case when --enforce is given.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { PerformanceObserver, performance } from 'node:perf_hooks';
import { getZoomSelectionBounds } from '../selectionBounds';
import { resolveVisibility } from '../visibilityResolver';
import { computeCableBundleLayout } from '../cableRouting';

const ENFORCE = process.argv.includes('--enforce');
const JSON_OUT = process.argv.find(a => a.startsWith('--json='))?.slice(7);
const RUNS = 40;
/** p95 budgets in ms */
const BUDGET = { zoomNode: 50, zoomCable: 50, zoom50: 100, zoomBundle: 100, visibility: 25, bundleLayout: 100 } as const;

let gcMs = 0;
const gcObs = new PerformanceObserver(() => { /* entries are drained synchronously via takeRecords() below */ });
gcObs.observe({ entryTypes: ['gc'] });
const drainGc = () => { for (const e of gcObs.takeRecords()) gcMs += e.duration; };

type Kind = 'straight' | 'curved' | 'orthogonal';
const kinds: Kind[] = ['straight', 'curved', 'orthogonal'];
const mkNodes = (count: number) => {
  const cols = Math.ceil(Math.sqrt(count));
  return Array.from({ length: count }, (_, i) => ({ id: `n${i}`, type: 'device', x: (i % cols) * 160, y: Math.floor(i / cols) * 90, width: 100, height: 50, diagramMode: 'floorplan', floorId: 'f1', layerId: 'network' }));
};
const base = (nodes: any[], cables: any[]): any => ({ activeMode: 'floorplan', activeFloorId: 'f1', settings: { hiddenLayers: [], showCableCodes: true }, assets: {}, racks: [], rooms: [], nodes, cables });

function randomProject(nodeCount: number, cableCount: number) {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const cables = Array.from({ length: cableCount }, (_, i) => {
    const s = Math.floor(rnd() * nodeCount); let t = Math.floor(rnd() * nodeCount); if (t === s) t = (t + 1) % nodeCount;
    return { id: `c${i}`, cableCode: `C-${i}`, sourceNodeId: `n${s}`, targetNodeId: `n${t}`, routingType: kinds[i % 3], strokeWidth: 2, ...(i % 7 === 0 ? { controlPoints: [{ x: 300 + (i % 50) * 10, y: 200 }] } : {}) };
  });
  return base(mkNodes(nodeCount), cables);
}
/** Designed worst case: every cable of a group shares the same node pair (dense bundles), long labels, many waypoints, all route kinds. */
function worstProject(groups: number, perBundle: number) {
  const nodes = mkNodes(groups * 2);
  const cables: any[] = [];
  for (let g = 0; g < groups; g++) for (let k = 0; k < perBundle; k++) {
    cables.push({
      id: `g${g}k${k}`, cableCode: `G${g}-K${k}`, label: 'UPLINK-CORE-DISTRIBUTION-'.repeat(3) + k, labelFontSize: 14, sourceNodeId: `n${g * 2}`, targetNodeId: `n${g * 2 + 1}`,
      routingType: kinds[k % 3], strokeWidth: 2 + (k % 5), color: ['#0284c7', '#dc2626', '#16a34a', '#d97706', '#9333ea'][k % 5],
      controlPoints: Array.from({ length: 12 }, (_, w) => ({ x: 200 + w * 40 + k, y: 100 + (w % 2) * 80 + g * 5 }))
    });
  }
  return base(nodes, cables);
}

const pct = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]; };
interface Row { dataset: string; op: string; median: number; p95: number; p99: number; heapKB: number; gcMs: number; budget: number; ok: boolean }
const rows: Row[] = [];
function measure(dataset: string, op: string, budget: number, fn: () => void) {
  fn(); fn(); // warm-up (JIT)
  drainGc(); const gc0 = gcMs; const h0 = process.memoryUsage().heapUsed;
  const ts: number[] = [];
  for (let i = 0; i < RUNS; i++) { const t0 = performance.now(); fn(); ts.push(performance.now() - t0); }
  drainGc();
  const row: Row = { dataset, op, median: pct(ts, 0.5), p95: pct(ts, 0.95), p99: pct(ts, 0.99), heapKB: Math.round((process.memoryUsage().heapUsed - h0) / 1024), gcMs: gcMs - gc0, budget, ok: pct(ts, 0.95) <= budget };
  rows.push(row);
}
function suite(name: string, p: any, ids: { cable: string; many: string[]; node: string }) {
  const input = { ...p, hiddenLayers: [] as string[] };
  const vis = resolveVisibility(input);
  measure(name, 'resolveVisibility', BUDGET.visibility, () => resolveVisibility(input));
  measure(name, 'computeCableBundleLayout', BUDGET.bundleLayout, () => computeCableBundleLayout(vis.visibleCables, vis.getRoutableRect));
  measure(name, 'zoom 1 node', BUDGET.zoomNode, () => getZoomSelectionBounds(p, { type: 'node', id: ids.node } as any));
  measure(name, 'zoom 1 cable (edit handles)', BUDGET.zoomCable, () => getZoomSelectionBounds(p, { type: 'edge', id: ids.cable } as any, { includeEditHandles: true }));
  measure(name, `zoom ${ids.many.length} cables (edit handles)`, ids.many.length <= 50 ? BUDGET.zoom50 : BUDGET.zoomBundle,
    () => getZoomSelectionBounds(p, { type: 'edge', id: ids.many[0], additionalIds: ids.many.slice(1) } as any, { includeEditHandles: true }));
}

for (const [n, c] of [[100, 300], [500, 1500], [1000, 3000]] as const) {
  const p = randomProject(n, c);
  suite(`random ${n}/${c}`, p, { cable: 'c10', many: p.cables.slice(0, 50).map((x: any) => x.id), node: 'n5' });
}
for (const k of [10, 50, 100]) {
  const p = worstProject(10, k);
  suite(`worst: 10 bundles × ${k} cables, 12 waypoints, long labels`, p, { cable: 'g0k0', many: p.cables.filter((x: any) => x.id.startsWith('g0')).map((x: any) => x.id), node: 'n0' });
}
{ // one single huge bundle selected entirely
  const p = worstProject(1, 100);
  suite('worst: 1 bundle × 100, select all 100', p, { cable: 'g0k0', many: p.cables.map((x: any) => x.id), node: 'n0' });
}

console.log(`Node ${process.version}, ${RUNS} runs per case (ms; heap = growth over the runs)`);
console.log('| dataset | operation | median | p95 | p99 | budget p95 | heap KB | GC ms | |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.dataset} | ${r.op} | ${r.median.toFixed(2)} | ${r.p95.toFixed(2)} | ${r.p99.toFixed(2)} | ${r.budget} | ${r.heapKB} | ${r.gcMs.toFixed(1)} | ${r.ok ? 'ok' : 'OVER'} |`);
if (JSON_OUT) { mkdirSync(JSON_OUT.replace(/[^/]*$/, '') || '.', { recursive: true }); writeFileSync(JSON_OUT, JSON.stringify({ node: process.version, runs: RUNS, rows }, null, 2)); }
const over = rows.filter(r => !r.ok);
if (ENFORCE && over.length) { console.error(`PERF BUDGET EXCEEDED in ${over.length} case(s):`); over.forEach(r => console.error(`  ${r.dataset} / ${r.op}: p95 ${r.p95.toFixed(2)} > ${r.budget} ms`)); process.exit(1); }
