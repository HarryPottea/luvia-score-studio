// Local-origin, client-side multi-part vector PDF ZIP for supported SVG pages.
// jsPDF + svg2pdf.js are bundled under public/vendor (MIT); no external IO.
// Unsupported Unicode text fails before conversion rather than silently
// substituting broken glyphs; use native Chromium/Safari print for Korean text.
import JSZip from 'jszip';
import {baseScoreName,safeFileName} from './part-export.js';
import {inspectPrintableSvg} from './studio-v4-svg-inspect.js';
import {rasterizeUnicodeSvgText} from './studio-v4-unicode-svg.js';
import {inspectGeneratedPdfObjects} from './studio-v4-pdf-object-audit.js';
import {readLocalTrueType,prepareFontSvg,registerPdfTrueType,assertEmbeddedFontInPdf} from './studio-v4-local-font.js';
import {FULL_SCORE_EXPORT_ID} from './studio-v4-pdf-export-plan.js';

const MAX_PAGES=80,MAX_PARTS=12,MAX_FILE_BYTES=24*1024*1024;
const FORMAT={A4_P:{w:595.2756,h:841.8898,orientation:'p'},
  A4_L:{w:841.8898,h:595.2756,orientation:'l'}};
let librariesLoading=null;
const fail=message=>{throw new Error(message);};

