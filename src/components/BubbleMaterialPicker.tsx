import {useState} from 'preact/hooks';
import {X} from 'lucide-preact';
import {BUBBLE_PRESETS,BUBBLE_PRESET_LAYERS} from '../lib/bubblePresetCatalog';
import {BUBBLE_MATERIAL_DRAG_TYPE} from '../lib/bubblePresetData';
export default function BubbleMaterialPicker({onClose,onApply,canApply}:{onClose:()=>void;onApply:(id:string)=>void;canApply:boolean}){
  const [layer,setLayer]=useState<string>('all');
  return <aside class="bubble-material-window" role="dialog" aria-label="吹き出し素材" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();onClose();}}}>
    <div class="bubble-material-window-header"><strong>吹き出し素材</strong><button type="button" aria-label="吹き出し素材を閉じる" onClick={onClose}><X size={16}/></button></div>
    <p>素材を吹き出しに重ねて輪郭を入れ替えます。文字・大きさ・位置は保持します。</p>
    <label>分類<select aria-label="吹き出し素材の分類" value={layer} onChange={e=>setLayer(e.currentTarget.value)}><option value="all">すべて（{BUBBLE_PRESETS.length}）</option>{BUBBLE_PRESET_LAYERS.map(name=><option value={name}>{name}</option>)}</select></label>
    <div class="bubble-material-window-grid">{BUBBLE_PRESETS.filter(p=>layer==='all'||p.layer===layer).map(p=><button type="button" draggable={true} class="bubble-material-tile" aria-label={`${p.label}を重ねる`} title={canApply?'クリックで選択中の吹き出しに適用／ドラッグで重ねる':'吹き出しにドラッグして重ねる'}
      onDragStart={e=>{if(e.dataTransfer){e.dataTransfer.setData(BUBBLE_MATERIAL_DRAG_TYPE,p.id);e.dataTransfer.effectAllowed='copy';}}}
      onClick={()=>{if(canApply)onApply(p.id);}}><img src={p.asset} alt="" draggable={false}/><span>{p.layer} {p.id.slice(-2)}</span></button>)}</div>
    <small>{canApply?'クリックでも選択中の吹き出しに適用できます。':'吹き出しを選択すると、クリックでも適用できます。'}</small>
  </aside>;
}
