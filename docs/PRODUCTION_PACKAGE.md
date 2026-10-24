# Nyamuru制作package core

Nyamuru制作packageは、OMNY・OMAY・選択した制作素材を、BagIt 1.0準拠の検証可能なdirectoryへまとめるローカル機能です。制作素材は再解釈せずbyte-for-byteでcopyし、`nyamuru-manifest.json` v1へSHA-256とSHA-512を記録します。

この範囲はPythonのplan/export/validate coreと、TypeScriptのplan正規化・選択helperです。local bridgeや画面からは呼び出しません。

## Optional dependency

plan作成に追加packageは不要です。exportとvalidateには`bagit-python` 1.9.0を、実際にcoreを実行するPython環境へ明示的に導入します。Nyamuruは安全なdirfd境界内でBagIt 1.0 envelopeを生成し、`bagit-python`を独立validatorとして使います。

```sh
python3 -m pip install -r requirements-package.txt
```

この依存は自動導入・vendoring・web bundleへの同梱を行いません。未導入時も`ProductionPackageCore.plan()`は動作し、`export()`と`validate()`は導入方法を含む`BagItUnavailable`を返します。`bagit-python`は米国議会図書館がPublic Domainとして公開しています。配布境界は`public/THIRD_PARTY_NOTICES.txt`にも記載します。

## Plan

`ProductionPackageCore.plan(workspace)`は次の3directoryだけを再帰検査します。

- `name_data/`
- `draft_data/`
- `manuscript_data/`

`export_data/`やworkspace直下の任意fileは候補に含めません。管理directory内にsymlink、device、socket、FIFO、またはworkspace外を指すpathが1つでもある場合、曖昧な候補一覧を返さずplan全体を拒否します。

候補は相対path順で、role、media type、byte size、SHA-256、SHA-512を持ちます。候補全体から`plan_revision`を作るため、内容・path・roleのいずれかが変化するとrevisionも変わります。PSD/PSBは解析せず`editable_psd`として扱います。

```python
from scripts.nyamuru_production_package import ProductionPackageCore

core = ProductionPackageCore()
plan = core.plan("/absolute/path/to/workspace")
```

TypeScript側では、未知fieldや不正hashを受理せず正規化してから、hash固定のselectionを作ります。

```ts
const plan = normalizeProductionPackagePlan(response);
const selectedFiles = buildProductionPackageSelection(plan, selectedRelativePaths);
```

## Export

exportはplanを同じworkspaceから作り直し、呼出側の`plan_revision`と各selectionのSHA-256/SHA-512が一致した場合だけ開始します。OMNYとOMAYはUTF-8 snapshotとして必ずpayloadに入り、選択したPSDなどの制作素材は元bytesをそのままcopyします。

```python
result = core.export(
    workspace,
    plan_revision=plan["plan_revision"],
    selected_files=[
        {
            "relative_path": candidate["relative_path"],
            "sha256": candidate["sha256"],
            "sha512": candidate["sha512"],
        }
        for candidate in plan["candidates"]
    ],
    omny_yaml=omny_text,
    omay_yaml=omay_text,
    document={
        "title": "第1話",
        "series_id": "series-example",
        "episode_id": "episode-001",
        "episode_number": 1,
    },
)
```

生成処理はworkspaceと`export_data/`を`O_DIRECTORY | O_NOFOLLOW`で一度だけ開き、以後のsource走査、copy、staging、cleanup、publishを保持済みdirfdからの一component操作に固定します。検査後に可変pathnameを開き直しません。BagIt生成後は、実`bagit-python`とNyamuru manifestによる完全検証をno-replace renameの直前と直後に行います。その間にpayloadやdirectory identityが変化した場合は成功を返さず、この呼出しが作成した木だけを片付けます。macOSでは`renameatx_np(RENAME_EXCL)`、Linuxでは`renameat2(RENAME_NOREPLACE)`を同じexport dirfdに対して使い、利用できないOSでは安全性を下げた代替処理をせずexportを拒否します。

`bagit-python` 1.9.0の`make_bag()`は`BagIt-Version: 0.97`を生成するため、Nyamuruはそのpath-only生成APIを使用しません。header、payload manifest、tagmanifestをfd相対でBagIt 1.0として生成し、保持済みpackage fdを隔離したvalidator processへ渡して同じ`bagit-python`の完全検証を行います。実dependency testは`bagit.txt`と`nyamuru-manifest.json`のversionがともに1.0であることを直接確認します。

最終名は`<title>-<UTC timestamp>.nyamuru-bag`です。同名pathがある場合は上書きも自動suffix付加も行いません。再度planを確認して別の時刻で実行します。処理失敗時は、作成時に記録したdevice/inode/typeが一致する、この呼出し所有のentryだけを保持済みfdから削除します。staging名が別entryやsymlinkへ交換されていた場合、その置換物には触れません。元staging自体が未知の名前へ移動済みなら、内容を安全に空にしても名前を推測して削除せず、空directoryを残すfail-closed動作になります。

## Package layout

```text
<title>-<UTC timestamp>.nyamuru-bag/
├── bagit.txt
├── bag-info.txt
├── manifest-sha256.txt
├── manifest-sha512.txt
├── tagmanifest-sha256.txt
├── tagmanifest-sha512.txt
└── data/
    ├── nyamuru-manifest.json
    ├── name/document.omny.yaml
    ├── style/document.omay.yaml
    └── workspace/
        ├── name_data/...
        ├── draft_data/...
        └── manuscript_data/...
```

BagIt payloadはopaque octetsとして扱います。PSD/PSBをparse、flatten、preview生成、再保存しないため、入力fileとpackage内fileのbytesおよび両hashが一致します。

`nyamuru-manifest.json`は次を記録します。

- schema versionとkind
- UTC作成日時
- BagIt versionと必須hash algorithm
- document title、任意のseries/episode識別子、OMNY/OMAY payload path
- 各payloadのrole、path、media type、byte size、SHA-256、SHA-512
- workspace由来payloadの元相対path

machine-readable schemaは`schemas/nyamuru-package-v1.schema.json`です。

## Validate

`ProductionPackageCore.validate(package_directory)`は`bagit-python`の検証に加えて、Nyamuru manifestのv1 field、payload path、role、size、両hash、OMNY/OMAY参照、data内の未掲載fileを検査します。package directory、data directory、payloadのsymlinkや特殊fileも拒否します。

```python
validation = core.validate("/absolute/path/to/package.nyamuru-bag")
```

## Tests

追加downloadなしでcore境界を確認できます。

```sh
python3 -m unittest discover -s tests -p 'test_production_package_core.py'
node --no-warnings --experimental-strip-types --test tests/productionPackage.test.mjs
```

Python testsは合成OMNY・PNG・PSD bytesとBagIt test doubleを使い、安全path、管理対象限定、plan再確認、非上書き、byte同一性、両hash、改ざん拒否を検証します。`bagit-python`が実行環境に存在する場合だけ、同じtest fileの実BagIt round-tripも動作します。

標準の`npm test`からも`productionPackage.test.mjs`経由でPython core testsを実行します。
