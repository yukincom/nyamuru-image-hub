# 09 版の違い（CSP のバージョンとグレード）

CSP のどの版で保存したファイルかを見分ける方法と、版によって何が違うか。
実装: `crates/csp-format/src/version.rs`（`VersionInfo`、`cspf version`）、`python/csp_format/version.py`。
根拠: コーパス（`.clip` 719 件・`.cmc` 42 件、保存日 2017-08〜2026-10）の集計（`tools/corpus/version_census.py`）と、
CSP 5.1.4 で開いた確認（[V9](../validation/V9-versions.md)）。

## 版の番号はファイルにない（確認済み）

- `Project.ProjectInternalVersion` は 761 件すべて `"1.1.0"`。版を表さない
- コンテナ（01 章）は全件で同じ: `CHNKHead` は 40 バイトで `256, …, 16`、チャンクの順は `Head, Exta…, SQLi, Foot`
- 埋め込み SQLite のヘッダーもほぼ同じ: ページ 4,096 バイト、UTF-8、`user_version` 0、`application_id` 0。
  最後に書いた SQLite の版（ヘッダーの 96 バイト目）は 760 件が 3.30.1、2017 年の 1 件だけ 3.8.8（このライブラリが書くと rusqlite の版になる）
- グレード（PRO / EX / DEBUT）を記録する列はない（`ParamScheme` の全 1,255 列に該当なし）

## 版を表すのはスキーマ登録（確認済み）

CSP は保存のたびに、自分が知っている全列を `ParamScheme` に登録する（02 章）。ファイルにある登録は消さない。

- 新しい版で保存し直したときの残り方は、保存した版で違う
  - 2.x までの CSP（と 4.2 までの `.cmc` の保存）は、その版で増えた列の行を `ParamScheme` の末尾にまとめて足す
    （`_PW_ID` の順で、表の名前が先頭からもう一度始まる）。33 件（`.clip` 26、`.cmc` 7）がこの形で、どれも保存日が次の世代の範囲にある
  - 3.0 以降の CSP は、`.clip` の登録を自分の順に作り直す。古いファイルにしかない列は、元の位置に残す。
    CSP 5.1.4 で、1.8〜1.10.3 の世代のファイル（1,103 行）を保存すると、1,256 行の 1 つの塊になった
    （5.1.4 の 1,255 行と、`CameraInfo.CameraZoomWithDolly`。`_PW_ID` も 5.1.4 の新規ファイルと同じ）。
    5.x の登録を消したファイルを保存すると、消した行が同じ `_PW_ID` に戻った（[V9](../validation/V9-versions.md) 2 章）
- 新しい版が登録をやめた列も残る。`CameraInfo.CameraZoomWithDolly` は 3.0 以降の新しいファイルにはなく、
  3.0 以降で保存したファイルのうち 12 件（`.clip` 11、4.2 の 1）にある。これが「それより前に作って、3.0 以降で保存し直した」印になる
- `ParamScheme` の表そのものに `AlternativeLockType`・`AlternativeLockSpecified` の列が足されたのは 2.0 から。
  2.0 で古いファイルを保存し直したものは、この 2 列が表の末尾に `ALTER TABLE` で足されている（15 件）。
  2.1 以降と 5.1.4 は、表を作り直して `LinkTable` の前に置く
- 表と列は、登録とは別に、ファイルが初めて使うときに作られる（02 章）。だから表の列から版は分からない

このため、登録されている列の集合で「最後に保存した版の世代」（`saved_by`）が分かる。
「作った版の世代」（`created_by`）は、2.x までに保存し直したファイルなら最初の塊から分かるが、3.0 以降で保存し直したファイルでは分からない
（`resaved` は真、`created_by` は `None`）。

## 世代（コーパスの集計）

新しい順。「目印」の列がすべて登録されていればその世代（`version::GENERATIONS`）。
件数は最後に保存した版で数えたもの。「CSP」は推測で、根拠は右の欄。

