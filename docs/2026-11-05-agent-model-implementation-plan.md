# 会話モデル・生成前確認・受信画像の段階別実装計画

作成日: 2026-11-05。状態: P0・P1と準備案内の補修を正本へ統合。P2の用途別設定を実装・関連確認済み。P3以降は未着手。

[採用仕様](AGENT_MODEL_SPEC.md)を、既存の編集・画像生成・保存を維持しながら実装するための計画。まず振る舞いを変えずに責務を分け、ローカルで翻訳と送信確認を完成させる。受信画像を保持・採用できる状態を作ってからAPI利用を有効化する。各段階は、関連試験と確認可能な成果を伴う小さなコミットに分ける。

本計画の更新と実装結果はこの文書へ集約する。計画に書いたファイル・関数は新設予定を含み、存在・実装済みを意味しない。各段階が完了したら、実際の変更、コミット、検証結果、未確認事項を末尾へ記録する。

## 1. 着手時の前提と守る動作

調査基準は正本 `/Users/yukin_co/Desktop/tools/Comic_image_Hub` の `250dcae`。実装開始時にHEAD、未commit差分、共有掲示板を再確認する。

- 生成後の会話・修正・英訳は別worktreeの `9078540` にある。調査時の `git cherry main codex/generation-conversation` は `+` で、正本への統合待ち。最初に担当者の統合状況を確認し、正本で動作確認する。二重実装・ファイル上書き・claimの無断解除はしない。
- `README.md`、`src/components/Header.tsx`、`src/styles/global/workspace-and-page.css` の既存差分と未追跡資料は、この実装へまとめてcommitしない。
- 分離が必要なら `Desktop/tools` 配下にworktreeを作る。各段階の正確な編集pathを共有掲示板へ登録し、正本へ統合後に確認する。
- 通常の手動編集、音声分類、コマ解析、VLM、人物アクション統合、既存のファイル選択・保存は維持する。会話モデルの変更で解析モデルを自動変更しない。
- 生成結果は対象フォルダーの最上段へ新規レイヤー追加。あたり・既存レイヤー・表示・手動ロック・既存のUndo/Redoを維持する。
- 5候補、複数採用、採用後の未採用画像削除、削除失敗時の再試行は既存の生成ジョブ側に残す。受信画像の採用をこの削除処理へ混ぜない。
- 実行中・結果不明の生成は自動再送しない。ユーザー所有のサーバーを終了・再起動しない。自分の検証サーバーだけPID・ポートを記録して終了確認する。

## 2. 現在の結合箇所と分割方針

行数は調査時点の物理行数。短い行数でも一行へ処理を詰め込んだ箇所は、可読性を含めて分割する。

| 既存の入口 | 現状 | 今回の扱い |
|---|---|---|
| [EnvironmentSettings.tsx](../src/components/EnvironmentSettings.tsx) | 379行。モデル設定と他タブ、設定保存を同居 | モデル設定パネルと保存処理を切り出し、親はタブ構成を所有 |
| [ImageGenerationDialog.tsx](../src/components/ImageGenerationDialog.tsx) | 正本402行、会話修正worktree411行。入力・会話・候補・履歴・終了を同居 | 会話接続、入力確認、候補表示を順に分割。採用・削除・終了の所有者を増やさない |
| [createGenerationActions.ts](../src/components/generation/createGenerationActions.ts) | 138行。入力収集→準備→送信を連続実行 | 入力確定と送信を分離し、確認待ちを間に置く |
| [generation_job_results.py](../scripts/generation_job_results.py) | 332行。prepare内で翻訳・最終指示保存、plain/3枚参照は別分岐 | 確認済み入力を保存する責務へ寄せ、翻訳・保護・検査を独立 |
| [generation_prompt_inputs.py](../scripts/generation_prompt_inputs.py) | 330行。定型文、文字保護、入力検査を含む | 既存の定型文・文字保護を再利用。共通処理の追加前に責務ごとに抽出 |
| [nyamuru_panel_actions.py](../scripts/nyamuru_panel_actions.py) | 369行。人物アクションと生成英訳を同居 | 生成英訳だけを抽出。人物アクションの送信先・処理を維持 |
| [localBridgeLifecycle.ts](../src/lib/localBridgeLifecycle.ts) | 翻訳→LLM休止→生成→復帰を一つの処理で管理 | 人の確認待ちを含めず、翻訳利用と生成利用の開始・終了を分離 |
| [agentChat.ts](../src/lib/agentChat.ts)・[editorServices.ts](../src/lib/bridge/editorServices.ts) | 文字列応答、ツールループ、ローカルLLM利用が接続済み | ツールの権限・回数・競合防止を維持し、文章＋画像の共通応答へ拡張 |
| [workspaceImagePlacement.ts](../src/components/workspace/workspaceImagePlacement.ts) | 通常読込には既存artworkを置き換える分岐あり | 生成側の新規レイヤー追加を一般化して受信画像にも使う |

### 命名とファイルサイズ

- 新しいファイル・関数・型は役割で命名する。`preparePromptReview`、`submitGeneration`、`adoptReceivedImage` のように、特定のモデル名を含めない。
- モデルID・提供元・接続方式は設定値またはadapterのデータにする。通信形式の差は `chat_completions_transport.py` 等の通信方式を表す名前へ閉じ込める。
- 既存のモデル名付き入口は、必要な呼び出し箇所から薄いadapterとして扱う。一括改名と新機能追加を同じcommitに混ぜない。API path・保存形式まで名前だけの理由で変えない。
- **一つの実装ファイルは300〜400行程度までを目安**とし、通常は150〜350行で一責務に収める。300行へ近づいたら境界を見直し、400行を超える前に分割する。短い型定義やhelperを300行へ水増ししない。
- 行数削減のための一行化、巨大な引数objectへの状態詰め込み、`part1`／`part2`、何でも入る`utils`／`manager`を作らない。UI、状態遷移、通信、永続化を分ける。
- テストも設定・翻訳・確認・画像受信・採用の振る舞いごとに分ける。本体のprivate実装を写した試験や、巨大な一つのfixtureは増やさない。

