/**
 * THUẬT TOÁN DÒ ĐƯỜNG TÂM NÉT ĐƠN (CENTERLINE TRACING / ZHANG-SUEN SKELETONIZATION)
 *
 * Cải tiến chuyên sâu cho nét vẽ mượt tối đa & ít điểm neo nhất:
 * 1. Hàn gắn khe đứt (Gap Healing 1..2px) để nét vẽ mảnh không bị đứt đoạn.
 * 2. Gọt mỏng Zhang-Suen (Thinning) về khung xương 1 pixel.
 * 3. Cắt bỏ toàn bộ nhánh gai/râu phụ (Spur Pruning <= 8px) do viền răng cưa tạo ra.
 * 4. Nối chuỗi thông minh (Chain Stitching): Tự động hàn các đoạn khung xương thẳng hàng
 *    bị ngắt tại ngã ba hoặc khe hở nhỏ (< 4px) thành 1 đường liên tục dài.
 * 5. Bộ làm mượt cửa sổ rộng 5-tap Gaussian (12 lượt) biến mọi bậc thang độ dốc thoai thoải
 *    (như đường viền cánh tay gấu) thành đường cong toán học mượt tuyệt đối chỉ với vài điểm neo!
 */

import { AnchorPoint, VectorPathData } from '../types/vectorizer';
import { fitCenterlineChainToBezier } from './curveFitting';
import { Point2D } from './marchingSquares';

export function zhangSuenThinning(
  inputMask: Uint8Array,
  width: number,
  height: number
): { skeleton: Uint8Array; skeletonCount: number } {
  const skel = new Uint8Array(inputMask);
  const total = width * height;
  const toClear = new Int32Array(total);
  const activePixels = new Int32Array(total);
  let activeCount = 0;

  for (let x = 0; x < width; x++) {
    skel[x] = 0;
    skel[(height - 1) * width + x] = 0;
  }
  for (let y = 0; y < height; y++) {
    skel[y * width] = 0;
    skel[y * width + (width - 1)] = 0;
  }

  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = row + x;
      if (skel[idx]) {
        activePixels[activeCount++] = idx;
      }
    }
  }

  let maxIterations = 60;
  while (maxIterations-- > 0 && activeCount > 0) {
    let changed = false;

    for (let step = 0; step < 2; step++) {
      let clearCount = 0;

      for (let k = 0; k < activeCount; k++) {
        const idx = activePixels[k];
        if (skel[idx] === 0) continue;

        const p2 = skel[idx - width];
        const p3 = skel[idx - width + 1];
        const p4 = skel[idx + 1];
        const p5 = skel[idx + width + 1];
        const p6 = skel[idx + width];
        const p7 = skel[idx + width - 1];
        const p8 = skel[idx - 1];
        const p9 = skel[idx - width - 1];

        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;

        let A = 0;
        if (p2 === 0 && p3 === 1) A++;
        if (p3 === 0 && p4 === 1) A++;
        if (p4 === 0 && p5 === 1) A++;
        if (p5 === 0 && p6 === 1) A++;
        if (p6 === 0 && p7 === 1) A++;
        if (p7 === 0 && p8 === 1) A++;
        if (p8 === 0 && p9 === 1) A++;
        if (p9 === 0 && p2 === 1) A++;

        if (A !== 1) continue;

        if (step === 0) {
          if (p2 * p4 * p6 !== 0) continue;
          if (p4 * p6 * p8 !== 0) continue;
        } else {
          if (p2 * p4 * p8 !== 0) continue;
          if (p2 * p6 * p8 !== 0) continue;
        }

        toClear[clearCount++] = idx;
      }

      if (clearCount > 0) {
        changed = true;
        for (let i = 0; i < clearCount; i++) {
          skel[toClear[i]] = 0;
        }
        let writePtr = 0;
        for (let k = 0; k < activeCount; k++) {
          const idx = activePixels[k];
          if (skel[idx]) {
            activePixels[writePtr++] = idx;
          }
        }
        activeCount = writePtr;
      }
    }

    if (!changed) break;
  }

  // Khử các điểm chữ L thừa (Staircase removal) để khung xương chỉ nối 8-connected mượt mà
  let skeletonCount = 0;
  for (let k = 0; k < activeCount; k++) {
    const idx = activePixels[k];
    if (skel[idx] === 0) continue;
    const n = skel[idx - width];
    const s = skel[idx + width];
    const e = skel[idx + 1];
    const w = skel[idx - 1];
    const ne = skel[idx - width + 1];
    const nw = skel[idx - width - 1];
    const se = skel[idx + width + 1];
    const sw = skel[idx + width - 1];

    if (n && e && !nw && !sw && !se) {
      skel[idx] = 0;
    } else if (n && w && !ne && !se && !sw) {
      skel[idx] = 0;
    } else if (s && e && !sw && !nw && !ne) {
      skel[idx] = 0;
    } else if (s && w && !se && !ne && !nw) {
      skel[idx] = 0;
    } else {
      skeletonCount++;
    }
  }

  return { skeleton: skel, skeletonCount };
}

