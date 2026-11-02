// renderer-welcome.js
// Welcome tab: database status (automatic update from GitHub) and list of upcoming server shutdowns
// (data loaded by renderer-global.js).

// ==========================================================================
// DATABASE STATUS
// ==========================================================================

// Text shown next to the database image (the state names are also the css classes of .db-badge)
const DB_STATUS_LABELS = {
  checking: 'CHECKING...',
  'up-to-date': 'UP-TO-DATE',
  updated: 'UPDATED',
  error: 'ERROR',
  disabled: 'DISABLED'
};

// group = key of DB_GROUPS in web/db-sync.js; the list is the <ul> of its column in index.html
const DB_ROWS = [
  { group: 'psnp', listId: 'db-status-list', image: 'img/DB_PSNP%2B.svg', alt: 'PSNP+ DB' },
  { group: 'games', listId: 'platiroom-db-status-list', image: 'img/DB_Games.svg', alt: 'Platiroom DB' }
];

// Image of the database with the status text on its right; "detail" is the tooltip of the text
function renderDbStatus(group, state, detail = '') {
  const row = DB_ROWS.find(r => r.group === group);
  const listEl = row && document.getElementById(row.listId);
  if (!listEl) return;

  const img = createEl('img', 'db-image');
  img.src = row.image;
  img.alt = row.alt;

  const badge = createEl('span', `db-badge ${state}`, DB_STATUS_LABELS[state]);
  if (detail) badge.title = detail;

  const item = createEl('li', 'db-status-item');
  item.append(img, badge);

  listEl.innerHTML = '';
  listEl.appendChild(item);
}

function describeDbResult({ status, changed, errors }) {
  if (status === 'error') {
    return errors.map(e => (e.name ? `${e.name}: ${e.message}` : e.message)).join('\n');
  }
  return status === 'updated' ? `Updated: ${changed.join(', ')}` : 'Already up to date';
}

// The PSNP+ files are read at startup: after an update the data in memory and the lists that use it are refreshed.
// (PSN_GamesMini.json is read every time it is needed, so it does not require this.)
async function reloadPsnpData() {
  await Promise.all([loadUnobtainableData(), loadShutdownData(), loadGuidesData()]);
  renderShutdownList();
  await refreshAllLists();
  if (activeTabId === 'statistics') renderStatistics();
}

// Runs in the background after the app is open; never throws.
// "Auto update databases": false in the SETTINGS of json/Options.json turns it off (useful while editing the databases by hand).
async function initDatabaseSync() {
  const groups = DB_ROWS.map(row => row.group);

  try {
    if ((await getSettings())['Auto update databases'] === false) {
      groups.forEach(group => renderDbStatus(group, 'disabled', 'Automatic update is turned off in Options.json'));
      return;
    }

    groups.forEach(group => renderDbStatus(group, 'checking'));

    const results = await window.api.syncDatabases((group, result) => {
      renderDbStatus(group, result.status, describeDbResult(result));
    });

    // Also after a partial failure: the files that were downloaded are already on disk
    if (results.psnp?.changed.length > 0) await reloadPsnpData();
  } catch (err) {
    console.error('Database update failed:', err);
    groups.forEach(group => renderDbStatus(group, 'error', String(err?.message ?? err)));
  }
}

// ==========================================================================
// UPCOMING SHUTDOWNS
// ==========================================================================

// "NPWR12345_00" and "NPWR12345" are the same game
const toBaseNpwr = (id) => String(id).toUpperCase().replace(/_\d+$/, '');

// Games of the user, read from the files so the result does not depend on what is already loaded in memory:
// { mine: Set of NPWR ids in My Games, lists: Map of NPWR id -> names of the custom lists that contain it }
async function findUserGames() {
  const mine = new Set();
  const lists = new Map();

  const userGames = await window.api.readLocalJson(DATA_FILES.games);
  for (const key of Object.keys(userGames || {})) {
    if (key.startsWith('__')) continue;   // metadata, not a game
    extractNpwrIds(key).forEach(id => mine.add(toBaseNpwr(id)));
  }

  // Only the lists that have a tab count: data left over from a deleted tab is not visible to the user
  const settings = await getSettings();
  const listNames = Object.entries(settings)
    .filter(([key, name]) => /^Tab\d+$/.test(key) && name)
    .map(([, name]) => name);

  const userTabs = await window.api.readLocalJson(DATA_FILES.tabs);
  for (const listName of listNames) {
    for (const key of Object.keys(userTabs?.[listName] || {})) {
      if (key.startsWith('__')) continue;
      for (const id of extractNpwrIds(key).map(toBaseNpwr)) {
        const names = lists.get(id) || [];
        if (!names.includes(listName)) names.push(listName);
        lists.set(id, names);
      }
    }
  }

  return { mine, lists };
}

// Only the last call may draw: the games are read asynchronously, so an older call can finish after a newer one
let shutdownRenderId = 0;

// Red name: the game is in My Games. Yellow name: it is in a custom list (if both, red).
// Called at startup, after the databases are updated, when the Welcome tab is shown and after the account scraper.
async function renderShutdownList() {
  const renderId = ++shutdownRenderId;

  let userGames = { mine: new Set(), lists: new Map() };
  if (shutdownData) {
    try {
      userGames = await findUserGames();
    } catch (err) {
      console.error('Could not read the games of the user for the shutdown list:', err);
    }
  }
  if (renderId !== shutdownRenderId) return;

  const listEl = document.getElementById('shutdown-status-list');
  listEl.innerHTML = '';

  const showMessage = (text, color) => {
    const li = createEl('li', 'shutdown-item', text);
    li.style.color = color;
    listEl.appendChild(li);
  };

  if (!shutdownData) {
    showMessage('No shutdown data available.', 'var(--text-muted)');
    return;
  }

  const upcoming = Object.entries(shutdownData)
    .filter(([, entry]) => entry?.shutdownTimestamp)
    .sort(([, a], [, b]) => a.shutdownTimestamp - b.shutdownTimestamp);

  if (upcoming.length === 0) {
    showMessage('No upcoming shutdowns recorded.', 'var(--text-muted)');
    return;
  }

  upcoming.forEach(([key, entry]) => {
    const platforms = (entry.P || [])
      .filter(p => p.toLowerCase() !== 'pspc')
      .join(', ')
      .toUpperCase();

    const ids = extractNpwrIds(key).map(toBaseNpwr);
    const inMyGames = ids.some(id => userGames.mine.has(id));
    const listNames = [...new Set(ids.flatMap(id => userGames.lists.get(id) || []))];

    // The name is a box (red: in My Games, yellow: in a custom list) only if the user has the game;
    // its tooltip says where, in the same style as the other tooltips
    const nameEl = createEl('span', 'shutdown-name', parseGameKey(key).title);
    if (inMyGames) {
      nameEl.classList.add('in-mygames');
      nameEl.appendChild(createTooltip('In My Games'));
    } else if (listNames.length > 0) {
      nameEl.classList.add('in-custom-list');
      nameEl.appendChild(createTooltip(`In custom list: ${listNames.join(', ')}`));
    }
    const titleEl = createEl('span', 'shutdown-title');
    titleEl.appendChild(nameEl);

    const li = createEl('li', 'shutdown-item');
    li.appendChild(createEl('span', 'shutdown-date', formatDate(entry.shutdownTimestamp)));
    li.appendChild(titleEl);
    li.appendChild(createEl('span', 'shutdown-platforms', `[${platforms}]`));

    if (entry.note) li.appendChild(createTooltip(entry.note));

    listEl.appendChild(li);
  });
}
