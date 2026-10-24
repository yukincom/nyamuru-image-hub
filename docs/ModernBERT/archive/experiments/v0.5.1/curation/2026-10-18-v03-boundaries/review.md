# ニャムル音声分類：否定・延期／Undo・Redo／複数操作の追加288件

2026-10-18。全件Codex作成の合成例。実録音・ASR出力ではありません。既存19分類の定義とIDを変更していません。

**全288件は学習専用候補です。** v0.2のテスト結果を見て作ったため、この追加分や既存の近い例を新しい独立テストへ回してはいけません。各行の `text` のみを入力し、`label` を教師ラベルとします。引数、注記、group、family等は入力しません。

ラベル・意味・引数の注釈は執筆者および独立レビューで確認済みです。利用者による各行の個別レビューは未実施です。追加・引継ぎ自体は利用者から依頼されています。

## 分類数

| 分類 | 追加件数 |
|---|---:|
| `save` | 16 |
| `undo` | 40 |
| `redo` | 44 |
| `page_navigate` | 12 |
| `bubble_set` | 23 |
| `needs_clarification` | 4 |
| `compound_request` | 56 |
| `out_of_scope_request` | 4 |
| `not_command` | 64 |
| `panel_sync_set` | 1 |
| `inner_frame_snap_set` | 1 |
| `panel_gap_snap_set` | 1 |
| `generate_request` | 11 |
| `paint_tool_set` | 6 |
| `text_frames_align` | 5 |

## v03_save_hold_now

重点: `negation_defer` / 関連family: `v03_save_hold_and_retraction`

既存の関連group: `save_negative`, `v02_routes_noaction_preserve`, `save_edits`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_925 | まだ見直している途中だから、今の変更は保存しないでね。 | not_command | {} | 現在の保存を禁止。条件成立後の予約依頼は含まない。 |
| nyamuru_voice_926 | セーブは保留で。今は何も書き込まないで。 | not_command | {} | 保存の延期のみ。 |
| nyamuru_voice_927 | 確定前の状態なので、保存ボタンは押さずに待って。 | not_command | {} | 保存を実行しないという依頼。 |
| nyamuru_voice_928 | 保存はまだ早い。私が頼むまではそのままでいい。 | not_command | {} | 新たな現在の操作はない。 |
| nyamuru_voice_929 | 見直しが済んだので、今の変更をここで保存してね。 | save | {"target": "current_document"} | 確認完了の報告に続く現在の保存依頼。 |
| nyamuru_voice_930 | 保留していたセーブを、今ここで実行して。 | save | {"target": "current_document"} | 過去の保留を説明し、今の実行を明示。 |
| nyamuru_voice_931 | この状態で確定するので、作品の保存をお願い。 | save | {"target": "current_document"} | 確定の説明は独立したアプリ操作ではない。 |
| nyamuru_voice_932 | 待たなくていいよ。今開いている作品を保存してください。 | save | {"target": "current_document"} | 待機の解除を理由とする保存依頼。 |

## v03_save_final_correction

重点: `negation_defer` / 関連family: `v03_save_hold_and_retraction`

既存の関連group: `save_self_correction`, `save_negative`, `save_basic`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_933 | 保存お願い……あ、今のは取り消し。まだ保存しないで。 | not_command | {} | 同じ発話内で保存依頼を撤回。実行済み編集のUndoではない。 |
| nyamuru_voice_934 | セーブしてと言いかけたけど、やめておく。現状のまま待って。 | not_command | {} | 未実行の発話を撤回。 |
| nyamuru_voice_935 | 作品を保存して。訂正、保存するのはまだなしにして。 | not_command | {} | 最後に肯定されている操作がない。 |
| nyamuru_voice_936 | ここで保存、いや違う、確認が残っているから実行しないで。 | not_command | {} | 直前の保存発話を否定。 |
| nyamuru_voice_937 | 保存しなくていいって言ったけど訂正する。今すぐ保存して。 | save | {"target": "current_document"} | 最後の現在依頼は保存。 |
| nyamuru_voice_938 | まだセーブしないで、じゃなくて、この状態をセーブしておいて。 | save | {"target": "current_document"} | 否定を撤回した単一の保存依頼。 |
| nyamuru_voice_939 | 保存は後でにしよう……やっぱり今保存を実行して。 | save | {"target": "current_document"} | 延期を撤回して今実行。 |
| nyamuru_voice_940 | 今の「保存は不要」は言い間違い。作品を保存してください。 | save | {"target": "current_document"} | 引用内の否定ではなく後続の実行依頼を採る。 |

## v03_defer_until_new_request

重点: `negation_defer` / 関連family: `v03_save_hold_and_retraction`

既存の関連group: `v02_routes_noaction_preserve`, `save_negative`, `page_negative`, `generate_current_page`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_941 | 確認が一か所残っているので、保存の実行は今は見送って。 | not_command | {} | 現在の保存延期。 |
| nyamuru_voice_942 | 保存するかは後で決めるから、今は保存を始めないで。 | not_command | {} | 意思決定前で、現在の実行依頼はない。 |
| nyamuru_voice_943 | 私が「保存して」と改めて言うまでは、セーブせずに待って。 | not_command | {} | 引用は将来の合図の説明。予約保存は依頼していない。 |
| nyamuru_voice_944 | まだ見比べたいので、次のページを開くのは待って。 | not_command | {} | ページ移動の延期。 |
| nyamuru_voice_945 | 画像生成は準備が終わるまで保留。今は開始しないでね。 | not_command | {} | 未開始の生成を保留。実行中生成の中止ではない。 |
| nyamuru_voice_946 | もう少し考えるので、3D背景の候補を出すのは今はなしで。 | not_command | {} | 候補提示を延期。 |
| nyamuru_voice_947 | 文字枠の位置は確認中だから、頭をそろえる処理は待ってほしい。 | not_command | {} | 整列を延期。 |
| nyamuru_voice_948 | 元に戻すかはまだ決めていない。Undoを実行せず待ってて。 | not_command | {} | Undoの不実行を明示。 |

## v03_history_prohibition

重点: `negation_defer` / 関連family: `v03_history_negated_current_action`

既存の関連group: `undo_negative`, `redo_negative`, `undo_basic`, `redo_basic`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_949 | この変更を残したいから、アンドゥはかけないでね。 | not_command | {} | Undoは禁止。 |
| nyamuru_voice_950 | 元に戻すボタンの操作は今はやめておいて。 | not_command | {} | 未実行Undoの禁止。 |
| nyamuru_voice_951 | 取り消したままでいいので、リドゥで復活させないで。 | not_command | {} | Redoは禁止。 |
| nyamuru_voice_952 | やり直すボタンは押さなくていい。履歴は動かさないで。 | not_command | {} | 現在の編集操作なし。 |
| nyamuru_voice_953 | この変更は残さなくていい。直前の編集をUndoで一つ取り消して。 | undo | {"count": 1} | 保持の否定と、現在のUndo依頼。 |
| nyamuru_voice_954 | そのままにしないで、いま加えた変更を一回アンドゥして。 | undo | {"count": 1} | 否定語があっても肯定されたUndoが残る。 |
| nyamuru_voice_955 | 取り消したままにはしないで、最後の変更を一回リドゥして。 | redo | {"count": 1} | Redoで取り消し済み編集を再適用。 |
| nyamuru_voice_956 | やり直しを保留しなくていいので、Redoを一度実行して。 | redo | {"count": 1} | 延期を否定し、Redoを依頼。 |

## v03_page_preserve_or_move

