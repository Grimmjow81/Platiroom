// Account scraper (port of DB_User.js).
// Runs in the webview: PSN access goes through the injected `psn` client, file access through the injected `storage`
// adapter ({ read(name) -> string|null, write(name, text) }), so the same code can be tested in Node.

const OUTPUT_FILE = 'User_Games.json';
const ACCOUNT_FILE = 'User_Account.json';
const CONFIG_FILE = 'Options.json';
const PSN_GAMES_FILE = 'PSN_GamesMini.json';
const STATS_FILE = 'User_Stat.json';

const TrophyRareMap = {
  0: 'ULTRA RARE',
  1: 'VERY RARE',
  2: 'RARE',
  3: 'COMMON'
};

// PSN trophy points weighting for group/game progress. Order: [Platinum, Gold, Silver, Bronze]
const GAME_TROPHY_WEIGHTS = [0, 90, 30, 15];

// PSN trophy points weighting for account level. Order: [Platinum, Gold, Silver, Bronze]
const LEVEL_TROPHY_WEIGHTS = [300, 90, 30, 15];

// PSN level brackets and points required per level
const LEVEL_BRACKETS = [
  { maxLevel: 100, ptsPerLevel: 60 },
  { maxLevel: 200, ptsPerLevel: 90 },
  { maxLevel: 300, ptsPerLevel: 450 },
  { maxLevel: 400, ptsPerLevel: 900 },
  { maxLevel: 500, ptsPerLevel: 1350 },
  { maxLevel: 600, ptsPerLevel: 1800 },
  { maxLevel: 700, ptsPerLevel: 2250 },
  { maxLevel: 800, ptsPerLevel: 2700 },
  { maxLevel: 900, ptsPerLevel: 3150 },
  { maxLevel: 999, ptsPerLevel: 3600 }
];

function formatIsoDate(dateString) {
  if (!dateString) return null;
  return dateString.split('.')[0];
}

function extractPlatforms(titleInfo) {
  const platforms = new Set();

  if (titleInfo.trophyTitlePlatform) {
    titleInfo.trophyTitlePlatform.split(',').forEach(p => {
      const cleanP = p.trim().toUpperCase();
      if (cleanP) platforms.add(cleanP);
    });
  }

  const rawString = JSON.stringify(titleInfo).toUpperCase();
  if (rawString.includes('VR')) {
    platforms.add('VR');
  }

  return Array.from(platforms);
}

