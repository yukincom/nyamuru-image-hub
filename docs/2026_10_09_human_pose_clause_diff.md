# ポーズ本文の区切り単位の比較（2026-10-09）

利用者が日本語プロンプトの一部を調整しても、変更していない節を再翻訳対象にしないための純粋関数を追加した。このmoduleはUI描画や翻訳サービス呼出しを行わず、呼出し側へ差分を返す。

## 分割と位置

`src/lib/humanPoseClauses.ts` の `splitHumanPoseClauses(text)` は、ASCIIカンマ `,` と読点 `、` を同じ区切りとして扱う。混在でき、各節の境界空白を除去し、空節は無視する。内部の空白、改行、文字の表記は変更しない。句点・全角カンマは区切りに含めず、引用符や数値中のカンマも特別扱いしない。

戻り値 `HumanPoseClause[]` の各要素:

| field | 意味 |
|---|---|
| `index` | 非空の節の順番（0始まり） |
| `chunk_index` | 空節も含めた分割位置（0始まり） |
| `text` | 境界空白だけを除いた節の文字列 |
| `start`, `end` | 元の文字列内で `text` を切り出せるUTF-16の開始位置と終了位置。終了は含まない |

## 比較結果

`compareHumanPoseClauses(baselineText, editedText)` は、まず完全に同じ節を本文全体から探す。元の同文節が複数ある場合は元の出現順に一度ずつ使う。これにより、他の節の挿入・削除・並べ替えがあっても同文節の対応を維持する。

その後、残った元の節と編集後の節をそれぞれの出現順で対応させて `modified` とする。編集後だけに残る節は `added`、元だけに残る節は `deleted` とする。この位置対応は編集操作の確定や意味の一致を保証しない。挿入・削除・書換えを同時に行った場合も、完全一致を除いた残りの対応は決定的な位置対応である。

| 戻り値 | 内容 |
|---|---|
| `source_clauses`, `edited_clauses` | 分割済みの基準本文と編集後本文 |
| `units` | 編集後の順番に並んだ `unchanged` / `modified` / `added` の節 |
| `changed_units` | `modified` / `added` のみ。後段の翻訳対象に使用する |
| `deleted_units` | 元の順番に並んだ削除節。翻訳対象と分離する |

`units` の要素は `status`, `source_index`, `edited_index`, `original`, `text` を持つ。追加節は `source_index` と `original` が `null`。削除節も同じfieldを持ち、`edited_index` と `text` が `null`。両indexは非空節の `index` を参照し、`chunk_index` とは区別する。未変更の `original` と `text` は同一文字列をそのまま返す。

例: `左腕を上げる、両足を開く、視線は正面` を `右腕を上げる、両足を開く、視線は正面` に編集すると、先頭だけが `modified` となり、後ろ2節は `unchanged` として保持される。全文の不一致を理由に全節を変更扱いにはしない。

## 英文との対応と統合境界

現catalogの `baseline_segments` は本文全体に対する1個の `body` segmentであり、日本語の各節と英文の各節が対応づけられているわけではない。この関数は日本語の差分を抽出するだけで、英文をカンマで分割して日本語節のindexに割り当てたり、対応を作ったことにしたりしない。

未変更の英文をそのまま再利用するには、後段で検証済みの日本語節と英文segmentの対応を用意する必要がある。翻訳呼出しは `changed_units`、削除処理は `deleted_units` を参照し、対応が未確定の英文を位置だけで上書きしない。HTTP、LLM呼出し、catalogの変更はこの実装に含まない。

## 検証

`node --no-warnings --experimental-strip-types --test tests/humanPoseClauses.test.mjs` で、混在する区切り、境界空白、元位置、内部表記、変更・追加・削除・並べ替え・重複・空入力を検証する。さらに長さ0〜3・3種類の節の全1,600組について、最大数の完全一致、元の各出現の一回だけの使用、編集後の出現順、決定性を検証する。追加インストールやLLMは不要。

実行結果は新規12件、既存 `humanPoseTemplate` / `humanPoseSearch` の4件を含め16件成功。TypeScriptの単体strict型検査も成功。UIや実LLMによる翻訳はこの検証の対象外。
