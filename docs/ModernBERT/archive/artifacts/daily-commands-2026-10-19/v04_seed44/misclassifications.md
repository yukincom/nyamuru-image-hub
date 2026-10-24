# ニャムル音声意図分類：誤分類一覧

devは設定選択に使用。trainは学習例への適合確認。信頼度は未校正のsoftmax値。

## daily：7 / 112件

### daily_002

- 発話: 作品を保存して
- 正解: `save`
- 予測: `compound_request`（99.9%）

### daily_003

- 発話: 今の作品を保存して
- 正解: `save`
- 予測: `compound_request`（86.6%）

### daily_004

- 発話: 編集内容を保存して
- 正解: `save`
- 予測: `compound_request`（99.6%）

### daily_005

- 発話: 変更を保存して
- 正解: `save`
- 予測: `compound_request`（100.0%）

### daily_007

- 発話: ここまで保存して
- 正解: `save`
- 予測: `compound_request`（96.3%）

### daily_008

- 発話: 上書き保存して
- 正解: `save`
- 予測: `compound_request`（100.0%）

### daily_019

- 発話: 取り消した操作を戻して
- 正解: `redo`
- 予測: `needs_clarification`（100.0%）