## 3. 状態の所有者と依存方向

```text
設定UI → 既存設定reader/writer＋会話用設定 → 用途別の実行先解決
生成UI／会話 → 共通の編集中入力 → bridgeの正規化・必要な英訳・検査
                                          ↓
                           送信内容のプレビュー／任意編集
                                          ↓ 明示送信または確認省略ON
                           確定入力 → 選択した生成先adapter

会話API／翻訳API／手動画像読込 → 共通の画像候補 → 同じ会話欄のカード
                                                      ↓ ユーザー採用
                                  既存の画像資産登録・レイヤー追加・Undo/保存
```

| 値・操作 | 正本と更新入口 | 発生させない副作用 |
|---|---|---|
| ローカルモデル・VLM・ComfyUI接続 | `localModelPreferences.ts` の既存reader/writer | 作品clone、Undo、ディスク保存、モデル自動取得 |
| 画像生成の方式・確認省略 | `generationPreferences.ts` の既存reader/writerを拡張 | 作品変更、設定保存だけで生成開始 |
| 会話・翻訳の方式 | 小さな `conversationPreferences.ts`。ローカルモデル値は既存設定を参照 | llmAliasの二重保存、画像生成方式との一括切替 |
| 接続・認証 | bridge側の登録台帳と資格情報保管。ブラウザーは接続ID・表示名・利用可能な機能を参照 | キーの作品/ZIP/localStorage/ログへの混入、用途ごとの二重登録 |
| プロンプト編集 | `useGenerationPromptReview` の一つのdraft。手入力・会話ツールが同じ更新関数を使う | 古い会話応答による上書き、相談だけで生成、原文の破壊 |
| 確認済み入力 | bridgeで検査したsnapshot。入力revisionと内容hashを持つ | 確認後の再翻訳、日本語の追記、別対象への承認流用 |
| 受信画像候補 | 会話コンポーネント外のworkspace側store。Blobと受信IDを保持 | 受信だけで原稿変更、会話履歴の切り詰めによる画像消去 |
| 採用した画像 | 既存の画像資産store＋document／paint更新関数 | 別Undo、候補終了による採用資産の削除 |

正規化・翻訳・最終検査の正本はbridgeに置く。ブラウザーにも別の翻訳判定・正規化実装を作らず、表示・編集・取消しを担当させる。純粋関数はHTTP・UI・モデル起動を参照しない。

設定の読み書きは既存形式へ必要最小限の追加を行う。新規設定の既定は会話ローカル・確認省略OFF。既存設定を推測してAPI利用へ切り替えない。作品データの移行、複数形式への二重書き込み、開発用の古い設定を守るための汎用migrationは追加しない。

### 作成・抽出するモジュールの候補

以下は責務の割当案。実装時に同じ責務の既存moduleがあればそこへ集約し、表の全ファイルを機械的に新設しない。

| 予定path | 主な責務・関数 | 行数の目安 |
|---|---|---|
| `src/components/settings/ModelSettingsPanel.tsx` | 二つの用途区画と詳細設定の構成 | 180〜300 |
| `src/components/settings/ModelConnectionFields.tsx` | 接続選択・追加・状態表示。保存と通信はcallback | 150〜250 |
| `src/components/settings/useModelSettings.ts` | 既存reader/writerへの接続、保存成功後の状態確定 | 150〜250 |
| `src/lib/conversationPreferences.ts` | 会話・翻訳の接続参照の読込・保存 | 80〜150 |
| `src/lib/modelRouting.ts` | `resolveConversationRoute`、`resolveGenerationRoute`。純粋な実行先解決 | 120〜220 |
| `src/components/generation/useGenerationConversation.ts` | 既存 `runGenerationConversation` と共通draftの接続 | 150〜250 |
| `src/components/generation/useGenerationPromptReview.ts` | draft/revision・確認・取消し。`requestPromptReview`、`approvePromptReview` | 200〜350 |
| `src/components/generation/GenerationPromptReview.tsx` | 本文・参照役割・negativeの全文表示と編集UI | 180〜300 |
| `src/components/generation/GenerationCandidates.tsx` | 候補表示の抽出。採用・削除処理は親callback | 150〜300 |
| `src/lib/generation/promptReview.ts` | 入力・snapshot・状態遷移の契約と純粋な判定 | 150〜250 |
| `src/lib/generation/submission.ts` | `submitGeneration`。確定入力を一つの生成先へ渡す | 180〜300 |
| `scripts/prompt_segments.py` | 指示・描画する文字・識別子・構文・既存英文の分離/復元 | 200〜350 |
| `scripts/prompt_normalization.py` | `normalize_prompt_segments`、保護領域を除く日本語検査 | 120〜220 |
| `scripts/prompt_translation.py` | `translate_prompt_segments`。固定の英文依頼、既知の定型訳の再利用 | 200〜350 |
| `scripts/generation_prompt_review.py` | `prepare_prompt_review`、`validate_prompt_snapshot`、入力との照合 | 200〜350 |
| `scripts/model_connections.py` | 接続台帳・対応機能・接続IDの解決 | 180〜300 |
| `scripts/model_credentials.py` | 実行Macの資格情報の登録/参照。API応答へ秘密値を戻さない | 100〜200 |
| `scripts/conversation_transport.py` | 会話/翻訳の共通要求・文章/画像/ツール応答の契約 | 120〜220 |
| `scripts/*_transport.py` | 対応する一通信方式の要求作成・応答変換。モデルごとのファイルは作らない | 各200〜350 |
| `src/lib/receivedImages.ts` | `createReceivedImageStore`、候補状態・重複防止・Blob寿命 | 150〜250 |
| `src/components/agent/ReceivedImageCards.tsx` | 拡大・保存・採用のUI。原稿を直接変更しない | 150〜250 |
| `src/components/workspace/workspaceImageAdoption.ts` | `resolveImageAdoptionTarget`、`adoptReceivedImage` | 200〜300 |

