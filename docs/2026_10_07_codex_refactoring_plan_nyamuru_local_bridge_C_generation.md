# Phase C 生成処理と下書き台帳の分割計画

人物アクション、下書き台帳、ComfyUI生成、下書きジョブ管理を専用モジュールへ移す。生成指示・保存形式・失敗判定・HTTP契約は維持する。実装は **C1 → C2とC3を同じ変更単位で実施 → C4** の順で進め、各段階で検証とローカルコミットを行う。

- 計画作成時点: B2完了`a30c30d`。Phase Cの実装は未着手。
- 対象: `<repository-root>`
- 親計画: bridge全体の分割計画（ローカル資料 `2026_10_07_grok45_refactoring_plan_nyamuru_local_bridge.md`、配布対象外）
- 前段: [B2計画](2026_10_07_codex_refactoring_plan_nyamuru_local_bridge_B2_episode_workspace.md)
- 以下の行番号は基準コミット時点の目安。切り出しはシンボルで判定する。

## 1 分割先と実装順

| 段階 | 新モジュール | 移すクラス | 現行クラスの行数 |
|---|---|---|---:|
| C1 | `scripts/nyamuru_panel_actions.py` | `PanelActionSuggester`、`PanelActionLLMUnavailable` | 主クラス456行 |
| C2 | `scripts/nyamuru_panel_draft_ledger.py` | `PanelDraftLedger` | 997行 |
| C3 | `scripts/nyamuru_comfy_draft.py` | `ComfyUIDraftGenerator`、`ComfyUIUnavailable`、`ComfyUIObservationUnavailable` | 主クラス510行 |
| C4 | `scripts/nyamuru_panel_draft_jobs.py` | `PanelDraftJobService` | 286行 |
| C4の共通定義 | `scripts/nyamuru_bridge_identity.py` | クラスなし。サービス識別用の2定数のみ | 数行 |

親計画の「3ファイル」という本文と4件の一覧は一致していないため、一覧の4つの処理単位を採用する。さらに、jobsからbridgeを逆importしないため、C4で識別定数だけの共通ファイルを追加する。新規実装ファイルは合計5つ。

実装時の編集対象は、各段階の新モジュールと`nyamuru_local_bridge.py`。既存テストの必須変更は現行調査では0件。予期せぬテスト修正が必要になった場合は名前の解決先を確認し、共有掲示板の対象を更新してから最小限に修正する。アサーションやケースを削除しない。

bridgeは現在3,606行。Phase C後はおおむね1,400行前後を見込む。`LocalVisionState`、HTTPハンドラ、起動処理は残るため、親計画の500行以下という最終目標はPhase Dで扱う。

## 2 相互依存の扱い

台帳と生成クラスには、次の実際の呼び出しがある。

| 呼び出し元 | 呼び出し先 | 箇所 |
|---|---|---|
| `PanelDraftLedger.complete_success` | `ComfyUIDraftGenerator.validate_png_bytes` | 原画像と4値画像の2回 |
| `PanelDraftLedger.set_review` | 同上 | 1回 |
| `PanelDraftLedger.resolve_succeeded_artifact` | 同上 | 1回 |
| `ComfyUIDraftGenerator.generate` | `PanelDraftLedger.checked_id` | 1回 |

両方をモジュール先頭で相互importすると、クラス定義途中の参照が生じる。今回はメソッドの切り分けやPNG検証の共通関数化を行わず、次の接続にする。

1. ledgerはcomfyから生成クラス、`MAX_COMFY_IMAGE_BYTES`、`PANEL_DRAFT_ID_PATTERN`を通常importする。
2. comfyはledgerをモジュール先頭でimportしない。
3. `ComfyUIDraftGenerator.generate`内だけ、既存の`normalized_request`呼び出し後、`checked_id`を呼ぶ直前にledgerのimportを1行追加する。

```python
def generate(self, body: dict[str, Any]) -> dict[str, Any]:
    value = self.normalized_request(body)
    from nyamuru_panel_draft_ledger import PanelDraftLedger
    prompt_id = PanelDraftLedger.checked_id(body.get("attempt_id"), "attempt ID")
    # この後の既存処理はそのまま移す。
```

