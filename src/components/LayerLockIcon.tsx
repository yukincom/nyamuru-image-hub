export default function LayerLockIcon({size=18,locked=true}:{size?:number;locked?:boolean}){
  if(!locked)return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" data-layer-lock-icon="open" fill="none" stroke="#000" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
    <path d="M7 10.625V7a5 5 0 0 1 10.4-2.8"/>
    <rect x="3.625" y="10.625" width="16.75" height="11.75" rx="1.375" fill="#fff"/>
    <circle cx="12" cy="16" r="1.15" fill="#000" stroke="none"/>
  </svg>;
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" data-layer-lock-icon="closed" fill="#000"><path fill-rule="evenodd" d="M6 10V7a6 6 0 0 1 12 0v3h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h1Zm3 0h6V7a3 3 0 0 0-6 0v3Z"/></svg>;
}
