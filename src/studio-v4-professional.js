// J-WOO 4.0 professional MusicXML transformations.
//
// Coordinates come from inspectAdvancedMeasure so changing one voice never
// re-times other voices. Unsupported engravings fail closed; the input DOM
// remains untouched until a candidate passes its post-edit timeline audit.
import {inspectAdvancedMeasure} from './advanced-score.js';
const direct=(n,t)=>n?[...n.children].find(c=>c.localName===t)||null:null;
const all=(n,t)=>n?[...n.children].filter(c=>c.localName===t):[];
const value=(n,t)=>direct(n,t)?.textContent?.trim()||'';
const TYPES=[['whole',4],['half',2],['quarter',1],['eighth',.5],['16th',.25],['32nd',.125]];
const STEPS='CDEFGAB';
const fail=text=>{throw new Error(text);};
const int=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const make=(parent,name,content)=>{
  const doc=parent.ownerDocument;
  const node=doc.createElementNS?doc.createElementNS(parent.namespaceURI??null,name):doc.createElement(name);
  if(content!==undefined)node.textContent=String(content);
  return node;
};
function locate(doc,partId,measureIndex,eventIndex){
  if(doc?.documentElement?.localName!=='score-partwise')fail('MusicXML partwise 형식이 아닙니다.');
  if(typeof partId!=='string'||!partId||!int(measureIndex,0,9999)||!int(eventIndex,0,99999))
    fail('선택한 악기·마디·음표 위치가 올바르지 않습니다.');
  const part=all(doc.documentElement,'part').find(n=>n.getAttribute('id')===partId);
  if(!part)fail('악기 파트를 찾지 못했습니다.');
  const measure=all(part,'measure')[measureIndex];
  if(!measure)fail('마디를 찾지 못했습니다.');
  const note=all(measure,'note')[eventIndex];
  if(!note)fail('음표를 찾지 못했습니다.');
  const audit=inspectAdvancedMeasure(doc,partId,measureIndex);
  if(audit.reason)fail('변경할 수 없는 마디: '+audit.reason);
  return {part,measure,note,audit,event:audit.events[eventIndex]};
}
const identity=e=>e.voice+'@'+e.staff;
const keyOf=e=>[e.voice,e.staff,e.start].join('@');
function notePitches(events){
  return events.filter(e=>!e.rest).map(e=>
    [e.voice,e.staff,e.start,e.duration,e.chord,e.step,e.alter,e.octave].join(':'));
}
const transport=measure=>[...measure.children]
  .filter(x=>x.localName==='backup'||x.localName==='forward')
  .map(x=>x.localName+':'+value(x,'duration')+':'+value(x,'voice')+':'+value(x,'staff'));
