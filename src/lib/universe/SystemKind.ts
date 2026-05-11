/**
 * System taxonomy.
 *
 * Every solar system is classified into a `SystemKind`. The 10 planetary kinds
 * still host a planetary system (one or more "stars" with planets in orbit);
 * the 6 standalone kinds occupy a system slot but never generate planets —
 * they are isolated massive objects (supermassive black holes, white holes,
 * magnetars, quark/boson stars, quasars).
 *
 * Star.subtype is the per-body discriminator. For single-body kinds it equals
 * the system kind. For `binary_star`, each star independently gets a regular
 * planetary star subtype (e.g. main_sequence + red_dwarf).
 */
export type PlanetaryStarKind =
  | 'main_sequence'
  | 'red_dwarf'
  | 'blue_giant'
  | 'red_giant'
  | 'white_dwarf'
  | 'brown_dwarf'
  | 'neutron_star'
  | 'pulsar'
  | 'binary_star'
  | 'stellar_black_hole';

export type StandaloneBodyKind =
  | 'supermassive_black_hole'
  | 'white_hole'
  | 'magnetar'
  | 'quark_star'
  | 'boson_star'
  | 'quasar';

export type SystemKind = PlanetaryStarKind | StandaloneBodyKind;

/**
 * Per-star subtype. `binary_star` is a system-level archetype with two stars,
 * so it never appears here. Every other planetary kind and every standalone
 * kind may appear as a Star.subtype.
 */
export type StarSubtype =
  | 'main_sequence'
  | 'red_dwarf'
  | 'blue_giant'
  | 'red_giant'
  | 'white_dwarf'
  | 'brown_dwarf'
  | 'neutron_star'
  | 'pulsar'
  | 'stellar_black_hole'
  | StandaloneBodyKind;

const STANDALONE_SET: ReadonlySet<SystemKind> = new Set<SystemKind>([
  'supermassive_black_hole',
  'white_hole',
  'magnetar',
  'quark_star',
  'boson_star',
  'quasar',
]);

export function isStandaloneKind(k: SystemKind): boolean {
  return STANDALONE_SET.has(k);
}
