import PrintSettingsEditor from '../PrintSettingsEditor';
import NewLayoutSourceImage from '../NewLayoutSourceImage';
import TemplateThumb from '../PanelTemplateThumb';
import NewLayoutAnalysisFeed from '../NewLayoutAnalysisFeed';
import CharacterReadProgress from '../CharacterReadProgress';
import { savePrintPreferences, printSummary } from '../../lib/printSettings';
import { FilePlus2, Images, ScanLine, Sparkles } from 'lucide-preact';
import { isLanClient } from '../../lib/clientRuntime';
import { NEW_LAYOUT_SPREAD_ORDER, layoutPreviewImageStyle, displayedLayoutRotation } from '../../lib/newLayoutPreview';
import { PANEL_TEMPLATES } from '../../lib/panelTemplates';
import type { PrintSetup } from '../../lib/printSettings';
import type { NewLayoutTask, NewLayoutItem } from '../../lib/newLayoutPreview';
import type { PanelTemplate } from '../../lib/panelTemplates';
import type { PendingScannerSession, ScannerSession } from '../../lib/localBridge';
import type { RefObject } from 'preact';
import type { CharacterReadProgressState } from '../CharacterReadProgress';

interface Props {
  editingNewPrintSetup: boolean;
  newPrintSetup: PrintSetup;
  setNewPrintSetup: (value: PrintSetup) => void;
  setNewPrintConfirmed: (value: boolean) => void;
  setEditingNewPrintSetup: (value: boolean) => void;
  setToast: (value: string | null) => void;
  newLayoutTask: NewLayoutTask;
  newPrintConfirmed: boolean;
  createNewDocument: (layout?: PanelTemplate, confirmScannedLayouts?: boolean) => Promise<void>;
  chooseNewLayoutImageFiles: () => Promise<void>;
  requestScannerFinish: () => Promise<void>;
  scannerReceivedCount: number;
  launchScanner: () => Promise<void>;
  pendingScannerSession: PendingScannerSession | null;
  persistAnalogAssets: boolean;
  changePersistAnalogAssets: (next: boolean) => void;
  newLayoutRowGapMm: number;
  updateNewLayoutGutter: (axis: 'row' | 'column', value: number) => void;
  newLayoutColumnGapMm: number;
  newLayoutFrameLineWidthMm: number;
  updateNewLayoutFrameLineWidth: (value: number) => void;
  resumeScanner: () => Promise<void>;
  discardRecoveredScans: () => Promise<void>;
  newLayoutImageInput: RefObject<HTMLInputElement>;
  chooseNewLayoutImages: (files?: ArrayLike<File> | Iterable<File> | null) => void;
  activeLayoutItem: NewLayoutItem | undefined;
  newLayoutItems: NewLayoutItem[];
  newLayoutActiveIndex: number;
  setNewLayoutActiveIndex: (value: number) => void;
  rotateActiveLayoutImage: (delta: 90 | 180 | 270) => void;
  analyzeNewLayouts: () => Promise<void>;
  newLayoutMessage: string | null;
  newCharacterReadProgress: CharacterReadProgressState | null;
  scannerSession: ScannerSession | null;
  hasScannedLayoutItems: boolean;
}

