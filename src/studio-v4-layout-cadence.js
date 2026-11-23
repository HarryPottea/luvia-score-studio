// Coordinated system/page-break cadence across every score part.
// This is a score-authoring feature, not an automatic collision checker.
// Existing non-break print metadata remains untouched.
const all=(n,t)=>n?[...n.children].filter(c=>c.localName===t):[];
const one=(n,t)=>all(n,t)[0]||null;
const int=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const fail=message=>{throw new Error(message);};
function create(measure,tag){
  const d=measure.ownerDocument;
  return d.createElementNS?d.createElementNS(measure.namespaceURI??null,tag):d.createElement(tag);
}
export function planLayoutCadence(source,{barsPerSystem=4,replaceExisting=false}={}){
  if(![2,3,4,5,6,8].includes(barsPerSystem))
    fail('줄당 마디 수가 지원 범위를 벗어났습니다.');
  if(source?.documentElement?.localName!=='score-partwise')
    fail('MusicXML partwise 악보만 조판할 수 있습니다.');
  const parts=all(source.documentElement,'part');
  const counts=parts.map(p=>all(p,'measure').length);
  if(!counts.length||!counts[0]||counts.some(c=>c!==counts[0]))
    fail('모든 파트가 같은 수의 마디를 가지고 있어야 합니다.');
  const total=counts[0],actions=[];
  for(const part of parts){
    const measures=all(part,'measure');
    for(let i=1;i<total;i++){
      const prints=all(measures[i],'print');
      if(prints.length>1)fail('한 마디에 여러 인쇄 지시가 있어 자동 조판을 중단합니다.');
      const print=prints[0],old=print?.getAttribute('new-system')==='yes'?'system':
        print?.getAttribute('new-page')==='yes'?'page':'none';
      // A4 page boundaries belong to the renderer, not a fixed line count.
      const expected=i%barsPerSystem?'none':'system';
      if(old!=='none'&&!replaceExisting&&old!==expected)
        fail((i+1)+'마디의 수동 줄·페이지 나눔이 계획과 충돌합니다. 기존 나눔 변경을 승인해야 합니다.');
      actions.push({measureIndex:i,old,expected,partId:part.getAttribute('id')});
    }
  }
  return {actions,total,parts:parts.length,barsPerSystem,
    systemStarts:actions.filter(x=>x.expected==='system').length/parts.length,
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
  return {doc,change:{action:'layout-cadence',barsPerSystem:plan.barsPerSystem,
    systemStarts:plan.systemStarts}};
}
