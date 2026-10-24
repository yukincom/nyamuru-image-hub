# Phase D 定数・状態・HTTP入口の分割計画

`nyamuru_local_bridge.py`から残る定数、`LocalVisionState`、`BridgeHandler`を順に抽出し、元のファイルをCLI・起動終了処理・互換importの入口へ絞る。解析、保存、生成、HTTP応答、サービスの起動方法は維持する。

**今回はPhase Dの全体計画のみ。D1・D2・D3は、それぞれ詳細計画を提示し、その段階の実行指示を受けてから実装する。** この文書の作成をD1の着手や後続段階の一括実行とは扱わない。

- 状態: **計画のみ。Phase Dのコード・テスト変更は未着手。**
- 対象: `<repository-root>`
- 基準: C4完了コミット`b73ee9c`。bridgeは1,341行。
- 親計画: bridge全体のリファクタリング計画（ローカル資料 `2026_10_07_grok45_refactoring_plan_nyamuru_local_bridge.md`、配布対象外）
- 前段: [C4 下書きジョブ管理の抽出計画](2026_10_07_codex_refactoring_plan_nyamuru_local_bridge_C4_panel_draft_jobs.md)
- 本文の行番号・件数は基準コミットの静的調査結果。各段階の詳細計画時に再確認する。

## 1 分割先と実装順

| 段階 | 分割先 | 移動する内容 | 併せて変更する箇所 |
|---|---|---|---|
| D1 | `scripts/nyamuru_bridge_constants.py` | bridgeに残る7定数 | bridgeで7公開名を直接再export |
| D2 | `scripts/nyamuru_vision_state.py` | `LocalVisionState`全体、552行・12メソッド | bridgeでクラスを再export、既存5テストファイルのpatch先20箇所 |
| D3 | `scripts/nyamuru_bridge_http.py` | `BridgeHandler`全体、385行・8メソッド | bridgeでクラスを再export、既存1テストファイルのpatch先1箇所、既存開発文書にmodule構成を追記 |

この3つと同名・同責務の抽出先は、現行`scripts/`には存在しない。すでに抽出済みのdomain moduleと`nyamuru_bridge_identity.py`はそのまま利用する。

定数を先に分けることで、stateとHTTPがbridgeを逆importせずに同じ定義を参照できる。D2はD1、D3はD2の完了コミットに依存する。各段階を独立して検証・レビュー・ローカルコミットし、次段階の詳細計画へ進む。

bridgeの最終行数は約410行を見込む。既存の互換import群、`parse_args`、bind host検査、`main`、実行guardを残しても、親計画の500行以下という目標を満たせる見込み。行数を減らすための圧縮や公開名の削除は行わない。

### 親計画から具体化・変更する点

親計画の抽出順はstate→constantsだったが、依存方向を単純に保つためconstants→state→HTTPとする。

HTTPは現在のif分岐と前後処理を含めてクラスごと移す。親計画にあるルーティング表への書換えや`routes_*.py`への追加分割は、この段階では行わない。画像のdecode、ロック、scannerの失敗時処理などがあり、分割と同時に実行順を組み替える必要がないためである。既存のproject保存関数などへの直接呼び出しも保持するので、全ルートを`self.state.*`へ統一する変更は含めない。

`LocalVisionState`には、サービス生成だけでなく解析パイプラインも残す。親計画で任意の後続作業とされている`layout_analyze_service.py`への再抽出は、Phase Dの完了条件に含めない。約552行のクラスを機械的に分割して500行未満にする目標も設けない。

## 2 D1 残る7定数の抽出

231〜238行の説明コメントと7定義を、そのまま`nyamuru_bridge_constants.py`へ移す。

| 定数 | 現在の値・用途 |
|---|---|
| `MAX_BODY_BYTES` | `96 * 1024 * 1024`。HTTP request bodyの上限 |
| `ALLOWED_ORIGIN` | HTTP(S)の`127.0.0.1`または`localhost`、任意の数値portを許す正規表現 |
| `PANEL_ACTION_LLM_MODE_MANAGED` | `"managed"` |
| `PANEL_ACTION_LLM_MODE_AUTO` | `"auto"` |
| `PANEL_ACTION_LLM_MODE_EXTERNAL_SHARED` | `"external-shared"` |
| `FIGURE_PERFORMANCE_SIZES` | `full`、`waist-up`、`bust-up`、`face`、`hand`、`foot`、`part`のset |
| `CHARACTER_REFERENCE_VIEWS` | `turnaround`、`front`、`three-quarter`、`side`、`back`、`expression`、`costume`、`other`のset |

