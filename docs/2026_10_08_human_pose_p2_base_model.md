# P2: 指定素体の完成・汎用素材化

作成日: 2026-10-08 / 整合更新: 2026-10-10 / 状態: 派生素体・座標契約・基本可動検証済み。採用30件の全頂点照合も完了。姿勢別の接触登録・接地補助と生成への適合はP5/P6で継続

[全体計画](2026_10_08_human_pose_plan.md) / 前提: [P1](2026_10_08_human_pose_p1_catalog.md)の素材契約 / 後続: [P3](2026_10_08_human_pose_p3_pilot.md)

現行の制作・登録対象は[P6の採用30件](2026_10_08_human_pose_p6_pose_assets.md)。P3の手作り6件は試作履歴として保持する。[Blender作業台](2026_10_09_human_pose_posing_workspace.md)のIK/helperと、runtimeが使う共通163骨は区別する。支持物・接触点は現行30件すべて未登録で、床や座面への自動配置が検証済みという意味ではない。以下の制作手順と初回検証値は当時の記録として保持する。

## 目的と原本

利用者が手作業で調整した素体を、その現在の形状から完成させる。ミラー後で止まっている状態を実ファイルで点検し、保存した大まかな姿勢を適用できる共通素体として `.human_pose/models/human_base.blend` に保存する。初期アプリに自由な関節編集UIを作ることはP2の成果物に含めない。

入力元は利用者が指定した次のフォルダ。このpathは原本を特定するための記録であり、派生素材の名称には使用しない。

`../tori29umai-pose-pipeline-experiment/outputs/body-prototype/koyuki-5_7-heads`

同フォルダのrigged `.blend` が作業開始候補。`.blend1` は復旧候補として保持し、自動的に優先しない。設定JSONにはMPFB 2.0.17、5.7頭身、19,158 vertices、49 shape keys、163 bones等の過去の記録があるが、現在の `.blend` と同一とは未確認。JSONから作り直すと後からの手作業を失うため、再生成の入力にしない。

## 作業開始時の監査

1. 原本の一覧、更新時刻、サイズ、SHA-256を記録する。現在開かれているBlenderに未保存作業がある場合は、その状態を保持して作業対象を確定する。
2. 原本を派生先へコピーし、以後は派生先だけを編集する。原本と `.blend1` の上書き、削除、自動修復はしない。
3. 使用するBlenderの実pathとversionを記録する。既存環境・既存addonを調べ、不要な再インストールやMPFB本体の再取得をしない。
4. Mesh / Armature / modifier順序 / Mirror設定 / shape keys / vertex groups / constraints / drivers / actions / 外部参照を列挙する。見た目の基準として正面・側面・背面・斜めを保存する。
5. 利用者の「ミラーの後で止まっている」と実際のmodifier状態を照合する。Mirrorが残っている場合と適用済みの場合を区別する。

## 完成に向けた作業

### 1. ミラーと形状を確認する

- 中心線の重複頂点、隙間、法線、左右の継ぎ目、意図しない非対称を調べる。意図した体形を「対称化」の名目で変えない。
- shape keysとArmatureがあるmeshに対し、Mirror適用や頂点変更を無条件に行わない。vertex数・順序・shape keysとの互換性を点検し、必要なら作業copyで結果を比較する。
- modifierを残したまま編集用 `.blend` を保持し、評価済みmeshをGLBへ出す構成も選択肢にする。「素材として使える」ために原本の編集可能性を捨てない。
- 残っている具体的な欠陥と修正内容をmetadataへ記録する。記録が示す旧体形へ戻さない。

### 2. Rigと変形を安定させる

