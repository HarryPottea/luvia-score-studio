// Retarget one ordinary note to a simultaneous rest in another written voice.
// Neither lane changes its time grid, backup/forward operators, nor staff.
// The source becomes a rest; the destination inherits its pitch and lyrics.
// Protected tuplets, ties, chords, grace notes, beaming and expressive
// notations are rejected until a dedicated notation-preserving move exists.
import {inspectAdvancedMeasure} from './advanced-score.js';

const all=(node,tag)=>node?[...node.children].filter(n=>n.localName===tag):[];
const one=(node,tag)=>all(node,tag)[0]||null;
const val=(node,tag)=>one(node,tag)?.textContent?.trim()||'';
const fail=text=>{throw new Error(text);};
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const cloneXML=n=>{
  if(!n)return null;
  const attrs=[...n.attributes].map(a=>[a.name,a.value]).sort((a,b)=>a[0].localeCompare(b[0]));
  const children=[...n.children];
  return JSON.stringify([n.localName,attrs,children.length?children.map(cloneXML):n.textContent]);
};
function create(parent,tag){
  const d=parent.ownerDocument;
  return d.createElementNS?d.createElementNS(parent.namespaceURI??null,tag):d.createElement(tag);
}
const PITCH_TAGS=new Set(['pitch','duration','voice','type','dot','staff',
  'lyric','accidental','stem']);
const REST_TAGS=new Set(['rest','duration','voice','type','dot','staff']);
function guard(note,rest){
  const tags=rest?REST_TAGS:PITCH_TAGS;
  if(note.attributes?.length||
     [...note.children].some(n=>!tags.has(n.localName))||
     !one(note,rest?'rest':'pitch')||!one(note,'duration')||!one(note,'type')||
     all(note,'lyric').length>4||
     [...note.children].some(n=>n.attributes?.length&&
       !['lyric','accidental','stem'].includes(n.localName)))
    fail('보호된 연결 기보·특수 장식·화음·잇단음은 성부 사이로 이동하지 않습니다.');
  if(rest&&(one(note,'rest').attributes?.length||one(note,'rest').children.length))
    fail('표시 위치를 수동 지정한 쉼표는 보호합니다.');
  if(!rest&&all(note,'pitch').length!==1)
    fail('음정이 여러 개인 음표는 다른 성부로 이동할 수 없습니다.');
}
const WRITTEN_UNITS=[['whole',4,0],['half',3,1],['half',2,0],
  ['quarter',1.5,1],['quarter',1,0],['eighth',.75,1],['eighth',.5,0],
  ['16th',.375,1],['16th',.25,0],['32nd',.125,0]];
