# 音声操作・意図分類の公開データ調査（2026-10-18）

ニャムルの19分類を強化する候補を調査した。日本語ではMASSIVE、否定境界ではAmazonのIntent Semantics Toolkit、複数意図ではBlendXが候補になる。ただし、今回調べた範囲で、保存・Undo・Redo・表示切替・不実行・延期・複数操作を揃えた日本語GUI意図分類データは確認できなかった。

調査・原データの検査まで実施。モデル学習、外部データの19分類への変換、既存データへの混入はしていない。利用者が公開データ探索を優先したため、新しい合成dev/testの作成・確定とv0.3用Colabの完成は保留している。

## 有力候補

| データ | 言語・規模 | 作成方法・形式 | 利用表示 | ニャムルでの用途と限界 |
|---|---|---|---|---|
| [MASSIVE 1.1](https://github.com/alexa/massive) | 日本語のラベル付き発話16,521件、60意図。公式JSONLを取得して実測 | 英語SLURPを人手で各言語へローカライズ。`utt`、`intent`、`partition`、slot注釈・品質判定等 | [CC BY 4.0](https://huggingface.co/datasets/AmazonScience/massive/blob/main/LICENSE) | 日本語の家電・音量・予定・情報検索など。操作依頼の表現候補になるが、編集ソフトの19分類とラベルは一致しない。日本語の実利用音声ログではない |
| [Amazon Intent Semantics Toolkit](https://github.com/amazon-science/aws-intent-detect-neg-implicature-dataset) | 英語。公開否定ファイルの非空行8,636、含意test計4,350 | 元の意図分類例に否定・含意を加えたデータ。LLM生成を含む。発話 `.in`、対応ラベル、生成元JSON | データCC BY 4.0、コードApache-2.0 | 否定・不要・撤回に近い。日本語化と意味確認が必要。元の評価用ファイルを使う場合は用途を事前に固定する |
| [BlendX](https://github.com/HYU-NLP/BlendX) | 英語版4集合、論文の合計179,535件。韓国語版もある | 既存単一意図例をルールとChatGPTで複合化。`utterance`、1〜3個の`intent`、`split`等 | [配布カードはGPL-2.0](https://huggingface.co/datasets/HYU-NLP/BlendX) | 複合文・省略・参照表現の候補。質問も意図に数えるため、意図数だけでニャムルの`compound_request`へ変換できない |
| [JNLI-Neg](https://github.com/asahi-y/JNLI-Neg) | 日本語。train 5,494、valid 1,363の文ペア | 否定を挿入した日本語推論データ。含意・矛盾・中立を人手注釈 | データCC BY-SA 4.0、コードApache-2.0 | 否定の意味理解の補助課題・設計資料。操作を実行するかどうかの19分類データではない |

Amazonの公開否定ファイルの内訳はBANKING77 3,079、CLINC150 4,500、HWU64 1,057行。BlendXの論文内訳はSNIPS 55,853、ATIS 22,500、Banking77 40,420、CLINC150 60,762件。これらの件数はニャムルへ採用可能な件数ではない。

関連論文：[Amazonの否定・含意](https://aclanthology.org/2024.acl-long.33/)、[BlendX](https://aclanthology.org/2024.lrec-main.218/)。公開データであっても合成例を含むため、人間の実発話と同一視しない。

## システム・GUI操作に近い候補

- [NL2Bash](https://github.com/TellinaTool/nl2bash/blob/master/data/README.md)：英語の自然言語とBashコマンドの対。raw配布12,607対、フィルタ後の論文用splitは8,090/609/606の計9,305対。`all.nl`と`all.cm`が行対応する。[データはMIT](https://github.com/TellinaTool/nl2bash/blob/master/data/bash/LICENSE)。OS操作の条件表現には近いが、GUIの意図分類や日本語ではない。
- [OSWorld](https://github.com/xlang-ai/OSWorld)：英語のGUI実行ベンチマーク。現在の`test_all.json`は369課題、GIMP・Writer・VS Code等を含む。Apache-2.0。`instruction`に加えて環境初期化と実行結果検査を持つため、テキスト分類用教師データとは区別する。確認できたGIMPのUndo関連例は「履歴段数の設定」で、Undoの実行依頼ではない。
- [xSID](https://github.com/mainlp/xsid)：日本語valid/testを公開した多言語意図・slot集合。CC BY-SA 4.0。家電・エディタ19分類を揃えた集合ではなく、今回はMASSIVEより優先しなかった。
- [JMultiWOZ](https://huggingface.co/datasets/nu-dialogue/jmultiwoz)：日本語4,246対話、旅行等6領域、人同士のWizard-of-Oz収集。CC BY-SA 4.0。文脈を含む対話状態が主で、現在の単独発話19分類へ直接移せない。

## 取得できるデータとして採らなかったもの

- [VoiceAlign](https://a11y.ist.psu.edu/downloads/IUI_2026__VoiceAlign.pdf)：Undo/Redoを含む8操作で近い。train 1,000/valid 400/test 150はClaude Sonnet 4.5で生成し著者が修正した合成例。論文はデータ・コードの公開予定を述べるが、調査時点で対応する公開配布ファイルを確認できなかった。論文のライセンスを未配布データへ適用しない。
- [Innovate AIDE](https://huggingface.co/sanjanajk1976/distillbert-intent-classifier)：READMEにUndo/Redo分類と学習CSV名があるが、[公開ファイル一覧](https://huggingface.co/sanjanajk1976/distillbert-intent-classifier/tree/main)で確認できたのはモデル・設定・tokenizer・README。データ本体・件数・由来・データの利用条件は未確認。
- [NLP-JapComC](https://magichub.com/datasets/japanese-text-corpus-command-and-query/)：日本語コマンドと質問100文。取得にサインインが必要で、CC BY-NC-ND 4.0の表示。規模と利用表示を踏まえ、今回の優先候補から外した。

## MASSIVE実ファイルの確認

公式配布の `amazon-massive-dataset-1.1.tar.gz`（40,251,390 bytes）から日本語JSONLとLICENSEを取得し、既存入力と別の `artifacts/public-datasets-20261018/massive-1.1/` に保存した。配布物のコードは実行していない。

- 日本語JSONL：12,263,054 bytes、16,521行、60意図。
- train 11,514 / dev 2,033 / test 2,974。Hugging Faceカードの総覧にある19,521という値ではなく、今回のラベル付き実ファイルの件数を採用した。
- 例：`止めて`（train ID 5）は`audio_volume_mute`、`ちょっとうるさい`（train ID 259）は`audio_volume_down`。特定アシスタントの文脈・暗黙の解釈を含む。ニャムルでは同じ文でも確認や非命令になる可能性がある。
- 60ラベルにエディタのUndo/Redoはない。関連語検索で見つかった取消・やり直し9件は予定やリストの操作であり、編集履歴のUndo/Redoとして使えない。
- NFKC+casefoldとUnicodeの記号・句読点・空白除去で比較すると、重複テキスト群512、複数splitにまたがる群298、異なるintentを持つ群33。意味が近い文の網羅的な検査ではない。
- 手元の旧924件+追加288件とは同じ正規化による完全一致0件。これだけで意味的独立性が保証されるわけではない。
- ハッシュ・件数の記録：[MASSIVE検査記録](2026-10-18-massive-inspection.json)。

## 次に試す場合の判断

日本語の実例を拾うならMASSIVEから始め、今回の弱点である否定と複数操作にはAmazon/BlendXの構文と注釈方針を参照する。ただし改善効果は未測定であり、ラベルをそのまま混ぜる案は採らない。例えば、家電操作はニャムルでは範囲外の依頼であり、すべてを`not_command`へ押し込むことも誤りになる。

外部データを使う場合は元ID・元ラベル・版・利用表示と、日本語化や再注釈の変更を残す。先に原文と近いfamilyの用途を固定し、派生例も同じ側へ置く。外部補助データあり／なしを同じニャムル評価セットで比較する。一般アシスタント60分類や否定NLIのスコアで、ニャムル19分類の95%達成を代用しない。実発話・ASR込みの95%評価は引き続き未実施。
