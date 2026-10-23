import { VectorizerParams } from '../types/vectorizer';

export interface SamplePreset {
  id: string;
  name: string;
  subtitle: string;
  recommendedParams: VectorizerParams;
  renderToCanvas: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
}

export interface PurposePreset {
  id: string;
  label: string;
  badge: string;
  description: string;
  icon:
    | 'shapes'
    | 'sparkles'
    | 'camera'
    | 'mountain'
    | 'palette'
    | 'flame'
    | 'hexagon'
    | 'pen-tool'
    | 'type'
    | 'scissors'
    | 'grid'
    | 'crown';
  params: VectorizerParams;
}

export const DEFAULT_PARAMS: VectorizerParams = {
  mode: 'color',
  singleLineStrokes: true,
  smoothness: 2,
  colorCount: 8,
  colorMergeDeltaE: 14,
  monochromeThreshold: 140,
  strokeWidth: 0,
  invertMonochrome: false,
  despeckleArea: 24,
  layerMode: 'stacked',
  simplifyTolerance: 1.0,
  cornerThreshold: 85,
  curveSmoothing: 0.95,
};

export const PURPOSE_PRESETS: PurposePreset[] = [
  {
    id: 'logo-icon',
    label: 'Logo & Icon',
    badge: '8 màu',
    description:
      'Tối ưu cho Logo, Icon UI/UX phẳng: Mảng màu sạch, giữ góc vuông sắc nét và cung tròn chuẩn xác.',
    icon: 'shapes',
    params: {
      mode: 'color',
      singleLineStrokes: false,
      smoothness: 2,
      colorCount: 8,
      colorMergeDeltaE: 16,
      monochromeThreshold: 140,
      strokeWidth: 0,
      invertMonochrome: false,
      despeckleArea: 28,
      layerMode: 'stacked',
      simplifyTolerance: 0.9,
      cornerThreshold: 82,
      curveSmoothing: 1.0,
    },
  },
  {
    id: 'cartoon-sticker',
    label: 'Cartoon & Sticker',
    badge: 'Màu + Nét',
    description:
      'Dành cho nhân vật hoạt hình, Chibi, Sticker: Tô mảng màu phẳng kết hợp rút lõi nét viền đen thành 1 đường cong đơn.',
    icon: 'sparkles',
    params: {
      mode: 'cartoon',
      singleLineStrokes: true,
      smoothness: 2,
      colorCount: 12,
      colorMergeDeltaE: 14,
      monochromeThreshold: 138,
      strokeWidth: 0,
      invertMonochrome: false,
      despeckleArea: 22,
      layerMode: 'stacked',
      simplifyTolerance: 0.9,
      cornerThreshold: 80,
      curveSmoothing: 0.95,
    },
  },
  {
    id: 'photo-realistic',
    label: 'Ảnh Thật (Photo)',
    badge: '160 màu',
    description:
      'Tối ưu cho ảnh chụp chân dung, sản phẩm, chi tiết phức tạp: Chia 160 sắc độ màu sắc nét, giữ nguyên chi tiết nhỏ.',
    icon: 'camera',
    params: {
      mode: 'color',
      singleLineStrokes: false,
      smoothness: 0,
      colorCount: 160,
      colorMergeDeltaE: 3,
      monochromeThreshold: 140,
      strokeWidth: 0,
      invertMonochrome: false,
      despeckleArea: 3,
      layerMode: 'stacked',
      simplifyTolerance: 0.35,
      cornerThreshold: 60,
      curveSmoothing: 0.55,
    },
  },
  {
    id: 'landscape-nature',
    label: 'Phong Cảnh',
    badge: '80 màu',
    description:
      'Dành cho ảnh thiên nhiên, bầu trời, núi rừng, kiến trúc: Cân bằng 80 dải màu chuyển sắc tự nhiên và chi tiết rõ ràng.',
    icon: 'mountain',
    params: {
      mode: 'color',
      singleLineStrokes: false,
      smoothness: 1,
      colorCount: 80,
      colorMergeDeltaE: 5,
      monochromeThreshold: 140,
      strokeWidth: 0,
      invertMonochrome: false,
      despeckleArea: 6,
      layerMode: 'stacked',
      simplifyTolerance: 0.45,
      cornerThreshold: 70,
      curveSmoothing: 0.7,
    },
  },
  {
    id: 'digital-painting',
    label: 'Tranh Minh Họa',
    badge: '48 màu',
    description:
      'Dành cho Digital Art, tranh minh họa 3D, bìa sách, Poster: Làm mịn nhẹ nhàng và giữ 48 sắc độ nghệ thuật sắc nét.',
    icon: 'palette',
    params: {
      mode: 'color',
      singleLineStrokes: false,
      smoothness: 1,
      colorCount: 48,
      colorMergeDeltaE: 7,
      monochromeThreshold: 140,
      strokeWidth: 0,
      invertMonochrome: false,
      despeckleArea: 8,
      layerMode: 'stacked',
      simplifyTolerance: 0.5,
      cornerThreshold: 70,
      curveSmoothing: 0.75,
    },
  },
  {
    id: 'abstract-popart',
    label: 'Trừu Tượng / Pop',
    badge: '14 màu',
    description:
      'Phong cách Posterize / Pop-Art / Trừu tượng: Gom mạnh các mảng màu tương phản lớn, tạo hình khối nghệ thuật hiện đại.',
    icon: 'flame',
    params: {
      mode: 'color',
      singleLineStrokes: false,
      smoothness: 4,
      colorCount: 14,
      colorMergeDeltaE: 20,
      monochromeThreshold: 140,
      strokeWidth: 0,
      invertMonochrome: false,
      despeckleArea: 64,
      layerMode: 'stacked',
      simplifyTolerance: 1.5,
      cornerThreshold: 65,
      curveSmoothing: 0.75,
    },
  },
  {
    id: 'low-poly',
    label: 'Đa Giác (Low-Poly)',
    badge: 'Cạnh thẳng',
    description:
      'Phong cách hình học đa giác (Geometric Facets): Tắt uốn cong để tạo toàn bộ các mặt cắt đa giác thẳng sắc lẹm.',
    icon: 'hexagon',
    params: {
      mode: 'color',
      singleLineStrokes: false,
      smoothness: 3,
      colorCount: 24,
      colorMergeDeltaE: 12,
      monochromeThreshold: 140,
      strokeWidth: 0,
      invertMonochrome: false,
      despeckleArea: 36,
      layerMode: 'stacked',
      simplifyTolerance: 2.2,
      cornerThreshold: 35,
      curveSmoothing: 0.0,
    },
  },
  {
    id: 'sketch-lineart',
    label: 'Sketch / Bản Vẽ',
    badge: '1-Line',
    description:
      'Dành cho bản phác thảo bút mực, chữ ký, bản vẽ kỹ thuật CAD: Rút lõi mọi nét vẽ về 1 sợi đường tâm Centerline duy nhất.',
    icon: 'pen-tool',
    params: {
      mode: 'centerline',
      singleLineStrokes: true,
      smoothness: 1,
      colorCount: 2,
      colorMergeDeltaE: 15,
      monochromeThreshold: 155,
      strokeWidth: 0,
      invertMonochrome: false,
      despeckleArea: 12,
      layerMode: 'stacked',
      simplifyTolerance: 0.7,
      cornerThreshold: 70,
      curveSmoothing: 0.95,
    },
  },
  {
    id: 'typography-stencil',
    label: 'Chữ & Con Dấu',
    badge: 'Silhouette',
    description:
      'Dành cho Typography, Thư pháp, Con dấu, Stencil: Tách mảng đen trắng sắc nét với độ chính xác chân chữ cực cao.',
    icon: 'type',
    params: {
      mode: 'monochrome',
      singleLineStrokes: false,
      smoothness: 1,
      colorCount: 2,
      colorMergeDeltaE: 15,
      monochromeThreshold: 145,
      strokeWidth: 0,
      invertMonochrome: false,
      despeckleArea: 8,
      layerMode: 'cutout',
      simplifyTolerance: 0.4,
      cornerThreshold: 60,
      curveSmoothing: 0.85,
    },
  },
  {
    id: 'decal-cnc',
    label: 'Cắt Decal / CNC',
    badge: 'Cutout',
    description:
      'Tối ưu cho máy cắt Decal, khắc Laser, in lụa tách màu: Các lớp màu cắt rời hoàn toàn (Cutout) và lọc sạch đốm vụn.',
    icon: 'scissors',
    params: {
      mode: 'color',
      singleLineStrokes: false,
      smoothness: 3,
      colorCount: 6,
      colorMergeDeltaE: 18,
      monochromeThreshold: 140,
      strokeWidth: 0,
      invertMonochrome: false,
      despeckleArea: 54,
      layerMode: 'cutout',
      simplifyTolerance: 1.1,
      cornerThreshold: 75,
      curveSmoothing: 0.95,
    },
  },
  {
    id: 'pixel-art',
    label: 'Pixel Art 8-Bit',
    badge: 'Vuông góc',
    description:
      'Dành cho Sprite game Pixel Art / Retro: Tắt làm mờ và tắt uốn cong để giữ nguyên từng bậc thang pixel vuông vức.',
    icon: 'grid',
    params: {
      mode: 'color',
      singleLineStrokes: false,
      smoothness: 0,
      colorCount: 32,
      colorMergeDeltaE: 4,
      monochromeThreshold: 140,
      strokeWidth: 0,
      invertMonochrome: false,
      despeckleArea: 0,
      layerMode: 'cutout',
      simplifyTolerance: 0.2,
      cornerThreshold: 40,
      curveSmoothing: 0.0,
    },
  },
  {
    id: 'ultra-256',
    label: 'Siêu Nét 256 Màu',
    badge: '256 màu',
    description:
      'Độ chi tiết tối đa 256 cụm màu, tắt làm mờ tiền xử lý, giữ nguyên từng vảy/chi tiết nhỏ 1px và bám sát ảnh gốc nhất.',
    icon: 'crown',
    params: {
      mode: 'color',
      singleLineStrokes: false,
      smoothness: 0,
      colorCount: 256,
      colorMergeDeltaE: 1,
      monochromeThreshold: 140,
      strokeWidth: 0,
      invertMonochrome: false,
      despeckleArea: 1,
      layerMode: 'stacked',
      simplifyTolerance: 0.2,
      cornerThreshold: 55,
      curveSmoothing: 0.45,
    },
  },
];

