# 04 ラスター（画素）

レイヤーの画素、マスク、サムネイルは `Offscreen` に、256×256 のブロックに分けて zlib で圧縮して入っている。
実装: `crates/csp-format/src/offscreen.rs`、`zlib.rs`。確度: 確認済み（V1: Offscreen 286,168 個、データのあるブロック 1,859,122 個、不一致 0）。

## ミップマップ

```text
Layer.LayerRenderMipmap ──→ Mipmap.BaseMipmapInfo ──→ MipmapInfo (ThisScale 100) ──NextIndex──→ MipmapInfo (50) ──→ … (0 で終わり)
                                                          └─ Offscreen ──→ Offscreen 行
Layer.LayerLayerMaskMipmap ─→ （同じ形。マスク）
```

- `Mipmap.MipmapCount` が段の数。段の倍率（`MipmapInfo.ThisScale`）は 100、50、25、12.5 … と半分ずつ（コーパスでは 0.39 % まで）
- 下の段は上の段を 2×2 の箱で半分にしたもの（premultiplied で平均、幅と高さは切り捨て）。CSP の保存では下の段のチャンクが保存されていないことがある（読み手は上の段から作る）
- CSP が新しく作るレイヤーの段は、キャンバスの大きさから半分ずつ、128 px 以下に収まるまで（少なくとも 4 段）

## `Offscreen.Attribute`

```text
u32 16, u32 len(Parameter 節), u32 len(InitColor 節), u32 len(BlockSize 節)
Parameter 節:  u32 9, UTF-16BE "Parameter", u32 × n
InitColor 節:  u32 9, UTF-16BE "InitColor", u32 × n
BlockSize 節:  u32 9, UTF-16BE "BlockSize", u32 個数, u32 × ブロック数（各ブロックのレコードの大きさ）
```

`Parameter` と `InitColor` の値は、使われない表 `VOffscreen` の列と同じ順に並ぶ（`ParamScheme` の順）。

| 値 | 列（`VOffscreen`） | カラー | グレー | モノクロ | アルファ |
|---|---|---|---|---|---|
| 幅・高さ | `VOffscreenWidth`、`VOffscreenHeight` | | | | |
| ブロック数 | `VOffscreenHorizontalBlockCount`、`…Vertical…` | 切り上げ | | | |
| 画素の並び | `BlockDataChannelOrder` | 0x21 | 0x11 | 0x11 | 0x01 |
| 1 チャンネルのバイト数 | `BlockDataChannelBytes` | 1 | 1 | 1 | 1 |
| アルファ以外のチャンネル | `BlockDataChannelImageCount` | 4 | 1 | 1 | 0 |
| 1 画素のバイト数 | `BlockDataPixelBytes` | 5 | 2 | 1 | 1 |
| 色の面の始まり | `BlockDataOffsetImageBlockBytes` | 65,536 | 65,536 | 8,192 | 0 |
| 色の面の 1 画素 / 1 行のバイト数 | `…ImagePixelBytes`、`…ImageRowBytes` | 4、1,024 | 1、256 | 1、32 | 0、0 |
| アルファの 1 行のバイト数 | `BlockDataOffsetAlphaRowBytes` | 256 | 256 | 32 | 256 |
| ブロックの画素数・幅・高さ・シフト | `BlockDataOffsetImageBlock` ほか | 65,536、256、256、8 | | | |

`InitColor`: 保存されていないブロックの初期値（`InitColorDataDoInitialize`、`InitColorDataAlphaValue`、色の値 10 個）。
アルファ 0xFFFFFFFF は不透明（用紙やマスクの「すべて見せる」）。マスクの格納の外も、この値で埋まっているとみなす。

## ブロックのデータ（外部チャンク、`Offscreen.BlockData` が ID）

```text
u64 残りの長さ
ブロック × (横 × 縦、左上から行ごと):
  u32 レコード長, u32 19, UTF-16BE "BlockDataBeginChunk",
  u32 番号, u32 展開後の大きさ, u32 256, u32 256, u32 データあり,
  [データありのとき u32 (4 + n), u32le n, n バイトの zlib]
  u32 17, UTF-16BE "BlockDataEndChunk"
u32 11, UTF-16BE "BlockStatus",   u32 12, u32 ブロック数, u32 4, u32 × ブロック数（観察値はすべて 1）
u32 13, UTF-16BE "BlockCheckSum", u32 12, u32 ブロック数, u32 4, u32 × ブロック数
```

- チェックサムは `u32le n` と zlib のバイト列を続けたものの Adler-32。データのないブロックは 0
- データのないブロックのレコードは 104 バイト。データのあるブロックは zlib の長さ + 112 バイト（`BlockSize` 節の値と一致）
- 圧縮は zlib level 1・windowBits 15・memLevel 9。これで CSP と同じバイト列になる（1,859,078 個）。
  素材から取り込んだブラシ先端の画像（44 個）だけは zlib の既定（level 6・memLevel 8）

展開したブロック（アルファの面のあとに色の面）:

| 種類 | 大きさ | 中身 |
|---|---|---|
| カラー（0x21） | 327,680 | アルファ 256×256、BGRA 256×256×4（4 バイト目は使わない）。色はストレート（premultiplied ではない） |
| グレー（0x11、2 バイト） | 131,072 | アルファ、グレー |
| モノクロ（0x11、1 バイト、行 32 バイト） | 16,384 | アルファ 1 ビット / 画素、色 1 ビット / 画素。色は `Layer.MonochromeFillInfo` の黒・白 |
| アルファ（0x01） | 65,536 | 1 面だけ（マスク、選択範囲など） |

V1 の Offscreen の内訳: カラー 244,260、アルファ 34,201、グレー 7,334、モノクロ 373。

## サムネイル（`LayerThumbnail`）

レイヤーごとに 1 行。`ThumbnailOffscreen` がサムネイルの画素（ふつうの Offscreen、CSP が新しく作るものは 512×512）。
`Thumbnail…NeedRefresh` の 14 列は真偽ではなく、編集のたびに増える番号（100 万を超える値もある）。
`ThumbnailCanvasWidth/Height` は作ったときのキャンバスの大きさ。
`Layer.LayerRenderThumbnail` が行（`MainId`）を指す（`clip.rs` の `layer_thumbnail`、`cspf extract` が `layerNNNN_thumbnail.png` に書く）。
V1 の 27,986 レイヤーすべてにあり、すべて復号でき、すべて 512 px 四方（うち 11,660 個は全面透明）。CSP がサムネイルを縮小する方法（画素の作り方）は調べていない

## プレビュー（`CanvasPreview`、確認済み）

1 行。`ImageType` 1、`ImageData` が PNG（RGBA）で、全レイヤーを合成した縮小画像。`ImageWidth` は BLOB として登録されているが整数が入る。
大きさは、キャンバスの幅と高さを半分（切り捨て）にしていき、長辺が 2,048 px 以下になったもの（CSP が新しく作ったファイルで確認、`create.rs` の `preview_size`）。
コーパスには長辺が 2,048 を超えるもの（最大 2,893）もあり、保存した版による違いと推測。
倍率は段の倍率よりわずかに小さい（826 / 1653 など）ので、描画では差が 0.5 % 以内なら段の画素をそのまま使う（V6 5.4）。

参考: CSP の「画像を統合して書き出し」の PNG は、透明な画素の RGB を白にする。描画と比べるときは白の上に重ねた色とアルファで比べる（`render_compare`）。
