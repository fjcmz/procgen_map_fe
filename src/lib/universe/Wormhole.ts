import { IdUtil } from '../history/IdUtil';

function rngHex(rng: () => number): string {
  return Array.from({ length: 3 }, () =>
    Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0')
  ).join('');
}

/**
 * Worker-only wormhole entity. Each wormhole belongs to a single standalone-
 * kind solar system and (after the pairing pass) connects reciprocally to
 * exactly one other wormhole — usually within the same galaxy, occasionally
 * cross-galaxy. Stays inside the universegen worker; serialized to
 * `WormholeData` (see `types.ts`) before postMessage.
 *
 * `offsetX`/`offsetY` are positions in system-view content-space units,
 * baked at generation time so the renderer can place each wormhole at a
 * fixed offset around the central body without any per-frame randomness.
 */
export class Wormhole {
  readonly id: string;
  scientificName: string = '';
  solarSystemId: string = '';
  galaxyId: string = '';
  partnerId: string | null = null;
  offsetX: number = 0;
  offsetY: number = 0;

  constructor(rng: () => number) {
    this.id = IdUtil.id('wormhole', rngHex(rng)) ?? 'wormhole_unknown';
  }
}
