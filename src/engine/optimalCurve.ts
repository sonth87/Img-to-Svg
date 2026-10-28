/**
 * BƯỚC 5 (THUẬT TOÁN MỚI): KHỚP ĐƯỜNG CONG THEO ĐA GIÁC TỐI ƯU (POTRACE-STYLE)
 *
 * Khác với cách cũ (RDP chọn điểm neo -> mỗi đoạn RDP thành 1 Bézier), thuật toán này coi
 * bậc thang pixel là dung sai cho phép chứ không phải hình dạng cần bám theo:
 * 1. Đa giác tối ưu: Tìm đa giác ÍT CẠNH NHẤT sao cho mỗi cạnh đi qua ô vuông dung sai
 *    (±0.5px) quanh mọi điểm biên mà nó bao phủ -> bậc thang pixel tự biến mất.
 * 2. Tinh chỉnh đỉnh: Dời mỗi đỉnh tới giao điểm của 2 đường thẳng khớp bình phương tối thiểu
 *    của 2 cạnh kề (giới hạn trong ô vuông dung sai) -> đỉnh nằm đúng hình học thật.
 * 3. Phân loại góc bằng hệ số alpha (độ "nhô" của đỉnh so với dây cung nối 2 trung điểm cạnh):
 *    alpha > alphaMax -> góc nhọn thật; ngược lại -> 1 đoạn Bézier mượt qua 2 trung điểm.
 * 4. Gộp đường cong: Ghép các đoạn Bézier liên tiếp cùng chiều cong thành 1 đoạn duy nhất
 *    khi sai số <= optTolerance -> vòng tròn chỉ còn 4..8 điểm neo.
 *
 * Tham khảo: P. Selinger, "Potrace: a polygon-based tracing algorithm" (2003).
 */

import { AnchorPoint, VectorPathData } from '../types/vectorizer';
import { Point2D, TracedLayerContours } from './marchingSquares';

export interface OptimalCurveOptions {
  /** Nửa cạnh ô vuông dung sai quanh mỗi điểm (0.5 = đúng 1 bậc pixel) */
  straightTol: number;
  /** Ngưỡng alpha tạo góc nhọn (0 = toàn góc nhọn, >= 1.334 = không có góc nhọn nào) */
  alphaMax: number;
  /** Sai số tối đa (px) khi gộp nhiều đoạn Bézier liên tiếp thành 1 đoạn */
  optTolerance: number;
}

interface CurveNode {
  kind: 'L' | 'C';
  c1?: Point2D;
  c2?: Point2D;
  p: Point2D;
  corner: boolean;
}

interface Piece {
  corner: boolean;
  a: Point2D;
  b: Point2D;
  c: Point2D;
  c1: Point2D;
  c2: Point2D;
  turn: number;
}

const MAX_MERGE_TURN = (170 * Math.PI) / 180;
const MERGE_SAMPLES = 8;

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

function fmt(val: number): string {
  return (Math.round(val * 100) / 100).toString();
}

function mid(p: Point2D, q: Point2D): Point2D {
  return { x: (p.x + q.x) * 0.5, y: (p.y + q.y) * 0.5 };
}

function bezierAt(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  t: number
): Point2D {
  const s = 1 - t;
  const b0 = s * s * s;
  const b1 = 3 * t * s * s;
  const b2 = 3 * t * t * s;
  const b3 = t * t * t;
  return {
    x: b0 * p0.x + b1 * p1.x + b2 * p2.x + b3 * p3.x,
    y: b0 * p0.y + b1 * p1.y + b2 * p2.y + b3 * p3.y,
  };
}

/**
 * Với mỗi điểm i, liệt kê các khoảng cách d sao cho đoạn thẳng i -> i+d là "thẳng":
 * hướng của nó nằm trong nón hướng đi qua ô vuông dung sai của mọi điểm trung gian,
 * và đường đi chưa dùng đủ cả 4 hướng (chống gập ngược chữ U).
 */
