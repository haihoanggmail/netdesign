import assert from 'node:assert/strict';
import { createFrameLoop } from '../../services/export/viewer3d/frameLoop';
import { firstVisibleHit, isEffectivelyVisible } from '../../services/export/viewer3d/visibility';

let passed = 0;
function t(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

/** RAF giả: hàng đợi callback, chạy từng frame. */
function fakeRaf() {
  let id = 0; let queue: Array<{ id: number; cb: (t: number) => void }> = []; let maxPending = 0; let time = 0;
  return {
    raf: (cb: (t: number) => void) => { queue.push({ id: ++id, cb }); maxPending = Math.max(maxPending, queue.length); return id; },
    cancel: (i: number) => { queue = queue.filter(q => q.id !== i); },
    step() { const q = queue; queue = []; time += 16; q.forEach(x => x.cb(time)); },
    get pending() { return queue.length; },
    get maxPending() { return maxPending; }
  };
}

t('P0.1: sự kiện change trong update() không tạo RAF thứ hai (damping 60 frame)', () => {
  const f = fakeRaf();
  let damping = 60;
  let loop: ReturnType<typeof createFrameLoop>;
  loop = createFrameLoop({
    raf: f.raf, cancel: f.cancel, now: () => 0,
    update: () => { const changed = damping-- > 0; if (changed) loop.request(); /* mô phỏng OrbitControls 'change' */ return { changed, animating: false }; },
    render: () => {}
  });
  loop.request();
  for (let i = 0; i < 200; i++) f.step();
  assert.equal(f.maxPending, 1, 'không bao giờ có hơn 1 RAF chờ');
  assert.equal(f.pending, 0, 'đứng yên thì vòng lặp phải dừng hẳn');
  assert.equal(loop.frames, 60, "chỉ vẽ khi camera thực sự đổi");
});

t('P0.1: gọi request() 100 lần liên tiếp chỉ tạo một vòng lặp', () => {
  const f = fakeRaf();
  const loop = createFrameLoop({ raf: f.raf, now: () => 0, update: () => ({ changed: false, animating: false }), render: () => {} });
  for (let i = 0; i < 100; i++) loop.request();
  assert.equal(f.pending, 1);
  f.step();
  assert.equal(f.pending, 0);
  assert.equal(loop.frames, 1);
});

t('P0.1: auto-rotate chạy liên tục 3600 frame rồi tắt thì dừng hẳn, luôn ≤ 1 RAF', () => {
  const f = fakeRaf();
  let auto = true;
  let loop: ReturnType<typeof createFrameLoop>;
  loop = createFrameLoop({
    raf: f.raf, now: () => 0,
    update: () => { if (auto) loop.request(); return { changed: auto, animating: auto }; },
    render: () => {}
  });
  loop.request();
  for (let i = 0; i < 3600; i++) f.step();
  assert.equal(f.pending, 1);
  auto = false;
  f.step(); f.step();
  assert.equal(f.pending, 0);
  assert.equal(f.maxPending, 1);
});

t('P0.1: đổi góc nhìn 100 lần (animation) không tạo vòng song song', () => {
  const f = fakeRaf();
  let anim = 0;
  let loop: ReturnType<typeof createFrameLoop>;
  loop = createFrameLoop({
    raf: f.raf, now: () => 0,
    update: () => { const a = anim > 0; if (a) { anim--; loop.request(); } return { changed: a, animating: a }; },
    render: () => {}
  });
  for (let n = 0; n < 100; n++) { anim = 35; loop.request(); for (let i = 0; i < 10; i++) f.step(); }
  for (let i = 0; i < 100; i++) f.step();
  assert.equal(f.maxPending, 1);
  assert.equal(f.pending, 0);
});

t('P0.2: đối tượng ẩn hoặc nhóm cha ẩn không được chọn', () => {
  const root = { visible: true, parent: null };
  const group = { visible: true, parent: root };
  const cable = { visible: true, parent: group };
  assert.equal(isEffectivelyVisible(cable), true);
  cable.visible = false;
  assert.equal(isEffectivelyVisible(cable), false);
  cable.visible = true; group.visible = false;
  assert.equal(isEffectivelyVisible(cable), false);
  group.visible = true;
  assert.equal(isEffectivelyVisible(cable), true);
});

t('P0.2: cáp tắt bị bỏ qua, thiết bị phía sau được chọn; bật lại thì chọn được cáp', () => {
  const cable = { visible: false, parent: null as any, tag: 'cable' };
  const device = { visible: true, parent: null as any, tag: 'device' };
  const hits = [{ object: cable }, { object: device }];
  assert.equal(firstVisibleHit(hits)!.object.tag, 'device');
  cable.visible = true;
  assert.equal(firstVisibleHit(hits)!.object.tag, 'cable');
  device.visible = false; cable.visible = false;
  assert.equal(firstVisibleHit(hits), null);
});

console.log(`\n${passed} viewer3dRuntime tests passed`);
