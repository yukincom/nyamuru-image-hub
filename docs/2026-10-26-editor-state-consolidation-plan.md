# 編集状態・設定・保存経路の整理計画

作成日: 2026-10-26。対象: このcheckoutのComic Image Hub。

この文書を今回の作業順・判断・検証結果の正本とする。実装済みの仕様説明ではない。各段階の状態を更新し、未実装の予定を利用者向け説明書の現行機能として書かない。

## 1. 利用者の指示と対象

- 既存処理へ集約し、新しい検査層・重複コード・別の保存経路を継ぎ足さない。
- 小さく検証・レビュー・Git commitできる順序で変更する。
- 説明書と仕様を実装へ合わせ、今回の失敗を再発防止スキルへ反映する。
- 独自拡張子 `.nyamuru` と `.omny`、`.omny.yaml` のような用途名を挟む二重拡張子を新規出力に使用しない。中身の形式に合わせた `.yaml` / `.json` と一般的な用途名へ整理する。
- `.nyamuru/` のような先頭ドットの管理フォルダーと、`作品.nyamuru` の拡張子は別物。隠しフォルダーはホーム専用ではない。拡張子整理に便乗して既存の管理フォルダー・作品・原本を削除／一括移動しない。
- push、公開、実作品の自動変換・掃除、モデル導入、既存サービスの再起動は今回の作業に含めない。

## 2. 着手時点と回復点

2026-10-26の確認:

- HEAD: `fa67d31047defe9abc7e9e23d953caf64af4e48a` (`main`, remote追跡に対し1 commit ahead)。
- 既存差分: tracked 163ファイル、untracked 43項目。ステージ済み差分なし。
- 変更済み `App.tsx`、`PaintEditor.tsx`、環境設定、文字・原本分離などが相互依存している。未追跡のライブラリー／テストも依存に含まれる。
- 個別段階の過去の成功報告は、現在の全差分が独立したcommitとして検証済みという意味ではない。

### P0: 先行差分を保護・分類する

1. 全差分と未追跡項目を確認し、今回の先行実装・別作業・生成物を分類する。
2. 対象ファイルの作業前内容を回復可能に保持する。新規の作業コピーが必要な場合は既定の配置ルールに従う。`.codex` 内にアプリ・実行環境を置かない。
3. 所有範囲が明確で整合した先行変更だけ、関係するテストとともに先行checkpointへ分ける。無関係な差分をtreeを綺麗にする目的でcommitしない。
4. commitに含めるコードが未追跡・未commitの別変更へ依存していないか確認する。必要な先行変更を安全に分離できない場合は、実装前に利用者へ判断を求める。
5. この計画のような新規文書は、既存コードの差分を取り込まず独立してcommitできる。

ブランチを作っただけでは未commitの混在は解決しない。自動stash・reset・既存差分の破棄はしない。

2026-10-26、利用者は「必要な先行実装を別commitにしてから進める」を承認した。対象は設定・文字・描画とその依存ファイルのうち、今回の修正に必要な範囲。レビュー・検証して別のローカルcommitへ分ける。学習資料・生成物・無関係な変更は含めず、pushしない。

## 3. 状態の役割と既存の正本

| 役割 | 既存の入口・正本 | 起こしてよい副作用 |
|---|---|---|
| ツール・選択・表示 | `PaintEditor.selectTool`、既存App UI state | UI更新。必要な進行中gestureの終了。作品の同値更新や保存を目的にしない |
| 作品の値 | `MangaDocument`、`canvasText`、`paintGesture`など既存の更新関数 | 実際の編集のみ、共通履歴へ1操作を記録 |
| 描画中の編集 | `PaintSession` / `snapshot` / `paintCheckpoint.flush` | 現在の描画を保持。表示・保存側の必要に応じて既存経路で確定 |
| Undo / Redo | `workspaceHistory` | 作品と描画の一つの履歴。端末設定用の別履歴を作らない |
| 端末設定 | `paintPreferences` / `generationPreferences` / `modelPrivacy`など既存store | 設定の固定key更新。作品の複製・YAML化・保存予約を行わない |
| ブラウザー復旧 | 既存App effect + `storeWorkspaceDocument` | 作品の実変更を保存。サンプル保護とUndo原本の保持を維持 |
| ディスク保存 | `saveProject` / `saveBrowserProject`と各既存writer | 明示保存、必要な原本保持、競合検出、失敗時に編集を残す |

