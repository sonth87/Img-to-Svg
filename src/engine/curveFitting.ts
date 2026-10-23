/**
 * BƯỚC 5: ĐƠN GIẢN HÓA ĐƯỜNG NÉT & KHỚP ĐƯỜNG CONG BÉZIER (CLOSED & OPEN PATHS)
 *
 * Cải tiến quan trọng:
 * 1. `cornerThresholdDeg` là GÓC BẺ GẬP TỐI THIỂU (Turn Angle, từ 0° = đi thẳng đến 180° = gập đôi):
 *    - Đường cong mượt có góc bẻ hướng nhỏ (10°..45°) -> luôn là Smooth Node (chấm tròn xanh lá).
 *    - Góc vuông có góc bẻ hướng 90°, góc nhọn tam giác có góc bẻ hướng 110°..140°.
 *    - Đỉnh chỉ biến thành Góc Nhọn (ô vuông cam) khi `turnAngleDeg >= cornerThresholdDeg`
 *      VÀ hai nhánh xung quanh có độ dài vĩ mô thực sự (không phải bậc thang 1-2px!).
 * 2. Chống chia vụn điểm neo (Anti-Micro-Stepping):
 *    - Đảm bảo khoảng cách dây cung tối thiểu khi bật uốn cong Bézier để đường cong
 *      chỉ cần một vài điểm neo ở giữa mà vẫn mượt tuyệt đối.
 */

import { AnchorPoint, VectorPathData } from '../types/vectorizer';
import { Point2D, TracedLayerContours } from './marchingSquares';

export interface IndexedPoint2D extends Point2D {
  rawIndex: number;
}

export function pointToSegmentDistSq(
  p: Point2D,
  a: Point2D,
  b: Point2D
): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = p.x - a.x;
  const wy = p.y - a.y;

  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) {
    return wx * wx + wy * wy;
  }
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) {
    const dx = p.x - b.x;
    const dy = p.y - b.y;
    return dx * dx + dy * dy;
  }
  const t = c1 / c2;
  const projX = a.x + t * vx;
  const projY = a.y + t * vy;
  const dx = p.x - projX;
  const dy = p.y - projY;
  return dx * dx + dy * dy;
}

export function rdpOpenChainIndexed(
  points: IndexedPoint2D[],
  epsSq: number
): IndexedPoint2D[] {
  const n = points.length;
  if (n <= 2) return points;

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  const stack: [number, number][] = [[0, n - 1]];

  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    if (last - first <= 1) continue;

    let maxDistSq = -1;
    let index = -1;
    const pFirst = points[first];
    const pLast = points[last];

    for (let i = first + 1; i < last; i++) {
      const dSq = pointToSegmentDistSq(points[i], pFirst, pLast);
      if (dSq > maxDistSq) {
        maxDistSq = dSq;
        index = i;
      }
    }

    if (maxDistSq > epsSq && index !== -1) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  const result: IndexedPoint2D[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) result.push(points[i]);
  }
  return result;
}

/**
 * Lọc bỏ các đỉnh quá sát nhau (< minChordDist) trên đường cong để tránh tạo hàng trăm điểm neo sát từng pixel
 */
function pruneTooCloseVerticesClosed(
  pts: IndexedPoint2D[],
  minChordDist: number
): IndexedPoint2D[] {
  if (pts.length <= 4 || minChordDist <= 0.5) return pts;
  const out: IndexedPoint2D[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const prev = out[out.length - 1];
    const curr = pts[i];
    const next = pts[(i + 1) % pts.length];
    const dPrev = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const dNext = Math.hypot(next.x - curr.x, next.y - curr.y);

    // Giữ lại nếu khoảng cách đủ lớn HOẶC nếu đây là đỉnh góc nhọn thật sự (> 65 độ)
    if (dPrev < minChordDist) {
      const v1x = curr.x - prev.x;
      const v1y = curr.y - prev.y;
      const v2x = next.x - curr.x;
      const v2y = next.y - curr.y;
      const cos =
        (v1x * v2x + v1y * v2y) / (Math.max(1e-4, dPrev * dNext));
      if (cos > 0.42) {
        // Không phải góc nhọn -> gộp bỏ điểm quá gần này để đường cong mượt!
        continue;
      }
    }
    out.push(curr);
  }
  return out.length >= 3 ? out : pts.slice(0, 3);
}

