# 背景3Dの中で人物を調整する

2026-10-11 / 状態: 同じ舞台・カメラでの表示、手動配置、設定保存・再編集を実装・検証済み。自動接地と生成への受渡しは後続。

正本: `<repository-root>`。基点: `db7d378`。

## 操作と範囲

人物の「3D配置・撮影を調整」で、登録済みの「3D舞台」を選ぶ。背景モデルと選んだ1人を同じThree sceneとPerspectiveCameraで表示する。机などの手前／奥の関係はdepth testに従う。

- X/Y/Z、向き、大きさの倍率を調整し、確定する。舞台の原点・大きさは変更しない。倍率1で人体の1mが背景の1座標単位に相当し、cm等で制作された舞台には利用者が倍率を合わせる。
- 「背景の中央へ移動」は舞台全体のbounds中心へX/Zだけ移す。高さを維持するため、接地操作とは異なる。
- 「背景と人物を収める」と、人物だけを対象にする「全体を収める」を用意。
- 既存の背景撮影がある場合、同じ舞台の「カメラ・表示を使う」でposition/target/FOV/shift、撮影枠の縦横比、壁の非表示・物の表示設定を取り込む。コマ内の人物では当該コマ、ページ前景では同じページのコマから選ぶ。変更後はこの人物のscene.cameraが合成表示の唯一のカメラになる。元の背景画像や背景撮影設定へは書き戻さない。
- 「手前の壁を隠す」は既存cutaway計算を再利用する。取り込んだ物のshow/hide指定を優先する。背景側のfocus保護・照明・LT線画は人体の確認画面へは取り込まない。
- 「ポーズ付属の台・椅子を表示」を保存する。舞台を選んだときは非表示から開始する。舞台自体の家具はこの操作で消さない。
- 「撮影プレビュー」は人物と有効な付属支持物だけの透過PNG。「背景と一緒に撮影」は同じカメラで背景を含むPNG。床の補助目盛りを含めない。背景だけが画角に入っている場合を撮影成功にしない。PNGはプレビュー内のみで、作品へは設定を保存する。
- 確定前はdraftだけを変更する。取消・再開・Undo/Redoの既存経路を利用する。背景の切替失敗では現在の舞台・配置・プレビューを維持し、読み込み中は配置変更・撮影・確定を無効にする。閉じた後の完了通知は無効にする。
- 保存済み舞台の原本がないときは確定を止め、再読込または「背景との関連付けを外して開く」を選べる。後者も確定するまで作品の保存値は変更しない。

背景カメラ取込にも人体側の範囲制限を適用する（FOV 10〜100度、shift各成分±2、座標±10,000、距離0.01〜10,000）。範囲外を黙って丸めない。倍率は0.001〜1,000。PNGの最長辺1024px、縦横比1:8〜8:1は人体撮影の既存制限を引き継ぐ。

## 再利用・保存

編集前に既存舞台store、GLB/FBX読込、背景camera、cutawayと人体runtimeを比較した。新しい舞台一覧・import・endpointは追加していない。

| 用途 | 使う既存経路 |
|---|---|
| 舞台一覧・原本 | `manga.background_stages`、`loadBackgroundStage`、`verifyBackgroundStage` |
| 舞台の形状と座標 | `loadStageShape`。GLB/FBXのworld transformを保つ |
| 人体の姿勢 | `loadHumanPoseRuntime`。登録poseと左右反転を再利用 |
| 壁・物の非表示 | `prepareBackgroundCutaway`、`visibleCutawayMeshes`、`applyBackgroundVisibility` |
| camera操作・全体表示・clip planes | `background3dCamera`、`BackgroundCameraGizmo`、`stageClipPlanes` |
| 保存・復元 | `HumanPoseSceneSettings`、既存文書更新/history、`projectPersistence` |

`scene.version=1`に省略可能な`background`（sourceId/cutaway/objectVisibility）、`placement.scale`、`show_supports`を追加。省略時は背景なし・倍率1・付属支持物あり。stage IDは原本SHA256を含み、文書内の舞台参照も検査する。

