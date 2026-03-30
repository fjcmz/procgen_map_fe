interface ZoomControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

export function ZoomControls({ onZoomIn, onZoomOut, onReset }: ZoomControlsProps) {
  return (
    <div style={styles.wrap}>
      <button style={styles.btn} onClick={onZoomIn} title="Zoom in">+</button>
      <button style={styles.btn} onClick={onReset} title="Reset zoom">⌂</button>
      <button style={styles.btn} onClick={onZoomOut} title="Zoom out">−</button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    position: 'fixed',
    bottom: 16,
    right: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    zIndex: 10,
  },
  btn: {
    width: 36,
    height: 36,
    background: 'rgba(255,248,230,0.93)',
    border: '1.5px solid #8b6040',
    borderRadius: 6,
    fontFamily: 'Georgia, serif',
    fontSize: 18,
    color: '#3a1a00',
    cursor: 'pointer',
    boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    userSelect: 'none',
  },
};
