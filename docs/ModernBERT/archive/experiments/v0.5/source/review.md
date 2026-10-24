# ニャムル 音声操作の分類ラベルと学習候補

2026-10-17。**利用者レビュー前の草案。19ラベル・316件。学習・モデル推論・音声認識・実行接続は未実施。**

対象は保存、戻す・やり直す、ページ移動、表示切替、作画方式切替、既存吹き出しの指定変更、コマシンクロ・内枠スナップ・コマスナップのオン・オフ、対象を指定した画像生成、登録済み3D背景の候補提示、ラスターペン・ベクターペン切替、複数文字枠の上端揃え。BERTは操作種別を分類し、コマ番号・人名・対象・値は別処理で解決する。既存処理を再利用し、実行入口が未接続の機能は明記する。

## 分類ラベル

| ID | ラベル | 意味 | 件数 |
|---|---|---|---:|
| 0 | `save` | 保存 | 10 |
| 1 | `undo` | 戻す | 10 |
| 2 | `redo` | やり直す | 10 |
| 3 | `page_navigate` | ページ移動 | 16 |
| 4 | `view_change` | 表示切替 | 20 |
| 5 | `artwork_mode_set` | 作画方式切替 | 10 |
| 6 | `bubble_set` | 吹き出しの指定変更 | 29 |
| 7 | `needs_clarification` | 意味・指定が不足 | 20 |
| 8 | `needs_reasoning` | LLMによる内容判断 | 10 |
| 9 | `compound_request` | 複数操作 | 17 |
| 10 | `out_of_scope_request` | 初期範囲外の依頼 | 13 |
| 11 | `not_command` | 今回の実行依頼ではない | 46 |
| 12 | `panel_sync_set` | コマシンクロのオン・オフ | 12 |
| 13 | `inner_frame_snap_set` | 内枠スナップのオン・オフ | 12 |
| 14 | `panel_gap_snap_set` | コマスナップのオン・オフ | 12 |
| 15 | `generate_request` | 指定対象の画像生成 | 33 |
| 16 | `background_3d_candidates` | 登録済み3D背景の候補提示 | 16 |
| 17 | `paint_tool_set` | 描画ペンの切替 | 12 |
| 18 | `text_frames_align` | 複数文字枠の上端揃え | 8 |

## 学習入力と引数の区別

- BERTの入力は `text`、正解は `label`。`slots`、`note`、`group`は入力へ混ぜない。
- `slots`は引数解決を確認するための正解注釈。分類器がJSONや座標を生成する設計ではない。
- この版の分類入力は単独発話。前の会話が必要な「もう一度」「さっきと同じ」は保留する。
- 「この吹き出し」のような参照は、現在の選択対象で解決する。未選択なら操作を発行しない。
- 自由な口述入力と操作モードは区別する。セリフ本文の「保存して」を保存命令として実行しない。

例：**「3ページに移動して」→ `page_navigate` ＋ ページ番号3**。番号を分類ラベルにはしない。

## 境界の決め方

| 発話 | 分類 | 理由 |
|---|---|---|
| 保存してくれる？ | `save` | 疑問形の実行依頼 |
| この作品は保存済み？ | `not_command` | 状態の質問。追加保存はしない |
| 保存して、いや、まだ保存しないで | `not_command` | 訂正で依頼を撤回 |
| 紙面全体を表示して | `view_change` | 表示倍率の変更 |
| 全体を一体生成する設定に切り替えて | `artwork_mode_set` | 設定変更だけ |
| 全ページを一体生成して | `out_of_scope_request` | 全ページ一括生成は今回の対象外 |
| 部分生成にして | `needs_clarification` | 下書き方式・対象選択・部分修正を区別できない |
| この吹き出しを四角にして | `bubble_set` | 値が指定済み |
| このセリフに合う吹き出しの素材を選んで | `needs_reasoning` | 内容に応じた判断が必要 |
| 保存してから次のページに進んで | `compound_request` | 独立した二操作 |
| この吹き出しに「保存して、次のページへ」と入れて | `bubble_set` | 引用全体が本文 |
| コマシンクロをオンにして | `panel_sync_set` | enabled=true。すでにオンなら変更なし |
| 内枠スナップをオフにして | `inner_frame_snap_set` | enabled=false。コマスナップは変更しない |
| コマスナップを使わない設定にして | `panel_gap_snap_set` | オフ値を設定する依頼 |
| コマスナップをオンにしないで | `not_command` | 現在値を保持。勝手にオフにしない |
| これ生成 | `generate_request` | 現在の選択対象。未選択なら確認 |
| このキャラクターだけ生成 | `generate_request` | 選択中の人物の配置一つだけ |
| ページ全体を生成 | `generate_request` | 現在の一ページ全体。全ページではない |
| このコマだけ生成 | `generate_request` | 選択中のコマ全体。背景だけではない |
| 3D背景候補出して | `background_3d_candidates` | 登録済みモデルから候補提示。配置はしない |
| コマ3の小雪ちゃんだけ生成して | `generate_request` | コマ番号3と名前を別の引数として解決 |
| コマ1の背景候補を見せて | `background_3d_candidates` | 現在ページのコマ1を対象に登録済み3D候補 |
| ラスターペンに変えて | `paint_tool_set` | 既存のpenツールを選択 |
| ベクターペンに変えて | `paint_tool_set` | 既存のvector-pen（ベジェペン）を選択 |
| 選択中の文字の頭をそろえて | `text_frames_align` | 複数の文字枠の上端を揃える。前提改修が必要 |

## 初期範囲と既存処理

| 操作 | 接続する既存処理 | 守る意味 |
|---|---|---|
| 保存 | `App.saveProject` / `Header.onSave` | 描画途中の反映、作品保存、競合確認を共有 |
| 戻す・やり直す | `App.undo/redo` / Headerの描画履歴切替 | 編集履歴を扱う。生成やページ移動へ読み替えない |
| ページ移動 | `PageSidebar.onSelectPage` / ページ切替 | コマ選択の更新なども既存動作にそろえる |
| 表示 | Canvasのzoom、EnvironmentSettings、`changeTab` | 図形の寸法や作画方式を変えない |
| 作画方式 | `ArtworkSettings.update` → `applyArtworkSettings` | integrated/draftの設定のみ。生成・外部送信を開始しない |
| 吹き出し | PanelInspector / PageOverlayInspector / Canvasの既存変更処理 | 原文・既存ID・履歴・コマ所属の制約を共有 |
| コマシンクロ | `PanelControls.onTogglePanelSync` → `App.togglePanelSync` | 希望値と現在値が異なる場合だけ既存処理を呼ぶ |
| 内枠スナップ | `PanelControls.onToggleInnerFrameSnap` → `App.toggleInnerFrameSnap` | コマシンクロ・コマスナップとは別の設定 |
| コマスナップ | `PanelControls.onTogglePanelGapSnap` → `App.togglePanelGapSnap` | 内枠スナップとは別の設定 |
| 個別の画像生成 | `App.requestOwnerGeneration` → `QwenGenerationDialog.generate` | 準備画面を開く処理と実生成は別。選択対象を先に解決 |
| ページ・コマ全体の画像生成 | 通常UIからの実行接続は未完了 | 全体を背景だけの生成で代用しない。別CLIや休止中モデルを自動起動しない |
| 3D背景候補 | `BackgroundModelPicker` 等の登録済み `background_stages` | 登録済み一覧を再利用。LLMによる候補選定・提示の接続は未実装 |
| 描画ペン | `PaintEditor.selectTool` / `PaintPenTools` | pen / vector-penへ切替。描画済みの絵の形式を変換しない |
| 複数文字枠の頭揃え | 現在のニャムルには専用の実行入口なし | 文字枠の独立化・複数選択が必須。パス整列で代用しない |

匿名のボタン処理は、音声からも呼べる共通関数へ取り出す必要がある。ボタンの座標クリックや保存済みファイルの別経路編集で代用しない。

コマ設定3種は、選択コマだけへの指定ではなくアプリの編集設定。同じ「オン」指示を繰り返してもオフへ反転させない。既存の状態変更と設定保存を共有し、設定変更そのものでコマを移動・変形しない。希望値が不明な「設定を変えて」は保留する。

