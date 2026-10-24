"""入力漏洩・固定分割・dev選択・予測照合の検査。モデル精度の検証ではない。"""

import json
import math
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np

from dataset import (
    CONTRACT,
    LABEL_TO_ID,
    ROOT,
    data_report,
    model_example,
    read_corpus,
    read_corpus_lines,
    read_splits,
    validate,
)
from evaluation import (
    LABELS,
    classification_metrics,
    select_shared_learning_rate,
    selection_key,
    summarize,
)
from train import EncodedRows, SaveBestDevelopment, prediction_rows
from verify_results import verify_predictions


class DatasetTests(unittest.TestCase):
    def test_sources_splits_and_counts(self):
        splits = read_splits()
        validate(splits)
        self.assertEqual(
            data_report(splits), json.loads((ROOT / "data-report.json").read_text())
        )
        self.assertEqual(sum(map(len, splits.values())), 924)
        source = read_corpus_lines()
        source_by_id = {json.loads(line)["id"]: line for line in source}
        for split, rows in splits.items():
            self.assertEqual(
                (ROOT / "data" / f"{split}.jsonl").read_bytes(),
                b"".join(source_by_id[r["id"]] for r in rows),
            )

    def test_originals_preserved_and_new_examples_separate(self):
        rows = read_corpus()
        original = [
            json.loads(line)
            for line in (ROOT / "source/candidates.jsonl").read_text().splitlines()
        ]
        self.assertEqual(rows[:316], original)
        self.assertEqual(len(rows[316:]), 608)
        for row in rows[316:]:
            self.assertEqual(row["source"], "codex_synthetic")
            self.assertEqual(row["review_status"], "pending_user_review")
        for label in LABEL_TO_ID:
            self.assertEqual(sum(r["label"] == label for r in rows[316:]), 32)

    def test_all_labels_have_held_out_examples(self):
        for split, rows in read_splits().items():
            for label in LABEL_TO_ID:
                self.assertGreaterEqual(
                    sum(r["label"] == label for r in rows),
                    12 if split == "train" else 4,
                )

    def test_corpus_without_final_newline_rejected_before_join(self):
        from dataset import digest

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw = json.dumps(read_corpus()[0]).encode()
            (root / "rows.jsonl").write_bytes(raw)
            (root / "corpus.json").write_text(
                json.dumps(
                    {
                        "n": 1,
                        "sources": [
                            {
                                "path": "rows.jsonl",
                                "n": 1,
                                "sha256": digest(root / "rows.jsonl"),
                            }
                        ],
                    }
                )
            )
            with (
                patch("dataset.ROOT", root),
                self.assertRaisesRegex(ValueError, "end with LF"),
            ):
                read_corpus_lines()

    def test_failed_prepared_replacement_restores_previous_files(self):
        from prepare_data import PREPARED_FILES, publish_prepared

        with tempfile.TemporaryDirectory() as directory:
            root, staging = Path(directory) / "root", Path(directory) / "stage"
            for name in PREPARED_FILES:
                for parent, content in [(root, b"original"), (staging, b"replacement")]:
                    path = parent / name
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(content)
            original_replace = Path.replace
            calls = 0

            def fail_second(path, target):
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise OSError("simulated replacement failure")
                return original_replace(path, target)

            with (
                patch("prepare_data.ROOT", root),
                patch.object(Path, "replace", fail_second),
                self.assertRaisesRegex(OSError, "simulated"),
            ):
                publish_prepared(staging)
            for name in PREPARED_FILES:
                self.assertEqual((root / name).read_bytes(), b"original")

    def test_all_metadata_excluded(self):
        row = deepcopy(read_splits()["train"][0])
        original = model_example(row)
        for key in set(row) - {"text", "label"}:
            row[key] = "CANARY_DO_NOT_PASS_TO_MODEL"
        row["context"] = "CANARY_EXTRA_CONTEXT"
        self.assertEqual(model_example(row), original)
        self.assertEqual(set(original), {"text", "labels"})

    def test_raw_text_not_reformatted(self):
        row = {"text": "  これ生成\n", "label": "generate_request"}
        self.assertEqual(model_example(row), {"text": "  これ生成\n", "labels": 15})

    def test_label_id_contract(self):
        self.assertEqual(list(LABEL_TO_ID.values()), list(range(19)))
        self.assertEqual(
            CONTRACT["id2label"], {str(i): label for label, i in LABEL_TO_ID.items()}
        )

    def test_changed_text_or_metadata_rejected(self):
        for field in ["text", "label", "slots", "group", "note"]:
            splits = deepcopy(read_splits())
            splits["train"][0][field] = "changed"
            with self.assertRaises(ValueError):
                validate(splits)

    def test_moved_or_missing_row_rejected(self):
        splits = deepcopy(read_splits())
        splits["test"].append(splits["train"].pop())
        with self.assertRaises(ValueError):
            validate(splits)
        splits = deepcopy(read_splits())
        splits["train"].pop()
        with self.assertRaises(ValueError):
            validate(splits)

    def test_group_and_family_exclusivity(self):
        assignments = json.loads((ROOT / "split-plan.json").read_text())["assignments"]
        groups, families = {}, {}
        for split, rows in read_splits().items():
            for row in rows:
                for seen, key in [
                    (groups, row["group"]),
                    (families, assignments[row["id"]]["family"]),
                ]:
                    self.assertIn(seen.get(key, split), [split])
                    seen[key] = split

    def test_no_silent_truncation(self):
        observed = []

        def tokenizer(text, **kwargs):
            observed.append((text, kwargs))
            return {"input_ids": [1] * 129, "attention_mask": [1] * 129}

        row = read_splits()["train"][0]
        with self.assertRaises(ValueError):
            EncodedRows([row], tokenizer, 128)
        self.assertEqual(observed, [(row["text"], {"truncation": False})])


