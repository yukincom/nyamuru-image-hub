# ニャムル音声操作 v0.5.1：学習方法の比較

2025–2026年の研究を調べ、R-Dropを既存の学習経路へ追加した比較実験。[研究と固定プロトコル](docs/2026-10-18-v05-research-and-protocol.md)。

- 同じtrain1,296 / dev68 / 閲覧済みtest73。旧版4 splitも同じまま。新しい文・ラベル・プロンプトは追加しない。
- 現状／二視点dropout／R-Dropの3条件 × 3 seed × 2学習率。18試行、9モデルを保存。
- 手法とprimaryは全条件のdevだけで先に凍結。testは回帰確認で、新たな独立95%達成判定はしない。

Colabでノートブックを開き、GPUを選んで全セルを実行。最初に`nyamuru-voice-v051-inputs.zip`を選び、最後の`nyamuru-voice-v051-colab-results.zip`を保存する。

実モデルでの精度改善は未測定。ローカルの実装検証と極小モデルによる動作確認は、Colabでの精度実験とは分けて扱う。

修正内容：KLをlog-target形式で計算し、係数0ではKLを逆伝播に含めません。停止時は内部ログをセルへ表示し、comparison.logにも保存します。[停止原因と修正記録](docs/2026-10-18-v051-nan-fix.md)。
