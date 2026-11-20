// J-WOO 4.0 measure-range operations; synchronous, immutable, and multi-part.
// Clipboard values hold only copied MusicXML DOM fragments in browser memory.
import {appendBlankMeasures} from './studio-v4-core.js';
import {assertClosedMeasureBoundary,assertClosedMeasureRange} from './studio-v4-measure-links.js';

const all=(node,tag)=>node?[...node.children].filter(n=>n.localName===tag):[];
const first=(node,tag)=>all(node,tag)[0]||null;
const fail=message=>{throw new Error(message);};
const safeInt=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const attributeKeys=new Set(['divisions','key','time','staves','clef',
  'transpose','staff-details']);

function hasSensitive(node){
  if(!node)return false;
  for(const child of node.children){
    if(sensitive.has(child.localName)||hasSensitive(child))return true;
  }
  return false;
}
function nodeFingerprint(node){
  const attributes=[...node.attributes].map(a=>[a.name,a.value]).sort((a,b)=>a[0].localeCompare(b[0]));
  const children=[...node.childNodes].filter(n=>n.nodeType===1).map(nodeFingerprint);
  return [node.localName,attributes,children.length?children:(node.textContent||'').trim()];
}
function partContext(part,index){
  const bars=all(part,'measure'),until=Math.max(0,Math.min(index,bars.length-1));
  const state=new Map();
  for(let k=0;k<=until;k++){
    for(const attrs of all(bars[k],'attributes')){
      for(const item of attrs.children){
        if(!attributeKeys.has(item.localName))
          fail('지원하지 않는 악보 속성이 있어 마디를 복사하지 않습니다.');
        const key=item.localName+':'+(item.getAttribute('number')||'');
        state.set(key,JSON.stringify(nodeFingerprint(item)));
      }
    }
  }
  if(!state.has('divisions:')||!state.has('time:'))
    fail('악보의 박자표 또는 divisions 정보를 확인할 수 없습니다.');
  return JSON.stringify([...state].sort(([a],[b])=>a.localeCompare(b)));
}
function scoreInfo(doc){
  if(doc?.documentElement?.localName!=='score-partwise')fail('MusicXML partwise 악보만 지원합니다.');
  const parts=all(doc.documentElement,'part');
  if(!parts.length||parts.length>12)fail('파트가 1~12개인 악보만 편집할 수 있습니다.');
  const bars=parts.map(p=>all(p,'measure')),length=bars[0].length;
  if(!length||length>128||bars.some(row=>row.length!==length))
    fail('파트별 마디 수가 서로 다르거나 지원 범위를 벗어났습니다.');
  const ids=parts.map(p=>p.getAttribute('id'));
  if(ids.some(id=>!id)||new Set(ids).size!==ids.length)fail('악기 파트 ID가 유효하지 않습니다.');
  const labels=bars[0].map(m=>m.getAttribute('number'));
  if(labels.some(x=>!/^(0|[1-9]\d*)$/.test(x??'')))
    fail('비표준 마디 번호를 자동 변경하지 않습니다.');
  const number=Number(labels[0]);
  if(!safeInt(number,0,19999)||labels.some((x,i)=>Number(x)!==number+i)||
     bars.some(row=>row.some((m,i)=>m.getAttribute('number')!==labels[i]||
       m.getAttribute('implicit')==='yes'||m.getAttribute('non-controlling')==='yes')))
    fail('파트별 마디 번호·불완전 마디 구조가 안전하지 않습니다.');
  return {parts,bars,length,ids,number};
}
function range(info,start,end){
  if(!safeInt(start,0,info.length-1)||!safeInt(end,start,info.length-1))
    fail('선택한 마디 범위가 올바르지 않습니다.');
  if(end-start+1>16)fail('한 번에 최대 16마디까지만 편집할 수 있습니다.');
}
function safeSeam(info,index){
  assertClosedMeasureBoundary(info.parts,index);
}
function safeFragment(bar,barIndex){
  if(bar.hasAttribute('implicit')||bar.hasAttribute('non-controlling'))
    fail('불완전 마디는 복제하지 않습니다.');
  if(all(bar,'barline').length)fail('종지선·반복선이 있는 마디는 복제하지 않습니다.');
  if(barIndex>0&&all(bar,'attributes').length)
    fail('범위 안에 조표·박자표·보표 변경이 있어 복제를 보호합니다.');
  if(all(bar,'attributes').length>1)fail('복합 속성 마디를 복제하지 않습니다.');
}
function renumber(part,firstNumber){
  all(part,'measure').forEach((m,i)=>m.setAttribute('number',String(firstNumber+i)));
}
function moveInitialAttributes(part,inserted){
  const measures=all(part,'measure');
  const former=measures[inserted];
  const attrs=first(former,'attributes');
  if(!attrs||all(former,'attributes').length!==1)
    fail('첫 마디의 조표·박자표 정보를 안전하게 이동할 수 없습니다.');
  const added=measures[0];
  former.removeChild(attrs);
  added.insertBefore(attrs,added.firstChild);
}
function moveFinalBarline(part,oldEndIndex){
  const measures=all(part,'measure');
  const oldEnd=measures[oldEndIndex],newEnd=measures.at(-1);
  const endings=all(oldEnd,'barline').filter(b=>b.getAttribute('location')!=='left');
  if(endings.length>1||all(newEnd,'barline').length)
    fail('마지막 마디 종지선을 안전하게 옮길 수 없습니다.');
  for(const barline of endings){
    if(hasSensitive(barline))fail('반복선·도돌이표는 자동 이동하지 않습니다.');
    oldEnd.removeChild(barline);
    newEnd.appendChild(barline);
  }
}
function canInsert(info,index,count){
  if(!safeInt(index,0,info.length)||!safeInt(count,1,16))
    fail('삽입 위치 또는 마디 수가 올바르지 않습니다.');
  if(info.length+count>128)fail('악보는 최대 128마디까지 지원합니다.');
  safeSeam(info,index);
}
export function captureMeasureRange(source,{start,end}={}){
  const info=scoreInfo(source);
  range(info,start,end);
  assertClosedMeasureRange(info.parts,start,end);
  const fragments=[],contexts=[];
  for(let p=0;p<info.parts.length;p++){
    const part=info.parts[p],row=info.bars[p];
    const selected=[];
    const sourceContext=partContext(part,start);
    for(let i=start;i<=end;i++){
      safeFragment(row[i],i);
      const candidate=row[i].cloneNode(true);
      for(const removable of [...all(candidate,'attributes'),...all(candidate,'print')])
        candidate.removeChild(removable);
      selected.push(candidate);
      if(partContext(part,i)!==sourceContext)
        fail('선택 범위의 중간에서 조표·박자표가 달라 복사하지 않습니다.');
    }
    fragments.push(selected);
    contexts.push(sourceContext);
  }
  return {type:'J-WOO-MEASURE-BLOCK',partIds:info.ids,contexts,fragments,
    count:end-start+1};
}
export function pasteMeasureRange(source,{clipboard,index}={}){
  const info=scoreInfo(source);
  if(!clipboard||clipboard.type!=='J-WOO-MEASURE-BLOCK'||
      !safeInt(clipboard.count,1,16)||!Array.isArray(clipboard.fragments)||
      !Array.isArray(clipboard.contexts)||!Array.isArray(clipboard.partIds)||
      clipboard.partIds.join('\u0000')!==info.ids.join('\u0000'))
    fail('현재 악보에 호환되는 마디 복사본이 없습니다.');
  canInsert(info,index,clipboard.count);
  for(let p=0;p<info.parts.length;p++){
    if(clipboard.fragments[p]?.length!==clipboard.count||
       partContext(info.parts[p],index===0?0:index-1)!==clipboard.contexts[p])
      fail('삽입 위치의 박자표·조표·보표 설정이 복사한 마디와 다릅니다.');
  }
  const doc=source.cloneNode(true),parts=all(doc.documentElement,'part');
  for(let p=0;p<parts.length;p++){
    const part=parts[p],before=all(part,'measure')[index]||null;
    const clones=clipboard.fragments[p].map(m=>m.cloneNode(true));
    for(const m of clones)part.insertBefore(m,before);
    if(index===0)moveInitialAttributes(part,clones.length);
    if(index===info.length)moveFinalBarline(part,info.length-1);
    renumber(part,info.number);
  }
  return {doc,change:{action:'paste-measure-range',start:index,count:clipboard.count,
    nextMeasureIndex:index,nextEventIndex:0}};
}
export function duplicateMeasureRange(source,{start,end}={}){
  const info=scoreInfo(source);range(info,start,end);
  const clipboard=captureMeasureRange(source,{start,end});
  const result=pasteMeasureRange(source,{clipboard,index:end+1});
  result.change.action='duplicate-measure-range';
  return result;
}
export function deleteMeasureRange(source,{start,end}={}){
  const info=scoreInfo(source);range(info,start,end);
  if(info.length-(end-start+1)<1)fail('악보는 최소 1마디가 남아야 합니다.');
  assertClosedMeasureRange(info.parts,start,end);
  for(const row of info.bars){
    for(let i=start;i<=end;i++){
      if(i>0&&all(row[i],'attributes').length)
        fail('삭제 구간에 곡 중간 박자표·조표 변경이 있어 보호합니다.');
    }
    if(start===0){
      if(all(row[0],'attributes').length>1||
         all(row[end+1],'attributes').length)
        fail('첫 마디의 박자표·조표를 새 첫 마디로 옮길 수 없습니다.');
    }
    if(end===info.length-1){
      const last=all(row[end],'barline').filter(b=>b.getAttribute('location')!=='left');
      const previous=all(row[start-1],'barline').filter(b=>b.getAttribute('location')!=='left');
      if(last.length>1||(last.length&&previous.length))
        fail('마지막 마디의 종지선이 중복될 수 있어 삭제하지 않습니다.');
    }
  }
  const doc=source.cloneNode(true);
  for(const part of all(doc.documentElement,'part')){
    const row=all(part,'measure');
    const initial=start===0?first(row[0],'attributes')?.cloneNode(true):null;
    const ending=end===info.length-1?
      all(row[end],'barline').filter(b=>b.getAttribute('location')!=='left')
        .map(b=>b.cloneNode(true)):[];
    for(let i=end;i>=start;i--)part.removeChild(row[i]);
    const remaining=all(part,'measure');
    if(initial){
      const firstBar=remaining[0];
      const before=[...firstBar.children].find(c=>c.localName!=='print')||null;
      firstBar.insertBefore(initial,before);
    }
    if(ending.length)for(const barline of ending)remaining.at(-1).appendChild(barline);
    renumber(part,info.number);
  }
  return {doc,change:{action:'delete-measure-range',start,count:end-start+1,
    nextMeasureIndex:Math.min(start,info.length-(end-start+1)-1),nextEventIndex:0}};
}
export function insertBlankMeasureRange(source,{index,count=1}={}){
  const info=scoreInfo(source);
  canInsert(info,index,count);
  const endIndex=info.length-1;
  // The existing tail extension enforces complete 4/4 durations, each staff's
  // voice timeline, and supported rest construction. Only move those new bars.
  for(let p=0;p<info.parts.length;p++){
    if(partContext(info.parts[p],index===0?0:index-1)!==partContext(info.parts[p],endIndex))
      fail('삽입 위치의 박자·보표가 악보 끝과 달라 빈 마디 자동 삽입을 보호합니다.');
  }
  const doc=appendBlankMeasures(source,{count}).doc;
  const parts=all(doc.documentElement,'part');
  for(const part of parts){
    const row=all(part,'measure');
    const inserted=row.slice(info.length);
    const before=row[index]||null;
    for(const m of inserted)part.insertBefore(m,before);
    // Move, not clone, the new measures into their requested position.
    // insertBefore(existingNode) moves a DOM node, so no duplicate measures.
    if(index===0)moveInitialAttributes(part,inserted.length);
    if(index===info.length)moveFinalBarline(part,info.length-1);
    renumber(part,info.number);
  }
  return {doc,change:{action:'insert-blank-measures',start:index,count,
    nextMeasureIndex:index,nextEventIndex:0}};
}
