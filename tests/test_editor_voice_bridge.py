import base64
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit
import wave

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
import nyamuru_editor_voice as voice
from nyamuru_editor_voice import EditorVoiceError, EditorVoiceService


def wav_audio(seconds=0.1, *, silent=False, rate=16000, channels=1, width=2):
    pcm = (b'\0' * width if silent else b'\1' + b'\0' * (width - 1)) * int(rate * seconds) * channels
    output = io.BytesIO()
    with wave.open(output, 'wb') as writer:
        writer.setparams((channels, width, rate, 0, 'NONE', 'not compressed'))
        writer.writeframes(pcm)
    return output.getvalue()


def audio_body(raw=None, mime='audio/wav'):
    return {'audio': base64.b64encode(raw if raw is not None else wav_audio()).decode(), 'mime_type': mime}


class Response(io.BytesIO):
    def __init__(self, raw, headers=None, status=200):
        super().__init__(raw)
        self.headers = {} if headers is None else headers
        self.status = status


class EditorVoiceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        root = Path(self.directory.name)
        env = {}
        for key in ('FFMPEG', 'WHISPER_CLI', 'WHISPER_MODEL', 'VAD_MODEL'):
            path = root / key
            path.write_bytes(b'fixture')
            path.chmod(0o700)
            env['NYAMURU_VOICE_' + key] = str(path)
        env['NYAMURU_VOICE_VOICEVOX_URL'] = 'http://127.0.0.1:50021'
        self.env = patch.dict(os.environ, env)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.service = EditorVoiceService()
        self.service._opener = Mock()
        self.process_paths = []

    def process(self, args, timeout, label, *, output=None, wav=None):
        if args[0] == str(self.service._paths['ffmpeg']):
            self.process_paths.append(Path(args[args.index('-i') + 1]).parent)
            Path(args[-1]).write_bytes(wav if wav is not None else wav_audio())
            return b''
        return output if output is not None else '[00:00:00.000 --> 00:00:00.100]  原文を残す。[_BEG_]\n'.encode()

    def assert_error(self, code, action, pattern=None):
        with self.assertRaises(EditorVoiceError) as caught:
            action()
        self.assertEqual(caught.exception.status_code, code)
        if pattern:
            self.assertRegex(str(caught.exception), pattern)

    def test_transcribe_reuses_exact_dependencies_vad_and_temporary_cleanup(self):
        with patch.object(voice, '_run_process', side_effect=self.process) as run:
            result = self.service.transcribe(audio_body())
        self.assertEqual(result, {'text': '原文を残す。', 'backend': 'whisper.cpp', 'language': 'ja'})
        self.assertEqual(len(run.call_args_list), 2)
        decode, whisper = [call.args[0] for call in run.call_args_list]
        self.assertEqual(decode[decode.index('-protocol_whitelist') + 1], 'file,pipe')
        self.assertEqual(decode[decode.index('-ac') + 1], '1')
        self.assertEqual(decode[decode.index('-ar') + 1], '16000')
        self.assertEqual(decode[decode.index('-t') + 1], '46')
        self.assertEqual(whisper[whisper.index('-m') + 1], str(self.service._paths['whisper_model']))
        self.assertEqual(whisper[whisper.index('-l') + 1], 'ja')
        self.assertEqual(whisper[whisper.index('--prompt') + 1], '日本語の日常会話です。')
        for key, value in {'--vad-model': str(self.service._paths['vad_model']), '--vad-threshold': '0.5',
                           '--vad-min-speech-duration-ms': '250', '--vad-min-silence-duration-ms': '500',
                           '--vad-speech-pad-ms': '200', '--no-speech-thold': '0.6'}.items():
            self.assertEqual(whisper[whisper.index(key) + 1], value)
        self.assertIn('--vad', whisper)
        self.assertTrue(self.process_paths)
        self.assertTrue(all(not path.exists() for path in self.process_paths))

    def test_container_mimes_use_explicit_demuxer_and_never_client_paths(self):
        cases = [('audio/webm;codecs=opus', b'\x1aE\xdf\xa3test', 'matroska'),
                 ('audio/ogg; codecs=opus', b'OggStest', 'ogg'),
                 ('audio/mp4', b'\x00\x00\x00\x20ftypisomtest', 'mov'),
                 ('audio/mpeg', b'ID3test', 'mp3'), ('audio/x-wav', wav_audio(), 'wav')]
        for mime, raw, fmt in cases:
            with self.subTest(mime=mime), patch.object(voice, '_run_process', side_effect=self.process) as run:
                self.service.transcribe(audio_body(raw, mime))
                args = run.call_args_list[0].args[0]
                self.assertEqual(args[args.index('-f') + 1], fmt)
        with patch.object(voice, '_run_process') as run:
            self.assert_error(400, lambda: self.service.transcribe({**audio_body(), 'path': '/tmp/not-allowed'}))
            run.assert_not_called()

    def test_invalid_mime_base64_empty_and_signature_fail_before_process(self):
        cases = [None, {}, {'audio': '', 'mime_type': 'audio/wav'},
                 {'audio': 'not base64!', 'mime_type': 'audio/wav'},
                 {'audio': 'data:audio/wav;base64,AAAA', 'mime_type': 'audio/wav'},
                 {'audio': '日本語', 'mime_type': 'audio/wav'},
                 {'audio': 'AA==', 'mime_type': 1},
                 audio_body(b'#EXTM3U\nhttp://example.invalid/', 'audio/webm'),
                 audio_body(b'<html></html>', 'text/html'), audio_body(b'OggSx', 'audio/wav')]
        with patch.object(voice, '_run_process') as run:
            for body in cases:
                with self.subTest(body=body):
                    self.assert_error(400, lambda: self.service.transcribe(body))
            run.assert_not_called()

    def test_six_megabyte_raw_limit_and_encoded_limit(self):
        with patch.object(voice, 'MAX_AUDIO_BYTES', 8), patch.object(voice, '_run_process') as run:
            self.assert_error(413, lambda: self.service.transcribe(audio_body(b'OggS123456', 'audio/ogg')))
            self.assert_error(413, lambda: self.service.transcribe(audio_body(b'OggS12345', 'audio/ogg')))
            run.assert_not_called()

    def test_input_wav_truncated_invalid_rate_and_long_duration_rejected(self):
        with patch.object(voice, '_run_process') as run:
            self.assert_error(400, lambda: self.service.transcribe(audio_body(wav_audio()[:-2])))
            self.assert_error(400, lambda: self.service.transcribe(audio_body(wav_audio(rate=1000))))
            self.assert_error(413, lambda: self.service.transcribe(audio_body(wav_audio(seconds=45.01))))
            run.assert_not_called()

    def test_decoded_duration_rejected_without_silent_truncation_or_whisper(self):
        long_wav = wav_audio(seconds=46)
        with patch.object(voice, '_run_process', side_effect=lambda *args: self.process(*args, wav=long_wav)) as run:
            self.assert_error(413, lambda: self.service.transcribe(audio_body(b'OggSfixture', 'audio/ogg')))
            self.assertEqual(run.call_count, 1)
        self.assertTrue(all(not path.exists() for path in self.process_paths))

    def test_exactly_45_seconds_is_accepted(self):
        full_wav = wav_audio(seconds=45)
        with patch.object(voice, '_run_process', side_effect=lambda *args: self.process(*args, wav=full_wav)):
            self.assertEqual(self.service.transcribe(audio_body(full_wav))['text'], '原文を残す。')

    def test_decoded_wav_format_and_output_size_checked(self):
        for bad in (b'not wav', wav_audio(channels=2), wav_audio(rate=44100), b'x' * 1_600_000):
            with self.subTest(length=len(bad)), patch.object(voice, '_run_process', side_effect=lambda *args: self.process(*args, wav=bad)):
                with self.assertRaises(EditorVoiceError):
                    self.service.transcribe(audio_body())
        with patch.object(voice, '_run_process', return_value=b''):
            self.assert_error(502, lambda: self.service.transcribe(audio_body()))

    def test_silence_and_empty_decoded_audio_return_empty_without_whisper(self):
        for raw in (wav_audio(silent=True), wav_audio(seconds=0)):
            with self.subTest(size=len(raw)), patch.object(voice, '_run_process', side_effect=lambda *args: self.process(*args, wav=raw)) as run:
                self.assertEqual(self.service.transcribe(audio_body(raw))['text'], '')
                self.assertEqual(run.call_count, 1)

    def test_no_speech_and_only_control_tokens_are_empty_not_errors(self):
        for output in (b'whisper_full: no speech detected\n', b'[00:00:00.000 --> 00:00:00.100] [_BEG_] [_TT_0_]\n'):
            with self.subTest(output=output), patch.object(voice, '_run_process', side_effect=lambda *args: self.process(*args, output=output)):
                self.assertEqual(self.service.transcribe(audio_body())['text'], '')

    def test_transcript_keeps_user_words_and_ignores_cli_diagnostics(self):
        output = 'diagnostic not speech\n[00:00:00.000 --> 00:00:01.000] Ａを四国めたんに。[_TT_0_]\n[00:00:01.000 --> 00:00:02.000] 送信しないで。\n'
        self.assertEqual(voice._transcript(output.encode()), 'Ａを四国めたんに。 送信しないで。')
        self.assertEqual(voice._transcript(b'\xff diagnostic only'), '')
        self.assert_error(502, lambda: voice._transcript(b'[00:00:00.000 --> 00:00:01.000] \xff'))
        self.assert_error(502, lambda: voice._transcript(('[00:00:00.000 --> 00:00:01.000] ' + 'x' * 4001).encode()))

    def test_missing_dependencies_and_nonexecutable_fail_clearly(self):
        for key in self.service._paths:
            with self.subTest(key=key), patch.dict(self.service._paths, {key: Path(self.directory.name) / 'missing'}), patch.object(voice, '_run_process') as run:
                self.assert_error(503, lambda: self.service.transcribe(audio_body()), '見つからない')
                run.assert_not_called()
        self.service._paths['ffmpeg'].chmod(0o600)
        self.assert_error(503, lambda: self.service.transcribe(audio_body()), '実行権限')

    def test_codex_dependency_and_relative_dependency_are_not_allowed(self):
        for path in (Path('/tmp/.codex/runtime'), Path('relative/runtime')):
            with patch.dict(self.service._paths, {'ffmpeg': path}):
                self.assert_error(503, lambda: self.service.transcribe(audio_body()), '絶対パス')

    def test_cleanup_and_slot_release_on_whisper_failure(self):
        def fail(args, timeout, label):
            if args[0] == str(self.service._paths['ffmpeg']):
                return self.process(args, timeout, label)
            raise EditorVoiceError('音声認識が時間内に完了しませんでした。', 504)
        with patch.object(voice, '_run_process', side_effect=fail):
            self.assert_error(504, lambda: self.service.transcribe(audio_body()))
        self.assertTrue(all(not path.exists() for path in self.process_paths))
        with patch.object(voice, '_run_process', side_effect=self.process):
            self.assertEqual(self.service.transcribe(audio_body())['text'], '原文を残す。')

    def test_private_workspace_failure_is_sanitized_and_releases_slot(self):
        with patch.object(voice.tempfile, 'TemporaryDirectory', side_effect=OSError('private details')):
            self.assert_error(503, lambda: self.service.transcribe(audio_body()), '一時ファイル')
        with patch.object(voice, '_run_process', side_effect=self.process):
            self.assertEqual(self.service.transcribe(audio_body())['text'], '原文を残す。')

    def test_stt_and_tts_have_independently_bounded_nonwaiting_slots(self):
        with self.service._slot(self.service._stt_lock), patch.object(voice, '_run_process') as run:
            self.assert_error(429, lambda: self.service.transcribe(audio_body()))
            run.assert_not_called()
        with self.service._slot(self.service._tts_lock):
            self.assert_error(429, lambda: self.service.synthesize({'text': '本文'}))
            self.service._opener.open.assert_not_called()

    def test_tts_two_phase_uses_fixed_normal_speaker_and_preserves_exact_text(self):
        raw = wav_audio()
        query = {'accent_phrases': [], 'speedScale': 1, 'volumeScale': 1, 'outputSamplingRate': 24000}
        self.service._opener.open.side_effect = [Response(json.dumps(query).encode()), Response(raw)]
        original = '  Ａを読みます。\n次の行も。  '
        result = self.service.synthesize({'text': original})
        self.assertEqual(result, {'audio': base64.b64encode(raw).decode(), 'mime_type': 'audio/wav',
                                  'speaker_id': 2, 'speaker': '四国めたん', 'style': 'ノーマル'})
        requests = [call.args[0] for call in self.service._opener.open.call_args_list]
        self.assertEqual([req.method for req in requests], ['POST', 'POST'])
        self.assertEqual(parse_qs(urlsplit(requests[0].full_url).query), {'text': [original], 'speaker': ['2']})
        self.assertEqual(parse_qs(urlsplit(requests[1].full_url).query), {'speaker': ['2']})
        self.assertEqual(json.loads(requests[1].data), query)
        self.assertTrue(all(urlsplit(req.full_url).hostname == '127.0.0.1' for req in requests))

    def test_tts_input_limits_and_no_client_speaker_or_url(self):
        for body in ({'text': ''}, {'text': '  '}, {'text': 1}, {'text': 'a\x00b'}, {'text': '\ud800'},
                     {'text': 'hi', 'speaker_id': 4}, {'text': 'hi', 'url': 'http://example.invalid'}):
            with self.subTest(body=body):
                self.assert_error(400, lambda: self.service.synthesize(body))
        self.assert_error(413, lambda: self.service.synthesize({'text': 'あ' * 2001}))
        self.service._opener.open.assert_not_called()

    def test_bad_tts_json_audio_and_empty_wav_rejected(self):
        for query in (b'[]', b'null', b'{"accent_phrases":"not list"}', b'not json', b'{"accent_phrases": [], "speedScale": NaN}'):
            self.service._opener.open.side_effect = [Response(query)]
            self.assert_error(502, lambda: self.service.synthesize({'text': '本文'}))
        for raw in (b'not wav', wav_audio(seconds=0), wav_audio()[:-3]):
            self.service._opener.open.side_effect = [Response(b'{"accent_phrases": []}'), Response(raw)]
            self.assert_error(502, lambda: self.service.synthesize({'text': '本文'}))

    def test_http_connection_timeout_status_redirect_and_response_limits(self):
        cases = [(URLError('unavailable'), 503), (TimeoutError(), 504), (URLError(TimeoutError()), 504),
                 (HTTPError('http://127.0.0.1:50021', 302, 'redirect', {}, None), 502)]
        for error, code in cases:
            self.service._opener.open.side_effect = error
            self.assert_error(code, lambda: self.service._request('/speakers', maximum=100, timeout=2))
        for response in (Response(b'long', {'Content-Length': '400'}), Response(b'x' * 101),
                         Response(b'', status=201), Response(b'', {'Content-Length': 'invalid'})):
            self.service._opener.open.side_effect = None
            self.service._opener.open.return_value = response
            self.assert_error(502, lambda: self.service._request('/speakers', maximum=100, timeout=2))

    def test_proxy_redirects_and_nonlocal_urls_not_allowed(self):
        with patch.object(voice, 'build_opener') as builder:
            EditorVoiceService()
            handlers = builder.call_args.args
            self.assertEqual(handlers[0].proxies, {})
            self.assertIsNone(handlers[1].redirect_request(None, None, 302, '', {}, 'http://example.invalid'))
        for url in ('https://127.0.0.1:50021', 'http://example.invalid:50021', 'http://127.0.0.1:50021/a',
                    'http://name@127.0.0.1:50021', 'http://127.0.0.1:50021?x=1', 'http://127.0.0.1:bad'):
            self.service._voicevox_url = url
            self.assert_error(503, lambda: self.service._request('/speakers', maximum=100, timeout=2))
        self.service._opener.open.assert_not_called()
        self.service._voicevox_url = 'http://localhost:50021/'
        self.assertEqual(self.service._base_url(), 'http://127.0.0.1:50021')

    def test_status_reads_files_and_speaker_metadata_only_never_loads_model(self):
        data = [{'name': '四国めたん', 'styles': [{'name': 'ノーマル', 'id': 2}, {'name': 'セクシー', 'id': 4}]}]
        self.service._opener.open.return_value = Response(json.dumps(data).encode())
        with patch.object(voice, '_run_process') as run:
            result = self.service.status()
            run.assert_not_called()
        self.assertTrue(result['stt']['available'])
        self.assertTrue(result['tts']['available'])
        self.assertEqual(result['tts']['speaker_id'], 2)
        request = self.service._opener.open.call_args.args[0]
        self.assertEqual(request.method, 'GET')
        self.assertEqual(request.full_url, 'http://127.0.0.1:50021/speakers')

    def test_status_reports_unavailable_instead_of_throwing_or_loading(self):
        self.service._paths['vad_model'] = Path(self.directory.name) / 'missing'
        self.service._opener.open.side_effect = URLError('offline')
        result = self.service.status()
        self.assertFalse(result['stt']['available'])
        self.assertIn('Silero', result['stt']['error'])
        self.assertFalse(result['tts']['available'])
        self.assertIn('接続', result['tts']['error'])
        self.service._opener.open.side_effect = [Response(b'[]')]
        self.assertIn('ノーマル', self.service.status()['tts']['error'])


