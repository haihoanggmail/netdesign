import { ProjectState } from '../types/infrastructure';
import { utf8ByteLength } from '../services/export/sceneBudget';
import { generatePureSvgMarkup } from './svgExport';
import { APP_BUILD_HASH, APP_PRODUCT_NAME, APP_VERSION, BRAND_INFO } from '../config/appInfo';
import type { Scene3DSnapshot } from '../contexts/ViewportContext';

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Exports a self-contained, zero-dependency Read-Only HTML Viewer file (.html)
 * allowing clients or field technicians to pan/zoom the diagram and browse BOM/Cable tables offline.
 */
export function generateStandaloneViewerHtml(project: ProjectState): string {
  const svgMarkup = generatePureSvgMarkup(project, { darkTheme: false, includeTitleBlock: true });
  const assets = Object.values(project.assets);

  const deviceRowsHtml = assets.map(a => `
    <tr>
      <td><code>${escapeHtml(a.assetTag)}</code></td>
      <td><strong>${escapeHtml(a.name)}</strong></td>
      <td>${escapeHtml(a.category)}</td>
      <td>${escapeHtml(a.vendor)} ${escapeHtml(a.model)}</td>
      <td><code>${escapeHtml(a.ipAddress || '—')}</code></td>
      <td>${escapeHtml(a.vlan || '—')}</td>
      <td>${a.powerWatts || 0} W</td>
    </tr>
  `).join('');

  const cableRowsHtml = project.cables.map(c => {
    const src = project.nodes.find(n => n.id === c.sourceNodeId)?.label || c.sourceNodeId;
    const tgt = project.nodes.find(n => n.id === c.targetNodeId)?.label || c.targetNodeId;
    return `
      <tr>
        <td><code>${escapeHtml(c.cableCode)}</code></td>
        <td>${escapeHtml(src)}</td>
        <td>${escapeHtml(tgt)}</td>
        <td>${escapeHtml(c.cableType)}</td>
        <td>${escapeHtml(c.bandwidth)}</td>
        <td>${c.lengthMeters || 0} m</td>
      </tr>
    `;
  }).join('');

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="referrer" content="no-referrer" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; base-uri 'none';" />
  <title>${escapeHtml(project.name)} — HACHIHI Read-Only Viewer</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; background: #f8fafc; color: #0f172a; }
    header { background: #1d4ed8; color: #fff; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
    header h1 { margin: 0; font-size: 16px; }
    header .meta { font-size: 12px; opacity: 0.9; }
    .toolbar { background: #fff; border-bottom: 1px solid #e2e8f0; padding: 8px 20px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    button { border: 1px solid #cbd5e1; background: #fff; color: #0f172a; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; }
    button.active { background: #1d4ed8; color: #fff; border-color: #1d4ed8; }
    .viewport { height: 70vh; overflow: hidden; background: #f1f5f9; border-bottom: 1px solid #e2e8f0; position: relative; cursor: grab; }
    .viewport:active { cursor: grabbing; }
    #stage { transform-origin: 0 0; width: 100%; height: 100%; }
    #stage svg { width: 100%; height: 100%; display: block; }
    .tables { max-width: 1280px; margin: 20px auto; padding: 0 20px 40px; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e2e8f0; margin-top: 8px; font-size: 12px; }
    th, td { border: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; }
    th { background: #f8fafc; font-weight: 700; color: #334155; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>${escapeHtml(project.name)}</h1>
      <div class="meta">HACHIHI Read-Only Infrastructure Viewer · Tác giả: ${escapeHtml(project.author)} · Phiên bản: ${escapeHtml(project.version)}</div>
    </div>
    <div class="meta">${assets.length} Thiết bị · ${project.cables.length} Tuyến cáp · ${project.racks.length} Tủ Rack</div>
  </header>
  <div class="toolbar">
    <button id="btnZoomIn">Phóng to (+)</button>
    <button id="btnZoomOut">Thu nhỏ (-)</button>
    <button id="btnReset">Vừa màn hình</button>
    <span style="flex:1"></span>
    <button id="tabDiag" class="active">Sơ đồ</button>
    <button id="tabDevices">Thiết bị (${assets.length})</button>
    <button id="tabCables">Cáp nối (${project.cables.length})</button>
  </div>
  <div id="viewDiag" class="viewport">
    <div id="stage">${svgMarkup}</div>
  </div>
  <div id="viewDevices" class="tables hidden">
    <h2>Danh sách Thiết bị (${assets.length})</h2>
    <table><thead><tr><th>Mã TS</th><th>Tên</th><th>Loại</th><th>Model</th><th>IP</th><th>VLAN</th><th>Công suất</th></tr></thead><tbody>${deviceRowsHtml}</tbody></table>
  </div>
  <div id="viewCables" class="tables hidden">
    <h2>Danh bạ Đấu nối Cáp (${project.cables.length})</h2>
    <table><thead><tr><th>Mã cáp</th><th>Nguồn</th><th>Đích</th><th>Loại cáp</th><th>Băng thông</th><th>Dài (m)</th></tr></thead><tbody>${cableRowsHtml}</tbody></table>
  </div>
  <footer style="border-top:1px solid #e2e8f0;background:#fff;padding:10px 20px;font-size:12px;color:#475569;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;">
    <span>${escapeHtml(APP_PRODUCT_NAME)} · Phiên bản ${escapeHtml(APP_VERSION)} (${escapeHtml(APP_BUILD_HASH)})</span>
    <span>${escapeHtml(BRAND_INFO.websiteLabel)} · Hotline: ${escapeHtml(BRAND_INFO.hotlineDisplay)}</span>
  </footer>
  <script>
    (function(){
      var stage = document.getElementById('stage');
      var vp = document.getElementById('viewDiag');
      var scale = 1, tx = 0, ty = 0, dragging = false, sx = 0, sy = 0;
      function apply(){ stage.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')'; }
      vp.addEventListener('mousedown', function(e){ dragging = true; sx = e.clientX - tx; sy = e.clientY - ty; });
      window.addEventListener('mousemove', function(e){ if(!dragging) return; tx = e.clientX - sx; ty = e.clientY - sy; apply(); });
      window.addEventListener('mouseup', function(){ dragging = false; });
      vp.addEventListener('wheel', function(e){ e.preventDefault(); scale = Math.min(4, Math.max(0.3, scale * (e.deltaY < 0 ? 1.12 : 0.89))); apply(); }, { passive: false });
      document.getElementById('btnZoomIn').onclick = function(){ scale = Math.min(4, scale * 1.2); apply(); };
      document.getElementById('btnZoomOut').onclick = function(){ scale = Math.max(0.3, scale * 0.82); apply(); };
      document.getElementById('btnReset').onclick = function(){ scale = 1; tx = 0; ty = 0; apply(); };
      function showTab(tab){
        ['viewDiag','viewDevices','viewCables'].forEach(function(id){ document.getElementById(id).classList.add('hidden'); });
        ['tabDiag','tabDevices','tabCables'].forEach(function(id){ document.getElementById(id).classList.remove('active'); });
        document.getElementById(tab.view).classList.remove('hidden');
        document.getElementById(tab.btn).classList.add('active');
      }
      document.getElementById('tabDiag').onclick = function(){ showTab({view:'viewDiag',btn:'tabDiag'}); };
      document.getElementById('tabDevices').onclick = function(){ showTab({view:'viewDevices',btn:'tabDevices'}); };
      document.getElementById('tabCables').onclick = function(){ showTab({view:'viewCables',btn:'tabCables'}); };
    })();
  </script>
</body>
</html>`;
}

export function exportProjectToHtmlViewer(project: ProjectState) {
  const html = generateStandaloneViewerHtml(project);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${project.name.replace(/\s+/g, '_')}_Viewer.html`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}


// ───────────────────────────────────────────────────────────────────────────
// Trình xem HTML 3D độc lập: xoay ngang/dọc, zoom, pan, đổi góc nhìn như trong phần mềm.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Nhóm dữ liệu hạ tầng được phép nhúng vào file HTML 3D. Mặc định KHÔNG nhúng gì
 * (chỉ mô hình + tên đối tượng) để file gửi bên thứ ba không lộ IP/VLAN/tài sản.
 */
export interface ViewerDataOptions {
  assetInfo: boolean;
  ip: boolean;
  vlan: boolean;
  status: boolean;
  cableInfo: boolean;
  /** Kèm tab bảng Thiết bị (theo NODE có trong mô hình 3D; trường tài sản thiếu hiển thị "—"). */
  deviceTable: boolean;
  /** Kèm tab bảng Cáp (chỉ cáp có trong mô hình 3D). Độc lập với `cableInfo` (thông tin khi bấm vào cáp). */
  cableTable: boolean;
}

/**
 * Chế độ "chỉ xem mô hình": mọi nhóm dữ liệu hạ tầng đều tắt.
 * Vẫn luôn nhúng (không thể tắt): tên/nhãn đối tượng, loại nút (device/rack/...) hiển thị khi bấm,
 * hình học cảnh 3D. Xem VIEWER_ALWAYS_EMBEDDED.
 */
export const VIEWER_DATA_PREVIEW_ONLY: ViewerDataOptions = {
  assetInfo: false, ip: false, vlan: false, status: false, cableInfo: false, deviceTable: false, cableTable: false
};

/** Danh sách công khai những gì LUÔN nằm trong file, kể cả ở chế độ chỉ xem. */
export const VIEWER_ALWAYS_EMBEDDED = ['tên/nhãn đối tượng', 'loại nút (device, rack...)', 'hình học cảnh 3D'] as const;

/** Nhãn "Loại" cho phép xuất hiện trong nodeInfo ở chế độ chỉ xem (allowlist, dùng cho test payload). */
export const VIEWER_PREVIEW_NODEINFO_LABELS = ['Loại'] as const;

/** Định nghĩa DUY NHẤT của "thiết bị" cho header, tab và bảng: node trong cảnh, không phải rack/legend/text. */
export function isDeviceNode(n: { type: string }): boolean {
  return n.type !== 'rack' && n.type !== 'legend' && n.type !== 'text';
}

export class ViewerTooLargeError extends Error {
  readonly bytes: number;
  constructor(bytes: number, maxBytes: number) {
    super(`File HTML 3D dự kiến ${(bytes / 1048576).toFixed(0)} MB, vượt giới hạn ${(maxBytes / 1048576).toFixed(0)} MB. Hãy ẩn bớt tầng/lớp rồi xuất lại.`);
    this.name = 'ViewerTooLargeError';
    this.bytes = bytes;
  }
}

export interface Standalone3DViewerOptions {
  data?: ViewerDataOptions;
  /** Khối JS (IIFE) của runtime trình xem — sinh bởi scripts/build-viewer3d.mjs. */
  runtimeJs: string;
  /** Kèm tab sơ đồ 2D (khi người dùng chọn phạm vi "Cả 2D và 3D"). */
  include2D?: boolean;
  /**
   * Giới hạn cứng (byte). Được kiểm tra trên payload JSON + runtime TRƯỚC khi ghép chuỗi HTML hoàn chỉnh,
   * nên cảnh quá lớn bị từ chối mà chưa tốn thêm bộ nhớ cho HTML.
   */
  maxBytes?: number;
}

/** Chuỗi JSON an toàn để đặt trong <script type="application/json">. */
export function toSafeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Gom nodeId / cableId của mọi đối tượng thật sự có trong cảnh 3D đã chụp. */
export function collectSceneIds(sceneJson: unknown): { nodeIds: Set<string>; cableIds: Set<string> } {
  const nodeIds = new Set<string>();
  const cableIds = new Set<string>();
  const walk = (o: any) => {
    if (!o || typeof o !== 'object') return;
    if (o.visible === false) return; // Object3D.toJSON ghi visible:false cho đối tượng ẩn -> không tính vào phạm vi xuất
    const ud = o.userData;
    if (ud && typeof ud === 'object') {
      if (typeof ud.nodeId === 'string') nodeIds.add(ud.nodeId);
      if (typeof ud.cableId === 'string') cableIds.add(ud.cableId);
    }
    if (Array.isArray(o.children)) o.children.forEach(walk);
  };
  walk((sceneJson as any)?.object);
  return { nodeIds, cableIds };
}

/**
 * Bỏ khỏi JSON cảnh mọi đối tượng đang ẩn (visible:false) cùng toàn bộ nhánh con, rồi lọc luôn
 * geometries/materials/textures/images không còn được tham chiếu. Nếu không, nhãn và hình học của
 * đối tượng ẩn vẫn nằm trong file và nút bật/tắt trong viewer có thể làm chúng hiện ra.
 * Không sửa đối tượng đầu vào (trả về bản mới).
 */
export function pruneInvisibleScene(sceneJson: Record<string, any>): Record<string, any> {
  const root = (sceneJson as any)?.object;
  if (!root || typeof root !== 'object') return sceneJson;
  const prune = (o: any): any => {
    const out: any = { ...o };
    if (Array.isArray(o.children)) {
      out.children = o.children.filter((c: any) => c && c.visible !== false).map(prune);
    }
    return out;
  };
  const object = prune(root);

  const geoUsed = new Set<string>();
  const matUsed = new Set<string>();
  const walk = (o: any) => {
    if (typeof o.geometry === 'string') geoUsed.add(o.geometry);
    if (typeof o.material === 'string') matUsed.add(o.material);
    else if (Array.isArray(o.material)) o.material.forEach((m: unknown) => typeof m === 'string' && matUsed.add(m));
    (o.children || []).forEach(walk);
  };
  walk(object);

  const result: Record<string, any> = { ...sceneJson, object };
  if (Array.isArray(sceneJson.geometries)) result.geometries = sceneJson.geometries.filter((g: any) => geoUsed.has(g.uuid));
  if (Array.isArray(sceneJson.materials)) {
    result.materials = sceneJson.materials.filter((m: any) => matUsed.has(m.uuid));
    const strings = new Set<string>();
    for (const m of result.materials) for (const v of Object.values(m)) if (typeof v === 'string') strings.add(v);
    if (Array.isArray(sceneJson.textures)) {
      result.textures = sceneJson.textures.filter((t: any) => strings.has(t.uuid));
      const imgUsed = new Set<string>(result.textures.map((t: any) => t.image).filter((x: unknown) => typeof x === 'string'));
      if (Array.isArray(sceneJson.images)) result.images = sceneJson.images.filter((i: any) => imgUsed.has(i.uuid));
    }
  }
  return result;
}

function buildNodeInfo(
  project: ProjectState,
  data: ViewerDataOptions,
  nodeIds: Set<string>
): Record<string, Array<[string, string]>> {
  const out: Record<string, Array<[string, string]>> = {};
  for (const n of project.nodes) {
    if (!nodeIds.has(n.id)) continue;
    const rows: Array<[string, string]> = [['Loại', String(n.type)]];
    const a = n.assetId ? project.assets[n.assetId] : undefined;
    if (a) {
      if (data.assetInfo) {
        rows.push(['Mã tài sản', a.assetTag || '—']);
        rows.push(['Danh mục', String(a.category)]);
        rows.push(['Hãng / Model', `${a.vendor || ''} ${a.model || ''}`.trim() || '—']);
        rows.push(['Công suất', `${a.powerWatts || 0} W`]);
      }
      if (data.ip) rows.push(['Địa chỉ IP', a.ipAddress || '—']);
      if (data.vlan) rows.push(['VLAN', a.vlan || '—']);
      if (data.status) rows.push(['Trạng thái', String(a.status)]);
    }
    out[n.id] = rows;
  }
  return out;
}

function buildCableInfo(
  project: ProjectState,
  data: ViewerDataOptions,
  cableIds: Set<string>
): Record<string, Array<[string, string]>> {
  const out: Record<string, Array<[string, string]>> = {};
  if (!data.cableInfo) return out;
  const labelOf = (id: string) => project.nodes.find(n => n.id === id)?.label || id;
  for (const c of project.cables) {
    if (!cableIds.has(c.id)) continue;
    out[c.id] = [
      ['Nguồn', labelOf(c.sourceNodeId)],
      ['Đích', labelOf(c.targetNodeId)],
      ['Loại cáp', String(c.cableType)],
      ['Băng thông', String(c.bandwidth)],
      ['Chiều dài', `${c.lengthMeters || 0} m`]
    ];
  }
  return out;
}

export function generateStandalone3DViewerHtml(
  project: ProjectState,
  snapshot: Scene3DSnapshot,
  options: Standalone3DViewerOptions
): string {
  if (!options.runtimeJs) {
    throw new Error(
      'Chưa có mã trình xem 3D. Hãy chạy "npm run build:viewer3d" (tự động chạy khi dev/build) rồi thử lại.'
    );
  }

  const data = options.data ?? VIEWER_DATA_PREVIEW_ONLY;
  const prunedScene = pruneInvisibleScene(snapshot.sceneJson as Record<string, any>);
  const { nodeIds, cableIds } = collectSceneIds(prunedScene);
  const include2D = Boolean(options.include2D);
  const svgMarkup = include2D
    ? generatePureSvgMarkup(project, { darkTheme: false, includeTitleBlock: true })
    : '';

  // Bảng thiết bị lập theo NODE có trong cảnh 3D (không theo asset): node thiếu asset vẫn có dòng, trường tài sản = "—".
  const sceneDeviceNodes = project.nodes.filter(n => nodeIds.has(n.id) && isDeviceNode(n));
  const sceneRackCount = project.nodes.filter(n => nodeIds.has(n.id) && n.type === 'rack').length;
  const sceneCables = project.cables.filter(c => cableIds.has(c.id));
  const showDevTable = data.deviceTable;
  const showCabTable = data.cableTable;

  type DevNode = (typeof sceneDeviceNodes)[number];
  const assetOf = (n: DevNode) => (n.assetId ? project.assets[n.assetId] : undefined);
  const dash = '—';
  const devCols: Array<[string, (n: DevNode) => string]> = [
    ['Tên', n => `<strong>${escapeHtml(n.label || n.id)}</strong>`],
    ['Loại', n => escapeHtml(String(assetOf(n)?.category ?? n.type))]
  ];
  if (data.assetInfo) {
    devCols.unshift(['Mã TS', n => { const a = assetOf(n); return a ? `<code>${escapeHtml(a.assetTag || dash)}</code>` : dash; }]);
    devCols.push(
      ['Model', n => { const a = assetOf(n); return a ? escapeHtml(`${a.vendor || ''} ${a.model || ''}`.trim() || dash) : dash; }],
      ['Công suất', n => { const a = assetOf(n); return a ? `${Number(a.powerWatts) || 0} W` : dash; }]
    );
  }
  if (data.ip) devCols.push(['IP', n => { const a = assetOf(n); return a ? `<code>${escapeHtml(a.ipAddress || dash)}</code>` : dash; }]);
  if (data.vlan) devCols.push(['VLAN', n => { const a = assetOf(n); return a ? escapeHtml(a.vlan || dash) : dash; }]);
  if (data.status) devCols.push(['Trạng thái', n => { const a = assetOf(n); return a ? escapeHtml(String(a.status)) : dash; }]);
  const devHead = devCols.map(c => `<th>${c[0]}</th>`).join('');
  const deviceRowsHtml = sceneDeviceNodes
    .map(n => `<tr>${devCols.map(c => `<td>${c[1](n)}</td>`).join('')}</tr>`)
    .join('');

  const cableRowsHtml = sceneCables
    .map(c => {
      const src = project.nodes.find(n => n.id === c.sourceNodeId)?.label || c.sourceNodeId;
      const tgt = project.nodes.find(n => n.id === c.targetNodeId)?.label || c.targetNodeId;
      return `<tr><td><code>${escapeHtml(c.cableCode)}</code></td><td>${escapeHtml(src)}</td><td>${escapeHtml(tgt)}</td><td>${escapeHtml(c.cableType)}</td><td>${escapeHtml(c.bandwidth)}</td><td>${c.lengthMeters || 0} m</td></tr>`;
    })
    .join('');

  const payload = {
    scene: {
      sceneJson: prunedScene,
      isDark: snapshot.isDark,
      background: snapshot.background,
      fogDensity: snapshot.fogDensity,
      environmentIntensity: snapshot.environmentIntensity,
      toneMappingExposure: snapshot.toneMappingExposure,
      camera: snapshot.camera,
      presets: snapshot.presets
    },
    nodeInfo: buildNodeInfo(project, data, nodeIds),
    cableInfo: buildCableInfo(project, data, cableIds)
  };

  const payloadJson = toSafeJsonForScript(payload);
  if (options.maxBytes) {
    // Kiểm tra TRƯỚC khi ghép HTML hoàn chỉnh: chỉ đo độ dài, không cấp phát thêm chuỗi lớn.
    const est = utf8ByteLength(payloadJson) + utf8ByteLength(options.runtimeJs) + utf8ByteLength(svgMarkup) + 64 * 1024;
    if (est > options.maxBytes) throw new ViewerTooLargeError(est, options.maxBytes);
  }

  const tab2D = include2D ? '<button id="tab2d" class="tab">Sơ đồ 2D</button>' : '';
  const view2D = include2D
    ? `<div id="view2d" class="pane hidden"><div class="pane2d"><div id="stage2d">${svgMarkup}</div><button id="fit2d" style="position:absolute;left:12px;top:12px;z-index:2">Vừa màn hình</button></div></div>`
    : '';
  const tabIds = ['3d', ...(include2D ? ['2d'] : []), ...(showDevTable ? ['dev'] : []), ...(showCabTable ? ['cab'] : [])];

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="referrer" content="no-referrer" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; connect-src data: blob:; base-uri 'none';" />
  <title>${escapeHtml(project.name)} — HACHIHI 3D Viewer</title>
  <style>
    :root { --bg:#f8fafc; --panel:#ffffff; --line:#e2e8f0; --ink:#0f172a; --muted:#475569; --brand:#1d4ed8; }
    body.dark { --bg:#0b1120; --panel:#111a2e; --line:#243049; --ink:#e2e8f0; --muted:#94a3b8; --brand:#3b82f6; }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body { margin:0; display:flex; flex-direction:column; font-family:system-ui,-apple-system,'Segoe UI',sans-serif; background:var(--bg); color:var(--ink); }
    header { background:var(--brand); color:#fff; padding:10px 18px; display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
    header h1 { margin:0; font-size:16px; }
    header .meta { font-size:12px; opacity:.92; }
    nav { background:var(--panel); border-bottom:1px solid var(--line); padding:6px 14px; display:flex; gap:6px; flex-wrap:wrap; }
    button { border:1px solid var(--line); background:var(--panel); color:var(--ink); padding:6px 11px; border-radius:7px; font-size:12px; font-weight:600; cursor:pointer; }
    button:hover { border-color:var(--brand); }
    button.active, button.tab.active { background:var(--brand); color:#fff; border-color:var(--brand); }
    main { flex:1; min-height:0; position:relative; }
    .pane { position:absolute; inset:0; }
    .hidden { display:none !important; }
    #v3d-root { position:absolute; inset:0; background:var(--bg); }
    #v3d-stage { position:absolute; inset:0; }
    .v3d-bar { position:absolute; left:12px; top:12px; display:flex; gap:6px; flex-wrap:wrap; max-width:calc(100% - 24px); z-index:3; }
    .v3d-bar .grp { display:flex; gap:4px; padding:4px; background:color-mix(in srgb, var(--panel) 88%, transparent); border:1px solid var(--line); border-radius:10px; backdrop-filter:blur(6px); }
    .v3d-bar button { padding:5px 9px; }
    .v3d-help { position:absolute; left:12px; bottom:12px; z-index:3; font-size:11px; color:var(--muted); background:color-mix(in srgb, var(--panel) 88%, transparent); border:1px solid var(--line); border-radius:8px; padding:6px 10px; line-height:1.5; max-width:min(520px, calc(100% - 24px)); }
    #v3d-tip { position:fixed; display:none; pointer-events:none; z-index:9; background:#0f172a; color:#fff; font-size:12px; padding:4px 8px; border-radius:6px; }
    #v3d-info { position:absolute; right:12px; top:12px; width:260px; max-width:calc(100% - 24px); display:none; z-index:4; background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:10px 12px; font-size:12px; box-shadow:0 8px 24px rgba(0,0,0,.18); }
    .v3d-info-title { font-weight:800; font-size:13px; margin-bottom:6px; word-break:break-word; }
    .v3d-info-row { display:flex; justify-content:space-between; gap:10px; padding:3px 0; border-top:1px solid var(--line); }
    .v3d-info-row span { color:var(--muted); } .v3d-info-row b { text-align:right; word-break:break-word; }
    #v3d-loading, #v3d-fatal { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; text-align:center; padding:24px; z-index:5; font-size:14px; background:var(--bg); }
    #v3d-fatal { display:none; color:#b91c1c; }
    #v3d-ctxlost { position:absolute; inset:0; display:none; align-items:center; justify-content:center; text-align:center; padding:24px; z-index:6; font-size:14px; background:var(--bg); color:#b45309; }
    .scroll { position:absolute; inset:0; overflow:auto; padding:16px 20px 40px; }
    .scroll > div { max-width:1280px; margin:0 auto; }
    table { width:100%; border-collapse:collapse; background:var(--panel); border:1px solid var(--line); margin-top:8px; font-size:12px; }
    th, td { border:1px solid var(--line); padding:7px 9px; text-align:left; }
    th { background:var(--bg); font-weight:700; }
    .pane2d { position:absolute; inset:0; overflow:hidden; background:#f1f5f9; cursor:grab; }
    #stage2d { transform-origin:0 0; width:100%; height:100%; } #stage2d svg { width:100%; height:100%; display:block; }
    footer { border-top:1px solid var(--line); background:var(--panel); padding:8px 18px; font-size:12px; color:var(--muted); display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px; }
  </style>
</head>
<body class="${snapshot.isDark ? 'dark' : ''}">
  <header>
    <div>
      <h1>${escapeHtml(project.name)}</h1>
      <div class="meta">HACHIHI 3D Viewer · Tác giả: ${escapeHtml(project.author)} · Phiên bản: ${escapeHtml(project.version)}</div>
    </div>
    <div class="meta">Đối tượng trong mô hình 3D: ${sceneDeviceNodes.length} thiết bị · ${sceneRackCount} tủ Rack · ${sceneCables.length} tuyến cáp</div>
  </header>
  <nav>
    <button id="tab3d" class="tab active">Mô hình 3D</button>
    ${tab2D}
    ${showDevTable ? `<button id="tabdev" class="tab">Thiết bị trong mô hình (${sceneDeviceNodes.length})</button>` : ''}
    ${showCabTable ? `<button id="tabcab" class="tab">Cáp trong mô hình (${sceneCables.length})</button>` : ''}
  </nav>
  <main>
    <div id="view3d" class="pane">
      <div id="v3d-root">
        <div id="v3d-stage"></div>
        <div class="v3d-bar">
          <div class="grp">
            <button data-preset="iso" title="Phím 1">Isometric</button>
            <button data-preset="top" title="Phím 2">Trên xuống</button>
            <button data-preset="front" title="Phím 3">Mặt trước</button>
            <button data-preset="side" title="Phím 4">Mặt bên</button>
          </div>
          <div class="grp">
            <button id="v3d-zoom-in" title="Phóng to (+)">＋</button>
            <button id="v3d-zoom-out" title="Thu nhỏ (−)">－</button>
            <button id="v3d-reset" title="Đặt lại (R)">Đặt lại</button>
            <button id="v3d-auto" title="Tự xoay (A)">Tự xoay</button>
          </div>
          <div class="grp">
            <button id="v3d-cables" title="Bật/tắt cáp">Cáp</button>
            <button id="v3d-labels" title="Bật/tắt nhãn">Nhãn</button>
            <button id="v3d-shot" title="Lưu ảnh PNG góc đang xem">Ảnh PNG</button>
            <button id="v3d-theme" title="Đổi giao diện sáng/tối (bảng điều khiển và nền cảnh 3D)">Sáng/Tối</button>
            <button id="v3d-full" title="Toàn màn hình">Toàn màn hình</button>
          </div>
        </div>
        <div class="v3d-help">Kéo chuột trái: xoay ngang/dọc · Kéo chuột phải (hoặc Shift + kéo): dịch chuyển · Cuộn chuột / chụm 2 ngón: phóng to – thu nhỏ · Bấm vào thiết bị hoặc cáp để xem thông tin · Phím 1–4: đổi góc nhìn</div>
        <div id="v3d-info"></div>
        <div id="v3d-loading">Đang dựng mô hình 3D…</div>
        <div id="v3d-fatal"></div>
        <div id="v3d-ctxlost" role="alert"><div><b>Mất kết nối đồ họa (WebGL context lost).</b><br>Đang chờ trình duyệt khôi phục. Nếu không tự khôi phục, hãy tải lại file này.<br><button id="v3d-reload" type="button">Tải lại trang</button></div></div>
      </div>
      <div id="v3d-tip"></div>
    </div>
    ${view2D}
    ${showDevTable ? `<div id="viewdev" class="pane hidden"><div class="scroll"><div>
      <h2>Thiết bị trong mô hình 3D (${sceneDeviceNodes.length})</h2>
      <table><thead><tr>${devHead}</tr></thead><tbody>${deviceRowsHtml}</tbody></table>
    </div></div></div>` : ''}
    ${showCabTable ? `<div id="viewcab" class="pane hidden"><div class="scroll"><div>
      <h2>Cáp trong mô hình 3D (${sceneCables.length})</h2>
      <table><thead><tr><th>Mã cáp</th><th>Nguồn</th><th>Đích</th><th>Loại cáp</th><th>Băng thông</th><th>Dài (m)</th></tr></thead><tbody>${cableRowsHtml}</tbody></table>
    </div></div></div>` : ''}
  </main>
  <footer>
    <span>${escapeHtml(APP_PRODUCT_NAME)} · Phiên bản ${escapeHtml(APP_VERSION)} (${escapeHtml(APP_BUILD_HASH)})</span>
    <span>${escapeHtml(BRAND_INFO.websiteLabel)} · Hotline: ${escapeHtml(BRAND_INFO.hotlineDisplay)}</span>
  </footer>
  <script type="application/json" id="hachihi-3d-data">${payloadJson}</script>
  <script>
    (function(){
      var ids = ${JSON.stringify(tabIds)};
      var map = { '3d':['tab3d','view3d'], '2d':['tab2d','view2d'], 'dev':['tabdev','viewdev'], 'cab':['tabcab','viewcab'] };
      function show(key){
        ids.forEach(function(k){
          var b = document.getElementById(map[k][0]), v = document.getElementById(map[k][1]);
          if(!b || !v) return;
          b.classList.toggle('active', k === key);
          v.classList.toggle('hidden', k !== key);
        });
        window.dispatchEvent(new Event('resize'));
      }
      ids.forEach(function(k){ var b = document.getElementById(map[k][0]); if(b) b.onclick = function(){ show(k); }; });
      var st = document.getElementById('stage2d'), vp = st && st.parentElement;
      if (st && vp) {
        var sc = 1, tx = 0, ty = 0, pts = {}, lastDist = 0, lastX = 0, lastY = 0;
        vp.style.touchAction = 'none';
        var clampPan = function(){
          var w = vp.clientWidth, h = vp.clientHeight, m = 80;
          tx = Math.min(w - m, Math.max(m - w * sc, tx));
          ty = Math.min(h - m, Math.max(m - h * sc, ty));
        };
        var ap = function(){ clampPan(); st.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + sc + ')'; };
        var zoomAt = function(f, cx, cy){
          var ns = Math.min(8, Math.max(0.2, sc * f)), k = ns / sc;
          tx = cx - (cx - tx) * k; ty = cy - (cy - ty) * k; sc = ns; ap();
        };
        var ids2 = function(){ return Object.keys(pts); };
        vp.addEventListener('pointerdown', function(e){ vp.setPointerCapture(e.pointerId); pts[e.pointerId] = {x:e.clientX,y:e.clientY}; lastX = e.clientX; lastY = e.clientY; lastDist = 0; });
        vp.addEventListener('pointermove', function(e){
          if (!pts[e.pointerId]) return;
          pts[e.pointerId] = {x:e.clientX,y:e.clientY};
          var k = ids2();
          if (k.length >= 2) {
            var a = pts[k[0]], b = pts[k[1]], d = Math.hypot(a.x-b.x, a.y-b.y), r = vp.getBoundingClientRect();
            if (lastDist) zoomAt(d / lastDist, (a.x+b.x)/2 - r.left, (a.y+b.y)/2 - r.top);
            lastDist = d;
          } else {
            tx += e.clientX - lastX; ty += e.clientY - lastY; ap();
          }
          lastX = e.clientX; lastY = e.clientY;
        });
        var up = function(e){ delete pts[e.pointerId]; lastDist = 0; var k = ids2(); if (k.length === 1) { lastX = pts[k[0]].x; lastY = pts[k[0]].y; } };
        vp.addEventListener('pointerup', up); vp.addEventListener('pointercancel', up);
        vp.addEventListener('wheel', function(e){ e.preventDefault(); var r = vp.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.12 : 0.89, e.clientX - r.left, e.clientY - r.top); }, { passive:false });
        var fit = document.getElementById('fit2d');
        if (fit) fit.onclick = function(){ sc = 1; tx = 0; ty = 0; ap(); };
      }
    })();
  </script>
  <script>${options.runtimeJs.replace(/<\/script/gi, '<\\/script')}</script>
</body>
</html>`;
}

export function exportProject3DToHtmlViewer(
  project: ProjectState,
  snapshot: Scene3DSnapshot,
  options: Standalone3DViewerOptions,
  filename: string
): void {
  const html = generateStandalone3DViewerHtml(project, snapshot, options);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
