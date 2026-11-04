# スキーマ目録

> この文書は `tools/corpus/schema_doc.py` が生成する。意味は `docs/spec/schema-semantics.tsv` を直して再生成する。

コーパスの `.clip` 719 件・`.cmc` 42 件の `ParamScheme`（CSP が登録している全列）と、実際の表の列の和集合。65 表、1385 列。

## 網羅率（V2）

| 範囲 | 列 | 確認済み | 推測 | 未解明 |
|---|---|---|---|---|
| コア（Project、Canvas、Layer、Offscreen、VOffscreen、Mipmap、MipmapInfo、LayerThumbnail、CanvasPreview、VectorObjectList、ExternalChunk、CanvasNode） | 618 | 266 | 352 | 0 |
| すべて | 1385 | 447 | 736 | 202 |

## 見方

- 型: `ParamScheme.DataType`（1 整数、2 実数、3 文字列、4 BLOB）。SQLite の列の型とは違うことがある。未登録は `ParamScheme` になく表にだけある列（`_PW_ID`、`MainId` など）
- リンク: `ParamScheme.LinkTable`（この列の値がその表の `MainId`）。外部チャンク: `ExternalTableAndColumnName` にあり、値が外部チャンクの ID
- ファイル: 拡張子ごとに「表にこの列があるファイル数 / 値（NULL・0・空以外）を持つファイル数」
- 値: 数値の最小〜最大と種類の数（40 種まで数え、超えると +）。文字列・BLOB は最大の長さだけ（中身は載せない）
- コード: ライブラリ（`crates/csp-format/src`）が名前で読み書きしている列
- 状態: 確認済み（ライブラリが使い、コーパス・CSP・テストで確かめた）、推測（名前と値から）、未解明

## AnimationCutBank

アニメーションのカット。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 719/719 | 1 | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 719/719 | 2 | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| CurrentIndex | 整数 |  | .clip 719/0 | 0 | ○ | 確認済み | 今のタイムライン（FirstTimeLine からの連結リストの 0 始まりの位置） |
| Enable | 整数 |  | .clip 719/0 | 0 | ○ | 推測 | アニメーションを使うファイルで 1 |
| FirstScenario | 整数 | Scenario | .clip 719/0 | 0 | ○ | 推測 | アニメーションのカット: 選んでいるカット、使うか、最初のシナリオとタイムライン、1.5.5 の機能の印。コーパスでは常に 0 |
| FirstTimeLine | 整数 | TimeLine | .clip 719/0 | 0 | ○ | 確認済み | 最初のタイムライン（TimeLine.MainId）。アニメーションのないファイルでは 0 |
| FlagScenarioV155 | 整数 |  | .clip 719/0 |  |  | 推測 | アニメーションのカット: 選んでいるカット、使うか、最初のシナリオとタイムライン、1.5.5 の機能の印。コーパスでは常に 0 |

## BrushEffectorGraphData

ブラシの筆圧などの影響のグラフ（制御点）。`ElemScheme.MaxIndex` は最大 116。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 479/475 | 1〜21（18 種） | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 479/475 | 1〜85（40+ 種） | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| CanvasId | 整数 |  | .clip 479/475 | 1〜2（2 種） | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| ControlDataSize | 整数 |  | .clip 479/475 | 16 |  | 推測 | 影響のグラフの制御点の数、1 点の大きさ（16 バイト）、制御点（BLOB） |
| ControlNumber | 整数 |  | .clip 479/475 | 2〜11（9 種） | ○ | 推測 | 影響のグラフの制御点の数、1 点の大きさ（16 バイト）、制御点（BLOB） |
| ControlPoints | BLOB |  | .clip 479/475 | 長さ ≤ 176 | ○ | 推測 | 影響のグラフの制御点の数、1 点の大きさ（16 バイト）、制御点（BLOB） |
| NextIndex | 整数 |  | .clip 479/418 | 0〜85（40+ 種） | ○ | 確認済み | 同じ並びの次の行の MainId（連結リスト、0 で終わり） |

## BrushFixedSpray

スプレーの固定配置。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| CanvasId | 整数 |  | — |  | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| NextIndex | 整数 |  | — |  | ○ | 確認済み | 同じ並びの次の行の MainId（連結リスト、0 で終わり） |
| PlotDataSize | 整数 |  | — |  |  | 推測 | 固定の散布の点（数・大きさ・点の BLOB） |
| PlotNumber | 整数 |  | — |  |  | 推測 | 固定の散布の点（数・大きさ・点の BLOB） |
| PlotPoints | BLOB |  | — |  |  | 推測 | 固定の散布の点（数・大きさ・点の BLOB） |

## BrushPatternImage

ブラシ先端の画像。`ElemScheme.MaxIndex` は最大 39。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 389/389 | 1〜9（9 種） | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 389/389 | 1〜37（32 種） | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| CanvasId | 整数 |  | .clip 389/389 | 1〜2（2 種） | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| Mipmap | 整数 | Mipmap | .clip 389/389 | 6〜2021（40+ 種） | ○ | 推測 | ブラシ先端・紙質の画像（Mipmap.MainId）、名前、UUID |
| Name | 文字列 |  | .clip 389/389 | 長さ ≤ 18 | ○ | 推測 | ブラシ先端・紙質の画像（Mipmap.MainId）、名前、UUID |
| NextIndex | 整数 |  | .clip 389/127 | 0〜37（29 種） | ○ | 確認済み | 同じ並びの次の行の MainId（連結リスト、0 で終わり） |
| Uuid | BLOB |  | .clip 389/389 | 長さ ≤ 16 |  | 推測 | ブラシ先端・紙質の画像（Mipmap.MainId）、名前、UUID |

## BrushPatternStyle

ブラシ先端の画像の使い方。`ElemScheme.MaxIndex` は最大 18。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 232/232 | 1〜6（6 種） | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 232/232 | 1〜18（17 種） | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| CanvasId | 整数 |  | .clip 232/232 | 1 | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| ImageIndex | BLOB |  | .clip 232/232 | 長さ ≤ 20 |  | 推測 | 先端の画像の並び（BLOB）・数・使う順・反転 |
| ImageNumber | 整数 |  | .clip 232/232 | 1〜5（3 種） |  | 推測 | 先端の画像の並び（BLOB）・数・使う順・反転 |
| NextIndex | 整数 |  | .clip 232/103 | 0〜18（16 種） | ○ | 確認済み | 同じ並びの次の行の MainId（連結リスト、0 で終わり） |
| OrderType | 整数 |  | .clip 232/70 | 0〜3（3 種） |  | 推測 | 先端の画像の並び（BLOB）・数・使う順・反転 |
| Reverse | 整数 |  | .clip 2/0 | 0 |  | 推測 | 先端の画像の並び（BLOB）・数・使う順・反転 |
| Reverse2 | 整数 |  | .clip 230/82 | 0〜16（4 種） |  | 推測 | 先端の画像の並び（BLOB）・数・使う順・反転 |

## BrushStyle

ブラシの設定（ベクター線の描き方）。VectorData の線がこの MainId を参照する。`ElemScheme.MaxIndex` は最大 6122421。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 526/526 | 1〜170（40+ 種） | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 526/526 | 1〜6122421（40+ 種） | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| AntiAlias | 整数 |  | .clip 526/486 | 0〜3（4 種） | ○ | 推測 | アンチエイリアス（0 なし〜3 強） |
| AutoIntervalType | 整数 |  | .clip 526/511 | 0〜3（4 種） |  | 推測 | ブラシ先端の間隔とその影響、間隔の自動の種類 |
| BlurBase | 実数 |  | .clip 526/0 | 0 |  | 推測 | ぼかしの量・影響・種類 |
| BlurEffector | BLOB |  | .clip 526/526 | 長さ ≤ 4 |  | 推測 | ぼかしの量・影響・種類 |
| BlurKind | 整数 |  | .clip 7/0 | 0 |  | 推測 | ぼかしの量・影響・種類 |
| BrushColorMixingMode | 整数 |  | .clip 248/0 | 0 |  | 推測 | 色延び、混色の方法、描画色を変える対象 |
| BrushLMSLinearity | 整数 |  | .clip 248/0 | 0 |  | 推測 | 色延び、混色の方法、描画色を変える対象 |
| CanvasId | 整数 |  | .clip 526/526 | 1〜2（2 種） | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| ChangeDrawColorTarget | 整数 |  | .clip 460/460 | 1 |  | 推測 | 色延び、混色の方法、描画色を変える対象 |
| ColorExtension | 実数 |  | .clip 526/0 | 0 |  | 推測 | 色延び、混色の方法、描画色を変える対象 |
| CompositeMode | 整数 |  | .clip 526/28 | 0〜27（4 種） |  | 推測 | ブラシの合成モード（Layer.LayerComposite と同じ番号と推測） |
| DualCompositeMode | 整数 |  | .clip 460/460 | 0〜11（3 種） |  | 推測 | 2 重ブラシの合成モードと、2 つ目のブラシ（BrushStyle.MainId） |
| DualStyleIndex | 整数 |  | .clip 39/39 | 2〜2810004（40+ 種） |  | 推測 | 2 重ブラシの合成モードと、2 つ目のブラシ（BrushStyle.MainId） |
| FixedSpray | 整数 | BrushFixedSpray | .clip 526/0 | 0 |  | 推測 | ブラシ先端の画像（BrushPatternStyle）、点に使うミップマップの段、固定の散布 |
| FlowBase | 実数 |  | .clip 526/526 | 0.5〜1（4 種） |  | 推測 | インクの不透明度（流量）とその影響 |
| FlowEffector | BLOB |  | .clip 526/526 | 長さ ≤ 24 |  | 推測 | インクの不透明度（流量）とその影響 |
| Hardness | 実数 |  | .clip 526/526 | 0.01〜1（6 種） |  | 推測 | 先端の硬さ（0〜1） |
| HueChangeBase | 実数 |  | .clip 513/2 | -0.01389〜0.05556（3 種） |  | 推測 | 色の揺らぎ（色相・彩度・明度）とその影響 |
| HueChangeEffector | BLOB |  | .clip 513/513 | 長さ ≤ 12 |  | 推測 | 色の揺らぎ（色相・彩度・明度）とその影響 |
| IntervalBase | 実数 |  | .clip 526/526 | 0.02〜1.971（15 種） |  | 推測 | ブラシ先端の間隔とその影響、間隔の自動の種類 |
| IntervalEffector | BLOB |  | .clip 526/526 | 長さ ≤ 8 |  | 推測 | ブラシ先端の間隔とその影響、間隔の自動の種類 |
| MipmapIndexToPlot | 整数 |  | .clip 7/0 | 0 |  | 推測 | ブラシ先端の画像（BrushPatternStyle）、点に使うミップマップの段、固定の散布 |
| MixAlphaBase | 実数 |  | .clip 526/526 | 1 |  | 推測 | 混色（下の色を混ぜる量）、色延び、サブ色の混ぜ方とその影響 |
| MixAlphaEffector | BLOB |  | .clip 526/526 | 長さ ≤ 4 |  | 推測 | 混色（下の色を混ぜる量）、色延び、サブ色の混ぜ方とその影響 |
| MixColorBase | 実数 |  | .clip 526/526 | 1 |  | 推測 | 混色（下の色を混ぜる量）、色延び、サブ色の混ぜ方とその影響 |
| MixColorEffector | BLOB |  | .clip 526/526 | 長さ ≤ 4 |  | 推測 | 混色（下の色を混ぜる量）、色延び、サブ色の混ぜ方とその影響 |
| NextIndex | 整数 |  | .clip 526/421 | 0〜6122421（40+ 種） | ○ | 確認済み | 同じ並びの次の行の MainId（連結リスト、0 で終わり） |
| OpacityEffector | 未登録 |  | .clip 526/526 | 長さ ≤ 16 | ○ | 推測 | サイズ・不透明度への筆圧などの影響（BLOB: u32 フラグ、0x10 筆圧なら f32 最小値と u32 グラフ BrushEffectorGraphData.MainId）。ベクターの描画の近似で使う |
| PatternStyle | 整数 | BrushPatternStyle | .clip 526/232 | 0〜18（18 種） |  | 推測 | ブラシ先端の画像（BrushPatternStyle）、点に使うミップマップの段、固定の散布 |
| PenRadius | 実数 |  | .clip 460/39 | 0〜125（40+ 種） |  | 推測 | ペンの半径 |
| RotationBase | 実数 |  | .clip 526/413 | 0〜360（40+ 種） | ○ | 推測 | 先端の向き、向きの影響（ビット）、ランダムの量 |
| RotationEffector | 整数 |  | .clip 526/525 | 0〜195（8 種） | ○ | 推測 | 先端の向き、向きの影響（ビット）、ランダムの量 |
| RotationEffectorInSpray | 整数 |  | .clip 526/524 | 0〜195（6 種） |  | 推測 | 散布の粒子の向き |
| RotationInSprayBase | 実数 |  | .clip 526/227 | 0〜360（18 種） |  | 推測 | 散布の粒子の向き |
| RotationRandom | 実数 |  | .clip 526/526 | 0〜1（16 種） | ○ | 推測 | 先端の向き、向きの影響（ビット）、ランダムの量 |
| RotationRandomInSpray | 実数 |  | .clip 526/526 | 0.47〜1（2 種） |  | 推測 | 散布の粒子の向き |
| SaturationChangeBase | 実数 |  | .clip 513/0 | 0 |  | 推測 | 色の揺らぎ（色相・彩度・明度）とその影響 |
| SaturationChangeEffector | BLOB |  | .clip 513/513 | 長さ ≤ 8 |  | 推測 | 色の揺らぎ（色相・彩度・明度）とその影響 |
| SizeEffector | BLOB |  | .clip 526/526 | 長さ ≤ 28 | ○ | 推測 | サイズ・不透明度への筆圧などの影響（BLOB: u32 フラグ、0x10 筆圧なら f32 最小値と u32 グラフ BrushEffectorGraphData.MainId）。ベクターの描画の近似で使う |
| SprayBias | 実数 |  | .clip 526/524 | -0.5〜1（4 種） |  | 推測 | 散布（粒子の大きさ・密度・偏り・設定のビット）とその影響 |
| SprayDensityBase | 実数 |  | .clip 526/526 | 1〜16（6 種） |  | 推測 | 散布（粒子の大きさ・密度・偏り・設定のビット）とその影響 |
| SprayDensityEffector | BLOB |  | .clip 526/526 | 長さ ≤ 12 |  | 推測 | 散布（粒子の大きさ・密度・偏り・設定のビット）とその影響 |
| SprayFlag | 整数 |  | .clip 526/10 | 0〜17（3 種） |  | 推測 | 散布（粒子の大きさ・密度・偏り・設定のビット）とその影響 |
| SpraySizeBase | 実数 |  | .clip 526/526 | 0.7167〜8.3（17 種） |  | 推測 | 散布（粒子の大きさ・密度・偏り・設定のビット）とその影響 |
| SpraySizeEffector | BLOB |  | .clip 526/526 | 長さ ≤ 8 |  | 推測 | 散布（粒子の大きさ・密度・偏り・設定のビット）とその影響 |
| StyleFlag | 整数 |  | .clip 526/526 | 49152〜770048（32 種） | ○ | 推測 | 設定のビット（49152〜770048） |
| SubColorBase | 実数 |  | .clip 526/0 | 0 |  | 推測 | 混色（下の色を混ぜる量）、色延び、サブ色の混ぜ方とその影響 |
| SubColorEffector | BLOB |  | .clip 526/526 | 長さ ≤ 12 |  | 推測 | 混色（下の色を混ぜる量）、色延び、サブ色の混ぜ方とその影響 |
| TextureBrightness | 実数 |  | .clip 513/175 | -0.5〜0.5（8 種） |  | 推測 | 紙質（テクスチャの画像 BrushPatternImage、濃度・倍率・回転・明るさ・コントラスト・合成） |
| TextureComposite | 整数 |  | .clip 526/190 | 0〜6（6 種） |  | 推測 | 紙質（テクスチャの画像 BrushPatternImage、濃度・倍率・回転・明るさ・コントラスト・合成） |
| TextureContrast | 実数 |  | .clip 513/277 | -0.5〜1（12 種） |  | 推測 | 紙質（テクスチャの画像 BrushPatternImage、濃度・倍率・回転・明るさ・コントラスト・合成） |
| TextureDensityBase | 実数 |  | .clip 526/526 | 0.08〜1（22 種） |  | 推測 | 紙質（テクスチャの画像 BrushPatternImage、濃度・倍率・回転・明るさ・コントラスト・合成） |
| TextureDensityEffector | BLOB |  | .clip 526/526 | 長さ ≤ 28 |  | 推測 | 紙質（テクスチャの画像 BrushPatternImage、濃度・倍率・回転・明るさ・コントラスト・合成） |
| TextureFlag | 整数 |  | .clip 526/286 | 0〜769（8 種） |  | 推測 | 紙質（テクスチャの画像 BrushPatternImage、濃度・倍率・回転・明るさ・コントラスト・合成） |
| TextureOffsetX | 実数 |  | .clip 526/0 | 0 |  | 推測 | 紙質（テクスチャの画像 BrushPatternImage、濃度・倍率・回転・明るさ・コントラスト・合成） |
| TextureOffsetY | 実数 |  | .clip 526/0 | 0 |  | 推測 | 紙質（テクスチャの画像 BrushPatternImage、濃度・倍率・回転・明るさ・コントラスト・合成） |
| TexturePattern | 整数 | BrushPatternImage | .clip 526/286 | 0〜36（20 種） |  | 推測 | 紙質（テクスチャの画像 BrushPatternImage、濃度・倍率・回転・明るさ・コントラスト・合成） |
| TextureRotate | 実数 |  | .clip 526/88 | 0〜360（40+ 種） |  | 推測 | 紙質（テクスチャの画像 BrushPatternImage、濃度・倍率・回転・明るさ・コントラスト・合成） |
| TextureScale | 実数 |  | .clip 526/526 | 0.03446〜1.45（40+ 種） |  | 推測 | 紙質（テクスチャの画像 BrushPatternImage、濃度・倍率・回転・明るさ・コントラスト・合成） |
| ThicknessBase | 実数 |  | .clip 526/526 | 0.05〜2.39（27 種） | ○ | 推測 | ブラシサイズの倍率（Base）と、筆圧などの影響（Effector、BLOB） |
| ThicknessEffector | BLOB |  | .clip 526/526 | 長さ ≤ 24 | ○ | 推測 | ブラシサイズの倍率（Base）と、筆圧などの影響（Effector、BLOB） |
| UseWaterColor | 整数 |  | .clip 526/0 | 0 |  | 推測 | 水彩境界（半径・強さ・透明度と明るさの影響・ぼかし）と水彩の種類 |
| ValueChangeBase | 実数 |  | .clip 513/2 | -0.05〜0.1（3 種） |  | 推測 | 色の揺らぎ（色相・彩度・明度）とその影響 |
| ValueChangeEffector | BLOB |  | .clip 513/513 | 長さ ≤ 12 |  | 推測 | 色の揺らぎ（色相・彩度・明度）とその影響 |
| WaterColorType | 整数 |  | .clip 526/0 | 0 |  | 推測 | 水彩境界（半径・強さ・透明度と明るさの影響・ぼかし）と水彩の種類 |
| WaterEdgeAlphaPower | 実数 |  | .clip 526/0 | 0 |  | 推測 | 水彩境界（半径・強さ・透明度と明るさの影響・ぼかし）と水彩の種類 |
| WaterEdgeBlur | 実数 |  | .clip 526/0 | 0 |  | 推測 | 水彩境界（半径・強さ・透明度と明るさの影響・ぼかし）と水彩の種類 |
| WaterEdgeFlag | 整数 |  | .clip 526/0 | 0 |  | 推測 | 水彩境界（半径・強さ・透明度と明るさの影響・ぼかし）と水彩の種類 |
| WaterEdgeRadius | 実数 |  | .clip 526/526 | 1 |  | 推測 | 水彩境界（半径・強さ・透明度と明るさの影響・ぼかし）と水彩の種類 |
| WaterEdgeStrength | 実数 |  | .clip 3/3 | 1 |  | 推測 | 水彩境界（半径・強さ・透明度と明るさの影響・ぼかし）と水彩の種類 |
| WaterEdgeStyle | 整数 |  | .clip 3/0 | 0 |  | 推測 | 水彩境界（半径・強さ・透明度と明るさの影響・ぼかし）と水彩の種類 |
| WaterEdgeValuePower | 実数 |  | .clip 526/0 | 0 |  | 推測 | 水彩境界（半径・強さ・透明度と明るさの影響・ぼかし）と水彩の種類 |
| WaterEdgeVividness | 実数 |  | .clip 3/0 | 0 |  | 推測 | 水彩境界（半径・強さ・透明度と明るさの影響・ぼかし）と水彩の種類 |

## BrushStyleManager

ブラシ設定の一覧。`ElemScheme.MaxIndex` は最大 8。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 609/609 | 1 | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 609/609 | 1〜8（8 種） | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| CanvasId | 整数 |  | .clip 609/609 | 1〜2（2 種） | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| FirstBrushStyle | 整数 | BrushStyle | .clip 609/524 | 0〜3244868（40+ 種） |  | 推測 | 各設定の連結リストの先頭（リンク先の表の MainId） |
| FirstFillStyle | 整数 | FillStyle | .clip 609/196 | 0〜86（12 種） |  | 推測 | 各設定の連結リストの先頭（リンク先の表の MainId） |
| FirstFixedSpray | 整数 | BrushFixedSpray | .clip 609/0 | 0 |  | 推測 | 各設定の連結リストの先頭（リンク先の表の MainId） |
| FirstGraphData | 整数 | BrushEffectorGraphData | .clip 609/475 | 0〜66（33 種） |  | 推測 | 各設定の連結リストの先頭（リンク先の表の MainId） |
| FirstPattern | 整数 | BrushPatternStyle | .clip 609/203 | 0〜16（14 種） |  | 推測 | 各設定の連結リストの先頭（リンク先の表の MainId） |
| FirstPatternImage | 整数 | BrushPatternImage | .clip 609/368 | 0〜32（15 種） |  | 推測 | 各設定の連結リストの先頭（リンク先の表の MainId） |
| FirstPatternStyle | 整数 | BrushPatternStyle | — |  |  | 推測 | 各設定の連結リストの先頭（リンク先の表の MainId） |

## CameraInfo

3D のカメラ。`ElemScheme.MaxIndex` は最大 10。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 15/15 | 1〜2（2 種） | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 15/15 | 1〜10（5 種） | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| CameraPositionX | 実数 |  | .clip 15/15 | -170.1〜321.7（10 種） |  | 推測 | カメラの位置・注視点・上の向き（3D の座標） |
| CameraPositionY | 実数 |  | .clip 15/15 | 24.45〜267.6（10 種） |  | 推測 | カメラの位置・注視点・上の向き（3D の座標） |
| CameraPositionZ | 実数 |  | .clip 15/15 | -776.3〜285.5（11 種） |  | 推測 | カメラの位置・注視点・上の向き（3D の座標） |
| CameraTargetX | 実数 |  | .clip 15/15 | -74.02〜62.86（10 種） |  | 推測 | カメラの位置・注視点・上の向き（3D の座標） |
| CameraTargetY | 実数 |  | .clip 15/15 | -0.1748〜166.3（10 種） |  | 推測 | カメラの位置・注視点・上の向き（3D の座標） |
| CameraTargetZ | 実数 |  | .clip 15/15 | -20.5〜68.59（10 種） |  | 推測 | カメラの位置・注視点・上の向き（3D の座標） |
| CameraTwist | 実数 |  | .clip 15/5 | 0〜0.08727（3 種） |  | 推測 | カメラのひねり、ドリーでズーム、UUID |
| CameraUpX | 実数 |  | .clip 15/0 | 0 |  | 推測 | カメラの位置・注視点・上の向き（3D の座標） |
| CameraUpY | 実数 |  | .clip 15/15 | 1 |  | 推測 | カメラの位置・注視点・上の向き（3D の座標） |
| CameraUpZ | 実数 |  | .clip 15/0 | 0 |  | 推測 | カメラの位置・注視点・上の向き（3D の座標） |
| CameraUuidMain | 文字列 |  | .clip 2/2 | 長さ ≤ 36 |  | 推測 | カメラのひねり、ドリーでズーム、UUID |
| CameraUuidSub0 | 文字列 |  | .clip 2/2 | 長さ ≤ 36 |  | 推測 | カメラのひねり、ドリーでズーム、UUID |
| CameraUuidSub1 | 文字列 |  | .clip 2/2 | 長さ ≤ 36 |  | 推測 | カメラのひねり、ドリーでズーム、UUID |
| CameraUuidSub2 | 文字列 |  | .clip 2/2 | 長さ ≤ 36 |  | 推測 | カメラのひねり、ドリーでズーム、UUID |
| CameraUuidSub3 | 文字列 |  | .clip 2/2 | 長さ ≤ 36 |  | 推測 | カメラのひねり、ドリーでズーム、UUID |
| CameraUuidSub4 | 文字列 |  | .clip 2/2 | 長さ ≤ 36 |  | 推測 | カメラのひねり、ドリーでズーム、UUID |
| CameraZoomWithDolly | 整数 |  | .clip 13/13 | 1 |  | 推測 | カメラのひねり、ドリーでズーム、UUID |
| CanvasId | 整数 |  | .clip 15/15 | 1 | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| FrustumBottom | 実数 |  | .clip 15/15 | -17.65〜-0.5111（11 種） |  | 推測 | 視錐台（左右上下・近・遠、平行投影） |
| FrustumFar | 実数 |  | .clip 15/15 | 1618〜1.089e+05（11 種） |  | 推測 | 視錐台（左右上下・近・遠、平行投影） |
| FrustumLeft | 実数 |  | .clip 15/15 | -12.46〜-0.3614（11 種） |  | 推測 | 視錐台（左右上下・近・遠、平行投影） |
| FrustumNear | 実数 |  | .clip 15/15 | 0.809〜54.44（11 種） |  | 推測 | 視錐台（左右上下・近・遠、平行投影） |
| FrustumOrtho | 整数 |  | .clip 15/0 | 0 |  | 推測 | 視錐台（左右上下・近・遠、平行投影） |
| FrustumRight | 実数 |  | .clip 15/15 | 0.898〜12.46（11 種） |  | 推測 | 視錐台（左右上下・近・遠、平行投影） |
| FrustumTempBottom | 実数 |  | — |  |  | 推測 | 視錐台（左右上下・近・遠、平行投影） |
| FrustumTempFar | 実数 |  | — |  |  | 推測 | 視錐台（左右上下・近・遠、平行投影） |
| FrustumTempLeft | 実数 |  | — |  |  | 推測 | 視錐台（左右上下・近・遠、平行投影） |
| FrustumTempNear | 実数 |  | — |  |  | 推測 | 視錐台（左右上下・近・遠、平行投影） |
| FrustumTempOrtho | 整数 |  | — |  |  | 推測 | 視錐台（左右上下・近・遠、平行投影） |
| FrustumTempRight | 実数 |  | — |  |  | 推測 | 視錐台（左右上下・近・遠、平行投影） |
| FrustumTempTop | 実数 |  | — |  |  | 推測 | 視錐台（左右上下・近・遠、平行投影） |
| FrustumTop | 実数 |  | .clip 15/15 | 0.5111〜17.65（11 種） |  | 推測 | 視錐台（左右上下・近・遠、平行投影） |
| LayerId | 整数 |  | .clip 15/15 | 10〜85（9 種） | ○ | 確認済み | 属するレイヤー（Layer.MainId）。0 はキャンバス全体のもの（用紙など） |
| LayerObjectId | 整数 |  | .clip 15/15 | 1〜7（3 種） |  | 推測 | 属する 3D オブジェクト（LayerObject.MainId） |
| LayerOpticalAxisPtX | 実数 |  | .clip 15/15 | 1447〜7016（7 種） |  | 推測 | 表示の範囲（キャンバスの画素）と光軸の位置 |
| LayerOpticalAxisPtY | 実数 |  | .clip 15/15 | 2046〜6102（6 種） |  | 推測 | 表示の範囲（キャンバスの画素）と光軸の位置 |
| ViewportHeight | 整数 |  | .clip 15/15 | 4093〜9921（4 種） |  | 推測 | 表示の範囲（キャンバスの画素）と光軸の位置 |
| ViewportWidth | 整数 |  | .clip 15/15 | 2894〜14031（5 種） |  | 推測 | 表示の範囲（キャンバスの画素）と光軸の位置 |
| ViewportXmin | 整数 |  | .clip 15/0 | 0 |  | 推測 | 表示の範囲（キャンバスの画素）と光軸の位置 |
| ViewportYmin | 整数 |  | .clip 15/0 | 0 |  | 推測 | 表示の範囲（キャンバスの画素）と光軸の位置 |

