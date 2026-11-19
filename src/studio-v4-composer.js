// J-WOO 4.0 Composer notation actions.
// Pure immutable MusicXML edit operations. No external I/O.
const kids=(n,t)=>n?[...n.children].filter(x=>x.localName===t):[];
const child=(n,t)=>kids(n,t)[0]||null;
const txt=(n,t)=>child(n,t)?.textContent?.trim()||'';
const fail=s=>{throw new Error(s);};
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
function el(parent,tag,value){
  const d=parent.ownerDocument;
  const result=d.createElementNS?d.createElementNS(parent.namespaceURI||null,tag):d.createElement(tag);
  if(value!==undefined)result.textContent=String(value);
  return result;
}
function locate(doc,{partId,measureIndex,eventIndex}){
  if(doc?.documentElement?.localName!=='score-partwise')fail('MusicXML partwise 악보만 편집합니다.');
  if(typeof partId!=='string'||!partId||!integer(measureIndex,0,3000)||!integer(eventIndex,0,50000))
    fail('악기·마디·음표 선택 위치가 올바르지 않습니다.');
  const part=kids(doc.documentElement,'part').find(x=>x.getAttribute('id')===partId);
  const measure=kids(part,'measure')[measureIndex];
  const note=kids(measure,'note')[eventIndex];
  if(!part||!measure||!note)fail('선택한 음표를 찾지 못했습니다.');
  return {part,measure,note};
}
function pitched(n){
  const p=child(n,'pitch');
  if(!p||child(n,'rest')||child(n,'grace')||child(n,'unpitched'))return false;
  return ['C','D','E','F','G','A','B'].includes(txt(p,'step'))&&
    integer(Number(txt(p,'octave')),0,9);
}
function identity(n){
  const p=child(n,'pitch');
  return [txt(p,'step'),txt(p,'alter')||'0',txt(p,'octave')].join(':');
}
function lane(n){return (txt(n,'voice')||'1')+'@'+(txt(n,'staff')||'1');}
function checkBeforeAfter(original,candidate){
  // Editing lyrics/ties must never alter structural timing controls or pitches.
  const signature=n=>{
    const parts=kids(n.documentElement,'part');
    return JSON.stringify(parts.map(p=>kids(p,'measure').map(m=>[...m.children]
      .filter(x=>['note','backup','forward'].includes(x.localName))
      .map(x=>x.localName==='note'
        ?[x.localName,identity(x),txt(x,'duration'),txt(x,'voice'),txt(x,'staff'),!!child(x,'chord'),!!child(x,'rest')]
        :[x.localName,txt(x,'duration')])));
  };
  if(signature(original)!==signature(candidate))fail('기보만 변경해야 하는 작업에서 음정·박자·성부가 달라졌습니다.');
}
export function setNoteVerse(source,{partId,measureIndex,eventIndex,verse=1,
  text='',syllabic='single',extend='none',mode='set'}={}){
  if(!integer(Number(verse),1,12))fail('가사 절 번호는 1~12 사이여야 합니다.');
  const number=String(Number(verse));
  if(!['set','remove'].includes(mode)||!['single','begin','middle','end'].includes(syllabic)||
      !['none','start','continue','stop'].includes(extend))fail('가사 표기 옵션이 올바르지 않습니다.');
  if(typeof text!=='string'||[...text].length>100||/[\x00-\x08\x0b-\x1f\x7f]/.test(text))
    fail('가사는 100자 이내의 일반 텍스트여야 합니다.');
  if(mode==='set'&&(!text.trim()&&extend==='none'))fail('가사 또는 멜리스마 연장 기호를 입력해 주세요.');
  const cloned=source.cloneNode(true);
  const {note}=locate(cloned,{partId,measureIndex,eventIndex});
  if(!pitched(note)||child(note,'chord'))fail('가사는 일반 선율 음표에만 입력할 수 있습니다.');
  const existing=kids(note,'lyric').filter(x=>(x.getAttribute('number')||'1')===number);
  if(existing.length>1)fail('같은 절의 가사가 중복되어 있어 보수적으로 변경을 차단합니다.');
  if(existing.length&&[...existing[0].children].some(x=>!['syllabic','text','extend'].includes(x.localName)))
    fail('기존 복잡한 가사 표기는 자동으로 덮어쓰지 않습니다.');
  for(const old of existing)note.removeChild(old);
  if(mode==='set'){
    const lyric=el(note,'lyric');
    lyric.setAttribute('number',number);
    if(text.trim()){
      lyric.appendChild(el(lyric,'syllabic',syllabic));
      lyric.appendChild(el(lyric,'text',text));
    }
    if(extend!=='none'){
      const extension=el(lyric,'extend');
      extension.setAttribute('type',extend);
      lyric.appendChild(extension);
    }
    // The MusicXML note schema orders lyrics after notations and before play/listen.
    const next=kids(note,'lyric').find(x=>{
      const n=Number(x.getAttribute('number')||'1');return Number.isFinite(n)&&n>Number(number);
    })||child(note,'play')||child(note,'listen');
    note.insertBefore(lyric,next||null);
  }
  checkBeforeAfter(source,cloned);
  return {doc:cloned,change:{action:'verse-lyric',partId,measureIndex,eventIndex,verse:Number(number),mode}};
}
function ordinalCandidates(part,measureIndex,from,to){
  const rows=[];
  for(let m=from;m<=to;m++){
    const notes=kids(kids(part,'measure')[m],'note');
    for(let i=0;i<notes.length;i++)rows.push({measureIndex:m,eventIndex:i,node:notes[i]});
  }
  return rows;
}
function ensureAdjacentSameLane(part,start,end){
  const rows=ordinalCandidates(part,start.measureIndex,start.eventIndex<=end.eventIndex?end.measureIndex:start.measureIndex,end.measureIndex);
  const laneName=lane(start.note);
  const joined=rows.filter(x=>lane(x.node)===laneName&&!child(x.node,'chord')&&!child(x.node,'grace'));
  const from=joined.findIndex(x=>x.measureIndex===start.measureIndex&&x.eventIndex===start.eventIndex);
  const to=joined.findIndex(x=>x.measureIndex===end.measureIndex&&x.eventIndex===end.eventIndex);
  if(from<0||to<0||to!==from+1)fail('붙임줄은 같은 성부의 연속된 두 음표 사이에서만 연결할 수 있습니다.');
}
function insertTie(note,kind){
  const tie=el(note,'tie');
  tie.setAttribute('type',kind);
  // Tie is after duration and before voice/type according to MusicXML.
  const next=child(note,'instrument')||child(note,'footnote')||child(note,'level')||
    child(note,'voice')||child(note,'type');
  note.insertBefore(tie,next||null);
  let notations=child(note,'notations');
  if(!notations){
    notations=el(note,'notations');
    note.insertBefore(notations,child(note,'lyric')||child(note,'play')||child(note,'listen')||null);
  }
  const tied=el(notations,'tied');
  tied.setAttribute('type',kind);
  notations.appendChild(tied);
}
export function toggleSoundingTie(source,{partId,measureIndex,eventIndex,
  endMeasureIndex=measureIndex,endEventIndex}={}){
  if(!integer(endMeasureIndex,0,3000)||!integer(endEventIndex,0,50000)||
    endMeasureIndex<measureIndex||endMeasureIndex>measureIndex+1||
    (endMeasureIndex===measureIndex&&endEventIndex<=eventIndex))
    fail('연속된 마디의 뒤쪽 음표를 선택해 주세요.');
  const cloned=source.cloneNode(true);
  const start={...locate(cloned,{partId,measureIndex,eventIndex}),measureIndex,eventIndex};
  const end={...locate(cloned,{partId,measureIndex:endMeasureIndex,eventIndex:endEventIndex}),
    measureIndex:endMeasureIndex,eventIndex:endEventIndex};
  if(!pitched(start.note)||!pitched(end.note)||child(start.note,'chord')||child(end.note,'chord')||
     identity(start.note)!==identity(end.note)||lane(start.note)!==lane(end.note))
    fail('붙임줄은 같은 음정·같은 성부·같은 보표의 음표를 연결합니다.');
  ensureAdjacentSameLane(start.part,start,end);
  const nodes=[[start.note,'start'],[end.note,'stop']];
  const has=nodes.map(([n,type])=>{
    const sound=kids(n,'tie').filter(t=>t.getAttribute('type')===type);
    const notation=kids(child(n,'notations'),'tied').filter(t=>t.getAttribute('type')===type);
    if(sound.length>1||notation.length>1||sound.length!==notation.length)
      fail('기존 붙임줄의 재생·시각 기호가 일치하지 않아 편집하지 않습니다.');
    return sound.length===1&&notation.length===1;
  });
  if(has[0]!==has[1])fail('붙임줄 시작·끝이 일치하지 않아 자동으로 변경할 수 없습니다.');
  if(has[0]){
    for(const [n,type] of nodes){
      for(const tie of kids(n,'tie').filter(t=>t.getAttribute('type')===type))n.removeChild(tie);
      const notations=child(n,'notations');
      for(const tied of kids(notations,'tied').filter(t=>t.getAttribute('type')===type))notations.removeChild(tied);
      if(!notations.children.length)n.removeChild(notations);
    }
  }else{
    for(const [n,type] of nodes)insertTie(n,type);
  }
  checkBeforeAfter(source,cloned);
  return {doc:cloned,change:{action:has[0]?'tie-remove':'tie-add',partId,measureIndex,eventIndex,
    endMeasureIndex,endEventIndex}};
}
