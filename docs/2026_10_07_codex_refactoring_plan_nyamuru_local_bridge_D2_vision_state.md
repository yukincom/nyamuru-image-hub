# Phase D2 状態・解析クラスの抽出手順

D1完了`f30d719`を基準に、`LocalVisionState`を同じ`scripts/`直下へ移す。Phase Dの実行指示に基づき、この詳細手順を先に確定してからD2を実装・検証する。

- 親計画: [Phase D 定数・状態・HTTP入口の分割計画](2026_10_07_codex_refactoring_plan_nyamuru_local_bridge_D_wiring_http.md)
- 基準のbridgeは1,342行。対象クラスは308〜859行、552行・12メソッド。
- 対象: `<repository-root>`
- 本文は実装前の手順。結果は完了コミットと報告で区別する。

## 変更pathと移動方法

新規`scripts/nyamuru_vision_state.py`へクラス全文を移し、bridgeに`from nyamuru_vision_state import LocalVisionState`を追加する。

対象メソッドは`__init__`、`resolve_vlm_model`、`vlm_available`、`wd_expression_available`、`expression_tagging`、`check`、`analyze_figure_performance`、`character_reference_auxiliary`、`analyze_character_reference`、`analyze_character_reference_set`、`analyze_character_match`、`analyze`。コメント、default引数、型注釈、例外処理を含め、552行を文字列一致で保持する。

bridgeではクラス定義と前後の余分な空行だけを削除する。D1の定数と既存の互換importは残し、handler、CLI・main、標準importも変更しない。クラスを包装した代理定義は作らない。

変更はこの計画書、bridge、新規state module、後述の5テストファイルの8path。domain module、HTTP、launcher、フロント、保存schemaは変更しない。

## state moduleのimport

以下のimportと説明用docstringを先頭へ置き、その後に既存クラス全文を配置する。

```python
from __future__ import annotations

import importlib.util
import os
import re
import subprocess
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from nyamuru_bridge_constants import (
    PANEL_ACTION_LLM_MODE_MANAGED,
    PANEL_ACTION_LLM_MODE_AUTO,
    PANEL_ACTION_LLM_MODE_EXTERNAL_SHARED,
    FIGURE_PERFORMANCE_SIZES,
    CHARACTER_REFERENCE_VIEWS,
)
from nyamuru_bridge_identity import LAYOUT_PROTOCOL_VERSION
from nyamuru_layout_geometry import (
    detect_panel_boxes,
    deduplicate_panel_boxes,
    detect_panel_shapes,
    sort_panel_boxes_reading_order,
    detector_regions,
    detector_boxes,
    detected_person_regions,
    exclude_non_panel_regions,
    exclude_paired_title_header_boxes,
)
from nyamuru_worker_runtime import (
    DEFAULT_VLM_MODEL_LABEL,
    huggingface_hub_cache,
    default_vlm_paths,
    run_local_worker,
    run_figure_performance_worker,
    run_character_reference_worker,
    run_character_reference_set_worker,
    run_character_match_worker,
)
from nyamuru_ocr_util import usable_ocr_lines, rotated_image_bytes
from nyamuru_scanner_sessions import ScannerSessions
from nyamuru_analog_asset_store import DEFAULT_IMAGE_HUB_ROOT, AnalogAssetStore
from nyamuru_series_catalog_store import DEFAULT_SERIES_CATALOG_ROOT, SeriesCatalogStore
from nyamuru_episode_workspace import EpisodeWorkspaceManager
from nyamuru_panel_actions import (
    DEFAULT_PANEL_ACTION_LLM_URL,
    SHARED_PANEL_ACTION_LLM_MODEL,
    PanelActionSuggester,
)
from nyamuru_comfy_draft import DEFAULT_COMFYUI_URL, ComfyUIDraftGenerator
from nyamuru_panel_draft_jobs import PanelDraftJobService
from qwen_generation import QwenGenerationService
from krea2_generation import Krea2GenerationService
```

stateからbridgeを逆importしない。`Any`等の型名も通常importで解決可能にし、今回`TYPE_CHECKING`へ組み替えない。既存のserviceを生成する順番と、jobsへ渡すworkspace・generatorの共有参照を維持する。

`Path(__file__).with_name(...)`の4参照は同じ`scripts/`直下なので、演技・資料・照合・WD workerの実体が変わらない。worker呼出し、threshold、timeout、prompt version、VLM/cacheの解決、Baberuの条件、lockの種類と数は変更しない。`character_reference_auxiliary`はRT-DETRと任意のBaberu OCRで、WD処理は別メソッドである。

## テストの名前解決先

以下の20箇所だけ、`patch.object(bridge, "symbol", ...)`を`patch.object(vision_state, "symbol", ...)`へ変更する。行番号はD1完了時の各テスト。5ファイルすべてで既存bridge importの後へ`import nyamuru_vision_state as vision_state`を追加する。

