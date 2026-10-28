# 2026-10-28 選択ツールとレイヤー編集の連携修正

基点 `63e361be22b4f20d2be79a922d722ccfc5a3f3d6`。

## 原因と責任

利用者の録画と通常画面で、ラスターのあたりを選んだままV/Aへ切り替えるとペイントの全面入力が残ることを確認。配置側の拡縮・吹き出しのアンカー・別コマへのクリックが遮断される。ペイントのベクター選択も、線の外にある拡縮ハンドルより画素hitを先に判定している。

- 残す入口: ツールボタンとショートカットの既存 `selectTool`、レイヤーパレットの `selectOwner`、nativeの `selectCanvasElement` / `selectCanvasPanel`。
- 変える責任: ベクターレイヤーのV/Aはペイントのパス編集へ、画像・文字・コマのV/Aは既存closeとlayerTransitionを通して配置へ接続する。選択だけでは作品の変更・Undo・画像再生成を追加しない。
- 撤去する重複: V/Aのツールボタンとキー処理に分散している配置/描画の切替判定を `selectTool` へ集約。
- 合格条件: あたりを選んだVで拡縮点が戻り、Aで吹き出しのアンカーを編集できる。キャンバスから別コマへ切替できる。選択中のベクターパスはVで拡縮、Aでアンカー編集、取消し/Undo/Redoが成立する。ロックとレイヤーの所属・開閉を保つ。

## 検証

- V/Aのボタンとショートカットの分岐を `selectTool` / `paintSelectionMode` に集約。画像／文字／コマは `chooseLayoutTool` →既存 `layerTransition` / `close` →既存配置選択へ進み、現在のownerを保持する。選択中のベクターレイヤーは既存のパス編集を継続する。
- 選択済みのベクターの拡縮ハンドルを画素hitより先に判定。線の外の角からも拡縮できる。
- 描画中のクリックは、描画レイヤーの前後帯とDOMの表示順を確認し、手前のnative部分・別コマへ委譲する。文字／吹き出しは文字矩形と実SVG形状だけを判定し、paint canvasの合成alphaで自身をnativeと誤認しない。circle/rect/ellipse/pathに対応する。
- 2026-10-29、関連Node 3ファイル45件成功、変更入口と実App fixtureのTypeScript型検査成功、diff check成功。
- 独立originの実App22項目成功。画像拡縮と選択同期、変更なしの原稿同一、画像／ベクターの1回Undo/Redo、拡縮取消し、V/Aの両入力、別コマの本文・空白・通常文字への切替、nativeの前後の線と別前景との優先を含む。最新タブのconsole errorは0件。旧タブが古い検証moduleを保持していたため、新しいタブで最新配信ソースを確認して最終実行した。
- 実マウスでもnativeのアンカー移動と画像拡大が成立。確認画像 `/private/tmp/nyamuru-selection-tools-fixed.png`。
- 読み取り専用レビューの指摘を反映し、最終追加指摘なし。
- 正本から起動したQA Vite（`node node_modules/vite/bin/vite.js --config tests/browserWorkspace.vite.mjs`、PID9137/session85201）を停止。PID終了・4339待受解放・検証タブ2枚の終了を確認。利用者指定の通常36305/4321は維持した。通常タブは作品を保持しており、最新コードでの再確認には再読み込みと作品の開き直しが必要。
- 利用者の画面確認と全件テスト・build・commit指示を受領。既存の未追跡資料は変更せず保持。

## 利用者確認後の全件検証

2026-10-29、`npm run verify` 成功（終了0）。型検査432filesでerror/warningとも0。Node1430成功・3skip、Python407成功・59skip／19成功・1skip／24成功・21skip。合計1880成功・84skip。通常版と単独HTML版のbuild成功。

初回に失敗した3件は、既存の抽出テストが共通ツールdispatchの依存を持たないことと、撤去した重複分岐を要求する正規表現による。`paintSession.test.mjs` は実 `selectTool` と既存のキーhandlerをつないで、配置への復帰・描画再開・隠れた編集の抑止を確認するよう更新。`textToolMenu.test.mjs` はボタンとキーが同じ `selectTool` を使うことを確認する。対象72tests成功後、全件を再実行して失敗0件。

今回の本体6files・tests4files・本記録の計11filesだけをローカルコミット対象にする。既存の未追跡資料を含めず、pushは行わない。前段の実App22項目と実ドラッグの検証後に本体の追加変更はない。
