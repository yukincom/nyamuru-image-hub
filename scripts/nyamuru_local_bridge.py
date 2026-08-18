#!/usr/bin/env python3
"""Local-only bridge for Nyamuru's optional scanner and Qwen3-VL features."""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


DEFAULT_MODEL = "Qwen3-VL-8B-NSFW-Caption-V4.5-heretic.i1-Q5_K_M.gguf"
TOOLS_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MANGA_BABBLE_ROOT = TOOLS_ROOT / "manga-babble-maker"
DEFAULT_NDLOCR_ROOT = TOOLS_ROOT / "ndlocr-lite"
DEFAULT_RAPID_ORIENTATION_ROOT = TOOLS_ROOT / "rapid-orientation"
RAPID_ORIENTATION_CONFIDENCE = 0.45
# 高解像度TIFFをブラウザ側で縮小できない場合にも、ローカルbridgeで受け取れる上限。
MAX_BODY_BYTES = 96 * 1024 * 1024
ALLOWED_ORIGIN = re.compile(r"^https?://(?:127\.0\.0\.1|localhost)(?::\d+)?$")
SCANNER_WINDOW_SECONDS = 5 * 60
SCANNER_MAX_FILES = 10
SCANNER_STABLE_SECONDS = 0.8
SCANNER_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".tif", ".tiff"}
DEFAULT_SCANNER_STATE_PATH = (
    Path.home() / "Library" / "Application Support" / "Nyamuru Manga Name Studio" / "scanner-session.json"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--comfy-root", type=Path, required=True)
    parser.add_argument("--model", default=os.environ.get("NYAMURU_QWEN_MODEL", DEFAULT_MODEL))
    parser.add_argument(
        "--manga-babble-root",
        type=Path,
        default=Path(os.environ.get("NYAMURU_MANGA_BABBLE_ROOT", DEFAULT_MANGA_BABBLE_ROOT)),
    )
    parser.add_argument(
        "--ndlocr-root",
        type=Path,
        default=Path(os.environ.get("NYAMURU_NDLOCR_ROOT", DEFAULT_NDLOCR_ROOT)),
    )
    parser.add_argument(
        "--rapid-orientation-root",
        type=Path,
        default=Path(os.environ.get("NYAMURU_RAPID_ORIENTATION_ROOT", DEFAULT_RAPID_ORIENTATION_ROOT)),
    )
    parser.add_argument(
        "--qwen-mode",
        choices=("off", "auto", "compare"),
        default=os.environ.get("NYAMURU_QWEN_MODE", "auto"),
        help="off/auto: 専用モデル＋手動向き確認 / compare: 常にQwenとも比較",
    )
    parser.add_argument("--check", action="store_true")
    return parser.parse_args()


def decode_image_data(value: object) -> bytes:
    if not isinstance(value, str) or not value.startswith("data:image/") or "," not in value:
        raise ValueError("画像データの形式が正しくありません")
    encoded = value.split(",", 1)[1]
    try:
        return base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise ValueError("画像データをデコードできませんでした") from exc


def normalized_candidate(candidate: object) -> dict[str, Any] | None:
    if not isinstance(candidate, dict):
        return None
    candidate_id = str(candidate.get("id", "")).strip().upper()
    shapes = candidate.get("shapes")
    if not re.fullmatch(r"[A-Z]", candidate_id) or not isinstance(shapes, list) or not shapes:
        return None
    return {
        "id": candidate_id,
        "name": str(candidate.get("name", ""))[:80],
        "usage": str(candidate.get("usage", ""))[:160],
        "shapes": shapes[:8],
        "has_bleed": isinstance(candidate.get("bleeds"), dict) and bool(candidate.get("bleeds")),
    }


def normalized_rotation_override(value: object) -> int | None:
    if value is None:
        return None
    try:
        rotation = int(value)
    except (TypeError, ValueError):
        raise ValueError("手動の向き指定は0・90・180・270度のいずれかです") from None
    if rotation not in {0, 90, 180, 270}:
        raise ValueError("手動の向き指定は0・90・180・270度のいずれかです")
    return rotation


def image_capture_preference(key: str, fallback: str) -> str:
    try:
        result = subprocess.run(
            ["/usr/bin/defaults", "read", "com.apple.Image_Capture", key],
            check=True,
            capture_output=True,
            text=True,
            timeout=3,
        )
        value = re.sub(
            r"\\[uU]([0-9a-fA-F]{4})",
            lambda match: chr(int(match.group(1), 16)),
            result.stdout.strip(),
        )
        return value or fallback
    except (OSError, subprocess.SubprocessError):
        return fallback


def scanner_destination() -> Path:
    configured = image_capture_preference("IK_Scanner_downloadURL", "~/Pictures")
    if configured.startswith("file://"):
        from urllib.parse import unquote

        configured = unquote(urlparse(configured).path)
    destination = Path(configured).expanduser().resolve()
    if not destination.is_dir():
        raise ValueError(f"イメージキャプチャの保存先が見つかりません: {destination}")
    return destination


def scanner_document_prefix() -> str:
    return image_capture_preference("IK_documentName", "スキャン").strip() or "スキャン"


def scanner_image_files(directory: Path, prefix: str) -> list[Path]:
    try:
        files = list(directory.iterdir())
    except OSError as exc:
        raise ValueError(f"スキャン保存先を読み取れません: {directory}") from exc
    return [
        path for path in files
        if path.is_file() and path.suffix.lower() in SCANNER_EXTENSIONS and path.stem.startswith(prefix)
    ]


def scanner_file_signature(path: Path) -> tuple[int, int]:
    stat = path.stat()
    return stat.st_size, stat.st_mtime_ns


def scanner_preview(path: Path) -> tuple[str, str]:
    from PIL import Image, ImageOps

    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
        image.thumbnail((1800, 1800))
        output = io.BytesIO()
        image.save(output, format="JPEG", quality=92, optimize=True)
    return "image/jpeg", base64.b64encode(output.getvalue()).decode("ascii")


@dataclass
class ObservedScan:
    signature: tuple[int, int]
    stable_since: float


@dataclass
class ScannerSession:
    session_id: str
    directory: Path
    prefix: str
    started_ns: int
    started_at: str
    expires_at_monotonic: float
    baseline: dict[Path, tuple[int, int]]
    observed: dict[Path, ObservedScan] = field(default_factory=dict)
    delivered: dict[str, Path] = field(default_factory=dict)
    delivered_paths: set[Path] = field(default_factory=set)
    watching: bool = True

    @property
    def complete(self) -> bool:
        return not self.watching or time.monotonic() >= self.expires_at_monotonic or len(self.delivered_paths) >= SCANNER_MAX_FILES


class ScannerSessions:
    def __init__(self, state_path: Path | None = None):
        self.lock = threading.Lock()
        self.active: ScannerSession | None = None
        self.state_path = state_path or DEFAULT_SCANNER_STATE_PATH

    def _persist(self, session: ScannerSession) -> None:
        payload = {
            "version": 1,
            "session_id": session.session_id,
            "directory": str(session.directory),
            "prefix": session.prefix,
            "started_ns": session.started_ns,
            "started_at": session.started_at,
            "baseline": {
                path.name: [signature[0], signature[1]]
                for path, signature in session.baseline.items()
                if path.parent == session.directory
            },
            "delivered": {file_id: path.name for file_id, path in session.delivered.items()},
            "watching": session.watching,
        }
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.state_path.with_suffix(f"{self.state_path.suffix}.tmp")
        temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        os.chmod(temporary, 0o600)
        temporary.replace(self.state_path)

    def _clear_state(self) -> None:
        self.state_path.unlink(missing_ok=True)

    def _load_recoverable(self) -> ScannerSession | None:
        if self.active:
            return self.active
        try:
            payload = json.loads(self.state_path.read_text(encoding="utf-8"))
            directory = Path(payload["directory"]).expanduser().resolve()
            prefix = str(payload["prefix"])
            started_ns = int(payload["started_ns"])
            started_at = str(payload["started_at"])
            session_id = str(payload["session_id"])
            if not directory.is_dir() or not prefix or not session_id:
                raise ValueError("invalid scanner recovery state")
            raw_baseline = payload.get("baseline", {})
            baseline = {
                (directory / name).resolve(): (int(signature[0]), int(signature[1]))
                for name, signature in raw_baseline.items()
                if isinstance(name, str)
                and Path(name).name == name
                and isinstance(signature, list)
                and len(signature) == 2
            }
            session = ScannerSession(
                session_id=session_id,
                directory=directory,
                prefix=prefix,
                started_ns=started_ns,
                started_at=started_at,
                expires_at_monotonic=time.monotonic(),
                baseline=baseline,
                watching=False,
            )
            raw_delivered = payload.get("delivered", {})
            if isinstance(raw_delivered, dict):
                for file_id, name in raw_delivered.items():
                    if not isinstance(file_id, str) or not isinstance(name, str) or Path(name).name != name:
                        continue
                    path = (directory / name).resolve()
                    if path.parent == directory and path.exists():
                        session.delivered[file_id] = path
                        session.delivered_paths.add(path)
            self.active = session
            return session
        except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
            self._clear_state()
            return None

    @staticmethod
    def _session_payload(session: ScannerSession) -> dict[str, Any]:
        return {
            "session_id": session.session_id,
            "started_at": session.started_at,
            "expires_in_seconds": SCANNER_WINDOW_SECONDS if session.watching else 0,
            "max_files": SCANNER_MAX_FILES,
            "directory": str(session.directory),
        }

    @staticmethod
    def _eligible_paths(session: ScannerSession) -> list[tuple[Path, tuple[int, int]]]:
        eligible: list[tuple[Path, tuple[int, int]]] = []
        for candidate in scanner_image_files(session.directory, session.prefix):
            path = candidate.resolve()
            if path.parent != session.directory:
                continue
            try:
                signature = scanner_file_signature(path)
            except OSError:
                continue
            if signature[1] < session.started_ns or session.baseline.get(path) == signature:
                continue
            eligible.append((path, signature))
        return sorted(eligible, key=lambda item: (item[1][1], item[0].name))[:SCANNER_MAX_FILES]

    def _delete_session_files(self, session: ScannerSession) -> dict[str, Any]:
        deleted = 0
        errors: list[str] = []
        for path, _ in self._eligible_paths(session):
            try:
                path.unlink()
                deleted += 1
            except FileNotFoundError:
                continue
            except OSError as exc:
                errors.append(f"{path.name}: {exc}")
        if not errors:
            self.active = None
            self._clear_state()
        else:
            self._persist(session)
        return {"deleted": deleted, "errors": errors}

    def start(self) -> dict[str, Any]:
        with self.lock:
            recoverable = self._load_recoverable()
            if recoverable and self._eligible_paths(recoverable):
                raise ValueError("前回のスキャン画像が残っています。先につなぎ直すか破棄してください")
            if recoverable:
                self.active = None
                self._clear_state()
        directory = scanner_destination().resolve()
        prefix = scanner_document_prefix()
        started_ns = time.time_ns()
        baseline: dict[Path, tuple[int, int]] = {}
        for path in scanner_image_files(directory, prefix):
            try:
                baseline[path.resolve()] = scanner_file_signature(path)
            except OSError:
                continue
        session = ScannerSession(
            session_id=secrets.token_urlsafe(24),
            directory=directory,
            prefix=prefix,
            started_ns=started_ns,
            started_at=datetime.now(timezone.utc).isoformat(),
            expires_at_monotonic=time.monotonic() + SCANNER_WINDOW_SECONDS,
            baseline=baseline,
        )
        with self.lock:
            self.active = session
            self._persist(session)
        return self._session_payload(session)

    def cancel(self, session_id: str) -> dict[str, Any]:
        with self.lock:
            session = self._session(session_id)
            return self._delete_session_files(session)

    def _session(self, session_id: object) -> ScannerSession:
        if not isinstance(session_id, str) or not self.active or not secrets.compare_digest(session_id, self.active.session_id):
            raise ValueError("スキャン待機セッションが見つかりません")
        return self.active

    def collect(self, session_id: object) -> dict[str, Any]:
        with self.lock:
            session = self._session(session_id)
            now = time.monotonic()
            ready: list[tuple[Path, tuple[int, int]]] = []
            if not session.complete:
                for candidate in scanner_image_files(session.directory, session.prefix):
                    path = candidate.resolve()
                    if path in session.delivered_paths:
                        continue
                    try:
                        signature = scanner_file_signature(path)
                    except OSError:
                        continue
                    if signature[1] < session.started_ns or session.baseline.get(path) == signature:
                        continue
                    observed = session.observed.get(path)
                    if not observed or observed.signature != signature:
                        session.observed[path] = ObservedScan(signature=signature, stable_since=now)
                        continue
                    if now - observed.stable_since >= SCANNER_STABLE_SECONDS:
                        ready.append((path, signature))

            slots = max(0, SCANNER_MAX_FILES - len(session.delivered_paths))
            payloads: list[dict[str, Any]] = []
            for path, (size, modified_ns) in sorted(ready, key=lambda item: (item[1][1], item[0].name))[:slots]:
                try:
                    mime_type, encoded = scanner_preview(path)
                except (OSError, ValueError):
                    continue
                file_id = secrets.token_urlsafe(18)
                session.delivered[file_id] = path
                session.delivered_paths.add(path)
                payloads.append({
                    "id": file_id,
                    "filename": path.name,
                    "size": size,
                    "modified_at": datetime.fromtimestamp(modified_ns / 1_000_000_000, timezone.utc).isoformat(),
                    "image": f"data:{mime_type};base64,{encoded}",
                })
            self._persist(session)
            remaining = max(0, round(session.expires_at_monotonic - time.monotonic()))
            return {
                "files": payloads,
                "complete": session.complete,
                "remaining_seconds": remaining,
                "total": len(session.delivered_paths),
            }

    def commit(self, session_id: object) -> dict[str, Any]:
        with self.lock:
            session = self._session(session_id)
            return self._delete_session_files(session)

    def finish(self, session_id: object) -> dict[str, Any]:
        with self.lock:
            session = self._session(session_id)
            session.watching = False
            retained = [path.name for path in session.delivered.values() if path.exists()]
            self._persist(session)
        return {"ok": True, "retained": retained}

    def pending(self) -> dict[str, Any]:
        with self.lock:
            session = self._load_recoverable()
            if not session:
                return {"pending": False}
            paths = self._eligible_paths(session)
            if not paths:
                self.active = None
                self._clear_state()
                return {"pending": False}
            return {
                "pending": True,
                "started_at": session.started_at,
                "directory": str(session.directory),
                "count": len(paths),
            }

    def resume(self) -> dict[str, Any]:
        with self.lock:
            session = self._load_recoverable()
            if not session:
                raise ValueError("再開できるスキャン画像がありません")
            session.watching = False
            session.delivered = {}
            session.delivered_paths = set()
            payloads: list[dict[str, Any]] = []
            for path, (size, modified_ns) in self._eligible_paths(session):
                try:
                    mime_type, encoded = scanner_preview(path)
                except (OSError, ValueError):
                    continue
                file_id = secrets.token_urlsafe(18)
                session.delivered[file_id] = path
                session.delivered_paths.add(path)
                payloads.append({
                    "id": file_id,
                    "filename": path.name,
                    "size": size,
                    "modified_at": datetime.fromtimestamp(modified_ns / 1_000_000_000, timezone.utc).isoformat(),
                    "image": f"data:{mime_type};base64,{encoded}",
                })
            if not payloads:
                raise ValueError("再開できるスキャン画像を読み込めませんでした")
            self._persist(session)
            return {**self._session_payload(session), "files": payloads}

    def discard_pending(self) -> dict[str, Any]:
        with self.lock:
            session = self._load_recoverable()
            if not session:
                self._clear_state()
                return {"deleted": 0, "errors": []}
            return self._delete_session_files(session)


def draw_candidate(draw, candidate: dict[str, Any], box: tuple[int, int, int, int]) -> None:
    left, top, right, bottom = box
    draw.rectangle(box, fill="white", outline="#b8b8b8", width=2)
    draw.text((left + 6, top + 4), f"{candidate['id']}  {candidate['name']}", fill="black")
    page_left, page_top = left + 14, top + 24
    page_right, page_bottom = right - 14, bottom - 10
    page_w, page_h = page_right - page_left, page_bottom - page_top
    draw.rectangle((page_left, page_top, page_right, page_bottom), fill="#fafafa", outline="#888888", width=1)

    def point(x: float, y: float) -> tuple[float, float]:
        return (page_left + float(x) / 210 * page_w, page_top + float(y) / 297 * page_h)

    for shape in candidate["shapes"]:
        if not isinstance(shape, dict):
            continue
        if shape.get("type") == "rect":
            try:
                x1, y1 = point(shape["x"], shape["y"])
                x2, y2 = point(float(shape["x"]) + float(shape["w"]), float(shape["y"]) + float(shape["h"]))
                draw.rectangle((x1, y1, x2, y2), fill="#efeff4", outline="black", width=2)
            except (KeyError, TypeError, ValueError):
                continue
        elif shape.get("type") == "polygon" and isinstance(shape.get("points"), list):
            try:
                points = [point(x, y) for x, y in shape["points"]]
                draw.polygon(points, fill="#efeff4", outline="black")
                draw.line([*points, points[0]], fill="black", width=2)
            except (TypeError, ValueError):
                continue


def detect_panel_boxes(image_bytes: bytes) -> list[tuple[float, float, float, float]]:
    import cv2
    import numpy as np

    image = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise ValueError("画像を展開できませんでした")
    original_height, original_width = image.shape
    scale = min(1.0, 1600 / max(original_width, original_height))
    if scale < 1.0:
        image = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    height, width = image.shape
    edges = cv2.Canny(image, 50, 150)
    kernel_size = max(3, round(min(width, height) * 0.004))
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kernel_size, kernel_size))
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    page_area = width * height
    raw: list[tuple[int, int, int, int, float]] = []
    for contour in contours:
        x, y, box_width, box_height = cv2.boundingRect(contour)
        contour_area = cv2.contourArea(contour)
        box_area = box_width * box_height
        if box_area <= 0:
            continue
        extent = contour_area / box_area
        area_ratio = contour_area / page_area
        if (
            area_ratio >= 0.012
            and extent >= 0.72
            and box_width / width >= 0.14
            and box_height / height >= 0.05
            and box_area / page_area <= 0.82
        ):
            raw.append((x, y, box_width, box_height, contour_area))

    # 大きなパネル枠から採用し、その内部にあるフキダシや画面内オブジェクトの輪郭を除く。
    selected: list[tuple[int, int, int, int, float]] = []
    for candidate in sorted(raw, key=lambda item: item[4], reverse=True):
        x, y, box_width, box_height, _ = candidate
        candidate_area = box_width * box_height
        contained = False
        for outer_x, outer_y, outer_w, outer_h, _ in selected:
            intersect_w = max(0, min(x + box_width, outer_x + outer_w) - max(x, outer_x))
            intersect_h = max(0, min(y + box_height, outer_y + outer_h) - max(y, outer_y))
            if intersect_w * intersect_h / candidate_area >= 0.82:
                contained = True
                break
        if not contained:
            selected.append(candidate)
        if len(selected) >= 8:
            break
    return [(x / width, y / height, box_width / width, box_height / height) for x, y, box_width, box_height, _ in selected]


