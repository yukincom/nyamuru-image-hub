# 02 データベース

`.clip` の `CHNKSQLi` チャンクと `.cmc` のファイルそのものは、SQLite 3 のデータベース。
実装: `crates/csp-format/src/database.rs`、`schema.rs`。全テーブルの列は [スキーマ目録](schema-catalog.md) にある。

## 表と列は必要になってから作られる（確認済み）

CSP は、ファイルが初めて必要としたときに表や列を作る。コーパスの 719 件では、`VectorObjectList` 表があるのは 523 件、
`Layer.VectorNormalBalloonIndex` 列があるのは 604 件で、古い版で保存したファイルには新しい版の列がない（[スキーマ目録](schema-catalog.md)の「ファイル」の欄）。

- 読み手は列を名前で引き、表や列がなければ「値なし」とする
- 書き手は、そのファイルにある表と列だけを書く。新しく作るときは、CSP が同じ種類のファイルで作る表を作る（`data/new_file_schema.sql`、R13）
- SQLite の列の型の宣言は `ParamScheme.DataType` と違うことがある（例: `ExternalChunk.ExternalID` は BLOB と宣言されているが値は TEXT、01 章）

## スキーマ登録（確認済み）

CSP は、自分が知っているすべての表と列を、ファイルの中に登録する。ファイルが使わない表も載っている。コーパスの和集合が [スキーマ目録](schema-catalog.md)。

### `ParamScheme`（列ごとに 1 行）

| 列 | 意味 | 確度 |
|---|---|---|
| `TableName`、`LabelName` | 表の名前と列の名前 | 確認済み |
| `DataType` | 1 整数、2 実数、3 文字列、4 BLOB | 確認済み |
| `LinkTable` | ID の列が指す表（値はその表の `MainId`）。空ならリンクなし | 確認済み |
| `OwnerType` | この列が「どの要素の ID か」。`CanvasId` 2、`LayerId` 4、`LayerObjectId` 8、`BankId` 1024、`ItemId` 2048、`TrackId` 4096。ほかは 0 | 確認済み（下の `ElemType` と一致） |
| `Flag` | リンクの種類。4 は持ち物への参照（`Layer.LayerRenderMipmap`、`Mipmap.BaseMipmapInfo` など）、6 は同じ表の並びのリンク（`NextIndex`、`LayerFirstChildIndex`、`LayerNextIndex`）、2 は `CanvasNode.SelectedIndex` だけ | 推測 |
| `LockType`、`LockSpecified`、`AlternativeLockType`、`AlternativeLockSpecified` | 値 0・1・2・4 と 0・1・2・4・1024・2048。画素の表（Offscreen、Mipmap など）とレイヤーの表に多い。CSP が知らない列に値があるときのロック。`LockType` 1 = その行のレイヤー、4 = `LockSpecified` の範囲（2 = キャンバス）、0 = 無視。`Alternative…` があればそちら（[09 章](09-versions.md)） | 確認済み（1、4・2、代わり）、ほかは推測 |

### `ElemScheme`（表ごとに 1 行）

| 列 | 意味 |
|---|---|
| `TableName` | 表の名前 |
| `ElemType` | 要素の種類: 1 Project、2 Canvas、4 Layer、8 LayerObject、1024 保管庫（`CanvasItemBank`、`AnimationCutBank`、`LayerCompManager`）、2048 項目（`CanvasItem`、`TimeLine`、`Scenario`、`LayerComp`）、4096 `Track`。ほかの表は 0 |
| `MaxIndex` | これまでに振った `MainId` の最大値 |

新しい行の `MainId` は `MaxIndex + 1` にして、`MaxIndex` を更新する（R12）。`MainId` には飛び番がある（CSP の保存し直しで 9 → 11 になった例、V6 5.1）。

### `ExternalTableAndColumnName`

外部チャンクの ID を値に持つ列（`TableName`、`ColumnName`）の一覧（01 章）。

## ID とリンク（確認済み）

- `_PW_ID`: SQLite の行 ID（AUTOINCREMENT）。どこからも参照されない
- `MainId`: 行の ID。リンクはすべて `MainId` を指す。0 は「なし」
- `CanvasId`、`LayerId`: 行が属するキャンバスとレイヤー。`LayerId` 0 はキャンバス全体のもの
- 並びは連結リスト: 先頭を持つ列（`LayerFirstChildIndex`、`Mipmap.BaseMipmapInfo`、`BrushStyleManager.First…` など）から、`NextIndex` 系の列でたどり、0 で終わる

## 値の約束

| 種類 | 約束 | 確度 |
|---|---|---|
| 色の 1 チャンネル（`DrawColorMainRed`、`DefaultPagePaperRed` など） | 32 ビットの値の上位 8 ビットが 8 ビットの色（白は 4294967295 = 0xFFFFFFFF） | 確認済み（新規作成の用紙の色を CSP で確認） |
| 不透明度（`LayerOpacity`） | 0〜256、256 が 100% | 確認済み |
| 長さの単位（`CanvasUnit`、`CropFrameUnitKind`、`DefaultPageUnit`、`LinkUnit`） | 0 px、1 cm、2 mm、3 inch、5 pt | 確認済み（0 と 2 はコーパスと CSP、1・3・5 は推測） |
| 真偽 | 0 / 1。NULL は 0 と同じ | 確認済み |
| UUID | 36 文字の文字列（`LayerUuid` など）または 16 バイトの BLOB（`LayerComp.CompUuid` など） | 確認済み |
| しきい値（`…ThresholdImage` など） | 0x80000000 が 50% と推測 | 推測 |

## BLOB の中の名前付きの区切り

いくつかの BLOB（`Offscreen.Attribute`、`Layer.LayerEffectInfo`、`Layer.GradationFillInfo`、外部チャンクのブロック）は、
`u32 文字数` + UTF-16BE の名前で区切った節を持つ。節の名前と中身はそれぞれの章にある。
