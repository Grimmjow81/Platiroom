// renderer-stat.js
// Platiroom tab (the Statistics tab will live here too).
// Data comes from json/User_Stat.json, loaded at startup by renderer-global.js.

// ==========================================================================
// STATE AND CONFIGURATION
// ==========================================================================

let userStatData = null;

const RAREST_COUNT = 10;
const SHAME_THRESHOLD = 80;  // platinums with a rarity percentage above this go in "Shame on me"
const MILESTONES = [1, 10, 25, 50, 100, 150, 200, 300, 400, 500, 1000, 2000, 3000, 4000, 5000, 10000];

async function loadStatData() {
  userStatData = await window.api.readLocalJson(DATA_FILES.stats);
}

// ==========================================================================
// DATA
// ==========================================================================

// Platinum list in chronological order (the json keys are already sorted oldest first).
// "number" is the sequential number of the platinum: 1 = the first one obtained.
function getPlatinumEntries() {
  return Object.entries(userStatData?.platinumList || {}).map(([key, entry], index) => ({
    number: index + 1,
    title: parseGameKey(key).title,
    platforms: (entry.P || []).filter(p => p.toUpperCase() !== 'PSPC'),
    region: entry.R,
    pRate: entry.pRate,
    earnedDate: entry.earnedDate
  }));
}

// Entries with the rarity selected in the options ("Platinum rarity"); entries without a value are dropped
function getRatedEntries(entries) {
  return entries
    .map(entry => ({ ...entry, rate: getPlatinumRate(entry.pRate) }))
    .filter(entry => entry.rate !== null);
}

// The rarest platinums, lowest percentage first
function getRarestEntries(entries) {
  return getRatedEntries(entries)
    .sort((a, b) => a.rate - b.rate)
    .slice(0, RAREST_COUNT);
}

// The platinums obtained as number 1, 10, 50, 100...; milestones not reached yet are skipped
function getMilestoneEntries(entries) {
  return MILESTONES.map(n => entries[n - 1]).filter(Boolean);
}

// The most common platinums, highest percentage first
function getShameEntries(entries) {
  return getRatedEntries(entries)
    .filter(entry => entry.rate > SHAME_THRESHOLD)
    .sort((a, b) => b.rate - a.rate);
}

// ==========================================================================
// TABLE COMPONENTS
// ==========================================================================

function createTextCell(text, centered = false, bold = false) {
  const cell = createEl('td', centered ? 'center-cell' : '', String(text));
  if (bold) cell.style.fontWeight = 'bold';
  return cell;
}

function createGameNameCell(entry) {
  const cell = createEl('td');
  cell.appendChild(createGameNameBlock(entry.title, entry.region, entry.platforms).container);
  return cell;
}

// columns: [{ label, width, centered }], rows: arrays of <td> elements
function createPlatiroomTable(columns, rows) {
  const table = createEl('table', 'platiroom-table');

  const headRow = createEl('tr');
  columns.forEach(({ label, width, centered }) => {
    const th = createEl('th', '', label);
    if (width) th.style.width = width;
    if (centered) th.style.textAlign = 'center';
    headRow.appendChild(th);
  });
  table.appendChild(createEl('thead')).appendChild(headRow);

  const tbody = createEl('tbody');
  rows.forEach(cells => {
    const row = createEl('tr');
    row.append(...cells);
    tbody.appendChild(row);
  });
  table.appendChild(tbody);

  return table;
}

// Title plus table; an empty table is replaced by a short message
function createPlatiroomSection(title, columns, rows) {
  const section = createEl('div', 'platiroom-section');
  section.appendChild(createEl('h3', 'platiroom-title', title));

  section.appendChild(rows.length > 0
    ? createPlatiroomTable(columns, rows)
    : createEl('div', 'platiroom-empty', 'No entries.'));

  return section;
}

// ==========================================================================
// PLATIROOM TAB
// ==========================================================================

const RATE_COLUMN = { label: 'Rarity', width: '70px', centered: true };
const GAME_COLUMN = { label: 'Game' };

const createRateRow = (entry) => [createTextCell(`${entry.rate}%`, true, true), createGameNameCell(entry)];

