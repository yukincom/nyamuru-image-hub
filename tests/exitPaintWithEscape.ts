/** Use the editor's keyboard exit from an idle paint session; a failed flush must not count as an exit. */
export async function exitPaintWithEscape(){
  if(!document.querySelector('.app-shell.is-painting'))throw Error('描画終了を試す前に描画モードが必要です');
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true}));
  for(let i=0;i<300;i++){
    if(!document.querySelector('.app-shell.is-painting'))return;
    await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
  }
  throw Error('Escで描画を確定して配置へ戻れませんでした');
}
