# 2026-10-17 v0.2 追加バリエーション608件

元316件は変更せず、全19分類へ32件ずつ追加。全体は924件、各分類40〜78件です。追加分はCodexが作成した合成例であり、収集した実発話ではありません。作者と親レビューを実施し、編集・振り分け担当分は別担当者も照合しました。利用者による各文の確認はまだのため、全追加行の`review_status`は`pending_user_review`です。

短い指示を含む元例へ、作業理由付き依頼、丁寧な疑問形、言い直し、維持条件、回数・番号・値指定、説明/状態/能力の質問、延期・否定、明示された複数操作を追加しました。近い言い換えや数値・設定名だけの差替えはfamilyでまとめ、学習用と評価用をまたがないようにしています。

作画方式の設定と生成開始、登録済み3Dモデルの候補提示と新規生成/自動配置、文字枠の上端揃えと段落の行揃えを区別。撤回された操作や引用した命令語は、現在の追加操作に数えません。

BERTへ渡すのは発話本文だけです。下表のslots・group・注記は入力されません。分類ラベルは、未実装を含む後段の操作を自動で許可するものではありません。

| 分類 | 元 | 追加 | 合計 |
|---|---:|---:|---:|
| 保存 `save` | 10 | 32 | 42 |
| 戻す `undo` | 10 | 32 | 42 |
| やり直す `redo` | 10 | 32 | 42 |
| ページ移動 `page_navigate` | 16 | 32 | 48 |
| 表示切替 `view_change` | 20 | 32 | 52 |
| 作画方式切替 `artwork_mode_set` | 10 | 32 | 42 |
| 吹き出しの指定変更 `bubble_set` | 29 | 32 | 61 |
| 意味・指定が不足 `needs_clarification` | 20 | 32 | 52 |
| LLMによる内容判断 `needs_reasoning` | 10 | 32 | 42 |
| 複数操作 `compound_request` | 17 | 32 | 49 |
| 初期範囲外の依頼 `out_of_scope_request` | 13 | 32 | 45 |
| 今回の実行依頼ではない `not_command` | 46 | 32 | 78 |
| コマシンクロのオン・オフ `panel_sync_set` | 12 | 32 | 44 |
| 内枠スナップのオン・オフ `inner_frame_snap_set` | 12 | 32 | 44 |
| コマスナップのオン・オフ `panel_gap_snap_set` | 12 | 32 | 44 |
| 指定対象の画像生成 `generate_request` | 33 | 32 | 65 |
| 登録済み3D背景の候補提示 `background_3d_candidates` | 16 | 32 | 48 |
| 描画ペンの切替 `paint_tool_set` | 12 | 32 | 44 |
| 複数文字枠の上端揃え `text_frames_align` | 8 | 32 | 40 |

[固定分割と全924件](../../docs/2026-10-17-v02-split-review.md) · [学習条件](../../docs/2026-10-17-v02-protocol.md) · [追加JSONL](candidates.jsonl) · [意味レビュー記録](semantic-review.json)

## レビューで直した箇所

曖昧な対象名やページ移動の依頼範囲、未確認のUI文言の断定、硬い表現を整理しました。新しい例のラベルとslotsは変更していません。具体的な修正はmanifest.json、元316件から引き継いだ解釈上の留保は学習条件へ記載しています。

## 保存 — `save`

| ID | 発話本文 | slots | group |
|---|---|---|---|
| nyamuru_voice_317 | セリフの打ち直しが済んだので、今開いている作品を保存して。 | {"target": "current_document"} | v02_core_save_work_checkpoint |
| nyamuru_voice_318 | 区切りのいいところまで描けた。ここで一回、作品をセーブしておいて。 | {"target": "current_document"} | v02_core_save_work_checkpoint |
| nyamuru_voice_319 | コマ割りの調整はこれで確定にするから、今の編集内容を保存して。 | {"target": "current_document"} | v02_core_save_work_checkpoint |
| nyamuru_voice_320 | この配置で残したいので、現在の作品を保存してくれる？ | {"target": "current_document"} | v02_core_save_work_checkpoint |
| nyamuru_voice_321 | 手を止めて休憩に入るので、いま作品を保存してください。 | {"target": "current_document"} | v02_core_save_pause_wrapup |
| nyamuru_voice_322 | 今日はここまで。開いている原稿の保存をお願い。 | {"target": "current_document"} | v02_core_save_pause_wrapup |
| nyamuru_voice_323 | 作業を切り上げるところだから、この状態をセーブして。 | {"target": "current_document"} | v02_core_save_pause_wrapup |
| nyamuru_voice_324 | 少し席を外すよ。先に今の作品を保存してもらえる？ | {"target": "current_document"} | v02_core_save_pause_wrapup |
| nyamuru_voice_325 | 変更がまだ残っているね。今の作品を保存して。 | {"target": "current_document"} | v02_core_save_unsaved_discovery |
| nyamuru_voice_326 | 保存し忘れていたので、現在の編集内容でセーブをお願いします。 | {"target": "current_document"} | v02_core_save_unsaved_discovery |
| nyamuru_voice_327 | 最後に保存してからセリフを直した分も含めて、作品を保存して。 | {"target": "current_document"} | v02_core_save_unsaved_discovery |
| nyamuru_voice_328 | まだ保存操作をしていなかった。ここで一度保存してくれますか？ | {"target": "current_document"} | v02_core_save_unsaved_discovery |
| nyamuru_voice_329 | 書き直したところを失いたくないから、今の原稿を保存して。 | {"target": "current_document"} | v02_core_save_prevent_loss |
| nyamuru_voice_330 | この状態を確実に残しておきたい。作品の保存を今お願い。 | {"target": "current_document"} | v02_core_save_prevent_loss |
| nyamuru_voice_331 | 変更点が多くなってきたので、いったん現状を保存してください。 | {"target": "current_document"} | v02_core_save_prevent_loss |
| nyamuru_voice_332 | 作業内容を残してから考えたいので、まずこの作品をセーブして。 | {"target": "current_document"} | v02_core_save_prevent_loss |
| nyamuru_voice_333 | 手を離せないので、代わりに今の作品を保存してもらっていい？ | {"target": "current_document"} | v02_core_save_explicit_courtesy |
| nyamuru_voice_334 | こちらの原稿を今の内容でセーブしていただけますか。 | {"target": "current_document"} | v02_core_save_explicit_courtesy |
| nyamuru_voice_335 | 変更は終わったよ。今すぐ作品を保存する操作をお願いできる？ | {"target": "current_document"} | v02_core_save_explicit_courtesy |
| nyamuru_voice_336 | 念のための保存を一回、今お願いしてもいいかな？ | {"target": "current_document"} | v02_core_save_explicit_courtesy |
| nyamuru_voice_337 | ファイル名はそのままで、今の作品を通常の保存で残して。 | {"target": "current_document"} | v02_core_save_preserve_destination |
| nyamuru_voice_338 | 別名のコピーは要らないので、開いている作品を保存してください。 | {"target": "current_document"} | v02_core_save_preserve_destination |
| nyamuru_voice_339 | 保存先を変える話ではなくて、今編集している作品の保存をお願い。 | {"target": "current_document"} | v02_core_save_preserve_destination |
| nyamuru_voice_340 | ページの表示は動かさず、この作品をいま保存して。 | {"target": "current_document"} | v02_core_save_preserve_destination |
| nyamuru_voice_341 | 保存は後で、いや訂正。今この作品を保存して。 | {"target": "current_document"} | v02_core_save_self_correction |
| nyamuru_voice_342 | 新しい名前で保存して……じゃなくて、普通の保存を一回お願い。 | {"target": "current_document"} | v02_core_save_self_correction |
| nyamuru_voice_343 | まだ保存しなくていいと言ったけど、やっぱり今の内容で保存してください。 | {"target": "current_document"} | v02_core_save_self_correction |
| nyamuru_voice_344 | 保存先を変えて、と言いかけたけど違う。現在の作品を普通に保存して。 | {"target": "current_document"} | v02_core_save_self_correction |
| nyamuru_voice_345 | 今見えている編集結果を、この作品の現在の内容として保存して。 | {"target": "current_document"} | v02_core_save_current_result |
| nyamuru_voice_346 | 前に保存した内容へ戻すのでなく、いまの状態を保存し直して。 | {"target": "current_document"} | v02_core_save_current_result |
| nyamuru_voice_347 | セリフを直したあとのこの版を、開いている作品に保存しておいて。 | {"target": "current_document"} | v02_core_save_current_result |
| nyamuru_voice_348 | 今の編集結果でよいので、この作品へ通常どおり保存をお願いします。 | {"target": "current_document"} | v02_core_save_current_result |

## 戻す — `undo`

| ID | 発話本文 | slots | group |
|---|---|---|---|
| nyamuru_voice_349 | いまの移動は手が滑った。直前の編集を一つ取り消して。 | {"count": 1} | v02_core_undo_accidental_edit |
| nyamuru_voice_350 | 最後に確定した吹き出しの拡大は間違いなので、その編集をUndoで一つ戻して。 | {"count": 1} | v02_core_undo_accidental_edit |
| nyamuru_voice_351 | 今入れた文字が不要だったから、最後の編集を一回アンドゥして。 | {"count": 1} | v02_core_undo_accidental_edit |
| nyamuru_voice_352 | 置く場所を間違えて今動かしたので、たった今の編集を元に戻して。 | {"count": 1} | v02_core_undo_accidental_edit |
| nyamuru_voice_353 | この変更より前の見え方を確かめたい。編集履歴を一段だけ戻して。 | {"count": 1} | v02_core_undo_compare_previous |
| nyamuru_voice_354 | 直前の調整をする前の状態と比べたいので、Undoを一回お願い。 | {"count": 1} | v02_core_undo_compare_previous |
| nyamuru_voice_355 | いまの変更前の原稿を見たいから、最後の編集一件を取り消してくれる？ | {"count": 1} | v02_core_undo_compare_previous |
| nyamuru_voice_356 | 一つ前の編集結果を確認するために、いま履歴を一つ戻してください。 | {"count": 1} | v02_core_undo_compare_previous |
| nyamuru_voice_357 | 最後の調整はやり過ぎたので、一回Undoして。 | {"count": 1} | v02_core_undo_reject_latest |
| nyamuru_voice_358 | 今の文字直しは採用しない。直前の一操作だけ履歴から戻して。 | {"count": 1} | v02_core_undo_reject_latest |
| nyamuru_voice_359 | さっき最後に加えた変更は要らなかったね。アンドゥを一回お願いします。 | {"count": 1} | v02_core_undo_reject_latest |
| nyamuru_voice_360 | いま確定した編集を無かったことにしたいので、最後の履歴一件を取り消して。 | {"count": 1} | v02_core_undo_reject_latest |
| nyamuru_voice_361 | 最後の二つの編集を取り消したい。Undoを二回実行して。 | {"count": 2} | v02_core_undo_bounded_count |
| nyamuru_voice_362 | 今は三操作前の状態へ戻りたいので、編集履歴を三段戻して。 | {"count": 3} | v02_core_undo_bounded_count |
| nyamuru_voice_363 | 直近の変更二回分だけアンドゥしてくれる？ | {"count": 2} | v02_core_undo_bounded_count |
| nyamuru_voice_364 | ここで四つ前の編集状態まで戻すために、Undoを四回お願い。 | {"count": 4} | v02_core_undo_bounded_count |
| nyamuru_voice_365 | その前の修正は残したいので、最後の編集だけを一つUndoして。 | {"count": 1} | v02_core_undo_preserve_older_edits |
| nyamuru_voice_366 | 全部やり直すのではなく、いちばん新しい編集一件だけ取り消して。 | {"count": 1} | v02_core_undo_preserve_older_edits |
| nyamuru_voice_367 | 前の変更まで消したくないから、アンドゥは一回だけにして。 | {"count": 1} | v02_core_undo_preserve_older_edits |
| nyamuru_voice_368 | 今終わった一操作だけ戻してくれる？ それ以前の編集はそのままで。 | {"count": 1} | v02_core_undo_preserve_older_edits |
| nyamuru_voice_369 | 表示するページは変えずに、いまの編集をUndoで一つ戻して。 | {"count": 1} | v02_core_undo_not_navigation |
| nyamuru_voice_370 | 前のページを見たいわけではないよ。最後の編集一件を取り消して。 | {"count": 1} | v02_core_undo_not_navigation |
| nyamuru_voice_371 | ページ移動は要らないから、編集履歴の「元に戻す」を一回お願い。 | {"count": 1} | v02_core_undo_not_navigation |
| nyamuru_voice_372 | 戻すのは画面の表示倍率ではなく、さっき確定した編集。Undoを一回実行して。 | {"count": 1} | v02_core_undo_not_navigation |
| nyamuru_voice_373 | リドゥして、いや逆だった。アンドゥを一回お願い。 | {"count": 1} | v02_core_undo_self_correction |
| nyamuru_voice_374 | 二回戻して、と言ったけど一回でいい。編集を一段だけUndoして。 | {"count": 1} | v02_core_undo_self_correction |
| nyamuru_voice_375 | 今の修正は残すつもりだったけど撤回する。最後の編集を一つ取り消してください。 | {"count": 1} | v02_core_undo_self_correction |
| nyamuru_voice_376 | 元に戻さないで、は言い間違い。今の編集を一回アンドゥして。 | {"count": 1} | v02_core_undo_self_correction |
| nyamuru_voice_377 | ツールバーの元に戻すと同じ操作で、編集を一段戻して。 | {"count": 1} | v02_core_undo_history_control |
| nyamuru_voice_378 | 編集履歴の最新項目を取り消す操作を、一回お願いしたい。 | {"count": 1} | v02_core_undo_history_control |
| nyamuru_voice_379 | いま確定している最後の編集に対して、Undoを一度かけてください。 | {"count": 1} | v02_core_undo_history_control |
| nyamuru_voice_380 | ショートカットで戻すのと同じ意味で、直前の変更を一つアンドゥしてくれる？ | {"count": 1} | v02_core_undo_history_control |