新しいHTTP処理は既存bridge transport・identity確認・LAN proxyを通す。`nyamuru_bridge_http.py`へ処理を詰め込まず、必要なhandler moduleへ委譲する。新規routeは、既存の会話・ジョブAPIでは担えない「送信前の確認」「接続登録」等に限定する。

## 4. コミット単位と実装順序

表の各IDは、レビュー可能で関連確認が通る一つのcommitの目安。変更量が大きければ責務単位でさらに分け、壊れた中間状態や未追跡helperに依存したcommitを残さない。P0以外は依存順に進める。

| ID | 依存 | 成果とコミット名の案 | 最小限の合格条件 |
|---|---|---|---|
| P0 | 担当者の統合状況 | `Verify integrated generation conversation`。`9078540`の統合確認と正本の基準記録。差分がなければ空commit不要 | 生成後相談で候補保持、実変更は次の入力、閉じると編集会話へ戻る。生成の採用・削除修正と共存 |
| P1a | P0 | `Extract model settings panel`。モデル区画・既存設定更新だけ抽出 | 選択・入力・保存失敗の表示が同じ。他タブ・作品・Undoに変更なし |
| P1b | P0 | `Extract generation conversation and candidate views`。会話接続・候補表示を抽出 | 会話、5候補、複数採用、履歴削除、取消しの結果が同じ |
| P1c | P0 | `Extract generation prompt translation`。生成英訳を人物アクションから抽出 | 固定応答に対する入力/出力・文字保護・エラーが同じ。人物アクションの呼出は不変 |
| P2 | P1a | `Separate conversation and image execution settings`。用途別の保存契約と実行先解決、設定区画を接続 | ローカル既定、既存の外部受け渡しが維持される。APIは対応完了まで利用不可。保存失敗で実行先を変えない |
| P3 | P1c | `Normalize and protect generation prompt segments`。共通の保護・正規化・検査を作る | 記号だけなら翻訳0回。英文・描画文字・識別子を保持。不正な翻訳は送信不可 |
| P4a | P3 | `Prepare immutable prompt review snapshots`。最終指示を作る確認APIとsnapshot | 準備だけで画像生成0件。編集・対象変更で古いsnapshotを拒否 |
| P4b | P4a | `Separate prompt review from generation submission`。確定入力を既存ジョブへ接続し、利用セッションを分離 | 再翻訳なし、表示した最終指示と送信値一致。結果不明の照合と取消しを維持 |
| P5 | P1b・P2・P4b | `Add editable prompt confirmation`。確認UI・共通draft・会話編集・省略設定を接続 | ON/OFF、はい/いいえ/閉じる、相談、遅延応答、連打を実UIで確認 |
| P6a | P5 | `Apply prompt review to reference workflows`。3枚参照・汎用ワークフロー・negativeを接続 | 各送信payloadに未翻訳指示の抜けなし。参照枚数・順序・画像bytesは保持 |
| P6b | P6a | `Apply prompt review to lettering and handoff`。描き文字・写植・作画用ラフ・外部受け渡しへ接続 | 描く文字は原文、自由指示は英語。ZIP内の実行指示も確定文と一致 |
| P7a | P1b | `Share image layer insertion`。現在対応している対象の新規追加を、振る舞いを変えずに抽出 | 通常画像読込の既存仕様を維持し、生成画像は元絵を置き換えない |
| P7b | P7a | `Retain received image candidates`。候補store・共通応答契約・手動読込入口 | 画像のみ/混在/複数枚を保持。重複通知1候補、原稿変更0回 |
| P7c | P7b | `Display received image cards`。同じ会話欄で表示・拡大・保存 | 折りたたみ・履歴上限・生成画面close後も候補を表示可能。採用は接続完了まで無効 |
| P8 | P7c | `Adopt received images through workspace history`。取り込み先確認と明示採用 | ペイント開閉両方で新規追加。連打1回、1回のUndo/Redo、保存再読込、失敗時保持 |
| P9a | P2・P8 | `Register reusable model connections`。接続台帳・資格情報保管・選択欄の登録を接続 | 同一接続を両用途で再利用。設定保存からモデル呼出なし、秘密値の返却なし |
| P9b | P6b・P9a | `Route conversation and translation through selected connection`。まず一通信方式のadapterを有効化 | 会話・翻訳は指定先だけ。API時のローカル文章LLM起動0回。画像応答は候補へ渡る |
| P10 | P9b | `Submit approved prompts to image APIs`。明示画像API生成と共通候補へ接続 | 確認済み入力を1回だけ送信。既存ComfyUIの候補数・削除規則を流用しない |
| P11 | P10 | `Record model routing acceptance checks`。実利用確認と最終仕様・結果更新 | 利用者UI確認後に既存の全体検証。模擬/実API/実モデル/LANを分けて記録 |

P1a〜P1cは変更とテストの抽出だけに限定する。振る舞いの修正が必要なら、抽出commitに混ぜず次の段階で扱う。APIを実際に有効にするP9bより前に、画像のみの返答を失わないP7・P8を完了させる。

## 5. 段階ごとの実装上の要点

### P0〜P2 基準、分割、設定

新しい実装用worktreeは、会話修正の正本統合を確認してから作る。既存claimが重なる間に生成画面を編集しない。統合の際も候補採用・削除処理を古いworktreeの内容で上書きしない。

`ModelSettingsPanel`は「会話・翻訳」「画像生成」の二つの区画と、一つの確認省略欄を構成する。名前・顔・口調・音声は既存 `AgentSettings` を再利用し、VLM等は詳細へ置く。新しいタブは追加しない。

