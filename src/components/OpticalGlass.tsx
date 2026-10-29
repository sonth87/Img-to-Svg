import React, {
  useState,
  useEffect,
  useRef,
  useId,
  forwardRef,
  type HTMLAttributes,
} from 'react';
import {
  resolveRadius,
  generateDisplacementMap,
  checkLiquidGlassSupport,
} from '../core/liquidGlassRefraction';

export interface OpticalGlassProps extends HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  /** Độ phóng đại / khúc xạ của thấu kính (giá trị âm tạo hiệu ứng lồi mép, -60 nhẹ đến -180 mạnh) */
  scale?: number;
  /** Độ lệch pha màu tán sắc lăng kính R-G-B (prism fringe, 0 để tắt) */
  chroma?: number;
  /** Tỉ lệ vùng vát mép thấu kính so với cạnh nhỏ nhất (0.01 đến 0.2) */
  border?: number;
  /** Độ cong mềm mại của mép thấu kính (px) */
  mapBlur?: number;
  /** Độ mờ backdrop bên trong kính (px) */
  blur?: number;
  /** Tăng cường độ tươi màu sắc nền xuyên qua kính (1.0 - 3.0x) */
  saturate?: number;
  /** Bo góc container (px, số hoặc chuỗi như "28px", "50%"). Mặc định 16px */
  borderRadius?: number | string;
  /** Độ sáng viền phản chiếu specular trên đỉnh kính (0-1) */
  highlightOpacity?: number;
  /** Phạm vi/độ phủ rộng của vệt sáng Specular Highlight (%: 10 - 70) */
  highlightSize?: number;
  /** Góc chiếu của ánh sáng phản xạ (deg: 0 - 360) */
  specularAngle?: number;
  /** Bán kính độ lan tản sáng viền trong Inner Glow (px: 0 - 40, mặc định 12) */
  innerGlowRadius?: number;
  /** Độ đậm tản sáng viền trong Inner Glow (0 - 1, mặc định 0.18) */
  innerGlowOpacity?: number;
  /** Bật/tắt lớp phủ chuyển sắc Gradient Tint tạo chiều sâu khúc xạ quang học (mặc định true) */
  gradientTint?: boolean;
  /** Độ dày của viền border (px) */
  borderWidth?: number;
  /** Màu sắc lớp phủ tint (HEX: Cyber Blue #0284c7, Indigo #6366f1, Rose #e11d48,...) */
  tintColor?: string;
  /** Độ đục của lớp phủ tint (0 - 0.6, mặc định 0.18) */
  tintOpacity?: number;
  /** Màu nền kính cơ sở (Base Color HEX: #0f172a cho Dark, #ffffff cho Light) */
  baseColor?: string;
  /** Độ đục của lớp nền kính cơ sở (Base Opacity: 0.20 - 1.0, mặc định 0.78) */
  baseOpacity?: number;
  /** Độ mờ fallback khi trình duyệt không hỗ trợ SVG backdrop-filter (Safari/Firefox) */
  fallbackBlur?: number;
  /** Callback thông báo filterId khi sẵn sàng */
  onFilterReady?: (filterId: string) => void;
  /** Style tùy chỉnh cho div nội dung bên trong */
  contentStyle?: React.CSSProperties;
  /** Class tùy chỉnh cho div nội dung bên trong */
  contentClassName?: string;
}

