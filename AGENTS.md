# Repository instructions

- NDM仕様書・生成プロンプト（`src/content/*.md`）では、過去バージョンへの言及・更新履歴的な記述（「旧版」「従来」「廃止済み」「〜に変更」等）を完全禁止とする。各文書は現行バージョン単体で成り立つ記述のみで書くこと。

## コード・実行環境の配置

- コードと通常起動の正本は、このリポジトリをcloneしたディレクトリとする。親ディレクトリに `AGENTS.md` がある場合は、その配置方針にも従う。
- `.codex` 配下にこのプロジェクトのcheckout、worktree、実行環境、モデルを作らず、起動・実行時にも経由しない。必要な分離作業は元のcheckoutと同じ親ディレクトリの専用フォルダーで行い、完了した変更は元の正本へ統合して検証する。

## 複数worktree・agentの調整

- 親ディレクトリの `doc/NYAMURU_AGENT_WORKBOARD.md` を使う共有作業環境では、読み取り専用調査を除き、最初の編集前に掲示板を読み、正確な書き込み対象pathを`Active claims`へ登録すること。独立cloneに掲示板を新設する必要はない。
- 共有掲示板はGit worktree外の正本であり、checkout中のbranchへコピーを作らない。有効なclaimと重なるpathは編集せず、対象分割またはdependency化を行う。
- 対象pathを広げる前、作業を中断するとき、reviewへ渡すとき、完了してclaimを解放するときに掲示板を更新する。
- 24時間以上更新のないclaimも勝手に解放しない。task、worktree、status、diffを読み取り専用で確認し、`STALE-CHECK`としてcoordinatorへ報告する。
- 掲示板へアクセスまたは更新できない場合は重複し得る編集を始めず、読み取り専用に留めて利用者へ報告する。

## ローカルVision Language Model（VLM）の接続・導入

- VLMを使う機能の実装、修復、導入案内では、最初に現在の接続状態を読み取り専用で確認すること。`npm run bridge:check-vlm`、`NYAMURU_VLM_PYTHON`、`NYAMURU_VLM_MODEL`、`NYAMURU_VLM_MODEL_LABEL`と、bridgeが報告する実パス・利用可否を確認し、確認していない環境を「自動検出済み」と扱わない。
- 既定の接続先は、Pythonが兄弟ディレクトリの`ComfyUI/.venv`、モデルがHugging Faceキャッシュ内の`lmstudio-community/Qwen3-VL-8B-Instruct-MLX-4bit`である。これはMac全体を探索する仕組みではない。既定位置に無い既存環境は、実在と互換性を確認したうえで上記の環境変数へ明示する。
- 新しいVLMや実行環境を提案・導入する前に、利用者のPCについて少なくともOSとバージョン、CPUアーキテクチャ、GPUまたはApple Siliconの種類、搭載メモリ／ユニファイドメモリ、利用可能な空き容量、既存Python・MLX・ComfyUI環境を確認すること。確認コマンドは必要な項目だけを取得し、シリアル番号など無関係な端末識別情報を表示しない。
- モデルの量子化方式、ダウンロード容量、推論時のピークメモリ、対応バックエンドを確認し、利用者PCに十分な安全余裕を残して実行できるか判定すること。8B・4bitが重すぎる場合は、より小さい量子化VLMや別バックエンドを提案し、動作確認なしに必要性能を断定しない。Apple Silicon以外へMLX前提の構成を入れない。
- 大容量モデルの取得、既存環境へのパッケージ追加、仮想環境の作り直しは、予想ダウンロード容量・追加ディスク使用量・既存環境への影響を利用者へ示し、明示的な了承を得てから行う。モデルを自動ダウンロードしない。既存のComfyUI環境を壊す可能性がある場合は、専用の分離環境を優先する。
- 接続後は、パスの存在確認だけで完了にしない。`bridge:check-vlm`の成功に加え、利用者が明示的に選んだテスト画像1枚で特徴抽出を実行し、モデル名、成功可否、処理時間、メモリ不足やタイムアウトの有無を確認する。画像の外部送信や自動学習は行わない。

## 開発中の作品データ

- `nyamuruテスト用シリーズフォルダ/no.1.5` など、利用者がテスト用と指定した作品は複製せず、元の作品を直接開いて検証する。やり直すときは変更を保存せずに閉じ、同じ作品を開き直す。検証のたびにバックアップを作ったり、検証中の変更を元の作品に上書きしたりしない。
- 現在は開発中で、保護すべき既存作品データはない。大きな仕様変更時はデータを捨てて新しく取り込む運用とし、既存開発データを守るための互換処理・推測移行を追加しない。[開発データ方針](docs/2026-10-27-development-data-policy.md)を参照。

