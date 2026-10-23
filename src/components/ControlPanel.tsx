import React, { useRef, useState } from 'react';
import {
  Sliders,
  Sparkles,
  Palette,
  Eraser,
  Layers,
  Spline,
  RotateCcw,
  Upload,
  ClipboardPaste,
  Image as ImageIcon,
  Shapes,
  Camera,
  Mountain,
  Flame,
  Hexagon,
  PenTool,
  Type,
  Scissors,
  Grid,
  Crown,
  Wand2,
} from 'lucide-react';
import { PipelineStats, VectorizerParams } from '../types/vectorizer';
import { PURPOSE_PRESETS, PurposePreset } from '../engine/sampleImages';

interface ControlPanelProps {
  params: VectorizerParams;
  stats: PipelineStats | null;
  isProcessing: boolean;
  currentImageName: string;
  imageDimensions: { width: number; height: number } | null;
  onUploadFile: (file: File) => void;
  onChange: (updater: (prev: VectorizerParams) => VectorizerParams) => void;
  onReset: () => void;
}

function renderPurposeIcon(icon: PurposePreset['icon'], className: string) {
  switch (icon) {
    case 'shapes':
      return <Shapes className={className} />;
    case 'sparkles':
      return <Sparkles className={className} />;
    case 'camera':
      return <Camera className={className} />;
    case 'mountain':
      return <Mountain className={className} />;
    case 'palette':
      return <Palette className={className} />;
    case 'flame':
      return <Flame className={className} />;
    case 'hexagon':
      return <Hexagon className={className} />;
    case 'pen-tool':
      return <PenTool className={className} />;
    case 'type':
      return <Type className={className} />;
    case 'scissors':
      return <Scissors className={className} />;
    case 'grid':
      return <Grid className={className} />;
    case 'crown':
      return <Crown className={className} />;
  }
}

