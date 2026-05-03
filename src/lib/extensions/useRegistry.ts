import { useEffect, useState } from 'react';
import { extensionRegistry } from './registry';

/**
 * React hook that re-renders whenever the extension registry changes (a pack
 * was loaded, replaced, or unloaded). Returns a tick number — components only
 * need it to invalidate their derived state, never the value itself.
 */
export function useRegistryVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => extensionRegistry.subscribe(() => setVersion(v => v + 1)), []);
  return version;
}
