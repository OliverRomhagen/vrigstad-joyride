// Supply the original pinned exports, named like the public GLBs. Never recompress a derivative.
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join, resolve } from 'node:path';

const source = process.argv[2];
if (!source) throw new Error('Usage: npm run compress:vehicles -- /path/to/original-exports');
const output = resolve('src/public/media/vehicles');
if (resolve(source) === output) throw new Error('Source must contain the original, uncompressed exports');
const require = createRequire(import.meta.url);
const cli = require.resolve('gltfpack/cli.js');
for (const file of readdirSync(output).filter(name => name.endsWith('.glb')).sort()) {
  const input = join(source, file);
  const destination = join(output, basename(file));
  execFileSync(process.execPath, [cli, '-i', input, '-o', destination, '-c', '-kn', '-km', '-noq'], { stdio: 'inherit' });
  console.log(`${file}: ${statSync(input).size} -> ${statSync(destination).size} bytes`);
}
