# モーションサポーター（2026-10-11）

人物の「3D配置・撮影を調整」内で、動きを選び、0〜100%のスライダーで姿勢を止め、既存のマーカー・関節角度・カメラで微調整する。再生は繰り返し、一時停止・手動操作・画面外への移動・閉じる操作で停止する。確定時の時点と微調整をOMNYへ保存し、再び開いた際は停止状態で復元する。

## 収録範囲

Quaterniusの無料 [Universal Animation Library Standard](https://quaternius.itch.io/universal-animation-library) のCC0素材から、利用者が選んだ系統の17本を収録。

| 系統 | 収録clip |
| --- | --- |
| 走る | Jog_Fwd_Loop、Sprint_Loop |
| 歩く | Walk_Loop、Walk_Formal_Loop |
| しゃがむ | Crouch_Fwd_Loop、Crouch_Idle_Loop |
| 座る | Sitting_Enter、Sitting_Idle_Loop、Sitting_Exit |
| パンチ | Punch_Jab、Punch_Cross |
| 転がる | Roll |
| 泳ぐ | Swim_Fwd_Loop、Swim_Idle_Loop |
| 剣 | Sword_Attack、Sword_Idle |
| 倒れる | Death01 |

Sitting_Talking_Loopは除外。移動量を二重に持つ`_RM`版は重複収録しない。単発のパンチ・前転・倒れる動作も末尾までスライダーで選択でき、100%は最終姿勢を保持する。再生時は先頭に戻るため、単発動作の継ぎ目は連続とは限らない。剣の小道具や座る椅子はこのデータに含まない。

Library 2は無料版の取得を試したが、配布画面からの取得が完了せず未収録。有料Source版・CMU素材は導入していない。

## 保存と操作

- 既存`human_pose.scene`へ`motion: {version, library_sha256, clip_id, phase}`を追加。元ポーズの識別・説明文・左右反転・身長・配置・背景・カメラを引き継ぐ。
- 既存`joint_edits`を継続利用。同じclipの時点変更では関節の相対回転と腰オフセットを維持する。足板は制限前の相対角を`motion_foot_offsets`に保持し、制限に当たる時点を往復しても微調整を失わない。その足を手動で再編集した場合だけ補正を更新する。
- 別の動き、または「登録ポーズを使う」への切替は微調整をリセットする。「微調整を戻す」は現在の動き・時点を維持する。
- スライダーの1ドラッグ／1キー操作と、再生から停止までを、それぞれUndo 1回にまとめる。左右反転中の操作は既存の正規座標へ戻して保存する。
- モーション使用中は登録ポーズ付属の台・椅子を非表示にする。撮影は既存の透過PNG・背景同時撮影を使用する。説明文の自動書換えと画像生成への接続は行わない。
- 素材の版・骨格が一致しない保存値は別の姿勢へ黙って置き換えず、読み込みエラーとして表示する。

## 素材と再生成

取得原本はGit対象外の`.human_pose/motions/quaternius/`へ保存。原本の人体モデルを製品へ追加せず、63骨の回転と腰の移動・足指角度を30fpsへ変換して同梱する。骨格の基準角度差を解剖学的な部位方向から補正し、分割された上腕・大腿などに同じ世界回転を適用する。骨の長さと親子関係は対象人体の値を保持する。

- 元zip SHA-256: `cc73fc4e495b82958207316596317a3f40b9fa38065bde1027937452da537724`
- 元GLB SHA-256: `69591853d817488edaa8fd9bf8fc1d821eaeaf789f8627b3cd23b41c4ed67997`
- 同梱JSON: 579,304 bytes、gzip 222,415 bytes。ライセンスと元clip情報は同じassetフォルダの`LICENSE.txt`・`provenance.json`に保存。
- 回転はInt16 quaternionを正規化してslerp、腰はFloat32を線形補間。つま先の付け根は0.01度単位。モーション内の足指上げを保つため、手動操作の負側範囲を−65度まで許容する。
- 床補正は圧縮後の実再生補間を240fps相当で測り、頭球・足板端を含めた最下点からclipごとの固定オフセットを作る。0.5mmの余裕を加え、フレームごとの上下動を潰さない。泳ぎは全体の高さ中央を0.7mへ配置する。接地足の固定・全身衝突・動力学による重心補正は含まない。

再生成（原本と対象rigが必要、ネットワーク・Blender不要）:

```sh
node --experimental-strip-types scripts/human_pose/build_motion_library.mjs
```

引数でGLB・rig・出力JSONの順に別pathを指定できる。同一入力からbyte一致を確認。起動時の外部通信はなく、同梱素材を3D画面で読み込む。既存catalog・登録pose・人体GLB・blendは変更しない。

## 検証

- 自動試験: 全17clipの端点・補間・正規化・時点保存、単発最終姿勢、相対微調整、足の制限往復、異常値・未知版拒否、コマとページ前景のOMNY往復。
- 実人体の17clip × 241時点で手足の長さ誤差は最大約0.000000534m。左右反転と手首IK後の保存往復誤差は最大約0.0000000000000015m。泳ぎを除く最下点は床上0.234mm以上。
- 独立の読み取りレビューと実UI検証を実施。一時停止時のフォーカス競合、スライダーUndoの分裂、圧縮後の床補正、足角度の制限往復を修正・再検証。
- 実UIで全17clipを選択し、50%の姿勢を透過PNGへ撮影。全画像が512×1024・透明部分と描画部分を持つことを確認し、一覧画像と座位の側面画像を目視確認した。
- 実UIのドラッグ→Undo 1回、停止姿勢の手首マーカー操作を確認。Jog 45%・手首の角度調整・体勢の左右反転・カメラを確定し、OMNYへ保存→再読込→3D再表示を確認。保存前後の`human_pose`も同値。
- `npm run verify`成功。Astro 340 filesでerror/warningなし、Node 888件中885成功・3 skip、Python bridge 337件（39 skip）・doctor 18件（1 skip）・human-pose 45件（21 skip）、通常版・単一HTML版のbuild成功。localhostの待受を使う試験は承認済みの制限外実行で確認した。
- 確認用資料は`.human_pose/review/motion-supporter-20261011/`（`verify.log`、`numerical-verification.json`、`ui-capture-checks.json`、`motion-capture-contact-sheet.png`、`motion-supporter-final.png`、`final-edited-motion-figure.json`、`saved-motion.omny.yaml`）。利用者の作品・自動保存領域とは分離している。
