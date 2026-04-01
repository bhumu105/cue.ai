/**
 * Cue Perception Engine — Generates Claude's internal monologue from scores
 * Takes scorer output and produces natural perception text, assumption count, and verdict
 */
(function () {
  'use strict';

  window.Cue = window.Cue || {};

  // ─── Clause Maps ──────────────────────────────────────────

  var CLARITY_CLAUSES = [
    "I'm not sure what the user actually wants me to do.",
    "I'm not sure what the user actually wants me to do.",
    "I have a rough idea of the task but key details are missing.",
    "I have a rough idea of the task but key details are missing.",
    "The task is clear.",
    "The task is clear."
  ];

  var CONTEXT_CLAUSES = [
    "I have no background information. I'll have to assume everything.",
    "I have no background information. I'll have to assume everything.",
    "I have some context but important details are missing.",
    "I have some context but important details are missing.",
    "I have everything I need to give a precise answer.",
    "I have everything I need to give a precise answer."
  ];

  var SPECIFICITY_CLAUSES = [
    "There are no constraints here. I'll interpret this however I want.",
    "There are no constraints here. I'll interpret this however I want.",
    "Some constraints exist but I still have a lot of latitude.",
    "Some constraints exist but I still have a lot of latitude.",
    "The constraints are well defined. No guessing required.",
    "The constraints are well defined. No guessing required."
  ];

  var FOCUS_CLAUSES = [
    "The user is asking multiple unrelated things. My answer will be scattered.",
    "The user is asking multiple unrelated things. My answer will be scattered.",
    "There are a few sub-requests here. I'll try to cover everything.",
    "There are a few sub-requests here. I'll try to cover everything.",
    "Single focused request. I can give this my full attention.",
    "Single focused request. I can give this my full attention."
  ];

  // ─── Verdict Ranges ───────────────────────────────────────

  function getVerdict(cueScore) {
    if (cueScore <= 20) return 'Waste of tokens';
    if (cueScore <= 40) return 'Claude will guess';
    if (cueScore <= 60) return 'Decent';
    if (cueScore <= 80) return 'Strong';
    return 'Airtight';
  }

  // ─── Main Generator ───────────────────────────────────────

  function generate(scores) {
    var clarity = scores.clarity || 0;
    var context = scores.context || 0;
    var specificity = scores.specificity || 0;
    var focus = scores.focus || 0;
    var cueScore = scores.cueScore || 0;

    // Build perception paragraph from dimension clauses
    var text = CLARITY_CLAUSES[clarity]
      + ' ' + CONTEXT_CLAUSES[context]
      + ' ' + SPECIFICITY_CLAUSES[specificity]
      + ' ' + FOCUS_CLAUSES[focus];

    // Count dimensions scoring 0-2 — each is a major assumption Claude must make
    var assumptions = 0;
    if (clarity <= 2) assumptions++;
    if (context <= 2) assumptions++;
    if (specificity <= 2) assumptions++;
    if (focus <= 2) assumptions++;

    return {
      text: text,
      assumptions: assumptions,
      verdict: getVerdict(cueScore)
    };
  }

  // ─── Public API ───────────────────────────────────────────

  window.Cue.Perception = {
    generate: generate
  };

})();
