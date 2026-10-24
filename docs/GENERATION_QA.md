# Deterministic generation QA

`scripts/generation_qa.py` は、生成済みの `manga_base_composite` PNGをローカルで決定論的に検査するB003 coreです。ComfyUIのjob制御、artifact resolver、bridge route、UI、VLM workerには接続していません。画像の生成、補正、外部送信、model実行も行いません。

このQAの合格は「機械的なartifact契約に違反していない」という意味です。構図、人物同一性、絵柄、内容の正しさを保証しないため、最終的な採否は人間が確認します。

## Artifact contract

呼び出し元は `ArtifactExpectation` に次の不変値を渡します。

- `job_id` と `attempt_id`
- artifactとsource snapshotの小文字SHA-256
- `role=manga_base_composite`
- `media_type=image/png`
- 期待width/height（既定512×512）
- `profile=manga-base`
- `palette_version=manga-base-v1`

coreはbrowserからpathを受けません。直接利用時も、通常fileのみを読み、symlinkと20 MiB超のfileを拒否します。PNG signature、chunk境界、chunk typeのreserved bitと未知critical chunk、CRC、先頭の単一IHDR、1個以上のIDAT、空の終端IEND、IEND後の余剰byteなしを確認し、APNG chunkを明示的に拒否してからPillowでverify/reopen/loadします。画像は単一frameのRGBで、全pixelが次の完全一致4値paletteに属する必要があります。

| Slot | RGB |
| --- | --- |
| ink | `(0, 0, 0)` |
| dense tone | `(230, 0, 18)` |
| light tone | `(0, 215, 232)` |
| paper | `(255, 255, 255)` |

artifact SHA-256に加え、`width + height + RGB mode marker + decoded RGB bytes` の `pixel_sha256` を記録します。これにより、同じpixelを異なる圧縮やmetadataで保存したcontainerを区別しつつ、decoded pixelの同一性も比較できます。metadata chunkは種類だけを記録し、本文はreportへ複製しません。

## Metrics and findings

閾値判定は丸めた表示値ではなく、整数pixel数の正確な比率で行います。reportの比率は表示・schema用に小数点以下8桁へ丸めます。connected componentは8-neighborで固定します。

| Check | Default threshold | Result |
| --- | --- | --- |
| Nearly blank | content / all pixels ≤ 0.002 | warning |
| Nearly filled | content / all pixels ≥ 0.98 | warning |
| Low ink | ink / all pixels ≤ 0.0005, when content exists | warning |
| Tiny component | area ≤ 3 pixels | metric |
| Speckle noise | tiny-component pixels / content pixels > 0.02 | warning |
| Edge band | 2% of shorter side, minimum 1 pixel | metric |
| Edge contact | content fills ≥ 0.8 of any side band | info |

`error` はhash、PNG構造・decode、frame、寸法、mode/alpha、exact palette、再合成の不一致です。1件でもあればstatusは `fail` です。errorがなくwarningがあれば `warn`、infoだけまたはfindingなしなら `pass` です。warning/infoは自動修正や自動採用をせず、人間が確認する診断情報です。

`analysis_key` はartifact契約、rubric version、閾値そのもの、implementation versionから作るidempotency keyです。`metrics_sha256` はtimestampやlibrary versionを除外し、artifact hash、rubric、status、metrics、finding semanticsからcanonical JSONで計算します。baseline読込時は両digestとbatch全体の `batch_sha256` を再計算し、古い値や改変された内容を比較へ使いません。

## Schemas and comparison

`schemas/generation-qa-*.schema.json` はJSON Schema Draft 2020-12です。

- `generation-qa-report-v1.schema.json`: 1 artifactのQA report
- `generation-qa-comparison-v1.schema.json`: report間の意味的比較
- `generation-qa-fixture-manifest-v1.schema.json`: project-generated fixture manifest
- `generation-qa-fixture-provenance-v1.schema.json`: fixture generatorと外部asset/model境界
- `generation-qa-batch-v1.schema.json`: batchとbaseline比較

すべてのcontract objectは未知fieldを拒否します（findingの `actual` / `expected` payloadだけは値の型を限定しません）。外部URLを解決する `$ref` は使わず、batch schemaの参照先も同じdirectoryのlocal schemaです。生成処理は固定field contractとcanonical digestを自身で検証し、test/CIでは既存標準実装の `jsonschema>=4.26,<5` でも全schemaと生成instanceを検証します。`jsonschema` はPython 3.10以上対応・MITで、アプリruntimeやbrowser bundleには入りません。

DeepDiffは導入しません。比較対象をartifact contract、rubric compatibility、固定metric path、findingの `code/severity/metric/actual/expected` に限定し、canonical JSON + SHA-256と専用comparatorで差を出します。timestamp、Python library version、finding messageだけの差はsemantic regressionにしません。互換性のないrubric/profile/dimensionはmetric差として混ぜず、`incompatibilities` に分離します。

## Synthetic fixtures

`tests/fixtures/generation_qa/build_fixtures.py` はPillowの描画primitiveだけでfixtureを生成します。写真、漫画原稿、外部asset、model、networkを使いません。正常4値、白黒、threshold境界、speckle、edge、metadata、off-palette、RGBA/alpha、P mode、寸法差・安全上限超過、truncated/CRC/signature、IEND後payload、APNGを含みます。

