import { zipSync, strToU8 } from 'fflate';
import type { MapData } from '../types';

/**
 * Parameters captured at the time of the export, mirroring the
 * `GenerateRequest` fields the UI carries as React state. These let a
 * reader of the exported file reproduce the run exactly.
 */
export interface ExportParams {
  seed: string;
  numCells: number;
  waterRatio: number;
  profileName: string;
  generateHistory: boolean;
  numSimYears: number;
}

/**
 * Top-level envelope written to `world.json` inside the zip. Versioned so
 * future additions to `MapData` can be handled gracefully by external tools.
 */
export interface WorldExportEnvelope {
  schemaVersion: number;
  exportedAt: string;
  generator: {
    name: string;
    version: number;
  };
  params: ExportParams;
  mapData: MapData;
}

const SCHEMA_VERSION = 1;

/**
 * JSON.stringify replacer that handles the three non-plain shapes carried
 * inside `MapData`:
 *   - `Map` (e.g. `HistoryYear.ownershipDelta`) → plain object
 *   - `Int16Array` / `Uint8Array` / `Float32Array` (e.g. `HistoryData.snapshots`,
 *     `techTimeline.byField`, `citySizeSnapshots`, `expansionSnapshots`) →
 *     plain number arrays
 * Everything else passes through untouched.
 */
function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) {
    return Object.fromEntries(value);
  }
  if (
    value instanceof Int16Array ||
    value instanceof Uint8Array ||
    value instanceof Float32Array
  ) {
    return Array.from(value);
  }
  return value;
}

/**
 * Sanitize the seed for use in a filename — keep alphanumerics, dash, and
 * underscore; replace everything else with underscores. Empty seeds fall
 * back to "world" so we never emit a zero-length stem.
 */
function safeSeed(seed: string): string {
  const cleaned = seed.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned.length > 0 ? cleaned : 'world';
}

/**
 * Build a zip file in memory containing a single `world.json` file with the
 * full map + history payload, then trigger a browser download. Runs
 * synchronously on the main thread — callers that care about UI
 * responsiveness should schedule this inside a `requestAnimationFrame` so
 * the button's "Exporting…" label gets a chance to paint first.
 */
export function exportWorld(mapData: MapData, params: ExportParams): void {
  const envelope: WorldExportEnvelope = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    generator: {
      name: 'procgen_map_fe',
      version: SCHEMA_VERSION,
    },
    params,
    mapData,
  };

  const json = JSON.stringify(envelope, replacer);
  const jsonBytes = strToU8(json);

  const zipped = zipSync(
    { 'world.json': jsonBytes },
    { level: 6 },
  );

  // Cast via `BlobPart` — TS 5.7+ narrowed `Uint8Array` to
  // `Uint8Array<ArrayBufferLike>`, which no longer structurally matches the
  // Blob constructor's `ArrayBufferView<ArrayBuffer>` expectation. The
  // runtime payload is identical.
  const blob = new Blob([zipped as unknown as BlobPart], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const filename = `world_${safeSeed(params.seed)}_${Date.now()}.zip`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}