重点: `negation_defer` / 関連family: `v03_page_negation_positive_contrast`

既存の関連group: `page_negative`, `page_next`, `page_previous`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_957 | 読んでいる途中なので、次のページにはまだ移らないで。 | not_command | {} | 現在ページを維持。 |
| nyamuru_voice_958 | 前のページを開く必要はないよ。表示は変えないで。 | not_command | {} | 移動不要の説明。 |
| nyamuru_voice_959 | 三ページに進む話はいったん保留。今のページにいて。 | not_command | {} | ページ移動の延期。 |
| nyamuru_voice_960 | ページ送りはしないで、いまの表示のままでお願い。 | not_command | {} | 設定変更を伴わない保持。 |
| nyamuru_voice_961 | ここには留まらず、次のページへ一枚進めて。 | page_navigate | {"direction": "next", "count": 1} | 現在のページ移動が肯定される。 |
| nyamuru_voice_962 | 次ではなく、ひとつ前のページを表示してください。 | page_navigate | {"direction": "previous", "count": 1} | 否定された方向は捨て、前へ一枚。 |
| nyamuru_voice_963 | 前には戻らなくていいから、ページを一枚先へ送って。 | page_navigate | {"direction": "next", "count": 1} | 前への移動は否定、次への移動だけ依頼。 |
| nyamuru_voice_964 | 今のページではなく、三ページを開いてほしい。 | page_navigate | {"page_number": 3} | ページ番号指定の単一操作。 |

## v03_disabled_state_vs_prohibit

重点: `negation_defer` / 関連family: `v03_desired_state_and_prohibition`

既存の関連group: `inner_frame_snap_set_desired_state`, `panel_gap_snap_set_desired_state`, `panel_sync_set_desired_state`, `bubble_tail`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_965 | 内枠スナップをオンにする操作はしないで。 | not_command | {} | オン禁止だけではオフへの変更を意味しない。 |
| nyamuru_voice_966 | コマスナップはオフにしないで、現在の設定を維持して。 | not_command | {} | オフ禁止。現在値を推測しない。 |
| nyamuru_voice_967 | コマシンクロの設定は触らないでおいて。 | not_command | {} | 変更禁止。 |
| nyamuru_voice_968 | この吹き出しのしっぽは消さず、そのまま残して。 | not_command | {} | 現在のしっぽの保持。 |
| nyamuru_voice_969 | 内枠に吸着しない設定にしたいので、内枠スナップを無効化して。 | inner_frame_snap_set | {"enabled": false} | 希望状態はオフ。操作禁止ではない。 |
| nyamuru_voice_970 | コマ間に吸着させないよう、コマスナップをオフへ設定して。 | panel_gap_snap_set | {"enabled": false} | 希望状態はオフ。 |
| nyamuru_voice_971 | コマを同期させない設定にしてほしい。コマシンクロは無効で。 | panel_sync_set | {"enabled": false} | 希望状態はオフ。 |
| nyamuru_voice_972 | この吹き出しはしっぽなしの状態に変更して。 | bubble_set | {"target": "selected_bubble", "field": "tail_enabled", "value": false} | しっぽ無しという値を設定する依頼。 |

## v03_generation_wait_or_start

重点: `negation_defer` / 関連family: `v03_generation_negation_positive_contrast`

既存の関連group: `generate_selection`, `generate_current_page`, `generate_selected_panel`, `generate_character`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_973 | この選択範囲の生成はまだしないで。 | not_command | {} | 未開始の生成は禁止。 |
| nyamuru_voice_974 | ページ一枚を生成するのは後で考える。今は始めなくていい。 | not_command | {} | 生成開始を延期。 |
| nyamuru_voice_975 | このコマの生成をお願いしかけたけど、今回はやめておくね。 | not_command | {} | 同発話内で未実行依頼を撤回。 |
| nyamuru_voice_976 | 人物の生成は保留にして。私が頼むまでは開始しないで。 | not_command | {} | 未開始の生成の延期。 |
| nyamuru_voice_977 | 待たずに、今選択している対象の生成を始めて。 | generate_request | {"target": "selection"} | 生成の開始を明示。 |
| nyamuru_voice_978 | ページ全体ではなく、このコマだけを生成してほしい。 | generate_request | {"target": "selected_panel"} | 否定した範囲は除外し、選択コマを対象にする。 |
| nyamuru_voice_979 | 人物だけの生成はもう保留にしなくていい。選択中の人物を生成して。 | generate_request | {"target": "selected_character"} | 保留を解除した現在の依頼。 |
| nyamuru_voice_980 | 生成しないという話は取り消す。今のページ一枚を生成してください。 | generate_request | {"target": "current_page"} | 不実行の撤回。Undoではない。 |

## v03_quoted_negative_text

重点: `negation_defer` / 関連family: `v03_quoted_commands_as_content`

既存の関連group: `save_how_question`, `save_negative`, `bubble_quoted_command`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_981 | 「保存しないで」という台詞を考えているだけで、操作の依頼ではないよ。 | not_command | {} | 引用台詞についての報告。 |
| nyamuru_voice_982 | 主人公が「元に戻して」と叫ぶ予定だよ。今の編集は変えないでね。 | not_command | {} | 台詞の報告と編集保持。 |
| nyamuru_voice_983 | 「待って、やり直して」という台詞を考えていた、という報告だよ。 | not_command | {} | 引用された台詞についての報告。現在の編集依頼なし。 |
| nyamuru_voice_984 | 「保存してから次へ」という説明を読んだ、という報告だよ。 | not_command | {} | 複数命令を含む引用も実行依頼ではない。 |
| nyamuru_voice_985 | 選択中の吹き出しの本文を「保存しないで」に入れ替えて。 | bubble_set | {"target": "selected_bubble", "field": "text", "value": "保存しないで"} | 本文置換だけを実行。引用内の否定を操作制御にしない。 |
| nyamuru_voice_986 | 今の吹き出しに「まだ元に戻さないで」と入力して。 | bubble_set | {"target": "selected_bubble", "field": "text", "value": "まだ元に戻さないで"} | 本文は一字も変更しない。 |
| nyamuru_voice_987 | この吹き出しのセリフを「リドゥは待って」にして。 | bubble_set | {"target": "selected_bubble", "field": "text", "value": "リドゥは待って"} | 入力内容の中のRedoや延期は実行対象でない。 |
| nyamuru_voice_988 | 吹き出しの本文には「保存して、次のページへ」と入れて。 | bubble_set | {"target": "selected_bubble", "field": "text", "value": "保存して、次のページへ"} | 引用は本文。複数操作と数えない。 |

## v03_negated_wait_not_action

重点: `negation_defer` / 関連family: `v03_negated_wait_positive_request`

既存の関連group: `save_basic`, `undo_basic`, `redo_basic`, `save_negative`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_989 | 保存を待つ必要はなくなったので、作品を今保存して。 | save | {"target": "current_document"} | 待機不要は実行禁止ではない。 |
| nyamuru_voice_990 | セーブしないまま進めたくないから、ここで保存を実行して。 | save | {"target": "current_document"} | 未保存の否定を理由に、保存を明示依頼。 |
| nyamuru_voice_991 | 保存を省略しないでね。今の作品をセーブしておいて。 | save | {"target": "current_document"} | 省略を禁止し、保存を肯定。 |
| nyamuru_voice_992 | 「今は保存しないで」は撤回するので、通常の保存を一回して。 | save | {"target": "current_document"} | 発話の撤回はUndoではない。 |
| nyamuru_voice_993 | アンドゥしなくていいとは言っていないよ。最後の編集を一回戻して。 | undo | {"count": 1} | 後続でUndoを明示。 |
| nyamuru_voice_994 | 戻すのを待たずに、編集履歴のUndoを一回だけ実行して。 | undo | {"count": 1} | 延期の否定と単一Undo。 |
| nyamuru_voice_995 | リドゥは不要、というのは間違い。取り消した編集を一つ復活させて。 | redo | {"count": 1} | 最後に肯定された依頼はRedo。 |
| nyamuru_voice_996 | やり直しを見送らず、履歴のRedoを一段だけ進めてください。 | redo | {"count": 1} | 履歴の再適用が明示される。 |

