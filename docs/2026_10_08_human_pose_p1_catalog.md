# P1: ポーズ一覧・出典保存・共通契約

作成日: 2026-10-08 / 整合更新: 2026-10-10 / 状態: 研究68件の取り込み・共通処理は実装済み。現行catalogは採用30件（schema 2）。共通rig・座標・素材の検証へ接続済み。

研究68件の日英本文・元画像136枚とschema 1のcatalogは参考資料として保持する。現在は利用者が採用した配布30件の日英文・姿勢・元PNGをschema 2へ登録済み。研究68件の3D制作は現行計画に含めない。[実装記録](2026_10_08_human_pose_implementation.md)と[採用30件の統合](2026_10_09_human_pose_curated_integration.md)を参照。

[全体計画](2026_10_08_human_pose_plan.md) / 後続: [P2](2026_10_08_human_pose_p2_base_model.md)、[P3](2026_10_08_human_pose_p3_pilot.md)、[P4](2026_10_08_human_pose_p4_character_gender.md)

## 目的と範囲

採用30件の日英文・出典・検索と、共通素体へ適用する姿勢の契約を共有する。原文の詳細と3Dで近似した範囲を区別し、初期版では利用者が文章で姿勢を調整する。現在の承認済み本文にある顔・目線・画面左右の記述は保持し、P5の独立目線・撮影説明へ接続する際に重複・矛盾を整理する。無条件に研究用の除去規則を再適用しない。

