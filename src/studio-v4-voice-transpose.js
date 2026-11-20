// Scoped chromatic transposition of ONE written voice in a selected measure
// range, including chords, tuplets, lyrics, ties and articulations. Unlike a
// whole-part transposition, all notes in other voices remain strictly intact.
// Tie endpoints outside the edited interval are rejected to avoid detuning.
import {readWrittenMidi,writeWrittenMidi} from './studio-v4-passage-transpose.js';
import {assertScopedScoreMutation} from './studio-v4-structural-guard.js';
import {inspectAdvancedMeasure} from './advanced-score.js';

const all=(n,t)=>n?[...n.children].filter(c=>c.localName===t):[];
const first=(n,t)=>all(n,t)[0]||null;
const val=(n,t)=>first(n,t)?.textContent?.trim()||'';
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const fail=m=>{throw new Error(m);};
const SHARP=Object.freeze([['C',0],['C',1],['D',0],['D',1],['E',0],['F',0],
  ['F',1],['G',0],['G',1],['A',0],['A',1],['B',0]]);
const FLAT=Object.freeze([['C',0],['D',-1],['D',0],['E',-1],['E',0],
  ['F',0],['G',-1],['G',0],['A',-1],['A',0],['B',-1],['B',0]]);
function snapshot(n){
  if(!n)return null;
  const attrs=[...n.attributes].map(a=>[a.name,a.value]).sort((a,b)=>
    a[0].localeCompare(b[0]));
  const children=[...n.children];
  return [n.localName,attrs,children.length?children.map(snapshot):n.textContent];
}
function tieTypes(note,tag){
  const items=tag==='tie'?all(note,'tie'):all(first(note,'notations'),'tied');
  if(items.length>2||items.some(x=>[...x.attributes].some(a=>a.name!=='type')))
    fail('특수 붙임줄 속성이 있어 선택 성부를 안전하게 이조하지 않습니다.');
  const result=items.map(x=>x.getAttribute('type'));
  if(result.some(x=>!['start','stop'].includes(x))||new Set(result).size!==result.length)
    fail('붙임줄의 시작·종료 표기가 올바르지 않습니다.');
  return result;
}
function validateTieBoundary(part,voice,start,end){
  const pending=new Map();
  let checked=0;
  for(const [i,bar] of all(part,'measure').entries()){
    for(const note of all(bar,'note')){
      if((val(note,'voice')||'1')!==voice)continue;
      const sound=tieTypes(note,'tie'),written=tieTypes(note,'tied');
      if(sound.length!==written.length||sound.some(x=>!written.includes(x)))
        fail('소리·악보용 붙임줄이 서로 다릅니다.');
      if(!sound.length)continue;
      if(first(note,'grace')||first(note,'rest')||first(note,'unpitched'))
        fail('일반 음표가 아닌 기호에 붙임줄이 있습니다.');
      const midi=readWrittenMidi(note);
      if(midi===null)fail('붙임줄 음정이 누락됐습니다.');
      const key=(val(note,'staff')||'1')+'/'+midi;
      if(sound.includes('stop')){
        const earlier=pending.get(key);
        if(earlier===undefined)
          fail('붙임줄의 시작 음표가 없거나 음정이 다른 성부와 연결됐습니다.');
        const leftIn=earlier>=start&&earlier<=end,rightIn=i>=start&&i<=end;
        if(leftIn!==rightIn)
          fail('붙임줄이 선택한 마디 범위 밖으로 이어집니다. 전체 연결을 포함해 선택하세요.');
        pending.delete(key);
      }
      if(sound.includes('start')){
        if(pending.has(key))
          fail('종료되지 않은 동일 음정 붙임줄이 중복됐습니다.');
        pending.set(key,i);
      }
      if(++checked>5000)fail('붙임줄 연결 구조가 너무 큽니다.');
    }
  }
  if(pending.size)fail('종료되지 않은 붙임줄이 있어 선택 성부 이조를 보호합니다.');
}
export function transposeWrittenVoice(source,{
  partId,voice='1',start,end,semitones=2,spelling='sharp',enharmonicOnly=false
}={}){
  if(source?.documentElement?.localName!=='score-partwise'||
     typeof partId!=='string'||!partId||!/^[1-4]$/.test(String(voice))||
     !integer(start,0,127)||!integer(end,start,127)||end-start+1>16||
     !integer(semitones,-12,12)||typeof enharmonicOnly!=='boolean'||
     (enharmonicOnly?semitones!==0:semitones===0)||
     !['sharp','flat'].includes(spelling))
    fail('악기·성부(1~4)·마디 범위 또는 이조 설정을 확인해 주세요.');
  const parts=all(source.documentElement,'part');
  if(!parts.length||parts.length>12||
     parts.filter(p=>p.getAttribute('id')===partId).length!==1)
    fail('선택한 악기 파트가 없거나 중복됐습니다.');
  const part=parts.find(p=>p.getAttribute('id')===partId);
  const bars=all(part,'measure');
  if(end>=bars.length)
    fail('이조할 마디가 악보 범위를 벗어났습니다.');
  if(bars.some(b=>all(b,'attributes').some(a=>first(a,'transpose'))))
    fail('이조 악기는 기보·실음의 차이를 확인해야 하므로 자동 변경하지 않습니다.');
  validateTieBoundary(part,String(voice),start,end);
  const changes=[];
  let tuplets=0,chords=0;
  for(let index=start;index<=end;index++){
    const bar=bars[index];
    if(bar.getAttribute('implicit')==='yes'||bar.getAttribute('non-controlling')==='yes')
      fail('못갖춘마디·비표준 마디는 선택 성부 이조를 보호합니다.');
    if(all(bar,'harmony').length)
      fail('이 구간에는 전체 화성을 나타내는 코드 기호가 있습니다. 파트 전체 이조를 이용하세요.');
    const audit=inspectAdvancedMeasure(source,partId,index);
    if(audit.reason)fail('선택한 마디의 박자·성부 구조가 올바르지 않습니다: '+audit.reason);
    const notes=all(bar,'note');
    for(const [eventIndex,note] of notes.entries()){
      if((val(note,'voice')||'1')!==String(voice)||first(note,'rest'))continue;
      if(first(note,'unpitched')||first(note,'cue')||first(note,'grace')||
         note.attributes?.length||all(note,'accidental').length>1||
         all(note,'accidental').some(a=>a.attributes?.length||a.children.length))
        fail('이 성부에는 꾸밈음·큐음·타악기·특수 임시표가 있어 이조를 보호합니다.');
      const p=first(note,'pitch');
      if(p?.attributes?.length)
        fail('복잡한 음정 속성을 가진 음표는 이조하지 않습니다.');
      const original=readWrittenMidi(note);
      if(original===null)fail('선택 성부의 음정이 누락됐습니다.');
      const target=original+semitones;
      if(!integer(target,12,127))
        fail('이조 결과가 지원 음역을 벗어납니다.');
      const event=audit.events[eventIndex];
      if(!event)fail('성부 음표 위치의 시간표가 올바르지 않습니다.');
      if(enharmonicOnly){
        const expected=(spelling==='flat'?FLAT:SHARP)[target%12];
        const oldStep=val(p,'step'),oldAlter=Number(val(p,'alter')||'0'),
          oldOctave=Number(val(p,'octave'));
        const newOctave=Math.floor(target/12)-1;
        if(oldStep===expected[0]&&oldAlter===expected[1]&&
           oldOctave===newOctave)continue;
      }
      if(event.tuplet)tuplets++;
      if(first(note,'chord'))chords++;
      changes.push({index,eventIndex,midi:target});
      if(changes.length>5000)fail('한 번에 5천 음표 이상 이조할 수 없습니다.');
    }
  }
  if(!changes.length)
    fail(enharmonicOnly?'선택한 성부에 바꿀 이명동음 표기가 없습니다.':
      '선택한 성부와 마디에 이조할 음표가 없습니다.');
  const doc=source.cloneNode(true);
  const changedPart=all(doc.documentElement,'part')
    .find(p=>p.getAttribute('id')===partId),newBars=all(changedPart,'measure');
  const changed=new Map();
  for(const item of changes){
    const note=all(newBars[item.index],'note')[item.eventIndex];
    writeWrittenMidi(note,item.midi,spelling);
    if(readWrittenMidi(note)!==item.midi)
      fail('선택한 성부의 이조 결과 음정이 올바르지 않습니다.');
    if(!changed.has(item.index))changed.set(item.index,new Set());
    changed.get(item.index).add(item.eventIndex);
  }
  for(let i=start;i<=end;i++){
    const oldNotes=all(bars[i],'note'),newNotes=all(newBars[i],'note');
    if(oldNotes.length!==newNotes.length)
      fail('이조 도중 음표가 누락됐습니다.');
    for(let j=0;j<oldNotes.length;j++){
      if(!changed.get(i)?.has(j)&&
         JSON.stringify(snapshot(oldNotes[j]))!==JSON.stringify(snapshot(newNotes[j])))
        fail('이조하지 않은 다른 성부·음표 내용이 변경됐습니다.');
    }
    const before=inspectAdvancedMeasure(source,partId,i),
      after=inspectAdvancedMeasure(doc,partId,i);
    if(after.reason||after.max!==before.max||
       JSON.stringify(after.events.map(e=>[e.start,e.duration,e.voice,e.staff,
         e.rest,e.chord,e.tuplet]))!==
       JSON.stringify(before.events.map(e=>[e.start,e.duration,e.voice,e.staff,
         e.rest,e.chord,e.tuplet])))
      fail('성부 이조 도중 악보의 박자·잇단음 구조가 변경됐습니다.');
  }
  assertScopedScoreMutation(source,doc,{partIds:[partId],
    start,end,kind:'pitches'});
  return {doc,change:{action:enharmonicOnly?'respell-written-voice':'transpose-written-voice',
    partId,voice:String(voice),start,end,semitones,spelling,notes:changes.length,
    tuplets,chords,enharmonicOnly,nextMeasureIndex:start,nextEventIndex:0}};
}
export function respellWrittenVoice(source,options={}){
  return transposeWrittenVoice(source,{...options,semitones:0,enharmonicOnly:true});
}
