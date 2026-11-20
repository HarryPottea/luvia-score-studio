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
function swapPitchAndRest(note,rest){
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
    e.start===chosen.start&&e.duration===chosen.duration&&e.rest&&!e.chord&&!e.tuplet);
  if(available.length!==1)
    fail('같은 시점·길이·보표에 정확히 일치하는 대상 성부의 빈 쉼표가 필요합니다.');
  const target=available[0];
  const sourceNote=notes[eventIndex],targetRest=notes[target.eventIndex];
  guard(sourceNote,false);guard(targetRest,true);
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const rhythm=n=>[val(n,'duration'),val(n,'type'),all(n,'dot').map(cloneXML),
    val(n,'staff')||'1'];
  if(!same(rhythm(sourceNote),rhythm(targetRest)))
    fail('두 성부의 음표 길이·점·보표 표기가 달라 이동하지 않습니다.');
  const doc=source.cloneNode(true),copyPart=all(doc.documentElement,'part')
    .find(p=>p.getAttribute('id')===partId),copyBars=all(copyPart,'measure');
  const copyNotes=all(copyBars[measureIndex],'note');
  swapPitchAndRest(copyNotes[eventIndex],copyNotes[target.eventIndex]);
  const after=inspectAdvancedMeasure(doc,partId,measureIndex);
  if(after.reason||after.max!==audit.max||after.events.length!==audit.events.length)
    fail('음표 이동 후 성부·박자 구조 검증에 실패했습니다.');
  for(const [i,old] of audit.events.entries()){
    const fresh=after.events[i];
    if(fresh.start!==old.start||fresh.duration!==old.duration||
       fresh.voice!==old.voice||fresh.staff!==old.staff||fresh.chord!==old.chord)
      fail('음표 이동으로 원래 성부의 박자가 변경됐습니다.');
    if(i!==eventIndex&&i!==target.eventIndex&&
       cloneXML(notes[i])!==cloneXML(copyNotes[i]))
      fail('이동 대상 밖의 음악 데이터가 변경됐습니다.');
  }
  if(!after.events[eventIndex].rest||after.events[target.eventIndex].rest||
     after.events[target.eventIndex].step!==chosen.step||
     after.events[target.eventIndex].alter!==chosen.alter||
     after.events[target.eventIndex].octave!==chosen.octave)
    fail('음정이나 쉼표 이동 결과가 올바르지 않습니다.');
  return {doc,change:{action:'move-note-between-voices',partId,measureIndex,
    sourceVoice:chosen.voice,targetVoice,movedLyrics:all(sourceNote,'lyric').length,
    nextMeasureIndex:measureIndex,nextEventIndex:target.eventIndex}};
}
