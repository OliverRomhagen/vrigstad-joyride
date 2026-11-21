// Runs tools/streetscape-report.ts through Vite, which resolves the TypeScript imports and the JSON.
import { runnerImport } from 'vite';

const { module } = await runnerImport(new URL('./streetscape-report.ts', import.meta.url).pathname);
module.report();
