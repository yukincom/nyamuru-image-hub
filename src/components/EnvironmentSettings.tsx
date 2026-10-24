import AgentSettings from './AgentSettings';
import LocalImageModelSettings from './LocalImageModelSettings';
import type { AgentPreferences } from '../lib/agentPreferences';
import { Bot, CircleHelp, BookOpen, Cloud, Database, Eye, EyeOff, FilePenLine, FolderArchive, FolderOpen, Paintbrush, RefreshCw, ShieldCheck, Trash2, Type } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { BUBBLE_FONT_PRESETS } from '../lib/bubbleFonts';
import { CURRENT_NDM_SCHEMA_VERSION } from '../lib/manga';
import { DEFAULT_LOCAL_MODEL_PREFERENCES, loadLocalModelPreferences, saveLocalModelPreferences, type LocalModelPreferences } from '../lib/localModelPreferences';
import { DEFAULT_CLOUD_MODEL_PREFERENCES, loadCloudModelPreferences, saveCloudModelPreferences, type CloudModelPreferences } from '../lib/modelPrivacy';
import { deleteGenerationCache, listGenerationCaches, type GenerationCacheSummary } from '../lib/localBridge';
import type { MangaDocument } from '../types';
import ArtworkSettings from './ArtworkSettings';
import FinishLayoutSettings, { FinishTextSettings } from './FinishLayoutSettings';
import { Field, SectionTitle } from './Fields';

const SETTINGS_TABS = [
  { id: 'page', label: 'レイアウト', icon: BookOpen },
  { id: 'text', label: 'テキスト', icon: Type },
  { id: 'artwork', label: '作画方法', icon: Paintbrush },
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
  onOpenAgent?:()=>void;
  hasDocument?: boolean;
  onExportOmny?: () => void;
  agentProfile?:AgentPreferences; onChangeAgentProfile?:(profile:AgentPreferences)=>void;
  historySteps?:number;onChangeHistorySteps?:(value:number)=>void;
  editGuide?:boolean; onChangeEditGuide?:(enabled:boolean)=>void;
  paintSmoothing?:number; onChangePaintSmoothing?:(value:number)=>void;
  paintBleedPx?: number;
  onChangePaintBleed?: (value:number)=>void;
  document: MangaDocument;
  onChangeDocument: (document: MangaDocument) => void;
  onNotify: (message: string) => void;
  showGuides: boolean;
  spreadView: boolean;
  pageCount: number;
  defaultFont: string;
  bubbleLineWidthMm: number;
  frameLineWidthMm: number;
  rowGapMm: number;
  columnGapMm: number;
  onChangeShowGuides: (enabled: boolean) => void;
  onChangeSpreadView: (enabled: boolean) => void;
  onChangeDefaultFont: (font: string) => void;
  onChangeBubbleLineWidth: (value: number) => void;
  onChangeFrameLineWidth: (value: number) => void;
  onChangeRowGap: (value: number) => void;
  onChangeColumnGap: (value: number) => void;
  saveDirectory?: string;
  projectBusy?: boolean;
  onChangeSaveDirectory?: () => void;
}

