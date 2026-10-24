"""保存済み成果物のハッシュ、全予測、dev選択、19ラベルを照合する。学習しない。"""

import argparse
import hashlib
import json
import math
from pathlib import Path

from safetensors import safe_open

from dataset import (
    FROZEN_FILES,
    LABEL_TO_ID,
    ROOT,
    SPLITS,
    data_report,
    input_path,
    read_splits,
    validate,
)
from evaluation import (
    LABELS,
    distribution,
    select_shared_learning_rate,
    selection_key,
    summarize,
)


def read_json(path):
    return json.loads(Path(path).read_text())


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def check(condition, message):
    if not condition:
        raise ValueError(message)


def close_tree(actual, expected, path="metrics"):
    if isinstance(expected, dict):
        check(
            isinstance(actual, dict) and set(expected) <= set(actual),
            f"{path}: keys differ",
        )
        for key in expected:
            close_tree(actual[key], expected[key], path + "." + key)
    elif isinstance(expected, list):
        check(
            isinstance(actual, list) and len(actual) == len(expected),
            f"{path}: list differs",
        )
        for index, value in enumerate(expected):
            close_tree(actual[index], value, f"{path}[{index}]")
    elif isinstance(expected, float):
        check(
            isinstance(actual, (int, float))
            and math.isfinite(actual)
            and abs(actual - expected) < 1e-7,
            f"{path}: value differs",
        )
    else:
        check(actual == expected, f"{path}: value differs")


def verify_predictions(rows, originals):
    check(len(rows) == len(originals), "prediction count differs")
    assignments = read_json(ROOT / "split-plan.json")["assignments"]
    for row, original in zip(rows, originals, strict=True):
        for field in ["id", "text", "tags", "source", "group"]:
            check(row[field] == original[field], f"{original['id']}: {field} differs")
        check(row["gold"] == original["label"], "gold changed")
        check(
            row["family"] == assignments[row["id"]]["family"],
            "evaluation family differs",
        )
        probabilities = row["probabilities"]
        check(set(probabilities) == set(LABELS), "probability labels differ")
        check(
            all(
                isinstance(p, (int, float)) and math.isfinite(p) and 0 <= p <= 1
                for p in probabilities.values()
            ),
            "invalid probability",
        )
        check(
            abs(sum(probabilities.values()) - 1) < 1e-5,
            "probabilities do not sum to one",
        )
        predicted = max(LABELS, key=probabilities.get)
        check(row["predicted"] == predicted, "argmax differs")
        check(row["correct"] == (row["gold"] == predicted), "correct flag differs")
        check(
            abs(row["confidence"] - probabilities[predicted]) < 1e-7,
            "confidence differs",
        )
    return summarize(rows)


