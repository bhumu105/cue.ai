"""
Export the trained DistilBERT regressor to ONNX format for browser deployment.
Loads the best checkpoint from ml/best_model/, exports to ml/cue_model.onnx,
and verifies the export with a test inference.
"""

import numpy as np
import onnxruntime as ort
import torch
from transformers import DistilBertTokenizer

from ml.train import DistilBertRegressor

MODEL_PATH = "ml/best_model/model.pt"
ONNX_PATH = "ml/cue_model.onnx"
DIMENSIONS = ["clarity", "context", "specificity", "focus"]
MAX_LENGTH = 128


def load_model():
    model = DistilBertRegressor()
    model.load_state_dict(torch.load(MODEL_PATH, map_location="cpu"))
    model.eval()
    return model


def export_onnx(model, tokenizer):
    sample = tokenizer(
        "How do I fix a segfault in my C program?",
        max_length=MAX_LENGTH,
        padding="max_length",
        truncation=True,
        return_tensors="pt",
    )
    input_ids = sample["input_ids"]
    attention_mask = sample["attention_mask"]

    torch.onnx.export(
        model,
        (input_ids, attention_mask),
        ONNX_PATH,
        input_names=["input_ids", "attention_mask"],
        output_names=["scores"],
        dynamic_axes={
            "input_ids": {0: "batch_size"},
            "attention_mask": {0: "batch_size"},
            "scores": {0: "batch_size"},
        },
        opset_version=14,
    )
    print(f"Exported ONNX model to {ONNX_PATH}")


def verify_onnx(tokenizer):
    session = ort.InferenceSession(ONNX_PATH)

    test_prompts = [
        "How do I fix a segfault in my C program?",
        "Write a Python function that sorts a list",
        "What is the difference between TCP and UDP?",
    ]

    print(f"\nVerification — running {len(test_prompts)} test inferences:\n")

    for prompt in test_prompts:
        tokens = tokenizer(
            prompt,
            max_length=MAX_LENGTH,
            padding="max_length",
            truncation=True,
            return_tensors="np",
        )
        outputs = session.run(
            None,
            {
                "input_ids": tokens["input_ids"].astype(np.int64),
                "attention_mask": tokens["attention_mask"].astype(np.int64),
            },
        )
        scores = outputs[0][0] * 5.0  # scale back to 0-5
        scores = np.clip(scores, 0.0, 5.0)

        print(f"  Prompt: {prompt[:60]}")
        for dim, score in zip(DIMENSIONS, scores):
            print(f"    {dim}: {score:.2f}")
        cue_score = scores.mean()
        print(f"    cue_score: {cue_score:.2f}")
        print()


def main():
    print("Loading trained model...")
    model = load_model()
    tokenizer = DistilBertTokenizer.from_pretrained("ml/best_model")

    print("Exporting to ONNX...")
    export_onnx(model, tokenizer)

    print("Verifying ONNX export...")
    verify_onnx(tokenizer)

    print("Done.")


if __name__ == "__main__":
    main()