## やり直す — `redo`

| ID | 発話本文 | slots | group |
|---|---|---|---|
| nyamuru_voice_381 | 取り消したのは早まったね。最後のUndoをリドゥで一つ戻して。 | {"count": 1} | v02_core_redo_regret_undo |
| nyamuru_voice_382 | さっき消した変更のほうがよかった。取り消し履歴から一件だけ再適用して。 | {"count": 1} | v02_core_redo_regret_undo |
| nyamuru_voice_383 | いまアンドゥした編集をやっぱり採用するので、Redoを一回お願い。 | {"count": 1} | v02_core_redo_regret_undo |
| nyamuru_voice_384 | さっきの取り消しは撤回したい。リドゥを一回実行して。 | {"count": 1} | v02_core_redo_regret_undo |
| nyamuru_voice_385 | 変更後の見え方をもう一度確かめたいので、Undoで消した編集を一つリドゥして。 | {"count": 1} | v02_core_redo_compare_reapplied |
| nyamuru_voice_386 | 取り消す前の状態と見比べたい。編集履歴を一段だけRedoで進めて。 | {"count": 1} | v02_core_redo_compare_reapplied |
| nyamuru_voice_387 | 今戻した編集を再適用した状態を見たいので、リドゥを一度お願い。 | {"count": 1} | v02_core_redo_compare_reapplied |
| nyamuru_voice_388 | Undo後の状態は確認できたから、取り消した一件を履歴から復活させて。 | {"count": 1} | v02_core_redo_compare_reapplied |
| nyamuru_voice_389 | 間違えてアンドゥを押したから、その一回分をリドゥして。 | {"count": 1} | v02_core_redo_accidental_undo |
| nyamuru_voice_390 | 取り消すつもりがなかったので、直前にUndoした変更を戻してください。 | {"count": 1} | v02_core_redo_accidental_undo |
| nyamuru_voice_391 | 今のUndoは誤操作。取り消された編集を一件だけ再適用してくれる？ | {"count": 1} | v02_core_redo_accidental_undo |
| nyamuru_voice_392 | さっき一段戻し過ぎたので、リドゥで一段進めて。 | {"count": 1} | v02_core_redo_accidental_undo |
| nyamuru_voice_393 | 続けて取り消した二件の編集を、Redoを二回使って戻して。 | {"count": 2} | v02_core_redo_bounded_count |
| nyamuru_voice_394 | いまUndoを三回かけた分を復活させたい。リドゥを三回お願い。 | {"count": 3} | v02_core_redo_bounded_count |
| nyamuru_voice_395 | 取り消し履歴を二段進めて、二件の変更を再適用してください。 | {"count": 2} | v02_core_redo_bounded_count |
| nyamuru_voice_396 | 四回のUndoをやり直すために、編集履歴でRedoを四回実行して。 | {"count": 4} | v02_core_redo_bounded_count |
| nyamuru_voice_397 | 取り消した変更を全部戻す必要はないので、リドゥは一回だけにして。 | {"count": 1} | v02_core_redo_preserve_remaining_undo |
| nyamuru_voice_398 | 次に再適用できる編集一件だけ、履歴から戻して。 | {"count": 1} | v02_core_redo_preserve_remaining_undo |
| nyamuru_voice_399 | 一段だけRedoしてくれる？ それより先の取り消しはまだ残しておいて。 | {"count": 1} | v02_core_redo_preserve_remaining_undo |
| nyamuru_voice_400 | 次の一件だけをリドゥで適用してほしい。ほかの取り消した編集は、そのままにして。 | {"count": 1} | v02_core_redo_preserve_remaining_undo |
| nyamuru_voice_401 | 画像を新しく作り直す依頼ではなく、Undoした編集を一回リドゥして。 | {"count": 1} | v02_core_redo_not_regeneration |
| nyamuru_voice_402 | 生成の再実行はしなくていいので、編集履歴のやり直しを一回お願い。 | {"count": 1} | v02_core_redo_not_regeneration |
| nyamuru_voice_403 | 同じ絵をもう一枚作るのではなく、取り消した変更一件を復活させて。 | {"count": 1} | v02_core_redo_not_regeneration |
| nyamuru_voice_404 | 新規の編集は加えず、最後にアンドゥした操作をRedoで戻してくれる？ | {"count": 1} | v02_core_redo_not_regeneration |
| nyamuru_voice_405 | アンドゥして、違った。いまの取り消しをリドゥで一回戻して。 | {"count": 1} | v02_core_redo_self_correction |
| nyamuru_voice_406 | リドゥは二回、いや一回に訂正。取り消した編集一件だけ再適用して。 | {"count": 1} | v02_core_redo_self_correction |
| nyamuru_voice_407 | 変更は消したままで、と言ったけど撤回する。今Undoした一件を復活させて。 | {"count": 1} | v02_core_redo_self_correction |
| nyamuru_voice_408 | やり直さなくていい、ではなく、今回は履歴のRedoを一回お願い。 | {"count": 1} | v02_core_redo_self_correction |
| nyamuru_voice_409 | ツールバーのやり直すと同じ操作を一度実行して。 | {"count": 1} | v02_core_redo_history_control |
| nyamuru_voice_410 | Undoの反対の操作で、取り消し履歴を一段進めてもらえる？ | {"count": 1} | v02_core_redo_history_control |
| nyamuru_voice_411 | 編集履歴のRedoを一回使って、取り消した変更を再び有効にして。 | {"count": 1} | v02_core_redo_history_control |
| nyamuru_voice_412 | 履歴からやり直すほうを一回お願い。新しく描き直す意味ではないよ。 | {"count": 1} | v02_core_redo_history_control |

## ページ移動 — `page_navigate`

| ID | 発話本文 | slots | group |
|---|---|---|---|
| nyamuru_voice_413 | このページは読み終わったので、次のページを開いて。 | {"direction": "next", "count": 1} | v02_core_page_navigate_read_forward |
| nyamuru_voice_414 | 続きの内容を確認したい。表示を一ページ先へ進めてくれる？ | {"direction": "next", "count": 1} | v02_core_page_navigate_read_forward |
| nyamuru_voice_415 | 今のページのチェックは済んだよ。次の一ページに移って。 | {"direction": "next", "count": 1} | v02_core_page_navigate_read_forward |
| nyamuru_voice_416 | この先を読むので、いま見ているページから一枚進めてください。 | {"direction": "next", "count": 1} | v02_core_page_navigate_read_forward |
| nyamuru_voice_417 | ひとつ前のページのセリフを確認したいから、そのページへ戻って。 | {"direction": "previous", "count": 1} | v02_core_page_navigate_reread_previous |
| nyamuru_voice_418 | 前ページとのつながりを見たい。表示を一ページ前にして。 | {"direction": "previous", "count": 1} | v02_core_page_navigate_reread_previous |
| nyamuru_voice_419 | 一枚だけ先に進み過ぎたので、その一つ前のページを開いてくれる？ | {"direction": "previous", "count": 1} | v02_core_page_navigate_reread_previous |
| nyamuru_voice_420 | この一枚前の内容を読み直すので、前のページを表示してください。 | {"direction": "previous", "count": 1} | v02_core_page_navigate_reread_previous |
| nyamuru_voice_421 | 修正箇所は7ページにあるので、7ページ目を開いて。 | {"page_number": 7} | v02_core_page_navigate_numbered_destination |
| nyamuru_voice_422 | いま確認したいのは二ページ目。そこへ表示を切り替えてくれる？ | {"page_number": 2} | v02_core_page_navigate_numbered_destination |
| nyamuru_voice_423 | ページ番号で指定するね。十ページを画面に出して。 | {"page_number": 10} | v02_core_page_navigate_numbered_destination |
| nyamuru_voice_424 | 四ページのセリフを見たいから、作品の4ページ目へ移動して。 | {"page_number": 4} | v02_core_page_navigate_numbered_destination |
| nyamuru_voice_425 | 冒頭から見直したいので、この作品の先頭ページを表示して。 | {"position": "first"} | v02_core_page_navigate_bookend_destination |
| nyamuru_voice_426 | 読み始めに戻りたい。最初のページを開いてくれる？ | {"position": "first"} | v02_core_page_navigate_bookend_destination |
| nyamuru_voice_427 | 結末を確認するから、この作品の最後のページへ移って。 | {"position": "last"} | v02_core_page_navigate_bookend_destination |
| nyamuru_voice_428 | いちばん後ろのページが見たいので、末尾を表示してください。 | {"position": "last"} | v02_core_page_navigate_bookend_destination |
| nyamuru_voice_429 | 二ページ分先に見たい箇所があるので、表示を二枚進めて。 | {"direction": "next", "count": 2} | v02_core_page_navigate_relative_distance |
| nyamuru_voice_430 | 三ページ前を見返すから、今の位置からページを三枚戻して。 | {"direction": "previous", "count": 3} | v02_core_page_navigate_relative_distance |
| nyamuru_voice_431 | ここから四ページ先まで移動してくれる？ | {"direction": "next", "count": 4} | v02_core_page_navigate_relative_distance |
| nyamuru_voice_432 | 今の表示位置より二ページ前を開いて。 | {"direction": "previous", "count": 2} | v02_core_page_navigate_relative_distance |
| nyamuru_voice_433 | 保存は今しないで、表示だけ一ページ先へ進めて。 | {"direction": "next", "count": 1, "constraints": ["do_not_save"]} | v02_core_page_navigate_without_save |
| nyamuru_voice_434 | ファイルを保存する操作は挟まずに、次のページを見せて。 | {"direction": "next", "count": 1, "constraints": ["do_not_save"]} | v02_core_page_navigate_without_save |
| nyamuru_voice_435 | セーブは頼んでいないよ。今は先頭ページへの移動だけお願い。 | {"position": "first", "constraints": ["do_not_save"]} | v02_core_page_navigate_without_save |
| nyamuru_voice_436 | 作品の保存はそのまま保留で、表示を一つ前のページに戻して。 | {"direction": "previous", "count": 1, "constraints": ["do_not_save"]} | v02_core_page_navigate_without_save |
| nyamuru_voice_437 | 戻したいのは編集ではなくページ。表示を一ページ前へ移して。 | {"direction": "previous", "count": 1} | v02_core_page_navigate_not_edit_history |
| nyamuru_voice_438 | Undoはしなくていいので、この作品の前のページを開いて。 | {"direction": "previous", "count": 1} | v02_core_page_navigate_not_edit_history |
| nyamuru_voice_439 | 編集内容を取り消さず、三ページ目を表示してくれる？ | {"page_number": 3} | v02_core_page_navigate_not_edit_history |
| nyamuru_voice_440 | やり直し操作ではなくページ送りをお願い。次のページへ進めて。 | {"direction": "next", "count": 1} | v02_core_page_navigate_not_edit_history |
| nyamuru_voice_441 | 次のページ、いや前のページだ。いまの一枚前を表示して。 | {"direction": "previous", "count": 1} | v02_core_page_navigate_self_correction |
| nyamuru_voice_442 | 五ページと言ったのは間違いで、六ページを開いてほしい。 | {"page_number": 6} | v02_core_page_navigate_self_correction |
| nyamuru_voice_443 | 先頭ではなく最後を見たい。作品の末尾ページへ移動して。 | {"position": "last"} | v02_core_page_navigate_self_correction |
| nyamuru_voice_444 | 二枚戻って、やっぱり一枚でいい。前のページを表示して。 | {"direction": "previous", "count": 1} | v02_core_page_navigate_self_correction |

## 表示切替 — `view_change`

