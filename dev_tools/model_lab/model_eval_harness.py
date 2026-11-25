"""Offline evaluation metrics and latency benchmarking for Nyamuru lightweight models."""

from __future__ import annotations

import time
from typing import Any, Callable


def evaluate_orientation_predictions(
    truth: list[int], predicted: list[int]
) -> dict[str, float]:
    """Compute exact accuracy across 4-way orientation classes (0/90/180/270)."""
    if len(truth) != len(predicted):
        raise ValueError("truth と predicted の件数が一致しません")
    if not truth:
        return {"total": 0, "correct": 0, "accuracy": 0.0}
    correct = sum(int(t == p) for t, p in zip(truth, predicted))
    return {
        "total": len(truth),
        "correct": correct,
        "accuracy": round(correct / len(truth), 6),
    }


def evaluate_slot_predictions(
    truth_slots: list[list[tuple[str, str]]],
    predicted_slots: list[list[tuple[str, str]]],
) -> dict[str, float]:
    """Compute precision, recall, and F1 over exact (slot_type, slot_text) spans."""
    if len(truth_slots) != len(predicted_slots):
        raise ValueError("truth_slots と predicted_slots の件数が一致しません")
    tp = fp = fn = exact_utterances = 0
    for truth_items, pred_items in zip(truth_slots, predicted_slots):
        truth_set = set(truth_items)
        pred_set = set(pred_items)
        tp += len(truth_set & pred_set)
        fp += len(pred_set - truth_set)
        fn += len(truth_set - pred_set)
        if truth_set == pred_set:
            exact_utterances += 1
    precision = tp / (tp + fp) if (tp + fp) else 1.0
    recall = tp / (tp + fn) if (tp + fn) else 1.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
    total = len(truth_slots)
    return {
        "total": total,
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "precision": round(precision, 6),
        "recall": round(recall, 6),
        "f1": round(f1, 6),
        "exact_match": round(exact_utterances / total, 6) if total else 0.0,
    }


def evaluate_character_match_predictions(
    truth_ids: list[str],
    predicted: list[tuple[str, str]],
) -> dict[str, float]:
    """Evaluate top-1 accuracy, abstention rate, and precision on accepted matches."""
    if len(truth_ids) != len(predicted):
        raise ValueError("truth_ids と predicted の件数が一致しません")
    total = len(truth_ids)
    if not total:
        return {"total": 0, "accuracy": 0.0, "accepted_precision": 0.0, "abstention_rate": 0.0}
    correct = 0
    accepted = 0
    accepted_correct = 0
    abstained = 0
    for truth_id, (pred_id, confidence) in zip(truth_ids, predicted):
        if not pred_id or confidence == "none":
            abstained += 1
            continue
        accepted += 1
        if pred_id == truth_id:
            correct += 1
            accepted_correct += 1
    return {
        "total": total,
        "correct": correct,
        "accepted": accepted,
        "abstained": abstained,
        "accuracy": round(correct / total, 6),
        "accepted_precision": round(accepted_correct / accepted, 6) if accepted else 1.0,
        "abstention_rate": round(abstained / total, 6),
    }


def _levenshtein(seq_a: str, seq_b: str) -> int:
    if seq_a == seq_b:
        return 0
    if not seq_a:
        return len(seq_b)
    if not seq_b:
        return len(seq_a)
    prev = list(range(len(seq_b) + 1))
    for i, char_a in enumerate(seq_a, start=1):
        curr = [i]
        for j, char_b in enumerate(seq_b, start=1):
            cost = 0 if char_a == char_b else 1
            curr.append(min(curr[-1] + 1, prev[j] + 1, prev[j - 1] + cost))
        prev = curr
    return prev[-1]


def evaluate_ocr_cer(truth_texts: list[str], predicted_texts: list[str]) -> dict[str, float]:
    """Compute Character Error Rate (CER) across OCR utterances."""
    if len(truth_texts) != len(predicted_texts):
        raise ValueError("truth_texts と predicted_texts の件数が一致しません")
    total_chars = sum(len(text) for text in truth_texts)
    total_edits = sum(_levenshtein(t, p) for t, p in zip(truth_texts, predicted_texts))
    cer = (total_edits / total_chars) if total_chars else (0.0 if not total_edits else 1.0)
    return {
        "samples": len(truth_texts),
        "total_chars": total_chars,
        "total_edits": total_edits,
        "cer": round(cer, 6),
    }


def benchmark_inference_latency(
    fn: Callable[[], Any],
    *,
    warmup: int = 1,
    runs: int = 10,
) -> dict[str, float]:
    """Measure mean and p95 inference latency in milliseconds."""
    if runs < 1:
        raise ValueError("runs は 1 以上を指定してください")
    for _ in range(max(0, warmup)):
        fn()
    timings_ms: list[float] = []
    for _ in range(runs):
        started = time.perf_counter()
        fn()
        timings_ms.append((time.perf_counter() - started) * 1000.0)
    ordered = sorted(timings_ms)
    p95_index = min(len(ordered) - 1, int(0.95 * (len(ordered) - 1)))
    return {
        "runs": runs,
        "mean_ms": round(sum(ordered) / len(ordered), 3),
        "p95_ms": round(ordered[p95_index], 3),
        "max_ms": round(ordered[-1], 3),
    }
