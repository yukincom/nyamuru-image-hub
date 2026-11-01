import { beginFigureCropImport } from '../lib/figureCropStore';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Check, FileImage, ScanSearch, Star, Trash2, Upload } from 'lucide-preact';
import type { Character, CharacterRecognitionProfile, MangaDocument, Material, VisualEvidence } from '../types.ts';
import {
  analyzeCharacterReferenceSetWithLocalVlm,
  deleteCharacterReferenceImage,
  loadCharacterReferenceImage,
  saveCharacterReferenceImage,
  type CharacterReferenceSetSuggestion,
} from '../lib/localBridge.ts';
import {
  CHARACTER_RECOGNITION_FIELDS,
  CHARACTER_REFERENCE_VIEWS,
  CHARACTER_REFERENCE_LONG_EDGE,
  CHARACTER_REFERENCE_SHORT_EDGE,
  applySuggestedReferenceView,
  imageFileToPng,
  prepareCharacterReferenceDestination,
} from '../lib/characterReferences.ts';
import { newCatalogId } from '../lib/catalogModel.ts';
import { currentEpisodeOrigin } from '../lib/seriesCatalog.ts';
import { TextListEditor } from './Fields.tsx';

interface Props {
  document: MangaDocument;
  character: Character;
  onChange: (document: MangaDocument) => void;
  onNotify?: (message: string) => void;
  onPatchDocument?: (recipe: (draft: MangaDocument) => boolean | void) => MangaDocument;
  onPersistSeriesCatalog?: (
    source: MangaDocument,
    options?: { deleteMaterialCatalogIds?: readonly string[] },
  ) => Promise<MangaDocument>;
  onFinalizeDeletedSeriesMaterial?: (catalogId: string, seriesId: string) => void;
  onChooseImageFiles?: () => Promise<File[]>;
}

const emptyEvidence = (): VisualEvidence => ({ observed: [], inferred: [] });

function emptyRecognition(): CharacterRecognitionProfile {
  return {
    hair: emptyEvidence(),
    face: emptyEvidence(),
    silhouette: emptyEvidence(),
    outfit: emptyEvidence(),
    accessories: emptyEvidence(),
    ambiguous_design: emptyEvidence(),
  };
}

function uniqueMaterialName(document: MangaDocument, base: string): string {
  const names = new Set(document.manga.materials.map((material) => material.key));
  if (!names.has(base)) return base;
  let number = 2;
  while (names.has(`${base} ${number}`)) number += 1;
  return `${base} ${number}`;
}

function guessedView(fileName: string): Material['view'] {
  if (/三面|設定|turnaround/iu.test(fileName)) return 'turnaround';
  if (/正面|front/iu.test(fileName)) return 'front';
  if (/斜め|three.?quarter/iu.test(fileName)) return 'three-quarter';
  if (/横|側面|side|profile/iu.test(fileName)) return 'side';
  if (/背面|後ろ|back/iu.test(fileName)) return 'back';
  if (/表情|expression/iu.test(fileName)) return 'expression';
  if (/衣装|costume/iu.test(fileName)) return 'costume';
  return 'other';
}

function viewLabel(view: Material['view']): string {
  return CHARACTER_REFERENCE_VIEWS.find((item) => item.value === view)?.label ?? '人物資料';
}

function ReferenceThumbnail({ document, character, material }: { document: MangaDocument; character: Character; material: Material }) {
  const [url, setUrl] = useState('');
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setUrl('');
    setMissing(false);
    const source = material.source_image;
    if (!source || !document.manga.meta.series_id || !character.catalog_id) {
      setMissing(true);
      return undefined;
    }
    void loadCharacterReferenceImage(document.manga.meta.series_id, character.catalog_id, source.asset_id)
      .then((blob) => {
        if (!active) return;
        if (!blob) { setMissing(true); return; }
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => active && setMissing(true));
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [document.manga.meta.series_id, character.catalog_id, material.source_image?.asset_id]);
  if (url) return <img src={url} alt={`${character.name}の${viewLabel(material.view)}`} />;
  return <span class="character-reference-placeholder"><FileImage size={22} />{missing ? '画像なし' : '読込中'}</span>;
}

function CandidateEvidence({
  suggestion,
  onChange,
}: {
  suggestion: Pick<CharacterReferenceSetSuggestion, 'recognition'>;
  onChange: (
    field: (typeof CHARACTER_RECOGNITION_FIELDS)[number]['key'],
    values: string[],
  ) => void;
}) {
  return <div class="character-recognition-candidate-fields">
    {CHARACTER_RECOGNITION_FIELDS.map(({ key, label }) => {
      const evidence = suggestion.recognition[key];
      return <section key={key}><strong>{label}</strong>
        <div><TextListEditor compactAdd values={evidence.observed} placeholder={`${label}の抽出特徴`} onChange={(values) => onChange(key, values)} /></div>
      </section>;
    })}
  </div>;
}

