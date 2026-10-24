# ニャムル音声操作分類：Colab学習準備

**採用モデルは通常学習v0.4のseed43です。** 2026-10-20のユーザー指定により、ニャムルの操作分類器として採用を決定しました。v0.5.1 baselineの同じseedと同一重みです。[採用記録](docs/2026-10-20-seed43-adoption.md)。

短い日常操作112問を別に作成して評価しました。前回候補のseed43は110/112（98.21%）、学習文と正規化一致しない97問では95/97（97.94%）。3seed平均は94.94%です。[結果と誤分類](docs/2026-10-19-daily-commands-results.md) · [全112問](evaluations/daily-commands-2026-10-19/questions.md)。合成文による分類評価で、実際の利用頻度や音声認識の精度は含めません。旧73問は保持しています。

保存済み全18モデルを同じ73問・同じ推論条件で再評価しました。3seed平均はv0.2が70.78%、v0.3が74.89%、v0.4が81.28%。正解率、同率ならMacro F1で比べると、通常学習が最有力で、単体の候補はseed43（60/73、82.19%）です。[全モデルの統一比較](docs/2026-10-18-fixed73-all-models.md)。

最新の学習実験は [v0.5.1](experiments/v0.5.1/README.md)。通常学習はv0.4と同一重みで、二視点dropoutとR-Dropの追加による改善は確認できませんでした。[学習方法の比較結果](docs/2026-10-18-v051-results.md)。

[ノートブック](experiments/v0.5.1/Nyamuru_Voice_ModernBERT_v0.5.1_学習方法比較_2026-10-18.ipynb) と `experiments/v0.5.1/nyamuru-voice-v051-inputs.zip` で比較を再現できます。[研究と実験手順](experiments/v0.5.1/docs/2026-10-18-v05-research-and-protocol.md)。閲覧済みtestは回帰確認であり、未使用の実利用発話による評価は未実施です。

v0.4の事前選択seed44は59/73（80.82%）で95%未到達。[検証結果](docs/2026-10-18-v04-results.md)。v0.3は事前選択seed42が117/132（88.64%）でしたが、testが異なるため両者の正解率は直接比較できません。[v0.3の結果](docs/2026-10-18-v03-results.md)。旧版の凍結入力・コード・結果は保持しています。

[MASSIVEの出典](experiments/v0.5.1/PUBLIC-DATA-ATTRIBUTION.md) · [19分類の定義](source/labels.json)
