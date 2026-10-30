// renderer-global.js
// Shared state and helpers, data loaders, header, tab switching, options/scraping dialogs and app startup.
// Must be loaded first: the other renderer files rely on everything defined here.

// ==========================================================================
// STATE
// ==========================================================================

let allTrophies = [];
let unobtainableMap = {};   // NPWR id -> unobtainable entry
let shutdownData = null;    // raw PSNP+ shutdown file (used by the Welcome tab)
let shutdownMap = {};       // NPWR id -> shutdown entry
let guidesMap = {};         // NPWR id -> guide entry
let stylePrefix = 'c';
let platinumRarity = 'PSN platform';
let hideUnreleased = true;
let activeTabId = 'welcome';
let noteData = {};   // game key -> note text

// ==========================================================================
// CONSTANTS
// ==========================================================================

const DATA_FILES = {
  account: 'json/User_Account.json',
  games: 'json/User_Games.json',
  tabs: 'json/User_Tabs.json',
  psnGames: 'json/PSN_GamesMini.json',
  guides: 'json/PSNP+_Guides.json',
  unobtainables: 'json/PSNP+_Unobtainables.json',
  shutdowns: 'json/PSNP+_Shutdown.json',
  notes: 'json/User_Note.json',
  stats: 'json/User_Stat.json'
};

const STYLE_PREFIXES = { Classic: 'c', Modern: 'm', Platform: 'p' };

const TROPHY_TYPES = ['platinum', 'gold', 'silver', 'bronze'];

// Trophy tag bitmask
const TROPHY_TAGS = {
  BUGGY: 1,
  MISSABLE: 2,
  ONLINE: 4
};

// Header trophy counters: element ids per trophy type
const HEADER_COUNTERS = {
  platinum: { count: 'count-plat', icon: 'header-plat' },
  gold: { count: 'count-gold', icon: 'header-gold' },
  silver: { count: 'count-silver', icon: 'header-silver' },
  bronze: { count: 'count-bronze', icon: 'header-bronze' }
};

// ==========================================================================
// DOM REFERENCES
// ==========================================================================

const avatarImg = document.getElementById('avatar');
const avatarPlaceholder = document.getElementById('avatar-placeholder');
const accountNameLbl = document.getElementById('account-name');

const optionsDialog = document.getElementById('options-dialog');
const chkHideUnreleased = document.getElementById('chk-hide-unreleased');
const btnOptionsCancel = document.getElementById('options-cancel');
const btnOptionsOk = document.getElementById('options-ok');

const scrapingDialog = document.getElementById('scraping-dialog');
const txtNpsso = document.getElementById('txt-npsso');
const btnGetData = document.getElementById('btn-get-data');
const btnScrapingCancel = document.getElementById('scraping-cancel');
const btnScrapingOk = document.getElementById('scraping-ok');

// ==========================================================================
// HELPERS
// ==========================================================================

