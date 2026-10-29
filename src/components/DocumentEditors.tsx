import { useEffect, useState } from 'preact/hooks';
import { ArrowLeft, Box, Building2, Check, Copy, FileText, Plus, RotateCcw, Save, Trash2, UserRound } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import type { MangaDocument, Material, MaterialScope, MaterialType } from '../types';
import { currentEpisodeOrigin } from '../lib/seriesCatalog';
import { assignCharacterMaterial, newCatalogId, renameCharacter, renameMaterial } from '../lib/catalogModel.ts';
import { isDetectedFigureCharacter, isSystemMobCharacter } from '../lib/systemCharacters.ts';
import { panelDisplayLabel } from '../lib/displayLabels.ts';
import { loadCharacterReferenceImage, type SeriesCharacterTextLink } from '../lib/localBridge.ts';
import { Field, SectionTitle } from './Fields';
import CharacterReferences from './CharacterReferences.tsx';
import BackgroundModelPicker from './BackgroundModelPicker';
import { getWorkStylePrompt, setWorkStylePrompt } from '../lib/artworkRules.ts';
import { CHARACTER_GENDER_OPTIONS, isCharacterGender } from '../lib/characterGender.ts';

interface BaseProps { document: MangaDocument; onChange: (document: MangaDocument) => void }

interface MaterialPanelLinkMode {
  pageNumber: number;
  panelId: number;
  linkedKeys: readonly string[];
}

function mutateDocument(document: MangaDocument, onChange: (document: MangaDocument) => void, recipe: (draft: MangaDocument) => void) {
  const next = structuredClone(document); recipe(next); onChange(next);
}

function uniqueMaterialName(document: MangaDocument, base: string): string {
  const names = new Set(document.manga.materials.map((material) => material.key));
  if (!names.has(base)) return base;
  let number = 2;
  while (names.has(`${base} ${number}`)) number += 1;
  return `${base} ${number}`;
}

function uniqueCharacterName(document: MangaDocument, base = '新しいキャラクター'): string {
  const names = new Set(document.manga.characters.map((character) => character.name));
  if (!names.has(base)) return base;
  let number = 2;
  while (names.has(`${base} ${number}`)) number += 1;
  return `${base} ${number}`;
}

function ensureEpisodeId(document: MangaDocument): void {
  document.manga.meta.episode_id ||= crypto.randomUUID();
}

function createMaterial(document: MangaDocument, type: MaterialType, scope: MaterialScope, baseName: string): Material {
  ensureEpisodeId(document);
  return {
    localId: newCatalogId('material'),
    key: uniqueMaterialName(document, baseName),
    type,
    scope,
    keywords: [],
    note: '',
    ...(scope === 'series' ? { catalog_id: crypto.randomUUID(), origin: currentEpisodeOrigin(document) } : {}),
  };
}

function duplicateMaterial(document: MangaDocument, source: Material): Material {
  ensureEpisodeId(document);
  const copy = structuredClone(source);
  copy.localId = newCatalogId('material');
  copy.key = uniqueMaterialName(document, `${source.key} コピー`);
  delete copy.source_image;
  delete copy.view;
  if (copy.scope === 'series') {
    copy.catalog_id = crypto.randomUUID();
    copy.origin = currentEpisodeOrigin(document);
  } else {
    delete copy.catalog_id;
    delete copy.origin;
  }
  return copy;
}

function setMaterialScope(document: MangaDocument, material: Material, scope: MaterialScope): void {
  if (material.scope === scope) return;
  ensureEpisodeId(document);
  material.scope = scope;
  if (scope === 'series') {
    material.catalog_id ||= crypto.randomUUID();
    material.origin ??= currentEpisodeOrigin(document);
  } else {
    delete material.catalog_id;
    delete material.origin;
  }
}

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

