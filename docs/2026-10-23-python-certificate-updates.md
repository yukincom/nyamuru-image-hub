# 2026-10-23 Python証明書パッケージの更新

## 根拠と対象

[Python公式告知](https://discuss.python.org/t/information-for-python-users-regarding-emudhra-emsign-ca-certificate-security-incident/109576)に基づき、pip 26.2.2以上、certifi 2026.10.19以上へ対応した。certifiだけの更新ではpip同梱のCA bundleが更新されないため、両方を対象にした。CAファイルを手作業で編集せず、公式パッケージを導入した。

正本は `<repository-root>`、作業開始時のHEADは `baafc8c`。`bridge:check-vlm`で確認した実接続先は次の2環境だった。更新前から稼働するLANプロセスPID 45765、他の未commit変更、原稿、モデルを保持した。

| 環境 | pip 更新前 → 更新後 | certifi 更新前 → 更新後 |
|---|---|---|
| `Comic_image_Hub/.local-vision/.venv` | 24.0 → 26.2.2 | 2026.7.22 → 2026.10.23 |
| 共有VLM用 `ComfyUI/.venv` | 26.1 → 26.2.2 | 2026.1.4 → 2026.10.23 |

共有環境のモデルは既存の `lmstudio-community/Qwen3-VL-8B-Instruct-MLX-4bit`。更新前のプロセス確認では、ComfyUI・8080・bridgeの待受はなく、LAN入口だけが稼働していた。2環境の全パッケージmetadata（35件／97件）を更新前後で比較し、版が変わったのはそれぞれpipとcertifiだけだった。両環境とも `pip check` は更新前後とも `No broken requirements found`。

対象CAのDER SHA-256:

```text
86a1ecba089c4a8d3bbe2734c612ba341d813e043cf9e8a862cd5c57a36bbe6b
```

両環境の `certifi/cacert.pem` と `pip/_vendor/certifi/cacert.pem`、計4ファイルに更新前は存在し、更新後はすべて不存在。PEMをDERへデコードしたSHA-256で照合した。変更前に記録した画像解析／VLMモデル26ファイルのサイズ・更新時刻も一致した。

## 導入経路

既存の `npm run setup:vision` と `scripts/setup-local-vision.mjs` を拡張した。

- 通常setupはvenv作成／確認の直後、requirementsやモデル取得より前に更新する。
- 古いpipの初回更新は、公式告知の固定wheel URLとSHA-256を用いる。`--no-index --no-deps --no-cache-dir`を付け、通常indexによる依存解決を行わない。
- pipの更新を実Python環境で確認してからcertifiを更新する。certifiも `--no-deps` で他のパッケージを更新しない。
- `importlib.metadata`とPEP 440の比較で最低版を確認する。既に最低版以上のパッケージは保持し、再実行時はダウンロードしない。
- `--update-certificates` は既存 `ROOT/.venv` の2パッケージだけを対象にする。存在しない環境は作らず終了する。`--root`／`NYAMURU_VISION_ROOT`を再利用する。
- `requirements-vision.txt` と `requirements-qa.txt` にcertifiの最低版を指定した。CIも同じ更新関数を依存導入前に使う。変更した `ci.yml` の実行契機は `push: main` のみ。
- 通常起動・診断へ版ガードや自動更新を追加していない。TLS検証は有効のまま。
- 対象の導入・起動経路はPython/pipを使用し、uvを呼ばない。Python本体がuv管理の保存先にあることだけを理由にuvや他の環境を変更していない。

実行した更新コマンド:

```bash
npm run setup:vision -- --yes --update-certificates
npm run setup:vision -- --yes --update-certificates --root ../ComfyUI
```

それぞれの再実行も成功し、追加のinstallは発生しなかった。初回のsandbox内実行は名前解決制限で失敗したため、権限付きで同じコマンドを実行した。

## 検証結果と範囲

- `tests/localVisionSetup.test.mjs`: 12件成功。固定hash、更新順序、失敗時の中断、新版の保持、既存root限定、環境を作らない更新、通常setupでbootstrapが失敗した場合に依存・モデル取得へ進まないことを検証。
- `npm run verify`: Astro 403ファイル、error/warning 0（既存hint 3件）。Node 1,075件成功・3skip、Python 426件（50skip）／18件（1skip）／45件（21skip）、通常／standalone build成功。sandboxでは一時HTTP待受を使う5件がEPERMとなったため、権限付きで再実行して全体成功を確認した。その後追加した通常setup中断テストも、対象12件の再実行で成功。
- `bridge:check`／`bridge:check-vlm`: 更新前後のJSONが一致。RT-DETR、Baberu、WD、VLM、scannerの利用可否と参照先を保持。
- 実画像解析: 既存fixture `tests/fixtures/generation_qa/valid-black-white.png` を実workerへ渡し、RT-DETR 1.74秒、Baberu 0.31秒、WD Tagger 0.55秒、すべて成功。
- 実VLM: 同じfixtureに対し、既存の資料分類prompt・前処理・JSON抽出を使いQwen3-VLで推論。`reference_view: other`、モデル読み込み＋推論2.27秒、子プロセス全体6.28秒、MLXピーク約6.71GB。OOM／timeoutなし。Hugging Face・Transformers・Datasetsはoffline設定で、モデル取得・画像外部送信なし。
- 上記画像は人工的な既存テストfixtureであり、人物認識精度やユーザー原稿の評価ではない。新規環境へモデル一式を再取得する試験、ComfyUIの画像生成、別PCでのブラウザー編集は今回実行していない。
- 読み取り専用の独立レビューで、bootstrap／更新専用処理／通常起動の境界に実害のある問題なし。実venvの更新と再実行により、Python subprocess・実metadataの検査も確認した。
- 今回は常駐サーバーを起動していない。テストと推論の子プロセスは終了済み。既存LAN PID 45765／4322の待受を維持。

## 公開版への準備

公開main `68aaf0b27d92ea203ca20d970d003866d2d30a14` を基準に、[適用用patch](2026-10-23-public-certificate-update.patch)を用意した。公開版のNDLOCR-Lite構成を保持し、ローカルのBaberu／WD構成を移植しない。

対象は公開版の `scripts/setup-local-vision.mjs`、`requirements-vision.txt`、`tests/localVisionSetup.test.mjs`、`docs/LOCAL_VISION_BRIDGE.md` の4ファイル。共通の証明書更新処理と更新専用flagを移植し、通常setupでは2つのrequirementsを1回のpip実行へまとめ、NDLOCR依存の解決時にもcertifiの最低版を適用する。

公開commitから抽出した検証コピーで `git apply --check`、実際のpatch適用、公開版setupの12テストが成功した。公開版全体のbuild・推論は未実行。実際の公開branch、remote、Pages workflowは変更していない。公開repoの既存workflowはPython導入を含まず、公開を有効にする変更もpatchに含めない。

公開先へのpushは実行していない。将来公開へ反映する際は、公開HEADとの変更競合を再確認し、このpatchを機能単位で統合・検証する。
