import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import type { ButtonHTMLAttributes } from 'preact';
import { paintHelpItems } from '../lib/paintHelp';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  label:string;
  shortcut?:string|string[];
  disabled?:boolean;
}
/** Keep tool names accessible, with optional short keyboard hints. */
export function PaintToolButton({label,shortcut,disabled=false,children,onClick,...props}:ButtonProps){
  const shortcutText=Array.isArray(shortcut)?shortcut.join('\n'):shortcut;
  return <button {...props} type="button" class={`paint-help-button ${props.class??''}`}
    aria-label={label} aria-disabled={disabled||undefined} data-tool-label={label} data-tool-shortcut={shortcutText||undefined}
    onClick={event=>{if(disabled){event.preventDefault();event.stopPropagation();return;}
      // Do not leave Space bound to a tool that was just clicked with a mouse or pen.
      if(event.detail>0)event.currentTarget.blur();
      onClick?.(event);}}>{children}</button>;
}

export default function PaintToolHelp({enabled=true}:{enabled?:boolean}){
  const [hint,setHint]=useState<{target:HTMLElement;label:string;text:string}|null>(null);
  const [position,setPosition]=useState({left:0,top:0});
  const popup=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!enabled)return;
    let timer:ReturnType<typeof setTimeout>|undefined,target:HTMLElement|null=null;
    const clear=()=>{clearTimeout(timer);timer=undefined;target?.removeAttribute('aria-describedby');target=null;setHint(null);};
    const find=(node:EventTarget|null)=>node instanceof Element?node.closest<HTMLElement>('[data-tool-shortcut]'):null;
    const schedule=(next:HTMLElement|null)=>{
      if(next===target)return;clear();if(!next)return;target=next;
      timer=setTimeout(()=>{if(target!==next||!next.isConnected)return;next.setAttribute('aria-describedby','paint-tool-description');setHint({target:next,label:next.dataset.toolLabel??next.getAttribute('aria-label')??'',text:next.dataset.toolShortcut??''});},1000);
    };
    const over=(event:PointerEvent)=>{if(event.pointerType!=='touch'&&!event.buttons)schedule(find(event.target));};
    const out=(event:PointerEvent)=>{if(find(event.relatedTarget)!==target)clear();};
    const focus=(event:FocusEvent)=>schedule(find(event.target));
    const blur=(event:FocusEvent)=>{if(find(event.relatedTarget)!==target)clear();};
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'&&target){clear();event.preventDefault();event.stopImmediatePropagation();}};
    document.addEventListener('pointerover',over,true);document.addEventListener('pointerout',out,true);
    document.addEventListener('focusin',focus,true);document.addEventListener('focusout',blur,true);
    document.addEventListener('pointerdown',clear,true);document.addEventListener('keydown',key,true);
    window.addEventListener('scroll',clear,true);window.addEventListener('resize',clear);window.addEventListener('blur',clear);
    return()=>{clear();document.removeEventListener('pointerover',over,true);document.removeEventListener('pointerout',out,true);document.removeEventListener('focusin',focus,true);document.removeEventListener('focusout',blur,true);document.removeEventListener('pointerdown',clear,true);document.removeEventListener('keydown',key,true);window.removeEventListener('scroll',clear,true);window.removeEventListener('resize',clear);window.removeEventListener('blur',clear);};
  },[enabled]);
  useLayoutEffect(()=>{
    if(!hint||!popup.current)return;const a=hint.target.getBoundingClientRect(),b=popup.current.getBoundingClientRect();
    const left=a.right+10+b.width<=window.innerWidth-8?a.right+10:a.left-10-b.width;
    setPosition({left:Math.max(8,Math.min(left,window.innerWidth-b.width-8)),top:Math.max(8,Math.min(a.top,window.innerHeight-b.height-8))});
  },[hint]);
  if(!enabled||!hint||typeof document==='undefined')return null;
  const items=paintHelpItems(hint.text);
  return createPortal(<div ref={popup} id="paint-tool-description" role="tooltip" class="paint-tool-help" style={position}><strong>{hint.label}</strong>{items.length>1?<ul>{items.map(item=><li>{item}</li>)}</ul>:<p>{items[0]??hint.text}</p>}</div>,document.body);
}
