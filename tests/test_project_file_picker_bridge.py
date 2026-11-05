"""開始場所を毎回指定し、選択したファイルのbyteと取消しを保つ。macOSの選択画面は模擬する。"""
import base64
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import project_file_picker
import nyamuru_macos_picker
from workspace_routes import handle_workspace_post
from nyamuru_series_catalog_store import SeriesCatalogStore
from types import SimpleNamespace


class ProjectFilePickerTest(unittest.TestCase):
    # 見込み・合格: 下位の資料を選んでも次回の開始場所は指定フォルダー。GLBなどbinaryを変えず返す。
    def test_explicit_root_reused_and_selected_file_bytes_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sub = root / '資料'
            sub.mkdir()
            file = sub / '背景\nモデル.glb'
            file.write_bytes(b'\x00\xffglTF\n')
            for accept in ('.glb,.fbx', '.yaml,.yml', 'image/png,image/jpeg'):
                with patch.object(nyamuru_macos_picker, 'run_macos_picker', return_value=json.dumps([str(file)])) as picker:
                    result = project_file_picker.choose_project_files(root, accept, False)
                args = picker.call_args.args
                self.assertEqual(args[2], str(root.resolve()))
                self.assertIn('defaultLocation: Path(argv[1])', args[0])
                self.assertTrue(json.loads(args[3]))
                self.assertEqual(base64.b64decode(result['files'][0]['data']), file.read_bytes())

    # 合格: 通常版の実ルートも開始場所・形式を受け、選択した設定ファイルをそのまま返す。
    def test_bridge_route_reads_selected_project_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / '設定.yaml'
            source.write_bytes(b'key: value\n')
            responses = []
            handler = SimpleNamespace(send_json=lambda code, value: responses.append((code, value)))
            with patch.object(nyamuru_macos_picker, 'run_macos_picker', return_value=json.dumps([str(source)])):
                handle_workspace_post(handler, '/api/episode-workspace/choose-files', {
                    'default_directory': directory, 'accept': '.yaml,.yml', 'multiple': False,
                })
            self.assertEqual(responses[0][0], 200)
            self.assertEqual(base64.b64decode(responses[0][1]['files'][0]['data']), source.read_bytes())

    # 合格: 登録済みシリーズは前回の下位フォルダーより優先。未登録のシリーズ名だけなら作品フォルダー。
    def test_registered_series_overrides_episode_default(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            series = root / 'series'
            episode = series / 'episode'
            episode.mkdir(parents=True)
            catalogs = SeriesCatalogStore(root / 'catalogs')
            catalogs.write_metadata('registered', {'series_id': 'registered', 'series_directory': str(series)})
            handler = SimpleNamespace(state=SimpleNamespace(series_catalogs=catalogs), send_json=lambda *args: None)
            for series_id, expected in [('registered', series), ('unregistered', episode), ('', episode)]:
                with patch.object(nyamuru_macos_picker, 'run_macos_picker', return_value=None) as picker:
                    handle_workspace_post(handler, '/api/episode-workspace/choose-files', {
                        'series_id': series_id, 'default_directory': str(episode), 'accept': 'image/png',
                    })
                self.assertEqual(picker.call_args.args[2], str(expected.resolve()))

    # 合格: キャンセルは空一覧を返す。複数選択はそのままmacOSへ渡す。
    def test_cancel_and_multiple_selection(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(nyamuru_macos_picker, 'run_macos_picker', return_value=None) as picker:
                result = project_file_picker.choose_project_files(directory, 'image/png', True)
            self.assertTrue(result['cancelled'])
            self.assertEqual(result['files'], [])
            self.assertEqual(picker.call_args.args[4], 'true')


if __name__ == '__main__':
    unittest.main()
