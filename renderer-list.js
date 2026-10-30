// renderer-list.js
// My Games and Custom Tabs: filters, pagination, custom tab management,
// user scores, guide data and the shared game/DLC/trophy list components.

// ==========================================================================
// STATE AND CONFIGURATION
// ==========================================================================

let currentConsole = 'all';
let filterInProgressActive = false;
let alphabeticalSortActive = false;
let currentPage = 1;
let searchText = '';
let noteEditingKey = null;  // game key of the note being edited
let noteTooltipEl = null;   // single shared tooltip element

const ENTRIES_PER_PAGE = 20;
const MAX_CUSTOM_TABS = 6;
const ALL_TAB_KEYS = Array.from({ length: MAX_CUSTOM_TABS }, (_, i) => `Tab${i + 1}`);

// Per-tab state (page, console filter, search), created with the tab controls
const customTabState = {};

let selectedCustomTabKey = null;
let pendingGameDelete = null;   // { game, tabKey } waiting for confirmation
let tabModalMode = 'create';    // 'create' | 'rename'

const CONSOLE_FILTERS = [
  { label: 'All', code: 'all' },
  { label: 'PS3', code: 'PS3' },
  { label: 'PS Vita', code: 'PSVITA' },
  { label: 'PS4', code: 'PS4' },
  { label: 'PS5', code: 'PS5' },
  { label: 'VR', code: 'VR' }
];

// Visible columns of the My Games list (true = shown)
const MYGAMES_COLUMNS_CONFIG = {
  deleteGame: false,   // Delete button (disabled in My Games)
  platinum: true,      // Platinum icon and rarity percentage
  icon: true,          // Game icon
  title: true,         // Title, region, platforms, badges and tags
  trophyCounts: true,  // Trophy counts per type
  progress: true,      // Progress column (games and DLC)
  trophyData: true,    // Rarity/rate and date earned columns (trophy table)
  expand: true,        // Expand arrow
  notes: true          // Note icon (right click to edit)
};

// Visible columns of the Custom Tab lists
const CUSTOM_TABS_COLUMNS_CONFIG = {
  deleteGame: true,
  platinum: true,
  icon: true,
  title: true,
  trophyCounts: true,
  progress: false,
  trophyData: false,
  expand: true,
  notes: true
};

const GUIDE_BADGES = [
  ['psnprofiles.com', 'img/badge_psnp.svg'],
  ['knoef.info', 'img/badge_knoef.svg'],
  ['platget.com', 'img/badge_pg.svg'],
  ['playstationtrophies.org', 'img/badge_pst.svg'],
  ['powerpyx.com', 'img/badge_pp.svg']
];

const TAG_BADGES = [
  { flag: TROPHY_TAGS.BUGGY, className: 'tag-buggy', icon: '🐞\uFE0E', tooltip: 'Buggy Trophies' },
  { flag: TROPHY_TAGS.MISSABLE, className: 'tag-missable', icon: '⚠️', tooltip: 'Missable Trophies' },
  { flag: TROPHY_TAGS.ONLINE, className: 'tag-online', icon: '🌐', tooltip: 'Online Trophies' }
];

// ==========================================================================
// DOM REFERENCES
// ==========================================================================

const gamesContainer = document.getElementById('games-container');
const lblTrophyCount = document.getElementById('lbl-trophy-count');
const btnPrev = document.getElementById('btn-prev-page');
const btnNext = document.getElementById('btn-next-page');
const searchInput = document.getElementById('search-input');

const btnAddTab = document.getElementById('btn-add-tab');
const tabModalDialog = document.getElementById('tab-modal-dialog');
const tabModalTitle = document.getElementById('tab-modal-title');
const txtTabName = document.getElementById('txt-tab-name');
const tabModalError = document.getElementById('tab-modal-error');

const tabDeleteDialog = document.getElementById('tab-delete-dialog');
const tabDeleteMsg = document.getElementById('tab-delete-msg');

const gameDeleteDialog = document.getElementById('game-delete-dialog');
const gameDeleteMsg = document.getElementById('game-delete-msg');

const tabContextMenu = document.getElementById('tab-context-menu');

const noteDialog = document.getElementById('note-dialog');
const noteDialogGame = document.getElementById('note-dialog-game');
const txtNote = document.getElementById('txt-note');

// ==========================================================================
// SHARED LIST HELPERS
// ==========================================================================

function paginate(items, page) {
  const totalPages = Math.max(1, Math.ceil(items.length / ENTRIES_PER_PAGE));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * ENTRIES_PER_PAGE;
  const end = Math.min(start + ENTRIES_PER_PAGE, items.length);

  return { page: safePage, totalPages, start, end, items: items.slice(start, end) };
}

function getPageLabel(total, view) {
  if (total === 0) return 'Showing 0-0 of 0 games';
  return `Showing ${view.start + 1}-${view.end} of ${total} games (Page ${view.page}/${view.totalPages})`;
}

// ==========================================================================
// MY GAMES: FILTERS AND VIEW
// ==========================================================================

function resetMyGamesFilters() {
  currentConsole = 'all';
  filterInProgressActive = false;
  alphabeticalSortActive = false;
  searchText = '';
  currentPage = 1;

  document.querySelectorAll('#console-filters .filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.console === 'all');
  });
  document.getElementById('btn-filter-in-progress').classList.remove('checked');
  document.getElementById('btn-sort-az').classList.remove('checked');
  searchInput.value = '';

  renderView();
}

function setupFilterListeners() {
  const refilter = () => {
    currentPage = 1;
    renderView();
  };
  const scrollListToTop = () => {
    gamesContainer.closest('.scroll-area').scrollTop = 0;
  };

  document.getElementById('console-filters').addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;

    document.querySelectorAll('#console-filters .filter-btn').forEach(b => b.classList.toggle('active', b === btn));
    currentConsole = btn.dataset.console;
    refilter();
  });

  document.getElementById('btn-filter-in-progress').addEventListener('click', (e) => {
    filterInProgressActive = !filterInProgressActive;
    e.currentTarget.classList.toggle('checked', filterInProgressActive);
    refilter();
  });

  document.getElementById('btn-sort-az').addEventListener('click', (e) => {
    alphabeticalSortActive = !alphabeticalSortActive;
    e.currentTarget.classList.toggle('checked', alphabeticalSortActive);
    refilter();
  });

  searchInput.addEventListener('input', (e) => {
    searchText = e.target.value.trim().toLowerCase();
    refilter();
  });

  document.getElementById('btn-clear-search').addEventListener('click', () => {
    searchInput.value = '';
    searchText = '';
    refilter();
  });

  btnPrev.addEventListener('click', () => {
    currentPage--;
    renderView();
    scrollListToTop();
  });

  btnNext.addEventListener('click', () => {
    currentPage++;
    renderView();
    scrollListToTop();
  });
}

