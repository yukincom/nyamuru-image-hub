# 07 作品（.cmc）

`.cmc` は複数ページの作品。中身は素の SQLite のデータベースで（CSFCHUNK に包まれていない）、各ページの `.clip` が同じフォルダーにある。
実装: 読み書きは `crates/csp-format/src/cmc.rs`、新規作成は `work.rs`（`cspf new-work`）。
確度: 確認済み（V1: 42 件でページの並びと参照がすべて閉じる。V8: CSP EX で作った作品・CSP で操作した作品との比較と、ライブラリで作った作品を CSP EX で開いた確認）。

## 表

| 表 | 行 | 内容 |
|---|---|---|
| `Project` | 1 | 作品の設定 |
| `CanvasNode` | ルート 1 + ページの数 | ページの並び |
| `ParamScheme`、`ElemScheme` | | CSP の列の登録（`.clip` と同じ形、02 章）。`ElemScheme` の `CanvasNode` の `MaxIndex` は `MainId` の最大値 |
| `sqlite_sequence` | | SQLite の AUTOINCREMENT の控え |

`CanvasNode` には `MainId` の索引 `idxCanvasNode` がある。列は作品の設定によって増える（表紙を付けると `Project.DefaultCover*`、
作品の基本設定を変えると `CanvasNode.Link*`）。全列は [スキーマ目録](schema-catalog.md) の `Project`・`CanvasNode`。

## `Project`（作品の設定）

| 列 | 意味 | 確度 |
|---|---|---|
| `ProjectInternalVersion` | 内部の版（`1.1.0`） | 確認済み |
| `ProjectRootCanvasNode` | ページの並びのルート（`CanvasNode.MainId`、CSP は 1） | 確認済み |
| `MaxCanvasFileIndex` | ページのファイル名に使った最大の番号。新しいページのファイルは `page(番号 + 1).clip`。ページを消しても戻らない | 確認済み |
| `ComicBindPosition` | 綴じる位置。**1 右綴じ、0 左綴じ** | 確認済み（V8） |
| `ComicStartPage` | 開始ページ。**0 左から、1 右から** | 確認済み（V8） |
| `ComicCoverExist` | 表紙がある（1） | 確認済み（V8） |
| `ComicBindAndStartPageIndeterminate` | 綴じと開始ページが決まっていない（縦スクロールの作品で 1） | 確認済み（V8） |
| `ComicShowStyle` | 作品の種類。0 本（見開き）、1 縦スクロール（Webtoon。製本リストが使えない） | 確認済み（V8） |
| `ComicWebtoonWrapDirection` | 縦スクロールの折り返しの向き（推測）。CSP が作った作品はどちらの種類でも 1 | 推測 |
| `ComicStory*` | 作品名・話数・サブタイトル・作者名・ページ番号・ノンブルの設定。各ページの `Canvas` の同じ列はこの写し | 確認済み |
| `DefaultPage*` | 新しいページの既定。単位（2 = mm）、大きさ（仕上がり + 裁ち落とし幅 × 2）、解像度、表現色（`ColorType` 0 カラー・2 モノクロ、`ChannelOrder` 33 カラー・17 モノクロ）、用紙、テンプレート、見開き（`DoublePage`、対向ページを見開きにする）、トンボ（`DefaultPageCrop*`、`UseCropFrame`）、`SettingType`（`Comic`、縦スクロールは `Webtoon`）。縦スクロールの作品は単位 0（px）・トンボなし（`UseCropFrame` 0） | 確認済み（大きさ・単位・解像度・表現色・見開き・トンボ・`SettingType`）、ほかは推測 |
| `DefaultCover*`、`DefaultPageUseDefaultCoverInfo` | 表紙の既定（解像度・表現色・用紙・カラープロファイル）。表紙ありの作品にだけ列がある | 確認済み（列の有無と解像度・表現色） |

## `CanvasNode`（ページの並び）

```text
ルート（Type 0）: FirstChildIndex → 最初のページ、SelectedIndex → 選んでいるページ
ページ（Type 2）: NextIndex → 次のページ（0 で終わり）
                  LinkPath ".:pageNNNN.clip"（":" が区切り、"." は .cmc のフォルダー）
                  PageFlag 1 = 見開きのページ（1 つのファイルが 2 ページ分）
```

