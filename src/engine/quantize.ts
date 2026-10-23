/**
 * BƯỚC 2: PHÂN CỤM & GOM NHÓM MÀU (COLOR QUANTIZATION & MERGING TRONG HỆ MÀU CIELAB)
 * KẾT HỢP TÁCH NÉT ĐƠN (SINGLE-LINE STROKE EXTRACTION & HALO INPAINTING)
 */

import { PaletteColor, VectorizerParams } from '../types/vectorizer';

export interface QuantizationOutput {
  labelMap: Int32Array;
  palette: PaletteColor[];
  /** Mặt nạ các pixel thuộc nét vẽ mảnh (dùng cho chế độ Centerline và Single-Line Strokes) */
  thinStrokeMask?: Uint8Array;
}

export function rgbToLab(
  r: number,
  g: number,
  b: number
): [number, number, number] {
  let sr = r / 255;
  let sg = g / 255;
  let sb = b / 255;

  sr = sr > 0.04045 ? Math.pow((sr + 0.055) / 1.055, 2.4) : sr / 12.92;
  sg = sg > 0.04045 ? Math.pow((sg + 0.055) / 1.055, 2.4) : sg / 12.92;
  sb = sb > 0.04045 ? Math.pow((sb + 0.055) / 1.055, 2.4) : sb / 12.92;

  const x = (sr * 0.4124564 + sg * 0.3575761 + sb * 0.1804375) / 0.95047;
  const y = (sr * 0.2126729 + sg * 0.7151522 + sb * 0.0721750) / 1.00000;
  const z = (sr * 0.0193339 + sg * 0.1191920 + sb * 0.9503041) / 1.08883;

  const fx = x > 0.008856 ? Math.cbrt(x) : 7.787 * x + 16 / 116;
  const fy = y > 0.008856 ? Math.cbrt(y) : 7.787 * y + 16 / 116;
  const fz = z > 0.008856 ? Math.cbrt(z) : 7.787 * z + 16 / 116;

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

/**
 * Tách riêng các nét vẽ mảnh (Thin Strokes) ra khỏi các mảng đen đặc lớn (như con ngươi mắt, mũi gấu)
 * trực tiếp từ ảnh gốc `rawPixels` (chưa bị làm mờ bởi Bilateral Filter), sau đó xóa sạch (inpaint)
 * cả nét vẽ lẫn quầng xám anti-alias khỏi `smoothedPixels` để K-Means không bao giờ sinh ra mảng xám răng cưa!
 */
function extractThinStrokesAndInpaintBuffer(
  rawPixels: Uint8ClampedArray,
  smoothedPixels: Uint8ClampedArray,
  width: number,
  height: number,
  inkThreshold: number
): {
  inpaintedPixels: Uint8ClampedArray;
  thinStrokeMask: Uint8Array;
  strokeColor: { r: number; g: number; b: number; hex: string };
} {
  const totalPixels = width * height;
  const rawLum = new Float32Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    rawLum[i] =
      rawPixels[idx + 3] < 128
        ? 255
        : 0.299 * rawPixels[idx] +
          0.587 * rawPixels[idx + 1] +
          0.114 * rawPixels[idx + 2];
  }

  // Bước 1: Nhận diện pixel tối (bao gồm cả nét mảnh 1px bị nhạt màu do anti-aliasing trên nền sáng)
  const darkMask = new Uint8Array(totalPixels);
  const softLimit = Math.min(205, inkThreshold + 45);

  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      if (rawPixels[i * 4 + 3] < 128) continue;
      const lum = rawLum[i];

      if (lum < inkThreshold) {
        darkMask[i] = 1;
      } else if (lum < softLimit) {
        // Kiểm tra xem pixel xám này có phải là tâm của nét mảnh nằm trên nền sáng không
        let maxLocal = lum;
        for (let dy = -2; dy <= 2; dy++) {
          const rOff = (y + dy) * width;
          if (y + dy < 0 || y + dy >= height) continue;
          for (let dx = -2; dx <= 2; dx++) {
            if (x + dx < 0 || x + dx >= width) continue;
            const nl = rawLum[rOff + x + dx];
            if (nl > maxLocal) maxLocal = nl;
          }
        }
        if (maxLocal - lum >= 55) {
          darkMask[i] = 1;
        }
      }
    }
  }

  // Bước 2: Tìm các nhân đặc (Thick Core): Pixel tối mà toàn bộ vùng bán kính R=5 xung quanh đều tối
  // Tối ưu hóa bằng phép Co (Erosion) tách chiều 1D (Ngang + Dọc) chạy nhanh gấp 10 lần vòng lặp 2D
  const coreRadius = 5;
  const horizErode = new Uint8Array(totalPixels);
  const thickCore = new Uint8Array(totalPixels);

  for (let y = 0; y < height; y++) {
    const row = y * width;
    let run = 0;
    for (let x = 0; x < width; x++) {
      run = darkMask[row + x] ? run + 1 : 0;
      if (run >= coreRadius * 2 + 1) {
        horizErode[row + x - coreRadius] = 1;
      }
    }
  }

  for (let x = coreRadius; x < width - coreRadius; x++) {
    let run = 0;
    for (let y = 0; y < height; y++) {
      run = horizErode[y * width + x] ? run + 1 : 0;
      if (run >= coreRadius * 2 + 1) {
        thickCore[(y - coreRadius) * width + x] = 1;
      }
    }
  }

  // Nở (Dilate) nhân đặc ra bán kính 7px bằng phép Nở tách chiều 1D (Ngang + Dọc)
  const dilateR = 7;
  const horizDilate = new Uint8Array(totalPixels);
  const solidDarkBlob = new Uint8Array(totalPixels);

  for (let y = 0; y < height; y++) {
    const row = y * width;
    let dist = 999;
    for (let x = 0; x < width; x++) {
      if (thickCore[row + x]) dist = 0;
      else dist++;
      if (dist <= dilateR) horizDilate[row + x] = 1;
    }
    dist = 999;
    for (let x = width - 1; x >= 0; x--) {
      if (thickCore[row + x]) dist = 0;
      else dist++;
      if (dist <= dilateR) horizDilate[row + x] = 1;
    }
  }

  for (let x = 0; x < width; x++) {
    let dist = 999;
    for (let y = 0; y < height; y++) {
      const idx = y * width + x;
      if (horizDilate[idx]) dist = 0;
      else dist++;
      if (dist <= dilateR && darkMask[idx]) solidDarkBlob[idx] = 1;
    }
    dist = 999;
    for (let y = height - 1; y >= 0; y--) {
      const idx = y * width + x;
      if (horizDilate[idx]) dist = 0;
      else dist++;
      if (dist <= dilateR && darkMask[idx]) solidDarkBlob[idx] = 1;
    }
  }

  // Nét mảnh (Thin Stroke) = Pixel tối NHƯNG không thuộc khối đặc lớn
  // Đồng thời trích xuất màu mực thực tế từ các pixel cốt lõi của nét mảnh
  const thinStrokeMask = new Uint8Array(totalPixels);
  let strokeSumR = 0;
  let strokeSumG = 0;
  let strokeSumB = 0;
  let strokeWeightSum = 0;

  for (let i = 0; i < totalPixels; i++) {
    if (darkMask[i] && !solidDarkBlob[i]) {
      thinStrokeMask[i] = 1;
      const pOff = i * 4;
      const lum = rawLum[i];
      // Trọng số cao hơn cho các pixel đậm ở chính giữa lõi nét
      const w = Math.max(1, 255 - lum);
      strokeSumR += rawPixels[pOff] * w;
      strokeSumG += rawPixels[pOff + 1] * w;
      strokeSumB += rawPixels[pOff + 2] * w;
      strokeWeightSum += w;
    }
  }

  const sR = strokeWeightSum > 0 ? Math.round(strokeSumR / strokeWeightSum) : 22;
  const sG = strokeWeightSum > 0 ? Math.round(strokeSumG / strokeWeightSum) : 27;
  const sB = strokeWeightSum > 0 ? Math.round(strokeSumB / strokeWeightSum) : 34;
  const strokeColor = {
    r: sR,
    g: sG,
    b: sB,
    hex: rgbToHex(sR, sG, sB),
  };

  // Bước 3: Xóa sạch (Inpaint) cả nét mảnh LẪN toàn bộ quầng xám anti-alias (bán kính 3px quanh nét mảnh)
  // bằng phương pháp lan truyền đối xứng (Balanced Voronoi Wavefront Inpainting) từ hai bên mép nét vào tâm!
  const toInpaint = new Uint8Array(thinStrokeMask);
  const haloRadius = 3;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (!thinStrokeMask[row + x]) continue;
      const y0 = Math.max(0, y - haloRadius);
      const y1 = Math.min(height - 1, y + haloRadius);
      const x0 = Math.max(0, x - haloRadius);
      const x1 = Math.min(width - 1, x + haloRadius);
      for (let ny = y0; ny <= y1; ny++) {
        const rOff = ny * width;
        for (let nx = x0; nx <= x1; nx++) {
          const nIdx = rOff + nx;
          if (!solidDarkBlob[nIdx]) {
            toInpaint[nIdx] = 1;
          }
        }
      }
    }
  }

  const inpaintedPixels = new Uint8ClampedArray(smoothedPixels);
  const resolved = new Uint8Array(totalPixels);
  const unresolvedList: number[] = [];

  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      if (smoothedPixels[i * 4 + 3] < 128) continue;
      if (toInpaint[i] === 0) {
        resolved[i] = 1;
      } else {
        unresolvedList.push(i);
      }
    }
  }

  // Chỉ duyệt trên danh sách pixel nét mảnh cần Inpaint (unresolvedList) thay vì quét toàn bộ ảnh 10 lần!
  const newlyResolved: number[] = [];
  for (let pass = 0; pass < 10 && unresolvedList.length > 0; pass++) {
    newlyResolved.length = 0;
    let writePtr = 0;

    for (let k = 0; k < unresolvedList.length; k++) {
      const idx = unresolvedList[k];
      const n0 = idx - 1;
      const n1 = idx + 1;
      const n2 = idx - width;
      const n3 = idx + width;

      let bestNeighbor = -1;
      let bestScore = -Infinity;

      if (resolved[n0] === 1) {
        const pOff = n0 * 4;
        const lum =
          0.299 * inpaintedPixels[pOff] +
          0.587 * inpaintedPixels[pOff + 1] +
          0.114 * inpaintedPixels[pOff + 2];
        const score = lum >= inkThreshold ? 100 + lum * 0.05 : lum;
        if (score > bestScore) {
          bestScore = score;
          bestNeighbor = n0;
        }
      }
      if (resolved[n1] === 1) {
        const pOff = n1 * 4;
        const lum =
          0.299 * inpaintedPixels[pOff] +
          0.587 * inpaintedPixels[pOff + 1] +
          0.114 * inpaintedPixels[pOff + 2];
        const score = lum >= inkThreshold ? 100 + lum * 0.05 : lum;
        if (score > bestScore) {
          bestScore = score;
          bestNeighbor = n1;
        }
      }
      if (resolved[n2] === 1) {
        const pOff = n2 * 4;
        const lum =
          0.299 * inpaintedPixels[pOff] +
          0.587 * inpaintedPixels[pOff + 1] +
          0.114 * inpaintedPixels[pOff + 2];
        const score = lum >= inkThreshold ? 100 + lum * 0.05 : lum;
        if (score > bestScore) {
          bestScore = score;
          bestNeighbor = n2;
        }
      }
      if (resolved[n3] === 1) {
        const pOff = n3 * 4;
        const lum =
          0.299 * inpaintedPixels[pOff] +
          0.587 * inpaintedPixels[pOff + 1] +
          0.114 * inpaintedPixels[pOff + 2];
        const score = lum >= inkThreshold ? 100 + lum * 0.05 : lum;
        if (score > bestScore) {
          bestScore = score;
          bestNeighbor = n3;
        }
      }

      if (bestNeighbor === -1) {
        const d0 = idx - width - 1;
        const d1 = idx - width + 1;
        const d2 = idx + width - 1;
        const d3 = idx + width + 1;
        const diags = [d0, d1, d2, d3];
        for (let d = 0; d < 4; d++) {
          const nIdx = diags[d];
          if (resolved[nIdx] === 1) {
            const pOff = nIdx * 4;
            const lum =
              0.299 * inpaintedPixels[pOff] +
              0.587 * inpaintedPixels[pOff + 1] +
              0.114 * inpaintedPixels[pOff + 2];
            const score = lum >= inkThreshold ? 80 + lum * 0.05 : lum;
            if (score > bestScore) {
              bestScore = score;
              bestNeighbor = nIdx;
            }
          }
        }
      }

      if (bestNeighbor !== -1) {
        const dstOff = idx * 4;
        const srcOff = bestNeighbor * 4;
        inpaintedPixels[dstOff] = inpaintedPixels[srcOff];
        inpaintedPixels[dstOff + 1] = inpaintedPixels[srcOff + 1];
        inpaintedPixels[dstOff + 2] = inpaintedPixels[srcOff + 2];
        resolved[idx] = 2;
        newlyResolved.push(idx);
      } else {
        unresolvedList[writePtr++] = idx;
      }
    }

    unresolvedList.length = writePtr;
    if (newlyResolved.length === 0) break;
    for (let k = 0; k < newlyResolved.length; k++) {
      resolved[newlyResolved[k]] = 1;
    }
  }

  return { inpaintedPixels, thinStrokeMask, strokeColor };
}

