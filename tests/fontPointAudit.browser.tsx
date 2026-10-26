// Disposable diagnostic artwork. Never reads or rewrites a user's manuscript.
import {render} from 'preact';
import App from '../src/components/App';
import {createEmptyWorkspaceDocument} from '../src/lib/workspaceStartup';
import {STORAGE_KEY,toStoredMangaYaml} from '../src/lib/manga';
import {saveFigureCropAssets} from '../src/lib/figureCropStore';
import type {Bubble} from '../src/types';
import '../src/styles/global.css';
if(location.hostname!=='127.0.0.1'||location.port!=='4325')throw new Error('Dedicated local test origin required.');

async function start(){
  document.getElementById('app')!.textContent='検証用の原画像を準備中…';
  if(new URLSearchParams(location.search).has('resume')){
    document.getElementById('app')!.textContent='';
    render(<App/>,document.getElementById('app')!);
    return;
  }
  const canvas=document.createElement('canvas');canvas.width=canvas.height=300;
  const context=canvas.getContext('2d')!;
  context.fillStyle='white';context.fillRect(0,0,300,300);
  context.fillStyle='black';context.font='24px serif';context.textAlign='center';
  context.fillText('同じ原画',150,155);
  const blob=await new Promise<Blob>(resolve=>canvas.toBlob(result=>resolve(result!),'image/png'));
  const missing=new URLSearchParams(location.search).has('missing');
  const assetId=missing?'font-point-audit-missing':'font-point-audit-original';
  if(!missing)await saveFigureCropAssets([{id:assetId,blob}]);
  const doc=createEmptyWorkspaceDocument();
  doc.manga.meta.title='原画分離と要確認候補の回帰確認';
  doc.manga.meta.episode_id='font-point-audit-disposable';
  doc.manga.finish_settings={width_mm:210,height_mm:297,dpi:600,bleed_mm:0};
  const bubbles:Bubble[]=[17,21,17,21].map((fontSize,index)=>({
    text:['要確認A','前の確定','要確認B','後の確定'][index],shape:'square',tail:false,
    bbox:{x:index%2?115:35,y:index<2?55:160,w:60,h:60},
    text_style:{fontSize,orientation:'horizontal',font:'游明朝'},
    ...(index<2?{analogTextImport:{schemaVersion:1 as const,sourceRegionId:`audit-${index}`,assetId,
      sourceBBox:{x:0,y:0,w:300,h:300},detectionSource:'diagnostic',recognitionEngine:'Baberu OCR' as const,
      needsReview:true,referenceHidden:false,levelAdjusted:true as const}}:{}),
  }));
  bubbles[1].scenarioMatch={sourceIds:[],resolvedSourceIds:['p1-c1-d2'],ocrText:'前の確定',score:1,status:'automatic'};
  bubbles[2].scenarioMatch={sourceIds:[],ocrText:'要確認B',score:.2,status:'review',provisionalText:true};
  bubbles[3].scenarioMatch={sourceIds:[],resolvedSourceIds:['p1-c1-d4'],ocrText:'元の文字',score:.1,status:'manual'};
  doc.manga.scenario={version:1,fileName:'診断用テキストネーム.md',text:'# シナリオ\n## page1\n### コマ1\n話者「候補の本文A」\n話者「前の確定」\n話者「候補の本文B」\n話者「後の確定」\n話者「前景の候補」'};
  doc.manga.pages[0].panels=[{id:1,shape:{type:'rect',x:20,y:35,w:170,h:220},bg:0,action:null,bubbles,
    screen_text:[{text:'左：要確認／右：確定・手動',orientation:'horizontal',bbox:{x:35,y:37,w:120,h:10},text_style:{fontSize:12}}]}];
  doc.manga.pages[0].page_overlay={frame:false,layer:'above_panel_frames',bubbles:[{
    ...structuredClone(bubbles[0]),text:'前景の仮文字',bbox:{x:40,y:260,w:120,h:20},
    analogTextImport:{...bubbles[0].analogTextImport!,sourceRegionId:'audit-overlay'},
  }]};
  localStorage.setItem(STORAGE_KEY,toStoredMangaYaml(doc));
  document.getElementById('app')!.textContent='';
  render(<App/>,document.getElementById('app')!);
}
void start().catch(error=>{document.getElementById('app')!.textContent=`検証準備エラー: ${String(error)}`;});