class ProcessTests(unittest.TestCase):
    def fake_process(self, *, returncode=0):
        process = Mock()
        process.__enter__ = Mock(return_value=process)
        process.__exit__ = Mock(return_value=False)
        process.stdout.fileno.return_value = 42
        process.wait.return_value = returncode
        process.poll.return_value = returncode
        selector = Mock()
        selector.__enter__ = Mock(return_value=selector)
        selector.__exit__ = Mock(return_value=False)
        selector.get_map.side_effect = [True, True, False]
        selector.select.return_value = [(Mock(fileobj=process.stdout), 1)]
        return process, selector

    def test_bounded_process_output_and_explicit_no_shell(self):
        process, selector = self.fake_process()
        with patch.object(voice.subprocess, 'Popen', return_value=process) as popen, \
                patch.object(voice.selectors, 'DefaultSelector', return_value=selector), \
                patch.object(voice.os, 'read', side_effect=[b'done', b'']):
            self.assertEqual(voice._run_process(['/fixed/tool', 'literal;arg'], 20, '変換'), b'done')
        self.assertIs(popen.call_args.kwargs['shell'], False)
        self.assertEqual(popen.call_args.kwargs['stdin'], subprocess.DEVNULL)

    def test_timeout_output_limit_exit_failure_and_spawn_failure(self):
        for condition, code in (('timeout', 504), ('output', 502), ('exit', 502)):
            process, selector = self.fake_process(returncode=1 if condition == 'exit' else 0)
            process.poll.return_value = None
            clock = [0, 30] if condition == 'timeout' else [0, 1, 2, 3]
            data = b'x' * 11 if condition == 'output' else b'log'
            with self.subTest(condition=condition), patch.object(voice.subprocess, 'Popen', return_value=process), \
                    patch.object(voice.selectors, 'DefaultSelector', return_value=selector), \
                    patch.object(voice.os, 'read', side_effect=[data, b'']), \
                    patch.object(voice.time, 'monotonic', side_effect=clock), \
                    patch.object(voice, 'MAX_PROCESS_OUTPUT_BYTES', 10):
                with self.assertRaises(EditorVoiceError) as caught:
                    voice._run_process(['/tool'], 20, '音声認識')
                self.assertEqual(caught.exception.status_code, code)
                process.kill.assert_called_once()
        with patch.object(voice.subprocess, 'Popen', side_effect=FileNotFoundError()):
            with self.assertRaises(EditorVoiceError) as caught:
                voice._run_process(['/missing'], 20, '音声認識')
            self.assertEqual(caught.exception.status_code, 503)

    def test_stderr_diagnostics_are_drained_but_not_returned_as_transcript(self):
        process, selector = self.fake_process()
        selector.get_map.side_effect = [True, True, True, False]
        selector.select.side_effect = [[(Mock(fileobj=process.stderr), 1)],
                                       [(Mock(fileobj=process.stdout), 1)],
                                       [(Mock(fileobj=process.stdout), 1)]]
        with patch.object(voice.subprocess, 'Popen', return_value=process), \
                patch.object(voice.selectors, 'DefaultSelector', return_value=selector), \
                patch.object(voice.os, 'read', side_effect=[b'private diagnostic', b'text', b'']):
            self.assertEqual(voice._run_process(['/tool'], 20, '変換'), b'text')


if __name__ == '__main__':
    unittest.main()
