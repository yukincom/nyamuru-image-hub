"""原groupとレビューした対照群を保ち、ラベル件数だけで分割を固定する。"""

import argparse
import difflib
import hashlib
import json
import tempfile
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp

from dataset import (
    LABEL_TO_ID,
    ROOT,
    SPLITS,
    data_report,
    digest,
    normalized,
    read_corpus,
    read_corpus_lines,
    read_splits,
    validate,
)


def write_json(path, value):
    Path(path).write_text(
        json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    )


def make_families(rows, review):
    parents = {r["group"]: r["group"] for r in rows}

    def find(g):
        while g != parents[g]:
            g = parents[g]
        return g

    for item in review["merge_groups"]:
        roots = sorted({find(g) for g in item["groups"]})
        for g in roots:
            parents[g] = roots[0]
    families = defaultdict(list)
    for row in rows:
        families[find(row["group"])].append(row)
    return dict(sorted(families.items()))


def allocate(families):
    """MILP: 全19分類にtrain>=12、dev/test>=4、familyは不可分。"""
    names = list(families)
    labels = list(LABEL_TO_ID)
    counts = np.array(
        [
            [sum(r["label"] == label for r in families[g]) for label in labels]
            for g in names
        ]
    )
    n, k = counts.shape
    # 3N assignment bits, 3K class-count deviations, 3 total deviations, 2K coverage bits.
    dev_start, total_start, cover_start = 3 * n, 3 * n + 3 * k, 3 * n + 3 * k + 3
    size = cover_start + 2 * k
    cost = np.zeros(size)
    cost[dev_start:total_start] = 1
    cost[total_start:cover_start] = 0.25
    cost[cover_start:] = -100
    for i, name in enumerate(names):
        for s in range(3):
            # Stable tiny tie-breaks depend on family identity, never model outcomes.
            cost[3 * i + s] = (
                int(hashlib.sha256(f"20261017:{name}:{s}".encode()).hexdigest()[:8], 16)
                / 2**32
                * 1e-5
            )
    lower = np.zeros(size)
    upper = np.full(size, np.inf)
    upper[: 3 * n] = 1
    upper[cover_start:] = 1
    integrality = np.zeros(size)
    integrality[: 3 * n] = 1
    integrality[cover_start:] = 1
    constraints, lows, highs = [], [], []

    def add(values, lo=-np.inf, hi=np.inf):
        constraints.append(values)
        lows.append(lo)
        highs.append(hi)

    for i in range(n):
        row = np.zeros(size)
        row[3 * i : 3 * i + 3] = 1
        add(row, 1, 1)
    ratios = [0.7, 0.15, 0.15]
    minimums = json.loads((ROOT / "corpus.json").read_text())["minimum_per_label"]
    for s in range(3):
        for c in range(k):
            row = np.zeros(size)
            row[s : 3 * n : 3] = counts[:, c]
            add(row.copy(), minimums[SPLITS[s]], np.inf)
            if s != 0:
                cover = row.copy()
                cover[cover_start + (s - 1) * k + c] = -2
                add(cover, 0, np.inf)
            target = counts[:, c].sum() * ratios[s]
            minus = row.copy()
            minus[dev_start + s * k + c] = -1
            plus = row.copy()
            plus[dev_start + s * k + c] = 1
            add(minus, hi=target)
            add(plus, lo=target)
        row = np.zeros(size)
        row[s : 3 * n : 3] = counts.sum(axis=1)
        add(row.copy(), 20 if s else 1, np.inf)
        target = counts.sum() * ratios[s]
        minus = row.copy()
        minus[total_start + s] = -1
        plus = row.copy()
        plus[total_start + s] = 1
        add(minus, hi=target)
        add(plus, lo=target)
    result = milp(
        cost,
        integrality=integrality,
        bounds=Bounds(lower, upper),
        constraints=LinearConstraint(
            np.array(constraints), np.array(lows), np.array(highs)
        ),
        options={"time_limit": 30, "mip_rel_gap": 0},
    )
    if result.x is None or not result.success:
        raise RuntimeError(f"split allocation failed: {result.message}")
    assignments = {
        name: SPLITS[int(np.argmax(result.x[3 * i : 3 * i + 3]))]
        for i, name in enumerate(names)
    }
    return assignments, {
        "solver": "scipy.optimize.milp / HiGHS",
        "status": int(result.status),
        "objective": float(result.fun),
        "message": result.message,
    }