export function simplifyClosedContourRDP(
  contour: Point2D[],
  epsilon: number,
  curveSmoothing = 0.8
): IndexedPoint2D[] {
  const n = contour.length;
  const indexed: IndexedPoint2D[] = contour.map((pt, i) => ({
    x: pt.x,
    y: pt.y,
    rawIndex: i,
  }));

  if (n <= 4) return indexed;

  // Tôn trọng trực tiếp ngưỡng RDP của người dùng (từ 0.2px trở lên)
  const effectiveEps = Math.max(0.15, epsilon);

  let idxA = 0;
  let maxDist0 = -1;
  const p0 = indexed[0];
  for (let i = 1; i < n; i++) {
    const dx = indexed[i].x - p0.x;
    const dy = indexed[i].y - p0.y;
    const d = dx * dx + dy * dy;
    if (d > maxDist0) {
      maxDist0 = d;
      idxA = i;
    }
  }

  let idxB = (idxA + Math.floor(n / 2)) % n;
  let maxDistA = -1;
  const pA = indexed[idxA];
  for (let i = 0; i < n; i++) {
    if (i === idxA) continue;
    const dx = indexed[i].x - pA.x;
    const dy = indexed[i].y - pA.y;
    const d = dx * dx + dy * dy;
    if (d > maxDistA) {
      maxDistA = d;
      idxB = i;
    }
  }

  const chain1: IndexedPoint2D[] = [];
  for (let i = idxA; i !== idxB; i = (i + 1) % n) {
    chain1.push(indexed[i]);
  }
  chain1.push(indexed[idxB]);

  const chain2: IndexedPoint2D[] = [];
  for (let i = idxB; i !== idxA; i = (i + 1) % n) {
    chain2.push(indexed[i]);
  }
  chain2.push(indexed[idxA]);

  const epsSq = effectiveEps * effectiveEps;
  const simp1 = rdpOpenChainIndexed(chain1, epsSq);
  const simp2 = rdpOpenChainIndexed(chain2, epsSq);

  const merged = [...simp1.slice(0, -1), ...simp2.slice(0, -1)];
  const minChord =
    effectiveEps <= 0.6
      ? effectiveEps * 0.85
      : curveSmoothing > 0.3
        ? Math.max(1.2, Math.min(3.6, effectiveEps * 2.2))
        : 1.0;
  const cleaned = pruneTooCloseVerticesClosed(merged, minChord);
  return cleaned.length >= 3 ? cleaned : indexed.slice(0, 3);
}

function checkIsLongFlatStraightEdge(
  a: IndexedPoint2D,
  b: IndexedPoint2D,
  rawContour: Point2D[]
): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const segLen = Math.hypot(dx, dy);

  if (segLen < 28.0) return false;

  const rawN = rawContour.length;
  let maxPerpDist = 0;
  const invLen = 1 / segLen;
  const nx = -dy * invLen;
  const ny = dx * invLen;

  let idx = (a.rawIndex + 1) % rawN;
  let guard = 0;
  while (idx !== b.rawIndex && guard < rawN) {
    const pt = rawContour[idx];
    const perp = Math.abs((pt.x - a.x) * nx + (pt.y - a.y) * ny);
    if (perp > maxPerpDist) {
      maxPerpDist = perp;
    }
    idx = (idx + 1) % rawN;
    guard++;
  }

  return maxPerpDist <= 0.36;
}

function fmt(val: number): string {
  return (Math.round(val * 100) / 100).toString();
}

/**
 * Thuật toán Philip J. Schneider (Least-Squares Cubic Bézier Curve Fitting):
 * Tìm độ dài 2 tay đòn tối ưu (alpha1, alpha2) dọc theo tiếp tuyến đơn vị (tHat1, tHat2)
 * sao cho đường cong Cubic Bézier B(u) bám sát chuỗi điểm gốc Q[0..m] với sai số bình phương nhỏ nhất!
 */