async function loadTrophiesData() {
  lblTrophyCount.textContent = 'Loading database asynchronously...';
  lblTrophyCount.style.color = 'var(--brand)';
  lblTrophyCount.style.fontWeight = 'bold';

  try {
    allTrophies = extractGameEntries(await window.api.readLocalJson(DATA_FILES.games));
    renderView();
  } catch (err) {
    console.error(err);
    lblTrophyCount.textContent = 'Error loading data. Check console log.';
    lblTrophyCount.style.color = 'var(--error)';
  }
}

function filterGames() {
  const filtered = allTrophies.filter(game =>
    matchesConsole(game, currentConsole) &&
    !(filterInProgressActive && game.progress === 100) &&
    matchesSearch(game, searchText)
  );

  if (alphabeticalSortActive) {
    filtered.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
  }

  return filtered;
}

function renderView() {
  const games = filterGames();
  updateGlobalTrophyCounts(games);

  const view = paginate(games, currentPage);
  currentPage = view.page;

  gamesContainer.innerHTML = '';
  view.items.forEach(game => gamesContainer.appendChild(createExpandableGameContainer(game)));

  lblTrophyCount.style.color = 'var(--text-main)';
  lblTrophyCount.style.fontWeight = '500';
  lblTrophyCount.textContent = getPageLabel(games.length, view);

  btnPrev.disabled = view.page === 1;
  btnNext.disabled = view.page === view.totalPages;
}

// Redraws My Games and every Custom Tab (used after changing the options)
async function refreshAllLists() {
  renderView();
  for (const tabKey of getExistingCustomTabKeys()) {
    await renderCustomTabView(tabKey);
  }
}

// ==========================================================================
// CUSTOM TABS: UI
// ==========================================================================

const customTabId = (tabKey) => tabKey.toLowerCase();
const getTabButton = (tabKey) => document.querySelector(`.tab-btn[data-tab-key="${tabKey}"]`);

// Existing custom tabs, ordered by slot number (same order as on screen)
function getExistingCustomTabKeys() {
  const slotNumber = (key) => parseInt(key.replace(/\D/g, ''), 10);
  return [...document.querySelectorAll('#tab-bar .tab-btn[data-tab-key]')]
    .map(btn => btn.dataset.tabKey)
    .sort((a, b) => slotNumber(a) - slotNumber(b));
}

async function initTabsSystem() {
  const settings = await getSettings();

  ALL_TAB_KEYS.forEach(key => {
    if (settings[key]) createCustomTabUI(key, settings[key]);
  });

  updateAddTabButtonVisibility();
  setupTabClickHandlers();
  setupContextMenuHandlers();
  setupTabModalHandlers();
}

function updateAddTabButtonVisibility() {
  const isFull = getExistingCustomTabKeys().length >= MAX_CUSTOM_TABS;
  btnAddTab.style.display = isFull ? 'none' : 'inline-flex';
}

function createCustomTabUI(tabKey, tabName) {
  const tabBar = document.getElementById('tab-bar');
  const id = customTabId(tabKey);

  // Tab button, placed before the first tab with a higher slot number
  const btn = createEl('button', 'tab-btn', tabName);
  btn.dataset.tab = id;
  btn.dataset.tabKey = tabKey;

  const slotNumber = (key) => parseInt(key.replace(/\D/g, ''), 10);
  const nextBtn = [...tabBar.querySelectorAll('.tab-btn[data-tab-key]')]
    .find(b => slotNumber(b.dataset.tabKey) > slotNumber(tabKey));
  tabBar.insertBefore(btn, nextBtn || btnAddTab);

  // Tab content
  const section = createEl('section', 'tab-content');
  section.id = `tab-${id}`;
  section.dataset.tabKey = tabKey;
  section.appendChild(createCustomTabControlsBar(tabKey));

  const scrollArea = createEl('main', 'scroll-area');
  const container = createEl('div');
  container.id = `games-container-${id}`;
  scrollArea.appendChild(container);
  section.appendChild(scrollArea);

  document.getElementById('tabs-container').appendChild(section);
}

function createCustomTabControlsBar(tabKey) {
  const id = customTabId(tabKey);

  customTabState[tabKey] = { currentPage: 1, currentConsole: 'all', searchText: '' };

  // State is always looked up by key (tab states can be swapped when tabs are moved)
  const updateTab = (changes) => {
    Object.assign(customTabState[tabKey], changes, { currentPage: 1 });
    renderCustomTabView(tabKey);
  };

  const bar = createEl('div', 'controls-bar');

  // Console filters
  const filterGroup = createEl('div', 'filter-group');
  filterGroup.id = `console-filters-${id}`;
  CONSOLE_FILTERS.forEach(({ label, code }) => {
    const btn = createEl('button', `filter-btn${code === 'all' ? ' active' : ''}`, label);
    btn.dataset.console = code;
    filterGroup.appendChild(btn);
  });
  filterGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    filterGroup.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b === btn));
    updateTab({ currentConsole: btn.dataset.console });
  });
  bar.appendChild(filterGroup);
  bar.appendChild(createEl('div', 'v-separator'));

  // Search
  const searchWrapper = createEl('div', 'search-wrapper');
  const searchField = createEl('input');
  searchField.type = 'text';
  searchField.id = `search-input-${id}`;
  searchField.placeholder = 'Search game...';
  searchField.addEventListener('input', (e) => {
    updateTab({ searchText: e.target.value.trim().toLowerCase() });
  });

  const clearBtn = createEl('button', 'search-clear-btn', '✖');
  clearBtn.id = `btn-clear-search-${id}`;
  clearBtn.title = 'Clear search';
  clearBtn.addEventListener('click', () => {
    searchField.value = '';
    updateTab({ searchText: '' });
  });

  searchWrapper.append(searchField, clearBtn);
  bar.appendChild(searchWrapper);

  // Add game
  const addGameBtn = createEl('button', 'btn-primary btn-add-game', 'Add new game');
  addGameBtn.id = `btn-add-game-${id}`;
  addGameBtn.style.marginLeft = '25px';
  addGameBtn.addEventListener('click', () => openAddGameModal(tabKey));
  bar.appendChild(addGameBtn);

  bar.appendChild(createEl('div', 'spacer'));

  // Counter and pagination
  const countLabel = createEl('span', 'trophy-count-label', 'Showing 0-0 of 0 games');
  countLabel.id = `lbl-trophy-count-${id}`;
  bar.appendChild(countLabel);

  const prevBtn = createEl('button', 'page-btn prev-btn', 'Previous');
  prevBtn.id = `btn-prev-page-${id}`;
  prevBtn.disabled = true;
  prevBtn.addEventListener('click', () => {
    customTabState[tabKey].currentPage--;
    renderCustomTabView(tabKey);
  });

  const nextBtn = createEl('button', 'page-btn next-btn', 'Next');
  nextBtn.id = `btn-next-page-${id}`;
  nextBtn.disabled = true;
  nextBtn.addEventListener('click', () => {
    customTabState[tabKey].currentPage++;
    renderCustomTabView(tabKey);
  });

  bar.append(prevBtn, nextBtn);
  return bar;
}