値を複製した設定objectを常用せず、既存writerで成功した値をUIへ確定する。編集中の不正値を保持する場合も保存済み実行先と区別する。設定変更は次の依頼から適用し、実行中のrouteは変えない。

P2では未接続APIを対応済みに見せない。確認省略欄もP5で動作が接続されてから操作可能にする。既存のクラウド利用条件は `modelPrivacy.ts` の責務として保持し、接続先の選択と混ぜて削除しない。

現行の `cloudModelAccess` は画像生成の `execution` を参照するため、会話APIへそのまま使わない。送信先は用途ごとのrouteで判定し、作品の利用条件は共通の判定へ分離する。「会話API＋ローカル画像生成」が画像側の選択で拒否されず、必要な利用条件も迂回しないケースを試験する。

### P3〜P4 指示の確定と送信の分離

生成用の本文・追加指示・参照役割・negativeを揃えてから、構造化したフィールドとして扱う。画像に描く原文・ファイル識別子・制御構文は入力の出所に基づいて保護する。全文へのNFKCや非ASCII一括除去で代用しない。

固定英文は既存定型訳を使い、日本語部分だけを翻訳する。既存英文、同じセリフの複数出現、特殊トークン、参照順序を照合できる形で残す。保護領域の欠落・重複、日本語の残存、空や不正な応答では理由を示す。意味の正しさは機械検査だけで保証した扱いにしない。

確認用snapshotには少なくとも次を結び付ける。

- 本文、negative、参照役割を含む実送信の全文と、編集元のrevision。
- 作品・ページ・対象フォルダー、参照画像の識別/hash、出力寸法・配置条件。
- 生成先・モデル/ワークフローのIDと版、確定が必要な生成条件。
- 翻訳/検査の結果と内容hash。ブラウザーの `translated: true` 等だけを信用しない。

snapshotのhashは確定・再検査時に計算し、毎入力で作品全体をserialize/hashしない。確認済み値は既存ジョブstoreへ引き継ぎ、ジョブの不変入力保存と照合を再利用する。同じjob IDへ編集後の別内容を書き戻さない。送信前draftを生成ジョブの実行済み状態と混同しない。

現行の `withImageGenerationServices` の内部で確認ダイアログを待ち続けない。翻訳利用を終えて確認待ちへ入り、承認後に必要な生成利用を開始する。確認待ち中はLLMを休止させず、単語相談に使える状態を保つ。画像生成開始前の接続・メモリ確認と、終了時の復帰・所有者判定は既存経路を通す。

P4bは入力snapshotと既存送信処理を接続する段階であり、候補選択・出力削除・ComfyUI取消しを作り直す段階ではない。通常のローカル経路で固定入力の送信一致を確認してからP6で対象を広げる。

### P5〜P6 確認画面、編集、全経路への適用

確認の状態は `editing → translating → reviewing → submitting` を基本とし、生成ジョブの `running` 等とは分ける。翻訳不要の初回英語入力、および確認省略ONは検査成功後に送信へ進める。翻訳・検査失敗は理由付きで編集へ戻す。

- OFFでは翻訳後の全文を表示し、はいでそのsnapshotを送る。いいえ/閉じるでは全文を編集へ戻す。
- 手入力と `generation_prompt_edit` は同じdraftを更新する。会話開始時のrevisionが変わった応答は勝手に適用しない。
- 編集後の送信は再検査・再確認する。日本語が追加されたら必要部分を翻訳する。既存英文をLLMに作り直させない。
- 本文だけでなくnegative・参照役割も確認/編集対象にする。編集しない識別子は読み取り専用の契約で保持する。
- 対象・参照・実行条件を変更したら古い確認を無効にする。表示中に設定をONへ変えても自動送信しない。
- 生成後の相談では完成候補を保持する。実変更は次の入力に適用し、実行中・結果不明のjobを無断で作り直さない。

各経路のbuilderは指示の収集と固有の構文を担当し、翻訳・承認の入口は共通化する。最終的なモデル用指示を確認後に別builderで再構成しない。構文の埋め込みが必要な場合は確認前に確定する。

| 接続する経路 | 個別に確認する内容 |
|---|---|
| 通常ローカル生成 | 既知の定型文・資料説明・negativeと実送信値が一致 |
| 人物3枚参照 | 日本語の演技・外見・作画指定を翻訳。3画像の役割と順序、寸法を維持 |
| 取り込みワークフロー | `plain`のまま検査を迂回しない。固有の画像トークンを無断で追加しない |
| 描き文字・写植 | 描く文字は日本語のまま。描き方の自由記述とnegativeを翻訳 |
| 作画用ラフ | 独立している送信入口にも同じ確定処理を接続 |
| 外部エージェントへのZIP | 確定した実行指示を収録。送信確認の完了操作はZIP書き出しとし、外部チャットへ自動送信しない |
| 画像API | P10で同じsnapshotを使う。provider固有の要求への変換で指示を書き換えない |

### P7〜P8 受信候補と既存画像追加の接続

共通応答は文章・画像part・ツール呼出を区別する。画像のみを「返答なし」で捨てず、文章の「生成しました」だけでは画像扱いにしない。翻訳応答に画像が混ざった場合も、まず候補を受け取り、その後に文章の検査・確認を進める。

最終返答だけでなく、ツール往復の各応答に含まれる画像partも受け取る。画像取得・保存の成功と、会話ツールの成功は別に記録する。遅延して届いた画像を保持しても、失効した編集ツールや古い送信承認は復活させない。

候補は `sourceRequestId + responseId + partId` 等で識別し、同じ応答の再通知を重複表示しない。別応答の同じ画像をSHAだけで同一候補へ潰さない。状態は `receiving / ready / adopting / adopted / failed` を基本とする。

`AgentConversation`は折りたたみ時にunmountし、文字履歴は24件に制限される。候補storeはこの寿命から分離し、同じ会話欄の候補一覧から再表示する。生成画面closeでも候補を失わない。作品切替時には発生元を保持し、新しい作品へ自動的に採用しない。

