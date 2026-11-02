"""見込み: 外部APIの存続はworkerのFD寿命だけでは判定できない。
合格: 保存した自分の送信IDが終端で、確認拡張が解放完了するまで復帰しない。
範囲: 実leaseファイルとguardian待機関数、API状態は模擬。実LLMの停止/復帰はしない。
"""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from image_generation_lock import (create_generation_lease, hold_generation_lease, close_generation_lease,
                                   record_api_submission, await_api_release)


class SessionTests(unittest.TestCase):
    # 見込み: 同じ受付情報を通知しても書き直さなければ待機中のI/Oを減らせる。
    # 合格: 同値再通知はwrite/fsync0回、受付IDや終端が変わる時は各1回保存。範囲: 実lease、起動・APIなし。
    def test_submission_ledger_writes_only_changed_state(self):
        with tempfile.TemporaryDirectory() as directory:
            token = str(uuid4())
            path = create_generation_lease(token, directory)
            with hold_generation_lease(token, directory) as fd:
                record_api_submission(fd, 'http://localhost:8188', 'own')
                with patch('image_generation_lock.os.pwrite', wraps=os.pwrite) as write, \
                     patch('image_generation_lock.os.fsync', wraps=os.fsync) as sync:
                    record_api_submission(fd, 'http://localhost:8188', 'own')
                    write.assert_not_called(); sync.assert_not_called()
                    record_api_submission(fd, 'http://localhost:8188', 'own', prompt_id='accepted')
                    record_api_submission(fd, 'http://localhost:8188', 'own', prompt_id='accepted')
                    self.assertEqual(write.call_count, 1); self.assertEqual(sync.call_count, 1)
                    record_api_submission(fd, 'http://localhost:8188', 'own', terminal=True)
                    record_api_submission(fd, 'http://localhost:8188', 'own', terminal=True)
                    self.assertEqual(write.call_count, 2); self.assertEqual(sync.call_count, 2)
            self.assertEqual(json.loads(path.read_text())['api_submissions'], [{
                'endpoint': 'http://localhost:8188', 'correlation_id': 'own',
                'prompt_id': 'accepted', 'terminal': True}])

    # 見込み: FD終了後にも外部送信の証拠を残せば親消失で復帰しない。
    # 合格: close後active=falseかつ5記録保持、late submit拒否。範囲: 実file/flock。
    def test_closed_lease_preserves_durable_external_submission_records(self):
        with tempfile.TemporaryDirectory() as directory:
            token = str(uuid4())
            path = create_generation_lease(token, directory)
            with hold_generation_lease(token, directory) as fd:
                for i in range(5):
                    record_api_submission(fd, 'http://localhost:8188', str(i), prompt_id=f'prompt-{i}', terminal=i < 4)
            records = close_generation_lease(token, directory)
            self.assertEqual(len(records), 5)
            self.assertFalse(json.loads(path.read_text())['active'])
            self.assertEqual(json.loads(path.read_text())['api_submissions'], records)
            with self.assertRaises(ValueError):
                with hold_generation_lease(token, directory):
                    self.fail('late entry')

    # 見込み: running/unknownや未解放では復帰待ちを保つ。
    # 合格: unknown中の解放0回、成功後release(false,true)の順で完了。範囲: 模擬API。
    def test_waits_for_external_completion_and_confirmed_memory_release(self):
        events = []
        class Client:
            states = iter(['running', 'unknown', 'succeeded'])
            releases = iter([False, True])
            def find_prompt(self, correlation):
                events.append('find'); return 'owned'
            def prompt_state(self, prompt):
                state = next(self.states); events.append(state); return {'state': state}
            def release_models(self):
                result = next(self.releases); events.append(('release', result)); return result
        record = {'endpoint': 'http://localhost:8188', 'correlation_id': 'own'}
        await_api_release([record], client_factory=lambda endpoint: Client(), sleep=lambda seconds: events.append('wait'))
        self.assertEqual(record['prompt_id'], 'owned')
        self.assertEqual(events, ['find', 'running', 'wait', 'unknown', 'wait', 'succeeded', ('release', False), 'wait', ('release', True)])

    # 見込み: 正常応答でqueue/履歴の不在が続くなら中断として後片付けできる。
    # 合格: 2回の不在後にinterrupted、成功扱い0件、解放確認1回。範囲: 実待機関数、APIは模擬。
    def test_missing_history_is_interrupted_without_inventing_success(self):
        events = []
        class Client:
            def find_prompt(self, correlation): events.append('find'); return None
            def release_models(self): events.append('release'); return True
        record = {'endpoint': 'http://localhost:8188', 'correlation_id': 'own'}
        await_api_release([record], client_factory=lambda endpoint: Client(), sleep=lambda _: events.append('wait'))
        self.assertEqual(events, ['find', 'wait', 'find', 'release'])
        self.assertEqual(record['outcome'], 'interrupted')
        self.assertTrue(record['terminal'])

    # 見込み: 通信失敗を正常な不在に数えなければ、誤った解放を防げる。
    # 合格: 有限期限でエラー、終端化/解放0回。範囲: 実待機関数、時計と通信は模擬。
    def test_transport_failure_times_out_without_releasing_or_becoming_success(self):
        events = []
        class Client:
            def find_prompt(self, correlation): raise OSError('offline')
            def release_models(self): events.append('release'); return True
        record = {'endpoint': 'http://localhost:8188', 'correlation_id': 'own'}
        clock = iter([0, 0, 4])
        with self.assertRaisesRegex(ValueError, '後片付け'):
            await_api_release([record], client_factory=lambda endpoint: Client(), sleep=lambda _: None,
                              now=lambda: next(clock), timeout=3)
        self.assertEqual(events, [])
        self.assertFalse(record.get('terminal', False))

    # 見込み: 取消しは受付だけでなく実際のqueue終了と解放を待つ。
    # 合格: 自分のIDだけ取消1回、running中の解放0回、failed後に解放1回。範囲: 模擬API。
    def test_shutdown_cancels_only_the_recorded_prompt_and_waits_for_termination(self):
        events = []
        class Client:
            states = iter(['running', 'failed'])
            def prompt_state(self, prompt): events.append(prompt); return {'state': next(self.states)}
            def cancel(self, prompt): events.append(('cancel', prompt)); return {'cancelled': True}
            def release_models(self): events.append('release'); return True
        record = {'endpoint': 'http://localhost:8188', 'correlation_id': 'own', 'prompt_id': 'owned'}
        await_api_release([record], client_factory=lambda endpoint: Client(), should_shutdown=lambda: True,
                          sleep=lambda _: events.append('wait'))
        self.assertEqual(events, ['owned', ('cancel', 'owned'), 'wait', 'owned', 'release'])

    # 見込み: サーバー自体の停止と応答不能を分ければ、shutdown中の終了済み記録を残さない。
    # 合格: 終了済みAPIの接続拒否は後片付け完了、一般の通信障害は期限エラー。範囲: 解放状態は模擬。
    def test_shutdown_releases_terminal_record_when_server_itself_is_missing(self):
        class Client:
            last_release_status = 'server_missing'
            def release_models(self): return False
        record = {'endpoint': 'http://localhost:8188', 'correlation_id': 'own', 'terminal': True}
        await_api_release([record], client_factory=lambda endpoint: Client(), should_shutdown=lambda: True,
                          sleep=lambda _: self.fail('must already be finished'))
        client = Client();client.last_release_status = 'observation_unavailable'
        clock = iter([0, 4])
        with self.assertRaisesRegex(ValueError, '後片付け'):
            await_api_release([record], client_factory=lambda endpoint: client, should_shutdown=lambda: True,
                              now=lambda: next(clock), timeout=3)

    # 見込み: 同IDの取消受付に加え正常な不在を要求すれば、実行中の解放を防げる。
    # 合格: runningでは待機し、missing=true後に終端化・モデル解放1回。範囲: 実受付記録と待機関数、APIは模擬。
    def test_cancelled_pending_prompt_uses_matching_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            receipt = Path(directory) / 'receipt.json'
            receipt.write_text(json.dumps({'prompt_id': 'owned', 'cancelled': True}))
            events = []
            class Client:
                states = iter([{'state': 'running'}, {'state': 'unknown', 'missing': True}])
                def prompt_state(self, prompt): return next(self.states)
                def release_models(self): events.append('release'); return True
            waits = []
            record = {'endpoint': 'http://localhost:8188', 'correlation_id': 'own',
                      'prompt_id': 'owned', 'cancel_record': str(receipt)}
            def wait(seconds):
                self.assertFalse(record.get('terminal', False))
                self.assertNotIn('release', events)
                events.append('wait'); waits.append(seconds)
            await_api_release([record], client_factory=lambda endpoint: Client(), sleep=wait)
            self.assertEqual(waits, [2])
            self.assertEqual(events, ['wait', 'release'])
            self.assertTrue(record['terminal'])

    # 見込み: 取消受付と終了を分ければ、通信障害・不正履歴でも復帰を急がない。
    # 合格: 障害・不正履歴・実行中は非終端かつ解放0回、明示終了後のみ解放1回。範囲: 実受付記録と待機関数、APIは模擬。
    def test_cancel_receipt_does_not_turn_observation_failure_into_completion(self):
        with tempfile.TemporaryDirectory() as directory:
            receipt = Path(directory) / 'receipt.json'
            receipt.write_text(json.dumps({'prompt_id': 'owned', 'cancelled': True}))
            events = []
            class Client:
                states = iter([{'state': 'unknown', 'error': 'offline'},
                               {'state': 'unknown', 'history': {}},
                               {'state': 'running'}, {'state': 'failed'}])
                def prompt_state(self, prompt): return next(self.states)
                def release_models(self): events.append('release'); return True
            record = {'endpoint': 'http://localhost:8188', 'correlation_id': 'own',
                      'prompt_id': 'owned', 'cancel_record': str(receipt)}
            def wait(seconds):
                self.assertFalse(record.get('terminal', False))
                self.assertNotIn('release', events)
                events.append('wait')
            await_api_release([record], client_factory=lambda endpoint: Client(), sleep=wait)
            self.assertEqual(events, ['wait', 'wait', 'wait', 'release'])
            self.assertTrue(record['terminal'])

    # 見込み: 推論を送らなかったsessionはComfyUI確認を不要とする。
    # 合格: API client構築0回で戻る。範囲: guardian入口。
    def test_no_api_submission_has_no_external_wait(self):
        await_api_release([], client_factory=lambda endpoint: self.fail('no API'))


if __name__ == '__main__': unittest.main()