async function renderCustomTabView(tabKey) {
  const id = customTabId(tabKey);
  const container = document.getElementById(`games-container-${id}`);
  const listName = (await getSettings())[tabKey];
  if (!container || !listName) return;

  const state = customTabState[tabKey];
  const userTabs = await window.api.readLocalJson(DATA_FILES.tabs);

  const games = extractGameEntries(userTabs, listName).filter(game =>
    matchesConsole(game, state.currentConsole) && matchesSearch(game, state.searchText)
  );

  const view = paginate(games, state.currentPage);
  state.currentPage = view.page;

  container.innerHTML = '';
  view.items.forEach(game => container.appendChild(createExpandableGameContainer(game, tabKey)));

  document.getElementById(`lbl-trophy-count-${id}`).textContent = getPageLabel(games.length, view);
  document.getElementById(`btn-prev-page-${id}`).disabled = view.page === 1;
  document.getElementById(`btn-next-page-${id}`).disabled = view.page === view.totalPages;
}

// Updates the filter controls of a tab to match its state
function syncCustomTabControls(tabKey) {
  const state = customTabState[tabKey];
  const id = customTabId(tabKey);

  document.getElementById(`search-input-${id}`).value = state.searchText;
  document.querySelectorAll(`#console-filters-${id} .filter-btn`).forEach(b => {
    b.classList.toggle('active', b.dataset.console === state.currentConsole);
  });
}

// ==========================================================================
// CUSTOM TABS: CONTEXT MENU, MOVE, CREATE, RENAME, DELETE
// ==========================================================================

function setupContextMenuHandlers() {
  const hideMenu = () => { tabContextMenu.style.display = 'none'; };

  document.getElementById('tab-bar').addEventListener('contextmenu', (e) => {
    const btn = e.target.closest('.tab-btn[data-tab-key]');
    if (!btn) return;

    e.preventDefault();
    selectedCustomTabKey = btn.dataset.tabKey;
    updateMoveMenuState(selectedCustomTabKey);

    Object.assign(tabContextMenu.style, {
      left: `${e.clientX}px`,
      top: `${e.clientY}px`,
      display: 'block'
    });
  });

  document.addEventListener('click', (e) => {
    if (!tabContextMenu.contains(e.target)) hideMenu();
  });

  const actions = {
    'ctx-move-left': () => moveCustomTab(-1),
    'ctx-move-right': () => moveCustomTab(1),
    'ctx-rename-tab': openRenameTabModal,
    'ctx-delete-tab': openDeleteTabDialog
  };

  tabContextMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.context-menu-item');
    if (!item || item.classList.contains('disabled')) return;

    hideMenu();
    actions[item.id]();
  });
}

// Move left/right are disabled for the first/last existing tab
function updateMoveMenuState(tabKey) {
  const keys = getExistingCustomTabKeys();
  const idx = keys.indexOf(tabKey);

  document.getElementById('ctx-move-left').classList.toggle('disabled', idx <= 0);
  document.getElementById('ctx-move-right').classList.toggle('disabled', idx >= keys.length - 1);
}

// Swaps the tab with its left (-1) or right (+1) neighbour.
// The position is defined by the slot (Tab1, Tab2...) in Options.json, so the names are swapped.
async function moveCustomTab(direction) {
  const key = selectedCustomTabKey;
  const keys = getExistingCustomTabKeys();
  const other = keys[keys.indexOf(key) + direction];
  if (!other) return;

  const settings = await getSettings();
  const nameA = settings[key];
  const nameB = settings[other];

  // 1. Swap the names in options.json
  await window.api.saveConfig({ [key]: nameB, [other]: nameA });

  // 2. Update the tab labels
  getTabButton(key).textContent = nameB;
  getTabButton(other).textContent = nameA;

  // 3. Page, console filter and search follow the list name
  [customTabState[key], customTabState[other]] = [customTabState[other], customTabState[key]];
  syncCustomTabControls(key);
  syncCustomTabControls(other);

  // 4. Redraw both lists
  await renderCustomTabView(key);
  await renderCustomTabView(other);

  // 5. If one of the two was open, stay on the same list
  if (activeTabId === customTabId(key)) switchTabTo(customTabId(other));
  else if (activeTabId === customTabId(other)) switchTabTo(customTabId(key));
}

function openRenameTabModal() {
  tabModalMode = 'rename';
  tabModalTitle.textContent = 'Rename Custom Tab';
  txtTabName.value = getTabButton(selectedCustomTabKey).textContent;
  tabModalDialog.showModal();
  txtTabName.select();
}

function openDeleteTabDialog() {
  const tabName = getTabButton(selectedCustomTabKey).textContent;
  tabDeleteMsg.textContent = `Are you sure you want to delete tab "${tabName}"?`;
  tabDeleteDialog.showModal();
}

