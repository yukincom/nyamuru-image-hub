# P4: キャラクターの性別属性・英文変換

作成日: 2026-10-08 / 整合更新: 2026-10-10 / 状態: 属性・保存・共通英文APIを実装済み。現行30件を使う生成画面への接続と、性別欄の実画面検証は未完了

[全体計画](2026_10_08_human_pose_plan.md) / 前提: [P1](2026_10_08_human_pose_p1_catalog.md)のtemplate契約 / 後続: [P5](2026_10_08_human_pose_p5_generation_integration.md)

## 目的

キャラクター設定に女性／男性／中性の選択を追加し、保存・読込・シリーズ共通人物の統合を通して保持する。選択したキャラクターに合わせ、ポーズ英文を文法的に正しく展開する。

UI上の属性名は「性別」。中性は英語生成でsingular theyを使う選択とし、見た目や名前から性別を推測しない。性別を理由に既存の外見prompt、体形、服装を自動で書き換えない。

## データと互換性

型は `Character.gender?: 'female' | 'male' | 'neutral'`。表示は「女性／男性／中性」。既存データにfieldがなければ未設定を保つ。読み込み時に全人物へ女性や中性を永続書込みしない。

未設定の既存人物は、selectの未選択表示を使い、選択肢そのものは指定された3つにする。生成時だけ中性の文法へfallbackし、その扱いをプレビューで分かるようにする。未設定と明示的な `neutral` は保存データ上で区別する。

人物の性別は `Character` が正本。`Figure` は人物参照を通して解決し、性別を重複保存しない。人物未割当てのfigureは中性文法で生成する。ジョブにはその時点で解決した値と英文をsnapshotとして保持する。

## 変更対象の調査と候補

| 領域 | 現在の入口・変更候補 | 確認すること |
|---|---|---|
| 型・作品 | `src/types.ts`、`src/lib/manga.ts` | normalize、validate、保存・再読込 |
| 人物設定UI | `src/components/DocumentEditors.tsx` | 各人物にselect、更新・Undoとの連携 |
| 人物Markdown | `src/lib/characterTextCatalog.ts` | 日本語の性別欄と内部enumの往復 |
| 共通人物の統合 | `src/lib/seriesCatalog.ts`、`src/lib/catalogModel.ts` | missing補完、明示値の保持 |
| システム人物 | `src/lib/systemCharacters.ts` | 初期人物、mob、未設定の扱い |
| bridge保存 | `scripts/nyamuru_series_catalog_store.py` | round-trip、型制限、未知fieldの扱い |
| 生成 | `src/lib/qwenGeneration.ts`、既存のPython prompt準備処理 | template rendererと解決値の受渡し |
| 仕様書 | `src/content/nyamuru-data-model-v10.md` と英語版、現行生成prompt仕様 | 現行のfield・規則だけを記載 |

これは候補一覧であり、実装前にfieldを捨てる経路を全検索し、実際に必要なpathだけをclaimへ登録する。新しい人物台帳や別保存formatは作らない。

## 実装手順

1. 現在の保存fixtureで、人物新規作成、編集、作品読込、人物Markdown、シリーズ共通・話固有・system人物の経路を一覧化する。
2. optional fieldとstrictな値検証を追加する。外部文字列をenumへ勝手に丸めず、対応表にない値は既存の入力エラー処理へ合わせる。
3. キャラクター設定の名前・外見等と同じ編集単位にselectを追加する。選択した値が即時にdirty状態・Undoへ反映され、再読込でも残るようにする。
4. Markdown入出力で「性別: 女性／男性／中性」を扱う。出力の並びは既存人物項目に合わせる。内部保存はenum、表示・Markdownは日本語として往復を保証する。
5. シリーズ共通人物からのmergeでは、既に設定された話固有値を上書きしない。未設定だけを補完する既存のmerge方針と照合する。
6. P1の `humanPoseTemplate.ts` を共通rendererとして再利用する。`renderCharacterHumanPoseTemplate(template, character?)` で `{ gender, isFallback, text }` を取得する。TSとPythonで英文rendererを重複実装しない。P5ではTSで確定した英文を既存prepare経路へ渡す。
7. 自由文の翻訳は既存経路を使う。文章モードでは未編集のポーズ英文をそのまま使い、日本語で微修正された場合だけP5で該当segmentをLLM修正する。画像モードで送らない編集pose文は翻訳しない。両モードの人物参照説明と共通指示に同じ属性を使う。LLM出力でも代名詞・動詞のtoken契約を保ち、性別の解決を重複させない。最終promptへは一度だけ結合する。
8. 仕様書に現在のcontractを追記する。`src/content/` では変更履歴や過去版の説明を入れず、移行記録は本計画側へ残す。

## 文法の扱い

