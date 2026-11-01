# Nyamuru Data Model（NDM）v10.33 / Open Manga Name YAML（OMNY）簡易ガイド

**Nyamuru Data Model（NDM）** は、漫画ネームの構造、コマ割り、人物、フキダシ、素材参照を定義するデータモデルです。愛称は **Nyamuru🐱** です。

**Open Manga Name YAML（OMNY）** は、NDMをYAMLとして保存・交換するためのシリアライズ形式です。

**Open Manga Artwork YAML（OMAY）** は、UIで「スタイルOMNY」として扱う画像生成指示ファイルです。ストーリーOMNYを漫画として描くための全コマ共通の作画・演出ルール（`style_notes`）とレイアウト仕様（`layout_spec`）を持ち、`spec_name` / `spec_version` がOMNYの `schema_name` / `schema_version` と対応します。画像生成側のプロジェクト指示にスタイルOMNYを設定し、作品ごとにストーリーOMNYを渡します。

## 1. 全体構造

ルートは必ず `manga` です。作品情報、舞台、人物、素材、ページを一つの文書にまとめます。

```yaml
manga:
  schema_name: "Nyamuru Data Model"
  schema_version: 10.33
  meta: { ... }
  layout_spec: |
    # A4座標系の説明
  series_setting: { ... }
  setting: { ... }
  characters: [ ... ]
  materials: [ ... ]
  pages:
    - page: 1
      canvas: { w: 210, h: 297, unit: mm }
      panels: [ ... ]
      page_overlay: { ... } # 任意。複数コマをまたぐ前景
```

| フィールド | 決まり |
|---|---|
| `schema_name` | NDMの正式な識別名 `"Nyamuru Data Model"` 固定。絵文字は含めない |
| `schema_version` | 現在のNDMスキーマバージョンは `10.33` |
| `meta.document_type` | `"story"`（通常の漫画ネーム）/ `"series-catalog"`（シリーズ人物・資料台帳） |
| `meta.series` | 作品タイトル（シリーズ名、任意）。シリーズ共通素材を読み込む単位 |
| `meta.series_id` | 名称変更後も同じシリーズ台帳を追跡する安定ID（任意） |
| `meta.title` | サブタイトル（各エピソードの題名、任意） |
| `meta.episode_id` | タイトル・話数変更後も同じエピソードを追跡する安定ID（任意） |
| `meta.author` | 作者名（任意）。指定があれば各ページ下端中央のフッターに小さく描く。空なら描かない |
| `meta.page_count` | `pages` 配列の実数と一致させる |
| `meta.format` | 完成画像の出力形式。例: `"カラー漫画"` / `"モノクロ漫画"` / `"グレースケール漫画"` |
| `meta.reading_direction` | `"right-to-left"` 固定 |
| `meta.text_orientation` | `"vertical"` 固定 |
| `meta.font` | 作品全体の既定書体。例: `"アンチック体"` |
| `meta.bubble_line_width_mm` | 新しく作るフキダシ本体としっぽのデフォルト線幅。単位はmm |
| `meta.panel_frame_width_mm` | コマ枠線幅。単位はmm |
| `meta.panel_gutter_row_mm` | 上下に隣接するコマの間隔。単位はmm |
| `meta.panel_gutter_column_mm` | 左右に隣接するコマの間隔。単位はmm |
| `meta.style_notes` | エディター内部で保持する作画・演出ルール。ストーリーOMNYへの保存時は省略し、スタイルOMNYへ保存する |
| `layout_spec` | エディター内部で保持するレイアウト仕様。ストーリーOMNYへの保存時は省略し、スタイルOMNYへ保存する |
| `series_setting` | シリーズのジャンル・対象読者・成人指定・世界観。シリーズ台帳から各話へ読み込む |
| `setting` | 今回のエピソード固有の場所・時間帯・天候・あらすじ。`series_setting.situation` と混ぜない |

## 2. ページとコマ