function setupTabModalHandlers() {
  btnAddTab.addEventListener('click', () => {
    tabModalMode = 'create';
    tabModalTitle.textContent = 'New Custom Tab';
    txtTabName.value = '';
    tabModalDialog.showModal();
    txtTabName.focus();
  });

  txtTabName.addEventListener('input', () => { tabModalError.hidden = true; });
  tabModalDialog.addEventListener('close', () => { tabModalError.hidden = true; });
  
  document.getElementById('tab-modal-cancel').addEventListener('click', () => tabModalDialog.close());
  document.getElementById('tab-modal-ok').addEventListener('click', handleSaveTabModal);
  txtTabName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSaveTabModal();
  });

  document.getElementById('tab-delete-cancel').addEventListener('click', () => tabDeleteDialog.close());
  document.getElementById('tab-delete-confirm').addEventListener('click', handleConfirmDeleteTab);
}

async function handleSaveTabModal() {
  const name = txtTabName.value.trim();
  if (!name) return;

  const settings = await getSettings();
  const ownKey = tabModalMode === 'rename' ? selectedCustomTabKey : null;

  // A name can belong to one tab only: the lists are stored under the tab name
  const nameInUse = ALL_TAB_KEYS.some(key =>
    key !== ownKey && settings[key] && settings[key].toLowerCase() === name.toLowerCase()
  );
  if (nameInUse) {
    tabModalError.textContent = `A tab named "${name}" already exists.`;
    tabModalError.hidden = false;
    return;
  }

  if (tabModalMode === 'create') {
    const targetKey = ALL_TAB_KEYS.find(key => !settings[key]);
    if (!targetKey) return;

    await window.api.saveConfig({ [targetKey]: name });
    createCustomTabUI(targetKey, name);
    updateAddTabButtonVisibility();
  } else {
    // The list data is stored under the tab name, so it is renamed as well
    const oldName = settings[ownKey];

    await window.api.saveConfig({ [ownKey]: name });
    getTabButton(ownKey).textContent = name;

    if (oldName && oldName !== name) {
      const userTabs = await window.api.readLocalJson(DATA_FILES.tabs);
      if (userTabs?.[oldName]) {
        userTabs[name] = userTabs[oldName];
        delete userTabs[oldName];
        await window.api.writeLocalJson(DATA_FILES.tabs, userTabs);
      }
    }
  }

  tabModalDialog.close();
  txtTabName.value = '';
}

async function handleConfirmDeleteTab() {
  const tabKey = selectedCustomTabKey;
  const listName = (await getSettings())[tabKey];

  await window.api.saveConfig({ [tabKey]: '' });

  if (listName) {
    const userTabs = await window.api.readLocalJson(DATA_FILES.tabs);
    if (userTabs?.[listName]) {
      delete userTabs[listName];
      await window.api.writeLocalJson(DATA_FILES.tabs, userTabs);
    }
  }

  getTabButton(tabKey).remove();
  document.getElementById(`tab-${customTabId(tabKey)}`).remove();
  delete customTabState[tabKey];

  if (activeTabId === customTabId(tabKey)) switchTabTo('welcome');

  updateAddTabButtonVisibility();
  tabDeleteDialog.close();
}

// ==========================================================================
// CUSTOM TABS: ADD GAME
// ==========================================================================

function formatPsnSearchResult(key, game) {
  const platforms = (game.P || []).join(', ');

  let text = parseGameKey(key).title;
  if (game.R) text += ` [${game.R}]`;
  if (platforms) text += ` [${platforms}]`;
  return text;
}

async function openAddGameModal(tabKey) {
  const dialog = document.getElementById('dlg-add-game');
  const inputSearch = document.getElementById('txt-psn-search');
  const resultsContainer = document.getElementById('psn-search-results');

  inputSearch.value = '';
  resultsContainer.innerHTML = '';
  dialog.showModal();

  const psnGames = await window.api.readLocalJson(DATA_FILES.psnGames);
  if (!psnGames) {
    resultsContainer.innerHTML = '<div class="dialog-message error">Error loading PSN_GamesMini.json</div>';
    return;
  }

  const isUnreleased = (key) => key.toLowerCase().includes('(unreleased)');

  inputSearch.oninput = () => {
    const query = inputSearch.value.trim().toLowerCase();
    resultsContainer.innerHTML = '';
    if (query.length < 3) return;

    const matches = Object.keys(psnGames).filter(key => {
      if (hideUnreleased && isUnreleased(key)) return false;
      const game = psnGames[key];
      return `${key} ${game.R || ''} ${(game.P || []).join(' ')}`.toLowerCase().includes(query);
    });

    if (matches.length === 0) {
      resultsContainer.innerHTML = '<div class="dialog-message">No matches found</div>';
      return;
    }

    const list = createEl('ul', 'psn-results-list');
    matches.forEach(key => {
      const li = createEl('li', 'psn-result-item', formatPsnSearchResult(key, psnGames[key]));
      li.addEventListener('click', async () => {
        dialog.close();
        await addGameToCustomTab(tabKey, key);
      });
      list.appendChild(li);
    });
    resultsContainer.appendChild(list);
  };
}

// Runs the game scraper for the selected game, then redraws the tab
async function addGameToCustomTab(tabKey, gameKey) {
  try {
    const listName = (await getSettings())[tabKey];
    const npwr = parseGameKey(gameKey).npwr;

    if (!listName || !npwr) {
      console.warn(`Cannot add "${gameKey}" to ${tabKey}: missing list name or NPWR id`);
      return;
    }

    await window.api.runScraperGame(npwr, listName);
    await renderCustomTabView(tabKey);
  } catch (err) {
    console.error('Game scraper failed:', err);
  }
}


// ==========================================================================
// GUIDE DATA
// ==========================================================================

const stripDlc = (name) => name.replace(/dlc/gi, '');

