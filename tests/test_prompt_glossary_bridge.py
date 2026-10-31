"""見込み: 一致する自然文だけを訳語の参考にすれば、本文を置換せず語彙を共有できる。
合格: 辞書の出典・検索範囲・上限を確認し、模擬翻訳では本文/台詞/参照順/入力hashを保持する。
確認範囲: ローカルCSVとPython処理。翻訳応答は固定し、実LLMの意味理解と生成画像は別確認。
"""

import copy
import csv
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from generation_store import canonical, sha256
import nyamuru_prompt_glossary as glossary
from nyamuru_panel_actions import PanelActionSuggester


JA = '被写体の横に空間を確保'
EN = 'an open area reserved beside the subject'


class PromptGlossaryDataTest(unittest.TestCase):
    # 見込み: 上流CSVを無改変で置けば、検索結果と出典を再現できる。
    # 合格: blob/hash/サイズと1701行が一致し、日本語入り英文1行を除く1700件を読める。実LLMなし。
    def test_pinned_csv_is_intact_and_readable(self):
        raw = glossary.GLOSSARY_PATH.read_bytes()
        meta = json.loads(glossary.GLOSSARY_PATH.with_name('provenance.json').read_text())
        self.assertEqual(len(raw), meta['bytes'])
        self.assertEqual(hashlib.sha256(raw).hexdigest(), meta['sha256'])
        self.assertEqual(hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest(), meta['git_blob_sha1'])
        with glossary.GLOSSARY_PATH.open(encoding='utf-8-sig', newline='') as stream:
            self.assertEqual(len(list(csv.DictReader(stream))), 1701)
        self.assertEqual(len(glossary.read_glossary(glossary.GLOSSARY_PATH)), 1700)
        self.assertEqual(meta['entries'], 1701)
        self.assertEqual(glossary.glossary_hints([JA]), [{'ja': JA, 'en': EN}])
        self.assertEqual(glossary.glossary_hints(['吹き出しに日本語の「こんにちは」をそのまま入れる']), [])

    # 見込み: 完全な日本語句だけを探せば、無関係な候補や別欄を接合した語句を足さない。
    # 合格: 一致句は1件、重複は増えず、部分語/英語/別欄は0件。検索処理だけを検査。
    def test_exact_phrases_are_deduplicated_without_crossing_fields(self):
        values = [JA + 'しない。', JA, '未知の衣装']
        original = copy.deepcopy(values)
        self.assertEqual(glossary.glossary_hints(values), [{'ja': JA, 'en': EN}])
        self.assertEqual(values, original)
        self.assertEqual(glossary.glossary_hints(['被写体の横に', '空間を確保', EN, '横に空間']), [])

    def read_fixture(self, rows):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'terms.csv'
            with path.open('w', encoding='utf-8-sig', newline='') as stream:
                writer = csv.writer(stream)
                writer.writerow(['tag', 'ja', 'aliases'])
                writer.writerows(rows)
            return glossary.read_glossary(path)

    # 見込み: 長い一致句を優先し、複数訳のある別名を除外すれば誤った短語への固定を避ける。
    # 合格: 長い句と幅正規化した別名だけを返し、曖昧な「笑顔」を返さない。合成辞書の検索検査。
    def test_long_matches_aliases_and_ambiguous_meanings(self):
        entries = self.read_fixture([
            ['space beside', '横に空間', ''], [EN, JA, ''],
            ['smile', '微笑む', '笑顔'], ['grin', '歯を見せ笑う', '笑顔'],
            ['eyes toward A', 'Ａ方向に目線', 'Ａ側に視線'],
        ])
        with patch.object(glossary, 'bundled_glossary', return_value=entries):
            self.assertEqual(glossary.glossary_hints([JA + '。笑顔。A側に視線。']),
                             [{'ja': JA, 'en': EN}, {'ja': 'Ａ側に視線', 'en': 'eyes toward A'}])

    # 見込み: 件数と文字数に上限を設ければ、長い入力でも参照辞書が翻訳本文を圧迫しない。
    # 合格: 上限24件以内、合成小予算で境界内の候補だけを返す。文脈の品質は未評価。
    def test_hint_count_and_character_budgets(self):
        entries = tuple((f'語句{i:02}', f'語句{i:02}', f'phrase {i}') for i in range(30))
        source = '。'.join(row[0] for row in entries)
        with patch.object(glossary, 'bundled_glossary', return_value=entries):
            self.assertEqual(len(glossary.glossary_hints([source])), 24)
            with patch.object(glossary, 'MAX_HINT_CHARACTERS', 12):
                self.assertEqual(glossary.glossary_hints([source]), [{'ja': '語句00', 'en': 'phrase 0'}])

    # 見込み: CSV全体を厳密に読むことで欠損や列崩れを正常な訳語として使わない。
    # 合格: 列不足/列過剰/訳語欠落を拒否。破損fixtureのみ、モデル通信なし。
    def test_invalid_csv_is_rejected(self):
        for content in ('tag,ja\nword,語句\n', 'tag,ja,aliases\nword,語句\n',
                        'tag,ja,aliases\nword,語句,,extra\n', 'tag,ja,aliases\n,語句,\n'):
            with self.subTest(content=content), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / 'bad.csv'
                path.write_text(content)
                with self.assertRaises(ValueError):
                    glossary.read_glossary(path)


