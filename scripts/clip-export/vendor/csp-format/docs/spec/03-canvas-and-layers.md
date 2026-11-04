# 03 キャンバスとレイヤー

実装: `crates/csp-format/src/model.rs`（読み取り）、`render.rs`（合成）、`edit.rs`・`create.rs`（書き込み）。
各列の値の範囲は [スキーマ目録](schema-catalog.md) にある。

## Project と Canvas（確認済み）

`Project` は 1 行で、`ProjectCanvas` が `Canvas.MainId` を指す。`.clip` のキャンバスは 1 つ（`CanvasId` はふつう 1、まれに 2）。

| 列 | 意味 |
|---|---|
| `CanvasUnit` | `CanvasWidth` / `CanvasHeight` の単位（0 px、1 cm、2 mm、3 inch、5 pt） |
| `CanvasWidth`、`CanvasHeight` | 大きさ（実数）。画素数は `値 × 解像度 / 単位の長さ` を偶数丸め（例: 2 mm で 297 mm・600 dpi → 7016 px） |
| `CanvasResolution` | 解像度（dpi） |
| `CanvasChannelBytes`、`CanvasDefaultChannelOrder` | 1、33（カラー）または 17（グレー） |
| `CanvasDefaultColorTypeIndex` | 基本の表現色（0 カラー、1 グレー、2 モノクロ） |
| `CanvasRootFolder` | ルートのフォルダー（`Layer.MainId`） |
| `CanvasCurrentLayer` | 選んでいるレイヤー |
| `CanvasDoublePage` | 見開きのページ |
| `CropFrame*` | トンボ: 仕上がり（`CropFrameWidth/Height`）、基本枠（`CropFrameInnerWidth/Height`）、裁ち落とし幅（`CropFrameDitch`）、単位（`CropFrameUnitKind`） |
| `ComicStory*`、`ComicPageIndex` など | 作品情報（作品名・話数・作者名・ノンブル）。`.cmc` のページでは作品（`Project`）の値の写し（07 章） |

## レイヤーの木（確認済み）

- `Canvas.CanvasRootFolder` がルート（`LayerType` 256、CSP の画面には出ない）
- フォルダーの `LayerFirstChildIndex` が最初の子、各レイヤーの `LayerNextIndex` が次の兄弟。値は `MainId`、0 で終わり
- 兄弟は **下から上の順**（最初の子が一番下）。ルートの最初の子はふつう用紙
- コーパスの 719 件すべてで木が閉じる（循環・どこからも指されない行・存在しない ID がない、V1）

## レイヤーの種類（確認済み）

どの 1 つの列にも種類は書かれていない。次の順に判定する（`model.rs` の `classify`）。

| 順 | 条件 | 種類 | V1 の数 |
|---|---|---|---|
| 1 | `LayerType` = 256 | ルート | 719 |
| 2 | `LayerType` = 1584 | 用紙 | 699 |
| 3 | `LayerType` = 800 | 作品情報（作品名・ノンブル。`ComicStoryInfoType` 1 作品名、2 ノンブル） | 874 |
| 4 | `LayerFolder` のビット 0 | フォルダー。`ComicFrameLineMipmap` があればコマ枠フォルダー | 3,873 + 273 |
| 5 | `TextLayerString` がある | テキスト（06 章） | 1,527 |
| 6 | `GradationFillInfo` がある | グラデーション・べた塗り（V6b） | 3,249 |
| 7 | `FilterLayerInfo` がある、または `LayerType` のビット 12（4096） | 色調補正（V6b） | 201 |
| 8 | `FirstLayerObject` がある | 3D | 11 |
| 9 | `ResizableImageInfo` がある | 画像素材 | 223 |
| 10 | `VectorObjectList.LayerId` にある | ベクター（05 章） | 3,953 |
| 11 | `LayerType` のビット 0 | ラスター | 12,244 |
| 12 | `LayerType` = 0 で `VectorNormalStrokeIndex` がある | ベクター（何も描いていないもの。`VectorObjectList` に行がない） | 140 |
| — | どれでもない | その他 | 0 |

`LayerType` のビット 1（2）はマスクを持つラスターで立つ。12 の 140 個は、調べた 101 個すべてで画素が全面透明だった（V1）。

## 属性

