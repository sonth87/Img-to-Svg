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
/**
 * Bản đồ khoảng cách Chamfer 2 lượt (trọng số 1 / √2) tới pixel hạt giống gần nhất.
 * Viền khung ảnh được coi như hạt giống khi `isSeed` đánh dấu nền (pixel ngoài ảnh là nền).
 */
export function chamferDistance(
  totalPixels: number,
  width: number,
  height: number,
  isSeed: (i: number) => boolean
): Float32Array {
  const dist = new Float32Array(totalPixels);
  const INF = 1e9;
  for (let i = 0; i < totalPixels; i++) dist[i] = isSeed(i) ? 0 : INF;
  const D = Math.SQRT2;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      let d = dist[i];
      if (d === 0) continue;
      if (x > 0) d = Math.min(d, dist[i - 1] + 1);
      if (y > 0) {
        d = Math.min(d, dist[i - width] + 1);
        if (x > 0) d = Math.min(d, dist[i - width - 1] + D);
        if (x + 1 < width) d = Math.min(d, dist[i - width + 1] + D);
      }
      dist[i] = d;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    const row = y * width;
    for (let x = width - 1; x >= 0; x--) {
      const i = row + x;
      let d = dist[i];
      if (d === 0) continue;
      if (x + 1 < width) d = Math.min(d, dist[i + 1] + 1);
      if (y + 1 < height) {
        d = Math.min(d, dist[i + width] + 1);
        if (x + 1 < width) d = Math.min(d, dist[i + width + 1] + D);
        if (x > 0) d = Math.min(d, dist[i + width - 1] + D);
      }
      dist[i] = d;
    }
  }
  return dist;
}

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
  strokeCoverage: number;
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

  // Bước 2: Phép mở hình thái bằng đĩa tròn (Disc Opening) qua bản đồ khoảng cách:
  // - Nhân đặc (Thick Core): pixel tối cách nền xa hơn R=5px (khối dày > 10px như đồng tử, mũi).
  // - Khối đặc = mọi pixel tối nằm trong bán kính R quanh nhân -> tái tạo đúng hình tròn/elip của khối
  //   mà KHÔNG nuốt nét mảnh chạy sát bên cạnh (phần tử vuông cũ vươn tới ~10px theo đường chéo).
  const coreRadius = 5;
  const distToLight = chamferDistance(totalPixels, width, height, (i) => !darkMask[i]);
  const thickCore = new Uint8Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    if (darkMask[i] && distToLight[i] > coreRadius) thickCore[i] = 1;
  }

  const distToCore = chamferDistance(totalPixels, width, height, (i) => thickCore[i] === 1);
  const solidDarkBlob = new Uint8Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    if (darkMask[i] && distToCore[i] <= coreRadius + 0.5) solidDarkBlob[i] = 1;
  }

  // Vành anti-alias mềm (pixel xám nhạt hơn ngưỡng mực) bao quanh khối thuộc về khối, không phải nét mảnh;
  // bước 3b bên dưới sẽ cắt chính xác vành này tại mức sáng 50%.
  const distToBlob = chamferDistance(totalPixels, width, height, (i) => solidDarkBlob[i] === 1);
  for (let i = 0; i < totalPixels; i++) {
    if (darkMask[i] && !solidDarkBlob[i] && rawLum[i] >= inkThreshold && distToBlob[i] <= 2.5) {
      solidDarkBlob[i] = 1;
    }
  }

  // Trả lại cho khối đặc các mảnh dư nhỏ dính liền với nó (đầu nhọn của elip mũi, góc lượn...)
  // vì phép mở bằng đĩa tròn không với tới. Nét mảnh thật luôn là một mảnh dài, diện tích lớn.
  const maxTipArea = coreRadius * coreRadius * 5;
  const compVisited = new Uint8Array(totalPixels);
  const compQueue: number[] = [];
  for (let start = 0; start < totalPixels; start++) {
    if (!darkMask[start] || solidDarkBlob[start] || compVisited[start]) continue;
    compQueue.length = 0;
    compQueue.push(start);
    compVisited[start] = 1;
    let touchesBlob = false;
    let maxReach = 0;
    for (let q = 0; q < compQueue.length && compQueue.length <= maxTipArea; q++) {
      const idx = compQueue[q];
      if (distToBlob[idx] > maxReach) maxReach = distToBlob[idx];
      const cx = idx % width;
      const cy = (idx - cx) / width;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = cy + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          if (nx < 0 || nx >= width) continue;
          const nIdx = ny * width + nx;
          if (solidDarkBlob[nIdx]) {
            touchesBlob = true;
          } else if (darkMask[nIdx] && !compVisited[nIdx]) {
            compVisited[nIdx] = 1;
            compQueue.push(nIdx);
          }
        }
      }
    }
    // Đầu nhọn thì ngắn & dày (diện tích / độ vươn xa khỏi khối lớn); râu mèo, nét mảnh chạm khối thì dài & mỏng ~1-2px
    const meanThickness = compQueue.length / Math.max(1, maxReach);
    if (touchesBlob && compQueue.length <= maxTipArea && (maxReach <= 3 || meanThickness >= 2.5)) {
      for (const idx of compQueue) solidDarkBlob[idx] = 1;
    }
  }

  // Nét mảnh (Thin Stroke) = Pixel tối NHƯNG không thuộc khối đặc lớn
  const thinStrokeMask = new Uint8Array(totalPixels);
  const lumHist = new Uint32Array(256);
  let strokePixelCount = 0;
  for (let i = 0; i < totalPixels; i++) {
    if (darkMask[i] && !solidDarkBlob[i]) {
      thinStrokeMask[i] = 1;
      lumHist[Math.min(255, Math.round(rawLum[i]))]++;
      strokePixelCount++;
    }
  }

  // Màu mực thực = trung bình 20% pixel đậm nhất (lõi nét). Trung bình có trọng số cả viền xám
  // anti-alias làm nét 1px ra màu xám nhạt hơn hẳn ảnh gốc.
  let coreLumLimit = 255;
  for (let l = 0, acc = 0; l < 256; l++) {
    acc += lumHist[l];
    if (acc >= strokePixelCount * 0.2) {
      coreLumLimit = l;
      break;
    }
  }
  let strokeSumR = 0;
  let strokeSumG = 0;
  let strokeSumB = 0;
  let strokeCoreCount = 0;
  for (let i = 0; i < totalPixels; i++) {
    if (!thinStrokeMask[i] || rawLum[i] > coreLumLimit + 0.5) continue;
    const pOff = i * 4;
    strokeSumR += rawPixels[pOff];
    strokeSumG += rawPixels[pOff + 1];
    strokeSumB += rawPixels[pOff + 2];
    strokeCoreCount++;
  }

  const sR = strokeCoreCount > 0 ? Math.round(strokeSumR / strokeCoreCount) : 22;
  const sG = strokeCoreCount > 0 ? Math.round(strokeSumG / strokeCoreCount) : 27;
  const sB = strokeCoreCount > 0 ? Math.round(strokeSumB / strokeCoreCount) : 34;
  const strokeColor = {
    r: sR,
    g: sG,
    b: sB,
    hex: rgbToHex(sR, sG, sB),
  };

  // Tỉ lệ phủ mực: tổng độ đậm (0..1 so với nền cục bộ) của nét + viền 1px quanh nét, chia cho số pixel mask.
  // Mask nhị phân gộp cả pixel xám nửa phủ nên đếm pixel/độ dài khung xương thổi phồng nét 1px lên ~2px.
  const inkLum = 0.299 * sR + 0.587 * sG + 0.114 * sB;
  let coverageSum = 0;
  for (let y = 2; y < height - 2; y++) {
    const row = y * width;
    for (let x = 2; x < width - 2; x++) {
      const i = row + x;
      if (solidDarkBlob[i]) continue;
      if (
        !thinStrokeMask[i] &&
        !thinStrokeMask[i - 1] &&
        !thinStrokeMask[i + 1] &&
        !thinStrokeMask[i - width] &&
        !thinStrokeMask[i + width]
      ) {
        continue;
      }
      let localBg = rawLum[i];
      for (let dy = -2; dy <= 2; dy++) {
        const rOff = row + dy * width;
        for (let dx = -2; dx <= 2; dx++) {
          const nIdx = rOff + x + dx;
          if (!solidDarkBlob[nIdx] && rawLum[nIdx] > localBg) localBg = rawLum[nIdx];
        }
      }
      const contrast = localBg - inkLum;
      if (contrast < 30) {
        if (thinStrokeMask[i]) coverageSum += 1;
        continue;
      }
      coverageSum += Math.max(0, Math.min(1, (localBg - rawLum[i]) / contrast));
    }
  }
  const strokeCoverage =
    strokePixelCount > 0 ? Math.max(0.3, Math.min(1, coverageSum / strokePixelCount)) : 1;

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

  // Bước 3b: Chuẩn hóa viền khối mực đặc (đồng tử, mũi...): quầng xám anti-alias quanh khối đặc
  // được cắt tại mức 50% giữa màu mực và màu nền cục bộ -> pixel tối hơn sơn hẳn màu mực, sáng hơn thì
  // inpaint theo nền. Nhờ vậy không còn lớp màu xám rác bám quanh khối và biên khối tròn đúng hình gốc.
  let coreSumR = 0;
  let coreSumG = 0;
  let coreSumB = 0;
  let coreCount = 0;
  for (let i = 0; i < totalPixels; i++) {
    if (!thickCore[i]) continue;
    const pOff = i * 4;
    coreSumR += rawPixels[pOff];
    coreSumG += rawPixels[pOff + 1];
    coreSumB += rawPixels[pOff + 2];
    coreCount++;
  }

  // Pixel đã chốt là mực của khối đặc: không bị Inpaint ghi đè và không làm nguồn màu Inpaint
  // (tránh khối đen lan dần vào khe hở giữa khối và nét mảnh chạy sát bên).
  const blobInk = new Uint8Array(totalPixels);

  if (coreCount > 0) {
    const blobR = Math.round(coreSumR / coreCount);
    const blobG = Math.round(coreSumG / coreCount);
    const blobB = Math.round(coreSumB / coreCount);
    const blobLum = 0.299 * blobR + 0.587 * blobG + 0.114 * blobB;
    const rimRadius = 2;
    const rimCandidate = new Uint8Array(totalPixels);

    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        if (!solidDarkBlob[row + x]) continue;
        const y0 = Math.max(0, y - rimRadius);
        const y1 = Math.min(height - 1, y + rimRadius);
        const x0 = Math.max(0, x - rimRadius);
        const x1 = Math.min(width - 1, x + rimRadius);
        for (let ny = y0; ny <= y1; ny++) {
          const rOff = ny * width;
          for (let nx = x0; nx <= x1; nx++) {
            rimCandidate[rOff + nx] = 1;
          }
        }
      }
    }

    for (let y = rimRadius; y < height - rimRadius; y++) {
      const row = y * width;
      for (let x = rimRadius; x < width - rimRadius; x++) {
        const i = row + x;
        if (!rimCandidate[i] || thinStrokeMask[i]) continue;
        if (rawPixels[i * 4 + 3] < 128) continue;

        let bgLum = rawLum[i];
        for (let dy = -rimRadius; dy <= rimRadius; dy++) {
          const rOff = (y + dy) * width;
          for (let dx = -rimRadius; dx <= rimRadius; dx++) {
            const nl = rawLum[rOff + x + dx];
            if (nl > bgLum) bgLum = nl;
          }
        }
        // Lõi khối đặc (xung quanh toàn mực) giữ nguyên
        if (bgLum - blobLum < 40) {
          if (solidDarkBlob[i]) {
            const pOff = i * 4;
            inpaintedPixels[pOff] = blobR;
            inpaintedPixels[pOff + 1] = blobG;
            inpaintedPixels[pOff + 2] = blobB;
            blobInk[i] = 1;
            toInpaint[i] = 0;
          }
          continue;
        }

        // So ngưỡng trên độ sáng trung bình 3x3 để pixel nhiễu lẻ ngay mép không bị lật màu thành khía/u
        let localLum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const rOff = (y + dy) * width + x;
          localLum += rawLum[rOff - 1] + rawLum[rOff] + rawLum[rOff + 1];
        }
        localLum = (localLum + rawLum[i]) / 10;
        if (localLum <= (bgLum + blobLum) * 0.5) {
          const pOff = i * 4;
          inpaintedPixels[pOff] = blobR;
          inpaintedPixels[pOff + 1] = blobG;
          inpaintedPixels[pOff + 2] = blobB;
          blobInk[i] = 1;
          toInpaint[i] = 0;
        } else {
          toInpaint[i] = 1;
        }
      }
    }
  }

  const resolved = new Uint8Array(totalPixels);
  const unresolvedList: number[] = [];

  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      if (smoothedPixels[i * 4 + 3] < 128) continue;
      if (toInpaint[i] === 0) {
        // 2 = đã chốt nhưng không làm nguồn lan màu (vòng lặp chỉ lấy nguồn có resolved === 1)
        resolved[i] = blobInk[i] ? 2 : 1;
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

  return { inpaintedPixels, thinStrokeMask, strokeColor, strokeCoverage };
}

