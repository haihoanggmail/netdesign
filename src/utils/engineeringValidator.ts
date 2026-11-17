import { ProjectState } from '../types/infrastructure';
import { getRackStatistics } from './rackGeometry';
import { computeProjectPoeSummary, computeUpsBatteryRuntime } from './poeCalculator';

export type AuditSeverity = 'error' | 'warning' | 'info';

export interface AuditIssue {
  id: string;
  severity: AuditSeverity;
  category: 'ip' | 'port' | 'vlan' | 'rack' | 'power' | 'connectivity';
  title: string;
  description: string;
  targetType: 'node' | 'edge' | 'rack';
  targetId: string;
}

export interface EngineeringSummary {
  totalDevices: number;
  totalCables: number;
  totalPowerWatts: number;
  estimatedCurrentAmps220V: number;
  totalPoeWattsEstimate: number;
  upsCapacityWatts: number;
  estimatedUpsRuntimeMinutes: number;
  errorCount: number;
  warningCount: number;
}

export interface EngineeringAuditReport {
  issues: AuditIssue[];
  summary: EngineeringSummary;
}

export interface IpVlanMatrixRow {
  assetId: string;
  nodeId?: string;
  name: string;
  category: string;
  ipAddress: string;
  subnetMask: string;
  gateway: string;
  vlan: string;
  macAddress: string;
  rackLocation: string;
  duplicateIp: boolean;
}

export interface CidrRange {
  cidr: string;
  networkInt: number;
  broadcastInt: number;
  prefix: number;
}

export function parseIpv4ToInt(ip: string): number | null {
  const parts = String(ip || '').trim().split('.');
  if (parts.length !== 4) return null;
  let acc = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    acc = (acc * 256) + n;
  }
  return acc >>> 0;
}

export function parseCidrRange(cidr: string): CidrRange | null {
  const [ipPart, prefixPart] = String(cidr || '').trim().split('/');
  if (!ipPart || prefixPart === undefined || !/^\d{1,2}$/.test(prefixPart)) return null;
  const prefix = Number(prefixPart);
  if (prefix < 0 || prefix > 32) return null;
  const ipInt = parseIpv4ToInt(ipPart);
  if (ipInt === null) return null;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const networkInt = (ipInt & mask) >>> 0;
  const broadcastInt = (networkInt | (~mask >>> 0)) >>> 0;
  return { cidr: `${ipPart}/${prefix}`, networkInt, broadcastInt, prefix };
}

export function isIpInCidr(ip: string, cidr: string): boolean {
  const ipInt = parseIpv4ToInt(ip);
  const range = parseCidrRange(cidr);
  if (ipInt === null || !range) return false;
  return ipInt >= range.networkInt && ipInt <= range.broadcastInt;
}

export function doCidrsOverlap(cidrA: string, cidrB: string): boolean {
  const a = parseCidrRange(cidrA);
  const b = parseCidrRange(cidrB);
  if (!a || !b) return false;
  return a.networkInt <= b.broadcastInt && b.networkInt <= a.broadcastInt;
}

export interface PatchScheduleRow {
  id: string;
  sourceKind: 'cable' | 'manual_patch';
  cableCode: string;
  patchPanelOrSource: string;
  sourcePort: string;
  targetDevice: string;
  targetPort: string;
  cableType: string;
  bandwidth: string;
  lengthMeters: number;
  vlan: string;
  roomName: string;
  status: string;
  notes: string;
}

/**
 * Runs deterministic engineering validation across the active ProjectState:
 * 1. Duplicate IP addresses
 * 2. Port conflicts (2+ cables claiming same device + non-Auto portId)
 * 3. VLAN mismatch across connected devices/cables
 * 4. Isolated/unconnected network devices
 * 5. Rack U-overflow & weight overload
 * 6. Electrical load, PoE power draw, and UPS capacity check
 * 7. Subnet CIDR validity, overlaps, IP containment & declared VLAN checks
 * 8. L2 switching loop detection across redundant switches without STP/LACP markers
 */
export interface L2SwitchingLoop {
  nodeIds: string[];
  cableIds: string[];
  cycleLabels: string[];
}