| ID | 発話本文 | slots | group |
|---|---|---|---|
| nyamuru_voice_445 | 紙の端が見切れているから、一ページ全体が画面に収まる倍率にして。 | {"kind": "zoom", "mode": "fit"} | v02_core_view_change_fit_purpose |
| nyamuru_voice_446 | 全体のバランスを見るので、原稿全体に表示をフィットしてくれる？ | {"kind": "zoom", "mode": "fit"} | v02_core_view_change_fit_purpose |
| nyamuru_voice_447 | 細部の確認は終わった。紙面が全部見える表示へ戻して。 | {"kind": "zoom", "mode": "fit"} | v02_core_view_change_fit_purpose |
| nyamuru_voice_448 | ページを切らずに見たいので、用紙全体に合わせた表示倍率にしてください。 | {"kind": "zoom", "mode": "fit"} | v02_core_view_change_fit_purpose |
| nyamuru_voice_449 | 線を近くで見たいから、画面のズームを一段上げて。 | {"kind": "zoom", "mode": "in", "count": 1} | v02_core_view_change_zoom_step |
| nyamuru_voice_450 | セリフを確認したいので、表示の拡大を一回お願い。 | {"kind": "zoom", "mode": "in", "count": 1} | v02_core_view_change_zoom_step |
| nyamuru_voice_451 | 少し引いて全体を見たい。ズームアウトを一回だけして。 | {"kind": "zoom", "mode": "out", "count": 1} | v02_core_view_change_zoom_step |
| nyamuru_voice_452 | 表示が大き過ぎるので、画面の倍率を一段下げてくれる？ | {"kind": "zoom", "mode": "out", "count": 1} | v02_core_view_change_zoom_step |
| nyamuru_voice_453 | いまの拡大率ではなく、100パーセントの表示で見せて。 | {"kind": "zoom", "mode": "actual"} | v02_core_view_change_actual_zoom |
| nyamuru_voice_454 | 表示倍率を確認したいから、原稿を百パーセントに戻してください。 | {"kind": "zoom", "mode": "actual"} | v02_core_view_change_actual_zoom |
| nyamuru_voice_455 | 拡大も縮小もしていない100%表示にしてくれる？ | {"kind": "zoom", "mode": "actual"} | v02_core_view_change_actual_zoom |
| nyamuru_voice_456 | ズームを百パーセント表示へリセットして。 | {"kind": "zoom", "mode": "actual"} | v02_core_view_change_actual_zoom |
| nyamuru_voice_457 | 左右のページのつながりを見るので、見開き表示を有効にして。 | {"kind": "spread", "enabled": true} | v02_core_view_change_spread_purpose |
| nyamuru_voice_458 | 二ページを並べて確認したい。画面を見開きにしてくれる？ | {"kind": "spread", "enabled": true} | v02_core_view_change_spread_purpose |
| nyamuru_voice_459 | 今は一ページずつ見たいから、見開き表示を解除して。 | {"kind": "spread", "enabled": false} | v02_core_view_change_spread_purpose |
| nyamuru_voice_460 | 見開きの表示は使わない設定にして。 | {"kind": "spread", "enabled": false} | v02_core_view_change_spread_purpose |
| nyamuru_voice_461 | 人物と吹き出しの配置枠を確認するため、配置ガイドを出して。 | {"kind": "guide", "guide": "placement", "enabled": true} | v02_core_view_change_placement_guide_purpose |
| nyamuru_voice_462 | 位置合わせの目印が欲しいので、配置ガイドをオンにしてくれる？ | {"kind": "guide", "guide": "placement", "enabled": true} | v02_core_view_change_placement_guide_purpose |
| nyamuru_voice_463 | 枠に邪魔されず原稿を見たい。配置ガイドの表示をオフにして。 | {"kind": "guide", "guide": "placement", "enabled": false} | v02_core_view_change_placement_guide_purpose |
| nyamuru_voice_464 | 人物や吹き出し自体は消さずに、配置ガイドの枠だけ非表示にして。 | {"kind": "guide", "guide": "placement", "enabled": false} | v02_core_view_change_placement_guide_purpose |
| nyamuru_voice_465 | 編集ガイドを見ながら作業するので、その表示を有効にして。 | {"kind": "guide", "guide": "edit", "enabled": true} | v02_core_view_change_edit_guide_context |
| nyamuru_voice_466 | 編集ガイドを隠すのはやめて、いまは表示する設定にして。 | {"kind": "guide", "guide": "edit", "enabled": true} | v02_core_view_change_edit_guide_context |
| nyamuru_voice_467 | 仕上がりを確認したいから、編集ガイドだけオフにして。 | {"kind": "guide", "guide": "edit", "enabled": false} | v02_core_view_change_edit_guide_context |
| nyamuru_voice_468 | ガイドというのは編集ガイドのこと。表示を消してくれる？ | {"kind": "guide", "guide": "edit", "enabled": false} | v02_core_view_change_edit_guide_context |
| nyamuru_voice_469 | この人物の下描きの当たりを見たいので、選択中の人物のあたり画像を表示して。 | {"kind": "guide", "guide": "artwork", "target": "selected_figure", "enabled": true} | v02_core_view_change_artwork_guide_context |
| nyamuru_voice_470 | いま選んでいる人物のあたり画像を、見える設定にしてくれる？ | {"kind": "guide", "guide": "artwork", "target": "selected_figure", "enabled": true} | v02_core_view_change_artwork_guide_context |
| nyamuru_voice_471 | 選択中の人物の完成した絵を確認したいから、この人物のあたり画像を非表示にして。 | {"kind": "guide", "guide": "artwork", "target": "selected_figure", "enabled": false} | v02_core_view_change_artwork_guide_context |
| nyamuru_voice_472 | 人物の絵は残したまま、選択中の人物のあたり画像だけ隠して。 | {"kind": "guide", "guide": "artwork", "target": "selected_figure", "enabled": false} | v02_core_view_change_artwork_guide_context |
| nyamuru_voice_473 | セリフの流れを読むので、シナリオのタブへ切り替えて。 | {"kind": "tab", "tab": "coverage"} | v02_core_view_change_existing_tab_purpose |
| nyamuru_voice_474 | 人物設定を確認したいから、登場人物のタブを開いてくれる？ | {"kind": "tab", "tab": "characters"} | v02_core_view_change_existing_tab_purpose |
| nyamuru_voice_475 | ネームの編集に戻るため、ネーム編集タブを表示して。 | {"kind": "tab", "tab": "storyboard"} | v02_core_view_change_existing_tab_purpose |
| nyamuru_voice_476 | シナリオではなく人物の設定を見たい。登場人物の画面に切り替えて。 | {"kind": "tab", "tab": "characters"} | v02_core_view_change_existing_tab_purpose |

## 作画方式切替 — `artwork_mode_set`

| ID | 発話本文 | slots | group |
|---|---|---|---|
| nyamuru_voice_477 | 文字も吹き出しも含めた仕上がりにしたいので、作画方式は一体型にして。 | {"mode": "integrated"} | v02_core_artwork_mode_set_integrated_purpose |
| nyamuru_voice_478 | 一ページをまとめて仕上げる予定だから、いま作画設定の一体型を選んで。 | {"mode": "integrated"} | v02_core_artwork_mode_set_integrated_purpose |
| nyamuru_voice_479 | ページ全体をひとまとまりに扱うほうにしたい。作画方式を一体型へ変更してくれる？ | {"mode": "integrated"} | v02_core_artwork_mode_set_integrated_purpose |
| nyamuru_voice_480 | 個別の下書きではなく完成形をまとめる方針なので、一体型の作画方式に切り替えて。 | {"mode": "integrated"} | v02_core_artwork_mode_set_integrated_purpose |
| nyamuru_voice_481 | あとで手で仕上げるつもりなので、作画方式を下書きにして。 | {"mode": "draft"} | v02_core_artwork_mode_set_draft_purpose |
| nyamuru_voice_482 | 線は自分で整えたいから、作画設定では下書き方式を選んでくれる？ | {"mode": "draft"} | v02_core_artwork_mode_set_draft_purpose |
| nyamuru_voice_483 | 完成稿としてまとめる前にラフを使いたい。今は下書きの作画方式に切り替えて。 | {"mode": "draft"} | v02_core_artwork_mode_set_draft_purpose |
| nyamuru_voice_484 | コマごとの下書きをもとに作業する方針なので、作画設定を下書きに変更して。 | {"mode": "draft"} | v02_core_artwork_mode_set_draft_purpose |
| nyamuru_voice_485 | 画像の生成はまだ頼んでいないよ。作画方式だけ一体型にして。 | {"mode": "integrated"} | v02_core_artwork_mode_set_setting_without_run |
| nyamuru_voice_486 | 生成を始める前の設定として、いま一体型の方式を選択して。 | {"mode": "integrated"} | v02_core_artwork_mode_set_setting_without_run |
| nyamuru_voice_487 | 今ここでは何も生成せずに、作画方式だけ下書きに変更してくれる？ | {"mode": "draft"} | v02_core_artwork_mode_set_setting_without_run |
| nyamuru_voice_488 | 作画設定の下書きへの切替だけお願い。画像生成の開始はしないで。 | {"mode": "draft"} | v02_core_artwork_mode_set_setting_without_run |
| nyamuru_voice_489 | 下書きにして、いや、一体型に訂正。作画方式は一体型を選んで。 | {"mode": "integrated"} | v02_core_artwork_mode_set_self_correction |
| nyamuru_voice_490 | 一体型と言いかけたけど、今回は下書き。作画設定を下書き方式にして。 | {"mode": "draft"} | v02_core_artwork_mode_set_self_correction |
| nyamuru_voice_491 | 作画方式を変えないで、と言ったのは取り消す。いま一体型へ変更して。 | {"mode": "integrated"} | v02_core_artwork_mode_set_self_correction |
| nyamuru_voice_492 | 一体型への切替は撤回する。代わりに作画方式を下書きへ変更して。 | {"mode": "draft"} | v02_core_artwork_mode_set_self_correction |
| nyamuru_voice_493 | 表示倍率は今のままで、作画方式のほうを一体型に切り替えて。 | {"mode": "integrated"} | v02_core_artwork_mode_set_preserve_other_state |
| nyamuru_voice_494 | 原稿の文字や吹き出しを今ここで編集せず、作画設定を一体型にして。 | {"mode": "integrated"} | v02_core_artwork_mode_set_preserve_other_state |
| nyamuru_voice_495 | 今開いているページは変えずに、作画方式を下書きに設定して。 | {"mode": "draft"} | v02_core_artwork_mode_set_preserve_other_state |
| nyamuru_voice_496 | 画像の差し替えはしないで、作画方式の値だけ下書きに変えてくれる？ | {"mode": "draft"} | v02_core_artwork_mode_set_preserve_other_state |
| nyamuru_voice_497 | 作画方式を integrated、つまり一体型の設定にして。 | {"mode": "integrated"} | v02_core_artwork_mode_set_named_setting_item |
| nyamuru_voice_498 | 一体型の項目を有効な作画方式として指定してくれる？ | {"mode": "integrated"} | v02_core_artwork_mode_set_named_setting_item |
| nyamuru_voice_499 | 作画方式の draft、つまり下書きの項目へ切り替えて。 | {"mode": "draft"} | v02_core_artwork_mode_set_named_setting_item |
| nyamuru_voice_500 | 使いたい作画方式は下書き生成。いま設定をその方式に変えて。 | {"mode": "draft"} | v02_core_artwork_mode_set_named_setting_item |
| nyamuru_voice_501 | 今回の作画方式は一体型でお願いします。設定をそちらに切り替えてもらえる？ | {"mode": "integrated"} | v02_core_artwork_mode_set_explicit_choice_request |
| nyamuru_voice_502 | 下書きとの選択なら一体型にしたいので、いまその方式を設定して。 | {"mode": "integrated"} | v02_core_artwork_mode_set_explicit_choice_request |
| nyamuru_voice_503 | 作画方式は下書きのほうで進めたい。下書きを選んでもらっていい？ | {"mode": "draft"} | v02_core_artwork_mode_set_explicit_choice_request |
| nyamuru_voice_504 | 作画方式の二つの候補のうち、下書きのほうをいま選択してください。 | {"mode": "draft"} | v02_core_artwork_mode_set_explicit_choice_request |
| nyamuru_voice_505 | 仕上げ方を決めたよ。今回は作画方式を一体型に変更して。 | {"mode": "integrated"} | v02_core_artwork_mode_set_workflow_decision |
| nyamuru_voice_506 | コマごとに手直しする予定を見直したので、いま一体型の作画設定へ切り替えて。 | {"mode": "integrated"} | v02_core_artwork_mode_set_workflow_decision |
| nyamuru_voice_507 | 手描きで仕上げる方針に変えた。作画方式を下書きにしてください。 | {"mode": "draft"} | v02_core_artwork_mode_set_workflow_decision |
| nyamuru_voice_508 | いったんラフから進めることにしたので、設定は下書き方式を選んでくれる？ | {"mode": "draft"} | v02_core_artwork_mode_set_workflow_decision |

## 吹き出しの指定変更 — `bubble_set`

