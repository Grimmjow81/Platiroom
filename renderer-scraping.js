// renderer-scraping.js
// "Personal data" window: NPSSO token and account scraper, with status line, progress bar and "Details" log.
// Loaded after renderer-global.js, which provides getSettings, loadStatData, loadProfileInfo, loadTrophiesData,
// renderPlatiroom, renderStatistics and activeTabId.

// ==========================================================================
// DOM REFERENCES AND STATE
// ==========================================================================

const scrapingDialog = document.getElementById('scraping-dialog');
const txtNpsso = document.getElementById('txt-npsso');
const btnGetData = document.getElementById('btn-get-data');
const btnScrapingCancel = document.getElementById('scraping-cancel');
const btnScrapingOk = document.getElementById('scraping-ok');

const scrapingProgress = document.getElementById('scraping-progress');
const scrapingStatus = document.getElementById('scraping-status');
const scrapingBar = document.getElementById('scraping-bar');
const scrapingBarFill = document.getElementById('scraping-bar-fill');
const scrapingBarText = document.getElementById('scraping-bar-text');
const scrapingDetails = document.getElementById('scraping-details');
const scrapingLog = document.getElementById('scraping-log');

const MAX_LOG_LINES = 500;

let scrapingRunning = false;
let scrapingTotal = 0;          // games to download in the current run
let scrapingLogLines = [];

// ==========================================================================
// BUTTONS AND LOCK
// ==========================================================================

function updateScraperButtonState() {
  btnGetData.disabled = scrapingRunning || txtNpsso.value.trim().length !== 64;
}

// While the scraper runs the window cannot be closed or edited
function setScrapingRunning(running) {
  scrapingRunning = running;
  btnScrapingCancel.disabled = running;
  btnScrapingOk.disabled = running;
  txtNpsso.disabled = running;
  updateScraperButtonState();
}

// ==========================================================================
// PROGRESS DISPLAY
// ==========================================================================

function setScrapingStatus(text, kind = '') {
  scrapingStatus.textContent = text;
  scrapingStatus.className = kind ? `scraping-status ${kind}` : 'scraping-status';
}

// No known total yet: the bar moves back and forth
function showBarIndeterminate() {
  scrapingBar.classList.add('indeterminate');
  scrapingBarFill.style.width = '';
  scrapingBarText.textContent = '';
}

function showBar(percent, text = '') {
  scrapingBar.classList.remove('indeterminate');
  scrapingBarFill.style.width = `${percent}%`;
  scrapingBarText.textContent = text;
}

function appendScrapingLog(level, text) {
  const line = String(text ?? '').trim();
  if (!line) return;

  scrapingLogLines.push(line);
  if (scrapingLogLines.length > MAX_LOG_LINES) scrapingLogLines.shift();

  scrapingLog.textContent = scrapingLogLines.join('\n');
  scrapingLog.scrollTop = scrapingLog.scrollHeight;
}

function resetScrapingProgress() {
  scrapingLogLines = [];
  scrapingLog.textContent = '';
  scrapingTotal = 0;
  scrapingDetails.open = false;
  scrapingProgress.hidden = false;
  setScrapingStatus('Starting...');
  showBarIndeterminate();
}

// Events sent by runUserScraper (see scraper-user.js)
function handleScrapingProgress(event) {
  switch (event.phase) {
    case 'auth':
      setScrapingStatus('Signing in to PSN...');
      showBarIndeterminate();
      break;
    case 'profile':
      setScrapingStatus('Reading your profile...');
      break;
    case 'titles':
      setScrapingStatus('Retrieving your game list...');
      break;
    case 'plan':
      scrapingTotal = event.toUpdate;
      if (event.toUpdate === 0) {
        setScrapingStatus(`${event.found} games found: everything is up to date.`);
        showBar(100);
      } else {
        setScrapingStatus(`${event.found} games found, ${event.toUpdate} to update.`);
        showBar(0, `0 / ${event.toUpdate}`);
      }
      break;
    case 'game':
      setScrapingStatus(`Updating ${event.current}/${event.total}: ${event.title}`);
      showBar(((event.current - 1) / event.total) * 100, `${event.current - 1} / ${event.total}`);
      break;
    case 'save':
      setScrapingStatus('Saving your data...');
      showBar(100, scrapingTotal > 0 ? `${scrapingTotal} / ${scrapingTotal}` : '');
      break;
  }
}