function solveSchneiderBezierHandles(
  subPoints: Point2D[],
  tHat1: Point2D,
  tHat2: Point2D,
  segLen: number,
  defaultLen1: number,
  defaultLen2: number
): [number, number] {
  const m = subPoints.length - 1;
  if (m < 2 || segLen < 1.5) {
    return [defaultLen1, defaultLen2];
  }

  // Tham số hóa theo độ dài dây cung (Chord-Length Parameterization)
  const u = new Float32Array(m + 1);
  u[0] = 0;
  for (let i = 1; i <= m; i++) {
    const dx = subPoints[i].x - subPoints[i - 1].x;
    const dy = subPoints[i].y - subPoints[i - 1].y;
    u[i] = u[i - 1] + Math.hypot(dx, dy);
  }
  const totalChord = u[m];
  if (totalChord <= 1e-5) {
    return [defaultLen1, defaultLen2];
  }
  for (let i = 1; i <= m; i++) {
    u[i] /= totalChord;
  }

  const p0 = subPoints[0];
  const p3 = subPoints[m];

  let c11 = 0;
  let c12 = 0;
  let c22 = 0;
  let x1 = 0;
  let x2 = 0;

  for (let i = 1; i < m; i++) {
    const ui = u[i];
    const invU = 1 - ui;
    const b0 = invU * invU * invU;
    const b1 = 3 * ui * invU * invU;
    const b2 = 3 * ui * ui * invU;
    const b3 = ui * ui * ui;

    const a1x = tHat1.x * b1;
    const a1y = tHat1.y * b1;
    const a2x = tHat2.x * b2;
    const a2y = tHat2.y * b2;

    c11 += a1x * a1x + a1y * a1y;
    c12 += a1x * a2x + a1y * a2y;
    c22 += a2x * a2x + a2y * a2y;

    const basePx = (b0 + b1) * p0.x + (b2 + b3) * p3.x;
    const basePy = (b0 + b1) * p0.y + (b2 + b3) * p3.y;
    const rx = subPoints[i].x - basePx;
    const ry = subPoints[i].y - basePy;

    x1 += rx * a1x + ry * a1y;
    x2 += rx * a2x + ry * a2y;
  }

  const detC = c11 * c22 - c12 * c12;
  if (Math.abs(detC) <= 1e-6) {
    return [defaultLen1, defaultLen2];
  }

  const alpha1 = (x1 * c22 - x2 * c12) / detC;
  const alpha2 = (c11 * x2 - c12 * x1) / detC;

  const minAlpha = segLen * 0.12;
  const maxAlpha = segLen * 0.78;

  if (
    alpha1 <= minAlpha ||
    alpha2 <= minAlpha ||
    alpha1 > maxAlpha * 1.35 ||
    alpha2 > maxAlpha * 1.35
  ) {
    return [defaultLen1, defaultLen2];
  }

  return [
    Math.max(minAlpha, Math.min(maxAlpha, alpha1)),
    Math.max(minAlpha, Math.min(maxAlpha, alpha2)),
  ];
}

/**
 * Khớp đường cong Cubic Bézier cho đường bao KHÉP KÍN (Vùng màu Fill)
 * Kết hợp phát hiện đỉnh góc nhọn & Least-Squares Schneider Fitting
 */