function findStraightEnds(
  pts: Point2D[],
  closed: boolean,
  tol: number
): Int32Array[] {
  const n = pts.length;
  const result: Int32Array[] = new Array(n);
  const buf: number[] = [];
  const cornerOffX = [-tol, tol, tol, -tol];
  const cornerOffY = [-tol, -tol, tol, tol];

  for (let i = 0; i < n; i++) {
    buf.length = 0;
    const limit = closed ? n - 3 : n - 1 - i;
    const ox = pts[i].x;
    const oy = pts[i].y;
    let dirMask = 0;
    let hasCone = false;
    let loX = 0;
    let loY = 0;
    let hiX = 0;
    let hiY = 0;

    for (let d = 1; d <= limit; d++) {
      const k = (i + d) % n;
      const kp = (i + d - 1) % n;
      const sx = pts[k].x - pts[kp].x;
      const sy = pts[k].y - pts[kp].y;
      if (sx > 1e-9) dirMask |= 1;
      else if (sx < -1e-9) dirMask |= 2;
      if (sy > 1e-9) dirMask |= 4;
      else if (sy < -1e-9) dirMask |= 8;
      if (dirMask === 15) break;

      const qx = pts[k].x - ox;
      const qy = pts[k].y - oy;
      if (
        !hasCone ||
        (cross(loX, loY, qx, qy) >= -1e-9 &&
          cross(qx, qy, hiX, hiY) >= -1e-9 &&
          qx * (loX + hiX) + qy * (loY + hiY) > 0)
      ) {
        buf.push(d);
      }

      if (Math.abs(qx) <= tol && Math.abs(qy) <= tol) continue;

      // Khoảng hướng nhìn thấy ô vuông dung sai quanh điểm k (lấy 2 góc ngoài cùng)
      let cLoX = 0;
      let cLoY = 0;
      let cHiX = 0;
      let cHiY = 0;
      for (let c = 0; c < 4; c++) {
        const cx = qx + cornerOffX[c];
        const cy = qy + cornerOffY[c];
        let isLo = true;
        let isHi = true;
        for (let o = 0; o < 4; o++) {
          if (o === c) continue;
          const ex = qx + cornerOffX[o];
          const ey = qy + cornerOffY[o];
          const cr = cross(cx, cy, ex, ey);
          if (cr < -1e-12) isLo = false;
          if (cr > 1e-12) isHi = false;
        }
        if (isLo) {
          cLoX = cx;
          cLoY = cy;
        }
        if (isHi) {
          cHiX = cx;
          cHiY = cy;
        }
      }

      if (!hasCone) {
        loX = cLoX;
        loY = cLoY;
        hiX = cHiX;
        hiY = cHiY;
        hasCone = true;
      } else {
        if (cross(loX, loY, cLoX, cLoY) > 0) {
          loX = cLoX;
          loY = cLoY;
        }
        if (cross(cHiX, cHiY, hiX, hiY) > 0) {
          hiX = cHiX;
          hiY = cHiY;
        }
        if (cross(loX, loY, hiX, hiY) < 0) break;
      }
    }

    result[i] = Int32Array.from(buf);
  }

  return result;
}

/**
 * Tổng tích lũy (x, y, x², xy, y²) trên chuỗi điểm mở rộng 2 vòng để tính nhanh O(1)
 * sai số bình phương và đường thẳng khớp của bất kỳ đoạn i..j nào.
 */
class PathSums {
  sx: Float64Array;
  sy: Float64Array;
  sxx: Float64Array;
  sxy: Float64Array;
  syy: Float64Array;
  ext: Point2D[];

  constructor(pts: Point2D[], closed: boolean) {
    const n = pts.length;
    const len = closed ? 2 * n + 1 : n;
    const ox = pts[0].x;
    const oy = pts[0].y;
    this.ext = new Array(len);
    this.sx = new Float64Array(len + 1);
    this.sy = new Float64Array(len + 1);
    this.sxx = new Float64Array(len + 1);
    this.sxy = new Float64Array(len + 1);
    this.syy = new Float64Array(len + 1);
    for (let k = 0; k < len; k++) {
      const p = pts[k % n];
      const x = p.x - ox;
      const y = p.y - oy;
      this.ext[k] = { x, y };
      this.sx[k + 1] = this.sx[k] + x;
      this.sy[k + 1] = this.sy[k] + y;
      this.sxx[k + 1] = this.sxx[k] + x * x;
      this.sxy[k + 1] = this.sxy[k] + x * y;
      this.syy[k + 1] = this.syy[k] + y * y;
    }
  }

