"""Local editor dictation and speech using the existing Dogido/Yuno audio engines.

This adapter only returns text or audio. It never sends a chat message, records a
microphone, starts a resident service, or imports household conversation state.
"""
from __future__ import annotations

import base64
import binascii
from contextlib import contextmanager
import io
import json
import os
from pathlib import Path
import re
import selectors
import subprocess
import tempfile
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
import wave


MAX_AUDIO_BYTES = 6 * 1024 * 1024
MAX_AUDIO_SECONDS = 45
MAX_TTS_CHARACTERS = 2000
MAX_TTS_BYTES = 16 * 1024 * 1024
MAX_PROCESS_OUTPUT_BYTES = 512 * 1024
MAX_TRANSCRIPT_CHARACTERS = 4000
SPEAKER_ID = 2
SPEAKER = '四国めたん'
STYLE = 'ノーマル'
MODEL_LABEL = 'Kotoba Whisper v2.0 (q5_0)'

_FORMATS = {
    'audio/wav': ('wav', '.wav'), 'audio/wave': ('wav', '.wav'),
    'audio/x-wav': ('wav', '.wav'), 'audio/vnd.wave': ('wav', '.wav'),
    'audio/webm': ('matroska', '.webm'), 'audio/ogg': ('ogg', '.ogg'),
    'audio/mp4': ('mov', '.m4a'), 'audio/mpeg': ('mp3', '.mp3'),
}


class EditorVoiceError(RuntimeError):
    """A sanitized Japanese error suitable for the bridge's JSON response."""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _object(body, keys: set[str]) -> dict:
    if not isinstance(body, dict) or set(body) != keys:
        raise EditorVoiceError('音声リクエストの項目が正しくありません。')
    return body


def _wav(data: bytes, *, maximum_seconds: int | None = None) -> tuple[bytes, int, int, int]:
    try:
        if data[:4] != b'RIFF' or data[8:12] != b'WAVE':
            raise ValueError()
        with wave.open(io.BytesIO(data), 'rb') as reader:
            channels, width, rate, frames = (reader.getnchannels(), reader.getsampwidth(),
                                             reader.getframerate(), reader.getnframes())
            if not 1 <= channels <= 8 or not 1 <= width <= 4 or not 8000 <= rate <= 192000:
                raise ValueError()
            if maximum_seconds is not None and frames > rate * maximum_seconds:
                raise EditorVoiceError(f'音声は{maximum_seconds}秒以内にしてください。', 413)
            if frames * channels * width > len(data):
                raise ValueError()
            pcm = reader.readframes(frames)
            if len(pcm) != frames * channels * width:
                raise ValueError()
        return pcm, channels, width, rate
    except (wave.Error, EOFError, ValueError, OverflowError):
        raise EditorVoiceError('WAV音声の形式または長さが正しくありません。') from None


def _decode_audio(body: dict) -> tuple[bytes, str, str]:
    body = _object(body, {'audio', 'mime_type'})
    mime, encoded = body['mime_type'], body['audio']
    if not isinstance(mime, str) or len(mime) > 120:
        raise EditorVoiceError('音声のMIME形式が正しくありません。')
    mime = mime.split(';', 1)[0].strip().lower()
    if mime not in _FORMATS:
        raise EditorVoiceError('対応していない音声形式です。WAV・WebM・Ogg・MP4・MP3を使用してください。')
    if not isinstance(encoded, str) or not encoded:
        raise EditorVoiceError('音声データが空、またはBase64形式ではありません。')
    if len(encoded) > 4 * ((MAX_AUDIO_BYTES + 2) // 3):
        raise EditorVoiceError('音声データは6 MiB以内にしてください。', 413)
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise EditorVoiceError('音声データのBase64形式が正しくありません。') from None
    if not raw:
        raise EditorVoiceError('音声データが空です。')
    if len(raw) > MAX_AUDIO_BYTES:
        raise EditorVoiceError('音声データは6 MiB以内にしてください。', 413)
    fmt, suffix = _FORMATS[mime]
    signature_ok = {
        'wav': raw[:4] == b'RIFF' and raw[8:12] == b'WAVE',
        'matroska': raw[:4] == b'\x1aE\xdf\xa3', 'ogg': raw[:4] == b'OggS',
        'mov': raw[4:8] == b'ftyp',
        'mp3': raw[:3] == b'ID3' or (len(raw) >= 2 and raw[0] == 255 and raw[1] & 224 == 224),
    }[fmt]
    if not signature_ok:
        raise EditorVoiceError('音声データとMIME形式が一致しません。')
    if fmt == 'wav':
        _wav(raw, maximum_seconds=MAX_AUDIO_SECONDS)
    return raw, fmt, suffix


def _run_process(args: list[str], timeout: float, label: str) -> bytes:
    """Drain bounded stdout/stderr separately; kill and reap on failure."""
    try:
        with subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, shell=False) as process:
            try:
                output = bytearray()
                total_bytes = 0
                deadline = time.monotonic() + timeout
                with selectors.DefaultSelector() as selector:
                    selector.register(process.stdout, selectors.EVENT_READ)
                    selector.register(process.stderr, selectors.EVENT_READ)
                    while selector.get_map():
                        remaining = deadline - time.monotonic()
                        if remaining <= 0:
                            raise EditorVoiceError(f'{label}が時間内に完了しませんでした。', 504)
                        for key, _ in selector.select(min(remaining, 0.2)):
                            chunk = os.read(key.fileobj.fileno(), 65536)
                            if not chunk:
                                selector.unregister(key.fileobj)
                                continue
                            total_bytes += len(chunk)
                            if total_bytes > MAX_PROCESS_OUTPUT_BYTES:
                                raise EditorVoiceError(f'{label}の出力が上限を超えました。', 502)
                            if key.fileobj is process.stdout:
                                output.extend(chunk)
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise EditorVoiceError(f'{label}が時間内に完了しませんでした。', 504)
                if process.wait(timeout=remaining) != 0:
                    raise EditorVoiceError(f'{label}に失敗しました。音声形式と既存の実行環境を確認してください。', 502)
                return bytes(output)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
    except subprocess.TimeoutExpired:
        raise EditorVoiceError(f'{label}が時間内に完了しませんでした。', 504) from None
    except OSError:
        raise EditorVoiceError(f'{label}を実行できません。既存の実行ファイルを確認してください。', 503) from None


