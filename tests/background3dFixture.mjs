/** Entirely synthetic cube, also used for browser import and portable-project QA. */
export function cubeGlb(){
  const positions=new Float32Array([-1,-1,-1,1,-1,-1,1,1,-1,-1,1,-1,-1,-1,1,1,-1,1,1,1,1,-1,1,1]);
  const indices=new Uint16Array([0,2,1,0,3,2,4,5,6,4,6,7,0,4,7,0,7,3,1,2,6,1,6,5,0,1,5,0,5,4,3,7,6,3,6,2]);
  const size=positions.byteLength+indices.byteLength;
  const json={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1}]}],buffers:[{byteLength:size}],bufferViews:[{buffer:0,byteOffset:0,byteLength:positions.byteLength},{buffer:0,byteOffset:positions.byteLength,byteLength:indices.byteLength}],accessors:[{bufferView:0,componentType:5126,count:8,type:'VEC3',min:[-1,-1,-1],max:[1,1,1]},{bufferView:1,componentType:5123,count:36,type:'SCALAR'}]};
  const encoded=new TextEncoder().encode(JSON.stringify(json)),jsonSize=Math.ceil(encoded.length/4)*4;
  const buffer=new ArrayBuffer(12+8+jsonSize+8+size),view=new DataView(buffer),bytes=new Uint8Array(buffer);
  view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,buffer.byteLength,true);
  view.setUint32(12,jsonSize,true);view.setUint32(16,0x4e4f534a,true);bytes.fill(32,20,20+jsonSize);bytes.set(encoded,20);
  view.setUint32(20+jsonSize,size,true);view.setUint32(24+jsonSize,0x004e4942,true);bytes.set(new Uint8Array(positions.buffer),28+jsonSize);bytes.set(new Uint8Array(indices.buffer),28+jsonSize+positions.byteLength);
  return new File([buffer],'test-cube.glb',{type:'model/gltf-binary'});
}
