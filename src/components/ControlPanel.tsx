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
  MousePointerClick,
  Trash2,
  Maximize,
  X,
} from 'lucide-react';
import { PipelineStats, VectorizerParams } from '../types/vectorizer';
import { PURPOSE_PRESETS, PurposePreset } from '../engine/sampleImages';
import { InfoTooltip } from './InfoTooltip';

interface ControlPanelProps {
  params: VectorizerParams;
  stats: PipelineStats | null;
  isProcessing: boolean;
  currentImageName: string;
  imageDimensions: { width: number; height: number } | null;
  isEraserMode: boolean;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
  onToggleEraserMode: () => void;
  onClearManualErases: () => void;
  onUploadFile: (file: File) => void;
  onChange: (
    updater: (prev: VectorizerParams) => VectorizerParams,
    actionLabel?: string
  ) => void;
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
  isEraserMode,
  isMobileOpen = false,
  onCloseMobile,
  onToggleEraserMode,
  onClearManualErases,
  onUploadFile,
  onChange,
  onReset,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const drawerTouchStartRef = useRef<{ x: number; y: number } | null>(null);
  const [lastClickedPresetId, setLastClickedPresetId] =
    useState<string>('logo-icon');

  const update = <K extends keyof VectorizerParams>(
    key: K,
    value: VectorizerParams[K],
    actionLabel?: string
  ) => {
    onChange((prev) => ({ ...prev, [key]: value }), actionLabel);
  };

  const matchedPreset = PURPOSE_PRESETS.find((p) =>
    isExactPresetMatch(p.params, params)
  );
  const activePreset =
    matchedPreset ??
    PURPOSE_PRESETS.find((p) => p.id === lastClickedPresetId) ??
    PURPOSE_PRESETS[0];

  const manualEraseCount = params.manualErases?.length ?? 0;