- ページの順は連結リストの順で、`MainId` やファイル名の番号とは関係ない。ページを並べ替えると `NextIndex` だけが変わり、ファイルは名前を保つ
- CSP がページを足すと、`MainId` は最大値 + 1、ファイルは `MaxCanvasFileIndex + 1` の番号になる（V8）。
  2 つのページを見開きに変えると、1 つ目のファイルを消して 2 つ目のファイルを見開きの大きさに作り直す
- `BookBindWarning` は製本リスト（ページ管理 → 製本処理 → 製本リスト表示）の「確認」の印。CSP が計算して書く（作品を作るとき、ページを開いたとき、作品の基本設定を変えたとき。
  「ページの追加」で足したページは 0 で書かれる）。ライブラリは 0 で書いてよい（CSP がページを開くと計算し直す、V8 4 章）。
  ビットと表示の対応（V8、CSP の製本リストで確認）:

  | ビット | 製本リストの表示 |
  |---|---|
  | 2 | 裁ち落とし幅が基本設定の幅と異なる |
  | 8 | 解像度の設定が同人誌印刷所で受け付けられない（出力時に拡大・縮小される） |
  | 16 | ノンブルが仕上がりの外側にある |
  | 32 | テキストが仕上がりの外側か仕上がりの近くにある |
  | 256、512 | 見開きの 2 ページ目の 16、32 |
  | 1048576 | 本文ページがカラーで出力される設定になっている |
  | 8192 | 未解明。CSP が作った縦スクロールの作品では作成時から全ページに付く（トンボがないことと推測） |
  | 16384 | 未解明（表紙の見開き 1 ページだけにある） |

- `BookBindWarningDef` はルート 0、ページ 1（推測: 確認の既定を使う）。`Memo`・`BookBindMemo` はどの作品でも空
- `LinkWidth`・`LinkHeight`・`LinkUnit`・`LinkResolution`・`LinkIsFolder`・`LinkWrite*`（年月日時分秒、PC の時刻）は、ページのファイルの大きさと保存日時の控え。
  新しく作った作品にはこの列がなく、CSP が作品を保存するときに列を足す（V8）。作品の基本設定を変えたときは全ページに大きさと保存日時が入るが、
  ページを 1 つ開いて保存しただけのときは、ほかの行に 0 や意味のない大きな値（初期化されていない値とみられる）が入る。
  コーパスの崩れた値もこれと考えられる。読み手は `Link*` を使わず、ページのファイルそのものを見る

## ページの位置と左右

位置は連結リストの順にページを数えた番号（0 から、見開きは 2 つ進める）。CSP EX で作った作品（V8）とコーパスで次のとおり:

```text
左のページ: 位置が偶数（開始ページが「右から」なら奇数）
見開き:     右綴じでは右のページから、左綴じでは左のページから始まる 2 ページ
```

例（4 ページ、対向ページを見開き）: 右綴じ・左から = 単ページ（左）、見開き（2・3）、単ページ（右）。左綴じ・左から = 見開き 2 つ。右綴じ・右から = 見開き 2 つ。
`CmcFile::positions` は `.cmc` から各ページの位置と左右を返し、`work::NewWork::layout` は新しい作品のページの割り当てを返す。

表紙のある作品は、表 1・表 2・本文…・表 3・表 4 の順に並ぶ（表 1 と表 4 は見開きの 1 ページにもできる）。本文の位置は表 1・表 2 から続けて数える。
表 3・表 4 のページの `ComicPageIndex` はこの数え方と合わない（表紙の中での番号とみられる、推測）。

## ページの `.clip` との関係

各ページの `Canvas` は、作品の設定の写しと、作品の中の位置を持つ:

