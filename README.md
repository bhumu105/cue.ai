# Cue — AI Prompt Quality Coach for Claude

Cue is a Chrome extension that provides **real-time scoring, feedback, and rewriting suggestions** for prompts written in [Claude](https://claude.ai). It runs a fine-tuned DistilBERT model directly in the browser via ONNX Runtime WebAssembly — no server calls, instant feedback, fully private.

---

## What It Does

As you type a prompt on claude.ai, Cue continuously evaluates it across **four dimensions**:

| Dimension | What It Measures |
|---|---|
| **Clarity** | Is the task explicit? Does the prompt contain a clear action verb and identifiable goal? |
| **Context** | Does Claude have enough background? Code, errors, examples, prior attempts? |
| **Specificity** | Are constraints defined? Format, tone, audience, boundaries? |
| **Focus** | Is this one focused request, or multiple scattered tasks? |

Each dimension is scored 0–5, producing an overall **Cue Score (0–100)**.

### Features

- **Live Signal Bars** — Color-coded bars (red → green) update as you type, showing your score and a verdict ("Waste of tokens" → "Airtight")
- **Claude's Perception** — A monologue describing how Claude would interpret your prompt: _"I'm not sure what you want… I'll have to guess at the format."_
- **Smart Suggestions** — When score < 60, Cue suggests a rewrite targeting the weakest dimensions. View a diff modal with highlighted changes and score improvement
- **Apply / Edit / Dismiss** — Accept the suggestion directly, edit it first, or dismiss it entirely
- **Stats Dashboard** — Click the extension icon to see your average score, weekly trend, weakest dimension, and rewrite acceptance rate
- **Weekly Tracking** — Monitors improvement over time with trend arrows

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     manifest.json (v3)                       │
│   Service worker · Content scripts · ONNX model resources    │
└──────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
   ┌─────▼──────┐    ┌───────▼────────┐    ┌──────▼──────┐
   │ background  │    │ content.js     │    │  popup UI   │
   │ .js         │    │ (claude.ai)    │    │             │
   │             │    │                │    │ popup.html  │
   │ Storage &   │    │ Orchestrator:  │    │ popup.js    │
   │ stats API   │    │ detect editor  │    │ popup.css   │
   │ for popup   │    │ → score        │    │             │
   └─────────────┘    │ → perceive     │    │ Stats view  │
                      │ → suggest      │    └─────────────┘
                      │ → track        │
                      └───────┬────────┘
                              │
          ┌───────────┬───────┼───────────┬──────────┐
          │           │       │           │          │
    ┌─────▼──┐  ┌─────▼──┐ ┌─▼────┐ ┌────▼───┐ ┌───▼───┐
    │ scorer │  │percep- │ │rewri-│ │tracker │ │  ui   │
    │        │  │tion    │ │ter   │ │        │ │       │
    │ ONNX + │  │        │ │      │ │ Log to │ │Signal │
    │ rules  │  │Mono-   │ │Fix   │ │chrome  │ │bars,  │
    │ hybrid │  │logue   │ │weak  │ │.storage│ │modal, │
    │        │  │gen     │ │dims  │ │.local  │ │diffs  │
    └────────┘  └────────┘ └──────┘ └────────┘ └───────┘
```

### File-by-File Breakdown

#### Extension Core (`src/`)

| File | Lines | Purpose |
|---|---|---|
| `content.js` | 288 | **Main orchestrator.** Detects Claude's ProseMirror editor via MutationObserver, debounces input (150ms), runs the scoring pipeline, manages rewrite flow, intercepts send events to log prompts. |
| `scorer.js` | 437 | **Dual-path scorer.** Loads `cue_model.onnx` via ONNX Runtime WASM, tokenizes with whitespace tokenizer + vocab, pads to 128 tokens, runs inference. Falls back to rule-based heuristics if ONNX fails. Returns `{ clarity, context, specificity, focus, cueScore }`. |
| `perception.js` | 94 | **Perception engine.** Maps dimension scores to natural-language clauses (e.g., clarity 0–1 → _"I'm not sure what you want"_). Counts major assumptions (dims ≤ 2). Returns verdict string. |
| `rewriter.js` | 265 | **Targeted rewriter.** Applies repairs only to weak dimensions (< 3). Priority: focus → clarity → context → specificity. Repairs include: adding task verbs, inserting context placeholders, splitting multi-request prompts, adding constraint scaffolding. Re-scores the result. |
| `tracker.js` | 195 | **Prompt logger.** Stores each sent prompt with UUID, timestamp, scores, and rewrite acceptance flags to `chrome.storage.local`. Computes aggregate stats. |
| `ui.js` | 753 | **UI renderer.** Injects signal bars (4 bars + score + verdict), suggestion bar, and diff modal. Color scheme matches Claude's dark theme. Handles destroy/re-init for SPA navigation. |
| `background.js` | 133 | **Service worker.** Initializes storage on install. Handles `GET_STATS` and `CLEAR_STATS` messages from popup. Computes weekly trends and weakest dimension. |

#### Popup Dashboard (`popup/`)

| File | Purpose |
|---|---|
| `popup.html` | Extension popup layout — score card, stat boxes, weakness tip, clear button |
| `popup.js` | Fetches stats from background worker, renders with color coding, shows dimension-specific tips |
| `popup.css` | Dark theme (matches Claude), 340px width, color-coded trends |

#### ML Pipeline (`ml/`)

| File | Purpose |
|---|---|
| `label.py` | **Data labeling.** Downloads ShareGPT52K from HuggingFace, filters to English prompts (10–1000 chars), scores each on clarity/context/specificity/focus using heuristics. Outputs `labeled_dataset.jsonl`. |
| `train.py` | **Model training.** Fine-tunes DistilBERT for multi-output regression (4 scores). 80/10/10 split, MSE loss, 5 epochs, batch 32, lr 2e-5. Saves best checkpoint to `best_model/`. |
| `export.py` | **ONNX export.** Loads best checkpoint, exports to ONNX (opset 14), verifies with test prompts. Outputs `cue_model.onnx`. |
| `evaluate.py` | Model evaluation (placeholder). |
| `labeled_dataset.jsonl` | ~29MB labeled training data — prompts with dimension scores. |
| `best_model/` | Trained model checkpoint (`model.pt` — 253MB, gitignored), tokenizer config, tokenizer vocab. |
| `cue_model.onnx` | Exported ONNX model graph (685KB). |
| `cue_model.onnx.data` | ONNX external weights (253MB, gitignored). |

#### Runtime Model (`model/`)

| File | Purpose |
|---|---|
| `cue_model.onnx` | Production ONNX model loaded by the extension (685KB). |
| `vocab.json` | DistilBERT vocabulary (519KB, 30522 tokens) for browser-side tokenization. |

#### Libraries (`lib/`)

| File | Purpose |
|---|---|
| `ort.min.js` | ONNX Runtime Web JavaScript API (774KB). |
| `ort-wasm-simd-threaded.wasm` | ONNX Runtime WASM backend with SIMD + threading (12MB). |
| `ort-wasm-simd-threaded.mjs` | WASM loader module (24KB). |

---

## How It Works End-to-End

### 1. Editor Detection
When you navigate to claude.ai, `content.js` starts a MutationObserver watching for `.ProseMirror` or `[contenteditable]` elements — Claude's text editor. Once found, Cue attaches input listeners and initializes the UI.

### 2. Live Scoring (every 150ms, debounced)
Each keystroke triggers the scoring pipeline:
1. Extract text from the editor DOM
2. **ONNX path**: Tokenize text → pad/truncate to 128 tokens → run `cue_model.onnx` → clamp outputs to 0–5
3. **Fallback path**: If ONNX fails, use rule-based pattern matching (task verbs, code blocks, constraint keywords, etc.)
4. Compute `cueScore = (clarity + context + specificity + focus) / 20 × 100`

### 3. Perception Generation
The perception engine maps each dimension score to a natural-language clause and concatenates them into a paragraph. It counts "major assumptions" (dimensions scoring ≤ 2) and assigns a verdict based on overall score.

### 4. UI Update
Signal bars fill proportionally (0–4 bars), color-coded from red (≤20) through orange, yellow, lime, to green (>80). The score number, verdict, and perception text all update in real time.

### 5. Rewrite Suggestion
When `cueScore < 60` and the prompt is > 20 characters, the rewriter activates:
- **Focus repair**: Splits multi-task prompts into numbered lists
- **Clarity repair**: Prepends a task verb ("Fix", "Write", "Help me with")
- **Context repair**: Inserts placeholders (`[paste your code here]`, `[error description]`)
- **Specificity repair**: Adds constraint scaffolding (`[format]`, `[tone]`, `[audience]`)

The rewritten text is re-scored, and a suggestion bar appears showing the changes and score improvement.

### 6. Diff Modal
Clicking "View suggestion" opens a full-screen modal with:
- Claude's perception of the original prompt
- Side-by-side comparison with added text highlighted in green
- List of changes made
- Score improvement (e.g., "42 → 68")
- Apply / Edit first / Dismiss buttons

### 7. Send Tracking
When the user sends a prompt (Enter or send button), `tracker.js` logs:
```json
{
  "id": "uuid",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "raw_prompt": "...",
  "scores": { "clarity": 4, "context": 2, "specificity": 3, "focus": 5 },
  "total": 14,
  "cue_score": 70,
  "rewrite_accepted": false,
  "rewrite_edited": false
}
```

### 8. Stats Dashboard
The popup aggregates all logged prompts to show:
- **Average Cue Score** with color coding
- **This Week's Average** (Monday-start weeks)
- **Trend** (this week vs. last week, with arrow)
- **Weakest Dimension** with targeted tip
- **Rewrite Acceptance Rate**

---

## ML Pipeline

### Data Collection & Labeling
```bash
cd ml
python label.py
```
Downloads ShareGPT52K from HuggingFace, filters to English prompts (10–1000 chars), and scores each with heuristic rules across all four dimensions. Outputs `labeled_dataset.jsonl`.

### Training
```bash
python train.py
```
Fine-tunes `distilbert-base-uncased` for multi-output regression:
- **Architecture**: DistilBERT encoder → Linear(768, 4)
- **Loss**: MSE on normalized scores (0–1)
- **Config**: 5 epochs, batch 32, lr 2e-5, AdamW
- **Output**: Best checkpoint saved to `best_model/`

### Export to ONNX
```bash
python export.py
```
Exports the trained model to ONNX format (opset 14) for browser inference. Verifies output with test prompts.

### Deploying to Extension
The exported `cue_model.onnx` is copied to `model/` along with `vocab.json` from the tokenizer. The extension loads these at runtime via ONNX Runtime WASM.

---

## Installation

### From Source
1. Clone this repo
2. Install dependencies:
   ```bash
   npm install
   ```
3. Open Chrome → `chrome://extensions/` → Enable Developer Mode
4. Click **Load unpacked** → select the repo root directory
5. Navigate to [claude.ai](https://claude.ai) and start typing

### Large Model Files
Two files are excluded from the repo due to GitHub's 100MB file size limit:
- `ml/best_model/model.pt` (253MB) — PyTorch checkpoint
- `ml/cue_model.onnx.data` (253MB) — ONNX external weights

To regenerate them:
```bash
cd ml
python train.py      # Trains model → saves best_model/model.pt
python export.py     # Exports to cue_model.onnx + cue_model.onnx.data
```

> **Note**: The production ONNX model (`model/cue_model.onnx`, 685KB) IS included in the repo. The extension works without the large files — they're only needed to retrain the model.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Extension | Chrome Extensions Manifest V3, vanilla JavaScript |
| ML Inference | ONNX Runtime Web 1.24.3, WebAssembly (SIMD + threading) |
| ML Training | PyTorch, HuggingFace Transformers (DistilBERT) |
| Data | HuggingFace Datasets (ShareGPT52K), JSONL |
| Storage | chrome.storage.local |

---

## Project Structure

```
cue/
├── manifest.json              # Extension manifest (v3)
├── package.json               # Node dependencies (onnxruntime-web)
├── popup.html                 # Popup dashboard layout
│
├── src/                       # Extension source code
│   ├── background.js          # Service worker (storage, stats)
│   ├── content.js             # Main orchestrator (claude.ai)
│   ├── scorer.js              # ONNX + rule-based scoring
│   ├── perception.js          # Claude perception generator
│   ├── rewriter.js            # Targeted prompt rewriter
│   ├── tracker.js             # Prompt logger & stats
│   └── ui.js                  # Signal bars, modal, diff UI
│
├── popup/                     # Popup dashboard
│   ├── popup.js               # Stats fetching & rendering
│   └── popup.css              # Dark theme styles
│
├── model/                     # Production model (browser)
│   ├── cue_model.onnx         # ONNX model graph (685KB)
│   └── vocab.json             # DistilBERT vocabulary (30522 tokens)
│
├── lib/                       # ONNX Runtime Web
│   ├── ort.min.js             # JS API
│   ├── ort-wasm-simd-threaded.wasm   # WASM backend (12MB)
│   └── ort-wasm-simd-threaded.mjs    # WASM loader
│
├── ml/                        # ML pipeline
│   ├── label.py               # Data labeling (ShareGPT52K)
│   ├── train.py               # DistilBERT fine-tuning
│   ├── export.py              # ONNX export
│   ├── evaluate.py            # Evaluation (placeholder)
│   ├── labeled_dataset.jsonl  # Training data (~29MB)
│   ├── best_model/            # Trained checkpoint
│   │   ├── model.pt           # PyTorch weights (253MB, gitignored)
│   │   ├── tokenizer.json     # Full tokenizer
│   │   └── tokenizer_config.json
│   ├── cue_model.onnx         # Exported ONNX graph
│   └── cue_model.onnx.data   # ONNX weights (253MB, gitignored)
│
└── icons/                     # Extension icons
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## License

All rights reserved.
