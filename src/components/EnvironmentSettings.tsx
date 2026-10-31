import AgentSettings from './AgentSettings';
import LocalImageModelSettings from './LocalImageModelSettings';
import type { AgentPreferences } from '../lib/agentPreferences';
import { Bot, CircleHelp, BookOpen, Database, Eye, EyeOff, FilePenLine, FolderArchive, FolderOpen, Paintbrush, RefreshCw, ShieldCheck, Trash2 } from 'lucide-preact';
import { useRef, useState } from 'preact/hooks';
import { CURRENT_NDM_SCHEMA_VERSION } from '../lib/manga';
import { DEFAULT_LOCAL_MODEL_PREFERENCES, loadLocalModelPreferences, saveLocalModelPreferences, type LocalModelPreferences } from '../lib/localModelPreferences';
import { loadGenerationPreferences, saveGenerationPreferences, type GenerationPreferences } from '../lib/generationPreferences';
import { deleteGenerationCache, listGenerationCaches, type GenerationCacheSummary } from '../lib/localBridge';
import type { MangaDocument } from '../types';
import ArtworkSettings from './ArtworkSettings';
import FinishLayoutSettings, { FinishTextSettings } from './FinishLayoutSettings';
import { Field, SectionTitle } from './Fields';
import type { PaintCursorMode } from '../lib/paintPreferences';
import FontFamilyPicker from './FontFamilyPicker';
import type { PcFontFamily } from '../lib/bubbleFonts';
import { changeCanvasDefaultFont } from '../lib/canvasText';

const SETTINGS_TABS = [
  { id: 'page', label: 'レイアウト', icon: BookOpen },
  { id: 'drawing', label: '手描き・編集', icon: Paintbrush },
  { id: 'generation', label: '生成ルール', icon: RefreshCw },
  { id: 'omay', label: '作画設定（YAML）', icon: FilePenLine },
  { id: 'display', label: '表示', icon: Eye },
  { id: 'ai', label: 'モデル設定', icon: Bot },
  { id: 'data', label: 'データ管理', icon: FolderArchive },
] as const;
type SettingsTab = typeof SETTINGS_TABS[number]['id'];
type CacheDeleteTarget = { scope: 'owner'; ownerKind: 'series' | 'one-shot'; ownerId: string; label: string }
  | { scope: 'profile'; profileId: string; label: string };

function formatCacheSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

function formatCacheDate(value: string) {
  return new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium' }).format(new Date(value));
}

interface Props {
  initialTab?: SettingsTab;
  prepareDocumentSettings?: () => Promise<void>;
  onOpenAgent?:()=>void;
  hasDocument?: boolean;
  onExportOmny?: () => void;
  agentProfile?:AgentPreferences; onChangeAgentProfile?:(profile:AgentPreferences)=>void;
  historySteps?:number;onChangeHistorySteps?:(value:number)=>void;
  editGuide?:boolean; onChangeEditGuide?:(enabled:boolean)=>void;
  paintSmoothing?:number; onChangePaintSmoothing?:(value:number)=>void;
  paintCursorMode?:PaintCursorMode; onChangePaintCursorMode?:(value:PaintCursorMode)=>void;
  paintBleedPx?: number;
  onChangePaintBleed?: (value:number)=>void;
  document: MangaDocument;
  onChangeDocument: (document: MangaDocument) => void;
  onNotify: (message: string) => void;
  showGuides: boolean;
  spreadView: boolean;
  pageCount: number;
  frameLineWidthMm: number;
  rowGapMm: number;
  columnGapMm: number;
  onChangeShowGuides: (enabled: boolean) => void;
  onChangeSpreadView: (enabled: boolean) => void;
  onChangeFrameLineWidth: (value: number) => void;
  onChangeRowGap: (value: number) => void;
  onChangeColumnGap: (value: number) => void;
  fontFamilies?: readonly PcFontFamily[];
  onRequestFonts?: () => void;
  saveDirectory?: string;
  projectBusy?: boolean;
  onChangeSaveDirectory?: () => void;
}

