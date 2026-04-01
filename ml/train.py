"""
Fine-tune DistilBERT on labeled ShareGPT prompts for multi-output regression
across 4 dimensions: clarity, context, specificity, focus.
"""

import json
import random

import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Dataset
from transformers import DistilBertModel, DistilBertTokenizer

DATASET_PATH = "ml/labeled_dataset.jsonl"
MODEL_SAVE_PATH = "ml/best_model"
DIMENSIONS = ["clarity", "context", "specificity", "focus"]

SEED = 42
MAX_LENGTH = 128
BATCH_SIZE = 32
EPOCHS = 5
LR = 2e-5

random.seed(SEED)
torch.manual_seed(SEED)

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")


class PromptDataset(Dataset):
    def __init__(self, samples, tokenizer):
        self.samples = samples
        self.tokenizer = tokenizer

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        sample = self.samples[idx]
        encoding = self.tokenizer(
            sample["prompt"],
            max_length=MAX_LENGTH,
            padding="max_length",
            truncation=True,
            return_tensors="pt",
        )
        labels = torch.tensor(
            [sample[d] / 5.0 for d in DIMENSIONS], dtype=torch.float
        )
        return {
            "input_ids": encoding["input_ids"].squeeze(0),
            "attention_mask": encoding["attention_mask"].squeeze(0),
            "labels": labels,
        }


class DistilBertRegressor(nn.Module):
    def __init__(self):
        super().__init__()
        self.bert = DistilBertModel.from_pretrained("distilbert-base-uncased")
        self.regressor = nn.Linear(768, 4)

    def forward(self, input_ids, attention_mask):
        output = self.bert(input_ids=input_ids, attention_mask=attention_mask)
        cls_hidden = output.last_hidden_state[:, 0, :]  # [CLS] token
        return self.regressor(cls_hidden)


def load_data():
    samples = []
    with open(DATASET_PATH) as f:
        for line in f:
            samples.append(json.loads(line))

    random.shuffle(samples)
    n = len(samples)
    train_end = int(0.8 * n)
    val_end = int(0.9 * n)

    return samples[:train_end], samples[train_end:val_end], samples[val_end:]


def evaluate(model, loader, criterion):
    model.eval()
    total_loss = 0.0
    total_ae = torch.zeros(4)
    count = 0

    with torch.no_grad():
        for batch in loader:
            input_ids = batch["input_ids"].to(device)
            attention_mask = batch["attention_mask"].to(device)
            labels = batch["labels"].to(device)

            preds = model(input_ids, attention_mask)
            loss = criterion(preds, labels)
            total_loss += loss.item() * labels.size(0)

            # MAE in original 0-5 scale
            total_ae += (preds.cpu() - labels.cpu()).abs().sum(dim=0) * 5.0
            count += labels.size(0)

    return total_loss / count, (total_ae / count).tolist()


def main():
    print("Loading dataset...")
    train_data, val_data, test_data = load_data()
    print(f"Split sizes — train: {len(train_data)}, val: {len(val_data)}, test: {len(test_data)}")

    print("Loading tokenizer and model...")
    tokenizer = DistilBertTokenizer.from_pretrained("distilbert-base-uncased")

    train_dataset = PromptDataset(train_data, tokenizer)
    val_dataset = PromptDataset(val_data, tokenizer)
    test_dataset = PromptDataset(test_data, tokenizer)

    train_loader = DataLoader(train_dataset, batch_size=BATCH_SIZE, shuffle=True)
    val_loader = DataLoader(val_dataset, batch_size=BATCH_SIZE)
    test_loader = DataLoader(test_dataset, batch_size=BATCH_SIZE)

    model = DistilBertRegressor().to(device)
    criterion = nn.MSELoss()
    optimizer = torch.optim.AdamW(model.parameters(), lr=LR)

    best_val_loss = float("inf")

    print(f"\nTraining on {device} for {EPOCHS} epochs...\n")

    for epoch in range(1, EPOCHS + 1):
        model.train()
        train_loss_sum = 0.0
        train_count = 0

        for batch_idx, batch in enumerate(train_loader):
            input_ids = batch["input_ids"].to(device)
            attention_mask = batch["attention_mask"].to(device)
            labels = batch["labels"].to(device)

            optimizer.zero_grad()
            preds = model(input_ids, attention_mask)
            loss = criterion(preds, labels)
            loss.backward()
            optimizer.step()

            train_loss_sum += loss.item() * labels.size(0)
            train_count += labels.size(0)

            if (batch_idx + 1) % 100 == 0:
                print(f"  Epoch {epoch} | Batch {batch_idx + 1}/{len(train_loader)} | "
                      f"Loss: {loss.item():.4f}")

        train_loss = train_loss_sum / train_count
        val_loss, _ = evaluate(model, val_loader, criterion)

        print(f"Epoch {epoch}/{EPOCHS} — Train Loss: {train_loss:.4f} | Val Loss: {val_loss:.4f}")

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            torch.save(model.state_dict(), f"{MODEL_SAVE_PATH}/model.pt")
            tokenizer.save_pretrained(MODEL_SAVE_PATH)
            print(f"  -> Saved best model (val_loss={val_loss:.4f})")

    # Load best model for test evaluation
    print("\nLoading best model for test evaluation...")
    model.load_state_dict(torch.load(f"{MODEL_SAVE_PATH}/model.pt", map_location=device))

    test_loss, test_mae = evaluate(model, test_loader, criterion)

    print(f"\n{'='*50}")
    print(f"Test Results (best checkpoint)")
    print(f"{'='*50}")
    print(f"  Test MSE Loss: {test_loss:.4f}")
    for dim, mae in zip(DIMENSIONS, test_mae):
        print(f"  MAE {dim}: {mae:.3f}")
    overall_mae = sum(test_mae) / len(test_mae)
    print(f"  Overall MAE: {overall_mae:.3f}")
    print(f"{'='*50}")


if __name__ == "__main__":
    main()
