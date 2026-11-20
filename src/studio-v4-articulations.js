// Toggle a single MusicXML articulation in an already-notated score.
// Accepts notes that have ties, slurs, tuplets, lyrics and independent
// polyphonic voices. Never rewrites those notations or their rhythmic clocks.
import {inspectAdvancedMeasure} from './advanced-score.js';

const all=(parent,tag)=>parent?[...parent.children].filter(x=>x.localName===tag):[];
const first=(parent,tag)=>all(parent,tag)[0]||null;
const fail=m=>{throw new Error(m);};
const int=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const KINDS=new Set(['staccato','staccatissimo','tenuto','accent','strong-accent',
  'detached-legato','spiccato']);
function make(parent,tag){
  const doc=parent.ownerDocument;
  return doc.createElementNS?doc.createElementNS(parent.namespaceURI??null,tag):
    doc.createElement(tag);
}
const eventClock=events=>events.map(e=>[e.start,e.duration,e.voice,e.staff,e.rest,
  e.step,e.alter,e.octave,e.chord,e.tuplet]);
function inspect(source,{partId,measureIndex,eventIndex,kind}){
  if(source?.documentElement?.localName!=='score-partwise'||
     typeof partId!=='string'||!partId||!int(measureIndex,0,9999)||
     !int(eventIndex,0,99999)||!KINDS.has(kind))
    fail('아티큘레이션 종류 또는 선택 위치를 확인해 주세요.');
  const parts=all(source.documentElement,'part').filter(n=>n.getAttribute('id')===partId);
  if(parts.length!==1)fail('악기 파트 ID가 누락되거나 중복됐습니다.');
  const measure=all(parts[0],'measure')[measureIndex];
  const note=all(measure,'note')[eventIndex];
  if(!note||first(note,'rest')||first(note,'grace')||first(note,'cue')||
     first(note,'unpitched')||first(note,'chord')||!first(note,'pitch'))
    fail('음정이 있는 일반 음표 또는 화음의 첫 음표를 선택해 주세요.');
  if(note.attributes?.length||all(note,'notations').length>1)
    fail('이 음표에는 안전하게 수정할 수 없는 복합 기보가 있습니다.');
  const notation=first(note,'notations');
  if(notation&&all(notation,'articulations').length>1)
    fail('아티큘레이션 그룹이 여러 개라 자동 편집하지 않습니다.');
  const group=first(notation,'articulations');
  if(group&&(group.attributes?.length||all(group,kind).length>1))
    fail('지원하지 않는 중복 아티큘레이션 표기가 있습니다.');
  const audit=inspectAdvancedMeasure(source,partId,measureIndex);
  if(audit.reason||!audit.events[eventIndex])
    fail('이 마디의 시간 구조가 불명확해 기호 수정을 차단했습니다.');
  return {audit,partId,measureIndex,eventIndex,kind,already:!!first(group,kind)};
}
export function toggleAdvancedArticulation(source,params={}){
  const spec=inspect(source,params),doc=source.cloneNode(true);
  const part=all(doc.documentElement,'part').find(p=>p.getAttribute('id')===spec.partId);
  const bar=all(part,'measure')[spec.measureIndex];
  const note=all(bar,'note')[spec.eventIndex];
  let notations=first(note,'notations');
  if(!notations){notations=make(note,'notations');
    note.insertBefore(notations,first(note,'lyric')||null);
  }
  let group=first(notations,'articulations');
  if(!group){
    group=make(notations,'articulations');
    const laterNames=new Set(['dynamics','fermata','arpeggiate','non-arpeggiate',
      'accidental-mark','other-notation']);
    const next=[...notations.children].find(n=>laterNames.has(n.localName))||null;
    notations.insertBefore(group,next);
  }
  const previous=first(group,spec.kind);
  if(previous)group.removeChild(previous);
  else group.appendChild(make(group,spec.kind));
  if(!group.children.length)notations.removeChild(group);
  if(!notations.children.length)note.removeChild(notations);
  const after=inspectAdvancedMeasure(doc,spec.partId,spec.measureIndex);
  if(after.reason||after.max!==spec.audit.max||
     JSON.stringify(eventClock(after.events))!==JSON.stringify(eventClock(spec.audit.events)))
    fail('표현 기호 수정 후 음표·성부·박자 구조가 변경됐습니다.');
  const edited=all(bar,'note')[spec.eventIndex],mark=first(first(first(edited,'notations'),
    'articulations'),spec.kind);
  if(!!mark===spec.already)
    fail('아티큘레이션 토글 결과를 확인할 수 없습니다.');
  return {doc,change:{action:'toggle-advanced-articulation',partId:spec.partId,
    measureIndex:spec.measureIndex,eventIndex:spec.eventIndex,kind:spec.kind,
    enabled:!spec.already,nextMeasureIndex:spec.measureIndex,
    nextEventIndex:spec.eventIndex}};
}
export const ADVANCED_ARTICULATIONS=[...KINDS];
