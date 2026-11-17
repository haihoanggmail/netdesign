/**
 * Sinh các file HTML 3D THẬT (dùng runtime đã bundle) để E2E mở trong Chromium.
 * Chạy: tsx e2e/helpers/make-viewer-fixture.ts <thư-mục-đầu-ra>
 * Cảnh dùng three thật + scene.toJSON() giống ứng dụng; không phụ thuộc phiên ứng dụng.
 */
import * as THREE from 'three';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateStandalone3DViewerHtml, VIEWER_DATA_PREVIEW_ONLY } from '../../src/utils/htmlViewerExporter';
import { VIEWER_3D_RUNTIME_JS, VIEWER_3D_RUNTIME_READY } from '../../src/generated/viewer3dRuntime.generated';

if (!VIEWER_3D_RUNTIME_READY || !VIEWER_3D_RUNTIME_JS) {
  throw new Error('Runtime 3D chưa được bundle — chạy npm run build:viewer3d trước.');
}
const outDir = resolve(process.argv[2] || 'test-results/viewer-fixture');
mkdirSync(outDir, { recursive: true });

const scene = new THREE.Scene();
scene.add(new THREE.AmbientLight(0xffffff, 0.8));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(6, 10, 4);
scene.add(sun);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0xdde6f0 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const addNode = (nodeId: string, label: string, x: number, z: number, color: number, hidden = false) => {
  const g = new THREE.Group();
  g.userData = { nodeId, label };
  g.position.set(x, 0, z);
  const m = new THREE.Mesh(new THREE.BoxGeometry(2, 1.6, 2), new THREE.MeshStandardMaterial({ color }));
  m.position.y = 0.8;
  m.userData = { nodeId, label };
  g.add(m);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffffff }));
  s.position.y = 2.4;
  s.userData = { label };
  g.add(s);
  g.visible = !hidden;
  scene.add(g);
};
addNode('n1', 'SW-01', 0, 0, 0x2563eb);
addNode('n2', 'AP-01', 6, 0, 0x16a34a);
addNode('n3', 'SW-02', -6, 0, 0x2563eb);
addNode('n4', 'CAM-<img src=x onerror=window.__xss=1>', 0, 6, 0xf59e0b);
addNode('r1', 'RACK-A', 0, -6, 0x334155);
addNode('h1', 'AN-HIEN', 6, 6, 0xdc2626, true);

const addCable = (cableId: string, label: string, a: THREE.Vector3, b: THREE.Vector3, hidden = false) => {
  const curve = new THREE.LineCurve3(a, b);
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 8, 0.08, 6, false), new THREE.MeshStandardMaterial({ color: 0xf97316 }));
  m.userData = { cableId, label };
  m.visible = !hidden;
  scene.add(m);
};
addCable('c1', 'C-001', new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(6, 1.2, 0));
addCable('c2', 'C-002', new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(-6, 1.2, 0));
addCable('c3', 'C-AN', new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(6, 1.2, 6), true);

const snapshot: any = {
  sceneJson: scene.toJSON(),
  isDark: false,
  background: 0xeef4fb,
  fogDensity: 0.0085,
  environmentIntensity: 0.85,
  toneMappingExposure: 1.05,
  camera: { fov: 42, near: 0.2, far: 180, minDistance: 3, maxDistance: 48, maxPolarAngle: Math.PI / 2 - 0.04 },
  presets: {
    iso: { position: [12, 10, 12], target: [0, 0, 0] },
    top: { position: [0, 24, 0.01], target: [0, 0, 0] },
    front: { position: [0, 4, 18], target: [0, 0, 0] },
    side: { position: [18, 4, 0], target: [0, 0, 0] }
  },
  stats: { devices: 99, racks: 99, cables: 99 }
};

const project: any = {
  name: 'Dự án E2E <demo>', author: 'KTV', version: '1.0', settings: {}, racks: [],
  assets: { a1: { id: 'a1', name: 'SW-01', assetTag: 'AST-SECRET-1', category: 'switch', vendor: 'VendorSecret', model: 'ModelSecret', ipAddress: '10.99.88.77', vlan: '4090', powerWatts: 30, status: 'online' } },
  nodes: [
    { id: 'n1', type: 'device', label: 'SW-01', assetId: 'a1' },
    { id: 'n2', type: 'device', label: 'AP-01' },
    { id: 'n3', type: 'device', label: 'SW-02', assetId: 'a1' },
    { id: 'n4', type: 'device', label: 'CAM-<img src=x onerror=window.__xss=1>', assetId: 'khong-ton-tai' },
    { id: 'r1', type: 'rack', label: 'RACK-A' },
    { id: 'h1', type: 'device', label: 'AN-HIEN', assetId: 'a1' }
  ],
  cables: [
    { id: 'c1', cableCode: 'C-001', sourceNodeId: 'n1', targetNodeId: 'n2', cableType: 'CableTypeSecret', bandwidth: '1G', lengthMeters: 12 },
    { id: 'c2', cableCode: 'C-002', sourceNodeId: 'n1', targetNodeId: 'n3', cableType: 'CableTypeSecret', bandwidth: '1G', lengthMeters: 12 },
    { id: 'c3', cableCode: 'C-AN', sourceNodeId: 'n1', targetNodeId: 'h1', cableType: 'CableTypeSecret', bandwidth: '1G', lengthMeters: 3 }
  ]
};

const ALL = { assetInfo: true, ip: true, vlan: true, status: true, cableInfo: true, deviceTable: true, cableTable: true };
const write = (name: string, data: any) =>
  writeFileSync(resolve(outDir, name), generateStandalone3DViewerHtml(project, snapshot, { runtimeJs: VIEWER_3D_RUNTIME_JS, data, maxBytes: 120 * 1024 * 1024 }));
write('viewer-preview.html', VIEWER_DATA_PREVIEW_ONLY);
write('viewer-full.html', ALL);
console.log(`[fixture] đã ghi viewer-preview.html và viewer-full.html vào ${outDir}`);
