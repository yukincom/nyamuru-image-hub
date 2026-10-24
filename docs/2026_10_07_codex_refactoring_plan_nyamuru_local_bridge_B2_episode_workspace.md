# Phase B2 EpisodeWorkspaceManager 抽出計画

エピソード作業フォルダの管理、参照ファイルの選択、source coverage reportの保存を、`nyamuru_local_bridge.py`から`nyamuru_episode_workspace.py`へ移す。クラスをそのまま切り出し、保存形式・検証処理・HTTP契約を維持する。

- 状態: **計画のみ。B2のコード変更は未実施。**
- 対象: `<repository-root>`
- 前提: A1〜A4とB1が完了していること。
- 基準: B1完了コミット`ffd89df`。本文中の行番号はこの時点の目安であり、実装時はシンボル境界で確認する。
- 親計画: bridge全体の分割計画（ローカル資料 `2026_10_07_grok45_refactoring_plan_nyamuru_local_bridge.md`、配布対象外）
- 直前の計画: B1 SeriesCatalogStore抽出（ローカル資料 `2026_10_07_grok45_refactoring_plan_nyamuru_local_bridge_B1_series_catalog_store.md`、配布対象外）

## 1 変更範囲

| ファイル | B2実装時の変更 |
|---|---|
| `scripts/nyamuru_episode_workspace.py` | 新規。下記11定数、例外、クラス全体を収容 |
| `scripts/nyamuru_local_bridge.py` | 対象定義の削除と13シンボルの再export |
| `tests/test_episode_workspace_bridge.py` | import追加とworkspace向けpicker patch 9件 |
| `tests/test_source_coverage_bridge.py` | import追加とworkspace向けpicker patch 8件 |
| `tests/test_panel_draft_ledger_bridge.py` | import追加とworkspace向けpicker patch 1件 |

実装対象は上記5ファイルに限定する。新しい実装モジュールは1つ。新モジュールは約820行、bridge本体は4,376行から約3,600行になる見込み。行数削減自体を完了条件にはしない。

メソッドの分割・改名、検証条件や上限の変更、保存場所・JSON形式・例外メッセージの変更は含めない。フロント、HTTPルート、B1のcatalog、A1〜A4の各モジュール、生成・LLMの処理は変更しない。Phase Cには進まない。

## 2 移動する定義

### 定数

bridgeの176〜188行にある次の11定数を、値・正規表現・既定パスを変えずに移動する。

| 定数 | 現行の役割 |
|---|---|
| `DEFAULT_EPISODE_WORKSPACE_STATE_PATH` | Application Support配下の`episode-workspaces.json` |
| `MAX_WORKSPACE_IMAGE_BYTES` | 画像1件の上限40 MiB |
| `MAX_WORKSPACE_IMAGE_TOTAL_BYTES` | 選択画像の合計上限96 MiB |
| `MAX_SOURCE_COVERAGE_REPORT_BYTES` | coverage reportの上限8 MiB |
| `MAX_SOURCE_COVERAGE_UNITS` | source unitなどの上限10,000 |
| `MAX_SOURCE_COVERAGE_TARGETS` | targetの上限50,000 |
| `SOURCE_COVERAGE_SCHEMA_NAME` | `nyamuru-source-coverage` |
| `SOURCE_COVERAGE_SHA_PATTERN` | SHA-256検証 |
| `SOURCE_COVERAGE_SOURCE_ID_PATTERN` | source ID検証 |
| `SOURCE_COVERAGE_TARGET_ID_PATTERN` | target ID検証 |
| `WORKSPACE_IMAGE_EXTENSIONS` | 対応画像の拡張子集合 |

### 例外とクラス

- `CoverageReportConflict`全体。bridgeの300行から。
- `EpisodeWorkspaceManager`全体。bridgeの304〜1069行、766行。

`CoverageReportConflict`から、次の`class PanelActionSuggester:`の直前までを一続きのブロックとして移す。`choose_images`の末尾まで含める。コメント、decorator、型注釈、ロック、ファイル記述子の処理もそのまま維持する。

クラス内の主な責務は、選択tokenの永続化と復元、管理フォルダの作成、`ledger_root`、coverage検証・保存、`choose_text`、`reference_candidates`、`choose_images`。coverageの補助メソッドを別クラスや別ファイルへ再分割しない。

## 3 依存関係

新モジュールは標準ライブラリと、A3・B1で抽出済みのモジュールを直接importする。bridgeをimportして名前を補う実装にはしない。

```python
from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
import os
import re
import secrets
import stat
import tempfile
import threading
from pathlib import Path, PurePosixPath
from typing import Any

from nyamuru_macos_picker import (
    choose_episode_directory,
    choose_workspace_files,
    default_picker_directory,
)
from nyamuru_series_catalog_store import (
    EPISODE_WORKSPACE_DIRECTORIES,
    MAX_WORKSPACE_TEXT_BYTES,
    SERIES_ID_PATTERN,
    WORKSPACE_TEXT_EXTENSIONS,
    discover_reference_text_candidates,
)
```

