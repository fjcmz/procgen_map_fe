/**
 * Phase 5 placeholder event interfaces.
 *
 * Each interface represents one of the 12 event types generated per Year.
 * Phase 5 will expand these with full fields and corresponding generators.
 */

/** City foundation event. */
export interface Foundation { readonly id: string }

/** First-contact event between two cities. */
export interface Contact { readonly id: string }

/** Country founding event (named CountryEvent to avoid collision with types.ts Country). */
export interface CountryEvent { readonly id: string }

/** Illustrious figure born this year. */
export interface Illustrate { readonly id: string }

/** Wonder built in a city. */
export interface Wonder { readonly id: string }

/** Religion founded or expanded. */
export interface Religion { readonly id: string }

/** Trade route established between cities. */
export interface Trade { readonly id: string }

/** Cataclysm striking a region. */
export interface Cataclysm { readonly id: string }

/** War between two countries. */
export interface War { readonly id: string }

/** Technology discovered by a country. */
export interface Tech { readonly id: string }

/** Conquest of one country by another. */
export interface Conquer { readonly id: string }

/** Empire formed from conquests. */
export interface Empire { readonly id: string }
