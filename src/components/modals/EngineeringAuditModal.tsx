import React, { useMemo, useRef, useState } from 'react';
import { ProjectState } from '../../types/infrastructure';
import { runEngineeringAudit, buildIpVlanMatrix, AuditIssue } from '../../utils/engineeringValidator';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { X, AlertCircle, AlertTriangle, CheckCircle2, ArrowRight, Network, Zap } from 'lucide-react';

interface EngineeringAuditModalProps {
  isOpen: boolean;
  project: ProjectState;
  onClose: () => void;
  onNavigateToTarget: (targetType: AuditIssue['targetType'], targetId: string) => void;
}

export const EngineeringAuditModal: React.FC<EngineeringAuditModalProps> = ({
  isOpen,
  project,
  onClose,
  onNavigateToTarget
}) => {
  const [tab, setTab] = useState<'audit' | 'ipplan'>('audit');
  const [searchIp, setSearchIp] = useState('');
  const [severityFilter, setSeverityFilter] = useState<'all' | 'error' | 'warning'>('all');
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, isOpen, onClose);

  const report = useMemo(() => runEngineeringAudit(project), [project]);
  const ipMatrix = useMemo(() => buildIpVlanMatrix(project), [project]);

  const filteredIpRows = useMemo(() => {
    const q = searchIp.trim().toLowerCase();
    if (!q) return ipMatrix;
    return ipMatrix.filter(r =>
      `${r.name} ${r.ipAddress} ${r.vlan} ${r.rackLocation}`.toLowerCase().includes(q)
    );
  }, [ipMatrix, searchIp]);

  // Chỉ thay đổi cách HIỂN THỊ: lỗi nghiêm trọng lên trước (giữ nguyên thứ tự gốc trong từng nhóm), có bộ lọc mức độ.
  const visibleIssues = useMemo(() => {
    const errors = report.issues.filter(i => i.severity === 'error');
    const others = report.issues.filter(i => i.severity !== 'error');
    if (severityFilter === 'error') return errors;
    if (severityFilter === 'warning') return others;
    return [...errors, ...others];
  }, [report.issues, severityFilter]);

  if (!isOpen) return null;

  return (
    <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 no-print" role="dialog" aria-modal="true" aria-label="Kiểm Tra Kỹ Thuật & Quy Hoạch IP/VLAN">
      <div className="w-full h-dvh sm:h-auto sm:max-w-5xl sm:max-h-[92dvh] flex flex-col bg-white dark:bg-slate-900 rounded-none sm:rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden text-slate-800 dark:text-slate-100 text-xs pb-safe">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Zap className="w-5 h-5 text-blue-600 shrink-0" />
              <span className="truncate">Kiểm Tra Kỹ Thuật &amp; Bảng Quy Hoạch IP/VLAN</span>
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              Phát hiện trùng IP, xung đột cổng, lệch VLAN, quá tải tủ Rack, ngân sách nguồn PoE/UPS
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Đóng bảng kiểm tra kỹ thuật"
            className="touch-target p-1.5 rounded-md text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Summary KPI Bar */}
        <div className="px-6 py-3 grid grid-cols-2 sm:grid-cols-5 gap-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div title="Lỗi cần sửa trước khi bàn giao: trùng IP, xung đột cổng, quá tải…">
            <div className="text-[10px] text-slate-500 uppercase font-semibold">Lỗi nghiêm trọng</div>
            <div className={`text-lg font-bold font-mono tabular-nums ${report.summary.errorCount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
              {report.summary.errorCount}
            </div>
          </div>
          <div title="Điểm cần lưu ý, chưa chắc là lỗi">
            <div className="text-[10px] text-slate-500 uppercase font-semibold">Cảnh báo</div>
            <div className={`text-lg font-bold font-mono tabular-nums ${report.summary.warningCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-200'}`}>
              {report.summary.warningCount}
            </div>
          </div>
          <div title="Tổng công suất tiêu thụ khai báo của các thiết bị; dòng điện quy đổi ở 220V">
            <div className="text-[10px] text-slate-500 uppercase font-semibold">Tổng công suất</div>
            <div className="text-lg font-bold font-mono tabular-nums text-blue-600 dark:text-blue-400">
              {report.summary.totalPowerWatts} W
            </div>
            <div className="text-[10px] text-slate-400 font-mono">~{report.summary.estimatedCurrentAmps220V} A (220V)</div>
          </div>
          <div title="Ước tính tổng công suất cấp qua PoE cho các thiết bị đầu cuối">
            <div className="text-[10px] text-slate-500 uppercase font-semibold">Ước tính PoE</div>
            <div className="text-lg font-bold font-mono tabular-nums text-slate-800 dark:text-slate-100">
              {report.summary.totalPoeWattsEstimate} W
            </div>
          </div>
          <div title="Thời gian chạy dự phòng ước tính của UPS theo công suất và pin đã khai báo">
            <div className="text-[10px] text-slate-500 uppercase font-semibold">Dự phòng UPS</div>
            <div className="text-lg font-bold font-mono tabular-nums text-slate-800 dark:text-slate-100">
              {report.summary.upsCapacityWatts <= 0
                ? 'Chưa có UPS'
                : report.summary.estimatedUpsRuntimeMinutes > 0
                ? `${report.summary.estimatedUpsRuntimeMinutes} phút`
                : 'Chưa khai báo pin'}
            </div>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="px-6 py-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50/70 dark:bg-slate-800/30">
          <div role="tablist" aria-label="Nội dung kiểm tra" className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-lg">
            <button
              role="tab"
              aria-selected={tab === 'audit'}
              onClick={() => setTab('audit')}
              className={`px-3 py-1 rounded-md font-semibold ${
                tab === 'audit' ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs' : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Kết quả Kiểm tra ({report.issues.length})
            </button>
            <button
              role="tab"
              aria-selected={tab === 'ipplan'}
              onClick={() => setTab('ipplan')}
              className={`px-3 py-1 rounded-md font-semibold flex items-center gap-1.5 ${
                tab === 'ipplan' ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs' : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <Network className="w-3.5 h-3.5" />
              <span>Bảng IP &amp; VLAN ({ipMatrix.length})</span>
            </button>
          </div>

          {tab === 'audit' && report.issues.length > 0 && (
            <div role="group" aria-label="Lọc theo mức độ" className="flex items-center gap-1">
              {(
                [
                  { id: 'all', label: 'Tất cả', count: report.issues.length },
                  { id: 'error', label: 'Lỗi', count: report.summary.errorCount },
                  { id: 'warning', label: 'Cảnh báo', count: report.issues.length - report.issues.filter(i => i.severity === 'error').length }
                ] as const
              ).map(chip => (
                <button
                  key={chip.id}
                  type="button"
                  aria-pressed={severityFilter === chip.id}
                  onClick={() => setSeverityFilter(chip.id)}
                  className={`h-7 px-2.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                    severityFilter === chip.id
                      ? 'bg-[#155EEF] text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800'
                  }`}
                >
                  {chip.label} <span className="font-mono tabular-nums">({chip.count})</span>
                </button>
              ))}
            </div>
          )}

          {tab === 'ipplan' && (
            <input
              type="text"
              value={searchIp}
              onChange={e => setSearchIp(e.target.value)}
              placeholder="Lọc theo tên, IP, VLAN..."
              aria-label="Lọc bảng IP và VLAN"
              className="ent-input w-full sm:w-64"
            />
          )}
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1">
          {tab === 'audit' ? (
            report.issues.length === 0 ? (
              <div className="py-12 text-center space-y-2">
                <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
                <div className="text-sm font-bold text-slate-900 dark:text-white">
                  Không phát hiện lỗi kỹ thuật hay xung đột cấu hình!
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Mọi địa chỉ IP, cổng kết nối, VLAN, tủ Rack và tải điện đều đạt kiểm tra tự động.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {visibleIssues.length === 0 && (
                  <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                    Không có mục nào ở mức độ đã chọn.
                  </div>
                )}
                {visibleIssues.map(issue => (
                  <div
                    key={issue.id}
                    className={`p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 border-l-4 bg-white dark:bg-slate-900 flex items-center justify-between gap-4 hover:border-blue-400 transition-colors ${
                      issue.severity === 'error' ? 'border-l-rose-500' : 'border-l-amber-400'
                    }`}
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      {issue.severity === 'error' ? (
                        <AlertCircle aria-hidden="true" className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle aria-hidden="true" className="w-5 h-5 text-amber-500 dark:text-amber-400 shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-1.5 flex-wrap">
                          <span
                            className={`ent-badge ${issue.severity === 'error' ? 'ent-badge-danger' : 'ent-badge-warning'}`}
                          >
                            {issue.severity === 'error' ? 'Lỗi' : 'Cảnh báo'}
                          </span>
                          <span>{issue.title}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          {issue.description}
                        </div>
                      </div>
                    </div>

                    {issue.targetId && (
                      <button
                        onClick={() => {
                          onNavigateToTarget(issue.targetType, issue.targetId);
                          onClose();
                        }}
                        title="Đóng bảng này và chọn đối tượng tương ứng trên bản vẽ"
                        className="px-3 py-1.5 rounded-md bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 font-semibold flex items-center gap-1 shrink-0 whitespace-nowrap"
                      >
                        <span>Chuyển tới</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )
          ) : (
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto"><table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800 text-[11px] text-slate-600 dark:text-slate-300 sticky top-0">
                    <th scope="col" className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">Thiết bị</th>
                    <th scope="col" className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">Phân loại</th>
                    <th scope="col" className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">Địa chỉ IP</th>
                    <th scope="col" className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">Subnet Mask</th>
                    <th scope="col" className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">Gateway</th>
                    <th scope="col" className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">VLAN</th>
                    <th scope="col" className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">Vị trí Tủ Rack</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-[11px]">
                  {filteredIpRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-slate-400">
                        Không có thiết bị khớp bộ lọc.
                      </td>
                    </tr>
                  ) : (
                    filteredIpRows.map(row => (
                      <tr
                        key={row.assetId}
                        onClick={() => {
                          if (row.nodeId) {
                            onNavigateToTarget('node', row.nodeId);
                            onClose();
                          }
                        }}
                        tabIndex={row.nodeId ? 0 : undefined}
                        onKeyDown={e => {
                          if (row.nodeId && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault();
                            onNavigateToTarget('node', row.nodeId);
                            onClose();
                          }
                        }}
                        title={row.nodeId ? 'Nhấn để chuyển tới thiết bị trên bản vẽ' : undefined}
                        className="hover:bg-blue-50/50 dark:hover:bg-slate-800/40 cursor-pointer focus-visible:bg-blue-50 dark:focus-visible:bg-slate-800"
                      >
                        <td className="px-3 py-2 font-semibold text-slate-900 dark:text-white">{row.name}</td>
                        <td className="px-3 py-2 text-slate-500">{row.category}</td>
                        <td className={`px-3 py-2 font-mono tabular-nums ${row.duplicateIp ? 'text-rose-600 dark:text-rose-400 font-bold' : ''}`}>
                          {row.ipAddress}{row.duplicateIp ? ' (Trùng)' : ''}
                        </td>
                        <td className="px-3 py-2 font-mono tabular-nums">{row.subnetMask}</td>
                        <td className="px-3 py-2 font-mono tabular-nums">{row.gateway}</td>
                        <td className="px-3 py-2 font-mono tabular-nums">{row.vlan}</td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{row.rackLocation}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
