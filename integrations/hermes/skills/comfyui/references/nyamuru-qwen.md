# ローカルのQwen画像生成

Hermesからの単発画像生成・画像編集は、ニャムルと同じQwen-Image-2.1 Turboを次のコマンドで使う。生成前に現在のローカル会話モデルを一時停止し、生成処理終了後に元の起動設定で復帰する。`comfy-cli`、8188の常駐ComfyUI、8085の家庭用受付はこの経路には不要。

リポジトリのルートを作業ディレクトリにして実行する。

```sh
node scripts/hermes_qwen.mjs catalog
```

以降の `COMMAND` は上記の `node scripts/hermes_qwen.mjs`。リポジトリ外から実行する場合は、利用者の配置先に応じたスクリプトの絶対パスを使う。人間にJSONやコマンドを書かせず、Hermesが依頼に沿って作る。

| 操作 | コマンド末尾 |
|---|---|
| 実行環境・モデルのファイル確認（生成なし） | `catalog` |
| 実際の生成プロンプト・寸法を確認（生成なし） | `preview --request /absolute/path/request.json` |
| 入力を保存（生成なし） | `prepare --request /absolute/path/request.json` |
| 準備・LLM一時停止・生成・LLM復帰まで待つ | `generate --request /absolute/path/request.json` |
| 保存済みジョブの進捗・結果 | `status --job UUID` |

## 入力

新しい依頼ごとにUUIDを一つ作り、依頼JSONに保存する。同じ依頼の確認にはそのUUIDを使い続ける。

```json
{
  "job_id": "ここに生成したUUID",
  "prompt": "a blue teapot on a wooden table, illustration",
  "width": 1024,
  "height": 1024,
  "references": []
}
```

`prompt`と参照画像の`label`はHermesが英語に整える。依頼の画風・人物・構図・除外条件を保持する。特定の漫画形式や絵柄を自動で付け足さない。パラメータはニャムルと共通の8ステップTurbo設定。縦横比に応じて解像度が調整されるので、実寸は`preview`で確認する。

- 通常の参照画像: `references`に`{"image":"/absolute/path/reference.png","label":"English description of its role"}`を追加する。入力はPNG。
- 元画像を編集: `mode: "paint"`と`paint_image: "/absolute/path/source.png"`を指定する。`width`/`height`は元画像と同じ縦横比にする。
- 修正箇所の書き込み・マスク: `correction_image: "/absolute/path/annotations.png"`を追加する。元画像と同じ寸法にする。
- ニャムルの人物ラフ・透過生成を指定する場合は既存の`owner_key`、`character_keys`、`mode: "sketch"`、`sketch_image`、参照ごとの`character_keys`を使う。通常の一枚絵にこの指定を付けない。

## 実行と結果

1. `catalog`、続いて`preview`で実行環境と入力を確認する。`catalog`の成功は実生成の成功を意味しない。
2. `terminal`から`generate`を**前景・timeout=600秒**で一回実行する。会話モデル自身が待ち時間中に降りるため、`background=true`や`&`で即座に返さない。同時に複数の生成コマンドを実行しない。
3. コマンドは生成とLLM復帰を待って終了する。`status: "succeeded"`、`image_path`、`image_sha256`を確認し、その実在する画像を返す。原本はニャムルの`.local-generation/qwen/<UUID>/output.png`に保存される。
4. タイムアウト・切断・不明な結果では新しいUUIDを作って再送せず、同じUUIDの`status`を確認する。前景コマンドが終了しても、復帰管理は残っている画像処理の終了を待って会話モデルを戻す。復帰エラーは成功と扱わない。

このコマンドはモデルの自動取得、別ComfyUIの起動、作品への自動貼り付けを行わない。別の画像生成サービスへの依頼を明示された場合は、その環境に実在する設定と手順を確認する。このリポジトリには別サービスの設定や起動手順を同梱しない。