  /** Tổng bình phương khoảng cách từ các điểm i..j tới đường thẳng nối điểm i và j */
  penalty(i: number, j: number): number {
    const a = this.ext[i];
    const b = this.ext[j];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-12) return 0;
    const cnt = j - i + 1;
    const sx = this.sx[j + 1] - this.sx[i];
    const sy = this.sy[j + 1] - this.sy[i];
    const sxx = this.sxx[j + 1] - this.sxx[i];
    const sxy = this.sxy[j + 1] - this.sxy[i];
    const syy = this.syy[j + 1] - this.syy[i];
    const c = a.x * dy - a.y * dx;
    const sum =
      dy * dy * sxx +
      dx * dx * syy -
      2 * dx * dy * sxy -
      2 * c * dy * sx +
      2 * c * dx * sy +
      c * c * cnt;
    return Math.max(0, sum / lenSq);
  }

  /** Đường thẳng khớp bình phương tối thiểu qua các điểm i..j: n·p = e (n là pháp tuyến đơn vị) */
  fitLine(i: number, j: number): { nx: number; ny: number; e: number } {
    const cnt = j - i + 1;
    const cx = (this.sx[j + 1] - this.sx[i]) / cnt;
    const cy = (this.sy[j + 1] - this.sy[i]) / cnt;
    const a = (this.sxx[j + 1] - this.sxx[i]) / cnt - cx * cx;
    const b = (this.sxy[j + 1] - this.sxy[i]) / cnt - cx * cy;
    const d = (this.syy[j + 1] - this.syy[i]) / cnt - cy * cy;
    const lambda = (a + d) / 2 + Math.sqrt(((a - d) / 2) ** 2 + b * b);
    let dirX: number;
    let dirY: number;
    if (Math.abs(b) > 1e-12) {
      dirX = lambda - d;
      dirY = b;
    } else if (a >= d) {
      dirX = 1;
      dirY = 0;
    } else {
      dirX = 0;
      dirY = 1;
    }
    const len = Math.hypot(dirX, dirY) || 1;
    const nx = -dirY / len;
    const ny = dirX / len;
    return { nx, ny, e: nx * cx + ny * cy };
  }
}

/**
 * Quy hoạch động: số cạnh ít nhất từ điểm `start` đi hết `span` bước, hòa nhau thì chọn sai số nhỏ hơn.
 * Trả về danh sách chỉ số đỉnh tuyệt đối (trên chuỗi mở rộng) cùng tổng số cạnh & sai số.
 */
function solvePolygonFrom(
  ends: Int32Array[],
  sums: PathSums,
  n: number,
  start: number,
  span: number
): { vertices: number[]; segs: number; cost: number } {
  const segs = new Int32Array(span + 1).fill(0x7fffffff);
  const cost = new Float64Array(span + 1).fill(Infinity);
  const prev = new Int32Array(span + 1).fill(-1);
  segs[0] = 0;
  cost[0] = 0;

  for (let t = 0; t < span; t++) {
    if (segs[t] === 0x7fffffff) continue;
    const list = ends[(start + t) % n];
    for (let q = 0; q < list.length; q++) {
      const u = t + list[q];
      if (u > span) break;
      const s = segs[t] + 1;
      const c = cost[t] + sums.penalty(start + t, start + u);
      if (s < segs[u] || (s === segs[u] && c < cost[u])) {
        segs[u] = s;
        cost[u] = c;
        prev[u] = t;
      }
    }
  }

  const vertices: number[] = [];
  let t = span;
  while (t > 0 && prev[t] >= 0) {
    t = prev[t];
    vertices.push(start + t);
  }
  vertices.reverse();
  return { vertices, segs: segs[span], cost: cost[span] };
}

/** Điểm cực tiểu của tổng bình phương khoảng cách tới các đường thẳng, giới hạn trong ô vuông quanh (x0, y0) */
function minimizeInSquare(
  lines: { nx: number; ny: number; e: number }[],
  x0: number,
  y0: number,
  tol: number
): Point2D {
  let axx = 0;
  let axy = 0;
  let ayy = 0;
  let rx = 0;
  let ry = 0;
  for (const l of lines) {
    axx += l.nx * l.nx;
    axy += l.nx * l.ny;
    ayy += l.ny * l.ny;
    rx += l.e * l.nx;
    ry += l.e * l.ny;
  }
  const q = (x: number, y: number) => {
    let s = 0;
    for (const l of lines) {
      const v = l.nx * x + l.ny * y - l.e;
      s += v * v;
    }
    return s;
  };

  const det = axx * ayy - axy * axy;
  if (det > 1e-6) {
    const x = (rx * ayy - ry * axy) / det;
    const y = (axx * ry - axy * rx) / det;
    if (Math.abs(x - x0) <= tol && Math.abs(y - y0) <= tol) {
      return { x, y };
    }
  }

  // Cực tiểu nằm ngoài ô vuông (hoặc 2 đường gần song song): xét từng cạnh của ô vuông
  let best = { x: x0, y: y0 };
  let bestQ = q(x0, y0);
  for (const sx of [-tol, tol]) {
    const x = x0 + sx;
    let y = ayy > 1e-12 ? (ry - axy * x) / ayy : y0;
    y = Math.max(y0 - tol, Math.min(y0 + tol, y));
    const v = q(x, y);
    if (v < bestQ) {
      bestQ = v;
      best = { x, y };
    }
  }
  for (const sy of [-tol, tol]) {
    const y = y0 + sy;
    let x = axx > 1e-12 ? (rx - axy * y) / axx : x0;
    x = Math.max(x0 - tol, Math.min(x0 + tol, x));
    const v = q(x, y);
    if (v < bestQ) {
      bestQ = v;
      best = { x, y };
    }
  }
  return best;
}

