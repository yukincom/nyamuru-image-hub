"""見込み: API移行後も参照の役割・人物割当・本文を最終指示へ保持できる。
合格: 参照数に応じた画像番号、原画/修正/資料の役割、キー色と本文が一致。
範囲: 実プロンプトコンパイラーのみ。HTTP・ComfyUI node・推論は実行しない。
"""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from qwen_generation_phase import generation_prompt

SETTINGS = {'candidate_count': 5, 'seed': 260921}
CHROMA_SETTINGS = {**SETTINGS, 'transparency_mode': 'chroma-key-v1', 'chroma_key': {'color': '#00FF00'}}


class QwenGenerationPromptTest(unittest.TestCase):
    # 見込み: コマ/ページの編集は人物割当と構図を保つ。合格: 原画指示・人物別番号・本文を含み透過/単体抽出なし。範囲: 文字列構築のみ。
    def test_panel_and_page_paint_keep_composition_and_separate_character_labels(self):
        references = [dict(role='paint', character_keys=[]),
                      dict(role='identity', character_keys=['alice']),
                      dict(role='identity', character_keys=['bob'])]
        english = dict(prompt='Alice stands left of Bob.', references=[dict(label=label) for label in
                       ('Composition', 'Alice character sheet', 'Bob character sheet')])
        for owner in ('panel', 'page'):
            with self.subTest(owner=owner):
                config = dict(owner_key=owner, mode='paint', references=references, settings=SETTINGS,
                              character_keys=['alice', 'bob'])
                prompt = generation_prompt(config, english)
                self.assertTrue(prompt.startswith('Edit <image1>. Preserve its pose and composition'))
                self.assertIn('<image2>: Alice character sheet. Assigned characters: Character 1.', prompt)
                self.assertIn('<image3>: Bob character sheet. Assigned characters: Character 2.', prompt)
                self.assertIn('Alice stands left of Bob.', prompt)
                self.assertNotIn('RGBA image with transparency', prompt)
                self.assertNotIn('background is transparent', prompt)
                self.assertNotIn('Extract the single person', prompt)

    # 見込み: 複数人物の共有資料は単一人物と解釈する指示を出さない。合格: 割当順2,1と複数形を保持。範囲: 文字列構築のみ。
    def test_shared_character_sheet_does_not_turn_distinct_characters_into_one_person(self):
        config = dict(owner_key='panel', mode='new', settings=SETTINGS, character_keys=['alice', 'bob'],
                      references=[dict(role='identity', character_keys=['bob', 'alice'])])
        english = dict(prompt='Draw Alice and Bob.', references=[dict(label='Alice and Bob character designs')])
        prompt = generation_prompt(config, english)
        self.assertIn('Alice and Bob character designs.', prompt)
        self.assertIn('Assigned characters: Character 2, Character 1.', prompt)
        self.assertIn('Character identities and drawing styles.', prompt)
        self.assertNotIn('one person', prompt)
        self.assertNotIn('transparent', prompt)

    # 見込み: 資料なしの背景構図は抽出指示を必要としない。合格: 新規構図指示と原文のみ。範囲: 文字列構築のみ。
    def test_new_groups_without_references_do_not_request_person_extraction(self):
        for owner in ('panel', 'page'):
            with self.subTest(owner=owner):
                config = dict(owner_key=owner, mode='new', references=[], settings=SETTINGS)
                prompt = generation_prompt(config, dict(prompt='An empty room.', references=[]))
                self.assertEqual(prompt, 'Create a new drawing with the requested composition. An empty room.')

    # 見込み: 人物資料の複数方向は同一人物で、キー色は不透明背景へ指定する。合格: 単一人物指示・緑背景・RGBA要求なし。範囲: 文字列構築のみ。
    def test_individual_figure_keeps_single_person_reference_and_chroma_format(self):
        config = dict(owner_key='figure-0', mode='new', settings=CHROMA_SETTINGS,
                      references=[dict(role='identity', character_keys=['alice'])])
        prompt = generation_prompt(config, dict(prompt='Draw Alice.', references=[dict(label='Alice character sheet')]))
        self.assertIn('alternate views are one person, not extra people.', prompt)
        self.assertIn('solid bright green background (#00FF00)', prompt)
        self.assertIn('Render an opaque image', prompt)
        self.assertNotIn('RGBA image', prompt)
        self.assertNotIn('Assigned characters', prompt)

    # 見込み: 作中本文の空白や改行は作画内容として保持する。合格: 両scopeで引用本文が一致。範囲: 文字列構築のみ。
    def test_authored_group_text_keeps_newlines_and_repeated_spaces_in_final_prompt(self):
        for owner in ('page', 'panel'):
            with self.subTest(owner=owner):
                literal = 'ゆき  は\n笑う'
                config = dict(owner_key=owner, mode='new', references=[], settings=SETTINGS, literal_text=[literal])
                prompt = generation_prompt(config, dict(prompt=f'Draw the words "{literal}".', references=[]))
                self.assertIn(f'"{literal}"', prompt)


    # 見込み: 文字生成は原文を保ち透過書式を付ける。合格: 描き文字/写植とも改行・連続空白・RGBA指示あり。範囲: 文字列構築のみ。
    def test_handwritten_final_conditioning_preserves_spaces_newlines_and_rgba_request(self):
        literal = 'ド  ン！\nドン'
        config = dict(owner_key='bubble-1', content_kind='handwritten', mode='new', references=[], settings=SETTINGS, literal_text=[literal])
        prompt = generation_prompt(config, dict(prompt=f'Draw "{literal}".', references=[]))
        self.assertIn(literal, prompt)
        self.assertTrue(prompt.startswith('This is an RGBA image with transparency.'))