新moduleの依存は`re`だけとする。既存コメント、regexの文字列、setの型と要素、3モードの文字列を保持する。環境変数やpathを評価する処理は加えない。

bridgeへ7名前の明示的な`from nyamuru_bridge_constants import (...)`を追加する。同じ値の別定義、転送関数、module属性を動的に同期する互換処理は作らない。D1時点ではstateとhandlerがbridge内にあるため、既存の`patch.object(bridge, ...)`はまだ変更しない。

すべての定数をこの新moduleへ集め直す作業ではない。A〜Cの定数と既定pathは現在のdomain module、サービス識別2定数はidentityに残す。`REPO_ROOT`、`TOOLS_ROOT`、`SCRIPT_ROOT`とscript path登録も元のbridgeに残す。

Origin許可とbind host検査は別契約である。現在のOrigin regexへIPv6を足したり、`checked_loopback_bind_host`と共通化したりしない。

詳細計画では、7定義の完全なコード、import差分、定数所有先と再exportの検証、関連スイートを確定する。

## 3 D2 状態・解析クラスの抽出

### 移動範囲

307〜858行の`LocalVisionState`全体を、同じ`scripts/`直下の`nyamuru_vision_state.py`へ移す。本文、コメント、型注釈、default引数、例外の範囲と順序を保持する。

| メソッド | 基準行 | 保持する処理 |
|---|---|---|
| `__init__` | 308〜369 | pathの正規化、設定検証、store・service・2つのlockの生成 |
| `resolve_vlm_model` | 371〜393 | model directoryとcache snapshotの解決 |
| `vlm_available` | 395〜409 | VLM runtime・model・workerファイルの利用可否 |
| `wd_expression_available` | 411〜417 | WD runtime・model・tags・workerの利用可否 |
| `expression_tagging` | 419〜433 | WD worker実行と失敗時のfallback |
| `check` | 435〜464 | health/check用の設定・利用可否・version応答 |
| `analyze_figure_performance` | 466〜507 | 一人分の演技解析 |
| `character_reference_auxiliary` | 509〜556 | 資料画像のRT-DETR領域検出と任意のBaberu OCR |
| `analyze_character_reference` | 558〜594 | 単一資料画像の解析 |
| `analyze_character_reference_set` | 596〜667 | 複数資料画像の検証と解析 |
| `analyze_character_match` | 669〜756 | 登録人物との照合 |
| `analyze` | 758〜858 | 回転確定、検出・輪郭補助・OCR、レイアウト応答 |

bridgeでは同じクラスを直接importし、`bridge.LocalVisionState`を維持する。新しい代理クラス、factory、base class、依存注入の仕組みは追加しない。

### importとpath

標準importはfuture annotations、`importlib.util`、`os`、`re`、`subprocess`、`sys`、`threading`、`datetime`・`timezone`、`Path`、`Any`。通常importで型注釈も解決可能にする。

| 定義元 | stateが直接参照するもの |
|---|---|
| constants / identity | LLMモード3つ、解析用set2つ、`LAYOUT_PROTOCOL_VERSION` |
| worker runtime | VLM label・path・cache解決、local worker、演技・資料単体・資料set・人物照合のworker関数 |
| layout geometry | panel検出・重複除去・shape・読み順、detector領域/box/人物、非panel・対のタイトル領域の除外 |
| OCR util | `usable_ocr_lines`、`rotated_image_bytes` |
| scanner / analog / series / workspace | 既存store・managerと必要な既定root |
| panel actions / comfy / jobs | 既存のserviceクラス、URL・共有LLM modelの定数 |
| Qwen / Krea2 | 既存の生成serviceクラス |

正確なimport名の全量はD2詳細計画に記載する。stateからbridgeへの逆importを作らず、各機能の定義元を参照する。bridgeの既存importは互換公開名として残す。

