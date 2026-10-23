import React, { useEffect, useRef, useState } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Grid,
  MoveHorizontal,
  Sparkles,
  Eraser,
} from 'lucide-react';
import { PipelineResult, ViewStage } from '../types/vectorizer';

interface ViewportCanvasProps {
  originalDataUrl: string | null;
  result: PipelineResult | null;
  viewStage: ViewStage;
  isDarkTheme: boolean;
  isProcessing: boolean;
  processingKey: number;
  removeBackground: boolean;
  onToggleRemoveBackground: () => void;
  onChangeStage: (stage: ViewStage) => void;
}

const STAGE_TABS: { id: ViewStage; label: string; badge?: string }[] = [
  { id: 'split', label: 'So Sánh Trực Tiếp', badge: 'Before / After' },
  { id: 'original', label: 'Ảnh Gốc', badge: 'Raster' },
  { id: 'smoothed', label: 'B1: Làm Phẳng', badge: 'Bilateral' },
  { id: 'quantized', label: 'B2+3: Gom Màu & Lọc Đốm', badge: 'K-Means' },
  { id: 'svg', label: 'B4+5: Kết Quả SVG', badge: 'Vector' },
  { id: 'wireframe', label: 'Khung Dây & Điểm Neo', badge: 'Nodes' },
];

