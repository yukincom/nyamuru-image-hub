# 同人誌印刷24社の原稿条件と、にゃムルの設定計画

調査日: 2026-09-25。対象は利用者のCLIP STUDIO PAINT印刷所一覧に表示された24社。公式の公開案内を調査した資料であり、全商品への対応保証・実入稿試験・アプリ実装の完了を意味しない。

## 読み方

- 数字は原則として塗り足しは片側mm、解像度は原寸のdpi。印刷所がdpiと呼ぶ画像解像度をその表記に合わせる。トーンの線数lpiとは異なる。
- 「推奨」「指定」「受付可能」を区別する。推奨600dpiから1200dpi禁止とは推論しない。本文/表紙、オフセット/オンデマンド、商品固有の条件を優先する。
- 「未確認」は今回参照できた公式資料から確定できなかった項目。受付不可・規定なしという意味ではない。旧案内と現行案内の不一致は残す。
- 会社名だけで厳密な入稿判定を行わない。商品・製本・入稿経路・確認日の組み合わせが必要。画像形式の受付とPDFの受付、PDF/X必須と単なるPDF対応を区別する。
- 一覧中の「汎用設定（印刷所を後で指定する）」は印刷所ではないため、24社に数えない。

## 先に決まった設計方針

3mm/5mmはよく使う候補だが、サングループのテンプレートは4mm。ページ数も全社一律4の倍数ではない。無線綴じで2ページ単位の商品と、中綴じで4ページ単位の商品を別に扱う。詳細根拠は下の会社別記録を参照。

### CLIP STUDIO PAINTと利用者画面の確認

