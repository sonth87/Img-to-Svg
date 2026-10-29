import { VectorPathData } from '../types/vectorizer';

/**
 * Bề dày viền che khe giữa các vùng màu (0 = không cần). Viền làm mỗi vùng phình ra nửa bề dày viền:
 * ảnh rất nhiều màu (ảnh chụp, render 3D) có vô số vùng 1-3px khít nhau theo biên pixel, viền 0.85px nuốt mất
 * 40-85% bề rộng của chúng; 0.15px đủ che khe khi zoom lẻ. Khung xem trong app dùng chung giá trị này.
 */
export function getSeamStrokeWidth(layerCount: number): number {
  if (layerCount <= 16) return 0;
  return layerCount > 64 ? 0.15 : 0.85;
}

/**
 * SVG nhúng nguyên ảnh gốc (độ phân giải đầy đủ) trong khung tọa độ của ảnh xử lý.
 * Zoom giống hệt ảnh gốc nhưng không còn là vector: không đổi màu / cắt từng vùng được.
 */
export function buildEmbeddedImageSvg(
  imageDataUrl: string,
  width: number,
  height: number
): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    `  <image width="${width}" height="${height}" preserveAspectRatio="none" href="${imageDataUrl}" xlink:href="${imageDataUrl}" />`,
    '</svg>',
  ].join('\n');
}

/**
 * Đóng gói danh sách các lớp đường cong `VectorPathData[]` thành chuỗi XML `<svg>` hoàn chỉnh.
 * Hỗ trợ cả lớp vùng màu đặc (`fill="..."`) và lớp nét đơn Centerline (`fill="none" stroke="..."`).
 */
export function buildSvgDocument(
  paths: VectorPathData[],
  width: number,
  height: number
): string {
  const lines: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" shape-rendering="geometricPrecision">`,
  ];

  const seamWidth = getSeamStrokeWidth(paths.length);
  const useSeamSeal = seamWidth > 0;

  for (const path of paths) {
    if (path.isStroke) {
      const sw = path.strokeWidth ?? 2.5;
      lines.push(
        `  <path id="layer-stroke-${path.colorId}" fill="none" stroke="${path.hex}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" d="${path.d}" />`
      );
    } else if (path.opacity !== undefined) {
      // Lớp bán trong suốt: không viền che khe (viền chồng lên fill sẽ đậm hơn ở mép)
      lines.push(
        `  <path id="layer-color-${path.colorId}" fill="${path.hex}" fill-opacity="${path.opacity}" fill-rule="evenodd" d="${path.d}" />`
      );
    } else if (useSeamSeal) {
      lines.push(
        `  <path id="layer-color-${path.colorId}" fill="${path.hex}" stroke="${path.hex}" stroke-width="${seamWidth}" stroke-linejoin="round" stroke-linecap="round" fill-rule="evenodd" d="${path.d}" />`
      );
    } else {
      lines.push(
        `  <path id="layer-color-${path.colorId}" fill="${path.hex}" fill-rule="evenodd" d="${path.d}" />`
      );
    }
  }

  lines.push('</svg>');
  return lines.join('\n');
}
