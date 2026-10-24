import type { ComponentChildren } from 'preact';
function SamplePath({d,x,y}:{d:string;x:number;y:number}){return <><path class="sample-path" d={d}/><rect class="sample-anchor" x={x-2.5} y={y-2.5} width="5" height="5"/></>;}
/** Rails mark each object's edge or centre; dimension ticks mark the gap itself. */
function DistributionSample({horizontal,mode}:{horizontal:boolean;mode:string}){
  if(mode==='gap')return horizontal?<>
    <g fill="currentColor" stroke="none"><rect x="5" y="10" width="7" height="12"/><rect x="20" y="10" width="5" height="8"/></g>
    <path d="M12 5H20M12 2V8M20 2V8" stroke-width="1.25"/>
  </>:<>
    <g fill="currentColor" stroke="none"><rect x="11" y="2" width="11" height="7"/><rect x="11" y="16" width="17" height="6"/></g>
    <path d="M6 9V16M3 9H9M3 16H9" stroke-width="1.25"/>
  </>;
  const rails=horizontal?(mode==='start'?[3,19]:mode==='center'?[8.5,23.5]:[14,28]):(mode==='start'?[2,13]:mode==='center'?[6.5,18]:[11,23]);
  return <>
    <g fill="currentColor" stroke="none">{horizontal?<><rect x="5" y="4" width="7" height="16"/><rect x="21" y="8" width="5" height="10"/></>:<><rect x="10" y="4" width="12" height="5"/><rect x="7" y="15" width="18" height="6"/></>}</g>
    <path d={rails.map(p=>horizontal?`M${p} 1V23`:`M3 ${p}H29`).join(' ')} stroke-width="1.25"/>
  </>;
}
/** Small stroke samples use filled areas, so a thin outline is never the only cue. */
export default function VectorOptionIcon({kind,flip=false}:{kind:string;flip?:boolean}){
  let content:ComponentChildren;
  const cornerSample=/^(cap|join|position)-/.test(kind);
  const wideSample=/^(dash|profile|arrow)-/.test(kind);
  if(kind.startsWith('distribute-')){const [,axis,mode]=kind.split('-');content=<DistributionSample horizontal={axis==='x'} mode={mode}/>;}
  else if(kind.startsWith('cap-')){const cap=kind.slice(4);content=<><path d="M4 16H26" stroke-width="12" stroke-linecap={cap as 'butt'|'round'|'square'}/><SamplePath d="M4 16H26" x={26} y={16}/></>;}
  else if(kind.startsWith('join-'))content=<><path d="M12 29V10H38" stroke-width="12" stroke-linejoin={kind.slice(5) as 'miter'|'round'|'bevel'}/><SamplePath d="M12 29V10H38" x={12} y={10}/></>;
  else if(kind.startsWith('position-')){const a=kind.slice(9),offset=a==='inside'?4:a==='outside'?-4:0;content=<><path d={`M${12+offset} 2V${22-offset}H38`} stroke-width="8" stroke-linejoin="miter"/><SamplePath d="M12 2V22H38" x={12} y={22}/></>;}
  else if(kind.startsWith('fill-')||kind.startsWith('stroke-')){const value=kind.split('-')[1];content=<><rect x="5" y="3" width="22" height="18" rx="2" fill={value==='black'?'#111111':value==='white'?'#ffffff':'none'} stroke-width="2"/>{value==='none'&&<path d="m5 21 22-18" stroke-width="3"/>}</>;}
  else if(kind.startsWith('dash-'))content=<path d="M6 14h84" stroke-width="5" stroke-dasharray={kind==='dash-on'?'13 8':undefined}/>;
  else if(kind.startsWith('profile-'))content=<path d={kind==='profile-uniform'?'M6 8h84v12H6z':kind==='profile-taper'?'M6 7 90 14 6 21z':'M6 14Q48-1 90 14Q48 29 6 14z'} fill="currentColor" stroke="none"/>;
  else if(kind.startsWith('arrow-')){const value=kind.slice(6);content=<><path d={`M6 14H${value==='none'?90:84}`} stroke-width="3"/>{value==='triangle'?<path d="m77 4 17 10-17 10z" fill="currentColor" stroke="none"/>:value==='open'?<path d="m79 5 13 9-13 9" stroke-width="3" stroke-linejoin="miter"/>:value==='circle'?<circle cx="85" cy="14" r="8" fill="currentColor" stroke="none"/>:null}</>;}
  else if(kind.startsWith('reference-'))content=kind==='reference-canvas'?<><rect x="3" y="2" width="26" height="20" stroke-width="3"/><rect x="10" y="8" width="7" height="8" fill="currentColor"/></>:<><rect x="4" y="4" width="8" height="16" fill="currentColor" opacity={kind==='reference-key'?1:.65}/><rect x="20" y="8" width="8" height="12" fill="currentColor" opacity={kind==='reference-key'?.35:.65}/>{kind==='reference-selection'&&<rect x="2" y="2" width="28" height="20" stroke-dasharray="2 2"/>}</>;
  else if(kind.startsWith('erase-')){const mode=kind.slice(6);content=<><path d="M9 2v20M23 2v20" stroke-width="2" opacity=".55"/>{mode==='whole'?<path d="M2 12h28" stroke-width="4" stroke-dasharray="2 3" opacity=".4"/>:<path d={mode==='intersection'?'M2 12h7m14 0h7':'M2 12h10m8 0h10'} stroke-width="4"/>}<path d="m13 5 5 5m0-5-5 5" stroke-width="2"/></>;}
  else content=<path d="M4 12h24" stroke-width="4"/>;
  return <svg viewBox={wideSample?'0 0 96 28':cornerSample?'0 0 40 32':'0 0 32 24'} width={wideSample?96:cornerSample?40:30} height={wideSample?28:cornerSample?32:24} preserveAspectRatio={wideSample?'none':undefined} fill="none" stroke="currentColor" aria-hidden="true" class={`vector-option-icon ${wideSample?'is-wide':''} ${flip?'is-start':''}`}>{content}</svg>;
}
