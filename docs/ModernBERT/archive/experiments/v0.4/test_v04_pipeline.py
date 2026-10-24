"""新しい保留評価と旧版の回帰確認を分離する。学習・モデル推論はしない。"""

import json
import unittest
from copy import deepcopy
from unittest.mock import patch

import test_v03_pipeline as previous_tests
from dataset import LABEL_TO_ID, ROOT, SPLITS, V04, read_corpus, read_splits, validate
from evaluation import summarize
from v03_data import families_for, lineage_config
from verify_results import legacy_comparison


@unittest.skipUnless(V04, "v0.4 experiment root required")
class V04DataTests(previous_tests.V03DataTests):
    # The inherited source fidelity, atomic publication, truncation, and prediction
    # checks exercise the same shared code with the v0.4 input set.
    __unittest_skip__ = not V04

    def test_legacy_splits_are_unchanged(self):
        config = lineage_config(ROOT)
        self.assertEqual(len(SPLITS), 7)
        for old, new in config["split_map"].items():
            if old == "train":
                continue
            self.assertEqual(
                (ROOT / "data" / f"{new}.jsonl").read_bytes(),
                (ROOT / config["previous_data_dir"] / f"{old}.jsonl").read_bytes(),
            )

    def test_previous_holdout_cannot_become_training(self):
        splits = deepcopy(read_splits())
        row = splits["legacy_v03_test"].pop()
        splits["train"].append(row)
        plan = json.loads((ROOT / "split-plan.json").read_text())
        plan["assignments"][row["id"]]["split"] = "train"
        with self.assertRaises(ValueError):
            validate(splits, plan=plan)

    def test_train_family_cannot_enter_new_holdout(self):
        splits = read_splits()
        plan = json.loads((ROOT / "split-plan.json").read_text())
        computed = families_for(read_corpus(), ROOT)
        dev_id = splits["dev"][0]["id"]
        train_id = splits["train"][0]["id"]
        computed[dev_id] = computed[train_id]
        plan["assignments"][dev_id]["family"] = computed[dev_id]
        with (
            patch("v03_data.families_for", return_value=computed),
            self.assertRaisesRegex(ValueError, "holdout family crosses"),
        ):
            validate(splits, plan=plan)

    def test_retired_mapping_cannot_target_primary_dev(self):
        config = lineage_config(ROOT)
        config["split_map"]["dev"] = "dev"
        from pathlib import Path

        original = Path.read_text

        def changed(path, *args, **kwargs):
            if path == ROOT / "lineage-plan.json":
                return json.dumps(config)
            return original(path, *args, **kwargs)

        with (
            patch.object(Path, "read_text", changed),
            self.assertRaisesRegex(ValueError, "retired split mapping"),
        ):
            lineage_config(ROOT)

    def test_baseline_comparison_uses_same_examples_and_frozen_predictions(self):
        splits = read_splits()
        metrics = {}
        for seed in (42, 43, 44):
            name = f"seed-{seed}"
            metrics[name] = {}
            for baseline in lineage_config(ROOT)["baseline_reports"]:
                for old, new in baseline["split_map"].items():
                    rows = [
                        json.loads(line)
                        for line in (
                            ROOT
                            / baseline["reports"]
                            / name
                            / f"{old}-predictions.jsonl"
                        )
                        .read_text()
                        .splitlines()
                    ]
                    metrics[name][new] = summarize(rows)
        comparison = legacy_comparison(metrics, splits)
        for model in comparison.values():
            self.assertEqual(len(model), 4)
            for value in model.values():
                self.assertEqual(value["delta"], 0)
                self.assertFalse(value["independent_acceptance"])
        changed = deepcopy(splits)
        changed["legacy_v03_test"][0]["label"] = "save"
        # Make sure this is a genuine mutation even if future ordering changes.
        if splits["legacy_v03_test"][0]["label"] == "save":
            changed["legacy_v03_test"][0]["label"] = "undo"
        with self.assertRaisesRegex(ValueError, "text/gold differs"):
            legacy_comparison(metrics, changed)


class V04EvaluationTests(unittest.TestCase):
    def test_both_compound_error_directions_and_precision(self):
        pairs = [
            ("save", "compound_request"),
            ("undo", "undo"),
            ("compound_request", "compound_request"),
            ("compound_request", "save"),
            ("not_command", "compound_request"),
            ("needs_reasoning", "needs_reasoning"),
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
            result["single_dispatch_to_compound"],
            {"count": 1, "denominator": 2, "rate": 0.5},
        )
        self.assertEqual(
            result["compound_to_single_dispatch"],
            {"count": 1, "denominator": 2, "rate": 0.5},
        )
        self.assertEqual(
            result["compound_prediction_precision"],
            {"count": 1, "denominator": 3, "rate": 1 / 3},
        )
        empty = summarize([rows[1]])
        self.assertIsNone(empty["compound_prediction_precision"]["rate"])
        self.assertEqual(len(result["per_class"]), len(LABEL_TO_ID))


if __name__ == "__main__":
    unittest.main()
