# ローカル画像解析コンポーネントとライセンス

Nyamuru本体はMITライセンスですが、任意で接続するローカル画像解析ソフトウェアとモデルには別のライセンスが適用されます。この文書はREADMEとは別に、その境界と配置方針を記録するものです。

## NDLOCR-Lite

- 配布元: <https://github.com/ndl-lab/ndlocr-lite>
- 使用確認版: commit `d25e0d4`（2026-08-18時点のローカル導入版）
- 提供者: 国立国会図書館
- ライセンス: Creative Commons Attribution 4.0 International（CC BY 4.0）
- ライセンス本文: NDLOCR-Liteリポジトリの `LICENCE`

NDLOCR-LiteはMITライセンスではありません。共有・再配布する場合は、配布元・提供者・CC BY 4.0であることを表示し、変更した場合はその旨を示してください。依存ライブラリにはそれぞれ別のライセンスがあります。

この開発環境では `/Users/yukin_co/Desktop/tools/ndlocr-lite` を独立したリポジトリとして配置し、その `.venv` と公式ONNXモデルを同リポジトリ側だけで使用します。NyamuruのGit履歴や配布物には、NDLOCR-Lite本体、仮想環境、モデル重みを含めません。

## 漫画構造検出（manga-babble-maker / RT-DETR）

- 接続元: `/Users/yukin_co/Desktop/tools/manga-babble-maker`
- 使用確認版: commit `26f43db`
- 検出モデル: `rtdetrv4-x-manga109s_v2/model.onnx`
- モデル配布元: <https://huggingface.co/tori29umai/rtdetrv4-x-manga109s_v2>

コード、モデル、学習データの条件は同一とは限りません。再配布や公開前には、それぞれの配布元にある最新のライセンス・利用条件を個別に確認してください。この環境では既存の独立リポジトリとモデルを呼び出すだけで、NyamuruのGit履歴や配布物にはモデル重みを含めません。

RT-DETRが返す `frame` をコマ候補、`text` を文字・フキダシ相当領域、`face` と `body` を人物領域として扱います。`frame` とほぼ同一の文字・顔・身体領域がある場合はコマ誤検出候補として除外しますが、コマ内に人物や文字が含まれる通常の配置は除外しません。残った `frame` はA〜Zのプリセットへ分類せず、正規化した検出座標を編集可能なコマとして直接Nyamuruへ渡します。人物領域は身体を優先して重複する顔をまとめ、登場人物を決めつけない編集可能な「人物あたり」として所属コマへ配置します。

## RapidOrientation（解析パイプラインでは不使用）

- 配布元: <https://github.com/RapidAI/RapidOrientation>
- 使用確認版: `rapid-orientation 0.0.11`
- ライセンス: Apache License 2.0
- 実行モデル: パッケージ同梱の `rapid_orientation.onnx`（約6.3MB）

この開発環境では `/Users/yukin_co/Desktop/tools/rapid-orientation/.venv` に独立して導入されていますが、現在のNyamuruはモデルを呼び出しません。漫画ネームでは正立画像を逆さまにする誤判定を防げないため、画像の向きは解析前に利用者がプレビューで確定します。仮想環境とONNXモデルはNyamuruのGit履歴や配布物へ含めません。

## Gitへの混入防止

Nyamuruの `.gitignore` は一般的なモデル拡張子（`.onnx`、`.safetensors`、`.gguf`、`.pt`、`.pth`、`.ckpt`、`.bin`）と `models/` を除外します。コミット前には次も確認します。

```sh
git ls-files | rg '\.(onnx|safetensors|gguf|pt|pth|ckpt|bin)$'
git status --short --ignored
```
