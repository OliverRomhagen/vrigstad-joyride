// Supply the original pinned exports, named like the public GLBs. Never recompress a derivative.
// Each export's static parts are merged per material first (tools/vehicle-parts.ts), then gltfpack compresses it.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { runnerImport } from 'vite';

const source = process.argv[2];
if (!source) throw new Error('Usage: npm run compress:vehicles -- /path/to/original-exports');
const output = resolve('src/public/media/vehicles');
if (resolve(source) === output) throw new Error('Source must contain the original, uncompressed exports');
const require = createRequire(import.meta.url);
const cli = require.resolve('gltfpack/cli.js');
const { mergeStaticParts } = (await runnerImport(new URL('./vehicle-parts.ts', import.meta.url).pathname)).module;
const scratch = mkdtempSync(join(tmpdir(), 'vehicles-'));
try {
  for (const file of readdirSync(output)
    .filter(name => name.endsWith('.glb'))
    .sort()) {
    const input = join(source, file);
    const { glb, report } = mergeStaticParts(readFileSync(input));
    const merged = join(scratch, file);
    writeFileSync(merged, glb);
    const destination = join(output, basename(file));
    execFileSync(process.execPath, [cli, '-i', merged, '-o', destination, '-c', '-kn', '-km', '-noq'], {
      stdio: 'inherit',
    });
    console.log(
      `${file}: ${report.before} -> ${report.after} parts on the body; ${statSync(input).size} -> ${statSync(destination).size} bytes`,
    );
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
