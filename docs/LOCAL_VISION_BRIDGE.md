# ローカル画像解析連携

新規作成画面では、紙のネーム画像を最大10枚まで読み込み、次の役割分担で解析します。

- RT-DETRv4-X Manga109-s v2: コマ・文字領域・顔・身体の検出
- RT-DETRの顔・身体・文字領域: コマ候補と同一領域にある誤検出の除外
- OpenCV: RT-DETRがコマを検出できない場合だけ使う輪郭補助
- Baberu OCR: 検出した領域の手書き文字候補
- WD ViT Tagger v3: 検出済みの顔切り抜きから表情の補助候補を抽出
- 手動確認: 解析前にすべての画像を正立させ、0°・90°・180°・270°の向きを確定

画像はファイルを選択しただけでは解析処理へ渡されません。利用者が必要な画像をプレビュー上で回転させ、「解析開始」を押した時だけ、`127.0.0.1`で待ち受けるローカル連携へ1枚ずつ送られます。外部サービスへの送信は行いません。検出したコマはA〜Zのテンプレートへ分類・変換せず、正規化した検出座標をそのまま編集可能なコマとして新規ページへ反映します。A〜Zは手動で開始する場合のプリセットとして残ります。文字候補は位置に対応するコマの編集可能なフキダシ、顔・身体の候補は編集可能な人物あたりとして配置します。文字は誤読を前提に、レベル補正した原画参照を背面に表示しながら人間が入力・修正できます。原画参照をオフにすると入力文字へ切り替わります。

ファイル選択で読み込んだ元画像は変更・削除しません。解析用の一時画像は各処理の終了時に削除します。プレビュー用の一時File、Object URL、回転情報、判定結果はブラウザ保存へ含めず、検出コマからページ作成を確定した時または新規作成画面を閉じた時に破棄します。

## セットアップ

通常のNyamuru編集にはこのbridgeは不要です。「紙のネームからコマを読み取る」で画像解析を行う場合、人物切り抜きから演技候補を作る場合、またはシリーズ人物資料をローカル保存・解析する場合だけ準備してください。

- Node.js 22.12.0以上
- Python 3.10〜3.13
- 初回セットアップ時のインターネット接続
- スキャナー連携を使う場合はmacOSのイメージキャプチャ

最初にJavaScript依存を導入し、続いて明示的な画像解析セットアップを実行します。

```bash
npm ci
npm run setup:vision
```

`setup:vision`は取得対象、保存先、容量、ライセンスを表示し、利用者が同意した場合だけ次を `.local-vision/` へ導入します。

