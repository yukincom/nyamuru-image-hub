# OSS公開・フォーク配布チェックリスト

この文書は、本家Nyamuruの表示を保ったまま、アナログネーム取り込みフォークを公開・更新するときの確認項目をまとめたものです。

## 本家由来で維持する情報

- 正式なプロジェクト名（アプリ名）: `Nyamuru🐱Manga Name Studio`
- ライセンス: MIT License（SPDX識別子: `MIT`）
- 著作権表示: `Copyright (c) 2026 sa-san10`
- 作者名: sa-san10
- GitHubアカウント: [sa-san10](https://github.com/sa-san10)
- ライセンス対象: sa-san10が制作したNyamuru Data Model（NDM）、Open Manga Name YAML（OMNY）形式、アプリのソースコード、漫画ネーム生成プロンプト、文書、サンプル、オリジナルの画像・アイコン等
- 対象外: 依存ライブラリ等の第三者著作物、利用者が読み込んだ原稿・素材、アプリ利用者が生成した成果物

本家リポジトリ: <https://github.com/sa-san10/nyamuru-manga-name-studio>

本家の著作権表示とMIT Licenseは、フォークで改変・再配布する場合も削除しません。

## フォークで確定済み

- 現在のフォークリポジトリURL: `https://github.com/yukincom/nyamuru-manga-name-studio`
- 本家リモート名: `upstream`
- フォーク固有の主機能: アナログネーム取り込み、ローカル画像解析bridge、コマ編集支援
- ローカルbridge: `127.0.0.1:8787`のみ
- 外部コンポーネントとモデル: リポジトリ・配布物へ同梱しない
- フォーク固有履歴: `docs/FORK_CHANGELOG.md`
- 本家更新手順: `docs/UPSTREAM_SYNC.md`

## フォーク公開前に確定・置換する情報

- [ ] 本家と区別できるフォーク版の表示名・短い説明
- [ ] フォーク追加部分の著作権者名と表示方法
- [ ] フォーク版のリリース番号または本家版と区別する接尾辞
- [x] `package.json`の`repository`・`homepage`・`bugs`をフォークへ設定
- [ ] 公開アプリURL（決定後、`package.json`、README、OGP、PWA manifestへ反映）
- [ ] 初回公開年が2026年から変わる場合の著作権年
- [ ] 本家由来の画像、フォント、サンプル素材を元の条件と表示のまま利用していること
- [ ] 第三者由来の素材が加わった場合、その名称・権利者・ライセンス・配布条件を `public/THIRD_PARTY_NOTICES.txt` に追記
- [ ] NDLOCR-Lite、manga-babble-maker、RT-DETRモデル、学習データの最新条件を確認
- [ ] 外部リポジトリ、`.venv`、モデル重み、原稿画像、OCR出力、スキャナー一時ファイルがGit履歴と配布物に無いこと
- [ ] README・SECURITY・LOCAL_VISION_BRIDGEのデータ取扱い説明が実装と一致すること
- [ ] GitHubのAbout欄へ説明、公開URL、`MIT`トピック等を設定
- [ ] GitHub Pagesを使う場合、workflow・base URL・公開先がフォーク用に設定されていること
- [x] 必要に応じてIssue/脆弱性報告先、行動規範、コントリビューション方針を追加（`SECURITY.md`・`CODE_OF_CONDUCT.md`・`.github/ISSUE_TEMPLATE/`・`.github/PULL_REQUEST_TEMPLATE.md`・`CONTRIBUTING.md`）
- [x] 公開用`docs/`と、Git対象外のローカル調査用`doc/`を分離

## コミット・配布前の機械確認

```bash
git status --short
git diff --check
git ls-files | rg '\.(onnx|safetensors|gguf|pt|pth|ckpt|bin)$'
git ls-files | rg '(^|/)(\.venv|node_modules|ocr-output|local-analysis)(/|$)'
npm ci
npm run check
npm test
npm run build
```

モデル検索が0件であることを確認します。`public/THIRD_PARTY_NOTICES.txt`は配布物に意図して含めるライセンス文書なので除外しません。

## リポジトリに残す表示

- ルートの `LICENSE`: MIT全文と著作権表示
- `README.md`: ライセンス、作者、対象範囲、第三者著作物への案内
- `package.json`: `license`、`author`、`repository`、`homepage`、`bugs`
- アプリ画面: フッターの著作権・MIT表示と `/licenses/` のライセンスページ
- `public/THIRD_PARTY_NOTICES.txt`: 配布物に含まれる第三者著作物の表示
- プロンプト等、単独でコピーされやすい主要文書: SPDX識別子、著作権者、ルートライセンスへの案内
- `README.md`: フォークであること、本家リンク、フォーク追加機能と制限
- `docs/FORK_FEATURES.md`: 通常機能とローカル解析機能の境界
- `docs/LOCAL_VISION_COMPONENTS.md`: 同梱しない外部コンポーネントの出典と条件

MITでは、複製物またはソフトウェアの重要な部分へ著作権表示と許諾表示を含める必要があります。フォークしても本家の著作権表示は残します。第三者著作物は本プロジェクトのMITへ変更されず、それぞれのライセンスに従います。