| ID | 発話本文 | slots | group |
|---|---|---|---|
| nyamuru_voice_509 | 説明用にしたいので、選択した吹き出しの形をキャプションへ変更してください。 | {"target": "selected_bubble", "field": "shape", "value": "caption"} | v02_edit_bubble_shape |
| nyamuru_voice_510 | 丸い形はやめて、この吹き出しの形は四角を指定して。 | {"target": "selected_bubble", "field": "shape", "value": "square"} | v02_edit_bubble_shape |
| nyamuru_voice_511 | 選んである吹き出し、形の項目を「ふつう」に戻してもらえますか。 | {"target": "selected_bubble", "field": "shape", "value": "normal"} | v02_edit_bubble_shape |
| nyamuru_voice_512 | キャプションと言ったけれど訂正。この吹き出しは四角の形にしてほしい。 | {"target": "selected_bubble", "field": "shape", "value": "square"} | v02_edit_bubble_shape |
| nyamuru_voice_513 | 今選んだ吹き出しには、素材一覧のnomal 01を指定してほしい。 | {"target": "selected_bubble", "field": "preset", "preset_id": "nomal_01"} | v02_edit_bubble_preset |
| nyamuru_voice_514 | 素材はもう決めたよ。この吹き出しをtoge 02に差し替えて。 | {"target": "selected_bubble", "field": "preset", "preset_id": "toge_02"} | v02_edit_bubble_preset |
| nyamuru_voice_515 | この吹き出しの素材、toge 02ではなくnomal 01でお願いします。 | {"target": "selected_bubble", "field": "preset", "preset_id": "nomal_01"} | v02_edit_bubble_preset |
| nyamuru_voice_516 | 比較は終わったので、選択中の吹き出しへtoge 02の素材を適用してくれる？ | {"target": "selected_bubble", "field": "preset", "preset_id": "toge_02"} | v02_edit_bubble_preset |
| nyamuru_voice_517 | 選んでいる吹き出しは、しっぽのない状態に変更して。 | {"target": "selected_bubble", "field": "tail_enabled", "value": false} | v02_edit_bubble_presence_clip |
| nyamuru_voice_518 | この吹き出しだけ、しっぽありの設定を使いたいから有効にして。 | {"target": "selected_bubble", "field": "tail_enabled", "value": true} | v02_edit_bubble_presence_clip |
| nyamuru_voice_519 | コマの外にはみ出す部分は切り取る設定に、この吹き出しを変更して。 | {"target": "selected_bubble", "field": "clip_to_panel", "value": true} | v02_edit_bubble_presence_clip |
| nyamuru_voice_520 | 選択中の吹き出しの「コマ枠で切り取る」を無効にしてください。 | {"target": "selected_bubble", "field": "clip_to_panel", "value": false} | v02_edit_bubble_presence_clip |
| nyamuru_voice_521 | 寸法はそのままで、選択した吹き出しを下方向へ二ミリずらしてください。 | {"target": "selected_bubble", "field": "bbox", "operation": "translate", "dx_mm": 0, "dy_mm": 2} | v02_edit_bubble_position |
| nyamuru_voice_522 | 今の位置を基準に、この吹き出しを左へ一ミリ、下へ三ミリ移動して。 | {"target": "selected_bubble", "field": "bbox", "operation": "translate", "dx_mm": -1, "dy_mm": 3} | v02_edit_bubble_position |
| nyamuru_voice_523 | 吹き出しの配置を調整したい。選択している一つを右へ四ミリ動かして。 | {"target": "selected_bubble", "field": "bbox", "operation": "translate", "dx_mm": 4, "dy_mm": 0} | v02_edit_bubble_position |
| nyamuru_voice_524 | 選択中の吹き出しの位置は、上へ二ミリと右へ一ミリの移動でお願いします。 | {"target": "selected_bubble", "field": "bbox", "operation": "translate", "dx_mm": 1, "dy_mm": -2} | v02_edit_bubble_position |
| nyamuru_voice_525 | 選んだ吹き出し、横幅だけ二十八ミリに設定してほしい。 | {"target": "selected_bubble", "field": "bbox", "operation": "resize", "width_mm": 28} | v02_edit_bubble_dimensions |
| nyamuru_voice_526 | この吹き出しは高さを三十二ミリで指定します。寸法を変えて。 | {"target": "selected_bubble", "field": "bbox", "operation": "resize", "height_mm": 32} | v02_edit_bubble_dimensions |
| nyamuru_voice_527 | 幅二十四ミリ、高さ三十八ミリを、いま選択中の吹き出しに設定して。 | {"target": "selected_bubble", "field": "bbox", "operation": "resize", "width_mm": 24, "height_mm": 38} | v02_edit_bubble_dimensions |
| nyamuru_voice_528 | 選択している吹き出しのサイズは横三十六ミリ、縦二十ミリにしてください。 | {"target": "selected_bubble", "field": "bbox", "operation": "resize", "width_mm": 36, "height_mm": 20} | v02_edit_bubble_dimensions |
| nyamuru_voice_529 | 選択している吹き出しのセリフを「ここで待ってる。」に置き換えて。 | {"target": "selected_bubble", "field": "text", "value": "ここで待ってる。"} | v02_edit_bubble_text |
| nyamuru_voice_530 | この吹き出しに入れる文は「まだ帰らないよ」です。本文をそれにして。 | {"target": "selected_bubble", "field": "text", "value": "まだ帰らないよ"} | v02_edit_bubble_text |
| nyamuru_voice_531 | セリフの修正です。この吹き出しの本文を「ベクターペンを選んで」に変えて。 | {"target": "selected_bubble", "field": "text", "value": "ベクターペンを選んで"} | v02_edit_bubble_text |
| nyamuru_voice_532 | 選んだ吹き出しの文字は「内枠スナップを使わない状態にして」に差し替えて。 | {"target": "selected_bubble", "field": "text", "value": "内枠スナップを使わない状態にして"} | v02_edit_bubble_text |
| nyamuru_voice_533 | 話す人の指定を直したい。この吹き出しの話者を小雪に設定して。 | {"target": "selected_bubble", "field": "speaker", "name": "小雪"} | v02_edit_bubble_speaker_owner |
| nyamuru_voice_534 | 選択している吹き出しから、話者の指定だけ外してください。 | {"target": "selected_bubble", "field": "speaker", "name": null} | v02_edit_bubble_speaker_owner |
| nyamuru_voice_535 | この吹き出しの所属先は、今のページの三コマ目に変更して。 | {"target": "selected_bubble", "field": "owner", "owner": "panel", "panel_number": 3} | v02_edit_bubble_speaker_owner |
| nyamuru_voice_536 | コマへの所属をやめて、選択中の吹き出しはページ前景の所属にして。 | {"target": "selected_bubble", "field": "owner", "owner": "page_overlay"} | v02_edit_bubble_speaker_owner |
| nyamuru_voice_537 | 選んでいる吹き出しを、同じコマにある二番の吹き出しと結合して。 | {"target": "selected_bubble", "field": "join_to", "bubble_number": 2} | v02_edit_bubble_join |
| nyamuru_voice_538 | この吹き出しは、同じコマにある三番の吹き出しにつないで。 | {"target": "selected_bubble", "field": "join_to", "bubble_number": 3} | v02_edit_bubble_join |
| nyamuru_voice_539 | 今つながっているこの吹き出しは、結合なしの状態に戻して。 | {"target": "selected_bubble", "field": "join_to", "bubble_number": null} | v02_edit_bubble_join |
| nyamuru_voice_540 | 選択中の吹き出しの結合先を外して、独立した状態にしてください。 | {"target": "selected_bubble", "field": "join_to", "bubble_number": null} | v02_edit_bubble_join |

## 意味・指定が不足 — `needs_clarification`

| ID | 発話本文 | slots | group |
|---|---|---|---|
| nyamuru_voice_701 | 前のに戻してほしい | {} | v02_routes_ambiguous_operation |
| nyamuru_voice_702 | もう一回やってもらえる？ | {} | v02_routes_ambiguous_operation |
| nyamuru_voice_703 | それ、逆にして | {} | v02_routes_ambiguous_operation |
| nyamuru_voice_704 | 今のをやり直す方向でお願い | {} | v02_routes_ambiguous_operation |
| nyamuru_voice_705 | 設定は昨日お願いしたほうに戻して | {} | v02_routes_history_reference |
| nyamuru_voice_706 | 前に決めたやり方で処理して | {} | v02_routes_history_reference |
| nyamuru_voice_707 | さっき伝えたサイズに合わせて | {} | v02_routes_history_reference |
| nyamuru_voice_708 | さっきの「それでお願い」を実行して | {} | v02_routes_history_reference |
| nyamuru_voice_709 | コマシンクロ、設定を別のほうにして | {} | v02_routes_unspecified_setting |
| nyamuru_voice_710 | 内枠スナップを切り替えておいて | {} | v02_routes_unspecified_setting |
| nyamuru_voice_711 | コマスナップは今までとは違う設定にして | {} | v02_routes_unspecified_setting |
| nyamuru_voice_712 | 作画方式を変更してほしいんだけど | {} | v02_routes_unspecified_setting |
| nyamuru_voice_713 | 作業しやすいようにガイドを出して | {} | v02_routes_unspecified_display |
| nyamuru_voice_714 | このガイドだけ非表示にして | {} | v02_routes_unspecified_display |
| nyamuru_voice_715 | 表示は別のモードに変えて | {} | v02_routes_unspecified_display |
| nyamuru_voice_716 | 全体のほうにしてもらっていい？ | {} | v02_routes_unspecified_display |
| nyamuru_voice_717 | 選択中の吹き出しは、話者を変更して | {} | v02_routes_unspecified_bubble_value |
| nyamuru_voice_718 | この吹き出しの素材を別のにして | {} | v02_routes_unspecified_bubble_value |
| nyamuru_voice_719 | 吹き出しの数値を十二にしておいて | {} | v02_routes_unspecified_bubble_value |
| nyamuru_voice_720 | この吹き出しは二番でお願い | {} | v02_routes_unspecified_bubble_value |
| nyamuru_voice_721 | 二コマ目の人物を、ええと | {} | v02_routes_incomplete_request |
| nyamuru_voice_722 | 今選んでる吹き出しの | {} | v02_routes_incomplete_request |
| nyamuru_voice_723 | ページの表示を、あの | {} | v02_routes_incomplete_request |
| nyamuru_voice_724 | 小雪ちゃんだけ、その設定で | {} | v02_routes_incomplete_request |
| nyamuru_voice_725 | ペンは別の種類に変えておいて | {} | v02_routes_unspecified_tool_alignment |
| nyamuru_voice_726 | いつものペンに戻してほしい | {} | v02_routes_unspecified_tool_alignment |
| nyamuru_voice_727 | 選んだ文字枠をそろえておいて | {} | v02_routes_unspecified_tool_alignment |
| nyamuru_voice_728 | この文字は揃え方を変えて | {} | v02_routes_unspecified_tool_alignment |
| nyamuru_voice_729 | 候補を二つお願い | {} | v02_routes_unspecified_candidates |
| nyamuru_voice_730 | この場面向けの候補を並べて | {} | v02_routes_unspecified_candidates |
| nyamuru_voice_731 | 別の候補を見せてもらえる？ | {} | v02_routes_unspecified_candidates |
| nyamuru_voice_732 | 生成じゃなくて、候補のほうを出して | {} | v02_routes_unspecified_candidates |

## LLMによる内容判断 — `needs_reasoning`

| ID | 発話本文 | slots | group |
|---|---|---|---|
| nyamuru_voice_733 | この独白に合う吹き出し素材を、本文を読んで選んで | {} | v02_routes_reason_material |
| nyamuru_voice_734 | 既存の吹き出し素材から、小声の会話にふさわしいものを考えて | {} | v02_routes_reason_material |
| nyamuru_voice_735 | 怒鳴っているセリフだけど怖くしすぎない素材を選んでほしい | {} | v02_routes_reason_material |
| nyamuru_voice_736 | 丸か四角かを決め打ちせず、この台本に合う吹き出しの形を提案して | {} | v02_routes_reason_material |
| nyamuru_voice_737 | このページ、読む順番で迷わない吹き出し配置を考えて | {} | v02_routes_reason_reading_layout |
| nyamuru_voice_738 | 右のセリフから自然に目が進むように、吹き出しの位置を調整して | {} | v02_routes_reason_reading_layout |
| nyamuru_voice_739 | コマの絵を見て、セリフ同士が窮屈に見えない配置を提案して | {} | v02_routes_reason_reading_layout |
| nyamuru_voice_740 | 最後の一言を読み落とさないよう、このページの吹き出し配置を見直して | {} | v02_routes_reason_reading_layout |
| nyamuru_voice_741 | 画面の誰がしゃべっているか伝わるように、しっぽの向きを考えて | {} | v02_routes_reason_tail |
| nyamuru_voice_742 | この人物の表情を隠さない、しっぽの長さに調整してほしい | {} | v02_routes_reason_tail |
| nyamuru_voice_743 | しっぽが隣の人物を指して見えないよう、絵に合わせて直して | {} | v02_routes_reason_tail |
| nyamuru_voice_744 | 二人が近いので、話者を取り違えないしっぽの付け方を提案して | {} | v02_routes_reason_tail |
| nyamuru_voice_745 | この返事が誰のものか、前後の台本から判断して話者を直して | {} | v02_routes_reason_speaker |
| nyamuru_voice_746 | 人物設定とセリフの口調を照合して、この吹き出しの話者を選んで | {} | v02_routes_reason_speaker |
| nyamuru_voice_747 | 名前の指定はしないので、この会話の流れから発言者を特定して | {} | v02_routes_reason_speaker |
| nyamuru_voice_748 | ここは独白か相手の返事かを読み取って、吹き出しの話者を提案して | {} | v02_routes_reason_speaker |
| nyamuru_voice_749 | この長いセリフが窮屈に見えない吹き出しの大きさを考えて | {} | v02_routes_reason_size |
| nyamuru_voice_750 | 短い相づちなので、周りの吹き出しと釣り合う寸法に調整して | {} | v02_routes_reason_size |
| nyamuru_voice_751 | 文字を読める余白は残して、この吹き出しをもう少し小さくして | {} | v02_routes_reason_size |
| nyamuru_voice_752 | 数字では指定しないので、絵とのバランスを見て吹き出しを広げて | {} | v02_routes_reason_size |
| nyamuru_voice_753 | 喜んでいるけど大騒ぎではない感じが伝わる吹き出しにして | {} | v02_routes_reason_expression |
| nyamuru_voice_754 | 気まずい間が伝わるよう、この吹き出しの見せ方を考えて | {} | v02_routes_reason_expression |
| nyamuru_voice_755 | 心の声だと読み取れる表現を、この場面に合わせて提案して | {} | v02_routes_reason_expression |
| nyamuru_voice_756 | 同じ「大丈夫」でも強がっている場面として、吹き出しの表現を選んで | {} | v02_routes_reason_expression |
| nyamuru_voice_757 | この手の動きが見える位置へ、吹き出しをうまくよけて | {} | v02_routes_reason_occlusion |
| nyamuru_voice_758 | 背景の看板を隠さないよう、吹き出しをどこに置くか考えて | {} | v02_routes_reason_occlusion |
| nyamuru_voice_759 | 人物の視線を遮らず読める位置に、この吹き出しを移して | {} | v02_routes_reason_occlusion |
| nyamuru_voice_760 | ページの端で文字が窮屈にならない位置を考えて、吹き出しを直して | {} | v02_routes_reason_occlusion |
| nyamuru_voice_761 | 上端を機械的にそろえるのではなく、会話の間が伝わる文字配置を考えて | {} | v02_routes_reason_typesetting |
| nyamuru_voice_762 | この二つのセリフは同時に聞こえる感じにしたいので、文字の置き方を提案して | {} | v02_routes_reason_typesetting |
| nyamuru_voice_763 | 一つ目を強く読ませるように、吹き出しの中の文字配置を見直して | {} | v02_routes_reason_typesetting |
| nyamuru_voice_764 | 余白の取り方を読んだ印象で判断して、このページのセリフを組み直して | {} | v02_routes_reason_typesetting |

