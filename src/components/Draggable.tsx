import { useState, useRef, useCallback, type ReactNode, type CSSProperties } from 'react';

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
 */
export function Draggable({ children, defaultPosition, style, baseTransform }: DraggableProps) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

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
    setOffset({ x: dragState.current.origX + dx, y: dragState.current.origY + dy });
  }, []);

  const onPointerUp = useCallback(() => {
    dragState.current = null;
  }, []);

  const transform = baseTransform
    ? `${baseTransform} translate(${offset.x}px, ${offset.y}px)`
    : `translate(${offset.x}px, ${offset.y}px)`;

  return (
    <div
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
