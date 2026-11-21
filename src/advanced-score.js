// J-WOO 3.1: measure-aware view of MusicXML chord/voice/tuplet timelines.
// Advanced transformations are pitch-only and chord-tone edits: rhythmic offsets
// (including backup/forward and <time-modification>) remain untouched.
const direct = (n,t) => n ? [...n.children].find(c=>c.localName===t)||null:null;
const all = (n,t) => n ? [...n.children].filter(c=>c.localName===t):[];
const value = (n,t) => direct(n,t)?.textContent?.trim()||'';
const integer = text => /^(0|[1-9]\d*)$/.test(String(text)) && Number.isSafeInteger(Number(text)) ? Number(text) : null;
const steps='CDEFGAB';
const deny = m=>{throw new Error(m);};
const signature = n => [value(direct(n,'pitch'),'step'),value(direct(n,'pitch'),'alter')||'0',value(direct(n,'pitch'),'octave')].join(':');
const pitchValid = (step,alter,octave) => typeof step==='string'&&steps.includes(step)&&step.length===1&&Number.isSafeInteger(alter)&&alter>=-2&&alter<=2&&Number.isSafeInteger(octave)&&octave>=1&&octave<=8;
const allowedTuplet = note => {
  const t=direct(note,'time-modification');
  if(!t)return null;
  const actual=integer(value(t,'actual-notes')),normal=integer(value(t,'normal-notes'));
  if(!actual||!normal||actual>32||normal>32)return '셋잇단음 비율을 해석할 수 없습니다.';
  if(all(t,'actual-notes').length!==1||all(t,'normal-notes').length!==1)return '셋잇단음 정보가 중복되었습니다.';
  return null;
};
const defaultState=()=>({divisions:null,beats:null,beatType:null});
const partElements=doc=>all(doc?.documentElement,'part');
function findPart(doc,id){
  if(doc?.documentElement?.localName!=='score-partwise')deny('MusicXML partwise 악보만 편집할 수 있습니다.');
  const p=partElements(doc).find(x=>x.getAttribute('id')===id);
  if(!p)deny('선택한 파트를 찾지 못했습니다.');
  return p;
}
function beforeMeasure(part,index) {
  if(!Number.isSafeInteger(index)||index<0)deny('마디 인덱스가 올바르지 않습니다.');
  const measures=all(part,'measure');if(!measures[index])deny('마디를 찾지 못했습니다.');
  const state=defaultState();
  for(let i=0;i<=index;i++) {
    for(const attrs of all(measures[i],'attributes')) {
      const div=value(attrs,'divisions');if(div!=='')state.divisions=integer(div);
      const time=direct(attrs,'time');
      if(time) {
        state.beats=integer(value(time,'beats'));
        state.beatType=integer(value(time,'beat-type'));
      }
    }
  }
  return {measure:measures[index],state};
}
function inspectPartMeasure(part,index) {
  const {measure,state}=beforeMeasure(part,index);
  const {divisions,beats,beatType}=state;
  let reason=null;
  if(!divisions||!beats||!beatType||![2,3,4,6].includes(beats)||![4,8].includes(beatType))
    reason='지원하지 않는 박자/분할 정보입니다.';
  const max=divisions&&beats&&beatType?divisions*beats*4/beatType:null;
  if(!Number.isSafeInteger(max)||max<=0)reason='마디 길이가 정수가 아닙니다.';
  if(measure.getAttribute('implicit')==='yes')reason='못갖춘마디는 보호합니다.';
  if(all(measure,'attributes').length>1)reason='마디 안의 중복 속성 변경은 보호합니다.';
  const nodes=[...measure.children];
  if(nodes.some((c,i)=>c.localName==='attributes'&&nodes.slice(0,i).some(x=>x.localName==='note')))
    reason='마디 중간 속성 변경은 보호합니다.';
  let cursor=0, previousOnset=null, previousVoice='',previousStaff='';
  const events=[], lanes=new Map();
  let eventIndex=0;
  for(const node of nodes) {
    const kind=node.localName;
    if(kind==='backup'||kind==='forward') {
      const delta=integer(value(node,'duration'));
      if(!delta||delta>1000000){reason='음악적 시간 이동값이 올바르지 않습니다.';continue;}
      cursor+=(kind==='backup'?-delta:delta);
      if(cursor<0||cursor>max)reason='성부의 시간 위치가 마디 범위를 벗어났습니다.';
      previousOnset=null;continue;
    }
    if(kind!=='note')continue;
    const isChord=!!direct(node,'chord');
    const isGrace=!!direct(node,'grace');
    const duration=isGrace?0:integer(value(node,'duration'));
    const voice=value(node,'voice')||'1',staff=value(node,'staff')||'1';
    const rest=!!direct(node,'rest'), pitch=direct(node,'pitch');
    const tuplet=!!direct(node,'time-modification');
    const startsAt=isChord?previousOnset:cursor;
    if((!isGrace&&(!duration||duration<=0))||startsAt===null||
       startsAt<0||startsAt+duration>max)
      reason='음표 또는 화음의 시간 길이가 올바르지 않습니다.';
    if(isGrace&&(isChord||direct(node,'duration')||all(node,'grace').length!==1||
       !direct(node,'pitch')||direct(node,'rest')||!direct(node,'type')))
      reason='꾸밈음은 음정이 있고 박자를 소비하지 않는 독립 음표여야 합니다.';
    if(isChord&&(voice!==previousVoice||staff!==previousStaff))reason='화음에 서로 다른 성부나 보표가 섞여 있습니다.';
    if(tuplet&&allowedTuplet(node))reason=allowedTuplet(node);
    if(!rest&&!pitch)reason='음표 음정 정보가 누락되었습니다.';
    if(pitch&&(!steps.includes(value(pitch,'step'))||!integer(value(pitch,'octave'))))reason='음표 음정을 확인할 수 없습니다.';
    const noteTagKinds=[...node.children].map(c=>c.localName);
    const notations=direct(node,'notations');
    const unsafeNotations=!!notations&&[...notations.children].some(el=>el.localName!=='tuplet');
    const protectedMarkup=unsafeNotations||noteTagKinds.some(k=>['grace','cue','tie','unpitched'].includes(k));
    const lane=voice+'@'+staff;
    const event={eventIndex,partId:part.getAttribute('id'),measureIndex:index,
      start:startsAt,duration:duration||0,voice,staff,chord:isChord,rest,tuplet,
      type:value(node,'type'),step:value(pitch,'step'),
      alter:value(pitch,'alter')===''?0:Number(value(pitch,'alter')),
      octave:integer(value(pitch,'octave')),editablePitch:!protectedMarkup&&!rest&&!!pitch,
      editableChordTone:!protectedMarkup&&!rest&&!!pitch,
      protectedMarkup};
    events.push(event);
    if(!isChord) {
      if(!isGrace){
        if(!lanes.has(lane))lanes.set(lane,[]);
        lanes.get(lane).push({start:startsAt,end:startsAt+(duration||0)});
        cursor+=(duration||0);
        previousOnset=startsAt;
        previousVoice=voice;previousStaff=staff;
      }else previousOnset=null;
    }
    else {
      const found=events.slice(0,-1).reverse().find(e=>!e.chord&&e.start===startsAt&&e.voice===voice&&e.staff===staff);
      if(!found||found.duration!==duration)reason='화음 구성 음표의 길이가 서로 다릅니다.';
    }
    eventIndex++;
  }
  for(const list of lanes.values()) {
    const sorted=[...list].sort((a,b)=>a.start-b.start);
    for(let i=1;i<sorted.length;i++)if(sorted[i].start<sorted[i-1].end)reason='한 성부에서 음표 길이가 겹칩니다.';
    if(sorted.length&&sorted[sorted.length-1].end>max)reason='성부가 마디를 벗어났습니다.';
  }
  // A voice containing only partial duration is readable; pitch-only operations remain
  // safe because backup/forward, measure offsets, and durations are not rewritten.
  return {partId:part.getAttribute('id'),index,number:measure.getAttribute('number')||String(index+1),
    beats,beatType,divisions,max,events,voices:[...lanes.keys()],reason};
}
export function inspectAdvancedMeasure(doc,partId,measureIndex){
  return inspectPartMeasure(findPart(doc,partId),measureIndex);
}
export function listAdvancedMeasures(doc){
  if(doc?.documentElement?.localName!=='score-partwise')deny('MusicXML 형식이 올바르지 않습니다.');
  const partList=direct(doc.documentElement,'part-list');
  const names=new Map(all(partList,'score-part').map(c=>[c.getAttribute('id'),value(c,'part-name')]));
  return partElements(doc).map(part=>({id:part.getAttribute('id'),name:names.get(part.getAttribute('id'))||part.getAttribute('id'),
    measures:all(part,'measure').map((_,i)=>inspectPartMeasure(part,i))}));
}
function xmlElement(parent,tag,text=null) {
  const doc=parent.ownerDocument;
  const el=doc.createElementNS?doc.createElementNS(parent.namespaceURI??null,tag):doc.createElement(tag);
  if(text!==null)el.textContent=String(text);
  return el;
}
function insertPitch(note,step,alter,octave){
  if(!pitchValid(step,alter,octave))deny('음정 입력값이 잘못되었습니다.');
  const old=direct(note,'pitch');
  if(!old)deny('기존 피치를 찾지 못했습니다.');
  const pitch=xmlElement(note,'pitch');
  pitch.appendChild(xmlElement(pitch,'step',step));
  if(alter!==0)pitch.appendChild(xmlElement(pitch,'alter',alter));
  pitch.appendChild(xmlElement(pitch,'octave',octave));
  note.replaceChild(pitch,old);
  for(const elt of all(note,'accidental'))note.removeChild(elt);
  for(const name of ['default-x','default-y','relative-x','relative-y'])note.removeAttribute(name);
}
function createChordTone(measure,anchor,step,alter,octave){
  if(!pitchValid(step,alter,octave))deny('음정이 잘못되었습니다.');
  if(!direct(anchor,'pitch')||direct(anchor,'rest'))deny('화음의 기존 음표가 올바르지 않습니다.');
  const eventNodes=all(measure,'note');
  const index=eventNodes.indexOf(anchor);
  if(index<0)deny('화음의 기준 음표를 찾지 못했습니다.');
  const chordGroup=[anchor];
  for(let i=index+1;i<eventNodes.length&&direct(eventNodes[i],'chord');i++)chordGroup.push(eventNodes[i]);
  const targetSignature=[step,String(alter),String(octave)].join(':');
  if(chordGroup.some(n=>signature(n)===targetSignature))deny('동일한 음정의 화음이 이미 있습니다.');
  if(chordGroup.some(n=>[...n.children].some(el=>['grace','cue','tie','notations','unpitched'].includes(el.localName))))deny('복잡한 화음 표기가 있어 추가하지 않습니다.');
  const newNote=xmlElement(measure,'note');
  newNote.appendChild(xmlElement(newNote,'chord'));
  const pitch=xmlElement(newNote,'pitch');
  pitch.appendChild(xmlElement(pitch,'step',step));
  if(alter!==0)pitch.appendChild(xmlElement(pitch,'alter',alter));
  pitch.appendChild(xmlElement(pitch,'octave',octave));
  newNote.appendChild(pitch);
  for(const tag of ['duration','voice','type','dot','time-modification','staff']){
    for(const match of all(anchor,tag))newNote.appendChild(match.cloneNode(true));
  }
  const last=chordGroup[chordGroup.length-1];
  measure.insertBefore(newNote,last.nextSibling);
}
function deleteChordTone(measure,selected){
  const notes=all(measure,'note'),at=notes.indexOf(selected);
  if(at<0)deny('선택한 화음 음표를 찾지 못했습니다.');
  if(direct(selected,'chord')){
    if([...selected.children].some(el=>['tie','notations','lyric','grace','cue'].includes(el.localName)))
      deny('중요 기보가 포함된 화음 음표는 삭제하지 않습니다.');
    measure.removeChild(selected);return;
  }
  // When removing the root of a chord, promote the first following chord tone.
  // The new root keeps the same onset, duration, voice and staff. Preserve any
  // Korean or multi-verse lyrics on the original attack; never silently discard.
  const successor=notes[at+1];
  if(!successor||!direct(successor,'chord'))
    deny('화음의 기준 음표가 아닙니다.');
  const safeRoot=new Set(['pitch','duration','voice','type','dot','staff','lyric']);
  if(selected.attributes?.length||[...selected.children].some(el=>!safeRoot.has(el.localName))||
     [...successor.children].some(el=>['grace','cue','tie','notations','lyric'].includes(el.localName)))
    deny('연결·장식·가사가 겹치는 화음은 보호합니다.');
  const originals=all(selected,'lyric');
  if(originals.length>12)deny('가사 절이 너무 많아 보존할 수 없습니다.');
  const chord=direct(successor,'chord');
  successor.removeChild(chord);
  for(const lyric of originals)successor.appendChild(lyric.cloneNode(true));
  measure.removeChild(selected);
}
export function editAdvancedScore(source,operation){
  if(!source||!operation||typeof operation!=='object')deny('악보 편집 요청이 잘못되었습니다.');
  const {partId,measureIndex,eventIndex,action,step,alter,octave}=operation;
  if(!['pitch','chord-add','chord-remove'].includes(action))deny('허용하지 않는 고급 편집입니다.');
  if(!Number.isSafeInteger(eventIndex)||eventIndex<0)deny('음표 위치가 잘못되었습니다.');
  const doc=source.cloneNode(true);
  const part=findPart(doc,partId),pre=inspectPartMeasure(part,measureIndex);
  if(pre.reason)deny(pre.reason);
  const event=pre.events[eventIndex];
  if(!event)deny('음표를 찾지 못했습니다.');
  const measure=all(part,'measure')[measureIndex];
  const note=all(measure,'note')[eventIndex];
  if(action==='pitch'){
    if(!event.editablePitch)deny('음정을 수정할 수 없는 보호된 기보입니다.');
    insertPitch(note,step,alter,octave);
  }else if(action==='chord-add'){
    if(event.chord||!event.editableChordTone)deny('화음의 기준 음표를 선택해 주세요.');
    createChordTone(measure,note,step,alter,octave);
  }else{
    if(!event.editableChordTone)deny('화음의 음표를 삭제할 수 없는 보호된 기보입니다.');
    deleteChordTone(measure,note);
  }
  const post=inspectPartMeasure(part,measureIndex);
  if(post.reason||post.max!==pre.max)deny('편집 후 마디 구조 검증에 실패했습니다.');
  const before=pre.events.filter(e=>!e.chord).map(e=>[e.start,e.duration,e.voice,e.staff].join(':'));
  const after=post.events.filter(e=>!e.chord).map(e=>[e.start,e.duration,e.voice,e.staff].join(':'));
  if(JSON.stringify(before)!==JSON.stringify(after))deny('성부 시간표가 달라져 변경을 차단했습니다.');
  return {doc,change:{action,partId,measureIndex,eventIndex}};
}
