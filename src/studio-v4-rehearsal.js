// Song-form labels are standard MusicXML rehearsal directions at bar onset.
// Replicate across parts for independent exports; OSMD draws one above the top staff.
const all=(n,t)=>n?[...n.children].filter(c=>c.localName===t):[];
const fail=message=>{throw new Error(message);};
function measures(source,index){
  if(source?.documentElement?.localName!=='score-partwise'||!Number.isSafeInteger(index)||index<0)
    fail('송폼을 표시할 마디를 확인해 주세요.');
  const parts=all(source.documentElement,'part');
  const rows=parts.map(p=>all(p,'measure'));
  if(!rows.length||rows.some(r=>r.length!==rows[0].length||!r[index]))
    fail('모든 파트에 동일한 마디가 있어야 합니다.');
  return rows.map(r=>r[index]);
}
function marks(measure){
  const results=[];let cursorMoved=false;
  for(const child of measure.children){
    if(['note','forward','backup'].includes(child.localName))cursorMoved=true;
    if(child.localName!=='direction')continue;
    const types=all(child,'direction-type');
    for(const type of types)for(const mark of all(type,'rehearsal')){
      const only=child.children.length===1&&types.length===1&&type.children.length===1;
      results.push({direction:child,mark,safe:only&&!cursorMoved});
    }
  }
  return results;
}
export function readRehearsalMark(source,index){
  const groups=measures(source,index).map(marks);
  const entries=groups.flat();
  const labels=[...new Set(entries.map(e=>e.mark.textContent.trim()))];
  return {label:labels.length===1?labels[0]:'',present:entries.length>0,
    editable:groups.every(g=>g.length<=1&&g.every(e=>e.safe))&&labels.length<=1};
}
function make(parent,name){
  return parent.ownerDocument.createElementNS(parent.namespaceURI??null,name);
}
export function setRehearsalMark(source,{measureIndex,label}={}){
  if(typeof label!=='string'||label.trim().length>32||/[\u0000-\u001f\u007f]/.test(label))
    fail('리허설 마크는 줄바꿈 없이 32자 이내로 입력해 주세요.');
  label=label.trim();
  const current=readRehearsalMark(source,measureIndex);
  if(!current.editable)fail('이 마디에는 복합 또는 서로 다른 기존 리허설 마크가 있어 안전하게 편집할 수 없습니다.');
  if(!label&&!current.present)fail('삭제할 리허설 마크가 없습니다.');
  const doc=source.cloneNode(true);
  for(const measure of measures(doc,measureIndex)){
    const existing=marks(measure)[0];
    if(existing){
      if(label)existing.mark.textContent=label;
      else measure.removeChild(existing.direction);
      continue;
    }
    if(!label)continue;
    const direction=make(measure,'direction');direction.setAttribute('placement','above');
    const type=make(measure,'direction-type'),mark=make(measure,'rehearsal');
    mark.setAttribute('enclosure','rectangle');mark.setAttribute('font-weight','bold');
    mark.textContent=label;type.appendChild(mark);direction.appendChild(type);
    // Keep initial print/attributes and other onset directions untouched.
    const before=[...measure.children].find(n=>['note','forward','backup','harmony','barline'].includes(n.localName)&&!(n.localName==='barline'&&n.getAttribute('location')==='left'))||null;
    measure.insertBefore(direction,before);
  }
  return {doc,change:{action:label?'rehearsal-set':'rehearsal-remove',measureIndex,label}};
}
