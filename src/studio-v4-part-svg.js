// Independent vector SVG package for each instrument part.
// This does not claim to generate or validate vector PDF files.
import JSZip from 'jszip';
import {baseScoreName,safeFileName} from './part-export.js';
import {inspectPrintableSvg} from './studio-v4-svg-inspect.js';

const MAX_PAGES=80,MAX_CHARS=35*1024*1024;
export async function createPartSvgZip({pages,filename='score.musicxml',onProgress=()=>{}}={}){
  if(!Array.isArray(pages)||pages.length<1||pages.length>MAX_PAGES)
    throw new Error('파트별 벡터 페이지는 1~80장까지 저장합니다.');
  const zip=new JSZip(),partNumbers=new Map(),pageCounts=new Map();
  let chars=0;
  for(const [index,page] of pages.entries()){
    if(!page||typeof page.partId!=='string'||!page.partId)
      throw new Error('벡터 파일에 파트 식별 정보가 없습니다.');
    inspectPrintableSvg(page.svg);
    const clone=page.svg.cloneNode(true);
    for(const overlay of clone.querySelectorAll('.jwoo-selection-ring,.jwoo-hit-area'))overlay.remove();
    for(const mark of clone.querySelectorAll('.jwoo-note-target,.jwoo-note-selected')){
      mark.classList.remove('jwoo-note-target','jwoo-note-selected','jwoo-measure-selected');
      for(const attr of ['tabindex','role','aria-pressed','aria-label'])mark.removeAttribute(attr);
    }
    clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
    clone.removeAttribute('data-jwoo-editing');
    const xml='<?xml version="1.0" encoding="UTF-8"?>\n'+
      new XMLSerializer().serializeToString(clone);
    chars+=xml.length;
    if(chars>MAX_CHARS)throw new Error('벡터 페이지의 총 출력량이 35MiB를 초과했습니다.');
    if(!partNumbers.has(page.partId))partNumbers.set(page.partId,partNumbers.size+1);
    const pageNumber=(pageCounts.get(page.partId)||0)+1;
    pageCounts.set(page.partId,pageNumber);
    const prefix=String(partNumbers.get(page.partId)).padStart(2,'0');
    const partName=safeFileName(page.partName,'part-'+prefix);
    zip.file(prefix+'-'+partName+'-page-'+String(pageNumber).padStart(2,'0')+'.svg',xml);
    onProgress(index+1,pages.length);
  }
  zip.file('README.txt','J-WOO · Individual part vector SVG pages.\n'+
    'SVG preserves musical vector shapes, not embedded fonts. Check glyphs and pagination.\n'+
    'This ZIP contains SVG, NOT PDF. Use Print / Save as PDF in J-WOO for a vector PDF.\n');
  const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:4}});
  return {blob,filename:baseScoreName(filename)+'-part-svg.zip',
    parts:partNumbers.size,pages:pages.length};
}
