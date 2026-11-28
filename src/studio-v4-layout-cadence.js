// Coordinated system/page-break cadence across every score part.
// This is a score-authoring feature, not an automatic collision checker.
// Existing non-break print metadata remains untouched.
const all=(n,t)=>n?[...n.children].filter(c=>c.localName===t):[];
const one=(n,t)=>all(n,t)[0]||null;
const int=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const fail=message=>{throw new Error(message);};
const allowedBars=[2,3,4,5,6,8];
// Actual renderer rows may have one or seven bars; retain those boundaries when editing another row.
const validOverride=bars=>int(bars,1,8);
const fieldName='jwoo-system-cadence-v1';
function create(measure,tag){
  const d=measure.ownerDocument;
  return d.createElementNS?d.createElementNS(measure.namespaceURI??null,tag):d.createElement(tag);
}
export function readLayoutCadence(source){
  const root=source?.documentElement;
  const field=all(one(one(root,'identification'),'miscellaneous'),'miscellaneous-field')
    .find(n=>n.getAttribute('name')===fieldName);
  if(!field)return null;
  let data;
  try{data=JSON.parse(field.textContent);}catch{fail('저장된 줄당 마디 수 정보를 읽지 못했습니다.');}
  if(data?.version!==1||!allowedBars.includes(data.barsPerSystem)||
    !data.lineOverrides||Array.isArray(data.lineOverrides)||typeof data.lineOverrides!=='object')
    fail('저장된 줄당 마디 수 정보가 올바르지 않습니다.');
  for(const [line,bars] of Object.entries(data.lineOverrides)){
    if(!/^[1-9]\d*$/.test(line)||!int(Number(line),1,20000)||!validOverride(bars))
      fail('저장된 선택 줄 마디 수 정보가 올바르지 않습니다.');
  }
  return {barsPerSystem:data.barsPerSystem,lineOverrides:data.lineOverrides};
}
function writeLayoutCadence(doc,{barsPerSystem,lineOverrides}){
  const root=doc.documentElement;
  let identification=one(root,'identification');
  if(!identification){
    identification=create(root,'identification');
    root.insertBefore(identification,one(root,'defaults')||one(root,'credit')||one(root,'part-list'));
  }
  let miscellaneous=one(identification,'miscellaneous');
  if(!miscellaneous){miscellaneous=create(identification,'miscellaneous');identification.appendChild(miscellaneous);}
  let field=all(miscellaneous,'miscellaneous-field').find(n=>n.getAttribute('name')===fieldName);
  if(!field){field=create(miscellaneous,'miscellaneous-field');field.setAttribute('name',fieldName);miscellaneous.appendChild(field);}
  field.textContent=JSON.stringify({version:1,barsPerSystem,lineOverrides});
}
export function clearLayoutCadence(doc){
  const miscellaneous=one(one(doc?.documentElement,'identification'),'miscellaneous');
  const field=all(miscellaneous,'miscellaneous-field').find(n=>n.getAttribute('name')===fieldName);
  if(field)miscellaneous.removeChild(field);
  if(miscellaneous&&!miscellaneous.children.length)miscellaneous.parentNode.removeChild(miscellaneous);
  return doc;
}
export function planLayoutCadence(source,{barsPerSystem=4,lineOverrides={},replaceExisting=false}={}){
  if(!allowedBars.includes(barsPerSystem))
    fail('줄당 마디 수가 지원 범위를 벗어났습니다.');
  if(source?.documentElement?.localName!=='score-partwise')
    fail('MusicXML partwise 악보만 조판할 수 있습니다.');
  const parts=all(source.documentElement,'part');
  const counts=parts.map(p=>all(p,'measure').length);
  if(!counts.length||!counts[0]||counts.some(c=>c!==counts[0]))
    fail('모든 파트가 같은 수의 마디를 가지고 있어야 합니다.');
  if(!lineOverrides||Array.isArray(lineOverrides)||typeof lineOverrides!=='object')
    fail('선택 줄 마디 수 정보가 올바르지 않습니다.');
  for(const [line,bars] of Object.entries(lineOverrides)){
    if(!/^[1-9]\d*$/.test(line)||!int(Number(line),1,20000)||!validOverride(bars))
      fail('선택 줄 마디 수가 지원 범위를 벗어났습니다.');
  }
  const total=counts[0],actions=[],starts=new Set(),lineRanges=[],appliedOverrides={};
  for(let start=0,line=1;start<total;line++){
    const bars=lineOverrides[line]??barsPerSystem;
    const end=Math.min(total,start+bars);
    lineRanges.push({line,startMeasureIndex:start,endMeasureIndex:end-1,bars:end-start});
    if(lineOverrides[line]!==undefined&&lineOverrides[line]!==barsPerSystem)
      appliedOverrides[line]=lineOverrides[line];
    if(end<total)starts.add(end);
    start=end;
  }
  for(const part of parts){
    const measures=all(part,'measure');
    for(let i=1;i<total;i++){
      const prints=all(measures[i],'print');
      if(prints.length>1)fail('한 마디에 여러 인쇄 지시가 있어 자동 조판을 중단합니다.');
      const print=prints[0],old=print?.getAttribute('new-system')==='yes'?'system':
        print?.getAttribute('new-page')==='yes'?'page':'none';
      // A4 page boundaries belong to the renderer, not a fixed line count.
      const expected=starts.has(i)?'system':'none';
      if(old!=='none'&&!replaceExisting&&old!==expected)
        fail((i+1)+'마디의 수동 줄·페이지 나눔이 계획과 충돌합니다. 기존 나눔 변경을 승인해야 합니다.');
      actions.push({measureIndex:i,old,expected,partId:part.getAttribute('id')});
    }
  }
  return {actions,total,parts:parts.length,barsPerSystem,lineRanges,appliedOverrides,
    systemStarts:starts.size,
    replacing:replaceExisting};
}
export function applyLayoutCadence(source,options={}){
  const plan=planLayoutCadence(source,options);
  const doc=source.cloneNode(true);
  const parts=all(doc.documentElement,'part');
  const measures=new Map(parts.map(p=>[p.getAttribute('id'),all(p,'measure')]));
  for(const task of plan.actions){
    const measure=measures.get(task.partId)[task.measureIndex];
    let print=one(measure,'print');
    if(!print&&task.expected==='none')continue;
    if(!print){
      print=create(measure,'print');
      const attributes=one(measure,'attributes');
      measure.insertBefore(print,attributes?attributes.nextSibling:measure.firstChild);
    }
    // Preserve print child nodes, page layout, spacing directives and other attrs.
    if(task.expected==='none'&&task.old==='none')continue;
    print.removeAttribute('new-system');
    print.removeAttribute('new-page');
    if(task.expected==='system')print.setAttribute('new-system','yes');
    if(task.expected==='page')print.setAttribute('new-page','yes');
    if(!print.attributes.length&&!print.children.length)measure.removeChild(print);
  }
  writeLayoutCadence(doc,{barsPerSystem:plan.barsPerSystem,lineOverrides:plan.appliedOverrides});
  return {doc,change:{action:'layout-cadence',barsPerSystem:plan.barsPerSystem,
    systemStarts:plan.systemStarts}};
}