export function detectL2SwitchingLoops(project: ProjectState): L2SwitchingLoop[] {
  const nodeMap = new Map(project.nodes.map(n => [n.id, n]));
  const switchIds = new Set<string>();
  for (const n of project.nodes) {
    const cat = n.assetId ? project.assets[n.assetId]?.category : undefined;
    if (cat === 'switch' || cat === 'core_switch') {
      switchIds.add(n.id);
    }
  }
  if (switchIds.size < 3) return [];

  const adj = new Map<string, Array<{ nextId: string; cableId: string }>>();
  switchIds.forEach(id => adj.set(id, []));

  for (const c of project.cables) {
    if (c.cableType === 'POWER_AC') continue;
    if (!switchIds.has(c.sourceNodeId) || !switchIds.has(c.targetNodeId)) continue;
    if (c.sourceNodeId === c.targetNodeId) continue;
    const markerText = `${c.cableCode || ''} ${c.label || ''} ${c.notes || ''}`.toUpperCase();
    if (/\b(STP|RSTP|MSTP|LACP|LAG|ISL|MLAG|STACK)\b/.test(markerText)) continue;
    adj.get(c.sourceNodeId)?.push({ nextId: c.targetNodeId, cableId: c.id });
    adj.get(c.targetNodeId)?.push({ nextId: c.sourceNodeId, cableId: c.id });
  }

  const visited = new Set<string>();
  const loops: L2SwitchingLoop[] = [];
  const seenSignatures = new Set<string>();

  const dfs = (
    current: string,
    parentId: string | null,
    parentCableId: string | null,
    stack: string[],
    cableStack: string[]
  ) => {
    visited.add(current);
    stack.push(current);
    if (parentCableId) cableStack.push(parentCableId);

    for (const edge of adj.get(current) || []) {
      if (edge.cableId === parentCableId) continue;
      const idxInStack = stack.indexOf(edge.nextId);
      if (idxInStack !== -1) {
        const cycleNodeIds = stack.slice(idxInStack);
        const cycleCableIds = [...cableStack.slice(idxInStack), edge.cableId];
        if (cycleNodeIds.length >= 3) {
          const sig = [...cycleNodeIds].sort().join('|');
          if (!seenSignatures.has(sig)) {
            seenSignatures.add(sig);
            loops.push({
              nodeIds: cycleNodeIds,
              cableIds: cycleCableIds,
              cycleLabels: cycleNodeIds.map(id => nodeMap.get(id)?.label || id)
            });
          }
        }
      } else if (!visited.has(edge.nextId) && edge.nextId !== parentId) {
        dfs(edge.nextId, current, edge.cableId, stack, cableStack);
      }
    }

    stack.pop();
    if (parentCableId) cableStack.pop();
  };

  for (const swId of switchIds) {
    if (!visited.has(swId)) {
      dfs(swId, null, null, [], []);
    }
  }

  return loops;
}