function buildPiece(
  prev: Point2D,
  b: Point2D,
  next: Point2D,
  opts: OptimalCurveOptions
): Piece {
  const a = mid(prev, b);
  const c = mid(b, next);
  const dx = c.x - a.x;
  const dy = c.y - a.y;
  const denom = Math.abs(dx) + Math.abs(dy);

  // alpha đo độ nhô của đỉnh b khỏi dây cung a-c, chuẩn hóa theo ô vuông dung sai
  let alpha: number;
  if (denom < 1e-9) {
    alpha = 4 / 3;
  } else {
    const dd =
      (Math.abs(cross(b.x - a.x, b.y - a.y, dx, dy)) / denom) *
      (0.5 / opts.straightTol);
    alpha = dd > 1 ? (1 - 1 / dd) / 0.75 : 0;
  }

  const turn = Math.atan2(
    cross(b.x - a.x, b.y - a.y, c.x - b.x, c.y - b.y),
    (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)
  );

  if (alpha > opts.alphaMax) {
    return { corner: true, a, b, c, c1: b, c2: b, turn };
  }

  const al = Math.max(0.55, Math.min(1, alpha));
  return {
    corner: false,
    a,
    b,
    c,
    c1: { x: a.x + al * (b.x - a.x), y: a.y + al * (b.y - a.y) },
    c2: { x: c.x + al * (b.x - c.x), y: c.y + al * (b.y - c.y) },
    turn,
  };
}

/**
 * Khớp 1 đoạn Cubic Bézier duy nhất thay cho các đoạn cong s..e (giữ nguyên 2 tiếp tuyến đầu mút).
 * Tay đòn tính bằng bình phương tối thiểu (Schneider) + 2 lượt Newton tham số hóa lại.
 */
