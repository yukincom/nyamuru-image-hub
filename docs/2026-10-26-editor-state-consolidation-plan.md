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
- 2026-10-27追加指示: 同梱されていた第三者の漫画シナリオを、起動データ・復旧用保管・完成画像・テスト依存から撤去する。実作品の確認は利用者指定のデスクトップ内テストフォルダで行い、アプリへ同梱しない。`no.1.5` は利用者の指示で編集データのみリセットし、`origin_data` の元画像と原文を保持して読み込み直す。

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
| ブラウザー復旧 | 既存App effect + `storeWorkspaceDocument` | 作品の実変更を保存。保存済み作品とUndo原本の保持を維持。同梱物語の保管・復旧は追加指示により撤去 |
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
| P0 計画・先行差分整理 | 完了 | 計画commit `aff26b8`。必要な先行実装196ファイルを分離し、ステージ内容だけの一時コピーで全体verify成功。除外した既存変更・資料は保持 |
| 再発防止skill | 完了 | 個人skillへ配置。公式creatorの形式検証、UI metadata、配置内容一致を確認。独立agentの読み取り専用課題で既存経路・同値更新・履歴境界・Git依存を判断できることを確認し、継承／解除と同値の違いを追記 |
| P1 印刷設定 | 完了 | 印刷・原稿設定へ一本化。重複UI／writerを削除、関連53件・型検査・既存ブラウザーfixtureで検証 |
| P2 生成先設定 | 完了 | 既存generationPreferencesへ原子的な1回保存。旧keyは互換readerのみ。関連73件・型検査・実UI、独立レビュー成功 |
| P3 同値更新 | 完了 | 同値は元document/scene、正規化済みコマ設定はclone前にreturn。関連87件・型検査成功 |
| P4 履歴境界 | 完了 | 既存imageGestureへサイズ操作を接続。関連51件・型検査・実UI成功、独立レビューでP4指摘なし |
| P5 自動保存 | 完了 | 既存writerとeffectへ集約。関連42件・型検査、実UIの保存／復元と原本保持4項目成功。レビューの別タブ原本保護を補修 |
| P6 持ち替え | 完了 | live previewを保持し、作品変更で既存close。関連105件・型検査・実UI・独立レビュー成功 |
| P7a–c ディスク保存 | 完了 | P7a 1566ee3、P7b 24a33cc、P7c 29dd0c7。登録再利用・失敗取消し、Python40件／Node9件成功 |
| P8 標準名・文書 | 完了 | シリーズa9ee62f・YAML書出93396b6・LAN0fb7814。package／ledgerの新旧互換・現行docsを整合 |
| P9a–d 描画残件 | 一部実装・未完了 | P9a既存7ファイル＋記録を `1393d26` へ分離。実UI検証・横方向の過大選択は未完了。先に第9節の実原稿不具合を修正し、P9b–dの性能改善は別途再開する |
| 統合検証 | 未着手 | 全体試験、build、合成原稿のUI／保存復元、server終了 |

### 計画・skill段階の結果

- skill正本: `/Users/yukin_co/.codex/skills/editor-state-change-discipline/SKILL.md`。UI metadataは同フォルダーの `agents/openai.yaml`。アプリからの実行依存は作っていない。
- `skill-creator` の `quick_validate.py` で形式検証。標準PythonにPyYAMLがなかったため、既存の解析用Python環境を使用し、依存追加・環境新設はしていない。
- 独立試行は文字サイズ入力／スライダーの修正計画を題材に、実ソースを読み取りのみで確認した。実装や速度の実測ではない。
- この段階ではアプリのコード・実作品・保存形式は未変更。検証serverの起動もなし。

### P0: 先行実装の依存分類と補修

- 計画単独commit: `aff26b8`。
- 現在のApp・MangaCanvas・PaintEditorを構成する設定、文字、描画、原本分離、レイヤー、関連仕様・試験を先行checkpointへまとめる。既存の3D撮影・全体生成・ページ画像出力も同じ画面のprops／型／writerに接続しているため、必要な依存として含める。未追跡コード8ファイル、素材SVG7枚を取りこぼさない。
- ページ／コマ生成のfrontendだけを固定するとHEADのbackendが `owner_key=page/panel` を拒否する。このため既存Python3ファイルのプロトコル対応と関連試験も同じ先行checkpointへ含める。新しい生成モデルの導入・実行はしない。
- 除外して保持する差分: `README.md`、`scripts/start-lan.mjs`、`docs/2026-10-20-lan-editing.md` のLAN案内、`DocumentEditors.tsx`／`BackgroundModelPicker.tsx` の背景資料の説明、`humanPoseSkeleton.ts`／`2026-10-24-pose-face-guides.md` の顔ガイド。3D記録中の顔ガイドへのリンクも部分stageで除外し、作業ファイルには残す。学習資料・Grok計画・`output/` は含めない。
- 独立レビューで見つかった先行不整合を、既存の合成処理内で補修した。完成画像の生成絵を編集可能な内容より上・原本切り出しより下へ描く。出力canvasの実画素数からdpiを求め、1024pxの生成入力用サイズを完成画像へ流用しない。ページ前景の通常文字も合成する。旧ページ生成履歴の非ゼロpanel IDは変更せず読み込む。
- 画像読み込み／書き出しの旧レイヤーパレット入口は、2026-10-25の利用者指示でヘッダーへ移動したもの。旧ボタンを復活させない。残った未使用prop・ヘルプの説明はP6/P8で合わせる。
- 補修の検証: 関連Node36件成功。既存3Dブラウザーfixtureで合成原稿を使用し、2048px原本の1px線を600dpi出力で保持、コマ生成絵→ページ生成絵→原本の順、既存PNG生成入力、前景文字の計6項目が成功。モデルAPIは模擬応答で、実生成・利用者の原稿の検証ではない。
- ステージ対象だけのtreeを同じ親フォルダーの一時作業コピーへ展開し、別作業の未commit変更なしで全体検証する。通常起動の正本と依存環境は元のcheckoutを維持し、確認後は一時コピーを片付ける。
- 一時コピーの `npm run verify` 成功: 型検査429ファイル、error/warningなし。Node 1282件中1279成功・3skip、Python451件（57skip）／18件（1skip）／45件（21skip）、通常版・単一HTML build成功。既存の同梱モデルをコピーへ補って検証し、新規モデルの取得はしていない。実モデル生成・実作品の保存は未検証。
- P1〜P9に記録した既知の問題はこのcheckpointで解消済みとはしない。先行実装と今回の整理をGit上で区別するための回復点である。

### P1: 印刷・出力設定の一本化

- 先行checkpoint: `4ef428b`。
- 残す入口: `FinishLayoutSettings` → `PrintSettingsEditor` → `withPrintSetup`。カラーは `meta.format`、サイズ・dpiは `finish_settings`。出力寸法は `getOutputSettings` から導出する。
- 撤去: `ArtworkSettings` の即時カラー／dpi編集と `output` section、使用先がなくなった `withOutputSettings` と専用dpi候補。新しい設定storeや同期effectは追加しない。
- 印刷所preset・カラー変更時の推奨dpi・詳細欄の手動dpiは、既存PrintSettingsEditorの仕様を維持。編集途中のdraftは「設定を適用」だけで確定し、取消しでは本文も前回設定も更新しない。
- 旧output UI専用の `artworkOutputSettings.test.mjs` は撤去し、必要な取消し・独自値・正本への反映を既存の環境設定／印刷／出力試験へ統合した。
- Node関連53件成功。型検査428ファイル、0 error／0 warning（既存hint 8件）。合成作品を使う既存環境設定ブラウザーfixtureで、カラー／dpi変更の取消しは更新0回、金沢印刷presetとモノクロ600dpi、0dpi拒否、手動450dpi適用後は更新1回、再表示でも450dpiと出力寸法の一致を確認。実作品の保存や印刷所への入稿はしていない。