function createEl(tag, className = '', text = '') {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

function createTooltip(text) {
  return createEl('div', 'custom-tooltip', text);
}

// Badge with an optional tooltip
function createBadge(tag, className, text, tooltipText = '') {
  const badge = createEl(tag, className);
  badge.appendChild(document.createTextNode(text));
  if (tooltipText) badge.appendChild(createTooltip(tooltipText));
  return badge;
}

async function getSettings() {
  const config = await window.api.getConfig();
  return config.SETTINGS || {};
}

function normalizeTitle(str) {
  return str
    .replace(/^ea\s+sports\s+/i, '')
    .toLowerCase()
    .replace(/[\p{P}\p{Z}]/gu, '');
}

function formatDate(timestamp) {
  return new Date(timestamp).toISOString().split('T')[0];
}

function isBaseGroup(group) {
  return group.gId === '000' || (group.gName || '').trim().toLowerCase() === 'base game';
}

function isTrophyEarned(trophy) {
  return Boolean(trophy.tEarned);
}

// Trophy icon set: with the "Platform" style, PS5 games use the modern icons and the others the classic ones
function getIconPrefix(isPS5) {
  return stylePrefix === 'p' ? (isPS5 ? 'm' : 'c') : stylePrefix;
}

// Full URL of an icon file stored next to the game (game icon, DLC icon, trophy icon)
function getIconUrl(game, iconFile) {
  return iconFile && game.iconUrl ? `${game.iconUrl}${iconFile}` : '';
}

// Loads an image through the local cache; hides it if it is missing or fails to load
function setCachedImage(img, url) {
  if (!url) {
    img.style.visibility = 'hidden';
    return;
  }
  img.onerror = () => { img.style.visibility = 'hidden'; };
  window.api.getCachedImage(url).then((src) => { img.src = src; });
}

function matchesConsole(game, consoleCode) {
  if (consoleCode === 'all') return true;

  const platforms = game.platforms.map(p => p.toLowerCase());
  if (consoleCode === 'VR') {
    return platforms.some(p => ['vr', 'psvr', 'psvr2'].includes(p));
  }
  return platforms.includes(consoleCode.toLowerCase());
}

function matchesSearch(game, text) {
  if (!text) return true;
  const scope = `${game.title} ${game.platforms.join(' ')} ${game.R || ''} ${game.npCommunicationId}`;
  return scope.toLowerCase().includes(text);
}

// Platform badge: text on the platform color (styled in style.css)
const PLATFORM_LABELS = { psvita: 'VITA', psvr: 'PS VR', psvr2: 'PS VR2' };

function createPlatformBadge(platform) {
  const key = platform.toUpperCase().includes('VITA') ? 'psvita' : platform.toLowerCase();
  const label = PLATFORM_LABELS[key] || platform.toUpperCase();
  return createEl('div', `badge-plat badge-plat-${key}`, label);
}

const pad2 = (n) => String(n).padStart(2, '0');

function createDate(earnedValue) {
  const cell = createEl('td', 'center-cell');
  cell.style.fontSize = '13px';

  if (!earnedValue) {
    cell.textContent = '—';
    cell.style.color = 'var(--text-muted)';
    return cell;
  }

  cell.style.color = 'var(--text-main)';
  const date = new Date(earnedValue);

  if (isNaN(date.getTime())) {
    cell.textContent = String(earnedValue);
  } else {
    const day = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
    cell.innerHTML = `<div>${day}</div><div>${time}</div>`;
  }
  return cell;
}

// pRate = [PSN platform, Trophy Hunters]: the "Platinum rarity" option decides which one is used
function getPlatinumRate(pRate) {
  const rate = parseFloat(pRate?.[platinumRarity === 'Trophy Hunters' ? 1 : 0]);
  return isNaN(rate) ? null : rate;
}

// Title (with region tag) and platform badges, shared by the game lists and the Platiroom.
// "badges" is returned so callers can append more badges after the platforms.
function createGameNameBlock(title, region, platforms) {
  const container = createEl('div', 'game-title-container');

  const titleEl = createEl('div', 'game-title', title);
  const regionText = String(region || '').trim();
  if (regionText) titleEl.appendChild(createEl('span', 'game-region-tag', `[${regionText}]`));
  container.appendChild(titleEl);

  const badges = createEl('div', 'game-badges-inline');
  platforms.forEach(platform => badges.appendChild(createPlatformBadge(platform)));
  container.appendChild(badges);

  return { container, badges };
}

// ==========================================================================
// GAME DATA NORMALIZATION
// ==========================================================================

function extractNpwrIds(key) {
  return (key.match(/NPWR\w+/gi) || []).map(id => id.toUpperCase());
}

// "Game title (NPWR12345)" -> { title, npwr }
function parseGameKey(key) {
  return {
    title: key.replace(/\s*\(NPWR\w+\)\s*$/i, '').trim(),
    npwr: extractNpwrIds(key)[0] || ''
  };
}

// Single normalizer for every game list (My Games and Custom Tabs).
// - listName given: games are read from jsonData[listName] (user_tabs)
// - listName omitted: games are read from the root of jsonData (user_games)
function extractGameEntries(jsonData, listName = null) {
  const source = listName ? jsonData?.[listName] : jsonData;
  if (!source || typeof source !== 'object') return [];

  const games = [];

  for (const [key, value] of Object.entries(source)) {
    // Keys starting with "__" hold metadata, not games
    if (key.startsWith('__') || !value || typeof value !== 'object') continue;

    const { title, npwr } = parseGameKey(key);
    const platforms = (value.P || []).filter(p => String(p).toUpperCase() !== 'PSPC');
    const progress = value.progress ?? 0;

    games.push({
      ...value,
      key,
      title,
      npCommunicationId: npwr,
      platforms,
      isPS5: platforms.some(p => String(p).toUpperCase() === 'PS5'),
      iconUrl: value.url || '',
      progress,
      pRate: value.pRate || [],
      trophies: value.trophies || [],
      trophyGroups: Array.isArray(value.Group) && value.Group.length > 0
        ? value.Group
        : [{ gId: '000', gName: 'Base Game', progress }]
    });
  }

  return games;
}

// ==========================================================================
// TROPHY COUNTS
// ==========================================================================

// Counts per trophy type for a game or a DLC group (anything with dT/eT arrays).
// earned is null when the source has no earned data (Custom Tabs).
function getTrophyCounts(source, trophies = []) {
  const counts = {};

  if (Array.isArray(source.dT) && source.dT.length > 0) {
    const hasEarned = Array.isArray(source.eT);
    TROPHY_TYPES.forEach((type, i) => {
      counts[type] = {
        earned: hasEarned ? (source.eT[i] ?? 0) : null,
        total: source.dT[i] || 0
      };
    });
    return counts;
  }

  // No dT array: count from the trophy list
  TROPHY_TYPES.forEach(type => { counts[type] = { earned: 0, total: 0 }; });
  trophies.forEach(trophy => {
    const type = String(trophy.tType).trim().toLowerCase();
    if (!counts[type]) return;
    counts[type].total++;
    if (isTrophyEarned(trophy)) counts[type].earned++;
  });
  return counts;
}

function sumTrophyCounts(counts) {
  let earned = 0;
  let total = 0;
  for (const type of Object.values(counts)) {
    earned += type.earned ?? 0;
    total += type.total;
  }
  return { earned, total };
}

// Header counters (and icon set) for the games currently shown in My Games
function updateGlobalTrophyCounts(games) {
  const totals = { platinum: 0, gold: 0, silver: 0, bronze: 0 };

  for (const game of games) {
    const counts = getTrophyCounts(game, game.trophies);
    TROPHY_TYPES.forEach(type => { totals[type] += counts[type].earned ?? 0; });
  }

  const headerPrefix = stylePrefix === 'p' ? 'm' : stylePrefix;

  for (const [type, ids] of Object.entries(HEADER_COUNTERS)) {
    document.getElementById(ids.count).textContent = totals[type];
    document.getElementById(ids.icon).src = `img/${headerPrefix}_${type}.png`;
  }
}

// ==========================================================================
// DATA LOADERS
// ==========================================================================

// Maps every NPWR id found in the keys of a PSNP+ file to its entry
function buildNpwrMap(data, accept = () => true) {
  const map = {};
  for (const [key, entry] of Object.entries(data || {})) {
    if (!entry || !accept(entry)) continue;
    extractNpwrIds(key).forEach(id => { map[id] = entry; });
  }
  return map;
}

async function loadSettings() {
  const settings = await getSettings();
  stylePrefix = STYLE_PREFIXES[settings['Trophy Style']] || 'c';
  platinumRarity = settings['Platinum rarity'] || 'PSN platform';
  hideUnreleased = settings['Hide unreleased'] !== false;
}

async function loadProfileInfo() {
  const data = await window.api.readLocalJson(DATA_FILES.account);
  if (!data) return;

  if (data.onlineId) {
    accountNameLbl.textContent = String(data.onlineId).trim();
  }

  if (data.icon) {
    avatarImg.style.display = 'inline-block';
    avatarPlaceholder.style.display = 'none';
    avatarImg.src = await window.api.getCachedImage(String(data.icon).trim());
  }

  // Tier & Level
  const tierWidget = document.getElementById('account-level-widget');
  const tierIcon = document.getElementById('tier-icon');
  const accountLevelLbl = document.getElementById('account-level');

  if (tierWidget && data.tier !== undefined) {
    const tier = parseInt(data.tier, 10);

    if (tierIcon) {
      tierIcon.src = `img/Tier_${tier}.png`;
    }

    if (accountLevelLbl && data.level !== undefined) {
      accountLevelLbl.textContent = String(data.level);

      // Dynamic color
      accountLevelLbl.className = 'account-level';
      if (tier >= 1 && tier <= 3) {
        accountLevelLbl.classList.add('bronze');
      } else if (tier >= 4 && tier <= 6) {
        accountLevelLbl.classList.add('silver');
      } else if (tier >= 7 && tier <= 9) {
        accountLevelLbl.classList.add('gold');
      } else if (tier >= 10) {
        accountLevelLbl.classList.add('platinum');
      }
    }

    tierWidget.style.display = 'flex';
  }
}

async function loadUnobtainableData() {
  unobtainableMap = buildNpwrMap(await window.api.readLocalJson(DATA_FILES.unobtainables));
}

async function loadShutdownData() {
  shutdownData = await window.api.readLocalJson(DATA_FILES.shutdowns);
  shutdownMap = buildNpwrMap(shutdownData);
}

async function loadGuidesData() {
  guidesMap = buildNpwrMap(await window.api.readLocalJson(DATA_FILES.guides), entry => Array.isArray(entry.R));
}

async function loadNoteData() {
  const data = await window.api.readLocalJson(DATA_FILES.notes);
  noteData = data && typeof data === 'object' ? data : {};
}

// A trophy is unobtainable if the list contains "ALL" or its id
function isTrophyUnobtainable(unobInfo, trophy) {
  const list = unobInfo?.trophies;
  if (!Array.isArray(list)) return false;
  return list.some(id => String(id).toUpperCase() === 'ALL' || Number(id) === Number(trophy.tId));
}

// ==========================================================================
// TABS
// ==========================================================================

function setupTabClickHandlers() {
  document.getElementById('tab-bar').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (!btn || btn.classList.contains('add-tab-btn')) return;

    const targetTab = btn.dataset.tab;
    if (activeTabId === 'my-games' && targetTab !== 'my-games') {
      resetMyGamesFilters();
    }
    switchTabTo(targetTab);
  });
}

