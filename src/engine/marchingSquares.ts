/**
 * BƯỚC 4: TÁCH LỚP XẾP CHỒNG & DÒ ĐƯỜNG VIỀN ĐA GIÁC (LAYER STACKING & CONTOUR TRACING)
 *
 * Cải tiến quan trọng:
 * - Bộ làm mượt cửa sổ rộng (Wide-Window Macroscopic Gaussian Smoothing):
 *   Trên các đường cong có độ dốc thoai thoải (ví dụ: đường viền cánh tay gấu nghiêng 1:12,
 *   tức đi dọc 12px mới dịch ngang 1px), bộ lọc 3 điểm thông thường không đủ rộng để xóa bậc thang.
 *   Bằng cách đo góc vĩ mô (span = 8..10 điểm) để chỉ ghim các đỉnh góc thật sự, sau đó chạy
 *   8 lượt lọc Gaussian liên tiếp trên chuỗi điểm, toàn bộ bậc thang răng cưa được biến thành
 *   đường cong toán học mượt tuyệt đối trước khi đưa vào bước khớp Bézier!
 */

import { LayerStackMode, PaletteColor } from '../types/vectorizer';

export interface Point2D {
  x: number;
  y: number;
}

export interface TracedLayerContours {
  colorId: number;
  hex: string;
  area: number;
  contours: Point2D[][];
}

