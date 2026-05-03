/**
 * Sanity-check the bundled `examples/example-pack.json` against the validator.
 * Run via `npx tsx scripts/verify-example-pack.ts`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePack } from '../src/lib/extensions/validate.ts';

const here = dirname(fileURLToPath(import.meta.url));
const path = join(here, '..', 'examples', 'example-pack.json');
const text = readFileSync(path, 'utf-8');
const result = validatePack(JSON.parse(text));
if (!result.ok) {
  console.error('FAIL:');
  for (const e of result.errors) console.error('  ' + e);
  process.exit(1);
}
console.log(`OK — ${result.pack.name} (${result.pack.id}) v${result.pack.version} validates`);
