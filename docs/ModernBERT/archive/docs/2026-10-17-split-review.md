# 2026-10-17 固定分割と全316件（v0.1保存版）

この文書は元316件で準備したv0.1の記録です。当時の分割は [保存済みデータ](../releases/v0.1/data-report.json)、現在の追加版は [v0.2](2026-10-17-v02-protocol.md) を参照してください。

原groupを不可分にし、近い文型・対照をまとめてから割り当て。原文・ID・正解・元groupは変更していない。学習結果を見る前の固定分割。

| 分類 | train | dev | test |
|---|---:|---:|---:|
| save | 5 | 2 | 3 |
| undo | 6 | 2 | 2 |
| redo | 6 | 2 | 2 |
| page_navigate | 10 | 4 | 2 |
| view_change | 14 | 3 | 3 |
| artwork_mode_set | 10 | 0 | 0 |
| bubble_set | 20 | 5 | 4 |
| needs_clarification | 14 | 3 | 3 |
| needs_reasoning | 6 | 2 | 2 |
| compound_request | 12 | 2 | 3 |
| out_of_scope_request | 9 | 2 | 2 |
| not_command | 32 | 7 | 7 |
| panel_sync_set | 12 | 0 | 0 |
| inner_frame_snap_set | 12 | 0 | 0 |
| panel_gap_snap_set | 12 | 0 | 0 |
| generate_request | 27 | 6 | 0 |
| background_3d_candidates | 16 | 0 | 0 |
| paint_tool_set | 12 | 0 | 0 |
| text_frames_align | 8 | 0 | 0 |

testには11分類のみ。0件の分類は未評価。trainの成績で代用しない。

## train: 243件