class EvaluationTests(unittest.TestCase):
    def predictions(self):
        originals = read_splits()["test"][:4]
        logits = np.full((4, 19), -3, dtype=np.float32)
        for i, row in enumerate(originals):
            logits[i, LABEL_TO_ID[row["label"]]] = 3
        return originals, prediction_rows(
            originals, SimpleNamespace(predictions=logits)
        )

    def test_known_confusion_and_missing_support(self):
        m = classification_metrics(
            ["save", "undo", "undo"], ["save", "save", "undo"], LABELS
        )
        self.assertEqual(m["correct"], 2)
        self.assertEqual(m["n"], 3)
        self.assertEqual(m["confusion_matrix"][1][0], 1)
        self.assertAlmostEqual(m["macro_f1_supported"], 2 / 3)
        self.assertEqual(len(m["missing_labels"]), 17)

    def test_metrics_against_sklearn(self):
        from sklearn.metrics import accuracy_score, confusion_matrix, f1_score

        gold = ["save", "undo", "not_command", "generate_request", "bubble_set"]
        predicted = [
            "save",
            "redo",
            "generate_request",
            "generate_request",
            "bubble_set",
        ]
        m = classification_metrics(gold, predicted, LABELS)
        self.assertEqual(m["accuracy"], accuracy_score(gold, predicted))
        self.assertAlmostEqual(
            m["macro_f1"],
            f1_score(gold, predicted, labels=LABELS, average="macro", zero_division=0),
        )
        self.assertEqual(
            m["confusion_matrix"],
            confusion_matrix(gold, predicted, labels=LABELS).tolist(),
        )

    def test_prediction_probabilities_and_metadata(self):
        originals, predictions = self.predictions()
        result = verify_predictions(predictions, originals)
        self.assertEqual(result["accuracy"], 1)
        self.assertEqual(result["families"]["all_correct"], result["families"]["n"])
        self.assertEqual(result["not_command_to_dispatch_label"]["rate"], None)

    def test_corrupted_prediction_rejected(self):
        originals, predictions = self.predictions()
        for key, value in [
            ("gold", "not_command"),
            ("family", "different"),
            ("confidence", -1),
            ("correct", False),
        ]:
            bad = deepcopy(predictions)
            bad[0][key] = value
            with self.assertRaises(ValueError):
                verify_predictions(bad, originals)
        bad = deepcopy(predictions)
        bad[0]["probabilities"]["save"] = float("nan")
        with self.assertRaises(ValueError):
            verify_predictions(bad, originals)

    def test_no_action_misdirection_and_family_counts(self):
        rows = [
            {
                "gold": "not_command",
                "predicted": "save",
                "tags": ["negation"],
                "source": "codex_synthetic",
                "family": "a",
            },
            {
                "gold": "save",
                "predicted": "save",
                "tags": [],
                "source": "codex_synthetic",
                "family": "a",
            },
            {
                "gold": "needs_clarification",
                "predicted": "not_command",
                "tags": [],
                "source": "codex_synthetic",
                "family": "b",
            },
        ]
        result = summarize(rows)
        self.assertEqual(result["not_command_to_dispatch_label"]["rate"], 1)
        self.assertEqual(result["unresolved_to_dispatch_label"]["rate"], 0)
        self.assertEqual(result["families"]["all_correct"], 0)
        self.assertEqual(result["families"]["mean_accuracy"], 0.25)

    def test_selection_rejects_test_and_nan(self):
        trial = {
            "selection_split": "test",
            "macro_f1": 0.9,
            "loss": 0.1,
            "epoch": 1,
            "trial_index": 0,
        }
        with self.assertRaises(ValueError):
            selection_key(trial)
        trial["selection_split"] = "dev"
        trial["macro_f1"] = math.nan
        with self.assertRaises(ValueError):
            selection_key(trial)

    def test_shared_learning_rate_and_tie_breaks(self):
        trials = [
            {
                "selection_split": "dev",
                "seed": seed,
                "learning_rate": lr,
                "macro_f1": 0.5 + 0.1 * j,
                "loss": 0.3,
                "epoch": 2,
                "accuracy": 0.8,
                "trial_index": i * 2 + j,
            }
            for i, seed in enumerate([42, 43, 44])
            for j, lr in enumerate([2e-5, 5e-5])
        ]
        result = select_shared_learning_rate(trials, [42, 43, 44], [2e-5, 5e-5])
        self.assertEqual(result["selected_learning_rate"], 5e-5)
        self.assertEqual([r["seed"] for r in result["selected_models"]], [42, 43, 44])
        with self.assertRaises(ValueError):
            select_shared_learning_rate(trials[:-1], [42, 43, 44], [2e-5, 5e-5])

    def test_checkpoint_callback_uses_best_dev(self):
        class FakeSaver:
            def __init__(self):
                self.calls = 0

            def save_pretrained(self, path):
                self.calls += 1

        with tempfile.TemporaryDirectory() as directory:
            model, tokenizer = FakeSaver(), FakeSaver()
            callback = SaveBestDevelopment(Path(directory), 0, 2e-5, tokenizer)
            for epoch, score in [(1, 0.5), (2, 0.4), (3, 0.6)]:
                callback.on_evaluate(
                    SimpleNamespace(seed=42),
                    SimpleNamespace(epoch=epoch, global_step=epoch),
                    None,
                    metrics={
                        "eval_macro_f1": score,
                        "eval_accuracy": score,
                        "eval_loss": 1 - score,
                    },
                    model=model,
                )
            self.assertEqual(model.calls, 2)
            self.assertEqual(callback.best["epoch"], 3)
            self.assertEqual(callback.best["selection_split"], "dev")


if __name__ == "__main__":
    unittest.main()