- 既存rig、左右bone名、finger bone、root、rest pose、bone roll、weightを確認する。利用可能なrigを新規rigで置き換えない。
- 肩上げ、肘曲げ、前腕ひねり、手首、股関節、深い膝曲げ、足首を動かし、潰れ・裂け・過剰な伸びを調整する。
- 接触ポーズ用に必要な範囲でIK/controlを整える。追加constraintの依存と焼き込み手順を記録し、Blender上のcontrolだけで成立する出力にしない。
- finger制御の利用可否を確認する。初期素材で省略する細かな指の形は記録し、原文の精細な動作を3Dで再現済みと扱わない。大きな腕・脚・接触の確認と、指先の精度を分ける。
- 接地用の足裏、座位用のお尻の接触基準点、身体の正面を定義する。骨の原点が足裏や座面と一致するとは限らないため、体形と適用poseに応じたoffsetを検証する。服・髪を含む全体bboxの下端を足裏の代わりにしない。

### 3. 汎用名と自立した素材にする

- ファイル、collection、object、mesh data、armature data、material、action、shape key、custom propertyの名称を確認し、固有キャラクター名を汎用名へ変更する。
- 基本名は `human_base`、`human_rig`、`human_material`。左右・部位を示す既存bone名は意味を保持し、固有名を含む箇所だけ安全に変更する。
- 名称に依存するdriver、constraint、vertex group、animation data pathを同時に更新し、変形が壊れていないことを確認する。`.blend` binaryの文字列一括置換はしない。
- 不要な外部画像や実験folderへの参照を外し、必要な依存だけを派生先に同梱する。runtimeから原本folderや `.codex` のpathを参照しない。
- 無彩色・低光沢の材質に統一し、髪型、服装、顔の描画など本人性を連想させる情報をガイドに足さない。利用者の調整した体形は保持する。

### 4. 書出しcontractを固定する

| 項目 | 決める内容 |
|---|---|
| 単位・軸 | BlenderとglTFの軸変換、meter等の単位、床面、身体の正面 |
| 原点 | rootと床の関係、姿勢変更時の平行移動 |
| 接触基準 | 左右足裏、支持脚、座位の接触点、身体の正面。poseごとの有効な基準とoffset |
| Rig signature | bone名・親・rest transformから得る識別子 |
| Pose transform | rest pose基準のlocal transform、rotationはquaternion等の明示形式 |
| カメラ | 比較用と作品撮影用を分離。position / target / up / projection / FOV・aspect・frame・shift等。初期実装可能範囲はP5で決める |
| 書出し | `.blend` は編集用、共通のskinned GLBは読込・姿勢適用用。各姿勢GLBは任意の評価済みキャッシュ |
| 出自 | 原本hash、base revision、作業内容、使用tool、利用条件の根拠 |

MPFBのprogram licenseと生成したmesh・同梱assetの条件を分けて確認する。元設定の「core asset CC0」という記録だけで、全外部素材の条件を一括決定しない。新たな第三者assetがないことも確認する。

## 編集候補

- `.human_pose/models/human_base.blend`、`human_base.glb`、`human_base.metadata.json`。
- 必要な場合のみ `scripts/human_pose/inspect_base.py`、`export_base.py`、`validate_rig.py`。既存実験の `pipeline/` を読み、再利用できる処理を機能単位で取り込む。古い生成pipeline全体は起動しない。
- P1のschemaへ確定した座標系とrig契約を反映する場合、先にclaimを調整する。

## 検証と完了条件

- 原本のhashが作業前後で不変。派生 `.blend` は再度開ける。
- 正面・側面・背面・斜めで利用者の体形調整が保持され、ミラー部分に意図しない継ぎ目がない。
- 基本の関節可動と深い曲げを画像で確認し、気になる変形を部位ごとに記録する。
- GLBを実際に読み込み、単位、向き、接地、材質、法線を確認する。ファイル生成成功だけで合格にしない。
- 共通GLBにskin・bone・rest transformが保持され、pose.jsonから大まかな姿勢を再現できる。立位・座位で接触基準点の位置を確認する。
- 新しい素材のfile名・内部label・pathに元の固有名がなく、renaming後もrig・driverが動く。
- 原本folderを読みに行かずに派生 `.blend` とGLBを使える。
- P3へbase hash、rig signature、control一覧、座標系、既知の可動限界、標準書出し手順を渡す。

## 2026-10-09 実施結果