**生成と候補提示の接続状況。** 人物などの個別生成には既存UI処理があるが、音声接続はまだない。ページ全体生成の別CLIと、現在UIから無効化されているコマ用Animagineラフ生成を、音声ラベルの追加だけで有効化した扱いにはしない。作画方式の設定変更、生成開始、結果の原稿への挿入は別の操作。

「3D背景候補出して」の意味は利用者に確認済みで、登録済み3Dモデルから背景候補を選ぶこと。BERTが依頼種別を分類し、LLMが現在の場面と登録済みモデルの情報から候補を選ぶ。候補提示の入口は要実装。モデルの取り込みやコマへの配置は行わず、候補不足時にも存在しないモデルを補わない。

## コマ番号・キャラクター名の指定

- 「コマ3の〜」「コマ1の〜」は、現在ページの画面に表示されるコマ番号へ照合する。配列の3番目と決め打ちしない。
- 「〇〇ちゃんだけ生成」の〇〇は名前の差し込み位置。データでは架空名で具体例を作り、敬称を含む原文を引数として保持する。実際の人物台帳と指定コマ内の配置へ一意に照合する。
- 「小雪ちゃんだけ」は指定・現在のコマの人物配置一つだけ。名前が同じ全登場箇所へ広げない。人物がいない、複数いる、選択が指定コマと食い違う場合は確認する。
- 「背景候補」は、この音声操作では登録済み3Dモデルからの候補提示の略として扱う。

## 必須改善：スキャン取込と文字枠の独立化

利用者の「文字の頭をそろえる」は、複数の吹き出しが並ぶときに、選択した複数の文字枠の上端を揃える意味。段落の各行の揃えではない。

現在のスキャン取込は、OCRの文字領域を `Bubble.bbox` に入れ、本文と原字参照を一つのBubbleへ保持する。原字参照はあるが、輪郭と別に動かせる文字枠はない。表示も吹き出し由来の領域へ文字を中央配置するため、既存のBBox変更だけでは文字だけの整列にならない。

VectorCraftには `object.align` があり、ニャムルにもベクターパスの `alignVectors` がある。ただし、VectorCraftの文字オブジェクト整列がニャムルへ移植済みとは確認できていない。

必要な改修は次のとおり。今回は要件の記録までで、取込・データ構造・描画の実装変更はしていない。

1. 吹き出し輪郭、文字本文と独立した文字枠、スキャンの原字参照、輪郭と文字の対応を分けて保持する。文字領域を検出済みの吹き出し輪郭と同一視しない。
2. 複数の文字枠を選択できるようにし、選択した文字だけの上端を揃える。初期案では選択範囲の上端を基準とし、幅・高さ・横位置・本文・輪郭を保持する。
3. 所属コマ、表示、切取り、Undo/Redo、保存・再読込へつなぐ。既存OCRの本文と元画像を保持し、OCRモデルの変更はこの要件に含めない。

**切取りは検証待ち。** `clip_to_panel`は現在作業中の変更なので、候補データには含めるが、画面検証前に実行を有効化しない。未制作の思考雲・ウニフラッシュ素材としっぽ形状変更は対象外。

## データの扱い

- 利用者が提示した発話例をそのまま収録したものが8件、Codex作成の合成例が308件。どちらもラベル・引数の利用者レビューは未完了。実際の音声認識結果や運用ログとは扱わない。
- この316件は初期レビュー用であり、実運用を十分に網羅する完成データではない。学習用・検証用・テスト用へまだ分割していない。
- `group`は言い換え・対照例をまとめる分割候補。近い例を別splitへ散らして評価を水増ししないための補助で、全ての近似を保証するものではない。分割前に再点検する。
- ラベルIDも草案。学習前にラベル定義と文面を確認する。既存の別用途の分類器・採用モデル・ラベルは変更しない。
- 次の収集では実際の音声認識出力、自然な言い直し、相談と依頼の曖昧例、選択なし・候補複数を別途評価する。

## 全316件の確認表

### 保存 `save`

現在の作品を既存の保存操作で保存する依頼。

境界：保存先変更、別名保存、保存済みかの質問、保存方法の質問は含めない。

| ID | 発話原文 | 引数の正解注釈 | 注記 |
|---|---|---|---|
| nyamuru_voice_001 | 保存して | {"target":"current_document"} |  |
| nyamuru_voice_002 | 今の作品を保存してください | {"target":"current_document"} |  |
| nyamuru_voice_003 | セーブお願い | {"target":"current_document"} |  |
| nyamuru_voice_004 | この編集を保存しておいて | {"target":"current_document"} |  |
| nyamuru_voice_005 | いまの状態で保存 | {"target":"current_document"} |  |
| nyamuru_voice_006 | ニャムル、保存してくれる？ | {"target":"current_document"} | 疑問形だが保存の実行依頼。 |
| nyamuru_voice_007 | 保存ボタンを押したときと同じ保存をして | {"target":"current_document"} |  |
| nyamuru_voice_008 | いったん作品を保存しといて | {"target":"current_document"} |  |
| nyamuru_voice_009 | まだ保存してないから保存して | {"target":"current_document"} | 前半の未保存報告だけでnot_commandにしない。 |
| nyamuru_voice_010 | 保存しないで、いや、やっぱり今保存して | {"target":"current_document"} | 同一発話の明示的な訂正後の依頼を採る。 |

### 戻す `undo`

直前までに完了した編集を履歴で取り消す依頼。

境界：ページを前へ移動する依頼、実行中のジョブの中止、対象不明の「戻して」は含めない。

| ID | 発話原文 | 引数の正解注釈 | 注記 |
|---|---|---|---|
| nyamuru_voice_011 | 直前の編集を戻して | {"count":1} |  |
| nyamuru_voice_012 | アンドゥして | {"count":1} |  |
| nyamuru_voice_013 | 今動かした吹き出しの編集を一つ取り消して | {"count":1} | 直前の履歴1件を対象とする。吹き出しを検索して過去の任意編集を消す意味ではない。 |
| nyamuru_voice_014 | ひとつ前の編集状態に戻して | {"count":1} |  |
| nyamuru_voice_015 | 元に戻すボタンを一回実行して | {"count":1} |  |
| nyamuru_voice_016 | 今の操作をUndoで取り消してください | {"count":1} |  |
| nyamuru_voice_017 | さっきの編集、アンドゥお願い | {"count":1} |  |
| nyamuru_voice_018 | 編集を二回分アンドゥして | {"count":2} | 同じ操作の回数。compound_requestにしない。 |
| nyamuru_voice_019 | 今の編集を元に戻してくれる？ | {"count":1} |  |
| nyamuru_voice_020 | ページを戻すんじゃなくて、直前の編集を取り消して | {"count":1} | 否定されたページ移動は実行しない。 |

### やり直す `redo`

Undoで取り消した編集を履歴から再適用する依頼。

境界：新しく生成し直す依頼や、何を繰り返すか不明の「もう一度」は含めない。

| ID | 発話原文 | 引数の正解注釈 | 注記 |
|---|---|---|---|
| nyamuru_voice_021 | リドゥして | {"count":1} |  |
| nyamuru_voice_022 | 今アンドゥした編集をやり直して | {"count":1} |  |
| nyamuru_voice_023 | 取り消した直前の編集を復活させて | {"count":1} |  |
| nyamuru_voice_024 | やり直すボタンを一回実行して | {"count":1} |  |
| nyamuru_voice_025 | Undoで戻す前の状態に一段進めて | {"count":1} |  |
| nyamuru_voice_026 | 編集履歴を二回リドゥして | {"count":2} |  |
| nyamuru_voice_027 | 直前の取り消しを戻してください | {"count":1} |  |
| nyamuru_voice_028 | リドゥをお願いします | {"count":1} |  |
| nyamuru_voice_029 | いま取り消した変更をもう一度適用して | {"count":1} |  |
| nyamuru_voice_030 | 生成し直すのではなく、さっきのUndoをリドゥして | {"count":1} | 再生成は依頼されていない。 |

### ページ移動 `page_navigate`

前後、番号、先頭・末尾で作品内の表示ページを指定する依頼。

境界：ページの追加・削除・並べ替え、コマ選択、Undoは含めない。

