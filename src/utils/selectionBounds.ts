import type { ProjectState, SelectionState } from '../types/infrastructure';
import { boundsOfValidRects, isFiniteRect, isSafeRect, unionRects } from './geometryResolver';
import { computeCableBounds, computeCableBundleJacketBounds, computeCableBundleLabelBounds } from './cableBounds';
import { computeCableBundleLayout, computeCablePath } from './cableRouting';
import { resolveVisibility } from './visibilityResolver';
import type { Rect } from './viewportMath';

/**
 * Bounds for "Zoom to Selection" (2D). Built ONLY on top of visibilityResolver (what the canvas
 * renders) and the same cable geometry the canvas draws (computeCableBundleLayout / computeCablePath).
 */
export type ZoomSelectionResult =
  | { status: 'ok'; bounds: Rect; omitted: number; note?: string }
  | { status: 'unsupported'; bounds: null; reason: string }
  | { status: 'invalid'; bounds: null; reason: string };

const unsupported = (reason: string): ZoomSelectionResult => ({ status: 'unsupported', bounds: null, reason });
const invalid = (reason: string): ZoomSelectionResult => ({ status: 'invalid', bounds: null, reason });

export interface ZoomSelectionOptions {
  /** Also cover the waypoint handles shown while a cable is being edited. Default false (view context). */
  includeEditHandles?: boolean;
  /** Read-only: no "+ Thêm nhãn" button and no edit handles are drawn, so none are measured. */
  isReadOnly?: boolean;
  /** Cable whose inline label editor is open (the canvas draws no badge/button for it). */
  editingCableLabelId?: string | null;
}

export function getZoomSelectionBounds(
  project: ProjectState,
  selection: SelectionState,
  options: ZoomSelectionOptions = {}
): ZoomSelectionResult {
  if (!selection.id || selection.type === 'none') return unsupported('Chưa chọn đối tượng');
  const ids = [selection.id, ...(selection.additionalIds || [])];
  const idSet = new Set(ids);
  const hiddenLayers = project.settings?.hiddenLayers;
  const vis = resolveVisibility({
    nodes: project.nodes,
    rooms: project.rooms,
    cables: project.cables,
    assets: project.assets,
    racks: project.racks,
    activeMode: project.activeMode,
    activeFloorId: project.activeFloorId,
    hiddenLayers
  });

  if (selection.type === 'node' || selection.type === 'rack') {
    const wanted = selection.type === 'rack' ? new Set(ids.flatMap(id => [id, `node_${id}`])) : idSet;
    const nodes = project.nodes.filter(n => wanted.has(n.id) && (selection.type === 'node' || n.type === 'rack'));
    const rects: Array<{ x: number; y: number; width: number; height: number }> = [];
    let omitted = 0;
    for (const n of nodes) {
      // SELECTABLE = rendered AND routable (see visibility contract): hidden layer/rack/node never attracts the zoom
      const rect = vis.getSelectableRect(n.id);
      if (rect) rects.push(rect);
      else omitted++;
    }
    if (nodes.length === 0) return unsupported('Không tìm thấy đối tượng đã chọn');
    const { bounds, invalidCount } = boundsOfValidRects(rects);
    if (!bounds) {
      return invalidCount > 0
        ? invalid('Dữ liệu tọa độ của đối tượng không hợp lệ (NaN/Infinity/kích thước âm)')
        : unsupported('Đối tượng đang ẩn hoặc không hiển thị trong bản vẽ hiện tại');
    }
    return { status: 'ok', bounds, omitted: omitted + invalidCount };
  }

  if (selection.type === 'room') {
    const rooms = vis.visibleRooms.filter(r => idSet.has(r.id));
    const { bounds, invalidCount } = boundsOfValidRects(rooms);
    if (!bounds) {
      return invalidCount > 0
        ? invalid('Dữ liệu phòng không hợp lệ')
        : unsupported('Phòng đang ẩn hoặc không hiển thị trong bản vẽ hiện tại');
    }
    return { status: 'ok', bounds, omitted: ids.length - rooms.length + invalidCount };
  }

  if (selection.type === 'edge') {
    // Strict: a partial zoom could make the user believe the whole route is visible.
    const selected = project.cables.filter(c => idSet.has(c.id));
    if (selected.length === 0) return unsupported('Không tìm thấy tuyến cáp đã chọn');
    if (hiddenLayers?.includes('cables')) return unsupported('Lớp cáp đang ẩn');
    const visibleIds = new Set(vis.visibleCables.map(c => c.id));
    const missing = selected.filter(c => !visibleIds.has(c.id));
    if (missing.length > 0 || selected.length !== ids.length) {
      return unsupported(
        `${missing.length || ids.length - selected.length} tuyến cáp có đầu cuối không hiển thị trong bản vẽ hiện tại nên không thể bao trọn tuyến`
      );
    }
    // Same layout call the canvas uses, over all visible cables (bundling offsets depend on siblings).
    const layout = computeCableBundleLayout(vis.visibleCables, vis.getRoutableRect);
    const labelLayerVisible = !hiddenLayers?.includes('cable_labels') && !hiddenLayers?.includes('labels');
    const showCableCodes = Boolean(project.settings?.showCableCodes);
    const rects: Rect[] = [];
    const bundleById = new Map(layout.bundles.map(b => [b.bundleId, b]));
    const countedBundles = new Set<string>();
    const isReadOnly = Boolean(options.isReadOnly);
    for (const cable of selected) {
      let info = layout.cablePaths.get(cable.id);
      if (!info) {
        const src = vis.getRoutableRect(cable.sourceNodeId);
        const tgt = vis.getRoutableRect(cable.targetNodeId);
        if (!src || !tgt || !isFiniteRect(src) || !isFiniteRect(tgt)) return invalid('Thiếu hình học đầu cuối của tuyến cáp');
        info = computeCablePath(cable, src, tgt);
      }
      const res = computeCableBounds(cable, info, {
        labelLayerVisible,
        showCableCodes,
        isBundled: layout.cableToBundleId.has(cable.id),
        isSelected: true,
        isReadOnly,
        isEditingLabel: options.editingCableLabelId === cable.id,
        includeEditHandles: Boolean(options.includeEditHandles) && !isReadOnly
      });
      if (!res.ok) return invalid(res.reason);
      rects.push(res.bounds);
      // Bundle summary badge + jacket: drawn once per bundle, however many of its cables are selected.
      const bundleId = layout.cableToBundleId.get(cable.id);
      const bundle = bundleId ? bundleById.get(bundleId) : undefined;
      if (bundle && !countedBundles.has(bundle.bundleId)) {
        countedBundles.add(bundle.bundleId);
        const jacket = computeCableBundleJacketBounds(bundle);
        if (!jacket.ok) return invalid(jacket.reason);
        rects.push(jacket.bounds);
        if (labelLayerVisible) {
          const badge = computeCableBundleLabelBounds(bundle);
          if (!badge.ok) return invalid(badge.reason);
          rects.push(badge.bounds);
        }
      }
    }
    const union = unionRects(rects)!;
    if (!isSafeRect(union)) return invalid('Bounds tổng hợp của vùng chọn vượt giới hạn tọa độ');
    return { status: 'ok', bounds: union, omitted: 0 };
  }

  return unsupported('Loại đối tượng này chưa hỗ trợ phóng to vùng chọn');
}
