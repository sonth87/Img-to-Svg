import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Upload,
  Download,
  Copy,
  Check,
  Code2,
  Cpu,
  Image as ImageIcon,
  X,
  Sun,
  Moon,
  Undo2,
  Redo2,
  History,
  Trash2,
} from 'lucide-react';
import {
  MAX_ORIGINAL_PROCESSING_DIMENSION,
  PaletteOverride,
  PipelineResult,
  VectorizerParams,
  ViewStage,
} from './types/vectorizer';
import { buildEmbeddedImageSvg } from './engine/svgBuilder';
import { DEFAULT_PARAMS, SAMPLE_PRESETS } from './engine/sampleImages';
import { ControlPanel } from './components/ControlPanel';
import { ViewportCanvas } from './components/ViewportCanvas';
import { PaletteManager } from './components/PaletteManager';
import { InfoTooltip } from './components/InfoTooltip';
import VectorizerWorker from './engine/worker?worker';

const DEFAULT_PROCESSING_DIMENSION = 1024;

/** Kích thước ảnh đem đi dò vector theo tùy chọn "Độ phân giải xử lý" (0 = ảnh gốc, có giới hạn trên) */
function fitProcessingDims(
  naturalW: number,
  naturalH: number,
  resolution: VectorizerParams['processingResolution']
): { w: number; h: number } {
  const maxDim =
    resolution === 0
      ? MAX_ORIGINAL_PROCESSING_DIMENSION
      : resolution ?? DEFAULT_PROCESSING_DIMENSION;
  if (naturalW <= maxDim && naturalH <= maxDim) return { w: naturalW, h: naturalH };
  const scale = maxDim / Math.max(naturalW, naturalH);
  return {
    w: Math.max(16, Math.round(naturalW * scale)),
    h: Math.max(16, Math.round(naturalH * scale)),
  };
}
const MAX_HISTORY_ENTRIES = 40;

interface HistoryEntry {
  id: number;
  label: string;
  time: string;
  params: VectorizerParams;
  paletteOverrides: Record<number, PaletteOverride>;
}

