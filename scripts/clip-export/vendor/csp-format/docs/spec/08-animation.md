# 08 アニメーション

タイムライン・セル（アニメーションフォルダー）・レイヤーのキーフレーム・2D カメラ・オニオンスキン・ライトテーブル。
実装: `crates/csp-format/src/animation.rs`（モデル・評価・編集）、`cmt.rs`（トラックのミキサー文書）、`render.rs`（`render_frame`）。
Python（標準ライブラリだけ）: `python/csp_format/animation.py`（ミキサーの読み書き・モデル・フレームの状態。描画と編集はない）。
確度: 確認済み（CSP EX で作った 12 件と、CSP の「アニメーション書き出し → 連番画像」との照合。[V6c](../validation/V6c-animation.md)）。
ユーザーのコーパスにはアニメーションのファイルがないため、コーパスでの件数はない。

## 表のつながり

```text
Project.ProjectCutBank → AnimationCutBank
  FirstTimeLine → TimeLine ─NextTimeLine→ TimeLine → … (0 で終わり)
  CurrentIndex  = 今のタイムラインの連結リスト上の位置（0 始まり）
TimeLine
  FirstTrack → Track ─TrackNextIndex→ Track → …（タイムラインごとに別のトラックの組）
  LabelFirstIndex → TimeLineLabel ─LabelNextIndex→ …
Track
  ItemId = TimeLine.MainId、LayerUuidWithTrack = 対象レイヤーの LayerUuid（16 バイト）
  TrackLabelFirstIndex → TimeLineLabel（このトラックのラベル）
  TrackActionMixer / TrackActionMixer2 → 外部チャンク（キー）
```

| `TrackKind` | 対象 | 曲線（`FCurve` の `Type`） |
|---|---|---|
| 2000 | アニメーションフォルダー | `ImageCelName`（定数補間。値はセルの位置、`Tag` がセルのレイヤー名） |
| 2001 | キーフレームを有効にしたレイヤー | `ImagePosition`・`ImageCenter`・`ImageAspectScale`（X/Y）、`ImageRotation`、`Opacity` |
| 2003 | 用紙 | なし |
| 2005 | 2D カメラフォルダー | `ImagePosition`・`ImageCenter`（X/Y）、`ImageScale`、`ImageRotation`、`Opacity` |

フレームは 0 始まりで保存される。CSP の画面の「3 〜 29」は `StartFrame` 2・`EndFrame` 29（終わりは最後のフレームの次）。

## 時間

- タイムラインのフレーム `f`（0 始まり）は `t = f × 60 / FrameRate` ティック（1/60 秒）
- トラックのクリップがタイムラインの時間をキーの時間（動きの時間）に写す:
  `m = MS + (t − TS) × (ME − MS) / (TE − TS)`。`TimeClip` = TS..TE、`MotionClip` = MS..ME
- フレームレートを変えると、CSP は各トラックの `TimeClip` を「旧 / 新」倍に伸ばす。キーは同じフレームに留まる（24 → 12 fps で End 90 → 180）
- 新しいトラックのクリップは、作った時点の再生範囲（`StartFrame`〜`EndFrame`）を覆う
- キーフレームのレイヤーは、クリップの始まりより前のフレームでは表示されない（測定。終わりの後も表示しないものとした：未確認）

## 補間（`Interp`）

キーごとに、次のキーまでの動き方を持つ。リストがない曲線は `Default`。

| 名前 | CSP の名前 | 値 |
|---|---|---|
| `Constant` | 一定補間 | 次のキーまで今のキーの値 |
| `Linear` | 等速補間 | 直線 |
| `Default` | 滑らか補間 | 3 次エルミート: `h00·v0 + h10·Δ·RightSlope0 + h01·v1 + h11·Δ·LeftSlope1`（Δ = キーの間隔）。CSP が作るキーの傾きは 0 で、`smoothstep` になる |

最初のキーより前は最初の値、最後のキーより後は最後の値。傾きが 0 でないキー（グラフで編集したもの）は未確認。

## 変形

- レイヤーのキーフレーム: 変形前の画素 `TimeLineOriginalMipmap`（レイヤーの画素の原点に置く）を
  `q = Position + R(Rotation) · diag(ScaleX, ScaleY) / 100 · (p − Center)` で動かす。回転は度、画面で時計回り。
  不透明度は百分率で、`round(v × 256 / 100) / 256` で掛かる。
  `LayerRenderMipmap` は保存されない（CSP が開くときに今のフレームから作る）
- 2D カメラ（`LayerType` 512 のフォルダー）: フォルダーの中のレイヤーだけに掛かる。空のカメラフォルダーは何も変えない。
  書き出しの画像の位置 `u`（基準フレームの左上が原点）に、キャンバスの `Position + R(Rotation) · Scale / 100 · (u − Center)` が写る。
  `ImageScale` 80 は 0.8 倍の範囲を写す（拡大して見える）。CSP は各レイヤーをカメラとキーフレームの変形を合わせて 1 回で標本化する
- 標本化は双線形（CSP との差は縁で 3/255 以内）

## 基準フレーム（書き出す範囲）

