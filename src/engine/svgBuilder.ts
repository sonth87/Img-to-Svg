import { VectorPathData } from '../types/vectorizer';

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

  const useSeamSeal = paths.length > 16;

  for (const path of paths) {
    if (path.isStroke) {
      const sw = path.strokeWidth ?? 2.5;
      lines.push(
        `  <path id="layer-stroke-${path.colorId}" fill="none" stroke="${path.hex}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" d="${path.d}" />`
      );
    } else if (useSeamSeal) {
      lines.push(
        `  <path id="layer-color-${path.colorId}" fill="${path.hex}" stroke="${path.hex}" stroke-width="0.85" stroke-linejoin="round" stroke-linecap="round" fill-rule="evenodd" d="${path.d}" />`
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
