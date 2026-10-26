# 同梱画像・データの出典

2026-10-24の本体スナップショットを基点に、2026-10-25の雲形プレビュー追加後の追跡対象の画像・動画・SVG 109ファイルと、関連するモデル・motion・注釈データを確認した記録です。機能を動かすために利用者が別途登録する原稿、3D素体、生成結果、外部モデルは含みません。

| 対象 | 数 | 出典と権利表示 |
|---|---:|---|
| 公開済みの画像・動画 | 15 | 公開基点 `68aaf0b` とbyte不変。`docs/images/`、`public/`、既存の `nyamurutan-*.webp`、`sample/`。既存の著作者・権利表示を保持 |
| 旧ガイドの画像コピー | 2 | `archive/legacy-howto-2026-09-05/`。既存にゃむるたん画像の保存用コピー |
| 猫の描写範囲見本・ポーズプレビュー | 31 | このプロジェクト用に画像生成したUI素材。[描写範囲の生成記録](2026_10_08_figure_size_picker.md)、[30ポーズの生成記録](2026_10_09_human_pose_cat_previews.md)。元の第三者参考図の画像そのものは同梱しない |
| フキダシSVG | 39 | 利用者提供のVectorCraft原稿から分離した手描き素材38件と、別の利用者提供フキダシから既に抽出済みの雲形輪郭を一覧表示するプレビュー1件。[構成・変換記録](2026-10-17-bubble-materials.md)。VectorCraftのアプリコードや製品素材を取り込むものではない |
| 画像QAの合成PNG | 22 | `tests/fixtures/generation_qa/build_fixtures.py` による生成。外部素材・モデル・ネットワーク不使用。MIT。hashと来歴は同フォルダーの `manifest.json` / `provenance.json` |
| Quaternius motion | 17 clips | [Universal Animation Library](https://quaternius.itch.io/universal-animation-library)から変換。CC0-1.0。`src/assets/human-pose-motions/` に原license・変換来歴・hashを同梱 |
| 人体ポーズ研究の注釈 | 7分類 | [Pyrolisticalの研究](https://github.com/Pyrolistical/krea-2-qwen-image-2-1-study)、固定revision `5fcb3705e02a2fa7777708e432ac00aa73e43dd1`。MIT / Copyright 2026 Ronald Chen。`scripts/human_pose/data/LICENSE` を保持。研究の元画像136枚は同梱しない |
| 操作分類器 | 1モデル | [モデル説明](../models/nyamuru-voice-v04-seed43/README.md)。ModernBERT-Jaを基にした採用済みfine-tune。MIT、固定hash、Git LFS実体を同梱 |

`sample/` の原稿と動画は **© yukin_co** で、アプリ本体のMIT Licenseから除外されます。[sample/README.md](../sample/README.md) の表示を保持してください。公開されていることだけを根拠に、画像一般へ別の再利用条件を付け足しません。

猫のUI画像とフキダシ素材には独立したlicenseファイルがありません。この記録は出典の整理であり、既存の権利表示を変更するものではありません。

通常buildと単一HTML版へ添付する第三者表示は [THIRD_PARTY_NOTICES.txt](../public/THIRD_PARTY_NOTICES.txt) にまとめています。QuaterniusのCC0表記と、人体ポーズ注釈のMIT noticeも収録しています。

MakeHuman由来の採用ポーズについては[選定記録](2026_10_09_human_pose_posing_workspace.md)に出典・作者・除外判断があります。公式配布表のCC0表記は公開統合時にも確認しましたが、原BVH、GLB、Blenderファイルと `.human_pose/` の検証資料はこのリポジトリへ追加していません。