/**
 * Ảnh có phải bản vẽ nét mực trên giấy không? (nền viền ảnh gần trắng & không màu, hoặc trong suốt,
 * và phần không-phải-nền chủ yếu là mực tối chứ không phải mảng màu trung tính / đổ bóng).
 */
function looksLikeInkOnPaper(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  inkThreshold: number
): boolean {
  let paper = 0;
  let border = 0;
  const step = Math.max(1, Math.floor((width + height) / 400));
  const sample = (x: number, y: number) => {
    const idx = (y * width + x) * 4;
    border++;
    if (src[idx + 3] < 128) {
      paper++;
      return;
    }
    const r = src[idx];
    const g = src[idx + 1];
    const b = src[idx + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum >= 200 && Math.max(r, g, b) - Math.min(r, g, b) <= 40) paper++;
  };
  for (let x = 0; x < width; x += step) {
    sample(x, 0);
    sample(x, height - 1);
  }
  for (let y = 0; y < height; y += step) {
    sample(0, y);
    sample(width - 1, y);
  }
  if (paper < border * 0.7) return false;

  let ink = 0;
  let midtone = 0;
  for (let i = 0; i < width * height; i += 3) {
    const idx = i * 4;
    if (src[idx + 3] < 128) continue;
    const r = src[idx];
    const g = src[idx + 1];
    const b = src[idx + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum < inkThreshold) ink++;
    else if (lum < 200 || Math.max(r, g, b) - Math.min(r, g, b) > 40) midtone++;
  }
  return midtone <= ink;
}