## CameraNodeInfo

3D のカメラの節点。`ElemScheme.MaxIndex` は最大 10。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 1/1 | 1〜5（5 種） | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 1/1 | 6〜10（5 種） | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| CameraNodeUUID | 文字列 |  | .clip 1/1 | 長さ ≤ 36 |  | 推測 | UUID |
| CanvasId | 整数 |  | .clip 1/1 | 1 | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| LayerId | 整数 |  | .clip 1/1 | 46 | ○ | 確認済み | 属するレイヤー（Layer.MainId）。0 はキャンバス全体のもの（用紙など） |
| LayerObjectId | 整数 |  | .clip 1/1 | 7〜22（5 種） |  | 推測 | 属する 3D オブジェクト（LayerObject.MainId） |

## Canvas

キャンバスの設定（大きさ・解像度・単位・トンボ・作品情報など）。`ElemScheme.MaxIndex` は最大 2。コア領域。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 719/719 | 1 | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 719/719 | 1〜2（2 種） | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| BankItemUuid | 文字列 |  | — |  |  | 推測 | 素材として登録したときの UUID |
| BrushStyleManager | 整数 | BrushStyleManager | .clip 609/609 | 1〜8（8 種） |  | 確認済み | ブラシ設定の一覧（BrushStyleManager.MainId） |
| BrushStyleReadProtect070 | 整数 |  | .clip 609/203 | 1 |  | 推測 | 1.7.0 より前の版で開いたときのブラシ設定の保護 |
| Canvas3DModelDataLoaderIndex | 整数 | ModelData3D | .clip 719/719 | 2〜9（8 種） |  | 推測 | 3D モデルの読み込み（ModelData3D.MainId） |
| CanvasChannelBytes | 整数 |  | .clip 719/719 | 1 | ○ | 確認済み | 1 チャンネルのバイト数（常に 1） |
| CanvasColorAdjustmentLevel | 未登録 |  | .clip 719/14 | 長さ ≤ 320 |  | 推測 | 表示の色の調整の設定（BLOB。FilterLayerInfo のレベル補正・トーンカーブと同じ形と推測） |
| CanvasColorAdjustmentToneCurve | 未登録 |  | .clip 719/14 | 長さ ≤ 4160 |  | 推測 | 表示の色の調整の設定（BLOB。FilterLayerInfo のレベル補正・トーンカーブと同じ形と推測） |
| CanvasCurrentLayer | 整数 |  | .clip 719/719 | 2〜2467（40+ 種） | ○ | 確認済み | 選んでいるレイヤー（Layer.MainId） |
| CanvasDefaultChannelOrder | 整数 |  | .clip 719/719 | 17〜33（2 種） | ○ | 確認済み | 既定の画素の形式。33 カラー、17 グレー |
| CanvasDefaultColorBlackChecked | 整数 |  | .clip 719/719 | 1 | ○ | 確認済み | キャンバスの基本の表現色（0 カラー、1 グレー、2 モノクロ）とモノクロの黒・白を使うか |
| CanvasDefaultColorTypeIndex | 整数 |  | .clip 719/75 | 0〜2（3 種） | ○ | 確認済み | キャンバスの基本の表現色（0 カラー、1 グレー、2 モノクロ）とモノクロの黒・白を使うか |
| CanvasDefaultColorWhiteChecked | 整数 |  | .clip 719/719 | 1 | ○ | 確認済み | キャンバスの基本の表現色（0 カラー、1 グレー、2 モノクロ）とモノクロの黒・白を使うか |
| CanvasDefaultToneLine | 未登録 |  | .clip 719/719 | 60 | ○ | 推測 | 既定のトーンの線数 |
| CanvasDoSimulateColor | 整数 |  | .clip 719/0 | 0 | ○ | 推測 | カラープロファイルのプレビューをする |
| CanvasDoublePage | 整数 |  | .clip 719/271 | 0〜1（2 種） | ○ | 確認済み | 見開きのページ |
| CanvasDstProfile | BLOB |  | .clip 719/9 | 長さ ≤ 3144 |  | 推測 | 色の設定。元（Src）と出力（Dst）の ICC プロファイルとその名前 |
| CanvasDstProfileName | 文字列 |  | .clip 719/9 | 長さ ≤ 17 |  | 推測 | 色の設定。元（Src）と出力（Dst）の ICC プロファイルとその名前 |
| CanvasHeight | 実数 |  | .clip 719/719 | 45.09〜11575（40+ 種） | ○ | 確認済み | キャンバスの大きさ（CanvasUnit の単位）。画素数は解像度から計算して偶数丸め |
| CanvasProgressStep | 整数 |  | — |  |  | 推測 | 作業の進み。コーパスでは未設定 |
| CanvasRenderingIntent | 整数 |  | .clip 719/9 | 1 |  | 推測 | 色の変換の意図と、変換に使う色管理の種類 |
| CanvasRenderMipmapForceSaved | 整数 |  | .clip 422/0 | 0 | ○ | 推測 | 表示用ミップマップを常に保存する。コーパスでは 0 |
| CanvasResolution | 実数 |  | .clip 719/719 | 72〜600（7 種） | ○ | 確認済み | 解像度（dpi） |
| CanvasRootFolder | 整数 | Layer | .clip 719/719 | 1〜2（2 種） | ○ | 確認済み | ルートのフォルダー（Layer.MainId） |
| CanvasSimulateDstProfile | BLOB |  | .clip 719/14 | 長さ ≤ 3144 |  | 推測 | カラープロファイルのプレビュー（刷り上がりのシミュレーション）の設定 |
| CanvasSimulateDstProfileName | 文字列 |  | .clip 719/14 | 長さ ≤ 17 |  | 推測 | カラープロファイルのプレビュー（刷り上がりのシミュレーション）の設定 |
| CanvasSimulateRenderingIntent | 整数 |  | .clip 719/14 | 1 | ○ | 推測 | カラープロファイルのプレビュー（刷り上がりのシミュレーション）の設定 |
| CanvasSimulateSrcProfile | BLOB |  | .clip 719/14 | 長さ ≤ 3144 |  | 推測 | カラープロファイルのプレビュー（刷り上がりのシミュレーション）の設定 |
| CanvasSimulateSrcProfileName | 文字列 |  | .clip 719/14 | 長さ ≤ 17 |  | 推測 | カラープロファイルのプレビュー（刷り上がりのシミュレーション）の設定 |
| CanvasSimulateUseLibraryType | 整数 |  | .clip 719/14 | 2 | ○ | 推測 | カラープロファイルのプレビュー（刷り上がりのシミュレーション）の設定 |
| CanvasSrcProfile | BLOB |  | .clip 719/9 | 長さ ≤ 3144 |  | 推測 | 色の設定。元（Src）と出力（Dst）の ICC プロファイルとその名前 |
| CanvasSrcProfileName | 文字列 |  | .clip 719/9 | 長さ ≤ 17 |  | 推測 | 色の設定。元（Src）と出力（Dst）の ICC プロファイルとその名前 |
| CanvasUnit | 整数 |  | .clip 719/564 | 0〜2（2 種） | ○ | 確認済み | CanvasWidth / CanvasHeight の単位（0 px、1 cm、2 mm、3 inch、5 pt） |
| CanvasUseColorAdjustment | 未登録 |  | .clip 719/0 | 0 | ○ | 推測 | 表示の色の調整（レベル補正・トーンカーブ）を使う |
| CanvasUseLibraryType | 整数 |  | .clip 719/9 | 2 |  | 推測 | 色の変換の意図と、変換に使う色管理の種類 |
| CanvasWidth | 実数 |  | .clip 719/719 | 65.79〜12614（40+ 種） | ○ | 確認済み | キャンバスの大きさ（CanvasUnit の単位）。画素数は解像度から計算して偶数丸め |
| CanvasWorkTime | 整数 |  | .clip 140/106 | 0〜219125972（40+ 種） | ○ | 推測 | 作業時間（秒） |
| ComicBindPosition | 整数 |  | .clip 534/509 | 0〜1（2 種） | ○ | 確認済み | 綴じる位置（1 右綴じ、0 左綴じ）。.cmc の Project の写しで、CSP はページを開いたときに直す（V8） |
| ComicHasComicCover | 整数 |  | .clip 534/144 | 0〜1（2 種） | ○ | 確認済み | 作品に表紙がある（表紙ありの作品では本文のページも 1。V8） |
| ComicHasDoubleCover | 整数 |  | .clip 534/112 | 0〜1（2 種） | ○ | 推測 | 表紙が見開き |
| ComicIsLeftPage | 整数 |  | .clip 534/184 | 0〜1（2 種） | ○ | 確認済み | 左のページ（位置が偶数なら左、右から始まる作品では逆）。CSP はページを開いたときに直す（V8） |
| ComicNombreLayerCreated | 整数 |  | .clip 202/126 | 0〜1（2 種） |  | 推測 | ノンブルのレイヤーを作った（Right は見開きの右） |
| ComicNombreRightLayerCreated | 整数 |  | .clip 146/76 | 0〜1（2 種） |  | 推測 | ノンブルのレイヤーを作った（Right は見開きの右） |
| ComicPageIndex | 整数 |  | .clip 534/392 | 0〜41（40 種） | ○ | 確認済み | 作品の中のページの位置（0 から、見開きは 2 ページ分）。ノンブルの番号は ComicStoryNombreStart + これ |
| ComicStoryAuthorName | 文字列 |  | .clip 534/400 | 長さ ≤ 6 | ○ | 確認済み | 作品名・サブタイトル・作者名（文字列） |
| ComicStoryAuthorPosition | 整数 |  | .clip 534/534 | 2 | ○ | 推測 | 作品名・作者名・ページ番号・ノンブルを置く位置（コーナーの番号） |
| ComicStoryBackupNombreColor | 整数 |  | — |  |  | 推測 | ノンブルの設定の控え（Nombre* と同じ書式）。コーパスでは未設定 |
| ComicStoryBackupNombreEdgeUnit | 整数 |  | — |  |  | 推測 | ノンブルの設定の控え（Nombre* と同じ書式）。コーパスでは未設定 |
| ComicStoryBackupNombreEdgeWidth | 実数 |  | — |  |  | 推測 | ノンブルの設定の控え（Nombre* と同じ書式）。コーパスでは未設定 |
| ComicStoryBackupNombreFont | 文字列 |  | — |  |  | 推測 | ノンブルの設定の控え（Nombre* と同じ書式）。コーパスでは未設定 |
| ComicStoryBackupNombreFontSize | 実数 |  | — |  |  | 推測 | ノンブルの設定の控え（Nombre* と同じ書式）。コーパスでは未設定 |
| ComicStoryBackupNombrePosition | 整数 |  | — |  |  | 推測 | ノンブルの設定の控え（Nombre* と同じ書式）。コーパスでは未設定 |
| ComicStoryBackupNombreUseEdge | 整数 |  | — |  |  | 推測 | ノンブルの設定の控え（Nombre* と同じ書式）。コーパスでは未設定 |
| ComicStoryLayerCreated | 整数 |  | .clip 407/402 | 0〜1（2 種） |  | 確認済み | 作品情報のレイヤー（LayerType 800）を作った |
| ComicStoryNeedRefresh | 整数 |  | — |  |  | 推測 | 作品情報を描き直す必要がある |
| ComicStoryNombreColor | 整数 |  | .clip 534/0 | 0 | ○ | 推測 | ノンブルの色、フチを付けるか、フチの幅と単位 |
| ComicStoryNombreEdgeUnit | 整数 |  | .clip 534/534 | 2 | ○ | 推測 | ノンブルの色、フチを付けるか、フチの幅と単位 |
| ComicStoryNombreEdgeWidth | 実数 |  | .clip 534/534 | 0.3〜0.5（2 種） | ○ | 推測 | ノンブルの色、フチを付けるか、フチの幅と単位 |
| ComicStoryNombreFont | 文字列 |  | .clip 534/534 | 長さ ≤ 15 | ○ | 推測 | ノンブルの書体（名前・PostScript 名）と大きさ（pt） |
| ComicStoryNombreFontPostScriptName | 文字列 |  | .clip 534/534 | 長さ ≤ 13 | ○ | 推測 | ノンブルの書体（名前・PostScript 名）と大きさ（pt） |
| ComicStoryNombreFontSize | 実数 |  | .clip 534/534 | 9 | ○ | 推測 | ノンブルの書体（名前・PostScript 名）と大きさ（pt） |
| ComicStoryNombrePosition | 整数 |  | .clip 534/534 | 5〜6（2 種） | ○ | 推測 | 作品名・作者名・ページ番号・ノンブルを置く位置（コーナーの番号） |
| ComicStoryNombrePrefix | 文字列 |  | .clip 534/0 |  | ○ | 推測 | ノンブルの開始番号と前後の文字 |
| ComicStoryNombreStart | 整数 |  | .clip 534/534 | 1 | ○ | 推測 | ノンブルの開始番号と前後の文字 |
| ComicStoryNombreSuffix | 文字列 |  | .clip 534/0 |  | ○ | 推測 | ノンブルの開始番号と前後の文字 |
| ComicStoryNombreUseEdge | 整数 |  | .clip 534/68 | 0〜1（2 種） | ○ | 推測 | ノンブルの色、フチを付けるか、フチの幅と単位 |
| ComicStoryPageNumberPosition | 整数 |  | .clip 534/534 | 3 | ○ | 推測 | 作品名・作者名・ページ番号・ノンブルを置く位置（コーナーの番号） |
| ComicStoryPageNumberStart | 整数 |  | .clip 534/534 | 1 | ○ | 推測 | ページ番号の開始と表示 |
| ComicStoryRightLayerCreated | 整数 |  | .clip 270/270 | 1 |  | 推測 | 見開きの右ページの作品情報のレイヤーを作った |
| ComicStoryStoryIndex | 整数 |  | .clip 534/527 | 0〜11（12 種） | ○ | 推測 | 話数と、話数を表示するか |
| ComicStoryStoryName | 文字列 |  | .clip 534/378 | 長さ ≤ 22 | ○ | 確認済み | 作品名・サブタイトル・作者名（文字列） |
| ComicStoryStoryPosition | 整数 |  | .clip 534/534 | 1 | ○ | 推測 | 作品名・作者名・ページ番号・ノンブルを置く位置（コーナーの番号） |
| ComicStorySubTitle | 文字列 |  | .clip 534/20 | 長さ ≤ 12 | ○ | 確認済み | 作品名・サブタイトル・作者名（文字列） |
| ComicStoryUseHiddenNombre | 整数 |  | .clip 534/92 | 0〜1（2 種） | ○ | 推測 | 隠しノンブルと見えるノンブルを付けるか |
| ComicStoryUsePageNumber | 整数 |  | .clip 534/0 | 0 | ○ | 推測 | ページ番号の開始と表示 |
| ComicStoryUseShownNombre | 整数 |  | .clip 534/41 | 0〜1（2 種） | ○ | 推測 | 隠しノンブルと見えるノンブルを付けるか |
| ComicStoryUseStoryIndex | 整数 |  | .clip 534/267 | 0〜1（2 種） | ○ | 推測 | 話数と、話数を表示するか |
| ComicStoryXPageNombreOffset | 未登録 |  | .clip 534/0 | 0 | ○ | 推測 | ノンブルの仕上がり線からの距離と単位 |
| ComicStoryXPageNombreOffsetUnit | 未登録 |  | .clip 534/534 | 2 | ○ | 推測 | ノンブルの仕上がり線からの距離と単位 |
| ComicStoryYPageNombreOffset | 実数 |  | .clip 534/534 | 5 | ○ | 推測 | ノンブルの仕上がり線からの距離と単位 |
| ComicStoryYPageNombreOffsetUnit | 整数 |  | .clip 534/534 | 2 | ○ | 推測 | ノンブルの仕上がり線からの距離と単位 |
| CropFrameCropOffsetX | 整数 |  | .clip 467/2 | 0〜0.1654（2 種） | ○ | 推測 | 仕上がりの位置のずれ |
| CropFrameCropOffsetY | 整数 |  | .clip 467/2 | 0〜0.2126（2 種） | ○ | 推測 | 仕上がりの位置のずれ |
| CropFrameDesignationType | 整数 |  | .clip 467/465 | 1 | ○ | 推測 | トンボの指定の方法 |
| CropFrameDitch | 実数 |  | .clip 467/463 | 0〜118（6 種） | ○ | 確認済み | 裁ち落とし幅 |
| CropFrameHeight | 実数 |  | .clip 467/465 | 55〜7016（17 種） | ○ | 確認済み | 仕上がりの大きさ（CropFrameUnitKind の単位） |
| CropFrameInnerHeight | 実数 |  | .clip 467/465 | 49〜6331（16 種） | ○ | 確認済み | 基本枠の大きさ |
| CropFrameInnerOffsetBasePosition | 整数 |  | .clip 467/402 | 0〜4（3 種） | ○ | 推測 | 基本枠の位置（基準の位置とずれ） |
| CropFrameInnerOffsetX | 実数 |  | .clip 467/0 | 0 | ○ | 推測 | 基本枠の位置（基準の位置とずれ） |
| CropFrameInnerOffsetY | 実数 |  | .clip 467/0 | 0 | ○ | 推測 | 基本枠の位置（基準の位置とずれ） |
| CropFrameInnerWidth | 実数 |  | .clip 467/465 | 85〜4252（15 種） | ○ | 確認済み | 基本枠の大きさ |
| CropFrameMergeDitch | 実数 |  | .clip 467/73 | -1〜2.34（6 種） | ○ | 推測 | 見開きの合わせの幅（−1 は既定） |
| CropFrameOptionFlag | 整数 |  | .clip 467/464 | 0〜514（8 種） | ○ | 確認済み | ページの種類とトンボ（ビット。1 見開き、2 左、4 右、16 トンボを合わせる）。新規作成の見開きは 3、見開きに変更したものは 17。CSP はページを開いたときに直す（V8） |
| CropFrameSafeMarginBottom | 整数 |  | .clip 467/0 | 0 | ○ | 推測 | 安全マージン（上下左右） |
| CropFrameSafeMarginLeft | 整数 |  | .clip 467/0 | 0 | ○ | 推測 | 安全マージン（上下左右） |
| CropFrameSafeMarginRight | 整数 |  | .clip 467/0 | 0 | ○ | 推測 | 安全マージン（上下左右） |
| CropFrameSafeMarginTop | 整数 |  | .clip 467/0 | 0 | ○ | 推測 | 安全マージン（上下左右） |
| CropFrameShow | 整数 |  | .clip 541/440 | 0〜1（2 種） | ○ | 推測 | トンボを表示する |
| CropFrameUnitKind | 整数 |  | .clip 467/459 | 0〜2（2 種） | ○ | 確認済み | トンボの単位（CanvasUnit と同じ番号） |
| CropFrameWidth | 実数 |  | .clip 467/465 | 91〜4961（20 種） | ○ | 確認済み | 仕上がりの大きさ（CropFrameUnitKind の単位） |
| GridDitch | 実数 |  | .clip 19/19 | 5〜1000（6 種） |  | 推測 | グリッド（間隔・分割数・原点と単位） |
| GridDitchUnit | 整数 |  | .clip 19/13 | 0〜2（2 種） |  | 推測 | グリッド（間隔・分割数・原点と単位） |
| GridDivide | 整数 |  | .clip 19/19 | 1〜10（4 種） |  | 推測 | グリッド（間隔・分割数・原点と単位） |
| GridOriginType | 整数 |  | .clip 19/19 | 1〜2（2 種） |  | 推測 | グリッド（間隔・分割数・原点と単位） |
| GridOriginX | 実数 |  | .clip 19/0 | 0 |  | 推測 | グリッド（間隔・分割数・原点と単位） |
| GridOriginXUnit | 整数 |  | .clip 19/0 | 0 |  | 推測 | グリッド（間隔・分割数・原点と単位） |
| GridOriginY | 実数 |  | .clip 19/0 | 0 |  | 推測 | グリッド（間隔・分割数・原点と単位） |
| GridOriginYUnit | 整数 |  | .clip 19/0 | 0 |  | 推測 | グリッド（間隔・分割数・原点と単位） |
| LightTableEnable | 整数 |  | — |  |  | 推測 | ライトテーブル（アニメーション）の設定と回転の中心 |
| LightTableEnableWhenSave | 整数 |  | — |  |  | 推測 | ライトテーブル（アニメーション）の設定と回転の中心 |
| LightTableFixTarget | 整数 |  | — |  |  | 推測 | ライトテーブル（アニメーション）の設定と回転の中心 |
| LightTableReferCommonOpacity | 整数 |  | — |  |  | 推測 | ライトテーブル（アニメーション）の設定と回転の中心 |
| LightTableRotateCenterX | 実数 |  | .clip 1/1 | 1654 |  | 推測 | ライトテーブル（アニメーション）の設定と回転の中心 |
| LightTableRotateCenterY | 実数 |  | .clip 1/1 | 2338 |  | 推測 | ライトテーブル（アニメーション）の設定と回転の中心 |
| OnionSkinBehindColorBlue | 整数 |  | — |  | ○ | 推測 | オニオンスキン（前後のセルの色・数・不透明度） |
| OnionSkinBehindColorGreen | 整数 |  | — |  | ○ | 推測 | オニオンスキン（前後のセルの色・数・不透明度） |
| OnionSkinBehindColorRed | 整数 |  | — |  | ○ | 推測 | オニオンスキン（前後のセルの色・数・不透明度） |
| OnionSkinFrontColorBlue | 整数 |  | — |  | ○ | 推測 | オニオンスキン（前後のセルの色・数・不透明度） |
| OnionSkinFrontColorGreen | 整数 |  | — |  | ○ | 推測 | オニオンスキン（前後のセルの色・数・不透明度） |
| OnionSkinFrontColorRed | 整数 |  | — |  | ○ | 推測 | オニオンスキン（前後のセルの色・数・不透明度） |
| OnionSkinHalfColor | 整数 |  | — |  | ○ | 推測 | オニオンスキン（前後のセルの色・数・不透明度） |
| OnionSkinNextDisplayCount | 整数 |  | — |  | ○ | 推測 | オニオンスキン（前後のセルの色・数・不透明度） |
| OnionSkinPrevDisplayCount | 整数 |  | — |  | ○ | 推測 | オニオンスキン（前後のセルの色・数・不透明度） |
| OnionSkinSettingRegisted | 整数 |  | — |  |  | 推測 | オニオンスキン（前後のセルの色・数・不透明度） |
| OnionSkinStartOpacity | 整数 |  | — |  | ○ | 推測 | オニオンスキン（前後のセルの色・数・不透明度） |
| OnionSkinStatus | 整数 |  | — |  | ○ | 推測 | オニオンスキン（前後のセルの色・数・不透明度） |
| OnionSkinStepOpaciy | 整数 |  | — |  | ○ | 推測 | オニオンスキン（前後のセルの色・数・不透明度） |
| OnionSkinUseColor | 整数 |  | — |  | ○ | 推測 | オニオンスキン（前後のセルの色・数・不透明度） |
| OnionSkinUseOpacity | 整数 |  | — |  | ○ | 推測 | オニオンスキン（前後のセルの色・数・不透明度） |
| RulerRotateCenterX | 実数 |  | — |  |  | 推測 | 定規の回転の中心 |
| RulerRotateCenterY | 実数 |  | — |  |  | 推測 | 定規の回転の中心 |
| SafeFrameShow | 未登録 |  | .clip 540/95 | 0〜1（2 種） | ○ | 推測 | 安全マージンの枠を表示する |
| ShowGrid | 整数 |  | .clip 22/9 | 0〜1（2 種） |  | 推測 | グリッドを表示する |
| ShowToneArea | 整数 |  | .clip 1/0 | 0 |  | 推測 | トーン範囲を表示する（画像と一緒に） |
| ShowToneAreaWithImage | 整数 |  | — |  |  | 推測 | トーン範囲を表示する（画像と一緒に） |
| TimeLapseCodec | 整数 |  | .clip 8/2 | 0〜2（3 種） | ○ | 推測 | タイムラプスの形式と記録（TimeLapseManager.MainId） |
| TimeLapseManagerIndex | 整数 | TimeLapseManager | .clip 24/22 | 1〜4（4 種） |  | 推測 | タイムラプスの形式と記録（TimeLapseManager.MainId） |
| TimeLineEditMode | 整数 |  | — |  |  | 推測 | タイムラインの表示と編集の設定 |
| TimeLineFrameDisplay | 整数 |  | — |  |  | 推測 | タイムラインの表示と編集の設定 |
| TimeLineNameFormat | 整数 |  | — |  |  | 推測 | タイムラインの表示と編集の設定 |
| TimeLineResizeQuality | 整数 |  | — |  |  | 推測 | タイムラインの表示と編集の設定 |
| TimeLineUseNameFormat | 整数 |  | — |  |  | 推測 | タイムラインの表示と編集の設定 |

## Canvas3DModelBank

キャンバスが持つ 3D モデルの保管庫（外部チャンク）。`ElemScheme.MaxIndex` は最大 2。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 17/17 | 1 | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 17/17 | 1〜2（2 種） | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| BankData | BLOB | 外部チャンク | — |  | ○ | 未解明 |  |
| BankId | 整数 |  | .clip 17/17 | 1 |  | 推測 | 3D モデルの保管庫の番号、最初の読み込み、モデルのデータ（外部チャンク）、種類 |
| FirstLoaderIndex | 整数 | Canvas3DModelLoader | .clip 17/4 | 0〜2（3 種） |  | 推測 | 3D モデルの保管庫の番号、最初の読み込み、モデルのデータ（外部チャンク）、種類 |

## Canvas3DModelLoader

3D モデルの読み込み（外部チャンク）。`ElemScheme.MaxIndex` は最大 2。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 5/4 | 1 | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 5/4 | 1〜2（2 種） | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| BankId | 整数 |  | .clip 5/4 | 1 |  | 推測 | 3D モデルの保管庫の番号、最初の読み込み、モデルのデータ（外部チャンク）、種類 |
| ModelData | BLOB | 外部チャンク | .clip 5/4 | 長さ ≤ 40 | ○ | 推測 | 3D モデルの保管庫の番号、最初の読み込み、モデルのデータ（外部チャンク）、種類 |
| ModelType | 整数 |  | .clip 5/4 | 1 |  | 推測 | 3D モデルの保管庫の番号、最初の読み込み、モデルのデータ（外部チャンク）、種類 |
| ModelUuid | 文字列 |  | .clip 5/4 | 長さ ≤ 36 |  | 推測 | UUID |
| NextIndex | 整数 |  | .clip 5/0 | 0 | ○ | 確認済み | 同じ並びの次の行の MainId（連結リスト、0 で終わり） |

## CanvasItem

