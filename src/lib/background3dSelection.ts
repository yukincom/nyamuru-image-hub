/** Outline only visible selected pixels. The mask comes from the scene depth
 * buffer, so furniture in front of a selected object still occludes it. */
export function backgroundSelectionOutline(mask:Uint8Array|Uint8ClampedArray,width:number,height:number,radius=2):Uint8ClampedArray<ArrayBuffer> {
  const output=new Uint8ClampedArray(width*height*4),r=Math.max(1,Math.round(radius));
  const selected=(x:number,y:number)=>x>=0&&y>=0&&x<width&&y<height&&mask[(y*width+x)*4]>127;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    if(!selected(x,y))continue;
    if(selected(x-r,y)&&selected(x+r,y)&&selected(x,y-r)&&selected(x,y+r))continue;
    const i=(y*width+x)*4;output[i]=32;output[i+1]=176;output[i+2]=74;output[i+3]=255;
  }
  return output;
}