| 列 | 意味 | 確度 |
|---|---|---|
| `LayerName` | 名前 | 確認済み |
| `LayerVisibility` | ビット 0 表示、ビット 1 マスクを使う | 確認済み（ビット 2 は未解明） |
| `LayerOpacity` | 0〜256（256 が 100%） | 確認済み |
| `LayerComposite` | 合成モード（下の表） | 確認済み |
| `LayerClip` | 1 で下のレイヤーにクリッピング | 確認済み |
| `LayerLock` | 0 以外でロック | 確認済み（ビットごとの意味は未解明） |
| `LayerFolder` | ビット 0 フォルダー、ビット 4（16）パレットで開いている | 確認済み |
| `LayerColorTypeIndex` ほか | 表現色（0 カラー、1 グレー、2 モノクロ）、モノクロの黒・白 | 確認済み |
| `DrawColorMain/Sub*`、`DrawColorEnable` | レイヤーカラー（描画色）。用紙の色もここ | 確認済み |
| `LayerUuid` | 36 文字の UUID | 確認済み |
| `LayerSelect`、`LayerMasking` | パレットでの選択とマスクの表示（ビット） | 推測 |

### 合成モード（`LayerComposite`、V6 1 章で CSP と照合）

| 値 | モード | 値 | モード | 値 | モード |
|---|---|---|---|---|---|
| 0 | 通常 | 10 | 覆い焼き（発光） | 20 | ハードミックス |
| 1 | 比較（暗） | 11 | 加算 | 21 | 差の絶対値 |
| 2 | 乗算 | 12 | 加算（発光） | 22 | 除外 |
| 3 | 焼き込みカラー | 13 | カラー比較（明） | 23 | 色相 |
| 4 | 焼き込み（リニア） | 14 | オーバーレイ | 24 | 彩度 |
| 5 | 減算 | 15 | ソフトライト | 25 | カラー |
| 6 | カラー比較（暗） | 16 | ハードライト | 26 | 輝度 |
| 7 | 比較（明） | 17 | ビビッドライト | 30 | 通過（フォルダーだけ） |
| 8 | スクリーン | 18 | リニアライト | 36 | 除算 |
| 9 | 覆い焼きカラー | 19 | ピンライト | | |

番号は CSP のメニューの順と違う（後から足されたモードが後ろにある）。式は V6 3 章。

### 描き方の種類の列（確認済み）

`DrawToRenderOffscreenType`、`SpecialRenderType`、`DrawToRenderMipmapType`、`MoveOffsetAndExpandType`、`FixOffsetAndExpandType`、
`RenderBoundForLayerMoveType`、`SetRenderThumbnailInfoType`、`DrawRenderThumbnailType` は、レイヤーの種類ごとに決まった値の組を持つ
（CSP の内部の処理の番号と推測。値は 0〜61）。例: 用紙は順に 61・20・31・31・31・31・31・31。
コーパスでは `FixOffsetAndExpandType` などが 30 のレイヤーが 3,249 枚（グラデーションの数と同じ）、31 が 699 枚（用紙の数と同じ）ある。
新しく作るレイヤーには CSP が同じ種類のレイヤーに書く組を写す（V6 5.1 で CSP が開けることを確認）。値ごとの意味は未解明。

## 位置（確認済み）

- `LayerOffsetX/Y`: レイヤーの移動量（キャンバスの画素）
- 画素の左上 = `LayerOffset` + `LayerRenderOffscrOffset`。多くのレイヤーでは `LayerRenderOffscrOffset = −LayerOffset` で、画素はキャンバスの座標のまま
- マスクの左上 = `LayerOffset` + `LayerMaskOffset` + `LayerMaskOffscrOffset`（マスクの移動量はレイヤーの移動量からの相対。V6 5.4）
- ベクターの点、テキストの外接矩形、グラデーションの始点・終点も、レイヤーの移動量からの相対

## マスク（確認済み）

`LayerLayerMaskMipmap` が 0 でなければマスクを持つ。マスクは 1 面の画素（04 章の alpha）で、0 が隠す、255 が見せる。
マスクの外（格納の範囲の外）は `Offscreen.Attribute` の初期値（InitColor）で、ふつうは見せる。`LayerVisibility` のビット 1 が立っているときだけ使う。

## コマ枠フォルダー（確認済み、V3 5 章）

コマ枠フォルダー（`ComicFrameLineMipmap` のあるフォルダー）は、マスク（`LayerLayerMaskMipmap`）と枠線（`ComicFrameLineMipmap`）の画素を保存しない
（コーパスの 178 件・267 フォルダーすべてで、どちらの Offscreen にもブロックのデータがない）。CSP は開くときに、フォルダーの `VectorObjectList`
（`VectorNormalBalloonIndex` の並び）にある枠の図形から両方を作り直す。枠の図形はヘッダー 96 のオブジェクトで、種類の語（+72）が 0x410、フラグ 0x1118（閉じた折れ線）。

