import React, { useState } from 'react';
import { Eye, EyeOff, GitMerge, RotateCcw } from 'lucide-react';
import { PaletteColor, PaletteOverride } from '../types/vectorizer';
import { InfoTooltip } from './InfoTooltip';

interface PaletteManagerProps {
  palette: PaletteColor[];
  overrides: Record<number, PaletteOverride>;
  onToggleVisibility: (colorId: number, currentVisible: boolean) => void;
  onChangeCustomColor: (colorId: number, newHex: string) => void;
  onMergeColor: (sourceColorId: number, targetColorId: number) => void;
  onResetOverrides: () => void;
}

export const PaletteManager: React.FC<PaletteManagerProps> = ({
  palette,
  overrides,
  onToggleVisibility,
  onChangeCustomColor,
  onMergeColor,
  onResetOverrides,
}) => {
  const [mergeSourceId, setMergeSourceId] = useState<number | null>(null);
  const [isGridExpanded, setIsGridExpanded] = useState<boolean>(false);

  const hasOverrides = Object.keys(overrides).length > 0;
  const activeClusters = palette.filter((p) => p.pixelCount > 0);

  return (
    <div className="bg-white dark:bg-slate-900/95 border-t border-slate-200 dark:border-slate-800 px-3 py-2 select-none transition-colors">
      <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
            Bảng màu ({activeClusters.length} lớp)
          </span>
          <InfoTooltip
            side="top"
            title="Thao tác với Bảng màu Vector"
            content={
              <ul className="list-disc pl-3.5 space-y-1">
                <li>
                  <strong>Ô màu:</strong> Bấm vào để đổi mã màu HEX.
                </li>
                <li>
                  <strong>Biểu tượng Mắt:</strong> Ẩn hoặc hiện toàn bộ lớp màu
                  đó.
                </li>
                <li>
                  <strong>Biểu tượng Gộp:</strong> Bấm vào 1 màu rồi bấm sang
                  màu đích để hợp nhất 2 lớp màu.
                </li>
              </ul>
            }
          />
          {mergeSourceId !== null && (
            <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium ml-1">
              ⚡ Bấm vào ô màu đích để gộp với #{mergeSourceId + 1}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {activeClusters.length > 8 && (
            <button
              type="button"
              onClick={() => setIsGridExpanded((prev) => !prev)}
              className="text-[11px] px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-300/60 dark:border-indigo-700/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition cursor-pointer"
            >
              {isGridExpanded
                ? 'Thu gọn'
                : `Mở rộng (${activeClusters.length})`}
            </button>
          )}
          {mergeSourceId !== null && (
            <button
              type="button"
              onClick={() => setMergeSourceId(null)}
              className="text-[11px] px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 cursor-pointer"
            >
              Hủy gộp
            </button>
          )}
          {hasOverrides && (
            <button
              type="button"
              onClick={() => {
                setMergeSourceId(null);
                onResetOverrides();
              }}
              className="text-[11px] flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700 transition cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              Mặc định
            </button>
          )}
        </div>
      </div>

      <div
        className={
          isGridExpanded
            ? 'flex items-center gap-1.5 flex-wrap max-h-40 overflow-y-auto pb-1 pr-1'
            : 'flex items-center gap-1.5 overflow-x-auto pb-1'
        }
      >
        {activeClusters.map((col) => {
          const isMergingThis = mergeSourceId === col.id;
          const isMergeCandidate =
            mergeSourceId !== null &&
            mergeSourceId !== col.id &&
            !col.isStrokeLayer;

          return (
            <div
              key={col.id}
              onClick={() => {
                if (isMergeCandidate && mergeSourceId !== null) {
                  onMergeColor(mergeSourceId, col.id);
                  setMergeSourceId(null);
                }
              }}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-md border transition shrink-0 ${
                isMergingThis
                  ? 'border-amber-500 bg-amber-500/10'
                  : isMergeCandidate
                  ? 'border-indigo-500 dark:border-indigo-400/80 bg-indigo-500/10 cursor-pointer hover:bg-indigo-500/20'
                  : col.visible
                  ? 'border-slate-200 dark:border-slate-700/80 bg-slate-50 dark:bg-slate-950/70'
                  : 'border-slate-200/60 dark:border-slate-800/60 bg-slate-100/50 dark:bg-slate-950/30 opacity-50'
              }`}
            >
              <label
                className="relative w-5 h-5 rounded border border-slate-300 dark:border-white/20 shadow-inner cursor-pointer shrink-0 overflow-hidden"
                title={`Đổi màu ${col.hex} (${col.percentage.toFixed(1)}%)`}
                onClick={(e) => e.stopPropagation()}
              >
                <span
                  className="block w-full h-full"
                  style={{ backgroundColor: col.hex }}
                />
                <input
                  type="color"
                  value={col.hex}
                  onChange={(e) => onChangeCustomColor(col.id, e.target.value)}
                  className="sr-only"
                />
              </label>

              <div className="leading-tight">
                <div className="flex items-center gap-1">
                  <span className="text-[10.5px] font-mono text-slate-800 dark:text-slate-200 font-medium">
                    {col.hex}
                  </span>
                  {col.isStrokeLayer ? (
                    <span className="text-[9px] px-1 rounded bg-sky-500/20 text-sky-600 dark:text-sky-300 font-bold">
                      1-LINE
                    </span>
                  ) : (
                    <span className="text-[9.5px] text-slate-400 font-mono">
                      {col.percentage.toFixed(0)}%
                    </span>
                  )}
                </div>
              </div>

              <div
                className="flex items-center gap-0.5"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => onToggleVisibility(col.id, col.visible)}
                  title={col.visible ? 'Ẩn lớp màu này' : 'Hiện lớp màu này'}
                  className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition cursor-pointer"
                >
                  {col.visible ? (
                    <Eye className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <EyeOff className="w-3 h-3 text-rose-500 dark:text-rose-400" />
                  )}
                </button>

                {activeClusters.length > 1 && !col.isStrokeLayer && (
                  <button
                    type="button"
                    onClick={() =>
                      setMergeSourceId(isMergingThis ? null : col.id)
                    }
                    title="Gộp lớp màu này vào lớp khác"
                    className={`p-0.5 rounded transition cursor-pointer ${
                      isMergingThis
                        ? 'bg-amber-500 text-slate-950'
                        : 'hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-amber-600 dark:hover:text-amber-300'
                    }`}
                  >
                    <GitMerge className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
