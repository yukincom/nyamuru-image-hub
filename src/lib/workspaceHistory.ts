import { normalizeHistorySteps } from './historyPreferences.ts';

/** One in-memory timeline. Snapshots retain immutable scenes and their pending Blobs. */
export function workspaceHistory<T>(steps=50) {
  let limit=normalizeHistorySteps(steps),past:T[]=[],future:T[]=[];
  return {
    get past(){return past;},get future(){return future;},
    record(before:T){past=[...past,before].slice(-limit);future=[];},
    undo(current:T):T|undefined {if(!past.length)return;const target=past.at(-1)!;past=past.slice(0,-1);future=[...future,current];return target;},
    redo(current:T):T|undefined {if(!future.length)return;const target=future.at(-1)!;future=future.slice(0,-1);past=[...past,current].slice(-limit);return target;},
    resize(steps:number){limit=normalizeHistorySteps(steps);past=past.slice(-limit);future=future.slice(-Math.max(0,limit-past.length));if(past.length===limit)future=[];},
    map(update:(value:T)=>T){past=past.map(update);future=future.map(update);},
    clear(){past=[];future=[];},
  };
}
