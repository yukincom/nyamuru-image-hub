# ニャムル音声意図分類：誤分類一覧

devは設定選択に使用。trainは学習例への適合確認。信頼度は未校正のsoftmax値。

## test：17 / 73件

### nyamuru_voice_2723

- 発話: Undoを一回お願い。繰り返すけど、取り消しは一回だけ。
- 正解: `undo`
- 予測: `redo`（87.5%）

### nyamuru_voice_2779

- 発話: 選択中の吹き出しをコマで切り取らない設定にして。念押しだけど、切取りはオフ。
- 正解: `bubble_set`
- 予測: `panel_sync_set`（55.2%）

### nyamuru_voice_2800

- 発話: 次に読者を驚かせたい。今のページをどう見せると効果的か考えて。
- 正解: `needs_reasoning`
- 予測: `not_command`（99.7%）

### nyamuru_voice_2815

- 発話: 選択中の吹き出しの本文は変えず、しっぽを消して所属を二番のコマにして。
- 正解: `compound_request`
- 予測: `bubble_set`（100.0%）

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
- 予測: `not_command`（100.0%）

### nyamuru_voice_3204

- 発話: 最後にやったのは文字の移動で、その前が線を一本描く編集。この二つをまとめてUndoして。
- 正解: `undo`
- 予測: `compound_request`（98.8%）

### nyamuru_voice_3217

- 発話: 見開きって左右を並べる表示のことだよね。それを今、オンにしてほしい。
- 正解: `view_change`
- 予測: `text_frames_align`（97.2%）

### nyamuru_voice_3219

- 発話: どのタブか、名前を言うね。「小道具」。そこを開いて。
- 正解: `view_change`
- 予測: `bubble_set`（100.0%）

### nyamuru_voice_3228

- 発話: これ、広すぎるな。選択中の吹き出しの幅を少し詰めてもらえる？
- 正解: `needs_clarification`
- 予測: `needs_reasoning`（99.7%）

### nyamuru_voice_3231

- 発話: 選択中の吹き出し、話者の名前が今の人じゃないんだよね。別の人に直して。
- 正解: `needs_clarification`
- 予測: `bubble_set`（60.4%）

### nyamuru_voice_3241

- 発話: 最終ページの次に、白紙を一枚足したい。そのページを追加してもらえる？
- 正解: `out_of_scope_request`
- 予測: `compound_request`（100.0%）

### nyamuru_voice_3242

- 発話: この作品を複製したファイルが欲しい。名前は「寄り道メモ」にして、別名保存で作って。
- 正解: `out_of_scope_request`
- 予測: `compound_request`（100.0%）

### nyamuru_voice_3261

- 発話: 三番のコマの、美月さん。名前を指定したその人物だけを生成して、同じページの別の登場人物には広げないで。
- 正解: `generate_request`
- 予測: `not_command`（68.1%）

### nyamuru_voice_3304

- 発話: 選択中の吹き出しの大きさ、縦も横も今よりちょっと控えめにしてくれる？
- 正解: `needs_clarification`
- 予測: `compound_request`（97.2%）

### nyamuru_voice_3305

- 発話: ガイドの表示をオフにして。種類の名前が思い出せないけど。
- 正解: `needs_clarification`
- 予測: `not_command`（100.0%）

