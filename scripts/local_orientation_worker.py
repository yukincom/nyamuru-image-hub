#!/usr/bin/env python3
"""Short-lived worker for 4-way page orientation estimation."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from page_orientation_classifier import DEFAULT_MIN_CONFIDENCE, estimate_page_orientation


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--model", type=Path)
    parser.add_argument("--min-confidence", type=float, default=DEFAULT_MIN_CONFIDENCE)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        result = estimate_page_orientation(
            args.image.read_bytes(),
            model_path=args.model,
            min_confidence=args.min_confidence,
        )
        print(json.dumps({"ok": True, "result": result}, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