素材の保管庫（キャンバスに貼った素材）の項目。`ElemScheme.MaxIndex` は最大 3。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 719/4 | 1 | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 5/4 | 1〜3（3 種） | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| BankId | 整数 |  | .clip 5/4 | 1 |  | 推測 | 素材の項目（保管庫、表示名、データの持ち方、種類、次、直接の登録、3D の ID） |
| CanvasItemSourceFileName | 文字列 |  | .clip 1/0 |  |  | 推測 | 素材の出どころ（ファイル名、素材の配布の ID・版・所有者） |
| CanvasItemSourceIsMadeByCanvasItemMaker | 整数 |  | .clip 1/0 | 0 |  | 推測 | 素材の出どころ（ファイル名、素材の配布の ID・版・所有者） |
| CanvasItemSourceMaterialAssetsContentId | 整数 |  | .clip 1/0 | 0 |  | 推測 | 素材の出どころ（ファイル名、素材の配布の ID・版・所有者） |
| CanvasItemSourceMaterialIsUploadable | 整数 |  | .clip 1/1 | 1 |  | 推測 | 素材の出どころ（ファイル名、素材の配布の ID・版・所有者） |
| CanvasItemSourceMaterialOwnerUserId | 整数 |  | .clip 1/0 | 0 |  | 推測 | 素材の出どころ（ファイル名、素材の配布の ID・版・所有者） |
| CanvasItemSourceMaterialRevision | 文字列 |  | .clip 1/0 |  |  | 推測 | 素材の出どころ（ファイル名、素材の配布の ID・版・所有者） |
| ItemBinaryMainIndex | 整数 | CanvasItemBinary | — |  |  | 未解明 |  |
| ItemCaption | 文字列 |  | .clip 5/4 | 長さ ≤ 10 |  | 推測 | 素材の項目（保管庫、表示名、データの持ち方、種類、次、直接の登録、3D の ID） |
| ItemDataHoldMethod | 文字列 |  | .clip 5/4 | 長さ ≤ 4 |  | 推測 | 素材の項目（保管庫、表示名、データの持ち方、種類、次、直接の登録、3D の ID） |
| ItemExternalFilePath | BLOB |  | — |  |  | 未解明 |  |
| ItemExternalFilePathType | 整数 |  | — |  |  | 未解明 |  |
| ItemFileExtension | 文字列 |  | — |  |  | 未解明 |  |
| ItemImportDay | 整数 |  | .clip 5/0 | 0 |  | 推測 | 素材を読み込んだ日時と番号 |
| ItemImportHour | 整数 |  | .clip 5/0 | 0 |  | 推測 | 素材を読み込んだ日時と番号 |
| ItemImportIndex | 整数 |  | .clip 5/0 | 0 |  | 推測 | 素材を読み込んだ日時と番号 |
| ItemImportMinute | 整数 |  | .clip 5/0 | 0 |  | 推測 | 素材を読み込んだ日時と番号 |
| ItemImportMonth | 整数 |  | .clip 5/0 | 0 |  | 推測 | 素材を読み込んだ日時と番号 |
| ItemImportSecond | 整数 |  | .clip 5/0 | 0 |  | 推測 | 素材を読み込んだ日時と番号 |
| ItemImportYear | 整数 |  | .clip 5/0 | 0 |  | 推測 | 素材を読み込んだ日時と番号 |
| ItemNextItemMainIndex | 整数 | CanvasItem | .clip 5/0 | 0 |  | 推測 | 素材の項目（保管庫、表示名、データの持ち方、種類、次、直接の登録、3D の ID） |
| ItemRegistedDirect | 整数 |  | .clip 5/0 | 0 |  | 推測 | 素材の項目（保管庫、表示名、データの持ち方、種類、次、直接の登録、3D の ID） |
| ItemThumbnail | BLOB |  | — |  |  | 未解明 |  |
| ItemType | 文字列 |  | .clip 5/4 | 長さ ≤ 13 |  | 推測 | 素材の項目（保管庫、表示名、データの持ち方、種類、次、直接の登録、3D の ID） |
| ItemUuid | 文字列 |  | .clip 5/4 | 長さ ≤ 36 |  | 推測 | UUID |
| ItemVersion | 整数 |  | — |  |  | 未解明 |  |
| kLabelItem3DDataID | 文字列 |  | .clip 5/4 | 長さ ≤ 36 |  | 推測 | 素材の項目（保管庫、表示名、データの持ち方、種類、次、直接の登録、3D の ID） |

## CanvasItemBank

素材の保管庫。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 719/719 | 1 | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 719/719 | 1 | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| BankRootItemMainIndex | 整数 | CanvasItem | .clip 719/4 | 0〜3（4 種） | ○ | 推測 | 最初の素材（CanvasItem）と 3D モデルの保管庫（Canvas3DModelBank） |
| ModelBankMainIndex | 整数 | Canvas3DModelBank | .clip 719/17 | 0〜2（3 種） | ○ | 推測 | 最初の素材（CanvasItem）と 3D モデルの保管庫（Canvas3DModelBank） |

## CanvasItemBinary

素材の中身（外部チャンク）。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| BankId | 整数 |  | — |  |  | 未解明 |  |
| ItemBinaryData | BLOB | 外部チャンク | — |  | ○ | 未解明 |  |
| ItemId | 整数 |  | — |  | ○ | 未解明 |  |

## CanvasNode

.cmc のページ（連結リスト）。.clip では使わない。`ElemScheme.MaxIndex` は最大 50。コア領域。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .cmc 42/42 | 1〜47（40+ 種） | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .cmc 42/42 | 1〜47（40+ 種） | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| BookBindMemo | 文字列 |  | .cmc 42/0 |  | ○ | 推測 | ページのメモと製本のメモ。コーパスと CSP で作った作品のどれでも空（製本リストの「印刷はありません」などは CSP が表示するだけ） |
| BookBindWarning | 整数 |  | .cmc 42/38 | 0〜1049392（14 種） | ○ | 確認済み | 製本リストの確認の印（ビット。2 裁ち落とし幅が基本設定と違う、8 解像度が同人誌印刷所で受け付けられない、16 ノンブルが仕上がりの外、32 テキストが仕上がりの外か近く、1048576 本文ページがカラー。見開きの 2 ページ目の 16・32 は 256・512）。CSP が計算して書く（V8） |
| BookBindWarningDef | 整数 |  | .cmc 42/42 | 0〜1（2 種） | ○ | 推測 | 製本の確認の既定を使う。CSP が作る作品ではルート 0、ページ 1（V8） |
| CanvasIndex | 整数 | Canvas | .cmc 42/0 | 0 | ○ | 推測 | キャンバスの番号。コーパスでは常に 0 |
| CanvasThumbnail | 整数 | Mipmap | — |  |  | 推測 | ページの名前とサムネイル。コーパスでは未設定 |
| FirstChildIndex | 整数 |  | .cmc 42/42 | 0〜39（5 種） | ○ | 確認済み | ルートの最初のページ（CanvasNode.MainId） |
| LinkHeight | 実数 |  | .cmc 25/24 | 0〜420（6 種） |  | 確認済み | ページのファイルの単位・大きさ・解像度の控え（LinkWrite* と同時に CSP が書く。V8） |
| LinkIsFolder | 整数 |  | .cmc 25/0 | 0 |  | 推測 | リンク先がフォルダー（CSP が書く作品では 0） |
| LinkPath | 文字列 |  | .cmc 42/42 | 長さ ≤ 15 | ○ | 確認済み | ページのファイル（.cmc のフォルダーからの相対、".:pageNNNN.clip" の形） |
| LinkResolution | 実数 |  | .cmc 25/25 | 72〜600（4 種） |  | 確認済み | ページのファイルの単位・大きさ・解像度の控え（LinkWrite* と同時に CSP が書く。V8） |
| LinkUnit | 整数 |  | .cmc 25/24 | 0〜2（2 種） |  | 確認済み | ページのファイルの単位・大きさ・解像度の控え（LinkWrite* と同時に CSP が書く。V8） |
| LinkWidth | 実数 |  | .cmc 25/24 | 0〜594（10 種） |  | 確認済み | ページのファイルの単位・大きさ・解像度の控え（LinkWrite* と同時に CSP が書く。V8） |
| LinkWriteDay | 整数 |  | .cmc 25/25 | -1938737616〜820195502（33 種） |  | 確認済み | ページのファイルの保存日時（年月日時分秒、PC の時刻）。新規作成の作品にはなく、作品の基本設定を変えると CSP が列を足して書く。古い形式では値が崩れていることがある（V8） |
| LinkWriteHour | 整数 |  | .cmc 25/25 | -15978261〜532（27 種） |  | 確認済み | ページのファイルの保存日時（年月日時分秒、PC の時刻）。新規作成の作品にはなく、作品の基本設定を変えると CSP が列を足して書く。古い形式では値が崩れていることがある（V8） |
| LinkWriteMinute | 整数 |  | .cmc 25/25 | -1938741776〜810057731（40+ 種） |  | 確認済み | ページのファイルの保存日時（年月日時分秒、PC の時刻）。新規作成の作品にはなく、作品の基本設定を変えると CSP が列を足して書く。古い形式では値が崩れていることがある（V8） |
| LinkWriteMonth | 整数 |  | .cmc 25/24 | 0〜6041805（13 種） |  | 確認済み | ページのファイルの保存日時（年月日時分秒、PC の時刻）。新規作成の作品にはなく、作品の基本設定を変えると CSP が列を足して書く。古い形式では値が崩れていることがある（V8） |
| LinkWriteSecond | 整数 |  | .cmc 25/25 | 0〜813641830（40+ 種） |  | 確認済み | ページのファイルの保存日時（年月日時分秒、PC の時刻）。新規作成の作品にはなく、作品の基本設定を変えると CSP が列を足して書く。古い形式では値が崩れていることがある（V8） |
| LinkWriteYear | 整数 |  | .cmc 25/25 | 0〜816591073（8 種） |  | 確認済み | ページのファイルの保存日時（年月日時分秒、PC の時刻）。新規作成の作品にはなく、作品の基本設定を変えると CSP が列を足して書く。古い形式では値が崩れていることがある（V8） |
| Memo | 文字列 |  | .cmc 42/0 |  | ○ | 推測 | ページのメモと製本のメモ。コーパスと CSP で作った作品のどれでも空（製本リストの「印刷はありません」などは CSP が表示するだけ） |
| Name | 文字列 |  | — |  | ○ | 推測 | ページの名前とサムネイル。コーパスでは未設定 |
| NextIndex | 整数 |  | .cmc 42/42 | 0〜47（40+ 種） | ○ | 確認済み | 同じ並びの次の行の MainId（連結リスト、0 で終わり） |
| PageFlag | 整数 |  | .cmc 42/40 | 0〜1（2 種） | ○ | 確認済み | 1 で見開きのページ |
| SelectedIndex | 整数 |  | .cmc 42/42 | 0〜4（4 種） | ○ | 確認済み | 選んでいるページ（CanvasNode.MainId） |
| Type | 未登録 |  | .cmc 42/42 | 0〜2（2 種） | ○ | 確認済み | 節点の種類（0 ルート、2 ページ） |

## CanvasPreview

ファイル全体の縮小画像（PNG）。コア領域。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 719/719 | 1 | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 719/719 | 1 | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| CanvasId | 整数 |  | .clip 719/719 | 1〜2（2 種） | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| ImageData | BLOB |  | .clip 719/719 | 長さ ≤ 7304903 | ○ | 確認済み | ファイル全体の縮小画像（PNG） |
| ImageHeight | 整数 |  | .clip 719/719 | 646〜2500（40+ 種） | ○ | 確認済み | 縮小画像の大きさ（px）。ImageWidth は BLOB 型で登録されているが整数が入る |
| ImageType | 整数 |  | .clip 719/719 | 1 | ○ | 確認済み | 形式（1 PNG） |
| ImageWidth | BLOB |  | .clip 719/719 | 638〜3112（40+ 種） | ○ | 確認済み | 縮小画像の大きさ（px）。ImageWidth は BLOB 型で登録されているが整数が入る |

## CharacterInfo

3D キャラクター。`ElemScheme.MaxIndex` は最大 2。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| CanvasId | 整数 |  | — |  | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| CanvasItemSourceFileName | 文字列 |  | — |  |  | 推測 | 素材の出どころ（ファイル名、素材の配布の ID・版・所有者） |
| CanvasItemSourceIsMadeByCanvasItemMaker | 整数 |  | — |  |  | 推測 | 素材の出どころ（ファイル名、素材の配布の ID・版・所有者） |
| CanvasItemSourceMaterialAssetsContentId | 整数 |  | — |  |  | 推測 | 素材の出どころ（ファイル名、素材の配布の ID・版・所有者） |
| CanvasItemSourceMaterialIsUploadable | 整数 |  | — |  |  | 推測 | 素材の出どころ（ファイル名、素材の配布の ID・版・所有者） |
| CanvasItemSourceMaterialOwnerUserId | 整数 |  | — |  |  | 推測 | 素材の出どころ（ファイル名、素材の配布の ID・版・所有者） |
| CanvasItemSourceMaterialRevision | 文字列 |  | — |  |  | 推測 | 素材の出どころ（ファイル名、素材の配布の ID・版・所有者） |
| CharacterGUIOpened | 整数 |  | — |  |  | 推測 | パレットでの開閉と表示名 |
| CharacterUUID | 文字列 |  | — |  |  | 推測 | UUID |
| LayerId | 整数 |  | — |  | ○ | 確認済み | 属するレイヤー（Layer.MainId）。0 はキャンバス全体のもの（用紙など） |
| LayerObjectId | 整数 |  | — |  |  | 推測 | 属する 3D オブジェクト（LayerObject.MainId） |
| PoseMotionIsMadeByMaterialOwner | 整数 |  | — |  |  | 未解明 |  |
| PoseMotionSourceFileName | 文字列 |  | — |  |  | 未解明 |  |
| PoseMotionSourceMaterialAssetsContentId | 整数 |  | — |  |  | 未解明 |  |
| PoseMotionSourceMaterialIsUploadable | 整数 |  | — |  |  | 未解明 |  |
| PoseMotionSourceMaterialOwnerUserId | 整数 |  | — |  |  | 未解明 |  |
| PoseMotionSourceMaterialRevision | 文字列 |  | — |  |  | 未解明 |  |

## DessinDollInfo

3D デッサン人形。`ElemScheme.MaxIndex` は最大 12。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 13/13 | 1〜12（12 種） | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 13/13 | 1〜12（12 種） | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| CanvasId | 整数 |  | .clip 13/13 | 1 | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| DessindollGUIOpened | 整数 |  | .clip 1/0 | 0 |  | 推測 | パレットでの開閉と表示名 |
| DessindollUUID | 文字列 |  | .clip 13/13 | 長さ ≤ 36 |  | 推測 | UUID |
| LayerId | 整数 |  | .clip 13/13 | 10〜46（6 種） | ○ | 確認済み | 属するレイヤー（Layer.MainId）。0 はキャンバス全体のもの（用紙など） |
| LayerObjectId | 整数 |  | .clip 13/13 | 2〜20（14 種） |  | 推測 | 属する 3D オブジェクト（LayerObject.MainId） |

## ExternalChunk

外部チャンク（CHNKExta）の ID と、ファイル内の位置。コア領域。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| ExternalID | 未登録 |  | .clip 719/719 | 長さ ≤ 40 | ○ | 確認済み | 外部チャンクの ID（40 文字の文字列。全 719 件で TEXT） |
| Offset | 未登録 |  | .clip 719/719 | 80〜1415379549（40+ 種） | ○ | 確認済み | ファイルの先頭から CHNKExta までのバイト数（V1 で全件一致） |

## FillStyle

塗りの設定（ベクターの塗り）。`ElemScheme.MaxIndex` は最大 87。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 199/199 | 1〜5（5 種） | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 199/199 | 1〜87（13 種） | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| AntiAlias | 整数 |  | .clip 199/0 | 0 | ○ | 推測 | 塗りのアンチエイリアス・合成モード・設定のビット・テクスチャの濃度 |
| CanvasId | 整数 |  | .clip 199/199 | 1 | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| CompositeMode | 整数 |  | .clip 199/183 | 0〜31（3 種） |  | 推測 | 塗りのアンチエイリアス・合成モード・設定のビット・テクスチャの濃度 |
| NextIndex | 整数 |  | .clip 199/172 | 0〜87（12 種） | ○ | 確認済み | 同じ並びの次の行の MainId（連結リスト、0 で終わり） |
| StyleFlag | 整数 |  | .clip 199/0 | 0 | ○ | 推測 | 塗りのアンチエイリアス・合成モード・設定のビット・テクスチャの濃度 |
| TextureDensity | 整数 |  | .clip 199/199 | 1 |  | 推測 | 塗りのアンチエイリアス・合成モード・設定のビット・テクスチャの濃度 |

## FolderInfo

3D オブジェクトのフォルダー。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 1/1 | 1 | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 1/1 | 2 | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| CanvasId | 整数 |  | .clip 1/1 | 1 | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| FolderChildCount | 整数 |  | .clip 1/0 | 0 |  | 推測 | 3D オブジェクトのフォルダーの子の数 |
| FolderGUIOpened | 整数 |  | .clip 1/0 | 0 |  | 推測 | パレットでの開閉と表示名 |
| FolderObjectUUID | 文字列 |  | .clip 1/1 | 長さ ≤ 36 |  | 推測 | UUID |
| LayerId | 整数 |  | .clip 1/1 | 46 | ○ | 確認済み | 属するレイヤー（Layer.MainId）。0 はキャンバス全体のもの（用紙など） |
| LayerObjectId | 整数 |  | .clip 1/1 | 6 |  | 推測 | 属する 3D オブジェクト（LayerObject.MainId） |

## Layer

