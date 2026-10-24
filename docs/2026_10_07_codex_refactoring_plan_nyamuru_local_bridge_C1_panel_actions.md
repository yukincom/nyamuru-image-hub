# Phase C1 人物アクション処理の抽出計画

`PanelActionSuggester`と関連する例外・定数を、`nyamuru_local_bridge.py`から`nyamuru_panel_actions.py`へ移す。人物アクション統合、一括英訳、参照資料候補の選択を同じクラスのまま保持し、処理内容を変えずにbridgeから分離する。

- 状態: **計画のみ。C1の実装は未着手。**
- 対象: `<repository-root>`
- 基準: Phase C計画コミット`808f364`。bridgeのコードはB2完了`a30c30d`と同一。
- 前提: A1〜A4とB1・B2が完了していること。
- 親計画: [Phase C 生成処理と下書き台帳の分割計画](2026_10_07_codex_refactoring_plan_nyamuru_local_bridge_C_generation.md)
- 行番号は基準コミット時点の目安。実装時はシンボル境界と現在の差分を確認する。

## 1 変更範囲

| ファイル | C1実装時の変更 |
|---|---|
| `scripts/nyamuru_panel_actions.py` | 新規。3定数と2クラスを収容 |
| `scripts/nyamuru_local_bridge.py` | 対象定義を削除し、5シンボルを再export |

実装対象は上記2ファイル。既存テストは変更せずに実行する。必要なpatch先変更は現行調査では0件であり、予期せぬ修正が必要になれば、名前の解決先を確認して共有掲示板の対象を更新する。既存アサーションを弱めない。

新モジュールは約480行、bridgeは3,606行から約3,150行になる見込み。行数自体は完了条件にしない。

メソッドの分割や改名、共通化、プロンプトの改稿、LLM設定の調整は含めない。C2以降の台帳・ComfyUI・ジョブ管理、識別定数の共通ファイル化は後続の段階で扱う。

## 2 移動する定義

### 3定数

| 定数 | 保持する値 | 移動後の参照元 |
|---|---|---|
| `MAX_PANEL_ACTION_RESPONSE_BYTES` | `1024 * 1024`。応答上限1 MiB | 新モジュールの2つの通信経路 |
| `DEFAULT_PANEL_ACTION_LLM_URL` | `http://127.0.0.1:8080/v1/chat/completions` | bridgeの引数既定値と状態初期化 |
| `SHARED_PANEL_ACTION_LLM_MODEL` | `default_model` | 新モジュールの検証とbridgeのモデル指定 |

現行の191・192・196行にある定義を移す。間にある次の3定数は、引数処理とLLM所有モードの配線で使うためbridgeに残す。

- `PANEL_ACTION_LLM_MODE_MANAGED`
- `PANEL_ACTION_LLM_MODE_AUTO`
- `PANEL_ACTION_LLM_MODE_EXTERNAL_SHARED`

### 2クラス

`PanelActionSuggester`は302〜757行の456行。`PanelActionLLMUnavailable`は761〜762行の`RuntimeError`派生例外である。`class PanelActionSuggester:`から次の`class PanelDraftLedger:`直前までを、その順序のまま移す。

例外が後ろに定義されていても、その参照はメソッド実行時に解決される。定義順の変更や、bridge側への別の例外クラスの作成は不要。

| メソッド | 現行の範囲 | 保持する責務 |
|---|---|---|
| `__init__` | 306〜315 | 接続先と任意のmodel指定の検証 |
| `checked_text` | 317〜328 | NFKC正規化、必須・文字数検証 |
| `checked_number` | 330〜334 | boolを除く1以上の整数検証 |
| `normalized_dialogues` | 337〜354 | セリフ・話者・形状などの整形 |
| `normalized_panel` | 356〜369 | コマ番号・ト書き・人物・セリフの検証 |
| `normalized_request` | 371〜428 | 作品・人物・前後コマと対象IDの検証 |
| `response_json` | 431〜446 | 応答本文からJSONオブジェクトを取得 |
| `request_json_completion` | 448〜495 | 一括英訳が使用するJSON通信 |
| `suggest_reference_text` | 497〜538 | 既に探索・採点された資料候補の選択と整形 |
| `translate_layer_generation_prompts` | 540〜614 | 生成指示の一括英訳と対象一致の検証 |
| `action_identity_error` | 616〜644 | ID不一致の診断と例外作成 |
| `suggest` | 646〜757 | 人物アクション統合の通信と応答検証 |

