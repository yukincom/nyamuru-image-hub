import type { MangaDocument, Material, MaterialScope } from '../../types';
import { useState, useEffect } from 'preact/hooks';
import { loadCharacterReferenceImage, type SeriesCharacterTextLink } from '../../lib/localBridge.ts';
import { type BaseProps, mutateDocument, uniqueCharacterName, createMaterial, setMaterialScope, duplicateMaterial } from './editing.ts';
import { isDetectedFigureCharacter, isSystemMobCharacter } from '../../lib/systemCharacters.ts';
import { newCatalogId, renameCharacter, renameMaterial, assignCharacterMaterial } from '../../lib/catalogModel.ts';
import { EditorShell } from './EditorShell.tsx';
import { Save, FileText, Plus, RotateCcw, Trash2, UserRound, Copy } from 'lucide-preact';
import { Field, SectionTitle } from '../Fields';
import { isCharacterGender, CHARACTER_GENDER_OPTIONS } from '../../lib/characterGender.ts';
import CharacterReferences from '../CharacterReferences.tsx';

function CharacterProfileAvatar({
  document,
  character,
  material,
}: {
  document: MangaDocument;
  character: MangaDocument['manga']['characters'][number];
  material?: Material;
}) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setUrl('');
    const source = material?.source_image;
    if (!source || !document.manga.meta.series_id || !character.catalog_id) return undefined;
    void loadCharacterReferenceImage(document.manga.meta.series_id, character.catalog_id, source.asset_id)
      .then((blob) => {
        if (!active || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [document.manga.meta.series_id, character.catalog_id, material?.source_image?.asset_id]);

  return <div class={`character-profile-avatar ${url ? 'has-image' : ''}`}>
    {url
      ? <img src={url} alt={`${character.name}の代表デザイン`} />
      : <div class="avatar-placeholder">{character.name.slice(0, 1) || '?'}</div>}
  </div>;
}

export function CharactersEditor({ document, onChange, onNotify, embedded = false, onSaveCharacters, charactersSaving = false, onPatchDocument, onPersistSeriesCatalog, onFinalizeDeletedSeriesMaterial, onChooseCharacterImages, hideSystemMob = false, characterTextLink = null, characterTextBusy = false, onLinkCharacterText, onDeleteSeriesCharacter, onRestoreDeletedCharacter }: BaseProps & {
  onNotify?: (message: string) => void;
  embedded?: boolean;
  onSaveCharacters?: () => void | Promise<void>;
  charactersSaving?: boolean;
  onPatchDocument?: (recipe: (draft: MangaDocument) => boolean | void) => MangaDocument;
  onPersistSeriesCatalog?: (
    source: MangaDocument,
    options?: { deleteMaterialCatalogIds?: readonly string[]; deleteCharacterCatalogIds?: readonly string[] },
  ) => Promise<MangaDocument>;
  onFinalizeDeletedSeriesMaterial?: (catalogId: string, seriesId: string) => void;
  onChooseCharacterImages?: () => Promise<File[]>;
  hideSystemMob?: boolean;
  characterTextLink?: SeriesCharacterTextLink | null;
  characterTextBusy?: boolean;
  onLinkCharacterText?: () => void | Promise<void>;
  onDeleteSeriesCharacter?: (characterLocalId: string) => void | Promise<void>;
  onRestoreDeletedCharacter?: (deletionId: string) => void | Promise<void>;
}) {
  const [activeScope, setActiveScope] = useState<MaterialScope>(document.manga.meta.series.trim() ? 'series' : 'episode');
  useEffect(() => {
    setActiveScope(document.manga.meta.series.trim() ? 'series' : 'episode');
  }, [document.manga.meta.series_id, document.manga.meta.episode_id]);
  const update = (recipe: (draft: MangaDocument) => void) => mutateDocument(document, onChange, recipe);
  const notify = (message: string) => onNotify?.(message);
  const visibleCharacters = document.manga.characters.filter((character) => (
    !isDetectedFigureCharacter(character) && (!hideSystemMob || !isSystemMobCharacter(character))
  ));
  const scopeCounts = {
    series: visibleCharacters.filter((character) => character.scope === 'series').length,
    episode: visibleCharacters.filter((character) => character.scope !== 'series').length,
  };

  const addCharacter = () => {
    if (activeScope === 'series' && !document.manga.meta.series.trim()) {
      notify('シリーズ共通人物を追加するには、作品情報でシリーズ名を入力してください');
      return;
    }
    update((draft) => {
      draft.manga.characters.push({
        localId: newCatalogId('person'),
        name: uniqueCharacterName(draft),
        role: '',
        scope: activeScope,
        ...(activeScope === 'series' ? { catalog_id: newCatalogId('character') } : {}),
      });
    });
  };

  const addVisual = (characterId: string) => update((draft) => {
    const character = draft.manga.characters.find((entry) => entry.localId === characterId);
    if (!character) return;
    const material = createMaterial(draft, 'character', character.scope, `${character.name || '人物'}の立ち絵`);
    material.characterId = characterId;
    if (character.catalog_id) material.character_catalog_id = character.catalog_id;
    if (character.name.trim()) material.keywords.push(character.name.trim());
    draft.manga.materials.unshift(material);
  });

  const setCharacterScope = (character: MangaDocument['manga']['characters'][number], scope: MaterialScope) => {
    if (character.scope === scope) return;
    if (scope === 'series' && !document.manga.meta.series.trim()) {
      notify('シリーズ共通にするには、作品情報でシリーズ名を入力してください');
      return;
    }
    const hasSeriesVisuals = document.manga.materials.some((material) => (
      material.type === 'character' && material.characterId === character.localId && material.scope === 'series'
    ));
    if (scope === 'episode' && hasSeriesVisuals) {
      notify('シリーズ共通の人物資料があるため、先に資料をこの話だけへ移すか削除してください');
      return;
    }
    update((draft) => {
      const target = draft.manga.characters.find((entry) => entry.localId === character.localId);
      if (!target) return;
      target.scope = scope;
      if (scope === 'series') target.catalog_id ||= newCatalogId('character');
      else {
        delete target.catalog_id;
        delete target.primary_material_catalog_id;
      }
    });
  };

  const unassigned = document.manga.materials.map((material, index) => ({ material, index }))
    .filter(({ material }) => material.type === 'character' && !material.characterId && !material.source_image);
  const orphanImageVisuals = document.manga.materials.filter((material) => (
    material.type === 'character' && !material.characterId && Boolean(material.source_image)
  ));
  const visibleEntries = document.manga.characters.map((character, index) => ({ character, index }))
    .filter(({ character }) => (
      !isDetectedFigureCharacter(character) && (!hideSystemMob || !isSystemMobCharacter(character))
    ));
  const displayedCharacters = [
    ...visibleEntries.filter(({ character }) => !isSystemMobCharacter(character)),
    ...visibleEntries.filter(({ character }) => isSystemMobCharacter(character)),
  ]
    .filter(({ character }) => character.scope === activeScope);

  return <EditorShell eyebrow="CAST" title="登場人物" description="シリーズ人物と、この話だけの人物を分けて管理します。" embedded={embedded} action={<>
    {onSaveCharacters && <button class="secondary-button" disabled={charactersSaving || characterTextBusy} onClick={() => void onSaveCharacters()}><Save size={16} />{charactersSaving ? '保存中…' : '保存'}</button>}
    {onLinkCharacterText && <button class="secondary-button character-text-link-button" disabled={!document.manga.meta.series.trim() || characterTextBusy || charactersSaving} onClick={() => void onLinkCharacterText()}><FileText size={16} />{characterTextBusy ? '連携中…' : characterTextLink?.needsRelink ? 'テキスト再リンク' : 'テキスト参照'}</button>}
    <button class="primary-button" disabled={characterTextBusy} onClick={addCharacter}><Plus size={16} />人物を追加</button>
  </>}>
    {characterTextLink?.linked && <p class="character-text-link-status" ><FileText size={14} />{characterTextLink.fileName} と同期中</p>}
    {characterTextLink?.needsRelink && <p class="character-text-link-status needs-relink"><FileText size={14} />参照テキストが見つかりません。「テキスト再リンク」でシリーズフォルダを選んでください。</p>}
    {!!characterTextLink?.deletedCharacters.length && <section class="character-restore-strip" aria-label="削除した人物の復元">
      <strong>30日以内に削除した人物</strong>
      <div>{characterTextLink.deletedCharacters.map((entry) => <button key={entry.deletionId} type="button" disabled={characterTextBusy} onClick={() => void onRestoreDeletedCharacter?.(entry.deletionId)}><RotateCcw size={14} />{entry.characterName}を復元</button>)}</div>
    </section>}
    <div class="character-scope-tabs" role="tablist" aria-label="人物の利用範囲">
      <button type="button" role="tab" aria-selected={activeScope === 'series'} class={activeScope === 'series' ? 'is-active' : ''} onClick={() => setActiveScope('series')}>シリーズ共通 <strong>{scopeCounts.series}</strong></button>
      <button type="button" role="tab" aria-selected={activeScope === 'episode'} class={activeScope === 'episode' ? 'is-active' : ''} onClick={() => setActiveScope('episode')}>この話だけ <strong>{scopeCounts.episode}</strong></button>
    </div>
    <div class="entity-grid character-entity-grid">
      {displayedCharacters.map(({ character, index }) => {
        const isSystemMob = isSystemMobCharacter(character);
        const visuals = document.manga.materials.map((material, materialIndex) => ({ material, materialIndex }))
          .filter(({ material }) => material.type === 'character' && material.characterId === character.localId && !material.source_image);
        const primaryImage = document.manga.materials.find((material) => (
          material.type === 'character'
          && material.characterId === character.localId
          && material.catalog_id === character.primary_material_catalog_id
          && Boolean(material.source_image)
        ));
        return <section class="entity-card character-card" key={character.localId ?? index}>
          {!isSystemMob && <button class="entity-delete" onClick={() => {
            if (character.scope === 'series' && character.localId && onDeleteSeriesCharacter) {
              if (!confirm(`人物「${character.name}」をシリーズ台帳と参照テキストから削除しますか？30日間は復元できます。`)) return;
              void onDeleteSeriesCharacter(character.localId);
              return;
            }
            if (!confirm(`人物「${character.name}」をこの作品から外しますか？`)) return;
            update((draft) => { draft.manga.characters.splice(index, 1); });
          }} disabled={characterTextBusy} aria-label="人物をこの作品から外す"><Trash2 size={16} /></button>}
          <div class="character-profile-top">
            <CharacterProfileAvatar document={document} character={character} material={primaryImage} />
            <div class="character-profile-fields">
              <Field label="名前"><input disabled={isSystemMob} value={character.name} onInput={(event) => update((draft) => { if (!isSystemMob && character.localId) renameCharacter(draft, character.localId, event.currentTarget.value); })} /></Field>
              {/* 未選択の表示だけでは性別を保存しない。 */}
              <Field label="性別" hint="未設定の英文は中性（they）で生成します"><select value={character.gender ?? ''} onChange={(event) => {
                const value = event.currentTarget.value;
                if (isCharacterGender(value)) update((draft) => { draft.manga.characters[index].gender = value; });
              }}><option value="" disabled hidden>未設定</option>{CHARACTER_GENDER_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
              <Field label="利用範囲"><select disabled={isSystemMob} value={character.scope} onChange={(event) => { if (!isSystemMob) setCharacterScope(character, event.currentTarget.value as MaterialScope); }}><option value="episode">この話だけ</option><option value="series">シリーズ共通</option></select></Field>
              <Field label="等身"><input type="number" min="1" step="0.1" value={character.default_proportion?.head_count ?? ''} placeholder="例：4" onBlur={(event) => update((draft) => {
                const value = event.currentTarget.valueAsNumber;
                if (Number.isFinite(value)) draft.manga.characters[index].default_proportion = { head_count: value };
                else delete draft.manga.characters[index].default_proportion;
              })} /></Field>
            </div>
          </div>
          <Field label="人物像"><textarea disabled={isSystemMob} class="character-role-textarea" rows={3} value={character.role} onInput={(event) => update((draft) => { if (!isSystemMob) draft.manga.characters[index].role = event.currentTarget.value; })} /></Field>

          <details class="character-design-details">
            <summary><span>デザイン詳細</span></summary>
            <div class="character-design-details-body">
              <CharacterReferences document={document} character={character} onChange={onChange} onNotify={onNotify} onPatchDocument={onPatchDocument} onPersistSeriesCatalog={onPersistSeriesCatalog} onFinalizeDeletedSeriesMaterial={onFinalizeDeletedSeriesMaterial} onChooseImageFiles={onChooseCharacterImages} />

              <div class="character-visuals-head"><strong>テキスト資料</strong><button class="inline-add" onClick={() => character.localId && addVisual(character.localId)}><Plus size={14} />資料を追加</button></div>
              <div class="character-visual-list">{visuals.map(({ material, materialIndex }) => <section class="material-card character-visual-card" key={material.localId ?? material.key}>
                <div class="material-type-icon type-character"><UserRound size={18} /></div>
                <div class="material-fields">
                  <div class="field-grid">
                    <Field label="資料名"><input value={material.key} onInput={(event) => update((draft) => { if (material.localId) renameMaterial(draft, material.localId, event.currentTarget.value); })} /></Field>
                    <Field label="利用範囲"><select value={material.scope} onChange={(event) => {
                      const scope = event.currentTarget.value as MaterialScope;
                      if (scope === 'series' && character.scope !== 'series') { notify('人物資料をシリーズ共通にするには、対応人物もシリーズ共通にしてください'); return; }
                      update((draft) => { const target = draft.manga.materials[materialIndex]; if (target) setMaterialScope(draft, target, scope); });
                    }}><option value="episode">この話だけ</option><option value="series">シリーズ共通</option></select></Field>
                  </div>
                  <Field label="検索キーワード" hint="カンマ区切り"><input value={material.keywords.join(', ')} onInput={(event) => update((draft) => { draft.manga.materials[materialIndex].keywords = event.currentTarget.value.split(',').map((item) => item.trim()).filter(Boolean); })} /></Field>
                  <Field label="デザインコンセプト"><textarea rows={3} value={material.note ?? ''} onInput={(event) => update((draft) => { draft.manga.materials[materialIndex].note = event.currentTarget.value; })} /></Field>
                </div>
                <div class="material-card-actions"><button onClick={() => update((draft) => { const source = draft.manga.materials.find((entry) => entry.localId === material.localId); if (source) draft.manga.materials.unshift(duplicateMaterial(draft, source)); })} aria-label="人物資料を複製" ><Copy size={15} /></button><button onClick={() => update((draft) => { draft.manga.materials.splice(materialIndex, 1); })} aria-label="人物資料を削除" ><Trash2 size={16} /></button></div>
              </section>)}
              {!visuals.length && <p class="muted-message">テキスト資料は未登録です。</p>}</div>
            </div>
          </details>
        </section>;
      })}
    </div>
    {!displayedCharacters.length && <button type="button" class="content-card character-scope-empty" onClick={addCharacter}><UserRound size={26} /><span>{activeScope === 'series' ? 'シリーズ共通人物' : 'この話だけの人物'}は未登録です</span><strong><Plus size={16} />人物を追加</strong></button>}
    {!!unassigned.length && <section class="content-card unassigned-character-materials"><SectionTitle title="人物未割当の資料" description="対応人物を選択してください" />
      <div class="material-list">{unassigned.map(({ material, index }) => <section class="material-card" key={material.localId ?? material.key}>
        <div class="material-type-icon type-character"><UserRound size={18} /></div>
        <div class="material-fields"><Field label="資料名"><input value={material.key} onInput={(event) => update((draft) => { if (material.localId) renameMaterial(draft, material.localId, event.currentTarget.value); })} /></Field>
          <Field label="対応人物"><select value="" onChange={(event) => update((draft) => { if (material.localId) assignCharacterMaterial(draft, material.localId, event.currentTarget.value); })}><option value="">未割当</option>{visibleCharacters.map((entry) => <option value={entry.localId}>{entry.name}</option>)}</select></Field>
        </div>
        <div class="material-card-actions"><button onClick={() => update((draft) => { draft.manga.materials.splice(index, 1); })} aria-label="人物資料を削除" ><Trash2 size={16} /></button></div>
      </section>)}</div>
    </section>}
    {!!orphanImageVisuals.length && <section class="content-card unassigned-character-materials"><SectionTitle title="画像資料のリンク確認" description="保存先の人物IDと一致するシリーズ人物が見つかりません" />
      <p class="muted-message">{orphanImageVisuals.map((material) => material.key).join('、')}。対応するシリーズ人物を台帳から読み込むまで、別人物への付け替えと画像削除は行いません。</p>
    </section>}
  </EditorShell>;
}
