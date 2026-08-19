# Nyamuru🐱Manga Name Studio

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

> [!IMPORTANT]
> ## このリポジトリはアナログネーム取り込み機能を追加したフォークです
>
> [sa-san10/nyamuru-manga-name-studio](https://github.com/sa-san10/nyamuru-manga-name-studio) を基に、紙のネームをローカル解析して編集可能なOMNYへ取り込む機能と、コマ編集支援を追加しています。NDM・OMNY・OMAY・生成プロンプトなど、Nyamuru本来の仕様と成果は本家プロジェクトに由来します。
>
> - フォークの追加機能と制限: [FORK_FEATURES.md](./docs/FORK_FEATURES.md)
> - ローカル画像解析の起動方法: [LOCAL_VISION_BRIDGE.md](./docs/LOCAL_VISION_BRIDGE.md)
> - 外部コンポーネントとライセンス: [LOCAL_VISION_COMPONENTS.md](./docs/LOCAL_VISION_COMPONENTS.md)
> - 本家更新の取り込み方: [UPSTREAM_SYNC.md](./docs/UPSTREAM_SYNC.md)
>
> 本家の[GitHub Pages版](https://sa-san10.github.io/nyamuru-manga-name-studio/)では、本フォークのアナログ取込・コマ編集支援は利用できません。通常のNyamuruを試す場合の本家デモとして参照してください。

## 🆕 最新アプデ！OMAY v10.5：画風変換がここまで効く

**🎨 コマ割りもセリフもそのまま、世界だけ丸ごと入れ替え！**

左はふつうのカラー漫画。右は「白い水冷PCの中に積み上げたアクリル展示ケース」——実はどちらも**同じネームデータ（OMNY）**から生成した同じ作品です。差し替えたのは画風の指定（`meta.style_notes`）だけ。肉球も鈴も1/12フィギュアの造形に"翻訳"されて、ちゃんと同じキャラのまま。**OMAY v10.5 の得意技です。**

🔍 仕組みの解説は [v10.5：構造化で画風変換が効きやすく](#v105構造化で画風変換が効きやすく) へ ／ 🧪 ネームデータ付きの技術デモは [docs/demos/style-transfer/](./docs/demos/style-transfer/) へ！

| 漫画版 | PC内アクリル展示版 |
|---|---|
| <img src="./docs/demos/style-transfer/images/A_漫画版_パターンN.webp" alt="同一OMNYから生成した漫画版" width="360"> | <img src="./docs/demos/style-transfer/images/E_PC内アクリル展示版_パターンN.webp" alt="同一OMNYから生成したPC内アクリル展示版" width="360"> |

にゃむるたん © sa-san10 / CC BY 4.0


> **v1.3.x からお使いの方へ**：v1.4.0〜v1.6.0 で画像生成指示ファイル（OMAY）の分離と NDM v10.2 への更新が入りました。変更内容と対応作業は **[v1.3.x からの移行ガイド](./docs/migration-from-v1.3.md)** を参照してください。

> **画像生成ワークフローのセットアップ（必須）**：AIエージェントのプロジェクト内へ、ワークフロー本体 [agent-manga-generation-workflow.md](./src/content/agent-manga-generation-workflow.md) と標準OMAY [standard.omay.yaml](./src/content/standard.omay.yaml) の2ファイルを配置してください。OMNYは作画指示を含まない純粋なネームデータのため、OMAYが無いと作画・演出ルールとレイアウト仕様が不足します。

## サンプル漫画

![ネームから生成した完成漫画の例（にゃむるたん © sa-san10 / CC BY 4.0）](./docs/images/sample-generated-manga.webp)

## メイン画面

![メイン画面（ネーム編集）](./docs/images/editor-main-screen.webp)

> **English**: Nyamuru🐱 Manga Name Studio is an open-source PWA for creating and editing manga *names* — the Japanese term for manga storyboards / rough drafts (not "names" as in labels).
>
> - Storyboards are written in **Open Manga Name YAML (OMNY)**, a YAML representation of the **Nyamuru Data Model (NDM)**.
> - Artwork rules for image generation live in a separate **Open Manga Artwork YAML (OMAY)** file, so each work's OMNY stays pure name data.
> - You edit them through a paper-style page preview and structured forms.
> - Try it in your browser on [GitHub Pages](https://sa-san10.github.io/nyamuru-manga-name-studio/), or download the standalone single-HTML build that runs offline from a `file://` URL.
> - This fork adds optional local import of scanned analog storyboards and panel-editing assists. These additions are not included in the upstream GitHub Pages demo; image analysis requires the local bridge and separately installed models.
> - The app UI and documentation are currently Japanese-only.
> - Source code, prompts, docs, samples, and original assets by sa-san10 are released under the [MIT License](./LICENSE). Third-party libraries keep their own licenses. The license does not automatically extend to manuscripts you load or works you create with the app.

> **简体中文**: Nyamuru🐱 Manga Name Studio 是一款开源 PWA，用于创作和编辑漫画分镜草稿（日语称为「ネーム / name」，指分镜稿，而非「名字」）。
>
> - 分镜稿以 **Open Manga Name YAML (OMNY)** 格式编写，它是 **Nyamuru Data Model (NDM)** 的 YAML 表示形式。
> - 图像生成用的绘制规则由独立的 **Open Manga Artwork YAML (OMAY)** 文件管理，因此每部作品的 OMNY 保持为纯粹的分镜数据。
> - 通过纸面风格的页面预览和结构化表单进行编辑。
> - 可在 [GitHub Pages](https://sa-san10.github.io/nyamuru-manga-name-studio/) 上直接在浏览器中试用，也可下载单文件 HTML 独立版，通过 `file://` 离线运行。
> - 此分支增加了可选的纸质分镜本地导入和分格编辑辅助功能；上游GitHub Pages演示不包含这些功能，图像分析需要本地bridge及另外安装的模型。
> - 应用界面和文档目前仅提供日语版。
> - 由 sa-san10 创作的源代码、提示词、文档、示例及原创素材以 [MIT License](./LICENSE) 发布。第三方库遵循各自的许可证。该许可证不会自动适用于您加载的原稿或您使用本应用创作的作品。

**Nyamuru Data Model（NDM）**は、漫画ネームのためのデータモデルです。愛称は **Nyamuru🐱** です。

このPWAでは、NDMをYAMLで表現する **Open Manga Name YAML（OMNY）** 形式の漫画ネームを、紙面プレビューと構造化フォームで閲覧・編集できます。内蔵サンプルを初期データとして読み込み、NDM v10の主要ルールを検査します。NDMの仕様書は [nyamuru-data-model-v10.md](./src/content/nyamuru-data-model-v10.md)（[EN](./src/content/nyamuru-data-model-v10.en.md)）、内蔵サンプルのネームは [sample.omny.yaml](./src/content/sample.omny.yaml) として同梱しています。

本家OSSリポジトリは [sa-san10/nyamuru-manga-name-studio](https://github.com/sa-san10/nyamuru-manga-name-studio) です。本ページを表示しているリポジトリは、そのアナログネーム取り込みフォークです。

## 使い方

LLMと画像生成AIをつないで、テーマから完成漫画まで進む3ステップのワークフローを、アプリ内「使い方」タブで案内しています。同じ内容をハウツーガイド [how-to-guide.md](./src/content/how-to-guide.md) として同梱しているので、アプリを開かずに読むこともできます。

## このフォークで追加した機能

### 紙のネームを編集可能なデータへ変換

- 手元の画像を最大10枚まとめて読み込み、右綴じの見開き順で確認
- 解析前に0°・90°・180°・270°の向きを手動で修正
- RT-DETRでコマ・文字領域・顔・身体を検出し、人物や文字のコマ誤検出を抑制
- NDLOCR-Liteで手書き文字を読み取り、位置に対応する編集可能なフキダシへ変換
- 顔・身体の検出結果を、登場人物を決めつけない編集可能な「人物あたり」へ変換
- 検出したコマを既存テンプレートへ当てはめず、その形を編集開始位置として使用
- 取り込み時に上下・左右のコマ間隔と枠線幅を作品ごとに指定

### コマ編集支援

- **内枠スナップ**: コマをA4原稿の内枠へ吸着
- **コマスナップ**: 辺・頂点を作品設定の上下・左右間隔へ吸着
- **コマシンクロ（実験的）**: 接合している頂点や揃った境界を、局所的に連動
- 辺のドラッグによる平行移動と、多角形コマの頂点編集
- Shift＋ドラッグによる開始位置基準の水平・垂直移動
- Shift＋クリックで複数コマを選び、「コマ合体」でフキダシごと統合

複雑な斜めコマや、片側が長い1辺・反対側が複数の短い辺に分割されている配置では、コマシンクロが意図どおり追従しないことがあります。その場合はコマシンクロをOFFにし、コマスナップとShift移動で調整してください。操作と既知の制限は [FORK_FEATURES.md](./docs/FORK_FEATURES.md) にまとめています。

## アナログネーム取り込み（任意）

新規作成画面で紙のネーム画像を読み込み、検出したコマ・人物あたり・フキダシ内の文字を編集可能なページとして取り込めます。この機能は利用者のMac上で動くローカル画像解析連携を必要とします。画像は「解析開始」を押したときだけ `127.0.0.1` のbridgeへ渡され、外部サービスへは送信しません。

macOSでは標準のイメージキャプチャを起動し、連続スキャンした画像を最大10枚まで自動受信できます。ファイル選択による画像読み込みは元ファイルを変更せず、スキャン元の削除は画面上の確定・破棄操作に連動します。強制終了時は再接続できるよう、対象ファイルの情報だけをローカルへ残します。

導入、起動、データの扱いは [LOCAL_VISION_BRIDGE.md](./docs/LOCAL_VISION_BRIDGE.md)、別途導入する解析ソフトウェアとモデルの条件は [LOCAL_VISION_COMPONENTS.md](./docs/LOCAL_VISION_COMPONENTS.md) を参照してください。

## 開発

```bash
npm ci
npm run dev
```

Node.js 22.12.0以上が必要です。通常のネーム編集・OMNY入出力・コマ編集にはPythonや画像解析モデルは不要です。

ローカル画像解析を使う場合は、外部コンポーネントを別々の環境へ導入してから、別ターミナルでbridgeを起動します。

```bash
npm run bridge:check
npm run bridge
```

`bridge:check`でRT-DETR・NDLOCR-Lite・macOSスキャナー連携の検出状態を確認できます。モデルや仮想環境はこのリポジトリへコピーしません。

## 検証・ビルド

```bash
npm run check
npm run build
```

編集内容はブラウザのローカルストレージへ自動保存されます。OMNY形式（`.yaml`）の読み込み・ダウンロード、オフライン起動にも対応しています。

## スタンドアロン版（単一HTML）

スタンドアロン版は、通常のサイトビルド（`npm run build`）でも `dist/standalone/nyamuru-manga-name-studio.html` として同梱され、公開サイトではこのパスで配信されます（アプリ内「使い方」タブのワンポイントアドバイスにダウンロードリンクがあります）。

GitHub Pages（[sa-san10.github.io/nyamuru-manga-name-studio](https://sa-san10.github.io/nyamuru-manga-name-studio/)）でも、スタンドアロン版をそのままブラウザで試せます（`.github/workflows/deploy-pages.yml` が main への push ごとに自動デプロイ。リポジトリの Settings → Pages で Source を「GitHub Actions」にすると有効化されます）。

単体でビルドする場合は次のコマンドを使います。

```bash
npm run build:standalone
```

`dist-standalone/index.html` に、CSS・JS・アイコンをすべて埋め込んだ**単一HTMLファイル**を出力します。サーバーを立てずに、ファイルのダブルクリック（`file://`）だけで起動できます。USBメモリ等で持ち運ぶ場合はこのファイル1つで動作します。

再配布するときは、同じフォルダに出力される `THIRD_PARTY_NOTICES.txt`（埋め込まれた依存ライブラリの第三者ライセンス表記）を必ず一緒に添付してください。スタンドアロン版のフッターのライセンスリンクはGitHubリポジトリの `LICENSE` を指します。

「作品情報」タブで作者名（`meta.author`）を設定すると、各ページ下端中央のフッターに作者名が表示されます（空欄なら非表示）。

## 漫画ネーム生成プロンプト

「生成プロンプト」タブでは、ストーリー原稿をNDM v10へ構造化してOMNY形式で出力する完全版プロンプトを確認できます。プロンプトが出力するのは純粋なネームデータ（OMNY）のみで、画像生成向けの作画ルールは含まれません。Markdown全文のコピーと、`.md`ファイルのダウンロードに対応しています。プロンプト本体は [nyamuru-manga-generation-prompt-v10.md](./src/content/nyamuru-manga-generation-prompt-v10.md)、その解説は [nyamuru-manga-generation-prompt-readme.md](./src/content/nyamuru-manga-generation-prompt-readme.md)（[EN](./src/content/nyamuru-manga-generation-prompt-readme.en.md)）にあります。

## 画像生成指示（OMAY）

**Open Manga Artwork YAML（OMAY）** は、OMNYを漫画として描くための作画・演出ルール（`style_notes`）とレイアウト仕様（`layout_spec`）をまとめた画像生成指示ファイルです。標準テンプレートを [src/content/standard.omay.yaml](./src/content/standard.omay.yaml) として同梱しています。画像生成側のプロジェクト指示にOMAYを一度設定すれば、作品ごとに渡すのはOMNYファイルのみで済み、ルール改訂時はOMAYを貼り替えるだけで全作品に適用されます。

- 「作品情報」タブ：標準テンプレートの読み込み（上書き確認あり）／標準テンプレートの保存／手元のOMAYファイルの読み込み／現在のルールのOMAY書き出し
- 「生成プロンプト」「生成ワークフロー」タブ：解説内の `standard.omay.yaml` リンクから標準テンプレートをダウンロード
- ヘッダーの「OMNY保存」：**画像生成指示分離版**（`.omny.yaml`・ルールを含まない純粋なネームデータ）と**全部入り版**（`.yaml`・ルール込みの一枚もの）の2種類から選択。どちらもネームデータ部分は同一で、全部入り版は分離版＋ルールの合成として生成されます

### v10.5：構造化で画風変換が効きやすく

OMAY v10.5 は全ルールにタグを付け、優先順位のカスケードを明文化しました。ページの構造（`[const]`：読み順・員数・コマ形状・タチキリ・フキダシの種類）と見た目の既定（`[style]` / `[default]`：全体トーン・背景色・フォント・コマ枠線）が分離されているため、作品側はOMNYの `meta.style_notes` に画風を書くだけで見た目を総入れ替えでき、ページ構造は壊れません。識別記号を新しい画風の材料へ翻訳して残す「画風を変えてもキャラを保つ」規定が、キャラの同一性を守ります。

ページ冒頭に並べた2枚（漫画版／PC内アクリル展示版）は、**同一のネームデータ（OMNY）** から `meta.style_notes` だけを差し替えて生成したものです。詳しい解説とネームデータは **[docs/demos/style-transfer/](./docs/demos/style-transfer/)** にあります。技術デモの一覧は [docs/demos/](./docs/demos/) を参照してください。

## 紙面上の要素操作

1. 紙面上のコマをクリックして選択します。
2. 選択したコマ内の人物またはフキダシをクリックすると、赤い選択枠と四隅のハンドルが表示されます。
3. 要素本体のドラッグで移動、四隅のハンドルのドラッグで拡大・縮小できます。

操作結果は `figures[].bbox` または `bubbles[].bbox` のmm座標へ反映され、右側フォームとも同期します。矢印キーで1mm、Shift＋矢印キーで5mmずつ移動することもできます。

## コマ割りテンプレート

ネーム画面上部の「コマ割り」から、NDM v10のパターンA〜Z（N〜Qはタチキリ系、R〜Uは斜め・多角形コマ系、V〜Yは不規則コマ割り系、Zは下段3コマ系）を選択して適用できます。既存のコマ、人物、フキダシは読み順を保ったまま再配置され、各 `bbox` は新しいコマに合わせたA4キャンバス上の絶対mm座標へ更新されます。テンプレートの方が少ない場合も内容は削除せず、近い読み順のコマへ統合します。

## エージェント漫画生成ワークフロー

「生成ワークフロー」タブでは、OMNYとキャラクター素材から漫画を生成・検品するエージェント向け手順を確認できます。Markdown全文のコピーと、`.md`ファイルのダウンロードに対応しています。ワークフロー本体は [agent-manga-generation-workflow.md](./src/content/agent-manga-generation-workflow.md)（[EN](./src/content/agent-manga-generation-workflow.en.md)）、その解説は [agent-manga-generation-workflow-readme.md](./src/content/agent-manga-generation-workflow-readme.md)（[EN](./src/content/agent-manga-generation-workflow-readme.en.md)）にあります。

## 姉妹プロジェクト：rimochan-nyamuru-manga-forge

[**rimochan-nyamuru-manga-forge**](https://github.com/sa-san10/rimochan-nyamuru-manga-forge) は、自然言語で頼むと漫画の原稿が出てくるClaude Code用スキルです。「5ページで、こういう話の漫画を描いて」と頼むだけで、OMNY（ネーム）の設計→作画→回収→検品→納品までを一本のパイプラインで実行します（作画は `codex` CLI へ投げます）。

本アプリと同じOMNY形式・OMAY形式を使っているため、本アプリで作成・調整したネームをそのままforgeへ流して原稿化できますし、forgeが設計したネームを本アプリで開いて手直しすることもできます。OMNY / OMAYの仕様の大本（上流）は本リポジトリです。

## 公式マスコット「にゃむるたん」

<img src="./docs/images/nyamurutan-reference.webp" alt="にゃむるたんの立ち絵（リファレンス）" width="360">

**にゃむるたん（Nyamuru-tan）** は、Nyamuru Data Model（NDM）データモデルの妖精で、本プロジェクトの公式マスコットです。内蔵サンプル漫画『押しかけ妖精にゃむるたん』にも登場します。

キャラクター設定と立ち絵素材はアプリ内「にゃむるたん」タブで閲覧・ダウンロードできます。キャラクター設定書は [nyamurutan-character-setting.md](./src/content/nyamurutan-character-setting.md)（[EN](./src/content/nyamurutan-character-setting.en.md)）にあります。キャラクターデザインは [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja)（にゃむるたん © sa-san10）で提供します。

## 作者・ライセンス

Copyright © 2026 [sa-san10](https://github.com/sa-san10)

本家のsa-san10が制作したアプリのソースコード、NDM・OMNY・OMAY、漫画ネーム生成プロンプト、文書、サンプル、オリジナルの画像・アイコン等は[MIT License](./LICENSE)で提供されています。本フォークはその著作権表示と許諾表示を維持します。

本フォークで追加したbridge、アナログ取込処理、コマ編集支援、テスト、文書も、個別に別の表示があるものを除き同じMIT Licenseで提供します。変更の帰属はGit履歴を参照してください。

依存ライブラリ等の第三者著作物は、それぞれの権利者が定めるライセンスに従います。配布物に含まれる主な第三者ライセンスは[THIRD_PARTY_NOTICES.txt](./public/THIRD_PARTY_NOTICES.txt)を参照してください。利用者が読み込んだ原稿・素材や利用者が生成した成果物へ、本プロジェクトのMIT Licenseが自動的に適用されるものではありません。

OSS公開前に確定・確認する項目は[OSS-PUBLISHING-CHECKLIST.md](./OSS-PUBLISHING-CHECKLIST.md)へまとめています。

本フォークの追加機能の履歴は [FORK_CHANGELOG.md](./docs/FORK_CHANGELOG.md) を参照してください。本家のアプリ版履歴はアプリ内および [src/content/changelog.md](./src/content/changelog.md) にあります。
