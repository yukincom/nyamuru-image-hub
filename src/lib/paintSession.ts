import type { PaintLayerDropTarget, PaintOwner, PaintScene } from './paintDocument.ts';
import type { BackgroundStage, BBox, ImageAsset, PaintFolder, PaintLayer } from '../types.ts';
export interface PaintImagePlacement { frame: BBox; referenceFrame: BBox }

export type PaintLayerAction =
  | {type:'background3d';key:'background'}
  | {type:'add';key:string;kind:'raster'|'vector'}
  | {type:'add-folder';key:string}
  | {type:'rename-folder';key:string;id:string;name:string}
  | {type:'remove-folder';key:string;id:string}
  | {type:'update-folder';key:string;id:string;patch:Partial<Pick<PaintFolder,'visible'|'locked'>>}
  | {type:'move-folder';key:string;id:string;target:PaintLayerDropTarget}
  | {type:'move-layer';key:string;id:string;target:PaintLayerDropTarget}
  | {type:'select';key:string;id?:string;contents?:boolean;mask?:'mask'|'generationMask'}
  | {type:'menu';key:string;x:number;y:number}
  | {type:'update';key:string;id:string;patch:Partial<PaintLayer>}
  | {type:'owner-lock';key:string;locked:boolean;group?:boolean}
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
  pause: () => Promise<void>;
  layerAction: (action:PaintLayerAction) => void;
  flush: () => Promise<void>;
  close: () => Promise<void>;
  generate: (key?:string) => Promise<void>;
  chooseImage: (key?:string) => void;
  insertImage: (file:File,key:string,placement?:PaintImagePlacement) => Promise<void>;
}

/** Compare immutable owners; actual edits advance only after their writer succeeds. */
export function paintCheckpoint(initial: PaintScene, savedScene=initial) {
  let saved = savedScene;
  let pending = Promise.resolve();
  const changedOwner = (owner:PaintOwner) => owner !== saved.owners.find(item => item.key === owner.key);
  return {
    get saved() { return saved; },
    /** A fresh guide image is an equivalent display representation, not a saved edit.
     * Never use this for repairing a persisted image or acknowledging a dirty owner. */
    prepareGuide(before:PaintOwner, prepared:PaintOwner) {
      if(before===prepared||!saved.owners.includes(before))return;
      saved={...saved,owners:saved.owners.map(owner=>owner===before?prepared:owner)};
    },
    hasChanges(scene:PaintScene) { return scene!==saved&&scene.owners.some(changedOwner); },
    flush(scene: PaintScene, write: (owners: PaintOwner[]) => Promise<void>): Promise<void> {
      const task = pending.then(async () => {
        if (scene === saved) return;
        const owners = scene.owners.filter(changedOwner);
        if (!owners.length) return;
        await write(owners);
        saved = scene;
      });
      pending = task.catch(() => {});
      return task;
    },
  };
}