自動保存・素材込み作品保存では舞台と設定を保持する。複数人物が同じ舞台を使っても原本は1つだけ保存し、復元時のstorageId変更で配置を変えない。素材を含まないテキストOMNY書き出しでは、既存の舞台メタデータ除去と合わせて`scene.background`も除去する。位置・倍率・camera・ポーズ文は保持し、元の編集中文書は変更しない。

## 検証

- 関連Node **56/56成功**。新規に舞台・倍率・表示の入力検証、背景camera取込の同一舞台制限と独立clone、コマ内/前景の保存、テキスト書き出し、素材込み保存の原本重複排除と復元を検証。
- `npm test`成功。Node 866件中863成功・3 skip、bridge Python 337件中39 skip、doctor 18件中1 skip、人体素材44件中20 skip。Pythonのskipは標準環境の追加依存不足等による。初回のsandbox実行はテスト用loopback listenがEPERMになったため、実行制限の外で全体を再実行した。
- 型検査330ファイル: error/warning/hint 0。通常版・単一HTML版build成功。既存のchunkサイズ・静的/動的import併用・sitemap設定の警告は残る。
- 実PanelInspector/PageOverlayInspectorを使うメモリ内文書で**22項目成功**。登録済み34番の座位と10番の立位を、検証用GLBの部屋・机・椅子に表示。背景camera/frameの取込、位置/倍率、原本欠落時の維持と明示detach、確定/取消、Undo/Redo、再読込、2回反転、壁表示、中央移動の高さ維持、画角外の人体検出、gizmoの実dragを確認。
- 再読込後の合成PNGがbyte単位で一致。人物のみのPNGは背景の壁表示に影響されない。4画像とも1024×768。人物のみは779,930画素が透明、合成は668,174画素が不透明。目視でも背景と人体、前後関係を確認。
- WebGLの複数回描画で、pixel read後にMSAAの書込先を再設定しないと合成PNGが人物だけになる不具合を実画像から発見・修正し、再撮影で確認した。fixtureの空paint layerと、既存normalizerが追加する人物role、舞台bounds中心を原点とみなした試験側の仮定も修正。製品のconsole errorは最終確認で0件。

資料: `.human_pose/review/background-verification-20261011/`。`ui-validation.json`、`png-validation.json`、`background-ui.png`、4撮影PNG、`saved.omny.yaml`、fixtureと全体test/build logを保存。fixtureは利用者の作品や自動保存先を使わない。検証用public HTMLを除去し、専用タブを閉じた。既存4321/4322サービスは維持した。

## 既存の書斎での確認

利用者指定の `../background-lab/cluttered-office/6帖の白い仕事部屋_軽量版.glb` を使用した。原本とbyte一致する確認用コピー（SHA256 `c0e6a5a201b4261f58c4ebabb24c5f6be6cd278946389376d284271fdc504d9f`）を既存舞台読込へ渡し、家具の形状・寸法は変更していない。

表示番号10（`pose-mh-standing01`）の立位の高さは実頂点で1.364708m。先の確認用家具は座面上面0.53mで、この人物を倍率1のまま表示したため相対的に小さかった。書斎では人物を倍率1.25（高さ1.705885m）とし、位置 `[0, 0.003, 0.65]`、向き0度で椅子の横に配置。書斎GLBの座面上面は0.466500m、机天板上面は0.720000mと確認した。倍率はこの確認文書の指定で、素体原本や製品の既定値は変更していない。

実画面で書斎・人物の合成を確認。確定→OMNY保存/再読込→3D再編集で、同じ位置・倍率・カメラを復元し、合成PNGがbyte一致した。console error 0。資料は `.human_pose/review/study-verification-20261011/` の `study-ui.png`、`study-standing.png`、`dimension-check.json`、`ui-validation.json`、保存設定と再現fixture。確認用public HTMLを除去し、専用タブを閉じた。製品コードの変更はなく、全体テスト・buildの再実行は不要と判断した。

## 次の区切り

実際の背景の床・座面を選び、人物をその位置・高さ・正面方向へ合わせる補助を進める。現時点は数値による手動調整で、家具への自動関節適応はない。舞台単位の自動判定、複数人物の同時編集、主原稿への背景再撮影・人物配置の一括反映、PNG/job保存・Qwen送信は今回の完了範囲に含めない。実FBX素材での合成確認は未実施。
