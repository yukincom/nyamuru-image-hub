# Nyamuru memory release observer

ComfyUIのworkerが画像モデルを解放し、実行キャッシュを初期化した後に、モデルの解放を確認する小さな拡張です。生成ノードは追加しません。

## 配置

1. ComfyUIを終了します。
2. この `nyamuru_memory_release` フォルダーを、使用するComfyUIの `custom_nodes/` 直下へコピーします。ComfyUIの本体ファイルやPython環境を変更する必要はありません。
3. ComfyUIを通常の方法で起動します。
4. ニャムル側の接続確認で `GET /nyamuru/memory/capabilities` が `{"protocol":1}` を返すことを確認します。

この成果物は配置用フォルダーです。作成・テスト時に実際のComfyUIへのインストール、再起動、モデル実行は行っていません。削除する場合はComfyUIを終了し、コピーしたフォルダーだけを取り除いてから起動してください。

## API

- `GET /nyamuru/memory/capabilities`: 対応protocolを返します。モデルには触れません。
- `POST /nyamuru/memory/release`: `{"token":"小文字・ハイフン付きUUID"}` を渡します。応答は `protocol`、`token`、`state`、`queue_idle`、`loaded_model_count` を含みます。
- `state` は `pending`、`busy`、`released`、`failed`。`released` はキューが空で、workerのreset完了後にGCとデバイスキャッシュ解放が終わり、`current_loaded_models` が空であることを確認した結果です。
- `pending` 中の同じtokenは要求を追加しません。待機workerへの通知だけを繰り返し、初回通知の取り逃しを防ぎます。異なるtokenは `busy` を返します。他ジョブとの重なりで確認できなかった場合や、確認後に新たな実行があった場合は、次のidle時に同じtokenで解放を再要求します。
- `failed` の同じtokenは失敗状態を保持します。原因を確認した後、新しいtokenで再要求してください。
- 接続はloopbackに限定します。LAN側ブラウザーはローカルbridgeを通します。

## フックと確認範囲

`execution.PromptExecutor.reset` を一度だけラップします。元のresetを先に呼び、既存キャッシュのあるexecutorで解放要求が保留中の場合だけ、ComfyUIのキューmutex内で確認します。constructorからのresetは完了根拠にしません。HTTPハンドラーは標準の `unload_models` / `free_memory` フラグを立てるだけで、HTTPスレッドからモデルを解放しません。キューの削除、実行の中断、プロセスの終了は行いません。

調査したComfyUIではworkerの処理順が `unload_all_models()` → `e.reset()` です。この順序、`PromptExecutor.reset`、`prompt_queue` のmutex・flags・task_counter、`current_loaded_models` に依存します。ComfyUI更新後はこの互換性を再確認してください。キュー件数や通常の `/free` のHTTP 200、WebSocketの実行完了通知だけを解放完了として扱いません。

自動試験は偽のキュー・executor・モデル管理・HTTP応答による契約の確認です。実ComfyUIの起動・GPU/MPSメモリ回収・他のカスタムノードとの併用は別途実機確認が必要です。また `released` は観測時点の確認であり、その後の別クライアントの送信を禁止するleaseではありません。LLMを復帰する側は、自分が休止したLLMだけを対象にしてください。
