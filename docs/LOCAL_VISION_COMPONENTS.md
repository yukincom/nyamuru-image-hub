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

## RapidOrientation

- 配布元: <https://github.com/RapidAI/RapidOrientation>
- 使用確認版: `rapid-orientation 0.0.11`
- ライセンス: Apache License 2.0
- 実行モデル: パッケージ同梱の `rapid_orientation.onnx`（約6.3MB）

この開発環境では `/Users/yukin_co/Desktop/tools/rapid-orientation/.venv` に独立して導入します。Nyamuruは一回限りのワーカーとして呼び出し、仮想環境とONNXモデルをNyamuruのGit履歴や配布物へ含めません。

公式ラッパーは同じ中央領域を3回処理するため、薄く疎な漫画ネームでは判定が不安定でした。ローカル連携ではページの長辺方向に異なる5領域を取り、縦ページを0°/180°、横ページを90°/270°へ限定して平均します。最初の実スキャン4枚を各4方向へ回した試験では、高確信度12条件は12/12正解、低確信度を含む全16条件は14/16正解でした。その後、別の実スキャンで確信度0.39の誤判定が見つかったため、運用閾値を0.45へ引き上げました。閾値未満では自動回転せず、利用者がプレビューで向きを指定します。

## Qwen3-VL

Qwen3-VLは必須OCRではありません。同じ手書きネームの正立版と上下逆版を比較した実験では、どちらも0°と回答して向き判定を改善しませんでした。そのため通常の`auto`モードではQwenを起動せず、向き・レイアウト・OCRの比較は明示的な`compare`モードに限ります。モデルとComfyUIカスタムノードは既存のComfyUI環境に置き、Nyamuru側へコピーしません。利用・配布条件は実際に選択したモデルとノードの配布元を確認してください。

## Gitへの混入防止

Nyamuruの `.gitignore` は一般的なモデル拡張子（`.onnx`、`.safetensors`、`.gguf`、`.pt`、`.pth`、`.ckpt`、`.bin`）と `models/` を除外します。コミット前には次も確認します。

```sh
git ls-files | rg '\.(onnx|safetensors|gguf|pt|pth|ckpt|bin)$'
git status --short --ignored
```
