/**
 * Render-to-Bounds Parity Test (Chromium).
 * For every scenario: render the REAL SVG (strokes, filters, text) in Chromium at 4×, find the painted pixels
 * (alpha ≥ ALPHA_MIN), convert to canvas units, and compare with the bounds Zoom-to-Selection computes.
 *   1. NOT CLIPPED   : painted ⊆ computed (± AA_TOLERANCE)
 *   2. NOT TOO WIDE  : computed − painted ≤ maxExcess per side (stated per scenario, justified by the filter tail)
 * On failure a PNG + JSON are written to test-results/render-parity/.
 * Run: tsx src/utils/__tests__/renderParity.chromium.ts
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { getZoomSelectionBounds } from '../selectionBounds';
import { resolveVisibility } from '../visibilityResolver';
import { computeCableBundleLayout, computeCablePath } from '../cableRouting';
import { cableOverlayMarkup } from './fixtures/cableOverlaySvg';

const SCALE = 4;
const ALPHA_MIN = 8;          // ~3 %: below this the Gaussian tail of a 0.22-alpha shadow is invisible
const AA_TOLERANCE = 0.5;     // canvas units (anti-aliasing)
const OUT_DIR = 'test-results/render-parity';

async function loadChromium(): Promise<any> {
  for (const m of ['@playwright/test', 'playwright']) { try { return (await import(m)).chromium; } catch { /* next */ } }
  const req = createRequire(import.meta.url);
  for (const base of [process.env.PLAYWRIGHT_MODULE_DIR, '/home/claude/.npm-global/lib/node_modules'].filter(Boolean) as string[]) {
    try { return req(`${base}/playwright`).chromium; } catch { /* next */ }
  }
  throw new Error('Playwright not found (npm i -D @playwright/test && npx playwright install chromium)');
}

const node = (id: string, x: number, y: number) => ({ id, type: 'device', x, y, width: 100, height: 50, diagramMode: 'floorplan', floorId: 'f1' });
const cable = (id: string, s: string, t: string, extra: Record<string, unknown> = {}) => ({ id, cableCode: id, sourceNodeId: s, targetNodeId: t, routingType: 'straight', strokeWidth: 2, ...extra });
const project = (cables: any[], settings: Record<string, unknown> = {}, nodes?: any[]): any => ({
  activeMode: 'floorplan', activeFloorId: 'f1', assets: {}, racks: [], rooms: [], cables,
  settings: { hiddenLayers: [], showCableCodes: true, ...settings },
  nodes: nodes || [node('a', 0, 0), node('b', 600, 300), node('c', -400, -200), node('d', 0, 400), node('e', 400, 0)]
});

