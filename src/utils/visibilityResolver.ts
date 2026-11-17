import type { CableEdge, DeviceAsset, DiagramNode, ProjectState, Room, ServerRack } from '../types/infrastructure';
import {
  getAssetUHeight,
  getRackCanvasMetrics,
  getSlotSpanRect,
  isRackMountedTopologyShadowNode,
  layoutRackNodesForElevationMode
} from './rackGeometry';
import { resolveNodeLayer } from './layerPolicy';

/**
 * SINGLE SOURCE OF TRUTH for "what is visible on the 2D canvas".
 * Used by DesignCanvas (render), selection bounds / zoom-to-selection and any other feature
 * that must agree with what the user actually sees. Do not re-implement these rules elsewhere.
 */
/**
 * VISIBILITY CONTRACT – three DIFFERENT questions, never answered by one function:
 *
 *  1. RENDERED   isNodeRendered(id)      – is the object actually drawn right now?
 *                                           (not `hidden`, on the active floor/mode, and its layer is not hidden;
 *                                            a rack-mounted device is drawn only if its rack is drawn too)
 *  2. ROUTABLE   getRoutableRect(id)     – does the node have valid geometry for a cable to attach to?
 *                                           Layer visibility does NOT matter, only whether the geometry exists in
 *                                           the current view (not `hidden`, on the floor/mode, rack present for mounted devices).
 *  3. SELECTABLE getSelectableRect(id)   – may Selection / Zoom-to-Selection use it? = RENDERED && ROUTABLE.
 *
 * Cable policy (CABLE_ENDPOINT_POLICY = 'keep-routed'): hiding the layer of a device/rack hides that object but a cable
 * attached to it stays drawn, anchored to the hidden object's geometry. A cable disappears ONLY when an endpoint has no
 * geometry in the current view (hidden flag, other floor, wrong mode, missing node, missing rack) or the cables layer is off.
 * To switch to "cables follow their endpoints' rendering", change computeVisibleCables to also require isNodeRendered.
 */
export const CABLE_ENDPOINT_POLICY = 'keep-routed' as const;

export type VisibilityInput = Pick<ProjectState, 'nodes' | 'rooms' | 'cables' | 'assets' | 'racks' | 'activeMode' | 'activeFloorId'> & {
  hiddenLayers?: ReadonlyArray<string>;
};

export interface RectBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const FLOOR_SCOPED_MODES: ReadonlyArray<string> = ['floorplan', 'cctv', 'wifi', 'fiber'];

export const isRackLikeNode = (n: DiagramNode, assets: Record<string, DeviceAsset>): boolean =>
  n.type === 'rack' || Boolean(n.assetId && assets[n.assetId]?.category === 'rack');

export function computeVisibleNodes(
  input: Pick<VisibilityInput, 'nodes' | 'assets' | 'racks' | 'activeMode' | 'activeFloorId'>
): DiagramNode[] {
  const { nodes, assets, racks, activeMode, activeFloorId } = input;
  // A HIDDEN rack still owns the devices mounted in it: they must not pop out of the plan at their meaningless
  // topology coordinates just because the rack node is hidden (V2.4 T01).
  const floorplanRackNodes = nodes.filter(n => n.type === 'rack' && n.diagramMode === 'floorplan');
  const raw = nodes.filter(n => {
    if (n.hidden) return false;
    if (FLOOR_SCOPED_MODES.includes(activeMode)) {
      if (n.floorId && activeFloorId && n.floorId !== activeFloorId) return false;
      if (isRackMountedTopologyShadowNode(n, assets, floorplanRackNodes, racks)) return false;
    }
    if (activeMode === 'rack') return n.diagramMode === 'rack' || n.type === 'rack';
    return true;
  });
  if (activeMode === 'rack') {
    const rackNodes = raw.filter(n => isRackLikeNode(n, assets));
    const nonRackNodes = raw.filter(n => !isRackLikeNode(n, assets));
    return [...layoutRackNodesForElevationMode(rackNodes, racks), ...nonRackNodes];
  }
  return raw;
}

export function computeVisibleRooms(
  input: Pick<VisibilityInput, 'rooms' | 'activeMode' | 'activeFloorId' | 'hiddenLayers'>
): Room[] {
  if (input.hiddenLayers?.includes('rooms')) return [];
  return input.rooms.filter(r => {
    if (FLOOR_SCOPED_MODES.includes(input.activeMode)) {
      if (r.floorId && input.activeFloorId && r.floorId !== input.activeFloorId) return false;
    }
    return true;
  });
}

export function computeVisibleRackNodes(
  visibleNodes: DiagramNode[],
  assets: Record<string, DeviceAsset>,
  hiddenLayers?: ReadonlyArray<string>
): DiagramNode[] {
  if (hiddenLayers?.includes('racks')) return [];
  return visibleNodes.filter(n => isRackLikeNode(n, assets));
}

export function computeVisibleDeviceNodes(
  visibleNodes: DiagramNode[],
  assets: Record<string, DeviceAsset>,
  hiddenLayers?: ReadonlyArray<string>
): DiagramNode[] {
  return visibleNodes.filter(n => {
    if (isRackLikeNode(n, assets)) return false;
    return !hiddenLayers?.includes(resolveNodeLayer(n, assets));
  });
}

export function resolveRackForNode(
  rackNode: DiagramNode,
  assets: Record<string, DeviceAsset>,
  racks: ServerRack[]
): ServerRack | undefined {
  const asset = rackNode.assetId ? assets[rackNode.assetId] : undefined;
  return racks.find(
    r => r.id === rackNode.customData?.rackId || r.id === rackNode.id || (asset && r.id === asset.id) || r.name === rackNode.label
  );
}

