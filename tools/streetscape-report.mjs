// Runs tools/streetscape-report.ts and tools/furniture-report.ts through Vite, which resolves the TypeScript imports and the JSON.
import { runnerImport } from 'vite';

const streetscape = await runnerImport(new URL('./streetscape-report.ts', import.meta.url).pathname);
streetscape.module.report();
const furniture = await runnerImport(new URL('./furniture-report.ts', import.meta.url).pathname);
furniture.module.report();