export function runEngineeringAudit(project: ProjectState): EngineeringAuditReport {
  const issues: AuditIssue[] = [];
  const assets = Object.values(project.assets);

  // 1. Duplicate IP check
  const ipMap = new Map<string, string[]>();
  for (const a of assets) {
    const ip = (a.ipAddress || '').trim();
    if (!ip || ip === '0.0.0.0' || ip.toLowerCase() === 'dhcp') continue;
    const list = ipMap.get(ip) || [];
    list.push(a.id);
    ipMap.set(ip, list);
  }
  for (const [ip, assetIds] of ipMap.entries()) {
    if (assetIds.length > 1) {
      const names = assetIds.map(id => project.assets[id]?.name || id).join(', ');
      const firstNode = project.nodes.find(n => n.assetId === assetIds[0]);
      issues.push({
        id: `dup_ip_${ip}`,
        severity: 'error',
        category: 'ip',
        title: `Trùng địa chỉ IP: ${ip}`,
        description: `${assetIds.length} thiết bị đang dùng chung IP ${ip}: ${names}.`,
        targetType: 'node',
        targetId: firstNode?.id || ''
      });
    }
  }

  // 2. Port conflict check (same node + specific portId used on multiple cables)
  const portUseMap = new Map<string, string[]>();
  for (const c of project.cables) {
    if (c.sourcePortId && c.sourcePortId !== 'Auto') {
      const key = `${c.sourceNodeId}::${c.sourcePortId}`;
      portUseMap.set(key, [...(portUseMap.get(key) || []), c.id]);
    }
    if (c.targetPortId && c.targetPortId !== 'Auto') {
      const key = `${c.targetNodeId}::${c.targetPortId}`;
      portUseMap.set(key, [...(portUseMap.get(key) || []), c.id]);
    }
  }
  for (const [key, cableIds] of portUseMap.entries()) {
    if (cableIds.length > 1) {
      const [nodeId, portId] = key.split('::');
      const nodeLabel = project.nodes.find(n => n.id === nodeId)?.label || nodeId;
      issues.push({
        id: `dup_port_${key}`,
        severity: 'error',
        category: 'port',
        title: `Xung đột cổng ${portId} trên ${nodeLabel}`,
        description: `${cableIds.length} dây cáp đang đấu cùng vào cổng ${portId}.`,
        targetType: 'edge',
        targetId: cableIds[0]
      });
    }
  }

  // 3. VLAN mismatch across cable endpoints
  const nodeMap = new Map(project.nodes.map(n => [n.id, n]));
  for (const c of project.cables) {
    if (c.cableType === 'POWER_AC') continue;
    const srcNode = nodeMap.get(c.sourceNodeId);
    const tgtNode = nodeMap.get(c.targetNodeId);
    const srcAsset = srcNode?.assetId ? project.assets[srcNode.assetId] : undefined;
    const tgtAsset = tgtNode?.assetId ? project.assets[tgtNode.assetId] : undefined;
    if (srcAsset && tgtAsset && srcAsset.vlan && tgtAsset.vlan) {
      const srcVlans = srcAsset.vlan.split(',').map(v => v.trim()).filter(Boolean);
      const tgtVlans = tgtAsset.vlan.split(',').map(v => v.trim()).filter(Boolean);
      const hasOverlap = srcVlans.some(v => tgtVlans.includes(v));
      if (!hasOverlap && srcVlans.length === 1 && tgtVlans.length === 1) {
        issues.push({
          id: `vlan_mismatch_${c.id}`,
          severity: 'warning',
          category: 'vlan',
          title: `Lệch VLAN trên tuyến ${c.cableCode}`,
          description: `${srcAsset.name} (VLAN ${srcAsset.vlan}) nối với ${tgtAsset.name} (VLAN ${tgtAsset.vlan}) không trùng VLAN.`,
          targetType: 'edge',
          targetId: c.id
        });
      }
    }
  }

  // 4. Unconnected device nodes
  const connectedNodeIds = new Set<string>();
  project.cables.forEach(c => {
    connectedNodeIds.add(c.sourceNodeId);
    connectedNodeIds.add(c.targetNodeId);
  });
  for (const node of project.nodes) {
    if (node.type === 'rack' || node.type === 'text' || node.type === 'zone' || node.type === 'legend') continue;
    if (!connectedNodeIds.has(node.id)) {
      issues.push({
        id: `unconnected_${node.id}`,
        severity: 'warning',
        category: 'connectivity',
        title: `Thiết bị chưa đấu cáp: ${node.label}`,
        description: `Nút ${node.label} chưa có kết nối cáp nào trên sơ đồ.`,
        targetType: 'node',
        targetId: node.id
      });
    }
  }

  // 5. Rack structural checks (overflow U & overweight)
  for (const rack of project.racks) {
    const stats = getRackStatistics(rack, project.assets);
    if (stats.overflowItems.length > 0) {
      issues.push({
        id: `rack_overflow_${rack.id}`,
        severity: 'error',
        category: 'rack',
        title: `Vượt chiều cao U tại ${rack.name}`,
        description: `${stats.overflowItems.length} thiết bị vượt quá giới hạn ${rack.totalUnits}U của tủ.`,
        targetType: 'rack',
        targetId: rack.id
      });
    }
    if (stats.isOverweight) {
      issues.push({
        id: `rack_weight_${rack.id}`,
        severity: 'error',
        category: 'rack',
        title: `Quá tải trọng tại ${rack.name}`,
        description: `Tổng tải ${stats.totalWeightKg.toFixed(1)} kg vượt giới hạn ${stats.maxLoadKg} kg.`,
        targetType: 'rack',
        targetId: rack.id
      });
    }
  }

  // 6. Electrical, PoE & UPS Capacity Calculation
  let totalPowerWatts = 0;
  let upsCapacityWatts = 0;
  let totalUsableUpsWh = 0;

  for (const a of assets) {
    const w = typeof a.powerWatts === 'number' && Number.isFinite(a.powerWatts) ? Math.max(0, a.powerWatts) : 0;
    if (a.category === 'ups') {
      const firstNode = project.nodes.find(n => n.assetId === a.id);
      if (w > 0) {
        upsCapacityWatts += w;
      } else {
        issues.push({
          id: `ups_missing_capacity_${a.id}`,
          severity: 'warning',
          category: 'power',
          title: `UPS chưa khai báo công suất định mức: ${a.name}`,
          description: `UPS "${a.name}" đang có công suất 0W nên không được tính vào khả năng cấp tải dự phòng.`,
          targetType: 'node',
          targetId: firstNode?.id || ''
        });
      }

      const upsSpecs = a.upsSpecs;
      if (upsSpecs && upsSpecs.batteryAh > 0 && upsSpecs.batteryVoltageV > 0 && upsSpecs.batteryCount > 0) {
        const batteryRes = computeUpsBatteryRuntime({
          totalLoadWatts: 1,
          batteryAh: upsSpecs.batteryAh,
          batteryVoltageV: upsSpecs.batteryVoltageV,
          batteryCount: upsSpecs.batteryCount,
          inverterEfficiency: upsSpecs.inverterEfficiency,
          dodFactor: upsSpecs.dodFactor
        });
        totalUsableUpsWh += batteryRes.usableEnergyWh;
      } else {
        issues.push({
          id: `ups_missing_battery_specs_${a.id}`,
          severity: 'warning',
          category: 'power',
          title: `UPS chưa khai báo thông số ắc quy: ${a.name}`,
          description: `Cần nhập dung lượng (Ah), điện áp (V) và số bình ắc quy cho UPS "${a.name}" để tính chính xác thời gian lưu điện.`,
          targetType: 'node',
          targetId: firstNode?.id || ''
        });
      }
    } else {
      totalPowerWatts += w;
    }
  }

  const poeSummary = computeProjectPoeSummary(project);
  const totalPoeWattsEstimate = poeSummary.totalPoeWatts;

  if (poeSummary.status === 'overload') {
    const primaryPse = poeSummary.pseDevices[0];
    issues.push({
      id: 'poe_budget_overload',
      severity: 'error',
      category: 'power',
      title: 'Quá tải ngân sách nguồn PoE',
      description: `Tổng tiêu thụ PoE (${poeSummary.totalPoeWatts}W từ ${poeSummary.poweredDeviceCount} thiết bị) vượt ngân sách PSE khả dụng (${poeSummary.totalPoeBudgetWatts}W).`,
      targetType: 'node',
      targetId: primaryPse?.nodeId || ''
    });
  } else if (poeSummary.status === 'no_pse') {
    issues.push({
      id: 'poe_missing_pse',
      severity: 'warning',
      category: 'power',
      title: 'Chưa có thiết bị cấp nguồn PoE (Switch/NVR)',
      description: `Dự án có ${poeSummary.poweredDeviceCount} thiết bị dùng nguồn PoE (${poeSummary.totalPoeWatts}W) nhưng chưa khai báo Switch PoE hoặc NVR PoE.`,
      targetType: 'node',
      targetId: poeSummary.devices[0]?.nodeId || ''
    });
  }

  if (upsCapacityWatts > 0 && totalPowerWatts > upsCapacityWatts * 0.85) {
    issues.push({
      id: 'ups_overload',
      severity: totalPowerWatts > upsCapacityWatts ? 'error' : 'warning',
      category: 'power',
      title: totalPowerWatts > upsCapacityWatts ? 'Quá tải công suất UPS' : 'Tải UPS vượt ngưỡng an toàn 85%',
      description: `Tổng tải thiết bị ${totalPowerWatts}W so với công suất UPS ${upsCapacityWatts}W.`,
      targetType: 'rack',
      targetId: project.racks[0]?.id || ''
    });
  }

  // 7. Subnet & VLAN Directory Validation
  const subnets = project.subnets || [];
  const vlans = project.vlans || [];
  const validSubnets: Array<{ spec: (typeof subnets)[number]; range: CidrRange }> = [];

  for (const sub of subnets) {
    const parsed = parseCidrRange(sub.cidr);
    if (!parsed) {
      issues.push({
        id: `invalid_cidr_${sub.id}`,
        severity: 'error',
        category: 'ip',
        title: `CIDR không hợp lệ: ${sub.cidr}`,
        description: `Subnet "${sub.name}" có định dạng CIDR không hợp lệ (ví dụ đúng: 10.10.20.0/24).`,
        targetType: 'node',
        targetId: ''
      });
    } else {
      validSubnets.push({ spec: sub, range: parsed });
    }
  }

  for (let i = 0; i < validSubnets.length; i++) {
    for (let j = i + 1; j < validSubnets.length; j++) {
      if (doCidrsOverlap(validSubnets[i].spec.cidr, validSubnets[j].spec.cidr)) {
        issues.push({
          id: `overlap_cidr_${validSubnets[i].spec.id}_${validSubnets[j].spec.id}`,
          severity: 'error',
          category: 'ip',
          title: `Chồng dải Subnet: ${validSubnets[i].spec.cidr} ↔ ${validSubnets[j].spec.cidr}`,
          description: `Hai Subnet "${validSubnets[i].spec.name}" và "${validSubnets[j].spec.name}" có dải địa chỉ IP trùng lặp.`,
          targetType: 'node',
          targetId: ''
        });
      }
    }
  }

  if (validSubnets.length > 0) {
    for (const a of assets) {
      const ip = (a.ipAddress || '').trim();
      if (!ip || ip === '0.0.0.0' || ip.toLowerCase() === 'dhcp' || parseIpv4ToInt(ip) === null) continue;
      const matchingSubnet = validSubnets.find(s => isIpInCidr(ip, s.spec.cidr));
      const firstNode = project.nodes.find(n => n.assetId === a.id);
      if (!matchingSubnet) {
        issues.push({
          id: `ip_outside_subnet_${a.id}`,
          severity: 'warning',
          category: 'ip',
          title: `IP ngoài danh bạ Subnet: ${a.name} (${ip})`,
          description: `Thiết bị ${a.name} có IP ${ip} không thuộc bất kỳ dải CIDR nào đã khai báo trong Danh bạ Subnet.`,
          targetType: 'node',
          targetId: firstNode?.id || ''
        });
      } else if (matchingSubnet.spec.vlanId !== undefined && a.vlan) {
        const assetVlanNums = a.vlan
          .split(',')
          .map(v => Number(v.trim()))
          .filter(n => Number.isFinite(n) && n > 0);
        if (assetVlanNums.length === 1 && assetVlanNums[0] !== matchingSubnet.spec.vlanId) {
          issues.push({
            id: `ip_vlan_subnet_mismatch_${a.id}`,
            severity: 'error',
            category: 'vlan',
            title: `Lệch Subnet–VLAN: ${a.name}`,
            description: `IP ${ip} thuộc Subnet "${matchingSubnet.spec.name}" (VLAN ${matchingSubnet.spec.vlanId}) nhưng thiết bị gán VLAN ${assetVlanNums[0]}.`,
            targetType: 'node',
            targetId: firstNode?.id || ''
          });
        }
      }
    }
  }

  if (vlans.length > 0) {
    const declaredVlanSet = new Set(vlans.map(v => String(v.vlanId)));
    for (const a of assets) {
      const rawVlans = (a.vlan || '').split(',').map(v => v.trim()).filter(Boolean);
      const undeclared = rawVlans.filter(v => /^\d+$/.test(v) && !declaredVlanSet.has(v));
      if (undeclared.length > 0) {
        const firstNode = project.nodes.find(n => n.assetId === a.id);
        issues.push({
          id: `undeclared_vlan_${a.id}`,
          severity: 'warning',
          category: 'vlan',
          title: `VLAN chưa khai báo: VLAN ${undeclared.join(', ')} (${a.name})`,
          description: `Thiết bị ${a.name} sử dụng VLAN ${undeclared.join(', ')} chưa có trong Danh bạ VLAN của dự án.`,
          targetType: 'node',
          targetId: firstNode?.id || ''
        });
      }
    }
  }

  // 8. L2 Switching Loop Detection (ignores STP/RSTP/LACP/ISL tagged uplinks)
  const l2Loops = detectL2SwitchingLoops(project);
  for (const loop of l2Loops) {
    issues.push({
      id: `l2_loop_${loop.nodeIds.join('_')}`,
      severity: 'warning',
      category: 'connectivity',
      title: `Nguy cơ vòng lặp L2: ${loop.cycleLabels.join(' ↔ ')}`,
      description: `Phát hiện mạch vòng giữa ${loop.nodeIds.length} Switch chưa đánh dấu RSTP/LACP/ISL. Nên bật RSTP hoặc gộp Link Aggregation.`,
      targetType: 'node',
      targetId: loop.nodeIds[0] || ''
    });
  }

  const estimatedCurrentAmps220V = Number((totalPowerWatts / (220 * 0.85)).toFixed(1));
  const estimatedUpsRuntimeMinutes =
    totalUsableUpsWh > 0 && totalPowerWatts > 0
      ? Math.max(1, Math.round((totalUsableUpsWh / totalPowerWatts) * 60))
      : 0;

  return {
    issues,
    summary: {
      totalDevices: assets.length,
      totalCables: project.cables.length,
      totalPowerWatts,
      estimatedCurrentAmps220V,
      totalPoeWattsEstimate,
      upsCapacityWatts,
      estimatedUpsRuntimeMinutes,
      errorCount: issues.filter(i => i.severity === 'error').length,
      warningCount: issues.filter(i => i.severity === 'warning').length
    }
  };
}

