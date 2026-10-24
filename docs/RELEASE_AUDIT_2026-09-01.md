# Release Integration Audit — 2026-09-01

## 結論

`feature/vector-bubble-tails`を現在の`main`へ一括fast-forwardしない。

履歴は直線で重複patchもありませんが、editor、scanner、ComfyUI、VLM、人物台帳、workspace永続化、NDM schemaが114commitに連続して積み上がっています。外部runtimeと永続化を含む後半は、unit test成功だけでrelease可能とは判定できません。

先に副作用のないCIとagent調整ルールを`main`へ入れ、その後は次の3 gateを分けて検証・reviewします。ただし、現feature履歴では後のgateが前のgateのcommitを含むため、3 laneを互いに独立して統合できるという意味ではありません。統合はcore → local AI → character/workspaceの累積順です。

1. Core editor
2. Local AI runtime
3. Character / workspace persistence

## 監査snapshot

| Item | Value |
|---|---|
| Base | `main` = `68aaf0b` |
| Audited feature head | `feature/vector-bubble-tails` = `4f636b8` |
| Commit count | 114 |
| Diff | 124 files, +23,979 / -1,424 |
| History shape | merge commitなしの直線履歴 |
| Patch duplication | 114commit内に同一patch-idなし |
| Package version | `1.13.2`, `versionCode: 21` |
| NDM at audited head | `10.33` |
| CI result | CI milestone on `main` = `3683c1f`（監査文書を除く4commitを統合） |

当初監査から除外した`NYA-20260901-0925-series-source-split`は`4f636b8`で完了し、8file、+523/-26の追加監査を実施しました。これはrelease承認ではなく、character/workspace laneの追加gate対象です。

remote refはこの作業開始時のローカルsnapshotです。fetchやpushは行っていません。

このsnapshot確定後に`NYA-20260901-0951-folder-autofill`が`4f636b8`をbaseとして開始されました。未commit変更は本監査へ含めず、result commitが出た場合はcharacter/workspace endpointの再監査対象にします。

## Release lane 0: independent safeguards

| Change | Commit | Decision | Gate |
|---|---|---|---|
| Fork CI、release boundary、OSS公開checklist | source `0ac2a13`, `0b21e26`, `8585ab5`, `d1784a0`; main `7abb335…3683c1f` | `SHIP` | Product/AI review承認、main上の`npm run verify`、workflow YAML、Node 24 Action runtime、clean tree |
| 共有agent掲示板へのrepository導線 | source `e1fe93a`の`AGENTS.md`差分; main `c5c9a28` | `SHIP` | Product review承認、調整章8行だけを独立適用、`git diff --check` |

CIと掲示板導線はapplication runtimeやschemaを変更せず、他のfeature群より先に`main`へ統合済みです。

## Release lane 1: core editor

候補endpointは`7f968fc`です。次のgroupを順番どおり一体で評価します。

| Group / commits | Key paths | Direct dependency | Existing tests → additional gate | Decision |
|---|---|---|---|---|
| 人物切り抜き・panel topology<br>`2c8d6b4…69e93b1` | `analogFigureCrops.ts`, `figureCropStore.ts`, `MangaCanvas.tsx`, local bridge | `main`のanalog import | `analogFigureCrops`, `panelTemplates`, `localBridge`, scanner Python → ownership付きscanner fixture | Ship candidate |
| 文字資料・所有関係・bubble基本修正<br>`009d428…7c3a7a2` | `analogTextCrops.ts`, `bubbleRelations.ts`, `PanelInspector.tsx`, local bridge | 前groupのcrop/topology | `analogTextCrops`, `bubbleRelations`, `bubbleDeliveryPresets`, `canvasLayering`, scanner → panel/bubble/figure所有関係fixture | 前groupと同時 |
| page foreground・複合人物・panel split<br>`3501501…d4e2095` | `PageOverlayInspector.tsx`, `panelTemplates.ts`, `figureCropStore.ts`, schema docs | scanner所有関係 | `canvasLayering`, `panelTemplates`, `figureCropStore`, scanner → split→save→reload | 追加fixture後 |
| spread既定・page rail・設定UI<br>`0c5056c…4ab46df` | `App.tsx`, `PageSidebar.tsx`, `MangaCanvas.tsx`, docs | panel split UI | `pageSpread`, `ndmMetadata` → browser smoke | browser gate後 |
| series/episode素材・catalog・OMNY同期<br>`cf21f3d…49e9b03` | `seriesCatalog.ts`, `PanelInspector.tsx`, `manga.ts`, OMAY/NDM docs | editor UI | `seriesCatalog`, `panelMaterialLinks`, `omay`, `ndmMetadata`, scanner → 旧OMNY/catalog round-trip | 条件付き |
| figure / prop配置UI<br>`fe4656e…c3d9ca1` | `PanelInspector.tsx`, `PageOverlayInspector.tsx`, `manga.ts` | 素材catalog | `ndmMetadata` → browser keyboard/selection | keyboard gate後 |
| analog reference永続化<br>`6242dab` | `figureCropStore.ts`, `App.tsx`, local bridge | 人物・文字crop | `ndmMetadata`, scanner → 実IndexedDB、欠落file、復旧 | Hold寄り |
| catalog internal ID分離<br>`2ccef5a` | `catalogModel.ts`, `seriesCatalog.ts`, `manga.ts`, editor群 | 素材catalog | `catalogModel`, `seriesCatalog`, `panelMaterialLinks`, `ndmMetadata` → 旧data fixture | 必須基盤、fixture後 |
| per-person action提案<br>`c108fbe`, `c520746`, `8000b60` | `panelActions.ts`, local bridge, inspector | catalog internal ID | `panelActions`, `catalogModel`, scanner → browser提案確認 | ID分離後 |
| vector bubble tail・表現推論・panel生成補助<br>`73990b8…9ebb142` | `BubbleShapeSvg.tsx`, `bubbleTail.ts`, `bubblePresentation.ts`, `panelGeneration.ts`, canvas | bubble基本修正、action提案 | `bubbleTail`, `bubbleConnections`, `bubblePresentation`, `panelGeneration`, bridge/scanner → SVG visual、keyboard | 条件付き |
| spread zoom同期・10panel<br>`b2d85f7…7f968fc` | `MangaCanvas.tsx`, `pageSpread.ts`, inspector、docs | vector bubble/canvas | 主に`ndmMetadata` → browser zoom、10panel | 条件付き |

