"""保存済み全モデルを同じ73問で再評価する。推論は既存evaluate_checkpointを使う。"""

# 固定した実験ROOTとoffline設定を既存モジュールのimport前に適用。

import argparse
import hashlib
import importlib.metadata
import json
import os
import platform
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent
REFERENCE = REPO / "experiments/v0.5.1"
os.environ["NYAMURU_EXPERIMENT_ROOT"] = str(REFERENCE)
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"

import torch

from dataset import LABEL_TO_ID, read_rows
from evaluation import distribution
from train import evaluate_checkpoint, write_json
from verify_results import close_tree, verify_predictions

GROUPS = {
    "v02": "artifacts/v02",
    "v03": "artifacts/v03-colab-2026-10-18",
    "v04": "artifacts/v04-colab-2026-10-18",
    "v051_baseline": "artifacts/v051-colab-2026-10-18/runs/baseline",
    "v051_dropout_2view": "artifacts/v051-colab-2026-10-18/runs/dropout_2view",
    "v051_rdrop": "artifacts/v051-colab-2026-10-18/runs/rdrop",
}
GROUP_LABELS = {
    "v02": "v0.2",
    "v03": "v0.3",
    "v04": "v0.4",
    "v051_baseline": "v0.5.1 通常学習",
    "v051_dropout_2view": "v0.5.1 二視点dropout",
    "v051_rdrop": "v0.5.1 R-Drop",
}


def read(path):
    return json.loads(Path(path).read_text())


def sha(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def check(condition, message):
    if not condition:
        raise ValueError(message)


def inventory():
    """モデル・評価データ・既存コードを実行前に固定する。"""
    frozen = read(REFERENCE / "input-sha256.json")
    for name, expected in frozen.items():
        check(sha(REFERENCE / name) == expected, f"frozen input changed: {name}")
    for name in ("train.py", "dataset.py", "evaluation.py", "verify_results.py"):
        check(sha(REPO / name) == frozen[name], f"shared evaluator differs: {name}")
    hashes = {
        str((REFERENCE / name).relative_to(REPO)): h for name, h in frozen.items()
    }
    hashes.update(
        {
            name: sha(REPO / name)
            for name in (
                "train.py",
                "dataset.py",
                "evaluation.py",
                "verify_results.py",
                "compare_saved_models.py",
            )
        }
    )
    models, primaries = [], {}
    for group, relative in GROUPS.items():
        root = REPO / relative
        selection = read(root / "reports/selection.json")
        manifest = read(root / "reports/manifest.json")
        artifact_root = (
            root
            if (root / "artifact-sha256.json").exists()
            else REPO / "artifacts/v051-colab-2026-10-18"
        )
        artifact_hashes = read(artifact_root / "artifact-sha256.json")
        hashes[str((artifact_root / "artifact-sha256.json").relative_to(REPO))] = sha(
            artifact_root / "artifact-sha256.json"
        )
        primaries[group] = selection.get("primary_model")
        check(
            {x["seed"] for x in selection["selected_models"]} == {42, 43, 44},
            "three selected seeds required",
        )
        for name in (
            "reports/selection.json",
            "reports/manifest.json",
            "experiment.json",
        ):
            key = str((root / name).relative_to(artifact_root))
            check(
                sha(root / name) == artifact_hashes[key],
                f"received metadata changed: {relative}/{name}",
            )
            hashes[str((root / name).relative_to(REPO))] = artifact_hashes[key]
        for selected in sorted(selection["selected_models"], key=lambda x: x["seed"]):
            seed = selected["seed"]
            checkpoint = root / "weights" / selected["trial"] / "best"
            files = {}
            for path in sorted(checkpoint.iterdir()):
                if path.is_file():
                    key = str(path.relative_to(artifact_root))
                    value = sha(path)
                    check(value == artifact_hashes[key], f"checkpoint changed: {path}")
                    files[path.name] = value
                    hashes[str(path.relative_to(REPO))] = value
            check(
                files["model.safetensors"]
                == manifest["selected_checkpoints"][f"seed-{seed}"]["sha256"],
                "selected weight differs",
            )
            config = read(checkpoint / "config.json")
            check(config["label2id"] == LABEL_TO_ID, "label mapping differs")
            old_predictions = root / f"reports/seed-{seed}/test-predictions.jsonl"
            old_key = str(old_predictions.relative_to(artifact_root))
            check(
                sha(old_predictions) == artifact_hashes[old_key],
                "original predictions changed",
            )
            hashes[str(old_predictions.relative_to(REPO))] = artifact_hashes[old_key]
            models.append(
                {
                    "id": f"{group}_seed{seed}",
                    "group": group,
                    "seed": seed,
                    "checkpoint": str(checkpoint.relative_to(REPO)),
                    "files_sha256": files,
                    "original_selection": selected,
                    "historical_primary": primaries[group] is not None
                    and primaries[group]["seed"] == seed,
                }
            )
    test = read_rows(REFERENCE / "data/test.jsonl")
    check(len(test) == 73 and len({x["id"] for x in test}) == 73, "fixed73 required")
    check({x["label"] for x in test} == set(LABEL_TO_ID), "all19 labels required")
    return {
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "test": "experiments/v0.5.1/data/test.jsonl",
        "n": len(test),
        "test_sha256": sha(REFERENCE / "data/test.jsonl"),
        "models": models,
        "historical_primaries": primaries,
        "input_sha256": hashes,
        "inference": {
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
        },
        "environment": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "packages": {
                name: importlib.metadata.version(name)
                for name in [
                    "torch",
                    "transformers",
                    "accelerate",
                    "numpy",
                    "tokenizers",
                    "safetensors",
                ]
            },
        },
        "ranking": "Retrospective fixed73 comparison: group mean accuracy descending, then mean macro F1; ties remain ties. Report single checkpoints separately and retain historical dev-selected primaries.",
        "limitation": "Previously inspected synthetic regression questions, not a fresh holdout. Ranking on these questions is not independent evidence of future accuracy.",
    }


