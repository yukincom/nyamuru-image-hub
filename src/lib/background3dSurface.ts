import type { BackgroundEdge } from './background3dGeometry.ts';

/** Camera-space samples, in top-to-bottom row order. The GPU supplies linear
 * irradiance, positive view depth (zero is empty), and an octahedral normal. */
export interface BackgroundSurfaceInput {width:number;height:number;pixels:Float32Array;frameWidth:number;frameHeight:number;fov:number;principalPoint?:[number,number]}
export interface BackgroundSurface extends BackgroundSurfaceInput {
  /** Luminance, depth, grouping weight, closed-gap flag; shared with lighting. */
  texture:Float32Array;
  normals:Float32Array;
  planes:Uint32Array;
  radius:number;
  footprint:number;
  amount:number;
}
const clamp=(value:number)=>Math.max(0,Math.min(1,value));
const smooth=(value:number)=>{const t=clamp(value);return t*t*(3-2*t);};
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
function decodeNormal(x:number,y:number,out:Float32Array,i:number){
  let z=1-Math.abs(x)-Math.abs(y);
  if(z<0){const old=x;x=(1-Math.abs(y))*(x>=0?1:-1);y=(1-Math.abs(old))*(y>=0?1:-1);}
  const length=Math.hypot(x,y,z)||1;out[i]=x/length;out[i+1]=y/length;out[i+2]=z/length;
}
function edgeDepth(edge:BackgroundEdge,t:number){return edge.depth?1/mix(1/edge.depth[0],1/edge.depth[1],t):0;}

/** Broad connected planes receive cast shadows; nearby repeated edges must not
 * turn those receiving surfaces into part of a leaf/fence cluster. */
function stablePlanes(input:BackgroundSurfaceInput,normals:Float32Array,footprint:number){
  const {width:w,height:h,pixels}=input,n=w*h,labels=new Uint32Array(n),queue=new Uint32Array(n),large:boolean[]=[false],counts:number[]=[0];
  const side=Math.max(8,Math.round(32*Math.max(w,h)/1024));let label=0;
  for(let start=0;start<n;start++){
    if(labels[start]||!pixels[start*4+1])continue;
    label++;labels[start]=label;queue[0]=start;let end=1,minX=start%w,maxX=minX,minY=Math.floor(start/w),maxY=minY;
    for(let cursor=0;cursor<end;cursor++){
      const p=queue[cursor],x=p%w,y=Math.floor(p/w),z=pixels[p*4+1];minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      for(const q of [x>0?p-1:-1,x+1<w?p+1:-1,y>0?p-w:-1,y+1<h?p+w:-1]){
        if(q<0||labels[q])continue;const qz=pixels[q*4+1];if(!qz||Math.abs(z-qz)>footprint*Math.min(z,qz)*8)continue;
        if(normals[start*3]*normals[q*3]+normals[start*3+1]*normals[q*3+1]+normals[start*3+2]*normals[q*3+2]<.995)continue;
        labels[q]=label;queue[end++]=q;
      }
    }
    large[label]=end>=side*side*2&&maxX-minX+1>=side&&maxY-minY+1>=side;
    counts[label]=end;
  }
  // A connected grid of rails is still porous. Require a genuinely filled
  // patch, not just a large bounding box joined by one horizontal crossbar.
  const squares=new Uint16Array(w+1),covered=new Int32Array((w+1)*(h+1));
  for(let y=0;y<h;y++){let diagonal=0;for(let x=0;x<w;x++){
    const p=y*w+x,id=labels[p],above=squares[x+1];
    squares[x+1]=id&&large[id]?1+(x&&y&&labels[p-1]===id&&labels[p-w]===id&&labels[p-w-1]===id?Math.min(squares[x],above,diagonal):0):0;
    if(squares[x+1]>=side){const x0=x-side+1,y0=y-side+1;covered[y0*(w+1)+x0]++;covered[y0*(w+1)+x+1]--;covered[(y+1)*(w+1)+x0]--;covered[(y+1)*(w+1)+x+1]++;}
    diagonal=above;
  }}
  // Protect only the pixels inside filled patches. A wide post must not make
  // every thin rail connected to it inherit the same protection.
  const filled:number[]=[];
  for(let y=0;y<h;y++){let row=0;for(let x=0;x<w;x++){const p=y*(w+1)+x;row+=covered[p];covered[p]=row+(y?covered[p-w-1]:0);if(covered[p]){const id=labels[y*w+x];filled[id]=(filled[id]??0)+1;}}}
  // A predominantly broad plane can extend behind a few occluding objects;
  // retain those cast-shadow pixels too. A porous grid fails this area ratio.
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=y*w+x,id=labels[p];if(!covered[y*(w+1)+x]&&(filled[id]??0)<counts[id]*.8)labels[p]=0;}
  return labels;
}

