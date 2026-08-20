# Nyamuru 🐱 Image Hub

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

紙のネームや視覚資料を解析し、編集可能な漫画設計へつなぐ。Nyamuru Manga Name Studioのフォークです。

[本家 Nyamuru Manga Name Studio](https://github.com/sa-san10/nyamuru-manga-name-studio) のOMNY編集・生成プロンプト機能に、アナログネームの取り込みとコマ編集支援を追加しています。

## できること

- スキャン画像や画像ファイルから、コマ・人物アタリ・フキダシを検出
- 手書き文字を読み取り、アタリとしてフキダシへ配置
- 検出結果を原画と見比べながら修正し、OMNY形式で保存
- 内枠スナップ、コマスナップ、Shift移動、コマ合体などでコマを調整
- Nyamuru本来のネーム編集、生成プロンプト、OMAY連携を利用

※ モノクロ300dpi程度だとかなり高精度で読み取れます。

## アナログネーム取り込み例

| 原画 | 解析結果 |
|---|---|
| <img src="./sample/scan01.jpeg" alt="紙に描いたアナログネーム" width="360"> | <img src="./sample/page01.png" alt="編集可能なコマ・人物あたり・フキダシへ変換した結果" width="360"> |

▶ [取り込みから編集開始までの操作動画（約49秒・MOV）](./sample/sample.mov)

## 起動

Node.js 22.12.0以上が必要です。

```bash
npm ci
npm run dev
```

アナログネーム取り込みを使う場合は、初回だけ画像解析環境を準備します。

```bash
npm run setup:vision
```

以後は別々のターミナルで `npm run bridge` と `npm run dev` を起動します。

詳しい操作とセットアップは [使い方ガイド](./docs/USAGE.md) を参照してください。

## ドキュメント

- [使い方](./docs/USAGE.md)
- [このフォークの機能と既知の制限](./docs/FORK_FEATURES.md)
- [ローカル画像解析の詳細](./docs/LOCAL_VISION_BRIDGE.md)
- [外部コンポーネントとライセンス](./docs/LOCAL_VISION_COMPONENTS.md)
- [本家更新の取り込み方](./docs/UPSTREAM_SYNC.md)
- [変更履歴](./docs/FORK_CHANGELOG.md)

## 作者・ライセンス

本プロジェクトは [sa-san10/nyamuru-manga-name-studio](https://github.com/sa-san10/nyamuru-manga-name-studio) を基にしたフォークです。Nyamuru本体と、このフォークで追加したコード・文書は、個別に別の表示があるものを除き [MIT License](./LICENSE) で提供します。

RT-DETRモデル、NDLOCR-Lite、その他の第三者コンポーネントには、それぞれのライセンスが適用されます。詳しくは [外部コンポーネントとライセンス](./docs/LOCAL_VISION_COMPONENTS.md) および [THIRD_PARTY_NOTICES.txt](./public/THIRD_PARTY_NOTICES.txt) を参照してください。
