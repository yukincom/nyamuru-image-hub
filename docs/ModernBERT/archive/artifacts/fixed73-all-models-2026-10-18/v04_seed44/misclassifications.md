# ニャムル音声意図分類：誤分類一覧

devは設定選択に使用。trainは学習例への適合確認。信頼度は未校正のsoftmax値。

## test：14 / 73件

### nyamuru_voice_2755

- 発話: 作画ガイドを消して。もう一度言うね、作画ガイドは非表示で。
- 正解: `view_change`
- 予測: `compound_request`（82.3%）

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

### nyamuru_voice_2840

- 発話: この吹き出しの文字、今日は妙に大きく見えるな。
- 正解: `not_command`
- 予測: `needs_reasoning`（99.9%）

### nyamuru_voice_3201

- 発話: 保存って言ったのはコピーを作る話じゃなくて、今の作品に変更を残すほう。それを実行して。
- 正解: `save`
- 予測: `generate_request`（98.5%）

### nyamuru_voice_3205

- 発話: たった今動かした吹き出し、動かす前の状態に戻せる？　新しく動かすんじゃなくて、履歴を一つ戻してほしい。
- 正解: `undo`
- 予測: `needs_clarification`（91.0%）

### nyamuru_voice_3219

- 発話: どのタブか、名前を言うね。「小道具」。そこを開いて。
- 正解: `view_change`
- 予測: `needs_clarification`（99.9%）

### nyamuru_voice_3228

- 発話: これ、広すぎるな。選択中の吹き出しの幅を少し詰めてもらえる？
- 正解: `needs_clarification`
- 予測: `needs_reasoning`（98.7%）

### nyamuru_voice_3241

- 発話: 最終ページの次に、白紙を一枚足したい。そのページを追加してもらえる？
- 正解: `out_of_scope_request`
- 予測: `compound_request`（69.9%）

### nyamuru_voice_3242

- 発話: この作品を複製したファイルが欲しい。名前は「寄り道メモ」にして、別名保存で作って。
- 正解: `out_of_scope_request`
- 予測: `compound_request`（100.0%）

### nyamuru_voice_3247

- 発話: 次のページへ行くつもりだったけど、もう少しここを見てる。
- 正解: `not_command`
- 予測: `needs_clarification`（100.0%）

### nyamuru_voice_3304

- 発話: 選択中の吹き出しの大きさ、縦も横も今よりちょっと控えめにしてくれる？
- 正解: `needs_clarification`
- 予測: `not_command`（88.8%）

### nyamuru_voice_3305

- 発話: ガイドの表示をオフにして。種類の名前が思い出せないけど。
- 正解: `needs_clarification`
- 予測: `view_change`（100.0%）