- `page.paint_layer_sequence` はページ内で最後に割り当てた自由描画レイヤー番号（任意、0以上の整数）。ラスター・ベクターの新規名は「レイヤー N」で、コマ・描画先をまたいでページ内の連番を使う。名称変更や削除の欠番を埋めず、別ページでは1から始める。

- `canvas` は原則A4縦の **210 × 297mm**。
- `panels` は1ページ最大10コマ。
- 配列順と `id` は右上から左下への読み順にそろえる。
- `shape.type` は `rect` または `polygon`。
- `bg` は `-1` / `0` / `1` / `2` の必須値。`2` は1ページ2コマまで（`-1` はこのカウントに関係しない）。
- `bg: -1` は背景無描画（中間グレー1色のベタ塗りのみ・接地影なし）。依頼で指示されたコマにのみ使い、演出判断で自動選択しない。
- 描画レイヤーの `paintStack.below` は対象の `layerId` を `layer:<id>` で参照し、対象直下に配置する。`paintStack.beforePanel` は同形式のコマ `layerId` を参照し、コマ外のバー上へ配置する。並べ替えで所属を変えず、対象削除後は同じ描画範囲のルートへ残す。
- 描画レイヤーとユーザーフォルダーは、作成位置に依存せずページ・コマ・人物・テキストの描画先をまたいで移動する。レイヤーID・名称・紙面上の位置を保持し、移動先のフォルダーとクリップ範囲に従う。全レイヤーを移した人物・背景・テキストは `guideInitialized: true` の空の描画文書を保持し、あたりを再生成しない。
- 生成マスクは `generationMask: true` を持つ通常のラスター `PaintLayer` で、子を持たない。`strokes`・表示・濃度・固定・並べ替え・フォルダー所属・移動・保存は他の描画レイヤーと共通とし、マスクの目はそのレイヤーだけを切り替える。通常の画像書出には含めず、可視マスクの実alpha領域を生成範囲に使い、明示的な修正用参照へ含める。生成画像は対象フォルダーの最上段へ追加し、ネイティブ文字の表示・固定とは独立して移動できる。
- `background_description` は任意。人物を含めず、背景レイヤーだけに適用する場所・構図・パース・光・感情効果を記述する。`bg: -1` では使用しない。
- `bleed` はタチキリ（断ち切り）の辺の宣言（任意。`left` / `right` / `top` / `bottom` の配列）。宣言した辺は座標も紙端に一致させる（left=`x: 0`、right=`x + w = 210`、top=`y: 0`、bottom=`y + h = 297`）。rect コマ専用。top を宣言したコマはヘッダー帯より奥に描かれ、ヘッダーの文字はコマ絵の最前面に重なる。
- `no_figures: true` は意図的な無人コマの宣言（任意）。人物を一人も描かないコマに付け、`figures` と併用しない。
- `screen_text` はフキダシにしない画面・看板・紙面の文字の配列（任意）。各要素は `text`（必須）・`bbox`（任意）・`orientation`（`horizontal` 既定 / `vertical`）。
- `layer` はエディターのレイヤー状態（任意）。`hidden` はコマ内容、`frameHidden` は枠線の表示、`locked` は紙面上でのコマ枠の移動・変形を固定し、`artOrder` はコマ内作画の重ね順を保持する。固定しても内容や座標は削除しない。

- 文字グループの番号・読み順は `bubbles` の配列順。初期レイヤー一覧は番号の昇順とし、並べ替え後は `layer.artOrder` の `bubble:<layerId>` で奥から手前の順を保持する。ページ前景は `page.layer.artOrder` を使う。対応人物と `lettering_depth` が同じ文字グループ内で並べ替え、人物との前後関係を保つ。

### 複数コマをまたぐページ前景

特定のコマへ所属させられない人物・物・フキダシは、ページ直下の任意フィールド `page_overlay` に置きます。

