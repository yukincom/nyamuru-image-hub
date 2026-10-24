# Nyamuru Image Hubの名称復元とOSS開発方針

2026-10-17。利用者の指示に基づき、NyamuruとHermes Agentの連携を軸にOSSとして育てる方針へ移行する。

## 今回の変更

- 名称を改名前の「Nyamuru 🐱 Image Hub」へ復元した。画面ヘッダーは「NYAMURU - Image Hub」、タブ名は猫アイコンとの重複を避けて「Nyamuru Image Hub」とする。
- 通常画面、PWA、単一HTML、Pagesローダー、起動メッセージ、利用者向け文書を更新した。
- package名を`nyamuru-image-hub`へ戻し、repository・homepage・issuesの案内を既存の公開フォークへ向けた。npmへの配布を意味する変更ではなく、`private: true`を維持している。
- READMEに開発方針を記載し、本家更新手順の営業結果待ちという条件を取り除いた。
- 既存作品の保存キー、NDM／OMNY仕様、内部識別子、起動フォルダ、著作権表示は維持した。過去の調査記録内の名称は当時の記録として残した。

変更前の復旧点は`a548e7d`。開始時から存在するQwen生成処理の変更、Hermes漫画生成の未追跡ファイル、`.gitignore`とリファクタリング文書は今回の変更に含めていない。

## 既存のHermes連携

単発画像生成は`scripts/hermes_qwen.mjs` → `scripts/hermes_qwen.py` → `QwenGenerationService`につながっている。画像生成前のローカルLLM一時停止と、処理終了後の同一起動設定での復帰も既存処理を使う。この目的で新しいbridgeや別の生成経路を作る必要はない。

[2026-10-14の検証記録](./2026_10_14_hermes_qwen.md)には、直接CLIからの実生成とLLM復帰の確認がある。Hermesへの自然文依頼からの自律的なツール選択は同記録で未検証とされており、今回もモデル問い合わせや実生成は行っていない。

## 公開へ向けて残る作業

1. **導入先を設定できるようにする。** Node入口のPythonは兄弟の`qwen-image-2.1-lab/.venv/bin/python`固定だが、Python側は`NYAMURU_QWEN_LAB_ROOT`に対応する。既存入口の設定をそろえ、MPSが必要な画像生成処理の対応環境を明記する。
2. **Hermesへの導入手順をまとめる。** trackedの連携資料は個人環境向けの参照文書のみで、既存ComfyUIスキルへの変更手順と、参照している`household-studio.md`は公開用の構成にまとまっていない。個人パスや非公開ファイルを前提としない手順へ整える。
3. **公開する素材と依存関係を確認する。** Qwen Turbo・encoder・VAEの取得元、版、利用条件、非同梱範囲を現物と照合して記載する。trackedのモデル重み拡張子は今回の確認で0件。サンプル原稿・動画は追跡されており、`sample/README.md`の個別条件を維持する。これは全履歴の秘密情報・権利監査の完了を意味しない。
4. **公開用の変更範囲を確定する。** 作業途中の漫画生成連携を別途レビュー・検証し、個人パスと非公開資料へのリンクを整理して、公開対象SHAを確定する。
5. **Pagesを配布する場合の設定を整える。** 現在のPages workflowは本家repository名でのみ実行する。フォークでの配信には対象名の調整と、Fork CIにあるQA依存導入・必須設定の反映が必要。Hermes・ローカル解析の利用には別途ローカル実行環境が必要である。

2026-10-17にGitHub APIで、[公開フォーク](https://github.com/yukincom/nyamuru-image-hub)と[本家](https://github.com/sa-san10/nyamuru-manga-name-studio)の存在・公開状態を確認した。公開フォークの`pushed_at`は2026-08-20で、今回のローカル変更は未反映。公開用remoteの設定、push、tag、Release、Pages公開は変更していない。公開時は[公開チェックリスト](../OSS-PUBLISHING-CHECKLIST.md)に沿って対象を確認する。

## 検証

- 既存の表示名テスト2件が成功。PWAの通常版・Pages版、猫アイコン、本家クレジットを確認した。
- `npm run verify`成功。Astroは0 errors／0 warnings／既存の1 hint。Nodeは924件中921成功・3スキップ、Python bridgeは367件中57スキップ、doctorは18件中1スキップ、human-poseは45件中21スキップ。通常版と単一HTML版のbuildも成功した。
- 最初のsandbox内検証はテスト用loopback待受の`EPERM`で3件失敗したため、許可を得た制限外で全検証を再実行した。
- ビルド済み通常版・単一HTML版を一時的なローカル配信でブラウザ表示し、タブ名・ヘッダー・起動メニューを確認した。作品の新規作成・保存・モデル処理の再検証は行っていない。
- 起動済みの開発サーバーはHTTP 500を返し、本文は`Error`とVite clientの読み込みのみだった。今回の表示名変更との因果は未確定。既存プロセスは停止・再起動していない。
