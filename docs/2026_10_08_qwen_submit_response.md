# Qwen生成受付の誤判定と出力内容の確認（2026-10-08）

## 受付応答の修正

画像生成の送信が受理されても「ローカル連携の起動管理が古いか別のアプリです」と表示されていた。Python bridgeはJSON応答に自身の`service`を付けるが、supervisorがその応答を展開する順序により、supervisor自身の識別情報が上書きされていた。

`/api/image-generation/submit`は生成結果を展開した後にsupervisorの識別情報を設定する。bridgeの実際の識別情報を含むHTTP fixtureを用意し、画面側の`submitImageGenerationRequest`で受け取る回帰テストを追加した。修正前に同じエラーを再現し、修正後は関連40テストが成功した。

ジョブ`05d94913-bcaa-47d0-8506-38c92445b106`は再送・中断せず、2026-10-08 02:06:22 JSTに処理完了。出力PNGのSHA-256を照合し、画面の状況確認でも「生成完了」と保存リンクを確認した。8080はPID 96243で復帰し、モデル一覧APIも応答した。画像生成・復帰の残存セッションがないことを確認してComic Image Hubを同じ引数・環境・作業場所で再起動し、修正を反映した。再起動後の4321/8786はPID 3889、8080はPID 96243のまま。

「起動が時間内に完了しませんでした」は、誤判定後の終了処理が生成終了を待ち、画面側の150秒制限に達した際の汎用表示だった。今回の修正は、その終了処理へ早期に入ってしまう受付応答の誤判定を解消する。

## 出力内容の確認範囲

処理完了は画の要件適合を意味しない。今回の出力は全身像で、指定したバストアップを満たしていない。参照資料内の横向き全身像に酷似している。

- 保存された英訳には`Camera angle: bust-up`と右向きの横顔・開眼・少し開いた口の指定が存在する。
- 実行経路はComfyUIのHTTPキューやGUIのノードグラフではなく、lab内のComfyUIを読み込むPythonの段階実行。
- `TextEncodeQwenImage21`へ透明キャンバスと人物資料の2枚を渡す。保存済みconditioningには文章条件`[1,557,4096]`と、2枚分の参照latent`[1,64,74,56]`・`[1,64,46,88]`がある。
- `common_ksampler`はそのpositive/negative/latentを読み込み、40ステップを完走した。保存済みsampleは`[1,64,74,56]`。
- VAEで復号した`render.png`と配信する`output.png`は同じSHA-256。後段で人物資料を切り抜く処理はない。

labに保存済みの公式編集workflowでは、CLIP/VAE→TextEncodeQwenImage21→KSampler→VAEDecode→保存がつながっている。現行の段階実行でもこの主要データの受け渡しは存在する。公式workflowのキャッシュ設定ノードは省略しているが、ローカル実装上は既定のauto/defaultキャッシュと同等の設定。これだけから画角不一致の原因を断定できない。

出力用の透明キャンバスを先頭画像にする独自の入力構成、人物資料と画角指示の扱いは、公式workflowをそのまま実行した比較では検証していない。生成内容の問題は未修正。再生成・モデル変更・参照資料の切り抜きは行っていない。

参考: [Qwen公式README](https://github.com/QwenLM/Qwen-Image-2.1)、[ComfyUI公式編集workflow](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_qwen_image_2_1_image_edit.json)。
