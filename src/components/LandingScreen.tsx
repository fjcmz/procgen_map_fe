import { useState } from 'react';

interface LandingScreenProps {
  onPick: (target: 'planet' | 'universe') => void;
}

export function LandingScreen({ onPick }: LandingScreenProps) {
  const [hovered, setHovered] = useState<'planet' | 'universe' | null>(null);

  const buttonStyle = (key: 'planet' | 'universe'): React.CSSProperties => ({
    ...styles.btn,
    transform: hovered === key ? 'translateY(-3px)' : 'translateY(0)',
    boxShadow:
      hovered === key
        ? '0 8px 22px rgba(0,0,0,0.45)'
        : '0 4px 14px rgba(0,0,0,0.35)',
  });

  return (
    <div style={styles.wrap}>
      <div style={styles.content}>
        <h1 style={styles.title}>Procgen Map</h1>
        <p style={styles.subtitle}>Choose a generation mode</p>
        <div style={styles.row}>
          <button
            style={buttonStyle('planet')}
            onMouseEnter={() => setHovered('planet')}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onPick('planet')}
          >
            <span style={styles.btnTitle}>Planet generation</span>
            <span style={styles.btnDesc}>
              Generate a procedural fantasy world with terrain, biomes, rivers,
              and an optional 5000-year history of countries, wars, and empires.
            </span>
          </button>
          <button
            style={buttonStyle('universe')}
            onMouseEnter={() => setHovered('universe')}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onPick('universe')}
          >
            <span style={styles.btnTitle}>Universe generation</span>
            <span style={styles.btnDesc}>
              Generate a procedural universe of stars, planets, and the spaces
              between them.
            </span>
          </button>
        </div>
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
    fontFamily: 'Georgia, serif',
    overflow: 'auto',
    WebkitOverflowScrolling: 'touch',
    zIndex: 100,
  },
  content: {
    minHeight: '100%',
    boxSizing: 'border-box',
    padding: 'min(24px, 4vw)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'min(40px, 6vw)',
  },
  title: {
    fontSize: 'min(56px, 11vw)',
    margin: 0,
    letterSpacing: 2,
    color: '#f5e9c8',
    textShadow: '0 2px 8px rgba(0,0,0,0.6)',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 'min(18px, 4vw)',
    margin: 0,
    color: '#c9b48a',
    fontStyle: 'italic',
    textAlign: 'center',
  },
  row: {
    width: '100%',
    maxWidth: 640,
    display: 'flex',
    flexWrap: 'nowrap',
    gap: 'min(32px, 4vw)',
    justifyContent: 'center',
    alignItems: 'stretch',
  },
  btn: {
    flex: '1 1 0',
    minWidth: 0,
    maxWidth: 280,
    minHeight: 'min(360px, 60vh)',
    padding: 'min(32px, 5vw) min(24px, 4vw)',
    background: 'rgba(255,248,230,0.93)',
    border: '2px solid #8b6040',
    borderRadius: 10,
    fontFamily: 'Georgia, serif',
    color: '#3a1a00',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'min(18px, 3vw)',
    transition: 'transform 140ms ease-out, box-shadow 140ms ease-out',
    textAlign: 'center',
  },
  btnTitle: {
    fontSize: 'min(28px, 5.5vw)',
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  btnDesc: {
    fontSize: 'min(15px, 3.4vw)',
    lineHeight: 1.5,
    color: '#5a3a1a',
    fontStyle: 'italic',
    maxWidth: 240,
  },
};