| ID | 原文 | 正解 | 元group | family |
|---|---|---|---|---|
| nyamuru_voice_001 | 保存して | save | save_basic | save_basic |
| nyamuru_voice_002 | 今の作品を保存してください | save | save_basic | save_basic |
| nyamuru_voice_003 | セーブお願い | save | save_basic | save_basic |
| nyamuru_voice_006 | ニャムル、保存してくれる？ | save | save_request_question | save_basic |
| nyamuru_voice_010 | 保存しないで、いや、やっぱり今保存して | save | save_self_correction | save_self_correction |
| nyamuru_voice_011 | 直前の編集を戻して | undo | undo_basic | page_negative |
| nyamuru_voice_012 | アンドゥして | undo | undo_basic | page_negative |
| nyamuru_voice_014 | ひとつ前の編集状態に戻して | undo | undo_basic | page_negative |
| nyamuru_voice_016 | 今の操作をUndoで取り消してください | undo | undo_basic | page_negative |
| nyamuru_voice_019 | 今の編集を元に戻してくれる？ | undo | undo_request_question | page_negative |
| nyamuru_voice_020 | ページを戻すんじゃなくて、直前の編集を取り消して | undo | undo_vs_page | page_negative |
| nyamuru_voice_022 | 今アンドゥした編集をやり直して | redo | redo_after_undo | redo_after_undo |
| nyamuru_voice_023 | 取り消した直前の編集を復活させて | redo | redo_after_undo | redo_after_undo |
| nyamuru_voice_025 | Undoで戻す前の状態に一段進めて | redo | redo_after_undo | redo_after_undo |
| nyamuru_voice_027 | 直前の取り消しを戻してください | redo | redo_after_undo | redo_after_undo |
| nyamuru_voice_029 | いま取り消した変更をもう一度適用して | redo | redo_after_undo | redo_after_undo |
| nyamuru_voice_030 | 生成し直すのではなく、さっきのUndoをリドゥして | redo | redo_vs_generate | redo_vs_generate |
| nyamuru_voice_031 | 次のページへ | page_navigate | page_next | page_negative |
| nyamuru_voice_032 | 一ページ先を表示して | page_navigate | page_next | page_negative |
| nyamuru_voice_033 | ページを一枚進めてくれる？ | page_navigate | page_next | page_negative |
| nyamuru_voice_034 | 前のページに戻って | page_navigate | page_previous | page_negative |
| nyamuru_voice_035 | ひとつ前のページを見せて | page_navigate | page_previous | page_negative |
| nyamuru_voice_036 | ページを一枚戻して | page_navigate | page_previous | page_negative |
| nyamuru_voice_042 | 最後のページを表示して | page_navigate | page_last | page_last |
| nyamuru_voice_043 | 三ページ先へ進んで | page_navigate | page_relative_count | page_negative |
| nyamuru_voice_044 | 二ページ前に戻って | page_navigate | page_relative_count | page_negative |
| nyamuru_voice_046 | 編集を取り消すんじゃなくて前のページに戻って | page_navigate | undo_vs_page | page_negative |
| nyamuru_voice_047 | 紙面全体を表示して | view_change | whole_view_vs_mode | mode_draft |
| nyamuru_voice_048 | ページが全部収まる表示にして | view_change | zoom_fit | mode_draft |
| nyamuru_voice_049 | 表示を一段拡大して | view_change | zoom_in | zoom_in |
| nyamuru_voice_050 | ズームインして | view_change | zoom_in | zoom_in |
| nyamuru_voice_051 | 表示を一段縮小して | view_change | zoom_out | zoom_in |
| nyamuru_voice_052 | ズームアウトを一回 | view_change | zoom_out | zoom_in |
| nyamuru_voice_055 | 見開き表示にして | view_change | spread_on | spread_negative |
| nyamuru_voice_056 | 左右のページを見開きで表示して | view_change | spread_on | spread_negative |
| nyamuru_voice_057 | 見開き表示をオフにして | view_change | spread_off | spread_negative |
| nyamuru_voice_060 | 編集ガイドをオンにして | view_change | edit_guide | edit_guide |
| nyamuru_voice_061 | 編集ガイドをオフにして | view_change | edit_guide | edit_guide |
| nyamuru_voice_062 | 選択中の人物のあたり画像を隠して | view_change | artwork_guide | artwork_guide |
| nyamuru_voice_063 | この人物のあたり画像を表示して | view_change | artwork_guide | artwork_guide |
| nyamuru_voice_066 | ネーム編集のタブに戻って | view_change | tab_storyboard | tab_storyboard |
| nyamuru_voice_067 | 作画方式をページ全体の一体型にして | artwork_mode_set | mode_integrated | mode_draft |
| nyamuru_voice_068 | 全体を一体生成する設定に切り替えて | artwork_mode_set | whole_view_vs_mode | mode_draft |
| nyamuru_voice_069 | 文字と吹き出しを含めてページを仕上げる方式を選んで | artwork_mode_set | mode_integrated | mode_draft |
| nyamuru_voice_070 | 作画設定の一体型を選択して | artwork_mode_set | mode_integrated | mode_draft |
| nyamuru_voice_071 | 今は生成せず、一体型の方式にだけ切り替えて | artwork_mode_set | mode_without_run | mode_draft |
| nyamuru_voice_072 | 作画方式を下書き生成にして | artwork_mode_set | mode_draft | mode_draft |
| nyamuru_voice_073 | コマごとに下書きを作る設定を選んで | artwork_mode_set | mode_draft | mode_draft |
| nyamuru_voice_074 | 手描きで仕上げる下書きの方式に切り替えて | artwork_mode_set | mode_draft | mode_draft |
| nyamuru_voice_075 | 作画設定の下書きを選択して | artwork_mode_set | mode_draft | mode_draft |
| nyamuru_voice_076 | 生成は始めず、下書き方式にだけ変えて | artwork_mode_set | mode_without_run | mode_draft |
| nyamuru_voice_077 | この吹き出しを四角にして | bubble_set | bubble_shape_square | bubble_keep |
| nyamuru_voice_078 | 選択中の吹き出しをキャプションに変更して | bubble_set | bubble_shape_caption | bubble_shape_caption |
| nyamuru_voice_080 | この吹き出しに素材のnomal 01を使って | bubble_set | bubble_preset | bubble_preset |
| nyamuru_voice_081 | 選択中の吹き出しを素材toge 02にして | bubble_set | bubble_preset | bubble_preset |
| nyamuru_voice_082 | この吹き出しのしっぽを消して | bubble_set | bubble_tail | bubble_keep |
| nyamuru_voice_083 | 選択中の吹き出しにしっぽを付けて | bubble_set | bubble_tail | bubble_keep |
| nyamuru_voice_084 | この吹き出しをコマ枠で切り取る設定にして | bubble_set | bubble_clip | bubble_clip |
| nyamuru_voice_085 | 吹き出しのコマ枠で切り取る設定をオフにして | bubble_set | bubble_clip | bubble_clip |
| nyamuru_voice_086 | 選択中の吹き出しを右へ2ミリ動かして | bubble_set | bubble_move | bubble_move |
| nyamuru_voice_087 | この吹き出しを左へ三ミリ | bubble_set | bubble_move | bubble_move |
| nyamuru_voice_088 | 吹き出しを上へ1ミリ移動して | bubble_set | bubble_move | bubble_move |
| nyamuru_voice_089 | この吹き出しを右に2ミリ、上に1ミリずらして | bubble_set | bubble_move_xy | bubble_move |
| nyamuru_voice_094 | この吹き出しに「保存して、次のページへ」と入れて | bubble_set | bubble_quoted_command | bubble_quoted_command |
| nyamuru_voice_099 | 選択中の吹き出しを同じコマの1番の吹き出しにつないで | bubble_set | bubble_join | bubble_join |
| nyamuru_voice_100 | この吹き出しの結合を解除して | bubble_set | bubble_join | bubble_join |
| nyamuru_voice_101 | 戻して | needs_clarification | ambiguous_back | ambiguous_back |
| nyamuru_voice_103 | こっちにして | needs_clarification | ambiguous_reference | ambiguous_reference |
| nyamuru_voice_104 | 全体に切り替えて | needs_clarification | whole_view_vs_mode | mode_draft |
| nyamuru_voice_105 | 部分生成にして | needs_clarification | ambiguous_partial | ambiguous_partial |
| nyamuru_voice_107 | 表示を切り替えて | needs_clarification | ambiguous_view | ambiguous_view |
| nyamuru_voice_109 | 作画方式を変えて | needs_clarification | ambiguous_mode | ambiguous_mode |
| nyamuru_voice_111 | このセリフに合う吹き出しの素材を選んで | needs_reasoning | reason_bubble_material | reason_bubble_material |
| nyamuru_voice_112 | この場面が緊張して見える形に整えて | needs_reasoning | reason_bubble_material | reason_bubble_material |
| nyamuru_voice_113 | 人物の顔に重ならないように吹き出しを配置して | needs_reasoning | reason_layout | reason_layout |
| nyamuru_voice_114 | このページの吹き出しを読みやすくして | needs_reasoning | reason_layout | reason_layout |
| nyamuru_voice_118 | 少し控えめな印象の吹き出しに変えて | needs_reasoning | reason_bubble_material | reason_bubble_material |
| nyamuru_voice_120 | 吹き出しが見切れない位置を考えて直して | needs_reasoning | reason_layout | reason_layout |
| nyamuru_voice_123 | 直前の編集を戻して、その状態を保存して | compound_request | compound_undo_save | compound_undo_save |
| nyamuru_voice_125 | 配置ガイドを消して、表示を100パーセントにして | compound_request | compound_view_view | compound_view_view |
| nyamuru_voice_126 | 下書き方式に切り替えて保存して | compound_request | compound_mode_save | compound_mode_save |
| nyamuru_voice_127 | この吹き出しを四角にして、しっぽを消して | compound_request | compound_bubble_fields | bubble_keep |
| nyamuru_voice_128 | この吹き出しを右へ2ミリ動かして保存して | compound_request | compound_bubble_save | bubble_move |
| nyamuru_voice_130 | 一体型の方式に変えて、そのまま生成を開始して | compound_request | compound_mode_generate | compound_mode_generate |
| nyamuru_voice_133 | 作品フォルダを開いて | out_of_scope_request | out_open_project | out_open_project |
| nyamuru_voice_134 | この作品を別名で保存して | out_of_scope_request | out_save_as | out_save_as |
| nyamuru_voice_136 | 人物だけ画像生成を始めて | generate_request | generate_character | generate_character |
| nyamuru_voice_137 | 全ページを一体生成して | out_of_scope_request | whole_view_vs_mode | mode_draft |
| nyamuru_voice_138 | 実行中の画像生成を止めて | out_of_scope_request | out_cancel_generation | out_cancel_generation |
| nyamuru_voice_139 | 吹き出しを一つ追加して | out_of_scope_request | out_add_bubble | out_add_bubble |
| nyamuru_voice_140 | この吹き出しをウニフラッシュ素材に変えて | out_of_scope_request | out_deferred_asset | out_deferred_asset |
| nyamuru_voice_143 | 今は保存しないで | not_command | save_negative | save_basic |
| nyamuru_voice_144 | 保存して、いや、まだ保存しないで | not_command | save_self_correction | save_self_correction |
| nyamuru_voice_147 | もう編集をやり直した | not_command | redo_report | redo_report |
| nyamuru_voice_148 | 次のページには何がある？ | not_command | page_question | page_question |
| nyamuru_voice_149 | 全体を一体型にするとどうなる？ | not_command | whole_view_vs_mode | mode_draft |
| nyamuru_voice_150 | この吹き出しは四角のままでいい | not_command | bubble_keep | bubble_keep |
| nyamuru_voice_151 | 直前の編集を戻さないで | not_command | undo_negative | page_negative |
| nyamuru_voice_153 | まだ次のページには進まないで | not_command | page_negative | page_negative |
| nyamuru_voice_155 | 今は見開き表示にしないで | not_command | spread_negative | spread_negative |
| nyamuru_voice_156 | 作画方式を一体型には切り替えないで | not_command | mode_negative | mode_draft |
| nyamuru_voice_157 | 下書き方式から変えずにそのままでいい | not_command | mode_keep | mode_draft |
| nyamuru_voice_158 | この吹き出しのしっぽを消さないで | not_command | bubble_tail_negative | bubble_keep |
| nyamuru_voice_159 | この吹き出しを四角には変えないで | not_command | bubble_shape_negative | bubble_keep |
| nyamuru_voice_161 | 見開き表示にしたよ | not_command | spread_report | spread_negative |
| nyamuru_voice_162 | いま下書き方式で作業している | not_command | mode_report | mode_draft |
| nyamuru_voice_165 | コマシンクロをオンにして | panel_sync_set | panel_sync_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_166 | コマシンクロオン | panel_sync_set | panel_sync_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_167 | コマシンクロを有効にしてくれる？ | panel_sync_set | panel_sync_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_168 | コマシンクロのチェックを入れて | panel_sync_set | panel_sync_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_169 | コマシンクロを使う設定にして | panel_sync_set | panel_sync_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_170 | コマシンクロをオフ、いや、オンにして | panel_sync_set | panel_sync_set_correction | inner_frame_snap_set_correction |
| nyamuru_voice_171 | コマシンクロをオフにして | panel_sync_set | panel_sync_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_172 | コマシンクロオフ | panel_sync_set | panel_sync_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_173 | コマシンクロを無効にしてください | panel_sync_set | panel_sync_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_174 | コマシンクロのチェックを外して | panel_sync_set | panel_sync_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_175 | コマシンクロを使わない設定にして | panel_sync_set | panel_sync_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_176 | コマシンクロをオン、いや、オフにして | panel_sync_set | panel_sync_set_correction | inner_frame_snap_set_correction |
| nyamuru_voice_177 | コマシンクロをオンにしないで | not_command | panel_sync_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_178 | コマシンクロをオフにしないで | not_command | panel_sync_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_179 | コマシンクロは今オン？ | not_command | panel_sync_set_status | inner_frame_snap_set_correction |
| nyamuru_voice_181 | コマシンクロの設定を変えて | needs_clarification | panel_sync_set_unspecified | inner_frame_snap_set_unspecified |
| nyamuru_voice_182 | コマシンクロを以前の設定に戻して | needs_clarification | panel_sync_set_history | inner_frame_snap_set_correction |
| nyamuru_voice_183 | コマシンクロをオンにして保存して | compound_request | panel_sync_set_save | inner_frame_snap_set_correction |
| nyamuru_voice_184 | この吹き出しに「コマシンクロをオフにして」と入れて | bubble_set | panel_sync_set_quoted | bubble_quoted_command |
| nyamuru_voice_185 | 内枠スナップをオンにして | inner_frame_snap_set | inner_frame_snap_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_186 | 内枠スナップオン | inner_frame_snap_set | inner_frame_snap_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_187 | 内枠スナップを有効にしてくれる？ | inner_frame_snap_set | inner_frame_snap_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_188 | 内枠スナップのチェックを入れて | inner_frame_snap_set | inner_frame_snap_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_189 | 内枠スナップを使う設定にして | inner_frame_snap_set | inner_frame_snap_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_190 | 内枠スナップをオフ、いや、オンにして | inner_frame_snap_set | inner_frame_snap_set_correction | inner_frame_snap_set_correction |
| nyamuru_voice_191 | 内枠スナップをオフにして | inner_frame_snap_set | inner_frame_snap_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_192 | 内枠スナップオフ | inner_frame_snap_set | inner_frame_snap_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_193 | 内枠スナップを無効にしてください | inner_frame_snap_set | inner_frame_snap_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_194 | 内枠スナップのチェックを外して | inner_frame_snap_set | inner_frame_snap_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_195 | 内枠スナップを使わない設定にして | inner_frame_snap_set | inner_frame_snap_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_196 | 内枠スナップをオン、いや、オフにして | inner_frame_snap_set | inner_frame_snap_set_correction | inner_frame_snap_set_correction |
| nyamuru_voice_197 | 内枠スナップをオンにしないで | not_command | inner_frame_snap_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_198 | 内枠スナップをオフにしないで | not_command | inner_frame_snap_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_199 | 内枠スナップは今オン？ | not_command | inner_frame_snap_set_status | inner_frame_snap_set_correction |
| nyamuru_voice_201 | 内枠スナップの設定を変えて | needs_clarification | inner_frame_snap_set_unspecified | inner_frame_snap_set_unspecified |
| nyamuru_voice_202 | 内枠スナップを以前の設定に戻して | needs_clarification | inner_frame_snap_set_history | inner_frame_snap_set_correction |
| nyamuru_voice_203 | 内枠スナップをオンにして保存して | compound_request | inner_frame_snap_set_save | inner_frame_snap_set_correction |
| nyamuru_voice_204 | この吹き出しに「内枠スナップをオフにして」と入れて | bubble_set | inner_frame_snap_set_quoted | bubble_quoted_command |
| nyamuru_voice_205 | コマスナップをオンにして | panel_gap_snap_set | panel_gap_snap_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_206 | コマスナップオン | panel_gap_snap_set | panel_gap_snap_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_207 | コマスナップを有効にしてくれる？ | panel_gap_snap_set | panel_gap_snap_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_208 | コマスナップのチェックを入れて | panel_gap_snap_set | panel_gap_snap_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_209 | コマスナップを使う設定にして | panel_gap_snap_set | panel_gap_snap_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_210 | コマスナップをオフ、いや、オンにして | panel_gap_snap_set | panel_gap_snap_set_correction | inner_frame_snap_set_correction |
| nyamuru_voice_211 | コマスナップをオフにして | panel_gap_snap_set | panel_gap_snap_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_212 | コマスナップオフ | panel_gap_snap_set | panel_gap_snap_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_213 | コマスナップを無効にしてください | panel_gap_snap_set | panel_gap_snap_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_214 | コマスナップのチェックを外して | panel_gap_snap_set | panel_gap_snap_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_215 | コマスナップを使わない設定にして | panel_gap_snap_set | panel_gap_snap_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_216 | コマスナップをオン、いや、オフにして | panel_gap_snap_set | panel_gap_snap_set_correction | inner_frame_snap_set_correction |
| nyamuru_voice_217 | コマスナップをオンにしないで | not_command | panel_gap_snap_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_218 | コマスナップをオフにしないで | not_command | panel_gap_snap_set_desired_state | inner_frame_snap_set_correction |
| nyamuru_voice_219 | コマスナップは今オン？ | not_command | panel_gap_snap_set_status | inner_frame_snap_set_correction |
| nyamuru_voice_221 | コマスナップの設定を変えて | needs_clarification | panel_gap_snap_set_unspecified | inner_frame_snap_set_unspecified |
| nyamuru_voice_222 | コマスナップを以前の設定に戻して | needs_clarification | panel_gap_snap_set_history | inner_frame_snap_set_correction |
| nyamuru_voice_223 | コマスナップをオンにして保存して | compound_request | panel_gap_snap_set_save | inner_frame_snap_set_correction |
| nyamuru_voice_224 | この吹き出しに「コマスナップをオフにして」と入れて | bubble_set | panel_gap_snap_set_quoted | bubble_quoted_command |
| nyamuru_voice_225 | これ生成 | generate_request | generate_selection | generate_character |
| nyamuru_voice_226 | これを生成して | generate_request | generate_selection | generate_character |
| nyamuru_voice_227 | 選択中のものを生成して | generate_request | generate_selection | generate_character |
| nyamuru_voice_228 | 今選んでいる対象を画像生成して | generate_request | generate_selection | generate_character |
| nyamuru_voice_229 | 選択した対象を生成してくれる？ | generate_request | generate_selection | generate_character |
| nyamuru_voice_230 | 選択中の対象だけ生成して | generate_request | generate_selection | generate_character |
| nyamuru_voice_231 | このキャラクターだけ生成 | generate_request | generate_selected_character | generate_character |
| nyamuru_voice_232 | この人物だけ画像生成して | generate_request | generate_selected_character | generate_character |
| nyamuru_voice_233 | 選択中のキャラだけ生成して | generate_request | generate_selected_character | generate_character |
| nyamuru_voice_234 | 今選んでいる人物を生成してくれる？ | generate_request | generate_selected_character | generate_character |
| nyamuru_voice_235 | このキャラクターを一人だけ生成して | generate_request | generate_selected_character | generate_character |
| nyamuru_voice_236 | 背景は生成せず、このキャラクターだけ生成して | generate_request | generate_selected_character | generate_character |
| nyamuru_voice_243 | このコマだけ生成 | generate_request | generate_selected_panel | generate_character |
| nyamuru_voice_244 | 選択中のコマだけ生成して | generate_request | generate_selected_panel | generate_character |
| nyamuru_voice_245 | いま選んでいるコマを生成して | generate_request | generate_selected_panel | generate_character |
| nyamuru_voice_246 | このコマ全体を一枚の画像として生成して | generate_request | generate_selected_panel | generate_character |
| nyamuru_voice_247 | 他のコマには手を加えず、このコマだけ生成して | generate_request | generate_selected_panel | generate_character |
| nyamuru_voice_248 | このコマだけ生成してくれる？ | generate_request | generate_selected_panel | generate_character |
| nyamuru_voice_249 | 3D背景候補出して | background_3d_candidates | registered_background_candidates | registered_background_candidates |
| nyamuru_voice_250 | 登録済みの3Dモデルから背景候補を出して | background_3d_candidates | registered_background_candidates | registered_background_candidates |
| nyamuru_voice_251 | このコマに使える登録済み3D背景を候補に挙げて | background_3d_candidates | registered_background_candidates | registered_background_candidates |
| nyamuru_voice_252 | 今登録してある3D背景の候補を見せて | background_3d_candidates | registered_background_candidates | registered_background_candidates |
| nyamuru_voice_253 | この場面に合う3Dモデルを候補として挙げて | background_3d_candidates | registered_background_candidates | registered_background_candidates |
| nyamuru_voice_254 | 舞台に使う登録済みの3Dモデルを候補に出して | background_3d_candidates | registered_background_candidates | registered_background_candidates |
| nyamuru_voice_255 | 3D背景の候補を三つ出して | background_3d_candidates | registered_background_candidates | registered_background_candidates |
| nyamuru_voice_256 | 登録済みの3Dモデルから学校の背景候補を探して | background_3d_candidates | registered_background_candidates | registered_background_candidates |
| nyamuru_voice_257 | 教室に合う登録済み3D背景を候補として見せて | background_3d_candidates | registered_background_candidates | registered_background_candidates |
| nyamuru_voice_258 | 登録した3Dモデルの中から背景候補を選んで | background_3d_candidates | registered_background_candidates | registered_background_candidates |
| nyamuru_voice_259 | このコマの背景に合う登録済み3Dモデルを二つ提案して | background_3d_candidates | registered_background_candidates | registered_background_candidates |
| nyamuru_voice_260 | 配置はしないで、登録済み3D背景の候補だけ出して | background_3d_candidates | registered_background_candidates | registered_background_candidates |
| nyamuru_voice_261 | これ生成しないで | not_command | generate_selection | generate_character |
| nyamuru_voice_262 | このキャラクターは生成済み？ | not_command | generate_character_status | generate_character |
| nyamuru_voice_264 | このコマだけ生成したよ | not_command | generate_selected_panel | generate_character |
| nyamuru_voice_265 | 3D背景の候補って出せる？ | not_command | registered_background_capability | registered_background_candidates |
| nyamuru_voice_266 | 3D背景候補はまだ出さないで | not_command | registered_background_candidates | registered_background_candidates |
| nyamuru_voice_267 | これの候補を出して | needs_clarification | ambiguous_candidates | ambiguous_candidates |
| nyamuru_voice_268 | ネットから新しい3D背景モデルを探して | out_of_scope_request | external_background_models | external_background_models |
| nyamuru_voice_270 | これを生成して保存して | compound_request | generate_save | generate_save |
| nyamuru_voice_271 | 3D背景候補を出して、一番目をこのコマに配置して | compound_request | background_candidates_apply | background_candidates_apply |
| nyamuru_voice_272 | この吹き出しに「これ生成」と入れて | bubble_set | generation_quoted | bubble_quoted_command |
| nyamuru_voice_273 | コマ3の小雪ちゃんだけ生成して | generate_request | generate_explicit_locator | generate_character |
| nyamuru_voice_274 | コマ1の小雪だけ生成して | generate_request | generate_explicit_locator | generate_character |
| nyamuru_voice_275 | コマ3のこのキャラクターだけ生成して | generate_request | generate_explicit_locator | generate_character |
| nyamuru_voice_276 | コマ1だけ生成して | generate_request | generate_explicit_locator | generate_character |
| nyamuru_voice_277 | 3コマ目を生成して | generate_request | generate_explicit_locator | generate_character |
| nyamuru_voice_278 | 小雪ちゃんだけ生成して | generate_request | generate_explicit_locator | generate_character |
| nyamuru_voice_279 | あかりちゃんだけ生成して | generate_request | generate_explicit_locator | generate_character |
| nyamuru_voice_280 | コマ一のミナちゃんだけ画像生成して | generate_request | generate_explicit_locator | generate_character |
| nyamuru_voice_281 | コマ3の背景候補出して | background_3d_candidates | registered_background_locator | registered_background_candidates |
| nyamuru_voice_282 | コマ1の背景候補を見せて | background_3d_candidates | registered_background_locator | registered_background_candidates |
| nyamuru_voice_283 | 背景候補出して | background_3d_candidates | registered_background_locator | registered_background_candidates |
| nyamuru_voice_284 | コマ一に合う登録済み3D背景の候補を三つ出して | background_3d_candidates | registered_background_locator | registered_background_candidates |
| nyamuru_voice_285 | ラスターペンに変えて | paint_tool_set | paint_pen_choice | paint_pen_choice |
| nyamuru_voice_286 | ラスターペンに切り替えて | paint_tool_set | paint_pen_choice | paint_pen_choice |
| nyamuru_voice_287 | ラスターで描くペンを選んで | paint_tool_set | paint_pen_choice | paint_pen_choice |
| nyamuru_voice_288 | ラスターペンを使いたいので選択して | paint_tool_set | paint_pen_choice | paint_pen_choice |
| nyamuru_voice_289 | ラスターペンにしてくれる？ | paint_tool_set | paint_pen_choice | paint_pen_choice |
| nyamuru_voice_290 | ベクターじゃなくてラスターペンにして | paint_tool_set | paint_pen_choice | paint_pen_choice |
| nyamuru_voice_291 | ベクターペンに変えて | paint_tool_set | paint_pen_choice | paint_pen_choice |
| nyamuru_voice_292 | ベクターペンに切り替えて | paint_tool_set | paint_pen_choice | paint_pen_choice |
| nyamuru_voice_293 | ベクターのペンを選んで | paint_tool_set | paint_pen_choice | paint_pen_choice |
| nyamuru_voice_294 | ベジェペンにして | paint_tool_set | paint_pen_choice | paint_pen_choice |
| nyamuru_voice_295 | ベクターペンにしてくれる？ | paint_tool_set | paint_pen_choice | paint_pen_choice |
| nyamuru_voice_296 | ラスターペンではなくベクターペンにして | paint_tool_set | paint_pen_choice | paint_pen_choice |
| nyamuru_voice_297 | 選択中の文字の頭をそろえて | text_frames_align | text_frames_top | alignment_unspecified |
| nyamuru_voice_298 | 選択した文字枠の上端をそろえて | text_frames_align | text_frames_top | alignment_unspecified |
| nyamuru_voice_299 | この複数の文字枠を上揃えにして | text_frames_align | text_frames_top | alignment_unspecified |
| nyamuru_voice_300 | 選択中のセリフの書き出しの高さをそろえて | text_frames_align | text_frames_top | alignment_unspecified |
| nyamuru_voice_301 | 選択した吹き出し内の文字の上端をそろえて | text_frames_align | text_frames_top | alignment_unspecified |
| nyamuru_voice_302 | 並んでいる吹き出しのうち、選択した文字だけ頭をそろえて | text_frames_align | text_frames_top | alignment_unspecified |
| nyamuru_voice_303 | 複数選んだ文字枠を上にそろえて | text_frames_align | text_frames_top | alignment_unspecified |
| nyamuru_voice_304 | コマ3で選択中の文字枠の上端をそろえて | text_frames_align | text_frames_top | alignment_unspecified |
| nyamuru_voice_305 | ラスターペンには変えないで | not_command | paint_pen_choice | paint_pen_choice |
| nyamuru_voice_307 | 文字の頭はそろえないで | not_command | text_frames_top | alignment_unspecified |
| nyamuru_voice_308 | 背景候補はもう出したよ | not_command | registered_background_report | registered_background_candidates |
| nyamuru_voice_310 | 文字をそろえて | needs_clarification | alignment_unspecified | alignment_unspecified |
| nyamuru_voice_312 | 選択中の文字の各行を左揃えにして | out_of_scope_request | paragraph_alignment | paragraph_alignment |
| nyamuru_voice_313 | 選択した吹き出しの輪郭を上揃えにして | out_of_scope_request | bubble_outline_alignment | bubble_outline_alignment |
| nyamuru_voice_314 | コマ1の小雪ちゃんを生成してからコマ3を生成して | compound_request | generate_multiple_targets | generate_multiple_targets |
| nyamuru_voice_316 | この吹き出しに「コマ3の小雪ちゃんだけ生成」と入れて | bubble_set | named_generation_quoted | bubble_quoted_command |

