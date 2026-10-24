# ニャムル音声意図分類：誤分類一覧

devは設定選択に使用。trainは学習例への適合確認。信頼度は未校正のsoftmax値。

## daily：8 / 112件

### daily_007

- 発話: ここまで保存して
- 正解: `save`
- 予測: `compound_request`（99.1%）

### daily_008

- 発話: 上書き保存して
- 正解: `save`
- 予測: `compound_request`（63.5%）

### daily_050

- 発話: 選択中の吹き出しをノーマル素材にして
- 正解: `bubble_set`
- 予測: `out_of_scope_request`（99.8%）

### daily_071

- 発話: 内枠スナップを切って
- 正解: `inner_frame_snap_set`
- 予測: `out_of_scope_request`（71.2%）

### daily_104

- 発話: ペンをベクター方式にして
- 正解: `paint_tool_set`
- 予測: `artwork_mode_set`（99.9%）

### daily_106

- 発話: 選択した2つの文字枠を上端でそろえて
- 正解: `text_frames_align`
- 予測: `out_of_scope_request`（100.0%）

### daily_108

- 発話: 選択中の文字枠を全部上端でそろえて
- 正解: `text_frames_align`
- 予測: `out_of_scope_request`（100.0%）

### daily_111

- 発話: 選択中の複数の文字枠の書き出しをそろえて
- 正解: `text_frames_align`
- 予測: `out_of_scope_request`（95.9%）

