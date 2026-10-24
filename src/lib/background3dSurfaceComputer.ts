import type { BackgroundEdge } from './background3dGeometry.ts';
import type { BackgroundSurface, BackgroundSurfaceInput } from './background3dSurface.ts';

export type BackgroundSurfacePatch=Pick<BackgroundSurface,'width'|'height'|'texture'|'radius'|'footprint'>;
export type BackgroundSurfaceResult={surface:BackgroundSurfacePatch;edges:BackgroundEdge[]};
export type BackgroundSurfaceMessage={id:number;rawKey:string;input?:BackgroundSurfaceInput;edges?:BackgroundEdge[];amount:number;lineGap:number;creaseAngle:number};
export type BackgroundSurfaceReply={id:number;result?:BackgroundSurfaceResult;error?:string};
type WorkerPort=Pick<Worker,'postMessage'|'terminate'|'onmessage'|'onerror'|'onmessageerror'>;
const cancelled=()=>new DOMException('3Dの省略設定が変更されました','AbortError');

/** Surface buffers stay outside JSON cache keys. One settled raw field and one
 * grouping are reused by the worker; obsolete work is terminated, not queued. */
export class BackgroundSurfaceComputer {
  private worker:WorkerPort|null=null;
  private workerRawKey='';
  private generation=0;
  private disposed=false;
  private cached:{key:string;result:BackgroundSurfaceResult}|null=null;
  private active:{key:string;id:number;promise:Promise<BackgroundSurfaceResult>;resolve:(result:BackgroundSurfaceResult)=>void;reject:(error:Error)=>void}|null=null;
  private createWorker:()=>Promise<WorkerPort>;
  constructor(createWorker:()=>Promise<WorkerPort>){this.createWorker=createWorker;}
  result(key:string){return this.cached?.key===key?this.cached.result:null;}
  request(key:string,message:Omit<BackgroundSurfaceMessage,'id'>):Promise<BackgroundSurfaceResult>{
    if(this.disposed)return Promise.reject(cancelled());
    if(this.active&&this.active.key!==key)this.cancel();
    if(this.cached?.key===key)return Promise.resolve(this.cached.result);
    if(this.active)return this.active.promise;
    const id=++this.generation;let resolve!:(result:BackgroundSurfaceResult)=>void,reject!:(error:Error)=>void;
    const promise=new Promise<BackgroundSurfaceResult>((yes,no)=>{resolve=yes;reject=no;});this.active={key,id,promise,resolve,reject};
    void(async()=>{
      try{
        if(!this.worker){
          const worker=await this.createWorker();if(this.disposed||this.active?.id!==id){worker.terminate();return;}
          this.worker=worker;
          worker.onmessage=(event:MessageEvent<BackgroundSurfaceReply>)=>{
            const active=this.active,reply=event.data;if(worker!==this.worker||!active||reply.id!==active.id)return;
            this.active=null;
            if(reply.result){this.cached={key:active.key,result:reply.result};active.resolve(reply.result);}
            else{this.worker=null;this.workerRawKey='';worker.terminate();active.reject(new Error(reply.error||'3Dの細部を省略できませんでした'));}
          };
          const failed=()=>{if(worker!==this.worker)return;const active=this.active;this.active=null;this.worker=null;this.workerRawKey='';worker.terminate();active?.reject(new Error('3Dの省略計算が停止しました。設定を変えて再試行してください'));};
          worker.onerror=failed;worker.onmessageerror=failed;
        }
        const {input,edges,...settings}=message;
        this.worker.postMessage({id,...settings,...(this.workerRawKey!==message.rawKey?{input,edges}:{})} satisfies BackgroundSurfaceMessage);
        this.workerRawKey=message.rawKey;
      }catch(error){if(this.active?.id===id){this.active=null;this.worker?.terminate();this.worker=null;this.workerRawKey='';reject(error instanceof Error?error:new Error(String(error)));}}
    })();
    return promise;
  }
  cancel(){this.generation++;this.worker?.terminate();this.worker=null;this.workerRawKey='';const active=this.active;this.active=null;active?.reject(cancelled());}
  dispose(){this.disposed=true;this.cancel();this.cached=null;}
}