function validateChange(source,original,partId,measureIndex,changedLanes){
  const newState=inspectAdvancedMeasure(source,partId,measureIndex);
  if(newState.reason||newState.max!==original.audit.max)
    fail('변경 후 성부의 시간 위치 또는 박자 무결성 검사에 실패했습니다.');
  const nextPart=all(source.documentElement,'part').find(p=>p.getAttribute('id')===partId);
  const nextMeasure=all(nextPart,'measure')[measureIndex];
  if(JSON.stringify(transport(original.measure))!==JSON.stringify(transport(nextMeasure)))
    fail('다성부 백업·이동 정보가 변경되어 거부했습니다.');
  if(JSON.stringify(original.audit.events.filter(e=>!changedLanes.has(identity(e))).map(e=>[
    e.voice,e.staff,e.start,e.duration,e.rest,e.step,e.alter,e.octave,e.chord
  ]))!==JSON.stringify(newState.events.filter(e=>!changedLanes.has(identity(e))).map(e=>[
    e.voice,e.staff,e.start,e.duration,e.rest,e.step,e.alter,e.octave,e.chord
  ])))fail('다른 성부의 시간이 달라져 편집을 거부했습니다.');
  return newState;
}
function guardNote(n,{rest=false,beam=false}={}){
  const keys=rest?['rest','duration','voice','type','staff']:
    ['pitch','duration','voice','type','staff','stem','accidental','lyric',...(beam?['beam']:[])];
  if(n.attributes?.length||[...n.children].some(x=>!keys.includes(x.localName))||
     !direct(n,'duration')||!direct(n,'type'))fail('붙임줄·장식·복잡한 기보가 있는 음표는 이 리듬 변경에서 보호됩니다.');
  if(rest){
    if(!direct(n,'rest')||direct(n,'rest').attributes?.length)fail('표기 위치가 지정된 쉼표는 보호됩니다.');
  }else if(!direct(n,'pitch'))fail('일반 음표를 선택해 주세요.');
}
function durationFor(type,divisions){
  const found=TYPES.find(([t])=>t===type);
  if(!found)fail('지원하지 않는 기보 길이입니다.');
  const result=found[1]*divisions;
  if(!int(result,1,1e6))fail('이 악보의 divisions로는 음표 길이를 정확히 표현할 수 없습니다.');
  return result;
}
function decomposeRest(duration,divisions){
  if(!int(duration,0,262144))fail('쉼표 길이가 올바르지 않습니다.');
  const out=[];
  for(const [type,quarters] of TYPES){
    const unit=quarters*divisions;
    if(!int(unit,1,1e6))continue;
    while(duration>=unit){
      out.push({duration:unit,type});
      duration-=unit;
      if(out.length>32)fail('쉼표 분할 개수가 너무 많습니다.');
    }
  }
  if(duration)fail('남은 박자를 일반 쉼표로 정확히 표현할 수 없습니다.');
  return out;
}
function makeRest(measure,example,duration,type){
  const node=make(measure,'note');
  node.appendChild(make(node,'rest'));
  node.appendChild(make(node,'duration',duration));
  if(direct(example,'voice'))node.appendChild(make(node,'voice',value(example,'voice')));
  node.appendChild(make(node,'type',type));
  if(direct(example,'staff'))node.appendChild(make(node,'staff',value(example,'staff')));
  return node;
}
function emitRests(measure,after,example,chunks){
  let anchor=after;
  for(const item of chunks){
    const node=makeRest(measure,example,item.duration,item.type);
    measure.insertBefore(node,anchor.nextSibling);
    anchor=node;
  }
}
function sameLaneNote(first,second){
  return (value(first,'voice')||'1')===(value(second,'voice')||'1')&&
    (value(first,'staff')||'1')===(value(second,'staff')||'1');
}
function chooseMarkupNumber(part,name){
  const existing=new Set();
  for(const n of all(part,'measure')){
    const elements=name==='wedge'?
      all(n,'direction').flatMap(d=>all(direct(d,'direction-type'),'wedge')):
      all(n,'note').flatMap(x=>all(direct(x,'notations'),name));
    for(const node of elements){
      const num=Number(node.getAttribute('number')||'1');
      if(int(num,1,6))existing.add(num);
    }
  }
  for(let n=1;n<=6;n++)if(!existing.has(n))return n;
  fail('악보에 이미 여러 겹의 기보 기호가 있어 번호를 안전하게 배정할 수 없습니다.');
}
function addNotation(note,name,attrs){
  let notations=direct(note,'notations');
  if(!notations){notations=make(note,'notations');note.appendChild(notations);}
  const item=make(notations,name);
  for(const [k,v] of Object.entries(attrs))item.setAttribute(k,String(v));
  notations.appendChild(item);
  return item;
}
function directionBefore(measure,note,kind,number,voice,staff){
  const direction=make(measure,'direction');
  direction.setAttribute('placement','below');
  const dt=make(direction,'direction-type'),wedge=make(dt,'wedge');
  wedge.setAttribute('type',kind);wedge.setAttribute('number',String(number));
  if(kind==='crescendo')wedge.setAttribute('spread','0');
  if(kind==='diminuendo')wedge.setAttribute('spread','15');
  dt.appendChild(wedge);direction.appendChild(dt);
  if(voice!=='1')direction.appendChild(make(direction,'voice',voice));
  if(staff!=='1')direction.appendChild(make(direction,'staff',staff));
  measure.insertBefore(direction,note);
}
function post(source,doc,loc,changedLanes,action){
  validateChange(doc,{...loc,measure:loc.sourceMeasure,part:loc.sourcePart},
    loc.part.getAttribute('id'),loc.audit.index,changedLanes);
  return {doc,change:{action,partId:loc.part.getAttribute('id'),measureIndex:loc.audit.index}};
}
function start(source,params){
  const doc=source.cloneNode(true);
  const original=locate(source,params.partId,params.measureIndex,params.eventIndex);
  const changed=locate(doc,params.partId,params.measureIndex,params.eventIndex);
  return {doc,loc:{...changed,sourcePart:original.part,sourceMeasure:original.measure,
    audit:original.audit,event:original.event}};
}
export function editVoiceRhythm(source,{partId,measureIndex,eventIndex,type,mode='duration',
  step='C',alter=0,octave=4}={}){
  if(!['duration','insert'].includes(mode))fail('리듬 편집 종류가 올바르지 않습니다.');
  const {doc,loc}=start(source,{partId,measureIndex,eventIndex});
  const {measure,note,event,audit}=loc,divisions=audit.divisions;
  if(!event||event.chord||!divisions)fail('이 음표는 독립적인 성부 음표가 아닙니다.');
  const desired=durationFor(type,divisions),old=event.duration,changedLanes=new Set([identity(event)]);
  if(mode==='insert'){
    if(!event.rest)fail('음표를 넣을 일반 쉼표를 선택하세요.');
    guardNote(note,{rest:true});
    if(!STEPS.includes(step)||step.length!==1||!int(alter,-2,2)||!int(octave,1,8))
      fail('음정 입력값이 잘못되었습니다.');
    if(desired>old)fail('선택한 쉼표보다 긴 음표는 넣을 수 없습니다.');
    const chunks=decomposeRest(old-desired,divisions);
    const pitch=make(note,'pitch');
    pitch.appendChild(make(pitch,'step',step));
    if(alter) pitch.appendChild(make(pitch,'alter',alter));
    pitch.appendChild(make(pitch,'octave',octave));
    note.replaceChild(pitch,direct(note,'rest'));
    direct(note,'duration').textContent=String(desired);
    direct(note,'type').textContent=type;
    emitRests(measure,note,note,chunks);
  } else {
    if(event.rest)fail('쉼표의 길이 변경은 음표 삽입으로 처리하세요.');
    if(event.tuplet)fail('기존 셋잇단음의 개별 길이 변경은 별도 튜플릿 그룹 기능에서 처리해야 합니다.');
    guardNote(note);
    if(desired===old)fail('현재 음표와 같은 길이입니다.');
    if(desired<old){
      const chunks=decomposeRest(old-desired,divisions);
      direct(note,'duration').textContent=String(desired);
      direct(note,'type').textContent=type;
      const stem=direct(note,'stem');if(stem)note.removeChild(stem);
      emitRests(measure,note,note,chunks);
    }else{
      let needed=desired-old,cursor=note.nextSibling;
      const entries=[];
      while(needed>0){
        if(cursor?.localName!=='note'||!direct(cursor,'rest')||!sameLaneNote(note,cursor))
          fail('선택 음표 바로 뒤에 같은 성부의 일반 쉼표가 충분하지 않습니다.');
        guardNote(cursor,{rest:true});
        const length=Number(value(cursor,'duration'));
        if(!int(length,1,262144))fail('쉼표 길이가 올바르지 않습니다.');
        const use=Math.min(needed,length);
        entries.push({node:cursor,left:length-use});
        needed-=use;cursor=cursor.nextSibling;
      }
      const replacements=entries.map(e=>({...e,chunks:decomposeRest(e.left,divisions)}));
      direct(note,'duration').textContent=String(desired);direct(note,'type').textContent=type;
      const stem=direct(note,'stem');if(stem)note.removeChild(stem);
      for(const item of replacements){
        let before=item.node;
        for(const c of item.chunks)measure.insertBefore(makeRest(measure,item.node,c.duration,c.type),before);
        measure.removeChild(item.node);
      }
    }
  }
  post(source,doc,loc,changedLanes,mode==='insert'?'voice-note-insert':'voice-duration');
  // Invariant: the source and candidate have identical total spans per affected lane.
  const after=inspectAdvancedMeasure(doc,partId,measureIndex);
  const oldSpan=audit.events.filter(e=>identity(e)===identity(event)&&!e.chord)
    .reduce((sum,e)=>sum+e.duration,0);
  const newSpan=after.events.filter(e=>identity(e)===identity(event)&&!e.chord)
    .reduce((sum,e)=>sum+e.duration,0);
  if(oldSpan!==newSpan)fail('해당 성부의 총 길이가 달라져 작업을 취소했습니다.');
  return {doc,change:{action:mode==='insert'?'voice-note-insert':'voice-duration',partId,measureIndex,eventIndex,type}};
}
export function createEighthTriplet(source,{partId,measureIndex,eventIndex,
  step='G',alter=0,octave=4}={}){
  if(!STEPS.includes(step)||step.length!==1||!int(alter,-2,2)||!int(octave,1,8))
    fail('셋잇단음 가운데 음정이 올바르지 않습니다.');
  const {doc,loc}=start(source,{partId,measureIndex,eventIndex});
  const {note,measure,audit,event,part}=loc;
  const following=note.nextSibling,other=audit.events[eventIndex+1];
  if(!following||following.localName!=='note'||!other||
     event.rest||other.rest||event.chord||other.chord||event.tuplet||other.tuplet||
     !sameLaneNote(note,following)||event.voice!==other.voice||event.staff!==other.staff)
    fail('같은 성부·보표의 인접한 일반 8분음표 2개를 선택하세요.');
  const div=audit.divisions;
  if(div%6!==0||!int(div,6,65536))fail('이 악보 divisions에서는 정확한 셋잇단음 분할이 불가능합니다.');
  if(event.type!=='eighth'||other.type!=='eighth'||
     event.duration!==div/2||other.duration!==div/2||
     event.start%div!==0)
    fail('한 박자에 들어 있는 동일한 8분음표 2개만 셋잇단음으로 바꿉니다.');
  guardNote(note,{beam:true});guardNote(following,{beam:true});
  const firstBeam=all(note,'beam'),lastBeam=all(following,'beam');
  const isBeamed=firstBeam.length===1&&lastBeam.length===1&&
     firstBeam[0].getAttribute('number')==='1'&&lastBeam[0].getAttribute('number')==='1'&&
     firstBeam[0].textContent.trim()==='begin'&&lastBeam[0].textContent.trim()==='end';
  if((firstBeam.length||lastBeam.length)&&!isBeamed)fail('다른 음표까지 이어진 빔은 자동으로 재구성하지 않습니다.');
  const number=chooseMarkupNumber(part,'tuplet');
  const middle=note.cloneNode(true);
  for(const rem of all(middle,'lyric'))middle.removeChild(rem);
  for(const rem of all(middle,'accidental'))middle.removeChild(rem);
  const pitch=direct(middle,'pitch');
  if(!pitch)fail('가운데 음을 구성할 수 없습니다.');
  pitch.replaceChildren?.();
  // replaceChildren is not available in the lightweight test DOM
  for(const child of [...pitch.children])pitch.removeChild(child);
  pitch.appendChild(make(pitch,'step',step));
  if(alter)pitch.appendChild(make(pitch,'alter',alter));
  pitch.appendChild(make(pitch,'octave',octave));
  for(const item of [note,middle,following]){
    direct(item,'duration').textContent=String(div/3);
    const tm=make(item,'time-modification');
    tm.appendChild(make(tm,'actual-notes',3));
    tm.appendChild(make(tm,'normal-notes',2));
    tm.appendChild(make(tm,'normal-type','eighth'));
    item.insertBefore(tm,direct(item,'type').nextSibling);
    const stem=direct(item,'stem');if(stem)item.removeChild(stem);
  }
  if(isBeamed)all(middle,'beam')[0].textContent='continue';
  addNotation(note,'tuplet',{number,type:'start',bracket:isBeamed?'no':'yes'});
  addNotation(following,'tuplet',{number,type:'stop'});
  measure.insertBefore(middle,following);
  post(source,doc,loc,new Set([identity(event)]),'eighth-triplet');
  const newState=inspectAdvancedMeasure(doc,partId,measureIndex);
  const events=newState.events.filter(e=>identity(e)===identity(event)&&e.tuplet&&
     e.start>=event.start&&e.start<event.start+div);
  if(events.length!==3||events.some(e=>e.duration!==div/3))
    fail('셋잇단음 분할 후 구조 검증에 실패했습니다.');
  return {doc,change:{action:'eighth-triplet',partId,measureIndex,eventIndex}};
}
function endpoints(source,params){
  const {doc,loc}=start(source,params);
  const to=Number(params.endEventIndex);
  if(!int(to,0,99999)||to<=params.eventIndex)fail('끝 음표 번호는 시작 음표보다 뒤여야 합니다.');
  const end=loc.audit.events[to],a=loc.event;
  if(!a||!end||a.rest||end.rest||a.chord||end.chord||
     a.voice!==end.voice||a.staff!==end.staff||a.start>=end.start)
    fail('같은 성부·보표의 서로 다른 음표 두 개를 선택하세요.');
  const first=loc.note,last=all(loc.measure,'note')[to];
  if(!first||!last)fail('음표 위치가 올바르지 않습니다.');
  return {doc,loc,first,last,end};
}
export function toggleSlur(source,params={}){
  const {doc,loc,first,last}=endpoints(source,params),{part,event}=loc;
  const startSlurs=all(direct(first,'notations'),'slur');
  const stopSlurs=all(direct(last,'notations'),'slur');
  const matched=startSlurs.find(s=>s.getAttribute('type')==='start'&&stopSlurs.some(t=>
    t.getAttribute('type')==='stop'&&(t.getAttribute('number')||'1')===(s.getAttribute('number')||'1')));
  if(matched){
    const num=matched.getAttribute('number')||'1';
    for(const [note,kind] of [[first,'start'],[last,'stop']]){
      const notations=direct(note,'notations');
      for(const s of all(notations,'slur'))if(s.getAttribute('type')===kind&&(s.getAttribute('number')||'1')===num)notations.removeChild(s);
      if(!notations.children.length)note.removeChild(notations);
    }
  }else{
    const number=chooseMarkupNumber(part,'slur');
    addNotation(first,'slur',{type:'start',number,placement:'above'});
    addNotation(last,'slur',{type:'stop',number});
  }
  post(source,doc,loc,new Set([identity(event)]),'slur');
  return {doc,change:{action:matched?'slur-remove':'slur-add',partId:params.partId,measureIndex:params.measureIndex}};
}
export function addHairpin(source,{kind='crescendo',...params}={}){
  if(!['crescendo','diminuendo'].includes(kind))fail('지원하지 않는 크레셴도·디미누엔도입니다.');
  const {doc,loc,first,last}=endpoints(source,params);
  const number=chooseMarkupNumber(loc.part,'wedge');
  directionBefore(loc.measure,first,kind,number,loc.event.voice,loc.event.staff);
  directionBefore(loc.measure,last,'stop',number,loc.event.voice,loc.event.staff);
  post(source,doc,loc,new Set([identity(loc.event)]),'hairpin');
  return {doc,change:{action:'hairpin',kind,partId:params.partId,measureIndex:params.measureIndex}};
}