レイヤー。LayerFirstChildIndex と LayerNextIndex で木になる。`ElemScheme.MaxIndex` は最大 2467。コア領域。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 719/719 | 1〜944（40+ 種） | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 719/719 | 1〜2467（40+ 種） | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| AnimationCaptionAttribute | BLOB |  | — |  |  | 推測 | アニメーションのフォルダー・セル・字幕・音声 |
| AnimationCaptionUseAttributeType | 整数 |  | — |  |  | 推測 | アニメーションのフォルダー・セル・字幕・音声 |
| AnimationCelCurrentUuid | 文字列 |  | — |  |  | 推測 | アニメーションのフォルダー・セル・字幕・音声 |
| AnimationFolder | 整数 |  | — |  | ○ | 確認済み | アニメーションフォルダー（子のレイヤーがセル） |
| AudioLayer | 整数 |  | — |  |  | 推測 | アニメーションのフォルダー・セル・字幕・音声 |
| BankItemUuid | 文字列 |  | .clip 15/10 | 長さ ≤ 144 |  | 推測 | 素材として登録したときの UUID |
| Camera2DApplyTransform | 整数 |  | — |  |  | 推測 | 2D カメラ（アニメーション） |
| Camera2DOriginalFrameCenterX | 実数 |  | — |  |  | 推測 | 2D カメラ（アニメーション） |
| Camera2DOriginalFrameCenterY | 実数 |  | — |  |  | 推測 | 2D カメラ（アニメーション） |
| Camera2DResizableImageInfo | BLOB |  | — |  |  | 推測 | 2D カメラ（アニメーション） |
| CanvasId | 整数 |  | .clip 719/719 | 1〜2（2 種） | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| ComicFrameColorTypeBlackChecked | 整数 |  | .clip 180/180 | 1 |  | 推測 | コマ枠の表現色と表示の色 |
| ComicFrameColorTypeIndex | 整数 |  | .clip 180/24 | 0〜2（3 種） |  | 推測 | コマ枠の表現色と表示の色 |
| ComicFrameColorTypeWhiteChecked | 整数 |  | .clip 180/180 | 1 |  | 推測 | コマ枠の表現色と表示の色 |
| ComicFrameLineMipmap | 整数 | Mipmap | .clip 195/180 | 10〜1242（40+ 種） | ○ | 確認済み | コマ枠の線の画素（Mipmap.MainId）。あればコマ枠フォルダー |
| ComicFramePreviewColorTypeApplyOpacity | 整数 |  | .clip 1/1 | 1 |  | 推測 | コマ枠の表現色と表示の色 |
| ComicFramePreviewColorTypeBlackChecked | 整数 |  | .clip 1/1 | 1 |  | 推測 | コマ枠の表現色と表示の色 |
| ComicFramePreviewColorTypeColorToAlpha | 整数 |  | .clip 1/1 | 1 |  | 推測 | コマ枠の表現色と表示の色 |
| ComicFramePreviewColorTypeIndex | 整数 |  | .clip 1/1 | 2 |  | 推測 | コマ枠の表現色と表示の色 |
| ComicFramePreviewColorTypeThresholdAlpha | 整数 |  | .clip 1/0 | 0 |  | 推測 | コマ枠の表現色と表示の色 |
| ComicFramePreviewColorTypeThresholdImage | 整数 |  | .clip 1/1 | 2147483648 |  | 推測 | コマ枠の表現色と表示の色 |
| ComicFramePreviewColorTypeThresholdMask | 整数 |  | — |  |  | 推測 | コマ枠の表現色と表示の色 |
| ComicFramePreviewColorTypeWhiteChecked | 整数 |  | .clip 1/1 | 1 |  | 推測 | コマ枠の表現色と表示の色 |
| ComicFrameUsePreviewColorType | 整数 |  | .clip 9/0 | 0 |  | 推測 | コマ枠の表現色と表示の色 |
| ComicStoryInfoForRightPage | 整数 |  | .clip 270/270 | 0〜1（2 種） |  | 推測 | 作品情報のレイヤーの種類（1 作品名・話数・作者名、2 ノンブル）と見開きの右ページ用か |
| ComicStoryInfoType | 整数 |  | .clip 426/426 | 1〜2（2 種） |  | 推測 | 作品情報のレイヤーの種類（1 作品名・話数・作者名、2 ノンブル）と見開きの右ページ用か |
| CropFrame | BLOB |  | — |  | ○ | 推測 | トンボ（BLOB） |
| CurrentLayerObjectUUID | 文字列 |  | .clip 15/10 | 長さ ≤ 36 |  | 確認済み | 3D レイヤーのオブジェクト（LayerObject.MainId）と選んでいるもの |
| DraftLayer | 整数 |  | .clip 719/0 |  |  | 推測 | 下描きレイヤー |
| DrawColorEnable | 整数 |  | .clip 707/705 | 1 | ○ | 確認済み | レイヤーカラー（描画色で表示する）を使う |
| DrawColorMainBlue | 整数 |  | .clip 707/693 | 0〜4294967295（40+ 種） | ○ | 確認済み | レイヤーの描画色（メイン・サブ）。32 ビットの値の上位 8 ビットが色の値 |
| DrawColorMainGreen | 整数 |  | .clip 707/693 | 0〜4294967295（40+ 種） | ○ | 確認済み | レイヤーの描画色（メイン・サブ）。32 ビットの値の上位 8 ビットが色の値 |
| DrawColorMainRed | 整数 |  | .clip 707/693 | 0〜4294967295（40+ 種） | ○ | 確認済み | レイヤーの描画色（メイン・サブ）。32 ビットの値の上位 8 ビットが色の値 |
| DrawColorSubBlue | 整数 |  | .clip 279/270 | 0〜4294967295（40+ 種） |  | 確認済み | レイヤーの描画色（メイン・サブ）。32 ビットの値の上位 8 ビットが色の値 |
| DrawColorSubGreen | 整数 |  | .clip 279/270 | 0〜4294967295（40+ 種） |  | 確認済み | レイヤーの描画色（メイン・サブ）。32 ビットの値の上位 8 ビットが色の値 |
| DrawColorSubRed | 整数 |  | .clip 279/270 | 0〜4294967295（40+ 種） |  | 確認済み | レイヤーの描画色（メイン・サブ）。32 ビットの値の上位 8 ビットが色の値 |
| DrawRenderThumbnailType | 整数 |  | .clip 707/707 | 20〜31（3 種） | ○ | 確認済み | 描き方の種類（内部の処理の番号）。レイヤーの種類ごとに決まった組（コーパスでは 30 がグラデーションの数、31 が用紙の数と同じ）。新規作成ではこの組を書く |
| DrawToMaskMipmapType | 整数 |  | .clip 195/180 | 10 |  | 推測 | マスクの描き方の種類（コマ枠フォルダーで 21・10・40） |
| DrawToMaskOffscreenType | 整数 |  | .clip 195/180 | 21 |  | 推測 | マスクの描き方の種類（コマ枠フォルダーで 21・10・40） |
| DrawToRenderMipmapType | 整数 |  | .clip 713/710 | 0〜40（6 種） | ○ | 確認済み | 描き方の種類（内部の処理の番号）。レイヤーの種類ごとに決まった組（コーパスでは 30 がグラデーションの数、31 が用紙の数と同じ）。新規作成ではこの組を書く |
| DrawToRenderOffscreenType | 整数 |  | .clip 717/715 | 10〜61（7 種） | ○ | 確認済み | 描き方の種類（内部の処理の番号）。レイヤーの種類ごとに決まった組（コーパスでは 30 がグラデーションの数、31 が用紙の数と同じ）。新規作成ではこの組を書く |
| DrawUpperMipmapForEdgeFlag | 未登録 |  | .clip 29/0 |  |  | 推測 | フチ・線・モノクロ・トーンを、上の段（縮小）のミップマップで描くかとその段 |
| DrawUpperMipmapForEdgeIndex | 未登録 |  | .clip 29/0 |  |  | 推測 | フチ・線・モノクロ・トーンを、上の段（縮小）のミップマップで描くかとその段 |
| DrawUpperMipmapForLineFlag | 未登録 |  | .clip 29/2 | 0〜1（2 種） |  | 推測 | フチ・線・モノクロ・トーンを、上の段（縮小）のミップマップで描くかとその段 |
| DrawUpperMipmapForLineIndex | 未登録 |  | .clip 29/13 | 2 |  | 推測 | フチ・線・モノクロ・トーンを、上の段（縮小）のミップマップで描くかとその段 |
| DrawUpperMipmapForMonochromeIndex | 未登録 |  | .clip 29/17 | 1 |  | 推測 | フチ・線・モノクロ・トーンを、上の段（縮小）のミップマップで描くかとその段 |
| DrawUpperMipmapForMonochromeUse | 未登録 |  | .clip 29/6 | 0〜1（2 種） |  | 推測 | フチ・線・モノクロ・トーンを、上の段（縮小）のミップマップで描くかとその段 |
| DrawUpperMipmapForToneFlag | 未登録 |  | .clip 29/0 |  |  | 推測 | フチ・線・モノクロ・トーンを、上の段（縮小）のミップマップで描くかとその段 |
| DrawUpperMipmapForToneIndex | 未登録 |  | .clip 29/0 |  |  | 推測 | フチ・線・モノクロ・トーンを、上の段（縮小）のミップマップで描くかとその段 |
| EffectLayerRenderType | 整数 |  | .clip 461/434 | 10 |  | 推測 | 効果の描き方の種類（内部の処理の番号、常に 10） |
| EffectOffscreenFixType | 整数 |  | .clip 461/434 | 10 |  | 推測 | 効果の描き方の種類（内部の処理の番号、常に 10） |
| EffectOffscreenMoveType | 整数 |  | .clip 461/434 | 10 |  | 推測 | 効果の描き方の種類（内部の処理の番号、常に 10） |
| EffectRangeType | 整数 |  | .clip 719/0 | 0 |  | 推測 | 効果の描き方の種類（内部の処理の番号、常に 10） |
| EffectReferAreaType | 整数 |  | .clip 461/434 | 10 |  | 推測 | 効果の描き方の種類（内部の処理の番号、常に 10） |
| EffectRenderType | 整数 |  | .clip 461/434 | 10 |  | 推測 | 効果の描き方の種類（内部の処理の番号、常に 10） |
| EffectSetUpdateRectType | 整数 |  | .clip 461/434 | 10 |  | 推測 | 効果の描き方の種類（内部の処理の番号、常に 10） |
| EnableSelectLayerObject | 整数 |  | .clip 15/10 | 1 |  | 確認済み | 3D レイヤーのオブジェクト（LayerObject.MainId）と選んでいるもの |
| FilterLayerColorMixingInfo | 整数 |  | .clip 140/0 |  |  | 推測 | 色調補正の混色の設定 |
| FilterLayerInfo | BLOB |  | .clip 108/103 | 長さ ≤ 4168 | ○ | 確認済み | 色調補正の設定（BLOB: u32 種類、u32 大きさ、設定）。V6b で全種類を CSP と照合 |
| FilterLayerV132 | 整数 |  | .clip 719/2 | 1 |  | 推測 | その版の機能を使ったかの印（版の番号が名前に入っている） |
| FirstLayerObject | 整数 | LayerObject | .clip 15/10 | 1〜7（3 種） | ○ | 確認済み | 3D レイヤーのオブジェクト（LayerObject.MainId）と選んでいるもの |
| FixOffsetAndExpandType | 整数 |  | .clip 706/703 | 10〜40（5 種） | ○ | 確認済み | 描き方の種類（内部の処理の番号）。レイヤーの種類ごとに決まった組（コーパスでは 30 がグラデーションの数、31 が用紙の数と同じ）。新規作成ではこの組を書く |
| Flag3DOdRelease | 整数 |  | .clip 15/10 | 1 |  | 推測 | その版の機能を使ったかの印（版の番号が名前に入っている） |
| GradationFillColorMixingInfo | 整数 |  | .clip 140/48 | 1 |  | 推測 | グラデーションの混色の設定（1） |
| GradationFillInfo | BLOB |  | .clip 302/295 | 長さ ≤ 636 | ○ | 確認済み | グラデーション・べた塗りの設定（BLOB）。V6b |
| GuideMove | 整数 |  | .clip 71/0 | 0 |  | 推測 | ガイドと一緒に動かす |
| Has1_0_10 | 整数 |  | .clip 2/0 |  |  | 推測 | その版の機能を使ったかの印（版の番号が名前に入っている） |
| Has1_0_11 | 整数 |  | .clip 2/0 |  |  | 推測 | その版の機能を使ったかの印（版の番号が名前に入っている） |
| Has1_0_12 | 整数 |  | .clip 2/0 |  |  | 推測 | その版の機能を使ったかの印（版の番号が名前に入っている） |
| Has1_0_13 | 整数 |  | — |  |  | 推測 | その版の機能を使ったかの印（版の番号が名前に入っている） |
| Has1_0_14 | 整数 |  | — |  |  | 推測 | その版の機能を使ったかの印（版の番号が名前に入っている） |
| Has1_0_15 | 整数 |  | — |  |  | 推測 | その版の機能を使ったかの印（版の番号が名前に入っている） |
| Has1_0_16 | 整数 |  | — |  |  | 推測 | その版の機能を使ったかの印（版の番号が名前に入っている） |
| Has1_0_17 | 整数 |  | — |  |  | 推測 | その版の機能を使ったかの印（版の番号が名前に入っている） |
| Has1_0_18 | 整数 |  | — |  |  | 推測 | その版の機能を使ったかの印（版の番号が名前に入っている） |
| Has1_0_19 | 整数 |  | — |  |  | 推測 | その版の機能を使ったかの印（版の番号が名前に入っている） |
| Has1_0_6 | 整数 |  | .clip 2/1 | 1 |  | 推測 | その版の機能を使ったかの印（版の番号が名前に入っている） |
| Has1_0_7 | 整数 |  | .clip 2/1 | 1 |  | 推測 | その版の機能を使ったかの印（版の番号が名前に入っている） |
| Has1_0_8 | 整数 |  | .clip 2/0 |  |  | 推測 | その版の機能を使ったかの印（版の番号が名前に入っている） |
| Has1_0_9 | 整数 |  | .clip 2/0 |  |  | 推測 | その版の機能を使ったかの印（版の番号が名前に入っている） |
| HasNewDessindoll | 整数 |  | .clip 15/8 | 1 |  | 推測 | その版の機能を使ったかの印（版の番号が名前に入っている） |
| HasPrimitive | 整数 |  | .clip 15/0 |  |  | 推測 | その版の機能を使ったかの印（版の番号が名前に入っている） |
| LayerClip | 整数 |  | .clip 719/332 | 0〜1（2 種） | ○ | 確認済み | 下のレイヤーでクリッピング |
| LayerColorTypeBlackChecked | 整数 |  | .clip 719/719 | 1 | ○ | 確認済み | レイヤーの表現色（0 カラー、1 グレー、2 モノクロ）とモノクロの黒・白 |
| LayerColorTypeIndex | 整数 |  | .clip 719/183 | 0〜2（3 種） | ○ | 確認済み | レイヤーの表現色（0 カラー、1 グレー、2 モノクロ）とモノクロの黒・白 |
| LayerColorTypeWhiteChecked | 整数 |  | .clip 719/719 | 0〜1（2 種） | ○ | 確認済み | レイヤーの表現色（0 カラー、1 グレー、2 モノクロ）とモノクロの黒・白 |
| LayerComposite | 整数 |  | .clip 719/275 | 0〜30（21 種） | ○ | 確認済み | 合成モード（0 通常、30 通過など。コーパスでは 0〜30）。V6 で 28 モードを CSP と照合 |
| LayerEffectAttached | 未登録 |  | .clip 461/434 | 1 | ○ | 確認済み | レイヤー効果が付いている（LayerEffectInfo がある行で 1） |
| LayerEffectEdgeNewRender | 整数 |  | .clip 3/3 | 1 |  | 推測 | フチの新しい描き方 |
| LayerEffectHas1_0_19 | 整数 |  | .clip 3/0 |  |  | 推測 | その版の機能を使ったかの印（版の番号が名前に入っている） |
| LayerEffectInfo | BLOB |  | .clip 465/461 | 長さ ≤ 610 | ○ | 確認済み | レイヤー効果（フチ・トーン・水彩境界など、BLOB）。V6 |
| LayerFirstChildIndex | 整数 |  | .clip 719/719 | 0〜2460（40+ 種） | ○ | 確認済み | 最初（一番下）の子（Layer.MainId、0 でなし） |
| LayerFolder | 整数 |  | .clip 719/719 | 0〜17（3 種） | ○ | 確認済み | フォルダーのビット。1 フォルダー、16 パレットで開いている |
| LayerLayerMaskMipmap | 整数 | Mipmap | .clip 719/377 | 0〜3767（40+ 種） | ○ | 確認済み | マスク（Mipmap.MainId、0 でなし） |
| LayerLayerMaskThumbnail | 整数 | LayerThumbnail | .clip 719/377 | 0〜2479（40+ 種） | ○ | 確認済み | マスクのサムネイル（LayerThumbnail.MainId） |
| LayerLock | 整数 |  | .clip 719/238 | 0〜16（3 種） | ○ | 確認済み | ロック。0 以外でロック（1 が大半。16 などほかのビットは未確認） |
| LayerMasking | 整数 |  | .clip 719/719 | 0〜114（8 種） | ○ | 推測 | マスクの範囲の表示（ビット） |
| LayerMaskOffscrOffsetX | 整数 |  | .clip 719/298 | -6984〜7016（40+ 種） | ○ | 確認済み | マスクの格納の左上。マスクの原点 = 移動量 + マスクの移動量 + これ |
| LayerMaskOffscrOffsetY | 整数 |  | .clip 719/191 | -2616〜4933（40+ 種） | ○ | 確認済み | マスクの格納の左上。マスクの原点 = 移動量 + マスクの移動量 + これ |
| LayerMaskOffsetX | 整数 |  | .clip 719/485 | -13380〜20701（40+ 種） | ○ | 確認済み | マスクの移動量（レイヤーの移動量からの相対） |
| LayerMaskOffsetY | 整数 |  | .clip 719/462 | -13750〜9861（40+ 種） | ○ | 確認済み | マスクの移動量（レイヤーの移動量からの相対） |
| LayerName | 文字列 |  | .clip 719/719 | 長さ ≤ 1222 | ○ | 確認済み | レイヤー名 |
| LayerNextIndex | 整数 |  | .clip 719/719 | 0〜2467（40+ 種） | ○ | 確認済み | 1 つ上の兄弟（Layer.MainId、0 で終わり） |
| LayerNoticeablePaletteColor | 整数 |  | .clip 719/0 | 0 | ○ | 推測 | レイヤーカラー（パレットの目印の色）。コーパスでは常に 0 |
| LayerOffsetX | 整数 |  | .clip 719/596 | -20701〜13628（40+ 種） | ○ | 確認済み | レイヤーの移動量（キャンバスの画素） |
| LayerOffsetY | 整数 |  | .clip 719/568 | -9861〜13750（40+ 種） | ○ | 確認済み | レイヤーの移動量（キャンバスの画素） |
| LayerOpacity | 整数 |  | .clip 719/719 | 0〜256（40+ 種） | ○ | 確認済み | 不透明度（0〜256、256 が 100%） |
| LayerPaletteBlue | 整数 |  | .clip 719/0 | 0 | ○ | 推測 | レイヤーカラー（パレットの目印の色）。コーパスでは常に 0 |
| LayerPaletteGreen | 整数 |  | .clip 719/0 | 0 | ○ | 推測 | レイヤーカラー（パレットの目印の色）。コーパスでは常に 0 |
| LayerPaletteRed | 整数 |  | .clip 719/0 | 0 | ○ | 推測 | レイヤーカラー（パレットの目印の色）。コーパスでは常に 0 |
| LayerRenderMipmap | 整数 | Mipmap | .clip 719/719 | 1〜3775（40+ 種） | ○ | 確認済み | 画素（Mipmap.MainId） |
| LayerRenderOffscrOffsetX | 整数 |  | .clip 719/600 | -13628〜20701（40+ 種） | ○ | 確認済み | 画素の格納の左上の、移動量からの位置。画素の原点 = 移動量 + これ |
| LayerRenderOffscrOffsetY | 整数 |  | .clip 719/571 | -13750〜9861（40+ 種） | ○ | 確認済み | 画素の格納の左上の、移動量からの位置。画素の原点 = 移動量 + これ |
| LayerRenderThumbnail | 整数 | LayerThumbnail | .clip 719/719 | 1〜2486（40+ 種） | ○ | 確認済み | サムネイル（LayerThumbnail.MainId） |
| LayerSelect | 整数 |  | .clip 719/719 | 0〜772（12 種） | ○ | 推測 | パレットで選ばれている（ビット。258 などの組み合わせ） |
| LayerType | 整数 |  | .clip 719/719 | 0〜4098（9 種） | ○ | 確認済み | 種類のビット。1 画素を持つ、2 マスク付き、256 ルート、800 作品情報、1584 用紙、4096 色調補正。ほかの種類は列の有無で決まる（03 章） |
| LayerUsePaletteColor | 整数 |  | .clip 719/0 | 0 | ○ | 推測 | レイヤーカラー（パレットの目印の色）。コーパスでは常に 0 |
| LayerUuid | 文字列 |  | .clip 719/719 | 長さ ≤ 36 | ○ | 確認済み | レイヤーの UUID（36 文字） |
| LayerVisibility | 整数 |  | .clip 719/719 | 0〜7（7 種） | ○ | 確認済み | ビット 0 表示、ビット 1 マスクを使う、ビット 2 パレットでマスクを選んでいる（推測） |
| LightTableInfo | BLOB |  | .clip 171/171 | 長さ ≤ 15 | ○ | 確認済み | ライトテーブルの設定（BLOB、15 バイト）。CSP は新しいレイヤーでは NULL にする |
| LightTableReferCell | 整数 |  | — |  |  | 確認済み | ライトテーブルの参照レイヤー（LayerType 10016、パレットに出ない。描かない）の印 |
| LinkLayerInfo | BLOB |  | — |  |  | 推測 | リンクしたレイヤー（他のファイルの参照） |
| LinkLayerItemUUID | 文字列 |  | — |  |  | 推測 | リンクしたレイヤー（他のファイルの参照） |
| LinkLayerLastModifiedCount | 整数 |  | — |  |  | 推測 | リンクしたレイヤー（他のファイルの参照） |
| LinkLayerLastUpdate | 整数 |  | — |  |  | 推測 | リンクしたレイヤー（他のファイルの参照） |
| LinkLayerLayerComp | 文字列 |  | — |  |  | 推測 | リンクしたレイヤー（他のファイルの参照） |
| LinkLayerRenderSettings | BLOB |  | — |  |  | 推測 | リンクしたレイヤー（他のファイルの参照） |
| LinkLayerStatus | 整数 |  | — |  |  | 推測 | リンクしたレイヤー（他のファイルの参照） |
| LinkLayerTime | 実数 |  | — |  |  | 推測 | リンクしたレイヤー（他のファイルの参照） |
| LinkLayerTimeForTimeLine | 実数 |  | — |  |  | 推測 | リンクしたレイヤー（他のファイルの参照） |
| LinkLayerTimeLine | 文字列 |  | — |  |  | 推測 | リンクしたレイヤー（他のファイルの参照） |
| LinkLayerUUID | 文字列 |  | — |  |  | 推測 | ライトテーブルの参照レイヤーが指すレイヤーの LayerUuid |
| Manager3D | 整数 | Manager3D | — |  |  | 推測 | 3D 空間（Manager3D / Manager3DOd の MainId） |
| Manager3DOd | 整数 | Manager3DOd | .clip 15/10 | 1〜4（4 種） | ○ | 推測 | 3D 空間（Manager3D / Manager3DOd の MainId） |
| MaskBoundForLayerMoveType | 整数 |  | .clip 195/180 | 40 |  | 推測 | マスクの描き方の種類（コマ枠フォルダーで 21・10・40） |
| MaterialContentType | 整数 |  | .clip 514/306 | 0〜160（5 種） |  | 推測 | 素材の中身の種類（110 など） |
| MixSubColorForEveryPlot | 整数 |  | .clip 591/563 | 1 |  | 推測 | ブラシの点ごとにサブ色を混ぜる |
| MonochromeFillInfo | BLOB |  | .clip 700/699 | 長さ ≤ 62 | ○ | 確認済み | モノクロの色の設定（BLOB）。2 値の画素の黒・白の色 |
| MoveOffsetAndExpandType | 整数 |  | .clip 713/710 | 0〜50（7 種） | ○ | 確認済み | 描き方の種類（内部の処理の番号）。レイヤーの種類ごとに決まった組（コーパスでは 30 がグラデーションの数、31 が用紙の数と同じ）。新規作成ではこの組を書く |
| OutputAttribute | 未登録 |  | .clip 443/443 | 1〜3（2 種） |  | 推測 | 出力の属性（1〜3、値の意味は未確認） |
| PreviewColorTypeApplyOpacity | 整数 |  | .clip 26/25 | 1 |  | 推測 | 表示の表現色（プレビューの色の変換、しきい値、不透明度の適用） |
| PreviewColorTypeApplyOpacityNewRender | 整数 |  | .clip 26/25 | 1 |  | 推測 | 表示の表現色（プレビューの色の変換、しきい値、不透明度の適用） |
| PreviewColorTypeBlackChecked | 整数 |  | .clip 26/25 | 1 |  | 推測 | 表示の表現色（プレビューの色の変換、しきい値、不透明度の適用） |
| PreviewColorTypeColorToAlpha | 整数 |  | .clip 26/24 | 0〜1（2 種） |  | 推測 | 表示の表現色（プレビューの色の変換、しきい値、不透明度の適用） |
| PreviewColorTypeIndex | 整数 |  | .clip 26/17 | 0〜2（2 種） |  | 推測 | 表示の表現色（プレビューの色の変換、しきい値、不透明度の適用） |
| PreviewColorTypeThresholdAlpha | 整数 |  | .clip 26/23 | 0〜2147483648（2 種） |  | 推測 | 表示の表現色（プレビューの色の変換、しきい値、不透明度の適用） |
| PreviewColorTypeThresholdImage | 整数 |  | .clip 26/25 | 2147483648〜4294967295（2 種） |  | 推測 | 表示の表現色（プレビューの色の変換、しきい値、不透明度の適用） |
| PreviewColorTypeWhiteChecked | 整数 |  | .clip 26/22 | 0〜1（2 種） |  | 推測 | 表示の表現色（プレビューの色の変換、しきい値、不透明度の適用） |
| PreviewMaskBinarize | 整数 |  | .clip 3/0 | 0 |  | 推測 | 表示の表現色（プレビューの色の変換、しきい値、不透明度の適用） |
| PreviewMaskThreshold | 整数 |  | .clip 3/2 | 2147483648 |  | 推測 | 表示の表現色（プレビューの色の変換、しきい値、不透明度の適用） |
| ReferLayer | 整数 |  | .clip 94/76 | 1 |  | 推測 | 参照レイヤー（塗りの参照先）とライトテーブルの参照 |
| RenderBoundForLayerMoveType | 整数 |  | .clip 706/703 | 10〜31（3 種） | ○ | 確認済み | 描き方の種類（内部の処理の番号）。レイヤーの種類ごとに決まった組（コーパスでは 30 がグラデーションの数、31 が用紙の数と同じ）。新規作成ではこの組を書く |
| ResizableBlackIndex | 整数 |  | .clip 58/15 | 0〜3（4 種） |  | 推測 | 画像素材の黒の扱いと変形のロック |
| ResizableImageInfo | BLOB |  | .clip 130/127 | 長さ ≤ 184 | ○ | 確認済み | 画像素材の変形（BLOB: 元の大きさ、変形の行列） |
| ResizableLockFlag | 整数 |  | — |  |  | 推測 | 画像素材の黒の扱いと変形のロック |
| ResizableOriginalMipmap | 整数 | Mipmap | .clip 130/127 | 6〜1384（40+ 種） | ○ | 確認済み | 画像素材の元の画素（Mipmap.MainId） |
| RulerRange | 整数 |  | .clip 223/19 | 0〜2（3 種） |  | 推測 | 定規の表示範囲（0〜2、値の意味は未確認） |
| RulerVectorIndex | 整数 | VectorObjectList | .clip 1/0 |  |  | 推測 | 定規のベクター（VectorObjectList.MainId） |
| SetMaskThumbnailInfoType | 整数 |  | — |  |  | 推測 | マスクの描き方の種類（コマ枠フォルダーで 21・10・40） |
| SetRenderThumbnailInfoType | 整数 |  | .clip 710/710 | 10〜31（4 種） | ○ | 確認済み | 描き方の種類（内部の処理の番号）。レイヤーの種類ごとに決まった組（コーパスでは 30 がグラデーションの数、31 が用紙の数と同じ）。新規作成ではこの組を書く |
| ShowImageAreaColorBlue | 整数 |  | — |  |  | 推測 | 画像の範囲の表示の色 |
| ShowImageAreaColorGreen | 整数 |  | — |  |  | 推測 | 画像の範囲の表示の色 |
| ShowImageAreaColorRed | 整数 |  | — |  |  | 推測 | 画像の範囲の表示の色 |
| SpecialRenderType | 整数 |  | .clip 707/694 | 13〜20（3 種） | ○ | 確認済み | 描き方の種類（内部の処理の番号）。レイヤーの種類ごとに決まった組（コーパスでは 30 がグラデーションの数、31 が用紙の数と同じ）。新規作成ではこの組を書く |
| SpecialRulerManager | 整数 | SpecialRulerManager | .clip 71/67 | 1〜13（11 種） |  | 推測 | 特殊定規（SpecialRulerManager.MainId） |
| StreamLineIndex | 整数 | StreamLine | .clip 115/113 | 1〜26（24 種） |  | 推測 | 流線・集中線（StreamLine.MainId） |
| TextLayerAddAttributesV01 | BLOB |  | .clip 486/481 | 長さ ≤ 93073 |  | 推測 | テキストの書式の追加分（BLOB、版 1） |
| TextLayerAttributes | BLOB |  | .clip 486/481 | 長さ ≤ 2099 | ○ | 確認済み | テキストの書式（BLOB） |
| TextLayerAttributesArray | BLOB |  | .clip 486/412 | 長さ ≤ 109332 | ○ | 確認済み | テキストの書式の配列 |
| TextLayerAttributesVersion | 整数 |  | .clip 486/481 | 1 |  | 推測 | テキストの形式の版、種類（0〜2、値の意味は未確認）、レイヤー名を文字列に合わせる |
| TextLayerNameAutoChangeEnabled | 整数 |  | .clip 124/124 | 1 |  | 推測 | テキストの形式の版、種類（0〜2、値の意味は未確認）、レイヤー名を文字列に合わせる |
| TextLayerString | BLOB |  | .clip 486/481 | 長さ ≤ 3266 | ○ | 確認済み | テキストの文字列（BLOB） |
| TextLayerStringArray | BLOB |  | .clip 486/412 | 長さ ≤ 5237 | ○ | 確認済み | テキストの文字列の配列（複数の文字列） |
| TextLayerType | 整数 |  | .clip 486/427 | 0〜2（3 種） |  | 推測 | テキストの形式の版、種類（0〜2、値の意味は未確認）、レイヤー名を文字列に合わせる |
| TextLayerVersion | 整数 |  | .clip 486/88 | 16814081 |  | 推測 | テキストの形式の版、種類（0〜2、値の意味は未確認）、レイヤー名を文字列に合わせる |
| TimeLineLayerKeyFrameEnabled | 整数 |  | — |  | ○ | 確認済み | レイヤーのキーフレームが有効（変形は TimeLineOriginalMipmap に掛ける） |
| TimeLineMaskExtentBottom | 整数 |  | — |  |  | 推測 | タイムラインのキーフレームと、変形前の範囲・画素 |
| TimeLineMaskExtentLeft | 整数 |  | — |  |  | 推測 | タイムラインのキーフレームと、変形前の範囲・画素 |
| TimeLineMaskExtentRight | 整数 |  | — |  |  | 推測 | タイムラインのキーフレームと、変形前の範囲・画素 |
| TimeLineMaskExtentTop | 整数 |  | — |  |  | 推測 | タイムラインのキーフレームと、変形前の範囲・画素 |
| TimeLineMaskFixAspectRatio | 整数 |  | — |  |  | 推測 | タイムラインのキーフレームと、変形前の範囲・画素 |
| TimeLineMaskOriginalBottom | 整数 |  | — |  |  | 推測 | タイムラインのキーフレームと、変形前の範囲・画素 |
| TimeLineMaskOriginalLeft | 整数 |  | — |  |  | 推測 | タイムラインのキーフレームと、変形前の範囲・画素 |
| TimeLineMaskOriginalOffsetX | 整数 |  | — |  |  | 推測 | タイムラインのキーフレームと、変形前の範囲・画素 |
| TimeLineMaskOriginalOffsetY | 整数 |  | — |  |  | 推測 | タイムラインのキーフレームと、変形前の範囲・画素 |
| TimeLineMaskOriginalRight | 整数 |  | — |  |  | 推測 | タイムラインのキーフレームと、変形前の範囲・画素 |
| TimeLineMaskOriginalTop | 整数 |  | — |  |  | 推測 | タイムラインのキーフレームと、変形前の範囲・画素 |
| TimeLineOriginalLayerOpacity | 整数 |  | — |  |  | 推測 | キーフレームを有効にする前の不透明度 |
| TimeLineOriginalMaskMipmap | 整数 | Mipmap | — |  |  | 推測 | タイムラインのキーフレームと、変形前の範囲・画素 |
| TimeLineOriginalMipmap | 整数 | Mipmap | — |  | ○ | 確認済み | キーフレームの変形前の画素（Mipmap.MainId）。LayerRenderMipmap は保存されず CSP が開くときに作る |
| TimeLineRenderExtentBottom | 整数 |  | — |  |  | 推測 | タイムラインのキーフレームと、変形前の範囲・画素 |
| TimeLineRenderExtentLeft | 整数 |  | — |  |  | 推測 | タイムラインのキーフレームと、変形前の範囲・画素 |
| TimeLineRenderExtentRight | 整数 |  | — |  |  | 推測 | タイムラインのキーフレームと、変形前の範囲・画素 |
| TimeLineRenderExtentTop | 整数 |  | — |  |  | 推測 | タイムラインのキーフレームと、変形前の範囲・画素 |
| TimeLineRenderFixAspectRatio | 整数 |  | — |  |  | 推測 | タイムラインのキーフレームと、変形前の範囲・画素 |
| TimeLineRenderOriginalBottom | 整数 |  | — |  |  | 推測 | タイムラインのキーフレームと、変形前の範囲・画素 |
| TimeLineRenderOriginalLeft | 整数 |  | — |  |  | 推測 | タイムラインのキーフレームと、変形前の範囲・画素 |
| TimeLineRenderOriginalOffsetX | 整数 |  | — |  |  | 推測 | タイムラインのキーフレームと、変形前の範囲・画素 |
| TimeLineRenderOriginalOffsetY | 整数 |  | — |  |  | 推測 | タイムラインのキーフレームと、変形前の範囲・画素 |
| TimeLineRenderOriginalRight | 整数 |  | — |  |  | 推測 | タイムラインのキーフレームと、変形前の範囲・画素 |
| TimeLineRenderOriginalTop | 整数 |  | — |  |  | 推測 | タイムラインのキーフレームと、変形前の範囲・画素 |
| TimeLineTransformedByAction | 整数 |  | — |  |  | 推測 | タイムラインのキーフレームと、変形前の範囲・画素 |
| UsePreviewColorType | 整数 |  | .clip 719/6 | 0〜1（2 種） |  | 推測 | 表示の表現色（プレビューの色の変換、しきい値、不透明度の適用） |
| UsePreviewMaskColorType | 整数 |  | .clip 719/0 | 0 |  | 推測 | 表示の表現色（プレビューの色の変換、しきい値、不透明度の適用） |
| VectorNormalBalloon | BLOB |  | — |  |  | 推測 | ベクターのデータ（旧形式、BLOB）。コーパスでは未設定 |
| VectorNormalBalloonIndex | 整数 | VectorObjectList | .clip 604/193 | 0〜622（40+ 種） |  | 確認済み | ベクターの線・塗り・フキダシのデータ（VectorObjectList.MainId） |
| VectorNormalFill | BLOB |  | — |  |  | 推測 | ベクターのデータ（旧形式、BLOB）。コーパスでは未設定 |
| VectorNormalFillIndex | 整数 | VectorObjectList | .clip 604/22 | 0〜69（36 種） |  | 確認済み | ベクターの線・塗り・フキダシのデータ（VectorObjectList.MainId） |
| VectorNormalStroke | BLOB |  | — |  |  | 推測 | ベクターのデータ（旧形式、BLOB）。コーパスでは未設定 |
| VectorNormalStrokeIndex | 整数 | VectorObjectList | .clip 604/511 | 0〜243（40+ 種） | ○ | 確認済み | ベクターの線・塗り・フキダシのデータ（VectorObjectList.MainId） |
| VectorNormalType | 整数 |  | .clip 604/202 | 0〜3（4 種） |  | 推測 | ベクターレイヤーの種類（0〜3、値の意味は未確認） |
| VoiceSpeakParam | 整数 | SpeechSynthesis | — |  |  | 推測 | アニメーションのフォルダー・セル・字幕・音声 |
| WebCooperationLayerEditable | 整数 |  | — |  |  | 推測 | Web 連携で編集できるレイヤー |

## LayerComp

レイヤーカンプ（レイヤーの表示状態の保存）。`ElemScheme.MaxIndex` は最大 1。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 140/140 | 1 | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 140/140 | 1 | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| BankId | 整数 |  | .clip 140/140 | 3 |  | 推測 | レイヤーカンプ（保管の番号、各レイヤーの状態の BLOB、名前、次、UUID） |
| CompLayerInfo | BLOB |  | .clip 140/140 | 長さ ≤ 12008 |  | 推測 | レイヤーカンプ（保管の番号、各レイヤーの状態の BLOB、名前、次、UUID） |
| CompName | 文字列 |  | .clip 140/0 |  |  | 推測 | レイヤーカンプ（保管の番号、各レイヤーの状態の BLOB、名前、次、UUID） |
| CompNextIndex | 整数 | LayerComp | .clip 140/0 | 0 |  | 推測 | レイヤーカンプ（保管の番号、各レイヤーの状態の BLOB、名前、次、UUID） |
| CompUuid | BLOB |  | .clip 140/140 | 長さ ≤ 16 |  | 推測 | UUID |

## LayerCompManager

レイヤーカンプの一覧。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 140/140 | 1 | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 140/140 | 3 | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| AppliedLayerCompIndex | 整数 |  | .clip 140/140 | -1 | ○ | 推測 | 適用しているカンプ（−1 なし）、最初のカンプ、最後の状態 |
| FirstLayerCompIndex | 整数 | LayerComp | .clip 140/0 | 0 | ○ | 推測 | 適用しているカンプ（−1 なし）、最初のカンプ、最後の状態 |
| LastStateLayerCompIndex | 整数 | LayerComp | .clip 140/140 | 1 | ○ | 推測 | 適用しているカンプ（−1 なし）、最初のカンプ、最後の状態 |

## LayerObject

