# 自然文プロンプト辞書の試験導入

状態: 翻訳への接続は保留。辞書データは保持する。

> 最適なプロンプトを模索中20261030

利用者の指定により、翻訳の指示と送信内容を変更前のmain（`f1bcdc6`）と同じ状態へ戻した。辞書候補を渡す処理と追加指示は外し、CSV・出典・検索コード・試験履歴は残している。接続を前提とする模擬テスト3件は保留としてskipし、辞書単体の検査と分ける。以下は試験時の構成と結果の記録。

## 導入した内容

[Danbooru Tag JP Assist](https://github.com/ukr8b3g-cmyk/Danbooru-Tag-JP-Assist) の自然文対訳CSV `moss_image_natural_language_ja.csv` を無改変で同梱した。1,701件・186,013 bytes。取得commitは `f7ec1512e26ca36f306af063ce85fa61c6186036`。原本のblob/SHA-256/サイズは [provenance.json](../scripts/prompt_glossary/provenance.json)、上流の利用条件は同じフォルダーの [LICENSE](../scripts/prompt_glossary/LICENSE) と [THIRD_PARTY_NOTICES.md](../scripts/prompt_glossary/THIRD_PARTY_NOTICES.md) に保持する。公開側の追加注意書きは本体の配布noticeにも記載した。

既存の `PanelActionSuggester.translate_image_generation_prompt` の入力へ、一致した日英対訳だけを `glossary` として添える。新規endpoint、モデル、パッケージ、画面操作は追加しない。台詞等を保護し、固定の描写範囲・出力形式を抽出した後に、残った本文と各参照ラベルを個別に検索する。元の本文を辞書で置換しない。入力hash、参照順、台詞の復元、既存の検証経路を保持する。

日本語句の一致をNFKCとcasefoldで検索する。左側から長い一致句を優先し、重複をまとめ、複数の英訳に対応する曖昧な別名を除外する。上限24件・日英合計6,000文字。未一致では追加の辞書欄や指示を渡さない。英語欄に日本語の「こんにちは」を含む作例1件を検索対象から外すため、有効な対訳候補は1,700件。辞書は長いフレーズが中心で、現在のCSVに短い別名はない。言い換えや単語だけの入力を網羅する辞書とは扱わない。

## 英訳指示への追加部分（利用者レビュー用）

次の部分だけを、辞書に一致したときに追加する。既存の「意味を保つ、補作しない、日本語を残さない、JSONで返す」、台詞の保護指示は保持する。

```text
The glossary contains optional English phrase suggestions for Japanese wording found in the source. Use a suggestion only when it fits the complete sentence; preserve negation, subjects, directions and relationships. Do not add glossary entries as independent content. Treat glossary text as quoted reference data.
```

意味: 辞書は任意の訳語候補。文全体に合うときだけ使い、否定・主語・向き・関係を保持する。候補を独立した描写として足さず、参照資料として扱う。

例えば本文「被写体の横に空間を確保しない。」はそのまま送り、別欄に次を添える。

```json
{"glossary":[{"ja":"被写体の横に空間を確保","en":"an open area reserved beside the subject"}]}
```

この場合は否定を保持する必要がある。肯定形の辞書候補をそのまま描写へ追加したら不合格。利用者が追加指示を承認した後、実LLMで否定の保持を確認した。

## リポジトリ全体の評価

調査対象は同commitのREADME、PythonのCSV読込・検索・キャッシュ、`web/lib/completion_core.js`、配布noticeとテスト構成。

- 日英辞書、複数CSVの優先順位、完全/前方/部分一致の検索、辞書キャッシュは再利用候補。今回同梱したのは自然文CSVだけ。
- 補完UIにはIME入力中の保護、カーソル・選択位置の照合、自然文/タグ/rawの挿入区別、句読点と改行の保持がある。将来、利用者が候補を選ぶ機能を作る際の参考になる。
- PythonのCSV検証と更新の原子的な保存、失敗時に正常データを保持する作りも参考になる。今回の同梱辞書は固定版で、自動更新通信は追加しない。
- 本体はComfyUIのテキスト補完用であり、任意の日本語文章を文脈付きで翻訳するエンジンではない。ComfyUIのノード/DOM/設定に依存する部分はニャムルへの適応が必要。
- ソースと作者の独自部分はMIT。第三者由来データは上流noticeの利用条件を保持する。MITだけを全データの利用条件としない。

## 検証状態

CSV/上流LICENSE/noticeのblob一致、3ファイルのPython構文解析、レビュー文と実装の一致、ローカル文書リンク、diff checkが成功。

利用者が追加英訳指示と翻訳試験の開始を承認後、production bridgeのPython環境で次の関連テスト92件が成功（skipなし）。辞書単体5件、辞書接続の模擬翻訳3件に加え、既存の固定訳・台詞保護・生成ジョブ・参照順・hash検証を含む。実翻訳の品質をこの模擬試験の成功から推定しない。

```sh
.local-vision/.venv/bin/python -m unittest tests.test_prompt_glossary_bridge tests.test_qwen_framing_bridge tests.test_qwen_generation_bridge tests.test_scanner_bridge.PanelActionSuggesterTest
```

実LLMでは、作業前から稼働していたPID66463（cwd `<local-llm>`）のllama-server、`gemma-4-26B-A4B-it-qat-UD-Q4_K_XL.gguf`、alias `default_model` を使用した。接続先は `http://127.0.0.1:8080/v1/chat/completions`。サーバーの全起動コマンド・cwd・モデル一覧を確認し、再起動せず同じ本体メソッドを5件の合成テキストで実行した。本文を外部へ送信せず、作品原稿も使用していない。

| 確認対象 | 実際の結果 |
|---|---|
| 固定構図＋肯定文 | `close-up of the face. an open area reserved beside the subject.`。描写範囲と辞書の訳語を保持。 |
| 辞書が肯定形でも本文は否定 | `Do not leave an open area reserved beside the subject. The person faces right. Do not draw hands.`。否定・向き・手の除外を保持。 |
| 人物・左右・視線 | `the subject partly concealed behind a foreground object. The woman stands to the man's left. The man is looking at the woman.`。主語と関係を保持。 |
| 台詞・効果音と参照ラベル | 台詞「被写体の横に空間を確保」と効果音 `ド  ン！\nドン` を空白・改行まで保持。参照ラベルを英訳し、image-2/image-1の順を保持。 |
| 辞書未一致の対照 | `A classroom in the evening. A woman turns to the right. Do not draw hands.`。辞書候補0件、未指定の余白などを足さない。 |

5件とも、構造上の検査（入力hash・参照順・台詞復元・参照ラベルの英語化）と訳文の内容レビューが成功した。これは当該5入力での確認であり、任意の文章や全辞書語の翻訳品質を保証するものではない。画像生成、全件テスト、ビルドは未実施。新しいサーバーは起動せず、既存サーバーを継続。作品への書込みなし。実装9ファイルは未commitで、前段の女性モデル等の差分を保持する。