class QwenReferencePromptTest(unittest.TestCase):
    def compile(self, roles, labels, *, mode='new', owner='figure-0', prompt='Draw a portrait.'):
        references = [{'role': role, 'character_keys': ['person'] if role == 'identity' else []} for role in roles]
        config = {'mode': mode, 'owner_key': owner, 'references': references, 'settings': CHROMA_SETTINGS if owner.startswith('figure-') else SETTINGS}
        english = {'prompt': prompt, 'references': [{'label': label} for label in labels]}
        return generation_prompt(config, english)

    # 見込み: 1枚の資料へ架空の入力番号を追加しない。
    # 合格: 資料名と本文を保持しimageタグ/空canvasなし。範囲: コンパイラーのみ。
    def test_one_reference_stays_one_without_fabricated_image_tags(self):
        prompt = self.compile(['identity'], ['Red character sheet'])
        self.assertIn('The reference image: Red character sheet', prompt)
        self.assertIn('Draw a portrait.', prompt)
        self.assertNotIn('<image', prompt)
        self.assertNotIn('blank canvas', prompt)

    # 見込み: 入力2枚の番号と資料名の対応は変わらない。
    # 合格: image1=設定画、image2=顔資料、image3なし。範囲: コンパイラーのみ。
    def test_two_references_keep_order_and_numbering(self):
        prompt = self.compile(['identity', 'identity'], ['Red character sheet', 'Blue portrait'])
        self.assertIn('<image1>: Red character sheet', prompt)
        self.assertIn('<image2>: Blue portrait', prompt)
        self.assertNotIn('<image3>', prompt)

    # 見込み: 原画を先頭に渡すとその構図を編集対象にできる。
    # 合格: image1を編集、image2を人物資料として指定。範囲: コンパイラーのみ。
    def test_paint_keeps_explicit_source_as_first_image(self):
        prompt = self.compile(['paint', 'identity'], ['Painted pose', 'Red character sheet'], mode='paint')
        self.assertIn('Edit <image1>. Preserve its pose and composition', prompt)
        self.assertIn('<image2>: Red character sheet', prompt)

    # 見込み: 原画/マスク/資料を分離すれば局所編集の対象を曖昧にしない。
    # 合格: 役割がimage1/2/3に一致、非対象保持と指示跡除去を要求。範囲: コンパイラーのみ。
    def test_source_correction_and_identity_have_distinct_roles(self):
        prompt = self.compile(['paint', 'correction', 'identity'], ['Source', 'Mask', 'Character sheet'],
                              mode='paint', prompt='Change the marked hand to a fist.')
        self.assertIn('<image1>: the source image and canvas', prompt)
        self.assertIn('<image2>: drawn annotations or a separate mask', prompt)
        self.assertIn('<image3>: Character sheet', prompt)
        self.assertIn('all untargeted content', prompt)
        self.assertIn('Remove the edit-guide marks', prompt)
        self.assertIn('Change the marked hand to a fist.', prompt)
        self.assertNotIn('Create a new drawing', prompt)

    # 見込み: 注釈画像だけならそれが編集canvasになり、画像を増やさない。
    # 合格: supplied imageを局所編集し、image番号を捏造しない。範囲: コンパイラーのみ。
    def test_annotated_image_alone_is_canvas(self):
        prompt = self.compile(['correction'], ['Annotated art'])
        self.assertIn('the annotated input image and canvas', prompt)
        self.assertIn('Edit the supplied image only as requested', prompt)
        self.assertNotIn('<image', prompt)

    # 見込み: ラフ用の確認済み指示には役割を二重追加せずキー色だけ加える。
    # 合格: 編集指示1回、構図/表情/衣服保持、白背景やRGBA要求なし。範囲: コンパイラーのみ。
    def test_sketch_keeps_scene_overrides_and_chroma_background(self):
        english = ('Edit <image1> into the character from <image2>, the Character design sheet. '
                   'Preserve intentional cropping. Scene instructions take priority. '
                   'Look at her toes, with a stern expression and cold sweat. '
                   'Keep white clothing and skin opaque.')
        prompt = self.compile(['sketch', 'identity'], ['Single rough pose', 'Character design sheet'], mode='sketch', prompt=english)
        self.assertTrue(prompt.startswith(english))
        self.assertEqual(prompt.count('Edit <image1>'), 1)
        self.assertIn('solid bright green background (#00FF00)', prompt)
        self.assertNotIn('plain white background', prompt)
        self.assertNotIn('RGBA image', prompt)


if __name__ == '__main__':
    unittest.main()