def verify(root):
    root = Path(root)
    splits = read_splits()
    validate(splits)
    expected_report = data_report(splits)
    check(
        read_json(ROOT / "data-report.json") == expected_report,
        "local frozen data report changed",
    )
    config = read_json(ROOT / "experiment.json")
    manifest = read_json(root / "reports/manifest.json")
    check(manifest.get("finished_at_utc"), "training has not finished")
    check(manifest["experiment"] == config, "experiment settings differ")
    check(manifest["label2id"] == LABEL_TO_ID, "manifest label mapping differs")
    check(manifest["test_used_for_selection"] is False, "test selection flag differs")
    check(
        set(manifest["source_sha256"]) == set(FROZEN_FILES),
        "source manifest is incomplete",
    )
    input_hashes = read_json(ROOT / "input-sha256.json")
    check(
        read_json(root / "input-sha256.json") == input_hashes,
        "uploaded input manifest differs",
    )
    for name, expected in input_hashes.items():
        check(
            not Path(name).is_absolute() and ".." not in Path(name).parts,
            "unsafe input path",
        )
        check(
            sha(root / name) == expected == sha(input_path(name)),
            f"input hash differs: {name}",
        )
    required = set(input_hashes) | {
        "input-sha256.json",
        "setup.json",
        "pip-freeze.txt",
        "command.json",
        "training.log",
        "reports/manifest.json",
        "reports/protocol.json",
        "reports/selection.json",
        "reports/results.json",
        "reports/verification.json",
        "reports/report.md",
    }
    for selected in manifest["selected_checkpoints"].values():
        required |= {
            f"weights/{selected['path']}/{name}"
            for name in [
                "model.safetensors",
                "config.json",
                "tokenizer.json",
                "tokenizer_config.json",
            ]
        }
    for seed in config["seeds"]:
        required |= {
            f"reports/seed-{seed}/{name}"
            for name in [
                "metrics.json",
                "misclassifications.md",
                "train-predictions.jsonl",
                "dev-predictions.jsonl",
                "test-predictions.jsonl",
                *[
                    f"{split}-predictions.jsonl"
                    for split in SPLITS
                    if split.startswith("legacy_")
                ],
            ]
        }
    required |= {f"reports/trial-{i}-dev-history.jsonl" for i in range(1, 7)}
    if (root / "artifact-sha256.json").exists():
        artifact_hashes = read_json(root / "artifact-sha256.json")
        check(
            required <= set(artifact_hashes),
            "artifact hash manifest omits required files",
        )
        for name, expected in artifact_hashes.items():
            check(
                not Path(name).is_absolute() and ".." not in Path(name).parts,
                "unsafe artifact path",
            )
            check(sha(root / name) == expected, f"artifact hash differs: {name}")
    for name, expected in manifest["source_sha256"].items():
        check(
            sha(root / name) == expected == sha(input_path(name)),
            f"source hash differs: {name}",
        )
    for split in SPLITS:
        expected = expected_report["splits"][split]["sha256"]
        check(
            manifest["data_sha256"][split]
            == expected
            == sha(root / "data" / f"{split}.jsonl"),
            f"{split}: data hash differs",
        )
    selection = read_json(root / "reports/selection.json")
    trials = selection["trials"]
    computed = select_shared_learning_rate(
        trials, config["seeds"], config["learning_rates"]
    )
    for key in computed:
        close_tree(selection[key], computed[key], "selection." + key)
    if config.get("primary_selection"):
        from evaluation import select_primary_model

        close_tree(
            selection["primary_model"], select_primary_model(computed), "primary_model"
        )
        check(
            bool(selection.get("frozen_at_utc")), "selection freeze timestamp missing"
        )
    for index, trial in enumerate(trials, 1):
        history = [
            json.loads(line)
            for line in (root / f"reports/trial-{index}-dev-history.jsonl")
            .read_text()
            .splitlines()
        ]
        check(len(history) == config["epochs"], f"trial {index}: epoch count differs")
        check(
            [r["epoch"] for r in history] == list(range(1, config["epochs"] + 1)),
            "epoch order differs",
        )
        for entry in history:
            check(
                entry["seed"] == trial["seed"]
                and entry["learning_rate"] == trial["learning_rate"]
                and entry["trial_index"] == index - 1,
                "trial history identity differs",
            )
        best = max(history, key=selection_key)
        close_tree(trial, best, "best dev epoch")
    metrics, checked = {}, 0
    for selected in computed["selected_models"]:
        name = f"seed-{selected['seed']}"
        checkpoint = manifest["selected_checkpoints"][name]
        check(
            checkpoint["path"] == selected["trial"] + "/best",
            "selected checkpoint path differs",
        )
        weights = root / "weights" / checkpoint["path"]
        for required_file in [
            "config.json",
            "tokenizer.json",
            "tokenizer_config.json",
            "model.safetensors",
        ]:
            check(
                (weights / required_file).is_file(),
                f"checkpoint file missing: {required_file}",
            )
        check(
            sha(weights / "model.safetensors") == checkpoint["sha256"],
            "weight hash differs",
        )
        model_config = read_json(weights / "config.json")
        check(model_config["label2id"] == LABEL_TO_ID, "checkpoint label IDs differ")
        check(
            model_config["id2label"]
            == {str(i): label for label, i in LABEL_TO_ID.items()},
            "checkpoint reverse labels differ",
        )
        with safe_open(weights / "model.safetensors", framework="numpy") as tensors:
            tensor_names = tensors.keys()
            check(
                tensors.get_slice("classifier.weight").get_shape()
                == [19, model_config["hidden_size"]],
                "classifier weight shape differs",
            )
            check(
                tensors.get_slice("classifier.bias").get_shape() == [19],
                "classifier bias shape differs",
            )
            check(
                all(
                    tensors.get_slice(name).get_dtype() == "F32"
                    for name in tensor_names
                ),
                "checkpoint dtype differs",
            )
            check(
                sum(
                    math.prod(tensors.get_slice(name).get_shape())
                    for name in tensor_names
                )
                == manifest["parameters"],
                "parameter count differs",
            )
        observed = read_json(root / "reports" / name / "metrics.json")
        metrics[name] = {}
        for split in SPLITS:
            rows = [
                json.loads(line)
                for line in (root / "reports" / name / f"{split}-predictions.jsonl")
                .read_text()
                .splitlines()
            ]
            actual = verify_predictions(rows, splits[split])
            close_tree(observed[split], actual)
            metrics[name][split] = actual
            checked += len(rows)
        check(
            abs(observed["dev"]["macro_f1"] - selected["macro_f1"]) < 1e-7,
            "reloaded dev F1 differs",
        )
        check(
            abs(observed["dev"]["loss"] - selected["loss"]) < 1e-5,
            "reloaded dev loss differs",
        )
    aggregate = {
        s: {
            key: distribution([m[s][key] for m in metrics.values()])
            for key in ["accuracy", "macro_f1", "macro_f1_supported"]
        }
        for s in SPLITS
    }
    result = {
        "status": "verified",
        "checked_predictions": checked,
        "models": metrics,
        "aggregate": aggregate,
        "coverage": expected_report["splits"],
        "limitation": "Saved-artifact verification; not ASR, application integration, independent real-speech evaluation, or production adoption.",
    }

    if config.get("primary_selection"):
        from evaluation import target_assessment

        result["target_assessment"] = target_assessment(
            selection["primary_model"], metrics, config["accuracy_target"]
        )
        result["legacy_comparison"] = legacy_comparison(metrics, splits)
    return result


