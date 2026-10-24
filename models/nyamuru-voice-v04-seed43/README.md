# Nyamuru操作分類器 v0.4 seed43

ニャムルで採用した19分類のモデル本体です。`config.json`、`model.safetensors`、`tokenizer.json`、`tokenizer_config.json` を揃えて使用します。分類はオフラインのCPU推論で行い、操作の実行はアプリ側が担当します。

- 基礎モデル: [SB Intuitions ModernBERT-Ja-30M](https://huggingface.co/sbintuitions/modernbert-ja-30m/tree/8cb03f54cb9e30e72459e5f1cedc6d89c7d8dcb5)、revision `8cb03f54cb9e30e72459e5f1cedc6d89c7d8dcb5`。
- 追加学習: Nyamuru v0.4、seed43、trial-4、epoch8、学習率 `5e-5`。v0.5.1 baselineの同seedと同一重み。
- 採用: 2026-10-20のユーザー指定。固定の日常112問で110問、従来73問で60問正解。未見の発話や音声認識込みの精度を保証する結果ではありません。
- ライセンス: [MIT](LICENSE)。基礎モデルの著作権・許諾表示を同梱しています。追加学習用の自作例・公開データの出典は[改善手順と研究記録](../../docs/ModernBERT/README.md)を参照してください。
- 4ファイルのSHA-256と採用情報: [provenance.json](provenance.json)。採用済み重みの内容は変更していません。

重みは[同じリポジトリのRelease](https://github.com/yukincom/nyamuru-image-hub/releases/tag/nyamuru-voice-v04-seed43)で配布します。clone後、リポジトリのルートで次を実行してください。

```sh
npm run setup:vision
python3 scripts/install_voice_intent.py --check
```

セットアップは既存の `.local-vision/.venv` へ分類依存を導入します。分類モデルを研究フォルダからコピーする操作や、ComfyUIのPython環境は不要です。ブラウザー単体のstandalone HTMLには、このローカル分類器は含まれません。

分類器の重みだけを取得する場合は `python3 scripts/install_voice_intent.py --download` を実行します。既存のモデルは再取得・上書きせず検証します。取得サイズとSHA-256が不一致のファイルは採用せず、一時ファイルを削除します。アプリの通常起動や分類時にはダウンロードしません。旧Git LFSポインターが残る場合は、そのポインターを別名へ退避してから取得してください。実体の重みは削除しないでください。