研究68件の出典は [pose study](https://pyrolistical.github.io/krea-2-qwen-image-2-1-study/pose) と [source repository](https://github.com/Pyrolistical/krea-2-qwen-image-2-1-study)。参照revisionは `5fcb3705e02a2fa7777708e432ac00aa73e43dd1`。分類は standing / leaning-and-supported / holding-a-handle-with-one-arm / holding-a-handle-with-both-arms / sitting / squatting / lying-down の7つ。以下の研究資料の取得・正規化手順は履歴と再現用に保持する。現行30件の出典・BVH・登録手順は[P6](2026_10_08_human_pose_p6_pose_assets.md)に従う。

## 研究資料取り込み時の事前確認

1. 既存asset manifest、schema validator、HTTPでのローカル素材読込、バックアップ／書出し機能を調べる。共通処理を使えるなら再利用し、同じ役割のstoreを作る前に重複を報告する。
2. 出典7ファイルの全見出しを数え、68件・画像136枚の対応を確認する。件数に差があれば最新版へ勝手に追随せず、revisionと公開ページの差を記録する。
3. 出典LICENSEと各画像に別条件がないかを実データで確認し、取得した条件を保存する。外部公開はこの段階の対象外。
4. `.gitignore` と既存素材の保存方針を読み、`.human_pose/` の大容量素材が誤ってcommitされない構成を決める。

## 作業手順

### 1. 研究68件の出典を固定する（実施済み）

- raw Markdownを指定revisionで取得し、本文を改変せず `sources/study/` に置く。共通promptの参照先も保存する。
- 公開ページから実在する画像URLを一覧化する。ファイル名を推測して一括取得しない。
- 各項目にsource slug、元見出し、Markdown位置、source revision、画像のmodel名・URL・取得時刻・SHA-256・サイズを記録する。
- 元画像を `poses/<pose_id>/references/` に保存する。404、HTML応答、破損、重複hashを検査し、2モデル分の欠落を検出する。既存ファイルはhashが一致するときだけ再利用する。

### 2. 研究68件からポーズを抽出する（取得時の規則）

- 共通指定を解決した元の全文 `original_prompt` と、ポーズ箇所の原文 `pose_source_text` を別に残す。
- 外見、髪、衣類の種類・色、定型の視線指定をpose-onlyから外す。アングル、画角、背景もポーズ英文へ混ぜない。
- 頭・首・胴体の回転、重心、関節の曲げ、手足の位置、接触は保持する。`looking back` のような表現は頭の回転と目線に分け、意味が曖昧なら要確認にする。
- ポケットや髪に手を触れる姿勢は接触動作として扱う。服装や髪型の固定指定に変えず、汎用素体で代用した位置を `contact_notes` に記録する。
- 壁・椅子・取っ手などの支持物は `supports` に分ける。支持物が必要な姿勢から、接触条件まで削除しない。
- 削除・言い換えごとに理由を記録する。原文にない左右、角度、指の形を英文へ付け足さない。

### 3. 英文をtemplate化する

正規化した英文を、P4が解決できる次のtokenへ変換する。

| token | 用途 | 女性 / 男性 / 中性 |
|---|---|---|
| `subject` | 主格 | she / he / they |
| `object` | 目的格 | her / him / them |
| `possessive_adjective` | 名詞の前の所有格 | her / his / their |
| `possessive_pronoun` | 独立した所有代名詞 | hers / his / theirs |
| `reflexive` | 再帰代名詞 | herself / himself / themselves |
| `verb:<lemma>` | 主語に応じた動詞 | stands / stands / stand など |

契約例: `{{subject}} {{verb:stand}} with {{possessive_adjective}} weight on one leg.`。文頭の大文字化はrender時に行う。tokenの書式はschemaとrendererを一緒に確定し、文字列置換の正規表現だけで英語全般を処理しない。現在の採用30件に使われる語形を検査し、未対応tokenを空文字で通さない。主語・代名詞を含まない確認済み英文に、性別を表す語を無理に追加しない。研究68件のtoken検査は既存の回帰資料として保持する。

各templateに同じ意味の日本語文を付ける。短いポーズ名とは別に、「椅子に座り、片脚をもう一方の膝に重ねる」等、利用者がそのまま微修正できる本文とする。日英で左右・接触・曲げ方・省略条件が一致することを確認し、日本語にだけ条件を追加しない。

P5の差分反映に使えるよう、可能な範囲で胴体・脚・腕等の意味単位に安定したIDを付けて日英の対応を持つ。全文を別々に編集する二重の正本にせず、segmentから表示文を組み立てるか、schemaで一致を検査する。現行30件のsegmentは本文全体1個（ID `pose`）。節ごとの日英対応はP5の残作業とし、英文をカンマで機械的に分割しない。

### 4. catalogと素材contractを決める

`catalog.json` の最低限のfield案:

| field | 内容 |
|---|---|
| `schema_version` | catalog schemaの版 |
| `source_revision` | 元Markdownのrevision |
| `poses[].id` | 汎用で固定のID。分類と動作を用い、代名詞や固有キャラクター名に依存させない |
| `category`, `label_ja`, `label_en` | 分類と選択UI用の名前 |
| `tags`, `search_aliases` | 姿勢を表すtag IDと、検索用の日英の呼び方。生成promptとは別field |
| `source` | source slug、原文、画像・LICENSE manifestへの参照 |
| `pose_template`, `template_revision` | pose-only templateと版 |
| `pose_text_ja`, `prompt_segments` | 編集用の基準日本語と英文との対応。segmentのID・日英の対を保持する案 |
| `normalization_notes` | 取り除いた情報と、接触等の解釈 |
| `supports`, `contact_notes` | 必要な支持物と接触 |
| `asset_revision`, `asset_files` | pose.json / previewの相対pathとhash、任意の派生GLBキャッシュ |
| `production_status` | 未制作／制作中／制作済み |
| `review` | 未確認／要修正／確認済み、確認者・日付・根拠。利用者確認は別field |
| `approximation_notes`, `image_reference_eligible` | 大まかな3Dで省略した詳細と、撮影画像参照に使えると確認した範囲。未確認を自動でtrueにしない |

制作前の項目は `asset_files` を欠落可能とし、状態で明確に区別する。文章が使える状態、3Dを表示できる状態、撮影画像を参照として送れる状態を分け、各操作に必要なfile・hash・確認記録を検査する。pose別GLBの存在を必須にしない。IDは公開後に表示名の変更で変わらない。

`pose.json` は、base hash、rig signature、bone名・local transform、root transform、足裏・座位等の接触基準点、支持物、比較用camera、比較結果を持つ。共通rigへ適用する値を正本とし、派生GLBは再生成可能なキャッシュとする。cameraはbody poseと分離し、座標系・単位・rotation形式・rest pose基準をP2で確定する。素材制作用の仮座標は保存してよいが、利用者確認を得た後のrevisionだけを確定座標とする。

作品内の保存型は `humanPoseTypes.ts` の `HumanPoseTextSelection` と `HumanPoseSceneSettings` を正本とする。`input_mode`・基準日英・編集日本語と、optional `scene` の配置/camera/素材識別子は実装済み。接地先・座面、送り方切替UIとQwen送信はP5に残る。`prompt` を初期値とし、既存Qwenの `mode: 'new' | 'paint'` と混同しない。画像モードで使わない編集日本語も保持する。実際に送るpose画像は撮影camera・縦横比・配置・素材revisionを含めて再現可能にし、文章モードのrequestには含めない。

将来のネームからの3D推定へ備え、採用30件の共通catalogと、作品内の各人物に採用されたposeの実体を区別する。初期版はcatalog IDを使うが、将来も必ずその30件だけを要求する契約には固定しない。ネーム推定・別イラストによる再推定・手動編集も同じpose形式へ接続できるか確認する。元画像／コマ／人物との対応、base・rig、pose revision、確認状態を追える形を目指す。人物ごとの修正で共通catalogの素材を上書きしない。推定方式や保存先の詳細は、技術公開後の拡張計画で確定する。

### 5. 日本語キーワード検索の辞書を作る

検索は、採用30件をclient内で走査する既存キーワード方式を使う。検索server・vector database・embedding modelを追加しない。入力語の同義語展開は既存の検索設計でも使われる方法であり、[Elasticの公式資料](https://www.elastic.co/docs/solutions/search/full-text/search-with-synonyms)を考え方の参考にする。Elasticsearch自体は導入しない。

- 各poseへ、基本姿勢（座位・立位など）、脚（膝を重ねる・足首を交差など）、腕、体の向き、支持物を表すtagを、英文と3Dの実際の内容を確認して付ける。
- 共通tag辞書に表示名と同義語をまとめる。例: `座る／座り／座っている／sitting／seated`。pose固有の呼び方だけを `search_aliases` に置き、同じ語彙を各poseへ重複定義しない。
- 「腰掛ける」は座面のある姿勢、「あぐら」は床などで脚を組む姿勢として区別する。「足を組む」の広い検索では該当する種類を拾い、「椅子」「あぐら」「足首」等で絞れるようにする。単語が近いだけで同義語にしない。
- 検索対象は日英の名前、確認済みtag・alias、承認済み英文 `pose_normalized_text`。現行英文に含まれる顔・目線の記述も検索対象となる。研究資料の元全文や除去理由等のメモは対象外。既知のtagに対応する語はtag一致を優先し、英文の単純な部分一致で意味を覆さない。
- Unicode NFKC、英字小文字、空白の正規化を行う。同義の語は同じ概念へ変換し、異なる条件はANDで絞る。`座る 足を組む` は両条件を満たす項目、`座る` 単独は座位の候補を返す。
- 「足を組む」のような複合語を一つの意味として扱い、登録したphraseを長いものから認識する。日本語全文の自由な構文解析までは約束せず、空白区切り入力と候補tagのボタンを基本操作にする。
- 未認識の語を黙って捨てない。名前・alias・pose英文の一致も調べ、見つからない場合は0件と、条件を外す手段を示す。全条件一致の結果へ、片方だけ合う候補を混在させない。
- 絞り込んだ候補内では、名前の完全一致、tag/alias一致、英文一致の順を基本に、同点は固定の並び順で表示する。検索語・タグ・同義語は生成promptに自動追加しない。

辞書の保存は `catalog.json` 内の共有tag定義を第一案とする。個別poseはtag IDを参照する。実装前に既存の文字列正規化処理を比較し、検索用の最小関数を決める。

### 6. 比較入口を作る

- 研究用 `review/index.html` は68件の英文と元2画像の取得記録として保持する。現行30件は確認済み元PNG・日英文・3Dを対応させ、選択UIの猫イラストとは用途を区別する。採用素材に存在しない研究画像を要求しない。
- オフラインで読める形を優先し、外部CDNに依存しない。ファイル直接表示でfetchが使えない環境にも対応する静的生成方式を検討する。
- 原文と除去後の差は展開して確認できるようにする。未制作の3Dを「取得失敗」と表示しない。

## 編集候補

- 新規素材: `.human_pose/catalog.json`、`.human_pose/sources/`、`.human_pose/poses/*/references/`、`.human_pose/review/`。
- 制作処理の新規候補: `scripts/human_pose/import_study.py`、`scripts/human_pose/validate_catalog.py`、`scripts/human_pose/build_review.py`。
- schema・共通型・テストの配置は既存構成と比較して決める。`.gitignore` は必要な場合だけ追加する。
- 上記は候補。実装着手前に実際のファイル名を確定してclaimへ登録する。

## 検証と完了条件

- 採用30件のID・番号・日英文・出典・姿勢・元PNGが一対一に対応する。研究68件/136画像の取得検証は過去の記録として保持し、研究素材の3D制作を追加条件にしない。
- 確認済みの日英文を保持し、顔・目線・画面左右の混在はP5で区分と優先順位を確認する。全30件の日英が同じ姿勢を表すことと、差分修正対象のsegmentを識別できることを確認する。
- 支持物、頭の回転、手足の接触が必要な項目では、姿勢の意味を失っていない。
- 「座る」「座り」「sitting」、複数条件、「足を組む」の下位分類、未認識語、0件、空検索について、期待するID集合をcatalog確認時に作る。検索実装と同じ処理で期待値を自動生成しない。
- schemaで不正ID、未知token、欠けた参照、root外のpath、制作状態とファイルの矛盾を検出できる。
- 共通素体＋pose.jsonで復元でき、pose別GLBなしでも正規の素材として扱える。仮座標・利用者確認済み座標と、画像参照の可否を区別する。
- 2つの送り方、3Dでの配置、撮影camera、文章編集の保存先が明確で、切替時の送信対象と保存対象の違いをP5へ渡せる。
- 同じrevisionへの再実行が既存確認記録を消さず、差分と取得失敗を報告する。
- P2へ素材schema案と座標系で決める項目、P3へpose IDと参照、P4へ全token一覧を渡す。P2で座標系・rig契約を確定してschemaへ反映する。制作未着手の項目を確認済みにしない。
