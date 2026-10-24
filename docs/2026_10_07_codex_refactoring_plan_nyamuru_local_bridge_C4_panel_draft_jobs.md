# Phase C4 下書きジョブ管理の抽出計画

下書きの生成・再照合・履歴取得・レビューを仲介する`PanelDraftJobService`を、`nyamuru_local_bridge.py`から`nyamuru_panel_draft_jobs.py`へ移す。同じattemptの再要求、生成結果が不明なときの扱い、台帳への記録、HTTP応答を維持する。

**今回はC4の詳細計画まで。実装は、この計画を確認した後の実行指示を受けて開始する。** C4に必要なサービス識別2定数の共通化も、この計画内で対象・手順を定める。Phase Dへは進まない。

- 状態: **計画のみ。C4のコード変更は未着手。**
- 対象: `<repository-root>`
- 基準: C2・C3完了コミット`b9f1fef`。bridgeは1,624行。
- 親計画: [Phase C 生成処理と下書き台帳の分割計画](2026_10_07_codex_refactoring_plan_nyamuru_local_bridge_C_generation.md)
- 行番号は基準コミット時点。実装時は現在のシンボル境界で再確認する。

## 1 変更範囲と実装単位

| ファイル | C4の実装時に行う変更 |
|---|---|
| `scripts/nyamuru_panel_draft_jobs.py` | 新規。`PanelDraftJobService`全体と`PANEL_DRAFT_BRIDGE_VERSION`を収容 |
| `scripts/nyamuru_bridge_identity.py` | 新規。`LAYOUT_PROTOCOL_VERSION`と`BRIDGE_SERVICE_NAME`だけを収容 |
| `scripts/nyamuru_local_bridge.py` | 上記クラス・3定数の定義を削除し、同じ4公開名を再export |

実装・検証・コミットは、この3ファイルを一組として行う。新しいidentityファイルはjobsとbridgeで識別値を共有するために必要であり、Phase Dの定数整理とは範囲を分ける。

現行構成に同じ責務のjobs・identityモジュールは存在しない。既存の台帳、ComfyUI生成、workspace管理を直接利用し、それらの代替クラスや経路は追加しない。

既存テストの必須patch変更は現行調査では0件。実装時に想定外の失敗が出た場合は、名前の解決先と元の挙動を確認する。修正対象を増やす前に共有掲示板を更新し、アサーションやケースの削除で通過させない。

`LocalVisionState`、`BridgeHandler`、CLI、起動・終了処理はbridgeに残す。C1・C2・C3のモジュール、フロント、Qwen・Krea2生成、共有LLM管理、画像生成lease、保存schemaは変更しない。import整理や新しいロックの導入も含めない。

## 2 移動する定義

### 3定数の所有先

| 定数 | 基準行 | 維持する値 | 移動先 |
|---|---:|---|---|
| `LAYOUT_PROTOCOL_VERSION` | 223 | `3` | `nyamuru_bridge_identity.py` |
| `BRIDGE_SERVICE_NAME` | 224 | `"nyamuru-image-hub-local-bridge"` | `nyamuru_bridge_identity.py` |
| `PANEL_DRAFT_BRIDGE_VERSION` | 233 | `"panel-draft-ledger-v2"` | `nyamuru_panel_draft_jobs.py` |

identityには定数2つと説明用docstringだけを置く。環境変数、path、他モジュールへのimport、クラス、初期化処理は追加しない。サービス名やversionを更新する作業ではない。

`MAX_BODY_BYTES`、`ALLOWED_ORIGIN`、LLMモード、解析用定数はbridgeに残す。台帳のschema・provenance versionはC2、palette・変換versionはC3の定義をそのまま参照する。

### ジョブ管理クラス

`PanelDraftJobService`全体、302〜587行の286行を移す。`class PanelDraftJobService:`から次の`class LocalVisionState:`直前までを切り出す。全12メソッドの本文、コメント、decorator、型注釈を保持する。

