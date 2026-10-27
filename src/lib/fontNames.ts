type FontNameRecord={id:number;text:string;japanese:boolean;english:boolean;unicode:boolean};
export interface FontWeightOption {value:number;label:string}
export interface FontFaceMetadata {displayName?:string;styleName?:string;weight?:number;width?:number;italic?:boolean;namedWeights?:FontWeightOption[]}

function decodeName(bytes:Uint8Array,encoding:string):string {
  try{return new TextDecoder(encoding,{fatal:true}).decode(bytes).replaceAll('\0','').trim();}catch{return '';}
}

function nameRecords(view:DataView):FontNameRecord[] {
  if(view.byteLength<6)return [];
  const version=view.getUint16(0),count=view.getUint16(2),storage=view.getUint16(4),end=6+count*12;
  if(version>1||end>view.byteLength||storage<end||storage>view.byteLength)return [];
  const bytes=(offset:number,length:number)=>offset>=storage&&offset+length<=view.byteLength?new Uint8Array(view.buffer,view.byteOffset+offset,length):new Uint8Array();
  const tags:string[]=[];
  if(version===1){
    if(end+2>storage)return [];
    const tagCount=view.getUint16(end);
    if(end+2+tagCount*4>storage)return [];
    for(let i=0;i<tagCount;i++)tags.push(decodeName(bytes(storage+view.getUint16(end+4+i*4),view.getUint16(end+2+i*4)),'utf-16be'));
  }
  const records:FontNameRecord[]=[];
  for(let i=0;i<count;i++){
    const at=6+i*12,platform=view.getUint16(at),encoding=view.getUint16(at+2),language=view.getUint16(at+4),id=view.getUint16(at+6);
    if(![1,2,6,16,17].includes(id)&&id<256)continue;
    const unicode=platform===0||platform===3&&(encoding===0||encoding===1||encoding===10);
    const codec=unicode?'utf-16be':platform===1&&encoding===0?'macintosh':(platform===1&&encoding===1)||(platform===3&&encoding===2)?'shift_jis':null;
    if(!codec)continue;
    const japanese=language>=0x8000?/^ja(?:-|$)/i.test(tags[language-0x8000]??''):platform===3?language===0x411:platform===1&&language===11;
    const english=language>=0x8000?/^en(?:-|$)/i.test(tags[language-0x8000]??''):platform===3?language===0x409:platform===1&&language===0;
    const text=decodeName(bytes(storage+view.getUint16(at+10),view.getUint16(at+8)),codec);
    if(text)records.push({id,text,japanese,english,unicode});
  }
  return records;
}

function preferredName(records:FontNameRecord[],id:number,japaneseOnly=false):string|undefined {
  return records.filter(name=>name.id===id&&(!japaneseOnly||name.japanese))
    .sort((a,b)=>Number(b.japanese)-Number(a.japanese)||Number(b.english)-Number(a.english)||Number(b.unicode)-Number(a.unicode))[0]?.text;
}

function namedVariableWeights(view:DataView,records:FontNameRecord[]):FontWeightOption[] {
  if(view.byteLength<16||view.getUint16(0)!==1)return [];
  const offset=view.getUint16(4),axisCount=view.getUint16(8),axisSize=view.getUint16(10),instanceCount=view.getUint16(12),instanceSize=view.getUint16(14);
  const instances=offset+axisCount*axisSize;
  if(axisSize<20||instanceSize<4+axisCount*4||instances+instanceCount*instanceSize>view.byteLength)return [];
  const axes=Array.from({length:axisCount},(_,i)=>({tag:view.getUint32(offset+i*axisSize),value:view.getInt32(offset+i*axisSize+8)/65536}));
  const weightAxis=axes.findIndex(axis=>axis.tag===0x77676874);if(weightAxis<0)return [];
  const result:FontWeightOption[]=[];
  for(let i=0;i<instanceCount;i++){
    const at=instances+i*instanceSize,label=preferredName(records,view.getUint16(at));
    if(!label||axes.some((axis,j)=>j!==weightAxis&&view.getInt32(at+4+j*4)/65536!==axis.value))continue;
    const value=view.getInt32(at+4+weightAxis*4)/65536;
    if(Number.isInteger(value)&&value>=1&&value<=1000)result.push({value,label});
  }
  return result;
}

/** Read only SFNT metadata tables, keeping large glyph data out of JS memory. */
export async function readFontFaceMetadata(blob:Blob,family:string,postscriptName?:string):Promise<FontFaceMetadata> {
  const read=async(offset:number,length:number)=>{
    if(offset<0||offset+length>blob.size)throw new RangeError('Invalid font table');
    return new DataView(await blob.slice(offset,offset+length).arrayBuffer());
  };
  try{
    const header=await read(0,12),collection=header.getUint32(0)===0x74746366;
    let offsets=[0];
    if(collection){
      const count=header.getUint32(8);
      if(count>1024)return {};
      const index=await read(12,count*4);offsets=Array.from({length:count},(_,i)=>index.getUint32(i*4));
    }
    for(const offset of offsets){
      const face=await read(offset,12),signature=face.getUint32(0);
      if(![0x00010000,0x4f54544f,0x74727565].includes(signature))continue;
      const count=face.getUint16(4),tables=await read(offset+12,count*16);
      const table=async(tag:number,maxLength=1024*1024)=>{
        for(let i=0;i<count;i++){const at=i*16;if(tables.getUint32(at)!==tag)continue;const length=tables.getUint32(at+12);return length<=maxLength?read(tables.getUint32(at+8),length):undefined;}
      };
      const naming=await table(0x6e616d65);if(!naming)continue;
      const records=nameRecords(naming);
      if(collection&&postscriptName&&!records.some(name=>name.id===6&&name.text===postscriptName))continue;
      // Match the API family first: extended families and weight-specific families must stay distinct.
      const ids=[16,1].filter(id=>records.some(name=>name.id===id&&name.text===family));
      if(collection&&!postscriptName&&!ids.length)continue;
      const familyIds=ids.length?ids:[16,1],result:FontFaceMetadata={};
      result.displayName=familyIds.map(id=>preferredName(records,id,true)).find(Boolean);
      result.styleName=preferredName(records,familyIds[0]===16?17:2)??preferredName(records,2);
      const metrics=await table(0x4f532f32);
      if(metrics&&metrics.byteLength>=64){
        const weight=metrics.getUint16(4),width=metrics.getUint16(6);
        if(weight>=1&&weight<=1000)result.weight=weight;
        if(width>=1&&width<=9)result.width=width;
        result.italic=Boolean(metrics.getUint16(62)&0x201);
      }
      const variable=await table(0x66766172);if(variable)result.namedWeights=namedVariableWeights(variable,records);
      return result;
    }
  }catch{/* An unreadable font keeps its browser-provided family name. */}
  return {};
}
