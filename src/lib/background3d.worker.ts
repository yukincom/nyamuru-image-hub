import { visibleBackgroundEdges, type GeometryMesh } from './background3dGeometry.ts';
import type { BackgroundLineMessage, BackgroundLineReply } from './background3dLines.ts';

let meshes:GeometryMesh[]=[];
self.onmessage=(event:MessageEvent<BackgroundLineMessage>)=>{
  const message=event.data;
  if('meshes' in message){meshes=message.meshes;return;}
  const {id,view}=message;
  try{self.postMessage({id,result:visibleBackgroundEdges(view.visibleMeshes?view.visibleMeshes.map(i=>meshes[i]):meshes,view.viewProjection,view.cameraPosition,view.options)} satisfies BackgroundLineReply);}
  catch(error){self.postMessage({id,error:error instanceof Error?error.message:String(error)} satisfies BackgroundLineReply);}
};
