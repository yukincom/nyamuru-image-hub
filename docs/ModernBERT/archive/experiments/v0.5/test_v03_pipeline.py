"""v0.3のデータ境界とdev選択を検査する。モデルの学習・推論は行わない。"""

import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np

from dataset import (
    LABEL_TO_ID,
    ROOT,
    V03,
    V04,
    data_report,
    model_example,
    read_corpus_lines,
    read_splits,
    validate,
)
from evaluation import (
    select_primary_model,
    select_shared_learning_rate,
    summarize,
    target_assessment,
)
from train import EncodedRows, prediction_rows
from verify_results import verify_predictions


@unittest.skipUnless(V03 and not V04, "v0.3 experiment root required")
class V03DataTests(unittest.TestCase):
    def test_frozen_rows_are_source_bytes(self):
        splits = read_splits()
        validate(splits)
        self.assertEqual(
            data_report(splits), json.loads((ROOT / "data-report.json").read_text())
        )
        raw = {json.loads(line)["id"]: line for line in read_corpus_lines()}
        for split, rows in splits.items():
            self.assertEqual(
                (ROOT / "data" / f"{split}.jsonl").read_bytes(),
                b"".join(raw[r["id"]] for r in rows),
            )

    def test_legacy_splits_are_unchanged(self):
        for split in ["dev", "test"]:
            self.assertEqual(
                (ROOT / "data" / f"legacy_{split}.jsonl").read_bytes(),
                (ROOT / "legacy/v02/data" / f"{split}.jsonl").read_bytes(),
            )

    def test_new_holdouts_have_all_labels(self):
        for split in ["train", "dev", "test"]:
            self.assertEqual(
                {r["label"] for r in read_splits()[split]}, set(LABEL_TO_ID)
            )

    def test_old_and_augmented_rows_cannot_enter_new_holdout(self):
        splits = deepcopy(read_splits())
        row = splits["train"].pop()
        splits["test"].append(row)
        plan = json.loads((ROOT / "split-plan.json").read_text())
        plan["assignments"][row["id"]]["split"] = "test"
        with self.assertRaises(ValueError):
            validate(splits, plan=plan)

    def test_changed_row_or_false_family_rejected(self):
        splits = deepcopy(read_splits())
        splits["dev"][0]["text"] += " changed"
        with self.assertRaises(ValueError):
            validate(splits)
        plan = json.loads((ROOT / "split-plan.json").read_text())
        plan["assignments"][read_splits()["dev"][0]["id"]]["family"] = "fabricated"
        with self.assertRaises(ValueError):
            validate(read_splits(), plan=plan)

    def test_metadata_never_enters_model(self):
        row = deepcopy(read_splits()["train"][-1])
        expected = model_example(row)
        for key in set(row) - {"text", "label"}:
            row[key] = "CANARY"
        row["context"] = "CANARY"
        self.assertEqual(model_example(row), expected)
        self.assertEqual(set(expected), {"text", "labels"})

    def test_overlength_text_rejected_without_truncation(self):
        calls = []

        def tokenizer(text, **kwargs):
            calls.append(kwargs)
            return {"input_ids": [1] * 129}

        with self.assertRaises(ValueError):
            EncodedRows(read_splits()["dev"][:1], tokenizer, 128)
        self.assertEqual(calls, [{"truncation": False}])

    def test_preparation_refuses_frozen_outputs(self):
        from prepare_v03 import prepare

        before = (ROOT / "split-plan.json").read_bytes()
        with self.assertRaisesRegex(ValueError, "never overwrite"):
            prepare()
        self.assertEqual((ROOT / "split-plan.json").read_bytes(), before)

    def test_failed_staging_does_not_publish(self):
        from prepare_v03 import GENERATED, prepare

        with tempfile.TemporaryDirectory() as directory:
            stage = Path(directory)
            (stage / "pool-sources.json").write_text(
                json.dumps({"sources": [{"path": "missing.jsonl"}]})
            )
            with patch("prepare_v03.ROOT", stage), self.assertRaises(FileNotFoundError):
                prepare()
            self.assertTrue(all(not (stage / name).exists() for name in GENERATED))

    def test_publish_failure_rolls_back_and_retry_succeeds(self):
        import shutil

        from prepare_v03 import GENERATED, prepare

        with tempfile.TemporaryDirectory() as directory:
            scratch = Path(directory) / "input"

            def ignore(path, names):
                ignored = [
                    name
                    for name in names
                    if name.endswith(".zip") or name in {"__pycache__", ".venv"}
                ]
                if Path(path) == ROOT:
                    ignored += [
                        name
                        for name in names
                        if name
                        in {
                            "data",
                            "corpus.json",
                            "split-plan.json",
                            "data-report.json",
                        }
                    ]
                return ignored

            shutil.copytree(ROOT, scratch, ignore=ignore)
            original_open = Path.open
            failed_target = scratch / "data/dev.jsonl"

            def fail_one(path, mode="r", *args, **kwargs):
                if path == failed_target and mode == "xb":
                    raise OSError("simulated publication failure")
                return original_open(path, mode, *args, **kwargs)

            with patch("prepare_v03.ROOT", scratch):
                with (
                    patch.object(Path, "open", fail_one),
                    self.assertRaisesRegex(OSError, "simulated"),
                ):
                    prepare()
                self.assertTrue(
                    all(not (scratch / name).is_file() for name in GENERATED)
                )
                prepare()
            for name in GENERATED:
                self.assertEqual(
                    (scratch / name).read_bytes(), (ROOT / name).read_bytes()
                )

    def test_probabilities_and_source_metadata_verified(self):
        rows = read_splits()["test"][:3]
        logits = np.full((3, 19), -3, dtype=np.float32)
        for i, row in enumerate(rows):
            logits[i, LABEL_TO_ID[row["label"]]] = 3
        predictions = prediction_rows(rows, SimpleNamespace(predictions=logits))
        self.assertEqual(verify_predictions(predictions, rows)["accuracy"], 1)
        predictions[0]["probabilities"]["undo"] = float("nan")
        with self.assertRaises(ValueError):
            verify_predictions(predictions, rows)