| 列 | 内容 |
|---|---|
| `ComicBindPosition`、`ComicStory*` | `Project` の写し |
| `ComicPageIndex`、`ComicIsLeftPage` | 位置と左右（上の数え方） |
| `CropFrameOptionFlag` | ビット。1 見開き、2 左のページ、4 右のページ、16 トンボを合わせる。新規作成の見開きは 3、見開きに変更したものは 17 |
| `CanvasDoublePage` | 見開き（幅は単ページの 2 倍、トンボの `CropFrameWidth` は 1 ページ分のまま） |
| `ComicHasComicCover`、`ComicHasDoubleCover` | 作品に表紙がある、表紙が見開き。表紙ありの作品では本文のページも 1 |
| `CropFrame*` | 仕上がり・基本枠・裁ち落とし幅（`CropFrameUnitKind` の単位） |
| `Comic(Story|Nombre)(Right)?LayerCreated` | 作品情報・ノンブルのレイヤー（LayerType 800、03 章）を作った（Right は見開きの右） |

**これらはページのファイルの控えで、正は `.cmc`。** CSP は、

- 作品の基本設定（綴じ・開始ページ・ページ数）を変えても、既存のページのファイルを書き換えない（V8）
- 作品を開くときは `.cmc` だけでページを並べ、左右も `.cmc` から決める。ページのファイルが古くても尋ねない
- ページを開いたときに、そのページの `ComicBindPosition`・`ComicIsLeftPage`・`CropFrameOptionFlag`（と必要なら `ComicPageIndex`）を
  作品の設定に合わせて直し、「変更されています」と保存を尋ねる（V8、V6 8 章）。控えが正しければ何も変えない
- 作品情報・ノンブルのレイヤーは、ページを開いても作らない。作品の基本設定で「ページごとに変更された設定をリセットする」を選んで OK すると、
  全ページの控えを作品の設定に合わせて書き直し、作品情報のレイヤーを作る（`Comic*LayerCreated` が 1 になる、V8 4 章）

そのため、ページのファイルを開かずに使う読み手（ノンブルを読む道具など）は、位置と左右を `.cmc` の連結リストから数える（`CmcFile::positions`）。
コーパスの表紙のない作品では 278 ページすべてでページのファイルの左右がこの数え方と一致し、外れた 11 ページは表紙のある作品で表紙の印も古いままのページだった。

- ページの一覧の表示には、各ページの `CanvasPreview` が使われる（白紙のままだと一覧が白紙に見える）。
  `CanvasNode.CanvasThumbnail` は 42 件のどのページにも入っていない。`cmc.rs` の `page_thumbnail` はページのファイルのプレビューを返す（42 件・437 ページすべてで取得できた）

## 新しい作品を作る（`work.rs`）

`NewWork`（仕上がりの大きさ・裁ち落とし幅・解像度・ページ数・見開き・綴じ・開始ページ・作品名・作者名）から、`.cmc` とページのファイルを作る。

- `.cmc` の表と列の登録は、CSP EX が作った作品からの写し（`data/cmc_schema.sql`、`data/cmc_param_scheme.tsv`、`data/cmc_elem_scheme.tsv`。構造だけで値は含まない）
- `Project` の行は上の意味のとおりに書く（表現色はカラー、作品情報の書式は CSP の既定）。`BookBindWarning` は 0 で書き、CSP が計算する
- ページは `ClipFile::create`（R13）で作り、単位を mm にして、トンボの列（`CropFrame*`、`SafeFrameShow`）を足し、位置・左右・作品情報を書く。
  ページの画素の大きさは mm × dpi ÷ 25.4 を四捨五入（CSP と同じ）
- 作品情報とノンブルのレイヤー（LayerType 800 のテキスト）は作らない。作品名などは `.cmc` と各ページの `ComicStory*` に入るので、
  CSP で作品の基本設定の「ページごとに変更された設定をリセットする」を使うと、CSP が全ページにレイヤーを作る（V8 4 章）
- 作品の基本設定の画面の解像度は 350・600 dpi の一覧から選ぶ形で、ほかの値（300 dpi など）の作品では欄が空になる（値は保たれる）
- 表紙のある作品は作れない（表紙のページと `DefaultCover*` の列が要る）

```sh
cspf new-work OUT_DIR NAME --trim 182x257 --bleed 5 --dpi 600 --pages 8 --spreads --bind right --start left --title 作品名
```

CSP で開いての確認は V8。
