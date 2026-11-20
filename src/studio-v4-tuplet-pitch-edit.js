// Edit the melody of an EXISTING MusicXML 3:2, 5:4, 6:4 or 7:4 tuplet
// without recreating its note, lyric, beam, notation or voice structure.
// Selections resolve the whole numbered group; external tied notes and
// ambiguously nested/overlapping tuplets are explicitly refused.
import {inspectAdvancedMeasure} from './advanced-score.js';
import {editConnectedPitch} from './studio-v4-connected-pitch.js';
import {assertScopedScoreMutation} from './studio-v4-structural-guard.js';

const children=(p,name)=>p?[...p.children].filter(n=>n.localName===name):[];
const first=(p,name)=>children(p,name)[0]||null;
const value=(p,name)=>first(p,name)?.textContent?.trim()||'';
const fail=m=>{throw new Error(m);};
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const RATIOS=new Set(['3:2','5:4','6:4','7:4']);
const parsePitch=token=>{
  const m=/^([A-Ga-g])((?:##|bb|#|b|♯|♭)?)([1-8])$/.exec(token);
  if(!m)fail('잇단음 음정은 C4, F#4, Bb4처럼 입력해 주세요.');
  const shift={'':0,'#':1,'##':2,'b':-1,'bb':-2,'♯':1,'♭':-1}[m[2]];
  return {step:m[1].toUpperCase(),alter:shift,octave:Number(m[3])};
};
export function parseTupletPitchSequence(input){
  if(typeof input!=='string'||input.length>180)
    fail('잇단음 음정 입력은 180자 이하여야 합니다.');
  const tokens=input.trim().split(/[\s,;]+/).filter(Boolean);
  if(tokens.length<3||tokens.length>7)
    fail('잇단음은 3~7개의 음정을 정확히 입력해야 합니다.');
  return tokens.map(parsePitch);
}
function markers(note){
  return children(first(note,'notations'),'tuplet').map(n=>({
    type:n.getAttribute('type'),number:n.getAttribute('number')||'1'
  }));
}
function ratioOf(note){
  const tm=first(note,'time-modification');
  if(!tm||children(note,'time-modification').length!==1)
    fail('잇단음 음표에 MusicXML 박자 비율이 없습니다.');
  const actual=Number(value(tm,'actual-notes')),normal=Number(value(tm,'normal-notes'));
  if(!integer(actual,3,7)||!integer(normal,2,4)||!RATIOS.has(actual+':'+normal)||
     children(tm,'actual-notes').length!==1||children(tm,'normal-notes').length!==1)
    fail('지원하지 않는 잇단음 비율 또는 중복된 시간 정보입니다.');
  return {actual,normal};
}
export function inspectEditableTuplet(source,{partId,measureIndex,eventIndex}={}){
  if(source?.documentElement?.localName!=='score-partwise'||!partId||
     !integer(measureIndex,0,255)||!integer(eventIndex,0,49999))
    fail('잇단음 위치나 악보 형식이 올바르지 않습니다.');
  const parts=children(source.documentElement,'part')
    .filter(p=>p.getAttribute('id')===partId);
  if(parts.length!==1)fail('악기 파트가 없거나 중복됐습니다.');
  const measure=children(parts[0],'measure')[measureIndex];
  if(!measure)fail('잇단음 마디를 찾지 못했습니다.');
  const audit=inspectAdvancedMeasure(source,partId,measureIndex);
  if(audit.reason)fail('이 마디는 복잡한 박자 구조로 인해 수정할 수 없습니다: '+audit.reason);
  const notes=children(measure,'note');
  if(!audit.events[eventIndex]?.tuplet||!notes[eventIndex])
    fail('잇단음 안의 음표를 선택해 주세요.');
  let open=null;const groups=[];
  for(const [i,note] of notes.entries()){
    const m=markers(note);
    if(m.length>1)fail('중첩된 잇단음은 그룹 일괄 편집 대상에서 제외됩니다.');
    const begin=m[0]?.type==='start',end=m[0]?.type==='stop';
    if(m.length&&(!begin&&!end||!integer(Number(m[0].number),1,6)))
      fail('잇단음 시작·종료 표기가 유효하지 않습니다.');
    if(begin){
      if(open)fail('중첩·교차 잇단음은 안전하게 수정할 수 없습니다.');
      open={number:m[0].number,start:i,indices:[],lane:null,ratio:null};
    }
    if(open){
      const e=audit.events[i],ratio=ratioOf(note);
      const lane=e.voice+'@'+e.staff;
      if(e.rest||e.chord||first(note,'tie')||children(first(note,'notations'),'tied').length||
         first(note,'grace')||first(note,'cue')||!first(note,'pitch'))
        fail('잇단음의 쉼표·화음·붙임줄·꾸밈음은 개별 그룹 편집에서 보호합니다.');
      if(open.lane!==null&&open.lane!==lane)
        fail('잇단음에 서로 다른 성부가 섞여 있습니다.');
      if(open.ratio!==null&&(open.ratio.actual!==ratio.actual||
         open.ratio.normal!==ratio.normal))
        fail('잇단음 그룹의 박자 비율이 서로 다릅니다.');
      open.lane=lane;open.ratio=ratio;open.indices.push(i);
    }
    if(end){
      if(!open||open.number!==m[0].number)
        fail('잇단음 번호와 종료 표기가 일치하지 않습니다.');
      if(open.indices.length!==open.ratio.actual)
        fail('잇단음 그룹의 실제 음표 수가 선언된 비율과 다릅니다.');
      groups.push(open);open=null;
    }
  }
  if(open)fail('잇단음이 현재 마디 밖으로 이어지거나 종료되지 않았습니다.');
  const found=groups.filter(g=>g.indices.includes(eventIndex));
  if(found.length!==1)fail('선택한 음표의 시작·끝이 확인되는 잇단음 그룹이 없습니다.');
  return {partId,measureIndex,selectedEventIndex:eventIndex,
    indices:found[0].indices,actual:found[0].ratio.actual,
    normal:found[0].ratio.normal,voice:found[0].lane.split('@')[0],
    staff:found[0].lane.split('@')[1],count:found[0].indices.length};
}
export function editTupletPitches(source,params={}){
  const group=inspectEditableTuplet(source,params);
  const pitches=Array.isArray(params.pitches)?params.pitches.map(p=>{
    if(typeof p!=='string')fail('음정 입력 목록이 문자열이어야 합니다.');
    return parsePitch(p);
  }):parseTupletPitchSequence(params.pitches);
  if(pitches.length!==group.count)
    fail('선택한 잇단음의 '+group.count+'개 음정이 모두 필요합니다.');
  let output=source,changedCount=0;
  const selected=new Set(group.indices);
  for(const [i,index] of group.indices.entries()){
    const bars=children(children(output.documentElement,'part')
      .find(p=>p.getAttribute('id')===group.partId),'measure');
    const note=children(bars[group.measureIndex],'note')[index];
    const pitch=first(note,'pitch'),next=pitches[i];
    const oldStep=value(pitch,'step'),oldAlter=Number(value(pitch,'alter')||0),
      oldOctave=Number(value(pitch,'octave'));
    if(oldStep===next.step&&oldAlter===next.alter&&oldOctave===next.octave)continue;
    output=editConnectedPitch(output,{partId:group.partId,measureIndex:group.measureIndex,
      eventIndex:index,...next}).doc;
    changedCount++;
  }
  if(!changedCount)fail('선택한 잇단음은 이미 입력한 음정과 같습니다.');
  assertScopedScoreMutation(source,output,{partIds:[group.partId],
    start:group.measureIndex,end:group.measureIndex,kind:'pitches'});
  const sourceNotes=children(children(children(source.documentElement,'part')
    .find(p=>p.getAttribute('id')===group.partId),'measure')[group.measureIndex],'note');
  const resultNotes=children(children(children(output.documentElement,'part')
    .find(p=>p.getAttribute('id')===group.partId),'measure')[group.measureIndex],'note');
  for(let i=0;i<sourceNotes.length;i++)if(!selected.has(i)){
    const before=first(sourceNotes[i],'pitch'),after=first(resultNotes[i],'pitch');
    if((before?.textContent??null)!==(after?.textContent??null))
      fail('선택 잇단음 밖의 음정이 변경되어 작업을 차단했습니다.');
  }
  return {doc:output,change:{action:'edit-tuplet-pitches',partId:group.partId,
    measureIndex:group.measureIndex,eventIndex:group.selectedEventIndex,
    actual:group.actual,normal:group.normal,editedNotes:changedCount,
    nextMeasureIndex:group.measureIndex,nextEventIndex:group.indices[0]}};
}
