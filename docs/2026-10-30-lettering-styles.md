# 描き文字のペン・表現 2026-10-30

文字ツールの情報欄で、描き文字を選択しているときだけ対応キャラクターの直下へ表示する。ペンは単一選択・未指定可、表現は複数選択・全解除可。日本語ラベルと固定英訳は `src/content/handwritten-styles.json` を正本とする。

既存の文字オブジェクトに `lettering_pen`（ID）と `lettering_expressions`（ID配列）を保存し、PanelInspector / PageOverlayInspector の既存更新関数・履歴・YAML保存へ接続する。別の設定state・保存経路は作らない。同じ値の指定は更新しない。単品・修正・コマ全体・ページ全体の既存生成経路に、文字に対応する固定英文を加える。固定文は既存 `split_fixed_generation_prompt` で翻訳対象から除外し、翻訳後に原文のまま組み込む。一般の翻訳system promptは保留時点のまま保持する。

合格条件：指定位置での表示条件、13種のペンと7種の表現、複数選択・解除・対象間の独立、Undo/Redoと保存再読込、各生成範囲での固定英訳と対象番号の保持。自動検査はコードと模擬応答を対象とし、実モデルの描画品質を証明しない。

## 固定英訳

| ペン | 英語 |
|---|---|
| 丸ペン　柔らかめ | maru pen with a soft nib |
| Gペン　ややハード | G-pen with a slightly firm nib |
| 万年筆 | fountain pen |
| 竹ペン | bamboo pen |
| 筆ペン | brush pen |
| ボールペン | ballpoint pen |
| 鉛筆　HB | HB pencil |
| 鉛筆　B | B pencil |
| サインペン | felt-tip pen |
| マジックペン　太 | broad-tip marker |
| マジックペン　細 | fine-tip marker |
| ミリペン　0.05 | 0.05 mm fineliner |
| ミリペン　0.1 | 0.1 mm fineliner |

| 表現 | 英語 |
|---|---|
| スケッチ | sketchy strokes |
| かすれ | broken, scratchy strokes |
| インクだまり | ink pooling |
| フリーハンド | freehand strokes |
| ふにゃふにゃ | loose, wobbly strokes |
| かわいい | cute lettering |
| いきおい | energetic strokes |

## 検証

- Nodeの関連試験51件成功（選択肢・保存YAML・単品/修正/コマ/ページの生成入力）。
- Pythonの関連試験28件成功。固定英訳をGemmaの入力から除外し、日本語部分の模擬訳と固定英訳を再結合することを確認。本文が「B」でも「B pencil」の固定英訳を保つ。
- 変更した本体とブラウザーfixtureの10 TypeScriptファイルで診断0件（Vite client型を含む限定検査）。
- 隔離した実EditorAppで15項目成功：表示条件・対応キャラクター直下・13/7選択肢・同値指定・単一/複数選択・対象の独立・コマ/前景のUndo/Redo・作品フォルダー保存/再読込・全解除。サービス呼出を無効化した合成文書だけを使用。
- Gemmaの翻訳system指示はHEADと同一。保留中の漫画翻訳ペルソナ・汎用辞書の接続は再開していない。
- 既存19ファイルの差分が開始時とbyte一致。今回の21ファイルだけをcommit対象とする。
- 実Gemma・実Qwen Imageの出力品質は未検証。pushは行わない。全件検証は下記の利用者確認後に実施。

作品フォルダー保存が現行経路。最初のUI fixtureは旧localStorage保存を見て失敗したため、検証コードを現行の保存経路へ合わせて再実行し成功した。本体に保存用の別経路は追加していない。

検証用Vite（PID 31579、4341）と検証タブは終了し、PID消失・待受解放を確認。通常の4321/8786は維持。

表現欄の見た目を調整：2列のgridに統一し、チェック欄の左端を列ごとに揃え、行ピッチを28pxから20pxへ縮小。実UIで左右列のx座標343/457px、各行のy差20pxを確認。既存UI検証15項目も成功。CSS調整時点では限定検証のみ実施。

## 利用者確認後の全件検証・commit対象

2026-10-30、利用者の「これでOK！テストして、問題なければ今回の変更をコミットして」に基づき実施。

- Astro型検査：438ファイル、0 error / 0 warning / 18 hints。hintsは今回の変更対象外の既存テストに由来する。
- Node全件：1,451成功、3 skip、0失敗。
- Python全件：bridge 478件（474成功・4 skip）、doctor 20件（19成功・1 skip）、human-pose 47件成功。Pillowを含む既存 `.local-vision/.venv` を使用。
- 通常Astro版・単独Vite版ビルド成功。Sitemapのsite未設定通知あり。
- 初回のsandbox実行はNodeのlocalhost待受5件がEPERMで停止。待受権限を付けて全件テストを再実行し成功した。
- commit対象は本機能・固定英訳・UI調整・仕様・試験・本記録の21ファイル。人体モデル試験、保留中の汎用翻訳辞書、未追跡資料は含めない。
- 常駐の4321/8786を維持。検証用4341/8787の待受なし。モデルの実推論や環境の追加導入は行っていない。
