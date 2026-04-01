/**
 * Cue Background Service Worker
 * Initializes storage on install, handles message passing for popup
 */

var STORAGE_KEY = 'cue_logs';

// ─── Install ────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(function (details) {
  if (details.reason === 'install') {
    var data = {};
    data[STORAGE_KEY] = [];
    chrome.storage.local.set(data, function () {
      console.log('[Cue] Storage initialized');
    });
  }
});

// ─── Message Handlers ───────────────────────────────────────

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.type === 'GET_STATS') {
    chrome.storage.local.get(STORAGE_KEY, function (result) {
      var logs = result[STORAGE_KEY] || [];
      sendResponse(computeStats(logs));
    });
    return true; // keep channel open for async response
  }

  if (message.type === 'CLEAR_STATS') {
    var data = {};
    data[STORAGE_KEY] = [];
    chrome.storage.local.set(data, function () {
      console.log('[Cue] Stats cleared');
      sendResponse({ success: true });
    });
    return true;
  }
});

// ─── Stats Computation ──────────────────────────────────────

function computeStats(logs) {
  if (logs.length === 0) {
    return {
      totalPrompts: 0,
      averageCueScore: 0,
      weakestDimension: null,
      scoreThisWeek: 0,
      scoreTrend: 0,
      acceptanceRate: 0
    };
  }

  var totalPrompts = logs.length;

  // Average cue score
  var scoreSum = 0;
  for (var i = 0; i < logs.length; i++) {
    scoreSum += logs[i].cue_score;
  }
  var averageCueScore = Math.round(scoreSum / totalPrompts);

  // Weakest dimension
  var dims = ['clarity', 'context', 'specificity', 'focus'];
  var dimSums = { clarity: 0, context: 0, specificity: 0, focus: 0 };
  for (var j = 0; j < logs.length; j++) {
    for (var d = 0; d < dims.length; d++) {
      dimSums[dims[d]] += logs[j].scores[dims[d]];
    }
  }

  var weakestDimension = dims[0];
  var lowestAvg = dimSums[dims[0]] / totalPrompts;
  for (var k = 1; k < dims.length; k++) {
    var avg = dimSums[dims[k]] / totalPrompts;
    if (avg < lowestAvg) {
      lowestAvg = avg;
      weakestDimension = dims[k];
    }
  }

  // Week boundaries (Monday start)
  var now = new Date();
  var day = now.getDay();
  var weekStart = new Date(now);
  weekStart.setDate(now.getDate() - day + (day === 0 ? -6 : 1));
  weekStart.setHours(0, 0, 0, 0);

  var lastWeekStart = new Date(weekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);

  // This week
  var thisWeekSum = 0;
  var thisWeekCount = 0;
  // Last week
  var lastWeekSum = 0;
  var lastWeekCount = 0;
  // Acceptance
  var accepted = 0;

  for (var m = 0; m < logs.length; m++) {
    var ts = new Date(logs[m].timestamp);
    if (ts >= weekStart) {
      thisWeekSum += logs[m].cue_score;
      thisWeekCount++;
    } else if (ts >= lastWeekStart && ts < weekStart) {
      lastWeekSum += logs[m].cue_score;
      lastWeekCount++;
    }
    if (logs[m].rewrite_accepted || logs[m].rewrite_edited) {
      accepted++;
    }
  }

  var scoreThisWeek = thisWeekCount > 0 ? Math.round(thisWeekSum / thisWeekCount) : 0;
  var scoreTrend = 0;
  if (thisWeekCount > 0 && lastWeekCount > 0) {
    scoreTrend = Math.round(scoreThisWeek - (lastWeekSum / lastWeekCount));
  }
  var acceptanceRate = Math.round((accepted / totalPrompts) * 100);

  return {
    totalPrompts: totalPrompts,
    averageCueScore: averageCueScore,
    weakestDimension: weakestDimension,
    scoreThisWeek: scoreThisWeek,
    scoreTrend: scoreTrend,
    acceptanceRate: acceptanceRate
  };
}
