# Nyamuru workspace doctor

Workspace doctorは、episode workspaceとapp管理の`series-common`を、書き込みゼロで検査するローカル機能です。既定動作は常に`dry_run`です。破損、期限切れ、孤立の可能性があるdataを移動・削除・修復しません。

bridgeの既存store classはdoctorから呼びません。これらのclassには、初期化時のdirectory作成・SQLite migration・provenance backfill、一覧取得時のdraft復元、復旧履歴のpurgeといった正常な書き込み動作があるためです。doctorは保持したdirectory descriptor以下を独立したread-only readerで走査し、SQLite fileもlive databaseへ接続せず、読み取った不変bytesをmemory上へdeserializeして検査します。

## 実行

```sh
npm run workspace:doctor -- --episode /absolute/path/to/episode
```

省略時はmacOS app support内の`series-common`も検査します。明示的に別rootを指定する場合と、episodeだけに限定する場合は次のとおりです。

```sh
npm run workspace:doctor -- --episode /absolute/path/to/episode --series-root /absolute/path/to/series-common
npm run workspace:doctor -- --episode /absolute/path/to/episode --no-series
```

reportは標準出力へJSONとして返し、workspaceやapp support内へfileを作りません。終了codeは`healthy = 0`、`attention = 1`、`incomplete = 2`です。`incomplete`は検査上限、権限喪失、途中変更、未知schemaなどにより未検査部分が残った状態であり、正常判定ではありません。

reportのmachine-readable contractは`schemas/nyamuru-workspace-doctor-v1.schema.json`です。reportに絶対pathは入れず、rootの表示名とroot内相対pathだけを記録します。

## 検査範囲

episode側では次の4管理directoryだけを再帰走査します。

- `name_data/`
- `draft_data/`
- `manuscript_data/`
- `export_data/`

通常fileはsize、mode、SHA-256をsnapshotに記録します。symlink、別filesystem、device、socket、FIFOは追跡しません。scan中にfileまたはdirectory identityが変化した場合は`not_inspected`として、report全体を`incomplete`にします。

`draft_data/nyamuru/ledger.sqlite3`がある場合は次を追加検査します。

- SQLite `quick_check`と`foreign_key_check`
- schema version、必須column・foreign key・unique/check制約、append-only triggerの実体
- artifact行の安全な相対path、content-addressed file名、size、SHA-256
- filesystem上のartifactと台帳行の欠落・不一致
- attemptの入力snapshot role、成功時の出力role、最新status event
- status event provenanceとreview対象4値artifact

filesystemにだけ存在するartifactは「孤立」と断定しません。`artifact_not_listed_in_ledger`という観測事実と、`possible_orphan_artifact`という人間確認必須の推論を分けて返します。

`series-common`側では、series directoryごとに次を検査します。

- `catalog.json`のJSON object、directory名と`series_id`
- `series.omny.yaml`のUTF-8、5MiB上限、catalog `revision`とのSHA-256一致
- `characters/<character-id>/image-<sha256>.png`のfile名hash、PNG header、寸法上限
- `.drafts`、`deleted-characters`、`character-text-history`の復旧資産

catalogに保存された`series_directory`などの外部pathは、fieldがあるという事実だけを観測します。path値をreportへ含めず、外部fileを`stat`・open・探索しません。復旧資産は期限切れでも削除しません。

browserのlocalStorage / IndexedDB、選択された外部series folder、ComfyUIのqueue/history、汎用filesystem全体はv1の対象外です。これらを含む「完全復旧」をdoctor v1だけで保証しません。

## observedとinferred

`observations[]`はfile type、hash、JSON parse、SQLite検査など直接確認できた事実です。`inferences[]`は必ず1件以上のobservation IDを`based_on`で参照し、`requires_human_review: true`になります。

reportには自動実行可能な`delete_candidate`や修復commandを含めません。未知file・未知schemaを破損とみなさず、意味検査できない範囲は`not_inspected`として残します。

## backup後・restore後の比較

復元前reportを保存し、復元先をdoctorへ渡すと、管理対象fileの追加・欠落・bytes・mode差分を比較できます。

```sh
npm run workspace:doctor -- --episode /absolute/path/to/episode > /safe/report-before.json
npm run workspace:doctor -- --episode /absolute/path/to/restored-episode --baseline /safe/report-before.json
```

`comparison.matches`が`true`になるには、全snapshot entryのroot相対path、size、SHA-256、modeが一致し、現在のscanも完全である必要があります。comparison後も現在のSQLite・参照整合検査を独立して行います。

baselineのsnapshot revisionは保存されたfile一覧から再計算します。revisionを更新しないfile一覧の欠落・改変は`baseline_revision_mismatch`として拒否します。これは誤編集や不完全なreportを検出する整合性checkであり、電子署名や改ざん者に対する真正性保証ではありません。

restoreは既存workspaceへ直接重ねず、新しい空のstaging directoryへ展開してdoctor比較を行います。既存dataとの入替えや昇格は別の明示操作と人間確認を必要とします。

## 一般backup engineは実装しない

暗号化、重複排除、snapshot管理、repository検査、複数backendを備えた一般backup/restoreは独自実装しません。optionalな外部toolとして[restic](https://restic.net/)の導入を提案します。resticはmacOSを含む主要OSをサポートし、incremental・deduplicated backupとrepository check、任意targetへのrestoreを提供します。licenseは公式repositoryの[BSD 2-Clause License](https://github.com/restic/restic/blob/master/LICENSE)です。

resticはNyamuruへvendoring・bundle・自動downloadせず、未導入でもdoctor全機能が動作します。導入時もbackup repository、password管理、backup元、restore先は利用者が明示します。標準的な流れは公式documentの`init`、`backup`、`snapshots`、`check`、`restore --target <new-staging>`を使い、最後にdoctorのbaseline比較を行う形です。

resticの導入と実データbackupは、保存先容量・password保管・対象pathを確認する別taskです。このcoreのtestや通常buildではinstall・network access・実データscanを行いません。

## Test

```sh
npm run test:doctor
```

合成dataだけを使い、tree/SQLite bytes不変、corrupt SQLite、artifact欠落・改ざん・孤立、path traversal、symlink、root差替え、scan中変更、人物画像、復旧資産非削除、baseline比較、strict schema、CLI標準出力を検証します。`jsonschema`が利用可能なQA環境ではDraft 2020-12 schema自体と実reportも検証します。