## v03_noaction_reports_questions

重点: `negation_defer` / 関連family: `v03_history_and_save_mentions`

既存の関連group: `save_status_question`, `save_report`, `undo_question`, `redo_report`, `v02_routes_noaction_thought`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_997 | まだ保存していないのは分かっているよ。これは状況の説明だけ。 | not_command | {} | 未保存の報告で、保存依頼ではない。 |
| nyamuru_voice_998 | 保存しないまま閉じると、どの変更が消えるの？ | not_command | {} | 操作結果の質問。閉じることも依頼していない。 |
| nyamuru_voice_999 | 保存を後回しにした理由を話していただけだよ。 | not_command | {} | 理由の報告。 |
| nyamuru_voice_1000 | 今の変更、まだ保存されていないという理解で合ってる？ | not_command | {} | 状態の確認。 |
| nyamuru_voice_1001 | アンドゥを二回使ったところです。 | not_command | {} | 完了済み操作の報告。 |
| nyamuru_voice_1002 | リドゥを押せないのは、履歴がもう残っていないから？ | not_command | {} | 状態・仕様の質問。 |
| nyamuru_voice_1003 | 元に戻したら吹き出しが消えた、と伝えたかっただけ。 | not_command | {} | 過去のUndo結果の報告。 |
| nyamuru_voice_1004 | やり直すボタンと元に戻すボタンの違いを説明して。 | not_command | {} | 説明要求。操作は発行しない。 |

## v03_pen_alignment_negation

重点: `negation_defer` / 関連family: `v03_tool_alignment_prohibition`

既存の関連group: `paint_pen_choice`, `text_frames_top`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_1005 | ラスターペンへの切り替えは今はしないで。 | not_command | {} | ツール変更禁止。 |
| nyamuru_voice_1006 | ベクターペンにするのは待って。今の道具を使い続けたい。 | not_command | {} | 現在のツールを維持。 |
| nyamuru_voice_1007 | 選択中の文字枠の頭は、まだそろえなくていいよ。 | not_command | {} | 整列不要の指定。 |
| nyamuru_voice_1008 | 文字の上端を合わせる操作は保留。今の位置を残して。 | not_command | {} | 整列延期。 |
| nyamuru_voice_1009 | ベクターのままにせず、ラスターペンを選び直して。 | paint_tool_set | {"tool": "pen"} | 現在のツール選択依頼。 |
| nyamuru_voice_1010 | ラスターにはしないで、ベクターペンを選択してください。 | paint_tool_set | {"tool": "vector-pen"} | 否定された道具を除いた単一選択。 |
| nyamuru_voice_1011 | 文字位置をばらばらのままにしないで、選んだ文字枠の上端をそろえて。 | text_frames_align | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} | 希望状態を実現する整列依頼。実行可否は別処理。 |
| nyamuru_voice_1012 | 整列を待たなくていいので、選択した文字枠を上揃えにして。 | text_frames_align | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} | 整列の実行を肯定。 |

## v03_not_start_vs_cancel_running

重点: `negation_defer` / 関連family: `v03_generation_hold_vs_running_cancel`

既存の関連group: `generate_current_page`, `out_cancel_generation`, `generate_selection`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_1013 | 生成はまだ始めていないので、そのまま開始せず待ってて。 | not_command | {} | 開始前の不実行。 |
| nyamuru_voice_1014 | このコマの画像を生成する依頼は、今は出さないことにする。 | not_command | {} | 未実行の依頼撤回。 |
| nyamuru_voice_1015 | ページ全体の生成は着手しなくていい。準備だけの話だったよ。 | not_command | {} | 生成の現在依頼なし。 |
| nyamuru_voice_1016 | 生成ボタンを押す前に待って。まだ実行はしないで。 | not_command | {} | 開始前の待機。 |
| nyamuru_voice_1017 | いま走っている画像生成ジョブを中止してください。 | out_of_scope_request | {} | 実行中ジョブの中止依頼は現在19分類の音声操作範囲外。not_commandやUndoではない。 |
| nyamuru_voice_1018 | 進行中のコマ画像の生成を、ここでキャンセルして。 | out_of_scope_request | {} | 現在動作中の処理を止める独立した中止依頼。 |
| nyamuru_voice_1019 | 生成処理がもう始まっているけど、それを停止してほしい。 | out_of_scope_request | {} | 中止は不実行の報告ではない。 |
| nyamuru_voice_1020 | 実行しているページ生成の処理を止めて。Undoではなく生成ジョブの停止だよ。 | out_of_scope_request | {} | 既存out_cancel_generationの境界を保持。 |

## v03_undo_button_phrasing

重点: `undo_redo` / 関連family: `v03_undo_redo_controls`

既存の関連group: `undo_button`, `v02_core_undo_history_control`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_1021 | ツールバーの「元に戻す」を一度押す操作をお願い。 | undo | {"count": 1} | ボタン名はUndo。新規生成ではない。 |
| nyamuru_voice_1022 | 今の編集に対して、元に戻すを一回かけて。 | undo | {"count": 1} | 最新履歴を一件取り消す。 |
| nyamuru_voice_1023 | 画面のUndoボタンと同じことを一度実行してほしい。 | undo | {"count": 1} | Undoの明示。 |
| nyamuru_voice_1024 | 左上の元に戻すボタンを使うつもりで、直前の変更を戻して。 | undo | {"count": 1} | 位置説明より明示された操作名で分類。 |
| nyamuru_voice_1025 | 編集を取り消すほうのボタン、つまりUndoを一回お願い。 | undo | {"count": 1} | 同義の言い換えであり複数操作ではない。 |
| nyamuru_voice_1026 | 元に戻す機能で、いまの編集を一段だけ戻せる？ 実行をお願い。 | undo | {"count": 1} | 能力質問で終わらず現在依頼を明示。 |
| nyamuru_voice_1027 | やり直すの隣にある元に戻すを、一回実行してください。 | undo | {"count": 1} | 参照説明内のRedoは実行しない。 |
| nyamuru_voice_1028 | アンドゥの操作を今一度だけ、ボタンを押すのと同じようにやって。 | undo | {"count": 1} | 回数一回のUndo。 |

## v03_redo_button_phrasing

重点: `undo_redo` / 関連family: `v03_undo_redo_controls`

