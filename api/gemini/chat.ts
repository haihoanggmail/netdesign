import { GoogleGenAI, ThinkingLevel } from '@google/genai';

interface ChatTurnInput {
  role: 'user' | 'model';
  text: string;
}

interface ProjectContextSummary {
  projectName?: string;
  activeMode?: string;
  activeFloorName?: string;
  deviceCount?: number;
  rackCount?: number;
  cableCount?: number;
  roomCount?: number;
  totalPowerWatts?: number;
  auditSummary?: {
    errorCount: number;
    warningCount: number;
    topIssues: string[];
  };
  sampleDevices?: Array<{
    name: string;
    category: string;
    ipAddress?: string;
    vlan?: string;
    powerWatts?: number;
  }>;
  racksSummary?: Array<{
    name: string;
    totalUnits: number;
    usedUnits: number;
    powerWatts: number;
  }>;
}

type AssistantPersona = 'architect' | 'rack_power' | 'bom_tia';

interface ServerlessReq {
  method?: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
}

interface ServerlessRes {
  status: (code: number) => ServerlessRes;
  setHeader: (name: string, value: string) => void;
  json: (data: unknown) => void;
}

const MAX_MESSAGE_CHARS = 4000;
const RATE_WINDOW_MINUTE_MS = 60_000;
const RATE_WINDOW_HOUR_MS = 3_600_000;
const RATE_LIMIT_PER_MIN = Math.max(3, Number(process.env.CHAT_RATE_LIMIT_PER_MIN || 15));
const RATE_LIMIT_PER_HOUR = Math.max(10, Number(process.env.CHAT_RATE_LIMIT_PER_HOUR || 60));
const CHAT_DAILY_LIMIT = Math.max(20, Number(process.env.CHAT_DAILY_LIMIT || 500));
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL?.trim().replace(/\/+$/, '');
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
const rateStore = new Map<string, number[]>();
const dailyGlobalHits = new Map<string, number>();

