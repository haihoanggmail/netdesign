## Unreleased

### Fixed
- 3D: khi đã mở khóa, giờ có thể thêm thiết bị. Nút "Thêm thiết bị" (QuickAccessBar), thư viện thiết bị (nhấp đúp / nút +) và kéo thả vào cảnh 3D đều hoạt động. Thiết bị mới được đặt tại tâm khung nhìn camera (hoặc đúng điểm thả trên mặt sàn).

# Nhật ký thay đổi (CHANGELOG)

Tài liệu này ghi nhận các thay đổi quan trọng của **HACHIHI Network & Electrical Designer** theo chuẩn [Keep a Changelog](https://keepachangelog.com/vi/1.0.0/) và đánh số phiên bản theo [SemVer](https://semver.org/).

## [V2.8 – Final Release Hardening, chưa phát hành] — sửa các điểm chặn của thẩm định V2.7

> Trạng thái kiểm chứng (nói thẳng): các unit test mới (`viewer3dHtml`, `sceneBudget`) đã chạy xanh bằng `tsx` trong môi trường soạn thảo.
> `viewer3dBundle.test.ts`, toàn bộ E2E mới, `npm run build` và `npm run lint` CHƯA được chạy ở đây (không có `node_modules`/mạng) —
> phải chạy trên máy sạch/CI trước khi coi là đạt. Không có số liệu hiệu năng/CPU/RAM/GPU nào được đo.

| Mục | File / hàm đã sửa | Nguyên nhân gốc | Test chứng minh |
|---|---|---|---|
| P0.1 | `package.json` (`predev:vite`, `pretest:e2e`), `scripts/build-viewer3d.mjs` (kiểm tra kích thước + marker, DỪNG build nếu rỗng), `exportHtml3d.ts` (`isViewer3DRuntimeReady`), `ExportModal.tsx` (khóa nút khi chưa có runtime), CI job `readme-commands` | npm chỉ chạy hook `pre<script>` trùng tên; `dev:vite` không có `predev:vite` nên file generated vẫn là placeholder rỗng | `viewer3dBundle.test.ts` (READY=true, bundle > 100 KB, chứa runtime/three/xử lý mất context), CI `readme-commands` chạy đúng lệnh README rồi kiểm tra file generated |
| P0.2 | `e2e/export-3d-viewer.spec.ts`, `viewer-webgl-recovery.spec.ts`, `viewer-data-privacy.spec.ts`, `e2e/helpers/*` | Chỉ có unit test giả lập, chưa chạy runtime thật | Mở HTML đã xuất trong Chromium mới, chặn mọi request ngoài file/data/blob: dựng cảnh, xoay/zoom/pan, 4 góc nhìn, auto-rotate, bật/tắt cáp & nhãn, chọn thiết bị, theme, PNG, console sạch, RAF dừng khi đứng yên. **Lưu ý:** HTML được sinh bằng `make-viewer-fixture.ts` (three thật + `scene.toJSON()` + runtime thật), chưa phải bấm nút Xuất trong UI ứng dụng |
| P1.1 | `htmlViewerExporter.ts` (`isDeviceNode`, bảng theo NODE, header/tab lấy cùng một danh sách, trường tài sản thiếu = "—") | Bảng lấy theo `assetId` còn header lấy `snapshot.stats.devices` | `viewer3dHtml.test.ts`: stats cố tình sai (99), node thiếu asset, hai node chung asset, asset không tồn tại, node ẩn, node ngoài cảnh, rack |
| P1.2 | `htmlViewerExporter.ts` (`deviceTable`/`cableTable` tách riêng, `VIEWER_ALWAYS_EMBEDDED`, `pruneInvisibleScene`), `ExportModal.tsx` | Hai bảng bị gắn chung 1 cờ và bảng cáp phụ thuộc `cableInfo`; **phát hiện thêm khi viết test:** `scene.toJSON()` vẫn nhúng đối tượng `visible:false` (nhãn, hình học) và nút bật cáp trong viewer có thể làm chúng hiện ra | Test allowlist payload + quét toàn bộ HTML tìm chuỗi nhạy cảm + `pruneInvisibleScene` (cả geometry/material/texture/image); E2E `viewer-data-privacy` |
| P1.3 | `sceneBudget.ts` (`estimateSceneBudget`, `assertSceneBudget`, `utf8ByteLength`), `Network3DScene.tsx` (`exportSceneSnapshot`: kiểm tra TRƯỚC `toJSON`), `htmlViewerExporter.ts` (`maxBytes` kiểm tra payload trước khi ghép HTML), `exportHtml3d.ts` (`runStage` cho từng bước; một Blob duy nhất) | Giới hạn 120 MB chỉ kiểm tra sau khi đã tạo HTML + Blob; chỉ bắt RangeError ở một bước | `sceneBudget.test.ts` (ok→warn→reject, texture, số mesh, 50.000 mesh < 1,5 s), `viewer3dHtml.test.ts` (ViewerTooLargeError). **Chưa làm:** đo ngưỡng thực tế bằng cảnh tăng dần trong trình duyệt — các hằng số ước lượng là heuristic cần hiệu chỉnh |
| P1.4 | `viewerRuntime.ts` (`webglcontextlost`/`webglcontextrestored`, dựng lại môi trường PMREM và vòng lặp), `htmlViewerExporter.ts` (lớp phủ `#v3d-ctxlost`) | Không có xử lý sự kiện | E2E `viewer-webgl-recovery` (mô phỏng bằng `WEBGL_lose_context`) |
| P1.5 | `viewerRuntime.ts` (`hasWebGl2Api`, tách lỗi khởi tạo renderer) | Kiểm tra `webgl2 \|\| webgl` trong khi Three.js 0.187 cần WebGL 2; tạo context thử nghiệm rồi bỏ | Chưa có test tự động riêng (cần trình duyệt không hỗ trợ WebGL 2) — kiểm tra bằng đọc mã |
| P2.1 | `ExportModal.tsx` (trạng thái `warning`) | `res.warning ? 'error' : 'success'` | Chưa có test UI tự động |
| P2.2 | `viewerRuntime.ts` (`applySceneTheme`) | Nút theme chỉ đổi CSS | E2E: đổi `scene.background` rồi trả lại |
| P2.3 | — | Chưa làm: kiểm thử cảm ứng 2D (pinch, pointercancel, xoay màn hình, SVG tỷ lệ cực đoan) | — |

Chưa xử lý trong V2.8: P2.3; đồng bộ nhãn phiên bản (`package.json`/`APP_VERSION` = 3.1.1 nhưng CHANGELOG đánh số V2.x — cần chủ sản phẩm quyết định); dự án chuẩn 3 tầng/10 rack/100 thiết bị/200 cáp và đối chiếu mọi định dạng xuất; kiểm thử hiệu năng CPU/RAM/GPU.

## [V2.6 – chưa phát hành] — Xuất HTML 3D xoay được

- **Xuất HTML 3D độc lập**: ở chế độ 3D, nút "Trình Xem HTML" trong hộp thoại Xuất giờ tạo file `.html` chứa nguyên cảnh Three.js đang xem (thiết bị, tủ rack, cáp, sàn, đèn, nhãn). Mở offline bằng trình duyệt để xoay ngang/dọc, zoom, dịch chuyển, đổi góc nhìn Iso/Trên/Trước/Bên, tự xoay, bật/tắt cáp & nhãn, bấm vào thiết bị/cáp xem thông tin, lưu ảnh PNG, toàn màn hình. Phạm vi "Cả 2D và 3D" có thêm tab sơ đồ 2D.
- `Network3DSceneHandle.exportSceneSnapshot()` + `ViewportContext.capture3DScene()` chụp cảnh dạng JSON (bỏ axes, vòng chọn, huy hiệu khóa).
- `scripts/build-viewer3d.mjs` bundle `three` + runtime trình xem thành 1 khối IIFE (`src/generated/viewer3dRuntime.generated.ts`), tự chạy trước `dev` / `build` / `test`.
- Thêm test `viewer3dHtml.test.ts`, `viewer3dRuntime.test.ts`.
- **Sửa theo thẩm định**: (P0.1) vòng lặp render tách ra `viewer3d/frameLoop.ts`, bảo đảm tối đa 1 RAF chờ và dừng hẳn khi đứng yên; (P0.2) raycast chỉ xét đối tượng hiển thị hiệu lực (`viewer3d/visibility.ts`), tắt cáp thì không hover/chọn được; (P0.4) mặc định KHÔNG nhúng IP/VLAN/tài sản/cáp/bảng, có hộp chọn từng nhóm dữ liệu và cảnh báo trong hộp thoại Xuất; (P1.2) bảng và thông tin chỉ gồm đối tượng có trong cảnh 3D, ghi rõ phạm vi; (P2.2) nút đổi giao diện sáng/tối; (P2.3) sơ đồ 2D dùng Pointer Events, pinch-zoom, giới hạn pan, nút Vừa màn hình; (P2.4) cảnh báo > 25 MB, từ chối > 120 MB, báo lỗi rõ khi hết bộ nhớ.
- **Chưa làm / cần trình duyệt thật**: E2E (`export-3d-viewer`, `render-parity`, `perf-browser`), P1.1, P1.3–P1.5, P2.1.

## [Chưa phát hành]

### V2.5 – Render Geometry Parity (chỉ phần P0 hình học + cổng kiểm chứng; KHÔNG thêm tính năng CAD mới)
- **Nguồn kích thước duy nhất** `src/utils/cableRenderMetrics.ts`: nét cáp (chính + nét nhấn mạnh), tay nắm, nút "+ Thêm nhãn", badge, bóng đổ, nhãn tổng hợp bundle, vỏ bundle. `DesignCanvas.tsx` **render bằng** các hằng số/hàm này và `cableBounds.ts` **đo bằng** chính chúng; test tĩnh chặn hằng số cứng quay lại canvas.
- **P0.1 Nhãn tổng hợp bundle**: `computeCableBundleLabelBounds()` (từ `CableBundleInfo`, cùng công thức rộng/vị trí với canvas) và `computeCableBundleJacketBounds()` (vỏ bó, xoay theo tiếp tuyến). Chỉ cộng **một lần cho mỗi bundle**, chỉ khi lớp nhãn đang hiện.
- **P0.2 Trạng thái hiển thị**: `resolveCableLabelPresentation()` (`badge | add-button | none`) dùng chung cho canvas và bounds; đầu vào đủ `isSelected/isHovered/isBundled/isReadOnly/isEditingLabel`. Chỉ đọc → không đo nút "+ Thêm nhãn" và tay nắm (App truyền `isReadOnly`). `editingCableLabelId` có trong API nhưng App chưa truyền vì trạng thái editor nằm cục bộ trong DesignCanvas (đo dư một nhãn khi editor đang mở – sai theo hướng an toàn).
- **P0.3 Bóng đổ**: vùng bóng suy ra từ cấu hình filter (`σ = blur/2`, đuôi Gauss cắt ở 3σ, dịch theo offset), không dùng padding tùy ý. Chromium đo thực tế: dư ≤ ~2,4 px so với phần bóng nhìn thấy (alpha ≥ 3 %).
- **P0.4 Nét chọn**: tính cả nét nhấn mạnh `strokeWidth + 8` lẫn nét chính `+1,5`, lấy lớn nhất (cap/join tròn). Sửa: `strokeWidth` undefined trước đây làm canvas vẽ `NaN`; nay dùng chung `normalizeCableStrokeWidth` (undefined → 1, giá trị bất thường → `invalid`).
- **P0.5 Edit overlay**: `computeCableEditOverlayBounds()` đo waypoint handle, nút "+" ở trung điểm mọi đoạn của `pts`, tay nắm nối lại nguồn/đích – từ chính dữ liệu `CablePathResult` canvas dùng.
- **P0.6 X = 0**: bỏ `midX === 0` (ẩn nhãn) và `midX !== 0` (chặn double-click) trong `DesignCanvas.tsx`; có test tĩnh.
- **Lỗi renderer tìm thấy nhờ test Chromium**: nhãn rất dài bị tràn khỏi badge (badge chặn ở 360 px, chữ thì không). Nay chữ được nén vào badge bằng `textLength` (`cableLabelTextLength`).
- **Visibility**: thêm test cho Q1, Q2, Q3, Q5, Q6 của phản biện (rack ẩn/layer rack ẩn, layer thiết bị ẩn, layer cáp ẩn, khác tầng, shadow node).
- **Render-to-Bounds Parity Test** (`npm run test:parity`): dựng SVG thật bằng fixture dùng chung metrics, render trong Chromium ở 4×, lấy bounding box theo **điểm ảnh thật** (gồm nét, filter, chữ), so với `getZoomSelectionBounds`: (1) không bị cắt (±0,5 px), (2) dư ≤ ngưỡng nêu rõ từng kịch bản. 13 kịch bản (góc 0/±90/180/45, bundle 5 & 12, nhãn dài/cỡ 7 & 24, chỉ đọc, đang chỉnh sửa, X=0, nét 12 đứt…). Thất bại → lưu PNG + JSON vào `test-results/render-parity/`. Đã kiểm tra ngược (mutation): bỏ nét nhấn mạnh / nhãn bundle / tay nắm đầu cuối đều làm test đỏ.
- **Benchmark** (`perf.bench.ts`): median/p95/p99, tăng heap, thời gian GC; dữ liệu ngẫu nhiên 100/300, 500/1.500, 1.000/3.000 **và** dữ liệu xấu nhất thiết kế chủ động (bundle 10/50/100 tuyến, 12 waypoint/tuyến, nhãn dài, chọn cả 100 tuyến). `--enforce` áp ngưỡng p95 cho **mọi** ca: zoom 1 cáp/1 node < 50 ms, zoom 50 tuyến < 100 ms.
- **CI**: job mới `geometry-gate` (Chromium parity + `bench:enforce`, upload `test-results/` và log). `npm run typecheck` thêm làm tên rõ nghĩa.
- **Test**: `v25.test.ts` (30 test). `v24.test.ts` cập nhật một kỳ vọng cũ: nét chọn nay đo theo nét nhấn mạnh (−205 thay vì −201,75).

### Chưa kiểm chứng / chưa làm trong V2.5 (nói thẳng)
- **Chưa chạy** được trong môi trường phát triển: `npm ci`, `tsc` toàn dự án, `vite build`, `runTests.ts` cũ (thiếu `three`/mạng), Playwright E2E của ứng dụng thật. `DesignCanvas.tsx`/`App.tsx` chỉ qua kiểm tra cú pháp; hãy để CI chạy `npm run lint && npm test && npm run build`.
- **Parity hiện đo fixture, chưa đo DOM của app thật**: fixture dựng SVG từ cùng hằng số nhưng là bản sao markup của canvas. Cần thêm E2E trên app thật (nạp dự án mẫu, chọn tuyến, lấy ảnh vùng Zoom to Selection) – chưa làm vì app chưa có hook nạp dự án/test id cho overlay.
- `npm run lint` vẫn chỉ là `tsc --noEmit`; **chưa có ESLint**.
- Chưa có benchmark trình duyệt (React render, SVG paint, FPS, bộ nhớ). Benchmark hiện chỉ là tính toán thuần Node.
- Phần Visibility mới được kiểm ở tầng resolver; chưa kiểm click/drag/hit-test và export từng trường hợp (Q4, Q7 của phản biện chưa được kiểm).

### V2.4 – Stability & Geometry Accuracy (chỉ phần P0; P1 CAD Interaction CHƯA làm)
- **P0.1 Bounds nhãn cáp theo hình học thật**: `src/utils/cableBounds.ts` (mới) dùng chính `resolveCableLabelTransform()` để lấy vị trí, rộng/cao (tới 360 px) và góc xoay của nhãn, tính bounding box của hình chữ nhật **sau khi xoay** (`rotatedRectBounds`) rồi hợp nhất với đường cáp. Bỏ hằng số 24 px. Nhãn chỉ được cộng khi lớp nhãn (`cable_labels`/`labels`) đang hiện và canvas thực sự vẽ nó; nút "+ Thêm nhãn" (76×20) được tính khi cáp được chọn, không thuộc bundle và chưa có badge.
- **P0.2/P0.3 Dữ liệu bất thường**: `strokeWidth` phải hữu hạn, 0…1000; điểm điều khiển, điểm giữa nhãn, kích thước nhãn đều được kiểm tra; `MAX_ABS_COORD` áp dụng cho **mọi điểm của đường cáp, cực trị Bézier, và bounds cuối cùng** sau khi cộng nét/nhãn/tay nắm. Vi phạm → trạng thái `invalid` kèm lý do cụ thể (hiện trên tooltip nút Zoom to Selection).
- **Parser SVG nghiêm ngặt** (`parseSvgPathBounds`, `svgPathBounds` giữ làm wrapper): chỉ chấp nhận M/L/Q/C tuyệt đối; từ chối lệnh lạ/tương đối/Z/S/H/V/A, ký tự lạ (NaN, Infinity…), thiếu/dư tham số, path không bắt đầu bằng M. Nếu renderer đổi sang lệnh khác, parser phải được nâng cấp cùng lúc (ghi trong mã).
- **P0.4 Hợp đồng visibility** (`visibilityResolver.ts`): tách 3 khái niệm — `isNodeRendered` (có được vẽ), `getRoutableRect` (có hình học để cáp bám), `getSelectableRect` (= vẽ ∧ có hình học; dùng cho Selection/Zoom). `getNodeEffectiveRect` giữ làm alias *deprecated*. Chính sách cáp `CABLE_ENDPOINT_POLICY = 'keep-routed'`: ẩn layer thiết bị/rack thì ẩn đối tượng nhưng cáp nối vào vẫn hiện; cáp chỉ biến mất khi đầu cuối không có hình học trong bản vẽ hiện tại (cờ `hidden`, khác tầng/chế độ, thiếu node/rack) hoặc lớp cáp bị tắt.
  - **Sửa lỗi hành vi (canvas)**: (1) rack bị ẩn bằng cờ `hidden` trước đây khiến thiết bị gắn trong rack "bật ra" trên mặt bằng tại tọa độ topology vô nghĩa; nay thiết bị vẫn thuộc rack ẩn và không hiện. (2) Tắt lớp `racks` trước đây làm cáp tới thiết bị gắn rack biến mất nhưng cáp tới chính rack vẫn hiện (mâu thuẫn); nay cả hai cùng được giữ.
- **State viewport**: `normalizeViewportTransform`/`reduceViewport` (thuần, `viewportMath.ts`); `setViewportTransform`, `setZoom`, `setPan` đều đi qua cùng một reducer: từ chối NaN/Infinity/thiếu trường/pan quá lớn (giữ nguyên state cũ), zoom hữu hạn ngoài phạm vi được kẹp vào 20–300%. Viewport không nằm trong kiểu dữ liệu dự án nên không vào Undo/Redo hay autosave (đã kiểm tra bằng grep).
- Zoom to Selection nhận tùy chọn `includeEditHandles` (App truyền `!isReadOnlyMode`).

### Kiểm thử V2.4 (đã chạy thật bằng `tsx`)
- `v24.test.ts` (28 test): T01–T09 và T11 của biên bản, 6 hình dạng tuyến đối chiếu với bộ lấy mẫu Bézier **độc lập** (không bị cắt, sai số < 0,5 px), tuyến ngược chiều/rất dài/độ dài 0/gần thẳng đứng, bundle 9 cáp, parser, bất biến viewport.
- `perf.bench.ts` (`npm run bench`, `bench:enforce`): đo tính toán thuần ở 100/500/1000 node.
- **Chưa kiểm chứng**: build production, `runTests.ts` cũ và E2E (môi trường thiếu dependency/mạng); T10 (đổi kích thước cửa sổ), đo FPS/bộ nhớ/autosave/BOM/2D↔3D trong trình duyệt.

### Thay đổi
- **Gom nút điều khiển trùng lặp**: "Phân lớp tự động" chỉ còn một vị trí chính trong menu Lớp thống nhất (`LayerPanel`); gỡ bản trùng ở menu `TopBar`, menu Nâng cao của `QuickAccessBar` và bảng thuộc tính thiết bị (lệnh vẫn gọi được từ Command Palette). Ngăn kéo di động chỉ giữ một nút chuyển 2D/3D ở chế độ 2D; ở 3D dùng nút "Về 2D CAD" trên thanh nổi.
- **Zoom 2D theo con trỏ chuột**: Ctrl/Cmd + cuộn giữ cố định điểm bản vẽ dưới con trỏ thay vì trượt về gốc.

- **Viewport 2D (V2.1)**: tách toán zoom/pan/fit thành `src/utils/viewportMath.ts` (thuần, có unit test). Nút Phóng to/Thu nhỏ/100% nay neo tại tâm khung nhìn (trước đây zoom quanh gốc và reset pan cố định 50,50); Ctrl+cuộn dùng cùng hàm neo con trỏ. Thêm nút **Phóng to đối tượng đang chọn** (`zoom-to-selection-btn`, mờ ở 3D hoặc khi chưa chọn).

- **Sửa P0 viewport (sau kiểm duyệt V2.1)**: hệ số thu nhỏ nay là nghịch đảo chính xác của phóng to (`1.1` và `1/1.1`) cho cả cuộn chuột và nút; `clampZoom` chặn NaN/Infinity/≤0. Thêm `setViewportTransform` để cập nhật zoom+pan một lần (không vào undo/autosave).
- **Zoom to Selection đúng ngữ nghĩa** (`src/utils/selectionBounds.ts`): hỗ trợ nhiều thiết bị, phòng, rack, tuyến cáp (theo hai đầu); bỏ qua đối tượng ẩn, lớp ẩn, tầng/chế độ khác; đối tượng khóa vẫn zoom được; chế độ Rack và loại chưa hỗ trợ → nút mờ kèm lý do trong tooltip.

- **V2.3 nền tảng Visibility – Geometry – State**:
  - `src/utils/visibilityResolver.ts`: nguồn duy nhất quyết định đối tượng nào hiển thị (tầng/chế độ, lớp ẩn, shadow node trong rack, vị trí khe rack, cáp hiển thị). `DesignCanvas` và Zoom to Selection đều gọi các hàm này; đã xóa bản sao quy tắc trong canvas.
  - `src/utils/geometryResolver.ts`: bounds có kiểm tra (bỏ NaN/Infinity/kích thước âm/quá lớn, đếm số đối tượng bị bỏ) và bounds đường SVG với cực trị Bézier chính xác.
  - Zoom to Selection cho tuyến cáp dùng đúng hình học canvas vẽ (`computeCableBundleLayout`/`computeCablePath`: đường cong, gấp khúc, nhiều điểm điều khiển, bundle) + đệm theo độ dày/nhãn; nghiêm ngặt: một tuyến không hiển thị → nút mờ kèm lý do. Thiết bị trong rack zoom tới khe trong rack. Phòng theo cùng quy tắc tầng như canvas (chỉ lọc ở floorplan/cctv/wifi/fiber). Kết quả có kiểu `ok | unsupported | invalid`.
  - Viewport: zoom+pan là **một** state nguyên tử trong store (`setViewportTransform`); cuộn chuột, nút, reset, fit-vùng-chọn cùng đi qua đường này; không vào Undo/autosave.

### Kiểm thử
- `selectionBounds.test.ts` mở rộng 19 test: đối chiếu từng node/phòng với danh sách hiển thị của canvas ở 4 chế độ, shadow node rack, cáp cong/gấp khúc/nhiều điểm điều khiển/chung đầu cuối/mất đầu/khác tầng, dữ liệu hình học lỗi, cực trị Bézier.
- Sửa test cũ "drift" (nay kiểm tra thật zoom/pan quay về ban đầu), thêm test góc/cạnh ở 20% và 300%, giá trị bất thường; `selectionBounds.test.ts` (9 test). Cả hai gắn vào `npm test`.
- `src/utils/__tests__/viewportMath.test.ts` (8 test: neo con trỏ ở góc/giữa, giới hạn 20–300%, 50 bước zoom không sai số tích lũy, tọa độ thiết bị bất biến, fit, reset). Đã gắn vào `npm test`.
- Thêm `e2e/viewport-ux.spec.ts` (nút 2D/3D duy nhất, chuyển 2D↔3D, zoom, phạm vi xuất 3D).

## [3.1.1] - 2026-11-16

### Thêm mới
- **Nút Mô hình 3D trực tiếp & kéo thả di chuyển trong 3D**: Đưa nút chuyển đổi `Mô hình 3D` / `Thoát 3D` (`data-testid="toggle-3d-btn"`) ra ngoài thanh công cụ (và mục đầu tiên trong ngăn kéo di động); hỗ trợ kéo thả thiết bị và tủ Rack trực tiếp trên mặt phẳng 3D theo thời gian thực (cập nhật tuyến cáp 3D sống, đồng bộ tọa độ 2D, snap lưới khi thả và hỗ trợ Undo/Redo).
- **Thông số ắc quy UPS thực tế (`upsSpecs`)**: Cho phép khai báo dung lượng (`Ah`), điện áp hệ (`V`), số bình, hiệu suất inverter và DoD trên từng UPS trong bảng thuộc tính; máy tính lưu điện đồng bộ trực tiếp theo thông số UPS.
- **Quy trình CI tự động (GitHub Actions)**: Tự động chạy `npm run lint`, `npm test`, `npm run build` và Playwright E2E trên mọi push/PR; đồng bộ `package-lock.json` chuẩn `npm ci` (gỡ bỏ `bun.lock` lệch chuẩn).
- **Công thức BOM theo chiều đứng (`verticalRiseMeters`, `dropHeightMeters`)**: Hỗ trợ cấu hình chiều cao thả trần mỗi đầu (m) và chiều cao thông tầng (m/tầng), tích hợp trực tiếp vào giao diện BOM, CSV và các công thức sống sheet `Cap_Tung_Tuyen` / `Gia_Dinh_BOM` trong Excel.
- **Truy vết BOM → Bản vẽ**: Nhấp vào dòng thiết bị, loại cáp hoặc tầng trong hộp thoại BOM để định vị và chọn trực tiếp đối tượng tương ứng trên bản vẽ.
- **Cảnh báo kiểm soát dữ liệu BOM**: Phát hiện thêm tuyến cáp chưa gán cổng (`Auto`) và thiết bị hoạt động thiếu thông số Model/Công suất (W).

### Cải tiến bảo mật & ổn định
- **Khắc phục P0 kiểm tra UPS**: Loại bỏ ngưỡng tối thiểu giả định `Math.max(w, 1500)` và công thức ước lượng cứng `0.45 * 60` trong `engineeringValidator.ts`; chỉ cộng công suất thực tế đã khai báo và phát cảnh báo khi UPS chưa có công suất định mức hoặc thiếu thông số ắc quy.
- **Đồng bộ giới hạn tần suất AI Serverless (`/api/gemini/chat`)**: Áp dụng đủ bộ đếm phút, giờ và hạn mức ngày toàn cục cùng cơ chế dọn bộ nhớ khi chưa cấu hình Upstash Redis, đồng bộ hoàn toàn với `server.ts`.
- **Giới hạn kích thước & số lượng đối tượng khi nhập tệp**: Kiểm tra ngưỡng dung lượng an toàn trước khi đọc/parse tệp `.hachihi.json` (15 MB), Excel/CSV (10 MB), NetworkScanner (5 MB), gói nhiều dự án (50 dự án), giới hạn nút/cáp/thiết bị và chặn thẻ SVG `<image>`/`<use>` trỏ ra ngoài trước khi rasterize.
- **Giữ nguyên máng cáp khi lưu/khôi phục**: Bổ sung chuẩn hóa `cableTrays` trong pipeline di chuyển/nhập dự án.
- **Tài liệu biến môi trường**: Bổ sung bảng mô tả đầy đủ tất cả biến môi trường tùy chọn trong `README.md` và `.env.example`.

## [3.1.0] - 2026-11-15

### Thêm mới
- **Tab Giới thiệu HACHIHI (`AboutModal`)**: Hiển thị logo chính thức (Sáng/Tối), trang web `hachihi.vn`, hotline `093 384 2126`, hỗ trợ kỹ thuật `09-1800-1944`, số phiên bản, mã build, danh sách tính năng chuyên nghiệp và tuyên bố lưu dữ liệu cục bộ.
- **Kênh Góp ý (Google Form)**: Nút truy cập nhanh từ thanh trên, menu chính và hộp thoại Giới thiệu; tự động điền sẵn phiên bản, mã build, chế độ thiết kế và thiết bị (không đính kèm dữ liệu bản vẽ) và kiểm tra trạng thái ngoại tuyến.
- **Đánh số phiên bản thống nhất từ `package.json`**: Tiêm hằng số phiên bản, mã build (`git short hash`) và ngày phát hành vào giao diện, thanh trạng thái, gói dự án `.hachihi.json`, khung tên PDF, sheet `Gia_Dinh_BOM` Excel, chân trang HTML viewer và tệp AutoCAD DXF.
- **Hộp thông báo "Có gì mới"**: Tự động hiển thị một lần sau khi ứng dụng cập nhật phiên bản mới.
- **Nâng cấp BOM & Giả định**: Bổ sung giả định hao hụt cáp đồng/quang riêng biệt, dự phòng đầu cáp (`service loop`), làm tròn quy cách cuộn cáp, danh mục phụ kiện suy ra theo quy tắc thi công, kiểm soát đối soát chéo và xuất thêm sheet `Phu_Kien_Suy_Ra` + `Gia_Dinh_BOM` với công thức Excel sống.
- **Khóa theo lớp (`layerPolicy`) & Trợ giúp tìm kiếm không dấu (`helpCatalog`)**: Chuẩn hóa kiểm tra khóa/ẩn theo lớp và thanh tìm kiếm hướng dẫn tiếng Việt không dấu trong Hướng dẫn sử dụng.
- **Cấu hình bảo mật & kiểm thử**: Thêm `vercel.json` với header CSP/bảo mật, cấu hình Playwright E2E và nâng cấp giới hạn tần suất dùng kho Redis dùng chung cho serverless API.

### Thay đổi
- **Cấu trúc Menu chính 6 nhóm (`≡`)**: Tổ chức lại toàn bộ lệnh vào 6 nhóm rõ ràng (*Dự án*, *Thiết kế*, *Dữ liệu hạ tầng*, *Tính toán và kiểm tra*, *Xuất hồ sơ*, *Trợ giúp*) và giữ thanh trên gọn ~9 mục chính.
- **Thống nhất thuật ngữ tiếng Việt**: *Topology* → *Sơ đồ logic*, *Hub* → *Trung tâm dự án*, *HUD* → *Điều khiển khung nhìn*, *Audit* → *Kiểm tra kỹ thuật*, *BOM* → *Vật tư (BOM)*.
- **Trợ lý AI theo trạng thái mạng & API**: Tự động ẩn nút chat AI trực tuyến khi không có cấu hình máy chủ hoặc đang ngoại tuyến.
- **Tối ưu PWA precache**: Loại trừ các gói nặng (`three`, `pdf`, `exceljs`, `recharts`) khỏi precache ban đầu và dùng runtime cache.

### Gỡ bỏ
- Xóa các tệp tài nguyên dư thừa trong `public/assets/aistudio/` và gỡ bỏ thư viện `motion` không sử dụng.

## [3.0.0] - 2026-11-01

### Thêm mới
- Nền tảng thiết kế đa chế độ (8 chế độ Logic, Mặt bằng, Tủ Rack 19", Cáp quang, Camera, Wi-Fi, Hệ thống điện) lưu cục bộ bằng IndexedDB + PWA.
- Tự động đi tuyến cáp tránh vật cản, tính toán PoE theo switch, kiểm tra kỹ thuật và xuất hồ sơ PDF/DXF/SVG/HTML/Excel.
