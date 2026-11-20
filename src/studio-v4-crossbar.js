// Professional cross-barline note continuation and slur editing.
// Operates on a cloned MusicXML DOM and never re-times unrelated voices.
import {inspectAdvancedMeasure} from './advanced-score.js';

const all=(n,name)=>n?[...n.children].filter(c=>c.localName===name):[];
const one=(n,name)=>all(n,name)[0]||null;
const text=(n,name)=>one(n,name)?.textContent?.trim()||'';
const fail=message=>{throw new Error(message);};
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const TYPES=[['whole',4],['half',2],['quarter',1],['eighth',.5],['16th',.25],['32nd',.125]];
const lane=e=>e.voice+'@'+e.staff;
const laneOfNote=n=>(text(n,'voice')||'1')+'@'+(text(n,'staff')||'1');
const make=(parent,tag,value)=>{
  const d=parent.ownerDocument;
  const n=d.createElementNS?d.createElementNS(parent.namespaceURI??null,tag):d.createElement(tag);
  if(value!==undefined)n.textContent=String(value);
  return n;
};
function locate(doc,partId,measureIndex,eventIndex){
  if(doc?.documentElement?.localName!=='score-partwise'||typeof partId!=='string'||!partId||
    !integer(measureIndex,0,9999)||!integer(eventIndex,0,99999))
    fail('MusicXML 파트와 마디·음표 위치가 올바르지 않습니다.');
  const part=all(doc.documentElement,'part').find(p=>p.getAttribute('id')===partId);
  if(!part)fail('선택한 파트가 없습니다.');
  const measure=all(part,'measure')[measureIndex],note=all(measure,'note')[eventIndex];
  if(!measure||!note)fail('선택한 마디 또는 음표가 없습니다.');
  const audit=inspectAdvancedMeasure(doc,partId,measureIndex);
  if(audit.reason)fail('보호된 악보 구조입니다: '+audit.reason);
  return {part,measure,note,audit,event:audit.events[eventIndex]};
}
function plainNote(node,{rest=false}={}){
  const allowed=rest?
    ['rest','duration','voice','type','staff']:
    ['pitch','duration','voice','type','staff','stem','accidental','lyric'];
  if(!node||node.attributes?.length||[...node.children].some(x=>!allowed.includes(x.localName))||
    !one(node,'duration')||!one(node,'type')||!one(node,rest?'rest':'pitch')||
    rest&&one(node,'rest').attributes?.length)
    fail('기존 붙임줄·장식·복합 기보는 마디 경계 편집에서 보호합니다.');
}
function lengthOf(type,divisions){
  const ratio=TYPES.find(e=>e[0]===type)?.[1];
  const ticks=ratio*divisions;
  if(!integer(ticks,1,262144))fail('선택한 길이를 이 악보의 박자 단위로 표현할 수 없습니다.');
  return ticks;
}
function restChunks(ticks,divisions){
  if(!integer(ticks,0,262144))fail('남은 쉼표 길이가 잘못되었습니다.');
  const chunks=[];
  for(const [type,ratio] of TYPES){
    const span=divisions*ratio;
    if(!integer(span,1,262144))continue;
    while(ticks>=span){
      chunks.push({type,duration:span});ticks-=span;
      if(chunks.length>32)fail('분할되는 쉼표가 너무 많습니다.');
    }
  }
  if(ticks)fail('남은 시간을 정확한 쉼표로 기보할 수 없습니다.');
  return chunks;
}
function makeRest(measure,like,{duration,type}){
  const note=make(measure,'note');
  note.appendChild(make(note,'rest'));
  note.appendChild(make(note,'duration',duration));
  if(one(like,'voice'))note.appendChild(make(note,'voice',text(like,'voice')));
  note.appendChild(make(note,'type',type));
  if(one(like,'staff'))note.appendChild(make(note,'staff',text(like,'staff')));
  return note;
}
function addTie(note,kind){
  const tie=make(note,'tie');tie.setAttribute('type',kind);
  note.insertBefore(tie,one(note,'voice')||one(note,'type'));
  let notations=one(note,'notations');
  if(notations)fail('기존 기보 연결 정보가 있어 변경하지 않습니다.');
  notations=make(note,'notations');
  const tied=make(notations,'tied');tied.setAttribute('type',kind);
  notations.appendChild(tied);
  note.insertBefore(notations,one(note,'lyric')||null);
}
function signatures(report,changedLane){
  return report.events.filter(e=>lane(e)!==changedLane)
    .map(e=>[e.voice,e.staff,e.start,e.duration,e.rest,e.step,e.alter,e.octave,e.chord]);
}
function transport(measure){
  return [...measure.children].filter(n=>n.localName==='backup'||n.localName==='forward')
    .map(n=>[n.localName,text(n,'duration'),text(n,'voice'),text(n,'staff')]);
}
function assertPreserved(original,next,partId,measureIndex,changedLane){
  const before=locate(original,partId,measureIndex,0);
  const after=locate(next,partId,measureIndex,0);
  if(after.audit.reason||before.audit.max!==after.audit.max)
    fail('변경 후 마디의 시간 구조가 달라졌습니다.');
  if(JSON.stringify(transport(before.measure))!==JSON.stringify(transport(after.measure)))
    fail('다른 성부의 시간 이동 정보가 달라졌습니다.');
  if(JSON.stringify(signatures(before.audit,changedLane))!==JSON.stringify(signatures(after.audit,changedLane)))
    fail('다른 성부의 음표 또는 쉼표가 변경되었습니다.');
}

