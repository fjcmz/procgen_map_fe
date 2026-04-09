import { useState, useRef, useCallback, useEffect, type ReactNode, type CSSProperties } from 'react';

interface DraggableProps {
  children: ReactNode;
  /** Initial CSS position properties (top, left, bottom, right) */
  defaultPosition: CSSProperties;
  /** Additional styles for the outer wrapper */
  style?: CSSProperties;
  /** Extra CSS transform to apply before the drag offset (e.g. 'translateX(-50%)') */
  baseTransform?: string;
  /** localStorage key for persisting the drag offset across sessions */
  storageKey?: string;
  /** When the viewport is narrower than `breakpoint` px, dock the panel and suppress dragging */
  responsiveDock?: { breakpoint: number; dockStyle?: CSSProperties };
}

/** Read a persisted {x,y} offset from localStorage, or return {x:0,y:0}. */
function readStoredOffset(key: string | undefined): { x: number; y: number } {
  if (!key) return { x: 0, y: 0 };
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { x: 0, y: 0 };
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === 'object' && parsed !== null &&
      Number.isFinite(parsed.x) && Number.isFinite(parsed.y)
    ) {
      return { x: parsed.x, y: parsed.y };
    }
  } catch { /* private-browsing or corrupt data — fall through */ }
  return { x: 0, y: 0 };
}

/**
 * Wraps children in a fixed-position container that can be repositioned by
 * dragging any element inside that has the `data-drag-handle` attribute.
 *
 * Drag handles are identified by the `data-drag-handle` HTML attribute.
 * Set `touch-action: none` on handle elements to prevent browser gestures
 * from interfering on mobile.
 */
export function Draggable({ children, defaultPosition, style, baseTransform, storageKey, responsiveDock }: DraggableProps) {
  const [offset, setOffset] = useState(() => readStoredOffset(storageKey));
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Responsive dock state
  const [isDocked, setIsDocked] = useState(() => {
    if (!responsiveDock) return false;
    if (typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(`(max-width: ${responsiveDock.breakpoint - 1}px)`).matches;
  });

  useEffect(() => {
    if (!responsiveDock) return;
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(`(max-width: ${responsiveDock.breakpoint - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setIsDocked(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [responsiveDock]);

  // Persist offset to localStorage on change (debounced to pointer-up via the
  // write in onPointerUp, but also catch programmatic resets from clamp).
  const persistOffset = useCallback((o: { x: number; y: number }) => {
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify(o)); } catch { /* ignore */ }
  }, [storageKey]);

  // Clamp offset so the panel stays at least partially visible
  const clampOffset = useCallback((x: number, y: number): { x: number; y: number } => {
    const el = containerRef.current;
    if (!el) return { x, y };
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Keep at least 40px of the panel visible on each axis
    const margin = 40;
    const minX = -rect.left + offset.x - rect.width + margin;
    const maxX = -rect.left + offset.x + vw - margin;
    const minY = -rect.top + offset.y - rect.height + margin;
    const maxY = -rect.top + offset.y + vh - margin;
    return {
      x: Math.max(minX, Math.min(maxX, x)),
      y: Math.max(minY, Math.min(maxY, y)),
    };
  }, [offset]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (isDocked) return;
    const target = e.target as HTMLElement;
    if (!target.closest('[data-drag-handle]')) return;
    if (target.tagName === 'INPUT' || target.tagName === 'BUTTON') return;

    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = { startX: e.clientX, startY: e.clientY, origX: offset.x, origY: offset.y };
  }, [offset, isDocked]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    const raw = { x: dragState.current.origX + dx, y: dragState.current.origY + dy };
    setOffset(clampOffset(raw.x, raw.y));
  }, [clampOffset]);

  const onPointerUp = useCallback(() => {
    if (dragState.current) {
      persistOffset(offset);
    }
    dragState.current = null;
  }, [offset, persistOffset]);

  // Re-clamp when window resizes (e.g. orientation change on mobile)
  useEffect(() => {
    if (isDocked) return;
    const onResize = () => setOffset(prev => {
      const clamped = clampOffset(prev.x, prev.y);
      return clamped;
    });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clampOffset, isDocked]);

  // Docked mode: override styles, suppress transform
  if (isDocked && responsiveDock) {
    const dockStyle: CSSProperties = {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      borderRadius: 0,
      ...style,
      width: '100%',
      transform: 'none',
      ...responsiveDock.dockStyle,
    };
    return (
      <div ref={containerRef} style={dockStyle}>
        {children}
      </div>
    );
  }

  const transform = baseTransform
    ? `${baseTransform} translate(${offset.x}px, ${offset.y}px)`
    : `translate(${offset.x}px, ${offset.y}px)`;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        ...defaultPosition,
        ...style,
        transform,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {children}
    </div>
  );
}