このimport一覧は、基準コミットのクラス内グローバル参照と照合済み。新たな外部ライブラリは不要。

### B1との共有定数

`MAX_WORKSPACE_TEXT_BYTES`、`EPISODE_WORKSPACE_DIRECTORIES`、`WORKSPACE_TEXT_EXTENSIONS`はB1の参照資料探索でも使うため、catalog内の定義を維持する。`SERIES_ID_PATTERN`と探索関数もcatalogから参照する。

workspaceへ定義を移し直したり、同じ値を複製したりしない。これにより依存は`bridge → workspace → catalog`となり、catalogからworkspaceやbridgeへの逆向きimportは生じない。共通定数の専用モジュール化は今回扱わない。

### プロジェクト保存と読込

`save_project`と`load_project`の実際の呼び出し元は`BridgeHandler`であり、`EpisodeWorkspaceManager`内ではない。bridgeにある`nyamuru_project_store`のimportと呼び出しをそのまま残す。新workspaceモジュールにproject storeへの依存を追加しない。

## 4 bridgeに残す接続

移動した11定数と2クラスをすべて再exportする。

```python
from nyamuru_episode_workspace import (
    DEFAULT_EPISODE_WORKSPACE_STATE_PATH,
    MAX_WORKSPACE_IMAGE_BYTES,
    MAX_WORKSPACE_IMAGE_TOTAL_BYTES,
    MAX_SOURCE_COVERAGE_REPORT_BYTES,
    MAX_SOURCE_COVERAGE_UNITS,
    MAX_SOURCE_COVERAGE_TARGETS,
    SOURCE_COVERAGE_SCHEMA_NAME,
    SOURCE_COVERAGE_SHA_PATTERN,
    SOURCE_COVERAGE_SOURCE_ID_PATTERN,
    SOURCE_COVERAGE_TARGET_ID_PATTERN,
    WORKSPACE_IMAGE_EXTENSIONS,
    CoverageReportConflict,
    EpisodeWorkspaceManager,
)
```

次の呼び出し元と既存importは変更しない。移動に伴う未使用importの整理も今回には混ぜない。

| 残す場所 | 維持する接続 |
|---|---|
| `LocalVisionState` | `EpisodeWorkspaceManager()`の生成とdraft serviceへの引渡し |
| `PanelDraftJobService` | 型注釈と`self.workspaces.ledger_root(...)` |
| `BridgeHandler` | workspace各操作、project store、参照候補のLLM処理 |
| `BridgeHandler`の例外処理 | `CoverageReportConflict`をHTTP 409へ変換 |
| bridgeのcatalog import | 共有定数と`discover_reference_text_candidates`の既存再export |
| bridgeのpicker import | 既存の公開名を維持 |

例外クラスは新モジュールのものと同一オブジェクトにする。bridge側に同名例外を再定義してはならない。

## 5 テストのpatch先

移動後のmanagerはworkspaceモジュール内の名前を参照する。以下3ファイルでは、bridgeの読込後に`import nyamuru_episode_workspace as episode_workspace`を追加し、該当18か所だけpatch先を変更する。

| テストファイル | patchする名前 | 件数 | 基準コミットの行 |
|---|---|---:|---|
| `test_episode_workspace_bridge.py` | `choose_episode_directory` | 7 | 28, 47, 68, 90, 103, 117, 132 |
| 同上 | `choose_workspace_files` | 2 | 72, 74 |
| `test_source_coverage_bridge.py` | `choose_episode_directory` | 2 | 136, 180 |
| 同上 | `choose_workspace_files` | 6 | 437, 439, 467, 477, 482, 487 |
| `test_panel_draft_ledger_bridge.py` | `choose_episode_directory` | 1 | 437 |

```python
# 変更前
patch.object(bridge, "choose_episode_directory", ...)
# 変更後
patch.object(episode_workspace, "choose_episode_directory", ...)
```

`choose_workspace_files`も同様に変更する。戻り値、side effect、アサーション、テストケース数は変えない。

変更しない箇所:

- B1でcatalogに向けたpatch。episodeテスト内の2件もcatalogのまま。
- `bridge.EpisodeWorkspaceManager`、`bridge.CoverageReportConflict`、`bridge.MAX_WORKSPACE_TEXT_BYTES`などの直接参照。再exportで維持する。
- source coverageテストの`patch.object(bridge.os, "stat" / "write" / "link", ...)`計4件。両モジュールが同じ標準`os`オブジェクトを参照するため、そのまま有効。別の整理として書き換えない。
- `tests/test_project_store_bridge.py`、`tests/test_scanner_bridge.py`、`tests/test_series_background_bridge.py`。

## 6 維持する契約

全8件の`/api/episode-workspace/` POSTルートを維持する。