/**
 * Bản phác thảo từ ẢNH MÀU / ẢNH RENDER: dò cạnh Canny trên ảnh đã làm mờ theo tỉ lệ ảnh
 * (xóa kết cấu nhỏ như vảy, lông), giữ đường bao & cạnh chính, bỏ mẩu cạnh vụn.
 * Ngưỡng độ tối không dùng được ở đây: đổ bóng & kết cấu biến thành lưới chấm dày đặc.
 */
function buildEdgeSketchMask(
  src: Uint8ClampedArray,
  width: number,
  height: number
): Uint8Array {
  const total = width * height;
  const sigma = Math.max(1.5, Math.min(width, height) / 380);
  const radius = Math.ceil(sigma * 3);
  const kernel = new Float32Array(radius * 2 + 1);
  let kSum = 0;
  for (let k = -radius; k <= radius; k++) {
    kernel[k + radius] = Math.exp(-(k * k) / (2 * sigma * sigma));
    kSum += kernel[k + radius];
  }
  for (let k = 0; k < kernel.length; k++) kernel[k] /= kSum;

  // Làm mờ Gauss tách trục cho 3 kênh (pixel trong suốt coi như nền trắng)
  const chans = [new Float32Array(total), new Float32Array(total), new Float32Array(total)];
  for (let i = 0; i < total; i++) {
    const a = src[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) chans[c][i] = src[i * 4 + c] * a + 255 * (1 - a);
  }
  const tmp = new Float32Array(total);
  for (const ch of chans) {
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        let acc = 0;
        for (let k = -radius; k <= radius; k++) {
          const xx = Math.min(width - 1, Math.max(0, x + k));
          acc += ch[row + xx] * kernel[k + radius];
        }
        tmp[row + x] = acc;
      }
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let acc = 0;
        for (let k = -radius; k <= radius; k++) {
          const yy = Math.min(height - 1, Math.max(0, y + k));
          acc += tmp[yy * width + x] * kernel[k + radius];
        }
        ch[y * width + x] = acc;
      }
    }
  }

  // Gradient màu Sobel (cộng bình phương 3 kênh) -> cạnh vàng/xanh mạnh dù độ sáng gần nhau
  const mag = new Float32Array(total);
  const gxs = new Float32Array(total);
  const gys = new Float32Array(total);
  let maxMag = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      for (const ch of chans) {
        const gx =
          ch[i - width + 1] + 2 * ch[i + 1] + ch[i + width + 1] -
          ch[i - width - 1] - 2 * ch[i - 1] - ch[i + width - 1];
        const gy =
          ch[i + width - 1] + 2 * ch[i + width] + ch[i + width + 1] -
          ch[i - width - 1] - 2 * ch[i - width] - ch[i - width + 1];
        sxx += gx * gx;
        syy += gy * gy;
        sxy += gx * gy;
      }
      // Hướng chủ đạo của tensor cấu trúc màu (Di Zenzo)
      const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      const m = Math.sqrt(Math.max(0, 0.5 * (sxx + syy + Math.sqrt((sxx - syy) ** 2 + 4 * sxy * sxy))));
      mag[i] = m;
      gxs[i] = Math.cos(theta);
      gys[i] = Math.sin(theta);
      if (m > maxMag) maxMag = m;
    }
  }
  const edges = new Uint8Array(total);
  if (maxMag <= 0) return edges;

  // Non-maximum suppression theo hướng gradient
  const nms = new Float32Array(total);
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const i = y * width + x;
      const m = mag[i];
      if (m <= 0) continue;
      const dx = Math.round(gxs[i]);
      const dy = Math.round(gys[i]);
      if (m >= mag[i + dy * width + dx] && m >= mag[i - dy * width - dx]) nms[i] = m;
    }
  }

  // Ngưỡng trễ (hysteresis) theo phân vị của các đỉnh cạnh
  const hist = new Uint32Array(1024);
  let candidates = 0;
  for (let i = 0; i < total; i++) {
    if (nms[i] > 0) {
      hist[Math.min(1023, Math.floor((nms[i] / maxMag) * 1023))]++;
      candidates++;
    }
  }
  let highBin = 1023;
  for (let b = 1023, acc = 0; b >= 0; b--) {
    acc += hist[b];
    if (acc >= candidates * 0.12) {
      highBin = b;
      break;
    }
  }
  const high = (highBin / 1023) * maxMag;
  const low = high * 0.45;
  const stack: number[] = [];
  for (let i = 0; i < total; i++) {
    if (nms[i] >= high && !edges[i]) {
      edges[i] = 1;
      stack.push(i);
      while (stack.length) {
        const c = stack.pop()!;
        const cx = c % width;
        const cy = (c - cx) / width;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const n = ny * width + nx;
            if (!edges[n] && nms[n] >= low) {
              edges[n] = 1;
              stack.push(n);
            }
          }
        }
      }
    }
  }

  // Bỏ mẩu cạnh vụn (kết cấu còn sót) — chỉ giữ đường đủ dài
  const minLen = Math.max(12, Math.round(Math.min(width, height) / 25));
  const seen = new Uint8Array(total);
  const comp: number[] = [];
  for (let start = 0; start < total; start++) {
    if (!edges[start] || seen[start]) continue;
    comp.length = 0;
    comp.push(start);
    seen[start] = 1;
    for (let q = 0; q < comp.length; q++) {
      const c = comp[q];
      const cx = c % width;
      const cy = (c - cx) / width;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const n = ny * width + nx;
          if (edges[n] && !seen[n]) {
            seen[n] = 1;
            comp.push(n);
          }
        }
      }
    }
    if (comp.length < minLen) {
      for (const c of comp) edges[c] = 0;
    }
  }
  return edges;
}

