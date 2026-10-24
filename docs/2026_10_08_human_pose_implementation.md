# 人物ポーズ実装記録

作成日: 2026-10-08

現状（2026-10-10）: 以下は各時点の実装履歴。研究68件と旧6試作は参考・復旧用に保持し、現在の対象は採用30件とする。最新の完了範囲・残項目は[全体計画](2026_10_08_human_pose_plan.md)と[P5](2026_10_08_human_pose_p5_generation_integration.md)を参照。

[全体計画](2026_10_08_human_pose_plan.md)

## 実装方針

- コードのコメントは簡潔な日本語をブロック単位で入れる。新規ファイルは役割ごとに分け、原則400行以内にする。
- 正本で編集・検証する。計画の回復点は `6cb68b3`。元の未追跡Grok計画6件は編集・commitしない。
- 既存の背景ストアはシリーズ単位のGLB/FBX原本、生成ストアはQwenのjob用。人物ポーズcatalogとは対象が異なる。出典取り込みは専用の小さなCLIとし、hash/正規JSONは既存 `generation_store` を使う。アプリのHTTP・生成経路はP5で既存経路を拡張する。

## P1: カタログと共通処理

- 固定revision `5fcb3705e02a2fa7777708e432ac00aa73e43dd1` のMarkdown7件・common.md・LICENSEをhashで検証する。
- 公開HTMLにある68カード・136 WebPだけを取り込む。Markdown見出しのPNG名からURLを推測しない。7分類の件数は12 / 11 / 10 / 10 / 11 / 8 / 6。
- 元の全文は公開HTMLのpromptと68件すべて句読点まで照合する。共通指定を除いた生のポーズ文、正規化後の文、理由を別々に残す。
- 「肩越しに振り返る」は目線を固定せず頭の回転を残す。並列動詞の `and holding` は `and holds` へ直し、理由を保存する。
- 日本語本文・表示名・検索tagを68件分用意する。出典の文は短い一文なので、初期の差分単位は安定ID `body` とする。細分化は文法を壊さない対応が必要になった時に行う。
- 文法表は `scripts/human_pose/data/grammar.json` を共有し、英文のrenderは `humanPoseTemplate.ts` を正本とする。所有格/目的格、単数theyの動詞を分ける。
- 検索はNFKC・英字小文字化、長いphrase優先、概念間のAND。既知語はtag一致を優先し、未知語も条件に残す。「座る 足を組む」は椅子の脚組みとあぐらを返す。「椅子」「あぐら」「足首」で意味を分ける。
- 固定原文、参照hash、ID、日英segment、素材path、確認状態を検証する。再実行で確認メモ・制作状態・座標契約を消さず、本文の変更や既存IDの重複は停止して報告する。
- P2で共通rigを実GLBと照合する検証を追加した。`ready` / 画像参照可には姿勢・一覧絵・利用者確認が必要。素材未制作を文章不可とはしない。

### 保存先と実行

大きな素材と利用者確認記録は正本の `.human_pose/` に保存し、Gitから除外する。元画像136枚、出典、catalog、静的比較HTMLがある。取得した公開画像は変換済みWebPで、生成時の元PNGではない。出典のMIT noticeはローカル素材と、注釈データ配下の `LICENSE` に保持する。

正本から実行する。画像のdecodeには既存のComfyUI Pythonに入っているPillowを使い、新しい環境やpackageは追加していない。

```sh
../ComfyUI/.venv/bin/python -m scripts.human_pose.import_study
../ComfyUI/.venv/bin/python -m scripts.human_pose.validate_catalog
../ComfyUI/.venv/bin/python -m scripts.human_pose.build_review
npm run test:human-pose
```

比較入口は `.human_pose/review/index.html`。fetchやCDNを使わず、元2画像・日英本文・正規化理由・3D制作/利用者確認状態を表示する。直接のローカルURLを開く操作はBrowser UseのURL policyで拒否されたため、ブラウザー上の表示は未検証。HTML構造・画像パスと画像decodeは検証した。

### 検証結果

- 68件・136画像のhash/サイズ/全画素decode、原文全文との対応を確認。
- 実catalogの68件×女性/男性/中性で英文をrenderし、女性は正規化前提文との一致、男性/中性は女性代名詞や未解決tokenが残らないことを確認。
- Pythonの10テスト、検索/英文の4テストに合格。範囲外path、未知token、素材状態の矛盾、重複ID、再実行による確認記録の喪失を含む。
- `npm run verify` に合格。新規コードの型検査に加え、通常/standalone buildを実行。
- 全体テスト中に見つかった既存fixtureの参照漏れを修正。作品情報テストは`.ts`付きimportと画風欄を反映。ペイント画像取込テストは入力中/背景編集の状態を追加。アプリ本体の挙動はこの修正で変えていない。
- このP1時点では3D素材、骨座標、撮影画像のQwen送信、人物欄UIの接続は後続だった。常駐サービスの切替・再起動や画像生成は行っていない。

