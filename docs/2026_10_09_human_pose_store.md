# P5 人体ポーズ素材の読込store

作成日: 2026-10-09 / 状態: 親が全差分をreviewし正本へ統合済み。HTTP/UI/Qwen接続は後続。

## 範囲

`scripts/nyamuru_human_pose_store.py` の `HumanPoseStore(root: Path)` は、固定rootのカタログと登録素材を読み取る。HTTP route、UI、Qwen、サービス起動には接続していない。利用者確認や制作状態を書き換える処理は持たない。

既存のseries背景・人物資料・analog assetの読込口は保存先とIDが専用であり、`.human_pose` を扱わない。このstoreは人体素材の読込だけを受け持つ。親で正本の `.human_pose` をrootに指定し、既存bridgeのorigin確認とtransportから呼び出す。

## 公開method

`catalog() -> dict`

- `catalog`: P1/P2の検証を通したカタログ全体。review/production_status/image_reference_eligibleをそのまま保持する。
- `catalog_sha256`: 読み込んだ `catalog.json` の実bytesのSHA-256。

`asset(pose_id: str | None, kind: str) -> dict`

| kind | pose_id | catalog内の参照 | MIME |
|---|---|---|---|
| `base` | `None` | coordinate_contract.base | model/gltf-binary |
| `rig` | `None` | coordinate_contract.rig | application/json |
| `pose` | 登録ID | asset_files.pose | application/json |
| `preview` | 登録ID | asset_files.preview | image/png |
| `reference_krea` | 登録ID | source.imagesのkrea-2 | image/webp |
| `reference_qwen` | 登録ID | source.imagesのqwen-image-2.1 | image/webp |

返り値は `pose_id`、`kind`、`catalog_sha256`、`mime_type`、`byte_size`、`sha256`、`data`、`usage`。`data` は元bytesのbase64で、data URLではない。JSONも再整形せず、検証したbytesを返す。`usage` は元画像2種が `comparison_only`、他が `pose_asset`。

未登録・欠落・破損・境界違反は `ValueError`。空の成功応答や代替素材へ置き換えない。path、URL、絶対pathを指定する公開引数はない。pose別GLBはcatalogの検証対象になるが、公開kindには含めない。

## 検証と原本保全

- P1/P2の `validate_catalog` をそのまま使用し、原文・source manifest、136画像のhashとdecode、共通GLBとrig、poseの対応、利用者確認の整合を検査する。
- `asset_path` による相対path確認に加え、`generation_store.directory_fd/open_child_directory/read_regular_at` でrootから通常fileまでリンクを追わず読む。
- validatorが使うpath操作だけを実装した内部snapshotを渡す。1回の読込内で取得したbytesを保持し、検証後に同じpathを開き直さない。通常のPath全体や永続cacheを実装しない。
- JSONは16MiB、その他1fileは64MiB、1回の読込合計は256MiB以内。root・fileを作成する経路はない。
- 検証にはPillowが必要。既存のPillow入りPythonを使い、このstoreから環境やモデルを取得しない。

## 検証記録

独立した一時fixtureで、元データ・mtime不変、全6kind、未確認/確認済みの区別、不正ID/kind、未登録・欠落・破損、schema、hash、範囲逸脱、root/中間directory/fileのsymlink、file種別・容量上限、pose/rigの意味、画像decode・WebP形式、検証後差し替え、bridge同様のtop-level importを検証する。固定上流原文のhashだけを合成原文へ置き換え、validator本体はmockしない。差し替え試験だけはvalidator完了後にfixtureを変更するwrapperを使う。

```sh
../ComfyUI/.venv/bin/python -m unittest tests/test_human_pose_store.py
```

store単独16件、既存catalog/rigとの合計31件がすべて成功。標準 `python3` はPillow未導入のため3件成功・画像素材を含む13件skip。新しい依存は導入していない。

親が正本へ統合後、P3の4件を含む関連35件にPillow入りPythonで合格した。`npm run test:human-pose` にstore試験を追加。実catalogは68件、登録した未確認の試作6件すべてについてpose/previewの取得とcatalogのhash不変を確認した。

本物の正本 `.human_pose` は読取専用でcatalog 68件、base GLB 978,588 bytes、rig JSON 78,361 bytes、Krea比較画像1枚の取得を確認した。catalogの全検証はこの環境で約0.28秒。実素材の変更・生成・サービス操作はしていない。

## 親での接続事項

- `usage=pose_asset` は画像生成への採用許可を表さない。catalogの制作状態と利用者確認・image_reference_eligibleをUI/生成側で確認する。未確認素材の内部表示とready表示を区別する。
- 比較用の元画像はQwenのidentity/style/poseへ自動追加しない。
- assetのcatalog_sha256と画面が保持するcatalog_sha256が違えば再読込・確認を促す。revision変更を黙って受け入れない。
- カタログ検証は各呼出しで実施する。UI側で同じ素材を重複取得しないようにし、将来cacheを加える場合もhash・同一bytesの条件を維持する。
- HTTPのbody検証と既存origin gate、bridge stateへのstore組込、clientのbase64/hash検証、Qwenとの結合は未実施。