// Guide data of a group: the whole entry for the base game,
// the nested entry whose name matches the DLC name otherwise
function getGroupGuideData(guideEntry, group) {
  if (!guideEntry) return null;
  if (isBaseGroup(group)) return guideEntry;
  if (!group.gName) return null;

  const targetName = stripDlc(group.gName).trim().toLowerCase();
  const targetNorm = normalizeTitle(stripDlc(group.gName));

  // DLC entries are the nested objects; the other keys are stats (R, T) and links (G*, W*)
  const dlcEntries = Object.entries(guideEntry)
    .filter(([, val]) => val && typeof val === 'object' && !Array.isArray(val))
    .map(([key, val]) => ({
      val,
      name: stripDlc(key).trim().toLowerCase(),
      norm: normalizeTitle(stripDlc(key))
    }));

  const exact = dlcEntries.find(e => e.name === targetName || e.norm === targetNorm);
  if (exact) return exact.val;

  const partial = dlcEntries.find(e =>
    (e.name.length > 2 && (targetName.includes(e.name) || e.name.includes(targetName))) ||
    (e.norm.length > 2 && (targetNorm.includes(e.norm) || e.norm.includes(targetNorm)))
  );
  return partial ? partial.val : null;
}

// Sum of the estimated hours of all DLC groups (base game excluded)
function getDlcTotalHours(game, guideEntry) {
  if (!guideEntry) return 0;

  let total = 0;
  game.trophyGroups.forEach(group => {
    if (isBaseGroup(group)) return;

    const stats = getGroupGuideData(guideEntry, group)?.R;
    if (Array.isArray(stats) && stats.length >= 3) {
      total += Number(stats[2]) || 0;
    }
  });

  return Math.round(total * 10) / 10;
}

// Guide (G, G2...) and walkthrough (W, W2...) links of a guide entry
function extractGuideLinks(guideData) {
  if (!guideData) return [];

  return Object.entries(guideData)
    .filter(([key, val]) => typeof val === 'string' && /^[GW]\d*$/i.test(key) && val.startsWith('http'))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .map(([key, url]) => ({ type: key[0].toUpperCase(), url }));
}

function getGuideBadgeImage(url) {
  const lowerUrl = url.toLowerCase();
  const badge = GUIDE_BADGES.find(([domain]) => lowerUrl.includes(domain));
  return badge ? badge[1] : null;
}

// ==========================================================================
// UI COMPONENTS
// ==========================================================================

const clampToScale = (n) => Math.min(10, Math.max(1, n));

function createSeparator() {
  return createEl('span', 'guide-separator', '•');
}

function createProgressBarComponent(progress, earned, total) {
  const container = createEl('div', 'progress-container');

  const wrapper = createEl('div', 'progress-bar-wrapper');
  const bar = createEl('div', 'progress-bar');
  bar.style.width = `${progress}%`;
  wrapper.append(bar, createEl('div', 'progress-text', `${progress}%`));

  container.append(wrapper, createEl('div', 'game-count-gold', `${earned} of ${total} Trophies`));
  return container;
}

// Difficulty, playthroughs and hours badges (plus DLC hours) from the guide stats [diff, playthroughs, hours, tags]
function createGuideBadgesComponent(guideStats, dlcHours = 0) {
  if (!Array.isArray(guideStats) || guideStats.length < 3 || guideStats[0] === null) return null;

  const [diff, playThroughs, hours] = guideStats;

  const container = createEl('div', 'guide-stats-wrapper');
  container.style.display = 'inline-flex';
  container.style.gap = '4px';

  const addBadge = (colorIndex, text, tooltip) => {
    container.appendChild(createBadge('div', `guide-stats-badge guide-bg-${colorIndex}`, text, tooltip));
  };

  addBadge(clampToScale(Math.round(Number(diff) || 1)), `${diff}/10`, `Difficulty: ${diff}/10`);
  addBadge(clampToScale(((Number(playThroughs) || 1) * 2) - 1), `${playThroughs}x`, `Playthroughs: ${playThroughs}`);
  addBadge(clampToScale(Math.ceil((Number(hours) || 0) / 12)), `${hours}h`, `Estimated Time: ${hours}h`);

  if (dlcHours > 0) {
    addBadge(clampToScale(Math.ceil(dlcHours / 12)), `DLC:${dlcHours}h`, `DLC Estimated Time: ${dlcHours}h`);
  }

  return container;
}

function createTagBadgesComponent(tagMask) {
  const badges = TAG_BADGES
    .filter(tag => tagMask & tag.flag)
    .map(tag => createBadge('span', `tag-badge ${tag.className}`, tag.icon, tag.tooltip));

  if (badges.length === 0) return null;

  const container = createEl('div', 'tag-badges-wrapper');
  container.style.display = 'inline-flex';
  container.style.gap = '4px';
  container.append(...badges);
  return container;
}

// Appends the guide stats badges and the tag badges, each preceded by a separator
function appendGuideInfo(container, guideStats, dlcHours = 0) {
  const tagMask = Number(guideStats?.[3]) || 0;

  [createGuideBadgesComponent(guideStats, dlcHours), createTagBadgesComponent(tagMask)].forEach(component => {
    if (!component) return;
    container.appendChild(createSeparator());
    container.appendChild(component);
  });
}

function createTrophyCountsComponent(counts, isPS5) {
  const container = createEl('div', 'game-trophy-counts');
  const types = counts.platinum.total > 0 ? TROPHY_TYPES : TROPHY_TYPES.slice(1);
  const prefix = getIconPrefix(isPS5);

  types.forEach(type => {
    const { earned, total } = counts[type];

    const box = createEl('div', 'trophy-type-box');
    if (total === 0) box.style.visibility = 'hidden';

    const img = createEl('img', 'trophy-type-img');
    img.src = `img/${prefix}_${type}.png`;
    img.alt = type;

    // Without earned data (Custom Tabs) only the total is shown
    const text = earned === null ? `${total}` : `${earned}/${total}`;

    box.append(img, createEl('span', `trophy-type-count ${type}`, text));
    container.appendChild(box);
  });

  return container;
}

// Trophies belonging to a group, based on its trophy id range
function getTrophiesForGroup(game, group) {
  if (Array.isArray(group.gRange)) {
    const [minId, maxId] = group.gRange;
    return game.trophies.filter(t => Number(t.tId) >= minId && Number(t.tId) <= maxId);
  }
  return isBaseGroup(group) ? game.trophies : [];
}

// Trophies, counts and progress of a group
function getGroupStats(group, game) {
  const trophies = getTrophiesForGroup(game, group);
  const counts = getTrophyCounts(group, trophies);
  const { earned, total } = sumTrophyCounts(counts);
  const progress = group.progress ?? (total ? Math.round((earned / total) * 100) : 0);

  return { trophies, counts, earned, total, progress };
}