def assert_inputs_unchanged(plan):
    for name, expected in plan["input_sha256"].items():
        check(sha(REPO / name) == expected, f"input changed: {name}")


def pair(before, after):
    check(
        [(r["id"], r["gold"]) for r in before] == [(r["id"], r["gold"]) for r in after],
        "paired examples differ",
    )
    return {
        "repaired": [
            b["id"] for a, b in zip(before, after) if not a["correct"] and b["correct"]
        ],
        "regressed": [
            b["id"] for a, b in zip(before, after) if a["correct"] and not b["correct"]
        ],
    }


def summarize_saved(output, plan):
    originals = read_rows(REFERENCE / "data/test.jsonl")
    results, predictions, groups, parity = {}, {}, {}, {}
    for model in plan["models"]:
        model_id = model["id"]
        rows = read_rows(output / model_id / "test-predictions.jsonl")
        score = verify_predictions(rows, originals)
        close_tree(read(output / model_id / "metrics.json")["test"], score, model_id)
        results[model_id] = score
        predictions[model_id] = rows
        old_path = (
            REPO
            / GROUPS[model["group"]]
            / f"reports/seed-{model['seed']}/test-predictions.jsonl"
        )
        old_rows = read_rows(old_path)
        if [(r["id"], r["gold"]) for r in old_rows] == [
            (r["id"], r["gold"]) for r in rows
        ]:
            parity[model_id] = {
                "prediction_disagreements": [
                    new["id"]
                    for old, new in zip(old_rows, rows)
                    if old["predicted"] != new["predicted"]
                ],
                "max_probability_absolute_difference": max(
                    abs(old["probabilities"][label] - new["probabilities"][label])
                    for old, new in zip(old_rows, rows)
                    for label in LABEL_TO_ID
                ),
            }
    for group in GROUPS:
        ids = [m["id"] for m in plan["models"] if m["group"] == group]
        scores = [results[i] for i in ids]
        historical = [
            m["id"]
            for m in plan["models"]
            if m["group"] == group and m["historical_primary"]
        ]
        groups[group] = {
            "model_ids": ids,
            "historical_primary": historical[0] if historical else None,
            "accuracy": distribution([s["accuracy"] for s in scores]),
            "macro_f1": distribution([s["macro_f1"] for s in scores]),
            "correct_by_seed": [s["correct"] for s in scores],
        }
    ordering = sorted(
        groups,
        key=lambda g: (-groups[g]["accuracy"]["mean"], -groups[g]["macro_f1"]["mean"]),
    )
    best_key = (
        groups[ordering[0]]["accuracy"]["mean"],
        groups[ordering[0]]["macro_f1"]["mean"],
    )
    top_groups = [
        g
        for g in ordering
        if (groups[g]["accuracy"]["mean"], groups[g]["macro_f1"]["mean"]) == best_key
    ]
    best_model_key = max((v["accuracy"], v["macro_f1"]) for v in results.values())
    best_models = [
        k
        for k, v in results.items()
        if (v["accuracy"], v["macro_f1"]) == best_model_key
    ]
    return {
        "status": "verified",
        "n": len(originals),
        "model_count": len(results),
        "unique_weight_count": len(
            {m["files_sha256"]["model.safetensors"] for m in plan["models"]}
        ),
        "checked_predictions": len(results) * len(originals),
        "groups": groups,
        "models": results,
        "group_order": ordering,
        "top_groups_accuracy_then_f1": top_groups,
        "top_checkpoints_accuracy_then_f1": best_models,
        "paired_with_v04_same_seed": {
            m["id"]: pair(predictions[f"v04_seed{m['seed']}"], predictions[m["id"]])
            for m in plan["models"]
        },
        "original_cuda_vs_common_cpu": parity,
        "baseline_alias_predictions_identical": all(
            predictions[f"v04_seed{s}"] == predictions[f"v051_baseline_seed{s}"]
            for s in [42, 43, 44]
        ),
        "interpretation": plan["limitation"],
    }