- マスク: 閉じた枠の経路の内側（非ゼロ巻き数）を見せ、外を隠す。複数の枠は足し合わせる
- 枠線: 枠の図形をベクターの線として描き（05 章）、マスクを適用したフォルダーの中身の上に、フォルダーの不透明度で重ねる

描かないと中身がマスクで全部隠れる（直す前は、ページ全体が白くなるファイルがあった）。

## 合成の規則（R10、V6 で CSP と照合）

- 下から順に、premultiplied の sRGB の値のまま合成する。フォルダーは子を別のバッファーにまとめてから、フォルダーのモード・不透明度・マスクで重ねる。
  通過（30）のフォルダーは子をそのまま下に重ねる
- **クリッピング**: 下地（クリッピングしていない一番近い下のレイヤー）と、その上でクリッピングしたレイヤーを 1 つのまとまりにする。
  まとまりの中では、クリッピングしたレイヤーを下地の画像の上に「下地の不透明な所だけ」重ねる（下地のアルファは変えない）。
  まとまりを、下地のモード・不透明度・マスクで下に重ねる（V6 5.3）。下地が非表示か空なら、クリッピングしたレイヤーも出ない。
  下地が通過のフォルダーか色調補正のときは、クリッピングしたレイヤーを下に直接重ね、下地のアルファで覆う（推測）
- **画素を持たないレイヤー**: 色調補正・グラデーション・べた塗りは設定から描く（V6b）。保存された画素があっても使わない（古いことがある）。
  ほかの種類（ラスター、ベクター、テキスト、3D、画像素材）は保存された画素を使う。画素がないときは:
  ベクターは近似で描く（05 章）。テキストは CSP が文字のまとまりごとに描いた画像（書式のレコード 50）を外接矩形の位置に置き、
  その下にフキダシの形を描く（06 章）。
  画像素材は元の画像を配置どおりに変形して描く（下）。3D と作品情報は描かない（報告の `without_pixels` に数える。作品情報はプレビューにも出ない）
- **レイヤー効果**（`LayerEffectInfo`、`LayerEffectAttached` = 1 で有効）: フチはマスクを適用した画像の外側に描く（V6 4 章）。
  トーン（`EffectTone`）は全体の大きさで網点にしてから縮める（規則は V6 6 章、実装は `tone.rs`）。ほかの効果は描かない（報告の `effects_skipped`）
- **レイヤーカラー**（`DrawColorEnable` = 1、用紙以外）: 暗い所をメインの色、明るい所をサブの色（未設定なら白）で表示する。輝度で混ぜる（推測）。
  コーパスでは主に、メイン・サブとも白にした灰色のトーンのレイヤー（暗い背景に白い網点）で使われ、描くと 13〜16 dB → 22〜27 dB
- ルートとフォルダーの合成結果は保存されない（`BlockSize` だけが更新され、外部チャンクがない）。CSP は開くときに合成し直す

## 画像素材（`ResizableImageInfo`、推測）

画像素材レイヤーは、元の画像（`ResizableOriginalMipmap`、ふつうの Mipmap）と配置（`ResizableImageInfo`、184 バイト）を持ち、
CSP は開くときに変形した画像を描く（描画用のミップマップのチャンクは保存されていないことが多い）。

```text
+0   u32 120, 16, 4, 0, ?, ?, 2, 2（意味は未解明。+16・+20 は 0・0 か 1・3）
+32  u32 元の幅・高さ（px）
+40  f64 横・縦の倍率      +56 f64 0（回転と推測）
+64  f64 中心 x, y（レイヤーの画素）
+80  f64 元の画像の基準点（大きさの半分）
+96  u32 × 6（1 か 3、1、0、1、0、0 か 1。補間の方法などと推測）
+120 f64 × 8: 元の (0, 0)、(幅, 0)、(0, 高さ)、(幅, 高さ) が置かれる位置（レイヤーの画素。キャンバスでは LayerOffset を足す）
```

描画では 4 つの角から射影変換を求め、出力の各画素を元の画像に戻して双線形で取る（`material.rs`）。
4 つの角が倍率と中心に一致することは、コーパスの例で確かめた。
CSP は素材をキャンバスの大きさでレイヤーに描き、小さい表示はそれを縮めて作る。プレビューの倍率で直接描くと 3.7〜14 dB 低くなるので、
素材が占める範囲（始点を 256 px の格子にそろえる）を倍率 1 で描いてから、ほかのレイヤーと同じく縮める（`render.rs` の `material_at_canvas_size`、[V3](../validation/V3-render.md) 2 章）。
補間の差は残り、画像素材を含む plain のファイル 10 件が 30 dB に届かない。