既存の関連group: `redo_button`, `v02_core_redo_history_control`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_1029 | ツールバーの「やり直す」を一度押す操作をお願い。 | redo | {"count": 1} | ボタン名はRedo。Undoと逆方向。 |
| nyamuru_voice_1030 | いま取り消した編集に、やり直すを一回かけて。 | redo | {"count": 1} | 取り消した履歴の再適用。 |
| nyamuru_voice_1031 | 画面のRedoボタンと同じことを一度実行してほしい。 | redo | {"count": 1} | Redoの明示。 |
| nyamuru_voice_1032 | やり直す機能を使って、Undoで消した変更を一つ復活させて。 | redo | {"count": 1} | 過去のUndoは現在の指示ではない。 |
| nyamuru_voice_1033 | 取り消しを戻すほうのボタン、つまりRedoを一回お願い。 | redo | {"count": 1} | 同義の説明と単一Redo。 |
| nyamuru_voice_1034 | やり直すで、取り消した履歴を一段進められる？ 実行をお願い。 | redo | {"count": 1} | 能力質問だけでなく現在の実行依頼。 |
| nyamuru_voice_1035 | 元に戻すの隣にあるやり直すを、一回実行してください。 | redo | {"count": 1} | 参照説明内のUndoは実行しない。 |
| nyamuru_voice_1036 | リドゥの操作を今一度だけ、ボタンを押すのと同じようにやって。 | redo | {"count": 1} | 回数一回のRedo。 |

## v03_undo_history_count

重点: `undo_redo` / 関連family: `v03_undo_redo_counted_history`

既存の関連group: `undo_count`, `v02_core_undo_bounded_count`, `undo_basic`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_1037 | 編集履歴をUndoで一件だけさかのぼって。 | undo | {"count": 1} | 履歴の方向を明示。 |
| nyamuru_voice_1038 | いちばん新しい編集だけを履歴から取り消してください。 | undo | {"count": 1} | 任意の古い変更検索ではなく最新一件。 |
| nyamuru_voice_1039 | 直前の二操作を、Undo二回で取り消してほしい。 | undo | {"count": 2} | 同じ操作の回数はcompoundにしない。 |
| nyamuru_voice_1040 | 現在位置から履歴を三段、アンドゥで戻して。 | undo | {"count": 3} | 三回のUndo。 |
| nyamuru_voice_1041 | 最後に加えた四つの変更を取り消すので、Undoを四回して。 | undo | {"count": 4} | 回数指定のみ。 |
| nyamuru_voice_1042 | 二回アンドゥをかけて、二つ前の編集状態に戻って。 | undo | {"count": 2} | 後半はUndoの結果の説明で第二操作ではない。 |
| nyamuru_voice_1043 | 履歴を戻すのは一段まで。アンドゥを一回だけ実行して。 | undo | {"count": 1} | 範囲制約つきの単一操作。 |
| nyamuru_voice_1044 | Undoを三回続けて、そこまでの取り消しで止めてね。 | undo | {"count": 3} | 停止は回数上限の説明で別ジョブ中止ではない。 |

## v03_redo_history_count

重点: `undo_redo` / 関連family: `v03_undo_redo_counted_history`

既存の関連group: `redo_count`, `v02_core_redo_bounded_count`, `redo_after_undo`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_1045 | 取り消し済みの履歴をRedoで一件だけ進めて。 | redo | {"count": 1} | 履歴の再適用方向。 |
| nyamuru_voice_1046 | 最後のUndoで取り消した変更を、一件だけ再適用してください。 | redo | {"count": 1} | 新しくUndoしない。 |
| nyamuru_voice_1047 | 二回リドゥして、取り消した二操作を復元してほしい。 | redo | {"count": 2} | 回数指定のみ。 |
| nyamuru_voice_1048 | 今の履歴位置から三段、リドゥで進めて。 | redo | {"count": 3} | 三回のRedo。 |
| nyamuru_voice_1049 | 取り消し履歴の四件を戻したいから、Redoを四回実行して。 | redo | {"count": 4} | 四回の再適用。 |
| nyamuru_voice_1050 | Redoを二回かけて、Undoで消えた二つの編集を復活させて。 | redo | {"count": 2} | 後半は同じ操作の結果。 |
| nyamuru_voice_1051 | 復活させる変更は一件だけ。リドゥを一段で止めてね。 | redo | {"count": 1} | 明示された一回のRedo。 |
| nyamuru_voice_1052 | リドゥを三回続けて、それ以上の履歴は適用しないで。 | redo | {"count": 3} | 制約の否定をRedo禁止にしない。 |

## v03_undo_specific_latest_edit

重点: `undo_redo` / 関連family: `v03_latest_edit_history`

既存の関連group: `undo_last_edit`, `v02_core_undo_accidental_edit`, `v02_core_undo_reject_latest`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_1053 | 直前に動かした吹き出しの位置変更だけ、Undo一回で取り消して。 | undo | {"count": 1} | 最新操作であることを本文で明示。 |
| nyamuru_voice_1054 | いまの文字の打ち替えは間違いだったので、最後の編集をアンドゥして。 | undo | {"count": 1} | 新しい本文指定でなく履歴取消。 |
| nyamuru_voice_1055 | 最後に加えたしっぽの変更を、直前の状態へUndoで戻して。 | undo | {"count": 1} | 現在の履歴の最新一件。 |
| nyamuru_voice_1056 | いま行ったコマ枠の修正を、一回のアンドゥで取り消してください。 | undo | {"count": 1} | 編集対象の名前を新規操作と混同しない。 |
| nyamuru_voice_1057 | この直前の編集は失敗だから、保存せずにUndoを一回して。 | undo | {"count": 1} | 保存は否定、Undoのみ。 |
| nyamuru_voice_1058 | 最後の線を引く前の状態に、履歴を一段戻してほしい。 | undo | {"count": 1} | 最新の描画履歴一件を取り消す。 |
| nyamuru_voice_1059 | 直前のサイズ変更は大きすぎた。編集を一件取り消して。 | undo | {"count": 1} | 新しいサイズの推定は依頼されていない。 |
| nyamuru_voice_1060 | いま加えた変更だけなかったことにして。アンドゥは一回で。 | undo | {"count": 1} | 明示回数の単一Undo。 |

## v03_redo_restore_last_undo

重点: `undo_redo` / 関連family: `v03_restoring_cancelled_edit`

既存の関連group: `redo_after_undo`, `v02_core_redo_accidental_undo`, `v02_core_redo_regret_undo`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_1061 | いまUndoで消した吹き出しの移動を、Redo一回で復活させて。 | redo | {"count": 1} | 取り消した最新履歴の再適用。 |
| nyamuru_voice_1062 | 文字の修正を戻しすぎたので、直前に取り消した一件をリドゥして。 | redo | {"count": 1} | 過去の取り消しを戻す。 |
| nyamuru_voice_1063 | さっきのUndoは不要だった。取り消した変更を一つ再適用して。 | redo | {"count": 1} | 今はRedo。 |
| nyamuru_voice_1064 | 元に戻すを誤って押したので、やり直すでその一回分を戻して。 | redo | {"count": 1} | 押したUndoは完了済み。 |
| nyamuru_voice_1065 | 消した線を描き直すのではなく、Undoした直前の描画をRedoで戻して。 | redo | {"count": 1} | 新規描画ではない。 |
| nyamuru_voice_1066 | Undo前の配置のほうがよかったから、今の取り消しを一回リドゥして。 | redo | {"count": 1} | 履歴の向きを意味で決める。 |
| nyamuru_voice_1067 | 最後に取り消したしっぽの編集を、履歴から一件復活させてほしい。 | redo | {"count": 1} | 具体的設定値を新規推定しない。 |
| nyamuru_voice_1068 | 間違ったのはUndoのほうだったので、直前の取り消しをRedoで打ち消して。 | redo | {"count": 1} | Undoという語があっても現在依頼はRedo。 |

## v03_history_final_correction

重点: `undo_redo` / 関連family: `v03_undo_redo_final_correction`

