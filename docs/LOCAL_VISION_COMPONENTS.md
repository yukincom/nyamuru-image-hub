# ローカル画像解析コンポーネントとライセンス

Nyamuru本体はMITライセンスですが、任意で接続するローカル画像解析ソフトウェアとモデルには別のライセンスが適用されます。この文書はREADMEとは別に、その境界と配置方針を記録するものです。

## 同梱状況

| コンポーネント | Nyamuruへ同梱 | この環境での利用形態 | 確認事項 |
|---|---|---|---|
| Baberu OCR | しない | `setup:vision`が配布元の固定リビジョンから検証済みファイルをGit対象外領域へ取得 | Apache-2.0、モデルカード |
| RT-DETR Manga109-s v2モデル | しない | `setup:vision`が公式ONNXをGit対象外領域へ取得 | Apache-2.0、モデルカード、学習データ条件 |
| WD ViT Tagger v3 | しない | `setup:vision`が固定リビジョンのONNX・タグ一覧・モデルカードをGit対象外領域へ取得 | モデルカードmetadataのApache-2.0、学習データ説明 |

このリポジトリに含まれるのは、RT-DETR、Baberu OCR、WD ViT Tagger v3をローカルで呼び出すbridge、変換処理、明示実行のセットアップスクリプトです。モデル重み、外部推論ファイル、仮想環境はGitや配布物へ同梱しません。

`npm run setup:vision`は利用者の確認後に各公式配布元から直接取得します。アプリの起動や画像の読み込みだけではダウンロードしません。

## Baberu OCR

- 配布元: <https://huggingface.co/genshiai-daichi/baberu-ocr>
- セットアップ固定リビジョン: `d9cc13153e9a1cd8fdfa3b7b1cc329da2020aeae`
- 提供者: genshiai-daichi
- ライセンス: Apache License 2.0
- ライセンス本文: 配布元の `LICENSE`

Baberu OCRはNyamuru本体のMITライセンスへ変更されません。共有・再配布する場合は、配布元のモデルカードとApache License 2.0の条件を確認してください。依存ライブラリにはそれぞれ別のライセンスがあります。

NyamuruのbridgeはBaberu OCRのONNXモデルと配布元の推論コードをローカルの別プロセスから呼び出します。配布物へ含める場合は、この文書だけでなく配布元のモデルカードと`LICENSE`を配布時点で確認してください。

既定構成では、SHA-256を検証した必要ファイルだけを`.local-vision/models/baberu-ocr`へ保存し、`.local-vision/.venv`から使用します。NyamuruのGit履歴や配布物には、Baberu OCRのモデル、推論ファイル、仮想環境を含めません。

## 漫画構造検出（RT-DETR）

- 検出モデル: `rtdetrv4-x-manga109s_v2/model.onnx`
- モデル配布元: <https://huggingface.co/tori29umai/rtdetrv4-x-manga109s_v2>
- セットアップ固定リビジョン: `864c3bfb837a03ecc62557d5152a5ade5566489b`
- SHA-256: `5a5c27646a2ae2e9c85671a1db30504debc9b0b816dc585235435c5e86c2c2b9`
- モデルカード記載ライセンス: Apache License 2.0

Nyamuruはモデルカードに記載されたONNX入出力仕様に従ってローカル推論します。モデル重みや学習データは再配布しません。第三者へモデルをセットで配布する場合は、モデルカードとManga109-sの条件を配布時点で確認してください。

RT-DETRが返す `frame` をコマ候補、`text` を文字・フキダシ相当領域、`face` と `body` を人物領域として扱います。`frame` とほぼ同一の文字・顔・身体領域がある場合はコマ誤検出候補として除外しますが、コマ内に人物や文字が含まれる通常の配置は除外しません。残った `frame` はA〜Zのプリセットへ分類せず、正規化した検出座標を編集可能なコマとして直接Nyamuruへ渡します。人物領域は身体を優先して重複する顔をまとめ、登場人物を決めつけない編集可能な「人物あたり」として所属コマへ配置します。

## 表情補助（WD ViT Tagger v3）

- 配布元: <https://huggingface.co/SmilingWolf/wd-vit-tagger-v3>
- セットアップ固定リビジョン: `7f6b584d0bd3f55c4531f14ba3d4761b2bccdc0f`
- `model.onnx` SHA-256: `35f23693620b668f4d53fd3c62bf65e40af739bc52c7eb0fbc49258b58d065b6`
- `selected_tags.csv` SHA-256: `298633d94d0031d2081c0893f29c82eab7f0df00b08483ba8f29d1e979441217`
- `README.md` SHA-256: `edad0e80dcbebef5ae595387ff33d410c86589ae99e115670f6abea8888bc613`
- ライセンス一次情報: [固定リビジョンのmodel card](https://huggingface.co/SmilingWolf/wd-vit-tagger-v3/blob/7f6b584d0bd3f55c4531f14ba3d4761b2bccdc0f/README.md) metadataの`apache-2.0`

固定リビジョンのtreeには独立した`LICENSE`ファイルがないため、`setup:vision`はライセンスmetadataと学習データ説明を含む`README.md`をSHA-256検証してモデルと同じGit対象外ディレクトリへ保存します。モデルカードにはDanbooru画像を用いた学習条件も記載されています。再配布や商用利用の判断では、固定model cardと利用するデータ・依存ライブラリの条件を確認してください。

NyamuruはWDの全タグを採用せず、exact allowlistに含まれる表情形状・表情候補だけを一人分の切り抜きから抽出し、ローカルQwenへ補助候補として渡します。人物同定、衣装、身体、rating、文字のタグは渡しません。WD単独の弱い信号を観測事実や感情分類へ昇格せず、Qwenが画像から独立に確認した結果とprovenanceを人間が確認します。WDがない、破損している、または推論に失敗した場合は従来のQwen-only経路へ戻ります。

## Gitへの混入防止

Nyamuruの `.gitignore` は一般的なモデル拡張子（`.onnx`、`.safetensors`、`.gguf`、`.pt`、`.pth`、`.ckpt`、`.bin`）と `models/` を除外します。コミット前には次も確認します。

```sh
git ls-files | rg '\.(onnx|safetensors|gguf|pt|pth|ckpt|bin)$'
git status --short --ignored
```

この確認で何も表示されないことだけでは十分ではありません。`git diff --cached --name-only`と配布アーカイブの内容も確認し、原稿画像、OCR出力、スキャナー一時ファイル、絶対パスを含む設定ファイルが入っていないことを確認してください。
