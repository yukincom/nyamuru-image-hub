# ニャムル音声意図分類：誤分類一覧

devは設定選択に使用。trainは学習例への適合確認。信頼度は未校正のsoftmax値。

## test：13 / 73件

### nyamuru_voice_2778

- 発話: しっぽを消して、いや、選択中の吹き出しはしっぽありにして。
- 正解: `bubble_set`
- 予測: `compound_request`（76.1%）

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

### nyamuru_voice_2840

- 発話: この吹き出しの文字、今日は妙に大きく見えるな。
- 正解: `not_command`
- 予測: `needs_reasoning`（92.5%）

### nyamuru_voice_3204

- 発話: 最後にやったのは文字の移動で、その前が線を一本描く編集。この二つをまとめてUndoして。
- 正解: `undo`
- 予測: `compound_request`（88.3%）

### nyamuru_voice_3228

- 発話: これ、広すぎるな。選択中の吹き出しの幅を少し詰めてもらえる？
- 正解: `needs_clarification`
- 予測: `bubble_set`（92.8%）

### nyamuru_voice_3239

- 発話: 内枠スナップとコマスナップ、両方オンでお願い。あ、今の訂正はコマスナップだけ、そっちはオフにして。
- 正解: `compound_request`
- 予測: `panel_gap_snap_set`（74.9%）

### nyamuru_voice_3241

- 発話: 最終ページの次に、白紙を一枚足したい。そのページを追加してもらえる？
- 正解: `out_of_scope_request`
- 予測: `compound_request`（53.9%）

### nyamuru_voice_3242

- 発話: この作品を複製したファイルが欲しい。名前は「寄り道メモ」にして、別名保存で作って。
- 正解: `out_of_scope_request`
- 予測: `save`（92.7%）

### nyamuru_voice_3247

- 発話: 次のページへ行くつもりだったけど、もう少しここを見てる。
- 正解: `not_command`
- 予測: `needs_clarification`（99.2%）

### nyamuru_voice_3304

- 発話: 選択中の吹き出しの大きさ、縦も横も今よりちょっと控えめにしてくれる？
- 正解: `needs_clarification`
- 予測: `compound_request`（99.6%）

### nyamuru_voice_3305

- 発話: ガイドの表示をオフにして。種類の名前が思い出せないけど。
- 正解: `needs_clarification`
- 予測: `view_change`（100.0%）

