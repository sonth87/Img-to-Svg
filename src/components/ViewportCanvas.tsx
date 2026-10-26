import React, { useEffect, useRef, useState } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Grid,
  MoveHorizontal,
  Sparkles,
  Eraser,
  MousePointerClick,
  Undo2,
  Redo2,
  X,
} from 'lucide-react';
import { PipelineResult, ViewStage } from '../types/vectorizer';
import { InfoTooltip } from './InfoTooltip';

interface ViewportCanvasProps {
  originalDataUrl: string | null;
  result: PipelineResult | null;
  viewStage: ViewStage;
  isDarkTheme: boolean;
  isProcessing: boolean;
  processingKey: number;
  removeBackground: boolean;
  isEraserMode: boolean;
  manualEraseTolerance: number;
  manualEraseCount: number;
  canUndo: boolean;
  canRedo: boolean;
  onToggleRemoveBackground: () => void;
  onToggleEraserMode: () => void;
  onChangeManualEraseTolerance: (val: number) => void;
  onEraseAtPoint: (x: number, y: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onChangeStage: (stage: ViewStage) => void;
}

const STAGE_TABS: { id: ViewStage; label: string; tip: string }[] = [
  {
    id: 'split',
    label: 'So Sánh',
    tip: 'Kéo thanh trượt để so sánh trực tiếp Ảnh Gốc (trái) và Vector SVG (phải).',
  },
  {
    id: 'original',
    label: 'Ảnh Gốc',
    tip: 'Hiển thị ảnh Raster gốc ban đầu.',
  },
  {
    id: 'smoothed',
    label: 'B1: Làm Phẳng',
    tip: 'Kết quả sau Bước 1: Lọc Bilateral giữ cạnh & khử viền răng cưa.',
  },
  {
    id: 'quantized',
    label: 'B2-3: Phân Cụm',
    tip: 'Kết quả sau Bước 2 & 3: Gom cụm màu K-Means++, tách nền và lọc đốm.',
  },
  {
    id: 'svg',
    label: 'B4-5: Vector SVG',
    tip: 'Kết quả Vector SVG hoàn chỉnh.',
  },
  {
    id: 'wireframe',
    label: 'Khung Dây',
    tip: 'Hiển thị khung dây đường dẫn (Path) và các điểm neo Bézier (Nodes).',
  },
];

export const ViewportCanvas: React.FC<ViewportCanvasProps> = ({
  originalDataUrl,
  result,
  viewStage,
  isDarkTheme,
  isProcessing,
  processingKey,
  removeBackground,
  isEraserMode,
  manualEraseTolerance,
  manualEraseCount,
  canUndo,
  canRedo,
  onToggleRemoveBackground,
  onToggleEraserMode,
  onChangeManualEraseTolerance,
  onEraseAtPoint,
  onUndo,
  onRedo,
  onChangeStage,
}) => {
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [checkerOverride, setCheckerOverride] = useState<
    'auto' | 'light' | 'dark'
  >('auto');
  const [splitPercent, setSplitPercent] = useState(50);
  const [showNodesInWireframe, setShowNodesInWireframe] = useState(true);
  const [showShimmer, setShowShimmer] = useState(false);
  const [hoverImgCoords, setHoverImgCoords] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [clickRipple, setClickRipple] = useState<{
    x: number;
    y: number;
    key: number;
  } | null>(null);

  const viewStateRef = useRef<{ zoom: number; pan: { x: number; y: number } }>({
    zoom: 1,
    pan: { x: 0, y: 0 },
  });
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const pointerDownClientRef = useRef<{ x: number; y: number } | null>(null);
  const movedDuringPointerRef = useRef<boolean>(false);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const smoothedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const quantizedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const shimmerStartRef = useRef<number>(0);

  useEffect(() => {
    viewStateRef.current = { zoom, pan };
  }, [zoom, pan]);

  // Zoom tại đúng vị trí con trỏ chuột (Zoom-to-Cursor)
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const { zoom: oldZoom, pan: oldPan } = viewStateRef.current;
      const intensity = e.ctrlKey ? 0.012 : 0.0018;
      const rawStep = -e.deltaY * intensity;
      const factor =
        Math.abs(e.deltaY) >= 40 && !e.ctrlKey
          ? e.deltaY < 0
            ? 1.18
            : 1 / 1.18
          : Math.exp(Math.max(-0.35, Math.min(0.35, rawStep)));

      const newZoom = Math.max(
        0.25,
        Math.min(16, +(oldZoom * factor).toFixed(3))
      );
      if (newZoom === oldZoom) return;

      const cx = rect.left + rect.width * 0.5;
      const cy = rect.top + rect.height * 0.5;
      const mx = e.clientX - cx;
      const my = e.clientY - cy;

      const scaleRatio = newZoom / oldZoom;
      const newPan = {
        x: mx - (mx - oldPan.x) * scaleRatio,
        y: my - (my - oldPan.y) * scaleRatio,
      };

      viewStateRef.current = { zoom: newZoom, pan: newPan };
      setZoom(newZoom);
      setPan(newPan);
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  // Duy trì hiệu ứng óng ánh (Shimmer) tối thiểu 420ms
  useEffect(() => {
    if (isProcessing) {
      shimmerStartRef.current = performance.now();
      setShowShimmer(true);
      return;
    }
    const elapsed = performance.now() - shimmerStartRef.current;
    const minDuration = 420;
    const remaining = Math.max(0, minDuration - elapsed);
    const timer = window.setTimeout(() => {
      setShowShimmer(false);
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [isProcessing, processingKey]);

  const useLightChecker =
    checkerOverride === 'auto' ? !isDarkTheme : checkerOverride === 'light';

  useEffect(() => {
    if (!result) return;

    if (smoothedCanvasRef.current) {
      const c = smoothedCanvasRef.current;
      c.width = result.width;
      c.height = result.height;
      const ctx = c.getContext('2d');
      if (ctx) {
        const imgData = new ImageData(
          new Uint8ClampedArray(result.smoothedBuffer),
          result.width,
          result.height
        );
        ctx.putImageData(imgData, 0, 0);
      }
    }

    if (quantizedCanvasRef.current) {
      const c = quantizedCanvasRef.current;
      c.width = result.width;
      c.height = result.height;
      const ctx = c.getContext('2d');
      if (ctx) {
        const imgData = new ImageData(
          new Uint8ClampedArray(result.quantizedBuffer),
          result.width,
          result.height
        );
        ctx.putImageData(imgData, 0, 0);
      }
    }
  }, [result, viewStage]);

  const w = result?.width || 520;
  const h = result?.height || 520;

  const clientToImageCoords = (
    clientX: number,
    clientY: number
  ): { x: number; y: number } | null => {
    const box = splitContainerRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0 || box.height <= 0) return null;
    const ix = Math.floor(((clientX - box.left) / box.width) * w);
    const iy = Math.floor(((clientY - box.top) / box.height) * h);
    if (ix < 0 || ix >= w || iy < 0 || iy >= h) return null;
    return { x: ix, y: iy };
  };

  const handleResetView = () => {
    const initial = { zoom: 1, pan: { x: 0, y: 0 } };
    viewStateRef.current = initial;
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleStepZoom = (factor: number) => {
    const { zoom: oldZoom, pan: oldPan } = viewStateRef.current;
    const newZoom = Math.max(0.25, Math.min(16, +(oldZoom * factor).toFixed(2)));
    if (newZoom === oldZoom) return;
    const scaleRatio = newZoom / oldZoom;
    const newPan = {
      x: oldPan.x * scaleRatio,
      y: oldPan.y * scaleRatio,
    };
    viewStateRef.current = { zoom: newZoom, pan: newPan };
    setZoom(newZoom);
    setPan(newPan);
  };

  const handleViewportPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (
      target.closest(
        '[data-split-handle="true"], [data-floating-bar="true"], button, input, label'
      )
    ) {
      return;
    }

    pointerDownClientRef.current = { x: e.clientX, y: e.clientY };
    movedDuringPointerRef.current = false;
    panStartRef.current = {
      x: e.clientX - viewStateRef.current.pan.x,
      y: e.clientY - viewStateRef.current.pan.y,
    };
    if (!isEraserMode) {
      setIsPanning(true);
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleViewportPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isEraserMode) {
      setHoverImgCoords(clientToImageCoords(e.clientX, e.clientY));
    }

    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;

    if (pointerDownClientRef.current) {
      const dist = Math.hypot(
        e.clientX - pointerDownClientRef.current.x,
        e.clientY - pointerDownClientRef.current.y
      );
      if (dist >= 5) {
        movedDuringPointerRef.current = true;
        if (!isPanning) setIsPanning(true);
      }
    }

    if (!isEraserMode || movedDuringPointerRef.current) {
      const nextPan = {
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y,
      };
      viewStateRef.current = { zoom: viewStateRef.current.zoom, pan: nextPan };
      setPan(nextPan);
    }
  };

  const handleViewportPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const wasMoved = movedDuringPointerRef.current;
    const downPos = pointerDownClientRef.current;
    pointerDownClientRef.current = null;
    movedDuringPointerRef.current = false;
    setIsPanning(false);

    if (isEraserMode && !wasMoved && downPos) {
      const coords = clientToImageCoords(e.clientX, e.clientY);
      if (coords) {
        setClickRipple({ x: coords.x, y: coords.y, key: Date.now() });
        if (viewStage === 'original') {
          onChangeStage('split');
        }
        onEraseAtPoint(coords.x, coords.y);
      }
    }
  };

  const updateSplitFromClientX = (clientX: number) => {
    const box = splitContainerRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return;
    const rel = ((clientX - box.left) / box.width) * 100;
    setSplitPercent(Math.max(0, Math.min(100, rel)));
  };

  const handleSplitHandlePointerDown = (
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    updateSplitFromClientX(e.clientX);
  };

  const handleSplitHandlePointerMove = (
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.stopPropagation();
    updateSplitFromClientX(e.clientX);
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full bg-slate-100 dark:bg-slate-950 transition-colors">
      {/* Thanh công cụ & chọn bước tinh gọn */}
      <div className="px-3 py-1.5 bg-white dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 flex-wrap transition-colors">
        <div className="flex items-center gap-1 overflow-x-auto py-0.5">
          {STAGE_TABS.map((tab) => {
            const active = viewStage === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onChangeStage(tab.id)}
                title={tab.tip}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition shrink-0 cursor-pointer ${
                  active
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/80'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Công cụ Xóa nền, Nền Caro & Zoom */}
        <div className="flex items-center gap-1.5 shrink-0">
          {viewStage === 'wireframe' && (
            <label className="flex items-center gap-1 text-xs text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800/80 px-2 py-1 rounded-md cursor-pointer">
              <input
                type="checkbox"
                checked={showNodesInWireframe}
                onChange={(e) => setShowNodesInWireframe(e.target.checked)}
                className="accent-indigo-600 dark:accent-indigo-500"
              />
              <span>Nodes</span>
            </label>
          )}

          {/* Nút Bỏ Nền Tự Động */}
          <button
            type="button"
            onClick={onToggleRemoveBackground}
            title="Tự động tách bỏ màu nền bên ngoài mà vẫn giữ nguyên 100% màu bên trong nhân vật"
            className={`px-2.5 py-1 rounded-md transition flex items-center gap-1 text-xs font-medium cursor-pointer border ${
              removeBackground
                ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm'
                : 'bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-slate-200/80 dark:border-slate-700/80 hover:text-slate-950 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <Eraser
              className={`w-3.5 h-3.5 ${
                removeBackground
                  ? 'text-white'
                  : 'text-emerald-600 dark:text-emerald-400'
              }`}
            />
            <span>{removeBackground ? 'Đã Bỏ Nền' : 'Bỏ Nền Tự Động'}</span>
          </button>

          {/* Nút Xóa Vùng Chủ Động (Click chuột) */}
          <button
            type="button"
            onClick={onToggleEraserMode}
            title="Xóa vùng chủ động (Phím E): Đổi con trỏ sang tâm ngắm — Click vào đâu trên ảnh sẽ xóa mảng màu tại đó"
            className={`px-2.5 py-1 rounded-md transition flex items-center gap-1 text-xs font-medium cursor-pointer border ${
              isEraserMode
                ? 'bg-rose-600 text-white border-rose-500 shadow-sm ring-2 ring-rose-400/40'
                : 'bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-slate-200/80 dark:border-slate-700/80 hover:text-slate-950 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <MousePointerClick
              className={`w-3.5 h-3.5 ${
                isEraserMode
                  ? 'text-white'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            />
            <span>Xóa Chủ Động</span>
            {manualEraseCount > 0 && (
              <span
                className={`text-[10px] font-mono px-1 rounded ${
                  isEraserMode
                    ? 'bg-rose-800 text-white'
                    : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                }`}
              >
                {manualEraseCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() =>
              setCheckerOverride((prev) =>
                prev === 'auto'
                  ? useLightChecker
                    ? 'dark'
                    : 'light'
                  : prev === 'light'
                  ? 'dark'
                  : 'light'
              )
            }
            title="Đổi màu nền lưới Caro (Sáng/Tối)"
            className="p-1.5 rounded-md bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700 transition cursor-pointer"
          >
            <Grid className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
          </button>

          <div className="flex items-center bg-slate-100 dark:bg-slate-800/80 rounded-md px-1">
            <button
              type="button"
              onClick={() => handleStepZoom(1 / 1.25)}
              className="p-1 text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white cursor-pointer"
              title="Thu nhỏ"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span
              onClick={handleResetView}
              title="Bấm để về 100% (Lăn chuột để Zoom tại vị trí con trỏ)"
              className="text-xs font-mono text-slate-800 dark:text-slate-200 px-1.5 min-w-[46px] text-center cursor-pointer"
            >
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => handleStepZoom(1.25)}
              className="p-1 text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white cursor-pointer"
              title="Phóng to"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleResetView}
            title="Căn giữa khung hình (100%)"
            className="p-1.5 rounded-md bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700 transition cursor-pointer"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Vùng hiển thị chính */}
      <div
        ref={viewportRef}
        onPointerDown={handleViewportPointerDown}
        onPointerMove={handleViewportPointerMove}
        onPointerUp={handleViewportPointerUp}
        onPointerCancel={handleViewportPointerUp}
        onPointerLeave={() => setHoverImgCoords(null)}
        className={`flex-1 relative overflow-hidden flex items-center justify-center no-select-drag ${
          useLightChecker ? 'checkerboard-light' : 'checkerboard'
        } ${
          isPanning
            ? 'cursor-grabbing'
            : isEraserMode
            ? 'cursor-crosshair'
            : 'cursor-grab'
        }`}
      >
        {/* Thanh điều khiển nổi khi bật Chế độ Xóa Chủ Động */}
        {isEraserMode && (
          <div
            data-floating-bar="true"
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute top-3 left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 rounded-full bg-slate-900/90 dark:bg-slate-900/95 text-white border border-rose-500/50 shadow-xl backdrop-blur-md flex items-center gap-3 text-xs"
          >
            <span className="flex items-center gap-1.5 font-semibold text-rose-300">
              <MousePointerClick className="w-3.5 h-3.5 text-rose-400" />
              <span>Click vào vùng ảnh để xóa</span>
              {hoverImgCoords && (
                <span className="font-mono text-[10px] text-slate-300 bg-slate-800 px-1.5 py-0.2 rounded">
                  ({hoverImgCoords.x}, {hoverImgCoords.y})
                </span>
              )}
            </span>

            <div className="h-3.5 w-px bg-slate-700" />

            <label className="flex items-center gap-1.5 text-[11px] text-slate-200">
              <span>Độ lan:</span>
              <input
                type="range"
                min={0}
                max={65}
                step={1}
                value={manualEraseTolerance}
                onChange={(e) =>
                  onChangeManualEraseTolerance(Number(e.target.value))
                }
                className="w-20 accent-rose-500 cursor-pointer"
              />
              <span className="font-mono text-rose-300 w-5 text-right">
                {manualEraseTolerance}
              </span>
            </label>

            <div className="h-3.5 w-px bg-slate-700" />

            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={!canUndo}
                onClick={onUndo}
                title="Hoàn tác bước vừa xóa (Ctrl+Z / Cmd+Z)"
                className="p-1 rounded hover:bg-slate-800 disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={!canRedo}
                onClick={onRedo}
                title="Làm lại (Ctrl+Y / Cmd+Shift+Z)"
                className="p-1 rounded hover:bg-slate-800 disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed"
              >
                <Redo2 className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              type="button"
              onClick={onToggleEraserMode}
              title="Thoát chế độ xóa chủ động (Esc)"
              className="p-1 rounded-full bg-rose-600/80 hover:bg-rose-500 text-white transition cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {result && (
          <div
            ref={splitContainerRef}
            style={{
              width: w,
              height: h,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
            }}
            className={`relative shadow-2xl rounded-sm overflow-hidden ${
              isEraserMode
                ? 'ring-2 ring-rose-500/80'
                : 'ring-1 ring-slate-900/10 dark:ring-white/15'
            }`}
          >
            {/* 1. Chế độ So sánh Trực tiếp (Split Before/After) */}
            {viewStage === 'split' && (
              <>
                <svg
                  viewBox={`0 0 ${w} ${h}`}
                  width={w}
                  height={h}
                  className="block w-full h-full"
                  shapeRendering="geometricPrecision"
                >
                  {result.paths.map((p) =>
                    p.isStroke ? (
                      <path
                        key={p.colorId}
                        fill="none"
                        stroke={p.hex}
                        strokeWidth={p.strokeWidth ?? 2.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d={p.d}
                      />
                    ) : (
                      <path
                        key={p.colorId}
                        fill={p.hex}
                        stroke={result.paths.length > 16 ? p.hex : undefined}
                        strokeWidth={result.paths.length > 16 ? 0.85 : undefined}
                        strokeLinejoin={
                          result.paths.length > 16 ? 'round' : undefined
                        }
                        strokeLinecap={
                          result.paths.length > 16 ? 'round' : undefined
                        }
                        fillRule="evenodd"
                        d={p.d}
                      />
                    )
                  )}
                </svg>

                {originalDataUrl && (
                  <div
                    style={{
                      clipPath: `inset(0 ${100 - splitPercent}% 0 0)`,
                    }}
                    className="absolute inset-0 pointer-events-none"
                  >
                    <img
                      src={originalDataUrl}
                      alt="Original Raster"
                      className="w-full h-full object-contain block"
                      style={{
                        imageRendering: zoom > 2 ? 'pixelated' : 'auto',
                      }}
                    />
                  </div>
                )}

                <div
                  data-split-handle="true"
                  onPointerDown={handleSplitHandlePointerDown}
                  onPointerMove={handleSplitHandlePointerMove}
                  style={{ left: `${splitPercent}%` }}
                  className="absolute top-0 bottom-0 z-20 -ml-4 w-8 flex items-center justify-center cursor-ew-resize no-select-drag group"
                >
                  <div className="w-0.5 h-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.9)]" />
                  <div className="absolute w-7 h-7 rounded-full bg-indigo-600 border-2 border-white shadow-lg flex items-center justify-center text-white group-hover:scale-110 transition">
                    <MoveHorizontal className="w-3.5 h-3.5" />
                  </div>
                </div>

                <div className="absolute top-2 left-2 z-20 px-2 py-0.5 rounded bg-slate-900/80 text-[10px] font-semibold text-white border border-white/10 pointer-events-none">
                  ẢNH GỐC
                </div>
                <div className="absolute top-2 right-2 z-20 px-2 py-0.5 rounded bg-indigo-950/85 text-[10px] font-semibold text-indigo-100 border border-indigo-400/30 pointer-events-none">
                  SVG ({result.stats.totalPaths} lớp)
                </div>
              </>
            )}

            {/* 2. Chế độ Ảnh Gốc (Original) */}
            {viewStage === 'original' && originalDataUrl && (
              <img
                src={originalDataUrl}
                alt="Original"
                className="w-full h-full object-contain block"
                style={{ imageRendering: zoom > 2 ? 'pixelated' : 'auto' }}
              />
            )}

            {/* 3. Chế độ Bước 1: Ảnh sau khi Làm phẳng giữ cạnh (Smoothed) */}
            <canvas
              ref={smoothedCanvasRef}
              className={`w-full h-full block ${
                viewStage === 'smoothed' ? 'block' : 'hidden'
              }`}
              style={{ imageRendering: zoom > 2 ? 'pixelated' : 'auto' }}
            />

            {/* 4. Chế độ Bước 2+3: Ảnh sau khi Phân cụm màu & Lọc đốm (Quantized) */}
            <canvas
              ref={quantizedCanvasRef}
              className={`w-full h-full block ${
                viewStage === 'quantized' ? 'block' : 'hidden'
              }`}
              style={{ imageRendering: zoom > 2 ? 'pixelated' : 'auto' }}
            />

            {/* 5. Chế độ Kết quả Vector SVG */}
            {viewStage === 'svg' && (
              <svg
                viewBox={`0 0 ${w} ${h}`}
                width={w}
                height={h}
                className="block w-full h-full"
                shapeRendering="geometricPrecision"
              >
                {result.paths.map((p) =>
                  p.isStroke ? (
                    <path
                      key={p.colorId}
                      fill="none"
                      stroke={p.hex}
                      strokeWidth={p.strokeWidth ?? 2.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d={p.d}
                    />
                  ) : (
                    <path
                      key={p.colorId}
                      fill={p.hex}
                      stroke={result.paths.length > 16 ? p.hex : undefined}
                      strokeWidth={result.paths.length > 16 ? 0.85 : undefined}
                      strokeLinejoin={
                        result.paths.length > 16 ? 'round' : undefined
                      }
                      strokeLinecap={
                        result.paths.length > 16 ? 'round' : undefined
                      }
                      fillRule="evenodd"
                      d={p.d}
                    />
                  )
                )}
              </svg>
            )}

            {/* 6. Chế độ Khung Dây & Điểm Neo (Wireframe) */}
            {viewStage === 'wireframe' && (
              <svg
                viewBox={`0 0 ${w} ${h}`}
                width={w}
                height={h}
                className="block w-full h-full bg-slate-950"
                shapeRendering="geometricPrecision"
              >
                {result.paths.map((p) => (
                  <g key={p.colorId}>
                    {p.isStroke ? (
                      <>
                        <path
                          fill="none"
                          stroke="#38BDF8"
                          strokeOpacity={0.22}
                          strokeWidth={p.strokeWidth ?? 2.5}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d={p.d}
                        />
                        <path
                          fill="none"
                          stroke="#38BDF8"
                          strokeWidth={Math.max(0.8, 1.5 / zoom)}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d={p.d}
                        />
                      </>
                    ) : (
                      <path
                        fill={p.hex}
                        fillOpacity={0.14}
                        stroke={
                          p.hex === '#121826' || p.hex === '#161B22'
                            ? '#38BDF8'
                            : p.hex
                        }
                        strokeWidth={Math.max(0.6, 1.2 / zoom)}
                        fillRule="evenodd"
                        d={p.d}
                      />
                    )}
                    {showNodesInWireframe &&
                      p.anchors.map((pt, idx) =>
                        pt.isCorner ? (
                          <rect
                            key={idx}
                            x={pt.x - 2.2 / zoom}
                            y={pt.y - 2.2 / zoom}
                            width={4.4 / zoom}
                            height={4.4 / zoom}
                            fill="#F59E0B"
                            stroke="#0F172A"
                            strokeWidth={0.6 / zoom}
                          />
                        ) : (
                          <circle
                            key={idx}
                            cx={pt.x}
                            cy={pt.y}
                            r={2.0 / zoom}
                            fill="#10B981"
                            stroke="#0F172A"
                            strokeWidth={0.5 / zoom}
                          />
                        )
                      )}
                  </g>
                ))}
              </svg>
            )}

            {/* Tâm ngắm trực quan & hiệu ứng vòng sóng khi Click Xóa Vùng Chủ Động */}
            {isEraserMode && hoverImgCoords && (
              <div
                style={{
                  left: hoverImgCoords.x,
                  top: hoverImgCoords.y,
                  transform: `translate(-50%, -50%) scale(${1 / zoom})`,
                }}
                className="absolute z-30 pointer-events-none w-6 h-6 rounded-full border-2 border-rose-500 bg-rose-500/15 shadow-[0_0_10px_rgba(244,63,94,0.8)] flex items-center justify-center"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
              </div>
            )}

            {clickRipple && (
              <div
                key={clickRipple.key}
                style={{
                  left: clickRipple.x,
                  top: clickRipple.y,
                  transform: `translate(-50%, -50%) scale(${1 / zoom})`,
                }}
                className="absolute z-30 pointer-events-none w-8 h-8 rounded-full border-2 border-rose-400 animate-ping"
              />
            )}

            {/* Lớp phủ hiệu ứng óng ánh (Shimmer Overlay) */}
            {viewStage !== 'original' && (
              <div
                aria-hidden={!showShimmer}
                style={{
                  clipPath:
                    viewStage === 'split'
                      ? `inset(0 0 0 ${splitPercent}%)`
                      : undefined,
                }}
                className={`absolute inset-0 z-10 pointer-events-none overflow-hidden transition-opacity duration-300 ${
                  showShimmer ? 'opacity-100' : 'opacity-0'
                }`}
              >
                <div className="absolute inset-0 backdrop-blur-[5px] bg-slate-950/15 dark:bg-slate-950/30" />
                <div className="absolute -inset-1/3 ai-aurora-layer mix-blend-screen" />
                <div className="absolute -inset-full ai-shimmer-beam" />
                <div className="absolute inset-0 ring-1 ring-inset ring-white/35 dark:ring-indigo-300/30" />
              </div>
            )}
          </div>
        )}

        {/* Huy hiệu trạng thái nổi khi đang kiến tạo Vector */}
        {viewStage !== 'original' && (
          <div
            aria-live="polite"
            className={`absolute top-4 right-4 z-30 pointer-events-none transition-all duration-300 ${
              showShimmer
                ? 'opacity-100 translate-y-0 scale-100'
                : 'opacity-0 -translate-y-2 scale-95'
            }`}
          >
            <div className="px-3 py-1.5 rounded-full bg-slate-900/85 dark:bg-slate-900/90 backdrop-blur-md border border-indigo-400/40 shadow-[0_0_25px_rgba(99,102,241,0.45)] flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-fuchsia-400 ai-sparkle-icon shrink-0" />
              <span className="text-xs font-semibold bg-gradient-to-r from-indigo-200 via-fuchsia-200 to-sky-200 bg-clip-text text-transparent">
                Đang kiến tạo Vector SVG...
              </span>
            </div>
          </div>
        )}

        {/* Chú thích gọn gàng cho chế độ Wireframe */}
        {viewStage === 'wireframe' && (
          <div className="absolute bottom-3 left-4 bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700/80 rounded-lg px-2.5 py-1.5 text-[11px] flex items-center gap-3 shadow-lg">
            <span className="flex items-center gap-1 text-slate-800 dark:text-slate-200">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
              Smooth Node
            </span>
            <span className="flex items-center gap-1 text-slate-800 dark:text-slate-200">
              <span className="w-2 h-2 bg-amber-500 inline-block" />
              Corner Node
            </span>
            <span className="flex items-center gap-1 text-slate-800 dark:text-slate-200">
              <span className="w-3 h-0.5 bg-sky-400 inline-block" />
              1-Line Spine
            </span>
            <InfoTooltip
              side="top"
              title="Chú thích Khung Dây (Wireframe)"
              content="Chấm tròn xanh là điểm uốn cong mượt Bézier. Ô vuông vàng là đỉnh góc nhọn. Đường xanh dương là trục tâm của nét đơn Centerline."
            />
          </div>
        )}
      </div>
    </div>
  );
};
