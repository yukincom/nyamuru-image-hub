"""共通train.pyの条件別実行を調整する。手法選択は全条件のdev確定後、test前。"""

import argparse
import copy
import hashlib
import json
import os
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from dataset import FROZEN_FILES, ROOT, SPLITS, input_path
from evaluation import (
    distribution,
    select_primary_model,
    select_shared_learning_rate,
    selection_key,
)
from verify_results import check, close_tree, read_json, verify_training_contract


def json_bytes(value):
    return (
        json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    ).encode()


def write_json(path, value):
    Path(path).write_bytes(json_bytes(value))


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read_plan():
    plan = read_json(ROOT / "comparison-plan.json")
    names = [row["id"] for row in plan["conditions"]]
    check(
        names == ["baseline", "dropout_2view", "rdrop"], "prespecified methods differ"
    )
    check(
        plan["selection_split"] == "dev"
        and plan["independent_acceptance_eligible"] is False,
        "comparison selection or evaluation role differs",
    )
    return plan


def condition_config(condition):
    config = copy.deepcopy(read_json(ROOT / "experiment.json"))
    config["name"] += ":" + condition["id"]
    config["method_id"] = condition["id"]
    config["training_objective"] = condition["training_objective"]
    return config


def expected_inputs(condition):
    result = {name: input_path(name).read_bytes() for name in FROZEN_FILES}
    result["experiment.json"] = json_bytes(condition_config(condition))
    return result


def check_input_files(root, expected):
    hashes = {
        name: hashlib.sha256(value).hexdigest() for name, value in expected.items()
    }
    check(read_json(root / "input-sha256.json") == hashes, "input manifest differs")
    for name, expected_hash in hashes.items():
        check(sha(root / name) == expected_hash, f"input changed: {root.name}/{name}")
    return hashes


def prepare_condition(root, condition):
    root.mkdir(parents=True, exist_ok=False)
    expected = expected_inputs(condition)
    for name, data in expected.items():
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    write_json(
        root / "input-sha256.json",
        {name: hashlib.sha256(value).hexdigest() for name, value in expected.items()},
    )
    for name in ("setup.json", "pip-freeze.txt"):
        (root / name).write_bytes((ROOT / name).read_bytes())


