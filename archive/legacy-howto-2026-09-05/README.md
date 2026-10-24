# 旧版：起動時の使い方案内

2026-09-05に現行UIから外した案内の保管場所です。現在のニャムルの操作手順ではありません。
アプリや公開ドキュメントのビルドからは読み込みません。

## 保管内容

- [how-to-guide.md](how-to-guide.md)：旧「使い方」タブの本文。元の内容・著作権表示を変更せず移動。
- [HowToGuide.tsx.txt](HowToGuide.tsx.txt)：そのタブの表示実装。元のソースを変更せず、実行・型検査の対象にならない拡張子で保管。
- [startup-intro.tsx.txt](startup-intro.tsx.txt)：初回起動の案内と漫画ビューアのJSX抜粋。
- [styles.css](styles.css)：案内・ビューア専用CSS。レスポンシブ指定も保管。
- [漫画1ページ目](nyamurutan-manga-p1.webp)、[漫画2ページ目](nyamurutan-manga-p2.webp)：案内に表示していた画像の同一バイトのコピー。

元の配置は `src/content/how-to-guide.md`、`src/components/HowToGuide.tsx`、
`src/components/App.tsx`、`src/styles/global.css`、`src/assets/nyamurutan-manga-p*.webp` です。
移動直前のGitコミットは `0b507858b8845c6f9a98c811f92f0f55cc380117`。
ソース内の相対importや画面リンクは当時の参照であり、このフォルダ単体は実行可能なアプリではありません。
再利用時は現行機能との照合と、参照先・状態管理・CSSの復元が必要です。

画像の共有元と `src/lib/sampleMangaImages.ts` は、マスコット紹介ページでも利用しているため現行側に残しています。
サンプルOMNY、現在の制作データ、NDM仕様書、生成用プロンプトはこの整理の対象ではありません。

## 権利表示

本文・表示コードはリポジトリの [MIT License](../../LICENSE) に従います。元の著作権表示を維持しています。
マスコットのキャラクター素材は **にゃむるたん © sa-san10 / CC BY 4.0**。
詳しくは [マスコット素材のライセンス](../../src/content/nyamurutan-character-setting.md) と
[ライセンス表示のソース](../../src/pages/licenses.astro) を参照してください。
