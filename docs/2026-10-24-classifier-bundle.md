# 操作分類モデルの同梱（2026-10-24）

採用済みのv0.4 seed43は、すでに本体の `models/nyamuru-voice-v04-seed43/` に通常ファイルとして保存されていた。一方で `models/` がGit対象外で、分類用Pythonも兄弟のComfyUIに依存していたため、リポジトリをcloneするだけでは分類器を再現できなかった。

## 配置と導入

- 採用モデルの4ファイルと `provenance.json` は内容を変更せず保持する。重みは147,111,548 bytes、SHA-256は `1cb98d06dffde79f234a29b1c78e679634aae6e1357272c85948da6d57c3c3e1`。4ファイルと出典の合計は153,834,150 bytes。
- 設定・tokenizer・出典をGitへ、重み1ファイルを同じリポジトリのReleaseへ保存する。Gitの履歴には重みを含めない。CIはReleaseから採用重みを取得し、SHA-256と19ラベルの順序を検証する。
- [モデルの説明](../models/nyamuru-voice-v04-seed43/README.md)と、[基礎モデルのMITライセンス](../models/nyamuru-voice-v04-seed43/LICENSE)を同梱する。ライセンスはSB Intuitionsのrevision `8cb03f54cb9e30e72459e5f1cedc6d89c7d8dcb5` から変更せず取得した。
- 分類器はbridge自身のPythonを既定に使う。通常起動では本体内の `.local-vision/.venv` になり、ComfyUIのPythonや研究フォルダを必要としない。明示的な `NYAMURU_VOICE_INTENT_PYTHON` / `NYAMURU_VOICE_INTENT_MODEL` は維持する。
- 既存の `npm run setup:vision` に分類依存と、採用重みが不足している場合だけの取得を含める。通常起動時にモデルは取得しない。

clone後は、リポジトリのルートで実行する。

```sh
npm run setup:vision
python3 scripts/install_voice_intent.py --check
```

`--check` はコピー・ダウンロードを行わず、ファイル不足、LFSポインターのままの重み、異なるhash、19ラベルの不一致、出典の不一致、symlinkを拒否する。通常setupは不足する重みをReleaseから取得して検証し、失敗すると依存・画像モデルの取得へ進まない。既存の異なる重みは上書きしない。取得中の中断・サイズ不一致・SHA-256不一致では一時ファイルを削除する。

Git LFSによる配布は、公開forkに新しいLFS objectを追加できないため未公開の候補段階で中止した。本家のLFS枠を使わず、fork関係を維持するためReleaseを使う。

## このMacの実行環境

既存の `.local-vision/.venv` へ `torch==2.11.0`、`transformers==5.14.1`、`tokenizers==0.22.2`、`safetensors==0.8.0` と必要な依存を導入した。既存35パッケージのversionをconstraintで固定し、19パッケージを追加した。既存versionの変更はなく、`pip check` も成功した。

取得したwheelは合計約103MB。仮想環境の使用量は410,488KiBから991,840KiBへ増え、差分は581,352KiB（約595MB）。pipのダウンロードキャッシュはこの差分に含まない。ComfyUIの環境や画像モデルは変更していない。

## 検証

- Pythonの分類器・音声bridgeテスト39件、既存setupのテスト13件が成功。LFSポインター、欠損ファイル、誤った出典、外部symlink、Gitの対象範囲、モデル検証失敗時のsetup中断を含む。
- 本体内Python・本体内モデルを使う既定経路で実推論を確認。「保存して」は `save`、「次のページ」は `page_navigate`、「ひとつ戻して」は `needs_clarification`。旧ComfyUI環境による同モデルの結果と3件とも全19確率が完全一致した。これは接続と移設前後の一致の確認で、精度の再評価ではない。
- 採用モデル4ファイルと `provenance.json` のSHA-256は作業前と一致。既存の無関係な5変更もbyte一致を確認した。
- `git diff --check` 成功。サーバーは起動・再起動していない。

- 親agentによる `npm run verify` 全体検証成功。型検査、Node 1084成功・3skip、Python431件（50skip）/18件（1skip）/45件（21skip）、通常・standalone buildを確認した。

ブラウザー操作・実マイク、公開先からの新規cloneは上記のローカル検証に含めていない。その後、利用者の指示でアプリ全体の開発・公開先を統一する作業へ移った。[公開統合の記録](2026-10-24-public-repository-consolidation.md)と[精度改善の手順・原記録](ModernBERT/README.md)を参照。

Release方式への変更後、Python分類・音声bridge 42件とsetup 13件が成功。正常取得と再実行、サイズ不足・超過・誤hash、既存重みとsymlinkの保護を確認した。