// Actual systems, including width-driven breaks, from the rendered OSMD sheet.
// Fail closed for missing/ambiguous rows (e.g. explicit multirests).
export function renderedLineRanges(osmd,total){
  const matrix=osmd?.GraphicSheet?.MeasureList;
  if(!Number.isSafeInteger(total)||total<1||!Array.isArray(matrix)||matrix.length!==total)return null;
  const ranges=[],seen=new Set();
  let previous=null;
  for(let i=0;i<total;i++){
    const systems=new Set((matrix[i]||[]).map(m=>m?.ParentStaffLine?.ParentMusicSystem).filter(Boolean));
    if(systems.size!==1)return null;
    const system=[...systems][0];
    if(system!==previous){
      if(seen.has(system))return null;
      seen.add(system);
      ranges.push({line:ranges.length+1,startMeasureIndex:i,endMeasureIndex:i,bars:1});
      previous=system;
    }else{
      const range=ranges[ranges.length-1];range.endMeasureIndex=i;range.bars++;
    }
  }
  return ranges;
}
// Keep actual preceding rows, use the requested count at the actual selected
// measure, and preserve later explicit overrides when their original start
// measure still coincides with a new row. A final singleton can borrow bars
// from the preceding row without producing another singleton.
export function planRenderedLineEdit(source,cadence,ranges,line,bars){
  if(!allowedBars.includes(bars)||!Number.isSafeInteger(line)||line<1||
    !Array.isArray(ranges)||!ranges[line-1])fail('선택한 실제 줄과 마디 수를 확인해 주세요.');
  const old=planLayoutCadence(source,{...cadence,replaceExisting:true});
  let cursor=0;
  for(let i=0;i<ranges.length;i++){
    const r=ranges[i];
    if(r.line!==i+1||r.startMeasureIndex!==cursor||!validOverride(r.bars)||
      r.endMeasureIndex!==cursor+r.bars-1)fail('실제 줄 범위를 안전하게 변경할 수 없습니다.');
    cursor+=r.bars;
  }
  if(cursor!==old.total)fail('실제 줄과 원본 악보의 마디 수가 일치하지 않습니다.');
  const counts=ranges.slice(0,line-1).map(r=>r.bars);
  let start=ranges[line-1].startMeasureIndex;
  const remaining=old.total-start;
  if(remaining<bars){
    const borrow=bars-remaining;
    if(line!==ranges.length||!counts.length||counts[counts.length-1]-borrow<2)
      fail('선택 줄의 남은 마디가 부족합니다. 앞 줄의 마디 수를 줄인 후 다시 적용해 주세요.');
    counts[counts.length-1]-=borrow;start-=borrow;
  }
  counts.push(bars);
  const priorByStart=new Map(old.lineRanges.filter(r=>cadence.lineOverrides[r.line]!==undefined)
    .map(r=>[r.startMeasureIndex,cadence.lineOverrides[r.line]]));
  for(let next=start+bars;next<old.total;){
    const n=priorByStart.get(next)??cadence.barsPerSystem;
    const count=Math.min(n,old.total-next);counts.push(count);next+=count;
  }
  const lineOverrides={};
  counts.forEach((count,i)=>{if(count!==cadence.barsPerSystem)lineOverrides[i+1]=count;});
  return {options:{barsPerSystem:cadence.barsPerSystem,lineOverrides,replaceExisting:true},start,bars};
}
// Width overflow can leave one bar immediately before a cadence-forced break.
// Try removing that redundant break in the renderer only, never an explicit
// page break or the saved MusicXML. Keep the trial only if orphan count drops.
export function renderWithCadenceRepair(osmd,doc){
  osmd.render();
  const cadence=readLayoutCadence(doc);
  if(!cadence)return;
  const total=all(all(doc.documentElement,'part')[0],'measure').length;
  const before=renderedLineRanges(osmd,total);
  if(!before)return;
  const plan=planLayoutCadence(doc,{...cadence,replaceExisting:true});
  const planned=new Set(plan.lineRanges.map(r=>r.startMeasureIndex));
  const matrix=osmd.GraphicSheet.MeasureList,changed=new Set();
  for(let i=1;i<before.length-1;i++){
    const r=before[i],next=before[i+1];
    if(r.bars!==1||planned.has(r.startMeasureIndex)||!planned.has(next.startMeasureIndex))continue;
    const sources=new Set((matrix[next.startMeasureIndex]||[]).map(m=>m?.parentSourceMeasure).filter(Boolean));
    if(sources.size!==1)continue;
    const source=[...sources][0];
    if(source.printNewSystemXml===true&&!source.printNewPageXml){source.printNewSystemXml=false;changed.add(source);}
  }
  if(!changed.size)return;
  const orphanCount=rows=>rows.filter(r=>r.bars===1).length;
  try{
    osmd.render();
    const after=renderedLineRanges(osmd,total);
    if(after&&orphanCount(after)<orphanCount(before))return;
  }catch{/* revert the trial below */}
  for(const source of changed)source.printNewSystemXml=true;
  osmd.render();
}
