# 短い日常操作の評価（2026-10-19）

前回の73問とは別に、ユーザー指定の「保存して」「次のページ」を含む112問を作成し、保存済み通常学習モデルの3seedで実際に推論した。主評価として推論前に固定したseed43は **110/112（98.21%）**、3seed平均は **94.94%**。短い単操作では高い正解率が得られたが、seed間の差と単純な保存依頼の誤分類が残る。

## 評価条件

- 14操作分類それぞれ8問、4〜22文字。本文と正解分類は推論前に固定。合成文を全件親エージェントが確認した。
- 既存19分類の出力を維持し、確認・推論・複数操作・対象外・非コマンドの5分類は今回の正解例に含めない。誤ってこの5分類を出した場合も不正解。
- v0.4通常学習seed42/43/44（v0.5.1 baselineと同一重み）を使用。主候補seed43は前回の73問比較による選択であり、今回の結果による選び直しではない。
- 既存 `train.evaluate_checkpoint` と `verify_results.verify_predictions` を再利用。本文のみ、CPU、float32、SDPA、batch16、最大128 token、切り詰めなし、推論時dropoutなし。学習や閾値調整は行っていない。
- 実行環境: Python 3.11.14、torch 2.14.1、transformers 5.19.0。

[問題112問](../evaluations/daily-commands-2026-10-19/questions.md) · [入力JSONL](../evaluations/daily-commands-2026-10-19/test.jsonl) · [固定プロトコル](../evaluations/daily-commands-2026-10-19/protocol.json)

## 正解率

| モデル | 全112問 | 学習文と完全一致 | 学習文と正規化一致なし | 先行7分割とも正規化一致なし |
|---|---:|---:|---:|---:|
| v04_seed42 | 104/112（92.86%） | 15/15（100.00%） | 89/97（91.75%） | 86/94（91.49%） |
| v04_seed43（主評価） | 110/112（98.21%） | 15/15（100.00%） | 95/97（97.94%） | 92/94（97.87%） |
| v04_seed44 | 105/112（93.75%） | 15/15（100.00%） | 90/97（92.78%） | 87/94（92.55%） |

学習との完全一致は15問、正規化した場合だけ一致する文は0問、一致なしは97問。「保存して」は学習文と完全一致し、「次のページ」は学習文との正規化一致なし。両方とも全3seedで正解した。正規化は既存関数のNFKC・小文字化・句読点等の除去で、数字や同義語は置換しない。

学習と一致しない97問のうち、過去のdev/testにも正規化一致しないのは94問。どちらも意味的に新しい発話であることを保証する指標ではない。全112問を残し、重複を理由に不自然な文へ書き換えていない。

## 主評価seed43の2件の誤分類

| 入力原文 | 正解 | 予測 | 未校正softmax |
|---|---|---|---:|
| 最後の変更を元に戻して | 戻す (`undo`) | やり直す (`redo`) | 99.09% |
| 作画ガイドを非表示にして | 表示切替 (`view_change`) | 作画方式切替 (`artwork_mode_set`) | 99.81% |

2件とも高いsoftmax値で誤っている。ここでは信頼度の閾値調整は行わない。

## 分類別の正解数

各分類8問。

| 分類 | seed42 | seed43 | seed44 |
|---|---:|---:|---:|
| 保存 | 6/8 | 8/8 | 2/8 |
| 戻す | 8/8 | 7/8 | 8/8 |
| やり直す | 8/8 | 8/8 | 7/8 |
| ページ移動 | 8/8 | 8/8 | 8/8 |
| 表示切替 | 8/8 | 7/8 | 8/8 |
| 作画方式切替 | 8/8 | 8/8 | 8/8 |
| 吹き出しの指定変更 | 7/8 | 8/8 | 8/8 |
| コマシンクロのオン・オフ | 8/8 | 8/8 | 8/8 |
| 内枠スナップのオン・オフ | 7/8 | 8/8 | 8/8 |
| コマスナップのオン・オフ | 8/8 | 8/8 | 8/8 |
| 指定対象の画像生成 | 8/8 | 8/8 | 8/8 |
| 登録済み3D背景の候補提示 | 8/8 | 8/8 | 8/8 |
| 描画ペンの切替 | 7/8 | 8/8 | 8/8 |
| 複数文字枠の上端揃え | 5/8 | 8/8 | 8/8 |

