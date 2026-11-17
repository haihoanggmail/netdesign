import type { Rect } from './viewportMath';

/** Geometry helpers with input validation. Pure, no React/DOM. */
export const MAX_ABS_COORD = 1e7;

export const isFiniteRect = (r: { x: number; y: number; width: number; height: number }): boolean =>
  [r.x, r.y, r.width, r.height].every(v => typeof v === 'number' && Number.isFinite(v)) &&
  r.width >= 0 &&
  r.height >= 0 &&
  Math.abs(r.x) <= MAX_ABS_COORD &&
  Math.abs(r.y) <= MAX_ABS_COORD &&
  r.width <= MAX_ABS_COORD &&
  r.height <= MAX_ABS_COORD;

export interface BoundsResult {
  bounds: Rect | null;
  /** items rejected because their geometry was NaN / Infinity / negative size / absurdly large */
  invalidCount: number;
}

/** Union bounds of valid rects. Invalid rects are skipped and counted, never poison the result. */
export function boundsOfValidRects(rects: Array<{ x: number; y: number; width: number; height: number }>): BoundsResult {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let invalidCount = 0;
  let valid = 0;
  for (const r of rects) {
    if (!isFiniteRect(r)) {
      invalidCount++;
      continue;
    }
    valid++;
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { bounds: valid > 0 ? { minX, minY, maxX, maxY } : null, invalidCount };
}

export function expandRect(r: Rect, pad: number): Rect {
  return { minX: r.minX - pad, minY: r.minY - pad, maxX: r.maxX + pad, maxY: r.maxY + pad };
}

/** Exact extrema of a 1-D Bezier of degree 2 or 3 over t∈[0,1] (plus endpoints). */
function bezierAxisExtrema(p: number[]): number[] {
  const vals = [p[0], p[p.length - 1]];
  const roots: number[] = [];
  if (p.length === 3) {
    const den = p[0] - 2 * p[1] + p[2];
    if (Math.abs(den) > 1e-12) roots.push((p[0] - p[1]) / den);
  } else {
    const a = -p[0] + 3 * p[1] - 3 * p[2] + p[3];
    const b = 2 * (p[0] - 2 * p[1] + p[2]);
    const c = p[1] - p[0];
    if (Math.abs(a) < 1e-12) {
      if (Math.abs(b) > 1e-12) roots.push(-c / b);
    } else {
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        roots.push((-b + sq) / (2 * a), (-b - sq) / (2 * a));
      }
    }
  }
  for (const t of roots) {
    if (t <= 0 || t >= 1) continue;
    const mt = 1 - t;
    vals.push(
      p.length === 3
        ? mt * mt * p[0] + 2 * mt * t * p[1] + t * t * p[2]
        : mt * mt * mt * p[0] + 3 * mt * mt * t * p[1] + 3 * mt * t * t * p[2] + t * t * t * p[3]
    );
  }
  return vals;
}

export const isSafeRect = (r: Rect): boolean =>
  [r.minX, r.minY, r.maxX, r.maxY].every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_ABS_COORD) &&
  r.minX <= r.maxX &&
  r.minY <= r.maxY;

export const unionRects = (rects: Rect[]): Rect | null =>
  rects.length === 0
    ? null
    : rects.reduce((a, r) => ({
        minX: Math.min(a.minX, r.minX),
        minY: Math.min(a.minY, r.minY),
        maxX: Math.max(a.maxX, r.maxX),
        maxY: Math.max(a.maxY, r.maxY)
      }));

/** Axis-aligned bounds of a w×h rectangle centred at (cx,cy) rotated by angleDeg (exact, not a padding guess). */
export function rotatedRectBounds(cx: number, cy: number, w: number, h: number, angleDeg: number): Rect {
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  const hx = (w / 2) * c + (h / 2) * s;
  const hy = (w / 2) * s + (h / 2) * c;
  return { minX: cx - hx, minY: cy - hy, maxX: cx + hx, maxY: cy + hy };
}

export type PathBoundsResult = { ok: true; bounds: Rect } | { ok: false; reason: string };

const PATH_ARITY: Record<string, number> = { M: 2, L: 2, Q: 4, C: 6 };
const PATH_TOKEN = /\s*,?\s*(?:([A-Za-z])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?))/y;

