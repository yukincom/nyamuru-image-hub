# Qwen Image 2.1 Turboの登録例

## nyamuru_qwen_turbo_3images

`nyamuru_qwen_turbo_3images.json` はDesktop用、`.api.json` と `.binding.json` はニャムル用です。双方ともCFG 2で正・負のプロンプトを使い、同じ参照画像・余白・原寸切り出し・印刷PNG保存ノードを接続します。保存ノードは同梱の `comfyui_extensions/nyamuru_memory_release` に含まれます。

| 順番 | 資料の役割 | 受渡し先 |
|---|---|---|
| 画像1 | 手書きネームの表情・感情のニュアンス | `21.image` → `6.images.image_1` |
| 画像2 | 人物設定画の外見・画風 | `22.image` → `6.images.image_2` |
| 画像3 | 3Dの身体・手足の詳細ポーズ | `23.image` → `6.images.image_3` |

Positive：

```text
Black-and-white manga.
Facial expression and emotional nuance from <image1>.
Character design and drawing style from <image2>.
Detailed body pose, including hand and limb positions, from <image3>.
```

Negative（`6.negative_prompt` の固定値）：

```text
text, speech bubbles, panel borders, background scenery, extra people, collage, multiple views, 3D mannequin, skeleton guides, joint markers, signature, watermark
```

環境設定の初期選択はこの人物用定義です。人物の生成画面では、image1に対象人物のネーム原画、image2にその人物の優先設定画（未指定なら先頭）が自動表示されます。image3の「3D編集」でポーズ・カメラを調整し、確定した撮影画像を確認します。ポジティブ・ネガティブは別々に編集でき、その生成だけに反映されます。

人物のポジティブには作品の画風設定と、画面で選択した背景色の指示が反映されます。image1/2は原寸、image3はコマの幅・高さと原稿のdpiから求めた寸法の不透明なプレビューです。参照のresolutionは0。32の倍数に満たない部分だけ余白を足し、採用前の各候補を含め、余白を除いた原寸・指定dpiで保存します。コマ内はマスクの有無にかかわらずコマ全体が出力先、ページ前景のみマスクの原稿範囲が出力先です。5候補から採用した1枚だけ色抜きし、新規レイヤーとして追加します。

モノクロ／カラー等の選択UI、追加自由記述だけの英訳、86表情IDの自動候補付けは、この例の実装範囲に含みません。人物用negativeは写植・描き文字・ページ生成へ流用しません。

## 参照枚数別の基準例

`qwen-turbo-{0,1,3,10}-refs.api.json` はComfyUIのAPIグラフ、同名の `.binding.json` はニャムルへの入出力対応です。必要な参照枚数と同じ例を選び、登録時に `{name, graph, binding}` として渡します。参照枚数を自動変更するグラフではありません。

指示文はノード6、シードは10、幅・高さは7に渡します。参照画像は配列順でLoadImageの21番以降へ渡り、`images.image_1` 以降に接続されます。完成画像はSaveImageの12番が返す画像配列の0番です。`prompt_mode` は既存のQwen指示文処理を使う `qwen` です。

標準ノードでTurboの8区間固定sigmas、CFG 1、Euler、CPU参照キャッシュ、PyTorch attentionを指定しています。3つのモデル名は既存の `scripts/qwen_generation.py` と一致します。追加モデルやカスタムノードは要求しません。CLIPはCPU指定です。VAEのCPU実行はComfyUI側の正式な `--cpu-vae` 起動設定で行い、APIグラフだけで保証しません。

出力寸法はEmptyLatentImageから指定し、参照画像は1024相当の画素数へリサイズされます。参照画像と出力の寸法・縦横比が大きく異なると編集位置がずれる可能性があります。実際の制作画像で確認してください。LoadImageの仮ファイル名は、ニャムルからアップロードした画像名で置き換えます。ComfyUIで直接使うときは各LoadImageへ実画像を指定します。

確認元は2026-10-30のDesktop coreにある `nodes.py`、`comfy_extras/nodes_qwen.py`、`nodes_custom_sampler.py`、`nodes_model_advanced.py` です。API形式・対応付けの局所テストに加え、稼働中のComfyUI 0.43.2から取得した `/object_info` で0・1・3・10枚の4例を照合し、必要ノード・モデルの選択肢・入力型の不一致がないことを確認しました。推論は実行していないため、実生成・画質・メモリ使用量は未検証です。生成時には別途 [モデル解放確認拡張](../../comfyui_extensions/nyamuru_memory_release/README.md) が必要です。
