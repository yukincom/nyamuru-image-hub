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

    # 見込み: 履歴消去は失敗証拠ではないため復帰しない。
    # 合格: 3回照合してもrelease0回、結果不明を通知。範囲: 模擬履歴、試験内例外で待機を終了。
    def test_missing_history_never_becomes_terminal(self):
        messages = []
        class Halt(Exception): pass
        class Client:
            def find_prompt(self, correlation): return None
            def release_models(self): self.fail('must not release')
        loops = []
        def sleep(seconds):
            loops.append(seconds)
            if len(loops) == 3: raise Halt()
        with self.assertRaises(Halt):
            await_api_release([{'endpoint': 'http://localhost:8188', 'correlation_id': 'own'}],
                client_factory=lambda endpoint: Client(), sleep=sleep, on_wait=messages.append)
        self.assertEqual(len(messages), 3)
        self.assertTrue(all('未確定' in message for message in messages))

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