```yaml
page_overlay:
  frame: false
  layer: above_panel_frames
  figures:
    - name: "キャラクター名"
      action: "両手を広げ、画面右を見る"
      bbox: { x: 45, y: 35, w: 120, h: 220 }
      size: full
  bubbles:
    - text: "複数コマにまたがるセリフ"
      speaker: "キャラクター名"
      shape: normal
      bbox: { x: 160, y: 20, w: 35, h: 60 }
```

- `frame` は `false`、`layer` は `above_panel_frames` 固定。
- `page_overlay` 自体をコマとして数えず、囲う枠線も描かない。
- コマ内作画とコマ内の文字をコマ形状でクリップし、その上にコマ枠を描く。ページ前景はコマ枠より手前へ一度だけ描き、各コマへ複製しない。自由描画は保存された追加位置で重ねる。コマ枠直下のレイヤーはコマ内の文字より手前、コマバーの上のレイヤーはコマ枠より手前かつページ前景より奥に置く。文字フォルダー内では `aboveNative` で文字の手前／奥を区別し、フォルダー指定を子レイヤーへ適用する。
- bbox はA4紙面の絶対座標。コマ内相対位置ではないため `anchor` は使わない。
- 通常のコマ内要素は `panels[].figures` / `panels[].bubbles` に置く。

### コマ形状

```yaml
# 四角コマ
shape: { type: rect, x: 10, y: 10, w: 190, h: 80 }

# 多角形・対角線カット
shape:
  type: polygon
  points: [[200, 95], [200, 170], [105, 170], [115, 95]]
```

## 3. A4絶対座標

- 原点は用紙左上の `(0, 0)`。
- xは右方向、yは下方向、単位はmm。
- `figures[].bbox` と `bubbles[].bbox` も、コマ内座標ではなく**用紙全体の絶対座標**。
- `page_overlay` 内のbboxも同じ用紙全体の絶対座標。コマに所属しないため `anchor` は付けない。
- `anchor` はコマ内の相対位置を表し、bboxより優先する。
- フキダシは、人物bbox上部1/3の顔ゾーンと交差させない。
- 構図の優先順は `panels[].action` ＞ `anchor` ＞ 発言順＝立ち位置 ＞ `size` ＞ `bbox`（OMAYの `layout_spec` にある優先順位表と同一内容の転記）。`figures[].action` は対象人物の表情・姿勢・視線・動作にだけ適用し、`background_description` は人物を含めない背景レイヤーだけに適用する。

## 4. 人物と人物配置

`characters` はコマで使う人物名だけでなく、シリーズ内の照合と生成に使う人物単位の設定も保持できます。

```yaml
characters:
  - name: "キャラクター名"
    role: "人物像や物語上の役割"
    gender: neutral
    visual_prompt: "画像生成で使う外見・描き方の指定"
    scope: series
    catalog_id: "character-..."
    aliases: ["ネーム上の略称"]
    default_proportion: { head_count: 4 }
    primary_material_catalog_id: "material-..."
    recognition:
      hair: { observed: ["短いボブ"], inferred: [] }
      face: { observed: [], inferred: [] }
      silhouette: { observed: ["裾が広がるワンピース"], inferred: [] }
      outfit: { observed: ["ハイネックの長袖とノースリーブワンピース"], inferred: [] }
      accessories: { observed: ["太いヘアバンド"], inferred: [] }
      ambiguous_design: { observed: [], inferred: ["側面では襟元の形が不明瞭"] }
```

- `scope` は `episode`（この話だけ）/ `series`（シリーズ共通）。省略時は `episode` として扱う。
- `catalog_id` はシリーズ人物の安定ID。表示名を変更しても維持する。
- `aliases` はネーム上の略称・呼び名など、同一人物を照合する候補。
- `role` は性格や物語上の人物像。人物の画像生成プロンプトには含めない。
- `gender` は人間が指定する任意の性別属性で、`female`（女性）/ `male`（男性）/ `neutral`（中性）。未指定は未設定のまま保持し、名前・外見から推測しない。英文の代名詞と動詞はこの値に従い、未設定では生成時だけ単数の they を使う。人物設定や外見指定を書き換えず、`figures` に性別を重複保存しない。
- `visual_prompt` は人間が指定した外見・描き方の原文。人物の画像生成では、作品の画風や対象の演技指示とともに英訳して使う。
- `default_proportion.head_count` は人物ごとの基準頭身（1以上、上限なし）。画像解析では決めず、人間が設定する。
- `recognition` は `observed`（画像で確認できた形）と `inferred`（推定・要確認）を分ける。表情・一時的なポーズ・画風は人物の固定特徴に入れない。
- `primary_material_catalog_id` は代表にする人物資料の `catalog_id`。