| ID | 発話原文 | 引数の正解注釈 | 注記 |
|---|---|---|---|
| nyamuru_voice_031 | 次のページへ | {"direction":"next","count":1} |  |
| nyamuru_voice_032 | 一ページ先を表示して | {"direction":"next","count":1} |  |
| nyamuru_voice_033 | ページを一枚進めてくれる？ | {"direction":"next","count":1} |  |
| nyamuru_voice_034 | 前のページに戻って | {"direction":"previous","count":1} |  |
| nyamuru_voice_035 | ひとつ前のページを見せて | {"direction":"previous","count":1} |  |
| nyamuru_voice_036 | ページを一枚戻して | {"direction":"previous","count":1} |  |
| nyamuru_voice_037 | 3ページに移動して | {"page_number":3} | 番号は利用者向けの1始まり。 |
| nyamuru_voice_038 | 十二ページを開いて | {"page_number":12} |  |
| nyamuru_voice_039 | ページ五を表示 | {"page_number":5} |  |
| nyamuru_voice_040 | 2ページ目を見たいからそこを表示して | {"page_number":2} |  |
| nyamuru_voice_041 | 最初のページにして | {"position":"first"} |  |
| nyamuru_voice_042 | 最後のページを表示して | {"position":"last"} |  |
| nyamuru_voice_043 | 三ページ先へ進んで | {"direction":"next","count":3} |  |
| nyamuru_voice_044 | 二ページ前に戻って | {"direction":"previous","count":2} |  |
| nyamuru_voice_045 | 保存はしないで次のページを表示して | {"direction":"next","count":1,"constraints":["do_not_save"]} | 肯定された操作はページ移動のみ。保存の語があってもsaveではない。 |
| nyamuru_voice_046 | 編集を取り消すんじゃなくて前のページに戻って | {"direction":"previous","count":1} |  |

### 表示切替 `view_change`

ズーム、見開き、表示ガイド、既存タブを指定する依頼。

境界：図形の大きさ・座標、作画方式、コマシンクロ、内枠スナップ、コマスナップ、ファイル保存は含めない。ガイド対象のない「ガイド」は保留する。

| ID | 発話原文 | 引数の正解注釈 | 注記 |
|---|---|---|---|
| nyamuru_voice_047 | 紙面全体を表示して | {"kind":"zoom","mode":"fit"} |  |
| nyamuru_voice_048 | ページが全部収まる表示にして | {"kind":"zoom","mode":"fit"} |  |
| nyamuru_voice_049 | 表示を一段拡大して | {"kind":"zoom","mode":"in","count":1} | 量は既存の拡大ボタン1回分。図形は拡大しない。 |
| nyamuru_voice_050 | ズームインして | {"kind":"zoom","mode":"in","count":1} |  |
| nyamuru_voice_051 | 表示を一段縮小して | {"kind":"zoom","mode":"out","count":1} |  |
| nyamuru_voice_052 | ズームアウトを一回 | {"kind":"zoom","mode":"out","count":1} |  |
| nyamuru_voice_053 | 100パーセント表示に戻して | {"kind":"zoom","mode":"actual"} |  |
| nyamuru_voice_054 | 原稿を百パーセントで見せて | {"kind":"zoom","mode":"actual"} |  |
| nyamuru_voice_055 | 見開き表示にして | {"kind":"spread","enabled":true} |  |
| nyamuru_voice_056 | 左右のページを見開きで表示して | {"kind":"spread","enabled":true} |  |
| nyamuru_voice_057 | 見開き表示をオフにして | {"kind":"spread","enabled":false} |  |
| nyamuru_voice_058 | 配置ガイドを表示して | {"kind":"guide","guide":"placement","enabled":true} |  |
| nyamuru_voice_059 | 人物や吹き出しの配置枠を隠して | {"kind":"guide","guide":"placement","enabled":false} | 人物・吹き出し本体を隠す依頼ではない。 |
| nyamuru_voice_060 | 編集ガイドをオンにして | {"kind":"guide","guide":"edit","enabled":true} |  |
| nyamuru_voice_061 | 編集ガイドをオフにして | {"kind":"guide","guide":"edit","enabled":false} |  |
| nyamuru_voice_062 | 選択中の人物のあたり画像を隠して | {"kind":"guide","guide":"artwork","target":"selected_figure","enabled":false} |  |
| nyamuru_voice_063 | この人物のあたり画像を表示して | {"kind":"guide","guide":"artwork","target":"selected_figure","enabled":true} |  |
| nyamuru_voice_064 | シナリオのタブを開いて | {"kind":"tab","tab":"coverage"} |  |
| nyamuru_voice_065 | 登場人物の設定画面を見せて | {"kind":"tab","tab":"characters"} |  |
| nyamuru_voice_066 | ネーム編集のタブに戻って | {"kind":"tab","tab":"storyboard"} | ページ移動・Undoではなくタブ移動。 |

### 作画方式切替 `artwork_mode_set`

作画設定を integrated（一体型）または draft（下書き）にする依頼。

境界：画像生成の開始、生成対象だけの切替、部分修正との意味が曖昧な「部分生成」は含めない。

| ID | 発話原文 | 引数の正解注釈 | 注記 |
|---|---|---|---|
| nyamuru_voice_067 | 作画方式をページ全体の一体型にして | {"mode":"integrated"} |  |
| nyamuru_voice_068 | 全体を一体生成する設定に切り替えて | {"mode":"integrated"} | 生成の開始は依頼されていない。 |
| nyamuru_voice_069 | 文字と吹き出しを含めてページを仕上げる方式を選んで | {"mode":"integrated"} |  |
| nyamuru_voice_070 | 作画設定の一体型を選択して | {"mode":"integrated"} |  |
| nyamuru_voice_071 | 今は生成せず、一体型の方式にだけ切り替えて | {"mode":"integrated"} |  |
| nyamuru_voice_072 | 作画方式を下書き生成にして | {"mode":"draft"} |  |
| nyamuru_voice_073 | コマごとに下書きを作る設定を選んで | {"mode":"draft"} |  |
| nyamuru_voice_074 | 手描きで仕上げる下書きの方式に切り替えて | {"mode":"draft"} |  |
| nyamuru_voice_075 | 作画設定の下書きを選択して | {"mode":"draft"} |  |
| nyamuru_voice_076 | 生成は始めず、下書き方式にだけ変えて | {"mode":"draft"} |  |

### 吹き出しの指定変更 `bubble_set`

既存の吹き出しについて、形・素材・しっぽ有無・切取り・位置・寸法・本文・話者・所属・結合の値を明示する依頼。

境界：適切な素材選び、読みやすさ判断、程度不明の移動・拡大、新規追加・削除は含めない。