## 複数操作 — `compound_request`

| ID | 発話本文 | slots | group |
|---|---|---|---|
| nyamuru_voice_765 | この状態を保存したら、最後のページを表示して | {} | v02_routes_compound_save_page |
| nyamuru_voice_766 | まず先頭ページを開いて、それから作品を保存して | {} | v02_routes_compound_save_page |
| nyamuru_voice_767 | 修正を保存して、二ページ先に進んでほしい | {} | v02_routes_compound_save_page |
| nyamuru_voice_768 | 今の作品を保存してから、五ページに移動してほしい | {} | v02_routes_compound_save_page |
| nyamuru_voice_769 | 二回アンドゥして、戻った状態を保存して | {} | v02_routes_compound_history_save |
| nyamuru_voice_770 | 取り消した編集を一回復活させてから、作品を保存して | {} | v02_routes_compound_history_save |
| nyamuru_voice_771 | 最後の編集を取り消したあとで、画面を用紙に合わせて | {} | v02_routes_compound_history_save |
| nyamuru_voice_772 | リドゥを二回して、そのあと次のページを開いて | {} | v02_routes_compound_history_save |
| nyamuru_voice_773 | 用紙が収まる倍率にして、配置ガイドも表示して | {} | v02_routes_compound_view_pair |
| nyamuru_voice_774 | 見開きをやめて、人物のタブを開いて | {} | v02_routes_compound_view_pair |
| nyamuru_voice_775 | 編集ガイドを隠してから、原寸表示にしてほしい | {} | v02_routes_compound_view_pair |
| nyamuru_voice_776 | シナリオタブを開いて、見開き表示も有効にして | {} | v02_routes_compound_view_pair |
| nyamuru_voice_777 | 選んだ吹き出しを四角に変えて、話者は小雪ちゃんにして | {} | v02_routes_compound_bubble_fields |
| nyamuru_voice_778 | この吹き出しの本文を「待って」にして、しっぽも付けて | {} | v02_routes_compound_bubble_fields |
| nyamuru_voice_779 | 吹き出しを右へ三ミリ移して、コマでの切取りをオンにして | {} | v02_routes_compound_bubble_fields |
| nyamuru_voice_780 | この吹き出しのしっぽを外して、幅を二十五ミリにして | {} | v02_routes_compound_bubble_fields |
| nyamuru_voice_781 | 内枠スナップをオンにして、コマスナップはオフにして | {} | v02_routes_compound_settings |
| nyamuru_voice_782 | コマシンクロを無効にして、作画方式を下書きにして | {} | v02_routes_compound_settings |
| nyamuru_voice_783 | 一体型に切り替えてから、ベクターペンを選んで | {} | v02_routes_compound_settings |
| nyamuru_voice_784 | コマスナップを有効にして、この作品も保存して | {} | v02_routes_compound_settings |
| nyamuru_voice_785 | 下書き方式に変えてから、選択中の人物を生成して | {} | v02_routes_compound_generation |
| nyamuru_voice_786 | 今のページを丸ごと生成して、その結果を作品に保存して | {} | v02_routes_compound_generation |
| nyamuru_voice_787 | 二コマ目を生成したあとで、四コマ目も生成して | {} | v02_routes_compound_generation |
| nyamuru_voice_788 | コマ一の小雪ちゃんを生成して、次に同じコマのミナちゃんも生成して | {} | v02_routes_compound_generation |
| nyamuru_voice_789 | 登録済み3D背景の候補を出して、最初の候補を今のコマに適用して | {} | v02_routes_compound_background |
| nyamuru_voice_790 | 二ページ目を開いてから、そのページの背景候補を見せて | {} | v02_routes_compound_background |
| nyamuru_voice_791 | コマ二の背景候補を出して、コマ四の背景候補も出して | {} | v02_routes_compound_background |
| nyamuru_voice_792 | 選んでいる人物を生成して、登録済み3D背景の候補も提示して | {} | v02_routes_compound_background |
| nyamuru_voice_793 | ベクターペンにして、選んだ文字枠は上端をそろえて | {} | v02_routes_compound_alignment |
| nyamuru_voice_794 | 選択した文字枠の上端をそろえたら、作品を保存して | {} | v02_routes_compound_alignment |
| nyamuru_voice_795 | 文字枠の頭をそろえてから、表示を原寸に戻して | {} | v02_routes_compound_alignment |
| nyamuru_voice_796 | コマ三を開くのではなく、ラスターペンに切り替えて、選択中の文字枠の上端もそろえて | {} | v02_routes_compound_alignment |

## 初期範囲外の依頼 — `out_of_scope_request`

| ID | 発話本文 | slots | group |
|---|---|---|---|
| nyamuru_voice_797 | 元の作品を残して「改訂版」という別名で保存して | {} | v02_routes_out_project_files |
| nyamuru_voice_798 | いまの作品の保存先をデスクトップに変えて | {} | v02_routes_out_project_files |
| nyamuru_voice_799 | 作業用に空の作品を新規作成して | {} | v02_routes_out_project_files |
| nyamuru_voice_800 | この作品が入っているフォルダを開いてほしい | {} | v02_routes_out_project_files |
| nyamuru_voice_801 | 今見ているページを作品から取り除いて | {} | v02_routes_out_page_structure |
| nyamuru_voice_802 | 最後に白紙のページを一枚足して | {} | v02_routes_out_page_structure |
| nyamuru_voice_803 | 二ページ目と三ページ目の順番を入れ替えて | {} | v02_routes_out_page_structure |
| nyamuru_voice_804 | このページの複製を次のページとして追加して | {} | v02_routes_out_page_structure |
| nyamuru_voice_805 | このコマに空の吹き出しをもう一個作って | {} | v02_routes_out_bubble_structure |
| nyamuru_voice_806 | 今選んでいる吹き出しを削除してほしい | {} | v02_routes_out_bubble_structure |
| nyamuru_voice_807 | 選択中の吹き出しを複製して隣に一つ増やして | {} | v02_routes_out_bubble_structure |
| nyamuru_voice_808 | 選んだ吹き出しにはウニフラッシュ素材を設定して | {} | v02_routes_out_bubble_structure |
| nyamuru_voice_809 | 今の一ページだけでなく、作品の全ページをまとめて画像生成して | {} | v02_routes_generation_scope |
| nyamuru_voice_810 | 先頭から末尾までのページを一括で生成してほしい | {} | v02_routes_generation_scope |
| nyamuru_voice_811 | いま走っている人物の画像生成を中止して | {} | v02_routes_generation_scope |
| nyamuru_voice_812 | このコマの生成処理を実行中なら止めて | {} | v02_routes_generation_scope |
| nyamuru_voice_813 | 登録モデルにはないので、ネットで使える3D教室モデルを探して | {} | v02_routes_bg_boundaries |
| nyamuru_voice_814 | この設定画をもとに新しい3D背景モデルを生成して | {} | v02_routes_bg_boundaries |
| nyamuru_voice_815 | 登録済みの3D背景を使って、カメラアングルの案を四つ作って | {} | v02_routes_bg_boundaries |
| nyamuru_voice_816 | 候補一覧の二番目の3Dモデルをこのコマの背景に配置して | {} | v02_routes_bg_boundaries |
| nyamuru_voice_817 | この線画レイヤーをベクター形式に変換して | {} | v02_routes_out_paint_operation |
| nyamuru_voice_818 | 今あるベクターの絵をラスター化して | {} | v02_routes_out_paint_operation |
| nyamuru_voice_819 | ラスターペンで、この位置から横線を一本引いて | {} | v02_routes_out_paint_operation |
| nyamuru_voice_820 | 描いてある線を消しゴムで全部消して | {} | v02_routes_out_paint_operation |
| nyamuru_voice_821 | このセリフの文章を段落ごとに中央揃えにして | {} | v02_routes_out_alignment |
| nyamuru_voice_822 | 本文の各行を右端でそろえて | {} | v02_routes_out_alignment |
| nyamuru_voice_823 | 選んだ吹き出しの外側の輪郭を上端で整列して | {} | v02_routes_out_alignment |
| nyamuru_voice_824 | 複数選んだ文字枠を下端でそろえて | {} | v02_routes_out_alignment |
| nyamuru_voice_825 | 今表示しているページを印刷して | {} | v02_routes_out_output |
| nyamuru_voice_826 | この作品をPDFとして書き出してほしい | {} | v02_routes_out_output |
| nyamuru_voice_827 | 完成したページの画像をPNGで書き出して | {} | v02_routes_out_output |
| nyamuru_voice_828 | 作品フォルダ全体をZIPにまとめて | {} | v02_routes_out_output |

## 今回の実行依頼ではない — `not_command`

| ID | 発話本文 | slots | group |
|---|---|---|---|
| nyamuru_voice_829 | 保存ボタンを押すと何が記録されるのか教えて | {} | v02_routes_noaction_explanation |
| nyamuru_voice_830 | 一体型と下書き方式の違いを説明して | {} | v02_routes_noaction_explanation |
| nyamuru_voice_831 | 文字枠の頭をそろえる手順はどうなってるの？ | {} | v02_routes_noaction_explanation |
| nyamuru_voice_832 | コマシンクロを使うとコマの動きはどう変わるの？ | {} | v02_routes_noaction_explanation |
| nyamuru_voice_833 | 最後に保存されたのはいつ？ | {} | v02_routes_noaction_state |
| nyamuru_voice_834 | 内枠スナップの現在の設定を教えて | {} | v02_routes_noaction_state |
| nyamuru_voice_835 | 今使っているのはベクターペン？ | {} | v02_routes_noaction_state |
| nyamuru_voice_836 | 選択中の吹き出しにはしっぽが付いている？ | {} | v02_routes_noaction_state |
| nyamuru_voice_837 | このアプリは人物だけを生成する機能にも対応している？ | {} | v02_routes_noaction_capability |
| nyamuru_voice_838 | 全ページの一括生成という機能はあるの？ | {} | v02_routes_noaction_capability |
| nyamuru_voice_839 | 登録した3Dモデルから候補を出す仕組みは用意されてる？ | {} | v02_routes_noaction_capability |
| nyamuru_voice_840 | 文字枠の上端揃えは、今の版で使える機能なの？ | {} | v02_routes_noaction_capability |
| nyamuru_voice_841 | さっき二回アンドゥしておいたよ | {} | v02_routes_noaction_report |
| nyamuru_voice_842 | 保存は自分で済ませたところ | {} | v02_routes_noaction_report |
| nyamuru_voice_843 | ベクターペンに切り替えたら描きやすくなった | {} | v02_routes_noaction_report |
| nyamuru_voice_844 | このコマの背景候補は確認済みだよ | {} | v02_routes_noaction_report |
| nyamuru_voice_845 | そろそろ保存する時間かなあ | {} | v02_routes_noaction_thought |
| nyamuru_voice_846 | このページは下書き方式のほうがよかったかも | {} | v02_routes_noaction_thought |
| nyamuru_voice_847 | 文字の頭がそろうと見た目がすっきりするね | {} | v02_routes_noaction_thought |
| nyamuru_voice_848 | 「次のページに進んで」というセリフ、ちょっと変だね | {} | v02_routes_noaction_thought |
| nyamuru_voice_849 | 保存は確認が終わるまで待ってて | {} | v02_routes_noaction_preserve |
| nyamuru_voice_850 | ペンを変えて、いや、今のペンのままでいい | {} | v02_routes_noaction_preserve |
| nyamuru_voice_851 | 文字枠の位置はまだ動かさないでおこう | {} | v02_routes_noaction_preserve |
| nyamuru_voice_852 | 「コマスナップをオンにして」は例文だから、設定は変えないで | {} | v02_routes_noaction_preserve |
| nyamuru_voice_853 | 今のページを丸ごと生成するのは、まだ待って | {} | v02_routes_generation_scope |
| nyamuru_voice_854 | 人物の生成はこれからだから、今は開始しないで | {} | v02_routes_generation_scope |
| nyamuru_voice_855 | 全ページを生成して、いや、その依頼は撤回する | {} | v02_routes_generation_scope |
| nyamuru_voice_856 | このコマはもう生成できているので、そのままでいい | {} | v02_routes_generation_scope |
| nyamuru_voice_857 | 登録済みの3D背景候補は、まだ出さなくていいよ | {} | v02_routes_bg_boundaries |
| nyamuru_voice_858 | 背景候補を見せて、いや、台本を直してからにする | {} | v02_routes_bg_boundaries |
| nyamuru_voice_859 | 「背景候補を出して」と説明書にあるけど、ここでは例として読んだだけ | {} | v02_routes_bg_boundaries |
| nyamuru_voice_860 | 背景モデルは今の配置のままにして、候補も出さないで | {} | v02_routes_bg_boundaries |

