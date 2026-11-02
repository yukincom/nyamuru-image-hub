"""見込み: 既存jobをAPIへ接続すれば入力と候補の所有を保てる。
合格: 版/最終指示/参照順/5seedを固定し、欠落応答でも再送せず選択後だけ透過。
範囲: 実job保存・PNG・APIアダプター、ComfyUI推論/HTTPは固定応答。実画質は対象外。
"""
import base64
import copy
import errno
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from PIL import Image
from comfy_client import ComfyClient, ComfyError, ComfyOutputError, ComfyRejected, ComfySubmissionUnknown
from comfy_generation import collect_candidate, read_optional, reconcile_candidates, run_candidates, submission_id
from comfy_workflows import WorkflowStore
from generation_store import canonical
from image_generation_lock import create_generation_lease, hold_generation_lease, record_api_submission, validate_generation_fd
from qwen_generation import QwenGenerationService, PROFILE, SAVE_FAILURE_EXIT_CODE


def png(color='white', size=(64, 64)):
    out = io.BytesIO()
    Image.new('RGB', size, color).save(out, format='PNG')
    return out.getvalue()


def definition(count=0, mode='plain'):
    graph = {
        'p': {'class_type': 'Text', 'inputs': {'text': 'original', 'seed': 1, 'width': 64, 'height': 64, 'untouched': 'keep'}},
        'out': {'class_type': 'SaveImage', 'inputs': {'images': ['p', 0], 'filename_prefix': 'unchanged'}},
    }
    images = []
    for i in range(count):
        key = f'image-{i}'
        graph[key] = {'class_type': 'LoadImage', 'inputs': {'image': 'placeholder.png'}}
        images.append([{'node': key, 'input': 'image'}])
    binding = {key: [{'node': 'p', 'input': 'text' if key == 'prompt' else key}] for key in ('prompt', 'seed', 'width', 'height')}
    binding.update(images=images, output={'node': 'out', 'index': 0}, prompt_mode=mode, fixed_size=None)
    return {'name': 'Test workflow', 'graph': graph, 'binding': binding}


