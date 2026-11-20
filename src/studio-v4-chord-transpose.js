// Semitone-accurate transposition of a complete ordinary MusicXML chord.
//
// All tones are changed as a single immutable transaction. Sounding ties,
// decorations with pitch-dependent semantics, grace notes and unsupported
// embeddings fail closed. This is intentionally not an instrument transposition
// or a key-signature change.
import {inspectAdvancedMeasure} from './advanced-score.js';
const all=(n,t)=>n?[...n.children].filter(x=>x.localName===t):[];
const one=(n,t)=>all(n,t)[0]||null;
const txt=(n,t)=>one(n,t)?.textContent?.trim()||'';
const err=s=>{throw new Error(s);};
const integer=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const semis=Object.freeze({C:0,D:2,E:4,F:5,G:7,A:9,B:11});
const SHARPS=[['C',0],['C',1],['D',0],['D',1],['E',0],['F',0],['F',1],
  ['G',0],['G',1],['A',0],['A',1],['B',0]];
const FLATS=[['C',0],['D',-1],['D',0],['E',-1],['E',0],['F',0],['G',-1],
  ['G',0],['A',-1],['A',0],['B',-1],['B',0]];
const find=(doc,partId,measureIndex)=>{
  if(doc?.documentElement?.localName!=='score-partwise'||!partId||
    !integer(measureIndex,0,9999))err('파트와 마디 정보가 올바르지 않습니다.');
  const part=all(doc.documentElement,'part').find(x=>x.getAttribute('id')===partId);
  const measure=all(part,'measure')[measureIndex];
  if(!part||!measure)err('선택한 마디를 찾지 못했습니다.');
  return measure;
};
function element(parent,tag,content){
  const d=parent.ownerDocument;
  const n=d.createElementNS?d.createElementNS(parent.namespaceURI??null,tag):d.createElement(tag);
  if(content!==undefined)n.textContent=String(content);
  return n;
}
function midi(note){
  const p=one(note,'pitch'),step=txt(p,'step'),alter=txt(p,'alter')?Number(txt(p,'alter')):0,
    octave=Number(txt(p,'octave'));
  if(!(step in semis)||!integer(alter,-2,2)||!integer(octave,0,8))
    err('화음 구성 음정에 올바르지 않은 값이 있습니다.');
  return (octave+1)*12+semis[step]+alter;
}
function guard(note){
  const names=new Set(['chord','pitch','duration','voice','type','dot','staff','stem','accidental','lyric','beam']);
  if(!note||note.localName!=='note'||note.attributes?.length||
    !one(note,'pitch')||!one(note,'duration')||!one(note,'type')||
    [...note.children].some(x=>!names.has(x.localName)))
    err('붙임줄·장식·특수 표기가 포함된 화음은 전체 이동을 보호합니다.');
}
export function transposeChordChromatically(source,{partId,measureIndex,eventIndex,
  semitones=1,spelling='sharp'}={}){
  if(!integer(eventIndex,0,99999)||!integer(semitones,-12,12)||semitones===0||
    !['sharp','flat'].includes(spelling))
    err('화음의 반음 이동 값 또는 임시표 방향이 올바르지 않습니다.');
  const measure=find(source,partId,measureIndex),notes=all(measure,'note');
  if(!notes[eventIndex])err('이동할 음표를 찾지 못했습니다.');
  const audit=inspectAdvancedMeasure(source,partId,measureIndex);
  if(audit.reason)err('다성부 마디가 보호된 상태라 화음을 변경하지 않습니다.');
  let firstIndex=eventIndex;
  while(firstIndex>0&&one(notes[firstIndex],'chord'))firstIndex--;
  if(!notes[firstIndex+1]||!one(notes[firstIndex+1],'chord'))
    err('두 개 이상의 음표로 구성된 화음을 선택해 주세요.');
  let endIndex=firstIndex+1;
  while(endIndex<notes.length&&one(notes[endIndex],'chord'))endIndex++;
  if(eventIndex>=endIndex)err('선택 음표가 화음 범위에 속하지 않습니다.');
  const originalEvents=audit.events.slice(firstIndex,endIndex),anchor=originalEvents[0];
  if(!anchor||anchor.rest||anchor.chord||originalEvents.some(e=>
    e.voice!==anchor.voice||e.staff!==anchor.staff||e.start!==anchor.start||
    e.duration!==anchor.duration||e.rest||e.tuplet))
    err('화음의 박자·성부·보표가 일치하지 않습니다.');
  for(let i=firstIndex;i<endIndex;i++){
    guard(notes[i]);
    if(i>firstIndex&&notes[i-1].nextSibling!==notes[i])
      err('화음 구성 음표가 연속되지 않았습니다.');
  }
  const originalMidi=notes.slice(firstIndex,endIndex).map(midi);
  const shiftedMidi=originalMidi.map(m=>m+semitones);
  if(shiftedMidi.some(m=>m<0||m>127))
    err('화음 이동 후 음역이 MIDI 표기 범위를 벗어납니다.');
  const doc=source.cloneNode(true),nextMeasure=find(doc,partId,measureIndex),
    nextNotes=all(nextMeasure,'note'),spell=spelling==='sharp'?SHARPS:FLATS;
  for(let i=firstIndex;i<endIndex;i++){
    const n=nextNotes[i],m=shiftedMidi[i-firstIndex],octave=Math.floor(m/12)-1,
      [step,alter]=spell[m%12];
    if(!integer(octave,0,8))err('화음 이동 후 옥타브가 지원 범위 밖입니다.');
    const p=one(n,'pitch');
    for(const child of [...p.children])p.removeChild(child);
    p.appendChild(element(p,'step',step));
    if(alter)p.appendChild(element(p,'alter',alter));
    p.appendChild(element(p,'octave',octave));
    for(const old of all(n,'accidental'))n.removeChild(old);
    if(alter){
      const accidental=element(n,'accidental',alter>0?'sharp':'flat');
      const before=one(n,'time-modification')||one(n,'stem')||one(n,'staff')||one(n,'beam')||one(n,'notations')||one(n,'lyric');
      n.insertBefore(accidental,before||null);
    }
  }
  const newAudit=inspectAdvancedMeasure(doc,partId,measureIndex);
  if(newAudit.reason||newAudit.max!==audit.max||newAudit.events.length!==audit.events.length)
    err('변경 후 성부 또는 마디 구조가 달라졌습니다.');
  for(let i=0;i<audit.events.length;i++){
    const a=audit.events[i],b=newAudit.events[i];
    if(a.start!==b.start||a.duration!==b.duration||a.voice!==b.voice||
      a.staff!==b.staff||a.chord!==b.chord||a.rest!==b.rest)
      err('화음 이동 중 원래 리듬이 변경됐습니다.');
    if(i<firstIndex||i>=endIndex){
      if(a.step!==b.step||a.alter!==b.alter||a.octave!==b.octave)
        err('화음 밖 음표가 변경되었습니다.');
    }
  }
  const actualMidi=nextNotes.slice(firstIndex,endIndex).map(midi);
  if(JSON.stringify(actualMidi)!==JSON.stringify(shiftedMidi))
    err('화음 반음 이동 결과가 정확하지 않습니다.');
  return {doc,change:{action:'chromatic-chord-transpose',partId,measureIndex,
    eventIndex,firstEventIndex:firstIndex,lastEventIndex:endIndex-1,semitones,spelling}};
}