`Path(__file__).with_name(...)`が参照する4ファイルは、`local_figure_performance_worker.py`、`local_character_reference_worker.py`、`local_character_match_worker.py`、`local_wd_expression_tagger.py`。新moduleを同じ`scripts/`直下へ置き、従来と同じ実体を参照する。別のworker存在確認を加えたり、`.absolute()`を`.resolve()`へ変更したりしない。

### 初期化と解析の不変条件

store・serviceの生成順を保持し、`PanelDraftJobService`へ同じworkspace・ComfyUI generatorインスタンスを渡す。Qwen、Krea2、2つのlockも、同じstateインスタンスの属性として保持する。shared/external LLMモードの選択、URL、model名、環境変数の評価タイミングを変更しない。

モデル解決と利用可否は現在のファイル確認に留め、新規downloadやruntime探索を加えない。4つのVLM解析メソッドは入力数・サイズ・view・候補の検証、prompt version、workerへの引数、timeout、失敗時の応答を維持する。WDの補助情報と失敗時fallbackも変えない。

レイアウト解析は、回転確認→回転画像→RT-DETR→誤検出・タイトル領域・重複の除外→必要時だけOpenCV補助→読み順・shape→領域OCR→protocol v3の応答、という既存順序を保持する。検出結果とshapeの数が合わないときの例外、文字領域だけをOCRへ渡す条件、人物情報も維持する。

### 既存テストのpatch先

クラス移動後は関数のglobal名前解決先がstate moduleになるため、以下を同じD2で変更する。各テストへ`import nyamuru_vision_state as vision_state`を追加し、該当する`patch.object(bridge, symbol)`を`patch.object(vision_state, symbol)`へ変更する。

| ファイル（`tests/`配下） | 基準のpatch行 | 件数 |
|---|---|---:|
| `test_character_match_bridge.py` | 78、104、126、159 | 4 |
| `test_character_reference_bridge.py` | 536、537、563 | 3 |
| `test_figure_performance_bridge.py` | 260、282、319、335〜339 | 8 |
| `test_python_runtime_bridge.py` | 120、127 | 2 |
| `test_scanner_bridge.py` | 658〜660 | 3 |

合計5ファイル・20箇所・12テストメソッド。figure-performanceの339行は`assert_not_called()`の監視先であり、ここも移す。元のworkerやgeometry moduleをpatchするだけでは、stateが直接import済みの参照は置き換わらない。

共有標準module属性への`bridge.subprocess.Popen`などのpatch、stateインスタンスへのpatch、bridge経由で直接呼ぶworkerのテストは変更不要。テストの入力・アサーション・ケースを削って通す変更は行わない。

## 4 D3 HTTPクラスの抽出

### 移動範囲と依存

861〜1245行の`BridgeHandler`全体を`nyamuru_bridge_http.py`へ移す。対象は`state` property、`allowed_origin`、`send_json`、`do_OPTIONS`、`do_GET`、`read_json`、`do_POST`、`log_message`の8メソッド。

標準importはfuture annotations、`json`、`subprocess`、`sys`、`BaseHTTPRequestHandler`、`Path`、`Any`、`urlparse`。constantsからbody上限とOrigin regex、identityから識別2定数、stateから`LocalVisionState`を直接importする。

その他は既存moduleの`decode_image_data`、`normalized_rotation_override`、`quit_image_capture`、`discover_reference_text_candidates`、`load_project`・`save_project`、競合例外2つ、`PanelActionLLMUnavailable`、`ComfyUIUnavailable`を参照する。`hold_generation_lease`は現在のメソッド内importの位置を維持する。

bridgeへ`from nyamuru_bridge_http import BridgeHandler`を追加する。HTTP→state→既存domain moduleという依存方向とし、HTTP・stateからbridgeをimportしない。

### ルートと前後処理

現在のPOSTは55件、GETは`/api/health`の1件。OPTIONSはpath共通のpreflight処理である。

