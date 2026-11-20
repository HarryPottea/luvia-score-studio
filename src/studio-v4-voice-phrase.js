// Move a contiguous phrase of ordinary sounding notes between independently
// timed written voices in one MusicXML measure. Each note uses the verified
// note-to-rest transaction; later events are located by ORIGINAL musical time
// and voice, never by stale DOM index after rests are split. Atomic: only the
// fully validated final clone is returned.
import {inspectAdvancedMeasure} from './advanced-score.js';
import {moveNoteToRestingVoice} from './studio-v4-voice-transfer.js';

const fail=m=>{throw new Error(m);};
const int=(n,lo,hi)=>Number.isSafeInteger(n)&&n>=lo&&n<=hi;
const all=(n,t)=>n?[...n.children].filter(x=>x.localName===t):[];
function getPart(source,partId){
  if(source?.documentElement?.localName!=='score-partwise'||
     typeof partId!=='string'||!partId)fail('올바른 MusicXML 악기 파트가 아닙니다.');
  const parts=all(source.documentElement,'part').filter(p=>p.getAttribute('id')===partId);
  if(parts.length!==1)fail('파트 ID가 중복됐거나 찾을 수 없습니다.');
  return parts[0];
}
export function inspectTransferableVoicePhrase(source,{
  partId,measureIndex,startEventIndex,endEventIndex,targetVoice='2'
}={}){
  const part=getPart(source,partId);
  if(!int(measureIndex,0,255)||!int(startEventIndex,0,50000)||
     !int(endEventIndex,startEventIndex,50000)||
     !/^[1-4]$/.test(String(targetVoice)))
    fail('이동할 연속 음표 구간과 대상 성부를 확인해 주세요.');
  const bar=all(part,'measure')[measureIndex];
  if(!bar)fail('선택한 마디를 찾지 못했습니다.');
  const audit=inspectAdvancedMeasure(source,partId,measureIndex);
  if(audit.reason)fail('선택한 마디의 시간표가 올바르지 않습니다: '+audit.reason);
  const selection=audit.events.slice(startEventIndex,endEventIndex+1);
  if(selection.length<2||selection.length>16)
    fail('한 번에 이동할 음표는 같은 마디의 연속된 2~16개입니다.');
  const lane=selection[0].voice,staff=selection[0].staff;
  if(lane===String(targetVoice)||
     selection.some(e=>e.voice!==lane||e.staff!==staff||e.chord||
       e.rest||e.tuplet||e.protectedMarkup||!e.editablePitch))
    fail('일반 음표가 아닌 복잡한 기보나 다른 성부가 섞여 있어 구간 이동을 차단합니다.');
  for(let i=1;i<selection.length;i++){
    if(selection[i].start!==selection[i-1].start+selection[i-1].duration)
      fail('중간에 쉼표나 시간 간격이 있는 구간은 한 번에 이동하지 않습니다.');
  }
  const firstStart=selection[0].start,
    lastEnd=selection.at(-1).start+selection.at(-1).duration;
  const restEvents=audit.events.filter(e=>e.voice===String(targetVoice)&&
    e.staff===staff&&e.rest&&!e.chord&&!e.tuplet);
  // Verify each original note can be covered by a single target rest before
  // attempting any edit. This also blocks an overlap with existing notes.
  for(const note of selection){
    if(restEvents.filter(rest=>rest.start<=note.start&&
       rest.start+rest.duration>=note.start+note.duration).length!==1)
      fail('대상 성부에 선택 구간을 덮는 빈 쉼표가 충분하지 않습니다.');
  }
  return {partId,measureIndex,sourceVoice:lane,targetVoice:String(targetVoice),
    staff,startEventIndex,endEventIndex,notes:selection.map(e=>({
      start:e.start,duration:e.duration,step:e.step,alter:e.alter,
      octave:e.octave
    })),firstStart,lastEnd};
}
export function transferVoicePhrase(source,params={}){
  const plan=inspectTransferableVoicePhrase(source,params);
  let candidate=source,splitRests=0,lyrics=0;
  const transactionNotes=[];
  for(const planned of plan.notes){
    const audit=inspectAdvancedMeasure(candidate,plan.partId,plan.measureIndex);
    if(audit.reason)fail('성부 이동 도중 시간표를 검증하지 못했습니다.');
    const matching=audit.events.filter(e=>e.voice===plan.sourceVoice&&
      e.staff===plan.staff&&e.start===planned.start&&
      e.duration===planned.duration&&!e.rest&&!e.chord&&
      e.step===planned.step&&e.alter===planned.alter&&
      e.octave===planned.octave);
    if(matching.length!==1)
      fail('이동 중 원래 음표의 음정·박자 위치가 변경됐습니다.');
    const result=moveNoteToRestingVoice(candidate,{
      partId:plan.partId,measureIndex:plan.measureIndex,
      eventIndex:matching[0].eventIndex,targetVoice:plan.targetVoice
    });
    candidate=result.doc;
    splitRests+=result.change.splitRestCount;
    lyrics+=result.change.movedLyrics;
    transactionNotes.push(result.change.nextEventIndex);
  }
  const after=inspectAdvancedMeasure(candidate,plan.partId,plan.measureIndex);
  if(after.reason)fail('연속 음표 이동 뒤 악보 시간표가 손상됐습니다.');
  for(const expected of plan.notes){
    if(after.events.filter(e=>e.voice===plan.sourceVoice&&e.staff===plan.staff&&
      e.start===expected.start&&e.duration===expected.duration&&e.rest).length!==1 ||
       after.events.filter(e=>e.voice===plan.targetVoice&&e.staff===plan.staff&&
      e.start===expected.start&&e.duration===expected.duration&&!e.rest&&
      e.step===expected.step&&e.alter===expected.alter&&
      e.octave===expected.octave).length!==1)
      fail('구간의 일부 음표가 누락되거나 잘못된 성부로 이동됐습니다.');
  }
  return {doc:candidate,change:{action:'voice-phrase-transfer',
    partId:plan.partId,measureIndex:plan.measureIndex,
    sourceVoice:plan.sourceVoice,targetVoice:plan.targetVoice,
    movedNotes:plan.notes.length,movedLyrics:lyrics,splitRestCount:splitRests,
    nextMeasureIndex:plan.measureIndex,nextEventIndex:transactionNotes[0]}};
}
