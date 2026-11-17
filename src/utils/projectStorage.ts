import {
  ProjectState,
  CanvasSettings,
  ServerRack,
  DeviceAsset,
  ProjectSummary,
  VlanSpec,
  SubnetSpec,
  PatchLink,
  ProjectRevision,
  RevisionDiffSummary,
  CableTray,
  CanvasGuideLine
} from '../types/infrastructure';
import {
  isSafeSvgContent,
  MAX_PROJECT_ASSETS,
  MAX_PROJECT_CABLES,
  MAX_PROJECT_NODES,
  sanitizeSafeImageUrl
} from './security';
import { isValidCanvasLayerId } from './layerPolicy';

export const PRIMARY_STORAGE_KEY = 'hachihi_network_designer_v3_state';
export const RECOVERY_STORAGE_KEY = 'hachihi_network_designer_recovery_v4';
export const CURRENT_SCHEMA_VERSION = 5;

const IDB_NAME = 'hachihi_designer_db';
const IDB_VERSION = 2;
const STORE_PROJECTS = 'projects';
const STORE_META = 'meta';
const STORE_REVISIONS = 'revisions';

export const DEFAULT_CANVAS_SETTINGS: CanvasSettings = {
  gridSize: 20,
  snapToGrid: true,
  showRulers: true,
  showGrid: true,
  showPortLabels: true,
  showIpAddresses: true,
  showCableCodes: true,
  showCoverageRadius: true,
  unit: 'm',
  scale: 30,
  backgroundColor: '#f8fafc',
  isDarkMode: false,
  hiddenLayers: [],
  lockedLayers: [],
  autoLayeringEnabled: false,
  guideLines: [],
  ipRangeStart: '192.168.10.10',
  ipRangeEnd: '192.168.10.250',
  ipSubnetMask: '255.255.255.0',
  ipGateway: '192.168.10.1'
};

export type MigrationResult =
  | { ok: true; project: ProjectState; warnings: string[] }
  | { ok: false; error: string };

export interface StoredProjectRecord {
  id: string;
  name: string;
  author: string;
  version: string;
  lastModified: string;
  lastSavedAt: string;
  nodeCount: number;
  assetCount: number;
  rackCount: number;
  cableCount: number;
  isTrashed: boolean;
  trashedAt?: string;
  data: ProjectState;
}

