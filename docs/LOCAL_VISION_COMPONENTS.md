# ローカル画像解析コンポーネントとライセンス

Nyamuru本体はMITライセンスですが、任意で接続するローカル画像解析ソフトウェアとモデルには別のライセンスが適用されます。この文書はREADMEとは別に、その境界と配置方針を記録するものです。

## 同梱状況

| コンポーネント | Nyamuruへ同梱 | この環境での利用形態 | 確認事項 |
|---|---|---|---|
| NDLOCR-Lite | しない | `setup:vision`が公式リポジトリをGit対象外領域へ取得 | CC BY 4.0の表示と変更表示 |
| RT-DETR Manga109-s v2モデル | しない | `setup:vision`が公式ONNXをGit対象外領域へ取得 | Apache-2.0、モデルカード、学習データ条件 |

このリポジトリに含まれるのは、RT-DETRのONNX推論コード、各コンポーネントをローカルで呼び出すbridge、変換処理、明示実行のセットアップスクリプトです。外部リポジトリ、モデル重み、仮想環境はGitや配布物へ同梱しません。

`npm run setup:vision`は利用者の確認後に各公式配布元から直接取得します。アプリの起動や画像の読み込みだけではダウンロードしません。

## NDLOCR-Lite

- 配布元: <https://github.com/ndl-lab/ndlocr-lite>
- セットアップ固定版: `1.2.3`
- 提供者: 国立国会図書館
- ライセンス: Creative Commons Attribution 4.0 International（CC BY 4.0）
- ライセンス本文: NDLOCR-Liteリポジトリの `LICENCE`

NDLOCR-LiteはMITライセンスではありません。共有・再配布する場合は、配布元・提供者・CC BY 4.0であることを表示し、変更した場合はその旨を示してください。依存ライブラリにはそれぞれ別のライセンスがあります。

NyamuruのbridgeはNDLOCR-Liteを変更せず、ローカルの別プロセスとして起動します。NDLOCR-Lite自体をフォークまたは同梱する場合は、この文書だけでなく同リポジトリの`LICENCE`と`LICENCE_DEPENDENCEIES`を配布時点で確認してください。

既定構成では`.local-vision/ndlocr-lite`へ公式タグを取得し、`.local-vision/.venv`から公式ONNXモデルを使用します。NyamuruのGit履歴や配布物には、NDLOCR-Lite本体、仮想環境、モデル重みを含めません。

## 漫画構造検出（RT-DETR）

- 検出モデル: `rtdetrv4-x-manga109s_v2/model.onnx`
- モデル配布元: <https://huggingface.co/tori29umai/rtdetrv4-x-manga109s_v2>
- セットアップ固定リビジョン: `864c3bfb837a03ecc62557d5152a5ade5566489b`
- SHA-256: `5a5c27646a2ae2e9c85671a1db30504debc9b0b816dc585235435c5e86c2c2b9`
- モデルカード記載ライセンス: Apache License 2.0

Nyamuruはモデルカードに記載されたONNX入出力仕様に従ってローカル推論します。モデル重みや学習データは再配布しません。第三者へモデルをセットで配布する場合は、モデルカードとManga109-sの条件を配布時点で確認してください。

RT-DETRが返す `frame` をコマ候補、`text` を文字・フキダシ相当領域、`face` と `body` を人物領域として扱います。`frame` とほぼ同一の文字・顔・身体領域がある場合はコマ誤検出候補として除外しますが、コマ内に人物や文字が含まれる通常の配置は除外しません。残った `frame` はA〜Zのプリセットへ分類せず、正規化した検出座標を編集可能なコマとして直接Nyamuruへ渡します。人物領域は身体を優先して重複する顔をまとめ、登場人物を決めつけない編集可能な「人物あたり」として所属コマへ配置します。

## Gitへの混入防止

Nyamuruの `.gitignore` は一般的なモデル拡張子（`.onnx`、`.safetensors`、`.gguf`、`.pt`、`.pth`、`.ckpt`、`.bin`）と `models/` を除外します。コミット前には次も確認します。

```sh
git ls-files | rg '\.(onnx|safetensors|gguf|pt|pth|ckpt|bin)$'
git status --short --ignored
```

この確認で何も表示されないことだけでは十分ではありません。`git diff --cached --name-only`と配布アーカイブの内容も確認し、原稿画像、OCR出力、スキャナー一時ファイル、絶対パスを含む設定ファイルが入っていないことを確認してください。