def legacy_comparison(metrics, splits):
    from v03_data import lineage_config

    lineage = lineage_config(ROOT)
    comparison = {}
    for name, current in metrics.items():
        comparison[name] = {}
        for baseline in lineage["baseline_reports"]:
            for old, new in baseline["split_map"].items():
                old_rows = [
                    json.loads(line)
                    for line in (
                        ROOT / baseline["reports"] / name / f"{old}-predictions.jsonl"
                    )
                    .read_text()
                    .splitlines()
                ]
                old_source = splits[new]
                check(
                    [r["id"] for r in old_rows] == [r["id"] for r in old_source],
                    "legacy baseline IDs differ",
                )
                check(
                    all(
                        r["text"] == o["text"] and r["gold"] == o["label"]
                        for r, o in zip(old_rows, old_source)
                    ),
                    "legacy baseline text/gold differs",
                )
                for row in old_rows:
                    probabilities = row["probabilities"]
                    check(
                        set(probabilities) == set(LABELS),
                        "baseline probability labels differ",
                    )
                    check(
                        all(
                            isinstance(p, (int, float))
                            and math.isfinite(p)
                            and 0 <= p <= 1
                            for p in probabilities.values()
                        ),
                        "invalid baseline probability",
                    )
                    check(
                        abs(sum(probabilities.values()) - 1) < 1e-5,
                        "baseline probability sum differs",
                    )
                    predicted = max(LABELS, key=probabilities.get)
                    check(row["predicted"] == predicted, "baseline argmax differs")
                    check(
                        row["correct"] == (row["gold"] == predicted),
                        "baseline correct flag differs",
                    )
                    check(
                        abs(row["confidence"] - probabilities[predicted]) < 1e-7,
                        "baseline confidence differs",
                    )
                previous = summarize(old_rows)
                comparison[name][new] = {
                    "previous_version": baseline["version"],
                    "current_version": lineage["current_version"],
                    "previous_accuracy": previous["accuracy"],
                    "current_accuracy": current[new]["accuracy"],
                    "delta": current[new]["accuracy"] - previous["accuracy"],
                    "previous_single_to_compound": previous[
                        "single_dispatch_to_compound"
                    ],
                    "current_single_to_compound": current[new][
                        "single_dispatch_to_compound"
                    ],
                    "previous_compound_to_single": previous[
                        "compound_to_single_dispatch"
                    ],
                    "current_compound_to_single": current[new][
                        "compound_to_single_dispatch"
                    ],
                    "independent_acceptance": False,
                }
    return comparison