/**
 * Phân loại độ trong suốt của từng pixel theo các "mức opacity" phẳng có thật trong ảnh.
 * Icon / logo hay có mảng bán trong suốt (vd. đen alpha 40%): trước đây ngưỡng cứng alpha < 128
 * xóa sạch các mảng này. Mức opacity = đỉnh histogram alpha của các pixel nằm giữa mảng (3x3 đồng đều);
 * pixel viền anti-alias chỉ được gán vào mức bán trong suốt khi ở gần lõi của mức đó, nên viền mờ
 * của mảng đặc vẫn cắt ở ngưỡng 50% như cũ (không sinh quầng mờ quanh mọi hình).
 * Trả về `levels` (tăng dần, phần tử cuối luôn là 255) và `pixelLevel` (chỉ số mức, -1 = trong suốt).
 */
function classifyAlphaLevels(
  src: Uint8ClampedArray,
  width: number,
  height: number
): { levels: number[]; pixelLevel: Int8Array } {
  const totalPixels = width * height;
  const pixelLevel = new Int8Array(totalPixels).fill(-1);

  const plateauHist = new Float64Array(256);
  let visiblePixels = 0;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const a = src[(row + x) * 4 + 3];
      if (a >= 16) visiblePixels++;
      if (a < 16 || a >= 240 || x === 0 || y === 0 || x === width - 1 || y === height - 1)
        continue;
      let minA = a;
      let maxA = a;
      for (let dy = -1; dy <= 1; dy++) {
        const rOff = (y + dy) * width + x;
        for (let dx = -1; dx <= 1; dx++) {
          const na = src[(rOff + dx) * 4 + 3];
          if (na < minA) minA = na;
          if (na > maxA) maxA = na;
        }
      }
      if (maxA - minA <= 6) plateauHist[a]++;
    }
  }

  // Đỉnh histogram đủ lớn VÀ đủ nhọn mới tính là 1 mức opacity (tối đa 4 mức bán trong suốt).
  // Mảng phẳng thật dồn gần hết vào ±2 quanh đỉnh; bóng đổ mờ (alpha giảm dần) trải đều nên bị loại.
  const minPeak = Math.max(12, visiblePixels * 0.01);
  const windowSum = (c: number, radius: number) => {
    let s = 0;
    for (let v = Math.max(0, c - radius); v <= Math.min(255, c + radius); v++) s += plateauHist[v];
    return s;
  };
  const peaks: { alpha: number; weight: number }[] = [];
  for (let a = 16; a < 240; a++) {
    if (plateauHist[a] === 0) continue;
    const w = windowSum(a, 2);
    if (w < minPeak || w < windowSum(a, 12) * 0.75) continue;
    let isMax = true;
    for (let v = Math.max(16, a - 12); v <= Math.min(239, a + 12) && isMax; v++) {
      if (v !== a && (plateauHist[v] > plateauHist[a] || (plateauHist[v] === plateauHist[a] && v < a)))
        isMax = false;
    }
    if (isMax) peaks.push({ alpha: a, weight: w });
  }
  const levels = peaks
    .sort((p, q) => q.weight - p.weight)
    .slice(0, 4)
    .map((p) => p.alpha)
    .sort((p, q) => p - q);
  levels.push(255);
  const opaqueLevel = levels.length - 1;

  if (opaqueLevel === 0) {
    for (let i = 0; i < totalPixels; i++) {
      if (src[i * 4 + 3] >= 128) pixelLevel[i] = 0;
    }
    return { levels, pixelLevel };
  }

  // Lõi của từng mức bán trong suốt (pixel giữa mảng, alpha sát mức)
  const coreLevel = new Int8Array(totalPixels).fill(-1);
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const a = src[i * 4 + 3];
      for (let l = 0; l < opaqueLevel; l++) {
        if (Math.abs(a - levels[l]) > 8) continue;
        let uniform = true;
        for (let dy = -1; dy <= 1 && uniform; dy++) {
          const rOff = (y + dy) * width + x;
          for (let dx = -1; dx <= 1; dx++) {
            if (Math.abs(src[(rOff + dx) * 4 + 3] - levels[l]) > 8) {
              uniform = false;
              break;
            }
          }
        }
        if (uniform) coreLevel[i] = l;
        break;
      }
    }
  }

  // Ứng viên mỗi pixel = {trong suốt, 255} ∪ các mức có lõi trong bán kính R; chọn mức có alpha gần nhất
  const R = 5;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      const a = src[i * 4 + 3];
      if (a < 8) continue;
      let best = a >= 128 ? opaqueLevel : -1;
      let bestDiff = a >= 128 ? 255 - a : a;
      if (coreLevel[i] >= 0) {
        pixelLevel[i] = coreLevel[i];
        continue;
      }
      const y0 = Math.max(0, y - R);
      const y1 = Math.min(height - 1, y + R);
      const x0 = Math.max(0, x - R);
      const x1 = Math.min(width - 1, x + R);
      for (let ny = y0; ny <= y1; ny++) {
        const rOff = ny * width;
        for (let nx = x0; nx <= x1; nx++) {
          const l = coreLevel[rOff + nx];
          if (l < 0) continue;
          const d = Math.abs(a - levels[l]);
          if (d < bestDiff) {
            bestDiff = d;
            best = l;
          }
        }
      }
      pixelLevel[i] = best;
    }
  }

  return { levels, pixelLevel };
}

