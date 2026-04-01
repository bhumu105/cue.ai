/**
 * Cue Content Script — Runs on claude.ai, connects scorer/perception/rewriter/tracker/UI
 * Watches for ProseMirror editor, scores prompts live, intercepts send
 */
(function () {
  'use strict';

  window.Cue = window.Cue || {};

  // ─── Config ───────────────────────────────────────────────

  var EDITOR_SELECTORS = [
    '.ProseMirror',
    '[contenteditable="true"]',
    '[data-testid="composer-input"]'
  ];

  var SEND_BUTTON_SELECTORS = [
    'button[aria-label="Send"]',
    'button[data-testid="send-button"]',
    'button[type="submit"]'
  ];

  var DEBOUNCE_MS = 150;
  var SUGGESTION_MIN_LENGTH = 20;
  var SUGGESTION_THRESHOLD = 60;

  // ─── State ────────────────────────────────────────────────

  var activeEditor = null;
  var lastScores = null;
  var lastRewrite = null;
  var rewriteAccepted = false;
  var rewriteEdited = false;
  var debounceTimer = null;

  // ─── Logging ──────────────────────────────────────────────

  function log() {
    var args = ['[Cue]'].concat(Array.prototype.slice.call(arguments));
    console.log.apply(console, args);
  }

  // ─── Editor Detection ─────────────────────────────────────

  function findEditor() {
    for (var i = 0; i < EDITOR_SELECTORS.length; i++) {
      var el = document.querySelector(EDITOR_SELECTORS[i]);
      if (el) {
        log('Editor found with selector:', EDITOR_SELECTORS[i]);
        return el;
      }
    }
    return null;
  }

  function findSendButton() {
    for (var i = 0; i < SEND_BUTTON_SELECTORS.length; i++) {
      var el = document.querySelector(SEND_BUTTON_SELECTORS[i]);
      if (el) return el;
    }
    return null;
  }

  // ─── Text Extraction ──────────────────────────────────────

  function getEditorText(editor) {
    return (editor.innerText || editor.textContent || '').trim();
  }

  // ─── Scoring Pipeline ─────────────────────────────────────

  function onInput() {
    if (!activeEditor) return;

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      runPipeline();
    }, DEBOUNCE_MS);
  }

  async function runPipeline() {
    if (!activeEditor) return;

    var text = getEditorText(activeEditor);

    // Score
    var scores = await Cue.Scorer.score(text);
    var perception = Cue.Perception.generate(scores);
    lastScores = scores;

    log(
      'Score:', scores.cueScore + '/100',
      '| C:' + scores.clarity,
      'X:' + scores.context,
      'S:' + scores.specificity,
      'F:' + scores.focus,
      '|', perception.verdict
    );

    // Update live signal bars
    Cue.UI.updateSignalBars(scores.cueScore, perception.verdict);
    Cue.UI.updatePerception(perception);

    // Suggestion logic
    if (scores.cueScore < SUGGESTION_THRESHOLD && text.length > SUGGESTION_MIN_LENGTH) {
      var rewrite = await Cue.Rewriter.suggest(text, scores);
      lastRewrite = rewrite;

      if (rewrite.changes.length > 0) {
        log('Suggestion available:', rewrite.improvedScore + '/100', '(' + rewrite.changes.length + ' changes)');
        Cue.UI.showSuggestionBar(text, rewrite);
      }
    } else {
      lastRewrite = null;
      Cue.UI.hideSuggestionBar();
    }
  }

  // ─── Rewrite Callbacks ────────────────────────────────────
  // Called by UI when user interacts with suggestions

  function onRewriteAccepted(rewrittenText) {
    rewriteAccepted = true;
    rewriteEdited = false;
    log('Rewrite accepted');

    if (activeEditor) {
      activeEditor.innerText = rewrittenText;
      activeEditor.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function onRewriteEdited(editedText) {
    rewriteAccepted = true;
    rewriteEdited = true;
    log('Rewrite edited by user');

    if (activeEditor) {
      activeEditor.innerText = editedText;
      activeEditor.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function onRewriteDismissed() {
    rewriteAccepted = false;
    rewriteEdited = false;
    lastRewrite = null;
    log('Rewrite dismissed');
    Cue.UI.hideSuggestionBar();
  }

  // ─── Send Interception ────────────────────────────────────

  function onSend() {
    if (!lastScores) return;

    var text = activeEditor ? getEditorText(activeEditor) : '';
    log('Prompt sent — logging. Score:', lastScores.cueScore + '/100');

    Cue.Tracker.log(text, lastScores, rewriteAccepted, rewriteEdited);

    // Reset state for next prompt
    lastScores = null;
    lastRewrite = null;
    rewriteAccepted = false;
    rewriteEdited = false;
    Cue.UI.hideSuggestionBar();
    Cue.UI.updateSignalBars(0, '');
  }

  function onKeydown(e) {
    // Enter without Shift sends the prompt on claude.ai
    if (e.key === 'Enter' && !e.shiftKey) {
      onSend();
    }
  }

  function attachSendButton() {
    var btn = findSendButton();
    if (btn && !btn._cueAttached) {
      btn.addEventListener('click', onSend);
      btn._cueAttached = true;
      log('Send button listener attached');
    }
  }

  // ─── Editor Attachment ────────────────────────────────────

  function attachToEditor(editor) {
    if (activeEditor === editor) return;

    // Detach from previous editor if any
    detachFromEditor();

    activeEditor = editor;
    editor.addEventListener('input', onInput);
    editor.addEventListener('keydown', onKeydown);
    log('Input and keydown listeners attached');

    // Initialize UI
    Cue.UI.init(editor);

    // Also watch for send button
    attachSendButton();

    // Run initial scoring if editor already has content
    var text = getEditorText(editor);
    if (text.length > 0) {
      log('Editor has existing content, running initial score');
      runPipeline();
    }
  }

  function detachFromEditor() {
    if (!activeEditor) return;

    activeEditor.removeEventListener('input', onInput);
    activeEditor.removeEventListener('keydown', onKeydown);
    log('Detached from previous editor');
    activeEditor = null;
  }

  // ─── MutationObserver ─────────────────────────────────────
  // claude.ai is a SPA — editor remounts on navigation

  function startObserver() {
    log('Starting MutationObserver, waiting for editor...');

    var observer = new MutationObserver(function () {
      var editor = findEditor();

      if (editor && editor !== activeEditor) {
        attachToEditor(editor);
      } else if (!editor && activeEditor) {
        // Editor was removed (SPA navigation)
        log('Editor removed — SPA navigation detected, waiting for remount...');
        detachFromEditor();
        Cue.UI.destroy();
      }

      // Send button may also remount
      if (activeEditor) {
        attachSendButton();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Check immediately in case editor is already present
    var editor = findEditor();
    if (editor) {
      attachToEditor(editor);
    }

    return observer;
  }

  // ─── Init ─────────────────────────────────────────────────

  function init() {
    log('Initializing on', window.location.href);
    startObserver();
    log('Ready — watching for editor');
  }

  // ─── Public API ───────────────────────────────────────────

  window.Cue.Content = {
    init: init,
    onRewriteAccepted: onRewriteAccepted,
    onRewriteEdited: onRewriteEdited,
    onRewriteDismissed: onRewriteDismissed
  };

  // ─── Auto-start ───────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