未採用Blobは作品用 `figureCropStore` へ先に入れない。作品・Undoから未参照として回収されるためである。候補容量は単体・画素数・総量を制限し、上限時には理由を示す。対応形式・上限を決めて試験へ固定する。現行 `prepareImageAsset` はPNG/JPEG・48MiB以下なので、WebP等の変換/非対応表示を採用前に決め、未知の形式をそのまま原稿へ渡さない。

既存の `insertQwenImage` から、追加先を検査してレイヤーを追加する部分を `insertImageLayers` 等へ抽出する。生成画面close・ジョブ採用通知は薄い生成adapterに残す。新しい候補側から生成ジョブIDを偽造しない。

P7aは既存対象の不変抽出に限定し、対象種類を増やす判断はP8で行う。現行 `importPlacedImage` は人物/文字の指定がない `scope: 'panel'` を背景へ配置する分岐を持つ。`generatedOwner`を渡すだけで汎用化できたと扱わない。P8では人物・文字・背景・コマ・ページ・原本の対応範囲を明示し、`owner.kind`ごとに既存 `applyOwnerPaint` 等の更新先を使う。未対応先を別の場所へ代替しない。

- ペイント表示中は既存 `paintController.insertImage` を使い、置換せず追加する。
- ペイントを開いていないときは `importPlacedImage` の資産準備・失敗回収を再利用し、`insertGeneratedPaintImage` の新規追加側へ接続する。
- 追加先はページ・owner・folder IDで検査する。古いindexや受信時の選択から勝手に決めない。画像準備中の対象削除・作品切替でも変更を適用しない。
- 原稿変更は既存の一回のcommit/`setDocument`へ集約する。既存の履歴境界・64レイヤー制限・描画領域拡張・保存を維持する。
- 採用失敗は候補をreadyへ戻して再試行可能にする。採用成功receiptを残し、連打や再通知で追加し直さない。
- Undo後の復元は既存Redoが担当する。候補の採用状態を自動で未採用へ戻して再追加しない。再取り込みを許す場合は別の明示操作・採用receiptとして区別する。

「画像を保存」は画像ファイルの保存だけで、原稿を変更しない。候補の破棄・終了でobject URL等を解放しても、採用済み資産やUndo/Redoが参照する原本を消さない。初期版ではアプリ終了・再読込後の未採用候補復元は実装しない。

### P9〜P10 API接続と実行

最初に対応するサービス・通信方式を一つ決め、実装時の公式仕様で認証、ツール、画像応答、結果照合の方法を確認する。計画段階では特定のモデル名や対応済みサービスを固定しない。多機能なAPIを登録禁止にせず、用途ごとに実際の要求を組み立てる。

接続とキーは実行Macで一度登録する。秘密値はMac側の資格情報保管へ置き、通常のLANクライアントには接続参照のみを渡す。登録時の書込み専用入力も実行Mac側に限定し、読出APIは作らない。既存bridgeのidentity検査とLAN許可pathを保持し、LANへ公開する新routeを個別に試験する。

`withAgentServices`を無条件なローカル文章LLM起動から用途別に分岐させる。ローカル会話は既存利用セッションを通し、API会話はbridgeの通信利用だけにする。人物アクション・VLM・音声分類へこの分岐を広げない。画像生成のメモリ/所有者管理は別に維持する。

各adapterは共通応答へ変換し、会話・翻訳の画像partをP7の候補へ渡す。英訳を頼んで画像だけ返ったら、候補を表示して翻訳未完了を示し、後続生成は0件。画像取得の再試行は取得要求だけに限定し、生成や会話の依頼全体を再送しない。

明示画像API生成も、接続ID・モデル・確定入力・送信IDを固定する。応答が失われた場合は対応APIの照合機能を使い、照合できなければ結果不明を示す。自動再送・別サービスへの切替はしない。ComfyUI固有の5候補・透過・出力削除はAPI候補へ適用しない。

## 6. 検証の組み立てと合否

各ケースのそばへ「見込み・合格条件・確認範囲」を書く。既存試験を拡張し、固定応答で確認した本体挙動と、実モデルの意味・品質を分ける。今回の計画作成では下記の試験は実行していない。

| 段階 | 再利用する主な試験 | 追加する観測 |
|---|---|---|
| P0〜P2 | `environmentSettings.test.mjs`、同browser fixture、`generationPreferences.test.mjs`、`localModelPreferences.test.mjs`、`modelPrivacy.test.mjs`、統合後の生成会話試験 | 保存再読込・失敗、区画選択、作品更新/Undoが0回、生成後相談の候補保持 |
| P3〜P6 | `test_qwen_generation_bridge.py`、`test_nyamuru_three_image_workflow.py`、`generationHandoff.test.mjs`、`localBridgeLifecycle.test.mjs`、既存生成browser fixture | 保護領域比較、翻訳/送信件数、実payload、待機中のleaseと取消し |
| P7〜P8 | `agentSession.test.mjs`、`imagePlacement.test.mjs`、`workspaceHistory.test.mjs`、`projectPersistence.test.mjs`、`portableProject.test.mjs` | 新規追加/非置換、資産寿命、1回のUndo、保存往復、失敗回収 |
| P9〜P10 | `agentChat.test.mjs`、`test_agent_chat_bridge.py`、`localBridgeLifecycle.test.mjs`、`lanServer.test.mjs` | 単一送信先、toolの権限、秘密値非返却、API応答の画像、非対応機能の表示 |

新しいケース群は `promptReview`、`promptNormalization`、`receivedImages`、`imageAdoption` 等、役割名で分ける。既存のモデル名付き試験を全面改名する作業はここへ混ぜない。

### 必須の回帰・受入ケース