/**
 * Move a non-chord note earlier/later by a precise grid subdivision while
 * exchanging time with an immediately adjacent same-lane rest.
 * Cross-bar, tie, tuplet, beam and occupied-time movement is not guessed.
 * The immutable candidate passes a full multi-voice timeline check.
 */
export function nudgeVoiceNoteOnGrid(source,{partId,measureIndex,eventIndex,
  direction='earlier',grid='16th'}={}){
  if(!['earlier','later'].includes(direction)||!['eighth','16th','32nd'].includes(grid))
    fail('음표 이동 방향 또는 박자 격자가 올바르지 않습니다.');
  const {doc,loc}=start(source,{partId,measureIndex,eventIndex});
  const {measure,note,event,audit}=loc;
  if(!event||event.rest||event.chord||event.tuplet||!audit.divisions)
    fail('일반 성부 음표만 박자 위치를 조정할 수 있습니다.');
  guardNote(note);
  const shift=durationFor(grid,audit.divisions),items=[...measure.children],at=items.indexOf(note);
  const before=items[at-1],after=items[at+1];
  const adjacent=direction==='earlier'?before:after;
  if(!adjacent||adjacent.localName!=='note'||!direct(adjacent,'rest')||
     !sameLaneNote(note,adjacent))
    fail('같은 성부에서 이동 방향으로 바로 연결된 쉼표가 필요합니다.');
  guardNote(adjacent,{rest:true});
  const originalRest=Number(value(adjacent,'duration'));
  if(!int(originalRest,1,262144)||originalRest<shift)
    fail('이동 방향의 쉼표 길이가 부족합니다.');
  const remainder=decomposeRest(originalRest-shift,audit.divisions);
  const movedRest=makeRest(measure,adjacent,shift,grid);
  if(direction==='earlier'){
    // [rest R][note N] -> [rest R-shift][note N][rest shift]
    for(const r of remainder)measure.insertBefore(
      makeRest(measure,adjacent,r.duration,r.type),note);
    measure.removeChild(adjacent);
    measure.insertBefore(movedRest,note.nextSibling);
  }else{
    // [note N][rest R] -> [rest shift][note N][rest R-shift]
    measure.insertBefore(movedRest,note);
    for(const r of remainder)measure.insertBefore(
      makeRest(measure,adjacent,r.duration,r.type),adjacent);
    measure.removeChild(adjacent);
  }
  post(source,doc,loc,new Set([identity(event)]),'voice-grid-nudge');
  const audited=inspectAdvancedMeasure(doc,partId,measureIndex);
  const newIndex=all(measure,'note').indexOf(note),moved=audited.events[newIndex];
  const expected=event.start+(direction==='earlier'?-shift:shift);
  if(!moved||moved.start!==expected||moved.duration!==event.duration||
     moved.step!==event.step||moved.alter!==event.alter||moved.octave!==event.octave||
     moved.voice!==event.voice||moved.staff!==event.staff)
    fail('음정 또는 시간 이동 검증에 실패하여 작업을 취소했습니다.');
  const oldSpan=audit.events.filter(e=>identity(e)===identity(event)&&!e.chord)
    .reduce((sum,e)=>sum+e.duration,0);
  const newSpan=audited.events.filter(e=>identity(e)===identity(event)&&!e.chord)
    .reduce((sum,e)=>sum+e.duration,0);
  if(oldSpan!==newSpan)fail('편집 성부의 총 박자 길이가 달라졌습니다.');
  return {doc,change:{action:'voice-grid-nudge',partId,measureIndex,eventIndex,
    direction,grid,shift}};
}


