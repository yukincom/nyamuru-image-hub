# 採用30ポーズの登録・選択・保存

2026-10-09 / 状態: 利用者のコードレビュー了承後、採用30件の登録と選択・日本語編集・保存を検証済み。P5の3D撮影・英訳・Qwen送信は後続。

利用者が確認した配布30ポーズとプロンプトを、アプリの人物選択へ接続する最初の区切り。今回の差分は、登録処理、番号/PNG付き選択、日本語編集、保存まで。3D配置・撮影・英訳・Qwen送信は次の工程で扱う。

## 変更

- `scripts/human_pose/data/curated-*.json`: 元番号・配布元key・CC0出典・Gemini原文・了承後の英文・日本語を30件分固定。IDは `pose-mh-<source-key>` とし、研究用68件のIDを再利用しない。
- `export_curated.py`: 保存済み作業台のPose Assetを評価し、20 helperを共通163骨へ焼き込む。17/23だけは保存sceneから読む。元のblendを保存せず、PNGのbytesをそのまま複製する。
- `register_curated.py`: 既存Three全頂点検証とpose hashを照合してstage catalogを作る。`--publish` で既存catalogをhash名で退避し、固定IDの素材を登録する。研究用素材は保持。
- `validate_catalog.py` / `HumanPoseStore`: 既存schema 1の検証を残し、採用30件のschema 2を追加。symlink拒否・固定path・検証済みsnapshotの仕組みを再利用。新設HTTPは一覧読取1本だけで、同じsnapshotのPNGをまとめて返す。
- `FigureHumanPoseEditor`: 既存の `withNewCreationBridgeSession` で一覧読込中だけbridgeを利用する。番号と絵で検索、仮選択、取消/確定、日本語編集、基準文表示、解除。人物とページ上人物へ同じUIを使い、モーダル内では文書全体と背後のペイントのshortcutを止める。同じIDの再確定では保存済み基準文・編集文を維持する。
- `Figure.human_pose`: pose ID、一覧hash、元番号、ラベル、template revision、基準日英、編集日本語を保存。既存のUndo/自動保存/OMNY経路を使用。`action` は保持する。異なるポーズ編集をコマ合体で重複除去しない。
- 送信統合まではポーズ指定済み人物のQwen生成と、その人物を含むコマ下絵生成を説明付きで止める。ポーズ指定を解除した人物は既存経路を利用する。

一覧用画像は撮影確認を経た生成ガイドではないため、画像参照の有効flagはfalse。プロンプトの12は左右の再現が不安定、37は両膝の修正文が画像生成未確認と明示する。23は修正文、42は物体名を含めない候補Bを基準にする。その他の19件は利用者提示文を基準とし、日本語を対応させた。実験の服装・白背景は本文に含めない。

本文の頭/目線/画面左右は現在の了承済み文をそのまま保存する。独立した目線欄・撮影カメラと送信へ統合するときに整合を扱う。現段階では日本語の変更が3Dや生成へ反映されたように表示しない。日英の基準は1つの `pose` segmentとして保持し、節対応と差分英訳は後続。

## 検証結果（2026-10-09）

- 利用者のコードレビュー了承後に実行。Geminiによる `curated_catalog.py` の日本語コメント・例外文、利用者指定のUI3文言を保持。
- 関連Nodeテスト80件、Python人体ポーズテスト41件が成功。Astro型検査はエラー・警告0、通常版と単一HTML版のビルド成功。全体計画は未完了のため、全機能の総合テストとは区別する。
- 30件を背景Blenderで共通163骨へ変換。Blender内の変換前後差は最大 `2.811003075676074e-6 m`、Three.jsとの全14,677頂点比較は最大 `2.42634436026325e-6 m`。ともに許容値 `1e-5 m` 未満。
- 30 PNGは利用者確認済み原本とbyte一致。17/23は利用者の修正済みscene、他28件は配布Pose Assetから取得。元blendは保存しない。
- schema 2の30件を `.human_pose/catalog.json` へ登録。以前のcatalogは `.human_pose/backups/catalog-d94ec24603aad6dba3bbeeb214d3f3a38b15afe0593407777621e38c36d1bfe0.json` へ退避。既存163ファイルのSHA-256は登録前後で一致し、以前の68件と共通素体を保持。
- 実bridgeの `POST /api/human-pose/catalog` から30件のPNGを読み、画面側のPNG署名・SHA-256照合を通過。読込後に自分のbridge利用権を返す。文章LLM・画像生成は起動していない。

## 実画面

通常アプリの検証用文書で、30件の番号付きPNG表示、AND検索 `座る 足を組む`（41番1件）、番号検索23、該当なし文言、仮選択・取消・確定、日本語編集、Undo/Redo、同じID再確定時の編集文保持、Escape、閉じた後のボタンへのフォーカス復帰、自動保存からの再読込、解除を確認した。確認後は文書から試験用のポーズ指定を解除した。

ページ前景は `tests/humanPoseSelection.browser.html` / `.tsx` のメモリ内文書で、実bridgeから17番を読み込み、選択・日本語編集・OMNY保存・別文への変更・OMNY再読込を操作した。保存文が復元され、別欄のアクションが保持されることを確認。fixture用HTMLは検証中だけpublicへ置き、終了後に除去する。

実画面で見つかった一覧読込時のbridge自動起動漏れを既存処理の再利用で修正した。ダイアログは中央へ配置し、下部ボタンの見切れとボタン装飾を修正した。別ページへの遅延応答・複製/合体は、キーと更新経路の静的レビューおよび保存往復・合体保全の単体検査で確認し、今回の全パターンの実画面操作とは区別する。

既存の4322番サーバー（PID 26204）は旧フォルダ名 `Comic Image Hub` の起動パスを参照してエラーを返していた。プロセスとログを読んで確認し、そのプロセスを変更せず、正本 `Comic_image_Hub` から `npm run dev -- --port 4323 --host 127.0.0.1` を起動して検証した。利用者が操作中のBlender画面は変更していない。

## 再確認用の資料

- 変換stage: `.human_pose/review/curated-registration-20261009/`
- 変換元・PNG・BVH・poseのhash: stage内 `sources/curated/index.json`
- 全頂点比較: stage内 `poses/three-runtime-validation.json`
- 登録前の163ファイル: stage内 `before-registration-hashes.json`
- 画面: stage内 `selection-ui.jpg`
- 回復用の実装前commit: `79b3eea43904cd23dc346fc0f35af798c9b43808`

再変換する場合、既存stageは上書きせず新しいoutput名を指定する。Blenderは背景プロセスで実行し、既存のPillow入りPythonを用いて `register_curated` を実行する。変換・照合・登録は次の順序。

1. `export_curated.py --root .human_pose --workspace .human_pose/review/posing-workspace-20261009 --output <新stage>` をBlenderの `--background --factory-startup --python-exit-code 1 --python` から実行。
2. `verify_runtime.mjs` に共通models、新stageのposes、全30 IDを渡す。
3. `-m scripts.human_pose.register_curated --root .human_pose --stage <新stage>` で照合し、登録する場合だけ `--publish` を付ける。既存素材と異なるbytesは上書きしない。

3D配置・接地/座面・撮影・節対応の英訳・Qwen送信と実生成評価は未実装/未検証。この区切りの完了をP5全体の完了とは扱わない。既存の未追跡Grok計画6件は変更・commit対象に含めない。
