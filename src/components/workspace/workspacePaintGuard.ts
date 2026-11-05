import { useEffect } from 'preact/hooks';
import type { PaintScene } from '../../lib/paintDocument';
import type { WorkspaceState } from './useWorkspaceState';

interface Actions {
  openPaint: (initialOwner?: string, panelIndex?: number, pageIndex?: number, overlay?: boolean, preview?: PaintScene) => boolean;
}

export function useWorkspacePaintGuard({
  autoPaintResume, paintSessionRef, autoPaintTransition, layerSwitch, projectOperation, imageImportBusy,
  qwenGeneration, tab, activePage, activePanel, paintController, setLayerSwitchBusy, setToast,
  paintSession,
}: WorkspaceState, {
  openPaint,
}: Actions) {
  const autoPaintBoundary=(event:Event)=>{
    if(!(event.target instanceof Element))return;
    if(event.target.closest('[data-paint-canvas]')){
      const pending=autoPaintResume.current;
      if(!pending||paintSessionRef.current||autoPaintTransition.current||layerSwitch.current||projectOperation.current||imageImportBusy||qwenGeneration||tab!=='storyboard')return;
      if(pending.pageIndex!==activePage||pending.panelIndex!==activePanel){autoPaintResume.current=null;return;}
      autoPaintResume.current=null;
      openPaint(pending.ownerKey,pending.panelIndex,pending.pageIndex,pending.overlay);
      return;
    }
    if(!event.target.closest('.inspector-content'))return;
    const session=paintSessionRef.current,controller=paintController.current;
    if(!session||!controller||autoPaintTransition.current||layerSwitch.current||projectOperation.current||imageImportBusy||qwenGeneration)return;
    const ownerKey=controller.snapshot().ownerKey||session.initialOwner||'background';
    autoPaintResume.current={pageIndex:session.pageIndex,panelIndex:session.panelIndex,overlay:session.overlay,ownerKey};
    autoPaintTransition.current=true;layerSwitch.current=true;setLayerSwitchBusy(true);
    void controller.close().catch(error=>{autoPaintResume.current=null;setToast(error instanceof Error?error.message:'描画を確定できませんでした');}).finally(()=>{
      autoPaintTransition.current=false;layerSwitch.current=false;setLayerSwitchBusy(false);
    });
  };
  useEffect(()=>{
    const pending=autoPaintResume.current;
    if(pending&&(tab!=='storyboard'||pending.pageIndex!==activePage||pending.panelIndex!==activePanel))autoPaintResume.current=null;
  },[tab,activePage,activePanel]);

  const guardDuringPaint=(event:Event)=>{
    if(!paintSession||!(event.target instanceof Element)||!event.target.closest('.workspace-tabs,.app-header,.page-list,.add-page-button,.sidebar-tools,.canvas-toolbar-actions,.page-switcher,.inspector-content,.mobile-storyboard-tabs'))return;
    if(event instanceof KeyboardEvent&&(event.key==='Tab'||((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='s')))return;
    if(!projectOperation.current&&!layerSwitch.current&&(event.target.closest('.page-switcher')||event.target.closest('.page-card')&&!event.target.closest('.page-move')))return;
    if(!projectOperation.current&&event.target.closest('[data-project-save],[data-project-history],[data-environment-settings],[data-voice-command],.guide-display-control,.panel-snap-setting,.workspace-tabs'))return;
    event.preventDefault();event.stopPropagation();
    if(event.type==='click')setToast(autoPaintTransition.current?'描画を確定しています。完了後に操作してください':'描画を確定してから操作してください');
  };
  return { autoPaintBoundary, guardDuringPaint };
}