function renderPlatiroom() {
  const listPanel = document.getElementById('platiroom-list');
  const centerPanel = document.getElementById('platiroom-center');
  const tablesPanel = document.getElementById('platiroom-tables');
  listPanel.innerHTML = '';
  centerPanel.innerHTML = '';
  tablesPanel.innerHTML = '';

  // Big platinum trophy of the chosen style (with the "Platform" style the modern icon is used)
  const trophyImg = createEl('img', 'platiroom-trophy-img');
  trophyImg.src = `img/${stylePrefix === 'p' ? 'm' : stylePrefix}_platinum.png`;
  trophyImg.alt = 'Platinum';
  centerPanel.appendChild(trophyImg);

  const entries = getPlatinumEntries();
  if (entries.length === 0) {
    listPanel.appendChild(createEl('div', 'platiroom-empty', 'No platinum data available.'));
    return;
  }

  // Left: every platinum, latest first
  const listRows = [...entries].reverse().map(entry => [
    createTextCell(entry.number, true),
    createGameNameCell(entry),
    createDate(entry.earnedDate)
  ]);
  listPanel.appendChild(createPlatiroomTable([
    { label: '#', width: '50px', centered: true },
    GAME_COLUMN,
    { label: 'Date Earned', width: '100px', centered: true }
  ], listRows));

  // Right: rarest, milestones, shame on me
  tablesPanel.appendChild(createPlatiroomSection(
    `Rarest platinums (top ${RAREST_COUNT})`,
    [RATE_COLUMN, GAME_COLUMN],
    getRarestEntries(entries).map(createRateRow)
  ));

  tablesPanel.appendChild(createPlatiroomSection(
    'Milestones',
    [{ label: 'Platinum', width: '70px', centered: true }, GAME_COLUMN],
    getMilestoneEntries(entries).map(entry => [createTextCell(entry.number, true, true), createGameNameCell(entry)])
  ));

  tablesPanel.appendChild(createPlatiroomSection(
    `Shame on me (over ${SHAME_THRESHOLD}%)`,
    [RATE_COLUMN, GAME_COLUMN],
    getShameEntries(entries).map(createRateRow)
  ));
}

// ==========================================================================
// STATISTICS TAB
// ==========================================================================

const statCharts = [];   // Chart instances on screen, destroyed before every redraw

// Same order as the arrays in trophyProgression / trophyActivity.
// The first series is drawn in front of the others.
const TROPHY_SERIES = [
  { label: 'Platinum', color: '--platinum' },
  { label: 'Gold', color: '--gold' },
  { label: 'Silver', color: '--silver' },
  { label: 'Bronze', color: '--bronze' }
];

const cssColor = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const FILL_OPACITY = 0.35;

// "#RRGGBB" -> [r, g, b]
function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

// "#RRGGBB" -> "rgba(r, g, b, alpha)"
function withAlpha(hex, alpha) {
  return `rgba(${hexToRgb(hex).join(', ')}, ${alpha})`;
}

// Opaque color that looks like `hex` at the given opacity over the card background.
// Overlapping areas cover each other instead of blending their colors.
function tintOnBackground(hex, alpha) {
  const bg = hexToRgb(cssColor('--card-bg'));
  const rgb = hexToRgb(hex).map((c, i) => Math.round(bg[i] + (c - bg[i]) * alpha));
  return `rgb(${rgb.join(', ')})`;
}

// One position of the per-period arrays (e.g. index 0 = platinum, 4 = level in trophyProgression)
const getStatValues = (source, index) => Object.values(source).map(values => values[index]);

function createBaseChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        position: 'top',
        labels: {
          usePointStyle: true,
          boxWidth: 8,
          // The legend copies the dataset border (2px on lines, scriptable on bars): force the same thin border everywhere
          generateLabels: (chart) =>
            Chart.defaults.plugins.legend.labels.generateLabels(chart).map(item => ({ ...item, lineWidth: 1 }))
        }
      }
    },
    scales: {
      x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 12 } },
      y: { beginAtZero: true, grid: { color: 'rgba(0, 0, 0, 0.1)', z: 1 } }
    }
  };
}

function createLineDataset(label, data, color) {
  return {
    label,
    data,
    borderColor: color,
    backgroundColor: tintOnBackground(color, FILL_OPACITY),
    fill: 'origin',
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 4,
    tension: 0.2
  };
}

