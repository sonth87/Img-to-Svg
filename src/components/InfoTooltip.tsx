import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle } from 'lucide-react';
import { OpticalGlass } from './OpticalGlass';

interface InfoTooltipProps {
  title?: string;
  content: React.ReactNode;
  children?: React.ReactNode;
  side?: 'top' | 'bottom' | 'right' | 'left';
  widthClass?: string;
}

export const InfoTooltip: React.FC<InfoTooltipProps> = ({
  title,
  content,
  children,
  side = 'top',
  widthClass = 'w-64',
}) => {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number }>({
    top: -9999,
    left: -9999,
  });

  const clearTimers = () => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const updatePosition = useCallback(() => {
    const triggerEl = triggerRef.current;
    if (!triggerEl) return;
    const rect = triggerEl.getBoundingClientRect();
    const popupEl = popupRef.current;
    const popW = popupEl?.offsetWidth || 256;
    const popH = popupEl?.offsetHeight || 88;
    const gap = 8;
    const pad = 10;

    let top = rect.top - popH - gap;
    let left = rect.left + rect.width * 0.5 - popW * 0.5;

    if (side === 'bottom') {
      top = rect.bottom + gap;
    } else if (side === 'right') {
      top = rect.top + rect.height * 0.5 - popH * 0.5;
      left = rect.right + gap;
    } else if (side === 'left') {
      top = rect.top + rect.height * 0.5 - popH * 0.5;
      left = rect.left - popW - gap;
    }

    // Tự động lật (flip) nếu tràn mép màn hình
    if (top < pad) {
      top =
        side === 'top'
          ? Math.min(window.innerHeight - popH - pad, rect.bottom + gap)
          : pad;
    }
    if (top + popH > window.innerHeight - pad) {
      top = Math.max(pad, rect.top - popH - gap);
    }
    if (left + popW > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - popW - pad);
    }
    if (left < pad) {
      left = pad;
    }

    setCoords({ top, left });
  }, [side]);

  useEffect(() => {
    if (!isOpen) return;
    updatePosition();
    const raf = window.requestAnimationFrame(updatePosition);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsPinned(false);
        setIsOpen(false);
      }
    };
    const handlePointerDownOutside = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        popupRef.current?.contains(target)
      ) {
        return;
      }
      setIsPinned(false);
      setIsOpen(false);
    };
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('pointerdown', handlePointerDownOutside);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('pointerdown', handlePointerDownOutside);
    };
  }, [isOpen, updatePosition]);

  const isTouchPointerRef = useRef(false);

  const handleMouseEnter = () => {
    if (isTouchPointerRef.current) return;
    clearTimers();
    if (isOpen) return;
    openTimerRef.current = window.setTimeout(() => {
      setIsOpen(true);
    }, 110);
  };

  const handleMouseLeave = () => {
    if (isTouchPointerRef.current) return;
    clearTimers();
    if (isPinned) return;
    closeTimerRef.current = window.setTimeout(() => {
      setIsOpen(false);
    }, 150);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-describedby={isOpen ? tooltipId : undefined}
        aria-expanded={isOpen}
        onPointerDown={(e) => {
          isTouchPointerRef.current = e.pointerType === 'touch';
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocus={() => {
          if (!isTouchPointerRef.current) handleMouseEnter();
        }}
        onBlur={() => {
          if (!isTouchPointerRef.current) handleMouseLeave();
        }}
        onClick={(e) => {
          e.stopPropagation();
          clearTimers();
          if (isPinned || (isTouchPointerRef.current && isOpen)) {
            setIsPinned(false);
            setIsOpen(false);
          } else {
            setIsPinned(true);
            setIsOpen(true);
          }
        }}
        className={`inline-flex items-center justify-center rounded-full transition cursor-pointer touch-manipulation focus:outline-none ${
          children
            ? ''
            : isPinned
            ? 'apple-lens-btn-primary text-white p-1 -m-0.5'
            : 'apple-lens-btn text-slate-500 hover:text-indigo-600 dark:text-slate-300 dark:hover:text-indigo-300 p-0.5 -m-0.5'
        }`}
      >
        {children ?? <HelpCircle className="w-3.5 h-3.5" />}
      </button>

      {isOpen &&
        createPortal(
          <OpticalGlass
            ref={popupRef}
            id={tooltipId}
            role="tooltip"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            scale={-110}
            chroma={6}
            border={0.08}
            mapBlur={10}
            blur={10}
            saturate={1.75}
            borderRadius={14}
            tintColor="#38bdf8"
            tintOpacity={0.2}
            baseColor="#0f172a"
            baseOpacity={0.82}
            highlightOpacity={0.5}
            innerGlowRadius={14}
            innerGlowOpacity={0.22}
            style={{ top: coords.top, left: coords.left, position: 'fixed' }}
            className={`z-[100] ${widthClass} max-w-[92vw] text-slate-100 text-[11px] leading-relaxed select-none animate-in fade-in duration-150`}
            contentClassName="p-2.5"
          >
            {title && (
              <div className="font-semibold text-sky-300 mb-1 flex items-center justify-between gap-2">
                <span>{title}</span>
                {isPinned && (
                  <span className="text-[9px] font-mono px-1.5 py-0.2 rounded-full bg-sky-500/25 border border-sky-400/40 text-sky-100">
                    Đã ghim
                  </span>
                )}
              </div>
            )}
            <div className="text-slate-100/95">{content}</div>
          </OpticalGlass>,
          document.body
        )}
    </>
  );
};