## P2: 派生素体と再現検証（2026-10-09）

[P2記録](2026_10_08_human_pose_p2_base_model.md)に原本hash・形状監査・近似範囲を記載。既存の実験pipelineは素体の再生成や別の簡略モデルを作る処理だったため起動せず、指定blendの現在の姿をコピーする小さな処理に分けた。各処理を200行以内に分割した。モデルと検査画像はGit管理外の `.human_pose/` に置く。

共通素体が未作成のときだけ `export_base.py --source <指定blend> --output .human_pose/models --review .human_pose/review/base --remove-name <原本の固有名>` をBlender backgroundで実行する。既存のblend/GLBを自動上書きしない。

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python scripts/human_pose/validate_rig.py -- --models .human_pose/models --review .human_pose/review/base/stress
node scripts/human_pose/verify_runtime.mjs .human_pose/models .human_pose/review/base/stress
```

画像を確認してから、Pillowがある既存Pythonで `-m scripts.human_pose.register_base --root .human_pose --source <指定blend> --visual-review-note <確認結果>` を実行する。原本・派生・検証結果のhashを照合し、カタログへ共通rigを登録する。利用者のポーズ確認とは別のagent目視記録であり、ポーズを自動的に確定しない。

Python 15テスト、実素体の4ケース×全頂点でのBlender/Three.js再構築、原本hash、136画像を含むcatalog検証に合格。4ウェイト化による最大18.7mmの変形差は既知の近似として記録した。P3で個別の接触・指の省略を確認する。新しいrig、LLM、環境は追加していない。

## P4: 性別属性の統合（2026-10-09）

独立worktreeで作った16fileを親が全diff確認し、正本へ統合して `6a831ee` に保存した。Node47件、Python12件、Astro313fileのdiagnostics 0を正本で確認。人物の性別は未設定を保持し、生成用rendererだけで中性へ補完する。保存・Markdown・シリーズmergeへ接続済み。実画面・Undo・Qwen送信はP5/P7で続ける。

## P3: 代表6件の試作（2026-10-09）

[P3記録](2026_10_08_human_pose_p3_pilot.md)に姿勢ごとの補完・近似を記載。試作revision 4のpose/一覧PNGをcatalogへ未確認で登録し、元画像2枚と共通素体を比較できる資料を作成した。6件×14,677頂点のThree.js再現誤差は最大0.708µm。利用者の確認待ちで、確定座標・Qwen利用可能とはしていない。

P1/P2の境界を再利用し、初回登録・同一bytesでの再実行・runtime検証hashの照合を小さな処理に分けた。新規の制作scriptはすべて160行未満、日本語のブロックコメントを付けた。原本、共通base、旧試作は保持した。

## P5: 読込部分の先行統合（2026-10-09）

素材の採否に依存しない[読込store](2026_10_09_human_pose_store.md)を `a49f6e5` へ保存。独立worktreeの全差分を親がreviewして正本へ統合し、関連Python35件と実試作6件の読込を確認した。既存のファイル境界処理・catalog検証を再利用している。HTTP/UI/Qwenへの接続は未実施。独立worktreeのコード差分は正本へ回収済みで、作業コピーは保持している。


## 追加指定: 多面図、体勢の鏡反転、節比較（2026-10-09）

P3の旧確認依頼に対し利用者が修正を指定。Krea5件・Qwen仰向け1件の元画像から内蔵image_genで多面図を生成し、代表姿勢を再調整した。この時点の未確認候補は `.human_pose/review/pilot-09/`。比較資料は同folderの `比較.md`、生成指示は `../multiview-01/prompts.json`。生成図の角度間不整合と補完を記録し、素体形状・元画像・登録済みrevision 4を保持した。詳細はP3記録。

体勢だけの鏡反転は `humanPoseMirror.ts` に実装し、顔/表情boneの世界方向を保持する。節比較は隔離workerの新規3fileを全reviewして正本へ統合した。`,` / `、` の各節で比較し、一部編集時に未変更の節を失わない。英文の節対応・LLM送信はP5に残す。

利用者の「UIは計画側に入れてね」に従い、左右サイドクリックと保存・撮影への接続はP5計画へ記載した。今回の変更でUIやHTTPを実装したとは扱わない。Node20件、Python36件、Astro318 filesのdiagnostics 0。実6姿勢のBlender往復最大0.839µm、Three.js最大0.701µm、鏡反転往復最大0.365µm。新規moduleはすべて400行未満。素材・比較出力はGit管理外の `.human_pose/` に保存している。

## P3関節の方向の再修正（2026-10-09）

revision 9への利用者の不一致指摘を受け、既存rig処理で膝・肘の屈曲面と掌の面を指定し、手指・肘の左右差・しゃがみの足先を再調整。この時点の候補は `.human_pose/review/pilot-15/`。座位と壁の指の腿への入り込みは距離診断で検出し修正した。仰向けは真上比較も追加。

正面・側面・斜めと元画像を見比べ、独立レビューの指摘も反映した。Python36件と6姿勢のBlender/Three.js復元を確認。共通baseと登録済みデータは保持。膝表面のえぐれ、手の重なり・握り等は未解決で、P3の素材完成・利用者確認・採用は未完了。最新状態と比較資料はP3記録に集約する。

## P3の編集用ファイル引渡し（2026-10-09）

立位・寄りかかりの足位置を再配置し、支柱の右腕・手をrevision 9へ戻した。座位・しゃがみ・仰向けは利用者が直す指定のため、revision 15とroot・全骨・支持物・接触を一致で保持。候補revision 18の6件を、既存build処理の `--editable` から別blendへ保存した。

全6blendを再度開き、ポーズモードと頂点の一致を確認。外部library依存なし、共通base不変。Python36件、Three.js復元、支柱の旧TRS一致・他3姿勢の不変を検証。`.human_pose/review/pilot-18/編集用リンク.md` にBlender・画像・姿勢データ・元画像へのリンクを集約。利用者の手直しと採用確認は未完了で、catalogへ昇格していない。


## P5: 採用30件と選択・保存UI（2026-10-09、限定範囲を検証済み）

利用者が配布pose30件と手直し17/23を選び、11件14画像のプロンプト検証後に次工程を了承した。採用の元番号を維持して日英本文と出典を固定し、既存catalog validator/storeをschema 2へ拡張した。研究用68件はschema 1のまま保持し、登録時は旧catalogをhash付きで退避する。

人物とページ上人物に共通のポーズ選択画面を追加。仮選択・取消・確定、日本語編集、基準文保持を既存Figure/Undo/保存経路へ接続し、コマ合体で異なる編集文が落ちないようにした。生成送信は後続なので、ポーズが指定された人物のQwen生成・コマ下絵生成は説明付きで止める。

利用者のコードレビュー了承後、Node80件/Python41件、Astro型検査、通常/単一HTMLビルド、30件×14,677頂点のBlender/Three照合を実施した。最大差2.43µm、元PNG byte一致、旧catalog退避と既存163ファイル保持を確認してcatalogを切り替えた。実画面で選択・検索・取消・編集・Undo/Redo・自動保存再読込、ページ前景のOMNY往復を確認。bridge自動起動は既存経路を再利用した。利用者のBlender画面と既存4322プロセスは保持し、正本の4323画面で検証。回復点は `79b3eea43904cd23dc346fc0f35af798c9b43808`。詳細は[限定実装記録](2026_10_09_human_pose_curated_integration.md)。

## P5: 猫の一覧絵・3D配置と撮影（2026-10-10）

一覧・仮選択詳細を猫イラスト30枚へ変更し、正面顔22枚は利用者指定で少し左右へ逸らした。元3D・登録PNG・本文は保持。[表示画像の記録](2026_10_09_human_pose_cat_previews.md)を参照。

共通素体へ登録姿勢を適用する3Dウィンドウ、位置/yaw、camera、日英の撮影説明、透過PNGプレビュー、設定の作品保存を `fe2bd2b` に保存。関連Node36件/Python19件、型検査、通常/単一HTMLbuild、実素材30件の全頂点照合を通過し、代表3姿勢・保存再読込・取消・Undo/Redoを実画面で確認した。[実装と検証記録](2026_10_10_human_pose_scene_editor.md)を参照。PNGのjob保存・接地・生成送信とP5全体は未完了。

## 計画の整合（2026-10-10）

全体計画とP1〜P7を、採用30件・旧試作の履歴化・猫の一覧絵・P6登録の前倒し・撮影プレビューの完了へ揃えた。過去の68件を対象にした検証数は改変せず、現行30件の検証と区別した。次の実装区切りは、既存 `mirrorHumanPoseBody` の画面・保存・撮影への接続。P5完了後に生成適合を評価し、P7で全体検証を行う。
