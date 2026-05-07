// Worker bootstrap: registers tsx's ESM loader for this worker thread, then
// dynamically imports the actual TypeScript worker. Node's worker_threads do
// not inherit ESM loader hooks (--require / --import) from the parent thread's
// runtime, so we have to re-register tsx here. Using a .mjs entry sidesteps the
// chicken-and-egg of loading tsx-the-loader from a .ts file.
import { register } from 'tsx/esm/api';
register();
await import('./sweep-worker.ts');