| 世代（CSP） | 目印の列 | 形式番号 | 登録の行数 | `.clip` | `.cmc` | 保存日（コーパス） | 根拠 |
|---|---|---|---|---|---|---|---|
| 5.1 | `Layer.Has1_0_19`、`BrushStyle.WaterEdgeStyle` | 19 | 1,255 | 3 | — | 2026-10 | 5.1.0（2026-03-13）で水彩境界に「スタイル」が増えた。PC の 5.1.4 で保存したファイルと同じ |
| 5.0 | `Layer.Has1_0_18`、`BrushStyle.BlurKind` | 18 | 1,250 | 4 | — | 2026-05〜07 | 5.0.0 は 2026-03-11 |
| 4.2 | `Layer.Has1_0_15`、`Canvas.TimeLapseCodec` | 15 | 1,239〜1,240 | 17 | 3 | 2025-12〜2026-02 | 4.2.0 は 2025-12-02 |
| 3.0〜4.1 | `Layer.Has1_0_12`、`Canvas.CanvasWorkTime` | 12 | 1,225〜1,226 | 116 | 8 | 2024-12〜 | レイヤーカンプ（`LayerComp`）は 3.0.0（2024-03-14）から。最初のファイルは 3.2.0（2024-12-03）の後 |
| 2.1〜2.x | `Layer.Has1_0_8`、`BrushStyle.BrushColorMixingMode` | 8 | 1,179 | 206 | 21 | 2024-01〜12 | レイヤーカンプがないので 3.0 より前。2.0 の世代の後 |
| 2.0 | `Layer.WebCooperationLayerEditable` | 7 | 1,165 | 76 | 6 | 2023-04〜12 | 2.0 は 2023-03-14 |
| 1.12〜1.13 | `Layer.Has1_0_7`、`CameraNodeInfo.CameraNodeUUID` | 7 | 1,161 | 72 | 2 | 2022-10〜2023-03 | 1.12.0 は 2022-05-26、1.13.0 は 2022-12-06 |
| 1.11〜1.12 | `Layer.HasPrimitive`、`PrimitiveInfo.PrimitiveUUID` | — | 1,146 | 109 | 2 | 2022-02〜09 | 3D プリミティブ |
| 1.10.10〜1.11 | `BrushStyle.DualStyleIndex` | — | 1,140 | 49 | — | 2021-06〜12 | デュアルブラシ |
| 1.10.5〜1.10.9 | `Canvas.TimeLapseManagerIndex` | — | 1,129 | 53 | — | 2020-12〜2021-05 | タイムラプス（`TimeLapse*` の表） |
| 1.8〜1.10.3 | `Layer.TextLayerVersion` | — | 1,103 | 13 | — | 2020-10〜12 | |
| それより前 | — | — | 1,089 | 1 | — | 2017-08 | SQLite 3.8.8 |

