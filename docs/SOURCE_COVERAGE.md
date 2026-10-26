# 原作・台本からOMNYへの取りこぼし監査 v1

`source coverage`は、人が明示的に選んだ1つのUTF-8 Markdown/textと、現在のstory OMNYをローカルで決定的に照合するsidecar監査です。

- 原作・台本やOMNYの内容を変更しません。
- LLM、VLM、埋め込み、fuzzy matcher、networkを使いません。
- 未一致を自動で「欠落」と断定しません。
- 数字だけのcoverage率は出しません。
- reportは制作packageで`coverage_report`として選択できるJSONです。

## UI

編集画面の「原文確認」tabを開きます。新規作成時に選んだエピソード資料は、その作品の編集セッションへ引き継がれます。既存作品では、端末または関連付けたエピソード保存先から1ファイルを選択できます。

判定は次の4種類です。

| 状態 | 意味 |
|---|---|
| `confirmed` | コマ・台詞側に一意の決定的証拠がある |
| `ambiguous` | 同じ原文に対する候補が複数ある |
| `unverified` | 決定的証拠がない。自動で未反映とは断定しない |
| `excluded` | fenced codeや構造separatorなどv1の監査対象外 |

`setting.situation`、作品情報、人物・素材台帳に同じ文があるだけの場合は`context_retained`です。原文全文があらすじへコピーされても、コマ・台詞へ反映された証拠にはしません。

人の判断は`covered`、`not_covered`、`not_applicable`のいずれかです。判断はファイル名・workspace相対path・正規化済み本文SHAを含むsource revisionと、series ID・episode ID・監査targetを含むOMNY coverage projectionのSHA-256へ結合され、どちらかが変わると`stale`になります。bridgeも両digestを同じcanonical preimageから再計算するため、別sourceや別episodeへ黙って再利用しません。

「作品フォルダへ保存」はcaller指定pathを受け付けず、次へcontent-addressed/no-overwriteで保存します。

```text
name_data/coverage/source-coverage-<canonical-report-sha256>.json
```

同一reportの再保存はidempotentです。異なるbytesが既存hash名にある場合は上書きせず失敗します。保存できない場合も`JSON download`を利用できます。

## CLI

標準出力へreportを出します。

```sh
npm run source:coverage -- \
  --source /path/to/episode.md \
  --omny /path/to/story.yaml
```

明示したファイルを一度だけ作成する場合:

```sh
npm run source:coverage -- \
  --source /path/to/episode.md \
  --omny /path/to/story.yaml \
  --source-relative-path origin_data/episode.md \
  --output /path/to/report.json
```

`--output`はcompact JSONを同directoryのstaging fileへ全量write・`fsync`してからno-overwrite publishします。既存ファイルを上書きせず、write失敗時にもpartial finalを残しません。実際にstdout/fileへ出す改行込みbytesにも8 MiB上限を適用します。監査上の要確認が残っていても、report生成自体が成功すればexit 0です。判断はJSONの`verdict`と`summary.unresolved_after_review`を読みます。

## 決定的照合の境界

sourceは先頭BOMを1個除き、CRLF/CRをLFへ正規化します。NUL、unpaired surrogate、2,000 Unicode code pointを超える行を拒否します。非空の可視行を重複なくunit化し、行番号と原文excerptを保持します。監査できる本文行が1件もないファイルは、空の成功reportにせず拒否します。

storyboard evidenceの対象:

- panel `action` / `background_description`
- figureの名前と動作
- bubble textと明示speaker/人物alias
- 同一panel内で連続する最大4 bubbleの結合
- screen text
- page overlayのfigureとbubble

context retainedの対象:

- title / series / episode number
- episode/series setting
- character name / alias / role
- material key / keyword / note

完全一致はhash index作成時に候補総数と先頭32件を集約し、同一文が大量に重複してもsource unitごとの全target再走査を行いません。substringはsourceとtargetがともに12 Unicode code point以上で、候補比較の上限内かつOMNY targetが原文unit全体を含む一意候補の場合だけ`confirmed`にできます。逆に原文unitが短いOMNY targetを含むだけなら候補は表示しても`unverified`のままです。比較候補が1,000万組を超える入力ではsubstringだけを省略し、`substring_matching_skipped_due_to_volume`をwarningへ残します。完全一致の走査は省略せず、省略時も未一致を欠落とは扱いません。短文、重複台詞、複数panel一致は`ambiguous`です。言い換え、要約、演出的再構成は`unverified`です。

IDは内容hashと同内容の出現ordinalから作り、JSON Pointerは表示用locatorとして分離します。一意内容を別ページへ移してもtarget IDは変わらず、locatorだけが変わります。

## 上限とfail-closed動作

| 対象 | 上限 |
|---|---:|
| source bytes | 5 MiB |
| source lines | 50,000 |
| source units | 10,000 |
| source unit text | 2,000 Unicode code points |
| OMNY coverage projection | 5 MiB |
| target units | 50,000 |
| target value | 5,000 Unicode code points |
| substring candidate comparisons | 10,000,000 |
| 保存候補/unit | 32（総数は別記録） |
| adjacent bubble window | 4 |
| serialized report | 8 MiB |

上限超過は部分reportを成功扱いせず、保存前に失敗します。

bridgeはworkspace tokenからエピソードrootを引き、sourceの全ancestorと保存先directoryを`openat + O_DIRECTORY + O_NOFOLLOW`で検証します。reportのanalysis hashをcanonical payloadから再計算し、候補targetのlayerと`context_retained`/statusの意味も照合します。staging regular fileはopen直後からinodeを保持して全量write・`fsync`し、公開前後にroot→`name_data`→`coverage`のinode chainを再検証します。同一directory内のhard-link publishでno-replaceを保証し、失敗時はidentityが一致するtask-owned staging/finalだけをrollbackして、公開後bytesを再検証します。`name_data`または`coverage`がsymlink・差し替え済みの場合は拒否します。応答とreportに絶対pathは含めません。

## Schemaとテスト

strict Draft 2020-12 schema:

```text
schemas/nyamuru-source-coverage-v1.schema.json
```

主な検証:

```sh
node --no-warnings --experimental-strip-types --test \
  tests/sourceCoverage.test.mjs \
  tests/sourceCoverageCli.test.mjs \
  tests/localBridge.test.mjs

python3 -m unittest \
  tests/test_source_coverage_bridge.py \
  tests/test_episode_workspace_bridge.py

npm run verify
```

## OSS判断とライセンス

新しいruntime依存は導入していません。この機能の中心は「NyamuruのOMNY fieldをcontext/storyboardへ分け、原文unitと対応させ、人の判断をrevisionへ結合する」というproject固有contractです。汎用Markdown parser、diff、fuzzy matcher、文書要件管理OSSだけでは置き換えられません。

- 既存`yaml 2.9.0`（ISC）はCLIのOMNY読込に既存経路のまま利用します。
- 既存`marked 18.0.7`（MIT）はsource spanと安全なtext表示に不要なため、この機能では使いません。
- StrictDoc（Apache-2.0）、Doorstop（LGPL-3.0）、Fountain.js（MIT）は文書管理・特定script形式のparserであり、Nyamuru固有coverageの代替にはならないため導入しません。

既存dependencyのlicense表記は`public/THIRD_PARTY_NOTICES.txt`を正本とします。

## v1対象外

- 複数sourceの統合
- PDF/DOCX/Fountain/画像/OCR
- semantic paraphrase、fuzzy/embedding/LLM/VLM判定
- OMNYの自動修正または修正案の自動適用
- series横断dashboard
- 未確認を理由にした制作block