変更前に「残す入口・変更する関数・撤去する重複」をこの文書の結果欄へ記録する。同じ意味の処理を別ファイルへ移しただけで集約完了にしない。

## 4. 監査結果の分類

### 再現済みの不具合・不要処理

- 環境設定の印刷編集draftと即時出力設定が、同じカラー／dpiを別々に更新する。即時変更後に古いdraftを適用すると値が戻る。
- クラウド選択の `execution` と利用可否の `enabled` が別keyへ順番に書かれ、途中失敗時に食い違う。
- ベクター未選択での太さ変更が作品内容を変えず履歴を増やす。同じ文字サイズの再適用も作品全体のclone・履歴追加を発生させる。
- 文字サイズの連続通知がそれぞれ履歴になる。
- 履歴のみの更新でも自動保存effectが走る。通常の保存で新旧YAMLを再解析する。
- シリーズ台帳を無変更でも再書き込みする。シリーズ保存の一時ファイルには失敗時の片付けが不足している。
- 同じ保存フォルダーの再選択でも登録tokenが増える。

### 設計上の負荷・実機計測が必要な項目

- 未確定の描画を持ったままT、ズーム、環境設定へ移るとclose→flush→PNG生成を通る。必要な確定まで単純に取り除かない。
- 64MiBの描画cacheでworking setが容量を超えたときに追い出しが連鎖する。
- ベクター移動、長い一筆、mask／tone／一部色変換で再描画量が増える。
- ガイド画像の読み込み準備と本読み込みが重なる。

### 仕様・説明の不整合、保留

- 現在のOMNY読み込み入口の撤去は既存テストに明記されている。入口がないこと自体を勝手に不具合と判定して復活させない。説明書の「YAMLを開く」「作画設定も書き出す」は現実装と不一致。
- 画像原本storeは参照されなくなった原本を回収しない。ただし自動削除をこの修正のついでに追加しない。共有作品・Undo・旧manifestを含む保持範囲と利用者の了承が必要。
- シリーズ共有原本と作品単体復元用原本は用途が異なる。同じbyteであることだけを理由に片方を削除しない。
- 新規作品の固定4フォルダーは既存制作workflowのもの。ツール持ち替えのたびにフォルダーが増える実装は確認していない。

## 5. 実装・commit順

各行は原則として独立したcommitとする。さらに分ける場合も、未使用helperを先に置くcommit、仕様だけ変えてテストを壊したcommit、別の代替実装を残すcommitは作らない。

### P1: 印刷・出力設定を一つの入口へ

- 対象: `EnvironmentSettings.tsx`、`ArtworkSettings.tsx`、`FinishLayoutSettings.tsx`、必要な既存印刷helper。
- 既存の印刷・原稿設定を編集入口とし、完成画像のカラー／dpiを編集する重複UIを撤去する。出力寸法の表示は同じ正本から導出する。
- 印刷所preset、カラー変更、手動dpiの既存仕様を照合して統一する。別の自動補正を追加しない。
- 検証: `environmentSettings.test.mjs`、`printSettings.test.mjs`、`artworkOutputSettings.test.mjs`、既存 `environmentSettings.browser`。
- 合格: 一つの編集入口、適用／取消しの整合、古いdraftの再適用で別入口の新値を失わない、再表示だけでは作品不変。

### P2: 生成実行先と同意の責任を分離

