import VoiceCommands from '../VoiceCommands';
import { isLanClient } from '../../lib/clientRuntime';
import PaintTextTools from '../PaintTextTools';
import BubbleMaterialPicker from '../BubbleMaterialPicker';
import PaintToolHelp from '../PaintToolHelp';
import { canvasTextEditable } from '../../lib/canvasText';
import PageLayerPalette from '../PageLayerPalette';
import { panelLocked } from '../../lib/panelLayers';
import PanelControls from '../PanelControls';
import { namedBackgroundStages } from '../../lib/background3d';
import PaintEditor, { PaintTools, PaintDetails, PaintStatus } from '../PaintEditor';
import { paintColorMode } from '../../lib/paintColor';
import PlacedImageList from '../PlacedImageList';
import { ChevronLeft, ChevronRight, Download, FilePlus2, Files, FolderOpen, LayoutPanelTop, SlidersHorizontal, X } from 'lucide-preact';
import Header from '../Header';
import { getPrintSetup } from '../../lib/printSettings';
import PageSidebar from '../PageSidebar';
import MangaCanvas from '../MangaCanvas';
import PanelInspector from '../PanelInspector';
import ImageGenerationDialog from '../ImageGenerationDialog';
import { canChooseImageExportDirectory, type ImageExportFormat } from '../../lib/pageExport';
import PageOverlayInspector from '../PageOverlayInspector';
import EnvironmentSettings from '../EnvironmentSettings';
import { saveEditGuide, savePaintBleed, savePaintSmoothing, savePaintCursor } from '../../lib/paintPreferences';
import SourceCoverageReview from '../SourceCoverageReview';
import ScenarioReview from '../ScenarioReview';
import { CharactersEditor, MetaEditor, PropsEditor, SettingEditor } from '../DocumentEditors';
import { isPropPlacement } from '../../lib/catalogModel';
import NewSeriesStep from '../new-project/NewSeriesStep';
import NewSettingStep from '../new-project/NewSettingStep';
import NewLayoutStep from '../new-project/NewLayoutStep';
import NewProjectNavigation from '../new-project/NewProjectNavigation';
import { TABS } from './workspaceTabs';
import type { useWorkspaceModel } from './useWorkspaceModel';