function isPlainRecord(val: unknown): val is Record<string, unknown> {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

/**
 * Validates and migrates a saved/imported JSON project (including legacy Premium V3 files)
 * into a safe, normalized Ultimate Edition ProjectState without dropping existing devices,
 * rack placements, or cables.
 */
export function migrateAndValidateProject(raw: unknown): MigrationResult {
  if (!isPlainRecord(raw)) {
    return { ok: false, error: 'Dữ liệu dự án không phải đối tượng JSON hợp lệ.' };
  }

  if (!isPlainRecord(raw.assets)) {
    return { ok: false, error: 'Thiếu danh sách thiết bị (assets) trong file dự án.' };
  }
  if (!Array.isArray(raw.nodes)) {
    return { ok: false, error: 'Thiếu danh sách nút sơ đồ (nodes) trong file dự án.' };
  }

  const assetEntriesCount = Object.keys(raw.assets).length;
  if (assetEntriesCount > MAX_PROJECT_ASSETS) {
    return {
      ok: false,
      error: `Số lượng thiết bị (${assetEntriesCount}) vượt quá giới hạn an toàn (${MAX_PROJECT_ASSETS} thiết bị).`
    };
  }
  if (raw.nodes.length > MAX_PROJECT_NODES) {
    return {
      ok: false,
      error: `Số lượng nút sơ đồ (${raw.nodes.length}) vượt quá giới hạn an toàn (${MAX_PROJECT_NODES} nút).`
    };
  }
  if (Array.isArray(raw.cables) && raw.cables.length > MAX_PROJECT_CABLES) {
    return {
      ok: false,
      error: `Số lượng tuyến cáp (${raw.cables.length}) vượt quá giới hạn an toàn (${MAX_PROJECT_CABLES} tuyến).`
    };
  }

  const warnings: string[] = [];

  // Normalize assets
  const normalizedAssets: Record<string, DeviceAsset> = {};
  for (const [key, val] of Object.entries(raw.assets)) {
    if (!isPlainRecord(val)) continue;
    const a = val as unknown as DeviceAsset;
    const id = a.id || key;
    const sanitizedImg = sanitizeSafeImageUrl(a.customImageUrl);
    if (a.customImageUrl && !sanitizedImg) {
      warnings.push(`Đã gỡ URL ảnh thiết bị không an toàn trên "${a.name || id}".`);
    }
    const rawUps = isPlainRecord((val as Record<string, unknown>).upsSpecs)
      ? ((val as Record<string, unknown>).upsSpecs as Record<string, unknown>)
      : null;
    const normalizedUpsSpecs: DeviceAsset['upsSpecs'] =
      rawUps &&
      Number.isFinite(Number(rawUps.batteryAh)) &&
      Number.isFinite(Number(rawUps.batteryVoltageV)) &&
      Number.isFinite(Number(rawUps.batteryCount)) &&
      Number(rawUps.batteryAh) > 0 &&
      Number(rawUps.batteryVoltageV) > 0 &&
      Number(rawUps.batteryCount) > 0
        ? {
            ratedVa:
              Number.isFinite(Number(rawUps.ratedVa)) && Number(rawUps.ratedVa) > 0
                ? Math.round(Number(rawUps.ratedVa))
                : undefined,
            batteryAh: Number(rawUps.batteryAh),
            batteryVoltageV: Number(rawUps.batteryVoltageV),
            batteryCount: Math.max(1, Math.round(Number(rawUps.batteryCount))),
            inverterEfficiency:
              Number.isFinite(Number(rawUps.inverterEfficiency)) &&
              Number(rawUps.inverterEfficiency) >= 0.5 &&
              Number(rawUps.inverterEfficiency) <= 0.98
                ? Number(rawUps.inverterEfficiency)
                : undefined,
            dodFactor:
              Number.isFinite(Number(rawUps.dodFactor)) &&
              Number(rawUps.dodFactor) >= 0.4 &&
              Number(rawUps.dodFactor) <= 0.95
                ? Number(rawUps.dodFactor)
                : undefined
          }
        : undefined;
    normalizedAssets[id] = {
      ...a,
      id,
      name: a.name || `Device-${id.slice(-4)}`,
      category: a.category || 'switch',
      vendor: a.vendor || 'Generic',
      model: a.model || 'Standard',
      assetTag: a.assetTag || '',
      serialNumber: a.serialNumber || '',
      ipAddress: a.ipAddress || '',
      subnetMask: a.subnetMask || '255.255.255.0',
      gateway: a.gateway || '',
      macAddress: a.macAddress || '',
      vlan: a.vlan || '1',
      status: a.status || 'online',
      customImageUrl: sanitizedImg,
      rackSide: a.rackSide === 'rear' ? 'rear' : 'front',
      upsSpecs: normalizedUpsSpecs,
      ports: Array.isArray(a.ports) ? a.ports : []
    };
  }

  // Normalize racks (preserve legacy slots + initialize rearSlots safely)
  const rawRacks = Array.isArray(raw.racks) ? raw.racks : [];
  const normalizedRacks: ServerRack[] = rawRacks
    .filter((r): r is Record<string, unknown> => isPlainRecord(r))
    .map((r, idx) => {
      const unitsNum = Number(r.totalUnits);
      const totalUnits = Number.isFinite(unitsNum) && unitsNum >= 4 && unitsNum <= 64
        ? Math.round(unitsNum)
        : 42;
      const rackId = typeof r.id === 'string' && r.id ? r.id : `rack_mig_${idx + 1}`;

      const slots: Record<number, string> = {};
      if (isPlainRecord(r.slots)) {
        for (const [uKey, devId] of Object.entries(r.slots)) {
          const uNum = parseInt(uKey, 10);
          if (!Number.isNaN(uNum) && typeof devId === 'string' && normalizedAssets[devId]) {
            slots[uNum] = devId;
            if (!normalizedAssets[devId].rackId) {
              normalizedAssets[devId].rackId = rackId;
            }
            if (!normalizedAssets[devId].rackUnitStart) {
              normalizedAssets[devId].rackUnitStart = uNum;
            }
          }
        }
      }

      const rearSlots: Record<number, string> = {};
      if (isPlainRecord(r.rearSlots)) {
        for (const [uKey, devId] of Object.entries(r.rearSlots)) {
          const uNum = parseInt(uKey, 10);
          if (!Number.isNaN(uNum) && typeof devId === 'string' && normalizedAssets[devId]) {
            rearSlots[uNum] = devId;
            normalizedAssets[devId].rackSide = 'rear';
          }
        }
      }

      return {
        id: rackId,
        name: typeof r.name === 'string' && r.name ? r.name : `Rack ${idx + 1}`,
        buildingId: typeof r.buildingId === 'string' ? r.buildingId : undefined,
        floorId: typeof r.floorId === 'string' ? r.floorId : undefined,
        roomId: typeof r.roomId === 'string' ? r.roomId : undefined,
        totalUnits,
        widthMm: Number(r.widthMm) || 800,
        depthMm: Number(r.depthMm) || 1000,
        maxLoadKg: Number(r.maxLoadKg) || 1000,
        x: Number.isFinite(Number(r.x)) ? Number(r.x) : 300,
        y: Number.isFinite(Number(r.y)) ? Number(r.y) : 100,
        slots,
        rearSlots
      };
    });

  // Normalize nodes
  const normalizedNodes = raw.nodes
    .filter((n): n is Record<string, unknown> => isPlainRecord(n) && typeof n.id === 'string')
    .map(n => {
      const style = isPlainRecord(n.style) ? n.style : {};
      const safeNodeImg = sanitizeSafeImageUrl(typeof n.customImageUrl === 'string' ? n.customImageUrl : undefined);
      if (typeof n.customImageUrl === 'string' && n.customImageUrl && !safeNodeImg) {
        warnings.push(`Đã gỡ URL ảnh nút không an toàn trên "${String(n.label || n.id)}".`);
      }
      const rawCustomData = isPlainRecord(n.customData)
        ? (n.customData as ProjectState['nodes'][number]['customData'])
        : undefined;
      const hasLockedFlag = n.locked === true || rawCustomData?.locked === true;
      const normalizedCustomData =
        rawCustomData || hasLockedFlag
          ? {
              ...(rawCustomData || {}),
              ...(hasLockedFlag ? { locked: true } : {})
            }
          : undefined;
      return {
        ...(n as unknown as ProjectState['nodes'][number]),
        diagramMode: (n.diagramMode as ProjectState['activeMode']) || 'topology',
        type: (n.type as ProjectState['nodes'][number]['type']) || 'device',
        layerId: isValidCanvasLayerId(n.layerId) ? n.layerId : undefined,
        locked: hasLockedFlag ? true : undefined,
        hidden: n.hidden === true ? true : undefined,
        customData: normalizedCustomData,
        customImageUrl: safeNodeImg,
        label: typeof n.label === 'string' ? n.label : 'Node',
        x: Number.isFinite(Number(n.x)) ? Number(n.x) : 100,
        y: Number.isFinite(Number(n.y)) ? Number(n.y) : 100,
        width: Math.max(24, Number(n.width) || 140),
        height: Math.max(24, Number(n.height) || 56),
        rotation: Number(n.rotation) || 0,
        style: {
          backgroundColor: (style.backgroundColor as string) || '#0284c7',
          borderColor: (style.borderColor as string) || '#334155',
          borderWidth: Number(style.borderWidth) || 2,
          borderStyle: (style.borderStyle as 'solid' | 'dashed' | 'dotted') || 'solid',
          opacity: typeof style.opacity === 'number' ? style.opacity : 1,
          textColor: (style.textColor as string) || '#ffffff',
          iconColor: (style.iconColor as string) || '#ffffff'
        }
      };
    });

  const nodeIds = new Set(normalizedNodes.map(n => n.id));
  const rawCables = Array.isArray(raw.cables) ? raw.cables : [];
  const normalizedCables = rawCables
    .filter((c): c is ProjectState['cables'][number] => {
      if (!isPlainRecord(c) || typeof c.id !== 'string') return false;
      if (typeof c.sourceNodeId !== 'string' || typeof c.targetNodeId !== 'string') return false;
      if (!nodeIds.has(c.sourceNodeId) || !nodeIds.has(c.targetNodeId)) {
        warnings.push(`Bỏ qua tuyến cáp ${String(c.cableCode || c.id)} do thiếu thiết bị đầu/cuối.`);
        return false;
      }
      return true;
    })
    .map(c => ({
      ...c,
      label: typeof c.label === 'string' && c.label.trim().length > 0 ? c.label : undefined,
      labelFontSize:
        typeof c.labelFontSize === 'number' && Number.isFinite(c.labelFontSize)
          ? Math.max(7, Math.min(24, c.labelFontSize))
          : undefined,
      labelRotation:
        typeof c.labelRotation === 'number' && Number.isFinite(c.labelRotation)
          ? Math.max(-180, Math.min(180, c.labelRotation))
          : undefined,
      labelAutoOrient: typeof c.labelAutoOrient === 'boolean' ? c.labelAutoOrient : undefined
    }));

  const buildings = Array.isArray(raw.buildings) ? (raw.buildings as ProjectState['buildings']) : [];
  const floors = Array.isArray(raw.floors) ? (raw.floors as ProjectState['floors']) : [];
  const rooms = Array.isArray(raw.rooms) ? (raw.rooms as ProjectState['rooms']) : [];

  const rawSettings = isPlainRecord(raw.settings) ? (raw.settings as Partial<CanvasSettings>) : {};
  const safeBgUrl = sanitizeSafeImageUrl(rawSettings.backgroundImageUrl);
  if (rawSettings.backgroundImageUrl && !safeBgUrl) {
    warnings.push('Đã loại bỏ URL ảnh nền không an toàn khỏi cấu hình trang vẽ.');
  }

  const normalizedGuideLines: CanvasGuideLine[] = Array.isArray(rawSettings.guideLines)
    ? (rawSettings.guideLines as unknown[])
        .filter(
          (g): g is Record<string, unknown> =>
            isPlainRecord(g) &&
            (g.orientation === 'horizontal' || g.orientation === 'vertical') &&
            Number.isFinite(Number(g.pos))
        )
        .slice(0, 200)
        .map((g, idx) => ({
          id: typeof g.id === 'string' && g.id ? g.id : `guide_${idx + 1}`,
          orientation: g.orientation as 'horizontal' | 'vertical',
          pos: Math.round(Number(g.pos) * 10) / 10,
          floorId: typeof g.floorId === 'string' && g.floorId ? g.floorId : undefined
        }))
    : [];

  const settings: CanvasSettings = {
    ...DEFAULT_CANVAS_SETTINGS,
    ...rawSettings,
    autoLayeringEnabled: Boolean(rawSettings.autoLayeringEnabled),
    guideLines: normalizedGuideLines,
    backgroundImageUrl: safeBgUrl
  };

  const normalizedVlans: VlanSpec[] = Array.isArray(raw.vlans)
    ? raw.vlans
        .filter((v): v is Record<string, unknown> => isPlainRecord(v) && Number.isFinite(Number(v.vlanId)))
        .map((v, idx) => ({
          id: typeof v.id === 'string' && v.id ? v.id : `vlan_${Number(v.vlanId)}_${idx}`,
          vlanId: Math.max(1, Math.min(4094, Math.round(Number(v.vlanId)))),
          name: typeof v.name === 'string' && v.name ? v.name : `VLAN ${v.vlanId}`,
          purpose: typeof v.purpose === 'string' ? v.purpose : undefined,
          color: typeof v.color === 'string' ? v.color : undefined
        }))
    : [];

  const normalizedSubnets: SubnetSpec[] = Array.isArray(raw.subnets)
    ? raw.subnets
        .filter((s): s is Record<string, unknown> => isPlainRecord(s) && typeof s.cidr === 'string' && s.cidr.trim().length > 0)
        .map((s, idx) => ({
          id: typeof s.id === 'string' && s.id ? s.id : `subnet_${idx + 1}`,
          name: typeof s.name === 'string' && s.name ? s.name : String(s.cidr),
          cidr: String(s.cidr).trim(),
          vlanId: Number.isFinite(Number(s.vlanId)) ? Math.round(Number(s.vlanId)) : undefined,
          gateway: typeof s.gateway === 'string' ? s.gateway.trim() : undefined,
          dnsServers: typeof s.dnsServers === 'string' ? s.dnsServers.trim() : undefined,
          dhcpRange: typeof s.dhcpRange === 'string' ? s.dhcpRange.trim() : undefined,
          notes: typeof s.notes === 'string' ? s.notes : undefined
        }))
    : [];

  const normalizedPatchLinks: PatchLink[] = Array.isArray(raw.patchLinks)
    ? raw.patchLinks
        .filter((p): p is Record<string, unknown> => isPlainRecord(p) && typeof p.patchPanelAssetId === 'string')
        .map((p, idx) => ({
          id: typeof p.id === 'string' && p.id ? p.id : `patch_${idx + 1}`,
          patchPanelAssetId: String(p.patchPanelAssetId),
          patchPort: typeof p.patchPort === 'string' ? p.patchPort : `P${idx + 1}`,
          targetDeviceName: typeof p.targetDeviceName === 'string' ? p.targetDeviceName : '',
          targetPort: typeof p.targetPort === 'string' ? p.targetPort : undefined,
          cableCode: typeof p.cableCode === 'string' ? p.cableCode : undefined,
          roomName: typeof p.roomName === 'string' ? p.roomName : undefined,
          vlan: typeof p.vlan === 'string' ? p.vlan : undefined,
          notes: typeof p.notes === 'string' ? p.notes : undefined
        }))
    : [];

  const normalizedCableTrays: CableTray[] = Array.isArray(raw.cableTrays)
    ? raw.cableTrays
        .filter((t): t is Record<string, unknown> => isPlainRecord(t) && Array.isArray(t.points))
        .map((t, idx) => ({
          id: typeof t.id === 'string' && t.id ? t.id : `tray_${idx + 1}`,
          name: typeof t.name === 'string' && t.name ? t.name : `Máng cáp ${idx + 1}`,
          floorId: typeof t.floorId === 'string' ? t.floorId : undefined,
          kind:
            t.kind === 'power_tray' || t.kind === 'conduit'
              ? t.kind
              : 'network_tray',
          widthPx: Math.max(8, Math.min(120, Number(t.widthPx) || 24)),
          color: typeof t.color === 'string' ? t.color : undefined,
          points: (t.points as unknown[])
            .filter((pt): pt is Record<string, unknown> => isPlainRecord(pt) && Number.isFinite(Number(pt.x)) && Number.isFinite(Number(pt.y)))
            .map(pt => ({ x: Number(pt.x), y: Number(pt.y) }))
        }))
    : [];

  const migrated: ProjectState = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `proj_${Date.now()}`,
    name: typeof raw.name === 'string' && raw.name ? raw.name : 'HACHIHI Infrastructure Project',
    author: typeof raw.author === 'string' ? raw.author : 'Engineer',
    version: typeof raw.version === 'string' ? raw.version : '4.0.0',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    lastModified: typeof raw.lastModified === 'string' ? raw.lastModified : new Date().toISOString(),
    lastSavedAt: typeof raw.lastSavedAt === 'string' ? raw.lastSavedAt : new Date().toISOString(),
    buildings,
    floors,
    rooms,
    cableTrays: normalizedCableTrays,
    racks: normalizedRacks,
    assets: normalizedAssets,
    nodes: normalizedNodes,
    cables: normalizedCables,
    vlans: normalizedVlans,
    subnets: normalizedSubnets,
    patchLinks: normalizedPatchLinks,
    activeMode: (raw.activeMode as ProjectState['activeMode']) || 'topology',
    activeBuildingId: typeof raw.activeBuildingId === 'string' ? raw.activeBuildingId : buildings[0]?.id || '',
    activeFloorId: typeof raw.activeFloorId === 'string' ? raw.activeFloorId : floors[0]?.id || '',
    settings
  };

  return { ok: true, project: migrated, warnings };
}