interface Scenario { name: string; p: any; ids: string[]; readOnly?: boolean; edit?: boolean; maxExcess: number }
const manyBundle = (k: number) => Array.from({ length: k }, (_, i) => cable(`bn${i}`, 'a', 'b', { color: ['#0284c7', '#dc2626', '#16a34a', '#d97706', '#9333ea'][i % 5], strokeWidth: 2 }));
const SHADOW = 3.0; // measured excess from the 3σ shadow reach vs the visible (alpha≥3%) tail is ≈2.4px; anything wider = over-padding
const scenarios: Scenario[] = [
  { name: 'straight, auto label, edit handles', p: project([cable('c1', 'a', 'b')]), ids: ['c1'], edit: true, maxExcess: SHADOW },
  { name: 'curved + waypoints, custom label 45°', p: project([cable('c1', 'a', 'b', { routingType: 'curved', controlPoints: [{ x: 300, y: -150 }, { x: 450, y: 120 }], label: 'UPLINK-CORE-01', labelRotation: 45, labelAutoOrient: false })]), ids: ['c1'], edit: true, maxExcess: SHADOW },
  { name: 'orthogonal, label angle 90 and -90', p: project([cable('c1', 'a', 'd', { routingType: 'orthogonal', label: 'V-90', labelRotation: 90, labelAutoOrient: false }), cable('c2', 'a', 'e', { routingType: 'orthogonal', label: 'V-M90', labelRotation: -90, labelAutoOrient: false })]), ids: ['c1', 'c2'], edit: true, maxExcess: SHADOW },
  { name: 'label angle 180 / 0', p: project([cable('c1', 'a', 'b', { label: 'ANGLE-180', labelRotation: 180, labelAutoOrient: false }), cable('c2', 'd', 'e', { label: 'ANGLE-0', labelRotation: 0, labelAutoOrient: false })]), ids: ['c1', 'c2'], edit: false, maxExcess: SHADOW },
  { name: 'bundle of 5 – summary badge + jacket counted once', p: project(manyBundle(5)), ids: ['bn0', 'bn1', 'bn4'], edit: true, maxExcess: SHADOW },
  { name: 'horizontal bundle of 5 – summary badge pokes ABOVE the cables (P0.1)', p: project(manyBundle(5).map(c => ({ ...c, targetNodeId: 'e' })), { showCableCodes: false }), ids: ['bn2'], edit: false, readOnly: true, maxExcess: SHADOW },
  { name: 'bundle of 12, 4+ colours', p: project(manyBundle(12)), ids: ['bn3'], edit: true, maxExcess: SHADOW },
  { name: 'read-only, no badge → no "+ Thêm nhãn" and no handles', p: project([cable('c1', 'a', 'b')], { showCableCodes: false }), ids: ['c1'], readOnly: true, edit: false, maxExcess: 1.0 },
  { name: 'edit mode, no badge → "+ Thêm nhãn" button measured', p: project([cable('c1', 'a', 'b')], { showCableCodes: false }), ids: ['c1'], edit: true, maxExcess: 1.5 },
  { name: 'midpoint exactly on X=0', p: project([cable('c1', 'c', 'e')], {}, [node('c', -350, 0), node('e', 250, 0)]), ids: ['c1'], edit: true, maxExcess: SHADOW },
  { name: 'strokeWidth 12 dashed', p: project([cable('c1', 'a', 'b', { strokeWidth: 12, lineStyle: 'dashed' })], { showCableCodes: false }), ids: ['c1'], readOnly: true, maxExcess: 1.0 },
  { name: 'max-length label, fontSize 24 and 7', p: project([cable('c1', 'a', 'b', { label: 'X'.repeat(80), labelFontSize: 24 }), cable('c2', 'd', 'e', { label: 'tiny', labelFontSize: 7 })]), ids: ['c1', 'c2'], edit: true, maxExcess: SHADOW },
  { name: 'label layer hidden', p: project([cable('c1', 'a', 'b')], { hiddenLayers: ['cable_labels'] }), ids: ['c1'], edit: true, maxExcess: 1.5 }
];

const browser = await (await loadChromium()).launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
mkdirSync(OUT_DIR, { recursive: true });
let failures = 0;