function createBarDataset(label, data, color) {
  return {
    label,
    data,
    backgroundColor: withAlpha(color, FILL_OPACITY),
    borderColor: color,
    borderWidth: (ctx) => (ctx.raw ? 1 : 0),   // no line for empty segments
    borderSkipped: false,                      // border on every side, also between stacked segments
    categoryPercentage: 0.9,
    barPercentage: 1
  };
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_TICK_STEPS = [1, 2, 3, 4, 6, 12];   // months between two labels
const MONTH_TICK_MIN_PX = 56;                   // minimum horizontal space for one label

// "2025-08-01" -> "Aug '25"
function formatMonthLabel(isoDate) {
  const [year, month] = isoDate.split('-');
  return `${MONTH_NAMES[Number(month) - 1]} '${year.slice(2)}`;
}

// "YYYY-MM-DD" -> number of months since year 0
const toMonthIndex = (isoDate) => {
  const [year, month] = isoDate.split('-').map(Number);
  return year * 12 + month - 1;
};

// X axis ticks as "Mon 'YY": only on the first day of the month, spaced so that the labels never overlap
function applyMonthTicks(options) {
  options.scales.x.ticks = {
    maxRotation: 0,
    autoSkip: false,
    callback(value) {
      const label = this.getLabelForValue(value);
      if (!label.endsWith('-01')) return '';

      const firstMonth = toMonthIndex(this.getLabelForValue(0));
      const totalMonths = toMonthIndex(this.getLabelForValue(this.max)) - firstMonth + 1;
      const pxPerMonth = this.width / totalMonths;
      const step = MONTH_TICK_STEPS.find(s => s * pxPerMonth >= MONTH_TICK_MIN_PX) ?? 12;

      return (toMonthIndex(label) - firstMonth) % step === 0 ? formatMonthLabel(label) : '';
    }
  };
}

function createLineChart(canvas, labels, datasets) {
  const options = createBaseChartOptions();
  applyMonthTicks(options);
  return new Chart(canvas, { type: 'line', data: { labels, datasets }, options });
}

function createStackedBarChart(canvas, labels, datasets) {
  const options = createBaseChartOptions();
  applyMonthTicks(options);
  options.scales.x.stacked = true;
  options.scales.y.stacked = true;
  return new Chart(canvas, { type: 'bar', data: { labels, datasets }, options });
}

// Card with a title and an empty canvas; returns the canvas.
// modifier: '' (half row), 'third' (a third of the row) or 'wide' (full row)
function createStatCard(container, title, modifier = '') {
  const card = createEl('div', `stat-card ${modifier}`.trim());
  card.appendChild(createEl('h3', 'stat-title', title));

  const box = createEl('div', 'chart-box');
  const canvas = createEl('canvas');
  box.appendChild(canvas);
  card.appendChild(box);

  container.appendChild(card);
  return canvas;
}

// ==========================================================================
// PLATFORM CHARTS
// ==========================================================================

// Positions of the arrays in platformStats; the bar charts show all of them
const PLATFORM_STAT_LABELS = [
  ['Total', 'games'],
  ['With', 'platinum'],
  ['Platinum', 'earned'],
  ['100%'],
  ['99-75%'],
  ['74-50%'],
  ['49-25%'],
  ['24-0%']
];
const STAT_INDEX_TOTAL_GAMES = 0;
const STAT_INDEX_PLATINUMS_EARNED = 2;

const PLATFORM_TITLES = {
  ps3: 'PS3',
  psvita: 'PS Vita',
  ps4: 'PS4',
  ps5: 'PS5',
  vr: 'PS VR',
  multiplatform: 'Multiplatform',
  total: 'Total'
};
const getPlatformTitle = (key) => PLATFORM_TITLES[key] || key.toUpperCase();

// Platform colors
const PS3_COLOR = '#2570BB';
const PS4_COLOR = '#104E9B';
const PSVITA_COLOR = '#4A89DC';
const PS5_COLOR = '#ECECE6';            // slightly dirty white
const PS5_BORDER_COLOR = '#B5B5AD';     // a white border would disappear on the white card
const MULTIPLATFORM_COLOR = '#8E9195';  // PSN anniversary gray

// Tile of 45 degree stripes alternating two colors, used as a canvas fill.
// The two colors never overlap, so semi-transparent colors keep their transparency.
function createStripePattern(colorA, colorB, size = 10) {
  const tile = document.createElement('canvas');
  tile.width = size;
  tile.height = size;
  const ctx = tile.getContext('2d');
  const half = size / 2;

  const fillShape = (color, points) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.fill();
  };

  // Color A: corner triangle and the band across the tile
  fillShape(colorA, [[0, 0], [half, 0], [0, half]]);
  fillShape(colorA, [[size, 0], [size, half], [half, size], [0, size]]);

  // Color B: the band between the two A shapes and the opposite corner
  fillShape(colorB, [[0, half], [half, 0], [size, 0], [0, size]]);
  fillShape(colorB, [[half, size], [size, half], [size, size]]);

  return ctx.createPattern(tile, 'repeat');
}