def render_review(output_root=ROOT):
    plan = json.loads((output_root / "split-plan.json").read_text())
    report = json.loads((output_root / "data-report.json").read_text())
    splits = read_splits(output_root / "data")
    lines = [
        f"# 2026-10-17 v0.2 固定分割と全{sum(map(len, splits.values()))}件",
        "",
        "元316件を保持し、新しい合成例を別ファイルに追加。原groupを不可分にし、近い文型・対照をまとめてから割り当て。学習結果を見る前の固定分割。",
        "",
        "| 分類 | train | dev | test |",
        "|---|---:|---:|---:|",
    ]
    for label in LABEL_TO_ID:
        lines.append(
            "| "
            + label
            + " | "
            + " | ".join(str(report["splits"][s]["labels"][label]) for s in SPLITS)
            + " |"
        )
    lines += [
        "",
        "train/dev/testすべてに全19分類を確保した。同じ作者による合成例内の保留文型であり、実利用者発話やASRの評価ではない。",
        "",
    ]
    for split, rows in splits.items():
        lines += [
            f"## {split}: {len(rows)}件",
            "",
            "| ID | 原文 | 正解 | 元group | family |",
            "|---|---|---|---|---|",
        ]
        for row in rows:
            text = row["text"].replace("|", "&#124;")
            lines.append(
                f"| {row['id']} | {text} | {row['label']} | {row['group']} | {plan['assignments'][row['id']]['family']} |"
            )
        lines.append("")
    all_rows = [(s, r) for s, rows in splits.items() for r in rows]
    pairs = []
    for i, (sa, a) in enumerate(all_rows):
        for sb, b in all_rows[i + 1 :]:
            if sa != sb:
                score = difflib.SequenceMatcher(
                    None, normalized(a["text"]), normalized(b["text"]), autojunk=False
                ).ratio()
                pairs.append((score, sa, sb, a, b))
    pairs.sort(key=lambda item: (-item[0], item[3]["id"], item[4]["id"]))
    lines += [
        "## 分割後の近接文面検査",
        "",
        "NFKC・大文字小文字・記号空白の正規化後、異なるsplitの全ペアをSequenceMatcherで確認。意味同一性の証明ではなく、全文レビューを補助する検査。上位10ペアを残す。",
        "",
        "| 類似度 | 例A | split | 例B | split |",
        "|---:|---|---|---|---|",
    ]
    for score, sa, sb, a, b in pairs[:10]:
        lines.append(
            f"| {score:.3f} | {a['id']} {a['text']} | {sa} | {b['id']} {b['text']} | {sb} |"
        )
    lines += [
        "",
        "単に編集対象の名詞や命令動詞が共通する例まで全て連結しない。例えば、ベクターペンへの切替と説明質問は全体の依頼内容が異なる。",
        "意味レビューの結合理由と留保はfamily-review.json、全割当はsplit-plan.jsonを参照。",
    ]
    (output_root / "docs").mkdir(exist_ok=True)
    (output_root / "docs/2026-10-17-v02-split-review.md").write_text(
        "\n".join(lines) + "\n"
    )


PREPARED_FILES = [
    "split-plan.json",
    "data-report.json",
    *[f"data/{s}.jsonl" for s in SPLITS],
    "docs/2026-10-17-v02-split-review.md",
]


def publish_prepared(staging):
    """Publish only validated files; restore prior bytes if a replacement fails."""
    before = {
        name: (ROOT / name).read_bytes() if (ROOT / name).exists() else None
        for name in PREPARED_FILES
    }
    changed = []
    try:
        for name in PREPARED_FILES:
            (ROOT / name).parent.mkdir(parents=True, exist_ok=True)
            (staging / name).replace(ROOT / name)
            changed.append(name)
    except Exception:
        for name in changed:
            if before[name] is None:
                (ROOT / name).unlink()
            else:
                (ROOT / name).write_bytes(before[name])
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--replace-prepared-v01", action="store_true")
    args = parser.parse_args()
    if (ROOT / "split-plan.json").exists() or (ROOT / "data").exists():
        if not args.replace_prepared_v01:
            raise ValueError(
                "a frozen split exists; use a new version instead of overwriting it"
            )
        snapshot = json.loads((ROOT / "releases/v0.1/snapshot.json").read_text())
        if snapshot["status"] != "prepared_never_trained" or any(
            (ROOT / n).exists() for n in ["reports", "weights"]
        ):
            raise ValueError("only the untrained v0.1 preparation may be replaced")
        for name in [
            "split-plan.json",
            "data-report.json",
            *[f"data/{s}.jsonl" for s in SPLITS],
        ]:
            if (
                digest(ROOT / name) != snapshot["files"][name]
                or digest(ROOT / "releases/v0.1" / name) != snapshot["files"][name]
            ):
                raise ValueError(f"v0.1 snapshot/current mismatch: {name}")
    rows = read_corpus()
    review = json.loads((ROOT / "family-review.json").read_text())
    families = make_families(rows, review)
    split_for, solver = allocate(families)
    assignments = {
        row["id"]: {
            "family": family,
            "split": split_for[family],
            "original_group": row["group"],
        }
        for family, values in families.items()
        for row in values
    }
    plan = {
        "method": "Original groups indivisible; reviewed close paraphrases and contrast groups unioned. No model predictions consulted.",
        "target_ratio": {"train": 0.7, "dev": 0.15, "test": 0.15},
        "constraint": "Every class has at least 12 train, 4 dev, and 4 test examples. Original and reviewed families are indivisible.",
        "solver": solver,
        "assignments": dict(sorted(assignments.items())),
        "families": {
            f: {
                "split": split_for[f],
                "groups": sorted({r["group"] for r in rs}),
                "ids": [r["id"] for r in rs],
                "labels": dict(Counter(r["label"] for r in rs)),
            }
            for f, rs in families.items()
        },
    }
    # Build and validate all outputs before replacing any frozen file.
    original_lines = read_corpus_lines()
    with tempfile.TemporaryDirectory(prefix=".prepare-v02-", dir=ROOT) as directory:
        staging = Path(directory)
        write_json(staging / "split-plan.json", plan)
        (staging / "data").mkdir()
        for split in SPLITS:
            (staging / "data" / f"{split}.jsonl").write_bytes(
                b"".join(
                    line
                    for row, line in zip(rows, original_lines, strict=True)
                    if assignments[row["id"]]["split"] == split
                )
            )
        splits = read_splits(staging / "data")
        validate(splits, plan=plan)
        report = data_report(splits, staging / "data")
        write_json(staging / "data-report.json", report)
        render_review(staging)
        publish_prepared(staging)
    print(json.dumps(report["splits"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
