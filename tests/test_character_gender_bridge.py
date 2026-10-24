"""人物性別を含む原文の保存互換性を一時領域で確認する。"""
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from nyamuru_series_catalog_store import SeriesCatalogStore, merge_character_catalog_markdown


class CharacterGenderStoreTests(unittest.TestCase):
    # bridgeは人物fieldを再構築せず、入力したOMNYをそのまま保存する。
    def test_omny_gender_and_absence_survive_store_reload(self):
        with tempfile.TemporaryDirectory() as directory:
            store = SeriesCatalogStore(Path(directory))
            revision = ""
            for gender in ("female", "male", "neutral", None):
                with self.subTest(gender=gender):
                    field = f"      gender: {gender}\n" if gender else ""
                    source = "manga:\n  characters:\n    - name: 人物\n" + field
                    saved = store.save("性別往復", "series-gender", source, revision)
                    revision = saved["revision"]
                    reloaded = SeriesCatalogStore(Path(directory)).load("性別往復", "series-gender")
                    self.assertEqual(reloaded["omny_yaml"], source)

    def test_markdown_merge_retains_gender_and_unmanaged_notes(self):
        incoming = '\n'.join([
            '<!-- nyamuru-series-character-catalog v1 series-id="series-gender" -->',
            '# 登場人物設定', '## キャラクター',
            '<!-- nyamuru-character id="character-one" -->',
            '### 人物', '- 性別：中性', '<!-- /nyamuru-character -->',
            '<!-- /nyamuru-series-character-catalog -->', '',
        ])
        merged = merge_character_catalog_markdown('# 制作メモ\n本文を保持\n', incoming)
        self.assertIn('- 性別：中性', merged)
        self.assertIn('本文を保持', merged)
        self.assertEqual(merge_character_catalog_markdown(merged, incoming), merged)


if __name__ == '__main__':
    unittest.main()