def shape_box(shape: dict[str, Any]) -> tuple[float, float, float, float] | None:
    try:
        if shape.get("type") == "rect":
            return float(shape["x"]) / 210, float(shape["y"]) / 297, float(shape["w"]) / 210, float(shape["h"]) / 297
        if shape.get("type") == "polygon":
            points = [(float(x), float(y)) for x, y in shape["points"]]
            xs, ys = [point[0] for point in points], [point[1] for point in points]
            return min(xs) / 210, min(ys) / 297, (max(xs) - min(xs)) / 210, (max(ys) - min(ys)) / 297
    except (KeyError, TypeError, ValueError):
        return None
    return None


def box_distance(left: tuple[float, float, float, float], right: tuple[float, float, float, float]) -> float:
    lx, ly, lw, lh = left
    rx, ry, rw, rh = right
    return (
        abs((lx + lw / 2) - (rx + rw / 2)) * 1.4
        + abs((ly + lh / 2) - (ry + rh / 2)) * 1.4
        + abs(lw - rw) * 0.7
        + abs(lh - rh) * 0.7
    )


def layout_distance(source: list[tuple[float, float, float, float]], candidate: dict[str, Any]) -> float:
    target = [box for shape in candidate["shapes"] if (box := shape_box(shape))]
    if not source or not target:
        return 99.0
    source_to_target = sum(min(box_distance(box, other) for other in target) for box in source) / len(source)
    target_to_source = sum(min(box_distance(box, other) for other in source) for box in target) / len(target)
    count_penalty = abs(len(source) - len(target)) * 0.9
    # A cropped scan cannot reliably prove that a line intentionally bleeds to
    # the finished page edge. Prefer the non-bleed equivalent for automatic
    # suggestions; the user can still choose a bleed template explicitly.
    bleed_uncertainty_penalty = 0.12 if candidate.get("has_bleed") else 0.0
    return source_to_target + target_to_source + count_penalty + bleed_uncertainty_penalty


