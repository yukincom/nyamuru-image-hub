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

## Qwen3-VL

Qwen3-VLは必須OCRではなく、向き判定、不確実なレイアウトの比較、低品質OCRの確認候補に限って任意使用します。モデルとComfyUIカスタムノードは既存のComfyUI環境に置き、Nyamuru側へコピーしません。利用・配布条件は実際に選択したモデルとノードの配布元を確認してください。

## Gitへの混入防止

Nyamuruの `.gitignore` は一般的なモデル拡張子（`.onnx`、`.safetensors`、`.gguf`、`.pt`、`.pth`、`.ckpt`、`.bin`）と `models/` を除外します。コミット前には次も確認します。

```sh
git ls-files | rg '\.(onnx|safetensors|gguf|pt|pth|ckpt|bin)$'
git status --short --ignored
```
