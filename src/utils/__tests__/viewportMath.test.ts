import assert from 'node:assert/strict';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  boundsOfRects,
  clampZoom,
  fitRect,
  resetZoomAtCenter,
  screenToWorld,
  worldToScreen,
  zoomAtPoint,
  zoomByFactorAtPoint,
  zoomInFactor,
  zoomOutFactor
} from '../viewportMath';

let passed = 0;
function t(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !≈ ${b}`);

console.log('viewportMath');

t('zoomAtPoint keeps the world point under the anchor fixed (incl. corners)', () => {
  const view = { zoom: 1, pan: { x: 120, y: -40 } };
  for (const anchor of [{ x: 0, y: 0 }, { x: 1200, y: 800 }, { x: 640, y: 400 }, { x: 5, y: 790 }]) {
    const before = screenToWorld(anchor, view);
    const next = zoomAtPoint(view, 2.4, anchor);
    const after = screenToWorld(anchor, next);
    near(before.x, after.x);
    near(before.y, after.y);
  }
});

t('zoom is clamped to 20%–300% and anchor still fixed at limits', () => {
  assert.equal(clampZoom(0.01), MIN_ZOOM);
  assert.equal(clampZoom(99), MAX_ZOOM);
  const view = { zoom: 2.9, pan: { x: 10, y: 20 } };
  const anchor = { x: 300, y: 200 };
  const next = zoomAtPoint(view, 10, anchor);
  assert.equal(next.zoom, MAX_ZOOM);
  const a = screenToWorld(anchor, view);
  const b = screenToWorld(anchor, next);
  near(a.x, b.x);
  near(a.y, b.y);
  assert.equal(zoomAtPoint(next, 10, anchor), next);
});

t('zoom-out factor is the exact inverse of zoom-in factor', () => {
  near(zoomInFactor * zoomOutFactor, 1, 1e-12);
});

t('N zoom-in + N zoom-out returns to the ORIGINAL zoom and pan (round-trip)', () => {
  // 1.1^11 ≈ 2.85, still under the 300% clamp
  for (const n of [1, 5, 10, 11]) {
    const start = { zoom: 1, pan: { x: 33, y: 77 } };
    const anchor = { x: 411, y: 263 };
    let view = start;
    for (let i = 0; i < n; i++) view = zoomByFactorAtPoint(view, zoomInFactor, anchor);
    for (let i = 0; i < n; i++) view = zoomByFactorAtPoint(view, zoomOutFactor, anchor);
    near(view.zoom, start.zoom, 1e-9);
    near(view.pan.x, start.pan.x, 1e-6);
    near(view.pan.y, start.pan.y, 1e-6);
  }
});

t('anchor stays fixed over 36 continuous steps (within clamp range)', () => {
  let view = { zoom: 1, pan: { x: 33, y: 77 } };
  const anchor = { x: 411, y: 263 };
  const w0 = screenToWorld(anchor, view);
  for (let i = 0; i < 12; i++) view = zoomByFactorAtPoint(view, zoomInFactor, anchor);
  for (let i = 0; i < 24; i++) view = zoomByFactorAtPoint(view, zoomOutFactor, anchor);
  const w1 = screenToWorld(anchor, view);
  near(w0.x, w1.x, 1e-6);
  near(w0.y, w1.y, 1e-6);
});

t('invalid zoom values never produce NaN/Infinity/0', () => {
  for (const bad of [NaN, Infinity, -Infinity, 0, -3]) {
    const z = clampZoom(bad);
    assert.ok(Number.isFinite(z) && z >= MIN_ZOOM && z <= MAX_ZOOM, String(bad));
  }
  const v = zoomAtPoint({ zoom: 1, pan: { x: 0, y: 0 } }, NaN, { x: 10, y: 10 });
  assert.ok(Number.isFinite(v.zoom) && Number.isFinite(v.pan.x) && Number.isFinite(v.pan.y));
});

t('zoom anchor exact at the 4 corners and edges at 20% and 300%', () => {
  const vp = { w: 1000, h: 600 };
  const anchors = [
    { x: 0, y: 0 }, { x: vp.w, y: 0 }, { x: 0, y: vp.h }, { x: vp.w, y: vp.h },
    { x: vp.w / 2, y: vp.h / 2 }, { x: 1, y: 300 }, { x: vp.w - 1, y: 300 }
  ];
  for (const target of [MIN_ZOOM, MAX_ZOOM]) {
    for (const a of anchors) {
      const view = { zoom: 1, pan: { x: 50, y: 50 } };
      const before = screenToWorld(a, view);
      const after = screenToWorld(a, zoomAtPoint(view, target, a));
      near(before.x, after.x, 1e-6);
      near(before.y, after.y, 1e-6);
    }
  }
});

t('device world coordinates are never mutated by zoom/pan (round trip)', () => {
  const device = { x: 480, y: 210 };
  let view = { zoom: 0.35, pan: { x: -90, y: 40 } };
  view = zoomAtPoint(view, 2.75, { x: 700, y: 120 });
  const back = screenToWorld(worldToScreen(device, view), view);
  near(back.x, device.x);
  near(back.y, device.y);
});

t('resetZoomAtCenter gives 100% and keeps viewport centre fixed', () => {
  const view = { zoom: 2, pan: { x: -300, y: -100 } };
  const vp = { w: 1000, h: 600 };
  const c = { x: 500, y: 300 };
  const w0 = screenToWorld(c, view);
  const next = resetZoomAtCenter(view, vp);
  assert.equal(next.zoom, 1);
  const w1 = screenToWorld(c, next);
  near(w0.x, w1.x);
  near(w0.y, w1.y);
});

t('fitRect centres bounds and keeps them inside the viewport', () => {
  const bounds = { minX: 100, minY: 50, maxX: 1100, maxY: 650 };
  const vp = { w: 800, h: 500 };
  const v = fitRect(bounds, vp, { padding: 40 });
  const tl = worldToScreen({ x: bounds.minX, y: bounds.minY }, v);
  const br = worldToScreen({ x: bounds.maxX, y: bounds.maxY }, v);
  assert.ok(tl.x >= 40 - 1e-6 && tl.y >= 40 - 1e-6);
  assert.ok(br.x <= vp.w - 40 + 1e-6 && br.y <= vp.h - 40 + 1e-6);
  near((tl.x + br.x) / 2, vp.w / 2);
  near((tl.y + br.y) / 2, vp.h / 2);
});

t('fitRect on a single small object does not exceed max zoom', () => {
  const v = fitRect({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { w: 1200, h: 800 }, { maxZoom: 1.35 });
  assert.equal(v.zoom, 1.35);
});

t('boundsOfRects', () => {
  assert.equal(boundsOfRects([]), null);
  assert.deepEqual(
    boundsOfRects([
      { x: 10, y: 10, width: 20, height: 20 },
      { x: -5, y: 40, width: 10, height: 10 }
    ]),
    { minX: -5, minY: 10, maxX: 30, maxY: 50 }
  );
});

console.log(`${passed} passed`);