/**
 * Generates a sorted IP/VLAN plan matrix from all project assets.
 */
export function buildIpVlanMatrix(project: ProjectState): IpVlanMatrixRow[] {
  const assets = Object.values(project.assets);
  const ipCounts = new Map<string, number>();
  assets.forEach(a => {
    const ip = (a.ipAddress || '').trim();
    if (ip) ipCounts.set(ip, (ipCounts.get(ip) || 0) + 1);
  });

  return assets
    .map(a => {
      const node = project.nodes.find(n => n.assetId === a.id);
      const rack = project.racks.find(r => r.id === a.rackId);
      return {
        assetId: a.id,
        nodeId: node?.id,
        name: a.name,
        category: a.category,
        ipAddress: a.ipAddress || '—',
        subnetMask: a.subnetMask || '—',
        gateway: a.gateway || '—',
        vlan: a.vlan || '—',
        macAddress: a.macAddress || '—',
        rackLocation: rack && a.rackUnitStart ? `${rack.name} · U${a.rackUnitStart}` : '—',
        duplicateIp: Boolean(a.ipAddress && (ipCounts.get(a.ipAddress.trim()) || 0) > 1)
      };
    })
    .sort((a, b) => a.ipAddress.localeCompare(b.ipAddress, undefined, { numeric: true }));
}

