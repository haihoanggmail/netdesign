/**
 * Vòng lặp render theo yêu cầu với bảo đảm: tại mọi thời điểm chỉ có TỐI ĐA MỘT
 * requestAnimationFrame đang chờ. Sự kiện `change` của OrbitControls bắn ngay trong
 * controls.update() (tức đang ở trong frame) nên request() chỉ đánh dấu "cần vẽ",
 * không được tự lên lịch thêm.
 */
export interface FrameLoopDeps {
  raf: (cb: (t: number) => void) => number;
  cancel?: (id: number) => void;
  now?: () => number;
  /** Cập nhật camera/animation. changed: camera vừa đổi; animating: cần tiếp tục frame sau. */
  update: (dt: number) => { changed: boolean; animating: boolean };
  render: () => void;
}

export interface FrameLoop {
  request: () => void;
  stop: () => void;
  readonly pending: boolean;
  readonly frames: number;
}

export function createFrameLoop(deps: FrameLoopDeps): FrameLoop {
  const now = deps.now ?? (() => Date.now());
  let rafId = 0;
  let inFrame = false;
  let dirty = true;
  let last = now();
  let frames = 0;
  let stopped = false;

  const schedule = () => {
    if (stopped || inFrame || rafId !== 0) return;
    rafId = deps.raf(tick);
  };

  const tick = (t: number) => {
    rafId = 0;
    if (stopped) return;
    inFrame = true;
    let more = false;
    try {
      const cur = Number.isFinite(t) ? t : now();
      const dt = Math.min(0.1, Math.max(0, (cur - last) / 1000));
      last = cur;
      const wasDirty = dirty;
      dirty = false;
      const r = deps.update(dt);
      if (wasDirty || dirty || r.changed || r.animating) {
        deps.render();
        frames++;
        dirty = false;
      }
      more = r.changed || r.animating;
    } finally {
      inFrame = false;
    }
    if (more) schedule();
  };

  return {
    request() {
      dirty = true;
      if (rafId === 0 && !inFrame) last = now();
      schedule();
    },
    stop() {
      stopped = true;
      if (rafId !== 0) deps.cancel?.(rafId);
      rafId = 0;
    },
    get pending() {
      return rafId !== 0;
    },
    get frames() {
      return frames;
    }
  };
}
