// Database updater: compares the local json databases with the ones published on GitHub and downloads
// the files that are missing or different.
//
// A file is up to date when the git "blob sha" of the local bytes equals the sha GitHub reports for it,
// so no extra state has to be saved and a corrupted or edited local file is replaced too.
//
// The network (`net`) and the file system (`files`) are injected, like the scrapers do, so the same code can be tested in Node:
//   net:   { getJson(url), getBytes(url, headers?) }          reject with an Error when the request fails
//   files: { readBytes(name) -> Uint8Array | null, writeBytes(name, bytes) }

export const REPO = 'Grimmjow81/Platiroom';
export const BRANCH = 'main';
export const REMOTE_DIR = 'json';

// Every group has its own status in the Welcome tab
export const DB_GROUPS = {
  psnp: ['PSNP+_Guides.json', 'PSNP+_Shutdown.json', 'PSNP+_Unobtainables.json'],
  games: ['PSN_GamesMini.json']
};

const API_BASE = `https://api.github.com/repos/${REPO}`;
const RAW_HOST = 'https://raw.githubusercontent.com/';
const RAW_BASE = `${RAW_HOST}${REPO}/${BRANCH}/${REMOTE_DIR}`;

// ==========================================================================
// GIT BLOB SHA
// ==========================================================================

const rotateLeft = (x, n) => (x << n) | (x >>> (32 - n));

// SHA-1 in plain JavaScript: crypto.subtle only exists in secure contexts, and the webview origin may not be one
export function sha1Hex(data) {
  const length = data.length;
  const paddedLength = Math.ceil((length + 9) / 64) * 64;

  const padded = new Uint8Array(paddedLength);
  padded.set(data);
  padded[length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(length / 0x20000000));   // length in bits, high part
  view.setUint32(paddedLength - 4, (length * 8) >>> 0);                // length in bits, low part

  const h = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0];
  const w = new Uint32Array(80);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(offset + t * 4);
    for (let t = 16; t < 80; t++) w[t] = rotateLeft(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);

    let [a, b, c, d, e] = h;

    for (let t = 0; t < 80; t++) {
      let f, k;
      if (t < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
      else if (t < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
      else if (t < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
      else { f = b ^ c ^ d; k = 0xCA62C1D6; }

      const temp = (rotateLeft(a, 5) + f + e + k + w[t]) >>> 0;
      e = d;
      d = c;
      c = rotateLeft(b, 30);
      b = a;
      a = temp;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
  }

  return h.map(word => word.toString(16).padStart(8, '0')).join('');
}

// Same value as "git hash-object <file>": sha1("blob <size>\0" + content)
export function gitBlobSha(bytes) {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const data = new Uint8Array(header.length + bytes.length);
  data.set(header);
  data.set(bytes, header.length);
  return sha1Hex(data);
}

// ==========================================================================
// REMOTE FILES
// ==========================================================================

// File name (lower case) -> GitHub entry { name, sha, download_url... } for the json folder of the repository
async function listRemoteFiles(net) {
  const entries = await net.getJson(`${API_BASE}/contents/${REMOTE_DIR}?ref=${BRANCH}`);
  if (!Array.isArray(entries)) throw new Error('Unexpected answer from GitHub');

  return new Map(entries
    .filter(entry => entry.type === 'file')
    .map(entry => [entry.name.toLowerCase(), entry]));
}

// Downloads a file and checks it against the sha announced by GitHub.
// Right after a push raw.githubusercontent.com can still serve the previous version for a few minutes,
// so the git blob API (always up to date) is the second source.
async function downloadVerified(net, entry) {
  const rawUrl = entry.download_url?.startsWith(RAW_HOST)
    ? entry.download_url
    : `${RAW_BASE}/${encodeURIComponent(entry.name)}`;

  const sources = [
    () => net.getBytes(rawUrl),
    () => net.getBytes(`${API_BASE}/git/blobs/${entry.sha}`, { Accept: 'application/vnd.github.raw+json' })
  ];

  let lastError = new Error('Download failed');
  for (const load of sources) {
    try {
      const bytes = await load();
      if (gitBlobSha(bytes) === entry.sha) return bytes;
      lastError = new Error('The downloaded file does not match the one on GitHub');
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

// A broken file must never replace a working one
function assertValidJson(bytes) {
  try {
    JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('The file on GitHub is not valid JSON');
  }
}

// Returns true if the file was downloaded, false if the local copy was already up to date
async function syncFile({ net, files, name, remoteEntry }) {
  if (!remoteEntry) throw new Error('File not found on GitHub');

  const local = await files.readBytes(name);
  if (local && gitBlobSha(local) === remoteEntry.sha) return false;

  const bytes = await downloadVerified(net, remoteEntry);
  assertValidJson(bytes);
  await files.writeBytes(name, bytes);
  return true;
}

// ==========================================================================
// PUBLIC API
// ==========================================================================

// Checks every group and calls onStatus(groupKey, result) as soon as a group is done.
// result = { status: 'up-to-date' | 'updated' | 'error', changed: [file names], errors: [{ name, message }] }
// A group is 'error' if at least one of its files failed (the files that were downloaded are kept and listed in `changed`).
export async function syncDatabases({ net, files, groups = DB_GROUPS, onStatus = () => {} }) {
  const results = {};

  let remoteFiles;
  try {
    remoteFiles = await listRemoteFiles(net);
  } catch (err) {
    for (const key of Object.keys(groups)) {
      results[key] = { status: 'error', changed: [], errors: [{ name: '', message: err.message }] };
      onStatus(key, results[key]);
    }
    return results;
  }

  for (const [key, names] of Object.entries(groups)) {
    const changed = [];
    const errors = [];

    for (const name of names) {
      try {
        const remoteEntry = remoteFiles.get(name.toLowerCase());
        if (await syncFile({ net, files, name, remoteEntry })) changed.push(name);
      } catch (err) {
        errors.push({ name, message: err.message });
      }
    }

    const status = errors.length > 0 ? 'error' : (changed.length > 0 ? 'updated' : 'up-to-date');
    results[key] = { status, changed, errors };
    onStatus(key, results[key]);
  }

  return results;
}
