"""ニャムルの単独発話19分類。devで選択し、選択確定後にtestを評価。"""

from __future__ import annotations

import argparse
import gc
import hashlib
import importlib.metadata
import json
import math
import os
import platform
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from huggingface_hub import snapshot_download
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    DataCollatorWithPadding,
    Trainer,
    TrainerCallback,
    TrainingArguments,
    set_seed,
)

from dataset import (
    FROZEN_FILES,
    LABEL_TO_ID,
    ROOT,
    data_report,
    input_path,
    model_example,
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


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class EncodedRows(torch.utils.data.Dataset):
    """textだけをトークン化する。超過は切り詰めず拒否する。"""

    def __init__(self, rows: list[dict], tokenizer, max_length: int):
        self.values = []
        self.lengths = []
        for row in rows:
            item = model_example(row)
            tokens = tokenizer(item["text"], truncation=False)
            length = len(tokens["input_ids"])
            if length > max_length:
                raise ValueError(
                    f"{row['id']}: {length} tokens exceed {max_length}; utterance must be preserved"
                )
            tokens["labels"] = item["labels"]
            self.values.append(tokens)
            self.lengths.append(length)

    def __len__(self):
        return len(self.values)

    def __getitem__(self, index):
        return self.values[index]


def compute_metrics(prediction) -> dict:
    """Trainerから渡るdevの予測だけを学習中の選択指標へ変換する。"""
    if not np.isfinite(prediction.predictions).all():
        raise FloatingPointError("Non-finite dev logits; stop before model selection")
    estimated = np.argmax(prediction.predictions, axis=-1)
    result = classification_metrics(
        [LABELS[i] for i in prediction.label_ids],
        [LABELS[i] for i in estimated],
        LABELS,
    )
    return {"accuracy": result["accuracy"], "macro_f1": result["macro_f1"]}


def synchronize(device: str) -> None:
    """CUDAの非同期処理が終わるまで待ち、壁時計計測の境界を揃える。"""
    if device.startswith("cuda"):
        torch.cuda.synchronize()


class MeasuredTrainer(Trainer):
    """評価を同期計測し、明示された学習時だけ二視点の損失を使う。"""

    def __init__(self, *args, objective=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.objective = validate_objective(objective)
        self.objective_totals = {"batches": 0, "ce": 0.0, "symmetric_kl": 0.0}

    def compute_loss(
        self, model, inputs, return_outputs=False, num_items_in_batch=None
    ):
        if not model.training or self.objective["views"] == 1:
            return super().compute_loss(
                model,
                inputs,
                return_outputs=return_outputs,
                num_items_in_batch=num_items_in_batch,
            )
        # Both passes use the same text and independent dropout masks. Evaluation
        # always uses the standard one-pass CE, including checkpoint selection.
        first, second = model(**inputs), model(**inputs)
        ce, kl = two_view_terms(first.logits, second.logits, inputs["labels"])
        alpha = self.objective["kl_weight"]
        # A zero-weight diagnostic must not contribute any backward path.
        loss = ce + alpha * kl if alpha else ce
        self.objective_totals["batches"] += 1
        self.objective_totals["ce"] += ce.detach()
        self.objective_totals["symmetric_kl"] += kl.detach()
        return (loss, first) if return_outputs else loss

    def evaluate(self, *args, **kwargs):
        device = str(self.args.device)
        synchronize(device)
        started = time.perf_counter()
        result = super().evaluate(*args, **kwargs)
        synchronize(device)
        if not hasattr(self, "evaluation_wall_seconds"):
            self.evaluation_wall_seconds = []
        # evaluateにはdev予測と最良重み保存callbackも含む。
        self.evaluation_wall_seconds.append(time.perf_counter() - started)
        return result


DROPOUT_FIELDS = (
    "attention_dropout",
    "embedding_dropout",
    "mlp_dropout",
    "classifier_dropout",
)


def validate_objective(value=None):
    if value is None:
        return {"name": "baseline", "views": 1, "kl_weight": 0.0, "dropout": {}}
    if set(value) != {"name", "views", "kl_weight", "dropout"}:
        raise ValueError("objective fields differ")
    if value["views"] not in (1, 2) or isinstance(value["views"], bool):
        raise ValueError("one or two views required")
    alpha = value["kl_weight"]
    if not isinstance(alpha, (int, float)) or not math.isfinite(alpha) or alpha < 0:
        raise ValueError("finite nonnegative KL weight required")
    if alpha and value["views"] != 2:
        raise ValueError("KL requires two views")
    if set(value["dropout"]) != set(DROPOUT_FIELDS):
        raise ValueError("all ModernBERT dropout fields must be explicit")
    if any(
        not isinstance(p, (int, float)) or not math.isfinite(p) or not 0 <= p < 1
        for p in value["dropout"].values()
    ):
        raise ValueError("dropout probability must be finite in [0,1)")
    if value["views"] == 2 and not any(value["dropout"].values()):
        raise ValueError("two views require nonzero dropout")
    return value


def two_view_terms(first, second, labels):
    """Mean CE + alpha * symmetric KL; sum classes, average examples."""
    ce = (F.cross_entropy(first, labels) + F.cross_entropy(second, labels)) / 2
    # Both targets require gradients. Probability targets can underflow to zero,
    # whose KL target derivative is non-finite even when the forward loss is
    # finite. Keep both distributions in log space; do not detach or clamp them.
    log_first, log_second = F.log_softmax(first, -1), F.log_softmax(second, -1)
    kl = (
        F.kl_div(log_first, log_second, reduction="batchmean", log_target=True)
        + F.kl_div(log_second, log_first, reduction="batchmean", log_target=True)
    ) / 2
    return ce, kl


class SaveBestDevelopment(TrainerCallback):
    """各epochのdev比較で最良の重みだけを保存し、選択根拠を全て記録する。"""

    def __init__(
        self, trial_dir: Path, trial_index: int, learning_rate: float, tokenizer
    ):
        self.directory = trial_dir
        self.index = trial_index
        self.learning_rate = learning_rate
        self.tokenizer = tokenizer
        self.best = None

    def on_evaluate(self, args, state, control, metrics=None, model=None, **kwargs):
        candidate = {
            "selection_split": "dev",
            "trial_index": self.index,
            "seed": args.seed,
            "learning_rate": self.learning_rate,
            "epoch": float(state.epoch),
            "step": int(state.global_step),
            "macro_f1": float(metrics["eval_macro_f1"]),
            "accuracy": float(metrics["eval_accuracy"]),
            "loss": float(metrics["eval_loss"]),
        }
        if not all(
            math.isfinite(candidate[key]) for key in ("macro_f1", "accuracy", "loss")
        ):
            raise FloatingPointError(
                f"Non-finite dev metrics at trial {self.index + 1}, "
                f"epoch {state.epoch}; no checkpoint selected"
            )
        # testはこのcallbackへ渡さず、最良モデル確定後の予測だけに使う。
        with (self.directory / "dev_history.jsonl").open(
            "a", encoding="utf-8"
        ) as stream:
            stream.write(
                json.dumps(candidate, ensure_ascii=False, allow_nan=False) + "\n"
            )
        if self.best is None or selection_key(candidate) > selection_key(self.best):
            self.best = candidate
            model.save_pretrained(self.directory / "best")
            self.tokenizer.save_pretrained(self.directory / "best")
            write_json(self.directory / "best_development.json", candidate)
        print(
            json.dumps({"event": "dev_epoch", **candidate}, ensure_ascii=False),
            flush=True,
        )
        return control


def prediction_rows(rows: list[dict], output) -> list[dict]:
    """評価後にだけ注釈を予測へ結び付ける。全確率は未校正のsoftmax値。"""
    scores = torch.softmax(torch.from_numpy(output.predictions), dim=-1).numpy()
    assignments = json.loads((ROOT / "split-plan.json").read_text())["assignments"]
    result = []
    for row, values in zip(rows, scores, strict=True):
        predicted = LABELS[int(values.argmax())]
        result.append(
            {
                "id": row["id"],
                "text": row["text"],
                "gold": row["label"],
                "predicted": predicted,
                "correct": row["label"] == predicted,
                "confidence": float(values.max()),
                "probabilities": {
                    label: float(values[i]) for i, label in enumerate(LABELS)
                },
                "tags": row["tags"],
                "source": row["source"],
                "group": row["group"],
                "family": assignments[row["id"]]["family"],
            }
        )
    return result


def write_misclassifications(path: Path, predictions: dict[str, list[dict]]) -> None:
    """test・dev・trainを区別し、誤分類を全件残す。"""
    lines = [
        "# ニャムル音声意図分類：誤分類一覧",
        "",
        "devは設定選択に使用。trainは学習例への適合確認。信頼度は未校正のsoftmax値。",
        "",
    ]
    for split in sorted(
        predictions,
        key=lambda s: (
            ["test", "dev", "train"].index(s) if s in ["test", "dev", "train"] else 4
        ),
    ):
        mistakes = [r for r in predictions[split] if not r["correct"]]
        lines += [f"## {split}：{len(mistakes)} / {len(predictions[split])}件", ""]
        for row in mistakes:
            lines += [f"### {row['id']}", ""]
            lines += [
                f"- 発話: {row['text']}",
                f"- 正解: `{row['gold']}`",
                f"- 予測: `{row['predicted']}`（{row['confidence']:.1%}）",
                "",
            ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def evaluate_checkpoint(
    checkpoint: Path,
    splits: dict,
    report_dir: Path,
    work_dir: Path,
    batch_size: int,
    max_length: int,
    device: str,
    selected: dict | None = None,
):
    """保存済みモデルを共通の入力・集計で評価する。旧モデルも重みを更新せず測り直す。"""
    report_dir.mkdir(parents=True, exist_ok=True)
    tokenizer = AutoTokenizer.from_pretrained(checkpoint, local_files_only=True)
    encoded = {
        split: EncodedRows(rows, tokenizer, max_length)
        for split, rows in splits.items()
    }
    collator = DataCollatorWithPadding(tokenizer=tokenizer)
    model = AutoModelForSequenceClassification.from_pretrained(
        checkpoint,
        local_files_only=True,
        dtype=torch.float32,
        attn_implementation="sdpa",
    )
    if model.config.label2id != LABEL_TO_ID:
        raise ValueError("checkpoint label mapping differs from the dataset")
    evaluation_args = TrainingArguments(
        output_dir=str(work_dir),
        per_device_eval_batch_size=batch_size,
        use_cpu=device == "cpu",
        dataloader_pin_memory=False,
        disable_tqdm=True,
        report_to="none",
        fp16=False,
        bf16=False,
        tf32=False if device == "cuda" else None,
    )
    evaluator = Trainer(
        model=model,
        args=evaluation_args,
        processing_class=tokenizer,
        data_collator=collator,
    )
    if not str(next(evaluator.model.parameters()).device).startswith(device):
        raise RuntimeError("evaluation device differs from requested device")
    predictions, metrics = {}, {}
    ordered_splits = [s for s in ["dev", "test", "train"] if s in splits]
    ordered_splits += [s for s in splits if s not in ordered_splits]
    for split in ordered_splits:
        synchronize(device)
        prediction_started = time.perf_counter()
        output = evaluator.predict(encoded[split], metric_key_prefix=split)
        synchronize(device)
        prediction_wall_seconds = time.perf_counter() - prediction_started
        rows = prediction_rows(splits[split], output)
        predictions[split] = rows
        metrics[split] = summarize(rows)
        metrics[split]["loss"] = float(output.metrics[f"{split}_loss"])
        metrics[split]["prediction_seconds"] = float(output.metrics[f"{split}_runtime"])
        metrics[split]["prediction_synchronized_wall_seconds"] = prediction_wall_seconds
        if (
            split == "dev"
            and selected is not None
            and (
                abs(metrics[split]["macro_f1"] - selected["macro_f1"]) > 1e-10
                or abs(metrics[split]["loss"] - selected["loss"]) > 1e-5
            )
        ):
            raise RuntimeError(
                "reloaded checkpoint does not reproduce selected dev metrics"
            )
        (report_dir / f"{split}-predictions.jsonl").write_text(
            "".join(
                json.dumps(row, ensure_ascii=False, allow_nan=False) + "\n"
                for row in rows
            ),
            encoding="utf-8",
        )
    write_json(report_dir / "metrics.json", metrics)
    write_misclassifications(report_dir / "misclassifications.md", predictions)
    del evaluator, model
    gc.collect()
    if device == "mps":
        torch.mps.empty_cache()
    elif device == "cuda":
        torch.cuda.empty_cache()
    return predictions, metrics


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", choices=["cuda", "cpu"], default="cuda")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "weights")
    parser.add_argument("--report-dir", type=Path, default=ROOT / "reports")
    phase = parser.add_mutually_exclusive_group()
    phase.add_argument("--defer-evaluation", action="store_true")
    phase.add_argument("--evaluate-selected", action="store_true")
    args = parser.parse_args()
    config = json.loads((ROOT / "experiment.json").read_text())
    objective = validate_objective(config.get("training_objective"))
    splits = read_splits()
    validate(splits)
    saved_report = json.loads((ROOT / "data-report.json").read_text())
    if data_report(splits) != saved_report:
        raise ValueError("dataset differs from frozen report")
    if args.evaluate_selected:
        resume_evaluation(args, config, splits)
        return
    if args.output_dir.exists() or args.report_dir.exists():
        raise ValueError(
            "use new output directories; previous results are never overwritten"
        )
    if args.device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA is required; no silent CPU fallback")
    torch.set_num_threads(4)
    if args.device == "cuda":
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False
        torch.set_float32_matmul_precision("highest")
    args.output_dir.mkdir(parents=True)
    args.report_dir.mkdir(parents=True)
    started = time.perf_counter()
    base = snapshot_download(
        config["model"],
        revision=config["revision"],
        token=False,
        cache_dir=os.environ.get("NYAMURU_HF_CACHE", str(ROOT / "hf-cache")),
        allow_patterns=[
            "config.json",
            "model.safetensors",
            "tokenizer.json",
            "tokenizer_config.json",
            "special_tokens_map.json",
            "tokenizer.model",
            "spiece.model",
            "README.md",
            "LICENSE",
        ],
    )
    tokenizer = AutoTokenizer.from_pretrained(base, local_files_only=True)
    encoded = {
        split: EncodedRows(rows, tokenizer, config["max_length"])
        for split, rows in splits.items()
    }
    source_names = FROZEN_FILES
    manifest = {
        "started_at_utc": datetime.now(timezone.utc).isoformat(),
        "experiment": config,
        "source_sha256": {name: digest(input_path(name)) for name in source_names},
        "data_sha256": {s: saved_report["splits"][s]["sha256"] for s in splits},
        "label2id": LABEL_TO_ID,
        "packages": {
            name: importlib.metadata.version(name)
            for name in [
                "torch",
                "transformers",
                "accelerate",
                "numpy",
                "huggingface-hub",
                "tokenizers",
            ]
        },
        "python": platform.python_version(),
        "platform": platform.platform(),
        "device_requested": args.device,
        "torch_threads": torch.get_num_threads(),
        "optimizer": "adamw_torch",
        "scheduler": "linear",
        "warmup_steps": 0,
        "weight_decay": 0.01,
        "classification": "single_label_argmax_no_threshold; probabilities are uncalibrated",
        "full_finetuning": True,
        "training_objective": objective,
        "test_used_for_selection": False,
        "token_lengths": {
            s: {
                "min": min(d.lengths),
                "max": max(d.lengths),
                "mean": float(np.mean(d.lengths)),
                "truncated": 0,
            }
            for s, d in encoded.items()
        },
        "evaluation_coverage": {s: saved_report["splits"][s] for s in splits},
    }
    if args.device == "cuda":
        props = torch.cuda.get_device_properties(torch.cuda.current_device())
        manifest["cuda"] = {
            "gpu_name": props.name,
            "total_memory_bytes": props.total_memory,
            "torch_cuda_version": torch.version.cuda,
            "compute_capability": list(torch.cuda.get_device_capability()),
            "matmul_allow_tf32": torch.backends.cuda.matmul.allow_tf32,
            "cudnn_allow_tf32": torch.backends.cudnn.allow_tf32,
            "nvidia_smi": subprocess.check_output(["nvidia-smi"]).decode(),
        }
    write_json(args.report_dir / "protocol.json", manifest)
    write_json(args.report_dir / "manifest.json", manifest)
    collator = DataCollatorWithPadding(tokenizer=tokenizer)
    trials = []
    specs = [(seed, lr) for seed in config["seeds"] for lr in config["learning_rates"]]
    for index, (seed, learning_rate) in enumerate(specs):
        set_seed(seed)
        directory = args.output_dir / f"trial-{index + 1}"
        directory.mkdir()
        model = AutoModelForSequenceClassification.from_pretrained(
            base,
            local_files_only=True,
            num_labels=19,
            id2label=dict(enumerate(LABELS)),
            label2id=LABEL_TO_ID,
            dtype=torch.float32,
            attn_implementation="sdpa",
            **objective["dropout"],
        )
        actual_dropout = {key: getattr(model.config, key) for key in DROPOUT_FIELDS}
        if objective["dropout"] and actual_dropout != objective["dropout"]:
            raise RuntimeError("actual dropout differs from objective")
        write_json(
            directory / "model-settings.json",
            {"dropout": actual_dropout, "objective": objective},
        )
        callback = SaveBestDevelopment(directory, index, learning_rate, tokenizer)
        training_args = TrainingArguments(
            output_dir=str(directory),
            learning_rate=learning_rate,
            per_device_train_batch_size=config["batch_size"],
            per_device_eval_batch_size=config["batch_size"],
            num_train_epochs=config["epochs"],
            weight_decay=0.01,
            warmup_steps=0,
            optim="adamw_torch",
            lr_scheduler_type="linear",
            eval_strategy="epoch",
            save_strategy="no",
            logging_strategy="epoch",
            report_to="none",
            push_to_hub=False,
            seed=seed,
            data_seed=seed,
            use_cpu=args.device == "cpu",
            dataloader_num_workers=0,
            dataloader_pin_memory=False,
            disable_tqdm=True,
            torch_compile=False,
            fp16=False,
            bf16=False,
            tf32=False if args.device == "cuda" else None,
        )
        write_json(directory / "training_args.json", training_args.to_dict())
        trainer = MeasuredTrainer(
            objective=config.get("training_objective"),
            model=model,
            args=training_args,
            train_dataset=encoded["train"],
            eval_dataset=encoded["dev"],
            processing_class=tokenizer,
            data_collator=collator,
            compute_metrics=compute_metrics,
            callbacks=[callback],
        )
        device = str(next(trainer.model.parameters()).device)
        if not device.startswith(args.device):
            raise RuntimeError("actual training device differs")
        if {str(p.dtype) for p in trainer.model.parameters()} != {"torch.float32"}:
            raise RuntimeError("float32 model parameters required")
        manifest["device_actual"] = device
        manifest["parameters"] = sum(p.numel() for p in model.parameters())
        print(
            json.dumps(
                {
                    "event": "training_started",
                    "trial": index + 1,
                    "seed": seed,
                    "learning_rate": learning_rate,
                    "device": device,
                }
            ),
            flush=True,
        )
        synchronize(args.device)
        if args.device == "cuda":
            torch.cuda.reset_peak_memory_stats()
        begin = time.perf_counter()
        outcome = trainer.train()
        synchronize(args.device)
        elapsed = time.perf_counter() - begin
        if callback.best is None:
            raise RuntimeError("no development evaluation recorded")
        trial = dict(
            callback.best,
            trial=f"trial-{index + 1}",
            train_seconds=elapsed,
            dev_evaluation_and_save_seconds=trainer.evaluation_wall_seconds,
            train_other_seconds=elapsed - sum(trainer.evaluation_wall_seconds),
        )
        if args.device == "cuda":
            trial["peak_cuda_allocated_bytes"] = torch.cuda.max_memory_allocated()
        trials.append(trial)
        write_json(directory / "train_metrics.json", outcome.metrics)
        objective_totals = {
            k: float(v) if torch.is_tensor(v) else v
            for k, v in trainer.objective_totals.items()
        }
        write_json(directory / "training-objective.json", objective_totals)
        if objective["views"] == 2 and (
            trainer.objective_totals["batches"] == 0
            or trainer.objective_totals["symmetric_kl"] <= 0
        ):
            raise RuntimeError("stochastic two-view training was not observed")
        write_json(directory / "trainer_history.json", trainer.state.log_history)
        shutil.copyfile(
            directory / "dev_history.jsonl",
            args.report_dir / f"trial-{index + 1}-dev-history.jsonl",
        )
        del trainer, model, callback
        gc.collect()
        if args.device == "cuda":
            torch.cuda.empty_cache()
    selection = select_shared_learning_rate(
        trials, config["seeds"], config["learning_rates"]
    )
    if config.get("primary_selection"):
        from evaluation import select_primary_model

        selection["primary_model"] = select_primary_model(selection)
    selection["frozen_at_utc"] = datetime.now(timezone.utc).isoformat()
    write_json(args.report_dir / "selection.json", selection)
    manifest["training_elapsed_seconds"] = time.perf_counter() - started
    manifest["training_finished_at_utc"] = datetime.now(timezone.utc).isoformat()
    manifest["selected_weight_sha256"] = {
        selected["trial"]: digest(
            args.output_dir / selected["trial"] / "best/model.safetensors"
        )
        for selected in selection["selected_models"]
    }
    manifest["selected_checkpoint_files"] = {
        selected["trial"]: {
            p.name: digest(p)
            for p in sorted((args.output_dir / selected["trial"] / "best").iterdir())
            if p.is_file()
        }
        for selected in selection["selected_models"]
    }
    write_json(args.report_dir / "manifest.json", manifest)
    if args.defer_evaluation:
        print(
            json.dumps({"event": "training_complete_evaluation_deferred"}), flush=True
        )
        return
    complete_evaluation(args, config, splits, manifest, selection)


def resume_evaluation(args, config, splits):
    manifest = json.loads((args.report_dir / "manifest.json").read_text())
    selection = json.loads((args.report_dir / "selection.json").read_text())
    if manifest.get("finished_at_utc") or (args.report_dir / "results.json").exists():
        raise ValueError("evaluation already completed")
    if not manifest.get("training_finished_at_utc") or manifest["experiment"] != config:
        raise ValueError("unfinished training or changed experiment")
    for name, expected in manifest["source_sha256"].items():
        if digest(input_path(name)) != expected:
            raise ValueError(f"input changed before evaluation: {name}")
    computed = select_shared_learning_rate(
        selection["trials"], config["seeds"], config["learning_rates"]
    )
    if any(selection[key] != value for key, value in computed.items()):
        raise ValueError("dev selection changed")
    if config.get("primary_selection"):
        from evaluation import select_primary_model

        if selection["primary_model"] != select_primary_model(computed):
            raise ValueError("primary selection changed")
    for selected in selection["selected_models"]:
        saved = args.output_dir / selected["trial"] / "best"
        if {p.name: digest(p) for p in saved.iterdir() if p.is_file()} != manifest[
            "selected_checkpoint_files"
        ][selected["trial"]]:
            raise ValueError("selected checkpoint contents changed before evaluation")
        if (
            digest(args.output_dir / selected["trial"] / "best/model.safetensors")
            != manifest["selected_weight_sha256"][selected["trial"]]
        ):
            raise ValueError("selected weight changed before evaluation")
        if (args.report_dir / f"seed-{selected['seed']}").exists():
            raise ValueError("partial evaluation exists; use a fresh run")
    if args.device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA is required; no silent CPU fallback")
    torch.set_num_threads(4)
    if args.device == "cuda":
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False
        torch.set_float32_matmul_precision("highest")
    complete_evaluation(args, config, splits, manifest, selection)


def complete_evaluation(args, config, splits, manifest, selection):
    # The comparison coordinator freezes the method before invoking this phase.
    started = time.perf_counter()
    manifest["evaluation_started_at_utc"] = datetime.now(timezone.utc).isoformat()
    results, checkpoints = {}, {}
    for selected in selection["selected_models"]:
        name = f"seed-{selected['seed']}"
        checkpoint = args.output_dir / selected["trial"] / "best"
        _, metrics = evaluate_checkpoint(
            checkpoint,
            splits,
            args.report_dir / name,
            args.output_dir / f"{name}-evaluation",
            config["batch_size"],
            config["max_length"],
            args.device,
            selected,
        )
        results[name] = metrics
        checkpoints[name] = {
            "path": f"{selected['trial']}/best",
            "sha256": digest(checkpoint / "model.safetensors"),
        }
    for name, expected in manifest["source_sha256"].items():
        if digest(input_path(name)) != expected:
            raise RuntimeError(f"input changed during training: {name}")
    validate(read_splits())
    if data_report(read_splits()) != json.loads(
        (ROOT / "data-report.json").read_text()
    ):
        raise RuntimeError("split data changed during training")
    manifest["selected_checkpoints"] = checkpoints
    manifest["evaluation_elapsed_seconds"] = time.perf_counter() - started
    manifest["elapsed_seconds"] = (
        manifest["training_elapsed_seconds"] + manifest["evaluation_elapsed_seconds"]
    )
    manifest["finished_at_utc"] = datetime.now(timezone.utc).isoformat()
    write_json(args.report_dir / "manifest.json", manifest)
    write_json(args.report_dir / "results.json", results)
    print(
        json.dumps(
            {
                "event": "finished",
                "results": {
                    n: {
                        s: {
                            k: m[k]
                            for k in [
                                "correct",
                                "n",
                                "accuracy",
                                "macro_f1",
                                "macro_f1_supported",
                                "missing_labels",
                            ]
                        }
                        for s, m in metrics.items()
                    }
                    for n, metrics in results.items()
                },
            },
            ensure_ascii=False,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