function isExactPresetMatch(a: VectorizerParams, b: VectorizerParams): boolean {
  return (
    a.mode === b.mode &&
    a.singleLineStrokes === b.singleLineStrokes &&
    a.smoothness === b.smoothness &&
    a.colorCount === b.colorCount &&
    a.colorMergeDeltaE === b.colorMergeDeltaE &&
    a.despeckleArea === b.despeckleArea &&
    a.layerMode === b.layerMode &&
    Math.abs(a.simplifyTolerance - b.simplifyTolerance) < 0.05 &&
    a.cornerThreshold === b.cornerThreshold &&
    Math.abs(a.curveSmoothing - b.curveSmoothing) < 0.03
  );
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
  params,
  stats,
  isProcessing,
  currentImageName,
  imageDimensions,
  onUploadFile,
  onChange,
  onReset,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [lastClickedPresetId, setLastClickedPresetId] =
    useState<string>('logo-icon');

  const update = <K extends keyof VectorizerParams>(
    key: K,
    value: VectorizerParams[K]
  ) => {
    onChange((prev) => ({ ...prev, [key]: value }));
  };

  const matchedPreset = PURPOSE_PRESETS.find((p) =>
    isExactPresetMatch(p.params, params)
  );
  const activePreset =
    matchedPreset ??
    PURPOSE_PRESETS.find((p) => p.id === lastClickedPresetId) ??
    PURPOSE_PRESETS[0];

  return (
    <aside className="w-[348px] shrink-0 bg-white dark:bg-slate-900/95 border-r border-slate-200 dark:border-slate-800 flex flex-col h-full select-none transition-colors">
      {/* KHỐI INPUT ẢNH NỔI BẬT Ở ĐẦU SIDEBAR */}
      <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/bmp,image/gif"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUploadFile(file);
            e.target.value = '';
          }}
          className="hidden"
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="w-full py-2.5 px-3 rounded-xl border-2 border-dashed border-indigo-400 dark:border-indigo-500/60 hover:border-indigo-500 dark:hover:border-indigo-400 bg-indigo-50/70 dark:bg-indigo-500/10 hover:bg-indigo-100/70 dark:hover:bg-indigo-500/20 transition flex flex-col items-center justify-center gap-1 group cursor-pointer shadow-inner"
        >
          <div className="w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow group-hover:scale-105 transition">
            <Upload className="w-3.5 h-3.5" />
          </div>
          <div className="text-xs font-bold text-indigo-900 dark:text-indigo-200 group-hover:text-indigo-950 dark:group-hover:text-white">
            Bấm để tải ảnh lên (JPG, PNG, WebP)
          </div>
          <div className="text-[10px] text-slate-600 dark:text-slate-400 flex items-center gap-1">
            <ClipboardPaste className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
            <span>
              Kéo thả hoặc bấm <strong>Cmd+V (Ctrl+V)</strong> để dán
            </span>
          </div>
        </button>

        {imageDimensions && (
          <div className="mt-2 px-2.5 py-1.5 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between text-[11px] shadow-sm">
            <span className="text-slate-700 dark:text-slate-300 font-medium truncate flex items-center gap-1.5 max-w-[195px]">
              <ImageIcon className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <span className="truncate">{currentImageName}</span>
            </span>
            <span className="font-mono text-slate-500 dark:text-slate-400 shrink-0">
              {imageDimensions.width}×{imageDimensions.height}px
            </span>
          </div>
        )}
      </div>

      {/* Header Thông số */}
      <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            Cấu Hình & 5 Bước Thuật Toán
          </h2>
        </div>
        <button
          onClick={onReset}
          title="Khôi phục thông số mặc định"
          className="text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 flex items-center gap-1 px-2 py-1 rounded bg-slate-100 dark:bg-slate-800/70 hover:bg-slate-200 dark:hover:bg-slate-800 transition cursor-pointer"
        >
          <RotateCcw className="w-3 h-3" />
          Reset
        </button>
      </div>

      {/* Scrollable Steps */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
        {/* KHỐI 1: 12 PRESET CẤU HÌNH SẴN THEO MỤC ĐÍCH THỰC TẾ */}
        <div className="bg-slate-50 dark:bg-slate-950/60 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800/80 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <Wand2 className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              Chọn Nhanh Theo Loại Ảnh (12 Mục Đích)
            </label>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-700 dark:text-indigo-300">
              {matchedPreset ? 'Đang khớp' : 'Tùy chỉnh'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {PURPOSE_PRESETS.map((preset) => {
              const isSelected = matchedPreset
                ? matchedPreset.id === preset.id
                : lastClickedPresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    setLastClickedPresetId(preset.id);
                    onChange((prev) => ({
                      ...preset.params,
                      removeBackground: prev.removeBackground ?? false,
                      bgTolerance: prev.bgTolerance ?? 24,
                    }));
                  }}
                  title={preset.description}
                  className={`p-1.5 rounded-md text-left border transition flex items-center justify-between gap-1 cursor-pointer ${
                    isSelected
                      ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                      : 'bg-white dark:bg-slate-900/90 text-slate-700 dark:text-slate-300 border-slate-200/90 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-500/60 hover:bg-indigo-50/40 dark:hover:bg-slate-800/80'
                  }`}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    {renderPurposeIcon(
                      preset.icon,
                      `w-3.5 h-3.5 shrink-0 ${
                        isSelected
                          ? 'text-indigo-100'
                          : 'text-indigo-600 dark:text-indigo-400'
                      }`
                    )}
                    <span className="text-[11px] font-semibold truncate">
                      {preset.label}
                    </span>
                  </span>
                  <span
                    className={`text-[9px] font-mono px-1 py-0.2 rounded shrink-0 ${
                      isSelected
                        ? 'bg-indigo-800/90 text-indigo-100'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {preset.badge}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Mô tả chi tiết của Preset đang chọn */}
          <div className="p-2 rounded bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200/70 dark:border-indigo-800/50 text-[10.5px] text-slate-700 dark:text-slate-300 leading-snug">
            <strong className="text-indigo-900 dark:text-indigo-200">
              {activePreset.label}:
            </strong>{' '}
            {activePreset.description}
          </div>

          {/* 4 Chế độ Lõi Thuật Toán (dành cho người muốn chuyển nhanh kiểu vẽ) */}
          <div className="pt-1.5 border-t border-slate-200/80 dark:border-slate-800/80">
            <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block mb-1.5">
              Hoặc đổi trực tiếp Kiểu Lõi Vector:
            </label>
            <div className="grid grid-cols-4 gap-1">
              <button
                type="button"
                onClick={() => update('mode', 'color')}
                title="Tách thành các mảng màu (K-Means)"
                className={`py-1 px-1 rounded text-[10.5px] font-medium transition cursor-pointer ${
                  params.mode === 'color'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-200/80 dark:bg-slate-800/70 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Đa Sắc
              </button>
              <button
                type="button"
                onClick={() => update('mode', 'cartoon')}
                title="Tô mảng màu nền + Vẽ nét viền đen bằng 1 đường đơn Centerline"
                className={`py-1 px-1 rounded text-[10.5px] font-medium transition cursor-pointer ${
                  params.mode === 'cartoon'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-200/80 dark:bg-slate-800/70 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Cartoon
              </button>
              <button
                type="button"
                onClick={() => update('mode', 'centerline')}
                title="Thuật toán Skeletonization: Biến mọi nét vẽ thành 1 đường Line đơn duy nhất"
                className={`py-1 px-1 rounded text-[10.5px] font-medium transition cursor-pointer ${
                  params.mode === 'centerline'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-200/80 dark:bg-slate-800/70 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                1-Line
              </button>
              <button
                type="button"
                onClick={() => update('mode', 'monochrome')}
                title="Tách bóng đen trắng dạng mảng đặc (Silhouette)"
                className={`py-1 px-1 rounded text-[10.5px] font-medium transition cursor-pointer ${
                  params.mode === 'monochrome'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-200/80 dark:bg-slate-800/70 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Đen Trắng
              </button>
            </div>
          </div>

          {/* TÙY CHỌN QUAN TRỌNG: Gộp nét vẽ mảnh thành 1 đường Line đơn */}
          {params.mode === 'color' && (
            <label className="mt-2 p-2 rounded-md bg-indigo-50/90 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800/70 flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={params.singleLineStrokes}
                onChange={(e) => update('singleLineStrokes', e.target.checked)}
                className="mt-0.5 rounded accent-indigo-600 dark:accent-indigo-500 cursor-pointer"
              />
              <div className="text-[11px] leading-snug">
                <span className="font-semibold text-indigo-950 dark:text-indigo-200 block">
                  Gộp nét vẽ mảnh thành 1 đường Line đơn
                </span>
                <span className="text-slate-600 dark:text-slate-400 text-[10px]">
                  Khử viền răng cưa & biến nét viền đen mảnh thành 1 sợi cong Bézier mượt duy nhất (Centerline)
                </span>
              </div>
            </label>
          )}

          {(params.mode === 'cartoon' ||
            params.mode === 'centerline' ||
            (params.mode === 'color' && params.singleLineStrokes)) && (
            <p className="text-[10px] text-indigo-600 dark:text-indigo-300 mt-1.5 leading-snug">
              ✨ <strong>Centerline 1-Line đang bật:</strong> Nét mảnh được rút lõi về <strong>1 đường cong duy nhất</strong> với ít điểm neo thay vì vẽ đường bao 2 bên!
            </p>
          )}
        </div>

        {/* BƯỚC 1: Làm phẳng giữ cạnh */}
        <section className="bg-slate-50 dark:bg-slate-950/50 rounded-lg p-3 border border-slate-200 dark:border-slate-800/80 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-indigo-500/15 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 text-[11px] font-bold flex items-center justify-center">
                1
              </span>
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                Làm phẳng & Khử viền xám
              </span>
            </div>
            {stats && (
              <span className="text-[10px] font-mono text-slate-500">
                {stats.stepTimings.smoothingMs}ms
              </span>
            )}
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-600 dark:text-slate-300">
                Số lượt lọc (Smoothness)
              </span>
              <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                {params.smoothness}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={5}
              step={1}
              value={params.smoothness}
              onChange={(e) => update('smoothness', Number(e.target.value))}
              className="w-full accent-indigo-600 dark:accent-indigo-500 cursor-pointer"
            />
          </div>
        </section>

        {/* BƯỚC 2: Phân cụm & Gom màu */}
        <section className="bg-slate-50 dark:bg-slate-950/50 rounded-lg p-3 border border-slate-200 dark:border-slate-800/80 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-indigo-500/15 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 text-[11px] font-bold flex items-center justify-center">
                2
              </span>
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                <Palette className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                Gom cụm màu & Tách nét
              </span>
            </div>
            {stats && (
              <span className="text-[10px] font-mono text-slate-500">
                {stats.stepTimings.quantizeMs}ms
              </span>
            )}
          </div>

          {(params.mode === 'color' || params.mode === 'cartoon') && (
            <>
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-600 dark:text-slate-300">
                    Số cụm màu K-Means (2–256)
                  </span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={2}
                      max={256}
                      value={params.colorCount}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (!Number.isNaN(val)) {
                          update(
                            'colorCount',
                            Math.max(2, Math.min(256, val))
                          );
                        }
                      }}
                      className="w-14 px-1.5 py-0.5 text-right font-mono font-semibold text-xs rounded bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-indigo-600 dark:text-indigo-400 focus:outline-none focus:border-indigo-500"
                    />
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      màu
                    </span>
                  </div>
                </div>
                <input
                  type="range"
                  min={2}
                  max={256}
                  step={1}
                  value={params.colorCount}
                  onChange={(e) => update('colorCount', Number(e.target.value))}
                  className="w-full accent-indigo-600 dark:accent-indigo-500 cursor-pointer"
                />
                <div className="flex items-center justify-between gap-1 mt-1">
                  {[8, 16, 32, 64, 128, 256].map((presetCount) => (
                    <button
                      key={presetCount}
                      type="button"
                      onClick={() => update('colorCount', presetCount)}
                      className={`flex-1 py-0.5 rounded text-[10px] font-mono font-medium transition cursor-pointer ${
                        params.colorCount === presetCount
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-700'
                      }`}
                    >
                      {presetCount}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-600 dark:text-slate-300">
                    Ngưỡng gộp màu gần (ΔE)
                  </span>
                  <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                    {params.colorMergeDeltaE}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={40}
                  step={1}
                  value={params.colorMergeDeltaE}
                  onChange={(e) =>
                    update('colorMergeDeltaE', Number(e.target.value))
                  }
                  className="w-full accent-indigo-600 dark:accent-indigo-500 cursor-pointer"
                />
              </div>
            </>
          )}

          {(params.mode === 'cartoon' ||
            params.mode === 'centerline' ||
            params.mode === 'monochrome' ||
            (params.mode === 'color' && params.singleLineStrokes)) && (
            <>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-600 dark:text-slate-300">
                    Ngưỡng bắt nét mực tối (Threshold)
                  </span>
                  <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                    {params.monochromeThreshold}
                  </span>
                </div>
                <input
                  type="range"
                  min={20}
                  max={235}
                  step={1}
                  value={params.monochromeThreshold}
                  onChange={(e) =>
                    update('monochromeThreshold', Number(e.target.value))
                  }
                  className="w-full accent-indigo-600 dark:accent-indigo-500 cursor-pointer"
                />
              </div>
            </>
          )}

          {(params.mode === 'cartoon' ||
            params.mode === 'centerline' ||
            (params.mode === 'color' && params.singleLineStrokes)) && (
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-600 dark:text-slate-300">
                  Độ dày nét đơn (Stroke Width)
                </span>
                <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                  {params.strokeWidth === 0
                    ? 'Tự động (Auto)'
                    : `${params.strokeWidth} px`}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={10}
                step={0.5}
                value={params.strokeWidth}
                onChange={(e) => update('strokeWidth', Number(e.target.value))}
                className="w-full accent-indigo-600 dark:accent-indigo-500 cursor-pointer"
              />
            </div>
          )}

          {(params.mode === 'centerline' || params.mode === 'monochrome') && (
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={params.invertMonochrome}
                onChange={(e) => update('invertMonochrome', e.target.checked)}
                className="rounded accent-indigo-600 dark:accent-indigo-500"
              />
              Đảo ngược sáng/tối (Lấy nét trắng trên nền tối)
            </label>
          )}
        </section>

        {/* BƯỚC 3: Hòa tan đốm vụn & Tách bỏ màu nền */}
        <section className="bg-slate-50 dark:bg-slate-950/50 rounded-lg p-3 border border-slate-200 dark:border-slate-800/80 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-indigo-500/15 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 text-[11px] font-bold flex items-center justify-center">
                3
              </span>
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                <Eraser className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                Tách Nền & Lọc Đốm Vụn
              </span>
            </div>
            {stats && (
              <span className="text-[10px] font-mono text-slate-500">
                {stats.stepTimings.despeckleMs}ms
              </span>
            )}
          </div>

          {/* Tách bỏ màu nền không ảnh hưởng tới SVG bên trong */}
          <div className="p-2.5 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-300/70 dark:border-emerald-700/50 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-emerald-950 dark:text-emerald-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(params.removeBackground)}
                  onChange={(e) =>
                    update('removeBackground', e.target.checked)
                  }
                  className="rounded accent-emerald-600 dark:accent-emerald-500 w-3.5 h-3.5"
                />
                <span>Bỏ màu nền (Giữ nguyên SVG trong)</span>
              </label>
              <span
                className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${
                  params.removeBackground
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                }`}
              >
                {params.removeBackground ? 'Đang bật' : 'Tắt'}
              </span>
            </div>

            <p className="text-[10px] text-slate-600 dark:text-slate-400 leading-snug">
              Tự động dò màu nền từ 4 cạnh viền và các hốc nền để xóa trong suốt mà <strong>không làm thay đổi bất kỳ đường nét hay màu sắc nào bên trong vật thể</strong>.
            </p>

            {params.removeBackground && (
              <div className="pt-1 border-t border-emerald-200/70 dark:border-emerald-800/50">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-700 dark:text-slate-300">
                    Độ rộng dải màu nền (Tolerance)
                  </span>
                  <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                    {params.bgTolerance ?? 24}
                  </span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={80}
                  step={1}
                  value={params.bgTolerance ?? 24}
                  onChange={(e) =>
                    update('bgTolerance', Number(e.target.value))
                  }
                  className="w-full accent-emerald-600 dark:accent-emerald-500 cursor-pointer"
                />
              </div>
            )}
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-600 dark:text-slate-300">
                Diện tích vùng tối thiểu
              </span>
              <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                {params.despeckleArea} px²
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={200}
              step={2}
              value={params.despeckleArea}
              onChange={(e) => update('despeckleArea', Number(e.target.value))}
              className="w-full accent-indigo-600 dark:accent-indigo-500 cursor-pointer"
            />
          </div>
        </section>

        {/* BƯỚC 4: Tách lớp & Dò đường viền */}
        {params.mode !== 'centerline' && (
          <section className="bg-slate-50 dark:bg-slate-950/50 rounded-lg p-3 border border-slate-200 dark:border-slate-800/80 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-indigo-500/15 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 text-[11px] font-bold flex items-center justify-center">
                  4
                </span>
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                  <Layers className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  Xếp lớp & Dò biên
                </span>
              </div>
              {stats && (
                <span className="text-[10px] font-mono text-slate-500">
                  {stats.stepTimings.tracingMs}ms
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => update('layerMode', 'stacked')}
                className={`py-1.5 px-2 rounded text-xs font-medium transition ${
                  params.layerMode === 'stacked'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-200/80 dark:bg-slate-800/70 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Stacked (Khử khe hở)
              </button>
              <button
                type="button"
                onClick={() => update('layerMode', 'cutout')}
                className={`py-1.5 px-2 rounded text-xs font-medium transition ${
                  params.layerMode === 'cutout'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-200/80 dark:bg-slate-800/70 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Cutout (Tách rời)
              </button>
            </div>
          </section>
        )}

        {/* BƯỚC 5: Rút gọn & Đường cong Bézier */}
        <section className="bg-slate-50 dark:bg-slate-950/50 rounded-lg p-3 border border-slate-200 dark:border-slate-800/80 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-indigo-500/15 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 text-[11px] font-bold flex items-center justify-center">
                5
              </span>
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                <Spline className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                Đường tròn & Khớp Bézier
              </span>
            </div>
            {stats && (
              <span className="text-[10px] font-mono text-slate-500">
                {stats.stepTimings.curveFittingMs}ms
              </span>
            )}
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-600 dark:text-slate-300">
                Rút gọn điểm (RDP Epsilon)
              </span>
              <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                {params.simplifyTolerance.toFixed(1)} px
              </span>
            </div>
            <input
              type="range"
              min={0.2}
              max={4.0}
              step={0.1}
              value={params.simplifyTolerance}
              onChange={(e) =>
                update('simplifyTolerance', Number(e.target.value))
              }
              className="w-full accent-indigo-600 dark:accent-indigo-500 cursor-pointer"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-600 dark:text-slate-300">
                Ngưỡng giữ góc nhọn (Corner)
              </span>
              <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                {params.cornerThreshold}°
              </span>
            </div>
            <input
              type="range"
              min={35}
              max={150}
              step={5}
              value={params.cornerThreshold}
              onChange={(e) =>
                update('cornerThreshold', Number(e.target.value))
              }
              className="w-full accent-indigo-600 dark:accent-indigo-500 cursor-pointer"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-600 dark:text-slate-300">
                Độ uốn cong Cubic Bézier
              </span>
              <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                {Math.round(params.curveSmoothing * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1.3}
              step={0.05}
              value={params.curveSmoothing}
              onChange={(e) => update('curveSmoothing', Number(e.target.value))}
              className="w-full accent-indigo-600 dark:accent-indigo-500 cursor-pointer"
            />
          </div>
        </section>
      </div>

      {/* Footer status */}
      <div className="px-4 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/80 flex items-center justify-between text-xs">
        <span className="text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full ${
              isProcessing ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'
            }`}
          />
          {isProcessing ? 'Đang tính toán...' : 'Sẵn sàng (Web Worker)'}
        </span>
        {stats && (
          <span className="font-mono text-slate-700 dark:text-slate-300">
            Tổng: <strong>{stats.executionMs}ms</strong>
          </span>
        )}
      </div>
    </aside>
  );
};
