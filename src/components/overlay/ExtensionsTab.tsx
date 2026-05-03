import { useCallback, useState, type ChangeEvent } from 'react';
import {
  extensionRegistry,
  loadPackFromFile,
  persistLoadedPacks,
  useRegistryVersion,
} from '../../lib/extensions';

/**
 * Extension pack management UI. Lists currently-loaded packs with their id /
 * version / scope, supports drag-drop and file-picker upload, and lets users
 * unload individual packs.
 */
export function ExtensionsTab() {
  const version = useRegistryVersion();
  const [errors, setErrors] = useState<string[] | null>(null);
  const [lastLoaded, setLastLoaded] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    setErrors(null);
    setLastLoaded(null);
    const result = await loadPackFromFile(file);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    persistLoadedPacks();
    setLastLoaded(`${result.pack.name} (${result.pack.id} v${result.pack.version})`);
  }, []);

  const onPick = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void handleFile(f);
    // Allow re-picking the same file by resetting the input.
    e.target.value = '';
  }, [handleFile]);

  const onUnload = useCallback((id: string) => {
    extensionRegistry.unloadPack(id);
    persistLoadedPacks();
    setLastLoaded(null);
  }, []);

  const onUnloadAll = useCallback(() => {
    extensionRegistry.unloadAll();
    persistLoadedPacks();
    setLastLoaded(null);
  }, []);

  // Force a re-read after each registry change.
  void version;
  const packs = extensionRegistry.getLoadedPacks();

  return (
    <div style={styles.body}>
      <div style={styles.intro}>
        Extension packs add new planet subtypes, terrain profiles, and
        landmass shapes to the generators. Drop in a JSON file or pick one
        below — see the <code>procgen-pack/v1</code> schema for the shape.
      </div>

      <label style={styles.uploadBtn}>
        Load JSON Pack…
        <input
          type="file"
          accept="application/json,.json"
          onChange={onPick}
          style={{ display: 'none' }}
        />
      </label>

      {lastLoaded && <div style={styles.success}>Loaded: {lastLoaded}</div>}
      {errors && (
        <div style={styles.errorBox}>
          <div style={styles.errorTitle}>Pack rejected:</div>
          <ul style={styles.errorList}>
            {errors.map((err, i) => <li key={i}>{err}</li>)}
          </ul>
        </div>
      )}

      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <span>Loaded Packs ({packs.length})</span>
          {packs.length > 0 && (
            <button style={styles.unloadAllBtn} onClick={onUnloadAll}>
              Unload all
            </button>
          )}
        </div>
        {packs.length === 0 ? (
          <div style={styles.emptyText}>
            No user packs loaded. Built-in defaults are always active.
          </div>
        ) : (
          <ul style={styles.packList}>
            {packs.map(p => (
              <li key={p.id} style={styles.packRow}>
                <div style={styles.packMeta}>
                  <div style={styles.packTitle}>
                    {p.name} <span style={styles.packMode}>[{p.mode}]</span>
                  </div>
                  <div style={styles.packSubtitle}>
                    {p.id} · v{p.version} · {scopeSummary(p.universe, p.world)}
                  </div>
                  {p.description && (
                    <div style={styles.packDesc}>{p.description}</div>
                  )}
                </div>
                <button style={styles.unloadBtn} onClick={() => onUnload(p.id)}>
                  Unload
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function scopeSummary(u: unknown, w: unknown): string {
  const parts: string[] = [];
  if (u) parts.push('universe');
  if (w) parts.push('world');
  return parts.length > 0 ? parts.join(' + ') : 'empty';
}

const styles: Record<string, React.CSSProperties> = {
  body: { display: 'flex', flexDirection: 'column', gap: 10 },
  intro: { fontSize: 12, color: '#5a3a10', lineHeight: 1.4 },
  uploadBtn: {
    padding: '8px 14px',
    background: '#8b4513',
    color: '#fff5e0',
    border: 'none',
    borderRadius: 5,
    fontFamily: 'Georgia, serif',
    fontSize: 12,
    fontWeight: 'bold',
    cursor: 'pointer',
    letterSpacing: 0.5,
    textAlign: 'center',
    alignSelf: 'flex-start',
  },
  success: {
    padding: '6px 10px',
    background: 'rgba(58,106,58,0.15)',
    border: '1px solid #5fa86a',
    borderRadius: 4,
    color: '#2a4a2a',
    fontSize: 11,
  },
  errorBox: {
    padding: '6px 10px',
    background: 'rgba(180,40,40,0.10)',
    border: '1px solid #b83030',
    borderRadius: 4,
    color: '#7a1010',
    fontSize: 11,
  },
  errorTitle: { fontWeight: 'bold', marginBottom: 4 },
  errorList: { margin: 0, paddingLeft: 18 },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: '6px 8px',
    border: '1px solid #c0a070',
    borderRadius: 4,
    background: '#faf6ee',
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 11,
    fontWeight: 'bold',
    color: '#5a3a10',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  unloadAllBtn: {
    padding: '2px 8px',
    background: 'transparent',
    color: '#7a1010',
    border: '1px solid #b83030',
    borderRadius: 3,
    fontSize: 10,
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  emptyText: { fontSize: 11, color: '#8a6a30', fontStyle: 'italic' },
  packList: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 },
  packRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
    padding: 6,
    border: '1px solid #d4c090',
    borderRadius: 3,
    background: '#fffef5',
  },
  packMeta: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 },
  packTitle: { fontWeight: 'bold', fontSize: 12, color: '#2a1a00' },
  packMode: { fontSize: 10, color: '#8a6a30', fontWeight: 'normal' },
  packSubtitle: { fontSize: 10, color: '#5a3a10' },
  packDesc: { fontSize: 11, color: '#3a2a10', marginTop: 2, lineHeight: 1.3 },
  unloadBtn: {
    padding: '3px 8px',
    background: 'transparent',
    color: '#7a1010',
    border: '1px solid #b83030',
    borderRadius: 3,
    fontSize: 10,
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
};
