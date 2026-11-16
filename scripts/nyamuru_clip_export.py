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
            if result.returncode and b'unknown variant `frame_folder`' in result.stderr:
                fallback = dict(body)
                fallback['layers'] = _downgrade_frame_folders(body.get('layers', []))
                data = json.dumps(fallback, ensure_ascii=False, allow_nan=False).encode('utf-8')
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