/** Fixed output-relative scale: resizing the editor or changing DPR must not
 * alter which features survive the final editable vector capture. */
export function backgroundSurfaceSize(width:number,height:number){
  const scale=Math.min(1,1024/Math.max(width,height));
  return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}

export function groupBackgroundSurface(input:BackgroundSurfaceInput,edges:BackgroundEdge[],amount:number):BackgroundSurface {
  const {width:w,height:h,pixels,frameWidth,frameHeight}=input,n=w*h;
  if(pixels.length!==n*4)throw new Error('3Dの面情報のサイズが一致しません');
  amount=clamp(amount);
  // The upper end describes a whole mass of leaves, not merely a few adjacent
  // triangles. Keep the low end gentle while giving 100% a genuinely coarse scale.
  const scale=Math.max(w,h)/1024;
  const radius=amount>0?Math.max(1,Math.round((1+79*amount*amount)*scale)):0;
  const densityRadius=Math.max(1,Math.min(radius,Math.round(24*scale)));
  const gapRadius=Math.max(1,Math.min(radius,Math.round(4*scale)));
  const footprint=2*Math.tan(input.fov*Math.PI/360)/h;
  const normals=new Float32Array(n*3),texture=new Float32Array(n*4);
  for(let p=0;p<n;p++){
    texture[p*4]=pixels[p*4];texture[p*4+1]=pixels[p*4+1];
    decodeNormal(pixels[p*4+2],pixels[p*4+3],normals,p*3);
  }
  const planes=radius?stablePlanes(input,normals,footprint):new Uint32Array(0);
  const result={...input,texture,normals,planes,radius,footprint,amount};if(!radius)return result;

  // Repeated surface boundaries qualify; an isolated thin rail has only two
  // crossings and cannot become a flat patch merely because it is narrow.
  const ink=new Uint8Array(n);
  for(const edge of edges){
    const ax=edge.a.x*w/frameWidth,ay=edge.a.y*h/frameHeight,bx=edge.b.x*w/frameWidth,by=edge.b.y*h/frameHeight;
    const steps=Math.max(1,Math.ceil(Math.hypot(bx-ax,by-ay)*2));
    for(let k=0;k<=steps;k++){
      const t=k/steps,x=Math.floor(mix(ax,bx,t)),y=Math.floor(mix(ay,by,t));
      if(x>=0&&x<w&&y>=0&&y<h)ink[y*w+x]=1;
    }
  }
  const integral=new Uint32Array((w+1)*(h+1));
  for(let y=0;y<h;y++){let row=0;for(let x=0;x<w;x++){row+=ink[y*w+x];integral[(y+1)*(w+1)+x+1]=integral[y*(w+1)+x+1]+row;}}
  const density=new Float32Array(n);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const x0=Math.max(0,x-densityRadius),x1=Math.min(w,x+densityRadius+1),y0=Math.max(0,y-densityRadius),y1=Math.min(h,y+densityRadius+1);
    const count=integral[y1*(w+1)+x1]-integral[y0*(w+1)+x1]-integral[y1*(w+1)+x0]+integral[y0*(w+1)+x0];
    density[y*w+x]=smooth((count/Math.max(x1-x0,y1-y0)-2.2)/2.8);
  }

  // Close only short, bounded gaps between compatible foreground surfaces.
  // This representative depth joins leaf clusters without joining the room
  // behind them. Large openings and the outer silhouette have no two anchors.
  const seed=new Float32Array(pixels),seedNormals=new Float32Array(normals),bridged=new Uint8Array(n);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const p=y*w+x;if(density[p]<.2)continue;
    const original=pixels[p*4+1];let best=original||Infinity,bestA=-1,bestB=-1;
    for(const vertical of [false,true]){
      let a=-1,b=-1;
      for(let d=1;d<=gapRadius;d++){
        const ax=vertical?x:x-d,ay=vertical?y-d:y,bx=vertical?x:x+d,by=vertical?y+d:y;
        if(a<0&&ax>=0&&ay>=0){const q=ay*w+ax,z=pixels[q*4+1];if(z>0&&(!original||z<original-footprint*z*gapRadius))a=q;}
        if(b<0&&bx<w&&by<h){const q=by*w+bx,z=pixels[q*4+1];if(z>0&&(!original||z<original-footprint*z*gapRadius))b=q;}
        if(a>=0&&b>=0)break;
      }
      if(a<0||b<0)continue;
      const za=pixels[a*4+1],zb=pixels[b*4+1];
      const da=vertical?y-Math.floor(a/w):x-a%w,db=vertical?Math.floor(b/w)-y:b%w-x;
      const z=(da+db)/(db/za+da/zb);
      let compatible=Math.abs(za-zb)<footprint*z*gapRadius*2;
      if(!compatible){
        // A receding fence can have a steep but continuous depth slope. Confirm
        // the same inverse-depth line on BOTH sides before closing its gap.
        const slope=(1/zb-1/za)/(da+db);
        compatible=[-1,1].every(direction=>{
          const anchor=direction<0?a:b,anchorQ=direction<0?1/za:1/zb;
          for(let d=2;d<=gapRadius+2;d++){
            const qx=anchor%w+(vertical?0:direction*d),qy=Math.floor(anchor/w)+(vertical?direction*d:0);
            if(qx<0||qx>=w||qy<0||qy>=h)break;
            const depth=pixels[(qy*w+qx)*4+1],expected=anchorQ+slope*direction*d;
            if(depth>0&&expected>0&&Math.abs(1/depth-expected)<footprint/Math.min(za,zb)*1.5)return true;
          }
          return false;
        });
      }
      if(compatible&&z<best){best=z;bestA=a;bestB=b;}
    }
    if(bestA>=0){bridged[p]=1;seed[p*4]=mix(pixels[bestA*4],pixels[bestB*4],.5);seed[p*4+1]=best;for(let c=0;c<3;c++)seedNormals[p*3+c]=mix(normals[bestA*3+c],normals[bestB*3+c],.5);}
  }

  // Two separable depth-aware passes keep the work bounded. Normals may vary
  // inside a leaf cluster; a strict normal gate would retain every leaf.
  let values=seed,ns=seedNormals;
  for(const vertical of [false,true]){
    const next=new Float32Array(values),nextNormals=new Float32Array(ns);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const p=y*w+x,z=seed[p*4+1];if(!z||density[p]<.01||planes[p]&&!bridged[p])continue;
      const tolerance=Math.max(1e-8,footprint*z*radius*2.5);
      let weight=0,lum=0,nx=0,ny=0,nz=0;
      for(let d=-radius;d<=radius;d++){
        const qx=vertical?x:x+d,qy=vertical?y+d:y;if(qx<0||qx>=w||qy<0||qy>=h)continue;
        const q=qy*w+qx,qz=values[q*4+1];if(!qz||planes[q]&&!bridged[q])continue;
        const dz=Math.abs(qz-z)/tolerance;if(dz>=1)continue;
        const a=(radius+1-Math.abs(d))*(1-dz*dz);weight+=a;lum+=values[q*4]*a;
        nx+=ns[q*3]*a;ny+=ns[q*3+1]*a;nz+=ns[q*3+2]*a;
      }
      if(weight){next[p*4]=lum/weight;const length=Math.hypot(nx,ny,nz)||1;nextNormals[p*3]=nx/length;nextNormals[p*3+1]=ny/length;nextNormals[p*3+2]=nz/length;}
    }
    values=next;ns=nextNormals;
  }
  for(let p=0;p<n;p++){
    texture[p*4]=values[p*4];texture[p*4+1]=values[p*4+1];texture[p*4+2]=planes[p]&&!bridged[p]?0:density[p];texture[p*4+3]=bridged[p];
  }
  result.normals=ns;
  return result;
}