`PANEL_DRAFT_ID_PATTERN`はcomfyに定義し、ledgerはそこから参照する。この定数をledgerからcomfyへ通常importすると、再び初期化時の循環になる。

**この構成は初期化時の循環を避けるが、実行時のクラス間の相互参照は残る。** 完全な一方向依存への変更は今回の完了条件ではない。後続で必要になれば、UUID正規表現とID検証だけを共通化し、既存の`PanelDraftLedger.checked_id`を互換入口として残す。PNG検証まで移す必要はない。

C2とC3は両方のファイルを作成し、bridgeの接続まで完了してから検証・コミットする。C2だけ、またはC3だけの不完全な状態を完了コミットにしない。

## 3 C1 人物アクションと関連処理

### 移動範囲

- `PanelActionSuggester`全体。302〜757行。
- `PanelActionLLMUnavailable`全体。761行から。
- `MAX_PANEL_ACTION_RESPONSE_BYTES`
- `DEFAULT_PANEL_ACTION_LLM_URL`
- `SHARED_PANEL_ACTION_LLM_MODEL`

クラスには人物アクションの統合だけでなく、生成指示の一括英訳と参照資料候補の整形も含まれる。この段階では分けずに移す。`suggest_reference_text`は規則による選択であり、LLMの起動・問い合わせを追加しない。

`PANEL_ACTION_LLM_MODE_MANAGED`、`PANEL_ACTION_LLM_MODE_AUTO`、`PANEL_ACTION_LLM_MODE_EXTERNAL_SHARED`は、引数処理と状態の配線で使うためbridgeに残す。

### importと互換性

必要な標準importは`json`、`re`、`sys`、`unicodedata`、`Any`、`HTTPError`、`URLError`、`urlparse`、`from urllib import request as urllib_request`。`from __future__ import annotations`も維持する。

bridgeは上記3定数と2クラスを再exportする。`LocalVisionState`の生成・モデル指定・ロックと、HTTPからの呼び出しは変更しない。

### 維持する動作

現在のシステムプロンプトを文字列ごと保持する。表情・演技の優先順位、対象ID、reconcile方式、応答テンプレート、出力予算、本文上限、timeout、temperature、モデル指定を変更しない。診断ログへ原稿本文を追加しない。一括英訳の対象identity検証と、資料候補が曖昧な場合の選択保留も維持する。

## 4 C2とC3 台帳とComfyUI生成

### 台帳側

`PanelDraftLedger`全体、765〜1761行を移す。クラス本体は変更しない。

ledgerが定義を持つ6定数:

- `MAX_PANEL_DRAFT_OMNY_BYTES`
- `MAX_PANEL_DRAFT_SNAPSHOT_BYTES`
- `PANEL_DRAFT_STATUS_VALUES`
- `PANEL_DRAFT_REVIEW_VALUES`
- `PANEL_DRAFT_LEDGER_SCHEMA_VERSION`
- `PANEL_DRAFT_PROVENANCE_VERSION`

標準importは`hashlib`、`json`、`os`、`re`、`sqlite3`、`tempfile`、`contextmanager`、`datetime`、`timezone`、`Path`、`PurePosixPath`、`Any`とfuture annotations。モジュール間のimportは次の3つ。

```python
from nyamuru_comfy_draft import (
    ComfyUIDraftGenerator,
    MAX_COMFY_IMAGE_BYTES,
    PANEL_DRAFT_ID_PATTERN,
)
```

台帳の保存先はコンストラクター引数から決まる。bridgeの`REPO_ROOT`やworkspace管理クラスへの依存を追加しない。SQL、トランザクション範囲、schema移行、起動時の補完、追記専用トリガー、artifactの書込・fsync・置換・DB登録順序をそのまま移す。

### ComfyUI側

次の定義をまとめて移す。

- `ComfyUIUnavailable`。1764行から。
- `ComfyUIObservationUnavailable`。1768行から。親例外との継承関係を維持。
- `ComfyUIDraftGenerator`全体。1772〜2281行。

