# Hermesからの単発Qwen生成

HermesのComfyUIスキルから、ニャムルと共通の`QwenGenerationService`とComfyUI分割実行環境を呼ぶ。入口は`scripts/hermes_qwen.mjs`。単発生成中は現在のローカル会話サーバーを一時停止し、画像処理終了後に同じ起動設定で復帰する。

## 接続

- 実行環境: `../qwen-image-2.1-lab`。Qwen-Image-2.1 Turbo、8ステップ、固定sigmas、CPU VAE、既存メモリ制限をそのまま使用。
- 生成指示と参照画像ラベルはHermesが英語に整える。追加の翻訳LLM呼び出しは行わない。`preview`は最終生成プロンプト・実寸を返す。
- `prepare`で入力とUUIDを保存し、`generate`が`LocalLlmController`・既存の復帰管理プロセスを通して`submit`と状態確認を行う。完了画像のハッシュ検証と会話サーバーの復帰が済むまで前景コマンドは成功を返さない。
- 不明・実行中・失敗済みのジョブを自動再送しない。入力を変えた同一UUIDは拒否する。
- 呼び出し元が終了した場合、復帰管理プロセスが画像処理に継承されたロックの解放を待って会話サーバーを戻す。
- 同時生成は対象外。既存の利用状態確認には競合し得る時間差があるため、複数CLIやUIから生成を同時開始しない。
- この経路に`comfy-cli`、8188の常駐サーバー、8085の家庭用Animagine受付は不要。新サーバー、モデル、仮想環境は追加していない。

Hermes用の参照文書は`integrations/hermes/skills/comfyui/references/nyamuru-qwen.md`。実環境の`~/.hermes/skills/creative/comfyui/references/nyamuru-qwen.md`へコピーし、既存`SKILL.md`のMac向け案内を更新済み。家庭用Animagineを明示された場合の既存経路は参照を残した。

実環境スキルのバックアップと接続確認用入力:
`../doc/hermes-qwen-2026-10-14/`。

## 2026-10-14の検証

- 追加のNodeテスト5件、追加Pythonテスト5件と既存復帰テスト12件が成功。後者は模擬サーバーを用い、呼び出し元終了後の画像ロック待ちと同一起動条件の復帰を確認。
- `npm test`成功。Node 922件中919成功・3スキップ、Python bridge 367件中57スキップ、doctor 18件中1スキップ、human-pose 45件中21スキップ。スキップは任意依存等による。復帰と新CLIの焦点テストは`.local-vision/.venv/bin/python`でも全件成功。
- 実生成ジョブ: `0d967cee-60e1-4ff5-8153-cc2b62bba607`。
- 最終プロンプト: `Create a new drawing with the requested composition. a blue teapot on a wooden table, illustration`
- 10:08:19〜10:09:38 JST、約79秒で1024×1024 PNGを生成。青いティーポットと木のテーブルを目視確認。
- 出力: `.local-generation/qwen/0d967cee-60e1-4ff5-8153-cc2b62bba607/output.png`。
- 画像SHA-256: `92c8e8474cfe6aea662f8f6adef8c6712ba66dd8d2e4a6e58a0c495e5550b303`。
- 実行前の8080プロセスPID 32337から、復帰後のPID 37943へ移行。復帰管理のAPI準備確認後にコマンド終了コード0。残存する復帰用leaseなし。これを特定モデルの生成応答や速度の検証とは扱わない。
- Hermes自身の`skill_view('comfyui')`と参照ファイル読み込みが成功し、`readiness_status: available`、`setup_needed: false`。実行時に配置した参照ファイルとrepository版は同一。

実生成は単発コマンドを直接実行して確認した。Hermesへの自然文依頼からの自律的なツール選択、今回の入口での参照画像編集、複数同時生成は未検証。

## 参考

- [HermesとComfyUIの接続例](https://note.com/catap_art3d/n/nc705d61cd50e): 既存スキルから実行先とワークフローを指定する例。
- [Strata・ComfyUI・HermesのGPU受け渡し](https://zenn.dev/ioridev/articles/gpu-yield-strata-comfyui-hermes): ツール待機中のLLM一時停止と復帰。この変更ではニャムルの既存処理を再利用し、Strataの導入や会話モデル変更は行っていない。