| メソッド | 基準範囲 | 維持する責務 |
|---|---|---|
| `__init__` | 303〜305 | 引数のworkspace・generatorをそのまま保持 |
| `ledger` | 307〜309 | workspace tokenから2つのrootを取得し、台帳を生成 |
| `checked_integer` | 311〜315 | boolを除く1以上の整数を検証 |
| `load_plan` | 317〜326 | 保存済みplanのbyte読取・JSON decode・固定設定の再検証 |
| `provenance` | 328〜408 | 実行・入力・環境・モデル・変換・方針の記録を構築 |
| `_outcome` | 410〜423 | エラーを整形し、provenance付きで状態を台帳へ記録 |
| `_result` | 425〜452 | 成功artifactを再検証して画像応答を構築、またはattemptを返す |
| `_complete` | 454〜483 | PNG取得、4色変換、成功保存、応答構築 |
| `generate` | 485〜536 | 入力保存、重複判定、submit、待機、状態記録 |
| `reconcile` | 538〜569 | 保存済みplanを使い同じprompt IDのhistory・queueを照合 |
| `list` | 571〜575 | コマ単位のattempt一覧を取得 |
| `review` | 577〜587 | revision・nonce・artifact hashを台帳のreview処理へ渡す |

範囲はdecoratorを含む。C4ではクラス本文へのimport追加も不要であり、末尾の空行調整以外は完全一致を条件とする。

## 3 importと依存関係

jobsのimportと定数は次の形にする。

```python
from __future__ import annotations

import json
import platform
from datetime import datetime, timezone
from typing import Any

from nyamuru_bridge_identity import BRIDGE_SERVICE_NAME, LAYOUT_PROTOCOL_VERSION
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


PANEL_DRAFT_BRIDGE_VERSION = "panel-draft-ledger-v2"
```

この後に既存クラスを置く。`EpisodeWorkspaceManager`は型注釈にも必要な通常importとし、今回`TYPE_CHECKING`への変更は行わない。

依存方向はbridgeからjobs、jobsからidentity・workspace・ledger・comfy。jobsからbridgeへの逆importを作らない。`ComfyUIObservationUnavailable`は`ComfyUIUnavailable`の派生例外として捕捉されるため、jobsへ新たな個別catchを追加しない。

C2・C3の相互呼び出しは今回変更しない。ledgerはcomfyを通常importし、comfyの`generate`内だけにledgerの遅延importがある状態を維持する。jobsの追加で初期化時の循環を作らない。

jobsのimportだけではworkspaceや台帳をインスタンス化しない。Pillowのバージョン取得は`provenance`内の遅延importのままにし、未導入時の`"unavailable"`も維持する。`provenance`呼び出し時には既存のcheckpoint identity確認が走るため、一時検証では実モデルを参照しないfixture用のcheckpoint rootを明示する。

## 4 bridgeと利用元の互換性

bridgeは、既存のscript path設定後のimport群で次の4公開名を再exportする。

```python
from nyamuru_bridge_identity import (
    LAYOUT_PROTOCOL_VERSION,
    BRIDGE_SERVICE_NAME,
)
from nyamuru_panel_draft_jobs import (
    PANEL_DRAFT_BRIDGE_VERSION,
    PanelDraftJobService,
)
```

値の複製や互換クラスを置かず、定義元を直接参照する。bridgeの既存標準importも残す。jobsの`json`・`platform`などは同じ標準moduleを参照する形式を維持する。

`LocalVisionState`の646〜647行では、generatorを作ってから同じworkspace・generatorのインスタンスをjobsへ渡している。この生成順と参照を維持する。`__init__`への通信、台帳のキャッシュ、追加ロックを導入しない。

