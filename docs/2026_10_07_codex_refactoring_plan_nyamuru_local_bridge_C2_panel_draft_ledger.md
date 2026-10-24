# Phase C2 下書き台帳の抽出計画

下書き生成の入力・結果・状態・レビュー履歴を保存する`PanelDraftLedger`を、`nyamuru_local_bridge.py`から`nyamuru_panel_draft_ledger.py`へ移す。保存先、SQLite schema、検証条件、ファイル保存とDB更新の順序を維持する。

**C2はC3のComfyUI生成クラスと相互参照があるため、実装・検証・コミットはC2とC3をまとめて行う。** 本計画はC2の詳細と、同時に成立させるC3側の接続を定める。C2だけを切り出した途中状態は完了扱いにしない。

- 状態: **計画のみ。C2・C3の実装は未着手。**
- 対象: `<repository-root>`
- 基準: C1完了コミット`59976e2`。bridgeは3,147行。
- 親計画: [Phase C 生成処理と下書き台帳の分割計画](2026_10_07_codex_refactoring_plan_nyamuru_local_bridge_C_generation.md)
- 行番号は基準コミット時点の目安。実装時は現在のシンボル境界で確認する。

## 1 変更範囲と実装単位

| ファイル | C2とC3の実装時に行う変更 |
|---|---|
| `scripts/nyamuru_panel_draft_ledger.py` | 新規。6定数と`PanelDraftLedger`全体を収容 |
| `scripts/nyamuru_comfy_draft.py` | C3の新規モジュール。親計画の16定数・3クラスと、generate内の遅延importを収容 |
| `scripts/nyamuru_local_bridge.py` | 対象定義を削除し、C2の7シンボルとC3の19シンボルを再export |

編集対象は上記3ファイル。既存テストの必須patch変更は現行調査では0件。予期せぬ修正が必要になれば名前の解決先を確認し、共有掲示板の対象を更新してから最小限に変更する。アサーションやケースを削除しない。

C1の人物アクション用モジュール、B2のworkspace管理、`PanelDraftJobService`、HTTPハンドラ、サービス識別定数は変更しない。ジョブ管理と識別定数の移動はC4に残す。

DBの新しい移行、保存方式の再設計、共通PNG検証関数の新設、状態遷移やレビュー条件の変更は含めない。実データの書き換えや移行を作業として実行しない。

## 2 移動する定義

### 6定数

| 定数 | 維持する値と用途 |
|---|---|
| `MAX_PANEL_DRAFT_OMNY_BYTES` | `5 * 1024 * 1024`。OMNY snapshotの上限5 MiB |
| `MAX_PANEL_DRAFT_SNAPSHOT_BYTES` | `2 * 1024 * 1024`。JSON snapshot・provenanceの上限2 MiB |
| `PANEL_DRAFT_STATUS_VALUES` | `created`、`queued`、`succeeded`、`failed`、`outcome_unknown` |
| `PANEL_DRAFT_REVIEW_VALUES` | `accepted`、`rejected` |
| `PANEL_DRAFT_LEDGER_SCHEMA_VERSION` | `2` |
| `PANEL_DRAFT_PROVENANCE_VERSION` | `2` |

現行225・226・230〜233行の定義を値ごと移す。文字列の保存上限はUTF-8のbyte数であり、文字数へ変更しない。`unreviewed`はレビュー未記録時の表示などで使われるが、新規のレビュー決定値へ追加しない。

`PANEL_DRAFT_ID_PATTERN`と`MAX_COMFY_IMAGE_BYTES`はC3に置き、ledgerからimportする。`PANEL_DRAFT_BRIDGE_VERSION`はC4までbridgeに残す。

### 台帳クラス

`PanelDraftLedger`全体、306〜1302行の997行を移す。`class PanelDraftLedger:`から次の`class ComfyUIUnavailable`直前までを切り出す。`SCHEMA_VERSION`、`ARTIFACT_SUFFIXES`もクラス属性のまま保持する。

全28メソッドの本文、SQL文字列、コメント、decorator、型注釈をそのまま移す。クラス末尾の空行調整以外に本文の整形を混ぜない。