範囲はdecoratorを含む。全12メソッドの本文、型注釈、コメント、空白を含むプロンプト文字列を保持する。クラス間の空行調整以外に、本文の整形を混ぜない。

## 3 新モジュールの依存関係

標準ライブラリだけを使う。新たなライブラリや、他のプロジェクト内モジュールへの依存は不要。

```python
from __future__ import annotations

import json
import re
import sys
import unicodedata
from typing import Any
from urllib import request as urllib_request
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
```

このimport群の後に3定数、`PanelActionSuggester`、`PanelActionLLMUnavailable`を置く。`Any`は型注釈用。他のimportはクラス内のグローバル参照に対応する。

`nyamuru_local_bridge`を逆importしたり、bridgeから依存オブジェクトを後注入したりしない。`sys.path`の追加処理、`REPO_ROOT`、環境変数の読取、CLI、main、LLMクライアントのグローバルインスタンスも新モジュールには追加しない。importだけで通信・モデル読込・ファイル作成を行わない。

依存は`bridge → panel_actions → 標準ライブラリ`となる。C2・C3の相互依存とは独立して実装できる。

## 4 bridgeへの接続

既存の`SCRIPT_ROOT`を`sys.path`へ加える処理の後、抽出済みモジュールのimport群に次を追加する。引数・クラスの定義より前に読み込む。

```python
from nyamuru_panel_actions import (
    MAX_PANEL_ACTION_RESPONSE_BYTES,
    DEFAULT_PANEL_ACTION_LLM_URL,
    SHARED_PANEL_ACTION_LLM_MODEL,
    PanelActionSuggester,
    PanelActionLLMUnavailable,
)
```

bridge経由で取得できる公開名を維持し、同じクラス・例外・定数オブジェクトを再exportする。互換用の派生クラス、wrapper、定数の二重定義は作らない。

### 変更せずに残す接続

| 場所 | 維持する内容 |
|---|---|
| `parse_args` | `--llm-url`、`NYAMURU_PANEL_ACTION_LLM_URL`、`--llm-mode`とその既定値 |
| `LocalVisionState.__init__` | `self.panel_actions`の生成、所有モードの検証、`panel_action_lock`の生成 |
| 所有モード | `auto`・`external-shared`は`default_model`、`managed`は`request_model=None` |
| `LocalVisionState.check` | endpointと所有モードのhealth表示 |
| `/api/panel-actions/suggest` | 同じlock内で`suggest`を呼び、200応答 |
| `/api/layer-generation/translate` | 同じlock内で`translate_layer_generation_prompts`を呼び、200応答 |
| `/api/series/directory/choose` | フォルダ選択が成立した場合の資料探索と`scope="series"`の整形 |
| `/api/episode-workspace/reference-suggest` | workspaceからの候補取得と`scope="episode"`の整形 |
| `BridgeHandler.do_POST`の例外処理 | 同じ例外クラスを捕捉して既存statusとerror本文を返す |
| `main` | 引数から状態へ渡す接続先と所有モード |

bridgeの既存標準importも今回は整理しない。特に`urllib_request`と`sys`は既存テストのpatch入口として残す。

## 5 維持する処理と契約

### 人物アクション統合

`action_mode="reconcile"`を必須とし、LLMに送る対象は`figures`内のIDに限定する。対象人物1〜20人、ID重複拒否、入力の正規化・上限はそのまま維持する。参照用の人物や前後コマから新しい出力対象を追加しない。

システムプロンプトの4つの統合ルールを文字列ごと保持する。作者の表情・演技指示、画像から読み取った客観描写、推測記述の扱い、人物自身への対象限定を変更しない。レスポンス用テンプレートと入力JSONの作り方も同一にする。

通信はtemperature `0.25`、timeout `180`秒、`stream=False`。出力予算は次の既存式を保持し、新しい固定上限を足さない。

```text
max(1600,
    2 * (対象人物のcurrent_action文字数合計 + 現在コマのpanel_action文字数)
    + 400 * 対象人物数)
```

応答は全対象IDの一致を要求し、不明ID・重複・欠落・不正なID型を拒否する。アクション本文は4,000文字以内。空文字の応答は受理する既存のbridge仕様を維持する。フロントで空の完成文をどう適用するかはC1では変更しない。

