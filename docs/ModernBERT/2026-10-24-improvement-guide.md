# 精度改善の手順と再現方法（2026-10-24整理）

この文書は2026-10-17〜20の実験を整理した案内です。原記録、入力、予測、重みは変更していません。採用はv0.4 seed43ですが、元のdevによる事前選択モデルはseed44です。[採用記録](archive/docs/2026-10-20-seed43-adoption.md)と[アプリ導入時の確認](../2026-10-20-voice-seed43.md)を参照してください。

## 改善の経緯

| 段階 | 変更・確認したこと | 残した判断 |
| --- | --- | --- |
| v0.1 / 2026-10-17 | アプリの既存機能から19分類を定義。元316例を保存 | 学習準備の版。保存済み学習重みはない |
| v0.2 / 2026-10-17 | 元316例に608例を追加。計924例をtrain647・dev138・test139へ分割 | 言い換えをfamilyへまとめ、分割横断を防ぐ。当時の主評価seed固定記録はない |
| v0.3 / 2026-10-18 | 否定・延期、Undo/Redo、複数操作の境界288例と、MASSIVEの選定・派生例を追加。train1,080・新dev88・新test132 | 旧評価は回帰用へ移す。dev事前選択seed42は新test117/132（88.64%） |
| v0.4 / 2026-10-18 | 単一108・複数72・境界36の対照例216件を追加。train1,296・新dev68・新test73 | dev事前選択seed44は59/73（80.82%）。異なる132問の得点と差し引きしない |
| v0.5 / v0.5.1 | 同じデータで通常学習・二視点dropout・R-Dropを比較。v0.5のNaNを修正してv0.5.1を正式評価 | 通常学習を超える改善は確認できず。通常学習の3モデルはv0.4と同一重み |
| 共通73問 / 2026-10-18 | 保存済み18モデルを同じ入力・推論条件で比較 | 3seed平均はv0.2 70.78%、v0.3 74.89%、v0.4 81.28%。正解率、同率ならmacro F1でseed43を候補にした |
| 日常112問 / 2026-10-19 | 短い単一操作を14分類各8問で別評価。seed43を推論前に主評価へ固定 | seed43は110/112。学習文と正規化一致しない97問では95/97 |
| 採用 / 2026-10-20 | 利用者の指定でv0.4 seed43を採用 | 元のdev選択や旧評価を書き換えず、採用理由を別記録へ残した |

共通73問の改善は同一問題での比較です。追加データだけの因果効果を分離した実験ではなく、未使用の実利用発話での改善を証明するものでもありません。日常112問は合成テキストで、19分類のうち5分類を正解例に含めていません。

## 実施した改善手順

1. **分類契約を固定する。** [labels.json](archive/source/labels.json)で、保存・ページ移動等の操作と、確認不足・推論・複数操作・対応外・非命令の境界を明文化しました。モデルの入力は本文`text`のみ。slots、注釈、画面状態や出典を混ぜません。
2. **出典と原文を保持する。** 元316例はCodex合成308例と利用者の例8例です。追加例、MASSIVE原文、MASSIVEを参考に漫画編集へ書き換えた合成例を区別し、元ID・元partition・変更理由を記録しました。[公開資料の出典とライセンス](archive/experiments/v0.4/PUBLIC-DATA-ATTRIBUTION.md)
3. **同じ発想の言い換えを分割しない。** 正規化一致、近い文型、数値・対象名・語尾のみの違いを調べ、family単位で分離しました。文字列類似度は確認候補の抽出に使い、意味的独立性の証明とは扱いません。採用しない新評価候補はtrainへ転用しませんでした。[v0.2分割レビュー](archive/docs/2026-10-17-v02-split-review.md) · [v0.4分割レビュー](archive/experiments/v0.4/docs/2026-10-18-v04-split-review.md)
4. **誤りを境界の対照例へ変える。** v0.3では否定・延期、Undo/Redo、複数操作を補強。v0.4では同じ指示の念押し、理由や過去の報告、将来の予定、複数の対象・値と、現在の独立した複数操作を区別する216例を追加しました。旧評価は原文・gold・IDを残して回帰用とし、新しいdev/testを別に作成しました。[v0.3手順](archive/experiments/v0.3/docs/2026-10-18-v03-protocol.md) · [v0.4手順](archive/experiments/v0.4/docs/2026-10-18-v04-protocol.md)
5. **学習・選択を固定して比較する。** ModernBERT-ja-30mの同一revisionから全パラメータを学習。seed42/43/44、学習率2e-5/5e-5、10epoch、batch16、最大128token、float32、SDPA、TF32なし。128tokenを超えれば切り詰めず停止します。各epochと共通学習率をdev macro F1で選び、v0.3以降は主評価seedもtestを見る前に固定しました。[v0.4設定](archive/experiments/v0.4/experiment.json)
6. **追加手法の効果を切り分ける。** 通常学習、dropout0.1で二回CEを平均する条件、そこへ対称KL係数1を足すR-Dropを比較しました。v0.5のNaN修正を記録し、有限値で完走したv0.5.1を正式比較に使いました。追加手法はこの条件で通常学習を上回らなかったため採用しませんでした。[比較設計](archive/experiments/v0.5.1/docs/2026-10-18-v05-research-and-protocol.md) · [NaN修正](archive/experiments/v0.5.1/docs/2026-10-18-v051-nan-fix.md)
7. **全seedと誤分類を残す。** 正解率だけでなくmacro F1、各分類のsupport、単一↔複数の誤り、全19確率、選択履歴、入力・重みのSHA-256を保存しました。共通73問の18モデルは15種類の重みであり、同じ問題を3seedで測った219予測を219問の独立評価とは扱いません。[共通比較](archive/docs/2026-10-18-fixed73-all-models.md)