export function quantizeImageColors(
  smoothedPixels: Uint8ClampedArray,
  rawSourcePixels: Uint8ClampedArray,
  width: number,
  height: number,
  params: VectorizerParams
): QuantizationOutput {
  const totalPixels = width * height;
  const labelMap = new Int32Array(totalPixels);

  // Chế độ Đen Trắng (Monochrome Fill) hoặc Nét Đơn (Centerline Stroke)
  if (params.mode === 'monochrome' || params.mode === 'centerline') {
    let darkCount = 0;
    let lightCount = 0;
    const thresh = params.monochromeThreshold;
    const invert = params.invertMonochrome;
    const thinStrokeMask = new Uint8Array(totalPixels);

    // Ở chế độ Centerline, đọc từ rawSourcePixels để nét mảnh 1px không bị mờ mất khi smoothness cao
    const srcBuf =
      params.mode === 'centerline' ? rawSourcePixels : smoothedPixels;

    let inkSumR = 0;
    let inkSumG = 0;
    let inkSumB = 0;

    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4;
      const a = srcBuf[idx + 3];
      if (a < 128) {
        labelMap[i] = -1;
        continue;
      }
      const r = srcBuf[idx];
      const g = srcBuf[idx + 1];
      const b = srcBuf[idx + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const isInk = invert ? lum >= thresh : lum < thresh;
      if (isInk) {
        labelMap[i] = 0;
        thinStrokeMask[i] = 1;
        inkSumR += r;
        inkSumG += g;
        inkSumB += b;
        darkCount++;
      } else {
        labelMap[i] = 1;
        lightCount++;
      }
    }

    const inkR = darkCount > 0 ? Math.round(inkSumR / darkCount) : 18;
    const inkG = darkCount > 0 ? Math.round(inkSumG / darkCount) : 24;
    const inkB = darkCount > 0 ? Math.round(inkSumB / darkCount) : 38;

    const validTotal = Math.max(1, darkCount + lightCount);
    const palette: PaletteColor[] = [
      {
        id: 0,
        r: inkR,
        g: inkG,
        b: inkB,
        a: 255,
        hex: rgbToHex(inkR, inkG, inkB),
        pixelCount: darkCount,
        percentage: (darkCount / validTotal) * 100,
        visible: true,
        isStrokeLayer: params.mode === 'centerline',
      },
      {
        id: 1,
        r: 255,
        g: 255,
        b: 255,
        a: 255,
        hex: '#FFFFFF',
        pixelCount: lightCount,
        percentage: (lightCount / validTotal) * 100,
        visible: false,
      },
    ];

    return { labelMap, palette, thinStrokeMask };
  }

  // Nếu bật chế độ Cartoon HOẶC bật tùy chọn `singleLineStrokes` trong chế độ Đa Sắc:
  // Tự động tách nét vẽ mảnh ra thành 1 đường Line đơn và xóa quầng xám anti-alias!
  const useSingleLineExtraction =
    params.mode === 'cartoon' ||
    (params.mode === 'color' && params.singleLineStrokes);

  let workingPixels = smoothedPixels;
  let thinStrokeMask: Uint8Array | undefined;
  let extractedStrokeColor = { r: 22, g: 27, b: 34, hex: '#161B22' };

  if (useSingleLineExtraction) {
    const extracted = extractThinStrokesAndInpaintBuffer(
      rawSourcePixels,
      smoothedPixels,
      width,
      height,
      params.monochromeThreshold
    );
    workingPixels = extracted.inpaintedPixels;
    thinStrokeMask = extracted.thinStrokeMask;
    extractedStrokeColor = extracted.strokeColor;
  }

  // Hỗ trợ phân cụm từ 2 đến 256 màu bằng thuật toán Weighted 18-bit Histogram K-Means++
  const k = Math.max(2, Math.min(256, Math.round(params.colorCount)));

  // Bước 2.1: Gom toàn bộ pixel vào Histogram 18-bit (RGB666: 64x64x64 = 262,144 thùng)
  // Không bỏ sót bất kỳ chi tiết màu nhỏ nào (khắc phục hoàn toàn lỗi lấy mẫu stride bỏ sót chi tiết)
  const HIST_SIZE = 262144;
  const histBinMap = new Int32Array(HIST_SIZE).fill(-1);
  const pixelBinIndices = new Int32Array(totalPixels);

  const binCountList: number[] = [];
  const binSumRList: number[] = [];
  const binSumGList: number[] = [];
  const binSumBList: number[] = [];
  let numBins = 0;
  let opaquePixels = 0;

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    if (workingPixels[idx + 3] < 128) {
      pixelBinIndices[i] = -1;
      labelMap[i] = -1;
      continue;
    }

    const r = workingPixels[idx];
    const g = workingPixels[idx + 1];
    const b = workingPixels[idx + 2];
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);

    let binId = histBinMap[key];
    if (binId === -1) {
      binId = numBins++;
      histBinMap[key] = binId;
      binCountList.push(1);
      binSumRList.push(r);
      binSumGList.push(g);
      binSumBList.push(b);
    } else {
      binCountList[binId]++;
      binSumRList[binId] += r;
      binSumGList[binId] += g;
      binSumBList[binId] += b;
    }

    pixelBinIndices[i] = binId;
    opaquePixels++;
  }

  if (numBins === 0 || opaquePixels === 0) {
    labelMap.fill(-1);
    return { labelMap, palette: [] };
  }

  const binL = new Float32Array(numBins);
  const binA = new Float32Array(numBins);
  const binB = new Float32Array(numBins);
  const binWeight = new Float32Array(numBins);
  // Trọng số dùng cho khởi tạo K-Means++ (nén nhẹ bằng lũy thừa 0.75 để các chi tiết màu nhỏ nhưng rực rỡ vẫn được chọn)
  const initWeight = new Float32Array(numBins);

  let maxWeightBin = 0;
  for (let b = 0; b < numBins; b++) {
    const cnt = binCountList[b];
    const [l, la, lb] = rgbToLab(
      binSumRList[b] / cnt,
      binSumGList[b] / cnt,
      binSumBList[b] / cnt
    );
    binL[b] = l;
    binA[b] = la;
    binB[b] = lb;
    binWeight[b] = cnt;
    initWeight[b] = Math.pow(cnt, 0.75);
    if (cnt > binCountList[maxWeightBin]) {
      maxWeightBin = b;
    }
  }

  const effectiveK = Math.min(k, numBins);
  const cL = new Float32Array(effectiveK);
  const cA = new Float32Array(effectiveK);
  const cB = new Float32Array(effectiveK);

  // Tâm đầu tiên là thùng màu có tần suất cao nhất
  cL[0] = binL[maxWeightBin];
  cA[0] = binA[maxWeightBin];
  cB[0] = binB[maxWeightBin];

  const minDistSq = new Float32Array(numBins).fill(Infinity);

  // Bộ sinh số giả ngẫu nhiên cố định (Mulberry32) để khởi tạo K-Means++ không bị lệch vị trí địa lý
  let rngState = (numBins * 2654435761 + effectiveK * 1013904223) >>> 0;
  const nextRand = () => {
    rngState = (rngState + 0x6d2b79f5) >>> 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (let clusterIdx = 1; clusterIdx < effectiveK; clusterIdx++) {
    const prevL = cL[clusterIdx - 1];
    const prevA = cA[clusterIdx - 1];
    const prevB = cB[clusterIdx - 1];

    let totalWeightedDist = 0;
    for (let b = 0; b < numBins; b++) {
      const dl = binL[b] - prevL;
      const da = binA[b] - prevA;
      const db = binB[b] - prevB;
      const dSq = dl * dl + da * da + db * db;
      if (dSq < minDistSq[b]) {
        minDistSq[b] = dSq;
      }
      totalWeightedDist += minDistSq[b] * initWeight[b];
    }

    if (totalWeightedDist <= 1e-5) {
      const fallbackIdx = Math.min(
        numBins - 1,
        Math.floor((clusterIdx / effectiveK) * numBins)
      );
      cL[clusterIdx] = binL[fallbackIdx];
      cA[clusterIdx] = binA[fallbackIdx];
      cB[clusterIdx] = binB[fallbackIdx];
    } else {
      const target = totalWeightedDist * nextRand();
      let acc = 0;
      let chosen = numBins - 1;
      for (let b = 0; b < numBins; b++) {
        acc += minDistSq[b] * initWeight[b];
        if (acc >= target) {
          chosen = b;
          break;
        }
      }
      cL[clusterIdx] = binL[chosen];
      cA[clusterIdx] = binA[chosen];
      cB[clusterIdx] = binB[chosen];
    }
  }

  const sumL = new Float64Array(effectiveK);
  const sumA = new Float64Array(effectiveK);
  const sumB = new Float64Array(effectiveK);
  const counts = new Float64Array(effectiveK);

  const maxIters = effectiveK > 64 ? 10 : 14;
  for (let iter = 0; iter < maxIters; iter++) {
    sumL.fill(0);
    sumA.fill(0);
    sumB.fill(0);
    counts.fill(0);

    for (let b = 0; b < numBins; b++) {
      const bl = binL[b];
      const ba = binA[b];
      const bb = binB[b];
      const w = binWeight[b];

      let bestCluster = 0;
      let bestDist = Infinity;

      for (let c = 0; c < effectiveK; c++) {
        const dl = bl - cL[c];
        const da = ba - cA[c];
        const db = bb - cB[c];
        const dist = dl * dl + da * da + db * db;
        if (dist < bestDist) {
          bestDist = dist;
          bestCluster = c;
        }
      }

      sumL[bestCluster] += bl * w;
      sumA[bestCluster] += ba * w;
      sumB[bestCluster] += bb * w;
      counts[bestCluster] += w;
    }

    let maxShift = 0;
    for (let c = 0; c < effectiveK; c++) {
      if (counts[c] > 0) {
        const newL = sumL[c] / counts[c];
        const newA = sumA[c] / counts[c];
        const newB = sumB[c] / counts[c];
        const shift =
          (newL - cL[c]) * (newL - cL[c]) +
          (newA - cA[c]) * (newA - cA[c]) +
          (newB - cB[c]) * (newB - cB[c]);
        if (shift > maxShift) maxShift = shift;
        cL[c] = newL;
        cA[c] = newA;
        cB[c] = newB;
      }
    }
    if (maxShift < 0.04) break;
  }

  const clusterOrder = Array.from({ length: effectiveK }, (_, i) => i).sort(
    (a, b) => counts[b] - counts[a]
  );
  const clusterRedirect = new Int32Array(effectiveK);
  for (let i = 0; i < effectiveK; i++) clusterRedirect[i] = i;

  const mergeDeltaSq = params.colorMergeDeltaE * params.colorMergeDeltaE;

  for (let i = 0; i < effectiveK; i++) {
    const cPrimary = clusterOrder[i];
    if (counts[cPrimary] === 0 || clusterRedirect[cPrimary] !== cPrimary)
      continue;

    for (let j = i + 1; j < effectiveK; j++) {
      const cSecondary = clusterOrder[j];
      if (counts[cSecondary] === 0 || clusterRedirect[cSecondary] !== cSecondary)
        continue;

      const dl = cL[cPrimary] - cL[cSecondary];
      const da = cA[cPrimary] - cA[cSecondary];
      const db = cB[cPrimary] - cB[cSecondary];
      const distSq = dl * dl + da * da + db * db;

      if (distSq <= mergeDeltaSq) {
        clusterRedirect[cSecondary] = cPrimary;
      }
    }
  }

  const activeClusterIds: number[] = [];
  for (let i = 0; i < effectiveK; i++) {
    const c = clusterOrder[i];
    if (counts[c] > 0 && clusterRedirect[c] === c) {
      activeClusterIds.push(c);
    }
  }

  const finalCount = Math.max(1, activeClusterIds.length);
  const fL = new Float32Array(finalCount);
  const fA = new Float32Array(finalCount);
  const fB = new Float32Array(finalCount);

  for (let m = 0; m < finalCount; m++) {
    const orig = activeClusterIds[m] ?? 0;
    fL[m] = cL[orig];
    fA[m] = cA[orig];
    fB[m] = cB[orig];
  }

  // Bước 2.2: Ánh xạ từng thùng màu 18-bit vào cụm cuối cùng chính xác nhất
  const binToFinalCluster = new Int32Array(numBins);
  const accumR = new Float64Array(finalCount);
  const accumG = new Float64Array(finalCount);
  const accumB = new Float64Array(finalCount);
  const pixelCounts = new Int32Array(finalCount);

  for (let b = 0; b < numBins; b++) {
    const bl = binL[b];
    const ba = binA[b];
    const bb = binB[b];
    let minDist = Infinity;
    let bestM = 0;
    for (let m = 0; m < finalCount; m++) {
      const dl = bl - fL[m];
      const da = ba - fA[m];
      const db = bb - fB[m];
      const d = dl * dl + da * da + db * db;
      if (d < minDist) {
        minDist = d;
        bestM = m;
      }
    }
    binToFinalCluster[b] = bestM;
    accumR[bestM] += binSumRList[b];
    accumG[bestM] += binSumGList[b];
    accumB[bestM] += binSumBList[b];
    pixelCounts[bestM] += binCountList[b];
  }

  // Bước 2.3: Gán nhãn cho toàn bộ pixel với độ phức tạp O(1) mỗi pixel
  for (let i = 0; i < totalPixels; i++) {
    const binId = pixelBinIndices[i];
    if (binId >= 0) {
      labelMap[i] = binToFinalCluster[binId];
    }
  }

  const palette: PaletteColor[] = [];
  const safeTotal = Math.max(1, opaquePixels);

  for (let m = 0; m < finalCount; m++) {
    const cnt = pixelCounts[m];
    const r = cnt > 0 ? Math.round(accumR[m] / cnt) : 0;
    const g = cnt > 0 ? Math.round(accumG[m] / cnt) : 0;
    const b = cnt > 0 ? Math.round(accumB[m] / cnt) : 0;
    palette.push({
      id: m,
      r,
      g,
      b,
      a: 255,
      hex: rgbToHex(r, g, b),
      pixelCount: cnt,
      percentage: (cnt / safeTotal) * 100,
      visible: true,
    });
  }

  if (useSingleLineExtraction && thinStrokeMask) {
    let strokePixels = 0;
    for (let i = 0; i < totalPixels; i++) {
      if (thinStrokeMask[i]) strokePixels++;
    }
    if (strokePixels > 0) {
      const strokeId = palette.length;
      palette.push({
        id: strokeId,
        r: extractedStrokeColor.r,
        g: extractedStrokeColor.g,
        b: extractedStrokeColor.b,
        a: 255,
        hex: extractedStrokeColor.hex,
        pixelCount: strokePixels,
        percentage: (strokePixels / safeTotal) * 100,
        visible: true,
        isStrokeLayer: true,
      });
    }
  }

  return { labelMap, palette, thinStrokeMask };
}
