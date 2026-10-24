# ニャムル音声意図分類：誤分類一覧

devは設定選択に使用。trainは学習例への適合確認。信頼度は未校正のsoftmax値。

## daily：2 / 112件

### daily_013

- 発話: 最後の変更を元に戻して
- 正解: `undo`
- 予測: `redo`（99.1%）

### daily_038

- 発話: 作画ガイドを非表示にして
- 正解: `view_change`
- 予測: `artwork_mode_set`（99.8%）

