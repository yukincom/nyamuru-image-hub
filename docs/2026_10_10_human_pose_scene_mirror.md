# 3D撮影画面への体勢反転の接続

2026-10-10 / 状態: 利用者の「おけー！では続きを」を受け、関連テスト・型検査・ビルド・実素材・実画面確認を完了。

この文書は `e02d4ca` の2択UIと検証結果の記録。後続の利用者指定により[単一反転ボタンとカメラ操作の変更](2026_10_10_human_pose_camera_controls.md)へ変更済み。現在の検証範囲はリンク先に記載し、下記の2択・左右サイドの記述を現行UIの要件として使わない。

基点: 計画整合の `842f260`。直前の撮影機能の検証済みcommitは `fe2bd2b`。

## 今回の範囲

- 既存の3D配置・撮影ダイアログに「元の体勢」「左右反転した体勢」の選択を追加する。同じ選択を押し直しても再反転・再撮影要求を起こさない。
- `Figure.human_pose.scene.body_mirror` に `original` / `mirrored` を保存する。fieldがない既存作品は元の体勢として表示し、読込だけでfieldを補完しない。不正な値は保存検証で拒否する。
- 常に登録済みの基準poseから体勢を導出し、既存 `mirrorHumanPoseBody` と共通runtimeへ渡す。既存のGLB・素材読込・bridge・設定保存・Undo経路を使用し、新しいAPIは作らない。
- 顔方向は既存のhead/子bone保持規則を使う。外側の人物配置・yaw・camera・素材hashは保ち、支持物は同じ有効poseの位置へ更新する。首と頭の混合weight部分の変形まで剛体保持する仕様ではない。
- 変更はダイアログのdraftへ適用する。確定で作品へ渡し、取消・Escapeでは採用しない。開いた時の設定へ戻す操作も反転状態を含む。
- 反転を変更したら古い撮影PNGを失効させる。以後の撮影は表示中の体勢を使用し、日英camera説明は変形後の中心から再計算する。
- 基準日英と日本語編集文は変更しない。本文全体の左右を機械置換せず、画面に自動変更しないことを示す。ポーズ指定の生成未接続ガードは保持する。

## 左右サイド操作との関係

利用者指定の「絵の左側で左向き、右側で右向き」は[P5](2026_10_08_human_pose_p5_generation_integration.md)に残す。現行catalogには基準姿勢が左右どちら向きかの定義がなく、猫の顔方向と体勢・実3Dの方向も同一とは限らない。今回の2択は基準/反転を選ぶ操作であり、意味上の左右サイド操作を完了したとは扱わない。姿勢別の方向定義と接続は後続。

## 検証結果

次の追加検査を含む関連Nodeテスト40件が成功（失敗・skipとも0）。

- sceneの省略値互換と不正値拒否。反転値だけでcamera説明の左右を入れ替えないこと。
- head/jawと非対称の左右boneを含むGLB fixtureで、同じruntimeに基準→反転→反転→基準を適用する。基準データ不変、顔方向、外側の非ゼロ配置/yaw、実skinned頂点を確認する。
- box支持物と非空接触点の反転。現行30件はどちらも空なので、この経路を全30件の目視だけで検証済みとはしない。
- コマ内/ページ前景のOMNY往復、基準文・編集文保持、反転だけ異なる人物の合体保全、別pose選択時のscene初期化。

- `npm run check`: 330ファイル、error/warning/hint 0。
- `npm run build`: 通常版・単一HTML版とも成功。chunk容量、FigureSizeSvgのimport併用、sitemapのsite未設定の既存警告は残る。
- 実素材30件×14,677頂点で基準→反転→反転→基準を検査。反転の再選択と元への復帰は全頂点差0。正規化した頭boneの方向差は最大 `1.3978528260658475e-7 rad`。初回検証scriptは非正規化quaternionのangleToにより誤差を過大算出したため、方向比較前に正規化して修正した。製品コードの修正は不要だった。
- ページ前景のメモリ内fixtureで立位10番を表示し、X=0.2mの配置、反転、Spaceで同じ選択、PNG失効、元へ戻したPNGの完全一致、確定・OMNY再読込、リセット、取消を確認。保存済み反転で開いた初回描画のPNGも、保存前のPNGと一致した。
- 通常アプリの既存検証文書で座位34番の反転・orbit・PNG撮影、Undoで設定削除、Redoで反転復元、再openを確認。最後に試験操作をUndoし、検証前のポーズ未指定へ戻した。2画面ともconsole errorは0件。
- 立位512×1024、座位905×1024のPNGを目視。四隅alpha=0、透明・不透明・中間alphaあり。床目盛りの混入なし。

実行コマンド:

```sh
node --no-warnings --experimental-strip-types --test tests/humanPoseScene.test.mjs tests/humanPoseSelection.test.mjs tests/humanPoseMirror.test.mjs tests/background3d.test.mjs tests/background3dCamera.test.mjs
npm run check
npm run build
node --no-warnings --experimental-strip-types .human_pose/review/scene-mirror-verification-20261010/verify.mjs
```

検証資料は `.human_pose/review/scene-mirror-verification-20261010/`。runtime-validation.json、検証script、original.png / mirrored.png / seated-mirrored.png、png-validation.json、mirrored-saved.omny.yaml、mirrored-ui.jpgを保存した。30件の数値検査は反転の一貫性を調べたもので、反転姿勢のBlender出力との独立照合や全30件の目視評価ではない。支持物・接触点はfixtureで検査したが、現行素材には未登録のため実画面での支持物反転は未検証。

素材原本・利用者の作品ファイルを変更せず、Qwen生成やモデル操作も行っていない。検証用HTMLを除去し、自分の4323番サーバーを停止した。既存4322番は維持。P5全体は未完了のためrepository全テストは未実行。

接地・座面配置、方向定義付きの左右サイドクリック、本文と反転姿勢の生成時整合、独立目線/説明override、描写範囲、送り方切替、PNG/job保存、英文化、Qwen送信は残項目。
