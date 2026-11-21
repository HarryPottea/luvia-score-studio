// Appearance-only placement. MusicXML's standard relative-x/y attributes keep
// the offsets in the score; OSMD currently ignores them for rests and keys, so
// apply the same values to its SVG for preview and vector/PDF export.
import {graphicalTargets} from './score-hit.js';

const children=(node,name)=>node?[...node.children].filter(child=>child.localName===name):[];
const first=(node,name)=>children(node,name)[0]||null;
const limit=40;
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
  throw new Error('지원하지 않는 기호입니다.');
}
export function readSymbolOffset(doc,position,kind){return offset(target(doc,position,kind));}
export function setSymbolOffset(source,{position,kind,x,y}){
  if(!valid(x)||!valid(y))throw new Error('가로·세로 이동은 -40~40 사이의 0.5 단위로 입력해 주세요.');
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
  if(!osmd||!doc||!holder)return {rests:0,keys:0};
  const targets=graphicalTargets(osmd,doc,visibleParts,holder);
  const scale=Number(osmd.zoom)||1;
  const measureGroups=visualMeasureGroups(osmd,doc,holder,visibleParts);
  let rests=0,keys=0;
  for(const item of targets){
    if(!item.rest)continue;
    const note=noteAt(doc,item),shift=offset(note);
    if(!shift.x&&!shift.y)continue;
    svgShift(item.element,shift,scale);rests++;
  }
  for(const [group,item] of measureGroups){
    const key=activeKey(doc,item);if(!key)continue;
    const shift=offset(key);if(!shift.x&&!shift.y)continue;
    for(const element of group.querySelectorAll(':scope > .vf-keysignature')){
      svgShift(element,shift,scale);keys++;
    }
  }
  return {rests,keys};
}
export function symbolAtElement(osmd,doc,holder,visibleParts,element){
  if(!element?.closest)return null;
  const targets=graphicalTargets(osmd,doc,visibleParts,holder);
  const rest=targets.filter(item=>item.rest&&
    (item.element===element||item.element.contains(element)));
  if(rest.length===1)return {kind:'rest',position:{partId:rest[0].partId,
    measureIndex:rest[0].measureIndex,eventIndex:rest[0].eventIndex}};
  const key=element.closest('.vf-keysignature');
  if(!key||!holder.contains(key))return null;
  const group=key.closest('.vf-measure');
  const matched=visualMeasureGroups(osmd,doc,holder,visibleParts).get(group);
  if(!matched)return null;
  const position={partId:matched.partId,measureIndex:matched.measureIndex};
  return activeKey(doc,position)?{kind:'key',position}:null;
}