function createTitleCell(game, unobInfo, shutdownInfo, guideEntry) {
  const { container, badges } = createGameNameBlock(game.title, game.R, game.platforms);

  appendGuideInfo(badges, guideEntry?.R, getDlcTotalHours(game, guideEntry));
  if (unobInfo) badges.appendChild(createUnobtainableBadge(unobInfo));
  if (shutdownInfo) badges.appendChild(createShutdownBadge(shutdownInfo));

  return container;
}

function createRarityCell(trophy) {
  const cell = createEl('td', 'center-cell');
  cell.style.fontSize = '12px';
  cell.style.fontWeight = 'bold';

  const rate = parseFloat(trophy.tRate);
  const rarity = trophy.tRarity ? String(trophy.tRarity).replace(/_/g, ' ') : '';

  if (!isNaN(rate)) {
    cell.textContent = `${rate.toFixed(1)}%`;
    if (rarity) {
      const sub = createEl('div', '', rarity);
      sub.style.cssText = 'font-size: 10px; font-weight: normal; color: var(--text-muted);';
      cell.appendChild(sub);
    }
  } else {
    cell.textContent = rarity || '-';
  }
  return cell;
}

function createTrophyRow(trophy, game, config, unobInfo, isEarned) {
  const row = createEl('tr', isEarned ? 'trophy-row-earned' : '');
  const prefix = getIconPrefix(game.isPS5);

  // Icon
  const iconCell = createEl('td', 'center-cell');
  const icon = createEl('img', 'trophy-icon');
  icon.loading = 'lazy';
  setCachedImage(icon, getIconUrl(game, trophy.icon));
  iconCell.appendChild(icon);
  row.appendChild(iconCell);

  // Type
  const type = String(trophy.tType || 'bronze').trim().toLowerCase();
  const typeCell = createEl('td', 'center-cell');
  const typeImg = createEl('img', 'trophy-type-img');
  typeImg.src = `img/${prefix}_${type}.png`;
  typeImg.alt = type;
  typeCell.appendChild(typeImg);
  row.appendChild(typeCell);

  // Rarity
  if (config.trophyData) row.appendChild(createRarityCell(trophy));

  // Warning (unobtainable)
  const warningCell = createEl('td', 'center-cell');
  warningCell.style.fontSize = '12px';
  if (isTrophyUnobtainable(unobInfo, trophy)) {
    const tooltip = [unobInfo.note, unobInfo.submitter].filter(Boolean).join('\n');
    warningCell.appendChild(createBadge('span', 'tag-badge badge-unobtainable', '❌\uFE0E', tooltip));
  }
  row.appendChild(warningCell);

  // Name and description
  const nameCell = createEl('td', '', trophy.tName || 'Trophy');
  nameCell.style.cssText = 'font-weight: bold; font-size: 13px; color: var(--text-main);';
  row.appendChild(nameCell);

  const detailCell = createEl('td', '', trophy.tDetail || '');
  detailCell.style.cssText = 'font-size: 13px; color: var(--text-main);';
  row.appendChild(detailCell);

  // Date earned
  if (config.trophyData) row.appendChild(createDate(trophy.tEarned));

  return row;
}

function createTrophiesTableComponent(trophies, game, config) {
  const table = createEl('table', 'trophies-table');

  table.innerHTML = `
    <thead>
      <tr>
        <th style="width: 70px; text-align: center;">Icon</th>
        <th style="width: 40px; text-align: center;">Type</th>
        ${config.trophyData ? '<th style="width: 60px; text-align: center;">Rarity</th>' : ''}
        <th style="width: 40px; text-align: center;">Warning</th>
        <th style="width: 25%;">Trophy</th>
        <th>Description</th>
        ${config.trophyData ? '<th style="width: 120px; text-align: center;">Date Earned</th>' : ''}
      </tr>
    </thead>
  `;

  const unobInfo = unobtainableMap[game.npCommunicationId];
  const tbody = document.createElement('tbody');

  trophies.forEach(trophy => {
    const isEarned = isTrophyEarned(trophy);
    if (filterInProgressActive && isEarned) return;
    tbody.appendChild(createTrophyRow(trophy, game, config, unobInfo, isEarned));
  });

  table.appendChild(tbody);
  return table;
}

function createExpandArrowCell(cellClass, arrowClass) {
  const cell = createEl('div', cellClass);
  const arrow = createEl('span', arrowClass, '▼');
  cell.appendChild(arrow);
  return { cell, arrow };
}

function createGuideButtonsComponent(links) {
  const container = createEl('div', 'group-guide-links');

  links.forEach(({ type, url }) => {
    const badgePath = getGuideBadgeImage(url);
    if (!badgePath) return;

    const btn = createEl('button', 'guide-btn');

    const img = createEl('img', 'guide-badge-img');
    img.src = badgePath;
    img.alt = type;
    btn.appendChild(img);

    if (type === 'W') btn.appendChild(createEl('span', 'guide-w-overlay', 'W'));
    btn.appendChild(createTooltip(`${type === 'W' ? 'Walkthrough' : 'Guide'}: ${url}`));

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.api.openExternal(url);
    });

    container.appendChild(btn);
  });

  return container;
}

// ==========================================================================
// DLC / GROUP ROWS
// ==========================================================================

function createGroupRow(group, game, stats, groupGuideData, config) {
  const row = createEl('div', 'group-row');
  if (stats.progress === 100) row.classList.add('complete');

  const icon = createEl('img', 'group-icon');
  icon.loading = 'lazy';
  setCachedImage(icon, getIconUrl(game, group.icon));
  row.appendChild(icon);

  const titleContainer = createEl('div', 'group-title-container');
  const name = isBaseGroup(group) ? (group.gName || 'Base Game') : `DLC: ${group.gName}`;
  titleContainer.appendChild(createEl('span', 'group-name', name));
  appendGuideInfo(titleContainer, groupGuideData?.R);
  row.appendChild(titleContainer);

  row.appendChild(createGuideButtonsComponent(extractGuideLinks(groupGuideData)));
  row.appendChild(createTrophyCountsComponent(stats.counts, game.isPS5));

  if (config.progress) {
    row.appendChild(createProgressBarComponent(stats.progress, stats.earned, stats.total));
  }

  row.appendChild(createExpandArrowCell('group-expand-cell', 'group-expand-arrow').cell);
  return row;
}

