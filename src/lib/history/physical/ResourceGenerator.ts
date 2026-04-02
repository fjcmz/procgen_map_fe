import { Resource, pickResourceType } from './Resource';

export class ResourceGenerator {
  generate(rng: () => number): Resource {
    const type = pickResourceType(rng);
    return new Resource(type, rng);
  }
}

export const resourceGenerator = new ResourceGenerator();
