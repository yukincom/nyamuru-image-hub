import type { BackgroundEdgeOptions, GeometryMesh, visibleBackgroundEdges } from './background3dGeometry.ts';

export type BackgroundLineView={viewProjection:number[];cameraPosition:number[];options:BackgroundEdgeOptions;visibleMeshes?:number[]};
export type BackgroundLineResult=ReturnType<typeof visibleBackgroundEdges>;
export type BackgroundLineMessage={id:number;view:BackgroundLineView}|{meshes:GeometryMesh[]};
export type BackgroundLineReply={id:number;result?:BackgroundLineResult;error?:string};
type WorkerPort=Pick<Worker,'postMessage'|'terminate'|'onmessage'|'onerror'|'onmessageerror'>;
const cancelled=()=>new DOMException('3Dの構図が変更されました','AbortError');

/** One active view. Superseded work is stopped, never queued behind an obsolete camera. */
export class BackgroundLineComputer {
  private worker:WorkerPort|null=null;
  private generation=0;
  private disposed=false;
  private cached:{key:string;result:BackgroundLineResult}|null=null;
  private active:{key:string;id:number;promise:Promise<BackgroundLineResult>;resolve:(value:BackgroundLineResult)=>void;reject:(error:Error)=>void}|null=null;
  private meshes:GeometryMesh[];
  private createWorker:()=>Promise<WorkerPort>;
  constructor(meshes:GeometryMesh[],createWorker:()=>Promise<WorkerPort>){this.meshes=meshes;this.createWorker=createWorker;}
  key(view:BackgroundLineView){return JSON.stringify(view);}
  result(view:BackgroundLineView){return this.cached?.key===this.key(view)?this.cached.result:null;}
  request(view:BackgroundLineView):Promise<BackgroundLineResult>{
    if(this.disposed)return Promise.reject(cancelled());
    const key=this.key(view);
    if(this.active&&this.active.key!==key)this.cancel();
    if(this.cached?.key===key)return Promise.resolve(this.cached.result);
    if(this.active?.key===key)return this.active.promise;
    const id=++this.generation;
    let resolve!:(value:BackgroundLineResult)=>void,reject!:(error:Error)=>void;
    const promise=new Promise<BackgroundLineResult>((yes,no)=>{resolve=yes;reject=no;});
    this.active={key,id,promise,resolve,reject};
    void(async()=>{
      try{
        if(!this.worker){
          const worker=await this.createWorker();
          if(this.disposed||this.active?.id!==id){worker.terminate();return;}
          this.worker=worker;
          worker.onmessage=(event:MessageEvent<BackgroundLineReply>)=>{
            const active=this.active,reply=event.data;
            if(worker!==this.worker||!active||reply.id!==active.id)return;
            this.active=null;
            if(reply.result){this.cached={key:active.key,result:reply.result};active.resolve(reply.result);}
            else active.reject(new Error(reply.error||'3Dの線画を計算できませんでした'));
          };
          const failed=()=>{if(worker!==this.worker)return;const active=this.active;this.active=null;this.worker=null;worker.terminate();active?.reject(new Error('3Dの線画計算が停止しました。構図を変えて再試行してください'));};
          worker.onerror=failed;worker.onmessageerror=failed;
          worker.postMessage({meshes:this.meshes} satisfies BackgroundLineMessage);
        }
        this.worker.postMessage({id,view} satisfies BackgroundLineMessage);
      }catch(error){if(this.active?.id===id){this.active=null;this.worker?.terminate();this.worker=null;reject(error instanceof Error?error:new Error(String(error)));}}
    })();
    return promise;
  }
  cancel(){
    this.generation++;this.worker?.terminate();this.worker=null;
    const active=this.active;this.active=null;active?.reject(cancelled());
  }
  dispose(){this.disposed=true;this.cancel();this.cached=null;this.meshes=[];}
}
