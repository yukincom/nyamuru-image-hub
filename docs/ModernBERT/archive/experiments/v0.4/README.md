# ニャムル v0.4：3 seedで再学習

学習 **1296件**、新dev **68件**、新test **73件**。全19分類を含みます。単一・複数操作の対照例216件を学習専用で追加しました。旧v0.2/v0.3の評価497件は別の回帰確認用です。**学習とモデル推論はまだ実行していません。**

1. [Colab](https://colab.research.google.com/)に `Nyamuru_Voice_ModernBERT_v0.4_19分類_2026-10-18.ipynb` をアップロード。
2. GPUを選んで「すべてのセルを実行」。最初に `nyamuru-voice-v04-inputs.zip` を選択。
3. 最後の `nyamuru-voice-v04-colab-results.zip` を保存し、このチャットへ渡してください。

3 seed（42/43/44）×2学習率の6試行。新devだけで条件と主評価モデルを選び、新testを評価します。単一↔複数の誤判定と旧版の同じ例での変化も出力します。95%目標の判定対象は新しい合成テキストで、実音声やASRの精度ではありません。新評価は各分類2件以上の小標本で、分類別の率は不安定です。

[学習・評価条件](docs/2026-10-18-v04-protocol.md) · [採用行と分類別件数](docs/2026-10-18-v04-split-review.md) · [採用・除外記録](curation/2026-10-18-v04-evaluation/acceptance-review.json) · [MASSIVEの出典](PUBLIC-DATA-ATTRIBUTION.md)