function pieces(ticks,divisions){
  if(!integer(ticks,0,262144)||!integer(divisions,1,65536))
    fail('대상 성부의 잔여 쉼표 길이를 계산할 수 없습니다.');
  let left=ticks;const output=[];
  for(const [type,beats,dots] of WRITTEN_UNITS){
    const length=divisions*beats;
    if(!integer(length,1,262144))continue;
    while(left>=length){
      output.push({type,duration:length,dots});left-=length;
      if(output.length>32)fail('분할 쉼표가 너무 많습니다.');
    }
  }
  if(left!==0)fail('이 MusicXML divisions에서는 남은 박자를 정확한 쉼표로 표기할 수 없습니다.');
  return output;
}
function writtenLength(note,divisions){
  const type=val(note,'type'),dots=all(note,'dot').length;
  const unit=WRITTEN_UNITS.find(([name,_,count])=>name===type&&count===dots);
  if(!unit||!integer(unit[1]*divisions,1,262144)||
     Number(val(note,'duration'))!==unit[1]*divisions)
    fail('음표 또는 쉼표의 길이와 표기 방식이 일치하지 않습니다.');
}
function restNode(measure,original,unit){
  const n=create(measure,'note');
  n.appendChild(create(n,'rest'));
  const dur=create(n,'duration');dur.textContent=String(unit.duration);n.appendChild(dur);
  if(one(original,'voice'))n.appendChild(one(original,'voice').cloneNode(true));
  const type=create(n,'type');type.textContent=unit.type;n.appendChild(type);
  if(unit.dots)n.appendChild(create(n,'dot'));
  if(one(original,'staff'))n.appendChild(one(original,'staff').cloneNode(true));
  return n;
}
function swapPitchAndRest(note,rest,remainder=[]){
  const pitch=one(note,'pitch'),blank=one(rest,'rest');
  // Only musical content moves. Voice/staff/timing/type/dots of both lanes
  // remain unchanged. Cloned nodes preserve lyrics and accidentals byte-wise.
  const payload=[pitch,...all(note,'accidental'),...all(note,'lyric'),...all(note,'stem')];
  for(const item of payload.slice(1))note.removeChild(item);
  rest.replaceChild(pitch.cloneNode(true),blank);
  const order=['accidental','stem','lyric'];
  for(const tag of order)for(const item of payload.slice(1).filter(n=>n.localName===tag)){
    const before=tag==='accidental'?one(rest,'stem')||one(rest,'staff')||null:
      tag==='stem'?one(rest,'staff')||null:null;
    rest.insertBefore(item.cloneNode(true),before);
  }
  note.replaceChild(create(note,'rest'),pitch);
  if(remainder.length){
    // The original target was a longer rest. Split into a sounded note and
    // trailing rests, never changing the measure's total time span.
    one(rest,'duration').textContent=val(note,'duration');
    one(rest,'type').textContent=val(note,'type');
    for(const dot of all(rest,'dot'))rest.removeChild(dot);
    for(const dot of all(note,'dot'))
      rest.insertBefore(dot.cloneNode(true),one(rest,'staff')||null);
    let cursor=rest;
    for(const unit of remainder){
      const newRest=restNode(rest.parentNode,rest,unit);
      rest.parentNode.insertBefore(newRest,cursor.nextSibling);
      cursor=newRest;
    }
  }
}
export function moveNoteToRestingVoice(source,{
  partId,measureIndex,eventIndex,targetVoice
}={}){
  if(source?.documentElement?.localName!=='score-partwise'||
     typeof partId!=='string'||!partId||
     !integer(measureIndex,0,9999)||!integer(eventIndex,0,99999)||
     typeof targetVoice!=='string'||!/^[1-4]$/.test(targetVoice))
    fail('악기·마디·음표·대상 성부를 올바르게 선택해 주세요.');
  const parts=all(source.documentElement,'part')
    .filter(p=>p.getAttribute('id')===partId);
  if(parts.length!==1)fail('악기 파트 ID가 중복됐거나 없습니다.');
  const measures=all(parts[0],'measure'),bar=measures[measureIndex];
  if(!bar)fail('편집할 마디가 없습니다.');
  const audit=inspectAdvancedMeasure(source,partId,measureIndex);
  if(audit.reason)fail('원본 마디의 성부 구조가 올바르지 않습니다: '+audit.reason);
  const chosen=audit.events[eventIndex],notes=all(bar,'note');
  if(!chosen||!notes[eventIndex]||chosen.rest||chosen.chord||chosen.tuplet||
     chosen.protectedMarkup||chosen.voice===targetVoice)
    fail('이동할 일반 음표와 다른 대상 성부를 선택해 주세요.');
  const available=audit.events.filter(e=>e.voice===targetVoice&&e.staff===chosen.staff&&
    e.start===chosen.start&&e.duration>=chosen.duration&&e.rest&&!e.chord&&!e.tuplet);
  if(available.length!==1)
    fail('같은 시점·보표에 길이가 충분한 대상 성부의 빈 쉼표가 필요합니다.');
  const target=available[0];
  const sourceNote=notes[eventIndex],targetRest=notes[target.eventIndex];
  guard(sourceNote,false);guard(targetRest,true);
  writtenLength(sourceNote,audit.divisions);
  writtenLength(targetRest,audit.divisions);
  if((val(sourceNote,'staff')||'1')!==(val(targetRest,'staff')||'1'))
    fail('서로 다른 보표로 음표를 이동하지 않습니다.');
  const remaining=pieces(target.duration-chosen.duration,audit.divisions);
  const doc=source.cloneNode(true),copyPart=all(doc.documentElement,'part')
    .find(p=>p.getAttribute('id')===partId),copyBars=all(copyPart,'measure');
  const copyNotes=all(copyBars[measureIndex],'note');
  swapPitchAndRest(copyNotes[eventIndex],copyNotes[target.eventIndex],remaining);
  const after=inspectAdvancedMeasure(doc,partId,measureIndex);
  if(after.reason||after.max!==audit.max||
     after.events.length!==audit.events.length+remaining.length)
    fail('음표 이동 후 성부·박자 구조 검증에 실패했습니다.');
  const mapIndex=i=>i+(i>target.eventIndex?remaining.length:0);
  for(const [i,old] of audit.events.entries()){
    const fresh=after.events[mapIndex(i)];
    if(fresh.start!==old.start||
       (i!==target.eventIndex&&fresh.duration!==old.duration)||
       (i===target.eventIndex&&fresh.duration!==chosen.duration)||
       fresh.voice!==old.voice||fresh.staff!==old.staff||fresh.chord!==old.chord)
      fail('음표 이동으로 원래 성부의 박자가 변경됐습니다.');
    if(i!==eventIndex&&i!==target.eventIndex&&
       cloneXML(notes[i])!==cloneXML(all(copyBars[measureIndex],'note')[mapIndex(i)]))
      fail('이동 대상 밖의 음악 데이터가 변경됐습니다.');
  }
  let start=target.start+chosen.duration;
  for(const [i,unit] of remaining.entries()){
    const added=after.events[target.eventIndex+i+1];
    if(!added?.rest||added.voice!==target.voice||added.staff!==target.staff||
       added.start!==start||added.duration!==unit.duration)
      fail('대상 성부에 남은 쉼표의 시간값이 잘못됐습니다.');
    start+=unit.duration;
  }
  const movedSource=after.events[mapIndex(eventIndex)],movedTarget=after.events[target.eventIndex];
  if(!movedSource.rest||movedTarget.rest||
     movedTarget.step!==chosen.step||movedTarget.alter!==chosen.alter||
     movedTarget.octave!==chosen.octave||start!==target.start+target.duration)
    fail('음정이나 쉼표 이동 결과가 올바르지 않습니다.');
  return {doc,change:{action:'move-note-between-voices',partId,measureIndex,
    sourceVoice:chosen.voice,targetVoice,movedLyrics:all(sourceNote,'lyric').length,
    splitRestCount:remaining.length,
    nextMeasureIndex:measureIndex,nextEventIndex:target.eventIndex}};
}