function switchTabTo(tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

  const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
  if (btn) btn.classList.add('active');
  document.getElementById(`tab-${tabId}`)?.classList.add('active');

  activeTabId = tabId;
    if (tabId === 'platiroom') renderPlatiroom();
    if (tabId === 'statistics') renderStatistics();

  // Custom tabs are rendered when they are shown
  if (/^tab\d+$/.test(tabId) && btn) {
    renderCustomTabView(btn.dataset.tabKey);
  }
}


// ==========================================================================
// OPTIONS DIALOG
// ==========================================================================

// Marks as checked the button whose data-<attribute> equals value
function markChecked(attribute, value) {
  optionsDialog.querySelectorAll(`[data-${attribute}]`).forEach(btn => {
    btn.classList.toggle('checked', btn.dataset[attribute] === value);
  });
}

async function openOptionsDialog() {
  const settings = await getSettings();

  markChecked('style', settings['Trophy Style'] || 'Classic');
  markChecked('rarity', settings['Platinum rarity'] || 'PSN platform');
  chkHideUnreleased.checked = settings['Hide unreleased'] !== false;

  optionsDialog.showModal();
}

async function saveOptions() {
  const getChecked = (attribute, fallback) =>
    optionsDialog.querySelector(`[data-${attribute}].checked`)?.dataset[attribute] ?? fallback;

  await window.api.saveConfig({
    'Trophy Style': getChecked('style', 'Classic'),
    'Platinum rarity': getChecked('rarity', 'PSN platform'),
    'Hide unreleased': chkHideUnreleased.checked
  });

  await loadSettings();
  optionsDialog.close();
  await refreshAllLists();
  renderPlatiroom();
  if (activeTabId === 'statistics') renderStatistics();
}