export function fitContourToBezierSubpath(
  points: IndexedPoint2D[],
  rawContour: Point2D[],
  cornerThresholdDeg: number,
  curveSmoothing: number
): { subpath: string; anchors: AnchorPoint[] } {
  const n = points.length;
  if (n < 3) return { subpath: '', anchors: [] };

  const segLengths = new Float32Array(n);
  const isLongFlatEdge = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    const p0 = points[i];
    const p1 = points[(i + 1) % n];
    segLengths[i] = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    isLongFlatEdge[i] = checkIsLongFlatStraightEdge(p0, p1, rawContour) ? 1 : 0;
  }

  const isCorner = new Uint8Array(n);
  const tangents: Point2D[] = new Array(n);

  // Ngưỡng góc bẻ hướng tối thiểu (Turn Angle: 0° là thẳng, 90° là góc vuông, 140° là góc nhọn gắt)
  const minTurnForCorner = Math.max(35, Math.min(165, cornerThresholdDeg));

  for (let i = 0; i < n; i++) {
    const prevIdx = (i - 1 + n) % n;
    const nextIdx = (i + 1) % n;
    const pPrev = points[prevIdx];
    const pCurr = points[i];
    const pNext = points[nextIdx];

    const v1x = pCurr.x - pPrev.x;
    const v1y = pCurr.y - pPrev.y;
    const v2x = pNext.x - pCurr.x;
    const v2y = pNext.y - pCurr.y;

    const len1 = segLengths[prevIdx];
    const len2 = segLengths[i];

    if (len1 < 1e-4 || len2 < 1e-4) {
      isCorner[i] = 1;
      tangents[i] = { x: 0, y: 0 };
      continue;
    }

    const u1x = v1x / len1;
    const u1y = v1y / len1;
    const u2x = v2x / len2;
    const u2y = v2y / len2;

    const dot = Math.max(-1, Math.min(1, u1x * u2x + u1y * u2y));
    const turnAngleDeg = (Math.acos(dot) * 180) / Math.PI;

    const isGenuineMacroCorner =
      turnAngleDeg >= minTurnForCorner && Math.max(len1, len2) >= 4.0;

    if (
      curveSmoothing <= 0.02 ||
      isGenuineMacroCorner ||
      (isLongFlatEdge[prevIdx] && isLongFlatEdge[i] && turnAngleDeg > 18) ||
      ((isLongFlatEdge[prevIdx] || isLongFlatEdge[i]) && turnAngleDeg > 48)
    ) {
      isCorner[i] = 1;
      tangents[i] = { x: 0, y: 0 };
    } else {
      isCorner[i] = 0;
      if (isLongFlatEdge[prevIdx]) {
        tangents[i] = { x: u1x, y: u1y };
      } else if (isLongFlatEdge[i]) {
        tangents[i] = { x: u2x, y: u2y };
      } else {
        const w1 = Math.sqrt(len2);
        const w2 = Math.sqrt(len1);
        const tx = u1x * w1 + u2x * w2;
        const ty = u1y * w1 + u2y * w2;
        const tLen = Math.hypot(tx, ty);
        tangents[i] =
          tLen > 1e-5 ? { x: tx / tLen, y: ty / tLen } : { x: u2x, y: u2y };
      }
    }
  }

  const anchors: AnchorPoint[] = points.map((p, i) => ({
    x: p.x,
    y: p.y,
    isCorner: isCorner[i] === 1,
  }));

  const cmds: string[] = [`M${fmt(points[0].x)} ${fmt(points[0].y)}`];
  const smoothScale = Math.max(0, Math.min(1.3, curveSmoothing));
  const tension = smoothScale * 0.35;
  const rawN = rawContour.length;

  for (let i = 0; i < n; i++) {
    const prevIdx = (i - 1 + n) % n;
    const nextIdx = (i + 1) % n;
    const nextNextIdx = (i + 2) % n;

    const p0 = points[i];
    const p1 = points[nextIdx];

    const segDx = p1.x - p0.x;
    const segDy = p1.y - p0.y;
    const segLen = segLengths[i];

    // Trích xuất chuỗi điểm biên thực tế giữa p0 và p1 để kiểm tra độ cong và khớp Least-Squares
    const subPoints: Point2D[] = [p0];
    if (rawN > 0 && p0.rawIndex !== p1.rawIndex) {
      let rIdx = (p0.rawIndex + 1) % rawN;
      let guard = 0;
      while (rIdx !== p1.rawIndex && guard < rawN) {
        subPoints.push(rawContour[rIdx]);
        rIdx = (rIdx + 1) % rawN;
        guard++;
      }
    }
    subPoints.push(p1);

    // Kiểm tra xem đoạn giữa 2 góc nhọn có thực sự phẳng hay là 1 cung cong
    let maxArchDev = 0;
    if (subPoints.length > 2 && segLen > 2.5) {
      const invL = 1 / segLen;
      const nx = -segDy * invL;
      const ny = segDx * invL;
      for (let k = 1; k < subPoints.length - 1; k++) {
        const dev = Math.abs(
          (subPoints[k].x - p0.x) * nx + (subPoints[k].y - p0.y) * ny
        );
        if (dev > maxArchDev) maxArchDev = dev;
      }
    }

    const bothCornersAndFlat =
      isCorner[i] === 1 && isCorner[nextIdx] === 1 && maxArchDev < 1.55;

    if (
      bothCornersAndFlat ||
      isLongFlatEdge[i] === 1 ||
      tension <= 0.005 ||
      segLen < 1.2
    ) {
      if (nextIdx !== 0) {
        cmds.push(`L${fmt(p1.x)} ${fmt(p1.y)}`);
      }
    } else {
      const chordUx = segDx / segLen;
      const chordUy = segDy / segLen;

      // Tiếp tuyến xuất phát tại p0 (tHat1 hướng từ p0 -> p1)
      // Nếu p0 là Đỉnh Góc Nhọn (isCorner[i] === 1), hướng tay đòn thẳng theo dây cung để tạo góc sắc nét thật sự!
      const tHat1: Point2D =
        isCorner[i] === 0 ? tangents[i] : { x: chordUx, y: chordUy };

      // Tiếp tuyến đi vào p1 (tHat2 hướng từ p1 ngược về p0 để CP2 = p1 + alpha2 * tHat2)
      const tHat2: Point2D =
        isCorner[nextIdx] === 0
          ? { x: -tangents[nextIdx].x, y: -tangents[nextIdx].y }
          : { x: -chordUx, y: -chordUy };

      const limitLen1 = isCorner[i]
        ? segLen * 0.25
        : Math.min(segLen, segLengths[prevIdx] * 1.85);
      const limitLen2 = isCorner[nextIdx]
        ? segLen * 0.25
        : Math.min(segLen, segLengths[nextNextIdx] * 1.85);

      const defaultLen1 = limitLen1 * tension;
      const defaultLen2 = limitLen2 * tension;

      const [optLen1, optLen2] = solveSchneiderBezierHandles(
        subPoints,
        tHat1,
        tHat2,
        segLen,
        defaultLen1,
        defaultLen2
      );

      // Hòa trộn mượt giữa tay đòn tối ưu Schneider và hệ số curveSmoothing của người dùng
      const handleLen1 = isCorner[i]
        ? Math.min(segLen * 0.2, defaultLen1)
        : Math.min(limitLen1 * 0.78, optLen1 * smoothScale);
      const handleLen2 = isCorner[nextIdx]
        ? Math.min(segLen * 0.2, defaultLen2)
        : Math.min(limitLen2 * 0.78, optLen2 * smoothScale);

      const cp1x = p0.x + tHat1.x * handleLen1;
      const cp1y = p0.y + tHat1.y * handleLen1;
      const cp2x = p1.x + tHat2.x * handleLen2;
      const cp2y = p1.y + tHat2.y * handleLen2;

      cmds.push(
        `C${fmt(cp1x)} ${fmt(cp1y)},${fmt(cp2x)} ${fmt(cp2y)},${fmt(p1.x)} ${fmt(p1.y)}`
      );
    }
  }

  cmds.push('Z');
  return { subpath: cmds.join(' '), anchors };
}