/* --------------------------------------------------------------------------
 * IndexedDB Storage Engine (supports multi-project workspace, trash, meta)
 * -------------------------------------------------------------------------- */

function hasIndexedDB(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDB()) {
      reject(new Error('Trình duyệt không hỗ trợ IndexedDB.'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_REVISIONS)) {
        const revStore = db.createObjectStore(STORE_REVISIONS, { keyPath: 'id' });
        revStore.createIndex('by_project', 'projectId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Không thể mở cơ sở dữ liệu IndexedDB.'));
  });
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      return await navigator.storage.persist();
    }
  } catch {
    // non-fatal
  }
  return false;
}

export function toProjectSummary(rec: StoredProjectRecord): ProjectSummary {
  return {
    id: rec.id,
    name: rec.name,
    author: rec.author,
    version: rec.version,
    lastModified: rec.lastModified,
    lastSavedAt: rec.lastSavedAt,
    nodeCount: rec.nodeCount,
    assetCount: rec.assetCount,
    rackCount: rec.rackCount,
    cableCount: rec.cableCount,
    isTrashed: rec.isTrashed,
    trashedAt: rec.trashedAt
  };
}

function buildRecord(project: ProjectState, isTrashed = false, trashedAt?: string): StoredProjectRecord {
  const now = new Date().toISOString();
  return {
    id: project.id,
    name: project.name,
    author: project.author,
    version: project.version,
    lastModified: project.lastModified || now,
    lastSavedAt: project.lastSavedAt || now,
    nodeCount: project.nodes.length,
    assetCount: Object.keys(project.assets).length,
    rackCount: project.racks.length,
    cableCount: project.cables.length,
    isTrashed,
    trashedAt,
    data: project
  };
}

