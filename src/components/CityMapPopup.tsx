import { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { CityEnvironment } from '../lib/citymap/cityMapGenerator';
import { generateCityMap } from '../lib/citymap/cityMapGenerator';
import { renderCityMap } from '../lib/citymap/cityMapRenderer';

interface CityMapPopupProps {
  isOpen: boolean;
  onClose: () => void;
  cityName: string;
  environment: CityEnvironment;
  seed: string;
}

export function CityMapPopup({ isOpen, onClose, cityName, environment, seed }: CityMapPopupProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Generate and render the city map when popup opens
  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const size = 720;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(dpr, dpr);

    const data = generateCityMap(seed, cityName, environment);
    renderCityMap(ctx, data, environment, seed, cityName);
  }, [isOpen, seed, cityName, environment]);

  // Close on Escape
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
          <span style={styles.title}>{cityName}</span>
          <button style={styles.closeBtn} onClick={onClose} title="Close">&times;</button>
        </div>
        <div style={styles.canvasWrapper}>
          <canvas ref={canvasRef} style={styles.canvas} />
        </div>
        <div style={styles.footer}>
          <span style={styles.footerText}>
            {environment.size.charAt(0).toUpperCase() + environment.size.slice(1)}
            {environment.isCapital ? ' \u2022 Capital' : ''}
            {environment.isCoastal ? ' \u2022 Coastal' : ''}
            {environment.hasRiver ? ' \u2022 River' : ''}
            {environment.isRuin ? ' \u2022 Ruins' : ''}
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
  },
  container: {
    background: '#f5e9c8',
    border: '2px solid #8a6a3a',
    borderRadius: 6,
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    display: 'flex',
    flexDirection: 'column',
    maxWidth: 'calc(100vw - 32px)',
    maxHeight: 'calc(100vh - 32px)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: '1px solid #d4b896',
    background: '#ecdbb8',
    borderRadius: '6px 6px 0 0',
  },
  title: {
    fontWeight: 'bold',
    fontSize: 14,
    color: '#3a1a00',
    letterSpacing: 0.5,
    fontFamily: 'serif',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 20,
    color: '#7a5a30',
    padding: '0 4px',
    lineHeight: 1,
    fontWeight: 'bold',
  },
  canvasWrapper: {
    padding: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  canvas: {
    borderRadius: 3,
    display: 'block',
  },
  footer: {
    padding: '6px 12px',
    borderTop: '1px solid #d4b896',
    textAlign: 'center',
  },
  footerText: {
    fontSize: 11,
    color: '#6a4a20',
    fontStyle: 'italic',
  },
};
