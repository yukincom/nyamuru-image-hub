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


def _downgrade_frame_folders(layers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Fallback for pre-frame_folder binaries: keep connected closed border + mask in one folder."""
    out: list[dict[str, Any]] = []
    for layer in layers:
        item = dict(layer)
        if item.get('kind') == 'frame_folder':
            children = _downgrade_frame_folders(item.pop('children', []))
            frames = item.pop('frames', [])
            mask = item.pop('mask', None)
            if mask is not None:
                children = [{
                    'id': f"{item['id']}/masked",
                    'name': '中身',
                    'visible': True,
                    'locked': False,
                    'opacity': 1.0,
                    'blend': 'normal',
                    'passThrough': False,
                    'kind': 'folder',
                    'mask': mask,
                    'children': children,
                }]
            lines = [
                {
                    'points': [[x, y, 1.0] for x, y in frame.get('points', [])],
                    'closed': True,
                    'widthPx': frame.get('widthPx', 1.0),
                    'color': [17, 17, 17],
                }
                for frame in frames
                if len(frame.get('points', [])) >= 2
            ]
            if lines:
                children.append({
                    'id': f"{item['id']}/frame-lines",
                    'name': '枠線',
                    'visible': True,
                    'locked': False,
                    'opacity': 1.0,
                    'blend': 'normal',
                    'kind': 'vector',
                    'lines': lines,
                })
            item['kind'] = 'folder'
            item['passThrough'] = False
            item['children'] = children
        elif 'children' in item:
            item['children'] = _downgrade_frame_folders(item['children'])
        out.append(item)
    return out


def _run_binary(args: list[str], data: bytes, magic: bytes, label: str) -> bytes:
    if not BINARY.is_file():
        raise ValueError('CLIP書き出しの準備が必要です。にゃむるのフォルダーで npm run setup:clip を実行してください')
    if len(data) > MAX_BYTES:
        raise ValueError(f'{label}のデータが大きすぎます。ページを分けて書き出してください')
    if not _ENCODE_LOCK.acquire(blocking=False):
        raise ValueError(f'別の{label}を処理中です。完了してから再試行してください')
    try:
        try:
            result = subprocess.run([str(BINARY), *args], input=data, capture_output=True, timeout=240, cwd=ROOT, check=False)
        except subprocess.TimeoutExpired as exc:
            raise ValueError(f'{label}が時間内に完了しませんでした。解像度を下げて再試行してください') from exc
        if result.returncode:
            detail = result.stderr.decode('utf-8', errors='replace').strip()[:1000]
            raise ValueError(f'{label}に失敗しました: {detail or "変換処理に失敗しました"}')
        if not result.stdout.startswith(magic):
            raise ValueError(f'{label}結果の形式を確認できませんでした')
        return result.stdout
    finally:
        _ENCODE_LOCK.release()


def export_clip(body: dict[str, Any]) -> dict[str, Any]:
    if body.get('profile') != 'nyamuru-clip-v1':
        raise ValueError('CLIP書き出しの形式が一致しません')
    # Source sidecars stay in the browser; the encoder receives only the page.
    data = json.dumps(body, ensure_ascii=False, allow_nan=False).encode('utf-8')
    try:
        stdout = _run_binary([], data, b'CSFCHUNK', 'CLIP書き出し')
    except ValueError as exc:
        if 'unknown variant `frame_folder`' not in str(exc):
            raise
        fallback = dict(body)
        fallback['layers'] = _downgrade_frame_folders(body.get('layers', []))
        stdout = _run_binary([], json.dumps(fallback, ensure_ascii=False, allow_nan=False).encode('utf-8'), b'CSFCHUNK', 'CLIP書き出し')
    return {'profile':'nyamuru-clip-v1', 'byte_length':len(stdout), 'clip_data':base64.b64encode(stdout).decode('ascii')}


def export_cmc(body: dict[str, Any]) -> dict[str, Any]:
    if body.get('profile') != 'nyamuru-cmc-v1':
        raise ValueError('CMC書き出しの形式が一致しません')
    payload = {
        'title': str(body.get('title') or ''),
        'trimMm': body.get('trimMm'),
        'bleedMm': body.get('bleedMm', 0),
        'dpi': body.get('dpi'),
        'pages': body.get('pages'),
        'rightBinding': body.get('rightBinding', True),
    }
    data = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode('utf-8')
    stdout = _run_binary(['--cmc'], data, b'SQLite format 3\x00', 'CMC書き出し')
    return {'profile': 'nyamuru-cmc-v1', 'byte_length': len(stdout), 'cmc_data': base64.b64encode(stdout).decode('ascii')}
