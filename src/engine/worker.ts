import { PaletteOverride, VectorizerParams } from '../types/vectorizer';
import { clearPipelineCache, runVectorizationPipeline } from './pipeline';

export interface WorkerRequest {
  jobId: number;
  sourcePixels?: Uint8ClampedArray;
  width: number;
  height: number;
  params: VectorizerParams;
  paletteOverrides: Record<number, PaletteOverride>;
  newImageLoaded?: boolean;
}

let cachedSourcePixels: Uint8ClampedArray | null = null;

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const {
    jobId,
    sourcePixels,
    width,
    height,
    params,
    paletteOverrides,
    newImageLoaded,
  } = e.data;

  if (sourcePixels) {
    cachedSourcePixels = sourcePixels;
    clearPipelineCache();
  }

  if (!cachedSourcePixels) return;

  try {
    const result = runVectorizationPipeline(
      cachedSourcePixels,
      width,
      height,
      params,
      paletteOverrides,
      Boolean(newImageLoaded)
    );

    self.postMessage({
      jobId,
      result,
    });
  } catch (err) {
    console.error('[VectorizerWorker] Pipeline error:', err);
    self.postMessage({
      jobId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