class V03EvaluationTests(unittest.TestCase):
    def test_primary_seed_selected_by_dev_only(self):
        trials = [
            {
                "selection_split": "dev",
                "seed": seed,
                "learning_rate": lr,
                "macro_f1": score,
                "loss": 0.2,
                "epoch": 3,
                "accuracy": score,
                "trial_index": i * 2 + j,
                "trial": f"trial-{i * 2 + j + 1}",
            }
            for i, (seed, score) in enumerate([(42, 0.9), (43, 0.91), (44, 0.8)])
            for j, lr in enumerate([2e-5, 5e-5])
        ]
        chosen = select_shared_learning_rate(trials, [42, 43, 44], [2e-5, 5e-5])
        primary = select_primary_model(chosen)
        self.assertEqual(primary["seed"], 43)
        # The seed with a better test score must not become primary.
        metrics = {
            "seed-42": {
                "test": {"correct": 100, "n": 100, "accuracy": 1.0, "macro_f1": 1.0}
            },
            "seed-43": {
                "test": {"correct": 94, "n": 100, "accuracy": 0.94, "macro_f1": 0.94}
            },
        }
        result = target_assessment(primary, metrics)
        self.assertFalse(result["target_met_on_this_holdout"])
        self.assertEqual(result["accuracy"], 0.94)
        chosen["selected_models"][0]["selection_split"] = "test"
        with self.assertRaises(ValueError):
            select_primary_model(chosen)

    def test_directional_error_denominators(self):
        pairs = [
            ("undo", "redo"),
            ("redo", "undo"),
            ("redo", "redo"),
            ("compound_request", "save"),
            ("not_command", "save"),
        ]
        rows = [
            {
                "gold": g,
                "predicted": p,
                "family": str(i),
                "tags": [],
                "source": "codex_synthetic",
            }
            for i, (g, p) in enumerate(pairs)
        ]
        result = summarize(rows)
        self.assertEqual(
            result["undo_to_redo"], {"count": 1, "denominator": 1, "rate": 1}
        )
        self.assertEqual(
            result["redo_to_undo"], {"count": 1, "denominator": 2, "rate": 0.5}
        )
        self.assertEqual(result["compound_to_single_dispatch"]["rate"], 1)
        self.assertEqual(result["not_command_to_dispatch_label"]["rate"], 1)


if __name__ == "__main__":
    unittest.main()
