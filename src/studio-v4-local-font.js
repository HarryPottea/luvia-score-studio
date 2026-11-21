// Locally selected TrueType font for Unicode PDF export. No files are
// uploaded or persisted: the user provides a font they are licensed to embed.
// Only safe SFNT/TrueType outlines, Unicode cmap coverage and embeddable rights
// are accepted. The final PDF is checked for real embedded font objects.
const fail=m=>{throw new Error(m);};
const MAX_BYTES=8*1024*1024;
const isInt=(n,lo,hi)=>Number.isSafeInteger(n)&&n>=lo&&n<=hi;
const tag=(bytes,start)=>String.fromCharCode(...bytes.slice(start,start+4));
function tableDirectory(bytes){
  if(bytes.length<32||bytes.length>MAX_BYTES)
    fail('TrueType 글꼴 크기는 8MiB 이하만 지원합니다.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const version=view.getUint32(0,false);
  if(![0x00010000,0x74727565].includes(version))
    fail('OpenType CFF·WOFF 글꼴은 지원하지 않습니다. TrueType 윤곽의 TTF를 선택하세요.');
  const count=view.getUint16(4,false);
  if(!isInt(count,5,128)||12+count*16>bytes.length)
    fail('TrueType 테이블 목록이 올바르지 않습니다.');
  const result=new Map();
  for(let i=0;i<count;i++){
    const offset=12+i*16, name=tag(bytes,offset);
    const from=view.getUint32(offset+8,false),length=view.getUint32(offset+12,false);
    if(result.has(name)||!isInt(from,0,bytes.length)||!isInt(length,0,bytes.length-from))
      fail('TrueType 테이블 범위가 손상됐습니다.');
    result.set(name,{offset:from,length});
  }
  if(!result.has('glyf')||!result.has('cmap')||!result.has('head')||
     !result.has('maxp')||!result.has('hmtx'))
    fail('TrueType 글리프·문자 매핑 표가 누락됐습니다.');
  const rights=result.get('OS/2');
  if(rights&&rights.length>=10){
    const flags=view.getUint16(rights.offset+8,false);
    if(flags&0x0002||flags&0x0100||flags&0x0200)
      fail('글꼴 내장·부분집합 또는 윤곽 출력이 사용권으로 제한되어 PDF 내장을 중단합니다.');
  }
  return {view,tables:result};
}
function cmapSubtables(view,table){
  if(table.length<4)return [];
  const count=view.getUint16(table.offset+2,false),records=[];
  if(count>100||4+count*8>table.length)return [];
  for(let i=0;i<count;i++){
    const off=table.offset+4+i*8,platform=view.getUint16(off,false),
      encoding=view.getUint16(off+2,false),delta=view.getUint32(off+4,false);
    if(![0,3].includes(platform)||platform===3&&![1,10].includes(encoding)||
       delta>table.length-4)continue;
    const where=table.offset+delta,fmt=view.getUint16(where,false);
    if(fmt===4&&where+8<=table.offset+table.length){
      const length=view.getUint16(where+2,false);
      if(length>=24&&where+length<=table.offset+table.length)
        records.push({format:4,offset:where,length,platform,encoding});
    }else if(fmt===12&&where+16<=table.offset+table.length){
      const length=view.getUint32(where+4,false);
      if(length>=16&&where+length<=table.offset+table.length)
        records.push({format:12,offset:where,length,platform,encoding});
    }
  }
  return records.sort((a,b)=>b.format-a.format);
}
function glyphID(view,table,code){
  const {offset,length}=table;
  if(table.format===12){
    const count=view.getUint32(offset+12,false);
    if(count>100000||16+count*12>length)return 0;
    let low=0,high=count-1;
    while(low<=high){
      const mid=(low+high)>>>1,at=offset+16+mid*12;
      const first=view.getUint32(at,false),last=view.getUint32(at+4,false);
      if(code<first)high=mid-1;
      else if(code>last)low=mid+1;
      else return view.getUint32(at+8,false)+(code-first);
    }
    return 0;
  }
  if(code>0xffff)return 0;
  const segCountX2=view.getUint16(offset+6,false),segCount=segCountX2/2;
  if(!Number.isInteger(segCount)||segCount<=0||14+segCount*8+2>length)return 0;
  const end=offset+14,starts=end+segCount*2+2,
    deltas=starts+segCount*2,ranges=deltas+segCount*2;
  let low=0,high=segCount-1;
  while(low<=high){
    const mid=(low+high)>>>1,ending=view.getUint16(end+mid*2,false);
    if(code>ending)low=mid+1;else high=mid-1;
  }
  const i=low;
  if(i>=segCount||code<view.getUint16(starts+i*2,false))return 0;
  const delta=view.getInt16(deltas+i*2,false),
    range=view.getUint16(ranges+i*2,false);
  if(!range)return (code+delta)&0xffff;
  const pos=ranges+i*2+range+2*(code-view.getUint16(starts+i*2,false));
  if(pos+2>offset+length)return 0;
  const mapped=view.getUint16(pos,false);
  return mapped?(mapped+delta)&0xffff:0;
}
export function validateLocalTrueType(bytes,text=''){
  if(!(bytes instanceof Uint8Array)||typeof text!=='string'||text.length>15000)
    fail('로컬 TrueType 데이터 또는 글자 검증 범위를 확인할 수 없습니다.');
  const {view,tables}=tableDirectory(bytes);
  const cmap=cmapSubtables(view,tables.get('cmap'));
  if(!cmap.length)fail('유니코드 cmap이 없는 글꼴입니다.');
  const maxp=tables.get('maxp');
  if(maxp.length<6)fail('글꼴 글리프 수 정보를 읽을 수 없습니다.');
  const glyphCount=view.getUint16(maxp.offset+4,false);
  if(!glyphCount)fail('글꼴에 글리프가 없습니다.');
  const required=[...new Set([...text].map(c=>c.codePointAt(0)))].filter(cp=>cp>=32);
  const missing=required.filter(cp=>!cmap.some(t=>{
    const glyph=glyphID(view,t,cp);return glyph>0&&glyph<glyphCount;
  }));
  if(missing.length)
    fail('TTF에 필요한 글자가 없습니다: '+missing.slice(0,8).map(cp=>
      String.fromCodePoint(cp)).join(''));
  return {validated:true, glyphCount,characters:required.length,
    embeddingRestricted:false, fontQualityCertified:false};
}
export async function readLocalTrueType(file){
  if(!file||typeof file.arrayBuffer!=='function'||
     !isInt(file.size,32,MAX_BYTES)||!String(file.name||'').toLowerCase().endsWith('.ttf'))
    fail('최대 8MiB의 로컬 .ttf 글꼴을 선택해 주세요.');
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(bytes.byteLength!==file.size)fail('선택된 TTF 파일 크기가 변경됐습니다.');
  validateLocalTrueType(bytes);
  return {bytes,name:String(file.name),family:'JWOOLocalVectorFont'};
}
function base64(bytes){
  if(typeof btoa!=='function')fail('PDF 글꼴 내장을 위한 브라우저 인코더가 없습니다.');
  const blocks=[];
  for(let i=0;i<bytes.length;i+=8192)
    blocks.push(String.fromCharCode(...bytes.subarray(i,i+8192)));
  return btoa(blocks.join(''));
}
export function prepareFontSvg(svg,font){
  if(!font?.bytes||svg?.localName!=='svg')
    fail('문자 벡터화를 위한 악보 SVG와 TrueType 글꼴이 없습니다.');
  let text='';
  const targets=[];
  for(const t of svg.querySelectorAll('text')){
    // The fixed J-WOO software credit uses PDF's built-in WinAnsi font.
    // Do not demand that a user-supplied music/lyric TTF contain © or ASCII branding.
    if(t.getAttribute?.('data-jwoo-software-copyright')==='true')continue;
    if(/[^\x00-\x7f]/.test(t.textContent||'')){
      targets.push(t);text+=t.textContent||'';
    }
  }
  validateLocalTrueType(font.bytes,text);
  for(const t of targets){
    for(const n of [t,...t.querySelectorAll('tspan')]){
      n.setAttribute('font-family',font.family);
      n.setAttribute('font-style','normal');
      n.setAttribute('font-weight','normal');
      n.style?.setProperty('font-family',font.family,'important');
      n.style?.setProperty('font-style','normal','important');
      n.style?.setProperty('font-weight','normal','important');
    }
  }
  return {nodes:targets.length,characters:[...text].length,embeddedFontRequired:targets.length>0};
}
export function registerPdfTrueType(pdf,font){
  if(!pdf?.addFileToVFS||!pdf?.addFont||!font?.bytes||!font.family)
    fail('PDF 글꼴 내장 기능을 사용할 수 없습니다.');
  const id='jwoo-local-vector.ttf';
  pdf.addFileToVFS(id,base64(font.bytes));
  pdf.addFont(id,font.family,'normal');
  return {family:font.family,embedded:true,notYetVerified:true};
}
export function assertEmbeddedFontInPdf(bytes){
  const raw=bytes instanceof ArrayBuffer?new Uint8Array(bytes):bytes;
  if(!(raw instanceof Uint8Array)||raw.length<500)
    fail('PDF 파일 형식이 올바르지 않습니다.');
  const s=new TextDecoder('latin1').decode(raw);
  if(!/\/FontFile2\b/.test(s)||!/\/ToUnicode\b/.test(s))
    fail('PDF에 벡터 TrueType 글꼴과 유니코드 매핑이 실제 내장되지 않았습니다.');
  return {fontFilePresent:true,toUnicodePresent:true,visualQualityCertified:false};
}
