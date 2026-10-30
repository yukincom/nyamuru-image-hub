# Qwen Image 2.1 Turboの登録例

`qwen-turbo-{0,1,3,10}-refs.api.json` はComfyUIのAPIグラフ、同名の `.binding.json` はニャムルへの入出力対応です。必要な参照枚数と同じ例を選び、登録時に `{name, graph, binding}` として渡します。参照枚数を自動変更するグラフではありません。

指示文はノード6、シードは10、幅・高さは7に渡します。参照画像は配列順でLoadImageの21番以降へ渡り、`images.image_1` 以降に接続されます。完成画像はSaveImageの12番が返す画像配列の0番です。`prompt_mode` は既存のQwen指示文処理を使う `qwen` です。

標準ノードでTurboの8区間固定sigmas、CFG 1、Euler、CPU参照キャッシュ、PyTorch attentionを指定しています。3つのモデル名は既存の `scripts/qwen_generation.py` と一致します。追加モデルやカスタムノードは要求しません。CLIPはCPU指定です。VAEのCPU実行はComfyUI側の正式な `--cpu-vae` 起動設定で行い、APIグラフだけで保証しません。

出力寸法はEmptyLatentImageから指定し、参照画像は1024相当の画素数へリサイズされます。参照画像と出力の寸法・縦横比が大きく異なると編集位置がずれる可能性があります。実際の制作画像で確認してください。LoadImageの仮ファイル名は、ニャムルからアップロードした画像名で置き換えます。ComfyUIで直接使うときは各LoadImageへ実画像を指定します。

確認元は2026-10-30のDesktop coreにある `nodes.py`、`comfy_extras/nodes_qwen.py`、`nodes_custom_sampler.py`、`nodes_model_advanced.py` です。API形式・対応付けの局所テストに加え、稼働中のComfyUI 0.43.2から取得した `/object_info` で0・1・3・10枚の4例を照合し、必要ノード・モデルの選択肢・入力型の不一致がないことを確認しました。推論は実行していないため、実生成・画質・メモリ使用量は未検証です。生成時には別途 [モデル解放確認拡張](../../comfyui_extensions/nyamuru_memory_release/README.md) が必要です。
