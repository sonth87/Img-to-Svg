/**
 * BƯỚC 3: LỌC ĐỐM VỤN & HÒA TAN VÙNG NHỎ (CONNECTED COMPONENTS DESPECKLE)
 */

import {
  ManualErasePoint,
  PaletteColor,
  PaletteOverride,
} from '../types/vectorizer';

export function cleanBinaryStrokeMask(
  mask: Uint8Array,
  width: number,
  height: number,
  minPixels: number
): Uint8Array {
  const total = width * height;
  const out = new Uint8Array(mask);
  if (minPixels <= 1) return out;

  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  const dx8 = [0, 1, 1, 1, 0, -1, -1, -1];
  const dy8 = [-1, -1, 0, 1, 1, 1, 0, -1];

  for (let start = 0; start < total; start++) {
    if (!out[start] || visited[start]) continue;

    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;

    while (head < tail) {
      const curr = queue[head++];
      const cx = curr % width;
      const cy = (curr - cx) / width;

      for (let d = 0; d < 8; d++) {
        const nx = cx + dx8[d];
        const ny = cy + dy8[d];
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nIdx = ny * width + nx;
        if (out[nIdx] && !visited[nIdx]) {
          visited[nIdx] = 1;
          queue[tail++] = nIdx;
        }
      }
    }

    if (tail < minPixels) {
      for (let i = 0; i < tail; i++) {
        out[queue[i]] = 0;
      }
    }
  }

  return out;
}