| テスト（`tests/`配下） | symbolと基準行 |
|---|---|
| `test_character_match_bridge.py` | `run_character_match_worker`: 78、104、126、159 |
| `test_character_reference_bridge.py` | `run_local_worker`:536、`run_character_reference_worker`:537、`run_character_reference_set_worker`:563 |
| `test_figure_performance_bridge.py` | `run_figure_performance_worker`:260、282、319、339、`rotated_image_bytes`:335、`run_local_worker`:336、`detect_panel_boxes`:337、`detect_panel_shapes`:338 |
| `test_python_runtime_bridge.py` | `run_local_worker`:120、127 |
| `test_scanner_bridge.py` | `rotated_image_bytes`:658、`run_local_worker`:659、`detect_panel_shapes`:660 |

figure-performanceの339行の非呼出しアサーションも、実際に参照されるstateのbindingを監視する。その他のinstance patch、共有標準module属性のpatch、bridge経由でworkerを直接呼ぶテストはそのままにする。

既存テストの入力、期待値、ケース数は変えない。クラスが複数の別名bridge module経由で読み込まれても、同じ定義元のクラスを参照することを確認する。

## 検証と隔離

D1と同じ一時runnerを使い、workspace/scannerの既定state path、VLM/cache、Krea2 cacheを一時rootへ向けてからsuiteを読み込む。各テスト自身のfixtureを優先し、実store・serviceをまとめてmockしない。実socket通信・実モデルworkerを拒否して試行を記録し、既存のPython `-c` fixture子プロセスは許可する。追加suiteのsource-coverage CLIとworkspace-doctor CLIも、一時入力・出力なしの既存引数を照合して許可する。子プロセスは親のaudit hookを継承しないため、これらのCLIは引数と既存ソースの処理範囲も確認する。

変更前後に次を実行する。D1の6 Python suiteに5 suiteを追加した11 suite、Nodeは6ファイルである。

```bash
.local-vision/.venv/bin/python -B /private/tmp/nyamuru-phase-d-gsoo1nbw/run_isolated.py \
  tests.test_scanner_bridge tests.test_figure_performance_bridge \
  tests.test_character_reference_bridge tests.test_character_match_bridge \
  tests.test_python_runtime_bridge tests.test_series_background_bridge \
  tests.test_episode_workspace_bridge tests.test_source_coverage_bridge \
  tests.test_project_store_bridge tests.test_panel_draft_ledger_bridge \
  tests.test_workspace_doctor_core

env -u NYAMURU_TEST_SCAN_IMAGE -u NYAMURU_TEST_ONE_IMAGES -u NYAMURU_TEST_VISION_ROOT \
node --no-warnings --experimental-strip-types --test \
  tests/localBridge.test.mjs tests/panelActions.test.mjs tests/panelDraft.test.mjs \
  tests/panelGeometryImages.test.mjs tests/localBridgeLifecycle.test.mjs \
  tests/startLocalBridge.test.mjs
```

一時runnerは通常の起動経路へ組み込まない。追加スイートのHTTP・台帳・workspaceもfixtureとmockを使用し、任意依存のskipは未検証として報告する。`panelGeometryImages.test.mjs`の3件は利用者が指定した実画像・モデルを要するopt-inテストなので、今回は指定を渡さずskipする。Nodeの起動管理テストが作るfixture server/子プロセスと、実bridge・生成サービスの起動を区別する。

抽出の確認は次の範囲を一時スクリプトで補う。

1. クラス全文と12メソッドが基準と一致し、bridge残部はクラス削除・import追加以外が不変。5テストは20patch先とimportだけが変わる。
2. bridgeのクラスとstateのクラスが同一。state内の全global名前と型注釈が解決でき、domain依存は元の定義と同じオブジェクト。
3. state単独import、state→bridge、bridge→stateをそれぞれ新しいプロセスで確認。site packagesなしでもimportでき、import時のファイル書込・通信・モデル読込・子プロセス起動を要求しない。
4. 4つのworker pathの一致。fixture constructorを使ってstore/serviceの生成順と引数、jobsへ渡す共有参照、独立した2つのlockを確認。
5. compile、`git diff --check`、全差分とstaged差分の確認、独立した読み取り専用レビュー。

constructorの補助確認ではstateの生成する各store/serviceを一時mockに置き換え、順序と引数を記録する。既存suiteの本体をmockする手段とは分ける。実stateや実cacheの読取・整理を抽出の確認へ使わない。

完了条件は、552行のクラスと20patchが正しい定義元へ移り、関連検証とレビューが通ること。ローカルコミット例は`refactor: extract local vision state`。D3のHTTPクラスはこのコミットでは動かさない。