def run_child(root, arguments, log_name):
    command = [sys.executable, "-u", str(ROOT / arguments[0]), *arguments[1:]]
    write_json(
        root
        / ("command.json" if log_name == "training.log" else "evaluation-command.json"),
        command,
    )
    env = dict(os.environ, NYAMURU_EXPERIMENT_ROOT=str(root))
    # All conditions share the same downloaded immutable pretrained snapshot.
    env["NYAMURU_HF_CACHE"] = str(ROOT / "hf-cache")
    with (root / log_name).open("w") as log:
        process = subprocess.Popen(
            command,
            cwd=root,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        for line in process.stdout:
            log.write(line)
            log.flush()
            if '"event"' in line or "Error" in line or "Traceback" in line:
                print(f"[{root.name}] {line}", end="", flush=True)
        if process.wait():
            raise RuntimeError(f"{root.name}: failed; see {log_name}")


def replay_selection(root, condition):
    hashes = check_input_files(root, expected_inputs(condition))
    config = condition_config(condition)
    manifest = read_json(root / "reports/manifest.json")
    check(
        manifest["experiment"] == config and manifest["source_sha256"] == hashes,
        "condition manifest differs",
    )
    expected_data = {name: sha(ROOT / "data" / f"{name}.jsonl") for name in SPLITS}
    check(
        manifest["data_sha256"] == expected_data, "conditions do not use identical data"
    )
    selection = read_json(root / "reports/selection.json")
    computed = select_shared_learning_rate(
        selection["trials"], config["seeds"], config["learning_rates"]
    )
    for key, value in computed.items():
        close_tree(selection[key], value, "dev selection." + key)
    close_tree(
        selection["primary_model"], select_primary_model(computed), "primary selection"
    )
    for index, trial in enumerate(selection["trials"], 1):
        check(
            trial["trial"] == f"trial-{index}" and trial["trial_index"] == index - 1,
            "trial path or order differs",
        )
        rows = [
            json.loads(line)
            for line in (root / f"reports/trial-{index}-dev-history.jsonl")
            .read_text()
            .splitlines()
        ]
        check(
            [r["epoch"] for r in rows] == list(range(1, config["epochs"] + 1)),
            "dev epochs differ",
        )
        for row in rows:
            check(
                row["seed"] == trial["seed"]
                and row["learning_rate"] == trial["learning_rate"]
                and row["trial_index"] == index - 1,
                "dev history identity differs",
            )
        close_tree(trial, max(rows, key=selection_key), "best dev epoch")
    verify_training_contract(root, config, manifest, selection)
    for trial in computed["selected_models"]:
        checkpoint = root / "weights" / trial["trial"] / "best"
        check(
            {p.name: sha(p) for p in checkpoint.iterdir() if p.is_file()}
            == manifest["selected_checkpoint_files"][trial["trial"]],
            "checkpoint contents differ",
        )
        check(
            sha(root / "weights" / trial["trial"] / "best/model.safetensors")
            == manifest["selected_weight_sha256"][trial["trial"]],
            "selected weight differs",
        )
    return selection


def choose_method(selections, plan):
    """Only dev summaries enter this function; test metrics cannot select a method."""
    check(
        set(selections) == {c["id"] for c in plan["conditions"]}, "method set differs"
    )
    candidates = []
    for index, condition in enumerate(plan["conditions"]):
        selected = selections[condition["id"]]
        score = next(
            row
            for row in selected["learning_rate_means"]
            if row["learning_rate"] == selected["selected_learning_rate"]
        )
        candidates.append(dict(score, method=condition["id"], trial_index=index))
    best = max(candidates, key=selection_key)
    return {
        "selection_split": "dev",
        "method_scores": candidates,
        "selected_method": best["method"],
        "primary_model": selections[best["method"]]["primary_model"],
        "independent_acceptance_eligible": False,
    }


def freeze_comparison(root, plan, selections):
    for condition in plan["conditions"]:
        run = root / "runs" / condition["id"]
        manifest = read_json(run / "reports/manifest.json")
        check(
            "evaluation_started_at_utc" not in manifest
            and "finished_at_utc" not in manifest,
            "method must be frozen before evaluation",
        )
        check(
            not any((run / "reports").glob("seed-*")),
            "prediction exists before method freeze",
        )
    selected = choose_method(selections, plan)
    selected["condition_selection_sha256"] = {
        c["id"]: sha(root / "runs" / c["id"] / "reports/selection.json")
        for c in plan["conditions"]
    }
    selected["frozen_at_utc"] = datetime.now(timezone.utc).isoformat()
    path = root / "comparison-selection.json"
    check(not path.exists(), "comparison selection already exists")
    write_json(path, selected)
    return selected


def summarize_comparison(root, plan, selection):
    seeds = read_json(ROOT / "experiment.json")["seeds"]
    methods = {}
    baseline = {
        s: read_json(root / "runs/baseline/reports" / f"seed-{s}/metrics.json")
        for s in seeds
    }
    for condition in plan["conditions"]:
        name = condition["id"]
        scores = {
            s: read_json(root / "runs" / name / "reports" / f"seed-{s}/metrics.json")
            for s in seeds
        }
        paired = {}
        for seed in seeds:
            paired[str(seed)] = {}
            for split in SPLITS:

                def predictions(method, seed=seed, split=split):
                    return [
                        json.loads(line)
                        for line in (
                            root
                            / "runs"
                            / method
                            / "reports"
                            / f"seed-{seed}/{split}-predictions.jsonl"
                        )
                        .read_text()
                        .splitlines()
                    ]

                old, new = predictions("baseline"), predictions(name)
                check(
                    [(r["id"], r["text"], r["gold"]) for r in old]
                    == [(r["id"], r["text"], r["gold"]) for r in new],
                    "paired rows differ",
                )
                paired[str(seed)][split] = {
                    "repaired": [
                        n["id"]
                        for o, n in zip(old, new)
                        if not o["correct"] and n["correct"]
                    ],
                    "regressed": [
                        n["id"]
                        for o, n in zip(old, new)
                        if o["correct"] and not n["correct"]
                    ],
                    "accuracy_delta": scores[seed][split]["accuracy"]
                    - baseline[seed][split]["accuracy"],
                }
        methods[name] = {
            "seed_metrics": {str(seed): value for seed, value in scores.items()},
            "aggregate": {
                split: {
                    metric: distribution([scores[s][split][metric] for s in seeds])
                    for metric in ("accuracy", "macro_f1")
                }
                for split in SPLITS
            },
            "paired_with_baseline": paired,
        }
    return {
        "status": "verified",
        "selection": selection,
        "methods": methods,
        "checked_predictions": len(plan["conditions"])
        * len(seeds)
        * sum(
            value["n"]
            for value in read_json(ROOT / "data-report.json")["splits"].values()
        ),
        "independent_acceptance": "pending_unseen_evaluation",
        "limitation": "Same previously inspected synthetic regression examples. No unseen accuracy or production adoption claim.",
    }


def markdown(summary):
    lines = [
        "# v0.5 学習方法の統制比較",
        "",
        "同一データ・3 seed。手法・学習率・epochはdevだけで選択。testは閲覧済みの回帰確認。",
        f"devによる選択: {summary['selection']['selected_method']} / {summary['selection']['primary_model']['name']}",
        "",
        "| 条件 | seed | 回帰test正解 | 正解率 | Macro F1 |",
        "|---|---:|---:|---:|---:|",
    ]
    for name, result in summary["methods"].items():
        for seed, splits in result["seed_metrics"].items():
            score = splits["test"]
            lines.append(
                f"| {name} | {seed} | {score['correct']}/{score['n']} | {score['accuracy']:.2%} | {score['macro_f1']:.4f} |"
            )
    lines += [
        "",
        "単一→複数、複数→単一、非命令→操作、情報不足・対応外の誤分類、および同一例での修復・回帰はcomparison-summary.jsonに全件保存。",
        "",
        "新たな95%達成判定は行わない。独立した未使用発話での評価が必要。",
    ]
    return "\n".join(lines) + "\n"


def verify(root, run_verifiers=True):
    root = Path(root)
    plan = read_plan()
    if (root / "artifact-sha256.json").exists():
        hashes = read_json(root / "artifact-sha256.json")
        check(
            set(FROZEN_FILES)
            | {
                "input-sha256.json",
                "comparison-selection.json",
                "comparison-summary.json",
                "comparison-report.md",
            }
            <= set(hashes),
            "artifact manifest missing required root files",
        )
        for name, expected in hashes.items():
            check(
                not Path(name).is_absolute() and ".." not in Path(name).parts,
                "unsafe artifact path",
            )
            check(sha(root / name) == expected, "artifact hash differs: " + name)
    check_input_files(
        root, {name: input_path(name).read_bytes() for name in FROZEN_FILES}
    )
    selections = {
        c["id"]: replay_selection(root / "runs" / c["id"], c)
        for c in plan["conditions"]
    }
    selected = read_json(root / "comparison-selection.json")
    close_tree(selected, choose_method(selections, plan), "method selection")
    frozen = datetime.fromisoformat(selected["frozen_at_utc"])
    for c in plan["conditions"]:
        run = root / "runs" / c["id"]
        manifest = read_json(run / "reports/manifest.json")
        check(
            selected["condition_selection_sha256"][c["id"]]
            == sha(run / "reports/selection.json"),
            "condition selection changed",
        )
        check(
            datetime.fromisoformat(manifest["training_finished_at_utc"])
            <= frozen
            <= datetime.fromisoformat(manifest["evaluation_started_at_utc"]),
            "method freeze order differs",
        )
        if run_verifiers:
            subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "verify_results.py"),
                    str(run),
                    "--read-only",
                ],
                check=True,
                env=dict(os.environ, NYAMURU_EXPERIMENT_ROOT=str(run)),
            )
    summary = summarize_comparison(root, plan, selected)
    if (root / "comparison-summary.json").exists():
        close_tree(
            read_json(root / "comparison-summary.json"), summary, "comparison summary"
        )
    return summary