| ID | 発話原文 | 引数の正解注釈 | 注記 |
|---|---|---|---|
| nyamuru_voice_077 | この吹き出しを四角にして | {"target":"selected_bubble","field":"shape","value":"square"} |  |
| nyamuru_voice_078 | 選択中の吹き出しをキャプションに変更して | {"target":"selected_bubble","field":"shape","value":"caption"} |  |
| nyamuru_voice_079 | 吹き出しの形をふつうに戻して | {"target":"selected_bubble","field":"shape","value":"normal"} | 以前の輪郭をUndoで復元する意味ではなく、形の値をnormalへ設定。 |
| nyamuru_voice_080 | この吹き出しに素材のnomal 01を使って | {"target":"selected_bubble","field":"preset","preset_id":"nomal_01"} | 作者の素材IDに従いnomalの綴りを保持。音声での読み方は未検証。 |
| nyamuru_voice_081 | 選択中の吹き出しを素材toge 02にして | {"target":"selected_bubble","field":"preset","preset_id":"toge_02"} | 素材名を明示。感情からtogeを推測しない。 |
| nyamuru_voice_082 | この吹き出しのしっぽを消して | {"target":"selected_bubble","field":"tail_enabled","value":false} | 否定形ではなくオフ値を指定した実行依頼。 |
| nyamuru_voice_083 | 選択中の吹き出しにしっぽを付けて | {"target":"selected_bubble","field":"tail_enabled","value":true} |  |
| nyamuru_voice_084 | この吹き出しをコマ枠で切り取る設定にして | {"target":"selected_bubble","field":"clip_to_panel","value":true} | 既存作業中の切取り機能。画面検証完了まで実行対象にはしない。 |
| nyamuru_voice_085 | 吹き出しのコマ枠で切り取る設定をオフにして | {"target":"selected_bubble","field":"clip_to_panel","value":false} | 切取り機能は検証待ち。 |
| nyamuru_voice_086 | 選択中の吹き出しを右へ2ミリ動かして | {"target":"selected_bubble","field":"bbox","operation":"translate","dx_mm":2,"dy_mm":0} |  |
| nyamuru_voice_087 | この吹き出しを左へ三ミリ | {"target":"selected_bubble","field":"bbox","operation":"translate","dx_mm":-3,"dy_mm":0} |  |
| nyamuru_voice_088 | 吹き出しを上へ1ミリ移動して | {"target":"selected_bubble","field":"bbox","operation":"translate","dx_mm":0,"dy_mm":-1} |  |
| nyamuru_voice_089 | この吹き出しを右に2ミリ、上に1ミリずらして | {"target":"selected_bubble","field":"bbox","operation":"translate","dx_mm":2,"dy_mm":-1} | 一つの移動にx/y値を指定。compound_requestではない。 |
| nyamuru_voice_090 | この吹き出しの幅を30ミリにして | {"target":"selected_bubble","field":"bbox","operation":"resize","width_mm":30} |  |
| nyamuru_voice_091 | 選択した吹き出しの高さを40ミリに変更して | {"target":"selected_bubble","field":"bbox","operation":"resize","height_mm":40} |  |
| nyamuru_voice_092 | 吹き出しの幅を25ミリ、高さを35ミリにして | {"target":"selected_bubble","field":"bbox","operation":"resize","width_mm":25,"height_mm":35} | 一つのBBoxの寸法指定。compound_requestではない。 |
| nyamuru_voice_093 | この吹き出しの本文を「おはよう。」にして | {"target":"selected_bubble","field":"text","value":"おはよう。"} | 句点を含め指定本文を保持。 |
| nyamuru_voice_094 | この吹き出しに「保存して、次のページへ」と入れて | {"target":"selected_bubble","field":"text","value":"保存して、次のページへ"} | 引用内を操作命令として分解・実行しない。 |
| nyamuru_voice_095 | この吹き出しの話者を小雪にして | {"target":"selected_bubble","field":"speaker","name":"小雪"} | 架空の例。実行側で現在の人物台帳に一意に照合する。 |
| nyamuru_voice_096 | 選択中の吹き出しを話者なしにして | {"target":"selected_bubble","field":"speaker","name":null} |  |
| nyamuru_voice_097 | この吹き出しの所属を同じページの2コマ目に変えて | {"target":"selected_bubble","field":"owner","owner":"panel","panel_number":2} | コマ番号を実行時のコマ一覧へ照合。単なる座標移動ではない。 |
| nyamuru_voice_098 | 吹き出しの所属をページ前景に移して | {"target":"selected_bubble","field":"owner","owner":"page_overlay"} |  |
| nyamuru_voice_099 | 選択中の吹き出しを同じコマの1番の吹き出しにつないで | {"target":"selected_bubble","field":"join_to","bubble_number":1} | 既存仕様の結合先制約を実行側で確認する。 |
| nyamuru_voice_100 | この吹き出しの結合を解除して | {"target":"selected_bubble","field":"join_to","bubble_number":null} |  |
| nyamuru_voice_184 | この吹き出しに「コマシンクロをオフにして」と入れて | {"target":"selected_bubble","field":"text","value":"コマシンクロをオフにして"} | 引用内は本文。コマ設定は変更しない。 |
| nyamuru_voice_204 | この吹き出しに「内枠スナップをオフにして」と入れて | {"target":"selected_bubble","field":"text","value":"内枠スナップをオフにして"} | 引用内は本文。コマ設定は変更しない。 |
| nyamuru_voice_224 | この吹き出しに「コマスナップをオフにして」と入れて | {"target":"selected_bubble","field":"text","value":"コマスナップをオフにして"} | 引用内は本文。コマ設定は変更しない。 |
| nyamuru_voice_272 | この吹き出しに「これ生成」と入れて | {"target":"selected_bubble","field":"text","value":"これ生成"} | 引用は吹き出し本文。画像生成しない。 |
| nyamuru_voice_316 | この吹き出しに「コマ3の小雪ちゃんだけ生成」と入れて | {"target":"selected_bubble","field":"text","value":"コマ3の小雪ちゃんだけ生成"} | 引用内のコマ番号・人名は本文であり、生成対象にしない。 |

### 意味・指定が不足 `needs_clarification`

この一発話だけでは操作、値、または参照の意味を一意に決められない。

境界：「選択中の吹き出し」のような通常の画面選択参照は操作ラベルのまま。実際の未選択は実行側で扱う。

| ID | 発話原文 | 引数の正解注釈 | 注記 |
|---|---|---|---|
| nyamuru_voice_101 | 戻して | — | ページ移動、Undo、表示変更などのどれか不明。 |
| nyamuru_voice_102 | もう一度 | — | Redo、再実行などのどれか不明。 |
| nyamuru_voice_103 | こっちにして | — | 対象だけでなく操作や値も不明。 |
| nyamuru_voice_104 | 全体に切り替えて | — | 全体表示と一体生成方式を区別できない。 |
| nyamuru_voice_105 | 部分生成にして | — | 下書き方式、生成対象、部分修正のどれを指すか不明。 |
| nyamuru_voice_106 | ガイドを消して | — | 編集ガイド、配置枠、あたり画像を区別できない。 |
| nyamuru_voice_107 | 表示を切り替えて | — | 切替先が不明。 |
| nyamuru_voice_108 | 吹き出しを2にして | — | 素材番号、コマ番号、寸法などの項目が不明。 |
| nyamuru_voice_109 | 作画方式を変えて | — | 切替先が不明。 |
| nyamuru_voice_110 | さっきと同じにして | — | 現版は直前の会話を入力しないため保留する。 |
| nyamuru_voice_181 | コマシンクロの設定を変えて | — | オンとオフのどちらへ変えるか、この発話だけでは指定されていない。 |
| nyamuru_voice_182 | コマシンクロを以前の設定に戻して | — | 以前の値は単独発話から解決できない。Undoに読み替えない。 |
| nyamuru_voice_201 | 内枠スナップの設定を変えて | — | オンとオフのどちらへ変えるか、この発話だけでは指定されていない。 |
| nyamuru_voice_202 | 内枠スナップを以前の設定に戻して | — | 以前の値は単独発話から解決できない。Undoに読み替えない。 |
| nyamuru_voice_221 | コマスナップの設定を変えて | — | オンとオフのどちらへ変えるか、この発話だけでは指定されていない。 |
| nyamuru_voice_222 | コマスナップを以前の設定に戻して | — | 以前の値は単独発話から解決できない。Undoに読み替えない。 |
| nyamuru_voice_267 | これの候補を出して | — | 候補の種類が不明。3D背景へ決め打ちしない。 |
| nyamuru_voice_309 | コマ3の | — | 操作または変更先の指定が足りない。入力途中なら発話完了を待つ。 |
| nyamuru_voice_310 | 文字をそろえて | — | 操作または変更先の指定が足りない。入力途中なら発話完了を待つ。 |
| nyamuru_voice_311 | ペンを切り替えて | — | 操作または変更先の指定が足りない。入力途中なら発話完了を待つ。 |

### LLMによる内容判断 `needs_reasoning`

場面・資料を読んで形、配置、人物対応、表現などを考える依頼。

境界：明示された値をそのまま設定する操作、方法を尋ねる質問は含めない。

| ID | 発話原文 | 引数の正解注釈 | 注記 |
|---|---|---|---|
| nyamuru_voice_111 | このセリフに合う吹き出しの素材を選んで | — |  |
| nyamuru_voice_112 | この場面が緊張して見える形に整えて | — | tenseという素材クラスへ機械的に決め打ちしない。 |
| nyamuru_voice_113 | 人物の顔に重ならないように吹き出しを配置して | — |  |
| nyamuru_voice_114 | このページの吹き出しを読みやすくして | — |  |
| nyamuru_voice_115 | 話者が分かる向きにしっぽを調整して | — | 方向・先端座標の値が明示されていない。 |
| nyamuru_voice_116 | しっぽを口まで伸ばさず、ちょうどいい長さにして | — |  |
| nyamuru_voice_117 | 台本と人物設定から、この吹き出しの話者を確認して直して | — |  |
| nyamuru_voice_118 | 少し控えめな印象の吹き出しに変えて | — |  |
| nyamuru_voice_119 | この吹き出しを少し大きくして | — | 「少し」の量をこのデータでは固定しない。 |
| nyamuru_voice_120 | 吹き出しが見切れない位置を考えて直して | — |  |