export const SAMPLE_PRESETS: SamplePreset[] = [
  {
    id: 'fox-badge',
    name: 'Logo Cáo Địa Hình',
    subtitle: 'Ảnh Logo kết hợp vòng tròn đồng tâm & đa giác góc nhọn',
    recommendedParams: {
      ...DEFAULT_PARAMS,
      mode: 'color',
      singleLineStrokes: false,
      smoothness: 2,
      colorCount: 7,
      colorMergeDeltaE: 15,
      despeckleArea: 30,
      layerMode: 'stacked',
      simplifyTolerance: 1.0,
      cornerThreshold: 85,
      curveSmoothing: 0.95,
    },
    renderToCanvas: (ctx, w, h) => {
      ctx.fillStyle = '#F6F1E7';
      ctx.fillRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;

      // Vòng viền huy hiệu ngoài
      ctx.beginPath();
      ctx.arc(cx, cy, 175, 0, Math.PI * 2);
      ctx.fillStyle = '#16293B';
      ctx.fill();

      // Bầu trời chuyển sắc đa tầng (Teal -> Cyan -> Warm Horizon) để thử nghiệm cả ít màu (Logo) lẫn 40-256 màu (Gradient)
      const skyGrad = ctx.createLinearGradient(cx, cy - 150, cx, cy + 150);
      skyGrad.addColorStop(0, '#1B5E68');
      skyGrad.addColorStop(0.45, '#2B7A78');
      skyGrad.addColorStop(0.75, '#489FB5');
      skyGrad.addColorStop(1, '#82C0CC');
      ctx.beginPath();
      ctx.arc(cx, cy, 150, 0, Math.PI * 2);
      ctx.fillStyle = skyGrad;
      ctx.fill();

      // Mặt trời chuyển sắc vàng cam rực rỡ
      const sunGrad = ctx.createRadialGradient(
        cx,
        cy - 45,
        10,
        cx,
        cy - 35,
        78
      );
      sunGrad.addColorStop(0, '#FFE66D');
      sunGrad.addColorStop(0.55, '#F4A261');
      sunGrad.addColorStop(1, '#E76F51');
      ctx.beginPath();
      ctx.arc(cx, cy - 35, 78, 0, Math.PI * 2);
      ctx.fillStyle = sunGrad;
      ctx.fill();

      // Dãy núi xa (Đa giác góc nhọn)
      const mtnGrad = ctx.createLinearGradient(cx, cy - 45, cx, cy + 55);
      mtnGrad.addColorStop(0, '#26547C');
      mtnGrad.addColorStop(1, '#16324F');
      ctx.beginPath();
      ctx.moveTo(cx - 140, cy + 50);
      ctx.lineTo(cx - 55, cy - 45);
      ctx.lineTo(cx + 15, cy + 25);
      ctx.lineTo(cx + 75, cy - 30);
      ctx.lineTo(cx + 140, cy + 50);
      ctx.closePath();
      ctx.fillStyle = mtnGrad;
      ctx.fill();

      // Đầu cáo chuyển sắc cam đỏ
      const foxGrad = ctx.createLinearGradient(cx - 80, cy - 65, cx + 80, cy + 125);
      foxGrad.addColorStop(0, '#F77F00');
      foxGrad.addColorStop(0.5, '#E76F51');
      foxGrad.addColorStop(1, '#D62828');
      ctx.beginPath();
      ctx.moveTo(cx - 85, cy - 65);
      ctx.lineTo(cx - 35, cy - 20);
      ctx.lineTo(cx + 35, cy - 20);
      ctx.lineTo(cx + 85, cy - 65);
      ctx.lineTo(cx + 95, cy + 35);
      ctx.lineTo(cx, cy + 125);
      ctx.lineTo(cx - 95, cy + 35);
      ctx.closePath();
      ctx.fillStyle = foxGrad;
      ctx.fill();

      // Hai má trắng kem
      ctx.fillStyle = '#F6F1E7';
      ctx.beginPath();
      ctx.moveTo(cx - 95, cy + 35);
      ctx.lineTo(cx - 28, cy + 38);
      ctx.lineTo(cx, cy + 125);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(cx + 95, cy + 35);
      ctx.lineTo(cx + 28, cy + 38);
      ctx.lineTo(cx, cy + 125);
      ctx.closePath();
      ctx.fill();

      // Mũi & mắt đen xanh
      ctx.fillStyle = '#16293B';
      ctx.beginPath();
      ctx.moveTo(cx - 18, cy + 102);
      ctx.lineTo(cx + 18, cy + 102);
      ctx.lineTo(cx, cy + 126);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.arc(cx - 36, cy + 18, 9, 0, Math.PI * 2);
      ctx.arc(cx + 36, cy + 18, 9, 0, Math.PI * 2);
      ctx.fill();
    },
  },
  {
    id: 'polar-bear-sticker',
    name: 'Gấu Trắng Cartoon (Nét Đơn)',
    subtitle: 'Minh họa Cartoon có nét viền mảnh vẽ bằng 1 đường đơn Centerline',
    recommendedParams: {
      ...DEFAULT_PARAMS,
      mode: 'cartoon',
      smoothness: 1,
      colorCount: 4,
      colorMergeDeltaE: 18,
      monochromeThreshold: 140,
      strokeWidth: 3.5,
      despeckleArea: 18,
      layerMode: 'stacked',
      simplifyTolerance: 1.0,
      cornerThreshold: 80,
      curveSmoothing: 0.95,
    },
    renderToCanvas: (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2 + 20;

      // Thân trắng của gấu
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(cx - 88, cy - 115, 36, 0, Math.PI * 2);
      ctx.arc(cx + 88, cy - 115, 36, 0, Math.PI * 2);
      ctx.arc(cx, cy, 145, 0, Math.PI * 2);
      ctx.fill();

      // Bóng xám nhẹ ở tai và má
      ctx.fillStyle = '#D8DEE9';
      ctx.beginPath();
      ctx.arc(cx - 88, cy - 115, 20, 0, Math.PI * 2);
      ctx.arc(cx + 88, cy - 115, 20, 0, Math.PI * 2);
      ctx.fill();

      // Nét viền đen mảnh (Stroke 3px)
      ctx.strokeStyle = '#1E242B';
      ctx.lineWidth = 3.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Viền tai trái & phải
      ctx.beginPath();
      ctx.arc(cx - 88, cy - 115, 36, Math.PI * 0.75, Math.PI * 1.95);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx + 88, cy - 115, 36, Math.PI * 1.05, Math.PI * 0.25);
      ctx.stroke();

      // Viền đầu gấu
      ctx.beginPath();
      ctx.arc(cx, cy, 145, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();

      // Vòng kính quanh mắt
      ctx.beginPath();
      ctx.arc(cx - 52, cy - 22, 36, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + 52, cy - 22, 36, 0, Math.PI * 2);
      ctx.stroke();

      // Hai con ngươi mắt đen đặc (Solid Blobs)
      ctx.fillStyle = '#14181D';
      ctx.beginPath();
      ctx.arc(cx - 52, cy - 22, 16, 0, Math.PI * 2);
      ctx.arc(cx + 52, cy - 22, 16, 0, Math.PI * 2);
      ctx.fill();

      // Mũi đen đặc
      ctx.beginPath();
      ctx.ellipse(cx, cy + 28, 22, 12, 0, 0, Math.PI * 2);
      ctx.fill();

      // Nét miệng mảnh
      ctx.beginPath();
      ctx.moveTo(cx - 42, cy + 58);
      ctx.quadraticCurveTo(cx, cy + 38, cx + 42, cy + 58);
      ctx.stroke();
    },
  },
  {
    id: 'botanical-sketch',
    name: 'Sketch Bút Mực (Centerline)',
    subtitle: 'Chế độ Nét Đơn biến nét vẽ thành 1 sợi đường cong duy nhất',
    recommendedParams: {
      ...DEFAULT_PARAMS,
      mode: 'centerline',
      smoothness: 1,
      monochromeThreshold: 155,
      strokeWidth: 4,
      invertMonochrome: false,
      despeckleArea: 14,
      layerMode: 'stacked',
      simplifyTolerance: 0.9,
      cornerThreshold: 75,
      curveSmoothing: 0.95,
    },
    renderToCanvas: (ctx, w, h) => {
      ctx.fillStyle = '#F4F3EE';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = '#1B1F24';
      ctx.fillStyle = '#1B1F24';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const cx = w / 2;
      const cy = h / 2;

      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 165, 0, Math.PI * 2);
      ctx.stroke();

      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(cx - 10, cy + 135);
      ctx.bezierCurveTo(cx - 35, cy + 40, cx + 35, cy - 30, cx + 5, cy - 125);
      ctx.stroke();

      const leaves = [
        { x: cx - 12, y: cy + 65, angle: -2.3, size: 68 },
        { x: cx + 2, y: cy + 30, angle: -0.7, size: 72 },
        { x: cx + 8, y: cy - 15, angle: -2.4, size: 64 },
        { x: cx + 12, y: cy - 55, angle: -0.65, size: 56 },
        { x: cx + 5, y: cy - 125, angle: -1.55, size: 48 },
      ];

      for (const lf of leaves) {
        ctx.save();
        ctx.translate(lf.x, lf.y);
        ctx.rotate(lf.angle);
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(lf.size * 0.5, -lf.size * 0.38, lf.size, 0);
        ctx.quadraticCurveTo(lf.size * 0.5, lf.size * 0.38, 0, 0);
        ctx.stroke();
        ctx.restore();
      }
    },
  },
  {
    id: 'retro-camera',
    name: 'Icon Máy Ảnh Flat UI',
    subtitle: 'Hình học kết hợp góc vuông sắc nét và vòng tròn đồng tâm',
    recommendedParams: {
      ...DEFAULT_PARAMS,
      mode: 'color',
      singleLineStrokes: false,
      smoothness: 1,
      colorCount: 6,
      colorMergeDeltaE: 14,
      despeckleArea: 20,
      layerMode: 'stacked',
      simplifyTolerance: 1.0,
      cornerThreshold: 90,
      curveSmoothing: 0.95,
    },
    renderToCanvas: (ctx, w, h) => {
      ctx.fillStyle = '#E8EEF5';
      ctx.fillRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2 + 10;

      ctx.fillStyle = '#E63946';
      ctx.beginPath();
      ctx.roundRect(cx + 55, cy - 118, 46, 28, 8);
      ctx.fill();

      ctx.fillStyle = '#2B2D42';
      ctx.beginPath();
      ctx.roundRect(cx - 60, cy - 122, 95, 34, 10);
      ctx.fill();

      ctx.fillStyle = '#F4F1DE';
      ctx.beginPath();
      ctx.roundRect(cx - 155, cy - 95, 310, 195, 28);
      ctx.fill();

      ctx.fillStyle = '#2B2D42';
      ctx.beginPath();
      ctx.roundRect(cx - 155, cy - 25, 310, 125, [0, 0, 28, 28]);
      ctx.fill();

      ctx.fillStyle = '#E63946';
      ctx.fillRect(cx - 155, cy - 42, 310, 12);
      ctx.fillStyle = '#F4A261';
      ctx.fillRect(cx - 155, cy - 30, 310, 12);

      ctx.fillStyle = '#8D99AE';
      ctx.beginPath();
      ctx.arc(cx, cy + 8, 76, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#1D3557';
      ctx.beginPath();
      ctx.arc(cx, cy + 8, 54, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#F4F1DE';
      ctx.beginPath();
      ctx.arc(cx - 18, cy - 10, 14, 0, Math.PI * 2);
      ctx.fill();
    },
  },
];
