"""見込み: 5候補を保存し、人物用は全候補を透過して複数採用できる。
合格: 参照共有・異なる5seed・保存済み透過PNGの同一性・追加確定後だけ未採用削除。
範囲: 実PNG/保存/色抜き、ComfyUI APIは固定応答。推論品質・速度は対象外。
"""
import base64
import io
import os
from unittest.mock import patch
import unittest
import test_qwen_generation_bridge as fixture
from test_qwen_generation_bridge import encoded, Image, hold_generation_lease
from qwen_background import remove_chroma_background, remove_white_background
from qwen_generation import QwenGenerationService
from comfy_generation import collect_candidate, ComfySaveError


@unittest.skipIf(Image is None, 'Pillow required')
class CandidateTests(unittest.TestCase):
    setUp = fixture.QwenJobsTest.setUp
    bind_workflow = fixture.QwenJobsTest.bind_workflow
    prepare = fixture.QwenJobsTest.prepare
    submit = fixture.QwenJobsTest.submit

    # 見込み: 出力位置の記録後に画像保存が失敗しても、再取得は同じ記録を再利用できる。
    # 合格: 2回目にraw/透過PNGが揃い、prompt送信は1回だけ。範囲: 実保存・模擬ComfyUI完了結果。
    def test_candidate_save_retry_reuses_its_output_identity(self):
        self.request.update(candidate_cutout=True);self.prepare()
        job_id=self.request['job_id'];value=self.service.load(job_id)
        prompt_id=self.api.submit({'p':{'inputs':{'width':value['output_size'][0],'height':value['output_size'][1]}}}, 'fixture-output')
        write=self.service.store.write_once
        def fail_raw(job,name,raw):
            if name=='candidate-1.png':raise OSError('disk full')
            return write(job,name,raw)
        with patch.object(self.service.store,'write_once',side_effect=fail_raw):
            with self.assertRaises(ComfySaveError):
                collect_candidate(self.service,job_id,1,self.api,submission={'prompt_id':prompt_id},value=value)
        self.assertEqual(collect_candidate(self.service,job_id,1,self.api,submission={'prompt_id':prompt_id},value=value),'succeeded')
        self.assertEqual(len(self.api.calls),1)
        self.assertTrue((self.service.store.root/job_id/'candidate-1-cutout.png').exists())

    # 見込み: 取得時に透過を保存すれば再表示・複数採用で再処理せず、追加確定まで候補を守れる。
    # 合格: 5枚のalpha・2/4選択前後の同一PNG、追加確定後だけ1/3/5の実体削除。範囲: 色抜き/保存は実処理、ComfyUI削除は模擬。
    def test_five_cutout_previews_multi_adoption_and_retry(self):
        self.request.update(candidate_cutout=True)
        self.submit()
        job_id = self.request['job_id']
        source = Image.new('RGB', tuple(self.service.load(job_id)['output_size']), '#00FF00')
        source.paste((20, 40, 80), (16, 16, 48, 48))
        raw = io.BytesIO(); source.save(raw, format='PNG')
        with patch('qwen_background.remove_chroma_background', wraps=remove_chroma_background) as cutout:
            with hold_generation_lease(self.token, self.leases) as fd:
                with patch.object(self.api, 'get_image', return_value=raw.getvalue()):
                    self.service.run(job_id, os.dup(fd), self.token)
            result = self.service.reconcile({'job_id': job_id})
            self.assertEqual(cutout.call_count, 5)
            self.assertEqual(len(result['candidates']), 5)
            for item in result['candidates']:
                with Image.open(io.BytesIO(base64.b64decode(item['image'].split(',')[1]))) as image:
                    self.assertEqual(image.getpixel((0, 0))[3], 0)
                    self.assertEqual(image.getpixel((32, 32)), (20, 40, 80, 255))
            selected = self.service.select({'job_id': job_id, 'candidate_indices': [4, 2]})
            self.assertEqual(selected['selected_candidates'], [2, 4])
            self.assertEqual(selected['candidates'], result['candidates'])
            self.assertFalse(self.api.deleted_outputs)
            for i in range(1, 6):
                self.assertTrue((self.service.store.root / job_id / f'candidate-{i}.png').exists())
            with patch.object(self.api, 'delete_outputs', side_effect=OSError('cleanup offline')):
                with self.assertRaises(OSError):
                    self.service.select({'job_id': job_id, 'candidate_indices': [2, 4], 'adopted': True})
            self.assertTrue(self.service.reconcile({'job_id': job_id})['adopted'])
            finished = self.service.select({'job_id': job_id, 'candidate_indices': [2, 4], 'adopted': True})
            self.assertTrue(finished['candidates_discarded'])
            self.assertEqual([item['index'] for item in finished['candidates']], [2, 4])
            self.assertEqual(len(self.api.deleted_outputs), 3)
            self.assertEqual({item['prompt_id'] for item in self.api.deleted_outputs},
                {self.service.store.json(job_id, f'api-accepted-{i}.json')['prompt_id'] for i in (1, 3, 5)})
            for i in range(1, 6):
                for suffix in ('', '-cutout'):
                    self.assertEqual((self.service.store.root / job_id / f'candidate-{i}{suffix}.png').exists(), i in (2, 4))
            self.service.select({'job_id': job_id, 'candidate_indices': [2, 4], 'adopted': True})
            self.assertEqual(len(self.api.deleted_outputs), 3)
            self.assertEqual(cutout.call_count, 5)

    # 見込み: 5枚は同一参照を共有し、選択前に透過しない。
    # 合格: 同順の参照アップロード各1回、API実行5回、seed重複なし、選択3だけ透過1回、再取得で保持。
    # 範囲: API出力は固定PNG、保存/色抜きは実処理。実生成の画質/速度は含まない。
    def test_candidates_wait_for_one_explicit_selection(self):
        self.request.update(mode='sketch', sketch_image=encoded(), candidate_count=5)
        self.submit()
        job_id = self.request['job_id']
        source = Image.new('RGB', tuple(self.service.load(job_id)['output_size']), '#00FF00')
        source.paste((20, 40, 80), (16, 16, 48, 48))
        raw = io.BytesIO(); source.save(raw, format='PNG')
        with patch('qwen_background.remove_chroma_background', wraps=remove_chroma_background) as cutout:
            with hold_generation_lease(self.token, self.leases) as fd:
                with patch.object(self.api, 'get_image', return_value=raw.getvalue()):
                    self.service.run(job_id, os.dup(fd), self.token)
            result = self.service.reconcile({'job_id': job_id})
            self.assertEqual(result['status'], 'succeeded')
            self.assertEqual(len(self.api.uploads), 2)
            self.assertEqual([content for _, content in self.api.uploads], [
                base64.b64decode(self.request['sketch_image'].split(',')[1]),
                base64.b64decode(self.request['references'][0]['image'].split(',')[1]),
            ])
            self.assertEqual(len(self.api.calls), 5)
            self.assertEqual([graph['p']['inputs']['seed'] for graph in self.api.calls], result['candidate_seeds'])
            for graph in self.api.calls:
                self.assertEqual([graph[f'image-{i}']['inputs']['image'] for i in range(2)],
                                 ['input/' + name for name, _ in self.api.uploads])
            self.assertEqual(len(result['candidates']), 5)
            self.assertEqual(len({item['seed'] for item in result['candidates']}), 5)
            self.assertTrue(all(base64.b64decode(item['image'].split(',')[1]) == raw.getvalue() for item in result['candidates']))
            self.assertNotIn('image', result)
            cutout.assert_not_called()
            selected = self.service.select({'job_id': job_id, 'candidate_index': 3})
            self.assertEqual(selected['selected_candidate'], 3)
            cutout.assert_called_once()
            self.assertEqual(self.service.reconcile({'job_id': job_id})['image'], selected['image'])
            self.service.select({'job_id': job_id, 'candidate_index': 3})
            cutout.assert_called_once()
            restarted = QwenGenerationService(self.service.store.root, workflows=self.workflows, client_factory=lambda endpoint: self.api)
            self.assertEqual(restarted.reconcile({'job_id': job_id})['image'], selected['image'])
            self.assertEqual(restarted.reconcile({'job_id': job_id})['selected_candidate'], 3)
            with self.assertRaises(ValueError):
                self.service.select({'job_id': job_id, 'candidate_index': 2})
            with Image.open(io.BytesIO(base64.b64decode(selected['image'].split(',')[1]))) as output:
                self.assertEqual(output.getpixel((0, 0))[3], 0)
                self.assertEqual(output.getpixel((32, 32)), (20, 40, 80, 255))

    # 見込み: 端とつながらない白は服/肌として保持する。
    # 合格: 外白のみ透明、内白/黒線/色を保持、灰色境界は半透明。範囲: 合成PNG。
    def test_cutout_preserves_enclosed_white_and_softens_outer_edge(self):
        source = Image.new('RGB', (64, 64), 'white')
        source.paste((0, 0, 0), (16, 16, 48, 48))
        source.paste((255, 255, 255), (18, 18, 46, 46))
        source.putpixel((15, 32), (128, 128, 128))
        raw = io.BytesIO(); source.save(raw, format='PNG')
        with Image.open(io.BytesIO(remove_white_background(raw.getvalue()))) as output:
            self.assertEqual(output.getpixel((0, 0))[3], 0)
            self.assertEqual(output.getpixel((32, 32)), (255, 255, 255, 255))
            self.assertEqual(output.getpixel((16, 32)), (0, 0, 0, 255))
            self.assertEqual(output.getpixel((15, 32)), (0, 0, 0, 127))


if __name__ == '__main__':
    unittest.main()
