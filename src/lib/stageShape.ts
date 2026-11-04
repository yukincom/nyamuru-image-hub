import type { GeometryMesh, BackgroundEdge } from './background3dGeometry.ts';
import { Box3, type Object3D, Mesh, BoxGeometry, TextureLoader, Texture, Matrix4, Vector3, type Material, PerspectiveCamera } from 'three';
import type { BackgroundStage, BackgroundCapture, VectorPath } from '../types.ts';
import { loadEmbeddedGlb, embeddedSceneManager, disposeThreeObject as disposeObject } from './threeSceneResources.ts';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { defaultVectorStyle } from './vectorGeometry.ts';

export interface StageShape { meshes:GeometryMesh[]; bounds:Box3; groups?:number[][]; meshNames?:string[]; groupNames?:string[];windowMeshes?:number[] }

/** Preserve the original file separately; LT uses a static, opaque geometry snapshot. */
export async function loadStageShape(stage?:BackgroundStage,blob?:Blob):Promise<StageShape> {
  let root:Object3D;
  if(!stage){root=new Mesh(new BoxGeometry(2,2,2));}
  else {
    if(!blob)throw new Error('舞台の原本を読み込めませんでした');
    if(stage.format==='glb'){
      root=(await loadEmbeddedGlb(await blob.arrayBuffer())).scene;
    }else{
      const manager=embeddedSceneManager();
      const textureLoader=new TextureLoader(manager);
      textureLoader.load=(url,onLoad)=>{if(url.startsWith('blob:'))URL.revokeObjectURL(url);const texture=new Texture<HTMLImageElement>();queueMicrotask(()=>onLoad?.(texture));return texture;};
      manager.addHandler(/.*/,textureLoader);
      root=new FBXLoader(manager).parse(await blob.arrayBuffer(),'');
    }
  }
  try{
    root.updateMatrixWorld(true);
    const meshes:GeometryMesh[]=[],meshNames:string[]=[],windowMeshes:number[]=[],bounds=new Box3(),groups=new Map<Object3D,number[]>();
    root.traverseVisible(object=>{
      const mesh=object as Mesh & {isInstancedMesh?:boolean;count?:number;getMatrixAt?:(i:number,m:Matrix4)=>void;skeleton?:{update:()=>void}};
      if(!mesh.isMesh||!mesh.geometry?.getAttribute('position'))return;
      mesh.skeleton?.update();
      const geometry=mesh.geometry,index=geometry.getIndex(),count=index?.count??geometry.getAttribute('position').count;
      const start=Math.max(0,geometry.drawRange.start),end=Math.min(count,start+geometry.drawRange.count);
      for(let instance=0;instance<(mesh.isInstancedMesh?mesh.count??0:1);instance++){
        const transform=mesh.matrixWorld.clone();if(mesh.isInstancedMesh){const local=new Matrix4();mesh.getMatrixAt!(instance,local);transform.multiply(local);}
        const positions:number[]=[],indices:number[]=[],lookup=new Map<number,number>();
        for(let i=start;i+2<end;i+=3)for(let k=0;k<3;k++){
          const source=index?index.getX(i+k):i+k;let target=lookup.get(source);
          if(target===undefined){const point=mesh.getVertexPosition(source,new Vector3()).applyMatrix4(transform);if(!point.toArray().every(Number.isFinite))throw new Error('3Dモデルに不正な座標があります');target=positions.length/3;positions.push(point.x,point.y,point.z);lookup.set(source,target);bounds.expandByPoint(point);}
          indices.push(target);
        }
        if(indices.length){
          const id=meshes.length;meshes.push({positions,indices});meshNames.push(mesh.name);
          const names:string[]=[];for(let ancestor:Object3D|null=mesh;ancestor;ancestor=ancestor.parent)names.push(ancestor.name);
          const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
          const glass=materials.length>0&&materials.every(material=>{const optical=material as Material&{transmission?:number};return (optical.transmission??0)>.2||optical.opacity<.5;});
          if(glass&&names.some(name=>/(?:^|[_\s])window(?:[_\s]|$)|窓/i.test(name)))windowMeshes.push(id);
          // Keep authored furniture assemblies, including Mesh parents with
          // outline children and GLTF multi-material primitive groups.
          for(let parent:Object3D|null=mesh;parent&&parent!==root;parent=parent.parent){const children=groups.get(parent)??[];children.push(id);groups.set(parent,children);}
        }
      }
    });
    if(!meshes.length||bounds.isEmpty())throw new Error('表示できる面がありません。メッシュを含むモデルを選んでください');
    const assemblies=[...groups.entries()].filter(([,indices])=>indices.length>1);
    return {meshes,bounds,meshNames,windowMeshes,groups:assemblies.map(([,indices])=>indices),groupNames:assemblies.map(([object])=>object.name)};
  }finally{disposeObject(root);}
}

export function fitStageCamera(shape:StageShape):BackgroundCapture['camera'] {
  const centre=shape.bounds.getCenter(new Vector3()),radius=Math.max(.001,shape.bounds.getSize(new Vector3()).length()/2);
  return {position:centre.clone().add(new Vector3(4,3,5).normalize().multiplyScalar(radius*3.6)).toArray(),target:centre.toArray(),fov:40};
}

/** Tight clip planes retain depth precision even when the camera is far from the stage. */
export function stageClipPlanes(shape:StageShape,camera:PerspectiveCamera):{near:number;far:number} {
  const centre=shape.bounds.getCenter(new Vector3()),radius=Math.max(.001,shape.bounds.getSize(new Vector3()).length()/2);
  const depth=centre.sub(camera.position).dot(camera.getWorldDirection(new Vector3()));
  const near=Math.max(radius/10000,depth-radius*1.01);
  return {near,far:Math.max(near+radius*.01,depth+radius*1.01)};
}

export function backgroundPaths(edges:BackgroundEdge[],capture:BackgroundCapture,_dpi:number):VectorPath[] {
  return edges.map(edge=>({id:crypto.randomUUID(),closed:false,nodes:[edge.a,edge.b].map(point=>({x:capture.frame.x+point.x,y:capture.frame.y+point.y})),style:{...defaultVectorStyle(),width:edge.width}}));
}
