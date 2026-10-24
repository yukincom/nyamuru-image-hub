# 公開リポジトリの一本化（2026-10-24）

開発・公開先を [yukincom/nyamuru-image-hub](https://github.com/yukincom/nyamuru-image-hub) へ統一する。公開済みの履歴に、アプリの確定済みソースと分類器の設定・tokenizerを内容のスナップショットとして追加する。フォーク関係は維持し、採用重みは同じリポジトリのReleaseから初回セットアップで取得する。旧開発リポジトリの非公開履歴を公開branchへmergeしない。既存の別作業の未commit変更は保持する。

## 配布内容

- 描画・レイヤー・3D背景・人体ポーズ・人物資料・作品管理・エージェント・画像生成・LAN編集の確定済み実装。
- `models/nyamuru-voice-v04-seed43` の採用モデル。重みは同じリポジトリのReleaseから初回setup時に取得し、実行環境は本体の `.local-vision/.venv`。ComfyUIや学習フォルダへの依存はない。
- [ModernBERTの手順と研究記録](ModernBERT/README.md)。原文・入力・評価・コードをGitへ、全18重みと旧履歴などを [研究Release](https://github.com/yukincom/nyamuru-image-hub/releases/tag/nyamuru-modernbert-research-2026-10-24) へ保存。
- 利用者固有の配置を前提にした案内を相対pathへ直し、未同梱の検証資料は配布対象外と明記。同梱画像・motionの権利表示は [ASSET_PROVENANCE.md](ASSET_PROVENANCE.md) に整理。

研究原本は当時の内容を保つため、過去のpath・状態・指示文も含む。新しい導入では現在のREADMEと分類モデルの導入手順を使う。研究手順は再現する場合だけ必要で、通常起動で研究archiveを読むことはない。

## 公開前の検証

公開用の独立checkoutで `npm run verify` が成功。Node1085成功・3skip、Python bridge434件（50skip）／doctor18件（1skip）／human-pose45件（21skip）、型検査と通常・単一HTML buildを確認。Release取得の成功・再実行、破損・サイズ不一致、既存ファイル保護も含む。日本語の親フォルダで壊れていたbubble catalogテストのURL変換を `fileURLToPath` に修正した。

分類器の移設前後は、本体の既存Python環境で3発話・全19確率が完全一致した。研究保存は全2,371原本ファイル、Git履歴、保存予測の独立再集計、再構成入力ZIPの元hash一致を確認。追加学習や精度改善の新実験はしていない。

実マイク、scanner、外部画像生成モデル、全アプリ操作のE2Eを今回再検証したわけではない。公開後はReleaseからの採用重みの新規取得、実分類、対象commitのCIを確認する。

## 手元の配置

正本checkoutのコードと採用モデルは維持する。利用者の指定に従い、精度改善資料 `docs/ModernBERT` は公開Gitで管理し、このMacの正本checkoutでは展開対象から除外する。元の学習フォルダと公開準備用コピーは、公開内容の照合後に撤去する。新規cloneの利用者には通常どおり研究資料も取得される。