### P2: 生成設定の保存を一つにする

- P1 commit: `b1ba6a6`。
- 正本は既存 `generationPreferences` の固定key。`execution` と `cloud.adultTermsConfirmed` は別の意味を保ち、同じJSONへ1回の `setItem` で保存する。`modelPrivacy` は利用可否の判定だけを担当する。
- 撤去: 旧cloud設定writer／独立UI state、実行先変更時の2key同期。旧cloud keyは既存load関数内で読み込むだけで、読み込み時に移動・削除・書き換えしない。
- 保存内容に `version: 2` を記録し、以降は旧keyを参照しない。旧keyだけなら明示的な `enabled: true` を継承。旧2keyが食い違う場合、未知version、不正・読取拒否はlocal。成人同意は真偽値trueだけを継承し、クラウド選択から自動付与しない。
- UIは保存成功後に設定を採用する。同じ失敗が連続しても保存済みの値を表示へ戻す。生成直前は同じloaderで現在値を再取得し、撮影待ちの間に実行先・同意が撤回された場合もZIP作成前に拒否する。
- Node関連73件成功、型検査428ファイル0 error／0 warning。独立read-onlyレビューでも不具合指摘なし。既存環境設定ブラウザーfixtureで実行先切替、同意保持、無効な接続先の連続拒否、再表示を確認し、作品更新0回・モデル通信0回。生成直前の撤回は実handlerを使った隔離Node試験で確認。実クラウド／ローカルモデルの生成は行っていない。

### P3: 同値通知と意味のある編集

- 残す入口: `updateTextStyle` / `editCanvasTextStyle`、`changeVectorStyle` → `commitVectorPaths`、`changePanelStyleNumber`。
- 文字更新は対象の小さな書式だけを先に計算し、変更なしなら元documentを返す。作品clone・fit・履歴へ進むのは実変更だけ。既定値の明示化、部分書式の解除、通常文字のorientation同期を変更として保持する。
- ベクターは同じ書式ならpath参照を維持し、既存commitで同じpath列を元sceneへ戻す。汎用deep比較・監視・新しい履歴経路は設けない。
- P2 commit: `fe05253`。関連Node87件、型検査428ファイル0 error／0 warning。実handlerの同値通知でsetDocument・履歴境界リセットが0回、未選択／同色／同幅ベクターでscene参照不変、実変更と削除は反映。文字の同値操作では無関係な領域へ触れず、全作品cloneがないことも検証。既定値の明示・継承復帰・部分書式解除・通常文字の方向同期、YAML往復を維持。連続サイズ操作と実UIはP4で検証する。
- 独立レビューで破線配列の参照比較による同値漏れを検出。既存の書式比較内でdash要素を比較し、実線・同じ破線を再クリックしても参照を保つよう補修。追補commit `e77fb77`、関連44件成功。値の変わる破線は通常どおり反映する。

### P4: サイズ操作と既存履歴の接続

- P3 commit: `08e3299`。残す正本は既存 `imageGestureBoundary` → `setDocument` → `workspaceHistory`。サイズ操作のsourceだけを区別し、毎通知での履歴境界リセットをなくす。本文編集や画像移動の既存境界は維持。
- sliderはrelease／pointercancel／window blur、keyboardはkeyup、数値はEnter／blur／Escapeで区切る。中断時も最後の有効な表示値を保持する。IME変換中はサイズを適用せず、確定後に検証して反映。対象ごとのtoolbarを再利用し、切替・unmountで前の操作を終える。Undo後に同じ欄へ再入力しても新しい操作になる。
- 関連Node51件成功。実toolbar handlerで各終了境界とIME、実App handlerと既存履歴で同値・連続更新・Undo後の入力を検証。型検査428ファイル0 error／0 warning。
- 既存 `textToolInteraction.browser` の合成作品で、18→4→48の連続数値入力を一回のUndoで18へ、Redoで48へ復帰。sliderの48→129 dragも一回で48へ戻り、矢印キーと数値blurの別境界も確認。再読込後は最終32ptを保持。pointercancel・IMEは隔離handler試験であり実OS入力の検証ではない。既存ResizeObserver通知は再現したが編集結果・履歴を妨げていない。

### P5: 本文自動保存と原本保持の分離

- P4 commit: `f32e7b5`。既存autosave effectはdocument／開始状態だけに依存し、履歴更新は既存原本回収へ参照を渡すだけに分離。描画snapshotを保存済みdocumentにはしない。
- `storeWorkspaceDocument` は元のdocumentと直前の成功した保存を受け取る。同じ参照は書き込みなし。通常編集は一度serializeし、入力YAMLをparseし直さない。初回・別タブによる保存の置換・サンプルからの離脱時だけ従来の保管確認を通す。失敗した保存を成功履歴へ進めない。
- 原本参照は現在の作品、描画中のimport、Undo／Redo、書き込み中の画像に加え、直前に保存できた作品を含む。初回保存未成功・サンプル保管あり・保存領域へアクセス不可は回収しない。
- 独立レビューで、別タブが作品Bを保存して閉じた後、作品Aの履歴更新からBの画像を回収し得る問題を検出。既存IndexedDB transaction時の参照callbackで、成功保存と現在の保存文字列が違う場合はnullを返し、削除を見送る。待機中の外部保存も同じ境界で保護し、新しいGC方式は作らない。
- 関連Node42件成功、型検査428ファイル0 error／0 warning。実Appの合成fixtureで、起動時保存1回→履歴保持数50から40へ変更しても1回→ト書き編集で2回、再読込後の本文保持を確認。実ブラウザーの既存asset lease試験4項目で稼働中session、保存対象不明、終了sessionの回収条件を確認。実作品・別PC・OS障害の検証ではない。

### P6: 持ち替え前の経路確認

- P5 commit: `d9e4e79`。描画対象の表示は `PaintOwnerPreview` → `PaintPreviewCanvas` がsceneを直接消費し、T／ズーム中もPNGなしで保持できる。通常配置の `PlacedImageView`、保存、書き出しは確定した作品のPNGを消費するため既存flushを残す。
- 作品documentを変更しながら未確定sessionを保持すると `applyPaint` の基点検査と衝突する。そこでT選択と文字編集開始を分離し、実際の文字編集・作品設定tabへの入場では既存closeを完了してから編集する。二重sessionやmerge処理は追加しない。
- 描画中に環境設定を開くと「手描き・編集」から開始。表示・モデル設定はsessionを維持し、レイアウト・生成ルール・受け渡し・データ管理は確定後に表示する。ぬりたしの実変更も描画領域に影響するため確定後に反映する。
- 進行中gestureは既存finishGestureで終了。3D背景はcamera snapshotを要するため、その場合だけ従来closeを使う。持ち替え中は入力面とmask／生成用overlayを隠し、同じsceneの通常表示を使う。
- 関連Node105件、型検査428ファイル0 error／0 warning。独立レビューで見つかった持ち替え中の裏側の描画ショートカット、文字drag／矢印移動、ページ切替の境界を既存guard／transitionへ集約して補修し、再レビューで追加指摘なし。
- 既存textToolInteractionの合成作品でペン→T→ズーム→手描き／表示設定→ペンのPNG生成数は開始時の2回から増えず、Undo／Redoで線を復元。実際の文字編集またはページ切替で4回となり、再読込後も確定した線と2ページを保持した。明示保存・失敗再試行は既存handler試験であり、実OSのフォルダー選択・実作品保存は未検証。