function showScrapingFailure(message) {
  setScrapingStatus(message, 'error');
  showBar(0);
  scrapingDetails.open = true;
}

function showScrapingSummary(stats) {
  if (stats.aborted) {
    showScrapingFailure('Could not retrieve your game list. Check your connection and your NPSSO token, then try again.');
    return;
  }

  const summary = [
    `${stats.addedUpdated} updated`,
    `${stats.skipped} already up to date`,
    `${stats.failed} ${stats.failed === 1 ? 'error' : 'errors'}`
  ].join(' · ');

  showBar(100, scrapingTotal > 0 ? `${scrapingTotal} / ${scrapingTotal}` : '');

  if (stats.failed > 0) {
    setScrapingStatus(`Finished with errors: ${summary}`, 'warning');
    if (stats.failedGames?.length > 0) {
      appendScrapingLog('warn', `Games not updated (try again later): ${stats.failedGames.join(', ')}`);
    }
    scrapingDetails.open = true;
  } else {
    setScrapingStatus(`Done: ${summary}`, 'success');
  }
}

// ==========================================================================
// RUN
// ==========================================================================

async function handleGetData() {
  setScrapingRunning(true);
  resetScrapingProgress();
  btnGetData.textContent = 'Retrieving user data...';

  try {
    // The scraper reads the token from options.json, so save it first
    await window.api.saveConfig({ NPSSO: txtNpsso.value.trim() });

    const stats = await window.api.runMyGames({
      onProgress: handleScrapingProgress,
      onLog: appendScrapingLog
    });

    if (!stats.aborted) {
      await loadStatData();
      await loadProfileInfo();
      if (activeTabId === 'platiroom') renderPlatiroom();
      if (activeTabId === 'statistics') renderStatistics();
      await loadTrophiesData();
	  renderShutdownList();
    }

    showScrapingSummary(stats);
  } catch (err) {
    console.error('Error while scraping user data:', err);
    const message = err?.message ?? String(err);
    appendScrapingLog('error', `❌ ${message}`);
    showScrapingFailure(`Update failed: ${message}`);
  } finally {
    btnGetData.textContent = 'Get your data';
    setScrapingRunning(false);
  }
}

// ==========================================================================
// OPEN, SAVE, SETUP
// ==========================================================================

async function openScrapingDialog() {
  const settings = await getSettings();
  txtNpsso.value = settings.NPSSO || '';
  updateScraperButtonState();

  // A summary of an earlier run is not shown again
  if (!scrapingRunning) scrapingProgress.hidden = true;

  if (!scrapingDialog.open) scrapingDialog.showModal();
}

async function saveScrapingConfig() {
  await window.api.saveConfig({ NPSSO: txtNpsso.value.trim() });
  scrapingDialog.close();
}

function setupScrapingDialog() {
  document.getElementById('btn-scraping-dialog').addEventListener('click', openScrapingDialog);

  txtNpsso.addEventListener('input', updateScraperButtonState);
  btnGetData.addEventListener('click', handleGetData);
  btnScrapingCancel.addEventListener('click', () => scrapingDialog.close());
  btnScrapingOk.addEventListener('click', saveScrapingConfig);

  // Esc closes a modal dialog: not while the scraper runs. A browser may refuse to cancel a second Esc,
  // so if the dialog closes anyway it is opened again.
  scrapingDialog.addEventListener('cancel', (e) => {
    if (scrapingRunning) e.preventDefault();
  });
  scrapingDialog.addEventListener('close', () => {
    if (scrapingRunning) scrapingDialog.showModal();
  });
}

document.addEventListener('DOMContentLoaded', setupScrapingDialog);
