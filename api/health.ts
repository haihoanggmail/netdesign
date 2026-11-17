interface ServerlessRes {
  status: (code: number) => ServerlessRes;
  json: (data: unknown) => void;
}

export default function handler(_req: unknown, res: ServerlessRes) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const aiConfigured = Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY' && apiKey !== 'YOUR_GEMINI_API_KEY');
  const upstashConfigured = Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() && process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  );

  const dailyQuotaLimit = Math.max(20, Number(process.env.CHAT_DAILY_LIMIT || 500));

  res.status(200).json({
    ok: true,
    service: 'hachihi-designer-api',
    aiConfigured,
    rateLimiterBackend: upstashConfigured ? 'upstash-redis' : 'in-memory',
    dailyQuotaLimit
  });
}
