import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CityCharacter } from '../lib/citychars';
import type { CharacterSpellcasting, Spell, SpellSchool } from '../lib/fantasy';

interface SpellPopupProps {
  isOpen: boolean;
  character: CityCharacter | null;
  onClose: () => void;
}

type Tab = 'slots' | 'known';

const SCHOOL_COLORS: Record<SpellSchool, string> = {
  abjuration:    '#3a6a8a',
  conjuration:   '#4a7a4a',
  divination:    '#3a8aa0',
  enchantment:   '#8a4a8a',
  evocation:     '#943030',
  illusion:      '#6a4a8a',
  necromancy:    '#3a3a3a',
  transmutation: '#a08030',
};

function schoolBadge(school: SpellSchool): string {
  return school[0].toUpperCase() + school.slice(1);
}

function abilityShort(ab: string): string {
  switch (ab) {
    case 'strength':     return 'STR';
    case 'dexterity':    return 'DEX';
    case 'constitution': return 'CON';
    case 'intelligence': return 'INT';
    case 'wisdom':       return 'WIS';
    case 'charisma':     return 'CHA';
    default:             return ab.toUpperCase();
  }
}

const MAX_SPELL_LEVEL_TO_SHOW = 9;

/**
 * Modal showing the spell book / spell slot tables for a single character.
 * Two tabs:
 *
 *   • "Slots" — per spell level: how many spells per day the character can
 *     cast, and (for prepared casters) the memorized spell list.
 *   • "Known" — flat list of spells known per level. For full-list casters
 *     (cleric / druid / paladin / ranger) this is the entire class list at
 *     each spell level the character can cast.
 *
 * One pair of tabs per spellcasting class on the character (bards casting
 * one list, multiclass wizard/cleric showing two stacked sections, etc).
 * Non-spellcasters see an explanatory empty state.
 */
export function SpellPopup({ isOpen, character, onClose }: SpellPopupProps) {
  const [tab, setTab] = useState<Tab>('slots');
  useEffect(() => {
    if (!isOpen) setTab('slots');
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen || !character) return null;

  const spellcasting = character.spellcasting ?? [];
  const hasAnyCasting = spellcasting.some(sc =>
    sc.slotsPerLevel.some(n => n > 0) || sc.spellsKnown.length > 0,
  );

  return createPortal(
    <>
      <div style={styles.backdrop} onClick={onClose} />
      <div
        style={styles.container}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="spell-popup-title"
      >
        <div style={styles.header}>
          <div style={styles.titleBlock}>
            <span id="spell-popup-title" style={styles.title}>{character.name}</span>
            <span style={styles.subtitle}>Spells</span>
          </div>
          <button style={styles.closeBtn} onClick={onClose} title="Close (Esc)">&times;</button>
        </div>

        <div style={styles.tabBar} role="tablist">
          <TabButton label="Slots" active={tab === 'slots'} onClick={() => setTab('slots')} />
          <TabButton label="Known" active={tab === 'known'} onClick={() => setTab('known')} />
        </div>

        <div style={styles.body}>
          {!hasAnyCasting && (
            <div style={styles.empty}>
              {character.pcClass.charAt(0).toUpperCase() + character.pcClass.slice(1)}s
              {' '}of this level cast no spells.
            </div>
          )}
          {hasAnyCasting && spellcasting.map((sc, i) => (
            <ClassSection
              key={`${sc.pcClass}-${i}`}
              sc={sc}
              tab={tab}
            />
          ))}
        </div>
      </div>
    </>,
    document.body,
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        ...styles.tabButton,
        ...(active ? styles.tabButtonActive : {}),
      }}
    >
      {label}
    </button>
  );
}

function ClassSection({ sc, tab }: { sc: CharacterSpellcasting; tab: Tab }) {
  const totalSlots = sc.slotsPerLevel.reduce((a, b) => a + b, 0);
  if (totalSlots === 0 && sc.spellsKnown.length === 0) {
    return (
      <div style={styles.classSection}>
        <ClassHeader sc={sc} />
        <div style={styles.empty}>No spells available at this level.</div>
      </div>
    );
  }

  // Show all spell levels the character can cast (slots > 0) plus any spell
  // levels where they know a spell (covers the wizard's level-0 free
  // cantrips even though the engine has none defined yet in v1).
  const maxRowFromSlots = sc.slotsPerLevel.length;
  const maxRowFromKnown = sc.spellsKnown.reduce((m, s) => Math.max(m, s.level + 1), 0);
  const rowCount = Math.min(MAX_SPELL_LEVEL_TO_SHOW + 1, Math.max(maxRowFromSlots, maxRowFromKnown));

  return (
    <div style={styles.classSection}>
      <ClassHeader sc={sc} />
      {tab === 'slots' && (
        <SlotsTable sc={sc} rowCount={rowCount} />
      )}
      {tab === 'known' && (
        <KnownTable sc={sc} rowCount={rowCount} />
      )}
    </div>
  );
}

function ClassHeader({ sc }: { sc: CharacterSpellcasting }) {
  return (
    <div style={styles.classHeader}>
      <span style={styles.className}>
        {sc.pcClass.charAt(0).toUpperCase() + sc.pcClass.slice(1)}
      </span>
      <span style={styles.classMeta}>
        {sc.prepared ? 'Prepared' : 'Spontaneous'} · {abilityShort(sc.ability)}
      </span>
    </div>
  );
}