function fitMergedRun(
  pieces: Piece[],
  s: number,
  e: number,
  tol: number
): { c1: Point2D; c2: Point2D } | null {
  const p0 = pieces[s].a;
  const p3 = pieces[e].c;
  const samples: Point2D[] = [p0];
  for (let k = s; k <= e; k++) {
    const pc = pieces[k];
    for (let t = 1; t <= MERGE_SAMPLES; t++) {
      samples.push(bezierAt(pc.a, pc.c1, pc.c2, pc.c, t / MERGE_SAMPLES));
    }
  }

  let t1x = pieces[s].c1.x - p0.x;
  let t1y = pieces[s].c1.y - p0.y;
  let t2x = pieces[e].c2.x - p3.x;
  let t2y = pieces[e].c2.y - p3.y;
  const l1 = Math.hypot(t1x, t1y);
  const l2 = Math.hypot(t2x, t2y);
  if (l1 < 1e-9 || l2 < 1e-9) return null;
  t1x /= l1;
  t1y /= l1;
  t2x /= l2;
  t2y /= l2;

  const m = samples.length - 1;
  const u = new Float64Array(m + 1);
  for (let i = 1; i <= m; i++) {
    u[i] =
      u[i - 1] +
      Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y);
  }
  const total = u[m];
  if (total < 1e-9) return null;
  for (let i = 1; i <= m; i++) u[i] /= total;

  let c1: Point2D = p0;
  let c2: Point2D = p3;

  for (let iter = 0; iter < 3; iter++) {
    let c11 = 0;
    let c12 = 0;
    let c22 = 0;
    let x1 = 0;
    let x2 = 0;
    for (let i = 1; i < m; i++) {
      const ui = u[i];
      const si = 1 - ui;
      const b0 = si * si * si;
      const b1 = 3 * ui * si * si;
      const b2 = 3 * ui * ui * si;
      const b3 = ui * ui * ui;
      const a1x = t1x * b1;
      const a1y = t1y * b1;
      const a2x = t2x * b2;
      const a2y = t2y * b2;
      c11 += a1x * a1x + a1y * a1y;
      c12 += a1x * a2x + a1y * a2y;
      c22 += a2x * a2x + a2y * a2y;
      const rx = samples[i].x - ((b0 + b1) * p0.x + (b2 + b3) * p3.x);
      const ry = samples[i].y - ((b0 + b1) * p0.y + (b2 + b3) * p3.y);
      x1 += rx * a1x + ry * a1y;
      x2 += rx * a2x + ry * a2y;
    }
    const det = c11 * c22 - c12 * c12;
    if (Math.abs(det) < 1e-12) return null;
    const alpha1 = (x1 * c22 - x2 * c12) / det;
    const alpha2 = (c11 * x2 - c12 * x1) / det;
    if (alpha1 <= 1e-3 || alpha2 <= 1e-3) return null;

    c1 = { x: p0.x + t1x * alpha1, y: p0.y + t1y * alpha1 };
    c2 = { x: p3.x + t2x * alpha2, y: p3.y + t2y * alpha2 };

    if (iter === 2) break;
    // Newton-Raphson: dời tham số u[i] về điểm gần nhất trên đường cong vừa khớp
    for (let i = 1; i < m; i++) {
      const t = u[i];
      const st = 1 - t;
      const pt = bezierAt(p0, c1, c2, p3, t);
      const d1x =
        3 * st * st * (c1.x - p0.x) +
        6 * st * t * (c2.x - c1.x) +
        3 * t * t * (p3.x - c2.x);
      const d1y =
        3 * st * st * (c1.y - p0.y) +
        6 * st * t * (c2.y - c1.y) +
        3 * t * t * (p3.y - c2.y);
      const d2x = 6 * st * (c2.x - 2 * c1.x + p0.x) + 6 * t * (p3.x - 2 * c2.x + c1.x);
      const d2y = 6 * st * (c2.y - 2 * c1.y + p0.y) + 6 * t * (p3.y - 2 * c2.y + c1.y);
      const fx = pt.x - samples[i].x;
      const fy = pt.y - samples[i].y;
      const num = fx * d1x + fy * d1y;
      const den = d1x * d1x + d1y * d1y + fx * d2x + fy * d2y;
      if (Math.abs(den) > 1e-12) {
        u[i] = Math.max(0, Math.min(1, t - num / den));
      }
    }
  }

  const tolSq = tol * tol;
  for (let i = 1; i < m; i++) {
    const pt = bezierAt(p0, c1, c2, p3, u[i]);
    const dx = pt.x - samples[i].x;
    const dy = pt.y - samples[i].y;
    if (dx * dx + dy * dy > tolSq) return null;
  }
  return { c1, c2 };
}

/** Gộp tham lam các đoạn cong liên tiếp cùng chiều uốn, rồi chuyển thành danh sách lệnh vẽ */
function piecesToNodes(pieces: Piece[], tol: number): CurveNode[] {
  const nodes: CurveNode[] = [];
  let k = 0;
  while (k < pieces.length) {
    const pc = pieces[k];
    if (pc.corner) {
      nodes.push({ kind: 'L', p: pc.b, corner: true });
      nodes.push({ kind: 'L', p: pc.c, corner: false });
      k++;
      continue;
    }

    let e = k;
    let best = { c1: pc.c1, c2: pc.c2 };
    let turnSum = Math.abs(pc.turn);
    let sign = Math.abs(pc.turn) > 1e-3 ? Math.sign(pc.turn) : 0;
    while (e + 1 < pieces.length && !pieces[e + 1].corner) {
      const t = pieces[e + 1].turn;
      const ts = Math.abs(t) > 1e-3 ? Math.sign(t) : 0;
      if (sign !== 0 && ts !== 0 && ts !== sign) break;
      if (turnSum + Math.abs(t) > MAX_MERGE_TURN) break;
      const fit = fitMergedRun(pieces, k, e + 1, tol);
      if (!fit) break;
      best = fit;
      turnSum += Math.abs(t);
      if (sign === 0) sign = ts;
      e++;
    }
    nodes.push({ kind: 'C', c1: best.c1, c2: best.c2, p: pieces[e].c, corner: false });
    k = e + 1;
  }
  return nodes;
}