### P7: ディスクwriterの整理

- P6 commit: `3b40631`。P7aは `SeriesCatalogStore.save` だけを変更し、名前衝突・revision・資料参照の検査後、YAMLと保存metadataが同値なら書き込みを省く。参照先が同じならlinked_atも保持し、意味上の更新だけupdated_atを進める。revisionの対象は引き続きYAMLであり、metadataの多process競合保証は追加していない。
- P7a検証: scanner bridge 85件（1skip）成功。一時fixtureの同値保存でファイル数・byte・mtime・参照ID・再リンク情報を保持し、一時ファイル作成0回。古いrevision／存在しない参照は拒否し、名称のみ／参照のみの更新は反映した。実作品への書き込みなし。
- P7bは既存save／metadata／人物画像／人物テキスト・復元記録writerとエピソード登録writerの一時pathを作成直後から所有し、finallyで片付ける。一般的なatomic writerや新しいbackup管理は追加しない。人物テキストの既存30日履歴は一時ゴミとして消さない。
- 独立レビューで、metadata失敗後に復元用tempを作ると容量不足で復元できない窓を再現。復元用tempも最初の置換前に準備するよう修正した。復元の置換自体にも失敗した場合だけ、その旧byteを保持してpathをエラーに示す。OSクラッシュ／複数processをまたぐ2ファイルの原子性は保証しない。
- P7b検証: scanner／episode／project／series background bridge 145件（1skip）成功。実一時fixtureに対する書き込み途中、temp作成、fsync／chmod／replace失敗で既存byte・無関係ファイル保持と再試行を確認。2回目のI/O障害では旧byteの残存を確認。実作品は未変更。レビューで挙がった登録失敗後のメモリtoken残留はP7cで扱う。
- P7cは `EpisodeWorkspaceManager.select` の既存lock内でresolve済みの保存先を照合し、同じ場所なら既存tokenを再利用する。重複した旧tokenは参照中の可能性があるため消さない。新規登録の永続化に失敗したら、その登録だけメモリから取り消す。ブラウザー側は既存isSameEntryで再利用しているため変更しない。
- P7c検証: episode／project bridge 40件、browserWorkspace 9件成功。再選択・symlink経由・再起動・重複旧tokenで登録数とregistryのbyte/mtimeを保持。取消し、登録失敗後のメモリ／ディスク保持、一回だけの再登録を一時fixtureで確認。OSの実folder pickerは模擬応答。

### P8: 標準名への整理

- シリーズ台帳は既存 `SeriesCatalogStore` のlist／load／save／discardとread-only doctorを修正する。新規writerは `series.yaml` のみ。旧ファイルは開いても移動・削除・書き換えず、同内容でも明示保存で新規名へ進む。
- 新旧両方がある場合、既存 `catalog.json` 内の `legacy_source`（旧名と元byteのSHA-256）と旧ファイルが一致するときだけ新名を採用する。記録なしでも両方のbyteが一致すれば受け入れる。食い違い、移行記録の不正、移行済み新ファイルの欠落は競合とする。旧ファイルが後から変更されてもハッシュを更新して隠さない。新しいsidecar・queue・管理storeは作らない。
- 保存準備の前後で新旧のbyte／存在を確認し、準備中の変更を拒否する。既存lockは同process内の排他であり、外部アプリの書き込みを完全に防ぐOSレベルの多ファイルtransactionではない。失敗時はP7bの復元・一時ファイル片付けを再利用する。
- シリーズ台帳検証: scanner／doctor／series background／project／episodeのPython170件（2skip）成功。一時fixtureで新名往復、旧名read-only、CRLFのrevision互換、旧byte／mtime保持、新旧同一・競合・旧名再出現、準備中の出現／変更／削除、metadata置換失敗と再試行を確認。doctorも同じ新旧条件をread-onlyで照合し、実作品は未変更。
- 独立レビューで保存準備中の `catalog.json` 外部変更が上書きされる窓を再現し、同じwriterの保存前snapshotと直前照合へmetadataのbyte／存在も含めた。一覧は名前・ID・日時の軽量inventoryとして保持し、本文の採用はloadで検査する。一覧のたびに全YAMLを読む処理や、1件の競合で他の台帳一覧も失敗する処理は追加しない。競合台帳を選択すると既存HTTP境界が409で拒否し、doctorは全体を検査する。
- シリーズ台帳commit: `a9ee62f`。YAMLの受け渡しは既存 `omnyFileName`／`omayFileName` と各ダウンロードhandlerを変更し、構成は `作品名.yaml`、設定控えは `作品名-settings.yaml`、生成指示は `作品名-generation.yaml`。serializerやデータschemaは変更していない。画面名を役割で表示し、構成YAMLの読み込みUIは追加しない。
- 同梱の現行sampleを `sample.yaml`、標準設定を `standard-settings.yaml` へ改名。内容はGit blob一致で不変。依存testと公開案内の参照を更新し、履歴文書は当時の名称を保持して現行手順への案内・切れた参照だけ補修する。生成promptの変更はファイル名／参照先のみで、モデルによる試行は利用者の確認前に行わない。
- YAML名・UI検証: 全Node1301件（1298成功／3skip）、原文確認Python16件、型検査428ファイル0 error／0 warning、通常／単一HTML build成功。全Node実行でP6のundo/redo隔離testにtoolSuspendedのcontext渡し漏れを検出し、既存testへ補完した。既存環境設定ブラウザーfixtureで新ラベルと控え／生成出力通知を確認し、出力後も作品更新0回。出力名・OFF項目保持・生成対象の選別・作品／保存先の不変はactual-handler試験で確認。実作品・実モデルの検証ではない。
- LANは既存 `BrowserWorkspaces` → `writeProjectFile` を維持。保存先の解決を既存Web Locks／同画面queue内へ移し、書き込み前・writer取得後・公開直前に新旧ファイルのrevisionを照合する。新規writerは `project.json` のみ。AppのJSON化を既存folder writerへ寄せ、readerで一度parseした値をAppの復元へ渡す。別のqueue、sidecar、作品document内の移行stateは作らない。
- LANの `legacy_source` は既存JSON envelopeへ記録して保存のたびに保持し、シリーズと同じ新旧競合条件を適用する。開くだけでは旧byteを変更しない。初回writer失敗で残る空ファイルは再試行できる。新JSONが削除・空になってから再選択された場合は、移行履歴も失われるため旧ファイルへのfallbackを過去の移行と区別できない。外部アプリとの完全な多ファイルtransactionを保証せず、これらの境界をLAN手順書に明記する。
- LAN検証: 関連Node46件成功、型検査428ファイル0 error／0 warning。旧名read-only、新旧の一致／不一致、不正な移行記録、準備中・writer取得中・書き込み中の外部更新、同時保存、失敗後の再試行を確認。独立レビューで空の新規ファイルが別名の単独作品チェックを迂回するケースを見つけ、既存guardへ統合して回帰試験を追加した。
- 既存 `browserWorkspace.browser` のOPFS合成作品で、実FileSystem writerによる `project.json` 44,796byteの保存、旧ファイルと記録hashの一致、空キャッシュから原本1枚・人物資料1枚の復元を確認。pickerだけはfixtureへ置換しており、OSの実folder picker・別PC・実作品の試験ではない。モデル送信0回。確認tabを閉じ、専用LAN検証serverのPID50819終了と4339解放を確認した。
- LAN commit: `0fb7814`。制作packageは既存exportの新規snapshotを `data/name/document.yaml` / `data/style/settings.yaml`、フォルダー名を `<title>-<UTC timestamp>-package` に統一する。選択してコピーする既存資料のpath・byteは変更しない。既存validateとv1 schemaは旧snapshot固定pathも受け入れ、任意pathを許可しない。内部field／role名は互換性のため保持。
- 制作台帳は既存 `begin_attempt` → `write_artifact` の新規YAMLを `<sha256>.yaml` にする。hashが主キーなので、旧名の同一内容が登録済みなら既存rowと原本を検証して再利用し、二重ファイル・旧原本書き換え・台帳移行を行わない。doctorのread-only検査も両名を認識する。旧名writerを別経路として残さない。
- package／ledger検証: 既存画像解析環境でPython63件（60成功／3skip）、Node package／CLI11件成功。新規名出力、旧package読取不変、copy原本byte保持、旧artifactの同hash再試行／別attempt再利用／破損拒否、doctor両名対応を一時fixtureで確認。BagIt実dependencyと汎用JSON Schema validatorは未導入でskipし、依存の追加はしていない。package core／manifest固定pathの照合は成功。OSの実作品・実モデル生成は未検証。
- 独立レビューでschemaの新旧pathを別々に許可するだけではdocument参照とpayloadの不一致を受け入れる点を補修。既存schema内で両者を対応づけ、旧資料copyのpath／byte不変を明示検証した。互換fixtureのpayload・tag manifestも両hashを照合する。既存Node依存のAjvで新旧4組合せ・不一致8ケース、計12件のschema検証も成功（Python側jsonschemaのskipとは区別）。

