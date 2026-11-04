"""CLIP export: fixed local process, real file roundtrip, and HTTP error behavior."""
import base64
import io
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import nyamuru_clip_export as clip
from nyamuru_bridge_http import BridgeHandler


def page():
    return {'profile':'nyamuru-clip-v1','width':400,'height':300,'dpi':150,'title':'確認','page':1,
        'layers':[{'kind':'text','id':'text','name':'編集文字','visible':True,'locked':False,'opacity':1,
            'blend':'normal','text':'編集できる日本語','frame':[20,30,390,150],
            'fontSizePt':24,'vertical':False,'color':[17,17,17],
            'font':{'name':'Hiragino Sans','postscript':'HiraginoSans-W3'}}]}


class ClipExportTests(unittest.TestCase):
    def test_local_fixed_command_and_validated_response(self):
        """見込み: HTTPデータは実行対象や保存先に使わない。合格: 固定実行先とstdin/応答bytes一致。範囲: 模擬process。"""
        body=page();body['binary']='/untrusted';body['output']='/untrusted'
        output=b'CSFCHUNKfixture'
        with patch.object(Path,'is_file',return_value=True), patch.object(clip.subprocess,'run',return_value=subprocess.CompletedProcess([],0,output,b'')) as run:
            result=clip.export_clip(body)
        self.assertEqual(run.call_args.args[0],[str(clip.BINARY)])
        self.assertEqual(run.call_args.kwargs['cwd'],clip.ROOT)
        self.assertEqual(json.loads(run.call_args.kwargs['input']),body)
        self.assertEqual(base64.b64decode(result['clip_data']),output)
        self.assertEqual(result['byte_length'],len(output))

    def test_failure_timeout_and_busy_release(self):
        """見込み: 失敗を成功扱いせず次回を妨げない。合格: 各Err後lock再取得可。範囲: 模擬process。"""
        with patch.object(Path,'is_file',return_value=True):
            for response in [subprocess.CompletedProcess([],1,b'',b'bad'),subprocess.CompletedProcess([],0,b'invalid',b'')]:
                with patch.object(clip.subprocess,'run',return_value=response), self.assertRaises(ValueError): clip.export_clip(page())
                self.assertTrue(clip._ENCODE_LOCK.acquire(False));clip._ENCODE_LOCK.release()
            with patch.object(clip.subprocess,'run',side_effect=subprocess.TimeoutExpired('encoder',240)), self.assertRaisesRegex(ValueError,'時間内'):
                clip.export_clip(page())
            self.assertTrue(clip._ENCODE_LOCK.acquire(False))
            try:
                with self.assertRaisesRegex(ValueError,'処理中'): clip.export_clip(page())
            finally: clip._ENCODE_LOCK.release()

    def test_missing_setup_size_and_http_failure(self):
        """見込み: 未準備/過大入力は明示エラー。合格: 実行無し、HTTP400。範囲: handler直呼び。"""
        with patch.object(Path,'is_file',return_value=False), self.assertRaisesRegex(ValueError,'setup:clip'):
            clip.export_clip(page())
        with patch.object(Path,'is_file',return_value=True), patch.object(clip,'MAX_BYTES',10), self.assertRaisesRegex(ValueError,'大きすぎ'):
            clip.export_clip(page())
        handler=object.__new__(BridgeHandler);handler.path='/api/export/clip'
        handler.headers={'Origin':'http://localhost:4321','Content-Type':'application/json','Content-Length':str(len(b'{}'))}
        handler.rfile=io.BytesIO(b'{}');received=[];handler.send_json=lambda status,body: received.append((status,body))
        handler.do_POST()
        self.assertEqual(received[0][0],400)
        self.assertIn('形式',received[0][1]['error'])

    @unittest.skipUnless(clip.BINARY.is_file(),'npm run setup:clip is required for real encoder verification')
    def test_real_helper_roundtrip_through_http(self):
        """見込み: HTTP経路が実CLIPを返す。合格: 実writer→readerで本文/寸法/サイズ一致。範囲: 実process、CSP操作は別確認。"""
        body=json.dumps(page(),ensure_ascii=False).encode()
        handler=object.__new__(BridgeHandler);handler.path='/api/export/clip'
        handler.headers={'Origin':'http://localhost:4321','Content-Type':'application/json','Content-Length':str(len(body))}
        handler.rfile=io.BytesIO(body);received=[];handler.send_json=lambda status,body: received.append((status,body))
        handler.do_POST();self.assertEqual(received[0][0],200)
        data=base64.b64decode(received[0][1]['clip_data'])
        result=subprocess.run([str(clip.BINARY),'--inspect'],input=data,capture_output=True,check=True)
        value=json.loads(result.stdout)
        self.assertEqual((value['width'],value['height'],value['dpi']),(400,300,150))
        text=next(layer for layer in value['layers'] if layer['name']=='編集文字')['texts'][0]
        self.assertEqual(text['text'],'編集できる日本語');self.assertEqual(text['fontSizePt'],24)


if __name__=='__main__': unittest.main()
