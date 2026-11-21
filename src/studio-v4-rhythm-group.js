// Stage 2: atomic, duration-exact edits across independent voices and 3:2/5:4/6:4/7:4 tuplets.
// All mutations occur on a cloned MusicXML DOM. A failed acceptance gate never publishes a candidate.
import {inspectAdvancedMeasure} from './advanced-score.js';
import {inspectEditableTuplet} from './studio-v4-tuplet-pitch-edit.js';

const children=(n,t)=>n?[...n.children].filter(x=>x.localName===t):[];
const first=(n,t)=>children(n,t)[0]||null;
const value=(n,t)=>first(n,t)?.textContent?.trim()||'';
const fail=msg=>{throw new Error(msg);};
const SPEC=Object.freeze({
  whole:[4,false],half:[2,false],'half-dotted':[3,true],
  quarter:[1,false],'quarter-dotted':[1.5,true],
  eighth:[.5,false],'eighth-dotted':[.75,true],
  '16th':[.25,false],'16th-dotted':[.375,true],
  '32nd':[.125,false],
});
const SAFE=new Set(['chord','pitch','rest','duration','voice','type','dot','staff','stem','accidental','lyric']);
const allowedCount=(n,lo,hi)=>Number.isSafeInteger(n)&&n>=lo&&n<=hi;
export function parseRhythmTypes(types){
  const input=Array.isArray(types)?types:(typeof types==='string'?types.split(/[\s,;]+/):[]);
  if(!input.length||input.length>8||input.some(x=>typeof x!=='string'||!SPEC[x]))
    fail('리듬은 whole, half, quarter, eighth, 16th, 32nd와 -dotted 조합으로 2~8개 입력해 주세요.');
  return [...input];
}
function locate(source,partId,measureIndex){
  if(source?.documentElement?.localName!=='score-partwise'||typeof partId!=='string'||!partId)
    fail('MusicXML partwise 악보가 필요합니다.');
  if(!allowedCount(measureIndex,0,9999))fail('마디 인덱스가 올바르지 않습니다.');
  const parts=children(source.documentElement,'part').filter(p=>p.getAttribute('id')===partId);
  if(parts.length!==1)fail('파트가 없거나 MusicXML 파트 ID가 중복되었습니다.');
  const measure=children(parts[0],'measure')[measureIndex];
  if(!measure)fail('선택한 마디를 찾지 못했습니다.');
  const audit=inspectAdvancedMeasure(source,partId,measureIndex);
  if(audit.reason||!audit.divisions)fail('마디 시간표를 확인할 수 없어 리듬 변경을 차단합니다: '+(audit.reason||'divisions'));
  return {part:parts[0],measure,notes:children(measure,'note'),audit};
}
function targetTicks(type,divisions,ratio=1){
  const v=SPEC[type][0]*divisions*ratio;
  if(!allowedCount(v,1,262144))fail('divisions에서 요청한 리듬 길이를 정수 tick으로 표현할 수 없습니다.');
  return v;
}
function noteShape(note,{tuplet=false}={}){
  if(note?.attributes?.length||!first(note,'duration')||!first(note,'type')||
    (first(note,'pitch')?1:0)+(first(note,'rest')?1:0)!==1||
    [...note.children].some(c=>!SAFE.has(c.localName)&&
      !(tuplet&&['time-modification','notations'].includes(c.localName))))
    fail('붙임줄·장식·임의 빔·알 수 없는 표기가 포함된 리듬은 원본을 보호합니다.');
  for(const tag of ['pitch','rest','chord','duration','voice','type','staff','time-modification','notations']){
    if(children(note,tag).length>1)fail('중복된 MusicXML 요소는 리듬을 바꾸지 않습니다.');
  }
  if(children(note,'dot').length>1)fail('여러 겹의 점음표는 지원하지 않습니다.');
  if(!tuplet&&first(note,'time-modification'))fail('잇단음 그룹은 잇단음 리듬 편집 도구를 사용하세요.');
  if(tuplet){
    if(!first(note,'time-modification'))fail('잇단음 비율이 누락되었습니다.');
    const notation=first(note,'notations');
    if(notation&&[...notation.children].some(c=>c.localName!=='tuplet'))
      fail('다른 연결 기호가 포함된 잇단음은 보호합니다.');
  }
}
function noteIdentity(event){
  return [event.voice,event.staff,event.rest,event.chord,event.step,event.alter,event.octave,event.type==='grace'].join('|');
}
function xmlShape(n){
  if(!n)return null;
  return [n.localName,[...(n.attributes||[])].map(a=>[a.name,a.value]),
    [...(n.children||[])].map(xmlShape),n.children?.length?'':n.textContent];
}
function assertUnchangedOuter(source,doc,partId,measureIndex,start,end){
  const original=locate(source,partId,measureIndex),candidate=locate(doc,partId,measureIndex);
  const before=original.audit.events,after=candidate.audit.events;
  if(after.length!==before.length||candidate.audit.max!==original.audit.max||
     candidate.audit.divisions!==original.audit.divisions)fail('리듬 작업 후 MusicXML 음표·마디 수가 달라졌습니다.');
  for(let i=0;i<before.length;i++){
    const old=before[i],next=after[i];
    if(noteIdentity(old)!==noteIdentity(next))
      fail('음표·성부·화음·음정·쉼표 정체성이 변경됐습니다.');
    if(i<start||i>end){
      if(old.start!==next.start||old.duration!==next.duration||
         JSON.stringify(xmlShape(original.notes[i]))!==JSON.stringify(xmlShape(candidate.notes[i])))
        fail('선택 구간 밖의 악보 내용·시점이 변경됐습니다.');
    }
  }
  const parts=children(source.documentElement,'part');
  const outParts=children(doc.documentElement,'part');
  if(parts.length!==outParts.length)fail('파트 수가 달라졌습니다.');
  for(let i=0;i<parts.length;i++){
    if(parts[i].getAttribute('id')!==outParts[i].getAttribute('id'))fail('파트 순서가 달라졌습니다.');
    if(parts[i].getAttribute('id')!==partId){
      if(JSON.stringify(xmlShape(parts[i]))!==JSON.stringify(xmlShape(outParts[i])))
        fail('다른 악기 파트가 변경됐습니다.');
      continue;
    }
    const oldBars=children(parts[i],'measure'),newBars=children(outParts[i],'measure');
    if(oldBars.length!==newBars.length)fail('다른 마디 수가 변경됐습니다.');
    for(let j=0;j<oldBars.length;j++)if(j!==measureIndex&&
        JSON.stringify(xmlShape(oldBars[j]))!==JSON.stringify(xmlShape(newBars[j])))
      fail('비대상 마디가 변경됐습니다.');
  }
  return {before,after};
}
function rewriteClock(note,type,duration){
  const [base,dotted]=SPEC[type];
  if(!base)fail('지원하지 않는 길이입니다.');
  first(note,'duration').textContent=String(duration);
  first(note,'type').textContent=type.replace('-dotted','');
  for(const dot of children(note,'dot'))note.removeChild(dot);
  if(dotted){
    const e=note.ownerDocument.createElementNS?
      note.ownerDocument.createElementNS(note.namespaceURI??null,'dot'):
      note.ownerDocument.createElement('dot');
    note.insertBefore(e,first(note,'type').nextSibling);
  }
  // A tuplet's normal-type/normal-dot must describe the new written
  // subdivision. Stale metadata makes otherwise correct durations invalid.
  const tm=first(note,'time-modification');
  if(tm){
    const normalType=first(tm,'normal-type');
    if(normalType)normalType.textContent=type.replace('-dotted','');
    for(const dot of children(tm,'normal-dot'))tm.removeChild(dot);
    if(dotted&&normalType){
      const e=tm.ownerDocument.createElementNS?
        tm.ownerDocument.createElementNS(tm.namespaceURI??null,'normal-dot'):
        tm.ownerDocument.createElement('normal-dot');
      tm.insertBefore(e,normalType.nextSibling);
    }
  }
  const stem=first(note,'stem');if(stem)note.removeChild(stem);
}
function execute(source,{partId,measureIndex,firstIndex,lastIndex,types,ratio,tuplet}){
  const original=locate(source,partId,measureIndex);
  const {notes,audit}=original;
  if(!allowedCount(firstIndex,0,notes.length-1)||!allowedCount(lastIndex,firstIndex,notes.length-1))
    fail('선택한 리듬 구간이 마디 범위 밖입니다.');
  const range=audit.events.slice(firstIndex,lastIndex+1);
  const anchors=range.filter(e=>!e.chord);
  if(anchors.length!==types.length||anchors.length<2||anchors.length>8||
     range[0]?.chord||audit.events[lastIndex+1]?.chord)
    fail('선택 구간은 두 개 이상 음표의 완전한 화음/쉼표 묶음이어야 합니다.');
  const lane=anchors[0].voice+'@'+anchors[0].staff;
  if(anchors.some(e=>e.voice+'@'+e.staff!==lane||e.duration<=0||e.tuplet!==tuplet))
    fail('서로 다른 성부·보표나 잇단음 외부의 이벤트는 함께 재배치할 수 없습니다.');
  for(let i=1;i<anchors.length;i++)
    if(anchors[i].start!==anchors[i-1].start+anchors[i-1].duration)
      fail('음표·쉼표는 같은 성부에서 시간상 연속되어야 합니다.');
  const changes=[],normal=range.reduce((sum,e)=>sum+(e.chord?0:e.duration),0);
  let total=0,anchorIndex=-1;
  for(const e of range){
    noteShape(notes[e.eventIndex],{tuplet});
    if(e.voice+'@'+e.staff!==lane||e.tuplet!==tuplet)
      fail('화음 구성음의 성부/잇단음 표시가 일치하지 않습니다.');
    if(!e.chord){
      anchorIndex++;
      const t=types[anchorIndex],d=targetTicks(t,audit.divisions,ratio);
      changes.push({index:e.eventIndex,type:t,ticks:d});total+=d;
    }else{
      const leader=changes.at(-1);
      if(!leader||e.start!==range.find(x=>x.eventIndex===leader.index)?.start||
         e.duration!==range.find(x=>x.eventIndex===leader.index)?.duration)
        fail('화음 구성음의 시작·길이가 기준 음표와 일치하지 않습니다.');
      changes.push({index:e.eventIndex,type:leader.type,ticks:leader.ticks});
    }
  }
  if(total!==normal)fail('리듬 그룹의 총 박자값은 유지되어야 합니다. 요청한 길이의 합계가 다릅니다.');
  if(changes.every(c=>notes[c.index]&&
       value(notes[c.index],'duration')===String(c.ticks)&&
       value(notes[c.index],'type')===c.type.replace('-dotted','')&&
       !!first(notes[c.index],'dot')===c.type.endsWith('-dotted')))
    fail('변경할 리듬이 없습니다.');
  const doc=source.cloneNode(true);
  const edited=locate(doc,partId,measureIndex);
  for(const c of changes)rewriteClock(edited.notes[c.index],c.type,c.ticks);
  const checked=assertUnchangedOuter(source,doc,partId,measureIndex,firstIndex,lastIndex);
  for(const c of changes){
    if(checked.after[c.index].duration!==c.ticks)fail('수정한 음표 길이가 올바르지 않습니다.');
  }
  const oldEnd=anchors.at(-1).start+anchors.at(-1).duration;
  const last=checked.after.filter(e=>e.eventIndex>=firstIndex&&e.eventIndex<=lastIndex&&!e.chord).at(-1);
  if(last.start+last.duration!==oldEnd)
    fail('리듬 그룹 끝 시점이 변경되어 다른 성부와 동기화되지 않습니다.');
  return {doc,change:{action:tuplet?'reshape-tuplet-rhythm':'redistribute-voice-rhythm',
    partId,measureIndex,eventIndex:firstIndex,nextEventIndex:firstIndex,changed:anchors.length,
    beforeTicks:normal,afterTicks:total,voice:anchors[0].voice,staff:anchors[0].staff}};
}
// Reallocate rhythm among 2-8 consecutive notes/rests/chords without shifting
// later onsets or touching any concurrent voice. All chord tones move together.
export function redistributeVoiceRhythm(source,{partId,measureIndex,eventIndex,endEventIndex,types}={}){
  const seq=parseRhythmTypes(types);
  if(!allowedCount(eventIndex,0,49999)||!allowedCount(endEventIndex,eventIndex,49999))
    fail('리듬 구간의 시작·끝 이벤트 번호가 올바르지 않습니다.');
  return execute(source,{partId,measureIndex,firstIndex:eventIndex,lastIndex:endEventIndex,
    types:seq,ratio:1,tuplet:false});
}
// Rebalance the written lengths inside an existing numbered tuplet group while
// preserving its actual:normal ratio, number of events, lyrics and other voices.
export function reshapeTupletRhythm(source,{partId,measureIndex,eventIndex,types}={}){
  const group=inspectEditableTuplet(source,{partId,measureIndex,eventIndex});
  const seq=parseRhythmTypes(types);
  if(seq.length!==group.count)fail('기존 잇단음 그룹의 '+group.count+'개 음표 길이를 모두 입력해야 합니다.');
  const location=locate(source,partId,measureIndex);
  for(const idx of group.indices){
    const note=location.notes[idx],e=location.audit.events[idx];
    noteShape(note,{tuplet:true});
    const tm=first(note,'time-modification');
    const actual=Number(value(tm,'actual-notes')),normal=Number(value(tm,'normal-notes'));
    const type=value(note,'type')+(first(note,'dot')?'-dotted':'');
    if(actual!==group.actual||normal!==group.normal||!SPEC[type]||
       targetTicks(type,location.audit.divisions,normal/actual)!==e.duration)
      fail('원래 잇단음 음표의 표기·박자 비율이 불일치하여 변경하지 않습니다.');
  }
  return execute(source,{partId,measureIndex,firstIndex:group.indices[0],
    lastIndex:group.indices.at(-1),types:seq,
    ratio:group.normal/group.actual,tuplet:true});
}
