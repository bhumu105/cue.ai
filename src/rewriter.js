/**
 * Cue Rewriter — Suggests targeted prompt improvements
 * Preserves original wording, only adds/restructures what's needed to fix low-scoring dimensions
 */
(function () {
  'use strict';

  window.Cue = window.Cue || {};

  // ─── Clarity Repair (< 3) ────────────────────────────────
  // Add or sharpen the task verb, make the request explicit

  var TASK_VERB_PATTERN = /\b(fix|write|create|build|explain|debug|refactor|implement|design|optimize|convert|translate|summarize|analyze|review|compare|generate|update|add|remove|delete|modify|change|improve|rewrite|test|deploy|configure|install|migrate|parse|extract|calculate|compute|sort|filter|validate|check|list|find|search|replace|merge|split|format|define|describe|outline|draft|edit|proofread|make|show me|tell me|give me|help me|how to|how do i|how can i)\b/i;

  var CODE_SIGNAL = /\b(code|function|bug|error|script|program|app|api|server|database|class|component|module)\b/i;
  var WRITING_SIGNAL = /\b(essay|article|blog|email|letter|report|proposal|story|poem|post|message|summary|description|copy|content)\b/i;

  function repairClarity(text, changes) {
    // Already has a task verb — nothing to do
    if (TASK_VERB_PATTERN.test(text)) return text;

    // If the prompt is a single vague word, replace rather than prefix
    var trimmed = text.trim().toLowerCase();
    if (trimmed.length <= 6 && /^(help|hi|hey|hello|please|\?+)$/i.test(trimmed)) {
      changes.push('Replaced vague prompt — Claude needs to know what you actually want.');
      return 'Help me [describe what you need help with]';
    }

    var prefix;
    if (CODE_SIGNAL.test(text)) {
      prefix = 'Fix ';
      changes.push('Added task verb "Fix" — Claude needs to know what action to take on your code.');
    } else if (WRITING_SIGNAL.test(text)) {
      prefix = 'Write ';
      changes.push('Added task verb "Write" — Claude needs a clear action to perform.');
    } else {
      prefix = 'Help me with: ';
      changes.push('Added "Help me with:" prefix — the original prompt had no clear action for Claude.');
    }

    // Lowercase the first char if we're prepending a verb to a fragment
    var first = text.charAt(0);
    if (first === first.toUpperCase() && first !== first.toLowerCase()) {
      text = first.toLowerCase() + text.slice(1);
    }

    return prefix + text;
  }

  // ─── Context Repair (< 3) ────────────────────────────────
  // Add placeholders for missing context

  function repairContext(text, scores, changes) {
    var lower = text.toLowerCase();
    var additions = [];
    var isCodeTask = CODE_SIGNAL.test(lower);
    var isWritingTask = WRITING_SIGNAL.test(lower);

    if (isCodeTask) {
      // Code task — suggest code, error, expected behavior, prior attempts
      var hasCode = /```[\s\S]*?```/.test(text) ||
        /`[^`]+`/.test(text) ||
        /^(import|from|const|let|var|function|class|def )/m.test(text);
      if (!hasCode) {
        additions.push('[paste your code here]');
        changes.push('Added code placeholder — Claude can\'t debug what it can\'t see.');
      }

      var hasError = /error|exception|traceback|stack trace|fails?|crash|broken|returns?\s/i.test(text);
      if (!hasError && scores.context <= 1) {
        additions.push('[describe the error or unexpected behavior]');
        changes.push('Added error placeholder — Claude needs to know what\'s going wrong.');
      }

      var hasExpected = /expected|should|supposed to|want it to|result should/i.test(text);
      if (!hasExpected && scores.context <= 2) {
        additions.push('[what should happen instead?]');
        changes.push('Added expected behavior placeholder — Claude needs to know what "working" looks like.');
      }

      var hasTried = /tried|attempted|already|so far/i.test(text);
      if (!hasTried && scores.context <= 1) {
        additions.push('[what have you tried so far?]');
        changes.push('Added "what you\'ve tried" placeholder — helps Claude avoid suggesting things you\'ve ruled out.');
      }
    } else if (isWritingTask) {
      // Writing task — suggest topic details, audience, reference material
      var hasTopicDetail = lower.split(/\s+/).length >= 8;
      if (!hasTopicDetail) {
        additions.push('[add more detail about the topic or key points to cover]');
        changes.push('Added topic detail placeholder — more context gives Claude better material to work with.');
      }

      var hasReference = /example|like|similar to|based on|inspired by|in the style of/i.test(text);
      if (!hasReference && scores.context <= 1) {
        additions.push('[any examples or references for the style you want?]');
        changes.push('Added reference placeholder — examples help Claude match your expectations.');
      }
    } else {
      // Generic task — suggest general background
      if (scores.context <= 1) {
        additions.push('[provide more background — what are you working on and why?]');
        changes.push('Added background placeholder — context helps Claude give a relevant answer.');
      }

      var hasExpectedGeneric = /expected|should|want|goal|objective/i.test(text);
      if (!hasExpectedGeneric && scores.context <= 2) {
        additions.push('[what outcome are you looking for?]');
        changes.push('Added outcome placeholder — Claude needs to know what success looks like.');
      }
    }

    if (additions.length > 0) {
      text = text.replace(/\s*$/, '') + '\n\n' + additions.join('\n');
    }

    return text;
  }

  // ─── Specificity Repair (< 3) ─────────────────────────────
  // Add constraint placeholders

  function repairSpecificity(text, changes) {
    var lower = text.toLowerCase();
    var isCodeTask = CODE_SIGNAL.test(lower);
    var isWritingTask = WRITING_SIGNAL.test(lower);
    var additions = [];

    if (isCodeTask) {
      // Code-specific specificity gaps
      var hasBounds = /\b(don't|do not|avoid|without|must|should|always|only|never)\b/i.test(text);
      if (!hasBounds) {
        additions.push('[any constraints? e.g., "no external libraries", "must be backwards compatible"]');
        changes.push('Added constraints placeholder — boundaries help Claude pick the right approach.');
      }
    } else if (isWritingTask) {
      // Writing-specific specificity gaps
      var hasFormat = /\d+\s*(words?|lines?|sentences?|paragraphs?|pages?|characters?)/i.test(text) ||
        /\b(short|brief|concise|detailed|comprehensive|list|table|summary|outline)\b/i.test(lower);
      if (!hasFormat) {
        additions.push('[specify desired format or length]');
        changes.push('Added format placeholder — without constraints, Claude picks its own format.');
      }

      var hasTone = /\b(for|aimed at|targeting|audience)\s+\w+/i.test(text) ||
        /\b(formal|informal|casual|professional|conversational|friendly|technical|simple|academic)\b/i.test(lower);
      if (!hasTone) {
        additions.push('[specify target audience or tone]');
        changes.push('Added audience/tone placeholder — Claude will assume a generic tone without guidance.');
      }

      var hasBoundsWriting = /\b(don't|do not|avoid|without|must|should|always|only|never|include|exclude)\b/i.test(text);
      if (!hasBoundsWriting) {
        additions.push('[any constraints? e.g., "avoid jargon", "must include examples"]');
        changes.push('Added constraints placeholder — boundaries prevent Claude from going off track.');
      }
    } else {
      // Generic specificity gaps
      var hasAnyConstraint = /\b(don't|do not|avoid|without|must|should|always|only|never|include|exclude)\b/i.test(text) ||
        /\d+\s*(words?|lines?|items?|steps?)/i.test(text);
      if (!hasAnyConstraint) {
        additions.push('[any constraints or requirements?]');
        changes.push('Added constraints placeholder — boundaries help Claude give you exactly what you want.');
      }
    }

    if (additions.length > 0) {
      text = text.replace(/\s*$/, '') + '\n\n' + additions.join('\n');
    }

    return text;
  }

  // ─── Focus Repair (< 3) ──────────────────────────────────
  // Split multiple requests into numbered list

  function repairFocus(text, changes) {
    var lower = text.toLowerCase();

    // Split into clauses the same way scorer does
    var segments = lower.split(/[.!?;\n]+|\s*,\s+|\s+and\s+|\s+then\s+|\s+also\s+|\s+plus\s+|\s+but\s+/);

    // Also split the original text at the same boundaries to preserve casing
    var originalSegments = text.split(/[.!?;\n]+|\s*,\s+|\s+and\s+|\s+then\s+|\s+also\s+|\s+plus\s+|\s+but\s+/);

    var requests = [];
    for (var i = 0; i < segments.length; i++) {
      var seg = (originalSegments[i] || '').trim();
      if (seg.length === 0) continue;
      requests.push(seg);
    }

    if (requests.length <= 1) return text;

    // Capitalize first letter of each request
    var numbered = requests.map(function (req, idx) {
      var first = req.charAt(0).toUpperCase();
      return (idx + 1) + '. ' + first + req.slice(1);
    });

    changes.push(
      'Split into ' + requests.length + ' separate requests — Claude gives better answers when handling one thing at a time. Consider sending these as separate prompts.'
    );

    return numbered.join('\n');
  }

  // ─── Main Suggest Function ────────────────────────────────

  async function suggest(originalText, scores) {
    if (typeof originalText !== 'string' || originalText.trim().length === 0) {
      return {
        rewritten: originalText || '',
        changes: [],
        improvedScore: 0
      };
    }

    var text = originalText;
    var changes = [];

    // Apply repairs only to dimensions scoring below 3, in order of impact
    if (scores.focus < 3) {
      text = repairFocus(text, changes);
    }

    if (scores.clarity < 3) {
      text = repairClarity(text, changes);
    }

    if (scores.context < 3) {
      text = repairContext(text, scores, changes);
    }

    if (scores.specificity < 3) {
      text = repairSpecificity(text, changes);
    }

    // If nothing needed fixing, return as-is
    if (changes.length === 0) {
      return {
        rewritten: originalText,
        changes: [],
        improvedScore: scores.cueScore
      };
    }

    // Score the rewritten prompt
    var newScores = await window.Cue.Scorer.score(text);

    return {
      rewritten: text,
      changes: changes,
      improvedScore: newScores.cueScore
    };
  }

  // ─── Public API ───────────────────────────────────────────

  window.Cue.Rewriter = {
    suggest: suggest
  };

})();