- 対象: 既存 `generationPreferences.ts`、`modelPrivacy.ts`、環境設定と既存の利用側。
- 実行先は一つの設定を正本とする。成人向け作品の同意は別の意味なので保持する。
- 旧keyが必要な場合は既存load関数内の互換読み込みに限定する。通常操作で二つの有効状態を同期保存しない。
- 保存に失敗した値を有効な設定として扱わない。旧設定の解釈によって未同意のクラウド利用を自動的に許可しない。
- 検証: `generationPreferences.test.mjs`、`modelPrivacy.test.mjs`、`environmentSettings.test.mjs`。
- 合格: local/cloud切替、再読込、保存失敗、旧keyのみ存在、成人同意の保持が一貫する。作品データは不変。

### P3: 同値操作を編集にしない

- 対象: `PaintEditor.tsx` / `paintGesture.ts`、`canvasText.ts` / `textStyle.ts`、Appの既存設定更新関数。
- 正規化後の値と選択対象に基づき、既存更新関数が変更なしを返す。値が同じ場合は元の参照・falseを利用し、呼び出し側が履歴を追加しない。
- 全作品の深い比較、毎操作のserialize／hash、包括的な変更監視を新設しない。
- 見た目が同じ既定値の継承／明示指定、部分書式の解除などは同値通知と同一視しない。既存mutatorの意味上の変更を保持する。
- 検証: `paintGesture.test.mjs`、`canvasTextStyle.test.mjs`、`workspaceHistory.test.mjs`と既存actual-handler試験。
- 合格: 同じ太さ／色／文字サイズ、未選択ベクター、同じコマ設定で内容・Undo・Redo・保存予約が変わらない。実変更は1回反映する。

### P4: サイズgestureを一つの履歴へ

- 既存の履歴境界と `workspaceHistory` を使う。sliderの開始から確定までを1操作とし、表示は入力中に更新する。
- keyboard操作、数値入力のEnter／blur、pointercancel、Undo／Redo、IME入力と対象変更の境界を維持する。
- 検証: `textToolInteraction.browser`、`canvasTextStyle.test.mjs`、`workspaceHistory.test.mjs`。
- 合格: 一操作のUndoで開始前へ戻る。最後の値は確定・保存され、次の別操作と混ざらない。

### P5: ブラウザー自動保存の仕事を限定

- 既存effectと `workspaceStartup.ts` を修正する。保存対象の変更と履歴参照の保持処理を区別する。
- 旧サンプルの保護は既存の起動／作品切替境界へ寄せ、全YAMLの再解析を毎回の保存に増設しない。
- 描画中の一時sceneを保存済みdocumentと誤認しない。未確定編集の警告・明示保存・失敗時復旧を維持する。
- 検証: `workspaceStartup.test.mjs`、`paintSession.test.mjs`、`workspaceHistory.test.mjs`、既存asset lease試験。
- 合格: 履歴のみ・端末設定のみの変更では本文の再保存なし。実編集の保存と再起動復旧、サンプル保護、Undo用原本保持は成功する。

### P6: ツール持ち替えと確定処理を分離

- 変更前に既存 `PaintSession` / `snapshot` / `flush` と、配置画面で必要なPNGの消費箇所を対応づける。
- UI持ち替えは既存状態を再利用する。PNGの必要がない持ち替えでは生成しない。必要な表示・書き出し・保存では既存の確定処理を通す。
- 二つ目の描画session、保存queue、汎用dirty検査機構は作らない。
- 検証: `paintSession.test.mjs`、`projectPersistence.test.mjs`、既存 `textToolInteraction.browser` / `paintPerformance.browser`。
- 合格: ペン→T→ズーム→設定→ペン、ページ切替、Undo／Redo、明示保存、失敗後再試行で内容・選択・表示が一貫。不要なPNG生成回数が減る。
- 単純なclose削除で作品と描画の正本が分裂する場合は実装を止め、既存経路に集約できる設計をここへ追記する。

### P7a–P7c: ディスクwriterの最小修正

別commitで順に行う。

1. P7a: シリーズの無変更保存をskipする。競合revision確認と本当の更新は維持。
2. P7b: 既存の一時ファイルを成功・失敗とも片付ける。保存失敗で直前の成功状態を壊さない。新しいbackup方式は追加しない。
3. P7c: 同じ保存先の選択は既存登録を再利用する。既存tokenの参照を勝手に失効させない。

