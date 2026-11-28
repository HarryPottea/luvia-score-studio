// J-WOO vector print book: render each individual part with local OSMD
// and hand the resulting live SVG pages to the browser's native print-to-PDF.
// No new npm dependencies, no raster/JPEG conversion, no server upload.
import {OpenSheetMusicDisplay} from 'opensheetmusicdisplay';
import {editableScoreRenderOptions} from './osmd-render-policy.js';
import {applySymbolOffsets} from './studio-v4-symbol-position.js';
import {applyLayoutPreset} from './layout-profile.js';
import {renderWithCadenceRepair} from './studio-v4-layout-cadence.js';
import {applyFixedA4Profile,fixedA4Profile} from './a4-engraving.js';
import {inspectPrintableSvg} from './studio-v4-svg-inspect.js';
import {adaptLyricRendering} from './studio-v4-lyric-spacing-audit.js';
import {adaptExpressionRendering,inspectSvgExpressionSpacing} from './studio-v4-expression-spacing-audit.js';
import {inspectSvgPageBounds} from './studio-v4-page-bounds.js';
import {FULL_SCORE_EXPORT_ID,prepareScoreAndPartExport} from './studio-v4-pdf-export-plan.js';
import {stampSoftwareCopyright} from './studio-v4-software-copyright.js';