この節は初回派生時の記録。後の利用者依頼で元koyukiと共通blendの編集設定を修正した。現在の原本hash・backup・接続設定は[ポーズ編集用リグの操作修正](2026_10_09_human_pose_editable_rig.md)を参照。163骨・rest・ウェイト・shape keysを保持し、GLBとrig契約は変更していない。

- 原本SHA-256は `da99e95bbc7fc0f801f2689742adf845de8475cf25f4d193de0ee4a143973cad`。派生保存・検証後も不変。`.blend1` は保持した。
- Blender 5.2.1 LTSのbackground処理だけを使った。新しい環境・addon・第三者assetは追加していない。常駐サービスや既存Blenderの作業状態は変更していない。
- 実原本は19,158頂点、49 shape keys、163 bones。Mirror modifierはなく、Armature→helper Maskの順。全boneのpose basisはidentity。constraint、driver、animation action、外部library・textureはなかった。
- 汎用名への変更前後で、全shape keyの値と座標hash、評価後の形状hashが一致した。表示meshは13,524頂点・13,518面、境界edge / 非多様体edge / 面積0の面は各0。形状の対称化や頂点変更はしていない。
- `.human_pose/models/human_base.blend` に編集用の全shape keysとウェイトを保持した。`.glb` は現在の体形とhelper除外を固定したskin付き素材で、14,677頂点・27,036三角形・163 bones。名前・材質を汎用化し、原本folderへのruntime依存はない。
- 現Three.jsは4ウェイトまで使うため、GLBは上位4本を正規化する。初回の8ウェイト書出しは検査履歴へ退避した。編集用blendは元ウェイトを保持する。静止時の形状差は約0.12µm、検査姿勢での最大変形差は腕18.69mm・座位10.73mm・深い膝曲げ12.44mm。この近似は各姿勢の見た目でも確認する。
- 原姿勢4方向と、腕上げ・肘曲げ・前腕ひねり・手首・座位・深い膝曲げを撮影した。破れや中心線の隙間は見られない。肩・股関節の強い曲げの表面は近似であり、精密な解剖学的変形や任意の姿勢を保証しない。
- rig signatureは `7012b2a35983378266d455bb747a88d8b21cb241ed48aea17807783db5e8a68a`。姿勢JSON→Blenderの最大往復誤差は約0.92µm、同じJSON→実GLTFLoaderの全頂点比較は最大約0.73µm。
- 素材条件は同梱basemeshとdefault weightsのCC0記載、および[公式core asset license](https://static.makehumancommunity.org/about/license.html)を照合した。MPFBのprogram licenseとは分け、新たな外部assetは含めていない。

### 固定した座標と残る接触検査

単位はm。Blenderの `(x, y, z)` をglTFの `(x, z, -y)` へ変換し、Y=0を床、+Zを身体の正面とする。人物全体の配置用 `human_rig` と、腰付近にあるbone `root` を区別する。素体の高さは1.36353254mで、利用者の体形を拡縮していない。

保存するbone TRSはrest差分ではなく、親に対する完全なlocal値。rotationはxyzw quaternion。全163 boneを含め、別のポーズの値が残らないようにする。Blender exporterはboneのlocal軸を保持するため、最上位boneだけ世界軸変換を反映する。この点は単純なXYZ入替えだけで処理せず、実GLBと照合した。

左右足裏は評価後の足・toeウェイト領域から求める。検査の立位・座位では両足の最低点を床へ合わせた。座面のお尻、壁・取っ手、支持脚の意味は各姿勢で異なるため、P3で接触面とともに決める。追加IK constraintは必要になっておらず、現在はFKの大きな姿勢を保存する。finger bonesは存在するが、P3/P6で個別に作成していない指形を再現済みとは扱わない。

再制作と検証の入口は `scripts/human_pose/export_base.py`、`validate_rig.py`、`verify_runtime.mjs`、`register_base.py`。[実装記録](2026_10_08_human_pose_implementation.md)に実行方法を記載する。比較画像と数値結果は `.human_pose/review/base/`、rig契約は `models/human_base.rig.json` にある。登録はポーズの利用者確認flagを変更しない。
