# Contributing

IssueやPull Requestを歓迎します。

このリポジトリは [sa-san10/nyamuru-manga-name-studio](https://github.com/sa-san10/nyamuru-manga-name-studio) のフォークです。報告・提案の前に、対象がどちらに属するか確認してください。

- NDM・OMNY・OMAY・生成プロンプトや、本家にも存在する一般機能: 原則として本家へ報告
- アナログネーム取込、ローカルbridge、RT-DETR／Baberu OCR連携、コマ編集支援: このフォークへ報告
- 両方へ影響する変更: 先にIssueで適用範囲を相談し、同じ修正を別々に重複実装しない

このプロジェクトへ意図的に提出したコントリビューションは、別途明示的な合意がない限り、プロジェクトと同じMIT Licenseで提供することに同意したものとして扱います。第三者のコード、文章、画像、その他の素材を含める場合は、再配布とMITプロジェクトでの利用が可能であることを確認し、出典とライセンスをPull Requestへ記載してください。

Baberu OCR、RT-DETRモデル、学習データは本フォークへ同梱しません。外部コンポーネントへ変更が必要な場合は、その配布元へ別の変更として提出し、このフォークでは互換性のある呼び出し境界だけを扱ってください。詳細は [LOCAL_VISION_COMPONENTS.md](./docs/LOCAL_VISION_COMPONENTS.md) を参照してください。

バグ報告・機能要望は、Issueテンプレート（バグ報告／機能要望）を利用してください。セキュリティ上の問題は公開Issueに書かず、[SECURITY.md](./SECURITY.md) の手順で非公開に報告してください。参加にあたっては [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) に従ってください。

## 開発と検証

Node.js 22.12.0以上を使用します。

```bash
npm ci
npm run check
npm test
npm run build
git diff --check
```

ローカル解析環境がある場合は、次も実行します。

```bash
npm run bridge:check
```

ローカル解析環境が無い場合でも、JavaScriptテストとbridgeの標準ライブラリテストは実行できます。実モデルを使う確認を省略した場合は、Pull Requestへ明記してください。

コミット前にモデルと利用者データの混入を確認します。

```bash
git ls-files | rg '\.(onnx|safetensors|gguf|pt|pth|ckpt|bin)$'
git status --short --ignored
```

実際の原稿画像、OCR出力、スキャナー保存先、絶対パスを含む個人設定をテストfixtureへ使用しないでください。必要な画像fixtureは権利関係を確認した最小の合成データにします。

## 変更時に同期する文書

- アナログ取込の操作・制限: `README.md`、`docs/FORK_FEATURES.md`
- bridgeの起動・環境変数・データ寿命: `docs/LOCAL_VISION_BRIDGE.md`、`SECURITY.md`
- 外部コンポーネント・モデル・ライセンス: `docs/LOCAL_VISION_COMPONENTS.md`、`public/THIRD_PARTY_NOTICES.txt`
- フォーク固有機能の追加・削除: `docs/FORK_CHANGELOG.md`
- NDM・OMNY・OMAYの仕様: 下記の本家由来同期チェックリスト

## NDM文書の二重掲載箇所（同期チェックリスト）

NDMの規則の一部は、読者（ネーム担当と画像生成AI）が異なるため意図的に複数箇所へ掲載しています。次のいずれかを改定するときは、対応する掲載箇所を必ず全て揃えて直してください。

OMAY（`src/content/standard-settings.yaml`）の `style_notes` / `layout_spec` は、全部入りサンプル `src/content/sample.yaml` にも同文が埋め込まれています。**OMAYを改定するときは sample 側も必ず揃えて直してください。**

- **配置の優先順位**（`action` ＞ `anchor` ＞ 発言順＝立ち位置 ＞ `size` ＞ `bbox`）
  - 正文: 生成プロンプト §C「基本原則: 配置の優先順位」の表（`src/content/nyamuru-manga-generation-prompt-v10.md`）
  - 転記: 同プロンプト §B `style_notes` 末尾の優先順位の行
  - 転記: 簡易ガイド §3（`src/content/nyamuru-data-model-v10.md`）
- **bg（背景詳細度）の定義**
  - 生成プロンプト 手順4
  - 生成プロンプト §B `style_notes` の bg 関連の行
  - 生成プロンプト §C「背景詳細度(bg)」節
  - 簡易ガイド §2 の bg の行
- **コマ外周マージン・枠線・タチキリの数値**
  - 生成プロンプト 手順2
  - 生成プロンプト §C「コマ間の間隙とライン」節
- **タチキリ（`bleed`）の宣言と作画手順**
  - 生成プロンプト 手順2 のタチキリの項
  - 生成プロンプト §A「フィールドの決まりごと」の bleed の行
  - 生成プロンプト §B パターンM〜Qの座標例
  - OMAY `layout_spec`「コマ間の間隙とライン」の例外（タチキリ）の項
- **配置意図の優先順位（1. 演出意図の宣言 ＞ 2. 役割・描写範囲の宣言 ＞ 3. 既定＝人物センター原則）**
  - 生成プロンプト 手順3 の人物センター原則
  - 生成プロンプト §A「フィールドの決まりごと」の size / role の行
  - OMAY `layout_spec` figures 節の size / role
  - 簡易ガイド §4
- **フキダシ尻尾の規則（`offscreen` は尻尾を描かない）**
  - OMAY `style_notes` の尻尾の行
  - OMAY `layout_spec`「禁止事項」のしっぽの項
  - 生成ワークフロー「6. ページ検品」の尻尾の項