`manifest.json` は各PNGのartifact SHA-256、generator sourceに結び付くsource snapshot SHA-256、期待status/finding、pixel semanticsを記録します。`provenance.json` はgenerator hash、project root `LICENSE` に基づくMIT、外部asset/model/networkなしを明記します。testは全caseのsource snapshot SHA-256をgenerator version/hash/case IDから再導出します。Pillow/zlib versionにより再生成したPNG container bytesは変わり得るため、checked-in byte hashに加えて再生成後のdecoded pixel semanticsも確認します。

fixtureを更新する場合は、画像依存が揃った既存local environmentを明示して実行します。新しい環境やmodelを自動作成・取得しません。

```sh
NYAMURU_QA_PYTHON=/path/to/existing/python
"$NYAMURU_QA_PYTHON" tests/fixtures/generation_qa/build_fixtures.py
```

## Batch CLI

batch CLIはfixture manifestをcase ID順に評価し、期待結果との一致、exact-byte duplicate、任意baselineとのsemantic差をJSON/Markdownへ原子的に保存します。manifestとPNGは同じdirectoryに置き、filenameだけを指定します。directory traversal、symlink、重複case/file、未知fieldを拒否し、manifest・baseline・JSON・Markdownに同じpathまたはhard linkを指定して入力や別出力を上書きすることも拒否します。

```sh
NYAMURU_QA_PYTHON=/path/to/existing/python
"$NYAMURU_QA_PYTHON" scripts/generation_qa_report.py \
  --manifest tests/fixtures/generation_qa/manifest.json \
  --json-out /tmp/generation-qa.json \
  --markdown-out /tmp/generation-qa.md

"$NYAMURU_QA_PYTHON" scripts/generation_qa_report.py \
  --manifest tests/fixtures/generation_qa/manifest.json \
  --baseline /tmp/generation-qa.json \
  --json-out /tmp/generation-qa-next.json
```

exit codeは、期待結果とbaselineにregressionがなければ0、差があれば1、input/environment errorなら2です。outputを指定しない場合はcanonical JSONをstdoutへ出します。

## Test boundary

依存なしのsystem Pythonでもcanonicalization、schema構造、manifest hash、strict PNGの早期拒否、semantic comparatorを実行できます。Pillow/numpy/OpenCVがあるPythonでは全画像metric、fixture再生成、batch/baselineまで実行します。

```sh
python3 -m unittest tests/test_generation_qa_bridge.py

NYAMURU_QA_PYTHON=/path/to/existing/python
"$NYAMURU_QA_PYTHON" -m unittest tests/test_generation_qa_bridge.py
```

test filenameは既存の `test_*_bridge.py` discoveryへ入ります。Fork CIは `requirements-qa.txt` を明示installし、全依存のimport smokeを通したうえで `NYAMURU_QA_REQUIRE_DEPENDENCIES=1 npm test` を実行します。この環境変数下では画像依存またはDraft 2020-12 schema依存が欠けるとtest moduleの読込時点でhard-failするため、依存不足をskip成功として扱いません。依存を入れていないsystem Pythonでのskipは、localの構造test専用経路に限ります。

現在のlocal setupが受け付けるPythonは3.10〜3.13です。この実装ではsystem Python 3.14で依存なしtest、既存ComfyUI Python 3.11でfull image testを確認します。別versionでのfull image QAは実測せずに対応済みと扱いません。

## Future B002 resolver contract

B002接続は未実装です。接続時はbrowser/UIからfile pathやimage bytesを渡さず、`job_id + attempt_id + artifact_sha256 + expected_omny_sha256 + expected_plan_sha256 + expected_workflow_sha256` の6値だけをbridgeへ渡します。server-sideでは `PanelDraftLedger.resolve_succeeded_artifact()` を唯一のartifact resolverとして使い、次を満たす場合だけ不変artifactと入力snapshotのverified bundleをcoreへ渡します。

1. job/attemptが存在し、artifact stateが `succeeded` である。
2. roleが `manga_base_composite` で、artifact pathが許可root内の通常fileである。
3. OMNY、plan、workflowの各snapshot SHA-256が要求値と同じattemptのledger値へ同時に一致する。
4. outputと3 snapshotを読み出した直後のSHA-256、media type、寸法、profile、palette versionが各ledger契約に一致し、`source_snapshot_sha256` は検証済みOMNY snapshot SHA-256と一致する。

B002のqueue/historyは補助観測であり、ledgerのartifact契約を置き換えません。timeout/cancel後やComfyUI状態が不明なjobを成功へ推測せず、QAも `unknown/not-run` のままにします。同じ不変artifactへのretryは `analysis_key` でidempotentにし、job/attempt、retry count、artifact、OMNYを変更しません。deterministic QA reportはartifact hashに結び付くappend-only sidecarとして保存します。

## Future VLM boundary

VLMはこのcoreから呼びません。将来追加する場合も、deterministic QAのfinalizeやpage loadをtriggerに自動実行せず、人間が専用操作を明示した場合だけ別endpointでlocal VLM candidateを生成します。

- 入力はB002 resolverで再検証した不変artifactだけにする。
- outputは `observed`（画像から直接確認できた事実）と `inferred`（解釈・推測）をschema上も分離する。
- candidateはartifact hashに結び付くappend-only sidecarにし、deterministic report、job状態、OMNY、retryを変更しない。
- 外部送信、auto-download、auto-training、auto-acceptを行わない。
- 採用、却下、修正は人間のreview mutationとして別記録にする。

この境界を実装するまで、B003 coreの公開API、bridge route、UI、VLM workerはTODOのままです。
