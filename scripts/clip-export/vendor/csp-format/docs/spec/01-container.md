# 01 コンテナ（CSFCHUNK）

`.clip` は、CSFCHUNK という入れ物の中に SQLite のデータベースと「外部チャンク」（画素・ベクターなどの大きなデータ）を並べたもの。
実装: `crates/csp-format/src/container.rs`。確度: 確認済み（V1、719 件すべて）。

## ファイルヘッダー（24 バイト）

| 位置 | 型 | 値 |
|---|---|---|
| 0 | 8 バイト | `CSFCHUNK` |
| 8 | u64 | ファイルの大きさ（バイト） |
| 16 | u64 | 最初のチャンクの位置（24） |

## チャンク

各チャンクは `8 バイトのタグ, u64 本体の長さ, 本体`。CSP は次の順に書く。

| タグ | 本体 |
|---|---|
| `CHNKHead` | 40 バイト: `u64 256`、`u64 CHNKSQLi のチャンクヘッダーの位置`、`u64 16`、16 バイトのファイル ID |
| `CHNKExta` | `u64 40`、40 バイトの外部 ID（`extrnlid` + 16 進 32 桁）、データ。チャンクの数だけ続く |
| `CHNKSQLi` | SQLite 3 のデータベースの画像（02 章） |
| `CHNKFoot` | 空。最後のチャンク |

- ファイルの大きさはヘッダーの値と一致し、`CHNKFoot` で終わる（V1 の全件）
- データベースの `ExternalChunk` 表が、外部 ID ごとに `CHNKExta` のチャンクヘッダーの位置（`Offset`、ファイルの先頭から）を持つ。
  ID は 40 文字の **TEXT** として保存される（719 件の 63,448 行すべて）。列は BLOB と宣言されているが、CSP は TEXT として照合するので、
  BLOB で入れると CSP は外部チャンクを見つけられず「レイヤー画像が破損」と表示する（V6 2.1）。参照する側（`Offscreen.BlockData` など）は BLOB
- 外部 ID を値に持つ列は `ExternalTableAndColumnName` に載っている: `Offscreen.BlockData`、`VectorObjectList.VectorData`、
  `Canvas3DModelBank.BankData`、`Canvas3DModelLoader.ModelData`、`Track.TrackActionMixer` / `TrackActionMixer2`、
  `CanvasItemBinary.ItemBinaryData`、`Manager3DOd.SceneData`、`ModelData3D.Layer3DModelData`、`TimeLapseBlob.BlobData`
- 列が外部 ID を指しても、そのチャンクがないことがある（まだ何も描いていない Offscreen など）。CSP 自身のファイルにもあり、読み手は「データなし」として扱う
- ファイル ID は `CHNKHead` の 16 バイト。CSP は「別名で保存」のたびに新しくする。編集したファイルを同じ ID のまま書くと、CSP は開いた直後に元の絵を表示する（キャッシュと推測）ので、新しい値にする（V6 2.1）

## 書き戻し

変更のないファイルは元のバイト列のまま書き戻せる（V1、719 件すべてバイト一致）。
外部チャンクを足したり替えたりしたときは、チャンクを並べ直して `ExternalChunk.Offset` を新しい位置に更新する（R12、V6 で CSP が開けることを確認）。
