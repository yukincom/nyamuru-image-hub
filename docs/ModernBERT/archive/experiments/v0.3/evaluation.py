"""19分類の集計。未出現ラベルを明示し、devのみで条件選択する。"""

import math

from dataset import CONTRACT, LABEL_TO_ID

LABELS = list(LABEL_TO_ID)


def classification_metrics(
    gold: list[str], predicted: list[str], labels: list[str]
) -> dict:
    """同じ順序の正解・予測を集計する。行が正解、列が予測で、ゼロ除算は0。"""
    if len(gold) != len(predicted) or not gold:
        raise ValueError("nonempty aligned gold and predictions required")
    index = {label: i for i, label in enumerate(labels)}
    matrix = [[0 for _ in labels] for _ in labels]
    for actual, estimate in zip(gold, predicted):
        matrix[index[actual]][index[estimate]] += 1
    per_class = {}
    for label, i in index.items():
        tp = matrix[i][i]
        support = sum(matrix[i])
        predicted_count = sum(row[i] for row in matrix)
        precision = tp / predicted_count if predicted_count else 0.0
        recall = tp / support if support else 0.0
        f1 = (
            2 * precision * recall / (precision + recall) if precision + recall else 0.0
        )
        per_class[label] = {
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "support": support,
            "predicted_count": predicted_count,
        }
    correct = sum(matrix[i][i] for i in range(len(labels)))
    supported = [label for label in labels if per_class[label]["support"]]
    return {
        "n": len(gold),
        "correct": correct,
        "accuracy": correct / len(gold),
        "macro_f1": sum(v["f1"] for v in per_class.values()) / len(labels),
        "macro_f1_supported": sum(per_class[label]["f1"] for label in supported)
        / len(supported),
        "supported_labels": supported,
        "missing_labels": [label for label in labels if label not in supported],
        "per_class": per_class,
        "label_order": labels,
        "confusion_matrix": matrix,
    }


def rate(numerator: int, denominator: int) -> dict:
    """分母と件数を保持する。対象がない率は0%とせずnullにする。"""
    return {
        "count": numerator,
        "denominator": denominator,
        "rate": numerator / denominator if denominator else None,
    }


def selection_key(trial: dict) -> tuple:
    """dev F1、dev loss、早いepoch、事前の設定順で選ぶ。testの選択使用を拒否する。"""
    if trial["selection_split"] != "dev":
        raise ValueError("selection is restricted to dev")
    values = [trial["macro_f1"], trial["loss"], trial["epoch"]]
    if not all(math.isfinite(x) for x in values):
        raise ValueError("non-finite selection metric")
    return trial["macro_f1"], -trial["loss"], -trial["epoch"], -trial["trial_index"]


def select_shared_learning_rate(
    trials: list[dict], seeds: list[int], learning_rates: list[float]
) -> dict:
    """各seed・学習率の最良devを受け、全seed平均で一つの学習率を選ぶ。"""
    from statistics import mean

    if (
        not seeds
        or not learning_rates
        or len(set(seeds)) != len(seeds)
        or len(set(learning_rates)) != len(learning_rates)
    ):
        raise ValueError("nonempty unique seeds and learning rates required")
    expected = {(seed, lr) for seed in seeds for lr in learning_rates}
    by_pair = {(t["seed"], t["learning_rate"]): t for t in trials}
    if set(by_pair) != expected or len(by_pair) != len(trials):
        raise ValueError(
            "exactly one best-dev trial per seed and learning rate required"
        )
    for trial in trials:
        selection_key(trial)  # test混入とNaNを既存の検査で拒否する。
    candidates = []
    for index, lr in enumerate(learning_rates):
        rows = [by_pair[seed, lr] for seed in seeds]
        candidates.append(
            dict(
                selection_split="dev",
                learning_rate=lr,
                trial_index=index,
                **{
                    key: mean(row[key] for row in rows)
                    for key in ["macro_f1", "loss", "epoch", "accuracy"]
                },
            )
        )
    chosen = max(candidates, key=selection_key)
    return {
        "trials": trials,
        "learning_rate_means": candidates,
        "selected_learning_rate": chosen["learning_rate"],
        "selected_models": [by_pair[seed, chosen["learning_rate"]] for seed in seeds],
    }


def distribution(values: list[float]) -> dict:
    """反復実験の平均・標本標準偏差・範囲を返す。1回のばらつきは未測定。"""
    from statistics import mean, stdev

    if not values or not all(math.isfinite(v) for v in values):
        raise ValueError("nonempty finite measurements required")
    return {
        "values": values,
        "mean": mean(values),
        "sample_stddev": stdev(values) if len(values) > 1 else None,
        "min": min(values),
        "max": max(values),
    }


