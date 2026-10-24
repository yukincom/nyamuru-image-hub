import type { PaintOwner, PaintScene } from './paintDocument.ts';
import type { BackgroundStage, ImageAsset, PaintLayer } from '../types.ts';

export type PaintLayerAction =
  | {type:'background3d';key:'background'}
  | {type:'select';key:string;id?:string;contents?:boolean;mask?:'mask'|'generationMask'}
  | {type:'menu';key:string;x:number;y:number}
  | {type:'update';key:string;id:string;patch:Partial<PaintLayer>}
  | {type:'toggle';key:string}
  | {type:'guide';key:string}
  | {type:'reorder';key:string;id:string;target:string;after:boolean};

export interface PaintSessionSnapshot {
  scene:PaintScene;
  saved:PaintScene;
  imports:Array<{asset:ImageAsset;blob:Blob}>;
  stageImports:Array<{stage:BackgroundStage;blob:Blob}>;
  ownerKey:string;
  layerId:string;
}
export interface SharedPaintHistory {
  checkpoint:(before:PaintSessionSnapshot)=>void;
  undo:()=>void;redo:()=>void;canUndo:boolean;canRedo:boolean;
}

export interface PaintController {
  selectTool?: (tool:'pen'|'vector-pen') => void;
  interactionRevision?: () => number;
  snapshot: () => PaintSessionSnapshot;
  canRestore: () => boolean;
  layerAction: (action:PaintLayerAction) => void;
  flush: () => Promise<void>;
  close: () => Promise<void>;
  generate: (key?:string) => Promise<void>;
  chooseImage: (key?:string) => void;
  insertImage: (file:File,key:string) => Promise<void>;
}

/** Advance only after all PNGs and their source assets have reached the document. */
export function paintCheckpoint(initial: PaintScene, savedScene=initial) {
  let saved = savedScene;
  let pending = Promise.resolve();
  return {
    get saved() { return saved; },
    flush(scene: PaintScene, write: (owners: PaintOwner[]) => Promise<void>): Promise<void> {
      const task = pending.then(async () => {
        if (scene === saved) return;
        const owners = scene.owners.filter(owner => owner !== saved.owners.find(item => item.key === owner.key));
        await write(owners);
        saved = scene;
      });
      pending = task.catch(() => {});
      return task;
    },
  };
}
