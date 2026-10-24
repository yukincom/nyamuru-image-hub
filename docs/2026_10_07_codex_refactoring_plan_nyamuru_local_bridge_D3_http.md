# Phase D3 HTTP入口の抽出手順

D2完了`6d868fd`を基準に、`BridgeHandler`を専用moduleへ移し、元のbridgeをCLIと起動終了処理の入口へ絞る。Phase Dの実行指示に基づき、この手順を先に確定してから実装する。

- 親計画: [Phase D 定数・状態・HTTP入口の分割計画](2026_10_07_codex_refactoring_plan_nyamuru_local_bridge_D_wiring_http.md)
- bridgeは789行。対象クラスは309〜693行、385行・8メソッド。
- 対象: `<repository-root>`
- 55 POSTとhealthの1 GET、path共通OPTIONSの振る舞いを保持する。

## 変更pathとimport

| path | 変更 |
|---|---|
| `scripts/nyamuru_bridge_http.py` | 新規。以下のimportと既存クラス全文 |
| `scripts/nyamuru_local_bridge.py` | クラス定義を除去し、`BridgeHandler`を直接再export |
| `tests/test_series_background_bridge.py` | HTTP moduleをimportし、body上限のpatch先1箇所を変更 |
| `docs/LOCAL_VISION_BRIDGE.md` | 開発者向けmodule構成と検証時の参照先を追記 |
| この詳細計画書 | 実装前の範囲・検証手順 |

新しいHTTP moduleは説明用docstring、次のimport、元のクラス全文の順にする。

```python
from __future__ import annotations

import json
import subprocess
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from nyamuru_bridge_constants import ALLOWED_ORIGIN, MAX_BODY_BYTES
from nyamuru_bridge_identity import BRIDGE_SERVICE_NAME, LAYOUT_PROTOCOL_VERSION
from nyamuru_vision_state import LocalVisionState
from nyamuru_ocr_util import decode_image_data, normalized_rotation_override
from nyamuru_scanner_sessions import quit_image_capture
from nyamuru_series_catalog_store import SeriesCatalogConflict, discover_reference_text_candidates
from nyamuru_episode_workspace import CoverageReportConflict
from nyamuru_panel_actions import PanelActionLLMUnavailable
from nyamuru_comfy_draft import ComfyUIUnavailable
from nyamuru_project_store import load_project, save_project
```

bridgeの既存import群末尾に`from nyamuru_bridge_http import BridgeHandler`を追加する。`LocalVisionState`、定数、従来の互換公開名を残す。元の`parse_args`、bind host検査、`main`、実行guardには変更を加えない。抽出後の入口は403行を見込む。

state→bridge、HTTP→bridgeという逆importを作らない。layer submit内の`hold_generation_lease`の遅延importは元の位置へ残す。新しいrouter表、routes module、代理クラス、認証処理は追加しない。

`tests/test_series_background_bridge.py`では`import nyamuru_bridge_http as bridge_http`を追加し、297行の`patch.object(bridge, "MAX_BODY_BYTES", ...)`を`patch.object(bridge_http, "MAX_BODY_BYTES", ...)`へ変更する。期待値と入力はそのまま。handlerへのアクセスは`bridge.BridgeHandler`を維持する。

## 保持するHTTP・起動契約

`state` property、Origin判定、JSON応答、OPTIONS/GET/POST、body読取、ログの全8メソッドをコメント・型注釈ごと文字列一致で移す。ルート一覧と境界条件は親計画4節をそのまま適用する。

- Origin拒否はbody読取より先。Originなしは許可。OPTIONSはpathに関係なく204。
- GETはhealthだけ。POSTはpath判定より先にJSON検証するため、未知pathでも不正bodyなら400。
- Content-Type、Content-Length、96 MiB上限、JSON object必須、dict応答の識別値とUTF-8 byte長を維持する。
- POSTの例外順序は競合409、入力400、LLM/Comfy503、subprocess500、一般500。GETへ同じcatchを追加しない。
- 画像解析5ルートのlock、suggest/translateのlock、7箇所のbody.pop、layer submitのlease、scannerの開始・失敗時cancel・終了順を保持する。
- CLIのcheck優先順、state構築、serverへのstate/handler接続、signal登録、親PID監視、worker終了、server closeを維持する。

`docs/LOCAL_VISION_BRIDGE.md`には入口・constants・identity・state・HTTPとA〜Cのmodule一覧、依存方向、通常の起動入口を変えない点を追記する。テストで関数やscalar bindingをpatchするときは、再export元のbridgeではなく実際の参照moduleを対象にすることも記す。

## 回帰検証

通常のPython runnerはD2の11スイートにWD、Qwen、Krea2、background3d、generation QAの5つを追加する。共有LLMの16ケースは下記の専用fixtureで別実行し、合計で全16 bridgeファイル＋doctorをカバーする。成功・skipは合算して記録する。

```bash
.local-vision/.venv/bin/python -B /private/tmp/nyamuru-phase-d-gsoo1nbw/run_isolated.py \
  tests.test_scanner_bridge tests.test_figure_performance_bridge \
  tests.test_character_reference_bridge tests.test_character_match_bridge \
  tests.test_python_runtime_bridge tests.test_series_background_bridge \
  tests.test_episode_workspace_bridge tests.test_source_coverage_bridge \
  tests.test_project_store_bridge tests.test_panel_draft_ledger_bridge \
  tests.test_workspace_doctor_core tests.test_wd_expression_tagger_bridge \
  tests.test_qwen_generation_bridge tests.test_krea2_generation_bridge \
  tests.test_background3d_bridge tests.test_generation_qa_bridge

.local-vision/.venv/bin/python -B /private/tmp/nyamuru-phase-d-gsoo1nbw/run_shared_fixture.py

env -u NYAMURU_TEST_SCAN_IMAGE -u NYAMURU_TEST_ONE_IMAGES -u NYAMURU_TEST_VISION_ROOT \
node --no-warnings --experimental-strip-types --test \
  tests/localBridge.test.mjs tests/panelActions.test.mjs tests/panelDraft.test.mjs \
  tests/panelGeometryImages.test.mjs tests/localBridgeLifecycle.test.mjs \
  tests/startLocalBridge.test.mjs tests/localBridgeSupervisor.test.mjs
```