| 見込み・入力 | 合格条件 | 確認範囲 |
|---|---|---|
| 抽出だけなら挙動を維持できる | 既存の会話・手動画像読込・5候補採用・削除再試行・閉じるの結果が同じ | 既存の本体試験＋該当UI。外部処理は固定応答 |
| 全角記号だけの指示はコードで整う | 指示の指定文字だけ置換、翻訳0回。セリフ・ファイル名・構文は不変 | 正規化の入出力比較 |
| 混在言語は一部だけ翻訳できる | 日本語部分を翻訳し、既存英文/繰返しセリフ/識別子を保持。欠落・重複で送信0件 | 固定翻訳応答、各builderと実送信payload |
| OFFの確認は送信を止める | 全文表示中は生成0件。はいは表示内容を1回、いいえ/閉じるは編集へ | 実UI、HTTP呼出件数 |
| ONでも失敗は送信されない | 成功後だけ生成1件、確認窓0回。翻訳失敗・日本語残存・画像のみでは生成0件 | 実UI、成功/失敗の模擬応答 |
| 編集中の相談は同じdraftを使う | 最新の本文/negativeを相談でき、古い応答は反映しない。英語だけの再編集も再確認 | 実UI、遅延する会話/翻訳応答 |
| 承認は対象と一体である | 作品・参照・folder・設定の変更、取消し、連打で古い入力を送らない | revisionと送信payload照合 |
| 画像受信だけでは原稿は変わらない | 文章のみ/画像のみ/混在/複数枚を表示。原稿commit・後続生成0回 | 共通応答decoderと実UI |
| 候補は履歴とは別に保持される | 24件超え・折りたたみ・生成画面close後も残る。同じ応答は1候補 | 本体storeと実UI |
| 明示採用は追加のみを行う | ペイント開閉両方で指定先の最上段へ1追加。元絵・表示・ロック維持、Undo/Redo各1回 | 合成PNGを実編集経路へ入力 |
| 対象種類を指定すれば誤配置を防げる | 対応するownerだけへ追加。無関係な背景・ページ画像・他ownerは不変。未対応先は理由を示して変更0回 | owner.kind別、ペイント開閉両方の実配置経路 |
| 失敗しても画像を失わない | 画像準備中の対象変更、容量超過、資産登録失敗では原稿変更0回、候補保持 | 実配置経路の失敗注入 |
| 採用資産の寿命は作品が持つ | 候補解放後もUndo/Redo可能、保存/再読込後の画像hash・配置一致 | 既存serializerの往復、保存失敗も確認 |
| 会話API＋ローカル生成を分離できる | 英訳は指定APIだけ、生成はComfyUIだけ。会話のローカル文章LLM起動0回 | 模擬通信と起動管理呼出。実機とは区別 |
| 同じキーでも用途を混同しない | 接続登録1件、用途ごとの要求。予期しない画像は候補へ、無断の追加生成0回 | adapterの実payload、正式な応答fixture |
| 実モデルが意味を保つ | 人物動作・否定・構図・描画文字・参照役割を保持し、不要な補作がない | 選択した実モデルの応答内容レビュー |

### 実行する順序

1. 各commitで、変更したmoduleの型/構文と関連するNode/Python試験を実行する。テスト入口は現行ファイルを確認し、関連ケースに絞る。
2. UI段階は既存browser fixtureで実コンポーネントを操作する。LLM/画像APIを模擬した場合は、その範囲を結果に明記する。
3. 利用者が新しい設定・確認・画像採用の画面をチェックする。通常とLANの両方で確認し、実際の別端末確認は模擬LAN成功から推定しない。
4. 実サービスの接続先・モデル・使用画像/指示が決まってから、最小限の実API/実モデル確認を行う。料金や必要な認証設定は実行前に確認する。設定保存の試し打ちで生成しない。
5. 利用者UI確認後に `npm run verify`（型チェック・既存全件試験・通常/standaloneビルド）を正本で実行する。新たな失敗/変更がなければ全体検証を反復しない。

## 7. Git運用と戻し方

一つのcommitに「一つの責務の変更＋関連試験＋必要な仕様記録」を含める。抽出、設定、翻訳規則、UI、API adapter、画像採用をまとめてcommitしない。P1〜P6をローカル機能の確認区切り、P7〜P8を受信・採用の確認区切り、P9〜P10をAPI利用の確認区切りとする。

- 各段階の開始前に、既知の回復点となるHEADと未commit差分を確認する。失敗があれば次段階へ進めず、その段階で修正する。
- `git status --short`、unstaged全差分、staged差分を確認し、担当pathだけをstageする。全件stageや他作業のstash/resetはしない。
- 分離worktreeの変更はレビュー済みcommit単位で正本へ統合する。正本での関連確認結果も記録する。push・公開は別の依頼時だけ行う。
- 不具合時は該当機能の利用を止め、依存する後続commitから逆順にrevertする。共有履歴のresetや、設定/原稿の一括巻き戻しで対処しない。
- 受信候補や原稿資産を破壊して戻す設計にしない。API接続の無効化と資格情報の削除、画像採用のUndoと生成結果の削除を別操作として扱う。

## 8. 実装時に決める事項と完了記録

P9で最初に対応するAPI/通信方式、実行Macでの資格情報保管方式、P7での画像対応形式と単体/総容量/画素数上限は、実装前に現環境と正式な仕様を確認して確定する。未決定のまま「汎用API対応済み」としない。これらの確定待ちでも、P1〜P8のローカル実装・模擬検証は進められる。