comfyが定義を持つ16定数:

| 用途 | 定数 |
|---|---|
| 接続先 | `DEFAULT_COMFYUI_URL` |
| 固定生成設定 | `PANEL_DRAFT_CHECKPOINT`、`PANEL_DRAFT_PROFILE`、`PANEL_DRAFT_WIDTH`、`PANEL_DRAFT_HEIGHT`、`PANEL_DRAFT_STEPS`、`PANEL_DRAFT_CFG`、`PANEL_DRAFT_SEED` |
| 色変換 | `MANGA_BASE_PALETTE`、`MANGA_BASE_RGB` |
| 上限 | `MAX_COMFY_JSON_BYTES`、`MAX_COMFY_IMAGE_BYTES`、`MAX_PANEL_DRAFT_CHECKPOINT_BYTES` |
| attempt ID | `PANEL_DRAFT_ID_PATTERN` |
| 色変換の識別 | `MANGA_BASE_TRANSFORM_VERSION`、`MANGA_BASE_PALETTE_VERSION` |

変換・パレットのversionは現在jobsだけが参照しているが、生成側の実装を識別する値なのでcomfyに置く。定数の値は変更せず、palette辞書も複製しない。

標準importは`base64`、`hashlib`、`io`、`json`、`os`、`re`、`secrets`、`stat`、`time`、`unicodedata`、`zlib`、`HTTPException`、`Path`、`PurePosixPath`、`Any`、`HTTPError`、`URLError`、`urlencode`、`urlparse`、`urllib_request`とfuture annotations。`urllib_request`はC1と同じmodule import形式を使う。

Pillowのimportは`manga_base_png`と`validate_png_bytes`の内部に残す。モジュールを読み込むだけでPillow、ネットワーク、DB初期化が必要になる変更は加えない。

### 既定のcheckpoint保存先

新モジュールも`scripts`直下に置き、次のように同じ配置基準から算出する。

```python
REPO_ROOT = Path(__file__).resolve().parents[1]
TOOLS_ROOT = REPO_ROOT.parent
```

コンストラクターの`TOOLS_ROOT / "ComfyUI" / "models" / "checkpoints"`は変更しない。現在のbridgeから得られる既定値との一致を確認する。bridgeの既存path定義は残し、新しい絶対pathの固定やworker runtimeへの依存は追加しない。

### bridgeへの接続と不変条件

ledgerのクラスと6定数、comfyの3クラスと16定数をbridgeで再exportする。`generate`への遅延import1行を除き、クラス本文をそのまま保持する。PNG検証を台帳内へ複製したり、staticmethod・classmethodを別の関数呼び出しへ変更したりしない。

固定workflow、512角・20 steps・CFG 6などの設定、指定attempt IDの送信と応答一致、360秒の待機上限と0.5秒の待機間隔を維持する。PNGのCRC・寸法・完全性・4色検証、出力path検証、checkpointのverifiedとunverifiedの区別も変更しない。

## 5 C4 下書きジョブ管理

### 移動範囲

- `PanelDraftJobService`全体。2284〜2569行。
- `PANEL_DRAFT_BRIDGE_VERSION`。

標準importは`json`、`platform`、`datetime`、`timezone`、`Any`とfuture annotations。`provenance`内のPillowバージョン確認は遅延importのまま残す。

モジュール間の依存は次のとおり。

```python
from nyamuru_episode_workspace import EpisodeWorkspaceManager
from nyamuru_panel_draft_ledger import (
    MAX_PANEL_DRAFT_OMNY_BYTES,
    MAX_PANEL_DRAFT_SNAPSHOT_BYTES,
    PANEL_DRAFT_PROVENANCE_VERSION,
    PanelDraftLedger,
)
from nyamuru_comfy_draft import (
    ComfyUIDraftGenerator,
    ComfyUIUnavailable,
    MANGA_BASE_PALETTE,
    MANGA_BASE_PALETTE_VERSION,
    MANGA_BASE_TRANSFORM_VERSION,
)
from nyamuru_bridge_identity import BRIDGE_SERVICE_NAME, LAYOUT_PROTOCOL_VERSION
```