### 複数操作 `compound_request`

独立した操作を二つ以上、現在の実行依頼として含む。

境界：同じ移動のx/y指定、同じBBoxの幅/高さ、繰り返し回数、入力本文の中の命令語、訂正で撤回された操作は数えない。

| ID | 発話原文 | 引数の正解注釈 | 注記 |
|---|---|---|---|
| nyamuru_voice_121 | 保存してから次のページに進んで | — | 保存成功を確認してからページ移動する順序。現版は自動分解しない。 |
| nyamuru_voice_122 | 前のページを開いて、見開き表示にして | — |  |
| nyamuru_voice_123 | 直前の編集を戻して、その状態を保存して | — |  |
| nyamuru_voice_124 | リドゥしてから保存して | — |  |
| nyamuru_voice_125 | 配置ガイドを消して、表示を100パーセントにして | — | 同一ラベルでも独立した二つの操作。 |
| nyamuru_voice_126 | 下書き方式に切り替えて保存して | — |  |
| nyamuru_voice_127 | この吹き出しを四角にして、しっぽを消して | — | 形としっぽ有無の二つの設定操作。 |
| nyamuru_voice_128 | この吹き出しを右へ2ミリ動かして保存して | — |  |
| nyamuru_voice_129 | 3ページを表示して、シナリオのタブを開いて | — |  |
| nyamuru_voice_130 | 一体型の方式に変えて、そのまま生成を開始して | — | 方式変更と生成開始の二操作。生成対象と実行経路を解決せず一括実行しない。 |
| nyamuru_voice_183 | コマシンクロをオンにして保存して | — | 設定変更と作品保存の二操作。自動分解して即実行しない。 |
| nyamuru_voice_203 | 内枠スナップをオンにして保存して | — | 設定変更と作品保存の二操作。自動分解して即実行しない。 |
| nyamuru_voice_223 | コマスナップをオンにして保存して | — | 設定変更と作品保存の二操作。自動分解して即実行しない。 |
| nyamuru_voice_270 | これを生成して保存して | — | 生成と保存の二操作。生成成功・保存対象の解決が必要。 |
| nyamuru_voice_271 | 3D背景候補を出して、一番目をこのコマに配置して | — | 候補提示と配置の二操作。候補提示だけの処理で自動配置しない。 |
| nyamuru_voice_314 | コマ1の小雪ちゃんを生成してからコマ3を生成して | — | 異なる対象への二回の生成。各対象を分けて解決する。 |
| nyamuru_voice_315 | ラスターペンに変えて、文字の頭をそろえて | — | 描画ツール切替と文字枠整列の二操作。 |

### 初期範囲外の依頼 `out_of_scope_request`

何をしてほしいかは明確だが、この定義の直接操作ラベルの範囲外。

境界：アプリ自体に機能がないという意味ではない。全ページ一括生成、生成中止、ページ削除などは今回の対象外。

| ID | 発話原文 | 引数の正解注釈 | 注記 |
|---|---|---|---|
| nyamuru_voice_131 | このページを印刷キューに入れて | — | 現行アプリでも印刷キューの入口は未確認。 |
| nyamuru_voice_132 | 新しい作品を作って | — | アプリには既存操作があるが今回の音声範囲外。 |
| nyamuru_voice_133 | 作品フォルダを開いて | — | ページを開く依頼との区別。 |
| nyamuru_voice_134 | この作品を別名で保存して | — | 通常保存へ読み替えない。 |
| nyamuru_voice_135 | このページを削除して | — |  |
| nyamuru_voice_137 | 全ページを一体生成して | — | 一ページ全体の生成とは別の全ページ一括生成。今回は対象外。 |
| nyamuru_voice_138 | 実行中の画像生成を止めて | — | Undoやnot_commandにしない。中止処理は今回の範囲外。 |
| nyamuru_voice_139 | 吹き出しを一つ追加して | — | 今回の対象は既存吹き出しの指定変更。 |
| nyamuru_voice_140 | この吹き出しをウニフラッシュ素材に変えて | — | 利用者が未制作素材を保留した範囲。既存の別形へ置換しない。 |
| nyamuru_voice_268 | ネットから新しい3D背景モデルを探して | — | 登録済みモデルからの候補選びとは別の外部検索。 |
| nyamuru_voice_269 | 3D背景のカメラ構図を三つ作って | — | 登録済みモデルの候補選びとは別の構図生成。 |
| nyamuru_voice_312 | 選択中の文字の各行を左揃えにして | — | 今回追加した複数文字枠の位置揃えとは別の段落組版。 |
| nyamuru_voice_313 | 選択した吹き出しの輪郭を上揃えにして | — | 文字だけの整列とは別の輪郭整列。 |

### 今回の実行依頼ではない `not_command`

説明・状態・能力の質問、報告、独り言、明示的な不実行・延期。

境界：疑問形の依頼「保存してくれる？」はsave。明確な中止依頼は対象に応じて範囲外または保留へ。

| ID | 発話原文 | 引数の正解注釈 | 注記 |
|---|---|---|---|
| nyamuru_voice_141 | 保存のやり方を教えて | — | 説明を求めており保存の実行依頼ではない。 |
| nyamuru_voice_142 | この作品は保存済み？ | — | 状態確認は実行結果の記録から答える。保存を追加実行しない。 |
| nyamuru_voice_143 | 今は保存しないで | — | 保存を実行しない制約。進行中ジョブの中止依頼ではない。 |
| nyamuru_voice_144 | 保存して、いや、まだ保存しないで | — | 明示的な訂正で保存依頼を撤回。compound_requestにしない。 |
| nyamuru_voice_145 | さっき保存したよ | — | 完了報告を再実行依頼にしない。 |
| nyamuru_voice_146 | 元に戻すと何が戻るの？ | — |  |
| nyamuru_voice_147 | もう編集をやり直した | — |  |
| nyamuru_voice_148 | 次のページには何がある？ | — | 内容の質問。ページ移動を求めていない。 |
| nyamuru_voice_149 | 全体を一体型にするとどうなる？ | — | 方式の説明を求めている。 |
| nyamuru_voice_150 | この吹き出しは四角のままでいい | — | 現在状態の保持。四角への追加変更を推定しない。 |
| nyamuru_voice_151 | 直前の編集を戻さないで | — | Undoを実行しない制約。 |
| nyamuru_voice_152 | 今回はリドゥしないで | — | Redoを実行しない制約。 |
| nyamuru_voice_153 | まだ次のページには進まないで | — | ページ移動を実行しない制約。 |
| nyamuru_voice_154 | 配置ガイドは消さないで | — | ガイドをオフにする命令ではない。 |
| nyamuru_voice_155 | 今は見開き表示にしないで | — |  |
| nyamuru_voice_156 | 作画方式を一体型には切り替えないで | — | 方式変更を実行しない制約。 |
| nyamuru_voice_157 | 下書き方式から変えずにそのままでいい | — | 現状維持。 |
| nyamuru_voice_158 | この吹き出しのしっぽを消さないで | — | tail_enabled=falseへしない。 |
| nyamuru_voice_159 | この吹き出しを四角には変えないで | — |  |
| nyamuru_voice_160 | このアプリには保存機能がある？ | — | 能力・機能の質問であって保存依頼ではない。 |
| nyamuru_voice_161 | 見開き表示にしたよ | — | 完了報告。 |
| nyamuru_voice_162 | いま下書き方式で作業している | — | 現在状態の報告。 |
| nyamuru_voice_163 | この吹き出しの話者は小雪で合ってる？ | — | 確認への回答は必要だが、話者変更の依頼はしていない。 |
| nyamuru_voice_164 | 印刷キューって使えるの？ | — | 機能の質問。範囲外の実行依頼ではない。 |
| nyamuru_voice_177 | コマシンクロをオンにしないで | — | オンへの変更を禁止。オフへ変更する依頼ではなく、現在値を保持。 |
| nyamuru_voice_178 | コマシンクロをオフにしないで | — | オフへの変更を禁止。オンへ変更する依頼ではなく、現在値を保持。 |
| nyamuru_voice_179 | コマシンクロは今オン？ | — | 現在値への質問。設定変更しない。 |
| nyamuru_voice_180 | コマシンクロって何？ | — | 機能の説明を求めている。設定変更しない。 |
| nyamuru_voice_197 | 内枠スナップをオンにしないで | — | オンへの変更を禁止。オフへ変更する依頼ではなく、現在値を保持。 |
| nyamuru_voice_198 | 内枠スナップをオフにしないで | — | オフへの変更を禁止。オンへ変更する依頼ではなく、現在値を保持。 |
| nyamuru_voice_199 | 内枠スナップは今オン？ | — | 現在値への質問。設定変更しない。 |
| nyamuru_voice_200 | 内枠スナップって何？ | — | 機能の説明を求めている。設定変更しない。 |
| nyamuru_voice_217 | コマスナップをオンにしないで | — | オンへの変更を禁止。オフへ変更する依頼ではなく、現在値を保持。 |
| nyamuru_voice_218 | コマスナップをオフにしないで | — | オフへの変更を禁止。オンへ変更する依頼ではなく、現在値を保持。 |
| nyamuru_voice_219 | コマスナップは今オン？ | — | 現在値への質問。設定変更しない。 |
| nyamuru_voice_220 | コマスナップって何？ | — | 機能の説明を求めている。設定変更しない。 |
| nyamuru_voice_261 | これ生成しないで | — | 生成開始を禁止。生成中止とは区別する。 |
| nyamuru_voice_262 | このキャラクターは生成済み？ | — | 実際のジョブ状態・結果を確認して回答する。追加生成しない。 |
| nyamuru_voice_263 | ページ全体の生成はまだ始めないで | — |  |
| nyamuru_voice_264 | このコマだけ生成したよ | — | 完了報告。再生成しない。 |
| nyamuru_voice_265 | 3D背景の候補って出せる？ | — | 機能の質問であり、候補提示の実行依頼とは限らない。 |
| nyamuru_voice_266 | 3D背景候補はまだ出さないで | — |  |
| nyamuru_voice_305 | ラスターペンには変えないで | — | 設定変更や整列・候補提示の現在の実行依頼ではない。 |
| nyamuru_voice_306 | ベクターペンって何？ | — | 設定変更や整列・候補提示の現在の実行依頼ではない。 |
| nyamuru_voice_307 | 文字の頭はそろえないで | — | 設定変更や整列・候補提示の現在の実行依頼ではない。 |
| nyamuru_voice_308 | 背景候補はもう出したよ | — | 設定変更や整列・候補提示の現在の実行依頼ではない。 |

