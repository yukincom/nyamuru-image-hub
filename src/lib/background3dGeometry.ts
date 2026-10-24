/** Static, opaque triangle geometry, already transformed into world coordinates. */
export type GeometryMesh = { positions: number[]; indices: number[] };
type Point3 = { x: number; y: number; z: number };
type Point4 = Point3 & { w: number };
type Point2 = { x: number; y: number };
type Kind = 'outline' | 'detail';
export type BackgroundEdge = { a: Point2; b: Point2; kind: Kind; width: number; depth?:[number,number] };
export type BackgroundEdgeOptions = {
  width: number; height: number; creaseAngle: number; detail: number;
  outlineWidth: number; detailWidth: number;
  /** Reserved for the capture layer's lighting treatment; visibility is geometric. */
  lightDirection?: readonly number[]; lightBreak?: number;
};
type Face = { normal: Point3; facing: number };
type Edge = { a: Point3; b: Point3; faces: Face[] };
type Bounds = { minX: number; maxX: number; minY: number; maxY: number };
type Triangle = Bounds & { points: [Point3, Point3, Point3]; minZ:number; sign: number; zx: number; zy: number; zc: number };
type Interval = [number, number];
const AREA_EPSILON = 1e-14;
const DEPTH_EPSILON = 1e-7;
const INTERVAL_EPSILON = 1e-9;
const dot = (a: Point3, b: Point3) => a.x*b.x+a.y*b.y+a.z*b.z;
const minus = (a: Point3, b: Point3): Point3 => ({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const cross = (a: Point3, b: Point3): Point3 => ({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const length = (a: Point3) => Math.hypot(a.x,a.y,a.z);
const cross2 = (ax:number,ay:number,bx:number,by:number) => ax*by-ay*bx;
const lerp = (a:number,b:number,t:number) => a+(b-a)*t;
const at = (a:Point3,b:Point3,t:number):Point3 => ({x:lerp(a.x,b.x,t),y:lerp(a.y,b.y,t),z:lerp(a.z,b.z,t)});
const at4 = (a:Point4,b:Point4,t:number):Point4 => ({...at(a,b,t),w:lerp(a.w,b.w,t)});
const bounds = (points:Point3[]):Bounds => ({minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minY:Math.min(...points.map(p=>p.y)),maxY:Math.max(...points.map(p=>p.y))});
const overlaps = (a:Bounds,b:Bounds) => a.minX<=b.maxX+INTERVAL_EPSILON&&a.maxX>=b.minX-INTERVAL_EPSILON&&a.minY<=b.maxY+INTERVAL_EPSILON&&a.maxY>=b.minY-INTERVAL_EPSILON;
const planes = [(p:Point4)=>p.w+p.x,(p:Point4)=>p.w-p.x,(p:Point4)=>p.w+p.y,(p:Point4)=>p.w-p.y,(p:Point4)=>p.w+p.z,(p:Point4)=>p.w-p.z];

function transform(p:Point3,m:readonly number[]):Point4 {
  return {x:m[0]*p.x+m[4]*p.y+m[8]*p.z+m[12],y:m[1]*p.x+m[5]*p.y+m[9]*p.z+m[13],z:m[2]*p.x+m[6]*p.y+m[10]*p.z+m[14],w:m[3]*p.x+m[7]*p.y+m[11]*p.z+m[15]};
}
function project(p:Point4):Point3|null {
  if(p.w<=0)return null;
  const result={x:p.x/p.w,y:p.y/p.w,z:p.z/p.w};
  return Object.values(result).every(Number.isFinite)?result:null;
}
/** Clip before perspective division: geometry crossing the eye cannot flip over. */
function clipPolygon(points:Point4[]):Point4[] {
  let result=points;
  for(const plane of planes){
    const input=result;result=[];
    for(let i=0;i<input.length;i++){
      const a=input[i],b=input[(i+1)%input.length],da=plane(a),db=plane(b);
      if(da>=0)result.push(a);
      if((da>=0)!==(db>=0))result.push(at4(a,b,da/(da-db)));
    }
    if(result.length<3)return [];
  }
  return result;
}
function clipEdge(a:Point4,b:Point4):[Point3,Point3]|null {
  let low=0,high=1;
  for(const plane of planes){
    const da=plane(a),db=plane(b);
    if(da<0&&db<0)return null;
    if((da>=0)!==(db>=0)){
      const t=da/(da-db);
      if(da<0)low=Math.max(low,t);else high=Math.min(high,t);
      if(high-low<=INTERVAL_EPSILON)return null;
    }
  }
  const start=project(at4(a,b,low)),end=project(at4(a,b,high));
  return start&&end?[start,end]:null;
}
function projectedTriangle(a:Point3,b:Point3,c:Point3):Triangle|null {
  const area=cross2(b.x-a.x,b.y-a.y,c.x-a.x,c.y-a.y);
  if(Math.abs(area)<=AREA_EPSILON)return null;
  const zx=((b.z-a.z)*(c.y-a.y)-(c.z-a.z)*(b.y-a.y))/area;
  const zy=((b.x-a.x)*(c.z-a.z)-(c.x-a.x)*(b.z-a.z))/area;
  return {...bounds([a,b,c]),points:[a,b,c],minZ:Math.min(a.z,b.z,c.z),sign:Math.sign(area),zx,zy,zc:a.z-zx*a.x-zy*a.y};
}

/** Intersect [low, high] with the positive half of an affine function. */
function positiveInterval(value0:number,value1:number,low:number,high:number,epsilon=0):Interval|null {
  value0+=epsilon;value1+=epsilon;
  if(value0<0&&value1<0)return null;
  if(value0>=0&&value1>=0)return [low,high];
  const t=value0/(value0-value1);
  if(value0<0)low=Math.max(low,t);else high=Math.min(high,t);
  return high-low>INTERVAL_EPSILON?[low,high]:null;
}
function hiddenInterval(a:Point3,b:Point3,triangle:Triangle):Interval|null {
  let low=0,high=1;
  for(let i=0;i<3;i++){
    const p=triangle.points[i],q=triangle.points[(i+1)%3];
    const dx=q.x-p.x,dy=q.y-p.y;
    const da=triangle.sign*cross2(dx,dy,a.x-p.x,a.y-p.y)+AREA_EPSILON,db=triangle.sign*cross2(dx,dy,b.x-p.x,b.y-p.y)+AREA_EPSILON;
    if(da<0&&db<0)return null;
    if(da<0||db<0){const t=da/(da-db);if(da<0)low=Math.max(low,t);else high=Math.min(high,t);if(high-low<=INTERVAL_EPSILON)return null;}
  }
  // NDC z, unlike world-space distance, is affine in projected screen position.
  const da=a.z-(triangle.zx*a.x+triangle.zy*a.y+triangle.zc),db=b.z-(triangle.zx*b.x+triangle.zy*b.y+triangle.zc);
  if(Math.max(lerp(da,db,low),lerp(da,db,high))<=DEPTH_EPSILON)return null;
  // Apply tolerance to the coplanarity decision, not the interval boundary:
  // subtracting an epsilon here would leave tiny rear-edge stubs at every vertex.
  return positiveInterval(da,db,low,high);
}
function visibleIntervals(hidden:Interval[]):Interval[] {
  hidden.sort((a,b)=>a[0]-b[0]);
  const result:Interval[]=[];let cursor=0;
  for(const [low,high] of hidden){
    if(low-cursor>INTERVAL_EPSILON)result.push([cursor,low]);
    cursor=Math.max(cursor,high);
    if(cursor>=1)return result;
  }
  if(1-cursor>INTERVAL_EPSILON)result.push([cursor,1]);
  return result;
}

/** Maintain the exact covered union so two front faces can end a hidden-edge query. */
function addHiddenInterval(hidden:Interval[],interval:Interval):boolean {
  let [low,high]=interval,start=0;
  while(start<hidden.length&&hidden[start][1]<low-INTERVAL_EPSILON)start++;
  let end=start;
  while(end<hidden.length&&hidden[end][0]<=high+INTERVAL_EPSILON){low=Math.min(low,hidden[end][0]);high=Math.max(high,hidden[end][1]);end++;}
  hidden.splice(start,end-start,[low,high]);
  return hidden.length===1&&hidden[0][0]<=INTERVAL_EPSILON&&hidden[0][1]>=1-INTERVAL_EPSILON;
}

/** Screen-space bounds reject off-line and deeper geometry without changing occlusion. */
function triangleTree(triangles:Triangle[]) {
  type Node=Bounds&{minZ:number;start:number;end:number;left?:Node;right?:Node};
  const ordered=[...triangles];
  const build=(start:number,end:number):Node=>{
    const node:Node={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity,minZ:Infinity,start,end};
    for(let i=start;i<end;i++){const t=ordered[i];node.minX=Math.min(node.minX,t.minX);node.maxX=Math.max(node.maxX,t.maxX);node.minY=Math.min(node.minY,t.minY);node.maxY=Math.max(node.maxY,t.maxY);node.minZ=Math.min(node.minZ,t.minZ);}
    if(end-start>16){
      const x=node.maxX-node.minX>=node.maxY-node.minY;
      const sorted=ordered.slice(start,end).sort((a,b)=>x?(a.minX+a.maxX)-(b.minX+b.maxX):(a.minY+a.maxY)-(b.minY+b.maxY));
      for(let i=0;i<sorted.length;i++)ordered[start+i]=sorted[i];
      const mid=(start+end)>>>1;node.left=build(start,mid);node.right=build(mid,end);
    }
    return node;
  };
  const root=build(0,ordered.length);
  const crosses=(a:Point3,b:Point3,box:Bounds)=>{
    let low=0,high=1;
    const dx=b.x-a.x,dy=b.y-a.y;
    if(Math.abs(dx)<1e-15){if(a.x<box.minX-INTERVAL_EPSILON||a.x>box.maxX+INTERVAL_EPSILON)return false;}
    else{const t0=(box.minX-INTERVAL_EPSILON-a.x)/dx,t1=(box.maxX+INTERVAL_EPSILON-a.x)/dx;low=Math.max(low,Math.min(t0,t1));high=Math.min(high,Math.max(t0,t1));if(low>high)return false;}
    if(Math.abs(dy)<1e-15){if(a.y<box.minY-INTERVAL_EPSILON||a.y>box.maxY+INTERVAL_EPSILON)return false;}
    else{const t0=(box.minY-INTERVAL_EPSILON-a.y)/dy,t1=(box.maxY+INTERVAL_EPSILON-a.y)/dy;low=Math.max(low,Math.min(t0,t1));high=Math.min(high,Math.max(t0,t1));if(low>high)return false;}
    return true;
  };
  return function* query(a:Point3,b:Point3,box:Bounds):Generator<Triangle>{
    const maxZ=Math.max(a.z,b.z),stack=[root];
    while(stack.length){
      const node=stack.pop()!;
      if(node.minZ>=maxZ-DEPTH_EPSILON||!overlaps(box,node)||!crosses(a,b,node))continue;
      if(node.left&&node.right){
        const first=node.left.minZ<node.right.minZ?node.left:node.right,second=first===node.left?node.right:node.left;
        stack.push(second,first);
      }else for(let i=node.start;i<node.end;i++){const triangle=ordered[i];if(triangle.minZ<maxZ-DEPTH_EPSILON&&overlaps(box,triangle)&&crosses(a,b,triangle))yield triangle;}
    }
  };
}
/** Merge coincident/overlapping collinear output, preferring outlines over detail. */
function deduplicate(segments:BackgroundEdge[]):BackgroundEdge[] {
  type Part={low:number;high:number;kind:Kind;width:number;slope:number;intercept:number};
  type LineGroup={dx:number;dy:number;offset:number;parts:Part[]};
  const groups=new Map<string,LineGroup>();
  for(const segment of segments){
    let dx=segment.b.x-segment.a.x,dy=segment.b.y-segment.a.y;
    const size=Math.hypot(dx,dy);if(size<1e-5)continue;
    dx/=size;dy/=size;
    if(dx<-1e-10||(Math.abs(dx)<=1e-10&&dy<0)){dx=-dx;dy=-dy;}
    const offset=-dy*segment.a.x+dx*segment.a.y;
    const key=`${Math.round(dx*1e8)},${Math.round(dy*1e8)},${Math.round(offset*1e5)}`;
    let group=groups.get(key);
    if(!group){group={dx,dy,offset,parts:[]};groups.set(key,group);}
    const start=group.dx*segment.a.x+group.dy*segment.a.y,end=group.dx*segment.b.x+group.dy*segment.b.y;
    const slope=segment.depth?(1/segment.depth[1]-1/segment.depth[0])/(end-start):0;
    group.parts.push({low:Math.min(start,end),high:Math.max(start,end),kind:segment.kind,width:segment.width,slope,intercept:segment.depth?1/segment.depth[0]-slope*start:0});
  }
  const result:BackgroundEdge[]=[];
  for(const group of groups.values()){
    const stops=group.parts.flatMap(part=>[part.low,part.high]).sort((a,b)=>a-b).filter((v,i,all)=>!i||v-all[i-1]>1e-5);
    let current:Part|undefined;
    const emit=()=>{if(current){const point=(t:number)=>({x:group.dx*t-group.dy*group.offset,y:group.dy*t+group.dx*group.offset});result.push({a:point(current.low),b:point(current.high),kind:current.kind,width:current.width,...(current.intercept||current.slope?{depth:[1/(current.slope*current.low+current.intercept),1/(current.slope*current.high+current.intercept)] as [number,number]}:{})});}};
    for(let i=1;i<stops.length;i++){
      const low=stops[i-1],high=stops[i],mid=(low+high)/2;
      const active=group.parts.filter(part=>part.low<=mid&&part.high>=mid);
      if(!active.length){emit();current=undefined;continue;}
      const kind:Kind=active.some(part=>part.kind==='outline')?'outline':'detail';
      const width=active.reduce((maximum,part)=>part.kind===kind?Math.max(maximum,part.width):maximum,0);
      const nearest=active.reduce((a,b)=>a.slope*mid+a.intercept>=b.slope*mid+b.intercept?a:b),{slope,intercept}=nearest;
      if(current&&current.kind===kind&&current.width===width&&Math.abs(current.slope-slope)<1e-10&&Math.abs(current.intercept-intercept)<1e-8&&low-current.high<1e-5)current.high=high;
      else{emit();current={low,high,kind,width,slope,intercept};}
    }
    emit();
  }
  return result;
}

/**
 * Extract visible geometric lines without a renderer or pixel sampling.
 * Materials are intentionally treated as opaque/two-sided. Input must be a static
 * world-space snapshot; skinning, transparency and cast-shadow edges are not here.
 * Hierarchical bounds and complete-occlusion exits retain exact visible intervals.
 */
export function visibleBackgroundEdges(meshes:GeometryMesh[],viewProjection:readonly number[],cameraPosition:readonly number[],options:BackgroundEdgeOptions):{segments:BackgroundEdge[];stats:{triangles:number;candidates:number}} {
  const fail=()=>{throw new Error('3D背景の形状またはカメラ設定が不正です');};
  if(viewProjection.length!==16||!viewProjection.every(Number.isFinite)||cameraPosition.length<3||!cameraPosition.slice(0,3).every(Number.isFinite)
    ||![options.width,options.height,options.outlineWidth,options.detailWidth].every(value=>Number.isFinite(value)&&value>0)
    ||!Number.isFinite(options.creaseAngle)||!Number.isFinite(options.detail??1))fail();
  const eye={x:cameraPosition[0],y:cameraPosition[1],z:cameraPosition[2]};
  const orthographic=Math.hypot(viewProjection[3],viewProjection[7],viewProjection[11])<1e-12;
  const orthoView={x:-viewProjection[2],y:-viewProjection[6],z:-viewProjection[10]};
  const threshold=Math.cos(Math.max(0,Math.min(180,options.creaseAngle))*Math.PI/180);
  // Perspective NDC z = A + B / viewDepth. Retain the source depth through
  // exact occlusion and deduplication for the surface/light sampling stage.
  const depthA=orthographic?0:(viewProjection[2]*viewProjection[3]+viewProjection[6]*viewProjection[7]+viewProjection[10]*viewProjection[11])/(viewProjection[3]**2+viewProjection[7]**2+viewProjection[11]**2);
  const depthB=transform(eye,viewProjection).z;
  const edges:Edge[]=[],triangles:Triangle[]=[];let triangleCount=0;
  for(const mesh of meshes){
    if(mesh.positions.length%3||mesh.indices.length%3||!mesh.positions.every(Number.isFinite))fail();
    const vertices:Point3[]=[];
    for(let i=0;i<mesh.positions.length;i+=3)vertices.push({x:mesh.positions[i],y:mesh.positions[i+1],z:mesh.positions[i+2]});
    const indices=mesh.indices.length?mesh.indices:Array.from({length:vertices.length},(_,i)=>i);
    if(indices.length%3||indices.some(i=>!Number.isSafeInteger(i)||i<0||i>=vertices.length))fail();
    if(!vertices.length)continue;
    let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
    for(const p of vertices){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);minZ=Math.min(minZ,p.z);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);maxZ=Math.max(maxZ,p.z);}
    const tolerance=Math.max(maxX-minX,maxY-minY,maxZ-minZ)*1e-9||1e-9;
    const welded:Point3[]=[],vertexIds=new Map<string,number>();
    const ids=vertices.map(p=>{
      const key=`${Math.round((p.x-minX)/tolerance)},${Math.round((p.y-minY)/tolerance)},${Math.round((p.z-minZ)/tolerance)}`;
      let id=vertexIds.get(key);if(id===undefined){id=welded.length;welded.push(p);vertexIds.set(key,id);}return id;
    });
    const localEdges=new Map<string,Edge>();
    for(let i=0;i<indices.length;i+=3){
      const a=vertices[indices[i]],b=vertices[indices[i+1]],c=vertices[indices[i+2]],normal=cross(minus(b,a),minus(c,a)),normalLength=length(normal);
      if(!Number.isFinite(normalLength))fail();
      if(normalLength===0)continue;
      normal.x/=normalLength;normal.y/=normalLength;normal.z/=normalLength;triangleCount++;
      const centre={x:(a.x+b.x+c.x)/3,y:(a.y+b.y+c.y)/3,z:(a.z+b.z+c.z)/3};
      const view=orthographic?orthoView:minus(eye,centre),viewLength=length(view);
      const facing=viewLength?dot(normal,view)/viewLength:0,face:Face={normal,facing};
      for(let j=0;j<3;j++){
        const from=ids[indices[i+j]],to=ids[indices[i+(j+1)%3]];if(from===to)continue;
        const key=from<to?`${from},${to}`:`${to},${from}`;
        let edge=localEdges.get(key);if(!edge){edge={a:welded[from],b:welded[to],faces:[]};localEdges.set(key,edge);}edge.faces.push(face);
      }
      const polygon=clipPolygon([transform(a,viewProjection),transform(b,viewProjection),transform(c,viewProjection)]).map(project);
      if(polygon.some(p=>!p))continue;
      for(let j=2;j<polygon.length;j++){const triangle=projectedTriangle(polygon[0]!,polygon[j-1]!,polygon[j]!);if(triangle)triangles.push(triangle);}
    }
    for(const edge of localEdges.values())edges.push(edge);
  }
  const query=triangleTree(triangles),segments:BackgroundEdge[]=[];let candidates=0;
  for(const edge of edges){
    const faces=edge.faces;
    // Winding may be reversed by a baked negative scale. Silhouette sign changes
    // and crease angles are invariant; visibility is resolved against both sides.
    const outline=faces.length===1||faces.some(a=>faces.some(b=>a.facing>1e-8&&b.facing<=1e-8||a.facing<-1e-8&&b.facing>=-1e-8));
    const crease=faces.some(a=>faces.some(b=>dot(a.normal,b.normal)<threshold-1e-10));
    if(!outline&&!crease)continue;
    candidates++;
    const clipped=clipEdge(transform(edge.a,viewProjection),transform(edge.b,viewProjection));if(!clipped)continue;
    const [a,b]=clipped,box=bounds([a,b]);
    if(Math.hypot((b.x-a.x)*options.width,(b.y-a.y)*options.height)<2e-5)continue;
    const hidden:Interval[]=[];
    for(const triangle of query(a,b,box)){
      const interval=hiddenInterval(a,b,triangle);
      if(interval&&addHiddenInterval(hidden,interval))break;
    }
    const kind:Kind=outline?'outline':'detail',width=outline?options.outlineWidth:options.detailWidth;
    const pixel=(p:Point3)=>({x:(p.x+1)*options.width/2,y:(1-p.y)*options.height/2});
    for(const [low,high] of visibleIntervals(hidden)){
      const start=at(a,b,low),end=at(a,b,high);
      segments.push({a:pixel(start),b:pixel(end),kind,width,...(!orthographic?{depth:[depthB/(start.z-depthA),depthB/(end.z-depthA)] as [number,number]}:{})});
    }
  }
  return {segments:deduplicate(segments),stats:{triangles:triangleCount,candidates}};
}
