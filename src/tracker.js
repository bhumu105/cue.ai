/**
 * Cue Tracker — Local storage for prompt improvement tracking
 * Logs scored prompts, calculates stats and trends over time
 */
(function () {
  'use strict';

  window.Cue = window.Cue || {};

  var STORAGE_KEY = 'cue_logs';

  // ─── Helpers ──────────────────────────────────────────────

  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getStorage() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(STORAGE_KEY, function (result) {
        resolve(result[STORAGE_KEY] || []);
      });
    });
  }

  function setStorage(logs) {
    return new Promise(function (resolve) {
      var data = {};
      data[STORAGE_KEY] = logs;
      chrome.storage.local.set(data, resolve);
    });
  }

  function startOfWeek(date) {
    var d = new Date(date);
    var day = d.getDay();
    var diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday start
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  // ─── Log ──────────────────────────────────────────────────

  function log(promptText, scores, rewriteAccepted, rewriteEdited) {
    var entry = {
      id: generateUUID(),
      timestamp: new Date().toISOString(),
      raw_prompt: promptText,
      scores: {
        clarity: scores.clarity,
        context: scores.context,
        specificity: scores.specificity,
        focus: scores.focus
      },
      total: scores.total,
      cue_score: scores.cueScore,
      rewrite_accepted: !!rewriteAccepted,
      rewrite_edited: !!rewriteEdited
    };

    return getStorage().then(function (logs) {
      logs.push(entry);
      return setStorage(logs);
    });
  }

  // ─── Stats ────────────────────────────────────────────────

  function getStats() {
    return getStorage().then(function (logs) {
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

      // Total prompts
      var totalPrompts = logs.length;

      // Average cue score
      var scoreSum = 0;
      for (var i = 0; i < logs.length; i++) {
        scoreSum += logs[i].cue_score;
      }
      var averageCueScore = Math.round(scoreSum / totalPrompts);

      // Weakest dimension — lowest average across all prompts
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

      // Score this week
      var now = new Date();
      var weekStart = startOfWeek(now);
      var thisWeekLogs = logs.filter(function (e) {
        return new Date(e.timestamp) >= weekStart;
      });

      var scoreThisWeek = 0;
      if (thisWeekLogs.length > 0) {
        var weekSum = 0;
        for (var w = 0; w < thisWeekLogs.length; w++) {
          weekSum += thisWeekLogs[w].cue_score;
        }
        scoreThisWeek = Math.round(weekSum / thisWeekLogs.length);
      }

      // Score trend — this week's average minus last week's average
      var lastWeekStart = new Date(weekStart);
      lastWeekStart.setDate(lastWeekStart.getDate() - 7);
      var lastWeekLogs = logs.filter(function (e) {
        var ts = new Date(e.timestamp);
        return ts >= lastWeekStart && ts < weekStart;
      });

      var scoreTrend = 0;
      if (lastWeekLogs.length > 0 && thisWeekLogs.length > 0) {
        var lastWeekSum = 0;
        for (var lw = 0; lw < lastWeekLogs.length; lw++) {
          lastWeekSum += lastWeekLogs[lw].cue_score;
        }
        var lastWeekAvg = lastWeekSum / lastWeekLogs.length;
        scoreTrend = Math.round(scoreThisWeek - lastWeekAvg);
      }

      // Acceptance rate — percentage of prompts where rewrite was accepted or edited
      var accepted = 0;
      for (var a = 0; a < logs.length; a++) {
        if (logs[a].rewrite_accepted || logs[a].rewrite_edited) {
          accepted++;
        }
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
    });
  }

  // ─── History ──────────────────────────────────────────────

  function getHistory(limit) {
    return getStorage().then(function (logs) {
      var n = limit && limit > 0 ? limit : 20;
      return logs.slice(-n).reverse();
    });
  }

  // ─── Clear ────────────────────────────────────────────────

  function clear() {
    return setStorage([]);
  }

  // ─── Public API ───────────────────────────────────────────

  window.Cue.Tracker = {
    log: log,
    getStats: getStats,
    getHistory: getHistory,
    clear: clear
  };

})();
