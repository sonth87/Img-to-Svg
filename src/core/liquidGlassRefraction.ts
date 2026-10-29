/**
 * Liquid Glass Core Engine (Framework-Agnostic / Vanilla JS & TypeScript)
 * Nguồn tham chiếu: https://github.com/sonth87/liquid-glass
 *
 * Thuật toán quang học thấu kính lồi vát mép (Apple Optical Lens):
 * - Tạo bản đồ dịch chuyển (Displacement Map) bằng Canvas 2D với Gradient X (Đỏ) và Gradient Y (Lam).
 * - Sử dụng bộ lọc SVG feDisplacementMap 3-pass R-G-B và feBlend screen để tạo tán sắc lăng kính (Prism Fringe).
 * - Tự động nhận diện CSS border-radius (hỗ trợ cả %, px và hình tròn 50%).
 * - Tối ưu hóa hiệu năng: Bộ nhớ đệm LRU cho Displacement Map, Debounce ResizeObserver,
 *   tách rời cập nhật scale/chroma không sinh lại canvas.
 */

export interface LiquidGlassRefractionOptions {
  /** Tỉ lệ độ dày vùng vát mép thấu kính so với cạnh nhỏ nhất (0.01 - 0.20, mặc định 0.07) */
  border?: number;
  /** Độ cong mềm mại của mép thấu kính px (mặc định 12) */
  mapBlur?: number;
  /** Độ mờ backdrop bên trong kính px (mặc định 3) */
  blur?: number;
  /** Tăng cường độ rực rỡ màu sắc nền (mặc định 1.5) */
  saturate?: number;
  /** Bo góc ghi đè (px, số hoặc chuỗi như "24px", "50%"). Mặc định tự đọc từ getComputedStyle */
  radius?: number | string | null;
  /** Độ mờ fallback khi trình duyệt không hỗ trợ SVG backdrop-filter (Safari/Firefox) (mặc định 16) */
  fallbackBlur?: number;
  /** Cường độ phóng đại ban đầu (mặc định đọc từ globalScale) */
  scale?: number;
  /** Độ lệch pha màu tán sắc lăng kính ban đầu (mặc định đọc từ globalChroma) */
  chroma?: number;
  /** Thời gian chờ debounce (ms) khi co giãn phần tử (mặc định 120ms) */
  debounceMs?: number;
}

export interface LiquidGlassRefractionHandle {
  /** Trình duyệt có hỗ trợ SVG backdrop-filter khúc xạ hay không */
  supported: boolean;
  /** ID của bộ lọc SVG được sinh riêng cho phần tử này */
  filterId: string | null;
  /** Buộc vẽ lại bản đồ dịch chuyển (Displacement Map) */
  refresh: () => void;
  /** Hủy bỏ bộ lắng nghe, observer và xóa filter khỏi DOM tránh rò rỉ bộ nhớ */
  destroy: () => void;
}

export type AppleLensPreset =
  | 'panel'
  | 'bar'
  | 'card'
  | 'modal'
  | 'tooltip'
  | 'pill'
  | 'btn';

const PRESET_CONFIGS: Record<AppleLensPreset, LiquidGlassRefractionOptions> = {
  panel: {
    scale: -92,
    chroma: 5,
    border: 0.045,
    mapBlur: 12,
    blur: 8,
    saturate: 1.65,
    fallbackBlur: 18,
  },
  bar: {
    scale: -86,
    chroma: 5,
    border: 0.06,
    mapBlur: 10,
    blur: 7,
    saturate: 1.65,
    fallbackBlur: 16,
  },
  card: {
    scale: -82,
    chroma: 4.5,
    border: 0.075,
    mapBlur: 10,
    blur: 5,
    saturate: 1.55,
    fallbackBlur: 14,
  },
  modal: {
    scale: -112,
    chroma: 6,
    border: 0.065,
    mapBlur: 12,
    blur: 10,
    saturate: 1.75,
    fallbackBlur: 20,
  },
  tooltip: {
    scale: -108,
    chroma: 6,
    border: 0.08,
    mapBlur: 10,
    blur: 9,
    saturate: 1.75,
    fallbackBlur: 18,
  },
  pill: {
    scale: -76,
    chroma: 4.5,
    border: 0.1,
    mapBlur: 8,
    blur: 5,
    saturate: 1.6,
    fallbackBlur: 14,
  },
  btn: {
    scale: -64,
    chroma: 3.5,
    border: 0.12,
    mapBlur: 6,
    blur: 3.5,
    saturate: 1.5,
    fallbackBlur: 12,
  },
};

