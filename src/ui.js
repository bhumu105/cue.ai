/**
 * Cue UI — Renders signal bars, suggestion bar, perception display, and diff modal
 * Dark theme, injected CSS, positioned relative to claude.ai's editor
 */
(function () {
  'use strict';

  window.Cue = window.Cue || {};

  // ─── Constants ────────────────────────────────────────────

  var PREFIX = 'cue-';
  var BAR_THRESHOLDS = [20, 40, 60, 80]; // score boundaries for 0-4 filled bars

  var BAR_COLORS = {
    empty: 'rgba(255, 255, 255, 0.08)',
    0: '#ef4444',  // red — waste of tokens
    1: '#f97316',  // orange — guessing
    2: '#eab308',  // yellow — decent
    3: '#84cc16',  // lime — strong
    4: '#22c55e'   // green — airtight
  };

  var VERDICT_COLORS = {
    'Waste of tokens': '#ef4444',
    'Claude will guess': '#f97316',
    'Decent': '#eab308',
    'Strong': '#84cc16',
    'Airtight': '#22c55e'
  };

  // ─── State ────────────────────────────────────────────────

  var editorEl = null;
  var styleEl = null;
  var signalContainer = null;
  var suggestionBar = null;
  var diffModal = null;
  var currentPerception = null;

  // ─── CSS ──────────────────────────────────────────────────

  var CSS = [
    /* Signal bars container */
    '.' + PREFIX + 'signal {',
    '  display: flex;',
    '  align-items: center;',
    '  gap: 8px;',
    '  padding: 6px 12px;',
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
    '  font-size: 12px;',
    '  color: rgba(255, 255, 255, 0.5);',
    '  user-select: none;',
    '  transition: opacity 0.2s ease;',
    '}',

    /* Individual bars */
    '.' + PREFIX + 'bars {',
    '  display: flex;',
    '  align-items: flex-end;',
    '  gap: 2px;',
    '  height: 16px;',
    '}',
    '.' + PREFIX + 'bar {',
    '  width: 4px;',
    '  border-radius: 1px;',
    '  transition: background-color 0.3s ease, height 0.3s ease;',
    '}',
    '.' + PREFIX + 'bar:nth-child(1) { height: 5px; }',
    '.' + PREFIX + 'bar:nth-child(2) { height: 8px; }',
    '.' + PREFIX + 'bar:nth-child(3) { height: 11px; }',
    '.' + PREFIX + 'bar:nth-child(4) { height: 14px; }',

    /* Score number */
    '.' + PREFIX + 'score-num {',
    '  font-weight: 600;',
    '  font-size: 12px;',
    '  font-variant-numeric: tabular-nums;',
    '  min-width: 32px;',
    '  transition: color 0.3s ease;',
    '}',

    /* Verdict label */
    '.' + PREFIX + 'verdict {',
    '  font-size: 11px;',
    '  font-weight: 500;',
    '  letter-spacing: 0.02em;',
    '  transition: color 0.3s ease;',
    '}',

    /* Perception text (shown inline with signal) */
    '.' + PREFIX + 'perception {',
    '  font-size: 11px;',
    '  color: rgba(255, 255, 255, 0.35);',
    '  margin-left: auto;',
    '  max-width: 50%;',
    '  overflow: hidden;',
    '  text-overflow: ellipsis;',
    '  white-space: nowrap;',
    '  font-style: italic;',
    '}',

    /* Suggestion bar */
    '.' + PREFIX + 'suggestion {',
    '  display: flex;',
    '  align-items: center;',
    '  gap: 10px;',
    '  padding: 8px 12px;',
    '  background: rgba(249, 115, 22, 0.08);',
    '  border: 1px solid rgba(249, 115, 22, 0.2);',
    '  border-radius: 8px;',
    '  margin-bottom: 6px;',
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
    '  font-size: 12px;',
    '  color: rgba(255, 255, 255, 0.7);',
    '  animation: ' + PREFIX + 'slideDown 0.2s ease;',
    '}',
    '@keyframes ' + PREFIX + 'slideDown {',
    '  from { opacity: 0; transform: translateY(-4px); }',
    '  to { opacity: 1; transform: translateY(0); }',
    '}',
    '.' + PREFIX + 'suggestion-text {',
    '  flex: 1;',
    '  font-style: italic;',
    '  color: rgba(255, 255, 255, 0.5);',
    '  overflow: hidden;',
    '  text-overflow: ellipsis;',
    '  white-space: nowrap;',
    '}',
    '.' + PREFIX + 'suggestion-meta {',
    '  font-size: 11px;',
    '  color: rgba(255, 255, 255, 0.3);',
    '  white-space: nowrap;',
    '}',
    '.' + PREFIX + 'suggestion-link {',
    '  color: #f97316;',
    '  cursor: pointer;',
    '  font-weight: 600;',
    '  white-space: nowrap;',
    '  text-decoration: none;',
    '  transition: color 0.15s ease;',
    '}',
    '.' + PREFIX + 'suggestion-link:hover { color: #fb923c; }',
    '.' + PREFIX + 'dismiss {',
    '  cursor: pointer;',
    '  color: rgba(255, 255, 255, 0.3);',
    '  font-size: 16px;',
    '  line-height: 1;',
    '  padding: 2px 4px;',
    '  border-radius: 4px;',
    '  transition: color 0.15s ease, background 0.15s ease;',
    '}',
    '.' + PREFIX + 'dismiss:hover {',
    '  color: rgba(255, 255, 255, 0.7);',
    '  background: rgba(255, 255, 255, 0.05);',
    '}',

    /* Diff modal overlay */
    '.' + PREFIX + 'overlay {',
    '  position: fixed;',
    '  inset: 0;',
    '  z-index: 99999;',
    '  display: flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '  background: rgba(0, 0, 0, 0.6);',
    '  backdrop-filter: blur(4px);',
    '  animation: ' + PREFIX + 'fadeIn 0.15s ease;',
    '}',
    '@keyframes ' + PREFIX + 'fadeIn {',
    '  from { opacity: 0; }',
    '  to { opacity: 1; }',
    '}',

    /* Modal card */
    '.' + PREFIX + 'modal {',
    '  background: #1e1e1e;',
    '  border: 1px solid rgba(255, 255, 255, 0.1);',
    '  border-radius: 16px;',
    '  width: 90vw;',
    '  max-width: 720px;',
    '  max-height: 85vh;',
    '  overflow-y: auto;',
    '  padding: 28px;',
    '  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.5);',
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
    '  color: rgba(255, 255, 255, 0.85);',
    '  animation: ' + PREFIX + 'scaleIn 0.2s ease;',
    '}',
    '@keyframes ' + PREFIX + 'scaleIn {',
    '  from { opacity: 0; transform: scale(0.97); }',
    '  to { opacity: 1; transform: scale(1); }',
    '}',

    /* Modal header */
    '.' + PREFIX + 'modal-header {',
    '  display: flex;',
    '  align-items: center;',
    '  justify-content: space-between;',
    '  margin-bottom: 20px;',
    '}',
    '.' + PREFIX + 'modal-title {',
    '  font-size: 16px;',
    '  font-weight: 700;',
    '  color: rgba(255, 255, 255, 0.9);',
    '}',
    '.' + PREFIX + 'modal-close {',
    '  cursor: pointer;',
    '  color: rgba(255, 255, 255, 0.3);',
    '  font-size: 20px;',
    '  line-height: 1;',
    '  padding: 4px 8px;',
    '  border-radius: 6px;',
    '  transition: color 0.15s ease, background 0.15s ease;',
    '}',
    '.' + PREFIX + 'modal-close:hover {',
    '  color: rgba(255, 255, 255, 0.7);',
    '  background: rgba(255, 255, 255, 0.05);',
    '}',

    /* Perception block in modal */
    '.' + PREFIX + 'modal-perception {',
    '  background: rgba(255, 255, 255, 0.03);',
    '  border: 1px solid rgba(255, 255, 255, 0.06);',
    '  border-radius: 10px;',
    '  padding: 14px 16px;',
    '  margin-bottom: 20px;',
    '  font-size: 13px;',
    '  font-style: italic;',
    '  color: rgba(255, 255, 255, 0.5);',
    '  line-height: 1.6;',
    '}',
    '.' + PREFIX + 'modal-perception-label {',
    '  font-size: 10px;',
    '  font-weight: 700;',
    '  letter-spacing: 0.08em;',
    '  text-transform: uppercase;',
    '  color: rgba(255, 255, 255, 0.25);',
    '  font-style: normal;',
    '  margin-bottom: 6px;',
    '}',

    /* Diff panels */
    '.' + PREFIX + 'diff-section {',
    '  margin-bottom: 20px;',
    '}',
    '.' + PREFIX + 'diff-label {',
    '  font-size: 11px;',
    '  font-weight: 700;',
    '  letter-spacing: 0.06em;',
    '  text-transform: uppercase;',
    '  color: rgba(255, 255, 255, 0.3);',
    '  margin-bottom: 8px;',
    '}',
    '.' + PREFIX + 'diff-content {',
    '  background: rgba(255, 255, 255, 0.03);',
    '  border: 1px solid rgba(255, 255, 255, 0.06);',
    '  border-radius: 8px;',
    '  padding: 12px 14px;',
    '  font-size: 13px;',
    '  line-height: 1.6;',
    '  white-space: pre-wrap;',
    '  word-break: break-word;',
    '  color: rgba(255, 255, 255, 0.7);',
    '}',
    '.' + PREFIX + 'diff-original {',
    '  border-left: 3px solid rgba(255, 255, 255, 0.1);',
    '}',
    '.' + PREFIX + 'diff-rewritten {',
    '  border-left: 3px solid #22c55e;',
    '}',
    '.' + PREFIX + 'diff-added {',
    '  background: rgba(34, 197, 94, 0.12);',
    '  color: #86efac;',
    '  border-radius: 3px;',
    '  padding: 0 2px;',
    '}',

    /* Changes list */
    '.' + PREFIX + 'changes {',
    '  list-style: none;',
    '  padding: 0;',
    '  margin: 0 0 20px 0;',
    '}',
    '.' + PREFIX + 'changes li {',
    '  font-size: 12px;',
    '  color: rgba(255, 255, 255, 0.55);',
    '  padding: 4px 0 4px 16px;',
    '  position: relative;',
    '  line-height: 1.5;',
    '}',
    '.' + PREFIX + 'changes li::before {',
    '  content: "\\2192";',
    '  position: absolute;',
    '  left: 0;',
    '  color: #f97316;',
    '}',

    /* Score comparison */
    '.' + PREFIX + 'score-compare {',
    '  display: flex;',
    '  align-items: center;',
    '  gap: 12px;',
    '  margin-bottom: 24px;',
    '  font-size: 13px;',
    '}',
    '.' + PREFIX + 'score-before {',
    '  color: rgba(255, 255, 255, 0.4);',
    '}',
    '.' + PREFIX + 'score-arrow {',
    '  color: rgba(255, 255, 255, 0.2);',
    '}',
    '.' + PREFIX + 'score-after {',
    '  font-weight: 700;',
    '}',

    /* Action buttons */
    '.' + PREFIX + 'actions {',
    '  display: flex;',
    '  gap: 10px;',
    '  justify-content: flex-end;',
    '}',
    '.' + PREFIX + 'btn {',
    '  padding: 8px 18px;',
    '  border-radius: 8px;',
    '  font-size: 13px;',
    '  font-weight: 600;',
    '  cursor: pointer;',
    '  border: none;',
    '  transition: background 0.15s ease, transform 0.1s ease;',
    '  font-family: inherit;',
    '}',
    '.' + PREFIX + 'btn:active { transform: scale(0.97); }',
    '.' + PREFIX + 'btn-primary {',
    '  background: #f97316;',
    '  color: #fff;',
    '}',
    '.' + PREFIX + 'btn-primary:hover { background: #ea580c; }',
    '.' + PREFIX + 'btn-secondary {',
    '  background: rgba(255, 255, 255, 0.08);',
    '  color: rgba(255, 255, 255, 0.7);',
    '}',
    '.' + PREFIX + 'btn-secondary:hover { background: rgba(255, 255, 255, 0.12); }',
    '.' + PREFIX + 'btn-ghost {',
    '  background: transparent;',
    '  color: rgba(255, 255, 255, 0.4);',
    '}',
    '.' + PREFIX + 'btn-ghost:hover { color: rgba(255, 255, 255, 0.6); }'
  ].join('\n');

  // ─── DOM Helpers ──────────────────────────────────────────

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = PREFIX + className;
    if (text) node.textContent = text;
    return node;
  }

  function estimateTokens(text) {
    return Math.ceil((text || '').length / 4);
  }

  function filledBars(cueScore) {
    if (cueScore > BAR_THRESHOLDS[3]) return 4;
    if (cueScore > BAR_THRESHOLDS[2]) return 3;
    if (cueScore > BAR_THRESHOLDS[1]) return 2;
    if (cueScore > BAR_THRESHOLDS[0]) return 1;
    return 0;
  }

  function barColor(filled) {
    return BAR_COLORS[filled] || BAR_COLORS[0];
  }

  function verdictColor(verdict) {
    return VERDICT_COLORS[verdict] || 'rgba(255,255,255,0.5)';
  }

  // ─── Diff Highlighting ────────────────────────────────────

  function highlightAdditions(original, rewritten) {
    // If rewritten starts with the original text, highlight the tail
    if (rewritten.indexOf(original) === 0 && rewritten.length > original.length) {
      var kept = document.createTextNode(original);
      var added = el('span', 'diff-added', rewritten.slice(original.length));
      var frag = document.createDocumentFragment();
      frag.appendChild(kept);
      frag.appendChild(added);
      return frag;
    }

    // Otherwise, do line-by-line diff
    var origLines = original.split('\n');
    var newLines = rewritten.split('\n');
    var origSet = {};
    for (var i = 0; i < origLines.length; i++) {
      origSet[origLines[i].trim()] = true;
    }

    var frag2 = document.createDocumentFragment();
    for (var j = 0; j < newLines.length; j++) {
      if (j > 0) frag2.appendChild(document.createTextNode('\n'));
      var line = newLines[j];
      if (!origSet[line.trim()] && line.trim().length > 0) {
        var added2 = el('span', 'diff-added', line);
        frag2.appendChild(added2);
      } else {
        frag2.appendChild(document.createTextNode(line));
      }
    }
    return frag2;
  }

  // ─── Inject CSS ───────────────────────────────────────────

  function injectStyles() {
    if (styleEl) return;
    styleEl = document.createElement('style');
    styleEl.id = PREFIX + 'styles';
    styleEl.textContent = CSS;
    document.head.appendChild(styleEl);
  }

  function removeStyles() {
    if (styleEl) {
      styleEl.remove();
      styleEl = null;
    }
  }

  // ─── Signal Bars ──────────────────────────────────────────

  function createSignalBars() {
    var container = el('div', 'signal');

    // Bars
    var barsWrap = el('div', 'bars');
    for (var i = 0; i < 4; i++) {
      barsWrap.appendChild(el('div', 'bar'));
    }
    container.appendChild(barsWrap);

    // Score number
    container.appendChild(el('span', 'score-num'));

    // Verdict
    container.appendChild(el('span', 'verdict'));

    // Perception (right-aligned)
    container.appendChild(el('span', 'perception'));

    return container;
  }

  // ─── Public: init ─────────────────────────────────────────

  function init(targetElement) {
    editorEl = targetElement;
    injectStyles();

    // Clean up any existing signal container
    if (signalContainer) signalContainer.remove();

    signalContainer = createSignalBars();

    // Insert after the editor's parent to sit below the textarea
    var parent = editorEl.parentElement;
    if (parent && parent.parentElement) {
      parent.parentElement.insertBefore(signalContainer, parent.nextSibling);
    } else if (parent) {
      parent.appendChild(signalContainer);
    }

    console.log('[Cue] UI initialized');
  }

  // ─── Public: destroy ──────────────────────────────────────

  function destroy() {
    if (signalContainer) { signalContainer.remove(); signalContainer = null; }
    if (suggestionBar) { suggestionBar.remove(); suggestionBar = null; }
    if (diffModal) { diffModal.remove(); diffModal = null; }
    removeStyles();
    editorEl = null;
    currentPerception = null;
    console.log('[Cue] UI destroyed');
  }

  // ─── Public: updateSignalBars ─────────────────────────────

  function updateSignalBars(cueScore, verdict) {
    if (!signalContainer) return;

    var filled = filledBars(cueScore);
    var color = barColor(filled);
    var bars = signalContainer.querySelectorAll('.' + PREFIX + 'bar');

    for (var i = 0; i < bars.length; i++) {
      bars[i].style.backgroundColor = i < filled ? color : BAR_COLORS.empty;
    }

    var scoreNum = signalContainer.querySelector('.' + PREFIX + 'score-num');
    if (scoreNum) {
      scoreNum.textContent = cueScore + '/100';
      scoreNum.style.color = color;
    }

    var verdictEl = signalContainer.querySelector('.' + PREFIX + 'verdict');
    if (verdictEl) {
      verdictEl.textContent = verdict;
      verdictEl.style.color = verdictColor(verdict);
    }
  }

  // ─── Public: updatePerception ─────────────────────────────

  function updatePerception(perception) {
    currentPerception = perception;

    if (!signalContainer) return;

    var percEl = signalContainer.querySelector('.' + PREFIX + 'perception');
    if (percEl) {
      percEl.textContent = perception.assumptions > 0
        ? perception.assumptions + ' assumption' + (perception.assumptions !== 1 ? 's' : '') + ' \u00B7 ' + perception.text
        : perception.text;
      percEl.title = perception.text;
    }
  }

  // ─── Public: showSuggestionBar ────────────────────────────

  function showSuggestionBar(original, rewriteResult) {
    hideSuggestionBar();

    if (!editorEl) return;

    var perception = currentPerception;
    var bar = el('div', 'suggestion');

    // Perception monologue (italic)
    var textSpan = el('span', 'suggestion-text');
    textSpan.textContent = perception ? perception.text : '';
    bar.appendChild(textSpan);

    // Token count
    var tokens = estimateTokens(original);
    var metaSpan = el('span', 'suggestion-meta', '~' + tokens + ' tokens');
    bar.appendChild(metaSpan);

    // View suggestion link
    var link = el('span', 'suggestion-link', 'View suggestion');
    link.addEventListener('click', function () {
      showDiffModal(
        original,
        rewriteResult,
        perception,
        Cue.Content.onRewriteAccepted,
        Cue.Content.onRewriteEdited,
        Cue.Content.onRewriteDismissed
      );
    });
    bar.appendChild(link);

    // Dismiss X
    var dismiss = el('span', 'dismiss', '\u00D7');
    dismiss.addEventListener('click', function () {
      Cue.Content.onRewriteDismissed();
    });
    bar.appendChild(dismiss);

    // Insert above editor
    var parent = editorEl.parentElement;
    if (parent) {
      parent.insertBefore(bar, editorEl);
    }

    suggestionBar = bar;
  }

  // ─── Public: hideSuggestionBar ────────────────────────────

  function hideSuggestionBar() {
    if (suggestionBar) {
      suggestionBar.remove();
      suggestionBar = null;
    }
  }

  // ─── Public: showDiffModal ────────────────────────────────

  async function showDiffModal(original, rewriteResult, perception, onAccept, onEdit, onDismiss) {
    // Remove existing modal
    if (diffModal) diffModal.remove();

    var rewritten = rewriteResult.rewritten;
    var changes = rewriteResult.changes;
    var oldScoreResult = await Cue.Scorer.score(original);
    var oldScore = oldScoreResult.cueScore;
    var newScore = rewriteResult.improvedScore;

    // Overlay
    var overlay = el('div', 'overlay');

    // Modal card
    var modal = el('div', 'modal');

    // Header
    var header = el('div', 'modal-header');
    header.appendChild(el('span', 'modal-title', 'Cue Rewrite'));
    var closeBtn = el('span', 'modal-close', '\u00D7');
    header.appendChild(closeBtn);
    modal.appendChild(header);

    // Claude perception
    if (perception) {
      var percBlock = el('div', 'modal-perception');
      percBlock.appendChild(el('div', 'modal-perception-label', 'How Claude reads this'));
      var percText = document.createTextNode(perception.text);
      percBlock.appendChild(percText);
      modal.appendChild(percBlock);
    }

    // Original prompt
    var origSection = el('div', 'diff-section');
    origSection.appendChild(el('div', 'diff-label', 'Original'));
    var origContent = el('div', 'diff-content ' + PREFIX + 'diff-original');
    origContent.className = PREFIX + 'diff-content ' + PREFIX + 'diff-original';
    origContent.textContent = original;
    origSection.appendChild(origContent);
    modal.appendChild(origSection);

    // Rewritten prompt with highlights
    var newSection = el('div', 'diff-section');
    newSection.appendChild(el('div', 'diff-label', 'Suggested'));
    var newContent = el('div', 'diff-content');
    newContent.className = PREFIX + 'diff-content ' + PREFIX + 'diff-rewritten';
    newContent.appendChild(highlightAdditions(original, rewritten));
    newSection.appendChild(newContent);
    modal.appendChild(newSection);

    // Changes list
    if (changes && changes.length > 0) {
      var changeLabel = el('div', 'diff-label', 'Changes');
      changeLabel.style.marginBottom = '8px';
      modal.appendChild(changeLabel);

      var changeList = el('ul', 'changes');
      for (var i = 0; i < changes.length; i++) {
        changeList.appendChild(el('li', null, changes[i]));
      }
      // Fix class — el() prefixes, but li items shouldn't have prefix
      var items = changeList.querySelectorAll('li');
      for (var j = 0; j < items.length; j++) {
        items[j].className = '';
      }
      modal.appendChild(changeList);
    }

    // Score comparison
    var scoreComp = el('div', 'score-compare');
    var beforeSpan = el('span', 'score-before', oldScore + '/100');
    var arrowSpan = el('span', 'score-arrow', '\u2192');
    var afterSpan = el('span', 'score-after', newScore + '/100');
    afterSpan.style.color = barColor(filledBars(newScore));
    scoreComp.appendChild(beforeSpan);
    scoreComp.appendChild(arrowSpan);
    scoreComp.appendChild(afterSpan);
    modal.appendChild(scoreComp);

    // Action buttons
    var actions = el('div', 'actions');

    var dismissBtn = el('button', 'btn ' + PREFIX + 'btn-ghost', 'Dismiss');
    dismissBtn.className = PREFIX + 'btn ' + PREFIX + 'btn-ghost';
    actions.appendChild(dismissBtn);

    var editBtn = el('button', 'btn ' + PREFIX + 'btn-secondary', 'Edit first');
    editBtn.className = PREFIX + 'btn ' + PREFIX + 'btn-secondary';
    actions.appendChild(editBtn);

    var applyBtn = el('button', 'btn ' + PREFIX + 'btn-primary', 'Apply');
    applyBtn.className = PREFIX + 'btn ' + PREFIX + 'btn-primary';
    actions.appendChild(applyBtn);

    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    diffModal = overlay;

    // ── Event handlers ──

    function closeModal() {
      if (diffModal) {
        diffModal.remove();
        diffModal = null;
      }
    }

    closeBtn.addEventListener('click', function () {
      closeModal();
      if (onDismiss) onDismiss();
    });

    dismissBtn.addEventListener('click', function () {
      closeModal();
      if (onDismiss) onDismiss();
    });

    applyBtn.addEventListener('click', function () {
      closeModal();
      if (onAccept) onAccept(rewritten);
    });

    editBtn.addEventListener('click', function () {
      closeModal();
      if (onEdit) onEdit(rewritten);
    });

    // Click outside modal to dismiss
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        closeModal();
        if (onDismiss) onDismiss();
      }
    });

    // Escape key to dismiss
    function onEsc(e) {
      if (e.key === 'Escape') {
        closeModal();
        if (onDismiss) onDismiss();
        document.removeEventListener('keydown', onEsc);
      }
    }
    document.addEventListener('keydown', onEsc);
  }

  // ─── Public API ───────────────────────────────────────────

  window.Cue.UI = {
    init: init,
    destroy: destroy,
    updateSignalBars: updateSignalBars,
    updatePerception: updatePerception,
    showSuggestionBar: showSuggestionBar,
    hideSuggestionBar: hideSuggestionBar,
    showDiffModal: showDiffModal
  };

})();