### 2026-10-27追加: 同梱物語の撤去

- P8までの回復点は `1dcef78`。上記P5のサンプル保管とP8のsample改名は当時の記録であり、現在は利用者の追加指示により撤去する。
- シナリオYAML、完成漫画2枚と保管先の同一画像、共有画像モジュール、マスコット紹介画面の漫画表示を削除。マスコット自体の設定・参照画像・権利表示は別対象として保持した。
- 残す起動入口は `initialWorkspace` → `workspaceFromStored`。起動直前に専用復旧keyと識別できる同梱物語だけを除き、保管関数・保管state・復旧UI・保存時の保管処理を撤去した。識別用の最小のタイトル・人物名は再出現防止のために残す。一般の作品、設定、未知の保存データは一括削除しない。
- テストは空の作品と必要最小限の人物・コマ・文言へ変更し、作画規則の試験だけ `standard-settings.yaml` を直接読む。物語を持つ新しいデモデータや、利用者の原稿をfixtureに追加していない。
- service workerのcache版を更新し、過去bundleを含む静的buildを作り直した。確認済みの旧静的出力15箇所と、物語を含むテスト出力5ファイルを削除。Gitの過去履歴、remote、他の作業場所は変更していない。
- 全体verify成功: Node 1310件中1307成功・3skip、Python463件（57skip）／20件（1skip）／45件（21skip）、型検査428ファイル0 error／0 warning、通常・単一HTML build成功。初回のsandbox制限によるHTTP待受失敗は権限付き再実行で解消し、P8の古いソース照合assert 1件を現行handlerへ合わせた。
- 追補: 実Appの起動関数による削除順序と、service workerによる旧cache失効の回帰試験を追加。関連30件成功。追補後の `npm test` もNode 1312件中1309成功・3skip、Python463件（57skip）／20件（1skip）／45件（21skip）で成功。実作品の再取込・画面検証は下記に分けて記録する。

### 2026-10-27: 利用者指定原稿での操作確認

- 指定されたデスクトップのテストシリーズ `no.1.5` を通常起動の実Appで使用。元画像4枚の解析と人物読取後、4ページ（コマ数5／5／4／4）を作成・保存した。原稿をアプリやテストfixtureへ同梱していない。読取精度の合格判定ではなく、編集・保存に到達した確認である。
- 利用者の追加編集を保存してから画面操作を引き継いだ。数値入力13→24pt、連続スライダー13→82ptは、それぞれ一回のUndoで13ptへ戻った。同じ13ptの指定ではRedoを維持した。
- 背景へ一筆を描き、ペン→文字→ズーム→環境設定（表示のみ）→ペンを経ても保持。一回のUndoで一筆と試験用レイヤーが消え、Redoで一筆だけ復元した。今回、PNG生成回数・処理時間は計測していない。
- 通常コマ内で下側の吹き出しを上側と重ね、上側が表示・選択されることを確認した。この条件では順序の逆転を再現していない。利用者報告の「重なり順通りに掴めない」全条件の合格とはしない。
- 不合格・未修正: 文字サイズの実変更時に、非対象を含む原本吹き出し画像21件の表示要素が一斉に置換された。`editCanvasTextStyle` の作品全体cloneで無関係な `paint`／画像一覧の参照も変わり、`PlacedImageView` が既存canvasを外して画像を非同期再読込する。利用者報告のちらつきと整合する不要処理が残る。瞬間の空表示時間は未計測。
- 読み取り専用調査で、通常文字の透明な矩形にも当たり判定があること、ページ前景の人物とコマ外ペイントで描画順とpicker順が異なることを確認した。ただし今回の通常コマ内の報告原因としては未確定。通常コマ内の吹き出し／人物は個別のstacking contextを持ち、選択中のz-indexだけで兄弟順は逆転しない。
- 試験で加えた文字サイズ・位置・線をUndoし、保存後の `document` と `assets`（69件）が操作引継ぎ直後と完全一致することを確認。新規文字の一時的な既定サイズも13ptへ戻した。元画像・原文は変更していない。解析中の再読み込みを避けるため、今回の実操作中はsource編集・check・buildを実行していない。
- 自起動の検証サーバーを終了し、対象PIDと4325／8786／8787の待受解放を確認した。P9および上記不合格項目は未完了のまま保持する。

### 2026-10-27 02:39: 次の計画に先立つP9a checkpoint

- 利用者の「先にコミットしてから次を始めようね！」に従い、既存のP9a差分を先にローカルcommitした。回復点は `1393d26673aa6dc5d98b51351c3883905784770c`（`Checkpoint raster selection work before editor repairs`）。新たな不具合の修正はまだ加えていない。
- 対象は `PaintEditor.tsx`、`rasterSelection.ts`、`global.css`、関連test 3ファイル、`USAGE.md` の既存7ファイルと本記録。投げ縄を画像サイズに切り詰めない処理、トーン作成時の既存領域拡張、不要な作業枠表示の撤去を含む。
- 再検証: rasterSelection／paintGesture／paintDocument／paintTone／paintStrokeの69tests成功。`npm run check` は428files・0 errors・0 warnings・9 hints。全unstaged差分とstage対象をレビューし、他作業のLAN／3Dの7ファイル、未追跡資料・生成物を混ぜない。
- これは回復点であり、P9a完了判定ではない。実UI検証、横方向の過大選択と説明書の範囲の整合は未完了。後から判明したコマ枠の重なり、選択同期、文字移動、無描画での画像化も未修正。
- この区切りでは実作品の操作・server起動・追加の本体編集を行っていない。pushしない。

## 9. 2026-10-27: 実原稿で判明した不具合の修正計画

状態: **2026-10-27に利用者が実装開始を承認。R1〜R4bは実装・合成検証済み、R5以降は未実装。** 原因調査は先行commit後にこの既存計画書へ集約した。以下の各段の計画と、末尾の実施記録を区別する。

