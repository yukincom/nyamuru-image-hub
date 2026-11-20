# Nyamuru 🐱 Image Hub

[![Fork CI](https://github.com/yukincom/nyamuru-image-hub/actions/workflows/ci.yml/badge.svg)](https://github.com/yukincom/nyamuru-image-hub/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

**紙のネームから、一貫性のある作画、クリスタでの仕上げまでをひとつにつなぐ漫画制作アプリ。**

[Nyamuru Manga Name Studio](https://github.com/sa-san10/nyamuru-manga-name-studio) を土台に、アナログネームの取り込み、キャラクター管理と作画支援、CLIP STUDIO PAINT（`.clip`）書き出しを備えたローカルファーストの制作ツールです。

| 紙のネーム | 取り込み・編集画面 |
|---|---|
| <img src="./sample/scan01.jpeg" alt="紙に描いたアナログネーム" width="360"> | <img src="./sample/page01.png" alt="コマ・人物あたり・フキダシへ変換した編集画面" width="360"> |

▶ [取り込みから編集までの操作動画（約49秒・MOV）](./sample/sample.mov)

---

## Nyamuruの3つの特徴

### 1. ローカルOCRが強い — 紙のネームをそのまま編集できるデータに

紙に描いたネームを読み込むだけで、**文字・ふきだし・コマ**を自動で拾い上げ、すぐ編集できる状態に変換します。

- スキャン画像や写真から、コマ枠・人物あたり・ふきだし・セリフを一括で解析
- 解析はすべて手元のPC（ローカル）で完結するため、原稿を外部に送らず安心して利用可能
- 原画と見比べながら、文字の修正・ふきだしの調整・コマ割りの編集をそのまま進められます

<img src="./sample/editor-workspace.png" alt="見開きの編集画面。右ページのコマに人物あたりとフキダシが入り、右のパネルで人物と撮影範囲を編集できる" width="880">

---

### 2. キャラクターと設定画を自動で紐づけ — 一貫性のある生成がとても楽

登場キャラクターとキャラクターデザイン（設定画）をシリーズ単位で管理し、**コマ内の人物とデザイン資料を自動で紐づけます**。

- 基本は **「キャラクター設定画」＋「ネームのあたり」の2画像生成**。設定画とネームのあたりが自動でセットされるため、毎回細かく指示を書き直さなくても一貫性のある作画をラクに生成できます
- 生成先は **ComfyUI**・**クラウドエージェント**・**クラウドAPI** に対応しています（[動作デモ（X）](https://x.com/yukin_co/status/2122997865748525187?a=K4-ZwDRRZ-SbirdKNEA&s=20)）
- 生成画像は元のあたりを消さず新規レイヤーとして重なるため、比較ややり直しも安心です

<img src="./sample/two-image-generation.png" alt="キャラクター設定画とネームのあたりを自動で紐づけた2画像生成画面" width="460">

<details>
<summary>オプション：3Dポーズを使った3画像生成にも対応</summary>

必要に応じて、3Dモデルでポーズやカメラアングルを決めて参照に加える「3画像生成」へ切り替えることもできます。

| 3Dモデルでポーズと構図を決める | 3Dポーズを加えた3画像生成 |
|---|---|
| <img src="./sample/pose-editor.png" alt="3D編集画面。登録ポーズの一覧、関節の操作、モーションサポーター" width="410"> | <img src="./sample/three-image-generation.png" alt="3Dポーズ・キャラクター設定画・ネームの表情を紐づけた3画像生成画面" width="410"> |

</details>

---

### 3. レイヤー構造やマスク情報を保ったままクリスタに送れる

Nyamuruで整えたページは、**レイヤー構造やマスク情報を保ったまま CLIP STUDIO PAINT 形式（`.clip`）で書き出せます**。

- コマ枠、ふきだし、文字、描画、生成画像、原本などが階層を保ったまま出力されます
- 1枚絵に統合されないため、クリスタ側でそのまま文字の修正・線の描き込み・マスクの調整が可能です
- ネーム〜作画の土台づくりはNyamuru、仕上げ・清書はクリスタ、と制作フローを自然につなげられます

<img src="./sample/clip-export-csp.jpg" alt="CLIP STUDIO PAINTで開いた書き出し結果。レイヤー構造・マスク・ふきだし・テキストが編集可能なまま保持されている" width="880">

---

## 操作動画

- [人物設定から作画を組み立てる（X）](https://x.com/yukin_co/status/2117238094068084793)
- [ふきだしアセットを使う（X）](https://x.com/yukin_co/status/2117425677435867287)
- [ポーズアセットを使う（X）](https://x.com/yukin_co/status/2108575800270508059)

## はじめ方（セットアップ）

セットアップや起動の手順・技術構成はすべて [AGENTS.md](./AGENTS.md) にまとめています。
お使いのAIエージェント（Codex・Antigravity・Claude Code など）に **「`AGENTS.md` を読んでセットアップして起動して」** と依頼して進めてください。

詳しい操作方法を知りたい場合は [使い方ガイド](./docs/USAGE.md) も参照できます。

## 作者・ライセンス

本プロジェクトは [sa-san10/nyamuru-manga-name-studio](https://github.com/sa-san10/nyamuru-manga-name-studio) を基にしたフォークです。Nyamuru本体およびこのフォークで追加したコード・文書は、個別に別の表示があるものを除き [MIT License](./LICENSE) で提供します。

第三者コンポーネントのライセンスは [外部コンポーネントとライセンス](./docs/LOCAL_VISION_COMPONENTS.md) および [THIRD_PARTY_NOTICES.txt](./public/THIRD_PARTY_NOTICES.txt) を参照してください。
