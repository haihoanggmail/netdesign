import assert from 'node:assert/strict';
import {
  generateStandalone3DViewerHtml,
  isDeviceNode,
  pruneInvisibleScene,
  toSafeJsonForScript,
  VIEWER_DATA_PREVIEW_ONLY,
  VIEWER_PREVIEW_NODEINFO_LABELS,
  ViewerTooLargeError
} from '../htmlViewerExporter';

const ALL = { assetInfo: true, ip: true, vlan: true, status: true, cableInfo: true, deviceTable: true, cableTable: true };
const payloadOf = (html: string) => JSON.parse(html.match(/<script type="application\/json" id="hachihi-3d-data">([\s\S]*?)<\/script>/)![1]);

let passed = 0;
function t(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

const grp = (nodeId: string, label: string, extra: Record<string, unknown> = {}) =>
  ({ type: 'Group', ...extra, userData: { nodeId, label }, children: [{ type: 'Mesh', userData: { nodeId } }] });

// Cảnh: n1 (có asset a1), n2 (KHÔNG asset), n3 (dùng chung a1), n4 (asset không tồn tại), r1 (rack),
// h1 (bị ẩn trong cảnh), c1 (cáp hiển thị), c2 (cáp bị ẩn). n9 / c9 KHÔNG có trong cảnh.
const snapshot: any = {
  sceneJson: {
    metadata: { type: 'Object' },
    object: {
      type: 'Scene', name: '</script><b>x</b>',
      children: [
        grp('n1', 'SW-01'), grp('n2', 'AP-01'), grp('n3', 'SW-02'), grp('n4', 'CAM-<img src=x onerror=window.__xss=1>'),
        grp('r1', 'RACK-A'), grp('h1', 'AN-HIEN', { visible: false }),
        { type: 'Mesh', userData: { cableId: 'c1', label: 'C-001' } },
        { type: 'Mesh', visible: false, userData: { cableId: 'c2', label: 'C-AN' } }
      ]
    }
  },
  isDark: false, background: 0xeef4fb, fogDensity: 0.0085, environmentIntensity: 0.85, toneMappingExposure: 1.05,
  camera: { fov: 42, near: 0.2, far: 180, minDistance: 3, maxDistance: 48, maxPolarAngle: Math.PI / 2 - 0.04 },
  presets: {
    iso: { position: [10, 8, 10], target: [0, 0, 0] }, top: { position: [0, 20, 0], target: [0, 0, 0] },
    front: { position: [0, 3, 15], target: [0, 0, 0] }, side: { position: [15, 3, 0], target: [0, 0, 0] }
  },
  stats: { devices: 99, racks: 99, cables: 99 } // cố tình sai: header phải lấy từ cảnh, không từ stats
};
const A1 = { id: 'a1', name: 'SW-01', assetTag: 'AST-1', category: 'switch', vendor: 'Cisco', model: 'C9200', ipAddress: '10.0.0.2', vlan: '10', powerWatts: 30, status: 'online' };
const project: any = {
  name: 'Dự án <demo>', author: 'KTV', version: '1.0',
  assets: { a1: A1 },
  nodes: [
    { id: 'n1', type: 'device', label: 'SW-01', assetId: 'a1' },
    { id: 'n2', type: 'device', label: 'AP-01' },
    { id: 'n3', type: 'device', label: 'SW-02', assetId: 'a1' },
    { id: 'n4', type: 'device', label: 'CAM-<img src=x onerror=window.__xss=1>', assetId: 'khong-ton-tai' },
    { id: 'r1', type: 'rack', label: 'RACK-A' },
    { id: 'h1', type: 'device', label: 'AN-HIEN', assetId: 'a1' },
    { id: 'n9', type: 'device', label: 'NGOAI-CANH', assetId: 'a1' }
  ],
  cables: [
    { id: 'c1', cableCode: 'C-001', sourceNodeId: 'n1', targetNodeId: 'n2', cableType: 'Cat6', bandwidth: '1G', lengthMeters: 12 },
    { id: 'c2', cableCode: 'C-AN', sourceNodeId: 'n1', targetNodeId: 'h1', cableType: 'Cat6', bandwidth: '1G', lengthMeters: 3 },
    { id: 'c9', cableCode: 'C-NGOAI', sourceNodeId: 'n1', targetNodeId: 'n9', cableType: 'Cat6', bandwidth: '1G', lengthMeters: 1 }
  ],
  racks: [], settings: {}
};
const gen = (data: any = ALL, extra: any = {}) => generateStandalone3DViewerHtml(project, snapshot, { runtimeJs: 'x', data, ...extra });
const tbodyRows = (html: string, paneId: string) => {
  const pane = html.match(new RegExp(`id="${paneId}"[\\s\\S]*?<tbody>([\\s\\S]*?)</tbody>`))![1];
  return (pane.match(/<tr>/g) || []).length;
};

t('toSafeJsonForScript không để lọt "<" hay "</script>"', () => {
  const out = toSafeJsonForScript({ a: '</script><!--', b: '&' });
  assert.ok(!out.includes('<'));
  assert.deepEqual(JSON.parse(out), { a: '</script><!--', b: '&' });
});

t('HTML 3D chứa dữ liệu cảnh, runtime và có thể phân tích lại JSON', () => {
  const html = generateStandalone3DViewerHtml(project, snapshot, { runtimeJs: 'window.__rt=1;', data: ALL });
  assert.ok(html.includes('id="hachihi-3d-data"') && html.includes('window.__rt=1;'));
  const payload = payloadOf(html);
  assert.equal(payload.scene.sceneJson.object.name, '</script><b>x</b>');
  assert.equal(payload.nodeInfo.n1.find((r: string[]) => r[0] === 'Địa chỉ IP')[1], '10.0.0.2');
  assert.equal(payload.cableInfo.c1.find((r: string[]) => r[0] === 'Chiều dài')[1], '12 m');
  assert.deepEqual(Object.keys(payload.scene.presets).sort(), ['front', 'iso', 'side', 'top']);
});

t('Đủ 4 nút góc nhìn, có lớp phủ mất context và không có tab 2D khi include2D=false', () => {
  const html = gen(VIEWER_DATA_PREVIEW_ONLY);
  for (const p of ['iso', 'top', 'front', 'side']) assert.ok(html.includes(`data-preset="${p}"`), p);
  assert.ok(html.includes('id="v3d-ctxlost"') && html.includes('id="v3d-reload"'));
  assert.ok(!html.includes('id="tab2d"'));
});

t('Escape tên dự án và chặn </script> trong runtime', () => {
  const html = generateStandalone3DViewerHtml(project, snapshot, { runtimeJs: 'var s="</script><img>";' });
  assert.ok(html.includes('Dự án &lt;demo&gt;'));
  assert.ok(!html.includes('var s="</script>'));
});

t('Thiếu runtime thì báo lỗi rõ ràng, không xuất file hỏng', () => {
  assert.throws(() => generateStandalone3DViewerHtml(project, snapshot, { runtimeJs: '' }), /build:viewer3d/);
});

// ───────── P1.1: bảng thiết bị theo NODE, khớp header ─────────
t('P1.1: header = bảng = số thiết bị thật trong cảnh (bỏ qua stats sai, rack, node ẩn, node ngoài cảnh)', () => {
  const html = gen();
  // Thiết bị trong cảnh: n1, n2, n3, n4  (h1 ẩn, n9 ngoài cảnh, r1 là rack)
  assert.ok(html.includes('4 thiết bị · 1 tủ Rack · 1 tuyến cáp'), 'header');
  assert.ok(html.includes('Thiết bị trong mô hình (4)') && html.includes('Thiết bị trong mô hình 3D (4)'));
  assert.equal(tbodyRows(html, 'viewdev'), 4);
  assert.equal(tbodyRows(html, 'viewcab'), 1);
  assert.ok(!html.includes('99 thiết bị'));
});

t('P1.1: node KHÔNG có asset vẫn có dòng, trường tài sản = "—"', () => {
  const html = gen();
  const row = html.match(/<tr>(?:(?!<\/tr>)[\s\S])*AP-01(?:(?!<\/tr>)[\s\S])*<\/tr>/)![0];
  assert.ok(row.includes('—'));
  assert.ok(!row.includes('10.0.0.2') && !row.includes('Cisco'));
});

t('P1.1: hai node dùng chung asset → đủ hai dòng; asset không tồn tại → không crash, vẫn có dòng', () => {
  const html = gen();
  assert.ok(html.includes('<strong>SW-01</strong>') && html.includes('<strong>SW-02</strong>'));
  assert.ok(html.includes('&lt;img src=x onerror=window.__xss=1&gt;'));
  assert.ok(!html.includes('<img src=x'));
});

t('P1.1: node ẩn / ngoài cảnh / cáp ẩn / cáp ngoài cảnh không xuất hiện', () => {
  const html = gen();
  for (const s of ['AN-HIEN', 'NGOAI-CANH', 'C-AN', 'C-NGOAI']) assert.ok(!html.includes(s), s);
});

t('P1.2: đối tượng ẩn bị loại khỏi sceneJson cùng geometry/material/texture không còn dùng', () => {
  const sj: any = {
    metadata: {}, geometries: [{ uuid: 'g1' }, { uuid: 'g2' }], materials: [{ uuid: 'm1', map: 't1' }, { uuid: 'm2', map: 't2' }],
    textures: [{ uuid: 't1', image: 'i1' }, { uuid: 't2', image: 'i2' }], images: [{ uuid: 'i1' }, { uuid: 'i2' }],
    object: { type: 'Scene', children: [
      { type: 'Mesh', geometry: 'g1', material: 'm1', userData: { nodeId: 'a' } },
      { type: 'Group', visible: false, children: [{ type: 'Mesh', geometry: 'g2', material: 'm2', userData: { nodeId: 'b' } }] }
    ] }
  };
  const out = pruneInvisibleScene(sj);
  assert.equal(out.object.children.length, 1);
  assert.deepEqual(out.geometries.map((g: any) => g.uuid), ['g1']);
  assert.deepEqual(out.materials.map((m: any) => m.uuid), ['m1']);
  assert.deepEqual(out.textures.map((x: any) => x.uuid), ['t1']);
  assert.deepEqual(out.images.map((x: any) => x.uuid), ['i1']);
  assert.equal(sj.object.children.length, 2, 'không sửa đầu vào');
});

t('P1.1: isDeviceNode loại rack/legend/text', () => {
  assert.equal(isDeviceNode({ type: 'device' }), true);
  for (const x of ['rack', 'legend', 'text']) assert.equal(isDeviceNode({ type: x }), false, x);
});

// ───────── P1.2: quyền riêng tư ─────────
t('P1.2: chế độ chỉ xem — payload chỉ gồm trường trong allowlist, không có chuỗi nhạy cảm ở BẤT KỲ đâu', () => {
  const html = gen(VIEWER_DATA_PREVIEW_ONLY);
  const pl = payloadOf(html);
  assert.deepEqual(Object.keys(pl).sort(), ['cableInfo', 'nodeInfo', 'scene']);
  assert.deepEqual(Object.keys(pl.scene).sort(), ['background', 'camera', 'environmentIntensity', 'fogDensity', 'isDark', 'presets', 'sceneJson', 'toneMappingExposure']);
  for (const rows of Object.values(pl.nodeInfo) as string[][][]) {
    for (const [label] of rows) assert.ok((VIEWER_PREVIEW_NODEINFO_LABELS as readonly string[]).includes(label), label);
  }
  assert.deepEqual(pl.cableInfo, {});
  for (const secret of ['10.0.0.2', 'AST-1', 'C9200', 'Cisco', 'Cat6', 'online']) assert.ok(!html.includes(secret), secret);
  assert.ok(!html.includes('id="tabdev"') && !html.includes('id="tabcab"'));
});

t('P1.2: từng nhóm dữ liệu bật/tắt độc lập', () => {
  const only = (k: string) => payloadOf(gen({ ...VIEWER_DATA_PREVIEW_ONLY, [k]: true }));
  const keys = (o: any) => o.nodeInfo.n1.map((r: string[]) => r[0]);
  assert.deepEqual(keys(only('ip')), ['Loại', 'Địa chỉ IP']);
  assert.deepEqual(keys(only('vlan')), ['Loại', 'VLAN']);
  assert.deepEqual(keys(only('status')), ['Loại', 'Trạng thái']);
  assert.ok(keys(only('assetInfo')).includes('Mã tài sản') && !keys(only('assetInfo')).includes('Địa chỉ IP'));
  assert.ok(only('cableInfo').cableInfo.c1);
});

t('P1.2: bảng thiết bị và bảng cáp độc lập với nhau và với cableInfo', () => {
  const devOnly = gen({ ...VIEWER_DATA_PREVIEW_ONLY, deviceTable: true });
  assert.ok(devOnly.includes('id="tabdev"') && !devOnly.includes('id="tabcab"'));
  assert.ok(!devOnly.includes('10.0.0.2') && !devOnly.includes('Cat6'));
  const cabOnly = gen({ ...VIEWER_DATA_PREVIEW_ONLY, cableTable: true });
  assert.ok(cabOnly.includes('id="tabcab"') && !cabOnly.includes('id="tabdev"'));
  assert.deepEqual(payloadOf(cabOnly).cableInfo, {}); // bật bảng cáp không làm rò thông tin khi bấm
});

t('P1.2: cột IP/VLAN trong bảng chỉ có khi bật tương ứng', () => {
  const html = gen({ ...VIEWER_DATA_PREVIEW_ONLY, deviceTable: true });
  assert.ok(!html.includes('<th>IP</th>') && !html.includes('<th>VLAN</th>'));
  const ip = gen({ ...VIEWER_DATA_PREVIEW_ONLY, deviceTable: true, ip: true });
  assert.ok(ip.includes('<th>IP</th>') && ip.includes('10.0.0.2'));
});

// ───────── P1.3: giới hạn dung lượng trước khi ghép HTML ─────────
t('P1.3: vượt maxBytes → ViewerTooLargeError trước khi tạo HTML hoàn chỉnh', () => {
  assert.throws(() => gen(ALL, { runtimeJs: 'y'.repeat(2000), maxBytes: 1000 }), (e: unknown) => e instanceof ViewerTooLargeError);
  assert.doesNotThrow(() => gen(ALL, { maxBytes: 50 * 1024 * 1024 }));
});

t('P2.3: sơ đồ 2D dùng Pointer Events và có nút Vừa màn hình', () => {
  const p2d: any = { ...project, rooms: [], floors: [], layers: [], activeMode: 'floorplan', settings: { hiddenLayers: [] } };
  const html = generateStandalone3DViewerHtml(p2d, snapshot, { runtimeJs: 'x', include2D: true });
  assert.ok(html.includes("addEventListener('pointerdown'") && !html.includes("'mousedown'"));
  assert.ok(html.includes('id="fit2d"') && html.includes('id="tab2d"'));
});

console.log(`\n${passed} viewer3dHtml tests passed`);