| 区切り | 状態 | commit | 関連試験 | 利用者UI確認 | 実モデル/API/LANの未確認事項 |
|---|---|---|---|---|---|
| P0 基準確認 | 正本統合・関連確認済み | `69087fc` | Node73・Python23成功、変更TS5file診断0、会話browser成功 | 待ち | 実モデルの応答品質・別LAN端末は未確認 |
| P1a 設定の抽出 | 実装・設定試験の追従・関連確認済み | `027ae20`＋下記の試験追従 | 設定/作画設定のNode45件全成功、抽出時の設定browser確認済み | 待ち | ファイル選択完了は模擬callback。実OS選択画面は対象外 |
| P1b 会話・候補表示の抽出 | 実装・準備案内の補修・関連確認済み | `116db67`＋下記の補修 | 補修後Node93成功、会話browser成功、候補browser7ケース・38検査成功 | 待ち | 生成・LLM・PNGは模擬。実ComfyUI起動・実モデル応答は未確認 |
| P1c 英訳の抽出 | 実装・関連確認済み | `764640f` | Python48成功、翻訳本体AST一致、package/standalone import確認 | 対象画面の変更なし | 実LLMの英訳品質は未確認 |
| P2 用途別設定 | 実装・関連確認済み | 下記のP2実施記録 | 関連Node122件成功、変更TS9file診断0、設定/会話browser確認 | 待ち | APIは無効。実モデル・別LAN端末は未確認 |
| P3〜P6 ローカル英訳・確認 | 未着手 | — | — | — | — |
| P7〜P8 画像受信・採用 | 未着手 | — | — | — | — |
| P9〜P10 API利用 | 未着手 | — | — | — | — |
| P11 統合受入 | 未着手 | — | — | — | — |

### 2026-11-05 P0〜P1の実施記録

- 正本の開始点は `42232e9`。会話修正 `9078540` を `69087fc` として統合してから分割。設定と英訳は別worktreeのSol・medium担当へ分業し、親が全差分を読み、正本へ反映・関連確認・責務別commitを行った。
- 設定は既存reader/writerとhookの状態寿命を保持。`EnvironmentSettings.tsx` は379→290行、抽出先のpanel79行・hook37行。テストは既存loaderを抽出先へ接続し、assertは変えていない。既存テストファイルは781→807行で、責務別分割は今回に混ぜていない。
- 会話は既存の `runGenerationConversation` と `createGenerationActions` へ接続する `createGenerationConversation.ts` に抽出。effectの依存と登録・解除は親に残し、hookや別の状態正本を増やしていない。候補表示はstateを持たない `GenerationCandidates.tsx` へ移し、状態表示の文言を履歴と共用。`ImageGenerationDialog.tsx` は411→392行。採用・削除・終了・履歴の処理本体は抽出前と文字列一致、別担当の読取専用レビューでも動作変更の指摘なし。
- 英訳本体を `prompt_translation.py`（88行）へ移し、`PanelActionSuggester` は既存JSON通信をcallbackとして渡す。定型文・文字保護・検査・例外は変更していない。`nyamuru_panel_actions.py` は369→298行。親でもcallback参照の置換を除くAST一致を確認した。
- 正本の関連確認は、会話/生成/agentのNode73件、英訳・文字保護のPython28件、人物アクション20件が成功。変更TS6fileの型・構文診断0件。`generationConversation.browser.html` は生成→相談→5候補保持→英訳反映→再生成→閉じる→編集会話の成功表示を確認。`environmentSettings.browser.html` はLLM名変更、別タブ往復、保存値で再表示、クラウド区画表示、作品変更0回を確認。ブラウザーはLAN環境指定のVite fixtureであり、別の物理LAN端末や実モデルの試験ではない。

次の2件は利用者の「疑問・気になる点は区切りで止めて提案」という指示に従って未修正とし、P2へ進む前の提案事項にする。

1. `environmentSettings.test.mjs` の「ファイルと標準設定はOFFの候補を追加し…」は、`ArtworkSettings` が `ProjectFileInput` を使う一方で、試験が生の `input[type=file]` を探して失敗する。変更前のloaderでも同じ失敗を確認。現行のファイル選択callbackへ試験を接続し、既存の本文・NDM非変更のassertを維持する修正を提案する。
2. `qwenCandidates.browser.html` は分割前 `69087fc` と分割後の両方で「ワークフローを確認しています」で失敗。生成ボタンの有効化を待ったあと会話callbackを直接呼ぶ箇所と、effectでのcallback更新タイミングの調査を提案する。現時点では試験だけの問題か製品側にも影響するかは未確定。候補採用・削除再試行・Undo/Redoを今回すべて合格したとは扱わない。

全体build・全件試験は未実行。上記の局所確認を解決し、利用者の画面確認後に全体検証を提案する。API実呼出、モデル取得、ユーザー所有サーバーの再起動、pushは行っていない。自起動ViteのPID42250（4348）・PID51625（4349）は終了し、待受ポートの解放と検証4タブの終了を確認した。

`README.md`・`Header.tsx`・`workspace-and-page.css` の別作業差分はSHA-256一致で保持。専用worktree `Comic_image_Hub-model-settings-20261105` と `Comic_image_Hub-prompt-translation-20261105` は統合済み差分の控えとして残る。正本との全対象file一致を確認しており、そこに未統合の製品変更はない。

関連: [会話・生成の採用仕様](AGENT_MODEL_SPEC.md)／[ComfyUI接続仕様](COMFYUI_WORKFLOW_SPEC.md)／[生成画像と既存レイヤーの独立](2026-10-29-generation-layer-independence.md)／[開発データ方針](2026-10-27-development-data-policy.md)

### 2026-11-05 生成準備の案内

