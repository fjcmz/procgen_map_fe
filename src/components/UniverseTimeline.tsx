import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { UniverseHistoryData } from '../lib/universe/types';
import { Draggable } from './Draggable';

interface UniverseTimelineProps {
  history: UniverseHistoryData;
  selectedStep: number;
  onStepChange: (step: number) => void;
}

const PLAY_INTERVAL_MS = 80;

function formatStepLabel(step: number, numSteps: number): string {
  return `${step} / ${numSteps - 1} (${step} My)`;
}

/**
 * Universe-history scrubber. Mirrors {@link Timeline} for the world-history
 * panel — same layout (header + slider + ±1/±10/±100 buttons + play/pause).
 * Each step represents 1 million years of universe age. Only mounted when
 * the universe was generated with `generateHistory=true`.
 */
export function UniverseTimeline({ history, selectedStep, onStepChange }: UniverseTimelineProps) {
  const [playing, setPlaying] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxStep = Math.max(0, history.numSteps - 1);

  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(() => {
        onStepChange(selectedStep + 1);
      }, PLAY_INTERVAL_MS);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [playing, selectedStep, onStepChange]);

  useEffect(() => {
    if (selectedStep >= maxStep && playing) setPlaying(false);
  }, [selectedStep, maxStep, playing]);

  const clampStep = useCallback((s: number) => Math.max(0, Math.min(maxStep, s)), [maxStep]);

  const step = useCallback((delta: number) => {
    setPlaying(false);
    onStepChange(clampStep(selectedStep + delta));
  }, [selectedStep, clampStep, onStepChange]);

  const togglePlay = useCallback(() => {
    if (selectedStep >= maxStep) {
      onStepChange(0);
      setPlaying(true);
    } else {
      setPlaying(p => !p);
    }
  }, [selectedStep, maxStep, onStepChange]);

  const lifeBodyCount = Object.keys(history.lifeAdvancesByBody).length;
  const eventsSoFar = history.events.reduce((n, e) => (e.step <= selectedStep ? n + 1 : n), 0);

  // Civ stats at the selected step. Walk events once; cheap even for huge
  // simulations since the events list is already bounded by step cadence.
  const civStats = (() => {
    let civsFounded = 0;
    let outposts = 0;
    let colonies = 0;
    let terraformsInProgress = 0;
    let terraformsCompleted = 0;
    for (const e of history.events) {
      if (e.step > selectedStep) break;
      if (e.type === 'CIV_FOUNDED') civsFounded += 1;
      else if (e.type === 'OUTPOST_ESTABLISHED') outposts += 1;
      else if (e.type === 'COLONY_FOUNDED') colonies += 1;
      else if (e.type === 'TERRAFORM_STARTED') terraformsInProgress += 1;
      else if (e.type === 'TERRAFORM_COMPLETED') {
        terraformsInProgress -= 1;
        terraformsCompleted += 1;
      }
    }
    return { civsFounded, outposts, colonies, terraformsInProgress, terraformsCompleted };
  })();

  return (
    <Draggable
      defaultPosition={{ bottom: 16, left: '50%' }}
      style={{ zIndex: 10 }}
      baseTransform="translateX(-50%)"
    >
      <div style={styles.panel}>
        <div style={styles.header} data-drag-handle>
          <span style={styles.title}>Universe Age</span>
          <span style={styles.info}>
            {formatStepLabel(selectedStep, history.numSteps)} &middot; {eventsSoFar} event{eventsSoFar === 1 ? '' : 's'} &middot; {lifeBodyCount} living world{lifeBodyCount === 1 ? '' : 's'}
          </span>
        </div>
        {civStats.civsFounded > 0 && (
          <div style={styles.civStats}>
            <span>{civStats.civsFounded} civilisation{civStats.civsFounded === 1 ? '' : 's'}</span>
            <span>&middot;</span>
            <span>{civStats.outposts} outpost{civStats.outposts === 1 ? '' : 's'}</span>
            <span>&middot;</span>
            <span>{civStats.colonies} colon{civStats.colonies === 1 ? 'y' : 'ies'}</span>
            <span>&middot;</span>
            <span>{civStats.terraformsCompleted} terraformed</span>
            {civStats.terraformsInProgress > 0 && (
              <>
                <span>&middot;</span>
                <span>{civStats.terraformsInProgress} in progress</span>
              </>
            )}
          </div>
        )}

        <div style={styles.sliderRow}>
          <span style={styles.stepLabel}>0 My</span>
          <input
            type="range"
            min={0}
            max={maxStep}
            value={selectedStep}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setPlaying(false);
              onStepChange(Number(e.target.value));
            }}
            style={styles.slider}
          />
          <span style={styles.stepLabel}>{maxStep} My</span>
        </div>

        <div style={styles.controls}>
          <button style={styles.btn} onClick={() => step(-100)} title="Back 100 million years">&laquo; 100</button>
          <button style={styles.btn} onClick={() => step(-10)} title="Back 10 million years">&laquo; 10</button>
          <button style={styles.btn} onClick={() => step(-1)} title="Back 1 million years">&lsaquo; 1</button>
          <button style={{ ...styles.btn, ...styles.playBtn }} onClick={togglePlay} title={playing ? 'Pause' : 'Play'}>
            {playing ? '⏸' : '▶'}
          </button>
          <button style={styles.btn} onClick={() => step(1)} title="Forward 1 million years">1 &rsaquo;</button>
          <button style={styles.btn} onClick={() => step(10)} title="Forward 10 million years">10 &raquo;</button>
          <button style={styles.btn} onClick={() => step(100)} title="Forward 100 million years">100 &raquo;</button>
        </div>
      </div>
    </Draggable>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    width: 620,
    maxWidth: 'calc(100vw - 32px)',
    background: 'rgba(20,18,40,0.92)',
    border: '1.5px solid #6c7ab8',
    borderRadius: 8,
    padding: '10px 16px',
    fontFamily: 'Georgia, serif',
    fontSize: 13,
    color: '#e8e8ff',
    boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    userSelect: 'none',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    cursor: 'grab',
    touchAction: 'none',
  },
  title: {
    fontWeight: 'bold',
    fontSize: 13,
    color: '#dde0ff',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  info: {
    fontSize: 11,
    color: '#a0a8d0',
    flex: 1,
    textAlign: 'center',
  },
  civStats: {
    display: 'flex',
    gap: 6,
    justifyContent: 'center',
    fontSize: 11,
    color: '#a0a8d0',
    flexWrap: 'wrap',
  },
  sliderRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  slider: {
    flex: 1,
    accentColor: '#7a88c8',
    cursor: 'pointer',
  },
  stepLabel: {
    fontSize: 11,
    color: '#a0a8d0',
    whiteSpace: 'nowrap',
  },
  controls: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  btn: {
    background: 'rgba(108,122,184,0.18)',
    border: '1px solid #6c7ab8',
    borderRadius: 4,
    padding: '4px 10px',
    fontFamily: 'Georgia, serif',
    fontSize: 12,
    color: '#dde0ff',
    cursor: 'pointer',
    minWidth: 44,
    textAlign: 'center',
  },
  playBtn: {
    fontSize: 16,
    padding: '4px 14px',
    minWidth: 48,
    background: 'rgba(108,122,184,0.32)',
  },
};