## 手動ロックとエージェント操作

- ロックは手動編集の誤操作防止に使う。AI・音声・エージェント操作はロック中でも受け付け、ロック状態を保持する。他の操作ツールにも同じ規則を適用する。[ロックとエージェント操作の方針](docs/2026-10-27-edit-lock-policy.md)を参照。

- 生成画像はあたりを差し替えず、同じ対象フォルダーの最上段へ新規レイヤーとして追加する。あたり・既存レイヤー・表示状態・手動ロックを保持する。

## 利用者確認と検証の順序

- 修正と必要最小限の確認を先に行い、利用者のチェックが済んでからビルド・全件テストを実行する。チェック前に全体検証を先回りして回さない。

## 外部エージェント（Codex等）での画像生成・参照データ

- 作品の保存本体は、選択した作品フォルダ配下の `.nyamuru/project.json` と `.nyamuru/assets/` に格納される（「開く」は `.nyamuru/project.json` を参照する）。
- 環境設定で画像生成の実行先が「外部エージェント」の状態で保存するか、生成ダイアログの「生成用JSONを書き出す」を実行すると、作品フォルダ直下へ軽量なクラウド生成用 JSON（`<タイトル>-cloud.json`）が書き出される。
- `<タイトル>-cloud.json` にはベジェ座標等の描画用詳細を除き、コマ割り、自己説明的な背景指定（`background.mode` / `description`）、フキダシ種別（`kind`: `speech` / `thought` / `monologue` / `narration` / `handwritten`）、登場人物の特徴と `reference_images`、および作品別 `artwork_rules` をまとめている。
- 「画像参照を使う」が有効な場合、同じ作品フォルダ直下へ各ページの細い水色カットラインガイド（`01.png`, `02.png`, ...、`pages[].guide_image` と対応）が自動書き出しされる。外部エージェントはこのカットライン画像とキャラクター資料を参照してキャラクター／コマを描画し、生成後にカットライン基準でコマ分割・取り込みを行える。
- 外部エージェントで漫画を生成する際は、[agent-manga-generation-workflow.md](src/content/agent-manga-generation-workflow.md) と標準作画設定（[standard-settings.yaml](src/content/standard-settings.yaml)）、作品フォルダ直下の `<タイトル>-cloud.json`、対応する `01.png` 等のカットラインガイド、およびシリーズ内のキャラクター資料を参照する。生成完了後、フォルダ直下の `<タイトル>-cloud.json` とガイド画像は削除してよい。
- `<タイトル>-cloud.json` の `render_options` で、`include_background`・`include_bubbles`（フキダシ）・`include_handwritten`（描き文字）・`include_screen_text`（写植文字）・`include_panel_borders`（黒枠線＋溝の生成有無）を個別に制御できる。`include_panel_borders: false`（`light-blue-cutlines-no-black-borders`）のときは黒枠線や溝を作らず、`01.png` 等の細い水色ラインに沿って描く（プロンプトでは否定形を避け、水色グリッドに沿う肯定表現を使う）。
- クラウド画像生成はコストとページ内の一貫性のため、**原則として「1ページ一括生成 ＋ 必要時のみ最大1〜2回の編集リテイク」** を基本とし、コマごとのバラバラ生成は行わない（1コマだけ厳密に作り込みたい場合のみ個別生成を使う）。
- 生成画像の取り込みはヘッダーの「画像読込 → コマで分ける」からキャラクター単位・背景単位で行え、水色ライン基準で切り出して拡縮せず原寸配置し、既存のアタリ／ガイドレイヤーは非表示化する。

## 使用モデル一覧

各機能で使用するモデルは以下の通り（モデル重み自体は Git リポジトリに含めず、ローカル環境へ配置する）。