def rank_candidates(image_bytes: bytes, candidates: list[dict[str, Any]]) -> tuple[list[tuple[dict[str, Any], float]], int]:
    boxes = detect_panel_boxes(image_bytes)
    if not boxes:
        boxes = detect_separator_panel_boxes(image_bytes)
    ranked = rank_candidates_from_boxes(boxes, candidates)
    return ranked, len(boxes)


def rank_candidates_from_boxes(
    boxes: list[tuple[float, float, float, float]],
    candidates: list[dict[str, Any]],
) -> list[tuple[dict[str, Any], float]]:
    return sorted(((candidate, layout_distance(boxes, candidate)) for candidate in candidates), key=lambda item: item[1])


def detector_boxes(
    detection: dict[str, Any],
    key: str,
    *,
    min_score: float = 0.2,
    max_area_ratio: float = 0.82,
) -> list[tuple[float, float, float, float]]:
    page = detection.get("page") if isinstance(detection.get("page"), dict) else {}
    width = float(page.get("width", 0) or 0)
    height = float(page.get("height", 0) or 0)
    buckets = detection.get("detections") if isinstance(detection.get("detections"), dict) else {}
    items = buckets.get(key) if isinstance(buckets.get(key), list) else []
    if width <= 0 or height <= 0:
        return []
    boxes: list[tuple[float, float, float, float]] = []
    for item in items:
        if not isinstance(item, dict) or float(item.get("score", 0) or 0) < min_score:
            continue
        bbox = item.get("bbox")
        if not isinstance(bbox, list) or len(bbox) != 4:
            continue
        try:
            x1, y1, x2, y2 = (float(value) for value in bbox)
        except (TypeError, ValueError):
            continue
        box_width, box_height = max(0.0, x2 - x1), max(0.0, y2 - y1)
        area_ratio = box_width * box_height / (width * height)
        if box_width <= 0 or box_height <= 0 or area_ratio > max_area_ratio:
            continue
        boxes.append((x1 / width, y1 / height, box_width / width, box_height / height))
    return boxes