3D レイヤーのオブジェクト（カメラ・光源・デッサン人形・小物）の並び。`ElemScheme.MaxIndex` は最大 22。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 15/10 | 1〜20（20 種） | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 15/10 | 1〜22（22 種） | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| BankItemUuid | 文字列 |  | .clip 15/10 | 長さ ≤ 36 |  | 推測 | 音声のオブジェクトか、素材の UUID |
| Camera | 整数 | CameraInfo | .clip 15/10 | 1〜10（5 種） |  | 推測 | オブジェクトの中身（各情報の表の MainId） |
| CameraNode3D | 整数 | CameraNodeInfo | .clip 1/1 | 6〜10（5 種） |  | 推測 | オブジェクトの中身（各情報の表の MainId） |
| CanvasId | 整数 |  | .clip 15/10 | 1 | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| Character | 整数 | CharacterInfo | — |  |  | 推測 | オブジェクトの中身（各情報の表の MainId） |
| Dessindoll | BLOB |  | .clip 13/8 | 1〜12（12 種） |  | 推測 | オブジェクトの中身（各情報の表の MainId） |
| Folder | 整数 | FolderInfo | .clip 1/1 | 2 |  | 推測 | オブジェクトの中身（各情報の表の MainId） |
| IsAudio | 整数 |  | — |  |  | 推測 | 音声のオブジェクトか、素材の UUID |
| LayerId | 整数 |  | .clip 15/10 | 11〜85（7 種） | ○ | 確認済み | 属するレイヤー（Layer.MainId）。0 はキャンバス全体のもの（用紙など） |
| Light | 整数 | LightInfo | .clip 15/10 | 1〜30（15 種） |  | 推測 | オブジェクトの中身（各情報の表の MainId） |
| ObjectLock | 整数 |  | .clip 15/1 | 0〜1（2 種） |  | 推測 | オブジェクトの名前・UUID・次・ロック・選択・表示・選べるか |
| ObjectName | 文字列 |  | .clip 15/10 | 長さ ≤ 18 |  | 推測 | オブジェクトの名前・UUID・次・ロック・選択・表示・選べるか |
| ObjectNext | 整数 |  | .clip 15/10 | 0〜22（22 種） |  | 推測 | オブジェクトの名前・UUID・次・ロック・選択・表示・選べるか |
| ObjectPickmask | 整数 |  | .clip 15/0 | 0 |  | 推測 | オブジェクトの名前・UUID・次・ロック・選択・表示・選べるか |
| ObjectSelect | 整数 |  | .clip 15/10 | 0〜1（2 種） |  | 推測 | オブジェクトの名前・UUID・次・ロック・選択・表示・選べるか |
| ObjectUuid | 文字列 |  | .clip 15/10 | 長さ ≤ 36 |  | 推測 | オブジェクトの名前・UUID・次・ロック・選択・表示・選べるか |
| ObjectVisibility | 整数 |  | .clip 15/10 | 0〜1（2 種） |  | 推測 | オブジェクトの名前・UUID・次・ロック・選択・表示・選べるか |
| Primitive3D | BLOB |  | — |  |  | 推測 | オブジェクトの中身（各情報の表の MainId） |
| Room | 整数 | RoomInfo | — |  |  | 推測 | オブジェクトの中身（各情報の表の MainId） |
| SmallObject | 整数 | SmallObjectInfo | .clip 5/4 | 1〜10（4 種） |  | 推測 | オブジェクトの中身（各情報の表の MainId） |

## LayerThumbnail

レイヤーパレットのサムネイル。`ElemScheme.MaxIndex` は最大 2486。コア領域。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 719/719 | 1〜957（40+ 種） | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 719/719 | 1〜2486（40+ 種） | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| CanvasId | 整数 |  | .clip 719/719 | 1〜2（2 種） | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| LayerId | 整数 |  | .clip 719/719 | 1〜2467（40+ 種） | ○ | 確認済み | 属するレイヤー（Layer.MainId）。0 はキャンバス全体のもの（用紙など） |
| ThumbnailCanvasHeight | 整数 |  | .clip 719/719 | 0〜19866（40+ 種） | ○ | 確認済み | 作ったときのキャンバスの大きさ（px） |
| ThumbnailCanvasWidth | 整数 |  | .clip 719/719 | 0〜22444（40+ 種） | ○ | 確認済み | 作ったときのキャンバスの大きさ（px） |
| ThumbnailColorTypeBlack | 整数 |  | .clip 719/719 | 1 | ○ | 確認済み | 表現色（Layer.LayerColorType* と同じ） |
| ThumbnailColorTypeIndex | 整数 |  | .clip 719/183 | 0〜2（3 種） | ○ | 確認済み | 表現色（Layer.LayerColorType* と同じ） |
| ThumbnailColorTypeWhite | 整数 |  | .clip 719/719 | 0〜1（2 種） | ○ | 確認済み | 表現色（Layer.LayerColorType* と同じ） |
| ThumbnailDrewMode | 整数 |  | .clip 719/0 | 0 | ○ | 推測 | サムネイルの描き方とキャンバスの縦横比を使うか |
| ThumbnailDrewUseCanvasAspect0 | 整数 |  | .clip 719/719 | 0〜1（2 種） | ○ | 推測 | サムネイルの描き方とキャンバスの縦横比を使うか |
| ThumbnailDrewUseCanvasAspect1 | 整数 |  | .clip 719/719 | 0〜1（2 種） | ○ | 推測 | サムネイルの描き方とキャンバスの縦横比を使うか |
| ThumbnailFixMode | 整数 |  | .clip 719/719 | -1〜0（2 種） | ○ | 推測 | サムネイルの固定（−1 なし） |
| ThumbnailLargeNeedRefresh | 整数 |  | .clip 719/719 | 4〜15723006（40+ 種） | ○ | 確認済み | 大きさごとのサムネイルの更新の印（更新の回数）。新規作成では同じ値を書く |
| ThumbnailLargeNeedRefresh1 | 整数 |  | .clip 719/719 | 4〜15723006（40+ 種） | ○ | 確認済み | 大きさごとのサムネイルの更新の印（更新の回数）。新規作成では同じ値を書く |
| ThumbnailLarger2xNeedRefresh | 整数 |  | .clip 719/719 | 4〜15723006（40+ 種） | ○ | 確認済み | 大きさごとのサムネイルの更新の印（更新の回数）。新規作成では同じ値を書く |
| ThumbnailLarger2xNeedRefresh1 | 整数 |  | .clip 719/719 | 4〜15723006（40+ 種） | ○ | 確認済み | 大きさごとのサムネイルの更新の印（更新の回数）。新規作成では同じ値を書く |
| ThumbnailLargerNeedRefresh | 整数 |  | .clip 719/719 | 4〜15723006（40+ 種） | ○ | 確認済み | 大きさごとのサムネイルの更新の印（更新の回数）。新規作成では同じ値を書く |
| ThumbnailLargerNeedRefresh1 | 整数 |  | .clip 719/719 | 4〜15723006（40+ 種） | ○ | 確認済み | 大きさごとのサムネイルの更新の印（更新の回数）。新規作成では同じ値を書く |
| ThumbnailMainColorBlue | 整数 |  | .clip 719/693 | 0〜4294967295（40+ 種） | ○ | 確認済み | 描画色（Layer.DrawColor* と同じ） |
| ThumbnailMainColorGreen | 整数 |  | .clip 719/693 | 0〜4294967295（40+ 種） | ○ | 確認済み | 描画色（Layer.DrawColor* と同じ） |
| ThumbnailMainColorRed | 整数 |  | .clip 719/693 | 0〜4294967295（40+ 種） | ○ | 確認済み | 描画色（Layer.DrawColor* と同じ） |
| ThumbnailMiddle2xNeedRefresh | 整数 |  | .clip 719/719 | 4〜15723006（40+ 種） | ○ | 確認済み | 大きさごとのサムネイルの更新の印（更新の回数）。新規作成では同じ値を書く |
| ThumbnailMiddle2xNeedRefresh1 | 整数 |  | .clip 719/719 | 4〜15723006（40+ 種） | ○ | 確認済み | 大きさごとのサムネイルの更新の印（更新の回数）。新規作成では同じ値を書く |
| ThumbnailMiddleNeedRefresh | 整数 |  | .clip 719/719 | 4〜15723006（40+ 種） | ○ | 確認済み | 大きさごとのサムネイルの更新の印（更新の回数）。新規作成では同じ値を書く |
| ThumbnailMiddleNeedRefresh1 | 整数 |  | .clip 719/719 | 4〜15723006（40+ 種） | ○ | 確認済み | 大きさごとのサムネイルの更新の印（更新の回数）。新規作成では同じ値を書く |
| ThumbnailOffscreen | 整数 | Offscreen | .clip 719/719 | 2〜31853（40+ 種） | ○ | 確認済み | サムネイルの画素（Offscreen.MainId） |
| ThumbnailPrewviewColorTypeAlpha | 整数 |  | .clip 719/719 | 0〜2147483648（2 種） | ○ | 推測 | 表示の表現色（Layer.PreviewColorType* と同じ）。綴りは CSP のまま |
| ThumbnailPrewviewColorTypeBlack | 整数 |  | .clip 719/719 | 1 | ○ | 推測 | 表示の表現色（Layer.PreviewColorType* と同じ）。綴りは CSP のまま |
| ThumbnailPrewviewColorTypeImage | 整数 |  | .clip 719/719 | 2147483648 | ○ | 推測 | 表示の表現色（Layer.PreviewColorType* と同じ）。綴りは CSP のまま |
| ThumbnailPrewviewColorTypeIndex | 整数 |  | .clip 719/25 | -1〜2（3 種） | ○ | 推測 | 表示の表現色（Layer.PreviewColorType* と同じ）。綴りは CSP のまま |
| ThumbnailPrewviewColorTypeMask | 整数 |  | — |  |  | 推測 | 表示の表現色（Layer.PreviewColorType* と同じ）。綴りは CSP のまま |
| ThumbnailPrewviewColorTypeOpacity | 整数 |  | .clip 719/719 | 1 | ○ | 推測 | 表示の表現色（Layer.PreviewColorType* と同じ）。綴りは CSP のまま |
| ThumbnailPrewviewColorTypeWhite | 整数 |  | .clip 719/719 | 1 | ○ | 推測 | 表示の表現色（Layer.PreviewColorType* と同じ）。綴りは CSP のまま |
| ThumbnailPrewviewMaskBinarize | 整数 |  | .clip 719/0 | 0 | ○ | 推測 | 表示の表現色（Layer.PreviewColorType* と同じ）。綴りは CSP のまま |
| ThumbnailPrewviewMaskThreshold | 整数 |  | .clip 719/719 | 2147483648 | ○ | 推測 | 表示の表現色（Layer.PreviewColorType* と同じ）。綴りは CSP のまま |
| ThumbnailSmallerNeedRefresh | 整数 |  | .clip 719/719 | 4〜15723006（40+ 種） | ○ | 確認済み | 大きさごとのサムネイルの更新の印（更新の回数）。新規作成では同じ値を書く |
| ThumbnailSmallerNeedRefresh1 | 整数 |  | .clip 719/719 | 4〜15723006（40+ 種） | ○ | 確認済み | 大きさごとのサムネイルの更新の印（更新の回数）。新規作成では同じ値を書く |
| ThumbnailSmallNeedRefresh | 整数 |  | .clip 719/719 | 0〜15723006（40+ 種） | ○ | 確認済み | 大きさごとのサムネイルの更新の印（更新の回数）。新規作成では同じ値を書く |
| ThumbnailSmallNeedRefresh1 | 整数 |  | .clip 719/719 | 0〜15723006（40+ 種） | ○ | 確認済み | 大きさごとのサムネイルの更新の印（更新の回数）。新規作成では同じ値を書く |
| ThumbnailSubColorBlue | 整数 |  | .clip 719/271 | 0〜4294967295（40+ 種） | ○ | 確認済み | 描画色（Layer.DrawColor* と同じ） |
| ThumbnailSubColorGreen | 整数 |  | .clip 719/271 | 0〜4294967295（40+ 種） | ○ | 確認済み | 描画色（Layer.DrawColor* と同じ） |
| ThumbnailSubColorRed | 整数 |  | .clip 719/271 | 0〜4294967295（40+ 種） | ○ | 確認済み | 描画色（Layer.DrawColor* と同じ） |
| ThumbnailUseDrawColor | 整数 |  | .clip 719/705 | 0〜1（2 種） | ○ | 確認済み | 描画色で表示する（Layer.DrawColorEnable と同じ） |

## LightInfo

3D の光源。`ElemScheme.MaxIndex` は最大 30。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 15/15 | 1〜6（6 種） | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 15/15 | 1〜30（15 種） | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| CanvasId | 整数 |  | .clip 15/15 | 1 | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| LayerId | 整数 |  | .clip 15/15 | 10〜85（9 種） | ○ | 確認済み | 属するレイヤー（Layer.MainId）。0 はキャンバス全体のもの（用紙など） |
| LayerObjectId | 整数 |  | .clip 15/15 | 3〜11（7 種） |  | 推測 | 属する 3D オブジェクト（LayerObject.MainId） |
| LightIndex | 整数 |  | .clip 15/15 | 0〜8（3 種） |  | 推測 | 光源の番号と種類 |
| LightType | 整数 |  | .clip 15/15 | 0〜1（2 種） |  | 推測 | 光源の番号と種類 |
| LightUuid | 文字列 |  | .clip 15/15 | 長さ ≤ 36 |  | 推測 | UUID |

## Manager3D

3D 空間の管理（旧形式）。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| CameraPers | 実数 |  | — |  |  | 未解明 |  |
| CameraPersFloat | 実数 |  | — |  |  | 未解明 |  |
| CameraPositionX | 実数 |  | — |  |  | 未解明 |  |
| CameraPositionY | 実数 |  | — |  |  | 未解明 |  |
| CameraPositionZ | 実数 |  | — |  |  | 未解明 |  |
| CameraRoll | 実数 |  | — |  |  | 未解明 |  |
| CameraRollFloat | 実数 |  | — |  |  | 未解明 |  |
| CameraTargetX | 実数 |  | — |  |  | 未解明 |  |
| CameraTargetY | 実数 |  | — |  |  | 未解明 |  |
| CameraTargetZ | 実数 |  | — |  |  | 未解明 |  |
| CameraUpX | 実数 |  | — |  |  | 未解明 |  |
| CameraUpY | 実数 |  | — |  |  | 未解明 |  |
| CameraUpZ | 実数 |  | — |  |  | 未解明 |  |
| CanvasId | 整数 |  | — |  | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| CanvasRectBottom | 実数 |  | — |  |  | 未解明 |  |
| CanvasRectLeft | 実数 |  | — |  |  | 未解明 |  |
| CanvasRectRight | 実数 |  | — |  |  | 未解明 |  |
| CanvasRectTop | 実数 |  | — |  |  | 未解明 |  |
| FrustumBottom | 実数 |  | — |  |  | 未解明 |  |
| FrustumFar | 実数 |  | — |  |  | 未解明 |  |
| FrustumLeft | 実数 |  | — |  |  | 未解明 |  |
| FrustumNear | 実数 |  | — |  |  | 未解明 |  |
| FrustumRight | 実数 |  | — |  |  | 未解明 |  |
| FrustumTempBottom | 実数 |  | — |  |  | 未解明 |  |
| FrustumTempFar | 実数 |  | — |  |  | 未解明 |  |
| FrustumTempLeft | 実数 |  | — |  |  | 未解明 |  |
| FrustumTempNear | 実数 |  | — |  |  | 未解明 |  |
| FrustumTempRight | 実数 |  | — |  |  | 未解明 |  |
| FrustumTempTop | 実数 |  | — |  |  | 未解明 |  |
| FrustumTop | 実数 |  | — |  |  | 未解明 |  |
| IsAngleLimit | 整数 |  | — |  |  | 未解明 |  |
| IsDispGrid | 整数 |  | — |  |  | 未解明 |  |
| IsDrawShadow | 整数 |  | — |  |  | 未解明 |  |
| IsLighting | 整数 |  | — |  |  | 未解明 |  |
| IsUseManipulator | 整数 |  | — |  |  | 未解明 |  |
| LayerFrustumAxisPtX | 実数 |  | — |  |  | 未解明 |  |
| LayerFrustumAxisPtY | 実数 |  | — |  |  | 未解明 |  |
| LayerId | 整数 |  | — |  | ○ | 確認済み | 属するレイヤー（Layer.MainId）。0 はキャンバス全体のもの（用紙など） |
| Light0VectorW | 実数 |  | — |  |  | 未解明 |  |
| Light0VectorX | 実数 |  | — |  |  | 未解明 |  |
| Light0VectorY | 実数 |  | — |  |  | 未解明 |  |
| Light0VectorZ | 実数 |  | — |  |  | 未解明 |  |
| ModelInfoCount | 整数 |  | — |  |  | 未解明 |  |
| ModelInfoFirstIndex | 整数 | ModelInfo3D | — |  |  | 未解明 |  |
| ViewportHeight | 整数 |  | — |  |  | 未解明 |  |
| ViewportWidth | 整数 |  | — |  |  | 未解明 |  |

## Manager3DOd

3D 空間の管理。SceneData は外部チャンク。`ElemScheme.MaxIndex` は最大 4。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 15/10 | 1〜2（2 種） | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 15/10 | 1〜4（4 種） | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| CameraNearFarAutoSet | 整数 |  | .clip 15/10 | 1 |  | 推測 | 3D の表示の範囲、近・遠の自動、シーンのデータ（外部チャンク） |
| CanvasId | 整数 |  | .clip 15/10 | 1 | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| CanvasRectBottom | 実数 |  | .clip 15/10 | 4093〜9921（4 種） |  | 推測 | 3D の表示の範囲、近・遠の自動、シーンのデータ（外部チャンク） |
| CanvasRectLeft | 実数 |  | .clip 15/0 | 0 |  | 推測 | 3D の表示の範囲、近・遠の自動、シーンのデータ（外部チャンク） |
| CanvasRectRight | 実数 |  | .clip 15/10 | 2894〜14031（5 種） |  | 推測 | 3D の表示の範囲、近・遠の自動、シーンのデータ（外部チャンク） |
| CanvasRectTop | 実数 |  | .clip 15/0 | 0 |  | 推測 | 3D の表示の範囲、近・遠の自動、シーンのデータ（外部チャンク） |
| LayerFrustumAxisPtX | 実数 |  | — |  |  | 未解明 |  |
| LayerFrustumAxisPtY | 実数 |  | — |  |  | 未解明 |  |
| LayerId | 整数 |  | .clip 15/10 | 11〜85（7 種） | ○ | 確認済み | 属するレイヤー（Layer.MainId）。0 はキャンバス全体のもの（用紙など） |
| MultiViewNearClipEnable | BLOB |  | .clip 15/10 | 長さ ≤ 28 |  | 推測 | 複数の視点の表示（カメラの位置・回転・視錐台・ズーム） |
| MultiViewNearClipPosition | BLOB |  | .clip 15/10 | 長さ ≤ 52 |  | 推測 | 複数の視点の表示（カメラの位置・回転・視錐台・ズーム） |
| MultiViewPresetCameraDistance | 実数 |  | .clip 15/10 | 222.5〜580.2（5 種） |  | 推測 | 複数の視点の表示（カメラの位置・回転・視錐台・ズーム） |
| MultiViewPresetCameraFrustum | BLOB |  | .clip 15/10 | 長さ ≤ 52 |  | 推測 | 複数の視点の表示（カメラの位置・回転・視錐台・ズーム） |
| MultiViewPresetCameraOrthographic | 整数 |  | .clip 15/0 | 0 |  | 推測 | 複数の視点の表示（カメラの位置・回転・視錐台・ズーム） |
| MultiViewPresetCameraPosition | BLOB |  | .clip 15/10 | 長さ ≤ 28 |  | 推測 | 複数の視点の表示（カメラの位置・回転・視錐台・ズーム） |
| MultiViewPresetCameraRotate | BLOB |  | .clip 15/10 | 長さ ≤ 36 |  | 推測 | 複数の視点の表示（カメラの位置・回転・視錐台・ズーム） |
| MultiViewPresetCameraTwist | 実数 |  | .clip 15/0 | 0 |  | 推測 | 複数の視点の表示（カメラの位置・回転・視錐台・ズーム） |
| MultiViewPresetCameraUpGuide | BLOB |  | .clip 15/10 | 長さ ≤ 28 |  | 推測 | 複数の視点の表示（カメラの位置・回転・視錐台・ズーム） |
| MultiViewTargetPosition | BLOB |  | .clip 15/10 | 長さ ≤ 28 |  | 推測 | 複数の視点の表示（カメラの位置・回転・視錐台・ズーム） |
| MultiViewZoom | 実数 |  | .clip 15/10 | 0.001608〜0.004188（5 種） |  | 推測 | 複数の視点の表示（カメラの位置・回転・視錐台・ズーム） |
| SceneData | BLOB | 外部チャンク | .clip 15/10 | 長さ ≤ 40 | ○ | 推測 | 3D の表示の範囲、近・遠の自動、シーンのデータ（外部チャンク） |

## Mipmap

ミップマップ（縮小画像の段の並び）の先頭。`ElemScheme.MaxIndex` は最大 3778。コア領域。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 719/719 | 1〜963（40+ 種） | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 719/719 | 1〜3775（40+ 種） | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| BaseMipmapInfo | 整数 | MipmapInfo | .clip 719/719 | 1〜29238（40+ 種） | ○ | 確認済み | 最初の段（MipmapInfo.MainId、100%） |
| CanvasId | 整数 |  | .clip 719/719 | 1〜2（2 種） | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| LayerId | 整数 |  | .clip 719/719 | 0〜2467（40+ 種） | ○ | 確認済み | 属するレイヤー（Layer.MainId）。0 はキャンバス全体のもの（用紙など） |
| MipmapCount | 整数 |  | .clip 719/719 | 2〜9（8 種） | ○ | 確認済み | 段の数 |

## MipmapInfo

ミップマップの 1 段（倍率と Offscreen）。`ElemScheme.MaxIndex` は最大 29271。コア領域。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 719/719 | 1〜7204（40+ 種） | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 719/719 | 1〜29264（40+ 種） | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| CanvasId | 整数 |  | .clip 719/719 | 1〜2（2 種） | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| LayerId | 整数 |  | .clip 719/719 | 0〜2467（40+ 種） | ○ | 確認済み | 属するレイヤー（Layer.MainId）。0 はキャンバス全体のもの（用紙など） |
| NextIndex | 整数 |  | .clip 719/719 | 0〜29264（40+ 種） | ○ | 確認済み | 同じ並びの次の行の MainId（連結リスト、0 で終わり） |
| Offscreen | 整数 | Offscreen | .clip 719/719 | 1〜31879（40+ 種） | ○ | 確認済み | この段の画素（Offscreen.MainId） |
| ThisScale | 実数 |  | .clip 719/719 | 0.3906〜100（9 種） | ○ | 確認済み | この段の倍率（%）。100、50、25…と半分ずつ |

## ModelData3D

3D モデルのデータ（外部チャンク）。`ElemScheme.MaxIndex` は最大 9。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| CanvasId | 整数 |  | — |  | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| Layer3DModelData | BLOB | 外部チャンク | — |  | ○ | 未解明 |  |

## ModelInfo3D

3D モデルの情報。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| BBox | BLOB |  | — |  |  | 未解明 |  |
| CanvasId | 整数 |  | — |  | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| DessindollBoneInfo | BLOB |  | — |  |  | 未解明 |  |
| DessindollShapeInfo | BLOB |  | — |  |  | 未解明 |  |
| FacialCategory | 整数 |  | — |  |  | 未解明 |  |
| FacialDetailEyes | 整数 |  | — |  |  | 未解明 |  |
| FacialDetailMouth | 整数 |  | — |  |  | 未解明 |  |
| ForcedTextureOff | 整数 |  | — |  |  | 未解明 |  |
| GroundHeight | 実数 |  | — |  |  | 未解明 |  |
| GroundToeAutoPosition | 整数 |  | — |  |  | 未解明 |  |
| IsModelEditLocked | 整数 |  | — |  |  | 未解明 |  |
| IsModelVisible | 整数 |  | — |  |  | 未解明 |  |
| LastVisibleType | 整数 |  | — |  |  | 未解明 |  |
| LayerId | 整数 |  | — |  | ○ | 確認済み | 属するレイヤー（Layer.MainId）。0 はキャンバス全体のもの（用紙など） |
| ModelDocVer | 整数 |  | — |  |  | 未解明 |  |
| ModelNameForGUI | 文字列 |  | — |  |  | 未解明 |  |
| ModelNnbNodeInfoCount | 整数 |  | — |  |  | 未解明 |  |
| ModelNnbNodeInfoFirstIndex | 整数 | ModelNodeInfo3D | — |  |  | 未解明 |  |
| ModelNo | 整数 |  | — |  |  | 未解明 |  |
| ModelNodeInfo | BLOB |  | — |  |  | 未解明 |  |
| ModelNodeInfoCount | 整数 |  | — |  |  | 未解明 |  |
| ModelNodeInfoFirstIndex | 整数 | ModelNodeInfo3D | — |  |  | 未解明 |  |
| ModelNodeRotation | BLOB |  | — |  |  | 未解明 |  |
| ModelRootNodeTranslation | BLOB |  | — |  |  | 未解明 |  |
| ModelSkeletonRootNodeTranslation | BLOB |  | — |  |  | 未解明 |  |
| ModelSkirtClothNodeInfo | BLOB |  | — |  |  | 未解明 |  |
| ModelType | 整数 |  | — |  |  | 未解明 |  |
| NextIndex | 整数 |  | — |  | ○ | 確認済み | 同じ並びの次の行の MainId（連結リスト、0 で終わり） |
| OffsetScale | 実数 |  | — |  |  | 未解明 |  |
| OutlineColorA | 整数 |  | — |  |  | 未解明 |  |
| OutlineColorB | 整数 |  | — |  |  | 未解明 |  |
| OutlineColorG | 整数 |  | — |  |  | 未解明 |  |
| OutlineColorR | 整数 |  | — |  |  | 未解明 |  |
| OutlineWidth | 実数 |  | — |  |  | 未解明 |  |
| PartsAc | BLOB |  | — |  |  | 未解明 |  |
| PartsAngle | 整数 |  | — |  |  | 未解明 |  |
| PartsBody | 整数 |  | — |  |  | 未解明 |  |
| PartsFace | 整数 |  | — |  |  | 未解明 |  |
| PartsHair | 整数 |  | — |  |  | 未解明 |  |
| PartsLayout | 整数 |  | — |  |  | 未解明 |  |
| PartsMaterial | 整数 |  | — |  |  | 未解明 |  |
| PartsMovable | BLOB |  | — |  |  | 未解明 |  |
| PartsTransform | 整数 |  | — |  |  | 未解明 |  |
| Scale | 整数 |  | — |  |  | 未解明 |  |
| ScaleFloat | 実数 |  | — |  |  | 未解明 |  |
| SkirtBendSpring | 実数 |  | — |  |  | 未解明 |  |
| SkirtGravity | 実数 |  | — |  |  | 未解明 |  |
| SkirtSpryness | 実数 |  | — |  |  | 未解明 |  |

## ModelNodeInfo3D

3D モデルの節点。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| CanvasId | 整数 |  | — |  | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| LayerId | 整数 |  | — |  | ○ | 確認済み | 属するレイヤー（Layer.MainId）。0 はキャンバス全体のもの（用紙など） |
| NextIndex | 整数 |  | — |  | ○ | 確認済み | 同じ並びの次の行の MainId（連結リスト、0 で終わり） |
| NodeName | 文字列 |  | — |  |  | 未解明 |  |
| NodeRotationR | 実数 |  | — |  |  | 未解明 |  |
| NodeRotationVX | 実数 |  | — |  |  | 未解明 |  |
| NodeRotationVY | 実数 |  | — |  |  | 未解明 |  |
| NodeRotationVZ | 実数 |  | — |  |  | 未解明 |  |
| NodeScaleX | 実数 |  | — |  |  | 未解明 |  |
| NodeScaleY | 実数 |  | — |  |  | 未解明 |  |
| NodeScaleZ | 実数 |  | — |  |  | 未解明 |  |
| NodeTranslationX | 実数 |  | — |  |  | 未解明 |  |
| NodeTranslationY | 実数 |  | — |  |  | 未解明 |  |
| NodeTranslationZ | 実数 |  | — |  |  | 未解明 |  |
| NodeTreeGUIOpened | 整数 |  | — |  |  | 推測 | パレットでの開閉と表示名 |
| NodeTreeGUIVisible | 整数 |  | — |  |  | 未解明 |  |