| メソッド | 現行の範囲 | 維持する責務 |
|---|---|---|
| `__init__` | 312〜344 | 保存先検証、権限設定、初期化 |
| `checked_id` | 346〜350 | attempt・jobなどのUUID検証 |
| `checked_source_id` | 352〜358 | series・episodeの識別子検証 |
| `checked_snapshot` | 360〜366 | 空文字と保存byte上限の検証 |
| `canonical_json` | 368〜372 | 保存用JSONの安定したbyte化 |
| `sanitized_error` | 374〜381 | エラー内のローカルpathなどの整形 |
| `_connect` | 383〜397 | SQLite設定、transaction、接続解放 |
| `_initialize` | 399〜521 | schema確認、移行、履歴補完、trigger作成 |
| `_backfill_status_event_provenance` | 523〜573 | 既存status eventのprovenance補完 |
| `_artifact_target` | 575〜588 | SHA-256に対応する保存先の検証 |
| `_checked_artifact_path` | 590〜608 | 読取pathの台帳内制限とsymlink拒否 |
| `write_artifact` | 610〜650 | 保存済み内容の照合、ファイル保存、DB登録 |
| `artifact_metadata` | 652〜666 | artifactのmetadata取得 |
| `read_attempt_artifact` | 668〜688 | attemptとroleによるbyte読取・hash照合 |
| `checked_sha256` | 690〜694 | SHA-256文字列の検証 |
| `_artifact_from_row` | 696〜703 | DB行からmetadataを取得 |
| `_read_artifact_row` | 705〜714 | DB行に対応するbyte読取・hash照合 |
| `_event_provenance` | 716〜743 | 状態履歴に対応するprovenance作成 |
| `_audit_events_for` | 745〜784 | 履歴と保存済みprovenanceの照合 |
| `_ensure_created_status_event` | 786〜825 | 欠けている初期履歴の補完 |
| `begin_attempt` | 827〜917 | 入力保存、同一要求の照合、明示retryの登録 |
| `_artifacts_for` | 919〜935 | attemptに属するartifact一覧 |
| `attempt` | 937〜985 | 現在状態、最新review、artifact、監査履歴の取得 |
| `list_attempts` | 987〜997 | コマ単位の履歴一覧 |
| `set_status` | 999〜1061 | 状態遷移とprovenance・履歴の登録 |
| `complete_success` | 1063〜1146 | 出力検証、成功結果と履歴の登録 |
| `set_review` | 1148〜1225 | レビュー対象検証、revision照合、追記 |
| `resolve_succeeded_artifact` | 1227〜1302 | 成功結果と入力snapshot一式の整合性確認 |

範囲はdecoratorを含む。補助メソッドだけを共通モジュールへ移したり、クラスをさらに分割したりしない。

## 3 importとC3への接続

新しいledgerモジュールのimportは次のとおり。

```python
from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

from nyamuru_comfy_draft import (
    ComfyUIDraftGenerator,
    MAX_COMFY_IMAGE_BYTES,
    PANEL_DRAFT_ID_PATTERN,
)
```

この後に6定数、台帳クラスを置く。保存先はコンストラクター引数で受け取り、ledger内に`REPO_ROOT`、環境変数の読取、workspace管理やbridgeへの依存を追加しない。importだけでは台帳を生成しない。初期化・既存のschema移行はコンストラクターを呼んだときに行う現在の契約を維持する。

### 相互参照の処理

| 呼び出し元 | 呼び出し先 | 回数 |
|---|---|---:|
| ledgerの`complete_success` | `ComfyUIDraftGenerator.validate_png_bytes` | 2 |
| ledgerの`set_review` | 同上 | 1 |
| ledgerの`resolve_succeeded_artifact` | 同上 | 1 |
| comfyの`generate` | `PanelDraftLedger.checked_id` | 1 |

ledgerはcomfyを通常importする。comfyからledgerへのimportは`generate`の内部だけに置く。

```python
def generate(self, body: dict[str, Any]) -> dict[str, Any]:
    value = self.normalized_request(body)
    from nyamuru_panel_draft_ledger import PanelDraftLedger
    prompt_id = PanelDraftLedger.checked_id(body.get("attempt_id"), "attempt ID")
    # 以降は既存処理をそのまま保持する。
```

C3の本文に許容する変更は、このimport1行の追加だけ。`PANEL_DRAFT_ID_PATTERN`をledgerへ定義してcomfyが通常importする形にはしない。初期化時の循環を再び作るためである。

実行時のクラス間の相互参照は残る。完全な一方向依存への改設計、PNG検証の複製、ID検証の別実装は今回行わない。bridgeの逆importや仮の互換クラスで途中状態を動かす構成にもせず、両モジュールの作成と配線をまとめて完了する。