async function checkRateLimitShared(
  ip: string
): Promise<{ allowed: boolean; retryAfterSec?: number; reason?: string; store: 'redis' | 'memory' }> {
  const now = Date.now();
  const minBucket = Math.floor(now / RATE_WINDOW_MINUTE_MS);
  const hourBucket = Math.floor(now / RATE_WINDOW_HOUR_MS);
  const dayKey = new Date().toISOString().slice(0, 10);

  if (UPSTASH_URL && UPSTASH_TOKEN) {
    try {
      const kMin = `hachihi:rl:m:${ip}:${minBucket}`;
      const kHour = `hachihi:rl:h:${ip}:${hourBucket}`;
      const kDay = `hachihi:rl:daily:${dayKey}`;
      const resp = await fetch(`${UPSTASH_URL}/pipeline`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${UPSTASH_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify([
          ['INCR', kMin],
          ['EXPIRE', kMin, 70],
          ['INCR', kHour],
          ['EXPIRE', kHour, 3700],
          ['INCR', kDay],
          ['EXPIRE', kDay, 90000]
        ])
      });
      if (resp.ok) {
        const res = (await resp.json()) as Array<{ result?: unknown }>;
        if (Array.isArray(res) && res.length >= 5) {
          const minCount = Number(res[0]?.result || 0);
          const hourCount = Number(res[2]?.result || 0);
          const dayCount = Number(res[4]?.result || 0);
          if (dayCount > CHAT_DAILY_LIMIT) {
            return { allowed: false, retryAfterSec: 3600, reason: 'daily_quota', store: 'redis' };
          }
          if (minCount > RATE_LIMIT_PER_MIN) {
            return {
              allowed: false,
              retryAfterSec: Math.max(1, Math.ceil(((minBucket + 1) * RATE_WINDOW_MINUTE_MS - now) / 1000)),
              store: 'redis'
            };
          }
          if (hourCount > RATE_LIMIT_PER_HOUR) {
            return {
              allowed: false,
              retryAfterSec: Math.max(1, Math.ceil(((hourBucket + 1) * RATE_WINDOW_HOUR_MS - now) / 1000)),
              store: 'redis'
            };
          }
          return { allowed: true, store: 'redis' };
        }
      }
    } catch {
      // fallback to local memory store
    }
  }

  const curDayTotal = dailyGlobalHits.get(dayKey) || 0;
  if (curDayTotal >= CHAT_DAILY_LIMIT) {
    return { allowed: false, retryAfterSec: 3600, reason: 'daily_quota', store: 'memory' };
  }

  const prev = (rateStore.get(ip) || []).filter(ts => now - ts < RATE_WINDOW_HOUR_MS);
  const lastMinuteCount = prev.filter(ts => now - ts < RATE_WINDOW_MINUTE_MS).length;

  if (lastMinuteCount >= RATE_LIMIT_PER_MIN) {
    const oldestInMin = prev.find(ts => now - ts < RATE_WINDOW_MINUTE_MS) || now;
    const retryAfterSec = Math.max(1, Math.ceil((oldestInMin + RATE_WINDOW_MINUTE_MS - now) / 1000));
    rateStore.set(ip, prev);
    return { allowed: false, retryAfterSec, store: 'memory' };
  }

  if (prev.length >= RATE_LIMIT_PER_HOUR) {
    const oldestInHour = prev[0] || now;
    const retryAfterSec = Math.max(1, Math.ceil((oldestInHour + RATE_WINDOW_HOUR_MS - now) / 1000));
    rateStore.set(ip, prev);
    return { allowed: false, retryAfterSec, store: 'memory' };
  }

  prev.push(now);
  rateStore.set(ip, prev);
  dailyGlobalHits.set(dayKey, curDayTotal + 1);

  if (rateStore.size > 500) {
    for (const [key, list] of rateStore.entries()) {
      const fresh = list.filter(ts => now - ts < RATE_WINDOW_HOUR_MS);
      if (fresh.length === 0) rateStore.delete(key);
      else rateStore.set(key, fresh);
    }
  }
  if (dailyGlobalHits.size > 7) {
    for (const k of dailyGlobalHits.keys()) {
      if (k !== dayKey) dailyGlobalHits.delete(k);
    }
  }

  return { allowed: true, store: 'memory' };
}

