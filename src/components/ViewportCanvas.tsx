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
  History,
  X,
} from 'lucide-react';
import { PipelineResult, ViewStage } from '../types/vectorizer';
import { InfoTooltip } from './InfoTooltip';
import { OpticalGlass } from './OpticalGlass';
import { getSeamStrokeWidth } from '../engine/svgBuilder';

interface ViewportCanvasProps {
  originalDataUrl: string | null;
  result: PipelineResult | null;
  /** Chế độ đầu ra "Nhúng ảnh gốc": ảnh hiển thị ở khung SVG thay cho các lớp vector */
  embeddedImageUrl?: string | null;
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
  historyIndex: number;
  historyCount: number;
  showHistoryPopup: boolean;
  onToggleHistoryPopup: () => void;
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
  embeddedImageUrl,
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
  historyIndex,
  historyCount,
  showHistoryPopup,
  onToggleHistoryPopup,
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
  const [loupeState, setLoupeState] = useState<{
    clientX: number;
    clientY: number;
    imgX: number;
    imgY: number;
  } | null>(null);
  const [clickRipple, setClickRipple] = useState<{
    x: number;
    y: number;
    key: number;
  } | null>(null);
  const [viewportSize, setViewportSize] = useState<{ w: number; h: number }>({
    w: 800,
    h: 600,
  });

  const viewStateRef = useRef<{ zoom: number; pan: { x: number; y: number } }>({
    zoom: 1,
    pan: { x: 0, y: 0 },
  });
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const pointerDownClientRef = useRef<{ x: number; y: number } | null>(null);
  const movedDuringPointerRef = useRef<boolean>(false);
  const activePointerIdRef = useRef<number | null>(null);
  const wasMultiTouchRef = useRef<boolean>(false);
  const loupeHoldTimerRef = useRef<number | null>(null);
  const isLoupeHoldingRef = useRef<boolean>(false);
  const erasePointerActiveOnImageRef = useRef<boolean>(false);
  const lastTapRef = useRef<{ time: number; x: number; y: number }>({
    time: 0,
    x: 0,
    y: 0,
  });
  const pinchStateRef = useRef<{
    dist: number;
    zoom: number;
    pan: { x: number; y: number };
    midX: number;
    midY: number;
  } | null>(null);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const smoothedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const quantizedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const shimmerStartRef = useRef<number>(0);

  const clearLoupeHoldTimer = () => {
    if (loupeHoldTimerRef.current !== null) {
      window.clearTimeout(loupeHoldTimerRef.current);
      loupeHoldTimerRef.current = null;
    }
  };

  useEffect(() => {
    if (!isEraserMode) {
      clearLoupeHoldTimer();
      isLoupeHoldingRef.current = false;
      erasePointerActiveOnImageRef.current = false;
      setLoupeState(null);
    }
    return () => clearLoupeHoldTimer();
  }, [isEraserMode]);

  useEffect(() => {
    viewStateRef.current = { zoom, pan };
  }, [zoom, pan]);

