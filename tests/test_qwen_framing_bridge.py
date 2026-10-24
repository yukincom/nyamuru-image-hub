import copy
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from generation_store import canonical, sha256
from nyamuru_panel_actions import PanelActionSuggester
from qwen_generation import FIXED_ARTWORK, MANGA_FORMATS, TRANSPARENT_SUBJECT, split_fixed_generation_prompt, split_framing_prompt


class QwenFramingTest(unittest.TestCase):
    def test_existing_editor_labels_keep_their_explicit_body_range(self):
        for label, expected in (
            ('ロングショット', 'long shot.'),
            ('全身', 'full-body shot.'),
            ('膝から上', 'knee-up shot.'),
            ('腰から上', 'waist-up shot.'),
            ('胸から上', 'chest-up shot.'),
            ('肩から上', 'shoulders-up shot.'),
            ('顔', 'close-up of the face.'),
            ('大アップ', 'extreme close-up of the face.'),
            ('手', 'close-up of the specified hand area.'),
            ('足', 'close-up of the specified foot area.'),
            ('身体の一部', 'detail shot of the specified body part.'),
        ):
            with self.subTest(label=label):
                remaining, fixed = split_framing_prompt(f'描写範囲は{label}。指定した範囲を画面に収めた構図で描く。')
                self.assertEqual(remaining, '')
                self.assertIn(expected, fixed)

    def test_manual_close_up_replaces_the_editor_chest_boilerplate(self):
        remaining, fixed = split_framing_prompt(
            '漫画を描く。\n\n描写範囲はクローズアップ。頭頂から胸までを画面に収めた構図で描く。'
            '\n\n動作・表情・視線：顔は右向き。体は右向き、やや背中がみえる。')
        self.assertEqual(remaining, '漫画を描く。\n\n\n\n動作・表情・視線：顔は右向き。体は右向き、やや背中がみえる。')
        self.assertEqual(fixed, 'close-up.')

    def test_colon_spaces_and_line_end_are_supported(self):
        for prompt in ('描写範囲：顔アップ', ' 描写範囲 : バストアップ 。', '描写範囲は腰から上\r\n動作：振り向く。'):
            with self.subTest(prompt=prompt):
                remaining, fixed = split_framing_prompt(prompt)
                self.assertTrue(fixed)
                self.assertNotIn('描写範囲', remaining)

    def test_unknown_free_prose_and_quoted_material_are_untouched(self):
        for prompt in ('描写範囲は肘だけ。', '人物設定：「描写範囲は全身。」と書かれた看板を持つ。',
                       '顔を大きく見せる。', '描写範囲はクローズアップ。ただし顔は右向き。'):
            with self.subTest(prompt=prompt):
                remaining, fixed = split_framing_prompt(prompt)
                if prompt.endswith('ただし顔は右向き。'):
                    self.assertEqual(remaining, 'ただし顔は右向き。')
                    self.assertTrue(fixed)
                else:
                    self.assertEqual((remaining, fixed), (prompt, ''))

    def test_conflicting_sizes_fail_and_equivalent_aliases_agree(self):
        with self.assertRaisesRegex(ValueError, '描写範囲が複数'):
            split_framing_prompt('描写範囲は全身。\n描写範囲はクローズアップ。')
        remaining, fixed = split_framing_prompt('描写範囲はクロース・アップ。\n描写範囲はクローズアップ。')
        self.assertEqual(remaining, '')
        self.assertEqual(fixed.count('close-up'), 1)

    def translator(self, result):
        client = PanelActionSuggester('http://127.0.0.1:8080/v1/chat/completions')
        client.request_json_completion = Mock(return_value=(result, {}))
        return client

    def test_framing_bypasses_llm_and_original_hash_and_reference_order_survive(self):
        value = {'prompt': '描写範囲はクローズアップ。\n動作：顔は右向き。',
                 'references': [{'file': 'image-1.png', 'label': 'ラフ'}, {'file': 'image-2.png', 'label': '人物資料'}]}
        original = copy.deepcopy(value)
        client = self.translator({'prompt': 'The face points right.', 'references': [
            {'file': 'image-1.png', 'label': 'Rough sketch'}, {'file': 'image-2.png', 'label': 'Character reference'}]})
        english = client.translate_image_generation_prompt(value)
        source = client.request_json_completion.call_args.args[1]
        self.assertEqual(source['prompt'], '動作：顔は右向き。')
        self.assertEqual(source['references'], value['references'])
        self.assertEqual(english['prompt'], 'close-up. The face points right.')
        self.assertEqual(english['request_sha256'], sha256(canonical(original)))
        self.assertEqual(value, original)
        self.assertEqual([r['file'] for r in english['references']], ['image-1.png', 'image-2.png'])

    def test_framing_alone_needs_no_llm(self):
        client = self.translator(None)
        result = client.translate_image_generation_prompt({'prompt': '描写範囲は胸から上。', 'references': []})
        client.request_json_completion.assert_not_called()
        self.assertEqual(result['prompt'], 'chest-up shot.')

    def test_framing_with_only_reference_labels_still_translates_labels(self):
        client = self.translator({'prompt': '', 'references': [{'file': 'image-1.png', 'label': 'Sketch'}]})
        result = client.translate_image_generation_prompt({'prompt': '描写範囲は顔。', 'references': [{'file': 'image-1.png', 'label': 'ラフ'}]})
        self.assertEqual(client.request_json_completion.call_args.args[1]['prompt'], '')
        self.assertEqual(result['references'][0]['label'], 'Sketch')

    def test_fixed_prefix_cannot_hide_invalid_translation_or_changed_references(self):
        value = {'prompt': '描写範囲は顔。\n顔は右向き。', 'references': [{'file': 'image-1.png', 'label': '資料'}]}
        for prompt in ('', None, '顔は右向き。'):
            with self.subTest(prompt=prompt), self.assertRaises(ValueError):
                self.translator({'prompt': prompt, 'references': [{'file': 'image-1.png', 'label': 'Reference'}]}).translate_image_generation_prompt(value)
        with self.assertRaisesRegex(ValueError, '参照資料'):
            self.translator({'prompt': 'Facing right.', 'references': [{'file': 'image-2.png', 'label': 'Reference'}]}).translate_image_generation_prompt(value)

    def test_translation_cannot_invent_content_for_empty_remainder(self):
        client = self.translator({'prompt': 'A standing person.', 'references': [{'file': 'image-1.png', 'label': 'Sketch'}]})
        with self.assertRaisesRegex(ValueError, '空の生成指示'):
            client.translate_image_generation_prompt({'prompt': '描写範囲は顔。', 'references': [{'file': 'image-1.png', 'label': 'ラフ'}]})

    def test_prompt_without_framing_uses_the_existing_translation(self):
        value = {'prompt': '背景のみ。', 'references': []}
        client = self.translator({'prompt': 'Background only.', 'references': []})
        result = client.translate_image_generation_prompt(value)
        self.assertEqual(client.request_json_completion.call_args.args[1]['prompt'], value['prompt'])
        self.assertEqual(result['prompt'], 'Background only.')

    def test_color_modes_use_the_same_dictionary_as_artwork_exports(self):
        for item in MANGA_FORMATS:
            with self.subTest(format=item['ja']):
                client = self.translator(None)
                result = client.translate_image_generation_prompt({'prompt': f"出力形式：{item['ja']}。", 'references': []})
                client.request_json_completion.assert_not_called()
                self.assertEqual(result['prompt'], f"output format: {item['en']}.")

    def test_fixed_format_and_transparency_never_reach_llm(self):
        value = {'prompt': f'出力形式：モノクロ漫画。\n描写範囲は顔。\n{TRANSPARENT_SUBJECT}\n動作：笑う。', 'references': []}
        original = copy.deepcopy(value)
        client = self.translator({'prompt': 'Smiling.', 'references': []})
        result = client.translate_image_generation_prompt(value)
        self.assertEqual(client.request_json_completion.call_args.args[1]['prompt'], '動作：笑う。')
        self.assertEqual(result['prompt'], 'close-up of the face. output format: black-and-white manga. '
                         + FIXED_ARTWORK[TRANSPARENT_SUBJECT] + ' Smiling.')
        self.assertEqual(value, original)
        self.assertEqual(result['request_sha256'], sha256(canonical(original)))

    def test_existing_inline_transparency_keeps_the_subject_name(self):
        remaining, fixed = split_fixed_generation_prompt(f'人物：ユキ。{TRANSPARENT_SUBJECT}\n動作：走る。')
        self.assertEqual(remaining, '人物：ユキ。\n動作：走る。')
        self.assertEqual(fixed, FIXED_ARTWORK[TRANSPARENT_SUBJECT])

    def test_shared_builtin_style_is_fixed_but_custom_prose_is_untouched(self):
        tone = next(ja for ja in FIXED_ARTWORK if ja.startswith('[style] 作品の出力形式'))
        remaining, fixed = split_fixed_generation_prompt(f'{tone}\n画風：色鉛筆のラフ。')
        self.assertEqual(remaining, '画風：色鉛筆のラフ。')
        self.assertEqual(fixed, FIXED_ARTWORK[tone])
        self.assertEqual(fixed, fixed.lower())
        for prompt in ('出力形式：特製二色刷り。', '背景：街並み。',
                       'セリフ：「出力形式：モノクロ漫画。」', f'資料：「{TRANSPARENT_SUBJECT}」', tone + ' 追加の指示'):
            self.assertEqual(split_fixed_generation_prompt(prompt), (prompt, ''))

    def test_explicit_background_options_and_format_conflicts(self):
        for prompt, expected in (('背景透過。', 'transparent background.'), ('背景：透過。', 'transparent background.'),
                                 ('背景は白背景。', 'white background.'), ('背景：不透明', 'opaque background.')):
            self.assertEqual(split_fixed_generation_prompt(prompt), ('', expected))
        for prompt, field in (('出力形式：カラー漫画。\n出力形式：モノクロ漫画。', '出力形式'),
                              ('背景：白。\n背景透過。', '背景'), (f'背景：白。\n{TRANSPARENT_SUBJECT}', '背景')):
            with self.assertRaisesRegex(ValueError, field + 'が複数'):
                split_fixed_generation_prompt(prompt)
        self.assertEqual(split_fixed_generation_prompt('出力形式：カラー。\n出力形式：カラー漫画。'),
                         ('', 'output format: color manga.'))


if __name__ == '__main__':
    unittest.main()