既存の関連group: `v02_core_undo_self_correction`, `v02_core_redo_self_correction`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_1069 | Redoを一回、じゃなくてUndoを一回に訂正する。 | undo | {"count": 1} | 撤回されたRedoは数えない。 |
| nyamuru_voice_1070 | やり直すを押してと言いかけたけど、元に戻すを一度お願い。 | undo | {"count": 1} | 最終指示はUndo。 |
| nyamuru_voice_1071 | 二回リドゥ、違う、二回アンドゥしてほしい。 | undo | {"count": 2} | 方向の言い直しであり二種類の操作ではない。 |
| nyamuru_voice_1072 | 履歴を進めてというのは撤回。アンドゥで一段戻して。 | undo | {"count": 1} | 発話撤回後のUndoのみ。 |
| nyamuru_voice_1073 | Undoを一回、じゃなくてRedoを一回に訂正する。 | redo | {"count": 1} | 撤回されたUndoは数えない。 |
| nyamuru_voice_1074 | 元に戻すを押してと言いかけたけど、やり直すを一度お願い。 | redo | {"count": 1} | 最終指示はRedo。 |
| nyamuru_voice_1075 | 三回アンドゥ、訂正、三回リドゥのほうを実行して。 | redo | {"count": 3} | 現在肯定される方向と回数を採る。 |
| nyamuru_voice_1076 | 履歴を戻す話はなし。取り消した変更を一つRedoで復元して。 | redo | {"count": 1} | Undoは撤回。 |

## v03_history_navigation_boundary

重点: `undo_redo` / 関連family: `v03_history_vs_navigation`

既存の関連group: `undo_vs_page`, `page_previous`, `page_next`, `redo_after_undo`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_1077 | 編集履歴ではなく、表示するページを一枚前へ戻して。 | page_navigate | {"direction": "previous", "count": 1} | 履歴のUndoではない。 |
| nyamuru_voice_1078 | Undoはしないで。前のページを開くだけでいい。 | page_navigate | {"direction": "previous", "count": 1} | Undoは否定され、移動のみ残る。 |
| nyamuru_voice_1079 | やり直す操作ではなく、次のページに一枚進んで。 | page_navigate | {"direction": "next", "count": 1} | Redoという説明は現在依頼ではない。 |
| nyamuru_voice_1080 | ページ送りを一枚先へお願い。編集の取り消しはしないでね。 | page_navigate | {"direction": "next", "count": 1} | 履歴保持は制約。 |
| nyamuru_voice_1081 | 前のページには移らず、このページの直前の編集を一回Undoして。 | undo | {"count": 1} | 移動の否定と履歴取消。 |
| nyamuru_voice_1082 | 戻してほしいのはページじゃなくて最新の変更。アンドゥを一回して。 | undo | {"count": 1} | 対象は履歴。 |
| nyamuru_voice_1083 | 次のページを開く意味ではないよ。取り消した編集を一回Redoで進めて。 | redo | {"count": 1} | 再適用だけを依頼。 |
| nyamuru_voice_1084 | ページはこのままで、最後の取り消しを一件リドゥして。 | redo | {"count": 1} | 表示保持の制約とRedo。 |

## v03_redo_or_new_generation

重点: `undo_redo` / 関連family: `v03_history_vs_regeneration`

既存の関連group: `redo_vs_generate`, `v02_core_redo_not_regeneration`, `generate_selected_panel`, `generate_current_page`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_1085 | 画像を作り直さずに、取り消した生成結果の配置をRedo一回で復元して。 | redo | {"count": 1} | 再生成ではなく履歴の再適用。 |
| nyamuru_voice_1086 | 新しい候補を生成するのではなく、最後のUndoをリドゥで戻して。 | redo | {"count": 1} | 生成は否定される。 |
| nyamuru_voice_1087 | やり直すボタンで一件復元して。画像の生成し直しは不要だよ。 | redo | {"count": 1} | ボタン名でRedoを明示。 |
| nyamuru_voice_1088 | 同じ画像を再生成する話ではないよ。履歴のRedoを一度だけ。 | redo | {"count": 1} | 履歴の一回再適用。 |
| nyamuru_voice_1089 | 履歴のリドゥじゃなく、このコマの画像を新しく生成し直して。 | generate_request | {"target": "selected_panel"} | Redoを否定して新規生成。 |
| nyamuru_voice_1090 | Undoの取り消しではなく、選択している人物をもう一度生成して。 | generate_request | {"target": "selected_character"} | 生成対象は選択人物。 |
| nyamuru_voice_1091 | やり直すボタンは使わず、現在のページ一枚を生成し直してほしい。 | generate_request | {"target": "current_page"} | 履歴操作ではなくページ生成。 |
| nyamuru_voice_1092 | Redoという言い方は間違い。選択中の対象の画像生成を新しく実行して。 | generate_request | {"target": "selection"} | 自己訂正後は生成のみ。 |

## v03_history_quoted_or_reported

重点: `undo_redo` / 関連family: `v03_quoted_commands_as_content`

既存の関連group: `bubble_quoted_command`, `undo_question`, `redo_report`, `v02_routes_noaction_report`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_1093 | この吹き出しの本文を「アンドゥを一回お願い」にして。 | bubble_set | {"target": "selected_bubble", "field": "text", "value": "アンドゥを一回お願い"} | 引用は本文。実際のUndoは依頼していない。 |
| nyamuru_voice_1094 | 選択した吹き出しに「リドゥしてよ」と書き込んで。 | bubble_set | {"target": "selected_bubble", "field": "text", "value": "リドゥしてよ"} | 本文変更のみ。 |
| nyamuru_voice_1095 | セリフ欄には「元に戻してからやり直して」と入力して。 | bubble_set | {"target": "selected_bubble", "field": "text", "value": "元に戻してからやり直して"} | 引用中の二操作を実行しない。 |
| nyamuru_voice_1096 | この吹き出しの台詞を「UndoじゃなくRedoだ」に差し替えて。 | bubble_set | {"target": "selected_bubble", "field": "text", "value": "UndoじゃなくRedoだ"} | 本文は原文のまま。 |
| nyamuru_voice_1097 | さっき「アンドゥを一回」と言った理由を説明しているだけだよ。 | not_command | {} | 過去発話への言及。 |
| nyamuru_voice_1098 | リドゥを一回実行したので、今は元の線が見えているよ。 | not_command | {} | 完了報告。 |
| nyamuru_voice_1099 | 元に戻すボタンの名前を確認したかっただけ。 | not_command | {} | 名前についての説明。 |
| nyamuru_voice_1100 | いまUndoとRedoを順番に押して確かめた、という報告です。 | not_command | {} | 完了済み二操作は現在のcompoundではない。 |

## v03_history_missing_direction

重点: `undo_redo` / 関連family: `v03_ambiguous_history_reference`

既存の関連group: `ambiguous_back`, `ambiguous_again`, `ambiguous_history`, `v02_routes_noaction_state`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_1101 | 履歴のほうを一つ動かしてほしい。 | needs_clarification | {} | 方向がない。UndoかRedoを決められない。 |
| nyamuru_voice_1102 | さっきの状態にして。 | needs_clarification | {} | どの履歴状態か不明。 |
| nyamuru_voice_1103 | 戻すほうじゃない、もう片方のあれをお願い。 | needs_clarification | {} | 操作が本文だけでは特定できない。 |
| nyamuru_voice_1104 | 前と同じ感じにもう一回やって。 | needs_clarification | {} | 対象も操作も省略。Redoに寄せない。 |
| nyamuru_voice_1105 | いま履歴は何回分戻せる？ | not_command | {} | Undo可能数の質問。 |
| nyamuru_voice_1106 | 直前に押したのはUndoとRedoのどっちだった？ | not_command | {} | 履歴状態についての質問。 |
| nyamuru_voice_1107 | まだリドゥできる変更が残っているか知りたい。 | not_command | {} | 実行せず状態を尋ねる。 |
| nyamuru_voice_1108 | 元に戻すを押したら、ページ番号も変わるのか説明して。 | not_command | {} | 仕様説明の要求。 |

