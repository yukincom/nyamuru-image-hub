import { pruneFigureCropAssets, saveFigureCropAssets, type FigureCropAsset } from './figureCropStore.ts';

const OWNER='nyamuru.paint-assets.owner.';
const WRITES='nyamuru.paint-assets.writes';
/** Browser-held locks end on tab close/crash. Other live tabs' generated assets
 * remain protected; dead sessions can be collected without a persistent history. */
export function paintAssetLease(locks:LockManager|undefined=globalThis.navigator?.locks){
  const owner=crypto.randomUUID();
  let release=()=>{},active=false,disposed=false;
  const ready=locks?new Promise<void>(resolve=>{
    void locks.request(OWNER+owner,async()=>{
      if(disposed){resolve();return;}
      active=true;resolve();await new Promise<void>(done=>{release=done;});active=false;
    }).catch(()=>resolve());
  }):Promise.resolve();
  const exclusive=<T>(action:()=>Promise<T>):Promise<T>=>locks?locks.request(WRITES,action):action();
  return {
    ready,
    storageId:()=>`${active?'paint-'+owner:'original-paint'}-${crypto.randomUUID()}`,
    async save(assets:readonly FigureCropAsset[]){await ready;await exclusive(()=>saveFigureCropAssets(assets));},
    async prune(references:()=>readonly string[]|null){
      await ready;
      return exclusive(async()=>{
        // A second tab can also read our originals after duplicating a tab. Defer
        // paint collection until only this editor remains. Without Web Locks, preserve generated originals rather than risk another tab's work.
        const live=locks?new Set((await locks.query()).held?.map(lock=>lock.name).filter(name=>name?.startsWith(OWNER))):null;
        const anotherReader=live&&[...live].some(name=>name!==OWNER+owner);
        return pruneFigureCropAssets([],references,id=>{
          const match=/^paint-([0-9a-f-]{36})-/.exec(id);
          return !!live&&!anotherReader&&!!match&&(match[1]===owner||!live.has(OWNER+match[1]));
        });
      });
    },
    dispose(){disposed=true;release();},
  };
}