  return (
    <>
      {isMobileOpen && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 z-30 bg-black/45 backdrop-blur-[3px] md:hidden"
        />
      )}
      <aside
        data-apple-lens="panel"
        onTouchStart={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest('input[type="range"]')) {
            drawerTouchStartRef.current = null;
            return;
          }
          if (e.touches.length === 1) {
            drawerTouchStartRef.current = {
              x: e.touches[0].clientX,
              y: e.touches[0].clientY,
            };
          }
        }}
        onTouchEnd={(e) => {
          const start = drawerTouchStartRef.current;
          drawerTouchStartRef.current = null;
          if (!start || !onCloseMobile || e.changedTouches.length === 0) return;
          const dx = e.changedTouches[0].clientX - start.x;
          const dy = e.changedTouches[0].clientY - start.y;
          // Vuốt ngang sang trái (> 55px) để đóng ngăn kéo trên Mobile
          if (dx < -55 && Math.abs(dx) > Math.abs(dy) * 1.4) {
            onCloseMobile();
          }
        }}
        className={`apple-lens-panel fixed inset-y-0 left-0 z-40 w-[86vw] max-w-[324px] transform transition-transform duration-200 ease-out md:static md:translate-x-0 md:w-[316px] shrink-0 border-r flex flex-col h-full select-none ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* KHỐI TẢI ẢNH GỌN GÀNG */}
        <div className="p-2.5 border-b border-indigo-500/15 dark:border-sky-400/15 space-y-1.5">
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

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="apple-lens-btn flex-1 py-2 px-3 rounded-xl !border-dashed !border-indigo-400/80 dark:!border-indigo-400/60 hover:!border-indigo-500 flex items-center justify-center gap-2 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <span className="text-xs font-semibold text-indigo-950 dark:text-indigo-100 truncate">
                Chọn ảnh hoặc Dán (Ctrl+V)
              </span>
            </button>

            <InfoTooltip
              side="right"
              title="Hỗ trợ định dạng & Thao tác nhanh"
              content={
                <ul className="list-disc pl-3.5 space-y-1">
                  <li>Hỗ trợ: JPG, PNG, WebP, GIF, BMP.</li>
                  <li>
                    Kéo thả trực tiếp file ảnh vào bất kỳ đâu trên màn hình.
                  </li>
                  <li>
                    Bấm <strong>Ctrl+V</strong> (hoặc <strong>Cmd+V</strong>) để
                    dán ảnh chụp màn hình từ Clipboard.
                  </li>
                </ul>
              }
            />
          </div>

          {imageDimensions && (
            <div className="apple-lens-pill px-2.5 py-1 rounded-lg flex items-center justify-between text-[11px]">
              <span className="text-slate-700 dark:text-slate-200 font-medium truncate flex items-center gap-1.5 max-w-[185px]">
                <ImageIcon className="w-3 h-3 text-indigo-600 dark:text-indigo-400 shrink-0" />
                <span className="truncate">{currentImageName}</span>
              </span>
              <span className="font-mono text-[10px] text-slate-500 dark:text-slate-300 shrink-0">
                {imageDimensions.width}×{imageDimensions.height}px
              </span>
            </div>
          )}
        </div>

        {/* Header Thông số */}
        <div className="px-3 py-2 border-b border-indigo-500/15 dark:border-sky-400/15 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-200">
              Cấu hình Vector hóa
            </h2>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={onReset}
              title="Khôi phục thông số mặc định"
              className="apple-lens-btn text-[11px] text-slate-700 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white flex items-center gap-1 px-2 py-0.5 rounded-lg cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              Reset
            </button>
            {onCloseMobile && (
              <button
                type="button"
                onClick={onCloseMobile}
                title="Đóng bảng cấu hình"
                className="apple-lens-btn p-1 rounded-lg text-slate-700 dark:text-slate-200 md:hidden cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

      {/* Scrollable Steps */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
        {/* KHỐI 1: 12 PRESET THEO MỤC ĐÍCH */}
        <div
          data-apple-lens="card"
          className="apple-lens-card p-2.5 rounded-xl space-y-2"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Wand2 className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                Loại ảnh ({activePreset.label})
              </span>
              <InfoTooltip
                side="right"
                title={`Chế độ: ${activePreset.label} (${activePreset.badge})`}
                content={activePreset.description}
              />
            </div>
            <span className="apple-lens-pill text-[10px] font-medium px-2 py-0.5 rounded-full text-indigo-700 dark:text-indigo-300">
              {matchedPreset ? 'Chuẩn' : 'Tùy chỉnh'}
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
                    onChange(
                      (prev) => ({
                        ...preset.params,
                        removeBackground: prev.removeBackground ?? false,
                        outputFormat: prev.outputFormat ?? 'vector',
                        bgTolerance: prev.bgTolerance ?? 24,
                        manualErases: prev.manualErases ?? [],
                        manualEraseTolerance: prev.manualEraseTolerance ?? 18,
                      }),
                      `Chọn chế độ: ${preset.label}`
                    );
                  }}
                  title={`${preset.label} (${preset.badge}) — ${preset.description}`}
                  className={`px-2 py-1.5 rounded-lg text-left flex items-center justify-between gap-1 cursor-pointer ${
                    isSelected
                      ? 'apple-lens-btn-primary'
                      : 'apple-lens-btn text-slate-700 dark:text-slate-200'
                  }`}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    {renderPurposeIcon(
                      preset.icon,
                      `w-3 h-3 shrink-0 ${
                        isSelected
                          ? 'text-indigo-100'
                          : 'text-indigo-600 dark:text-indigo-400'
                      }`
                    )}
                    <span className="text-[11px] font-medium truncate">
                      {preset.label}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* 4 Chế độ Lõi Thuật Toán */}
          <div className="pt-1.5 border-t border-indigo-500/15 dark:border-sky-400/15 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1">
                Kiểu lõi Vector
                <InfoTooltip
                  side="right"
                  title="4 Kiểu Lõi Thuật Toán"
                  content={
                    <ul className="list-disc pl-3.5 space-y-1">
                      <li>
                        <strong>Đa Sắc:</strong> Tách thành các lớp mảng màu
                        K-Means CIELAB.
                      </li>
                      <li>
                        <strong>Cartoon:</strong> Tô mảng màu nền + đi nét viền
                        đen bằng 1 đường đơn Centerline.
                      </li>
                      <li>
                        <strong>1-Line:</strong> Biến toàn bộ nét vẽ thành 1 sợi
                        đường tâm duy nhất (Skeletonization).
                      </li>
                      <li>
                        <strong>Đen Trắng:</strong> Tách bóng mảng đặc 2 màu
                        (Silhouette).
                      </li>
                    </ul>
                  }
                />
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {(
                [
                  { id: 'color', label: 'Đa Sắc' },
                  { id: 'cartoon', label: 'Cartoon' },
                  { id: 'centerline', label: '1-Line' },
                  { id: 'monochrome', label: 'Đen Trắng' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() =>
                    update('mode', m.id, `Đổi kiểu lõi: ${m.label}`)
                  }
                  className={`py-1 px-1 rounded-lg text-[10.5px] font-medium cursor-pointer ${
                    params.mode === m.id
                      ? 'apple-lens-btn-primary'
                      : 'apple-lens-btn text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {params.mode === 'color' && (
              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={params.singleLineStrokes}
                    onChange={(e) =>
                      update(
                        'singleLineStrokes',
                        e.target.checked,
                        e.target.checked
                          ? 'Bật gộp nét mảnh 1-Line'
                          : 'Tắt gộp nét mảnh 1-Line'
                      )
                    }
                    className="rounded accent-indigo-600 dark:accent-indigo-500 cursor-pointer"
                  />
                  <span>Gộp nét viền mảnh thành 1-Line</span>
                </label>
                <InfoTooltip
                  side="right"
                  title="Gộp nét mảnh (Centerline 1-Line)"
                  content="Tự động tách các nét viền tối mảnh và rút lõi về 1 sợi cong Bézier duy nhất thay vì vẽ đường bao 2 mép."
                />
              </div>
            )}
          </div>
        </div>

        {/* BƯỚC 3 ĐƯA LÊN NỔI BẬT: TÁCH NỀN TỰ ĐỘNG & XÓA VÙNG CHỦ ĐỘNG */}
        <section
          data-apple-lens="card"
          className="apple-lens-card rounded-xl p-2.5 space-y-2"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Eraser className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                Xóa Nền & Lọc Đốm
              </span>
              <InfoTooltip
                side="right"
                title="2 Chế độ Xóa Nền Thông Minh"
                content={
                  <ul className="list-disc pl-3.5 space-y-1">
                    <li>
                      <strong>Tách nền tự động:</strong> Quét từ 4 góc biên ngoài
                      và dừng tại đường viền vật thể (bảo toàn 100% màu trùng
                      với nền nằm bên trong nhân vật như gấu trắng).
                    </li>
                    <li>
                      <strong>Xóa chủ động (Click chuột):</strong> Khi bật, con
                      trỏ đổi sang tâm ngắm — click vào mảng màu/nền nào trên
                      ảnh sẽ xóa ngay vùng liên thông đó. Có hỗ trợ Hoàn tác
                      (Ctrl+Z) & Lịch sử.
                    </li>
                  </ul>
                }
              />
            </div>
            {stats && (
              <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                {stats.stepTimings.despeckleMs}ms
              </span>
            )}
          </div>

          {/* 1. Bỏ nền tự động */}
          <div className="apple-lens-pill p-2 rounded-xl !border-emerald-400/50 dark:!border-emerald-500/40 space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-emerald-950 dark:text-emerald-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(params.removeBackground)}
                  onChange={(e) =>
                    update(
                      'removeBackground',
                      e.target.checked,
                      e.target.checked
                        ? 'Bật bỏ nền tự động'
                        : 'Tắt bỏ nền tự động'
                    )
                  }
                  className="rounded accent-emerald-600 dark:accent-emerald-500 w-3.5 h-3.5 cursor-pointer"
                />
                <span>Bỏ nền tự động</span>
              </label>
              <span className="text-[10px] font-mono text-emerald-700 dark:text-emerald-300">
                {params.removeBackground
                  ? `Độ nhạy: ${params.bgTolerance ?? 24}`
                  : 'Tắt'}
              </span>
            </div>

            {params.removeBackground && (
              <input
                type="range"
                min={5}
                max={80}
                step={1}
                value={params.bgTolerance ?? 24}
                onChange={(e) =>
                  update(
                    'bgTolerance',
                    Number(e.target.value),
                    'Chỉnh độ nhạy bỏ nền tự động'
                  )
                }
                className="w-full accent-emerald-600 dark:accent-emerald-500 cursor-pointer"
              />
            )}
          </div>

          {/* 2. Xóa nền chủ động (Click vào vùng bất kỳ trên ảnh) */}
          <div
            className={`apple-lens-pill p-2 rounded-xl transition space-y-1.5 ${
              isEraserMode
                ? '!border-rose-400 dark:!border-rose-500/70 ring-1 ring-rose-400/30'
                : ''
            }`}
          >
            <div className="flex items-center justify-between gap-1.5">
              <button
                type="button"
                onClick={onToggleEraserMode}
                className={`flex-1 py-1.5 px-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${
                  isEraserMode
                    ? 'apple-lens-btn-rose'
                    : 'apple-lens-btn text-slate-800 dark:text-slate-100'
                }`}
              >
                <MousePointerClick className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {isEraserMode
                    ? 'Đang bật Click Xóa Vùng'
                    : 'Xóa Vùng Chủ Động (Click)'}
                </span>
              </button>

              {manualEraseCount > 0 && (
                <button
                  type="button"
                  onClick={onClearManualErases}
                  title={`Khôi phục toàn bộ ${manualEraseCount} vùng đã click xóa`}
                  className="apple-lens-btn px-2 py-1.5 rounded-lg text-[11px] font-medium text-rose-600 dark:text-rose-400 flex items-center gap-1 cursor-pointer shrink-0"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>{manualEraseCount}</span>
                </button>
              )}
            </div>

            {(isEraserMode || manualEraseCount > 0) && (
              <div className="pt-1">
                <div className="flex justify-between text-[11px] mb-0.5">
                  <span className="text-slate-600 dark:text-slate-300">
                    Độ lan màu khi click
                  </span>
                  <span className="font-mono font-semibold text-rose-600 dark:text-rose-400">
                    {params.manualEraseTolerance ?? 18}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={65}
                  step={1}
                  value={params.manualEraseTolerance ?? 18}
                  onChange={(e) =>
                    update(
                      'manualEraseTolerance',
                      Number(e.target.value),
                      'Chỉnh độ lan màu xóa chủ động'
                    )
                  }
                  className="w-full accent-rose-600 dark:accent-rose-500 cursor-pointer"
                />
              </div>
            )}
          </div>

          {/* 3. Lọc đốm vụn */}
          <div>
            <div className="flex justify-between text-xs mb-0.5">
              <span className="text-slate-600 dark:text-slate-300 flex items-center gap-1">
                Lọc đốm nhỏ (Despeckle)
                <InfoTooltip
                  side="right"
                  title="Diện tích vùng tối thiểu"
                  content="Tự động hòa tan các hạt đốm nhỏ hơn diện tích này vào mảng màu lớn liền kề để giảm số đường path rác."
                />
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
              onChange={(e) =>
                update(
                  'despeckleArea',
                  Number(e.target.value),
                  'Chỉnh lọc đốm nhỏ'
                )
              }
              className="w-full accent-indigo-600 dark:accent-indigo-500 cursor-pointer"
            />
          </div>
        </section>

        {/* BƯỚC 1 & 2: LÀM PHẲNG & GOM CỤM MÀU */}
        <section
          data-apple-lens="card"
          className="apple-lens-card rounded-xl p-2.5 space-y-2"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                Màu Sắc & Độ Phẳng
              </span>
              <InfoTooltip
                side="right"
                title="Làm phẳng & Phân cụm K-Means++"
                content="Bước 1 làm mịn nhiễu JPEG nhưng giữ sắc nét biên cạnh (Bilateral + Shock Filter). Bước 2 gom cụm màu trong không gian màu mắt người CIELAB."
              />
            </div>
            {stats && (
              <span className="text-[10px] font-mono text-slate-500">
                {stats.stepTimings.smoothingMs + stats.stepTimings.quantizeMs}ms
              </span>
            )}
          </div>

          <div>
            <div className="flex justify-between text-xs mb-0.5">
              <span className="text-slate-600 dark:text-slate-300">
                Độ làm phẳng (Smoothness)
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
              onChange={(e) =>
                update(
                  'smoothness',
                  Number(e.target.value),
                  'Chỉnh độ làm phẳng'
                )
              }
              className="w-full accent-indigo-600 dark:accent-indigo-500 cursor-pointer"
            />
          </div>

          {(params.mode === 'color' || params.mode === 'cartoon') && (
            <>
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-600 dark:text-slate-300">
                    Số màu tối đa (2–256)
                  </span>
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
                          Math.max(2, Math.min(256, val)),
                          'Chỉnh số lượng màu'
                        );
                      }
                    }}
                    className="apple-lens-pill w-14 px-1.5 py-0.5 text-right font-mono font-semibold text-xs rounded-lg text-indigo-600 dark:text-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <input
                  type="range"
                  min={2}
                  max={256}
                  step={1}
                  value={params.colorCount}
                  onChange={(e) =>
                    update(
                      'colorCount',
                      Number(e.target.value),
                      'Chỉnh số lượng màu'
                    )
                  }
                  className="w-full accent-indigo-600 dark:accent-indigo-500 cursor-pointer"
                />
                <div className="flex items-center justify-between gap-1 mt-1">
                  {[8, 16, 32, 64, 128, 256].map((presetCount) => (
                    <button
                      key={presetCount}
                      type="button"
                      onClick={() =>
                        update(
                          'colorCount',
                          presetCount,
                          `Chọn ${presetCount} màu`
                        )
                      }
                      className={`flex-1 py-0.5 rounded-md text-[10px] font-mono font-medium cursor-pointer ${
                        params.colorCount === presetCount
                          ? 'apple-lens-btn-primary'
                          : 'apple-lens-btn text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {presetCount}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs mb-0.5">
                  <span className="text-slate-600 dark:text-slate-300 flex items-center gap-1">
                    Gộp màu gần (ΔE)
                    <InfoTooltip
                      side="right"
                      title="Khoảng cách màu CIELAB ΔE"
                      content="Tự động hợp nhất các cụm màu có sắc độ quá giống nhau theo cảm nhận mắt người. Giảm xuống 2–5 nếu cần giữ chuyển sắc mượt."
                    />
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
                    update(
                      'colorMergeDeltaE',
                      Number(e.target.value),
                      'Chỉnh ngưỡng gộp màu ΔE'
                    )
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
            <div>
              <div className="flex justify-between text-xs mb-0.5">
                <span className="text-slate-600 dark:text-slate-300">
                  Ngưỡng bắt nét tối
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
                  update(
                    'monochromeThreshold',
                    Number(e.target.value),
                    'Chỉnh ngưỡng bắt nét tối'
                  )
                }
                className="w-full accent-indigo-600 dark:accent-indigo-500 cursor-pointer"
              />
            </div>
          )}

          {(params.mode === 'cartoon' ||
            params.mode === 'centerline' ||
            (params.mode === 'color' && params.singleLineStrokes)) && (
            <div>
              <div className="flex justify-between text-xs mb-0.5">
                <span className="text-slate-600 dark:text-slate-300">
                  Độ dày nét đơn
                </span>
                <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                  {params.strokeWidth === 0
                    ? 'Auto'
                    : `${params.strokeWidth}px`}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={10}
                step={0.5}
                value={params.strokeWidth}
                onChange={(e) =>
                  update(
                    'strokeWidth',
                    Number(e.target.value),
                    'Chỉnh độ dày nét đơn'
                  )
                }
                className="w-full accent-indigo-600 dark:accent-indigo-500 cursor-pointer"
              />
            </div>
          )}

          {(params.mode === 'centerline' || params.mode === 'monochrome') && (
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={params.invertMonochrome}
                onChange={(e) =>
                  update(
                    'invertMonochrome',
                    e.target.checked,
                    'Đảo ngược sáng/tối'
                  )
                }
                className="rounded accent-indigo-600 dark:accent-indigo-500"
              />
              Đảo ngược sáng/tối
            </label>
          )}
        </section>

        {/* BƯỚC 4 & 5: XẾP LỚP & ĐƯỜNG CONG BÉZIER */}
        <section
          data-apple-lens="card"
          className="apple-lens-card rounded-xl p-2.5 space-y-2"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Spline className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                Đường Cong & Xếp Lớp
              </span>
              <InfoTooltip
                side="right"
                title="Dò biên & Khớp đường cong Bézier"
                content={
                  <ul className="list-disc pl-3.5 space-y-1">
                    <li>
                      <strong>Stacked:</strong> Lớp dưới lót đáy giúp triệt tiêu
                      khe hở trắng giữa các mảng màu.
                    </li>
                    <li>
                      <strong>Cutout:</strong> Cắt rời từng mảng màu không chồng
                      lấn (dùng cho máy cắt Decal/CNC).
                    </li>
                    <li>
                      <strong>Đa giác tối ưu:</strong> Coi bậc thang pixel là
                      dung sai, chỉ đặt điểm neo ở nơi hình thật sự đổi hướng
                      (ít điểm, cong mượt). <strong>RDP cổ điển:</strong> thuật
                      toán cũ để so sánh.
                    </li>
                    <li>
                      <strong>Kiểu file:</strong> Vector dò hình thành các mảng
                      màu; <strong>Nhúng ảnh gốc</strong> đặt nguyên ảnh vào
                      file SVG (zoom như ảnh gốc, nhưng không phải vector).
                    </li>
                    <li>
                      <strong>Độ phân giải xử lý:</strong> Ảnh lớn được thu nhỏ
                      trước khi dò. 2048px / Ảnh gốc giữ chi tiết nhỏ hơn khi
                      zoom, đổi lại chậm hơn và file nặng hơn (preset Siêu Nét
                      tự dùng 2048px).
                    </li>
                    <li>
                      <strong>RDP & Bézier:</strong> Điều chỉnh độ mượt và độ
                      nhọn của các điểm neo vector.
                    </li>
                  </ul>
                }
              />
            </div>
            {stats && (
              <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                {stats.stepTimings.tracingMs + stats.stepTimings.curveFittingMs}
                ms
              </span>
            )}
          </div>

          <div className="space-y-1">
            <div className="text-xs text-slate-600 dark:text-slate-300">
              Kiểu file SVG
            </div>
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() =>
                  update('outputFormat', 'vector', 'Kiểu file SVG: Vector')
                }
                className={`py-1 px-2 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 cursor-pointer ${
                  (params.outputFormat ?? 'vector') === 'vector'
                    ? 'apple-lens-btn-primary'
                    : 'apple-lens-btn text-slate-700 dark:text-slate-300'
                }`}
              >
                <Spline className="w-3 h-3" />
                Vector
              </button>
              <button
                type="button"
                onClick={() =>
                  update(
                    'outputFormat',
                    'embedded',
                    'Kiểu file SVG: Nhúng ảnh gốc'
                  )
                }
                className={`py-1 px-2 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 cursor-pointer ${
                  params.outputFormat === 'embedded'
                    ? 'apple-lens-btn-primary'
                    : 'apple-lens-btn text-slate-700 dark:text-slate-300'
                }`}
              >
                <ImageIcon className="w-3 h-3" />
                Nhúng ảnh gốc
              </button>
            </div>
            {params.outputFormat === 'embedded' ? (
              <p className="text-[10px] leading-snug text-amber-600 dark:text-amber-400">
                File SVG chứa nguyên ảnh gốc: zoom giống hệt ảnh gốc nhưng không
                phải vector, không đổi màu / cắt từng vùng được. Các thông số
                vector bên dưới không áp dụng cho file xuất.
              </p>
            ) : (
              <>
                <div className="text-xs text-slate-600 dark:text-slate-300 pt-1">
                  Độ phân giải xử lý
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {(
                    [
                      [1024, '1024px', 'Nhanh, file nhẹ'],
                      [2048, '2048px', 'Chi tiết gấp ~4 lần, chậm & nặng hơn'],
                      [0, 'Ảnh gốc', 'Tối đa 2560px; rất nặng với ảnh nhiều màu'],
                    ] as const
                  ).map(([value, label, tip]) => (
                    <button
                      key={value}
                      type="button"
                      title={tip}
                      onClick={() =>
                        update(
                          'processingResolution',
                          value,
                          `Độ phân giải xử lý: ${label}`
                        )
                      }
                      className={`py-1 px-1 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 cursor-pointer ${
                        (params.processingResolution ?? 1024) === value
                          ? 'apple-lens-btn-primary'
                          : 'apple-lens-btn text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {value === 0 && <Maximize className="w-3 h-3" />}
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {params.mode !== 'centerline' && (
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() =>
                  update('layerMode', 'stacked', 'Chế độ xếp lớp: Stacked')
                }
                className={`py-1 px-2 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 cursor-pointer ${
                  params.layerMode === 'stacked'
                    ? 'apple-lens-btn-primary'
                    : 'apple-lens-btn text-slate-700 dark:text-slate-300'
                }`}
              >
                <Layers className="w-3 h-3" />
                Stacked (Đè lớp)
              </button>
              <button
                type="button"
                onClick={() =>
                  update('layerMode', 'cutout', 'Chế độ xếp lớp: Cutout')
                }
                className={`py-1 px-2 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 cursor-pointer ${
                  params.layerMode === 'cutout'
                    ? 'apple-lens-btn-primary'
                    : 'apple-lens-btn text-slate-700 dark:text-slate-300'
                }`}
              >
                <Scissors className="w-3 h-3" />
                Cutout (Tách rời)
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() =>
                update(
                  'curveFitter',
                  'optimal',
                  'Thuật toán khớp: Đa giác tối ưu'
                )
              }
              className={`py-1 px-2 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 cursor-pointer ${
                (params.curveFitter ?? 'optimal') === 'optimal'
                  ? 'apple-lens-btn-primary'
                  : 'apple-lens-btn text-slate-700 dark:text-slate-300'
              }`}
            >
              <Sparkles className="w-3 h-3" />
              Đa giác tối ưu
            </button>
            <button
              type="button"
              onClick={() =>
                update('curveFitter', 'legacy', 'Thuật toán khớp: RDP cổ điển')
              }
              className={`py-1 px-2 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 cursor-pointer ${
                params.curveFitter === 'legacy'
                  ? 'apple-lens-btn-primary'
                  : 'apple-lens-btn text-slate-700 dark:text-slate-300'
              }`}
            >
              <Spline className="w-3 h-3" />
              RDP cổ điển
            </button>
          </div>

          <div>
            <div className="flex justify-between text-xs mb-0.5">
              <span className="text-slate-600 dark:text-slate-300">
                Rút gọn điểm (RDP)
              </span>
              <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                {params.simplifyTolerance.toFixed(1)}px
              </span>
            </div>
            <input
              type="range"
              min={0.2}
              max={4.0}
              step={0.1}
              value={params.simplifyTolerance}
              onChange={(e) =>
                update(
                  'simplifyTolerance',
                  Number(e.target.value),
                  'Chỉnh độ rút gọn điểm RDP'
                )
              }
              className="w-full accent-indigo-600 dark:accent-indigo-500 cursor-pointer"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs mb-0.5">
              <span className="text-slate-600 dark:text-slate-300">
                Ngưỡng góc nhọn
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
                update(
                  'cornerThreshold',
                  Number(e.target.value),
                  'Chỉnh ngưỡng góc nhọn'
                )
              }
              className="w-full accent-indigo-600 dark:accent-indigo-500 cursor-pointer"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs mb-0.5">
              <span className="text-slate-600 dark:text-slate-300">
                Độ uốn mượt Bézier
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
              onChange={(e) =>
                update(
                  'curveSmoothing',
                  Number(e.target.value),
                  'Chỉnh độ uốn mượt Bézier'
                )
              }
              className="w-full accent-indigo-600 dark:accent-indigo-500 cursor-pointer"
            />
          </div>
        </section>
      </div>

      {/* Footer status */}
      <div className="px-3 py-2 border-t border-indigo-500/15 dark:border-sky-400/15 flex items-center justify-between text-[11px]">
        <span className="text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full ${
              isProcessing ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'
            }`}
          />
          {isProcessing ? 'Đang xử lý...' : 'Sẵn sàng'}
        </span>
        {stats && (
          <span className="font-mono text-slate-600 dark:text-slate-300">
            {stats.executionMs}ms · {stats.totalPaths} lớp
          </span>
        )}
      </div>
      </aside>
    </>
  );
};
