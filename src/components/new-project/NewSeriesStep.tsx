import { FilePlus2, Files, FileText, FolderOpen, Trash2, ClipboardCheck } from 'lucide-preact';
import { isLanClient } from '../../lib/clientRuntime';
import type { NewSeriesMode } from '../../lib/newProjectSettings';
import type { SeriesCharacterTextLink, EpisodeWorkspace, SeriesCatalogSummary, SeriesReferenceTextSelection, SeriesReferenceTextCandidate, ReferenceTextSuggestion } from '../../lib/localBridge';
import type { Dispatch, StateUpdater } from 'preact/hooks';

interface Props {
  continueFromSeriesSelection: () => Promise<void>;
  newSeriesMode: NewSeriesMode;
  clearNewReferenceText: () => void;
  clearNewSeriesReference: () => void;
  setNewCharacterTextLink: (value: SeriesCharacterTextLink | null) => void;
  setNewSeriesMode: (value: NewSeriesMode) => void;
  setNewSeriesName: (value: string) => void;
  setNewSeriesId: (value: string) => void;
  setNewEpisodeWorkspace: (value: EpisodeWorkspace | null) => void;
  setNewWorkspaceMessage: (value: string) => void;
  setSeriesCatalogMessage: (value: string) => void;
  seriesCatalogs: SeriesCatalogSummary[];
  newSeriesName: string;
  newSeriesId: string;
  selectExistingSeries: (seriesId: string) => Promise<void>;
  newSeriesDirectory: string;
  chooseNewSeriesDirectory: () => Promise<void>;
  newSeriesDirectorySelecting: boolean;
  newSeriesReferenceSelecting: boolean;
  newSeriesPreparing: boolean;
  newWorkspaceSelecting: boolean;
  newSeriesDirectoryMessage: string;
  newSeriesReferenceRows: SeriesReferenceTextSelection[];
  newSelectedSeriesReferencePaths: string[];
  newSeriesReferenceBusy: boolean;
  setNewSelectedSeriesReferencePaths: Dispatch<StateUpdater<string[]>>;
  newSeriesReferenceMessage: string;
  chooseNewSeriesReferenceTextFile: (replacedPath?: string) => Promise<void>;
  selectedNewSeriesReferenceRows: SeriesReferenceTextSelection[];
  removeSelectedNewSeriesReferences: () => void;
  newSeriesReferenceCandidates: readonly SeriesReferenceTextCandidate[];
  applySelectedNewSeriesReferences: () => void;
  seriesCatalogMessage: string;
  newWorkTitle: string;
  newEpisodeWorkspace: EpisodeWorkspace | null;
  chooseNewEpisodeWorkspace: () => Promise<void>;
  newReferenceSelecting: boolean;
  newWorkspaceMessage: string;
  newReferenceFileName: string;
  newSuggestedEpisodeReference: ReferenceTextSuggestion | null;
  chooseNewReferenceTextFile: () => Promise<void>;
  applySuggestedReferenceTexts: () => Promise<void>;
  newReferenceMessage: string;
}