コマ内の描写範囲と演技は `figures` に置きます。

```yaml
figures:
  - name: "キャラクター名"
    action: "肩をすくめ、相手から視線を外す"
    bbox: { x: 30, y: 22, w: 55, h: 62 }
    anchor: left
    size: waist-up
```

- `name` は `characters[].name`（人物）または `materials[].key`（物）と一致させる。
- **`figures` は人物専用ではない**——小道具など物の配置も figures で座標管理できる。物は `object: true` を付け、`size` / `role` は付けずに `bbox` / `anchor` で置き場所を示す。顔ゾーンやセンター既定は人物（object の無い figure）にのみ適用される。
- `size` は `long` / `full` / `knee-up` / `waist-up` / `bust-up` / `shoulder-up` / `face` / `face-detail` / `hand` / `foot` / `part`。long=周囲を含むロング、full=全身、knee-up=膝上、waist-up=腰上、bust-up=胸上、shoulder-up=肩上、face=顔、face-detail=顔の一部の大アップ。hand/foot/part は体の一部だけを描く指定（顔ゾーンを持たない）。
- `role` は `main`（既定）/ `sub`。**役割の宣言であり、配置は規定しない**——`sub` は主対象でない脇役で、センター配置の既定の対象から外れる（配置は `bbox` / `anchor` の指定に従う）。人物の配置は**配置意図の優先順位**で決める：1. 演出意図の宣言（`anchor` / `bbox`）＞ 2. 役割・描写範囲の宣言（`role` / `size` / `no_figures`）＞ 3. 既定＝センター配置（`main` を中央に大きく）。
- `action` はその人物だけに適用する画像生成用の指示。表情・姿勢・視線・身体の向き・手足の動き・接触を記述し、背景・カメラ・画風は入れない。物（`object: true`）には付けない。
- コマ外の声だけなら `figures` へ入れず、そのフキダシに `offscreen: true` を付ける。

## 5. フキダシ

セリフは必ず `bubbles` 配列へ入れます。`text` は必須です。

`bubbles[].line_width_mm` は、そのフキダシ本体としっぽの個別線幅です（mm、0より大きい有限値）。省略時は `meta.bubble_line_width_mm` を使います。エディターでデフォルトを変えるときは、配置済みのフキダシに参照中の線幅を明記して見た目を保ちます。ペンの太さパレットでは選択中のフキダシだけを変更し、px指定を作品の解像度でmmへ換算します。

```yaml
bubbles:
  - text: "セリフ"
    speaker: "キャラクター名"
    shape: normal
    bbox: { x: 145, y: 20, w: 35, h: 35 }
    tail: { x: 0.5, y: 0.35 }
```

使用できる `shape` は次の15種類です。

| shape | 用途 |
|---|---|
| `normal` | 会話・独白の初期配置に使う標準オーバル。省略時の既定値 |
| `thought` | 雲形の演出。独白・想像・夢見などで明示選択 |
| `square` | ナレーションの初期配置に使う四角い枠。独白などの演出にも選択可 |
| `caption` | ナレーション・時間・場所説明 |
| `flash` | 叫び・強い驚き |
| `uniflash` | 最大級の絶叫・衝撃 |
| `wobbly` | 弱り声・恐怖・脱力 |
| `whisper` | ひそひそ声 |
| `handwritten` | 描き文字（効果音・手描き文字） |
| `typeset` | 輪郭を描かない写植文字。原字画像・描画レイヤーを同じ文字オブジェクトに保持 |
| `critical` / `tense` / `toge` / `announce` / `toge_natural` | 登録素材の作者分類。場面・発話・表情と見本を照合して選ぶ |