| 用途 | モデル / ファイル名 | 備考・接続先 |
|---|---|---|
| コマ・人物・文字領域検出 | `rtdetrv4-x-manga109s_v2` (`model.onnx`) | `tori29umai/rtdetrv4-x-manga109s_v2`（`npm run setup:vision`） |
| 漫画文字 OCR | `baberu-ocr` | `genshiai-daichi/baberu-ocr`（`npm run setup:vision`） |
| 表情補助タグ抽出 | `wd-vit-tagger-v3` (`model.onnx`) | `SmilingWolf/wd-vit-tagger-v3`（`npm run setup:vision`） |
| キャラ照合・ビジョン（オプション・既定OFF） | ローカル VLM `lmstudio-community/Qwen3-VL-8B-Instruct-MLX-4bit` または クラウド Vision API（Gemini Flash-Lite / Flash 系） | ビジョンON時のみ使用。OFF時は設定画の登録・管理のみで特徴入力はグレーアウト |
| 画像生成（ローカル既定・2画像参照 / P-H3-Image） | `P-H3-Image-AD-Q6_K.gguf` | UNet（`AtomicChat/P-H3-Image-GGUF`、`ComfyUI-GGUF` `UnetLoaderGGUF`） |
| 画像生成（P-H3-Image 付随） | `p-h3-image_text_encoder_bf16.safetensors` / `p-h3-image_prompt_upsampler_bf16.safetensors` / `p-h3-image_vae_bf16.safetensors` | Text Encoder・Prompt Upsampler・VAE（`examples/comfyui/p_h3_image_edit_mac_bf16_v2.api.json`） |
| 画像生成（クラウドAPI・ページ一括／単画像） | Gemini Image 系（既定 `gemini-3.1-flash-image`） | 環境設定のクラウドAPIキーを使用（Vision APIとキー共通） |
| 操作意図分類 | ModernBERT | 同梱 tokenizer ＋ Release 配布重み |

## セットアップ・起動手順（エージェント向け）

`README.md` にはセットアップ手順や技術詳細を載せていない。利用者からセットアップ・起動を依頼された場合、エージェントは以下の手順と上記の「ローカルVision Language Model（VLM）の接続・導入」「使用モデル一覧」に従って環境構築・確認を行うこと。

### 1. 基本セットアップと起動

- 前提: **Node.js 22.12.0 以上**
- 初回のみ、このリポジトリ直下で依存パッケージを導入する:
  ```bash
  npm ci
  ```
- 起動コマンド（画像生成やローカル解析を行う PC で実行する）:
  | 用途 | コマンド | 備考 |
  |---|---|---|
  | 同じ PC で直接編集する | `npm run dev` | 開発サーバーを起動。画像解析等の利用時にローカル連携サービス（bridge）を自動起動する |
  | 別 PC から LAN 経由で編集する | `npm run lan` | 起動時に表示される `https://` URL を編集 PC のブラウザーで開く（OS X El Capitan 等でも動作確認済み）。初回証明書登録は [docs/LAN_EDITING.md](docs/LAN_EDITING.md) を参照 |
  | bridge 単体の動作確認 | `npm run bridge` / `npm run bridge:check` | ローカル bridge 単体の起動・状態確認 |
- 終了時は作品を保存したうえで、起動したターミナルで `Ctrl+C` を押す。

### 2. ローカル画像解析（OCR・コマ／人物検出）のセットアップ

- 前提: **Python 3.10〜3.13** と初回セットアップ時のインターネット接続。
- 初回のみ以下を実行する（取得対象・容量・ライセンス・保存先を表示して同意を求めるため、利用者の了承を得て進めること）:
  ```bash
  npm run setup:vision
  ```
- 同意後、Git 対象外の `.local-vision/` に専用仮想環境および検証済みの RT-DETR・Baberu OCR・WD ViT Tagger v3 モデルが導入される（アプリを起動しただけではダウンロードされない）。
- 導入確認:
  ```bash
  npm run bridge:check
  ```
- 保存先変更・トラブルシュートは [docs/LOCAL_VISION_BRIDGE.md](docs/LOCAL_VISION_BRIDGE.md)、コンポーネント一覧・ライセンスは [docs/LOCAL_VISION_COMPONENTS.md](docs/LOCAL_VISION_COMPONENTS.md) を参照。

### 3. CLIP STUDIO PAINT（`.clip`）書き出しのセットアップ

- 前提: **Rust 1.88 以上** と C コンパイラー。
- 初回のみ、にゃむるを起動する PC で変換器をビルドする:
  ```bash
  npm run setup:clip
  ```
