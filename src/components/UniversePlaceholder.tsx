export function UniversePlaceholder() {
  return (
    <div style={styles.wrap}>
      <div style={styles.message}>Universe generation coming soon</div>
      <div style={styles.hint}>
        Press the browser back button to return to the start screen.
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    position: 'fixed',
    inset: 0,
    background: '#1a1209',
    color: '#f5e9c8',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'Georgia, serif',
    padding: 24,
    boxSizing: 'border-box',
    zIndex: 100,
    gap: 18,
  },
  message: {
    fontSize: 36,
    letterSpacing: 1,
    textAlign: 'center',
    textShadow: '0 2px 8px rgba(0,0,0,0.6)',
  },
  hint: {
    fontSize: 14,
    color: '#c9b48a',
    fontStyle: 'italic',
    textAlign: 'center',
  },
};
