// Single game scraper (port of DB_Game.js): fetches the trophy list of one game and stores it in a custom tab.
// `psn` and `storage` are injected, see scraper-user.js.

const OUTPUT_FILE = 'User_Tabs.json';
const CONFIG_FILE = 'Options.json';
const PSN_GAMES_FILE = 'PSN_GamesMini.json';

const trophyTypeIndexMap = {
  platinum: 0,
  gold: 1,
  silver: 2,
  bronze: 3
};

// Normalizes "NPWR11862", "11862" or "npwr11862_00" to NPWR11862 / NPWR11862_00
export function normalizeNpwr(rawNpwrParam) {
  const match = String(rawNpwrParam).match(/NPWR(\d+)/i) || String(rawNpwrParam).match(/(\d+)/);
  if (!match) throw new Error('Invalid NPWR id.');

  const num = parseInt(match[1], 10);
  const cleanNpwr = `NPWR${num.toString().padStart(5, '0')}`;
  return { cleanNpwr, apiNpwr: `${cleanNpwr}_00` };
}

export function stringifyWithCompactArrays(obj) {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/\[\s*([\d\s,"A-Za-z0-9_-]+)\s*\]/g, (match, group) => {
    const cleaned = group.replace(/\s*\n\s*/g, ' ').trim();
    return `[ ${cleaned} ]`;
  });
}

function sortUserTabs(tabsObj) {
  const compare = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
  const sortedTabs = {};

  for (const tabName of Object.keys(tabsObj).sort(compare)) {
    sortedTabs[tabName] = {};
    for (const gameKey of Object.keys(tabsObj[tabName]).sort(compare)) {
      sortedTabs[tabName][gameKey] = tabsObj[tabName][gameKey];
    }
  }

  return sortedTabs;
}

function extractPlatforms(platformStr, rawTitle = '') {
  const platforms = new Set();

  if (platformStr) {
    platformStr.split(',').forEach(p => {
      const cleanP = p.trim().toUpperCase();
      if (cleanP) platforms.add(cleanP);
    });
  }

  const searchContext = `${platformStr || ''} ${rawTitle || ''}`.toUpperCase();
  if (searchContext.includes('PSVR2')) {
    platforms.add('PSVR2');
  } else if (searchContext.includes('PSVR')) {
    platforms.add('PSVR');
  }

  return Array.from(platforms);
}

async function findInPsnMiniDatabase(storage, cleanNpwrId, log) {
  const text = await storage.read(PSN_GAMES_FILE);
  if (text === null) return null;

  try {
    const rawData = JSON.parse(text);
    for (const [key, details] of Object.entries(rawData)) {
      if (key.includes(`(${cleanNpwrId})`)) {
        return {
          fullKey: key,
          region: details?.R || null,
          platforms: details?.P || [],
          pRate: details?.pRate || null
        };
      }
    }
  } catch (err) {
    log.warn(`⚠ Error reading PSN_GamesMini.json: ${err.message}`);
  }
  return null;
}

async function fetchGameFromPsn({ psn, auth, apiNpwrId, log }) {
  let groupsResponse = null;
  let platformStr = '';
  let rawTitle = '';

  // Attempt 1: standard PS5/PS4 endpoint
  try {
    groupsResponse = await psn.getTitleTrophyGroups(auth, apiNpwrId, { headerLocale: 'en-US' });
    platformStr = groupsResponse?.trophyTitlePlatform || '';
    rawTitle = groupsResponse?.trophyTitleName || '';
  } catch (err1) {}

  // Attempt 2: legacy endpoint (PS3/PS4/Vita)
  if (!rawTitle) {
    try {
      groupsResponse = await psn.getTitleTrophyGroups(auth, apiNpwrId, { npServiceName: 'trophy', headerLocale: 'en-US' });
      platformStr = groupsResponse?.trophyTitlePlatform || platformStr;
      rawTitle = groupsResponse?.trophyTitleName || rawTitle;
    } catch (err2) {}
  }

  if (!rawTitle) {
    log.error(`❌ No title found on PSN for ${apiNpwrId}`);
    return null;
  }

  const platformsArray = extractPlatforms(platformStr, rawTitle);

  const isLegacyPlatform = platformsArray.some(p => {
    const upper = p.toUpperCase();
    return upper.includes('PS3') || upper.includes('PS4') || upper.includes('VITA');
  });

  const primaryPlatform = platformsArray[0] || 'PS4';

  const options = {
    npLanguage: 'en',
    platform: primaryPlatform,
    ...(isLegacyPlatform && { npServiceName: 'trophy' })
  };

  let definitionResponse = null;

  try {
    definitionResponse = await psn.getTitleTrophies(auth, apiNpwrId, 'all', options);
  } catch (defErr) {
    try {
      const altOptions = { npLanguage: 'en', platform: primaryPlatform, npServiceName: 'trophy' };
      definitionResponse = await psn.getTitleTrophies(auth, apiNpwrId, 'all', altOptions);
    } catch (altErr) {
      log.error(`❌ Error fetching trophies from PSN for ${apiNpwrId}: ${defErr.message}`);
      return null;
    }
  }

  if (!definitionResponse?.trophies) return null;

  let gameUrlBase = '';
  const sampleUrl = definitionResponse.trophies[0]?.trophyIconUrl ||
                    definitionResponse.trophies[0]?.iconUrl ||
                    groupsResponse?.trophyGroups?.[0]?.trophyGroupIconUrl || '';

  if (sampleUrl) {
    const match = sampleUrl.match(/(https:\/\/.*\/)/);
    if (match) gameUrlBase = match[1];
  }

  const groupBounds = {};

  const trophies = definitionResponse.trophies.map(t => {
    const normalizedGroupId = (!t.trophyGroupId || t.trophyGroupId === 'default') ? '000' : t.trophyGroupId;

    if (!groupBounds[normalizedGroupId]) {
      groupBounds[normalizedGroupId] = {
        start: t.trophyId,
        end: t.trophyId,
        totalCount: [0, 0, 0, 0]
      };
    } else {
      if (t.trophyId < groupBounds[normalizedGroupId].start) groupBounds[normalizedGroupId].start = t.trophyId;
      if (t.trophyId > groupBounds[normalizedGroupId].end) groupBounds[normalizedGroupId].end = t.trophyId;
    }

    const typeIndex = trophyTypeIndexMap[t.trophyType?.toLowerCase()] ?? -1;
    if (typeIndex !== -1) {
      groupBounds[normalizedGroupId].totalCount[typeIndex] += 1;
    }

    const trophyIconUrl = t.trophyIconUrl || t.iconUrl || '';
    const shortIconUrl = gameUrlBase ? trophyIconUrl.replace(gameUrlBase, '') : trophyIconUrl;

    return {
      tId: t.trophyId,
      tType: t.trophyType,
      tName: t.trophyName || '',
      tDetail: t.trophyDetail || '',
      icon: shortIconUrl
    };
  });

  const apiGroupsMap = new Map();
  const sourceGroups = groupsResponse?.trophyGroups || definitionResponse?.trophyGroups || [];

  if (sourceGroups.length > 0) {
    for (const g of sourceGroups) {
      const normalizedApiGroupId = (!g.trophyGroupId || g.trophyGroupId.toLowerCase() === 'default') ? '000' : g.trophyGroupId;
      const realGroupIconUrl = g.trophyGroupIconUrl || g.iconUrl || null;

      apiGroupsMap.set(normalizedApiGroupId, {
        name: g.trophyGroupName ? g.trophyGroupName.trim() : null,
        iconUrl: realGroupIconUrl
      });
    }
  }

  const Group = Object.keys(groupBounds).sort().map(gId => {
    const bounds = groupBounds[gId];
    const apiGroupData = apiGroupsMap.get(gId);

    let gName = apiGroupData ? apiGroupData.name : null;
    const groupIconUrl = apiGroupData ? apiGroupData.iconUrl : null;

    if (gId === '000') {
      gName = 'Base Game';
    } else if (!gName) {
      const groupIndex = parseInt(gId, 10);
      gName = !isNaN(groupIndex) ? `Add-on Pack ${groupIndex}` : `DLC ${gId}`;
    }

    const shortGroupIconUrl = (groupIconUrl && gameUrlBase) ? groupIconUrl.replace(gameUrlBase, '') : (groupIconUrl || '');

    return {
      gId,
      gName,
      gRange: [bounds.start, bounds.end],
      dT: bounds.totalCount,
      icon: shortGroupIconUrl
    };
  });

  const dtDefined = groupsResponse?.definedTrophies || {};
  let definedTrophiesArray = [
    dtDefined.platinum || 0,
    dtDefined.gold || 0,
    dtDefined.silver || 0,
    dtDefined.bronze || 0
  ];

  if (definedTrophiesArray.every(v => v === 0)) {
    definedTrophiesArray = [0, 0, 0, 0];
    Object.values(groupBounds).forEach(b => {
      for (let i = 0; i < 4; i++) definedTrophiesArray[i] += b.totalCount[i];
    });
  }

  return { rawTitle, platformsArray, definedTrophiesArray, gameUrlBase, Group, trophies };
}

export async function runGameScraper({ npwr, tabName, psn, storage, log = console }) {
  tabName = String(tabName ?? '').trim();
  if (!tabName) throw new Error('Invalid tab name.');
  const { cleanNpwr, apiNpwr } = normalizeNpwr(npwr);

  log.log(`🚀 Processing ${cleanNpwr} for tab "${tabName}"...`);

  // --- Existing tabs ---
  let gameList = {};
  const existingText = await storage.read(OUTPUT_FILE);
  if (existingText !== null) {
    try {
      gameList = JSON.parse(existingText);
      log.log('📂 Loaded existing User_Tabs.json.');
    } catch (e) {
      log.warn('⚠ User_Tabs.json exists but is corrupted. Starting fresh.');
      gameList = {};
    }
  }

  // --- Authentication ---
  let npsso;
  try {
    npsso = JSON.parse(await storage.read(CONFIG_FILE))?.SETTINGS?.NPSSO;
  } catch {
    npsso = null;
  }
  if (!npsso) throw new Error('Options.json not found or NPSSO missing.');

  const authCode = await psn.exchangeNpssoForCode(npsso);
  const auth = await psn.exchangeCodeForAccessToken(authCode);

  // 1. PSN_GamesMini.json: region, platforms and pRate if present
  const miniDbMatch = await findInPsnMiniDatabase(storage, cleanNpwr, log);

  let fullKey = '';
  let regionVal = null;
  let pRateVal = null;

  if (miniDbMatch) {
    fullKey = miniDbMatch.fullKey;
    regionVal = miniDbMatch.region;
    pRateVal = miniDbMatch.pRate;
    log.log(`🎯 Match found in PSN_GamesMini.json: "${fullKey}"`);
  }

  // 2. Game data directly from PSN
  const psnData = await fetchGameFromPsn({ psn, auth, apiNpwrId: apiNpwr, log });
  if (!psnData) {
    throw new Error(`Scraping failed for ${apiNpwr}.`);
  }

  if (!fullKey) {
    fullKey = `${psnData.rawTitle} (${cleanNpwr})`;
  }

  const platforms = (miniDbMatch?.platforms && miniDbMatch.platforms.length > 0)
    ? miniDbMatch.platforms
    : psnData.platformsArray;

  // 3. Final object
  const gameObject = {
    P: platforms,
    ...(regionVal && { R: regionVal }),
    ...(pRateVal && { pRate: pRateVal }),
    dT: psnData.definedTrophiesArray,
    url: psnData.gameUrlBase,
    Group: psnData.Group,
    trophies: psnData.trophies
  };

  // 4. Save into the specified tab
  if (!gameList[tabName]) gameList[tabName] = {};
  gameList[tabName][fullKey] = gameObject;

  await storage.write(OUTPUT_FILE, stringifyWithCompactArrays(sortUserTabs(gameList)));
  log.log('📝 User_Tabs.json saved (alphabetically sorted).');
  log.log(`✅ Game successfully saved to ["${tabName}"]["${fullKey}"]`);

  return true;
}