const DX8 = [0, 1, 1, 1, 0, -1, -1, -1];
const DY8 = [-1, -1, 0, 1, 1, 1, 0, -1];

/**
 * Làm mượt chuỗi điểm khung xương bằng bộ lọc bảo toàn thể tích Taubin (Lambda-Mu Smoothing)
 * Giúp biến bậc thang trên đường cong thoai thoải thành đường cong mượt mà KHÔNG làm co rút bán kính!
 */
function smoothSkeletonChain(chain: Point2D[], isClosed: boolean): Point2D[] {
  const n = chain.length;
  if (n <= 3) return chain.map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 }));

  let pts = chain.map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 }));

  // Tìm và ghim các đỉnh góc nhọn vĩ mô thực sự (span = 6 điểm)
  const pinned = new Uint8Array(n);
  if (!isClosed) {
    pinned[0] = 1;
    pinned[n - 1] = 1;
  }

  const span = Math.min(6, Math.floor(n / 3));
  if (span >= 3) {
    for (let i = 0; i < n; i++) {
      if (!isClosed && (i < span || i >= n - span)) continue;
      const pA = pts[(i - span + n) % n];
      const pB = pts[i];
      const pC = pts[(i + span) % n];
      const v1x = pB.x - pA.x;
      const v1y = pB.y - pA.y;
      const v2x = pC.x - pB.x;
      const v2y = pC.y - pB.y;
      const l1 = Math.hypot(v1x, v1y);
      const l2 = Math.hypot(v2x, v2y);
      if (l1 > 2.5 && l2 > 2.5) {
        const cos = (v1x * v2x + v1y * v2y) / (l1 * l2);
        // Chỉ ghim khi góc bẻ hướng vĩ mô thực sự gắt (> 72 độ)
        if (cos < 0.3) {
          pinned[i] = 1;
        }
      }
    }
  }

  const mobility = new Float32Array(n).fill(1.0);
  for (let i = 0; i < n; i++) {
    if (pinned[i]) {
      mobility[i] = 0.0;
      if (isClosed) {
        const prev1 = (i - 1 + n) % n;
        const next1 = (i + 1) % n;
        if (!pinned[prev1]) mobility[prev1] = Math.min(mobility[prev1], 0.45);
        if (!pinned[next1]) mobility[next1] = Math.min(mobility[next1], 0.45);
      } else {
        if (i > 0 && !pinned[i - 1])
          mobility[i - 1] = Math.min(mobility[i - 1], 0.45);
        if (i + 1 < n && !pinned[i + 1])
          mobility[i + 1] = Math.min(mobility[i + 1], 0.45);
      }
    }
  }

  const passes = n > 16 ? 8 : 5;
  const LAMBDA = 0.5;
  const MU = -0.53;
  const tmpPts: Point2D[] = new Array(n);
  const nextPts: Point2D[] = new Array(n);

  const computeAvg = (arr: Point2D[], i: number): Point2D => {
    if (!isClosed && (i === 1 || i === n - 2)) {
      const prev = arr[i - 1];
      const next = arr[i + 1];
      return {
        x: 0.5 * (prev.x + next.x),
        y: 0.5 * (prev.y + next.y),
      };
    }
    const pPrev2 = arr[(i - 2 + n) % n];
    const pPrev1 = arr[(i - 1 + n) % n];
    const pNext1 = arr[(i + 1) % n];
    const pNext2 = arr[(i + 2 + n) % n];
    return {
      x: 0.15 * pPrev2.x + 0.35 * pPrev1.x + 0.35 * pNext1.x + 0.15 * pNext2.x,
      y: 0.15 * pPrev2.y + 0.35 * pPrev1.y + 0.35 * pNext1.y + 0.15 * pNext2.y,
    };
  };

  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < n; i++) {
      const mob = mobility[i];
      if (mob <= 0) {
        tmpPts[i] = pts[i];
      } else {
        const avg = computeAvg(pts, i);
        const step = LAMBDA * mob;
        tmpPts[i] = {
          x: pts[i].x + step * (avg.x - pts[i].x),
          y: pts[i].y + step * (avg.y - pts[i].y),
        };
      }
    }

    for (let i = 0; i < n; i++) {
      const mob = mobility[i];
      if (mob <= 0) {
        nextPts[i] = tmpPts[i];
      } else {
        const avg = computeAvg(tmpPts, i);
        const step = MU * mob;
        nextPts[i] = {
          x: tmpPts[i].x + step * (avg.x - tmpPts[i].x),
          y: tmpPts[i].y + step * (avg.y - tmpPts[i].y),
        };
      }
    }

    pts = nextPts.map((p) => ({ x: p.x, y: p.y }));
  }

  return pts;
}

