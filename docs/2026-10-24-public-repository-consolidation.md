# 公開リポジトリの一本化（2026-10-24）

開発・公開先を [yukincom/nyamuru-image-hub](https://github.com/yukincom/nyamuru-image-hub) の `main` へ統一した。公開済みの履歴に、アプリの確定済みソースと分類器の設定・tokenizerを内容のスナップショットとして追加した。フォーク関係を維持し、採用重みは同じリポジトリのReleaseから初回セットアップで取得する。旧開発リポジトリの非公開履歴は公開branchへmergeせず、既存の別作業の未commit変更を保持した。

## 配布内容

- 描画・レイヤー・3D背景・人体ポーズ・人物資料・作品管理・エージェント・画像生成・LAN編集の確定済み実装。
- `models/nyamuru-voice-v04-seed43` の採用モデル。重みは[モデルRelease](https://github.com/yukincom/nyamuru-image-hub/releases/tag/nyamuru-voice-v04-seed43)から初回setup時に取得し、実行環境は本体の `.local-vision/.venv`。分類器にComfyUIや学習フォルダへの依存はない。
- [ModernBERTの手順と研究記録](ModernBERT/README.md)。原文・入力・評価・コードをGitへ、全18重みと旧履歴などを [研究Release](https://github.com/yukincom/nyamuru-image-hub/releases/tag/nyamuru-modernbert-research-2026-10-24) へ保存。
- 利用者固有の配置を前提にした案内を相対pathへ直し、未同梱の検証資料は配布対象外と明記。同梱画像・motionの権利表示は [ASSET_PROVENANCE.md](ASSET_PROVENANCE.md) に整理。

研究原本は当時の内容を保つため、過去のpath・状態・指示文も含む。新しい導入では現在のREADMEと分類モデルの導入手順を使う。研究手順は再現する場合だけ必要で、通常起動で研究archiveを読むことはない。

## 公開と検証

公開統合commitは `bb1ac4bb815f6393c64f4ebf9fe3252b6ffd40cf`、新規環境で判明したCA参照先の修正は `22543b8639b11ae1b358c85cea150e2794044a89`。両commitのCIが成功した（[統合時](https://github.com/yukincom/nyamuru-image-hub/actions/runs/40063212123)、[CA修正後](https://github.com/yukincom/nyamuru-image-hub/actions/runs/40064348191)）。本家とのfork関係を変更せず、Git LFSへの重みuploadは行っていない。

最終コードを正本checkoutで `npm run verify` により検証した。Node1085成功・3skip、Python bridge435件（50skip）／doctor18件（1skip）／human-pose45件（21skip）、型検査404ファイルのerror/warning 0、通常・単一HTML buildを確認。Release取得の成功・再実行、破損・サイズ不一致、既存ファイル保護、証明書検証も含む。日本語の親フォルダで壊れていたbubble catalogテストのURL変換を `fileURLToPath` に修正した。

公開 `22543b8` を独立したフォルダへ新規cloneし、`npm ci` と `npm run setup:vision -- --yes` が成功。Python 3.13の新しい仮想環境で、分類重み147,111,548 bytesをReleaseから自動取得し、SHA-256を検証した。RT-DETR、Baberu OCR、WD Taggerの取得・導入確認、`pip check`、分類モデルの `--check` も成功した。旧環境からの手動モデルコピーはしていない。

新規環境自身のPythonを使った「保存して」「次のページへ」「これを変えて」の3発話は、正本環境と全19確率が完全一致した。これは配布・接続の確認であり、新しい精度評価ではない。

分類器の移設前後は、本体の既存Python環境で3発話・全19確率が完全一致した。研究保存は全2,371原本ファイル、Git履歴、保存予測の独立再集計、再構成入力ZIPの元hash一致を確認。追加学習や精度改善の新実験はしていない。

研究Releaseの21 assets（1,839,808,468 bytes）は全件のGitHub SHA-256・サイズと未認証の公開アクセスを確認した。`docs/ModernBERT` の778ファイルは原文を保ち、新規clone・正本の両方で公開用manifestと全件一致。[AI-Curious-Community](https://github.com/yukincom/AI-Curious-Community) のREADMEからもリンクした（`7bb5211f9dd01ec0f8fcd027ed5f9a3c72b79978`）。

実マイク、scanner、外部画像生成モデル、全アプリ操作のE2Eは今回の検証に含めていない。サーバーの起動・再起動は行っていない。

## 手元の配置

正本checkoutのコードと採用モデルを維持し、`origin` を公開リポジトリへ変更した。旧privateリポジトリはGitHub上でアーカイブし、旧履歴はローカルの回復refにも保存した。旧branchのpush先は無効化したprivate用remoteへ固定し、公開 `main` へ非公開履歴を混ぜない構成にした。

既存の5件の未commit変更を保持した。READMEだけ公開側の修正と既存LAN案内を統合し、ほか4件はbyte一致を確認。別worktreeの15登録（実在10・不在5）、未commit変更、未追跡ファイル、symlinkも変更していない。

利用者の指定に従い、このMacでは `docs/ModernBERT` の778ファイルだけをworktree単位のsparse-checkoutで展開対象から除外した。それ以外の追跡867ファイルと採用モデルは不変。公開GitとローカルのGitオブジェクトには記録を保持し、新規cloneの利用者には通常どおり研究資料も取得される。

元の研究フォルダは、公開保存確認と全2,811ファイル（3,266,731,183 bytes、Git metadata・cacheを含む）の再照合後に削除した。公開準備用payload・export・監査用コピー・新規clone検証環境も撤去した。本体の採用重みは削除後も同じSHA-256で保持されている。