function formatNowTime(): string {
  const d = new Date();
  return d.toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function getSystemScheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function getStoredScheme(): 'light' | 'dark' | null {
  try {
    const val = localStorage.getItem('color-scheme');
    if (val === 'light' || val === 'dark') return val;
  } catch {
    // ignore storage errors
  }
  return null;
}

export const App: React.FC = () => {
  const [resolvedScheme, setResolvedScheme] = useState<'light' | 'dark'>(() => {
    return getStoredScheme() ?? getSystemScheme();
  });

  const [activeSampleId, setActiveSampleId] = useState<string>(
    SAMPLE_PRESETS[0].id
  );
  const [currentImageName, setCurrentImageName] = useState<string>(
    SAMPLE_PRESETS[0].name
  );
  const [params, setParams] = useState<VectorizerParams>(() => ({
    ...SAMPLE_PRESETS[0].recommendedParams,
    manualErases: [],
    manualEraseTolerance: 18,
  }));
  const [paletteOverrides, setPaletteOverrides] = useState<
    Record<number, PaletteOverride>
  >({});
  const [viewStage, setViewStage] = useState<ViewStage>('split');
  const [isEraserMode, setIsEraserMode] = useState<boolean>(false);

  // Quản lý Lịch sử thao tác (Undo / Redo / History Timeline)
  const [history, setHistory] = useState<HistoryEntry[]>(() => [
    {
      id: 1,
      label: 'Khởi tạo mặc định',
      time: formatNowTime(),
      params: {
        ...SAMPLE_PRESETS[0].recommendedParams,
        manualErases: [],
        manualEraseTolerance: 18,
      },
      paletteOverrides: {},
    },
  ]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  const [showHistoryPopup, setShowHistoryPopup] = useState<boolean>(false);

  const [originalDataUrl, setOriginalDataUrl] = useState<string | null>(null);
  const [sourceImageInfo, setSourceImageInfo] = useState<{
    width: number;
    height: number;
    pixels: Uint8ClampedArray;
  } | null>(null);

  const [result, setResult] = useState<PipelineResult | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processingKey, setProcessingKey] = useState<number>(0);
  const [copiedSvg, setCopiedSvg] = useState<boolean>(false);
  const [showSvgCodeModal, setShowSvgCodeModal] = useState<boolean>(false);
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);

  const workerRef = useRef<Worker | null>(null);
  const jobIdRef = useRef<number>(0);
  const lastRenderedJobIdRef = useRef<number>(0);
  // Mảng pixel worker đang giữ: gửi lại khi ảnh nguồn đổi (tải ảnh mới / đổi độ phân giải xử lý)
  const sentPixelsRef = useRef<Uint8ClampedArray | null>(null);
  // Ảnh người dùng tải lên ở độ phân giải gốc: vẽ lại khi đổi "Độ phân giải xử lý" & nhúng vào SVG khi xuất
  const sourceImageRef = useRef<HTMLImageElement | null>(null);
  const [embedSourceUrl, setEmbedSourceUrl] = useState<string | null>(null);
  const processingResolutionRef = useRef(params.processingResolution);
  processingResolutionRef.current = params.processingResolution;

  const rasterizeSource = useCallback(
    (img: HTMLImageElement, resolution: VectorizerParams['processingResolution']) => {
      const { w, h } = fitProcessingDims(
        img.naturalWidth || img.width,
        img.naturalHeight || img.height,
        resolution
      );
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, w, h);
      const imgData = ctx.getImageData(0, 0, w, h);

      setOriginalDataUrl(canvas.toDataURL('image/png'));
      setSourceImageInfo({ width: w, height: h, pixels: imgData.data });
    },
    []
  );
  const workerBusyRef = useRef<boolean>(false);
  const pendingPayloadRef = useRef<{
    jobId: number;
    sourcePixels?: Uint8ClampedArray;
    width: number;
    height: number;
    params: VectorizerParams;
    paletteOverrides: Record<number, PaletteOverride>;
    newImageLoaded?: boolean;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const historyPopupRef = useRef<HTMLDivElement | null>(null);
  const historyEntryIdRef = useRef<number>(2);
  const historyDebounceTimerRef = useRef<number | null>(null);
  const historyIndexRef = useRef<number>(0);

  useEffect(() => {
    historyIndexRef.current = historyIndex;
  }, [historyIndex]);

  const commitHistorySnapshot = useCallback(
    (
      nextParams: VectorizerParams,
      nextOverrides: Record<number, PaletteOverride>,
      label: string,
      immediate = true
    ) => {
      if (historyDebounceTimerRef.current !== null) {
        window.clearTimeout(historyDebounceTimerRef.current);
        historyDebounceTimerRef.current = null;
      }

      const doCommit = () => {
        const snapshotParams: VectorizerParams = {
          ...nextParams,
          manualErases: [...(nextParams.manualErases ?? [])],
        };
        const snapshotOverrides: Record<number, PaletteOverride> = {
          ...nextOverrides,
        };
        const entry: HistoryEntry = {
          id: historyEntryIdRef.current++,
          label,
          time: formatNowTime(),
          params: snapshotParams,
          paletteOverrides: snapshotOverrides,
        };

        setHistory((prev) => {
          const sliced = prev.slice(0, historyIndexRef.current + 1);
          const nextList = [...sliced, entry];
          if (nextList.length > MAX_HISTORY_ENTRIES) {
            nextList.shift();
          }
          const newIdx = nextList.length - 1;
          historyIndexRef.current = newIdx;
          setHistoryIndex(newIdx);
          return nextList;
        });
      };

      if (immediate) {
        doCommit();
      } else {
        historyDebounceTimerRef.current = window.setTimeout(doCommit, 320);
      }
    },
    []
  );

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  const jumpToHistoryIndex = useCallback(
    (targetIdx: number) => {
      if (targetIdx < 0 || targetIdx >= history.length) return;
      if (historyDebounceTimerRef.current !== null) {
        window.clearTimeout(historyDebounceTimerRef.current);
        historyDebounceTimerRef.current = null;
      }
      const target = history[targetIdx];
      historyIndexRef.current = targetIdx;
      setHistoryIndex(targetIdx);
      setParams({
        ...target.params,
        manualErases: [...(target.params.manualErases ?? [])],
      });
      setPaletteOverrides({ ...target.paletteOverrides });
    },
    [history]
  );

  const handleUndo = useCallback(() => {
    if (historyIndexRef.current > 0) {
      jumpToHistoryIndex(historyIndexRef.current - 1);
    }
  }, [jumpToHistoryIndex]);

  const handleRedo = useCallback(() => {
    if (historyIndexRef.current < history.length - 1) {
      jumpToHistoryIndex(historyIndexRef.current + 1);
    }
  }, [history.length, jumpToHistoryIndex]);

  // Đóng History Popover khi click ra ngoài
  useEffect(() => {
    if (!showHistoryPopup) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (!historyPopupRef.current?.contains(e.target as Node)) {
        setShowHistoryPopup(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [showHistoryPopup]);

  // Phím tắt toàn cục: Ctrl+Z / Cmd+Z (Undo), Ctrl+Y / Cmd+Shift+Z (Redo), E (Xóa chủ động), Esc (Thoát)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }
      if (!isInput && !e.metaKey && !e.ctrlKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        setIsEraserMode((prev) => !prev);
        return;
      }
      if (e.key === 'Escape') {
        if (showHistoryPopup) setShowHistoryPopup(false);
        else if (showSvgCodeModal) setShowSvgCodeModal(false);
        else if (isEraserMode) setIsEraserMode(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, isEraserMode, showHistoryPopup, showSvgCodeModal]);

  const applySchemeToMeta = useCallback((stored: 'light' | 'dark' | null) => {
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="color-scheme"]'
    );
    if (meta) {
      meta.content = stored ?? 'light dark';
    }
    setResolvedScheme(stored ?? getSystemScheme());
  }, []);

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handleMediaChange = () => {
      if (!getStoredScheme()) {
        setResolvedScheme(getSystemScheme());
      }
    };
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'color-scheme') {
        applySchemeToMeta(getStoredScheme());
      }
    };

    mql.addEventListener('change', handleMediaChange);
    window.addEventListener('storage', handleStorage);
    return () => {
      mql.removeEventListener('change', handleMediaChange);
      window.removeEventListener('storage', handleStorage);
    };
  }, [applySchemeToMeta]);

  const handleToggleColorScheme = () => {
    const currentRendered = getStoredScheme() ?? getSystemScheme();
    const targetScheme: 'light' | 'dark' =
      currentRendered === 'dark' ? 'light' : 'dark';
    const systemScheme = getSystemScheme();

    try {
      if (targetScheme === systemScheme) {
        localStorage.removeItem('color-scheme');
        applySchemeToMeta(null);
      } else {
        localStorage.setItem('color-scheme', targetScheme);
        applySchemeToMeta(targetScheme);
      }
    } catch {
      applySchemeToMeta(targetScheme === systemScheme ? null : targetScheme);
    }
  };

  // Khởi tạo Web Worker với cơ chế Latest-Job Latch
  useEffect(() => {
    const worker = new VectorizerWorker();
    worker.onmessage = (
      e: MessageEvent<{
        jobId: number;
        result?: PipelineResult;
        error?: string;
      }>
    ) => {
      if (pendingPayloadRef.current) {
        const nextPayload = pendingPayloadRef.current;
        pendingPayloadRef.current = null;
        worker.postMessage(nextPayload);
      } else {
        workerBusyRef.current = false;
      }

      if (e.data.result && e.data.jobId >= lastRenderedJobIdRef.current) {
        lastRenderedJobIdRef.current = e.data.jobId;
        setResult(e.data.result);
      }
      if (!workerBusyRef.current && e.data.jobId >= jobIdRef.current) {
        setIsProcessing(false);
      }
    };
    worker.onerror = (err) => {
      console.error('[Worker Error]', err);
      workerBusyRef.current = false;
      setIsProcessing(false);
    };
    workerRef.current = worker;
    return () => {
      worker.terminate();
    };
  }, []);

  // Khởi tạo canvas mặc định ban đầu
  useEffect(() => {
    const preset = SAMPLE_PRESETS[0];
    const w = 480;
    const h = 480;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    preset.renderToCanvas(ctx, w, h);
    const dataUrl = canvas.toDataURL('image/png');
    const imgData = ctx.getImageData(0, 0, w, h);

    sourceImageRef.current = null;
    setEmbedSourceUrl(dataUrl);
    setOriginalDataUrl(dataUrl);
    setSourceImageInfo({
      width: w,
      height: h,
      pixels: imgData.data,
    });
  }, []);

  // Đổi độ phân giải xử lý (thanh tùy chọn, preset, hoàn tác) -> vẽ lại ảnh gốc ở kích thước mới
  useEffect(() => {
    const img = sourceImageRef.current;
    if (!img) return;
    rasterizeSource(img, params.processingResolution);
  }, [params.processingResolution, rasterizeSource]);

  // Xử lý file ảnh người dùng tải lên
  const handleFileSelected = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        sourceImageRef.current = img;
        setEmbedSourceUrl(reader.result as string);
        const imgName = file.name || 'Ảnh dán từ Clipboard';
        setActiveSampleId('custom');
        setCurrentImageName(imgName);
        setPaletteOverrides({});

        setParams((prev) => {
          const freshParams: VectorizerParams = {
            ...prev,
            manualErases: [],
          };
          const initialEntry: HistoryEntry = {
            id: historyEntryIdRef.current++,
            label: `Tải ảnh: ${imgName}`,
            time: formatNowTime(),
            params: freshParams,
            paletteOverrides: {},
          };
          historyIndexRef.current = 0;
          setHistoryIndex(0);
          setHistory([initialEntry]);
          return freshParams;
        });

        rasterizeSource(img, processingResolutionRef.current);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }, [rasterizeSource]);

  // Hỗ trợ dán ảnh trực tiếp bằng phím tắt Ctrl+V / Cmd+V
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            handleFileSelected(file);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [handleFileSelected]);

  // Kiểu file đầu ra chỉ ảnh hưởng lúc xuất SVG -> đổi nó không chạy lại pipeline
  const { outputFormat: _outputFormat, ...pipelineParams } = params;
  const pipelineParamsKey = JSON.stringify(pipelineParams);

  // Gửi công việc sang Web Worker
  useEffect(() => {
    if (!sourceImageInfo || !workerRef.current) return;

    const nextJobId = ++jobIdRef.current;
    const isNewUpload = sentPixelsRef.current !== sourceImageInfo.pixels;
    sentPixelsRef.current = sourceImageInfo.pixels;
    const params = JSON.parse(pipelineParamsKey) as VectorizerParams;

    setIsProcessing(true);
    setProcessingKey(nextJobId);

    const payload = {
      jobId: nextJobId,
      sourcePixels: isNewUpload ? sourceImageInfo.pixels : undefined,
      width: sourceImageInfo.width,
      height: sourceImageInfo.height,
      params,
      paletteOverrides,
      newImageLoaded: isNewUpload,
    };

    if (workerBusyRef.current) {
      const prevPixels = pendingPayloadRef.current?.sourcePixels;
      const prevNewImage = pendingPayloadRef.current?.newImageLoaded;
      pendingPayloadRef.current = {
        ...payload,
        sourcePixels: payload.sourcePixels ?? prevPixels,
        newImageLoaded: payload.newImageLoaded || prevNewImage,
      };
    } else {
      workerBusyRef.current = true;
      workerRef.current.postMessage(payload);
    }
  }, [sourceImageInfo, pipelineParamsKey, paletteOverrides]);

  // Xử lý khi người dùng click xóa vùng chủ động tại tọa độ (x, y)
  const handleEraseAtPoint = useCallback(
    (x: number, y: number) => {
      setParams((prev) => {
        const tolerance = prev.manualEraseTolerance ?? 18;
        const nextErases = [
          ...(prev.manualErases ?? []),
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            x,
            y,
            tolerance,
          },
        ];
        const nextParams: VectorizerParams = {
          ...prev,
          manualErases: nextErases,
        };
        commitHistorySnapshot(
          nextParams,
          paletteOverrides,
          `Xóa vùng tại (${x}, ${y})`,
          true
        );
        return nextParams;
      });
    },
    [commitHistorySnapshot, paletteOverrides]
  );

  const handleClearManualErases = useCallback(() => {
    setParams((prev) => {
      if (!prev.manualErases?.length) return prev;
      const nextParams: VectorizerParams = {
        ...prev,
        manualErases: [],
      };
      commitHistorySnapshot(
        nextParams,
        paletteOverrides,
        'Khôi phục các vùng đã click xóa',
        true
      );
      return nextParams;
    });
  }, [commitHistorySnapshot, paletteOverrides]);

  // Thao tác trên bảng màu (Palette Manager)
  const handleToggleVisibility = (colorId: number, currentVisible: boolean) => {
    setPaletteOverrides((prev) => {
      const next = {
        ...prev,
        [colorId]: {
          ...prev[colorId],
          visible: !currentVisible,
        },
      };
      commitHistorySnapshot(
        params,
        next,
        `${currentVisible ? 'Ẩn' : 'Hiện'} lớp màu #${colorId + 1}`,
        true
      );
      return next;
    });
  };

  const handleChangeCustomColor = (colorId: number, newHex: string) => {
    setPaletteOverrides((prev) => {
      const next = {
        ...prev,
        [colorId]: {
          ...prev[colorId],
          customHex: newHex,
        },
      };
      commitHistorySnapshot(
        params,
        next,
        `Đổi màu lớp #${colorId + 1} → ${newHex.toUpperCase()}`,
        false
      );
      return next;
    });
  };

  const handleMergeColor = (sourceColorId: number, targetColorId: number) => {
    setPaletteOverrides((prev) => {
      const next = {
        ...prev,
        [sourceColorId]: {
          ...prev[sourceColorId],
          mergedInto: targetColorId,
        },
      };
      commitHistorySnapshot(
        params,
        next,
        `Gộp lớp màu #${sourceColorId + 1} vào #${targetColorId + 1}`,
        true
      );
      return next;
    });
  };

  const isEmbeddedOutput =
    params.outputFormat === 'embedded' && Boolean(embedSourceUrl);
  const exportSvgString = useMemo(() => {
    if (!result) return null;
    return isEmbeddedOutput && embedSourceUrl
      ? buildEmbeddedImageSvg(embedSourceUrl, result.width, result.height)
      : result.svgString;
  }, [result, isEmbeddedOutput, embedSourceUrl]);
  const exportSvgBytes = useMemo(
    () => (exportSvgString ? new Blob([exportSvgString]).size : 0),
    [exportSvgString]
  );

  const handleCopySvg = async () => {
    if (!exportSvgString) return;
    await navigator.clipboard.writeText(exportSvgString);
    setCopiedSvg(true);
    setTimeout(() => setCopiedSvg(false), 2000);
  };

  const handleDownloadSvg = () => {
    if (!exportSvgString) return;
    const blob = new Blob([exportSvgString], {
      type: 'image/svg+xml;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vectorized-${activeSampleId}-${Date.now()}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingFile(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setIsDraggingFile(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDraggingFile(false);
        const file = e.dataTransfer.files?.[0];
        if (file) handleFileSelected(file);
      }}
      className="h-screen w-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden transition-colors"
    >
      {/* Top Navbar tối giản */}
      <header className="h-12 shrink-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-3.5 flex items-center justify-between gap-3 transition-colors">
        {/* Brand + Upload Button */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-400 flex items-center justify-center text-white font-bold shadow">
            <Cpu className="w-3.5 h-3.5" />
          </div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-sm font-bold tracking-tight text-slate-900 dark:text-white">
              AlgoTrace Studio
            </h1>
            <InfoTooltip
              side="bottom"
              title="AlgoTrace Studio — 100% Thuật Toán Hình Học"
              content={
                <div className="space-y-1">
                  <p>
                    Chuyển đổi ảnh sang Vector SVG sắc nét bằng chuỗi 5 bước:
                    Bilateral Shock Smoothing → K-Means++ CIELAB → Tách nền &
                    Lọc đốm → Marching Squares → Khớp đường cong Cubic Bézier.
                  </p>
                  {result && (
                    <p className="font-mono text-[10px] text-indigo-300 pt-1 border-t border-slate-700">
                      Hiện tại: {result.stats.totalPaths} paths ·{' '}
                      {result.stats.totalNodes.toLocaleString()} nodes ·{' '}
                      {(exportSvgBytes / 1024).toFixed(1)} KB
                    </p>
                  )}
                </div>
              }
            />
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/bmp,image/gif"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileSelected(file);
              e.target.value = '';
            }}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="ml-1 px-2.5 py-1.5 rounded-md text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm flex items-center gap-1.5 transition shrink-0 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Tải Ảnh Lên</span>
          </button>
        </div>

        {/* Bộ điều khiển Lịch Sử (Undo / Redo / History Timeline Popover) */}
        <div
          ref={historyPopupRef}
          className="relative flex items-center gap-1 bg-slate-100 dark:bg-slate-800/90 p-0.5 rounded-lg border border-slate-200/80 dark:border-slate-700/80"
        >
          <button
            type="button"
            disabled={!canUndo}
            onClick={handleUndo}
            title="Hoàn tác (Ctrl+Z / Cmd+Z)"
            className="px-2 py-1 rounded-md text-xs font-medium flex items-center gap-1 text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700 disabled:opacity-40 transition cursor-pointer disabled:cursor-not-allowed"
          >
            <Undo2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Hoàn tác</span>
          </button>

          <button
            type="button"
            disabled={!canRedo}
            onClick={handleRedo}
            title="Làm lại (Ctrl+Y / Cmd+Shift+Z)"
            className="px-2 py-1 rounded-md text-xs font-medium flex items-center gap-1 text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700 disabled:opacity-40 transition cursor-pointer disabled:cursor-not-allowed"
          >
            <Redo2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Làm lại</span>
          </button>

          <button
            type="button"
            onClick={() => setShowHistoryPopup((prev) => !prev)}
            title="Xem danh sách lịch sử các bước thao tác"
            className={`px-2 py-1 rounded-md text-xs font-medium flex items-center gap-1 transition cursor-pointer ${
              showHistoryPopup
                ? 'bg-indigo-600 text-white'
                : 'text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Lịch sử</span>
            <span
              className={`text-[10px] font-mono px-1 rounded ${
                showHistoryPopup
                  ? 'bg-indigo-800 text-indigo-100'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              {historyIndex + 1}/{history.length}
            </span>
          </button>

          {/* Popup danh sách Lịch sử */}
          {showHistoryPopup && (
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 w-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
              <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  Lịch sử thao tác ({history.length} bước)
                </span>
                {(params.manualErases?.length ?? 0) > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      handleClearManualErases();
                      setShowHistoryPopup(false);
                    }}
                    className="text-[11px] text-rose-600 dark:text-rose-400 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    Xóa điểm click
                  </button>
                )}
              </div>
              <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/70">
                {history.map((item, idx) => {
                  const isCurrent = idx === historyIndex;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        jumpToHistoryIndex(idx);
                        setShowHistoryPopup(false);
                      }}
                      className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-2 transition cursor-pointer ${
                        isCurrent
                          ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-semibold'
                          : idx > historyIndex
                          ? 'text-slate-400 dark:text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                      }`}
                    >
                      <span className="truncate flex items-center gap-1.5">
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            isCurrent
                              ? 'bg-indigo-600 dark:bg-indigo-400'
                              : idx < historyIndex
                              ? 'bg-emerald-500'
                              : 'bg-slate-400'
                          }`}
                        />
                        <span className="truncate">
                          {idx + 1}. {item.label}
                        </span>
                      </span>
                      <span className="text-[10px] font-mono text-slate-400 shrink-0">
                        {item.time}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Theme Toggle & Export Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {result && (
            <span className="hidden lg:inline-block font-mono text-[11px] text-slate-500 dark:text-slate-400 mr-1">
              {(exportSvgBytes / 1024).toFixed(1)} KB
            </span>
          )}

          <button
            type="button"
            onClick={handleToggleColorScheme}
            title={
              resolvedScheme === 'dark'
                ? 'Chuyển sang Giao diện Sáng'
                : 'Chuyển sang Giao diện Tối'
            }
            className="p-1.5 rounded-md text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200/80 dark:border-slate-700 transition cursor-pointer"
          >
            {resolvedScheme === 'dark' ? (
              <Sun className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <Moon className="w-3.5 h-3.5 text-indigo-600" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setShowSvgCodeModal(true)}
            title="Xem mã nguồn XML SVG"
            className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-1.5 transition cursor-pointer"
          >
            <Code2 className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            <span className="hidden md:inline">Mã SVG</span>
          </button>

          <button
            type="button"
            onClick={handleCopySvg}
            title="Sao chép mã SVG vào Clipboard"
            className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-1.5 transition cursor-pointer"
          >
            {copiedSvg ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="text-emerald-600 dark:text-emerald-400">
                  Đã chép
                </span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Copy</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleDownloadSvg}
            className="px-3 py-1.5 rounded-md text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm flex items-center gap-1.5 transition cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Xuất .SVG</span>
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <div className="flex-1 flex min-h-0">
        <ControlPanel
          params={params}
          stats={result?.stats || null}
          isProcessing={isProcessing}
          currentImageName={currentImageName}
          imageDimensions={
            result ? { width: result.width, height: result.height } : null
          }
          isEraserMode={isEraserMode}
          onToggleEraserMode={() => setIsEraserMode((prev) => !prev)}
          onClearManualErases={handleClearManualErases}
          onUploadFile={handleFileSelected}
          onChange={(updater, actionLabel) => {
            setParams((prev) => {
              let next = updater(prev);
              // Điểm xóa chủ động lưu theo tọa độ ảnh xử lý -> co giãn theo độ phân giải mới
              const img = sourceImageRef.current;
              if (
                img &&
                prev.processingResolution !== next.processingResolution &&
                next.manualErases?.length
              ) {
                const nw = img.naturalWidth || img.width;
                const nh = img.naturalHeight || img.height;
                const from = fitProcessingDims(nw, nh, prev.processingResolution);
                const to = fitProcessingDims(nw, nh, next.processingResolution);
                const sx = to.w / from.w;
                const sy = to.h / from.h;
                next = {
                  ...next,
                  manualErases: next.manualErases.map((pt) => ({
                    ...pt,
                    x: Math.min(to.w - 1, Math.floor(pt.x * sx)),
                    y: Math.min(to.h - 1, Math.floor(pt.y * sy)),
                  })),
                };
              }
              const quantChanged =
                prev.mode !== next.mode ||
                prev.smoothness !== next.smoothness ||
                prev.colorCount !== next.colorCount ||
                prev.colorMergeDeltaE !== next.colorMergeDeltaE ||
                prev.monochromeThreshold !== next.monochromeThreshold ||
                prev.invertMonochrome !== next.invertMonochrome ||
                prev.singleLineStrokes !== next.singleLineStrokes;
              const nextOverrides = quantChanged ? {} : paletteOverrides;
              if (quantChanged) {
                setPaletteOverrides({});
              }
              const isImmediate =
                prev.mode !== next.mode ||
                prev.removeBackground !== next.removeBackground ||
                prev.layerMode !== next.layerMode ||
                prev.singleLineStrokes !== next.singleLineStrokes ||
                prev.invertMonochrome !== next.invertMonochrome;

              commitHistorySnapshot(
                next,
                nextOverrides,
                actionLabel ?? 'Chỉnh thông số thuật toán',
                isImmediate
              );
              return next;
            });
          }}
          onReset={() => {
            setPaletteOverrides({});
            const preset = SAMPLE_PRESETS.find((s) => s.id === activeSampleId);
            const resetParams: VectorizerParams = {
              ...(preset ? preset.recommendedParams : DEFAULT_PARAMS),
              manualErases: [],
              manualEraseTolerance: 18,
            };
            setParams(resetParams);
            commitHistorySnapshot(
              resetParams,
              {},
              'Khôi phục mặc định (Reset)',
              true
            );
          }}
        />

        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <ViewportCanvas
            originalDataUrl={originalDataUrl}
            result={result}
            embeddedImageUrl={isEmbeddedOutput ? embedSourceUrl : null}
            viewStage={viewStage}
            isDarkTheme={resolvedScheme === 'dark'}
            isProcessing={isProcessing}
            processingKey={processingKey}
            removeBackground={Boolean(params.removeBackground)}
            isEraserMode={isEraserMode}
            manualEraseTolerance={params.manualEraseTolerance ?? 18}
            manualEraseCount={params.manualErases?.length ?? 0}
            canUndo={canUndo}
            canRedo={canRedo}
            onToggleRemoveBackground={() =>
              setParams((prev) => {
                const next: VectorizerParams = {
                  ...prev,
                  removeBackground: !prev.removeBackground,
                };
                commitHistorySnapshot(
                  next,
                  paletteOverrides,
                  next.removeBackground
                    ? 'Bật bỏ nền tự động'
                    : 'Tắt bỏ nền tự động',
                  true
                );
                return next;
              })
            }
            onToggleEraserMode={() => setIsEraserMode((prev) => !prev)}
            onChangeManualEraseTolerance={(val) =>
              setParams((prev) => ({
                ...prev,
                manualEraseTolerance: val,
              }))
            }
            onEraseAtPoint={handleEraseAtPoint}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onChangeStage={setViewStage}
          />

          {result && (
            <PaletteManager
              palette={result.palette}
              overrides={paletteOverrides}
              onToggleVisibility={handleToggleVisibility}
              onChangeCustomColor={handleChangeCustomColor}
              onMergeColor={handleMergeColor}
              onResetOverrides={() => {
                setPaletteOverrides({});
                commitHistorySnapshot(
                  params,
                  {},
                  'Khôi phục bảng màu gốc',
                  true
                );
              }}
            />
          )}
        </div>
      </div>

      {/* Overlay khi kéo thả file ảnh vào cửa sổ */}
      {isDraggingFile && (
        <div className="fixed inset-0 z-50 bg-indigo-950/80 backdrop-blur-sm border-4 border-dashed border-indigo-400 flex flex-col items-center justify-center pointer-events-none">
          <ImageIcon className="w-14 h-14 text-indigo-300 mb-3 animate-bounce" />
          <p className="text-lg font-bold text-white">
            Thả ảnh JPG / PNG / WebP vào đây để chuyển sang Vector SVG
          </p>
        </div>
      )}

      {/* Modal xem trực tiếp mã nguồn XML <svg> */}
      {showSvgCodeModal && result && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl w-full max-w-4xl max-h-[82vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Code2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  {isEmbeddedOutput ? (
                    'Mã nguồn SVG (nhúng ảnh gốc)'
                  ) : (
                    <>
                      Mã nguồn Vector SVG ({result.stats.totalPaths} thẻ
                      &lt;path&gt;, {result.stats.totalNodes} điểm neo Bézier)
                    </>
                  )}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSvgCodeModal(false)}
                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 flex-1 overflow-auto bg-slate-950 font-mono text-xs text-slate-200">
              <pre className="whitespace-pre-wrap break-all select-all">
                {isEmbeddedOutput
                  ? exportSvgString?.replace(/(data:[^"]{80})[^"]*/g, '$1…')
                  : result.svgString}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
