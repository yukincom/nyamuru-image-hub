# 人体ポーズの3D配置・撮影ウィンドウ

2026-10-10 / 状態: 利用者の「okテストせよ。」を受け、関連テスト・型検査・ビルド・実素材照合・実画面の主要操作を検証済み。

基点: `b017b4268d834ee82cbd6d9f9a8a17179f30caaa`。正本: `<repository-root>`。

## 今回の範囲

選択したポーズの人物欄から「3D配置・撮影を調整」を開く。共通GLBへ登録済みbone/root transformを適用し、人物全体の位置（m）・Y軸回転（度）・撮影カメラを調整する。骨の自由編集・本文からの骨変形は行わない。

- コマ内とページ前景の人物で同じダイアログを使う。
- 初回は人物枠の縦横比からPNG寸法を決め、素体全体を収める。最長辺1024px、最短辺128px、縦横比は1:8〜8:1。極端な人物枠はこの範囲に制限する。
- 保存済み設定があれば、そのカメラ・位置・寸法で開く。人物枠が後から変わっても撮影寸法を黙って変更せず、ボタンで現在の縦横比を取り込む。
- 回転、距離、画面内移動、軸方向の切替、全体を収める操作を用意。背景3Dのカメラ関数と軸gizmoを共用する。
- 無彩色の素体と登録済み支持物を撮影する。床の目盛りは表示補助で、PNGには入れない。透過PNGを描画し、設定変更でプレビューを失効させる。PNGはダイアログ内だけに保持する。
- 確定時だけ `Figure.human_pose.scene` を更新する。取消・Esc・背面クリック・閉じる操作では保存しない。既存の文書更新・Undo経路へ渡す。

一覧・詳細の猫イラスト、確認済みの日英文、生成未接続のポーズ指定を黙って捨てない既存ガードは維持する。

## 既存経路との関係

編集前に背景3D、カメラ、GLB読込、人体素材store、Blender/Three照合scriptを調査した。背景のrenderer全体は静的な面・線・LT・cutaway処理と結び付くため、人体用の薄いrendererを追加する。次の処理は共有する。

| 処理 | 実装 |
|---|---|
| 外部ファイルを取得しないGLB読込・GPU資源解放 | `threeSceneResources.ts`。背景側の既存処理を抽出 |
| bone名解決・全TRSの適用 | `humanPoseRuntime.ts`。画面と `verify_runtime.mjs` が共用。`.L/.R` を含む元のGLTF node名で解決 |
| 姿勢の数値・親子関係 | 既存 `humanPoseWorldMatrices` |
| orbit、dolly、shift、全体fit、軸切替 | 既存 `background3dCamera.ts` / `BackgroundCameraGizmo.tsx` |
| 固定素材読込・hash確認 | `HumanPoseStore._load()` の検証済みsnapshotと、既存asset応答の共通処理 |
| bridge利用期間 | 既存 `withNewCreationBridgeSession`。素材受信後はleaseを解放し、操作・撮影はブラウザ内で行う |

読取専用の `POST /api/human-pose/scene` は `pose_id` と選択時の `catalog_sha256` だけを受け取り、一度検証したsnapshotからbase・rig・poseをまとめて返す。任意path、書込、Blender起動、生成実行は受け付けない。選択時とcatalogの版が違う場合と、未確認素材は拒否する。

## 保存値と説明の規則

`scene.version = 1`、素材のbase/rig/pose SHA256・rig signature・pose revision、作品内position/yaw、背景と同じcamera型（position/target/FOV/shift）、`perspective`、up `[0,1,0]`、PNGのwidth/heightを保存する。素材本体やdata URLは文書へ埋め込まない。保存値を読み込むときに有限値・距離・FOV・寸法・hash形式を検査し、3D再開時には実素材の識別子とも照合する。

撮影説明はモデル中心（変形後の人体bounds中心）からカメラ位置への方向を、素材の正面 `+Z` と作品yawを基準に分類する。顔・目線の方向は推測しない。位置調整も計算に含む。

| 項目 | 境界 |
|---|---|
| 正面 | 方位の絶対値が22.5°未満 |
| 斜め前 | 22.5°以上67.5°未満 |
| 側面 | 67.5°以上112.5°未満 |
| 斜め後ろ | 112.5°以上157.5°未満 |
| 背面 | 157.5°以上 |
| 人物の左/右 | +Z正面・Y-upにおいて、方位正側が人物の左、負側が右 |
| 俯瞰/あおり | 仰俯角が+15°以上 / −15°以下 |
| 広角/標準/望遠寄り | 垂直FOVが60°以上 / 30°超60°未満 / 30°以下 |

日本語と固定英文を同じ判定から表示する。FOVの操作範囲は10〜100°。魚眼や焦点距離mm、顔・視線、パン等の時間変化を推測しない。表示中の描写範囲は既存 `Figure.size` のラベルを使い、全身・胸上等の自動判定や自動cropはまだ行わない。

