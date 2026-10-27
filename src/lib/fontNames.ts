type FontNameRecord={id:number;text:string;japanese:boolean;unicode:boolean};

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
    if(![1,6,16].includes(id))continue;
    const unicode=platform===0||platform===3&&(encoding===0||encoding===1||encoding===10);
    const codec=unicode?'utf-16be':platform===1&&encoding===0?'macintosh':(platform===1&&encoding===1)||(platform===3&&encoding===2)?'shift_jis':null;
    if(!codec)continue;
    const japanese=language>=0x8000?/^ja(?:-|$)/i.test(tags[language-0x8000]??''):platform===3?language===0x411:platform===1&&language===11;
    const text=decodeName(bytes(storage+view.getUint16(at+10),view.getUint16(at+8)),codec);
    if(text)records.push({id,text,japanese,unicode});
  }
  return records;
}

/** Read only SFNT directories/name tables, keeping large glyph data out of JS memory. */
export async function readJapaneseFontFamily(blob:Blob,family:string,postscriptName?:string):Promise<string|undefined> {
  const read=async(offset:number,length:number)=>{
    if(offset<0||offset+length>blob.size)throw new RangeError('Invalid font table');
    return new DataView(await blob.slice(offset,offset+length).arrayBuffer());
  };
  try{
    const header=await read(0,12),collection=header.getUint32(0)===0x74746366;
    let offsets=[0];
    if(collection){
      const count=header.getUint32(8);
      if(count>1024)return;
      const index=await read(12,count*4);offsets=Array.from({length:count},(_,i)=>index.getUint32(i*4));
    }
    for(const offset of offsets){
      const face=await read(offset,12),signature=face.getUint32(0);
      if(![0x00010000,0x4f54544f,0x74727565].includes(signature))continue;
      const count=face.getUint16(4),tables=await read(offset+12,count*16);
      for(let i=0;i<count;i++){
        const at=i*16;if(tables.getUint32(at)!==0x6e616d65)continue;
        const length=tables.getUint32(at+12);if(length>1024*1024)return;
        const records=nameRecords(await read(tables.getUint32(at+8),length));
        if(collection&&postscriptName&&!records.some(name=>name.id===6&&name.text===postscriptName))continue;
        // Match the API family first: extended families and weight-specific families must stay distinct.
        const ids=[16,1].filter(id=>records.some(name=>name.id===id&&name.text===family));
        if(collection&&!postscriptName&&!ids.length)continue;
        for(const id of ids.length?ids:[16,1]){
          const candidates=records.filter(name=>name.id===id&&name.japanese).sort((a,b)=>Number(b.unicode)-Number(a.unicode));
          if(candidates.length)return candidates[0].text;
        }
      }
    }
  }catch{/* An unreadable font keeps its browser-provided family name. */}
}