/**
 * Continue a final note across one barline into an ordinary rest at the start
 * of the next measure. The first note keeps its original length and all
 * lyrics; the next-measure continuation consumes exactly its own rest ticks.
 * Other voices/staves and unrelated parts are unchanged.
 */
export function extendVoiceAcrossBarline(source,{partId,measureIndex,eventIndex,
  continuationType='quarter'}={}){
  const a=locate(source,partId,measureIndex,eventIndex);
  const bIndex=measureIndex+1;
  const otherMeasure=all(a.part,'measure')[bIndex];
  if(!otherMeasure)fail('다음 마디가 없습니다.');
  const bReport=inspectAdvancedMeasure(source,partId,bIndex);
  if(bReport.reason||!bReport.divisions)fail('다음 마디의 시간·성부 구조가 지원되지 않습니다.');
  const e=a.event;
  if(!e||e.rest||e.chord||e.tuplet||!a.audit.divisions||e.start+e.duration!==a.audit.max)
    fail('마디 끝에서 정확히 끝나는 일반 음표를 선택해 주세요.');
  plainNote(a.note);
  // A final note is the final timed non-chord event of its lane; otherwise
  // backup/forward or conflicting time placement could make an invalid tie.
  if(a.audit.events.some(v=>lane(v)===lane(e)&&v!==e&&!v.chord&&v.start>=e.start+e.duration))
    fail('선택 성부의 마지막 음표가 아닙니다.');
  const first=bReport.events.find(v=>lane(v)===lane(e)&&!v.chord);
  if(!first||!first.rest||first.start!==0)
    fail('다음 마디 첫 박자에 같은 성부·보표의 쉼표가 있어야 합니다.');
  const bRest=all(otherMeasure,'note')[first.eventIndex];
  plainNote(bRest,{rest:true});
  const continuation=lengthOf(continuationType,bReport.divisions);
  if(continuation>first.duration)fail('다음 마디 첫 쉼표보다 긴 음표는 연장할 수 없습니다.');
  const chunks=restChunks(first.duration-continuation,bReport.divisions);
  const candidate=source.cloneNode(true);
  const ca=locate(candidate,partId,measureIndex,eventIndex);
  const cb=locate(candidate,partId,bIndex,first.eventIndex);
  const continued=ca.note.cloneNode(true);
  for(const name of ['lyric','accidental','stem'])for(const n of all(continued,name))continued.removeChild(n);
  one(continued,'duration').textContent=String(continuation);
  one(continued,'type').textContent=continuationType;
  addTie(ca.note,'start');
  addTie(continued,'stop');
  const anchor=cb.note.nextSibling;
  cb.measure.replaceChild(continued,cb.note);
  for(const chunk of chunks)cb.measure.insertBefore(makeRest(cb.measure,cb.note,chunk),anchor);

  assertPreserved(source,candidate,partId,measureIndex,lane(e));
  assertPreserved(source,candidate,partId,bIndex,lane(e));
  const endA=inspectAdvancedMeasure(candidate,partId,measureIndex).events[eventIndex];
  const endB=inspectAdvancedMeasure(candidate,partId,bIndex).events[first.eventIndex];
  if(!endA||!endB||endA.start!==e.start||endA.duration!==e.duration||
    endB.start!==0||endB.duration!==continuation||endB.voice!==e.voice||
    endB.staff!==e.staff||endB.step!==e.step||endB.alter!==e.alter||endB.octave!==e.octave||
    endB.rest)
    fail('마디 경계의 음정·박자 보존 조건을 충족하지 않습니다.');
  return {doc:candidate,change:{action:'crossbar-sounding-tie',partId,measureIndex,eventIndex,
    continuationMeasureIndex:bIndex,continuationEventIndex:first.eventIndex,continuationType}};
}

