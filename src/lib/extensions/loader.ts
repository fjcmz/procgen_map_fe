import { extensionRegistry } from './registry';
import { validatePack } from './validate';
import type { ExtensionPack } from './types';

/**
 * Parse a JSON string as an extension pack, validate it, and load it into the
 * registry. Returns the loaded pack on success or a list of errors on failure.
 */
export function loadPackFromJson(json: string): { ok: true; pack: ExtensionPack } | { ok: false; errors: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return { ok: false, errors: [`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  const result = validatePack(parsed);
  if (!result.ok) return result;
  extensionRegistry.loadPack(result.pack);
  return { ok: true, pack: result.pack };
}

/** Read a `File` (from <input type="file">) and load it. */
export async function loadPackFromFile(file: File): Promise<{ ok: true; pack: ExtensionPack } | { ok: false; errors: string[] }> {
  if (file.size > 1_048_576) {
    return { ok: false, errors: [`File too large (${file.size} bytes; max 1 MB)`] };
  }
  const text = await file.text();
  return loadPackFromJson(text);
}

const STORAGE_KEY = 'procgen.extensions.packs';

interface StoredPackEntry {
  /** The original JSON text — re-validated on every load. */
  json: string;
}

/** Persist all currently-loaded packs to localStorage. */
export function persistLoadedPacks(): void {
  try {
    const packs = extensionRegistry.getLoadedPacks();
    const entries: Record<string, StoredPackEntry> = {};
    for (const p of packs) {
      entries[p.id] = { json: JSON.stringify(p) };
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage is best-effort; quota errors should not crash the app.
  }
}

/**
 * Restore packs from localStorage on app boot. Each entry is re-validated
 * before loading so a stale or partial pack from a prior schema version is
 * rejected cleanly instead of silently corrupting the registry.
 */
export function restoreLoadedPacks(): { loaded: string[]; rejected: { id: string; errors: string[] }[] } {
  const loaded: string[] = [];
  const rejected: { id: string; errors: string[] }[] = [];
  let raw: string | null = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch { return { loaded, rejected }; }
  if (!raw) return { loaded, rejected };
  let parsed: Record<string, StoredPackEntry>;
  try { parsed = JSON.parse(raw); } catch { return { loaded, rejected }; }
  for (const [id, entry] of Object.entries(parsed)) {
    const result = loadPackFromJson(entry.json);
    if (result.ok) loaded.push(result.pack.id);
    else rejected.push({ id, errors: result.errors });
  }
  return { loaded, rejected };
}
