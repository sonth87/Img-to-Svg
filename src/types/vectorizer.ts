export type VectorizeMode = 'color' | 'cartoon' | 'centerline' | 'monochrome';
export type LayerStackMode = 'stacked' | 'cutout';
export type ViewStage =
  | 'split'
  | 'original'
  | 'smoothed'
  | 'quantized'
  | 'svg'
  | 'wireframe';

export interface VectorizerParams {
  mode: VectorizeMode;
  /** Tự động phát hiện nét vẽ mảnh và chuyển thành 1 đường Line đơn (Centerline Stroke) thay vì vẽ đa giác 2 mép */
  singleLineStrokes: boolean;
  /** Bước 1: Độ làm phẳng giữ cạnh (Bilateral Filter iterations, 0 = tắt, 1..5) */
  smoothness: number;
  /** Bước 2: Số lượng màu tối đa khi phân cụm K-Means (2..256) */
  colorCount: number;
  /** Bước 2b: Ngưỡng gộp các màu gần nhau theo khoảng cách mắt người CIELAB Delta-E (0..45) */
  colorMergeDeltaE: number;
  /** Bước 2 (Monochrome / Centerline / Cartoon): Ngưỡng nhận diện nét vẽ tối (0..255) */
  monochromeThreshold: number;
  /** Độ dày nét vẽ (px) khi dùng chế độ Nét Đơn Centerline (0 = tự động đo từ ảnh, hoặc 1..12px) */
  strokeWidth: number;
  /** Đảo ngược màu đen trắng */
  invertMonochrome: boolean;
  /** Bước 3: Diện tích tối thiểu (số pixel) của 1 vùng màu. Nhỏ hơn sẽ bị hòa tan vào vùng lân cận */
  despeckleArea: number;
  /** Bước 4: Chế độ xếp lớp màu ('stacked' chống khe hở trắng, 'cutout' cắt rời từng lớp) */
  layerMode: LayerStackMode;
  /** Bước 5a: Độ rút gọn điểm Ramer-Douglas-Peucker (0.2..5.0 px) */
  simplifyTolerance: number;
  /** Bước 5b: Góc bẻ gập tối thiểu (độ, 35..160) để tạo đỉnh nhọn. Cao hơn = ưu tiên uốn cong mượt */
  cornerThreshold: number;
  /** Bước 5c: Độ uốn mượt đường cong Cubic Bézier (0 = đa giác thẳng, 1.0 = chuẩn Catmull-Rom/Schneider) */
  curveSmoothing: number;
  /** Tự động tách bỏ màu nền (Background Removal) mà không làm thay đổi cấu trúc vector bên trong vật thể */
  removeBackground?: boolean;
  /** Độ nhạy gom các sắc độ màu nền tương đồng từ viền ảnh (5..80, mặc định 24) */
  bgTolerance?: number;
}

export interface PaletteColor {
  id: number;
  r: number;
  g: number;
  b: number;
  a: number;
  hex: string;
  pixelCount: number;
  percentage: number;
  visible: boolean;
  customHex?: string;
  mergedInto?: number | null;
  isStrokeLayer?: boolean;
}

export interface AnchorPoint {
  x: number;
  y: number;
  isCorner: boolean;
}

export interface VectorPathData {
  colorId: number;
  hex: string;
  d: string;
  nodeCount: number;
  contourCount: number;
  area: number;
  anchors: AnchorPoint[];
  /** Nếu true, thẻ <path> sẽ vẽ dạng đường đơn (fill="none" stroke={hex} stroke-width={strokeWidth}) */
  isStroke?: boolean;
  strokeWidth?: number;
}

export interface PipelineStats {
  totalPaths: number;
  totalContours: number;
  totalNodes: number;
  svgBytes: number;
  executionMs: number;
  stepTimings: {
    smoothingMs: number;
    quantizeMs: number;
    despeckleMs: number;
    tracingMs: number;
    curveFittingMs: number;
  };
}

export interface PipelineResult {
  width: number;
  height: number;
  smoothedBuffer: Uint8ClampedArray;
  quantizedBuffer: Uint8ClampedArray;
  palette: PaletteColor[];
  paths: VectorPathData[];
  svgString: string;
  stats: PipelineStats;
}

export interface PaletteOverride {
  visible?: boolean;
  customHex?: string;
  mergedInto?: number | null;
}
