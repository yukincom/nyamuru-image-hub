import { type BaseProps, mutateDocument, type MaterialPanelLinkMode, createMaterial, setMaterialScope, duplicateMaterial } from './document/editing.ts';
import type { MangaDocument, MaterialScope } from '../types';
import { EditorShell } from './document/EditorShell.tsx';
import { SectionTitle, Field } from './Fields';
import { getWorkStylePrompt, setWorkStylePrompt } from '../lib/artworkRules.ts';
import { Plus, Building2, Check, Copy, Trash2, Save, ArrowLeft, Box } from 'lucide-preact';
import { renameMaterial } from '../lib/catalogModel.ts';
import BackgroundModelPicker from './BackgroundModelPicker';
import { panelDisplayLabel } from '../lib/displayLabels.ts';

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

export { CharactersEditor } from './document/CharactersEditor.tsx';