export const ViewportCanvas: React.FC<ViewportCanvasProps> = ({
  originalDataUrl,
  result,
  viewStage,
  isDarkTheme,
  isProcessing,
  processingKey,
  removeBackground,
  onToggleRemoveBackground,
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

  const viewStateRef = useRef<{ zoom: number; pan: { x: number; y: number } }>({
    zoom: 1,
    pan: { x: 0, y: 0 },
  });
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const smoothedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const quantizedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const shimmerStartRef = useRef<number>(0);

  // Đồng bộ viewStateRef khi state zoom/pan thay đổi
  useEffect(() => {
    viewStateRef.current = { zoom, pan };
  }, [zoom, pan]);

  // Xử lý lăn chuột / Pinch-to-zoom tại đúng vị trí con trỏ chuột (Zoom-to-Cursor)
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const { zoom: oldZoom, pan: oldPan } = viewStateRef.current;
      // Hệ số phóng mượt mà theo biên độ lăn chuột hoặc cử chỉ Trackpad
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

      // Tọa độ chuột tính từ tâm khung nhìn (do splitContainerRef có transformOrigin: 'center center' và căn giữa)
      const cx = rect.left + rect.width * 0.5;
      const cy = rect.top + rect.height * 0.5;
      const mx = e.clientX - cx;
      const my = e.clientY - cy;

      // Giữ điểm ảnh ngay dưới mũi tên chuột đứng yên tại (mx, my) sau khi đổi tỷ lệ zoom
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

  // Duy trì hiệu ứng óng ánh (ChatGPT / Gemini Shimmer) suốt thời gian Worker đang chạy
  // và tối thiểu 420ms để mắt người luôn cảm nhận được luồng ánh sáng quét qua mượt mà
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
    if (target.closest('[data-split-handle="true"], button, input')) return;

    setIsPanning(true);
    panStartRef.current = {
      x: e.clientX - viewStateRef.current.pan.x,
      y: e.clientY - viewStateRef.current.pan.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleViewportPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanning || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const nextPan = {
      x: e.clientX - panStartRef.current.x,
      y: e.clientY - panStartRef.current.y,
    };
    viewStateRef.current = { zoom: viewStateRef.current.zoom, pan: nextPan };
    setPan(nextPan);
  };

  const handleViewportPointerUp = () => {
    setIsPanning(false);
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

  const w = result?.width || 520;
  const h = result?.height || 520;

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full bg-slate-100 dark:bg-slate-950 transition-colors">
      {/* Thanh chọn bước trực quan */}
      <div className="px-4 py-2 bg-white dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 flex-wrap transition-colors">
        <div className="flex items-center gap-1 overflow-x-auto py-0.5">
          {STAGE_TABS.map((tab) => {
            const active = viewStage === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onChangeStage(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition shrink-0 ${
                  active
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/80'
                }`}
              >
                <span>{tab.label}</span>
                {tab.badge && (
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                      active
                        ? 'bg-indigo-800/80 text-indigo-100'
                        : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Công cụ Zoom & Nền Checkerboard */}
        <div className="flex items-center gap-1.5 shrink-0">
          {viewStage === 'wireframe' && (
            <label className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800/80 px-2.5 py-1 rounded-md cursor-pointer mr-1">
              <input
                type="checkbox"
                checked={showNodesInWireframe}
                onChange={(e) => setShowNodesInWireframe(e.target.checked)}
                className="accent-indigo-600 dark:accent-indigo-500"
              />
              Hiện điểm neo (Nodes)
            </label>
          )}

          <button
            type="button"
            onClick={onToggleRemoveBackground}
            title="Tự động bỏ màu nền (Background) mà không ảnh hưởng tới các chi tiết SVG bên trong"
            className={`px-2.5 py-1.5 rounded-md transition flex items-center gap-1.5 text-xs font-medium cursor-pointer border ${
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
            <span>{removeBackground ? 'Đã Bỏ Nền' : 'Bỏ Màu Nền'}</span>
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
            title="Đổi màu nền lưới Caro (Sáng/Tối) để kiểm tra vùng trong suốt"
            className="px-2 py-1.5 rounded-md bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700 transition flex items-center gap-1 text-xs"
          >
            <Grid className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            <span className="hidden sm:inline">Nền Caro</span>
          </button>

          <div className="flex items-center bg-slate-100 dark:bg-slate-800/80 rounded-md px-1">
            <button
              type="button"
              onClick={() => handleStepZoom(1 / 1.25)}
              className="p-1 text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white"
              title="Thu nhỏ"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs font-mono text-slate-800 dark:text-slate-200 px-2 min-w-[52px] text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => handleStepZoom(1.25)}
              className="p-1 text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white"
              title="Phóng to (Tối đa 1600%)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleResetView}
            title="Căn giữa khung hình (100%)"
            className="p-1.5 rounded-md bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700 transition"
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
        className={`flex-1 relative overflow-hidden flex items-center justify-center no-select-drag ${
          useLightChecker ? 'checkerboard-light' : 'checkerboard'
        } ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
      >
        {result && (
          <div
            ref={splitContainerRef}
            style={{
              width: w,
              height: h,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
            }}
            className="relative shadow-2xl ring-1 ring-slate-900/10 dark:ring-white/15 rounded-sm overflow-hidden"
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

                <div className="absolute top-2.5 left-2.5 z-20 px-2 py-0.5 rounded bg-slate-900/85 text-[10px] font-semibold text-white border border-white/10 pointer-events-none">
                  ẢNH GỐC (PIXEL)
                </div>
                <div className="absolute top-2.5 right-2.5 z-20 px-2 py-0.5 rounded bg-indigo-950/90 text-[10px] font-semibold text-indigo-100 border border-indigo-400/30 pointer-events-none">
                  VECTOR SVG ({result.stats.totalPaths} lớp)
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

            {/* 6. Chế độ Khung Dây & Điểm Neo (Wireframe + Bézier Anchor Points) */}
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
                        {/* Bóng mờ độ dày nét thực tế */}
                        <path
                          fill="none"
                          stroke="#38BDF8"
                          strokeOpacity={0.22}
                          strokeWidth={p.strokeWidth ?? 2.5}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d={p.d}
                        />
                        {/* Đường tâm Nét Đơn (Centerline 1-line spine) */}
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

            {/* Lớp phủ hiệu ứng óng ánh đa sắc (ChatGPT / Gemini Shimmer Overlay) khi đang tái tạo Vector SVG */}
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
                {/* Lớp kính mờ nhẹ + cực quang đa sắc (Aurora Mesh) */}
                <div className="absolute inset-0 backdrop-blur-[5px] bg-slate-950/15 dark:bg-slate-950/30" />
                <div className="absolute -inset-1/3 ai-aurora-layer mix-blend-screen" />

                {/* Luồng sáng ngọc trai quét chéo liên tục (Diagonal Specular Shimmer Sweep) */}
                <div className="absolute -inset-full ai-shimmer-beam" />

                {/* Viền sáng lấp lánh bao quanh vùng Vector */}
                <div className="absolute inset-0 ring-1 ring-inset ring-white/35 dark:ring-indigo-300/30" />
              </div>
            )}
          </div>
        )}

        {/* Huy hiệu trạng thái nổi kiểu Gemini / ChatGPT khi đang kiến tạo Vector */}
        {viewStage !== 'original' && (
          <div
            aria-live="polite"
            className={`absolute top-4 right-4 z-30 pointer-events-none transition-all duration-300 ${
              showShimmer
                ? 'opacity-100 translate-y-0 scale-100'
                : 'opacity-0 -translate-y-2 scale-95'
            }`}
          >
            <div className="px-3.5 py-2 rounded-full bg-slate-900/85 dark:bg-slate-900/90 backdrop-blur-md border border-indigo-400/40 shadow-[0_0_25px_rgba(99,102,241,0.45)] flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-fuchsia-400 ai-sparkle-icon shrink-0" />
              <span className="text-xs font-semibold bg-gradient-to-r from-indigo-200 via-fuchsia-200 to-sky-200 bg-clip-text text-transparent">
                Đang kiến tạo Vector SVG...
              </span>
            </div>
          </div>
        )}

        {/* Chú thích nổi cho chế độ Wireframe */}
        {viewStage === 'wireframe' && (
          <div className="absolute bottom-3 left-4 bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700/80 rounded-lg px-3 py-2 text-xs flex items-center gap-4 shadow-lg pointer-events-none flex-wrap">
            <span className="flex items-center gap-1.5 text-slate-800 dark:text-slate-200">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block border border-slate-950" />
              Điểm uốn cong Bézier (Smooth Node)
            </span>
            <span className="flex items-center gap-1.5 text-slate-800 dark:text-slate-200">
              <span className="w-2.5 h-2.5 bg-amber-500 inline-block border border-slate-950" />
              Đỉnh góc nhọn / Đầu mút (Corner Node)
            </span>
            <span className="flex items-center gap-1.5 text-slate-800 dark:text-slate-200">
              <span className="w-4 h-0.5 bg-sky-400 inline-block" />
              Đường tâm Nét Đơn (Centerline Stroke)
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
