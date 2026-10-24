# ニャムル音声意図分類：誤分類一覧

devは設定選択に使用。trainは学習例への適合確認。信頼度は未校正のsoftmax値。

## test：19 / 73件

### nyamuru_voice_2779

- 発話: 選択中の吹き出しをコマで切り取らない設定にして。念押しだけど、切取りはオフ。
- 正解: `bubble_set`
- 予測: `text_frames_align`（85.6%）

### nyamuru_voice_2815

- 発話: 選択中の吹き出しの本文は変えず、しっぽを消して所属を二番のコマにして。
- 正解: `compound_request`
- 予測: `bubble_set`（99.9%）

### nyamuru_voice_2823

- 発話: ページの順番を間違えた。三ページ目を一ページ目の前へ移して。
- 正解: `out_of_scope_request`
- 予測: `page_navigate`（100.0%）

### nyamuru_voice_2826

- 発話: 背景の候補提示はやめて、外部サイトで教室の3Dモデルを検索して。
- 正解: `out_of_scope_request`
- 予測: `background_3d_candidates`（99.9%）

### nyamuru_voice_2836

- 発話: 次の休憩前に作品を保存するつもり。
- 正解: `not_command`
- 予測: `save`（100.0%）

### nyamuru_voice_2840

- 発話: この吹き出しの文字、今日は妙に大きく見えるな。
- 正解: `not_command`
- 予測: `view_change`（96.3%）

### nyamuru_voice_3217

- 発話: 見開きって左右を並べる表示のことだよね。それを今、オンにしてほしい。
- 正解: `view_change`
- 予測: `save`（52.4%）

### nyamuru_voice_3219

- 発話: どのタブか、名前を言うね。「小道具」。そこを開いて。
- 正解: `view_change`
- 予測: `page_navigate`（100.0%）

### nyamuru_voice_3228

- 発話: これ、広すぎるな。選択中の吹き出しの幅を少し詰めてもらえる？
- 正解: `needs_clarification`
- 予測: `bubble_set`（99.8%）

### nyamuru_voice_3231

- 発話: 選択中の吹き出し、話者の名前が今の人じゃないんだよね。別の人に直して。
- 正解: `needs_clarification`
- 予測: `bubble_set`（99.9%）

### nyamuru_voice_3235

- 発話: 「大きくすれば読みやすい」とは限らないと思う。選択中の吹き出しは、文章量と絵の余白を見て、ちょうどいい寸法を提案して。
- 正解: `needs_reasoning`
- 予測: `bubble_set`（85.9%）

### nyamuru_voice_3237

- 発話: このページ全体を生成してほしい。あ、それとは別に、作業中の作品の保存も今お願い。
- 正解: `compound_request`
- 予測: `save`（100.0%）

### nyamuru_voice_3239

- 発話: 内枠スナップとコマスナップ、両方オンでお願い。あ、今の訂正はコマスナップだけ、そっちはオフにして。
- 正解: `compound_request`
- 予測: `inner_frame_snap_set`（92.1%）

### nyamuru_voice_3241

- 発話: 最終ページの次に、白紙を一枚足したい。そのページを追加してもらえる？
- 正解: `out_of_scope_request`
- 予測: `page_navigate`（100.0%）

### nyamuru_voice_3242

- 発話: この作品を複製したファイルが欲しい。名前は「寄り道メモ」にして、別名保存で作って。
- 正解: `out_of_scope_request`
- 予測: `save`（100.0%）

### nyamuru_voice_3247

- 発話: 次のページへ行くつもりだったけど、もう少しここを見てる。
- 正解: `not_command`
- 予測: `page_navigate`（99.7%）

### nyamuru_voice_3261

- 発話: 三番のコマの、美月さん。名前を指定したその人物だけを生成して、同じページの別の登場人物には広げないで。
- 正解: `generate_request`
- 予測: `compound_request`（69.7%）

### nyamuru_voice_3304

- 発話: 選択中の吹き出しの大きさ、縦も横も今よりちょっと控えめにしてくれる？
- 正解: `needs_clarification`
- 予測: `out_of_scope_request`（48.4%）

### nyamuru_voice_3305

- 発話: ガイドの表示をオフにして。種類の名前が思い出せないけど。
- 正解: `needs_clarification`
- 予測: `view_change`（100.0%）