/**
 * ROUTABLE geometry of a node (direct node, or the slot inside its rack for rack-mounted devices).
 * Independent of layer visibility on purpose – see the visibility contract above.
 * `visibleRackNodes` is deprecated and ignored: racks are looked up among `visibleNodes` so that hiding the
 * 'racks' layer cannot make cables to rack-mounted devices vanish while cables to the rack itself stay.
 */
export function createNodeRectResolver(args: {
  nodes: DiagramNode[];
  visibleNodes: DiagramNode[];
  visibleRackNodes?: DiagramNode[];
  assets: Record<string, DeviceAsset>;
  racks: ServerRack[];
}): (nodeId: string) => RectBox | null {
  const { nodes, visibleNodes, assets, racks } = args;
  const nodeMap = new Map(nodes.map(n => [n.id, n] as const));
  const visibleMap = new Map(visibleNodes.map(n => [n.id, n] as const));
  const routableRackNodes = visibleNodes.filter(n => isRackLikeNode(n, assets));
  return (nodeId: string): RectBox | null => {
    const direct = visibleMap.get(nodeId);
    if (direct) return { x: direct.x, y: direct.y, width: direct.width, height: direct.height };
    const anyNode = nodeMap.get(nodeId);
    if (anyNode?.assetId) {
      const asset = assets[anyNode.assetId];
      if (asset?.rackId && asset.rackUnitStart) {
        const rackNode = routableRackNodes.find(rn => resolveRackForNode(rn, assets, racks)?.id === asset.rackId);
        const rack = rackNode ? resolveRackForNode(rackNode, assets, racks) : undefined;
        if (rackNode && rack) {
          const metrics = getRackCanvasMetrics(rackNode, rack.totalUnits || 42);
          const uH = getAssetUHeight(asset);
          const span = getSlotSpanRect(asset.rackUnitStart, uH, metrics.units, metrics.slotH);
          return {
            x: metrics.slotsX + 2,
            y: metrics.slotsY + span.top + 1,
            width: metrics.slotsWidth - 4,
            height: Math.max(8, span.height - 2)
          };
        }
      }
    }
    return null;
  };
}

/** Layer an object is drawn on (racks → 'racks', everything else per layerPolicy). */
export const resolveRenderLayer = (n: DiagramNode, assets: Record<string, DeviceAsset>): string =>
  isRackLikeNode(n, assets) ? 'racks' : resolveNodeLayer(n, assets);

/** RENDERED predicate (see contract). */
export function createNodeRenderedResolver(args: {
  nodes: DiagramNode[];
  visibleNodes: DiagramNode[];
  assets: Record<string, DeviceAsset>;
  racks: ServerRack[];
  hiddenLayers?: ReadonlyArray<string>;
}): (nodeId: string) => boolean {
  const { nodes, visibleNodes, assets, racks, hiddenLayers } = args;
  const nodeMap = new Map(nodes.map(n => [n.id, n] as const));
  const visibleSet = new Set(visibleNodes.map(n => n.id));
  const layerHidden = (n: DiagramNode) => Boolean(hiddenLayers?.includes(resolveRenderLayer(n, assets)));
  const rackNodes = visibleNodes.filter(n => isRackLikeNode(n, assets));
  return (nodeId: string): boolean => {
    const n = nodeMap.get(nodeId);
    if (!n) return false;
    if (visibleSet.has(nodeId)) return !layerHidden(n);
    // rack-mounted device with no direct node in this view: drawn inside its rack, if that rack is drawn
    const asset = n.assetId ? assets[n.assetId] : undefined;
    if (!asset?.rackId || !asset.rackUnitStart || layerHidden(n)) return false;
    const rackNode = rackNodes.find(rn => resolveRackForNode(rn, assets, racks)?.id === asset.rackId);
    return Boolean(rackNode && !layerHidden(rackNode));
  };
}

export function computeVisibleCables(
  cables: CableEdge[],
  getRect: (nodeId: string) => RectBox | null,
  hiddenLayers?: ReadonlyArray<string>
): CableEdge[] {
  if (hiddenLayers?.includes('cables')) return [];
  return cables.filter(c => Boolean(getRect(c.sourceNodeId) && getRect(c.targetNodeId)));
}

/** Convenience: full visibility model in one call (used by non-render consumers). */
export function resolveVisibility(input: VisibilityInput) {
  const visibleNodes = computeVisibleNodes(input);
  const visibleRooms = computeVisibleRooms(input);
  const visibleRackNodes = computeVisibleRackNodes(visibleNodes, input.assets, input.hiddenLayers);
  const visibleDeviceNodes = computeVisibleDeviceNodes(visibleNodes, input.assets, input.hiddenLayers);
  const getRoutableRect = createNodeRectResolver({
    nodes: input.nodes,
    visibleNodes,
    assets: input.assets,
    racks: input.racks
  });
  const isNodeRendered = createNodeRenderedResolver({
    nodes: input.nodes,
    visibleNodes,
    assets: input.assets,
    racks: input.racks,
    hiddenLayers: input.hiddenLayers
  });
  const getSelectableRect = (nodeId: string): RectBox | null => (isNodeRendered(nodeId) ? getRoutableRect(nodeId) : null);
  const visibleCables = computeVisibleCables(input.cables, getRoutableRect, input.hiddenLayers);
  return {
    visibleNodes,
    visibleRooms,
    visibleRackNodes,
    visibleDeviceNodes,
    visibleCables,
    isNodeRendered,
    getRoutableRect,
    getSelectableRect,
    /** @deprecated ambiguous name – equals getRoutableRect. Use the explicit predicate you mean. */
    getNodeEffectiveRect: getRoutableRect
  };
}
