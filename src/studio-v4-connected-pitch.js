// Exact pitch edit of a sounding and written tied-note chain.
//
// Ordinary pitch-only updates leave durations, voice/staff, lyrics, slurs,
// articulations, tuplets, chord structure and other parts intact. A tied pitch
// is changed atomically with every linked continuation, even across measures.
// Malformed/unbalanced tie chains, uncommon microtonal accidentals and
// duplicate chord pitches are rejected without returning a candidate.
import {assertScopedScoreMutation} from './studio-v4-structural-guard.js';

const all=(node,tag)=>node?[...node.children].filter(n=>n.localName===tag):[];
const first=(node,tag)=>all(node,tag)[0]||null;
const val=(node,tag)=>first(node,tag)?.textContent?.trim()||'';
const fail=reason=>{throw new Error(reason);};
const integer=(n,lo,hi)=>Number.isSafeInteger(n)&&n>=lo&&n<=hi;
const STEPS='CDEFGAB';
const ACCIDENTALS=Object.freeze({'-2':'flat-flat','-1':'flat','0':'natural',
  '1':'sharp','2':'double-sharp'});
const pitchSignature=(pitch)=>{
  if(!pitch||pitch.attributes?.length||all(pitch,'step').length!==1||
     all(pitch,'octave').length!==1||all(pitch,'alter').length>1||
     [...pitch.children].some(n=>!['step','alter','octave'].includes(n.localName)))
    fail('복합 음정 정보가 있어 붙임줄의 음정을 안전하게 바꾸지 않습니다.');
  const step=val(pitch,'step'),octaveText=val(pitch,'octave'),alterText=val(pitch,'alter');
  if(!STEPS.includes(step)||step.length!==1||!/^[0-9]+$/.test(octaveText)||
     alterText!==''&&!/^-?[0-9]+$/.test(alterText))
    fail('음정이나 옥타브 정보가 올바르지 않습니다.');
  const alter=alterText===''?0:Number(alterText),octave=Number(octaveText);
  if(!integer(alter,-2,2)||!integer(octave,1,8))
    fail('미분음·특수 옥타브는 연결 기보 음정 수정에서 보호됩니다.');
  return [step,alter,octave].join('/');
};
function collect(part){
  const measures=all(part,'measure');
  if(!measures.length||measures.length>256)
    fail('붙임줄 음정 편집은 1~256마디 악보만 지원합니다.');
  const items=[],byPosition=new Map();
  for(const [measureIndex,bar] of measures.entries()){
    const notes=all(bar,'note');
    if(items.length+notes.length>50000)fail('음표가 너무 많아 연결 기보를 안전하게 검사할 수 없습니다.');
    for(const [eventIndex,note] of notes.entries()){
      const pitch=first(note,'pitch'),rest=first(note,'rest');
      const sound=all(note,'tie').map(t=>t.getAttribute('type'));
      const written=all(first(note,'notations'),'tied').map(t=>t.getAttribute('type'));
      if(sound.length||written.length){
        if(!pitch||rest||first(note,'grace')||first(note,'unpitched')||
           sound.some(x=>!['start','stop'].includes(x))||
           written.some(x=>!['start','stop'].includes(x))||
           new Set(sound).size!==sound.length||new Set(written).size!==written.length||
           sound.length!==written.length||
           sound.some(type=>!written.includes(type))||
           all(note,'tie').some(t=>t.attributes?.length!==1)||
           all(first(note,'notations'),'tied').some(t=>
             [...t.attributes].some(a=>a.name!=='type')))
          fail('소리·기보용 붙임줄이 서로 다르거나 지원하지 않는 연결 유형입니다.');
      }
      const item={note,measureIndex,eventIndex,voice:val(note,'voice')||'1',
        staff:val(note,'staff')||'1',sound,written,pitchSignature:pitch?pitchSignature(pitch):null};
      if(!/^[0-9]+$/.test(item.voice)||!/^[0-9]+$/.test(item.staff))
        fail('성부·보표 번호가 올바르지 않습니다.');
      items.push(item);byPosition.set(measureIndex+'/'+eventIndex,item);
    }
  }
  return {items,byPosition};
}
function tieGraph(items){
  const links=new Map(items.map(item=>[item,new Set()]));
  const open=new Map();
  for(const item of items){
    const key=[item.voice,item.staff,item.pitchSignature].join('|');
    if(item.sound.includes('stop')){
      const prior=open.get(key);
      if(!prior)fail('붙임줄의 시작 음표가 없거나 성부·음정이 맞지 않습니다.');
      links.get(item).add(prior);
      links.get(prior).add(item);
      open.delete(key);
    }
    if(item.sound.includes('start')){
      if(open.has(key))fail('종료되지 않은 붙임줄의 시작이 중복되었습니다.');
      open.set(key,item);
    }
  }
  if(open.size)fail('끝나지 않은 붙임줄이 있어 음정 변경을 보호합니다.');
  return links;
}
function graphGroup(links,selected){
  const output=new Set(),queue=[selected];
  while(queue.length){
    const note=queue.pop();
    if(output.has(note))continue;
    output.add(note);
    if(output.size>512)fail('붙임줄로 연결된 음표 수가 안전 한도를 초과합니다.');
    for(const next of links.get(note)||[])queue.push(next);
  }
  return output;
}
function checkCollision(items,changed,nextSignature){
  // Two tones with identical written pitch in the same simultaneously
  // sounding chord are not produced silently by a pitch-only edit.
  for(const item of changed){
    const row=items.filter(x=>x.measureIndex===item.measureIndex);
    const pos=row.findIndex(x=>x.eventIndex===item.eventIndex);
    let anchor=pos;
    while(anchor>0&&first(row[anchor].note,'chord'))anchor--;
    let finish=anchor+1;
    while(finish<row.length&&first(row[finish].note,'chord'))finish++;
    if(finish-anchor<2)continue;
    const pitches=row.slice(anchor,finish).map(x=>
      changed.has(x)?nextSignature:x.pitchSignature);
    if(new Set(pitches).size!==pitches.length)
      fail('화음에 동일한 음정이 중복되어 연결된 음표의 이조를 중단했습니다.');
  }
}
function updatePitch(note,{step,alter,octave}){
  const pitch=first(note,'pitch');
  // All pitch child markup was previously validated. Only these three musical
  // values change; notations/slurs/lyrics/tuplets remain byte-equivalent.
  first(pitch,'step').textContent=step;
  const oldAlter=first(pitch,'alter');
  if(alter){
    if(oldAlter)oldAlter.textContent=String(alter);
    else{
      const owner=pitch.ownerDocument;
      const elt=owner.createElementNS?
        owner.createElementNS(pitch.namespaceURI??null,'alter'):owner.createElement('alter');
      elt.textContent=String(alter);
      pitch.insertBefore(elt,first(pitch,'octave'));
    }
  }else if(oldAlter)pitch.removeChild(oldAlter);
  first(pitch,'octave').textContent=String(octave);
  for(const accidental of all(note,'accidental')){
    if(accidental.attributes?.length||accidental.children.length||
       !['sharp','flat','natural','double-sharp','flat-flat'].includes(accidental.textContent.trim()))
      fail('특수 임시표는 자동 음정 변경에서 보호됩니다.');
    accidental.textContent=ACCIDENTALS[String(alter)];
  }
}
export function editConnectedPitch(source,{partId,measureIndex,eventIndex,
  step='C',alter=0,octave=4}={}){
  if(source?.documentElement?.localName!=='score-partwise'||typeof partId!=='string'||
     !partId||!integer(measureIndex,0,255)||!integer(eventIndex,0,49999)||
     typeof step!=='string'||step.length!==1||!STEPS.includes(step)||
     !integer(alter,-2,2)||!integer(octave,1,8))
    fail('음정·성부·선택 위치 설정을 확인해 주세요.');
  const parts=all(source.documentElement,'part');
  if(parts.filter(p=>p.getAttribute('id')===partId).length!==1)
    fail('음정을 변경할 악기 파트 ID가 정확하지 않습니다.');
  const part=parts.find(p=>p.getAttribute('id')===partId);
  if(all(part,'measure').some(bar=>all(bar,'attributes').some(a=>first(a,'transpose'))))
    fail('이조 악기의 기보 음정은 실음과 다를 수 있어 보호합니다.');
  const {items,byPosition}=collect(part),selected=byPosition.get(measureIndex+'/'+eventIndex);
  if(!selected||!selected.pitchSignature||first(selected.note,'grace')||
     first(selected.note,'cue')||first(selected.note,'unpitched'))
    fail('일반 음정이 있는 음표를 선택해 주세요.');
  const nextSignature=[step,alter,octave].join('/');
  if(nextSignature===selected.pitchSignature)fail('이미 같은 음정입니다.');
  const links=tieGraph(items),connected=graphGroup(links,selected);
  if([...connected].some(item=>item.pitchSignature!==selected.pitchSignature))
    fail('서로 다른 음정이 연결되어 있어 편집을 보호합니다.');
  checkCollision(items,connected,nextSignature);
  const doc=source.cloneNode(true),copyPart=all(doc.documentElement,'part')
    .find(p=>p.getAttribute('id')===partId),copyBars=all(copyPart,'measure');
  for(const item of connected){
    const note=all(copyBars[item.measureIndex],'note')[item.eventIndex];
    updatePitch(note,{step,alter,octave});
    if(pitchSignature(first(note,'pitch'))!==nextSignature)
      fail('연결된 음표의 음정이 변경되지 않았습니다.');
  }
  const changedMeasures=[...connected].map(item=>item.measureIndex);
  assertScopedScoreMutation(source,doc,{partIds:[partId],
    start:Math.min(...changedMeasures),end:Math.max(...changedMeasures),kind:'pitches'});
  return {doc,change:{action:'connected-pitch-edit',partId,measureIndex,eventIndex,
    connectedNotes:connected.size,measures:new Set(changedMeasures).size,
    nextMeasureIndex:measureIndex,nextEventIndex:eventIndex}};
}