## v03_history_repeat_or_pair

重点: `undo_redo` / 関連family: `v03_count_vs_distinct_operations`

既存の関連group: `undo_count`, `redo_count`, `compound_undo_save`, `compound_redo_save`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_1109 | アンドゥを二回続けてお願い。それだけでいい。 | undo | {"count": 2} | 同じ履歴操作の回数。 |
| nyamuru_voice_1110 | 最後の三つを取り消すので、Undo三回だけ実行して。 | undo | {"count": 3} | 同一操作の反復。 |
| nyamuru_voice_1111 | リドゥを二段分まとめて実行してほしい。 | redo | {"count": 2} | 同一操作の回数。 |
| nyamuru_voice_1112 | 取り消し済みの三件をRedo三回でまとめて再適用して。 | redo | {"count": 3} | 同一操作の回数。 |
| nyamuru_voice_1113 | まずUndoを一回実行して、結果を見比べるために続けてRedoも一回実行して。 | compound_request | {} | UndoとRedoの両方を順に実行する明示依頼。 |
| nyamuru_voice_1114 | Redoを一回実行して、その後でUndoを一回実行して。 | compound_request | {} | 自己訂正ではなく順序つきの二操作。 |
| nyamuru_voice_1115 | 二回アンドゥしてから、その状態を作品に保存してください。 | compound_request | {} | Undo二回を一操作種として数えても保存が独立して残る。 |
| nyamuru_voice_1116 | 一回リドゥしてから、その結果を続けて通常保存してほしい。 | compound_request | {} | Redoと保存。 |

## v03_save_then_navigation

重点: `compound_boundary` / 関連family: `v03_save_and_page_order`

既存の関連group: `compound_save_page`, `v02_routes_compound_save_page`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_1117 | いまの編集をセーブして、そのあと隣のページを一枚先へ開いて。 | compound_request | {} | 保存成功後に次ページへ移動。後半だけ実行しない。 |
| nyamuru_voice_1118 | まず作品を通常保存して、済んだら三ページを表示してください。 | compound_request | {} | 今回の保存と、その完了後のページ移動を依頼。 |
| nyamuru_voice_1119 | まず通常保存、次に一つ前のページへの移動をお願い。 | compound_request | {} | 保存→前ページの順序。 |
| nyamuru_voice_1120 | 保存ボタンと同じ保存を一回してから、先頭のページへ戻って。 | compound_request | {} | 保存→先頭ページ。Undoではない。 |
| nyamuru_voice_1121 | 現時点の作品を記録して、それが終わったら最終ページを開いて。 | compound_request | {} | 作品保存→最終ページ。 |
| nyamuru_voice_1122 | 今の変更を保存するのと、四ページを開くのをその順でやって。 | compound_request | {} | 二つの独立した依頼が肯定される。 |
| nyamuru_voice_1123 | セーブしてから二枚先へページを送ってほしい。 | compound_request | {} | 保存と、次方向二ページの移動。 |
| nyamuru_voice_1124 | この状態を保存して、それからページを一枚だけ戻してね。 | compound_request | {} | 保存と前ページ移動。 |

## v03_navigation_then_save

重点: `compound_boundary` / 関連family: `v03_save_and_page_order`

既存の関連group: `compound_save_page`, `v02_routes_compound_save_page`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_1125 | 次のページを開いてから、作品を通常保存して。 | compound_request | {} | ページ移動→保存。順序を逆転しない。 |
| nyamuru_voice_1126 | 五ページを表示して、その状態で作品の保存もお願い。 | compound_request | {} | ページ表示と保存の二依頼。 |
| nyamuru_voice_1127 | 先頭のページへ移った後、今の作品をセーブしてください。 | compound_request | {} | 先頭表示→保存。 |
| nyamuru_voice_1128 | 一ページ前へ戻って、それから作品を保存しておいて。 | compound_request | {} | 前ページ→保存。Undoではない。 |
| nyamuru_voice_1129 | ページを二枚進めてから、保存を一度実行してほしい。 | compound_request | {} | 回数付き移動と保存。 |
| nyamuru_voice_1130 | まず最後のページを開く。その次に作品の保存をして。 | compound_request | {} | 二文とも現在の実行依頼。 |
| nyamuru_voice_1131 | 三ページへ切り替えるのと保存を、移動が先になる順でお願い。 | compound_request | {} | 順序は移動→保存。 |
| nyamuru_voice_1132 | 表示を二ページ目へ移してから、セーブまでやってください。 | compound_request | {} | ページ番号指定と保存。 |

## v03_history_and_save

重点: `compound_boundary` / 関連family: `v03_history_plus_save`

既存の関連group: `compound_undo_save`, `compound_redo_save`, `v02_routes_compound_history_save`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_1133 | 最新の編集を一件取り消して、その結果を保存して。 | compound_request | {} | Undo一回→保存。 |
| nyamuru_voice_1134 | Undoを一回かけて、その状態で通常の保存までお願い。 | compound_request | {} | Undo→保存。 |
| nyamuru_voice_1135 | 最後の二変更をアンドゥしてから、作品をセーブしてください。 | compound_request | {} | Undo二回→保存。 |
| nyamuru_voice_1136 | 直前の変更を元に戻す操作と、作品の保存を続けて行って。 | compound_request | {} | 履歴取消と保存。 |
| nyamuru_voice_1137 | 取り消した編集を一件リドゥして、復活した状態を保存して。 | compound_request | {} | Redo一回→保存。 |
| nyamuru_voice_1138 | やり直すボタンの操作を一回、その次に保存を一回お願い。 | compound_request | {} | Redo→保存。 |
| nyamuru_voice_1139 | Undoで消した二つの変更をRedo二回で戻し、続けてセーブして。 | compound_request | {} | Redo二回→保存。 |
| nyamuru_voice_1140 | 最後の取り消しをリドゥで打ち消してから、今の作品を保存してほしい。 | compound_request | {} | Redo→保存。Undoを新しく実行しない。 |

## v03_two_editor_settings

重点: `compound_boundary` / 関連family: `v03_independent_setting_changes`

既存の関連group: `v02_routes_compound_settings`, `panel_sync_set_save`, `inner_frame_snap_set_save`, `panel_gap_snap_set_save`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_1141 | コマシンクロを有効にして、内枠スナップも有効にして。 | compound_request | {} | 異なる設定二つをオン。 |
| nyamuru_voice_1142 | コマシンクロはオフ、コマスナップもオフに変更してください。 | compound_request | {} | 異なる設定二つをオフ。 |
| nyamuru_voice_1143 | 内枠スナップを切ってから、コマスナップを入れて。 | compound_request | {} | 内枠オフ→コマ間オン。 |
| nyamuru_voice_1144 | コマスナップを無効にするのと、内枠スナップを有効にするのをお願い。 | compound_request | {} | 二設定の明確な希望値。 |
| nyamuru_voice_1145 | 内枠スナップを使わない状態にして、その設定変更の後で作品を保存して。 | compound_request | {} | 内枠オフと作品保存。 |
| nyamuru_voice_1146 | コマシンクロをオンへ設定してから、いまの作品もセーブして。 | compound_request | {} | シンクロオンと作品保存。 |
| nyamuru_voice_1147 | 一体型の作画方式を選んで、コマスナップは有効にしてください。 | compound_request | {} | 作画方式integratedとコマスナップオン。 |
| nyamuru_voice_1148 | 下書き方式へ変更してから、コマシンクロを無効にして。 | compound_request | {} | 作画方式draftとシンクロオフ。 |