| POST prefix | suffix・対象 | 件数 |
|---|---|---:|
| `/api/series/` | directory/choose、reference-text/choose、load、list、draft/begin・discard・commit、save、discard-unsaved、character-text/status・link・sync・restore、character-images/save・load・delete、background-models/save・load | 18 |
| `/api/episode-workspace/` | select、project/save・load、reference-suggest、prepare、choose-text、source-coverage/save、choose-images | 8 |
| `/api/scanner/` | open、collect、pending、resume、discard-pending、commit、finish、cancel | 8 |
| `/api/` | layout/analyze、figure-performance/analyze、character-reference/analyze・analyze-set、character-match/analyze | 5 |
| `/api/panel-actions/` | suggest | 1 |
| `/api/panel-draft/` | generate、list、reconcile、review | 4 |
| `/api/qwen-generation/` | submit、reconcile、list | 3 |
| `/api/layer-generation/` | submit、translate、reconcile、list、cache/list、cache/delete | 6 |
| `/api/analog-assets/` | save、load | 2 |

path、分岐順、request key、渡す引数、戻り値、例外の捕捉範囲をすべて保持する。ルート単位での仕様追加や共通化は行わない。

- 5つの画像解析ルートは既存の`analysis_lock`を共有する。画像のdecodeと`body.pop`も現在のlock内の順序を維持する。
- panel-actions/suggestとlayer-generation/translateは`panel_action_lock`を共有する。他のルートへ新しいlockを追加しない。
- layer-generation/submitは既存の画像生成lease内でKrea2へsubmitする。
- `body.pop`は画像6箇所と背景model_data1箇所の計7箇所。重いbase64を保持し続ける変更を避ける。
- scanner/openはsession開始後にイメージキャプチャを起動し、起動失敗時はsessionをcancelして再送出する。finish/cancelはアプリ終了要求が先である。
- series directory選択後の資料探索、workspace tokenから保存先を取得してproject関数へ渡す処理もそのまま保持する。

### HTTP境界

| 境界 | 保持する動作 |
|---|---|
| Origin | GET/POST/OPTIONSの処理前に検査。不許可は403。Originなしは許可 |
| CORS | 許可Originにだけ対応headerを返す。OPTIONSはpathに関係なく204 |
| body | `application/json`で始まるContent-Type、整数の正のContent-Length、96 MiB以下、JSON objectを要求 |
| 未知path | GETは404。POSTはJSON検証が先で、不正bodyなら400、有効bodyなら404 |
| 識別値 | dict応答へservice・protocolを既存の優先順で付与し、UTF-8のbyte長をContent-Lengthへ設定 |
| POST例外 | 専用競合409 → ValueError/JSON400 → LLM/Comfy503 → subprocess500 → 一般500の順序 |

GETにPOSTと同じ例外変換を新設しない。error本文、stderrへの記録、scanner用のエラー整形も保持する。

D3で必須の既存テスト修正は`tests/test_series_background_bridge.py:297`の1箇所。body上限のpatch先を`bridge.MAX_BODY_BYTES`からHTTP moduleのbindingへ変更する。constantsの定義元だけをpatchしてもHTTPのimport済みbindingには届かない。既存の`bridge.BridgeHandler`利用とinstance stubは維持する。

D3完了時に`docs/LOCAL_VISION_BRIDGE.md`へ開発者向けmodule構成を追加し、入口・state・HTTP・定数・identityとA〜Cの責務を記す。READMEや起動手順の全面書換えは行わない。

## 5 入口・互換性・起動終了処理

`nyamuru_local_bridge.py`には以下を残す。

| 残すもの | 基準行 | 維持する契約 |
|---|---|---|
| root計算・script path登録・互換import | 42〜230 | script直接起動と既存のbridge経由import |
| `parse_args` | 241〜289 | 引数名、default、環境変数、check flags |
| `checked_loopback_bind_host` | 292〜304 | localhost・loopback IPの許可と外部bindの拒否 |
| `main` | 1248〜1337 | state構築、check、HTTP server、signal、親監視、worker終了 |
| 実行guard | 1340〜1341 | script実行時だけ`main()`を呼ぶ |

既存の標準importも公開互換性のため残す。今回使われなくなったimportの一括削除、`__all__`による公開名の限定、package構成への変更は含めない。クラスの定義元は変わるが、bridge経由では同じクラスを参照できる。`__module__`の移動まで隠すための書換えは行わない。

`--check-vlm`は`--check`より先に判定し、それぞれの終了code 0/1とJSON出力を保つ。通常起動はworker shutdown eventをclearしてからHTTP serverを作り、同じstateを`server.state`へ渡す。