/**
 * Connect a slur between pitches in this measure and the next, optionally
 * removing an existing matching connection. No rhythm is rewritten.
 */
export function toggleSlurAcrossBarline(source,{partId,measureIndex,eventIndex,
  endEventIndex=0}={}){
  const start=locate(source,partId,measureIndex,eventIndex);
  if(!integer(endEventIndex,0,99999))fail('끝 음표 위치가 잘못되었습니다.');
  const nextMeasureIndex=measureIndex+1;
  const end=locate(source,partId,nextMeasureIndex,endEventIndex);
  if(!start.event||!end.event||start.event.rest||end.event.rest||start.event.chord||end.event.chord||
    lane(start.event)!==lane(end.event))
    fail('이어지는 마디의 같은 성부·보표 음표를 선택해 주세요.');
  const candidate=source.cloneNode(true);
  const left=locate(candidate,partId,measureIndex,eventIndex);
  const right=locate(candidate,partId,nextMeasureIndex,endEventIndex);
  const starts=all(one(left.note,'notations'),'slur').filter(n=>n.getAttribute('type')==='start');
  const stops=all(one(right.note,'notations'),'slur').filter(n=>n.getAttribute('type')==='stop');
  const matched=starts.find(s=>stops.some(t=>(s.getAttribute('number')||'1')===(t.getAttribute('number')||'1')));
  if(matched){
    const number=matched.getAttribute('number')||'1';
    for(const [note,kind] of [[left.note,'start'],[right.note,'stop']]){
      const notation=one(note,'notations');
      for(const n of all(notation,'slur'))if(n.getAttribute('type')===kind&&
        (n.getAttribute('number')||'1')===number)notation.removeChild(n);
      if(!notation.children.length)note.removeChild(notation);
    }
  }else{
    const occupied=new Set();
    for(const measure of all(left.part,'measure'))for(const note of all(measure,'note'))
      for(const slur of all(one(note,'notations'),'slur')){
        const n=Number(slur.getAttribute('number')||'1');
        if(integer(n,1,6))occupied.add(n);
      }
    const number=[1,2,3,4,5,6].find(n=>!occupied.has(n));
    if(!number)fail('기존 이음줄이 많아 새로운 연결 번호를 지정할 수 없습니다.');
    for(const [note,kind] of [[left.note,'start'],[right.note,'stop']]){
      let notation=one(note,'notations');
      if(!notation){
        notation=make(note,'notations');
        note.insertBefore(notation,one(note,'lyric')||null);
      }
      const n=make(notation,'slur');n.setAttribute('type',kind);
      n.setAttribute('number',String(number));
      notation.appendChild(n);
    }
  }
  assertPreserved(source,candidate,partId,measureIndex,lane(start.event));
  assertPreserved(source,candidate,partId,nextMeasureIndex,lane(start.event));
  return {doc:candidate,change:{action:matched?'crossbar-slur-remove':'crossbar-slur-add',
    partId,measureIndex,eventIndex,endMeasureIndex:nextMeasureIndex,endEventIndex}};
}
