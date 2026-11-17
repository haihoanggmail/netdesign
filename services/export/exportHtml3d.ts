import type { ProjectState } from '../../types/infrastructure';
import type { Scene3DSnapshot } from '../../contexts/ViewportContext';
import {
  generateStandalone3DViewerHtml,
  VIEWER_DATA_PREVIEW_ONLY,
  ViewerDataOptions,
  ViewerTooLargeError
} from '../../utils/htmlViewerExporter';
import { VIEWER_3D_RUNTIME_JS, VIEWER_3D_RUNTIME_READY } from '../../generated/viewer3dRuntime.generated';
import { ExportContentScope, sanitizeExportBaseName, triggerBlobDownload } from './exportTypes';
import { SceneTooLargeError } from './sceneBudget';

export type CaptureSceneFn = () => Scene3DSnapshot;

/** Trên ngưỡng này cảnh báo người dùng; trên ngưỡng cứng thì từ chối để không treo trình duyệt. */
export const HTML3D_WARN_BYTES = 25 * 1024 * 1024;
export const HTML3D_MAX_BYTES = 120 * 1024 * 1024;

export interface ExportHtml3DResult {
  filename: string;
  bytes: number;
  warning?: string;
}

/** Runtime trình xem đã được bundle thật sự chưa (false khi file generated vẫn là placeholder). */
export function isViewer3DRuntimeReady(): boolean {
  return VIEWER_3D_RUNTIME_READY && VIEWER_3D_RUNTIME_JS.length > 0;
}

const OOM_PATTERN = /out of memory|allocation failed|invalid (string|array) length|memory/i;

/** Chạy một bước và gắn tên bước vào lỗi; RangeError / lỗi bộ nhớ ở BẤT KỲ bước nào đều được dịch rõ ràng. */
function runStage<T>(stage: string, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof SceneTooLargeError || err instanceof ViewerTooLargeError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof RangeError || OOM_PATTERN.test(msg)) {
      throw new Error(
        `Hết bộ nhớ ở bước "${stage}". Cảnh 3D quá lớn để đóng gói HTML — hãy ẩn bớt tầng/lớp hoặc xuất từng khu vực.`
      );
    }
    throw new Error(`Lỗi ở bước "${stage}": ${msg}`);
  }
}

/**
 * Xuất trình xem HTML 3D độc lập (xoay / zoom / pan / đổi góc nhìn offline).
 * - Không bao giờ thay thế âm thầm bằng sơ đồ 2D.
 * - Mặc định KHÔNG nhúng dữ liệu hạ tầng (IP, VLAN, tài sản, cáp) trừ khi người dùng bật.
 * - Từ chối sớm: kiểm tra runtime → ngân sách cảnh (trong captureScene) → dung lượng payload (trước khi ghép HTML)
 *   → dung lượng Blob. Mỗi bước có xử lý lỗi/hết bộ nhớ riêng.
 */
export function runExportHtml3D(
  project: ProjectState,
  config: {
    contentScope: ExportContentScope;
    captureScene?: CaptureSceneFn;
    data?: ViewerDataOptions;
  }
): ExportHtml3DResult {
  if (!isViewer3DRuntimeReady()) {
    throw new Error(
      'Chưa có mã trình xem 3D (runtime chưa được bundle). Hãy chạy "npm run build:viewer3d" (tự động chạy khi dev/build/test) rồi thử lại.'
    );
  }
  if (!config.captureScene) {
    throw new Error(
      'Chưa thể xuất HTML 3D vì khung nhìn 3D đang tắt hoặc chưa khởi tạo WebGL. Vui lòng chuyển sang chế độ 3D trước.'
    );
  }
  const captureScene = config.captureScene;

  // 1) Chụp cảnh (bên trong đã kiểm tra ngân sách mesh/texture/dung lượng ước lượng trước khi toJSON).
  const snapshot = runStage('chụp cảnh 3D', () => captureScene());

  // 2) Tạo HTML (kiểm tra dung lượng payload+runtime trước khi ghép chuỗi hoàn chỉnh).
  const html = runStage('tạo HTML', () =>
    generateStandalone3DViewerHtml(project, snapshot, {
      runtimeJs: VIEWER_3D_RUNTIME_JS,
      include2D: config.contentScope === 'both',
      data: config.data ?? VIEWER_DATA_PREVIEW_ONLY,
      maxBytes: HTML3D_MAX_BYTES
    })
  );

  // 3) Tạo Blob DUY NHẤT (dùng lại cho cả đo dung lượng lẫn tải xuống — không nhân đôi bộ nhớ).
  const blob = runStage('tạo tệp', () => new Blob([html], { type: 'text/html;charset=utf-8' }));
  const bytes = blob.size;
  if (bytes > HTML3D_MAX_BYTES) {
    throw new ViewerTooLargeError(bytes, HTML3D_MAX_BYTES);
  }

  // 4) Tải xuống.
  const filename = `${sanitizeExportBaseName(project.name)}_3D_Viewer.html`;
  runStage('tải xuống', () => triggerBlobDownload(blob, filename));
  return {
    filename,
    bytes,
    warning:
      bytes > HTML3D_WARN_BYTES
        ? `File lớn (${(bytes / 1048576).toFixed(1)} MB) — có thể mở chậm trên điện thoại.`
        : undefined
  };
}