function SlotsTable({ sc, rowCount }: { sc: CharacterSpellcasting; rowCount: number }) {
  return (
    <div style={styles.levelList}>
      {Array.from({ length: rowCount }, (_, lvl) => {
        const slots = sc.slotsPerLevel[lvl] ?? 0;
        const memorized = sc.memorizedPerLevel[lvl] ?? [];
        const showRow = slots > 0 || memorized.length > 0;
        if (!showRow) return null;
        return (
          <div key={lvl} style={styles.levelRow}>
            <div style={styles.levelHeaderRow}>
              <span style={styles.levelLabel}>
                {lvl === 0 ? 'Cantrips' : `Level ${lvl}`}
              </span>
              <span style={styles.slotsCount}>
                {slots} per day
              </span>
            </div>
            {sc.prepared && (
              <SpellList
                spells={memorized}
                emptyLabel={slots === 0 ? null : 'Unprepared'}
              />
            )}
            {!sc.prepared && slots > 0 && (
              <div style={styles.spontaneousNote}>
                Cast spontaneously from spells known.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function KnownTable({ sc, rowCount }: { sc: CharacterSpellcasting; rowCount: number }) {
  return (
    <div style={styles.levelList}>
      {Array.from({ length: rowCount }, (_, lvl) => {
        const known = sc.spellsKnown.filter(s => s.level === lvl);
        const slots = sc.slotsPerLevel[lvl] ?? 0;
        if (known.length === 0 && slots === 0) return null;
        return (
          <div key={lvl} style={styles.levelRow}>
            <div style={styles.levelHeaderRow}>
              <span style={styles.levelLabel}>
                {lvl === 0 ? 'Cantrips' : `Level ${lvl}`}
              </span>
              <span style={styles.slotsCount}>
                {known.length} known
              </span>
            </div>
            <SpellList
              spells={known}
              emptyLabel={slots > 0 ? 'No spells of this level on the list yet.' : null}
            />
          </div>
        );
      })}
    </div>
  );
}

function SpellList({ spells, emptyLabel }: { spells: Spell[]; emptyLabel: string | null }) {
  if (spells.length === 0) {
    if (emptyLabel == null) return null;
    return <div style={styles.empty}>{emptyLabel}</div>;
  }
  return (
    <div style={styles.spellList}>
      {spells.map((s, i) => (
        <div key={i} style={styles.spellRow}>
          <span style={styles.spellName}>{s.name}</span>
          <span style={{ ...styles.spellSchool, color: SCHOOL_COLORS[s.school] }}>
            {schoolBadge(s.school)}
          </span>
        </div>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(30, 20, 10, 0.55)',
    zIndex: 10010,
  },
  container: {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 'min(420px, calc(100vw - 32px))',
    maxHeight: 'calc(100vh - 64px)',
    background: '#f5e9c8',
    border: '2px solid #8a6a3a',
    borderRadius: 6,
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    zIndex: 10011,
    fontFamily: 'inherit',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '10px 14px',
    borderBottom: '1px solid #c8a868',
    background: 'linear-gradient(180deg, #efe0b5 0%, #e6d5a3 100%)',
    gap: 10,
  },
  titleBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: 700,
    color: '#2a1a00',
    fontFamily: 'Georgia, serif',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  subtitle: {
    fontSize: 11,
    color: '#5a3a10',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontWeight: 600,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 22,
    lineHeight: 1,
    color: '#5a3a10',
    padding: '0 4px',
    flexShrink: 0,
  },
  tabBar: {
    display: 'flex',
    gap: 0,
    padding: '0 10px',
    borderBottom: '1px solid #c8a868',
    background: '#ede0bb',
  },
  tabButton: {
    background: 'none',
    border: 'none',
    padding: '8px 14px',
    fontSize: 12,
    fontWeight: 600,
    color: '#7a5a30',
    cursor: 'pointer',
    borderBottom: '2px solid transparent',
    fontFamily: 'inherit',
  },
  tabButtonActive: {
    color: '#2a1a00',
    borderBottom: '2px solid #8a6a3a',
  },
  body: {
    padding: '12px 14px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  empty: {
    fontSize: 12,
    fontStyle: 'italic',
    color: '#7a5a30',
    padding: '4px 2px',
  },
  classSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  classHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingBottom: 4,
    borderBottom: '1px solid #d4b896',
  },
  className: {
    fontSize: 13,
    fontWeight: 700,
    color: '#2a1a00',
    fontFamily: 'Georgia, serif',
    textTransform: 'capitalize',
  },
  classMeta: {
    fontSize: 10,
    color: '#7a5a30',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: 600,
  },
  levelList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  levelRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    background: '#ede0bb',
    border: '1px solid #c8a868',
    borderRadius: 4,
    padding: '6px 10px',
  },
  levelHeaderRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  levelLabel: {
    fontSize: 12,
    fontWeight: 700,
    color: '#2a1a00',
  },
  slotsCount: {
    fontSize: 11,
    color: '#5a3a10',
    fontWeight: 600,
  },
  spellList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  spellRow: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 8,
    alignItems: 'baseline',
    padding: '3px 4px',
    fontSize: 12,
    color: '#2a1a00',
    borderBottom: '1px dotted rgba(138, 106, 58, 0.3)',
  },
  spellName: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  spellSchool: {
    fontSize: 10,
    fontStyle: 'italic',
    fontWeight: 600,
  },
  spontaneousNote: {
    fontSize: 11,
    fontStyle: 'italic',
    color: '#7a5a30',
  },
};
