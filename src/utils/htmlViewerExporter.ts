import { ProjectState } from '../types/infrastructure';
import { generatePureSvgMarkup } from './svgExport';
import { APP_BUILD_HASH, APP_PRODUCT_NAME, APP_VERSION, BRAND_INFO } from '../config/appInfo';

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
