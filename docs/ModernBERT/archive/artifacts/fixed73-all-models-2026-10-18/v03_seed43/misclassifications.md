# ニャムル音声意図分類：誤分類一覧

devは設定選択に使用。trainは学習例への適合確認。信頼度は未校正のsoftmax値。

## test：18 / 73件

### nyamuru_voice_2753

- 発話: 絵の寸法は変えず、表示を原寸にして。
- 正解: `view_change`
- 予測: `out_of_scope_request`（35.0%）

### nyamuru_voice_2800

- 発話: 次に読者を驚かせたい。今のページをどう見せると効果的か考えて。
- 正解: `needs_reasoning`
- 予測: `not_command`（100.0%）

### nyamuru_voice_2815

- 発話: 選択中の吹き出しの本文は変えず、しっぽを消して所属を二番のコマにして。
- 正解: `compound_request`
- 予測: `bubble_set`（100.0%）

### nyamuru_voice_2823

- 発話: ページの順番を間違えた。三ページ目を一ページ目の前へ移して。
- 正解: `out_of_scope_request`
- 予測: `page_navigate`（100.0%）

### nyamuru_voice_2826

- 発話: 背景の候補提示はやめて、外部サイトで教室の3Dモデルを検索して。
- 正解: `out_of_scope_request`
- 予測: `background_3d_candidates`（100.0%）

### nyamuru_voice_2836

- 発話: 次の休憩前に作品を保存するつもり。
- 正解: `not_command`
- 予測: `save`（100.0%）

### nyamuru_voice_3203

- 発話: いま保存を押してほしい。保存先や作品名は、この作品のままでいい。
- 正解: `save`
- 予測: `not_command`（99.9%）

### nyamuru_voice_3215

- 発話: この作品はどこで終わるか見たい。途中のページは開かなくていいから、最終ページを見せて。
- 正解: `page_navigate`
- 予測: `not_command`（100.0%）

### nyamuru_voice_3217

- 発話: 見開きって左右を並べる表示のことだよね。それを今、オンにしてほしい。
- 正解: `view_change`
- 予測: `inner_frame_snap_set`（88.2%）

### nyamuru_voice_3219

- 発話: どのタブか、名前を言うね。「小道具」。そこを開いて。
- 正解: `view_change`
- 予測: `page_navigate`（98.9%）

### nyamuru_voice_3228

- 発話: これ、広すぎるな。選択中の吹き出しの幅を少し詰めてもらえる？
- 正解: `needs_clarification`
- 予測: `bubble_set`（51.5%）

### nyamuru_voice_3237

- 発話: このページ全体を生成してほしい。あ、それとは別に、作業中の作品の保存も今お願い。
- 正解: `compound_request`
- 予測: `save`（100.0%）

### nyamuru_voice_3239

- 発話: 内枠スナップとコマスナップ、両方オンでお願い。あ、今の訂正はコマスナップだけ、そっちはオフにして。
- 正解: `compound_request`
- 予測: `inner_frame_snap_set`（100.0%）

### nyamuru_voice_3242

- 発話: この作品を複製したファイルが欲しい。名前は「寄り道メモ」にして、別名保存で作って。
- 正解: `out_of_scope_request`
- 予測: `save`（100.0%）

### nyamuru_voice_3255

- 発話: コマスナップは触らなくていいよ。オフにしてほしいのは内枠スナップのほう。
- 正解: `inner_frame_snap_set`
- 予測: `panel_gap_snap_set`（100.0%）

### nyamuru_voice_3273

- 発話: 文字枠を二つ選んであるよ。揃える基準は上側、下端や中央ではなく上端でお願い。
- 正解: `text_frames_align`
- 予測: `needs_clarification`（74.7%）

### nyamuru_voice_3304

- 発話: 選択中の吹き出しの大きさ、縦も横も今よりちょっと控えめにしてくれる？
- 正解: `needs_clarification`
- 予測: `needs_reasoning`（99.7%）

### nyamuru_voice_3305

- 発話: ガイドの表示をオフにして。種類の名前が思い出せないけど。
- 正解: `needs_clarification`
- 予測: `view_change`（93.5%）