特にseed44は保存8問のうち6問を `compound_request` と誤判定した。たとえば「作品を保存して」「変更を保存して」「上書き保存して」である。短い単操作にも複数操作判定が混入する現象は確認できたが、複数操作の学習例を入れたことが原因かどうかはこの評価だけでは断定できない。

## 全seedの誤分類原文

いずれかのseedが間違えた15問を省略せず示す。

| ID | 入力原文 | 正解分類 | seed42 | seed43 | seed44 |
|---|---|---|---|---|---|
| daily_002 | 作品を保存して | save | save | save | compound_request |
| daily_003 | 今の作品を保存して | save | save | save | compound_request |
| daily_004 | 編集内容を保存して | save | save | save | compound_request |
| daily_005 | 変更を保存して | save | save | save | compound_request |
| daily_007 | ここまで保存して | save | compound_request | save | compound_request |
| daily_008 | 上書き保存して | save | compound_request | save | compound_request |
| daily_013 | 最後の変更を元に戻して | undo | undo | redo | undo |
| daily_019 | 取り消した操作を戻して | redo | redo | redo | needs_clarification |
| daily_038 | 作画ガイドを非表示にして | view_change | view_change | artwork_mode_set | view_change |
| daily_050 | 選択中の吹き出しをノーマル素材にして | bubble_set | out_of_scope_request | bubble_set | bubble_set |
| daily_071 | 内枠スナップを切って | inner_frame_snap_set | out_of_scope_request | inner_frame_snap_set | inner_frame_snap_set |
| daily_104 | ペンをベクター方式にして | paint_tool_set | artwork_mode_set | paint_tool_set | paint_tool_set |
| daily_106 | 選択した2つの文字枠を上端でそろえて | text_frames_align | out_of_scope_request | text_frames_align | text_frames_align |
| daily_108 | 選択中の文字枠を全部上端でそろえて | text_frames_align | out_of_scope_request | text_frames_align | text_frames_align |
| daily_111 | 選択中の複数の文字枠の書き出しをそろえて | text_frames_align | out_of_scope_request | text_frames_align | text_frames_align |

## 解釈と検証範囲

今回の112問は各分類を均等にした合成テストで、利用者の実際の発話頻度を測った標本ではない。音声認識・引数抽出・UI操作・未実装機能の動作は含めない。同じ112問に対する3モデルの結果なので、336問の独立した発話として扱わない。

旧73問では同じseed43が60/73（82.19%）。今回は110/112（98.21%）だが、問題の構成が違うため学習による改善値ではない。旧73問は難しい境界を含む回帰テストとして、そのまま保持している。

全336予測の本文・正解・19分類確率・argmax・集計を検証した。新旧入力763ファイルと出力13ファイルのSHA256を照合し、旧73問・旧予測・各版凍結入力・保存済み重みが変わっていないことを確認した。コードの独立レビュー指摘は解消済み。既存テストは59件中33件成功、旧版専用26件skip。

標準ライブラリだけの[独立再集計](2026-10-19-daily-commands-independent-audit.json)でも、336予測・6,384確率値、全区分の正解数、15件の誤分類和集合、文書の60項目が一致した。コピーに対する[検証の異常系確認](2026-10-19-daily-commands-negative-verification.json)では、主候補の変更・正解ラベル改変・出力manifest項目欠落の3件をすべて拒否した。

実行結果・全予測は `artifacts/daily-commands-2026-10-19/` に保存。[集計JSON](2026-10-19-daily-commands-analysis.json) に主評価全112予測と重複状況を含める。

## 再実行・検証

リポジトリ直下で、既存の学習用Python環境を使用する。runは新規の出力ディレクトリを要求する。

```sh
PYTHONDONTWRITEBYTECODE=1 python evaluate_daily_commands.py run --output artifacts/daily-commands-new-run
PYTHONDONTWRITEBYTECODE=1 python evaluate_daily_commands.py verify --output artifacts/daily-commands-2026-10-19
```

`evaluate_daily_commands.py` は別評価セット用のメタデータと比較集計を受け持つ。モデル推論・確率検証・分類指標は既存関数を共用し、旧73問用スクリプトは変更していない。
