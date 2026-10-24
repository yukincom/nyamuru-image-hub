import {groupBackgroundSurface,surfaceBackgroundEdges,type BackgroundSurface,type BackgroundSurfaceInput} from './background3dSurface.ts';
import type {BackgroundEdge} from './background3dGeometry.ts';
import type {BackgroundSurfaceMessage,BackgroundSurfaceReply} from './background3dSurfaceComputer.ts';

let rawKey='',input:BackgroundSurfaceInput|undefined,edges:BackgroundEdge[]=[];
let grouped:{amount:number;surface:BackgroundSurface}|undefined;
self.onmessage=(event:MessageEvent<BackgroundSurfaceMessage>)=>{
  const message=event.data,{id}=message;
  try{
    if(message.rawKey!==rawKey){if(!message.input||!message.edges)throw new Error('3Dの面情報を読み直してください');rawKey=message.rawKey;input=message.input;edges=message.edges;grouped=undefined;}
    if(!input)throw new Error('3Dの面情報がありません');
    if(!grouped||grouped.amount!==message.amount)grouped={amount:message.amount,surface:groupBackgroundSurface(input,edges,message.amount)};
    const surface=grouped.surface,texture=new Float32Array(surface.texture);
    const result={edges:surfaceBackgroundEdges(edges,surface,message.lineGap,message.creaseAngle),surface:{width:surface.width,height:surface.height,texture,radius:surface.radius,footprint:surface.footprint}};
    self.postMessage({id,result} satisfies BackgroundSurfaceReply,{transfer:[texture.buffer]});
  }catch(error){self.postMessage({id,error:error instanceof Error?error.message:String(error)} satisfies BackgroundSurfaceReply);}
};
