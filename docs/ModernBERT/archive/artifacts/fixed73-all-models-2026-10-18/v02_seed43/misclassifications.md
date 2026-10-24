# ニャムル音声意図分類：誤分類一覧

devは設定選択に使用。trainは学習例への適合確認。信頼度は未校正のsoftmax値。

## test：22 / 73件

### nyamuru_voice_2753

- 発話: 絵の寸法は変えず、表示を原寸にして。
- 正解: `view_change`
- 予測: `compound_request`（91.0%）

### nyamuru_voice_2809

- 発話: 見開きをオフにして、さらにコマシンクロもオフにして。
- 正解: `compound_request`
- 予測: `panel_sync_set`（99.4%）

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

### nyamuru_voice_2840

- 発話: この吹き出しの文字、今日は妙に大きく見えるな。
- 正解: `not_command`
- 予測: `needs_reasoning`（100.0%）

### nyamuru_voice_2887

- 発話: 選択中の人物を生成して。念押しだけど、生成するのは選択中の人物ね。
- 正解: `generate_request`
- 予測: `undo`（83.2%）

### nyamuru_voice_3211

- 発話: Redoをお願いします。回数の指定を先に言い忘れたけど、一回です。
- 正解: `redo`
- 予測: `undo`（57.5%）

### nyamuru_voice_3219

- 発話: どのタブか、名前を言うね。「小道具」。そこを開いて。
- 正解: `view_change`
- 予測: `bubble_set`（89.1%）

### nyamuru_voice_3228

- 発話: これ、広すぎるな。選択中の吹き出しの幅を少し詰めてもらえる？
- 正解: `needs_clarification`
- 予測: `bubble_set`（63.8%）

### nyamuru_voice_3237

- 発話: このページ全体を生成してほしい。あ、それとは別に、作業中の作品の保存も今お願い。
- 正解: `compound_request`
- 予測: `save`（100.0%）

### nyamuru_voice_3239

- 発話: 内枠スナップとコマスナップ、両方オンでお願い。あ、今の訂正はコマスナップだけ、そっちはオフにして。
- 正解: `compound_request`
- 予測: `panel_gap_snap_set`（74.7%）

### nyamuru_voice_3241

- 発話: 最終ページの次に、白紙を一枚足したい。そのページを追加してもらえる？
- 正解: `out_of_scope_request`
- 予測: `page_navigate`（99.5%）

### nyamuru_voice_3242

- 発話: この作品を複製したファイルが欲しい。名前は「寄り道メモ」にして、別名保存で作って。
- 正解: `out_of_scope_request`
- 予測: `save`（100.0%）

### nyamuru_voice_3244

- 発話: 画面に「保存しました」って出た？　今の保存が終わったかだけ教えて。
- 正解: `not_command`
- 予測: `save`（92.4%）

### nyamuru_voice_3245

- 発話: 内枠スナップ、オフにしたらコマが動くわけじゃないんだよね？　動作の説明だけ聞きたい。
- 正解: `not_command`
- 予測: `inner_frame_snap_set`（100.0%）

### nyamuru_voice_3247

- 発話: 次のページへ行くつもりだったけど、もう少しここを見てる。
- 正解: `not_command`
- 予測: `needs_clarification`（71.3%）

### nyamuru_voice_3261

- 発話: 三番のコマの、美月さん。名前を指定したその人物だけを生成して、同じページの別の登場人物には広げないで。
- 正解: `generate_request`
- 予測: `compound_request`（99.2%）

### nyamuru_voice_3304

- 発話: 選択中の吹き出しの大きさ、縦も横も今よりちょっと控えめにしてくれる？
- 正解: `needs_clarification`
- 予測: `needs_reasoning`（99.8%）

### nyamuru_voice_3305

- 発話: ガイドの表示をオフにして。種類の名前が思い出せないけど。
- 正解: `needs_clarification`
- 予測: `view_change`（99.2%）

### nyamuru_voice_3308

- 発話: 「コマスナップ」と書かれた設定があるね。そこを有効にして。
- 正解: `panel_gap_snap_set`
- 予測: `bubble_set`（99.9%）