/**
 * Reposition an ordinary note anywhere in its contiguous, same-voice/staff
 * rest island. Unlike a one-grid nudge this supports multiple consecutive
 * rests and precise beat selection without changing voice backups or other
 * instruments. The selected note is moved, not copied.
 *
 * targetBeat is 1-based quarter-note position: beat 1 -> tick 0, beat 2.5
 * -> divisions * 1.5. Grid denotes an exact binary subdivision of a quarter.
 * Unsupported decorative, chord, tuplets or intervening event nodes fail
 * closed on an immutable source.
 */
export function relocateVoiceNote(source,{partId,measureIndex,eventIndex,
  targetBeat,grid='16th'}={}){
  if(!['eighth','16th','32nd'].includes(grid))fail('이동 격자를 선택해 주세요.');
  const {doc,loc}=start(source,{partId,measureIndex,eventIndex});
  const {note,measure,audit,event}=loc;
  if(!event||event.rest||event.chord||event.tuplet||!audit.divisions)
    fail('일반 성부의 단일 음표를 선택해 주세요.');
  guardNote(note);
  const quantum=durationFor(grid,audit.divisions);
  const beat=Number(targetBeat);
  if(!Number.isFinite(beat)||beat<1)
    fail('이동할 시작 박자를 1 이상의 숫자로 입력해 주세요.');
  const targetTick=(beat-1)*audit.divisions;
  if(!int(targetTick,0,audit.max-1)||targetTick%quantum!==0)
    fail('선택한 격자와 일치하는 정확한 시작 박자를 입력해 주세요.');
  if(targetTick===event.start)fail('이미 해당 박자에 놓여 있습니다.');

  const children=[...measure.children],notePosition=children.indexOf(note);
  let first=notePosition,last=notePosition;
  const eligibleRest=n=>n?.localName==='note'&&!!direct(n,'rest')&&
    sameLaneNote(note,n);
  while(first>0&&eligibleRest(children[first-1])){
    guardNote(children[first-1],{rest:true});first--;
  }
  while(last+1<children.length&&eligibleRest(children[last+1])){
    guardNote(children[last+1],{rest:true});last++;
  }
  const before=children.slice(first,notePosition);
  const after=children.slice(notePosition+1,last+1);
  const restTotal=items=>items.reduce((sum,item)=>{
    const n=Number(value(item,'duration'));
    if(!int(n,1,262144))fail('인접한 쉼표의 길이가 올바르지 않습니다.');
    return sum+n;
  },0);
  const startTick=event.start-restTotal(before);
  const endTick=event.start+event.duration+restTotal(after);
  if(startTick<0||endTick>audit.max)fail('선택 성부가 마디 범위를 벗어났습니다.');
  if(targetTick<startTick||targetTick+event.duration>endTick)
    fail('선택 위치까지 같은 성부의 연속된 빈 쉼표가 필요합니다. 다른 음표는 넘을 수 없습니다.');
  const preceding=decomposeRest(targetTick-startTick,audit.divisions);
  const following=decomposeRest(endTick-targetTick-event.duration,audit.divisions);
  // The original node may contain safe lyrics: move them with the pitch,
  // but do not mutate those contents. Any foreign markup failed guardNote.
  const anchor=children[last].nextSibling;
  for(const item of children.slice(first,last+1))measure.removeChild(item);
  const insert=(node)=>measure.insertBefore(node,anchor);
  for(const part of preceding)insert(makeRest(measure,note,part.duration,part.type));
  insert(note);
  for(const part of following)insert(makeRest(measure,note,part.duration,part.type));

  const checked=validateChange(doc,{...loc,measure:loc.sourceMeasure,part:loc.sourcePart},
    partId,measureIndex,new Set([identity(event)]));
  const nextIndex=all(measure,'note').indexOf(note);
  const moved=checked.events[nextIndex];
  if(!moved||moved.start!==targetTick||moved.duration!==event.duration||
    moved.step!==event.step||moved.alter!==event.alter||moved.octave!==event.octave||
    moved.voice!==event.voice||moved.staff!==event.staff)
    fail('선택 음표의 박자 위치 또는 음정 보존 검사에 실패했습니다.');
  const expectedLane=checked.events.filter(e=>identity(e)===identity(event)&&!e.chord)
    .reduce((sum,e)=>sum+e.duration,0);
  const originalLane=audit.events.filter(e=>identity(e)===identity(event)&&!e.chord)
    .reduce((sum,e)=>sum+e.duration,0);
  if(originalLane!==expectedLane)fail('편집 성부의 박자 합계가 달라졌습니다.');
  return {doc,change:{action:'voice-note-relocate',partId,measureIndex,eventIndex,
    nextEventIndex:nextIndex,fromTick:event.start,toTick:targetTick,grid}};
}