既存 `test_project_store_bridge.py`、`test_episode_workspace_bridge.py`、シリーズ台帳／背景のbridge試験と `browserWorkspace.test.mjs` を使用する。実作品ではなく一時fixtureで、恒久ファイル数・同内容再保存・例外時の残留・再読込を確認する。

### P8: 標準拡張子・名称と文書の整理

形式変換と名称変更を混同せず、保存データの内容・原本保持は変えない。

| 用途 | 新規出力名 | 形式 | 旧名の扱い |
|---|---|---|---|
| 作品の構成・セリフの書き出し | `作品名.yaml` | YAML | 旧 `.omny.yaml` を説明・互換試験用の入力として保持。読み込みUIの新設は別判断 |
| 作画設定の控え／生成指示 | `作品名-settings.yaml` / `作品名-generation.yaml` | YAML | 既存YAML parserで読む。二重拡張子を新規出力しない |
| LAN側の作品フォルダー保存 | `project.json` | 現行の画像込みJSON | `作品.nyamuru` を既存readerの互換対象にする。二重書き込みはしない |
| シリーズ台帳 | `series.yaml` | YAML | `series.omny.yaml` は互換読み込み。実データの一括改名はしない |
| Mac側の作品フォルダー保存 | 管理フォルダー内の `project.json` | 現行JSON manifestと原本 | `.nyamuru/` は管理フォルダー名として区別。拡張子整理による一括移動・削除はしない |

- 通常保存のJSONと構成書き出しのYAMLは用途が異なる。全形式を無理に一つに作り替えない。
- 新旧両方がある場合の優先・競合条件を既存binding/revision確認に統合し、古い作品を黙って採用・上書きしない。
- 旧作品を開いただけで移動・削除・書き換えない。新規保存でのみ新しい出力名を使う。互換readerを通常writerとして残さない。
- 画面は「構成データ（YAML）」「作画設定（YAML）」「作品フォルダー」など役割を示す。ファイル拡張子を内部データ構造名と混同させない。
- `docs/PROJECT_SAVE.md`、`docs/USAGE.md`、`docs/LAN_EDITING.md`、必要な仕様・サンプル・書き出し名・package分類を同じcommit群で整合させる。
- NDM仕様書・生成prompt・sampleのrepository規則を守り、現行仕様書に更新履歴を混ぜない。移行経緯はこの日付付き文書へ書く。
- 生成prompt本文を変更する必要が出た場合は、利用者の確認前にモデル実行へ進めない。内部symbolの一括改名や無関係な整形はしない。
- 検証: `projectPersistence.test.mjs`、`portableProject.test.mjs`、`browserFiles.test.mjs`、`browserWorkspace.test.mjs`、既存YAML往復／package／bridge試験。
- 合格: 新規名で保存→再読込、旧名の復元、同名衝突、同時編集、失敗後再試行、画像・3D・作画設定の保持。JSONをYAMLだと説明しない。

### P9a–P9d: 描画残件を別commit群へ

1. P9a: maskの枠表示と投げ縄の自動切り詰めを、利用者が指定した範囲とメモリー上の描画領域を混同しないよう整理する。
2. P9b: layer cacheの容量超過時の連鎖的missを既存cache内で解消する。容量を無制限にしない。
3. P9c: ベクター移動・長い一筆・mask/tone/色変換の再描画を既存renderer内で分けて改善する。通常ペンだけの結果を全描画の改善と報告しない。
4. P9d: ガイド画像の重複読み込みを既存画像ロード経路へ集約する。

既存 `paintGesture.test.mjs`、`paintStroke.test.mjs`、`paintColor.test.mjs`、`vectorGesture.test.mjs` と `paintPerformance.browser` を再利用する。画素一致・Undo／Redo・操作回数を確認し、CPU時間と入力から表示までの待ち時間を区別して記録する。

## 6. 共通の検証・commit条件