`shape: typeset` は本文と `text_position` による配置を持ち、輪郭・しっぽ・結合線を描かない。`analogTextImport` の原字参照と `paint_overlay` は同じ対象に保持する。Tツールで直接追加する文字は `screen_text` に入り、種類を切り替えた文字は同じ `bubbles` 要素上で `normal`・`handwritten`・`typeset` を使う。種類切り替えでは本文・書式・位置・原字画像を引き継ぐ。

描き文字の `lettering_pen` は `src/content/handwritten-styles.json` のペンIDを1つ指定する（任意）。`lettering_expressions` は同辞書の表現IDの配列（任意・重複なし）。文字ツールで描き文字を選択したとき、対応キャラクターの下でペンを単一選択、表現を複数選択する。未指定は生成指示を追加しない。選択した固定英訳を単品・修正・コマ・ページ生成へ渡し、全体生成では対象のコマ／前景と文字番号を保持する。

`shape: handwritten` はコマ情報の「描き文字」で編集・生成する。`text` は描く文字そのもの、`lettering_description` は形・線・勢い・質感などの描き方（任意の文字列）。単品生成は描き文字だけを対象とし、吹き出しの外形を生成しない。生成結果は同じ対象へ新規レイヤーとして加え、元の文字・あたり・レイヤーと表示状態を保持する。`lettering_guide_hidden: true` は編集可能な文字あたりだけを非表示にする（任意・省略時は表示）。描き文字の生成画像の表示とは独立する。 単品生成には本文・描き方・文字組み・文字専用ルール・出力範囲を渡す。人物名・性別・表情・人物との位置関係・重なり・人物向けの共通画風指示は含めない。

素材分類 `nomal` は `shape: normal` に対応する。素材ウィンドウからフキダシへ重ねると、選んだ輪郭の `bezier` を保存する。`shape`・本文・文字設定・`bbox`・話者・しっぽは保持する。上記5分類で `bezier` が省略される場合は、その分類の先頭素材を使う。

テキストプロットから新規配置するときは、セリフ・独白を `shape: normal` と標準楕円の `bezier`、ナレーションを `shape: square` と四角形の `bezier`・`tail: false` で保存する。独白は `monologue: true` も保持する。原稿の再対応付けでは編集済みの輪郭や尻尾を初期化しない。