def _transcript(output: bytes) -> str:
    # Diagnostic lines can contain invalid bytes; only recognized text is data.
    decoded = output.decode('utf-8', errors='replace')
    parts = []
    for line in decoded.splitlines():
        match = re.match(r'^\s*\[\d{2}:\d{2}:\d{2}[.,]\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}[.,]\d{3}\]\s*(.*)$', line)
        if match:
            text = re.sub(r'\[_[A-Z_0-9]+_\]', '', match[1]).strip()
            if text:
                parts.append(text)
    text = ' '.join(parts)
    if '\ufffd' in text:
        raise EditorVoiceError('音声認識の文字コードが正しくありません。', 502)
    if len(text) > MAX_TRANSCRIPT_CHARACTERS or '\x00' in text:
        raise EditorVoiceError('音声認識結果が上限を超えたか、形式が正しくありません。', 502)
    return text


@contextmanager
def _audio_workspace():
    try:
        with tempfile.TemporaryDirectory(prefix='nyamuru-editor-voice-') as directory:
            yield Path(directory)
    except OSError:
        raise EditorVoiceError('音声の一時ファイルを処理できません。作業領域の空き容量と権限を確認してください。', 503) from None


class EditorVoiceService:
    def __init__(self):
        home = Path.home()
        self._paths = {
            'ffmpeg': Path(os.environ.get('NYAMURU_VOICE_FFMPEG', '/opt/homebrew/bin/ffmpeg')).expanduser(),
            'whisper_cli': Path(os.environ.get('NYAMURU_VOICE_WHISPER_CLI', str(home / 'AI_assistant/whisper.cpp/build/bin/whisper-cli'))).expanduser(),
            'whisper_model': Path(os.environ.get('NYAMURU_VOICE_WHISPER_MODEL', str(home / 'AI_assistant/whisper.cpp/models/ggml-kotoba-whisper-v2.0-q5_0.bin'))).expanduser(),
            'vad_model': Path(os.environ.get('NYAMURU_VOICE_VAD_MODEL', str(home / '.cache/dogido/models/ggml-silero-v6.2.0.bin'))).expanduser(),
        }
        self._voicevox_url = os.environ.get('NYAMURU_VOICE_VOICEVOX_URL', 'http://127.0.0.1:50021')
        self._opener = build_opener(ProxyHandler({}), _NoRedirect())
        self._stt_lock = threading.BoundedSemaphore(1)
        self._tts_lock = threading.BoundedSemaphore(1)

    def _check_paths(self) -> dict[str, Path]:
        labels = {'ffmpeg': 'ffmpeg', 'whisper_cli': 'Whisper実行ファイル',
                  'whisper_model': 'Whisperモデル', 'vad_model': 'Silero VADモデル'}
        for key, path in self._paths.items():
            try:
                resolved = path.resolve()
            except (OSError, ValueError, RuntimeError):
                raise EditorVoiceError(f'{labels[key]}の配置を確認できません。既存のパスを確認してください。', 503) from None
            if not path.is_absolute() or '.codex' in path.parts or '.codex' in resolved.parts:
                raise EditorVoiceError(f'{labels[key]}には.codex外の既存ファイルの絶対パスを設定してください。', 503)
            if not path.is_file() or not os.access(path, os.R_OK):
                raise EditorVoiceError(f'{labels[key]}が見つからないか、読み取れません。既存の配置を確認してください。', 503)
            if key in ('ffmpeg', 'whisper_cli') and not os.access(path, os.X_OK):
                raise EditorVoiceError(f'{labels[key]}を実行できません。実行権限を確認してください。', 503)
        return self._paths

    def _base_url(self) -> str:
        try:
            url = urlsplit(self._voicevox_url)
            if (url.scheme != 'http' or url.hostname not in ('localhost', '127.0.0.1', '::1')
                    or url.username is not None or url.password is not None
                    or url.path not in ('', '/') or url.query or url.fragment):
                raise ValueError()
            port = url.port or 80
            if not 1 <= port <= 65535:
                raise ValueError()
            host = '[::1]' if url.hostname == '::1' else '127.0.0.1'
            return f'http://{host}:{port}'
        except (ValueError, TypeError):
            raise EditorVoiceError('VOICEVOXのURLには、このPCのHTTP接続先を設定してください。', 503) from None

    def _request(self, path: str, *, data: bytes | None = None, maximum: int,
                 timeout: float, method: str = 'GET') -> bytes:
        request = Request(self._base_url() + path, data=data, method=method,
                          headers={'Content-Type': 'application/json', 'Accept': 'application/json, audio/wav'})
        deadline = time.monotonic() + timeout
        try:
            with self._opener.open(request, timeout=timeout) as response:
                if response.status != 200:
                    raise EditorVoiceError('VOICEVOXから正常な応答を受け取れませんでした。', 502)
                declared = response.headers.get('Content-Length')
                if declared is not None and (len(declared) > 10 or not declared.isdecimal() or int(declared) > maximum):
                    raise EditorVoiceError('VOICEVOXの応答サイズが正しくありません。', 502)
                result = bytearray()
                while True:
                    if time.monotonic() >= deadline:
                        raise EditorVoiceError('VOICEVOXが時間内に応答しませんでした。', 504)
                    chunk = response.read1(min(65536, maximum - len(result) + 1))
                    if not chunk:
                        return bytes(result)
                    if len(result) + len(chunk) > maximum:
                        raise EditorVoiceError('VOICEVOXの応答が上限を超えました。', 502)
                    result.extend(chunk)
        except HTTPError as exc:
            exc.close()
            raise EditorVoiceError('VOICEVOXから正常な応答を受け取れませんでした。', 502) from None
        except (TimeoutError, subprocess.TimeoutExpired):
            raise EditorVoiceError('VOICEVOXが時間内に応答しませんでした。', 504) from None
        except URLError as exc:
            if isinstance(exc.reason, TimeoutError):
                raise EditorVoiceError('VOICEVOXが時間内に応答しませんでした。', 504) from None
            raise EditorVoiceError('VOICEVOXへ接続できません。既存のVOICEVOXが起動しているか確認してください。', 503) from None
        except OSError:
            raise EditorVoiceError('VOICEVOXへ接続できません。既存のVOICEVOXが起動しているか確認してください。', 503) from None

    @staticmethod
    @contextmanager
    def _slot(lock):
        if not lock.acquire(blocking=False):
            raise EditorVoiceError('音声を処理中です。完了してからもう一度お試しください。', 429)
        try:
            yield
        finally:
            lock.release()

    def status(self) -> dict:
        model = self._paths['whisper_model'].name
        stt = {'available': False, 'backend': 'whisper.cpp',
               'model': MODEL_LABEL if model == 'ggml-kotoba-whisper-v2.0-q5_0.bin' else model}
        tts = {'available': False, 'backend': 'VOICEVOX', 'speaker_id': SPEAKER_ID,
               'speaker': SPEAKER, 'style': STYLE}
        try:
            self._check_paths()
            stt['available'] = True
        except (EditorVoiceError, OSError) as exc:
            stt['error'] = str(exc) if isinstance(exc, EditorVoiceError) else '音声認識用ファイルを確認できません。'
        try:
            speakers = json.loads(self._request('/speakers', maximum=512 * 1024, timeout=2))
            if not isinstance(speakers, list) or not any(
                isinstance(speaker, dict) and speaker.get('name') == SPEAKER
                and isinstance(speaker.get('styles'), list) and any(
                    isinstance(style, dict) and style.get('name') == STYLE and style.get('id') == SPEAKER_ID
                    for style in speaker['styles']) for speaker in speakers
            ):
                raise EditorVoiceError('VOICEVOXに四国めたん（ノーマル・2）が見つかりません。', 503)
            tts['available'] = True
        except (EditorVoiceError, ValueError, UnicodeError, RecursionError) as exc:
            tts['error'] = str(exc) if isinstance(exc, EditorVoiceError) else 'VOICEVOXの話者情報を読み取れません。'
        return {'stt': stt, 'tts': tts, 'max_audio_seconds': MAX_AUDIO_SECONDS}

    def transcribe(self, body: dict) -> dict:
        raw, fmt, suffix = _decode_audio(body)
        result = {'text': '', 'backend': 'whisper.cpp', 'language': 'ja'}
        with self._slot(self._stt_lock):
            paths = self._check_paths()
            with _audio_workspace() as directory:
                source, wav_path = directory / ('input' + suffix), directory / 'decoded.wav'
                source.write_bytes(raw)
                # Decode one second beyond the limit so excess duration is rejected,
                # never silently accepted as a truncated 45-second recording.
                _run_process([str(paths['ffmpeg']), '-nostdin', '-hide_banner', '-loglevel', 'error',
                              '-protocol_whitelist', 'file,pipe', '-f', fmt, '-i', str(source),
                              '-map', '0:a:0', '-vn', '-sn', '-dn', '-ac', '1', '-ar', '16000',
                              '-c:a', 'pcm_s16le', '-t', str(MAX_AUDIO_SECONDS + 1), str(wav_path)], 20, '音声の変換')
                if not wav_path.is_file() or wav_path.stat().st_size > (MAX_AUDIO_SECONDS + 2) * 32000:
                    raise EditorVoiceError('変換後の音声サイズが正しくありません。', 502)
                pcm, channels, width, rate = _wav(wav_path.read_bytes(), maximum_seconds=MAX_AUDIO_SECONDS)
                if (channels, width, rate) != (1, 2, 16000):
                    raise EditorVoiceError('音声を16 kHzのモノラルWAVへ変換できませんでした。', 502)
                if not pcm or not any(pcm):
                    return result
                output = _run_process([
                    str(paths['whisper_cli']), '-m', str(paths['whisper_model']), '-f', str(wav_path),
                    '-l', 'ja', '--prompt', '日本語の日常会話です。', '--no-speech-thold', '0.6',
                    '--vad', '--vad-model', str(paths['vad_model']), '--vad-threshold', '0.5',
                    '--vad-min-speech-duration-ms', '250', '--vad-min-silence-duration-ms', '500',
                    '--vad-speech-pad-ms', '200',
                ], 60, '音声認識')
                result['text'] = _transcript(output)
                return result

    def synthesize(self, body: dict) -> dict:
        text = _object(body, {'text'})['text']
        if not isinstance(text, str) or not text.strip() or '\x00' in text:
            raise EditorVoiceError('読み上げる本文が空、または形式が正しくありません。')
        if len(text) > MAX_TTS_CHARACTERS:
            raise EditorVoiceError('読み上げる本文は2000文字以内にしてください。', 413)
        try:
            query_path = '/audio_query?' + urlencode({'text': text, 'speaker': SPEAKER_ID})
        except UnicodeError:
            raise EditorVoiceError('読み上げる本文の文字コードが正しくありません。') from None
        with self._slot(self._tts_lock):
            raw_query = self._request(query_path, data=b'', maximum=2 * 1024 * 1024, timeout=10, method='POST')
            try:
                query = json.loads(raw_query)
                if not isinstance(query, dict) or not isinstance(query.get('accent_phrases'), list):
                    raise ValueError()
                payload = json.dumps(query, ensure_ascii=False, allow_nan=False).encode('utf-8')
            except (ValueError, UnicodeError, RecursionError):
                raise EditorVoiceError('VOICEVOXの音声合成情報が正しくありません。', 502) from None
            audio = self._request('/synthesis?' + urlencode({'speaker': SPEAKER_ID}), data=payload,
                                  maximum=MAX_TTS_BYTES, timeout=30, method='POST')
            try:
                pcm, _, _, _ = _wav(audio)
                if not pcm:
                    raise EditorVoiceError('音声が空です。')
            except EditorVoiceError:
                raise EditorVoiceError('VOICEVOXから有効なWAV音声を受け取れませんでした。', 502) from None
            return {'audio': base64.b64encode(audio).decode('ascii'), 'mime_type': 'audio/wav',
                    'speaker_id': SPEAKER_ID, 'speaker': SPEAKER, 'style': STYLE}