- `select`
- `project/save`、`project/load`
- `reference-suggest`
- `prepare`
- `choose-text`、`choose-images`
- `source-coverage/save`

リクエスト・レスポンスのキー、キャンセル時の形式、エラーとHTTPステータスは変えない。参照候補の探索はcatalogに残り、LLMによる候補判定はbridgeに残る。

永続化では、workspaceのstate JSONとtoken復元、管理ディレクトリ名、`draft_data/nyamuru`の台帳ルート、`name_data/coverage/source-coverage-{sha256}.json`の命名を維持する。coverageのstrict schema、canonical JSONとhash、同一内容の再保存、競合検出、symlink拒否、部分書込みやディレクトリ差替え時の後始末も移動前と同じにする。

## 7 実装手順

1. Git状態と作業中のbridgeを確認する。A1〜A4・B1の抽出済みファイルが存在し、bridgeがそれらをimportしていることを確かめる。基準コミット以降の変更があれば内容を確認し、固定行番号で切り出さない。
2. 共有掲示板を再読し、実装対象5ファイルをclaimする。既存の利用者作成計画書や別作業の変更は含めない。回復点となるHEADを記録する。
3. 下記Python関連6スイートを実装前に実行し、基準結果を記録する。失敗があれば、抽出による失敗と区別できるよう原因を確認する。
4. 新workspaceモジュールへ定数ブロックと例外・クラスブロックを移し、必要なimportだけを追加する。
5. bridgeから対象定義を除き、13シンボルの再exportを追加する。残りの本文は変更しない。
6. 3テストファイルのimportと18件のpicker patchを変更する。
7. 構文、依存、本文の一致、再export、関連テスト、HTTP例外の接続を検証する。
8. 独立した読み取り専用レビューで移動範囲・import・patch先・保存境界を確認する。指摘があれば範囲内で直し、影響する確認を再実行する。
9. 全差分とステージ済み差分を確認し、対象5ファイルだけをローカルコミットする。例: `refactor: extract EpisodeWorkspaceManager from local bridge`。
10. 作業ファイルと完了コミットの一致を再確認し、掲示板のclaimを解放する。pushやPhase Cへの着手は含めない。

この作業ではbridgeの古い本文への書き戻りが過去に観測されている。開始時、検証後、コミット後の内容比較で再発を検出する。想定外の差分が出た場合はその内容を保全して確認し、検証済みと見なして先へ進めない。

## 8 検証方法

以下は**B2実装時に実行するコマンド**。リポジトリ直下で、既存のproduction用Pythonを使用する。今回の計画作成を、B2の検証済み状態として扱わない。

```bash
.local-vision/.venv/bin/python -m py_compile \
  scripts/nyamuru_episode_workspace.py \
  scripts/nyamuru_local_bridge.py

.local-vision/.venv/bin/python -m unittest \
  tests.test_episode_workspace_bridge \
  tests.test_source_coverage_bridge \
  tests.test_panel_draft_ledger_bridge \
  tests.test_project_store_bridge \
  tests.test_scanner_bridge \
  tests.test_series_background_bridge

node --no-warnings --experimental-strip-types --test tests/localBridge.test.mjs

git diff --check
```

workspace・coverageに加え、`ledger_root`を使う下書きジョブとproject save/loadのHTTP dispatchも既存テストで確認する。scanner・backgroundはB1との接続を含む回帰確認。Nodeの既存クライアントテストはHTTP要求と応答の扱いを確認する。

テスト以外に次を一時的な検証で確認する。抽出内容をなぞるだけの恒久テストは追加しない。

- 移動した定数・例外・クラスの本文が移動前と一致すること。末尾空行と新規importを除き、コメント・decoratorも比較する。
- bridgeの残りが、対象ブロック削除とimport追加だけになっていること。HTTPルートと`LocalVisionState`を含めて比較する。
- 新モジュールの単独importが成立し、bridgeへの逆向きimportがないこと。import時にmanagerの生成、pickerやサービスの起動を追加しないこと。
- 再exportした13シンボルが同じオブジェクトであり、catalog由来の5参照と標準`os`も同じ参照先を使うこと。
- 模擬HTTPハンドラで、新workspaceモジュールの`CoverageReportConflict`が409へ変換されること。実サーバーを起動する必要はない。

テストは一時フォルダと既存mockを使う。実原稿の保存・移行、ネイティブpicker、モデル推論、常駐サービスの起動や再起動はこの抽出の検証には含めない。

## 9 完了条件

- 11定数と2クラスの定義が新workspaceモジュールに一つずつ存在する。
- bridgeの既存公開名とHTTP・保存契約が維持される。
- catalog側の共有定義を保ち、循環importも定数の複製もない。
- テスト変更は3ファイルのimportと18件のpicker patchだけで、アサーションとケースは保持される。
- 関連テスト・機械比較・独立レビューを通過し、未検証範囲を区別して報告できる。
- B2のローカルコミットと作業ファイルが一致し、Phase Cは未着手である。
