"""Subprocess worker lifecycle and local vision/VLM launch helpers for the bridge."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
TOOLS_ROOT = REPO_ROOT.parent
DEFAULT_VISION_ROOT = REPO_ROOT / ".local-vision"
DEFAULT_VLM_MODEL_LABEL = "lmstudio-community/Qwen3-VL-8B-Instruct-MLX-4bit"
DEFAULT_VLM_CACHE = (
    Path.home()
    / ".cache"
    / "huggingface"
    / "hub"
    / "models--lmstudio-community--Qwen3-VL-8B-Instruct-MLX-4bit"
)

ACTIVE_WORKERS_LOCK = threading.Lock()
ACTIVE_WORKERS: dict[subprocess.Popen[str], tuple[Path, ...]] = {}
WORKER_SHUTDOWN_EVENT = threading.Event()


def register_worker(process: subprocess.Popen[str], temporary_paths: list[Path]) -> None:
    with ACTIVE_WORKERS_LOCK:
        if WORKER_SHUTDOWN_EVENT.is_set():
            raise RuntimeError("bridgeの終了処理中のためモデルワーカーを起動しません")
        ACTIVE_WORKERS[process] = tuple(temporary_paths)


def unregister_worker(process: subprocess.Popen[str]) -> None:
    with ACTIVE_WORKERS_LOCK:
        ACTIVE_WORKERS.pop(process, None)


def stop_worker(process: subprocess.Popen[str], grace_seconds: float = 2.0) -> None:
    if process.poll() is not None:
        return
    try:
        process.terminate()
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=grace_seconds)
    except subprocess.TimeoutExpired:
        try:
            process.kill()
        except ProcessLookupError:
            pass
        process.wait(timeout=2)


def terminate_active_workers(grace_seconds: float = 2.0) -> None:
    with ACTIVE_WORKERS_LOCK:
        entries = list(ACTIVE_WORKERS.items())
    for process, _temporary_path in entries:
        if process.poll() is None:
            try:
                process.terminate()
            except ProcessLookupError:
                pass
    deadline = time.monotonic() + max(0.0, grace_seconds)
    for process, _temporary_path in entries:
        if process.poll() is not None:
            continue
        try:
            process.wait(timeout=max(0.0, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            try:
                process.kill()
            except ProcessLookupError:
                pass
    for process, temporary_paths in entries:
        try:
            process.wait(timeout=0.5)
        except subprocess.TimeoutExpired:
            pass
        unregister_worker(process)
        for temporary_path in temporary_paths:
            temporary_path.unlink(missing_ok=True)


def venv_python(venv_root: Path) -> Path:
    if os.name == "nt":
        return venv_root / "Scripts" / "python.exe"
    return venv_root / "bin" / "python"


def default_vision_paths() -> dict[str, Path]:
    vision_root = Path(os.environ.get("NYAMURU_VISION_ROOT", DEFAULT_VISION_ROOT)).expanduser()
    primary_python = venv_python(vision_root / ".venv")
    vision_python = Path(
        os.environ.get(
            "NYAMURU_VISION_PYTHON",
            primary_python,
        )
    ).expanduser()
    primary_model = vision_root / "models" / "rtdetrv4-x-manga109s_v2" / "model.onnx"
    rtdetr_model = Path(
        os.environ.get(
            "NYAMURU_RTDETR_MODEL",
            primary_model,
        )
    ).expanduser()
    preferred_baberu_model = vision_root / "models" / "baberu-ocr"
    baberu_model = Path(os.environ.get("NYAMURU_BABERU_MODEL", preferred_baberu_model)).expanduser()
    preferred_wd_expression_root = vision_root / "models" / "wd-vit-tagger-v3"
    wd_expression_model = Path(
        os.environ.get("NYAMURU_WD_EXPRESSION_MODEL", preferred_wd_expression_root / "model.onnx")
    ).expanduser()
    wd_expression_tags = Path(
        os.environ.get("NYAMURU_WD_EXPRESSION_TAGS", preferred_wd_expression_root / "selected_tags.csv")
    ).expanduser()
    return {
        "vision_root": vision_root,
        "vision_python": vision_python,
        "rtdetr_model": rtdetr_model,
        "baberu_model": baberu_model,
        "wd_expression_model": wd_expression_model,
        "wd_expression_tags": wd_expression_tags,
    }


def cached_model_snapshot(cache_root: Path) -> Path:
    reference = cache_root / "refs" / "main"
    try:
        revision = reference.read_text(encoding="utf-8").strip()
    except OSError:
        return cache_root / "snapshots" / "missing"
    return cache_root / "snapshots" / revision


def huggingface_hub_cache() -> Path:
    configured = os.environ.get("HF_HUB_CACHE", "").strip()
    if configured:
        return Path(configured).expanduser().absolute()
    hf_home = os.environ.get("HF_HOME", "").strip()
    if hf_home:
        return (Path(hf_home).expanduser() / "hub").absolute()
    xdg_cache = os.environ.get("XDG_CACHE_HOME", "").strip()
    if xdg_cache:
        return (Path(xdg_cache).expanduser() / "huggingface" / "hub").absolute()
    return (Path.home() / ".cache" / "huggingface" / "hub").absolute()


def default_vlm_paths() -> dict[str, Path | str]:
    configured_model = os.environ.get("NYAMURU_VLM_MODEL", "").strip()
    model = Path(configured_model).expanduser() if configured_model else cached_model_snapshot(DEFAULT_VLM_CACHE)
    configured_python = os.environ.get("NYAMURU_VLM_PYTHON", "").strip()
    python = Path(configured_python).expanduser() if configured_python else venv_python(TOOLS_ROOT / "ComfyUI" / ".venv")
    return {
        "vlm_python": python,
        "vlm_model": model,
        "vlm_model_label": os.environ.get("NYAMURU_VLM_MODEL_LABEL", DEFAULT_VLM_MODEL_LABEL).strip()
        or DEFAULT_VLM_MODEL_LABEL,
    }


def run_worker_process(
    command: list[str], *, request: dict[str, Any], temporary_paths: list[Path],
    engine: str, timeout_seconds: int, environment: dict[str, str] | None = None,
    allow_log_lines: bool = False,
) -> dict[str, Any]:
    """Own a short-lived model process, including failure and shutdown races.

    Model memory belongs to the child. Always reap it before dropping its
    registry entry; removing the entry alone would hide a live orphan.
    Temporary-file ownership stays with the caller even when Popen fails.
    """
    if WORKER_SHUTDOWN_EVENT.is_set():
        raise RuntimeError("bridgeの終了処理中のためモデルワーカーを起動しません")
    process = subprocess.Popen(
        command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, env=environment if environment is not None else os.environ.copy(),
    )
    try:
        register_worker(process, temporary_paths)
        stdout, stderr = process.communicate(
            input=json.dumps(request, ensure_ascii=False), timeout=timeout_seconds,
        )
        payload = None
        # MLX may print startup diagnostics; its final JSON envelope is authoritative.
        candidates = reversed(stdout.splitlines()) if allow_log_lines else [stdout.strip()]
        for line in candidates:
            try:
                candidate = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(candidate, dict):
                payload = candidate
                break
        if payload is None:
            raise RuntimeError(f"{engine}の応答を解釈できません: {stderr.strip()[-800:]}")
        if process.returncode != 0 or payload.get("ok") is not True or not isinstance(payload.get("result"), dict):
            raise RuntimeError(str(payload.get("error") or stderr.strip() or f"{engine} failed"))
        return payload["result"]
    finally:
        stop_worker(process)
        unregister_worker(process)
        for stream in (process.stdin, process.stdout, process.stderr):
            if stream is not None:
                stream.close()


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
    if WORKER_SHUTDOWN_EVENT.is_set():
        raise RuntimeError("bridgeの終了処理中のためモデルワーカーを起動しません")
    if not python.is_file() or not worker.is_file():
        raise FileNotFoundError(f"{engine}のローカル実行環境が見つかりません")
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(prefix="nyamuru-vision-", suffix=".image", delete=False) as temporary:
            temporary_path = Path(temporary.name)
            temporary.write(image_bytes)
        command = [
            str(python), str(worker), "--engine", engine, "--root", str(root),
            "--image", str(temporary_path), "--confidence", str(confidence),
        ]
        if model is not None:
            command.extend(("--model", str(model)))
        return run_worker_process(
            command, request=request or {}, temporary_paths=[temporary_path],
            engine=engine, timeout_seconds=90,
        )
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def run_mlx_vlm_worker(
    *,
    python: Path,
    model: Path,
    worker_name: str,
    image_bytes: bytes | list[bytes],
    request_payload: dict[str, Any],
    temporary_prefix: str,
    timeout_seconds: int = 10 * 60,
) -> dict[str, Any]:
    worker = Path(__file__).with_name(worker_name)
    if WORKER_SHUTDOWN_EVENT.is_set():
        raise RuntimeError("bridgeの終了処理中のためモデルワーカーを起動しません")
    if not python.is_file() or not worker.is_file():
        raise FileNotFoundError("Qwen3-VL/MLXのローカル実行環境が見つかりません")
    if not model.is_dir() or not (model / "config.json").is_file():
        raise FileNotFoundError("Qwen3-VLのローカルモデルが見つかりません")
    temporary_paths: list[Path] = []
    try:
        payloads = image_bytes if isinstance(image_bytes, list) else [image_bytes]
        if not payloads:
            raise ValueError("解析対象の画像がありません")
        for image_payload in payloads:
            with tempfile.NamedTemporaryFile(prefix=temporary_prefix, suffix=".image", delete=False) as temporary:
                temporary_paths.append(Path(temporary.name))
                temporary.write(image_payload)
        environment = {
            **os.environ, "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
            "HF_DATASETS_OFFLINE": "1", "TOKENIZERS_PARALLELISM": "false",
        }
        command = [str(python), str(worker), "--model", str(model)]
        for temporary_path in temporary_paths:
            command.extend(("--image", str(temporary_path)))
        return run_worker_process(
            command, request=request_payload, temporary_paths=temporary_paths,
            engine="Qwen3-VL", timeout_seconds=timeout_seconds,
            environment=environment, allow_log_lines=True,
        )
    finally:
        for temporary_path in temporary_paths:
            temporary_path.unlink(missing_ok=True)


def run_figure_performance_worker(
    *,
    python: Path,
    model: Path,
    image_bytes: bytes,
    current_size: str,
    expression_tagging: dict[str, Any] | None = None,
    face_image_bytes: bytes | None = None,
    face_bbox: list[float] | None = None,
) -> dict[str, Any]:
    return run_mlx_vlm_worker(
        python=python,
        model=model,
        worker_name="local_figure_performance_worker.py",
        image_bytes=image_bytes if face_image_bytes is None else [image_bytes, face_image_bytes],
        request_payload={
            "current_size": current_size, "expression_tagging": expression_tagging or {},
            "face_bbox": face_bbox,
        },
        temporary_prefix="nyamuru-figure-performance-",
    )


def run_character_reference_worker(
    *,
    python: Path,
    model: Path,
    image_bytes: bytes,
    target_character: str,
    auxiliary: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return run_mlx_vlm_worker(
        python=python,
        model=model,
        worker_name="local_character_reference_worker.py",
        image_bytes=image_bytes,
        request_payload={
            "target_character": target_character,
            "auxiliary": auxiliary or {},
        },
        temporary_prefix="nyamuru-character-reference-",
    )


def run_character_reference_set_worker(
    *,
    python: Path,
    model: Path,
    image_bytes: list[bytes],
    target_character: str,
    auxiliaries: list[dict[str, Any]],
) -> dict[str, Any]:
    return run_mlx_vlm_worker(
        python=python,
        model=model,
        worker_name="local_character_reference_worker.py",
        image_bytes=image_bytes,
        request_payload={
            "target_character": target_character,
            "auxiliaries": auxiliaries,
            "set_analysis": True,
        },
        temporary_prefix="nyamuru-character-reference-set-",
        timeout_seconds=15 * 60,
    )


def run_character_match_worker(
    *,
    python: Path,
    model: Path,
    image_bytes: bytes,
    candidates: list[dict[str, Any]],
    current_size: str,
    expression_tagging: dict[str, Any] | None = None,
    face_image_bytes: bytes | None = None,
    face_bbox: list[float] | None = None,
) -> dict[str, Any]:
    return run_mlx_vlm_worker(
        python=python,
        model=model,
        worker_name="local_character_match_worker.py",
        image_bytes=image_bytes if face_image_bytes is None else [image_bytes, face_image_bytes],
        request_payload={
            "candidates": candidates,
            "current_size": current_size,
            "expression_tagging": expression_tagging or {},
            "face_bbox": face_bbox,
        },
        temporary_prefix="nyamuru-character-match-",
    )