/**
 * Khớp đường cong Cubic Bézier cho đường đơn MỞ hoặc ĐÓNG (Chế độ Nét Đơn Centerline Stroke)
 * Tôn trọng độ rút gọn RDP của người dùng và khớp Least-Squares Bézier mượt mà
 */
export function fitCenterlineChainToBezier(
  chain: Point2D[],
  isClosed: boolean,
  simplifyTolerance: number,
  cornerThresholdDeg: number,
  curveSmoothing: number
): { subpath: string; anchors: AnchorPoint[] } {
  if (chain.length < 2) return { subpath: '', anchors: [] };

  const strokeEps = Math.max(0.2, simplifyTolerance);

  if (isClosed && chain.length >= 4) {
    const simplified = simplifyClosedContourRDP(
      chain,
      strokeEps,
      curveSmoothing
    );
    return fitContourToBezierSubpath(
      simplified,
      chain,
      cornerThresholdDeg,
      curveSmoothing
    );
  }

  const indexed: IndexedPoint2D[] = chain.map((pt, i) => ({
    x: pt.x,
    y: pt.y,
    rawIndex: i,
  }));
  const rawSimp = rdpOpenChainIndexed(indexed, strokeEps * strokeEps);

  // Khoảng cách lọc điểm tối thiểu tỉ lệ thuận với simplifyTolerance thay vì ép cứng 5.5px
  const minOpenChord =
    curveSmoothing > 0.3
      ? Math.max(1.8, Math.min(5.0, strokeEps * 3.2))
      : 1.0;
  const pts: IndexedPoint2D[] = [rawSimp[0]];
  for (let i = 1; i < rawSimp.length - 1; i++) {
    const prev = pts[pts.length - 1];
    const curr = rawSimp[i];
    if (Math.hypot(curr.x - prev.x, curr.y - prev.y) >= minOpenChord) {
      pts.push(curr);
    }
  }
  if (rawSimp.length > 1) {
    pts.push(rawSimp[rawSimp.length - 1]);
  }

  const n = pts.length;
  if (n < 2) return { subpath: '', anchors: [] };

  if (n === 2) {
    return {
      subpath: `M${fmt(pts[0].x)} ${fmt(pts[0].y)} L${fmt(pts[1].x)} ${fmt(pts[1].y)}`,
      anchors: [
        { x: pts[0].x, y: pts[0].y, isCorner: true },
        { x: pts[1].x, y: pts[1].y, isCorner: true },
      ],
    };
  }

  const isCorner = new Uint8Array(n);
  const tangents: Point2D[] = new Array(n);
  isCorner[0] = 1;
  isCorner[n - 1] = 1;

  // Ước lượng tiếp tuyến đầu mút từ chuỗi điểm gốc để đường cong mở khởi đầu đúng hướng
  const lookStartIdx = Math.min(chain.length - 1, Math.max(1, Math.floor(pts[1].rawIndex * 0.4)));
  const dStart =
    Math.hypot(chain[lookStartIdx].x - pts[0].x, chain[lookStartIdx].y - pts[0].y) || 1;
  tangents[0] = {
    x: (chain[lookStartIdx].x - pts[0].x) / dStart,
    y: (chain[lookStartIdx].y - pts[0].y) / dStart,
  };

  const lookEndIdx = Math.max(
    0,
    Math.min(
      chain.length - 2,
      pts[n - 1].rawIndex - Math.max(1, Math.floor((pts[n - 1].rawIndex - pts[n - 2].rawIndex) * 0.4))
    )
  );
  const dEnd =
    Math.hypot(pts[n - 1].x - chain[lookEndIdx].x, pts[n - 1].y - chain[lookEndIdx].y) || 1;
  tangents[n - 1] = {
    x: (pts[n - 1].x - chain[lookEndIdx].x) / dEnd,
    y: (pts[n - 1].y - chain[lookEndIdx].y) / dEnd,
  };

  const minTurnForCorner = Math.max(35, Math.min(165, cornerThresholdDeg));

  for (let i = 1; i < n - 1; i++) {
    const pPrev = pts[i - 1];
    const pCurr = pts[i];
    const pNext = pts[i + 1];

    const v1x = pCurr.x - pPrev.x;
    const v1y = pCurr.y - pPrev.y;
    const v2x = pNext.x - pCurr.x;
    const v2y = pNext.y - pCurr.y;

    const l1 = Math.hypot(v1x, v1y);
    const l2 = Math.hypot(v2x, v2y);
    if (l1 < 1e-4 || l2 < 1e-4) {
      isCorner[i] = 1;
      tangents[i] = { x: 0, y: 0 };
      continue;
    }

    const u1x = v1x / l1;
    const u1y = v1y / l1;
    const u2x = v2x / l2;
    const u2y = v2y / l2;

    const dot = Math.max(-1, Math.min(1, u1x * u2x + u1y * u2y));
    const turnAngleDeg = (Math.acos(dot) * 180) / Math.PI;

    if (curveSmoothing <= 0.02 || turnAngleDeg >= minTurnForCorner) {
      isCorner[i] = 1;
      tangents[i] = { x: 0, y: 0 };
    } else {
      isCorner[i] = 0;
      const w1 = Math.sqrt(l2);
      const w2 = Math.sqrt(l1);
      const tx = u1x * w1 + u2x * w2;
      const ty = u1y * w1 + u2y * w2;
      const tLen = Math.hypot(tx, ty) || 1;
      tangents[i] = { x: tx / tLen, y: ty / tLen };
    }
  }

  const anchors: AnchorPoint[] = pts.map((p, i) => ({
    x: p.x,
    y: p.y,
    isCorner: isCorner[i] === 1,
  }));

  const cmds: string[] = [`M${fmt(pts[0].x)} ${fmt(pts[0].y)}`];
  const smoothScale = Math.max(0, Math.min(1.3, curveSmoothing));
  const tension = smoothScale * 0.35;

  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const segDx = p1.x - p0.x;
    const segDy = p1.y - p0.y;
    const segLen = Math.hypot(segDx, segDy);

    if (tension <= 0.005 || segLen < 1.5) {
      cmds.push(`L${fmt(p1.x)} ${fmt(p1.y)}`);
    } else {
      const subPoints = chain.slice(p0.rawIndex, p1.rawIndex + 1);
      const chordUx = segDx / segLen;
      const chordUy = segDy / segLen;

      const tHat1: Point2D =
        isCorner[i] === 0 || i === 0
          ? tangents[i]
          : { x: chordUx, y: chordUy };
      const tHat2: Point2D =
        isCorner[i + 1] === 0 || i + 1 === n - 1
          ? { x: -tangents[i + 1].x, y: -tangents[i + 1].y }
          : { x: -chordUx, y: -chordUy };

      const defaultLen = segLen * tension;
      const [optLen1, optLen2] = solveSchneiderBezierHandles(
        subPoints,
        tHat1,
        tHat2,
        segLen,
        defaultLen,
        defaultLen
      );

      const h1 = optLen1 * smoothScale;
      const h2 = optLen2 * smoothScale;

      const cp1x = p0.x + tHat1.x * h1;
      const cp1y = p0.y + tHat1.y * h1;
      const cp2x = p1.x + tHat2.x * h2;
      const cp2y = p1.y + tHat2.y * h2;

      cmds.push(
        `C${fmt(cp1x)} ${fmt(cp1y)},${fmt(cp2x)} ${fmt(cp2y)},${fmt(p1.x)} ${fmt(p1.y)}`
      );
    }
  }

  return { subpath: cmds.join(' '), anchors };
}