signal、二重のshutdown要求を抑えるevent、別threadからのworker停止→server.shutdown、親PID消失の監視、`finally`でのworker終了とserver closeを保持する。親監視の`PermissionError`を親消失へ変えない。実際のSIG送信や既存プロセスの停止は分割検証に用いない。

`scripts/start-local-bridge.mjs`、`scripts/local-bridge-supervisor.mjs`、`scripts/setup-local-vision.mjs`は引き続き同じPython入口を使用する。これらの起動経路、port、lease、共有LLM管理に変更は不要。

## 6 検証方針

### 実データから隔離する準備

importの確認と`LocalVisionState()`の生成確認を分ける。コンストラクターでは既存の処理として、VLM default解決がHF cacheの`refs/main`を読む場合があり、workspace managerが保存済みstateを読み、Krea2 serviceが期限切れVAE cacheを削除し得る。「クラスを生成するだけだから読み取り専用」とは扱わない。

実装時の一時検証では、次の対象をfixtureまたはmockへ向けてからstateを生成する。既存suiteの実行時にも、内部でstateが生成されるケースを含めて同じ隔離を適用する。

- workspace/scannerのstate pathは、各定義元moduleの既定値を一時pathへpatchするか、stateが参照するconstructorをmockする。存在しない環境変数による切替を前提にしない。
- VLM defaultは`NYAMURU_VLM_MODEL`、HF参照は`HF_HUB_CACHE`などを一時pathへ向けるか、名前を解決するmoduleでpath関数をmockする。既存テストが環境変数の優先順位を検証する場合は、そのfixtureを優先する。
- Krea2 cacheは`NYAMURU_KREA2_CACHE_ROOT`を一時rootへ向けるか、constructorをmockする。Qwen/Krea2のjob操作も一時rootと模擬HTTPに限定する。
- 実worker、モデル推論、picker、スキャナーアプリ起動、実生成endpointへの接続はstub/mockする。モデル・制作物の既存pathを一時検証へ流用しない。

隔離用wrapperの具体的なpatch箇所は各詳細計画で確定する。本番コードの副作用を削る改修は、この抽出へ混ぜない。既存の`.local-vision/.venv/bin/python`を使い、環境の再構築や依存追加は行わない。

### 段階ごとの既存スイート

| 段階 | Python | Node |
|---|---|---|
| D1 | scanner、figure-performance、character-reference、character-match、python-runtime、series-backgroundの6スイート | `localBridge.test.mjs`、`panelActions.test.mjs` |
| D2 | D1の6つ＋episode-workspace、source-coverage、project-store、panel-draft-ledger、workspace-doctorの5スイート | D1の2つ＋`panelDraft.test.mjs`、`panelGeometryImages.test.mjs`、`localBridgeLifecycle.test.mjs`、`startLocalBridge.test.mjs` |
| D3 | `test_*_bridge.py`の全16ファイル＋`test_workspace_doctor_core.py` | D2の6つ＋`localBridgeSupervisor.test.mjs` |

Python名は`tests/test_figure_performance_bridge.py`等に対応する。正確な実行コマンドと必要なwrapperは各詳細計画に記載する。各段階の変更前後で同じsuiteを使い、失敗・skipを比較する。D3はQwen/Krea2、共有LLM、WD、背景、生成QAも含む全bridge回帰確認を行う。

`npm test`はsystem `python3`を使うため、本番依存を持つPythonによる検証とは分ける。今回のPython配置変更だけを理由にフロントのbuildやAstro checkを繰り返す必要はない。新しい差分や失敗が生じた場合は対象に応じて追加する。

Nodeのsupervisor/lifecycle検証などにはfixture用ローカルHTTP serverや子プロセスを使うケースがある。全テストがメモリ内だけで完結するとは説明しない。常駐中のアプリ・bridge・LLM・ComfyUIを起動／再起動する操作とは区別する。

### 抽出そのものの確認

全段階でcompile、`git diff --check`、定義元・再exportの同一性、再帰的global参照、型注釈解決、別プロセスでの単独importを確認する。定義元moduleを先にimportする順序とbridgeを先にimportする順序の両方を確認し、循環importを作らない。