let uid = 0;
const DEFS_BY_ROOT = new WeakMap<Node, SVGDefsElement>();
const DISPLACEMENT_CACHE = new Map<string, string>();
const MAX_CACHE_ENTRIES = 120;

let globalScale = -112;
let globalChroma = 6;
const scaleChromaListeners = new Set<() => void>();

/**
 * Cập nhật thông số Scale/Chroma toàn cục và lập tức áp dụng cho mọi phần tử đang hoạt động
 * mà không cần vẽ lại Canvas Displacement Map (cập nhật trực tiếp thuộc tính SVG 60fps).
 */
export function setGlobalGlassParams({
  scale,
  chroma,
}: {
  scale?: number;
  chroma?: number;
} = {}): void {
  if (scale != null) globalScale = scale;
  if (chroma != null) globalChroma = chroma;
  scaleChromaListeners.forEach((fn) => fn());
}

/**
 * Kiểm tra trình duyệt có hỗ trợ SVG backdrop-filter khúc xạ hay không
 */
export function checkLiquidGlassSupport(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }
  const ua = navigator.userAgent;
  const isSafari =
    /Safari/.test(ua) && !/Chrome|Chromium|Edg|Arc|Brave/.test(ua);
  const isFirefox = /Firefox/.test(ua);
  if (isSafari || isFirefox) return false;
  if (!window.CSS || !CSS.supports('backdrop-filter', 'url(#test)')) {
    return false;
  }
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 4;
    c.getContext('2d')?.getImageData(0, 0, 1, 1);
    return true;
  } catch {
    return false;
  }
}

const isRefractionSupported =
  typeof window !== 'undefined' ? checkLiquidGlassSupport() : false;

/**
 * Đảm bảo mỗi Document hoặc ShadowRoot có 1 container <svg><defs> ẩn để chứa các filter
 */
function ensureDefs(root: Node): SVGDefsElement {
  const existing = DEFS_BY_ROOT.get(root);
  if (existing && existing.isConnected) return existing;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  svg.style.pointerEvents = 'none';

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  svg.appendChild(defs);

  const targetParent = (root as Document).body || root;
  targetParent.appendChild(svg);
  DEFS_BY_ROOT.set(root, defs);
  return defs;
}

/**
 * Tính toán chuẩn xác bán kính góc bo (px) từ số hoặc chuỗi CSS (hỗ trợ %, px và tự động lấy từ computedStyle)
 */
export function resolveRadius(
  el: HTMLElement,
  w: number,
  h: number,
  override?: number | string | null
): number {
  const minDim = Math.min(w, h);
  if (override != null) {
    if (typeof override === 'number') return override;
    const str = String(override).trim();
    const parsed = parseFloat(str) || 0;
    if (str.endsWith('%')) {
      return (parsed / 100) * minDim;
    }
    return parsed;
  }

  const computed = getComputedStyle(el);
  const raw = computed.borderTopLeftRadius || '0px';
  const v = parseFloat(raw) || 0;
  if (raw.trim().endsWith('%')) {
    return (v / 100) * minDim;
  }
  return Math.min(v, minDim * 0.5);
}

