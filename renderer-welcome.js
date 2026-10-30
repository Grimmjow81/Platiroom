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
  updated: 'UPDATE',
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

function renderShutdownList() {
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

    const li = createEl('li', 'shutdown-item');
    li.appendChild(createEl('span', 'shutdown-date', formatDate(entry.shutdownTimestamp)));
    li.appendChild(createEl('span', 'shutdown-title', parseGameKey(key).title));
    li.appendChild(createEl('span', 'shutdown-platforms', `[${platforms}]`));

    if (entry.note) li.appendChild(createTooltip(entry.note));

    listEl.appendChild(li);
  });
}
