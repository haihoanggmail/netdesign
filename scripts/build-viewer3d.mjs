// Bundle trình xem 3D (three + OrbitControls + runtime) thành 1 khối IIFE rồi ghi vào
// src/generated/viewer3dRuntime.generated.ts để nhúng vào file HTML xuất ra (offline, không cần mạng).
// Chạy tự động qua "predev" / "prebuild" / "pretest"; có thể chạy tay: npm run build:viewer3d
import { build } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(root, 'src/services/export/viewer3d/viewerRuntime.ts');
const outFile = resolve(root, 'src/generated/viewer3dRuntime.generated.ts');

const result = await build({
  root,
  configFile: false,
  logLevel: 'warn',
  build: {
    write: false,
    minify: true,
    target: 'es2020',
    lib: { entry, formats: ['iife'], name: 'HachihiViewer3D', fileName: 'viewer3d' }
  }
});

const outputs = (Array.isArray(result) ? result : [result]).flatMap(r => r.output ?? []);
const chunk = outputs.find(o => o.type === 'chunk');
if (!chunk) throw new Error('Không tạo được bundle trình xem 3D');

// Tránh đóng sớm thẻ <script> khi nhúng vào HTML.
const code = chunk.code.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

// Kiểm tra bundle thật sự chứa runtime + three; nếu không thì DỪNG build (không để file generated rỗng).
const REQUIRED_MARKERS = ['hachihi-3d-data', 'WebGLRenderer', 'v3d-ctxlost'];
const MIN_BYTES = 100_000;
if (code.length < MIN_BYTES) {
  throw new Error(`Bundle trình xem 3D quá nhỏ (${code.length} ký tự < ${MIN_BYTES}) — three chưa được đóng gói.`);
}
for (const m of REQUIRED_MARKERS) {
  if (!code.includes(m)) throw new Error(`Bundle trình xem 3D thiếu "${m}" — runtime không đầy đủ.`);
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(
  outFile,
  `// AUTO-GENERATED bởi scripts/build-viewer3d.mjs — không sửa tay.\n` +
    `export const VIEWER_3D_RUNTIME_READY = true;\n` +
    `export const VIEWER_3D_RUNTIME_JS: string = ${JSON.stringify(code)};\n`
);
console.log(`[viewer3d] Đã bundle trình xem 3D: ${(code.length / 1024).toFixed(0)} KB -> ${outFile}`);