### コマシンクロのオン・オフ `panel_sync_set`

コマシンクロを明示的にオンまたはオフへ設定する依頼。設定変更だけでコマを移動・変形しない。

境界：他の二つのコマ設定、表示ガイド、状態質問、不実行の指示、変更先が不明な依頼は含めない。

| ID | 発話原文 | 引数の正解注釈 | 注記 |
|---|---|---|---|
| nyamuru_voice_165 | コマシンクロをオンにして | {"enabled":true} |  |
| nyamuru_voice_166 | コマシンクロオン | {"enabled":true} |  |
| nyamuru_voice_167 | コマシンクロを有効にしてくれる？ | {"enabled":true} | 疑問形の実行依頼。 |
| nyamuru_voice_168 | コマシンクロのチェックを入れて | {"enabled":true} |  |
| nyamuru_voice_169 | コマシンクロを使う設定にして | {"enabled":true} |  |
| nyamuru_voice_170 | コマシンクロをオフ、いや、オンにして | {"enabled":true} | 訂正後のオン指定だけを採る。 |
| nyamuru_voice_171 | コマシンクロをオフにして | {"enabled":false} |  |
| nyamuru_voice_172 | コマシンクロオフ | {"enabled":false} |  |
| nyamuru_voice_173 | コマシンクロを無効にしてください | {"enabled":false} |  |
| nyamuru_voice_174 | コマシンクロのチェックを外して | {"enabled":false} |  |
| nyamuru_voice_175 | コマシンクロを使わない設定にして | {"enabled":false} | オフ値の設定依頼。不実行指示とは区別する。 |
| nyamuru_voice_176 | コマシンクロをオン、いや、オフにして | {"enabled":false} | 訂正後のオフ指定だけを採る。 |

### 内枠スナップのオン・オフ `inner_frame_snap_set`

内枠スナップを明示的にオンまたはオフへ設定する依頼。設定変更だけでコマを移動・変形しない。

境界：他の二つのコマ設定、表示ガイド、状態質問、不実行の指示、変更先が不明な依頼は含めない。

| ID | 発話原文 | 引数の正解注釈 | 注記 |
|---|---|---|---|
| nyamuru_voice_185 | 内枠スナップをオンにして | {"enabled":true} |  |
| nyamuru_voice_186 | 内枠スナップオン | {"enabled":true} |  |
| nyamuru_voice_187 | 内枠スナップを有効にしてくれる？ | {"enabled":true} | 疑問形の実行依頼。 |
| nyamuru_voice_188 | 内枠スナップのチェックを入れて | {"enabled":true} |  |
| nyamuru_voice_189 | 内枠スナップを使う設定にして | {"enabled":true} |  |
| nyamuru_voice_190 | 内枠スナップをオフ、いや、オンにして | {"enabled":true} | 訂正後のオン指定だけを採る。 |
| nyamuru_voice_191 | 内枠スナップをオフにして | {"enabled":false} |  |
| nyamuru_voice_192 | 内枠スナップオフ | {"enabled":false} |  |
| nyamuru_voice_193 | 内枠スナップを無効にしてください | {"enabled":false} |  |
| nyamuru_voice_194 | 内枠スナップのチェックを外して | {"enabled":false} |  |
| nyamuru_voice_195 | 内枠スナップを使わない設定にして | {"enabled":false} | オフ値の設定依頼。不実行指示とは区別する。 |
| nyamuru_voice_196 | 内枠スナップをオン、いや、オフにして | {"enabled":false} | 訂正後のオフ指定だけを採る。 |

### コマスナップのオン・オフ `panel_gap_snap_set`

コマスナップを明示的にオンまたはオフへ設定する依頼。設定変更だけでコマを移動・変形しない。

境界：他の二つのコマ設定、表示ガイド、状態質問、不実行の指示、変更先が不明な依頼は含めない。

| ID | 発話原文 | 引数の正解注釈 | 注記 |
|---|---|---|---|
| nyamuru_voice_205 | コマスナップをオンにして | {"enabled":true} |  |
| nyamuru_voice_206 | コマスナップオン | {"enabled":true} |  |
| nyamuru_voice_207 | コマスナップを有効にしてくれる？ | {"enabled":true} | 疑問形の実行依頼。 |
| nyamuru_voice_208 | コマスナップのチェックを入れて | {"enabled":true} |  |
| nyamuru_voice_209 | コマスナップを使う設定にして | {"enabled":true} |  |
| nyamuru_voice_210 | コマスナップをオフ、いや、オンにして | {"enabled":true} | 訂正後のオン指定だけを採る。 |
| nyamuru_voice_211 | コマスナップをオフにして | {"enabled":false} |  |
| nyamuru_voice_212 | コマスナップオフ | {"enabled":false} |  |
| nyamuru_voice_213 | コマスナップを無効にしてください | {"enabled":false} |  |
| nyamuru_voice_214 | コマスナップのチェックを外して | {"enabled":false} |  |
| nyamuru_voice_215 | コマスナップを使わない設定にして | {"enabled":false} | オフ値の設定依頼。不実行指示とは区別する。 |
| nyamuru_voice_216 | コマスナップをオン、いや、オフにして | {"enabled":false} | 訂正後のオフ指定だけを採る。 |

### 指定対象の画像生成 `generate_request`

選択対象、選択中または名前で指定した人物、現在のページ全体、選択中または番号で指定したコマ全体の画像生成を依頼する。

境界：作画方式の設定だけ、全ページ一括生成、生成の中止、結果の自動配置は含めない。対象を一意に解決できない場合は実行側で確認する。