/**
 * Generates unified Patch Panel & Cable Schedule rows from canvas cables + manual PatchLink mappings.
 */
export function buildPatchAndCableSchedule(project: ProjectState): PatchScheduleRow[] {
  const nodeMap = new Map(project.nodes.map(n => [n.id, n]));
  const roomMap = new Map(project.rooms.map(r => [r.id, r]));

  const cableRows: PatchScheduleRow[] = project.cables.map(c => {
    const srcNode = nodeMap.get(c.sourceNodeId);
    const tgtNode = nodeMap.get(c.targetNodeId);
    const srcAsset = srcNode?.assetId ? project.assets[srcNode.assetId] : undefined;
    const tgtAsset = tgtNode?.assetId ? project.assets[tgtNode.assetId] : undefined;
    const room = tgtAsset?.roomId ? roomMap.get(tgtAsset.roomId) : srcAsset?.roomId ? roomMap.get(srcAsset.roomId) : undefined;

    return {
      id: c.id,
      sourceKind: 'cable',
      cableCode: c.cableCode,
      patchPanelOrSource: srcAsset?.name || srcNode?.label || c.sourceNodeId,
      sourcePort: c.sourcePortId || 'Auto',
      targetDevice: tgtAsset?.name || tgtNode?.label || c.targetNodeId,
      targetPort: c.targetPortId || 'Auto',
      cableType: c.cableType,
      bandwidth: c.bandwidth,
      lengthMeters: c.lengthMeters || 0,
      vlan: c.vlan || tgtAsset?.vlan || srcAsset?.vlan || '—',
      roomName: room?.name || '—',
      status: c.status,
      notes: c.notes || c.label || ''
    };
  });

  const patchRows: PatchScheduleRow[] = (project.patchLinks || []).map(p => {
    const panelAsset = project.assets[p.patchPanelAssetId];
    return {
      id: p.id,
      sourceKind: 'manual_patch',
      cableCode: p.cableCode || 'PATCH',
      patchPanelOrSource: panelAsset?.name || p.patchPanelAssetId,
      sourcePort: p.patchPort,
      targetDevice: p.targetDeviceName,
      targetPort: p.targetPort || 'Wall-Jack',
      cableType: 'CAT6A_STP',
      bandwidth: '1G',
      lengthMeters: 0,
      vlan: p.vlan || panelAsset?.vlan || '—',
      roomName: p.roomName || '—',
      status: 'active',
      notes: p.notes || ''
    };
  });

  return [...cableRows, ...patchRows].sort((a, b) =>
    a.cableCode.localeCompare(b.cableCode, undefined, { numeric: true })
  );
}

