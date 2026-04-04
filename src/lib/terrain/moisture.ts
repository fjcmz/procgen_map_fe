import type { Cell } from '../types';
import type { NoiseSampler3D } from './noise';
import { fbmCylindrical } from './noise';

export function assignMoisture(
  cells: Cell[],
  width: number,
  height: number,
  noise: NoiseSampler3D
): void {
  for (const cell of cells) {
    // Base moisture from noise
    let m = fbmCylindrical(noise.moisture, cell.x + width * 0.3, cell.y + height * 0.3, width, height, 3);

    // Latitude-based moisture adjustment (mimics Hadley cells / global circulation)
    const ny = (cell.y / height) * 2 - 1; // -1 (top) to 1 (bottom)
    const absLat = Math.abs(ny);

    // Equatorial band (|lat| < 0.15): wet (ITCZ — tropical convergence zone)
    // Subtropical band (0.2 < |lat| < 0.4): dry (descending air — desert belt)
    // Midlatitudes (0.4 < |lat| < 0.7): moderate-wet (westerlies)
    // Polar (|lat| > 0.8): dry-cold
    let latMod = 0;
    if (absLat < 0.15) {
      latMod = 0.15; // tropical wet boost
    } else if (absLat < 0.2) {
      latMod = 0.15 * (1 - (absLat - 0.15) / 0.05); // transition
    } else if (absLat < 0.4) {
      latMod = -0.12; // subtropical dry
    } else if (absLat < 0.5) {
      latMod = -0.12 * (1 - (absLat - 0.4) / 0.1); // transition
    } else if (absLat < 0.7) {
      latMod = 0.05; // midlatitude moderate
    } else {
      latMod = -0.05; // polar dry
    }
    m += latMod;

    // Coastal cells are wetter
    if (cell.isCoast) {
      m = Math.min(1, m + 0.2);
    }

    cell.moisture = Math.max(0, Math.min(1, m));
  }
}