## Offscreen

画素の格納（256×256 のブロックの格子）。`ElemScheme.MaxIndex` は最大 31886。コア領域。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 719/719 | 1〜8290（40+ 種） | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 719/719 | 1〜31879（40+ 種） | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| Attribute | BLOB |  | .clip 719/719 | 長さ ≤ 26966 | ○ | 確認済み | 格納の形（BLOB）。Parameter（大きさ・ブロック数・画素の形式）、InitColor（初期の色）、BlockSize。04 章 |
| BlockData | BLOB | 外部チャンク | .clip 719/719 | 長さ ≤ 40 | ○ | 確認済み | ブロックの外部チャンクの ID（40 文字） |
| CanvasId | 整数 |  | .clip 719/719 | 1〜2（2 種） | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| LayerId | 整数 |  | .clip 719/719 | 0〜2467（40+ 種） | ○ | 確認済み | 属するレイヤー（Layer.MainId）。0 はキャンバス全体のもの（用紙など） |

## PrimitiveInfo

3D プリミティブ。`ElemScheme.MaxIndex` は最大 2。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| CanvasId | 整数 |  | — |  | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| DiffuseBaseTextureImageValid | 整数 |  | — |  |  | 未解明 |  |
| DiffuseTextureExternalFilePath | BLOB |  | — |  |  | 未解明 |  |
| LayerId | 整数 |  | — |  | ○ | 確認済み | 属するレイヤー（Layer.MainId）。0 はキャンバス全体のもの（用紙など） |
| LayerObjectId | 整数 |  | — |  |  | 推測 | 属する 3D オブジェクト（LayerObject.MainId） |
| NormalTextureExternalFilePath | BLOB |  | — |  |  | 未解明 |  |
| PrimitiveGUIOpened | 整数 |  | — |  |  | 推測 | パレットでの開閉と表示名 |
| PrimitiveUUID | 文字列 |  | — |  |  | 推測 | UUID |

## Project

ファイル全体（1 行）。.cmc では作品の設定。`ElemScheme.MaxIndex` は最大 1。コア領域。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 719/719<br>.cmc 42/42 | .clip: 1<br>.cmc: 1 | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| ComicBindAndStartPageIndeterminate | 未登録 |  | .cmc 42/1 | 0〜1（2 種） | ○ | 推測 | 綴じと開始ページが決まっていない（1。縦スクロールの作品で 1） |
| ComicBindPosition | 整数 |  | .cmc 42/41 | 0〜1（2 種） | ○ | 確認済み | .cmc の綴じる位置（1 右綴じ、0 左綴じ。CSP で作った作品で確認、V8） |
| ComicCoverExist | 整数 |  | .cmc 42/7 | 0〜1（2 種） | ○ | 確認済み | .cmc に表紙がある（1。表 1〜表 4 のページと DefaultCover* の列が加わる。V8） |
| ComicShowStyle | 整数 |  | .cmc 42/1 | 0〜1（2 種） | ○ | 推測 | .cmc の作品の種類（0 見開きの本、1 縦スクロール（Webtoon）。1 の作品では製本リストが使えない） |
| ComicStartPage | 整数 |  | .cmc 42/6 | 0〜1（2 種） | ○ | 確認済み | .cmc の開始ページ（0 左から、1 右から。V8） |
| ComicStoryAuthorName | 文字列 |  | .clip 101/0<br>.cmc 42/40 | .cmc: 長さ ≤ 6 | ○ | 確認済み | 作品情報（作品名・話数・作者名・ノンブルの書式と位置）の既定値。Canvas の同名の列と同じ意味。新規作成で書く |
| ComicStoryAuthorPosition | 整数 |  | .clip 101/101<br>.cmc 42/42 | .clip: 2<br>.cmc: 2 | ○ | 確認済み | 作品情報（作品名・話数・作者名・ノンブルの書式と位置）の既定値。Canvas の同名の列と同じ意味。新規作成で書く |
| ComicStoryNombreColor | 整数 |  | .clip 101/0<br>.cmc 42/0 | .clip: 0<br>.cmc: 0 | ○ | 確認済み | 作品情報（作品名・話数・作者名・ノンブルの書式と位置）の既定値。Canvas の同名の列と同じ意味。新規作成で書く |
| ComicStoryNombreEdgeUnit | 整数 |  | .clip 101/101<br>.cmc 42/42 | .clip: 2<br>.cmc: 2 | ○ | 確認済み | 作品情報（作品名・話数・作者名・ノンブルの書式と位置）の既定値。Canvas の同名の列と同じ意味。新規作成で書く |
| ComicStoryNombreEdgeWidth | 実数 |  | .clip 101/101<br>.cmc 42/42 | .clip: 0.5<br>.cmc: 0.3〜0.5（2 種） | ○ | 確認済み | 作品情報（作品名・話数・作者名・ノンブルの書式と位置）の既定値。Canvas の同名の列と同じ意味。新規作成で書く |
| ComicStoryNombreFont | 文字列 |  | .clip 101/101<br>.cmc 42/42 | .clip: 長さ ≤ 15<br>.cmc: 長さ ≤ 15 | ○ | 確認済み | 作品情報（作品名・話数・作者名・ノンブルの書式と位置）の既定値。Canvas の同名の列と同じ意味。新規作成で書く |
| ComicStoryNombreFontPostScriptName | 文字列 |  | .clip 101/101<br>.cmc 42/42 | .clip: 長さ ≤ 12<br>.cmc: 長さ ≤ 13 | ○ | 確認済み | 作品情報（作品名・話数・作者名・ノンブルの書式と位置）の既定値。Canvas の同名の列と同じ意味。新規作成で書く |
| ComicStoryNombreFontSize | 実数 |  | .clip 101/101<br>.cmc 42/42 | .clip: 9<br>.cmc: 9 | ○ | 確認済み | 作品情報（作品名・話数・作者名・ノンブルの書式と位置）の既定値。Canvas の同名の列と同じ意味。新規作成で書く |
| ComicStoryNombrePosition | 整数 |  | .clip 101/101<br>.cmc 42/42 | .clip: 5<br>.cmc: 5〜6（2 種） | ○ | 確認済み | 作品情報（作品名・話数・作者名・ノンブルの書式と位置）の既定値。Canvas の同名の列と同じ意味。新規作成で書く |
| ComicStoryNombrePrefix | 文字列 |  | .clip 101/0<br>.cmc 42/0 |  | ○ | 確認済み | 作品情報（作品名・話数・作者名・ノンブルの書式と位置）の既定値。Canvas の同名の列と同じ意味。新規作成で書く |
| ComicStoryNombreStart | 整数 |  | .clip 101/101<br>.cmc 42/42 | .clip: 1<br>.cmc: 1 | ○ | 確認済み | 作品情報（作品名・話数・作者名・ノンブルの書式と位置）の既定値。Canvas の同名の列と同じ意味。新規作成で書く |
| ComicStoryNombreSuffix | 文字列 |  | .clip 101/0<br>.cmc 42/0 |  | ○ | 確認済み | 作品情報（作品名・話数・作者名・ノンブルの書式と位置）の既定値。Canvas の同名の列と同じ意味。新規作成で書く |
| ComicStoryNombreUseEdge | 整数 |  | .clip 101/0<br>.cmc 42/3 | .clip: 0<br>.cmc: 0〜1（2 種） | ○ | 確認済み | 作品情報（作品名・話数・作者名・ノンブルの書式と位置）の既定値。Canvas の同名の列と同じ意味。新規作成で書く |
| ComicStoryPageNumberPosition | 整数 |  | .clip 101/101<br>.cmc 42/42 | .clip: 3<br>.cmc: 3 | ○ | 確認済み | 作品情報（作品名・話数・作者名・ノンブルの書式と位置）の既定値。Canvas の同名の列と同じ意味。新規作成で書く |
| ComicStoryPageNumberStart | 整数 |  | .clip 101/101<br>.cmc 42/42 | .clip: 1<br>.cmc: 1 | ○ | 確認済み | 作品情報（作品名・話数・作者名・ノンブルの書式と位置）の既定値。Canvas の同名の列と同じ意味。新規作成で書く |
| ComicStoryStoryIndex | 整数 |  | .clip 101/101<br>.cmc 42/41 | .clip: 1<br>.cmc: 0〜11（12 種） | ○ | 確認済み | 作品情報（作品名・話数・作者名・ノンブルの書式と位置）の既定値。Canvas の同名の列と同じ意味。新規作成で書く |
| ComicStoryStoryName | 文字列 |  | .clip 101/0<br>.cmc 42/38 | .cmc: 長さ ≤ 22 | ○ | 確認済み | 作品情報（作品名・話数・作者名・ノンブルの書式と位置）の既定値。Canvas の同名の列と同じ意味。新規作成で書く |
| ComicStoryStoryPosition | 整数 |  | .clip 101/101<br>.cmc 42/42 | .clip: 1<br>.cmc: 1 | ○ | 確認済み | 作品情報（作品名・話数・作者名・ノンブルの書式と位置）の既定値。Canvas の同名の列と同じ意味。新規作成で書く |
| ComicStorySubTitle | 文字列 |  | .clip 101/0<br>.cmc 42/2 | .cmc: 長さ ≤ 12 | ○ | 確認済み | 作品情報（作品名・話数・作者名・ノンブルの書式と位置）の既定値。Canvas の同名の列と同じ意味。新規作成で書く |
| ComicStoryUseHiddenNombre | 整数 |  | .clip 101/0<br>.cmc 42/10 | .clip: 0<br>.cmc: 0〜1（2 種） | ○ | 確認済み | 作品情報（作品名・話数・作者名・ノンブルの書式と位置）の既定値。Canvas の同名の列と同じ意味。新規作成で書く |
| ComicStoryUsePageNumber | 整数 |  | .clip 101/0<br>.cmc 42/0 | .clip: 0<br>.cmc: 0 | ○ | 確認済み | 作品情報（作品名・話数・作者名・ノンブルの書式と位置）の既定値。Canvas の同名の列と同じ意味。新規作成で書く |
| ComicStoryUseShownNombre | 整数 |  | .clip 101/0<br>.cmc 42/1 | .clip: 0<br>.cmc: 0〜1（2 種） | ○ | 確認済み | 作品情報（作品名・話数・作者名・ノンブルの書式と位置）の既定値。Canvas の同名の列と同じ意味。新規作成で書く |
| ComicStoryUseStoryIndex | 整数 |  | .clip 101/0<br>.cmc 42/29 | .clip: 0<br>.cmc: 0〜1（2 種） | ○ | 確認済み | 作品情報（作品名・話数・作者名・ノンブルの書式と位置）の既定値。Canvas の同名の列と同じ意味。新規作成で書く |
| ComicStoryXPageNombreOffset | 未登録 |  | .clip 101/0<br>.cmc 42/0 | .clip: 0<br>.cmc: 0 | ○ | 確認済み | 作品情報（作品名・話数・作者名・ノンブルの書式と位置）の既定値。Canvas の同名の列と同じ意味。新規作成で書く |
| ComicStoryXPageNombreOffsetUnit | 未登録 |  | .clip 101/101<br>.cmc 42/42 | .clip: 2<br>.cmc: 2 | ○ | 確認済み | 作品情報（作品名・話数・作者名・ノンブルの書式と位置）の既定値。Canvas の同名の列と同じ意味。新規作成で書く |
| ComicStoryYPageNombreOffset | 実数 |  | .clip 101/101<br>.cmc 42/42 | .clip: 5<br>.cmc: 5 | ○ | 確認済み | 作品情報（作品名・話数・作者名・ノンブルの書式と位置）の既定値。Canvas の同名の列と同じ意味。新規作成で書く |
| ComicStoryYPageNombreOffsetUnit | 整数 |  | .clip 101/101<br>.cmc 42/42 | .clip: 2<br>.cmc: 2 | ○ | 確認済み | 作品情報（作品名・話数・作者名・ノンブルの書式と位置）の既定値。Canvas の同名の列と同じ意味。新規作成で書く |
| ComicWebtoonWrapDirection | 整数 |  | .cmc 42/42 | 1 | ○ | 推測 | 縦スクロール（Webtoon）の折り返しの向き |
| CopiedCanvasIndex | 整数 |  | — |  |  | 推測 | コピーしたキャンバスの番号。コーパスでは未設定 |
| Cover1Prefix | 文字列 |  | — |  |  | 推測 | 表紙（表 1・表 4）と本文のノンブルの前後の文字。コーパスでは未設定 |
| Cover1Suffix | 文字列 |  | — |  |  | 推測 | 表紙（表 1・表 4）と本文のノンブルの前後の文字。コーパスでは未設定 |
| Cover4Prefix | 文字列 |  | — |  |  | 推測 | 表紙（表 1・表 4）と本文のノンブルの前後の文字。コーパスでは未設定 |
| Cover4Suffix | 文字列 |  | — |  |  | 推測 | 表紙（表 1・表 4）と本文のノンブルの前後の文字。コーパスでは未設定 |
| DefaultCoverBlackChecked | 未登録 |  | .cmc 7/7 | 1 |  | 推測 | 表紙の既定（解像度・用紙・テンプレート・表現色・カラープロファイル）。表紙ありの作品を作ると加わる（V8） |
| DefaultCoverChannelBytes | 整数 |  | .cmc 7/7 | 1 |  | 推測 | 表紙の既定（解像度・用紙・テンプレート・表現色・カラープロファイル）。表紙ありの作品を作ると加わる（V8） |
| DefaultCoverColorTypeIndex | 未登録 |  | .cmc 7/0 | 0 |  | 推測 | 表紙の既定（解像度・用紙・テンプレート・表現色・カラープロファイル）。表紙ありの作品を作ると加わる（V8） |
| DefaultCoverIsUserTemplate | 整数 |  | .cmc 7/0 | 0 |  | 推測 | 表紙の既定（解像度・用紙・テンプレート・表現色・カラープロファイル）。表紙ありの作品を作ると加わる（V8） |
| DefaultCoverPaperBlue | 整数 |  | .cmc 7/7 | 4294967295 |  | 推測 | 表紙の既定（解像度・用紙・テンプレート・表現色・カラープロファイル）。表紙ありの作品を作ると加わる（V8） |
| DefaultCoverPaperGreen | 整数 |  | .cmc 7/7 | 4294967295 |  | 推測 | 表紙の既定（解像度・用紙・テンプレート・表現色・カラープロファイル）。表紙ありの作品を作ると加わる（V8） |
| DefaultCoverPaperRed | 整数 |  | .cmc 7/7 | 4294967295 |  | 推測 | 表紙の既定（解像度・用紙・テンプレート・表現色・カラープロファイル）。表紙ありの作品を作ると加わる（V8） |
| DefaultCoverResolution | 実数 |  | .cmc 7/7 | 350〜600（3 種） |  | 推測 | 表紙の既定（解像度・用紙・テンプレート・表現色・カラープロファイル）。表紙ありの作品を作ると加わる（V8） |
| DefaultCoverSimulateColorProfile | BLOB |  | — |  |  | 推測 | 表紙の既定（解像度・用紙・テンプレート・表現色・カラープロファイル）。表紙ありの作品を作ると加わる（V8） |
| DefaultCoverSrcColorProfile | BLOB |  | — |  |  | 推測 | 表紙の既定（解像度・用紙・テンプレート・表現色・カラープロファイル）。表紙ありの作品を作ると加わる（V8） |
| DefaultCoverTemplateName | 文字列 |  | .cmc 7/0 |  |  | 推測 | 表紙の既定（解像度・用紙・テンプレート・表現色・カラープロファイル）。表紙ありの作品を作ると加わる（V8） |
| DefaultCoverTemplatePath | 文字列 |  | .cmc 7/5 | 長さ ≤ 55 |  | 推測 | 表紙の既定（解像度・用紙・テンプレート・表現色・カラープロファイル）。表紙ありの作品を作ると加わる（V8） |
| DefaultCoverTemplatePath2 | 文字列 |  | .cmc 7/6 | 長さ ≤ 55 |  | 推測 | 表紙の既定（解像度・用紙・テンプレート・表現色・カラープロファイル）。表紙ありの作品を作ると加わる（V8） |
| DefaultCoverTemplateUUID | 文字列 |  | .cmc 7/5 | 長さ ≤ 36 |  | 推測 | 表紙の既定（解像度・用紙・テンプレート・表現色・カラープロファイル）。表紙ありの作品を作ると加わる（V8） |
| DefaultCoverToneLine | 未登録 |  | .cmc 7/7 | 60 |  | 推測 | 表紙の既定（解像度・用紙・テンプレート・表現色・カラープロファイル）。表紙ありの作品を作ると加わる（V8） |
| DefaultCoverUsePaper | 整数 |  | .cmc 7/7 | 1 |  | 推測 | 表紙の既定（解像度・用紙・テンプレート・表現色・カラープロファイル）。表紙ありの作品を作ると加わる（V8） |
| DefaultCoverUseTemplate | 整数 |  | .cmc 7/0 | 0 |  | 推測 | 表紙の既定（解像度・用紙・テンプレート・表現色・カラープロファイル）。表紙ありの作品を作ると加わる（V8） |
| DefaultCoverWhiteChecked | 未登録 |  | .cmc 7/7 | 1 |  | 推測 | 表紙の既定（解像度・用紙・テンプレート・表現色・カラープロファイル）。表紙ありの作品を作ると加わる（V8） |
| DefaultPageBlackChecked | 未登録 |  | .clip 256/256<br>.cmc 42/42 | .clip: 1<br>.cmc: 1 | ○ | 推測 | 既定の表現色（カラー・グレー・モノクロ）と、モノクロの黒・白、トーンの線数 |
| DefaultPageCelIsUserTemplate | 整数 |  | .clip 256/0<br>.cmc 42/0 | .clip: 0<br>.cmc: 0 | ○ | 推測 | 既定のページ（Cel はセル）に使うテンプレートと、それがユーザーのものか |
| DefaultPageCelTemplateName | 文字列 |  | .clip 256/0<br>.cmc 42/0 |  | ○ | 推測 | 既定のページ（Cel はセル）に使うテンプレートと、それがユーザーのものか |
| DefaultPageCelTemplatePath | 文字列 |  | .clip 256/0<br>.cmc 42/0 |  | ○ | 推測 | 既定のページ（Cel はセル）に使うテンプレートと、それがユーザーのものか |
| DefaultPageCelTemplatePath2 | 文字列 |  | .clip 256/0<br>.cmc 42/0 |  | ○ | 推測 | 既定のページ（Cel はセル）に使うテンプレートと、それがユーザーのものか |
| DefaultPageCelTemplateUUID | 未登録 |  | .clip 256/0<br>.cmc 42/0 |  | ○ | 推測 | 既定のページ（Cel はセル）に使うテンプレートと、それがユーザーのものか |
| DefaultPageCelUseTemplate | 整数 |  | .clip 256/0<br>.cmc 42/0 | .clip: 0<br>.cmc: 0 | ○ | 推測 | 既定のページ（Cel はセル）に使うテンプレートと、それがユーザーのものか |
| DefaultPageChannelBytes | 整数 |  | .clip 256/256<br>.cmc 42/42 | .clip: 1<br>.cmc: 1 | ○ | 確認済み | 既定の画素の形式（Canvas.CanvasChannelBytes / CanvasDefaultChannelOrder と同じ） |
| DefaultPageChannelOrder | 整数 |  | .clip 256/256<br>.cmc 42/42 | .clip: 17〜33（2 種）<br>.cmc: 17〜33（2 種） | ○ | 確認済み | 既定の画素の形式（Canvas.CanvasChannelBytes / CanvasDefaultChannelOrder と同じ） |
| DefaultPageCheckBookBinding | 整数 |  | .clip 256/0<br>.cmc 42/0 | .clip: 0<br>.cmc: 0 | ○ | 推測 | 製本の確認（綴じの向き）を使う |
| DefaultPageColorType | 未登録 |  | .clip 256/1<br>.cmc 42/6 | .clip: 0〜2（2 種）<br>.cmc: 0〜2（3 種） | ○ | 推測 | 既定の表現色（カラー・グレー・モノクロ）と、モノクロの黒・白、トーンの線数 |
| DefaultPageCropDitch | 実数 |  | .clip 1/1<br>.cmc 41/41 | .clip: 3<br>.cmc: 3〜5（2 種） | ○ | 推測 | 既定のトンボ（仕上がり・基本枠・裁ち落とし幅、Canvas.CropFrame* と同じ） |
| DefaultPageCropHeight | 実数 |  | .clip 1/1<br>.cmc 41/41 | .clip: 257<br>.cmc: 210〜364（4 種） | ○ | 推測 | 既定のトンボ（仕上がり・基本枠・裁ち落とし幅、Canvas.CropFrame* と同じ） |
| DefaultPageCropInnerHeight | 実数 |  | .clip 1/1<br>.cmc 41/41 | .clip: 219<br>.cmc: 180〜300（4 種） | ○ | 推測 | 既定のトンボ（仕上がり・基本枠・裁ち落とし幅、Canvas.CropFrame* と同じ） |
| DefaultPageCropInnerOffsetX | 実数 |  | .clip 1/0<br>.cmc 41/0 | .clip: 0<br>.cmc: 0 | ○ | 推測 | 既定のトンボ（仕上がり・基本枠・裁ち落とし幅、Canvas.CropFrame* と同じ） |
| DefaultPageCropInnerOffsetY | 実数 |  | .clip 1/0<br>.cmc 41/0 | .clip: 0<br>.cmc: 0 | ○ | 推測 | 既定のトンボ（仕上がり・基本枠・裁ち落とし幅、Canvas.CropFrame* と同じ） |
| DefaultPageCropInnerWidth | 実数 |  | .clip 1/1<br>.cmc 41/41 | .clip: 149<br>.cmc: 125〜268（5 種） | ○ | 推測 | 既定のトンボ（仕上がり・基本枠・裁ち落とし幅、Canvas.CropFrame* と同じ） |
| DefaultPageCropMergeDitch | 実数 |  | .clip 1/0<br>.cmc 41/0 | .clip: 0<br>.cmc: 0 | ○ | 推測 | 既定のトンボ（仕上がり・基本枠・裁ち落とし幅、Canvas.CropFrame* と同じ） |
| DefaultPageCropOffsetX | 実数 |  | .clip 1/0<br>.cmc 41/0 | .clip: 0<br>.cmc: 0 | ○ | 推測 | 既定のトンボ（仕上がり・基本枠・裁ち落とし幅、Canvas.CropFrame* と同じ） |
| DefaultPageCropOffsetY | 実数 |  | .clip 1/0<br>.cmc 41/0 | .clip: 0<br>.cmc: 0 | ○ | 推測 | 既定のトンボ（仕上がり・基本枠・裁ち落とし幅、Canvas.CropFrame* と同じ） |
| DefaultPageCropOptionFlag | 整数 |  | .clip 1/0<br>.cmc 41/0 | .clip: 0<br>.cmc: 0 | ○ | 推測 | 既定のトンボ（仕上がり・基本枠・裁ち落とし幅、Canvas.CropFrame* と同じ） |
| DefaultPageCropWidth | 実数 |  | .clip 1/1<br>.cmc 41/41 | .clip: 182<br>.cmc: 148〜297（5 種） | ○ | 推測 | 既定のトンボ（仕上がり・基本枠・裁ち落とし幅、Canvas.CropFrame* と同じ） |
| DefaultPageDoublePage | 整数 |  | .clip 256/0<br>.cmc 42/17 | .clip: 0<br>.cmc: 0〜1（2 種） | ○ | 確認済み | 対向ページを見開きにする（新規作成の設定。V8） |
| DefaultPageHeight | 実数 |  | .clip 256/256<br>.cmc 42/42 | .clip: 90〜8598（16 種）<br>.cmc: 257〜2500（5 種） | ○ | 確認済み | 作品の既定のページの大きさ（DefaultPageUnit の単位） |
| DefaultPageIsUserTemplate | 整数 |  | .clip 256/191<br>.cmc 42/32 | .clip: 0〜1（2 種）<br>.cmc: 0〜1（2 種） | ○ | 推測 | 既定のページ（Cel はセル）に使うテンプレートと、それがユーザーのものか |
| DefaultPagePaperBlue | 整数 |  | .clip 256/256<br>.cmc 42/42 | .clip: 3415657366〜4294967295（3 種）<br>.cmc: 4294967295 | ○ | 確認済み | 既定の用紙の色。32 ビットの値の上位 8 ビットが色の値 |
| DefaultPagePaperGreen | 整数 |  | .clip 256/256<br>.cmc 42/42 | .clip: 3415657366〜4294967295（3 種）<br>.cmc: 4294967295 | ○ | 確認済み | 既定の用紙の色。32 ビットの値の上位 8 ビットが色の値 |
| DefaultPagePaperRed | 整数 |  | .clip 256/256<br>.cmc 42/42 | .clip: 3415657366〜4294967295（3 種）<br>.cmc: 4294967295 | ○ | 確認済み | 既定の用紙の色。32 ビットの値の上位 8 ビットが色の値 |
| DefaultPagePresetID | 文字列 |  | .clip 256/0<br>.cmc 42/0 |  | ○ | 推測 | 既定のページのプリセットの ID |
| DefaultPageRecordTimeLapse | 整数 |  | .clip 243/0<br>.cmc 42/0 | .clip: 0<br>.cmc: 0 | ○ | 推測 | 既定のページでタイムラプスを記録するか、その形式 |
| DefaultPageResolution | 実数 |  | .clip 256/256<br>.cmc 42/42 | .clip: 350〜600（3 種）<br>.cmc: 350〜600（3 種） | ○ | 確認済み | 既定のページの解像度（dpi） |
| DefaultPageSafeMarginBottom | 実数 |  | .clip 1/0<br>.cmc 41/0 | .clip: 0<br>.cmc: 0 | ○ | 推測 | 既定の安全マージン（上下左右） |
| DefaultPageSafeMarginLeft | 実数 |  | .clip 1/0<br>.cmc 41/0 | .clip: 0<br>.cmc: 0 | ○ | 推測 | 既定の安全マージン（上下左右） |
| DefaultPageSafeMarginRight | 実数 |  | .clip 1/0<br>.cmc 41/0 | .clip: 0<br>.cmc: 0 | ○ | 推測 | 既定の安全マージン（上下左右） |
| DefaultPageSafeMarginTop | 実数 |  | .clip 1/0<br>.cmc 41/0 | .clip: 0<br>.cmc: 0 | ○ | 推測 | 既定の安全マージン（上下左右） |
| DefaultPageSettingType | 文字列 |  | .clip 256/256<br>.cmc 42/42 | .clip: 長さ ≤ 6<br>.cmc: 長さ ≤ 7 | ○ | 推測 | 既定のページの設定の種類（短い文字列） |
| DefaultPageTemplateName | 文字列 |  | .clip 256/191<br>.cmc 42/32 | .clip: 長さ ≤ 14<br>.cmc: 長さ ≤ 10 | ○ | 推測 | 既定のページ（Cel はセル）に使うテンプレートと、それがユーザーのものか |
| DefaultPageTemplatePath | 文字列 |  | .clip 256/191<br>.cmc 42/32 | .clip: 長さ ≤ 55<br>.cmc: 長さ ≤ 55 | ○ | 推測 | 既定のページ（Cel はセル）に使うテンプレートと、それがユーザーのものか |
| DefaultPageTemplatePath2 | 文字列 |  | .clip 256/191<br>.cmc 42/32 | .clip: 長さ ≤ 55<br>.cmc: 長さ ≤ 55 | ○ | 推測 | 既定のページ（Cel はセル）に使うテンプレートと、それがユーザーのものか |
| DefaultPageTemplateUUID | 文字列 |  | .clip 256/191<br>.cmc 42/32 | .clip: 長さ ≤ 36<br>.cmc: 長さ ≤ 36 | ○ | 推測 | 既定のページ（Cel はセル）に使うテンプレートと、それがユーザーのものか |
| DefaultPageTimeLapseCodec | 整数 |  | .clip 8/0<br>.cmc 3/0 | .clip: 0<br>.cmc: 0 | ○ | 推測 | 既定のページでタイムラプスを記録するか、その形式 |
| DefaultPageToneLine | 未登録 |  | .clip 256/256<br>.cmc 42/42 | .clip: 60<br>.cmc: 60 | ○ | 推測 | 既定の表現色（カラー・グレー・モノクロ）と、モノクロの黒・白、トーンの線数 |
| DefaultPageUnit | 整数 |  | .clip 256/130<br>.cmc 42/41 | .clip: 0〜2（2 種）<br>.cmc: 0〜2（2 種） | ○ | 確認済み | 既定のページの単位（0 px、1 cm、2 mm、3 inch、5 pt） |
| DefaultPageUseCropFrame | 整数 |  | .clip 256/1<br>.cmc 42/41 | .clip: 0〜1（2 種）<br>.cmc: 0〜1（2 種） | ○ | 推測 | 既定のページにトンボを付ける |
| DefaultPageUseDefaultCoverInfo | 整数 |  | .clip 256/0<br>.cmc 42/7 | .clip: 0<br>.cmc: 0〜1（2 種） | ○ | 確認済み | 表紙の既定（DefaultCover*）を使う。表紙ありの作品で 1（V8） |
| DefaultPageUsePaper | 整数 |  | .clip 256/98<br>.cmc 42/42 | .clip: 0〜1（2 種）<br>.cmc: 1 | ○ | 確認済み | 既定のページで用紙を作る |
| DefaultPageUseTemplate | 整数 |  | .clip 256/149<br>.cmc 42/5 | .clip: 0〜1（2 種）<br>.cmc: 0〜1（2 種） | ○ | 推測 | 既定のページ（Cel はセル）に使うテンプレートと、それがユーザーのものか |
| DefaultPageWhiteChecked | 未登録 |  | .clip 256/256<br>.cmc 42/42 | .clip: 1<br>.cmc: 1 | ○ | 推測 | 既定の表現色（カラー・グレー・モノクロ）と、モノクロの黒・白、トーンの線数 |
| DefaultPageWidth | 実数 |  | .clip 256/256<br>.cmc 42/42 | .clip: 154〜8598（17 種）<br>.cmc: 182〜690（6 種） | ○ | 確認済み | 作品の既定のページの大きさ（DefaultPageUnit の単位） |
| DefaultSimulatePageColorProfile | BLOB |  | .clip 6/5 | 長さ ≤ 3144 | ○ | 推測 | 既定の色の設定（ICC プロファイル）。元と、刷り上がりのシミュレーション |
| DefaultSrcPageColorProfile | BLOB |  | .clip 6/5 | 長さ ≤ 3144 | ○ | 推測 | 既定の色の設定（ICC プロファイル）。元と、刷り上がりのシミュレーション |
| MaxCanvasFileIndex | 整数 |  | .cmc 42/42 | 3〜49（21 種） | ○ | 確認済み | .cmc のページのファイル名に使った最大の番号。新しいページは + 1 |
| PrintingCompanyID | 文字列 |  | .cmc 3/3 | 長さ ≤ 4 |  | 推測 | 入稿先の印刷所の ID |
| ProjectCanvas | 整数 | Canvas | .clip 719/719 | 1〜2（2 種） | ○ | 確認済み | キャンバス（Canvas.MainId） |
| ProjectCutBank | 整数 | AnimationCutBank | .clip 719/719 | 2 | ○ | 確認済み | アニメーションのカット（AnimationCutBank.MainId） |
| ProjectInternalVersion | 文字列 |  | .clip 719/719<br>.cmc 42/42 | .clip: 長さ ≤ 5<br>.cmc: 長さ ≤ 5 | ○ | 確認済み | CSP の内部版（短い文字列）。新規作成では CSP が保存したファイルと同じ値を書く |
| ProjectItemBank | 整数 | CanvasItemBank | .clip 719/719 | 1 | ○ | 確認済み | 素材の保管庫（CanvasItemBank.MainId） |
| ProjectLayerCompManager | 整数 | LayerCompManager | .clip 140/140 | 3 | ○ | 確認済み | レイヤーカンプの一覧（LayerCompManager.MainId） |
| ProjectName | 文字列 |  | .clip 719/719 | 長さ ≤ 3 | ○ | 確認済み | プロジェクト名（短い文字列） |
| ProjectProgressStep | 整数 |  | — |  |  | 推測 | 作業の進み（企画・ネーム・下描き…）。コーパスでは未設定 |
| ProjectRootCanvasNode | 整数 | CanvasNode | .clip 719/0<br>.cmc 42/42 | .clip: 0<br>.cmc: 1 | ○ | 確認済み | .cmc の最初のページ（CanvasNode.MainId）。.clip では 0 |
| SentencePrefix | 文字列 |  | — |  |  | 推測 | 表紙（表 1・表 4）と本文のノンブルの前後の文字。コーパスでは未設定 |
| SentenceSuffix | 文字列 |  | — |  |  | 推測 | 表紙（表 1・表 4）と本文のノンブルの前後の文字。コーパスでは未設定 |
| WebCooperationUploadToken | 文字列 |  | — |  |  | 推測 | Web 連携（アップロード先と鍵）。コーパスでは未設定 |
| WebCooperationUploadUrl | 文字列 |  | — |  |  | 推測 | Web 連携（アップロード先と鍵）。コーパスでは未設定 |