### 9.1 原因と責任の境界

実操作の観測と、HEAD `1393d26` の呼出経路を照合した。パンのSpaceドラッグは今回の自動操作では確証を得ていないが、fit時の縦スクロール可能量0と、それ以上動かせない実装を確認した。

| 症状 | 確認した原因 | 修正を集約する既存経路 |
|---|---|---|
| レイヤーを選んで配置へ戻るだけで人物・背景が画像化され、Undoできない | `PaintEditor` の初期guide準備が全ownerを対象に走り、準備したownerを置換するが、保存点だけ準備前に残る。close時の参照差分でPNG化され、`applyPaint` の `setDocument(next,false)` へ進む。準備は実描画の履歴を通っていない | `PaintEditor` の準備処理 → `paintCheckpoint` → 既存 `onApply`。表示準備と作品編集の境界をここで直す |
| 文字サイズ変更で無関係な原本画像までちらつく | 実変更の `editCanvasTextStyle` が作品全体をcloneし、無関係なpaint/assets参照も変わる。`PlacedImageView` のeffectが画像を解放・再decodeし、原本canvasを外す。実原稿では21件の表示要素置換を確認 | `PlacedImageView` の画像resource寿命と `loadPaintImages`。描画内容更新と原本再読込を分離する |
| コマ枠に接した吹き出しが枠線の内側半分を消す | パレットではコマ枠が吹き出しより上。一方、画面ではframe z4／内枠一致部分z11よりbubble z15が上で、panel clip内の白地だけが枠を覆う。`qwenComposition` もframe後に全bubbleを描く | パレット・`MangaCanvas`/CSS・共通PNG/PSD/生成入力の描画順を同じ仕様へ揃える。線幅を増やす問題ではない |
| キャンバス選択がレイヤーへ伝わらない／フォルダーが開かない | Appの `selectedElement` は人物・画像も持つが、`PageLayerPalette` へ渡すのは文字・吹き出しだけ。自動展開は通常文字のpanelのみ。元画像ownerは行の選択表現も不足 | `selectedElement` → 既存owner keyへの変換 → パレット表示。Inspectorへ渡す正本と共通にする |
| 人物フォルダーの選択でペンが起動する | owner選択と描画layer操作が同じ `actOnLayer` に入る。吹き出しだけ早期returnし、人物・原本は `openPaint` へ進む | owner見出しの選択は既存canvas選択へ、実paint layerの選択は既存描画入口へ分ける |
| 一部だけ人物あたり枠が消える／名前確定後も色付きあたり枠が残る | `figure.artwork` があると `renderArtwork`、ないと `figure-guide` という表示分岐。名前の確定とは無関係。実原稿では1コマ目だけでなく3コマ目にもartworkがある。`refId` がある2コマ目もguide側なら青枠 | 既存 `refId`／要確認情報と通常選択表示を使う。artwork生成を枠切替の手段にしない |
| 読込直後に文字あたり原本が本文へ重なる | 新規OCR cropのmetadataに `referenceHidden` がなく、`separateBubbleOriginals` が `visible: !source.referenceHidden` で表示にする。分離済みlayerは保存した目の状態を保持する | 新規OCR metadataの既定値 → 既存の原本分離。再読込のたびに非表示を強制しない |
| 拡張した吹き出しの中でも文字が途中で止まる／Aで不要な破線が出る | ベジェ輪郭は0–100基準枠の外へ拡張済みだが、Tのdrag、`bubbleTextPosition`、validatorは本文中心を旧bbox内0–1へ制限。Aの破線はその0–100参照枠で、実輪郭ではない | 既存の本文位置座標と保存・描画helperを一貫して直し、指定された参照枠の破線を撤去する |
| 紙面を灰色部分まで引き下ろせない | Space操作はDOMの `scrollLeft/scrollTop` を動かすだけ。fit時は紙面がviewportに収まり、余白に移動するためのscroll領域がない | 既存scroll surface／stageへ移動用余白を持たせる。別のpan座標・transformは作らない |

主な確認箇所: `PaintEditor.tsx` 初期準備・`flush`、`paintSession.ts` の `paintCheckpoint`、`App.tsx` の `applyPaint`／`selectedPaintOwner`／`actOnLayer`、`PlacedImageView.tsx`、`PageLayerPalette.tsx`／`PaintLayerPalette.tsx`、`MangaCanvas.tsx` の人物表示・本文drag・frame・pan、`bubbleClip.ts`、`BubbleBezierEditor.tsx`、`analogTextCrops.ts`／`bubbleOriginals.ts`、`qwenComposition.ts`。単にCSS・ラベルだけを変えて原因が残る修正を避ける。

### 9.2 実装・commit順と合格条件

順序は **R1 → R2 → R3 → R4a → R4b → R5 → R6 → R7 → R8 → R9**。R1で無操作による原稿変更を止め、R2で表示の再読込を止めてからUIを検証する。R3の重なり順を確定してから選択を合わせる。座標系全体へ影響するR8は個別操作の後にする。各段の合格後、次段に入る前にローカルcommitする。

#### R1: 無操作のguide準備を作品編集から外す

- 対象候補: `PaintEditor.tsx`、`paintSession.ts`、必要な場合のみAppの既存snapshot復元境界。
- 残す正本は `PaintSessionSnapshot.scene/saved/imports` と共有履歴。準備前ownerが保存点の同key ownerと同じだった場合に限り、未画像化guideの準備を同値表現として扱う。未保存resumeのowner、既存guide画像の欠損修復、実編集のownerは一括でcleanにしない。
- 比較を既存checkpointへ集約し、Undo復元でscene外側だけが複製された場合も、実変更なしなら `onApply` を呼ばない。writer成功後だけ保存点を進める契約と、表示準備の同値扱いを混同しない。具体的な実装は以下の回帰条件で判定する。
- 別のdirty Set、履歴、保存queueを追加しない。「筆跡が0だから保存不要」とはしない。表示・錠前・削除・画像差替え・vector・tone・3Dも正当な編集として残す。準備Blobは初回描画・Redo・resumeに必要な間保持する。
- 合格: 2人物＋背景で選択→close／cancelだけならdocument・asset登録・Undo/Redo不変、配置へ反映するowner PNG／`onApply`は0回（表示用guideの準備と区別）。初回一筆は対象ownerだけを変更し1Undo。描画→Undo→close、Redo、未保存resume、欠損修復、保存失敗→再試行で内容を落とさない。
- 検証先: `paintSession.test.mjs`、`paintGesture.test.mjs`、`projectPersistence.test.mjs`、既存 `paintPerformance.browser.tsx`。既に画像化されている実原稿を自動で逆変換しない。

#### R2: 文字変更による無関係な画像再decodeを止める

- 対象候補: `PlacedImageView.tsx` と既存paint画像ロードhelper。原本の実参照ID／storage情報に変更がない間はdecode済み画像を維持し、paint内容だけの変更は既存 `PaintPreviewCanvas` に渡す。
- 全document cloneの一括置換や共有参照化を先に行わない。Appの `setDocument` はcatalog・コマ重なり情報を正規化しており、浅いcopyだけへの変更は履歴snapshotを汚す危険がある。
- 新しい全体cacheや毎入力の全文hashを作らない。参照原本の検査・解放・読込失敗表示は既存loaderの契約を維持する。
- 合格: 文字サイズ変更で非対象原本のcanvas・decodeをやり直さない。原本差替えは必要な読込を行い、A→B→Aの高速変更で古い完了結果が上書きしない。paint変更・Undo/Redo・unmount・欠損時にも古い画像を正解として残さない。
- 検証先: `canvasTextStyle.test.mjs`／`bubbleOriginals.test.mjs` と既存文字操作・描画browser fixture。実原稿の21件を再観測する。