// Compact formatting for short arrays and single-line platinum list items
export function stringifyWithCompactArrays(obj) {
  let json = JSON.stringify(obj, null, 2);

  // Compact arrays of numbers or strings onto a single line
  json = json.replace(/\[\s*([\d\s,"A-Za-z0-9_.-]+)\s*\]/g, (match, group) => {
    const cleaned = group.replace(/\s*\n\s*/g, ' ').trim();
    return `[ ${cleaned} ]`;
  });

  // Compact platinumList items onto a single line each
  json = json.replace(/("platinumList":\s*\{)([\s\S]*?)(\n\s*\},?\n\s*"platformStats")/g, (match, p1, p2, p3) => {
    const cleanedP2 = p2.replace(/(".*?"):\s*\{([^}]+)\}/gs, (m, key, inner) => {
      const singleLineInner = inner.replace(/\s*\n\s*/g, ' ').trim();
      return `${key}: { ${singleLineInner} }`;
    });
    return p1 + cleanedP2 + p3;
  });

  return json;
}

// Calculate PSN account level based on total accumulated trophies
function calculateAccountLevel(plat, gold, silver, bronze) {
  const trophies = [plat, gold, silver, bronze];
  const totalPoints = trophies.reduce((sum, count, i) => sum + ((count || 0) * LEVEL_TROPHY_WEIGHTS[i]), 0);

  let currentLevel = 1;
  let remainingPoints = totalPoints;

  for (const bracket of LEVEL_BRACKETS) {
    const levelsInBracket = bracket.maxLevel - currentLevel + 1;
    const bracketTotalPoints = levelsInBracket * bracket.ptsPerLevel;

    if (remainingPoints >= bracketTotalPoints) {
      remainingPoints -= bracketTotalPoints;
      currentLevel = bracket.maxLevel + 1;
    } else {
      const gainedLevels = Math.floor(remainingPoints / bracket.ptsPerLevel);
      currentLevel += gainedLevels;
      return Math.min(currentLevel, 999);
    }
  }

  return 999;
}

function calculateGroupProgress(definedArray, earnedArray) {
  let totalPoints = 0;
  let earnedPoints = 0;

  for (let i = 0; i < 4; i++) {
    totalPoints += (definedArray[i] || 0) * GAME_TROPHY_WEIGHTS[i];
    earnedPoints += (earnedArray[i] || 0) * GAME_TROPHY_WEIGHTS[i];
  }

  if (totalPoints === 0) return 0;
  return Math.round((earnedPoints / totalPoints) * 100);
}

// Builds the User_Stat.json content from the game list
export function buildUserStats(gameList) {
  // ISO period key (e.g. 2023-07-01 or 2023-07-16)
  function getPeriodKey(dateObj) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = dateObj.getDate() <= 15 ? '01' : '16';
    return `${year}-${month}-${day}`;
  }

  const platinumsArray = [];

  // Platform stats array schema:
  // [0] Total games, [1] Games with platinum defined, [2] Games with platinum earned, [3] Games at 100%,
  // [4] 99%-75%, [5] 74%-50%, [6] 49%-25%, [7] 24%-0%
  const platformStats = {
    ps3: [0, 0, 0, 0, 0, 0, 0, 0],
    psvita: [0, 0, 0, 0, 0, 0, 0, 0],
    ps4: [0, 0, 0, 0, 0, 0, 0, 0],
    ps5: [0, 0, 0, 0, 0, 0, 0, 0],
    vr: [0, 0, 0, 0, 0, 0, 0, 0],
    multiplatform: [0, 0, 0, 0, 0, 0, 0, 0],
    total: [0, 0, 0, 0, 0, 0, 0, 0]
  };

  function recordStatsForGroup(groupArray, hasPlatDef, hasPlatEarned, progress) {
    groupArray[0] += 1;
    if (hasPlatDef) groupArray[1] += 1;
    if (hasPlatEarned) groupArray[2] += 1;

    if (progress === 100) {
      groupArray[3] += 1;
    } else if (progress >= 75) {
      groupArray[4] += 1;
    } else if (progress >= 50) {
      groupArray[5] += 1;
    } else if (progress >= 25) {
      groupArray[6] += 1;
    } else {
      groupArray[7] += 1;
    }
  }

  const earnedTrophyEvents = [];

  for (const [gameKey, game] of Object.entries(gameList)) {
    if (gameKey === '__upDate__') continue;

    const platforms = game.P || [];
    const hasPlatinumDefined = game.dT && game.dT[0] > 0;
    const platinumEarned = game.eT && game.eT[0] > 0;
    const progress = game.progress ?? 0;

    const hasVr = platforms.some(p => p.toUpperCase() === 'VR');

    recordStatsForGroup(platformStats.total, hasPlatinumDefined, platinumEarned, progress);

    if (hasVr) {
      // VR games go strictly into the VR category
      recordStatsForGroup(platformStats.vr, hasPlatinumDefined, platinumEarned, progress);
    } else {
      const consolePlatforms = platforms.filter(p => p.toUpperCase() !== 'VR');

      if (consolePlatforms.length > 1) {
        recordStatsForGroup(platformStats.multiplatform, hasPlatinumDefined, platinumEarned, progress);
      } else if (consolePlatforms.length === 1) {
        const p = consolePlatforms[0].toUpperCase();
        if (p === 'PS3') {
          recordStatsForGroup(platformStats.ps3, hasPlatinumDefined, platinumEarned, progress);
        } else if (p.includes('VITA')) {
          recordStatsForGroup(platformStats.psvita, hasPlatinumDefined, platinumEarned, progress);
        } else if (p === 'PS4') {
          recordStatsForGroup(platformStats.ps4, hasPlatinumDefined, platinumEarned, progress);
        } else if (p === 'PS5') {
          recordStatsForGroup(platformStats.ps5, hasPlatinumDefined, platinumEarned, progress);
        }
      }
    }

    if (Array.isArray(game.trophies)) {
      for (const trophy of game.trophies) {
        const typeLower = (trophy.tType || '').toLowerCase();
        const typeIndexMap = { platinum: 0, gold: 1, silver: 2, bronze: 3 };
        const typeIndex = typeIndexMap[typeLower] ?? 3;

        if (trophy.tEarned) {
          const earnedDate = new Date(trophy.tEarned);

          if (!isNaN(earnedDate.getTime())) {
            earnedTrophyEvents.push({ date: earnedDate, typeIndex });

            if (typeLower === 'platinum') {
              platinumsArray.push({
                gameKey,
                earnedDate: trophy.tEarned,
                data: {
                  P: game.P,
                  ...(game.pRate && { pRate: game.pRate }),
                  ...(game.R && { R: game.R }),
                  earnedDate: trophy.tEarned
                }
              });
            }
          }
        }
      }
    }
  }

  platinumsArray.sort((a, b) => new Date(a.earnedDate) - new Date(b.earnedDate));
  const platinumList = {};
  for (const item of platinumsArray) {
    platinumList[item.gameKey] = item.data;
  }

  const trophyActivity = {};
  const trophyProgression = {};

  if (earnedTrophyEvents.length > 0) {
    earnedTrophyEvents.sort((a, b) => a.date - b.date);

    const minDate = earnedTrophyEvents[0].date;
    const maxDate = earnedTrophyEvents[earnedTrophyEvents.length - 1].date;

    let curr = new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate() <= 15 ? 1 : 16);
    const end = new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate() <= 15 ? 1 : 16);

    while (curr <= end) {
      const key = getPeriodKey(curr);
      trophyActivity[key] = [0, 0, 0, 0];

      if (curr.getDate() === 1) {
        curr.setDate(16);
      } else {
        curr.setMonth(curr.getMonth() + 1);
        curr.setDate(1);
      }
    }

    for (const event of earnedTrophyEvents) {
      const key = getPeriodKey(event.date);
      if (trophyActivity[key]) {
        trophyActivity[key][event.typeIndex] += 1;
      }
    }

    let cumPlat = 0, cumGold = 0, cumSilver = 0, cumBronze = 0;
    for (const [key, counts] of Object.entries(trophyActivity)) {
      cumPlat += counts[0];
      cumGold += counts[1];
      cumSilver += counts[2];
      cumBronze += counts[3];

      const currentLevel = calculateAccountLevel(cumPlat, cumGold, cumSilver, cumBronze);
      trophyProgression[key] = [cumPlat, cumGold, cumSilver, cumBronze, currentLevel];
    }
  }

  return { platinumList, platformStats, trophyActivity, trophyProgression };
}