- モノローグは `monologue: true` を付け、`text` から括弧「（）」を外す。
- コマ外の声は `offscreen: true` を付ける（話者はコマ外＝姿を描かず、尻尾も描かない。`speaker` は明記する）。
- `tail: { x, y }` は話者の人物 `bbox` を基準にした、しっぽ先端の相対位置（左上0・右下1、枠外は0未満・1超も可）。口元の方向を示す適切な短さにし、口まで届かせる必要はない。通常形状で省略した場合は人物中央、`tail: false` はしっぽなし。`square` / `caption` / `flash` / `uniflash` / `handwritten` / `typeset` は省略時にしっぽを描かない。
- `tail_root: { x, y }` はフキダシ `bbox` を基準にした根元方向（左上0・右下1、枠外の有限値も使用可能）。省略時は先端方向へ自動配置する。根元と先端はキャンバス上で別々に移動できる。
- 通常のしっぽは本体と別の白い面・左右輪郭として描き、接続口だけ本体輪郭をマスクする。本体の `bezier`、根元の `tail_root`、先端の `tail` は別々に保存し、どの編集でも本体パスへ完全結合しない。
- `shape: thought` でしっぽを描く場合は、フキダシから離れるほど小さくなる2〜3個の縦長楕円で表す。
- `speaker` は文字の対応キャラクター名。会話では話者を毎回明記する。描き文字では、意味・ニュアンスに関係するキャラクターを任意で指定でき、発話・しっぽ・発言順を意味しない。対応キャラクターがいない場合は省略する。
- `lettering_depth` は描き文字と対応キャラクターの重なり。`front` は手前、`behind` は後ろで、未指定は手前。同じコマまたは同じページ前景内で対応人物が一意に定まるとき、描き文字グループをその人物の直上／直下へ配置する。レイヤー一覧は同じ描画順を表示し、文字グループまたは対応人物を互いの上下へドラッグすると、この値も更新する。後ろでは人物が文字を隠す。関連する原字・描画レイヤーも同じ位置に置く。本文・座標・読み順を変更せず、人物が未配置・複数で曖昧なときは指定を保持して現在の前面表示を保つ。対応キャラクターを解除すると重なり指定も解除する。
- `join_to` は同じ `bubbles` 配列内で結合する、先行フキダシの1始まり番号。話者とは別の設定で、三つ以上を一つへ結合するときは同じ番号を指定する。
- `text_style` は任意の文字設定。`font` は書体名、`fontSize` は4〜144のポイント数、`fontWeight` は1〜1000の整数、`lineHeight` は文字サイズに対する行送りの倍率（0.5〜3、省略時は表示の既定値）、`orientation` は `vertical` / `horizontal`、`italic`・`underline`・`strikethrough` は斜体・下線・取り消し線の真偽値。`fontWeight` はフォントのウェイト値を使い、100刻みに丸めない。`fontSize` の明示指定は文字量や素材の輪郭によって自動縮小しない。フキダシと `screen_text` に保存できる。
- `text_runs` は部分的な文字スタイルの配列。各要素は `{ start, end, fontWeight?, italic?, underline?, strikethrough? }`。`fontWeight` は太さ、`italic`・`underline`・`strikethrough` は斜体・下線・取り消し線の真偽値で、1つ以上を指定する。`false` はその範囲だけ解除する明示値。`start` は本文の先頭からのUTF-16位置、`end` は終端を含まない位置で、改行は1として数える。サロゲートペアを分割せず、範囲の重複は認めない。範囲で省略した項目は `text_style` または表示既定値を使う。本文・文字設定は原稿上で直接編集し、OMNYへ保存する。
- `text_style.textAlign` は文字群全体の行揃えで、`left`・`center`・`right` を指定する。省略時は `left`。最長の行に対して各行を先頭・中央・末尾へ揃え、横書きでは左・中央・右、縦書きでは上・中央・下に対応する。部分文字の `text_runs` には指定しない。文字群の位置と囲むフキダシの輪郭は変えない。
- `text_position: { x, y }` はフキダシ本文の中心を、フキダシ `bbox` の左上0・右下1を基準とする有限の相対座標で表す。0未満・1超の値も使え、ベジェ輪郭を広げても基準は同じ `bbox` のまま。省略時は `{ x: 0.5, y: 0.5 }`。本文は文字自体のクリックで編集し、選択時の青い文字枠をドラッグすると輪郭とは独立して移動できる。
- `emphasis` に複数の強調フレーズを指定するときは、半角カンマで区切る。
- `bezier: { nodes: [...] }` は編集可能な閉じた3次ベジェ輪郭。各点は `{ x, y, handleIn?: { x, y }, handleOut?: { x, y } }` とし、3〜128点を輪郭順に並べる。点はフキダシの `bbox` を0〜100で表した参照座標、ハンドルはその点からの相対ベクトル。点とハンドル先端には枠外の有限値も使える。輪郭編集で参照枠・原画・本文位置を自動変更しない。最後の点から最初の点へも曲線で閉じる。有効な `bezier` がある場合はその輪郭を描き、`shape` は文字余白・線種・しっぽの既定値に使う。本文・話者・位置は通常のフィールドで保持する。
- コマ所属フキダシは、輪郭・描き足し・しっぽ・本文を所有コマの形状で常に切り取る。フキダシ本体はコマ外へ移動できるが、見えるのはコマ内だけで、本文を可視部分の中央へ自動移動しない。必要なら `text_position` で本文だけを見える位置へ移す。ページ前景のフキダシはコマで切り取らない。
- `clip_to_panel` は旧保存データの読込互換のため真偽値を受け付けるが、現在の表示判断には使わない。新規データでは省略する。
- `caption` や `handwritten` にも対応キャラクターを指定できる。特定の人物に属さないナレーション・効果音などは `speaker` を省略する。