function getTintRgba(hex: string, opacity: number): string {
  let clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    clean = clean
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (clean.length > 6) clean = clean.substring(0, 6);
  if (clean.length !== 6) return `rgba(14, 14, 22, ${opacity})`;
  const r = parseInt(clean.substring(0, 2), 16) || 14;
  const g = parseInt(clean.substring(2, 4), 16) || 14;
  const b = parseInt(clean.substring(4, 6), 16) || 22;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export const OpticalGlass = forwardRef<HTMLDivElement, OpticalGlassProps>(
  (
    {
      children,
      scale = -108,
      chroma = 6,
      border = 0.07,
      mapBlur = 11,
      blur = 8,
      saturate = 1.65,
      borderRadius = 16,
      highlightOpacity = 0.45,
      highlightSize = 36,
      specularAngle = 135,
      innerGlowRadius = 12,
      innerGlowOpacity = 0.18,
      gradientTint = true,
      borderWidth = 1,
      tintColor = '#6366f1',
      tintOpacity = 0.18,
      baseColor = '#0f172a',
      baseOpacity = 0.78,
      fallbackBlur = 16,
      onFilterReady,
      className = '',
      style,
      contentStyle,
      contentClassName = '',
      ...props
    },
    externalRef
  ) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [mapUrl, setMapUrl] = useState<string>('');
    const [isSupported, setIsSupported] = useState<boolean>(true);
    const [dims, setDims] = useState<{ width: number; height: number }>({
      width: 0,
      height: 0,
    });

    const uniqueId = useId().replace(/:/g, '');
    const filterId = `optical-glass-filter-${uniqueId}`;

    const setMergedRef = (node: HTMLDivElement | null) => {
      containerRef.current = node;
      if (typeof externalRef === 'function') {
        externalRef(node);
      } else if (externalRef) {
        externalRef.current = node;
      }
    };

    useEffect(() => {
      setIsSupported(checkLiquidGlassSupport());
    }, []);

    useEffect(() => {
      if (isSupported && filterId && onFilterReady) {
        onFilterReady(filterId);
      }
    }, [isSupported, filterId, onFilterReady]);

    useEffect(() => {
      const el = containerRef.current;
      if (!el || !isSupported) return;

      let timer: ReturnType<typeof setTimeout> | null = null;

      const updateMap = () => {
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        if (w > 0 && h > 0) {
          setDims({ width: w, height: h });
          const numRadius = resolveRadius(el, w, h, borderRadius);
          const url = generateDisplacementMap(
            w,
            h,
            numRadius,
            border,
            mapBlur
          );
          setMapUrl(url);
        }
      };

      updateMap();

      const ro = new ResizeObserver(() => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(updateMap, 90);
      });
      ro.observe(el);

      return () => {
        ro.disconnect();
        if (timer) clearTimeout(timer);
      };
    }, [border, mapBlur, borderRadius, isSupported]);

    const tintTop = getTintRgba(tintColor, tintOpacity);
    const tintBottom = getTintRgba(tintColor, tintOpacity * 0.45);
    const gradientTintLayer = `linear-gradient(${specularAngle}deg, ${tintTop} 0%, ${tintBottom} 100%)`;
    const baseLayer = getTintRgba(baseColor, baseOpacity);

    const currentBg = gradientTint
      ? `${gradientTintLayer}, ${baseLayer}`
      : baseLayer;

    const scaleR = scale;
    const scaleG = scale + chroma;
    const scaleB = scale + chroma * 2;

    const backdropFilterValue =
      isSupported && mapUrl
        ? `url(#${filterId}) blur(${blur}px) saturate(${saturate})`
        : `blur(${fallbackBlur}px) saturate(${saturate})`;

    return (
      <div
        ref={setMergedRef}
        className={`optical-glass-container ${className}`}
        style={{
          position: 'relative',
          borderRadius:
            typeof borderRadius === 'number'
              ? `${borderRadius}px`
              : borderRadius,
          overflow: 'hidden',
          background: currentBg,
          backdropFilter: backdropFilterValue,
          WebkitBackdropFilter: backdropFilterValue,
          border: `${borderWidth}px solid ${getTintRgba(tintColor, 0.38)}`,
          boxShadow: `
            0 20px 50px rgba(0, 0, 0, 0.38),
            inset 0 1px 1px rgba(255, 255, 255, ${highlightOpacity}),
            inset 0 -8px 20px rgba(255, 255, 255, 0.06),
            inset 0 0 0 1px rgba(255, 255, 255, ${highlightOpacity * 0.3})
          `,
          ...style,
        }}
        {...props}
      >
        {/* Vệt phản xạ ánh sáng specular & viền sáng tản vào trong (Inner Glow) */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 'inherit',
            pointerEvents: 'none',
            zIndex: 2,
            background: `linear-gradient(
              ${specularAngle}deg,
              rgba(255, 255, 255, ${highlightOpacity * 0.42}) 0%,
              rgba(255, 255, 255, ${highlightOpacity * 0.08}) ${Math.round(
              highlightSize * 0.5
            )}%,
              rgba(255, 255, 255, 0) ${highlightSize}%
            )`,
            boxShadow:
              innerGlowRadius > 0
                ? `inset 0 0 ${innerGlowRadius}px rgba(255, 255, 255, ${innerGlowOpacity})`
                : undefined,
          }}
        />

        {/* Nội dung bên trong thấu kính (luôn sắc nét và phẳng ở tâm) */}
        <div
          className={`glass-content ${contentClassName}`}
          style={{
            position: 'relative',
            zIndex: 1,
            ...contentStyle,
          }}
        >
          {children}
        </div>

        {/* SVG Optical Filter: 3-pass RGB chromatic aberration */}
        {isSupported && mapUrl && (
          <svg
            style={{
              position: 'absolute',
              width: 0,
              height: 0,
              pointerEvents: 'none',
            }}
            aria-hidden="true"
          >
            <defs>
              <filter
                id={filterId}
                x="0"
                y="0"
                width="100%"
                height="100%"
                colorInterpolationFilters="sRGB"
              >
                <feImage
                  href={mapUrl}
                  x="0"
                  y="0"
                  width={dims.width}
                  height={dims.height}
                  result="displacement_map"
                  preserveAspectRatio="none"
                />

                {/* Kênh Đỏ (Red Channel Displacement) */}
                <feDisplacementMap
                  in="SourceGraphic"
                  in2="displacement_map"
                  scale={scaleR}
                  xChannelSelector="R"
                  yChannelSelector="B"
                  result="disp_red"
                />
                <feColorMatrix
                  in="disp_red"
                  type="matrix"
                  values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
                  result="red_only"
                />

                {/* Kênh Lục (Green Channel Displacement) */}
                <feDisplacementMap
                  in="SourceGraphic"
                  in2="displacement_map"
                  scale={scaleG}
                  xChannelSelector="R"
                  yChannelSelector="B"
                  result="disp_green"
                />
                <feColorMatrix
                  in="disp_green"
                  type="matrix"
                  values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
                  result="green_only"
                />

                {/* Kênh Lam (Blue Channel Displacement) */}
                <feDisplacementMap
                  in="SourceGraphic"
                  in2="displacement_map"
                  scale={scaleB}
                  xChannelSelector="R"
                  yChannelSelector="B"
                  result="disp_blue"
                />
                <feColorMatrix
                  in="disp_blue"
                  type="matrix"
                  values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
                  result="blue_only"
                />

                {/* Hòa trộn lại 3 kênh màu (Screen blend) để tạo tán sắc lăng kính */}
                <feBlend
                  in="red_only"
                  in2="green_only"
                  mode="screen"
                  result="blend_rg"
                />
                <feBlend in="blend_rg" in2="blue_only" mode="screen" />
              </filter>
            </defs>
          </svg>
        )}
      </div>
    );
  }
);

OpticalGlass.displayName = 'OpticalGlass';

export default OpticalGlass;