export default function EnvironmentSettings({ onOpenAgent, hasDocument = true, onExportOmny, agentProfile,onChangeAgentProfile,historySteps=50,onChangeHistorySteps,editGuide=true,onChangeEditGuide,paintSmoothing=0,onChangePaintSmoothing,paintBleedPx=200, onChangePaintBleed, document, onChangeDocument, onNotify, showGuides, spreadView, pageCount, defaultFont, bubbleLineWidthMm, frameLineWidthMm, rowGapMm, columnGapMm, onChangeShowGuides, onChangeSpreadView, onChangeDefaultFont, onChangeBubbleLineWidth, onChangeFrameLineWidth, onChangeRowGap, onChangeColumnGap, saveDirectory, projectBusy, onChangeSaveDirectory }: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(hasDocument ? 'page' : 'display');
  const [localFonts, setLocalFonts] = useState<string[]>([]);
  const [fontStatus, setFontStatus] = useState('');
  const [generationCaches, setGenerationCaches] = useState<GenerationCacheSummary | null>(null);
  const [generationCacheStatus, setGenerationCacheStatus] = useState('');
  const [generationCacheEmptyMessage, setGenerationCacheEmptyMessage] = useState(false);
  const [generationCacheBusy, setGenerationCacheBusy] = useState(false);
  const [cacheDeleteTarget, setCacheDeleteTarget] = useState<CacheDeleteTarget | null>(null);
  const [cloudPreferences, setCloudPreferences] = useState<CloudModelPreferences>(() => {
    try { return loadCloudModelPreferences(window.localStorage); } catch { return { ...DEFAULT_CLOUD_MODEL_PREFERENCES }; }
  });
  const [localModelPreferences, setLocalModelPreferences] = useState<LocalModelPreferences>(() => {
    try { return loadLocalModelPreferences(window.localStorage); } catch { return { ...DEFAULT_LOCAL_MODEL_PREFERENCES }; }
  });
  const updateCloudPreferences = (patch: Partial<CloudModelPreferences>) => {
    const next = { ...cloudPreferences, ...patch };
    setCloudPreferences(next);
    try { saveCloudModelPreferences(window.localStorage, next); } catch { /* private mode */ }
  };
  const commitLocalModelPreferences = () => {
    try {
      const next = saveLocalModelPreferences(window.localStorage, localModelPreferences);
      setLocalModelPreferences(next);
      onNotify('この端末のローカルモデル設定を保存しました');
    } catch (error) {
      try { setLocalModelPreferences(loadLocalModelPreferences(window.localStorage)); }
      catch { setLocalModelPreferences({ ...DEFAULT_LOCAL_MODEL_PREFERENCES }); }
      onNotify(error instanceof Error ? error.message : 'ローカルモデル設定を保存できませんでした');
    }
  };
  const loadLocalFonts = async () => {
    const queryLocalFonts = (window as typeof window & {
      queryLocalFonts?: () => Promise<Array<{ family: string }>>;
    }).queryLocalFonts;
    if (!queryLocalFonts) {
      setFontStatus('このブラウザでは一覧取得に対応していません。書体名を直接入力できます。');
      return;
    }
    try {
      const fonts = await queryLocalFonts();
      const families = [...new Set(fonts.map((font) => font.family.trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'ja'));
      setLocalFonts(families);
      setFontStatus(families.length
        ? `${families.length}書体を読み込みました。フォントファイルは送信しません。`
        : 'フォント一覧を取得できませんでした。書体名を直接入力できます。');
    } catch (error) {
      setFontStatus(error instanceof Error && error.name === 'NotAllowedError'
        ? 'PC内フォントの参照が許可されませんでした。'
        : 'PC内フォントを読み込めませんでした。');
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
  const selectTab = (tab: SettingsTab) => {
    setActiveTab(tab);
    if (tab === 'data' && !generationCaches && !generationCacheBusy) void refreshGenerationCaches();
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
  const availableTabs = SETTINGS_TABS.filter(item => hasDocument || (item.id !== 'page' && item.id !== 'text'));
  const fontOptions = [...new Set([...BUBBLE_FONT_PRESETS, ...localFonts])];
  const currentOwnerKind = document.manga.meta.series_id ? 'series' as const : 'one-shot' as const;
  const currentOwnerId = document.manga.meta.series_id || document.manga.meta.episode_id;
  const currentCacheOwners = generationCaches?.profiles.flatMap(profile => profile.owners)
    .filter(owner => owner.kind === currentOwnerKind && owner.id === currentOwnerId) ?? [];
  const currentCacheEntryCount = currentCacheOwners.reduce((sum, owner) => sum + owner.entryCount, 0);
  const currentCacheByteSize = currentCacheOwners.reduce((sum, owner) => sum + owner.byteSize, 0);
  const currentOwnerLabel = currentOwnerKind === 'series' ? 'このシリーズ' : 'この読み切り';
  return <div class="document-editor">
    <div class="document-editor-head">
      <div><span class="eyebrow">PREFERENCES</span><h2>環境設定</h2><p>{hasDocument ? '作品のレイアウト・テキスト・作画と、この端末での表示・利用設定を切り替えて調整します。' : 'この端末での表示・利用設定を調整します。'}</p></div>
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
        selectTab(next);
        event.currentTarget.querySelector<HTMLButtonElement>(`#environment-tab-${next}`)?.focus();
      }}>
        {availableTabs.map(({ id, label, icon: Icon }) => <button
          key={id}
          type="button"
          role="tab"
          id={`environment-tab-${id}`}
          aria-controls={`environment-panel-${id}`}
          aria-selected={activeTab === id}
          tabIndex={activeTab === id ? 0 : -1}
          onClick={() => selectTab(id)}
        ><Icon size={16} aria-hidden="true" />{label}</button>)}
      </div>
      {hasDocument && <section class="environment-tab-panel" id="environment-panel-page" role="tabpanel" aria-labelledby="environment-tab-page" tabIndex={0} hidden={activeTab !== 'page'}>
        <FinishLayoutSettings document={document} onChange={onChangeDocument} onNotify={onNotify} />
        <SectionTitle title="コマ" />
        <p class="environment-settings-note">この作品全体に適用されます。他の作品の設定は変更しません。</p>
        <div class="field-grid">
          <Field label="コマ枠線幅" hint="mm"><input type="number" min="0.1" max="5" step="0.1" value={frameLineWidthMm} onInput={(event) => onChangeFrameLineWidth(Number(event.currentTarget.value))} /></Field>
          <Field label="上下のコマ間隔" hint="mm"><input type="number" min="0" max="20" step="0.5" value={rowGapMm} onInput={(event) => onChangeRowGap(Number(event.currentTarget.value))} /></Field>
          <Field label="左右のコマ間隔" hint="mm"><input type="number" min="0" max="20" step="0.5" value={columnGapMm} onInput={(event) => onChangeColumnGap(Number(event.currentTarget.value))} /></Field>
        </div>
      </section>}
      {hasDocument && <section class="environment-tab-panel" id="environment-panel-text" role="tabpanel" aria-labelledby="environment-tab-text" tabIndex={0} hidden={activeTab !== 'text'}>
        <SectionTitle title="テキスト" />
        <p class="environment-settings-note">この作品全体に適用されます。他の作品の設定は変更しません。</p>
        <div class="field-grid">
          <Field label="フキダシ線幅" hint="mm"><input type="number" min="0.1" max="2" step="0.1" value={bubbleLineWidthMm} onInput={(event) => onChangeBubbleLineWidth(Number(event.currentTarget.value))} /></Field>
          <Field label="作品の基本書体" hint="すべてのコマのフキダシに適用" wide>
            <div class="font-picker-row">
              <input list="environment-font-options" value={defaultFont} placeholder="アンチック体" onInput={(event) => onChangeDefaultFont(event.currentTarget.value)} />
              <button type="button" class="secondary-button" onClick={loadLocalFonts}><Type size={15} />PC内フォント</button>
            </div>
            {fontStatus && <small class="font-picker-status">{fontStatus}</small>}
          </Field>
        </div>
        <datalist id="environment-font-options">{fontOptions.map((font) => <option value={font} />)}</datalist>
        <FinishTextSettings document={document} onChange={onChangeDocument} onNotify={onNotify} />
      </section>}
      <section class="environment-tab-panel" id="environment-panel-artwork" role="tabpanel" aria-labelledby="environment-tab-artwork" tabIndex={0} hidden={activeTab !== 'artwork'}>
        <Field label="ぬりたし"><div class="paint-bleed-setting"><input aria-label="ぬりたし" type="number" min="0" max="4000" step="1" value={paintBleedPx} onChange={event=>{
          const value=event.currentTarget.valueAsNumber;
          if(Number.isSafeInteger(value)&&value>=0&&value<=4000)onChangePaintBleed?.(value);
          else {event.currentTarget.value=String(paintBleedPx);onNotify('ぬりたしは0〜4000pxの整数で指定してください');}
        }}/><span>px</span></div></Field>
        <Field label="手ぶれ補正"><input aria-label="手ぶれ補正" type="number" min="0" max="15" step="1" value={paintSmoothing} onChange={e=>{const value=e.currentTarget.valueAsNumber;if(Number.isInteger(value)&&value>=0&&value<=15)onChangePaintSmoothing?.(value);else e.currentTarget.value=String(paintSmoothing);}}/></Field>
        <Field label="履歴の保持ステップ数"><input aria-label="履歴の保持ステップ数" type="number" min="1" max="1000" step="1" value={historySteps} onChange={event=>{const value=event.currentTarget.valueAsNumber;if(Number.isSafeInteger(value)&&value>=1&&value<=1000)onChangeHistorySteps?.(value);else{event.currentTarget.value=String(historySteps);onNotify('履歴の保持数は1〜1000の整数で指定してください');}}}/></Field>
        <p class="environment-settings-note">撮影・ペン・配置の操作で共通の履歴です。既定は50段階。古い履歴から消え、作品を閉じるとリセットされます。</p>
        {hasDocument && <ArtworkSettings document={document} onChange={onChangeDocument} onNotify={onNotify} />}
      </section>
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
        {agentProfile&&onChangeAgentProfile&&<AgentSettings profile={agentProfile} onChange={onChangeAgentProfile}/>}
        <SectionTitle title="モデル" />
        <p class="environment-settings-note">この端末に保存される利用設定です。切り替えだけでモデルを実行することはありません。</p>
        <div class="field-grid">
          <Field label="文章LLM" hint="未起動時に使う models.conf のエイリアス" wide>
            <input value={localModelPreferences.llmAlias} spellcheck={false} onInput={(event) => setLocalModelPreferences(current => ({ ...current, llmAlias: event.currentTarget.value }))} onBlur={commitLocalModelPreferences} />
            <small>8080で起動済みのLLMを自動で共用します。未起動ならこのモデルを必要な間だけ起動します。画像生成ではLLMを一時停止し、元から起動していた場合は生成後に同じ設定で復帰します。</small>
          </Field>
          <Field label="画像VLM" hint="ローカルキャッシュの Hugging Face モデルID" wide>
            <input value={localModelPreferences.vlmModelId} spellcheck={false} onInput={(event) => setLocalModelPreferences(current => ({ ...current, vlmModelId: event.currentTarget.value }))} onBlur={commitLocalModelPreferences} />
            <small>人物資料・人物演技の明示的な画像解析で使います。未保存モデルを自動ダウンロードしません。</small>
          </Field>
        </div>
        <LocalImageModelSettings onOpenAgent={onOpenAgent} endpoint={localModelPreferences.comfyuiUrl}
          onChange={comfyuiUrl => setLocalModelPreferences(current => ({ ...current, comfyuiUrl }))} onCommit={commitLocalModelPreferences} />
        <div class="environment-setting-list">
          <label class="environment-setting-row">
            <span class="environment-setting-icon"><Cloud size={20} /></span>
            <span><strong>クラウドモデルを使用する</strong><small>{cloudPreferences.enabled
              ? '許可済み。実行時には作品の成人指定と規約確認も検査します。'
              : 'オフ。人物素材はローカルモデルだけで処理します。'}</small></span>
            <input type="checkbox" checked={cloudPreferences.enabled} onChange={(event) => updateCloudPreferences({ enabled: event.currentTarget.checked })} />
          </label>
          {cloudPreferences.enabled && <label class="environment-setting-row">
            <span class="environment-setting-icon"><ShieldCheck size={20} /></span>
            <span><strong>成人指定作品での利用規約を確認済み</strong><small>成人指定作品でもクラウドモデルを使う場合に必要です。この端末では一度だけ確認します。</small></span>
            <input type="checkbox" checked={cloudPreferences.adultTermsConfirmed} onChange={(event) => updateCloudPreferences({ adultTermsConfirmed: event.currentTarget.checked })} />
          </label>}
        </div>
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
          <div class="data-management-heading"><h3 id="omny-export-title">OMNY書き出し</h3></div>
          <p class="environment-settings-note">作品の構成・セリフをOMNYファイルに書き出します。画像原本や作画設定は含みません。</p>
          <button type="button" class="secondary-button" disabled={!hasDocument || projectBusy} onClick={onExportOmny}>OMNY書き出し</button>
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