export default function NewSeriesStep({
  continueFromSeriesSelection, newSeriesMode, clearNewReferenceText, clearNewSeriesReference,
  setNewCharacterTextLink, setNewSeriesMode, setNewSeriesName, setNewSeriesId,
  setNewEpisodeWorkspace, setNewWorkspaceMessage, setSeriesCatalogMessage, seriesCatalogs,
  newSeriesName, newSeriesId, selectExistingSeries, newSeriesDirectory, chooseNewSeriesDirectory,
  newSeriesDirectorySelecting, newSeriesReferenceSelecting, newSeriesPreparing,
  newWorkspaceSelecting, newSeriesDirectoryMessage, newSeriesReferenceRows,
  newSelectedSeriesReferencePaths, newSeriesReferenceBusy, setNewSelectedSeriesReferencePaths,
  newSeriesReferenceMessage, chooseNewSeriesReferenceTextFile, selectedNewSeriesReferenceRows,
  removeSelectedNewSeriesReferences, newSeriesReferenceCandidates, applySelectedNewSeriesReferences,
  seriesCatalogMessage, newWorkTitle, newEpisodeWorkspace, chooseNewEpisodeWorkspace,
  newReferenceSelecting, newWorkspaceMessage, newReferenceFileName, newSuggestedEpisodeReference,
  chooseNewReferenceTextFile, applySuggestedReferenceTexts, newReferenceMessage,
}: Props) {
  return (
    <form id="new-series-form" class="new-series-step" aria-labelledby="new-creation-step-title" onSubmit={(event) => { event.preventDefault(); void continueFromSeriesSelection(); }} onKeyDown={(event) => {
      const target = event.target as HTMLElement;
      if (event.key !== 'Enter' || event.isComposing || (target.tagName !== 'INPUT' && target.tagName !== 'SELECT')) return;
      event.preventDefault();
      void continueFromSeriesSelection();
    }}>
      <div class="new-series-mode-grid">
        <button type="button" class={newSeriesMode === 'new' ? 'is-selected' : ''} onClick={() => { clearNewReferenceText(); clearNewSeriesReference(); setNewCharacterTextLink(null); setNewSeriesMode('new'); setNewSeriesName(''); setNewSeriesId(crypto.randomUUID()); setNewEpisodeWorkspace(null); setNewWorkspaceMessage(''); setSeriesCatalogMessage(''); }}><FilePlus2 size={18} aria-hidden="true" /><strong>新しいシリーズ</strong></button>
        <button type="button" class={newSeriesMode === 'existing' ? 'is-selected' : ''} onClick={() => { clearNewReferenceText(); clearNewSeriesReference(); setNewCharacterTextLink(null); setNewSeriesMode('existing'); setNewSeriesName(''); setNewSeriesId(''); setNewEpisodeWorkspace(null); setNewWorkspaceMessage(''); setSeriesCatalogMessage(seriesCatalogs.length ? '' : '保存済みシリーズはまだありません。'); }}><Files size={18} aria-hidden="true" /><strong>既存シリーズ</strong></button>
        <button type="button" class={newSeriesMode === 'none' ? 'is-selected' : ''} onClick={() => { clearNewReferenceText(); clearNewSeriesReference(); setNewCharacterTextLink(null); setNewSeriesMode('none'); setNewSeriesName(''); setNewSeriesId(''); setNewEpisodeWorkspace(null); setNewWorkspaceMessage(''); setSeriesCatalogMessage(''); }}><FileText size={18} aria-hidden="true" /><strong>読み切り</strong></button>
      </div>
      {(newSeriesMode === 'new' || newSeriesMode === 'existing') && <section class="new-creation-topic" aria-labelledby="new-series-topic-title">
        <h4 id="new-series-topic-title"><span>シリーズ</span>{newSeriesName.trim() && <span class="new-creation-topic-name">{`「　${newSeriesName.trim()}　」`}</span>}</h4>
        {newSeriesMode === 'existing' && <label class="new-series-field"><span>シリーズ名</span><select value={newSeriesId} onChange={(event) => {
          void selectExistingSeries(event.currentTarget.value);
        }}><option value="">選択してください</option>{seriesCatalogs.map((item) => <option value={item.seriesId} key={item.seriesId}>{item.seriesName}</option>)}</select></label>}
        {isLanClient && newSeriesMode === 'new' && <label class="new-series-field"><span>シリーズ名</span><input value={newSeriesName} onInput={event => setNewSeriesName(event.currentTarget.value)} /></label>}
        {(newSeriesMode === 'new' || newSeriesId) && <>
          <div class="new-creation-row" aria-label="シリーズフォルダ">
            <strong>保存先</strong>
            <span class="new-creation-value" >{newSeriesDirectory.split('/').filter(Boolean).at(-1) || 'フォルダを選択してください。'}</span>
            <button class="new-creation-change" type="button" onClick={() => void chooseNewSeriesDirectory()} disabled={newSeriesDirectorySelecting || newSeriesReferenceSelecting || newSeriesPreparing || newWorkspaceSelecting}><FolderOpen size={15} aria-hidden="true" />{newSeriesDirectorySelecting ? '選択中…' : newSeriesDirectory ? '変更' : '選択'}</button>
          </div>
          {newSeriesDirectoryMessage && <p class="new-workspace-message" role="status">{newSeriesDirectoryMessage}</p>}
          {(isLanClient || newSeriesDirectory) && <div class="new-creation-references" aria-label="シリーズの設定資料">
            <div class="new-creation-reference-list">
            {newSeriesReferenceRows.map((reference) => <div class="new-creation-reference-row" key={reference.relativePath}>
              <label class="new-creation-reference-label">
                <input
                  type="checkbox"
                  aria-label={`${reference.fileName}を選択`}
                  checked={newSelectedSeriesReferencePaths.includes(reference.relativePath)}
                  disabled={newSeriesReferenceBusy}
                  onChange={() => setNewSelectedSeriesReferencePaths((current) => current.includes(reference.relativePath)
                    ? current.filter((path) => path !== reference.relativePath)
                    : [...current, reference.relativePath])}
                />
                <span class="new-creation-file-name" >{reference.fileName}</span>
              </label>
            </div>)}
            </div>
            <div class="new-creation-reference-actions">
              {newSeriesReferenceMessage && <p class="new-reference-message" role="status">{newSeriesReferenceMessage}</p>}
              <button class="new-creation-change" type="button" onClick={() => void chooseNewSeriesReferenceTextFile()} disabled={newSeriesReferenceBusy}><FilePlus2 size={15} aria-hidden="true" />{newSeriesReferenceSelecting ? '選択中…' : newSeriesReferenceRows.length ? '資料を追加' : '資料を選択'}</button>
              <button class="new-creation-change" type="button" aria-label="選択した資料を変更"  disabled={newSeriesReferenceBusy || selectedNewSeriesReferenceRows.length !== 1} onClick={() => { if (selectedNewSeriesReferenceRows.length === 1) void chooseNewSeriesReferenceTextFile(selectedNewSeriesReferenceRows[0].relativePath); }}><FileText size={15} aria-hidden="true" />変更</button>
              <button class="new-creation-change" type="button" aria-label="選択した資料を削除"  disabled={newSeriesReferenceBusy || !selectedNewSeriesReferenceRows.length} onClick={removeSelectedNewSeriesReferences}><Trash2 size={15} aria-hidden="true" />削除</button>
              {newSeriesReferenceCandidates.length > 0 && <button class="primary-button" type="button" disabled={!selectedNewSeriesReferenceRows.length || newSeriesReferenceBusy} onClick={applySelectedNewSeriesReferences}><ClipboardCheck size={15} aria-hidden="true" />選んだ{selectedNewSeriesReferenceRows.length}件を反映</button>}
            </div>
          </div>}
        </>}
        {seriesCatalogMessage && <p class="new-reference-message" role="status">{seriesCatalogMessage}</p>}
      </section>}
      {newSeriesMode && (newSeriesMode !== 'existing' || newSeriesId) && <section class="new-creation-topic" aria-labelledby="new-episode-topic-title">
        <h4 id="new-episode-topic-title"><span>今回のエピソード</span>{newWorkTitle.trim() && <span class="new-creation-topic-name">{`「　${newWorkTitle.trim()}　」`}</span>}</h4>
        <div class="new-creation-row" aria-label="今回のエピソード保存先">
          <strong>保存先</strong>
          <span class="new-creation-value" >{newEpisodeWorkspace?.folderName || 'フォルダを選択してください。'}</span>
          <button class="new-creation-change" type="button" onClick={() => void chooseNewEpisodeWorkspace()} disabled={newWorkspaceSelecting || newReferenceSelecting || newSeriesReferenceSelecting || newSeriesDirectorySelecting || newSeriesPreparing}><FolderOpen size={15} aria-hidden="true" />{newWorkspaceSelecting ? '選択中…' : newEpisodeWorkspace ? '変更' : '選択'}</button>
        </div>
        {newWorkspaceMessage && <p class="new-workspace-message" role="status">{newWorkspaceMessage}</p>}
        {newEpisodeWorkspace && <div class="new-creation-references" aria-label="今回のエピソード資料">
          <div class="new-creation-source-row">
            <div class="new-creation-reference-list"><span class="new-creation-file-name" >{newReferenceFileName || newSuggestedEpisodeReference?.fileName || '資料を指定できます'}</span></div>
            <button class="new-creation-change" type="button" onClick={() => void chooseNewReferenceTextFile()} disabled={newReferenceSelecting || newWorkspaceSelecting || newSeriesDirectorySelecting || newSeriesPreparing}><FileText size={15} aria-hidden="true" />{newReferenceSelecting ? '選択中…' : newReferenceFileName || newSuggestedEpisodeReference ? '変更' : '資料を選択'}</button>
          </div>
          {newSuggestedEpisodeReference && <div class="new-creation-reference-actions is-end"><button class="primary-button" type="button" disabled={newReferenceSelecting || newWorkspaceSelecting || newSeriesDirectorySelecting || newSeriesPreparing} onClick={() => void applySuggestedReferenceTexts()}><ClipboardCheck size={15} aria-hidden="true" />この資料を反映</button></div>}
          {newReferenceMessage && <p class="new-reference-message is-file-aligned" role="status">{newReferenceMessage}</p>}
        </div>}
      </section>}
    </form>
  );
}
