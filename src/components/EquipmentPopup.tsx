import { createPortal } from 'react-dom';
import type { CityCharacter } from '../lib/citychars';
import type { Equipment, EquipmentSlot } from '../lib/fantasy/Equipment';
import {
  SLOT_GROUPS,
  SLOT_LABELS,
  equipBonusSummary,
  formatCrit,
} from '../lib/fantasy/Equipment';
import { abilityMod } from '../lib/fantasy/Ability';

interface EquipmentPopupProps {
  isOpen: boolean;
  character: CityCharacter | null;
  onClose: () => void;
}

/**
 * Modal showing the full equipment loadout for a character. Opened by the
 * "Equipment" button in CharacterPopup. Groups slots into Worn / Weapons /
 * Utility Belt and shows each item's name and bonus summary.
 */
export function EquipmentPopup({ isOpen, character, onClose }: EquipmentPopupProps) {
  if (!isOpen || !character) return null;

  const eq = character.equipment;

  // Find primary combat weapon for the attack/damage summary line.
  const combatWeapon: Equipment | undefined =
    (eq.weapon1?.damage ? eq.weapon1 : undefined) ??
    (eq.weapon3?.damage ? eq.weapon3 : undefined);

  const weaponSummary = combatWeapon
    ? buildWeaponSummary(combatWeapon, character)
    : null;

  return createPortal(
    <>
      <div style={styles.backdrop} onClick={onClose} />
      <div
        style={styles.container}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${character.name}'s Equipment`}
      >
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.headerTitle}>
            <span style={styles.title}>Equipment</span>
            <span style={styles.subtitle}>{character.name}</span>
          </div>
          <button style={styles.closeBtn} onClick={onClose} title="Close (Esc)">&times;</button>
        </div>

        <div style={styles.body}>
          {/* Combat weapon summary bar */}
          {weaponSummary && (
            <div style={styles.weaponBar}>
              <span style={styles.weaponBarName}>{combatWeapon!.name}</span>
              <span style={styles.weaponBarStats}>
                <span style={styles.weaponBarAtk}>{weaponSummary.atk} to hit</span>
                <span style={styles.weaponBarSep}> · </span>
                <span style={styles.weaponBarDmg}>{weaponSummary.dmg} dmg</span>
                <span style={styles.weaponBarCrit}>{formatCrit(combatWeapon!.critRange, combatWeapon!.critMult)}</span>
              </span>
            </div>
          )}

          {/* Slot groups */}
          {SLOT_GROUPS.map(group => (
            <div key={group.label} style={styles.group}>
              <div style={styles.groupLabel}>{group.label}</div>
              <div style={styles.slotList}>
                {group.slots.map(slot => (
                  <SlotRow
                    key={slot}
                    slot={slot}
                    item={eq[slot]}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* Total equipment cost */}
          <div style={styles.footer}>
            <span style={styles.footerLabel}>Total value</span>
            <span style={styles.footerValue}>
              {totalCost(eq).toLocaleString('en-US')} gp
            </span>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SlotRow({ slot, item }: { slot: EquipmentSlot; item: Equipment | undefined }) {
  const label = SLOT_LABELS[slot];
  const hasItem = !!item;
  const summary = item ? equipBonusSummary(item) : '—';

  return (
    <div style={{ ...styles.slotBlock, opacity: hasItem ? 1 : 0.45 }}>
      <div style={styles.slotRow}>
        <span style={styles.slotLabel}>{label}</span>
        <span style={styles.slotName}>{item ? item.name : '—'}</span>
        <span style={{ ...styles.slotBonus, color: summary === '—' ? '#9a7a50' : '#2a5a2a' }}>
          {summary}
        </span>
      </div>
      {item?.description && (
        <div style={styles.slotDesc}>{item.description}</div>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildWeaponSummary(
  weapon: Equipment,
  char: CityCharacter,
): { atk: string; dmg: string } {
  const bab = char.combat.bab.total;
  const str = abilityMod(char.abilities.strength    ?? 10);
  const dex = abilityMod(char.abilities.dexterity   ?? 10);
  const abilityBonus = weapon.isRanged ? dex : str;
  const totalAtk = bab + abilityBonus;
  const atkStr = totalAtk >= 0 ? `+${totalAtk}` : `${totalAtk}`;

  // STR adds to melee damage (only if positive for thrown/ranged)
  const dmgBonus = weapon.isRanged ? 0 : str;
  const dmgStr = dmgBonus !== 0
    ? `${weapon.damage}${dmgBonus > 0 ? '+' : ''}${dmgBonus}`
    : weapon.damage ?? '—';

  return { atk: atkStr, dmg: dmgStr };
}

function totalCost(eq: CityCharacter['equipment']): number {
  return Object.values(eq).reduce((sum, item) => sum + (item?.price ?? 0), 0);
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(30, 20, 10, 0.45)',
    zIndex: 10002,
  },
  container: {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 'min(400px, calc(100vw - 32px))',
    maxHeight: 'calc(100vh - 64px)',
    background: '#f5e9c8',
    border: '2px solid #8a6a3a',
    borderRadius: 6,
    boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    zIndex: 10003,
    fontFamily: 'inherit',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '9px 14px',
    borderBottom: '1px solid #c8a868',
    background: 'linear-gradient(180deg, #efe0b5 0%, #e6d5a3 100%)',
  },
  headerTitle: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: 700,
    color: '#2a1a00',
    fontFamily: 'Georgia, serif',
  },
  subtitle: {
    fontSize: 11,
    color: '#7a5a30',
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
    overflowY: 'auto',
    flex: 1,
    padding: '10px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  weaponBar: {
    background: 'rgba(80,50,20,0.08)',
    border: '1px solid #c8a868',
    borderRadius: 4,
    padding: '6px 10px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  weaponBarName: {
    fontSize: 12,
    fontWeight: 700,
    color: '#2a1a00',
    fontFamily: 'Georgia, serif',
  },
  weaponBarStats: {
    fontSize: 11,
    color: '#3a2a10',
    display: 'flex',
    alignItems: 'center',
    gap: 2,
  },
  weaponBarAtk: {
    color: '#1a5a1a',
    fontWeight: 600,
  },
  weaponBarSep: {
    color: '#9a7a50',
  },
  weaponBarDmg: {
    color: '#8a1a1a',
    fontWeight: 600,
  },
  weaponBarCrit: {
    color: '#7a5a30',
  },
  group: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  groupLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: '#7a5a30',
    borderBottom: '1px solid #d8c090',
    paddingBottom: 2,
    marginBottom: 2,
  },
  slotList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
  },
  slotBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
  },
  slotRow: {
    display: 'grid',
    gridTemplateColumns: '72px 1fr auto',
    gap: 6,
    alignItems: 'baseline',
    padding: '2px 0',
    fontSize: 11,
  },
  slotDesc: {
    paddingLeft: 78,
    fontSize: 9,
    color: '#7a5a30',
    fontStyle: 'italic',
    lineHeight: 1.4,
    paddingBottom: 2,
  },
  slotLabel: {
    color: '#7a5a30',
    fontSize: 10,
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  slotName: {
    color: '#2a1a00',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  slotBonus: {
    fontSize: 10,
    whiteSpace: 'nowrap',
    textAlign: 'right',
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    borderTop: '1px solid #d8c090',
    paddingTop: 6,
    fontSize: 11,
    marginTop: 2,
  },
  footerLabel: {
    color: '#7a5a30',
  },
  footerValue: {
    color: '#2a1a00',
    fontWeight: 600,
  },
};