## 6. 素材参照

`materials` へ人物・背景・小道具を登録し、各コマの `assets` から `key` を参照します。

```yaml
materials:
  - key: "キャラクター素材"
    type: character
    scope: series
    catalog_id: "material-..."
    character_catalog_id: "character-..."
    view: turnaround
    origin: { episode_id: "e2f4...", episode_title: "第1話タイトル", episode_number: "第1話" }
    keywords: ["キャラクター名", "立ち絵"]
    note: "見た目の要点"

pages:
  - panels:
      - id: 1
        assets: ["キャラクター素材"]
```

`type` は `character` / `background` / `prop`、`scope` は `episode`（エピソード限定）/ `series`（シリーズ共通）のいずれかです。`keywords` は素材ファイルを検索するための文字列配列です。シリーズ共通素材の `catalog_id` は名称を変更しても同じ素材を追跡する内部IDです。人物資料の `character_catalog_id` は対応するシリーズ人物を示し、`view` は `turnaround` / `front` / `three-quarter` / `side` / `back` / `expression` / `costume` / `other` のいずれかです。`origin` は最初に登録したエピソードの内部ID・作品タイトル・話数を保持します。

シリーズ台帳OMNYは `meta.document_type: "series-catalog"`、`meta.page_count: 0`、`pages: []` とし、シリーズの作品分類・世界観・人物・素材を保存します。`series_setting` はジャンル・対象読者・成人指定・世界観、`setting` はそのエピソードの舞台・状況です。シリーズ資料に旧来の場所・時間帯・天候が明記されていれば、新規作成時に空のエピソード欄へ初期値として読み込みますが、固定値にはせず各話で編集できます。`meta.format` は完成画像の出力形式として独立しています。人物資料画像のローカル参照はシリーズ台帳にだけ次の形で保持し、通常のストーリーOMNYには出力しません。

```yaml
source_image:
  schema_version: 1
  asset_id: "image-<sha256>"
  file_name: "characters/character-.../image-<sha256>.png"
  original_name: "キャラクター設定.jpeg"
  media_type: "image/png"
  byte_size: 123456
  width_px: 1946
  height_px: 1807
  sha256: "64桁の16進SHA-256"
```

`file_name` はシリーズ保存先からの相対パス、`original_name` は画面に表示する選択元のファイル名です。絶対パス、`..`、バックスラッシュは使用しません。画像の選択だけでは解析を行わず、明示したローカル解析操作で同じ人物の登録画像群を比較し、複数画像で一致する特徴と一方向でだけ確認できる恒常特徴を候補にします。画像ごとの `view` も画像群の比較から判定し、後から手動で修正できます。

設定画は登録前に選択画像の幅と高さを検査します。いずれかが上限を超えた画像は登録せず、利用者が元画像を縮小して選び直します。上限と等しい寸法は許容します。ニャムルは元ファイルを自動で縮小・上書きしません。`width_px` と `height_px` は登録PNGの実際の画素寸法で、画面での表示寸法ではありません。

## 7. コマ全体の例

```yaml
- id: 1
  shape: { type: rect, x: 10, y: 10, w: 190, h: 80 }
  bg: 1
  figures:
    - name: "キャラクター名"
      bbox: { x: 30, y: 22, w: 55, h: 62 }
      anchor: left
      size: waist-up
  assets: ["キャラクター素材"]
  bubbles:
    - text: "セリフ"
      speaker: "キャラクター名"
      shape: normal
      bbox: { x: 145, y: 20, w: 35, h: 35 }
      anchor: top-right
  action: "笑顔で振り向く"
```

