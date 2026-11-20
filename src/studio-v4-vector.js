// Vector score pages for print providers. Unlike the legacy JPEG-based PDF ZIP,
// SVG pages preserve strokes and text objects. Browser printing remains the
// recommended path for a vector PDF with embedded system fonts.
import JSZip from 'jszip';
import {baseScoreName} from './part-export.js';
const MAX_PAGES=80,MAX_BYTES=35*1024*1024;
export async function createVectorPageZip({svgs,filename='score.musicxml',onProgress=()=>{}}={}){
  if(!Array.isArray(svgs)||!svgs.length||svgs.length>MAX_PAGES)
    throw new Error('벡터 페이지는 1~80장까지 저장할 수 있습니다.');
  const zip=new JSZip();let bytes=0;
  for(let i=0;i<svgs.length;i++){
    const node=svgs[i];
    if(!node||node.localName!=='svg')throw new Error('SVG 악보 페이지를 찾지 못했습니다.');
    const clone=node.cloneNode(true);
    // Editing-only overlays must never be burned into exported score pages.
    for(const overlay of clone.querySelectorAll('.jwoo-selection-ring,.jwoo-hit-area'))overlay.remove();
    for(const mark of clone.querySelectorAll('.jwoo-note-target,.jwoo-rest-target,.jwoo-note-selected,.jwoo-measure-selected,.jwoo-playback-active')){
      mark.classList.remove('jwoo-note-target','jwoo-rest-target','jwoo-note-selected','jwoo-measure-selected','jwoo-playback-active');
      for(const attr of ['tabindex','role','aria-pressed','aria-label'])mark.removeAttribute(attr);
    }
    clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
    clone.removeAttribute('data-jwoo-editing');
    const xml='<?xml version="1.0" encoding="UTF-8"?>\n'+new XMLSerializer().serializeToString(clone);
    if(/<(?:script|foreignObject)\b|@import\b|url\(\s*['"]?(?:https?:|\/\/)|\bhref\s*=\s*['"](?:https?:|\/\/)/i.test(xml))
      throw new Error('외부 리소스를 참조하는 SVG는 출력을 차단합니다.');
    bytes+=xml.length;
    if(bytes>MAX_BYTES)throw new Error('벡터 출력이 35MiB를 초과했습니다.');
    zip.file(baseScoreName(filename)+'-page-'+String(i+1).padStart(2,'0')+'.svg',xml);
    onProgress(i+1,svgs.length);
  }
  zip.file('README.txt',
    'J-WOO vector SVG score pages.\n'+
    'These SVG files retain vector paths but not embedded fonts. Verify glyphs and print layout before publishing.\n'+
    'Use the J-WOO browser Print / Save as PDF button for a direct PDF workflow.\n');
  return zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:4}});
}