function buildSystemInstruction(persona: AssistantPersona, ctx?: ProjectContextSummary): string {
  const personaRole =
    persona === 'rack_power'
      ? 'Bạn là Kỹ sư Hạ tầng Tủ Rack 19 inch & Hệ thống Điện kỹ thuật (UPS, PDU, tải nhiệt BTU, PoE+ 802.3at/bt).'
      : persona === 'bom_tia'
      ? 'Bạn là Chuyên gia Chuẩn hóa Hồ sơ Thi công (ANSI/TIA-606-C, TIA-568, bóc tách khối lượng BOM vật tư, nhãn cáp & bản vẽ CAD).'
      : 'Bạn là Kiến trúc sư Hạ tầng Mạng Doanh nghiệp (LAN/WAN, VLAN, Core-Distribution-Access, Fiber Uplink, Wi-Fi 6 & CCTV).';

  const contextLines: string[] = [];
  if (ctx) {
    contextLines.push(`Dự án hiện tại: "${ctx.projectName || 'HACHIHI Project'}"`);
    contextLines.push(`Chế độ: ${ctx.activeMode || 'topology'} | Tầng: ${ctx.activeFloorName || 'Mặc định'}`);
    contextLines.push(
      `Quy mô: ${ctx.deviceCount ?? 0} thiết bị, ${ctx.rackCount ?? 0} tủ Rack, ${ctx.cableCount ?? 0} tuyến cáp, ${ctx.roomCount ?? 0} phòng, ${ctx.totalPowerWatts ?? 0}W.`
    );
    if (ctx.auditSummary) {
      contextLines.push(
        `Kiểm tra kỹ thuật: ${ctx.auditSummary.errorCount} lỗi, ${ctx.auditSummary.warningCount} cảnh báo.`
      );
    }
  }

  return [
    personaRole,
    'Nhiệm vụ: Tư vấn trực tiếp, ngắn gọn bằng tiếng Việt chuyên ngành mạng & M&E cho kỹ sư thiết kế.',
    contextLines.length > 0 ? `\n--- NGỮ CẢNH DỰ ÁN ---\n${contextLines.join('\n')}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

export default async function handler(req: ServerlessReq, res: ServerlessRes) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const requiredSecret = process.env.CHAT_API_SECRET?.trim();
  if (requiredSecret) {
    const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
    const tokenHeader =
      (typeof req.headers['x-hachihi-token'] === 'string' && req.headers['x-hachihi-token']) ||
      (typeof req.headers['x-hachihi-secret'] === 'string' && req.headers['x-hachihi-secret']) ||
      '';
    const provided = tokenHeader || (authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '');
    if (provided !== requiredSecret) {
      res.status(401).json({ error: 'Thiếu hoặc sai mã xác thực truy cập Trợ lý AI.' });
      return;
    }
  }

  const fwd = req.headers['x-forwarded-for'];
  const ip = (typeof fwd === 'string' ? fwd.split(',')[0].trim() : 'serverless-client') || 'serverless-client';
  const rate = await checkRateLimitShared(ip);
  if (!rate.allowed) {
    if (rate.retryAfterSec) res.setHeader('Retry-After', String(rate.retryAfterSec));
    res.status(429).json({
      error:
        rate.reason === 'daily_quota'
          ? 'Hệ thống Trợ lý AI đã đạt giới hạn sử dụng trong ngày.'
          : `Bạn gửi yêu cầu quá nhanh. Vui lòng thử lại sau ${rate.retryAfterSec ?? 30} giây.`
    });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey === 'YOUR_GEMINI_API_KEY') {
    res.status(503).json({
      error: 'Chưa cấu hình GEMINI_API_KEY trên môi trường serverless.'
    });
    return;
  }

  try {
    const body = (req.body || {}) as {
      message?: unknown;
      history?: unknown;
      persona?: unknown;
      modelMode?: unknown;
      projectContext?: ProjectContextSummary;
    };

    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message || message.length > MAX_MESSAGE_CHARS) {
      res.status(400).json({ error: 'Câu hỏi trống hoặc vượt quá giới hạn ký tự.' });
      return;
    }

    const sanitizedHistory: ChatTurnInput[] = Array.isArray(body.history)
      ? body.history
          .filter(
            (item): item is ChatTurnInput =>
              Boolean(item) &&
              typeof item === 'object' &&
              (item.role === 'user' || item.role === 'model') &&
              typeof item.text === 'string' &&
              item.text.trim().length > 0
          )
          .slice(-16)
          .map(t => ({ role: t.role, text: t.text.slice(0, MAX_MESSAGE_CHARS) }))
      : [];

    const persona: AssistantPersona =
      body.persona === 'rack_power' || body.persona === 'bom_tia' ? body.persona : 'architect';
    const fastMode = body.modelMode === 'fast';
    const model = fastMode
      ? process.env.GEMINI_MODEL_FAST?.trim() || 'gemini-3.1-flash-lite'
      : process.env.GEMINI_MODEL?.trim() || 'gemini-4-hydrogen';

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });
    const chat = ai.chats.create({
      model,
      history: sanitizedHistory.map(t => ({ role: t.role, parts: [{ text: t.text }] })),
      config: {
        systemInstruction: buildSystemInstruction(persona, body.projectContext),
        thinkingConfig: { thinkingLevel: fastMode ? ThinkingLevel.LOW : ThinkingLevel.MEDIUM }
      }
    });

    const response = await chat.sendMessage({ message });
    res.status(200).json({
      reply: (response.text || '').trim() || 'Không nhận được nội dung phản hồi.',
      modelUsed: model
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Lỗi xử lý trợ lý AI: ${msg}` });
  }
}