/**
 * STRICT bounds of the absolute SVG path produced by computeCablePath (commands M, L, Q, C only).
 * Rejects – with a concrete reason – anything it cannot prove correct: unknown/relative/Z commands,
 * stray characters (NaN, Infinity, ...), wrong argument counts, a path not starting with M, and any
 * coordinate (including Bezier extrema) beyond ±MAX_ABS_COORD.
 * If the renderer ever starts emitting S/H/V/A/relative commands this parser MUST be extended at the same time;
 * until then those paths are refused instead of silently mis-measured.
 */
export function parseSvgPathBounds(d: string): PathBoundsResult {
  if (typeof d !== 'string' || d.trim() === '') return { ok: false, reason: 'Path rỗng' };
  type Seg = { cmd: string; args: number[] };
  const segs: Seg[] = [];
  PATH_TOKEN.lastIndex = 0;
  let pos = 0;
  const trimmedEnd = d.replace(/\s+$/, '').length;
  while (pos < trimmedEnd) {
    PATH_TOKEN.lastIndex = pos;
    const m = PATH_TOKEN.exec(d);
    if (!m || m.index !== pos) return { ok: false, reason: `Ký tự không hợp lệ trong path tại vị trí ${pos}` };
    pos = PATH_TOKEN.lastIndex;
    if (m[1]) {
      if (!(m[1] in PATH_ARITY)) return { ok: false, reason: `Lệnh path không được hỗ trợ: "${m[1]}"` };
      segs.push({ cmd: m[1], args: [] });
    } else {
      if (segs.length === 0) return { ok: false, reason: 'Path phải bắt đầu bằng lệnh M' };
      segs[segs.length - 1].args.push(Number(m[2]));
    }
  }
  if (segs.length === 0 || segs[0].cmd !== 'M') return { ok: false, reason: 'Path phải bắt đầu bằng lệnh M' };

  const xs: number[] = [];
  const ys: number[] = [];
  let cur: { x: number; y: number } | null = null;
  for (const { cmd, args } of segs) {
    const n = PATH_ARITY[cmd];
    if (args.length === 0 || args.length % n !== 0) {
      return { ok: false, reason: `Lệnh ${cmd} cần bội số của ${n} tham số, nhận ${args.length}` };
    }
    if (!args.every(v => Number.isFinite(v) && Math.abs(v) <= MAX_ABS_COORD)) {
      return { ok: false, reason: 'Tọa độ trong path không hữu hạn hoặc vượt giới hạn cho phép' };
    }
    for (let k = 0; k < args.length; k += n) {
      if (cmd === 'M' || cmd === 'L') {
        cur = { x: args[k], y: args[k + 1] };
        xs.push(cur.x);
        ys.push(cur.y);
      } else {
        if (!cur) return { ok: false, reason: 'Đường cong không có điểm bắt đầu' };
        const px: number[] = [cur.x];
        const py: number[] = [cur.y];
        for (let q = 0; q < n; q += 2) {
          px.push(args[k + q]);
          py.push(args[k + q + 1]);
        }
        xs.push(...bezierAxisExtrema(px));
        ys.push(...bezierAxisExtrema(py));
        cur = { x: px[px.length - 1], y: py[py.length - 1] };
      }
    }
  }
  const bounds = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  if (!isSafeRect(bounds)) return { ok: false, reason: 'Bounds của path vượt giới hạn tọa độ' };
  return { ok: true, bounds };
}

/** Back-compat wrapper: bounds or null (null carries no reason – prefer parseSvgPathBounds). */
export function svgPathBounds(d: string): Rect | null {
  const r = parseSvgPathBounds(d);
  return r.ok ? r.bounds : null;
}

/**
 * Axis-aligned bounds of a LOCAL rectangle [minX..maxX]×[minY..maxY] (relative to its origin) that is rotated by
 * angleDeg around the origin placed at (ox, oy). Unlike rotatedRectBounds the local box may be asymmetric
 * (needed for drop-shadows, which extend further on one side).
 */
export function transformedLocalRectBounds(ox: number, oy: number, angleDeg: number, minX: number, minY: number, maxX: number, maxY: number): Rect {
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const [x, y] of [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]]) {
    const px = ox + x * c - y * s;
    const py = oy + x * s + y * c;
    bx0 = Math.min(bx0, px); by0 = Math.min(by0, py); bx1 = Math.max(bx1, px); by1 = Math.max(by1, py);
  }
  return { minX: bx0, minY: by0, maxX: bx1, maxY: by1 };
}
