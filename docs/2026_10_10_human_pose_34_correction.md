# 34番の姿勢照合と修正（2026-10-10）

34番 `pose-mh-milkman-sit-01a` の猫の見本と説明を、元3Dの姿勢に合わせた。利用者の「イラストの印象と随分違う」という指摘と「ちと直して」の依頼による修正。

## 修正内容

- 表示名: **足先を寄せて腰かける**。
- 説明: 縁に浅く腰かけ、膝を開いて足先を寄せる。腰と肩を少し傾け、片手を膝付近に添え、もう片方の手をももの外側へ下ろす。
- 英文: sitting shallowly on an edge, knees apart and feet close together, pelvis and shoulders slightly tilted, one hand near a knee and the other lowered outside the opposite thigh
- 猫の見本: 膝の間隔、寄せた足先、腰・肩の傾き、左右で異なる手の位置を反映。

元3Dでは膝が開き、足先が寄っていた。旧説明は「脚をそろえる」、旧イラストは直立に近い上体とそろった膝だった。旧見本は説明文から生成しており、この違いを拾えていなかった。今回は元3DのPNGを直接参照し、built-in imagegenで猫の見本を編集した。

## 反映先と保全

- `scripts/human_pose/data/curated-seated.json` の34番の表示名・日英文・検索語・照合メモ。
- `.human_pose/catalog.json` は既存 `prompt_fields` の項目生成と `validate_catalog` を使用し、34番の同じ項目だけを更新。カタログ全体のSHA-256で改訂を識別する。
- `src/assets/human-pose-cat/34.webp` を可逆WebPへ変換して差し替え。
- 元の3D、BVH、登録済み3Dプレビュー、出典マニフェスト、出典情報と `original_gemini_prompt` は保持。出典内の旧名は来歴として残す。
- 別の29件のカタログ項目と猫画像は変更しない。

保存済みの作品にあるポーズ名・編集文・基準文は自動更新しない。カタログのSHA-256が変わるため、以前の版を選択済みの人物で3D編集を開く場合は、既存の案内に従ってポーズ指定を解除して選び直す必要がある。編集中の文や撮影設定があれば、解除前に控える。同じポーズを再確定するだけでは保存文を置換しない既存動作を維持した。

## 生成資料

プロジェクト内の `.human_pose/review/pose34-correction-20261010/` に、修正前のカタログ・定義・WebP、生成PNG、`prompt.txt`、ハッシュと照合結果の `validation.json` を保存。

画像生成の入力は既存の猫 `src/assets/human-pose-cat/34.webp` と、元3Dの `.human_pose/review/posing-workspace-20261009/ポーズPNG/34.png`。prompt全文は上記 `prompt.txt`。生成結果のPNGと配信用WebPは同一画素であることを確認した。

## 確認

- 実カタログの `validate_catalog` と `HumanPoseStore.catalog()` が成功、30件を確認。
- 既存 `tests.test_human_pose_curated` は5件成功。新しい試験コードは追加していない。
- 元3D素材のhashと、別の29件のカタログ項目・猫画像の不変を確認。
- Chromeの通常画面 `4321` で34番の検索・仮選択、新しい見本・名前・説明の表示を確認。ポーズを確定せず一覧を閉じ、作品データは変更していない。画面は `ui-corrected.jpg` と `ui-dialog.jpg` に保存。
- `git diff --check` 成功。

先行するカメラ操作・送り方UIの検証は別の作業として扱う。今回は素材と文面の修正に絞り、repository全テスト・buildは実行していない。
