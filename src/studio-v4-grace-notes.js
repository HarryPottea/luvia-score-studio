// Safe zero-time grace-note authoring for MusicXML 4.0.
// A grace note has no <duration>. It changes neither the selected note nor
// any written voice's rhythmic clock, lyrics or independent part markup.
import {inspectAdvancedMeasure} from './advanced-score.js';

const all=(n,t)=>n?[...n.children].filter(c=>c.localName===t):[];
const first=(n,t)=>all(n,t)[0]||null;
const fail=m=>{throw new Error(m);};
const valid=(n,lo,hi)=>Number.isSafeInteger(n)&&n>=lo&&n<=hi;
const ACCIDENTAL=Object.freeze({[-2]:'flat-flat',[-1]:'flat',[1]:'sharp',[2]:'double-sharp'});
function make(parent,tag,text){
  const doc=parent.ownerDocument;
  const node=doc.createElementNS?doc.createElementNS(parent.namespaceURI??null,tag):doc.createElement(tag);
  if(text!==undefined)node.textContent=String(text);
  return node;
}
function locate(source,{partId,measureIndex,eventIndex}){
  if(source?.documentElement?.localName!=='score-partwise'||
     typeof partId!=='string'||!partId||!valid(measureIndex,0,9999)||
     !valid(eventIndex,0,99999))
    fail('꾸밈음 편집을 위한 악기·마디·음표 위치가 올바르지 않습니다.');
  const parts=all(source.documentElement,'part').filter(p=>p.getAttribute('id')===partId);
  if(parts.length!==1)fail('악기 파트 ID가 없거나 중복되어 있습니다.');
  const measure=all(parts[0],'measure')[measureIndex],notes=all(measure,'note');
  const note=notes[eventIndex];
  if(!measure||!note)fail('선택한 음표를 찾지 못했습니다.');
  const audit=inspectAdvancedMeasure(source,partId,measureIndex);
  if(audit.reason)fail('이 마디의 박자 구조를 확인할 수 없습니다: '+audit.reason);
  return {audit,measure,note,notes};
}
const snap=audit=>JSON.stringify(audit.events.filter(e=>e.duration>0).map(e=>[
  e.start,e.duration,e.voice,e.staff,e.chord,e.rest,e.step,e.alter,e.octave,e.tuplet
]));
function check(before,after){
  if(after.reason||before.max!==after.max||snap(before)!==snap(after))
    fail('꾸밈음 편집으로 기존 음표·성부 박자가 변경되어 작업을 취소했습니다.');
}
export function insertGraceNote(source,{partId,measureIndex,eventIndex,
  step='C',alter=0,octave=4,slash=true,type='eighth'}={}){
  if(typeof step!=='string'||step.length!==1||!'CDEFGAB'.includes(step)||
     !valid(alter,-2,2)||!valid(octave,1,8)||typeof slash!=='boolean'||
     !['eighth','16th','32nd'].includes(type))
    fail('꾸밈음의 음정·변화표·옥타브 설정을 확인해 주세요.');
  const original=locate(source,{partId,measureIndex,eventIndex});
  const target=original.note;
  if(first(target,'rest')||first(target,'grace')||first(target,'chord')||
     first(target,'cue')||first(target,'unpitched')||!first(target,'pitch'))
    fail('꾸밈음은 일반 음표나 화음 첫 음표 앞에만 삽입합니다.');
  const oldGrace=original.notes.filter(n=>first(n,'grace')).length;
  if(oldGrace>=16)fail('한 마디에는 꾸밈음을 16개까지만 추가할 수 있습니다.');
  const doc=source.cloneNode(true);
  const part=all(doc.documentElement,'part').find(p=>p.getAttribute('id')===partId);
  const bar=all(part,'measure')[measureIndex],note=all(bar,'note')[eventIndex];
  const grace=make(bar,'note'),mark=make(grace,'grace');
  mark.setAttribute('slash',slash?'yes':'no');
  grace.appendChild(mark);
  const pitch=make(grace,'pitch');
  pitch.appendChild(make(pitch,'step',step));
  if(alter)pitch.appendChild(make(pitch,'alter',alter));
  pitch.appendChild(make(pitch,'octave',octave));
  grace.appendChild(pitch);
  const voice=first(note,'voice');
  if(voice)grace.appendChild(voice.cloneNode(true));
  grace.appendChild(make(grace,'type',type));
  if(alter)grace.appendChild(make(grace,'accidental',ACCIDENTAL[alter]));
  const staff=first(note,'staff');
  if(staff)grace.appendChild(staff.cloneNode(true));
  bar.insertBefore(grace,note);
  const after=inspectAdvancedMeasure(doc,partId,measureIndex);
  check(original.audit,after);
  const inserted=all(bar,'note')[eventIndex];
  if(!first(inserted,'grace')||first(inserted,'duration')||
     after.events[eventIndex]?.duration!==0)
    fail('꾸밈음이 무박자 음표로 생성되지 않았습니다.');
  return {doc,change:{action:'insert-grace-note',partId,measureIndex,
    eventIndex,step,alter,octave,slash,type,
    nextMeasureIndex:measureIndex,nextEventIndex:eventIndex+1}};
}
export function removeGraceNote(source,{partId,measureIndex,eventIndex}={}){
  const original=locate(source,{partId,measureIndex,eventIndex});
  const note=original.note;
  if(!first(note,'grace')||first(note,'duration')||
     [...note.children].some(x=>!new Set(['grace','pitch','voice','type','accidental','staff','stem'])
       .has(x.localName))||all(note,'grace').length!==1)
    fail('복잡한 기보가 없는 무박자 꾸밈음만 삭제할 수 있습니다.');
  const doc=source.cloneNode(true),part=all(doc.documentElement,'part')
    .find(p=>p.getAttribute('id')===partId);
  const bar=all(part,'measure')[measureIndex];
  bar.removeChild(all(bar,'note')[eventIndex]);
  const after=inspectAdvancedMeasure(doc,partId,measureIndex);
  check(original.audit,after);
  return {doc,change:{action:'remove-grace-note',partId,measureIndex,eventIndex,
    nextMeasureIndex:measureIndex,nextEventIndex:Math.max(0,eventIndex-1)}};
}