function escapeCsvCell(val: string | number): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function formatScheduleCsv(rows: PatchScheduleRow[]): string {
  const header = [
    'Ma Cap',
    'Nguon / Patch Panel',
    'Cong Nguon',
    'Thiet Bi Dich',
    'Cong Dich',
    'Loai Cap',
    'Bang Thong',
    'Chieu Dai (m)',
    'VLAN',
    'Phong / Khu Vuc',
    'Trang Thai',
    'Ghi Chu'
  ].join(',');
  const lines = rows.map(r =>
    [
      r.cableCode,
      r.patchPanelOrSource,
      r.sourcePort,
      r.targetDevice,
      r.targetPort,
      r.cableType,
      r.bandwidth,
      r.lengthMeters,
      r.vlan,
      r.roomName,
      r.status,
      r.notes
    ]
      .map(escapeCsvCell)
      .join(',')
  );
  return [header, ...lines].join('\n');
}

export interface BulkStaticIpCsvResult {
  updatedAssets: Record<string, ProjectState['assets'][string]>;
  updatedCount: number;
  skippedCount: number;
  errors: string[];
}

/**
 * E3: Parses bulk static IP CSV lines (`target,ipAddress,subnetMask,gateway,vlan`) and updates matching project assets.
 * `target` matches asset name, assetTag, or existing ipAddress (case-insensitive).
 */
