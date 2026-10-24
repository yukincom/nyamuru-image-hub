# ニャムル音声意図分類：誤分類一覧

devは設定選択に使用。trainは学習例への適合確認。信頼度は未校正のsoftmax値。

## test：14 / 73件

### nyamuru_voice_2779

- 発話: 選択中の吹き出しをコマで切り取らない設定にして。念押しだけど、切取りはオフ。
- 正解: `bubble_set`
- 予測: `compound_request`（83.5%）

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
- 予測: `needs_reasoning`（100.0%）

### nyamuru_voice_2899

- 発話: 背景候補を三つお願い。繰り返すけど、候補は三つで。
- 正解: `background_3d_candidates`
- 予測: `needs_clarification`（100.0%）

### nyamuru_voice_3204

- 発話: 最後にやったのは文字の移動で、その前が線を一本描く編集。この二つをまとめてUndoして。
- 正解: `undo`
- 予測: `out_of_scope_request`（89.7%）

### nyamuru_voice_3228

- 発話: これ、広すぎるな。選択中の吹き出しの幅を少し詰めてもらえる？
- 正解: `needs_clarification`
- 予測: `needs_reasoning`（58.9%）

### nyamuru_voice_3245

- 発話: 内枠スナップ、オフにしたらコマが動くわけじゃないんだよね？　動作の説明だけ聞きたい。
- 正解: `not_command`
- 予測: `view_change`（52.4%）

### nyamuru_voice_3247

- 発話: 次のページへ行くつもりだったけど、もう少しここを見てる。
- 正解: `not_command`
- 予測: `needs_clarification`（100.0%）

### nyamuru_voice_3255

- 発話: コマスナップは触らなくていいよ。オフにしてほしいのは内枠スナップのほう。
- 正解: `inner_frame_snap_set`
- 予測: `panel_gap_snap_set`（100.0%）

### nyamuru_voice_3273

- 発話: 文字枠を二つ選んであるよ。揃える基準は上側、下端や中央ではなく上端でお願い。
- 正解: `text_frames_align`
- 予測: `out_of_scope_request`（100.0%）

### nyamuru_voice_3274

- 発話: 文字の内容を直す依頼は取り消すね。選択中の複数の文字枠について、書き出し位置を上端でそろえるほうを実行して。
- 正解: `text_frames_align`
- 予測: `artwork_mode_set`（97.3%）

### nyamuru_voice_3304

- 発話: 選択中の吹き出しの大きさ、縦も横も今よりちょっと控えめにしてくれる？
- 正解: `needs_clarification`
- 予測: `compound_request`（100.0%）

### nyamuru_voice_3305

- 発話: ガイドの表示をオフにして。種類の名前が思い出せないけど。
- 正解: `needs_clarification`
- 予測: `view_change`（100.0%）

