# ポーズ編集用リグの操作修正（2026-10-09）

利用者から、骨が引き離せること、腕や脛の途中に関節が見えることを指摘された。元koyukiにも同じ設定があり、利用者の依頼で元ファイル・共通素体・6姿勢の編集ファイルを修正した。役割のある骨は削除・結合しないという指定を守り、163本すべてとその親子関係・rest行列・ウェイト・49個のshape keyを保持した。

## 操作

- ポーズモードで色付きの長い骨を選び、`R`で回す。肩→肘→手首、股関節→膝→足首の位置で動く。
- 全身の移動は腰の`root`を選んで`G`。他の骨は移動と拡縮をロックする。
- `*02`の8本は、ねじりを分担する補助骨として「補助骨（ねじり専用）」コレクションに保持する。通常は非表示。表示すれば選択でき、`R → Y → Y`で長軸まわりにねじれる。曲げに相当するX/Zだけをロックし、Y/Wは残す。
- 手の指も回転で編集できる。顔・足指は「顔・足指（詳細）」を表示する。操作説明を各blend内のテキスト「ポーズの操作方法」に同梱した。

IKは追加していない。手足をGで移動して自動的に肘・膝を解く操作ではなく、既存のFKで関節を回す。

## 変更と配置

端の位置が一致していた133本だけを接続した。離れた位置に親を持つ骨は接続で移動させず、移動ロックで誤操作を防ぐ。既存の`*01`に関節間を覆う表示形状を付けたため、途中の補助骨を肘・膝と取り違えずに選べる。表示用8オブジェクトはsceneにリンクせず、boneの参照からblendに同梱される。新しい骨・constraint・driverは追加していない。

- 共通処理: `scripts/human_pose/editable_rig.py`。既存`build_pilot.py --editable`から使用する。
- 既存ファイルの修正: `repair_editable.py --source <入力blend> --output <未作成の別blend>`。入力を上書きせず、保存前後の検査結果を記録する。
- 新しい6姿勢: `.human_pose/review/editable-rig-20261009/<standing|wall|pole|seated|squat|lying>/editable.blend`。revision 18の実ファイルを入力とし、姿勢を作り直していない。旧ファイルはそのまま残した。
- 共通素体: `.human_pose/models/human_base.blend`を検証済みファイルへ置換し、metadataのblend hashとinspectionを更新。GLB・rig契約・catalogはhash一致で不変。
- 元koyuki: `../tori29umai-pose-pipeline-experiment/outputs/body-prototype/koyuki-5_7-heads/koyuki-5_7-heads-rigged.blend`を同様に置換。変更前のblend・生成スクリプト・READMEは同folderの`editing-repair-20261009/`にhash付きで退避。
- 原本生成入口`../tori29umai-pose-pipeline-experiment/pipeline/create_body_prototype.py`も同じ共通処理を読み込む。コードの複製は作らず、隣接する正本`Comic_image_Hub`のhelperを生成時だけ参照する。保存済みblendを使う際の外部依存はない。元の体型生成自体は今回実行していない。

元koyukiの変更前hashは`da99e95bbc7fc0f801f2689742adf845de8475cf25f4d193de0ee4a143973cad`、修正後は`c95c704b46dc5b423397362b638e05b1187464a6db0caea5b3983492d950af60`。共通blendは`0fe4907c…`から`c2c72f7e…`へ変更。共通metadataの`source_sha256`は初回派生時の入力記録なので書き換えず、`editor_repair`に今回の変更と復旧先を追加した。

## 検証

- 8ファイルで全骨名・親・rest・元mesh・全ウェイト・shape keyの一致を検査。関節接続に伴う浮動小数の残差を除き姿勢保持。評価後の最大頂点差は6姿勢で1.539µm未満、元koyukiと共通素体は0。最終表示設定の保存前後も0。
- 各ファイルの左右の上腕・前腕・太腿・脛の計8か所を25度回転。操作する関節は固定され、補助骨との相対行列は一定、骨の接続部の隙間は0。
- 各ファイルの補助骨8本を25度ねじり、頭・尾が動かずskinが変形することを検査。Y方向の機能を失っていない。
- 全ファイルを再読み込みし、ポーズモード・表示形状・データ保持を確認。保存TRSの往復誤差は0.845µm未満。
- Blender画面で`lowerarm01.R`をRで回し、肘を中心に前腕が動くこと、Gで引き離せないことを確認。補助骨を一時表示し、`lowerarm02.R`の`R → X → X`は曲がらず、`R → Y → Y`では手の向きが変わることを目視した。検査中の操作は保存しない。
- 修正済み共通素体から6姿勢のJSONを再適用し、既存14,677頂点と最大1.539µm未満で一致。編集設定の2回適用で追加変形0、widgetは8個のまま。支持物作成と既存`save_editable`も成功。
- 修正済みkoyukiのポーズモード保存から既存GLB書出しに成功。mesh 1個・skin 1個・163 joints、表示用widgetの混入なし。`export_runtime`とpilotの開始時にOBJECTモードへ戻す。
- 関連Pythonテスト36件がPillow入り既存環境で全件成功。標準Pythonは36件中13件skip。

証跡は`.human_pose/review/editable-rig-20261009/`の`final-validation.json`、各`editable.validation.json`、`pipeline-validation.json`、`installed.json`。入力・出力・backupのhashも記録した。原本側はGit管理外なので同folderの`backups.json`で復旧元を照合する。

今回の完了対象は編集操作の修正。座位・しゃがみ・仰向け等の構図調整や、深い膝曲げの表面品質、P3の素材採用は別途利用者確認が必要で、採用済みにはしていない。

## 編集リンクの再確認（同日）

「立ち姿勢以外は未接続に見える」との報告を受け、保存済み6ファイルを再読み込みした。すべてediting version 1・163骨・133接続・非root移動lock・表示形状8個・ポーズモードを確認。Blenderのファイル選択画面の直前の参照先は修正前の `pilot-18/lying/` で、旧一覧の6つの編集リンクも `pilot-18` を指したままだった。修正版の寄りかかり・支柱は実画面でも表示を確認した。

旧 `pilot-18/編集用リンク.md` の6つのBlenderリンクを修正版へ更新し、新旧両一覧に保存先の違いを明記した。以前の会話にある `.blend` への直接リンクは変えられないため、今後は修正版一覧または `editable-rig-20261009` のファイルを使う。今回blend本体は書き換えていない。
