import React, { useState } from 'react';
import { Eye, EyeOff, GitMerge, RotateCcw } from 'lucide-react';
import { PaletteColor, PaletteOverride } from '../types/vectorizer';

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
    <div className="bg-white dark:bg-slate-900/95 border-t border-slate-200 dark:border-slate-800 px-4 py-2.5 select-none transition-colors">
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
            Bảng Màu & Lớp Nét Trích Xuất ({activeClusters.length} lớp)
          </span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {mergeSourceId !== null ? (
              <span className="text-amber-600 dark:text-amber-400 font-medium">
                ⚡ Đang chọn gộp màu #{mergeSourceId + 1} — Hãy bấm vào ô màu đích để gộp làm một!
              </span>
            ) : (
              'Bấm biểu tượng Mắt để ẩn/xóa nền, bấm màu để đổi mã HEX, hoặc bấm Gộp để nối 2 nhóm màu.'
            )}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {activeClusters.length > 8 && (
            <button
              type="button"
              onClick={() => setIsGridExpanded((prev) => !prev)}
              className="text-xs px-2.5 py-1 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-300/60 dark:border-indigo-700/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition cursor-pointer"
            >
              {isGridExpanded
                ? 'Thu gọn 1 hàng'
                : `Mở rộng lưới (${activeClusters.length} màu)`}
            </button>
          )}
          {mergeSourceId !== null && (
            <button
              type="button"
              onClick={() => setMergeSourceId(null)}
              className="text-xs px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700"
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
              className="text-xs flex items-center gap-1 px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700 transition"
            >
              <RotateCcw className="w-3 h-3" />
              Khôi phục bảng màu gốc
            </button>
          )}
        </div>
      </div>

      <div
        className={
          isGridExpanded
            ? 'flex items-center gap-2 flex-wrap max-h-48 overflow-y-auto pb-1 pr-1'
            : 'flex items-center gap-2 overflow-x-auto pb-1'
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
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border transition shrink-0 ${
                isMergingThis
                  ? 'border-amber-500 bg-amber-500/10'
                  : isMergeCandidate
                  ? 'border-indigo-500 dark:border-indigo-400/80 bg-indigo-500/10 cursor-pointer hover:bg-indigo-500/20'
                  : col.visible
                  ? 'border-slate-200 dark:border-slate-700/80 bg-slate-50 dark:bg-slate-950/70'
                  : 'border-slate-200/60 dark:border-slate-800/60 bg-slate-100/50 dark:bg-slate-950/30 opacity-50'
              }`}
            >
              {/* Color Picker Swatch */}
              <label
                className="relative w-6 h-6 rounded-md border border-slate-300 dark:border-white/20 shadow-inner cursor-pointer shrink-0 overflow-hidden"
                title="Bấm để đổi màu lớp vector này"
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

              {/* Info */}
              <div className="leading-tight">
                <div className="flex items-center gap-1">
                  <span className="text-[11px] font-mono text-slate-800 dark:text-slate-200 font-medium">
                    {col.hex}
                  </span>
                  {col.isStrokeLayer && (
                    <span className="text-[9px] px-1 py-0.2 rounded bg-sky-500/20 text-sky-600 dark:text-sky-300 font-bold border border-sky-500/30">
                      NÉT ĐƠN
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                  {col.isStrokeLayer
                    ? 'Centerline Stroke'
                    : `${col.percentage.toFixed(1)}% diện tích`}
                </div>
              </div>

              {/* Actions */}
              <div
                className="flex items-center gap-1 ml-1"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => onToggleVisibility(col.id, col.visible)}
                  title={
                    col.visible
                      ? 'Ẩn lớp này'
                      : 'Hiện lại lớp này'
                  }
                  className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition"
                >
                  {col.visible ? (
                    <Eye className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <EyeOff className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400" />
                  )}
                </button>

                {activeClusters.length > 1 && !col.isStrokeLayer && (
                  <button
                    type="button"
                    onClick={() =>
                      setMergeSourceId(isMergingThis ? null : col.id)
                    }
                    title="Gộp nhóm màu này vào một nhóm màu khác"
                    className={`p-1 rounded transition ${
                      isMergingThis
                        ? 'bg-amber-500 text-slate-950'
                        : 'hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-amber-600 dark:hover:text-amber-300'
                    }`}
                  >
                    <GitMerge className="w-3.5 h-3.5" />
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