DIRECT_LABELS = {
    row["name"]
    for row in CONTRACT["labels"]
    if row["route"] == "existing_action_after_resolution"
}
WORKFLOW_LABELS = {"generate_request", "background_3d_candidates", "text_frames_align"}
DISPATCH_LABELS = DIRECT_LABELS | WORKFLOW_LABELS


def summarize(rows):
    result = classification_metrics(
        [r["gold"] for r in rows], [r["predicted"] for r in rows], LABELS
    )
    # These are classification errors, not proof of an actual application action.
    non_commands = [r for r in rows if r["gold"] == "not_command"]
    unresolved = [
        r
        for r in rows
        if r["gold"]
        in {"needs_clarification", "compound_request", "out_of_scope_request"}
    ]
    result["not_command_to_dispatch_label"] = rate(
        sum(r["predicted"] in DISPATCH_LABELS for r in non_commands), len(non_commands)
    )
    result["unresolved_to_dispatch_label"] = rate(
        sum(r["predicted"] in DISPATCH_LABELS for r in unresolved), len(unresolved)
    )
    result["incorrect_dispatch_predictions"] = rate(
        sum(
            r["predicted"] in DISPATCH_LABELS and r["predicted"] != r["gold"]
            for r in rows
        ),
        sum(r["predicted"] in DISPATCH_LABELS for r in rows),
    )
    for actual, estimate in [("undo", "redo"), ("redo", "undo")]:
        subset = [r for r in rows if r["gold"] == actual]
        result[f"{actual}_to_{estimate}"] = rate(
            sum(r["predicted"] == estimate for r in subset), len(subset)
        )
    compound = [r for r in rows if r["gold"] == "compound_request"]
    result["compound_to_single_dispatch"] = rate(
        sum(r["predicted"] in DISPATCH_LABELS for r in compound), len(compound)
    )
    result["dispatch_labels"] = sorted(DISPATCH_LABELS, key=LABEL_TO_ID.get)
    result["subsets"] = {}
    for tag in sorted({tag for r in rows for tag in r["tags"]}):
        subset = [r for r in rows if tag in r["tags"]]
        result["subsets"][tag] = rate(
            sum(r["gold"] == r["predicted"] for r in subset), len(subset)
        )
    result["source_accuracy"] = {
        source: rate(
            sum(r["gold"] == r["predicted"] for r in rows if r["source"] == source),
            sum(r["source"] == source for r in rows),
        )
        for source in sorted({r["source"] for r in rows})
    }
    user_examples = [r for r in rows if r["source"] == "user_supplied_example"]
    result["user_examples"] = rate(
        sum(r["gold"] == r["predicted"] for r in user_examples), len(user_examples)
    )
    families = {
        family: [r for r in rows if r["family"] == family]
        for family in sorted({r["family"] for r in rows})
    }
    family_scores = [
        sum(r["gold"] == r["predicted"] for r in group) / len(group)
        for group in families.values()
    ]
    result["families"] = {
        "n": len(families),
        "mean_accuracy": sum(family_scores) / len(family_scores),
        "all_correct": sum(score == 1 for score in family_scores),
        "mixed_label_families": {
            name: rate(sum(r["gold"] == r["predicted"] for r in group), len(group))
            for name, group in families.items()
            if len({r["gold"] for r in group}) > 1
        },
    }
    return result


def select_primary_model(selection):
    """Choose one primary seed on dev alone, before any new-test evaluation."""
    selected = max(selection["selected_models"], key=selection_key)
    return {
        "name": f"seed-{selected['seed']}",
        "seed": selected["seed"],
        "trial": selected["trial"],
        "selection_split": "dev",
        "rule": "max dev macro_f1; min dev loss; earlier epoch; earlier trial",
    }


def target_assessment(primary_model, metrics, threshold=0.95):
    m = metrics[primary_model["name"]]["test"]
    return {
        "primary_model": primary_model,
        "evaluation_split": "test",
        "accuracy_target": threshold,
        "correct": m["correct"],
        "n": m["n"],
        "accuracy": m["accuracy"],
        "macro_f1": m["macro_f1"],
        "target_met_on_this_holdout": m["accuracy"] >= threshold,
        "scope": "Observed accuracy on this frozen mostly-synthetic text holdout only; not real-user/ASR accuracy or production adoption.",
    }
