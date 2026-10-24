"""日常の短い操作文を保存済みモデルで評価する。推論・予測検証は既存関数を共用。"""

import argparse
import hashlib
import importlib.metadata
import json
import os
import platform
from collections import Counter
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path

REPO = Path(__file__).resolve().parent
SUITE = REPO / "evaluations/daily-commands-2026-10-19"
REFERENCE = REPO / "experiments/v0.5.1"
PREVIOUS = REPO / "artifacts/fixed73-all-models-2026-10-18"


def read(path):
    return json.loads(path.read_text())


def sha(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def check(condition, message):
    if not condition:
        raise ValueError(message)


def safe_path(root, name):
    relative = Path(name)
    check(not relative.is_absolute() and ".." not in relative.parts, "unsafe path")
    return root / relative


def check_hashes(root, hashes):
    for name, expected in hashes.items():
        check(sha(safe_path(root, name)) == expected, f"changed file: {root}/{name}")


def runtime():
    # The evaluation root supplies only metadata. No training path is invoked.
    os.environ["NYAMURU_EXPERIMENT_ROOT"] = str(SUITE)
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["TOKENIZERS_PARALLELISM"] = "false"
    import torch

    import dataset
    import evaluation
    import train
    import verify_results

    check(dataset.ROOT == SUITE, "shared evaluator loaded with a different root")
    return dataset, evaluation, torch, train, verify_results


def validate_questions(rows, data):
    protocol = read(SUITE / "protocol.json")
    expected = set(protocol["labels"])
    excluded = {
        "needs_clarification",
        "needs_reasoning",
        "compound_request",
        "out_of_scope_request",
        "not_command",
    }
    check(
        expected == set(data.LABEL_TO_ID) - excluded,
        "exactly 14 operation labels required",
    )
    check(
        protocol["n"] == 112 and protocol["per_label"] == 8,
        "112 questions, eight per label required",
    )
    check(protocol["primary_model"] == "v04_seed43", "primary candidate differs")
    check(len(rows) == protocol["n"], "question count differs")
    check(len({r["id"] for r in rows}) == len(rows), "duplicate IDs")
    check(
        len({data.normalized(r["text"]) for r in rows}) == len(rows),
        "duplicate normalized questions",
    )
    check(
        Counter(r["label"] for r in rows)
        == Counter({label: protocol["per_label"] for label in expected}),
        "question labels/counts differ",
    )
    check(expected <= set(data.LABEL_TO_ID), "unknown labels")
    check({"保存して", "次のページ"} <= {r["text"] for r in rows}, "missing anchors")
    assignments = read(SUITE / "split-plan.json")["assignments"]
    check(set(assignments) == {r["id"] for r in rows}, "assignment IDs differ")
    for row in rows:
        check(0 < len(row["text"]) <= 40, f"non-short question: {row['id']}")
        check(row["source"] == "codex_synthetic", "source differs")
        check(row["tags"] == ["daily_short", "single_action"], "tags differ")
        check(assignments[row["id"]]["family"] == row["group"], "family differs")
    check(
        sha(SUITE / "source/labels.json") == sha(REFERENCE / "source/labels.json"),
        "original label definitions changed",
    )


def overlap_audit(rows, data):
    prior = {
        path.stem: data.read_rows(path)
        for path in sorted((REFERENCE / "data").glob("*.jsonl"))
    }
    check(
        set(prior)
        == {
            "train",
            "dev",
            "test",
            "legacy_v02_dev",
            "legacy_v02_test",
            "legacy_v03_dev",
            "legacy_v03_test",
        },
        "expected seven prior splits",
    )
    training = prior["train"]
    normalized_training = [(r, data.normalized(r["text"])) for r in training]
    records = []
    for row in rows:
        key = data.normalized(row["text"])
        exact = [r for r in training if r["text"] == row["text"]]
        normalized = [r for r, text in normalized_training if text == key]
        check(
            all(r["label"] == row["label"] for r in normalized),
            f"label conflict: {row['id']}",
        )
        matches = {
            split: [r["id"] for r in originals if data.normalized(r["text"]) == key]
            for split, originals in prior.items()
        }
        nearest, ratio = max(
            (
                (r, SequenceMatcher(None, key, text, autojunk=False).ratio())
                for r, text in normalized_training
            ),
            key=lambda pair: pair[1],
        )
        records.append(
            {
                "id": row["id"],
                "train_exact_ids": [r["id"] for r in exact],
                "train_normalized_ids": [r["id"] for r in normalized],
                "prior_normalized_ids": matches,
                "nearest_train": {
                    "id": nearest["id"],
                    "text": nearest["text"],
                    "label": nearest["label"],
                    "sequence_matcher_ratio": ratio,
                },
            }
        )
    return {
        "normalization": "Existing dataset.normalized: NFKC, casefold, remove punctuation/separator/symbol categories P/Z/S. No numeral or synonym conversion.",
        "limitation": "No exact/normalized match does not establish semantic novelty or independence. Nearest-text similarity is diagnostic only, never a deletion criterion.",
        "rows": records,
    }


def subset_ids(rows, overlap):
    records = overlap["rows"]
    return {
        "all": [r["id"] for r in rows],
        "train_exact": [r["id"] for r in records if r["train_exact_ids"]],
        "train_normalized_only": [
            r["id"]
            for r in records
            if r["train_normalized_ids"] and not r["train_exact_ids"]
        ],
        "not_train_normalized": [
            r["id"] for r in records if not r["train_normalized_ids"]
        ],
        "not_any_prior_normalized": [
            r["id"] for r in records if not any(r["prior_normalized_ids"].values())
        ],
    }


def make_plan(rows, data):
    original = read(PREVIOUS / "plan.json")
    hashes = dict(original["input_sha256"])
    check_hashes(REPO, hashes)
    for name, value in read(PREVIOUS / "output-sha256.json").items():
        check(
            sha(safe_path(PREVIOUS, name)) == value,
            f"original73 output changed: {name}",
        )
        hashes[str((PREVIOUS / name).relative_to(REPO))] = value
    for version in ("v0.3", "v0.4", "v0.5", "v0.5.1"):
        root = REPO / "experiments" / version
        frozen = read(root / "input-sha256.json")
        check_hashes(root, frozen)
        hashes.update(
            {
                str((root / name).relative_to(REPO)): value
                for name, value in frozen.items()
            }
        )
    frozen = read(SUITE / "input-sha256.json")
    check(
        set(frozen)
        == {
            "test.jsonl",
            "protocol.json",
            "split-plan.json",
            "source/labels.json",
            "questions.md",
            "preparation-review.json",
        },
        "suite input inventory differs",
    )
    check_hashes(SUITE, frozen)
    hashes.update(
        {str((SUITE / name).relative_to(REPO)): value for name, value in frozen.items()}
    )
    for path in (
        Path(__file__),
        SUITE / "input-sha256.json",
        PREVIOUS / "output-sha256.json",
    ):
        hashes[str(path.relative_to(REPO))] = sha(path)
    models = [m for m in original["models"] if m["group"] == "v04"]
    check([m["seed"] for m in models] == [42, 43, 44], "three baseline seeds required")
    check(
        [m["id"] for m in models] == [f"v04_seed{seed}" for seed in (42, 43, 44)],
        "model IDs differ",
    )
    for model in models:
        checkpoint = safe_path(REPO, model["checkpoint"])
        actual = {
            str(p.relative_to(checkpoint)) for p in checkpoint.rglob("*") if p.is_file()
        }
        check(actual == set(model["files_sha256"]), "checkpoint file inventory differs")
        check_hashes(checkpoint, model["files_sha256"])
    inference = {
        "device": "cpu",
        "dtype": "float32",
        "attention": "sdpa",
        "batch_size": 16,
        "max_length": 128,
        "torch_threads": 4,
        "torch_interop_threads": 1,
        "dropout": "disabled by Trainer.predict eval mode",
        "threshold": None,
        "input": "text only",
        "truncation": False,
        "training": False,
    }
    check(original["inference"] == inference, "prior inference conditions differ")
    overlap = overlap_audit(rows, data)
    return {
        "frozen_at_utc": datetime.now(timezone.utc).isoformat(),
        "protocol": read(SUITE / "protocol.json"),
        "models": models,
        "primary_model": "v04_seed43",
        "selection": "Seed43 was the candidate from the previous fixed73 comparison. Evaluate all three without reselection, threshold fitting, or training.",
        "inference": inference,
        "environment": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "packages": {
                name: importlib.metadata.version(name)
                for name in (
                    "torch",
                    "transformers",
                    "accelerate",
                    "numpy",
                    "tokenizers",
                    "safetensors",
                )
            },
        },
        "overlap": overlap,
        "subsets": subset_ids(rows, overlap),
        "input_sha256": hashes,
    }