| HTTP入口 | 既存の委譲先・応答 |
|---|---|
| `/api/panel-draft/generate` | `panel_draft_jobs.generate(body)`の結果を200で返す |
| `/api/panel-draft/list` | `panel_draft_jobs.list(body)`の結果を200で返す |
| `/api/panel-draft/reconcile` | `panel_draft_jobs.reconcile(body)`の結果を200で返す |
| `/api/panel-draft/review` | `panel_draft_jobs.review(body)`の結果を200で返す |

例外は既存handlerの共通処理へ渡す。`ValueError`は400、`ComfyUIUnavailable`とその派生例外は503、その他の一般例外は500という扱いを維持する。保存競合などに使う既存の専用409 catchも変更しない。

識別2定数の移動は、jobsのprovenanceだけでなく、`send_json`、health、解析結果にも関係する。これらのメソッド本文を変えず、従来のサービス名・protocol versionを返し続けることを確認する。

## 5 生成と再照合で維持する契約

### 入力保存と同じattemptの再要求

`generate`はworkspaceから台帳を取得し、固定生成設定、job・attempt・retry元ID、series・episode ID、OMNY snapshotを検証する。workflowを構築し、`begin_attempt`で入力を保存した後にsubmitへ進む。この順序を変更しない。

`begin_attempt`が既存attemptを返した場合の分岐は次のとおり。

- succeededなら`_result`で保存済み結果を返す。
- failedなら、新しいattempt IDが必要という`ValueError`を返す。
- それ以外は同じattemptを`reconcile(..., wait=True)`へ渡す。再submitしない。

新しいattemptによるretryは、既存の明示的なretry元指定と台帳側の検証を利用する。自動再試行、IDの再採番、入力snapshotの置換は追加しない。

### 保存状態と応答の区別

台帳へ状態を記録することと、呼び出し元へ正常応答を返すことは別である。次の既存分岐を保持する。HTTP欄は共通handlerまで通した場合を表す。

| 処理と条件 | 台帳へ記録する状態とerror code | 呼び出し元への結果 |
|---|---|---|
| generateのsubmit・queued記録のtry内で`Exception` | unknown / `submit_outcome_unknown` | 元の例外を再送出。例外型により400・503・500 |
| generateの待機・完了処理で`ComfyUIUnavailable` | unknown / `execution_outcome_unknown` | 再送出、503 |
| generateの待機・完了処理でその他の`Exception` | failed / `execution_failed` | 再送出、元の例外型に従う |
| reconcileでhistory出力なし、queue内に存在 | queued、provenance付き | attemptを正常応答、200 |
| reconcileでhistoryにもqueueにも存在しない | unknown / `not_in_comfyui_queue_or_history` | attemptを正常応答、200 |
| reconcileの観測・完了処理で`ComfyUIUnavailable` | unknown / `reconcile_unavailable` | 再送出、503 |
| 同じtry内でそれ以外の`RuntimeError` | failed / `comfyui_execution_failed` | attemptを正常応答、200 |
| 同じtry内でその他の`Exception` | failed / `artifact_validation_failed` | 保存したエラーメッセージの`ValueError`、400 |

表のunknownは実際には`outcome_unknown`という状態名。`RuntimeError`のcatchはhistory失敗だけに限定されていないため、C4で意味を狭めたり捕捉順を変えたりしない。

submit側のtryには、submit後のprovenance作成とqueuedの保存も含まれる。`Exception`を`BaseException`へ広げない。`SystemExit`による中断後にcreatedが残り、historyで復旧する既存テストの前提を維持する。

reconcileでは台帳取得・ID検証・attempt読取・`load_plan`と、既存のsucceeded／failed分岐がtryより前にある。ここでの例外を新たにfailed記録へ巻き込まない。failedの正常応答でも、その前に保存済みplanを読む現在の順序を保持する。

### 成功保存と応答

`_complete`は原PNG取得、4色変換、provenance構築、`complete_success`、`_result`の順を保つ。createdから復旧するときは、同じprompt IDのhistory出力という記録と`recovering_created_from_history`を渡す。台帳側の検証・transactionはC2の実装をそのまま利用する。

