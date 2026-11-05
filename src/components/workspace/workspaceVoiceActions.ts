import { agentEditorSnapshot, selectedAgentBubble, prepareAgentBubbleEdit } from '../../lib/agentTools';
import { type VoiceCommand, resolveVoiceGenerationTarget } from '../../lib/voiceCommands';
import { connectAgentImageGeneration } from '../../lib/localBridge';
import { applyArtworkSettings, getArtworkSettings } from '../../lib/artworkRules';
import { type CanvasTextTarget, canvasTextEditable, editCanvasText, canvasTextAt } from '../../lib/canvasText';
import type { MutableRef, WorkspacePaintSession, WorkspaceSnapshot, EditorTimeline, WorkspaceGeneration } from './workspaceTypes';
import type { MangaDocument, CanvasElementSelection } from '../../types';
import type { PaintSessionSnapshot, PaintController } from '../../lib/paintSession';
import type { QwenAgentRequest } from '../../lib/qwenGeneration';

interface Context {
  hasDocument: boolean;
  showNewDialog: boolean;
  historyAvailable: () => boolean;
  paintSessionRef: MutableRef<WorkspacePaintSession | null>;
  editingText: CanvasTextTarget | null;
  imageGesture: MutableRef<{ active: boolean; pushed: boolean; source?: 'text-size'; }>;
  documentRef: MutableRef<MangaDocument>;
  agentRevision: MutableRef<(current: string) => string>;
  voiceRevision: (withHistory?: boolean) => string;
  activePage: number;
  activePanel: number;
  selectedElement: CanvasElementSelection | null;
  workspaceSnapshot: (state?: PaintSessionSnapshot) => WorkspaceSnapshot;
  setDocument: (next: MangaDocument, record?: boolean) => void;
  timeline: MutableRef<EditorTimeline>;
  lastHistoryPush: MutableRef<number>;
  changedHistory: () => void;
  projectOperation: MutableRef<boolean>;
  layerSwitch: MutableRef<boolean>;
  imageImportBusy: boolean;
  qwenGeneration: WorkspaceGeneration | null;
  paintController: MutableRef<PaintController | null>;
  openBubbleMaterials: () => void;
  saveProject: (chooseDestination?: boolean) => Promise<string | undefined>;
  past: WorkspaceSnapshot[];
  future: WorkspaceSnapshot[];
  undo: () => void;
  redo: () => void;
  panelSync: boolean;
  innerFrameSnap: boolean;
  panelGapSnap: boolean;
  showGuides: boolean;
  spreadView: boolean;
  togglePanelSync: () => void;
  toggleInnerFrameSnap: () => void;
  togglePanelGapSnap: () => void;
  changeShowGuides: (next: boolean) => void;
  changeSpreadView: (next: boolean) => void;
  latestVoiceRevision: MutableRef<(withHistory?: boolean) => string>;
  environmentOpen: boolean;
  closeEnvironmentSettings: () => void;
  requestOwnerGeneration: (key?: string, overlay?: boolean, panelIndex?: number, pageIndex?: number, agentRequest?: QwenAgentRequest) => Promise<boolean | undefined>;
  document: MangaDocument;
  selectPage: (index: number, panelIndex?: number) => Promise<void>;
  mutate: (recipe: (draft: MangaDocument) => void) => void;
}

