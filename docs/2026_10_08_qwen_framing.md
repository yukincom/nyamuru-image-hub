# Qwen-Image-2.1のカット指定とラフ参照（2026-10-08）

## 調査結果

Qwen-Image-2.1の公式README・PE-T2I/PE-I2Iの公開指示文には、カット名ごとに人体の切れ位置を定義する表や、カットを必ず守らせる専用構文は確認できなかった。`close-up` は公式が使う語だが、「Qwenでは首・肩を少し含む」とまでは言えない。コードの固定訳と、生成モデルの構図追従は別に検証する必要がある。

- [Qwen公式README](https://github.com/QwenLM/Qwen-Image-2.1): テキストのpromptと参照画像を受け取る。公式のプロンプト書き換えモデルを推奨しているが、これはカット名から境界を返す辞書ではない。
- [公式PE-T2Iの指示文](https://huggingface.co/Qwen/Qwen-Image-2.1-PE-T2I/blob/main/system_prompt.txt): 冒頭の描写に`close-up`を使い、画面内の位置や端を英語の自然文で記述する。独自の`CU`タグや数値の切れ位置は規定していない。
- [公式PE-I2Iの指示文](https://huggingface.co/Qwen/Qwen-Image-2.1-PE-I2I/blob/main/system_prompt.txt): 変更内容を明確にし、複数画像は役割を区別する。指定されていない属性を推測で付け足さない。
- [利用者提示のEDIUS資料](https://www.ediusworld.com/jp/pimopic/cat2_126.html): LS、FF、KS、WS、BS、US、CU、Detailなどを図示している。本文も分類の一例と明記しており、Qwenがこの区分・境界を採用していることを示す資料ではない。図も目視確認した。

最初に検討した「クローズアップに首・肩を少し含める」「胸から上をmedium close-upと同一視する」という補足は、Qwenの公式定義ではないため採用しない。画面の日本語に含まれる意味だけを固定訳する。

## 今回の失敗について分かったこと

直近の保存済みジョブを読み取り専用で確認した。

| ジョブ | 日本語 | 保存済み英訳の該当部分 |
|---|---|---|
| `09c1d719-bc8a-45bc-8baa-85587c940d1e` | 描写範囲はクローズアップ。 | Scope of depiction: close-up. |
| `d4985ad1-24b8-4c43-ae7d-1c64ce4cdb0f` | 描写範囲はクローズアップ。 | The scope of depiction is a close-up. |

英訳にすでに`close-up`が入っていた。固定訳により表記揺れはなくせるが、それだけで膝上になる問題が解消すると断定できない。

[二時 六の2.1実験](https://note.com/ai_lab_navi/n/n36f35c3fa241)でも、int8版・25 steps・CFG 1の条件で、接写を指定した実写3枚が膝上となり、アニメでも同様だったと報告している。当環境は40 stepsで入力も異なるため、同じ原因の証明ではない。一方、[かみもとの2.1実験](https://note.com/sepiablue/n/n02026f718c3f)には顔アップを生成した作例もある。「2.1ではclose-upが膝上を意味する」「顔アップを生成できない」とも結論できない。

## 固定変換

既存の`translate_image_generation_prompt`を使う。明示的な描写範囲の文をLLMへ渡す前に取り出し、他の文と資料名を英訳した後で固定英文を先頭に戻す。元の日本語、参照順序、request SHA-256の対応を保持する。

これは表記揺れをなくすための固定翻訳であり、Qwen独自の画面サイズ定義ではない。

| 入力 | 固定英文 |
|---|---|
| 全身／フルショット | `full-body shot.` |
| 腰から上／ウエストアップ | `waist-up shot.` |
| 胸から上／バストアップ | `chest-up shot.` |
| 顔／顔アップ | `close-up of the face.` |
| クローズアップ／クロースアップ／クロース・アップ | `close-up.` |
| 手 | `close-up of the specified hand area.` |
| 足 | `close-up of the specified foot area.` |
| 身体の一部 | `detail shot of the specified body part.` |

書式は行頭の`描写範囲はクローズアップ。`または`描写範囲：クローズアップ`。現在の画面が生成する書式をそのまま使える。行頭の空白、半角コロン、句点を省いた行も受け付ける。

- 画面の選択値より、利用者が編集したプロンプト中の指定を使う。
- 直後にある画面由来の定型文「頭頂から胸までを画面に収めた構図で描く。」「指定した範囲を画面に収めた構図で描く。」は置き換え対象に含める。手動でカット名だけ変えた際の矛盾を残さない。
- 上表以外の自由記述は既存どおり全文英訳へ渡す。文章内の引用をカット指定として解釈しない。
- 異なる固定カットが複数行ある場合は、勝手に選ばず入力エラーにする。
- 向き・動作・表情・外見の指定を追加、要約、削除しない。

### 出力形式・背景の固定変換

利用者の追加指定により、同じ翻訳入口で出力形式と背景指定も取り出す。既存の`artworkEnglish.ts`の3対訳を`src/content/manga-formats.json`へ移し、OMNY/OMAYの書き出しとPythonのQwen生成が同じ表を参照する。

| 日本語 | 固定英文 |
|---|---|
| 出力形式：モノクロ漫画。 | `output format: black-and-white manga.` |
| 出力形式：カラー漫画。 | `output format: color manga.` |
| 出力形式：グレースケール漫画。 | `output format: grayscale manga.` |
| 背景：透過。／背景透過。 | `transparent background.` |
| 背景：白。 | `white background.` |
| 背景：不透明。 | `opaque background.` |

画面が付ける「背景・文字・吹き出しは加えず、外側は透明にする。」も固定変換する。新しい生成指示では独立行にし、開いたままの旧指示にある`人物：名前。背景・文字…`にも対応する。名前やアクションは変更しない。

仕上げに関する既知の定型文は、既存の`artwork-translations.json`を再利用して小文字の英文へ変換する。完全一致する文だけが対象で、数値パラメーター入りのテンプレート、日本語の識別名を残す英文、独自の追記・自由記述は固定置換せず従来の翻訳へ渡す。矛盾する出力形式や背景指定は入力エラーにする。

透過はモデルへの指示の固定化。画像ファイルに実際のアルファ透過が付くかを、この変更や文字列テストが保証するものではない。

## ネーム絵・ポーズ画像の参照

既存の「ペイントした画像を参照して生成」が対応経路。ペイントを画像1、人物資料を画像2以降に渡し、phaseの既存指示は画像1のポーズと構図を維持する。新しいAPI、モデル、LoRAは追加していない。

| 一次報告 | 分かったこと | 限界 |
|---|---|---|
| [nomadoorのガイド画像による生成](https://comfyui.nomadoor.net/en/basic-workflows/qwen-image-2-1/#generate-from-guide-images) | 骨格画像を通常の画像編集参照として渡し、人物資料と組み合わせた作例。ControlNetではないと明記。 | 抽出した骨格の例で、任意の手描きネームの精度を証明しない。 |
| [DiagramAwesomeの2.1比較](https://www.reddit.com/r/StableDiffusion/comments/1wo4e1s/qwenimage_21_vs_qwenimageedit_2511_21_is_not/) | int8 ConvRotでラフ風の棒人間・色面・絵コンテを完成画にした比較。位置、大きさ、向きの保持とガイド線の置き換えを指示。 | 各モデル3枚から選んだ結果。入力はKrea2生成との注記あり。追加LoRA/ControlNetの記載なしだが、手描き実証とは扱わない。 |
| [ぬるぽらぼの棒人間入力](https://note.com/nullpolab/n/n916390a652e1) | 手描き棒人間を画像1、キャラを画像2に渡す例。頭の向き・視線を文章でも指定。 | BFS Body Swap LoRA等を使う追加構成。ベース2.1だけの成功例ではない。 |

試験するなら、完成画と同じキャンバス比率で、人物の画面内の大きさと切れ位置までラフに描く。顔と体の向きが違う場合は両方を描き分ける。ペイントは清書対象、人物資料は外見参照と分け、ガイド線を完成線へ置き換える旨を利用者の指示文に書く。この手順は調査からの試験案で、当環境での成功確認済み設定ではない。

## 検証

固定変換と翻訳呼び出しの回帰テストを追加。手動上書き、翻訳へカット文を渡さないこと、元入力の不変性、参照順序、SHA-256、空翻訳・日本語残存の拒否を検査する。`test:bridge`の標準検出対象に含める。

追加分を含めPythonのQwen関連34件・既存PanelActionSuggester19件、NodeのQwen・作画設定・固定翻訳29件が成功。PythonはPillowのある`.local-vision/.venv/bin/python`でskipなし。`git diff --check`も成功。

稼働中のbridgeは生成中のジョブがないことと子プロセスが終了済みであることを確認して再起動（親PID 22825 → 43293）。実APIの準備処理で`close-up. output format: black-and-white manga. transparent background.`が固定保存されることと、元入力のSHA-256との対応を確認した。診断はLLM呼び出しも画像生成もせず、その診断用ジョブだけを既存削除APIで削除し、診断leaseを解放した。8080のLLM listenerは同一。証跡: `/private/tmp/qwen-framing-live-verification.json`。

画像の実生成による構図追従・ラフ清書の精度は未検証。過去の生成記録と作品フォルダは変更していない。