## RemovedExternal

削除された外部チャンクの ID。コーパスでは常に空。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| ExternalID | 未登録 |  | .clip 719/0 |  | ○ | 推測 | 削除された外部チャンクの ID。コーパスでは常に空 |

## RoomInfo

3D の背景（部屋）。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| CanvasId | 整数 |  | — |  | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| CanvasItemSourceFileName | 文字列 |  | — |  |  | 推測 | 素材の出どころ（ファイル名、素材の配布の ID・版・所有者） |
| CanvasItemSourceIsMadeByCanvasItemMaker | 整数 |  | — |  |  | 推測 | 素材の出どころ（ファイル名、素材の配布の ID・版・所有者） |
| CanvasItemSourceMaterialAssetsContentId | 整数 |  | — |  |  | 推測 | 素材の出どころ（ファイル名、素材の配布の ID・版・所有者） |
| CanvasItemSourceMaterialIsUploadable | 整数 |  | — |  |  | 推測 | 素材の出どころ（ファイル名、素材の配布の ID・版・所有者） |
| CanvasItemSourceMaterialOwnerUserId | 整数 |  | — |  |  | 推測 | 素材の出どころ（ファイル名、素材の配布の ID・版・所有者） |
| CanvasItemSourceMaterialRevision | 文字列 |  | — |  |  | 推測 | 素材の出どころ（ファイル名、素材の配布の ID・版・所有者） |
| LayerId | 整数 |  | — |  | ○ | 確認済み | 属するレイヤー（Layer.MainId）。0 はキャンバス全体のもの（用紙など） |
| LayerObjectId | 整数 |  | — |  |  | 推測 | 属する 3D オブジェクト（LayerObject.MainId） |
| RoomObjectUUID | 文字列 |  | — |  |  | 推測 | UUID |

## RulerConcentricCircle

同心円定規。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| CanvasId | 整数 |  | — |  | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| CenterX | 実数 |  | — |  |  | 推測 | 定規の中心・回転・吸着・線の数・線対称 |
| CenterY | 実数 |  | — |  |  | 推測 | 定規の中心・回転・吸着・線の数・線対称 |
| LayerId | 整数 |  | — |  | ○ | 確認済み | 属するレイヤー（Layer.MainId）。0 はキャンバス全体のもの（用紙など） |
| NextIndex | 整数 |  | — |  | ○ | 確認済み | 同じ並びの次の行の MainId（連結リスト、0 で終わり） |
| RadiusX | 実数 |  | — |  |  | 未解明 |  |
| RadiusY | 実数 |  | — |  |  | 未解明 |  |
| Rotate | 実数 |  | — |  |  | 推測 | 定規の中心・回転・吸着・線の数・線対称 |
| Snap | 整数 |  | — |  |  | 推測 | 定規の中心・回転・吸着・線の数・線対称 |

## RulerCurveEmit

曲線の放射線定規。`ElemScheme.MaxIndex` は最大 1。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| CanvasId | 整数 |  | — |  | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| CurveKind | 整数 |  | — |  |  | 未解明 |  |
| LayerId | 整数 |  | — |  | ○ | 確認済み | 属するレイヤー（Layer.MainId）。0 はキャンバス全体のもの（用紙など） |
| NextIndex | 整数 |  | — |  | ○ | 確認済み | 同じ並びの次の行の MainId（連結リスト、0 で終わり） |
| PointData | BLOB |  | — |  |  | 未解明 |  |
| Snap | 整数 |  | — |  |  | 推測 | 定規の中心・回転・吸着・線の数・線対称 |

## RulerCurveParallel

曲線の平行線定規。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| CanvasId | 整数 |  | — |  | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| CurveKind | 整数 |  | — |  |  | 未解明 |  |
| LayerId | 整数 |  | — |  | ○ | 確認済み | 属するレイヤー（Layer.MainId）。0 はキャンバス全体のもの（用紙など） |
| NextIndex | 整数 |  | — |  | ○ | 確認済み | 同じ並びの次の行の MainId（連結リスト、0 で終わり） |
| PointData | BLOB |  | — |  |  | 未解明 |  |
| Snap | 整数 |  | — |  |  | 推測 | 定規の中心・回転・吸着・線の数・線対称 |

## RulerEmit

放射線定規。`ElemScheme.MaxIndex` は最大 8。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 3/2 | 1〜2（2 種） | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 3/2 | 1〜2（2 種） | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| CanvasId | 整数 |  | .clip 3/2 | 1 | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| CenterX | 実数 |  | .clip 3/2 | 2152〜4924（3 種） |  | 推測 | 定規の中心・回転・吸着・線の数・線対称 |
| CenterY | 実数 |  | .clip 3/2 | 1833〜2266（3 種） |  | 推測 | 定規の中心・回転・吸着・線の数・線対称 |
| LayerId | 整数 |  | .clip 3/2 | 31〜70（3 種） | ○ | 確認済み | 属するレイヤー（Layer.MainId）。0 はキャンバス全体のもの（用紙など） |
| NextIndex | 整数 |  | .clip 3/0 | 0 | ○ | 確認済み | 同じ並びの次の行の MainId（連結リスト、0 で終わり） |
| Snap | 整数 |  | .clip 3/2 | 1 |  | 推測 | 定規の中心・回転・吸着・線の数・線対称 |

## RulerGuide

ガイド。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| CanvasId | 整数 |  | — |  | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| CenterX | 実数 |  | — |  |  | 推測 | 定規の中心・回転・吸着・線の数・線対称 |
| CenterY | 実数 |  | — |  |  | 推測 | 定規の中心・回転・吸着・線の数・線対称 |
| IsHorz | 整数 |  | — |  |  | 未解明 |  |
| LayerId | 整数 |  | — |  | ○ | 確認済み | 属するレイヤー（Layer.MainId）。0 はキャンバス全体のもの（用紙など） |
| NextIndex | 整数 |  | — |  | ○ | 確認済み | 同じ並びの次の行の MainId（連結リスト、0 で終わり） |
| Snap | 整数 |  | — |  |  | 推測 | 定規の中心・回転・吸着・線の数・線対称 |

## RulerMultiCurve

連続曲線の定規。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| CanvasId | 整数 |  | — |  | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| CenterX | 実数 |  | — |  |  | 推測 | 定規の中心・回転・吸着・線の数・線対称 |
| CenterY | 実数 |  | — |  |  | 推測 | 定規の中心・回転・吸着・線の数・線対称 |
| CurveKind | 整数 |  | — |  |  | 未解明 |  |
| LayerId | 整数 |  | — |  | ○ | 確認済み | 属するレイヤー（Layer.MainId）。0 はキャンバス全体のもの（用紙など） |
| NextIndex | 整数 |  | — |  | ○ | 確認済み | 同じ並びの次の行の MainId（連結リスト、0 で終わり） |
| OffsetAngle | 実数 |  | — |  |  | 未解明 |  |
| PointData | BLOB |  | — |  |  | 未解明 |  |
| Snap | 整数 |  | — |  |  | 推測 | 定規の中心・回転・吸着・線の数・線対称 |

## RulerParallel

平行線定規。`ElemScheme.MaxIndex` は最大 6。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 2/1 | 1〜2（2 種） | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 2/1 | 1〜2（2 種） | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| CanvasId | 整数 |  | .clip 2/1 | 1 | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| CenterX | 実数 |  | .clip 2/1 | -0.7962〜0.113（2 種） |  | 推測 | 定規の中心・回転・吸着・線の数・線対称 |
| CenterY | 実数 |  | .clip 2/1 | 0.1286〜0.2768（2 種） |  | 推測 | 定規の中心・回転・吸着・線の数・線対称 |
| LayerId | 整数 |  | .clip 2/1 | 35〜36（2 種） | ○ | 確認済み | 属するレイヤー（Layer.MainId）。0 はキャンバス全体のもの（用紙など） |
| NextIndex | 整数 |  | .clip 2/0 | 0 | ○ | 確認済み | 同じ並びの次の行の MainId（連結リスト、0 で終わり） |
| Rotate | 実数 |  | .clip 2/1 | 344.2〜348.9（2 種） |  | 推測 | 定規の中心・回転・吸着・線の数・線対称 |
| Snap | 整数 |  | .clip 2/1 | 1 |  | 推測 | 定規の中心・回転・吸着・線の数・線対称 |

## RulerPerspective

パース定規。`ElemScheme.MaxIndex` は最大 1392。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 67/64 | 1〜14（8 種） | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 67/64 | 1〜1388（18 種） | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| CameraNear | 実数 |  | .clip 67/64 | 233.7〜1.154e+04（40+ 種） |  | 推測 | アイレベルと移動のハンドルの位置、視点からの距離 |
| CanvasId | 整数 |  | .clip 67/64 | 1 | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| centerGuideDataSize | 整数 |  | .clip 22/0 |  |  | 推測 | 中心のガイド（数・大きさ・位置の BLOB） |
| centerGuideNumber | 整数 |  | .clip 22/0 |  |  | 推測 | 中心のガイド（数・大きさ・位置の BLOB） |
| centerGuidePosition | BLOB |  | .clip 22/0 |  |  | 推測 | 中心のガイド（数・大きさ・位置の BLOB） |
| Distortion | 整数 |  | .clip 22/6 | 1 |  | 推測 | 魚眼の定規の中心・半径と歪み |
| DistortionWeight | 実数 |  | .clip 22/6 | 5〜100（3 種） |  | 推測 | 魚眼の定規の中心・半径と歪み |
| EyeLevelHandleX | 実数 |  | .clip 67/64 | -3.635e+05〜3.9e+04（40+ 種） |  | 推測 | アイレベルと移動のハンドルの位置、視点からの距離 |
| EyeLevelHandleY | 実数 |  | .clip 67/64 | -7.628e+04〜9575（40+ 種） |  | 推測 | アイレベルと移動のハンドルの位置、視点からの距離 |
| FirstVanishIndex | 整数 | RulerVanishPoint | .clip 67/64 | 1〜4162（24 種） |  | 推測 | パースの種類（1〜3 点）、最初の消失点（RulerVanishPoint）、設定のビット |
| Flag | 整数 |  | .clip 67/64 | 0〜497（11 種） | ○ | 推測 | パースの種類（1〜3 点）、最初の消失点（RulerVanishPoint）、設定のビット |
| GridFlag | 整数 |  | .clip 67/13 | 0〜5（3 種） |  | 推測 | パースのグリッドの原点・大きさ・設定 |
| GridOriginX | 実数 |  | .clip 67/64 | 660.6〜1.304e+04（40+ 種） |  | 推測 | パースのグリッドの原点・大きさ・設定 |
| GridOriginY | 実数 |  | .clip 67/64 | 1574〜1.171e+04（40+ 種） |  | 推測 | パースのグリッドの原点・大きさ・設定 |
| GridSize | 実数 |  | .clip 67/64 | 3〜10（3 種） |  | 推測 | パースのグリッドの原点・大きさ・設定 |
| InitializedLens | 整数 |  | .clip 22/6 | 1 |  | 推測 | 魚眼の定規の中心・半径と歪み |
| LayerId | 整数 |  | .clip 67/64 | 8〜542（40+ 種） | ○ | 確認済み | 属するレイヤー（Layer.MainId）。0 はキャンバス全体のもの（用紙など） |
| LensCenterX | 実数 |  | .clip 22/6 | 3500〜1.052e+04（6 種） |  | 推測 | 魚眼の定規の中心・半径と歪み |
| LensCenterY | 実数 |  | .clip 22/6 | 1372〜7697（6 種） |  | 推測 | 魚眼の定規の中心・半径と歪み |
| LensRadius | 実数 |  | .clip 22/6 | 3000〜1.154e+04（6 種） |  | 推測 | 魚眼の定規の中心・半径と歪み |
| LensRadiusEditHandleAngle | 実数 |  | .clip 22/6 | 135〜322.5（3 種） |  | 推測 | 魚眼の定規の中心・半径と歪み |
| MoveHandleX | 実数 |  | .clip 67/64 | -786.4〜1.004e+04（38 種） |  | 推測 | アイレベルと移動のハンドルの位置、視点からの距離 |
| MoveHandleY | 実数 |  | .clip 67/64 | -458〜7634（40+ 種） |  | 推測 | アイレベルと移動のハンドルの位置、視点からの距離 |
| NextIndex | 整数 |  | .clip 67/1 | 0〜19（2 種） | ○ | 確認済み | 同じ並びの次の行の MainId（連結リスト、0 で終わり） |
| PerspectiveType | 整数 |  | .clip 67/64 | 1〜3（3 種） |  | 推測 | パースの種類（1〜3 点）、最初の消失点（RulerVanishPoint）、設定のビット |

## RulerSymmetry

対称定規。`ElemScheme.MaxIndex` は最大 4。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 2/2 | 1〜2（2 種） | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 2/2 | 2〜4（3 種） | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| CanvasId | 整数 |  | .clip 2/2 | 1 | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| CenterX | 実数 |  | .clip 2/2 | 3533〜1.052e+04（3 種） |  | 推測 | 定規の中心・回転・吸着・線の数・線対称 |
| CenterY | 実数 |  | .clip 2/2 | 1376〜3371（3 種） |  | 推測 | 定規の中心・回転・吸着・線の数・線対称 |
| LayerId | 整数 |  | .clip 2/2 | 30〜40（3 種） | ○ | 確認済み | 属するレイヤー（Layer.MainId）。0 はキャンバス全体のもの（用紙など） |
| LineNumber | 整数 |  | .clip 2/2 | 2 |  | 推測 | 定規の中心・回転・吸着・線の数・線対称 |
| LineSymmetry | 整数 |  | .clip 2/2 | 1 |  | 推測 | 定規の中心・回転・吸着・線の数・線対称 |
| NextIndex | 整数 |  | .clip 2/0 | 0 | ○ | 確認済み | 同じ並びの次の行の MainId（連結リスト、0 で終わり） |
| Rotate | 実数 |  | .clip 2/2 | 90 |  | 推測 | 定規の中心・回転・吸着・線の数・線対称 |
| Snap | 整数 |  | .clip 2/2 | 1 |  | 推測 | 定規の中心・回転・吸着・線の数・線対称 |

## RulerVanishPoint

パース定規の消失点。`ElemScheme.MaxIndex` は最大 5272。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 67/64 | 1〜42（28 種） | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 67/64 | 1〜4162（40+ 種） | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| CanvasId | 整数 |  | .clip 67/64 | 1 | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| Flag | 整数 |  | .clip 67/63 | 0〜17（3 種） | ○ | 推測 | 消失点の位置、平行の角度、設定、ガイドの線（数・大きさ・BLOB） |
| Guide | BLOB |  | .clip 67/64 | 長さ ≤ 32 |  | 推測 | 消失点の位置、平行の角度、設定、ガイドの線（数・大きさ・BLOB） |
| GuideDataSize | 整数 |  | .clip 67/64 | 16 |  | 推測 | 消失点の位置、平行の角度、設定、ガイドの線（数・大きさ・BLOB） |
| GuideNumber | 整数 |  | .clip 67/64 | 2 |  | 推測 | 消失点の位置、平行の角度、設定、ガイドの線（数・大きさ・BLOB） |
| LayerId | 整数 |  | .clip 67/64 | 8〜542（40+ 種） | ○ | 確認済み | 属するレイヤー（Layer.MainId）。0 はキャンバス全体のもの（用紙など） |
| NextIndex | 整数 |  | .clip 67/53 | 0〜1125（35 種） | ○ | 確認済み | 同じ並びの次の行の MainId（連結リスト、0 で終わり） |
| ParallelAngle | 実数 |  | .clip 67/12 | -90〜360（12 種） |  | 推測 | 消失点の位置、平行の角度、設定、ガイドの線（数・大きさ・BLOB） |
| VanishPointX | 実数 |  | .clip 67/64 | -3.626e+05〜5.932e+04（40+ 種） |  | 推測 | 消失点の位置、平行の角度、設定、ガイドの線（数・大きさ・BLOB） |
| VanishPointY | 実数 |  | .clip 67/64 | -1.157e+05〜4.882e+05（40+ 種） |  | 推測 | 消失点の位置、平行の角度、設定、ガイドの線（数・大きさ・BLOB） |

## Scenario

アニメーションのシナリオ。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| BankId | 整数 |  | — |  |  | 未解明 |  |
| NextScenario | 整数 | Scenario | — |  |  | 未解明 |  |
| NextTimeLine | 整数 | TimeLine | — |  | ○ | 未解明 |  |
| PhysicsLayerGroundHeight | 実数 |  | — |  |  | 未解明 |  |
| PhysicsLayerObjectSkirtBendSpring | 実数 |  | — |  |  | 未解明 |  |
| PhysicsLayerObjectSkirtGravity | 実数 |  | — |  |  | 未解明 |  |
| PhysicsLayerObjectSkirtSpryness | 実数 |  | — |  |  | 未解明 |  |
| PhysicsLayerObjectToeAutoPosition | 整数 |  | — |  |  | 未解明 |  |
| PhysicsLayerOnlySkirt | 整数 |  | — |  |  | 未解明 |  |
| PhysicsLayerSetting | 整数 |  | — |  |  | 未解明 |  |
| RenderingAlphaTestEnabl | 整数 |  | — |  |  | 未解明 |  |
| RenderingAlphaTestValue | 実数 |  | — |  |  | 未解明 |  |
| RenderingBackfaceCullingEnable | 整数 |  | — |  |  | 未解明 |  |
| RenderingCameraFrustumFar | 実数 |  | — |  |  | 未解明 |  |
| RenderingCameraFrustumNear | 実数 |  | — |  |  | 未解明 |  |
| RenderingCameraFrustumNearFarAutoSet | 整数 |  | — |  |  | 未解明 |  |
| RenderingDrawTexture | 整数 |  | — |  |  | 未解明 |  |
| RenderingLighting | 整数 |  | — |  |  | 未解明 |  |
| RenderingLightRecieved | 整数 |  | — |  |  | 未解明 |  |
| RenderingOutlineColorA | 整数 |  | — |  |  | 未解明 |  |
| RenderingOutlineColorB | 整数 |  | — |  |  | 未解明 |  |
| RenderingOutlineColorG | 整数 |  | — |  |  | 未解明 |  |
| RenderingOutlineColorR | 整数 |  | — |  |  | 未解明 |  |
| RenderingOutlineEnable | 整数 |  | — |  |  | 未解明 |  |
| RenderingOutlineWidth | 実数 |  | — |  |  | 未解明 |  |
| RenderingShadingKind | 整数 |  | — |  |  | 未解明 |  |
| RenderingShadowEnable | 整数 |  | — |  |  | 未解明 |  |
| RenderingTextureFilterKind | 整数 |  | — |  |  | 未解明 |  |
| ScenarioName | 文字列 |  | — |  |  | 未解明 |  |
| ScenarioUuid | BLOB |  | — |  |  | 推測 | UUID |
| Sentence | 文字列 |  | — |  |  | 未解明 |  |
| Situation | 整数 | SituationSet | — |  |  | 未解明 |  |

## SituationCast

アニメーションの登場物。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| Accessory | 文字列 |  | — |  |  | 未解明 |  |
| BankId | 整数 |  | — |  |  | 未解明 |  |
| Body | 文字列 |  | — |  |  | 未解明 |  |
| CanvasId | 整数 |  | — |  | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| Character | 文字列 |  | — |  |  | 未解明 |  |
| Face | 文字列 |  | — |  |  | 未解明 |  |
| Hair | 文字列 |  | — |  |  | 未解明 |  |
| ItemId | 整数 |  | — |  | ○ | 未解明 |  |
| NextIndex | 整数 |  | — |  | ○ | 確認済み | 同じ並びの次の行の MainId（連結リスト、0 で終わり） |
| SpeakParam | 整数 | SpeechSynthesis | — |  |  | 未解明 |  |

## SituationSet

アニメーションの場面。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| BankId | 整数 |  | — |  |  | 未解明 |  |
| CanvasId | 整数 |  | — |  | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| FirstCast | 整数 | SituationCast | — |  |  | 未解明 |  |
| ItemId | 整数 |  | — |  | ○ | 未解明 |  |
| Room | 文字列 |  | — |  |  | 未解明 |  |
| Situation | 文字列 |  | — |  |  | 未解明 |  |

## SmallObjectInfo

3D の小物。`ElemScheme.MaxIndex` は最大 10。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 5/5 | 1〜2（2 種） | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 5/5 | 1〜10（4 種） | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| CanvasId | 整数 |  | .clip 5/5 | 1 | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| CanvasItemSourceFileName | 文字列 |  | .clip 1/0 |  |  | 推測 | 素材の出どころ（ファイル名、素材の配布の ID・版・所有者） |
| CanvasItemSourceIsMadeByCanvasItemMaker | 整数 |  | .clip 1/0 | 0 |  | 推測 | 素材の出どころ（ファイル名、素材の配布の ID・版・所有者） |
| CanvasItemSourceMaterialAssetsContentId | 整数 |  | .clip 1/0 | 0 |  | 推測 | 素材の出どころ（ファイル名、素材の配布の ID・版・所有者） |
| CanvasItemSourceMaterialIsUploadable | 整数 |  | .clip 1/1 | 1 |  | 推測 | 素材の出どころ（ファイル名、素材の配布の ID・版・所有者） |
| CanvasItemSourceMaterialOwnerUserId | 整数 |  | .clip 1/0 | 0 |  | 推測 | 素材の出どころ（ファイル名、素材の配布の ID・版・所有者） |
| CanvasItemSourceMaterialRevision | 文字列 |  | .clip 1/0 |  |  | 推測 | 素材の出どころ（ファイル名、素材の配布の ID・版・所有者） |
| LayerId | 整数 |  | .clip 5/5 | 11〜85（4 種） | ○ | 確認済み | 属するレイヤー（Layer.MainId）。0 はキャンバス全体のもの（用紙など） |
| LayerObjectId | 整数 |  | .clip 5/5 | 2〜18（3 種） |  | 推測 | 属する 3D オブジェクト（LayerObject.MainId） |
| SmallObjectLastAppliedMovableFrame | 未登録 |  | .clip 1/1 | 長さ ≤ 12 |  | 推測 | 小物に最後に当てた可動の姿勢（BLOB） |
| SmallObjectTreeNodeGUIName | BLOB |  | .clip 1/1 | 長さ ≤ 12 |  | 推測 | パレットでの開閉と表示名 |
| SmallObjectTreeNodeGUIOpenClose | BLOB |  | .clip 5/5 | 長さ ≤ 46 |  | 推測 | パレットでの開閉と表示名 |
| SmallObjectUUID | 文字列 |  | .clip 5/5 | 長さ ≤ 36 |  | 推測 | UUID |

## SpecialRulerManager

