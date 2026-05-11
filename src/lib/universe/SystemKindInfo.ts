/**
 * Per-kind metadata table. Drives system generation (star count, radius and
 * brightness ranges), per-star renderer palettes, popup display, and naming
 * catalog prefixes.
 *
 * Weights are integer relative frequencies used by `pickSystemKind`. They are
 * tuned so:
 *  - main_sequence dominates (≈ 55%)
 *  - exotic planetary kinds are visible but rare (1–5% each)
 *  - standalone kinds combined sit under ~5%
 *
 * The 'binary_star' kind forces a 2-star system. Standalone kinds always have
 * exactly 1 central body and no planets.
 */
import type { SystemKind, StarSubtype } from './SystemKind';
import { isStandaloneKind } from './SystemKind';

export interface KindHue {
  /** Solid core fill colour. */
  core: string;
  /** Inner stop of the radial glow gradient (rgba). */
  glowInner: string;
  /** Outer stop of the radial glow gradient (rgba, alpha → 0). */
  glowOuter: string;
}

export interface SystemKindInfo {
  /** Friendly label for popup / tree badge. */
  displayName: string;
  /** One-sentence flavour blurb shown in the popup. */
  description: string;
  /** Standalone kinds never spawn planets. */
  isStandalone: boolean;
  /** Inclusive [min, max] range of stars at the centre. */
  starCount: [number, number];
  /** Star.radius range override (replaces the legacy [400, 900] roll). */
  radiusRange: [number, number];
  /** Star.brightness range override (replaces the legacy [100, 999] roll). */
  brightnessRange: [number, number];
  /** Renderer palette. */
  hue: KindHue;
  /** Optional catalog prefix that replaces the random HD/HIP/GJ/KOI roll. */
  namingPrefix?: string;
  /** Selection weight for pickSystemKind. */
  weight: number;
}

// Star.subtype keys overlap with planetary SystemKind values plus standalone
// values. They never include 'binary_star'.
type StarSubtypeKey = Exclude<StarSubtype, never>;

/**
 * Star-subtype-driven palette overrides. For the legacy main_sequence case
 * the renderer's brightness-based hue is still used; `main_sequence` is
 * therefore deliberately NOT in this table.
 */
export const STAR_SUBTYPE_HUE: Partial<Record<StarSubtypeKey, KindHue>> = {
  red_dwarf: {
    core: '#f0805c',
    glowInner: 'rgba(240,128,92,0.75)',
    glowOuter: 'rgba(180,60,20,0)',
  },
  blue_giant: {
    core: '#bcd6ff',
    glowInner: 'rgba(170,210,255,0.85)',
    glowOuter: 'rgba(80,140,255,0)',
  },
  red_giant: {
    core: '#ff9a4c',
    glowInner: 'rgba(255,150,80,0.8)',
    glowOuter: 'rgba(200,60,20,0)',
  },
  white_dwarf: {
    core: '#f4f8ff',
    glowInner: 'rgba(220,240,255,0.85)',
    glowOuter: 'rgba(120,160,220,0)',
  },
  brown_dwarf: {
    core: '#7a4a30',
    glowInner: 'rgba(160,90,50,0.6)',
    glowOuter: 'rgba(60,30,10,0)',
  },
  neutron_star: {
    core: '#e8f0ff',
    glowInner: 'rgba(180,220,255,0.9)',
    glowOuter: 'rgba(80,140,220,0)',
  },
  pulsar: {
    core: '#e8e0ff',
    glowInner: 'rgba(200,170,255,0.85)',
    glowOuter: 'rgba(100,60,200,0)',
  },
  stellar_black_hole: {
    core: '#040108',
    glowInner: 'rgba(255,140,40,0.6)',
    glowOuter: 'rgba(120,20,0,0)',
  },
  supermassive_black_hole: {
    core: '#020104',
    glowInner: 'rgba(255,170,60,0.8)',
    glowOuter: 'rgba(120,30,0,0)',
  },
  white_hole: {
    core: '#ffffff',
    glowInner: 'rgba(255,255,240,0.95)',
    glowOuter: 'rgba(255,220,160,0)',
  },
  magnetar: {
    core: '#d0e0ff',
    glowInner: 'rgba(150,200,255,0.85)',
    glowOuter: 'rgba(60,100,200,0)',
  },
  quark_star: {
    core: '#ffd8a0',
    glowInner: 'rgba(255,180,120,0.85)',
    glowOuter: 'rgba(160,80,40,0)',
  },
  boson_star: {
    core: '#ffd0f8',
    glowInner: 'rgba(220,180,255,0.7)',
    glowOuter: 'rgba(120,60,180,0)',
  },
  quasar: {
    core: '#fff8d0',
    glowInner: 'rgba(255,230,140,0.95)',
    glowOuter: 'rgba(200,100,40,0)',
  },
};

