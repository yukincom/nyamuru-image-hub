# 2026-10-28 文字の種類切り替え

全体検証・commit時の結果は[文字編集の全体検証](2026-10-28-text-editing-verification.md)を参照。以下は実装時点の記録。

## 仕様と既存経路

- Tの任意位置クリックによる写植文字追加を維持。文字ツールの「情報」は選択中の本文と「種類」プルダウンを表示し、フキダシ・描き文字・写植文字を切り替える。全件一覧や種類別タブは増やさない。
- フキダシ選択時のみ既存の話者・しっぽ・結合先を表示。描き文字の描き方・生成は既存のコマ情報から利用する。
- OCR原字・描画レイヤーの所有関係を保つため、既存Bubbleを同じ配列位置に維持してshapeをnormal/handwritten/typesetへ切り替える。typesetは輪郭・しっぽ・結合線を描かず、単品生成の対象にしない。
- T追加直後のScreenTextは既存形式を使い、種類変更時に同じBubble編集経路へ移す。本文・書式・bboxを維持し、表示中の文字中心を既存text_positionへ引き継ぐ。複数行の見た目を維持するため、元の行送りをtext_style.lineHeightへ保持する。
- 原字のimage.id・参照・位置・表示、paint_overlay、本文位置、部分書式は変更しない。種類変更で輪郭・しっぽ・結合を外し、フキダシへ戻すと通常形状になる。
- 更新はcanvasText、選択は既存CanvasTextTarget、確定はlayerTransition/setDocument、復元は既存workspaceHistoryへ接続。履歴snapshotに文字選択を含め、Undo/Redoで形式と選択先を復元する。新たな履歴・保存経路は作らない。
- 既存の「素材を重ねて文字量へ合わせる」処理は維持する。種類変更ではそのfitを使わず、位置と寸法を維持する。

## 検証

- 関連Node105件成功: canvasText、textToolMenu、bubbleOriginals、qwenComposition、bubblePresentation、bubbleTail。
- 変更箇所16ファイルの限定型検査は診断0。全体型検査ではない。
- 専用4339の実Appで種類変更35項目成功。OCR本文・空白・改行・書式・部分書式・位置・原字画像・描画レイヤー、3種往復、Undo/Redo、保存再読込、手動ロック、コマ/前景分離、Tクリック追加、複数行の寸法/行間/中心位置、実Canvas出力と輪郭差を確認。
- 既存の描き文字編集22項目も成功。描き方・文字あたり表示・追加削除・ロック中の生成入口・保存再読込を確認。
- 途中で、Undo時の選択解除と、T文字からの変換による行間差を修正。既存qwenComposition試験の依存モックにletteringGuideVisibleが不足していた点も更新。
- 実モデルによる生成、OSの通常フォルダ保存、PNG/PSDファイルの実書出は未実施。全件テストとbuildはAGENTS.mdの利用者確認順序に従って画面確認後。未commit、pushなし。

## 作業場所・復旧・起動

- 正本: Comic_image_Hub。
- 基点HEAD: 1da5a528c04c9bc9f0ac417ec44c11ac5656b706。前作業の描き文字生成・写植文字ラベルの未commit差分と、既存未追跡資料を保持。
- 作業開始時のファイル差分控え: /private/tmp/nyamuru-text-kind-bf8cqg1e。
- 検証Vite: PID85299、正本cwd、node --input-type=module（configFile:false、Tailwind、Preact、LAN fixture）、127.0.0.1:4339。SIGTERMで停止し、PID終了・4339待受解放・検証タブ終了を確認済み。
- 利用者の継続確認用: 通常PID36305/4321・8786、bridge管理PID38395/Python38396/8787を維持。利用者の作品の読込操作は行っていない。