  // Đo kích thước thực tế của vùng chứa (Viewport) để tự động co khung ảnh vừa màn hình Mobile/Tablet
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setViewportSize({ w: rect.width, h: rect.height });
      }
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Zoom tại đúng vị trí con trỏ chuột (Zoom-to-Cursor) & Cảm ứng đa điểm (Pinch-to-Zoom + 2-Finger Pan)
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

    const startPinchFromTouches = (touches: TouchList) => {
      const t0 = touches[0];
      const t1 = touches[1];
      const dist = Math.hypot(
        t1.clientX - t0.clientX,
        t1.clientY - t0.clientY
      );
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width * 0.5;
      const cy = rect.top + rect.height * 0.5;
      pinchStateRef.current = {
        dist: Math.max(12, dist),
        zoom: viewStateRef.current.zoom,
        pan: { ...viewStateRef.current.pan },
        midX: (t0.clientX + t1.clientX) * 0.5 - cx,
        midY: (t0.clientY + t1.clientY) * 0.5 - cy,
      };
      wasMultiTouchRef.current = true;
      movedDuringPointerRef.current = true;
      clearLoupeHoldTimer();
      isLoupeHoldingRef.current = false;
      erasePointerActiveOnImageRef.current = false;
      setLoupeState(null);
      setIsPanning(false);
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        startPinchFromTouches(e.touches);
      } else if (e.touches.length === 1) {
        wasMultiTouchRef.current = false;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        e.preventDefault();
        if (!pinchStateRef.current) {
          startPinchFromTouches(e.touches);
          return;
        }
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const dist = Math.hypot(
          t1.clientX - t0.clientX,
          t1.clientY - t0.clientY
        );
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width * 0.5;
        const cy = rect.top + rect.height * 0.5;
        const curMidX = (t0.clientX + t1.clientX) * 0.5 - cx;
        const curMidY = (t0.clientY + t1.clientY) * 0.5 - cy;

        const {
          dist: startDist,
          zoom: startZoom,
          pan: startPan,
          midX: startMidX,
          midY: startMidY,
        } = pinchStateRef.current;

        const newZoom = Math.max(
          0.25,
          Math.min(16, +(startZoom * (dist / startDist)).toFixed(3))
        );
        const scaleRatio = newZoom / startZoom;
        const newPan = {
          x: curMidX - (startMidX - startPan.x) * scaleRatio,
          y: curMidY - (startMidY - startPan.y) * scaleRatio,
        };

        viewStateRef.current = { zoom: newZoom, pan: newPan };
        setZoom(newZoom);
        setPan(newPan);
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        pinchStateRef.current = null;
      }
      // Khi nhấc bớt 1 ngón tay (còn 1 ngón trên màn hình), cập nhật lại mốc panStart
      // để ngón còn lại kéo tiếp mượt mà không bị nhảy vị trí khung hình
      if (e.touches.length === 1) {
        const remaining = e.touches[0];
        panStartRef.current = {
          x: remaining.clientX - viewStateRef.current.pan.x,
          y: remaining.clientY - viewStateRef.current.pan.y,
        };
        movedDuringPointerRef.current = true;
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd);
    el.addEventListener('touchcancel', handleTouchEnd);
    return () => {
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchEnd);
    };
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
  // Tự động co khung hiển thị vừa khít cả màn hình Desktop lẫn Mobile nhỏ ở mức 100% zoom
  const availW = Math.max(180, viewportSize.w - 28);
  const availH = Math.max(180, viewportSize.h - 64);
  const displayScale = Math.min(
    1,
    1024 / Math.max(w, h),
    availW / w,
    availH / h
  );
  const displayW = Math.max(32, Math.round(w * displayScale));
  const displayH = Math.max(32, Math.round(h * displayScale));
  const seamWidth = result ? getSeamStrokeWidth(result.paths.length) : 0;

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
    if (e.button !== 0 || pinchStateRef.current) return;
    const target = e.target as HTMLElement;
    if (
      target.closest(
        '[data-split-handle="true"], [data-floating-bar="true"], button, input, label'
      )
    ) {
      return;
    }

    activePointerIdRef.current = e.pointerId;
    pointerDownClientRef.current = { x: e.clientX, y: e.clientY };
    movedDuringPointerRef.current = false;
    panStartRef.current = {
      x: e.clientX - viewStateRef.current.pan.x,
      y: e.clientY - viewStateRef.current.pan.y,
    };

    clearLoupeHoldTimer();
    isLoupeHoldingRef.current = false;

    if (isEraserMode) {
      const startCoords = clientToImageCoords(e.clientX, e.clientY);
      if (startCoords) {
        erasePointerActiveOnImageRef.current = true;
        setHoverImgCoords(startCoords);
        const downClientX = e.clientX;
        const downClientY = e.clientY;
        // Nhấn giữ ~140ms sẽ bật Kính Lúp phóng đại phía trên con trỏ/ngón tay
        loupeHoldTimerRef.current = window.setTimeout(() => {
          loupeHoldTimerRef.current = null;
          if (
            !wasMultiTouchRef.current &&
            !pinchStateRef.current &&
            erasePointerActiveOnImageRef.current
          ) {
            isLoupeHoldingRef.current = true;
            setLoupeState({
              clientX: downClientX,
              clientY: downClientY,
              imgX: startCoords.x,
              imgY: startCoords.y,
            });
          }
        }, 140);
      } else {
        erasePointerActiveOnImageRef.current = false;
      }
    } else {
      erasePointerActiveOnImageRef.current = false;
      setIsPanning(true);
    }

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore if pointer capture is unsupported
    }
  };

  const handleViewportPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pinchStateRef.current) return;
    const coords = isEraserMode
      ? clientToImageCoords(e.clientX, e.clientY)
      : null;

    if (isEraserMode && e.pointerType !== 'touch') {
      setHoverImgCoords(coords);
    }

    if (
      activePointerIdRef.current !== e.pointerId ||
      !e.currentTarget.hasPointerCapture(e.pointerId)
    ) {
      return;
    }

    // Khi đang ở chế độ Xóa Click và nhấn trên ảnh: giữ/di chuột sẽ điều khiển Kính Lúp để ngắm chính xác điểm xóa
    if (isEraserMode && erasePointerActiveOnImageRef.current) {
      setHoverImgCoords(coords);
      if (pointerDownClientRef.current) {
        const dist = Math.hypot(
          e.clientX - pointerDownClientRef.current.x,
          e.clientY - pointerDownClientRef.current.y
        );
        if (dist >= 4 && !isLoupeHoldingRef.current) {
          clearLoupeHoldTimer();
          isLoupeHoldingRef.current = true;
        }
      }
      if (isLoupeHoldingRef.current) {
        if (coords) {
          setLoupeState({
            clientX: e.clientX,
            clientY: e.clientY,
            imgX: coords.x,
            imgY: coords.y,
          });
        } else {
          setLoupeState(null);
        }
      }
      return;
    }

    if (pointerDownClientRef.current) {
      const dist = Math.hypot(
        e.clientX - pointerDownClientRef.current.x,
        e.clientY - pointerDownClientRef.current.y
      );
      const moveThreshold = e.pointerType === 'touch' ? 8 : 5;
      if (dist >= moveThreshold) {
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
    if (activePointerIdRef.current === e.pointerId) {
      activePointerIdRef.current = null;
    }
    clearLoupeHoldTimer();
    const wasLoupeActive = isLoupeHoldingRef.current;
    const wasEraseOnImage = erasePointerActiveOnImageRef.current;
    isLoupeHoldingRef.current = false;
    erasePointerActiveOnImageRef.current = false;
    setLoupeState(null);

    const wasMoved = movedDuringPointerRef.current;
    const wasMultiTouch = wasMultiTouchRef.current;
    const downPos = pointerDownClientRef.current;
    pointerDownClientRef.current = null;
    movedDuringPointerRef.current = false;
    setIsPanning(false);

    if (e.type === 'pointercancel' || wasMultiTouch || pinchStateRef.current) {
      return;
    }

    // Chế độ Xóa Click: Click nhanh -> xóa ngay; Nhấn giữ ngắm bằng Kính Lúp -> thả tay ra là xóa tại điểm ngắm
    if (
      isEraserMode &&
      (wasLoupeActive || (!wasMoved && downPos && wasEraseOnImage))
    ) {
      const coords = clientToImageCoords(e.clientX, e.clientY);
      if (coords) {
        setHoverImgCoords(coords);
        setClickRipple({ x: coords.x, y: coords.y, key: Date.now() });
        if (viewStage === 'original') {
          onChangeStage('split');
        }
        onEraseAtPoint(coords.x, coords.y);
      }
      return;
    }

    // Hỗ trợ Chạm đúp (Double-Tap) trên màn hình cảm ứng để Phóng to 2.5x tại điểm chạm hoặc thu về 100%
    if (e.pointerType === 'touch' && !wasMoved && !isEraserMode) {
      const now = performance.now();
      const prev = lastTapRef.current;
      const dt = now - prev.time;
      const dist = Math.hypot(e.clientX - prev.x, e.clientY - prev.y);
      if (dt > 40 && dt < 320 && dist < 32) {
        lastTapRef.current = { time: 0, x: 0, y: 0 };
        const el = viewportRef.current;
        if (el) {
          const { zoom: oldZoom, pan: oldPan } = viewStateRef.current;
          if (Math.abs(oldZoom - 1) > 0.08) {
            handleResetView();
          } else {
            const rect = el.getBoundingClientRect();
            const cx = rect.left + rect.width * 0.5;
            const cy = rect.top + rect.height * 0.5;
            const mx = e.clientX - cx;
            const my = e.clientY - cy;
            const newZoom = 2.5;
            const scaleRatio = newZoom / oldZoom;
            const newPan = {
              x: mx - (mx - oldPan.x) * scaleRatio,
              y: my - (my - oldPan.y) * scaleRatio,
            };
            viewStateRef.current = { zoom: newZoom, pan: newPan };
            setZoom(newZoom);
            setPan(newPan);
          }
        }
      } else {
        lastTapRef.current = { time: now, x: e.clientX, y: e.clientY };
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
    if (e.button !== 0 || pinchStateRef.current) return;
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    updateSplitFromClientX(e.clientX);
  };

  const handleSplitHandlePointerMove = (
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.stopPropagation();
    updateSplitFromClientX(e.clientX);
  };

  const handleSplitHandlePointerUp = (
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
    e.stopPropagation();
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full transition-colors">
      {/* Thanh công cụ & chọn bước tương thích Mobile & Desktop (Apple Optical Lens) */}
      <div
        data-apple-lens="bar"
        className="apple-lens-bar px-2 sm:px-3 py-1.5 border-b flex items-center justify-between gap-1.5 flex-wrap transition-colors relative z-20"
      >
        <div className="flex items-center gap-1 overflow-x-auto max-w-full py-0.5 no-scrollbar">
          {STAGE_TABS.map((tab) => {
            const active = viewStage === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onChangeStage(tab.id)}
                title={tab.tip}
                className={`px-2 sm:px-2.5 py-1 rounded-lg text-[11px] sm:text-xs font-medium shrink-0 cursor-pointer ${
                  active
                    ? 'apple-lens-btn-primary'
                    : 'apple-lens-btn text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Công cụ Xóa nền, Nền Caro, Zoom & Nhóm nút History bên phải phần Zoom trên Mobile */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 ml-auto max-w-full overflow-x-auto no-scrollbar py-0.5">
          {viewStage === 'wireframe' && (
            <label className="apple-lens-pill flex items-center gap-1 text-[11px] sm:text-xs text-slate-700 dark:text-slate-200 px-2 py-1 rounded-lg cursor-pointer shrink-0">
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
            className={`px-2 sm:px-2.5 py-1 rounded-lg flex items-center gap-1 text-[11px] sm:text-xs font-medium cursor-pointer shrink-0 ${
              removeBackground
                ? 'apple-lens-btn-emerald'
                : 'apple-lens-btn text-slate-700 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white'
            }`}
          >
            <Eraser
              className={`w-3.5 h-3.5 shrink-0 ${
                removeBackground
                  ? 'text-white'
                  : 'text-emerald-600 dark:text-emerald-400'
              }`}
            />
            <span className="hidden min-[380px]:inline sm:inline">
              {removeBackground ? 'Đã Bỏ Nền' : 'Bỏ Nền'}
            </span>
          </button>

          {/* Nút Xóa Vùng Chủ Động (Click chuột / Chạm) */}
          <button
            type="button"
            onClick={onToggleEraserMode}
            title="Xóa vùng chủ động (Phím E): Chạm hoặc Click vào đâu trên ảnh sẽ xóa mảng màu tại đó"
            className={`px-2 sm:px-2.5 py-1 rounded-lg flex items-center gap-1 text-[11px] sm:text-xs font-medium cursor-pointer shrink-0 ${
              isEraserMode
                ? 'apple-lens-btn-rose ring-2 ring-rose-400/40'
                : 'apple-lens-btn text-slate-700 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white'
            }`}
          >
            <MousePointerClick
              className={`w-3.5 h-3.5 shrink-0 ${
                isEraserMode
                  ? 'text-white'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            />
            <span className="hidden min-[360px]:inline">Xóa Click</span>
            {manualEraseCount > 0 && (
              <span
                className={`text-[10px] font-mono px-1 rounded ${
                  isEraserMode
                    ? 'bg-rose-900/80 text-white'
                    : 'bg-rose-500/20 text-rose-600 dark:text-rose-300'
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
            className="apple-lens-btn p-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white cursor-pointer shrink-0"
          >
            <Grid className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
          </button>

          {/* Cụm điều khiển Zoom */}
          <div
            data-apple-lens="pill"
            className="apple-lens-pill flex items-center rounded-xl px-0.5 sm:px-1 shrink-0"
          >
            <button
              type="button"
              onClick={() => handleStepZoom(1 / 1.25)}
              className="p-1 text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-sky-300 cursor-pointer"
              title="Thu nhỏ"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span
              onClick={handleResetView}
              title="Bấm để về 100%"
              className="text-[11px] sm:text-xs font-mono text-slate-800 dark:text-slate-100 px-1 min-w-[40px] text-center cursor-pointer font-semibold"
            >
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => handleStepZoom(1.25)}
              className="p-1 text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-sky-300 cursor-pointer"
              title="Phóng to"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleResetView}
            title="Căn giữa khung hình (100%)"
            className="hidden sm:inline-flex apple-lens-btn p-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white cursor-pointer shrink-0"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>

          {/* Nhóm nút History đặt bên phải phần Zoom trên Mobile (< md) */}
          <div
            data-apple-lens="pill"
            data-history-trigger="true"
            className="apple-lens-pill flex md:hidden items-center gap-0.5 p-0.5 rounded-xl shrink-0"
          >
            <button
              type="button"
              disabled={!canUndo}
              onClick={onUndo}
              title="Hoàn tác (Ctrl+Z)"
              className="p-1 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-white/60 dark:hover:bg-slate-700/60 disabled:opacity-35 transition cursor-pointer disabled:cursor-not-allowed"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              disabled={!canRedo}
              onClick={onRedo}
              title="Làm lại (Ctrl+Y)"
              className="p-1 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-white/60 dark:hover:bg-slate-700/60 disabled:opacity-35 transition cursor-pointer disabled:cursor-not-allowed"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onToggleHistoryPopup}
              title="Xem danh sách lịch sử các bước thao tác"
              className={`px-1.5 py-0.5 rounded-lg text-[11px] font-medium flex items-center gap-1 transition cursor-pointer ${
                showHistoryPopup
                  ? 'apple-lens-btn-primary'
                  : 'text-slate-700 dark:text-slate-200 hover:bg-white/60 dark:hover:bg-slate-700/60'
              }`}
            >
              <History className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-300 shrink-0" />
              <span className="text-[10px] font-mono">
                {historyIndex + 1}/{historyCount}
              </span>
            </button>
          </div>
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
        {/* Thanh điều khiển nổi Apple Optical Lens khi bật Chế độ Xóa Chủ Động */}
        {isEraserMode && (
          <OpticalGlass
            data-floating-bar="true"
            onPointerDown={(e) => e.stopPropagation()}
            scale={-110}
            chroma={6}
            border={0.08}
            mapBlur={10}
            blur={10}
            saturate={1.8}
            borderRadius={999}
            tintColor="#f43f5e"
            tintOpacity={0.22}
            baseColor="#0f172a"
            baseOpacity={0.82}
            highlightOpacity={0.5}
            style={{ position: 'absolute' }}
            className="top-2.5 left-1/2 -translate-x-1/2 z-30 max-w-[94vw] text-white text-xs"
            contentClassName="px-3 py-1.5 flex items-center justify-center gap-2 sm:gap-3 flex-wrap"
          >
            <span className="flex items-center gap-1 font-semibold text-rose-200">
              <MousePointerClick className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              <span className="text-[11px] sm:text-xs">
                Click: xóa ngay · Nhấn giữ: kính lúp
              </span>
              {hoverImgCoords && (
                <span className="hidden sm:inline font-mono text-[10px] text-slate-200 bg-white/10 px-1.5 py-0.2 rounded-full">
                  ({hoverImgCoords.x}, {hoverImgCoords.y})
                </span>
              )}
            </span>

            <label className="flex items-center gap-1.5 text-[11px] text-slate-100">
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
                className="w-16 sm:w-20 accent-rose-500 cursor-pointer"
              />
              <span className="font-mono text-rose-200 w-5 text-right">
                {manualEraseTolerance}
              </span>
            </label>

            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={!canUndo}
                onClick={onUndo}
                title="Hoàn tác bước vừa xóa (Ctrl+Z / Cmd+Z)"
                className="p-1 rounded-full hover:bg-white/15 disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={!canRedo}
                onClick={onRedo}
                title="Làm lại (Ctrl+Y / Cmd+Shift+Z)"
                className="p-1 rounded-full hover:bg-white/15 disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed"
              >
                <Redo2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={onToggleEraserMode}
                title="Thoát chế độ xóa chủ động (Esc)"
                className="apple-lens-btn-rose p-1 rounded-full text-white cursor-pointer ml-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </OpticalGlass>
        )}

        {result && (
          <div
            ref={splitContainerRef}
            style={{
              width: displayW,
              height: displayH,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
            }}
            className={`relative shadow-2xl rounded-sm overflow-visible ${
              isEraserMode
                ? 'ring-2 ring-rose-500/80'
                : 'ring-1 ring-slate-900/10 dark:ring-white/15'
            }`}
          >
            {/* Nhãn ẢNH GỐC / SVG dạng Apple Lens đặt phía trên khung ảnh */}
            {viewStage === 'split' && (
              <div
                style={{
                  left: `${splitPercent}%`,
                  transform: `translate(-50%, 0) scale(${1 / zoom})`,
                  transformOrigin: 'bottom center',
                }}
                className="absolute bottom-full mb-1.5 z-30 flex items-center gap-1.5 pointer-events-none select-none"
              >
                <span className="apple-lens-pill whitespace-nowrap px-2.5 py-0.5 rounded-full text-[10px] font-semibold text-slate-800 dark:text-white">
                  ← ẢNH GỐC
                </span>
                <span className="apple-lens-btn-primary whitespace-nowrap px-2.5 py-0.5 rounded-full text-[10px] font-semibold text-white">
                  {embeddedImageUrl
                    ? 'SVG (nhúng ảnh) →'
                    : `SVG (${result.stats.totalPaths} lớp) →`}
                </span>
              </div>
            )}

            {/* Thanh kéo chia đôi khung hình (Vùng chạm rộng 48px cho ngón tay) */}
            {viewStage === 'split' && (
              <div
                data-split-handle="true"
                onPointerDown={handleSplitHandlePointerDown}
                onPointerMove={handleSplitHandlePointerMove}
                onPointerUp={handleSplitHandlePointerUp}
                onPointerCancel={handleSplitHandlePointerUp}
                style={{
                  left: `${splitPercent}%`,
                  width: `${Math.max(44, 48 / zoom)}px`,
                  marginLeft: `-${Math.max(22, 24 / zoom)}px`,
                }}
                className="absolute top-0 bottom-0 z-30 flex items-center justify-center cursor-ew-resize no-select-drag group"
              >
                <div
                  style={{ width: `${Math.max(1, 2 / zoom)}px` }}
                  className="h-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.9)]"
                />
                <div
                  style={{
                    transform:
                      displayH * zoom < 140
                        ? `translateY(14px) scale(${1 / zoom})`
                        : `scale(${1 / zoom})`,
                  }}
                  className={`absolute ${
                    displayH * zoom < 140 ? 'bottom-0' : 'top-1/2 -translate-y-1/2'
                  } apple-lens-btn-primary w-7 h-7 sm:w-6 sm:h-6 rounded-full flex items-center justify-center text-white group-hover:scale-110 active:scale-110 transition`}
                >
                  <MoveHorizontal className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
                </div>
              </div>
            )}

            {/* Khung nội dung ảnh & vector có overflow-hidden để cắt gọn lớp phủ */}
            <div className="relative w-full h-full overflow-hidden rounded-sm">
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
                    {embeddedImageUrl ? (
                      <image
                        href={embeddedImageUrl}
                        width={w}
                        height={h}
                        preserveAspectRatio="none"
                      />
                    ) : null}
                    {!embeddedImageUrl &&
                      result.paths.map((p) =>
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
                            fillOpacity={p.opacity}
                            stroke={seamWidth > 0 && p.opacity === undefined ? p.hex : undefined}
                            strokeWidth={seamWidth > 0 && p.opacity === undefined ? seamWidth : undefined}
                            strokeLinejoin={seamWidth > 0 && p.opacity === undefined ? 'round' : undefined}
                            strokeLinecap={seamWidth > 0 && p.opacity === undefined ? 'round' : undefined}
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
                  {embeddedImageUrl ? (
                    <image
                      href={embeddedImageUrl}
                      width={w}
                      height={h}
                      preserveAspectRatio="none"
                    />
                  ) : null}
                  {!embeddedImageUrl &&
                    result.paths.map((p) =>
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
                          fillOpacity={p.opacity}
                          stroke={seamWidth > 0 && p.opacity === undefined ? p.hex : undefined}
                          strokeWidth={seamWidth > 0 && p.opacity === undefined ? seamWidth : undefined}
                          strokeLinejoin={seamWidth > 0 && p.opacity === undefined ? 'round' : undefined}
                          strokeLinecap={seamWidth > 0 && p.opacity === undefined ? 'round' : undefined}
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
                    left: hoverImgCoords.x * displayScale,
                    top: hoverImgCoords.y * displayScale,
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
                    left: clickRipple.x * displayScale,
                    top: clickRipple.y * displayScale,
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
                  className={`absolute inset-0 z-10 isolate pointer-events-none overflow-hidden transition-opacity duration-300 ${
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
          </div>
        )}

        {/* Kính lúp phóng đại dạng Apple Optical Lens hiện phía trên khi nhấn giữ ở Chế độ Xóa Click */}
        {isEraserMode && loupeState && result && (() => {
          const vpRect = viewportRef.current?.getBoundingClientRect();
          const relX = vpRect ? loupeState.clientX - vpRect.left : 0;
          const relY = vpRect ? loupeState.clientY - vpRect.top : 0;
          const loupeSize = 136;
          const halfLoupe = loupeSize / 2;
          // Đặt kính lúp phía trên con trỏ/ngón tay 94px để không bị che khuất; nếu sát mép trên quá thì đẩy xuống dưới
          const placeBelow = relY < loupeSize + 36;
          const rawTop = placeBelow ? relY + 92 : relY - 94;
          const clampedLeft = vpRect
            ? Math.max(halfLoupe + 8, Math.min(vpRect.width - halfLoupe - 8, relX))
            : relX;
          const clampedTop = vpRect
            ? Math.max(halfLoupe + 8, Math.min(vpRect.height - halfLoupe - 8, rawTop))
            : rawTop;

          // Tính cửa sổ phóng đại ~4x so với kích thước hiển thị hiện tại
          const screenPxPerImgPx = Math.max(0.2, displayScale * zoom);
          const patchSpan = Math.max(
            8,
            Math.min(Math.max(w, h) * 0.4, loupeSize / (screenPxPerImgPx * 3.8))
          );
          const halfSpan = patchSpan * 0.5;
          const vbX = loupeState.imgX + 0.5 - halfSpan;
          const vbY = loupeState.imgY + 0.5 - halfSpan;

          // Đọc màu pixel tại điểm đang ngắm từ quantizedBuffer để hiển thị mẫu màu trực tiếp
          const pxIdx = (loupeState.imgY * w + loupeState.imgX) * 4;
          const qBuf = result.quantizedBuffer;
          const rVal = qBuf[pxIdx] ?? 0;
          const gVal = qBuf[pxIdx + 1] ?? 0;
          const bVal = qBuf[pxIdx + 2] ?? 0;
          const aVal = qBuf[pxIdx + 3] ?? 0;
          const hexSample =
            aVal < 20
              ? 'Trong suốt'
              : `#${rVal.toString(16).padStart(2, '0')}${gVal
                  .toString(16)
                  .padStart(2, '0')}${bVal
                  .toString(16)
                  .padStart(2, '0')}`.toUpperCase();

          return (
            <div
              style={{
                left: `${clampedLeft}px`,
                top: `${clampedTop}px`,
                width: `${loupeSize}px`,
                height: `${loupeSize}px`,
                transform: 'translate(-50%, -50%)',
              }}
              className="absolute z-40 pointer-events-none select-none"
            >
              {/* Vòng kính lúp tròn phóng đại với viền khúc xạ Apple Optical Lens */}
              <div
                style={{
                  boxShadow:
                    'inset 0 2.5px 4px rgba(255,255,255,0.9), inset 0 -10px 20px rgba(244,63,94,0.32), inset 0 0 0 2.5px rgba(255,255,255,0.78), 0 20px 44px -8px rgba(2,6,23,0.68), 0 0 0 1.5px rgba(244,63,94,0.72)',
                }}
                className={`relative w-full h-full rounded-full overflow-hidden ${
                  useLightChecker ? 'checkerboard-light' : 'checkerboard'
                }`}
              >
                <svg
                  viewBox={`${vbX} ${vbY} ${patchSpan} ${patchSpan}`}
                  width={loupeSize}
                  height={loupeSize}
                  className="block w-full h-full"
                  shapeRendering="geometricPrecision"
                >
                  {(viewStage === 'original' || viewStage === 'split') &&
                    originalDataUrl && (
                      <image
                        href={originalDataUrl}
                        x={0}
                        y={0}
                        width={w}
                        height={h}
                        preserveAspectRatio="none"
                        opacity={viewStage === 'original' ? 1 : 0.35}
                        style={{ imageRendering: 'pixelated' }}
                      />
                    )}
                  {viewStage !== 'original' && embeddedImageUrl ? (
                    <image
                      href={embeddedImageUrl}
                      x={0}
                      y={0}
                      width={w}
                      height={h}
                      preserveAspectRatio="none"
                    />
                  ) : null}
                  {viewStage !== 'original' &&
                    !embeddedImageUrl &&
                    result.paths.map((p) =>
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
                          fillOpacity={p.opacity}
                          stroke={
                            seamWidth > 0 && p.opacity === undefined
                              ? p.hex
                              : undefined
                          }
                          strokeWidth={
                            seamWidth > 0 && p.opacity === undefined
                              ? seamWidth
                              : undefined
                          }
                          strokeLinejoin={
                            seamWidth > 0 && p.opacity === undefined
                              ? 'round'
                              : undefined
                          }
                          strokeLinecap={
                            seamWidth > 0 && p.opacity === undefined
                              ? 'round'
                              : undefined
                          }
                          fillRule="evenodd"
                          d={p.d}
                        />
                      )
                    )}
                  {/* Ô pixel mục tiêu tại đúng tâm ngắm */}
                  <rect
                    x={loupeState.imgX}
                    y={loupeState.imgY}
                    width={1}
                    height={1}
                    fill="rgba(244, 63, 94, 0.28)"
                    stroke="#f43f5e"
                    strokeWidth={(patchSpan / loupeSize) * 1.5}
                  />
                </svg>

                {/* Lưới chữ thập (Crosshair Reticle) & bóng phản quang vòm kính Apple Lens */}
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-rose-500/65" />
                  <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-rose-500/65" />
                  <div className="w-4 h-4 rounded-full border-2 border-rose-500 bg-rose-500/15 shadow-[0_0_8px_rgba(244,63,94,0.9)]" />
                </div>
                <div
                  style={{
                    background:
                      'linear-gradient(155deg, rgba(255,255,255,0.42) 0%, rgba(255,255,255,0.08) 32%, transparent 55%)',
                  }}
                  className="absolute inset-0 pointer-events-none rounded-full"
                />
              </div>

              {/* Nhãn hiển thị mẫu màu & tọa độ bên dưới vành kính lúp */}
              <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 apple-lens-pill px-2 py-0.5 rounded-full flex items-center gap-1.5 text-[10px] font-mono font-semibold text-slate-900 dark:text-white whitespace-nowrap shadow-lg">
                <span
                  style={{
                    backgroundColor: aVal < 20 ? 'transparent' : hexSample,
                  }}
                  className="w-2.5 h-2.5 rounded-full border border-white/80 shadow-sm shrink-0"
                />
                <span>{hexSample}</span>
                <span className="text-rose-500 dark:text-rose-300">
                  ({loupeState.imgX},{loupeState.imgY})
                </span>
              </div>

              {/* Mũi kim chỉ từ kính lúp xuống điểm chạm thực tế */}
              <div
                className={`absolute left-1/2 -translate-x-1/2 w-2.5 h-2.5 rotate-45 bg-rose-500 border border-white/80 shadow ${
                  placeBelow ? '-top-1' : '-bottom-1'
                }`}
              />
            </div>
          );
        })()}

        {/* Huy hiệu trạng thái nổi dạng Apple Optical Lens khi đang kiến tạo Vector */}
        {viewStage !== 'original' && (
          <div
            aria-live="polite"
            className={`absolute top-4 right-4 z-30 pointer-events-none transition-all duration-300 ${
              showShimmer
                ? 'opacity-100 translate-y-0 scale-100'
                : 'opacity-0 -translate-y-2 scale-95'
            }`}
          >
            <OpticalGlass
              scale={-96}
              chroma={6}
              border={0.09}
              mapBlur={9}
              blur={8}
              saturate={1.8}
              borderRadius={999}
              tintColor="#6366f1"
              tintOpacity={0.25}
              baseColor="#0f172a"
              baseOpacity={0.82}
              highlightOpacity={0.5}
              contentClassName="px-3 py-1.5 flex items-center gap-2"
            >
              <Sparkles className="w-3.5 h-3.5 text-fuchsia-400 ai-sparkle-icon shrink-0" />
              <span className="text-xs font-semibold bg-gradient-to-r from-indigo-200 via-fuchsia-200 to-sky-200 bg-clip-text text-transparent">
                Đang kiến tạo Vector SVG...
              </span>
            </OpticalGlass>
          </div>
        )}

        {/* Chú thích dạng Apple Optical Lens cho chế độ Wireframe */}
        {viewStage === 'wireframe' && (
          <OpticalGlass
            scale={-92}
            chroma={5}
            border={0.08}
            mapBlur={9}
            blur={8}
            saturate={1.65}
            borderRadius={12}
            tintColor="#38bdf8"
            tintOpacity={0.18}
            baseColor={isDarkTheme ? '#0f172a' : '#ffffff'}
            baseOpacity={0.78}
            highlightOpacity={0.48}
            style={{ position: 'absolute' }}
            className="bottom-3 left-4 z-20 text-[11px]"
            contentClassName="px-2.5 py-1.5 flex items-center gap-3"
          >
            <span className="flex items-center gap-1 text-slate-800 dark:text-slate-100">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
              Smooth Node
            </span>
            <span className="flex items-center gap-1 text-slate-800 dark:text-slate-100">
              <span className="w-2 h-2 bg-amber-500 inline-block" />
              Corner Node
            </span>
            <span className="flex items-center gap-1 text-slate-800 dark:text-slate-100">
              <span className="w-3 h-0.5 bg-sky-400 inline-block" />
              1-Line Spine
            </span>
            <InfoTooltip
              side="top"
              title="Chú thích Khung Dây (Wireframe)"
              content="Chấm tròn xanh là điểm uốn cong mượt Bézier. Ô vuông vàng là đỉnh góc nhọn. Đường xanh dương là trục tâm của nét đơn Centerline."
            />
          </OpticalGlass>
        )}
      </div>
    </div>
  );
};