/** Bỏ các điểm L nằm thẳng hàng giữa 2 lệnh L (trung điểm giữa 2 góc nhọn liên tiếp) */
function isRedundantLine(prev: Point2D, node: CurveNode, next: CurveNode): boolean {
  if (node.kind !== 'L' || next.kind !== 'L' || node.corner) return false;
  const v1x = node.p.x - prev.x;
  const v1y = node.p.y - prev.y;
  const v2x = next.p.x - node.p.x;
  const v2y = next.p.y - node.p.y;
  const l = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  return (
    Math.abs(cross(v1x, v1y, v2x, v2y)) <= 1e-6 * l + 1e-9 &&
    v1x * v2x + v1y * v2y > 0
  );
}

function dedupePoints(points: Point2D[], closed: boolean): Point2D[] {
  const out: Point2D[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > 1e-9 || Math.abs(last.y - p.y) > 1e-9) {
      out.push(p);
    }
  }
  if (closed && out.length > 1) {
    const f = out[0];
    const l = out[out.length - 1];
    if (Math.abs(f.x - l.x) <= 1e-9 && Math.abs(f.y - l.y) <= 1e-9) out.pop();
  }
  return out;
}

/**
 * Khớp đường cong cho 1 chuỗi điểm (đường bao khép kín hoặc nét đơn mở).
 * Với đường bao vùng màu, `points` là các đỉnh lưới pixel nguyên (mỗi bước dài đúng 1px).
 */
