import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CityCharacter, CharacterAffiliation } from '../lib/citychars';
import { alignmentBadge, raceLabel } from '../lib/citychars';
import { abilityMod } from '../lib/fantasy/Ability';
import type { Ability } from '../lib/fantasy/Ability';
import type { DerivedStat, BonusComponent, BonusType } from '../lib/fantasy/Combat';
import type { DistrictType, LandmarkKind } from '../lib/citymap';
import { SpellPopup } from './SpellPopup';

// Human-readable label for the affiliation's role / kind. Mirrors the
// DISTRICT_ROLE_INFO / LANDMARK_KIND_INFO labels in `CityMapPopupV2.tsx` so
// the wording in the character sheet matches the city-map tooltip the user
// just saw.
const DISTRICT_LABELS: Record<DistrictType, string> = {
  civic:              'Civic Centre',
  market:             'Market',
  harbor:             'Harbour',
  residential_high:   'Wealthy Residential',
  residential_medium: 'Residential',
  residential_low:    'Poor Residential',
  agricultural:       'Fields',
  slum:               'Slums',
  dock:               'Docks',
  industry:           'Industry Quarter',
  education_faith:    'Education & Faith',
  military:           'Military Quarter',
  trade:              'Trade Quarter',
  entertainment:      'Entertainment Quarter',
  excluded:           'Excluded Zone',
};

const LANDMARK_LABELS: Record<LandmarkKind, string> = {
  wonder:          'Wonder',
  palace:          'Palace',
  castle:          'Castle',
  civic_square:    'Civic Square',
  temple:          'Temple',
  market:          'Market',
  park:            'Park',
  forge:           'Forge',
  tannery:         'Tannery',
  textile:         'Textile Quarter',
  potters:         'Potters Quarter',
  mill:            'Mill',
  barracks:        'Barracks',
  citadel:         'Citadel',
  arsenal:         'Arsenal',
  watchmen:        'Watchmen Precinct',
  temple_quarter:  'Temple Quarter',
  necropolis:      'Necropolis',
  plague_ward:     'Plague Ward',
  academia:        'Academia',
  archive:         'Archive',
  theater:         'Theatre District',
  bathhouse:       'Bathhouse Quarter',
  pleasure:        'Pleasure Quarter',
  festival:        'Festival Grounds',
  foreign_quarter: 'Foreign Quarter',
  caravanserai:    'Caravanserai',
  bankers_row:     "Bankers' Row",
  warehouse:       'Warehouse Row',
  gallows:         'Gallows Hill',
  workhouse:       'Workhouse',
  ghetto_marker:   'Ghetto',
};

function affiliationKindLabel(a: CharacterAffiliation): string {
  if (a.kind === 'block' && a.role) return DISTRICT_LABELS[a.role];
  if (a.kind === 'landmark' && a.landmarkKind) return LANDMARK_LABELS[a.landmarkKind];
  return a.kind === 'block' ? 'District' : 'Landmark';
}

interface CharacterPopupProps {
  isOpen: boolean;
  character: CityCharacter | null;
  cityName?: string;
  onClose: () => void;
  /**
   * The full roster the displayed character was rolled with — used to
   * resolve relationship `targetIndex`es into clickable links. When
   * absent, the relationships section still renders the names but each
   * row is non-interactive.
   */
  roster?: CityCharacter[];
  /**
   * Called when the user clicks a relationship row. Switching the popup's
   * `character` prop to the related character is the parent's job — the
   * popup just bubbles the selection up.
   */
  onSelectCharacter?: (c: CityCharacter) => void;
}

const ABILITY_LABELS: Record<Ability, string> = {
  strength: 'STR',
  dexterity: 'DEX',
  constitution: 'CON',
  intelligence: 'INT',
  wisdom: 'WIS',
  charisma: 'CHA',
};

const ABILITY_ORDER: Ability[] = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];