export function MetaEditor({ document, onChange }: BaseProps) {
  const { manga } = document;
  const update = (recipe: (draft: MangaDocument) => void) => mutateDocument(document, onChange, recipe);

  return <EditorShell eyebrow="DOCUMENT" title="作品情報" description="シリーズ名やエピソードタイトルなど、この作品の基本情報を管理します。">
    <section class="content-card">
      <SectionTitle title="基本情報" />
      <div class="form-grid-wide">
        <Field label="作品タイトル（シリーズ名）" wide><input value={manga.meta.series} onInput={(event) => update((draft) => {
          // 名前の打ち直し中に空欄になっても、画像保存先と結ぶ安定IDは保つ。
          draft.manga.meta.series = event.currentTarget.value;
        })} /></Field>
        <Field label="サブタイトル"><input value={manga.meta.title} onInput={(event) => update((draft) => { draft.manga.meta.title = event.currentTarget.value; })} /></Field>
        <Field label="話数"><input value={manga.meta.episode_number} placeholder="例：第3話、3、番外編" onInput={(event) => update((draft) => { draft.manga.meta.episode_number = event.currentTarget.value; })} /></Field>
        <Field label="作者名" hint="ページ下端に表示"><input value={manga.meta.author} placeholder="空欄なら非表示" onInput={(event) => update((draft) => { draft.manga.meta.author = event.currentTarget.value; })} /></Field>
        <Field label="ページ数" hint="自動同期"><input type="number" value={manga.pages.length} disabled /></Field>
      </div>
    </section>
    <section class="content-card">
      <SectionTitle title="画風" />
      <Field label="画風プロンプト" hint="画像生成時に英訳して使います" wide>
        <textarea rows={7} value={getWorkStylePrompt(manga)} onInput={(event) => update((draft) => {
          setWorkStylePrompt(draft.manga, event.currentTarget.value);
        })} />
      </Field>
    </section>
  </EditorShell>;
}