for (const sc of scenarios) {
  const sel = { type: 'edge', id: sc.ids[0], additionalIds: sc.ids.slice(1) } as any;
  const res = getZoomSelectionBounds(sc.p, sel, { includeEditHandles: Boolean(sc.edit) && !sc.readOnly, isReadOnly: Boolean(sc.readOnly) });
  if (res.status !== 'ok') { console.error(`✗ ${sc.name}: resolver says ${res.status}`); failures++; continue; }
  const b = res.bounds;

  // same inputs the resolver used
  const vis = resolveVisibility({ nodes: sc.p.nodes, rooms: [], cables: sc.p.cables, assets: {}, racks: [], activeMode: 'floorplan', activeFloorId: 'f1', hiddenLayers: sc.p.settings.hiddenLayers });
  const layout = computeCableBundleLayout(vis.visibleCables, vis.getRoutableRect);
  const picked = sc.p.cables.filter((c: any) => sc.ids.includes(c.id)).map((c: any) => ({
    cable: c, isBundled: layout.cableToBundleId.has(c.id),
    path: layout.cablePaths.get(c.id) || computeCablePath(c, vis.getRoutableRect(c.sourceNodeId)!, vis.getRoutableRect(c.targetNodeId)!)
  }));
  const bundleIds = new Set(picked.map((x: any) => layout.cableToBundleId.get(x.cable.id)).filter(Boolean));
  const markup = cableOverlayMarkup({
    cables: picked, bundles: layout.bundles.filter(x => bundleIds.has(x.bundleId)),
    labelLayerVisible: !sc.p.settings.hiddenLayers.includes('cable_labels'), showCableCodes: sc.p.settings.showCableCodes, isReadOnly: Boolean(sc.readOnly), showHandles: Boolean(sc.edit)
  });

  const pad = 60;
  const vb = { x: Math.floor(b.minX - pad), y: Math.floor(b.minY - pad), w: Math.ceil(b.maxX - b.minX + pad * 2), h: Math.ceil(b.maxY - b.minY + pad * 2) };
  await page.setContent(`<html><body style="margin:0;background:transparent"><svg id="s" xmlns="http://www.w3.org/2000/svg" width="${vb.w * SCALE}" height="${vb.h * SCALE}" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}">${markup}</svg></body></html>`);
  const png: Buffer = await page.locator('#s').screenshot({ omitBackground: true });
  const px = await page.evaluate(async ({ b64, alphaMin }: { b64: string; alphaMin: number }) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const cv = new OffscreenCanvas(bmp.width, bmp.height); const ctx = cv.getContext('2d')!; ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let y = 0; y < bmp.height; y++) for (let x = 0; x < bmp.width; x++) if (d[(y * bmp.width + x) * 4 + 3] >= alphaMin) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
  }, { b64: png.toString('base64'), alphaMin: ALPHA_MIN });
  const painted = { minX: vb.x + px.x0 / SCALE, minY: vb.y + px.y0 / SCALE, maxX: vb.x + px.x1 / SCALE, maxY: vb.y + px.y1 / SCALE };

  const clip = { left: painted.minX - (b.minX - AA_TOLERANCE), top: painted.minY - (b.minY - AA_TOLERANCE), right: (b.maxX + AA_TOLERANCE) - painted.maxX, bottom: (b.maxY + AA_TOLERANCE) - painted.maxY };
  const excess = { left: painted.minX - b.minX, top: painted.minY - b.minY, right: b.maxX - painted.maxX, bottom: b.maxY - painted.maxY };
  const clipped = Object.entries(clip).filter(([, v]) => v < 0).map(([k, v]) => `${k} ${(-v).toFixed(2)}px`);
  const tooWide = Object.entries(excess).filter(([, v]) => v > sc.maxExcess).map(([k, v]) => `${k} +${v.toFixed(2)}px (max ${sc.maxExcess})`);
  const okRow = clipped.length === 0 && tooWide.length === 0;
  const fmt = (o: any) => Object.values(o).map((v: any) => v.toFixed(1)).join('/');
  console.log(`${okRow ? '  ✓' : '  ✗'} ${sc.name}   excess L/T/R/B = ${fmt(excess)}`);
  if (!okRow) {
    failures++;
    const slug = sc.name.replace(/[^a-z0-9]+/gi, '_').slice(0, 40);
    writeFileSync(`${OUT_DIR}/${slug}.png`, png);
    writeFileSync(`${OUT_DIR}/${slug}.json`, JSON.stringify({ computed: b, painted, clipped, tooWide, markup }, null, 2));
    if (clipped.length) console.error(`      CLIPPED: ${clipped.join(', ')}`);
    if (tooWide.length) console.error(`      TOO WIDE: ${tooWide.join(', ')}`);
  }
}
await browser.close();
console.log(failures === 0 ? `${scenarios.length} parity scenarios passed` : `${failures} parity scenario(s) FAILED (artifacts in ${OUT_DIR}/)`);
process.exit(failures === 0 ? 0 : 1);