## v03_bubble_distinct_fields

重点: `compound_boundary` / 関連family: `v03_multiple_bubble_fields`

既存の関連group: `compound_bubble_fields`, `v02_routes_compound_bubble_fields`, `compound_bubble_save`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_1149 | 選択した吹き出しを四角形にして、しっぽも付けてください。 | compound_request | {} | shape=squareとtail_enabled=trueの二フィールド。 |
| nyamuru_voice_1150 | この吹き出しを普通のオーバルに戻して、しっぽは無しに変えて。 | compound_request | {} | shape=normalとtail_enabled=false。Undoではない。 |
| nyamuru_voice_1151 | しっぽを消してから、この吹き出しの本文を「了解」にして。 | compound_request | {} | しっぽ無効と本文置換。 |
| nyamuru_voice_1152 | この吹き出しの台詞を「待って」に直し、形も四角にして。 | compound_request | {} | 引用は本文であり延期依頼ではない。本文と形の変更。 |
| nyamuru_voice_1153 | 選択中の吹き出しの話者を小雪ちゃんにして、本文は「行こう」に変更して。 | compound_request | {} | 話者と本文の独立フィールド。名前は現データで解決。 |
| nyamuru_voice_1154 | 今の吹き出しを右へ一ミリ動かし、その後に作品を保存して。 | compound_request | {} | 移動と保存の二操作。 |
| nyamuru_voice_1155 | 吹き出しにしっぽを付けるのと、その本文を「こんにちは」にするのをお願い。 | compound_request | {} | しっぽと本文の独立変更。 |
| nyamuru_voice_1156 | この吹き出しをコマ枠で切り取る設定にして、それから通常保存して。 | compound_request | {} | clip_to_panel=trueと保存。実行可否は別処理。 |

## v03_tool_align_generate_pairs

重点: `compound_boundary` / 関連family: `v03_multiple_tool_and_generation_actions`

既存の関連group: `pen_and_align`, `generate_multiple_targets`, `v02_routes_compound_generation`, `v02_routes_compound_alignment`, `generate_save`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_1157 | ラスターペンへ変更して、そのあと選択した文字枠の頭をそろえて。 | compound_request | {} | ツール選択→文字枠上端整列。 |
| nyamuru_voice_1158 | 選んだ文字枠を上揃えにしてから、ベクターペンへ切り替えて。 | compound_request | {} | 整列→ツール選択。 |
| nyamuru_voice_1159 | 下書き方式を選んで、続けて選択中のコマを生成して。 | compound_request | {} | 作画方式変更→生成開始。 |
| nyamuru_voice_1160 | コマ二を生成したら、次にコマ四も生成してください。 | compound_request | {} | 別の対象に対する独立した二生成。 |
| nyamuru_voice_1161 | 一コマ目の小雪ちゃんだけを生成して、それから三コマ目のミナちゃんも生成して。 | compound_request | {} | 二つの人物配置を対象とする別々の生成依頼。 |
| nyamuru_voice_1162 | このコマを生成して、出来上がったら作品を保存して。 | compound_request | {} | 生成→完了確認後の保存。 |
| nyamuru_voice_1163 | 登録済みの3D背景から候補を出して、そのあとベクターペンを選択して。 | compound_request | {} | 候補提示とツール選択。候補の適用は含まない。 |
| nyamuru_voice_1164 | 文字枠の上端をそろえる処理と作品の保存を、その順でお願い。 | compound_request | {} | 整列→保存。 |

## v03_self_correction_not_compound

重点: `compound_boundary` / 関連family: `v03_final_single_request_after_correction`

既存の関連group: `save_self_correction`, `generate_selection`, `paint_pen_choice`, `v02_core_undo_self_correction`, `v02_core_redo_self_correction`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_1165 | 次のページへ行って、いや移動はなし。作品の保存だけお願い。 | save | {"target": "current_document"} | 前半の移動は撤回され、保存だけ残る。 |
| nyamuru_voice_1166 | セーブしてと言ったけど訂正。保存せず次のページへ進んで。 | page_navigate | {"direction": "next", "count": 1} | 保存は撤回。移動だけ。 |
| nyamuru_voice_1167 | ページを丸ごと生成して、訂正する、選択している人物だけ生成して。 | generate_request | {"target": "selected_character"} | 対象の訂正であり複数対象生成ではない。 |
| nyamuru_voice_1168 | ラスターペンにして、じゃなくてベクターペンを選んで。 | paint_tool_set | {"tool": "vector-pen"} | 最後の道具だけ採る。 |
| nyamuru_voice_1169 | ベクターペンへ変更、いやラスターペンのほうに訂正して。 | paint_tool_set | {"tool": "pen"} | 単一ツール選択。 |
| nyamuru_voice_1170 | アンドゥ二回というのは取り消す。一回だけアンドゥして。 | undo | {"count": 1} | 回数を訂正。Undoを三回に足さない。 |
| nyamuru_voice_1171 | リドゥ一回、ではなく二回にして。 | redo | {"count": 2} | 最終回数は二回。 |
| nyamuru_voice_1172 | 吹き出しを四角に、いや、形は普通のオーバルへ変えて。 | bubble_set | {"target": "selected_bubble", "field": "shape", "value": "normal"} | 形状指定を訂正した単一フィールド変更。 |

## v03_constraints_not_second_action

重点: `compound_boundary` / 関連family: `v03_preservation_constraints`

既存の関連group: `v02_core_undo_not_navigation`, `page_next`, `paint_pen_choice`, `text_frames_top`, `bubble_tail`, `generate_character`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_1173 | ページ番号はそのままで、直前の編集だけ一回アンドゥして。 | undo | {"count": 1} | ページ保持は二つ目の操作ではない。 |
| nyamuru_voice_1174 | 保存はせず、いま取り消した変更だけ一回リドゥして。 | redo | {"count": 1} | 保存禁止を操作数に入れない。 |
| nyamuru_voice_1175 | 作画方式は変更せず、次のページだけを表示して。 | page_navigate | {"direction": "next", "count": 1} | 方式保持は制約。 |
| nyamuru_voice_1176 | 描いてある線は変換しないで、使う道具だけラスターペンにして。 | paint_tool_set | {"tool": "pen"} | 既存線の変換を否定したツール選択。 |
| nyamuru_voice_1177 | 吹き出しの輪郭は動かさず、選択した文字枠の上端だけそろえて。 | text_frames_align | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} | 輪郭保持は制約。 |
| nyamuru_voice_1178 | 台詞は書き換えずに、この吹き出しのしっぽだけ消して。 | bubble_set | {"target": "selected_bubble", "field": "tail_enabled", "value": false} | 本文保持としっぽ無効。 |
| nyamuru_voice_1179 | ページ全体は生成せず、選んでいる人物だけ生成して。 | generate_request | {"target": "selected_character"} | 生成対象を絞る否定。 |
| nyamuru_voice_1180 | ページ移動も生成もせず、今の作品を保存するだけにして。 | save | {"target": "current_document"} | 二つの禁止と一つの肯定依頼。 |

## v03_one_action_multiple_values

重点: `compound_boundary` / 関連family: `v03_count_and_coordinates_single_action`

