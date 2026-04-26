/**
 * Phase 5 event type re-exports.
 *
 * Each type is defined in its own module with a corresponding generator.
 * This file re-exports the interfaces for convenience.
 */

export type { Foundation } from './Foundation';
export type { Contact } from './Contact';
export type { CountryEvent } from './Country';
export type { Illustrate } from './Illustrate';
export type { Wonder } from './Wonder';
export type { Religion } from './Religion';
export type { Trade } from './Trade';
export type { Cataclysm } from './Cataclysm';
export type { War } from './War';
export type { Tech } from './Tech';
export type { Conquer } from './Conquer';
export type { Empire } from './Empire';
export type { Merge } from './Merge';
export type { Ruin } from './Ruin';
export type { Expand, Settle } from './Expand';

import type { ResourceType } from '../physical/Resource';
import type { TechField } from './Tech';

/**
 * A country "discovers" (unlocks for trade) a resource type in one of its
 * regions. Emitted by `YearGenerator` step 9 when the country's effective
 * tech level in `field` first crosses the resource's `requiredTechLevel`.
 * Serialized into `HistoryEvent` with type `DISCOVERY` for the event log.
 */
export interface Discovery {
  countryId: string;
  regionId: string;
  resourceType: ResourceType;
  field: TechField;
  level: number;
}
