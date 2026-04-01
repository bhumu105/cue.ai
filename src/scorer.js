/**
 * Cue Scorer — ONNX model inference with rule-based fallback
 * Scores prompts across 4 dimensions: Clarity, Context, Specificity, Focus
 * Each dimension scored 0-5, total converted to 0-100 Cue Score
 *
 * Loads an ONNX model from model/cue_model.onnx for inference.
 * Falls back to rule-based scoring if the model fails to load.
 */
(function () {
  'use strict';

  window.Cue = window.Cue || {};

  // ─── ONNX Model State ──────────────────────────────────────

  var onnxSession = null;
  var vocab = null;
  var modelReady = false;

  var PAD_TOKEN_ID = 0;
  var UNK_TOKEN_ID = 100;
  var CLS_TOKEN_ID = 101;
  var SEP_TOKEN_ID = 102;
  var MAX_LENGTH = 128;

  // ─── Helpers ───────────────────────────────────────────────

  function wordCount(text) {
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  function hasCodeBlock(text) {
    return /```[\s\S]*?```/.test(text) || /`[^`]+`/.test(text);
  }

  function countQuestionMarks(text) {
    return (text.match(/\?/g) || []).length;
  }

  // ─── Whitespace Tokenizer ─────────────────────────────────

  function tokenize(text) {
    var words = text.toLowerCase().trim().split(/\s+/).filter(Boolean);
    var ids = [CLS_TOKEN_ID];

    for (var i = 0; i < words.length && ids.length < MAX_LENGTH - 1; i++) {
      ids.push(vocab[words[i]] !== undefined ? vocab[words[i]] : UNK_TOKEN_ID);
    }
    ids.push(SEP_TOKEN_ID);

    var attentionMask = [];
    for (var j = 0; j < ids.length; j++) {
      attentionMask.push(1);
    }

    while (ids.length < MAX_LENGTH) {
      ids.push(PAD_TOKEN_ID);
      attentionMask.push(0);
    }

    return { input_ids: ids, attention_mask: attentionMask };
  }

  // ─── Model Loading ────────────────────────────────────────

  async function loadModel() {
    try {
      if (typeof ort === 'undefined') {
        console.warn('[Cue] onnxruntime-web not available');
        return;
      }

      // Configure WASM paths to extension's lib/ directory
      ort.env.wasm.wasmPaths = chrome.runtime.getURL('lib/');

      var vocabUrl = chrome.runtime.getURL('model/vocab.json');
      var vocabResponse = await fetch(vocabUrl);
      vocab = await vocabResponse.json();

      var modelUrl = chrome.runtime.getURL('model/cue_model.onnx');
      onnxSession = await ort.InferenceSession.create(modelUrl, {
        executionProviders: ['wasm']
      });

      modelReady = true;
      console.log('[Cue] ONNX model loaded successfully');
    } catch (e) {
      console.warn('[Cue] Failed to load ONNX model, using rule-based fallback:', e);
      modelReady = false;
    }
  }

  // ─── ONNX Inference ───────────────────────────────────────

  function clampRound(val) {
    return Math.round(Math.min(Math.max(val * 5, 0), 5));
  }

  async function scoreWithModel(text) {
    var encoded = tokenize(text);

    var inputIds = new ort.Tensor(
      'int64',
      BigInt64Array.from(encoded.input_ids.map(function (v) { return BigInt(v); })),
      [1, MAX_LENGTH]
    );
    var attentionMask = new ort.Tensor(
      'int64',
      BigInt64Array.from(encoded.attention_mask.map(function (v) { return BigInt(v); })),
      [1, MAX_LENGTH]
    );

    var results = await onnxSession.run({
      input_ids: inputIds,
      attention_mask: attentionMask
    });

    var raw = results.scores.data;
    var clarity = clampRound(raw[0]);
    var context = clampRound(raw[1]);
    var specificity = clampRound(raw[2]);
    var focus = clampRound(raw[3]);
    var total = clarity + context + specificity + focus;
    var cueScore = Math.round((total / 20) * 100);

    return {
      clarity: clarity,
      context: context,
      specificity: specificity,
      focus: focus,
      total: total,
      cueScore: cueScore
    };
  }

  // ─── Clarity (0-5) ────────────────────────────────────────

  var TASK_VERBS = [
    'fix', 'write', 'create', 'build', 'explain', 'debug', 'refactor',
    'implement', 'design', 'optimize', 'convert', 'translate', 'summarize',
    'analyze', 'review', 'compare', 'generate', 'update', 'add', 'remove',
    'delete', 'modify', 'change', 'improve', 'rewrite', 'test', 'deploy',
    'configure', 'set up', 'install', 'migrate', 'parse', 'extract',
    'calculate', 'compute', 'sort', 'filter', 'validate', 'check',
    'list', 'find', 'search', 'replace', 'merge', 'split', 'format',
    'define', 'describe', 'outline', 'draft', 'edit', 'proofread',
    'help me', 'show me', 'tell me', 'give me', 'make', 'how to',
    'how do i', 'how can i', 'what is', 'why does', 'why is'
  ];

  var DOMAIN_KEYWORDS = [
    'javascript', 'python', 'typescript', 'java', 'rust', 'go', 'ruby',
    'php', 'swift', 'kotlin', 'html', 'css', 'sql', 'react', 'vue',
    'angular', 'node', 'express', 'django', 'flask', 'spring', 'rails',
    'api', 'database', 'server', 'frontend', 'backend', 'function',
    'class', 'component', 'module', 'package', 'library', 'framework',
    'algorithm', 'data structure', 'regex', 'authentication', 'jwt',
    'oauth', 'docker', 'kubernetes', 'aws', 'gcp', 'azure', 'linux',
    'git', 'ci/cd', 'pipeline', 'webhook', 'endpoint', 'route',
    'middleware', 'controller', 'model', 'view', 'template', 'schema',
    'migration', 'query', 'index', 'cache', 'queue', 'worker',
    'essay', 'article', 'blog', 'email', 'letter', 'report', 'proposal',
    'presentation', 'resume', 'cover letter', 'script', 'poem', 'story',
    'code', 'program', 'app', 'application', 'website', 'page'
  ];

  function scoreClarity(text) {
    var lower = text.toLowerCase();
    var words = wordCount(text);
    var score = 0;

    if (words <= 1) return 0;

    var hasTaskVerb = TASK_VERBS.some(function (verb) {
      return lower.indexOf(verb) !== -1;
    });
    if (hasTaskVerb) score += 1;

    var hasDomain = DOMAIN_KEYWORDS.some(function (kw) {
      return lower.indexOf(kw) !== -1;
    });
    if (hasDomain) score += 1;

    var hasSpecificIdentifier =
      /[a-zA-Z_]\w*\(\)/.test(text) ||
      /[a-zA-Z_]\w*\.[a-zA-Z_]\w*/.test(text) ||
      /\b\w+\.(js|ts|py|rb|go|rs|java|cpp|c|html|css|json|yaml|yml|toml|md|txt|sql|sh)\b/.test(lower) ||
      /\b(error|errno|code|status)\s*[:=]?\s*\d+/i.test(text) ||
      /\b[A-Z][a-z]+[A-Z]\w*/.test(text) ||
      /\b[A-Z]{2,}\b/.test(text);
    if (hasSpecificIdentifier) score += 1;

    var hasFailureDescription =
      /returns?\s+(wrong|incorrect|null|none|undefined|empty|false|0|error|nothing)/i.test(text) ||
      /returns?\s+\d{3}\b/.test(text) ||
      /\b[45]\d{2}\b/.test(text) ||
      /throws?\s+/i.test(text) ||
      /fails?\s+(to|when|with|on)/i.test(text) ||
      /doesn'?t\s+(work|return|compile|run|build|load|render|display|show|update)/i.test(text) ||
      /instead\s+of/i.test(text) ||
      /expected\s+.+\s+but\s+(got|received|returns)/i.test(text) ||
      /should\s+(return|be|output|display|show|produce|give)/i.test(text) ||
      /getting\s+(an?\s+)?error/i.test(text) ||
      /\b(on valid|on correct|when valid|when correct|even when|even though)\b/i.test(text) ||
      /broken|bug|issue|problem|crash/i.test(lower);
    if (hasFailureDescription) score += 1;

    var hasSupportingMaterial =
      hasCodeBlock(text) ||
      /^[\s]*[\[{]/.test(text) ||
      /\b(here'?s?\s+(the|my)|attached|below|above|following)\b/i.test(text) ||
      /^(import|from|const|let|var|function|class|def|public|private)\s/m.test(text);
    if (hasSupportingMaterial) score += 1;

    return Math.min(score, 5);
  }

  // ─── Context (0-5) ────────────────────────────────────────

  function scoreContext(text) {
    var lower = text.toLowerCase();
    var words = wordCount(text);
    var score = 0;

    if (words <= 3) return 0;

    var hasCode =
      hasCodeBlock(text) ||
      /^(import|from|const|let|var|function|class|def |public |private |protected |\s*if\s*\(|\s*for\s*\(|\s*while\s*\(|return\s)/m.test(text) ||
      /[{};]\s*$/.test(text) ||
      /=>\s*[{(]/.test(text);
    if (hasCode) score += 1;

    var hasErrorInfo =
      /error[:\s]/i.test(text) ||
      /exception/i.test(text) ||
      /traceback/i.test(lower) ||
      /stack\s*trace/i.test(text) ||
      /at\s+\w+\s+\(.+:\d+:\d+\)/.test(text) ||
      /File ".+", line \d+/.test(text) ||
      /\d{3}\s+(error|not found|unauthorized|forbidden|internal server)/i.test(text);
    if (hasErrorInfo) score += 1;

    var hasExamples =
      /input[:\s]/i.test(text) ||
      /output[:\s]/i.test(text) ||
      /example[:\s]/i.test(text) ||
      /expected[:\s]/i.test(text) ||
      /result[:\s]/i.test(text) ||
      /returns?\s+/i.test(text) ||
      /given\s+/i.test(text) ||
      /when\s+I\s+(pass|give|send|provide|enter|type|input|run|call)/i.test(text) ||
      /should\s+(return|output|give|produce|result|be)/i.test(text);
    if (hasExamples) score += 1;

    var hasBackground =
      /I('m| am)\s+(using|running|working|building|trying|developing)/i.test(text) ||
      /version\s*[\d.]/i.test(text) ||
      /running\s+(on|in)\s/i.test(text) ||
      /environment/i.test(text) ||
      /OS|operating system|windows|mac|linux|ubuntu/i.test(text) ||
      /node\s*v?\d|python\s*\d|npm\s|pip\s|yarn\s/i.test(text) ||
      /project|codebase|repo|repository/i.test(lower) ||
      words >= 30;
    if (hasBackground) score += 1;

    var hasTriedAlready =
      /I('ve| have)\s+(tried|attempted|tested|checked|looked|searched|debugged)/i.test(text) ||
      /already\s+(tried|done|checked|tested|attempted)/i.test(text) ||
      /so far/i.test(text) ||
      /what I('ve| have) done/i.test(text) ||
      /didn'?t\s+(work|help|fix|solve)/i.test(text) ||
      /still\s+(get|getting|see|seeing|have|having)/i.test(text);
    if (hasTriedAlready) score += 1;

    return Math.min(score, 5);
  }

  // ─── Specificity (0-5) ────────────────────────────────────

  function scoreSpecificity(text) {
    var lower = text.toLowerCase();
    var words = wordCount(text);
    var score = 0;

    if (words <= 2) return 0;

    if (words >= 4) score += 1;

    var hasFormat =
      /\d+\s*(words?|lines?|sentences?|paragraphs?|pages?|characters?|tokens?|items?|steps?|points?|bullets?|examples?)/i.test(text) ||
      /\b(short|brief|concise|detailed|comprehensive|long|one-liner|single|summary|list|table|json|csv|markdown|bullet|numbered|outline)\b/i.test(lower) ||
      /\b(format|structure|template|layout|organize|arranged?)\b/i.test(lower);
    if (hasFormat) score += 1;

    var hasToneOrAudience =
      /\b(for|aimed at|targeting|audience)\s+(beginners?|experts?|developers?|students?|children|kids|adults?|managers?|executives?|non-technical|technical|general|professionals?|seniors?|juniors?|team|clients?|customers?|users?|readers?)\b/i.test(text) ||
      /\b(tone|style|voice|register)\b/i.test(lower) ||
      /\b(formal|informal|casual|professional|conversational|friendly|technical|simple|plain|academic|humorous|serious|sarcastic|enthusiastic)\b/i.test(lower) ||
      /\b(ELI5|like I'?m?\s*\d|layman|plain english|non-technical)\b/i.test(text);
    if (hasToneOrAudience) score += 1;

    var hasConstraints =
      /\b(don'?t|do not|avoid|without|exclude|skip|no |never|must|should|always|only|at least|at most|maximum|minimum|between|limit|restrict)\b/i.test(text) ||
      /\b(using|use|with|in)\s+(only|just|exclusively)\b/i.test(lower) ||
      /\b(prefer|prioritize|focus on|emphasize|include|make sure|ensure)\b/i.test(lower) ||
      /\bv?\d+\.\d+/i.test(text) ||
      /\b(expected|should)\s*:\s*/i.test(text);
    if (hasConstraints) score += 1;

    var constraintCount = 0;
    if (hasFormat) constraintCount++;
    if (hasToneOrAudience) constraintCount++;
    if (hasConstraints) constraintCount++;
    if (/\b(end with|start with|begin with|conclude with|open with)\b/i.test(lower)) constraintCount++;
    if (/\b(step by step|step-by-step|numbered|in order)\b/i.test(lower)) constraintCount++;
    if (/\b(pros and cons|advantages|disadvantages|comparison|trade-?offs?)\b/i.test(lower)) constraintCount++;
    if (constraintCount >= 3) score += 1;

    return Math.min(score, 5);
  }

  // ─── Focus (0-5) ──────────────────────────────────────────

  var FOCUS_VERBS = [
    'fix', 'write', 'create', 'build', 'explain', 'debug', 'refactor',
    'implement', 'design', 'optimize', 'convert', 'translate', 'summarize',
    'analyze', 'review', 'compare', 'generate', 'update', 'add', 'remove',
    'delete', 'modify', 'change', 'improve', 'rewrite', 'test', 'deploy',
    'configure', 'install', 'migrate', 'parse', 'extract', 'calculate',
    'compute', 'sort', 'filter', 'validate', 'check', 'list', 'find',
    'search', 'replace', 'merge', 'split', 'format', 'define', 'describe',
    'outline', 'draft', 'edit', 'proofread', 'make', 'show', 'tell',
    'give', 'help'
  ];

  function countDistinctRequests(text) {
    var lower = text.toLowerCase();
    var segments = lower.split(/[.!?;\n]+|\s*,\s+|\s+and\s+|\s+then\s+|\s+also\s+|\s+plus\s+|\s+but\s+/);

    var count = 0;
    segments.forEach(function (seg) {
      seg = seg.trim();
      if (seg.length === 0) return;
      var hasVerb = FOCUS_VERBS.some(function (v) {
        var idx = seg.indexOf(v);
        if (idx === -1) return false;
        var before = idx === 0 || /[\s"'(]/.test(seg[idx - 1]);
        var after = (idx + v.length) >= seg.length || /[\s"',.;:!?)]/. test(seg[idx + v.length]);
        return before && after;
      });
      if (hasVerb) count++;
    });

    return count;
  }

  function scoreFocus(text) {
    var words = wordCount(text);

    if (words <= 1) return 5;

    var requests = countDistinctRequests(text);
    var questions = countQuestionMarks(text);
    var taskCount = Math.max(requests, questions);

    if (taskCount <= 1) return 5;
    if (taskCount === 2) return 3;
    if (taskCount === 3) return 1;
    return 0;
  }

  // ─── Rule-Based Scoring (fallback) ────────────────────────

  function scoreRuleBased(text) {
    var clarity = scoreClarity(text);
    var context = scoreContext(text);
    var specificity = scoreSpecificity(text);
    var focus = scoreFocus(text);
    var total = clarity + context + specificity + focus;
    var cueScore = Math.round((total / 20) * 100);

    return {
      clarity: clarity,
      context: context,
      specificity: specificity,
      focus: focus,
      total: total,
      cueScore: cueScore
    };
  }

  // ─── Main Scoring Function ────────────────────────────────

  async function score(promptText) {
    if (typeof promptText !== 'string') {
      promptText = '';
    }

    var text = promptText.trim();

    if (text.length === 0) {
      return {
        clarity: 0,
        context: 0,
        specificity: 0,
        focus: 0,
        total: 0,
        cueScore: 0
      };
    }

    if (modelReady) {
      try {
        return await scoreWithModel(text);
      } catch (e) {
        console.warn('[Cue] ONNX inference failed, falling back to rules:', e);
      }
    }

    return scoreRuleBased(text);
  }

  // ─── Public API ───────────────────────────────────────────

  window.Cue.Scorer = {
    score: score,
    scoreRuleBased: scoreRuleBased,
    modelReady: function () { return modelReady; }
  };

  // ─── Init: Start loading model ────────────────────────────

  loadModel();

})();
