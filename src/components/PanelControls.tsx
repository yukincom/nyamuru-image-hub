import { Combine, Scissors } from 'lucide-preact';
interface Props {
  painting:boolean;
  innerFrameSnap:boolean; panelGapSnap:boolean; panelSync:boolean;
  onToggleInnerFrameSnap:()=>void; onTogglePanelGapSnap:()=>void; onTogglePanelSync:()=>void;
  selectedCount:number; onMerge:()=>void; splitDirection:'vertical'|'horizontal';
  onSplitDirection:(value:'vertical'|'horizontal')=>void; onSplit:()=>void;
}
export default function PanelControls(p:Props){
  return <details class="panel-controls"><summary>コマ コントロール</summary><div class="panel-controls-body">
    <label class="panel-snap-setting"><input type="checkbox" checked={p.innerFrameSnap} onChange={p.onToggleInnerFrameSnap}/>内枠スナップ</label>
    <label class="panel-snap-setting"><input type="checkbox" checked={p.panelGapSnap} onChange={p.onTogglePanelGapSnap}/>コマスナップ</label>
    <label class="panel-snap-setting"><input type="checkbox" checked={p.panelSync} onChange={p.onTogglePanelSync}/>コマシンクロ</label>
    <div class="panel-control-actions"><button onClick={p.onMerge} disabled={p.painting||p.selectedCount<2}><Combine size={15}/>合体</button>
      <select disabled={p.painting} aria-label="コマ分割" value={p.splitDirection} onChange={e=>p.onSplitDirection(e.currentTarget.value as Props['splitDirection'])}><option value="vertical">タテ分割</option><option value="horizontal">ヨコ分割</option></select>
      <button disabled={p.painting} onClick={p.onSplit} title="コマ分割" aria-label="コマ分割を適用"><Scissors size={15}/></button></div>
  </div></details>;
}