#### R3: コマ枠・吹き出しの順序を画面と出力で一致させる

- 対象候補: `MangaCanvas.tsx`、`global.css`、`qwenComposition.ts`、必要に応じ既存 `panelLayers.ts`、現行NDM日英仕様・生成prompt。
- 対象間の順序を奥から **コマ内描画 → コマ内吹き出し → コマ枠 → ページ直描き／ページ前景 → 生成絵 → 切出し原本** とする。ページ前景内の吹き出しは前景人物より上に保持。その他の既存画像層の順序は変更しない。
- 通常コマのbubbleだけをframe下へ置き、`above_panel_frames` の前景をframe下へ落とさない。全frameを最上段へ上げる修正はしない。枠をもう一枚足さず、既存frame passを使う。内枠ガイドと一致する辺の限定再描画も一般frameの二重描画へ広げない。
- 出力は既存bubble描画本体を一つのhelperへまとめ、通常コマ分をframe前、前景分を前景人物後に各1回呼ぶ。geometryを触る場合は既存 `panelFrameSegments` を利用し、bleed／多角形判定を別実装にしない。
- 現仕様書・既存testは「frameより全bubbleが上」を要求しているため、これは仕様整合を含むcommit。画面CSSだけを先行して完成扱いにしない。
- 合格: 接触部でも枠線の全幅が残る。前景はframeを覆える。パレット順・画面・PNG/PSD・生成入力用合成が一致。bleed・多角形・frame非表示・showGuidesの有無を保持し、線が二重に濃くならない。重なった対象のhitも表示順と一致する。
- 検証先: `canvasLayering.test.mjs`、`pageLayerPalette.test.mjs`、`qwenComposition.test.mjs`、`panelLayers.test.mjs`、既存 `humanPoseGeneration.browser.tsx` の実canvas出力、実原稿の接触部。

#### R4a: キャンバス選択をレイヤーへ表示する

- 対象候補: `App.tsx`、`PageLayerPalette.tsx`、`PaintLayerPalette.tsx`、既存選択helper／CSS。
- `selectedElement` を唯一の作品要素選択とし、page／panel／scopeと合わせてowner keyへ変換する処理を一本化する。既存 `selectedPaintOwner` のbackground既定値は描画開始時だけ使い、通常画像・通常文字・未選択を背景owner選択へ誤変換しない。
- パレットの表示上のowner選択と、paint sessionの実layer選択を区別する。対象のpanel／ownerだけを展開し、既存 `canvasSelectionScrollRequest` でdock内へ表示する。選択stateをもう一つ同期保存しない。
- 自動DOM focusは付けず、選択表示・aria・必要なscrollに留める。文字入力やSpace/V/T操作のfocusを奪わない。高速切替やページ移動では古いscroll予約を破棄する。
- 合格: 人物・吹き出し・切出し原本・通常文字で正しい1行が選択され、折畳み中でも表示される。コマ情報と一致し、描画は起動しない。同じ対象の再選択、A→B高速切替、別ページ／前景でも誤選択しない。
- 検証先: `pageLayerPalette.test.mjs` と既存文字操作／レイヤーbrowser fixtureに実Appの選択往復を追加。

#### R4b: owner選択と描画layer操作を分離する

- R4aの変換を逆方向にも利用。人物・吹き出し・原本のowner選択は既存canvas選択へ戻し、実paint layer選択だけを既存 `actOnLayer`／`openPaint` へ渡す。新しい選択storeや第二の描画開始経路を作らない。
- 原本は現状のdirect rootに外部選択を表せる行を設け、ownerの選択と実layerの描画選択を区別する。背景は対応するcanvas要素がないため、今回の既定案では既存の背景編集入口を維持する。3D編集・子layer・目・錠前・並替えを失わない。
- 合格: ownerの往復選択でペンが勝手に起動せず、子layerからは従来どおり描画できる。R1の無操作不変条件も再実行する。R4aとは別commitにし、表示同期だけへ安全に戻せるようにする。

#### R5: 名前確定後の人物枠を通常表示へ揃える

- 対象候補: `MangaCanvas.tsx`、既存人物状態helper、`global.css`。
- 人物の確定／要確認は既存 `refId`・`analysisReview` 等から導出する。`analogImport.draft` は確定後も残るので単独の判定に使わず、新たな「確定済み」保存flagも増やさない。
- 確定済み人物には通常の選択枠・handleを使い、あたり用の青／黄枠を常設しない。未割当・要確認の注意表示と原画参照は残す。panelとpage_overlayで同じ判定を再利用する。
- 合格: 同じ人物はartworkの有無・ペイント開閉で枠の意味が変わらない。名前確定／Undo／再読込で一貫し、propは人物未割当として扱わない。表示を直すためのPNG生成や原稿一括書換えは0回。
- 検証先: 既存人物表示・ラベルtestと実App。実原稿の1・2・3コマ目を比較する。

#### R6: 新規OCRの文字あたり原本を初期非表示にする

- 対象候補: `analogTextCrops.ts`、必要な場合のみ `bubbleOriginals.ts`、既存説明書。
- 新規crop生成時に既存 `referenceHidden` の初期値を設定し、既存の分離処理でpaint layerの目へ引き継ぐ。分離後はそのlayerの目を正本にし、別のhidden stateと二重管理しない。
- 保存済み作品の目、加工、lock、削除済み原本の非復活は維持。既存作品を開くたびに強制非表示にせず、実原稿の72assetsを一括変更しない。非表示でも原本を保持し、目で再表示できる。
- 合格: 新規取込は本文が見え、原本の再表示・再非表示・保存復元が成功。分離済み作品の表示選択、明示的に表示した互換データ、削除済み原本を保持する。
- 検証先: `analogTextCrops.test.mjs`、`bubbleOriginals.test.mjs`、`projectPersistence.test.mjs` と通常の取込UI。

#### R7: 拡張輪郭内の本文移動と不要な破線を修正する

- 対象候補: `MangaCanvas.tsx`、`bubbleClip.ts`、`BubbleBezierEditor.tsx`／`bubbleBezier.css`、`types.ts`、`manga.ts`、現行NDM日英仕様・生成prompt。
- `text_position` の基準は現在のbboxのままにし、有限の0–1外の値も許容する。dragと表示helperのclampを外し、validator・保存往復・出力も一致させる。欠落時の中央配置と非有限値の拒否は保持する。
- 輪郭編集だけで本文の位置や保存の正当性が変わらないよう、動的な輪郭boundsへ保存座標を再定義／再clampしない。既存0–1の作品の見た目は変えない。
- 利用者指定のAダイレクト選択の破線rectを撤去する。Tの本文移動用hit領域、Aの輪郭・アンカー・handle、Vの通常選択は残す。破線を別の枠へ置き換えて残さない。共有の小型ベジェ編集UIへの影響を確認し、紙面上だけを撤去する必要があれば既存overlay条件に限定する。
- `bubbleTextPosition` は画面・PNG/PSD・生成入力合成・paint guideで共用する。guide側のoverflowで正式な本文位置が切られる場合はその既存表示を直し、別の本文描画を追加しない。
- 合格: 実原稿の拡張された吹き出し内で、元bboxを越えて文字を移動できる。1操作のUndo/Redo、保存再読込、YAML往復、PNG/生成入力用合成で同位置。Aで輪郭だけ再編集しても本文位置不変。破線なしでもアンカー選択・取消し・T本文編集は使える。
- 検証先: `bubbleClip.test.mjs`、`bubbleTextLayout.test.mjs`、`ndmMetadata.test.mjs`、`projectPersistence.test.mjs`、`textToolInteraction.browser.tsx`、既存実canvas出力fixture。

