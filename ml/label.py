"""
Label ShareGPT52K prompts across 4 dimensions: clarity, context, specificity, focus.
Outputs labeled dataset as JSONL.
"""

import json
import re

from datasets import load_dataset
from tqdm import tqdm

TASK_VERBS = {"fix", "write", "explain", "create", "build", "analyze", "compare",
              "summarize", "list", "describe", "help"}

ERROR_WORDS = {"error", "exception", "returns", "fails", "broken"}

BACKGROUND_PHRASES = ["i'm building", "i'm working on", "i am building", "i am working on"]

QUESTION_PATTERNS = [
    r"\bhow\s+to\b", r"\bhow\s+do\s+i\b", r"\bhow\s+can\b", r"\bcan\s+you\b",
    r"\bcould\s+you\b", r"\bwhat\s+is\b", r"\bwhat\s+are\b", r"\bwhat\s+if\b",
    r"\bwhy\s+does\b", r"\bwhy\s+is\b", r"\bis\s+it\s+possible\b", r"\bis\s+there\b",
    r"\bwhere\s+do\b", r"\bwhere\s+can\b", r"\bwhen\s+should\b",
    r"\bwhat\s+do\b", r"\bwhat\s+does\b",
]

PERSONAL_CONTEXT_PHRASES = ["i have", "i need", "i want", "i am", "i've been"]

TECHNICAL_TERMS = re.compile(
    r"\b(?:api|database|server|function|class|module|component|endpoint|query|schema|"
    r"docker|kubernetes|nginx|redis|sql|mongodb|postgres|mysql|node|react|python|java|"
    r"typescript|javascript|css|html|git|http|tcp|udp|dns|ssh|ssl|tls|aws|gcp|azure|"
    r"lambda|webhook|middleware|frontend|backend|deploy|config|dependency|package|"
    r"library|framework|algorithm|variable|array|object|string|integer|boolean|"
    r"regex|authentication|authorization|token|session|cookie|cache|queue|thread|"
    r"process|memory|cpu|gpu|kernel|compiler|runtime|binary|container|pipeline)\b",
    re.IGNORECASE,
)

TONE_WORDS = {"formal", "casual", "simple"}

AUDIENCE_WORDS = {"beginner", "expert", "for my"}

FORMAT_WORDS = {"table", "list", "bullet", "paragraph"}

OUTPUT_PATH = "ml/labeled_dataset.jsonl"


def is_english_ascii(text: str) -> bool:
    """Basic ASCII check — reject if >15% non-ASCII characters."""
    non_ascii = sum(1 for c in text if ord(c) > 127)
    return non_ascii / max(len(text), 1) < 0.15


def extract_first_human_turn(conversations) -> str | None:
    """Extract the value field from the first human turn."""
    if not conversations:
        return None
    for turn in conversations:
        if turn.get("from") == "human":
            return turn.get("value", "").strip()
    return None


def filter_prompt(prompt: str | None) -> bool:
    """Return True if prompt passes all filters."""
    if not prompt:
        return False
    if len(prompt) < 10 or len(prompt) > 1000:
        return False
    if not is_english_ascii(prompt):
        return False
    return True


def find_task_verbs(text: str) -> list[str]:
    """Find task verbs present in the text."""
    words = set(re.findall(r'\b[a-z]+\b', text.lower()))
    return [v for v in TASK_VERBS if v in words]


def has_specific_noun(text: str, verbs: list[str]) -> bool:
    """Check if a task verb is followed by a specific noun (not just a verb alone)."""
    text_lower = text.lower()
    for verb in verbs:
        pattern = rf'\b{verb}\b\s+\w+'
        if re.search(pattern, text_lower):
            return True
    return False


def has_failure_detail(text: str) -> bool:
    """Check for failure/error detail indicators."""
    text_lower = text.lower()
    indicators = ["but it", "doesn't work", "not working", "getting error",
                  "fails with", "returns wrong", "instead of", "expected",
                  "i tried", "i get"]
    return any(ind in text_lower for ind in indicators)


def has_question_form(text: str) -> bool:
    """Check if the prompt uses a question-form pattern."""
    text_lower = text.lower()
    return any(re.search(p, text_lower) for p in QUESTION_PATTERNS)


def score_clarity(text: str) -> int:
    verbs = find_task_verbs(text)
    n_verbs = len(verbs)

    # Question-form prompts: score 2-3 even without task verbs
    is_question = has_question_form(text)

    has_question_mark = "?" in text

    if n_verbs == 0:
        if is_question and has_specific_noun(text, ["how", "what", "why", "can", "could"]):
            return 3
        if is_question:
            return 2
        if has_question_mark and len(text) > 20:
            return 2
        return 0
    if n_verbs == 1 and not has_specific_noun(text, verbs):
        return 3 if is_question else 2
    if has_specific_noun(text, verbs) and has_failure_detail(text):
        return 5
    if has_specific_noun(text, verbs):
        return 4
    # 1+ verbs but no specific noun
    return 3