export function parseAndApplyBulkStaticIpsCsv(
  csvText: string,
  project: ProjectState
): BulkStaticIpCsvResult {
  const nextAssets: Record<string, ProjectState['assets'][string]> = { ...project.assets };
  const lines = String(csvText || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { updatedAssets: nextAssets, updatedCount: 0, skippedCount: 0, errors: ['Nội dung CSV trống.'] };
  }

  const errors: string[] = [];
  let updatedCount = 0;
  let skippedCount = 0;

  const assetList = Object.values(nextAssets);
  const startIdx = /^(name|ten|thiet|device|asset|target)/i.test(lines[0]) ? 1 : 0;

  for (let i = startIdx; i < lines.length; i++) {
    const cols = lines[i].split(/[,\t;]/).map(c => c.trim().replace(/^"|"$/g, ''));
    const [targetKey, newIp, mask, gateway, vlan] = cols;
    if (!targetKey || !newIp) {
      skippedCount++;
      continue;
    }
    if (parseIpv4ToInt(newIp) === null) {
      errors.push(`Dòng ${i + 1}: IP "${newIp}" không hợp lệ.`);
      skippedCount++;
      continue;
    }

    const needle = targetKey.toLowerCase();
    const matched = assetList.find(
      a =>
        a.name.toLowerCase() === needle ||
        a.assetTag.toLowerCase() === needle ||
        (a.ipAddress || '').toLowerCase() === needle
    );

    if (!matched) {
      errors.push(`Dòng ${i + 1}: Không tìm thấy thiết bị "${targetKey}".`);
      skippedCount++;
      continue;
    }

    nextAssets[matched.id] = {
      ...nextAssets[matched.id],
      ipAddress: newIp,
      ...(mask ? { subnetMask: mask } : {}),
      ...(gateway ? { gateway } : {}),
      ...(vlan ? { vlan } : {})
    };
    updatedCount++;
  }

  return {
    updatedAssets: nextAssets,
    updatedCount,
    skippedCount,
    errors
  };
}

export type WallMaterialType = 'concrete' | 'brick' | 'drywall' | 'glass' | 'wood';

export const WALL_ATTENUATION_DB: Record<WallMaterialType, number> = {
  concrete: 12,
  brick: 8,
  drywall: 3,
  glass: 2,
  wood: 4
};

export interface WallSegment2D {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  material: WallMaterialType;
  opaque?: boolean;
}

function segmentsIntersect2D(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number
): boolean {
  const ccw = (p1x: number, p1y: number, p2x: number, p2y: number, p3x: number, p3y: number) =>
    (p3y - p1y) * (p2x - p1x) > (p2y - p1y) * (p3x - p1x);
  return (
    ccw(ax, ay, cx, cy, dx, dy) !== ccw(bx, by, cx, cy, dx, dy) &&
    ccw(ax, ay, bx, by, cx, cy) !== ccw(ax, ay, bx, by, dx, dy)
  );
}