- 画像解析専用Python仮想環境
- [Baberu OCR](https://huggingface.co/genshiai-daichi/baberu-ocr) のONNXモデル・推論ファイル・トークナイザー
- [RT-DETRv4-X Manga109-s v2](https://huggingface.co/tori29umai/rtdetrv4-x-manga109s_v2) のONNXモデル
- [WD ViT Tagger v3](https://huggingface.co/SmilingWolf/wd-vit-tagger-v3) のONNXモデル・タグ一覧・ライセンスmetadataを含むmodel card

RT-DETR、Baberu、WDのファイルは固定した配布元リビジョンから取得し、SHA-256が一致した場合だけ確定します。モデルや外部リポジトリはGit、Webビルド、スタンドアロンHTMLへ含まれません。アプリ起動時の自動取得も行いません。

既定の解析環境は、このリポジトリ直下の`.local-vision/`だけです。bridgeは兄弟ディレクトリや別プロジェクトの仮想環境・モデルを暗黙に探索しません。保存先を変える場合も、Nyamuru用として用意した同じルートをセットアップと起動の両方へ明示してください。

RT-DETRの`model.onnx`はこの保存先に通常ファイルとして保持し、`manga-babble-maker`など別プロジェクト内のモデルへのシンボリックリンクで代用しません。配置の確認では表示上のパスだけでなく、リンクの有無と実体の保存先も確認します。2026-10-21に旧Bubble Maker内へのリンク残存を確認し、同一の重み実体へ置き換えました。[経緯と修正・検証](2026-10-21-manga-babble-retirement.md)を参照してください。

既定の配置は次のとおりです。

```text
nyamuru-image-hub/
└── .local-vision/                 # Git対象外
    ├── .venv/
    ├── models/
    │   ├── rtdetrv4-x-manga109s_v2/model.onnx
    │   ├── wd-vit-tagger-v3/
    │   │   ├── model.onnx
    │   │   ├── selected_tags.csv
    │   │   └── README.md
    │   └── baberu-ocr/
    │       ├── onnx/
    │       ├── tokenizer/
    │       ├── onnx_infer.py
    │       └── LICENSE
```

非対話環境で、表示された条件を別途確認済みの場合は `npm run setup:vision -- --yes` を使用できます。保存先を変更する場合は、セットアップと起動の両方で同じルートを指定します。

```bash
npm run setup:vision -- --root /path/to/nyamuru-vision
NYAMURU_VISION_ROOT=/path/to/nyamuru-vision npm run bridge
```

使用版と再配布上の注意は [LOCAL_VISION_COMPONENTS.md](./LOCAL_VISION_COMPONENTS.md) に記載しています。

### Python証明書パッケージの更新

セットアップでは依存導入前に、Python公式告知のSHA-256付きwheelでpipを26.2.2以上へ更新し、certifi 2026.10.19以上を導入します。既に最低版以上の場合は保持します。既存環境のこの2パッケージだけを更新する場合は次を実行します。

```bash
npm run setup:vision -- --update-certificates
```

`--root /path/to/root`を指定すると、その直下の既存`.venv`が対象です。モデル取得、他の依存の更新、仮想環境の作成は行いません。VLMが共有環境を参照する場合は、`bridge:check-vlm`で実際のPythonパスと他アプリへの影響を確認してから、その環境のrootを明示してください。通常起動・診断はこの更新処理や版検査を呼びません。[2026-10-23の対応記録](2026-10-23-python-certificate-updates.md)。

## 起動と終了

環境確認は次を使います。

```bash
npm run bridge:check
```

RT-DETR、Baberu OCR、WD表情補助、スキャナー連携の検出状態と参照先が表示されます。人物演技と人物資料の特徴抽出に使うVLMだけを確認する場合は次を使います。

```bash
npm run bridge:check-vlm
```

どれかが見つからない場合は、下記の環境変数または配置を確認してください。

Nyamuruを起動します。

```bash
npm run dev
```

ブラウザで表示されたlocalhostのURLを開きます。「新規作成」を開くとbridgeが自動で起動し、作成完了またはキャンセル時に自動で終了します。複数の画面が新規作成を開いている場合は、最後の画面が終了するまで維持します。あらかじめ手動起動されていたbridgeはNyamuruが勝手に終了しません。`npm run dev`は親のnpmプロセスを監視し、親終了時にも管理中のbridgeを停止します。同じリポジトリからの二重起動は拒否します。解析中にbridgeを終了した場合は、起動中のモデルワーカーを停止して解析用一時画像を削除します。通常停止に5秒以上かかった場合は、残留を防ぐため管理中のプロセスを強制終了します。

新規作成で選択したエピソードフォルダは、この画面を開いている間だけbridgeへ登録します。登場人物のデザイン画像、舞台設定の文章、紙のネーム画像の選択画面は、そのフォルダから開きます。編集開始を確定した時だけ、直下へ`name_data`、`draft_data`、`manuscript_data`、`export_data`を作ります。既存のファイルや利用者独自の元データフォルダには触れません。読み切りでも同じ処理を使い、シリーズ人物台帳は要求しません。

bridgeを単独で確認・調査するときだけ、別ターミナルで次を実行できます。

```bash
npm run bridge
```

単一HTMLのスタンドアロン版はOSのプロセスを起動できないため、自動起動には対応しません。ローカル画像解析やスキャナー連携を使う場合は、`npm run dev`で開くローカル起動版を使用します。

ページ全体のアナログ取込にComfyUIやVLMは不要です。個別の保存先を指定する必要がある場合は、`NYAMURU_VISION_PYTHON`、`NYAMURU_RTDETR_MODEL`、`NYAMURU_BABERU_MODEL`を使用できます。bridge本体だけ別のPythonで起動する場合は`NYAMURU_BRIDGE_PYTHON`を指定します。

```bash
NYAMURU_VISION_PYTHON=/path/to/python \
NYAMURU_RTDETR_MODEL=/path/to/model.onnx \
NYAMURU_BABERU_MODEL=/path/to/baberu-ocr \
npm run dev
```

人物の演技読み取りと設定画の特徴抽出には、ローカルのQwen3-VL/MLXを使います。表情照合は、原稿から切り抜いた対象人物の顔1枚・[表情専用の英文](../scripts/qwen_face_expression_prompt.txt)・[86項目の辞書](../scripts/expression_catalog.json)をQwen-VLに渡します。Qwen-VLが各部位のID・観察根拠を選び、生成用の英文を書きます。人物画像は姿勢と人物照合に使います。顔の検出位置が決まっていれば、導入済みのWDは同じ顔の表情候補だけを補助入力できます。顔の位置が不明なときはQwen-VLが姿勢読み取りの中で位置を特定し、その範囲を切り抜いて表情を照合します。

「環境設定 → AIモデル → 画像VLM」には、ローカルに保存済みのHugging FaceモデルIDを `owner/repository` 形式で指定します。既定は `lmstudio-community/Qwen3-VL-8B-Instruct-MLX-4bit`。人物演技、人物資料1枚、人物資料一括、人物照合の4つの明示解析は、操作時にこの端末設定をbridgeへ渡します。bridgeはHugging Faceのローカルcacheにある `refs/main` または唯一のsnapshotだけを解決し、未保存モデルを取得せずにエラーにします。設定欄を編集・保存しただけでは解析もモデル読込も始まりません。

VLM実行Pythonと起動時の既定配置は、兄弟ディレクトリの`ComfyUI/.venv`、`NYAMURU_VLM_PYTHON`、`NYAMURU_VLM_MODEL`、`NYAMURU_VLM_MODEL_LABEL`で指定できます。画面で明示したHugging FaceモデルIDは、その操作のモデル選択として起動時既定より優先されます。推論ワーカーにはオフライン設定を渡します。HTTP経由の4種類のVLM解析とページ解析は同じロックを共有します。RT-DETR・OCR・WD・VLMは短命の子プロセスで実行し、終了を待ってから次へ進みます。WDはbridgeと同じPythonを使います。文章LLM・ComfyUIは別プロセス管理のため、このロックでは排他されません。

`npm run bridge:check` と `npm run bridge:check-vlm` は読み取り専用です。稼働中のbridgeの所有記録を変更せず、モデル推論も起動しません。

```bash
NYAMURU_VLM_PYTHON=/path/to/python \
NYAMURU_VLM_MODEL=/path/to/local-model \
npm run dev
```

## 解析中の処理

1. ブラウザが表示中の向きで画像をJPEGへ正規化します。
2. Nyamuru内の推論コードからRT-DETRを起動し、コマ・文字・顔・身体を検出します。
3. RT-DETRでコマが見つからない場合だけ、OpenCVの輪郭候補を使います。
4. 同じ画像解析専用環境からBaberu OCRを呼び出し、文字候補を認識します。
5. 検出された文字領域を同じ位置・大きさで切り出してレベル補正し、ブラウザ内だけで原画参照として保持します。
6. 結果JSONだけをブラウザへ返し、bridge側の一時画像を削除します。

解析は1画像ずつ実行します。最大10枚の一括読込でも、モデルを複数同時起動してメモリを競合させません。

## シリーズ人物資料の保存

シリーズ人物台帳は次の場所へ保存します。保存先は`NYAMURU_SERIES_CATALOG_ROOT`またはbridgeの`--series-root`で変更できます。

```text
~/Library/Application Support/Nyamuru Manga Name Studio/series-common/
└── <series-id>/
    ├── catalog.json
    ├── series.yaml
    └── characters/
        └── <character-id>/
            └── image-<sha256>.png
```

ブラウザ側で人物資料をPNGへ正規化し、SHA-256で同一画像を重複保存しません。台帳の保存は読み込み時のリビジョンを照合し、別の画面や話から先に更新された場合はHTTP 409で停止します。旧名の互換読み込みと新旧競合は [作品保存](./PROJECT_SAVE.md) を参照してください。画像選択だけではVLM解析を行わず、「特徴を抽出」を押した1枚だけを`/api/character-reference/analyze`へ渡します。台帳とOMNYの関係は [SERIES_CHARACTER_CATALOG.md](./SERIES_CHARACTER_CATALOG.md) を参照してください。

## スキャナー

「スキャナーを起動」は、ローカル連携からmacOS標準のイメージキャプチャを開き、開始時刻から5分間、イメージキャプチャに設定されている保存先を監視します。書類名の接頭辞（標準では「スキャン」）と一致し、開始後に新規作成され、書き込みが完了した画像だけを時刻順に最大10枚取り込みます。

取り込んだスキャン元ファイルは、利用者が検出結果を確認して「編集開始」を押すまで保存先に残します。ページ作成を確定した場合に加え、新規作成画面を明示的に閉じた場合、手動画像へ切り替えた場合、または「破棄する」を選んだ場合は、そのセッションで取り込んだスキャン元ファイルを削除します。開始前から存在するファイル、接頭辞が異なるファイル、11枚目以降のファイルは削除しません。

ブラウザの再読み込み、アプリやローカル連携の強制終了では、スキャン元を削除しません。ローカル連携は画像本体ではなく、開始時刻・保存先・対象ファイル名だけを `~/Library/Application Support/Nyamuru Manga Name Studio/scanner-session.json` に記録します。次に新規作成画面を開くと「前回のスキャン画像が残っています」と表示し、「つなぎ直す」または「破棄する」を選べます。

## 接続範囲

ローカル連携は `127.0.0.1:8787` のみに待ち受け、`localhost`または`127.0.0.1`で開いたNyamuruからのリクエストだけを受け付けます。ブラウザは画像を送る前にservice名とプロトコル版を確認し、古いbridgeや別アプリには原稿をPOSTしません。

この制限により、GitHub PagesやChatGPT Sitesなどの公開URLからローカルbridgeを呼び出すことはできません。ホスト版では通常の編集・OMNY入出力・コマ編集支援を利用し、アナログ解析はローカル起動時だけ利用してください。

## トラブルシューティング

### `ローカル画像解析環境が見つかりません`

`npm run setup:vision`を実行してから、`npm run bridge:check`で保存先を確認します。

### `bridge:check`でRT-DETRが利用不可

次の2ファイルが必要です。

```text
.local-vision/.venv/bin/python
.local-vision/models/rtdetrv4-x-manga109s_v2/model.onnx
```

別の保存先を使用した場合は`NYAMURU_VISION_ROOT`または`NYAMURU_RTDETR_MODEL`を指定します。

### `bridge:check`でBaberu OCRが利用不可

次を確認します。

```text
.local-vision/.venv/bin/python
.local-vision/models/baberu-ocr/onnx/
.local-vision/models/baberu-ocr/tokenizer/
.local-vision/models/baberu-ocr/onnx_infer.py
```

### 解析ボタンを押しても接続できない

- `npm run bridge`が終了していないか確認します。
- Nyamuruを`localhost`または`127.0.0.1`で開いているか確認します。
- ポート8787を別のプロセスが使用していないか確認します。
- 公開サイトからローカルbridgeへ接続しようとしていないか確認します。

### `ローカルbridgeが古いか別のアプリです`

以前のbridgeがポート8787に残っているか、別のローカルアプリへ接続しています。起動中のbridgeをすべて終了し、このリポジトリで`npm run bridge`を起動し直してください。Nyamuruはコマ形状が欠けた旧形式を矩形へ黙って置き換えず、誤所属を防ぐため解析を中止します。

### スキャンが終わらない

イメージキャプチャで必要な画像を保存した後、Nyamuruの「取り込みを終了」を押します。これは監視を終了し、イメージキャプチャも閉じます。強制終了で画像が残った場合は、次回の新規作成画面で「つなぎ直す」または「破棄する」を選びます。

## 開発時のmodule構成

起動入口は[`scripts/nyamuru_local_bridge.py`](../scripts/nyamuru_local_bridge.py)です。`start-local-bridge.mjs`、supervisor、setupからも同じ入口を使用します。内部の担当は次のとおりです。

| `scripts/`内のmodule | 担当 |
|---|---|
| `nyamuru_local_bridge.py` | CLI、loopback bind検査、signal・親PID監視、worker終了、互換公開名の再export |
| `nyamuru_bridge_constants.py` | HTTP body上限・Origin regex、LLMモード、解析のsize/view候補 |
| `nyamuru_bridge_identity.py` | サービス名・レイアウトprotocol version |
| `nyamuru_vision_state.py` | store/serviceの生成と共有、画像・人物・資料の解析パイプライン |
| `nyamuru_bridge_http.py` | Origin/JSON/HTTP status、既存ルートの委譲、解析lock・生成leaseとの接続 |
| `nyamuru_layout_geometry.py` | コマ・人物領域の選別、読み順、輪郭とshape |
| `nyamuru_worker_runtime.py` | workerプロセスの所有・終了、runtime/path解決、worker呼出し |
| `nyamuru_ocr_util.py` | 画像decode・回転、OCR候補の整形 |
| `nyamuru_macos_picker.py` / `nyamuru_scanner_sessions.py` | macOSの選択UI、スキャンsessionと取り込み状態 |
| `nyamuru_analog_asset_store.py` | アナログ画像素材の保存・読込 |
| `nyamuru_series_catalog_store.py` | シリーズ・人物台帳、人物資料・画像、下書きと履歴 |
| `nyamuru_episode_workspace.py` | エピソードworkspaceと参照素材・原作coverageの管理 |
| `nyamuru_panel_actions.py` | 人物アクション提案と関連テキスト処理のLLM接続 |
| `nyamuru_panel_draft_ledger.py` | 下書きattempt・artifact・reviewのSQLite/ファイル台帳 |
| `nyamuru_comfy_draft.py` | 固定下書きworkflow、ComfyUI通信・監視、画像変換 |
| `nyamuru_panel_draft_jobs.py` | 下書きの生成・再照合・一覧・reviewの仲介 |
| `nyamuru_project_store.py` / `nyamuru_series_background_store.py` | プロジェクトsnapshotとシリーズ背景モデルの保存・読込 |
| `qwen_generation.py` / `generation_store.py` | Qwen Turboのjob・通信処理と生成データの保存・cache管理 |

入口からHTTP・stateを参照し、HTTPはstateと各機能moduleへ依存します。stateやHTTPから入口を逆importしません。サービス識別値はidentity、機能固有の定数は担当moduleに置きます。

既存コードは入口経由の公開名も使用できます。テストで関数や定数のbindingを置き換える場合は、実際に参照するmoduleへpatchします。例えば解析workerは`nyamuru_vision_state`、HTTP受信上限は`nyamuru_bridge_http`が対象です。

`LocalVisionState`の生成時には保存済みworkspace stateの読取と期限切れ生成cacheの整理があり得るため、検証は一時state/cacheとfixtureで隔離します。単独importの確認と、stateの生成・実モデル推論の確認は区別してください。分割手順と検証範囲は[2026-10-07 Phase D計画](2026_10_07_codex_refactoring_plan_nyamuru_local_bridge_D_wiring_http.md)に記録しています。