export function createWorkspaceVoiceActions({
  hasDocument, showNewDialog, historyAvailable, paintSessionRef, editingText, imageGesture,
  documentRef, agentRevision, voiceRevision, activePage, activePanel, selectedElement,
  workspaceSnapshot, setDocument, timeline, lastHistoryPush, changedHistory, projectOperation,
  layerSwitch, imageImportBusy, qwenGeneration, paintController, openBubbleMaterials, saveProject,
  past, future, undo, redo, panelSync, innerFrameSnap, panelGapSnap, showGuides, spreadView,
  togglePanelSync, toggleInnerFrameSnap, togglePanelGapSnap, changeShowGuides, changeSpreadView,
  latestVoiceRevision, environmentOpen, closeEnvironmentSettings, requestOwnerGeneration, document,
  selectPage, mutate,
}: Context) {
  const agentBlocked=()=>!hasDocument?'原稿を開いてください':showNewDialog||!historyAvailable()?'現在の処理を終えてください':
    paintSessionRef.current?'配置へ戻ってから操作してください':editingText||imageGesture.current.active?'現在の文字入力やドラッグを終えてください':null;
  const inspectAgent=()=>agentEditorSnapshot(hasDocument?documentRef.current:null,
    agentRevision.current(JSON.stringify({editor:voiceRevision(false),blocked:agentBlocked()})),
    activePage,selectedAgentBubble(activePage,activePanel,selectedElement),agentBlocked(),{panelIndex:activePanel,selection:selectedElement});
  const applyAgentBubbleEdit=(value:unknown)=>{
    const blocked=agentBlocked();if(blocked)throw Error(blocked);
    const snapshot=inspectAgent(),next=prepareAgentBubbleEdit(documentRef.current,selectedAgentBubble(activePage,activePanel,selectedElement),snapshot.revision,value);
    if(JSON.stringify(next)!==JSON.stringify(documentRef.current)){
      const before=workspaceSnapshot();setDocument(next,false);timeline.current.record(before);lastHistoryPush.current=0;changedHistory();
    }
    return inspectAgent();
  };
  async function applyVoiceCommand(command:VoiceCommand,isCurrent:()=>boolean=()=>true):Promise<string>{
    if(!hasDocument||showNewDialog||projectOperation.current||layerSwitch.current||imageImportBusy||qwenGeneration||
       (paintController.current&&!paintController.current.canRestore()))throw new Error('現在の処理が終わってから操作してください');
    if(command.op==='open_bubble_materials'){openBubbleMaterials();return '吹き出し素材を開きました';}
    if(command.op==='save')return await saveProject()??'保存を開始できませんでした';
    if(command.op==='undo'||command.op==='redo'){
      if(!(command.op==='undo'?past:future).length)return '対象の編集履歴がありません';
      if(!historyAvailable())throw new Error('現在の状態では編集履歴を変更できません');
      (command.op==='undo'?undo:redo)();return command.op==='undo'?'作業を元に戻しました':'作業をやり直しました';
    }
    if(command.op==='setting'){
      const state={panel_sync:panelSync,inner_frame_snap:innerFrameSnap,panel_gap_snap:panelGapSnap,guides:showGuides,spread:spreadView};
      if(state[command.key]===command.enabled)return 'すでに指定された設定です';
      if(command.key==='panel_sync')togglePanelSync();else if(command.key==='inner_frame_snap')toggleInnerFrameSnap();
      else if(command.key==='panel_gap_snap')togglePanelGapSnap();else if(command.key==='guides')changeShowGuides(command.enabled);else changeSpreadView(command.enabled);
      return '指定された表示・編集設定に変更しました';
    }
    if(command.op==='paint_tool'){
      if(!paintController.current?.selectTool)throw new Error('描画対象を選んでペイントを開いてから、ペンを切り替えてください');
      paintController.current.selectTool(command.tool);return command.tool==='pen'?'ラスターペンに切り替えました':'ベクターペンに切り替えました';
    }
    if(command.op==='generate_selected'){
      if(paintSessionRef.current)throw new Error('配置へ戻ってから操作してください');
      const target=resolveVoiceGenerationTarget(documentRef.current,activePage,activePanel,selectedElement,command);
      const captured=documentRef.current,revision=latestVoiceRevision.current();
      await connectAgentImageGeneration(isCurrent);
      if(!isCurrent()||documentRef.current!==captured||latestVoiceRevision.current()!==revision)throw new Error('作品や選択が変更されたため生成を中止しました');
      if(environmentOpen)closeEnvironmentSettings();
      return new Promise<string>((resolve,reject)=>{
        const agentRequest={isCurrent,resolve,reject};
        void requestOwnerGeneration(`${target.kind}-${target.index}`,target.overlay,target.panelIndex,target.pageIndex,agentRequest)
          .then(opened=>{if(!opened)reject(new Error('生成の準備を開けませんでした。通知を確認してください'));},reject);
      });
    }
    if(paintSessionRef.current)throw new Error('配置へ戻ってから操作してください');
    if(command.op==='page'){
      const target=command.target;
      const index=typeof target==='number'?document.manga.pages.findIndex(p=>p.page===target):target==='next'?activePage+1:target==='previous'?activePage-1:target==='first'?0:document.manga.pages.length-1;
      if(index<0||index>=document.manga.pages.length)throw new Error('指定されたページがありません');
      selectPage(index);return `${document.manga.pages[index].page}ページを表示しました`;
    }
    if(command.op==='artwork'){
      mutate(draft=>applyArtworkSettings(draft.manga,{...getArtworkSettings(draft.manga),mode:command.mode}));
      return command.mode==='draft'?'作画方式を下書き生成に変更しました':'作画方式を一体生成に変更しました';
    }
    if(command.op==='bubble_shape'||command.op==='bubble_text'){
      if(selectedElement?.type!=='bubble')throw new Error('変更するフキダシを一つ選択してください');
      const target:CanvasTextTarget={pageIndex:activePage,panelIndex:activePanel,index:selectedElement.index,kind:'bubble',overlay:selectedElement.scope==='page_overlay'};
      if(!canvasTextEditable(documentRef.current,target,'agent'))throw new Error('対象のフキダシが非表示、または見つかりません');
      mutate(draft=>{if(command.op==='bubble_text')editCanvasText(draft,target,command.text,undefined,'agent');else{
        const bubble=canvasTextAt(draft,target) as import('../../types').Bubble;bubble.shape=command.shape;delete bubble.bezier;
      }});
      return command.op==='bubble_text'?'フキダシの本文を変更しました':'フキダシの形を変更しました';
    }
    throw new Error('この操作の実行先がありません');
  }

  return { applyVoiceCommand, inspectAgent, applyAgentBubbleEdit };
}