// { fill, border } of a platform; unknown keys (e.g. "total") use the brand color.
// The border is always full color, the fill can be made translucent with alpha < 1.
function getPlatformStyle(key, alpha = 1) {
  const fillOf = (hex) => (alpha < 1 ? withAlpha(hex, alpha) : hex);

  switch (key) {
    case 'ps3': return { fill: fillOf(PS3_COLOR), border: PS3_COLOR };
    case 'ps4': return { fill: fillOf(PS4_COLOR), border: PS4_COLOR };
    case 'psvita': return { fill: fillOf(PSVITA_COLOR), border: PSVITA_COLOR };
    case 'ps5': return { fill: fillOf(PS5_COLOR), border: PS5_BORDER_COLOR };
    case 'vr': return { fill: createStripePattern(fillOf(PS5_COLOR), fillOf(PS4_COLOR)), border: PS4_COLOR };
    case 'multiplatform': return { fill: fillOf(MULTIPLATFORM_COLOR), border: MULTIPLATFORM_COLOR };
    default: {
      const brand = cssColor('--brand');
      return { fill: fillOf(brand), border: brand };
    }
  }
}

// Rarity buckets: a rate belongs to the first bucket whose upper bound is greater than the rate.
// The color of each bucket is a .guide-bg-N class: 80-100% = guide-bg-1 ... 0-5% = guide-bg-9
const RARITY_BUCKETS = [
  { label: '0-5%', max: 5 },
  { label: '5-10%', max: 10 },
  { label: '10-15%', max: 15 },
  { label: '15-20%', max: 20 },
  { label: '20-30%', max: 30 },
  { label: '30-40%', max: 40 },
  { label: '40-60%', max: 60 },
  { label: '60-80%', max: 80 },
  { label: '80-100%', max: Infinity }
];

// Number of platinums per rarity bucket, using the "Platinum rarity" option
function getRarityBucketCounts() {
  const counts = RARITY_BUCKETS.map(() => 0);
  getRatedEntries(getPlatinumEntries()).forEach(entry => {
    const index = RARITY_BUCKETS.findIndex(bucket => entry.rate < bucket.max);
    counts[index]++;
  });
  return counts;
}

// Background color of a CSS class, as "#RRGGBB"
function getClassBackgroundHex(className) {
  const probe = createEl('div', className);
  document.body.appendChild(probe);
  const [r, g, b] = getComputedStyle(probe).backgroundColor.match(/\d+/g).map(Number);
  probe.remove();
  return `#${[r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')}`;
}

// Same colors as the guide badges, in bucket order (0-5% gets the last one)
const getRarityColors = () =>
  RARITY_BUCKETS.map((bucket, i) => getClassBackgroundHex(`guide-bg-${RARITY_BUCKETS.length - i}`));

// Radius in pixels of the circle in the middle of the polar charts (the same in every chart)
const CENTER_CIRCLE_RADIUS = 22;