- 版の日付は CSP のリリースノート（[5.x](https://www.clipstudio.net/en/dl/release_note/latest/)、
  [4.x](https://www.clipstudio.net/en/dl/release_note/v4/)、[3.x](https://www.clipstudio.net/en/dl/release_note/v3/)、
  [1.x](https://www.clipstudio.net/ja/dl/release_note/)）。コーパスはひとりの作者のファイルなので、
  更新しなかった期間（3.0〜3.1、4.0〜4.1 など）の世代は見えていない。同じ世代に入れた版のあいだにも違いがあるかもしれない
- `.cmc` の登録は、`.cmc` を書き直したときだけ新しくなる（保存日 2026-10 の `.cmc` でも 3.0〜4.1 の世代のものがある）。
  `.cmc` には動画・素材・レイヤーカンプなどの表がなく、`.clip` にない作品設定の列（`Project.ComicBindPosition` など 13 列）がある
- 世代ごとに増えた列の全一覧は、`version_census.py` の出力から作れる（コーパスは PC の上にあるので、一覧は載せない）

## 形式番号 `Has1_0_N` とロック（確認済み）

1.12 から、CSP は自分のファイル形式の番号を `Layer.Has1_0_N` の列で登録する（N = 6〜19）。1 つの版で 1〜4 個増える。
`VersionInfo.format_level` は登録されている N の最大値。

- これらの列は `LockType` 4・`LockSpecified` 2（02 章の `ElemType` の 2 = キャンバス）で登録されている。
  同じ登録の列はほかに `Layer.HasPrimitive`・`HasNewDessindoll`・`Flag3DOdRelease`・`FilterLayerV132`・
  `FilterLayerColorMixingInfo`・`GradationFillColorMixingInfo`・`LinkLayerLayerComp`（と、並びのリンク `LayerNextIndex`・`LayerFirstChildIndex`）
- 列の値が入るのは、その版の新しい機能をレイヤーが使ったとき。コーパスでは `Has1_0_6`・`Has1_0_7` が 1 件ずつ、
  `GradationFillColorMixingInfo` が 48 件、`Flag3DOdRelease` が 10 件、`HasNewDessindoll` が 9 件、`FilterLayerV132` が 2 件。
  CSP で作った色調補正レイヤーのファイルでは、`FilterLayerV132`・`FilterLayerColorMixingInfo`・`GradationFillColorMixingInfo` に値が入る
- CSP は、登録されていて、自分が知らず、値が入っている（NULL でも 0 でもない）列があると、その列の `LockType` に従ってロックする
  （[V9](../validation/V9-versions.md) 4 章で、CSP 5.1.4 に知らない列を見せて確かめた）。登録のない列と `LockType` 0 の列は無視する
  - `LockType` 1: その行のレイヤーを編集できなくする（「一部のレイヤーが編集できません」）。普通の列の多くがこれ
  - `LockType` 4・`LockSpecified` 2: キャンバス全体を読み取り専用にする（「キャンバスを編集できません」）。
    ほかの `LockSpecified`（4・1024・2048、02 章の `ElemType` と同じ値）は、レイヤー・保管庫・項目の範囲と推測する（未確認）
  - `LockType` 2 はリンクの列（`CanvasId`・`LayerId` など）に付く
  - `AlternativeLockType`・`AlternativeLockSpecified` があれば、それが使われる（4・2 に代わり 1・0 を付けると、レイヤーだけのロックになった）
- `Has1_0_8` 以降の目印は代わりが 1・0 なので、2.0 以降の CSP が新しい形式のデータに出会っても、ロックはそのレイヤーだけと推測する。
  `Has1_0_6`・`Has1_0_7` など代わりのない `LockType` 4 の列は、キャンバス全体をロックする
- `VersionInfo.locking_features` は、`LockType` 4 でリンクでない列のうち値が入っているもの。`needs_format_level` はその中の `Has1_0_N` の N の最大値で、
  これより古い形式番号の CSP ではロックされる（範囲は上のとおり）

## バージョン互換情報（1.13.0 から、確認済み）

[環境設定] → [ファイル] →「バージョン互換」→「バージョン互換情報の保存」。選択肢は「保存しない」（既定）・「保存する」・「保存時に確認」。
CSP の説明では、`.clip`・`.cmc` を別名で保存するときに、ファイルの大きさと保存時間が増える代わりに、Ver.1.13.0 以降で開いたときに
キャンバスがロックされずに編集できる。リリースノートでは、Ver.1.5 互換の 3D レイヤーを含む `.clip` に版の互換のための画像を保存する。
4.1.0 では「一部のタブレット・スマートフォンで開いたときにロックされなくなった」。

CSP 5.1.4 で、色調補正・グラデーション・べた塗りのレイヤーを含むファイルを両方の設定で別名保存して比べた（[V9](../validation/V9-versions.md) 3 章）:

- 「保存する」では `Canvas.CanvasRenderMipmapForceSaved` が 1 になり（しないときは 0）、
  画素を持たないレイヤー（用紙、グラデーション、べた塗り、色調補正）の描画結果のミップマップ（`Layer.LayerRenderMipmap`）の
  100% の段に画素が入る。しないときは、この段の Offscreen はブロックの中身がない（CSP が開くときに描き直す）
- 違いはこれだけ。表・列・登録・ほかの行は同じで、外部チャンクが 13 個増え、ファイルは 1.36 MB から 1.64 MB になった
- だから、古い CSP が知らない描画（新しい色調補正など）でも、保存された描画結果をそのまま表示できる、と推測する。
  このライブラリにとっては、`CanvasRenderMipmapForceSaved` が 1 のファイルは、画素を持たないレイヤーの CSP 自身の描画結果を持つ（R10 の照合に使える）

## グレード（PRO / EX / DEBUT）

ファイルにグレードは記録されない。グレードによる違いは、CSP がファイルを開いたときの扱いの違い（CSP の文言から）:

- EX だけ: 複数ページの作品（`.cmc`）の出力、見開きの印刷、レイヤーカンプ、24 フレームを超えるアニメーション
- PRO / DEBUT で開くと: EX でしか扱えないタイムラインの設定を含むキャンバスは編集できない。「このファイルを開くには CLIP STUDIO PAINT EX が必要です」という文言もある
- DEBUT: 幅・高さの上限、ツール・オートアクションの読み込み不可、使えない素材

PRO・DEBUT のライセンスがないので、CSP での確認はしていない（V9 5 章）。ファイルにグレードの記録はないので、このライブラリはグレードを区別せず同じ形式として扱う
（2026-10-25 のユーザー判断。PRO・DEBUT と古い版の CSP での確認は未確認事項として保留）。

## 読み手・書き手への約束

- 読み手は列を名前で引き、表や列がなければ「値なし」とする（02 章）。2017〜2026 の全世代を V1 で読めている
- 書き手は、ファイルにある表と列だけを書く（`edit.rs` の `insert_row` はない列を飛ばす）。登録（`ParamScheme`）は変えない。
  だから古い世代のファイルを編集しても世代は変わらない（V9 2 章で、2020〜2024 年の 7 世代の写しにレイヤーを足し、どれも CSP 5.1.4 で開けた）
- CSP は、登録が自分より古いファイルを、警告なしに開いて保存する（登録を作り直す）。自分の知らない列は上の規則でロックする（V9 4 章）。
  だから書き手は、CSP の知らない列を足すときは登録しないか `LockType` 0 にする（このライブラリは列を足さない）
- 新規作成（R13）は、PC の CSP 5.1.4 と同じ最新の登録で書く。それより古い CSP で開けるかは未確認（古い CSP がない）
- `VersionInfo.unknown_labels` は、このライブラリが知らない登録（ライブラリより新しい CSP）。編集はできるが、新しい列の意味は扱わない
