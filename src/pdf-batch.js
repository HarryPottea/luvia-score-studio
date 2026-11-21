import JSZip from 'jszip';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { applyLayoutPreset } from './layout-profile.js';
import { applyFixedA4Profile, fixedA4Profile } from './a4-engraving.js';
import { baseScoreName, safeFileName } from './part-export.js';
import { makePdfFromJpegPages } from './pdf-bytes.js';
import {stampSoftwareCopyright} from './studio-v4-software-copyright.js';

const A4 = { A4_P: [595.28, 841.89], A4_L: [841.89, 595.28] };
const MAX_PARTS = 12, MAX_PAGES_PER_PART = 14, MAX_TOTAL_PAGES = 80;

/** Small PDF 1.4 writer with one 8-bit RGB JPEG per physical A4 page. No external PDF services. */

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
  if(/<(?:image|script|foreignObject)\b|@import\b|url\(\s*['\"]?(?:https?:|\/\/)|\bhref\s*=\s*['\"](?:https?:|\/\/)/i.test(svgSource)) throw new Error('외부 파일 참조 또는 지원하지 않는 SVG 요소가 있어 자동 PDF를 차단했습니다.');
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
  const profile=fixedA4Profile(doc,format);
  holder.style.cssText=`position:fixed;left:-100000px;top:0;visibility:hidden;width:${profile.pageWidthPx}px;max-width:none;background:white;pointer-events:none;`;
  document.body.append(holder);
  let osmd;
  try {
    osmd=new OpenSheetMusicDisplay(holder,{autoResize:false,backend:'svg',drawTitle:true,drawComposer:true,drawMeasureNumbers:measureNumbers,pageFormat:format});
    await osmd.load(doc);
    applyFixedA4Profile(osmd,doc,format);
    applyLayoutPreset(osmd,layout,doc);
    osmd.render();
    const svgs=[...holder.querySelectorAll('svg')];
    if(!svgs.length || svgs.length>MAX_PAGES_PER_PART) throw new Error('악보 페이지 수가 지원 범위를 벗어났습니다.');
    stampSoftwareCopyright(svgs,format);
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