export function traceBinaryMaskContours(
  mask: Uint8Array,
  width: number,
  height: number,
  offsetX = 0,
  offsetY = 0,
  cornerThreshold = 75,
  curveSmoothing = 0.95,
  simplifyTolerance = 0.9,
  rawPixelEdges = false
): Point2D[][] {
  const gw = width + 1;
  const gh = height + 1;
  const numVertices = gw * gh;

  const outgoingMask = new Uint8Array(numVertices);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      if (mask[rowOffset + x] === 0) continue;

      if (y === 0 || mask[(y - 1) * width + x] === 0) {
        outgoingMask[y * gw + x] |= 1 << 0;
      }
      if (x + 1 === width || mask[rowOffset + x + 1] === 0) {
        outgoingMask[y * gw + (x + 1)] |= 1 << 1;
      }
      if (y + 1 === height || mask[(y + 1) * width + x] === 0) {
        outgoingMask[(y + 1) * gw + (x + 1)] |= 1 << 2;
      }
      if (x === 0 || mask[rowOffset + x - 1] === 0) {
        outgoingMask[(y + 1) * gw + x] |= 1 << 3;
      }
    }
  }

  const dxDir = [1, 0, -1, 0];
  const dyDir = [0, 1, 0, -1];

  const contours: Point2D[][] = [];
  const cornerCosThreshold = Math.cos(
    (Math.max(35, Math.min(165, cornerThreshold)) * Math.PI) / 180
  );
  const isPixelArtSharp = curveSmoothing <= 0.02 && cornerThreshold <= 45;
  const isHighDetailMode = simplifyTolerance <= 0.55;

  for (let vy = 0; vy < gh; vy++) {
    for (let vx = 0; vx < gw; vx++) {
      const startV = vy * gw + vx;
      if (outgoingMask[startV] === 0) continue;

      for (let initDir = 0; initDir < 4; initDir++) {
        if ((outgoingMask[startV] & (1 << initDir)) === 0) continue;

        const rawVertices: Point2D[] = [];
        const rawDirs: number[] = [];

        let cx = vx;
        let cy = vy;
        let dir = initDir;

        while (true) {
          const vIdx = cy * gw + cx;
          outgoingMask[vIdx] &= ~(1 << dir);

          rawVertices.push({ x: cx + offsetX, y: cy + offsetY });
          rawDirs.push(dir);

          cx += dxDir[dir];
          cy += dyDir[dir];

          if (cx === vx && cy === vy) {
            break;
          }

          const nextV = cy * gw + cx;
          const nextAvail = outgoingMask[nextV];
          if (nextAvail === 0) break;

          const rightDir = (dir + 1) & 3;
          const straightDir = dir;
          const leftDir = (dir + 3) & 3;

          if (nextAvail & (1 << rightDir)) {
            dir = rightDir;
          } else if (nextAvail & (1 << straightDir)) {
            dir = straightDir;
          } else if (nextAvail & (1 << leftDir)) {
            dir = leftDir;
          } else {
            for (let d = 0; d < 4; d++) {
              if (nextAvail & (1 << d)) {
                dir = d;
                break;
              }
            }
          }
        }

        if (rawVertices.length < 4) continue;

        // Thuật toán đa giác tối ưu (optimalCurve.ts) cần nguyên chuỗi đỉnh lưới pixel, không làm mượt trước
        if (rawPixelEdges) {
          contours.push(rawVertices);
          continue;
        }

        const n = rawVertices.length;

        // Chế độ Pixel Art 8-Bit (curveSmoothing = 0, cornerThreshold <= 45):
        // Giữ nguyên tuyệt đối các đỉnh lưới pixel vuông vức, không cắt góc Dual Contouring!
        if (isPixelArtSharp) {
          const prunedPixel: Point2D[] = [];
          for (let idx = 0; idx < n; idx++) {
            const prevIdx = (idx - 1 + n) % n;
            if (rawDirs[prevIdx] !== rawDirs[idx]) {
              prunedPixel.push(rawVertices[idx]);
            }
          }
          if (prunedPixel.length >= 3) {
            contours.push(prunedPixel);
          }
          continue;
        }

        const runLengths = new Int32Array(n);

        let firstTurn = 0;
        for (let idx = 0; idx < n; idx++) {
          if (rawDirs[idx] !== rawDirs[(idx - 1 + n) % n]) {
            firstTurn = idx;
            break;
          }
        }

        let offset = 0;
        while (offset < n) {
          const startIdx = (firstTurn + offset) % n;
          const d = rawDirs[startIdx];
          let len = 1;
          while (
            offset + len < n &&
            rawDirs[(firstTurn + offset + len) % n] === d
          ) {
            len++;
          }
          for (let k = 0; k < len; k++) {
            runLengths[(firstTurn + offset + k) % n] = len;
          }
          offset += len;
        }

        const dualPoints: Point2D[] = [];
        const pinned: number[] = [];
        // Ở chế độ Siêu Nét / Ảnh Thật (isHighDetailMode), ghim góc vuông ngay từ cạnh 2px trở lên để giữ sắc nét vảy rồng & chi tiết nhỏ
        const minOrthoRun = isHighDetailMode
          ? 2
          : cornerThreshold <= 60
            ? 3
            : cornerThreshold <= 95
              ? 6
              : 16;

        for (let idx = 0; idx < n; idx++) {
          const prevIdx = (idx - 1 + n) % n;
          const nextIdx = (idx + 1) % n;
          const pCurr = rawVertices[idx];
          const pNext = rawVertices[nextIdx];

          if (
            rawDirs[prevIdx] !== rawDirs[idx] &&
            ((runLengths[prevIdx] >= minOrthoRun &&
              runLengths[idx] >= minOrthoRun) ||
              (isHighDetailMode && n <= 8))
          ) {
            dualPoints.push({ x: pCurr.x, y: pCurr.y });
            pinned.push(1);
          }

          dualPoints.push({
            x: (pCurr.x + pNext.x) * 0.5,
            y: (pCurr.y + pNext.y) * 0.5,
          });
          pinned.push(runLengths[idx] >= 36 ? 1 : 0);
        }

        const m = dualPoints.length;
        // Cửa sổ đo góc thích ứng: Cửa sổ hẹp (span=2..3) cho chi tiết nhỏ / chế độ Siêu Nét để không làm tù đầu vuốt/răng/vảy rồng
        const maxSpan = isHighDetailMode || m <= 48 ? 3 : 6;
        const minLegLen = isHighDetailMode || m <= 48 ? 1.0 : 2.2;
        const span = Math.min(maxSpan, Math.floor(m / 4));
        if (span >= 1) {
          for (let i = 0; i < m; i++) {
            const pA = dualPoints[(i - span + m) % m];
            const pB = dualPoints[i];
            const pC = dualPoints[(i + span) % m];

            const v1x = pB.x - pA.x;
            const v1y = pB.y - pA.y;
            const v2x = pC.x - pB.x;
            const v2y = pC.y - pB.y;
            const l1 = Math.hypot(v1x, v1y);
            const l2 = Math.hypot(v2x, v2y);
            if (l1 > minLegLen && l2 > minLegLen) {
              const cosAngle = (v1x * v2x + v1y * v2y) / (l1 * l2);
              if (cosAngle < cornerCosThreshold) {
                pinned[i] = 1;
              }
            }
          }
        }

        // Trọng số di chuyển mềm (Soft Mobility Weight) quanh điểm ghim
        const mobility = new Float32Array(m).fill(1.0);
        for (let i = 0; i < m; i++) {
          if (pinned[i]) {
            mobility[i] = 0.0;
            const prev1 = (i - 1 + m) % m;
            const next1 = (i + 1) % m;
            if (!pinned[prev1]) mobility[prev1] = Math.min(mobility[prev1], 0.3);
            if (!pinned[next1]) mobility[next1] = Math.min(mobility[next1], 0.3);
          }
        }

        // Làm mượt bảo toàn thể tích Taubin thích ứng theo kích thước chi tiết & độ chi tiết (simplifyTolerance):
        // - Với chi tiết nhỏ (m <= 48) hoặc chế độ Siêu Nét / Ảnh Thật (isHighDetailMode):
        //   Chỉ dùng bộ lọc 3 điểm (3-tap) với 1..2 lượt để khử bậc thang 0.5px mà GIỮ NGUYÊN 100% độ sắc nét của vảy/mắt/vuốt!
        // - Với mảng hình lớn của Logo / Cartoon (m > 48 & simplifyTolerance > 0.55):
        //   Dùng bộ lọc 5 điểm (5-tap) nhiều lượt để biến bậc thang dài thành cung tròn mượt.
        let pts = dualPoints;
        const useNarrow3Tap = isHighDetailMode || m <= 48;
        const maxAllowedPasses = isHighDetailMode
          ? 2
          : m <= 24
            ? 2
            : m <= 48
              ? 3
              : 8;
        const basePasses = Math.round(
          Math.max(0, Math.min(1.3, curveSmoothing)) * maxAllowedPasses
        );
        const passes =
          curveSmoothing <= 0.05 ? 0 : Math.max(1, Math.min(maxAllowedPasses, basePasses));

        if (passes > 0) {
          const tmpPts: Point2D[] = new Array(m);
          const nextPts: Point2D[] = new Array(m);
          const LAMBDA = 0.48;
          const MU = -0.51;

          for (let pass = 0; pass < passes; pass++) {
            for (let i = 0; i < m; i++) {
              const mob = mobility[i];
              if (mob <= 0) {
                tmpPts[i] = pts[i];
              } else if (useNarrow3Tap) {
                const pPrev1 = pts[(i - 1 + m) % m];
                const pCurr = pts[i];
                const pNext1 = pts[(i + 1) % m];
                const avgX = 0.5 * (pPrev1.x + pNext1.x);
                const avgY = 0.5 * (pPrev1.y + pNext1.y);
                const step = LAMBDA * mob;
                tmpPts[i] = {
                  x: pCurr.x + step * (avgX - pCurr.x),
                  y: pCurr.y + step * (avgY - pCurr.y),
                };
              } else {
                const pPrev2 = pts[(i - 2 + m) % m];
                const pPrev1 = pts[(i - 1 + m) % m];
                const pCurr = pts[i];
                const pNext1 = pts[(i + 1) % m];
                const pNext2 = pts[(i + 2) % m];
                const avgX =
                  0.15 * pPrev2.x +
                  0.35 * pPrev1.x +
                  0.35 * pNext1.x +
                  0.15 * pNext2.x;
                const avgY =
                  0.15 * pPrev2.y +
                  0.35 * pPrev1.y +
                  0.35 * pNext1.y +
                  0.15 * pNext2.y;
                const step = LAMBDA * mob;
                tmpPts[i] = {
                  x: pCurr.x + step * (avgX - pCurr.x),
                  y: pCurr.y + step * (avgY - pCurr.y),
                };
              }
            }

            for (let i = 0; i < m; i++) {
              const mob = mobility[i];
              if (mob <= 0) {
                nextPts[i] = tmpPts[i];
              } else if (useNarrow3Tap) {
                const pPrev1 = tmpPts[(i - 1 + m) % m];
                const pCurr = tmpPts[i];
                const pNext1 = tmpPts[(i + 1) % m];
                const avgX = 0.5 * (pPrev1.x + pNext1.x);
                const avgY = 0.5 * (pPrev1.y + pNext1.y);
                const step = MU * mob;
                nextPts[i] = {
                  x: pCurr.x + step * (avgX - pCurr.x),
                  y: pCurr.y + step * (avgY - pCurr.y),
                };
              } else {
                const pPrev2 = tmpPts[(i - 2 + m) % m];
                const pPrev1 = tmpPts[(i - 1 + m) % m];
                const pCurr = tmpPts[i];
                const pNext1 = tmpPts[(i + 1) % m];
                const pNext2 = tmpPts[(i + 2) % m];
                const avgX =
                  0.15 * pPrev2.x +
                  0.35 * pPrev1.x +
                  0.35 * pNext1.x +
                  0.15 * pNext2.x;
                const avgY =
                  0.15 * pPrev2.y +
                  0.35 * pPrev1.y +
                  0.35 * pNext1.y +
                  0.15 * pNext2.y;
                const step = MU * mob;
                nextPts[i] = {
                  x: pCurr.x + step * (avgX - pCurr.x),
                  y: pCurr.y + step * (avgY - pCurr.y),
                };
              }
            }

            pts = nextPts.map((p) => ({ x: p.x, y: p.y }));
          }
        }

        // Rút gọn các điểm thẳng hàng liên tiếp
        const pruned: Point2D[] = [];
        for (let idx = 0; idx < m; idx++) {
          const pPrev = pts[(idx - 1 + m) % m];
          const pCurr = pts[idx];
          const pNext = pts[(idx + 1) % m];

          const dx1 = pCurr.x - pPrev.x;
          const dy1 = pCurr.y - pPrev.y;
          const dx2 = pNext.x - pCurr.x;
          const dy2 = pNext.y - pCurr.y;

          const cross = Math.abs(dx1 * dy2 - dy1 * dx2);
          const dot = dx1 * dx2 + dy1 * dy2;
          if (cross < 1e-4 && dot > 0) {
            continue;
          }
          pruned.push(pCurr);
        }

        if (pruned.length >= 3) {
          contours.push(pruned);
        }
      }
    }
  }

  return contours;
}