function createGroupContainer(group, game, stats, groupGuideData, groupsWrapper, config) {
  const container = createEl('div', 'group-container');
  const row = createGroupRow(group, game, stats, groupGuideData, config);
  container.appendChild(row);

  const trophiesBox = createEl('div', 'group-trophies-container');
  if (stats.trophies.length > 0) {
    trophiesBox.appendChild(createTrophiesTableComponent(stats.trophies, game, config));
  } else {
    const emptyMsg = createEl('div', 'no-trophies-msg', 'No trophies found for this DLC.');
    emptyMsg.style.cssText = 'padding: 12px; color: var(--text-muted); font-size: 12px; font-style: italic; text-align: center;';
    trophiesBox.appendChild(emptyMsg);
  }
  container.appendChild(trophiesBox);

  const arrow = row.querySelector('.group-expand-arrow');

  // Expanding a group hides the other groups of the game
  row.addEventListener('click', (e) => {
    if (e.target.closest('.guide-btn, .custom-tooltip')) return;

    const wasExpanded = trophiesBox.style.display === 'block';
    trophiesBox.style.display = wasExpanded ? 'none' : 'block';
    arrow.textContent = wasExpanded ? '▼' : '▲';

    groupsWrapper.querySelectorAll('.group-container').forEach(gc => {
      gc.style.display = (wasExpanded || gc === container) ? '' : 'none';
    });
  });

  return container;
}

// ==========================================================================
// GAME ROW
// ==========================================================================

function createDeleteCell(game, tabKey) {
  const cell = createEl('div', 'game-delete-cell');
  const btn = createEl('button', 'btn-delete-game', '✕');
  btn.title = 'Delete game';

  btn.addEventListener('click', (e) => {
    e.stopPropagation(); // do not expand/collapse the game
    openGameDeleteDialog(game, tabKey);
  });

  cell.appendChild(btn);
  return cell;
}

function createScoreCell(game) {
  const cell = createEl('div', 'user-score-cell');
  updateScoreCellContent(cell, userScoreData[game.key]);
  cell.addEventListener('contextmenu', (e) => openScoreContextMenu(e, game.key, cell));
  return cell;
}

function createPlatinumCell(game) {
  const cell = createEl('div', 'header-icon');
  cell.style.flexDirection = 'column';

  // pRate = [PSN platform, Trophy Hunters]; an empty array means the game has no platinum
  if (game.pRate.length === 0) return cell;

  const earned = (game.eT?.[0] || 0) > 0;

  const img = createEl('img');
  img.src = `img/${getIconPrefix(game.isPS5)}_platinum.png`;
  img.style.width = '30px';
  img.style.height = '30px';
  img.style.opacity = earned ? '1' : '0.4';
  cell.appendChild(img);

  const rate = getPlatinumRate(game.pRate);
  if (rate !== null) {
    const rateSpan = createEl('span', '', `${rate.toFixed(1)}%`);
    rateSpan.style.cssText = 'color: var(--platinum); font-size: 12px; font-weight: bold; line-height: 1; margin-top: 2px;';
    cell.appendChild(rateSpan);
  }

  return cell;
}

function createGameIconCell(game) {
  const cell = createEl('div', 'game-icon-cell');
  const img = createEl('img');
  img.loading = 'lazy';

  const baseGroup = game.trophyGroups.find(isBaseGroup) || game.trophyGroups[0];
  setCachedImage(img, getIconUrl(game, baseGroup.icon));

  cell.appendChild(img);
  return cell;
}

function createUnobtainableBadge(unobInfo) {
  const trophies = unobInfo.trophies || [];
  const isAll = trophies.some(t => String(t).toUpperCase() === 'ALL');

  const tooltip = isAll
    ? 'All trophies are unobtainable'
    : `${trophies.length} unobtainable ${trophies.length === 1 ? 'trophy' : 'trophies'}`;

  return createBadge('span', 'tag-badge badge-unobtainable', '❌\uFE0E', tooltip);
}

function createShutdownBadge(shutdownInfo) {
  const date = shutdownInfo.shutdownTimestamp ? formatDate(shutdownInfo.shutdownTimestamp) : '';

  let tooltip = `Server Shutdown${date ? `: ${date}` : ''}`;
  if (shutdownInfo.note) tooltip += `\n${shutdownInfo.note}`;

  return createBadge('span', 'tag-badge badge-shutdown', '⏳\uFE0E', tooltip);
}