### 同時に満たすC3側の条件

親計画の16定数・`ComfyUIDraftGenerator`・2例外を移し、bridgeでは元の公開名を維持する。PNGの検証、workflow、応答判定、既定checkpoint保存先を変えない。

C3は`scripts`直下の配置から`REPO_ROOT`と`TOOLS_ROOT`を算出し、既定checkpoint pathが移動前と一致することを確認する。Pillowのimportは既存メソッド内に残す。モデル読込、通信、台帳生成をモジュール読込時に始めない。

## 4 bridgeと利用元に残す接続

bridgeは次の7シンボルを再exportする。

```python
from nyamuru_panel_draft_ledger import (
    MAX_PANEL_DRAFT_OMNY_BYTES,
    MAX_PANEL_DRAFT_SNAPSHOT_BYTES,
    PANEL_DRAFT_STATUS_VALUES,
    PANEL_DRAFT_REVIEW_VALUES,
    PANEL_DRAFT_LEDGER_SCHEMA_VERSION,
    PANEL_DRAFT_PROVENANCE_VERSION,
    PanelDraftLedger,
)
```

C3の19シンボルのimportも、bridgeのクラス定義より前に置く。状態値のsetを含め、定数を複製せず同じオブジェクトを参照する。

`PanelDraftJobService.ledger`は引き続き`EpisodeWorkspaceManager.ledger_root`からepisode rootと台帳rootを受け取り、再exportされた台帳を生成する。この経路と`draft_data/nyamuru/ledger.sqlite3`、`artifacts/sha256`の配置を維持する。

`PanelDraftJobService`の生成・一覧・再照合・レビュー、HTTPの`/api/panel-draft/generate`、`list`、`reconcile`、`review`、`LocalVisionState`の構築は変更しない。C2自身は新たな例外型を作らず、既存の`ValueError`などとHTTPへの伝達を維持する。C3の例外2クラスも同じオブジェクトを再exportし、bridgeでの捕捉を維持する。

## 5 保存と状態管理の不変条件

### 保存先とSQLite

episode外の台帳root、台帳・artifact・DBの不正なpathやsymlinkを拒否する既存検証を保持する。ディレクトリの`0700`、DB・artifactの`0600`も変更しない。

SQLiteのforeign keys、busy timeout 30秒、DELETE journal、FULL synchronous、接続ごとのtransactionとcloseをそのまま移す。`BEGIN IMMEDIATE`と明示commitの位置を動かさない。ファイル操作とDB操作を、全体で一つのatomic transactionと説明しない。

schemaとprovenanceのversionはともに2を維持する。jobs、attempts、status_events、reviews、artifacts、attempt_artifacts、review_eventsの7テーブル、index、4つの追記専用triggerのSQLを文字列ごと保持する。

初期化順序は、新しいschemaの拒否、既存schemaの必要な列補完、version設定、provenance補完、初期履歴の補完、追記専用triggerの作成を維持する。補完より前へtrigger作成を移さない。v1の可変reviewは検証済みreviewへ昇格させず、旧テーブルを残し、v2のreview_eventsに基づく現在の扱いを維持する。

### Artifactと履歴

`canonical_json`はUTF-8、key順固定、既存separator、`allow_nan=False`を保持する。SHA-256、suffix、media type、byte_size、roleと保存pathの契約を変えない。

`write_artifact`は、既存内容があればサイズとhashを照合し、新規なら同じ保存先の一時ファイルへ書いてflush・fsync・置換した後にDBへ登録する。この順序と、重複登録時のmetadata照合を維持する。副次的に残るファイルの削除や新たな掃除処理を加えない。

読取時のpath検証、上限付き読取、byte数とSHA-256照合を保持する。metadataだけを返すメソッドと、実byteまで照合するメソッドを混同して検証処理を省略しない。

status eventは個々のprovenance SHAを保持する。attemptの現在のprovenance参照の更新と、過去eventの追記専用記録を区別する。エラーメッセージ内のepisode path・home path・空白の整形も変更しない。

### Attemptの開始と状態遷移

`begin_attempt`ではOMNY・plan・workflowの保存後、同じattempt IDの内容を照合する。同じ内容は既存attemptを返し、生成内容の違う再利用は拒否する。同じjobでの再試行は別attempt IDと明示したretry元を要求し、jobの作品・コマへの結び付きとattempt番号を維持する。