function localScript(name){
  return new Promise((resolve,reject)=>{
    const tag=document.createElement('script');
    tag.src=new URL('./vendor/'+name,document.baseURI).href;
    tag.async=false;
    tag.onload=()=>resolve();
    tag.onerror=()=>reject(new Error('로컬 PDF 변환 라이브러리를 읽을 수 없습니다: '+name));
    document.head.appendChild(tag);
  });
}
async function loadLibraries(){
  if(typeof document==='undefined'||typeof window==='undefined')
    fail('벡터 PDF 변환은 브라우저에서만 사용할 수 있습니다.');
  if(window.jspdf?.jsPDF?.API?.svg)return window.jspdf.jsPDF;
  if(!librariesLoading){
    librariesLoading=(async()=>{
      if(!window.jspdf?.jsPDF)await localScript('jspdf.umd.min.js');
      if(!window.jspdf?.jsPDF)fail('PDF 문서 생성 기능을 사용할 수 없습니다.');
      if(!window.jspdf.jsPDF.API.svg)await localScript('svg2pdf.umd.min.js');
      if(typeof window.jspdf.jsPDF.API.svg!=='function')
        fail('SVG 벡터 변환 기능을 확인하지 못했습니다.');
      return window.jspdf.jsPDF;
    })().catch(error=>{librariesLoading=null;throw error;});
  }
  return librariesLoading;
}
function nonAsciiText(svg){
  for(const t of svg.querySelectorAll('text,tspan')){
    const v=t.textContent||'';
    // U+00A9 is supported in PDF's basic WinAnsi font encoding.
    if(/[^\x00-\x7f\u00a9]/.test(v))return v.slice(0,30);
  }
  return null;
}
export function preflightVectorPartPages(pages,pageFormat='A4_P',{
  allowUnicodeText=false,requireFullScore=false
}={}){
  if(typeof allowUnicodeText!=='boolean'||typeof requireFullScore!=='boolean')
    fail('PDF 글꼴 또는 전체 악보 출력 설정이 올바르지 않습니다.');
  if(!FORMAT[pageFormat])fail('벡터 PDF는 A4 세로·가로 규격만 지원합니다.');
  if(!Array.isArray(pages)||pages.length<1||pages.length>MAX_PAGES)
    fail('파트별 PDF 출력은 1~80페이지로 제한합니다.');
  const order=[],groups=new Map();
  let fullScorePages=0,fullScoreEnded=false;
  for(const page of pages){
    if(!page||typeof page.partId!=='string'||!page.partId||
      typeof page.partName!=='string'||!page.partName)
      fail('파트 ID와 이름을 확인할 수 없습니다.');
    const isScore=page.partId===FULL_SCORE_EXPORT_ID;
    if(isScore){
      if(!requireFullScore||fullScoreEnded||order.length&&order[0]!==FULL_SCORE_EXPORT_ID)
        fail('전체 악보 PDF는 가장 먼저 연속된 페이지로 작성해야 합니다.');
      fullScorePages++;
    }else fullScoreEnded=true;
    inspectPrintableSvg(page.svg);
    const unusual=nonAsciiText(page.svg);
    if(unusual!==null&&!allowUnicodeText)
      fail('이 벡터 PDF ZIP은 한글·특수문자 글꼴을 내장하지 않습니다. 손상 방지를 위해 중단했습니다. 브라우저의 벡터 PDF 인쇄를 사용하거나 하이브리드 텍스트 옵션을 켜세요.');
    if(!groups.has(page.partId)){
      if(groups.size>=(requireFullScore?MAX_PARTS+1:MAX_PARTS))
        fail('PDF ZIP은 전체 악보와 최대 12개 파트까지 지원합니다.');
      groups.set(page.partId,{name:page.partName,pages:[]});
      order.push(page.partId);
    }else if(groups.get(page.partId).name!==page.partName)
      fail('동일 파트의 이름이 출력 중 변경됐습니다.');
    groups.get(page.partId).pages.push(page.svg);
    if(groups.get(page.partId).pages.length>24)
      fail('개별 악기의 PDF 페이지가 24장을 초과합니다.');
  }
  if(requireFullScore&&(fullScorePages<1||groups.size<2||order[0]!==FULL_SCORE_EXPORT_ID))
    fail('전체 악보와 개별 파트 PDF가 모두 필요합니다.');
  return {order,groups,pageFormat,parts:groups.size-(requireFullScore?1:0),
    pages:pages.length,fullScoreIncluded:requireFullScore,fullScorePages,
    vectorIntent:true,textFontCertified:false,allowUnicodeText};
}
function stripEditing(svg){
  const clone=svg.cloneNode(true);
  for(const overlay of clone.querySelectorAll('.jwoo-selection-ring,.jwoo-hit-area'))
    overlay.remove();
  for(const target of clone.querySelectorAll('.jwoo-note-target,.jwoo-rest-target,.jwoo-note-selected,.jwoo-measure-selected,.jwoo-playback-active')){
    target.classList.remove('jwoo-note-target','jwoo-rest-target','jwoo-note-selected','jwoo-measure-selected','jwoo-playback-active');
    for(const key of ['role','tabindex','aria-label','aria-pressed'])target.removeAttribute(key);
  }
  return clone;
}
function assertPdf(bytes){
  if(!(bytes instanceof ArrayBuffer)||bytes.byteLength<500||bytes.byteLength>MAX_FILE_BYTES)
    fail('생성된 PDF가 비어 있거나 크기 제한을 초과했습니다.');
  const prefix=new TextDecoder('ascii').decode(new Uint8Array(bytes,0,Math.min(8,bytes.byteLength)));
  if(!prefix.startsWith('%PDF-'))fail('PDF 파일 헤더가 올바르지 않습니다.');
}
export async function createVectorPartPdfZip({
  pages,filename='score.musicxml',pageFormat='A4_P',allowUnicodeText=false,
  fontFile=null,includeFullScore=false,onProgress=()=>{}
}={}){
  const localFont=fontFile?await readLocalTrueType(fontFile):null;
  const plan=preflightVectorPartPages(pages,pageFormat,{
    allowUnicodeText:allowUnicodeText||!!localFont,requireFullScore:includeFullScore
  });
  const jsPDF=await loadLibraries();
  const format=FORMAT[pageFormat],zip=new JSZip();
  let count=0,bytes=0,hybridTextCount=0,embeddedVectorTextCount=0;
  for(const [index,id] of plan.order.entries()){
    const part=plan.groups.get(id);
    // A new PDF per part; all SVG measures are rendered into vector pages.
    let pdf=null,fontRegistered=false,partVectorTextCount=0;
    for(const [pageIndex,svg] of part.pages.entries()){
      if(!pdf)pdf=new jsPDF({
        orientation:format.orientation,unit:'pt',format:[format.w,format.h],
        compress:true,putOnlyUsedFonts:true
      });
      else pdf.addPage([format.w,format.h],format.orientation);
      const clone=stripEditing(svg);
      const pathCount=clone.querySelectorAll('path,rect,line,polyline,polygon,circle,ellipse').length;
      if(!pathCount)fail('벡터 음악 기호가 없는 페이지는 파트별 PDF로 내보내지 않습니다.');
      if(nonAsciiText(clone)!==null&&localFont){
        if(!fontRegistered){registerPdfTrueType(pdf,localFont);fontRegistered=true;}
        const vectorized=prepareFontSvg(clone,localFont);
        partVectorTextCount+=vectorized.nodes;
        embeddedVectorTextCount+=vectorized.nodes;
        inspectPrintableSvg(clone);
      }else if(nonAsciiText(clone)!==null&&allowUnicodeText){
        const converted=await rasterizeUnicodeSvgText(clone);
        hybridTextCount+=converted.rasterizedTextCount;
        // The only image elements were generated from local glyph snapshots
        // after the original SVG passed the external-resource preflight.
      }else inspectPrintableSvg(clone);
      await pdf.svg(clone,{x:0,y:0,width:format.w,height:format.h});
      onProgress(++count,plan.pages);
    }
    const buffer=pdf.output('arraybuffer');
    assertPdf(buffer);
    inspectGeneratedPdfObjects(buffer,{
      expectedPages:part.pages.length,w:format.w,h:format.h,
      imagesAllowed:allowUnicodeText&&!localFont
    });
    if(partVectorTextCount)assertEmbeddedFontInPdf(buffer);
    bytes+=buffer.byteLength;
    if(bytes>MAX_FILE_BYTES)fail('파트 PDF 총용량이 24MiB를 초과했습니다.');
    const isScore=id===FULL_SCORE_EXPORT_ID;
    const ordinal=String(isScore?0:(includeFullScore?index:index+1)).padStart(2,'0');
    zip.file(isScore?'00-Full-Score.pdf':
      ordinal+'-'+safeFileName(part.name,'part-'+ordinal)+'.pdf',buffer);
  }
  zip.file('README.txt',
    'J-WOO '+(includeFullScore?'full score and ':'')+'part PDFs converted locally from OSMD SVG. No uploads. A4.\n'+
    (embeddedVectorTextCount?'EMBEDDED TTF: '+embeddedVectorTextCount+
      ' Unicode text nodes use the locally selected TrueType font. Font licensing and visual quality require review.\n':
      hybridTextCount?'HYBRID: '+hybridTextCount+
      ' Unicode text nodes are local PNG glyphs; music vector paths remain vector.\n':
      'ASCII-only PDF font mode.\n')+
    'Verify all glyphs and layout in PDF before distributing.\n'+
    'For entirely native text/print fonts, use the browser vector PDF print option.\n');
  const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',
    compressionOptions:{level:5}});
  return {blob,filename:baseScoreName(filename)+(includeFullScore?
      '-full-score-and-parts-pdfs.zip':'-vector-part-pdfs.zip'),
    parts:plan.parts,pages:plan.pages,fullScoreIncluded:plan.fullScoreIncluded,
    fullScorePages:plan.fullScorePages,vectorStaffIntended:true,
    hybridTextCount,embeddedVectorTextCount,
    vectorFontEmbedded:embeddedVectorTextCount>0,glyphVerificationRequired:true,
    unicodeExportSupported:hybridTextCount>0||embeddedVectorTextCount>0};
}