class API:
    def __init__(self, endpoint='http://127.0.0.1:8188'):
        self.endpoint = endpoint
        self.calls = []
        self.uploads = []
        self.prompts = {}
        self.lose_once = False
        self.reject_second = False
        self.extension = True
        self.deleted_outputs = []

    def system_stats(self):
        return {'system': {'comfyui_version': 'fixture'}, 'devices': []}

    def object_info(self):
        return {
            'Text': {'input': {'required': {'text': ['STRING'], 'seed': ['INT'], 'width': ['INT'], 'height': ['INT'], 'untouched': ['STRING']}}, 'output': ['IMAGE']},
            'SaveImage': {'input': {'required': {'images': ['IMAGE'], 'filename_prefix': ['STRING']}}, 'output': [], 'output_node': True},
            'LoadImage': {'input': {'required': {'image': [['placeholder.png'], {'image_upload': True}]}}, 'output': ['IMAGE', 'MASK']},
        }

    def memory_release_available(self):
        return self.extension

    def upload_image(self, raw, name):
        self.uploads.append((name, raw))
        return 'input/' + name

    def submit(self, graph, correlation):
        self.calls.append(copy.deepcopy(graph))
        if self.reject_second and len(self.calls) == 2:
            raise ComfyRejected('node rejected')
        self.prompts[correlation] = {'state': 'succeeded', 'history': {'marker': correlation, 'size': (graph['p']['inputs']['width'], graph['p']['inputs']['height']),
            'outputs': {'out': {'images': [{'filename': f'comfy-{correlation}.png', 'subfolder': '', 'type': 'output'}]}}}}
        if self.lose_once:
            self.lose_once = False
            raise ComfySubmissionUnknown(correlation)
        return correlation

    def find_prompt(self, correlation):
        return correlation if correlation in self.prompts else None

    def prompt_state(self, prompt_id):
        return self.prompts.get(prompt_id, {'state': 'unknown', 'missing': True})

    def get_image(self, history, binding):
        if binding != {'node': 'out', 'index': 0}:
            raise AssertionError('wrong output')
        return png('#00FF00', history.get('size', (1024, 1024)))

    def cancel(self, prompt_id):
        self.prompts.pop(prompt_id, None)
        return {'prompt_id': prompt_id, 'supported': True, 'cancelled': True}

    def delete_outputs(self, outputs):
        self.deleted_outputs.extend(outputs)


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.workflows = WorkflowStore(self.root / 'workflows')
        self.api = API()
        self.service = QwenGenerationService(self.root / 'jobs', workflows=self.workflows, client_factory=lambda endpoint: self.api)
        self.token = str(uuid4())
        self.leases = self.root / 'leases'
        create_generation_lease(self.token, self.leases)
        # Worker launches in this suite are synthetic, including their process identity.
        patcher = patch('qwen_generation.identity', return_value=None)
        patcher.start(); self.addCleanup(patcher.stop)

    def body(self, count=0, mode='plain'):
        workflow = self.workflows.save(definition(count, mode))
        return {'job_id': str(uuid4()), 'workflow_id': workflow['id'], 'workflow_version': workflow['version'],
                'comfyui_url': self.api.endpoint, 'profile': PROFILE, 'document_key': 'fixture-work',
                'page_number': 1, 'panel_id': 1, 'overlay': False, 'owner_key': 'figure-1',
                'label': 'Subject', 'mode': 'new', 'width': 64, 'height': 64, 'prompt': 'Keep this exact.\n日本語本文',
                'character_keys': [], 'references': [{'label': f'ref-{i}', 'character_keys': [],
                    'image': 'data:image/png;base64,' + base64.b64encode(png((i, 0, 0))).decode()} for i in range(count)]}

    def prepare(self, body):
        def translate(value):
            return {'prompt': 'Draw a person.', 'references': [{'file': r['file'], 'label': r['label']} for r in value['references']]}
        return self.service.prepare(body, translate)

    def run_job(self, body):
        job_id = body['job_id']
        self.service.store.event(job_id, 'queued')
        with hold_generation_lease(self.token, self.leases) as fd:
            with patch('qwen_generation.validate_generation_fd', side_effect=lambda token, descriptor: validate_generation_fd(token, descriptor, self.leases)):
                self.service.run(job_id, os.dup(fd), self.token)
        return self.service.payload(job_id)

    # 見込み: 準備時の定義コピーなら後の登録変更は送信へ混ざらない。
    # 合格: v1固定・plain原文不変・10参照1回・5seed、モデル等未対応値は不変。範囲: 保存＋模擬API。
    def test_snapshot_plain_prompt_ten_images_and_five_candidates(self):
        body = self.body(9)
        # Existing request contract permits 9 references plus one source image.
        body.update(mode='paint', paint_image='data:image/png;base64,' + base64.b64encode(png('black')).decode())
        current = self.workflows.get(body['workflow_id'])
        ten = definition(10)
        updated = self.workflows.save({**ten, 'id': current['id'], 'expected_version': current['version']})
        body['workflow_version'] = updated['version']
        self.prepare(body)
        self.workflows.save({**definition(0), 'id': current['id'], 'expected_version': updated['version'], 'name': 'New'})
        result = self.run_job(body)
        self.assertEqual(result['status'], 'succeeded')
        self.assertEqual(result['workflow_version'], 2)
        self.assertEqual(len(self.api.uploads), 10)
        self.assertEqual(len(self.api.calls), 5)
        self.assertEqual({g['p']['inputs']['seed'] for g in self.api.calls}, set(result['candidate_seeds']))
        for graph in self.api.calls:
            self.assertEqual(graph['p']['inputs']['text'], body['prompt'])
            self.assertEqual(graph['p']['inputs']['untouched'], 'keep')
            self.assertEqual(graph['out']['inputs']['filename_prefix'], 'unchanged')
            for i, (name, _) in enumerate(self.api.uploads):
                self.assertEqual(graph[f'image-{i}']['inputs']['image'], 'input/' + name)
        self.assertNotIn('image', result)
        self.assertEqual(len(result['candidates']), 5)

    # 見込み: 対応モードの人物だけキー色を加え、採用前は加工しない。
    # 合格: 白/RGBA指定なし、青が保存・promptへ一致、候補3の採用だけ色抜き1回。範囲: 模擬API・実保存。
    def test_qwen_chroma_prompt_and_selection_once(self):
        body = self.body(mode='qwen')
        body['chroma_key_color'] = '#0000FF'
        prepared = self.prepare(body)
        self.assertIn('pure blue background (#0000FF)', prepared['generation_prompt'])
        self.assertNotIn('plain white background', prepared['generation_prompt'])
        self.assertNotIn('RGBA image', prepared['generation_prompt'])
        with patch('qwen_background.remove_chroma_background', return_value=png('white')) as cut:
            result = self.run_job(body)
            cut.assert_not_called()
            selected = self.service.select({'job_id': body['job_id'], 'candidate_index': 3})
            self.service.select({'job_id': body['job_id'], 'candidate_index': 3})
            cut.assert_called_once()
            self.assertEqual(cut.call_args.args[1]['color'], '#0000FF')
            self.assertEqual(selected['selected_candidate'], 3)
            self.assertEqual(len(result['candidates']), 5)

    # 見込み: 受付返答を失っても相関IDから回収できる。
    # 合格: POSTは候補数の5回だけ、同じ候補の重複なし。範囲: 返答欠落を固定した模擬API。
    def test_lost_acceptance_reply_is_reconciled_without_resubmit(self):
        body = self.body()
        self.prepare(body)
        self.api.lose_once = True
        self.assertEqual(self.run_job(body)['status'], 'succeeded')
        self.assertEqual(len(self.api.calls), 5)

    # 見込み: workerが知っている受付IDを使えば、待機ごとの再読込・再保存を省ける。
    # 合格: 各候補3回照会でもPOST5回、ledgerは送信前/受付/終端の15回、受付fileの再読込0回。
    # 範囲: 実保存・模擬API、sleep省略。未確定応答の回収は別caseで確認。
    def test_polling_reuses_acceptance_and_records_only_transitions(self):
        body = self.body()
        self.prepare(body)
        states = self.api.prompt_state
        polls = {}
        def poll(prompt_id):
            polls[prompt_id] = polls.get(prompt_id, 0) + 1
            return {'state': 'running'} if polls[prompt_id] < 3 else states(prompt_id)
        with patch.object(self.api, 'prompt_state', side_effect=poll), \
             patch('comfy_generation.read_optional', wraps=read_optional) as reads, \
             patch('comfy_generation.record_api_submission', wraps=record_api_submission) as records, \
             patch('comfy_generation.run_candidates', side_effect=lambda *args: run_candidates(*args, sleep=lambda seconds: None)):
            result = self.run_job(body)
        self.assertEqual(result['status'], 'succeeded')
        self.assertEqual(len(self.api.calls), 5)
        self.assertEqual(list(polls.values()), [3] * 5)
        self.assertEqual([call.args[2] for call in reads.call_args_list], ['api-uploads.json'])
        self.assertEqual(records.call_count, 15)
        self.assertEqual(sum(call.kwargs.get('terminal', False) for call in records.call_args_list), 5)

    # 見込み: 画像の形式・寸法は回収時に判定し、全画素復号を重ねない。
    # 合格: 正常PNGは復号なしで保存、異形式・寸法違いはComfyOutputErrorで未保存。範囲: 実PNGと保存、APIは模擬。
    def test_collector_checks_output_metadata_once_without_pixel_decode(self):
        body = self.body()
        self.prepare(body)
        value = self.service.load(body['job_id'])
        raw = png('white', tuple(value['output_size']))
        submission = {'correlation_id': 'owned', 'prompt_id': 'accepted'}
        self.api.prompts['accepted'] = {'state': 'succeeded', 'history': {}}
        from PIL import PngImagePlugin
        with patch.object(self.api, 'get_image', return_value=raw), \
             patch.object(PngImagePlugin.PngImageFile, 'load', side_effect=AssertionError('回収時に全画素を復号しない')):
            self.assertEqual(collect_candidate(self.service, body['job_id'], 1, self.api, submission=submission, value=value), 'succeeded')
        self.assertEqual(self.service.store.read(body['job_id'], 'candidate-1.png'), raw)
        jpeg = io.BytesIO()
        Image.new('RGB', tuple(value['output_size'])).save(jpeg, format='JPEG')
        for index, bad in enumerate((jpeg.getvalue(), png('white', (32, 32))), 2):
            with self.subTest(index=index), patch.object(self.api, 'get_image', return_value=bad):
                with self.assertRaises(ComfyOutputError):
                    collect_candidate(self.service, body['job_id'], index, self.api, submission=submission, value=value)
                self.assertFalse((self.service.store.root / body['job_id'] / f'candidate-{index}.png').exists())

    # 見込み: 途中拒否は完成候補を残し、選択へ進まない。
    # 合格: 候補1だけ保存、失敗、採用拒否、候補3以降のPOST無し。範囲: 2回目HTTP拒否の模擬。
    def test_partial_failure_keeps_candidates_without_selection(self):
        body = self.body()
        self.prepare(body)
        self.api.reject_second = True
        result = self.run_job(body)
        self.assertEqual(result['status'], 'failed')
        self.assertEqual([c['index'] for c in result['candidates']], [1])
        self.assertEqual(len(self.api.calls), 2)
        with self.assertRaises(ValueError):
            self.service.select({'job_id': body['job_id'], 'candidate_index': 1})

    # 見込み: worker消失後の照合は送信済み分の回収だけを行う。
    # 合格: 候補1は回収、未送信2..5は送信0回、履歴消去時はunknown。範囲: 保存復元＋固定API。
    def test_recovery_does_not_send_remaining_candidates(self):
        body = self.body()
        self.prepare(body)
        job_id = body['job_id']
        correlation = submission_id(job_id, 1)
        self.service.store.write_once(job_id, 'api-intent-1.json', canonical({'correlation_id': correlation, 'seed': 1}))
        self.assertEqual(reconcile_candidates(self.service, job_id), 'outcome_unknown')
        self.api.prompts[correlation] = {'state': 'succeeded', 'history': {}}
        self.assertEqual(reconcile_candidates(self.service, job_id), 'failed')
        self.assertTrue((self.service.store.root / job_id / 'candidate-1.png').is_file())
        self.assertEqual(self.api.calls, [])

    # 見込み: 画像取得の一時障害は画像不正とせず、再照合で回収できる。
    # 合格: 未確定・非終端を維持し、回復後は候補1を保存。追加送信0回、未送信候補は失敗扱い。範囲: 実保存、取得障害は模擬。
    def test_view_timeout_stays_unknown_and_can_be_reconciled(self):
        body = self.body()
        self.prepare(body)
        with patch.object(self.api, 'get_image', side_effect=ComfyError('temporary view timeout')) as fetch:
            result = self.run_job(body)
        fetch.assert_called_once()
        self.assertEqual(result['status'], 'outcome_unknown')
        ledger = json.loads((self.leases / f'{self.token}.json').read_text())
        self.assertFalse(ledger['api_submissions'][-1]['terminal'])
        self.assertEqual(len(self.api.calls), 1)
        self.assertEqual(reconcile_candidates(self.service, body['job_id']), 'failed')
        self.assertTrue((self.service.store.root / body['job_id'] / 'candidate-1.png').exists())
        self.assertEqual(len(self.api.calls), 1)

    # 見込み: 取消受付後の通信障害を終了証拠にせず、実行中の予約を保つ。
    # 合格: 未確定・非終端・履歴削除不可を維持し、送信は最初の1回のみ。範囲: 実client判定と保存、通信・時刻は模擬。
    def test_cancel_receipt_with_offline_observation_keeps_job_unresolved(self):
        body = self.body()
        self.prepare(body)
        submit = self.api.submit
        def accepted(graph, correlation):
            prompt_id = submit(graph, correlation)
            self.api.prompts[prompt_id] = {'state': 'running'}
            self.service.store.write_once(body['job_id'], 'api-cancelled-1.json',
                canonical({'prompt_id': prompt_id, 'cancelled': True}))
            return prompt_id
        observer = ComfyClient(self.api.endpoint)
        with patch.object(self.api, 'submit', side_effect=accepted), \
             patch.object(observer, 'queue', side_effect=ComfyError('offline')) as queue, \
             patch.object(observer, 'history') as history, \
             patch.object(self.api, 'prompt_state', side_effect=observer.prompt_state), \
             patch('comfy_generation.run_candidates', side_effect=lambda *args: run_candidates(*args, now=iter([0, 7200]).__next__)):
            result = self.run_job(body)
        queue.assert_called_once(); history.assert_not_called()
        self.assertEqual(result['status'], 'outcome_unknown')
        self.assertEqual(list(self.api.prompts.values()), [{'state': 'running'}])
        ledger = json.loads((self.leases / f'{self.token}.json').read_text())
        self.assertFalse(ledger['api_submissions'][-1]['terminal'])
        self.assertEqual(len(self.api.calls), 1)
        with self.assertRaisesRegex(ValueError, '結果未確定'):
            self.service.delete({'document_key': body['document_key'], 'jobs': [{'job_id': body['job_id']}]})

    # 見込み: 正常な不在と同IDの取消受付が揃えば、削除済み待機jobを終了扱いできる。
    # 合格: 両条件ありはfailed、受付なし・別ID・不正履歴はunknown、実行中はrunning。範囲: 実保存、状態は模擬。
    def test_cancelled_prompt_requires_observed_absence_and_matching_receipt(self):
        for receipt_id, state, expected in [
            ('accepted', {'state': 'unknown', 'missing': True}, 'failed'),
            ('other', {'state': 'unknown', 'missing': True}, 'unknown'),
            (None, {'state': 'unknown', 'missing': True}, 'unknown'),
            ('accepted', {'state': 'unknown', 'history': {}}, 'unknown'),
            ('accepted', {'state': 'running'}, 'running'),
        ]:
            with self.subTest(receipt_id=receipt_id, state=state):
                body = self.body(); self.prepare(body)
                if receipt_id:
                    self.service.store.write_once(body['job_id'], 'api-cancelled-1.json',
                        canonical({'prompt_id': receipt_id, 'cancelled': True}))
                with patch.object(self.api, 'prompt_state', return_value=state):
                    result = collect_candidate(self.service, body['job_id'], 1, self.api,
                        submission={'correlation_id': 'own', 'prompt_id': 'accepted'})
                self.assertEqual(result, expected)
        self.assertEqual(self.api.calls, [])

    # 見込み: 確定画像不備を保存すれば、再照合でも同じ画像を取り直さない。
    # 合格: 候補2で失敗・終端化し候補1保持。再起動後も再取得・後続送信0回、削除可。範囲: 実PNGと保存、APIは模擬。
    def test_definitive_output_errors_fail_once_and_preserve_prior_candidates(self):
        jpeg = io.BytesIO(); Image.new('RGB', (1024, 1024)).save(jpeg, format='JPEG')
        animation = io.BytesIO()
        Image.new('RGB', (1024, 1024), 'red').save(animation, format='PNG', save_all=True,
            append_images=[Image.new('RGB', (1024, 1024), 'blue')], duration=100, loop=0)
        observer = ComfyClient(self.api.endpoint)
        invalid = [('dimensions', png('white', (32, 32))), ('format', jpeg.getvalue()),
                   ('animated', animation.getvalue()), ('broken', b'not an image'), ('missing-output', None)]
        for label, raw in invalid:
            with self.subTest(label=label):
                self.api = API()
                body = self.body(); self.prepare(body)
                get_image = self.api.get_image
                def output(history, binding):
                    if len(self.api.calls) == 1:
                        return get_image(history, binding)
                    return raw if raw is not None else observer.get_image({'outputs': {}}, binding)
                with patch.object(self.api, 'get_image', side_effect=output) as fetch:
                    result = self.run_job(body)
                    self.assertEqual(result['status'], 'failed')
                    self.assertIn('候補2', result['error'])
                    self.assertEqual([c['index'] for c in result['candidates']], [1])
                    self.assertEqual(len(self.api.calls), 2)
                    self.assertEqual(fetch.call_count, 2)
                    ledger = json.loads((self.leases / f'{self.token}.json').read_text())
                    self.assertTrue(all(item['terminal'] for item in ledger['api_submissions']))
                    restarted = QwenGenerationService(self.service.store.root, workflows=self.workflows, client_factory=lambda endpoint: self.api)
                    for _ in range(2):
                        reread = restarted.reconcile({'job_id': body['job_id']})
                        self.assertEqual(reread['status'], 'failed')
                        self.assertEqual(reread['error'], result['error'])
                        self.assertEqual(reread['candidates'], result['candidates'])
                    self.assertEqual(fetch.call_count, 2)
                deleted = self.service.delete({'document_key': body['document_key'], 'jobs': [{'job_id': body['job_id']}]})
                self.assertEqual(deleted['deleted_job_ids'], [body['job_id']])

    # 見込み: worker消失後の回収で見つけた画像不備も、確定失敗へ揃えられる。
    # 合格: 初回にfailedを保存、後続2回の取得0回、送信0回、履歴削除可。範囲: 実保存、worker状態とAPIは模擬。
    def test_recovered_output_error_is_persisted_as_failed(self):
        body = self.body(); self.prepare(body)
        job_id = body['job_id']; correlation = submission_id(job_id, 1)
        self.service.store.event(job_id, 'outcome_unknown')
        self.service.store.write_once(job_id, 'execution.json', canonical({'pid': 123, 'at': 0}))
        self.service.store.write_once(job_id, 'api-intent-1.json', canonical({'correlation_id': correlation, 'seed': 1}))
        self.service.store.write_once(job_id, 'api-accepted-1.json', canonical({'prompt_id': correlation}))
        self.api.prompts[correlation] = {'state': 'succeeded', 'history': {}}
        with patch('qwen_generation.subprocess.run', return_value=Mock(stdout='')), \
             patch.object(self.api, 'get_image', return_value=png(size=(32, 32))) as fetch:
            for _ in range(3):
                result = self.service.reconcile({'job_id': job_id})
                self.assertEqual(result['status'], 'failed')
                self.assertIn('寸法', result['error'])
            fetch.assert_called_once()
        self.assertEqual(self.api.calls, [])
        self.assertEqual(self.service.delete({'document_key': body['document_key'], 'jobs': [{'job_id': job_id}]})['deleted_job_ids'], [job_id])

    # 見込み: 生成後の保存失敗を分ければ再取得を繰り返さない。合格: failed通知・ledger終端・保存済み候補保持、再起動後もfetch増加0。範囲: 実保存、APIと書込障害は模擬。
    def test_output_write_failure_is_reported_without_automatic_refetch(self):
        for filename, submitted, saved in [('candidate-2.png', 2, 1), ('candidates.json', 5, 5)]:
            with self.subTest(filename=filename):
                self.api = API()
                body = self.body(); self.prepare(body)
                write = self.service.store.write_once
                def fail_result(job_id, name, raw):
                    if name == filename:
                        raise OSError(errno.ENOSPC, 'No space left on device')
                    return write(job_id, name, raw)
                with patch.object(self.service.store, 'write_once', side_effect=fail_result), \
                     patch.object(self.api, 'get_image', wraps=self.api.get_image) as fetch:
                    result = self.run_job(body)
                    self.assertEqual(result['status'], 'failed')
                    self.assertIn('画像のローカル保存に失敗', result['error'])
                    self.assertEqual([c['index'] for c in result['candidates']], list(range(1, saved + 1)))
                    self.assertEqual(len(self.api.calls), submitted)
                    ledger = json.loads((self.leases / f'{self.token}.json').read_text())
                    self.assertTrue(all(item['terminal'] for item in ledger['api_submissions']))
                    restarted = QwenGenerationService(self.service.store.root, workflows=self.workflows, client_factory=lambda endpoint: self.api)
                    for _ in range(2):
                        reread = restarted.reconcile({'job_id': body['job_id']})
                        self.assertEqual(reread['status'], 'failed')
                        self.assertEqual(reread['error'], result['error'])
                        self.assertEqual(reread['candidates'], result['candidates'])
                    self.assertEqual(fetch.call_count, submitted)
                self.assertEqual(self.service.delete({'document_key': body['document_key'], 'jobs': [{'job_id': body['job_id']}]})['deleted_job_ids'], [body['job_id']])

    # 見込み: worker消失後の画像保存失敗も失敗通知へ揃える。合格: failed・候補1保持・初回fetchのみ、後続照合と再起動後は再取得0。範囲: 実保存、APIとprocess照合は模擬。
    def test_recovered_output_write_failure_is_reported_once(self):
        body = self.body(); self.prepare(body)
        job_id = body['job_id']
        self.service.store.event(job_id, 'outcome_unknown')
        self.service.store.write_once(job_id, 'execution.json', canonical({'pid': 123, 'at': 0}))
        first = png(size=tuple(self.service.load(job_id)['output_size']))
        self.service.store.write_once(job_id, 'candidate-1.png', first)
        correlation = submission_id(job_id, 2)
        self.service.store.write_once(job_id, 'api-intent-2.json', canonical({'correlation_id': correlation, 'seed': 2}))
        self.service.store.write_once(job_id, 'api-accepted-2.json', canonical({'prompt_id': correlation}))
        self.api.prompts[correlation] = {'state': 'succeeded', 'history': {}}
        write = self.service.store.write_once
        def fail_candidate(job_id, name, raw):
            if name == 'candidate-2.png':
                raise OSError(errno.ENOSPC, 'No space left on device')
            return write(job_id, name, raw)
        with patch.object(self.service.store, 'write_once', side_effect=fail_candidate), \
             patch('qwen_generation.subprocess.run', return_value=Mock(stdout='')), \
             patch.object(self.api, 'get_image', wraps=self.api.get_image) as fetch:
            for _ in range(2):
                result = self.service.reconcile({'job_id': job_id})
                self.assertEqual(result['status'], 'failed')
                self.assertIn('画像のローカル保存に失敗', result['error'])
                self.assertEqual([c['index'] for c in result['candidates']], [1])
            restarted = QwenGenerationService(self.service.store.root, workflows=self.workflows, client_factory=lambda endpoint: self.api)
            self.assertEqual(restarted.reconcile({'job_id': job_id})['status'], 'failed')
            fetch.assert_called_once()
        self.assertEqual(self.service.store.read(job_id, 'candidate-1.png'), first)
        self.assertEqual(self.api.calls, [])

    # 見込み: 全書込不能でもworker終了コードなら保存失敗を通知できる。合格: 候補・event・ledgerがENOSPCでもfailedを返し、同bridge内の再fetch0。範囲: 別serviceと模擬Popen。
    def test_full_disk_failure_is_notified_through_worker_exit(self):
        body = self.body(); prepared = self.prepare(body)
        job_id = body['job_id']
        process = Mock(pid=123)
        process.poll.return_value = None
        with patch('qwen_generation.hold_generation_lease', side_effect=lambda token: hold_generation_lease(token, self.leases)), \
             patch('qwen_generation.subprocess.Popen', return_value=process):
            self.service.submit({**prepared, 'image_session_token': self.token})
        worker = QwenGenerationService(self.service.store.root, workflows=self.workflows, client_factory=lambda endpoint: self.api)
        write, pwrite, get_image = worker.store.write_once, os.pwrite, self.api.get_image
        full = False
        failed_names = []
        def output(history, binding):
            nonlocal full
            raw = get_image(history, binding)
            if len(self.api.calls) == 2:
                full = True
            return raw
        def disk_write(job_id, name, raw):
            if full:
                failed_names.append(name)
                raise OSError(errno.ENOSPC, 'No space left on device')
            return write(job_id, name, raw)
        def ledger_write(fd, raw, offset):
            if full:
                raise OSError(errno.ENOSPC, 'No space left on device')
            return pwrite(fd, raw, offset)
        with patch.object(self.api, 'get_image', side_effect=output) as fetch, \
             patch.object(worker.store, 'write_once', side_effect=disk_write), \
             patch.object(self.service.store, 'write_once', side_effect=disk_write), \
             patch('image_generation_lock.os.pwrite', side_effect=ledger_write):
            with hold_generation_lease(self.token, self.leases) as fd, \
                 patch('qwen_generation.validate_generation_fd', side_effect=lambda token, descriptor: validate_generation_fd(token, descriptor, self.leases)):
                code = worker.run(job_id, os.dup(fd), self.token)
            self.assertEqual(code, SAVE_FAILURE_EXIT_CODE)
            process.poll.return_value = code
            for _ in range(2):
                result = self.service.reconcile({'job_id': job_id})
                self.assertEqual(result['status'], 'failed')
                self.assertIn('画像のローカル保存に失敗', result['error'])
                self.assertEqual([c['index'] for c in result['candidates']], [1])
            self.assertEqual(fetch.call_count, 2)
            self.assertFalse(self.service._workers)
            self.assertEqual(self.service.store.latest(job_id)['status'], 'running')
            self.assertIn('candidate-2.png', failed_names)
            self.assertTrue(any(name.startswith('event-') for name in failed_names))
            ledger = json.loads((self.leases / f'{self.token}.json').read_text())
            self.assertFalse(ledger['api_submissions'][-1]['terminal'])
            # No durable failure can survive a bridge restart while every write fails.
            restarted = QwenGenerationService(self.service.store.root, workflows=self.workflows, client_factory=lambda endpoint: self.api)
            with patch.object(restarted.store, 'write_once', side_effect=disk_write), \
                 patch('qwen_generation.subprocess.run', return_value=Mock(stdout='')), \
                 patch('qwen_generation.time.time', return_value=10**12):
                for _ in range(2):
                    repeated = restarted.reconcile({'job_id': job_id})
                    self.assertEqual(repeated['status'], 'failed')
                    self.assertIn('画像のローカル保存に失敗', repeated['error'])
            self.assertEqual(fetch.call_count, 3)
        self.assertEqual(len(self.api.calls), 2)

    # 見込み: 成功workerの回収は保存失敗扱いを増やさない。合格: 5候補成功・Popen保持0・失敗通知0、後続照合で追加送信0。範囲: 実保存とrun境界、起動とAPIは模擬。
    def test_successful_workers_are_reaped_without_failure_notifications(self):
        body = self.body(); prepared = self.prepare(body)
        process = Mock(pid=123)
        process.poll.return_value = None
        with patch('qwen_generation.hold_generation_lease', side_effect=lambda token: hold_generation_lease(token, self.leases)), \
             patch('qwen_generation.subprocess.Popen', return_value=process):
            self.service.submit({**prepared, 'image_session_token': self.token})
        self.assertEqual(self.run_job(body)['status'], 'succeeded')
        process.poll.return_value = 0
        self.assertEqual(self.service.reconcile({'job_id': body['job_id']})['status'], 'succeeded')
        self.assertEqual(len(self.api.calls), 5)
        self.assertFalse(self.service._workers)
        self.assertFalse(self.service._save_failures)

    # 見込み: 未選択・参照超過・確認拡張なしは推論前に止まる。
    # 合格: /promptとtranslate0回、原因が表示される。範囲: prepareの入力・機能検査。
    def test_preflight_rejects_missing_selection_count_and_release_extension(self):
        body = self.body()
        for modified, expected in [({**body, 'workflow_id': ''}, '選んで'),
                                   ({**body, 'references': [{'label': 'extra', 'character_keys': [], 'image': 'data:image/png;base64,' + base64.b64encode(png()).decode()}]}, '参照')]:
            with patch('builtins.print'):
                with self.assertRaisesRegex(ValueError, expected):
                    self.service.prepare(modified, lambda value: self.fail('must not translate'))
        self.api.extension = False
        with self.assertRaisesRegex(ValueError, '拡張'):
            self.service.prepare(body, lambda value: self.fail('must not translate'))
        self.assertEqual(self.api.calls, [])


if __name__ == '__main__':
    unittest.main()
