# 短い日常操作の分類評価

14操作分類×8問の合成テキスト。重みと旧73問を保持し、既存評価関数でCPU推論。実音声・引数抽出・アプリ動作は評価していない。

主評価候補は前回比較で選ばれたseed43。今回の結果から選び直さない。

| モデル | 全112問 | 学習原文一致 | 学習正規化のみ一致 | 学習正規化一致なし | 先行7分割の正規化一致なし |
|---|---:|---:|---:|---:|---:|
| v04_seed42 | 104/112 (92.86%) | 15/15 (100.00%) | 対象なし | 89/97 (91.75%) | 86/94 (91.49%) |
| v04_seed43 | 110/112 (98.21%) | 15/15 (100.00%) | 対象なし | 95/97 (97.94%) | 92/94 (97.87%) |
| v04_seed44 | 105/112 (93.75%) | 15/15 (100.00%) | 対象なし | 90/97 (92.78%) | 87/94 (92.55%) |

3seed平均正解率：94.94%。同じ112問の反復で、336個の独立した発話ではない。

学習例との一致がない文にも近い言い換えがあり得る。ユーザーの実際の使用頻度を再現した標本ではない。旧73問は別の難しさを測る評価として残す。

## いずれかのseedで間違えた問題

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
