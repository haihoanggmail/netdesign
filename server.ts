import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

function loadLocalEnvFiles() {
  for (const filename of ['.env', '.env.local']) {
    const filePath = path.resolve(process.cwd(), filename);
    if (!fs.existsSync(filePath)) continue;
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eqIdx = line.indexOf('=');
        if (eqIdx <= 0) continue;
        const key = line.slice(0, eqIdx).trim();
        let val = line.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (key && process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    } catch {
      // ignore unreadable local env files
    }
  }
}

loadLocalEnvFiles();

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

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

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
    contextLines.push(
      `Chế độ: ${ctx.activeMode || 'topology'} | Tầng đang mở: ${ctx.activeFloorName || 'Mặc định'}`
    );
    contextLines.push(
      `Quy mô: ${ctx.deviceCount ?? 0} thiết bị, ${ctx.rackCount ?? 0} tủ Rack, ${ctx.cableCount ?? 0} tuyến cáp, ${ctx.roomCount ?? 0} phòng kỹ thuật, tổng công suất ước tính ${ctx.totalPowerWatts ?? 0}W.`
    );
    if (ctx.racksSummary && ctx.racksSummary.length > 0) {
      contextLines.push(
        `Tủ Rack: ${ctx.racksSummary
          .slice(0, 6)
          .map(r => `${r.name} (${r.usedUnits}/${r.totalUnits}U, ${r.powerWatts}W)`)
          .join('; ')}.`
      );
    }
    if (ctx.sampleDevices && ctx.sampleDevices.length > 0) {
      contextLines.push(
        `Thiết bị tiêu biểu: ${ctx.sampleDevices
          .slice(0, 12)
          .map(d => `${d.name}[${d.category}${d.ipAddress ? ` ${d.ipAddress}` : ''}${d.vlan ? ` VLAN ${d.vlan}` : ''}]`)
          .join(', ')}.`
      );
    }
    if (ctx.auditSummary) {
      contextLines.push(
        `Kết quả kiểm tra kỹ thuật: ${ctx.auditSummary.errorCount} lỗi, ${ctx.auditSummary.warningCount} cảnh báo.` +
          (ctx.auditSummary.topIssues.length > 0
            ? ` Chi tiết: ${ctx.auditSummary.topIssues.slice(0, 6).join(' | ')}`
            : '')
      );
    }
  }

  return [
    personaRole,
    'Nhiệm vụ: Tư vấn trực tiếp, ngắn gọn, có cấu trúc rõ ràng bằng tiếng Việt chuyên ngành mạng & M&E cho kỹ sư đang thiết kế trên phần mềm HACHIHI Network & Electrical Designer.',
    'Quy tắc trả lời:',
    '- Dựa vào ngữ cảnh dự án thực tế được cung cấp ở dưới (nếu có) để chỉ đích danh thiết bị, tủ rack, IP/VLAN hoặc lỗi cụ thể.',
    '- Nếu thiếu thông số chi tiết, nêu rõ giả định kỹ thuật tiêu chuẩn (TIA-568, TIA-606, PoE budget, dự phòng UPS 20-30%).',
    '- Trình bày bằng gạch đầu dòng ngắn gọn, dễ đọc, tránh lan man.',
    contextLines.length > 0 ? `\n--- NGỮ CẢNH DỰ ÁN HIỆN TẠI ---\n${contextLines.join('\n')}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

const MAX_MESSAGE_CHARS = 4000;
const MAX_HISTORY_TURNS = 16;
const RATE_WINDOW_MINUTE_MS = 60_000;
const RATE_WINDOW_HOUR_MS = 3_600_000;
const RATE_LIMIT_PER_MINUTE = Math.max(3, Number(process.env.CHAT_RATE_LIMIT_PER_MIN || 15));
const RATE_LIMIT_PER_HOUR = Math.max(10, Number(process.env.CHAT_RATE_LIMIT_PER_HOUR || 60));
const CHAT_DAILY_LIMIT = Math.max(20, Number(process.env.CHAT_DAILY_LIMIT || 500));

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL?.trim().replace(/\/+$/, '');
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

const ipHits = new Map<string, number[]>();
const dailyGlobalHits = new Map<string, number>();

function getClientIp(req: express.Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function getUtcDayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function runUpstashPipeline(commands: Array<Array<string | number>>): Promise<Array<{ result?: unknown }> | null> {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  try {
    const resp = await fetch(`${UPSTASH_URL}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(commands)
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

async function checkRateLimitShared(ip: string): Promise<{ allowed: boolean; retryAfterSec?: number; reason?: string; store: 'redis' | 'memory' }> {
  const now = Date.now();
  const minBucket = Math.floor(now / RATE_WINDOW_MINUTE_MS);
  const hourBucket = Math.floor(now / RATE_WINDOW_HOUR_MS);
  const dayKey = getUtcDayKey();

  // Attempt distributed Upstash Redis REST pipeline first when configured
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    const kMin = `hachihi:rl:m:${ip}:${minBucket}`;
    const kHour = `hachihi:rl:h:${ip}:${hourBucket}`;
    const kDay = `hachihi:rl:daily:${dayKey}`;
    const res = await runUpstashPipeline([
      ['INCR', kMin],
      ['EXPIRE', kMin, 70],
      ['INCR', kHour],
      ['EXPIRE', kHour, 3700],
      ['INCR', kDay],
      ['EXPIRE', kDay, 90000]
    ]);
    if (res && res.length >= 5) {
      const minCount = Number(res[0]?.result || 0);
      const hourCount = Number(res[2]?.result || 0);
      const dayCount = Number(res[4]?.result || 0);
      if (dayCount > CHAT_DAILY_LIMIT) {
        return { allowed: false, retryAfterSec: 3600, reason: 'daily_quota', store: 'redis' };
      }
      if (minCount > RATE_LIMIT_PER_MINUTE) {
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

  // Fallback in-memory sliding window + global daily budget
  const curDayTotal = dailyGlobalHits.get(dayKey) || 0;
  if (curDayTotal >= CHAT_DAILY_LIMIT) {
    return { allowed: false, retryAfterSec: 3600, reason: 'daily_quota', store: 'memory' };
  }

  const prev = (ipHits.get(ip) || []).filter(ts => now - ts < RATE_WINDOW_HOUR_MS);
  const lastMinuteCount = prev.filter(ts => now - ts < RATE_WINDOW_MINUTE_MS).length;

  if (lastMinuteCount >= RATE_LIMIT_PER_MINUTE) {
    const oldestInMin = prev.find(ts => now - ts < RATE_WINDOW_MINUTE_MS) || now;
    const retryAfterSec = Math.max(1, Math.ceil((oldestInMin + RATE_WINDOW_MINUTE_MS - now) / 1000));
    ipHits.set(ip, prev);
    return { allowed: false, retryAfterSec, store: 'memory' };
  }

  if (prev.length >= RATE_LIMIT_PER_HOUR) {
    const oldestInHour = prev[0] || now;
    const retryAfterSec = Math.max(1, Math.ceil((oldestInHour + RATE_WINDOW_HOUR_MS - now) / 1000));
    ipHits.set(ip, prev);
    return { allowed: false, retryAfterSec, store: 'memory' };
  }

  prev.push(now);
  ipHits.set(ip, prev);
  dailyGlobalHits.set(dayKey, curDayTotal + 1);
  if (dailyGlobalHits.size > 4) {
    for (const key of dailyGlobalHits.keys()) {
      if (key !== dayKey) dailyGlobalHits.delete(key);
    }
  }
  if (ipHits.size > 2000) {
    for (const [key, list] of ipHits.entries()) {
      if (list.every(ts => now - ts >= RATE_WINDOW_HOUR_MS)) ipHits.delete(key);
    }
  }
  return { allowed: true, store: 'memory' };
}

function isOriginAllowed(req: express.Request): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin / server-to-server
  const host = req.headers.host;
  try {
    const originHost = new URL(origin).host;
    if (host && originHost === host) return true;
  } catch {
    return false;
  }
  const configuredAppUrl = process.env.APP_URL?.trim();
  if (configuredAppUrl && configuredAppUrl !== 'MY_APP_URL') {
    try {
      if (new URL(origin).origin === new URL(configuredAppUrl).origin) return true;
    } catch {
      // ignore invalid APP_URL
    }
  }
  return false;
}

function applySecurityHeaders(_req: express.Request, res: express.Response, next: express.NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  const extraFrameAncestors = (process.env.ALLOWED_FRAME_ANCESTORS || '').trim();
  const scriptSrc = isProduction
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
  const connectSrc = isProduction ? "connect-src 'self'" : "connect-src 'self' ws: wss:";
  const frameAncestors = isProduction
    ? `frame-ancestors 'self' https://hachihi.vn https://*.hachihi.vn${extraFrameAncestors ? ` ${extraFrameAncestors}` : ''}`
    : "frame-ancestors 'self' https://aistudio.google.com https://*.google.com https://*.googleusercontent.com";

  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      connectSrc,
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      frameAncestors
    ].join('; ')
  );
  next();
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(applySecurityHeaders);
  app.use(express.json({ limit: '512kb' }));

  const pkgVersion = (() => {
    try {
      const raw = fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8');
      const parsed = JSON.parse(raw) as { version?: string };
      return parsed.version || '3.1.1';
    } catch {
      return '3.1.1';
    }
  })();

  app.get('/api/health', (_req, res) => {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    const aiConfigured = Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY' && apiKey !== 'YOUR_GEMINI_API_KEY');
    res.json({
      ok: true,
      service: 'hachihi-designer-api',
      version: pkgVersion,
      aiConfigured,
      rateLimiterBackend: UPSTASH_URL && UPSTASH_TOKEN ? 'upstash-redis' : 'in-memory',
      dailyQuotaLimit: CHAT_DAILY_LIMIT
    });
  });

  app.post('/api/gemini/chat', async (req, res) => {
    try {
      if (!isOriginAllowed(req)) {
        res.status(403).json({ error: 'Origin không được phép truy cập API.' });
        return;
      }

      const requiredSecret = process.env.CHAT_API_SECRET?.trim();
      if (requiredSecret) {
        const authHeader = req.headers.authorization || '';
        const provided =
          (typeof req.headers['x-hachihi-token'] === 'string' && req.headers['x-hachihi-token']) ||
          (typeof req.headers['x-hachihi-secret'] === 'string' && req.headers['x-hachihi-secret']) ||
          (authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '');
        if (provided !== requiredSecret) {
          res.status(401).json({ error: 'Thiếu hoặc sai mã xác thực truy cập Trợ lý AI.' });
          return;
        }
      }

      const rate = await checkRateLimitShared(getClientIp(req));
      if (!rate.allowed) {
        if (rate.retryAfterSec) res.setHeader('Retry-After', String(rate.retryAfterSec));
        res.status(429).json({
          error:
            rate.reason === 'daily_quota'
              ? 'Hệ thống Trợ lý AI đã đạt giới hạn sử dụng trong ngày (Daily Quota). Chế độ phân tích cục bộ vẫn sẵn sàng.'
              : `Bạn gửi yêu cầu quá nhanh. Vui lòng thử lại sau ${rate.retryAfterSec ?? 30} giây.`
        });
        return;
      }

      const apiKey = process.env.GEMINI_API_KEY?.trim();
      if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey === 'YOUR_GEMINI_API_KEY') {
        res.status(503).json({
          error: 'Chưa cấu hình GEMINI_API_KEY trên máy chủ. Chế độ phân tích cục bộ ngoại tuyến vẫn khả dụng.'
        });
        return;
      }

      const body = req.body as {
        message?: unknown;
        history?: unknown;
        persona?: unknown;
        modelMode?: unknown;
        projectContext?: ProjectContextSummary;
      };

      const message = typeof body?.message === 'string' ? body.message.trim() : '';
      if (!message) {
        res.status(400).json({ error: 'Nội dung câu hỏi không được để trống.' });
        return;
      }
      if (message.length > MAX_MESSAGE_CHARS) {
        res.status(400).json({
          error: `Câu hỏi vượt quá giới hạn ${MAX_MESSAGE_CHARS} ký tự.`
        });
        return;
      }

      const rawHistory = Array.isArray(body?.history) ? body.history : [];
      const sanitizedHistory: ChatTurnInput[] = rawHistory
        .filter(
          (item): item is ChatTurnInput =>
            Boolean(item) &&
            typeof item === 'object' &&
            (item.role === 'user' || item.role === 'model') &&
            typeof item.text === 'string' &&
            item.text.trim().length > 0
        )
        .slice(-MAX_HISTORY_TURNS)
        .map(turn => ({
          role: turn.role,
          text: turn.text.slice(0, MAX_MESSAGE_CHARS)
        }));

      const persona: AssistantPersona =
        body?.persona === 'rack_power' || body?.persona === 'bom_tia' ? body.persona : 'architect';
      const fastMode = body?.modelMode === 'fast';
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
        history: sanitizedHistory.map(turn => ({
          role: turn.role,
          parts: [{ text: turn.text }]
        })),
        config: {
          systemInstruction: buildSystemInstruction(persona, body?.projectContext),
          thinkingConfig: {
            thinkingLevel: fastMode ? ThinkingLevel.LOW : ThinkingLevel.MEDIUM
          }
        }
      });

      const response = await chat.sendMessage({ message });
      const reply = (response.text || '').trim();

      res.json({
        reply: reply || 'Trợ lý kỹ thuật chưa nhận được nội dung phản hồi. Vui lòng thử diễn đạt lại câu hỏi.',
        modelUsed: model
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const status =
        msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')
          ? 429
          : msg.includes('403') || msg.includes('PERMISSION_DENIED') || msg.includes('API_KEY')
          ? 403
          : 500;
      console.error('[/api/gemini/chat] Error:', msg);
      res.status(status).json({
        error:
          status === 429
            ? 'Hệ thống AI đang quá tải tạm thời (429). Vui lòng thử lại sau vài giây.'
            : status === 403
            ? 'Không có quyền truy cập Gemini API hoặc API Key không hợp lệ.'
            : `Lỗi xử lý trợ lý AI: ${msg}`
      });
    }
  });

  const httpServer = http.createServer(app);

  if (!isProduction) {
    const { createServer } = await import('vite');
    const disableHmr =
      process.env.DISABLE_HMR === 'true' ||
      Boolean(process.env.K_SERVICE) ||
      Boolean(process.env.APP_URL?.includes('.run.app'));
    const vite = await createServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
        hmr: disableHmr ? false : { server: httpServer },
        watch: disableHmr ? null : undefined
      },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.use((req, res, next) => {
      if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path.startsWith('/api/')) {
        return next();
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`HACHIHI Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
