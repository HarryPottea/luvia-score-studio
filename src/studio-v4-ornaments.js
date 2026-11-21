// Semantics-preserving ornament toggles for MusicXML, including tied/slurred
// notes, independent voices and lyrics. Only one specified empty MusicXML
// ornament element is added or removed. Every rhythm and pitch remains fixed.
import {inspectAdvancedMeasure} from './advanced-score.js';
import {assertNotationMutation} from './studio-v4-notation-guard.js';

const all=(node,tag)=>node?[...node.children].filter(n=>n.localName===tag):[];
const first=(node,tag)=>all(node,tag)[0]||null;
const fail=message=>{throw new Error(message);};
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
export const SUPPORTED_ORNAMENTS=Object.freeze([
  'trill-mark','turn','inverted-turn','mordent','inverted-mordent'
]);
const make=(parent,tag)=>{
  const d=parent.ownerDocument;
  return d.createElementNS?d.createElementNS(parent.namespaceURI??null,tag):d.createElement(tag);
};
const clock=measure=>JSON.stringify(measure.events.map(e=>[
  e.start,e.duration,e.voice,e.staff,e.step,e.alter,e.octave,
  e.chord,e.rest,e.tuplet
]));
export function toggleMusicXmlOrnament(source,{
  partId,measureIndex,eventIndex,kind='trill-mark'
}={}){
  if(source?.documentElement?.localName!=='score-partwise'||typeof partId!=='string'||
     !partId||!integer(measureIndex,0,9999)||!integer(eventIndex,0,99999)||
     !SUPPORTED_ORNAMENTS.includes(kind))
    fail('음악 장식 기호의 종류나 음표 위치를 확인해 주세요.');
  const parts=all(source.documentElement,'part').filter(p=>p.getAttribute('id')===partId);
  if(parts.length!==1)fail('선택한 악기 파트를 찾지 못했거나 중복됐습니다.');
  const bar=all(parts[0],'measure')[measureIndex],
    note=all(bar,'note')[eventIndex];
  if(!bar||!note||first(note,'rest')||first(note,'grace')||first(note,'cue')||
     first(note,'unpitched')||first(note,'chord')||!first(note,'pitch'))
    fail('일반 음표 또는 화음 첫 음표에만 장식 기호를 추가할 수 있습니다.');
  if(all(note,'notations').length>1||all(note,'notations')[0]?.attributes?.length)
    fail('중복 또는 특수 notations 기호는 보호합니다.');
  const notation=first(note,'notations'),group=first(notation,'ornaments');
  if(all(notation,'ornaments').length>1||group?.attributes?.length||
     all(group,kind).length>1||
     all(group,kind).some(n=>n.attributes.length||n.children.length))
    fail('복잡한 장식 기호 그룹은 임의로 변경하지 않습니다.');
  const initial=inspectAdvancedMeasure(source,partId,measureIndex);
  if(initial.reason||!initial.events[eventIndex])
    fail('음표의 성부 또는 박자 구조를 검증할 수 없습니다.');
  const existed=!!first(group,kind),doc=source.cloneNode(true);
  const copyPart=all(doc.documentElement,'part').find(p=>p.getAttribute('id')===partId);
  const copyNote=all(all(copyPart,'measure')[measureIndex],'note')[eventIndex];
  let nextNotations=first(copyNote,'notations');
  if(!nextNotations){
    nextNotations=make(copyNote,'notations');
    copyNote.insertBefore(nextNotations,first(copyNote,'lyric')||null);
  }
  let nextOrnaments=first(nextNotations,'ornaments');
  if(!nextOrnaments){
    nextOrnaments=make(nextNotations,'ornaments');
    const later=new Set(['technical','articulations','dynamics','fermata','arpeggiate',
      'non-arpeggiate','accidental-mark','other-notation']);
    nextNotations.insertBefore(nextOrnaments,
      [...nextNotations.children].find(n=>later.has(n.localName))||null);
  }
  const old=first(nextOrnaments,kind);
  if(old)nextOrnaments.removeChild(old);
  else nextOrnaments.appendChild(make(nextOrnaments,kind));
  if(!nextOrnaments.children.length)nextNotations.removeChild(nextOrnaments);
  if(!nextNotations.children.length)copyNote.removeChild(nextNotations);
  const after=inspectAdvancedMeasure(doc,partId,measureIndex);
  if(after.reason||initial.max!==after.max||clock(initial)!==clock(after))
    fail('장식 기호 편집으로 음표·성부·박자 정보가 변경됐습니다.');
  const actual=first(first(first(copyNote,'notations'),'ornaments'),kind);
  if(!!actual===existed)
    fail('장식 기호 추가·제거 결과를 확인할 수 없습니다.');
  assertNotationMutation(source,doc,{partId,targets:[{measureIndex,eventIndex,
    allowed:[{name:'ornaments',kind}]}]});
  return {doc,change:{action:'toggle-ornament',partId,measureIndex,eventIndex,
    kind,enabled:!existed,nextMeasureIndex:measureIndex,nextEventIndex:eventIndex}};
}
