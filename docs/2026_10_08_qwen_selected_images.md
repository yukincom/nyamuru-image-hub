# Qwenへの画像入力・出力サイズ・描写範囲（2026-10-08）

通常生成が、選択資料の前にサイズ指定用の空RGBA画像を自動追加していた。これは公式で必須の手順ではなく、このアプリの独自実装だった。空画像もTextEncodeQwenImage21の画像条件に入り、利用者が2枚選ぶとモデルには3枚渡っていた。

## 公式資料との照合

- [ComfyUI公式の解像度説明](https://docs.comfy.org/ja/tutorials/image/qwen/qwen-image-2-1): custom_sizeで出力サイズを別指定できる。局所編集では最初の画像と出力サイズが大きく異なると編集がずれる可能性がある。
- [Qwen公式の編集プロンプト仕様](https://github.com/QwenLM/Qwen-Image-2.1/blob/main/prompt_rewrite/prompts/system_prompt_edit.txt): 人物資料を同一性の参照として新しい構図を生成する用途を明記し、その場合は出力の比率を別に選ぶ。キャンバスを持たない複数画像からの生成も記載されている。
- 既存lab内の公式image-editテンプレートでは、custom_size側のEmptyLatentImageをスイッチ経由でKSamplerへ接続している。インストール済みComfyUIのcommon_ksamplerは、空latentをモデルの64チャンネル・16倍圧縮に合わせて変換する。

## 修正

- 通常生成の保存入力に空画像を作成・追加しない。選択した資料のバイト列、順序、対応人物をそのまま保持する。
- 新規構図では、あたり由来の出力寸法をEmptyLatentImageへ渡す。幅・高さの指定をCLIP/VAEへの参照画像へ混ぜない。約1MP・32px単位の既存寸法規則は維持する。
- ペイント参照生成は、利用者が明示的に選んだ描画画像を先頭に置く。これはサイズ指定用の追加画像ではない。
- 単一資料の記述と複数資料のimage番号を実際の入力に合わせる。人物資料の先頭を飛ばさない。
- 空画像を含む準備済みジョブの新規送信は拒否し、新しく準備するよう案内する。過去の入力・英訳・生成履歴は書き換えない。
- phaseスクリプトをimport時に実行しない構造にし、既存ComfyUIノードへ渡る内容をCPUテストで検査可能にした。

## 描写範囲と透過指定

利用者の追加指摘により、描写範囲の指定も照合した。元の生成文は内部値を「画角：bust-up」として挿入し、実際の英訳が「Camera angle: bust-up」になっていた。公式にはbust-upを禁止する規定や専用パラメータはなく、これは指示文の意味の明確さの問題である。

既存FIGURE_SIZE_LABELSを再利用し、「描写範囲は胸から上。頭頂から胸までを画面に収めた構図で描く」と具体化した。顔の向きは動作・表情・視線として別に保持し、描写範囲と動作を長いビジュアル指定より前へ置いた。利用者指定の画風・ビジュアル文は削除・要約しない。

人物等の透過出力には[Qwen公式README](https://github.com/QwenLM/Qwen-Image-2.1#transparent-image-generation-rgba)が推奨するRGBA/alphaの指示を使う。背景生成にはこの透過指定を加えない。モデルへ渡す文章を一続きに整え、数値の画像寸法は出力latent側に保持する。

## 検証

- PythonのQwenジョブテスト13件成功。1枚/2枚/資料なし、ペイント参照、画像バイト列、寸法、準備済み入力の整合性、旧空画像ジョブの送信拒否を確認。
- 既存lab PythonとComfyUIを使うCPUテスト6件成功。CLIPとVAEの重み部分だけを記録用スタブとし、実TextEncodeQwenImage21、EmptyLatentImage、サンプラーの空latent変換を実行。参照1枚/2枚/0枚、ペイント入力、参照画像の寸法とは独立した896x1184の出力指定、RGBA保存を確認。モデルの重みはロードしない。
- NodeのQwenおよび起動管理テスト23件成功。
- Astro check: 304 files、errors/warnings/hintsすべて0。
- 保存済み作品から実際の新しい生成文を構築し、既存default_modelで英訳を実行。「Framing: Draw a composition that includes from the top of the head to the chest. Framing should be from the chest up.」になり、Camera angle: bust-upがなくなることを確認。画像の再生成はしていない。
- 修正後の新しい入力による実モデル生成は未実施。バストアップ指定への追従改善や透明画像が過去の不一致の原因だったかは未確認。

実ComfyUIノードのCPUテスト:

```sh
QWEN_TEST_COMFY_ROOT=../qwen-image-2.1-lab/runtime/ComfyUI \
  ../qwen-image-2.1-lab/.venv/bin/python \
  -m unittest discover -s tests -p 'test_qwen_generation_phase.py' -v
```

## 作業中の保存エラーと復元

利用者が修正前に開始したジョブ`86ef49e0-d8cc-4a8d-b6be-bf27bea4a204`は、空画像＋選択資料2枚の入力で40ステップを完了した。実行中にphaseスクリプトを変更したため、decodeの画像保存で移動後のnumpy名を参照するNameErrorを発生させた。これは今回の保守作業が起こしたエラーである。

保存関数を修正してRGBA回帰テストを追加し、残っていたlatent.ptからdecodeだけを再実行した。request.json、generation-prompt.json、conditioning.pt、latent.ptのSHA-256不変を確認。再サンプリングせず928x1152のPNGを保存し、ジョブをsucceededへ復元した。元の失敗ログを残し、recovery-decode.json/log/resourcesに復元の記録を保存した。既存の起動管理で文章LLMを一時停止・復帰し、argv・環境・cwdの完全一致を確認した。

今後、稼働中ジョブが後続phaseで読み直す実行ファイルは、全phase終了まで編集しない。
