# 人体3Dのカメラ操作と左右反転

2026-10-10 / 状態: 利用者了承後、関連Node42件・型検査・通常/単一HTMLビルドと実画面の主要操作を確認。Spaceを保持した実ドラッグ等の組合せ操作は未確認。

基点は `e02d4ca`。同じ作業差分に[送り方の選択UI](2026_10_10_human_pose_input_mode.md)も含む。

## 現在の操作

| 操作 | 入力 |
|---|---|
| カメラの角度 | 三方矢印をドラッグ。矢印クリックで軸方向へ向ける |
| カメラの距離 | 3D画面または三方矢印の上でマウスホイール |
| 画面内の位置 | Spaceを押しながら3D画面をドラッグ |
| 体勢の左右 | 「左右反転」ボタン1つを押すたびに基準/反転を切り替える |

利用者の「カメラの角度調整は例の三方矢印、遠近はマウスホイール、視点移動はスペースキーで画面掴み」「左右反転ボタンは一つだけ置いて。ボタンぽちぽちで右になったり左になったりするように。」を反映する。

細かなカメラボタン10個（近づく/離れる、回転4方向、画面移動4方向）と、画面の通常ドラッグによる回転を外す。「全体を収める」、画角スライダー、人物配置、撮影・確定・取消等は維持する。

## 既存処理の再利用

- 角度調整は共通の `BackgroundCameraGizmo` をそのまま使う。距離と画面移動は `dollyBackgroundCamera` / `shiftBackgroundCamera` を使い、カメラの別実装を追加しない。
- 画面移動は投影のshiftだけを変更する。人物の配置、カメラの角度・距離・回転中心を変えず、マウスの移動方向へ画面を動かす。上下左右とも画面寸法で正規化し、保存値の範囲内へ制限する。
- Space中は手のcursor、ドラッグ中は掴んだcursorを出す。Spaceを離す、focusを外す、pointer cancel、アプリ/タブの切替、閉じる操作で解除する。通常ドラッグでは回転・移動しない。
- 開いた時は操作領域へfocusを置く。マウスでボタンや三方矢印を操作した後も、次のSpaceで画面を掴めるようfocusを戻す。数値入力、スライダー、キーボードで選んだボタンや矢印のSpace操作は奪わない。入力後は3D画面をクリックして操作領域へ戻れる。
- 距離変更はFOVを変えない。wheelのpixel/line/page単位を扱い、掴んで移動中のwheelを重ねて開始時cameraへ戻る競合を避ける。
- 反転は既存の `scene.body_mirror` を交互に切り替える。共通runtimeが毎回基準poseから体勢を作るため、変形の計算誤差を積み重ねない。顔の向き、配置、camera、本文はそのまま。現在の状態を文字と `aria-pressed` で示す。
- 変更時のPNG失効、取消、確定、作品保存、Undo/Redoは既存経路を維持する。背景3D側の操作は今回変更しない。

## 確認項目と残る実操作

- 三方矢印の回転と軸クリック、ホイールでの距離、Space＋左ドラッグでの移動を確認する。通常/Shift/中ボタンドラッグで別のcamera操作を起こさないことも確認する。
- ドラッグを開始点へ戻した時、Spaceを先に離した時、viewport外でpointerを離した時、focus/window blur、再openを確認し、掴み状態を残さない。
- 3D操作が裏側の原稿のSpace移動やdialogのスクロールを動かさないこと、文字・数値欄やkeyboardでfocusしたbuttonのSpaceを奪わないことを確認する。
- 単一反転buttonを2回押して体勢と撮影PNGが戻ること、反転が保存再読込・取消・Undo/Redoで整合することを確認する。
- 関連Nodeテスト、型検査、通常/単一HTMLビルドと、コマ内/ページ前景の実画面で検証する。`e02d4ca`での2択UIの検証結果を今回の入力操作の検証済み根拠にはしない。

## 2026-10-10の検証結果

- 関連Node42件が成功（失敗・skip 0）。`npm run check` は330ファイル、error/warning/hint 0。`npm run build` は通常版・単一HTML版とも成功。chunk容量、FigureSizeSvgのimport併用、sitemapのsite未設定の既存警告は残る。
- 送り方切替と合わせて実画面20項目が成功。正本の通常起動 `node scripts/start-dev.mjs`（4321番）を使い、専用のメモリ内文書でコマ内34番とページ前景10番を確認。実 `PanelInspector` / `PageOverlayInspector` / `FigureHumanPoseEditor` と既存OMNY変換・`workspaceHistory` を使う。利用者の作品や自動保存先には接続しない。
- 三方矢印の実ドラッグで角度が変わり、target/FOVが保持される。Z軸ボタンも作動。ホイールで距離が変わり、FOV/target/人物配置が保持される。通常ドラッグでは撮影PNGが変わらない。
- 単一反転ボタン2回で撮影PNGが完全一致して元に戻る。反転でPNGが失効し、keyboard focusした反転ボタンをSpaceで操作できる。操作領域でSpaceを押して離した後は掴みcursorが残らない。
- 配置X=0.2m、反転、送り方と編集文を確定・保存。取消で変更を破棄し、検証fixtureの既存historyによるUndo/Redoで直前/直後の設定を復元。コマ内・ページ前景ともOMNY再読込と3D再open後のPNGが保存前と完全一致する。
- 4枚のPNGは512×1024。四隅alpha=0、透明・不透明・中間alphaあり。資料は `.human_pose/review/controls-verification-20261010/` の `fixture.tsx`、`ui-validation.json`、`png-validation.json`、PNG、`saved.omny.yaml`、`controls-ui.jpg`。

実行コマンド:

```sh
node --no-warnings --experimental-strip-types --test tests/humanPoseScene.test.mjs tests/humanPoseSelection.test.mjs tests/humanPoseMirror.test.mjs tests/background3d.test.mjs tests/background3dCamera.test.mjs
npm run check
npm run build
```

Spaceを保持しながらの実ドラッグ、開始位置への復帰、途中のkey-up、viewport外でのpointer-up、Shift/中ボタンドラッグ、window blur・pointer cancel、通常アプリのMangaCanvasと同時に動かした場合の干渉は未確認。操作ツールにキーの保持とマウス操作を組み合わせるAPIがなく、静的確認やSpace単独操作をこれらの検証済み根拠にはしない。共有camera関数の数値検査は上記Nodeテストに含む。

fixtureの初期作成時にcatalog digest未指定と空panelへの代入で2件の読込エラーが出た。fixtureを修正後、製品componentの検証中にはconsole errorなし。既存サーバーの停止・再起動やモデル操作は行っていない。P5全体は未完了のためrepository全テストは未実行。

検証用タブを閉じ、`public/human-pose-controls-check.html` を除去した。再実行時は資料内の `fixture.html` をそのpathへ一時コピーして通常devサーバーで開く。`fixture.tsx` のcatalog digestは今回の素材版に固定している。