## dev: 40件

| ID | 原文 | 正解 | 元group | family |
|---|---|---|---|---|
| nyamuru_voice_007 | 保存ボタンを押したときと同じ保存をして | save | save_button | save_button |
| nyamuru_voice_009 | まだ保存してないから保存して | save | save_report_then_request | save_report_then_request |
| nyamuru_voice_015 | 元に戻すボタンを一回実行して | undo | undo_button | redo_button |
| nyamuru_voice_018 | 編集を二回分アンドゥして | undo | undo_count | redo_count |
| nyamuru_voice_024 | やり直すボタンを一回実行して | redo | redo_button | redo_button |
| nyamuru_voice_026 | 編集履歴を二回リドゥして | redo | redo_count | redo_count |
| nyamuru_voice_037 | 3ページに移動して | page_navigate | page_number | compound_page_tab |
| nyamuru_voice_038 | 十二ページを開いて | page_navigate | page_number | compound_page_tab |
| nyamuru_voice_039 | ページ五を表示 | page_navigate | page_number | compound_page_tab |
| nyamuru_voice_040 | 2ページ目を見たいからそこを表示して | page_navigate | page_number | compound_page_tab |
| nyamuru_voice_058 | 配置ガイドを表示して | view_change | placement_guide | placement_guide |
| nyamuru_voice_059 | 人物や吹き出しの配置枠を隠して | view_change | placement_guide | placement_guide |
| nyamuru_voice_064 | シナリオのタブを開いて | view_change | tab_scenario | compound_page_tab |
| nyamuru_voice_093 | この吹き出しの本文を「おはよう。」にして | bubble_set | bubble_text | bubble_text |
| nyamuru_voice_095 | この吹き出しの話者を小雪にして | bubble_set | bubble_speaker | bubble_speaker |
| nyamuru_voice_096 | 選択中の吹き出しを話者なしにして | bubble_set | bubble_speaker | bubble_speaker |
| nyamuru_voice_097 | この吹き出しの所属を同じページの2コマ目に変えて | bubble_set | bubble_owner | bubble_owner |
| nyamuru_voice_098 | 吹き出しの所属をページ前景に移して | bubble_set | bubble_owner | bubble_owner |
| nyamuru_voice_102 | もう一度 | needs_clarification | ambiguous_again | ambiguous_again |
| nyamuru_voice_106 | ガイドを消して | needs_clarification | ambiguous_guide | ambiguous_guide |
| nyamuru_voice_115 | 話者が分かる向きにしっぽを調整して | needs_reasoning | reason_tail | reason_tail |
| nyamuru_voice_116 | しっぽを口まで伸ばさず、ちょうどいい長さにして | needs_reasoning | reason_tail | reason_tail |
| nyamuru_voice_122 | 前のページを開いて、見開き表示にして | compound_request | compound_page_view | compound_page_view |
| nyamuru_voice_129 | 3ページを表示して、シナリオのタブを開いて | compound_request | compound_page_tab | compound_page_tab |
| nyamuru_voice_131 | このページを印刷キューに入れて | out_of_scope_request | out_print_queue | out_print_queue |
| nyamuru_voice_141 | 保存のやり方を教えて | not_command | save_how_question | save_how_question |
| nyamuru_voice_142 | この作品は保存済み？ | not_command | save_status_question | save_status_question |
| nyamuru_voice_146 | 元に戻すと何が戻るの？ | not_command | undo_question | undo_question |
| nyamuru_voice_154 | 配置ガイドは消さないで | not_command | placement_guide_negative | placement_guide |
| nyamuru_voice_160 | このアプリには保存機能がある？ | not_command | save_capability_question | save_capability_question |
| nyamuru_voice_163 | この吹き出しの話者は小雪で合ってる？ | not_command | bubble_speaker_question | bubble_speaker |
| nyamuru_voice_237 | ページ全体を生成 | generate_request | generate_current_page | generate_current_page |
| nyamuru_voice_238 | このページを丸ごと生成して | generate_request | generate_current_page | generate_current_page |
| nyamuru_voice_239 | いま表示しているページ全体の画像を生成して | generate_request | generate_current_page | generate_current_page |
| nyamuru_voice_240 | この一ページを生成してくれる？ | generate_request | generate_current_page | generate_current_page |
| nyamuru_voice_241 | このページを一枚まるごと生成して | generate_request | generate_current_page | generate_current_page |
| nyamuru_voice_242 | このページ全体の生成を始めて | generate_request | generate_current_page | generate_current_page |
| nyamuru_voice_263 | ページ全体の生成はまだ始めないで | not_command | generate_current_page | generate_current_page |
| nyamuru_voice_269 | 3D背景のカメラ構図を三つ作って | out_of_scope_request | background_camera_candidates | background_camera_candidates |
| nyamuru_voice_311 | ペンを切り替えて | needs_clarification | pen_unspecified | pen_unspecified |