// Edit an existing zero-duration grace note, leaving every other event,
// including the accented main note, unchanged. Keep unsupported editorial
// attachments intact by refusing to change them.
export function editGraceNote(source,{partId,measureIndex,eventIndex,
  step='C',alter=0,octave=4,slash=true,type='eighth'}={}){
  if(typeof step!=='string'||step.length!==1||!'CDEFGAB'.includes(step)||
     !valid(alter,-2,2)||!valid(octave,1,8)||typeof slash!=='boolean'||
     !['eighth','16th','32nd'].includes(type))
    fail('꾸밈음의 음정·빗금·음표 길이 표기를 확인해 주세요.');
  const original=locate(source,{partId,measureIndex,eventIndex}),note=original.note;
  const grace=first(note,'grace'),pitch=first(note,'pitch'),writtenType=first(note,'type');
  const allowed=new Set(['grace','pitch','voice','type','accidental','staff','stem']);
  if(!grace||!pitch||!writtenType||first(note,'duration')||
     note.attributes?.length||all(note,'grace').length!==1||
     all(note,'pitch').length!==1||all(note,'type').length!==1||
     all(note,'accidental').length>1||
     [...note.children].some(n=>!allowed.has(n.localName))||
     [...grace.attributes].some(a=>a.name!=='slash')||
     (grace.getAttribute('slash')!==null&&
      !['yes','no'].includes(grace.getAttribute('slash')))||
     [...pitch.children].some(n=>!['step','alter','octave'].includes(n.localName))||
     all(pitch,'step').length!==1||all(pitch,'octave').length!==1||
     all(pitch,'alter').length>1||pitch.attributes?.length||
     writtenType.attributes?.length||writtenType.children.length||
     [...all(note,'accidental')].some(n=>n.attributes?.length||n.children.length||
       !['flat-flat','flat','natural','sharp','double-sharp'].includes(n.textContent.trim())))
    fail('기존 꾸밈음에 수정할 수 없는 장식·속성 또는 구조가 있습니다.');
  const oldStep=first(pitch,'step').textContent.trim(),
    oldAlter=Number(first(pitch,'alter')?.textContent.trim()||0),
    oldOctave=Number(first(pitch,'octave').textContent.trim());
  if(!'CDEFGAB'.includes(oldStep)||oldStep.length!==1||
     !valid(oldAlter,-2,2)||!valid(oldOctave,1,8)||
     !['eighth','16th','32nd'].includes(writtenType.textContent.trim()))
    fail('기존 꾸밈음의 음정·음표 종류가 지원되지 않습니다.');
  const accidental=all(note,'accidental');
  const oldSlash=grace.getAttribute('slash')==='yes';
  if(oldStep===step&&oldAlter===alter&&oldOctave===octave&&
     oldSlash===slash&&writtenType.textContent.trim()===type)
    fail('이미 같은 꾸밈음 설정입니다.');
  const doc=source.cloneNode(true);
  const part=all(doc.documentElement,'part').find(p=>p.getAttribute('id')===partId);
  const bar=all(part,'measure')[measureIndex],notes=all(bar,'note'),target=notes[eventIndex];
  const nextGrace=first(target,'grace');
  nextGrace.setAttribute('slash',slash?'yes':'no');
  const newPitch=make(target,'pitch');
  newPitch.appendChild(make(newPitch,'step',step));
  if(alter!==0)newPitch.appendChild(make(newPitch,'alter',alter));
  newPitch.appendChild(make(newPitch,'octave',octave));
  target.replaceChild(newPitch,first(target,'pitch'));
  first(target,'type').textContent=type;
  for(const mark of all(target,'accidental'))target.removeChild(mark);
  const accidentalName=alter===0?
    (accidental.length||oldStep===step&&oldAlter!==0?'natural':null):
    ACCIDENTAL[alter];
  if(accidentalName){
    const mark=make(target,'accidental',accidentalName);
    target.insertBefore(mark,first(target,'stem')||first(target,'staff')||null);
  }
  const after=inspectAdvancedMeasure(doc,partId,measureIndex);
  check(original.audit,after);
  const edited=all(bar,'note')[eventIndex];
  if(after.events[eventIndex]?.duration!==0||!first(edited,'grace')||
     first(edited,'duration')||first(first(edited,'pitch'),'step')?.textContent!==step||
     Number(first(first(edited,'pitch'),'alter')?.textContent||0)!==alter||
     Number(first(first(edited,'pitch'),'octave')?.textContent)!==octave)
    fail('꾸밈음 편집이 박자 없는 음표로 보존되지 않았습니다.');
  return {doc,change:{action:'edit-grace-note',partId,measureIndex,eventIndex,
    step,alter,octave,slash,type,nextMeasureIndex:measureIndex,
    nextEventIndex:eventIndex}};
}
