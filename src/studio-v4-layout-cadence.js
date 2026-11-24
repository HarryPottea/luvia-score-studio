// Coordinated system/page-break cadence across every score part.
// This is a score-authoring feature, not an automatic collision checker.
// Existing non-break print metadata remains untouched.
const all=(n,t)=>n?[...n.children].filter(c=>c.localName===t):[];
const one=(n,t)=>all(n,t)[0]||null;
const int=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const fail=message=>{throw new Error(message);};
const allowedBars=[2,3,4,5,6,8];
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
    if(!/^[1-9]\d*$/.test(line)||!int(Number(line),1,20000)||!allowedBars.includes(bars))
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
    if(!/^[1-9]\d*$/.test(line)||!int(Number(line),1,20000)||!allowedBars.includes(bars))
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
