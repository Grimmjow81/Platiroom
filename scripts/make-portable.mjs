// Builds the portable folder: portable/Platiroom.exe and nothing else.
// No json files are shipped: the app creates json/ on first start and downloads the databases from GitHub (web/db-sync.js).
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'portable');
const exeName = process.platform === 'win32' ? 'platiroom.exe' : 'platiroom';
const exe = join(root, 'src-tauri', 'target', 'release', exeName);
if (!existsSync(exe)) throw new Error(`${exe} not found: did the build fail?`);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(exe, join(out, process.platform === 'win32' ? 'Platiroom.exe' : 'Platiroom'));

console.log(`Portable folder ready: ${out}`);