`Canvas.CropFrame*`（単位は `CropFrameUnitKind`）: 仕上がり枠 `CropFrameWidth × Height` をキャンバスの中央に置き、`CropFrameCropOffset` だけずらす。
その中央に基本枠 `CropFrameInnerWidth × Height`（`CropFrameInnerOffset` だけずらす）。連番書き出しの「基準フレーム」はこの基本枠。
例: キャンバス 390×270、仕上がり 320×240、ずれ (−5, −5)、基本枠 300×200 → 基本枠は (40, 30) から。

## セル

- アニメーションフォルダー（`Layer.AnimationFolder` 1）の子がセル。セルの `LayerVisibility` はすべて 1 のままで、表示するセルはトラックが決める
- `ImageCelName` の曲線の値は子の並び（下から 0 始まり）の位置、`Tag` はセルの名前。描画は名前で引く
- トラックのないタイムラインでは、そのフォルダーはどのセルも表示しない（推測）
- ライトテーブルに登録したセルごとに、`LayerType` 10016 の参照レイヤーができる。パレットには出ず、ルートの子の連結リストに入る。
  `LinkLayerUUID` が参照先、`LightTableReferCell` 1。描画しない

## トラックのミキサー（"cmt " 文書）

外部チャンクの中身: `u64` ビッグエンディアン（続くバイト数）、`u32` リトルエンディアン（zlib の長さ）、zlib（レベル 1、メモリーレベル 9。画素と同じ）。
展開した文書:

```text
"cmt " 版("0100" | "0110") "binc" u32 CRC-32(以降のバイト)
u32 文字列の数、文字列 × n（u8 長さ + UTF-8）
根のノード
ノード: [0110 だけ: u32 16、u32 属性数の位置、u32 子の数の位置（ノードの先頭から）]
        u32 名前（文字列番号）、u32 型（文字列番号）、値
        u32 属性の数、（u32 名前、u32 値）× n
        u32 子の数、子のノード × n
```

- 数値はすべてリトルエンディアン。文字列表は先頭 22 個が型の名前で、0100 は単精度（`Single[]`・`Float2`）、0110 は倍精度（`Double[]`・`Double2`）。スカラーの `Double` はどちらも倍精度
- 文字列表の残りは、前順にたどって最初に使う順（ノード名、文字列の値、属性の名前と値、子）。これで CSP の文書がバイトまで再現できる
- 2 つのミキサーは同じ内容（0100 と 0110）で、どちらも書く。`TrackActionMixer*Size` は展開後の大きさ
- `Quat`・`Matrix44` の値は見たことがなく、読まずに誤りにする

```text
celsysdocument [version=1.0.0]
  Version-Information: Software "CLIP STUDIO", Version "2.1.0"
  General [Version=2.0.0 | 2.1.0]
    ActionNodeClip [Name=""]
      TimeClip: Start, End, Rate(60)     MotionClip: Start, End, Rate
      MotionBlend: ShiftBlend, NextBlend, BlendEnable    TimeInfo: Rate
      AnimInfo
        Param [Name=… (Tag=…)] : 値（キーのないときの値。今のフレームの値とは限らない）
        FCurve [Type=… (Axis=X|Y)]
          Frame[]（動きの時間）, Value[], LeftSlope[], RightSlope[], Interp[], ReviseConstant[], Tag[]（セル）
```

## `TrackValueMap`

今のフレーム（`TimeLine.CurrentFrame`）の値。ビッグエンディアン: `u32` 8、`u32` 項目の数、項目ごとに
`u32` 項目の大きさ（この語を含む）、名前（UTF-16、前に `u32` 文字数）、タグ（同じ。セルの名前）、`u32` 型（0 実数 `f64`、2 整数 `i32`、3 組 `f64 × 2`）、値。
用紙のトラックは項目 0。

## オニオンスキン（`Canvas.OnionSkin*`）

`Status`（有効）、`Prev/NextDisplayCount`、`UseOpacity`・`StartOpacity`・`StepOpaciy`（%）、`UseColor`、`HalfColor`、
`FrontColor*`（前のフレーム。既定は青）・`BehindColor*`（後のフレーム。既定は緑）は各チャンネル `c × 0x01010101`。
オニオンスキンは画面の表示だけで、書き出しには出ない。ただし CSP が保存する `CanvasPreview` には出ることがあり、
アニメーションのファイルではプレビューは描画の照合に使えない（V6c）。

## 編集（`ClipFile`）

| 操作 | 書くもの |
|---|---|
| `set_frame_rate` | `TimeLine.FrameRate`、そのタイムラインの全トラックの `TimeClip`（両方のミキサー） |
| `set_frame_range` | `StartFrame`・`EndFrame`・`BiggestEndFrame`・`CurrentFrame`（範囲に収める） |
| `set_cel_keys` | `ImageCelName` の曲線（定数補間、`Tag`）、`Param` と `TrackValueMap`（今のフレームのセル） |

CSP EX で開き、書き出した連番画像が同じファイルの `cspf frames` と差 1/255 以内（V6c）。

## 未解明・未確認

- `LightTableInfo`（ルート、516 バイト）、参照レイヤーの `ResizableImageInfo`、`Camera2DResizableImageInfo`（184 バイト）の中身
- 傾きが 0 でない滑らか補間、クリップの終わりの後、クリップの分割（複数の `ActionNodeClip`）、音声レイヤー、フォルダーのセル、空のセル（×）
- `CropFrameOptionFlag` のアニメーション用のビット（カメラを作ると 65536 → 73730）