既存の関連group: `undo_count`, `redo_count`, `bubble_move_xy`, `bubble_resize_wh`, `page_next`, `text_frames_top`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_1181 | Undoを一回、続けてもう一回。同じ取り消しを合計二回して。 | undo | {"count": 2} | 同一操作の合計回数。 |
| nyamuru_voice_1182 | Redoを二回分まとめてお願い。取り消した二件を戻して。 | redo | {"count": 2} | 同一操作とその結果の言い換え。 |
| nyamuru_voice_1183 | 選んだ吹き出しを右へ三ミリ、下へ二ミリ移動して。 | bubble_set | {"target": "selected_bubble", "field": "bbox", "operation": "translate", "dx_mm": 3, "dy_mm": 2} | 同じ移動のx/y成分。 |
| nyamuru_voice_1184 | この吹き出しは左へ一ミリと上へ二ミリ、まとめてずらして。 | bubble_set | {"target": "selected_bubble", "field": "bbox", "operation": "translate", "dx_mm": -1, "dy_mm": -2} | 単一BBox移動。 |
| nyamuru_voice_1185 | 選択中の吹き出しを幅二十八ミリ、高さ四十二ミリに整えて。 | bubble_set | {"target": "selected_bubble", "field": "bbox", "operation": "resize", "width_mm": 28, "height_mm": 42} | 同一BBoxの寸法二値。 |
| nyamuru_voice_1186 | この吹き出しの横幅を三十ミリ、縦幅を三十八ミリに設定して。 | bubble_set | {"target": "selected_bubble", "field": "bbox", "operation": "resize", "width_mm": 30, "height_mm": 38} | 同一のサイズ変更。 |
| nyamuru_voice_1187 | ページを三枚分、次の方向へまとめて送って。 | page_navigate | {"direction": "next", "count": 3} | 同じページ移動の回数。 |
| nyamuru_voice_1188 | 選択してある三つの文字枠を、まとめて上端揃えにして。 | text_frames_align | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} | 複数対象への一回の整列。 |

## v03_quoted_two_actions_single_text

重点: `compound_boundary` / 関連family: `v03_quoted_commands_as_content`

既存の関連group: `bubble_quoted_command`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_1189 | 選択中の吹き出しの文章を「保存してから移動して」に変えて。 | bubble_set | {"target": "selected_bubble", "field": "text", "value": "保存してから移動して"} | 引用の二命令は本文。 |
| nyamuru_voice_1190 | 吹き出しには「Undoして、それから保存して」と入力してください。 | bubble_set | {"target": "selected_bubble", "field": "text", "value": "Undoして、それから保存して"} | 入力だけを行う。 |
| nyamuru_voice_1191 | この吹き出しの本文を「次のページへ行って、生成して」に置き換えて。 | bubble_set | {"target": "selected_bubble", "field": "text", "value": "次のページへ行って、生成して"} | 移動と生成は実行しない。 |
| nyamuru_voice_1192 | 今の吹き出しに「元に戻して、やり直して」と書いてほしい。 | bubble_set | {"target": "selected_bubble", "field": "text", "value": "元に戻して、やり直して"} | 本文入力の単一操作。 |
| nyamuru_voice_1193 | 台詞を「保存はまだ、ページ移動も待って」に差し替えて。 | bubble_set | {"target": "selected_bubble", "field": "text", "value": "保存はまだ、ページ移動も待って"} | 引用の禁止は本文で、編集禁止ではない。 |
| nyamuru_voice_1194 | この吹き出しの文は「ペンを変えて、文字をそろえて」にして。 | bubble_set | {"target": "selected_bubble", "field": "text", "value": "ペンを変えて、文字をそろえて"} | 引用内の曖昧な値も原文として保持。 |
| nyamuru_voice_1195 | 選んだ吹き出しへ「リドゥしてからセーブ」を入れて。 | bubble_set | {"target": "selected_bubble", "field": "text", "value": "リドゥしてからセーブ"} | 本文入力のみ。 |
| nyamuru_voice_1196 | 吹き出しの中身を「コマを生成して、背景候補も出して」として。 | bubble_set | {"target": "selected_bubble", "field": "text", "value": "コマを生成して、背景候補も出して"} | 引用を外側の実行命令と混同しない。 |

## v03_only_one_positive_clause

重点: `compound_boundary` / 関連family: `v03_negated_alternative_single_action`

既存の関連group: `compound_save_page`, `save_negative`, `page_negative`, `undo_negative`, `redo_negative`, `generate_current_page`, `paint_pen_choice`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_1197 | 保存はしないで、次のページだけ開いてください。 | page_navigate | {"direction": "next", "count": 1} | 肯定された操作はページ移動だけ。 |
| nyamuru_voice_1198 | 次のページには行かず、保存だけを実行して。 | save | {"target": "current_document"} | 移動は禁止、保存のみ。 |
| nyamuru_voice_1199 | Undoはかけずに、通常保存をお願い。 | save | {"target": "current_document"} | Undoは実行しない。 |
| nyamuru_voice_1200 | 保存は後回しにして、直前の編集を一つアンドゥして。 | undo | {"count": 1} | 現在はUndoのみ。保存予約は含まない。 |
| nyamuru_voice_1201 | 画像生成は始めずに、最後の取り消しをRedoで一つ戻して。 | redo | {"count": 1} | 生成禁止とRedo依頼。 |
| nyamuru_voice_1202 | リドゥは実行しないで、今のコマを生成し直して。 | generate_request | {"target": "selected_panel"} | 新規生成のみ。 |
| nyamuru_voice_1203 | 文字をそろえるのはやめて、ベクターペンへの切り替えだけお願い。 | paint_tool_set | {"tool": "vector-pen"} | 整列は撤回し、ツール選択のみ。 |
| nyamuru_voice_1204 | ペンは変更しなくていいから、選んだ文字枠の頭だけそろえて。 | text_frames_align | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} | 道具保持は制約。整列のみ。 |

## v03_both_denied_or_both_requested

重点: `compound_boundary` / 関連family: `v03_denied_pair_vs_requested_pair`

既存の関連group: `save_negative`, `page_negative`, `undo_negative`, `redo_negative`, `compound_save_page`, `compound_redo_save`

| ID | 発話本文 | 正解 | 引数（学習入力外） | 注釈 |
|---|---|---|---|---|
| nyamuru_voice_1205 | 保存も次のページへの移動も、まだ両方しないで。 | not_command | {} | 二つとも不実行で、現在肯定される操作なし。 |
| nyamuru_voice_1206 | アンドゥもリドゥも今は不要。履歴を動かさないで。 | not_command | {} | 二方向とも禁止。 |
| nyamuru_voice_1207 | ペンの切り替えも文字の整列も保留にしておいて。 | not_command | {} | 二つとも現在実行しない。 |
| nyamuru_voice_1208 | コマ生成と保存を頼もうと思ったけど、どちらもまだ実行しないで。 | not_command | {} | 両方の未実行依頼を撤回。 |
| nyamuru_voice_1209 | 保存と次のページへの移動、両方を保存が先になる順番で実行して。 | compound_request | {} | 両方とも現在の実行依頼。 |
| nyamuru_voice_1210 | Undoを一回、それが済んだらRedoを一回。両方を順番にやって。 | compound_request | {} | 明示された二方向の操作。言い直しではない。 |
| nyamuru_voice_1211 | ベクターペンへの切り替えも、文字枠の上端揃えも、今どちらもお願い。 | compound_request | {} | 独立した二操作が残る。 |
| nyamuru_voice_1212 | 選択中のコマを生成することと、その完了後に保存することを両方お願い。 | compound_request | {} | 生成と後続保存。 |
