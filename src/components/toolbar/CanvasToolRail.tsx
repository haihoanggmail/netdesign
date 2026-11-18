import React, { useRef } from 'react';
import {
  MousePointer,
  Hand,
  GitBranch,
  Square,
  Type,
  Table2,
  Ruler,
  type LucideIcon
} from 'lucide-react';
import { DesignMode } from '../../types/infrastructure';
import { CanvasTool } from '../../store/useProjectStore';
import { LayoutTier } from '../../hooks/useWorkspaceLayout';

interface CanvasToolRailProps {
  activeTool: CanvasTool;
  activeMode: DesignMode;
  layoutTier: LayoutTier;
  isReadOnlyMode?: boolean;
  onSetTool: (tool: CanvasTool) => void;
  onGenerateLegend?: () => void;
}

type ToolItem =
  | {
      kind: 'tool';
      id: CanvasTool;
      label: string;
      shortcut: string;
      icon: LucideIcon;
    }
  | {
      kind: 'action';
      id: 'legend';
      label: string;
      shortcut: string;
      icon: LucideIcon;
    };

const CANVAS_TOOLS: ToolItem[] = [
  { kind: 'tool', id: 'select', label: 'Chọn', shortcut: 'V', icon: MousePointer },
  { kind: 'tool', id: 'pan', label: 'Kéo', shortcut: 'H', icon: Hand },
  { kind: 'tool', id: 'connect', label: 'Nối dây', shortcut: 'C', icon: GitBranch },
  { kind: 'tool', id: 'room', label: 'Phòng', shortcut: 'R', icon: Square },
  { kind: 'tool', id: 'text', label: 'Chữ', shortcut: 'T', icon: Type },
  { kind: 'action', id: 'legend', label: 'Chú giải', shortcut: 'L', icon: Table2 },
  { kind: 'tool', id: 'measure', label: 'Đo', shortcut: 'M', icon: Ruler }
];

const RECOMMENDED_BY_MODE: Record<DesignMode, string[]> = {
  topology: ['select', 'connect'],
  multisite: ['select', 'connect'],
  floorplan: ['room', 'measure', 'connect'],
  rack: ['select', 'measure'],
  fiber: ['connect', 'measure'],
  cctv: ['room', 'connect', 'measure'],
  wifi: ['room', 'measure'],
  electrical: ['connect', 'measure']
};

export const CanvasToolRail: React.FC<CanvasToolRailProps> = ({
  activeTool,
  activeMode,
  layoutTier,
  isReadOnlyMode = false,
  onSetTool,
  onGenerateLegend
}) => {
  const railRef = useRef<HTMLElement>(null);

  if (layoutTier === 'narrow') return null;

  // Điều hướng bằng phím mũi tên giữa các công cụ (chỉ thay đổi tiêu điểm bàn phím, không đổi công cụ)
  const handleRailKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(e.key) || !railRef.current) return;
    const buttons: HTMLButtonElement[] = Array.from(
      railRef.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
    );
    if (buttons.length === 0) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next = current;
    if (e.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % buttons.length;
    else if (e.key === 'ArrowUp') next = current <= 0 ? buttons.length - 1 : current - 1;
    else if (e.key === 'Home') next = 0;
    else next = buttons.length - 1;
    e.preventDefault();
    buttons[next]?.focus();
  };

  const isCompactRail = layoutTier === 'medium';
  const recommendedIds = RECOMMENDED_BY_MODE[activeMode] || ['select'];

  return (
    <aside
      ref={railRef}
      role="toolbar"
      aria-orientation="vertical"
      aria-label="Thanh công cụ vẽ"
      onKeyDown={handleRailKeyDown}
      onPointerDown={e => e.stopPropagation()}
      className="tool-rail hidden md:flex flex-col gap-1 absolute top-3 left-3 z-20 p-1.5 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md rounded-xl border border-slate-200 dark:border-slate-800 shadow-md select-none no-print"
    >
      {CANVAS_TOOLS.map((item, index) => {
        const Icon = item.icon;
        const isActive = item.kind === 'tool' && activeTool === item.id;
        const isRecommended = recommendedIds.includes(item.id);
        const disabled =
          isReadOnlyMode &&
          item.id !== 'select' &&
          item.id !== 'pan' &&
          item.id !== 'measure';

        const handleClick = () => {
          if (disabled) return;
          if (item.kind === 'action') {
            onGenerateLegend?.();
          } else {
            onSetTool(item.id);
          }
        };

        // Vạch ngăn nhóm: [Chọn, Kéo] | [Nối dây, Phòng, Chữ, Chú giải] | [Đo]
        const startsGroup = index > 0 && (item.id === 'connect' || item.id === 'measure');

        return (
          <React.Fragment key={item.id}>
          {startsGroup && (
            <span
              role="separator"
              aria-orientation="horizontal"
              className="my-0.5 h-px bg-slate-200 dark:bg-slate-700 mx-1"
            />
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={handleClick}
            aria-pressed={item.kind === 'tool' ? isActive : undefined}
            aria-keyshortcuts={item.shortcut}
            aria-label={`${item.label} (${item.shortcut})`}
            title={`${item.label} (${item.shortcut})${isRecommended ? ' · Phù hợp chế độ hiện tại' : ''}`}
            className={`group relative flex items-center justify-between gap-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed ${
              isCompactRail ? 'w-9 h-9 justify-center px-0' : 'h-8 px-2.5 min-w-[116px]'
            } ${
              isActive
                ? 'bg-[#155EEF] text-white font-semibold'
                : isRecommended
                ? 'text-slate-800 dark:text-slate-100 hover:bg-blue-50 dark:hover:bg-slate-800'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <span className="flex items-center gap-2">
              <Icon
                className={`w-4 h-4 shrink-0 ${
                  isActive
                    ? 'text-white'
                    : isRecommended
                    ? 'text-[#155EEF] dark:text-blue-400'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              />
              {!isCompactRail && <span>{item.label}</span>}
            </span>
            {!isCompactRail && (
              <kbd
                className={`font-mono text-xs ${
                  isActive ? 'text-blue-100' : 'text-slate-400 dark:text-slate-500'
                }`}
              >
                {item.shortcut}
              </kbd>
            )}
            {isCompactRail && (
              <span
                role="presentation"
                className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 z-30 hidden group-hover:flex group-focus-visible:flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-900 text-white dark:bg-slate-700 text-[11px] font-medium shadow-lg whitespace-nowrap"
              >
                {item.label}
                <kbd className="font-mono text-[10px] px-1 rounded bg-white/15">{item.shortcut}</kbd>
              </span>
            )}
          </button>
          </React.Fragment>
        );
      })}
    </aside>
  );
};