[CSP公式新規キャンバスマニュアル](https://help.clip-studio.com/ja-jp/manual_jp/210_files/新規キャンバスを作成する.htm)では、コミック系の解像度候補はモノクロ600/1200dpi、グレーとカラーは350/600dpi。カラー350だけに制限しない。印刷所の推奨値は別途適用する。ページ数は表紙を有効にした場合に表紙を含む。入稿先未定時の本文4ページ単位は目安であり、全商品の製本条件ではない。

基本線数60線には[公式サポートの明示的な根拠](https://www.clip-studio.com/clip_site/support/help/detail/svc/53/tid/74832)がある（2014-09-14の回答）。今回の利用者画面の60.0とも一致する。現行環境を初期化して既定値を実測したわけではないが、にゃムルの初期値を60lpi、変更可能とする根拠として採用できる。既に網点化された素材を、この設定で再変換しない。

### 単位・サイズの入口

以下のメニュー候補は2026-09-25に利用者が提示した画面から転記。印刷所選択状態による差はあり得るため、CSP全モード・全印刷所の完全な候補一覧とは扱わない。

| 画面 | 入力する領域 | 画面で確認したサイズ候補 | 単位 |
|---|---|---|---|
| イラスト | キャンバス | B4、B5、B6、A4、A5、A6、ポストカード、カスタム | cm、mm、in、px、pt |
| 漫画・同人誌（画像は金沢印刷選択） | 製本後の仕上がり | B5判、B6判、A4判、A5判 | mm |

にゃムルでは用途別に候補の出し方を変え、カスタム設定を保持する。イラストにも印刷用の詳細設定を用意する。単位を変えるだけでは実寸・画素数・配置を変えない。仕上がり・塗り足し込み画像・トンボ付き用紙を別表示する。例: B5仕上がり182×257mm + 各3mm = 画像188×263mm。B5サイズのキャンバス182×257mmとは意味が違う。

## 24社の一覧

解像度欄は公式の基本値・推奨値の要約。厳密な受付条件、本文/表紙や印刷方式の限定、出典は会社別詳細を参照。表のページ数はすべての商品の最低/最高を網羅したものではない。

| 印刷所（公式案内） | 塗り足しmm | モノクロ2値dpi | グレーdpi | カラーdpi | ページ数の確認結果 |
|---|---|---|---|---|---|
| [緑陽社](https://www.ryokuyou.co.jp/doujin/manual/photoshop.html) | 現行3、旧資料3/5 | 600/1200 | 600推奨、300可 | 350 | 無線2／中綴じ4 |
| [日光企画](https://www.nikko-pc.com/site/home-hd-2/home-qa/) | 3 | 600 | 600 | 350 | 単位未確認 |
| [サンライズ](https://www.sunrisep.co.jp/guide/faq/) | 3〜5、作成例5 | 1200推奨（軽減モード600） | 600 | 350 | 本文偶数、商品別 |
| [くりえい社](https://www.kurieisha.co.jp/faq/) | 5、3も可 | 単色600〜1200 | 独立指定未確認 | 350以上 | 2刻み商品例あり |
| [コーシン出版](https://www.ko-sin.co.jp/syindex/qa) | 3 | 600/1200 | 350〜600 | 350以上 | 本文偶数、商品刻み未確認 |
| [ねこのしっぽ](https://www.shippo.co.jp/neko/making/digital.shtml) | 3/5 | 600/1200、オンデマンド600推奨 | 350/600、網点600 | 350 | 単位未確認 |
| [金沢印刷](https://www.kanazawa-p.co.jp/howtodata/kaizoudo.html) | 3 | 600以上、600/1200例 | 600推奨、チェック表350〜600 | 350 | 総ページ偶数、口絵を含む |
| [栄光](https://www.eikou.com/making/other/) | 3、セルフチェック厳守 | 600〜1200 | 350〜600 | 300〜350 | 4倍数以外の商品例あり |
| [シメケン](https://shimeken.com/print/make-manuscript/size) | 標準3以上 | 色別区分なし：300/350/600推奨、印刷上限600 | 同左 | 同左 | くるみ2／中綴じ4 |
| [しまや出版](https://www.shimaya.net/howto/ps.html) | 3〜5 | 600〜1200 | 350〜600 | 350 | 偶数。商品別確認 |
| [大陽出版](https://www.taiyoushuppan.co.jp/doujin/howto/data.php) | 3、CSPは3/5 | 600/1200推奨 | 600推奨、350可 | 350/400推奨 | 偶数。口絵別計算 |
| [ポプルス](https://www2.popls.co.jp/pop/genkou/kihon.html) | 3 | 600、網点600/1200 | 600、網点なし300〜350可 | 300〜350 | 平とじ2／中とじ4（スタンダード） |
| [関西美術印刷](https://comic.kanbi-comic.com/guide/making/data/) | 3 | 600/1200 | 350 | 350 | 単位未確認 |
| [PICO](https://www.pico-net.com/doujinshi/doujinshi_manual/flow/manual.html) | 3以上（PDF3〜5） | 600〜1200、オンデマンド600 | 350〜600、仕様書600推奨 | 350、仕様書350〜400 | 中綴じ4／無線未確認 |
| [pixivFACTORY](https://factory-books.pixiv.help/hc/ja/articles/115002154453-どのようなデータを受け付けていますか) | 3（5はエラー例） | 600 | 600 | 350 | プラン別単位未確認 |
| [プリントオン](https://www.print-on.jp/doujin/company/kisochishiki/tonbo_nuritashi.html) | 3以上目安 | 600推奨 | 600推奨 | 350 | 2単位の商品あり |
| [アクシス](https://axis-publication.com/gochumon/sakusei/) | 3 | 600 | 350/600、小判600推奨 | 350 | 4刻み商品例、全体未確認 |
| [サングループ](https://sungroup.co.jp/faq/) | 標準4、3以上可 | オフセット600〜1200／オンデマンド600 | 350 | 350 | 無線2／中綴じ4 |
| [ブックネクスト](https://booknext.ink/guide/application/) | 0/3/5（標準3） | 600推奨、本文300〜600受付 | 同左 | 350推奨 | 料金表指定。全一覧未確認 |
| [テイズプリント](https://www.teis-p.com/html/manual.html) | 3 | 単色600（グレー推奨） | 600 | 350 | 50P商品あり。全単位未確認 |
| [オレンジ工房.com](https://www.orangekoubou.com/making/making.php) | CSP5推奨／旧案内3〜5 | 600、トーン600指定 | 600 | 350 | 偶数／中綴じ4の商品 |
| [株式会社 BRO'S](https://bros-comic.co.jp/nyukou/manual/make_method.html) | 3/5 | 600推奨 | 600推奨 | 表紙350、本文別指定未確認 | 偶数／中綴じ4 |
| [株式会社ホープツーワン](https://hope21.jp/creative-guide/clipstudio/) | 3/5（条件付き0） | 600 | 600 | 350 | 無線2・20P〜／中綴じ4・12〜28P |
| [EditNetプリンテック](https://www.editnet-p.jp/howtodraw/data/d2.phtml) | 3以上均等 | 600〜1800、孔版600 | 350〜600 | 350（現HTML） | 現行単位未確認、旧資料4 |

## 見つからなかったもの・確定できなかったもの

**会社全体の公式原稿案内が見つからなかった会社は0社。以下は項目単位の未確認事項。** 24社について原稿ガイド・FAQ・ソフト別手順・関連商品表を検索した範囲であり、全商品を網羅した調査ではない。公開ページに未記載なのか、別ページに存在するのかまでは断定しない。

| 印刷所 | 未確認・要照合事項 |
|---|---|
| 緑陽社 | 全商品共通の最少・最大ページ数は未確認／5mm受付の現在の商品ごとの適用範囲は未確認（現行HTMLは3mm、旧PDFに3/5mm） |
| 日光企画 | PDF/Xの特定規格指定／通常商品のページ刻みと表紙4P計数の現行自社明文／二値1200dpiの明示的な受付条件 |
| サンライズ | 通常画像・PDFそれぞれのトンボ必須/不要の統一明文／全商品共通の受付ページ刻み（商品ごとに確認が必要） |
| くりえい社 | PDF/X規格／グレー専用推奨dpi／データのトンボ要否／オフセットその他商品への2P刻みの適用範囲 |
| コーシン出版 | PDF/X規格／デジタル規定サイズでトンボ省略可能かの例外／商品別ページ数刻み／TIFFの全商品共通受付（FAQの一覧にないがPセット掲載） |
| ねこのしっぽ | PDF/Xの指定規格／商品ごとのページ数の倍数・刻み |
| 金沢印刷 | 商品ごとのページ刻み（総ページ偶数は確認済み） |
| 栄光 | 通常各商品のページ刻み（和とじ例は確認済み）／通常画像のトンボなし対応の一律条件（テンプレート資料とセルフチェックを分ける） |
| シメケン | 表現色別推奨dpi／PDF/X規格の指定／TIFF受付 |
| しまや出版 | 中綴じ等商品別ページ単位の全網羅／PDF/X-4の明示受付 |
| 大陽出版 | 中綴じ固有ページ単位／新旧トンボ記述差の全商品適用／独自PDF生成の事前チェック合格 |
| ポプルス | TIFF受付／PDF/X固有指定／スタンダード以外全商品の制約網羅 |
| 関西美術印刷 | 冊子商品別ページ単位／漫画PDF受付／PDF/X規格の指定／グレー600dpiを明示する冊子案内 |
| PICO | 無線綴じのページ刻み／350〜400カラー推奨の全商品適用／PDF/X-4明示受付 |
| pixivFACTORY | 全プランページ刻み／1200dpi/グレー350dpi受付／PDF/X規格の指定／TIFF受付 |
| プリントオン | 1200dpi明示受付／全セット製本別ページ単位／公式InDesign案内のPDF/X-4a表記の正確な意図 |
| アクシス | PDF/X規格・TrimBox等の指定／全セットのページ数倍数/最小最大／1200dpi二値の受付可否（600以外を不可とは断定しない） |
| サングループ | PDF/X規格・TrimBox等の指定／特殊商品を含む全プランの範囲 |
| ブックネクスト | 全商品の許容ページ数一覧と倍数／PDF/X規格・TrimBox等の指定／個別Photoshop案内の更新状態（3mm固定との相違） |
| テイズプリント | PDF/X規格・TrimBox等の指定／無線綴じの全許容ページ数を2刻みと明記する資料／二値1200dpiの受付可否 |
| オレンジ工房.com | PDF/X規格・TrimBox等の指定／漫画PDF受付条件の表内記述と非推奨受付欄の整合／全商品ごとのページ上下限 |
| 株式会社 BRO'S | カラー本文独立の解像度指定（350表紙から自動一般化しない）／全プランのページ上下限・用紙別中綴じ上限／1200dpi二値の受付可否 |
| 株式会社ホープツーワン | PDF/X規格・TrimBox等の指定／全商品を横断した無線綴じ最大頁数／600dpi以上という文言の境界（表自体は600推奨） |
| EditNetプリンテック | 通常全商品共通の最新形式一覧（d1.phtml取得不能）／通常PSD/TIFFの受付可否（白版以外へ一般化不可）／PDF/X規格・TrimBox等の指定／現行商品別ページ倍数/上下限。旧無線台割は4倍数だが時点/商品範囲を確認できず |

### 記述の相違として残した箇所

- ブックネクスト: 総合ガイドと2021年の改定告知は0/3/5mm、Photoshop個別ガイドは3mm厳守。総合ガイドを採用し、個別案内が古いという判断は推定として残した。
- プリントオン: InDesignページの「PDF/X-4a:2008」は公式ページの表記を記録したもの。未検証の規格名を自動出力設定にしない。
- 大陽出版・オレンジ工房: 一般案内と個別のソフト/商品案内でトンボやPDF条件の記述が異なる。対象経路を絞って確認する。
- ホープツーワン: 表の推奨600dpiと、本文の600dpi以上を避ける注意が併存。600dpiを禁止とは解釈しない。CSP手順のTIFFは2値に限定されるため総合形式一覧から無条件に拡張しない。
- EditNet: 通常形式一覧のページを取得できず、旧資料・特殊印刷・DIYの形式を通常全商品へ一般化していない。現HTMLと旧PDFで解像度案内に差もある。

各項目のリンクと検索範囲は、以下の会社別詳細に記載。

## 会社別詳細と出典

### 01. 緑陽社

対象: 同人誌の通常原稿。カラー表紙・本文／モノクロ本文。特別加工は別条件。

- **塗り足し**: 現行HTMLガイドは天地左右3mm。過去の表紙データ仕様書は3mmまたは5mmとも記載。新規プリセットは3mmとし、5mmを一律不許可とはしない。
- **モノクロ2値**: 600または1200ppi（推奨）
- **グレー**: 600ppi（推奨）。300ppiも受付可だが粗くなる旨を明記。
- **カラー**: 350ppi（推奨）
- **ページ数**: 総ページ＝表紙4P＋本文。無線綴じは2P単位、中綴じは4の倍数。
- **形式・PDF**: Photoshop原稿は統合PSD推奨、TIFF/PNG/JPG/EPSも掲載。Affinityは統合PSD推奨またはPDF/X-4。InDesignはPDF、漫画のPDFは画像劣化・モアレ等から非推奨。
- **トンボ**: Photoshop/通常画像は不要。IllustratorのAI原稿では必要。InDesign PDFではトンボとページ情報を外し塗り足しを含める。

未確認: 全商品共通の最少・最大ページ数は未確認／5mm受付の現在の商品ごとの適用範囲は未確認（現行HTMLは3mm、旧PDFに3/5mm）

公式資料:

- [モード別dpi、画像形式、塗り足し3mm、画像トンボ不要](https://www.ryokuyou.co.jp/doujin/manual/photoshop.html)
- [表紙4P、無線2P単位、中綴じ4倍数](https://www.ryokuyou.co.jp/doujin/manual/printwords.html)
- [PSD推奨、PDF/X-4対応、ダウンサンプルOFF/JPEG圧縮OFF/全フォント埋込/塗り足し含む](https://www.ryokuyou.co.jp/doujin/manual/affinity.html?am_force_theme_layout=mobile)
- [PDFトンボ不要、漫画PDF非推奨](https://www.ryokuyou.co.jp/doujin/manual/indesign.html)
- [古い仕様書では塗り足し3mmまたは5mmと記載](https://www.ryokuyou.co.jp/doujin/downloads/item/order_m03.pdf)

検索・確認範囲: 公式Photoshop/InDesign/Affinityガイド・FAQ・用語集・原稿作成基本PDF。PDFの直読み一度失敗、検索抽出で補助。

### 02. 日光企画

対象: 同人誌FAQの通常本文・表紙。カラーの印刷方式別条件あり。

- **塗り足し**: 本文は天地左右3mm。表紙はさらに背幅を追加。
- **モノクロ2値**: 600dpiを適正値として掲載。1200dpiの受付可否を独立明記した根拠は未発見。
- **グレー**: 600dpi
- **カラー**: 350dpi
- **ページ数**: 背幅FAQは表紙込みページ数を使用。4P加算の詳細・ページ刻みの現行自社明文は未確認。
- **形式・PDF**: PSD/TIFF/PDF/AI対応、CS6以下保存指定をFAQに掲載。PNG/JPG/BMPは受付可だが非推奨。Word PDFはフォント埋込。
- **トンボ**: トンボ利用を推奨。なくても正しい塗り足し込みキャンバスの中央から判定可能。

未確認: PDF/Xの特定規格指定／通常商品のページ刻みと表紙4P計数の現行自社明文／二値1200dpiの明示的な受付条件

公式資料:

- [塗り足し、各dpi、形式、トンボ、Word PDF埋込、オンデマンド/オフセット色、製本方法](https://www.nikko-pc.com/site/home-hd-2/home-qa/)

検索・確認範囲: 公式FAQ全文、原稿データガイド・商品検索。検索語: site:nikko-pc.com ページ 倍数／ページ 4P／ページ数 2ページ 4ページ。

### 03. サンライズ

対象: 同人誌通常原稿。解像度はPhotoshopガイドの公式画像表を直接目視。

- **塗り足し**: 基本FAQは各辺3〜5mm。Photoshop新規作成例とサイズ表は5mm。
- **モノクロ2値**: 1200dpi（推奨）。推奨外も作業可だが粗さ・モアレの注意。オンデマンド本文モアレ軽減モードは600dpiのみ。
- **グレー**: 600dpi（推奨）
- **カラー**: 350dpi（推奨）
- **ページ数**: 総ページ＝表紙4P＋本文。本文は偶数。ペラ本商品は4/8/12/16Pなど商品固有。通常無線綴じの最少受付は表紙込20P・背幅1mm以上という解説あり。
- **形式・PDF**: 画像ページはPSD/TIFF推奨、文章はPDF可。PDF/X-1a:2001（日本）またはプレス品質。フォント埋込、塗り足し込み、表紙・本文は別ファイル。
- **トンボ**: PDF InDesign案内はカラーバー・ページ情報を外しドキュメント裁ち落としを使用。トンボ全部の一律要否は本文から確定できず未確認。

未確認: 通常画像・PDFそれぞれのトンボ必須/不要の統一明文／全商品共通の受付ページ刻み（商品ごとに確認が必要）

公式資料:

- [本文原寸＋各辺3〜5mm](https://www.sunrisep.co.jp/guide/faq/)
- [5mm例、8bit指定、解像度公式画像表](https://www.sunrisep.co.jp/genkou/create-photoshop/)
- [直接目視: モノクロ二階調1200dpi](https://www.sunrisep.co.jp/wp/wp-content/uploads/2023/10/04_ALL_kaizodo_2chi.png)
- [直接目視: グレー600dpi](https://www.sunrisep.co.jp/wp/wp-content/uploads/2023/10/04_ALL_kaizodo_gray.png)
- [直接目視: カラー350dpi](https://www.sunrisep.co.jp/wp/wp-content/uploads/2023/10/04_ALL_kaizodo_cmyk_rgb.jpg)
- [PDF/X-1aまたはプレス品質、画像ページPSD/TIFF推奨、フォント埋込等](https://www.sunrisep.co.jp/genkou/create-pdf/)
- [総ページ表紙4P＋本文、本文偶数](https://www.sunrisep.co.jp/genkou/glossary/)
- [商品別4/8/12/16P](https://www.sunrisep.co.jp/book/pera/)
- [無線綴じ表紙込20P以上・背幅1mm以上](https://www.sunrisep.co.jp/column/recommended-booklets-of-saddle-stitch-printer.html)

検索・確認範囲: 公式FAQ/Photoshop/PDF/原稿基礎/用語集/商品ページ。画像表はwebツール取得不可のため公式URLへ読取接続して直接確認。

### 04. くりえい社

対象: 同人誌FAQ。ページ例はオールフルカラーオンデマンド商品。

- **塗り足し**: 天地左右5mmを案内、3mmでも可と明記。
- **モノクロ2値**: モノクロ表紙・本文600〜1200ppi。FAQは二値とグレーを個別の解像度欄に分けていない。
- **グレー**: グレー専用の推奨dpi未確認。モノクロ600〜1200ppiの包括案内あり。
- **カラー**: 350ppi以上
- **ページ数**: 総ページ＝本文＋表紙4P、本文開始3Pが基本。オールフルカラーオンデマンドの料金表に12/14/16P等があり4倍数限定ではない。
- **形式・PDF**: 統合PSD推奨、AI/EPS。Word/InDesignはPDFのみ。カラーはCMYK推奨・RGB入稿も可（色変化あり）。インク総量300%以下。
- **トンボ**: FAQはトンボ/仕上がり線の説明あり。データ入稿での必須・不要は未確認。

未確認: PDF/X規格／グレー専用推奨dpi／データのトンボ要否／オフセットその他商品への2P刻みの適用範囲

公式資料:

- [3/5mm、解像度、形式、表紙4P、カラー条件](https://www.kurieisha.co.jp/faq/)
- [2026年4月改定表、表紙4P込12/14/16P等](https://www.kurieisha.co.jp/menu/allfullcolorondemand/)

検索・確認範囲: 公式FAQ、オールフルカラーオンデマンド料金表。検索語: site:kurieisha.co.jp PDF/X／ページ 倍数／ページ 2ページ。

### 05. コーシン出版

対象: 恒信印刷の同人誌窓口。現行FAQを主とし旧公式PDFは古い補足として扱う。

- **塗り足し**: 天地左右3mm。切れて困る文字は仕上がりから3mm内側。
- **モノクロ2値**: 600または1200dpi（推奨）
- **グレー**: 350〜600dpi（推奨）。網点あり350dpiはモアレ注意。
- **カラー**: 350dpi以上（推奨）
- **ページ数**: 現行FAQ: 本文は偶数、総ページ＝本文＋表紙4P。旧公式ガイドのB5 4倍数/A5 8倍数等は製版効率の補足で、現行商品の必須ページ刻みには転用しない。
- **形式・PDF**: 現行FAQ推奨PDF/AI/PSD/EPS、フォント埋込・アウトライン・統合済み。Pセットの商品ページにはTIFFも列挙。
- **トンボ**: 公式用語集はカラー/モノクロ問わず原稿にトンボ必須と明記。ただしデジタル規定サイズでの例外可否は未確認（個別FAQの取得失敗）。

未確認: PDF/X規格／デジタル規定サイズでトンボ省略可能かの例外／商品別ページ数刻み／TIFFの全商品共通受付（FAQの一覧にないがPセット掲載）

公式資料:

- [各dpi、3mm、形式、画像原寸・モアレ注意](https://www.ko-sin.co.jp/syindex/qa)
- [PセットTIFF対応、単色表紙本文600dpi推奨](https://www.ko-sin.co.jp/syindex/set-p)
- [旧資料: 本文偶数、B5 4倍数/A5 8倍数が望ましい](https://www.ko-sin.co.jp/syindex/wp-content/uploads/HOW-TO_ANALOG_D_kosin_140529.pdf)
- [旧資料: 製版方法による効率ページ単位](https://www.ko-sin.co.jp/syindex/wp-content/uploads/HOW-TO_DATA_D_kosin_190305.pdf)
- [本文偶数＋表紙4P](https://www.ko-sin.co.jp/syindex/qa/2071)
- [公式用語集でトンボ必須](https://www.ko-sin.co.jp/syindex/yougo_gen2)

検索・確認範囲: 公式FAQ/Pセット/データ・アナログPDFマニュアル/ご利用ガイド。古いPDFの製版条件を現行強制仕様へ自動変換しない。

### 06. ねこのしっぽ

対象: 同人誌データ原稿。グッズは対象外。

- **塗り足し**: 公式サイズ表に3mm・5mm両方あり。
- **モノクロ2値**: 600または1200dpi。オンデマンドは600dpi推奨。
- **グレー**: 350または600dpi。網点ありは600dpi。
- **カラー**: 350dpi
- **ページ数**: 総ページは表紙4P＋本文。本文は偶数。遊び紙・口絵は含めない。商品ごとのページ刻みは未確認。
- **形式・PDF**: 統合PSD推奨。PDF（文章向け）、PNG/BMP/TIFFも受付。Photoshop EPS可、Illustrator EPS不可。JPEG非推奨。 PDFは全フォント埋込、複数ページをまとめ可。InDesignは「雑誌広告送稿用」プリセットを指定（PDF/Xの型名は明文未発見のため推測しない）。
- **トンボ**: 表紙・本文とも正しいサイズならトンボなし可。

未確認: PDF/Xの指定規格／商品ごとのページ数の倍数・刻み

公式資料:

- [3/5mm、各dpi、形式、トンボ不要、RGB/CMYKプロファイル](https://www.shippo.co.jp/neko/making/digital.shtml)
- [表紙4P＋本文、遊び紙/口絵は総ページに含めない](https://www.shippo.co.jp/neko/faq_2.shtml)
- [本文偶数、表紙4P、PDF全フォント埋込・複数ページ可・InDesign指定プリセット](https://www.shippo.co.jp/neko/making/word2pdf.shtml)

検索・確認範囲: 公式データ原稿マニュアル、原稿FAQ、Word/PDFガイド。検索語: site:shippo.co.jp ページ 倍数。

### 07. 金沢印刷

対象: 通常同人誌のデータ原稿。本文・表紙、PDFはソフト別案内。

- **塗り足し**: 天地左右3mm。表紙見開きは背幅を追加。
- **モノクロ2値**: 600dpi以上（推奨）、600/1200dpiの見本あり。
- **グレー**: 600dpi推奨（解像度ページ）。チェックシートは350〜600dpiも記載。1200dpi以上は容量・作業支障から避け600dpiで入稿するよう依頼。
- **カラー**: 350dpi（推奨）
- **ページ数**: 総ページ偶数、本文＋表紙4P。カラー口絵も総ページに含む。遊び紙は未印刷なら含まず、印刷すると紙替え扱いで含む。
- **形式・PDF**: PSD推奨/TIFF/EPS等。PDF/X-1a〜X-4、PDF1.3〜1.6受付。画像だけならPDF化せずPSD/EPSを依頼。PDFはダウンサンプルしない・ZIP圧縮・フォント埋込。
- **トンボ**: 推奨サイズの画像原稿はトンボなし可。仕上がり位置が不明なサイズなら必須。PDFは不要。Illustratorはトリムマークを付ける。

未確認: 商品ごとのページ刻み（総ページ偶数は確認済み）

公式資料:

- [各モードの推奨dpi、グレー1200以上非推奨](https://www.kanazawa-p.co.jp/howtodata/kaizoudo.html)
- [3mm、表紙背幅](https://www.kanazawa-p.co.jp/genkousakusei/hyoushi.html)
- [総ページ偶数・表紙4P・口絵/遊び紙の扱い](https://www.kanazawa-p.co.jp/making/sakusei.html)
- [PDF規格/圧縮/フォントと画像PDF化非推奨、PDFトンボ不要](https://www.kanazawa-p.co.jp/howtodata/pdf_kakidasi.html)
- [PSD/TIFFその他形式](https://www.kanazawa-p.co.jp/howtodata/howtodata_media.html)
- [推奨画像サイズならトンボ不要、非規定サイズは必要](https://www.kanazawa-p.co.jp/qanda/question.html)
- [グレー350〜600、二値600〜1200、Illustratorトンボ](https://www.kanazawa-p.co.jp/howtodata/checksheet.html)

検索・確認範囲: 公式データ手引き/解像度/形式/PDF書出し/表紙/原稿作成。検索語: site:kanazawa-p.co.jp ページ 倍数。

### 08. 栄光

対象: 通常原稿共通設定とセルフチェック入稿を区別。商品別ページ数条件を混同しない。

- **塗り足し**: 通常共通設定は天地左右3mm。セルフチェック入稿は塗り足し3mmの規定サイズのみ。
- **モノクロ2値**: 600〜1200dpi（推奨）
- **グレー**: 350〜600dpi（推奨）。セルフチェック本文600dpi推奨。
- **カラー**: 300〜350dpi（推奨）。セルフチェックカラー本文350dpi推奨。
- **ページ数**: 総ページ＝表紙4P＋本文。遊び紙は含めない。和とじオフセット商品は38Pなど料金表の間のページも注文可。全商品4倍数限定としない。
- **形式・PDF**: PNG/JPEG/TIFF/PSD/AI/EPS、PDF受付。TIFF/PSDは統合。PDFと画像混在可能。 InDesign通常ガイドはPDF/X-4:2008、日本、ダウンサンプルなし/ZIP。一方セルフチェック対応表のIllustrator/InDesignはPDF/X-1aと記載。入稿経路で分ける。
- **トンボ**: セルフチェックはトンボ不要（規定3mmサイズのみ）。通常InDesign PDFガイドもトンボ・ページ情報をすべて外す。通常画像用テンプレートPDFにはトンボを残す手順があり、経路/形式を区別。
- **トーン線数**: 網トーン60線以下推奨、80線受付可。ただし高濃度はつぶれ注意。CSP既定値とは別の案内。

未確認: 通常各商品のページ刻み（和とじ例は確認済み）／通常画像のトンボなし対応の一律条件（テンプレート資料とセルフチェックを分ける）

公式資料:

- [各dpi、形式、3mm、トーン60線推奨](https://www.eikou.com/making/other/)
- [セルフチェック限定3mm・トンボ不要、推奨dpi](https://www.eikou.com/selfcheck/fileup-btn/)
- [表紙4P＋本文、遊び紙除外](https://www.eikou.com/making/printglossary/totalpage/)
- [38P等間のページ注文可（和とじオフセット限定）](https://eikou.com/commodity/watoji-off/)
- [通常InDesign PDF/X-4:2008、トンボなし、ZIP、ダウンサンプルなし](https://www.eikou.com/making/indesign/)
- [セルフチェックのIllustrator/InDesignはPDF/X-1a](https://www.eikou.com/selfcheck/file/)
- [通常本文テンプレートはトンボレイヤーを残して統合する手順](https://www.eikou.com/dl/guide/honbun_guide.pdf)

検索・確認範囲: 公式共通設定/セルフチェック/用語集/和とじ商品。検索語: site:eikou.com PDF/X トンボ／ページ数 2ページ 4ページ。

### 09. シメケン

対象: シメケンプリント・同人誌

- **塗り足し**: 標準3mm、3mm以上受付。フチが完全な白なら省略可。
- **モノクロ2値**: 表現色別の区分なし。総合推奨300/350/600dpi。高解像度受付可だが印刷最大600dpi。
- **グレー**: 表現色別指定未確認。総合推奨300/350/600dpi。
- **カラー**: 表現色別指定未確認。総合推奨300/350/600dpi。
- **ページ数**: 本文: 中綴じ4の倍数、くるみ2の倍数。注文メニュー4刻みでもくるみは2p少なく入稿可。本文+表紙4p表記。
- **形式・PDF**: PDF/統合PSD/JPG/PNG。透過PNG不可。PDFフォント埋込、注釈印刷不可。
- **トンボ**: トンボなし受付可、ある方が望ましい。

未確認: 表現色別推奨dpi／PDF/X規格の指定／TIFF受付

公式資料:

- [塗り足し、総合dpi、印刷600上限、トンボ](https://shimeken.com/print/make-manuscript/size)
- [受付形式、PDF条件](https://shimeken.com/print/make-manuscript/file)
- [ページ構成と注文数](https://shimeken.com/print/make-manuscript/page)

検索・確認範囲: シメケン 入稿 原稿 解像度 塗り足し / site:shimeken.com ページ 倍数 / 原稿作成メニューから形式/ページへ

### 10. しまや出版

対象: 通常の漫画本文・表紙、ソフト別公式案内

- **塗り足し**: 3〜5mm。CLIP STUDIO書き出し例は3mm。
- **モノクロ2値**: 600〜1200dpi（Photoshop案内）、MediBang本文推奨600dpi。網点は600/1200推奨。
- **グレー**: 350〜600dpi（Photoshop/チェックリスト）。
- **カラー**: 350dpi（カラー表紙/本文）。
- **ページ数**: 表紙4pを含む。MediBang案内は必ず偶数。文豪セット例は18pを20p料金で受付。中綴じの固有単位未確認。
- **形式・PDF**: 統合PSD、EPS、TIFF。PDF1.3〜1.7、PDF/X-1a:2001 JPNを優先し不具合時1.4〜1.7。PDF/A使用不可。全フォント埋込、ダウンサンプルオフ。
- **トンボ**: 塗り足しまで書き出す場合トンボ不要。ページ全体ならトンボも出力。

未確認: 中綴じ等商品別ページ単位の全網羅／PDF/X-4の明示受付

公式資料:

- [表紙/本文のdpi、PSD/EPS](https://www.shimaya.net/howto/ps.html)
- [塗り足し3〜5、dpi推奨、ページ偶数/表紙4](https://www.shimaya.net/howto/medibang.html)
- [PSD/TIFF等とトンボ出力](https://www.shimaya.net/howto/clipstudio.html)
- [PDF規格、PDF/A不可、埋込](https://www.shimaya.net/howto/pdf.html)
- [文豪セット18→20p料金の例](https://www.shimaya.net/fair/bungou/bungou.html)

検索・確認範囲: site:shimaya.net 原稿 解像度 塗り足し / site:shimaya.net/howto PDF / site:shimaya.net ページ 倍数/4ページ

### 11. 大陽出版

対象: 一般データ、CLIP STUDIO、PDF本文、中綴じ

- **塗り足し**: 一般原稿3mm。CLIP STUDIOの許容仕様は3または5mm。PDF本文の案内は3mm。
- **モノクロ2値**: 推奨600/1200dpi。
- **グレー**: 推奨600dpi。350dpiも受付可、カラー表紙流用時は変更せず可。
- **カラー**: 推奨350/400dpi、RGB/CMYK。RGBはICC埋込。
- **ページ数**: 表紙4p+本文。巻頭カラー/フルカラー扉はセット料金ページに含めず別料金。奇数の本不可。中綴じ単位の該当本文は要追加確認。
- **形式・PDF**: 統合PSD/TIFF/EPS、AI。PDFは本文のみ/カラーオブジェクトなし/フォント埋込。InDesign PDF/X-1a:2001 JPN推奨、Word PDF/A推奨。
- **トンボ**: CLIP STUDIO案内はトンボあり/なし両方可（3/5mm塗り足し）。旧カラー本文ページに必須との記載もあり、新しいソフト別手順を優先して要注文確認。

未確認: 中綴じ固有ページ単位／新旧トンボ記述差の全商品適用／独自PDF生成の事前チェック合格

公式資料:

- [一般dpi推奨、350グレー受付、PDF対象と規格、3mm](https://www.taiyoushuppan.co.jp/doujin/howto/data.php)
- [3/5mm、統合PSD/TIFF、トンボ出力範囲](https://www.taiyoushuppan.co.jp/doujin/howto/clipstudiopro.php)
- [表紙込み、口絵別料金、奇数不可](https://www.taiyoushuppan.co.jp/doujin/howto/vocabulary02.php)
- [中綴じ商品参照](https://www.taiyoushuppan.co.jp/doujin/product/set/option/503-stapler.php)
- [旧カラー本文のトンボ必須記述](https://www.taiyoushuppan.co.jp/doujin/howto/body-data-color.php)

検索・確認範囲: 大陽出版 原稿 データ 解像度 塗り足し / site:taiyoushuppan.co.jp 解像度 グレースケール / site:taiyoushuppan.co.jp ページ 倍数

### 12. ポプルス

対象: 一般原稿/スタンダードセット

- **塗り足し**: 上下左右3mm。
- **モノクロ2値**: 600dpi基本、網点使用は600/1200dpi。
- **グレー**: 600dpi基本。網点なしの純グレーなら300〜350dpiでもよいとの記載。
- **カラー**: 300〜350dpi（最終チェック）、基本案内は350dpi。
- **ページ数**: スタンダード: 平とじ10p以上かつ2の倍数、中とじ8〜40pで4の倍数。いずれも表紙4p込み。
- **形式・PDF**: 統合PSD/PNG/PDF。PDF1.3以降、フォントアウトライン化または埋込、画像圧縮OFF。PDF/Xの固有指定未確認。
- **トンボ**: トンボ不要。正しい原寸+塗り足しを用紙中央に配置すれば余白/トンボありも可。

未確認: TIFF受付／PDF/X固有指定／スタンダード以外全商品の制約網羅

公式資料:

- [3mm、dpiと網点例外、形式、PDF条件、トンボ](https://www2.popls.co.jp/pop/genkou/kihon.html)
- [カラー300〜350、モノクロ600/1200](https://www2.popls.co.jp/pop/genkou/saigo.html)
- [製本別単位/総ページ数](https://www2.popls.co.jp/pop/book/standard.html)

検索・確認範囲: site:popls.co.jp 原稿 解像度 塗り足し / site:popls.co.jp ページ数 倍数

### 13. 関西美術印刷

対象: カンビ一般原稿。PDFのみKANBI LIVRE小説本文を限定

- **塗り足し**: 表紙/カバー/本文は基本3mm。グッズには5mm以上もあるが冊子へ一般化しない。
- **モノクロ2値**: 単色用600/1200dpi。LIVRE小説PDF挿絵の推奨は600dpi。
- **グレー**: 単色用350dpi。
- **カラー**: フルカラーオフセット最適350dpi。
- **ページ数**: 表紙4p+本文で総ページ数。一般的ページ単位の明文未発見。
- **形式・PDF**: PSD/TIFF/EPS/AI。RGB画像8bit・ICC埋込。LIVRE PDFはモノクロ本文の小説のみ、Word保存手順はPDF/A準拠・フォント埋込確認・見本画像添付。漫画全面PDF受付へ拡張しない。
- **トンボ**: 冊子は3mm塗り足しあればトンボなし受付可。Illustrator個別手順はトンボ必須。

未確認: 冊子商品別ページ単位／漫画PDF受付／PDF/X規格の指定／グレー600dpiを明示する冊子案内

公式資料:

- [解像度、画像形式、RGB](https://comic.kanbi-comic.com/guide/making/data/)
- [基本3mm/グッズ差、冊子トンボなし可](https://kanbi-comic.com/guide/order/base/)
- [表紙4p+本文](https://comic.kanbi-comic.com/data-guide/making/basic/)
- [LIVRE小説PDF限定、画像dpi、PDF/A保存](https://kanbi-comic.com/guide/order/pdf/)
- [Illustratorトンボ必須への案内](https://comic.kanbi-comic.com/data-guide/making/)

検索・確認範囲: site:kanbi-comic.com 解像度 塗り足し 原稿 / site:kanbi-comic.com ページ 倍数/単位/表紙4 / 公式原稿作成→データ/PDF

### 14. PICO

対象: 通常の表紙/本文、オフセットとオンデマンドを分離

- **塗り足し**: 3mm以上。表紙/本文原稿ガイド標準3mm、PDF説明は3〜5mm。断ち切りなし小説PDFは仕上がりぴったり可。
- **モノクロ2値**: 600〜1200dpi。ただしオンデマンド600dpi指定。仕様書は600または1200と表記。
- **グレー**: 一般ガイド350〜600dpi、入稿仕様リスト推奨600dpi。
- **カラー**: 一般表紙/口絵350dpi。仕様リスト推奨欄350〜400dpiとの幅もある。
- **ページ数**: 中綴じ4p単位。料金表は表紙4p込み。無線綴じのページ刻みは未確認。
- **形式・PDF**: PSD/TIFF/EPS/PDF/JPEGなど。PSD統合。PDF全フォント埋込、PDF/X-1a推奨。
- **トンボ**: データは正しいサイズ/均等3mm以上ならなし可。アナログは必須。

未確認: 無線綴じのページ刻み／350〜400カラー推奨の全商品適用／PDF/X-4明示受付

公式資料:

- [dpiとオンデマンド例外](https://www.pico-net.com/doujinshi/doujinshi_manual/flow/manual.html)
- [推奨値/統合PSD等](https://www.pico-net.com/doujinshi/download/pdata/pico_dataseat_hyoushi.pdf)
- [3mm以上/トンボなし可/形式](https://www.pico-net.com/doujinshi/doujinshi_manual/letterbody/006.html)
- [PDF埋込、PDF/X-1a推奨](https://www.pico-net.com/doujinshi/doujinshi_manual/letterbody/013.html)
- [中綴じ4p単位](https://www.pico-net.com/doujinshi/doujinshi_manual/word/010.html)
- [料金表表紙4p込み](https://www.pico-net.com/doujinshi/service/doujin_print/offset/003.html)

検索・確認範囲: site:pico-net.com 原稿 解像度 塗り足し / site:pico-net.com ページ 倍数/偶数/表紙4 / 本文マニュアルPDF/FAQ/用語

### 15. pixivFACTORY

対象: BOOKS同人誌。PDFは対応プラン本文限定

- **塗り足し**: 3mm規格。5mmデータはサイズエラーの例。断ち切りがない本文は仕上がりぴったり可（許容誤差-0.4mmまでとFAQ）。
- **モノクロ2値**: モノクロ本文600dpi（PSDは2階調可）。1200受付は未確認。
- **グレー**: モノクロ本文600dpi（PSDはグレー可）。350受付は未確認。
- **カラー**: 表紙/カラー本文350dpi。カラーRGBのみ。
- **ページ数**: 注文ページ数は表紙4p込み、本文は注文数-4。表2/3印刷不可。全プランの選択刻み未確認。
- **形式・PDF**: PNG/統合PSD。本文PDFは特定プランのみ、全本文を1PDF・グレースケール・全フォント埋込・注釈/フォームなし。表紙PDF不可。
- **トンボ**: テンプレートのトンボ等ガイド線は除去。

未確認: 全プランページ刻み／1200dpi/グレー350dpi受付／PDF/X規格の指定／TIFF受付

公式資料:

- [形式、dpi/サイズ表、PDF特定プラン](https://factory-books.pixiv.help/hc/ja/articles/115002154453-どのようなデータを受け付けていますか)
- [本文dpi、PDFまとめ、表紙PDF不可](https://factory-books.pixiv.help/hc/ja/articles/115002149394-本文のつくり方-サイズについて教えてください)
- [5mmエラー/対応プラン/ページ一致](https://factory-books.pixiv.help/hc/ja/articles/360014206613-エラーが出て原稿を入稿できません)
- [表紙4p込み、表2/3不可](https://factory-books.pixiv.help/hc/ja/articles/360000289421-ページ数は表紙の分を含みますか)
- [トンボ等ガイド除去](https://factory-books.pixiv.help/hc/ja/articles/115002018074-注文から発送までの流れを教えてください)

検索・確認範囲: pixivFACTORY BOOKS 入稿 塗り足し 解像度600 350 / site:factory-books.pixiv.help ページ数/倍数/4ページ単位 / 原稿形式/本文/エラーFAQ

### 16. プリントオン

対象: 一般漫画原稿+個別セット例

- **塗り足し**: 各辺3mm目安、3mm以上受付。商品テンプレート優先。
- **モノクロ2値**: 600dpi推奨。1200明示受付は未発見。
- **グレー**: 600dpi推奨。
- **カラー**: 350dpi（本文テンプレート/依頼書）。RGB/CMYKは商品別。
- **ページ数**: 本文+表紙4p（口絵/遊び紙除外）。例:わくわくドキドキデザイン/型抜き/フランス製本等は2p単位。全商品を4p固定にしない。
- **形式・PDF**: PSD/TIFF/PDF/ラスタEPS。InDesign案内はPDF/X-4a:2008(日本)と記載（規格名の妥当性要照合、アプリへ無検証実装しない）。旧Word2003案内はPDF/X-1a:2001。フォント埋込、ダウンサンプルなし。
- **トンボ**: 漫画は見えるトンボ必須との総合案内。小説・PDFはトンボなし可。

未確認: 1200dpi明示受付／全セット製本別ページ単位／公式InDesign案内のPDF/X-4a表記の正確な意図

公式資料:

- [3mm以上とトンボ/PDF例外](https://www.print-on.jp/doujin/company/kisochishiki/tonbo_nuritashi.html)
- [グレー/2値600推奨](https://www.print-on.jp/doujin/company/kisochishiki/grayscale_monochrome.html)
- [カラー350テンプレート](https://www.print-on.jp/doujin/comic/price/honbun_template_matome/honbun_template_mokuji_mokomoko.htm)
- [PSD/TIFF/PDF/ラスタEPS](https://www.print-on.jp/doujin/company/order/deta.htm)
- [公式表記PDF/X-4aと圧縮/色変換](https://www.print-on.jp/doujin/company/order/deta_indesing.htm)
- [旧Word PDF/X-1a](https://www.print-on.jp/doujin/company/order/manual/word.htm)
- [総p算出](https://www.print-on.jp/doujin/company/kisochishiki/pages.html)
- [2p単位の商品例](https://www.print-on.jp/doujin/comic/price/wakuwaku_design_price.htm)

検索・確認範囲: site:print-on.jp 原稿 解像度 塗り足し600 / site:print-on.jp 解像度1200 / site:print-on.jp ページ数 倍数/偶数/2ページ/表紙4 / site:print-on.jp PDF/X

### 17. アクシス

対象: アクシス出版株式会社。個別条件は各項目を参照

- **塗り足し**: 表紙mm: 3。本文mm: 3。位置付け: 指定。補足: テンプレート別仕様はテンプレートを優先
- **モノクロ2値**: 値: 600。位置付け: 基本仕様
- **グレー**: 値: 350 / 600。位置付け: 基本仕様。補足: A6未満は600推奨
- **カラー**: 値: 350。位置付け: 基本仕様
- **ページ数**: 数え方: 表紙4P＋本文。遊び紙・口絵を除く。ページ単位: 未確認。確認例: フルカラー本セットA5料金表は16/20/24/28等の4P刻み。全商品一律必須の根拠にはしない
- **形式・PDF**: 受付形式: PSD / Photoshop EPS / TIFF / PDF（本文のみ）。PDF規格: 未確認。トンボ: CLIP STUDIO書き出し案内で表紙・本文ともトンボ出力を指示。色: 基本CMYK。RGB入稿は変換。RGB対応商品・オプションは別

未確認: PDF/X規格・TrimBox等の指定／全セットのページ数倍数/最小最大／1200dpi二値の受付可否（600以外を不可とは断定しない）

公式資料:

- [原稿作成基本仕様](https://axis-publication.com/gochumon/sakusei/)
- [CLIP STUDIO書き出し](https://axis-publication.com/gochumon/sakusei/clip.html)
- [フルカラーA5料金表](https://www.axis-publication.com/set/fullcolor/ryoukin_A5.html?no=0)
- [同人誌注文書](https://axis-publication.com/gochumon/chumonsyo/img/order_dojinshi.pdf)

検索・確認範囲: アクシス 同人誌 印刷 原稿 解像度 塗り足し / site:axis-publication.com ページ 倍数 / site:axis-publication.com PDF トンボ / 公式データ作成・CLIP STUDIO案内・注文書・料金表

### 18. サングループ

対象: 株式会社サングループ。個別条件は各項目を参照

- **塗り足し**: 表紙mm: 4。本文mm: 4。位置付け: 標準テンプレート4mm。受付最低mm: 3。補足: FAQは3mm以上も問題なし。塗り足し不要の文字のみは規格寸法可。中央合わせ必須
- **モノクロ2値**: オフセット: 最小: 600。最大: 1200。位置付け: 推奨。オンデマンド: 値: 600。位置付け: 推奨
- **グレー**: 値: 350。位置付け: 推奨（オフセット/オンデマンド）
- **カラー**: 値: 350。位置付け: 推奨（オフセット/オンデマンド）
- **ページ数**: 数え方: 表紙＋本文、遊び紙・口絵を除く。オフセット単色・無線: ページ単位: 2。最小: 20。最大: 148。オフセットカラー・無線: ページ単位: 2。最小: 20。最大: 64。オフセット中綴じ: ページ単位: 4。最小: 8。最大: 40。オンデマンド無線: ページ単位: 2。最小: 20。最大: 76。補足: 特急・折本等は別設定
- **形式・PDF**: 受付形式: PSD / PDF。PDF規格: 未確認。トンボ: 不要（中央合わせ方式）。ガイド・トンボ残置に注意。フォント: 文字PDFはフォント埋込。色: RGB/CMYK受付。sRGB推奨、ICC埋込をしない案内

未確認: PDF/X規格・TrimBox等の指定／特殊商品を含む全プランの範囲

公式資料:

- [FAQ：塗り足し・解像度・形式](https://sungroup.co.jp/faq/)
- [印刷方式/製本別のページ条件](https://sungroup.co.jp/print-menu/)
- [原稿テンプレート](https://sungroup.co.jp/template/)

検索・確認範囲: サングループ 原稿 表紙 4mm / site:sungroup.co.jp ページ数 4 2 / 公式FAQ・印刷メニュー・テンプレート

### 19. ブックネクスト

対象: booknext（ブックネクスト）。個別条件は各項目を参照

- **塗り足し**: 選択値mm: 0 / 3 / 5。標準mm: 3。位置付け: 受付対応・標準3mm。補足: 0mmは裁ち切り絵柄のないデザイン。2021-11-26変更告知と総合ガイドが一致。記述の相違: Photoshop個別ガイドの3mm厳守が残存。改定を反映していない可能性が高いが推定。現総合ガイドを本表に採用
- **モノクロ2値**: 値: 600。位置付け: 推奨。本文受付範囲: 300〜600。範囲の条件: FAQは本文300〜600受付。表現色別の例外は明記なし
- **グレー**: 値: 600。位置付け: 推奨。本文受付範囲: 300〜600
- **カラー**: 値: 350。位置付け: 推奨（表紙/本文）
- **ページ数**: 数え方: 表紙4P＋本文。ページ単位: 未確認。補足: 料金表にないページ数は受付不可、白紙調整。オフセット/オンデマンドで受付ページが異なる
- **形式・PDF**: 受付形式: PNG / JPG / PSD / TIFF / PDF。PDF規格: 未確認。トンボ: 不要。仕上がり＋選択塗り足しの寸法のみ。色: RGB/CMYK、単色はグレー/二値。補足: 本文全頁の解像度統一。画像とPDF混在、表紙単頁・見開きに対応

未確認: 全商品の許容ページ数一覧と倍数／PDF/X規格・TrimBox等の指定／個別Photoshop案内の更新状態（3mm固定との相違）

公式資料:

- [入稿データ総合案内](https://booknext.ink/guide/application/)
- [0/3/5mm対応の改定告知](https://booknext.ink/news/20211126versionup/)
- [Photoshop個別案内（総合案内と相違）](https://booknext.ink/download/photoshop/)
- [本文300〜600dpiの受付FAQ](https://booknext.ink/qa/本文の解像度が「300dpi」でも入稿できますか？/)
- [料金表にないページ数のFAQ](https://booknext.ink/qa/料金表にないページ数の注文は可能ですか？/)
- [用紙と背幅](https://booknext.ink/guide/paper/)

検索・確認範囲: site:booknext.ink 原稿 350dpi 塗り足し / site:booknext.ink ページ数 倍数 / site:booknext.ink 2ページ単位 / 総合案内・2021改定告知・Photoshopガイド・FAQ・背幅計算

### 20. テイズプリント

対象: 同人誌印刷所テイズプリント（Tei’s Print）。個別条件は各項目を参照

- **塗り足し**: 表紙mm: 3。本文mm: 3。位置付け: 裁ち切りありの指定。補足: 裁ち切り柄なしの小説等は原寸可
- **モノクロ2値**: 値: 600。位置付け: モノクロ原稿の指定。補足: グレースケール推奨。二値だけの別指定は未確認
- **グレー**: 値: 600。位置付け: 指定・グレースケール推奨
- **カラー**: 値: 350。位置付け: 指定
- **ページ数**: 数え方: 表紙4P込み、口絵は別。ページ単位: 未確認。確認例: 激安無線綴じ50P商品を確認（4の倍数のみではない）。通常激安/カラー12〜206P。全偶数受付の明文は未確認
- **形式・PDF**: 受付形式: PSD / PNG / TIF / TIFF / EPS / JPG / JPEG / PDF。PDF規格: 未確認。トンボ: なくても可。正寸・中央合わせ必須。補足: 本文は単頁、形式を統一。PDFは全本文1ファイル。表紙は表1＋背＋表4の1枚必須。Adobe/CSP以外で作成したPDFの印刷不具合は保証外との注意あり。色: RGB/CMYK可、RGBはCMYK変換

未確認: PDF/X規格・TrimBox等の指定／無線綴じの全許容ページ数を2刻みと明記する資料／二値1200dpiの受付可否

公式資料:

- [入稿マニュアル](https://www.teis-p.com/html/manual.html)
- [無線綴じ50P商品](https://www.teis-p.com/category/548.html)
- [オールカラー商品](https://www.teis-p.com/category/38890.html)

検索・確認範囲: テイズプリント 原稿 / site:teis-p.com ページ数 倍数 / 公式入稿マニュアル・激安50P商品・オールカラー12P商品

### 21. オレンジ工房.com

対象: オレンジ工房.com。個別条件は各項目を参照

- **塗り足し**: 推奨mm: 5。受付範囲mm: 3〜5。位置付け: CLIP STUDIO案内は5mm推奨、ComicStudio案内は3〜5mm。補足: 小説は原寸可の商品あり。商品別テンプレート優先
- **モノクロ2値**: 値: 600。位置付け: 推奨。トーン使用時は600を指定。補足: 同社は600以外でトーンにモアレが発生すると注意。1200を汎用最良にしない
- **グレー**: 値: 600。位置付け: 推奨
- **カラー**: 値: 350。位置付け: 推奨
- **ページ数**: 数え方: 表紙の表裏（表1〜4）を含む。一般条件: 奇数不可（FAQ）。中綴じ: ページ単位: 4。最大: 40。対象: 中綴じオンデマンドオールカラーセット
- **形式・PDF**: 受付形式: PSD / PNG / BMP / TIF。PDF規格: 未確認。PDF条件: 小説本文は全頁1PDF。通常漫画セットは本文PDF非推奨の受付欄あり（トーンのモアレ注意）、商品別表では本文小説のみ可ともあるため漫画PDFは条件確認が必要。表紙PDF対応商品あり。トンボ: CSPはトンボ出力。裁ち落としまで出力する場合は省略可。既存テンプレートでは二重追加しない。色: 通常カラーCMYK推奨、RGB可で変換。RGBビビッド等は別商品
- **トーン線数**: 60線以下推奨。トーン入りは600dpi指定。

未確認: PDF/X規格・TrimBox等の指定／漫画PDF受付条件の表内記述と非推奨受付欄の整合／全商品ごとのページ上下限

公式資料:

- [原稿の総合案内](https://www.orangekoubou.com/making/making.php)
- [CLIP STUDIO手順・線数](https://www.orangekoubou.com/making/making_clipstudiopaint.php)
- [ComicStudio手順](https://www.orangekoubou.com/making/making_comicstudio.php)
- [注文FAQ](https://www.orangekoubou.com/order/question.php)
- [入稿チェック](https://www.orangekoubou.com/order/check_order.php)
- [中綴じカラーセット](https://www.orangekoubou.com/booklet/set_silver_ss.php)

検索・確認範囲: オレンジ工房 塗り足し 解像度 / site:orangekoubou.com 4の倍数 / site:orangekoubou.com 2ページ単位 / 原稿共通・CSP・旧ComicStudioガイド・FAQ・中綴じ商品

### 22. 株式会社 BRO'S

対象: 株式会社ブロス / BRO'S。個別条件は各項目を参照

- **塗り足し**: 選択値mm: 3 / 5。位置付け: 表紙・本文とも指定。補足: 全辺裁ち切り無しなら原寸可、テンプレート優先
- **モノクロ2値**: 値: 600。位置付け: 推奨（単色表紙/本文）
- **グレー**: 値: 600。位置付け: 推奨（単色表紙/本文）
- **カラー**: 値: 350。位置付け: 推奨（フルカラー表紙）
- **ページ数**: 数え方: 通常セット表紙4P込み。本文印刷のみ商品は本文のみ。一般条件: 総頁偶数。中綴じ4の倍数。確認例: オンデマンド料金表は34Pを36P料金で受付する例を記載
- **形式・PDF**: 受付形式: EPS / PSD / TIFF / AI / PNG / JPEG / PDF。PDF規格: PDF/X-1a:2001（日本）推奨/Adobe設定指定。他変換ソフトはPDF/Aも可の案内あり。PDF詳細: 全画像ダウンサンプル無し・ZIP。フォント埋込。仕上がり中心とPDF中心を一致。トンボ: トンボ付きサイズ可。PDFで付ける場合は内外/センタートンボのみ、カラーバー・ページ情報なし。補足: 本文は単頁。ノンブル必須。表紙は単頁も見開きも可

未確認: カラー本文独立の解像度指定（350表紙から自動一般化しない）／全プランのページ上下限・用紙別中綴じ上限／1200dpi二値の受付可否

公式資料:

- [原稿の作成方法](https://bros-comic.co.jp/nyukou/manual/make_method.html)
- [PDF書き出し設定](https://www.bros-comic.co.jp/nyukou/manual/pdf_make.html)
- [公式総合マニュアル](https://www.bros-comic.co.jp/nyukou/download/bros_manual_web.pdf)
- [オンデマンド料金表・34P例](https://www.bros-comic.co.jp/ryokin/price/?st=ondema_set4c)
- [本文印刷のみ商品](https://bros-comic.co.jp/ryokin/ondemand/ondema_honbun.html)

検索・確認範囲: BRO'S 原稿 600 350 / site:bros-comic.co.jp ページ 倍数 / 公式原稿・PDFガイド・現マニュアル・料金表

### 23. 株式会社ホープツーワン

対象: 株式会社ホープツーワン。個別条件は各項目を参照

- **塗り足し**: 選択値mm: 3 / 5。位置付け: CSP/Photoshop案内指定。補足: セルフチェックは塗り足し0/3/5と余白有無を選択。0は裁ち切り無し等の条件を商品で確認
- **モノクロ2値**: 値: 600。位置付け: 推奨/単色本文指定。補足: 公式文中には『600dpi以上…遠慮』と600推奨が併記。600自体禁止と解釈せず高解像度回避の注意として保留
- **グレー**: 値: 600。位置付け: 推奨/単色本文指定
- **カラー**: 値: 350。位置付け: 推奨/カラー本文指定
- **ページ数**: 数え方: 表紙4P＋本文。中綴じ: ページ単位: 4。最小: 12。最大: 28。無線綴じ: ページ単位: 2。最小: 20。折本: ページ数: 8
- **形式・PDF**: 受付形式: PSD / TIFF / PDF / PNG / JPEG。対象: PSD/TIFFはPhotoshopガイド、PNG/JPEG/PDFはセット用セルフチェック対応一覧。PDF規格: 未確認。PDF詳細: フォント埋込、画像劣化/寸法を確認。Quartz書き出しPDF不具合注意。トンボ: 塗り足し外の余白ありデータにも対応するがPDFセルフプレビューは制約あり。プレビュー適正は原寸＋0/3/5mm。補足: CSP手順ではTIFFはモノクロ2階調のみと注記。総合受付形式だけで全色モードに適用しない。
- **トーン線数**: 60〜70線推奨。

未確認: PDF/X規格・TrimBox等の指定／全商品を横断した無線綴じ最大頁数／600dpi以上という文言の境界（表自体は600推奨）

公式資料:

- [CLIP STUDIO原稿条件](https://hope21.jp/creative-guide/clipstudio/)
- [Photoshop手順](https://hope21.jp/creative-guide/photoshop/)
- [PDF手順](https://hope21.jp/creative-guide/pdf/)
- [セルフチェックの対応条件](https://hope21.jp/guide/manuscript-preview/)

検索・確認範囲: ホープツーワン 原稿 解像度 塗り足し / site:hope21.jp ページ数 倍数 / 公式CSP・Photoshop・PDF・セルフチェック案内

### 24. EditNetプリンテック

対象: EditNet Printeq / EditNetプリンテック。個別条件は各項目を参照

- **塗り足し**: 最低mm: 3。位置付け: 通常データ原稿は各辺3mm以上均等。表紙も3mm案内。補足: DIYコピーは別（本文原寸・縁5〜7mm印刷不可、表紙3mm）。標準A5幅148.5/B6幅128.5と記載あり、他社の148/128に一律統合しない
- **モノクロ2値**: 推奨範囲: 600〜1800。孔版dpi: 600。位置付け: 適切な解像度の案内
- **グレー**: 推奨範囲: 350〜600。位置付け: 適切な解像度の案内
- **カラー**: 値: 350。位置付け: 現HTMLの適切な解像度案内。補足: 古い料金PDFには350〜600記載あり。現HTML350を採用
- **ページ数**: 数え方: 表紙込み（公式トップ見積と旧冊子）。ページ単位: 未確認。旧資料: 2018掲載版マニュアルの無線綴じ台割は4の倍数。現行全商品に一律適用できる根拠は未確認
- **形式・PDF**: 受付形式: EPS（通常推奨） / PDF（用途別確認）。PDF規格: 未確認。対象: 通常総合形式ページ取得不能。旧公式マニュアルはEPS/PS/PDF、現オンデマンド2色はEPS/PDF、白版はEPS/PSD又は特色PDF。DIYはPDF。トンボ: Photoshopデータは不要。Illustratorでは周囲トンボで中心を明示

未確認: 通常全商品共通の最新形式一覧（d1.phtml取得不能）／通常PSD/TIFFの受付可否（白版以外へ一般化不可）／PDF/X規格・TrimBox等の指定／現行商品別ページ倍数/上下限。旧無線台割は4倍数だが時点/商品範囲を確認できず

公式資料:

- [本文寸法・トンボ](https://www.editnet-p.jp/howtodraw/data/d2.phtml)
- [表紙寸法・背幅](https://www.editnet-p.jp/howtodraw/data/d3.phtml)
- [色別解像度](https://www.editnet-p.jp/howtodraw/data/d4.phtml)
- [2018年版公式資料（旧条件）](https://www.editnet-p.jp/services/downloads/180816-printeq-962e-b.pdf)
- [特殊印刷のデータ条件](https://www.editnet-p.jp/howtodraw/data/d10.phtml)
- [特殊印刷のデータ条件](https://www.editnet-p.jp/howtodraw/data/d11.phtml)
- [DIYコピー専用条件](https://www.editnet-p.jp/diy/diydata.phtml)

検索・確認範囲: EditNet プリンテック 原稿 解像度 塗り足し / site:editnet-p.jp/howtodraw/data/ ファイル形式 / site:editnet-p.jp ページ数 倍数 / 現HTML d2/d3/d4/d10/d11、公式旧マニュアル、DIYを別枠調査。d1.phtmlと目次本文の取得失敗

## にゃムルへ反映する順序

1. 原稿設定で「用途」「仕上がり/キャンバス寸法」「単位」「表現色」「解像度」を分ける。漫画は仕上がり＋塗り足しを明示し、カラーは350dpiを基本候補にする。独自判型も実寸で保存する。
2. PNG/PSD配置は原本を保持し、保存・差し替え・実効解像度確認を先に整える。作画トーンは60lpiを初期値とし、既存画像に網点の再処理をしない。
3. 出力は確認PDF・家庭印刷・入稿画像/PDFを分ける。一般PDFの完成を全印刷所対応と呼ばない。漫画PDFが非推奨/対象外の入稿経路では統合画像を選べることが必要。
4. プリセットは会社・商品・印刷方式・製本・本文/表紙・入稿経路・確認日・出典を持つ。未確認条件は未確認のまま表示し、推奨と必須を別にする。選択した商品で確認できた条件から検査を有効にする。
5. 本文ページと表紙を区別し、扉/白紙等を本文内の役割として扱う。口絵や印刷された遊び紙の数え方は会社ごとに変える。価格表の段階と実際に受理されるページ数を別管理する。

詳細な実装段階と受け入れ条件は[外部画像・印刷・PDF整備計画](IMAGE_PLACEMENT_PRINT_EXPORT_PLAN.md)を参照。調査データは[JSON](research/printer-requirements-2026-09-25.json)にも保存した。これは参照資料であり、アプリが自動適用するプリセットではない。

検証範囲: 24社の一覧漏れ・重複、JSON構文、資料リンクの記録、寸法換算と仕様の読み分けを確認。アプリ変更・実ファイル出力・入稿確認は実施していない。