## test: 33件

| ID | 原文 | 正解 | 元group | family |
|---|---|---|---|---|
| nyamuru_voice_004 | この編集を保存しておいて | save | save_edits | save_edits |
| nyamuru_voice_005 | いまの状態で保存 | save | save_edits | save_edits |
| nyamuru_voice_008 | いったん作品を保存しといて | save | save_edits | save_edits |
| nyamuru_voice_013 | 今動かした吹き出しの編集を一つ取り消して | undo | undo_last_edit | undo_last_edit |
| nyamuru_voice_017 | さっきの編集、アンドゥお願い | undo | undo_last_edit | undo_last_edit |
| nyamuru_voice_021 | リドゥして | redo | redo_basic | redo_basic |
| nyamuru_voice_028 | リドゥをお願いします | redo | redo_basic | redo_basic |
| nyamuru_voice_041 | 最初のページにして | page_navigate | page_first | page_first |
| nyamuru_voice_045 | 保存はしないで次のページを表示して | page_navigate | page_next_without_save | compound_save_page |
| nyamuru_voice_053 | 100パーセント表示に戻して | view_change | zoom_100 | zoom_100 |
| nyamuru_voice_054 | 原稿を百パーセントで見せて | view_change | zoom_100 | zoom_100 |
| nyamuru_voice_065 | 登場人物の設定画面を見せて | view_change | tab_characters | tab_characters |
| nyamuru_voice_079 | 吹き出しの形をふつうに戻して | bubble_set | bubble_shape_normal | bubble_shape_normal |
| nyamuru_voice_090 | この吹き出しの幅を30ミリにして | bubble_set | bubble_resize | bubble_resize |
| nyamuru_voice_091 | 選択した吹き出しの高さを40ミリに変更して | bubble_set | bubble_resize | bubble_resize |
| nyamuru_voice_092 | 吹き出しの幅を25ミリ、高さを35ミリにして | bubble_set | bubble_resize_wh | bubble_resize |
| nyamuru_voice_108 | 吹き出しを2にして | needs_clarification | ambiguous_bubble_value | ambiguous_bubble_value |
| nyamuru_voice_110 | さっきと同じにして | needs_clarification | ambiguous_history | ambiguous_history |
| nyamuru_voice_117 | 台本と人物設定から、この吹き出しの話者を確認して直して | needs_reasoning | reason_speaker | reason_speaker |
| nyamuru_voice_119 | この吹き出しを少し大きくして | needs_reasoning | reason_resize | reason_resize |
| nyamuru_voice_121 | 保存してから次のページに進んで | compound_request | compound_save_page | compound_save_page |
| nyamuru_voice_124 | リドゥしてから保存して | compound_request | compound_redo_save | compound_redo_save |
| nyamuru_voice_132 | 新しい作品を作って | out_of_scope_request | out_new_project | out_new_project |
| nyamuru_voice_135 | このページを削除して | out_of_scope_request | out_delete_page | out_delete_page |
| nyamuru_voice_145 | さっき保存したよ | not_command | save_report | save_report |
| nyamuru_voice_152 | 今回はリドゥしないで | not_command | redo_negative | redo_basic |
| nyamuru_voice_164 | 印刷キューって使えるの？ | not_command | print_capability_question | print_capability_question |
| nyamuru_voice_180 | コマシンクロって何？ | not_command | panel_sync_set_explanation | inner_frame_snap_set_explanation |
| nyamuru_voice_200 | 内枠スナップって何？ | not_command | inner_frame_snap_set_explanation | inner_frame_snap_set_explanation |
| nyamuru_voice_220 | コマスナップって何？ | not_command | panel_gap_snap_set_explanation | inner_frame_snap_set_explanation |
| nyamuru_voice_306 | ベクターペンって何？ | not_command | paint_pen_question | paint_pen_question |
| nyamuru_voice_309 | コマ3の | needs_clarification | incomplete | incomplete |
| nyamuru_voice_315 | ラスターペンに変えて、文字の頭をそろえて | compound_request | pen_and_align | pen_and_align |