## コマシンクロのオン・オフ — `panel_sync_set`

| ID | 発話本文 | slots | group |
|---|---|---|---|
| nyamuru_voice_541 | コマ割りの調整に使いたいので、コマシンクロを有効にしてください。 | {"enabled": true} | v02_edit_setting_motive |
| nyamuru_voice_542 | 今回はコマを個別に扱うつもりだから、コマシンクロを無効にしてほしい。 | {"enabled": false} | v02_edit_setting_motive |
| nyamuru_voice_543 | コマ編集の準備です。コマシンクロありの設定に変えて。 | {"enabled": true} | v02_edit_setting_motive |
| nyamuru_voice_544 | この作業では同期を使わないから、コマシンクロの設定をオフへ変更して。 | {"enabled": false} | v02_edit_setting_motive |
| nyamuru_voice_545 | コマシンクロが今オフなので、オンの状態へ変えてください。 | {"enabled": true} | v02_edit_setting_current |
| nyamuru_voice_546 | いま有効になっているコマシンクロを、無効の状態にしてください。 | {"enabled": false} | v02_edit_setting_current |
| nyamuru_voice_547 | コマシンクロは切れていたね。使えるようにオンへ設定して。 | {"enabled": true} | v02_edit_setting_current |
| nyamuru_voice_548 | コマシンクロにチェックが残っているから、オフに直してもらえる？ | {"enabled": false} | v02_edit_setting_current |
| nyamuru_voice_549 | コマシンクロは無効に、と言いかけたけど訂正。有効に設定して。 | {"enabled": true} | v02_edit_setting_correction |
| nyamuru_voice_550 | コマシンクロを使う予定は変更した。使わない状態に設定してください。 | {"enabled": false} | v02_edit_setting_correction |
| nyamuru_voice_551 | さっきのオフ指定は取り消しで、コマシンクロはオンにしてほしい。 | {"enabled": true} | v02_edit_setting_correction |
| nyamuru_voice_552 | コマシンクロをオンにする話はやめて、オフを設定して。 | {"enabled": false} | v02_edit_setting_correction |
| nyamuru_voice_553 | 内枠スナップの値はそのまま、コマシンクロの設定だけ有効にして。 | {"enabled": true} | v02_edit_setting_other_preserve |
| nyamuru_voice_554 | コマスナップは触らずに、コマシンクロだけオフへ変更してください。 | {"enabled": false} | v02_edit_setting_other_preserve |
| nyamuru_voice_555 | 変更するのはコマシンクロだけです。オンを指定して、ほかの設定は維持して。 | {"enabled": true} | v02_edit_setting_other_preserve |
| nyamuru_voice_556 | コマシンクロを無効にしてもらえる？ ほかの二つのコマ設定は今のままで。 | {"enabled": false} | v02_edit_setting_other_preserve |
| nyamuru_voice_557 | このコマだけの指定ではなく、編集設定のコマシンクロをオンにしてください。 | {"enabled": true} | v02_edit_setting_global |
| nyamuru_voice_558 | アプリのコマシンクロ設定をオフへ変えて。コマ自体の移動はまだしないよ。 | {"enabled": false} | v02_edit_setting_global |
| nyamuru_voice_559 | コマを動かす依頼ではありません。コマシンクロの設定値を有効にして。 | {"enabled": true} | v02_edit_setting_global |
| nyamuru_voice_560 | コマシンクロは編集全体の設定として、無効を指定してください。 | {"enabled": false} | v02_edit_setting_global |
| nyamuru_voice_561 | コマシンクロの項目を、チェックが付いた状態にしてください。 | {"enabled": true} | v02_edit_setting_checkbox |
| nyamuru_voice_562 | コマシンクロのチェック欄を空の状態にしてほしい。 | {"enabled": false} | v02_edit_setting_checkbox |
| nyamuru_voice_563 | 設定欄のコマシンクロにはチェックありを指定して。 | {"enabled": true} | v02_edit_setting_checkbox |
| nyamuru_voice_564 | コマシンクロのところ、チェックなしへ変更をお願いします。 | {"enabled": false} | v02_edit_setting_checkbox |
| nyamuru_voice_565 | 編集を再開する前に、まずコマシンクロを有効にしておいて。 | {"enabled": true} | v02_edit_setting_before_work |
| nyamuru_voice_566 | これからコマを調整するので、その前にコマシンクロをオフにしてほしい。 | {"enabled": false} | v02_edit_setting_before_work |
| nyamuru_voice_567 | 次の作業の準備として、コマシンクロをオンへ設定してください。 | {"enabled": true} | v02_edit_setting_before_work |
| nyamuru_voice_568 | ひとまずコマシンクロを無効にしておいて。編集はこのあと自分でやる。 | {"enabled": false} | v02_edit_setting_before_work |
| nyamuru_voice_569 | コマシンクロを使う状態に設定してもらえますか。 | {"enabled": true} | v02_edit_setting_use_state |
| nyamuru_voice_570 | コマシンクロは使わない設定でお願い。 | {"enabled": false} | v02_edit_setting_use_state |
| nyamuru_voice_571 | コマシンクロありで作業したいので、その状態に設定してください。 | {"enabled": true} | v02_edit_setting_use_state |
| nyamuru_voice_572 | コマシンクロなしの状態を希望します。設定をそれに変えて。 | {"enabled": false} | v02_edit_setting_use_state |

## 内枠スナップのオン・オフ — `inner_frame_snap_set`

| ID | 発話本文 | slots | group |
|---|---|---|---|
| nyamuru_voice_573 | 内枠を目安に編集したいから、内枠スナップを使う設定に変えて。 | {"enabled": true} | v02_edit_setting_motive |
| nyamuru_voice_574 | 内枠スナップを外して作業したいので、設定を無効にしてください。 | {"enabled": false} | v02_edit_setting_motive |
| nyamuru_voice_575 | 配置を調整するために、内枠スナップを有効にしてほしい。 | {"enabled": true} | v02_edit_setting_motive |
| nyamuru_voice_576 | 細かな位置を手で決めたい。内枠スナップはオフの設定にして。 | {"enabled": false} | v02_edit_setting_motive |
| nyamuru_voice_577 | 内枠スナップが無効のままだったので、有効へ変更してください。 | {"enabled": true} | v02_edit_setting_current |
| nyamuru_voice_578 | いま内枠スナップが効く設定だから、オフの状態へ変えて。 | {"enabled": false} | v02_edit_setting_current |
| nyamuru_voice_579 | 内枠スナップのチェックが外れている。チェックありの状態に直してほしい。 | {"enabled": true} | v02_edit_setting_current |
| nyamuru_voice_580 | 現在オンになっている内枠スナップを、今ここでオフにしてください。 | {"enabled": false} | v02_edit_setting_current |
| nyamuru_voice_581 | 内枠スナップを切るのはやめます。オンに設定するほうでお願いします。 | {"enabled": true} | v02_edit_setting_correction |
| nyamuru_voice_582 | オンと頼んだ内枠スナップ、訂正してオフにしてください。 | {"enabled": false} | v02_edit_setting_correction |
| nyamuru_voice_583 | 内枠スナップなしと言ったけど、最終的には有効を選んで。 | {"enabled": true} | v02_edit_setting_correction |
| nyamuru_voice_584 | 内枠スナップを使うと言ったのは撤回。使わない状態を設定して。 | {"enabled": false} | v02_edit_setting_correction |
| nyamuru_voice_585 | コマシンクロはそのままにして、内枠スナップを有効にする変更だけお願い。 | {"enabled": true} | v02_edit_setting_other_preserve |
| nyamuru_voice_586 | コマスナップの設定は維持して、内枠スナップだけ無効にしてくれる？ | {"enabled": false} | v02_edit_setting_other_preserve |
| nyamuru_voice_587 | 内枠スナップをオンにしてほしい。ほかの設定は変えなくていい。 | {"enabled": true} | v02_edit_setting_other_preserve |
| nyamuru_voice_588 | 今回変えるのは内枠スナップです。オフにして、ほかのコマ設定は保持して。 | {"enabled": false} | v02_edit_setting_other_preserve |
| nyamuru_voice_589 | 選んだコマだけではなく、編集設定として内枠スナップを有効にして。 | {"enabled": true} | v02_edit_setting_global |
| nyamuru_voice_590 | 内枠そのものを動かさず、内枠スナップの設定だけオフにしてほしい。 | {"enabled": false} | v02_edit_setting_global |
| nyamuru_voice_591 | 内枠スナップをアプリの設定でオンにしてください。コマの形は今のままで。 | {"enabled": true} | v02_edit_setting_global |
| nyamuru_voice_592 | 編集時の内枠スナップという設定項目を、無効の値へ変更してください。 | {"enabled": false} | v02_edit_setting_global |
| nyamuru_voice_593 | 内枠スナップのチェックボックスを、選択済みの状態にして。 | {"enabled": true} | v02_edit_setting_checkbox |
| nyamuru_voice_594 | 内枠スナップの欄は、チェックを外した状態にしてください。 | {"enabled": false} | v02_edit_setting_checkbox |
| nyamuru_voice_595 | 設定の内枠スナップにチェックが付くよう変更をお願いします。 | {"enabled": true} | v02_edit_setting_checkbox |
| nyamuru_voice_596 | 内枠スナップのチェック欄は空欄に変更してもらえる？ | {"enabled": false} | v02_edit_setting_checkbox |
| nyamuru_voice_597 | 配置を始める前に済ませたいので、内枠スナップをオンにしておいて。 | {"enabled": true} | v02_edit_setting_before_work |
| nyamuru_voice_598 | 次にコマを触る準備として、内枠スナップを無効へ設定して。 | {"enabled": false} | v02_edit_setting_before_work |
| nyamuru_voice_599 | 作業に戻るから、その前の設定として内枠スナップを有効にしてください。 | {"enabled": true} | v02_edit_setting_before_work |
| nyamuru_voice_600 | 今は準備だけ。内枠スナップをオフに変更しておいてください。 | {"enabled": false} | v02_edit_setting_before_work |
| nyamuru_voice_601 | 内枠スナップありで編集する状態に、設定を変えてほしい。 | {"enabled": true} | v02_edit_setting_use_state |
| nyamuru_voice_602 | 内枠スナップは使わない状態に設定しておいてください。 | {"enabled": false} | v02_edit_setting_use_state |
| nyamuru_voice_603 | 内枠スナップを利用する設定を選んでください。 | {"enabled": true} | v02_edit_setting_use_state |
| nyamuru_voice_604 | 内枠スナップなしに設定してもらえますか。 | {"enabled": false} | v02_edit_setting_use_state |

## コマスナップのオン・オフ — `panel_gap_snap_set`

