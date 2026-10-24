"""Bridge adapter for the local 19-label classifier, separate from image runtimes."""
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import threading

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL_NAME = 'nyamuru-voice-v04-seed43'
LABELS = ['save', 'undo', 'redo', 'page_navigate', 'view_change', 'artwork_mode_set',
          'bubble_set', 'needs_clarification', 'needs_reasoning', 'compound_request',
          'out_of_scope_request', 'not_command', 'panel_sync_set', 'inner_frame_snap_set',
          'panel_gap_snap_set', 'generate_request', 'background_3d_candidates',
          'paint_tool_set', 'text_frames_align']

def validate_text(body):
    if not isinstance(body, dict) or set(body) != {'text'}:
        raise ValueError('textだけを指定してください')
    text = body['text']
    if not isinstance(text, str) or not text.strip() or len(text) > 4000 or '\0' in text:
        raise ValueError('操作を1〜4000文字で入力してください')
    return text

class VoiceIntentService:
    def __init__(self):
        # The bridge already runs in the environment provisioned by setup:vision.
        self.python = Path(os.environ.get('NYAMURU_VOICE_INTENT_PYTHON', sys.executable)).expanduser()
        self.model = Path(os.environ.get('NYAMURU_VOICE_INTENT_MODEL', ROOT / 'models' / DEFAULT_MODEL_NAME)).expanduser()
        self.lock = threading.Lock()

    def classify(self, body):
        original = validate_text(body)
        for path in (self.python, self.model):
            if not path.is_absolute() or '.codex' in path.resolve().parts or not path.exists():
                raise ValueError('分類器の実行環境またはモデルがありません。音声操作の導入手順を確認してください')
        if not self.lock.acquire(blocking=False):
            raise ValueError('操作を分類中です。完了後にもう一度入力してください')
        try:
            result = subprocess.run([str(self.python), str(ROOT/'scripts/voice_intent_worker.py'), str(self.model)],
                input=json.dumps({'text': original}), capture_output=True, text=True, timeout=60,
                cwd=ROOT, env={**os.environ, 'HF_HUB_OFFLINE':'1', 'TRANSFORMERS_OFFLINE':'1'})
            if result.returncode:
                raise ValueError('分類器を実行できませんでした。入力の長さと導入済みモデル・Python環境を確認してください')
            value = json.loads(result.stdout)
            scores = value.get('probabilities')
            if (value.get('text') != original or value.get('label') not in LABELS or
                not isinstance(scores, list) or len(scores) != len(LABELS) or
                any(type(x) not in (int,float) or not math.isfinite(x) or not 0 <= x <= 1 for x in scores) or
                abs(sum(scores)-1) > 1e-4 or value.get('confidence') != max(scores) or
                not isinstance(value.get('model'), str) or not value['model'] or
                type(value.get('elapsed_ms')) not in (int,float) or not math.isfinite(value['elapsed_ms']) or value['elapsed_ms'] < 0 or
                value['label'] != LABELS[max(range(len(scores)), key=scores.__getitem__)]):
                raise ValueError('分類器の応答が不正です')
            return value
        except subprocess.TimeoutExpired:
            raise ValueError('分類が時間内に終わりませんでした。操作は実行していません') from None
        finally:
            self.lock.release()
