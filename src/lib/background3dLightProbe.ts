import { CubeCamera, Data3DTexture, FloatType, LinearFilter, SphericalHarmonics3, Vector3, WebGLCubeRenderTarget } from 'three';
import type { Scene, WebGLRenderer } from 'three';
import { LightProbeGridWebGL } from 'three/addons/lighting/LightProbeGridWebGL.js';

/** Three's probe-grid shader uses seven RGBA volumes with one padded Z slice.
 * Keep capture resources per editor: the addon's shared bake targets otherwise
 * retain disposal callbacks belonging to already disposed WebGL renderers. */
export class BackgroundLightProbe {
  readonly grid:LightProbeGridWebGL;
  private texture:Data3DTexture;
  private empty:Data3DTexture;
  private target=new WebGLCubeRenderTarget(16,{type:FloatType});
  private camera:CubeCamera;
  private pixels=new Float32Array(16*16*4);
  constructor(width:number,height:number,depth:number,centre:Vector3,near:number,far:number){
    this.grid=new LightProbeGridWebGL(width,height,depth,4,3,4);this.grid.position.copy(centre);this.grid.updateBoundingBox();
    this.texture=new Data3DTexture(new Float32Array(4*3*42*4),4,3,42);
    this.empty=new Data3DTexture(new Float32Array(4),1,1,1);
    for(const texture of [this.texture,this.empty]){texture.type=FloatType;texture.minFilter=texture.magFilter=LinearFilter;texture.needsUpdate=true;}
    this.grid.texture=this.texture;this.camera=new CubeCamera(near,far,this.target);
  }
  bake(renderer:WebGLRenderer,scene:Scene,index:number){
    const ix=index%4,iy=Math.floor(index/16),iz=Math.floor(index/4)%4;
    this.grid.getProbePosition(ix,iy,iz,this.camera.position);
    // Direct radiance only: the resulting SH field provides one diffuse bounce.
    this.grid.texture=this.empty;
    try{this.camera.update(renderer,scene);}finally{this.grid.texture=this.texture;}
    const sh=new SphericalHarmonics3(),basis=new Array<number>(9).fill(0),direction=new Vector3(),radiance=new Vector3();let weightSum=0;
    for(let face=0;face<6;face++){
      renderer.readRenderTargetPixels(this.target,0,0,16,16,this.pixels,face);
      for(let pixel=0;pixel<256;pixel++){
        const x=-1+(pixel%16+.5)/8,y=1-(Math.floor(pixel/16)+.5)/8;
        if(face===0)direction.set(1,y,-x);else if(face===1)direction.set(-1,y,x);
        else if(face===2)direction.set(x,1,-y);else if(face===3)direction.set(x,-1,y);
        else if(face===4)direction.set(x,y,1);else direction.set(-x,y,-1);
        const lengthSq=direction.lengthSq(),weight=4/(Math.sqrt(lengthSq)*lengthSq);weightSum+=weight;
        SphericalHarmonics3.getBasisAt(direction.normalize(),basis);
        radiance.fromArray(this.pixels,pixel*4);
        for(let coefficient=0;coefficient<9;coefficient++){
          sh.coefficients[coefficient].addScaledVector(radiance,basis[coefficient]*weight);
        }
      }
    }
    sh.scale(4*Math.PI/weightSum);
    const values=sh.coefficients.flatMap(value=>value.toArray());values.push(0);
    const data=this.texture.image.data as Float32Array;
    for(let part=0;part<7;part++)for(const z of [iz+1,...(iz===0?[0]:[]),...(iz===3?[5]:[])]){
      data.set(values.slice(part*4,part*4+4),((part*6+z)*12+iy*4+ix)*4);
    }
    this.texture.needsUpdate=true;
  }
  dispose(){this.grid.removeFromParent();this.grid.dispose();this.texture.dispose();this.empty.dispose();this.target.dispose();}
}