| ID | 発話本文 | slots | group |
|---|---|---|---|
| nyamuru_voice_605 | コマスナップを利用して調整したいので、オンにしてほしい。 | {"enabled": true} | v02_edit_setting_motive |
| nyamuru_voice_606 | 手動で位置を詰めたいから、コマスナップの設定を無効へ変えて。 | {"enabled": false} | v02_edit_setting_motive |
| nyamuru_voice_607 | これからのコマ編集ではコマスナップを使うので、有効に設定してください。 | {"enabled": true} | v02_edit_setting_motive |
| nyamuru_voice_608 | スナップなしで配置を試したい。コマスナップをオフにしてください。 | {"enabled": false} | v02_edit_setting_motive |
| nyamuru_voice_609 | コマスナップが切れているのを、オンへ直してもらえる？ | {"enabled": true} | v02_edit_setting_current |
| nyamuru_voice_610 | コマスナップは今チェックありなので、チェックなしに変えてほしい。 | {"enabled": false} | v02_edit_setting_current |
| nyamuru_voice_611 | 無効になっているコマスナップを、有効の状態に戻してください。 | {"enabled": true} | v02_edit_setting_current |
| nyamuru_voice_612 | コマスナップが現在オンのままです。オフを設定して。 | {"enabled": false} | v02_edit_setting_current |
| nyamuru_voice_613 | コマスナップはオフ、と言ったのを訂正します。設定はオンにして。 | {"enabled": true} | v02_edit_setting_correction |
| nyamuru_voice_614 | コマスナップを有効にする案はやめた。無効を設定してください。 | {"enabled": false} | v02_edit_setting_correction |
| nyamuru_voice_615 | コマスナップを使わないつもりだったけど、使う状態に変更してほしい。 | {"enabled": true} | v02_edit_setting_correction |
| nyamuru_voice_616 | さっきのコマスナップのオン指定は撤回して、オフに設定して。 | {"enabled": false} | v02_edit_setting_correction |
| nyamuru_voice_617 | コマシンクロを維持したまま、コマスナップの項目だけオンにしてください。 | {"enabled": true} | v02_edit_setting_other_preserve |
| nyamuru_voice_618 | 内枠スナップは変更せず、コマスナップを無効にする操作だけお願い。 | {"enabled": false} | v02_edit_setting_other_preserve |
| nyamuru_voice_619 | コマスナップを有効にしてくれる？ ほかのコマ設定には触らなくていい。 | {"enabled": true} | v02_edit_setting_other_preserve |
| nyamuru_voice_620 | コマスナップだけオフに変更して、内枠スナップとコマシンクロは現在値を保って。 | {"enabled": false} | v02_edit_setting_other_preserve |
| nyamuru_voice_621 | コマスナップという編集設定を、アプリ全体で有効にしてください。 | {"enabled": true} | v02_edit_setting_global |
| nyamuru_voice_622 | 選択コマの形は触らずに、コマスナップの設定をオフにして。 | {"enabled": false} | v02_edit_setting_global |
| nyamuru_voice_623 | コマの移動はまだ頼んでいません。設定のコマスナップをオンにしてほしい。 | {"enabled": true} | v02_edit_setting_global |
| nyamuru_voice_624 | このコマだけの話ではなく、編集用のコマスナップ設定を無効にしてください。 | {"enabled": false} | v02_edit_setting_global |
| nyamuru_voice_625 | コマスナップのチェックを付けた状態に変更してもらえますか。 | {"enabled": true} | v02_edit_setting_checkbox |
| nyamuru_voice_626 | コマスナップの項目からチェックを外す設定でお願いします。 | {"enabled": false} | v02_edit_setting_checkbox |
| nyamuru_voice_627 | 設定欄のコマスナップを、チェック入りにしてください。 | {"enabled": true} | v02_edit_setting_checkbox |
| nyamuru_voice_628 | コマスナップはチェックなしの状態へ変更して。 | {"enabled": false} | v02_edit_setting_checkbox |
| nyamuru_voice_629 | コマを編集する前の準備で、コマスナップを有効にしておいてください。 | {"enabled": true} | v02_edit_setting_before_work |
| nyamuru_voice_630 | 作業を再開する前に、コマスナップをオフへ設定しておいて。 | {"enabled": false} | v02_edit_setting_before_work |
| nyamuru_voice_631 | 先に設定を済ませたい。コマスナップをオンに変更してほしい。 | {"enabled": true} | v02_edit_setting_before_work |
| nyamuru_voice_632 | いったんコマスナップを無効にしてください。続きの編集はそのあとで自分がやる。 | {"enabled": false} | v02_edit_setting_before_work |
| nyamuru_voice_633 | コマスナップありに変えてくれる？ | {"enabled": true} | v02_edit_setting_use_state |
| nyamuru_voice_634 | コマスナップは使わない状態にしてほしい。 | {"enabled": false} | v02_edit_setting_use_state |
| nyamuru_voice_635 | コマスナップありの設定を選んでもらえますか。 | {"enabled": true} | v02_edit_setting_use_state |
| nyamuru_voice_636 | コマスナップなしで作業する設定にしてください。 | {"enabled": false} | v02_edit_setting_use_state |

## 指定対象の画像生成 — `generate_request`

| ID | 発話本文 | slots | group |
|---|---|---|---|
| nyamuru_voice_861 | この選択を対象に、画像生成を始めてほしい | {"target": "selection"} | v02_routes_gen_selection |
| nyamuru_voice_862 | 対象は今選んだものだけで、画像を生成してもらえる？ | {"target": "selection"} | v02_routes_gen_selection |
| nyamuru_voice_863 | 余計な対象は含めず、選択してあるこれを生成して | {"target": "selection"} | v02_routes_gen_selection |
| nyamuru_voice_864 | 今選択した対象の画像を一度生成してみて | {"target": "selection"} | v02_routes_gen_selection |
| nyamuru_voice_865 | 人物の選択が済んだので、この一人を生成して | {"target": "selected_character"} | v02_routes_gen_person |
| nyamuru_voice_866 | コマ全部ではなく、選択してあるキャラクターの画像だけ生成して | {"target": "selected_character"} | v02_routes_gen_person |
| nyamuru_voice_867 | 選択中の人物は配置そのままで、その人物を画像生成して | {"target": "selected_character"} | v02_routes_gen_person |
| nyamuru_voice_868 | 三コマ目で選んでいる人物だけ、生成をお願い | {"target": "selected_character", "locator": {"panel_number": 3}} | v02_routes_gen_person |
| nyamuru_voice_869 | この場面の小雪ちゃんの画像を生成してほしい | {"target": "named_character", "locator": {"character_name": "小雪ちゃん"}} | v02_routes_gen_named |
| nyamuru_voice_870 | コマ二にいるミナちゃんだけを生成対象にして、画像生成を始めて | {"target": "named_character", "locator": {"panel_number": 2, "character_name": "ミナちゃん"}} | v02_routes_gen_named |
| nyamuru_voice_871 | 四コマ目の蓮くんについて、人物の画像を生成して | {"target": "named_character", "locator": {"panel_number": 4, "character_name": "蓮くん"}} | v02_routes_gen_named |
| nyamuru_voice_872 | 背景は触らず、あかりちゃんの生成だけお願いできる？ | {"target": "named_character", "locator": {"character_name": "あかりちゃん"}} | v02_routes_gen_named |
| nyamuru_voice_873 | キャラだけではなく、今選んだコマを丸ごと画像生成して | {"target": "selected_panel"} | v02_routes_gen_panel |
| nyamuru_voice_874 | 選択したコマの全体を生成対象にして実行して | {"target": "selected_panel"} | v02_routes_gen_panel |
| nyamuru_voice_875 | ページのほかのコマはそのままで、選んであるこのコマを生成して | {"target": "selected_panel"} | v02_routes_gen_panel |
| nyamuru_voice_876 | このコマの画像が必要だから、コマ全体の生成をお願い | {"target": "selected_panel"} | v02_routes_gen_panel |
| nyamuru_voice_877 | 二コマ目を丸ごと一枚の画像として生成して | {"target": "specified_panel", "locator": {"panel_number": 2}} | v02_routes_gen_numbered |
| nyamuru_voice_878 | ページは移動せず、コマ四だけ画像生成してほしい | {"target": "specified_panel", "locator": {"panel_number": 4}} | v02_routes_gen_numbered |
| nyamuru_voice_879 | 生成するのは六コマ目全体でお願い | {"target": "specified_panel", "locator": {"panel_number": 6}} | v02_routes_gen_numbered |
| nyamuru_voice_880 | 一コマ目はそのまま、三コマ目全体の画像生成を始めて | {"target": "specified_panel", "locator": {"panel_number": 3}} | v02_routes_gen_numbered |
| nyamuru_voice_881 | 作品全部ではなく、いま開いている一ページ全体を生成して | {"target": "current_page"} | v02_routes_generation_scope |
| nyamuru_voice_882 | コマごとの指定じゃなく、現在のページを丸ごと画像生成してほしい | {"target": "current_page"} | v02_routes_generation_scope |
| nyamuru_voice_883 | 次のページには進まず、表示中の一ページの生成を始めて | {"target": "current_page"} | v02_routes_generation_scope |
| nyamuru_voice_884 | このページ全体の画像が欲しいので、いま生成を実行して | {"target": "current_page"} | v02_routes_generation_scope |
| nyamuru_voice_885 | ページ全体を生成して、いや、選択中の人物だけ生成して | {"target": "selected_character"} | v02_routes_gen_correction |
| nyamuru_voice_886 | 小雪ちゃんを生成して、じゃなくて、ミナちゃんだけ生成して | {"target": "named_character", "locator": {"character_name": "ミナちゃん"}} | v02_routes_gen_correction |
| nyamuru_voice_887 | 二コマ目を生成してと言ったけど訂正、三コマ目全体でお願い | {"target": "specified_panel", "locator": {"panel_number": 3}} | v02_routes_gen_correction |
| nyamuru_voice_888 | 全ページと言ったのは取り消しで、いまの一ページだけ生成して | {"target": "current_page"} | v02_routes_gen_correction |
| nyamuru_voice_889 | 台本の修正は済んだよ。ここで選択しているコマ全体を生成して | {"target": "selected_panel"} | v02_routes_gen_work_context |
| nyamuru_voice_890 | 「生成しないで」はセリフの文面の話ね。今の選択対象は生成して | {"target": "selection"} | v02_routes_gen_work_context |
| nyamuru_voice_891 | 人物設定を見直したので、コマ五の小雪ちゃんを画像生成してほしい | {"target": "named_character", "locator": {"panel_number": 5, "character_name": "小雪ちゃん"}} | v02_routes_gen_work_context |
| nyamuru_voice_892 | 保存は自分でやるから、今は選択中の人物の画像生成だけお願い | {"target": "selected_character"} | v02_routes_gen_work_context |

## 登録済み3D背景の候補提示 — `background_3d_candidates`

| ID | 発話本文 | slots | group |
|---|---|---|---|
| nyamuru_voice_893 | 登録してある3Dモデルの中で、背景に使う候補を挙げてほしい | {"source": "registered_3d_models"} | v02_routes_bg_generic |
| nyamuru_voice_894 | 手持ちとして登録済みの3D背景から、候補を提案してもらえる？ | {"source": "registered_3d_models"} | v02_routes_bg_generic |
| nyamuru_voice_895 | 次に背景を決めたいので、登録済みモデルの候補を見せて | {"source": "registered_3d_models"} | v02_routes_bg_generic |
| nyamuru_voice_896 | 背景候補、いま出してもらえる？ | {"source": "registered_3d_models"} | v02_routes_bg_generic |
| nyamuru_voice_897 | 放課後の教室に合う、登録済み3D背景の候補を出して | {"source": "registered_3d_models", "query": "放課後の教室"} | v02_routes_bg_scene |
| nyamuru_voice_898 | 雨の駅前という場面に使える3Dモデルを、登録済みから候補にして | {"source": "registered_3d_models", "query": "雨の駅前"} | v02_routes_bg_scene |
| nyamuru_voice_899 | 家族が食事する台所の背景に合う候補を、登録モデルから選んで | {"source": "registered_3d_models", "query": "家族が食事する台所"} | v02_routes_bg_scene |
| nyamuru_voice_900 | 夜の路地で立ち話する場面向けに、登録済みの3D背景候補を見せて | {"source": "registered_3d_models", "query": "夜の路地で立ち話する場面"} | v02_routes_bg_scene |
| nyamuru_voice_901 | 登録した3Dモデルから、病院の背景候補を探してほしい | {"source": "registered_3d_models", "query": "病院"} | v02_routes_bg_category |
| nyamuru_voice_902 | 図書館を背景にしたいので、使える登録済み3Dモデルを候補として出して | {"source": "registered_3d_models", "query": "図書館"} | v02_routes_bg_category |
| nyamuru_voice_903 | 学校の廊下に使えそうな登録済み3D背景を候補に挙げて | {"source": "registered_3d_models", "query": "学校の廊下"} | v02_routes_bg_category |
| nyamuru_voice_904 | カフェの背景候補がほしい。登録してある3Dモデルから提案して | {"source": "registered_3d_models", "query": "カフェ"} | v02_routes_bg_category |
| nyamuru_voice_905 | 登録済み3Dモデルから、背景に使えるものを四つ候補に出して | {"source": "registered_3d_models", "count": 4} | v02_routes_bg_count |
| nyamuru_voice_906 | 比較したいので、登録済みの3D背景候補を二つ見せてほしい | {"source": "registered_3d_models", "count": 2} | v02_routes_bg_count |
| nyamuru_voice_907 | 背景候補は一つでいいから、この場面に合う登録モデルを提案して | {"source": "registered_3d_models", "count": 1} | v02_routes_bg_count |
| nyamuru_voice_908 | 登録済み3Dモデルの中から、屋上の背景候補を三つ挙げて | {"source": "registered_3d_models", "count": 3, "query": "屋上"} | v02_routes_bg_count |
| nyamuru_voice_909 | 二コマ目で使う背景候補を登録済みモデルから出して | {"source": "registered_3d_models", "locator": {"panel_number": 2}} | v02_routes_bg_locator |
| nyamuru_voice_910 | 四コマ目の背景を検討したいので、3Dモデルの候補を見せて | {"source": "registered_3d_models", "locator": {"panel_number": 4}} | v02_routes_bg_locator |
| nyamuru_voice_911 | コマ六の背景候補を二つ、登録済みから提案して | {"source": "registered_3d_models", "locator": {"panel_number": 6}, "count": 2} | v02_routes_bg_locator |
| nyamuru_voice_912 | 一コマ目に使う教室の3D背景候補を出してほしい | {"source": "registered_3d_models", "locator": {"panel_number": 1}, "query": "教室"} | v02_routes_bg_locator |
| nyamuru_voice_913 | このコマの台本を読んで、合いそうな登録済み3D背景を候補に挙げて | {"source": "registered_3d_models"} | v02_routes_bg_context |
| nyamuru_voice_914 | 人物設定にある住まいを参考に、登録モデルから背景候補を選んで | {"source": "registered_3d_models"} | v02_routes_bg_context |
| nyamuru_voice_915 | 今のページの場面設定に照らして、登録済み3D背景の候補を提案して | {"source": "registered_3d_models"} | v02_routes_bg_context |
| nyamuru_voice_916 | 選択中のコマの雰囲気に合うか考えて、登録済み3Dモデルから背景候補を出して | {"source": "registered_3d_models"} | v02_routes_bg_context |
| nyamuru_voice_917 | 自動配置はせず、登録済み3D背景の候補を比較用に見せて | {"source": "registered_3d_models"} | v02_routes_bg_boundaries |
| nyamuru_voice_918 | 新しくモデルを作らず、登録してある3Dモデルから背景候補だけお願い | {"source": "registered_3d_models"} | v02_routes_bg_boundaries |
| nyamuru_voice_919 | カメラの案ではなく、背景に使う登録済み3Dモデル自体を候補に挙げて | {"source": "registered_3d_models"} | v02_routes_bg_boundaries |
| nyamuru_voice_920 | ネットで探す必要はないから、登録済み3D背景の候補を出して | {"source": "registered_3d_models"} | v02_routes_bg_boundaries |
| nyamuru_voice_921 | 背景候補を五つ、いや二つでお願い。登録済みモデルから選んで | {"source": "registered_3d_models", "count": 2} | v02_routes_bg_correction |
| nyamuru_voice_922 | 教室の候補じゃなくて、体育館に使える登録済み3D背景候補を見せて | {"source": "registered_3d_models", "query": "体育館"} | v02_routes_bg_correction |
| nyamuru_voice_923 | コマ二と言ったけど訂正、コマ四の背景候補を出して | {"source": "registered_3d_models", "locator": {"panel_number": 4}} | v02_routes_bg_correction |
| nyamuru_voice_924 | 背景を作って、ではなく登録済みの3D背景候補を提示してほしい | {"source": "registered_3d_models"} | v02_routes_bg_correction |