/**
 * Sinh bản đồ độ dốc khúc xạ (Displacement Map) dạng Data URL bằng Canvas 2D
 * Có bộ nhớ đệm LRU cho các phần tử cùng kích thước để tối ưu tốc độ render.
 */
export function generateDisplacementMap(
  w: number,
  h: number,
  radius: number,
  border: number,
  mapBlur: number
): string {
  if (w <= 0 || h <= 0) return '';
  const cw = Math.max(1, Math.round(w));
  const ch = Math.max(1, Math.round(h));
  const cr = Math.min(Math.round(radius), Math.floor(Math.min(cw, ch) * 0.5));
  const cacheKey = `${cw}x${ch}:${cr}:${border.toFixed(3)}:${mapBlur}`;

  const cached = DISPLACEMENT_CACHE.get(cacheKey);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // 1. Trục X: Gradient đỏ từ trái sang phải
  const gx = ctx.createLinearGradient(0, 0, cw, 0);
  gx.addColorStop(0, 'rgb(0,0,0)');
  gx.addColorStop(1, 'rgb(255,0,0)');
  ctx.fillStyle = gx;
  ctx.fillRect(0, 0, cw, ch);

  // 2. Trục Y: Gradient xanh lam từ trên xuống dưới (chế độ difference để giữ cả 2 trục độc lập)
  const gy = ctx.createLinearGradient(0, 0, 0, ch);
  gy.addColorStop(0, 'rgb(0,0,0)');
  gy.addColorStop(1, 'rgb(0,0,255)');
  ctx.globalCompositeOperation = 'difference';
  ctx.fillStyle = gy;
  ctx.fillRect(0, 0, cw, ch);

  // 3. Vùng trung tính xám 128 ở tâm, làm mờ rìa để tạo độ cong mép thấu kính
  ctx.globalCompositeOperation = 'source-over';
  const inset = border * Math.min(cw, ch);
  ctx.filter = `blur(${Math.max(1, mapBlur)}px)`;
  ctx.fillStyle = 'rgba(128, 128, 128, 0.93)';
  ctx.beginPath();
  const innerRadius = Math.max(cr - inset, 2);
  ctx.roundRect(
    inset,
    inset,
    Math.max(1, cw - inset * 2),
    Math.max(1, ch - inset * 2),
    innerRadius
  );
  ctx.fill();
  ctx.filter = 'none';

  const dataUrl = canvas.toDataURL();
  if (DISPLACEMENT_CACHE.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = DISPLACEMENT_CACHE.keys().next().value;
    if (oldestKey) DISPLACEMENT_CACHE.delete(oldestKey);
  }
  DISPLACEMENT_CACHE.set(cacheKey, dataUrl);
  return dataUrl;
}

/**
 * Dựng bộ lọc SVG Filter 3-pass tán sắc quang học R-G-B
 */