定数定義、クラス本文は基準ソースと文字列で比較する。bridge残部も、対象定義の削除・直接importの追加・境界の空行以外が一致することを確認する。A〜Cの既存module、CLI・main、launcherが不変であることを差分で確かめる。import時の確認では、ネットワーク・子プロセス・モデル読込・ファイル書込を要求しないことも分けて確認する。

| 段階 | 一時スクリプト等で補う境界確認 |
|---|---|
| D1 | 7定義の値・型・所有先、setとregexを含む再exportの参照、Originの許可/拒否、body上限 |
| D2 | 12メソッドの全文一致、4つのworker path、constructorの生成順・共有インスタンス・2つのlock、20箇所のpatch先 |
| D3 | 8メソッドの全文一致、55 POST/1 GETのpathと順序、CORS/OPTIONS・JSON/上限・404・例外status・識別値、1箇所のpatch先 |

D3のHTTP確認は、実handlerの`do_POST`・`read_json`・`send_json`などへメモリ入出力とstate stubを接続する。既存のruntime testは4つの解析ルートのlockとbase64解放を検証しているが、analyze-setは含まないため補う。layer submitのlease内実行、scanner起動失敗時のcancelも確認する。55ルートすべてを別の恒久テストで再実装する必要はない。

入口は、変更しない本文の一致に加え、模擬state・server・signal登録・thread・eventを使った一時harnessで接続を確認する。check flagsの優先順と終了code、serverへのstate/handler設定、shutdown要求の重複抑止、親消失、finallyの終了処理を対象にする。実signal登録・実プロセスへのsignal送信・実server起動をこのharnessへ混ぜない。

テスト検出件数、成功、skip、mockで確認した範囲を実行時に記録する。この計画作成でテストを実行したとは扱わず、単体・HTTP fixtureの成功を実モデルや実スキャナーの確認と同一視しない。

## 7 実装時の手順と完了条件

各段階の進め方は次のとおり。

1. 対象段階の詳細計画を作り、正確な変更path・import・patch先・隔離方法・検証コマンドを示す。
2. その段階の実行指示を受けてから、Git状態・共有掲示板を再確認し、回復点のHEADと既存未追跡ファイルを記録して対象pathをclaimする。
3. 隔離した既存スイートの基準結果を取り、定義を移動してbridgeに直接importを追加する。必要なpatch先変更は同じ段階で行う。
4. 本文一致、compile、回帰スイート、一時境界確認、全diff確認を行い、独立した読み取り専用レビューを受ける。
5. exact pathだけをstageし、staged diffを確認してローカルコミットする。作業ファイル・検証対象・commitの一致を確認し、claimを解放する。
6. 完了コミット、検証結果、skipと未検証範囲を報告する。次段階はその詳細計画と実行指示を経て着手する。

実装時の予定変更pathは次の範囲に限る。今回の計画作成では、この文書だけを作成する。

| 段階 | 予定変更path |
|---|---|
| D1 | `scripts/nyamuru_local_bridge.py`、新規`scripts/nyamuru_bridge_constants.py` |
| D2 | `scripts/nyamuru_local_bridge.py`、新規`scripts/nyamuru_vision_state.py`、3節に列挙した5テストファイル |
| D3 | `scripts/nyamuru_local_bridge.py`、新規`scripts/nyamuru_bridge_http.py`、`tests/test_series_background_bridge.py`、`docs/LOCAL_VISION_BRIDGE.md` |

上表の新規pathは`scripts/`直下。詳細計画書は別途日付付きで`docs/`へ保存し、その都度claimする。対象を広げる必要が出た場合は、先に理由と共有掲示板の予約を更新する。

コミット例は、D1が`refactor: extract bridge constants`、D2が`refactor: extract local vision state`、D3が`refactor: extract bridge HTTP handler`。利用者の未追跡計画書6ファイルは各コミットに含めない。

Phase Dの完了条件は、3moduleへの抽出、同じ公開名・解析結果・HTTP契約・起動終了動作の維持、bridge 500行以下、関連検証とレビューの通過、開発文書への構成反映である。常駐サービスの再起動、実画像推論、実台帳への保存・移行、モデル取得、環境変更、pushは含めない。