export function buildVectorPathsFromLayers(
  layers: TracedLayerContours[],
  simplifyTolerance: number,
  cornerThreshold: number,
  curveSmoothing: number
): VectorPathData[] {
  const vectorPaths: VectorPathData[] = [];

  for (const layer of layers) {
    const subpaths: string[] = [];
    const layerAnchors: AnchorPoint[] = [];
    let nodeCount = 0;

    for (const rawContour of layer.contours) {
      const simplified = simplifyClosedContourRDP(
        rawContour,
        simplifyTolerance,
        curveSmoothing
      );
      if (simplified.length < 3) continue;

      const { subpath, anchors } = fitContourToBezierSubpath(
        simplified,
        rawContour,
        cornerThreshold,
        curveSmoothing
      );

      if (subpath) {
        subpaths.push(subpath);
        nodeCount += anchors.length;
        if (layerAnchors.length < 25000) {
          layerAnchors.push(...anchors);
        }
      }
    }

    if (subpaths.length > 0) {
      vectorPaths.push({
        colorId: layer.colorId,
        hex: layer.hex,
        d: subpaths.join(' '),
        nodeCount,
        contourCount: subpaths.length,
        area: layer.area,
        anchors: layerAnchors,
        isStroke: false,
      });
    }
  }

  return vectorPaths;
}
