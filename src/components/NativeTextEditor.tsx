import {useEffect,useLayoutEffect,useRef} from 'preact/hooks';
import type {TextWeightRange} from '../types';
import {textWeightSegments,type TextSelection} from '../lib/textStyle';

function selectionIn(root:HTMLElement):TextSelection|undefined{
  const selection=window.getSelection();if(!selection?.rangeCount)return;
  const range=selection.getRangeAt(0);if(!root.contains(range.startContainer)||!root.contains(range.endContainer))return;
  const prefix=range.cloneRange();prefix.selectNodeContents(root);prefix.setEnd(range.startContainer,range.startOffset);
  const start=prefix.toString().length;return {start,end:start+range.toString().length};
}
function restoreSelection(root:HTMLElement,selection:TextSelection){
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node:Node|null,at=0;
  const range=document.createRange();let started=false,ended=false;
  while((node=walker.nextNode())){
    const length=node.textContent?.length??0;
    if(!started&&selection.start<=at+length){range.setStart(node,Math.max(0,selection.start-at));started=true;}
    if(started&&selection.end<=at+length){range.setEnd(node,Math.max(0,selection.end-at));ended=true;break;}at+=length;
  }
  if(!started)range.selectNodeContents(root);
  if(!ended)range.collapse(false);
  const current=window.getSelection();current?.removeAllRanges();current?.addRange(range);
}
function trailingBreak(root:HTMLElement){
  const needed=(root.textContent??'').endsWith('\n'),last=root.lastChild;
  if(needed&&!(last instanceof HTMLBRElement)){const br=document.createElement('br');br.dataset.caretBreak='true';root.append(br);}
  else if(!needed&&last instanceof HTMLBRElement&&last.dataset.caretBreak)last.remove();
}
/** The native document owns the text; this editable projection retains IME and selection. */
export default function NativeTextEditor({text,weights,label,style,onText,onSelection,onEnd,onHistory}:{
  text:string;weights?:TextWeightRange[];label:string;style:Record<string,string>;
  onHistory?:(direction:'undo'|'redo')=>void;
  onText:(text:string,edit?:TextSelection)=>void;onSelection:(selection:TextSelection)=>void;onEnd:()=>void;
}){
  const root=useRef<HTMLDivElement>(null),composing=useRef(false),rendered=useRef(''),savedSelection=useRef<TextSelection|undefined>();
  const current=useRef({onText,onSelection,onEnd,onHistory});current.current={onText,onSelection,onEnd,onHistory};
  const pending=useRef<{text:string;selection?:TextSelection;type:string}>();
  const read=()=>root.current?.textContent??'';
  const before=(type:string)=>{if(root.current)pending.current={text:read(),selection:selectionIn(root.current),type};};
  const commit=()=>{
    const next=read(),old=pending.current;pending.current=undefined;
    let edit=old?.selection;
    if(old&&edit&&edit.start===edit.end&&old.type.startsWith('delete')){
      const removed=old.text.length-next.length;
      if(removed>0)edit=old.type.includes('Backward')?{start:edit.start-removed,end:edit.end}:{start:edit.start,end:edit.end+removed};
    }
    current.current.onText(next,edit);
  };
  const remember=()=>{if(root.current){const s=selectionIn(root.current);if(s){savedSelection.current=s;current.current.onSelection(s);}}};
  useLayoutEffect(()=>{
    const element=root.current;if(!element||composing.current)return;
    const key=JSON.stringify([text,weights]);
    if(key===rendered.current)return;
    const selection=selectionIn(element)??savedSelection.current;
    if(read()!==text||JSON.stringify(weights)!==JSON.stringify(JSON.parse(rendered.current||'[]')[1])){
      const parts=textWeightSegments({text,text_weights:weights}).map(segment=>{const span=document.createElement('span');span.textContent=segment.text;if(segment.fontWeight)span.style.fontWeight=String(segment.fontWeight);return span;});
      element.replaceChildren(...parts);trailingBreak(element);
      if(selection)restoreSelection(element,{start:Math.min(selection.start,text.length),end:Math.min(selection.end,text.length)});
    }
    trailingBreak(element);rendered.current=key;
  },[text,weights]);
  useEffect(()=>{
    const element=root.current;if(!element)return;
    element.focus();restoreSelection(element,{start:0,end:text.length});remember();
    const changed=()=>remember();document.addEventListener('selectionchange',changed);
    return()=>document.removeEventListener('selectionchange',changed);
  },[]);
  const insert=(value:string)=>{
    const element=root.current;if(!element)return;element.focus();
    if(savedSelection.current)restoreSelection(element,savedSelection.current);
    const selection=window.getSelection();if(!selection?.rangeCount)return;
    before('insertText');
    const range=selection.getRangeAt(0);range.deleteContents();const node=document.createTextNode(value);range.insertNode(node);trailingBreak(element);
    range.setStartAfter(node);range.collapse(true);selection.removeAllRanges();selection.addRange(range);
    remember();commit();
  };
  return <div ref={root} class="native-text-input" role="textbox" aria-label={label} aria-multiline="true" contentEditable spellcheck={false} style={style}
    onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();remember();}} onKeyUp={remember}
    onCompositionStart={()=>{before('insertCompositionText');composing.current=true;}}
    onCompositionEnd={()=>{composing.current=false;remember();commit();}}
    onBeforeInput={e=>{if(composing.current)return;if(['historyUndo','historyRedo'].includes(e.inputType)&&current.current.onHistory){e.preventDefault();current.current.onHistory(e.inputType==='historyUndo'?'undo':'redo');return;}if(e.inputType==='insertParagraph'||e.inputType==='insertLineBreak'){e.preventDefault();insert('\n');}else before(e.inputType);}}
    onInput={()=>{remember();if(!composing.current)commit();}}
    onPaste={e=>{e.preventDefault();insert(e.clipboardData?.getData('text/plain')??'');}}
    onDrop={e=>{e.preventDefault();}}
    onKeyDown={e=>{
      if(e.isComposing||composing.current)return;
      if((e.metaKey||e.ctrlKey)&&['z','y'].includes(e.key.toLowerCase())&&current.current.onHistory){e.preventDefault();e.stopPropagation();current.current.onHistory(e.key.toLowerCase()==='y'||e.shiftKey?'redo':'undo');}
      else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();current.current.onEnd();}
      else if(e.key==='Enter'){e.preventDefault();insert('\n');}
    }}
    onBlur={e=>{if(!(e.relatedTarget instanceof Element)||!e.relatedTarget.closest('.canvas-text-toolbar')){if(composing.current)commit();composing.current=false;current.current.onEnd();}}}/>
}