# 翻訳への辞書接続は保留。期待する振る舞いは将来の再開用に保持し、現行経路の成功とは数えない。
@unittest.skip('翻訳接続は保留: 最適なプロンプトを模索中20261030')
class PromptGlossaryTranslationTest(unittest.TestCase):
    def translator(self, result):
        client = PanelActionSuggester('http://127.0.0.1:8080/v1/chat/completions')
        client.request_json_completion = Mock(return_value=(result, {}))
        return client

    # 見込み: 本文と辞書を別フィールドにすれば、否定を壊す機械置換をしない。
    # 合格: 固定構図/原文の否定/参照順/hashを保持し、任意の訳語として1件渡す。応答は固定。
    def test_glossary_is_optional_context_without_source_replacement(self):
        value = {'prompt': '描写範囲は顔。\n' + JA + 'しない。', 'references': [
            {'file': 'image-2.png', 'label': JA}, {'file': 'image-1.png', 'label': '人物'}]}
        original = copy.deepcopy(value)
        client = self.translator({'prompt': 'Do not reserve space beside the subject.', 'references': [
            {'file': 'image-2.png', 'label': EN}, {'file': 'image-1.png', 'label': 'Character'}]})
        result = client.translate_image_generation_prompt(value)
        instruction, source = client.request_json_completion.call_args.args
        self.assertEqual(source['prompt'], JA + 'しない。')
        self.assertEqual(source['references'], value['references'])
        self.assertEqual(source['glossary'], [{'ja': JA, 'en': EN}])
        self.assertIn('preserve negation, subjects, directions and relationships', instruction)
        self.assertEqual(result['prompt'], 'close-up of the face. Do not reserve space beside the subject.')
        self.assertEqual(result['request_sha256'], sha256(canonical(original)))
        self.assertEqual(value, original)

    # 見込み: 台詞保護後に検索すれば、画面内の文字を辞書の描写指示として拾わない。
    # 合格: 台詞だけの一致は辞書0件で文字を復元し、同じ語が資料名にあれば参照用に1件渡す。固定応答。
    def test_literal_text_is_excluded_but_reference_labels_can_supply_hints(self):
        value = {'owner_key': 'panel', 'prompt': '台詞：「' + JA + '」', 'literal_text': [JA], 'references': []}
        client = self.translator({'prompt': 'Say "__NYAMURU_LITERAL_0__".', 'references': []})
        self.assertEqual(client.translate_image_generation_prompt(value)['prompt'], 'Say "' + JA + '".')
        self.assertNotIn('glossary', client.request_json_completion.call_args.args[1])
        value['references'] = [{'file': 'image-1.png', 'label': JA}]
        client = self.translator({'prompt': 'Say "__NYAMURU_LITERAL_0__".', 'references': [
            {'file': 'image-1.png', 'label': EN}]})
        result = client.translate_image_generation_prompt(value)
        self.assertEqual(client.request_json_completion.call_args.args[1]['glossary'], [{'ja': JA, 'en': EN}])
        self.assertEqual(result['prompt'], 'Say "' + JA + '".')

    # 見込み: 辞書にない語や固定句だけの場合は、従来の翻訳/LLM省略経路を保てる。
    # 合格: 未一致では新しい欄/指示を足さず、固定構図だけなら通信しない。翻訳応答は固定。
    def test_unmatched_and_fixed_only_prompts_keep_existing_path(self):
        client = self.translator({'prompt': 'A classroom at dusk.', 'references': []})
        client.translate_image_generation_prompt({'prompt': '夕方の教室', 'references': []})
        instruction, source = client.request_json_completion.call_args.args
        self.assertNotIn('glossary', source)
        self.assertNotIn('glossary', instruction)
        client = self.translator(None)
        self.assertEqual(client.translate_image_generation_prompt({'prompt': '描写範囲は顔。', 'references': []})['prompt'],
                         'close-up of the face.')
        client.request_json_completion.assert_not_called()


if __name__ == '__main__':
    unittest.main()
