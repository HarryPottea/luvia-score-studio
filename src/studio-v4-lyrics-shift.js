// J-WOO 4.0 post-placement lyric correction. Immutable MusicXML-only transform.
// Move selected syllable and contiguous following lyrics by one eligible note.
// Existing pitches, durations, voices, staves, and other verses remain intact.
import {inspectAdvancedMeasure} from './advanced-score.js';

const many=(node,name)=>node?[...node.children].filter(x=>x.localName===name):[];
const one=(node,name)=>many(node,name)[0]||null;
const fail=message=>{throw new Error(message);};
const valid=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const tiedStop=note=>many(note,'tie').some(t=>t.getAttribute('type')==='stop')||
  many(one(note,'notations'),'tied').some(t=>t.getAttribute('type')==='stop');
const pitched=note=>!!one(note,'pitch')&&!['rest','grace','cue','unpitched'].some(t=>!!one(note,t));

function verseLyric(note,verse){
  const found=many(note,'lyric').filter(x=>(x.getAttribute('number')||'1')===verse);
  if(found.length>1)fail('같은 절의 가사가 중복되어 이동할 수 없습니다.');
  if(found.length&&([...found[0].attributes].some(a=>a.name!=='number')||
    [...found[0].children].some(n=>!['syllabic','text','extend'].includes(n.localName))))
    fail('복잡한 가사는 자동 이동하지 않습니다. 개별 편집을 이용해 주세요.');
  return found[0]||null;
}

function slotList(doc,partId,voice,staff){
  const part=many(doc.documentElement,'part').find(p=>p.getAttribute('id')===partId);
  if(!part)fail('선택한 파트를 찾지 못했습니다.');
  const measures=many(part,'measure');
  if(measures.length>3000)fail('악보가 너무 길어 이동할 수 없습니다.');
  const slots=[];
  for(let m=0;m<measures.length;m++){
    const audit=inspectAdvancedMeasure(doc,partId,m);
    if(audit.reason)fail((m+1)+'마디의 성부 구조가 보호되어 있습니다: '+audit.reason);
    const notes=many(measures[m],'note');
    for(const event of audit.events.filter(e=>e.voice===voice&&e.staff===staff&&!e.chord)
      .sort((a,b)=>a.start-b.start||a.eventIndex-b.eventIndex)){
      const note=notes[event.eventIndex];
      if(event.rest||tiedStop(note))continue;
      if(!pitched(note))fail((m+1)+'마디에 안전하지 않은 음표가 있습니다.');
      slots.push({measureIndex:m,eventIndex:event.eventIndex,note});
      if(slots.length>12000)fail('음표 수가 너무 많습니다.');
    }
  }
  return slots;
}

function locate(doc,{partId,measureIndex,eventIndex,verse,direction}){
  if(doc?.documentElement?.localName!=='score-partwise')fail('MusicXML partwise 악보만 편집할 수 있습니다.');
  if(typeof partId!=='string'||!partId||!valid(measureIndex,0,3000)||!valid(eventIndex,0,50000))
    fail('먼저 가사를 이동할 음표를 선택해 주세요.');
  if(!valid(Number(verse),1,12))fail('가사 절 번호는 1~12여야 합니다.');
  if(!['right','left'].includes(direction))fail('이동 방향이 올바르지 않습니다.');
  const part=many(doc.documentElement,'part').find(p=>p.getAttribute('id')===partId);
  const measure=many(part,'measure')[measureIndex];
  const selected=many(measure,'note')[eventIndex];
  if(!selected)fail('선택한 음표를 찾지 못했습니다.');
  const audit=inspectAdvancedMeasure(doc,partId,measureIndex);
  if(audit.reason)fail('선택한 마디는 보호된 기보입니다: '+audit.reason);
  const event=audit.events[eventIndex];
  if(!event||event.chord||event.rest||!pitched(selected)||tiedStop(selected))
    fail('가사가 있는 일반 선율 음표를 선택해 주세요.');
  return {voice:event.voice,staff:event.staff};
}

export function planPlacedLyricShift(doc,{partId,measureIndex,eventIndex,verse=1,direction='right'}={}){
  const {voice,staff}=locate(doc,{partId,measureIndex,eventIndex,verse,direction});
  const verseId=String(Number(verse));
  const slots=slotList(doc,partId,voice,staff);
  const selected=slots.findIndex(s=>s.measureIndex===measureIndex&&s.eventIndex===eventIndex);
  if(selected<0)fail('선택한 음표가 가사 이동 가능한 성부에 없습니다.');
  const lyrics=slots.map(s=>verseLyric(s.note,verseId));
  if(!lyrics[selected]||!one(lyrics[selected],'text'))
    fail('먼저 이동할 가사 음절이 있는 음표를 선택해 주세요.');
  const previous=lyrics[selected-1];
  if(previous&&['start','continue'].includes(one(previous,'extend')?.getAttribute('type')))
    fail('멜리스마 중간에서 가사를 이동할 수 없습니다. 연장 시작 음절을 선택해 주세요.');
  let from,to,affected;
  if(direction==='right'){
    let free=selected+1;
    while(free<slots.length&&lyrics[free])free++;
    if(free>=slots.length)fail('뒤에 빈 가사 위치가 없습니다. 악보에 음표를 추가하거나 마지막 음절을 정리해 주세요.');
    from=selected;to=free;affected=free-selected;
  }else{
    if(selected===0||lyrics[selected-1])fail('앞 음표에 빈 가사 위치가 없습니다.');
    let end=selected+1;
    while(end<slots.length&&lyrics[end])end++;
    from=selected-1;to=end-1;affected=end-selected;
  }
  return {partId,measureIndex,eventIndex,verse:Number(verse),direction,voice,staff,
    from,to,affected,positions:slots.slice(from,to+1).map(s=>({measureIndex:s.measureIndex,eventIndex:s.eventIndex}))};
}

function insertLyric(note,lyric,verse){
  const next=many(note,'lyric').find(l=>Number(l.getAttribute('number')||'1')>Number(verse))||
    one(note,'play')||one(note,'listen');
  note.insertBefore(lyric,next||null);
}

export function shiftPlacedLyrics(source,options){
  const plan=planPlacedLyricShift(source,options);
  const cloned=source.cloneNode(true);
  const part=many(cloned.documentElement,'part').find(p=>p.getAttribute('id')===plan.partId);
  const measures=many(part,'measure');
  const notes=plan.positions.map(({measureIndex,eventIndex})=>many(measures[measureIndex],'note')[eventIndex]);
  const verse=String(plan.verse);
  const originals=notes.map(note=>verseLyric(note,verse));
  for(let i=0;i<notes.length;i++)if(originals[i])notes[i].removeChild(originals[i]);
  for(let i=0;i<notes.length;i++){
    const from=plan.direction==='right'?i-1:i+1;
    if(from>=0&&from<notes.length&&originals[from])insertLyric(notes[i],originals[from],verse);
  }
  return {doc:cloned,change:{action:'shift-placed-lyrics',direction:plan.direction,
    partId:plan.partId,verse:plan.verse,count:plan.affected}};
}