- 各段階で対応する既存試験を更新する。同じテストfixtureや専用検査アプリを段階ごとに増やさない。
- 本体の変更が必要な意味上の境界でのみ判定する。全UI・全pointerイベントへ同じ検査を重ねない。原本の整合性、権限、競合、入力形式の既存検査は不要処理と混同して削除しない。
- 各commit前に、全unstaged差分・staged差分・statusを確認し、正確な対象pathだけstageする。別作業が同居するファイルは差分を分離できることを確認する。
- commitの説明に「変更した責任」「検証」「未検証」を残す。本体・関連テスト・現行仕様の変更を同じまとまりにする。
- 段階ごとは関連試験、リスクに応じた型検査／UI確認。全段階の統合時に全テスト・型検査・通常／単一HTML buildを実行する。
- 実UIの最終経路: 設定→描画→サイズ変更→持ち替え→Undo/Redo→保存→再読込。Mac・LANはそれぞれの保存形式で確認する。合成fixtureでの結果と利用者の実作品での確認を分ける。
- 自分で起動した検証serverはPID/cwd/commandを記録し、最後に停止とport解放を確認する。既存serverは触らない。
- 必要以上の全域調査を繰り返さず、この計画の依存・合格条件に限定する。新しい問題が出た場合は同じ責任範囲かを判断して追記し、無関係な機能追加へ広げない。

## 7. 再発防止スキル

`editor-state-change-discipline` を個人用Codex skillとして作成する。

- 対象は状態を持つ編集アプリの設定・操作・履歴・保存変更。無関係な作業へ常時監査を課すskillにしない。
- UI操作→正本更新→履歴→派生表示→保存の既存経路を確認し、残す正本を明確にする。
- 無変更操作、重複設定、不要な保存、読み書き非対称、独自形式の増殖を今回の具体的な再発防止条件として扱う。
- 生産コードへ検査frameworkや監視を追加することはskillの実行条件にしない。
- skill形式の検証だけでなく、最小の現実的な変更課題で判断を確認する。必要なときだけ補助資料を持たせる。
- 個人skillの正本はCodexのskill配置先とし、アプリがそこへ実行依存しない。プロジェクトの現行仕様はこのrepositoryのdocsに置く。

## 8. 進捗と検証記録

| 段階 | 状態 | commit・検証・残件 |
|---|---|---|
| P0 計画・先行差分整理 | 着手 | この計画を作成。利用者が必要な先行実装の別commitを承認。既存163 tracked変更／43 untracked項目は保持し、コードの先行checkpoint分離を進める |
| 再発防止skill | 完了 | 個人skillへ配置。公式creatorの形式検証、UI metadata、配置内容一致を確認。独立agentの読み取り専用課題で既存経路・同値更新・履歴境界・Git依存を判断できることを確認し、継承／解除と同値の違いを追記 |
| P1 印刷設定 | 未着手 | P0の分離後 |
| P2 生成先設定 | 未着手 | P1後 |
| P3 同値更新 | 未着手 | P2後 |
| P4 履歴境界 | 未着手 | P3後 |
| P5 自動保存 | 未着手 | P3/P4後 |
| P6 持ち替え | 未着手 | P5後、既存の画像消費を確認してから |
| P7a–c ディスク保存 | 未着手 | 個別commit |
| P8 標準名・文書 | 未着手 | 保存経路の整理後。旧読み込み互換を同時に検証 |
| P9a–d 描画残件 | 未着手 | 設定・保存とは別commit群 |
| 統合検証 | 未着手 | 全体試験、build、合成原稿のUI／保存復元、server終了 |

### 計画・skill段階の結果

- skill正本: `/Users/yukin_co/.codex/skills/editor-state-change-discipline/SKILL.md`。UI metadataは同フォルダーの `agents/openai.yaml`。アプリからの実行依存は作っていない。
- `skill-creator` の `quick_validate.py` で形式検証。標準PythonにPyYAMLがなかったため、既存の解析用Python環境を使用し、依存追加・環境新設はしていない。
- 独立試行は文字サイズ入力／スライダーの修正計画を題材に、実ソースを読み取りのみで確認した。実装や速度の実測ではない。
- この段階ではアプリのコード・実作品・保存形式は未変更。検証serverの起動もなし。