/**
 * Remove an unadorned single note from any supported voice/staff without
 * deleting its time slot: replace it with an equal-length same-lane rest.
 * Lyric-bearing notes must be edited deliberately before removing the pitch.
 */
export function replaceVoiceNoteWithRest(source,{partId,measureIndex,eventIndex}={}){
  const {doc,loc}=start(source,{partId,measureIndex,eventIndex});
  const {note,measure,audit,event}=loc;
  if(!event||event.rest||event.chord||event.tuplet||event.protectedMarkup)
    fail('붙임줄·화음·셋잇단음 등 보호된 음표는 쉼표로 바꾸지 않습니다.');
  guardNote(note);
  if(all(note,'lyric').length)fail('가사가 있는 음표는 가사를 먼저 삭제해 주세요.');
  if(!TYPES.some(([type])=>type===event.type)||
    durationFor(event.type,audit.divisions)!==event.duration)
    fail('원래 음표 길이를 일반 쉼표로 안전하게 표현할 수 없습니다.');
  const replacement=makeRest(measure,note,event.duration,event.type);
  measure.replaceChild(replacement,note);
  const after=validateChange(doc,{...loc,measure:loc.sourceMeasure,part:loc.sourcePart},
    partId,measureIndex,new Set([identity(event)]));
  const changed=after.events[eventIndex];
  if(!changed?.rest||changed.duration!==event.duration||changed.start!==event.start||
    changed.voice!==event.voice||changed.staff!==event.staff)
    fail('음표 삭제 후 쉼표 위치가 일치하지 않습니다.');
  return {doc,change:{action:'voice-note-to-rest',partId,measureIndex,eventIndex}};
}