初期status eventの補完は既存transactionの後に行う現在の順序を保持する。C2でComfyUIへsubmitしたり、自動再試行を追加したりしない。

`set_status`の遷移は次のとおり。同じ状態への再記録も現在の仕様であり、成功・失敗の全更新が禁止されているとは扱わない。

| 現在 | 許可する次の状態 |
|---|---|
| created | created、queued、failed、outcome_unknown |
| queued | queued、succeeded、failed、outcome_unknown |
| outcome_unknown | outcome_unknown、queued、succeeded、failed |
| succeeded | succeeded |
| failed | failed |

この検証と`complete_success`による出力保存の検証は別の処理である。移動時に統合したり、新たな条件を足したりしない。

### 成功結果の保存

原画像と4値画像のPNG検証を行い、画像とprovenanceのartifactを書いてから、transaction内で現在状態を再確認する。

queued・outcome_unknownからの成功と、`recovering_created_from_history=True`のときだけ許可するcreatedからの復旧を保持する。成功済みattemptへ同じ出力hashで再要求した場合は既存結果を返し、異なる出力hashは拒否する。同一出力の再要求では既存のsource filename、provenance参照、成功eventを書き直さない。

### Reviewと成功結果の取得

新規reviewは成功済みの4値artifactに限定し、指定hash・media type・実byte・PNGを検証する。`expected_revision`の一致を確かめ、revisionを1増やしたイベントを追記する。noteの2,000 byte上限、nonceの一意性、accepted・rejectedの決定値を維持する。

同じnonceの再要求は新しいreviewより先に照合する。同じ内容なら現在のattemptを返し、内容が違えば拒否する。この重複判定を最新revision照合やPNG再検証の後ろへ移さない。

`resolve_succeeded_artifact`はjob・attempt・成功状態と、出力およびOMNY・plan・workflowの各hash、media type、byte数、4値PNGを検証し、入力snapshotを含むbundleを返す。**acceptedのreviewは現在の必須条件ではない。** 採用済み条件やsnapshot内容の新たなparseを足さない。

## 6 既存テストとの互換性

| 既存の参照やpatch | 維持する条件 |
|---|---|
| `bridge.PanelDraftLedger`の生成・`set_status`へのpatch | 同じクラスを再exportする |
| `bridge.sqlite3.IntegrityError`など | bridgeの既存標準importを残す |
| `bridge.urllib_request.urlopen`へのpatch | C3も`from urllib import request as urllib_request`を使う |
| generator instanceのメソッドへのpatch | 同じクラス・インスタンスを使う |
| `episode_workspace.choose_episode_directory`など | B2側の参照先を維持する |

同名の互換クラス、定数のコピー、`from urllib.request import urlopen`への変更は行わない。bridgeの未使用に見えるimport整理も含めない。

### 必須の既存スイート

| スイート | 確認する領域 |
|---|---|
| `tests/test_panel_draft_ledger_bridge.py` | 台帳8ケース、ジョブ管理10ケース、境界3ケース。保存・resolver、冪等性とretry、review競合、path、監査履歴、v1移行、unknownと再照合 |
| `tests/test_scanner_bridge.py` | C3の固定workflow、generate経路、色選択・紙領域判定の補助処理、接続先・要求検証とbridgeの既存接続 |
| `tests/test_workspace_doctor_core.py` | 台帳のテーブル・trigger契約とdoctor側の回帰確認 |
| `tests/localBridge.test.mjs` | client側の生成・履歴・再照合・review契約 |
| `tests/panelDraft.test.mjs` | 下書き生成の固定設定・入力・表示側の契約 |

各ファイルの全スイートを編集前後で実行する。doctorの18ケースすべてが本番台帳を生成するわけではない。本番`PanelDraftLedger`を直接生成してschemaとtriggerを確認するのは、205行の`test_contract_accepts_the_current_production_ledger_schema`である。他の台帳診断ケースは主に独立fixtureを使う。

scannerの`test_runs_fixed_workflow_and_returns_generated_image`は、mock付きで`ComfyUIDraftGenerator.generate`を通るため、C3の遅延importも実行する。このケースでは色変換の`manga_base_png`を置換しており、色変換全体やモデル実生成を確認するテストとは区別する。

## 7 実装順序と検証

