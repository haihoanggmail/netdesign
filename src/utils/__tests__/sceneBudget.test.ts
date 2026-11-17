import assert from 'node:assert/strict';
import { assertSceneBudget, DEFAULT_SCENE_BUDGET_LIMITS, estimateSceneBudget, SceneTooLargeError, utf8ByteLength } from '../../services/export/sceneBudget';

let passed = 0;
function t(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

const mesh = (verts: number, idx: number, mat: any = { uuid: 'm' }, gid = 'g') => ({
  isMesh: true,
  geometry: { uuid: gid, attributes: { position: { count: verts, itemSize: 3 }, normal: { count: verts, itemSize: 3 } }, index: { count: idx } },
  material: mat
});
const sceneOf = (objs: any[]) => ({ traverse: (cb: (o: any) => void) => objs.forEach(cb) });

t('Cảnh nhỏ → ok', () => {
  const r = estimateSceneBudget(sceneOf([mesh(24, 36)]));
  assert.equal(r.level, 'ok');
  assert.equal(r.meshes, 1);
});

t('Geometry/material dùng chung chỉ tính một lần', () => {
  const one = estimateSceneBudget(sceneOf([mesh(1000, 3000)]));
  const many = estimateSceneBudget(sceneOf(Array.from({ length: 10 }, () => mesh(1000, 3000))));
  assert.equal(many.geometries, 1);
  assert.equal(many.materials, 1);
  assert.ok(many.estimatedBytes < one.estimatedBytes * 3);
});

t('Quá nhiều mesh → reject với lý do', () => {
  const lim = { ...DEFAULT_SCENE_BUDGET_LIMITS, maxMeshes: 5 };
  const r = estimateSceneBudget(sceneOf(Array.from({ length: 6 }, (_, i) => mesh(8, 12, { uuid: 'm' + i }, 'g' + i))), lim);
  assert.equal(r.level, 'reject');
  assert.ok(r.reasons[0].includes('mesh'));
  assert.throws(() => assertSceneBudget(sceneOf(Array.from({ length: 6 }, (_, i) => mesh(8, 12, { uuid: 'm' + i }, 'g' + i))), lim), SceneTooLargeError);
});

t('Texture quá lớn / quá nhiều → reject', () => {
  const big = { uuid: 'mb', map: { uuid: 't1', image: { width: 8192, height: 8192 } } };
  assert.equal(estimateSceneBudget(sceneOf([mesh(8, 12, big)])).level, 'reject');
  const many = Array.from({ length: 100 }, (_, i) => mesh(8, 12, { uuid: 'm' + i, map: { uuid: 't' + i, image: { width: 16, height: 16 } } }, 'g' + i));
  const r = estimateSceneBudget(sceneOf(many));
  assert.equal(r.textures, 100);
  assert.equal(r.level, 'reject');
});

t('Ngưỡng tăng dần: ok → warn → reject theo dung lượng ước lượng', () => {
  const lim = { ...DEFAULT_SCENE_BUDGET_LIMITS, warnEstimatedBytes: 1_000_000, maxEstimatedBytes: 5_000_000 };
  const lv = (n: number) => estimateSceneBudget(sceneOf([mesh(n, n * 3)]), lim).level;
  assert.equal(lv(1_000), 'ok');
  assert.equal(lv(20_000), 'warn');
  assert.equal(lv(200_000), 'reject');
});

t('Chạy nhanh với cảnh rất lớn (không treo)', () => {
  const objs = Array.from({ length: 50_000 }, (_, i) => mesh(24, 36, { uuid: 'm' + (i % 50) }, 'g' + (i % 200)));
  const t0 = Date.now();
  estimateSceneBudget(sceneOf(objs));
  assert.ok(Date.now() - t0 < 1500, 'ước lượng phải < 1,5 s cho 50.000 mesh');
});

t('utf8ByteLength khớp TextEncoder (ASCII, tiếng Việt, emoji)', () => {
  for (const s of ['abc', 'Thiết bị mạng ✓', 'x😀y', '']) assert.equal(utf8ByteLength(s), new TextEncoder().encode(s).length, s);
});

console.log(`\n${passed} sceneBudget tests passed`);
