# 本家Nyamuruの更新をフォークへ取り込む

本フォークでは、次のリモート名を推奨します。

- `origin`: 自分のフォーク（例: `yukincom/nyamuru-manga-name-studio`）
- `upstream`: 本家（`sa-san10/nyamuru-manga-name-studio`）

## 初回確認

```bash
git remote -v
```

`upstream`が無い場合だけ追加します。

```bash
git remote add upstream https://github.com/sa-san10/nyamuru-manga-name-studio.git
```

## 更新手順

公開済みのフォークでは履歴を書き換えないよう、基本は本家ブランチをmergeします。作業中の変更を混ぜないため、先に `git status --short` が空であることを確認してください。

```bash
git fetch upstream
git switch main
git pull --ff-only origin main
git merge upstream/main
```

競合が出た場合は、ファイルを一括で本家版またはフォーク版へ置き換えず、次の3点を比較します。

1. merge前のフォーク実装
2. 本家の新しい実装
3. 競合箇所で両方が実現しようとしている目的

特に競合しやすい場所は、`src/components/App.tsx`、`src/components/MangaCanvas.tsx`、`src/lib/canvasGeometry.ts`、`src/styles/global.css`、`package.json`、`README.md`です。

競合解消後は、差分全体を確認してから検証します。

```bash
npm ci
npm run check
npm test
npm run build
git diff --check
```

ローカル解析環境がある場合は、次も確認します。

```bash
npm run bridge:check
```

アナログ取込、コマ編集、OMNY保存・再読み込みをブラウザで確認してから、自分のフォークへpushします。

## GitHub Desktopを使う場合

1. Repository settingsで本家URLが`upstream`として登録されていることを確認します。
2. `Fetch origin`で自分のフォークを最新にします。
3. `main`へ切り替えます。
4. `Branch` → `Merge into current branch...`から`upstream/main`を選びます。
5. 競合があれば各ファイルを3者比較し、解消後に上記の検証を実行します。
6. 内容を確認してから`Push origin`します。

GitHubの「Sync fork」は競合がない軽微な更新には使えますが、フォーク独自機能と同じファイルが更新された場合は、ローカルで差分とテストを確認できるmergeを推奨します。
