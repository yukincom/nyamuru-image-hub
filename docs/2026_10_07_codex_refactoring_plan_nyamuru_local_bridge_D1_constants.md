# Phase D1 共通定数の抽出手順

Phase Dの実行指示を受け、最初に残る7定数の移動内容と検証を確定する。この文書を作成してからD1のソース変更を行い、D1を独立した回復点としてコミットする。

- 基準: `1658665`（機能コードはC4完了の`b73ee9c`）。bridgeは1,341行。
- 親計画: [Phase D 定数・状態・HTTP入口の分割計画](2026_10_07_codex_refactoring_plan_nyamuru_local_bridge_D_wiring_http.md)
- 対象: `<repository-root>`
- この文書は実装前の手順。実行結果はコミットと完了報告で区別する。

## 移動するコード

`scripts/nyamuru_bridge_constants.py`を新設し、説明用docstringと`import re`の後に、bridgeの231〜238行をそのまま置く。

```python
# 高解像度TIFFをブラウザ側で縮小できない場合にも、ローカルbridgeで受け取れる上限。
MAX_BODY_BYTES = 96 * 1024 * 1024
ALLOWED_ORIGIN = re.compile(r"^https?://(?:127\.0\.0\.1|localhost)(?::\d+)?$")
PANEL_ACTION_LLM_MODE_MANAGED = "managed"
PANEL_ACTION_LLM_MODE_AUTO = "auto"
PANEL_ACTION_LLM_MODE_EXTERNAL_SHARED = "external-shared"
FIGURE_PERFORMANCE_SIZES = {"full", "waist-up", "bust-up", "face", "hand", "foot", "part"}
CHARACTER_REFERENCE_VIEWS = {"turnaround", "front", "three-quarter", "side", "back", "expression", "costume", "other"}
```

元のbridgeではこの8行を削除し、同じ位置に次の直接importを置く。importの前後に必要な空行以外、bridge残部を変更しない。

```python
from nyamuru_bridge_constants import (
    MAX_BODY_BYTES,
    ALLOWED_ORIGIN,
    PANEL_ACTION_LLM_MODE_MANAGED,
    PANEL_ACTION_LLM_MODE_AUTO,
    PANEL_ACTION_LLM_MODE_EXTERNAL_SHARED,
    FIGURE_PERFORMANCE_SIZES,
    CHARACTER_REFERENCE_VIEWS,
)
```

setをfrozensetへ変えたり、regexをbind host判定へ置き換えたりしない。新moduleの依存は標準の`re`だけ。domain定数、identity、path定数、state、HTTP、CLI・main、既存の互換importは維持する。

D1の変更pathはこの計画書、`scripts/nyamuru_bridge_constants.py`、`scripts/nyamuru_local_bridge.py`の3つ。既存テストの編集は不要で、body上限もstateのworker関数もbridgeをpatchする現状を保持する。D2/D3のbinding変更はそれぞれクラスを移す段階で行う。

## 検証の隔離

既存6スイートには`LocalVisionState`を生成するケースがある。実workspace stateの読取とKrea2 cache cleanupを避けるため、一時runnerから以下を設定した状態で既存テストを読み込み、実行する。

- `nyamuru_episode_workspace.DEFAULT_EPISODE_WORKSPACE_STATE_PATH`と`nyamuru_scanner_sessions.DEFAULT_SCANNER_STATE_PATH`を一時pathへ向ける。
- `NYAMURU_KREA2_CACHE_ROOT`、`NYAMURU_VLM_MODEL`、`NYAMURU_VLM_PYTHON`、`HF_HUB_CACHE`をfixtureへ向ける。worker runtimeの`DEFAULT_VLM_CACHE`もfixtureへ向け、実HF cacheの参照を避ける。環境変数をclearする既存ケースはVLMを使わず、repo既定のvision pathを検証するため、その関数やrootは変更しない。
- 各テスト自身が設定する一時root・patchは優先する。store/service本体や入力検証を丸ごとmockして既存テストを空洞化しない。
- 通信と実worker起動を監視する。runtimeテストのPython `-c`によるfixture子プロセスは維持し、実モデルworker・スキャナーアプリは起動しない。

runnerと検証スクリプトは`/private/tmp/nyamuru-phase-d-gsoo1nbw/`に置く一時成果物とし、projectの新しい通常起動経路にしない。既存環境のPythonを使用する。利用者の`HOME`などの共通環境変数は変更しない。

## 検証項目と実行順

1. ソース変更前に、下記6スイートとNode 2ファイルの基準結果を取得する。
2. 定数を抽出し、compile、同じ既存スイート、構造・境界検証を実行する。
3. 新moduleの7定義と説明コメントを基準ソースと文字列比較し、bridge残部が定義削除・import追加以外で一致することを確かめる。
4. bridgeの7公開名が定義元と同一オブジェクトで、型・set要素・regex・body上限が変わらないことを確認する。別プロセスでconstants単独importとbridgeとの両import順を確認する。
5. メモリ内handlerでOriginなし・localhost/127.0.0.1の許可、外部Origin/IPv6 Originの拒否、body上限の境界を確認する。上限検証はhandlerのbindingを一時的に小さくして行い、96 MiBのbufferを作る必要はない。
6. 独立した読み取り専用レビューを受け、全差分・staged差分・検証済みファイルの一致を確認してローカルコミットする。

Pythonは、次の一時runnerから標準unittestへ対象suite名を渡し、隔離して実行する。runnerはこの作業中だけ保持する。

```bash
.local-vision/.venv/bin/python -B /private/tmp/nyamuru-phase-d-gsoo1nbw/run_isolated.py \
  tests.test_scanner_bridge \
  tests.test_figure_performance_bridge \
  tests.test_character_reference_bridge \
  tests.test_character_match_bridge \
  tests.test_python_runtime_bridge \
  tests.test_series_background_bridge

node --no-warnings --experimental-strip-types --test \
  tests/localBridge.test.mjs tests/panelActions.test.mjs
```

実行結果の成功・skip・失敗を別々に記録し、任意依存による未実行を成功件数に含めない。

新旧ソースのcompileと`git diff --check`も行う。今回は配置とimportだけの変更なので、恒久テストの追加、フロントのbuild、常駐サービス再起動、実モデル推論、pushは行わない。

完了条件は、7定義の所有先が1つになり、既存の値・参照・HTTP境界・関連スイートが維持され、D1の検証とレビューが通ること。コミット例は`refactor: extract bridge constants`。
