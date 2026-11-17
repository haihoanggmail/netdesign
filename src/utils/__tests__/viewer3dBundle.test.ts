import assert from 'node:assert/strict';
import { VIEWER_3D_RUNTIME_JS, VIEWER_3D_RUNTIME_READY } from '../../generated/viewer3dRuntime.generated';

let passed = 0;
function t(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

// Chạy sau `npm run build:viewer3d` (pretest). Nếu file generated vẫn là placeholder → test THẤT BẠI.
t('P0.1: runtime đã được bundle (READY=true, không rỗng)', () => {
  assert.equal(VIEWER_3D_RUNTIME_READY, true, 'file generated vẫn là placeholder — chạy npm run build:viewer3d');
  assert.ok(VIEWER_3D_RUNTIME_JS.length > 100_000, `bundle quá nhỏ: ${VIEWER_3D_RUNTIME_JS.length}`);
});

t('P0.1: bundle chứa runtime thật + three + xử lý mất context + kiểm tra WebGL 2', () => {
  for (const m of ['hachihi-3d-data', 'WebGLRenderer', 'v3d-ctxlost', 'webglcontextlost', 'webglcontextrestored', 'WebGL2RenderingContext']) {
    assert.ok(VIEWER_3D_RUNTIME_JS.includes(m), `thiếu "${m}"`);
  }
});

t('P0.1: bundle không chứa </script thô (an toàn khi nhúng vào HTML)', () => {
  assert.ok(!/<\/script/i.test(VIEWER_3D_RUNTIME_JS));
});

console.log(`\n${passed} viewer3dBundle tests passed`);
