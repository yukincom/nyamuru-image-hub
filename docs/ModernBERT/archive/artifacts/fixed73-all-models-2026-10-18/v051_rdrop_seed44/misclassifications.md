# ニャムル音声意図分類：誤分類一覧

devは設定選択に使用。trainは学習例への適合確認。信頼度は未校正のsoftmax値。

## test：15 / 73件

### nyamuru_voice_2823

- 発話: ページの順番を間違えた。三ページ目を一ページ目の前へ移して。
- 正解: `out_of_scope_request`
- 予測: `page_navigate`（100.0%）

### nyamuru_voice_2836

- 発話: 次の休憩前に作品を保存するつもり。
- 正解: `not_command`
- 予測: `save`（100.0%）

### nyamuru_voice_3203

- 発話: いま保存を押してほしい。保存先や作品名は、この作品のままでいい。
- 正解: `save`
- 予測: `not_command`（99.6%）

### nyamuru_voice_3204

- 発話: 最後にやったのは文字の移動で、その前が線を一本描く編集。この二つをまとめてUndoして。
- 正解: `undo`
- 予測: `text_frames_align`（92.5%）

### nyamuru_voice_3211

- 発話: Redoをお願いします。回数の指定を先に言い忘れたけど、一回です。
- 正解: `redo`
- 予測: `undo`（50.3%）

### nyamuru_voice_3219

- 発話: どのタブか、名前を言うね。「小道具」。そこを開いて。
- 正解: `view_change`
- 予測: `bubble_set`（100.0%）

### nyamuru_voice_3228

- 発話: これ、広すぎるな。選択中の吹き出しの幅を少し詰めてもらえる？
- 正解: `needs_clarification`
- 予測: `needs_reasoning`（100.0%）

### nyamuru_voice_3237

- 発話: このページ全体を生成してほしい。あ、それとは別に、作業中の作品の保存も今お願い。
- 正解: `compound_request`
- 予測: `save`（63.9%）

### nyamuru_voice_3239

- 発話: 内枠スナップとコマスナップ、両方オンでお願い。あ、今の訂正はコマスナップだけ、そっちはオフにして。
- 正解: `compound_request`
- 予測: `panel_gap_snap_set`（65.6%）

### nyamuru_voice_3241

- 発話: 最終ページの次に、白紙を一枚足したい。そのページを追加してもらえる？
- 正解: `out_of_scope_request`
- 予測: `page_navigate`（78.2%）

### nyamuru_voice_3242

- 発話: この作品を複製したファイルが欲しい。名前は「寄り道メモ」にして、別名保存で作って。
- 正解: `out_of_scope_request`
- 予測: `compound_request`（100.0%）

### nyamuru_voice_3247

- 発話: 次のページへ行くつもりだったけど、もう少しここを見てる。
- 正解: `not_command`
- 予測: `needs_clarification`（98.7%）

### nyamuru_voice_3304

- 発話: 選択中の吹き出しの大きさ、縦も横も今よりちょっと控えめにしてくれる？
- 正解: `needs_clarification`
- 予測: `bubble_set`（95.7%）

### nyamuru_voice_3305

- 発話: ガイドの表示をオフにして。種類の名前が思い出せないけど。
- 正解: `needs_clarification`
- 予測: `not_command`（100.0%）

### nyamuru_voice_3308

- 発話: 「コマスナップ」と書かれた設定があるね。そこを有効にして。
- 正解: `panel_gap_snap_set`
- 予測: `inner_frame_snap_set`（98.8%）

