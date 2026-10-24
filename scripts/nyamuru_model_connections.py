"""Inspect existing image runtimes without loading models or submitting jobs."""

import json
from http.client import HTTPException
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, build_opener

from nyamuru_agent_connection import NoRedirect
from nyamuru_comfy_draft import ComfyUIDraftGenerator
from qwen_generation import MODELS, SETTINGS


def comfy_endpoint(value):
    if not isinstance(value, str) or len(value) > 200:
        raise ValueError('ComfyUI接続先をHTTP URLで指定してください')
    endpoint = value.strip()
    parsed = urlsplit(endpoint)
    if parsed.path not in ('', '/') or parsed.port == 0 or any(c.isspace() for c in endpoint) or '\\' in endpoint:
        raise ValueError('ComfyUI接続先はlocalhostのポートまでを指定してください')
    # Keep the same loopback-only boundary as the existing generator.
    return ComfyUIDraftGenerator(endpoint).endpoint


def image_generation_connections(body, qwen, comfy):
    if set(body) - {'comfyui_url', 'check_comfyui'}:
        raise ValueError('画像生成の接続確認に不明な項目があります')
    check = body.get('check_comfyui', False)
    if not isinstance(check, bool):
        raise ValueError('接続確認の指定が正しくありません')
    requested = body.get('comfyui_url', '')
    if not isinstance(requested, str):
        raise ValueError('ComfyUI接続先をHTTP URLで指定してください')
    endpoint = comfy_endpoint(requested or comfy.endpoint)
    try:
        qwen.preflight()
        available, message = True, '実行環境とモデルファイルを確認しました'
    except (ValueError, OSError):
        available, message = False, '実行環境またはモデルファイルが見つかりません'
    connection = {'endpoint': endpoint, 'status': 'unchecked', 'version': '',
                  'message': '接続はまだ確認していません'}
    if check:
        try:
            opener = build_opener(ProxyHandler({}), NoRedirect())
            with opener.open(endpoint + '/system_stats', timeout=3) as response:
                raw = response.read(64 * 1024 + 1)
            if len(raw) > 64 * 1024:
                raise ValueError('response too large')
            value = json.loads(raw)
            if not isinstance(value, dict) or not isinstance(value.get('system'), dict) or not isinstance(value.get('devices'), list):
                raise ValueError('not a ComfyUI response')
            version = value['system'].get('comfyui_version', '')
            connection.update(status='connected', version=version[:80] if isinstance(version, str) else '',
                              message='ComfyUIに接続できました')
        except (OSError, ValueError, TypeError, HTTPException):
            connection.update(status='unavailable', message='ComfyUIに接続できませんでした。起動状態と接続先を確認してください')
    return {
        'qwen': {'label': 'Qwen-Image-2.1 Turbo', 'runtime': 'ComfyUI Python',
                 'available': available, 'message': message,
                 'models': [{'role': role, 'file': file} for role, file in zip(('generation', 'text_encoder', 'vae'), MODELS)],
                 'steps': SETTINGS['steps'], 'resolution': SETTINGS['resolution'],
                 'entrypoint': 'generate_selected'},
        'comfyui': connection,
    }
