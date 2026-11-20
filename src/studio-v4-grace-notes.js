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
  step='C',alter=0,octave=4,slash=true}={}){
  if(typeof step!=='string'||step.length!==1||!'CDEFGAB'.includes(step)||
     !valid(alter,-2,2)||!valid(octave,1,8)||typeof slash!=='boolean')
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
  grace.appendChild(make(grace,'type','eighth'));
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
    eventIndex,step,alter,octave,slash,
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
