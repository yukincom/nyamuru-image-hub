# 2026-10-29〜30 女性モデルの試用

利用者指定の `KneeElbow IK Rig for BodyChanBodyKun.blend` から、女性側のBodyChanだけを人体ポーズ編集へ追加した。3D画面下の「表示モデル」で「軽量表示」「女性モデル」を切り替える。選択はdialog内のdraftへ反映し、「確定」で既存の人物保存経路へ渡す。取消は作品を変えない。

## 素材

- 元ファイルはDesktopに保持。SHA256: `5c0f59db5f9e9607f619259c1f4baf3f9e1ca6372dc6d3b0e6383f7652cf4789`。
- `scripts/human_pose/export_bodychan.py` はファイル内スクリプトを無効にして読み、女性の25部品のrest形状を抽出する。Mirrorを評価し、元の形状と体形を保って1meshへまとめる。男性・ハイヒール・小道具・widget・埋込スクリプトは派生素材へ入れない。
- 表示用は `.human_pose/models/bodychan_female.glb`（916,556 bytes）。ミラー展開後15,508頂点・15,959面、単色灰色の材質1個、テクスチャなし。編集用blend・rig JSON・変換元hash/対応表のmetadataも同じ場所へ実体として配置する。元のhuman_base 4filesとcatalogは変更しない。
- 元のRigify制御rigはブラウザーへ移さない。女性側の関節位置を保った163骨へ既存の操作用の骨名を対応させ、skin weightを接続する。GLBは既存runtimeと同じ上位4weightの正規化を使う。Blender固有のIK UIや全制御骨が使えるという意味ではない。
- 専用Blenderプロセスをfactory startupで実行し、通常のBlender設定・拡張を変更しない。派生ファイルが既にある場合、変換scriptは上書きを拒否する。

## 既存経路への接続

`/api/human-pose/scene` に任意の固定ID `body_model: "bodychan-female"` を追加した。新endpoint・別のcatalog・公開import経路は作っていない。モデルとrigは、既存の固定path/通常file/symlink拒否/容量制限を通して読み、metadataのreference rig、サイズ、SHA256、GLB形式を照合する。表示素材を別fieldに持ち、元ポーズの `source` は維持する。

`HumanPoseMotionRetarget` の同じ部位対応とworld回転補正を使い、登録ポーズと既存17モーションを女性側の骨格へ移す。手首・肘・指先などの編集は既存のIK/関節処理を使う。モデル切替時は、明示的に編集した関節の回転差分だけを新baselineへ移し、非編集の補助骨に編集値を増やさない。腰の編集量は骨格の長さに合わせる。足の曲げは既存の足の基準点からnative toe骨の位置・回転を作り、面へ反映する。

同じcanvasを保ち、切替前の頭のworld位置へ人物全体を補正する。カメラ・撮影枠・切り取り・一覧scroll・背景を保つ。Undo/Redoはモデルを含むsceneを復元し、生成参照の再撮影も保存されたモデルを読む。省略時の軽量表示はGLBを転送・読込しない。

## 確認

- 関連Node55件成功。表示応答の指定ID/hash/GLB/rig対応、無編集時の編集値抑止、骨格間での編集往復、元入力と他の手の保持、従来のcamera/framing/IKを確認。
- Pillow入りの既存Pythonで素材Store22件成功。表示素材の固定ID/path/hash/サイズ・欠損・symlink拒否と、モデル省略時のcatalog/base不変を確認。合成素材でのAPI境界検証。
- 対象12 TypeScript filesと依存を含むstrict型検査0診断、diff check成功。
- インストール済みの実GLBと実FigureHumanPoseEditorを使うbrowser40項目成功。モデル交換時の同一canvas・頭位置・camera/framing/source不変、無編集のモデル往復PNG完全一致、左指/足先の実メッシュ変化、非対象の手首/右指不変、編集/モデル/姿勢のUndo・RedoでPNG完全一致、座り姿、motion時点、確定/取消、OMNY往復、再読込と生成参照再撮影でPNG完全一致を確認。作品とAPIはfixture。実作品のディスク保存・生成モデル実行は含まない。
- 軽量表示の既存ポーズ切替browser31項目も成功。error/warnログは空。
- 実マウスで左手首を動かし、腕と実メッシュの追従を確認。関節へ近づく＋ホイール拡大後に左人差指の先を掴み、指節と実メッシュの変化を画面で確認した。
- 読取レビューで見つかった「モデル往復時に補助骨の回転が失われる」「足曲げが面に反映されない」を修正し、再確認済み。反転あり/なしで編集往復、足曲げ解除で実GLB全頂点の元値への一致を確認した。
- 通常起動のsupervisor（56610/8786）からleaseを取得し、正本の `.local-vision/.venv/bin/python scripts/nyamuru_local_bridge.py --port 8787`（81590、cwd正本）で実scene APIを確認。女性GLBのID/916,556bytesと元source保持を確認し、lease解除で終了。81590の終了と8787待受解放を確認。

## 状態

前の頭位置修正11filesを、今回の変更前にlocal checkpoint `f1bcdc6` へ保存した。女性モデルの変更は未commit、`.human_pose/` の4派生素材は既存のGit除外に従う。既存の未追跡資料は保持。全件テスト・buildは利用者の画面確認後。push・公開なし。

検証用4339/PID68921・tab43を終了し、PID終了と待受解放を確認した。利用者指定で継続中の通常4321/8786・PID56610は保持する。


## 導入と配布範囲

女性モデルを使う場合は、利用可能な元の `KneeElbow IK Rig for BodyChanBodyKun.blend` とBlenderを用意し、標準の人体素材をセットアップした後、プロジェクトのルートから次を実行する。

```sh
blender --background --factory-startup --python scripts/human_pose/export_bodychan.py -- --source "/path/to/KneeElbow IK Rig for BodyChanBodyKun.blend" --root .human_pose
```

変換スクリプトは既存素材を上書きしない。生成先の4ファイルを保持したままアプリを起動すると、3D編集の「女性モデル」を使用できる。元ファイルの配布元URL・再配布条件は記録から確認できていないため、元blendと派生GLB・rig・metadata・編集用blendはリポジトリに同梱しない。手元で導入済みの素材はそのまま使用する。標準の軽量表示は女性モデル素材に依存しない。

2026-10-31の公開前確認でも、導入済みの実GLBを用いた女性モデル40項目と標準ポーズ切替31項目が成功。生成画像のAPIと作品は検証用で、実Qwenの推論は行っていない。素材4ファイルはmetadataのサイズとSHA-256に一致し、変更していない。
