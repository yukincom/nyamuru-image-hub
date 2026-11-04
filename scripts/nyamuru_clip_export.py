"""Local JSON-to-CLIP adapter. Authored data and outputs never leave the local bridge."""
from __future__ import annotations

import base64
import json
from pathlib import Path
import subprocess
import sys
import threading
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
BINARY = ROOT / '.local-clip-export' / 'bin' / ('nyamuru-clip-export.exe' if sys.platform == 'win32' else 'nyamuru-clip-export')
MAX_BYTES = 96 * 1024 * 1024
_ENCODE_LOCK = threading.Lock()


def export_clip(body: dict[str, Any]) -> dict[str, Any]:
    if body.get('profile') != 'nyamuru-clip-v1':
        raise ValueError('CLIP書き出しの形式が一致しません')
    if not BINARY.is_file():
        raise ValueError('CLIP書き出しの準備が必要です。にゃむるのフォルダーで npm run setup:clip を実行してください')
    # Source sidecars stay in the browser; the encoder receives only the page.
    data = json.dumps(body, ensure_ascii=False, allow_nan=False).encode('utf-8')
    if len(data) > MAX_BYTES:
        raise ValueError('CLIP書き出しのデータが大きすぎます。ページを分けて書き出してください')
    if not _ENCODE_LOCK.acquire(blocking=False):
        raise ValueError('別のCLIP書き出しを処理中です。完了してから再試行してください')
    try:
        try:
            result = subprocess.run([str(BINARY)], input=data, capture_output=True, timeout=240, cwd=ROOT, check=False)
        except subprocess.TimeoutExpired as exc:
            raise ValueError('CLIP書き出しが時間内に完了しませんでした。解像度を下げて再試行してください') from exc
        if result.returncode:
            detail = result.stderr.decode('utf-8', errors='replace').strip()[:1000]
            raise ValueError(f'CLIPを書き出せませんでした: {detail or "変換処理に失敗しました"}')
        if not result.stdout.startswith(b'CSFCHUNK'):
            raise ValueError('CLIP書き出し結果の形式を確認できませんでした')
        return {'profile':'nyamuru-clip-v1', 'byte_length':len(result.stdout), 'clip_data':base64.b64encode(result.stdout).decode('ascii')}
    finally:
        _ENCODE_LOCK.release()