/** Khoảng cách alpha quy đổi sang đơn vị Delta-E (100% vs 40% opacity ≈ 60) để không gộp lẫn các mức opacity */
const ALPHA_DISTANCE_SCALE = 100 / 255;

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

    // Ảnh màu / render / ảnh chụp -> phác thảo theo cạnh, nét mực đen
    const edgeMask =
      params.mode === 'centerline' &&
      !looksLikeInkOnPaper(srcBuf, width, height, thresh)
        ? buildEdgeSketchMask(srcBuf, width, height)
        : null;
    if (edgeMask) {
      for (let i = 0; i < totalPixels; i++) {
        if (edgeMask[i]) {
          labelMap[i] = 0;
          thinStrokeMask[i] = 1;
          inkSumR += 24;
          inkSumG += 24;
          inkSumB += 24;
          darkCount++;
        } else {
          labelMap[i] = srcBuf[i * 4 + 3] < 128 ? -1 : 1;
          if (labelMap[i] === 1) lightCount++;
        }
      }
    }

    for (let i = 0; i < totalPixels && !edgeMask; i++) {
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
  let extractedStrokeCoverage = 1;

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
    extractedStrokeCoverage = extracted.strokeCoverage;
  }

  // Hỗ trợ phân cụm từ 2 đến 256 màu bằng thuật toán Weighted 18-bit Histogram K-Means++
  const k = Math.max(2, Math.min(256, Math.round(params.colorCount)));

  // Bước 2.1: Gom toàn bộ pixel vào Histogram 18-bit (RGB666: 64x64x64 = 262,144 thùng)
  // Không bỏ sót bất kỳ chi tiết màu nhỏ nào (khắc phục hoàn toàn lỗi lấy mẫu stride bỏ sót chi tiết)
  // Mỗi mức opacity có histogram riêng -> màu ở 2 mức opacity khác nhau không bao giờ chung thùng
  const { levels: alphaLevels, pixelLevel } = classifyAlphaLevels(
    workingPixels,
    width,
    height
  );
  const HIST_SIZE = 262144;
  const histBinMap = new Int32Array(HIST_SIZE * alphaLevels.length).fill(-1);
  const pixelBinIndices = new Int32Array(totalPixels);

  const binCountList: number[] = [];
  const binSumRList: number[] = [];
  const binSumGList: number[] = [];
  const binSumBList: number[] = [];
  const binAlphaList: number[] = [];
  let numBins = 0;
  let opaquePixels = 0;

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const level = pixelLevel[i];
    if (level < 0) {
      pixelBinIndices[i] = -1;
      labelMap[i] = -1;
      continue;
    }

    const r = workingPixels[idx];
    const g = workingPixels[idx + 1];
    const b = workingPixels[idx + 2];
    const key =
      level * HIST_SIZE + (((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2));

    let binId = histBinMap[key];
    if (binId === -1) {
      binId = numBins++;
      histBinMap[key] = binId;
      binCountList.push(1);
      binSumRList.push(r);
      binSumGList.push(g);
      binSumBList.push(b);
      binAlphaList.push(alphaLevels[level]);
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
  const binAl = new Float32Array(numBins);
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
    binAl[b] = binAlphaList[b] * ALPHA_DISTANCE_SCALE;
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
  const cAl = new Float32Array(effectiveK);

  // Tâm đầu tiên là thùng màu có tần suất cao nhất
  cL[0] = binL[maxWeightBin];
  cA[0] = binA[maxWeightBin];
  cB[0] = binB[maxWeightBin];
  cAl[0] = binAl[maxWeightBin];

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
    const prevAl = cAl[clusterIdx - 1];

    let totalWeightedDist = 0;
    for (let b = 0; b < numBins; b++) {
      const dl = binL[b] - prevL;
      const da = binA[b] - prevA;
      const db = binB[b] - prevB;
      const dal = binAl[b] - prevAl;
      const dSq = dl * dl + da * da + db * db + dal * dal;
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
      cAl[clusterIdx] = binAl[fallbackIdx];
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
      cAl[clusterIdx] = binAl[chosen];
    }
  }

  const sumL = new Float64Array(effectiveK);
  const sumA = new Float64Array(effectiveK);
  const sumB = new Float64Array(effectiveK);
  const sumAl = new Float64Array(effectiveK);
  const counts = new Float64Array(effectiveK);

  const maxIters = effectiveK > 64 ? 10 : 14;
  for (let iter = 0; iter < maxIters; iter++) {
    sumL.fill(0);
    sumA.fill(0);
    sumB.fill(0);
    sumAl.fill(0);
    counts.fill(0);

    for (let b = 0; b < numBins; b++) {
      const bl = binL[b];
      const ba = binA[b];
      const bb = binB[b];
      const bal = binAl[b];
      const w = binWeight[b];

      let bestCluster = 0;
      let bestDist = Infinity;

      for (let c = 0; c < effectiveK; c++) {
        const dl = bl - cL[c];
        const da = ba - cA[c];
        const db = bb - cB[c];
        const dal = bal - cAl[c];
        const dist = dl * dl + da * da + db * db + dal * dal;
        if (dist < bestDist) {
          bestDist = dist;
          bestCluster = c;
        }
      }

      sumL[bestCluster] += bl * w;
      sumA[bestCluster] += ba * w;
      sumB[bestCluster] += bb * w;
      sumAl[bestCluster] += bal * w;
      counts[bestCluster] += w;
    }

    let maxShift = 0;
    for (let c = 0; c < effectiveK; c++) {
      if (counts[c] > 0) {
        const newL = sumL[c] / counts[c];
        const newA = sumA[c] / counts[c];
        const newB = sumB[c] / counts[c];
        const newAl = sumAl[c] / counts[c];
        const shift =
          (newL - cL[c]) * (newL - cL[c]) +
          (newA - cA[c]) * (newA - cA[c]) +
          (newB - cB[c]) * (newB - cB[c]) +
          (newAl - cAl[c]) * (newAl - cAl[c]);
        if (shift > maxShift) maxShift = shift;
        cL[c] = newL;
        cA[c] = newA;
        cB[c] = newB;
        cAl[c] = newAl;
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
      const dal = cAl[cPrimary] - cAl[cSecondary];
      const distSq = dl * dl + da * da + db * db + dal * dal;

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
  const fAl = new Float32Array(finalCount);

  for (let m = 0; m < finalCount; m++) {
    const orig = activeClusterIds[m] ?? 0;
    fL[m] = cL[orig];
    fA[m] = cA[orig];
    fB[m] = cB[orig];
    fAl[m] = cAl[orig];
  }

  // Bước 2.2: Ánh xạ từng thùng màu 18-bit vào cụm cuối cùng chính xác nhất
  const binToFinalCluster = new Int32Array(numBins);
  const accumR = new Float64Array(finalCount);
  const accumG = new Float64Array(finalCount);
  const accumB = new Float64Array(finalCount);
  const accumAlpha = new Float64Array(finalCount);
  const pixelCounts = new Int32Array(finalCount);

  for (let b = 0; b < numBins; b++) {
    const bl = binL[b];
    const ba = binA[b];
    const bb = binB[b];
    const bal = binAl[b];
    let minDist = Infinity;
    let bestM = 0;
    for (let m = 0; m < finalCount; m++) {
      const dl = bl - fL[m];
      const da = ba - fA[m];
      const db = bb - fB[m];
      const dal = bal - fAl[m];
      const d = dl * dl + da * da + db * db + dal * dal;
      if (d < minDist) {
        minDist = d;
        bestM = m;
      }
    }
    binToFinalCluster[b] = bestM;
    accumR[bestM] += binSumRList[b];
    accumG[bestM] += binSumGList[b];
    accumB[bestM] += binSumBList[b];
    accumAlpha[bestM] += binAlphaList[b] * binCountList[b];
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
    const a = cnt > 0 ? Math.round(accumAlpha[m] / cnt) : 255;
    palette.push({
      id: m,
      r,
      g,
      b,
      a,
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
        strokeCoverage: extractedStrokeCoverage,
      });
    }
  }

  return { labelMap, palette, thinStrokeMask };
}
