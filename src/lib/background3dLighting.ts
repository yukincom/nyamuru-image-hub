import { AmbientLight, BufferGeometry, DataTexture, DirectionalLight, DoubleSide, Float32BufferAttribute, FloatType, LinearFilter, Mesh, MeshStandardMaterial, NearestFilter, NoBlending, PlaneGeometry, RGBAFormat, Scene, ShaderMaterial, SpotLight, Vector2, Vector3, VSMShadowMap, WebGLRenderTarget } from 'three';
import type { Camera, WebGLRenderer } from 'three';
import { BackgroundLightProbe } from './background3dLightProbe.ts';
import type { BackgroundCapture } from '../types.ts';
import { backgroundLightSettings, backgroundLightWindow, backgroundRoomBounds, type BackgroundLightingShape } from './background3dLightingModel.ts';
import type { BackgroundSurfacePatch } from './background3dSurfaceComputer.ts';

const cancelled=()=>new DOMException('照明の設定が変更されました','AbortError');

/** Static lighting uses the complete room, independently of the camera cutaway.
 * A small irradiance grid gathers diffuse reflections; it is reused while orbiting.
 * Thresholding happens after lighting, so each tone region has one fixed density. */
export class BackgroundLighting {
  private scene=new Scene();
  private materials:MeshStandardMaterial[]=[];
  private meshes:Mesh[]=[];
  private ceiling:Mesh|null=null;
  private lights:Array<DirectionalLight|SpotLight>=[];
  private ambient=new AmbientLight(0xffffff,.06);
  private probes:BackgroundLightProbe|null=null;
  private visibility:DataTexture;
  private surfaceTarget:WebGLRenderTarget|null=null;
  private surfaceTexture:DataTexture|null=null;
  private surfaceScene=new Scene();
  private surfacePatch:Mesh;
  private version=0;
  private uniforms={
    stageMode:{value:0},stageVisibility:{value:null as DataTexture|null},stageCount:{value:1},
    stageToneThreshold:{value:.45},stageBlackThreshold:{value:.85},stageDensity:{value:.2},stageBounce:{value:1},
    stageSurface:{value:null as DataTexture|null},stageSurfaceEnabled:{value:0},stageSurfaceViewport:{value:new Vector2(1,1)},stageSurfaceTolerance:{value:0},stageSurfaceProjection:{value:new Vector2()},
  };
  private key='';private timer=0;private raf=0;private generation=0;private disposed=false;
  private pending:{resolve:()=>void;reject:(reason:Error)=>void;promise:Promise<void>}|null=null;
  private done=0;private total=0;private failure='';
  private renderer:WebGLRenderer;private shape:BackgroundLightingShape;private update:()=>void;
  constructor(renderer:WebGLRenderer,shape:BackgroundLightingShape,update:()=>void,windowMesh?:number){
    this.renderer=renderer;this.shape=shape;this.update=update;
    const surfaceMaterial=new ShaderMaterial({uniforms:this.uniforms,depthTest:true,depthWrite:false,blending:NoBlending,toneMapped:false,
      vertexShader:'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
      fragmentShader:`uniform float stageMode;uniform sampler2D stageSurface;uniform vec2 stageSurfaceViewport;uniform vec2 stageSurfaceProjection;
uniform float stageToneThreshold;uniform float stageBlackThreshold;uniform float stageDensity;
float coverageAbove(float value,float threshold){if(threshold<=0.0)return 1.0;if(threshold>=1.0)return 0.0;float edge=fwidth(value)*0.7;return edge>0.000001?smoothstep(threshold-edge,threshold+edge,value):step(threshold,value);}
void main(){
  vec2 uv=gl_FragCoord.xy/stageSurfaceViewport;uv.y=1.0-uv.y;vec4 surface=texture2D(stageSurface,uv);
  if(surface.g<=0.0||surface.b<0.45)discard;
  gl_FragDepth=(stageSurfaceProjection.x+stageSurfaceProjection.y/surface.g)*0.5+0.5;
  float shade=1.0-clamp(pow(max(surface.r,0.0)*3.0,1.0/2.2),0.0,1.0);
  float black=coverageAbove(shade,stageBlackThreshold);
  float tone=coverageAbove(shade,stageToneThreshold)*(1.0-black);
  if(stageMode<0.5)gl_FragColor=vec4(vec3((1.0-black)*(1.0-tone*stageDensity)),1.0);
  else gl_FragColor=vec4(0.0,0.0,0.0,stageMode<1.5?black:tone);
}`});
    this.surfacePatch=new Mesh(new PlaneGeometry(2,2),surfaceMaterial);this.surfacePatch.frustumCulled=false;this.surfaceScene.add(this.surfacePatch);
    this.visibility=new DataTexture(new Uint8Array(shape.meshes.length*4).fill(255),shape.meshes.length,1,RGBAFormat);
    this.visibility.minFilter=this.visibility.magFilter=NearestFilter;this.visibility.needsUpdate=true;
    this.uniforms.stageVisibility.value=this.visibility;this.uniforms.stageCount.value=shape.meshes.length;
    const glass=new Set(shape.windowMeshes??[]);
    if(windowMesh!==undefined)for(const i of backgroundLightWindow(shape,{azimuth:0,elevation:0,windowMesh})?.indices??[])glass.add(i);
    for(const window of [false,true]){
      const ids=shape.meshes.map((_,i)=>i).filter(i=>glass.has(i)===window);if(!ids.length)continue;
      const count=ids.reduce((sum,i)=>sum+shape.meshes[i].indices.length,0),positions=new Float32Array(count*3),normals=new Float32Array(count*3),meshIndex=new Float32Array(count);
      const a=new Vector3(),b=new Vector3(),c=new Vector3();let cursor=0;
      for(const id of ids){const mesh=shape.meshes[id];for(let i=0;i<mesh.indices.length;i+=3){
        a.fromArray(mesh.positions,mesh.indices[i]*3);b.fromArray(mesh.positions,mesh.indices[i+1]*3);c.fromArray(mesh.positions,mesh.indices[i+2]*3);
        const normal=b.sub(a).cross(c.sub(a)).normalize();
        for(let k=0;k<3;k++){const source=mesh.indices[i+k]*3;for(let j=0;j<3;j++)positions[cursor*3+j]=mesh.positions[source+j];normal.toArray(normals,cursor*3);meshIndex[cursor++]=id;}
      }}
      const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new Float32BufferAttribute(normals,3));geometry.setAttribute('stageMesh',new Float32BufferAttribute(meshIndex,1));geometry.computeBoundingSphere();
      const material=new MeshStandardMaterial({color:0xe8e8e8,roughness:1,metalness:0,side:DoubleSide,blending:NoBlending,toneMapped:false});
      material.onBeforeCompile=shader=>{
        Object.assign(shader.uniforms,this.uniforms);
        shader.vertexShader='attribute float stageMesh; varying float vStageMesh;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvStageMesh=stageMesh;');
        shader.fragmentShader=`uniform float stageMode; uniform sampler2D stageVisibility; uniform float stageCount; varying float vStageMesh;
uniform float stageToneThreshold; uniform float stageBlackThreshold; uniform float stageDensity; uniform float stageBounce;
uniform sampler2D stageSurface; uniform float stageSurfaceEnabled; uniform vec2 stageSurfaceViewport; uniform float stageSurfaceTolerance;
vec2 surfaceNormal(vec3 n){n/=abs(n.x)+abs(n.y)+abs(n.z);return n.z>=0.0?n.xy:(1.0-abs(n.yx))*vec2(n.x>=0.0?1.0:-1.0,n.y>=0.0?1.0:-1.0);}
float coverageAbove(float value,float threshold){if(threshold<=0.0)return 1.0;if(threshold>=1.0)return 0.0;float edge=fwidth(value)*0.7;return edge>0.000001?smoothstep(threshold-edge,threshold+edge,value):step(threshold,value);}
`+shader.fragmentShader.replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
if(stageMode>=0.0&&(vStageMesh<0.0||texture2D(stageVisibility,vec2((vStageMesh+0.5)/stageCount,0.5)).r<0.5))discard;
`);
        // Scale the gathered bounce independently from the direct lights.
        shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
if(stageMode<0.0){gl_FragColor=vec4(${window?'vec3(0.0)':'outgoingLight'},1.0);}else{
  float luminance=${window?'1.0':'dot(reflectedLight.directDiffuse+reflectedLight.directSpecular+stageBounce*(reflectedLight.indirectDiffuse+reflectedLight.indirectSpecular),vec3(0.2126,0.7152,0.0722))'};
  if(stageMode>2.5){gl_FragColor=vec4(luminance,vViewPosition.z,surfaceNormal(normal));}
  else{
  if(stageSurfaceEnabled>0.5){
    vec2 uv=gl_FragCoord.xy/stageSurfaceViewport;uv.y=1.0-uv.y;
    vec4 surface=texture2D(stageSurface,uv);
    if(surface.g>0.0&&abs(surface.g-vViewPosition.z)<stageSurfaceTolerance*vViewPosition.z+fwidth(surface.g)*1.5)luminance=mix(luminance,surface.r,surface.b);
  }
  float shade=1.0-clamp(pow(max(luminance,0.0)*3.0,1.0/2.2),0.0,1.0);
  float black=coverageAbove(shade,stageBlackThreshold);
  float tone=coverageAbove(shade,stageToneThreshold)*(1.0-black);
  if(stageMode<0.5)gl_FragColor=vec4(vec3((1.0-black)*(1.0-tone*stageDensity)),1.0);
  else gl_FragColor=vec4(0.0,0.0,0.0,stageMode<1.5?black:tone);
  }
}`);
        shader.fragmentShader=shader.fragmentShader.replace('#include <tonemapping_fragment>','').replace('#include <colorspace_fragment>','');
      };
      material.customProgramCacheKey=()=>`background-light-binary-${window?1:0}`;
      const mesh=new Mesh(geometry,material);mesh.castShadow=!window;mesh.receiveShadow=!window;
      this.scene.add(mesh);this.meshes.push(mesh);this.materials.push(material);
    }
    this.scene.add(this.ambient);renderer.shadowMap.enabled=true;renderer.shadowMap.type=VSMShadowMap;renderer.shadowMap.autoUpdate=false;
  }
  get status(){return this.failure||this.pending?this.failure||`光の反射を計算中 ${Math.round(this.done/Math.max(1,this.total)*100)}%`:'';}
  get revision(){return this.version;}
  configure(config:BackgroundCapture){
    this.uniforms.stageToneThreshold.value=(config.toneThreshold??45)/100;
    this.uniforms.stageBlackThreshold.value=config.blackAmount===0?1.01:1-config.blackAmount/100;
    this.uniforms.stageDensity.value=config.toneEnabled?config.toneDensity/100:0;
    const light=backgroundLightSettings(config.light);this.uniforms.stageBounce.value=light.bounce;
    // Threshold, tone density, camera and cutaway do not invalidate the light bake.
    const key=JSON.stringify({...light,bounce:undefined,...(light.preset==='indoor'?{azimuth:undefined,elevation:undefined}:{})});if(key===this.key)return;
    this.key=key;this.cancel();this.failure='';this.configureLights(config.light);
    const room=backgroundRoomBounds(this.shape),size=room.getSize(new Vector3()),centre=room.getCenter(new Vector3());
    this.probes?.dispose();this.probes=null;
    if(!this.renderer.extensions.has('EXT_color_buffer_float')||!this.renderer.extensions.has('OES_texture_float_linear')){this.failure='このGPUでは反射光を計算できません（直射光と影のみ表示）';return;}
    // Stay inside the room boundary, avoiding probes embedded in the walls.
    const radius=Math.max(.01,this.shape.bounds.getSize(new Vector3()).length());
    this.probes=new BackgroundLightProbe(Math.max(size.x*.82,.01),Math.max(size.y*.78,.01),Math.max(size.z*.82,.01),centre,radius*.0005,radius*3);
    this.scene.add(this.probes.grid);this.done=0;this.total=48;
    let resolve!:()=>void,reject!:(reason:Error)=>void;const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
    // Configuration changes may cancel background work before capture awaits it.
    void promise.catch(()=>{});this.pending={resolve,reject,promise};
    const generation=this.generation;this.timer=window.setTimeout(()=>this.bakeNext(generation),180);
  }
  private configureLights(input:BackgroundCapture['light']){
    for(const light of this.lights){this.scene.remove(light,light.target);light.dispose();}this.lights=[];
    const settings=backgroundLightSettings(input),room=backgroundRoomBounds(this.shape),size=room.getSize(new Vector3()),centre=room.getCenter(new Vector3()),radius=Math.max(.01,size.length()/2),window=backgroundLightWindow(this.shape,input);
    this.ceiling?.removeFromParent();this.ceiling?.geometry.dispose();this.ceiling=null;
    if(window&&input.ceiling!==false){
      const geometry=new PlaneGeometry(size.x,size.z);geometry.rotateX(Math.PI/2);geometry.translate(centre.x,room.max.y,centre.z);
      geometry.setAttribute('stageMesh',new Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count).fill(-1),1));
      this.ceiling=new Mesh(geometry,this.materials[0]);this.ceiling.castShadow=this.ceiling.receiveShadow=true;this.scene.add(this.ceiling);
    }
    if(settings.preset!=='indoor'){
      const az=settings.azimuth*Math.PI/180,el=settings.elevation*Math.PI/180,direction=new Vector3(Math.sin(az)*Math.cos(el),Math.sin(el),Math.cos(az)*Math.cos(el));
      const sun=new DirectionalLight(0xffffff,settings.intensity*(settings.preset==='evening'?4.2:3));
      sun.position.copy(centre).addScaledVector(direction,radius*2.5);sun.target.position.copy(centre);sun.castShadow=true;
      Object.assign(sun.shadow.camera,{left:-radius,right:radius,top:radius,bottom:-radius,near:radius*.1,far:radius*5});sun.shadow.camera.updateProjectionMatrix();sun.shadow.mapSize.set(2048,2048);sun.shadow.normalBias=radius*.0005;sun.shadow.bias=-.00005;sun.shadow.radius=4;sun.shadow.blurSamples=8;sun.shadow.autoUpdate=false;sun.shadow.needsUpdate=true;
      this.lights.push(sun);this.scene.add(sun,sun.target);
    }
    const spot=(position:Vector3,normal:Vector3,power:number)=>{
      const light=new SpotLight(0xffffff,power*settings.intensity,0,Math.PI*.46,.5,2);light.position.copy(position);light.target.position.copy(position).add(normal);light.castShadow=true;
      light.shadow.mapSize.set(2048,2048);light.shadow.camera.near=radius*.0075;light.shadow.camera.far=radius*5;light.shadow.normalBias=radius*.00035;light.shadow.bias=-.00003;light.shadow.radius=4;light.shadow.blurSamples=8;light.shadow.autoUpdate=false;light.shadow.needsUpdate=true;
      this.lights.push(light);this.scene.add(light,light.target);
    };
    if(window&&settings.preset!=='indoor'){
      const power=window.width*window.height*(settings.preset==='evening'?3:8);
      for(const x of [-.28,.28])for(const y of [-.28,.28])spot(window.centre.clone().addScaledVector(window.right,window.width*x).addScaledVector(window.up,window.height*y).addScaledVector(window.normal,radius*.006),window.normal,power/4);
    }
    const indoor=settings.preset==='indoor'?1.7:settings.preset==='evening'?.22:.12;
    for(const x of [-.15,.15])spot(new Vector3(centre.x+size.x*x,room.max.y-size.y*.08,centre.z),new Vector3(0,-1,0),size.x*size.z*indoor/2);
    this.ambient.intensity=.06*settings.intensity;this.scene.updateMatrixWorld(true);this.renderer.shadowMap.needsUpdate=true;
    this.prepareShadows();
  }
  private prepareShadows(){
    if(!this.renderer.extensions.has('EXT_color_buffer_float')||!this.renderer.extensions.has('OES_texture_float_linear'))return;
    // Three allocates half-float VSM moments on the first draw. At room distances
    // their rounding creates false self-shadows on flat walls and screens.
    // Clone the public render targets before use, preserving their depth textures.
    const target=this.renderer.getRenderTarget(),face=this.renderer.getActiveCubeFace(),mip=this.renderer.getActiveMipmapLevel(),scratch=new WebGLRenderTarget(1,1);
    try{
      this.renderer.setRenderTarget(scratch);this.renderer.render(this.scene,this.lights[0].shadow.camera);
      for(const light of this.lights){for(const key of ['map','mapPass'] as const){const old=light.shadow[key];if(!old)continue;const next=old.clone();next.texture.type=FloatType;old.dispose();light.shadow[key]=next;}light.shadow.needsUpdate=true;}
      this.renderer.shadowMap.needsUpdate=true;
      this.renderer.render(this.scene,this.lights[0].shadow.camera);
    }finally{this.renderer.setRenderTarget(target,face,mip);scratch.dispose();}
  }
  private bakeNext(generation:number){
    if(this.disposed||generation!==this.generation||!this.probes||!this.pending)return;
    const pending=this.pending,mode=this.uniforms.stageMode.value;this.uniforms.stageMode.value=-1;
    try{
      this.probes.bake(this.renderer,this.scene,this.done);this.done++;
      if(this.done===this.total){this.pending=null;this.version++;pending.resolve();}
      else this.raf=requestAnimationFrame(()=>this.bakeNext(generation));
    }catch(error){console.error('Background lighting bake failed',error);this.failure=error instanceof Error?error.message:'反射光を計算できませんでした';this.pending=null;pending.reject(new Error(this.failure));}
    finally{this.uniforms.stageMode.value=mode;if(this.done%4===0||!this.pending)this.update();}
  }
  setVisible(indices:number[]|undefined){
    const visible=indices?new Set(indices):null,data=this.visibility.image.data!;let changed=false;
    for(let i=0;i<this.shape.meshes.length;i++){const value=!visible||visible.has(i)?255:0;if(data[i*4]!==value){data[i*4]=value;changed=true;}}
    if(changed)this.visibility.needsUpdate=true;
  }
  render(camera:Camera,mode:number){
    this.uniforms.stageMode.value=mode;this.renderer.getDrawingBufferSize(this.uniforms.stageSurfaceViewport.value);const target=this.renderer.getRenderTarget();if(target)this.uniforms.stageSurfaceViewport.value.set(target.width,target.height);
    this.uniforms.stageSurfaceProjection.value.set(-camera.projectionMatrix.elements[10],camera.projectionMatrix.elements[14]);
    this.renderer.render(this.scene,camera);
    if(this.uniforms.stageSurfaceEnabled.value&&mode>=0&&mode<2.5){
      // Dense proxy patches include only short, depth-compatible closed gaps.
      // Their coverage and irradiance are shared by preview and both masks.
      const clear=this.renderer.autoClear;this.renderer.autoClear=false;
      try{this.renderer.render(this.surfaceScene,camera);}finally{this.renderer.autoClear=clear;}
    }
  }
  surface(camera:Camera,width:number,height:number){
    if(!this.renderer.extensions.has('EXT_color_buffer_float'))throw new Error('このGPUでは面の省略・光による線の抜きを計算できません');
    if(!this.surfaceTarget||this.surfaceTarget.width!==width||this.surfaceTarget.height!==height){this.surfaceTarget?.dispose();this.surfaceTarget=new WebGLRenderTarget(width,height,{type:FloatType,minFilter:NearestFilter,magFilter:NearestFilter,depthBuffer:true,stencilBuffer:false});}
    const previous=this.renderer.getRenderTarget(),bytes=new Float32Array(width*height*4);
    try{this.renderer.setRenderTarget(this.surfaceTarget);this.renderer.clear();this.render(camera,3);this.renderer.readRenderTargetPixels(this.surfaceTarget,0,0,width,height,bytes);}
    finally{this.renderer.setRenderTarget(previous);}
    const pixels=new Float32Array(bytes.length);for(let y=0;y<height;y++)pixels.set(bytes.subarray((height-y-1)*width*4,(height-y)*width*4),y*width*4);return pixels;
  }
  setSurface(surface:BackgroundSurfacePatch|null){
    this.surfaceTexture?.dispose();this.surfaceTexture=null;this.uniforms.stageSurfaceEnabled.value=0;this.uniforms.stageSurface.value=null;
    if(!surface?.radius)return;
    const texture=new DataTexture(surface.texture,surface.width,surface.height,RGBAFormat,FloatType);texture.minFilter=texture.magFilter=this.renderer.extensions.has('OES_texture_float_linear')?LinearFilter:NearestFilter;texture.needsUpdate=true;
    this.surfaceTexture=texture;this.uniforms.stageSurface.value=texture;this.uniforms.stageSurfaceEnabled.value=1;
    // Grouping changes irradiance, not occupied depths. Use the local projected
    // slope for resampling, so a coarse background cannot recolor a thin object
    // in front of it merely because the omission radius is large.
    this.uniforms.stageSurfaceTolerance.value=surface.footprint*3;
  }
  async ready(){if(this.failure&&!this.failure.startsWith('このGPU'))throw new Error(this.failure);if(this.pending)await this.pending.promise;}
  private cancel(){this.generation++;window.clearTimeout(this.timer);cancelAnimationFrame(this.raf);this.pending?.reject(cancelled());this.pending=null;}
  dispose(){this.disposed=true;this.cancel();this.probes?.dispose();this.probes=null;this.ceiling?.geometry.dispose();this.ceiling=null;for(const light of this.lights)light.dispose();for(const mesh of this.meshes)mesh.geometry.dispose();for(const material of this.materials)material.dispose();this.surfaceTarget?.dispose();this.surfaceTexture?.dispose();this.surfacePatch.geometry.dispose();(this.surfacePatch.material as ShaderMaterial).dispose();this.surfaceScene.clear();this.visibility.dispose();this.scene.clear();}
}