// Draws a filled circle with a number in the middle of a polar chart
// (option: plugins.centerCircle = { text, color, radius }).
// The scale is shifted so that its zero is exactly on the edge of the circle.
const centerCirclePlugin = {
  id: 'centerCircle',

  // Runs after the scale knows its size, before the slices are positioned
  afterLayout(chart, args, options) {
    if (!options?.text) return;
    const r = chart.scales.r;
    r.min = -options.radius * r.max / (r.drawingArea - options.radius);
  },

  afterDatasetsDraw(chart, args, options) {
    if (!options?.text) return;
    const { ctx, scales: { r } } = chart;

    ctx.save();
    ctx.beginPath();
    ctx.arc(r.xCenter, r.yCenter, options.radius, 0, Math.PI * 2);
    ctx.fillStyle = options.color;
    ctx.fill();

    ctx.font = 'bold 16px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(options.text, r.xCenter, r.yCenter);
    ctx.restore();
  }
};

const WITH_PLATINUM_INDEX = 1;   // position of "with platinum" in the platformStats arrays

// One bar per platformStats value, no legend: the x labels say what each bar is.
// The red part on top of "with platinum" is the number of platinums that can no longer be obtained.
function createPlatformBarChart(canvas, values, style, lostPlatinums = 0) {
  const lost = Math.min(lostPlatinums, values[WITH_PLATINUM_INDEX] ?? 0);
  const baseValues = values.map((value, i) => (i === WITH_PLATINUM_INDEX ? value - lost : value));
  const lostValues = values.map((value, i) => (i === WITH_PLATINUM_INDEX ? lost : 0));

  const options = createBaseChartOptions();
  options.plugins.legend.display = false;
  options.plugins.tooltip = {
    // The red series is listed only where it has a value
    filter: (item) => item.datasetIndex === 0 || item.raw > 0
  };
  options.scales.x.stacked = true;
  options.scales.y.stacked = true;
  options.scales.x.ticks = { maxRotation: 0, autoSkip: false, font: { size: 10 } };
  options.scales.y.ticks = { precision: 0 };

  const errorColor = cssColor('--error');
  const datasets = [
    {
      ...createBarDataset('Games', baseValues, style.border),
      backgroundColor: style.fill,
      borderColor: style.border
    },
    {
      ...createBarDataset('Platinum no longer obtainable', lostValues, errorColor),
      backgroundColor: errorColor
    }
  ];

  return new Chart(canvas, {
    type: 'bar',
    data: { labels: PLATFORM_STAT_LABELS, datasets },
    options
  });
}

