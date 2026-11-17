/**
 * Ước lượng "ngân sách" của cảnh 3D TRƯỚC khi serialize (scene.toJSON) và trước khi tạo HTML.
 * Mục tiêu: từ chối sớm cảnh quá lớn, tránh treo / hết bộ nhớ trình duyệt ở bước tốn kém.
 *
 * Các hằng số ước lượng là heuristic bảo thủ; hiệu chỉnh bằng phép đo thực (xem e2e / CHANGELOG V2.8).
 * Không import three: chỉ dùng cấu trúc đối tượng (duck-typing) nên test được trong Node.
 */
export interface BudgetObject {
  isMesh?: boolean;
  isSprite?: boolean;
  isInstancedMesh?: boolean;
  count?: number;
  geometry?: {
    uuid?: string;
    attributes?: Record<string, { count?: number; itemSize?: number }>;
    index?: { count?: number } | null;
  } | null;
  material?: BudgetMaterial | BudgetMaterial[] | null;
}

export interface BudgetMaterial {
  uuid?: string;
  [key: string]: unknown;
}

export interface BudgetScene {
  traverse: (cb: (o: BudgetObject) => void) => void;
}

export interface SceneBudgetLimits {
  maxMeshes: number;
  maxTextures: number;
  /** Số pixel tối đa cho MỘT texture (mặc định 4096×4096). */
  maxTexturePixels: number;
  /** Tổng số pixel tối đa của mọi texture. */
  maxTotalTexturePixels: number;
  /** Ngưỡng cứng dung lượng JSON ước lượng (byte). */
  maxEstimatedBytes: number;
  warnEstimatedBytes: number;
}

export const DEFAULT_SCENE_BUDGET_LIMITS: SceneBudgetLimits = {
  maxMeshes: 60_000,
  maxTextures: 96,
  maxTexturePixels: 4096 * 4096,
  maxTotalTexturePixels: 64 * 1024 * 1024,
  maxEstimatedBytes: 120 * 1024 * 1024,
  warnEstimatedBytes: 25 * 1024 * 1024
};

export interface SceneBudgetReport {
  meshes: number;
  geometries: number;
  materials: number;
  textures: number;
  totalTexturePixels: number;
  estimatedBytes: number;
  level: 'ok' | 'warn' | 'reject';
  reasons: string[];
}

// Ước lượng dung lượng JSON: số thực ~9 ký tự; chỉ số ~7; ảnh texture PNG base64 ~1,2 byte/pixel.
const BYTES_PER_FLOAT = 9;
const BYTES_PER_INDEX = 7;
const BYTES_PER_TEXTURE_PIXEL = 1.2;
const BYTES_PER_OBJECT = 420;
const BYTES_PER_MATERIAL = 700;

const TEXTURE_KEYS = [
  'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap',
  'alphaMap', 'bumpMap', 'envMap', 'lightMap', 'displacementMap'
];

function textureSize(tex: any): { w: number; h: number } {
  const img = tex?.image;
  const w = Number(img?.width ?? img?.videoWidth ?? 0);
  const h = Number(img?.height ?? img?.videoHeight ?? 0);
  return { w: Number.isFinite(w) ? w : 0, h: Number.isFinite(h) ? h : 0 };
}

export function estimateSceneBudget(
  scene: BudgetScene,
  limits: SceneBudgetLimits = DEFAULT_SCENE_BUDGET_LIMITS
): SceneBudgetReport {
  const geoSeen = new Set<string | object>();
  const matSeen = new Set<string | object>();
  const texSeen = new Set<string | object>();
  let meshes = 0;
  let objects = 0;
  let bytes = 0;
  let totalPixels = 0;
  let maxTexturePixelsSeen = 0;
  const reasons: string[] = [];

  scene.traverse(o => {
    objects++;
    if (o.isMesh || o.isSprite) meshes++;
    const g = o.geometry;
    if (g) {
      const key = g.uuid ?? (g as object);
      if (!geoSeen.has(key)) {
        geoSeen.add(key);
        for (const a of Object.values(g.attributes ?? {})) {
          bytes += (a.count ?? 0) * (a.itemSize ?? 1) * BYTES_PER_FLOAT;
        }
        bytes += (g.index?.count ?? 0) * BYTES_PER_INDEX;
      }
    }
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      const mk = m.uuid ?? (m as object);
      if (matSeen.has(mk)) continue;
      matSeen.add(mk);
      bytes += BYTES_PER_MATERIAL;
      for (const k of TEXTURE_KEYS) {
        const tex = (m as any)[k];
        if (!tex || typeof tex !== 'object') continue;
        const tk = tex.uuid ?? tex;
        if (texSeen.has(tk)) continue;
        texSeen.add(tk);
        const { w, h } = textureSize(tex);
        const px = w * h;
        totalPixels += px;
        maxTexturePixelsSeen = Math.max(maxTexturePixelsSeen, px);
        bytes += px * BYTES_PER_TEXTURE_PIXEL;
      }
    }
  });
  bytes += objects * BYTES_PER_OBJECT;

  let level: SceneBudgetReport['level'] = 'ok';
  if (meshes > limits.maxMeshes) reasons.push(`số mesh ${meshes} > ${limits.maxMeshes}`);
  if (texSeen.size > limits.maxTextures) reasons.push(`số texture ${texSeen.size} > ${limits.maxTextures}`);
  if (maxTexturePixelsSeen > limits.maxTexturePixels) reasons.push(`có texture quá lớn (${maxTexturePixelsSeen} pixel)`);
  if (totalPixels > limits.maxTotalTexturePixels) reasons.push(`tổng pixel texture ${totalPixels} > ${limits.maxTotalTexturePixels}`);
  if (bytes > limits.maxEstimatedBytes) {
    reasons.push(`dung lượng ước lượng ${(bytes / 1048576).toFixed(0)} MB > ${(limits.maxEstimatedBytes / 1048576).toFixed(0)} MB`);
  }
  if (reasons.length) level = 'reject';
  else if (bytes > limits.warnEstimatedBytes) level = 'warn';

  return {
    meshes,
    geometries: geoSeen.size,
    materials: matSeen.size,
    textures: texSeen.size,
    totalTexturePixels: totalPixels,
    estimatedBytes: Math.round(bytes),
    level,
    reasons
  };
}

export class SceneTooLargeError extends Error {
  readonly report: SceneBudgetReport;
  constructor(report: SceneBudgetReport) {
    super(
      `Cảnh 3D quá lớn để đóng gói HTML (${report.reasons.join('; ')}). ` +
        'Hãy ẩn bớt tầng/lớp hoặc xuất từng khu vực rồi thử lại.'
    );
    this.name = 'SceneTooLargeError';
    this.report = report;
  }
}

/** Ném SceneTooLargeError nếu vượt ngưỡng cứng; trả về báo cáo (có thể level 'warn'). */
export function assertSceneBudget(
  scene: BudgetScene,
  limits: SceneBudgetLimits = DEFAULT_SCENE_BUDGET_LIMITS
): SceneBudgetReport {
  const report = estimateSceneBudget(scene, limits);
  if (report.level === 'reject') throw new SceneTooLargeError(report);
  return report;
}

/** Số byte UTF-8 của chuỗi mà KHÔNG cấp phát thêm bộ nhớ (khác với new Blob([s]).size). */
export function utf8ByteLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}