/**
 * Tính vector tiếp tuyến hướng ra ngoài tại đầu mút của chuỗi điểm
 */
function getOutwardEndpointTangent(pts: Point2D[], atEnd: boolean): Point2D {
  const n = pts.length;
  const look = Math.min(5, n - 1);
  const dx = atEnd
    ? pts[n - 1].x - pts[n - 1 - look].x
    : pts[0].x - pts[look].x;
  const dy = atEnd
    ? pts[n - 1].y - pts[n - 1 - look].y
    : pts[0].y - pts[look].y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

/**
 * Tự động nối các chuỗi mở (Open Chains) có đầu mút nằm sát nhau (<= 4.5px)
 * Sử dụng Lưới Băm Không Gian 2D (Spatial Hash Grid O(M)) kết hợp ghép cặp đồng loạt (Batch Greedy Matching),
 * giúp xử lý 5.000+ đoạn vảy rồng phức tạp chỉ trong < 2ms thay vì bị treo O(M^3)!
 */
function stitchNearbyOpenChains(
  chains: { points: Point2D[]; isClosed: boolean }[]
): { points: Point2D[]; isClosed: boolean }[] {
  const closed = chains.filter((c) => c.isClosed);
  let open = chains
    .filter((c) => !c.isClosed && c.points.length >= 2)
    .map((c) => c.points.slice());

  const maxGap = 4.5;
  const maxGapSq = maxGap * maxGap;
  const cellSize = 5;
  // Yêu cầu góc bẻ hướng tại điểm nối <= 63 độ (cos >= 0.45) để không nối rẽ ngang chữ T sai lệch
  const minAlignmentCos = 0.45;

  // Tối đa 6 vòng ghép đồng loạt trên lưới không gian (nối chuỗi dài tới 2^6 = 64 đoạn chỉ trong vài ms)
  for (let pass = 0; pass < 6 && open.length > 1; pass++) {
    const m = open.length;
    const tanStart: Point2D[] = new Array(m);
    const tanEnd: Point2D[] = new Array(m);
    const grid = new Map<number, number[]>();

    const addEndpointToGrid = (x: number, y: number, encodedEp: number) => {
      const gx = Math.floor(x / cellSize);
      const gy = Math.floor(y / cellSize);
      const key = (gy << 16) ^ gx;
      let bucket = grid.get(key);
      if (!bucket) {
        bucket = [];
        grid.set(key, bucket);
      }
      bucket.push(encodedEp);
    };

    for (let i = 0; i < m; i++) {
      const pts = open[i];
      tanStart[i] = getOutwardEndpointTangent(pts, false);
      tanEnd[i] = getOutwardEndpointTangent(pts, true);
      addEndpointToGrid(pts[0].x, pts[0].y, i << 1);
      addEndpointToGrid(
        pts[pts.length - 1].x,
        pts[pts.length - 1].y,
        (i << 1) | 1
      );
    }

    interface StitchCandidate {
      i: number;
      j: number;
      mode: number; // 0: aEnd-bStart, 1: aEnd-bEnd, 2: aStart-bEnd, 3: aStart-bStart
      score: number;
    }

    const candidates: StitchCandidate[] = [];

    for (let i = 0; i < m; i++) {
      const a = open[i];
      for (let aIsEnd = 0; aIsEnd <= 1; aIsEnd++) {
        const ptA = aIsEnd ? a[a.length - 1] : a[0];
        const tA = aIsEnd ? tanEnd[i] : tanStart[i];
        const gx0 = Math.floor(ptA.x / cellSize);
        const gy0 = Math.floor(ptA.y / cellSize);

        for (let dy = -1; dy <= 1; dy++) {
          const gy = gy0 + dy;
          for (let dx = -1; dx <= 1; dx++) {
            const bucket = grid.get((gy << 16) ^ (gx0 + dx));
            if (!bucket) continue;

            for (let k = 0; k < bucket.length; k++) {
              const epB = bucket[k];
              const j = epB >> 1;
              if (j <= i) continue;
              const bIsEnd = epB & 1;
              const b = open[j];
              const ptB = bIsEnd ? b[b.length - 1] : b[0];

              const ddx = ptA.x - ptB.x;
              const ddy = ptA.y - ptB.y;
              const distSq = ddx * ddx + ddy * ddy;
              if (distSq > maxGapSq) continue;

              const tB = bIsEnd ? tanEnd[j] : tanStart[j];
              const alignment = -(tA.x * tB.x + tA.y * tB.y);
              if (alignment < minAlignmentCos) continue;

              const dist = Math.sqrt(distSq);
              const score = alignment * 4.0 - dist * 0.35;
              const mode =
                aIsEnd === 1
                  ? bIsEnd === 0
                    ? 0
                    : 1
                  : bIsEnd === 1
                    ? 2
                    : 3;

              candidates.push({ i, j, mode, score });
            }
          }
        }
      }
    }

    if (candidates.length === 0) break;

    candidates.sort((c1, c2) => c2.score - c1.score);

    const mergedFlag = new Uint8Array(m);
    const nextOpen: Point2D[][] = [];
    let mergesInPass = 0;

    for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
      const { i, j, mode } = candidates[cIdx];
      if (mergedFlag[i] || mergedFlag[j]) continue;

      mergedFlag[i] = 1;
      mergedFlag[j] = 1;
      mergesInPass++;

      const a = open[i];
      const b = open[j];
      const skipFirstB =
        (mode === 0 &&
          a[a.length - 1].x === b[0].x &&
          a[a.length - 1].y === b[0].y) ||
        (mode === 1 &&
          a[a.length - 1].x === b[b.length - 1].x &&
          a[a.length - 1].y === b[b.length - 1].y) ||
        (mode === 2 &&
          a[0].x === b[b.length - 1].x &&
          a[0].y === b[b.length - 1].y) ||
        (mode === 3 && a[0].x === b[0].x && a[0].y === b[0].y);

      if (mode === 0) {
        nextOpen.push(a.concat(skipFirstB ? b.slice(1) : b));
      } else if (mode === 1) {
        const bRev = b.slice().reverse();
        nextOpen.push(a.concat(skipFirstB ? bRev.slice(1) : bRev));
      } else if (mode === 2) {
        nextOpen.push(b.concat(skipFirstB ? a.slice(1) : a));
      } else {
        const bRev = b.slice().reverse();
        nextOpen.push(bRev.concat(skipFirstB ? a.slice(1) : a));
      }
    }

    if (mergesInPass === 0) break;

    for (let i = 0; i < m; i++) {
      if (!mergedFlag[i]) {
        nextOpen.push(open[i]);
      }
    }
    open = nextOpen;
  }

  return [
    ...closed,
    ...open.map((pts) => ({
      points: pts,
      isClosed:
        pts.length >= 10 &&
        Math.hypot(
          pts[0].x - pts[pts.length - 1].x,
          pts[0].y - pts[pts.length - 1].y
        ) <= 3.0,
    })),
  ];
}