export default function EnvironmentSettings({ initialTab, prepareDocumentSettings, onOpenAgent, hasDocument = true, onExportOmny, agentProfile,onChangeAgentProfile,historySteps=50,onChangeHistorySteps,editGuide=true,onChangeEditGuide,paintSmoothing=0,onChangePaintSmoothing,paintCursorMode='circle',onChangePaintCursorMode,paintBleedPx=200, onChangePaintBleed, document, onChangeDocument, onNotify, showGuides, spreadView, pageCount, frameLineWidthMm, rowGapMm, columnGapMm, onChangeShowGuides, onChangeSpreadView, onChangeFrameLineWidth, onChangeRowGap, onChangeColumnGap, fontFamilies=[], onRequestFonts, saveDirectory, projectBusy, onChangeSaveDirectory }: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab ?? (hasDocument ? 'page' : 'display'));
  const tabChanging=useRef(false);
  const [preparingTab,setPreparingTab]=useState(false);
  const [generationCaches, setGenerationCaches] = useState<GenerationCacheSummary | null>(null);
  const [generationCacheStatus, setGenerationCacheStatus] = useState('');
  const [generationCacheEmptyMessage, setGenerationCacheEmptyMessage] = useState(false);
  const [generationCacheBusy, setGenerationCacheBusy] = useState(false);
  const [cacheDeleteTarget, setCacheDeleteTarget] = useState<CacheDeleteTarget | null>(null);
  const [localModelPreferences, setLocalModelPreferences] = useState<LocalModelPreferences>(() => {
    try { return loadLocalModelPreferences(window.localStorage); } catch { return { ...DEFAULT_LOCAL_MODEL_PREFERENCES }; }
  });
  const [generationPreferences, setGenerationPreferences] = useState(() => {
    try { return loadGenerationPreferences(window.localStorage); } catch { return loadGenerationPreferences(); }
  });
  const [modelSettingsError, setModelSettingsError] = useState('');
  const [localModelError, setLocalModelError] = useState('');
  const updateGenerationPreferences = (next: GenerationPreferences) => {
    try {
      setGenerationPreferences(saveGenerationPreferences(window.localStorage, next));
      setModelSettingsError('');
    } catch (error) {
      // Reapply the last saved values even when a repeated failure has the same error text.
      setGenerationPreferences(current => ({ ...current }));
      setModelSettingsError(error instanceof Error ? error.message : 'モデル設定を保存できませんでした');
    }
  };
  const updateLocalModelPreferences = (patch: Partial<LocalModelPreferences>) => {
    const next = { ...localModelPreferences, ...patch };
    setLocalModelPreferences(next);
    try {
      saveLocalModelPreferences(window.localStorage, next);
      setLocalModelError('');
    } catch (error) {
      setLocalModelError(error instanceof Error ? error.message : 'ローカルモデル設定を保存できませんでした');
    }
  };
  const refreshGenerationCaches = async () => {
    setGenerationCacheBusy(true);
    setGenerationCacheStatus('');
    setGenerationCacheEmptyMessage(false);
    try {
      setGenerationCaches(await listGenerationCaches());
      setCacheDeleteTarget(null);
    } catch (error) {
      setGenerationCacheStatus(error instanceof Error ? error.message : '生成キャッシュを確認できませんでした');
    } finally {
      setGenerationCacheBusy(false);
    }
  };
  const selectTab = async (tab: SettingsTab, focus?: HTMLElement) => {
    if(tabChanging.current)return;
    tabChanging.current=true;setPreparingTab(true);
    try {
      if(prepareDocumentSettings&&['page','generation','omay','data'].includes(tab))await prepareDocumentSettings();
      setActiveTab(tab);
      focus?.querySelector<HTMLButtonElement>(`#environment-tab-${tab}`)?.focus();
      if (tab === 'data' && !generationCaches && !generationCacheBusy) void refreshGenerationCaches();
    } catch(error) {onNotify(error instanceof Error?error.message:'描画を確定できませんでした');}
    finally {tabChanging.current=false;setPreparingTab(false);}
  };
  const confirmCacheDeletion = async (target: CacheDeleteTarget) => {
    setGenerationCacheBusy(true);
    setGenerationCacheStatus('');
    setGenerationCacheEmptyMessage(false);
    try {
      const result = await deleteGenerationCache(target.scope === 'owner'
        ? { scope: 'owner', ownerKind: target.ownerKind, ownerId: target.ownerId }
        : { scope: 'profile', profileId: target.profileId });
      setGenerationCaches(result.summary);
      setCacheDeleteTarget(null);
      onNotify(result.deleted ? `${target.label}の生成キャッシュを削除しました` : '削除対象の生成キャッシュはありませんでした');
    } catch (error) {
      setGenerationCacheStatus(error instanceof Error ? error.message : '生成キャッシュを削除できませんでした');
    } finally {
      setGenerationCacheBusy(false);
    }
  };
  const availableTabs = SETTINGS_TABS.filter(item => hasDocument || !['page','generation','omay'].includes(item.id));
  const currentOwnerKind = document.manga.meta.series_id ? 'series' as const : 'one-shot' as const;
  const currentOwnerId = document.manga.meta.series_id || document.manga.meta.episode_id;
  const currentCacheOwners = generationCaches?.profiles.flatMap(profile => profile.owners)
    .filter(owner => owner.kind === currentOwnerKind && owner.id === currentOwnerId) ?? [];
  const currentCacheEntryCount = currentCacheOwners.reduce((sum, owner) => sum + owner.entryCount, 0);
  const currentCacheByteSize = currentCacheOwners.reduce((sum, owner) => sum + owner.byteSize, 0);
  const currentOwnerLabel = currentOwnerKind === 'series' ? 'このシリーズ' : 'この読み切り';
  return <div class="document-editor">
    <div class="document-editor-head">
      <div><span class="eyebrow">PREFERENCES</span><h2>環境設定</h2><p>{hasDocument ? '作品のレイアウト・手描き・生成ルールと、この端末での表示・利用設定を切り替えて調整します。' : 'この端末での表示・利用設定を調整します。'}</p></div>
    </div>
    <div class="document-editor-body">
      <div class="environment-tabs" role="tablist" aria-label="環境設定の分類" onKeyDown={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const index = availableTabs.findIndex((item) => item.id === activeTab);
        let nextIndex: number;
        if (event.key === 'ArrowRight') nextIndex = (index + 1) % availableTabs.length;
        else if (event.key === 'ArrowLeft') nextIndex = (index + availableTabs.length - 1) % availableTabs.length;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = availableTabs.length - 1;
        else return;
        event.preventDefault();
        event.stopPropagation();
        const next = availableTabs[nextIndex].id;
        void selectTab(next,event.currentTarget);
      }}>
        {availableTabs.map(({ id, label, icon: Icon }) => <button
          key={id}
          type="button"
          role="tab"
          id={`environment-tab-${id}`}
          aria-controls={`environment-panel-${id}`}
          aria-selected={activeTab === id}
          tabIndex={activeTab === id ? 0 : -1}
          aria-disabled={preparingTab}
          onClick={() => selectTab(id)}
        ><Icon size={16} aria-hidden="true" />{label}</button>)}
      </div>
      {hasDocument && <section class="environment-tab-panel" id="environment-panel-page" role="tabpanel" aria-labelledby="environment-tab-page" tabIndex={0} hidden={activeTab !== 'page'}>
        <FinishLayoutSettings document={document} onChange={onChangeDocument} onNotify={onNotify} />
        <SectionTitle title="文字" />
        <p class="environment-settings-note">新しく追加する文字の基本書体です。配置済みの文字は変更しません。</p>
        <Field label="作品の基本書体" wide>
          <FontFamilyPicker value={document.manga.meta.font} families={fontFamilies} label="作品の基本書体" onOpen={onRequestFonts} onChange={font=>{
            const next=structuredClone(document);
            if(changeCanvasDefaultFont(next,font))onChangeDocument(next);
          }}/>
        </Field>
        <SectionTitle title="コマ" />
        <p class="environment-settings-note">この作品全体に適用されます。他の作品の設定は変更しません。</p>
        <div class="field-grid">
          <Field label="コマ枠線幅" hint="mm"><input type="number" min="0.1" max="5" step="0.1" value={frameLineWidthMm} onInput={(event) => onChangeFrameLineWidth(Number(event.currentTarget.value))} /></Field>
          <Field label="上下のコマ間隔" hint="mm"><input type="number" min="0" max="20" step="0.5" value={rowGapMm} onInput={(event) => onChangeRowGap(Number(event.currentTarget.value))} /></Field>
          <Field label="左右のコマ間隔" hint="mm"><input type="number" min="0" max="20" step="0.5" value={columnGapMm} onInput={(event) => onChangeColumnGap(Number(event.currentTarget.value))} /></Field>
        </div>
      </section>}
      <section class="environment-tab-panel" id="environment-panel-drawing" role="tabpanel" aria-labelledby="environment-tab-drawing" tabIndex={0} hidden={activeTab !== 'drawing'}>
        <SectionTitle title="手描き・編集" />
        <p class="environment-settings-note">ペン入力と編集履歴に関する、この端末の設定です。生成ルールや作画設定の受け渡しには影響しません。</p>
        <Field label="ぬりたし"><div class="paint-bleed-setting"><input aria-label="ぬりたし" type="number" min="0" max="4000" step="1" value={paintBleedPx} onChange={async event=>{
          const value=event.currentTarget.valueAsNumber;
          const input=event.currentTarget;
          if(Number.isSafeInteger(value)&&value>=0&&value<=4000){
            if(value===paintBleedPx)return;
            try {await prepareDocumentSettings?.();onChangePaintBleed?.(value);}
            catch(error){input.value=String(paintBleedPx);onNotify(error instanceof Error?error.message:'描画を確定できませんでした');}
          }
          else {event.currentTarget.value=String(paintBleedPx);onNotify('ぬりたしは0〜4000pxの整数で指定してください');}
        }}/><span>px</span></div></Field>
        <Field label="手ぶれ補正"><input aria-label="手ぶれ補正" type="number" min="0" max="15" step="1" value={paintSmoothing} onChange={e=>{const value=e.currentTarget.valueAsNumber;if(Number.isInteger(value)&&value>=0&&value<=15)onChangePaintSmoothing?.(value);else e.currentTarget.value=String(paintSmoothing);}}/></Field>
        <Field label="ペンカーソル"><div class="environment-paint-cursor" role="group" aria-label="ペンカーソル"><button type="button" aria-pressed={paintCursorMode==='circle'} onClick={()=>onChangePaintCursorMode?.('circle')}>円</button><button type="button" aria-pressed={paintCursorMode==='crosshair'} onClick={()=>onChangePaintCursorMode?.('crosshair')}>十字</button></div></Field>
        <Field label="履歴の保持ステップ数"><input aria-label="履歴の保持ステップ数" type="number" min="1" max="1000" step="1" value={historySteps} onChange={event=>{const value=event.currentTarget.valueAsNumber;if(Number.isSafeInteger(value)&&value>=1&&value<=1000)onChangeHistorySteps?.(value);else{event.currentTarget.value=String(historySteps);onNotify('履歴の保持数は1〜1000の整数で指定してください');}}}/></Field>
        <p class="environment-settings-note">撮影・ペン・配置の操作で共通の履歴です。既定は50段階。古い履歴から消え、作品を閉じるとリセットされます。</p>
      </section>
      {hasDocument&&<section class="environment-tab-panel" id="environment-panel-generation" role="tabpanel" aria-labelledby="environment-tab-generation" tabIndex={0} hidden={activeTab!=='generation'}>
        <SectionTitle title="生成ルール" />
        <ArtworkSettings section="rules" document={document} onChange={onChangeDocument} onNotify={onNotify}/>
        <FinishTextSettings document={document} onChange={onChangeDocument} onNotify={onNotify}/>
      </section>}
      {hasDocument&&<section class="environment-tab-panel" id="environment-panel-omay" role="tabpanel" aria-labelledby="environment-tab-omay" tabIndex={0} hidden={activeTab!=='omay'}>
        <SectionTitle title="作画設定の受け渡し（YAML）" />
        <p class="environment-settings-note">生成ルールの候補・控えをYAMLで受け渡します。データ管理にある作品の構成・セリフの書き出しとは別です。</p>
        <ArtworkSettings section="omay" document={document} onChange={onChangeDocument} onNotify={onNotify}/>
      </section>}
      <section class="environment-tab-panel" id="environment-panel-display" role="tabpanel" aria-labelledby="environment-tab-display" tabIndex={0} hidden={activeTab !== 'display'}>
        <SectionTitle title="ネーム表示" />
        <p class="environment-settings-note">この端末の表示だけを変えます。作品データは変更しません。</p>
        <div class="environment-setting-list">
          <label class="environment-setting-row">
            <span class="environment-setting-icon"><CircleHelp size={20}/></span>
            <span><strong>編集ガイド</strong></span>
            <input aria-label="編集ガイド" type="checkbox" checked={editGuide} onChange={event=>onChangeEditGuide?.(event.currentTarget.checked)}/>
          </label>
          <label class="environment-setting-row">
            <span class="environment-setting-icon">{showGuides ? <Eye size={20} /> : <EyeOff size={20} />}</span>
            <span><strong>配置ガイド</strong><small>人物・吹き出しの配置枠を表示します。</small></span>
            <input type="checkbox" checked={showGuides} onChange={(event) => onChangeShowGuides(event.currentTarget.checked)} />
          </label>
          <label class="environment-setting-row">
            <span class="environment-setting-icon"><BookOpen size={20} /></span>
            <span><strong>見開き表示</strong><small>{pageCount < 2 ? '2ページ目を追加すると、右綴じの見開きで表示します。' : '右綴じの固定ペアを並べます。編集対象はクリックで切り替えられます。'}</small></span>
            <input type="checkbox" checked={spreadView} onChange={(event) => onChangeSpreadView(event.currentTarget.checked)} />
          </label>
        </div>
      </section>
      <section class="environment-tab-panel" id="environment-panel-ai" role="tabpanel" aria-labelledby="environment-tab-ai" tabIndex={0} hidden={activeTab !== 'ai'}>
        <SectionTitle title="生成に使うモデル" />
        <p class="environment-settings-note">設定は変更するとこの端末に自動保存されます。生成する場所はキャンバスの右クリックから選びます。</p>
        <fieldset class="artwork-mode-options">
          <legend>実行する場所</legend>
          {([{ value: 'cloud', label: 'クラウド', description: 'APIまたはCodexなどのエージェントを利用します。' },
            { value: 'local', label: 'ローカル', description: 'この環境に用意したモデルを利用します。' }] as const).map(option => <label class="artwork-mode-option" key={option.value}>
            <input type="radio" name="generation-execution" value={option.value} checked={generationPreferences.execution === option.value}
              onChange={event => { if (event.currentTarget.checked) updateGenerationPreferences({ ...generationPreferences, execution: option.value }); }} />
            <span><strong>{option.label}</strong><small>{option.description}</small></span>
          </label>)}
        </fieldset>
        {generationPreferences.execution === 'local' ? <section aria-label="ローカルモデル設定">
          <LocalImageModelSettings onOpenAgent={onOpenAgent} endpoint={localModelPreferences.comfyuiUrl}
            workflowId={generationPreferences.local.workflowId}
            onWorkflowChange={workflowId => updateGenerationPreferences({ ...generationPreferences, local: { ...generationPreferences.local, workflowId } })}
            onChange={comfyuiUrl => updateLocalModelPreferences({ comfyuiUrl })} />
          <details class="environment-settings-details">
            <summary>文章・画像解析のモデル</summary>
            <div class="field-grid">
              <Field label="文章LLM" hint="登録済みのモデル名" wide>
                <input aria-label="文章LLM" value={localModelPreferences.llmAlias} spellcheck={false} onInput={event => updateLocalModelPreferences({ llmAlias: event.currentTarget.value })} />
                <small>起動済みのLLMを共用します。起動していないときは、このモデルを必要な間だけ起動します。</small>
              </Field>
              <Field label="画像VLM" hint="保存済みのHugging FaceモデルID" wide>
                <input aria-label="画像VLM" value={localModelPreferences.vlmModelId} spellcheck={false} onInput={event => updateLocalModelPreferences({ vlmModelId: event.currentTarget.value })} />
                <small>人物資料や演技の画像解析に使います。</small>
              </Field>
            </div>
          </details>
          {localModelError && <p role="alert">入力を確認してください。直前の有効な設定を保持しています。{localModelError}</p>}
          {agentProfile&&onChangeAgentProfile&&<AgentSettings profile={agentProfile} onChange={onChangeAgentProfile}/>}
        </section> : <section aria-label="クラウドモデル設定">
          <fieldset class="artwork-mode-options">
            <legend>利用方法</legend>
            {([{ value: 'api', label: 'API' }, { value: 'agent', label: 'エージェント' }] as const).map(option => <label class="artwork-mode-option" key={option.value}>
              <input type="radio" name="cloud-generation-method" value={option.value} checked={generationPreferences.cloud.method === option.value}
                onChange={event => { if (event.currentTarget.checked) updateGenerationPreferences({ ...generationPreferences, cloud: { ...generationPreferences.cloud, method: option.value } }); }} />
              <span><strong>{option.label}</strong></span>
            </label>)}
          </fieldset>
          {generationPreferences.cloud.method === 'api' ? <div class="field-grid">
            <Field label="API接続先" wide><input aria-label="API接続先" type="url" maxLength={500} value={generationPreferences.cloud.apiEndpoint} placeholder="https://…" spellcheck={false}
              onInput={event => updateGenerationPreferences({ ...generationPreferences, cloud: { ...generationPreferences.cloud, apiEndpoint: event.currentTarget.value } })} /></Field>
            <Field label="APIモデル" wide><input aria-label="APIモデル" maxLength={200} value={generationPreferences.cloud.apiModel} spellcheck={false}
              onInput={event => updateGenerationPreferences({ ...generationPreferences, cloud: { ...generationPreferences.cloud, apiModel: event.currentTarget.value } })} /></Field>
            <p class="environment-settings-note">APIは現在未接続です。接続先とモデル名を保存できます。認証情報は利用先で管理します。</p>
          </div> : <div class="field-grid">
            <Field label="エージェント" wide><select aria-label="クラウドエージェント" value={generationPreferences.cloud.agent}
              onChange={event => updateGenerationPreferences({ ...generationPreferences, cloud: { ...generationPreferences.cloud, agent: event.currentTarget.value === 'other' ? 'other' : 'codex' } })}>
              <option value="codex">Codex</option><option value="other">その他</option>
            </select></Field>
            {generationPreferences.cloud.agent === 'other' && <Field label="エージェント名" wide><input aria-label="エージェント名" maxLength={120} value={generationPreferences.cloud.agentName}
              onInput={event => updateGenerationPreferences({ ...generationPreferences, cloud: { ...generationPreferences.cloud, agentName: event.currentTarget.value } })} /></Field>}
            <p class="environment-settings-note">生成指示と参照画像を書き出し、選んだエージェントへ渡します。利用するアカウントはエージェント側で設定します。</p>
          </div>}
          <label class="environment-setting-row">
            <span class="environment-setting-icon"><ShieldCheck size={20} /></span>
            <span><strong>成人指定作品での利用規約を確認済み</strong><small>成人指定作品でもクラウドモデルを使う場合に必要です。この端末では一度だけ確認します。</small></span>
            <input type="checkbox" checked={generationPreferences.cloud.adultTermsConfirmed} onChange={event => updateGenerationPreferences({ ...generationPreferences, cloud: { ...generationPreferences.cloud, adultTermsConfirmed: event.currentTarget.checked } })} />
          </label>
        </section>}
        {modelSettingsError && <p role="alert">設定を保存できませんでした。{modelSettingsError}</p>}
      </section>
      <section class="environment-tab-panel" id="environment-panel-data" role="tabpanel" aria-labelledby="environment-tab-data" tabIndex={0} hidden={activeTab !== 'data'}>
        <section class="origin-data-manager" aria-labelledby="origin-data-title">
          <div class="data-management-heading">
            <div><FilePenLine size={18} aria-hidden="true" /><h3 id="origin-data-title">オリジンデータ</h3></div>
          </div>
          <div class="origin-data-row">
            <div class="origin-data-current"><strong>作品フォルダ</strong><span>{hasDocument ? saveDirectory || '未選択 — 保存時にフォルダを選びます。' : '作品を開くと保存先を確認できます。'}</span></div>
            <button type="button" class="secondary-button" disabled={!hasDocument || projectBusy} onClick={onChangeSaveDirectory}><FolderOpen size={16} />保存先フォルダを変更</button>
          </div>
        </section>
        <section class="origin-data-manager" aria-labelledby="omny-export-title">
          <div class="data-management-heading"><h3 id="omny-export-title">構成データ（YAML）</h3></div>
          <p class="environment-settings-note">作品の構成・セリフをYAMLファイルに書き出します。画像原本や作画設定は含みません。</p>
          <button type="button" class="secondary-button" disabled={!hasDocument || projectBusy} onClick={onExportOmny}>構成データを書き出す</button>
        </section>
        <section class="generation-cache-manager" aria-labelledby="generation-cache-title">
          <div class="data-management-heading">
            <div><Database size={18} aria-hidden="true" /><h3 id="generation-cache-title">生成キャッシュ</h3></div>
          </div>
          <p class="environment-settings-note">画像生成を速くするための一時データです。削除しても作品や参照画像は消えず、必要なときに作り直されます。</p>
          <p class="environment-settings-note">シリーズは自動で削除されません。読み切りは最後に使ってから30日後に自動で削除されます。</p>
          {generationCaches && <>
            {hasDocument && <div class="generation-cache-current">
              <div class="generation-cache-current-size"><span>現在の保存容量</span><strong>{formatCacheSize(currentCacheByteSize)}</strong></div>
              <div class="generation-cache-delete-row"><span>{currentOwnerLabel}のキャッシュを削除する</span>
                <button type="button" class="secondary-button is-danger" disabled={generationCacheBusy || !currentOwnerId}
                  onClick={() => {
                    setGenerationCacheStatus('');
                    if (currentCacheEntryCount === 0) {
                      setCacheDeleteTarget(null);
                      setGenerationCacheEmptyMessage(true);
                      return;
                    }
                    setGenerationCacheEmptyMessage(false);
                    if (currentOwnerId) setCacheDeleteTarget({ scope: 'owner', ownerKind: currentOwnerKind, ownerId: currentOwnerId, label: currentOwnerLabel });
                  }}>
                  <Trash2 size={14} aria-hidden="true" />削除
                </button>
              </div>
            </div>}
            {generationCacheEmptyMessage && <p class="generation-cache-empty-message" role="status">削除できるキャッシュはありません。</p>}
            {cacheDeleteTarget?.scope === 'owner' && <div class="generation-cache-confirm" role="alert">
              <p><strong>本当に削除しますか？</strong><br />{currentOwnerLabel}の生成キャッシュ（{formatCacheSize(currentCacheByteSize)}）を削除します。作品と参照画像は残ります。</p>
              <div><button type="button" class="secondary-button is-danger" disabled={generationCacheBusy} onClick={() => void confirmCacheDeletion(cacheDeleteTarget)}>はい、削除する</button>
                <button type="button" class="secondary-button" disabled={generationCacheBusy} onClick={() => setCacheDeleteTarget(null)}>いいえ</button></div>
            </div>}
            {generationCaches.profiles.length > 0 && <details class="environment-settings-details generation-cache-profiles">
              <summary>モデル別のキャッシュを管理</summary>
              <p class="environment-settings-note">同じモデル設定で作ったキャッシュを、作品をまたいで確認・削除できます。</p>
              <p class="generation-cache-path"><strong>保存場所</strong><code>{generationCaches.root}</code></p>
              {generationCaches.profiles.map(profile => <article class="generation-cache-profile" key={profile.profileId}>
                <div class="generation-cache-profile-head"><span><strong>{profile.label}</strong><small>{profile.entryCount}資料・{formatCacheSize(profile.byteSize)}・profile {profile.profileId.slice(0, 12)}</small></span>
                  <button type="button" class="secondary-button is-danger" disabled={generationCacheBusy}
                    onClick={() => {
                      setGenerationCacheEmptyMessage(false);
                      setCacheDeleteTarget({ scope: 'profile', profileId: profile.profileId, label: profile.label });
                    }}>
                    <Trash2 size={14} aria-hidden="true" />このモデル設定のキャッシュを削除
                  </button></div>
                <ul>{profile.owners.map(owner => <li key={`${owner.kind}:${owner.id}`}><span><strong>{owner.label}</strong><small>{owner.kind === 'series'
                  ? 'シリーズ・自動削除なし'
                  : `読み切り・${formatCacheDate(owner.expiresAt!)}に期限`}</small></span><span>{owner.entryCount}資料・{formatCacheSize(owner.byteSize)}</span></li>)}</ul>
                {cacheDeleteTarget?.scope === 'profile' && cacheDeleteTarget.profileId === profile.profileId && <div class="generation-cache-confirm" role="alert">
                  <p><strong>本当に削除しますか？</strong><br />このモデル設定の生成キャッシュを、すべての作品分まとめて削除します。作品と参照画像は残ります。</p>
                  <div><button type="button" class="secondary-button is-danger" disabled={generationCacheBusy} onClick={() => void confirmCacheDeletion(cacheDeleteTarget)}>はい、削除する</button>
                    <button type="button" class="secondary-button" disabled={generationCacheBusy} onClick={() => setCacheDeleteTarget(null)}>いいえ</button></div>
                </div>}
              </article>)}
            </details>}
            {generationCaches.invalidEntryCount > 0 && <p class="generation-cache-warning">内容を確認できないキャッシュが{generationCaches.invalidEntryCount}件あります。必要な場合は参照画像から作り直されます。</p>}
          </>}
          {!generationCaches && !generationCacheStatus && <p class="environment-settings-note">{generationCacheBusy ? '保存容量を確認しています…' : 'データ管理を開くと、現在の保存容量を確認します。'}</p>}
          {generationCacheStatus && <p class="generation-cache-warning" role="status">{generationCacheStatus}</p>}
        </section>
        {hasDocument && document.manga.schema_version !== CURRENT_NDM_SCHEMA_VERSION && <details class="environment-settings-details">
          <summary>作品ファイルの形式情報</summary>
          <p class="environment-settings-note">作品の形式情報が現在のアプリと異なります。本文やコマを変えず、形式情報のみを更新できます。</p>
          <button type="button" class="secondary-button" onClick={() => {
            const next = structuredClone(document);
            next.manga.schema_version = CURRENT_NDM_SCHEMA_VERSION;
            onChangeDocument(next);
            onNotify('作品ファイルの形式情報を更新しました');
          }}><RefreshCw size={16} />形式情報を更新</button>
        </details>}
      </section>
    </div>
  </div>;
}
