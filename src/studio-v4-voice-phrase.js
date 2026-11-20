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


// Multi-bar full-voice migration. Every measure is independently checked
// BEFORE editing: complete contiguous source lane, one staff, no protected
// markup and target notes have matching available rests. All transformations
// remain on ephemeral MusicXML clones; any failure aborts the entire passage.
export function transferVoiceAcrossMeasures(source,{
  partId,startMeasureIndex,endMeasureIndex,sourceVoice,targetVoice='2',staff='1'
}={}){
  const part=getPart(source,partId);
  if(!int(startMeasureIndex,0,255)||!int(endMeasureIndex,startMeasureIndex,255)||
     endMeasureIndex-startMeasureIndex+1<2||endMeasureIndex-startMeasureIndex+1>8||
     !/^[1-4]$/.test(String(sourceVoice))||
     !/^[1-4]$/.test(String(targetVoice))||
     sourceVoice===targetVoice||!/^[1-9][0-9]*$/.test(String(staff))||
     !all(part,'measure')[endMeasureIndex])
    fail('이동 구간은 연속된 2~8마디이며, 출발·도착 성부는 달라야 합니다.');
  const plans=[];
  for(let index=startMeasureIndex;index<=endMeasureIndex;index++){
    const audit=inspectAdvancedMeasure(source,partId,index);
    if(audit.reason)fail((index+1)+'마디의 시간 구조가 유효하지 않습니다: '+audit.reason);
    const selected=audit.events.filter(e=>e.voice===String(sourceVoice)&&
      e.staff===String(staff));
    if(!selected.length||selected.length>16||selected[0].start!==0||
       selected.at(-1).start+selected.at(-1).duration!==audit.max||
       selected.some(e=>e.rest||e.chord||e.tuplet||e.protectedMarkup||!e.editablePitch))
      fail((index+1)+'마디에서 시작부터 끝까지 이어지는 일반 음표 성부가 필요합니다.');
    for(let j=1;j<selected.length;j++){
      if(selected[j].start!==selected[j-1].start+selected[j-1].duration)
        fail((index+1)+'마디에는 이동할 수 없는 시간 공백이 있습니다.');
    }
    if(selected.length>1){
      const plan=inspectTransferableVoicePhrase(source,{
        partId,measureIndex:index,startEventIndex:selected[0].eventIndex,
        endEventIndex:selected.at(-1).eventIndex,targetVoice:String(targetVoice)
      });
      if(plan.notes.length!==selected.length)
        fail((index+1)+'마디 구간에 다른 성부의 음표가 섞여 있습니다.');
    }else{
      const only=selected[0];
      const rest=audit.events.filter(e=>e.voice===String(targetVoice)&&
        e.staff===String(staff)&&e.rest&&!e.chord&&!e.tuplet&&
        e.start<=only.start&&e.start+e.duration>=only.start+only.duration);
      if(rest.length!==1)
        fail((index+1)+'마디의 대상 성부에 빈 쉼표가 없습니다.');
    }
    plans.push({index,selection:selected});
  }
  let candidate=source,totalNotes=0,totalLyrics=0,splitRests=0;
  for(const plan of plans){
    const firstEvent=plan.selection[0].eventIndex,
      lastEvent=plan.selection.at(-1).eventIndex;
    const result=plan.selection.length===1?
      moveNoteToRestingVoice(candidate,{
        partId,measureIndex:plan.index,eventIndex:firstEvent,
        targetVoice:String(targetVoice)
      }):
      transferVoicePhrase(candidate,{
        partId,measureIndex:plan.index,startEventIndex:firstEvent,
        endEventIndex:lastEvent,targetVoice:String(targetVoice)
      });
    candidate=result.doc;
    totalNotes+=result.change.movedNotes||1;
    totalLyrics+=result.change.movedLyrics;
    splitRests+=result.change.splitRestCount;
  }
  if(totalNotes!==plans.reduce((n,p)=>n+p.selection.length,0))
    fail('연속 마디의 음표 이동 개수가 일치하지 않습니다.');
  return {doc:candidate,change:{action:'multi-measure-voice-transfer',partId,
    startMeasureIndex,endMeasureIndex,sourceVoice:String(sourceVoice),
    targetVoice:String(targetVoice),measures:plans.length,movedNotes:totalNotes,
    movedLyrics:totalLyrics,splitRestCount:splitRests,
    nextMeasureIndex:startMeasureIndex,
    nextEventIndex:plans[0].selection[0].eventIndex}};
}