### bridge識別定数

`nyamuru_bridge_identity.py`に、次の既存2定数だけを移す。

```python
LAYOUT_PROTOCOL_VERSION = 3
BRIDGE_SERVICE_NAME = "nyamuru-image-hub-local-bridge"
```

bridgeとjobsがこの同じ定義をimportする。jobs内の実行記録と、HTTP応答・解析結果の識別が一致したままになる。bridgeを逆importしたり、jobs内へ同じ値を複製したりしない。

これはC4で必要な2定数の移動に限る。body上限、Origin検査、LLMモード、解析用定数までまとめるPhase Dの定数整理は行わない。

### 接続と失敗判定

bridgeはjobsのクラス・定数と識別2定数を再exportする。`LocalVisionState`のコンストラクター、インスタンスの生成順序、各ロック、`BridgeHandler`の委譲は維持する。

特に次の区別を保持する。

- 同じattemptの再要求では重複submitせず、既存結果または同じprompt IDの照合へ進む。
- submit後の壊れた応答・切断・timeoutは、受理の有無が確定しないため`outcome_unknown`として扱う。
- queueやhistoryの観測失敗を、実行失敗や「存在しない」と見なさない。
- queueとhistoryの両方に見つからなくても、unknownを維持する。
- historyに実行失敗や出力なしの完了記録がある場合のfailed判定を維持する。
- 新attemptによる再試行、reviewのrevision・nonce・artifact一致、人による採用判断を維持する。自動再試行・自動採用・自動OMNY更新を追加しない。

## 6 テストの扱い

現行のPythonテストを検索した結果、Phase Cに必要なpatch先変更は0件。次の形式を維持すれば既存mockは有効である。

| 既存patch | 維持する理由 |
|---|---|
| `patch.object(bridge.urllib_request, "urlopen", ...)` | 同じ標準moduleオブジェクトを参照 |
| `patch.object(bridge.sys, "stderr", ...)` | 同じ`sys`を参照 |
| suggester・generatorのinstance method | 実際の同一インスタンスに対するpatch |
| `patch.object(bridge.PanelDraftLedger, "set_status", ...)` | 同一クラスの再exportに対するpatch |
| B2のworkspace picker patch | workspaceの参照先は今回移動しない |

`from urllib.request import urlopen`への変更や、bridge側への互換クラスの再定義は行わない。bridgeの既存標準importも、未使用に見えるものを今回まとめて削除しない。

### 段階ごとの検証

| 段階 | Pythonの既存スイート | Nodeの既存テスト |
|---|---|---|
| C1 | `tests.test_scanner_bridge`、`tests.test_episode_workspace_bridge` | `localBridge.test.mjs`、`panelActions.test.mjs` |
| C2とC3 | `tests.test_scanner_bridge`、`tests.test_panel_draft_ledger_bridge`、`tests.test_workspace_doctor_core` | `localBridge.test.mjs`、`panelDraft.test.mjs` |
| C4 | 下記の関連7スイート | 下記の4ファイル |

`test_workspace_doctor_core`は通常の`test:bridge`の対象外だが、本番の台帳クラスを生成し、テーブルとトリガーの契約を検証しているためC2から必須とする。

各段階の編集前後で該当スイートを比較する。実装時の実行環境は、リポジトリ内の既存`.local-vision/.venv/bin/python`を使う。C4時点の実行例:

```bash
.local-vision/.venv/bin/python -m py_compile \
  scripts/nyamuru_local_bridge.py \
  scripts/nyamuru_panel_actions.py \
  scripts/nyamuru_panel_draft_ledger.py \
  scripts/nyamuru_comfy_draft.py \
  scripts/nyamuru_panel_draft_jobs.py \
  scripts/nyamuru_bridge_identity.py

.local-vision/.venv/bin/python -m unittest \
  tests.test_scanner_bridge \
  tests.test_episode_workspace_bridge \
  tests.test_source_coverage_bridge \
  tests.test_panel_draft_ledger_bridge \
  tests.test_project_store_bridge \
  tests.test_series_background_bridge \
  tests.test_workspace_doctor_core

node --no-warnings --experimental-strip-types --test \
  tests/localBridge.test.mjs \
  tests/panelActions.test.mjs \
  tests/panelDraft.test.mjs \
  tests/localBridgeLifecycle.test.mjs

git diff --check
```