#### R8: 灰色の余白へ紙面をパンできるようにする

- 対象候補: `App.tsx` のsingle/spread shell、`MangaCanvas.tsx` のfit／zoom境界、`global.css`。
- 既存scroll surface／stageを単ページと見開きで共通利用し、四方向にviewport規模の移動余白を持たせる。位置の正本はDOM scroll offsetだけ。pan offset state・祖先scale・別transformを追加しない。
- 見開き判定を単なる `.spread-pane` の存在に依存させたまま共通化しない。単ページの印刷guideが2ページ幅にならないことを先に固定する。
- fit用のinsetと移動用余白を分離する。大きな余白paddingをそのまま `fitPaper` の差引対象へ入れない。zoomのanchorも固定余白を含むstage比率ではなく、紙面／見開きpair上の同じ点を保持する計算へ合わせる。初回／明示fitと、通常resize／zoom時の位置保持を分け、既存anchor補正と余白調整を一つの更新経路で扱う。両方からscrollを補正しない。
- 合格: fitでも紙面上部を画面下側まで運べ、左右上下へ動く。移動・zoom後もペン／文字／ベジェ／投げ縄の位置が一致。単ページの初期中央、見開きのノド・共通倍率、cursor中心zoom、input中Space、ドラッグ途中のcancelを保持。作品の座標・Undo・保存データは不変。
- 検証先: `canvasPan.browser.tsx` のsingle／spreadと既存zoom・gesture試験、`canvasLayering.test.mjs`。実原稿でSpace操作を改めて確認する。

#### R9: 既存P9aの残件と統合確認

- P9aを完了済みにしない。投げ縄が描画画像外へ出る場合、横／縦の過大選択、実際にtone等を作る際のメモリー上限を分けて検証する。上限を超えた際に利用者の選択範囲を黙って切り詰めず、既存の描画容量制限へ集約し、失敗時も選択と原稿を保つ。必要な修正は独立commitにする。
- `USAGE.md` の説明を実測した挙動に合わせ、P9aの既存69testsに実UI・境界条件を追加する。R8後の座標ずれもここで再検査する。
- 全体 `npm run verify`、通常／単一HTML build、合成fixtureのUI、実原稿の選択→編集→Undo/Redo→保存→再読込を分けて記録する。生成合成の検証はモデル実行の成功とは呼ばない。
- P9b/cache・P9c/renderer性能・P9d/guide重複decodeはこの不具合群の完了条件へ混ぜない。R1/R2で解消した範囲を差し引いてから、残存負荷だけ再計画する。

### 9.3 競合・二重処理・Gitの運用

- 現在の回復点は `1393d26`。別作業の7 trackedファイル（README、LAN文書／起動script、3D文書、`BackgroundModelPicker.tsx`、`DocumentEditors.tsx`、`humanPoseSkeleton.ts`）と未追跡資料は保持する。修正がこれらへ広がる場合は先に所有範囲を再確認する。
- この計画段階の書込対象は本書だけ。実装開始前に掲示板を再読し、各段の正確なpathを予約する。`App.tsx`、`MangaCanvas.tsx`、`PaintEditor.tsx`、CSSは複数段が重なるため親が逐次編集する。agentへ並行依頼する場合も読取専用レビューに限定し、同じtreeへ同時編集させない。
- 各段で「再現する既存testの追加 → 既存経路の修正 → 関連test・必要な実UI → 全diff／stage確認 → exact pathだけcommit」の順に進む。未使用helperだけ、壊れたtestだけの中間commitを安定点としない。
- R3/R7の現行NDM文書には更新履歴を書かず、変更経緯は本書へ残す。生成prompt本文の変更は差分レビューを挟み、利用者確認前に実モデルの試行をしない。
- 失敗した段は次へ進めず、その段だけを修正する。戻す必要があれば依存を確認し、自分のcommitのみを対象としたrevert等で回復する。他作業を含むreset／restore／自動stash／amendはしない。Gitの回復点はコード用であり、実原稿の復元を代用しない。
- 実原稿は、まず合成fixtureでR1の無操作不変・失敗復帰を通してから扱う。最初のclose／通常保存より前に、現在のdocument・未保存paintのsnapshot/imports・原本・既存保存状態を非破壊で保全する。未保存状態を既存経路で損失なく保持できない場合は操作を止める。通常保存もflushを呼ぶため、「先に保存すれば安全」と扱って変化後を基準にしない。保全後に利用者の最新状態との整合を確認して基準を確定する。
- 確認用の変更だけを戻し、document・asset参照と原本byteを照合する。原本を削除せず、テスト作品をアプリへ同梱しない。検証serverは自起動分だけ最後に停止し、PIDとport解放を確認する。
- この計画作成中は本体コード・実原稿を変更せず、server／モデルも起動していない。修正の効果・安全性はまだ未検証であり、先行69tests成功をR1以降の合格と扱わない。

### 9.4 実施記録

#### 2026-10-27 07:49 JST: R1 無操作のguide準備

- `paintCheckpoint` のowner比較をdirty判定とflushへ共用し、scene外側だけの複製ではwriterを呼ばない。初期guideを表示用画像へ準備する際は、準備前ownerが保存点と同一である場合だけ比較基準を対応づける。作品の保存済み扱いを増やすのではなく、同じ表示内容の表現差を除外する。
- 未保存resume、保存画像の欠損修復、表示／錠前等の実変更はclean扱いにしない。既存 `scene/saved/imports` と共有履歴を維持し、dirty一覧や第二の保存経路は追加していない。`App.applyPaint`／通常のasset writerは変更なし。
- 修正前に「scene外側の復元だけでwriterが1回走る」失敗を再現し、修正後は0回。関連Node 100件（paintSession／paintGesture／paintDocument／workspaceHistory／projectPersistence）が成功。型検査428ファイルはerror/warning 0、既存hint 9。通常／単一HTML buildも成功（既存chunk・dynamic import・site未設定の注意あり）。
- 既存 `paintPerformance.browser` を拡張し、合成原稿で42項目PASS。2人物＋背景の実guide PNG準備、無描画close／cancel時の反映0回、一筆の共有Undo1件、Undo後closeの反映0回、Redoと未保存Blob保持、保存失敗→再試行、対象人物だけのPNG反映、未保存resume、欠損背景だけの修復、筆跡0でも目の変更を保存することを確認した。
- 保存往復は既存validator・serializer・restoreを実PNGで通し、描いた人物のguide＋合成PNGの2assetだけを保持し、未描画人物・背景のartworkを作らない。これは合成fixtureの検証であり、実AppのOSフォルダーwriterや利用者の実原稿の保存確認ではない。
- 利用者の開いている原稿へVite再接続が起こらないよう、専用テストoriginを `127.0.0.1:4335` に分離。元の `4325` は起動していない。作品／モデル／既存serverの操作なし。別作業7ファイルの差分は開始時とbyte単位で同一、pushなし。実原稿検証は9.3の保全後に行う。
- 本体・試験・記録を `07f2eb2` にcommit。続く全Node検証で、欠損修復の旧構文を固定していた `pageLayerPalette` の1検査を新しい修復flagとclean除外条件へ追従させた。待受を使う5ケースのsandbox拒否は通常権限で再試験し、全Node 1,316件中1,313成功・3skip・失敗0を確認。追補は別commitとし、本体の履歴を書き換えない。