export default function CharacterReferences({ document, character, onChange, onNotify, onPatchDocument, onPersistSeriesCatalog, onFinalizeDeletedSeriesMaterial, onChooseImageFiles }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [analyzingId, setAnalyzingId] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [recognitionEditorOpen, setRecognitionEditorOpen] = useState(false);
  const identityKey = `${document.manga.meta.series_id}\0${character.catalog_id ?? ''}`;
  const recognitionEntryCount = CHARACTER_RECOGNITION_FIELDS.reduce((total, { key }) => (
    total
    + (character.recognition?.[key].observed.length ?? 0)
  ), 0);
  const identityKeyRef = useRef(identityKey);
  identityKeyRef.current = identityKey;
  const [candidate, setCandidate] = useState<{ identityKey: string; materialIds: string[]; value: CharacterReferenceSetSuggestion } | null>(null);
  useEffect(() => {
    setCandidate(null);
    setFileErrors([]);
  }, [identityKey]);
  useEffect(() => {
    if (recognitionEntryCount) setRecognitionEditorOpen(true);
  }, [identityKey, recognitionEntryCount]);
  const visuals = document.manga.materials.filter((material) => (
    material.type === 'character' && material.characterId === character.localId
  ));
  const imageVisuals = visuals.filter((material) => material.source_image);
  const catalogReady = character.scope === 'series'
    && Boolean(character.catalog_id)
    && Boolean(document.manga.meta.series.trim())
    && Boolean(document.manga.meta.series_id);
  const notify = (message: string) => onNotify?.(message);

  const patchDocument = (recipe: (draft: MangaDocument) => boolean | void): MangaDocument => {
    if (onPatchDocument) return onPatchDocument(recipe);
    const next = structuredClone(document);
    if (recipe(next) === false) return document;
    onChange(next);
    return next;
  };

  const findOwner = (draft: MangaDocument) => draft.manga.characters.find((entry) => (
    entry.localId === character.localId
    || Boolean(character.catalog_id && entry.catalog_id === character.catalog_id)
  ));

  const addImages = async (files?: ArrayLike<File> | Iterable<File> | null) => {
    const selected = Array.from(files ?? []).slice(0, 12);
    if (input.current) input.current.value = '';
    if (!selected.length || saving) return;
    if (!catalogReady || !character.catalog_id) {
      notify('人物をシリーズ共通にし、先に保存してください');
      return;
    }
    const requestIdentity = identityKey;
    const originalSeriesId = document.manga.meta.series_id;
    const originalCharacterId = character.catalog_id;
    setSaving(true);
    setFileErrors([]);
    const finishImageImport=beginFigureCropImport();
    try {
      if (!onPersistSeriesCatalog) throw new Error('シリーズ台帳の保存機能を利用できません');
      const preparedFiles: Array<{ file: File; png: Blob }> = [];
      const failures: string[] = [];
      for (const file of selected) {
        try {
          preparedFiles.push({ file, png: await imageFileToPng(file) });
        } catch (error) {
          failures.push(`${file.name}: ${error instanceof Error ? error.message : '読込失敗'}`);
        }
      }
      if (identityKeyRef.current !== requestIdentity) return;
      setFileErrors([...failures]);
      if (!preparedFiles.length) return;
      // 画像保存先はシリーズ台帳の配下にある。新規シリーズ／人物でも、別の保存操作を
      // 要求せず、画像を送る前に台帳と安定IDを確定させる。
      const destination = await prepareCharacterReferenceDestination(document, character, onPersistSeriesCatalog);
      const operationSeriesId = destination.seriesId;
      const operationCharacterId = destination.characterCatalogId;
      const preparedIdentity = `${operationSeriesId}\0${operationCharacterId}`;
      if (identityKeyRef.current !== requestIdentity && identityKeyRef.current !== preparedIdentity) {
        notify('別のシリーズまたは人物へ移動したため、画像追加を中止しました');
        return;
      }
      const saved: Array<{ file: File; source: Material['source_image']; created: boolean }> = [];
      for (const { file, png } of preparedFiles) {
        try {
          const result = await saveCharacterReferenceImage(
            png,
            file.name,
            operationSeriesId,
            operationCharacterId,
          );
          saved.push({ file, source: result.sourceImage, created: result.created });
        } catch (error) {
          failures.push(`${file.name}: ${error instanceof Error ? error.message : '保存失敗'}`);
        }
      }
      const discardCreatedImages = async () => {
        const failures: string[] = [];
        for (const entry of saved.filter((item) => item.created && item.source)) {
          try {
            await deleteCharacterReferenceImage(operationSeriesId, operationCharacterId, entry.source!.asset_id);
          } catch {
            failures.push(entry.file.name);
          }
        }
        return failures;
      };
      if (identityKeyRef.current !== requestIdentity && identityKeyRef.current !== preparedIdentity) {
        const cleanupFailures = await discardCreatedImages();
        notify(`別のシリーズまたは人物へ移動したため、追加を中止しました${cleanupFailures.length ? `（未参照画像${cleanupFailures.length}件の整理は再試行が必要です）` : ''}`);
        return;
      }
      setFileErrors(failures);
      let added = 0;
      let appliedToCurrentDocument = false;
      const next = patchDocument((draft) => {
        if (draft.manga.meta.series_id !== operationSeriesId) {
          if (draft.manga.meta.series_id !== originalSeriesId) return false;
          draft.manga.meta.series_id = operationSeriesId;
        }
        const owner = findOwner(draft);
        if (!owner) return false;
        if (owner.catalog_id && owner.catalog_id !== originalCharacterId && owner.catalog_id !== operationCharacterId) return false;
        owner.catalog_id = operationCharacterId;
        appliedToCurrentDocument = true;
        const existingHashes = new Set(draft.manga.materials.filter((material) => (
          material.type === 'character' && material.character_catalog_id === owner.catalog_id && material.source_image
        )).map((material) => material.source_image!.sha256));
        for (const { file, source } of saved) {
          if (!source) continue;
          if (existingHashes.has(source.sha256)) continue;
          existingHashes.add(source.sha256);
          const view = guessedView(file.name);
          const material: Material = {
            localId: newCatalogId('material'),
            catalog_id: newCatalogId('material'),
            key: uniqueMaterialName(draft, file.name),
            type: 'character',
            scope: 'series',
            keywords: owner.name.trim() ? [owner.name.trim()] : [],
            note: '',
            characterId: owner.localId,
            character_catalog_id: owner.catalog_id,
            origin: currentEpisodeOrigin(draft),
            view,
            source_image: source,
          };
          draft.manga.materials.unshift(material);
          owner.primary_material_catalog_id ||= material.catalog_id;
          added += 1;
        }
      });
      if (!appliedToCurrentDocument) {
        const cleanupFailures = await discardCreatedImages();
        notify(`表示中の作品が変わったため、画像追加を中止しました${cleanupFailures.length ? `（未参照画像${cleanupFailures.length}件の整理は再試行が必要です）` : ''}`);
        return;
      }
      if (!added) {
        notify(failures.length ? `人物資料画像を追加できませんでした。${failures.join('／')}` : '同じ画像はすでに登録されています');
      } else {
        try {
          await onPersistSeriesCatalog(next);
          notify(`人物資料画像を${added}件追加してシリーズ台帳へ保存しました。画像はまだVLM解析していません。${failures.length ? ` ${failures.length}件は追加できませんでした。` : ''}`);
        } catch (error) {
          notify(`人物資料画像を${added}件追加しましたが、シリーズ台帳へ保存できませんでした。再度保存してください。${error instanceof Error ? ` ${error.message}` : ''}`);
        }
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : '人物資料画像を保存できませんでした');
    } finally {
      setSaving(false);
      finishImageImport();
    }
  };

  const chooseImages = async () => {
    if (!onChooseImageFiles) {
      input.current?.click();
      return;
    }
    try {
      await addImages(await onChooseImageFiles());
    } catch (error) {
      const message = error instanceof Error ? error.message : '人物資料画像を選べませんでした';
      if (/MBを超え/.test(message)) {
        setFileErrors([`${message}。設定画は長辺${CHARACTER_REFERENCE_LONG_EDGE} px・短辺${CHARACTER_REFERENCE_SHORT_EDGE} px以内に縮小して選び直してください。`]);
      } else {
        notify(message);
      }
    }
  };

  const analyzeAll = async () => {
    if (!imageVisuals.length || !character.catalog_id || !document.manga.meta.series.trim() || !document.manga.meta.series_id || analyzingId) return;
    const requestIdentity = identityKey;
    const orderedVisuals = [...imageVisuals].sort((left, right) => (
      Number(right.catalog_id === character.primary_material_catalog_id)
      - Number(left.catalog_id === character.primary_material_catalog_id)
    ));
    const materialIds = orderedVisuals.map((material) => material.localId ?? material.catalog_id ?? material.source_image!.asset_id);
    setAnalyzingId('all');
    setCandidate(null);
    notify(`人物資料${imageVisuals.length}枚を比較して特徴を抽出しています…`);
    try {
      const value = await analyzeCharacterReferenceSetWithLocalVlm(
        document.manga.meta.series_id,
        character.catalog_id,
        orderedVisuals.map((material) => material.source_image!.asset_id),
        character.name,
      );
      if (identityKeyRef.current !== requestIdentity) return;
      patchDocument((draft) => {
        const views = new Map(value.referenceViews.map((entry) => [entry.assetId, entry]));
        draft.manga.materials.forEach((material) => {
          const suggestion = material.source_image ? views.get(material.source_image.asset_id) : undefined;
          if (suggestion?.confidence === 'high') {
            material.view = applySuggestedReferenceView(material.view, suggestion.referenceView);
          }
        });
      });
      setCandidate({ identityKey: requestIdentity, materialIds, value });
      notify(`${imageVisuals.length}枚を比較して特徴と画像分類を抽出しました。内容を修正・削除してから人物設定へ追加できます。`);
    } catch (error) {
      notify(error instanceof Error ? error.message : '人物資料を一括解析できませんでした');
    } finally {
      setAnalyzingId('');
    }
  };

  const deleteImageMaterial = async (material: Material) => {
    if (!material.source_image || !material.catalog_id || !character.catalog_id || !catalogReady || deletingId || analyzingId) return;
    if (!confirm(`人物資料「${material.key}」と保存画像を削除しますか？`)) return;
    const sourceImage = structuredClone(material.source_image);
    const operationSeriesId = document.manga.meta.series_id;
    const sharedImage = document.manga.materials.some((entry) => (
      entry !== material
      && entry.character_catalog_id === character.catalog_id
      && entry.source_image?.asset_id === sourceImage.asset_id
    ));
    setDeletingId(material.catalog_id);
    try {
      if (!onPersistSeriesCatalog) throw new Error('シリーズ台帳の削除機能を利用できません');
      await onPersistSeriesCatalog(document, { deleteMaterialCatalogIds: [material.catalog_id] });
      if (onFinalizeDeletedSeriesMaterial) {
        onFinalizeDeletedSeriesMaterial(material.catalog_id, operationSeriesId);
      } else if (identityKeyRef.current === identityKey) {
        patchDocument((draft) => {
          const owner = findOwner(draft);
          draft.manga.materials = draft.manga.materials.filter((entry) => entry.catalog_id !== material.catalog_id);
          if (owner && owner.primary_material_catalog_id === material.catalog_id) delete owner.primary_material_catalog_id;
        });
      }
      if (candidate?.materialIds.includes(material.localId ?? material.catalog_id ?? '')) setCandidate(null);
      if (!sharedImage) {
        try {
          await deleteCharacterReferenceImage(
            document.manga.meta.series_id,
            character.catalog_id,
            sourceImage.asset_id,
          );
        } catch (error) {
          notify(`人物資料は台帳から削除しました。未参照画像ファイルの整理だけ失敗しました。${error instanceof Error ? ` ${error.message}` : ''}`);
          return;
        }
      }
      notify('人物資料画像をシリーズ台帳から削除しました');
    } catch (error) {
      notify(`シリーズ台帳を更新できなかったため削除しませんでした。${error instanceof Error ? ` ${error.message}` : ''}`);
    } finally {
      setDeletingId('');
    }
  };

  const updateRecognition = (
    field: (typeof CHARACTER_RECOGNITION_FIELDS)[number]['key'],
    values: string[],
  ) => patchDocument((draft) => {
    const owner = findOwner(draft);
    if (!owner) return;
    owner.recognition ??= emptyRecognition();
    owner.recognition[field].observed = values;
  });

  const updateCandidateEvidence = (
    field: (typeof CHARACTER_RECOGNITION_FIELDS)[number]['key'],
    values: string[],
  ) => setCandidate((current) => {
    if (!current) return null;
    const next = structuredClone(current);
    next.value.recognition[field].observed = values;
    return next;
  });

  return <div class="character-reference-manager">
    <div class="character-visuals-head"><strong>キャラクターデザイン画像</strong><div class="character-visuals-actions">
      <button type="button" class="inline-add" disabled={saving || Boolean(analyzingId) || Boolean(deletingId) || !catalogReady} onClick={() => void chooseImages()}><Upload size={14} />{saving ? '保存中…' : '画像を追加'}</button>
      <button type="button" class="character-extract-all" disabled={saving || Boolean(analyzingId) || Boolean(deletingId) || !catalogReady || !imageVisuals.length} onClick={() => void analyzeAll()}><ScanSearch size={14} />{analyzingId ? '...抽出中' : 'まとめて特徴を抽出'}</button>
    </div></div>
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(event) => addImages(event.currentTarget.files)} />
    {fileErrors.length > 0 && <div role="alert">{fileErrors.map((message, index) => <p key={index}>{message}</p>)}</div>}
    {character.scope !== 'series' && <p class="muted-message">画像資料と照合特徴は、シリーズ共通人物にすると登録できます。</p>}
    {character.scope === 'series' && (!document.manga.meta.series.trim() || !document.manga.meta.series_id) && <p class="muted-message">シリーズ名を入力して保存すると画像を登録できます。</p>}
    {!!imageVisuals.length && <div class="character-reference-grid">{imageVisuals.map((material) => {
      const primary = character.primary_material_catalog_id === material.catalog_id;
      const taskId = material.localId ?? material.catalog_id ?? material.source_image!.asset_id;
      return <article class={`character-reference-card ${primary ? 'is-primary' : ''}`} key={taskId}>
        <div class="character-reference-thumb"><ReferenceThumbnail document={document} character={character} material={material} />{primary && <span class="character-reference-primary"><Star size={11} />代表</span>}</div>
        <div class="character-reference-file-name" >
          {material.source_image?.original_name ?? material.key}
        </div>
        <select value={material.view ?? 'other'} onChange={(event) => patchDocument((draft) => {
          const target = draft.manga.materials.find((entry) => entry.catalog_id === material.catalog_id);
          if (target) target.view = event.currentTarget.value as Material['view'];
        })}>{CHARACTER_REFERENCE_VIEWS.map((view) => <option value={view.value} key={view.value}>{view.label}</option>)}</select>
        <div class="character-reference-actions">
          <button type="button" class={primary ? 'is-active' : ''} disabled={Boolean(deletingId)} onClick={() => patchDocument((draft) => {
            const owner = findOwner(draft);
            if (owner) owner.primary_material_catalog_id = material.catalog_id;
          })}><Star size={13} />代表</button>
          <button type="button" disabled={!catalogReady || Boolean(analyzingId) || Boolean(deletingId)} onClick={() => deleteImageMaterial(material)}><Trash2 size={13} />{deletingId === material.catalog_id ? '削除中…' : '削除'}</button>
        </div>
      </article>;
    })}</div>}
    {!imageVisuals.length && character.scope === 'series' && <p class="muted-message">人物資料画像は未登録です。</p>}

    {candidate?.identityKey === identityKey && <section class="character-recognition-candidate">
      <header><strong><ScanSearch size={17} />抽出された特徴</strong><span>追加する前に修正・削除できます</span></header>
      <CandidateEvidence suggestion={candidate.value} onChange={updateCandidateEvidence} />
      <div class="character-recognition-candidate-actions"><button type="button" class="primary-button" onClick={() => {
        if (candidate.identityKey !== identityKeyRef.current) {
          setCandidate(null);
          notify('別のシリーズまたは人物へ移動したため、解析候補を破棄しました');
          return;
        }
        patchDocument((draft) => {
          const owner = findOwner(draft);
          if (!owner) return;
          owner.recognition ??= emptyRecognition();
          CHARACTER_RECOGNITION_FIELDS.forEach(({ key }) => {
            const incoming = candidate.value.recognition[key];
            owner.recognition![key].observed = [...new Set([
              ...owner.recognition![key].observed,
              ...incoming.observed,
            ])];
          });
          owner.recognition.analyzer = structuredClone(candidate.value.analyzer);
        });
        setCandidate(null);
        setRecognitionEditorOpen(true);
        notify('抽出された特徴を人物設定へ追加しました。下の編集欄でも修正できます。');
      }}><Check size={15} />特徴を追加</button><button type="button" onClick={() => setCandidate(null)}><Trash2 size={15} />削除</button></div>
    </section>}

    <details
      class="character-recognition-editor"
      open={recognitionEditorOpen}
      onToggle={(event) => setRecognitionEditorOpen(event.currentTarget.open)}
    >
      <summary>キャラクターの特徴を確認・再編集</summary>
      <div class="character-recognition-fields">{CHARACTER_RECOGNITION_FIELDS.map(({ key, label }) => {
        const evidence = character.recognition?.[key] ?? emptyEvidence();
        return <section key={key}><h4>{label}</h4>
          <TextListEditor compactAdd values={evidence.observed} placeholder={`${label}の特徴`} onChange={(values) => updateRecognition(key, values)} />
        </section>;
      })}</div>
    </details>
  </div>;
}