def run(device):
    plan = read_plan()
    check_input_files(
        ROOT, {name: input_path(name).read_bytes() for name in FROZEN_FILES}
    )
    check(not (ROOT / "runs").exists(), "use a fresh runtime; runs already exist")
    selections = {}
    for c in plan["conditions"]:
        run_root = ROOT / "runs" / c["id"]
        prepare_condition(run_root, c)
        run_child(
            run_root,
            ["train.py", "--device", device, "--defer-evaluation"],
            "training.log",
        )
        selections[c["id"]] = replay_selection(run_root, c)
    freeze_comparison(ROOT, plan, selections)
    for c in plan["conditions"]:
        run_child(
            ROOT / "runs" / c["id"],
            ["train.py", "--device", device, "--evaluate-selected"],
            "evaluation.log",
        )
        subprocess.run(
            [sys.executable, str(ROOT / "verify_results.py")],
            check=True,
            env=dict(os.environ, NYAMURU_EXPERIMENT_ROOT=str(ROOT / "runs" / c["id"])),
        )
    summary = verify(ROOT)
    write_json(ROOT / "comparison-summary.json", summary)
    (ROOT / "comparison-report.md").write_text(markdown(summary))
    print(
        json.dumps(
            {
                "event": "comparison_verified",
                "checked_predictions": summary["checked_predictions"],
            }
        ),
        flush=True,
    )


