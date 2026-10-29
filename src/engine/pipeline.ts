import {
  PaletteColor,
  PaletteOverride,
  PipelineResult,
  VectorPathData,
  VectorizerParams,
} from '../types/vectorizer';
import { applyEdgePreservingSmoothing } from './smoothing';
import { quantizeImageColors } from './quantize';
import { applyPaletteOverridesAndDespeckle } from './despeckle';
import { extractAllColorLayerContours } from './marchingSquares';
import { buildVectorPathsFromLayers } from './curveFitting';
import { buildOptimalCurvePathsFromLayers } from './optimalCurve';
import { traceCenterlineStrokeLayer } from './centerline';
import { buildSvgDocument } from './svgBuilder';

interface PipelineCache {
  width: number;
  height: number;
  smoothness: number;
  smoothedBuffer: Uint8ClampedArray;
  quantKey: string;
  rawLabelMap: Int32Array;
  rawPalette: PaletteColor[];
  thinStrokeMask?: Uint8Array;
}

let cache: PipelineCache | null = null;

export function clearPipelineCache() {
  cache = null;
}

export function runVectorizationPipeline(
  sourcePixels: Uint8ClampedArray,
  width: number,
  height: number,
  params: VectorizerParams,
  paletteOverrides: Record<number, PaletteOverride>,
  forceResetCache = false
): PipelineResult {
  const tStart = performance.now();

  if (
    forceResetCache ||
    !cache ||
    cache.width !== width ||
    cache.height !== height
  ) {
    cache = null;
  }

  // BƯỚC 1: Làm phẳng màu giữ cạnh (Bilateral Smoothing + Shock Edge De-halo)
  const t0 = performance.now();
  let smoothedBuffer: Uint8ClampedArray;
  if (cache && cache.smoothness === params.smoothness) {
    smoothedBuffer = cache.smoothedBuffer;
  } else {
    smoothedBuffer = applyEdgePreservingSmoothing(
      sourcePixels,
      width,
      height,
      params.smoothness
    );
  }
  const smoothingMs = Math.round(performance.now() - t0);

  // BƯỚC 2: Phân cụm màu K-Means++ (CIELAB) / Tách nét mảnh Cartoon / Centerline
  const t1 = performance.now();
  const quantKey = `${params.smoothness}|${params.mode}|${params.singleLineStrokes}|${params.colorCount}|${params.colorMergeDeltaE}|${params.monochromeThreshold}|${params.invertMonochrome}`;
  let rawLabelMap: Int32Array;
  let rawPalette: PaletteColor[];
  let thinStrokeMask: Uint8Array | undefined;

  if (cache && cache.quantKey === quantKey) {
    rawLabelMap = cache.rawLabelMap;
    rawPalette = cache.rawPalette;
    thinStrokeMask = cache.thinStrokeMask;
  } else {
    const quantOut = quantizeImageColors(
      smoothedBuffer,
      sourcePixels,
      width,
      height,
      params
    );
    rawLabelMap = quantOut.labelMap;
    rawPalette = quantOut.palette;
    thinStrokeMask = quantOut.thinStrokeMask;
    cache = {
      width,
      height,
      smoothness: params.smoothness,
      smoothedBuffer,
      quantKey,
      rawLabelMap,
      rawPalette,
      thinStrokeMask,
    };
  }
  const quantizeMs = Math.round(performance.now() - t1);

  // BƯỚC 3: Gộp vùng nhiễu nhỏ (Despeckle) & Áp dụng chỉnh sửa bảng màu
  const t2 = performance.now();
  const {
    cleanedLabelMap,
    updatedPalette,
    quantizedBuffer,
    cleanedStrokeMask,
  } = applyPaletteOverridesAndDespeckle(
    rawLabelMap,
    rawPalette,
    width,
    height,
    params.despeckleArea,
    paletteOverrides,
    thinStrokeMask,
    params.removeBackground ?? false,
    params.bgTolerance ?? 24,
    params.manualErases ?? []
  );
  const despeckleMs = Math.round(performance.now() - t2);

  // BƯỚC 4 & 5: Dò biên & Khớp đường cong
  const t3 = performance.now();
  // Chế độ Pixel Art (độ uốn mượt = 0) luôn giữ thuật toán cũ để bám đúng lưới pixel vuông
  const useOptimalFitter =
    (params.curveFitter ?? 'optimal') === 'optimal' && params.curveSmoothing > 0.02;
  let paths: VectorPathData[] = [];
  let tracingMs = 0;
  let curveFittingMs = 0;

  if (params.mode === 'centerline') {
    const strokeCol =
      updatedPalette.find((p) => p.isStrokeLayer) ?? updatedPalette[0];
    const timings = { tracingMs: 0, curveFittingMs: 0 };
    if (cleanedStrokeMask && strokeCol && strokeCol.visible) {
      const strokePath = traceCenterlineStrokeLayer(
        cleanedStrokeMask,
        width,
        height,
        strokeCol.id,
        strokeCol.hex,
        params.simplifyTolerance,
        params.cornerThreshold,
        params.curveSmoothing,
        params.strokeWidth,
        useOptimalFitter,
        timings,
        true
      );
      if (strokePath) {
        paths.push(strokePath);
      }
    }
    tracingMs = timings.tracingMs;
    curveFittingMs = timings.curveFittingMs;
  } else {
    const tracedLayers = extractAllColorLayerContours(
      cleanedLabelMap,
      updatedPalette,
      width,
      height,
      params.layerMode,
      params.cornerThreshold,
      params.curveSmoothing,
      params.simplifyTolerance,
      useOptimalFitter
    );
    tracingMs = Math.round(performance.now() - t3);

    const t4 = performance.now();
    paths = useOptimalFitter
      ? buildOptimalCurvePathsFromLayers(
          tracedLayers,
          params.simplifyTolerance,
          params.cornerThreshold
        )
      : buildVectorPathsFromLayers(
          tracedLayers,
          params.simplifyTolerance,
          params.cornerThreshold,
          params.curveSmoothing
        );

    // Nếu ở chế độ Cartoon HOẶC bật tùy chọn `singleLineStrokes` trong chế độ Đa Sắc:
    // Vẽ thêm lớp Nét Đơn Centerline (Single-Stroke Outline) đè lên trên các mảng màu!
    const useSingleLine =
      params.mode === 'cartoon' ||
      (params.mode === 'color' && params.singleLineStrokes);

    if (useSingleLine && cleanedStrokeMask) {
      const strokeCol = updatedPalette.find((p) => p.isStrokeLayer);
      if (strokeCol && strokeCol.visible) {
        const strokePath = traceCenterlineStrokeLayer(
          cleanedStrokeMask,
          width,
          height,
          strokeCol.id,
          strokeCol.hex,
          params.simplifyTolerance,
          params.cornerThreshold,
          params.curveSmoothing,
          params.strokeWidth,
          useOptimalFitter
        );
        if (strokePath) {
          // Độ dày tự ước lượng đếm cả viền xám anti-alias -> thu về độ dày mực thực
          if (params.strokeWidth <= 0 && strokeCol.strokeCoverage && strokePath.strokeWidth) {
            strokePath.strokeWidth = Math.max(
              1,
              Math.round(strokePath.strokeWidth * strokeCol.strokeCoverage * 10) / 10
            );
          }
          paths.push(strokePath);
        }
      }
    }

    curveFittingMs = Math.round(performance.now() - t4);
  }

  for (const p of paths) {
    const a = updatedPalette[p.colorId]?.a ?? 255;
    if (!p.isStroke && a < 255) p.opacity = Math.round((a / 255) * 1000) / 1000;
  }

  const svgString = buildSvgDocument(paths, width, height);
  const executionMs = Math.round(performance.now() - tStart);

  let totalContours = 0;
  let totalNodes = 0;
  for (const p of paths) {
    totalContours += p.contourCount;
    totalNodes += p.nodeCount;
  }

  const svgBytes = new TextEncoder().encode(svgString).length;

  return {
    width,
    height,
    smoothedBuffer,
    quantizedBuffer,
    palette: updatedPalette,
    paths,
    svgString,
    stats: {
      totalPaths: paths.length,
      totalContours,
      totalNodes,
      svgBytes,
      executionMs,
      stepTimings: {
        smoothingMs,
        quantizeMs,
        despeckleMs,
        tracingMs,
        curveFittingMs,
      },
    },
  };
}
