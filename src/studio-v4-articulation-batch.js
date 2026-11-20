// Deterministic add/remove of one MusicXML articulation across a written
// voice in 1–8 selected measures. Each existing note is edited using the
// independent single-note guarded operation. The complete batch is atomic:
// partial successes never escape to the caller or the editor history.
import {toggleAdvancedArticulation,ADVANCED_ARTICULATIONS}
  from './studio-v4-articulations.js';
import {inspectAdvancedMeasure} from './advanced-score.js';

const all=(n,t)=>n?[...n.children].filter(x=>x.localName===t):[];
const first=(n,t)=>all(n,t)[0]||null;
const val=(n,t)=>first(n,t)?.textContent?.trim()||'';
const fail=m=>{throw new Error(m);};
const integer=(n,lo,hi)=>Number.isSafeInteger(n)&&n>=lo&&n<=hi;
const serialize=n=>{
  if(!n)return null;
  const attrs=[...n.attributes].map(a=>[a.name,a.value])
    .sort((a,b)=>a[0].localeCompare(b[0]));
  const children=[...n.children];
  return [n.localName,attrs,children.length?children.map(serialize):n.textContent];
};
const hasMark=(note,kind)=>!!first(first(first(note,'notations'),'articulations'),kind);
export function editArticulationForVoice(source,{
  partId,voice='1',start,end,kind='staccato',mode='add'
}={}){
  if(source?.documentElement?.localName!=='score-partwise'||
     typeof partId!=='string'||!partId||!/^[1-4]$/.test(String(voice))||
     !integer(start,0,127)||!integer(end,start,127)||end-start+1>8||
     !ADVANCED_ARTICULATIONS.includes(kind)||!['add','remove'].includes(mode))
    fail('악기·성부·1~8마디 범위·아티큘레이션 작업을 확인해 주세요.');
  const parts=all(source.documentElement,'part');
  if(parts.filter(p=>p.getAttribute('id')===partId).length!==1)
    fail('표현 기호를 지정할 파트가 없거나 중복됐습니다.');
  const part=parts.find(p=>p.getAttribute('id')===partId);
  const bars=all(part,'measure');
  if(end>=bars.length)fail('마디 범위가 파트의 끝을 넘었습니다.');
  const targets=[];
  for(let i=start;i<=end;i++){
    const audit=inspectAdvancedMeasure(source,partId,i);
    if(audit.reason)fail('마디의 성부·박자 시간표가 유효하지 않습니다: '+audit.reason);
    const notes=all(bars[i],'note');
    for(const [eventIndex,note] of notes.entries()){
      if((val(note,'voice')||'1')!==String(voice)||first(note,'rest')||
         first(note,'chord'))continue;
      if(first(note,'unpitched')||first(note,'grace')||first(note,'cue'))
        fail('큐·꾸밈·타악기에는 아티큘레이션을 일괄 적용하지 않습니다.');
      const already=hasMark(note,kind);
      if(mode==='add'===already)continue;
      targets.push({measureIndex:i,eventIndex});
      if(targets.length>512)fail('한 번에 512개 음표를 넘어서 수정할 수 없습니다.');
    }
  }
  if(!targets.length)
    fail('선택한 성부에 변경할 아티큘레이션 상태가 없습니다.');
  let candidate=source;
  const changed=new Map();
  for(const target of targets){
    const result=toggleAdvancedArticulation(candidate,{
      partId,kind,...target
    });
    if(result.change.enabled!==(mode==='add'))
      fail('아티큘레이션의 설정·해제 결과가 지정한 상태와 다릅니다.');
    candidate=result.doc;
    if(!changed.has(target.measureIndex))changed.set(target.measureIndex,new Set());
    changed.get(target.measureIndex).add(target.eventIndex);
  }
  const originalParts=all(source.documentElement,'part'),
    nextParts=all(candidate.documentElement,'part');
  if(originalParts.length!==nextParts.length)
    fail('작업 중 악기 파트 수가 변경됐습니다.');
  for(let pi=0;pi<originalParts.length;pi++){
    const beforeBars=all(originalParts[pi],'measure'),
      afterBars=all(nextParts[pi],'measure');
    if(beforeBars.length!==afterBars.length||
       originalParts[pi].getAttribute('id')!==nextParts[pi].getAttribute('id'))
      fail('원본 악기의 마디 구조가 변경됐습니다.');
    for(let i=0;i<beforeBars.length;i++){
      const affected=originalParts[pi].getAttribute('id')===partId&&i>=start&&i<=end;
      if(!affected){
        if(JSON.stringify(serialize(beforeBars[i]))!==
           JSON.stringify(serialize(afterBars[i])))
          fail('편집 대상 밖의 음악 데이터가 변경됐습니다.');
        continue;
      }
      const oldNotes=all(beforeBars[i],'note'),
        newNotes=all(afterBars[i],'note');
      if(oldNotes.length!==newNotes.length)
        fail('수정 후 원래 음표가 누락됐습니다.');
      for(let j=0;j<oldNotes.length;j++){
        if(!changed.get(i)?.has(j)&&JSON.stringify(serialize(oldNotes[j]))!==
           JSON.stringify(serialize(newNotes[j])))
          fail('선택하지 않은 성부의 기보가 변경됐습니다.');
      }
    }
  }
  return {doc:candidate,change:{action:'edit-articulation-voice',
    partId,voice:String(voice),start,end,kind,mode,
    updatedNotes:targets.length,
    nextMeasureIndex:start,nextEventIndex:targets[0].eventIndex}};
}
