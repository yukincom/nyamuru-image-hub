# 公開リポジトリでの開発と本家更新の取り込み

Nyamuru Image Hubの開発・公開先は `yukincom/nyamuru-image-hub` に統一します。検証した変更を公開 `origin` へ反映し、開発用と公開用の現役リポジトリを分けません。

- `origin`: `https://github.com/yukincom/nyamuru-image-hub.git`（fetch + push）
- `upstream`: `https://github.com/sa-san10/nyamuru-manga-name-studio.git`（本家更新の参照用、fetch only）

旧開発リポジトリの履歴・復旧refは必要な範囲で保存します。未統合の変更を捨てたり、非公開だった開発履歴を公開branchへ一括mergeしたりしません。

## cloneとremoteの確認

```bash
git clone https://github.com/yukincom/nyamuru-image-hub.git
cd nyamuru-image-hub
python3 scripts/install_voice_intent.py --download
git remote -v
```

操作分類器の重みは同じリポジトリのReleaseから取得します。取得したら `python3 scripts/install_voice_intent.py --check` で実体を確認します。Python依存を導入する場合は、READMEの `setup:vision` 手順を使います。

本家更新を取り込む場合だけ、`upstream` を追加します。すでに同名remoteがある場合は追加せず、URLを確認してください。

```bash
git remote add upstream https://github.com/sa-san10/nyamuru-manga-name-studio.git
git remote set-url --push upstream DISABLED
git config remote.pushDefault origin
```

## 通常の開発・公開

変更範囲を確認し、関連する検証と公開前の `npm run verify` を実行します。既存の未commit変更や別作業のファイルを混ぜず、検証した変更だけをcommitします。公開前には [OSS公開チェックリスト](../OSS-PUBLISHING-CHECKLIST.md) でモデル、権利表示、秘密情報、生成物の範囲を確認します。

```bash
git status --short
npm ci
npm run verify
git diff --check
```

公開 `main` へのpushでGitHub Actionsの `Fork CI` / `verify` が動きます。CIはpushを起点とする運用で、pull requestを必須にしません。モデル推論、scanner、ComfyUI、実ブラウザーの操作確認はCIの対象外です。対象commitのCI結果を確認し、失敗した場合は修正を反映します。

tag、GitHub Release、Pages配信は通常のsource pushとは別の操作です。既存のPages workflowには本家repository名のguardがあり、このforkへのpushだけでPagesは公開されません。

## 本家更新の取り込み

現在の作業を保存し、作業treeがcleanであることを確認してから進めます。未commitの変更を自動stash・破棄しません。

```bash
git fetch origin
git fetch upstream
git switch main
git pull --ff-only origin main
git merge upstream/main
```

競合が出た場合は、ファイルを一括で本家版またはフォーク版へ置き換えず、merge前の実装、本家の新実装、双方の目的を比較します。特に `App.tsx`、`MangaCanvas.tsx`、canvasの座標処理、styles、package設定、READMEはフォーク固有機能と競合しやすい部分です。

競合を解消したら、差分全体と依存変更を確認し、`npm ci`、`npm run verify`、`git diff --check` を実行します。ローカル解析環境がある場合は `npm run bridge:check` も確認し、変更が触れる主要操作をブラウザーで点検してから公開 `origin` へ反映します。

## GitHub Desktopを使う場合

1. Repository settingsで `origin` が公開 `nyamuru-image-hub`、`upstream` が本家であることを確認します。
2. `Fetch origin` で公開開発リポジトリを更新します。
3. `main` へ切り替え、必要な場合だけ `upstream/main` をmergeします。
4. 競合を解消して差分と検証結果を確認し、`Push origin` で公開先へ反映します。

GitHubの「Sync fork」だけでフォーク固有機能との競合が解消されたと判断せず、ローカルの差分と検証結果を確認してください。
