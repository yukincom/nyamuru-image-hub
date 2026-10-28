# 2026-10-28 文字編集の全体検証

利用者の画面確認と全件テスト・ビルド・commitの指示を受け、正本 `Comic_image_Hub` で検証した。復旧基点は `1da5a528c04c9bc9f0ac417ec44c11ac5656b706`。

## 対象

- 描き文字の本文・描き方・生成と、通常フキダシの単品生成入口撤去。
- フキダシ・描き文字・写植文字の種類切替。OCR本文・原字・描画レイヤー・位置・書式の保持。
- 「テキスト1」形式の名前と、情報タブの余白・見出し・入力欄・共通ウィンドウ寸法。
- 既存の更新・選択・履歴・保存経路に統合。無関係な未追跡資料はcommitに含めない。

## 全体検証で修正した項目

1. `humanPoseSelection.browser.tsx` のInspector引数を現行仕様へ更新。
2. 名称変更と生成ボタンの対象分岐に追随していなかった既存テスト2件の期待値を更新。
3. エージェント用の形状定義へ `typeset` を反映。TypeScript側は既存 `BUBBLE_SHAPES` を参照し、Python側の定義と仕様書・生成プロンプトの15種類を一致させた。
4. 種類変更後の写植文字・描き文字に、生成参照画像の吹き出し用余白・自動折返しが適用される点を修正。横書き・縦書きの狭いbboxでも明示改行と空行を保持するテストを追加。
5. 別コマ・別ページからUndoした際に文字選択が解除される点を、既存 `selectCanvasElement` の選択予約経路へ統合して修正。修正前に実Appで再現し、修正後のUndo/Redoを確認した。

## 結果

`PATH` の先頭へ正本の `.local-vision/.venv/bin` を置き、`npm run verify`（型検査・全件テスト・通常/単独HTMLビルド）を実行。最終終了コードは0。

| 検証 | 件数 | 成功 | スキップ | 失敗 |
|---|---:|---:|---:|---:|
| Node `tests/*.test.mjs` | 1,401 | 1,398 | 3 | 0 |
| Python bridge | 466 | 465 | 1 | 0 |
| Python workspace doctor | 20 | 19 | 1 | 0 |
| Python human pose | 45 | 45 | 0 | 0 |
| 追加Python: production package / Qwen generation phase | 40 | 25 | 15 | 0 |
| 合計 | 1,972 | 1,952 | 20 | 0 |

- 型検査432ファイル: エラー0、警告0、ヒント19。
- 通常版9ページと単独HTML版をビルド成功。既存の非致命的な警告として、動的/静的importの併用とsitemap用`site`未指定が出る。
- スキップはローカル画像fixture・任意依存・明示指定が必要なComfyUI CPUテストによる。依存の追加やモデル取得は行っていない。
- 最初の通常権限でのNode実行は、ローカル待受がsandboxに拒否された5件を含んだ。許可された権限で再実行し、全件成功を確認した。
- 実Appの文字情報/種類切替47項目が成功。別コマ・別ページからのUndo/Redo、原字・本文・書式・複数行寸法、保存再読込、T追加、ロック、前景との分離、実Canvas出力を含む。専用originの使い捨て作品フォルダを使用。
- 実モデルの生成品質・透過、通常OSフォルダへの保存、実PNG/PSDファイルの書出は今回の検証対象外。

実行ログ: `/private/tmp/nyamuru-verify-20261028-final.log`、`/private/tmp/nyamuru-verify-extra-20261028.log`。実画面: `/private/tmp/nyamuru-final-text-verification.png`。

## 後片付けと保存

- 専用ViteはPID42693、正本cwd、`node --input-type=module`、127.0.0.1:4339。SIGTERMで停止し、実行session終了143・PID消滅・待受解放・検証タブ終了を確認した。
- 利用者が継続利用を指定した通常サーバーPID36305（4321/8786）とbridge PID38395/38396（8787）は維持。
- この記録と同じcommitに今回の実装・テスト・仕様書を収める。既存のGrok資料、voice関連資料、`output/`は保持する。pushは行わない。
