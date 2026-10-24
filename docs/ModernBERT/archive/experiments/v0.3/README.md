# ニャムル v0.3：Colabで19分類を学習

学習 **1080件**、開発 **88件**、新テスト **132件**。全19分類を含み、旧dev/test計277件は別の回帰確認用です。**学習・モデル推論はまだ実行していません。**

MASSIVE由来は169件（原文88件・漫画編集への派生合成81件）。否定・延期、Undo/Redo、複数操作の追加288件は学習専用。近い評価候補を除外し、採用理由と元発話を記録しました。

1. [Colab](https://colab.research.google.com/)に `Nyamuru_Voice_ModernBERT_v0.3_19分類_2026-10-18.ipynb` をアップロード。
2. GPUを選んで「ランタイム → すべてのセルを実行」。最初の入力欄で `nyamuru-voice-v03-inputs.zip` を選択。
3. 最後に出力される `nyamuru-voice-v03-colab-results.zip` を保存して、このチャットへ渡してください。

3 seed × 2学習率の6試行です。条件と主評価モデルを開発データだけで選び、その後新テストの95%目標を判定します。新評価は合成例中心の小規模なtext評価で、実音声やASRの精度を示すものではありません。

[学習条件と評価範囲](docs/2026-10-18-v03-protocol.md) · [全採用行](docs/2026-10-18-v03-split-review.md) · [採用・除外記録](curation/2026-10-18-evaluation/acceptance-review.json) · [出典・ライセンス](PUBLIC-DATA-ATTRIBUTION.md)
