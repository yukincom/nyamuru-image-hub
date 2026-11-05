import { type Dispatch, type StateUpdater, useEffect } from 'preact/hooks';
import { type QwenReference, type QwenGenerationPlan, type QwenLayerReference, type QwenLayerCandidate, qwenGenerationPrompt } from '../../lib/qwenGeneration.ts';
import type { Cell } from './createGenerationActions.ts';
import type { BBox } from '../../types.ts';
import { withNewCreationBridgeSession } from '../../lib/localBridgeLifecycle.ts';
import { loadCharacterReferenceImage } from '../../lib/localBridge.ts';
import { qwenInputImage } from './inputImages.ts';
import { loadFigureCropAsset } from '../../lib/figureCropStore.ts';

interface UseGenerationReferencesInputs {
  setLinked: Dispatch<StateUpdater<QwenReference[]>>;
  setCharacterLoading: Dispatch<StateUpdater<boolean>>;
  sourcePlan: QwenGenerationPlan;
  setSourceErrors: Dispatch<StateUpdater<{ expression: string; character: string; }>>;
  threeImages: boolean;
  characterRetry: number;
  setSketchLoading: Dispatch<StateUpdater<boolean>>;
  setReference: Dispatch<StateUpdater<QwenLayerReference | undefined>>;
  expressionRetry: number;
  operation: <T>(task: () => Promise<T>, propagate?: boolean) => Promise<T | undefined>;
  attempted: Cell<string | null>;
  draft: Cell<{ prompt: string; references: QwenReference[]; reference: QwenLayerReference | undefined; correction: QwenLayerReference | undefined; }>;
  referenceLimit: number;
  usesPoseImage: boolean;
  alive: Cell<boolean>;
  setExtra: Dispatch<StateUpdater<QwenReference[]>>;
  layers: QwenLayerCandidate[];
  loadLayer: ((id: string, correction: boolean, crop?: BBox, native?: boolean) => Promise<string>) | undefined;
  reference: QwenLayerReference | undefined;
  correction: QwenLayerReference | undefined;
  plan: QwenGenerationPlan;
  prompt: string;
  setPrompt: Dispatch<StateUpdater<string | undefined>>;
  setCorrection: Dispatch<StateUpdater<QwenLayerReference | undefined>>;
}

export function useGenerationReferences({ setLinked, setCharacterLoading, sourcePlan, setSourceErrors, threeImages, characterRetry, setSketchLoading, setReference, expressionRetry, operation, attempted, draft, referenceLimit, usesPoseImage, alive, setExtra, layers, loadLayer, reference, correction, plan, prompt, setPrompt, setCorrection }: UseGenerationReferencesInputs) {
  useEffect(()=>{
    let current=true;
    setLinked([]);setCharacterLoading(Boolean(sourcePlan.characterKeys.length));
    setSourceErrors(old=>({...old,character:''}));
    if(!sourcePlan.characterKeys.length)return;
    void withNewCreationBridgeSession(async()=>Promise.all(sourcePlan.characterKeys.map(async key=>{
      const candidate=sourcePlan.candidates.find(item=>item.characterKeys?.includes(key) || !item.characterKeys&&sourcePlan.characterKeys.length===1);
      if(!candidate)throw new Error('この人物に紐づくキャラクター設定画がありません');
      const blob=await loadCharacterReferenceImage(candidate.seriesId,candidate.characterCatalogId,candidate.source.asset_id);
      if(!blob)throw new Error(`${candidate.label}の設定画が見つかりません`);
      return {label:candidate.label,characterKeys:[key],image:(await qwenInputImage(blob,undefined,threeImages)).image};
    }))).then(result=>{if(current)setLinked(result);}).catch(cause=>{if(current)setSourceErrors(old=>({...old,character:String(cause.message??cause)}));})
      .finally(()=>{if(current)setCharacterLoading(false);});
    return()=>{current=false;};
  },[sourcePlan,characterRetry,threeImages]);
  useEffect(()=>{
    let current=true;
    const source=sourcePlan.expressionSource;
    setSourceErrors(old=>({...old,expression:''}));setSketchLoading(false);
    if(!threeImages||!source)return;
    setSketchLoading(true);setReference(undefined);
    void withNewCreationBridgeSession(async()=>{
      const blob=await loadFigureCropAsset(source.assetId,source.persistentAsset);
      if(!blob)throw new Error('この人物のネーム原画が見つかりません');
      return (await qwenInputImage(blob,undefined,true)).image;
    }).then(image=>{if(current)setReference({id:source.assetId,label:'ネームの表情',image,kind:'sketch',hidden:false,empty:false});})
      .catch(cause=>{if(current)setSourceErrors(old=>({...old,expression:String(cause.message??cause)}));})
      .finally(()=>{if(current)setSketchLoading(false);});
    return()=>{current=false;};
  },[sourcePlan,threeImages,expressionRetry]);
  async function addFiles(files:File[]){await operation(async()=>{
    if(attempted.current)throw new Error('生成を開始した資料は変更できません');
    if(draft.current.references.length+files.length>referenceLimit)throw new Error(`参照資料は最大${referenceLimit}枚です${usesPoseImage?'（3Dポーズ画像を別に1枚送ります）':''}`);
    const loaded:QwenReference[]=[];
    for(const file of files)loaded.push({label:file.name,characterKeys:[],image:(await qwenInputImage(file)).image});
    if(alive.current)setExtra(previous=>[...previous,...loaded]);
  });}
  async function selectLayer(slot:'reference'|'correction',id:string){await operation(async()=>{
    const candidate=id?layers.find(layer=>layer.id===id):undefined;
    if(id&&(!candidate||candidate.empty||!loadLayer))throw new Error('参照できるレイヤーを選んでください');
    const referenceCandidate=slot==='reference'?candidate:reference,correctionCandidate=slot==='correction'?candidate:correction;
    const crop=Boolean(plan.contentKind)&&!correctionCandidate?plan.generationArea:undefined;
    const nextReference=referenceCandidate?{...referenceCandidate,image:await loadLayer!(referenceCandidate.id,false,crop,threeImages)}:undefined;
    const nextCorrection=correctionCandidate?{...correctionCandidate,image:await loadLayer!(correctionCandidate.id,true)}:undefined;
    if(!alive.current)return;
    const nextPrompt=!threeImages&&draft.current.prompt===qwenGenerationPrompt(plan,reference,correction)
      ? qwenGenerationPrompt(plan,nextReference,nextCorrection):draft.current.prompt;
    draft.current={...draft.current,prompt:nextPrompt,reference:nextReference,correction:nextCorrection};
    if(nextPrompt!==prompt)setPrompt(nextPrompt);setReference(nextReference);setCorrection(nextCorrection);
  });}
  return { selectLayer, addFiles };
}