| ID | 発話原文 | 引数の正解注釈 | 注記 |
|---|---|---|---|
| nyamuru_voice_136 | 人物だけ画像生成を始めて | {"target":"selected_character"} | 人物の生成開始を対象範囲へ追加。現在の人物選択から一意に解決し、未選択・候補複数なら対象を確認する。 |
| nyamuru_voice_225 | これ生成 | {"target":"selection"} | 「これ」は現在の選択へ解決。未選択時に背景などへ勝手に代替しない。 |
| nyamuru_voice_226 | これを生成して | {"target":"selection"} | 「これ」は現在の選択へ解決。未選択時に背景などへ勝手に代替しない。 |
| nyamuru_voice_227 | 選択中のものを生成して | {"target":"selection"} | 「これ」は現在の選択へ解決。未選択時に背景などへ勝手に代替しない。 |
| nyamuru_voice_228 | 今選んでいる対象を画像生成して | {"target":"selection"} | 「これ」は現在の選択へ解決。未選択時に背景などへ勝手に代替しない。 |
| nyamuru_voice_229 | 選択した対象を生成してくれる？ | {"target":"selection"} | 「これ」は現在の選択へ解決。未選択時に背景などへ勝手に代替しない。 |
| nyamuru_voice_230 | 選択中の対象だけ生成して | {"target":"selection"} | 「これ」は現在の選択へ解決。未選択時に背景などへ勝手に代替しない。 |
| nyamuru_voice_231 | このキャラクターだけ生成 | {"target":"selected_character"} | 選択した人物の配置一つだけを対象とし、同じ人物の全登場箇所へ広げない。 |
| nyamuru_voice_232 | この人物だけ画像生成して | {"target":"selected_character"} | 選択した人物の配置一つだけを対象とし、同じ人物の全登場箇所へ広げない。 |
| nyamuru_voice_233 | 選択中のキャラだけ生成して | {"target":"selected_character"} | 選択した人物の配置一つだけを対象とし、同じ人物の全登場箇所へ広げない。 |
| nyamuru_voice_234 | 今選んでいる人物を生成してくれる？ | {"target":"selected_character"} | 選択した人物の配置一つだけを対象とし、同じ人物の全登場箇所へ広げない。 |
| nyamuru_voice_235 | このキャラクターを一人だけ生成して | {"target":"selected_character"} | 選択した人物の配置一つだけを対象とし、同じ人物の全登場箇所へ広げない。 |
| nyamuru_voice_236 | 背景は生成せず、このキャラクターだけ生成して | {"target":"selected_character"} | 選択した人物の配置一つだけを対象とし、同じ人物の全登場箇所へ広げない。 |
| nyamuru_voice_237 | ページ全体を生成 | {"target":"current_page"} | ページ・コマ全体の通常UI実行経路は未接続。分類ラベルの存在を実行可能の証拠にしない。 |
| nyamuru_voice_238 | このページを丸ごと生成して | {"target":"current_page"} | ページ・コマ全体の通常UI実行経路は未接続。分類ラベルの存在を実行可能の証拠にしない。 |
| nyamuru_voice_239 | いま表示しているページ全体の画像を生成して | {"target":"current_page"} | ページ・コマ全体の通常UI実行経路は未接続。分類ラベルの存在を実行可能の証拠にしない。 |
| nyamuru_voice_240 | この一ページを生成してくれる？ | {"target":"current_page"} | ページ・コマ全体の通常UI実行経路は未接続。分類ラベルの存在を実行可能の証拠にしない。 |
| nyamuru_voice_241 | このページを一枚まるごと生成して | {"target":"current_page"} | ページ・コマ全体の通常UI実行経路は未接続。分類ラベルの存在を実行可能の証拠にしない。 |
| nyamuru_voice_242 | このページ全体の生成を始めて | {"target":"current_page"} | ページ・コマ全体の通常UI実行経路は未接続。分類ラベルの存在を実行可能の証拠にしない。 |
| nyamuru_voice_243 | このコマだけ生成 | {"target":"selected_panel"} | ページ・コマ全体の通常UI実行経路は未接続。分類ラベルの存在を実行可能の証拠にしない。 |
| nyamuru_voice_244 | 選択中のコマだけ生成して | {"target":"selected_panel"} | ページ・コマ全体の通常UI実行経路は未接続。分類ラベルの存在を実行可能の証拠にしない。 |
| nyamuru_voice_245 | いま選んでいるコマを生成して | {"target":"selected_panel"} | ページ・コマ全体の通常UI実行経路は未接続。分類ラベルの存在を実行可能の証拠にしない。 |
| nyamuru_voice_246 | このコマ全体を一枚の画像として生成して | {"target":"selected_panel"} | ページ・コマ全体の通常UI実行経路は未接続。分類ラベルの存在を実行可能の証拠にしない。 |
| nyamuru_voice_247 | 他のコマには手を加えず、このコマだけ生成して | {"target":"selected_panel"} | ページ・コマ全体の通常UI実行経路は未接続。分類ラベルの存在を実行可能の証拠にしない。 |
| nyamuru_voice_248 | このコマだけ生成してくれる？ | {"target":"selected_panel"} | ページ・コマ全体の通常UI実行経路は未接続。分類ラベルの存在を実行可能の証拠にしない。 |
| nyamuru_voice_273 | コマ3の小雪ちゃんだけ生成して | {"target":"named_character","locator":{"panel_number":3,"character_name":"小雪ちゃん"}} | コマ番号は現在ページの表示番号から解決。人名は架空の例で、敬称を含む原文を保持し、実際の人物と配置へ一意に照合する。 |
| nyamuru_voice_274 | コマ1の小雪だけ生成して | {"target":"named_character","locator":{"panel_number":1,"character_name":"小雪"}} | コマ番号は現在ページの表示番号から解決。人名は架空の例で、敬称を含む原文を保持し、実際の人物と配置へ一意に照合する。 |
| nyamuru_voice_275 | コマ3のこのキャラクターだけ生成して | {"target":"selected_character","locator":{"panel_number":3}} | コマ番号は現在ページの表示番号から解決。人名は架空の例で、敬称を含む原文を保持し、実際の人物と配置へ一意に照合する。 |
| nyamuru_voice_276 | コマ1だけ生成して | {"target":"specified_panel","locator":{"panel_number":1}} | コマ番号は現在ページの表示番号から解決。人名は架空の例で、敬称を含む原文を保持し、実際の人物と配置へ一意に照合する。 |
| nyamuru_voice_277 | 3コマ目を生成して | {"target":"specified_panel","locator":{"panel_number":3}} | コマ番号は現在ページの表示番号から解決。人名は架空の例で、敬称を含む原文を保持し、実際の人物と配置へ一意に照合する。 |
| nyamuru_voice_278 | 小雪ちゃんだけ生成して | {"target":"named_character","locator":{"character_name":"小雪ちゃん"}} | コマ番号は現在ページの表示番号から解決。人名は架空の例で、敬称を含む原文を保持し、実際の人物と配置へ一意に照合する。 |
| nyamuru_voice_279 | あかりちゃんだけ生成して | {"target":"named_character","locator":{"character_name":"あかりちゃん"}} | コマ番号は現在ページの表示番号から解決。人名は架空の例で、敬称を含む原文を保持し、実際の人物と配置へ一意に照合する。 |
| nyamuru_voice_280 | コマ一のミナちゃんだけ画像生成して | {"target":"named_character","locator":{"panel_number":1,"character_name":"ミナちゃん"}} | コマ番号は現在ページの表示番号から解決。人名は架空の例で、敬称を含む原文を保持し、実際の人物と配置へ一意に照合する。 |

### 登録済み3D背景の候補提示 `background_3d_candidates`

登録済みの3Dモデルから、背景に使える候補を選んで提示する依頼。場面との適合判断にはLLMを使う。

境界：外部の3Dモデル検索、新規3D生成、カメラ・構図案の生成、候補の自動配置・自動適用は含めない。