export function extractAllColorLayerContours(
  labelMap: Int32Array,
  palette: PaletteColor[],
  width: number,
  height: number,
  layerMode: LayerStackMode,
  cornerThreshold = 75,
  curveSmoothing = 0.95,
  simplifyTolerance = 0.9,
  rawPixelEdges = false
): TracedLayerContours[] {
  const totalPixels = width * height;

  const activeColors = palette.filter(
    (p) => p.visible && p.pixelCount > 0 && !p.isStrokeLayer
  );
  if (activeColors.length === 0) return [];

  const numPalette = palette.length;
  const borderCounts = new Int32Array(numPalette);
  const minXArr = new Int32Array(numPalette).fill(width);
  const minYArr = new Int32Array(numPalette).fill(height);
  const maxXArr = new Int32Array(numPalette).fill(-1);
  const maxYArr = new Int32Array(numPalette).fill(-1);

  const isVisibleColor = new Uint8Array(numPalette);
  for (const col of activeColors) {
    isVisibleColor[col.id] = 1;
  }

  let transparentBorderPixels = 0;
  // Quét 1 lượt duy nhất để lấy Bounding Box (ROI) và điểm chạm viền của từng màu
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const lbl = labelMap[row + x];
      const isBorder =
        x === 0 || x === width - 1 || y === 0 || y === height - 1;
      if (lbl < 0 || lbl >= numPalette || !isVisibleColor[lbl]) {
        if (isBorder) transparentBorderPixels++;
        continue;
      }
      if (x < minXArr[lbl]) minXArr[lbl] = x;
      if (x > maxXArr[lbl]) maxXArr[lbl] = x;
      if (y < minYArr[lbl]) minYArr[lbl] = y;
      if (y > maxYArr[lbl]) maxYArr[lbl] = y;
      if (isBorder) {
        borderCounts[lbl]++;
      }
    }
  }

  const sortedColors = [...activeColors].sort((a, b) => {
    const scoreA =
      a.pixelCount + borderCounts[a.id] * Math.max(width, height) * 0.5;
    const scoreB =
      b.pixelCount + borderCounts[b.id] * Math.max(width, height) * 0.5;
    return scoreB - scoreA;
  });

  const colorRank = new Int32Array(numPalette).fill(-1);
  sortedColors.forEach((col, rank) => {
    colorRank[col.id] = rank;
  });

  const results: TracedLayerContours[] = [];
  // Khi số lượng màu > 16 hoặc ở chế độ Chi Tiết Cao (simplifyTolerance <= 0.55):
  // Dò chính xác mặt nạ 1-pixel của từng lớp màu (Exact ROI Tracing) trên nền lớp đáy (rank === 0),
  // KHÔNG nở (dilate) 2px để tránh làm phình các nét vảy/chi tiết mảnh và tràn đè lên lớp màu bên dưới!
  const useExactRoiStacking =
    activeColors.length > 16 || simplifyTolerance <= 0.55;
  const fullMask =
    layerMode === 'stacked' ? new Uint8Array(totalPixels) : null;
  const bfsQueue =
    layerMode === 'stacked' ? new Int32Array(totalPixels) : null;

  // Chỉ tạo lớp lót đặc cho vật thể (primarySubjectRank) KHI viền khung ảnh vẫn còn lớp nền đặc bao quanh
  // (transparentBorderPixels <= 15% chu vi). Khi đã tách bỏ nền (hoặc ẩn lớp nền), bản thân rank = 0
  // ĐÃ LÀ lớp lót đặc của vật thể, nên các lớp từ rank >= 1 giữ nguyên 100% Exact ROI!
  const hasOpaqueBorderBackground =
    sortedColors.length > 1 &&
    transparentBorderPixels <= (width + height) * 0.3 &&
    borderCounts[sortedColors[0].id] > (width + height) * 0.15;
  let primarySubjectRank = -1;
  if (hasOpaqueBorderBackground) {
    for (let r = 1; r < sortedColors.length; r++) {
      if (borderCounts[sortedColors[r].id] <= (width + height) * 0.1) {
        primarySubjectRank = r;
        break;
      }
    }
  }

  for (let rank = 0; rank < sortedColors.length; rank++) {
    const col = sortedColors[rank];
    const targetId = col.id;
    if (maxXArr[targetId] < minXArr[targetId]) continue;

    const isSolidSubjectBase =
      layerMode === 'stacked' &&
      useExactRoiStacking &&
      rank === primarySubjectRank &&
      rank < sortedColors.length - 1;

    if (
      layerMode === 'cutout' ||
      rank === sortedColors.length - 1 ||
      (useExactRoiStacking && rank > 0 && !isSolidSubjectBase)
    ) {
      // Dò biên chính xác từng pixel nguyên bản của màu targetId trên khung bao cục bộ (ROI) -> Sắc nét tuyệt đối!
      const x0 = minXArr[targetId];
      const y0 = minYArr[targetId];
      const roiW = maxXArr[targetId] - x0 + 1;
      const roiH = maxYArr[targetId] - y0 + 1;
      const roiMask = new Uint8Array(roiW * roiH);

      for (let ry = 0; ry < roiH; ry++) {
        const srcRow = (y0 + ry) * width + x0;
        const dstRow = ry * roiW;
        for (let rx = 0; rx < roiW; rx++) {
          if (labelMap[srcRow + rx] === targetId) {
            roiMask[dstRow + rx] = 1;
          }
        }
      }

      const contours = traceBinaryMaskContours(
        roiMask,
        roiW,
        roiH,
        x0,
        y0,
        cornerThreshold,
        curveSmoothing,
        simplifyTolerance,
        rawPixelEdges
      );
      if (contours.length > 0) {
        results.push({
          colorId: col.id,
          hex: col.hex,
          area: col.pixelCount,
          contours,
        });
      }
    } else if ((!useExactRoiStacking || isSolidSubjectBase) && fullMask && bfsQueue) {
      // Chế độ Stacked liên thông thông minh cho Logo ít màu (<= 16 màu)
      fullMask.fill(0);
      let head = 0;
      let tail = 0;
      let bx0 = minXArr[targetId];
      let by0 = minYArr[targetId];
      let bx1 = maxXArr[targetId];
      let by1 = maxYArr[targetId];

      for (let y = by0; y <= by1; y++) {
        const row = y * width;
        for (let x = bx0; x <= bx1; x++) {
          const idx = row + x;
          if (labelMap[idx] === targetId) {
            fullMask[idx] = 1;
            bfsQueue[tail++] = idx;
          }
        }
      }

      while (head < tail) {
        const curr = bfsQueue[head++];
        const cx = curr % width;
        const cy = (curr - cx) / width;
        if (cx < bx0) bx0 = cx;
        if (cx > bx1) bx1 = cx;
        if (cy < by0) by0 = cy;
        if (cy > by1) by1 = cy;

        if (cx > 0) {
          const nIdx = curr - 1;
          const nLbl = labelMap[nIdx];
          if (!fullMask[nIdx] && nLbl >= 0 && colorRank[nLbl] >= rank) {
            fullMask[nIdx] = 1;
            bfsQueue[tail++] = nIdx;
          }
        }
        if (cx + 1 < width) {
          const nIdx = curr + 1;
          const nLbl = labelMap[nIdx];
          if (!fullMask[nIdx] && nLbl >= 0 && colorRank[nLbl] >= rank) {
            fullMask[nIdx] = 1;
            bfsQueue[tail++] = nIdx;
          }
        }
        if (cy > 0) {
          const nIdx = curr - width;
          const nLbl = labelMap[nIdx];
          if (!fullMask[nIdx] && nLbl >= 0 && colorRank[nLbl] >= rank) {
            fullMask[nIdx] = 1;
            bfsQueue[tail++] = nIdx;
          }
        }
        if (cy + 1 < height) {
          const nIdx = curr + width;
          const nLbl = labelMap[nIdx];
          if (!fullMask[nIdx] && nLbl >= 0 && colorRank[nLbl] >= rank) {
            fullMask[nIdx] = 1;
            bfsQueue[tail++] = nIdx;
          }
        }
      }

      const roiW = bx1 - bx0 + 1;
      const roiH = by1 - by0 + 1;
      const roiMask = new Uint8Array(roiW * roiH);
      for (let ry = 0; ry < roiH; ry++) {
        const srcRow = (by0 + ry) * width + bx0;
        const dstRow = ry * roiW;
        for (let rx = 0; rx < roiW; rx++) {
          roiMask[dstRow + rx] = fullMask[srcRow + rx];
        }
      }

      const contours = traceBinaryMaskContours(
        roiMask,
        roiW,
        roiH,
        bx0,
        by0,
        cornerThreshold,
        curveSmoothing,
        simplifyTolerance,
        rawPixelEdges
      );
      if (contours.length > 0) {
        results.push({
          colorId: col.id,
          hex: col.hex,
          area: col.pixelCount,
          contours,
        });
      }
    } else {
      // Lớp nền dưới cùng (rank === 0) khi ở chế độ useExactRoiStacking: phủ toàn bộ vùng ảnh có màu làm lớp lót đáy
      const roiMask = new Uint8Array(width * height);
      for (let i = 0; i < totalPixels; i++) {
        const lbl = labelMap[i];
        if (lbl >= 0 && colorRank[lbl] >= 0) {
          roiMask[i] = 1;
        }
      }

      const contours = traceBinaryMaskContours(
        roiMask,
        width,
        height,
        0,
        0,
        cornerThreshold,
        curveSmoothing,
        simplifyTolerance,
        rawPixelEdges
      );
      if (contours.length > 0) {
        results.push({
          colorId: col.id,
          hex: col.hex,
          area: col.pixelCount,
          contours,
        });
      }
    }
  }

  return results;
}
