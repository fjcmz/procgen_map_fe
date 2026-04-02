import { useState, useRef, useCallback, useEffect, type ReactNode, type CSSProperties } from 'react';

interface DraggableProps {
  children: ReactNode;
  /** Initial CSS position properties (top, left, bottom, right) */
  defaultPosition: CSSProperties;
  /** Additional styles for the outer wrapper */
  style?: CSSProperties;
  /** Extra CSS transform to apply before the drag offset (e.g. 'translateX(-50%)') */
  baseTransform?: string;
}

/**
 * Wraps children in a fixed-position container that can be repositioned by
 * dragging any element inside that has the `data-drag-handle` attribute.
 *
 * Drag handles are identified by the `data-drag-handle` HTML attribute.
 * Set `touch-action: none` on handle elements to prevent browser gestures
 * from interfering on mobile.
 */
export function Draggable({ children, defaultPosition, style, baseTransform }: DraggableProps) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
    const target = e.target as HTMLElement;
    if (!target.closest('[data-drag-handle]')) return;
    if (target.tagName === 'INPUT' || target.tagName === 'BUTTON') return;

    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = { startX: e.clientX, startY: e.clientY, origX: offset.x, origY: offset.y };
  }, [offset]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    const raw = { x: dragState.current.origX + dx, y: dragState.current.origY + dy };
    setOffset(clampOffset(raw.x, raw.y));
  }, [clampOffset]);

  const onPointerUp = useCallback(() => {
    dragState.current = null;
  }, []);

  // Re-clamp when window resizes (e.g. orientation change on mobile)
  useEffect(() => {
    const onResize = () => setOffset(prev => clampOffset(prev.x, prev.y));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clampOffset]);

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