def score_context(text: str) -> int:
    signals = 0
    text_lower = text.lower()

    # Situational length: prompts over 100 chars that describe a situation
    if len(text) > 100:
        signals += 1

    # Personal context phrases: "I have", "I need", "I want", "I am", "I've been"
    if any(p in text_lower for p in PERSONAL_CONTEXT_PHRASES):
        signals += 1

    # Technical terms — 1 point for any, 2 if 3+ distinct terms
    tech_matches = set(m.lower() for m in TECHNICAL_TERMS.findall(text))
    if len(tech_matches) >= 3:
        signals += 2
    elif tech_matches:
        signals += 1

    # Code blocks
    if "```" in text or re.search(r'\n    \S', text):
        signals += 2

    # Error mentions
    if any(w in text_lower for w in ERROR_WORDS):
        signals += 1

    # Examples
    if "example" in text_lower or "e.g." in text_lower or "for instance" in text_lower:
        signals += 1

    # Background phrases
    if any(p in text_lower for p in BACKGROUND_PHRASES):
        signals += 1

    return min(signals, 5)


def score_specificity(text: str) -> int:
    signals = 0
    text_lower = text.lower()

    # Length constraints
    if re.search(r'\b\d+\s*(words?|characters?|sentences?|lines?|paragraphs?)\b', text_lower):
        signals += 1

    # Format mentions
    if any(w in text_lower for w in FORMAT_WORDS):
        signals += 1

    # Audience mentions
    if any(w in text_lower for w in AUDIENCE_WORDS):
        signals += 1

    # Tone words
    if any(w in text_lower for w in TONE_WORDS):
        signals += 1

    # Explicit output format
    if re.search(r'\b(json|csv|markdown|html|xml|yaml)\b', text_lower):
        signals += 1

    return min(signals, 5)


def score_focus(text: str) -> int:
    # Split on punctuation and conjunctions
    segments = re.split(r'[.!?;]\s+|\band\b|\bbut\b|\balso\b|\bthen\b', text.lower())
    segments = [s.strip() for s in segments if s.strip()]

    # Count distinct task verbs across all segments
    all_verbs = set()
    for seg in segments:
        seg_words = set(re.findall(r'\b[a-z]+\b', seg))
        all_verbs.update(seg_words & TASK_VERBS)

    n_tasks = max(len(all_verbs), 1)

    if n_tasks == 1:
        return 5
    if n_tasks == 2:
        return 3
    if n_tasks == 3:
        return 1
    return 0


def label_prompt(prompt: str) -> dict:
    clarity = score_clarity(prompt)
    context = score_context(prompt)
    specificity = score_specificity(prompt)
    focus = score_focus(prompt)
    cue_score = round((clarity + context + specificity + focus) / 4, 2)

    return {
        "prompt": prompt,
        "clarity": clarity,
        "context": context,
        "specificity": specificity,
        "focus": focus,
        "cue_score": cue_score,
        "source": "sharegpt52k",
    }


def main():
    print("Loading ShareGPT52K dataset...")
    ds = load_dataset("RyokoAI/ShareGPT52K")

    all_rows = []
    for split in ds:
        all_rows.extend(ds[split])

    print(f"Total conversations: {len(all_rows)}")

    totals = {"clarity": 0, "context": 0, "specificity": 0, "focus": 0, "cue_score": 0}
    processed = 0

    with open(OUTPUT_PATH, "w") as f:
        for i, row in enumerate(tqdm(all_rows, desc="Labeling prompts")):
            prompt = extract_first_human_turn(row.get("conversations", []))
            if not filter_prompt(prompt):
                continue

            labeled = label_prompt(prompt)
            f.write(json.dumps(labeled) + "\n")

            for key in totals:
                totals[key] += labeled[key]
            processed += 1

            if processed % 1000 == 0:
                print(f"\n  Progress: {processed} prompts labeled")

    print(f"\n{'='*50}")
    print(f"Total processed: {processed}")
    print(f"{'='*50}")
    for dim in ["clarity", "context", "specificity", "focus"]:
        avg = totals[dim] / max(processed, 1)
        print(f"  Average {dim}: {avg:.2f}")
    avg_cue = totals["cue_score"] / max(processed, 1)
    print(f"  Average cue_score: {avg_cue:.2f}")
    print(f"{'='*50}")
    print(f"Output written to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
