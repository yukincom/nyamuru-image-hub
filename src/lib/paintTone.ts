import type { BBox, PaintColorMode, PaintLayer, PaintTone } from '../types.ts';
import { newPaintMask } from './paintMask.ts';

export const defaultPaintTone = ():PaintTone => ({enabled:true,lpi:60,mode:'image',density:20});

/** A blank coverage mask never changes or copies the selected artwork. */
export function newToneLayer(selection:BBox[]|null=null,colorMode:PaintColorMode='color'):PaintLayer {
  return {id:crypto.randomUUID(),name:'トーン',kind:'raster',colorMode,visible:true,locked:false,opacity:1,blend:'normal',strokes:[],
    tone:{...defaultPaintTone(),mode:'fixed',fill:true,angle:45},mask:newPaintMask(selection??[])};
}

// Area of a centered disk clipped to a unit square. Inverting this gives the
// requested coverage even where neighbouring circular dots meet at high density.
function diskArea(r2:number):number {
  return r2<=.25?Math.PI*r2:Math.PI*r2-4*(r2*Math.acos(.5/Math.sqrt(r2))-.5*Math.sqrt(r2-.25));
}
const radii=Float64Array.from({length:257},(_,i)=>{
  let low=0,high=.5;
  for(let k=0;k<30;k++){const mid=(low+high)/2;if(diskArea(mid)<i/256)low=mid;else high=mid;}
  return (low+high)/2;
});

const mod=(value:number,base:number)=>((value%base)+base)%base;

interface ToneScreen {a:number;b:number;area:number;g:number;p:number;q:number;ranks?:Uint32Array}
const screens=new Map<string,ToneScreen>();

// Every dot must cover the same document pixels. A floating rotated lattice
// changes its subpixel phase from dot to dot, producing differently shaped dots.
// Quantize the two perpendicular lattice vectors, then rank one discrete cell.
function toneScreen(period:number,angle:number):ToneScreen {
  let a=Math.round(period*Math.cos(angle)),b=Math.round(period*Math.sin(angle));
  if(!a&&!b)a=1;
  const key=`${a},${b}`,cached=screens.get(key);
  if(cached){screens.delete(key);screens.set(key,cached);return cached;}
  const area=a*a+b*b;
  if(!Number.isSafeInteger(area))return {a,b,area,g:1,p:0,q:0};
  let g=Math.abs(a),r=Math.abs(b),p=1,q=0,rp=0,rq=1;
  while(r){const n=Math.floor(g/r);[g,r]=[r,g-n*r];[p,rp]=[rp,p-n*rp];[q,rq]=[rq,q-n*rq];}
  p*=Math.sign(a);q*=Math.sign(b);
  const screen:ToneScreen={a,b,area,g,p,q};
  // Rank tables stay small even for imported files with extreme DPI/line counts.
  // Larger cells use the same integer lattice with an analytic circular cutoff.
  if(area<=65536){
    const extent=Math.ceil((Math.abs(a)+Math.abs(b))/2),points:{x:number;y:number;distance:number}[]=[];
    for(let y=-extent;y<=extent;y++)for(let x=-extent;x<=extent;x++){
      const u=2*(a*x+b*y),v=2*(-b*x+a*y);
      if(u>=-area&&u<area&&v>=-area&&v<area)points.push({x,y,distance:x*x+y*y});
    }
    points.sort((l,r)=>l.distance-r.distance||l.y-r.y||l.x-r.x);
    screen.ranks=new Uint32Array(area);
    points.forEach(({x,y},rank)=>screen.ranks![screenIndex(screen,x,y)]=rank);
  }
  screens.set(key,screen);
  if(screens.size>8)screens.delete(screens.keys().next().value!);
  return screen;
}

// A single rotated-coordinate remainder collides when gcd(a,b)>1 (e.g. 7,7).
// Bezout coordinates distinguish all a²+b² pixel positions in the cell.
function screenIndex({a,b,area,g,p,q}:ToneScreen,x:number,y:number):number {
  return mod(p*x+q*y,g)+g*mod((-b/g)*x+(a/g)*y,area/g);
}

function screenInk(screen:ToneScreen,x:number,y:number,coverage:number):number {
  const {a,b,area,ranks}=screen;
  if(ranks)return ranks[screenIndex(screen,x,y)]<Math.round(coverage*area)?1:0;
  const u=(mod(a*x+b*y+area/2,area)-area/2)/area,v=(mod(-b*x+a*y+area/2,area)-area/2)/area;
  return u*u+v*v<radii[Math.round(coverage*256)]?1:0;
}

/** Pixel-aligned circular dots at the nearest representable physical frequency. */
export function applyPaintTone(pixels:{width:number;height:number;data:Uint8ClampedArray},tone:PaintTone,dpi:number,documentWidth:number,documentHeight:number,preview=false,documentOffset={x:0,y:0}):void {
  if(!tone.enabled)return;
  const {width,height,data}=pixels,sx=documentWidth/width,sy=documentHeight/height;
  preview=preview&&(sx>1.001||sy>1.001);
  const screen=toneScreen(dpi/tone.lpi,(tone.angle??45)*Math.PI/180),origin=tone.origin??{x:0,y:0};
  const centerX=Math.round((screen.a-screen.b)/2),centerY=Math.round((screen.a+screen.b)/2);
  // Resolve subpixel origins once, keeping preview samples on the native pixel grid.
  const phaseX=centerX-Math.floor(.5-origin.x),phaseY=centerY-Math.floor(.5-origin.y);
  const sample=(x:number,y:number,coverage:number)=>screenInk(screen,Math.floor(x+documentOffset.x)-phaseX,Math.floor(y+documentOffset.y)-phaseY,coverage);
  // Below Nyquist only mean coverage is meaningful. Use the discrete cell's
  // actual coverage so reduced previews do not change density as they zoom.
  const screenPeriod=Math.sqrt(screen.area)/Math.max(sx,sy),t=Math.max(0,Math.min(1,(screenPeriod-2)/2));
  const detail=preview?t*t*(3-2*t):1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4;if(!data[i+3])continue;
    const coverage=tone.mode==='fixed'?tone.density/100:1-(data[i]*.2126+data[i+1]*.7152+data[i+2]*.0722)/255;
    const mean=screen.ranks?Math.round(coverage*screen.area)/screen.area:coverage;
    let ink:number;
    if(coverage<=0||coverage>=1)ink=coverage<=0?0:1;
    else if(detail===0)ink=mean;
    else if(preview){
      ink=0;
      for(const ox of [.25,.75])for(const oy of [.25,.75])ink+=sample((x+ox)*sx,(y+oy)*sy,coverage)/4;
      ink=mean*(1-detail)+ink*detail;
    }else ink=sample((x+.5)*sx,(y+.5)*sy,coverage);
    data[i]=data[i+1]=data[i+2]=0;
    data[i+3]=Math.round(data[i+3]*ink);
  }
}
