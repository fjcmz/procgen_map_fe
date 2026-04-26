/**
 * Shared styling constants for overlay tabs.
 *
 * EVENT_ICONS / EVENT_COLORS are consumed by EventsTab.tsx.
 * TECH_FIELD_COLORS / TECH_FIELD_LABELS are consumed by TechTab.tsx.
 *
 * The `Record<TechField, string>` type on the tech maps enforces exhaustiveness
 * against the `TechField` union in `lib/types.ts` — adding a new field to the
 * union becomes a compile-time error here AND in the `TECH_FIELDS` local
 * constant in `HistoryGenerator.ts`. Keep both sites in sync. (spec stretch §5)
 */
import type { HistoryEventType, TechField } from '../../lib/types';

export const EVENT_ICONS: Record<string, string> = {
  WAR: '⚔️',
  CONQUEST: '🏴',
  MERGE: '🤝',
  COLLAPSE: '💀',
  EXPANSION: '📍',
  FOUNDATION: '🏗️',
  CONTACT: '📨',
  COUNTRY: '🏛️',
  ILLUSTRATE: '⭐',
  WONDER: '🏛',
  WONDER_DESTROYED: '💥',
  RELIGION: '☦️',
  TRADE: '💰',
  CATACLYSM: '🌋',
  TECH: '🔬',
  TECH_LOSS: '📚',
  EMPIRE: '👑',
  RUIN: '🏚️',
  TERRITORIAL_EXPANSION: '🧭',
  SETTLEMENT: '🏠',
  CITY_SETTLEMENT: '🏘️',
  POPULATION: '👥',
};

export const EVENT_COLORS: Record<string, string> = {
  WAR: '#c03020',
  CONQUEST: '#803020',
  MERGE: '#606060',
  COLLAPSE: '#404040',
  EXPANSION: '#407040',
  FOUNDATION: '#c07820',
  CONTACT: '#4080c0',
  COUNTRY: '#6040b0',
  ILLUSTRATE: '#a0a000',
  WONDER: '#d4a800',
  WONDER_DESTROYED: '#8b6508',
  RELIGION: '#8040a0',
  TRADE: '#20a040',
  CATACLYSM: '#d03010',
  TECH: '#208080',
  TECH_LOSS: '#a04040',
  EMPIRE: '#c08000',
  RUIN: '#888888',
  TERRITORIAL_EXPANSION: '#8B6914',
  SETTLEMENT: '#2E8B57',
  CITY_SETTLEMENT: '#A05C20',
  POPULATION: '#5a7a5a',
};

export const EVENT_TYPE_GROUPS: { label: string; types: HistoryEventType[] }[] = [
  { label: 'Civilization', types: ['FOUNDATION', 'CONTACT', 'COUNTRY', 'EMPIRE'] },
  { label: 'Culture',      types: ['ILLUSTRATE', 'WONDER', 'WONDER_DESTROYED', 'RELIGION', 'TECH', 'TECH_LOSS'] },
  { label: 'Economy',      types: ['TRADE'] },
  { label: 'Conflict',     types: ['WAR', 'CONQUEST'] },
  { label: 'Disasters',    types: ['CATACLYSM', 'COLLAPSE'] },
  { label: 'Expansion',    types: ['TERRITORIAL_EXPANSION', 'SETTLEMENT', 'CITY_SETTLEMENT'] },
  { label: 'Other',        types: ['MERGE', 'EXPANSION', 'RUIN'] },
];

export const TECH_FIELD_COLORS: Record<TechField, string> = {
  science: '#208080',     // teal (canonical tech color)
  military: '#c03020',    // red
  industry: '#d4a800',    // gold
  energy: '#e07020',      // orange
  growth: '#60a040',      // green
  exploration: '#4080c0', // blue
  biology: '#60c0a0',     // mint
  art: '#b060a0',         // magenta
  government: '#8060c0',  // purple
};

export const TECH_FIELD_LABELS: Record<TechField, string> = {
  science: 'Sci',
  military: 'Mil',
  industry: 'Ind',
  energy: 'Eng',
  growth: 'Grw',
  exploration: 'Exp',
  biology: 'Bio',
  art: 'Art',
  government: 'Gov',
};