特殊定規の一覧。`ElemScheme.MaxIndex` は最大 17。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 70/67 | 1〜6（6 種） | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 70/67 | 1〜13（11 種） | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| CanvasId | 整数 |  | .clip 70/67 | 1 | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| FirstConcentricCircle | 整数 | RulerConcentricCircle | .clip 70/0 | 0 |  | 推測 | 定規の種類ごとの連結リストの先頭 |
| FirstCurveEmit | 整数 | RulerCurveEmit | .clip 70/0 | 0 |  | 推測 | 定規の種類ごとの連結リストの先頭 |
| FirstCurveParallel | 整数 | RulerCurveParallel | .clip 70/0 |  |  | 推測 | 定規の種類ごとの連結リストの先頭 |
| FirstEmit | 整数 | RulerEmit | .clip 70/2 | 0〜2（3 種） |  | 推測 | 定規の種類ごとの連結リストの先頭 |
| FirstGuide | 整数 | RulerGuide | .clip 70/0 | 0 |  | 推測 | 定規の種類ごとの連結リストの先頭 |
| FirstMultiCurve | 整数 | RulerMultiCurve | .clip 70/0 |  |  | 推測 | 定規の種類ごとの連結リストの先頭 |
| FirstParallel | 整数 | RulerParallel | .clip 70/1 | 0〜2（3 種） |  | 推測 | 定規の種類ごとの連結リストの先頭 |
| FirstPerspective | 整数 | RulerPerspective | .clip 70/64 | 0〜1388（18 種） |  | 推測 | 定規の種類ごとの連結リストの先頭 |
| FirstSymmetry | 整数 | RulerSymmetry | .clip 70/2 | 2〜4（3 種） |  | 推測 | 定規の種類ごとの連結リストの先頭 |
| LayerId | 整数 |  | .clip 70/67 | 8〜542（40+ 種） | ○ | 確認済み | 属するレイヤー（Layer.MainId）。0 はキャンバス全体のもの（用紙など） |

## SpeechSynthesis

音声合成（読み上げ）の設定。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| BankId | 整数 |  | — |  |  | 未解明 |  |
| CanvasId | 整数 |  | — |  | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| ItemId | 整数 |  | — |  | ○ | 未解明 |  |
| LayerId | 整数 |  | — |  | ○ | 確認済み | 属するレイヤー（Layer.MainId）。0 はキャンバス全体のもの（用紙など） |
| SpeakParamAitIntonation | 実数 |  | — |  |  | 未解明 |  |
| SpeakParamAitPitch | 実数 |  | — |  |  | 未解明 |  |
| SpeakParamAitSpeed | 実数 |  | — |  |  | 未解明 |  |
| SpeakParamCcsEmotion | 文字列 |  | — |  |  | 未解明 |  |
| SpeakParamCcsIntonation | 整数 |  | — |  |  | 未解明 |  |
| SpeakParamCcsPitch | 整数 |  | — |  |  | 未解明 |  |
| SpeakParamCcsSpeed | 整数 |  | — |  |  | 未解明 |  |
| SpeakParamCharaName | 文字列 |  | — |  |  | 未解明 |  |
| SpeakParamLibName | 文字列 |  | — |  |  | 未解明 |  |
| SpeakParamMttIntonation | 整数 |  | — |  |  | 未解明 |  |
| SpeakParamMttPitch | 整数 |  | — |  |  | 未解明 |  |
| SpeakParamMttPriority | 整数 |  | — |  |  | 未解明 |  |
| SpeakParamMttSpeed | 整数 |  | — |  |  | 未解明 |  |
| SpeakParamOjt0 | 実数 |  | — |  |  | 未解明 |  |
| SpeakParamOjt1 | 実数 |  | — |  |  | 未解明 |  |
| SpeakParamOjt2 | 実数 |  | — |  |  | 未解明 |  |
| SpeakParamOjtIntonation | 実数 |  | — |  |  | 未解明 |  |
| SpeakParamOjtPitch | 実数 |  | — |  |  | 未解明 |  |
| SpeakParamOjtSpeed | 実数 |  | — |  |  | 未解明 |  |
| SpeakParamOjtType | 整数 |  | — |  |  | 未解明 |  |
| SpeakParamOjtVolume | 実数 |  | — |  |  | 未解明 |  |

## StreamLine

流線・集中線の設定。`ElemScheme.MaxIndex` は最大 26。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 115/113 | 1〜9（9 種） | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 115/113 | 1〜26（24 種） | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| BaseCurve | BLOB |  | .clip 115/113 | 長さ ≤ 1312 |  | 推測 | 基準の線（BLOB）とその種類、線の形（BLOB） |
| BasePointType | 整数 |  | .clip 115/69 | 0〜2（3 種） |  | 推測 | 基準の線（BLOB）とその種類、線の形（BLOB） |
| BrushSize | 実数 |  | .clip 115/113 | 0.8701〜381.2（40+ 種） |  | 推測 | 線のブラシの大きさとその乱れ、ブラシ（BrushStyle.MainId） |
| BrushSizeDisturb | 実数 |  | .clip 115/113 | 0.25〜0.75（3 種） |  | 推測 | 線のブラシの大きさとその乱れ、ブラシ（BrushStyle.MainId） |
| BrushStyleIndex | 整数 |  | .clip 115/113 | 4〜2196437（40+ 種） |  | 推測 | 線のブラシの大きさとその乱れ、ブラシ（BrushStyle.MainId） |
| CanvasId | 整数 |  | .clip 115/113 | 1 | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| FillOpacity | 実数 |  | .clip 115/113 | 0.26〜1（2 種） |  | 推測 | 塗りを使うかと不透明度 |
| GroupDisturb | 実数 |  | .clip 115/113 | 0.25〜1（4 種） |  | 推測 | まとまり（線の束）の数・間隔・乱れ |
| GroupGap | 整数 |  | .clip 115/113 | 2〜10（5 種） |  | 推測 | まとまり（線の束）の数・間隔・乱れ |
| GroupSize | 整数 |  | .clip 115/113 | 2〜40（8 種） |  | 推測 | まとまり（線の束）の数・間隔・乱れ |
| InLength | 実数 |  | .clip 115/113 | 4.247〜5.19e+04（40+ 種） |  | 推測 | 入り・抜きの長さと割合 |
| InOutType | 整数 |  | .clip 115/113 | 1 |  | 推測 | 入り・抜きの長さと割合 |
| InRatio | 実数 |  | .clip 115/113 | 0.2〜1（5 種） |  | 推測 | 入り・抜きの長さと割合 |
| IntervalAngle | 実数 |  | .clip 115/113 | 2〜12（8 種） |  | 推測 | 入り・抜きの長さと割合 |
| IntervalDistance | 実数 |  | .clip 115/113 | 5〜211.2（40+ 種） |  | 推測 | 入り・抜きの長さと割合 |
| IntervalDisturb | 実数 |  | .clip 115/113 | 0.1〜1（5 種） |  | 推測 | 入り・抜きの長さと割合 |
| JagLength | 実数 |  | .clip 115/113 | 20〜1.297e+05（40+ 種） |  | 推測 | ギザギザ（フラッシュ）の数と長さ |
| JagNumber | 整数 |  | .clip 115/113 | 20〜40（5 種） |  | 推測 | ギザギザ（フラッシュ）の数と長さ |
| Kind | 整数 |  | .clip 115/97 | 0〜1（2 種） |  | 推測 | 種類（流線 / 集中線）と乱数の種 |
| LayerId | 整数 |  | .clip 115/113 | 14〜1096（40+ 種） | ○ | 確認済み | 属するレイヤー（Layer.MainId）。0 はキャンバス全体のもの（用紙など） |
| LineLength | 実数 |  | .clip 115/113 | 29〜4.403e+04（40+ 種） |  | 推測 | 線の長さと始点の位置の乱れ |
| LineLengthDisturb | 実数 |  | .clip 115/113 | 0.1〜1（5 種） |  | 推測 | 線の長さと始点の位置の乱れ |
| MainBlue | 整数 |  | .clip 115/12 | 0〜4294967295（11 種） |  | 推測 | 線の色（メイン・サブ。32 ビットの値の上位 8 ビット） |
| MainGreen | 整数 |  | .clip 115/13 | 0〜4294967295（12 種） |  | 推測 | 線の色（メイン・サブ。32 ビットの値の上位 8 ビット） |
| MainRed | 整数 |  | .clip 115/13 | 0〜4294967295（7 種） |  | 推測 | 線の色（メイン・サブ。32 ビットの値の上位 8 ビット） |
| MaxLineNumber | 整数 |  | .clip 115/42 | 0〜300（3 種） |  | 推測 | 線の間隔（角度・距離）とその乱れ、線の最大数、角度のずれ |
| OffsetAngle | 実数 |  | .clip 115/54 | 0〜360（37 種） |  | 推測 | 線の間隔（角度・距離）とその乱れ、線の最大数、角度のずれ |
| OutLength | 実数 |  | .clip 115/113 | 4.247〜5.19e+04（40+ 種） |  | 推測 | 入り・抜きの長さと割合 |
| OutRatio | 実数 |  | .clip 115/113 | 0.1〜1（6 種） |  | 推測 | 入り・抜きの長さと割合 |
| RandomSeed | 整数 |  | .clip 115/113 | 2808437〜2608815036（40+ 種） |  | 推測 | 種類（流線 / 集中線）と乱数の種 |
| ShapeCurve | BLOB |  | .clip 115/113 | 長さ ≤ 84 |  | 推測 | 基準の線（BLOB）とその種類、線の形（BLOB） |
| StartGapDisturb | 実数 |  | .clip 115/113 | 8.409〜2000（40+ 種） |  | 推測 | 線の長さと始点の位置の乱れ |
| SubBlue | 整数 |  | .clip 115/103 | 0〜4294967295（4 種） |  | 推測 | 線の色（メイン・サブ。32 ビットの値の上位 8 ビット） |
| SubGreen | 整数 |  | .clip 115/103 | 0〜4294967295（4 種） |  | 推測 | 線の色（メイン・サブ。32 ビットの値の上位 8 ビット） |
| SubRed | 整数 |  | .clip 115/103 | 0〜4294967295（4 種） |  | 推測 | 線の色（メイン・サブ。32 ビットの値の上位 8 ビット） |
| UseBrushSizeDisturb | 整数 |  | .clip 115/32 | 0〜1（2 種） |  | 推測 | 線のブラシの大きさとその乱れ、ブラシ（BrushStyle.MainId） |
| UseFill | 整数 |  | .clip 115/22 | 0〜1（2 種） |  | 推測 | 塗りを使うかと不透明度 |
| UseGroup | 整数 |  | .clip 115/9 | 0〜1（2 種） |  | 推測 | まとまり（線の束）の数・間隔・乱れ |
| UseGroupDisturb | 整数 |  | .clip 115/113 | 1 |  | 推測 | まとまり（線の束）の数・間隔・乱れ |
| UseIn | 整数 |  | .clip 115/93 | 0〜1（2 種） |  | 推測 | 入り・抜きの長さと割合 |
| UseIntervalAngle | 整数 |  | .clip 115/6 | 0〜1（2 種） |  | 推測 | 線の間隔（角度・距離）とその乱れ、線の最大数、角度のずれ |
| UseIntervalDisturb | 整数 |  | .clip 115/100 | 0〜1（2 種） |  | 推測 | 線の間隔（角度・距離）とその乱れ、線の最大数、角度のずれ |
| UseJag | 整数 |  | .clip 115/69 | 0〜1（2 種） |  | 推測 | ギザギザ（フラッシュ）の数と長さ |
| UseLineLengthDisturb | 整数 |  | .clip 115/40 | 0〜1（2 種） |  | 推測 | 線の長さと始点の位置の乱れ |
| UseOut | 整数 |  | .clip 115/81 | 0〜1（2 種） |  | 推測 | 入り・抜きの長さと割合 |
| UseStartGapDisturb | 整数 |  | .clip 115/107 | 0〜1（2 種） |  | 推測 | 線の長さと始点の位置の乱れ |

## TimeLapseBlob

タイムラプスの記録のデータ（外部チャンク）。`ElemScheme.MaxIndex` は最大 44。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 22/22 | 1〜37（37 種） | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 22/22 | 1〜44（40+ 種） | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| BlobData | BLOB | 外部チャンク | .clip 22/22 | 長さ ≤ 40 | ○ | 推測 | タイムラプスの動画のデータ（外部チャンク）、位置、大きさ（展開後・圧縮後）、種類 |
| BlobOffset | 整数 |  | .clip 22/20 | 0〜1730150400（34 種） |  | 推測 | タイムラプスの動画のデータ（外部チャンク）、位置、大きさ（展開後・圧縮後）、種類 |
| BlobSize | 整数 |  | .clip 22/22 | 4060640〜52428800（23 種） |  | 推測 | タイムラプスの動画のデータ（外部チャンク）、位置、大きさ（展開後・圧縮後）、種類 |
| BlobSizeCompressed | 整数 |  | .clip 22/22 | 2033944〜51973641（40+ 種） |  | 推測 | タイムラプスの動画のデータ（外部チャンク）、位置、大きさ（展開後・圧縮後）、種類 |
| BlobType | 整数 |  | .clip 22/22 | 2 |  | 推測 | タイムラプスの動画のデータ（外部チャンク）、位置、大きさ（展開後・圧縮後）、種類 |
| CanvasId | 整数 |  | .clip 22/22 | 1 | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| NextIndex | 整数 |  | .clip 22/20 | 0〜44（40+ 種） | ○ | 確認済み | 同じ並びの次の行の MainId（連結リスト、0 で終わり） |

## TimeLapseManager

タイムラプスの記録。`ElemScheme.MaxIndex` は最大 4。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 22/22 | 1〜2（2 種） | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 22/22 | 1〜4（4 種） | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| CanvasId | 整数 |  | .clip 22/22 | 1 | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| RecordFirstIndex | 整数 | TimeLapseRecord | .clip 22/22 | 1〜4（4 種） |  | 推測 | 最初の記録（TimeLapseRecord） |

## TimeLapseRecord

タイムラプスの記録の 1 区切り。`ElemScheme.MaxIndex` は最大 4。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 22/22 | 1〜2（2 種） | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 22/22 | 1〜4（4 種） | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| BlobFirstIndex | 整数 | TimeLapseBlob | .clip 22/22 | 1〜23（6 種） |  | 推測 | 記録の最初のデータ（TimeLapseBlob）、符号化の名前と通し番号 |
| CanvasId | 整数 |  | .clip 22/22 | 1 | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| EncoderName | 文字列 |  | .clip 22/22 | 長さ ≤ 4 |  | 推測 | 記録の最初のデータ（TimeLapseBlob）、符号化の名前と通し番号 |
| EncoderSequence | 整数 |  | .clip 22/22 | 2934〜105672（22 種） |  | 推測 | 記録の最初のデータ（TimeLapseBlob）、符号化の名前と通し番号 |
| NextIndex | 整数 |  | .clip 22/0 | 0 | ○ | 確認済み | 同じ並びの次の行の MainId（連結リスト、0 で終わり） |

## TimeLine

アニメーションのタイムライン。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| BankId | 整数 |  | — |  |  | 推測 | AnimationCutBank.MainId |
| BiggestEndFrame | 実数 |  | — |  | ○ | 推測 | これまでの最大の終了フレーム（新しいトラックのクリップの長さ） |
| CurrentFrame | 実数 |  | — |  | ○ | 確認済み | 今のフレーム（0 始まり）。TrackValueMap はこのフレームの値 |
| CutIndexForName | 整数 |  | — |  | ○ | 確認済み | カット番号（名前の書式用） |
| EndFrame | 実数 |  | — |  | ○ | 確認済み | 再生範囲の終わり（最後のフレームの次、0 始まり = CSP の表示の最後のフレーム） |
| FirstTrack | 整数 | Track | — |  | ○ | 確認済み | 最初のトラック（Track.MainId、TrackNextIndex で続く） |
| FrameRate | 実数 |  | — |  | ○ | 確認済み | フレームレート。変えると各トラックの TimeClip が 旧/新 倍に伸び、キーはフレームに留まる |
| GuidelineFrameRate | 整数 |  | — |  | ○ | 確認済み | タイムラインの区切り線の間隔（フレーム） |
| LabelFirstIndex | 整数 | TimeLineLabel | — |  | ○ | 確認済み | 最初のタイムラインラベル（TimeLineLabel.MainId） |
| NextScenario | 整数 | Scenario | — |  |  | 推測 | シナリオ機能の連結（観察では 0） |
| NextTimeLine | 整数 | TimeLine | — |  | ○ | 確認済み | 次のタイムライン（0 で終わり） |
| SceneIndexForName | 整数 |  | — |  | ○ | 確認済み | シーン番号（名前の書式用） |
| SmallestStartFrame | 実数 |  | — |  |  | 推測 | これまでの最小の開始フレーム |
| StartFrame | 実数 |  | — |  | ○ | 確認済み | 再生範囲の最初のフレーム（0 始まり。CSP の表示は +1） |
| TimeLineName | 文字列 |  | — |  | ○ | 確認済み | タイムラインの名前 |
| TimeLineUuid | BLOB |  | — |  | ○ | 推測 | UUID |

## TimeLineLabel

タイムラインのラベル。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| BankId | 整数 |  | — |  |  | 推測 | AnimationCutBank.MainId |
| ItemId | 整数 |  | — |  | ○ | 確認済み | タイムライン（TimeLine.MainId） |
| LabelFrame | 実数 |  | — |  | ○ | 確認済み | フレーム（0 始まり） |
| LabelLength | 実数 |  | — |  | ○ | 確認済み | トラックのラベルの長さ（フレーム） |
| LabelName | 文字列 |  | — |  | ○ | 確認済み | ラベルの名前（中割り記号は空） |
| LabelNextIndex | 整数 |  | — |  | ○ | 確認済み | 次のラベル（0 で終わり） |
| LabelType | 整数 |  | — |  | ○ | 確認済み | 0 = タイムラインのラベル、1 = 中割り記号（○）、3 = トラックの名前付きラベル（長さあり） |
| TrackId | 整数 |  | — |  |  | 確認済み | トラック（Track.MainId）。タイムラインのラベルは 0 |

## Track

タイムラインのトラック（外部チャンクのアクション）。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| ActionMixerPlayType | 整数 |  | — |  |  | 未解明 |  |
| BankId | 整数 |  | — |  |  | 推測 | AnimationCutBank.MainId |
| ItemId | 整数 |  | — |  | ○ | 確認済み | タイムライン（TimeLine.MainId） |
| LayerUuidWithTrack | BLOB |  | — |  | ○ | 確認済み | 対象レイヤーの LayerUuid（16 バイト） |
| PoseCorrectionObject | BLOB |  | — |  |  | 未解明 |  |
| TrackActionMixer | BLOB | 外部チャンク | — |  | ○ | 確認済み | キーの "cmt " 文書（版 0100、単精度）の外部チャンク。08 章 |
| TrackActionMixer2 | BLOB | 外部チャンク | — |  | ○ | 確認済み | 同じ内容の "cmt " 文書（版 0110、倍精度）の外部チャンク |
| TrackActionMixer2Size | 整数 |  | — |  |  | 確認済み | TrackActionMixer2 の文書の大きさ（展開後のバイト数） |
| TrackActionMixerSize | 整数 |  | — |  |  | 確認済み | TrackActionMixer の文書の大きさ（展開後のバイト数） |
| TrackContentOpen | 整数 |  | — |  |  | 推測 | トラックの中身を開いているか |
| TrackKind | 整数 |  | — |  | ○ | 確認済み | 2000 セル（アニメーションフォルダー）、2001 レイヤーのキーフレーム、2003 用紙、2005 2D カメラ |
| TrackLabelFirstIndex | 整数 | TimeLineLabel | — |  | ○ | 確認済み | 最初のトラックのラベル（TimeLineLabel.MainId） |
| TrackLayerObjectUuid | BLOB |  | — |  |  | 推測 | UUID |
| TrackNextIndex | 整数 |  | — |  | ○ | 確認済み | 同じタイムラインの次のトラック（0 で終わり） |
| TrackOpen | 整数 |  | — |  |  | 推測 | タイムラインでトラックを開いているか |
| TrackOptionFlag | 整数 |  | — |  | ○ | 推測 | 256、アニメーションフォルダーは 768 |
| TrackUuid | BLOB |  | — |  |  | 推測 | UUID |
| TrackValueMap | BLOB |  | — |  | ○ | 確認済み | 今のフレームの値（名前・タグ・型・値、ビッグエンディアン）。08 章 |

## VOffscreen

使われない表。列名は Offscreen.Attribute の値の並びと同じ。コア領域。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| BlockDataChannelBytes | 整数 |  | — |  |  | 確認済み | 使われない列。名前は Offscreen.Attribute の Parameter / InitColor の値の並びと同じ（04 章） |
| BlockDataChannelImageCount | 整数 |  | — |  |  | 確認済み | 使われない列。名前は Offscreen.Attribute の Parameter / InitColor の値の並びと同じ（04 章） |
| BlockDataChannelOrder | 整数 |  | — |  |  | 確認済み | 使われない列。名前は Offscreen.Attribute の Parameter / InitColor の値の並びと同じ（04 章） |
| BlockDataHorizontalBlockShift | 整数 |  | — |  |  | 確認済み | 使われない列。名前は Offscreen.Attribute の Parameter / InitColor の値の並びと同じ（04 章） |
| BlockDataHorizontalBlockWide | 整数 |  | — |  |  | 確認済み | 使われない列。名前は Offscreen.Attribute の Parameter / InitColor の値の並びと同じ（04 章） |
| BlockDataOffsetAlphaPixelBytes | 整数 |  | — |  |  | 確認済み | 使われない列。名前は Offscreen.Attribute の Parameter / InitColor の値の並びと同じ（04 章） |
| BlockDataOffsetAlphaRowBytes | 整数 |  | — |  |  | 確認済み | 使われない列。名前は Offscreen.Attribute の Parameter / InitColor の値の並びと同じ（04 章） |
| BlockDataOffsetImageBlock | 整数 |  | — |  |  | 確認済み | 使われない列。名前は Offscreen.Attribute の Parameter / InitColor の値の並びと同じ（04 章） |
| BlockDataOffsetImageBlockBytes | 整数 |  | — |  |  | 確認済み | 使われない列。名前は Offscreen.Attribute の Parameter / InitColor の値の並びと同じ（04 章） |
| BlockDataOffsetImagePixelBytes | 整数 |  | — |  |  | 確認済み | 使われない列。名前は Offscreen.Attribute の Parameter / InitColor の値の並びと同じ（04 章） |
| BlockDataOffsetImageRowBytes | 整数 |  | — |  |  | 確認済み | 使われない列。名前は Offscreen.Attribute の Parameter / InitColor の値の並びと同じ（04 章） |
| BlockDataPixelBytes | 整数 |  | — |  |  | 確認済み | 使われない列。名前は Offscreen.Attribute の Parameter / InitColor の値の並びと同じ（04 章） |
| BlockDataVerticalBlockShift | 整数 |  | — |  |  | 確認済み | 使われない列。名前は Offscreen.Attribute の Parameter / InitColor の値の並びと同じ（04 章） |
| BlockDataVerticalBlockWide | 整数 |  | — |  |  | 確認済み | 使われない列。名前は Offscreen.Attribute の Parameter / InitColor の値の並びと同じ（04 章） |
| CanvasId | 整数 |  | — |  | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| InitColorDataAlphaValue | 整数 |  | — |  |  | 確認済み | 使われない列。名前は Offscreen.Attribute の Parameter / InitColor の値の並びと同じ（04 章） |
| InitColorDataDoInitialize | 整数 |  | — |  |  | 確認済み | 使われない列。名前は Offscreen.Attribute の Parameter / InitColor の値の並びと同じ（04 章） |
| InitColorDataImageValue00 | 整数 |  | — |  |  | 確認済み | 使われない列。名前は Offscreen.Attribute の Parameter / InitColor の値の並びと同じ（04 章） |
| InitColorDataImageValue01 | 整数 |  | — |  |  | 確認済み | 使われない列。名前は Offscreen.Attribute の Parameter / InitColor の値の並びと同じ（04 章） |
| InitColorDataImageValue02 | 整数 |  | — |  |  | 確認済み | 使われない列。名前は Offscreen.Attribute の Parameter / InitColor の値の並びと同じ（04 章） |
| InitColorDataImageValue03 | 整数 |  | — |  |  | 確認済み | 使われない列。名前は Offscreen.Attribute の Parameter / InitColor の値の並びと同じ（04 章） |
| InitColorDataImageValue04 | 整数 |  | — |  |  | 確認済み | 使われない列。名前は Offscreen.Attribute の Parameter / InitColor の値の並びと同じ（04 章） |
| InitColorDataImageValue05 | 整数 |  | — |  |  | 確認済み | 使われない列。名前は Offscreen.Attribute の Parameter / InitColor の値の並びと同じ（04 章） |
| InitColorDataImageValue06 | 整数 |  | — |  |  | 確認済み | 使われない列。名前は Offscreen.Attribute の Parameter / InitColor の値の並びと同じ（04 章） |
| InitColorDataImageValue07 | 整数 |  | — |  |  | 確認済み | 使われない列。名前は Offscreen.Attribute の Parameter / InitColor の値の並びと同じ（04 章） |
| InitColorDataImageValue08 | 整数 |  | — |  |  | 確認済み | 使われない列。名前は Offscreen.Attribute の Parameter / InitColor の値の並びと同じ（04 章） |
| InitColorDataImageValue09 | 整数 |  | — |  |  | 確認済み | 使われない列。名前は Offscreen.Attribute の Parameter / InitColor の値の並びと同じ（04 章） |
| InitColorDataImageValueCount | 整数 |  | — |  |  | 確認済み | 使われない列。名前は Offscreen.Attribute の Parameter / InitColor の値の並びと同じ（04 章） |
| LayerId | 整数 |  | — |  | ○ | 確認済み | 属するレイヤー（Layer.MainId）。0 はキャンバス全体のもの（用紙など） |
| VOffscreenBlockBinary | BLOB |  | — |  |  | 確認済み | 使われない列。名前は Offscreen.Attribute の Parameter / InitColor の値の並びと同じ（04 章） |
| VOffscreenBlockBinarySize | 整数 |  | — |  |  | 確認済み | 使われない列。名前は Offscreen.Attribute の Parameter / InitColor の値の並びと同じ（04 章） |
| VOffscreenHeight | 整数 |  | — |  |  | 確認済み | 使われない列。名前は Offscreen.Attribute の Parameter / InitColor の値の並びと同じ（04 章） |
| VOffscreenHorizontalBlockCount | 整数 |  | — |  |  | 確認済み | 使われない列。名前は Offscreen.Attribute の Parameter / InitColor の値の並びと同じ（04 章） |
| VOffscreenVerticalBlockCount | 整数 |  | — |  |  | 確認済み | 使われない列。名前は Offscreen.Attribute の Parameter / InitColor の値の並びと同じ（04 章） |
| VOffscreenWidth | 整数 |  | — |  |  | 確認済み | 使われない列。名前は Offscreen.Attribute の Parameter / InitColor の値の並びと同じ（04 章） |

## VectorObjectList

ベクターレイヤーの線・枠線・フキダシのデータ。`ElemScheme.MaxIndex` は最大 622。コア領域。

| 列 | 型 | リンク | ファイル | 値 | コード | 状態 | 意味 |
|---|---|---|---|---|---|---|---|
| _PW_ID | 未登録 |  | .clip 523/514 | 1〜331（40+ 種） | ○ | 確認済み | SQLite の行 ID（AUTOINCREMENT）。参照には使われない |
| MainId | 未登録 |  | .clip 523/514 | 1〜622（40+ 種） | ○ | 確認済み | 行の ID。ほかの表のリンク列はこの値を指す。ElemScheme.MaxIndex が次の値の上限を持つ（飛び番あり） |
| CanvasId | 整数 |  | .clip 523/514 | 1〜2（2 種） | ○ | 確認済み | 属するキャンバス（Canvas.MainId）。.clip ではふつう 1、まれに 2 |
| LayerId | 整数 |  | .clip 523/514 | 3〜1096（40+ 種） | ○ | 確認済み | 属するレイヤー（Layer.MainId）。0 はキャンバス全体のもの（用紙など） |
| VectorData | BLOB | 外部チャンク | .clip 523/514 | 長さ ≤ 40 | ○ | 確認済み | 線のデータの外部チャンクの ID。中身は 05 章 |