診断ログはreason、ページ・コマ、入力ID、上限付き応答ID、応答件数に限定する。原稿・あらすじ・アクション本文を追加しない。IDの切詰め、最大20件、制御文字のescape、入力を変更しない動作も保持する。

### 一括英訳

1〜8件、入力・出力promptの40,000文字上限、`translation_id`の重複拒否を維持する。応答の各IDに対応する`document_key`、`page_number`、`panel_id`、`kind`、`target_key`を入力と照合し、日本語などの文字を検出する既存正規表現も変更しない。

英訳用システムプロンプトをそのまま保持する。temperature `0`、max_tokens `7_000`、timeout `300`秒。呼び出す`request_json_completion`の既定timeout `180`秒も変えない。

`suggest`内の通信と`request_json_completion`には似た処理があるが、C1では統合しない。応答形式・例外文言・出力予算を意図せず変えないため、両方の本文をそのまま移す。

### 参照資料候補

`suggest_reference_text`は受け取った候補順とscoreを使う規則処理であり、自身ではファイル探索やLLM通信を行わない。探索はcatalog・workspace側に残す。

episodeで複数候補のscore差が10未満なら選択を保留する。seriesでは候補一覧を返し、人物設定とシリーズ設定を利用者が選べる形を維持する。候補なしの場合の戻り値、confidence、recommended、`selected_by="rules"`も保持する。

### 接続先と失敗時の区別

接続先は既存の検証どおり、HTTPかつhostnameが`127.0.0.1`、`localhost`、`::1`のいずれかでpathを持つURL。任意modelは`default_model`だけを受け付ける。検証条件の拡大・縮小はしない。

両通信経路の応答読込は上限1 MiBに1 byteを加えて行い、超過を拒否する。例外の順序と型を保持する。

| 発生条件 | クラス側 | bridgeでの既存HTTP応答 |
|---|---|---|
| `URLError`・`TimeoutError`・`OSError` | `PanelActionLLMUnavailable` | 503 |
| 上流LLMの`HTTPError` | `RuntimeError` | 500 |
| 不正な入力・応答の検証エラー | `ValueError` | 400 |

`HTTPError`は`URLError`の派生なので、現行の捕捉順を維持する。上流がHTTP 503を返した場合と、接続不能によるbridgeの503は別の経路として確認する。

## 6 既存テストとの互換性

| patchの形式 | 抽出後も有効な条件 |
|---|---|
| `patch.object(bridge.urllib_request, "urlopen", ...)` | 新モジュールも同じ`urllib.request` moduleをimportする |
| `patch.object(bridge.sys, "stderr", ...)` | 同じ`sys` moduleを使う |
| suggester instanceの`request_json_completion` | 同じクラス・インスタンスを使う |
| 既存workspace・catalogのpicker patch | 今回は探索やpickerを移動しない |

`from urllib.request import urlopen`に変えると、呼び出し先を直接束縛して既存patchが効かなくなるため行わない。bridgeの名前を別オブジェクトへ再代入するpatchと、共有moduleの属性を変更するpatchは別物である。現行C1関連テストに前者の差し替えはない。

### 必須の既存スイート

| テスト | C1に関係する検証 |
|---|---|
| `tests/test_scanner_bridge.py`の`PanelActionSuggesterTest` | 19ケース。reconcile形式、入力・応答ID、プロンプト、長文、診断、英訳、model指定、所有モード、接続不能 |
| `tests/test_episode_workspace_bridge.py`の`SeriesReferenceTextTest` | 人物資料候補、複数のシリーズ資料、episodeの曖昧候補を含む資料選択 |
| `tests/localBridge.test.mjs` | 人物アクションと資料候補のclient契約 |
| `tests/panelActions.test.mjs` | 依頼文脈、完成文の適用、部分・不正応答の拒否、空応答の扱い |
| `tests/layerGeneration.test.mjs` | 一括英訳clientの要求順保持と別コマへのretarget拒否 |

Pythonは上記クラスだけでなく、所属する2ファイルの全スイートを実行する。Nodeも上記3ファイルを実行する。英訳clientを直接検証する`layerGeneration.test.mjs`は、Phase C親計画のC1一覧に加える詳細化である。

`localBridge.test.mjs`には`selected_by="local-llm"`を受け取るfixtureもあるが、現在のPython側がLLMで資料選択する証拠ではない。C1でfixtureや処理を変更しない。

