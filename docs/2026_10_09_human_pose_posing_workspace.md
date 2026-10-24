# 人体ポーズ作業台と無料配布ポーズの選定（2026-10-09）

成果物: 使い方・編集リンク（ローカル資料 `.human_pose/review/posing-workspace-20261009/編集用リンク.md`、配布対象外） / 作業台.blend（ローカル資料 `.human_pose/review/posing-workspace-20261009/ready/ポーズ作業台.blend`、配布対象外） / 一覧画像（ローカル資料 `.human_pose/review/posing-workspace-20261009/ready/ポーズ一覧.jpg`、配布対象外）

## 納品範囲

既存の共通素体のコピーに、MPFB標準Arm/Leg/Finger HelpersとBlender標準ポーズライブラリを組み合わせた。手作りの旧6姿勢・手ポーズは収録せず、無料配布の既存30ポーズを変換した。初期化1件を加え、保存ファイル内のアセットは31件。下部アセットブラウザーを「現在のファイル」に設定し、全身が見える画面配置で保存した。通常のBlender 5.2.1で操作でき、利用時のMPFB導入は不要。

元の163骨のrest matrix・親子関係・変形設定・mesh座標・ウェイトを保持し、非変形の操作骨20本を追加。手足は非伸縮IK、肘膝の位置制御、4本指一括／指別の曲げ、左右反転、初期化を使用できる。親指は一括握りから独立。MPFB標準IK制限は保持し、首・背骨・指等へ操作用の回転制限を追加した。

制限値は医学的な可動域保証でも衝突検知でもない。無理な位置へIKを動かしても完全追従するわけではない。素材の姿勢を体格・小物に合わせて調整するための作業台であり、接触や関節の自然さの最終判断は各カットで必要。

旧standing/poleを含む6姿勢、共通素体、元koyukiの8原本は開始時にhash付きコピーを保存し、原本は変更していない。旧姿勢の外見の自然さを保証するものではない。途中試作の各フォルダーと `*-authored-probe.json` は最終版ではなく、納品対象は `ready/` のみ。

## ライセンス確認

一次資料はMakeHuman Communityの配布表、配布ZIP内 `packs/*.json`、各BVHに同梱された `.meta`。2026-10-09確認。