#### 2026-10-27 07:59 JST: R2 原本画像の寿命と文字編集

- `PlacedImageView` のdecode済み画像はpaint object参照でなく、既存 `paintAssetIds` が返す参照IDと、その保存先・検証metadataをキーに保持する。全文hash・全体cacheは作らず、実paintの再合成は現在のpaintを既存 `PaintPreviewCanvas` へ渡す。`loadPaintImages` の原本読込・byte検査・破棄の契約は変更しない。
- 通常合成画像のURLと原本の読込結果をそれぞれのsource keyに対応づけ、差替え直後や失敗時に前の画像を現在の原本として表示しない。古い非同期完了とunmountの解放を維持。Appのdocument clone・正規化・履歴・保存経路は変更なし。
- 修正前に、document相当のclone直後に原本canvasが失われるNode試験の失敗を確認。修正後は関連32件が成功し、storage／byteLength変更、A→B→Aの遅延完了、読込失敗後の復旧も実componentをhook mockした試験で確認。
- 実browserの既存fixtureは50項目PASS。文字mutatorで40ptに変更して全documentをcloneしても、合成原稿21枚のcanvas置換・decodeは0回。先頭1枚の全画素一致、paint変更とsnapshot復元で再decodeなし、原本差替え時は1枚だけdecode、欠損時の診断、unmountの解放を確認。検証用の一時原本2件は同じテストの終了処理で回収した。
- 全Node 1,319件中1,316成功・3skip（sandboxで待受拒否された5ケースは通常権限で再試験して成功）。型検査428ファイルはerror/warning 0・既存hint 9、通常／単一HTML build成功。read-onlyレビューにP1/P2指摘なし。
- 利用者の実原稿21件の再観測と実Appのフォルダー保存は未実施。合成原稿の結果を実作品の検証済みと同一視しない。次はR3の描画順へ進む。

#### 2026-10-27 09:35 JST: R3 コマ枠と吹き出しの重なり

- 通常の吹き出しをコマ枠より下へ、ページ直描きとページ前景は内枠一致辺を含む枠より上へ統一。`MangaCanvas` のDOM順も画面の重なりへ合わせ、V/Tのhit順を保持した。既存frame passを増やさず、断ち切り・多角形のgeometryは変更していない。
- 共通合成のbubble描画本体をローカルhelper一つにし、通常コマは枠前、ページ前景は前景人物後に各1回呼ぶ。PNG／PSD／生成入力は同じ合成canvasを使う。`paintScene` のページ直描きowner順も前景人物より下へ合わせ、パレットとpaint pickの逆順処理を共通のsceneへ接続した。
- 現行NDM日英、生成prompt、標準設定と翻訳を同じ重なり順へ更新。保存済み作品の `artwork_settings/layout_spec` を自動置換していない。標準候補の新規項目は既存どおりOFFで、実モデル試行も行っていない。
- 修正前の描画順4ケースとpage owner順1ケースの失敗を確認してから修正。関連Node 104件が成功。全Node 1,322件中1,319成功・3skip・失敗0（待受を含むため許可済みの通常権限で実行）。型検査428ファイルはerror/warning 0、既存hint 9。通常／単一HTML build成功、既存のbuild注意は継続。
- 既存 `bubbleTail.browser` を拡張し、実MangaCanvas・実canvas合成の27項目PASS。枠の両半分と線幅・濃度、断ち切り、多角形、非表示枠、ガイド有無、ページ直描き／前景／生成絵／原本の重なり、V/Tの前面hitを確認。PNG再decodeの全RGBA画素とPSD非圧縮3面の全RGB画素が合成canvasに一致した。PSDはbyte構造・画素の検証であり、Photoshop等での実読込試験ではない。
- 合成用の検証原本4件は一時UUIDで保持して終了処理で回収。実原稿・その保存済みassetは変更なし。read-onlyレビューに追加のP1/P2指摘なし。実原稿の接触部とOSフォルダー保存はR9で保全後に確認する。

#### 2026-10-27 09:43 JST: R4a キャンバス選択のレイヤー表示

- `selectedElement` をそのままパレットへ渡し、既存 `paintDocument` の変換helperをAppの描画先決定とパレット表示で共用。通常文字・通常画像・無効なindexを背景ownerへ変換せず、背景へのfallbackは描画開始側だけに保持した。別の選択storeは追加していない。
- 対象のコマ／人物／吹き出しを展開し、原本には専用owner見出しを表示。実paint layerの選択とは分け、配置選択では1行だけに `aria-selected` と選択色を付ける。人物だけのページ前景もレイヤー一覧へ表示する。
- 既存 `canvasSelectionScrollRequest` とドック開閉状態で表示位置を合わせる。古いrAFを破棄し、focusを奪わない。レビューで見つかった「ドック閉鎖中の選択を再表示時にscrollしない」「通常画像で既存コマ表示まで消す」の2件を修正し、再レビューで追加のP1/P2なし。
- 関連Node 117件成功、型検査428ファイルはerror/warning 0・既存hint 9。既存 `layerInteraction.browser` に隔離4335の実App検証を加え、20項目PASS。人物・吹き出し・原本・通常文字、同一再選択、A→B高速切替、コマ外／別ページ、fold/dock再表示、focus保持、ペン非起動、Undo・保存原稿不変を確認。追加のネイティブクリックでも2コマ目人物とレイヤー・コマ情報の一致を確認した。
- 検証用作品は4335 originに限定し、別のepisodeがあれば上書きを拒否する。実モデル・resident serviceへの呼出しはfixtureで拒否。利用者の実原稿と4325のタブは未操作。owner見出しクリックと実描画layerクリックの責任分離は次のR4bで行う。

#### 2026-10-27 09:53 JST: R4b owner選択と描画layerの分離

- 既存のcanvas→owner変換に逆方向の検証付き変換を加え、人物・吹き出し・原本の見出しを `selectCanvasElement` へ集約。非描画時の `actOnLayer` と描画中の `PaintEditor.selectOwner` の両入口で同じ責任に揃えた。従来の吹き出し専用選択は置換し、選択store・第二の描画開始経路を追加していない。
- 実child layerはID付きの既存描画経路、背景は既存の描画／3D入口を維持。3D内の人物選択callbackは変更していない。見出しで戻る前に既存closeを待ち、保存失敗なら配置選択へ移らない。明示選択の成功後にだけ自動描画復帰を解除する。
- 修正前に「人物見出しがopenPaintへ進む」「描画中の見出しがpaint layerを選ぶ」の2失敗を再現。修正後は関連Node 121件成功、型検査428ファイルはerror/warning 0・既存hint 9。read-only reviewにP1/P2なし。
- 隔離4335の実Appで35項目PASS。通常コマ／ページ前景の人物・吹き出し・原本の見出し、人物／原本のchild layer開閉、背景描画・3D入口の有効化、自動再開の抑止、Undo・保存原稿・artwork不変を確認。ネイティブクリックでも原本owner行を選択できた。初期の吹き出しには描画子layerがないため、その子layerの実UIは今回のfixture条件に含めていない。
- R1/R2の実PaintEditor回帰も50項目再成功。無描画close/cancelのPNG反映0回、Undo/Redo、未保存resume、欠損修復、保存失敗後の再試行を保持。利用者の実原稿・フォルダー保存・実3Dモデル操作は未実施。別作業7ファイルはbyte不変、pushなし。