def summarize_saved(output, plan, rows, evaluation, verifier):
    scores, predictions = {}, {}
    for model in plan["models"]:
        ident = model["id"]
        records = [
            json.loads(line)
            for line in (output / ident / "daily-predictions.jsonl")
            .read_text()
            .splitlines()
        ]
        metrics = verifier.verify_predictions(records, rows)
        verifier.close_tree(
            read(output / ident / "metrics.json")["daily"], metrics, ident
        )
        predictions[ident] = records
        subsets = {}
        for name, ids in plan["subsets"].items():
            selected = [r for r in records if r["id"] in ids]
            correct = sum(r["correct"] for r in selected)
            subsets[name] = {
                "n": len(selected),
                "correct": correct,
                "accuracy": correct / len(selected) if selected else None,
            }
        scores[ident] = {"metrics": metrics, "subsets": subsets}
    accuracy = evaluation.distribution(
        [s["metrics"]["accuracy"] for s in scores.values()]
    )
    mistakes = []
    for index, row in enumerate(rows):
        if any(not records[index]["correct"] for records in predictions.values()):
            mistakes.append(
                {
                    "id": row["id"],
                    "text": row["text"],
                    "gold": row["label"],
                    "predictions": {
                        name: records[index]["predicted"]
                        for name, records in predictions.items()
                    },
                }
            )
    return {
        "status": "verified",
        "n": len(rows),
        "checked_predictions": len(rows) * len(scores),
        "primary_model": plan["primary_model"],
        "models": scores,
        "mean_accuracy": accuracy,
        "mistakes_any_seed": mistakes,
        "interpretation": plan["protocol"]["limitations"],
    }