export function traceCenterlineStrokeLayer(
  inkMask: Uint8Array,
  width: number,
  height: number,
  colorId: number,
  hex: string,
  simplifyTolerance: number,
  cornerThreshold: number,
  curveSmoothing: number,
  userStrokeWidth: number,
  timingsOut?: { tracingMs: number; curveFittingMs: number }
): VectorPathData | null {
  const tTraceStart = performance.now();
  let inkPixels = 0;
  for (let i = 0; i < inkMask.length; i++) {
    if (inkMask[i]) inkPixels++;
  }
  if (inkPixels === 0) return null;

  // Hàn gắn các khe đứt 1..2px trên nét vẽ mảnh (Morphological Closing 8 hướng)
  const healedMask = new Uint8Array(inkMask);
  for (let pass = 0; pass < 2; pass++) {
    const prev = new Uint8Array(healedMask);
    for (let y = 1; y < height - 1; y++) {
      const row = y * width;
      for (let x = 1; x < width - 1; x++) {
        const idx = row + x;
        if (prev[idx]) continue;
        if (
          (prev[idx - 1] && prev[idx + 1]) ||
          (prev[idx - width] && prev[idx + width]) ||
          (prev[idx - width - 1] && prev[idx + width + 1]) ||
          (prev[idx - width + 1] && prev[idx + width - 1])
        ) {
          healedMask[idx] = 1;
        }
      }
    }
  }

  const { skeleton, skeletonCount } = zhangSuenThinning(
    healedMask,
    width,
    height
  );
  if (skeletonCount === 0) return null;

  const estimatedWidth = Math.max(
    1.8,
    Math.min(10, Math.round((inkPixels / Math.max(1, skeletonCount)) * 10) / 10)
  );
  const finalStrokeWidth =
    userStrokeWidth > 0 ? userStrokeWidth : estimatedWidth;

  const totalPixels = width * height;
  const degree = new Uint8Array(totalPixels);
  const recomputeDegrees = () => {
    degree.fill(0);
    for (let y = 1; y < height - 1; y++) {
      const row = y * width;
      for (let x = 1; x < width - 1; x++) {
        const idx = row + x;
        if (!skeleton[idx]) continue;
        let deg = 0;
        for (let d = 0; d < 8; d++) {
          if (skeleton[(y + DY8[d]) * width + (x + DX8[d])]) deg++;
        }
        degree[idx] = deg;
      }
    }
  };

  recomputeDegrees();

  // Cắt tỉa các nhánh gai/râu ngắn (Spur Pruning <= 8px) mọc ra từ ngã ba (degree >= 3)
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const startIdx = y * width + x;
        if (!skeleton[startIdx] || degree[startIdx] !== 1) continue;

        const spurIndices: number[] = [startIdx];
        let curr = startIdx;
        let prev = -1;
        let hitJunction = false;

        while (spurIndices.length <= 8) {
          const cx = curr % width;
          const cy = (curr - cx) / width;
          let next = -1;
          for (let d = 0; d < 8; d++) {
            const nIdx = (cy + DY8[d]) * width + (cx + DX8[d]);
            if (skeleton[nIdx] && nIdx !== prev) {
              next = nIdx;
              break;
            }
          }
          if (next === -1) break;
          if (degree[next] >= 3) {
            hitJunction = true;
            break;
          }
          spurIndices.push(next);
          prev = curr;
          curr = next;
        }

        if (hitJunction) {
          for (const sIdx of spurIndices) {
            skeleton[sIdx] = 0;
          }
        }
      }
    }
    recomputeDegrees();
  }

  // Dùng mặt nạ bit 8 hướng (Uint8Array) thay vì Set<string> để tránh cấp phát hàng chục nghìn chuỗi!
  const visitedDirMask = new Uint8Array(totalPixels);
  const rawChains: { points: Point2D[]; isClosed: boolean }[] = [];

  const traceFromNode = (startIdx: number, initDir: number) => {
    if (visitedDirMask[startIdx] & (1 << initDir)) return;
    const sx = startIdx % width;
    const sy = (startIdx - sx) / width;
    const firstNextIdx = (sy + DY8[initDir]) * width + (sx + DX8[initDir]);

    visitedDirMask[startIdx] |= 1 << initDir;
    visitedDirMask[firstNextIdx] |= 1 << ((initDir + 4) & 7);

    const pts: Point2D[] = [
      { x: sx, y: sy },
      { x: firstNextIdx % width, y: Math.floor(firstNextIdx / width) },
    ];

    let prev = startIdx;
    let curr = firstNextIdx;
    let isClosed = false;

    while (true) {
      if (curr === startIdx) {
        isClosed = true;
        break;
      }
      if (degree[curr] !== 2) {
        break;
      }

      const cx = curr % width;
      const cy = (curr - cx) / width;
      let next = -1;
      for (let d = 0; d < 8; d++) {
        const nIdx = (cy + DY8[d]) * width + (cx + DX8[d]);
        if (!skeleton[nIdx] || nIdx === prev) continue;
        if ((visitedDirMask[curr] & (1 << d)) === 0) {
          next = nIdx;
          visitedDirMask[curr] |= 1 << d;
          visitedDirMask[nIdx] |= 1 << ((d + 4) & 7);
          break;
        }
      }

      if (next === -1) break;
      pts.push({ x: next % width, y: Math.floor(next / width) });
      prev = curr;
      curr = next;
    }

    if (pts.length >= 2) {
      rawChains.push({ points: pts, isClosed });
    }
  };

  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = row + x;
      if (!skeleton[idx] || degree[idx] === 2 || degree[idx] === 0) continue;

      for (let d = 0; d < 8; d++) {
        const nIdx = (y + DY8[d]) * width + (x + DX8[d]);
        if (skeleton[nIdx]) {
          traceFromNode(idx, d);
        }
      }
    }
  }

  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = row + x;
      if (!skeleton[idx] || degree[idx] !== 2) continue;

      for (let d = 0; d < 8; d++) {
        const nIdx = (y + DY8[d]) * width + (x + DX8[d]);
        if (skeleton[nIdx] && (visitedDirMask[idx] & (1 << d)) === 0) {
          traceFromNode(idx, d);
          break;
        }
      }
    }
  }

  // Hàn nối các đoạn rời sát nhau thành 1 đường liên tục theo góc tiếp tuyến
  const stitchedChains = stitchNearbyOpenChains(rawChains);
  const tFitStart = performance.now();

  const subpaths: string[] = [];
  const allAnchors: AnchorPoint[] = [];
  let totalNodes = 0;

  for (const chain of stitchedChains) {
    if (chain.points.length < 3 && !chain.isClosed) continue;
    const smoothed = smoothSkeletonChain(chain.points, chain.isClosed);
    const { subpath, anchors } = fitCenterlineChainToBezier(
      smoothed,
      chain.isClosed,
      simplifyTolerance,
      cornerThreshold,
      curveSmoothing
    );
    if (subpath) {
      subpaths.push(subpath);
      totalNodes += anchors.length;
      if (allAnchors.length < 25000) {
        allAnchors.push(...anchors);
      }
    }
  }

  if (timingsOut) {
    timingsOut.tracingMs = Math.round(tFitStart - tTraceStart);
    timingsOut.curveFittingMs = Math.round(performance.now() - tFitStart);
  }

  if (subpaths.length === 0) return null;

  return {
    colorId,
    hex,
    d: subpaths.join(' '),
    nodeCount: totalNodes,
    contourCount: subpaths.length,
    area: inkPixels,
    anchors: allAnchors,
    isStroke: true,
    strokeWidth: finalStrokeWidth,
  };
}