## 分割後の近接文面検査

NFKC・大文字小文字・記号空白の正規化後、異なるsplitの全ペアをSequenceMatcherで確認。意味同一性の証明ではなく、全文レビューを補助する検査。上位10ペアを残す。

| 類似度 | 例A | split | 例B | split |
|---:|---|---|---|---|
| 0.762 | nyamuru_voice_077 この吹き出しを四角にして | train | nyamuru_voice_108 吹き出しを2にして | test |
| 0.750 | nyamuru_voice_056 左右のページを見開きで表示して | train | nyamuru_voice_122 前のページを開いて、見開き表示にして | dev |
| 0.750 | nyamuru_voice_107 表示を切り替えて | train | nyamuru_voice_311 ペンを切り替えて | dev |
| 0.741 | nyamuru_voice_077 この吹き出しを四角にして | train | nyamuru_voice_095 この吹き出しの話者を小雪にして | dev |
| 0.737 | nyamuru_voice_291 ベクターペンに変えて | train | nyamuru_voice_306 ベクターペンって何？ | test |
| 0.727 | nyamuru_voice_012 アンドゥして | train | nyamuru_voice_021 リドゥして | test |
| 0.714 | nyamuru_voice_077 この吹き出しを四角にして | train | nyamuru_voice_090 この吹き出しの幅を30ミリにして | test |
| 0.710 | nyamuru_voice_095 この吹き出しの話者を小雪にして | dev | nyamuru_voice_090 この吹き出しの幅を30ミリにして | test |
| 0.706 | nyamuru_voice_032 一ページ先を表示して | train | nyamuru_voice_039 ページ五を表示 | dev |
| 0.706 | nyamuru_voice_166 コマシンクロオン | train | nyamuru_voice_180 コマシンクロって何？ | test |

単に編集対象の名詞や命令動詞が共通する例まで全て連結しない。例えば、ベクターペンへの切替と説明質問は全体の依頼内容が異なる。
意味レビューの結合理由と留保はfamily-review.json、全割当はsplit-plan.jsonを参照。