function buildFilter(
  root: Node,
  id: string,
  scales: [number, number, number]
): {
  filter: SVGFilterElement;
  feImage: SVGFEImageElement;
  disps: SVGFEDisplacementMapElement[];
} {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const filter = document.createElementNS(SVG_NS, 'filter');
  filter.setAttribute('id', id);
  filter.setAttribute('x', '0');
  filter.setAttribute('y', '0');
  filter.setAttribute('width', '100%');
  filter.setAttribute('height', '100%');
  filter.setAttribute('color-interpolation-filters', 'sRGB');

  const feImage = document.createElementNS(SVG_NS, 'feImage');
  feImage.setAttribute('x', '0');
  feImage.setAttribute('y', '0');
  feImage.setAttribute('result', 'map');
  feImage.setAttribute('preserveAspectRatio', 'none');
  filter.appendChild(feImage);

  const keep = [
    '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0',
    '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0',
    '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0',
  ];
  const channels: string[] = [];
  const disps: SVGFEDisplacementMapElement[] = [];

  for (let i = 0; i < 3; i++) {
    const disp = document.createElementNS(SVG_NS, 'feDisplacementMap');
    disp.setAttribute('in', 'SourceGraphic');
    disp.setAttribute('in2', 'map');
    disp.setAttribute('scale', String(scales[i]));
    disp.setAttribute('xChannelSelector', 'R');
    disp.setAttribute('yChannelSelector', 'B');
    disp.setAttribute('result', `d${i}`);
    filter.appendChild(disp);
    disps.push(disp);

    const cm = document.createElementNS(SVG_NS, 'feColorMatrix');
    cm.setAttribute('in', `d${i}`);
    cm.setAttribute('type', 'matrix');
    cm.setAttribute('values', keep[i]);
    cm.setAttribute('result', `c${i}`);
    filter.appendChild(cm);
    channels.push(`c${i}`);
  }

  const blend1 = document.createElementNS(SVG_NS, 'feBlend');
  blend1.setAttribute('in', channels[0]);
  blend1.setAttribute('in2', channels[1]);
  blend1.setAttribute('mode', 'screen');
  blend1.setAttribute('result', 'c01');
  filter.appendChild(blend1);

  const blend2 = document.createElementNS(SVG_NS, 'feBlend');
  blend2.setAttribute('in', 'c01');
  blend2.setAttribute('in2', channels[2]);
  blend2.setAttribute('mode', 'screen');
  filter.appendChild(blend2);

  ensureDefs(root).appendChild(filter);
  return { filter, feImage, disps };
}

/**
 * Gắn hiệu ứng Liquid Glass (Apple Optical Lens) vào một phần tử HTML bất kỳ
 */
export function attachLiquidGlassRefraction(
  el: HTMLElement,
  opts?: LiquidGlassRefractionOptions
): LiquidGlassRefractionHandle {
  const border = opts?.border ?? 0.07;
  const mapBlur = opts?.mapBlur ?? 12;
  const blur = opts?.blur ?? 3;
  const saturate = opts?.saturate ?? 1.5;
  const radiusOverride = opts?.radius ?? null;
  const fallbackBlur = opts?.fallbackBlur ?? 16;
  const customScale = opts?.scale ?? null;
  const customChroma = opts?.chroma ?? null;
  const debounceMs = opts?.debounceMs ?? 120;

  const styleWithWebkit = el.style as CSSStyleDeclaration & {
    webkitBackdropFilter?: string;
  };

  if (!isRefractionSupported) {
    const frosted = `blur(${fallbackBlur}px) saturate(${saturate})`;
    el.style.backdropFilter = frosted;
    styleWithWebkit.webkitBackdropFilter = frosted;
    el.classList.add('lg-fallback');
    return {
      supported: false,
      filterId: null,
      refresh: () => {},
      destroy: () => {
        el.style.backdropFilter = '';
        styleWithWebkit.webkitBackdropFilter = '';
        el.classList.remove('lg-fallback');
      },
    };
  }

  const root = el.getRootNode();
  const id = `optical-glass-filter-${++uid}`;

  const currentScale = customScale != null ? customScale : globalScale;
  const currentChroma = customChroma != null ? customChroma : globalChroma;
  const scales: [number, number, number] = [
    currentScale,
    currentScale + currentChroma,
    currentScale + currentChroma * 2,
  ];

  const parts = buildFilter(root, id, scales);

  function refresh(): void {
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w <= 0 || h <= 0) return;
    const r = resolveRadius(el, w, h, radiusOverride);
    const mapUrl = generateDisplacementMap(w, h, r, border, mapBlur);
    if (mapUrl) {
      parts.feImage.setAttribute('href', mapUrl);
      parts.feImage.setAttribute('width', String(w));
      parts.feImage.setAttribute('height', String(h));
    }
  }

  function applyScaleChroma(): void {
    const activeScale = customScale != null ? customScale : globalScale;
    const activeChroma = customChroma != null ? customChroma : globalChroma;
    const s = [
      activeScale,
      activeScale + activeChroma,
      activeScale + activeChroma * 2,
    ];
    parts.disps.forEach((disp, i) => disp.setAttribute('scale', String(s[i])));
  }

  if (customScale == null && customChroma == null) {
    scaleChromaListeners.add(applyScaleChroma);
  }

  refresh();
  const backdrop = `url(#${id}) blur(${blur}px) saturate(${saturate})`;
  el.style.backdropFilter = backdrop;
  styleWithWebkit.webkitBackdropFilter = backdrop;

  let timer: ReturnType<typeof setTimeout> | null = null;
  const ro = new ResizeObserver(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(refresh, debounceMs);
  });
  ro.observe(el);

  return {
    supported: true,
    filterId: id,
    refresh,
    destroy: () => {
      ro.disconnect();
      if (timer) clearTimeout(timer);
      scaleChromaListeners.delete(applyScaleChroma);
      parts.filter.remove();
      el.style.backdropFilter = '';
      styleWithWebkit.webkitBackdropFilter = '';
    },
  };
}