export async function saveProjectToDB(
  project: ProjectState,
  options?: { isTrashed?: boolean; trashedAt?: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const db = await openDB();
    const record = buildRecord(project, options?.isTrashed ?? false, options?.trashedAt);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_PROJECTS, STORE_META], 'readwrite');
      tx.objectStore(STORE_PROJECTS).put(record);
      if (!record.isTrashed) {
        tx.objectStore(STORE_META).put({ key: 'activeProjectId', value: project.id });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Lỗi ghi dữ liệu vào IndexedDB.'));
      tx.onabort = () => reject(tx.error || new Error('Giao dịch lưu IndexedDB bị hủy.'));
    });
    db.close();
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Không thể lưu vào IndexedDB: ${message}` };
  }
}

export async function listProjectsFromDB(): Promise<ProjectSummary[]> {
  try {
    const db = await openDB();
    const records = await new Promise<StoredProjectRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, 'readonly');
      const req = tx.objectStore(STORE_PROJECTS).getAll();
      req.onsuccess = () => resolve((req.result || []) as StoredProjectRecord[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return records
      .map(toProjectSummary)
      .sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());
  } catch {
    return [];
  }
}

export async function loadProjectFromDB(projectId: string): Promise<ProjectState | null> {
  try {
    const db = await openDB();
    const record = await new Promise<StoredProjectRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, 'readonly');
      const req = tx.objectStore(STORE_PROJECTS).get(projectId);
      req.onsuccess = () => resolve(req.result as StoredProjectRecord | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!record?.data) return null;
    const migrated = migrateAndValidateProject(record.data);
    return migrated.ok ? migrated.project : null;
  } catch {
    return null;
  }
}

export async function setProjectTrashStateInDB(projectId: string, isTrashed: boolean): Promise<boolean> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, 'readwrite');
      const store = tx.objectStore(STORE_PROJECTS);
      const getReq = store.get(projectId);
      getReq.onsuccess = () => {
        const rec = getReq.result as StoredProjectRecord | undefined;
        if (rec) {
          rec.isTrashed = isTrashed;
          rec.trashedAt = isTrashed ? new Date().toISOString() : undefined;
          store.put(rec);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}

export async function deleteProjectPermanentlyFromDB(projectId: string): Promise<boolean> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, 'readwrite');
      tx.objectStore(STORE_PROJECTS).delete(projectId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}

export async function getMetaValue<T = string>(key: string): Promise<T | null> {
  try {
    const db = await openDB();
    const res = await new Promise<{ key: string; value: T } | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const req = tx.objectStore(STORE_META).get(key);
      req.onsuccess = () => resolve(req.result as { key: string; value: T } | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return res ? res.value : null;
  } catch {
    return null;
  }
}

export async function setMetaValue<T = string>(key: string, value: T): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readwrite');
      tx.objectStore(STORE_META).put({ key, value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // non-fatal
  }
}

/* --------------------------------------------------------------------------
 * Named Project Revisions / Checkpoints
 * -------------------------------------------------------------------------- */

export async function saveRevisionToDB(revision: ProjectRevision): Promise<boolean> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_REVISIONS, 'readwrite');
      tx.objectStore(STORE_REVISIONS).put(revision);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}

export async function listRevisionsFromDB(projectId: string): Promise<ProjectRevision[]> {
  try {
    const db = await openDB();
    const list = await new Promise<ProjectRevision[]>((resolve, reject) => {
      const tx = db.transaction(STORE_REVISIONS, 'readonly');
      const store = tx.objectStore(STORE_REVISIONS);
      const index = store.index('by_project');
      const req = index.getAll(projectId);
      req.onsuccess = () => resolve((req.result || []) as ProjectRevision[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch {
    return [];
  }
}

export async function deleteRevisionFromDB(revisionId: string): Promise<boolean> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_REVISIONS, 'readwrite');
      tx.objectStore(STORE_REVISIONS).delete(revisionId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}

export function computeRevisionDiff(current: ProjectState, snapshot: ProjectState): RevisionDiffSummary {
  const curNodeIds = new Set(current.nodes.map(n => n.id));
  const snapNodeIds = new Set(snapshot.nodes.map(n => n.id));
  const curAssetIds = new Set(Object.keys(current.assets));
  const snapAssetIds = new Set(Object.keys(snapshot.assets));
  const curCableIds = new Set(current.cables.map(c => c.id));
  const snapCableIds = new Set(snapshot.cables.map(c => c.id));
  const curRackIds = new Set(current.racks.map(r => r.id));
  const snapRackIds = new Set(snapshot.racks.map(r => r.id));

  let addedNodes = 0;
  let removedNodes = 0;
  curNodeIds.forEach(id => { if (!snapNodeIds.has(id)) addedNodes++; });
  snapNodeIds.forEach(id => { if (!curNodeIds.has(id)) removedNodes++; });

  let addedAssets = 0;
  let removedAssets = 0;
  curAssetIds.forEach(id => { if (!snapAssetIds.has(id)) addedAssets++; });
  snapAssetIds.forEach(id => { if (!curAssetIds.has(id)) removedAssets++; });

  let addedCables = 0;
  let removedCables = 0;
  curCableIds.forEach(id => { if (!snapCableIds.has(id)) addedCables++; });
  snapCableIds.forEach(id => { if (!curCableIds.has(id)) removedCables++; });

  let addedRacks = 0;
  let removedRacks = 0;
  curRackIds.forEach(id => { if (!snapRackIds.has(id)) addedRacks++; });
  snapRackIds.forEach(id => { if (!curRackIds.has(id)) removedRacks++; });

  return {
    addedNodes,
    removedNodes,
    addedAssets,
    removedAssets,
    addedCables,
    removedCables,
    addedRacks,
    removedRacks
  };
}

export interface DetailedAssetFieldChange {
  field: string;
  label: string;
  before: string;
  after: string;
}

export interface DetailedAssetDiffEntry {
  assetId: string;
  name: string;
  changes: DetailedAssetFieldChange[];
}

export interface DetailedRevisionDiff {
  summary: RevisionDiffSummary;
  addedNodeLabels: string[];
  removedNodeLabels: string[];
  addedCableCodes: string[];
  removedCableCodes: string[];
  modifiedAssets: DetailedAssetDiffEntry[];
}

export function computeDetailedRevisionDiff(
  current: ProjectState,
  snapshot: ProjectState
): DetailedRevisionDiff {
  const summary = computeRevisionDiff(current, snapshot);
  const curNodeMap = new Map(current.nodes.map(n => [n.id, n]));
  const snapNodeMap = new Map(snapshot.nodes.map(n => [n.id, n]));
  const curCableMap = new Map(current.cables.map(c => [c.id, c]));
  const snapCableMap = new Map(snapshot.cables.map(c => [c.id, c]));

  const addedNodeLabels: string[] = [];
  const removedNodeLabels: string[] = [];
  curNodeMap.forEach((n, id) => {
    if (!snapNodeMap.has(id)) addedNodeLabels.push(n.label || id);
  });
  snapNodeMap.forEach((n, id) => {
    if (!curNodeMap.has(id)) removedNodeLabels.push(n.label || id);
  });

  const addedCableCodes: string[] = [];
  const removedCableCodes: string[] = [];
  curCableMap.forEach((c, id) => {
    if (!snapCableMap.has(id)) addedCableCodes.push(c.cableCode || id);
  });
  snapCableMap.forEach((c, id) => {
    if (!curCableMap.has(id)) removedCableCodes.push(c.cableCode || id);
  });

  const modifiedAssets: DetailedAssetDiffEntry[] = [];
  const trackedFields: Array<{ key: keyof ProjectState['assets'][string]; label: string }> = [
    { key: 'name', label: 'Tên thiết bị' },
    { key: 'ipAddress', label: 'Địa chỉ IP' },
    { key: 'vlan', label: 'VLAN' },
    { key: 'rackUnitStart', label: 'Vị trí U' },
    { key: 'status', label: 'Trạng thái' }
  ];

  for (const [assetId, curAsset] of Object.entries(current.assets)) {
    const snapAsset = snapshot.assets[assetId];
    if (!snapAsset) continue;
    const changes: DetailedAssetFieldChange[] = [];
    for (const f of trackedFields) {
      const before = snapAsset[f.key] !== undefined && snapAsset[f.key] !== '' ? String(snapAsset[f.key]) : '—';
      const after = curAsset[f.key] !== undefined && curAsset[f.key] !== '' ? String(curAsset[f.key]) : '—';
      if (before !== after) {
        changes.push({ field: String(f.key), label: f.label, before, after });
      }
    }
    if (changes.length > 0) {
      modifiedAssets.push({
        assetId,
        name: curAsset.name || assetId,
        changes
      });
    }
  }

  return {
    summary,
    addedNodeLabels,
    removedNodeLabels,
    addedCableCodes,
    removedCableCodes,
    modifiedAssets
  };
}

/**
 * Exports all non-trashed projects in IndexedDB as a single workspace backup bundle.
 */
export async function exportAllProjectsBundle(): Promise<{
  bundleVersion: number;
  exportedAt: string;
  projects: ProjectState[];
}> {
  const db = await openDB();
  const records = await new Promise<StoredProjectRecord[]>((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readonly');
    const req = tx.objectStore(STORE_PROJECTS).getAll();
    req.onsuccess = () => resolve((req.result || []) as StoredProjectRecord[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return {
    bundleVersion: 1,
    exportedAt: new Date().toISOString(),
    projects: records.filter(r => !r.isTrashed).map(r => r.data)
  };
}

/**
 * Legacy localStorage helpers kept for migration & emergency recovery fallback.
 */
export function safeSaveToStorage(key: string, project: ProjectState): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(project));
    return true;
  } catch {
    return false;
  }
}

export function safeLoadFromStorage(key: string): ProjectState | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const result = migrateAndValidateProject(parsed);
    return result.ok ? result.project : null;
  } catch {
    return null;
  }
}

/**
 * Validates and converts an uploaded device icon image (PNG/JPG/WebP/SVG) into
 * a safe, compact 96x96 PNG Data URL so scripts inside SVGs are stripped.
 */
export async function validateAndConvertIconImage(
  file: File
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif'];
  if (!allowedTypes.includes(file.type)) {
    return { ok: false, error: 'Định dạng ảnh không hỗ trợ. Chọn PNG, JPG, WebP hoặc SVG.' };
  }
  if (file.size > 2 * 1024 * 1024) {
    return { ok: false, error: 'Kích thước ảnh tối đa 2MB.' };
  }

  if (file.type === 'image/svg+xml') {
    try {
      const svgText = await file.text();
      if (!isSafeSvgContent(svgText)) {
        return { ok: false, error: 'Tệp SVG chứa thẻ hoặc đường dẫn không an toàn.' };
      }
    } catch {
      return { ok: false, error: 'Không thể đọc nội dung tệp SVG.' };
    }
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve({ ok: false, error: 'Không thể đọc tệp hình ảnh.' });
    reader.onload = () => {
      const src = reader.result as string;
      const img = new window.Image();
      img.onerror = () => resolve({ ok: false, error: 'Hình ảnh bị hỏng hoặc không hợp lệ.' });
      img.onload = () => {
        try {
          const maxDim = 256;
          const canvas = document.createElement('canvas');
          canvas.width = maxDim;
          canvas.height = maxDim;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve({ ok: false, error: 'Trình duyệt không hỗ trợ xử lý ảnh.' });
            return;
          }
          const scale = Math.min(maxDim / (img.width || maxDim), maxDim / (img.height || maxDim));
          const w = (img.width || maxDim) * scale;
          const h = (img.height || maxDim) * scale;
          ctx.clearRect(0, 0, maxDim, maxDim);
          ctx.drawImage(img, (maxDim - w) / 2, (maxDim - h) / 2, w, h);
          const pngDataUrl = canvas.toDataURL('image/png', 0.9);
          resolve({ ok: true, dataUrl: pngDataUrl });
        } catch {
          resolve({ ok: false, error: 'Lỗi nén biểu tượng ảnh.' });
        }
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}
