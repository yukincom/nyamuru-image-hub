# ローカル画像解析コンポーネントとライセンス

Nyamuru本体はMITライセンスですが、任意で接続するローカル画像解析ソフトウェアとモデルには別のライセンスが適用されます。この文書はREADMEとは別に、その境界と配置方針を記録するものです。

## 同梱状況

| コンポーネント | Nyamuruへ同梱 | この環境での利用形態 | 確認事項 |
|---|---|---|---|
| NDLOCR-Lite | しない | 独立リポジトリの`.venv`と公式モデルを呼び出す | CC BY 4.0の表示と変更表示 |
| manga-babble-maker | しない | 独立リポジトリのPythonモジュールを呼び出す | コードの公開条件を配布元へ確認 |
| RT-DETR Manga109-s v2モデル | しない | 独立リポジトリ内のONNXを参照 | モデルカードと学習データ条件を確認 |

このリポジトリに含まれるのは、各コンポーネントをローカルで呼び出すbridgeと変換処理だけです。外部リポジトリ、モデル重み、仮想環境を取得・再配布しません。

## NDLOCR-Lite

- 配布元: <https://github.com/ndl-lab/ndlocr-lite>
- 使用確認版: commit `d25e0d4`（2026-08-18時点のローカル導入版）
- 提供者: 国立国会図書館
- ライセンス: Creative Commons Attribution 4.0 International（CC BY 4.0）
- ライセンス本文: NDLOCR-Liteリポジトリの `LICENCE`

NDLOCR-LiteはMITライセンスではありません。共有・再配布する場合は、配布元・提供者・CC BY 4.0であることを表示し、変更した場合はその旨を示してください。依存ライブラリにはそれぞれ別のライセンスがあります。

NyamuruのbridgeはNDLOCR-Liteを変更せず、別プロセスとして起動します。NDLOCR-Lite自体をフォークまたは同梱する場合は、この文書だけでなく同リポジトリの`LICENCE`と`LICENCE_DEPENDENCEIES`を配布時点で確認してください。

既定構成では、Nyamuruと同じ親フォルダの `ndlocr-lite` を独立したリポジトリとして配置し、その `.venv` と公式ONNXモデルを同リポジトリ側だけで使用します。NyamuruのGit履歴や配布物には、NDLOCR-Lite本体、仮想環境、モデル重みを含めません。

## 漫画構造検出（manga-babble-maker / RT-DETR）

- 既定の接続元: Nyamuruと同じ親フォルダの `manga-babble-maker`
- 使用確認版: commit `26f43db`
- 検出モデル: `rtdetrv4-x-manga109s_v2/model.onnx`
- モデル配布元: <https://huggingface.co/tori29umai/rtdetrv4-x-manga109s_v2>
- ローカルのモデル案内に記載されたライセンス: Apache License 2.0

確認した`manga-babble-maker`のルートには、コード全体へ適用されるLICENSEファイルがありません。モデルのApache 2.0をmanga-babble-makerのコードへそのまま適用できるとは限りません。また、コード、モデル、学習データの条件は同一ではありません。

そのため本フォークはmanga-babble-makerのコードやモデルを再配布せず、利用者が独立して用意したローカル環境を呼び出すだけにします。第三者へセットで配布する場合は、コード作者、モデルカード、Manga109-sの条件を配布時点で個別に確認してください。

RT-DETRが返す `frame` をコマ候補、`text` を文字・フキダシ相当領域、`face` と `body` を人物領域として扱います。`frame` とほぼ同一の文字・顔・身体領域がある場合はコマ誤検出候補として除外しますが、コマ内に人物や文字が含まれる通常の配置は除外しません。残った `frame` はA〜Zのプリセットへ分類せず、正規化した検出座標を編集可能なコマとして直接Nyamuruへ渡します。人物領域は身体を優先して重複する顔をまとめ、登場人物を決めつけない編集可能な「人物あたり」として所属コマへ配置します。

## Gitへの混入防止

Nyamuruの `.gitignore` は一般的なモデル拡張子（`.onnx`、`.safetensors`、`.gguf`、`.pt`、`.pth`、`.ckpt`、`.bin`）と `models/` を除外します。コミット前には次も確認します。

```sh
git ls-files | rg '\.(onnx|safetensors|gguf|pt|pth|ckpt|bin)$'
git status --short --ignored
```

この確認で何も表示されないことだけでは十分ではありません。`git diff --cached --name-only`と配布アーカイブの内容も確認し、原稿画像、OCR出力、スキャナー一時ファイル、絶対パスを含む設定ファイルが入っていないことを確認してください。