// Polar area chart with the labels centered on each slice; one fill/border color per slice.
// With centerText a circle with that text is drawn in the middle and the scale starts outside of it.
function createPolarChart(canvas, labels, datasetLabel, data, fills, borders, centerText = '') {
  const gridColor = 'rgba(0, 0, 0, 0.1)';

  const radialScale = {
    beginAtZero: true,
    ticks: { precision: 0, backdropColor: 'transparent' },
    grid: { color: gridColor },
    angleLines: { display: true, color: gridColor },
    pointLabels: { display: true, centerPointLabels: true, font: { size: 11 } }
  };

  if (centerText) {
    const maxValue = Math.max(...data, 1);
    const step = Math.max(1, Math.ceil(maxValue / 4 / 5) * 5);

    radialScale.min = -1;   // placeholder: the plugin sets the real minimum after the layout
    radialScale.max = Math.ceil(maxValue / step) * step;
    radialScale.ticks.callback = (value) => (value > 0 ? value : '');
    radialScale.afterBuildTicks = (scale) => {
      scale.ticks = [];
      for (let value = 0; value <= scale.max; value += step) scale.ticks.push({ value });
    };
  }

  return new Chart(canvas, {
    type: 'polarArea',
    data: {
      labels,
      datasets: [{ label: datasetLabel, data, backgroundColor: fills, borderColor: borders, borderWidth: 1 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        centerCircle: { text: centerText, color: cssColor('--platinum'), radius: CENTER_CIRCLE_RADIUS }
      },
      scales: { r: radialScale }
    },
    plugins: [centerCirclePlugin]
  });
}

function renderPlatformCharts(container, platformStats) {
  // Six bar charts, three per row, full-color platform fills ("total" has no chart of its own)
  const lostPlatinums = getLostPlatinumCounts();
  Object.entries(platformStats)
    .filter(([key]) => key !== 'total')
    .forEach(([key, values]) => {
      statCharts.push(createPlatformBarChart(
        createStatCard(container, getPlatformTitle(key), 'third'),
        values,
        getPlatformStyle(key),
        lostPlatinums[key] || 0
      ));
    });

  // Polar charts: "total" is left out of the slices and written in the center
  const platforms = Object.keys(platformStats).filter(key => key !== 'total');
  const platformLabels = platforms.map(getPlatformTitle);
  const styles = platforms.map(key => getPlatformStyle(key, FILL_OPACITY));   // 35% fill, full-color border
  const fills = styles.map(style => style.fill);
  const borders = styles.map(style => style.border);
  const total = platformStats.total || [];

  statCharts.push(createPolarChart(
    createStatCard(container, 'Games per platform', 'third'),
    platformLabels,
    'Games',
    platforms.map(key => platformStats[key][STAT_INDEX_TOTAL_GAMES]),
    fills,
    borders,
    String(total[STAT_INDEX_TOTAL_GAMES] ?? 0)         // in "Games per platform"
  ));

  statCharts.push(createPolarChart(
    createStatCard(container, 'Platinums per platform', 'third'),
    platformLabels,
    'Platinums',
    platforms.map(key => platformStats[key][STAT_INDEX_PLATINUMS_EARNED]),
    fills,
    borders,
    String(total[STAT_INDEX_PLATINUMS_EARNED] ?? 0)    // in "Platinums per platform"
  ));

  const rarityColors = getRarityColors();
  statCharts.push(createPolarChart(
    createStatCard(container, 'Platinum rarity', 'third'),
    RARITY_BUCKETS.map(bucket => bucket.label),
    'Platinums',
    getRarityBucketCounts(),
    rarityColors.map(color => withAlpha(color, FILL_OPACITY)),   // 35% fill, full-color border
    rarityColors
  ));
}

// ==========================================================================
// OUTATIME: UNOBTAINABLE TROPHIES NOT EARNED
// ==========================================================================

const isPlatinumTrophy = (trophy) => String(trophy.tType).trim().toLowerCase() === 'platinum';

// Games of My Games with trophies that can no longer be obtained and were not earned.
// A game where only the platinum is left is skipped: the platinum itself is still obtainable,
// because all the other trophies were earned in time.
function getOutatimeEntries() {
  return allTrophies
    .map(game => {
      const unobInfo = unobtainableMap[game.npCommunicationId];
      const trophies = unobInfo
        ? game.trophies.filter(trophy => isTrophyUnobtainable(unobInfo, trophy) && !isTrophyEarned(trophy))
        : [];
      return { game, unobInfo, trophies };
    })
    .filter(entry => entry.trophies.some(trophy => !isPlatinumTrophy(trophy)))
    .sort((a, b) => a.game.title.toLowerCase().localeCompare(b.game.title.toLowerCase()));
}

// Key of platformStats a game is counted in.
// VR games (VR is always combined with PS4 or PS5) go to "vr", games on several platforms to "multiplatform",
// the others to their own platform ("PS3" -> "ps3", "PSVITA" -> "psvita"...).
function getPlatformStatKey(platforms) {
  const names = platforms.map(p => String(p).toLowerCase());
  if (names.some(p => ['vr', 'psvr', 'psvr2'].includes(p))) return 'vr';
  return names.length === 1 ? names[0] : 'multiplatform';
}

// Platinums that can no longer be obtained, per platformStats key:
// games listed in OUTATIME whose platinum is itself one of the missed unobtainable trophies
function getLostPlatinumCounts() {
  const counts = {};
  getOutatimeEntries()
    .filter(({ trophies }) => trophies.some(isPlatinumTrophy))
    .forEach(({ game }) => {
      const key = getPlatformStatKey(game.platforms);
      counts[key] = (counts[key] || 0) + 1;
    });
  return counts;
}

// Game name, platforms and PSNP+ note; spans all the missed trophies of the game
function createOutatimeGameCell({ game, unobInfo, trophies }) {
  const cell = createEl('td');
  cell.rowSpan = trophies.length;
  cell.style.verticalAlign = 'top';
  cell.appendChild(createGameNameBlock(game.title, game.R, game.platforms).container);

  if (unobInfo.note) {
    const note = createEl('div', '', unobInfo.note);
    note.style.cssText = 'margin-top: 6px; font-size: 11px; color: var(--text-muted);';
    cell.appendChild(note);
  }
  return cell;
}

function createOutatimeTrophyCells(trophy, game) {
  const iconCell = createEl('td', 'center-cell');
  const icon = createEl('img', 'trophy-icon');
  icon.loading = 'lazy';
  setCachedImage(icon, getIconUrl(game, trophy.icon));
  iconCell.appendChild(icon);

  const type = String(trophy.tType || 'bronze').trim().toLowerCase();
  const typeCell = createEl('td', 'center-cell');
  const typeImg = createEl('img', 'trophy-type-img');
  typeImg.src = `img/${getIconPrefix(game.isPS5)}_${type}.png`;
  typeImg.alt = type;
  typeCell.appendChild(typeImg);

  return [
    iconCell,
    typeCell,
    createTextCell(trophy.tName || 'Trophy', false, true),
    createTextCell(trophy.tDetail || ''),
    createRarityCell(trophy)
  ];
}

function createOutatimeRows(entry) {
  return entry.trophies.map((trophy, index) => {
    const cells = createOutatimeTrophyCells(trophy, entry.game);
    if (index === 0) cells.unshift(createOutatimeGameCell(entry));
    return cells;
  });
}

function renderOutatime(container) {
  const entries = getOutatimeEntries();
  const trophyCount = entries.reduce((sum, entry) => sum + entry.trophies.length, 0);

  const card = createEl('div', 'stat-card wide');
  const title = createEl('h3', 'stat-title',
    `OUTATIME - Trophies lost in time (${trophyCount} ${trophyCount === 1 ? 'trophy' : 'trophies'} in ${entries.length} ${entries.length === 1 ? 'game' : 'games'})`);
  title.style.color = 'var(--error)';
  card.appendChild(title);

  if (entries.length === 0) {
    card.appendChild(createEl('div', 'platiroom-empty', 'No missed unobtainable trophies.'));
  } else {
    card.appendChild(createPlatiroomTable([
      { label: 'Game', width: '30%' },
      { label: 'Icon', width: '70px', centered: true },
      { label: 'Type', width: '40px', centered: true },
      { label: 'Trophy', width: '20%' },
      { label: 'Description' },
      { label: 'Rarity', width: '60px', centered: true }
    ], entries.flatMap(createOutatimeRows)));
  }

  container.appendChild(card);
}

// ==========================================================================
// LEVEL BRACKETS (right side of Level Progression)
// ==========================================================================

const LEVEL_AXIS_STEP = 100;      // the level axis grows by this amount: it is also the width of a tier band
const TIER_COUNT = 10;            // tier n covers the levels (n - 1) * 100 to n * 100; tier 10 is 900-999
const TIER_ZONE_WIDTH = 44;       // space reserved on the right of the chart
const TIER_ICON_MAX_SIZE = 30;    // size of the icons (smaller if the bands are narrower)


const tierImages = {};

// Image of a tier (loaded once); onLoad is called when it becomes available
function getTierImage(tier, onLoad) {
  if (!tierImages[tier]) {
    tierImages[tier] = new Image();
    tierImages[tier].src = `img/Tier_${tier}.png`;
  }
  const img = tierImages[tier];
  if (!img.complete) img.addEventListener('load', onLoad, { once: true });
  return img;
}

const tierBracketsPlugin = {
  id: 'tierBrackets',
  afterDraw(chart) {
    const { ctx, chartArea, scales: { y } } = chart;
    const left = chartArea.right;
    const centerX = left + TIER_ZONE_WIDTH / 2;
    const redraw = () => { if (chart.ctx) chart.draw(); };   // ctx is null once the chart is destroyed

    // Visible bands, one per tier
    const bands = [];
    for (let tier = 1; tier <= TIER_COUNT; tier++) {
      const start = (tier - 1) * LEVEL_AXIS_STEP;
      const low = Math.max(start, y.min);
      const high = Math.min(start + LEVEL_AXIS_STEP, y.max);
      if (high <= low) continue;   // tier outside the visible range

      bands.push({
        tier,
        start,
        topPx: y.getPixelForValue(high),
        bottomPx: y.getPixelForValue(low)
      });
    }

    // Same size for every icon: the biggest one that fits in the narrowest band
    const iconSize = Math.min(TIER_ICON_MAX_SIZE, ...bands.map(b => b.bottomPx - b.topPx)) - 4;

    ctx.save();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.lineWidth = 1;

    // Vertical line that closes the plot
    ctx.beginPath();
    ctx.moveTo(left + 0.5, chartArea.top);
    ctx.lineTo(left + 0.5, chartArea.bottom);
    ctx.stroke();

    bands.forEach(({ tier, start, topPx, bottomPx }) => {
      // Separator at the start of the tier
      if (start > y.min) {
        const lineY = Math.round(bottomPx) + 0.5;
        ctx.beginPath();
        ctx.moveTo(left, lineY);
        ctx.lineTo(left + TIER_ZONE_WIDTH, lineY);
        ctx.stroke();
      }

      // Icon centered in the band, keeping its proportions
      const img = getTierImage(tier, redraw);
      if (!img.complete || !img.naturalWidth) return;

      let height = iconSize;
      let width = height * img.naturalWidth / img.naturalHeight;
      if (width > TIER_ZONE_WIDTH - 8) {
        width = TIER_ZONE_WIDTH - 8;
        height = width * img.naturalHeight / img.naturalWidth;
      }

      const centerY = (topPx + bottomPx) / 2;
      ctx.drawImage(img, centerX - width / 2, centerY - height / 2, width, height);
    });

    ctx.restore();
  }
};

function createLevelChart(canvas, labels, data, color) {
  const options = createBaseChartOptions();
  applyMonthTicks(options);
  options.layout = { padding: { right: TIER_ZONE_WIDTH } };   // room for the brackets

  // Y axis in steps of LEVEL_AXIS_STEP, so that every tier band is a whole step
  options.scales.y.min = 0;
  options.scales.y.max = Math.max(LEVEL_AXIS_STEP, Math.ceil(Math.max(...data) / LEVEL_AXIS_STEP) * LEVEL_AXIS_STEP);
  options.scales.y.ticks = { stepSize: LEVEL_AXIS_STEP };

  return new Chart(canvas, {
    type: 'line',
    data: { labels, datasets: [createLineDataset('Level', data, color)] },
    options,
    plugins: [tierBracketsPlugin]
  });
}

function renderStatistics() {
  const container = document.getElementById('stat-container');
  statCharts.splice(0).forEach(chart => chart.destroy());
  container.innerHTML = '';

  const progression = userStatData?.trophyProgression;
  const activity = userStatData?.trophyActivity;
  if (!progression || !activity) {
    container.appendChild(createEl('div', 'platiroom-empty', 'No statistics data available.'));
    return;
  }
  if (typeof Chart === 'undefined') {
    container.appendChild(createEl('div', 'platiroom-empty', 'Chart.js is not loaded.'));
    return;
  }

  Chart.defaults.font.family = 'Arial, sans-serif';
  Chart.defaults.color = cssColor('--text-main');

  const colors = TROPHY_SERIES.map(series => cssColor(series.color));
  const trophyDatasets = (source, createDataset) =>
    TROPHY_SERIES.map((series, i) => createDataset(series.label, getStatValues(source, i), colors[i]));

  // Trophy Progression: platinum, gold, silver, bronze (platinum in front)
  statCharts.push(createLineChart(
    createStatCard(container, 'Trophy Progression'),
    Object.keys(progression),
    trophyDatasets(progression, createLineDataset)
  ));

  // Level Progression: fifth value of trophyProgression, with the level brackets on the right
  statCharts.push(createLevelChart(
    createStatCard(container, 'Level Progression'),
    Object.keys(progression),
    getStatValues(progression, 4),
    cssColor('--brand')
  ));

  // Trophy Activity: stacked bars, one stack per period
  statCharts.push(createStackedBarChart(
    createStatCard(container, 'Trophy Activity', 'wide'),
    Object.keys(activity),
    trophyDatasets(activity, createBarDataset)
  ));
  
  // Platform bar charts and radar charts
  if (userStatData.platformStats) renderPlatformCharts(container, userStatData.platformStats);
  
  // Unobtainable trophies not earned
  renderOutatime(container);
}