## 8. コメント付き・2ページ分の空テンプレート

下記は、2ページ分の空のOMNYテンプレートです。作品情報やコマを追加して利用できます。`#` で始まる行は説明コメントなので、残したままでもOMNYとして読み込めます。

```yaml
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 sa-san10
# Nyamuru Data Model (NDM) v10.33 serialized as Open Manga Name YAML (OMNY)
# Nickname: Nyamuru🐱

# OMNY文書のルート。作品全体の情報をこの中にまとめる
manga:
  # NDMの正式な識別名。絵文字を含めず、この値から変更しない
  schema_name: "Nyamuru Data Model"

  # 使用するNDMスキーマのバージョン
  schema_version: 10.33

  # 作品全体の基本情報
  meta:
    # 文書種別。通常の漫画ネームはstory
    document_type: "story"
    # サブタイトル（各エピソードの題名、任意）
    title: "サブタイトル"
    # 作品タイトル（シリーズ名）と、名称変更後も同じシリーズを追跡する内部ID（任意）
    series: "作品タイトル"
    series_id: ""
    # 話数表記と、タイトル・話数変更後も同じエピソードを追跡する内部ID（任意）
    episode_number: ""
    episode_id: ""
    # 作者名（任意）。各ページ下端中央のフッターに描かれる。空なら非表示
    author: ""
    # 出力する漫画の形式
    format: "カラー漫画"
    # pagesの実数と一致させる。このテンプレートは2ページ
    page_count: 2
    # 右綴じ漫画の読み方向。固定値
    reading_direction: "right-to-left"
    # セリフの組み方向。固定値
    text_orientation: "vertical"
    # 漫画本文の作品共通書体
    font: "アンチック体"
    # フキダシ線幅、コマ枠線、上下・左右に隣接するコマの間隔（mm）
    bubble_line_width_mm: 0.5
    panel_frame_width_mm: 1
    panel_gutter_row_mm: 5
    panel_gutter_column_mm: 3
    # エディター内部で保持するスタイルOMNYの作画・演出ルール
    style_notes: []

  # エディター内部で保持するスタイルOMNYのレイアウト規則
  # 複数行にする場合は空文字を | に替え、次の行から字下げして記述する
  layout_spec: ""

  # シリーズの作品分類と世界観
  series_setting:
    genre: ""             # 例: SF・ファンタジー
    target_audience: ""   # 例: 少年・少女
    adult_content: false  # 成人指定なら true
    situation: ""

  # このエピソードの舞台・状況
  setting:
    # 主な場所
    location: ""
    # 時刻や時間帯
    time: ""
    # 天候
    weather: ""
    # この作品で起きることの概要
    situation: ""

  # 登場人物。scopeはepisode/series。シリーズ人物はcatalog_id、aliases、基準頭身、照合特徴を保持できる
  characters: []

  # 参照素材。各要素はkey、type、scope、keywords、任意のnoteを持つ
  # typeはcharacter / background / propのいずれか
  # scopeはepisode（エピソード限定）/ series（シリーズ共通）のいずれか
  # series素材は任意のcatalog_idとoriginで、同一素材と登録元エピソードを追跡できる
  # 人物資料はcharacter_catalog_idでシリーズ人物へ結び、画像参照はシリーズ台帳だけに保存する
  materials: []

  # 漫画ページの配列。並び順とpage番号を一致させる
  pages:
    # 1ページ目
    - page: 1
      # 用紙サイズ。A4縦の幅・高さ・単位
      canvas: { w: 210, h: 297, unit: mm }
      # コマを右上から左下への読み順で追加する。1ページ最大10コマ
      # 各コマにはid、shape、bg、bubbles、actionなどを設定する
      panels: []

    # 2ページ目
    - page: 2
      # 全ページで同じA4絶対座標系を使う
      canvas: { w: 210, h: 297, unit: mm }
      # まだコマも内容も配置されていない空ページ
      panels: []
```
