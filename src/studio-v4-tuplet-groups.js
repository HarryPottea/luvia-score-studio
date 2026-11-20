// Generalized 3:2, 5:4, 6:4 and 7:4 tuplet authoring for ordinary notes.
//
// MusicXML uses integer <duration> ticks. For source scores with divisions
// incompatible with the selected ratio, this transform scales all duration
// clocks and declared divisions of the selected PART by a bounded exact
// integer. No other instrument part is changed. The full input stays immutable.
import {inspectAdvancedMeasure} from './advanced-score.js';

const RATIO=Object.freeze({'3:2':[3,2],'5:4':[5,4],'6:4':[6,4],'7:4':[7,4]});
const LENGTH=Object.freeze({quarter:1,eighth:2,'16th':4,'32nd':8});
const STEPS='CDEFGAB';
const kids=(n,t)=>n?[...n.children].filter(c=>c.localName===t):[];
const one=(n,t)=>kids(n,t)[0]||null;
const val=(n,t)=>one(n,t)?.textContent?.trim()||'';
const isInt=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const reject=s=>{throw new Error(s);};
function node(parent,name,text){
  const d=parent.ownerDocument;
  const e=d.createElementNS?d.createElementNS(parent.namespaceURI??null,name):d.createElement(name);
  if(text!==undefined)e.textContent=String(text);
  return e;
}
function findPart(doc,partId){
  if(doc?.documentElement?.localName!=='score-partwise'||typeof partId!=='string'||!partId)
    reject('MusicXML partwise의 악기 파트가 필요합니다.');
  const part=kids(doc.documentElement,'part').find(p=>p.getAttribute('id')===partId);
  if(!part)reject('선택된 악기 파트가 없습니다.');
  return part;
}
function lane(note){return (val(note,'voice')||'1')+'@'+(val(note,'staff')||'1');}
function permitted(note){
  if(note?.localName!=='note'||note.attributes?.length||
    !one(note,'pitch')||one(note,'rest')||one(note,'chord')||
    !one(note,'duration')||!one(note,'type')||kids(note,'dot').length||
    kids(note,'beam').length||[...note.children].some(child=>
      !['pitch','duration','voice','type','stem','staff','accidental','lyric'].includes(child.localName)))
    reject('셋잇단음은 기존 붙임줄·빔·화음·점음표가 없는 일반 음표 묶음에만 적용됩니다.');
  if(kids(note,'lyric').length>1)reject('여러 절의 가사는 튜플릿 변환 전에 확인해 주세요.');
}
function scaleClocks(part,factor){
  if(factor===1)return;
  if(!isInt(factor,2,7))reject('분할 배율이 지원 범위 밖입니다.');
  let anyDivisions=false;
  const sourceMeasures=kids(part,'measure');
  for(const measure of sourceMeasures){
    for(const element of measure.getElementsByTagName?.('*')||[]){
      if(element.localName==='offset')
        reject('시간 offset 지시가 있는 악보는 자동으로 divisions를 확장하지 않습니다.');
    }
    const attrs=kids(measure,'attributes');
    for(const a of attrs)for(const d of kids(a,'divisions')){
      const old=Number(d.textContent);
      if(!isInt(old,1,65536)||old*factor>65536)
        reject('기존 MusicXML divisions가 확장 가능 범위를 벗어났습니다.');
      d.textContent=String(old*factor);anyDivisions=true;
    }
    for(const element of [...measure.children]){
      if(!['note','backup','forward'].includes(element.localName))continue;
      const d=one(element,'duration');
      if(!d)continue;const old=Number(d.textContent);
      if(!isInt(old,1,262144)||old*factor>262144)
        reject('음표와 성부 시간값이 확장 가능 범위를 벗어났습니다.');
      d.textContent=String(old*factor);
    }
  }
  if(!anyDivisions)reject('분할에 필요한 divisions 선언이 없습니다.');
}
function beforeAfter(source,candidate,partId,measureIndex,firstIndex,count,factor,ratio){
  const before=inspectAdvancedMeasure(source,partId,measureIndex);
  const after=inspectAdvancedMeasure(candidate,partId,measureIndex);
  if(before.reason||after.reason)reject('셋잇단음 변환 후 악보 구조가 지원 범위 밖입니다.');
  if(before.max*factor!==after.max||before.divisions*factor!==after.divisions)
    reject('마디의 시간 분할이 보존되지 않았습니다.');
  const changed=new Set(Array.from({length:count},(_,i)=>firstIndex+i));
  const originalUntouched=before.events.filter(e=>!changed.has(e.eventIndex))
    .map(e=>[e.start*factor,e.duration*factor,e.voice,e.staff,e.rest,e.step,e.alter,e.octave]);
  const newUntouched=after.events.filter(e=>e.eventIndex<firstIndex||e.eventIndex>=firstIndex+ratio[0])
    .map(e=>[e.start,e.duration,e.voice,e.staff,e.rest,e.step,e.alter,e.octave]);
  if(JSON.stringify(originalUntouched)!==JSON.stringify(newUntouched))
    reject('셋잇단음 이외의 성부·음정·시점이 변경됐습니다.');
  const group=after.events.slice(firstIndex,firstIndex+ratio[0]);
  if(group.length!==ratio[0]||group.some(e=>!e.tuplet||e.rest))
    reject('새로운 셋잇단음 그룹이 MusicXML 시간 모델에 반영되지 않았습니다.');
  const originalDuration=before.events.slice(firstIndex,firstIndex+count)
    .reduce((sum,e)=>sum+e.duration,0)*factor;
  if(group.reduce((sum,e)=>sum+e.duration,0)!==originalDuration)
    reject('셋잇단음 전체 박자가 원래 음표 묶음과 다릅니다.');
  return group;
}
export function authorTupletGroup(source,{partId,measureIndex,eventIndex,
  ratio='5:4',type='16th',step='G',alter=0,octave=4}={}){
  const spec=RATIO[ratio],denom=LENGTH[type];
  if(!spec||!denom||!STEPS.includes(step)||step.length!==1||
    !isInt(alter,-2,2)||!isInt(octave,1,8))
    reject('셋잇단음 비율·음표 길이·음정이 올바르지 않습니다.');
  if(!isInt(measureIndex,0,9999)||!isInt(eventIndex,0,99999))
    reject('마디 또는 음표 위치가 잘못되었습니다.');
  const part=findPart(source,partId),measure=kids(part,'measure')[measureIndex];
  if(!measure)reject('선택한 마디를 찾지 못했습니다.');
  const audit=inspectAdvancedMeasure(source,partId,measureIndex);
  if(audit.reason||!audit.divisions)reject('리듬을 변경할 수 없는 보호된 마디입니다.');
  const [actual,normal]=spec;
  const total=normal*audit.divisions/denom;
  if(!Number.isSafeInteger(total)||total<1)
    reject('일반 음표 길이를 divisions로 표현할 수 없습니다.');
  const notes=kids(measure,'note'),chosen=notes.slice(eventIndex,eventIndex+normal);
  if(chosen.length!==normal)reject('선택한 음표 뒤로 연속된 음표가 부족합니다.');
  const reference=audit.events[eventIndex],clock=reference?.start;
  if(!reference||reference.rest||reference.chord||reference.tuplet)
    reject('일반 음표 묶음의 첫 음표를 선택해 주세요.');
  for(let i=0;i<normal;i++){
    const current=chosen[i],event=audit.events[eventIndex+i];
    permitted(current);
    if(lane(current)!==lane(chosen[0])||event?.voice!==reference.voice||
      event?.staff!==reference.staff||event?.rest||event?.chord||event?.tuplet||
      event?.type!==type||event.duration!==total/normal||
      event.start!==clock+i*(total/normal)||
      i>0&&chosen[i-1].nextSibling!==current)
      reject('선택한 음표부터 같은 성부·보표의 동일 길이 음표가 연속되어야 합니다.');
  }
  // No pitch/lyric may be lost: retain all source notes, add the missing
  // events after the group with an explicitly selected pitch, without lyrics.
  const sourcePartIds=kids(source.documentElement,'part').map(p=>p.getAttribute('id'));
  if(sourcePartIds.filter(p=>p===partId).length!==1)
    reject('악기 식별자가 중복되어 있습니다.');
  const nativeTicks=audit.divisions/denom*normal/actual;
  const factor=Number.isInteger(nativeTicks)?1:actual;
  const doc=source.cloneNode(true),dest=findPart(doc,partId);
  scaleClocks(dest,factor);
  const renderedMeasure=kids(dest,'measure')[measureIndex];
  const candidates=kids(renderedMeasure,'note').slice(eventIndex,eventIndex+normal);
  const tick=audit.divisions/denom*normal*factor/actual;
  if(!isInt(tick,1,262144))reject('MusicXML 셋잇단음 tick이 정수로 표현되지 않습니다.');
  for(const current of candidates){
    one(current,'duration').textContent=String(tick);
    const tm=node(current,'time-modification');
    for(const [tag,value] of [['actual-notes',actual],['normal-notes',normal],['normal-type',type]])
      tm.appendChild(node(tm,tag,value));
    // MusicXML note order places accidental before time-modification;
    // inserting directly after type would move the tuple before the sharp
    // and produce an invalid element sequence in professional importers.
    const firstAfterTime=['stem','staff','beam','notations','lyric']
      .map(tag=>one(current,tag)).find(Boolean)||null;
    current.insertBefore(tm,firstAfterTime);
    const stem=one(current,'stem');if(stem)current.removeChild(stem);
  }
  let after=candidates.at(-1),last=after;
  for(let i=normal;i<actual;i++){
    const fresh=candidates.at(-1).cloneNode(true);
    for(const name of ['lyric','accidental'])for(const child of kids(fresh,name))fresh.removeChild(child);
    const pitch=one(fresh,'pitch');
    for(const child of [...pitch.children])pitch.removeChild(child);
    pitch.appendChild(node(pitch,'step',step));
    if(alter)pitch.appendChild(node(pitch,'alter',alter));
    pitch.appendChild(node(pitch,'octave',octave));
    renderedMeasure.insertBefore(fresh,after.nextSibling);
    after=fresh;last=fresh;
  }
  function notation(note,kind){
    let n=one(note,'notations');
    if(!n){n=node(note,'notations');note.insertBefore(n,one(note,'lyric')||null);}
    const item=node(n,'tuplet');
    item.setAttribute('number','1');item.setAttribute('type',kind);
    if(kind==='start')item.setAttribute('bracket','yes');
    n.appendChild(item);
  }
  // Tuplet numbers are reusable after the matching stop. Only reserve
  // numbers that are open at this exact insertion point: otherwise a score
  // with more than six ordinary tuplets would become needlessly uneditable.
  const active=new Set();
  for(const [mIndex,m] of kids(dest,'measure').entries()){
    if(mIndex>measureIndex)break;
    for(const [nIndex,n] of kids(m,'note').entries()){
      if(mIndex===measureIndex&&nIndex>=eventIndex)break;
      for(const marker of kids(one(n,'notations'),'tuplet')){
        const num=Number(marker.getAttribute('number')||'1');
        if(!isInt(num,1,6))continue;
        if(marker.getAttribute('type')==='stop')active.delete(num);
        if(marker.getAttribute('type')==='start')active.add(num);
      }
    }
  }
  const free=[1,2,3,4,5,6].find(n=>!active.has(n));
  if(!free)reject('선택 위치에서 열린 잇단음 번호가 모두 사용 중입니다.');
  notation(candidates[0],'start');notation(last,'stop');
  [...one(candidates[0],'notations').children].at(-1).setAttribute('number',String(free));
  [...one(last,'notations').children].at(-1).setAttribute('number',String(free));
  const group=beforeAfter(source,doc,partId,measureIndex,eventIndex,normal,factor,spec);
  if(group.some(e=>e.duration!==tick)||group[0].start!==clock*factor)
    reject('셋잇단음 시작 위치·길이 확인에 실패했습니다.');
  return {doc,change:{action:'common-tuplet',partId,measureIndex,eventIndex,
    actual,normal,type,divisionsScale:factor,insertedNotes:actual-normal}};
}