各コマンドを変更前後で実行する。Pythonのstate・cache隔離とCLI子プロセスの限定はD2を継続する。QAの依存必須環境変数が設定されていれば尊重し、任意依存不足を成功と数えない。Nodeの実画像3ケースは今回もopt-in指定なしでskipする。

### 共有LLMの一時fixture

共有LLM suiteは通常の15ケースにも生成leaseのファイル操作がある。nativeの1ケースでは、localhostの一時port、fixture Python server、guardian子プロセス、PID調査、fixtureへのSIGTERMと復帰を実際に使用する。これらをモデルや常駐サービスの確認とは扱わない。

新しいPythonプロセスで、一時rootへ次の3ファイルを現在のソースとbyte一致のままコピーする。

- `tests/test_shared_llm_bridge.py`
- `scripts/shared_llm_process.py`
- `scripts/image_generation_lock.py`

テストの`__file__`とimport探索をこの一時rootへ合わせ、全16ケースを実行する。これにより、関数defaultに束縛されたlease rootとguardian子のrootも一時ディレクトリ内になる。テスト・実装の本文は書き換えず、コピーの一致を実行前に確認する。

socketはloopbackに限定し、常用portのサービスへは接続しない。suiteの終了処理でfixture server/guardianを終了し、一時root内だけを片付ける。実サービスの再起動や実モデルの推論に置き換えない。sandbox等でnative検証が成立しない場合は、理由と未検証1件を明記し、成功扱いにしない。

## 抽出と境界の一時検証

1. handlerの385行全文、8メソッド、55 POST/1 GETの順序が一致する。bridge残部はクラス削除・import追加・空行以外が不変。テストも1patchと1import以外は一致する。
2. bridgeのclass、HTTPのclassが同一で、global参照と型注釈が解決可能。HTTP単独importとHTTP→bridge/bridge→HTTPの両順が、site packagesなし・副作用なしで成立する。
3. メモリ内handlerへ実JSON入力を流し、Origin/OPTIONS、JSON object・Content-Type/Length・上限、未知path、200/400/403/404/409/500/503、識別値の優先とbyte長を確認する。
4. analyze-setもanalysis lock内で実行されること、layer submitのleaseがsubmitを囲むこと、scannerアプリ起動失敗時に作成済みsessionをcancelすることをstubで確認する。実アプリ・生成処理は起動しない。
5. `main`を模擬state/server/signal/thread/eventで通し、check flagsの優先順と終了code、constructor引数、server接続、shutdown要求の重複抑止、親消失・PermissionError、finallyを確認する。このharnessは実signal登録・送信や実listenを行わない。
6. 変更ファイルのcompile、D1/D2の定義と互換公開名の最終確認、module構成文書のpath/リンク、`git diff --check`、完全な差分とstaged差分の確認、独立レビュー。

恒久テストを移動内容の写しとして大量追加せず、既存スイートと一時境界確認を組み合わせる。実モデル・実原稿・実台帳への保存・環境変更・常駐サービス操作・pushは含めない。

完了条件は、HTTP抽出後の入口が500行以下となり、Phase Dの3分割と互換性・各段階の検証・文書反映が揃うこと。ローカルコミット例は`refactor: extract bridge HTTP handler`。

## 実施結果（2026-10-07）

D1は`f30d719`、D2は`6d868fd`でローカルコミット済み。D3でHTTPを409行のmoduleへ抽出し、入口は403行になった。Phase D開始時の入口は1,341行で、3段階の詳細手順をそれぞれ実装前に確定した。

- D1の変更前後: Python156件すべて成功、Node53件すべて成功。
- D2の変更前後: Python248件中247件成功・1件skip、Node76件中73件成功・3件skip。
- D3の変更前後: Python347件中345件成功・2件skip（隔離runner331件＋共有LLM fixture16件）、Node94件中91件成功・3件skip。失敗はなし。
- Pythonのskipは任意依存`jsonschema`がない環境でのdoctorとgeneration QAのschema検証。Nodeのskipはopt-in実画像検証3件。成功件数には含めない。
- HTTPのメモリ内検証39ケース、`main`の模擬検証12ケースが成功。本文・Origin・例外応答、解析lock・生成lease、scannerの失敗処理、check flags、server/state接続、signalからの終了要求、親PID監視、finallyを確認した。
- HTTP単独とHTTP→bridge/bridge→HTTPのfresh importがsite packagesなしで成功。このimport確認とHTTP・mainの追加harnessではファイル書込・socket・子プロセス起動はなく、実signalの登録・送信も行っていない。
- 独立したHTTPレビューとPhase D累積監査で指摘なし。2クラス・7定数、CLI・`main`の本文を保持し、従来の公開名201件に欠落なし。テストの変更はimport追加とpatch先21箇所のみ。既存の機能module・launcherは変更していない。

共有LLM/Nodeの回帰テストでは一時的なlocalhost fixtureと子プロセスを使用した。共有LLM fixtureのlease残存は0件。実モデル推論、実原稿操作、常駐サービスの再起動、pushは実施していない。
