// Appearance-only placement. MusicXML's standard relative-x/y attributes keep
// the offsets in the score; OSMD currently ignores them for rests and keys, so
// apply the same values to its SVG for preview and vector/PDF export.
import {graphicalTargets} from './score-hit.js';

const children=(node,name)=>node?[...node.children].filter(child=>child.localName===name):[];
const first=(node,name)=>children(node,name)[0]||null;
export const symbolOffsetLimit=200;
const limit=symbolOffsetLimit;
const valid=n=>Number.isFinite(n)&&Math.abs(n)<=limit&&Math.round(n*2)===n*2;
const offset=node=>({x:Number(node?.getAttribute('relative-x')||0),y:Number(node?.getAttribute('relative-y')||0)});
function partAt(doc,id){return children(doc?.documentElement,'part').find(p=>p.getAttribute('id')===id)||null;}
function noteAt(doc,{partId,measureIndex,eventIndex}){
  const part=partAt(doc,partId),measure=children(part,'measure')[measureIndex];
  return children(measure,'note')[eventIndex]||null;
}
function activeKey(doc,{partId,measureIndex}){
  const part=partAt(doc,partId),measures=children(part,'measure');
  if(!part||!Number.isInteger(measureIndex)||measureIndex<0||measureIndex>=measures.length)return null;
  let key=null;
  for(let index=0;index<=measureIndex;index++)for(const attrs of children(measures[index],'attributes')){
    const candidate=first(attrs,'key');if(candidate)key=candidate;
  }
  return key;
}
function activeStaffAttribute(doc,position,name){
  const part=partAt(doc,position.partId),measures=children(part,'measure');
  const staff=Number(position.staff||first(noteAt(doc,position),'staff')?.textContent||1);
  if(!part||!Number.isInteger(position.measureIndex)||position.measureIndex<0||
     position.measureIndex>=measures.length||!Number.isInteger(staff)||staff<1)return null;
  let found=null;
  for(let index=0;index<=position.measureIndex;index++)for(const attrs of children(measures[index],'attributes')){
    const candidates=children(attrs,name);
    const exact=candidates.find(node=>Number(node.getAttribute('number'))===staff);
    const shared=candidates.find(node=>!node.hasAttribute('number')&&
      (name==='time'||staff===1));
    if(exact||shared)found=exact||shared;
  }
  return found;
}
function target(doc,position,kind){
  if(kind==='key'){
    const key=activeKey(doc,position);
    if(!key||!first(key,'fifths')||key.getAttribute('number'))
      throw new Error('선택한 마디의 일반 조표를 찾지 못했습니다.');
    return key;
  }
  if(kind==='rest'){
    const note=noteAt(doc,position);
    if(!note||!first(note,'rest')||first(note,'pitch'))
      throw new Error('먼저 악보의 쉼표를 선택해 주세요.');
    return note;
  }
  if(kind==='time'){
    const time=activeStaffAttribute(doc,position,'time');
    if(!time||!first(time,'beats'))throw new Error('선택한 마디의 일반 박자표를 찾지 못했습니다.');
    return time;
  }
  if(kind==='clef'){
    const clef=activeStaffAttribute(doc,position,'clef');
    if(!clef||!first(clef,'sign'))throw new Error('선택한 보표의 음자리표를 찾지 못했습니다.');
    return clef;
  }
  throw new Error('지원하지 않는 기호입니다.');
}
export function readSymbolOffset(doc,position,kind){return offset(target(doc,position,kind));}
export function readSymbolHidden(doc,position,kind){return target(doc,position,kind).getAttribute('print-object')==='no';}
export function setSymbolHidden(source,{position,kind,hidden}){
  const original=target(source,position,kind);
  if(kind!=='rest'){
    const part=partAt(source,position.partId);
    const measure=children(part,'measure')[position.measureIndex];
    let owner=original.parentNode;
    while(owner&&owner.localName!=='measure')owner=owner.parentNode;
    if(owner!==measure)throw new Error('다른 줄에서 다시 표시된 기호는 이 위치에서 독립적으로 지울 수 없습니다. 원래 변경 마디에서 조정해 주세요.');
  }
  const doc=source.cloneNode(true),node=target(doc,position,kind);
  if(hidden)node.setAttribute('print-object','no');
  else node.removeAttribute('print-object');
  return {doc,change:{action:'symbol-visibility',kind,position,hidden}};
}
export function setSymbolOffset(source,{position,kind,x,y}){
  if(!valid(x)||!valid(y))throw new Error('가로·세로 이동은 -200~200 사이의 0.5 단위로 입력해 주세요.');
  target(source,position,kind);
  const doc=source.cloneNode(true),node=target(doc,position,kind);
  for(const [name,value] of [['relative-x',x],['relative-y',y]]){
    if(value===0)node.removeAttribute(name);else node.setAttribute(name,String(value));
  }
  return {doc,change:{action:'symbol-position',kind,position,x,y}};
}
function svgShift(element,position,scale){
  if(!element||!Number.isFinite(position.x)||!Number.isFinite(position.y))return;
  element.setAttribute('transform',`translate(${position.x*scale} ${-position.y*scale})`);
}
function visualMeasureGroups(osmd,doc,holder,visibleParts){
  const wanted=new Set(visibleParts),columns=[];
  for(const part of children(doc.documentElement,'part')){
    if(!wanted.has(part.getAttribute('id')))continue;
    let count=1;
    for(const measure of children(part,'measure')){
      for(const attrs of children(measure,'attributes')){
        const staves=Number(first(attrs,'staves')?.textContent||0);
        if(staves>count)count=staves;
      }
      for(const note of children(measure,'note')){
        const staff=Number(first(note,'staff')?.textContent||0);
        if(staff>count)count=staff;
      }
    }
    if(!Number.isInteger(count)||count<1||count>8)return new Map();
    for(let staff=1;staff<=count;staff++)columns.push({partId:part.getAttribute('id'),staff});
  }
  const groups=new Map(),matrix=osmd.GraphicSheet?.MeasureList;
  if(!Array.isArray(matrix))return groups;
  for(const [measureIndex,row] of matrix.entries()){
    if(!Array.isArray(row)||row.length!==columns.length)continue;
    for(const [index,measure] of row.entries()){
      let group=null;
      for(const entry of measure?.staffEntries||[]){
        for(const voice of entry.graphicalVoiceEntries||[]){
          for(const note of voice.notes||[]){
            const live=note.getSVGGElement?.();
            if(live?.isConnected&&holder.contains(live)){
              group=live.closest('.vf-measure');break;
            }
          }
          if(group)break;
        }
        if(group)break;
      }
      if(group)groups.set(group,{...columns[index],measureIndex});
    }
  }
  return groups;
}
export function applySymbolOffsets(osmd,doc,holder,visibleParts){
  if(!osmd||!doc||!holder)return {rests:0,keys:0,times:0,clefs:0};
  const targets=graphicalTargets(osmd,doc,visibleParts,holder);
  const scale=Number(osmd.zoom)||1;
  const measureGroups=visualMeasureGroups(osmd,doc,holder,visibleParts);
  let rests=0,keys=0,times=0,clefs=0;
  for(const item of targets){
    if(!item.rest)continue;
    const note=noteAt(doc,item),shift=offset(note);
    if(note?.getAttribute('print-object')==='no')item.element.setAttribute('display','none');
    if(!shift.x&&!shift.y)continue;
    svgShift(item.element,shift,scale);rests++;
  }
  for(const [group,item] of measureGroups){
    for(const [kind,selector] of [['key','.vf-keysignature'],['time','.vf-timesignature'],
      ['clef','.vf-clef']]){
      let node=null;
      try{node=target(doc,item,kind);}catch{continue;}
      if(node.getAttribute('print-object')==='no'){
        for(const element of group.querySelectorAll(':scope > '+selector))element.setAttribute('display','none');
        continue;
      }
      const shift=offset(node);if(!shift.x&&!shift.y)continue;
      for(const element of group.querySelectorAll(':scope > '+selector)){
        svgShift(element,shift,scale);
        if(kind==='key')keys++;else if(kind==='time')times++;else clefs++;
      }
    }
  }
  return {rests,keys,times,clefs};
}
export function symbolAtElement(osmd,doc,holder,visibleParts,element){
  if(!element?.closest)return null;
  const targets=graphicalTargets(osmd,doc,visibleParts,holder);
  const rest=targets.filter(item=>item.rest&&
    (item.element===element||item.element.contains(element)));
  if(rest.length===1)return {kind:'rest',position:{partId:rest[0].partId,
    measureIndex:rest[0].measureIndex,eventIndex:rest[0].eventIndex}};
  const symbol=element.closest('.vf-keysignature,.vf-timesignature,.vf-clef');
  if(!symbol||!holder.contains(symbol))return null;
  const group=symbol.closest('.vf-measure');
  const matched=visualMeasureGroups(osmd,doc,holder,visibleParts).get(group);
  if(!matched)return null;
  const position={partId:matched.partId,measureIndex:matched.measureIndex,staff:matched.staff};
  const kind=symbol.matches('.vf-keysignature')?'key':
    symbol.matches('.vf-timesignature')?'time':'clef';
  try{target(doc,position,kind);return {kind,position};}catch{return null;}
}