- ビルド済みバイナリは `.local-clip-export/` に配置され、以後は通常版・LAN 版のローカル bridge から自動呼び出しされる。
- 書き出し手順の詳細は [docs/USAGE.md](docs/USAGE.md#ページを画像に書き出す) を参照。

### 4. ローカル AI（VLM・文章 LLM・ComfyUI 画像生成）の構成と接続

| 機能 | 主な構成 |
|---|---|
| コマ・人物・文字領域の解析 | RT-DETR、OpenCV、Baberu OCR |
| キャラ照合・ビジョン（オプション・既定OFF） | ローカル VLM（Qwen3-VL／MLX）またはクラウド Vision API（Gemini Flash-Lite / Flash 系） |
| 会話・編集支援 | ローカル MLX サーバー（port 8080 で起動済みなら `npm run dev` が自動共用）。プロンプト英訳機能は持たない |
| 画像生成 | ローカル ComfyUI（P-H3-Image 2画像編集・既定、[examples/comfyui/README.md](examples/comfyui/README.md) 同梱）、クラウドAPI（Gemini Image・ページ一括／単画像）、または外部エージェント |
| 操作分類 | 同梱の ModernBERT tokenizer と Release 配布の重み |

- **既定の画像生成方針（2画像参照・プロンプト流し込みなし）**: ローカル既定ワークフローは `P-H3-Image_Edit_Mac_bf16_v2`（[examples/comfyui/p_h3_image_edit_mac_bf16_v2.api.json](examples/comfyui/p_h3_image_edit_mac_bf16_v2.api.json) / [binding.json](examples/comfyui/p_h3_image_edit_mac_bf16_v2.binding.json)）。プロンプト入力や英訳なしで 2 枚の画像（`image_1 (edited)`: キャラクター設定画、`image_2 (reference)`: キャラクターあたり／3Dポーズ参照、既定はキャラクターあたり）から人物を生成する。3画像構成は部分修正（元絵＋修正マスク／赤入れ＋設定画）の用途に限定する。
- **クラウドAPI単画像生成**: 送信完了と同時に生成ダイアログを閉じて編集画面へ戻り、完了時にあたりレイヤーの最上段へ自動配置＋あたりレイヤーを自動非表示（レイヤー保持・不可視オン）にし、応答取得後にクラウド接続を閉じる。
- **ComfyUI 接続先**: 既定は `http://127.0.0.1:8188`。変更する場合は loopback（`localhost` / `127.0.0.1` / `::1`）の URL のみを環境変数 `NYAMURU_COMFYUI_URL` または「環境設定 → モデル設定 → ローカル」で指定する。
- **ローカルメモリ共用**: 画像生成時は必要に応じて文章 LLM を一時停止して ComfyUI を使用し、終了後に元から起動していた LLM を同じ設定で復帰する。複数人物の直列生成時は各生成のあいだで ComfyUI の `/nyamuru/memory/release` によりモデルメモリを解放する。
- **モデル・原稿データの扱い**: モデル重み・原稿データ・生成ジョブは Git リポジトリへ含めない。

### 5. 技術的な制限事項

- 手書き OCR は画像品質や字形に左右されるため、原画を見ながらの修正を前提とする。
- 原稿の向きは解析前に人が確認する（自動回転は行わない）。
- スキャナーの直接起動（macOS イメージキャプチャ連携）は macOS 専用。
- 公開 Web サイトからローカル解析 bridge を呼び出す構成はサポートしない（loopback のみ許可）。
- VLM・文章 LLM・ComfyUI の機能には対応するローカル環境とモデルが必要。第三者モデルや一部の 3D 素材はリポジトリに同梱しない。
- 画像生成の品質と処理時間は、選択した ComfyUI ワークフロー・モデル・参照画像・実行環境に依存する。

### 6. 詳細ドキュメント

- [使い方](docs/USAGE.md)
- [別のPCから使う手順（LAN編集）](docs/LAN_EDITING.md)
- [このフォークの機能と既知の制限](docs/FORK_FEATURES.md)
- [ローカル画像解析の詳細](docs/LOCAL_VISION_BRIDGE.md)
- [シリーズ人物資料と照合特徴](docs/SERIES_CHARACTER_CATALOG.md)
- [ComfyUIワークフロー接続仕様](docs/COMFYUI_WORKFLOW_SPEC.md)
- [外部コンポーネントとライセンス](docs/LOCAL_VISION_COMPONENTS.md)
- [本家更新の取り込み方](docs/UPSTREAM_SYNC.md)
- [変更履歴](docs/FORK_CHANGELOG.md)
- [ModernBERT分類器の導入と検証](docs/2026-10-24-classifier-bundle.md)・[研究Release](https://github.com/yukincom/nyamuru-image-hub/releases/tag/nyamuru-modernbert-research-2026-10-24)
