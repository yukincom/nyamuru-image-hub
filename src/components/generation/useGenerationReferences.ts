import { type Dispatch, type StateUpdater, useEffect, useRef } from 'preact/hooks';
import { type QwenReference, type QwenGenerationPlan, type QwenLayerReference, type QwenLayerCandidate, formatGenerationPrompt } from '../../lib/qwenGeneration.ts';
import type { Cell } from './createGenerationActions.ts';
import type { BBox } from '../../types.ts';
import { withNewCreationBridgeSession } from '../../lib/localBridgeLifecycle.ts';
import { loadCharacterReferenceImage } from '../../lib/localBridge.ts';
import { encodeGenerationInputImage } from './inputImages.ts';
import { loadFigureCropAsset } from '../../lib/figureCropStore.ts';

export function defaultAtariLayer(layers: readonly QwenLayerCandidate[]): QwenLayerCandidate | undefined {
  return layers.find(layer => !layer.empty && (layer.label === 'キャラクターあたり' || layer.kind === 'sketch'))
    ?? layers.find(layer => !layer.empty && layer.label === 'あたり · 背景');
}

interface UseGenerationReferencesInputs {
  setLinked: Dispatch<StateUpdater<QwenReference[]>>;
  setCharacterLoading: Dispatch<StateUpdater<boolean>>;
  sourcePlan: QwenGenerationPlan;
  setSourceErrors: Dispatch<StateUpdater<{ expression: string; character: string; }>>;
  threeImages: boolean;
  twoImagesPromptless?: boolean;
  cloudApi?: boolean;
  waitingForWorkflow?: boolean;
  selectedCharacterAssetId?: string;
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

export function useGenerationReferences({ setLinked, setCharacterLoading, sourcePlan, setSourceErrors, threeImages, twoImagesPromptless = false, cloudApi = false, waitingForWorkflow = false, selectedCharacterAssetId, characterRetry, setSketchLoading, setReference, expressionRetry, operation, attempted, draft, referenceLimit, usesPoseImage, alive, setExtra, layers, loadLayer, reference, correction, plan, prompt, setPrompt, setCorrection }: UseGenerationReferencesInputs) {
  const autoSelectedPlan = useRef<QwenGenerationPlan | null>(null);
  useEffect(()=>{
    let current=true;
    setLinked([]);setCharacterLoading(Boolean(sourcePlan.characterKeys.length));
    setSourceErrors(old=>({...old,character:''}));
    if(!sourcePlan.characterKeys.length)return;
    const native = threeImages || twoImagesPromptless || cloudApi;
    void withNewCreationBridgeSession(async()=>{
      if((twoImagesPromptless || cloudApi)&&sourcePlan.candidates.length){
        const chosen=(selectedCharacterAssetId&&sourcePlan.candidates.find(item=>item.source.asset_id===selectedCharacterAssetId))||sourcePlan.candidates[0];
        const blob=await loadCharacterReferenceImage(chosen.seriesId,chosen.characterCatalogId,chosen.source.asset_id);
        if(!blob)throw new Error(`${chosen.label}の設定画が見つかりません`);
        return [{label:chosen.label,characterKeys:chosen.characterKeys??[sourcePlan.characterKeys[0]],image:(await encodeGenerationInputImage(blob,undefined,true)).image}];
      }
      return Promise.all(sourcePlan.characterKeys.map(async key=>{
        const candidate=sourcePlan.candidates.find(item=>item.characterKeys?.includes(key) || !item.characterKeys&&sourcePlan.characterKeys.length===1);
        if(!candidate)throw new Error('この人物に紐づくキャラクター設定画がありません');
        const blob=await loadCharacterReferenceImage(candidate.seriesId,candidate.characterCatalogId,candidate.source.asset_id);
        if(!blob)throw new Error(`${candidate.label}の設定画が見つかりません`);
        return {label:candidate.label,characterKeys:[key],image:(await encodeGenerationInputImage(blob,undefined,native)).image};
      }));
    }).then(result=>{if(current)setLinked(result);}).catch(cause=>{if(current)setSourceErrors(old=>({...old,character:String(cause.message??cause)}));})
      .finally(()=>{if(current)setCharacterLoading(false);});
    return()=>{current=false;};
  },[sourcePlan,characterRetry,threeImages,twoImagesPromptless,cloudApi,selectedCharacterAssetId]);
  useEffect(()=>{
    if(threeImages||waitingForWorkflow||sourcePlan.scope||!loadLayer)return;
    if(autoSelectedPlan.current===sourcePlan)return;
    autoSelectedPlan.current=sourcePlan;
    const initial=defaultAtariLayer(layers);
    if(!initial)return;
    let current=true;
    const crop=Boolean(sourcePlan.contentKind)?sourcePlan.generationArea:undefined;
    void loadLayer(initial.id,false,crop,twoImagesPromptless||cloudApi).then(image=>{
      if(!current||!alive.current||draft.current.reference)return;
      const nextReference:QwenLayerReference={...initial,image};
      const previousPrompt=draft.current.prompt;
      const nextPrompt=previousPrompt===formatGenerationPrompt(plan,undefined,draft.current.correction)
        ? formatGenerationPrompt(plan,nextReference,draft.current.correction):previousPrompt;
      draft.current={...draft.current,prompt:nextPrompt,reference:nextReference};
      if(nextPrompt!==previousPrompt)setPrompt(nextPrompt);
      setReference(nextReference);
    }).catch(()=>{/* 初期あたリ読込失敗時は手動選択に委ねる */});
    return()=>{current=false;};
  },[sourcePlan,threeImages,waitingForWorkflow,twoImagesPromptless,cloudApi,layers,loadLayer]);
  useEffect(()=>{
    let current=true;
    const source=sourcePlan.expressionSource;
    setSourceErrors(old=>({...old,expression:''}));setSketchLoading(false);
    if(!threeImages||!source)return;
    setSketchLoading(true);setReference(undefined);
    void withNewCreationBridgeSession(async()=>{
      const blob=await loadFigureCropAsset(source.assetId,source.persistentAsset);
      if(!blob)throw new Error('この人物のネーム原画が見つかりません');
      return (await encodeGenerationInputImage(blob,undefined,true)).image;
    }).then(image=>{if(current)setReference({id:source.assetId,label:'ネームの表情',image,kind:'sketch',hidden:false,empty:false});})
      .catch(cause=>{if(current)setSourceErrors(old=>({...old,expression:String(cause.message??cause)}));})
      .finally(()=>{if(current)setSketchLoading(false);});
    return()=>{current=false;};
  },[sourcePlan,threeImages,expressionRetry]);
  async function addFiles(files:File[]){await operation(async()=>{
    if(attempted.current)throw new Error('生成を開始した資料は変更できません');
    if(draft.current.references.length+files.length>referenceLimit)throw new Error(`参照資料は最大${referenceLimit}枚です${usesPoseImage?'（3Dポーズ画像を別に1枚送ります）':''}`);
    const loaded:QwenReference[]=[];
    for(const file of files)loaded.push({label:file.name,characterKeys:[],image:(await encodeGenerationInputImage(file,undefined,twoImagesPromptless||cloudApi)).image});
    if(alive.current)setExtra(previous=>[...previous,...loaded]);
  });}
  async function selectLayer(slot:'reference'|'correction',id:string){await operation(async()=>{
    const candidate=id?layers.find(layer=>layer.id===id):undefined;
    if(id&&(!candidate||candidate.empty||!loadLayer))throw new Error('参照できるレイヤーを選んでください');
    const referenceCandidate=slot==='reference'?candidate:reference,correctionCandidate=slot==='correction'?candidate:correction;
    const crop=Boolean(plan.contentKind)&&!correctionCandidate?plan.generationArea:undefined;
    const nextReference=referenceCandidate?{...referenceCandidate,image:await loadLayer!(referenceCandidate.id,false,crop,threeImages||twoImagesPromptless||cloudApi)}:undefined;
    const nextCorrection=correctionCandidate?{...correctionCandidate,image:await loadLayer!(correctionCandidate.id,true)}:undefined;
    if(!alive.current)return;
    const nextPrompt=!threeImages&&draft.current.prompt===formatGenerationPrompt(plan,reference,correction)
      ? formatGenerationPrompt(plan,nextReference,nextCorrection):draft.current.prompt;
    draft.current={...draft.current,prompt:nextPrompt,reference:nextReference,correction:nextCorrection};
    if(nextPrompt!==prompt)setPrompt(nextPrompt);setReference(nextReference);setCorrection(nextCorrection);
  });}
  return { selectLayer, addFiles };
}
