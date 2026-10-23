import React, { useCallback, useEffect, useRef, useState } from 'react';
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
} from 'lucide-react';
import {
  PaletteOverride,
  PipelineResult,
  VectorizerParams,
  ViewStage,
} from './types/vectorizer';
import { DEFAULT_PARAMS, SAMPLE_PRESETS } from './engine/sampleImages';
import { ControlPanel } from './components/ControlPanel';
import { ViewportCanvas } from './components/ViewportCanvas';
import { PaletteManager } from './components/PaletteManager';
import VectorizerWorker from './engine/worker?worker';

const MAX_PROCESSING_DIMENSION = 1024;

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
  const [params, setParams] = useState<VectorizerParams>(
    SAMPLE_PRESETS[0].recommendedParams
  );
  const [paletteOverrides, setPaletteOverrides] = useState<
    Record<number, PaletteOverride>
  >({});
  const [viewStage, setViewStage] = useState<ViewStage>('split');

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
  const needsPixelTransferRef = useRef<boolean>(false);
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

  // Đồng bộ <meta name="color-scheme"> theo đúng chuẩn modern-web-guidance (dark-mode-toggle)
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
      // Chỉ cập nhật UI nếu người dùng đang để mặc định theo hệ thống (không xóa stored value!)
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
        // Nếu đích trùng với hệ thống -> Xóa override để quay về tự động theo hệ thống
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

  // Khởi tạo Web Worker với cơ chế Latest-Job Latch (chống nghẽn hàng đợi khi kéo thanh trượt liên tục)
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

      // Hiển thị ngay mọi khung hình mới hơn khung hình hiện tại để giao diện phản hồi trực tiếp khi kéo thanh trượt!
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

  // Hàm nạp một mẫu ảnh có sẵn (Sample Preset)
  const loadSamplePreset = useCallback((sampleId: string) => {
    const preset =
      SAMPLE_PRESETS.find((s) => s.id === sampleId) || SAMPLE_PRESETS[0];
    setActiveSampleId(preset.id);
    setCurrentImageName(preset.name);
    setPaletteOverrides({});
    setParams(preset.recommendedParams);

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

    needsPixelTransferRef.current = true;
    setOriginalDataUrl(dataUrl);
    setSourceImageInfo({
      width: w,
      height: h,
      pixels: imgData.data,
    });
  }, []);

  // Tải mẫu đầu tiên khi mở ứng dụng
  useEffect(() => {
    loadSamplePreset(SAMPLE_PRESETS[0].id);
  }, [loadSamplePreset]);

  // Xử lý file ảnh người dùng tải lên (JPG, PNG, WebP, Paste Clipboard)
  const handleFileSelected = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;

        if (w > MAX_PROCESSING_DIMENSION || h > MAX_PROCESSING_DIMENSION) {
          const scale = MAX_PROCESSING_DIMENSION / Math.max(w, h);
          w = Math.max(16, Math.round(w * scale));
          h = Math.max(16, Math.round(h * scale));
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(img, 0, 0, w, h);
        const imgData = ctx.getImageData(0, 0, w, h);

        needsPixelTransferRef.current = true;
        setActiveSampleId('custom');
        setCurrentImageName(file.name || 'Ảnh dán từ Clipboard');
        setPaletteOverrides({});
        setOriginalDataUrl(canvas.toDataURL('image/png'));
        setSourceImageInfo({
          width: w,
          height: h,
          pixels: imgData.data,
        });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }, []);

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

  // Gửi công việc sang Web Worker mỗi khi ảnh hoặc tham số thay đổi (qua Latest-Job Latch)
  useEffect(() => {
    if (!sourceImageInfo || !workerRef.current) return;

    const nextJobId = ++jobIdRef.current;
    const isNewUpload = needsPixelTransferRef.current;
    needsPixelTransferRef.current = false;

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
      // Nếu gói trước có chứa sourcePixels của ảnh mới tải lên thì giữ lại để không bị mất
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
  }, [sourceImageInfo, params, paletteOverrides]);

  // Thao tác trên bảng màu (Palette Manager)
  const handleToggleVisibility = (colorId: number, currentVisible: boolean) => {
    setPaletteOverrides((prev) => ({
      ...prev,
      [colorId]: {
        ...prev[colorId],
        visible: !currentVisible,
      },
    }));
  };

  const handleChangeCustomColor = (colorId: number, newHex: string) => {
    setPaletteOverrides((prev) => ({
      ...prev,
      [colorId]: {
        ...prev[colorId],
        customHex: newHex,
      },
    }));
  };

  const handleMergeColor = (sourceColorId: number, targetColorId: number) => {
    setPaletteOverrides((prev) => ({
      ...prev,
      [sourceColorId]: {
        ...prev[sourceColorId],
        mergedInto: targetColorId,
      },
    }));
  };

  const handleCopySvg = async () => {
    if (!result?.svgString) return;
    await navigator.clipboard.writeText(result.svgString);
    setCopiedSvg(true);
    setTimeout(() => setCopiedSvg(false), 2000);
  };

  const handleDownloadSvg = () => {
    if (!result?.svgString) return;
    const blob = new Blob([result.svgString], {
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
      {/* Top Navbar */}
      <header className="h-14 shrink-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 flex items-center justify-between gap-3 transition-colors">
        {/* Brand + Upload Button */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-400 flex items-center justify-center text-white font-bold shadow">
            <Cpu className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold tracking-tight text-slate-900 dark:text-white">
                AlgoTrace Studio
              </h1>
              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                100% Thuật Toán
              </span>
            </div>
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
            className="ml-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow flex items-center gap-1.5 transition shrink-0 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            Tải Ảnh Lên (JPG / PNG)
          </button>
        </div>

        {/* Sample Presets */}
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <span className="text-xs text-slate-500 dark:text-slate-400 mr-1 hidden xl:inline">
            Hoặc thử mẫu:
          </span>
          {SAMPLE_PRESETS.map((sample) => (
            <button
              key={sample.id}
              type="button"
              onClick={() => loadSamplePreset(sample.id)}
              title={sample.subtitle}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition shrink-0 ${
                activeSampleId === sample.id
                  ? 'bg-indigo-50 dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 border border-indigo-400/60 dark:border-indigo-500/50'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/60 border border-transparent'
              }`}
            >
              {sample.name}
            </button>
          ))}
        </div>

        {/* Stats, Theme Toggle & Export Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {result && (
            <div className="hidden 2xl:flex items-center gap-3 px-3 py-1 rounded-md bg-slate-100 dark:bg-slate-950/90 border border-slate-200 dark:border-slate-800 text-xs">
              <div>
                <span className="text-slate-500">Paths: </span>
                <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                  {result.stats.totalPaths}
                </span>
              </div>
              <div>
                <span className="text-slate-500">Nodes: </span>
                <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                  {result.stats.totalNodes.toLocaleString()}
                </span>
              </div>
              <div>
                <span className="text-slate-500">Size: </span>
                <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                  {(result.stats.svgBytes / 1024).toFixed(1)} KB
                </span>
              </div>
            </div>
          )}

          {/* Nút chuyển đổi Giao diện Sáng / Tối */}
          <button
            type="button"
            onClick={handleToggleColorScheme}
            title={
              resolvedScheme === 'dark'
                ? 'Chuyển sang Giao diện Sáng (Light Mode)'
                : 'Chuyển sang Giao diện Tối (Dark Mode)'
            }
            className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200/80 dark:border-slate-700 flex items-center gap-1.5 transition cursor-pointer"
          >
            {resolvedScheme === 'dark' ? (
              <>
                <Sun className="w-3.5 h-3.5 text-amber-400" />
                <span>Sáng</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-indigo-600" />
                <span>Tối</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => setShowSvgCodeModal(true)}
            className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-1.5 transition"
          >
            <Code2 className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            <span className="hidden md:inline">Mã SVG</span>
          </button>

          <button
            type="button"
            onClick={handleCopySvg}
            className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-1.5 transition"
          >
            {copiedSvg ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="text-emerald-600 dark:text-emerald-400">
                  Đã chép!
                </span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Copy SVG</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleDownloadSvg}
            className="px-3 py-1.5 rounded-md text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow flex items-center gap-1.5 transition"
          >
            <Download className="w-3.5 h-3.5" />
            Xuất .SVG
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
          onUploadFile={handleFileSelected}
          onChange={(updater) => {
            setParams((prev) => {
              const next = updater(prev);
              const quantChanged =
                prev.mode !== next.mode ||
                prev.smoothness !== next.smoothness ||
                prev.colorCount !== next.colorCount ||
                prev.colorMergeDeltaE !== next.colorMergeDeltaE ||
                prev.monochromeThreshold !== next.monochromeThreshold ||
                prev.invertMonochrome !== next.invertMonochrome ||
                prev.singleLineStrokes !== next.singleLineStrokes;
              if (quantChanged) {
                setPaletteOverrides({});
              }
              return next;
            });
          }}
          onReset={() => {
            setPaletteOverrides({});
            const preset = SAMPLE_PRESETS.find((s) => s.id === activeSampleId);
            setParams(preset ? preset.recommendedParams : DEFAULT_PARAMS);
          }}
        />

        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <ViewportCanvas
            originalDataUrl={originalDataUrl}
            result={result}
            viewStage={viewStage}
            isDarkTheme={resolvedScheme === 'dark'}
            isProcessing={isProcessing}
            processingKey={processingKey}
            removeBackground={Boolean(params.removeBackground)}
            onToggleRemoveBackground={() =>
              setParams((prev) => ({
                ...prev,
                removeBackground: !prev.removeBackground,
              }))
            }
            onChangeStage={setViewStage}
          />

          {result && (
            <PaletteManager
              palette={result.palette}
              overrides={paletteOverrides}
              onToggleVisibility={handleToggleVisibility}
              onChangeCustomColor={handleChangeCustomColor}
              onMergeColor={handleMergeColor}
              onResetOverrides={() => setPaletteOverrides({})}
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
                  Mã nguồn Vector SVG ({result.stats.totalPaths} thẻ &lt;path&gt;,{' '}
                  {result.stats.totalNodes} điểm neo Bézier)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSvgCodeModal(false)}
                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 flex-1 overflow-auto bg-slate-950 font-mono text-xs text-slate-200">
              <pre className="whitespace-pre-wrap break-all select-all">
                {result.svgString}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
