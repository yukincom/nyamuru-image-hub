import type { WorkspaceState } from './useWorkspaceState';
import type { MangaDocument } from '../../types';
import {
  type ImageExportFormat, pageExportPixels, pageExportStem, clipExportSources, flattenedPsd,
  chooseImageExportDirectory, pageExportIndices, canChooseImageExportDirectory, uncompressedZip,
  safeExportName, saveImageExport,
} from '../../lib/pageExport';
import { getPrintSetup } from '../../lib/printSettings';
import { requestClipExport } from '../../lib/localBridge';
import { captureQwenCompositionCanvas } from '../../lib/pageComposition';
import { paintColorMode } from '../../lib/paintColor';

interface Context {
  endTextEdit: () => void;
}

export function createImageExportActions({
  activePanelRef, activePageRef, setImageExportError, setImageExportProgress, setImageExportDialog,
  imageExportBusy, setImageExportBusy, imageExportDirectory, setImageExportDirectory, imageExportDialog,
  documentRef, setToast,
}: WorkspaceState, {
  endTextEdit,
}: Context) {
  const pageExportBlob = async(current:MangaDocument,pageIndex:number,format:ImageExportFormat) => {
    const page=current.manga.pages[pageIndex];
    if(!page)throw new Error('書き出すページが見つかりません');
    const setup=getPrintSetup(current.manga),size=pageExportPixels(setup.width_mm,setup.height_mm,setup.dpi),guides:Record<string,boolean>={};
    const name=pageExportStem(current.manga.meta.title||'manga',page.page,setup);
    if(format==='clip'){
      const {buildClipExportPage}=await import('../../lib/clipExport');
      const {payload,entries}=clipExportSources(await buildClipExportPage(current.manga,pageIndex),name);
      const blob=await requestClipExport(payload);
      return {blob,name:`${name}.clip`,page:page.page,sources:entries};
    }
    page.panels.forEach((panel,index)=>['background',...(panel.figures??[]).map((_,i)=>`figure-${i}`),...panel.bubbles.map((_,i)=>`bubble-${i}`)].forEach(key=>{guides[`${index}:${key}`]=false;}));
    const overlay=page.page_overlay;[...(overlay?.figures??[]).map((_,i)=>`figure-${i}`),...(overlay?.bubbles??[]).map((_,i)=>`bubble-${i}`)].forEach(key=>{guides[`overlay:${key}`]=false;});
    const canvas=await captureQwenCompositionCanvas(current.manga,pageIndex,Math.min(activePanelRef.current,Math.max(0,page.panels.length-1)),'page',guides,{...size,includeGenerated:true});
    try{
      let blob:Blob;
      if(format==='psd'){
        const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw new Error('ページ画像を読み出せませんでした');
        blob=flattenedPsd(context.getImageData(0,0,canvas.width,canvas.height),setup.dpi,paintColorMode(setup.format));
      }else blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('PNGを書き出せませんでした')),'image/png'));
      return {blob,name:`${name}.${format}`,page:page.page,sources:[] as Array<{name:string;bytes:Uint8Array}>};
    }finally{canvas.width=canvas.height=1;}
  };
  const openImageExportDialog=()=>{
    endTextEdit();
    const page=activePageRef.current+1;
    setImageExportError('');
    setImageExportProgress(null);
    setImageExportDialog({mode:'current',from:page,to:page,format:'png'});
  };
  const chooseImageExportFolder=async()=>{
    if(imageExportBusy)return;
    setImageExportBusy(true);setImageExportError('');
    try{const directory=await chooseImageExportDirectory(imageExportDirectory);if(directory)setImageExportDirectory(directory);}
    catch(error){setImageExportError(error instanceof Error?error.message:'保存先を選べませんでした');}
    finally{setImageExportBusy(false);}
  };
  const exportPageRange=async()=>{
    const choice=imageExportDialog;if(!choice||imageExportBusy)return;
    endTextEdit();
    const current=documentRef.current;
    try{
      setImageExportBusy(true);setImageExportError('');
      const indices=pageExportIndices(current.manga.pages.length,{...choice,current:activePageRef.current+1}),files:Array<{name:string;bytes:Uint8Array;blob:Blob;page:number;sources:Array<{name:string;bytes:Uint8Array}>}>=[];
      let directory=imageExportDirectory;
      if(!directory&&canChooseImageExportDirectory()){
        directory=await chooseImageExportDirectory();
        if(!directory)return;
        setImageExportDirectory(directory);
      }
      if(directory?.requestPermission&&await directory.requestPermission({mode:'readwrite'})!=='granted')throw new Error('保存先への書き込みが許可されませんでした。保存先を選び直してください');
      // Yield after real work milestones so the bar paints before the next canvas/ZIP operation.
      const progress=async(value:number,label:string)=>{
        setImageExportProgress({value,max:indices.length+2,label});
        await new Promise(resolve=>setTimeout(resolve,20));
      };
      for(let position=0;position<indices.length;position++){
        await progress(position,`ページを書き出し中 ${position+1} / ${indices.length}`);
        if(documentRef.current!==current)throw new Error('作品が変更されました。ページ範囲を選び直してください');
        const result=await pageExportBlob(current,indices[position],choice.format);
        files.push({...result,bytes:new Uint8Array(await result.blob.arrayBuffer())});
      }
      await progress(indices.length,files.length>1?'ZIPにまとめています':'保存の準備中');
      if(documentRef.current!==current)throw new Error('作品が変更されました。ページ範囲を選び直してください');
      const first=String(files[0].page).padStart(3,'0'),last=String(files.at(-1)!.page).padStart(3,'0');
      const zip=files.length>1||files.some(file=>file.sources.length);
      const blob=zip?uncompressedZip(files.flatMap(({name,bytes,sources})=>[{name,bytes},...sources])):files[0].blob;
      const name=zip?`${safeExportName(current.manga.meta.title||'manga').slice(0,50)}-pages-${first}-${last}-${choice.format}.zip`:files[0].name;
      await progress(indices.length+1,directory?'保存しています':'ダウンロードを準備中');
      await saveImageExport(blob,name,directory);
      await progress(indices.length+2,directory?'保存しました':'ダウンロードを開始しました');
      setImageExportDialog(null);
      setToast(directory?`${directory.name} に書き出しました`:'ダウンロードを開始しました');
    }catch(error){setImageExportError(error instanceof Error?error.message:'画像を書き出せませんでした');}
    finally{setImageExportBusy(false);setImageExportProgress(null);}
  };

  return { openImageExportDialog, chooseImageExportFolder, exportPageRange };
}