export default function WorkspaceView({ model }: { model: ReturnType<typeof useWorkspaceModel> }) {
  const {
    setDocument, exportOmny, changeShowGuides, changeSpreadView, changePanelStyleNumber, requestPcFonts,
    saveProject, actOnLayer, makePaintScene, selectedBubbleStroke, undo, redo, chooseBubblePathTool,
    chooseTextTool, closeTextTool, openBubbleMaterials, bubbleLineWidthMm, panel, addPanel,
    toggleInnerFrameSnap, togglePanelGapSnap, togglePanelSync, mergeSelectedPanelGroup, splitActivePanel,
    endTextEdit, openPaint, chooseLayoutTool, toggleTextLayer, selectLayerOwner, selectCanvasElement,
    reorderOwnerLayers, startBubbleEdit, artworkGuideVisible, toggleArtworkGuide, prepareQwen,
    applyPaint, autoPaintBoundary, guardDuringPaint, layerTransition, choosePlacedImage,
    openImageExportDialog, openNewDialog, openProject, importPlacedImage, chooseImageExportFolder,
    exportPageRange, voiceRevision, applyVoiceCommand, inspectAgent, applyAgentBubbleEdit,
    applyBubbleMaterial, changeTab, selectPage, addPage, duplicatePage, deletePage, reorderPage, page,
    spreadPartnerIndex, changeTextToolStyle, changeCanvasTextStyle, startTextEdit, createScreenTextAt,
    wrapScreenText, finishElementMove, changeCanvasText, canvasTextHistory, requestCompositionGeneration,
    requestOwnerGeneration, chooseOwnerImage, imageGestureBoundary, panelFrameLineWidthMm, panelGutters,
    selectCanvasPanel, changeElementBBox, changeBubbleTail, movePanel, resizePanel, movePanelVertex,
    movePanelEdge, deleteScreenTextAt, deleteBubbleAt, selectLayerPanel, togglePanelLayer,
    togglePanelLock, deletePanelAt, addDirectFolder, mutate, movePageImageToPanel,
    changeSelectedTextCategory, changeSelectedTextBody, requestTextGeneration, chooseScenarioBubble,
    openPanelBackground3d, getOmnySnapshot, choosePanelDraftWorkspace, openMaterialsForPanel,
    deletePanel, importBackgroundModel, saveBackgroundsFromEditor, materialLinkPanel,
    toggleMaterialForPanel, returnFromMaterials, saveCharactersFromEditor, patchLatestDocument,
    persistSeriesCatalog, finalizeDeletedSeriesMaterial, linkCharacterText, deleteSeriesCharacter,
    restoreDeletedCharacter, coverageWorkspace, setCoverageSource, chooseCoverageWorkspaceSource,
    chooseCoverageWorkspace, saveCoverageReport, closeNewDialog, returnToSeriesSelection,
    continueFromNewCharacters, continueFromSeriesSelection, clearNewReferenceText,
    clearNewSeriesReference, selectExistingSeries, chooseNewSeriesDirectory, newSeriesReferenceRows,
    newSeriesReferenceBusy, chooseNewSeriesReferenceTextFile, selectedNewSeriesReferenceRows,
    removeSelectedNewSeriesReferences, applySelectedNewSeriesReferences, chooseNewEpisodeWorkspace,
    chooseNewReferenceTextFile, applySuggestedReferenceTexts, setNewCharacterDocument, saveNewCharacters,
    patchNewCharacterDocument, persistNewCharacterCatalog, chooseNewCharacterImageFiles,
    continueFromNewSetting, updateNewSeriesSetting, updateNewWorkSetting, createNewDocument,
    chooseNewLayoutImageFiles, requestScannerFinish, launchScanner, changePersistAnalogAssets,
    updateNewLayoutGutter, updateNewLayoutFrameLineWidth, resumeScanner, discardRecoveredScans,
    chooseNewLayoutImages, activeLayoutItem, rotateActiveLayoutImage, analyzeNewLayouts,
    hasScannedLayoutItems, insertQwenImage,
  } = model;
  const {
    paintSession, paintSessionRef, paintController, document, setToast, hasDocument, showNewDialog,
    agentProfile, changeAgentProfile, setVoiceOpen, editGuide, setEditGuide, showGuides, spreadView,
    localFontFamilies, boundEpisodeWorkspace, projectBusy, historySteps, changeHistorySteps,
    paintSmoothing, setPaintSmoothing, paintCursorMode, setPaintCursorMode, paintBleedPx,
    setPaintBleedPx, documentRef, recordPaint, past, future, zoomTool, bubblePathTool, tab, textTool,
    textPaletteRequest, layerSwitchBusy, qwenGeneration, innerFrameSnap, panelGapSnap, panelSync,
    selectedPanels, panelSplitDirection, setPanelSplitDirection, setTextTool, setZoomTool,
    setBubblePathTool, pendingLayerAction, environmentOpen, setPaintSession, environmentKeyDown,
    toggleEnvironmentSettings, imageExportDialog, imageImportBusy, imageExportBusy, placedImageInput,
    setImageExportDialog, activePage, imageExportDirectory, imageExportProgress, imageExportError,
    setAgentWorkTarget, selectedElement, activePanel, generationConversation, generationConversationHost,
    environmentAgentHost, voiceOpen, bubbleMaterialsOpen, setBubbleMaterialsOpen, mobileStoryboardPane,
    sidebarCollapsed, setSidebarCollapsed, paintToolsCollapsed, setPaintToolsCollapsed,
    setMobileStoryboardPane, inspectorCollapsed, agentWorkTarget, textToolStyle, editingText,
    canvasZoomPercent, setCanvasZoomPercent, paintLayersCollapsed, setPaintLayersCollapsed,
    canvasSelectionScrollRequest, setInspectorCollapsed, setSelectedElement, lastHistoryPush,
    seriesCatalogSaving, materialLinkTarget, characterTextLink, characterTextBusy, setCharacterTextLink,
    setSelectedPanels, setTab, setTextPaletteRequest, boundSourceSnapshot, sourceCoverageDecisions,
    setSourceCoverageDecisions, closeEnvironmentSettings, environmentPanel, setEnvironmentAgentHost,
    newLayoutTask, newCreationStep, setNewCreationStep, editingNewPrintSetup, newPrintConfirmed,
    setEditingNewPrintSetup, newSeriesMode, newEpisodeWorkspace, newSeriesPreparing,
    newWorkspaceSelecting, newWorkSetting, setNewCharacterTextLink, setNewSeriesMode, setNewSeriesName,
    setNewSeriesId, setNewEpisodeWorkspace, setNewWorkspaceMessage, setSeriesCatalogMessage,
    seriesCatalogs, newSeriesName, newSeriesId, newSeriesDirectory, newSeriesDirectorySelecting,
    newSeriesReferenceSelecting, newSeriesDirectoryMessage, newSelectedSeriesReferencePaths,
    setNewSelectedSeriesReferencePaths, newSeriesReferenceMessage, newSeriesReferenceCandidates,
    seriesCatalogMessage, newWorkTitle, newReferenceSelecting, newWorkspaceMessage, newReferenceFileName,
    newSuggestedEpisodeReference, newReferenceMessage, newCharacterDocument, newCharacterTextLink,
    newCharacterDocumentRef, setNewSettingMessage, newSettingMessage, newPrintSetup, setNewPrintSetup,
    setNewPrintConfirmed, scannerReceivedCount, pendingScannerSession, persistAnalogAssets,
    newLayoutRowGapMm, newLayoutColumnGapMm, newLayoutFrameLineWidthMm, newLayoutImageInput,
    newLayoutItems, newLayoutActiveIndex, setNewLayoutActiveIndex, newLayoutMessage,
    newCharacterReadProgress, scannerSession, setQwenGeneration, showEnvironmentSettings,
    setGenerationConversation, setGenerationConversationHost, toast,
  } = model.workspace;
  const environmentSettings = <EnvironmentSettings
    initialTab={paintSession?'drawing':undefined}
    prepareDocumentSettings={async()=>{if(paintSessionRef.current)await paintController.current?.close();}}
    document={document}
    onChangeDocument={setDocument}
    onNotify={setToast}
    hasDocument={hasDocument && !showNewDialog}
    onExportOmny={exportOmny}
    agentProfile={agentProfile} onChangeAgentProfile={changeAgentProfile}
    onOpenAgent={()=>setVoiceOpen(true)}
    editGuide={editGuide} onChangeEditGuide={value=>{try{setEditGuide(saveEditGuide(localStorage,value));}catch{setToast('編集ガイドの設定を保存できません');}}}
    showGuides={showGuides}
    spreadView={spreadView}
    pageCount={document.manga.pages.length}
    frameLineWidthMm={document.manga.meta.panel_frame_width_mm}
    rowGapMm={document.manga.meta.panel_gutter_row_mm}
    columnGapMm={document.manga.meta.panel_gutter_column_mm}
    onChangeShowGuides={changeShowGuides}
    onChangeSpreadView={changeSpreadView}
    onChangeFrameLineWidth={(value) => changePanelStyleNumber('panel_frame_width_mm', value)}
    onChangeRowGap={(value) => changePanelStyleNumber('panel_gutter_row_mm', value)}
    onChangeColumnGap={(value) => changePanelStyleNumber('panel_gutter_column_mm', value)}
    fontFamilies={localFontFamilies}
    onRequestFonts={()=>void requestPcFonts()}
    saveDirectory={isLanClient ? boundEpisodeWorkspace?.folderName : boundEpisodeWorkspace?.directory}
    projectBusy={projectBusy}
    historySteps={historySteps} onChangeHistorySteps={changeHistorySteps}
    paintSmoothing={paintSmoothing}
    onChangePaintSmoothing={value=>{try{setPaintSmoothing(savePaintSmoothing(localStorage,value));}catch(error){setToast(String(error));}}}
    paintCursorMode={paintCursorMode}
    onChangePaintCursorMode={value=>{try{savePaintCursor(localStorage,value);setPaintCursorMode(value);}catch{setToast('ペンカーソルの設定を保存できません');}}}
    paintBleedPx={paintBleedPx}
    onChangePaintBleed={value=>{try{setPaintBleedPx(savePaintBleed(localStorage,value));}catch(error){setToast(error instanceof Error?error.message:'ぬりたしを保存できません');}}}
    onChangeSaveDirectory={() => saveProject(true)}
  />;

  return <PaintEditor onAddOutside={action=>{const s=paintSessionRef.current;if(!s)return;const page=documentRef.current.manga.pages[s.pageIndex],panel=page.panels[s.panelIndex];if(!panel)return;actOnLayer(s.panelIndex,{...action,key:'page',position:{stack:{beforePanel:`panel-${panel.id}`}}},makePaintScene(documentRef.current,s.panelIndex,s.pageIndex,true),true);}} selectedBubbleStroke={selectedBubbleStroke} resume={paintSession?.resume} resumeImages={paintSession?.images} historySteps={historySteps} sharedHistory={{checkpoint:recordPaint,undo,redo,canUndo:past.length>0,canRedo:future.length>0}} stages={namedBackgroundStages(document)} zoomTool={zoomTool} bubblePathTool={bubblePathTool} onSelectBubblePath={chooseBubblePathTool} toolPaletteEnabled={hasDocument&&tab==='storyboard'&&!showNewDialog} textTool={textTool} textTools={<PaintTextTools active={textTool} openRequest={textPaletteRequest} disabled={layerSwitchBusy||projectBusy||Boolean(qwenGeneration)} select={chooseTextTool} onClose={closeTextTool} onMaterials={openBubbleMaterials} bubbleLineWidthMm={bubbleLineWidthMm} onChangeBubbleLineWidth={value=>changePanelStyleNumber('bubble_line_width_mm',value)}/>} panelTools={<PanelControls disabled={layerSwitchBusy||projectBusy||Boolean(qwenGeneration)} hasPanel={Boolean(panel)} onAdd={addPanel} painting={Boolean(paintSession)} innerFrameSnap={innerFrameSnap} panelGapSnap={panelGapSnap} panelSync={panelSync} onToggleInnerFrameSnap={toggleInnerFrameSnap} onTogglePanelGapSnap={togglePanelGapSnap} onTogglePanelSync={togglePanelSync} selectedCount={selectedPanels.length} onMerge={mergeSelectedPanelGroup} splitDirection={panelSplitDirection} onSplitDirection={setPanelSplitDirection} onSplit={splitActivePanel}/>} onStartPaint={()=>{endTextEdit();setTextTool(false);setZoomTool(false);setBubblePathTool(false);return Boolean(paintSessionRef.current)||openPaint();}} onSelectLayout={chooseLayoutTool} onToggleBubble={(index,group)=>{const s=paintSessionRef.current;if(s)toggleTextLayer({pageIndex:s.pageIndex,panelIndex:s.panelIndex,index,overlay:s.overlay,kind:'bubble'},group);}} onSelectOwner={(key,native)=>{const s=paintSessionRef.current;if(s)selectLayerOwner(key,s.panelIndex,s.pageIndex,s.overlay,native);}} onSelectFigure={index=>{const s=paintSessionRef.current;if(s)selectCanvasElement({type:'figure',index,...(s.overlay?{scope:'page_overlay' as const}:{})},s.panelIndex,s.pageIndex);}} onReorderOwners={(key,target,after)=>{const session=paintSessionRef.current;if(session)reorderOwnerLayers(session.panelIndex,key,target,after,session.overlay);}} embeddedLayers onReady={()=>{const action=pendingLayerAction.current;pendingLayerAction.current=null;if(action)paintController.current?.layerAction(action);}} onEditText={index=>{const s=paintSessionRef.current;if(s)startBubbleEdit({pageIndex:s.pageIndex,panelIndex:s.panelIndex,bubbleIndex:index,overlay:s.overlay});}} controller={paintController} smoothing={paintSmoothing} cursorMode={paintCursorMode} guideVisible={key=>artworkGuideVisible(key,paintSession?.panelIndex,paintSession?.pageIndex,paintSession?.overlay)} onToggleGuide={key=>toggleArtworkGuide(key,paintSession?.panelIndex,paintSession?.pageIndex,paintSession?.overlay)} initial={paintSession?.scene} initialOwner={paintSession?.initialOwner} assets={document.manga.image_assets??[]} title={paintSession?.title??''} page={paintSession?document.manga.pages[paintSession.pageIndex].page:0} panelIndex={paintSession?.panelIndex??-1} overlay={paintSession?.overlay??false} suspended={Boolean(qwenGeneration)||projectBusy||environmentOpen||layerSwitchBusy} onGenerate={(owner,images,pendingAssets)=>{const session=paintSessionRef.current;return session?prepareQwen(session.document,session.pageIndex,session.panelIndex,session.overlay,owner,images,pendingAssets):Promise.reject(new Error('描画先が見つかりません'));}} onApply={applyPaint} onClose={()=>{pendingLayerAction.current=null;paintSessionRef.current=null;setPaintSession(null);}}>
    <PaintToolHelp enabled={editGuide}/><div class={`app-shell ${hasDocument ? '' : 'is-startup'} ${paintSession?'is-painting':''} ${showNewDialog ? 'is-creating' : ''} ${environmentOpen ? 'is-environment-open' : ''}`} onPointerOverCapture={autoPaintBoundary} onFocusCapture={autoPaintBoundary} onKeyDown={environmentKeyDown} onClickCapture={guardDuringPaint} onPointerDownCapture={guardDuringPaint} onKeyDownCapture={guardDuringPaint} onInputCapture={guardDuringPaint} onPasteCapture={guardDuringPaint}>
    <Header onSettings={toggleEnvironmentSettings} settingsOpen={environmentOpen} workspaceBlocked={environmentOpen || showNewDialog || Boolean(imageExportDialog)} hasDocument={hasDocument} busy={projectBusy||imageImportBusy||imageExportBusy} saveDirectory={isLanClient ? boundEpisodeWorkspace?.folderName : boundEpisodeWorkspace?.directory} canUndo={hasDocument && past.length > 0} canRedo={hasDocument && future.length > 0} onUndo={undo} onRedo={redo}
      onImportImage={()=>{void layerTransition(async()=>{if(paintSessionRef.current)await paintController.current?.close();endTextEdit();choosePlacedImage('page');});}}
      onExportImage={()=>{void layerTransition(async()=>{if(paintSessionRef.current)await paintController.current?.close();endTextEdit();openImageExportDialog();});}}
      onNew={openNewDialog} onOpen={openProject} onSave={() => saveProject()} />
    <input ref={placedImageInput} type="file" accept="image/png,image/jpeg" hidden onChange={event => void importPlacedImage(event.currentTarget.files?.[0])} />
    {imageExportDialog&&<div class="image-export-backdrop" onPointerDown={event=>{if(event.target===event.currentTarget&&!imageExportBusy)setImageExportDialog(null);}}>
      <section class="image-export-dialog" role="dialog" aria-modal="true" aria-labelledby="image-export-title" onKeyDown={event=>{if(event.key==='Escape'&&!imageExportBusy){event.preventDefault();setImageExportDialog(null);}}}>
        <header><h2 id="image-export-title">画像を書き出す</h2><button type="button" class="icon-button" aria-label="閉じる" disabled={imageExportBusy} onClick={()=>setImageExportDialog(null)}><X size={18}/></button></header>
        <fieldset disabled={imageExportBusy}><legend>ページ</legend>
          <label><input type="radio" name="image-export-range" checked={imageExportDialog.mode==='current'} onChange={()=>setImageExportDialog({...imageExportDialog,mode:'current'})}/>現在のページ <span class="image-export-muted">（{activePage+1}）</span></label>
          <div class="image-export-range-choice"><label><input type="radio" name="image-export-range" checked={imageExportDialog.mode==='range'} onChange={()=>setImageExportDialog({...imageExportDialog,mode:'range'})}/>範囲</label><input aria-label="開始ページ" type="number" min="1" max={document.manga.pages.length} value={imageExportDialog.from} disabled={imageExportDialog.mode!=='range'||imageExportBusy} onInput={event=>setImageExportDialog({...imageExportDialog,from:event.currentTarget.valueAsNumber})}/><span>〜</span><input aria-label="終了ページ" type="number" min="1" max={document.manga.pages.length} value={imageExportDialog.to} disabled={imageExportDialog.mode!=='range'||imageExportBusy} onInput={event=>setImageExportDialog({...imageExportDialog,to:event.currentTarget.valueAsNumber})}/></div>
          <label><input type="radio" name="image-export-range" checked={imageExportDialog.mode==='all'} onChange={()=>setImageExportDialog({...imageExportDialog,mode:'all'})}/>全ページ <span class="image-export-muted">（{document.manga.pages.length}ページ）</span></label>
        </fieldset>
        <label class="image-export-field"><span>形式</span><select aria-label="書き出し形式" value={imageExportDialog.format} disabled={imageExportBusy} onChange={event=>setImageExportDialog({...imageExportDialog,format:event.currentTarget.value as ImageExportFormat})}><option value="png">PNG</option><option value="clip">CLIP STUDIO（.clip＋元データ）</option><option value="psd">PSD（統合画像）</option></select></label>
        <div class="image-export-field"><span id="image-export-folder-label">保存先</span><div class="image-export-destination"><span title={imageExportDirectory?.name}>{imageExportDirectory?.name??(canChooseImageExportDirectory()?'未選択':'ブラウザーの保存先')}</span>{canChooseImageExportDirectory()&&<button type="button" class="secondary-button" aria-label="保存先を選択" disabled={imageExportBusy} onClick={()=>void chooseImageExportFolder()}>{imageExportDirectory?'変更':'選ぶ'}</button>}</div></div>
        <p class="image-export-note">{imageExportDialog.format==='clip'?'CLIPと元データはZIPにまとめます。':'複数ページはZIPにまとめます。'}{!canChooseImageExportDirectory()&&'保存先の選択にはChrome／Edgeを使ってください。'}</p>
        {imageExportProgress&&<div class="image-export-progress" role="status" aria-live="polite"><div><span>{imageExportProgress.label}</span><span>{Math.round(imageExportProgress.value/imageExportProgress.max*100)}%</span></div><progress aria-label="書き出しの進行状況" value={imageExportProgress.value} max={imageExportProgress.max}/></div>}
        {imageExportError&&<p class="image-export-error" role="alert">{imageExportError}</p>}
        <footer><button type="button" class="secondary-button" disabled={imageExportBusy} onClick={()=>setImageExportDialog(null)}>キャンセル</button><button type="button" class="primary-button" disabled={imageExportBusy} onClick={()=>void exportPageRange()}><Download size={17}/>{imageExportBusy?'処理中…':'書き出す'}</button></footer>
      </section>
    </div>}
    <VoiceCommands onActivity={active=>setAgentWorkTarget(active&&selectedElement?{pageIndex:activePage,panelIndex:activePanel,selection:{...selectedElement}}:null)} generation={qwenGeneration?generationConversation:null} portalTarget={generationConversationHost??(environmentOpen?environmentAgentHost:null)} open={voiceOpen} onToggle={()=>setVoiceOpen(!voiceOpen)} profile={agentProfile} onChangeProfile={changeAgentProfile} revision={voiceRevision} apply={applyVoiceCommand} inspect={inspectAgent} edit={applyAgentBubbleEdit}/>
    {bubbleMaterialsOpen&&<BubbleMaterialPicker onClose={()=>setBubbleMaterialsOpen(false)} canApply={Boolean(selectedElement?.type==='bubble'&&!paintSession&&!projectBusy&&canvasTextEditable(document,{pageIndex:activePage,panelIndex:activePanel,index:selectedElement.index,kind:'bubble',overlay:selectedElement.scope==='page_overlay'}))} onApply={id=>{if(selectedElement?.type==='bubble')applyBubbleMaterial({pageIndex:activePage,panelIndex:activePanel,index:selectedElement.index,kind:'bubble',overlay:selectedElement.scope==='page_overlay'},id);}}/>}

    {hasDocument ? <>
    <nav inert={environmentOpen} class="workspace-tabs" aria-label="編集カテゴリ">
      {TABS.map((item) => <button class={tab === item.id ? 'is-active' : ''} aria-label={item.label} onClick={() => changeTab(item.id)} key={item.id}><item.icon size={17} /><span>{item.label}</span></button>)}
    </nav>

    <main inert={environmentOpen} class={`workspace-shell ${tab === 'storyboard' ? 'is-storyboard' : ''} mobile-pane-${mobileStoryboardPane}`}>
      <PageSidebar document={document} activePage={activePage} collapsed={sidebarCollapsed} onCollapse={() => setSidebarCollapsed(!sidebarCollapsed)} onSelectPage={selectPage} onAddPage={addPage} onDuplicatePage={duplicatePage} onDeletePage={deletePage} onReorderPage={reorderPage} />
      {tab==='storyboard'&&page&&<aside class={`paint-dock paint-tools-dock ${paintToolsCollapsed?'is-collapsed':''}`}>
        <div class="dock-content"><h3>ペンツール</h3><PaintTools/></div>
        <button class="dock-rail" aria-expanded={!paintToolsCollapsed} aria-label={paintToolsCollapsed?'ペンツールを開く':'ペンツールを閉じる'} onClick={()=>setPaintToolsCollapsed(!paintToolsCollapsed)}><span>ペン</span>{paintToolsCollapsed?'›':'‹'}</button>
      </aside>}


      <section class={`workspace-main ${tab === 'storyboard' ? 'has-mobile-storyboard-tabs' : ''}`}>
        {tab === 'storyboard' && <nav class="mobile-storyboard-tabs" aria-label="ネーム作業エリア" role="tablist">
          <button type="button" role="tab" aria-selected={mobileStoryboardPane === 'pages'} aria-controls="mobile-pages-pane" class={mobileStoryboardPane === 'pages' ? 'is-active' : ''} onClick={() => { setSidebarCollapsed(false); setMobileStoryboardPane('pages'); }}><Files size={17} /><span>ページ</span></button>
          <button type="button" role="tab" aria-selected={mobileStoryboardPane === 'editor'} aria-controls="mobile-editor-pane" class={mobileStoryboardPane === 'editor' ? 'is-active' : ''} onClick={() => setMobileStoryboardPane('editor')}><LayoutPanelTop size={17} /><span>ネーム編集</span></button>
          <button type="button" role="tab" aria-selected={mobileStoryboardPane === 'panel'} aria-controls="mobile-panel-pane" class={mobileStoryboardPane === 'panel' ? 'is-active' : ''} onClick={() => setMobileStoryboardPane('panel')}><SlidersHorizontal size={17} /><span>コマ設定</span></button>
        </nav>}
        {tab === 'storyboard' && page && <div class={`storyboard-workspace ${inspectorCollapsed?'inspector-collapsed':''}`}>
          <div id="mobile-editor-pane" class="canvas-stage">
            <div class="canvas-toolbar">
              {paintSession&&<PaintStatus/>}
              <div class="page-switcher"><button aria-label="前のページ" onClick={() => selectPage(Math.max(0, activePage - 1))} disabled={activePage === 0}><ChevronLeft size={17} /></button><span><span class="page-switcher-label">PAGE </span><strong>{String(activePage + 1).padStart(2, '0')}</strong><span class="page-switcher-total"> / {String(document.manga.pages.length).padStart(2, '0')}</span></span><button aria-label="次のページ" onClick={() => selectPage(Math.min(document.manga.pages.length - 1, activePage + 1))} disabled={activePage === document.manga.pages.length - 1}><ChevronRight size={17} /></button></div>
            </div>
            {(() => {
              const leftIndex = spreadPartnerIndex===null?activePage:Math.max(activePage, spreadPartnerIndex);
              const activeCanvas = <MangaCanvas agentWorkTarget={agentWorkTarget?.pageIndex===activePage?agentWorkTarget:undefined} textToolStyle={textToolStyle} onTextToolStyle={changeTextToolStyle} pageIndex={activePage} spreadSide={spreadPartnerIndex===null?undefined:leftIndex===activePage?'left':'right'} onTextStyle={changeCanvasTextStyle} onBubbleMaterial={applyBubbleMaterial} onOpenBubbleMaterials={openBubbleMaterials} zoomTool={zoomTool} textTool={textTool} editingText={editingText?.pageIndex===activePage?editingText:null} onEditScreenText={(panelIndex,index,overlay=false)=>startTextEdit({pageIndex:activePage,panelIndex,index,kind:'screen_text',overlay})} onEditBubble={target=>startBubbleEdit({...target,pageIndex:activePage})} onCreateScreenTextAt={(panelIndex,point)=>createScreenTextAt(activePage,panelIndex,point)} onWrapScreenText={wrapScreenText} onFinishElementMove={(selection,panelIndex)=>finishElementMove(activePage,selection,panelIndex)} onText={changeCanvasText} onTextHistory={canvasTextHistory} onEndTextEdit={endTextEdit} painting={Boolean(paintSession)&&!textTool&&!zoomTool} paintTarget={paintSession?.pageIndex===activePage?{panelIndex:paintSession.panelIndex,overlay:paintSession.overlay}:undefined} guideVisible={(key,index,overlay)=>artworkGuideVisible(key,index,activePage,overlay)} onToggleGuide={(key,index,overlay)=>toggleArtworkGuide(key,index,activePage,overlay)} onGenerateComposition={(scope,index)=>void requestCompositionGeneration(scope,index,activePage)} onGenerateArtwork={(key,index,overlay)=>void requestOwnerGeneration(key,overlay,index,activePage)} dpi={getPrintSetup(document.manga).dpi} outputSize={getPrintSetup(document.manga)} onNotify={setToast} onReplaceArtwork={(index,figure,overlay,bubble)=>chooseOwnerImage(figure!==undefined?`figure-${figure}`:bubble!==undefined?`bubble-${bubble}`:'background',index,activePage,overlay)} imageAssets={document.manga.image_assets} onImageGesture={imageGestureBoundary} title={document.manga.meta.title} author={document.manga.meta.author} page={page} pageCount={document.manga.pages.length} zoomPercent={canvasZoomPercent} onZoomPercentChange={setCanvasZoomPercent} frameLineWidthMm={panelFrameLineWidthMm} bubbleLineWidthMm={bubbleLineWidthMm} defaultBubbleFont={document.manga.meta.font} fontFamilies={localFontFamilies} onRequestFonts={()=>void requestPcFonts()} activePanel={activePanel} selectedPanels={selectedPanels} selectedElement={selectedElement} showGuides={showGuides} innerFrameSnap={innerFrameSnap} panelGutters={panelGutters} panelGapSnap={panelGapSnap} panelSync={panelSync} onSelectPanel={selectCanvasPanel} onSelectElement={(selection, panelIndex, revealDetails) => selectCanvasElement(selection, panelIndex, activePage, revealDetails)} onChangeElementBBox={changeElementBBox} onChangeBubbleTail={changeBubbleTail} onMovePanel={movePanel} onResizePanel={resizePanel} onMoveVertex={movePanelVertex} onMovePanelEdge={movePanelEdge} />;
              const switchToPartner = (panelIndex = 0) => { if(spreadPartnerIndex!==null)void selectPage(spreadPartnerIndex,panelIndex); };
              const partnerCanvas = spreadPartnerIndex===null?null:<MangaCanvas textSettingsOwner={false} textToolStyle={textToolStyle} agentWorkTarget={agentWorkTarget?.pageIndex===spreadPartnerIndex?agentWorkTarget:undefined} pageIndex={spreadPartnerIndex} spreadSide={leftIndex===spreadPartnerIndex?'left':'right'} onTextStyle={changeCanvasTextStyle} onBubbleMaterial={applyBubbleMaterial} onOpenBubbleMaterials={openBubbleMaterials} zoomTool={zoomTool} textTool={textTool} editingText={editingText?.pageIndex===spreadPartnerIndex?editingText:null} onEditScreenText={(panelIndex,index,overlay=false)=>startTextEdit({pageIndex:spreadPartnerIndex,panelIndex,index,kind:'screen_text',overlay})} onEditBubble={target=>startBubbleEdit({...target,pageIndex:spreadPartnerIndex})} onCreateScreenTextAt={(panelIndex,point)=>createScreenTextAt(spreadPartnerIndex,panelIndex,point)} onWrapScreenText={wrapScreenText} onFinishElementMove={(selection,panelIndex)=>finishElementMove(spreadPartnerIndex,selection,panelIndex)} onText={changeCanvasText} onTextHistory={canvasTextHistory} onEndTextEdit={endTextEdit} painting={Boolean(paintSession)&&!textTool&&!zoomTool} paintTarget={paintSession?.pageIndex===spreadPartnerIndex?{panelIndex:paintSession.panelIndex,overlay:paintSession.overlay}:undefined} guideVisible={(key,index,overlay)=>artworkGuideVisible(key,index,spreadPartnerIndex,overlay)} onToggleGuide={(key,index,overlay)=>toggleArtworkGuide(key,index,spreadPartnerIndex,overlay)} onGenerateComposition={(scope,index)=>void requestCompositionGeneration(scope,index,spreadPartnerIndex)} onGenerateArtwork={(key,index,overlay)=>void requestOwnerGeneration(key,overlay,index,spreadPartnerIndex)} dpi={getPrintSetup(document.manga).dpi} outputSize={getPrintSetup(document.manga)} onNotify={setToast} onReplaceArtwork={(index,figure,overlay,bubble)=>chooseOwnerImage(figure!==undefined?`figure-${figure}`:bubble!==undefined?`bubble-${bubble}`:'background',index,spreadPartnerIndex,overlay)} imageAssets={document.manga.image_assets} title={document.manga.meta.title} author={document.manga.meta.author} page={document.manga.pages[spreadPartnerIndex]} pageCount={document.manga.pages.length} zoomPercent={canvasZoomPercent} onZoomPercentChange={setCanvasZoomPercent} frameLineWidthMm={panelFrameLineWidthMm} bubbleLineWidthMm={bubbleLineWidthMm} defaultBubbleFont={document.manga.meta.font} fontFamilies={localFontFamilies} onRequestFonts={()=>void requestPcFonts()} activePanel={-1} selectedPanels={[]} selectedElement={null} showGuides={showGuides} innerFrameSnap={innerFrameSnap} panelGutters={panelGutters} panelGapSnap={panelGapSnap} panelSync={panelSync} onSelectPanel={switchToPartner} onSelectElement={(selection, panelIndex, revealDetails) => selectCanvasElement(selection, panelIndex, spreadPartnerIndex, revealDetails)} onChangeElementBBox={() => {}} onChangeBubbleTail={() => {}} onMovePanel={() => {}} onResizePanel={() => {}} onMoveVertex={() => {}} onMovePanelEdge={() => {}} />;
              // 右綴じ: 若いページが右（flexの後ろ）に来る
              return <div class={`canvas-spread ${spreadPartnerIndex===null?'is-single-page':''}`}>
                <div class="canvas-spread-scroll">
                  <div class="canvas-spread-stage">
                    <div class="canvas-spread-pair">
                      <div class={`spread-pane ${leftIndex !== activePage ? 'is-spread-partner' : ''}`} >{leftIndex === activePage ? activeCanvas : partnerCanvas}</div>
                      {spreadPartnerIndex!==null&&<div class={`spread-pane ${leftIndex === activePage ? 'is-spread-partner' : ''}`} >{leftIndex === activePage ? partnerCanvas : activeCanvas}</div>}
                    </div>
                  </div>
                </div>
              </div>;
            })()}
          </div>
          {<aside class={`paint-dock paint-layers-dock ${paintLayersCollapsed?'is-collapsed':''}`}>
            <button class="dock-rail" aria-expanded={!paintLayersCollapsed} aria-label={paintLayersCollapsed?'レイヤーを開く':'レイヤーを閉じる'} onClick={()=>setPaintLayersCollapsed(!paintLayersCollapsed)}><span>レイヤー</span>{paintLayersCollapsed?'‹':'›'}</button>
            <div class="dock-content"><div class="paint-layer-settings"><PaintDetails/></div><PageLayerPalette expanded={!paintLayersCollapsed} selectedElement={selectedElement} canvasSelectionScrollRequest={canvasSelectionScrollRequest} onSelectText={(panelIndex,index,overlay)=>startTextEdit({pageIndex:activePage,panelIndex,index,overlay,kind:'screen_text'})} onDeleteText={deleteScreenTextAt} onToggleText={(panelIndex,index,overlay)=>toggleTextLayer({pageIndex:activePage,panelIndex,index,overlay,kind:'screen_text'})} onToggleBubble={(panelIndex,bubbleIndex,overlay=false,group=false)=>toggleTextLayer({pageIndex:activePage,panelIndex,index:bubbleIndex,overlay,kind:'bubble'},group)} onDeleteBubble={deleteBubbleAt} onReorderOwners={reorderOwnerLayers} page={page} activePanel={activePanel} assets={document.manga.image_assets??[]} dpi={getPrintSetup(document.manga).dpi} colorMode={paintColorMode(getPrintSetup(document.manga).format)} disabled={layerSwitchBusy||projectBusy||Boolean(qwenGeneration)} onSelect={selectLayerPanel} onVisibility={togglePanelLayer} onLock={togglePanelLock} onDelete={deletePanelAt} onAddFolder={addDirectFolder} onAdd={(index,kind,overlay=false,position)=>{try{const scene=makePaintScene(documentRef.current,index,activePage,overlay);actOnLayer(index,{type:'add',key:overlay?'page':'panel',kind,position:position??{}},scene,overlay);}catch(error){setToast(error instanceof Error?error.message:'レイヤーを追加できませんでした');}}} onAction={actOnLayer} onEditText={(panelIndex,bubbleIndex,overlay=false)=>startBubbleEdit({pageIndex:activePage,panelIndex,bubbleIndex,overlay})} guideVisible={(key,index,overlay=false)=>artworkGuideVisible(key,index,activePage,overlay)} toggleGuide={(key,index,overlay=false)=>toggleArtworkGuide(key,index,activePage,overlay)}/></div>
          </aside>}
          <aside id="mobile-panel-pane" class={`inspector-pane ${inspectorCollapsed?'is-collapsed':''}`}>
            <button class="dock-rail" aria-expanded={!inspectorCollapsed} aria-label={inspectorCollapsed?'コマ情報を開く':'コマ情報を閉じる'} onClick={()=>setInspectorCollapsed(!inspectorCollapsed)}><span>コマ情報</span>{inspectorCollapsed?'‹':'›'}</button>
            <div class="inspector-content">
            {Boolean(page.images?.some(image=>!image.paintScope&&!image.bubbleOriginal)) && <PlacedImageList title="ページ画像（コマ外）" images={page.images} assets={document.manga.image_assets} busy={imageImportBusy}
              selectedIndex={selectedElement?.type === 'image' && selectedElement.scope === 'page' ? selectedElement.index : undefined}
              onSelect={index => setSelectedElement(index === null ? null : { type: 'image', scope: 'page', index })}
              onChange={images => { lastHistoryPush.current = 0; mutate(draft => { draft.manga.pages[activePage].images = images; }); lastHistoryPush.current = 0; }}
              onMoveToPanel={panel ? movePageImageToPanel : undefined} />}
            {(paintSession?paintSession.overlay:selectedElement?.scope === 'page_overlay') && page.page_overlay
            ? <PageOverlayInspector onTextCategory={changeSelectedTextCategory} onSelectedText={changeSelectedTextBody} onHandwrittenHistoryBoundary={()=>{lastHistoryPush.current=0;}} onGenerateText={(kind,index)=>void requestTextGeneration(kind,index,true,0)} generationBusy={Boolean(qwenGeneration)||imageImportBusy||projectBusy} painting={Boolean(paintSession)} pageIndex={activePage} onScenarioChoice={chooseScenarioBubble} manga={document.manga} panels={page.panels} overlay={page.page_overlay} selectedElement={selectedElement} canvasSelectionScrollRequest={canvasSelectionScrollRequest} onSelectElement={setSelectedElement} onChange={(nextOverlay) => mutate((draft) => {
              if (nextOverlay) draft.manga.pages[activePage].page_overlay = nextOverlay;
              else delete draft.manga.pages[activePage].page_overlay;
            })} />
            : <PanelInspector onTextCategory={changeSelectedTextCategory} onSelectedText={changeSelectedTextBody} onHandwrittenHistoryBoundary={()=>{lastHistoryPush.current=0;}} onGenerateText={(kind,index)=>void requestTextGeneration(kind,index,false,activePanel)} generationBusy={Boolean(qwenGeneration)||imageImportBusy||projectBusy} onOpenBackground3d={()=>openPanelBackground3d(activePanel)} imageImportBusy={imageImportBusy} panelDraftToolbarTarget={null} painting={Boolean(paintSession)} guideVisible={key=>artworkGuideVisible(key,activePanel,activePage,false)} onToggleGuide={key=>toggleArtworkGuide(key,activePanel,activePage,false)} onScenarioChoice={chooseScenarioBubble} manga={document.manga} panel={panel} pageIndex={activePage} panelIndex={activePanel} selectedElement={selectedElement} canvasSelectionScrollRequest={canvasSelectionScrollRequest} episodeWorkspaceToken={!isLanClient && boundEpisodeWorkspace?.episodeId === document.manga.meta.episode_id ? boundEpisodeWorkspace.token : ''} episodeWorkspaceFolder={boundEpisodeWorkspace?.episodeId === document.manga.meta.episode_id ? boundEpisodeWorkspace.folderName : ''} seriesId={document.manga.meta.series_id} episodeId={document.manga.meta.episode_id} getOmnySnapshot={getOmnySnapshot} onChooseEpisodeWorkspace={choosePanelDraftWorkspace} onSelectElement={setSelectedElement} onChange={(nextPanel,origin='manual') => mutate((draft) => { const current=draft.manga.pages[activePage]?.panels[activePanel];if(current&&(origin==='agent'||!panelLocked(current)))draft.manga.pages[activePage].panels[activePanel] = nextPanel; })} onOpenBackgrounds={() => openMaterialsForPanel('background')} onOpenProps={() => openMaterialsForPanel('prop')} onAdd={addPanel} onDelete={deletePanel} />}</div></aside>
        </div>}
        {tab === 'meta' && <MetaEditor document={document} onChange={setDocument} />}
        {tab === 'setting' && <SettingEditor document={document} onChange={setDocument} onImportBackgroundModel={importBackgroundModel} onSaveBackgrounds={saveBackgroundsFromEditor} backgroundsSaving={seriesCatalogSaving||projectBusy} panelLinkMode={materialLinkTarget?.materialType === 'background' && materialLinkPanel ? {
          pageNumber: materialLinkTarget.pageIndex + 1,
          panelId: materialLinkPanel.id,
          linkedKeys: materialLinkPanel.assets ?? [],
        } : null} onTogglePanelMaterial={toggleMaterialForPanel} onReturnToPanel={returnFromMaterials} />}
        {tab === 'characters' && <CharactersEditor document={document} onChange={setDocument} onNotify={setToast} onSaveCharacters={saveCharactersFromEditor} charactersSaving={seriesCatalogSaving} onPatchDocument={patchLatestDocument} onPersistSeriesCatalog={persistSeriesCatalog} onFinalizeDeletedSeriesMaterial={finalizeDeletedSeriesMaterial} characterTextLink={characterTextLink} characterTextBusy={characterTextBusy} onLinkCharacterText={() => linkCharacterText(documentRef.current, characterTextLink?.seriesDirectory ?? '', setDocument, setCharacterTextLink)} onDeleteSeriesCharacter={(characterLocalId) => deleteSeriesCharacter(documentRef.current, characterLocalId, setDocument, setCharacterTextLink)} onRestoreDeletedCharacter={(deletionId) => restoreDeletedCharacter(documentRef.current, deletionId, setDocument, setCharacterTextLink)} />}
        {tab === 'props' && <PropsEditor document={document} onChange={setDocument} panelLinkMode={materialLinkTarget?.materialType === 'prop' && materialLinkPanel ? {
          pageNumber: materialLinkTarget.pageIndex + 1,
          panelId: materialLinkPanel.id,
          linkedKeys: (materialLinkPanel.figures ?? []).filter(isPropPlacement).map((figure) => figure.name),
        } : null} onTogglePanelMaterial={toggleMaterialForPanel} onReturnToPanel={returnFromMaterials} />}
        {tab === 'coverage' && <div class="scenario-workspace"><ScenarioReview document={document} onChange={setDocument} onNavigate={(pageIndex, panelIndex, bubbleIndex, overlay) => {
          setSelectedPanels([panelIndex]);
          selectCanvasElement(bubbleIndex === undefined ? null : { type: 'bubble', index: bubbleIndex, ...(overlay ? { scope: 'page_overlay' as const } : {}) },panelIndex,pageIndex,false);
          setTab('storyboard');
          if(bubbleIndex!==undefined&&(overlay?document.manga.pages[pageIndex]?.page_overlay:document.manga.pages[pageIndex]?.panels[panelIndex])?.bubbles?.[bubbleIndex]?.shape!=='handwritten'){setTextPaletteRequest(value=>({id:value.id+1,tab:'info'}));setMobileStoryboardPane('editor');}
          else {setInspectorCollapsed(false);setMobileStoryboardPane('panel');}
        }} />
        {!document.manga.scenario && <details class="scenario-legacy"><summary>資料との文字列照合（補助機能）</summary><SourceCoverageReview
          document={document}
          getOmnySnapshot={getOmnySnapshot}
          source={boundSourceSnapshot?.episodeId === document.manga.meta.episode_id ? boundSourceSnapshot.source : null}
          decisions={sourceCoverageDecisions}
          workspaceFolder={boundEpisodeWorkspace?.episodeId === document.manga.meta.episode_id ? boundEpisodeWorkspace.folderName : ''}
          canChooseWorkspaceSource={boundEpisodeWorkspace?.episodeId === document.manga.meta.episode_id}
          canSave={!isLanClient && Boolean(coverageWorkspace)}
          onSourceChange={setCoverageSource}
          onChooseWorkspaceSource={chooseCoverageWorkspaceSource}
          onConnectWorkspace={chooseCoverageWorkspace}
          onDecisionsChange={setSourceCoverageDecisions}
          onSave={saveCoverageReport}
          onNavigate={changeTab}
          onNotify={setToast}
        /></details>}</div>}
      </section>
    </main>
    </> : <main inert={environmentOpen} class="startup-home">
      <section class="startup-card" aria-label="起動メニュー">
        <div class="startup-actions">
          <button type="button" class="primary-button" onClick={openNewDialog}><FilePlus2 size={19} />新規作成</button>
          <button type="button" class="secondary-button" disabled={projectBusy} onClick={openProject}><FolderOpen size={19} />作品フォルダを開く</button>
        </div>
      </section>
    </main>}

    {environmentOpen && <>
      <div class="environment-backdrop" aria-hidden="true" onClick={closeEnvironmentSettings} />
      <section ref={environmentPanel} id="environment-dialog" class="environment-dialog" role="dialog" aria-modal="true" aria-label="環境設定" tabIndex={-1}>
        {environmentSettings}
        <aside class="environment-agent-host" ref={setEnvironmentAgentHost} aria-label="設定の会話"/>
      </section>
    </>}

    {showNewDialog && <>
      <button inert={environmentOpen} class="drawer-backdrop" onClick={closeNewDialog} disabled={newLayoutTask === 'creating'} aria-label="新規作成を閉じる" />
      <section inert={environmentOpen} class="new-dialog" role="dialog" aria-modal={!environmentOpen} aria-label="新規作成">
        <div class="drawer-head new-dialog-head"><h2>新規作成</h2><button onClick={closeNewDialog} disabled={newLayoutTask === 'creating'} aria-label="閉じる"><X size={16} /></button></div>
        <NewProjectNavigation {...{
          newCreationStep, seriesCatalogSaving, newLayoutTask, returnToSeriesSelection,
          setNewCreationStep, editingNewPrintSetup, newPrintConfirmed, setEditingNewPrintSetup,
          newSeriesMode, newEpisodeWorkspace, newSeriesPreparing, newWorkspaceSelecting,
          characterTextBusy, continueFromNewCharacters, newWorkSetting,
        }} />
        <div class="new-dialog-body" key={newCreationStep}>
          <div class="new-creation-content">
          {newCreationStep === 'series' && <NewSeriesStep {...{
            continueFromSeriesSelection, newSeriesMode, clearNewReferenceText,
            clearNewSeriesReference, setNewCharacterTextLink, setNewSeriesMode, setNewSeriesName,
            setNewSeriesId, setNewEpisodeWorkspace, setNewWorkspaceMessage, setSeriesCatalogMessage,
            seriesCatalogs, newSeriesName, newSeriesId, selectExistingSeries, newSeriesDirectory,
            chooseNewSeriesDirectory, newSeriesDirectorySelecting, newSeriesReferenceSelecting,
            newSeriesPreparing, newWorkspaceSelecting, newSeriesDirectoryMessage,
            newSeriesReferenceRows, newSelectedSeriesReferencePaths, newSeriesReferenceBusy,
            setNewSelectedSeriesReferencePaths, newSeriesReferenceMessage,
            chooseNewSeriesReferenceTextFile, selectedNewSeriesReferenceRows,
            removeSelectedNewSeriesReferences, newSeriesReferenceCandidates,
            applySelectedNewSeriesReferences, seriesCatalogMessage, newWorkTitle,
            newEpisodeWorkspace, chooseNewEpisodeWorkspace, newReferenceSelecting,
            newWorkspaceMessage, newReferenceFileName, newSuggestedEpisodeReference,
            chooseNewReferenceTextFile, applySuggestedReferenceTexts, newReferenceMessage,
          }} />}
          {newCreationStep === 'characters' && newCharacterDocument && <section class="new-character-step" aria-label="登場人物の登録">
            <CharactersEditor
              document={newCharacterDocument}
              onChange={setNewCharacterDocument}
              onNotify={setToast}
              embedded
              onSaveCharacters={isLanClient ? undefined : saveNewCharacters}
              charactersSaving={seriesCatalogSaving}
              onPatchDocument={patchNewCharacterDocument}
              onPersistSeriesCatalog={persistNewCharacterCatalog}
              onChooseCharacterImages={isLanClient ? undefined : chooseNewCharacterImageFiles}
              hideSystemMob
              characterTextLink={newCharacterTextLink}
              characterTextBusy={characterTextBusy}
              onLinkCharacterText={() => {
                const latest = newCharacterDocumentRef.current;
                if (latest) return linkCharacterText(latest, newEpisodeWorkspace?.directory ?? '', setNewCharacterDocument, setNewCharacterTextLink);
              }}
              onDeleteSeriesCharacter={(characterLocalId) => {
                const latest = newCharacterDocumentRef.current;
                if (latest) return deleteSeriesCharacter(latest, characterLocalId, setNewCharacterDocument, setNewCharacterTextLink);
              }}
              onRestoreDeletedCharacter={(deletionId) => {
                const latest = newCharacterDocumentRef.current;
                if (latest) return restoreDeletedCharacter(latest, deletionId, setNewCharacterDocument, setNewCharacterTextLink);
              }}
            />
          </section>}
          {newCreationStep === 'setting' && <NewSettingStep {...{
            continueFromNewSetting, newSeriesMode, newCharacterDocument, updateNewSeriesSetting,
            patchNewCharacterDocument, setNewSettingMessage, newWorkSetting, updateNewWorkSetting,
            newSettingMessage,
          }} />}
          {newCreationStep === 'layout' && <NewLayoutStep {...{
            editingNewPrintSetup, newPrintSetup, setNewPrintSetup, setNewPrintConfirmed,
            setEditingNewPrintSetup, setToast, newLayoutTask, newPrintConfirmed, createNewDocument,
            chooseNewLayoutImageFiles, requestScannerFinish, scannerReceivedCount, launchScanner,
            pendingScannerSession, persistAnalogAssets, changePersistAnalogAssets, newLayoutRowGapMm,
            updateNewLayoutGutter, newLayoutColumnGapMm, newLayoutFrameLineWidthMm,
            updateNewLayoutFrameLineWidth, resumeScanner, discardRecoveredScans, newLayoutImageInput,
            chooseNewLayoutImages, activeLayoutItem, newLayoutItems, newLayoutActiveIndex,
            setNewLayoutActiveIndex, rotateActiveLayoutImage, analyzeNewLayouts, newLayoutMessage,
            newCharacterReadProgress, scannerSession, hasScannedLayoutItems,
          }} />}
          </div>
        </div>
      </section>
    </>}
    {qwenGeneration&&<ImageGenerationDialog onOpenSettings={()=>{qwenGeneration.agentRequest?.reject(new Error('環境設定へ移動しました'));setQwenGeneration(null);void showEnvironmentSettings();}} adultContent={Boolean(document.manga.series_setting?.adult_content)} agentRequest={qwenGeneration.agentRequest} onConversation={setGenerationConversation} onConversationHost={setGenerationConversationHost} key={qwenGeneration.id} plan={qwenGeneration.plan} poseEditorContext={qwenGeneration.poseEditorContext} layers={qwenGeneration.layers} loadLayer={qwenGeneration.loadLayer} onInsert={insertQwenImage} onClose={()=>{qwenGeneration.agentRequest?.reject(new Error('生成を中止しました'));setQwenGeneration(null);}}/>}
    {toast && <div class="toast"><span>{toast}</span><button onClick={() => setToast(null)}><X size={15} /></button></div>}
  </div></PaintEditor>;
}