| 要素 | 女性 | 男性 | 中性 |
|---|---|---|---|
| 主格 | she | he | they |
| 目的格 | her | him | them |
| 名詞の前の所有格 | her | his | their |
| 独立した所有代名詞 | hers | his | theirs |
| 再帰代名詞 | herself | himself | themselves |
| be動詞 | is | is | are |
| have | has | has | have |
| 一般動詞の例 | stands / holds | stands / holds | stand / hold |

`her` が目的格なのか所有格なのかはtemplateのtokenで表す。英文全体への置換で判定しない。現行30件に必要な語形を検査し、主語・代名詞を含まない英文はそのまま保持する。過去形や分詞など主語で変化しない部分まで変更しない。研究68件で用意した語形と検証fixtureは回帰用に保持する。

複数人物では、単独の `they` が全員を指して見えないよう、人物のlabelまたは人物別段落にpose文を結び付ける。中性を選んだことで人数を複数に変更しない。`1girl`、`1boy`、`solo` 等の人数・人物の指示はP5で生成対象に合わせて組み立て、全promptの確認一覧へ出す。性別欄だけから人数を決めたり、すべての人物に `girl` や `solo` を一律適用したりしない。

## 検証と完了条件

- 女性／男性／中性それぞれでUI編集→保存→再読込が一致する。未設定を含めた既存作品も読める。
- 人物Markdownの往復、シリーズ共通人物とのmerge、話固有値の保持、system/mob人物を検査する。
- 採用30件 × 3属性の英文を生成して、token残り・性別の混在・動詞の不一致を検出する。主語を含まない英文は不要な代名詞を追加しない。研究68件の検証記録・fixtureも保持し、representative文は期待する英文と直接比較する。
- 目的格のherと所有格のher、is/are、has/have、singular they、文頭の大文字化を独立して検証する。
- 未設定を読んだだけで作品に差分が生じない。プレビューのfallbackと保存される属性を区別できる。
- ポーズの日本語編集後や人物の性別変更後にも、該当部分の英文と代名詞・動詞が一致する。人物参照の保持指示にも同じ解決値を使う。
- 送り方を切り替えても人物属性は変わらず、画像モードで送信対象外のpose文を誤って翻訳・結合しない。
- P5へrendererのAPI、解決した英文、解決に使った人物ID・性別・template revisionを渡せる。

## 2026-10-09 実装結果と残作業

以下の68件/204通り/408文は研究catalogを使った当時の検証結果であり、現行30件の生成統合が検証済みという意味ではない。

- `CharacterGender` を人物属性の型の正本とし、`HumanPoseGender` はその型を参照する。`characterGender.ts` に表示名・strict検証・未設定時の生成用解決をまとめた。
- 人物設定UIへ「性別」の3候補を追加した。未設定は選択不可のplaceholderで表示し、既存の文書更新経路へ接続した。名前、外見、人物像からの推測はしない。
- OMNY・分離OMNY・シリーズOMNY・自動保存・project snapshotはoptional fieldを保持する。不正値はnormalizeで丸めず、既存の `validateManga` が `.gender` の入力エラーとして示す。
- 人物Markdownは `性別：女性／男性／中性` を往復する。明示した値は更新し、性別欄のない資料は既存値を保持する。空欄や対応表にない値は入力エラー。資料候補の分類中には画面を止めず、反映時にエラーを表示する。
- 共通人物からのmergeは未設定だけ補完する。話の明示値は中性も含めて保持する。台帳への保存でも、未設定の話から既存台帳の性別を消さない。system/mobに性別の既定値は加えない。
- `catalogModel.ts` と `systemCharacters.ts` は既存のclone・参照同期で属性を保持するため変更不要だった。Python台帳もOMNY原文をそのまま保存するので処理追加はせず、一時領域のround-tripで確認した。
- 共通rendererはP1のtoken展開を使い、共通語形表へ `have / has` を追加した。未設定だけ `isFallback: true` とし、明示的な中性と区別する。NDM日英・生成prompt仕様へ現行属性を記載した。

検証結果:

| 検証 | 結果 |
|---|---|
| `node --no-warnings --experimental-strip-types --test tests/characterGender.test.mjs tests/characterTextCatalog.test.mjs tests/seriesCatalog.test.mjs tests/catalogModel.test.mjs tests/humanPoseTemplate.test.mjs` | 47件成功 |
| `python3 -m unittest tests/test_character_gender_bridge.py tests/test_human_pose_catalog.py` | 12件成功 |
| `npm run check` | 313 files、error / warning / hint 0 |
| 正本の `.human_pose/catalog.json` を読取専用で共通rendererに渡す検証 | 68件 × 3属性 = 204通り、全体文とsegment計408文でtoken残り・代名詞混在なし |

実画面での選択→保存→再読込、Undo、エラー表示は未検証。生成前preview、人物ID・template revisionを含むjob snapshot、編集日本語のLLM変換、両モードでの実送信内容はP5/P7の残作業であり、今回のP4実装ではQwen生成pipelineへ接続していない。人物未割当てを含む中性文法の解決APIは用意したが、生成対象の許可条件は既存pipelineのまま。