- 利用者から、準備前の生成依頼にはコード側の未準備情報をエージェントへ渡して案内する指定を受け、`15306c6` を基点に補修した。P2以降と設定試験の別問題には進んでいない。
- `generation/readiness.ts` に、ワークフロー・キャラクター設定画・3Dポーズ・ネーム表情・現在の処理・前回生成の判定を集約し、生成ボタンと会話で共用。既存payload検査も共用して、参照枚数不一致や空の指示を案内へ回す。準備判定自体はモデルを起動せず、ComfyUIは明示依頼を受け付けてから既存の起動経路で開始する。
- 通常の未準備時は、`requestAccepted=false` と未準備箇所の名称・理由・待機/要修正の区別を既存の生成会話へ渡す。案内中は編集不可。LLMが失敗した場合はコードの情報で返す。未受付の依頼をキューへ残したり、準備完了後に自動再送したりしない。
- 会話callbackはhookの最新refへ接続した。会話から開始した生成を待つ間も文字・音声入力を受け付け、同期の状況取得だけで返答する。起動・画像処理中の問い合わせでは追加生成もLLM起動も行わず、元の生成結果を引き続き履歴へ返す。画像採用・削除・Undo・保存処理は変更していない。
- 関連Node93件・Python23件が成功し、変更TS9ファイルの構文/型診断は0件。正本Chromeで、未準備理由をLLMへ渡すこと、読込完了だけでは生成0回、会話からの明示再送、ComfyUI起動中の追加入力、古いsender、生成後相談・英訳・再生成・編集画面復帰を確認した。`qwenCandidates.browser.html` は変更せずに7ケース・38検査成功。いずれもHTTP/LLM/PNGは模擬で、実モデルの案内品質・実ComfyUI起動・実マイク・別端末は未確認。
- 独立レビューの2指摘（会話開始時のpendingと参照枚数の判定）を修正後、再レビューで重大な指摘なし。`ImageGenerationDialog.tsx` は395行。`README.md`・`Header.tsx`・`workspace-and-page.css` の既存差分はSHA-256一致で保持。
- 検証Vite（正本cwd、PID15931、ポート4348）は終了・待受解放、検証2タブの終了を確認。ユーザー所有サーバーは操作していない。音声workerの専用worktree `Comic_image_Hub-generation-readiness-voice-20261105` は統合前の控えとして保持し、追加修正を含む正本を現行とする。未統合の製品機能はない。全体build・全件試験は利用者UI確認後、pushは未実施。

### 2026-11-05 設定試験のファイル選択部品への追従

- 利用者の指定により、`c021160` を基点に `environmentSettings.test.mjs` の既存失敗を修正。浅いコンポーネント検証で、生の `input[type=file]` を探していたため、`ProjectFileInput` 導入後の選択完了へ到達できなかった。
- 子部品を名前付きで模擬化し、現在の `onFiles` callbackへ有効/不正YAMLを渡す形に変更。実際の解析・候補追加処理を通し、更新件数、OFF状態、不正入力時の非変更、本文・NDM保持の既存assertはすべて維持した。テストの見込み・合格条件・模擬範囲を明記。
- `environmentSettings.test.mjs` と `artworkRules.test.mjs` の関連45件全成功、差分check成功。製品コード変更・サーバー起動・実OS選択画面・全体build/全件試験・pushは行っていない。P1時点で残した設定試験と候補browserの2件は、今回までの局所確認で解消した。

### 2026-11-05 P2 用途別設定の実施記録

- 開始点は正本main `c96da70`。`ModelSettingsPanel` を「会話・翻訳」「画像生成」に分け、選択中の組み合わせを表示。プロフィールは会話側、VLMは末尾の詳細に配置。ローカル既定と既存の外部エージェント受け渡しを維持し、APIの選択肢は未接続として無効にした。保存済みAPI値がある場合も黙ってlocalへ切り替えず、案内して停止する。
- 会話の方式・接続参照・モデルは `conversationPreferences.ts` の小さな端末設定に保存。ローカルLLM aliasは `localModelPreferences.ts` の既存値を参照し、二重保存しない。人物アクション統合は引き続き同じローカルLLMを共用する。会話の方式を変更しても、画像生成・VLM・解析の実行先は自動変更しない。
- `modelRouting.ts` に用途別の純粋な解決関数を置き、会話serviceと既存の生成入口へ接続。会話aliasは非同期起動前に固定し、生成前の既存英訳にもaliasを明示する。未対応APIはサービス起動前に拒否。画像handoffは撮影待ち中の実行許可・成人条件の撤回で中止する既存チェックを保持し、別の送信先へ再送しない。
- `modelPrivacy.ts` の作品条件を共通関数へ分離。会話API＋ローカル画像の組み合わせでも、画像の実行先に引きずられず成人条件を判定できる。実会話APIはまだ利用不可であり、P9の有効化時に会話requestの作品条件を実adapterまで接続して確認する。
- `useModelSettings` は既存writerを通し、保存成功した設定だけを実行用UIへ確定。入力途中のローカルモデル値はdraftとして分離した。確認省略は画像設定の既存writerへ追加、既定OFF。P5の確認画面接続まではcheckboxを無効にし、現時点の生成動作は変えない。
- 関連Node122件が成功（最初の121件全成功後、入口拒否1件を追加して変更対象38件を再確認）。保存/復元/容量不足、画像と会話の独立、両APIで起動0、進行中のalias固定、既存handoffの同意撤回を確認した。変更TS9fileの構文・型診断0件。読取専用の別担当レビューでも重大な指摘なし。
- 正本Chromeの設定fixtureで、ローカルLLM入力、画像生成だけを外部エージェントへ切替、外部名の保存、タブ往復、再表示、API/確認省略無効、VLM保持、作品変更0回を確認。設定fixtureは通信を遮断し、実localStorageを使用。新設checkboxの折返しを実画面で見つけ、既存のアイコン付き設定行へそろえて再確認した。生成会話fixtureは未準備案内→明示再送→起動中の追加依頼→5候補→相談/英訳→再生成→編集画面復帰を成功表示。生成・LLM・PNGは模擬で、実モデル品質や実ComfyUI起動の確認ではない。
- `README.md`・`Header.tsx`・`workspace-and-page.css` の別作業差分はhash一致で保持。今回の製品変更はすべて正本で実装し、未統合worktreeは追加していない。実API呼出・モデル取得・ユーザー所有サーバー変更・pushなし。全体build/全件テストは利用者UI確認後に行う。
- 検証用Vite（正本cwd、PID57401、ポート4348）は終了し、プロセスと待受の消失を確認。検証2タブも終了済み。
