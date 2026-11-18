/**
 * POST /api/track — ghi log truy cập về Google Sheet (qua Google Apps Script Web App).
 *
 * Luồng: trình duyệt → POST /api/track → (file này) → POST tới URL_SHEET kèm SERECT_SHEET
 *        → Apps Script so khớp secret trong Script Properties → nếu đúng mới ghi dòng vào Sheet.
 *
 * Nguyên tắc: MỌI lỗi (thiếu biến môi trường, sai dữ liệu, mạng lỗi, quá thời gian, sai secret...)
 * đều bị BỎ QUA im lặng — việc ghi log không bao giờ được làm hỏng ứng dụng.
 */

export const TRACK_ACTIONS = ['visit', 'template', 'save', 'export'] as const;
export type TrackAction = (typeof TRACK_ACTIONS)[number];

export interface TrackRequestLike {
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  remoteAddress?: string;
}

export interface TrackRow {
  time: string;
  ip: string;
  country: string;
  city: string;
  visitId: string;
  sessionId: string;
  action: string;
  detail: string;
  device: string;
  language: string;
  resolution: string;
}

type FetchLike = (url: string, init: Record<string, unknown>) => Promise<{ ok?: boolean }>;

export interface ProcessTrackOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: FetchLike;
  now?: Date;
}

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT_PER_WINDOW = 40;
const FORWARD_TIMEOUT_MS = 4000;
const rateStore = new Map<string, number[]>();

function firstHeader(headers: TrackRequestLike['headers'], name: string): string {
  const v = headers[name];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' ? s : '';
}

/** Làm sạch 1 trường: chuỗi, bỏ ký tự điều khiển, giới hạn độ dài, chặn công thức Excel/Sheets (= + - @). */
export function cleanField(value: unknown, max: number): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  // eslint-disable-next-line no-control-regex
  let s = String(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return s;
}

export function getClientIp(req: TrackRequestLike): string {
  const raw =
    firstHeader(req.headers, 'x-vercel-forwarded-for') ||
    firstHeader(req.headers, 'x-forwarded-for') ||
    firstHeader(req.headers, 'x-real-ip') ||
    req.remoteAddress ||
    '';
  return cleanField(raw.split(',')[0].trim(), 64);
}

function decodeHeaderValue(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/** Giờ Việt Nam dạng "YYYY-MM-DD HH:mm:ss". */
export function formatVietnamTime(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function isRateLimited(ip: string, nowMs: number): boolean {
  const key = ip || 'unknown';
  const recent = (rateStore.get(key) || []).filter(t => nowMs - t < RATE_WINDOW_MS);
  recent.push(nowMs);
  rateStore.set(key, recent);
  if (rateStore.size > 5000) {
    for (const [k, v] of rateStore) {
      if (!v.some(t => nowMs - t < RATE_WINDOW_MS)) rateStore.delete(k);
    }
  }
  return recent.length > RATE_LIMIT_PER_WINDOW;
}

/** Chỉ cho phép Origin cùng domain với ứng dụng (chặn trang khác gửi log giả qua trình duyệt). */
function isSameOrigin(req: TrackRequestLike, env: Record<string, string | undefined>): boolean {
  const origin = firstHeader(req.headers, 'origin');
  if (!origin) return true;
  let originHost = '';
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const hosts = [
    firstHeader(req.headers, 'x-forwarded-host'),
    firstHeader(req.headers, 'host')
  ].filter(Boolean);
  const appUrl = env.APP_URL?.trim();
  if (appUrl) {
    try {
      hosts.push(new URL(appUrl).host);
    } catch {
      // bỏ qua APP_URL sai định dạng
    }
  }
  return hosts.includes(originHost);
}

/** URL_SHEET phải là Web App của Google Apps Script (https) — tránh gửi tới địa chỉ lạ nếu cấu hình sai. */
export function isAllowedSheetUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && u.hostname === 'script.google.com';
  } catch {
    return false;
  }
}

export function buildTrackRow(req: TrackRequestLike, now: Date): TrackRow | null {
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const action = typeof b.action === 'string' ? b.action : '';
  if (!(TRACK_ACTIONS as readonly string[]).includes(action)) return null;

  return {
    time: formatVietnamTime(now),
    ip: getClientIp(req),
    country: cleanField(firstHeader(req.headers, 'x-vercel-ip-country'), 8),
    city: cleanField(decodeHeaderValue(firstHeader(req.headers, 'x-vercel-ip-city')), 80),
    visitId: cleanField(b.visitId, 64),
    sessionId: cleanField(b.sessionId, 64),
    action,
    detail: cleanField(b.detail, 200),
    device: cleanField(b.device, 120),
    language: cleanField(b.language, 24),
    resolution: cleanField(b.resolution, 24)
  };
}

/**
 * Xử lý 1 yêu cầu ghi log. Không bao giờ ném lỗi; trả về true nếu đã gửi tới Apps Script.
 */
export async function processTrack(
  req: TrackRequestLike,
  options: ProcessTrackOptions = {}
): Promise<boolean> {
  try {
    const env = options.env ?? process.env;
    const url = env.URL_SHEET?.trim();
    const secret = (env.SERECT_SHEET ?? env.SECRET_SHEET)?.trim();
    if (!url || !secret || !isAllowedSheetUrl(url)) return false;

    const now = options.now ?? new Date();
    if (!isSameOrigin(req, env)) return false;
    if (isRateLimited(getClientIp(req), now.getTime())) return false;

    const row = buildTrackRow(req, now);
    if (!row) return false;

    const doFetch: FetchLike = options.fetchImpl ?? ((u, init) => fetch(u, init as RequestInit));
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret, data: row }),
      redirect: 'follow',
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS)
    });
    return Boolean(res && res.ok !== false);
  } catch {
    return false; // lỗi ghi log → bỏ qua hoàn toàn
  }
}

/** Dùng cho test. */
export function __resetTrackRateLimit(): void {
  rateStore.clear();
}

interface ServerlessReq extends TrackRequestLike {
  method?: string;
}

interface ServerlessRes {
  status: (code: number) => ServerlessRes;
  json: (data: unknown) => void;
}

/**
 * Vercel Serverless handler. Luôn trả cùng một phản hồi {ok:true}, kể cả khi bỏ qua hoặc gặp lỗi
 * (không tiết lộ cấu hình). File này tự chứa toàn bộ logic để Vercel không phụ thuộc import chéo;
 * server.ts (chạy local) import lại `processTrack` từ đây.
 */
export default async function handler(req: ServerlessReq, res: ServerlessRes) {
  if (req.method === 'POST') {
    await processTrack(req);
  }
  res.status(200).json({ ok: true });
}
