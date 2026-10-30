// Assembles the frontend folder (dist/) that Tauri serves: the existing app files stay untouched,
// the Tauri scripts are injected into dist/index.html and chart.js is copied from node_modules.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const release = process.argv.includes('--release');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// Static app files
for (const name of readdirSync(root)) {
  if (/^(style\.css|renderer-.*\.js)$/i.test(name)) cpSync(join(root, name), join(dist, name));
}
if (existsSync(join(root, 'img'))) {
  // The image cache of the old Electron app is not needed
  cpSync(join(root, 'img'), join(dist, 'img'), { recursive: true, filter: (src) => !/[\\/]img[\\/]cache([\\/]|$)/.test(src) });
}
cpSync(join(root, 'web'), join(dist, 'web'), { recursive: true });

// Bundled json files (copied to the app data folder on first run, never overwritten afterwards).
// Release builds embed none: the databases are downloaded from GitHub at startup (web/db-sync.js)
// and the user's own files are created by the app when needed.
mkdirSync(join(dist, 'json'), { recursive: true });
const manifest = [];
if (!release && existsSync(join(root, 'json'))) {
  for (const name of readdirSync(join(root, 'json'))) {
    if (!name.toLowerCase().endsWith('.json')) continue;
    cpSync(join(root, 'json', name), join(dist, 'json', name));
    manifest.push(name);
  }
}
writeFileSync(join(dist, 'json', '_manifest.json'), JSON.stringify(manifest, null, 2));

// chart.js
const chartSrc = join(root, 'node_modules', 'chart.js', 'dist', 'chart.umd.js');
if (!existsSync(chartSrc)) throw new Error('chart.js not found: run "npm install" first');
mkdirSync(join(dist, 'lib'), { recursive: true });
cpSync(chartSrc, join(dist, 'lib', 'chart.umd.js'));

// index.html: point chart.js to the copied file and load the Tauri API before every other script
let html = readFileSync(join(root, 'index.html'), 'utf8');
html = html.replace(/node_modules\/chart\.js\/dist\/chart\.umd\.js/g, 'lib/chart.umd.js');
if (!html.includes('web/tauri-api.js')) {
  const tag = '<script src="web/tauri-api.js"></script>';
  html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}\n  ${tag}`) : `${tag}\n${html}`;
}
writeFileSync(join(dist, 'index.html'), html);

console.log(`dist/ ready (${release ? 'release' : 'dev'}, ${manifest.length} json files bundled)`);