`_result`は成功artifactに対して、出力とOMNY・plan・workflowのhashを指定してresolverを呼ぶ。検証を省略して保存pathやPNGを直接返さない。成功応答の画像・download名・job／attempt・review・artifacts・audit eventsのフィールドを維持する。

非成功、または成功recordにcomposite辞書がない場合の`{"ok": True, "attempt": record}`も現行どおり残す。採用済みreviewを成功画像取得の新条件にしない。

### provenanceとレビュー

provenanceのschema、時刻、job・attempt・source、実行エンジン、prompt ID、bridge識別値、Python・Pillow version、checkpoint identity、固定設定、palette、入力artifact、任意の出力情報・エラーを維持する。生成結果の記録に実モデル確認済みという新たな断定を加えない。

`automatic_retry`、`automatic_review_acceptance`、`automatic_omny_update`はすべてFalseのまま。`_outcome`のpath除去などのエラー整形と、provenanceを状態履歴へ渡す順序も保持する。

`list`はページ・コマの1以上の整数検証を行う。`review`はattempt、decision、expected revision、nonce、artifact SHA、noteを既存の`ledger.set_review`へ渡す。競合判定や冪等性をjobs側へ複製せず、採用操作を自動化しない。

## 6 既存テストと一時検証

### 実装前後に実行する既存スイート

| スイート | 確認する範囲 |
|---|---|
| `tests.test_panel_draft_ledger_bridge` | 台帳8ケース、ジョブ管理10ケース、境界3ケース。重複submit、created／unknownからの復旧、観測失敗、履歴・review・resolver |
| `tests.test_scanner_bridge` | bridgeの識別値、C1・C3の生成補助処理、固定workflowと既存接続 |
| `tests.test_episode_workspace_bridge` | workspaceの選択・復元・既存接続 |
| `tests.test_source_coverage_bridge` | workspaceと保存処理の回帰確認 |
| `tests.test_project_store_bridge` | プロジェクト保存・HTTP応答の識別値 |
| `tests.test_series_background_bridge` | 背景素材保存・HTTP応答の識別値 |
| `tests.test_workspace_doctor_core` | 台帳schema・trigger契約と診断の回帰確認 |
| `tests/localBridge.test.mjs` | clientの識別値・生成・履歴・再照合・review契約 |
| `tests/panelActions.test.mjs` | C1の要求・表示契約の回帰確認 |
| `tests/panelDraft.test.mjs` | 下書きの固定設定と入力契約 |
| `tests/localBridgeLifecycle.test.mjs` | mock付きの起動管理・lease・共有LLM復帰のclient契約 |

親計画の関連7 Pythonスイートと4 Nodeファイルを実装前後で実行する。lifecycleのテストは実サービスを起動する検証ではない。doctorの全ケースが本番台帳を作るわけではなく、本番schema・triggerを直接確認するのは`test_contract_accepts_the_current_production_ledger_schema`である。

基準ソースの静的集計ではPython 194メソッド、Node 72テスト。これは実行済み件数ではなく、実装時の検出件数・成功・skipは別に記録する。

ジョブ管理の10ケースでは、壊れたprompt応答・history・HTTP transport・queueの上流503でunknownを保存して例外を再送出する経路と、queue・historyに存在せずunknownを正常応答する経路を区別している。出力なしのhistory完了記録をfailedの正常応答にするケースも維持する。これらはservice層の検証であり、bridge自身のHTTP statusを直接確認するものではない。

既存patchは同じオブジェクトへの参照で維持する。generatorのinstance method、`bridge.PanelDraftLedger.set_status`、`bridge.urllib_request.urlopen`、B2の`episode_workspace.choose_episode_directory`の参照先を変えない。

既存テストは保存provenanceの下書きversionを確認しているが、そのservice名・protocol versionとHTTP応答の一致を直接は確認していない。また、jobsの`list`・`review`を通るPythonケースはなく、台帳のreview検証とNode側のmockが中心である。この2点は下記の一時検証で補う。