function setupOptionsDialog() {
  // Each group of style buttons behaves like a radio group
  optionsDialog.querySelectorAll('.dialog-style-buttons').forEach(group => {
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('.style-select-btn');
      if (!btn) return;
      group.querySelectorAll('.style-select-btn').forEach(b => b.classList.toggle('checked', b === btn));
    });
  });

  btnOptionsCancel.addEventListener('click', () => optionsDialog.close());
  btnOptionsOk.addEventListener('click', saveOptions);
}

// ==========================================================================
// SCRAPING DIALOG
// ==========================================================================

function updateScraperButtonState() {
  btnGetData.disabled = txtNpsso.value.trim().length !== 64;
}

async function openScrapingDialog() {
  const settings = await getSettings();
  txtNpsso.value = settings.NPSSO || '';
  updateScraperButtonState();
  scrapingDialog.showModal();
}

async function handleGetData() {
  try {
    btnGetData.disabled = true;
    btnGetData.textContent = 'Retrieving user data...';

    // The scraper reads the token from options.json, so save it first
    await window.api.saveConfig({ NPSSO: txtNpsso.value.trim() });
    await window.api.runMyGames();
    await loadStatData();
    if (activeTabId === 'platiroom') renderPlatiroom();
	if (activeTabId === 'statistics') renderStatistics();
	
    btnGetData.textContent = 'Data Updated!';
    await loadTrophiesData();
  } catch (err) {
    console.error('Error while scraping user data:', err);
    btnGetData.textContent = 'Error running script';
  } finally {
    setTimeout(() => {
      btnGetData.textContent = 'Get your data';
      updateScraperButtonState();
    }, 3000);
  }
}

