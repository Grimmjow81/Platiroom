// Tauri replacement for preload.js: exposes the same `window.api` the renderers already use.
// Classic script (not a module) so window.api exists before any renderer script runs.
(() => {
  const T = window.__TAURI__;
  if (!T) {
    console.error('window.__TAURI__ is missing: set "withGlobalTauri": true in tauri.conf.json');
    return;
  }

  const { fs, http, opener, path, core } = T;
  const JSON_DIR = 'json';
  const CACHE_DIR = 'img/cache';

  // --- Paths (portable: data lives next to the app) ---
  // Rust decides the folder: the project root with "tauri dev", the folder of the executable in a release build.

  let baseDirPromise = null;
  const getBaseDir = () => (baseDirPromise ??= core.invoke('data_dir'));

  async function absPath(relative) {
    return path.join(await getBaseDir(), ...relative.split('/'));
  }

  // --- First run: create folders and copy the bundled json files that do not exist yet ---

  let initPromise = null;
  let knownNames = new Map(); // lower-case name -> real name, so "user_games.json" finds "User_Games.json"

  async function refreshKnownNames() {
    const entries = await fs.readDir(await absPath(JSON_DIR));
    knownNames = new Map(entries.filter(e => e.isFile).map(e => [e.name.toLowerCase(), e.name]));
  }

  function init() {
    return (initPromise ??= (async () => {
      await fs.mkdir(await absPath(JSON_DIR), { recursive: true });
      await fs.mkdir(await absPath(CACHE_DIR), { recursive: true });

      let manifest = [];
      try {
        manifest = await (await fetch(`${JSON_DIR}/_manifest.json`)).json();
      } catch {
        // No bundled data: nothing to seed
      }

      await refreshKnownNames();
      for (const name of manifest) {
        if (knownNames.has(name.toLowerCase())) continue;
        try {
          const response = await fetch(`${JSON_DIR}/${encodeURIComponent(name)}`);
          if (!response.ok) continue;
          await fs.writeTextFile(await absPath(`${JSON_DIR}/${name}`), await response.text());
        } catch (err) {
          console.warn(`Could not seed ${name}:`, err);
        }
      }
      await refreshKnownNames();
    })());
  }

  // Accepts "json/<file>" in any letter case; refuses anything else (no sub folders, no "..")
  function resolveJsonName(subPath) {
    const parts = String(subPath).replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length !== 2 || parts[0].toLowerCase() !== JSON_DIR || parts[1] === '..' || parts[1] === '.') {
      throw new Error(`Path outside the json folder: ${subPath}`);
    }
    return knownNames.get(parts[1].toLowerCase()) ?? parts[1];
  }

  // --- JSON files ---

  async function readJsonText(name) {
    await init();
    const real = knownNames.get(name.toLowerCase()) ?? name;
    try {
      return await fs.readTextFile(await absPath(`${JSON_DIR}/${real}`));
    } catch {
      return null;
    }
  }

  async function writeJsonText(name, text) {
    await init();
    const real = knownNames.get(name.toLowerCase()) ?? name;
    await fs.writeTextFile(await absPath(`${JSON_DIR}/${real}`), text);
    knownNames.set(real.toLowerCase(), real);
  }

  // Adapter used by the scrapers
  const storage = { read: readJsonText, write: writeJsonText };

  // Raw bytes, used by the database updater: the file is hashed exactly as it is on disk
  async function readJsonBytes(name) {
    await init();
    const real = knownNames.get(name.toLowerCase()) ?? name;
    try {
      return await fs.readFile(await absPath(`${JSON_DIR}/${real}`));
    } catch {
      return null;
    }
  }

  // Written to a temporary file first, so an interrupted update never leaves a half written database
  async function writeJsonBytes(name, bytes) {
    await init();
    const real = knownNames.get(name.toLowerCase()) ?? name;
    const destPath = await absPath(`${JSON_DIR}/${real}`);
    const tmpPath = `${destPath}.tmp`;
    try {
      await fs.writeFile(tmpPath, bytes);
      await fs.rename(tmpPath, destPath);
    } catch (err) {
      await fs.remove(tmpPath).catch(() => {});
      throw err;
    }
    knownNames.set(real.toLowerCase(), real);
  }

  async function readConfig() {
    try {
      return JSON.parse(await readJsonText('Options.json')) ?? { SETTINGS: {} };
    } catch {
      return { SETTINGS: {} };
    }
  }

  // --- Image cache ---

  const pendingDownloads = new Map();

  async function downloadImage(url, destPath) {
    const response = await http.fetch(url, { method: 'GET', headers: { Origin: '' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const bytes = new Uint8Array(await response.arrayBuffer());
    const tmpPath = `${destPath}.tmp`;
    try {
      await fs.writeFile(tmpPath, bytes);
      await fs.rename(tmpPath, destPath);
    } catch (err) {
      await fs.remove(tmpPath).catch(() => {});
      throw err;
    }
  }

  // Returns an asset URL of the cached image, or the original URL if the download fails
  async function getCachedImage(imageUrl) {
    if (!/^https?:\/\//i.test(imageUrl || '')) return imageUrl;

    let filename;
    try {
      filename = decodeURIComponent(new URL(imageUrl).pathname.split('/').pop() || '');
    } catch {
      return imageUrl;
    }
    filename = filename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
    if (!filename) return imageUrl;

    await init();
    const localPath = await absPath(`${CACHE_DIR}/${filename}`);

    if (await fs.exists(localPath)) return core.convertFileSrc(localPath);

    // Concurrent requests for the same image share a single download
    if (!pendingDownloads.has(localPath)) {
      const download = downloadImage(imageUrl, localPath).finally(() => pendingDownloads.delete(localPath));
      pendingDownloads.set(localPath, download);
    }

    try {
      await pendingDownloads.get(localPath);
      return core.convertFileSrc(localPath);
    } catch (err) {
      console.error(`Image download failed (${imageUrl}):`, err);
      return imageUrl;
    }
  }

  // --- Scrapers (JavaScript running in the webview) ---

  async function createPsn() {
    const { createPsn } = await import('./psn.js');
    // Use the plugin fetch (Rust side): it can send Cookie, skip redirects and has no CORS limits
    // Origin is set to an empty value on purpose: the plugin then omits it, like Node did (Sony's login can refuse
    // requests that carry the webview origin).
    return createPsn((url, init) => http.fetch(url, { ...init, headers: { ...init?.headers, Origin: '' } }));
  }

  let userScrapeRunning = null;

  // A second call while a run is in progress joins the running one instead of starting another
  function runMyGames() {
    if (!userScrapeRunning) {
      userScrapeRunning = (async () => {
        const { runUserScraper } = await import('./scraper-user.js');
        await runUserScraper({ psn: await createPsn(), storage });
        return true;
      })().finally(() => { userScrapeRunning = null; });
    }
    return userScrapeRunning;
  }

  async function runScraperGame(npwr, tabName) {
    if (!/^NPWR\w+$/i.test(npwr)) throw new Error(`Invalid NPWR id: ${npwr}`);
    const { runGameScraper } = await import('./scraper-game.js');
    return await runGameScraper({ npwr, tabName, psn: await createPsn(), storage });
  }

  // --- Database updater (files published on GitHub, see db-sync.js) ---

  // GitHub refuses requests without a User-Agent. Origin is removed like in the other requests.
  async function githubRequest(url, headers = {}) {
    const response = await http.fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Platiroom', Origin: '', ...headers }
    });

    if (!response.ok) {
      const rateLimited = response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0';
      throw new Error(rateLimited ? 'GitHub rate limit reached, try again later' : `HTTP ${response.status}`);
    }
    return response;
  }

  const githubNet = {
    getJson: async (url) => (await githubRequest(url, { Accept: 'application/vnd.github+json' })).json(),
    getBytes: async (url, headers) => new Uint8Array(await (await githubRequest(url, headers)).arrayBuffer())
  };

  async function syncDatabases(onStatus) {
    const { syncDatabases } = await import('./db-sync.js');
    return await syncDatabases({
      net: githubNet,
      files: { readBytes: readJsonBytes, writeBytes: writeJsonBytes },
      onStatus
    });
  }

  // --- Public API (same shape as the Electron preload) ---

  window.api = {
    getConfig: () => readConfig(),

    saveConfig: async (settings) => {
      try {
        const config = await readConfig();
        config.SETTINGS = { ...config.SETTINGS, ...settings };
        await writeJsonText('Options.json', JSON.stringify(config, null, 2));
        return true;
      } catch (err) {
        console.error('Failed to save Options.json:', err);
        return false;
      }
    },

    readLocalJson: async (subPath) => {
      try {
        await init();
        const text = await readJsonText(resolveJsonName(subPath));
        return text === null ? null : JSON.parse(text);
      } catch (err) {
        console.error(`Failed to read ${subPath}:`, err);
        return null;
      }
    },

    writeLocalJson: async (subPath, data) => {
      try {
        await init();
        await writeJsonText(resolveJsonName(subPath), JSON.stringify(data, null, 2));
        return true;
      } catch (err) {
        console.error(`Failed to write ${subPath}:`, err);
        return false;
      }
    },

    getCachedImage,
    runMyGames,
    runScraperGame,
    syncDatabases,

    openExternal: (url) => {
      if (/^https?:\/\//i.test(url)) opener.openUrl(url).catch(err => console.error('openUrl failed:', err));
    }
  };
})();