## 検証結果（2026-10-10）

- Node関連テスト36件成功。`humanPoseScene` / `humanPoseSelection` / `humanPoseMirror` / `background3d` / `background3dCamera` を対象にした。数値・素材識別子・アングル境界・全bone適用・保存往復・合体保全を検査。
- 素材storeのPythonテスト19件成功。既存ComfyUIのPillow入りPythonで実行し、skipは0件。
- `npm run check`: 330ファイル、エラー0・警告0・hint0。
- `npm run build`: 通常版・単一HTML版とも成功。大きなchunk、FigureSizeSvgの静的/動的import併用、sitemapのsite未指定という既存の警告は残る。
- 共通runtimeで実素材30件×14,677頂点をBlenderの保存済み期待値と照合。最大差 `2.42634436026325e-06 m`、許容値 `1e-5 m` 未満。照合前に、現在登録されているpose.jsonと期待値を持つ変換stageのpose.jsonがbyte一致することも確認した。既存の照合記録は上書きしない。

実行コマンド:

```sh
node --no-warnings --experimental-strip-types --test tests/humanPoseScene.test.mjs tests/humanPoseSelection.test.mjs tests/humanPoseMirror.test.mjs tests/background3d.test.mjs tests/background3dCamera.test.mjs
../ComfyUI/.venv/bin/python -m unittest tests/test_human_pose_store.py
npm run check
npm run build
```

頂点照合は今回用の `.human_pose/review/scene-editor-verification-20261010/poses/` に登録poseと既存期待値を複製し、`node --experimental-strip-types scripts/human_pose/verify_runtime.mjs .human_pose/models <今回用poses> <30 IDs>` を実行した。

### 実画面とPNG

既存のページ前景fixtureをメモリ内文書として開き、実bridge経由で素材を取得した。10番の立位、30番の床座り、34番の椅子座位で3D表示と撮影を確認。XYZ、yaw、FOV、距離、全体fit、画面内移動、正面の軸切替、日英説明、プレビュー失効、取消、リセット、Escape、ボタンへのfocus復帰、確定・OMNY保存・再読込を確認した。別poseへの変更で位置・yaw・カメラが初期化され、PNG自体はOMNYへ入らない。

通常アプリの既存検証文書でも撮影設定を確定し、Undoで設定が消え、Redoで戻り、再open時のX=0.4mが復元することを確認。最後に試験操作2件をUndoし、文書をポーズ未指定へ戻した。読込直後に閉じてもダイアログが再出現せず、fixtureのconsole errorは0件だった。

撮影PNGの寸法は512×1024、四隅alpha=0。立位・床座りに透明画素・不透明画素・輪郭の中間alphaが存在する。床座りでshift `[0.1, 0.05]` にした撮影は、alpha領域の全辺が右/下へ51px移動し、期待値51.2pxと1px以内で一致した。画像を目視し、上下反転や床の目盛りの混入がないことも確認した。

保存資料は `.human_pose/review/scene-editor-verification-20261010/` にまとめた。

- `poses/three-runtime-validation.json`、`runtime-console.txt`: 全30件の頂点照合
- `standing-preview.png`、`standing-adjusted.png`、`floor-preview.png`、`floor-shifted.png`、`chair-preview.png`: 実撮影
- `png-validation.json`: 立位/床座りの寸法・alpha・移動量
- `overlay-confirmed.omny.yaml`: 設定を保存した検証文書
- `standing-adjusted-ui.jpg`、`chair-preview-ui.jpg`: 実画面

検証用HTMLはpublicから除去。旧フォルダ名を起動argvに含む既存4322番サーバーには触れず、正本から4323番で自分の検証用サーバーを起動した。検証後に自分のサーバーを停止し、4323・8786・8787番がlistenしておらず、既存4322番だけが残っていることを確認した。

今回の実画面確認には、GPU障害の注入、全ブラウザ、全30件の画面操作、全描写範囲との投影照合は含めない。破損/hash違い・未確認素材の拒否は関連テストで検査した。P5全体は未完了のため、repository全テストはこの段階では実行していない。

## 後続

現行30件の `supports` は空で、接触点も未登録。床・椅子への自動接地は接触点/支持物登録後に接続する。背景舞台との同一カメラ・配置、描写範囲との投影照合、体勢の鏡反転UI、独立した目線/説明override、送り方の切替、PNGのジョブ保存、英訳/全指示確認、Qwen参照roleへの接続と実生成評価はP5の残項目。

新たな実行環境・依存package・モデルは導入していない。既存の常駐サービスの停止/再起動、Qwen生成は行っていない。検証済み差分をローカルGitのチェックポイントとして保存する。