export const SYSTEM_KIND_INFO: Record<SystemKind, SystemKindInfo> = {
  // ── Planetary ──────────────────────────────────────────────────────────
  main_sequence: {
    displayName: 'Main-sequence system',
    description:
      'A long-lived hydrogen-burning star with a stable planetary disk — the canonical Sol-like configuration.',
    isStandalone: false,
    starCount: [1, 3],
    radiusRange: [400, 900],
    brightnessRange: [100, 999],
    hue: { core: '#fff2c0', glowInner: 'rgba(255,240,180,0.8)', glowOuter: 'rgba(255,180,80,0)' },
    weight: 55,
  },
  red_dwarf: {
    displayName: 'Red-dwarf system',
    description:
      'A small, cool K/M-class star — the most common stellar inhabitant of the universe, with a tightly packed habitable zone.',
    isStandalone: false,
    starCount: [1, 2],
    radiusRange: [150, 380],
    brightnessRange: [40, 200],
    hue: STAR_SUBTYPE_HUE.red_dwarf!,
    weight: 12,
  },
  blue_giant: {
    displayName: 'Blue-giant system',
    description:
      'A massive, ultraviolet-bright O/B-class star burning fuel furiously. Planets here are short-lived and irradiated.',
    isStandalone: false,
    starCount: [1, 2],
    radiusRange: [1200, 2400],
    brightnessRange: [800, 1600],
    hue: STAR_SUBTYPE_HUE.blue_giant!,
    weight: 4,
  },
  red_giant: {
    displayName: 'Red-giant system',
    description:
      'An evolved late-stage star, swollen and cool. Its inner planets have likely been engulfed.',
    isStandalone: false,
    starCount: [1, 2],
    radiusRange: [1500, 3000],
    brightnessRange: [300, 700],
    hue: STAR_SUBTYPE_HUE.red_giant!,
    weight: 6,
  },
  white_dwarf: {
    displayName: 'White-dwarf system',
    description:
      'The dense Earth-sized remnant of a sun-like star, cooling slowly across deep time. Surviving planets orbit a fading ember.',
    isStandalone: false,
    starCount: [1, 1],
    radiusRange: [40, 90],
    brightnessRange: [30, 180],
    hue: STAR_SUBTYPE_HUE.white_dwarf!,
    namingPrefix: 'WD',
    weight: 5,
  },
  brown_dwarf: {
    displayName: 'Brown-dwarf system',
    description:
      'A sub-stellar object — too small to ignite hydrogen fusion. Worlds here drift in twilight illumination.',
    isStandalone: false,
    starCount: [1, 1],
    radiusRange: [80, 200],
    brightnessRange: [5, 60],
    hue: STAR_SUBTYPE_HUE.brown_dwarf!,
    weight: 5,
  },
  neutron_star: {
    displayName: 'Neutron-star system',
    description:
      'A 20-km core of degenerate neutron matter. Any orbiting planets formed from the post-supernova debris.',
    isStandalone: false,
    starCount: [1, 1],
    radiusRange: [10, 25],
    brightnessRange: [40, 220],
    hue: STAR_SUBTYPE_HUE.neutron_star!,
    namingPrefix: 'NS',
    weight: 3,
  },
  pulsar: {
    displayName: 'Pulsar system',
    description:
      'A rapidly rotating neutron star sweeping the heavens with twin radiation beams. Hosts the rare class of pulsar planets.',
    isStandalone: false,
    starCount: [1, 1],
    radiusRange: [10, 25],
    brightnessRange: [80, 400],
    hue: STAR_SUBTYPE_HUE.pulsar!,
    namingPrefix: 'PSR',
    weight: 2,
  },
  binary_star: {
    displayName: 'Binary-star system',
    description:
      'Two stars orbiting a common barycentre. Planets either circle one star (S-type) or both at distance (P-type).',
    isStandalone: false,
    starCount: [2, 2],
    radiusRange: [400, 900],
    brightnessRange: [100, 999],
    hue: { core: '#ffe49a', glowInner: 'rgba(255,220,150,0.8)', glowOuter: 'rgba(200,120,40,0)' },
    weight: 5,
  },
  stellar_black_hole: {
    displayName: 'Stellar black hole',
    description:
      'A solar-mass black hole formed by the collapse of a massive star, ringed by a thin accretion disk and surviving debris worlds.',
    isStandalone: false,
    starCount: [1, 1],
    radiusRange: [5, 20],
    brightnessRange: [10, 120],
    hue: STAR_SUBTYPE_HUE.stellar_black_hole!,
    namingPrefix: 'SBH',
    weight: 2,
  },

  // ── Standalone (no planets) ────────────────────────────────────────────
  supermassive_black_hole: {
    displayName: 'Supermassive black hole',
    description:
      'A million- to billion-solar-mass gravitational well at the heart of its space. Its accretion disk blazes; no stable planets exist.',
    isStandalone: true,
    starCount: [1, 1],
    radiusRange: [3000, 9000],
    brightnessRange: [400, 1500],
    hue: STAR_SUBTYPE_HUE.supermassive_black_hole!,
    namingPrefix: 'SMBH',
    weight: 1.0,
  },
  white_hole: {
    displayName: 'White hole',
    description:
      'A hypothetical time-reverse of a black hole — matter and light pour outward and nothing can fall in.',
    isStandalone: true,
    starCount: [1, 1],
    radiusRange: [100, 400],
    brightnessRange: [800, 2000],
    hue: STAR_SUBTYPE_HUE.white_hole!,
    namingPrefix: 'WH',
    weight: 0.6,
  },
  magnetar: {
    displayName: 'Magnetar',
    description:
      'A neutron star with an extreme magnetic field — quadrillions of times Earth\'s. Any nearby matter is torn apart by magnetic stress.',
    isStandalone: true,
    starCount: [1, 1],
    radiusRange: [10, 25],
    brightnessRange: [200, 600],
    hue: STAR_SUBTYPE_HUE.magnetar!,
    namingPrefix: 'MGT',
    weight: 0.8,
  },
  quark_star: {
    displayName: 'Quark star',
    description:
      'A theoretical compact object denser than a neutron star — composed of free quark matter rather than nucleons.',
    isStandalone: true,
    starCount: [1, 1],
    radiusRange: [8, 18],
    brightnessRange: [80, 320],
    hue: STAR_SUBTYPE_HUE.quark_star!,
    namingPrefix: 'QS',
    weight: 0.6,
  },
  boson_star: {
    displayName: 'Boson star',
    description:
      'A hypothetical self-gravitating cloud of scalar bosons — transparent, slow-rotating, gravitationally lensing the background.',
    isStandalone: true,
    starCount: [1, 1],
    radiusRange: [200, 600],
    brightnessRange: [40, 200],
    hue: STAR_SUBTYPE_HUE.boson_star!,
    namingPrefix: 'BS',
    weight: 0.5,
  },
  quasar: {
    displayName: 'Quasar',
    description:
      'An ultra-luminous accretion disk around a SMBH, outshining trillions of stars. Its relativistic jets sterilise its surroundings.',
    isStandalone: true,
    starCount: [1, 1],
    radiusRange: [4000, 10000],
    brightnessRange: [1200, 3000],
    hue: STAR_SUBTYPE_HUE.quasar!,
    namingPrefix: 'QSO',
    weight: 0.5,
  },
};

const KIND_ORDER: SystemKind[] = Object.keys(SYSTEM_KIND_INFO) as SystemKind[];

/** Weighted roll over SYSTEM_KIND_INFO. Consumes exactly one rng() draw. */
export function pickSystemKind(rng: () => number): SystemKind {
  let totalWeight = 0;
  for (const k of KIND_ORDER) totalWeight += SYSTEM_KIND_INFO[k].weight;
  let r = rng() * totalWeight;
  for (const k of KIND_ORDER) {
    r -= SYSTEM_KIND_INFO[k].weight;
    if (r <= 0) return k;
  }
  return 'main_sequence';
}

export function kindInfo(k: SystemKind): SystemKindInfo {
  return SYSTEM_KIND_INFO[k];
}

export { isStandaloneKind };