export function SettingEditor({ document, onChange, panelLinkMode, onTogglePanelMaterial, onReturnToPanel, onImportBackgroundModel, onSaveBackgrounds, backgroundsSaving=false }: BaseProps & {
  onImportBackgroundModel?: (materialId:string,file:File)=>Promise<void>;
  onSaveBackgrounds?: ()=>void|Promise<void>;
  backgroundsSaving?: boolean;
  panelLinkMode?: MaterialPanelLinkMode | null;
  onTogglePanelMaterial?: (materialKey: string, linked: boolean) => void;
  onReturnToPanel?: () => void;
}) {
  const { setting, series_setting: seriesSetting } = document.manga;
  const update = (recipe: (draft: MangaDocument) => void) => mutateDocument(document, onChange, recipe);
  const addBackground = (scope: MaterialScope) => update((draft) => {
    draft.manga.materials.unshift(createMaterial(draft, 'background', scope, '新しい背景'));
  });
  const renderBackgroundCatalog = (scope: MaterialScope, title: string) => {
    const backgrounds = document.manga.materials.map((material, index) => ({ material, index }))
      .filter(({ material }) => material.type === 'background' && material.scope === scope);
    return <section class={`material-catalog-section scope-${scope}`}>
      <div class="material-catalog-head"><h3>{title}</h3><button class="primary-button" onClick={() => addBackground(scope)}><Plus size={16} />背景を追加</button></div>
      <div class="material-list">{backgrounds.map(({ material, index }) => {
        const linked = panelLinkMode?.linkedKeys.includes(material.key) ?? false;
        return <section class={`material-card ${linked ? 'is-panel-linked' : ''}`} key={material.localId ?? material.key}>
        <div class="material-type-icon type-background"><Building2 size={18} /></div>
        <div class="material-fields">
          {panelLinkMode && <button type="button" class={`material-panel-link-button ${linked ? 'is-linked' : ''}`} disabled={!material.key} onClick={() => onTogglePanelMaterial?.(material.key, !linked)}>
            {linked && <Check size={15} />}{linked ? 'このコマに追加済み' : 'このコマに追加'}
          </button>}
          <div class="field-grid">
            <Field label="名称"><input value={material.key} onInput={(event) => update((draft) => { if (material.localId) renameMaterial(draft, material.localId, event.currentTarget.value); })} /></Field>
            <Field label="利用範囲"><select value={material.scope} onChange={(event) => update((draft) => { const target = draft.manga.materials[index]; if (target) setMaterialScope(draft, target, event.currentTarget.value as MaterialScope); })}><option value="episode">エピソード限定</option><option value="series">シリーズ共通</option></select></Field>
          </div>
          <Field label="検索キーワード" hint="カンマ区切り"><input value={material.keywords.join(', ')} onInput={(event) => update((draft) => { draft.manga.materials[index].keywords = event.currentTarget.value.split(',').map((item) => item.trim()).filter(Boolean); })} /></Field>
          <Field label="デザインコンセプト"><textarea rows={3} value={material.note ?? ''} onInput={(event) => update((draft) => { draft.manga.materials[index].note = event.currentTarget.value; })} /></Field>
          {onImportBackgroundModel&&<BackgroundModelPicker stageId={material.source_stage_id} stages={document.manga.background_stages??[]} disabled={backgroundsSaving} seriesShared={material.scope==='series'} onSelect={id=>update(draft=>{const target=draft.manga.materials.find(entry=>entry.localId===material.localId);if(target){if(id)target.source_stage_id=id;else target.source_stage_id=null;}})} onImport={file=>onImportBackgroundModel(material.localId!,file)}/>}

        </div>
        <div class="material-card-actions"><button onClick={() => update((draft) => { const source = draft.manga.materials.find((entry) => entry.localId === material.localId); if (source) draft.manga.materials.unshift(duplicateMaterial(draft, source)); })} aria-label="背景を複製" ><Copy size={15} /></button><button onClick={() => update((draft) => { draft.manga.materials.splice(index, 1); })} aria-label="背景を削除" ><Trash2 size={16} /></button></div>
      </section>;})}
      {!backgrounds.length && <p class="muted-message">未登録</p>}</div>
    </section>;
  };
  return <EditorShell eyebrow="WORLD" title="舞台設定" description="エピソードの状況と背景作画資料を管理します。" action={<>
    {onSaveBackgrounds&&<button class="primary-button" disabled={backgroundsSaving} onClick={()=>void onSaveBackgrounds()}><Save size={16}/>{backgroundsSaving?'保存中…':'舞台設定を保存'}</button>}
    {panelLinkMode&&onReturnToPanel&&<button class="secondary-button" onClick={onReturnToPanel}><ArrowLeft size={16} />ネームに戻る</button>}
  </>}>
    {panelLinkMode && <div class="material-panel-link-banner" role="status">
      <div><strong>ページ {String(panelLinkMode.pageNumber).padStart(2, '0')} · {panelDisplayLabel(panelLinkMode.panelId)}</strong><span>このコマで参照する背景作画資料を選択してください。</span></div>
      <button class="secondary-button" onClick={onReturnToPanel}><ArrowLeft size={15} />ネームに戻る</button>
    </div>}
    {document.manga.meta.series.trim() && <section class="content-card series-setting-card">
      <SectionTitle title="シリーズの舞台" />
      <div class="form-grid-wide">
        <Field label="ジャンル" hint="例：SF・ファンタジー"><input value={seriesSetting.genre ?? ''} onInput={(event) => update((draft) => { draft.manga.series_setting.genre = event.currentTarget.value; })} /></Field>
        <Field label="対象読者" hint="例：少年・少女"><input value={seriesSetting.target_audience ?? ''} onInput={(event) => update((draft) => { draft.manga.series_setting.target_audience = event.currentTarget.value; })} /></Field>
        <Field label="成人指定"><input type="checkbox" style={{ width: '18px', height: '18px', margin: '5px 0', padding: 0, accentColor: 'var(--accent)' }} checked={seriesSetting.adult_content === true} onChange={(event) => update((draft) => { draft.manga.series_setting.adult_content = event.currentTarget.checked; })} /></Field>
        <Field label="世界観" wide><textarea rows={4} value={seriesSetting.situation} onInput={(event) => update((draft) => { draft.manga.series_setting.situation = event.currentTarget.value; })} /></Field>
      </div>
    </section>}
    <section class="content-card">
      <SectionTitle title="今回のエピソードの舞台・状況" />
      <div class="form-grid-wide">
        <Field label="場所"><input value={setting.location} onInput={(event) => update((draft) => { draft.manga.setting.location = event.currentTarget.value; })} /></Field>
        <Field label="時間帯"><input value={setting.time} onInput={(event) => update((draft) => { draft.manga.setting.time = event.currentTarget.value; })} /></Field>
        <Field label="天候"><input value={setting.weather} onInput={(event) => update((draft) => { draft.manga.setting.weather = event.currentTarget.value; })} /></Field>
        <Field label="あらすじ・ストーリーライン" hint="このエピソードで何が起きるか" wide><textarea rows={5} value={setting.situation} onInput={(event) => update((draft) => { draft.manga.setting.situation = event.currentTarget.value; })} /></Field>
      </div>
    </section>
    <section class="content-card">
      <SectionTitle title="背景作画資料" />
      <p class="environment-settings-note">各背景カードへ3Dモデルを登録できます。シリーズ共通の背景は「舞台設定を保存」すると、同じシリーズの各エピソードから同じ管理コピーを選べます。</p>
      <div class="material-catalogs">
        {renderBackgroundCatalog('episode', 'エピソード限定')}
        {renderBackgroundCatalog('series', 'シリーズ共通')}
      </div>
    </section>
  </EditorShell>;
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
          <Field label="画像生成用ビジュアルプロンプト" hint="外見・描き方の指定。画像生成時に英訳して使います">
            <textarea disabled={isSystemMob} rows={8} value={character.visual_prompt ?? ''} onInput={(event) => update((draft) => {
              if (!isSystemMob) draft.manga.characters[index].visual_prompt = event.currentTarget.value;
            })} />
          </Field>

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

export function PropsEditor({ document, onChange, panelLinkMode, onTogglePanelMaterial, onReturnToPanel }: BaseProps & {
  panelLinkMode?: MaterialPanelLinkMode | null;
  onTogglePanelMaterial?: (materialKey: string, linked: boolean) => void;
  onReturnToPanel?: () => void;
}) {
  const update = (recipe: (draft: MangaDocument) => void) => mutateDocument(document, onChange, recipe);
  const addMaterial = (scope: MaterialScope) => update((draft) => {
    draft.manga.materials.unshift(createMaterial(draft, 'prop', scope, '新しい小道具'));
  });
  const renderCatalog = (scope: MaterialScope, title: string) => {
    const materials = document.manga.materials.map((material, index) => ({ material, index }))
      .filter(({ material }) => material.scope === scope && material.type === 'prop');
    return <section class={`material-catalog-section scope-${scope}`}>
      <div class="material-catalog-head"><h3>{title}</h3><button class="primary-button" onClick={() => addMaterial(scope)}><Plus size={16} />小道具を追加</button></div>
      <div class="material-list">{materials.map(({ material, index }) => {
          const linked = panelLinkMode?.linkedKeys.includes(material.key) ?? false;
          return <section class={`material-card ${linked ? 'is-panel-linked' : ''}`} key={material.localId ?? material.catalog_id ?? `${scope}-${index}-${material.key}`}>
          <div class="material-type-icon type-prop"><Box size={18} /></div>
          <div class="material-fields">
            {panelLinkMode && <button type="button" class={`material-panel-link-button ${linked ? 'is-linked' : ''}`} disabled={!material.key} onClick={() => onTogglePanelMaterial?.(material.key, !linked)}>
              {linked && <Check size={15} />}{linked ? 'このコマに追加済み' : 'このコマに追加'}
            </button>}
            <div class="field-grid">
              <Field label="名称"><input value={material.key} onInput={(event) => update((draft) => { if (material.localId) renameMaterial(draft, material.localId, event.currentTarget.value); })} /></Field>
              <Field label="利用範囲"><select value={material.scope} onChange={(event) => update((draft) => { const target = draft.manga.materials[index]; if (target) setMaterialScope(draft, target, event.currentTarget.value as MaterialScope); })}><option value="episode">エピソード限定</option><option value="series">シリーズ共通</option></select></Field>
            </div>
            <Field label="検索キーワード" hint="カンマ区切り"><input value={material.keywords.join(', ')} onInput={(event) => update((draft) => { draft.manga.materials[index].keywords = event.currentTarget.value.split(',').map((item) => item.trim()).filter(Boolean); })} /></Field>
            <Field label="デザインコンセプト"><textarea rows={3} value={material.note ?? ''} onInput={(event) => update((draft) => { draft.manga.materials[index].note = event.currentTarget.value; })} /></Field>
          </div>
          <div class="material-card-actions"><button onClick={() => update((draft) => { const source = draft.manga.materials.find((entry) => entry.localId === material.localId); if (source) draft.manga.materials.unshift(duplicateMaterial(draft, source)); })} aria-label="小道具を複製" ><Copy size={15} /></button><button onClick={() => update((draft) => { draft.manga.materials.splice(index, 1); })} aria-label="小道具を削除" ><Trash2 size={16} /></button></div>
        </section>})}
      {!materials.length && <p class="muted-message">未登録</p>}</div>
    </section>;
  };
  return <EditorShell eyebrow="PROPS" title="小道具" description="独立して配置する物の情報" action={panelLinkMode && onReturnToPanel
    ? <button class="secondary-button" onClick={onReturnToPanel}><ArrowLeft size={16} />ネームに戻る</button>
    : undefined}>
    {panelLinkMode && <div class="material-panel-link-banner" role="status">
      <div><strong>ページ {String(panelLinkMode.pageNumber).padStart(2, '0')} · {panelDisplayLabel(panelLinkMode.panelId)}</strong><span>このコマで使う小道具を選択してください。</span></div>
      <button class="secondary-button" onClick={onReturnToPanel}><ArrowLeft size={15} />ネームに戻る</button>
    </div>}
    <div class="material-catalogs">
      {renderCatalog('episode', 'エピソード限定')}
      {renderCatalog('series', 'シリーズ共通')}
    </div>
  </EditorShell>;
}

function EditorShell({ eyebrow, title, description, action, children, embedded = false }: { eyebrow: string; title: string; description: string; action?: ComponentChildren; children: ComponentChildren; embedded?: boolean }) {
  return <div class={`document-editor${embedded ? ' is-embedded' : ''}`}>{!embedded && <div class="document-editor-head"><div><span class="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{description}</p></div><div class="document-head-actions">{action}</div></div>}<div class="document-editor-body">{children}</div></div>;
}