export function fitOptimalCurve(
  points: Point2D[],
  closed: boolean,
  opts: OptimalCurveOptions
): { subpath: string; anchors: AnchorPoint[] } {
  const pts = dedupePoints(points, closed);
  const n = pts.length;

  if (!closed && n < 3) {
    if (n < 2) return { subpath: '', anchors: [] };
    return {
      subpath: `M${fmt(pts[0].x)} ${fmt(pts[0].y)} L${fmt(pts[1].x)} ${fmt(pts[1].y)}`,
      anchors: [
        { x: pts[0].x, y: pts[0].y, isCorner: true },
        { x: pts[1].x, y: pts[1].y, isCorner: true },
      ],
    };
  }
  if (closed && n < 4) return { subpath: '', anchors: [] };

  const tol = opts.straightTol;
  const ends = findStraightEnds(pts, closed, tol);
  const sums = new PathSums(pts, closed);
  const ox = pts[0].x;
  const oy = pts[0].y;

  // 1. Đa giác tối ưu
  let vertices: number[];
  if (closed) {
    // Chu trình khép kín: chạy quy hoạch động 2 lần, lần 2 khởi đầu từ 1 đỉnh của nghiệm lần 1
    let sol = solvePolygonFrom(ends, sums, n, 0, n);
    if (sol.vertices.length >= 2) {
      const start = sol.vertices[Math.floor(sol.vertices.length / 2)] % n;
      const sol2 = solvePolygonFrom(ends, sums, n, start, n);
      if (sol2.segs < sol.segs || (sol2.segs === sol.segs && sol2.cost < sol.cost)) {
        sol = sol2;
      }
    }
    vertices = sol.vertices;
  } else {
    vertices = solvePolygonFrom(ends, sums, n, 0, n - 1).vertices;
    vertices.push(n - 1);
  }

  let m = vertices.length;
  if (closed && m < 3) return { subpath: '', anchors: [] };

  // 2. Tinh chỉnh đỉnh về giao điểm 2 đường thẳng khớp của 2 cạnh kề
  const segCount = closed ? m : m - 1;
  const lines: { nx: number; ny: number; e: number }[] = new Array(segCount);
  for (let k = 0; k < segCount; k++) {
    const i = vertices[k];
    const j = k + 1 < m ? vertices[k + 1] : vertices[0] + n;
    lines[k] = sums.fitLine(i, j);
  }

  const adjusted: Point2D[] = new Array(m);
  for (let k = 0; k < m; k++) {
    const v = sums.ext[vertices[k]];
    let used: { nx: number; ny: number; e: number }[];
    if (closed) {
      used = [lines[(k - 1 + m) % m], lines[k]];
    } else if (k === 0) {
      used = [lines[0]];
    } else if (k === m - 1) {
      used = [lines[m - 2]];
    } else {
      used = [lines[k - 1], lines[k]];
    }
    const p = minimizeInSquare(used, v.x, v.y, tol);
    adjusted[k] = { x: p.x + ox, y: p.y + oy };
  }

  // Gộp các đỉnh bị dồn sát nhau sau tinh chỉnh (cạnh gần như bằng 0 làm nhiễu tiếp tuyến khi gộp đường cong)
  const minEdge = tol * 0.5;
  for (let k = closed ? 0 : 1; k < adjusted.length - 1 && adjusted.length > 3; ) {
    const p = adjusted[k];
    const q = adjusted[k + 1];
    if (Math.hypot(q.x - p.x, q.y - p.y) < minEdge) {
      if (!closed && k + 1 === adjusted.length - 1) {
        adjusted.splice(k, 1);
      } else {
        adjusted.splice(k, 2, mid(p, q));
      }
    } else {
      k++;
    }
  }
  m = adjusted.length;

  // 3. Phân loại góc nhọn / đoạn cong mượt tại từng đỉnh
  const pieces: Piece[] = [];
  if (closed) {
    for (let k = 0; k < m; k++) {
      pieces.push(
        buildPiece(adjusted[(k - 1 + m) % m], adjusted[k], adjusted[(k + 1) % m], opts)
      );
    }
    // Xoay để chu trình bắt đầu tại 1 góc nhọn -> không cắt ngang 1 cung cong khi gộp
    const firstCorner = pieces.findIndex((p) => p.corner);
    if (firstCorner > 0) {
      pieces.push(...pieces.splice(0, firstCorner));
    }
  } else {
    for (let k = 1; k < m - 1; k++) {
      pieces.push(buildPiece(adjusted[k - 1], adjusted[k], adjusted[k + 1], opts));
    }
  }

  // 4. Gộp đường cong & sinh lệnh vẽ
  let nodes: CurveNode[];
  let start: Point2D;
  if (closed) {
    nodes = piecesToNodes(pieces, opts.optTolerance);
    start = nodes[nodes.length - 1].p;
    for (let k = 0; k < nodes.length && nodes.length > 3; ) {
      const prevP = k === 0 ? nodes[nodes.length - 1].p : nodes[k - 1].p;
      if (isRedundantLine(prevP, nodes[k], nodes[(k + 1) % nodes.length])) {
        nodes.splice(k, 1);
      } else {
        k++;
      }
    }
    start = nodes[nodes.length - 1].p;
  } else {
    start = adjusted[0];
    nodes = [];
    if (pieces.length > 0) nodes.push({ kind: 'L', p: pieces[0].a, corner: false });
    nodes.push(...piecesToNodes(pieces, opts.optTolerance));
    nodes.push({ kind: 'L', p: adjusted[m - 1], corner: true });
    for (let k = 0; k < nodes.length - 1; ) {
      const prevP = k === 0 ? start : nodes[k - 1].p;
      if (isRedundantLine(prevP, nodes[k], nodes[k + 1])) {
        nodes.splice(k, 1);
      } else {
        k++;
      }
    }
  }

  const cmds: string[] = [`M${fmt(start.x)} ${fmt(start.y)}`];
  const anchors: AnchorPoint[] = closed ? [] : [{ x: start.x, y: start.y, isCorner: true }];
  for (let k = 0; k < nodes.length; k++) {
    const nd = nodes[k];
    anchors.push({ x: nd.p.x, y: nd.p.y, isCorner: nd.corner });
    if (closed && k === nodes.length - 1 && nd.kind === 'L') break;
    if (nd.kind === 'L') {
      cmds.push(`L${fmt(nd.p.x)} ${fmt(nd.p.y)}`);
    } else {
      cmds.push(
        `C${fmt(nd.c1!.x)} ${fmt(nd.c1!.y)},${fmt(nd.c2!.x)} ${fmt(nd.c2!.y)},${fmt(nd.p.x)} ${fmt(nd.p.y)}`
      );
    }
  }
  if (closed) cmds.push('Z');

  return { subpath: cmds.join(' '), anchors };
}

/**
 * Ánh xạ thanh trượt hiện có sang tham số thuật toán mới:
 * - Ngưỡng góc nhọn 80° ~ alphaMax 1.0 (mặc định Potrace), kéo cao hơn -> ít góc nhọn hơn.
 * - Rút gọn điểm (px) -> sai số cho phép khi gộp đường cong.
 */
