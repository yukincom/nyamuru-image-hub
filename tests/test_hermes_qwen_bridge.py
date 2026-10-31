"""見込み: CLIも保存済みワークフローと5候補の明示選択を共有できる。
合格: 指示保存・UUID不変性・不確定時再送禁止・選択前後の出力先が一致。
範囲: 実job保存、APIは模擬。HTTP/モデル/外部CLI実行は対象外。
"""
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from hermes_qwen import main, request_file, preview, supplied_english, result, run_job
from qwen_generation import QwenGenerationService
from qwen_generation_phase import generation_prompt
from comfy_workflows import WorkflowStore
from generation_store import validate_png
from test_comfy_generation_bridge import API, definition, png


class HermesQwenTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.workflows = WorkflowStore(self.root / 'workflows')
        self.workflow = self.workflows.save(definition(0, 'qwen'))
        self.api = API()
        self.service = QwenGenerationService(self.root / 'jobs', workflows=self.workflows, client_factory=lambda endpoint: self.api)

    def request(self, folder, **extra):
        path = Path(folder) / 'request.json'
        path.write_text(json.dumps({'job_id': str(uuid4()), 'prompt': 'A blue teapot.',
                                   'workflow_id': self.workflow['id'], 'workflow_version': self.workflow['version'], **extra}))
        return request_file(path)

    def cli(self, command):
        with patch('hermes_qwen.QwenGenerationService', return_value=self.service), \
                patch.object(sys, 'argv', ['hermes_qwen.py', command, '--request', str(self.root / 'request.json')]), \
                redirect_stdout(io.StringIO()) as output:
            main()
        return json.loads(output.getvalue())

    # 見込み: CLIの英語指示は選択定義へそのまま渡し、対応していない上書きは拒否できる。
    # 合格: 原文を保持、steps拒否、Qwenモードの日本語拒否。範囲: 入力/previewのみ、API送信なし。
    def test_prompt_preserved_and_unsupported_parameters_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            body = self.request(folder)
            output = preview(body, self.service)
            self.assertEqual(output['request']['prompt'], body['prompt'])
            self.assertIn(body['prompt'], output['generation_prompt'])
            self.assertNotIn('transparent', output['generation_prompt'])
            with self.assertRaisesRegex(ValueError, 'Unsupported'):
                self.request(folder, steps=1)
            with self.assertRaisesRegex(ValueError, '日本語'):
                preview(self.request(folder, prompt='青いやかん'), self.service)

    # 見込み: 汎用グラフのCLIでも日本語指示を確認どおりに渡せる。
    # 合格: preview/prepareが同じ日本語を保持、英訳呼出し0。範囲: CLI分岐/実保存、APIは模擬。
    def test_plain_preview_preserves_japanese_without_translation(self):
        workflow = self.workflows.save(definition(0, 'plain'))
        body = self.request(self.root, prompt='青いやかん。', workflow_id=workflow['id'], workflow_version=workflow['version'])
        with patch('hermes_qwen.supplied_english', side_effect=AssertionError('no translation')) as translator:
            self.assertEqual(self.cli('preview')['generation_prompt'], body['prompt'])
            prepared = self.cli('prepare')
        self.assertEqual(prepared['generation_prompt'], body['prompt'])
        translator.assert_not_called()

    # 見込み: previewは保存定義と入力だけから、サーバー停止中でも生成文を表示できる。
    # 合格: 通信/事前接続確認/保存0、PNG検査と指示構築各1。範囲: CLIと実PNG/定義、APIは呼出し記録用mock。
    def test_cli_preview_is_offline_and_read_only(self):
        workflow = self.workflows.save(definition(1, 'qwen'))
        (self.root / 'reference.png').write_bytes(png('blue'))
        body = self.request(self.root, workflow_id=workflow['id'], workflow_version=workflow['version'],
                            references=[{'label': 'Blue reference', 'image': 'reference.png'}])
        offline = Mock(spec=API(), endpoint=self.api.endpoint)
        self.service.client_factory = Mock(return_value=offline)
        with patch.object(self.service, 'preflight', side_effect=AssertionError('preview must be offline')) as preflight, \
                patch.object(self.service, 'prepare', side_effect=AssertionError('preview must not save')) as prepare, \
                patch('qwen_generation.validate_png', wraps=validate_png) as inspect_png, \
                patch('hermes_qwen.generation_prompt', wraps=generation_prompt) as compile_prompt:
            output = self.cli('preview')
        preflight.assert_not_called()
        prepare.assert_not_called()
        self.assertEqual(offline.mock_calls, [])
        inspect_png.assert_called_once()
        compile_prompt.assert_called_once()
        self.assertIn(body['prompt'], output['generation_prompt'])
        self.assertIn('Blue reference', output['generation_prompt'])
        self.assertEqual(output['request']['workflow'], workflow)
        self.assertFalse(self.service.store.root.exists())

    # 見込み: prepareをserviceへ直接渡せばPNG処理・指示構築・接続確認を重複させない。
    # 合格: service入口/normalize/PNG/指示/事前確認各1、入力と完成指示を保存。範囲: CLI/実保存、API応答は固定。
    def test_cli_prepare_uses_one_service_preparation_and_preflight(self):
        workflow = self.workflows.save(definition(1, 'qwen'))
        raw = png('blue')
        (self.root / 'reference.png').write_bytes(raw)
        body = self.request(self.root, workflow_id=workflow['id'], workflow_version=workflow['version'],
                            references=[{'label': 'Blue reference', 'image': 'reference.png'}])
        compiler = Mock(wraps=generation_prompt)
        with patch.object(self.service, 'prepare', wraps=self.service.prepare) as prepare, \
                patch.object(self.service, 'normalize_request', wraps=self.service.normalize_request) as normalize, \
                patch.object(self.service, 'preflight', wraps=self.service.preflight) as preflight, \
                patch('qwen_generation.validate_png', wraps=validate_png) as inspect_png, \
                patch('hermes_qwen.generation_prompt', compiler), \
                patch('qwen_generation_phase.generation_prompt', compiler):
            output = self.cli('prepare')
        prepare.assert_called_once_with(body, supplied_english)
        normalize.assert_called_once_with(body)
        inspect_png.assert_called_once()
        compiler.assert_called_once()
        preflight.assert_called_once_with(workflow, self.api.endpoint)
        self.assertEqual(output['status'], 'prepared')
        self.assertEqual(self.service.store.read(body['job_id'], 'image-1.png'), raw)
        self.assertEqual(self.service.store.read(body['job_id'], 'conditioning-prompt.txt').decode(), output['generation_prompt'])
        self.assertEqual(self.api.calls, [])

    # 見込み: 同じUUIDの再確認は保存済み入力を守る。
    # 合格: 同一指示は同じjob、変更指示は拒否。範囲: 実保存、APIは模擬。
    def test_saved_job_rejects_changed_input_under_same_uuid(self):
        with tempfile.TemporaryDirectory() as folder:
            service = self.service
            body = self.request(folder)
            with patch.object(service, 'preflight'):
                first = service.prepare(body, supplied_english)
                self.assertEqual(first['status'], 'prepared')
                self.assertEqual(service.prepare(body, supplied_english)['job_id'], first['job_id'])
                with self.assertRaisesRegex(ValueError, '異なる入力'):
                    service.prepare({**body, 'prompt': 'A red teapot.'}, supplied_english)

    # 見込み: 準備済み以外のjobはCLIから再送しない。
    # 合格: 実行中/受付済み/不確定/失敗の全状態でsubmitゼロ。範囲: service固定応答。
    def test_uncertain_job_is_not_submitted_again(self):
        for status in ('running', 'queued', 'outcome_unknown', 'failed'):
            service = Mock()
            service.store.root = Path('/unused')
            service.payload.return_value = {'status': status}
            with self.assertRaisesRegex(ValueError, 'do not resubmit'):
                run_job(service, 'job', 'token')
            service.submit.assert_not_called()

    # 見込み: CLIはworkerの終了値ではなく保存jobの状態を判断する。
    # 合格: submit1回後のfailedを理由付きエラーにする。範囲: service固定応答。
    def test_job_failure_after_submit_is_an_error(self):
        service = Mock()
        service.store.root = Path('/unused')
        service.payload.return_value = {'status': 'prepared', 'request_sha256': 'hash'}
        service.reconcile.return_value = {'status': 'failed', 'error': 'model failed'}
        with self.assertRaisesRegex(ValueError, 'model failed'):
            run_job(service, 'job', 'token')
        service.submit.assert_called_once_with({'job_id': 'job', 'request_sha256': 'hash', 'image_session_token': 'token'})

    # 見込み: 5候補完了は選択を待ち、採用後だけ完成画像のpathを返す。
    # 合格: 選択前は候補5path/selection_required、選択3後はoutputのみ。範囲: 実保存/選択、PNGは固定。
    def test_completed_candidates_require_selection_before_returning_output_path(self):
        body = self.request(self.root)
        prepared = self.service.prepare(body, supplied_english)
        job_id = prepared['job_id']
        for index in range(1, 6):
            self.service.store.write_once(job_id, f'candidate-{index}.png', png((index, 0, 0)))
        self.service.store.event(job_id, 'succeeded')
        pending = result(self.service, job_id)
        self.assertTrue(pending['selection_required'])
        self.assertNotIn('image_path', pending)
        self.assertEqual(pending['candidate_paths'], [str(self.service.store.root / job_id / f'candidate-{i}.png') for i in range(1, 6)])
        self.assertTrue(all(Path(path).is_file() for path in pending['candidate_paths']))
        self.service.select({'job_id': job_id, 'candidate_index': 3})
        selected = result(self.service, job_id)
        self.assertEqual(selected['image_path'], str(self.service.store.root / job_id / 'output.png'))
        self.assertNotIn('selection_required', selected)
        self.assertNotIn('candidate_paths', selected)
        self.assertEqual(Path(selected['image_path']).read_bytes(), png((3, 0, 0)))
        self.assertEqual(self.api.calls, [])


if __name__ == '__main__':
    unittest.main()
