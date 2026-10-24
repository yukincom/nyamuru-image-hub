import { Eye } from 'lucide-preact';
import { PaintToolButton } from './PaintToolHelp';
export default function LayerVisibilityButton({label,visible,disabled=false,onClick}:{label:string;visible:boolean;disabled?:boolean;onClick:()=>void}){
  return <PaintToolButton class="palette-icon layer-visibility" label={label} help="表示だけを切り替えます。絵や元のあたり情報は保持します。" disabled={disabled} aria-pressed={visible} onClick={onClick}>{visible&&<Eye size={16}/>}</PaintToolButton>;
}
