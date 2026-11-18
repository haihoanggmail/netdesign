/**
 * Ghi log hành vi sử dụng (truy cập, lấy file mẫu, lưu, xuất) gửi tới /api/track.
 * Máy chủ bổ sung time / IP / quốc gia / thành phố rồi chuyển sang Google Sheet.
 *
 * AN TOÀN: hàm này không bao giờ ném lỗi, không chờ kết quả, không ảnh hưởng thao tác của người dùng.
 * Không gửi dữ liệu dự án (tên dự án, thiết bị, IP mạng nội bộ...) — chỉ gửi nhãn hành động và số liệu tổng quát.
 */

export type TrackAction = 'visit' | 'template' | 'save' | 'export';

const ENDPOINT = '/api/track';

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // dùng phương án dự phòng
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** VisitID: mới cho mỗi lần tải trang. */
const visitId = randomId();
let fallbackSessionId: string | null = null;
let visitSent = false;

/** SessionID: giữ nguyên trong 1 phiên tab trình duyệt (sessionStorage). */
function getSessionId(): string {
  try {
    const KEY = 'hachihi_session_id';
    let id = sessionStorage.getItem(KEY);
    if (!id) {
      id = randomId();
      sessionStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    if (!fallbackSessionId) fallbackSessionId = randomId();
    return fallbackSessionId;
  }
}

export function describeDevice(ua: string, maxTouchPoints = 0): string {
  const isTablet = /iPad|Tablet|Android(?!.*Mobile)/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1);
  const isMobile = !isTablet && /Mobi|iPhone|Android/i.test(ua);
  const type = isTablet ? 'Tablet' : isMobile ? 'Mobile' : 'Desktop';
  const os = /Windows/i.test(ua)
    ? 'Windows'
    : /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1)
    ? 'iOS'
    : /Android/i.test(ua)
    ? 'Android'
    : /Mac OS X|Macintosh/i.test(ua)
    ? 'macOS'
    : /Linux|X11/i.test(ua)
    ? 'Linux'
    : 'Other';
  const browser = /Edg\//i.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/i.test(ua)
    ? 'Opera'
    : /Firefox|FxiOS/i.test(ua)
    ? 'Firefox'
    : /Chrome|CriOS/i.test(ua)
    ? 'Chrome'
    : /Safari/i.test(ua)
    ? 'Safari'
    : 'Other';
  return `${type} · ${os} · ${browser}`;
}

export function trackEvent(action: TrackAction, detail = ''): void {
  try {
    if (typeof window === 'undefined' || typeof fetch !== 'function') return;
    // Tôn trọng tín hiệu "Do Not Track" của trình duyệt
    if (navigator.doNotTrack === '1') return;

    const payload = {
      action,
      detail: String(detail).slice(0, 200),
      visitId,
      sessionId: getSessionId(),
      device: describeDevice(navigator.userAgent || '', navigator.maxTouchPoints || 0),
      language: navigator.language || '',
      resolution: `${window.screen?.width ?? 0}x${window.screen?.height ?? 0}`
    };
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true
    }).catch(() => undefined);
  } catch {
    // bỏ qua mọi lỗi ghi log
  }
}

/** Ghi 1 lượt truy cập cho mỗi lần tải trang. */
export function trackVisit(): void {
  if (visitSent || typeof window === 'undefined') return;
  visitSent = true;
  trackEvent('visit', typeof location !== 'undefined' ? location.pathname : '/');
}

/**
 * Ghi log SAU KHI thao tác thành công (kết quả trả về hoặc Promise được giữ nguyên, lỗi vẫn ném như cũ).
 */
export function trackAfter<T>(action: TrackAction, detail: string, result: T): T {
  try {
    if (result && typeof (result as unknown as Promise<unknown>).then === 'function') {
      (result as unknown as Promise<unknown>).then(
        () => trackEvent(action, detail),
        () => undefined
      );
    } else {
      trackEvent(action, detail);
    }
  } catch {
    // bỏ qua
  }
  return result;
}
