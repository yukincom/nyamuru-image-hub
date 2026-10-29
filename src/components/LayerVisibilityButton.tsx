import { Eye } from 'lucide-preact';
import { PaintToolButton } from './PaintToolHelp';
export default function LayerVisibilityButton({label,visible,disabled=false,onClick}:{label:string;visible:boolean;disabled?:boolean;onClick:()=>void}){
  return <PaintToolButton class="palette-icon layer-visibility" label={label}  disabled={disabled} aria-pressed={visible} onClick={onClick}>{visible&&<Eye size={16}/>}</PaintToolButton>;
}