def markdown(result):
    lines = [
        "# ニャムル音声操作分類：Colab結果",
        "",
        "単独発話textのみの19分類。devで条件選択し、testは選択後に評価。",
        "合成例中心のグループ分割。評価例がない分類は未評価。音声認識・引数解決・アプリ実行は測っていない。",
        "",
        "| モデル | test正解 | 正解率 | F1（testに例がある分類） | 非命令→操作分類 |",
        "|---|---:|---:|---:|---:|",
    ]
    for name, splits in result["models"].items():
        m = splits["test"]
        bad = m["not_command_to_dispatch_label"]
        lines.append(
            f"| {name} | {m['correct']}/{m['n']} | {m['accuracy']:.1%} | {m['macro_f1_supported']:.4f} | {bad['count']}/{bad['denominator']} |"
        )
    lines += [
        "",
        "## testの分類別正解数",
        "",
        "| 分類 | 件数 | seed42 | seed43 | seed44 |",
        "|---|---:|---:|---:|---:|",
    ]
    for label in LABELS:
        support = result["coverage"]["test"]["labels"][label]
        scores = []
        for name in ["seed-42", "seed-43", "seed-44"]:
            m = result["models"][name]["test"]
            index = LABEL_TO_ID[label]
            scores.append(
                str(m["confusion_matrix"][index][index]) if support else "未評価"
            )
        lines.append(f"| {label} | {support} | {' | '.join(scores)} |")
    mean = result["aggregate"]["test"]["accuracy"]
    lines += [
        "",
        f"3 seedのtest正解率平均 {mean['mean']:.1%}、標本標準偏差 {mean['sample_stddev'] * 100:.2f}ポイント。これは信頼区間ではない。",
        "",
        "全誤分類は各seedのmisclassifications.md、全確率・混同行列は同じフォルダのJSONに保存。",
        "分類は実行許可ではなく、未実装機能の実行可能性を示さない。モデルの自動採用はしない。",
    ]
    if "target_assessment" in result:
        target = result["target_assessment"]
        lines[2:2] = [
            f"主評価モデル: {target['primary_model']['name']}（新devだけで事前選択）。新test {target['correct']}/{target['n']} = {target['accuracy']:.2%}。95%目標: {'到達' if target['target_met_on_this_holdout'] else '未到達'}。",
            "この判定は今回の合成例中心の固定text評価内に限る。旧dev/testは回帰確認のみ。",
            "",
        ]
        lines += [
            "",
            "## 主評価モデルの新test：出典別",
            "",
            "| 出典 | 正解 / 件数 | 正解率 |",
            "|---|---:|---:|",
        ]
        for source, score in result["models"][target["primary_model"]["name"]]["test"][
            "source_accuracy"
        ].items():
            lines.append(
                f"| {source} | {score['count']} / {score['denominator']} | {score['rate']:.1%} |"
            )
        lines += [
            "",
            "## 旧版の同じ例での回帰確認（独立評価ではない）",
            "",
            "| モデル | 旧split | 比較する版 | 旧正解率 | 今回の正解率 |",
            "|---|---|---|---:|---:|",
        ]
        for name, splits in result["legacy_comparison"].items():
            for split, values in splits.items():
                lines.append(
                    f"| {name} | {split} | {values['previous_version']} → {values['current_version']} | {values['previous_accuracy']:.1%} | {values['current_accuracy']:.1%} |"
                )
        lines += [
            "",
            "## 誤りの方向（新test）",
            "",
            "| モデル | Undo→Redo | Redo→Undo | 複数→単一操作 | 単一操作→複数 | 複数予測の正解 |",
            "|---|---:|---:|---:|---:|---:|",
        ]
        for name, splits in result["models"].items():
            cells = [
                f"{splits['test'][key]['count']}/{splits['test'][key]['denominator']}"
                for key in [
                    "undo_to_redo",
                    "redo_to_undo",
                    "compound_to_single_dispatch",
                    "single_dispatch_to_compound",
                    "compound_prediction_precision",
                ]
            ]
            lines.append(f"| {name} | {' | '.join(cells)} |")
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifact_root", nargs="?", type=Path, default=ROOT)
    args = parser.parse_args()
    result = verify(args.artifact_root)
    if (args.artifact_root / "artifact-sha256.json").exists():
        # Downloaded, hashed artifacts stay immutable during local verification.
        close_tree(read_json(args.artifact_root / "reports/verification.json"), result)
    else:
        (args.artifact_root / "reports/verification.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
        )
        (args.artifact_root / "reports/report.md").write_text(markdown(result))
    print(
        json.dumps(
            {
                "status": result["status"],
                "checked_predictions": result["checked_predictions"],
                "test_accuracy": result["aggregate"]["test"]["accuracy"],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