/** Clip at measured surface transitions, never at a repeating dash period. */
export function surfaceBackgroundEdges(edges:BackgroundEdge[],surface:BackgroundSurface,lineGap:number,creaseAngle:number):BackgroundEdge[] {
  const {width:w,height:h,frameWidth,frameHeight,pixels,texture,normals,planes,radius,footprint}=surface;
  const output:BackgroundEdge[]=[],sx=w/frameWidth,sy=h/frameHeight;
  const [cx,cy]=surface.principalPoint??[w/2,h/2];
  const gapRadius=Math.max(1,Math.min(radius,Math.round(4*Math.max(w,h)/1024)));
  const coarse=smooth((surface.amount-.5)/.5);
  const index=(x:number,y:number)=>x<0||x>=w||y<0||y>=h?-1:Math.floor(y)*w+Math.floor(x);
  const threshold=1-clamp(lineGap)*.65,rawNormals=new Float32Array(6);
  for(const edge of edges){
    const ax=edge.a.x*sx,ay=edge.a.y*sy,dx=(edge.b.x-edge.a.x)*sx,dy=(edge.b.y-edge.a.y)*sy,length=Math.hypot(dx,dy);
    const nx=-dy/(length||1),ny=dx/(length||1),steps=Math.max(1,Math.ceil(length*2));
    const keep=(t:number)=>{
      const x=ax+dx*t,y=ay+dy*t,z=edgeDepth(edge,t);
      const centre=index(x,y);
      // A bounded small gap may now belong to the foreground mass. Its proxy
      // surface must occlude rear lines just as it covers their tone pixels.
      if(radius&&z&&centre>=0&&texture[centre*4+2]>=.45&&texture[centre*4+3]>.5){const front=texture[centre*4+1];if(front>0&&front<z-Math.max(1e-7,footprint*z*2))return false;}
      // Find real adjacent surfaces matching the source edge. Empty background
      // is never white light, and a distant wall must not protect a lit rail.
      let light=Infinity,found=false;
      for(const offset of [-1.25,-.5,0,.5,1.25]){
        const p=index(x+nx*offset,y+ny*offset);if(p<0)continue;
        const depth=pixels[p*4+1];if(!depth||z&&Math.abs(depth-z)>Math.max(1e-7,footprint*z*3))continue;
        found=true;const compatible=Math.abs(texture[p*4+1]-depth)<footprint*depth*Math.max(2,radius*3);
        const lum=compatible?mix(pixels[p*4],texture[p*4],texture[p*4+2]):pixels[p*4];light=Math.min(light,lum);
      }
      // Irradiance remains unclipped: bright white surfaces can still have a
      // gradient towards a lamp instead of all disappearing at the first step.
      if(found&&lineGap>0&&light/(light+.12)>=threshold)return false;
      if(!radius)return true;
      const p=index(x,y);if(p<0||texture[p*4+2]<.45)return true;
      // Check coverage/depth locally. Looking a full coarse radius away would
      // incorrectly protect every little leaf near the mass's outer perimeter.
      const offset=Math.max(1.5,gapRadius*.6),a=index(x+nx*offset,y+ny*offset),b=index(x-nx*offset,y-ny*offset);
      if(a<0||b<0)return true;
      const za=texture[a*4+1],zb=texture[b*4+1];if(!za||!zb)return true;
      if((planes[a]&&!texture[a*4+3]||planes[b]&&!texture[b*4+3])&&planes[a]!==planes[b]){
        decodeNormal(pixels[a*4+2],pixels[a*4+3],rawNormals,0);decodeNormal(pixels[b*4+2],pixels[b*4+3],rawNormals,3);
        const dot=rawNormals[0]*rawNormals[3]+rawNormals[1]*rawNormals[4]+rawNormals[2]*rawNormals[5];
        // A grazing face changes view depth sharply within a single pixel.
        // Measure distance to its actual plane, not just the sampled depth.
        const distance=(q:number,i:number)=>{
          const depth=pixels[q*4+1];
          return Math.abs(rawNormals[i]*footprint*((x-cx)*z-(q%w+.5-cx)*depth)+rawNormals[i+1]*footprint*((cy-y)*z-(cy-Math.floor(q/w)-.5)*depth)+rawNormals[i+2]*(depth-z));
        };
        if(dot<.95&&(!z||Math.min(distance(a,0),distance(b,3))<footprint*z*1.5))return true;
      }
      const depthRadius=mix(gapRadius,Math.min(radius,32*Math.max(w,h)/1024),coarse);
      if(z&&(Math.abs(za-z)>footprint*z*radius*3||Math.abs(zb-z)>footprint*z*radius*3)||Math.abs(za-zb)>footprint*Math.min(za,zb)*depthRadius*2.5){
        // Inverse depth is affine in both screen coordinates. Rounded samples
        // drift along an oblique edge as well as across it; a 1D interpolation
        // misreads that drift as a depth step and restores distant dense lines.
        // Validate directly around the source edge. A post a few pixels away
        // must not protect every wire in the surrounding omission radius.
        const a0=index(x-.55,y-.55),b0=index(x+.55,y-.55),c0=index(x-.55,y+.55),d0=index(x+.55,y+.55);
        if(!z||[a0,b0,c0,d0].some(q=>q<0||!texture[q*4+1]))return true;
        const ax=a0%w+.5,ay=Math.floor(a0/w)+.5,bx=b0%w+.5,cy=Math.floor(c0/w)+.5;
        const q0=1/texture[a0*4+1],u=(1/texture[b0*4+1]-q0)/(bx-ax),v=(1/texture[c0*4+1]-q0)/(cy-ay);
        const expected=1/(q0+u*(x-ax)+v*(y-ay)),fourth=1/(q0+u*(bx-ax)+v*(cy-ay)),zd=texture[d0*4+1];
        // The fourth sample validates continuity instead of fitting a plane
        // through an arbitrary pair of unrelated foreground/background sides.
        if(expected<=0||fourth<=0||Math.abs(fourth-zd)>footprint*zd*Math.max(2,gapRadius)||Math.abs(expected-z)>footprint*z*Math.max(2,gapRadius))return true;
      }
      // At maximum omission a compact dense mass keeps its perimeter and large
      // depth separations; the folds of its constituent leaves are dispensable.
      if(coarse>=.999)return false;
      // A building corner changes normal coherently over a broad neighborhood;
      // the directions of individual leaves average out within the mass.
      const span=Math.max(offset,radius*.7),na=index(x+nx*span,y+ny*span),nb=index(x-nx*span,y-ny*span);
      if(na<0||nb<0||!texture[na*4+1]||!texture[nb*4+1])return false;
      if(z&&(Math.abs(texture[na*4+1]-z)>footprint*z*radius*3||Math.abs(texture[nb*4+1]-z)>footprint*z*radius*3))return false;
      const dot=normals[na*3]*normals[nb*3]+normals[na*3+1]*normals[nb*3+1]+normals[na*3+2]*normals[nb*3+2];
      return dot<Math.cos(mix(Math.max(20,creaseAngle),180,coarse)*Math.PI/180);
    };
    const point=(t:number)=>({x:mix(edge.a.x,edge.b.x,t),y:mix(edge.a.y,edge.b.y,t)});
    const emit=(low:number,high:number)=>{if((high-low)*length<.05)return;output.push({...edge,a:point(low),b:point(high),...(edge.depth?{depth:[edgeDepth(edge,low),edgeDepth(edge,high)] as [number,number]}:{})});};
    let previous=keep(0),start=previous?0:-1;
    for(let k=1;k<=steps;k++){
      const t=k/steps,current=keep(t);
      if(current!==previous){let low=(k-1)/steps,high=t;for(let j=0;j<5;j++){const middle=(low+high)/2;if(keep(middle)===previous)low=middle;else high=middle;}const crossing=(low+high)/2;if(previous)emit(start,crossing);else start=crossing;}
      previous=current;
    }
    if(previous)emit(start,1);
  }
  return output;
}
