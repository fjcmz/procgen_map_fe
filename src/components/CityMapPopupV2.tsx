import { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { CityEnvironment } from '../lib/citymap';
import { generateCityMapV2, renderCityMapV2 } from '../lib/citymap';

interface CityMapPopupV2Props {
  isOpen: boolean;
  onClose: () => void;
  cityName: string;
  environment: CityEnvironment;
  seed: string;
}

export function CityMapPopupV2({ isOpen, onClose, cityName, environment, seed }: CityMapPopupV2Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const internalSize = 720;

    // Scale display size to fit viewport: subtract chrome (header ~40px + footer ~28px + padding ~48px = ~116px)
    const availableW = window.innerWidth - 48;  // 24px margin each side
    const availableH = window.innerHeight - 116;
    const displaySize = Math.max(200, Math.min(internalSize, availableW, availableH));

    // Keep backing buffer at full 720×720 for quality; only shrink the CSS display size
    canvas.width = internalSize * dpr;
    canvas.height = internalSize * dpr;
    canvas.style.width = `${displaySize}px`;
    canvas.style.height = `${displaySize}px`;
    ctx.scale(dpr, dpr);

    const data = generateCityMapV2(seed, cityName, environment);
    renderCityMapV2(ctx, data, environment, seed, cityName);
  }, [isOpen, seed, cityName, environment]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div style={styles.backdrop} onClick={handleBackdropClick}>
      <div style={styles.container}>
        <div style={styles.header}>
          <span style={styles.title}>{cityName} (V2)</span>
          <button style={styles.closeBtn} onClick={onClose} title="Close">&times;</button>
        </div>
        <div style={styles.canvasWrapper}>
          <canvas ref={canvasRef} style={styles.canvas} />
        </div>
        <div style={styles.footer}>
          <span style={styles.footerText}>
            {environment.size.charAt(0).toUpperCase() + environment.size.slice(1)}
            {environment.isCapital ? ' • Capital' : ''}
            {environment.isCoastal ? ' • Coastal' : ''}
            {environment.hasRiver ? ' • River' : ''}
            {environment.isRuin ? ' • Ruins' : ''}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(30, 20, 10, 0.6)',
    zIndex: 10000,
    padding: '16px 12px',
    boxSizing: 'border-box',
  },
  container: {
    background: '#f5e9c8',
    border: '2px solid #8a6a3a',
    borderRadius: 6,
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    display: 'flex',
    flexDirection: 'column',
    maxWidth: '100%',
    maxHeight: '100%',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: '1px solid #d4b896',
    background: '#ecdbb8',
    borderRadius: '6px 6px 0 0',
    flexShrink: 0,
  },
  title: {
    fontWeight: 'bold',
    fontSize: 14,
    color: '#3a1a00',
    letterSpacing: 0.5,
    fontFamily: 'serif',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    marginRight: 8,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 22,
    color: '#7a5a30',
    padding: '4px 8px',
    lineHeight: 1,
    fontWeight: 'bold',
    flexShrink: 0,
    // Ensure a large-enough touch target on mobile
    minWidth: 44,
    minHeight: 44,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
  },
  canvasWrapper: {
    padding: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'auto',
    flexShrink: 1,
    minHeight: 0,
  },
  canvas: {
    borderRadius: 3,
    display: 'block',
  },
  footer: {
    padding: '6px 12px',
    borderTop: '1px solid #d4b896',
    textAlign: 'center',
    flexShrink: 0,
  },
  footerText: {
    fontSize: 11,
    color: '#6a4a20',
    fontStyle: 'italic',
  },
};