| 配布パック | 採用数 | 根拠 |
|---|---:|---|
| MakeHuman system poses | 7 | [公式配布表](https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_poses.html) |
| Sitting poses 01 | 8 | [公式配布表](https://static.makehumancommunity.org/assets/assetpacks/poses01.html) |
| Standing poses 03 | 15 | [公式配布表](https://static.makehumancommunity.org/assets/assetpacks/poses03.html) |

確認した3パックは合計71件。採用30件、ライセンス表記の食い違いによる除外14件と派生1件、用途選定による見送り26件。後者には格闘・飛行・体操のほか、立ち／座りの別案も含み、ライセンス不一致を理由に外したものではない。

採用30件は配布表とpack catalogがCC0。22件は同梱metaのCC0/CC-0表記とも一致。7件はmeta自体がなく、1件はmetaにlicense欄がないため、一次配布表とpack catalogを根拠とした。未記載と明示的な矛盾は区別した。全BVHのSHA-256・作者・出典・確認根拠は selected-presets.json（ローカル資料 `.human_pose/review/posing-workspace-20261009/selected-presets.json`、配布対象外） に保存し、Blenderアセットの説明にも作者・出典・CC0を記載した。

[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)は商用利用・改変・再配布を認める。[MakeHumanの公式ライセンス説明](https://static.makehumancommunity.org/about/license.html)も標準assetsのCC0を説明する。配布catalog内の旧サイト個別投稿URLは今回ライブ取得できず、個別投稿本文までは再確認できていない。

配布表がCC0でもmetaにCC-byとある次の14件、およびその派生1件は今回のライブラリから除外した。CC-byのversion不明をCC0と読み替えていない。

- `callharvey3d_lotus`: 配布表CC0 / 同梱meta CC-by。
- `callharvey3d_sittingdefault`: 配布表CC0 / 同梱meta CC-by。
- `callharvey3d_sittingfloor2`: 配布表CC0 / 同梱meta CC-by。
- `callharvey3d_sittingfloorstretch2`: 配布表CC0 / 同梱meta CC-by。
- `callharvey3d_sittinglegscrossed`: 配布表CC0 / 同梱meta CC-by。
- `callharvey3d_sittingnatural`: 配布表CC0 / 同梱meta CC-by。
- `xhado84_sitting_floor_3`: 派生元 sittingfloor2 の表記不一致。
- `callharvey3d_curious`: 配布表CC0 / 同梱meta CC-by。
- `callharvey3d_salute`: 配布表CC0 / 同梱meta CC-by。
- `callharvey3d_standingatattention`: 配布表CC0 / 同梱meta CC-by。
- `callharvey3d_standingatease`: 配布表CC0 / 同梱meta CC-by。
- `callharvey3d_standingdefault`: 配布表CC0 / 同梱meta CC-by。
- `callharvey3d_standingmodest`: 配布表CC0 / 同梱meta CC-by。
- `callharvey3d_standingmodestembarrassed`: 配布表CC0 / 同梱meta CC-by。
- `callharvey3d_standingnatural`: 配布表CC0 / 同梱meta CC-by。

原本ZIPと展開ファイルは `<repository-root>/.human_pose/review/posing-workspace-20261009/preset-sources/` に保持。全パックの判断一覧（ローカル資料 `.human_pose/review/posing-workspace-20261009/license-audit.json`、配布対象外）も保存。

## 採用ポーズ

番号・日本語名・分類は用途別にこちらで付けたもの。配布元の連番ではない。日本語名は変換後の描画を見て付けた用途名。原作者の作品名を置き換えた出典表示ではない。椅子・グラス・鞄・相手役などの物体は含まれない。

| 操作画面の名前 | 分類 | 作者 | 配布元の識別名 |
|---|---|---|---|
| 10 自然に立つ | 立つ・待つ | makehuman_system | [standing01](http://www.makehumancommunity.org) |
| 11 重心を寄せて立つ | 立つ・待つ | makehuman_system | [standing02](http://www.makehumancommunity.org) |
| 12 足を前に出して立つ | 立つ・待つ | makehuman_system | [standing03](http://www.makehumancommunity.org) |
| 13 腰に片手 | 立つ・待つ | makehuman_system | [standing04](http://www.makehumancommunity.org) |
| 14 前で腕を添える | 立つ・待つ | Anrico | [anrico_standing11](http://www.makehumancommunity.org/node/2462) |
| 15 腰の後ろに片手 | 立つ・待つ | Anrico | [anrico_standing10](http://www.makehumancommunity.org/node/2199) |
| 16 腰に両手 | 立つ・待つ | DredNicolson | [drednicolson_arms_akimbo](http://www.makehumancommunity.org/node/375) |
| 17 後ろ手でうつむく | 立つ・待つ | sohh | [sohh_sohh_embarrassed](http://www.makehumancommunity.org/node/2571) |
| 20 片手を上げて話す | 会話・身振り | makehuman_system | [standing05](http://www.makehumancommunity.org) |
| 21 肩へ手を伸ばす | 会話・身振り | punkduck | [punkduck_hand_on_shoulder_01](http://www.makehumancommunity.org/node/1997) |
| 22 近くの相手へ手を添える | 会話・身振り | punkduck | [punkduck_hand_on_shoulder_03](http://www.makehumancommunity.org/node/1999) |
| 23 頭に手を当てる | 会話・身振り | punkduck | [punkduck_pd_fashion01](http://www.makehumancommunity.org/node/916) |
| 24 両手を広げて話す | 会話・身振り | punkduck | [punkduck_pd_fashion02](http://www.makehumancommunity.org/node/919) |
| 25 指し示す | 会話・身振り | punkduck | [punkduck_train_departure](http://www.makehumancommunity.org/node/639) |
| 26 両手を胸元へ | 会話・身振り | sohh | [sohh_posing1](http://www.makehumancommunity.org/node/2599) |
| 27 口元に手を当てる | 会話・身振り | sohh | [sohh_posing2](http://www.makehumancommunity.org/node/2600) |
| 28 ピース | 会話・身振り | gpedroso | [gpedroso_peace_and_love](http://www.makehumancommunity.org/node/1060) |
| 30 床に座る | 座る・休む | makehuman_system | [sit01](http://www.makehumancommunity.org) |
| 31 椅子で振り向く | 座る・休む | Anrico | [anrico_sitting02](http://www.makehumancommunity.org/node/2201) |
| 32 椅子に腰かける | 座る・休む | Anrico | [anrico_sitting04](http://www.makehumancommunity.org/node/2218) |
| 33 座って身振り | 座る・休む | Anrico | [anrico_sitting10](http://www.makehumancommunity.org/node/2463) |
| 34 足先を寄せて腰かける | 座る・休む | milkman | [milkman_sit_01a](http://www.makehumancommunity.org/node/778) |
| 35 横に脚を伸ばして座る | 座る・休む | wolgade | [wolgade_sit_on_ground_01](http://www.makehumancommunity.org/node/286) |
| 36 座り姿 | 座る・休む | sweetan008 | [sweetan008_sitting-pose](http://www.makehumancommunity.org/node/317) |
| 37 床で顔に手を添える | 座る・休む | Elvaerwyn | [elvs_what_have_i_done](http://www.makehumancommunity.org/node/1400) |
| 41 座ってグラスを持つ | 物を持つ・動作 | Mindfront | [mindfront_sitting_in_armchair_holding_wine_glass](http://www.makehumancommunity.org/node/530) |
| 42 カウンターに寄りかかる | 物を持つ・動作 | jjones | [jjones_leaning_on_counter_hands_folded](http://www.makehumancommunity.org/node/3588) |
| 43 立ってグラスを持つ | 物を持つ・動作 | Mindfront | [mindfront_standing_holding_wine_glass](http://www.makehumancommunity.org/node/531) |
| 44 鞄を腕にかける | 物を持つ・動作 | punkduck | [punkduck_pd_fashion_handbag](http://www.makehumancommunity.org/node/961) |
| 50 走る | 物を持つ・動作 | makehuman_system | [run01](http://www.makehumancommunity.org) |

## PNG書き出し

追加依頼により、30ポーズを ポーズPNG（ローカル資料 `.human_pose/review/posing-workspace-20261009/ポーズPNG`、配布対象外） の1フォルダーへ Blender内のポーズ番号をファイル名として保存（10〜50、欠番あり。番号を詰めない）。1024×1024、RGBA、背景透明。初期化アセットは含めない。ファイル名の番号は上の採用ポーズ表と同じ。出典対応は別の png-export-manifest.json（ローカル資料 `.human_pose/review/posing-workspace-20261009/png-export-manifest.json`、配布対象外） に保存し、PNGフォルダー内には画像30枚だけを置いた。保存版のポーズを背景Blenderで読み取り、開いている作業画面やblendの保存内容を変更せずに描画した。

### 利用者修正の再撮影と番号の統一

17・23は利用者がシーンの姿勢を修正したもので、既存アセット自体は未更新だった。保存時刻18:10:17の `.blend1` から17、18:11:27の `.blend` から23を回収してそのまま再撮影した。修正姿勢は `recapture-20261009/asset-17-user-corrected.blend` と `asset-23-user-corrected.blend` に退避済み。再撮影前後で他28枚のhashが同じことを確認した。

初回書き出しで01〜30へ振り直した番号は誤りとして撤回。全PNGのファイル名をBlender番号へ揃え、修正画像は `17.png`・`23.png` とした。番号変更前の画像・対応表・再撮影元のhashは `recapture-20261009/` に保持。番号変更による全30枚の画像内容の不変を確認。アセットの再適用ではこの2つの手直しが戻るため、再撮影時は退避済みの修正姿勢を使用する。

## 実装と再生成

- `posing_tools.py`: 既存MPFB helperの追加、制御骨、コレクション、操作案内。
- `pose_limits.py`: stock IKを維持し、FK／指コントローラーに操作範囲を追加。
- `pose_library.py`: 使い捨てrigで公式BVHを読み、rest roll変更を補償して元rigへ移す。Blender標準PoseActionCreatorで現在のAction Slot形式を作成。実meshを描画したサムネイルを格納。
- `build_posing_workspace.py`: 保存済みbase入力と選定manifestから新規作業台を生成。接地は全rootをワールドZ方向に平行移動し、形状不変を検証。
- `validate_posing_workspace.py`: addonなしのBlenderで保存ファイルを開き操作を検証。

ローカル入力は `input-backups/base.blend`、`input-manifest.json`、`selected-presets.json`、`preset-sources/`。選定処理は同じ成果物フォルダーの `select_presets.py` に保持。これら大きな成果物はGit対象外であり、コードcheckout単独では再生成できない。

既存MPFB環境は `../tori29umai-pose-pipeline-experiment/tools/blender-user/`。生成時にその `config` / `scripts` / `datafiles` / `extensions` をそれぞれ `BLENDER_USER_CONFIG` / `BLENDER_USER_SCRIPTS` / `BLENDER_USER_DATAFILES` / `BLENDER_USER_EXTENSIONS` に指定し、正本で次を実行する。

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python-exit-code 1 --python scripts/human_pose/build_posing_workspace.py -- --output .human_pose/review/posing-workspace-20261009
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/human_pose/validate_posing_workspace.py -- --output .human_pose/review/posing-workspace-20261009
```

生成コードは基本レイアウトを用意する。今回の最終版はその後GUIで一覧の高さ・ローカルライブラリ・全身表示を整えて保存した。

## 検証

- 31アセットをaddonなしのBlenderで全適用。有限のmesh座標、全身サイズ、埋め込みサムネイル、CC0と出典を確認。
- 全31アセットについて、変換直後と初期状態を経て再適用した後のmesh座標が一致（最大差0）。
- 初期姿勢復元、元163骨／mesh／weight保持、20非変形コントローラー、IK非伸縮を確認。
- 指一括操作で4本指が曲がり、親指と反対側の手は変化しないことを確認。
- 手・足IKの到達可能位置への追従、183骨の左右反転2回による復元を確認。
- 日本語GUIでサムネイルのダブルクリック適用、右クリック「ポーズに適用(反転)」、初期状態への復帰、保存を確認。全30ポーズの変換後一覧画像を目視した。

数値は validation-report.json（ローカル資料 `.human_pose/review/posing-workspace-20261009/validation-report.json`、配布対象外）。支持物との接触調整、全角度での解剖学的妥当性、Comic Image Hub本体へのlibrary登録、ComfyUI出力のE2Eは今回の検証対象外。