const FORMATS={A4_P:{w:'210mm',h:'297mm'},A4_L:{w:'297mm',h:'210mm'}};
const MAX_PARTS=12,MAX_PAGES=80,MAX_PART_PAGES=24;
const direct=(n,t)=>n?[...n.children].find(x=>x.localName===t)||null:null;
const partsOf=doc=>[...doc.documentElement.children].filter(x=>x.localName==='part');
export function partOnlyDocument(source,partId){
  if(source?.documentElement?.localName!=='score-partwise'||typeof partId!=='string')
    throw new Error('파트별 인쇄는 MusicXML partwise 악보만 지원합니다.');
  const document=source.cloneNode(true);
  const part=partsOf(document).find(p=>p.getAttribute('id')===partId);
  if(!part)throw new Error('인쇄할 악기 파트를 찾지 못했습니다.');
  for(const p of partsOf(document))if(p!==part)p.remove();
  const partList=direct(document.documentElement,'part-list');
  if(partList)for(const node of [...partList.children]){
    if(node.localName==='part-group'||node.localName==='score-part'&&node.getAttribute('id')!==partId)
      node.remove();
  }
  return document;
}
export {inspectPrintableSvg} from './studio-v4-svg-inspect.js';
export async function renderPartSvgPages({doc,parts,pageFormat='A4_P',layout='auto',measureNumbers=true,
  onProgress=()=>{}}={}){
  const fullScore=parts?.[0]?.id===FULL_SCORE_EXPORT_ID&&parts[0].fullScore===true;
  if(!FORMATS[pageFormat]||!Array.isArray(parts)||parts.length<1||
     parts.length>(fullScore?MAX_PARTS+1:MAX_PARTS)||
     parts.slice(fullScore?1:0).some(p=>p?.id===FULL_SCORE_EXPORT_ID||p?.fullScore))
    throw new Error('벡터 악보 출력은 A4 규격에서 전체 악보와 최대 12개 파트를 지원합니다.');
  if(fullScore)prepareScoreAndPartExport(doc,parts.slice(1));
  const output=[],lyricAudits=[],boundsAudits=[],expressionAudits=[];
  for(const [index,p] of parts.entries()){
    if(!p||typeof p.id!=='string'||!p.id)throw new Error('인쇄 파트를 선택해 주세요.');
    // A reserved virtual group renders the original concert/full score;
    // ordinary groups retain their existing, independently formatted parts.
    const partDoc=fullScore&&index===0?doc.cloneNode(true):partOnlyDocument(doc,p.id);
    const expectedLyrics=[...partDoc.querySelectorAll('note > lyric > text')]
      .filter(n=>String(n.textContent||'').trim()).length;
    const holder=document.createElement('div');
    const profile=fixedA4Profile(partDoc,pageFormat);
    holder.style.cssText='position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;'+
      'width:'+profile.pageWidthPx+'px;max-width:none;background:white;';
    document.body.appendChild(holder);
    let osmd=null;
    try{
      osmd=new OpenSheetMusicDisplay(holder,editableScoreRenderOptions({
        autoResize:false,backend:'svg',drawTitle:true,drawComposer:true,
        drawMeasureNumbers:measureNumbers,pageFormat,
      }));
      await osmd.load(partDoc);
      applyFixedA4Profile(osmd,partDoc,pageFormat);
      applyLayoutPreset(osmd,layout,partDoc);
      renderWithCadenceRepair(osmd,partDoc);
      const expression=await adaptExpressionRendering(osmd,holder,{maxAttempts:2});
      const measured=await adaptLyricRendering(osmd,holder,{maxAttempts:2});
      applySymbolOffsets(osmd,partDoc,holder,
        [...partDoc.querySelectorAll('part')].map(part=>part.getAttribute('id')));
      const finalExpressions=inspectSvgExpressionSpacing([...holder.querySelectorAll('svg')]);
      const expressionAudit={...expression,...finalExpressions,partId:p.id};
      expressionAudits.push(expressionAudit);
      if(finalExpressions.collisions>0)
        throw new Error(p.name+' 표현 기호와 음표·가사 간 겹침 '+
          finalExpressions.collisions+'건이 남아 인쇄를 차단했습니다. 줄 간격이나 페이지를 조절하세요.');
      const lyricAudit={...measured,partId:p.id,expectedLyrics,
        coverageSufficient:measured.lyricElements>=expectedLyrics&&measured.complete&&
          (expectedLyrics===0||measured.measuredNoteheads>0)};
      if(!lyricAudit.coverageSufficient)
        lyricAudit.status='LYRIC_MEASUREMENT_INCOMPLETE';
      lyricAudits.push(lyricAudit);
      const rendered=[...holder.querySelectorAll('svg')];
      if(rendered.length<1||rendered.length>MAX_PART_PAGES)
        throw new Error('파트별 페이지가 없거나 너무 많아 벡터 출력이 중단됐습니다.');
      if(output.length+rendered.length>MAX_PAGES)
        throw new Error('벡터 파트보는 전체 80페이지까지만 한 번에 인쇄할 수 있습니다.');
      const pageBounds=inspectSvgPageBounds(rendered);
      boundsAudits.push({...pageBounds,partId:p.id});
      if(pageBounds.overflowPages>0)
        throw new Error(p.name+' 악보 페이지 바깥의 기보가 '+pageBounds.overflowPages+
          '페이지에서 검출되어 출력하지 않습니다.');
      stampSoftwareCopyright(rendered,pageFormat);
      for(const svg of rendered){
        inspectPrintableSvg(svg);
        output.push({partName:String(p.name||p.id),partId:p.id,svg:svg.cloneNode(true),lyricAudit});
      }
    }finally{
      try{osmd?.clear?.();}catch{}
      holder.remove();
    }
    const last=lyricAudits.at(-1);
    onProgress((index+1)+'/'+parts.length+' · '+p.name+' 렌더링 완료'+
      (last?.attempts?' · 가사 간격 보정 '+last.attempts+'회':'')+
      (expressionAudits.at(-1)?.attempts?' · 표현 기호 간격 보정 '+
        expressionAudits.at(-1).attempts+'회':'')+
      (last?.remaining?' · 가사 겹침 의심 '+last.remaining+'건'+
        (last.noteheadCollisions?' (음표와 겹침 '+last.noteheadCollisions+'건)':''):'')+
      (!last?.coverageSufficient?' · 가사 위치 검사 미완료 ('+
        last?.lyricElements+'/'+last?.expectedLyrics+')':'')+
      (boundsAudits.at(-1)?.overflowPages?' · 페이지 외부 기보 의심 '+
        boundsAudits.at(-1).overflowPages+'면':'')+
      (boundsAudits.at(-1)?.unknownPages?' · 경계 측정 불가 '+
        boundsAudits.at(-1).unknownPages+'면':'') );
  }
  output.lyricAudit={parts:lyricAudits.length,
    initial:lyricAudits.reduce((n,a)=>n+a.initial,0),
    remaining:lyricAudits.reduce((n,a)=>n+a.remaining,0),
    attempts:lyricAudits.reduce((n,a)=>n+a.attempts,0),
    noteheadCollisions:lyricAudits.reduce((n,a)=>n+(a.noteheadCollisions||0),0),
    measuredNoteheads:lyricAudits.reduce((n,a)=>n+(a.measuredNoteheads||0),0),
    unknownNoteheads:lyricAudits.reduce((n,a)=>n+(a.unknownNoteheads||0),0),
    complete:lyricAudits.every(a=>a.coverageSufficient),
    expectedLyrics:lyricAudits.reduce((n,a)=>n+a.expectedLyrics,0),
    measuredLyrics:lyricAudits.reduce((n,a)=>n+a.lyricElements,0),
    collisionFreeCertified:false};
  output.expressionAudit={
    parts:expressionAudits.length,
    initial:expressionAudits.reduce((n,a)=>n+a.initial,0),
    remaining:expressionAudits.reduce((n,a)=>n+a.collisions,0),
    attempts:expressionAudits.reduce((n,a)=>n+a.attempts,0),
    measured:expressionAudits.reduce((n,a)=>n+a.measured,0),
    unknown:expressionAudits.reduce((n,a)=>n+a.unknown,0),
    complete:expressionAudits.every(a=>a.complete),
    collisionFreeCertified:false
  };
  output.pageBoundsAudit={
    measuredPages:boundsAudits.reduce((n,a)=>n+a.measuredPages,0),
    unknownPages:boundsAudits.reduce((n,a)=>n+a.unknownPages,0),
    overflowPages:boundsAudits.reduce((n,a)=>n+a.overflowPages,0),
    complete:boundsAudits.every(a=>a.complete),
    overflowFreeCertified:false
  };
  return output;
}
export function populateVectorPrintWindow(win,{pages,title='J-WOO Score Studio',pageFormat='A4_P'}={}){
  if(!win||!Array.isArray(pages)||!pages.length||!FORMATS[pageFormat])
    throw new Error('출력할 페이지와 창을 확인할 수 없습니다.');
  const d=win.document;
  d.title=String(title);
  d.documentElement.lang='ko';
  d.head.replaceChildren();
  const meta=d.createElement('meta');meta.setAttribute('charset','utf-8');d.head.append(meta);
  const viewport=d.createElement('meta');
  viewport.setAttribute('name','viewport');viewport.setAttribute('content','width=device-width,initial-scale=1');
  d.head.append(viewport);
  const css=d.createElement('style');
  const {w,h}=FORMATS[pageFormat];
  css.textContent=':root{font-family:system-ui,sans-serif;background:#e5e5e1;color:#182015}'+
    'body{margin:0}.controls{position:sticky;top:0;background:#1a241a;color:white;padding:13px 18px;'+
    'display:flex;gap:12px;align-items:center;justify-content:space-between;z-index:30}'+
    '.controls button{border:0;background:#d8fa8a;color:#131b10;padding:10px 15px;font-weight:700;cursor:pointer}'+
    '.controls select{background:#fff;color:#182015;border:1px solid #a0a69e;'+
    'border-radius:2px;padding:9px 12px;max-width:260px;font:inherit}'+
    '.sheet{width:'+w+';height:'+h+';margin:16px auto;overflow:hidden;background:white;'+
    'box-shadow:0 2px 16px #0002;break-after:page;page-break-after:always}'+
    '.sheet svg{display:block;width:100%;height:100%;max-width:100%;max-height:100%}'+
    '.hint{font-size:12px;opacity:.8}'+
    '@page{size:'+w+' '+h+';margin:0}'+
    '@media print{html,body{margin:0!important;padding:0!important;background:white!important}'+
    '.controls{display:none!important}.sheet{margin:0;box-shadow:none;border:0;break-after:page;'+
    'page-break-after:always}.sheet:last-child{break-after:auto;page-break-after:auto}'+
    '*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}';
  d.head.append(css);
  d.body.replaceChildren();
  const bar=d.createElement('header');bar.className='controls';
  const titleEl=d.createElement('div');const bold=d.createElement('strong');
  bold.textContent='J-WOO · 벡터 파트보 인쇄';
  const hint=d.createElement('div');hint.className='hint';
  hint.textContent=pages.length+'페이지 · '+w+' × '+h+
    ' · 인쇄 메뉴에서 PDF로 저장하세요. 글꼴과 페이지 넘김은 반드시 검수하세요.';
  titleEl.append(bold,hint);
  const selector=d.createElement('select');selector.id='jwoo-print-part-select';
  selector.setAttribute('aria-label','PDF로 저장할 파트 선택');
  const appendChoice=(value,title)=>{
    const option=d.createElement('option');option.value=value;option.textContent=title;
    selector.append(option);
  };
  appendChoice('all','모든 악기 파트');
  const partNames=new Map();
  for(const p of pages)if(!partNames.has(p.partId))partNames.set(p.partId,p.partName);
  for(const [id,name] of partNames)appendChoice(id,'파트 · '+name);
  const button=d.createElement('button');button.type='button';button.textContent='인쇄 / PDF 저장';
  button.addEventListener('click',()=>win.print());
  bar.append(titleEl,selector,button);d.body.append(bar);
  for(const page of pages){
    inspectPrintableSvg(page.svg);
    const section=d.createElement('section');section.className='sheet';
    section.dataset.partId=page.partId;
    section.setAttribute('aria-label',page.partName+' 파트 악보');
    const svg=d.importNode(page.svg,true);
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    section.append(svg);d.body.append(section);
  }
  selector.addEventListener('change',()=>{
    const chosen=selector.value;
    let visible=0;
    for(const sheet of d.querySelectorAll('.sheet')){
      const show=chosen==='all'||sheet.dataset.partId===chosen;
      // Inline display is honored by the browser's print compositor as well.
      sheet.style.display=show?'':'none';
      if(show)visible++;
    }
    hint.textContent=visible+'페이지 · '+w+' × '+h+
      ' · '+(chosen==='all'?'모든 악기 파트':partNames.get(chosen))+
      ' · 인쇄 메뉴에서 벡터 PDF로 저장하세요.';
  });
  return {pages:pages.length,parts:partNames.size,format:pageFormat,
    mode:'NATIVE_VECTOR_PRINT',selectableParts:true,pdfVerified:false,
    visualQualityVerified:false};
}