### Required gates

- Node/Python unit test、Astro check、通常/standalone build
- analog scan fixtureのpanel、bubble、figure所有関係
- panel split後の保存・再読込
- 既存OMNY/OMAY、series catalogのround-trip
- IndexedDB画像が欠落した場合のfail-safe表示
- keyboardのみのpanel/bubble/figure操作
- spread zoom、10panel、vector bubbleのbrowser visual確認
- `git diff --check`と公開境界検査

core editorは履歴をcherry-pickで組み直しません。`7f968fc`からrelease-candidate branchを作り、CIと掲示板導線を取り込んだ現在の`main`をそのbranchへmergeしてから検証します。承認後は、そのmerge resultへ`main`をfast-forwardできます。途中groupだけを出す場合も同じ形でcommit境界ごとのrelease branchを作り、後続fixの取り落としを監査します。

## Release lane 2: local AI runtime

| Group / commits | Key paths | Direct dependency | Existing tests → additional gate | Decision |
|---|---|---|---|---|
| 1panel ComfyUI draft・4値rough<br>`f1351e5`, `9c685d2` | `panelDraft.ts`, local bridge, `PanelInspector.tsx` | panel生成補助、local bridge | `panelDraft`, `localBridge`, scanner → 実ComfyUI、timeout、未接続 | `HOLD` / experimental gate |
| analog figure performance VLM<br>`1335b62` | `local_figure_performance_worker.py`, local bridge | analog人物crop、local VLM | Python bridge mock → 実画像・実model・失敗理由 | `HOLD` |

### Required gates

- 現在のComfyUI/VLM接続を読み取り専用で確認
- 利用者が明示的に選んだ画像だけで実runtime test
- model名、workflow、seed、処理時間、timeout、失敗理由を記録
- ComfyUI/VLM未接続時に通常editorが壊れない
- 生成画像を自動採用・自動学習・外部送信しない
- model重みをGitや配布artifactへ含めない

実画像と実modelのgateは利用者の画像選択を必要とするため、unit test成功だけで自動的に`SHIP`へ変更しません。

このgateを`HOLD`したまま後続のcharacter/workspace laneだけを現履歴から統合することはできません。後続commitはこの2groupの子孫だからです。local AIをrelease対象外にしてcharacter/workspaceを先行させる場合は、別branchで依存を意味的に再実装し、同等の全gateをやり直します。

## Release lane 3: character and workspace persistence

候補範囲は`36bbaf4…4f636b8`です。schema、人物画像、series catalog、episode folder、起動時復旧が相互依存するため分割releaseしません。