## 7 実装手順と検証

### 実装前

1. 現在のHEAD、未commit変更、共有掲示板を確認する。bridgeがB2完了版から変わっていれば、差分を読み直して計画の基準を更新する。利用者や別作業の変更を戻さない。
2. 編集対象の新モジュールとbridgeの2pathをclaimし、回復点となるHEADを記録する。既存の利用者作成計画書をstageしない。
3. 下記のPython・Nodeテストを基準として実行し、失敗やskipがあれば内容を確認する。成功していない基準を成功扱いしない。

### 抽出

1. 新モジュールへ標準import、3定数、2クラスを移す。
2. bridgeから元の定義だけを削除し、5シンボルを再exportする。
3. クラス本文と定数値を基準のsourceと比較する。メソッド本文の変更が必要になった場合は機械的な抽出から外れるため、理由と影響を確認してから進める。

### 実装後の実行例

以下はrepository直下で実行する。既存のPython環境とNodeを使い、環境の再作成や依存追加は行わない。

```bash
.local-vision/.venv/bin/python -m py_compile \
  scripts/nyamuru_local_bridge.py \
  scripts/nyamuru_panel_actions.py

.local-vision/.venv/bin/python -m unittest \
  tests.test_scanner_bridge \
  tests.test_episode_workspace_bridge

node --no-warnings --experimental-strip-types --test \
  tests/localBridge.test.mjs \
  tests/panelActions.test.mjs \
  tests/layerGeneration.test.mjs

git diff --check
```

### 抽出に伴う一時的な確認

通常のテストに加え、次を一時的な検証で確認する。単に移動先をなぞる恒久テストは追加しない。

1. **sourceの保持**: 2クラスのコメント・decorator・プロンプトを含む本文、3定数の値が一致する。bridgeの残りは定義削除とimport追加だけであり、`LocalVisionState`、HTTP、起動・終了処理は変わっていない。
2. **単独import**: 新モジュールだけを新しいPythonプロセスでimportできる。bridgeの事前import、module cache、設定ファイル、LLM、Pillowなどに依存しない。
3. **公開名と名前解決**: bridgeの5シンボルが新モジュールと同一オブジェクト。例外は`RuntimeError`派生のまま。メソッドのグローバル参照がすべて解決し、`urllib_request`と`sys`の同一性も成立する。
4. **実際の英訳通信経路**: `request_json_completion`自身は置換せず、`urllib_request.urlopen`だけをmockし、1件の英訳を`translate_layer_generation_prompts`から通す。300秒、7,000 tokens、temperature 0、共有model指定、対象identity、戻り値を確認する。既存の英訳2ケースは通信helperを置換するため、この経路を補う。
5. **HTTPへの例外伝達**: socketを開かない模擬handlerで2つのPOSTルートを通す。各ルートに実際のsuggesterと人工入力を使い、`urlopen`の接続失敗から新例外が発生して503になること、上流`HTTPError`が500になること、入力検証失敗が400になることを確認する。`do_POST`と`send_json`は実装を使い、HTTP出力先をメモリへ置き換える。

実際のLLMや生成サービスの起動・再起動、モデルダウンロード、実原稿の送信、実画像生成は検証対象に含めない。テストは人工入力・既存mock・一時フォルダを使う。LLMの実出力品質を、この検証の合格から推定しない。

## 8 レビューと完了条件

独立した読み取り専用レビューで、対象の取り残し、余分な依存、例外の別定義、プロンプト差分、patchの無効化、C2以降への変更混入がないか確認する。

完了条件は次のとおり。

- 3定数・2クラスが新モジュールに移り、bridgeの既存名から同じオブジェクトを参照できる。
- 12メソッド、2つのプロンプト、入力・出力・例外の契約が維持されている。
- Pythonの2スイート、Nodeの3ファイル、compile、source比較、単独import、英訳通信とHTTP例外伝達の確認が通る。
- 独立レビューの指摘を解決し、全差分とステージ済み差分を確認する。
- 実装2ファイルだけをローカルコミットし、作業ファイルが完了コミットと一致することを確認してclaimを解放する。

コミット例は`refactor: extract panel action suggestions from local bridge`。想定外の書き戻りや他作業の差分があれば保全して確認し、検証済みとして進めない。C1完了時の報告は、コミット・検証結果・実LLM未検証を区別する。pushとC2・C3の開始はこの計画には含めない。
