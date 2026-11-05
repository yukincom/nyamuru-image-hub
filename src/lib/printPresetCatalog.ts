import type { PrinterPreset } from './printerPresets.ts';

export const PRINTER_PRESETS: readonly PrinterPreset[] = [
  {
    "name": "緑陽社",
    "bleedMm": 3,
    "bodyDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "coverDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "checkedAt": "2026-09-25",
    "sources": [
      "https://www.ryokuyou.co.jp/doujin/manual/photoshop.html",
      "https://www.ryokuyou.co.jp/doujin/manual/printwords.html",
      "https://www.ryokuyou.co.jp/doujin/manual/affinity.html?am_force_theme_layout=mobile",
      "https://www.ryokuyou.co.jp/doujin/manual/indesign.html",
      "https://www.ryokuyou.co.jp/doujin/downloads/item/order_m03.pdf"
    ]
  },
  {
    "name": "日光企画",
    "bleedMm": 3,
    "bodyDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "coverDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "checkedAt": "2026-09-25",
    "sources": [
      "https://www.nikko-pc.com/site/home-hd-2/home-qa/"
    ]
  },
  {
    "name": "サンライズ",
    "bleedMm": 5,
    "bodyDpi": {"モノクロ漫画": 1200, "グレースケール漫画": 600, "カラー漫画": 350},
    "coverDpi": {"モノクロ漫画": 1200, "グレースケール漫画": 600, "カラー漫画": 350},
    "checkedAt": "2026-09-25",
    "sources": [
      "https://www.sunrisep.co.jp/guide/faq/",
      "https://www.sunrisep.co.jp/genkou/create-photoshop/",
      "https://www.sunrisep.co.jp/wp/wp-content/uploads/2023/10/04_ALL_kaizodo_2chi.png",
      "https://www.sunrisep.co.jp/wp/wp-content/uploads/2023/10/04_ALL_kaizodo_gray.png",
      "https://www.sunrisep.co.jp/wp/wp-content/uploads/2023/10/04_ALL_kaizodo_cmyk_rgb.jpg",
      "https://www.sunrisep.co.jp/genkou/create-pdf/",
      "https://www.sunrisep.co.jp/genkou/glossary/",
      "https://www.sunrisep.co.jp/book/pera/",
      "https://www.sunrisep.co.jp/column/recommended-booklets-of-saddle-stitch-printer.html"
    ],
    "note": "通常原稿の推奨値。オンデマンド本文モアレ軽減モードの600dpi指定は商品別に調整する。"
  },
  {
    "name": "くりえい社",
    "bleedMm": 5,
    "bodyDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "coverDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "checkedAt": "2026-09-25",
    "sources": [
      "https://www.kurieisha.co.jp/faq/",
      "https://www.kurieisha.co.jp/menu/allfullcolorondemand/"
    ],
    "note": "グレー独立推奨は未確認。モノクロ表紙・本文600〜1200ppiの包括案内から600を初期値にする。"
  },
  {
    "name": "コーシン出版",
    "bleedMm": 3,
    "bodyDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "coverDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "checkedAt": "2026-09-25",
    "sources": [
      "https://www.ko-sin.co.jp/syindex/qa",
      "https://www.ko-sin.co.jp/syindex/set-p",
      "https://www.ko-sin.co.jp/syindex/wp-content/uploads/HOW-TO_ANALOG_D_kosin_140529.pdf",
      "https://www.ko-sin.co.jp/syindex/wp-content/uploads/HOW-TO_DATA_D_kosin_190305.pdf",
      "https://www.ko-sin.co.jp/syindex/qa/2071",
      "https://www.ko-sin.co.jp/syindex/yougo_gen2"
    ]
  },
  {
    "name": "ねこのしっぽ",
    "bleedMm": 3,
    "bodyDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "coverDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "checkedAt": "2026-09-25",
    "sources": [
      "https://www.shippo.co.jp/neko/making/digital.shtml",
      "https://www.shippo.co.jp/neko/faq_2.shtml",
      "https://www.shippo.co.jp/neko/making/word2pdf.shtml"
    ]
  },
  {
    "name": "金沢印刷",
    "bleedMm": 3,
    "bodyDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "coverDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "checkedAt": "2026-09-25",
    "sources": [
      "https://www.kanazawa-p.co.jp/howtodata/kaizoudo.html",
      "https://www.kanazawa-p.co.jp/genkousakusei/hyoushi.html",
      "https://www.kanazawa-p.co.jp/making/sakusei.html",
      "https://www.kanazawa-p.co.jp/howtodata/pdf_kakidasi.html",
      "https://www.kanazawa-p.co.jp/howtodata/howtodata_media.html",
      "https://www.kanazawa-p.co.jp/qanda/question.html",
      "https://www.kanazawa-p.co.jp/howtodata/checksheet.html"
    ]
  },
  {
    "name": "栄光",
    "bleedMm": 3,
    "bodyDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "coverDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "checkedAt": "2026-09-25",
    "sources": [
      "https://www.eikou.com/making/other/",
      "https://www.eikou.com/selfcheck/fileup-btn/",
      "https://www.eikou.com/making/printglossary/totalpage/",
      "https://eikou.com/commodity/watoji-off/",
      "https://www.eikou.com/making/indesign/",
      "https://www.eikou.com/selfcheck/file/",
      "https://www.eikou.com/dl/guide/honbun_guide.pdf"
    ]
  },
  {
    "name": "シメケン",
    "bleedMm": 3,
    "bodyDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "coverDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "checkedAt": "2026-09-25",
    "sources": [
      "https://shimeken.com/print/make-manuscript/size",
      "https://shimeken.com/print/make-manuscript/file",
      "https://shimeken.com/print/make-manuscript/page"
    ],
    "note": "色別推奨は未確認。総合候補300/350/600dpiからモノクロ・グレー600、カラー350を初期値にする。"
  },
  {
    "name": "しまや出版",
    "bleedMm": 3,
    "bodyDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "coverDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "checkedAt": "2026-09-25",
    "sources": [
      "https://www.shimaya.net/howto/ps.html",
      "https://www.shimaya.net/howto/medibang.html",
      "https://www.shimaya.net/howto/clipstudio.html",
      "https://www.shimaya.net/howto/pdf.html",
      "https://www.shimaya.net/fair/bungou/bungou.html"
    ]
  },
  {
    "name": "大陽出版",
    "bleedMm": 3,
    "bodyDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "coverDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "checkedAt": "2026-09-25",
    "sources": [
      "https://www.taiyoushuppan.co.jp/doujin/howto/data.php",
      "https://www.taiyoushuppan.co.jp/doujin/howto/clipstudiopro.php",
      "https://www.taiyoushuppan.co.jp/doujin/howto/vocabulary02.php",
      "https://www.taiyoushuppan.co.jp/doujin/product/set/option/503-stapler.php",
      "https://www.taiyoushuppan.co.jp/doujin/howto/body-data-color.php"
    ]
  },
  {
    "name": "ポプルス",
    "bleedMm": 3,
    "bodyDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "coverDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "checkedAt": "2026-09-25",
    "sources": [
      "https://www2.popls.co.jp/pop/genkou/kihon.html",
      "https://www2.popls.co.jp/pop/genkou/saigo.html",
      "https://www2.popls.co.jp/pop/book/standard.html"
    ]
  },
  {
    "name": "関西美術印刷",
    "bleedMm": 3,
    "bodyDpi": {"モノクロ漫画": 600, "グレースケール漫画": 350, "カラー漫画": 350},
    "coverDpi": {"モノクロ漫画": 600, "グレースケール漫画": 350, "カラー漫画": 350},
    "checkedAt": "2026-09-25",
    "sources": [
      "https://comic.kanbi-comic.com/guide/making/data/",
      "https://kanbi-comic.com/guide/order/base/",
      "https://comic.kanbi-comic.com/data-guide/making/basic/",
      "https://kanbi-comic.com/guide/order/pdf/",
      "https://comic.kanbi-comic.com/data-guide/making/"
    ]
  },
  {
    "name": "PICO",
    "bleedMm": 3,
    "bodyDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "coverDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "checkedAt": "2026-09-25",
    "sources": [
      "https://www.pico-net.com/doujinshi/doujinshi_manual/flow/manual.html",
      "https://www.pico-net.com/doujinshi/download/pdata/pico_dataseat_hyoushi.pdf",
      "https://www.pico-net.com/doujinshi/doujinshi_manual/letterbody/006.html",
      "https://www.pico-net.com/doujinshi/doujinshi_manual/letterbody/013.html",
      "https://www.pico-net.com/doujinshi/doujinshi_manual/word/010.html",
      "https://www.pico-net.com/doujinshi/service/doujin_print/offset/003.html"
    ]
  },
  {
    "name": "pixivFACTORY",
    "bleedMm": 3,
    "bodyDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "coverDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "checkedAt": "2026-09-25",
    "sources": [
      "https://factory-books.pixiv.help/hc/ja/articles/115002154453-どのようなデータを受け付けていますか",
      "https://factory-books.pixiv.help/hc/ja/articles/115002149394-本文のつくり方-サイズについて教えてください",
      "https://factory-books.pixiv.help/hc/ja/articles/360014206613-エラーが出て原稿を入稿できません",
      "https://factory-books.pixiv.help/hc/ja/articles/360000289421-ページ数は表紙の分を含みますか",
      "https://factory-books.pixiv.help/hc/ja/articles/115002018074-注文から発送までの流れを教えてください"
    ]
  },
  {
    "name": "プリントオン",
    "bleedMm": 3,
    "bodyDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "coverDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "checkedAt": "2026-09-25",
    "sources": [
      "https://www.print-on.jp/doujin/company/kisochishiki/tonbo_nuritashi.html",
      "https://www.print-on.jp/doujin/company/kisochishiki/grayscale_monochrome.html",
      "https://www.print-on.jp/doujin/comic/price/honbun_template_matome/honbun_template_mokuji_mokomoko.htm",
      "https://www.print-on.jp/doujin/company/order/deta.htm",
      "https://www.print-on.jp/doujin/company/order/deta_indesing.htm",
      "https://www.print-on.jp/doujin/company/order/manual/word.htm",
      "https://www.print-on.jp/doujin/company/kisochishiki/pages.html",
      "https://www.print-on.jp/doujin/comic/price/wakuwaku_design_price.htm"
    ]
  },
  {
    "name": "アクシス",
    "bleedMm": 3,
    "bodyDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "coverDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "checkedAt": "2026-09-25",
    "sources": [
      "https://axis-publication.com/gochumon/sakusei/",
      "https://axis-publication.com/gochumon/sakusei/clip.html",
      "https://www.axis-publication.com/set/fullcolor/ryoukin_A5.html?no=0",
      "https://axis-publication.com/gochumon/chumonsyo/img/order_dojinshi.pdf"
    ],
    "note": "グレー350/600のうち600を採用し、A6未満の600推奨にも合わせる。"
  },
  {
    "name": "サングループ",
    "bleedMm": 4,
    "bodyDpi": {"モノクロ漫画": 600, "グレースケール漫画": 350, "カラー漫画": 350},
    "coverDpi": {"モノクロ漫画": 600, "グレースケール漫画": 350, "カラー漫画": 350},
    "checkedAt": "2026-09-25",
    "sources": [
      "https://sungroup.co.jp/faq/",
      "https://sungroup.co.jp/print-menu/",
      "https://sungroup.co.jp/template/"
    ]
  },
  {
    "name": "ブックネクスト",
    "bleedMm": 3,
    "bodyDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "coverDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "checkedAt": "2026-09-25",
    "sources": [
      "https://booknext.ink/guide/application/",
      "https://booknext.ink/news/20211126versionup/",
      "https://booknext.ink/download/photoshop/",
      "https://booknext.ink/qa/本文の解像度が「300dpi」でも入稿できますか？/",
      "https://booknext.ink/qa/料金表にないページ数の注文は可能ですか？/",
      "https://booknext.ink/guide/paper/"
    ]
  },
  {
    "name": "テイズプリント",
    "bleedMm": 3,
    "bodyDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "coverDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "checkedAt": "2026-09-25",
    "sources": [
      "https://www.teis-p.com/html/manual.html",
      "https://www.teis-p.com/category/548.html",
      "https://www.teis-p.com/category/38890.html"
    ]
  },
  {
    "name": "オレンジ工房.com",
    "bleedMm": 5,
    "bodyDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "coverDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "checkedAt": "2026-09-25",
    "sources": [
      "https://www.orangekoubou.com/making/making.php",
      "https://www.orangekoubou.com/making/making_clipstudiopaint.php",
      "https://www.orangekoubou.com/making/making_comicstudio.php",
      "https://www.orangekoubou.com/order/question.php",
      "https://www.orangekoubou.com/order/check_order.php",
      "https://www.orangekoubou.com/booklet/set_silver_ss.php"
    ]
  },
  {
    "name": "株式会社 BRO'S",
    "bleedMm": 3,
    "bodyDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600},
    "coverDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "checkedAt": "2026-09-25",
    "sources": [
      "https://bros-comic.co.jp/nyukou/manual/make_method.html",
      "https://www.bros-comic.co.jp/nyukou/manual/pdf_make.html",
      "https://www.bros-comic.co.jp/nyukou/download/bros_manual_web.pdf",
      "https://www.bros-comic.co.jp/ryokin/price/?st=ondema_set4c",
      "https://bros-comic.co.jp/ryokin/ondemand/ondema_honbun.html"
    ],
    "note": "350dpiの確認範囲はカラー表紙。カラー本文の解像度は変更しない。"
  },
  {
    "name": "株式会社ホープツーワン",
    "bleedMm": 3,
    "bodyDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "coverDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "checkedAt": "2026-09-25",
    "sources": [
      "https://hope21.jp/creative-guide/clipstudio/",
      "https://hope21.jp/creative-guide/photoshop/",
      "https://hope21.jp/creative-guide/pdf/",
      "https://hope21.jp/guide/manuscript-preview/"
    ]
  },
  {
    "name": "EditNetプリンテック",
    "bleedMm": 3,
    "bodyDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "coverDpi": {"モノクロ漫画": 600, "グレースケール漫画": 600, "カラー漫画": 350},
    "paperOverrides": {"A5": {"width": 148.5, "height": 210}, "B6": {"width": 128.5, "height": 182}},
    "checkedAt": "2026-09-25",
    "sources": [
      "https://www.editnet-p.jp/howtodraw/data/d2.phtml",
      "https://www.editnet-p.jp/howtodraw/data/d3.phtml",
      "https://www.editnet-p.jp/howtodraw/data/d4.phtml",
      "https://www.editnet-p.jp/services/downloads/180816-printeq-962e-b.pdf",
      "https://www.editnet-p.jp/howtodraw/data/d10.phtml",
      "https://www.editnet-p.jp/howtodraw/data/d11.phtml",
      "https://www.editnet-p.jp/diy/diydata.phtml"
    ],
    "note": "通常冊子の実寸。DIYコピーは対象外。グレー350〜600のうち600を採用。"
  }
];