def detect_separator_panel_boxes(image_bytes: bytes) -> list[tuple[float, float, float, float]]:
    """Recover simple horizontal panel bands from faint storyboard separator lines."""
    import cv2
    import numpy as np

    gray = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
    if gray is None:
        return []
    original_height, original_width = gray.shape
    scale = min(1.0, 1600 / max(original_width, original_height))
    if scale < 1.0:
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    height, width = gray.shape
    enhanced = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    edges = cv2.Canny(enhanced, 18, 75)
    lines = cv2.HoughLinesP(
        edges,
        1,
        np.pi / 180,
        threshold=max(24, round(width * 0.07)),
        minLineLength=max(50, round(width * 0.42)),
        maxLineGap=max(12, round(width * 0.14)),
    )
    candidates: list[tuple[float, float, float]] = []
    if lines is not None:
        for raw in lines.reshape(-1, 4):
            x1, y1, x2, y2 = (float(value) for value in raw)
            length = abs(x2 - x1)
            if length < width * 0.42 or abs(y2 - y1) > max(5, height * 0.015):
                continue
            y = (y1 + y2) / 2
            if height * 0.06 < y < height * 0.94:
                candidates.append((y, min(x1, x2), max(x1, x2)))
    clusters: list[list[tuple[float, float, float]]] = []
    for line in sorted(candidates):
        if not clusters or abs(line[0] - sum(item[0] for item in clusters[-1]) / len(clusters[-1])) > height * 0.025:
            clusters.append([line])
        else:
            clusters[-1].append(line)
    separators: list[float] = []
    for cluster in clusters:
        intervals = sorted((left, right) for _, left, right in cluster)
        covered = 0.0
        cursor_left = cursor_right = None
        for left, right in intervals:
            if cursor_left is None:
                cursor_left, cursor_right = left, right
            elif left <= float(cursor_right) + width * 0.04:
                cursor_right = max(float(cursor_right), right)
            else:
                covered += float(cursor_right) - float(cursor_left)
                cursor_left, cursor_right = left, right
        if cursor_left is not None:
            covered += float(cursor_right) - float(cursor_left)
        if covered >= width * 0.62:
            separators.append(sum(item[0] for item in cluster) / len(cluster) / height)
    # 鉛筆の薄い長線はCanny/Houghで途切れやすい。ページ幅の大部分に共通する
    # 水平方向の明度勾配も使い、ネームの段境界を補う。
    if not separators:
        sobel_y = np.abs(cv2.Sobel(gray.astype(np.float32), cv2.CV_32F, 0, 1, ksize=3))
        margin = max(4, round(width * 0.04))
        row_scores = np.percentile(sobel_y[:, margin:-margin], 80, axis=1)
        median = float(np.median(row_scores))
        deviation = float(np.median(np.abs(row_scores - median)))
        threshold = max(30.0, float(np.percentile(row_scores, 98)), median + deviation * 8)
        strong_rows = [
            index for index, score in enumerate(row_scores)
            if score >= threshold and height * 0.06 < index < height * 0.94
        ]
        row_clusters: list[list[int]] = []
        for row in strong_rows:
            if not row_clusters or row - row_clusters[-1][-1] > max(3, round(height * 0.025)):
                row_clusters.append([row])
            else:
                row_clusters[-1].append(row)
        for cluster in row_clusters:
            peak = max(cluster, key=lambda row: row_scores[row])
            separators.append(peak / height)
    separators = separators[:5]
    if not separators:
        return []
    boundaries = [0.015, *separators, 0.985]
    boxes = []
    for top, bottom in zip(boundaries, boundaries[1:]):
        if bottom - top >= 0.07:
            boxes.append((0.015, top, 0.97, bottom - top))
    return boxes if 2 <= len(boxes) <= 6 else []