function fmtMod(score: number): string {
  const mod = abilityMod(score);
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

function fmtHeight(inches: number): string {
  // Inches → ft' in" (D&D 3.5e tables ship inches).
  const ft = Math.floor(inches / 12);
  const inch = Math.round(inches - ft * 12);
  return `${ft}'${inch}"`;
}

/**
 * Lightweight modal showing the full character sheet for a single PC. Opened
 * by clicking the name column in the DetailsTab character roster. Closes on
 * backdrop click, ESC, or the × button.
 */
export function CharacterPopup({ isOpen, character, cityName, onClose, roster, onSelectCharacter }: CharacterPopupProps) {
  // Active breakdown sub-popup: 'bab' | 'ac' | 'fortitude' | 'reflex' | 'will'
  // (or null when none open). Reset whenever the popup closes or the
  // displayed character switches.
  const [breakdownKey, setBreakdownKey] = useState<CombatBreakdownKey | null>(null);
  // Spell popup visibility — opened by the Spells button below the combat
  // grid. Resets together with the breakdown popup so switching characters
  // never leaves a stale popup on screen.
  const [spellsOpen, setSpellsOpen] = useState(false);
  useEffect(() => {
    if (!isOpen) {
      setBreakdownKey(null);
      setSpellsOpen(false);
    }
  }, [isOpen]);
  useEffect(() => {
    setBreakdownKey(null);
    setSpellsOpen(false);
  }, [character]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // ESC closes the breakdown first if one's open, then the main popup.
        if (breakdownKey) setBreakdownKey(null);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, breakdownKey]);

  if (!isOpen || !character) return null;

  const c = character;
  const alignmentColor =
    c.alignment.endsWith('_good') ? '#4a7a4a' :
    c.alignment.endsWith('_evil') ? '#943030' :
    '#5a3a10';

  return createPortal(
    <>
      <div style={styles.backdrop} onClick={onClose} />
      <div style={styles.container} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="character-popup-title">
        <div style={styles.header}>
          <div style={styles.titleBlock}>
            <span id="character-popup-title" style={styles.title}>{c.name}</span>
            <span style={styles.subtitle}>
              Level {c.level} {raceLabel(c.race)} <span style={{ textTransform: 'capitalize' }}>{c.pcClass}</span>
              {cityName && <span style={styles.subtitleDim}> — {cityName}</span>}
            </span>
          </div>
          <button style={styles.closeBtn} onClick={onClose} title="Close (Esc)">&times;</button>
        </div>

        <div style={styles.body}>
          {/* Identity strip — alignment, deity */}
          <div style={styles.identityStrip}>
            <div style={styles.identityCell}>
              <div style={styles.identityLabel}>Alignment</div>
              <div style={{ ...styles.identityValue, color: alignmentColor }}>
                {alignmentBadge(c.alignment)}
                <span style={styles.identityValueDim}>
                  {' '}{c.alignment.replace(/_/g, ' ')}
                </span>
              </div>
            </div>
            <div style={styles.identityCell}>
              <div style={styles.identityLabel}>Deity</div>
              <div style={styles.identityValue}>
                {c.deity === 'none' ? <span style={styles.identityValueDim}>none</span> : c.deity}
              </div>
            </div>
            <div style={styles.identityCell}>
              <div style={styles.identityLabel}>Hit Points</div>
              <div style={styles.identityValue}>{c.hitPoints}</div>
            </div>
          </div>

          {/* District / quarter affiliation — populated when the V2 city map
              data was available at roster-roll time (DetailsTab passes it in
              once Quarters / Characters / Map V2 has been touched). */}
          {c.affiliation && (
            <div style={styles.affiliationRow}>
              <span style={styles.affiliationLabel}>From</span>
              <span style={styles.affiliationName}>{c.affiliation.name}</span>
              <span style={styles.affiliationKind}>
                {affiliationKindLabel(c.affiliation)}
              </span>
            </div>
          )}

          {/* Abilities — 6-column grid with score + modifier */}
          <div style={styles.sectionLabel}>Abilities</div>
          <div style={styles.abilityGrid}>
            {ABILITY_ORDER.map(a => {
              const score = c.abilities[a] ?? 10;
              return (
                <div key={a} style={styles.abilityCell}>
                  <div style={styles.abilityLabel}>{ABILITY_LABELS[a]}</div>
                  <div style={styles.abilityScore}>{score}</div>
                  <div style={styles.abilityMod}>{fmtMod(score)}</div>
                </div>
              );
            })}
          </div>

          {/* Combat — BAB / AC / saves. Each card opens a breakdown sub-popup. */}
          <div style={styles.sectionLabel}>Combat</div>
          <div style={styles.combatGrid}>
            <CombatCell label="BAB"  total={c.combat.bab.total}            onClick={() => setBreakdownKey('bab')} />
            <CombatCell label="AC"   total={c.combat.ac.total}             onClick={() => setBreakdownKey('ac')} />
            <CombatCell label="Fort" total={c.combat.saves.fortitude.total} onClick={() => setBreakdownKey('fortitude')} />
            <CombatCell label="Ref"  total={c.combat.saves.reflex.total}    onClick={() => setBreakdownKey('reflex')} />
            <CombatCell label="Will" total={c.combat.saves.will.total}      onClick={() => setBreakdownKey('will')} />
          </div>

          {/* Spells button — opens the dedicated SpellPopup (slots + known
              spells). Always rendered so non-spellcasters can confirm they
              have no spells; the popup itself shows an explanatory empty
              state when `spellcasting` is empty. */}
          <button
            type="button"
            style={styles.spellsBtn}
            onClick={() => setSpellsOpen(true)}
            title="Open spell book"
          >
            Spells
          </button>

          {/* Vitals — age + size + wealth */}
          <div style={styles.sectionLabel}>Vitals</div>
          <div style={styles.vitalsGrid}>
            <VitalRow label="Age" value={`${c.age.currentAge} yrs`} />
            <VitalRow label="Height" value={fmtHeight(c.height)} />
            <VitalRow label="Weight" value={`${c.weight} lb`} />
            <VitalRow label="Wealth" value={`${c.wealth.toLocaleString('en-US')} gp`} />
          </div>

          {/* Age stages — small reference for D&D 3.5e age penalties. */}
          <div style={styles.sectionLabel}>Lifespan</div>
          <div style={styles.lifespanGrid}>
            <LifespanCell label="Middle" age={c.age.middleAge} current={c.age.currentAge} />
            <LifespanCell label="Old" age={c.age.oldAge} current={c.age.currentAge} />
            <LifespanCell label="Venerable" age={c.age.venerableAge} current={c.age.currentAge} />
            <LifespanCell label="Max" age={c.age.maxAge} current={c.age.currentAge} />
          </div>

          {/* Connections — bidirectional links to other roster members. Each
              row is a button that re-opens this popup with the related
              character (parent flips `selectedCharacter`). Falls through
              silently when nobody connected to this character. */}
          {c.relationships && c.relationships.length > 0 && (
            <>
              <div style={styles.sectionLabel}>Connections ({c.relationships.length})</div>
              <div style={styles.connectionList}>
                {c.relationships.map((rel, i) => {
                  const target = roster ? roster[rel.targetIndex] : undefined;
                  const interactive = !!(target && onSelectCharacter);
                  return (
                    <button
                      key={i}
                      type="button"
                      style={{
                        ...styles.connectionRow,
                        cursor: interactive ? 'pointer' : 'default',
                        opacity: interactive ? 1 : 0.7,
                      }}
                      onClick={() => {
                        if (interactive && target) onSelectCharacter!(target);
                      }}
                      disabled={!interactive}
                      title={interactive ? `Open ${rel.targetName}'s sheet — ${rel.reason}` : rel.reason}
                    >
                      <span style={styles.connectionName}>{rel.targetName}</span>
                      <span style={styles.connectionReason}>{rel.reason}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Combat-stat breakdown sub-popup. Renders as a backdrop + card on
            top of the main character popup; closing it returns to the sheet. */}
        {breakdownKey && (
          <CombatBreakdown
            character={c}
            breakdownKey={breakdownKey}
            onClose={() => setBreakdownKey(null)}
          />
        )}
      </div>

      {/* Spell popup — mounted as a sibling to the character popup so its
          backdrop covers the whole viewport (not just the sheet). The
          character popup stays mounted underneath; closing the spell popup
          returns the user to the character sheet. */}
      <SpellPopup
        isOpen={spellsOpen}
        character={c}
        onClose={() => setSpellsOpen(false)}
      />
    </>,
    document.body,
  );
}

type CombatBreakdownKey = 'bab' | 'ac' | 'fortitude' | 'reflex' | 'will';

const BREAKDOWN_LABELS: Record<CombatBreakdownKey, string> = {
  bab:       'Base Attack Bonus',
  ac:        'Armor Class',
  fortitude: 'Fortitude Save',
  reflex:    'Reflex Save',
  will:      'Will Save',
};

const BONUS_TYPE_COLORS: Record<BonusType, string> = {
  base:        '#5a3a10',
  ability:     '#3a5a8a',
  size:        '#7a5a30',
  armor:       '#5a4a3a',
  shield:      '#5a4a3a',
  natural:     '#4a6a3a',
  dodge:       '#3a6a5a',
  deflection:  '#6a4a8a',
  enhancement: '#8a4a8a',
  resistance:  '#3a8a8a',
  racial:      '#8a5a3a',
  morale:      '#8a6a3a',
  luck:        '#3a8a5a',
  sacred:      '#a08030',
  profane:     '#80303a',
  insight:     '#3a8aa0',
  competence:  '#5a6a8a',
  magic:       '#7a3a8a',
  misc:        '#7a5a30',
};

function CombatCell({ label, total, onClick }: { label: string; total: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={styles.combatCell}
      title={`Click for ${label} breakdown`}
    >
      <div style={styles.combatLabel}>{label}</div>
      <div style={styles.combatTotal}>{formatSigned(total)}</div>
    </button>
  );
}

function CombatBreakdown({
  character,
  breakdownKey,
  onClose,
}: {
  character: CityCharacter;
  breakdownKey: CombatBreakdownKey;
  onClose: () => void;
}) {
  const stat: DerivedStat =
    breakdownKey === 'bab'       ? character.combat.bab :
    breakdownKey === 'ac'        ? character.combat.ac  :
    breakdownKey === 'fortitude' ? character.combat.saves.fortitude :
    breakdownKey === 'reflex'    ? character.combat.saves.reflex :
                                   character.combat.saves.will;
  return (
    <>
      <div style={styles.subBackdrop} onClick={onClose} />
      <div style={styles.subContainer} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div style={styles.subHeader}>
          <span style={styles.subTitle}>{BREAKDOWN_LABELS[breakdownKey]}</span>
          <button style={styles.closeBtn} onClick={onClose} title="Close (Esc)">&times;</button>
        </div>
        <div style={styles.subBody}>
          <div style={styles.subTotalRow}>
            <span style={styles.subTotalLabel}>Total</span>
            <span style={styles.subTotalValue}>{formatSigned(stat.total)}</span>
          </div>
          {stat.components.length === 0 ? (
            <div style={styles.subEmpty}>No contributions.</div>
          ) : (
            <div style={styles.subList}>
              {stat.components.map((bc, i) => (
                <BreakdownRow key={i} bc={bc} />
              ))}
            </div>
          )}
          <div style={styles.subFootnote}>
            Bonus types follow D&D 3.5e: same-type bonuses don't stack (only the largest applies);
            <em> dodge</em> and <em>untyped</em> bonuses do.
          </div>
        </div>
      </div>
    </>
  );
}

function BreakdownRow({ bc }: { bc: BonusComponent }) {
  return (
    <div style={styles.subRow}>
      <span style={styles.subRowSource}>{bc.source}</span>
      <span style={{ ...styles.subRowType, color: BONUS_TYPE_COLORS[bc.type] ?? '#7a5a30' }}>
        {bc.type}
      </span>
      <span style={styles.subRowValue}>{formatSigned(bc.value)}</span>
    </div>
  );
}

function formatSigned(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

function VitalRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.vitalCell}>
      <span style={styles.vitalLabel}>{label}</span>
      <span style={styles.vitalValue}>{value}</span>
    </div>
  );
}

function LifespanCell({ label, age, current }: { label: string; age: number; current: number }) {
  const reached = current >= age;
  return (
    <div style={{ ...styles.lifespanCell, opacity: reached ? 1 : 0.55 }}>
      <span style={styles.lifespanLabel}>{label}</span>
      <span style={{ ...styles.lifespanAge, fontWeight: reached ? 'bold' : 'normal' }}>{age}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(30, 20, 10, 0.55)',
    zIndex: 10000,
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
    zIndex: 10001,
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
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  subtitleDim: {
    color: '#9a7a50',
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
  body: {
    padding: '12px 14px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  identityStrip: {
    display: 'grid',
    gridTemplateColumns: '1.4fr 1fr 0.8fr',
    gap: 8,
    padding: '8px 10px',
    background: '#ede0bb',
    border: '1px solid #c8a868',
    borderRadius: 4,
  },
  identityCell: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  },
  identityLabel: {
    fontSize: 9,
    color: '#7a5a30',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: 600,
  },
  identityValue: {
    fontSize: 13,
    color: '#2a1a00',
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  identityValueDim: {
    fontSize: 11,
    color: '#9a7a50',
    fontWeight: 400,
    textTransform: 'capitalize',
  },
  sectionLabel: {
    fontSize: 10,
    color: '#7a5a30',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontWeight: 700,
    paddingBottom: 2,
    borderBottom: '1px solid #d4b896',
  },
  abilityGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(6, 1fr)',
    gap: 6,
  },
  abilityCell: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '6px 2px',
    background: '#ede0bb',
    border: '1px solid #c8a868',
    borderRadius: 4,
  },
  abilityLabel: {
    fontSize: 9,
    color: '#7a5a30',
    fontWeight: 600,
    letterSpacing: 0.5,
  },
  abilityScore: {
    fontSize: 17,
    fontWeight: 700,
    color: '#2a1a00',
    fontFamily: 'Georgia, serif',
    lineHeight: 1.2,
  },
  abilityMod: {
    fontSize: 11,
    color: '#5a3a10',
    fontWeight: 600,
  },
  vitalsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 4,
  },
  vitalCell: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 12,
    padding: '3px 6px',
  },
  vitalLabel: {
    color: '#7a5a30',
    fontWeight: 500,
  },
  vitalValue: {
    color: '#2a1a00',
    fontWeight: 600,
  },
  lifespanGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 4,
  },
  lifespanCell: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '4px 2px',
    fontSize: 11,
  },
  lifespanLabel: {
    color: '#7a5a30',
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    fontWeight: 600,
  },
  lifespanAge: {
    color: '#2a1a00',
    fontFamily: 'Georgia, serif',
    fontSize: 13,
  },
  affiliationRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    padding: '6px 10px',
    background: '#ede0bb',
    border: '1px solid #c8a868',
    borderRadius: 4,
    fontSize: 12,
    color: '#2a1a00',
    overflow: 'hidden',
  },
  affiliationLabel: {
    fontSize: 9,
    color: '#7a5a30',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: 600,
    flexShrink: 0,
  },
  affiliationName: {
    fontWeight: 700,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
    flexShrink: 1,
  },
  affiliationKind: {
    fontSize: 11,
    color: '#7a5a30',
    fontStyle: 'italic',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  connectionList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  connectionRow: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 8,
    alignItems: 'baseline',
    padding: '5px 10px',
    background: '#ede0bb',
    border: '1px solid #c8a868',
    borderRadius: 4,
    textAlign: 'left',
    font: 'inherit',
    color: '#2a1a00',
    width: '100%',
  },
  connectionName: {
    fontSize: 12,
    fontWeight: 600,
    color: '#2a1a00',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  connectionReason: {
    fontSize: 10,
    color: '#7a5a30',
    fontStyle: 'italic',
    textTransform: 'capitalize',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  combatGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gap: 6,
  },
  spellsBtn: {
    padding: '8px 12px',
    background: 'linear-gradient(180deg, #efe0b5 0%, #d8c285 100%)',
    border: '1px solid #8a6a3a',
    borderRadius: 4,
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
    fontSize: 13,
    fontWeight: 700,
    color: '#2a1a00',
    textAlign: 'center',
    width: '100%',
  },
  combatCell: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '6px 2px',
    background: '#ede0bb',
    border: '1px solid #c8a868',
    borderRadius: 4,
    cursor: 'pointer',
    font: 'inherit',
    color: 'inherit',
  },
  combatLabel: {
    fontSize: 9,
    color: '#7a5a30',
    fontWeight: 600,
    letterSpacing: 0.5,
  },
  combatTotal: {
    fontSize: 17,
    fontWeight: 700,
    color: '#2a1a00',
    fontFamily: 'Georgia, serif',
    lineHeight: 1.2,
  },
  subBackdrop: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(30, 20, 10, 0.45)',
    zIndex: 1,
  },
  subContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 'min(360px, calc(100% - 24px))',
    maxHeight: 'calc(100% - 24px)',
    background: '#f5e9c8',
    border: '2px solid #8a6a3a',
    borderRadius: 6,
    boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    zIndex: 2,
  },
  subHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    borderBottom: '1px solid #c8a868',
    background: 'linear-gradient(180deg, #efe0b5 0%, #e6d5a3 100%)',
  },
  subTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: '#2a1a00',
    fontFamily: 'Georgia, serif',
  },
  subBody: {
    padding: '10px 12px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  subTotalRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    padding: '6px 10px',
    background: '#ede0bb',
    border: '1px solid #c8a868',
    borderRadius: 4,
  },
  subTotalLabel: {
    fontSize: 10,
    color: '#7a5a30',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: 700,
  },
  subTotalValue: {
    fontSize: 18,
    fontWeight: 700,
    color: '#2a1a00',
    fontFamily: 'Georgia, serif',
  },
  subList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  subRow: {
    display: 'grid',
    gridTemplateColumns: '1fr auto auto',
    gap: 8,
    alignItems: 'baseline',
    padding: '4px 8px',
    fontSize: 12,
    color: '#2a1a00',
    borderBottom: '1px dotted rgba(138, 106, 58, 0.3)',
  },
  subRowSource: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  subRowType: {
    fontSize: 10,
    fontStyle: 'italic',
    textTransform: 'lowercase',
  },
  subRowValue: {
    fontFamily: 'Georgia, serif',
    fontWeight: 700,
    minWidth: 32,
    textAlign: 'right',
  },
  subEmpty: {
    fontSize: 11,
    fontStyle: 'italic',
    color: '#7a5a30',
    padding: '4px 8px',
  },
  subFootnote: {
    fontSize: 10,
    color: '#7a5a30',
    fontStyle: 'italic',
    paddingTop: 2,
    borderTop: '1px solid #d4b896',
  },
};
