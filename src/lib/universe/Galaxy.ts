import { IdUtil } from '../history/IdUtil';
import type { SolarSystem } from './SolarSystem';

/**
 * Runtime galaxy entity. Lives only inside the worker — like `Universe`,
 * `SolarSystem` etc., it is flattened into `GalaxyData` for postMessage
 * (no Map/Set on this class but it sits next to entities that have them).
 *
 * Created by `UniverseGenerator` after every system has been generated.
 * The `solarSystems` reference list keeps the chunking decision in one place;
 * the worker serializer reads `id`, `humanName`, `scientificName`, the
 * baked layout fields (`cx`, `cy`, `radius`, `spread`) and the system ids.
 */
export class Galaxy {
  readonly id: string;
  humanName: string = '';
  scientificName: string = '';
  solarSystems: SolarSystem[] = [];
  cx: number = 0;
  cy: number = 0;
  radius: number = 0;
  spread: number = 0;

  constructor(index: number) {
    this.id = IdUtil.id('gal', index) ?? `gal_${index}`;
  }
}
