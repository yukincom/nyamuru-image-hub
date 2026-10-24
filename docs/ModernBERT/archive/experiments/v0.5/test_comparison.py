"""損失、実ModernBERTのdropout、dev限定選択、評価資格を検証する。"""

import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import torch
import torch.nn.functional as F
from transformers import (
    ModernBertConfig,
    ModernBertForSequenceClassification,
    TrainingArguments,
)

from comparison import choose_method
from evaluation import select_primary_model, select_shared_learning_rate
from train import DROPOUT_FIELDS, MeasuredTrainer, two_view_terms, validate_objective
from verify_results import acceptance_assessment


def objective(name, views, alpha, p):
    return {
        "name": name,
        "views": views,
        "kl_weight": alpha,
        "dropout": {key: p for key in DROPOUT_FIELDS},
    }


class LossTests(unittest.TestCase):
    def test_symmetric_kl_and_batch_scale(self):
        a = torch.tensor([[2.0, -1.0, 0.0], [0.0, 1.0, 3.0]], requires_grad=True)
        b = torch.tensor([[0.0, 2.0, 1.0], [1.0, 2.0, 0.0]], requires_grad=True)
        labels = torch.tensor([0, 2])
        ce, kl = two_view_terms(a, b, labels)
        pa, pb = a.softmax(-1), b.softmax(-1)
        expected = (
            (pa * (pa.log() - pb.log())).sum(-1) + (pb * (pb.log() - pa.log())).sum(-1)
        ).mean() / 2
        torch.testing.assert_close(kl, expected)
        torch.testing.assert_close(
            ce, (F.cross_entropy(a, labels) + F.cross_entropy(b, labels)) / 2
        )
        torch.testing.assert_close(kl, two_view_terms(b, a, labels)[1])
        torch.testing.assert_close(
            kl, two_view_terms(a.repeat(2, 1), b.repeat(2, 1), labels.repeat(2))[1]
        )
        self.assertAlmostEqual(
            float(two_view_terms(a, a, labels)[1].detach()), 0, places=6
        )
        (ce + kl).backward()
        self.assertTrue(torch.isfinite(a.grad).all() and torch.isfinite(b.grad).all())
        self.assertGreater(float(a.grad.abs().sum()), 0)
        self.assertGreater(float(b.grad.abs().sum()), 0)

    def test_invalid_objectives_rejected(self):
        for change in (
            {"kl_weight": float("nan")},
            {"views": 1, "kl_weight": 1},
            {"dropout": {key: 0 for key in DROPOUT_FIELDS}},
            {"dropout": {key: 1 for key in DROPOUT_FIELDS}},
        ):
            value = objective("rdrop", 2, 1, 0.1)
            value.update(change)
            with self.assertRaises(ValueError):
                validate_objective(value)

    def test_actual_modernbert_training_eval_and_reload(self):
        torch.set_num_threads(2)
        batch = {
            "input_ids": torch.tensor([[1, 2, 3, 0], [1, 4, 5, 6]]),
            "attention_mask": torch.tensor([[1, 1, 1, 0], [1, 1, 1, 1]]),
            "labels": torch.tensor([0, 1]),
        }
        for spec in (
            None,
            objective("baseline", 1, 0, 0),
            objective("dropout_2view", 2, 0, 0.1),
            objective("rdrop", 2, 1, 0.1),
        ):
            with self.subTest(objective=spec), tempfile.TemporaryDirectory() as temp:
                torch.manual_seed(7)
                model = ModernBertForSequenceClassification(
                    ModernBertConfig(
                        vocab_size=32,
                        hidden_size=16,
                        intermediate_size=32,
                        num_hidden_layers=2,
                        num_attention_heads=2,
                        num_labels=19,
                        max_position_embeddings=128,
                        local_attention=64,
                        pad_token_id=0,
                        bos_token_id=1,
                        eos_token_id=2,
                        cls_token_id=1,
                        sep_token_id=2,
                        **(spec["dropout"] if spec else {}),
                    )
                )
                model.config._attn_implementation = "sdpa"
                trainer = MeasuredTrainer(
                    model=model,
                    objective=spec,
                    args=TrainingArguments(
                        output_dir=temp,
                        use_cpu=True,
                        report_to="none",
                        dataloader_pin_memory=False,
                    ),
                )
                model.train()
                with patch.object(model, "forward", wraps=model.forward) as forward:
                    loss = trainer.compute_loss(model, dict(batch))
                    self.assertEqual(forward.call_count, spec["views"] if spec else 1)
                self.assertTrue(torch.isfinite(loss))
                loss.backward()
                self.assertGreater(float(model.classifier.weight.grad.abs().sum()), 0)
                optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3)
                optimizer.step()
                if spec and spec["views"] == 2:
                    self.assertGreater(
                        float(trainer.objective_totals["symmetric_kl"]), 0
                    )
                model.eval()
                with (
                    torch.no_grad(),
                    patch.object(model, "forward", wraps=model.forward) as forward,
                ):
                    loss, output = trainer.compute_loss(
                        model, dict(batch), return_outputs=True
                    )
                    self.assertEqual(forward.call_count, 1)
                    torch.testing.assert_close(
                        loss, F.cross_entropy(output.logits, batch["labels"])
                    )
                model.save_pretrained(Path(temp) / "saved")
                reloaded = ModernBertForSequenceClassification.from_pretrained(
                    Path(temp) / "saved", attn_implementation="sdpa"
                )
                reloaded.eval()
                with torch.no_grad():
                    again = reloaded(**batch)
                torch.testing.assert_close(output.logits, again.logits)
                torch.testing.assert_close(loss, again.loss)


class SelectionTests(unittest.TestCase):
    def fixtures(self):
        plan = {
            "conditions": [
                {"id": name} for name in ("baseline", "dropout_2view", "rdrop")
            ]
        }
        rows = [
            {
                "selection_split": "dev",
                "trial_index": i,
                "trial": f"trial-{i + 1}",
                "seed": seed,
                "learning_rate": lr,
                "macro_f1": 0.7,
                "loss": 0.5,
                "epoch": 2,
                "accuracy": 0.75,
            }
            for i, (seed, lr) in enumerate(
                (s, lr) for s in (42, 43, 44) for lr in (2e-5, 5e-5)
            )
        ]
        selection = select_shared_learning_rate(rows, [42, 43, 44], [2e-5, 5e-5])
        selection["primary_model"] = select_primary_model(selection)
        return plan, {c["id"]: copy.deepcopy(selection) for c in plan["conditions"]}

    def test_tie_prefers_predeclared_baseline(self):
        plan, selections = self.fixtures()
        self.assertEqual(choose_method(selections, plan)["selected_method"], "baseline")
        selections["rdrop"]["learning_rate_means"][0]["macro_f1"] = 0.8
        self.assertEqual(choose_method(selections, plan)["selected_method"], "rdrop")

    def test_missing_method_and_test_selection_rejected(self):
        plan, selections = self.fixtures()
        del selections["rdrop"]
        with self.assertRaises(ValueError):
            choose_method(selections, plan)
        plan, selections = self.fixtures()
        selections["rdrop"]["learning_rate_means"][0]["selection_split"] = "test"
        with self.assertRaises(ValueError):
            choose_method(selections, plan)

    def test_inspected_test_never_claims_target(self):
        result = acceptance_assessment(
            {"independent_acceptance_eligible": False}, {}, {}
        )
        self.assertNotIn("target_assessment", result)
        self.assertFalse(result["independent_acceptance"]["eligible"])


if __name__ == "__main__":
    unittest.main()