def markdown(result, plan):
    lines = [
        "# 固定73問による過去モデルの統一比較",
        "",
        "保存済みモデルを再学習せず、同じtext・CPU float32・SDPA・batch16で再推論。全モデルの設定と入力を実行前に固定。",
        "",
        "73問は既知の合成回帰評価。この順位は当該73問での比較であり、未使用発話での精度証明ではない。",
        "",
        "## 3seed平均",
        "",
        "| モデル群 | seed42 / 43 / 44 正解数（各73問） | 平均正解率 | 平均Macro F1 |",
        "|---|---:|---:|---:|",
    ]
    for name in result["group_order"]:
        g = result["groups"][name]
        lines.append(
            f"| {GROUP_LABELS[name]} | {' / '.join(map(str, g['correct_by_seed']))} | {g['accuracy']['mean']:.2%} | {g['macro_f1']['mean']:.4f} |"
        )
    lines += [
        "",
        "## 保存済みモデル全件",
        "",
        "| モデル | 当時devで主評価に選択 | 正解数 | 正解率 | Macro F1 | 単一→複数 | 複数→単一 |",
        "|---|---|---:|---:|---:|---:|---:|",
    ]
    for model in plan["models"]:
        s = result["models"][model["id"]]
        flag = (
            "はい"
            if model["historical_primary"]
            else ("当時の指定なし" if model["group"] == "v02" else "—")
        )
        lines.append(
            f"| {model['id']} | {flag} | {s['correct']}/73 | {s['accuracy']:.2%} | {s['macro_f1']:.4f} | {s['single_dispatch_to_compound']['count']}/49 | {s['compound_to_single_dispatch']['count']}/4 |"
        )
    lines += [
        "",
        "v0.4とv0.5.1通常学習は同一の重みで、統一条件での全予測も一致する。18件の評価対象は15種類の重みからなる。v0.2には当時の主評価seedの指定がないため、後から事前選択扱いにしない。",
        "",
        "3seedは同じ73問の反復であり、219問の独立評価ではない。1問の差は約1.37ポイント。順位は正解率、同率ならMacro F1の順で記述し、同値は同順位として扱う。",
        "",
        "入力・モデルのハッシュ、パッケージ・推論設定はplan.json、全指標と同seedの改善・悪化IDはsummary.json、全確率・誤分類原文は各モデルのファイルに保存。",
        "",
    ]
    return "\n".join(lines)


def run(output):
    check(
        not output.exists(), "use a new output directory; never overwrite a comparison"
    )
    plan = inventory()
    torch.set_num_threads(4)
    torch.set_num_interop_threads(1)
    torch.set_float32_matmul_precision("highest")
    torch.manual_seed(42)
    output.mkdir(parents=True)
    write_json(output / "plan.json", plan)
    (output / "test.jsonl").write_bytes((REFERENCE / "data/test.jsonl").read_bytes())
    test = read_rows(REFERENCE / "data/test.jsonl")
    for model in plan["models"]:
        print(json.dumps({"event": "evaluate", "model": model["id"]}), flush=True)
        _, metrics = evaluate_checkpoint(
            REPO / model["checkpoint"],
            {"test": test},
            output / model["id"],
            output / "work" / model["id"],
            16,
            128,
            "cpu",
        )
        score = metrics["test"]
        print(
            json.dumps(
                {
                    "event": "evaluated",
                    "model": model["id"],
                    "correct": score["correct"],
                    "n": score["n"],
                    "macro_f1": score["macro_f1"],
                }
            ),
            flush=True,
        )
    assert_inputs_unchanged(plan)
    result = summarize_saved(output, plan)
    check(
        result["baseline_alias_predictions_identical"],
        "same baseline weights produced different predictions",
    )
    write_json(output / "summary.json", result)
    (output / "comparison.md").write_text(markdown(result, plan))
    write_json(
        output / "output-sha256.json",
        {
            str(p.relative_to(output)): sha(p)
            for p in sorted(output.rglob("*"))
            if p.is_file()
        },
    )
    print(
        json.dumps(
            {
                "status": result["status"],
                "checked_predictions": result["checked_predictions"],
                "top_groups": result["top_groups_accuracy_then_f1"],
                "top_models": result["top_checkpoints_accuracy_then_f1"],
            }
        ),
        flush=True,
    )


def verify(output):
    plan = read(output / "plan.json")
    assert_inputs_unchanged(plan)
    check(
        (output / "test.jsonl").read_bytes()
        == (REFERENCE / "data/test.jsonl").read_bytes(),
        "test changed",
    )
    for name, expected in read(output / "output-sha256.json").items():
        path = Path(name)
        check(not path.is_absolute() and ".." not in path.parts, "unsafe output path")
        check(sha(output / path) == expected, f"output changed: {name}")
    result = summarize_saved(output, plan)
    close_tree(read(output / "summary.json"), result)
    check(
        (output / "comparison.md").read_text() == markdown(result, plan),
        "comparison report differs",
    )
    print(
        json.dumps(
            {
                "status": result["status"],
                "checked_predictions": result["checked_predictions"],
            }
        )
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("run", "verify"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "run":
        run(args.output.resolve())
    else:
        verify(args.output.resolve())


if __name__ == "__main__":
    main()