async function saveScrapingConfig() {
  await window.api.saveConfig({ NPSSO: txtNpsso.value.trim() });
  scrapingDialog.close();
}

// ==========================================================================
// GLOBAL LISTENERS
// ==========================================================================

function setupGlobalListeners() {
  document.getElementById('btn-options-dialog').addEventListener('click', openOptionsDialog);
  document.getElementById('btn-scraping-dialog').addEventListener('click', openScrapingDialog);

  txtNpsso.addEventListener('input', updateScraperButtonState);
  btnGetData.addEventListener('click', handleGetData);
  btnScrapingCancel.addEventListener('click', () => scrapingDialog.close());
  btnScrapingOk.addEventListener('click', saveScrapingConfig);

  // Every link opens in the default browser; "#" placeholder links do nothing
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href]');
    if (!link) return;

    e.preventDefault();
    const url = link.getAttribute('href');
    if (/^https?:\/\//i.test(url)) window.api.openExternal(url);
  });
}

// ==========================================================================
// STARTUP
// ==========================================================================

document.addEventListener('DOMContentLoaded', async () => {
  setupGlobalListeners();
  setupOptionsDialog();
  setupFilterListeners();
  setupGameDeleteModalHandlers();
  setupNoteDialogHandlers();

  switchTabTo('welcome');

  await Promise.all([
    loadSettings(),
    loadUnobtainableData(),
    loadShutdownData(),
    loadGuidesData(),
    loadProfileInfo(),
	loadNoteData(),
	loadStatData()
  ]);

  renderShutdownList();
  initDatabaseSync();
  await initTabsSystem();
  await loadTrophiesData();
});