## 読み取りと再現

公開Gitの[archive/](archive/)には、元Git管理693ファイルと、共通73問・日常112問の保存予測73ファイルをバイト不変で置いています。原文に残る相対リンク8件には、対応するv0.2原文書の同一コピーを補っています。重みを含む全ファイル、元Git履歴と復元方法は[保存案内](2026-10-24-archive.md)を参照してください。

### 採用モデルの学習を再現する

1. [v0.4 Notebook](archive/experiments/v0.4/Nyamuru_Voice_ModernBERT_v0.4_19分類_2026-10-18.ipynb)をColabで開きます。
2. [研究Release](https://github.com/yukincom/nyamuru-image-hub/releases/tag/nyamuru-modernbert-research-2026-10-24)から`nyamuru-voice-v04-inputs.zip`を取得します。整理時に固定入力から再構成し、元Notebook埋込みSHA-256 `f9b0998f890e9e0e7064af271fab3ac724f63ee3bd8aa227c403c1673be261e5`との一致を確認しました。
3. 新しいGPUランタイムで全セルを実行し、入力欄でそのZIPを指定します。NotebookはPython3.11と固定依存を準備し、入力ハッシュ確認、6試行、dev選択、評価、結果ZIP保存まで行います。環境やGPUライブラリの違いによる重みの再現性は別途確認が必要です。
4. v0.5.1の学習方法比較を再現する場合は、[同版Notebook](archive/experiments/v0.5.1/Nyamuru_Voice_ModernBERT_v0.5.1_学習方法比較_2026-10-18.ipynb)とReleaseの`nyamuru-voice-v051-inputs.zip`を組にします。v0.4とは混ぜません。

ZIPを自分で作る場合は、保存版の作業コピー内で対象版のフォルダへ入り、`python3 build_colab.py`を実行します。スクリプトはNotebookと入力ハッシュ表も書き出すため、保存原本と実験用コピーを分けます。2026-10-24にはv0.4/v0.5.1の隔離コピーで再生成し、Notebook・入力ハッシュ表が元とバイト一致することだけを検証しました。学習・推論は実行していません。

### 保存済みモデルを同じ問題で比較する

Releaseの5アーカイブを復元した研究フォルダのルートで、[固定依存](archive/requirements-train.txt)を持つPython3.11環境から実行します。結果保存先は新しい名前にします。これはモデル推論を実行する手順です。

```sh
python compare_saved_models.py run --output artifacts/fixed73-rerun
python compare_saved_models.py verify --output artifacts/fixed73-rerun
python evaluate_daily_commands.py run --output artifacts/daily-commands-rerun
python evaluate_daily_commands.py verify --output artifacts/daily-commands-rerun
```

保存予測の確認だけなら、公開Gitで[seed43の73問](archive/artifacts/fixed73-all-models-2026-10-18/v04_seed43/test-predictions.jsonl)、[日常112問](archive/artifacts/daily-commands-2026-10-19/v04_seed43/daily-predictions.jsonl)と各誤分類表を読めます。

## 次の改善に引き継ぐ境界

既知の73問・112問を今後の学習や選択に使うなら、以後は回帰評価として扱い、未使用の実利用に近い発話を別に確保します。19分類を含む評価と、短い14操作分類の評価を分け、trainとの重複も報告します。dev68問の反復利用による選択の偏り、少数例の分類別率、seed間の差を残します。

日常評価seed43の誤りは「最後の変更を元に戻して」→redoと「作画ガイドを非表示にして」→artwork_mode_setで、どちらもsoftmaxは99%以上でした。高い確率だけで実行の正しさを判断せず、分類・引数解決・音声認識・実操作を別々に検証する必要があります。これは今後の課題の整理であり、追加データ、閾値変更、新しい学習を実施した記録ではありません。
