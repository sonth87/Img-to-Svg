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
    <div
      data-apple-lens="bar"
      className="apple-lens-bar border-t px-3 py-2 select-none transition-colors relative z-20"
    >
      <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
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
              className="apple-lens-btn text-[11px] px-2.5 py-0.5 rounded-lg text-indigo-700 dark:text-indigo-300 font-medium cursor-pointer"
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
              className="apple-lens-btn text-[11px] px-2.5 py-0.5 rounded-lg text-slate-700 dark:text-slate-200 cursor-pointer"
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
              className="apple-lens-btn text-[11px] flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-slate-700 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white cursor-pointer"
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
            : 'flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar'
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
              className={`flex items-center gap-1.5 px-2 py-1 rounded-xl transition shrink-0 touch-manipulation ${
                isMergingThis
                  ? 'apple-lens-card !border-amber-500 ring-2 ring-amber-400/40'
                  : isMergeCandidate
                  ? 'apple-lens-card !border-indigo-500 dark:!border-indigo-400 cursor-pointer ring-1 ring-indigo-400/40'
                  : col.visible
                  ? 'apple-lens-card'
                  : 'apple-lens-card opacity-50'
              }`}
            >
              <label
                className="relative w-6 h-6 sm:w-5 sm:h-5 rounded-md border border-white/50 dark:border-white/25 shadow-inner cursor-pointer shrink-0 overflow-hidden touch-manipulation"
                title={`Đổi màu ${col.hex} (${col.percentage.toFixed(1)}%)`}
                onClick={(e) => e.stopPropagation()}
              >
                <span
                  className="block w-full h-full"
                  style={{ backgroundColor: col.hex, opacity: col.a / 255 }}
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
                  <span className="text-[10.5px] font-mono text-slate-800 dark:text-slate-100 font-medium">
                    {col.hex}
                  </span>
                  {col.a < 255 && (
                    <span
                      className="text-[9px] px-1 rounded bg-violet-500/20 text-violet-600 dark:text-violet-300 font-bold"
                      title="Lớp bán trong suốt (giữ nguyên độ đục của ảnh gốc)"
                    >
                      {Math.round((col.a / 255) * 100)}%
                    </span>
                  )}
                  {col.isStrokeLayer ? (
                    <span className="text-[9px] px-1 rounded bg-sky-500/20 text-sky-600 dark:text-sky-300 font-bold">
                      1-LINE
                    </span>
                  ) : (
                    <span className="text-[9.5px] text-slate-500 dark:text-slate-400 font-mono">
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
                  className="apple-lens-btn p-1.5 sm:p-1 rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white cursor-pointer touch-manipulation"
                >
                  {col.visible ? (
                    <Eye className="w-3.5 h-3.5 sm:w-3 sm:h-3 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <EyeOff className="w-3.5 h-3.5 sm:w-3 sm:h-3 text-rose-500 dark:text-rose-400" />
                  )}
                </button>

                {activeClusters.length > 1 && !col.isStrokeLayer && (
                  <button
                    type="button"
                    onClick={() =>
                      setMergeSourceId(isMergingThis ? null : col.id)
                    }
                    title="Gộp lớp màu này vào lớp khác"
                    className={`p-1.5 sm:p-1 rounded-lg transition cursor-pointer touch-manipulation ${
                      isMergingThis
                        ? 'bg-amber-500 text-slate-950 shadow-sm'
                        : 'apple-lens-btn text-slate-600 dark:text-slate-300 hover:text-amber-600 dark:hover:text-amber-300'
                    }`}
                  >
                    <GitMerge className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
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