async function fetchTrophyDetails({ psn, auth, apiNpwrId, platforms, log }) {
  try {
    const primaryPlatform = platforms.length > 0 ? platforms[0].toUpperCase() : 'PS4';

    const isLegacyPlatform = platforms.some(p => {
      const upper = p.toUpperCase();
      return upper.includes('PS3') || upper.includes('PS4') || upper.includes('VITA');
    });

    const options = {
      npLanguage: 'en',
      platform: primaryPlatform,
      ...(isLegacyPlatform && { npServiceName: 'trophy' })
    };

    let definitionResponse = null;
    let userResponse = null;

    try {
      definitionResponse = await psn.getTitleTrophies(auth, apiNpwrId, 'all', options);
    } catch (defErr) {
      log.warn(`⚠ Couldn't fetch trophy definitions for ${apiNpwrId}: ${defErr.message}`);
      return null;
    }

    let groupsResponse = null;
    try {
      groupsResponse = await psn.getTitleTrophyGroups(auth, apiNpwrId, options);
    } catch (gErr) {
      // Ignored if trophy groups are missing
    }

    try {
      userResponse = await psn.getUserTrophiesEarnedForTitle(auth, 'me', apiNpwrId, 'all', options);
    } catch (uErr) {
      log.warn(`⚠ Couldn't fetch user trophy progress for ${apiNpwrId}: ${uErr.message}`);
      return null;
    }

    if (!definitionResponse?.trophies || !userResponse?.trophies) {
      return { Group: [], trophies: [], gameUrlBase: '' };
    }

    let gameUrlBase = '';
    const sampleUrl = definitionResponse.trophies[0]?.trophyIconUrl || definitionResponse.trophies[0]?.iconUrl || groupsResponse?.trophyGroups?.[0]?.trophyGroupIconUrl || '';

    if (sampleUrl) {
      const match = sampleUrl.match(/(https:\/\/.*\/)/);
      if (match) {
        gameUrlBase = match[1];
      }
    }

    const userTrophiesMap = new Map();
    for (const ut of userResponse.trophies) {
      userTrophiesMap.set(ut.trophyId, ut);
    }

    const trophyTypeIndexMap = { platinum: 0, gold: 1, silver: 2, bronze: 3 };

    const groupBounds = {};

    const trophies = definitionResponse.trophies.map(t => {
      const userStatus = userTrophiesMap.get(t.trophyId);
      const isEarned = userStatus?.earned || false;
      const earnedTime = (isEarned && userStatus?.earnedDateTime) ? formatIsoDate(userStatus.earnedDateTime) : null;

      const rawRare = userStatus?.trophyRare !== undefined ? userStatus.trophyRare : t.trophyRare;
      const stringRare = TrophyRareMap[rawRare] || 'UNKNOWN';

      const rawRate = userStatus?.trophyEarnedRate !== undefined ? userStatus.trophyEarnedRate : t.trophyEarnedRate;
      const stringRate = rawRate ? parseFloat(rawRate).toFixed(1) : '0.0';

      const normalizedGroupId = (!t.trophyGroupId || t.trophyGroupId === 'default') ? '000' : t.trophyGroupId;

      if (!groupBounds[normalizedGroupId]) {
        groupBounds[normalizedGroupId] = {
          start: t.trophyId,
          end: t.trophyId,
          earnedCount: [0, 0, 0, 0],
          totalCount: [0, 0, 0, 0]
        };
      } else {
        if (t.trophyId < groupBounds[normalizedGroupId].start) groupBounds[normalizedGroupId].start = t.trophyId;
        if (t.trophyId > groupBounds[normalizedGroupId].end) groupBounds[normalizedGroupId].end = t.trophyId;
      }

      const typeIndex = trophyTypeIndexMap[t.trophyType?.toLowerCase()] ?? -1;
      if (typeIndex !== -1) {
        groupBounds[normalizedGroupId].totalCount[typeIndex] += 1;
        if (isEarned) {
          groupBounds[normalizedGroupId].earnedCount[typeIndex] += 1;
        }
      }

      const trophyIconUrl = t.trophyIconUrl || t.iconUrl || '';
      const shortIconUrl = gameUrlBase ? trophyIconUrl.replace(gameUrlBase, '') : trophyIconUrl;

      return {
        tId: t.trophyId,
        tType: t.trophyType,
        tName: t.trophyName || '',
        tDetail: t.trophyDetail || '',
        tRarity: stringRare,
        tRate: stringRate,
        tEarned: earnedTime,
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
      const groupProgress = calculateGroupProgress(bounds.totalCount, bounds.earnedCount);

      return {
        gId,
        gName,
        progress: groupProgress,
        gRange: [bounds.start, bounds.end],
        dT: bounds.totalCount,
        eT: bounds.earnedCount,
        icon: shortGroupIconUrl
      };
    });

    return { Group, trophies, gameUrlBase };

  } catch (err) {
    log.error(`⚠ Error fetching sub-details for ${apiNpwrId}:`, err.message);
    return null;
  }
}

export async function runUserScraper({ psn, storage, log = console, delayMs = 300 }) {
  const stats = { addedUpdated: 0, skipped: 0, failed: 0 };
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // --- Existing game list ---
  let gameList = {};
  const existingText = await storage.read(OUTPUT_FILE);
  if (existingText !== null) {
    try {
      gameList = JSON.parse(existingText);
      log.log(`\n📂 Loaded existing User_Games.json with ${Object.keys(gameList).length} entries.`);
    } catch (e) {
      log.warn('⚠ User_Games.json exists but is corrupt. Starting clean.');
      gameList = {};
    }
  }

  // --- PSN games database ---
  const psnGamesDatabase = new Map();
  const miniText = await storage.read(PSN_GAMES_FILE);
  if (miniText === null) {
    log.warn('⚠ PSN_GamesMini.json not found. Proceeding with standard PSN titles.');
  } else {
    try {
      const rawData = JSON.parse(miniText);

      for (const [key, details] of Object.entries(rawData)) {
        const match = key.match(/^(.*?)\s*\((NPWR\d+)\)$/i);
        if (match) {
          psnGamesDatabase.set(match[2], {
            titleName: match[1].trim(),
            region: details?.R || null,
            pRate: details?.pRate || null
          });
        }
      }
      log.log(`📚 Loaded ${psnGamesDatabase.size} titles.`);
    } catch (err) {
      log.warn(`⚠ Error parsing PSN_GamesMini.json: ${err.message}. Proceeding without it.`);
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

  // --- Profile ---
  try {
    const profileResponse = await psn.getProfileFromUserName(auth, 'me');
    const profileData = profileResponse.profile || profileResponse;

    let trophySummary = {};
    try {
      trophySummary = await psn.getUserTrophyProfileSummary(auth, 'me');
    } catch (tErr) {
      log.warn("⚠ Couldn't fetch trophy profile summary:", tErr.message);
    }

    if (profileData?.onlineId && profileData?.accountId) {
      const accountInfo = {
        onlineId: profileData.onlineId,
        accountId: profileData.accountId,
        icon: profileData.avatarUrls?.[0]?.avatarUrl || '',
        level: trophySummary.trophyLevel ?? null,
        tier: trophySummary.tier ?? null
      };
      await storage.write(ACCOUNT_FILE, JSON.stringify(accountInfo, null, 2));
      log.log(`🔑 Account: ${profileData.onlineId} | Level: ${trophySummary.trophyLevel ?? 'N/A'} | Tier: ${trophySummary.tier ?? 'N/A'}`);
    }
  } catch (err) {
    log.error('❌ Error fetching profile data:', err.message);
  }

  // --- Title list ---
  log.log('🌐 Retrieving complete trophy list structure from PSN...');

  const allPsnTitles = [];
  try {
    let offset = 0;
    const limit = 100;
    let hasMore = true;

    while (hasMore) {
      const response = await psn.getUserTitles(auth, 'me', { limit, offset });
      if (!response?.trophyTitles || response.trophyTitles.length === 0) break;

      allPsnTitles.push(...response.trophyTitles);
      offset += limit;
      if (response.trophyTitles.length < limit) hasMore = false;
    }
  } catch (err) {
    log.error('❌ Critical error fetching user titles list:', err.message);
    stats.failed++;
    // The original script stopped here (exit code 0) without saving anything
    return stats;
  }

  log.log(`📋 Found ${allPsnTitles.length} total games on PSN. Checking for updates...`);

  const updatedSessionMap = new Map();
  const psnOrderedKeys = [];

  for (const titleInfo of allPsnTitles) {
    const apiNpwrId = titleInfo.npCommunicationId;
    const rawTitle = titleInfo.trophyTitleName;

    if (!rawTitle || !apiNpwrId) continue;

    const cleanNpwrId = apiNpwrId.replace(/_00$/, '');

    const dbMatch = psnGamesDatabase.get(cleanNpwrId);
    const title = dbMatch?.titleName ? dbMatch.titleName : rawTitle;

    const uniqueKey = `${title} (${cleanNpwrId})`;

    psnOrderedKeys.push(uniqueKey);

    const platformsArray = extractPlatforms(titleInfo);

    const dt = titleInfo.definedTrophies || {};
    const et = titleInfo.earnedTrophies || {};

    const progressValue = titleInfo.progress ?? 0;

    const definedTrophiesArray = [dt.platinum || 0, dt.gold || 0, dt.silver || 0, dt.bronze || 0];
    const earnedTrophiesArray = [et.platinum || 0, et.gold || 0, et.silver || 0, et.bronze || 0];

    const existingGame = gameList[uniqueKey];

    const baseCurrentData = {
      P: platformsArray,
      ...(dbMatch?.pRate && { pRate: dbMatch.pRate }),
      ...(dbMatch?.region && { R: dbMatch.region }),
      progress: progressValue,
      dT: definedTrophiesArray,
      eT: earnedTrophiesArray
    };

    const isUnchanged = existingGame &&
      existingGame.progress === baseCurrentData.progress &&
      JSON.stringify(existingGame.eT) === JSON.stringify(baseCurrentData.eT) &&
      JSON.stringify(existingGame.dT) === JSON.stringify(baseCurrentData.dT);

    if (isUnchanged) {
      stats.skipped++;
      continue;
    }

    const detailsResult = await fetchTrophyDetails({ psn, auth, apiNpwrId, platforms: platformsArray, log });

    if (!detailsResult) {
      log.warn(`⚠ Skipping update for ${uniqueKey} due to API server response issue.`);
      stats.failed++;
      continue;
    }

    const { Group, trophies, gameUrlBase } = detailsResult;

    const scrapedData = {
      P: baseCurrentData.P,
      ...(dbMatch?.pRate && { pRate: dbMatch.pRate }),
      ...(dbMatch?.region && { R: dbMatch.region }),
      progress: baseCurrentData.progress,
      dT: baseCurrentData.dT,
      eT: baseCurrentData.eT,
      url: gameUrlBase,
      Group,
      trophies
    };

    log.log(`🎮 ${uniqueKey} [${trophies.length} trophies | ${Group.length} groups] (Updated/New)`);
    stats.addedUpdated++;

    updatedSessionMap.set(uniqueKey, scrapedData);

    await sleep(delayMs);
  }

  // --- Final ordered list: PSN order first, then games no longer returned by PSN ---
  const finalOrderedGameList = {};

  for (const key of psnOrderedKeys) {
    if (updatedSessionMap.has(key)) {
      finalOrderedGameList[key] = updatedSessionMap.get(key);
    } else if (gameList[key]) {
      finalOrderedGameList[key] = gameList[key];
    }
  }

  for (const oldKey of Object.keys(gameList)) {
    if (!finalOrderedGameList[oldKey]) {
      finalOrderedGameList[oldKey] = gameList[oldKey];
    }
  }

  gameList = finalOrderedGameList;

  // --- Save games (preserving the CRLF style of the existing file) ---
  const oldText = await storage.read(OUTPUT_FILE);
  const useCRLF = oldText && /\r\n/.test(oldText);
  let newJson = stringifyWithCompactArrays(gameList);
  if (useCRLF) newJson = newJson.replace(/\n/g, '\r\n');

  if (oldText !== newJson) {
    await storage.write(OUTPUT_FILE, newJson);
    log.log('📝 User_Games.json saved/updated.');
  } else {
    log.log('📝 User_Games.json unchanged.');
  }

  // --- Stats ---
  log.log('📊 Generating User_Stat.json...');
  await storage.write(STATS_FILE, stringifyWithCompactArrays(buildUserStats(gameList)));
  log.log('📈 User_Stat.json successfully saved/updated.');

  log.log(`\n Added / Updated Games:              ${stats.addedUpdated}`);
  log.log(` Skipped Games (Up to date):         ${stats.skipped}`);
  log.log(` Critical Errors:                    ${stats.failed}\n`);

  return stats;
}