export function optimalCurveOptionsFromParams(
  simplifyTolerance: number,
  cornerThreshold: number,
  forCenterline = false
): OptimalCurveOptions {
  return {
    // Dung sai thẳng tối thiểu 0.5px (1 bậc pixel); ảnh phóng to / nhiễu JPEG cần kéo thanh "Rút gọn" cao hơn
    straightTol: forCenterline
      ? Math.max(0.75, Math.min(2, simplifyTolerance))
      : Math.max(0.5, Math.min(2, simplifyTolerance)),
    alphaMax: Math.max(0.3, Math.min(1.34, cornerThreshold / 80)),
    optTolerance: Math.max(0.1, simplifyTolerance * (forCenterline ? 0.4 : 0.25)),
  };
}

/** Đa giác đúng biên pixel (chỉ gộp các điểm thẳng hàng) cho vùng quá mỏng để làm mượt an toàn */
function exactPixelPolygon(points: Point2D[]): { subpath: string; anchors: AnchorPoint[] } {
  const n = points.length;
  const kept: Point2D[] = [];
  for (let k = 0; k < n; k++) {
    const prev = points[(k - 1 + n) % n];
    const cur = points[k];
    const next = points[(k + 1) % n];
    if (cross(cur.x - prev.x, cur.y - prev.y, next.x - cur.x, next.y - cur.y) !== 0) kept.push(cur);
  }
  if (kept.length < 3) return { subpath: '', anchors: [] };
  let d = `M${fmt(kept[0].x)} ${fmt(kept[0].y)}`;
  for (let k = 1; k < kept.length; k++) d += `L${fmt(kept[k].x)} ${fmt(kept[k].y)}`;
  return {
    subpath: d + 'Z',
    anchors: kept.map((p) => ({ x: p.x, y: p.y, isCorner: true })),
  };
}

export function buildOptimalCurvePathsFromLayers(
  layers: TracedLayerContours[],
  simplifyTolerance: number,
  cornerThreshold: number
): VectorPathData[] {
  const opts = optimalCurveOptionsFromParams(simplifyTolerance, cornerThreshold);
  // Vùng tí hon (<= 3px) mà làm mượt thì thành chấm tròn rời rạc, hở nền giữa các chấm
  // -> giữ đa giác góc cạnh để các mảnh khít vào nhau như mosaic.
  const tinyOpts: OptimalCurveOptions = { ...opts, alphaMax: -1 };
  // Ảnh nhiều màu (ảnh chụp, render 3D): hàng trăm nghìn vùng mỏng 1-3px đan xen. Làm mượt độc lập từng vùng
  // lệch ±0.5px = phình 30-50% bề rộng vùng, vùng vẽ sau (điểm sáng, rãnh tối) đè mất chi tiết xung quanh.
  // -> vùng mỏng (bề dày trung bình 2·S/P < 3px) giữ đúng biên pixel, chỉ vùng đủ dày mới làm mượt.
  const exactThinRegions = layers.length > 16 || simplifyTolerance <= 0.55;
  // Rất nhiều màu (> 64): mọi vùng đều là mảnh vá cỡ pixel của một ảnh chuyển màu liên tục; bất kỳ độ lệch biên nào
  // (kể cả làm mượt vùng dày) cũng cộng dồn thành mất chi tiết -> giữ đúng biên pixel cho tất cả.
  const exactAllRegions = layers.length > 64;
  const vectorPaths: VectorPathData[] = [];

  for (const layer of layers) {
    const subpaths: string[] = [];
    const layerAnchors: AnchorPoint[] = [];
    let nodeCount = 0;

    for (const rawContour of layer.contours) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of rawContour) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      const isTiny = Math.max(maxX - minX, maxY - minY) <= 3;
      let isThin = false;
      if (exactThinRegions) {
        let area2 = 0;
        let perimeter = 0;
        for (let k = 0, j = rawContour.length - 1; k < rawContour.length; j = k++) {
          area2 += rawContour[j].x * rawContour[k].y - rawContour[k].x * rawContour[j].y;
          perimeter += Math.abs(rawContour[k].x - rawContour[j].x) + Math.abs(rawContour[k].y - rawContour[j].y);
        }
        isThin = Math.abs(area2) / Math.max(1, perimeter) < 1.5;
      }
      const { subpath, anchors } =
        exactAllRegions
          ? exactPixelPolygon(rawContour)
          : isTiny || isThin
          ? exactThinRegions
            ? exactPixelPolygon(rawContour)
            : fitOptimalCurve(rawContour, true, tinyOpts)
          : fitOptimalCurve(rawContour, true, opts);
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