def pack(destination):
    check(not destination.exists(), "result archive already exists")
    verify(ROOT)
    paths = {ROOT / name for name in FROZEN_FILES}
    paths |= {
        ROOT / name
        for name in (
            "input-sha256.json",
            "setup.json",
            "pip-freeze.txt",
            "comparison-selection.json",
            "comparison-summary.json",
            "comparison-report.md",
        )
    }
    for c in read_plan()["conditions"]:
        run = ROOT / "runs" / c["id"]
        manifest = read_json(run / "reports/manifest.json")
        selected = [
            run / "weights" / item["path"]
            for item in manifest["selected_checkpoints"].values()
        ]
        paths |= {run / name for name in FROZEN_FILES}
        paths |= {
            run / name
            for name in (
                "input-sha256.json",
                "setup.json",
                "pip-freeze.txt",
                "command.json",
                "evaluation-command.json",
                "training.log",
                "evaluation.log",
            )
        }
        paths |= {p for p in (run / "reports").rglob("*") if p.is_file()}
        paths |= {
            p
            for p in (run / "weights").rglob("*")
            if p.is_file()
            and (
                p.suffix in (".json", ".jsonl")
                or any(p.is_relative_to(s) for s in selected)
            )
        }
    hashes = {str(p.relative_to(ROOT)): sha(p) for p in sorted(paths)}
    write_json(ROOT / "artifact-sha256.json", hashes)
    paths.add(ROOT / "artifact-sha256.json")
    with zipfile.ZipFile(
        destination, "w", zipfile.ZIP_DEFLATED, compresslevel=2
    ) as archive:
        for path in sorted(paths):
            archive.write(path, path.relative_to(ROOT))
    print(
        json.dumps(
            {
                "archive": str(destination),
                "bytes": destination.stat().st_size,
                "sha256": sha(destination),
            }
        )
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("run", "verify", "pack"))
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--device", choices=("cuda", "cpu"), default="cuda")
    args = parser.parse_args()
    if args.command == "run":
        run(args.device)
    elif args.command == "pack":
        check(args.output is not None, "--output required")
        pack(args.output)
    else:
        result = verify(args.root)
        print(
            json.dumps(
                {
                    "status": result["status"],
                    "checked_predictions": result["checked_predictions"],
                }
            )
        )


if __name__ == "__main__":
    main()