export function applyPaletteOverridesAndDespeckle(
  labelMap: Int32Array,
  palette: PaletteColor[],
  width: number,
  height: number,
  minArea: number,
  overrides: Record<number, PaletteOverride>,
  thinStrokeMask?: Uint8Array,
  removeBackground = false,
  bgTolerance = 24,
  manualErases: ManualErasePoint[] = []
): {
  cleanedLabelMap: Int32Array;
  updatedPalette: PaletteColor[];
  quantizedBuffer: Uint8ClampedArray;
  cleanedStrokeMask?: Uint8Array;
} {
  const totalPixels = width * height;
  const cleanedLabelMap = new Int32Array(labelMap);

  const numColors = palette.length;
  const redirect = new Int32Array(numColors);
  for (let i = 0; i < numColors; i++) {
    let target = i;
    let guard = 0;
    while (
      overrides[target]?.mergedInto !== undefined &&
      overrides[target]?.mergedInto !== null &&
      overrides[target]?.mergedInto !== target &&
      guard < numColors
    ) {
      target = overrides[target]!.mergedInto!;
      guard++;
    }
    redirect[i] = target;
  }

  for (let i = 0; i < totalPixels; i++) {
    const lbl = cleanedLabelMap[i];
    if (lbl >= 0 && lbl < numColors) {
      cleanedLabelMap[i] = redirect[lbl];
    }
  }

  if (minArea > 0) {
    const rawThresholds =
      minArea > 8
        ? [2, 5, minArea]
        : minArea > 3
          ? [2, minArea]
          : [minArea];
    const visited = new Uint8Array(totalPixels);
    const queue = new Int32Array(totalPixels);
    const neighborCounts = new Int32Array(numColors);
    const touchedNeighbors = new Int32Array(numColors);

    for (const threshold of rawThresholds) {
      visited.fill(0);

      for (let startIdx = 0; startIdx < totalPixels; startIdx++) {
        if (visited[startIdx]) continue;
        const baseLabel = cleanedLabelMap[startIdx];
        if (baseLabel < 0) {
          visited[startIdx] = 1;
          continue;
        }

        let head = 0;
        let tail = 0;
        queue[tail++] = startIdx;
        visited[startIdx] = 1;

        let numTouched = 0;

        while (head < tail) {
          const curr = queue[head++];
          const cx = curr % width;
          const cy = (curr - cx) / width;

          if (cx > 0) {
            const nIdx = curr - 1;
            const nLbl = cleanedLabelMap[nIdx];
            if (nLbl === baseLabel) {
              if (!visited[nIdx]) {
                visited[nIdx] = 1;
                queue[tail++] = nIdx;
              }
            } else if (nLbl >= 0) {
              if (neighborCounts[nLbl] === 0) {
                touchedNeighbors[numTouched++] = nLbl;
              }
              neighborCounts[nLbl]++;
            }
          }
          if (cx + 1 < width) {
            const nIdx = curr + 1;
            const nLbl = cleanedLabelMap[nIdx];
            if (nLbl === baseLabel) {
              if (!visited[nIdx]) {
                visited[nIdx] = 1;
                queue[tail++] = nIdx;
              }
            } else if (nLbl >= 0) {
              if (neighborCounts[nLbl] === 0) {
                touchedNeighbors[numTouched++] = nLbl;
              }
              neighborCounts[nLbl]++;
            }
          }
          if (cy > 0) {
            const nIdx = curr - width;
            const nLbl = cleanedLabelMap[nIdx];
            if (nLbl === baseLabel) {
              if (!visited[nIdx]) {
                visited[nIdx] = 1;
                queue[tail++] = nIdx;
              }
            } else if (nLbl >= 0) {
              if (neighborCounts[nLbl] === 0) {
                touchedNeighbors[numTouched++] = nLbl;
              }
              neighborCounts[nLbl]++;
            }
          }
          if (cy + 1 < height) {
            const nIdx = curr + width;
            const nLbl = cleanedLabelMap[nIdx];
            if (nLbl === baseLabel) {
              if (!visited[nIdx]) {
                visited[nIdx] = 1;
                queue[tail++] = nIdx;
              }
            } else if (nLbl >= 0) {
              if (neighborCounts[nLbl] === 0) {
                touchedNeighbors[numTouched++] = nLbl;
              }
              neighborCounts[nLbl]++;
            }
          }
        }

        if (tail < threshold && numTouched > 0) {
          // Chọn màu lân cận vừa có nhiều cạnh tiếp xúc vừa gần màu gốc nhất để hòa tan không để lại vết
          const baseCol = palette[baseLabel];
          let bestNeighborLabel = touchedNeighbors[0];
          let bestScore = -1e9;

          for (let t = 0; t < numTouched; t++) {
            const candLbl = touchedNeighbors[t];
            const votes = neighborCounts[candLbl];
            const candCol = palette[candLbl];
            const dr = baseCol.r - candCol.r;
            const dg = baseCol.g - candCol.g;
            const db = baseCol.b - candCol.b;
            const colorDist = Math.sqrt(dr * dr + dg * dg + db * db);
            // Ưu tiên lân cận có màu tương đồng và bao quanh nhiều cạnh
            const score = votes * 18 - colorDist;
            if (score > bestScore) {
              bestScore = score;
              bestNeighborLabel = candLbl;
            }
          }

          // Cập nhật trực tiếp tại chỗ (in-place) để 2 đốm nhiễu cạnh nhau không bao giờ tráo đổi màu cho nhau!
          for (let i = 0; i < tail; i++) {
            cleanedLabelMap[queue[i]] = bestNeighborLabel;
          }
        }

        for (let t = 0; t < numTouched; t++) {
          neighborCounts[touchedNeighbors[t]] = 0;
        }
      }
    }
  }

  // TÁCH BỎ MÀU NỀN THÔNG MINH (BOUNDARY-AWARE NON-DESTRUCTIVE BACKGROUND REMOVAL):
  // Chỉ bóc tách vùng nền bên ngoài bao quanh vật thể, TUYỆT ĐỐI KHÔNG xóa màu trùng với nền
  // nằm bên trong đường viền/chi tiết của vật thể (ví dụ: gấu trắng trên nền trắng, mắt trắng, áo trắng).
  if (removeBackground && numColors > 1) {
    const borderHits = new Int32Array(numColors);
    const cornerMarginX = Math.max(4, Math.floor(width * 0.12));
    const cornerMarginY = Math.max(4, Math.floor(height * 0.12));

    for (let y = 0; y < height; y++) {
      const row = y * width;
      const isTopOrBottom = y === 0 || y === height - 1;
      for (let x = 0; x < width; x++) {
        if (!isTopOrBottom && x !== 0 && x !== width - 1) continue;
        const idx = row + x;
        if (thinStrokeMask && thinStrokeMask[idx] === 1) continue;
        const lbl = cleanedLabelMap[idx];
        if (lbl >= 0 && lbl < numColors) {
          const isNearCorner =
            (x < cornerMarginX || x >= width - cornerMarginX) &&
            (y < cornerMarginY || y >= height - cornerMarginY);
          borderHits[lbl] += isNearCorner ? 4 : 1;
        }
      }
    }

    let mainBgLabel = -1;
    let maxBorderHits = 0;
    for (let c = 0; c < numColors; c++) {
      if (palette[c].isStrokeLayer) continue;
      if (borderHits[c] > maxBorderHits) {
        maxBorderHits = borderHits[c];
        mainBgLabel = c;
      }
    }

    if (mainBgLabel >= 0 && maxBorderHits > 0) {
      const bgCol = palette[mainBgLabel];
      const maxColorDist = Math.max(8, bgTolerance) * 2.2;
      const distToBg = new Float32Array(numColors);
      const isBgCandidate = new Uint8Array(numColors);

      for (let c = 0; c < numColors; c++) {
        if (palette[c].isStrokeLayer) {
          distToBg[c] = 9999;
          continue;
        }
        const d = Math.hypot(
          palette[c].r - bgCol.r,
          palette[c].g - bgCol.g,
          palette[c].b - bgCol.b
        );
        distToBg[c] = d;
        if (d <= maxColorDist) {
          isBgCandidate[c] = 1;
        }
      }

      // Bước 1: Xây dựng rào cản vật thể (solidObjectMask) bao gồm:
      // - Toàn bộ nét vẽ mảnh (thinStrokeMask) đã được tách riêng ở bước Inpaint
      // - Toàn bộ các cụm màu khác với màu nền (!isBgCandidate)
      // Nhờ đó nét viền đen của con gấu trắng đóng vai trò là bức tường chắn bất khả xâm phạm!
      const solidObjectMask = new Uint8Array(totalPixels);
      for (let i = 0; i < totalPixels; i++) {
        if (thinStrokeMask && thinStrokeMask[i] === 1) {
          solidObjectMask[i] = 1;
        } else {
          const lbl = cleanedLabelMap[i];
          if (lbl >= 0 && !isBgCandidate[lbl]) {
            solidObjectMask[i] = 1;
          }
        }
      }

      // Bước 2: Nở (Dilate) bức tường chắn ra 2px (8 hướng) để tạo floodWallMask:
      // Giúp bịt kín 100% các khe hở chéo 1px hoặc khe đứt nét nhỏ (<= 4px) trên đường viền vật thể,
      // ngăn không cho thuật toán loang màu (Flood-fill) lọt qua khe viền vào bên trong thân gấu trắng!
      const wallStep1 = new Uint8Array(totalPixels);
      for (let y = 0; y < height; y++) {
        const row = y * width;
        const y0 = Math.max(0, y - 1);
        const y1 = Math.min(height - 1, y + 1);
        for (let x = 0; x < width; x++) {
          const idx = row + x;
          if (solidObjectMask[idx]) {
            wallStep1[idx] = 1;
            continue;
          }
          const x0 = Math.max(0, x - 1);
          const x1 = Math.min(width - 1, x + 1);
          let hit = 0;
          for (let ny = y0; ny <= y1 && !hit; ny++) {
            const nRow = ny * width;
            for (let nx = x0; nx <= x1; nx++) {
              if (solidObjectMask[nRow + nx]) {
                hit = 1;
                break;
              }
            }
          }
          wallStep1[idx] = hit;
        }
      }

      const floodWallMask = new Uint8Array(totalPixels);
      for (let y = 0; y < height; y++) {
        const row = y * width;
        const y0 = Math.max(0, y - 1);
        const y1 = Math.min(height - 1, y + 1);
        for (let x = 0; x < width; x++) {
          const idx = row + x;
          if (wallStep1[idx]) {
            floodWallMask[idx] = 1;
            continue;
          }
          const x0 = Math.max(0, x - 1);
          const x1 = Math.min(width - 1, x + 1);
          let hit = 0;
          for (let ny = y0; ny <= y1 && !hit; ny++) {
            const nRow = ny * width;
            for (let nx = x0; nx <= x1; nx++) {
              if (wallStep1[nRow + nx]) {
                hit = 1;
                break;
              }
            }
          }
          floodWallMask[idx] = hit;
        }
      }

      // Bước 3: Lan truyền (BFS Flood-Fill) từ 4 góc khung ảnh dọc theo mép ngoài (dừng ngay khi chạm tường viền vật thể)
      // Không bao giờ gieo hạt giống (seed) vào phần thân hở ở cạnh đáy nằm kẹp giữa 2 nét viền của nhân vật!
      // Đồng thời cho phép đi xuyên qua các pixel đã trong suốt sẵn (-1) để bóc sạch cả viền sticker trắng quanh nhân vật.
      const bgVisited = new Uint8Array(totalPixels);
      const bgQueue = new Int32Array(totalPixels);
      let head = 0;
      let tail = 0;

      const canFlood = (idx: number): boolean => {
        if (bgVisited[idx] || floodWallMask[idx]) return false;
        const lbl = cleanedLabelMap[idx];
        return lbl === -1 || (lbl >= 0 && isBgCandidate[lbl] === 1);
      };

      const trySeed = (idx: number) => {
        if (canFlood(idx)) {
          bgVisited[idx] = 1;
          bgQueue[tail++] = idx;
        }
      };

      // Quét từ 4 góc vào dọc theo 4 cạnh khung ảnh và dừng lại ngay khi gặp tường biên vật thể (floodWallMask):
      // Cạnh trên (y = 0)
      for (let x = 0; x < width; x++) {
        const idx = x;
        if (floodWallMask[idx]) break;
        trySeed(idx);
      }
      for (let x = width - 1; x >= 0; x--) {
        const idx = x;
        if (floodWallMask[idx]) break;
        trySeed(idx);
      }
      // Cạnh dưới (y = height - 1)
      const bottomOffset = (height - 1) * width;
      for (let x = 0; x < width; x++) {
        const idx = bottomOffset + x;
        if (floodWallMask[idx]) break;
        trySeed(idx);
      }
      for (let x = width - 1; x >= 0; x--) {
        const idx = bottomOffset + x;
        if (floodWallMask[idx]) break;
        trySeed(idx);
      }
      // Cạnh trái (x = 0)
      for (let y = 0; y < height; y++) {
        const idx = y * width;
        if (floodWallMask[idx]) break;
        trySeed(idx);
      }
      for (let y = height - 1; y >= 0; y--) {
        const idx = y * width;
        if (floodWallMask[idx]) break;
        trySeed(idx);
      }
      // Cạnh phải (x = width - 1)
      for (let y = 0; y < height; y++) {
        const idx = y * width + (width - 1);
        if (floodWallMask[idx]) break;
        trySeed(idx);
      }
      for (let y = height - 1; y >= 0; y--) {
        const idx = y * width + (width - 1);
        if (floodWallMask[idx]) break;
        trySeed(idx);
      }

      while (head < tail) {
        const curr = bgQueue[head++];
        const cx = curr % width;
        const cy = (curr - cx) / width;

        if (cx > 0) {
          const nIdx = curr - 1;
          if (canFlood(nIdx)) {
            bgVisited[nIdx] = 1;
            bgQueue[tail++] = nIdx;
          }
        }
        if (cx + 1 < width) {
          const nIdx = curr + 1;
          if (canFlood(nIdx)) {
            bgVisited[nIdx] = 1;
            bgQueue[tail++] = nIdx;
          }
        }
        if (cy > 0) {
          const nIdx = curr - width;
          if (canFlood(nIdx)) {
            bgVisited[nIdx] = 1;
            bgQueue[tail++] = nIdx;
          }
        }
        if (cy + 1 < height) {
          const nIdx = curr + width;
          if (canFlood(nIdx)) {
            bgVisited[nIdx] = 1;
            bgQueue[tail++] = nIdx;
          }
        }
      }

      // Bước 4: Thu hồi chính xác 2px đệm bảo vệ (Bounded 2-step Collar Trim) sát tới mép ngoài của solidObjectMask:
      // Vì bước này chỉ tiến đúng 2 bước giới hạn (không lan truyền vô hạn), nó bóc sạch lớp nền sát rạt
      // mép ngoài của viền đen mà KHÔNG BAO GIỜ tràn qua khe hở vào bên trong vật thể!
      for (let step = 0; step < 2; step++) {
        const nextBgLayer = new Uint8Array(totalPixels);
        for (let y = 0; y < height; y++) {
          const row = y * width;
          const y0 = Math.max(0, y - 1);
          const y1 = Math.min(height - 1, y + 1);
          for (let x = 0; x < width; x++) {
            const idx = row + x;
            if (bgVisited[idx] || solidObjectMask[idx]) continue;
            const lbl = cleanedLabelMap[idx];
            if (lbl < 0 || !isBgCandidate[lbl]) continue;

            const x0 = Math.max(0, x - 1);
            const x1 = Math.min(width - 1, x + 1);
            let touchesBg = false;
            for (let ny = y0; ny <= y1 && !touchesBg; ny++) {
              const nRow = ny * width;
              for (let nx = x0; nx <= x1; nx++) {
                if (bgVisited[nRow + nx]) {
                  touchesBg = true;
                  break;
                }
              }
            }
            if (touchesBg) {
              nextBgLayer[idx] = 1;
            }
          }
        }
        for (let i = 0; i < totalPixels; i++) {
          if (nextBgLayer[i]) {
            bgVisited[i] = 1;
          }
        }
      }

      // Xóa toàn bộ các pixel nền ngoài đã được xác định bởi bgVisited
      for (let i = 0; i < totalPixels; i++) {
        if (bgVisited[i]) {
          cleanedLabelMap[i] = -1;
        }
      }

      // Đối với các pixel nằm dưới nét vẽ mảnh (thinStrokeMask) tiếp giáp trực tiếp với vùng nền ngoài vừa xóa (bgVisited),
      // ta thu gọn 1px lớp màu lót dưới mép ngoài của nét vẽ để màu trắng bên trong dừng ở đúng tâm nét viền đen,
      // không bị thò mép trắng ra phía ngoài nét viền đen.
      if (thinStrokeMask) {
        for (let y = 1; y < height - 1; y++) {
          const row = y * width;
          for (let x = 1; x < width - 1; x++) {
            const idx = row + x;
            if (thinStrokeMask[idx] !== 1) continue;
            const lbl = cleanedLabelMap[idx];
            if (lbl < 0 || !isBgCandidate[lbl]) continue;
            if (
              bgVisited[idx - 1] ||
              bgVisited[idx + 1] ||
              bgVisited[idx - width] ||
              bgVisited[idx + width]
            ) {
              cleanedLabelMap[idx] = -1;
            }
          }
        }
      }

      // Bước 5: Khử viền răng cưa 1px (De-fringe Halo) chỉ tại mép ngoài tiếp giáp trực tiếp với bgVisited
      const haloLimit = maxColorDist * 1.35;
      for (let y = 1; y < height - 1; y++) {
        const row = y * width;
        for (let x = 1; x < width - 1; x++) {
          const idx = row + x;
          if (thinStrokeMask && thinStrokeMask[idx] === 1) continue;
          const lbl = cleanedLabelMap[idx];
          if (lbl < 0 || distToBg[lbl] > haloLimit) continue;

          const touchesExteriorBg =
            bgVisited[idx - 1] ||
            bgVisited[idx + 1] ||
            bgVisited[idx - width] ||
            bgVisited[idx + width];
          if (!touchesExteriorBg) continue;

          const cands = [
            cleanedLabelMap[idx - 1],
            cleanedLabelMap[idx + 1],
            cleanedLabelMap[idx - width],
            cleanedLabelMap[idx + width],
          ];
          let interiorSubjectLbl = -1;
          for (let k = 0; k < 4; k++) {
            const nl = cands[k];
            if (nl >= 0 && distToBg[nl] > haloLimit) {
              interiorSubjectLbl = nl;
              break;
            }
          }

          if (interiorSubjectLbl >= 0) {
            const pCol = palette[lbl];
            const sCol = palette[interiorSubjectLbl];
            const distToSubj = Math.hypot(
              pCol.r - sCol.r,
              pCol.g - sCol.g,
              pCol.b - sCol.b
            );
            if (distToBg[lbl] <= distToSubj * 1.15) {
              cleanedLabelMap[idx] = -1;
            } else {
              cleanedLabelMap[idx] = interiorSubjectLbl;
            }
          }
        }
      }
    }
  }

  let cleanedStrokeMask: Uint8Array | undefined;
  if (thinStrokeMask) {
    cleanedStrokeMask = cleanBinaryStrokeMask(
      thinStrokeMask,
      width,
      height,
      Math.max(4, Math.floor(minArea * 0.4))
    );
  }

  // XÓA VÙNG CHỦ ĐỘNG (INTERACTIVE CLICK-TO-ERASE):
  // Tại mỗi tọa độ (x, y) người dùng click, tự động loang (Flood-Fill) để xóa vùng màu liên thông
  // tại điểm đó (dừng tại nét viền thinStrokeMask và biên các màu khác) hoặc xóa nét vẽ mảnh rời rạc.
  if (manualErases && manualErases.length > 0) {
    const eraseQueue = new Int32Array(totalPixels);
    const eraseVisited = new Uint8Array(totalPixels);
    const dx8 = [0, 1, 1, 1, 0, -1, -1, -1];
    const dy8 = [-1, -1, 0, 1, 1, 1, 0, -1];

    for (let m = 0; m < manualErases.length; m++) {
      const pt = manualErases[m];
      const sx = Math.max(0, Math.min(width - 1, Math.round(pt.x)));
      const sy = Math.max(0, Math.min(height - 1, Math.round(pt.y)));
      const seedIdx = sy * width + sx;

      // Tìm điểm pixel mảng màu hợp lệ gần vị trí click nhất (bán kính 2px) phòng khi click trúng sát mép viền mảnh
      let actualSeedIdx = -1;
      if (
        cleanedLabelMap[seedIdx] >= 0 &&
        (!cleanedStrokeMask || cleanedStrokeMask[seedIdx] === 0)
      ) {
        actualSeedIdx = seedIdx;
      } else {
        for (let r = 1; r <= 2 && actualSeedIdx < 0; r++) {
          for (let dy = -r; dy <= r && actualSeedIdx < 0; dy++) {
            const ny = sy + dy;
            if (ny < 0 || ny >= height) continue;
            for (let dx = -r; dx <= r; dx++) {
              const nx = sx + dx;
              if (nx < 0 || nx >= width) continue;
              const nIdx = ny * width + nx;
              if (
                cleanedLabelMap[nIdx] >= 0 &&
                (!cleanedStrokeMask || cleanedStrokeMask[nIdx] === 0)
              ) {
                actualSeedIdx = nIdx;
                break;
              }
            }
          }
        }
      }

      // Trường hợp 1: Xóa mảng màu liên thông (Flood-Fill dừng tại nét viền và biên màu khác)
      if (actualSeedIdx >= 0) {
        const seedLbl = cleanedLabelMap[actualSeedIdx];
        const seedCol = palette[seedLbl];
        const maxDist = Math.max(0, pt.tolerance ?? 18) * 1.9;
        const canEraseCluster = new Uint8Array(numColors);
        canEraseCluster[seedLbl] = 1;

        if (maxDist > 0 && seedCol) {
          for (let c = 0; c < numColors; c++) {
            if (palette[c].isStrokeLayer) continue;
            const d = Math.hypot(
              palette[c].r - seedCol.r,
              palette[c].g - seedCol.g,
              palette[c].b - seedCol.b
            );
            if (d <= maxDist) {
              canEraseCluster[c] = 1;
            }
          }
        }

        const isWall = (idx: number): boolean => {
          if (cleanedStrokeMask && cleanedStrokeMask[idx] === 1) return true;
          const lbl = cleanedLabelMap[idx];
          return lbl >= 0 && canEraseCluster[lbl] === 0;
        };

        eraseVisited.fill(0);
        let head = 0;
        let tail = 0;
        eraseVisited[actualSeedIdx] = 1;
        eraseQueue[tail++] = actualSeedIdx;

        while (head < tail) {
          const curr = eraseQueue[head++];
          const cx = curr % width;
          const cy = (curr - cx) / width;

          // Chống rò rỉ qua khe hẹp 1px giữa 2 tường chắn (trừ đúng điểm hạt giống ban đầu)
          if (curr !== actualSeedIdx) {
            const wallUp = cy > 0 && isWall(curr - width);
            const wallDn = cy + 1 < height && isWall(curr + width);
            const wallLf = cx > 0 && isWall(curr - 1);
            const wallRt = cx + 1 < width && isWall(curr + 1);
            if ((wallUp && wallDn) || (wallLf && wallRt)) {
              continue;
            }
          }

          if (cx > 0) {
            const nIdx = curr - 1;
            const nLbl = cleanedLabelMap[nIdx];
            if (
              !eraseVisited[nIdx] &&
              !isWall(nIdx) &&
              nLbl >= 0 &&
              canEraseCluster[nLbl]
            ) {
              eraseVisited[nIdx] = 1;
              eraseQueue[tail++] = nIdx;
            }
          }
          if (cx + 1 < width) {
            const nIdx = curr + 1;
            const nLbl = cleanedLabelMap[nIdx];
            if (
              !eraseVisited[nIdx] &&
              !isWall(nIdx) &&
              nLbl >= 0 &&
              canEraseCluster[nLbl]
            ) {
              eraseVisited[nIdx] = 1;
              eraseQueue[tail++] = nIdx;
            }
          }
          if (cy > 0) {
            const nIdx = curr - width;
            const nLbl = cleanedLabelMap[nIdx];
            if (
              !eraseVisited[nIdx] &&
              !isWall(nIdx) &&
              nLbl >= 0 &&
              canEraseCluster[nLbl]
            ) {
              eraseVisited[nIdx] = 1;
              eraseQueue[tail++] = nIdx;
            }
          }
          if (cy + 1 < height) {
            const nIdx = curr + width;
            const nLbl = cleanedLabelMap[nIdx];
            if (
              !eraseVisited[nIdx] &&
              !isWall(nIdx) &&
              nLbl >= 0 &&
              canEraseCluster[nLbl]
            ) {
              eraseVisited[nIdx] = 1;
              eraseQueue[tail++] = nIdx;
            }
          }
        }

        // Xóa toàn bộ pixel trong vùng loang và gọt 1px màu lót dưới nét viền mảnh kế bên
        for (let i = 0; i < tail; i++) {
          const idx = eraseQueue[i];
          cleanedLabelMap[idx] = -1;
          if (cleanedStrokeMask) {
            const cx = idx % width;
            const cy = (idx - cx) / width;
            if (cx > 0 && cleanedStrokeMask[idx - 1]) {
              cleanedLabelMap[idx - 1] = -1;
            }
            if (cx + 1 < width && cleanedStrokeMask[idx + 1]) {
              cleanedLabelMap[idx + 1] = -1;
            }
            if (cy > 0 && cleanedStrokeMask[idx - width]) {
              cleanedLabelMap[idx - width] = -1;
            }
            if (cy + 1 < height && cleanedStrokeMask[idx + width]) {
              cleanedLabelMap[idx + width] = -1;
            }
          }
        }
      } else if (cleanedStrokeMask) {
        // Trường hợp 2: Nếu click trực tiếp vào nét vẽ đơn trên nền đã trong suốt -> xóa nhánh nét vẽ đó
        let strokeSeed = -1;
        for (let r = 0; r <= 3 && strokeSeed < 0; r++) {
          for (let dy = -r; dy <= r && strokeSeed < 0; dy++) {
            const ny = sy + dy;
            if (ny < 0 || ny >= height) continue;
            for (let dx = -r; dx <= r; dx++) {
              const nx = sx + dx;
              if (nx < 0 || nx >= width) continue;
              const nIdx = ny * width + nx;
              if (cleanedStrokeMask[nIdx]) {
                strokeSeed = nIdx;
                break;
              }
            }
          }
        }
        if (strokeSeed >= 0) {
          let head = 0;
          let tail = 0;
          cleanedStrokeMask[strokeSeed] = 0;
          eraseQueue[tail++] = strokeSeed;
          while (head < tail) {
            const curr = eraseQueue[head++];
            const cx = curr % width;
            const cy = (curr - cx) / width;
            for (let d = 0; d < 8; d++) {
              const nx = cx + dx8[d];
              const ny = cy + dy8[d];
              if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
              const nIdx = ny * width + nx;
              if (cleanedStrokeMask[nIdx]) {
                cleanedStrokeMask[nIdx] = 0;
                eraseQueue[tail++] = nIdx;
              }
            }
          }
        }
      }
    }
  }

  let strokeMaskCount = 0;
  if (cleanedStrokeMask) {
    for (let i = 0; i < totalPixels; i++) {
      if (cleanedStrokeMask[i]) strokeMaskCount++;
    }
  }

  const newCounts = new Int32Array(numColors);
  let opaqueCount = 0;
  for (let i = 0; i < totalPixels; i++) {
    const lbl = cleanedLabelMap[i];
    if (lbl >= 0 && lbl < numColors) {
      newCounts[lbl]++;
      opaqueCount++;
    }
  }

  const safeTotal = Math.max(1, opaqueCount);
  const updatedPalette: PaletteColor[] = palette.map((p) => {
    const ov = overrides[p.id];
    const customHex = ov?.customHex ?? p.customHex;
    let r = p.r;
    let g = p.g;
    let b = p.b;
    if (customHex && /^#[0-9A-Fa-f]{6}$/.test(customHex)) {
      r = parseInt(customHex.slice(1, 3), 16);
      g = parseInt(customHex.slice(3, 5), 16);
      b = parseInt(customHex.slice(5, 7), 16);
    }
    const visible = ov?.visible !== undefined ? ov.visible : p.visible;
    const mergedInto = ov?.mergedInto ?? null;
    const cnt = p.isStrokeLayer ? strokeMaskCount : newCounts[p.id];

    return {
      ...p,
      r,
      g,
      b,
      hex: customHex ? customHex.toUpperCase() : p.hex,
      customHex,
      visible,
      mergedInto,
      pixelCount: cnt,
      percentage: (cnt / safeTotal) * 100,
    };
  });

  const strokeEntry = updatedPalette.find((p) => p.isStrokeLayer);

  const quantizedBuffer = new Uint8ClampedArray(totalPixels * 4);
  for (let i = 0; i < totalPixels; i++) {
    const outIdx = i * 4;
    if (
      cleanedStrokeMask &&
      cleanedStrokeMask[i] &&
      strokeEntry &&
      strokeEntry.visible
    ) {
      quantizedBuffer[outIdx] = strokeEntry.r;
      quantizedBuffer[outIdx + 1] = strokeEntry.g;
      quantizedBuffer[outIdx + 2] = strokeEntry.b;
      quantizedBuffer[outIdx + 3] = 255;
      continue;
    }

    const lbl = cleanedLabelMap[i];
    if (
      lbl < 0 ||
      lbl >= numColors ||
      !updatedPalette[lbl].visible ||
      updatedPalette[lbl].isStrokeLayer
    ) {
      quantizedBuffer[outIdx] = 0;
      quantizedBuffer[outIdx + 1] = 0;
      quantizedBuffer[outIdx + 2] = 0;
      quantizedBuffer[outIdx + 3] = 0;
    } else {
      const col = updatedPalette[lbl];
      quantizedBuffer[outIdx] = col.r;
      quantizedBuffer[outIdx + 1] = col.g;
      quantizedBuffer[outIdx + 2] = col.b;
      quantizedBuffer[outIdx + 3] = 255;
    }
  }

  return {
    cleanedLabelMap,
    updatedPalette,
    quantizedBuffer,
    cleanedStrokeMask,
  };
}