| ID | 発話原文 | 引数の正解注釈 | 注記 |
|---|---|---|---|
| nyamuru_voice_249 | 3D背景候補出して | {"source":"registered_3d_models"} | 利用者確認済みの意味：登録済み3Dモデルから背景候補を選ぶ。カメラ構図案ではない。 |
| nyamuru_voice_250 | 登録済みの3Dモデルから背景候補を出して | {"source":"registered_3d_models"} |  |
| nyamuru_voice_251 | このコマに使える登録済み3D背景を候補に挙げて | {"source":"registered_3d_models"} |  |
| nyamuru_voice_252 | 今登録してある3D背景の候補を見せて | {"source":"registered_3d_models"} |  |
| nyamuru_voice_253 | この場面に合う3Dモデルを候補として挙げて | {"source":"registered_3d_models"} | 現在の場面の資料を読んで候補を選ぶ。 |
| nyamuru_voice_254 | 舞台に使う登録済みの3Dモデルを候補に出して | {"source":"registered_3d_models"} |  |
| nyamuru_voice_255 | 3D背景の候補を三つ出して | {"source":"registered_3d_models","count":3} | 該当モデルが足りなければ少数を提示し、不足分を捏造しない。 |
| nyamuru_voice_256 | 登録済みの3Dモデルから学校の背景候補を探して | {"source":"registered_3d_models","query":"学校"} |  |
| nyamuru_voice_257 | 教室に合う登録済み3D背景を候補として見せて | {"source":"registered_3d_models","query":"教室"} |  |
| nyamuru_voice_258 | 登録した3Dモデルの中から背景候補を選んで | {"source":"registered_3d_models"} |  |
| nyamuru_voice_259 | このコマの背景に合う登録済み3Dモデルを二つ提案して | {"source":"registered_3d_models","count":2} |  |
| nyamuru_voice_260 | 配置はしないで、登録済み3D背景の候補だけ出して | {"source":"registered_3d_models"} | 候補提示のみ。モデル選択欄やコマの背景を変更しない。 |
| nyamuru_voice_281 | コマ3の背景候補出して | {"source":"registered_3d_models","locator":{"panel_number":3}} | この音声操作では「背景候補」を登録済み3Dモデルの候補提示の略として扱う。 |
| nyamuru_voice_282 | コマ1の背景候補を見せて | {"source":"registered_3d_models","locator":{"panel_number":1}} | この音声操作では「背景候補」を登録済み3Dモデルの候補提示の略として扱う。 |
| nyamuru_voice_283 | 背景候補出して | {"source":"registered_3d_models"} | この音声操作では「背景候補」を登録済み3Dモデルの候補提示の略として扱う。 |
| nyamuru_voice_284 | コマ一に合う登録済み3D背景の候補を三つ出して | {"source":"registered_3d_models","locator":{"panel_number":1},"count":3} | この音声操作では「背景候補」を登録済み3Dモデルの候補提示の略として扱う。 |

### 描画ペンの切替 `paint_tool_set`

ラスターペンまたはベクターペンへ切り替える依頼。

境界：既存の絵やレイヤーのラスター化・ベクター化、線を描く実行、切替先不明の依頼は含めない。

| ID | 発話原文 | 引数の正解注釈 | 注記 |
|---|---|---|---|
| nyamuru_voice_285 | ラスターペンに変えて | {"tool":"pen"} | 既存のselectToolを使う。ベクターペンは既存UIのベジェペン。描画済みの絵の変換は依頼されていない。 |
| nyamuru_voice_286 | ラスターペンに切り替えて | {"tool":"pen"} | 既存のselectToolを使う。ベクターペンは既存UIのベジェペン。描画済みの絵の変換は依頼されていない。 |
| nyamuru_voice_287 | ラスターで描くペンを選んで | {"tool":"pen"} | 既存のselectToolを使う。ベクターペンは既存UIのベジェペン。描画済みの絵の変換は依頼されていない。 |
| nyamuru_voice_288 | ラスターペンを使いたいので選択して | {"tool":"pen"} | 既存のselectToolを使う。ベクターペンは既存UIのベジェペン。描画済みの絵の変換は依頼されていない。 |
| nyamuru_voice_289 | ラスターペンにしてくれる？ | {"tool":"pen"} | 既存のselectToolを使う。ベクターペンは既存UIのベジェペン。描画済みの絵の変換は依頼されていない。 |
| nyamuru_voice_290 | ベクターじゃなくてラスターペンにして | {"tool":"pen"} | 既存のselectToolを使う。ベクターペンは既存UIのベジェペン。描画済みの絵の変換は依頼されていない。 |
| nyamuru_voice_291 | ベクターペンに変えて | {"tool":"vector-pen"} | 既存のselectToolを使う。ベクターペンは既存UIのベジェペン。描画済みの絵の変換は依頼されていない。 |
| nyamuru_voice_292 | ベクターペンに切り替えて | {"tool":"vector-pen"} | 既存のselectToolを使う。ベクターペンは既存UIのベジェペン。描画済みの絵の変換は依頼されていない。 |
| nyamuru_voice_293 | ベクターのペンを選んで | {"tool":"vector-pen"} | 既存のselectToolを使う。ベクターペンは既存UIのベジェペン。描画済みの絵の変換は依頼されていない。 |
| nyamuru_voice_294 | ベジェペンにして | {"tool":"vector-pen"} | 既存のselectToolを使う。ベクターペンは既存UIのベジェペン。描画済みの絵の変換は依頼されていない。 |
| nyamuru_voice_295 | ベクターペンにしてくれる？ | {"tool":"vector-pen"} | 既存のselectToolを使う。ベクターペンは既存UIのベジェペン。描画済みの絵の変換は依頼されていない。 |
| nyamuru_voice_296 | ラスターペンではなくベクターペンにして | {"tool":"vector-pen"} | 既存のselectToolを使う。ベクターペンは既存UIのベジェペン。描画済みの絵の変換は依頼されていない。 |

### 複数文字枠の上端揃え `text_frames_align`

選択した複数の文字枠の上端をそろえる依頼。別々の吹き出しの文字の書き出し位置をそろえる用途。

境界：一つの文章の段落・各行の揃え、吹き出し輪郭の整列、位置を判断する自由な組版依頼は含めない。

| ID | 発話原文 | 引数の正解注釈 | 注記 |
|---|---|---|---|
| nyamuru_voice_297 | 選択中の文字の頭をそろえて | {"target":"selected_text_frames","alignment":"top","reference":"selection_bounds"} | 利用者確認済みの意味は複数文字枠の上端揃え。文字の独立位置と複数選択が未実装なので、現時点で実行可能とは扱わない。 |
| nyamuru_voice_298 | 選択した文字枠の上端をそろえて | {"target":"selected_text_frames","alignment":"top","reference":"selection_bounds"} | 利用者確認済みの意味は複数文字枠の上端揃え。文字の独立位置と複数選択が未実装なので、現時点で実行可能とは扱わない。 |
| nyamuru_voice_299 | この複数の文字枠を上揃えにして | {"target":"selected_text_frames","alignment":"top","reference":"selection_bounds"} | 利用者確認済みの意味は複数文字枠の上端揃え。文字の独立位置と複数選択が未実装なので、現時点で実行可能とは扱わない。 |
| nyamuru_voice_300 | 選択中のセリフの書き出しの高さをそろえて | {"target":"selected_text_frames","alignment":"top","reference":"selection_bounds"} | 利用者確認済みの意味は複数文字枠の上端揃え。文字の独立位置と複数選択が未実装なので、現時点で実行可能とは扱わない。 |
| nyamuru_voice_301 | 選択した吹き出し内の文字の上端をそろえて | {"target":"selected_text_frames","alignment":"top","reference":"selection_bounds"} | 利用者確認済みの意味は複数文字枠の上端揃え。文字の独立位置と複数選択が未実装なので、現時点で実行可能とは扱わない。 |
| nyamuru_voice_302 | 並んでいる吹き出しのうち、選択した文字だけ頭をそろえて | {"target":"selected_text_frames","alignment":"top","reference":"selection_bounds"} | 利用者確認済みの意味は複数文字枠の上端揃え。文字の独立位置と複数選択が未実装なので、現時点で実行可能とは扱わない。 |
| nyamuru_voice_303 | 複数選んだ文字枠を上にそろえて | {"target":"selected_text_frames","alignment":"top","reference":"selection_bounds"} | 利用者確認済みの意味は複数文字枠の上端揃え。文字の独立位置と複数選択が未実装なので、現時点で実行可能とは扱わない。 |
| nyamuru_voice_304 | コマ3で選択中の文字枠の上端をそろえて | {"target":"selected_text_frames","alignment":"top","reference":"selection_bounds","locator":{"panel_number":3}} | 利用者確認済みの意味は複数文字枠の上端揃え。文字の独立位置と複数選択が未実装なので、現時点で実行可能とは扱わない。 |

## 機械可読ファイル

- [分類定義 labels.json](labels.json)
- [学習候補 candidates.jsonl](candidates.jsonl)
- [件数と来歴 manifest.json](manifest.json)