const LENS_SELECTOR =
  '[data-apple-lens], .apple-lens-panel, .apple-lens-bar, .apple-lens-card, .apple-lens-modal, .apple-lens-tooltip, .apple-lens-pill';

function resolvePresetFromElement(el: HTMLElement): AppleLensPreset {
  const attr = el.getAttribute('data-apple-lens') as AppleLensPreset | null;
  if (attr && attr in PRESET_CONFIGS) return attr;
  if (el.classList.contains('apple-lens-modal')) return 'modal';
  if (el.classList.contains('apple-lens-tooltip')) return 'tooltip';
  if (el.classList.contains('apple-lens-panel')) return 'panel';
  if (el.classList.contains('apple-lens-bar')) return 'bar';
  if (el.classList.contains('apple-lens-card')) return 'card';
  if (el.classList.contains('apple-lens-pill')) return 'pill';
  return 'btn';
}

/**
 * Tự động gắn hiệu ứng khúc xạ quang học Apple Optical Lens cho toàn bộ các phần tử
 * mang class `.apple-lens-*` hoặc thuộc tính `data-apple-lens` trong DOM.
 */
export function observeAppleLensElements(
  root: Document | HTMLElement = document
): () => void {
  const activeHandles = new Map<HTMLElement, LiquidGlassRefractionHandle>();

  const attachIfMatched = (el: HTMLElement) => {
    if (activeHandles.has(el)) return;
    if (el.classList.contains('optical-glass-container')) return;
    const preset = resolvePresetFromElement(el);
    const handle = attachLiquidGlassRefraction(el, PRESET_CONFIGS[preset]);
    activeHandles.set(el, handle);
  };

  const scanNode = (node: Node) => {
    if (!(node instanceof HTMLElement)) return;
    if (node.matches(LENS_SELECTOR)) {
      attachIfMatched(node);
    }
    node.querySelectorAll<HTMLElement>(LENS_SELECTOR).forEach(attachIfMatched);
  };

  const cleanupRemoved = (node: Node) => {
    if (!(node instanceof HTMLElement)) return;
    const h = activeHandles.get(node);
    if (h) {
      h.destroy();
      activeHandles.delete(node);
    }
    node.querySelectorAll<HTMLElement>(LENS_SELECTOR).forEach((child) => {
      const ch = activeHandles.get(child);
      if (ch) {
        ch.destroy();
        activeHandles.delete(child);
      }
    });
  };

  const targetRoot =
    root instanceof Document ? root.body : (root as HTMLElement);
  if (targetRoot) {
    scanNode(targetRoot);
  }

  const mo = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach(scanNode);
      m.removedNodes.forEach(cleanupRemoved);
    }
  });

  if (targetRoot) {
    mo.observe(targetRoot, { childList: true, subtree: true });
  }

  return () => {
    mo.disconnect();
    activeHandles.forEach((h) => h.destroy());
    activeHandles.clear();
  };
}