| Group / commits | Key paths | Direct dependency | Existing tests → additional gate | Decision |
|---|---|---|---|---|
| series人物台帳・人物資料・system mob<br>`36bbaf4…3ac3567` | `CharacterReferences.tsx`, `characterReferences.ts`, `seriesCatalog.ts`, character worker | catalog IDと、履歴上はlocal AI gate | `seriesCatalog`, `catalogModel`, character/scanner bridge → 実filesystem、VLM、backup/restore | `HOLD` |
| 人物照合・新規作成・設定取込<br>`47656ab…51eff80` | `characterMatching.ts`, `settingTextImport.ts`, `App.tsx`, inspector群 | 人物台帳 | `characterMatching`, `settingTextImport`, match bridge → 新規/one-shot/既存series E2E | `HOLD` |
| bridge lifecycle・episode folder・startup・人物text同期<br>`57d14b1…23cd06d` | `local-bridge-supervisor.mjs`, `workspaceStartup.ts`, `characterTextCatalog.ts`, episode workspace bridge | 人物台帳と作成flow | lifecycle/supervisor/workspace/episode tests → 実process crash、再起動、timeout | `HOLD` |
| 人物参照evidence・分類・比較・顔/全身分離<br>`cd53b40…5ab676a` | character worker, `CharacterReferences.tsx`, `characterReferences.ts`, local bridge | workspace、人物台帳、local VLM | character/scanner bridge、series catalog → observed/inferred、途中失敗、draft復旧、実VLM | `HOLD` |
| series共通設定とepisode設定の分離<br>`b7bd9a6` | `manga.ts`, `seriesCatalog.ts`, schema/docs、editor | character/workspace lane全体 | NDM 10.32互換、series設定保持/prefill → 全E2Eと復旧 | 上記と同時に評価 |
| 新規作成時のシリーズ資料復元・episode資料分離<br>`4f636b8` | `App.tsx`, `localBridge.ts`, `settingTextImport.ts`, Python bridge | 人物text同期、episode workspace、`b7bd9a6` | `localBridge`, `settingTextImport`, episode workspace Python → 再起動復元、資料分離、再link、path fail-safe | `HOLD`、lane最終group |

### Required gates

- 新規series、既存series、one-shotのbrowser E2E
- episode folder、series folder、人物text、人物画像の対応確認
- local bridge processの停止、再起動、timeout、途中失敗
- browser reload、破損autosave、欠落file、古いOMNYの復旧
- observed / inferred、未保存draft、複数人物資料の保持
- backup / dry-run restoreでhashと参照整合が一致
- 新規/既存seriesの選択→保存→再起動→復元と、series資料/episode資料の非混線
- series高速切替で古い非同期応答を反映せず、既入力episode設定を上書きしない
- folder/資料の移動・削除・権限喪失時の再linkと、picker cancel時の非変更
- path traversal、symlink外出、5MB超過、不正encodingのfail-safe

## Branch decisions

| Ref | Decision | Reason |
|---|---|---|
| `feature/analog-figure-crops` | merge不要 | `69e93b1`まで現featureへ包含済み |
| `feature/analog-text-reference-font-omny` | merge不要 | `6242dab`まで包含済み |
| `refactor/catalog-identity-adapter` | merge不要 | `2ccef5a`を包含済み |
| `feature/per-figure-actions` | merge不要 | `8000b60`を包含済み |
| `feature/visual-references-vlm` | merge不要 | 監査base `68aaf0b`と同じで、現在の`main`に包含済み |
| `origin/feature/ndm-10.2-omay-split` | merge不要 | `1d1dd2d`まで`main`へ包含済みで独自commitなし |
| `feature/omny-vlm-visual-analysis` | mergeしない | 固有commit `8e4502d`は人物台帳系と意味重複し、9pathが直接競合 |
| `origin/feature/omay-10.5` | 別taskで意味的再評価 | NDM 10.33側と24pathが競合し、通常mergeは危険 |
| `origin/feature/style-transfer-demo` | runtime release後にdocs/demoとして評価 | runtime依存がなく、主な直接競合はREADME |

## Integration order

1. **DONE:** CIの4commitを独立review後、監査文書を混ぜず`main`の`7abb335…3683c1f`へ統合した。
2. **DONE:** `e1fe93a`の`AGENTS.md`差分から調整章8行だけを`main`の`c5c9a28`へ独立適用し、共有掲示板の利用を伝えた。
3. Core endpoint `7f968fc`からrelease-candidate branch/worktreeを作り、更新済み`main`をそのbranchへmergeする。`package.json`等の競合ではCIの`verify`を保持する。
4. browser/E2Eと不足fixtureを追加し、別agent review後にmerge resultへ`main`をfast-forwardする。
5. Local AI endpoint `1335b62`から次のrelease-candidate branchを作り、core統合後の`main`をmergeする。実環境gateが未承認ならここで停止する。
6. Character/workspace laneはlocal AI gateの承認後にだけ、追加監査済みendpoint `4f636b8`から同じ方式でrelease candidateを作る。local AIを飛ばす場合は履歴再構成を別taskとしてreviewする。
7. release用version、versionCode、変更履歴、配布noticeを確定する。
8. cleanな`main`で全検証を再実行し、SHAを記録する。
9. push、tag、GitHub Releaseは利用者の明示承認後だけ行う。

## Current blockers

- release用version / versionCodeが`1.13.2` / `21`のまま未決定・未更新
- browser E2Eが未導入
- ComfyUI/VLMのrelease candidate実機検証が未実施
- 分散永続化の完全backup / restore gateが未実装
- post-audit claim `NYA-20260901-0951-folder-autofill`は未完了・未監査

これらはCI導入自体のblockerではありませんが、114commit全体をrelease済み`main`と扱うためのblockerです。