C1とC2・C3では、その時点で存在する対象モジュールのcompileと表の該当スイートを実行する。今回の計画作成では、これらの実装後テストを実行済みとは扱わない。

### 構造と接続の確認

通常のテストに加え、一時的な検証で次を確認する。

1. 定数・メソッド・SQL・プロンプト・コメント・decoratorの移動前後の一致。クラス本文の例外はC3の遅延import1行だけ。
2. bridgeの残りが定義削除とimport追加だけになっていること。`LocalVisionState`、HTTPハンドラ、起動・終了処理を含めて比較する。
3. 再exportした全クラス・例外・定数の同一性。特にpalette辞書、例外の継承、bridge・jobsの通信識別値を確認する。
4. 別プロセスで`comfy → ledger`と`ledger → comfy`の両順のimport、および新モジュールの単独importを確認する。テスト実行順によるmodule cacheに依存しないこと。
5. 既存mock付きの`ComfyUIDraftGenerator.generate`テストを通し、遅延import経路も実際に動かす。クラスをimportできるだけでは完了にしない。
6. 既定checkpoint pathが移動前と一致すること。importだけでネットワーク接続、モデル読込、DB作成や移行が起きないこと。
7. メモリ内の模擬HTTPハンドラで、`PanelActionLLMUnavailable`と`ComfyUIObservationUnavailable`が既存のHTTP 503へ変換されることを確認する。実サーバーは不要。

既存テストの「上流ComfyUIが503を返す」ケースは、bridge自身の503応答を検証するものではない。両者を区別して報告する。PNG検証、schema移行、unknownからの復旧などの既存挙動は、関連スイートの既存ケースで確認する。抽出内容をなぞるだけの恒久テストは追加しない。

## 7 変更しない領域

次のHTTP入口と、その要求・応答・例外契約を維持する。

- `/api/panel-actions/suggest`
- `/api/layer-generation/translate`
- `/api/panel-draft/generate`、`list`、`reconcile`、`review`
- series directoryとepisode reference-suggestからの資料候補処理
- healthなどで返すservice名とprotocol version

Qwen・Krea2の生成サービス、共有LLMの停止・再開、image generation lease、VLM、フロント、環境設定は対象外。`LocalVisionState`と`BridgeHandler`の移動もPhase Dに残す。

実データの保存や移行、モデルダウンロード、実画像生成、外部LLM呼び出し、常駐サービスの起動・再起動は、この抽出の検証には含めない。テストは一時フォルダ・人工画像・既存mockを使用する。

## 8 実装時の進め方と完了条件

1. 現在のGit状態とA1〜B2の抽出済み構成を確認し、回復点となるHEADを記録する。作業中のbridgeと完了版が一致するか確認する。
2. 共有掲示板を再読し、その段階の正確な対象pathだけをclaimする。
3. 基準テストを実行し、移動・import・再exportを行う。
4. 該当テストと構造・接続の検証を行い、独立した読み取り専用レビューを受ける。
5. 全差分とステージ済み差分を確認し、その段階のファイルだけをローカルコミットする。C2とC3は一緒に検証・コミットする。
6. 作業ファイルと完了コミットの一致を確認し、掲示板を更新する。古い本文への書き戻りなど想定外の差分があれば保全して確認し、検証済みとして進めない。

コミットの単位と例:

- C1: `refactor: extract panel action suggestions from local bridge`
- C2とC3: `refactor: extract panel draft ledger and ComfyUI generator`
- C4: `refactor: extract panel draft job service from local bridge`

全体の完了条件は、4つの処理単位と識別定数が指定モジュールへ移り、既存の公開名・保存内容・通信契約が保たれ、3段階すべての検証とレビューが通ること。初期化時の循環はなく、残る実行時の相互参照が2節の呼び出しだけで説明できること。新規依存の導入、push、Phase Dの開始は含めない。
