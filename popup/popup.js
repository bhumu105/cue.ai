/**
 * Cue Popup — Stats dashboard
 * Fetches stats via chrome.runtime.sendMessage, renders improvement data
 */
(function () {
  'use strict';

  // ─── Score Colors ─────────────────────────────────────────

  function scoreColor(score) {
    if (score > 80) return '#22c55e';
    if (score > 60) return '#84cc16';
    if (score > 40) return '#eab308';
    if (score > 20) return '#f97316';
    return '#ef4444';
  }

  // ─── Weekly Tips ──────────────────────────────────────────

  var TIPS = {
    clarity: 'Try starting prompts with a clear action verb — "fix", "explain", "write", "compare". Tell Claude exactly what to do.',
    context: 'Try including code, error messages, or examples in your prompts. The more Claude sees, the less it guesses.',
    specificity: 'Try adding constraints — desired length, format, tone, or what to avoid. Boundaries sharpen the output.',
    focus: 'Try asking one thing at a time. Split multi-part requests into separate prompts for better answers.'
  };

  // ─── DOM Refs ─────────────────────────────────────────────

  var els = {
    emptyState: document.getElementById('empty-state'),
    statsSection: document.getElementById('stats-section'),
    avgScore: document.getElementById('avg-score'),
    totalPrompts: document.getElementById('total-prompts'),
    scoreThisWeek: document.getElementById('score-this-week'),
    scoreTrend: document.getElementById('score-trend'),
    acceptanceRate: document.getElementById('acceptance-rate'),
    weaknessCard: document.getElementById('weakness-card'),
    weaknessDim: document.getElementById('weakness-dim'),
    weaknessTip: document.getElementById('weakness-tip'),
    clearBtn: document.getElementById('clear-btn')
  };

  // ─── Render ───────────────────────────────────────────────

  function render(stats) {
    if (stats.totalPrompts === 0) {
      els.emptyState.style.display = 'block';
      els.statsSection.style.display = 'none';
      return;
    }

    els.emptyState.style.display = 'none';
    els.statsSection.style.display = 'block';

    // Average score
    els.avgScore.textContent = stats.averageCueScore;
    els.avgScore.style.color = scoreColor(stats.averageCueScore);

    // Total prompts
    els.totalPrompts.textContent = stats.totalPrompts + ' prompt' + (stats.totalPrompts !== 1 ? 's' : '') + ' scored';

    // This week
    els.scoreThisWeek.textContent = stats.scoreThisWeek || '--';

    // Trend
    if (stats.scoreTrend > 0) {
      els.scoreTrend.textContent = '\u2191 +' + stats.scoreTrend;
      els.scoreTrend.className = 'stat-value trend-up';
    } else if (stats.scoreTrend < 0) {
      els.scoreTrend.textContent = '\u2193 ' + stats.scoreTrend;
      els.scoreTrend.className = 'stat-value trend-down';
    } else {
      els.scoreTrend.textContent = '\u2014';
      els.scoreTrend.className = 'stat-value trend-flat';
    }

    // Acceptance rate
    els.acceptanceRate.textContent = stats.acceptanceRate + '%';

    // Weakest dimension
    if (stats.weakestDimension) {
      els.weaknessCard.style.display = 'block';
      els.weaknessDim.textContent = stats.weakestDimension;
      els.weaknessTip.textContent = TIPS[stats.weakestDimension] || '';
    } else {
      els.weaknessCard.style.display = 'none';
    }
  }

  // ─── Load Stats ───────────────────────────────────────────

  function loadStats() {
    chrome.runtime.sendMessage({ type: 'GET_STATS' }, function (stats) {
      if (stats) render(stats);
    });
  }

  // ─── Clear Stats ──────────────────────────────────────────

  els.clearBtn.addEventListener('click', function () {
    if (!confirm('Clear all Cue stats? This cannot be undone.')) return;

    chrome.runtime.sendMessage({ type: 'CLEAR_STATS' }, function () {
      loadStats();
    });
  });

  // ─── Init ─────────────────────────────────────────────────

  loadStats();

})();
