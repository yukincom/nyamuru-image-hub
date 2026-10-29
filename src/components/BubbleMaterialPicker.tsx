import {useState} from 'preact/hooks';
import {createPortal} from 'preact/compat';
import {PenTool} from 'lucide-preact';
import {BUBBLE_PRESETS,BUBBLE_PRESET_LAYERS} from '../lib/bubblePresetCatalog';
import {BUBBLE_MATERIAL_DRAG_TYPE} from '../lib/bubblePresetData';
const layerLabel=(layer:string)=>layer==='thought'?'雲形':layer;
export default function BubbleMaterialPicker({onClose,onApply,canApply}:{onClose:()=>void;onApply:(id:string)=>void;canApply:boolean}){
  const [layer,setLayer]=useState<string>('all');
  const target=typeof document==='undefined'?null:document.getElementById('paint-bubble-materials-slot');
  if(!target)return null;
  return createPortal(<div class="bubble-material-window" aria-label="吹き出し素材" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();onClose();}}}>
    <label>分類<select aria-label="吹き出し素材の分類" value={layer} onChange={e=>setLayer(e.currentTarget.value)}><option value="all">すべて（{BUBBLE_PRESETS.length}）</option>{BUBBLE_PRESET_LAYERS.map(name=><option value={name}>{layerLabel(name)}（{BUBBLE_PRESETS.filter(preset=>preset.layer===name).length}）</option>)}</select></label>
    <div class="bubble-material-window-grid">{BUBBLE_PRESETS.filter(p=>layer==='all'||p.layer===layer).map(p=><button type="button" draggable={true} class="bubble-material-tile" aria-label={`${p.label}を重ねる`}
      onDragStart={e=>{if(e.dataTransfer){e.dataTransfer.setData(BUBBLE_MATERIAL_DRAG_TYPE,p.id);e.dataTransfer.effectAllowed='copy';}}}
      onClick={()=>{if(canApply)onApply(p.id);}}><span class="bubble-material-preview" style={`--bubble-material-url:url("${p.asset}")`} aria-hidden="true"/><span>{p.label}</span><small class="bubble-material-kind"><PenTool size={11} aria-hidden="true"/>ベクター</small></button>)}</div>
  </div>,target);
}
