// Local-origin, client-side multi-part vector PDF ZIP for supported SVG pages.
// jsPDF + svg2pdf.js are bundled under public/vendor (MIT); no external IO.
// Unsupported Unicode text fails before conversion rather than silently
// substituting broken glyphs; use native Chromium/Safari print for Korean text.
import JSZip from 'jszip';
import {baseScoreName,safeFileName} from './part-export.js';
import {inspectPrintableSvg} from './studio-v4-svg-inspect.js';

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
    if(/[^\x00-\x7f]/.test(v))return v.slice(0,30);
  }
  return null;
}
export function preflightVectorPartPages(pages,pageFormat='A4_P'){
  if(!FORMAT[pageFormat])fail('벡터 PDF는 A4 세로·가로 규격만 지원합니다.');
  if(!Array.isArray(pages)||pages.length<1||pages.length>MAX_PAGES)
    fail('파트별 PDF 출력은 1~80페이지로 제한합니다.');
  const order=[],groups=new Map();
  for(const page of pages){
    if(!page||typeof page.partId!=='string'||!page.partId||
      typeof page.partName!=='string'||!page.partName)
      fail('파트 ID와 이름을 확인할 수 없습니다.');
    inspectPrintableSvg(page.svg);
    const unusual=nonAsciiText(page.svg);
    if(unusual!==null)
      fail('현재 벡터 ZIP 변환은 한글·특수문자 글꼴을 내장하지 않습니다. 해당 가사·제목을 보호하기 위해 변환을 중단했습니다. \"모든 파트 벡터 악보 인쇄 · PDF로 저장\"을 사용하세요.');
    if(!groups.has(page.partId)){
      if(groups.size>=MAX_PARTS)fail('PDF ZIP은 최대 12개 파트까지 지원합니다.');
      groups.set(page.partId,{name:page.partName,pages:[]});
      order.push(page.partId);
    }
    groups.get(page.partId).pages.push(page.svg);
    if(groups.get(page.partId).pages.length>24)
      fail('개별 악기의 PDF 페이지가 24장을 초과합니다.');
  }
  return {order,groups,pageFormat,parts:groups.size,pages:pages.length,
    vectorIntent:true,textFontCertified:false};
}
function stripEditing(svg){
  const clone=svg.cloneNode(true);
  for(const overlay of clone.querySelectorAll('.jwoo-selection-ring,.jwoo-hit-area'))
    overlay.remove();
  for(const target of clone.querySelectorAll('.jwoo-note-target,.jwoo-note-selected,.jwoo-measure-selected')){
    target.classList.remove('jwoo-note-target','jwoo-note-selected','jwoo-measure-selected');
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
  pages,filename='score.musicxml',pageFormat='A4_P',
  onProgress=()=>{}
}={}){
  const plan=preflightVectorPartPages(pages,pageFormat);
  const jsPDF=await loadLibraries();
  const format=FORMAT[pageFormat],zip=new JSZip();
  let count=0,bytes=0;
  for(const [index,id] of plan.order.entries()){
    const part=plan.groups.get(id);
    // A new PDF per part; all SVG measures are rendered into vector pages.
    let pdf=null;
    for(const [pageIndex,svg] of part.pages.entries()){
      if(!pdf)pdf=new jsPDF({
        orientation:format.orientation,unit:'pt',format:[format.w,format.h],
        compress:true,putOnlyUsedFonts:true
      });
      else pdf.addPage([format.w,format.h],format.orientation);
      const clone=stripEditing(svg);
      inspectPrintableSvg(clone);
      await pdf.svg(clone,{x:0,y:0,width:format.w,height:format.h});
      onProgress(++count,plan.pages);
    }
    const buffer=pdf.output('arraybuffer');
    assertPdf(buffer);
    bytes+=buffer.byteLength;
    if(bytes>MAX_FILE_BYTES)fail('파트 PDF 총용량이 24MiB를 초과했습니다.');
    const ordinal=String(index+1).padStart(2,'0');
    zip.file(ordinal+'-'+safeFileName(part.name,'part-'+ordinal)+'.pdf',buffer);
  }
  zip.file('README.txt',
    'J-WOO part PDFs converted locally from OSMD SVG to vector PDF paths.\n'+
    'The source score was not uploaded. Paper: A4. Font validation: NOT CERTIFIED.\n'+
    'These PDFs are for supported ASCII-only notation. Verify every glyph, '+ 
    'lyric, barline and page before distribution.\n'+
    'For Korean text or exact browser font output, use the native vector Print/PDF option.\n');
  const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',
    compressionOptions:{level:5}});
  return {blob,filename:baseScoreName(filename)+'-vector-part-pdfs.zip',
    parts:plan.parts,pages:plan.pages,vector:true,
    glyphVerificationRequired:true,unicodeExportSupported:false};
}