## 描画ペンの切替 — `paint_tool_set`

| ID | 発話本文 | slots | group |
|---|---|---|---|
| nyamuru_voice_637 | 手描きの線画に使いたいので、描画ツールをラスターペンへ変えて。 | {"tool": "pen"} | v02_edit_paint_motive |
| nyamuru_voice_638 | ベジェで線を扱いたいから、いまのツールをベクターペンにしてほしい。 | {"tool": "vector-pen"} | v02_edit_paint_motive |
| nyamuru_voice_639 | ラスターペンで作業する準備として、そのペンを選択してください。 | {"tool": "pen"} | v02_edit_paint_motive |
| nyamuru_voice_640 | これからの線作業にはベクターペンを使うので、ツールをそれに切り替えて。 | {"tool": "vector-pen"} | v02_edit_paint_motive |
| nyamuru_voice_641 | 次の一本を描くために、まずラスターペンを選んでおいて。 | {"tool": "pen"} | v02_edit_paint_next_stroke |
| nyamuru_voice_642 | 次に使う道具だけ準備して。ベジェペンに設定をお願いします。 | {"tool": "vector-pen"} | v02_edit_paint_next_stroke |
| nyamuru_voice_643 | 描き始める前の準備です。使用するペンをラスターに切り替えてください。 | {"tool": "pen"} | v02_edit_paint_next_stroke |
| nyamuru_voice_644 | 次のストロークは自分で描くので、ベクターペンの選択だけお願い。 | {"tool": "vector-pen"} | v02_edit_paint_next_stroke |
| nyamuru_voice_645 | ベジェペンが選ばれているけど、ラスターペンへ切り替えてほしい。 | {"tool": "pen"} | v02_edit_paint_current |
| nyamuru_voice_646 | いまラスターペンなので、使うツールをベクターペンへ変更して。 | {"tool": "vector-pen"} | v02_edit_paint_current |
| nyamuru_voice_647 | 現在のペンはベクターになっているね。ラスター用のペンを選択して。 | {"tool": "pen"} | v02_edit_paint_current |
| nyamuru_voice_648 | ラスターペンから、ベジェペンの選択状態へ変えてください。 | {"tool": "vector-pen"} | v02_edit_paint_current |
| nyamuru_voice_649 | ベクターペンを選ぶと言ったけど訂正。ラスターペンにしてください。 | {"tool": "pen"} | v02_edit_paint_correction |
| nyamuru_voice_650 | ラスターペンはやめます。ベクターペンのほうを選択して。 | {"tool": "vector-pen"} | v02_edit_paint_correction |
| nyamuru_voice_651 | ベジェペンで、いや違った。使う道具はラスターペンに切り替えて。 | {"tool": "pen"} | v02_edit_paint_correction |
| nyamuru_voice_652 | さっき頼んだラスターへの切替は取り消して、ベジェペンを指定して。 | {"tool": "vector-pen"} | v02_edit_paint_correction |
| nyamuru_voice_653 | 描いてある線はそのままで、使用中のツールだけラスターペンに変えて。 | {"tool": "pen"} | v02_edit_paint_preserve |
| nyamuru_voice_654 | 画像やレイヤーは変更せず、ペンの選択だけベクターペンへ切り替えて。 | {"tool": "vector-pen"} | v02_edit_paint_preserve |
| nyamuru_voice_655 | 線を変換する依頼ではありません。ラスターペンを選ぶ操作をお願いします。 | {"tool": "pen"} | v02_edit_paint_preserve |
| nyamuru_voice_656 | 既存の絵をベクター化せず、これから使う道具をベジェペンにして。 | {"tool": "vector-pen"} | v02_edit_paint_preserve |
| nyamuru_voice_657 | ベクターペンでの作業は終えたので、ラスターペンの選択に戻してほしい。 | {"tool": "pen"} | v02_edit_paint_return |
| nyamuru_voice_658 | ラスターペンを試すのは終わり。ベクターペンへ道具を戻して。 | {"tool": "vector-pen"} | v02_edit_paint_return |
| nyamuru_voice_659 | 前に使っていたラスターペンへ、選択ツールを戻してください。 | {"tool": "pen"} | v02_edit_paint_return |
| nyamuru_voice_660 | 作業を再開するから、使用ペンをもう一度ベジェペンに設定して。 | {"tool": "vector-pen"} | v02_edit_paint_return |
| nyamuru_voice_661 | 描画ツール欄のラスターペンを、選択中の道具にしてください。 | {"tool": "pen"} | v02_edit_paint_ui |
| nyamuru_voice_662 | ペンの選択欄で、ベクターペンの項目へ移してほしい。 | {"tool": "vector-pen"} | v02_edit_paint_ui |
| nyamuru_voice_663 | ツールの選択先にはラスターペンを指定しておきます。切り替えて。 | {"tool": "pen"} | v02_edit_paint_ui |
| nyamuru_voice_664 | 描画ツール欄ではベジェペンを選択状態にして。 | {"tool": "vector-pen"} | v02_edit_paint_ui |
| nyamuru_voice_665 | すみません、今使うペンをラスターペンに変更してもらえますか。 | {"tool": "pen"} | v02_edit_paint_request |
| nyamuru_voice_666 | 使うのはベクターペンにしたいです。ツールを切り替えてください。 | {"tool": "vector-pen"} | v02_edit_paint_request |
| nyamuru_voice_667 | 選択ツールをラスターペンへ変更する操作をお願いできますか。 | {"tool": "pen"} | v02_edit_paint_request |
| nyamuru_voice_668 | ベジェペンを使うので、そのペンへの切替をお願いします。 | {"tool": "vector-pen"} | v02_edit_paint_request |

## 複数文字枠の上端揃え — `text_frames_align`

| ID | 発話本文 | slots | group |
|---|---|---|---|
| nyamuru_voice_669 | いま二つ選んだ文字枠を、上端が同じ高さになるようにそろえて。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} | v02_edit_align_selected |
| nyamuru_voice_670 | この選択中の二つの文字枠、上側の端を合わせてください。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} | v02_edit_align_selected |
| nyamuru_voice_671 | ペアで選んである文字枠の頭の位置を、上揃えに変更して。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} | v02_edit_align_selected |
| nyamuru_voice_672 | 二つの文字枠を選択済みです。その二つだけ上端揃えを実行して。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} | v02_edit_align_selected |
| nyamuru_voice_673 | 選択した三つの文字枠の上端を、同じ高さへ合わせてほしい。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} | v02_edit_align_selected |
| nyamuru_voice_674 | 四つまとめて選んだ文字枠は、上揃えで整列してください。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} | v02_edit_align_selected |
| nyamuru_voice_675 | 今選択してある複数の文字枠を、上端基準でそろえてもらえますか。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} | v02_edit_align_selected |
| nyamuru_voice_676 | この五つの選択中の文字枠について、頭の高さをそろえる操作をお願い。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} | v02_edit_align_selected |
| nyamuru_voice_677 | 別々の吹き出しから選んだ文字枠の、上端同士を合わせて。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} | v02_edit_align_bubbles |
| nyamuru_voice_678 | 並んだ吹き出しの文字枠を複数選んであるので、その書き出しの上端をそろえて。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} | v02_edit_align_bubbles |
| nyamuru_voice_679 | この三つの吹き出し内で選択した文字枠を、頭が同じ高さになるよう上揃えにして。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} | v02_edit_align_bubbles |
| nyamuru_voice_680 | 異なる吹き出しに入っている、選択中の二つの文字枠を上端で整列してほしい。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} | v02_edit_align_bubbles |
| nyamuru_voice_681 | スキャンから取り込んで選択した複数の文字枠を、上端だけそろえて。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} | v02_edit_align_scan |
| nyamuru_voice_682 | 取り込み済みの文字枠を二つ選んだよ。この選択の頭の高さを合わせてください。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} | v02_edit_align_scan |
| nyamuru_voice_683 | OCRのあと選んでおいた三つの文字枠を、上端揃えにしてほしい。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} | v02_edit_align_scan |
| nyamuru_voice_684 | 原稿から取り込んだ文字枠のうち、いま複数選択している分を上揃えにしてください。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} | v02_edit_align_scan |
| nyamuru_voice_685 | 選択中の二つの文字枠は始まりの高さがずれているから、上端をそろえて。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} | v02_edit_align_uneven |
| nyamuru_voice_686 | 三つの文字枠の頭がばらばらなので、選択したその三つを上揃えに変更して。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} | v02_edit_align_uneven |
| nyamuru_voice_687 | 左右に並んだ文字枠の上端が合っていない。選択中の二つを上端で合わせてください。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} | v02_edit_align_uneven |
| nyamuru_voice_688 | この複数選択した文字枠は上側が段違いだから、頭を同じ高さにそろえてほしい。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} | v02_edit_align_uneven |
| nyamuru_voice_689 | 吹き出しの輪郭を動かさず、選択した複数の文字枠だけ上端をそろえて。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} | v02_edit_align_preserve |
| nyamuru_voice_690 | 本文は書き換えずに、この選択中の三つの文字枠を上揃えにしてください。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} | v02_edit_align_preserve |
| nyamuru_voice_691 | 横位置と大きさを保って、選んである二つの文字枠の上端を合わせて。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} | v02_edit_align_preserve |
| nyamuru_voice_692 | 画像と吹き出しの形はそのまま、複数選択している文字枠の頭だけそろえてほしい。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} | v02_edit_align_preserve |
| nyamuru_voice_693 | 一コマ目で二つ選択した文字枠を、上端がそろうように整列して。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds", "locator": {"panel_number": 1}} | v02_edit_align_panel |
| nyamuru_voice_694 | 今のページの二コマ目にある選択中の複数文字枠を、上揃えにしてください。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds", "locator": {"panel_number": 2}} | v02_edit_align_panel |
| nyamuru_voice_695 | 四コマ目の選択した三つの文字枠について、頭の高さをそろえて。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds", "locator": {"panel_number": 4}} | v02_edit_align_panel |
| nyamuru_voice_696 | 六コマ目で複数選択してある文字枠を、上端を基準に合わせてほしい。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds", "locator": {"panel_number": 6}} | v02_edit_align_panel |
| nyamuru_voice_697 | 選択中の文字枠は下揃え、ではなく上端揃えにしてください。複数選んであります。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} | v02_edit_align_correction |
| nyamuru_voice_698 | 文字枠を中央でそろえる話は訂正して、選択した二つを上端で合わせて。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} | v02_edit_align_correction |
| nyamuru_voice_699 | 輪郭をそろえるのではなく、選択中の複数文字枠の上端をそろえてほしい。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} | v02_edit_align_correction |
| nyamuru_voice_700 | 各行の頭をそろえるという意味ではなく、いま選択した複数の文字枠を上揃えにして。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} | v02_edit_align_correction |
