import JSZip from 'jszip';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { applyLayoutPreset } from './layout-profile.js';
import { baseScoreName, safeFileName } from './part-export.js';

const enc = new TextEncoder();
const A4 = { A4_P: [595.28, 841.89], A4_L: [841.89, 595.28] };
const MAX_PARTS = 12, MAX_PAGES_PER_PART = 14, MAX_TOTAL_PAGES = 80;

/** Small PDF 1.4 writer with one 8-bit RGB JPEG per physical A4 page. No external PDF services. */
export function makePdfFromJpegPages(pages, pageFormat='A4_P') {
  if (!Array.isArray(pages) || !pages.length || pages.length>MAX_TOTAL_PAGES || !A4[pageFormat]) throw new Error('PDF 페이지 정보가 올바르지 않습니다.');
  let bytes=0;
  for (const p of pages) {
    if (!(p.jpeg instanceof Uint8Array) || !p.jpeg.length || !Number.isSafeInteger(p.width) || !Number.isSafeInteger(p.height) || p.width<=0 || p.height<=0) throw new Error('PDF 이미지 데이터가 올바르지 않습니다.');
    bytes+=p.jpeg.length;
  }
  if(bytes>70*1024*1024) throw new Error('PDF 결과가 너무 큽니다.');
  const chunks=[], offsets=[0]; let position=0;
  function add(buffer) { const b=typeof buffer==='string'?enc.encode(buffer):buffer; chunks.push(b);position+=b.length; }
  function object(id, pieces) { offsets[id]=position; add(`${id} 0 obj\n`); for(const piece of pieces) add(piece); add('\nendobj\n'); }
  add(enc.encode('%PDF-1.4\n')); add(new Uint8Array([37,226,227,207,211,10]));
  object(1,['<< /Type /Catalog /Pages 2 0 R >>']);
  const ids=pages.map((_,i)=>3+i*3);
  object(2,[`<< /Type /Pages /Count ${pages.length} /Kids [${ids.map(id=>`${id} 0 R`).join(' ')}] >>`]);
  const [W,H]=A4[pageFormat];
  for (let i=0;i<pages.length;i++){
    const p=pages[i],id=ids[i],imageId=id+1,contentId=id+2;
    object(id,[`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`]);
    object(imageId,[`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,p.jpeg,'\nendstream']);
    const command=`q\n${W} 0 0 ${H} 0 0 cm\n/Im0 Do\nQ\n`;
    object(contentId,[`<< /Length ${enc.encode(command).length} >>\nstream\n`,command,'endstream']);
  }
  const xref=position;
  const count=3+pages.length*3;
  add(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for(let id=1;id<count;id++) add(`${String(offsets[id]).padStart(10,'0')} 00000 n \n`);
  add(`trailer\n<< /Root 1 0 R /Size ${count} >>\nstartxref\n${xref}\n%%EOF\n`);
  const out=new Uint8Array(position);let offset=0;
  for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length;}
  return out;
}

function singlePartDoc(source, partId) {
  const doc=source.cloneNode(true);
  const list=doc.documentElement.querySelector('part-list');
  const parts=[...doc.documentElement.children].filter(x=>x.localName==='part');
  for(const part of parts) if(part.getAttribute('id')!==partId) part.remove();
  if(list) for(const item of [...list.children]) if(item.localName==='part-group' || (item.localName==='score-part' && item.getAttribute('id')!==partId)) item.remove();
  if(![...doc.documentElement.children].some(x=>x.localName==='part')) throw new Error('악보 파트를 찾지 못했습니다.');
  return doc;
}

async function svgToJpeg(svg,pageFormat) {
  const svgSource=new XMLSerializer().serializeToString(svg);
  if(/<image\b/i.test(svgSource) || /(?:href|url)\s*=\s*["']https?:/i.test(svgSource)) throw new Error('외부 이미지가 포함된 악보는 자동 PDF로 출력할 수 없습니다.');
  const blob=new Blob([svgSource],{type:'image/svg+xml;charset=utf-8'});
  const src=URL.createObjectURL(blob);
  try {
    const img=await new Promise((resolve,reject)=>{
      const value=new Image();value.onload=()=>resolve(value);value.onerror=()=>reject(new Error('악보 이미지 변환에 실패했습니다.'));value.src=src;
    });
    const landscape=pageFormat==='A4_L';
    const width=landscape?1654:1170,height=landscape?1170:1654;
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d',{alpha:false});
    if(!context) throw new Error('PDF 이미지 처리를 지원하지 않는 브라우저입니다.');
    context.fillStyle='#fff';context.fillRect(0,0,width,height);
    const iw=img.naturalWidth||width,ih=img.naturalHeight||height;
    const ratio=Math.min(width/iw,height/ih);
    context.drawImage(img,(width-iw*ratio)/2,(height-ih*ratio)/2,iw*ratio,ih*ratio);
    const jpg=await new Promise((resolve,reject)=>canvas.toBlob(data=>data?resolve(data):reject(new Error('PDF 페이지 이미지 저장 실패')),'image/jpeg',0.9));
    canvas.width=0;canvas.height=0;
    if(jpg.type!=='image/jpeg') throw new Error('이 브라우저는 JPEG 페이지 저장을 지원하지 않습니다.');
    return {jpeg:new Uint8Array(await jpg.arrayBuffer()),width,height};
  } finally {URL.revokeObjectURL(src);}
}

async function renderPdfPages(doc,format,layout,measureNumbers) {
  const holder=document.createElement('div');
  holder.style.cssText=`position:fixed;left:-100000px;top:0;visibility:hidden;width:${format==='A4_L'?1123:794}px;background:white;pointer-events:none;`;
  document.body.append(holder);
  let osmd;
  try {
    osmd=new OpenSheetMusicDisplay(holder,{autoResize:false,backend:'svg',drawTitle:true,drawComposer:true,drawMeasureNumbers:measureNumbers,pageFormat:format});
    osmd.zoom=1;
    await osmd.load(doc);
    applyLayoutPreset(osmd,layout,doc);
    osmd.render();
    const svgs=[...holder.querySelectorAll('svg')];
    if(!svgs.length || svgs.length>MAX_PAGES_PER_PART) throw new Error('악보 페이지 수가 지원 범위를 벗어났습니다.');
    const pages=[];
    for(const svg of svgs) pages.push(await svgToJpeg(svg,format));
    return pages;
  } finally {
    try {osmd?.clear?.();} catch {}
    holder.remove();
  }
}

/** All-or-nothing batch export. If even one part fails, no ZIP download is produced. */
export async function createPartPdfZip({doc,parts,scoreFilename,pageFormat='A4_P',layout='auto',measureNumbers=true,onProgress}) {
  if(!A4[pageFormat] || !Array.isArray(parts) || parts.length===0 || parts.length>MAX_PARTS) throw new Error(`PDF 일괄 출력은 최대 ${MAX_PARTS}개 파트까지 지원합니다.`);
  const zip=new JSZip(); let pageCount=0;
  for(const [i,part] of parts.entries()) {
    onProgress?.(`${i+1}/${parts.length} · ${part.name} 악보 렌더링`);
    const partDoc=singlePartDoc(doc,part.id);
    const pages=await renderPdfPages(partDoc,pageFormat,layout,measureNumbers);
    pageCount+=pages.length;
    if(pageCount>MAX_TOTAL_PAGES) throw new Error('전체 PDF 페이지 수가 너무 많습니다. 파트를 나누어 출력해 주세요.');
    const pdf=makePdfFromJpegPages(pages,pageFormat);
    const name=`${baseScoreName(scoreFilename)}-${String(i+1).padStart(2,'0')}-${safeFileName(part.name)}.pdf`;
    zip.file(name,pdf);
  }
  onProgress?.('PDF 압축 파일 만들기');
  const blob=await zip.generateAsync({type:'blob',compression:'STORE'});
  return {blob,partCount:parts.length,pageCount};
}
