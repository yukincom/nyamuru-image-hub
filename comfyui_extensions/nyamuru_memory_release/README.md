# Nyamuru memory release observer

ComfyUIのworkerが画像モデルを解放し、実行キャッシュを初期化した後に、モデルの解放を確認する小さな拡張です。原稿dpiを保持するPNG保存ノードと、ジョブに対応する未採用PNGの削除も提供します。

## 配置

1. ComfyUIを終了します。
2. この `nyamuru_memory_release` フォルダーを、使用するComfyUIの `custom_nodes/` 直下へコピーします。ComfyUIの本体ファイルやPython環境を変更する必要はありません。
3. ComfyUIを通常の方法で起動します。
4. ニャムル側の接続確認で `GET /nyamuru/memory/capabilities` が `{"protocol":1}` を返すことを確認します。

拡張を更新した場合は、ComfyUIを再起動して新しい操作を読み込みます。削除する場合はComfyUIを終了し、コピーしたフォルダーだけを取り除いてから起動してください。

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

## 未採用画像の削除

`POST /nyamuru/outputs/delete` は `outputs` 配列を受け取ります。各要素は `prompt_id`、出力`node`、画像`index`、`image`（`filename`・`subfolder`・`type`）、取得時のPNGの`sha256`です。完了したComfyUI履歴の該当出力と一致する1〜5件を扱い、保存された画像指紋がある場合は実ファイルも照合します。入力資料や別の出力は対象外です。

削除済みファイルへの再要求は成功として返します。履歴や画像指紋の不一致、親ディレクトリーの参照、外部接続は拒否します。生成画面を閉じてComfyUIが終了した後は、ジョブ保存に残した画像指紋と同一のPNGだけを削除できます。履歴も画像指紋も無い場合は保存パスから推測しません。採用画像の原稿への追加後に、ニャムルが未採用分だけを指定して呼び出します。