// Expandable game row. tabKey is null for My Games, the tab slot (Tab1...) for Custom Tabs.
function createExpandableGameContainer(game, tabKey = null) {
  const config = tabKey ? CUSTOM_TABS_COLUMNS_CONFIG : MYGAMES_COLUMNS_CONFIG;
  const npwr = game.npCommunicationId;
  const guideEntry = guidesMap[npwr];

  const container = createEl('div', 'game-container');
  const header = createEl('div', `game-header${game.progress === 100 ? ' complete' : ''}`);
  const details = createEl('div', tabKey ? 'game-details with-delete' : 'game-details');

  if (config.deleteGame) header.appendChild(createDeleteCell(game, tabKey));
  if (config.platinum) header.appendChild(createPlatinumCell(game));
  if (config.icon) header.appendChild(createGameIconCell(game));
  if (config.title) header.appendChild(createTitleCell(game, unobtainableMap[npwr], shutdownMap[npwr], guideEntry));

  if (config.trophyCounts || config.progress) {
    const counts = getTrophyCounts(game, game.trophies);

    if (config.trophyCounts) {
      header.appendChild(createTrophyCountsComponent(counts, game.isPS5));
    }
    if (config.progress) {
      const { earned, total } = sumTrophyCounts(counts);
      header.appendChild(createProgressBarComponent(game.progress, earned, total));
    }
  }

  let expandArrow = null;
  if (config.expand) {
    const expand = createExpandArrowCell('expand-icon-cell', 'expand-arrow');
    expandArrow = expand.arrow;
    header.appendChild(expand.cell);
  }

  if (config.notes) header.appendChild(createNoteCell(game));

  // Details (DLC groups and trophy tables) are built the first time the game is expanded
  details.style.display = 'none';
  let detailsRendered = false;

  const renderDetails = () => {
    detailsRendered = true;

    const groupsWrapper = createEl('div', 'groups-wrapper');

    game.trophyGroups.forEach(group => {
      const stats = getGroupStats(group, game);

      // "In Progress" hides completed DLC
      if (filterInProgressActive && stats.progress === 100) return;

      const groupGuideData = getGroupGuideData(guideEntry, group);
      groupsWrapper.appendChild(createGroupContainer(group, game, stats, groupGuideData, groupsWrapper, config));
    });

    details.appendChild(groupsWrapper);
  };

  // Expanding a game hides the other games; collapsing restores the list and closes all its groups
  header.addEventListener('click', (e) => {
  if (e.target.closest('.game-delete-cell, .note-cell, .custom-tooltip')) return;

    const expanding = details.style.display !== 'block';
    if (expanding && !detailsRendered) renderDetails();

    details.style.display = expanding ? 'block' : 'none';
    if (expandArrow) expandArrow.textContent = expanding ? '▲' : '▼';

    container.parentElement.querySelectorAll('.game-container').forEach(c => {
      c.style.display = (expanding && c !== container) ? 'none' : '';
    });

    if (!expanding) {
      details.querySelectorAll('.group-container').forEach(gc => { gc.style.display = ''; });
      details.querySelectorAll('.group-trophies-container').forEach(box => { box.style.display = 'none'; });
      details.querySelectorAll('.group-expand-arrow').forEach(arrow => { arrow.textContent = '▼'; });
    }
  });

  container.append(header, details);
  return container;
}

// ==========================================================================
// GAME NOTES
// ==========================================================================

// Notes are stored by game key in User_Note.json, so a game has the same note in every list.

function updateNoteCell(cell) {
  cell.classList.toggle('has-note', Boolean(noteData[cell.dataset.gameKey]));
}

function createNoteCell(game) {
  const cell = createEl('div', 'note-cell', '📝');
  cell.dataset.gameKey = game.key;
  updateNoteCell(cell);

  cell.addEventListener('mouseenter', () => showNoteTooltip(cell));
  cell.addEventListener('mouseleave', hideNoteTooltip);
  cell.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openNoteDialog(game);
  });

  return cell;
}

function getNoteTooltip() {
  if (!noteTooltipEl) {
    noteTooltipEl = createEl('div', 'note-tooltip');
    document.body.appendChild(noteTooltipEl);
  }
  return noteTooltipEl;
}

function showNoteTooltip(cell) {
  const tip = getNoteTooltip();
  tip.textContent = noteData[cell.dataset.gameKey] || 'Right-click to add a note';

  // Measured at 0,0 so the width does not depend on the previous position
  tip.style.left = '0px';
  tip.style.top = '0px';
  tip.style.display = 'block';

  const cellRect = cell.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  const margin = 8;

  // Right edge aligned with the cell; above the icon if there is room, below otherwise
  const above = cellRect.top - tipRect.height - 6;
  tip.style.left = `${Math.max(margin, cellRect.right - tipRect.width)}px`;
  tip.style.top = `${above >= margin ? above : cellRect.bottom + 6}px`;
}

function hideNoteTooltip() {
  if (noteTooltipEl) noteTooltipEl.style.display = 'none';
}

function openNoteDialog(game) {
  hideNoteTooltip();
  noteEditingKey = game.key;
  noteDialogGame.textContent = game.title;
  txtNote.value = noteData[game.key] || '';
  noteDialog.showModal();
  txtNote.focus();
}

async function saveNote() {
  if (noteEditingKey === null) return;

  const key = noteEditingKey;
  const text = txtNote.value.trim();

  // An empty note is removed from the file
  if (text) noteData[key] = text;
  else delete noteData[key];

  if (!(await window.api.writeLocalJson(DATA_FILES.notes, noteData))) {
    console.error('Failed to save User_Note.json');
  }

  // Updates the icons in place: a full redraw would collapse the expanded games
  document.querySelectorAll('.note-cell').forEach(cell => {
    if (cell.dataset.gameKey === key) updateNoteCell(cell);
  });

  noteEditingKey = null;
  noteDialog.close();
}

function setupNoteDialogHandlers() {
  document.getElementById('note-cancel').addEventListener('click', () => noteDialog.close());
  document.getElementById('note-ok').addEventListener('click', saveNote);

  // The tooltip is fixed: hide it when the list scrolls under the mouse
  document.addEventListener('scroll', hideNoteTooltip, true);
}

// ==========================================================================
// GAME REMOVAL
// ==========================================================================

function openGameDeleteDialog(game, tabKey) {
  pendingGameDelete = { game, tabKey };
  gameDeleteMsg.textContent = `Are you sure you want to delete "${game.title}"?`;
  gameDeleteDialog.showModal();
}

function setupGameDeleteModalHandlers() {
  document.getElementById('game-delete-cancel').addEventListener('click', () => {
    pendingGameDelete = null;
    gameDeleteDialog.close();
  });

  document.getElementById('game-delete-confirm').addEventListener('click', async () => {
    if (pendingGameDelete) {
      const { game, tabKey } = pendingGameDelete;
      pendingGameDelete = null;
      await removeGame(game, tabKey);
    }
    gameDeleteDialog.close();
  });
}

// Removes a game from its JSON file (User_Games.json or its list in User_Tabs.json) and redraws the list
async function removeGame(game, tabKey) {
  try {
    if (tabKey) {
      const listName = (await getSettings())[tabKey];
      const userTabs = await window.api.readLocalJson(DATA_FILES.tabs);

      if (listName && userTabs?.[listName]) {
        delete userTabs[listName][game.key];
        await window.api.writeLocalJson(DATA_FILES.tabs, userTabs);
      }
      await renderCustomTabView(tabKey);
    } else {
      const userGames = (await window.api.readLocalJson(DATA_FILES.games)) || {};

      delete userGames[game.key];
      await window.api.writeLocalJson(DATA_FILES.games, userGames);

      allTrophies = allTrophies.filter(g => g.key !== game.key);
      renderView();
    }
  } catch (err) {
    console.error('Error removing game:', err);
  }
}
