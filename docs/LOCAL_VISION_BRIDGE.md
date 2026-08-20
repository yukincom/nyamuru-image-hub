# ローカル画像解析連携

新規作成画面では、紙のネーム画像を最大10枚まで読み込み、次の役割分担で解析します。

- RT-DETRv4-X Manga109-s v2: コマ・文字領域・顔・身体の検出
- RT-DETRの顔・身体・文字領域: コマ候補と同一領域にある誤検出の除外
- OpenCV: RT-DETRがコマを検出できない場合だけ使う輪郭補助
- NDLOCR-Lite: 検出した領域の手書き文字認識
- 手動確認: 解析前にすべての画像を正立させ、0°・90°・180°・270°の向きを確定

画像はファイルを選択しただけでは解析処理へ渡されません。利用者が必要な画像をプレビュー上で回転させ、「解析開始」を押した時だけ、`127.0.0.1`で待ち受けるローカル連携へ1枚ずつ送られます。外部サービスへの送信は行いません。検出したコマはA〜Zのテンプレートへ分類・変換せず、正規化した矩形座標をそのまま編集可能なコマとして新規ページへ反映します。A〜Zは手動で開始する場合のプリセットとして残ります。文字候補は位置に対応するコマの編集可能なフキダシ、顔・身体の候補は編集可能な人物あたりとして配置します。誤読を前提に、低確信度の文字は画面で「要確認」と表示します。

ファイル選択で読み込んだ元画像は変更・削除しません。解析用の一時画像は各処理の終了時に削除します。プレビュー用の一時File、Object URL、回転情報、判定結果はブラウザ保存へ含めず、検出コマからページ作成を確定した時または新規作成画面を閉じた時に破棄します。

## セットアップ

通常のNyamuru編集にはこのbridgeは不要です。「紙のネームからコマを読み取る」で画像解析を行う場合だけ準備してください。

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
- [NDLOCR-Lite v1.2.3](https://github.com/ndl-lab/ndlocr-lite/releases/tag/1.2.3) と公式モデル
- [RT-DETRv4-X Manga109-s v2](https://huggingface.co/tori29umai/rtdetrv4-x-manga109s_v2) のONNXモデル

RT-DETRモデルは固定した公式リビジョンから取得し、SHA-256が一致した場合だけ確定します。モデルや外部リポジトリはGit、Webビルド、スタンドアロンHTMLへ含まれません。アプリ起動時の自動取得も行いません。

既定の配置は次のとおりです。

```text
nyamuru-image-hub/
└── .local-vision/                 # Git対象外
    ├── .venv/
    ├── models/
    │   └── rtdetrv4-x-manga109s_v2/model.onnx
    └── ndlocr-lite/
        └── src/model/
```

非対話環境で、表示された条件を別途確認済みの場合は `npm run setup:vision -- --yes` を使用できます。保存先を変更する場合は、セットアップと起動の両方で同じルートを指定します。

```bash
npm run setup:vision -- --root /path/to/nyamuru-vision
NYAMURU_VISION_ROOT=/path/to/nyamuru-vision npm run bridge
```

使用版と再配布上の注意は [LOCAL_VISION_COMPONENTS.md](./LOCAL_VISION_COMPONENTS.md) に記載しています。

## 起動と終了

環境確認は次を使います。

```bash
npm run bridge:check
```

RT-DETR、NDLOCR-Lite、スキャナー連携の検出状態と参照先が表示されます。どれかが見つからない場合は、下記の環境変数または配置を確認してください。

ターミナル1でbridgeを起動します。

```bash
npm run bridge
```

ターミナル2でNyamuruを起動します。

```bash
npm run dev
```

ブラウザで表示されたlocalhostのURLを開きます。bridgeを終了する場合は、ターミナル1でCtrl+Cを押します。

ComfyUIやVLMは不要です。個別の保存先を指定する必要がある場合は、`NYAMURU_VISION_PYTHON`、`NYAMURU_RTDETR_MODEL`、`NYAMURU_NDLOCR_ROOT`、`NYAMURU_NDLOCR_PYTHON`を使用できます。bridge本体だけ別のPythonで起動する場合は`NYAMURU_BRIDGE_PYTHON`を指定します。

```bash
NYAMURU_VISION_PYTHON=/path/to/python \
NYAMURU_RTDETR_MODEL=/path/to/model.onnx \
NYAMURU_NDLOCR_ROOT=/path/to/ndlocr-lite \
npm run bridge
```

## 解析中の処理

1. ブラウザが表示中の向きで画像をJPEGへ正規化します。
2. Nyamuru内の推論コードからRT-DETRを起動し、コマ・文字・顔・身体を検出します。
3. RT-DETRでコマが見つからない場合だけ、OpenCVの輪郭候補を使います。
4. 同じ画像解析専用環境からNDLOCR-Liteを起動し、文字を認識します。
5. 結果JSONだけをブラウザへ返し、bridge側の一時画像を削除します。

解析は1画像ずつ実行します。最大10枚の一括読込でも、モデルを複数同時起動してメモリを競合させません。

## スキャナー

「スキャナーを起動」は、ローカル連携からmacOS標準のイメージキャプチャを開き、開始時刻から5分間、イメージキャプチャに設定されている保存先を監視します。書類名の接頭辞（標準では「スキャン」）と一致し、開始後に新規作成され、書き込みが完了した画像だけを時刻順に最大10枚取り込みます。

取り込んだスキャン元ファイルは、利用者が検出結果を確認して「編集開始」を押すまで保存先に残します。ページ作成を確定した場合に加え、新規作成画面を明示的に閉じた場合、手動画像へ切り替えた場合、または「破棄する」を選んだ場合は、そのセッションで取り込んだスキャン元ファイルを削除します。開始前から存在するファイル、接頭辞が異なるファイル、11枚目以降のファイルは削除しません。

ブラウザの再読み込み、アプリやローカル連携の強制終了では、スキャン元を削除しません。ローカル連携は画像本体ではなく、開始時刻・保存先・対象ファイル名だけを `~/Library/Application Support/Nyamuru Manga Name Studio/scanner-session.json` に記録します。次に新規作成画面を開くと「前回のスキャン画像が残っています」と表示し、「つなぎ直す」または「破棄する」を選べます。

## 接続範囲

ローカル連携は `127.0.0.1:8787` のみに待ち受け、`localhost`または`127.0.0.1`で開いたNyamuruからのリクエストだけを受け付けます。

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

### `bridge:check`でNDLOCR-Liteが利用不可

次を確認します。

```text
.local-vision/.venv/bin/python
.local-vision/ndlocr-lite/src/model/
```

### 解析ボタンを押しても接続できない

- `npm run bridge`が終了していないか確認します。
- Nyamuruを`localhost`または`127.0.0.1`で開いているか確認します。
- ポート8787を別のプロセスが使用していないか確認します。
- 公開サイトからローカルbridgeへ接続しようとしていないか確認します。

### スキャンが終わらない

イメージキャプチャで必要な画像を保存した後、Nyamuruの「取り込みを終了」を押します。これは監視を終了し、イメージキャプチャも閉じます。強制終了で画像が残った場合は、次回の新規作成画面で「つなぎ直す」または「破棄する」を選びます。