### 抽出に伴う一時的な確認

恒久テストを機械的に追加する代わりに、次の確認を実装時の一時スクリプトなどで行う。

1. **本文一致**: クラス全12メソッドと3定数を基準ソースと比較する。bridge残部は定義削除・import追加以外がbyte一致し、C1・C2・C3のファイルが不変であることを確認する。
2. **定義元と公開名**: bridgeの4公開名、jobsが参照するworkspace・ledger・comfyのクラスと定数が同じオブジェクトであることを確認する。identityの2定数はASTでも所有先と直接importを確認し、同じ値の別定義を見逃さない。再帰的なglobal参照、型注釈の解決、例外継承も検証する。
3. **単独importと順序**: 別プロセスでidentity、jobsの単独import、および`jobs → comfy → ledger`と`comfy → ledger → jobs`を確認する。site packagesなし、bridge未読込で成立し、Pillow読込、通信、モデル読取、DB作成・移行、ファイル書込、子プロセス起動をimportだけで要求しないことを確認する。C2・C3の両順のimport確認も保持する。
4. **provenanceとHTTPの識別値**: fixture用checkpoint rootを使った実jobsのprovenanceと、メモリ内handlerの`send_json`・healthが同じservice名・protocol versionを返すことを確認する。下書きversionとpaletteも元の定義と照合する。healthのstate.checkは模擬値にし、実サービスや実モデルへ接続しない。
5. **移動後のserviceからHTTPまで**: 一時workspace・SQLite・人工PNGとgeneratorのmockで実jobsを使い、generate／reconcileの観測失敗がunknown保存後に503となること、history・queueに無い結果がunknownの200となること、出力なしhistoryがfailedの200となることを確認する。成功、list、reviewの委譲と応答フィールドも確認する。reviewの競合処理全体は既存台帳テストを利用する。
6. **C1の例外互換性**: メモリ内handlerで`PanelActionLLMUnavailable`が503に変換されることも確認する。実LLM・サーバー起動は使わない。

一時検証のHTTP部分では、実際の`do_POST`・`read_json`・`send_json`を通し、status・JSON・識別値を確認する。ComfyUIが返した上流503と、bridgeが返す503を混同しない。テストごとに独立した台帳を使い、正常／失敗の状態を持ち越さない。

## 7 実装手順と完了条件

実装指示を受けてから、次の順で進める。

1. Git状態と共有掲示板を確認し、回復点となるHEADを記録する。bridgeとC1〜C3が検証済みの版と一致するか確認し、実装3pathをclaimする。
2. 下記のPython・Nodeスイートを実行し、失敗とskipを基準として記録する。
3. identityへ2定数、jobsへ1定数とクラス全文を移す。bridgeに4公開名の直接importを追加し、元の定義を削除する。
4. compile、既存スイート、一時検証を実行する。必要な修正後、該当する検証を再実行する。
5. 独立した読み取り専用レビューを受け、全差分とステージ済み差分を確認し、3ファイルをまとめてローカルコミットする。
6. 作業ファイル・テスト済みhash・完了コミットが一致することを確認し、共有掲示板のclaimを解放する。利用者の未追跡計画書を含めない。

既存環境を使用し、依存追加や環境の作り直しは行わない。

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

Pillowを使う画像境界ケース、jsonschemaなどの任意依存によるskipは実行時に確認し、未実行を合格に数えない。この計画作成では実装後テストを実行済みとは扱わない。

コミット例は`refactor: extract panel draft job service from local bridge`。完了条件は、3ファイルの抽出と接続、本文・公開名・保存状態・HTTP契約の維持、関連検証とレビューの通過、コミットと作業ファイルの一致。

実原稿・実台帳への保存や移行、実ComfyUIの画像生成、モデル取得、常駐サービスの起動・再起動、push、Phase Dの開始は含めない。完了報告では、実装コミット、検証結果、skip、実環境で未確認の範囲を分けて示す。