/**
 * E6: Collects architectural wall segments from rooms & explicit `wall` nodes on a floor.
 */
export function collectFloorWallSegments(project: ProjectState, floorId?: string): WallSegment2D[] {
  const segments: WallSegment2D[] = [];
  for (const room of project.rooms) {
    if (floorId && room.floorId !== floorId) continue;
    const mat: WallMaterialType = room.type === 'server_room' ? 'concrete' : 'brick';
    const x1 = room.x;
    const y1 = room.y;
    const x2 = room.x + room.width;
    const y2 = room.y + room.height;
    segments.push(
      { x1, y1, x2, y2: y1, material: mat, opaque: true },
      { x1: x2, y1, x2, y2, material: mat, opaque: true },
      { x1: x2, y1: y2, x2: x1, y2, material: mat, opaque: true },
      { x1, y1: y2, x2: x1, y2: y1, material: mat, opaque: true }
    );
  }
  for (const n of project.nodes) {
    if (n.type !== 'wall') continue;
    if (floorId && n.floorId && n.floorId !== floorId) continue;
    const mat = ((n.customData?.wallMaterial as string) || 'concrete') as WallMaterialType;
    const resolvedMat: WallMaterialType = mat in WALL_ATTENUATION_DB ? mat : 'concrete';
    const isHoriz = n.width >= n.height;
    segments.push({
      x1: isHoriz ? n.x : n.x + n.width / 2,
      y1: isHoriz ? n.y + n.height / 2 : n.y,
      x2: isHoriz ? n.x + n.width : n.x + n.width / 2,
      y2: isHoriz ? n.y + n.height / 2 : n.y + n.height,
      material: resolvedMat,
      opaque: resolvedMat !== 'glass'
    });
  }
  return segments;
}

/**
 * E6: Evaluates wall crossings between two points for Wi-Fi attenuation (dB) and CCTV line-of-sight occlusion.
 */
export function computeSegmentWallCrossings(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  wallSegments: WallSegment2D[]
): {
  crossingCount: number;
  totalAttenuationDb: number;
  blockedLineOfSight: boolean;
} {
  let crossingCount = 0;
  let totalAttenuationDb = 0;
  let blockedLineOfSight = false;

  for (const wall of wallSegments) {
    if (segmentsIntersect2D(p1.x, p1.y, p2.x, p2.y, wall.x1, wall.y1, wall.x2, wall.y2)) {
      crossingCount++;
      totalAttenuationDb += WALL_ATTENUATION_DB[wall.material] ?? 8;
      if (wall.opaque !== false) {
        blockedLineOfSight = true;
      }
    }
  }

  return { crossingCount, totalAttenuationDb, blockedLineOfSight };
}

/**
 * E6: Estimates received Wi-Fi RSSI (dBm) at a target point accounting for free-space path loss + wall attenuation.
 */
export function estimateWifiRssiDbm(
  apCenter: { x: number; y: number },
  targetPoint: { x: number; y: number },
  txPowerDbm: number,
  pxPerMeter: number,
  wallSegments: WallSegment2D[]
): {
  distanceMeters: number;
  wallCrossings: number;
  wallLossDb: number;
  estimatedRssiDbm: number;
  signalQuality: 'excellent' | 'good' | 'fair' | 'weak';
} {
  const distPx = Math.hypot(targetPoint.x - apCenter.x, targetPoint.y - apCenter.y);
  const distanceMeters = Math.max(1, Math.round((distPx / Math.max(5, pxPerMeter)) * 10) / 10);
  // Simplified indoor 5GHz path loss model: FSPL(1m) ~ 47 dB + 22 * log10(d)
  const pathLossDb = 47 + 22 * Math.log10(distanceMeters);
  const wallInfo = computeSegmentWallCrossings(apCenter, targetPoint, wallSegments);
  const estimatedRssiDbm = Math.round((txPowerDbm - pathLossDb - wallInfo.totalAttenuationDb) * 10) / 10;

  const signalQuality: 'excellent' | 'good' | 'fair' | 'weak' =
    estimatedRssiDbm >= -55
      ? 'excellent'
      : estimatedRssiDbm >= -67
      ? 'good'
      : estimatedRssiDbm >= -78
      ? 'fair'
      : 'weak';

  return {
    distanceMeters,
    wallCrossings: wallInfo.crossingCount,
    wallLossDb: wallInfo.totalAttenuationDb,
    estimatedRssiDbm,
    signalQuality
  };
}