export default function NewLayoutStep({
  editingNewPrintSetup, newPrintSetup, setNewPrintSetup, setNewPrintConfirmed,
  setEditingNewPrintSetup, setToast, newLayoutTask, newPrintConfirmed, createNewDocument,
  chooseNewLayoutImageFiles, requestScannerFinish, scannerReceivedCount, launchScanner,
  pendingScannerSession, persistAnalogAssets, changePersistAnalogAssets, newLayoutRowGapMm,
  updateNewLayoutGutter, newLayoutColumnGapMm, newLayoutFrameLineWidthMm,
  updateNewLayoutFrameLineWidth, resumeScanner, discardRecoveredScans, newLayoutImageInput,
  chooseNewLayoutImages, activeLayoutItem, newLayoutItems, newLayoutActiveIndex,
  setNewLayoutActiveIndex, rotateActiveLayoutImage, analyzeNewLayouts, newLayoutMessage,
  newCharacterReadProgress, scannerSession, hasScannedLayoutItems,
}: Props) {
  return (
    <section class="new-layout-step" aria-labelledby="new-creation-step-title">
    {editingNewPrintSetup ? <PrintSettingsEditor initial={newPrintSetup} externalFormId="new-print-form" onConfirm={setup => {
      setNewPrintSetup(setup);
      setNewPrintConfirmed(true);
      setEditingNewPrintSetup(false);
      try { savePrintPreferences(localStorage, setup); }
      catch { setToast('今回の設定は使えますが、本体へ前回設定を保存できませんでした。'); }
    }} /> : <div class="print-summary"><p>{printSummary(newPrintSetup)}{newPrintSetup.printer && <small>{newPrintSetup.printer}</small>}</p><button type="button" class="secondary-button" disabled={newLayoutTask !== 'idle'} onClick={() => setEditingNewPrintSetup(true)}>変更</button></div>}
    {newPrintConfirmed && !editingNewPrintSetup && <>
    <button class="new-blank-button" onClick={() => createNewDocument()} disabled={newLayoutTask !== 'idle'}><FilePlus2 size={16} />まっさらで開始（コマ割りはあとで選べます）</button>
    <section class="new-layout-import" aria-labelledby="new-layout-import-title">
      <div class="new-layout-import-head">
        <div><h3 id="new-layout-import-title">紙のネームからコマを読み取る</h3></div>
        <div class="new-layout-import-actions">
          <button type="button" onClick={() => void chooseNewLayoutImageFiles()} disabled={newLayoutTask !== 'idle'}><Images size={15} />画像を読み込む</button>
          {!isLanClient && (newLayoutTask === 'scanner'
            ? <button type="button" class="scanner-finish-button" onClick={requestScannerFinish}><ScanLine size={15} />取り込みを終了{scannerReceivedCount ? `（${scannerReceivedCount}枚）` : ''}</button>
            : <button type="button" onClick={launchScanner} disabled={newLayoutTask !== 'idle' || Boolean(pendingScannerSession)}><ScanLine size={15} />スキャナーを起動</button>)}
        </div>
      </div>
      {!isLanClient && <label class="new-layout-persist-row">
        <input type="checkbox" checked={persistAnalogAssets} disabled={newLayoutTask !== 'idle'} onChange={(event) => changePersistAnalogAssets(event.currentTarget.checked)} />
        <span><strong>切り出した原画参照をすぐファイル保存</strong><small>紙のネームから抽出した人物の下書きと手書き文字だけを ~/Documents/Image-Hub/&lt;episode_id&gt;/ に保存します。登場人物・背景・小道具の資料保存とは別です。</small></span>
      </label>}
      <div class="new-layout-style-controls" role="group" aria-label="取り込み後のコマ枠設定">
        <label><span>上下の間隔</span><span><input type="number" min="0" max="20" step="0.5" value={newLayoutRowGapMm} disabled={newLayoutTask !== 'idle'} onInput={(event) => updateNewLayoutGutter('row', event.currentTarget.valueAsNumber)} />mm</span></label>
        <label><span>左右の間隔</span><span><input type="number" min="0" max="20" step="0.5" value={newLayoutColumnGapMm} disabled={newLayoutTask !== 'idle'} onInput={(event) => updateNewLayoutGutter('column', event.currentTarget.valueAsNumber)} />mm</span></label>
        <label><span>枠線の太さ</span><span><input type="number" min="0.1" max="5" step="0.1" value={newLayoutFrameLineWidthMm} disabled={newLayoutTask !== 'idle'} onInput={(event) => updateNewLayoutFrameLineWidth(event.currentTarget.valueAsNumber)} />mm</span></label>
        <small>間隔は解析結果の座標へ、枠線幅は新しい作品の作画指定へ保存します。</small>
      </div>
      {pendingScannerSession && <div class="new-layout-recovery" role="status">
        <div><strong>前回のスキャン画像が{pendingScannerSession.count}枚残っています</strong><span>{new Date(pendingScannerSession.startedAt).toLocaleString('ja-JP')} · {pendingScannerSession.directory}</span><p>強制終了などで処理が中断された可能性があります。前回の画像へつなぎ直しますか？</p></div>
        <div><button type="button" class="primary-button" onClick={resumeScanner} disabled={newLayoutTask !== 'idle'}>つなぎ直す</button><button type="button" onClick={discardRecoveredScans} disabled={newLayoutTask !== 'idle'}>破棄する</button></div>
      </div>}
      <input ref={newLayoutImageInput} type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif,image/tiff" multiple hidden onChange={(event) => chooseNewLayoutImages(event.currentTarget.files)} />
      {activeLayoutItem && <div class="new-layout-workbench">
        <section class="new-layout-thumb-pane" aria-labelledby="new-layout-source-title">
          <h4 id="new-layout-source-title">原画</h4>
          <div class="new-layout-spread-grid">
            {NEW_LAYOUT_SPREAD_ORDER.map((itemIndex) => {
              const item = newLayoutItems[itemIndex];
              if (!item) return <span class="new-layout-thumb-card is-empty" aria-hidden="true" key={`source-empty-${itemIndex}`} />;
              return <button type="button" class={`new-layout-thumb-card ${newLayoutActiveIndex === itemIndex ? 'is-active' : ''}`} aria-label={`原画 ${itemIndex + 1}ページ目を選択`} onClick={() => setNewLayoutActiveIndex(itemIndex)} key={`source-${item.id}`}>
                <span class="new-layout-thumb-media"><NewLayoutSourceImage file={item.file} alt="" style={layoutPreviewImageStyle(displayedLayoutRotation(item))} /></span>
                <em>{String(itemIndex + 1).padStart(2, '0')}</em>
              </button>;
            })}
          </div>
        </section>
        <section class="new-layout-thumb-pane is-analysis" aria-labelledby="new-layout-analysis-title">
          <h4 id="new-layout-analysis-title">解析結果</h4>
          <div class="new-layout-spread-grid">
            {NEW_LAYOUT_SPREAD_ORDER.map((itemIndex) => {
              const item = newLayoutItems[itemIndex];
              if (!item) return <span class="new-layout-thumb-card is-empty" aria-hidden="true" key={`analysis-empty-${itemIndex}`} />;
              const hasPanels = Boolean(item.analysis?.detectedPanels.length);
              return <button type="button" class={`new-layout-thumb-card ${newLayoutActiveIndex === itemIndex ? 'is-active' : ''} ${hasPanels ? 'is-ready' : ''} ${item.analyzing ? 'is-analyzing' : ''} ${item.error ? 'is-error' : ''}`} aria-label={`解析結果 ${itemIndex + 1}ページ目を選択`} onClick={() => setNewLayoutActiveIndex(itemIndex)} key={`analysis-${item.id}`}>
                <span class="new-layout-thumb-media">{hasPanels && item.analysis ? <TemplateThumb shapes={item.analysis.detectedPanels} figures={item.analysis.detectedFigures} frameLineWidthMm={newLayoutFrameLineWidthMm} /> : <span class="new-layout-analysis-placeholder">{item.analyzing ? '解析中' : item.error ? '!' : ''}</span>}</span>
                <em>{String(itemIndex + 1).padStart(2, '0')}</em>
              </button>;
            })}
          </div>
        </section>
        <section class="new-layout-focus-pane" aria-labelledby="new-layout-focus-title">
          <h4 id="new-layout-focus-title">フォーカス中</h4>
          <div class="new-layout-focus-body">
            <div class="new-layout-focus-image"><NewLayoutSourceImage file={activeLayoutItem.file} alt="読み込んだネーム画像のプレビュー" style={layoutPreviewImageStyle(displayedLayoutRotation(activeLayoutItem))} /></div>
            <div class="new-layout-focus-controls">
              <span class="new-layout-page-number">PAGE {String(newLayoutActiveIndex + 1).padStart(2, '0')} / {String(newLayoutItems.length).padStart(2, '0')}</span>
              <strong >{activeLayoutItem.file.name}</strong>
              <div class="new-layout-rotation-controls" aria-label="画像の向きを手動指定"><button type="button" onClick={() => rotateActiveLayoutImage(270)} disabled={newLayoutTask !== 'idle'}>左90°</button><button type="button" onClick={() => rotateActiveLayoutImage(180)} disabled={newLayoutTask !== 'idle'}>180°</button><button type="button" onClick={() => rotateActiveLayoutImage(90)} disabled={newLayoutTask !== 'idle'}>右90°</button></div>
              <button type="button" class="primary-button" onClick={analyzeNewLayouts} disabled={newLayoutTask !== 'idle'} ><Sparkles size={15} />{newLayoutTask === 'analyzing' || newLayoutTask === 'creating' ? '解析中…' : '解析開始'}</button>
            </div>
          </div>
          <NewLayoutAnalysisFeed items={newLayoutItems} message={newLayoutMessage} characterProgress={newCharacterReadProgress} />
        </section>
      </div>}
      {!activeLayoutItem && (newCharacterReadProgress ? <CharacterReadProgress progress={newCharacterReadProgress} /> : newLayoutMessage && <p class="new-layout-message" role="status">{newLayoutMessage}</p>)}
      {scannerSession && <p class="new-layout-session">開始 {new Date(scannerSession.startedAt).toLocaleTimeString('ja-JP')} · 保存先 {scannerSession.directory}</p>}
    </section>
    <details class="new-template-picker">
    <summary>コマ割りを選んで開始</summary>
    <div class="new-template-grid">
      {PANEL_TEMPLATES.map((template) => <button type="button" id={`new-template-${template.id}`} class="new-template-card" key={template.id} disabled={newLayoutTask !== 'idle'} onClick={() => createNewDocument(template, hasScannedLayoutItems)}>
        <TemplateThumb shapes={template.shapes} />
        <strong>パターン{template.id} · {template.name}</strong>
        <small>{template.shapes.length}コマ · {template.usage}</small>
      </button>)}
    </div>
    </details>
    </>}
    </section>
  );
}