def markdown(result, plan):
    lines = [
        "# 短い日常操作の分類評価",
        "",
        "14操作分類×8問の合成テキスト。重みと旧73問を保持し、既存評価関数でCPU推論。実音声・引数抽出・アプリ動作は評価していない。",
        "",
        "主評価候補は前回比較で選ばれたseed43。今回の結果から選び直さない。",
        "",
        "| モデル | 全112問 | 学習原文一致 | 学習正規化のみ一致 | 学習正規化一致なし | 先行7分割の正規化一致なし |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for name, score in result["models"].items():
        cells = []
        for subset in score["subsets"].values():
            cells.append(
                f"{subset['correct']}/{subset['n']} ({subset['accuracy']:.2%})"
                if subset["n"]
                else "対象なし"
            )
        lines.append(f"| {name} | " + " | ".join(cells) + " |")
    lines += [
        "",
        f"3seed平均正解率：{result['mean_accuracy']['mean']:.2%}。同じ112問の反復で、336個の独立した発話ではない。",
        "",
        "学習例との一致がない文にも近い言い換えがあり得る。ユーザーの実際の使用頻度を再現した標本ではない。旧73問は別の難しさを測る評価として残す。",
        "",
        "## いずれかのseedで間違えた問題",
        "",
        "| ID | 入力原文 | 正解分類 | seed42 | seed43 | seed44 |",
        "|---|---|---|---|---|---|",
    ]
    for row in result["mistakes_any_seed"]:
        text = row["text"].replace("|", "\\|")
        lines.append(
            f"| {row['id']} | {text} | {row['gold']} | "
            + " | ".join(row["predictions"].values())
            + " |"
        )
    if not result["mistakes_any_seed"]:
        lines.append("| — | 全seedで全問正解 | — | — | — | — |")
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("run", "verify"))
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    data, evaluation, torch, train, verifier = runtime()
    rows = data.read_rows(SUITE / "test.jsonl")
    validate_questions(rows, data)
    if args.command == "run":
        check(not output.exists(), "use a new output directory")
        plan = make_plan(rows, data)
        output.mkdir(parents=True)
        train.write_json(output / "plan.json", plan)
        (output / "test.jsonl").write_bytes((SUITE / "test.jsonl").read_bytes())
        torch.set_num_threads(4)
        torch.set_num_interop_threads(1)
        torch.set_float32_matmul_precision("highest")
        torch.manual_seed(42)
        for model in plan["models"]:
            print(json.dumps({"event": "evaluate", "model": model["id"]}), flush=True)
            train.evaluate_checkpoint(
                REPO / model["checkpoint"],
                {"daily": rows},
                output / model["id"],
                output / "work" / model["id"],
                16,
                128,
                "cpu",
            )
        check_hashes(REPO, plan["input_sha256"])
        result = summarize_saved(output, plan, rows, evaluation, verifier)
        train.write_json(output / "summary.json", result)
        (output / "report.md").write_text(markdown(result, plan))
        train.write_json(
            output / "output-sha256.json",
            {
                str(p.relative_to(output)): sha(p)
                for p in sorted(output.rglob("*"))
                if p.is_file()
            },
        )
    else:
        plan = read(output / "plan.json")
        expected_plan = make_plan(rows, data)
        for key in (
            "protocol",
            "models",
            "primary_model",
            "selection",
            "inference",
            "overlap",
            "subsets",
            "input_sha256",
        ):
            check(plan[key] == expected_plan[key], f"frozen plan differs: {key}")
        output_hashes = read(output / "output-sha256.json")
        actual_files = {
            str(p.relative_to(output)) for p in output.rglob("*") if p.is_file()
        } - {"output-sha256.json"}
        check(set(output_hashes) == actual_files, "output file inventory differs")
        check_hashes(output, output_hashes)
        check(
            (output / "test.jsonl").read_bytes() == (SUITE / "test.jsonl").read_bytes(),
            "test changed",
        )
        verifier.close_tree(plan["overlap"], overlap_audit(rows, data))
        check(
            plan["subsets"] == subset_ids(rows, plan["overlap"]),
            "overlap subsets differ",
        )
        result = summarize_saved(output, plan, rows, evaluation, verifier)
        verifier.close_tree(read(output / "summary.json"), result)
        check(
            (output / "report.md").read_text() == markdown(result, plan),
            "report differs",
        )
    print(
        json.dumps(
            {
                "status": result["status"],
                "checked_predictions": result["checked_predictions"],
                "mean_accuracy": result["mean_accuracy"]["mean"],
            }
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