1. Git状態、共有掲示板、C1完了版との一致を確認し、回復点となるHEADを記録する。他作業の変更を戻さず、実装3pathをclaimする。
2. 下記Python・Nodeテストを実行し、基準の失敗・skipの有無を記録する。
3. C2とC3の新モジュールを作成する。定数の所有先を確認し、C3のgenerate内だけに遅延importを追加する。
4. bridgeから対象定義を削除し、全26シンボルを再exportする。この接続が揃ってから検証する。
5. 既存スイート、本文比較、importと接続の一時検証を行う。
6. 独立した読み取り専用レビューを受け、全差分とステージ済み差分を確認し、実装3ファイルを一緒にローカルコミットする。
7. 作業ファイルと完了コミットの一致を確認し、共有掲示板を更新する。想定外の書き戻りや差分があれば保全して確認する。

コミット例は`refactor: extract panel draft ledger and ComfyUI generator`。C2だけ、C3だけの中間コミットを完了版としない。利用者作成の未追跡計画書を含めない。

### 実装後の実行例

repository直下で既存環境を使う。依存追加や環境の再作成は行わない。

```bash
.local-vision/.venv/bin/python -m py_compile \
  scripts/nyamuru_local_bridge.py \
  scripts/nyamuru_panel_draft_ledger.py \
  scripts/nyamuru_comfy_draft.py

.local-vision/.venv/bin/python -m unittest \
  tests.test_scanner_bridge \
  tests.test_panel_draft_ledger_bridge \
  tests.test_workspace_doctor_core

node --no-warnings --experimental-strip-types --test \
  tests/localBridge.test.mjs \
  tests/panelDraft.test.mjs

git diff --check
```

Pillowを使う画像境界ケースや、jsonschemaを使う任意ケースのskipは実行時に確認し、未実行部分を合格扱いしない。本計画のテスト一覧は実装時の実行対象であり、今回の計画作成で実行済みとは扱わない。

### 抽出に伴う一時的な確認

- **本文とSQLの一致**: 台帳全体、6定数、C3の定義を移動前と比較する。C3の遅延import1行以外に本文差分がないことを確認する。bridgeの残りとC1のモジュールも変更されていないことを確認する。
- **公開名の同一性**: C2の7シンボル、C3の19シンボルがbridgeと同一オブジェクト。ledgerとcomfyの共有3参照、schema class属性、例外の継承、全グローバル参照と型注釈を確認する。
- **import順に依存しないこと**: 別プロセスで`comfy → ledger`と`ledger → comfy`、それぞれの単独importを確認する。bridgeの事前importやmodule cacheに頼らず、importだけでネットワーク、モデル、DB初期化、Pillow読込を要求しないことを確かめる。
- **実際の接続経路**: 既存のmock付きgenerateテストを通し、遅延importとID検証を実行する。既存の台帳テストでは実PillowによるPNG検証と一時SQLiteを使い、ledgerからcomfyへの4箇所の呼び出しも確認する。
- **HTTP例外の同一性**: 実サーバーを起動せず、メモリ内の模擬handlerでC3の`ComfyUIUnavailable`と`ComfyUIObservationUnavailable`が既存の503へ変換されることを確認する。ジョブ管理側でこれらの例外を捕捉し、台帳に`outcome_unknown`を記録してから例外を再送出する経路は、既存テストで別に確認する。queue・historyの観測自体は成功したがattemptが見つからず、unknownを通常応答として返す経路とも区別する。
- **既定pathと保存互換性**: C3のcheckpoint pathが移動前と一致すること、台帳rootがworkspaceからの引数のままであることを確認する。既存のschema契約・v1移行・snapshot round trip・review競合テストを使用し、実利用中のDBへ触れない。

抽出内容をなぞるだけの恒久テストは追加しない。実原稿・実台帳の保存や移行、ComfyUIや共有LLMの起動・再起動、モデル取得、実画像生成はこの検証には含めない。

## 8 完了条件

- C2の6定数と台帳クラスが移り、C3と同時に初期化時の循環を避けた構成で接続される。
- 28メソッド、SQL、保存byte、状態・review・resolverの契約が維持される。
- 既存テストと本文・import・HTTPの確認が通り、独立レビューの指摘が解決される。
- 3ファイルの変更を一緒にローカルコミットし、検証済みの作業ファイルと一致する。

完了報告ではC2とC3をまとめた実装コミット、実行した検証、skipや未確認事項を区別する。push、C4の開始、実環境での生成確認は含めない。