def detect_grid_panel_boxes(image_bytes: bytes) -> list[tuple[float, float, float, float]]:
    """Split horizontal storyboard bands at strong, possibly hand-drawn vertical rules."""
    import cv2
    import numpy as np

    bands = detect_separator_panel_boxes(image_bytes)
    if not bands:
        return []
    gray = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
    if gray is None:
        return bands
    height, width = gray.shape
    ink = gray < 205
    boxes: list[tuple[float, float, float, float]] = []
    for left, top, band_width, band_height in bands:
        top_px = max(0, round(top * height))
        bottom_px = min(height, round((top + band_height) * height))
        if bottom_px - top_px < 24:
            boxes.append((left, top, band_width, band_height))
            continue
        crop = ink[top_px:bottom_px]
        edge_length = max(8, crop.shape[0] // 8)
        candidates: list[tuple[int, float]] = []
        for x in range(max(4, round(width * 0.08)), min(width - 4, round(width * 0.92))):
            strip = np.max(crop[:, x - 3 : x + 4], axis=1)
            coverage = float(np.mean(strip))
            end_coverage = min(float(np.mean(strip[:edge_length])), float(np.mean(strip[-edge_length:])))
            if coverage >= 0.72 and end_coverage >= 0.45:
                candidates.append((x, coverage + end_coverage))
        clusters: list[list[tuple[int, float]]] = []
        for candidate in candidates:
            if not clusters or candidate[0] - clusters[-1][-1][0] > max(5, round(width * 0.035)):
                clusters.append([candidate])
            else:
                clusters[-1].append(candidate)
        split_candidates = [max(cluster, key=lambda item: item[1]) for cluster in clusters]

        # Pencil panel rules are often slightly diagonal, so one fixed x-column may
        # not stay dark from the top edge to the bottom edge. Hough line segments
        # recover those rules while requiring them to span nearly the whole band;
        # this excludes most character and text strokes inside a panel.
        edges = cv2.Canny(gray[top_px:bottom_px], 35, 110)
        lines = cv2.HoughLinesP(
            edges,
            1,
            np.pi / 360,
            threshold=max(20, crop.shape[0] // 6),
            minLineLength=max(55, round(crop.shape[0] * 0.58)),
            maxLineGap=max(18, round(crop.shape[0] * 0.15)),
        )
        if lines is not None:
            for x1, y1, x2, y2 in lines.reshape(-1, 4):
                delta_x = abs(int(x2) - int(x1))
                delta_y = abs(int(y2) - int(y1))
                line_top = min(int(y1), int(y2))
                line_bottom = max(int(y1), int(y2))
                midpoint_x = round((int(x1) + int(x2)) / 2)
                if (
                    delta_y >= crop.shape[0] * 0.62
                    and delta_x <= max(22, delta_y * 0.28)
                    and line_top <= crop.shape[0] * 0.13
                    and line_bottom >= crop.shape[0] * 0.87
                    and round(width * 0.08) <= midpoint_x <= round(width * 0.92)
                ):
                    line_score = 2.0 + delta_y / crop.shape[0] - delta_x / max(delta_y, 1)
                    split_candidates.append((midpoint_x, line_score))
        split_candidates.sort(key=lambda item: item[0])
        merged_splits: list[list[tuple[int, float]]] = []
        for split in split_candidates:
            if not merged_splits or split[0] - merged_splits[-1][-1][0] > max(5, round(width * 0.06)):
                merged_splits.append([split])
            else:
                merged_splits[-1].append(split)
        scored_splits = [max(cluster, key=lambda item: item[1]) for cluster in merged_splits]

        # A long balloon edge or handwritten stroke can resemble a panel rule.
        # Reject any candidate that would leave an implausibly narrow cell, and
        # keep the stronger line when two candidates crowd the same cell.
        minimum_cell_width = 0.16
        while scored_splits:
            positions = [left, *(x / width for x, _ in scored_splits), left + band_width]
            gaps = [right - cell_left for cell_left, right in zip(positions, positions[1:])]
            narrowest = min(range(len(gaps)), key=gaps.__getitem__)
            if gaps[narrowest] >= minimum_cell_width:
                break
            if narrowest == 0:
                del scored_splits[0]
            elif narrowest == len(gaps) - 1:
                scored_splits.pop()
            elif scored_splits[narrowest - 1][1] < scored_splits[narrowest][1]:
                del scored_splits[narrowest - 1]
            else:
                del scored_splits[narrowest]
        splits = [x / width for x, _ in scored_splits]
        boundaries = [left, *splits, left + band_width]
        for cell_left, cell_right in zip(boundaries, boundaries[1:]):
            if cell_right - cell_left >= minimum_cell_width:
                boxes.append((cell_left, top, cell_right - cell_left, band_height))
    return boxes if 2 <= len(boxes) <= 8 else bands


def run_local_worker(
    *,
    python: Path,
    engine: str,
    root: Path,
    image_bytes: bytes,
    model: Path | None = None,
    confidence: float = 0.2,
    request: dict[str, Any] | None = None,
) -> dict[str, Any]:
    worker = Path(__file__).with_name("local_vision_worker.py")
    if not python.is_file() or not worker.is_file():
        raise FileNotFoundError(f"{engine}のローカル実行環境が見つかりません")
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(prefix="nyamuru-vision-", suffix=".jpg", delete=False) as temporary:
            temporary.write(image_bytes)
            temporary_path = Path(temporary.name)
        command = [
            str(python), str(worker), "--engine", engine, "--root", str(root),
            "--image", str(temporary_path), "--confidence", str(confidence),
        ]
        if model is not None:
            command.extend(("--model", str(model)))
        worker_environment = os.environ.copy()
        if engine == "orientation":
            # ONNX Runtime 1.29 otherwise leaves a stray `:memory:.ses` file on macOS.
            worker_environment["ORT_DISABLE_TELEMETRY"] = "1"
        completed = subprocess.run(
            command,
            input=json.dumps(request or {}, ensure_ascii=False),
            capture_output=True,
            text=True,
            timeout=90,
            env=worker_environment,
        )
        try:
            payload = json.loads(completed.stdout.strip())
        except json.JSONDecodeError as exc:
            detail = completed.stderr.strip()[-500:]
            raise RuntimeError(f"{engine}の応答を解釈できません: {detail}") from exc
        if completed.returncode != 0 or payload.get("ok") is not True or not isinstance(payload.get("result"), dict):
            raise RuntimeError(str(payload.get("error") or completed.stderr.strip() or f"{engine} failed"))
        return payload["result"]
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def ocr_text_quality(text: str) -> float:
    compact = "".join(text.split())
    if not compact:
        return 0.0
    japanese = sum("\u3040" <= char <= "\u30ff" or "\u3400" <= char <= "\u9fff" for char in compact)
    latin = sum(char.isascii() and char.isalpha() for char in compact)
    repeated = max((compact.count(char) for char in set(compact)), default=0)
    return japanese * 2.0 + min(len(compact), 24) * 0.08 - latin * 0.6 - max(0, repeated - 5)


def usable_ocr_lines(payload: dict[str, Any]) -> list[dict[str, Any]]:
    width = float(payload.get("width", 0) or 0)
    height = float(payload.get("height", 0) or 0)
    if width <= 0 or height <= 0:
        return []
    raw = []
    if isinstance(payload.get("region_lines"), list):
        raw.extend(payload["region_lines"])
    if isinstance(payload.get("detected_lines"), list):
        raw.extend(payload["detected_lines"])
    selected: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        bbox = item.get("bbox")
        if not isinstance(bbox, list) or len(bbox) != 4:
            continue
        try:
            x, y, box_width, box_height = (float(value) for value in bbox)
        except (TypeError, ValueError):
            continue
        text = str(item.get("text", "")).strip()
        quality = ocr_text_quality(text)
        area_ratio = max(0.0, box_width) * max(0.0, box_height) / (width * height)
        if not text or area_ratio > 0.18 or quality < -1.0:
            continue
        normalized = {
            "id": str(item.get("id", f"ocr-{len(selected)}")),
            "text": text[:500],
            "bbox": [x / width, y / height, box_width / width, box_height / height],
            "confidence": max(0.0, min(1.0, float(item.get("confidence", 0) or 0))),
            "vertical": bool(item.get("vertical", False)),
            "source": str(item.get("detection_source", "ndlocr")),
            "quality": round(quality, 3),
            "needs_review": quality < 2.0 or float(item.get("confidence", 0) or 0) < 0.45,
        }
        duplicate = False
        for previous in selected:
            px, py, pw, ph = previous["bbox"]
            cx, cy, cw, ch = normalized["bbox"]
            overlap_w = max(0.0, min(px + pw, cx + cw) - max(px, cx))
            overlap_h = max(0.0, min(py + ph, cy + ch) - max(py, cy))
            overlap = overlap_w * overlap_h
            smaller = min(pw * ph, cw * ch)
            if smaller > 0 and overlap / smaller > 0.72:
                duplicate = True
                if normalized["quality"] > previous["quality"]:
                    previous.update(normalized)
                break
        if not duplicate:
            selected.append(normalized)
    return sorted(selected, key=lambda item: (round((item["bbox"][1] + item["bbox"][3] / 2) / 0.12), -(item["bbox"][0] + item["bbox"][2] / 2)))[:24]


def rotated_image_bytes(image_bytes: bytes, degrees_clockwise: int) -> bytes:
    from PIL import Image, ImageOps

    with Image.open(io.BytesIO(image_bytes)) as source:
        if not degrees_clockwise and source.getexif().get(274, 1) == 1:
            return image_bytes
        image = ImageOps.exif_transpose(source).convert("RGB")
        if degrees_clockwise:
            image = image.rotate(-degrees_clockwise, expand=True, fillcolor="white")
        output = io.BytesIO()
        image.save(output, format="JPEG", quality=94)
    return output.getvalue()


def normalized_image_size(image_bytes: bytes) -> tuple[int, int]:
    from PIL import Image, ImageOps

    with Image.open(io.BytesIO(image_bytes)) as source:
        return ImageOps.exif_transpose(source).size


def rank_candidates_with_orientation(
    image_bytes: bytes,
    candidates: list[dict[str, Any]],
) -> tuple[list[tuple[dict[str, Any], float]], int, int]:
    best_by_id: dict[str, tuple[dict[str, Any], float]] = {}
    orientation_scores: list[tuple[float, int, int]] = []
    for rotation in (0, 90, 180, 270):
        ranked, detected_count = rank_candidates(rotated_image_bytes(image_bytes, rotation), candidates)
        if ranked:
            orientation_scores.append((ranked[0][1], rotation, detected_count))
        for candidate, score in ranked:
            current = best_by_id.get(candidate["id"])
            if current is None or score < current[1]:
                best_by_id[candidate["id"]] = (candidate, score)
    ranked = sorted(best_by_id.values(), key=lambda item: item[1])
    if not orientation_scores:
        return ranked, 0, 0
    _, fallback_rotation, detected_count = min(orientation_scores, key=lambda item: item[0])
    return ranked, fallback_rotation, detected_count


def make_orientation_image(image_bytes: bytes):
    import numpy as np
    import torch
    from PIL import Image, ImageDraw, ImageOps

    source = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes))).convert("RGB")
    canvas = Image.new("RGB", (1900, 1400), "white")
    draw = ImageDraw.Draw(canvas)
    draw.text((20, 12), "CHOOSE THE OPTION WHERE JAPANESE TEXT AND DRAWINGS ARE UPRIGHT", fill="black")
    rotations = (0, 90, 180, 270)
    cell_w, cell_h = 920, 650
    for index, rotation in enumerate(rotations):
        col, row = index % 2, index // 2
        left, top = 20 + col * 940, 40 + row * 675
        draw.text((left + 8, top + 6), f"ROTATE {rotation} DEG CLOCKWISE", fill="black")
        source_box = (left, top + 28, left + cell_w, top + cell_h)
        oriented = source if rotation == 0 else source.rotate(-rotation, expand=True, fillcolor="white")
        fitted = ImageOps.contain(oriented, (cell_w - 16, cell_h - 44))
        canvas.paste(fitted, (left + (cell_w - fitted.width) // 2, top + 34 + (cell_h - 44 - fitted.height) // 2))
        draw.rectangle(source_box, outline="#444444", width=3)
    array = np.asarray(canvas, dtype=np.float32) / 255.0
    return torch.from_numpy(array).unsqueeze(0)


def make_comparison_image(image_bytes: bytes, candidates: list[dict[str, Any]]):
    import numpy as np
    import torch
    from PIL import Image, ImageDraw, ImageOps

    source = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes))).convert("RGB")
    canvas = Image.new("RGB", (1800, 1270), "white")
    draw = ImageDraw.Draw(canvas)
    draw.text((20, 12), "UPRIGHT SOURCE PAGE", fill="black")
    source_box = (30, 44, 870, 1240)
    fitted = ImageOps.contain(source, (source_box[2] - source_box[0], source_box[3] - source_box[1]))
    canvas.paste(fitted, (source_box[0] + (840 - fitted.width) // 2, source_box[1] + (1196 - fitted.height) // 2))
    draw.rectangle(source_box, outline="#444444", width=3)
    draw.text((920, 12), "CANDIDATE TEMPLATES", fill="black")
    columns = 2 if len(candidates) <= 6 else 5
    candidate_cell_w = 435 if columns == 2 else 174
    rows = max(1, (len(candidates) + columns - 1) // columns)
    candidate_cell_h = min(390, 1200 // rows)
    for index, candidate in enumerate(candidates[:25]):
        col, row = index % columns, index // columns
        left, top = 910 + col * candidate_cell_w, 40 + row * candidate_cell_h
        draw_candidate(draw, candidate, (left, top, left + candidate_cell_w - 8, top + candidate_cell_h - 8))
    array = np.asarray(canvas, dtype=np.float32) / 255.0
    return torch.from_numpy(array).unsqueeze(0)


def make_ocr_review_image(image_bytes: bytes, lines: list[dict[str, Any]]):
    import numpy as np
    import torch
    from PIL import Image, ImageDraw, ImageOps

    source = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes))).convert("RGB")
    source.thumbnail((1500, 1900))
    draw = ImageDraw.Draw(source)
    width, height = source.size
    for line in lines:
        x, y, box_width, box_height = line["bbox"]
        left, top = round(x * width), round(y * height)
        right, bottom = round((x + box_width) * width), round((y + box_height) * height)
        draw.rectangle((left, top, right, bottom), outline="#e00000", width=max(2, width // 450))
        label = line["id"]
        label_box = draw.textbbox((left, max(0, top - 18)), label)
        draw.rectangle(label_box, fill="white")
        draw.text((left, max(0, top - 18)), label, fill="#c00000")
    array = np.asarray(source, dtype=np.float32) / 255.0
    return torch.from_numpy(array).unsqueeze(0)


def parse_ocr_review(raw: str, valid_ids: set[str]) -> dict[str, str]:
    cleaned = raw.strip().replace("```json", "").replace("```", "").strip()
    match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
    if not match:
        return {}
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError:
        return {}
    items = parsed.get("lines") if isinstance(parsed, dict) else None
    if not isinstance(items, list):
        return {}
    result: dict[str, str] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        line_id = str(item.get("id", ""))
        text = str(item.get("text", "")).strip()
        if line_id in valid_ids and text and text.upper() not in {"UNREADABLE", "NONE", "N/A"}:
            result[line_id] = text[:500]
    return result


def apply_qwen_ocr_suggestions(lines: list[dict[str, Any]], suggestions: dict[str, str]) -> int:
    changed = 0
    for line in lines:
        suggestion = suggestions.get(line["id"])
        if not suggestion or suggestion == line["text"]:
            continue
        line["qwen_text"] = suggestion
        line["needs_review"] = True
        # Qwen is only an explicitly marked fallback for obviously broken OCR.
        # Plausible NDLOCR text remains primary so semantic guessing cannot silently replace transcription.
        if line["quality"] < 1.0 and ocr_text_quality(suggestion) >= line["quality"] + 2.0:
            line["text"] = suggestion
            line["source"] = "qwen-fallback"
            line["quality"] = round(ocr_text_quality(suggestion), 3)
            changed += 1
    return changed


def parse_model_result(raw: str, valid_ids: set[str]) -> dict[str, Any]:
    cleaned = raw.strip().replace("```json", "").replace("```", "").strip()
    match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
    parsed: dict[str, Any] = {}
    if match:
        try:
            value = json.loads(match.group(0))
            if isinstance(value, dict):
                parsed = value
        except json.JSONDecodeError:
            pass
    candidate_id = str(parsed.get("template_id", "NONE")).strip().upper()
    if candidate_id not in valid_ids:
        fallback = re.search(r"(?:PATTERN|TEMPLATE|パターン)\s*([A-Z])\b", cleaned, flags=re.IGNORECASE)
        candidate_id = fallback.group(1).upper() if fallback else "NONE"
    try:
        confidence = max(0.0, min(1.0, float(parsed.get("confidence", 0.5 if candidate_id != "NONE" else 0))))
    except (TypeError, ValueError):
        confidence = 0.5 if candidate_id != "NONE" else 0.0
    reason = str(parsed.get("reason") or "画像内のコマ枠配置に最も近い候補です。" if candidate_id != "NONE" else "近い候補を特定できませんでした。")
    try:
        rotation = int(parsed.get("rotation_degrees", -1))
    except (TypeError, ValueError):
        rotation = -1
    if rotation not in {0, 90, 180, 270}:
        fallback = re.search(r"ROTAT(?:E|ION)[^0-9]*(0|90|180|270)", cleaned, flags=re.IGNORECASE)
        rotation = int(fallback.group(1)) if fallback else -1
    return {"template_id": candidate_id, "confidence": confidence, "reason": reason[:500], "rotation_degrees": rotation}


def parse_orientation_result(raw: str, fallback_rotation: int) -> int:
    cleaned = raw.strip().replace("```json", "").replace("```", "").strip()
    match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
    parsed: dict[str, Any] = {}
    if match:
        try:
            value = json.loads(match.group(0))
            if isinstance(value, dict):
                parsed = value
        except json.JSONDecodeError:
            pass
    try:
        rotation = int(parsed.get("rotation_degrees", -1))
    except (TypeError, ValueError):
        rotation = -1
    if rotation not in {0, 90, 180, 270}:
        fallback = re.search(r"(?:ROTAT(?:E|ION)|DEGREES?)[^0-9]*(0|90|180|270)", cleaned, flags=re.IGNORECASE)
        rotation = int(fallback.group(1)) if fallback else fallback_rotation
    return rotation


class VlmState:
    def __init__(
        self,
        comfy_root: Path,
        model_name: str,
        manga_babble_root: Path,
        ndlocr_root: Path,
        rapid_orientation_root: Path,
        qwen_mode: str,
    ):
        self.comfy_root = comfy_root.resolve()
        self.node_root = self.comfy_root / "custom_nodes" / "ComfyUI-QwenVL"
        self.model_name = model_name
        self.manga_babble_root = manga_babble_root.resolve()
        self.rtdetr_python = self.manga_babble_root / ".venv" / "bin" / "python"
        self.rtdetr_model = self.manga_babble_root / "models" / "rtdetrv4-x-manga109s_v2" / "model.onnx"
        self.ndlocr_root = ndlocr_root.resolve()
        self.ndlocr_python = self.ndlocr_root / ".venv" / "bin" / "python"
        self.rapid_orientation_root = rapid_orientation_root.resolve()
        self.rapid_orientation_python = self.rapid_orientation_root / ".venv" / "bin" / "python"
        rapid_models = list(
            (self.rapid_orientation_root / ".venv" / "lib").glob(
                "python*/site-packages/rapid_orientation/models/rapid_orientation.onnx"
            )
        )
        self.rapid_orientation_model = rapid_models[0] if rapid_models else None
        self.qwen_mode = qwen_mode
        self.node = None
        self.lock = threading.Lock()
        self.scanners = ScannerSessions()

    def qwen_available(self) -> bool:
        model_paths = list((self.comfy_root / "models" / "llm").rglob(self.model_name))
        return (self.node_root / "AILab_QwenVL_GGUF.py").is_file() and bool(model_paths)

    def check(self) -> dict[str, Any]:
        model_paths = list((self.comfy_root / "models" / "llm").rglob(self.model_name))
        return {
            "comfy_root": str(self.comfy_root),
            "node_available": (self.node_root / "AILab_QwenVL_GGUF.py").is_file(),
            "model_available": bool(model_paths),
            "model": self.model_name,
            "model_loaded": self.node is not None,
            "qwen_mode": self.qwen_mode,
            "rtdetr_available": self.rtdetr_python.is_file() and self.rtdetr_model.is_file(),
            "rtdetr_model": str(self.rtdetr_model),
            "ndlocr_available": self.ndlocr_python.is_file() and (self.ndlocr_root / "src" / "model").is_dir(),
            "ndlocr_root": str(self.ndlocr_root),
            "rapid_orientation_available": (
                self.rapid_orientation_python.is_file()
                and self.rapid_orientation_model is not None
                and self.rapid_orientation_model.is_file()
            ),
            "rapid_orientation_root": str(self.rapid_orientation_root),
            "scanner_available": Path("/System/Applications/Image Capture.app").is_dir(),
        }

    def _node(self):
        if self.node is None:
            sys.path.insert(0, str(self.comfy_root))
            sys.path.insert(0, str(self.node_root))
            from AILab_QwenVL_GGUF import AILab_QwenVL_GGUF_Advanced

            self.node = AILab_QwenVL_GGUF_Advanced()
        return self.node

    def _process(self, image, prompt: str, max_tokens: int) -> str:
        with self.lock:
            (raw,) = self._node().process(
                model_name=self.model_name,
                device="mps",
                preset_prompt="🖼️ Simple Description",
                custom_prompt=prompt,
                max_tokens=max_tokens,
                temperature=0.1,
                top_p=0.8,
                repetition_penalty=1.05,
                frame_count=1,
                ctx=8192,
                n_batch=512,
                gpu_layers=-1,
                image_max_tokens=2048,
                top_k=0,
                pool_size=4194304,
                keep_model_loaded=True,
                seed=1,
                image=image,
            )
        return raw

    def _review_ocr(self, upright_bytes: bytes, lines: list[dict[str, Any]]) -> dict[str, str]:
        current = "\n".join(f"{line['id']}: {line['text']}" for line in lines)
        prompt = f"""This is a faint handwritten Japanese manga storyboard page. Red boxes identify OCR regions.
Transcribe only characters that are actually visible inside each labeled box. Preserve Japanese writing order inside each region. Do not infer missing dialogue from context. If unreadable, write UNREADABLE.
Current specialized-OCR guesses (they may be wrong):
{current}
Return exactly one JSON object and no other text:
{{"lines":[{{"id":"region id","text":"exact visible transcription or UNREADABLE"}}]}}"""
        raw = self._process(make_ocr_review_image(upright_bytes, lines), prompt, min(768, 96 + len(lines) * 80))
        return parse_ocr_review(raw, {line["id"] for line in lines})

    def analyze(
        self,
        image_bytes: bytes,
        candidates: list[dict[str, Any]],
        rotation_override: int | None = None,
    ) -> dict[str, Any]:
        if not candidates:
            raise ValueError("比較するコマ割り候補がありません")
        _, fallback_rotation, _ = rank_candidates_with_orientation(image_bytes, candidates)
        qwen_ready = self.qwen_available() and self.qwen_mode != "off"
        rotation = fallback_rotation
        orientation: dict[str, Any] = {
            "engine": "panel-structure fallback",
            "confidence": 0.0,
            "threshold": RAPID_ORIENTATION_CONFIDENCE,
            "high_confidence": False,
            "observed_rotation_degrees": None,
            "correction_degrees": fallback_rotation,
        }
        if rotation_override is not None:
            rotation = rotation_override
            orientation = {
                "engine": "手動指定",
                "confidence": 1.0,
                "threshold": RAPID_ORIENTATION_CONFIDENCE,
                "high_confidence": True,
                "observed_rotation_degrees": None,
                "correction_degrees": rotation_override,
            }
        elif self.rapid_orientation_python.is_file():
            try:
                rapid = run_local_worker(
                    python=self.rapid_orientation_python,
                    engine="orientation",
                    root=self.rapid_orientation_root,
                    image_bytes=image_bytes,
                )
                rapid_rotation = int(rapid.get("correction_degrees", fallback_rotation))
                rapid_confidence = max(0.0, min(1.0, float(rapid.get("confidence", 0) or 0)))
                rapid_high_confidence = (
                    rapid_rotation in {0, 90, 180, 270}
                    and rapid_confidence >= RAPID_ORIENTATION_CONFIDENCE
                )
                orientation = {
                    **rapid,
                    "threshold": RAPID_ORIENTATION_CONFIDENCE,
                    "high_confidence": rapid_high_confidence,
                }
                if rapid_high_confidence:
                    rotation = rapid_rotation
            except (OSError, RuntimeError, ValueError) as exc:
                orientation["error"] = str(exc)
        qwen_orientation_used = False
        # A live rough-name comparison showed that Qwen chose 0° for both the
        # upright page and the upside-down page. Keep it as an explicit
        # diagnostic comparison, not an automatic fallback that starts an 8B
        # model without improving this decision.
        should_use_qwen_orientation = (
            rotation_override is None and qwen_ready and self.qwen_mode == "compare"
        )
        if should_use_qwen_orientation:
            orientation_prompt = """The image shows the same Japanese manga storyboard page in four labeled rotation options.
Read Japanese handwriting, speech, page numbers, and inspect the drawings. Choose the one option where text and drawings are upright and naturally readable.
Return exactly one JSON object and no other text:
{"rotation_degrees":0}
rotation_degrees must be exactly one of 0, 90, 180, or 270 and means clockwise correction applied to the original image."""
            orientation_raw = self._process(make_orientation_image(image_bytes), orientation_prompt, 64)
            qwen_rotation = parse_orientation_result(orientation_raw, fallback_rotation)
            orientation["qwen_correction_degrees"] = qwen_rotation
            orientation["qwen_agreed"] = (
                qwen_rotation == orientation.get("correction_degrees")
                if orientation.get("engine") == "RapidOrientation"
                else None
            )
            if not orientation["high_confidence"]:
                rotation = qwen_rotation
            qwen_orientation_used = True
        width, height = normalized_image_size(image_bytes)
        expected_rotations = {90, 270} if width > height else {0, 180}
        if rotation not in expected_rotations:
            rotation = fallback_rotation if fallback_rotation in expected_rotations else min(expected_rotations)
        if rotation_override is None and not orientation["high_confidence"]:
            return {
                "template_id": "NONE",
                "confidence": 0.0,
                "reason": "画像の上下を自動判定できませんでした。プレビュー下の回転ボタンで正立にし、もう一度ローカル解析してください。",
                "rotation_degrees": rotation,
                "orientation": {**orientation, "requires_review": True},
                "detected_panel_count": 0,
                "alternatives": [],
                "structure": {
                    "engine": "向き確認待ち",
                    "rtdetr_frame_count": 0,
                    "opencv_frame_count": 0,
                    "separator_panel_count": 0,
                    "grid_panel_count": 0,
                    "score_gap": 0.0,
                },
                "ocr": {
                    "engine": "NDLOCR-Lite",
                    "lines": [],
                    "line_count": 0,
                    "qwen_used": False,
                    "qwen_changed": 0,
                },
                "qwen": {
                    "mode": self.qwen_mode,
                    "orientation_used": qwen_orientation_used,
                    "layout": {"used": False, "template_id": None, "agreed": None},
                    "ocr_used": False,
                    "ocr_changed": 0,
                },
            }
        upright_bytes = rotated_image_bytes(image_bytes, rotation)

        detection = run_local_worker(
            python=self.rtdetr_python,
            engine="rtdetr",
            root=self.manga_babble_root,
            image_bytes=upright_bytes,
            model=self.rtdetr_model,
            confidence=0.2,
        )
        rtdetr_boxes = detector_boxes(detection, "frames")
        opencv_boxes = detect_panel_boxes(upright_bytes)
        separator_boxes = detect_separator_panel_boxes(upright_bytes)
        grid_boxes = detect_grid_panel_boxes(upright_bytes)
        if grid_boxes:
            layout_boxes, detector_name = grid_boxes, "罫線グリッド"
        elif len(rtdetr_boxes) >= 2:
            layout_boxes, detector_name = rtdetr_boxes, "RT-DETR"
        elif separator_boxes:
            layout_boxes, detector_name = separator_boxes, "RT-DETR＋罫線補助"
        elif rtdetr_boxes:
            layout_boxes, detector_name = rtdetr_boxes, "RT-DETR"
        else:
            layout_boxes, detector_name = opencv_boxes, "OpenCV"
        ranked = rank_candidates_from_boxes(layout_boxes, candidates)
        detected_count = len(layout_boxes)
        structural_best, structural_score = ranked[0]
        second_score = ranked[1][1] if len(ranked) > 1 else structural_score + 1
        structural_gap = max(0.0, second_score - structural_score)
        structural_confidence = max(0.0, min(0.92, 1 / (1 + structural_score))) if detected_count else 0.0

        qwen_layout: dict[str, Any] = {"used": False, "template_id": None, "agreed": None}
        should_compare_layout = qwen_ready and self.qwen_mode == "compare"
        if should_compare_layout:
            shortlist = [candidate for candidate, _ in ranked[:5]] if detected_count else candidates
            names = "\n".join(f"{item['id']}: {item['name']} ({len(item['shapes'])} panels)" for item in shortlist)
            prompt = f"""The left side is an upright scanned or photographed manga storyboard page.
The right side is a labeled grid of candidate panel-layout templates A through Z.
Ignore drawings, handwriting, speech balloons, and page content. Compare only the panel-border count, positions, sizes, diagonals, overlaps, and page-edge bleed.
Choose the single closest template. If the source has no readable panel borders or no reasonable match, choose NONE.
Candidates:
{names}
Return exactly one JSON object and no other text:
{{"template_id":"A-Z or NONE","confidence":0.0,"reason":"short Japanese explanation"}}"""
            raw = self._process(make_comparison_image(upright_bytes, shortlist), prompt, 192)
            qwen_result = parse_model_result(raw, {item["id"] for item in shortlist})
            qwen_template = (
                qwen_result["template_id"]
                if qwen_result["template_id"] != "NONE" and qwen_result["confidence"] >= 0.35
                else None
            )
            qwen_layout = {
                "used": True,
                "template_id": qwen_template,
                "confidence": qwen_result["confidence"],
                "agreed": qwen_template == structural_best["id"] if detected_count and qwen_template else None,
            }

        text_regions = []
        buckets = detection.get("detections") if isinstance(detection.get("detections"), dict) else {}
        if isinstance(buckets.get("texts"), list):
            text_regions = [item for item in buckets["texts"] if isinstance(item, dict)]
        ocr_payload = run_local_worker(
            python=self.ndlocr_python,
            engine="ndlocr",
            root=self.ndlocr_root,
            image_bytes=upright_bytes,
            request={"regions": text_regions},
        )
        ocr_lines = usable_ocr_lines(ocr_payload)
        qwen_ocr_used = False
        qwen_ocr_changed = 0
        should_review_ocr = qwen_ready and bool(ocr_lines) and self.qwen_mode == "compare"
        if should_review_ocr:
            suggestions = self._review_ocr(upright_bytes, ocr_lines)
            qwen_ocr_used = True
            qwen_ocr_changed = apply_qwen_ocr_suggestions(ocr_lines, suggestions)

        if detected_count:
            result = {
                "template_id": structural_best["id"],
                "confidence": structural_confidence,
                "reason": f"{detector_name}で{detected_count}個のコマ領域を検出し、座標からパターン{structural_best['id']}を選びました。",
            }
            if qwen_layout.get("agreed") is True:
                result["confidence"] = min(0.97, max(result["confidence"], float(qwen_layout.get("confidence", 0))))
                result["reason"] += " Qwen3-VLの比較結果も一致しました。"
            elif qwen_layout.get("used") and qwen_layout.get("template_id"):
                result["reason"] += f" Qwen3-VLは{qwen_layout['template_id']}を提案したため、確定後の目視確認が必要です。"
        else:
            result = {
                "template_id": "NONE",
                "confidence": 0.0,
                "reason": "専用検出器で読み取れるコマ領域が見つからなかったため、自動候補を確定しませんでした。",
            }
        result["rotation_degrees"] = rotation
        result["orientation"] = orientation
        result["detected_panel_count"] = detected_count
        result["alternatives"] = [item["id"] for item, _ in ranked[:5]]
        result["structure"] = {
            "engine": detector_name,
            "rtdetr_frame_count": len(rtdetr_boxes),
            "opencv_frame_count": len(opencv_boxes),
            "separator_panel_count": len(separator_boxes),
            "grid_panel_count": len(grid_boxes),
            "score_gap": round(structural_gap, 4),
        }
        result["ocr"] = {
            "engine": "NDLOCR-Lite",
            "lines": ocr_lines,
            "line_count": len(ocr_lines),
            "qwen_used": qwen_ocr_used,
            "qwen_changed": qwen_ocr_changed,
        }
        result["qwen"] = {
            "mode": self.qwen_mode,
            "orientation_used": qwen_orientation_used,
            "layout": qwen_layout,
            "ocr_used": qwen_ocr_used,
            "ocr_changed": qwen_ocr_changed,
        }
        return result


class BridgeHandler(BaseHTTPRequestHandler):
    server_version = "NyamuruLocalBridge/0.1"

    @property
    def state(self) -> VlmState:
        return self.server.state  # type: ignore[attr-defined]

    def allowed_origin(self) -> str | None:
        origin = self.headers.get("Origin")
        if origin is None:
            return None
        return origin if ALLOWED_ORIGIN.fullmatch(origin) else ""

    def send_json(self, status: int, payload: object) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        origin = self.allowed_origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self) -> None:
        if self.allowed_origin() == "":
            self.send_json(403, {"error": "このOriginからの接続は許可されていません"})
            return
        self.send_response(204)
        origin = self.allowed_origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        if self.allowed_origin() == "":
            self.send_json(403, {"error": "このOriginからの接続は許可されていません"})
            return
        if urlparse(self.path).path == "/api/health":
            self.send_json(200, {"ok": True, **self.state.check()})
        else:
            self.send_json(404, {"error": "Not found"})

    def read_json(self) -> dict[str, Any]:
        if not self.headers.get("Content-Type", "").lower().startswith("application/json"):
            raise ValueError("Content-Typeはapplication/jsonで送信してください")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("Content-Lengthが正しくありません") from exc
        if length <= 0 or length > MAX_BODY_BYTES:
            raise ValueError("リクエストサイズが上限を超えています")
        value = json.loads(self.rfile.read(length))
        if not isinstance(value, dict):
            raise ValueError("JSONオブジェクトが必要です")
        return value

    def do_POST(self) -> None:
        if self.allowed_origin() == "":
            self.send_json(403, {"error": "このOriginからの接続は許可されていません"})
            return
        try:
            body = self.read_json()
            path = urlparse(self.path).path
            if path == "/api/scanner/open":
                session = self.state.scanners.start()
                try:
                    subprocess.run(["/usr/bin/open", "-b", "com.apple.Image_Capture"], check=True, timeout=10)
                except Exception:
                    self.state.scanners.cancel(session["session_id"])
                    raise
                self.send_json(200, {"ok": True, **session})
                return
            if path == "/api/scanner/collect":
                self.send_json(200, self.state.scanners.collect(body.get("session_id")))
                return
            if path == "/api/scanner/pending":
                self.send_json(200, self.state.scanners.pending())
                return
            if path == "/api/scanner/resume":
                self.send_json(200, self.state.scanners.resume())
                return
            if path == "/api/scanner/discard-pending":
                self.send_json(200, self.state.scanners.discard_pending())
                return
            if path == "/api/scanner/commit":
                self.send_json(200, self.state.scanners.commit(body.get("session_id")))
                return
            if path == "/api/scanner/finish":
                self.send_json(200, self.state.scanners.finish(body.get("session_id")))
                return
            if path == "/api/scanner/cancel":
                session_id = body.get("session_id")
                if not isinstance(session_id, str):
                    raise ValueError("スキャン待機セッションが見つかりません")
                self.send_json(200, self.state.scanners.cancel(session_id))
                return
            if path == "/api/layout/analyze":
                candidates = [candidate for item in body.get("candidates", []) if (candidate := normalized_candidate(item))]
                rotation_override = normalized_rotation_override(body.get("rotation_override_degrees"))
                result = self.state.analyze(decode_image_data(body.get("image")), candidates, rotation_override)
                self.send_json(200, result)
                return
            self.send_json(404, {"error": "Not found"})
        except (ValueError, json.JSONDecodeError) as exc:
            self.send_json(400, {"error": str(exc)})
        except subprocess.SubprocessError as exc:
            self.send_json(500, {"error": f"スキャナーアプリを起動できませんでした: {exc}"})
        except Exception as exc:
            print(f"[bridge] error: {exc}", file=sys.stderr)
            self.send_json(500, {"error": f"ローカル処理に失敗しました: {exc}"})

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"[bridge] {self.address_string()} {fmt % args}")


def main() -> int:
    args = parse_args()
    state = VlmState(
        args.comfy_root,
        args.model,
        args.manga_babble_root,
        args.ndlocr_root,
        args.rapid_orientation_root,
        args.qwen_mode,
    )
    status = state.check()
    if args.check:
        print(json.dumps(status, ensure_ascii=False, indent=2))
        return 0 if (
            status["rtdetr_available"]
            and status["ndlocr_available"]
            and status["rapid_orientation_available"]
        ) else 1
    server = ThreadingHTTPServer((args.host, args.port), BridgeHandler)
    server.state = state  # type: ignore[attr-defined]
    print(f"Nyamuru local bridge: http://{args.host}:{args.port}")
    print(f"RT-DETR: {state.rtdetr_model}")
    print(f"NDLOCR-Lite: {state.ndlocr_root}")
    print(f"RapidOrientation: {state.rapid_orientation_root}")
    qwen_usage = "比較時のみ" if args.qwen_mode != "compare" else "常時比較"
    print(f"Qwen3-VL ({args.qwen_mode}, {qwen_usage}): {args.model}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
