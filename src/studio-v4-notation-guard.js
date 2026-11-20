// Stage 3: isolate each MusicXML expression edit to its named markup.
// A caller may toggle a slur, sounding tie, articulation, ornament or one
// lyric verse, but must not rewrite any other musical content or decoration.
const children=(n,t)=>n?[...n.children].filter(x=>x.localName===t):[];
const first=(n,t)=>children(n,t)[0]||null;
const fail=m=>{throw new Error(m);};
const ORDER=['tied','slur','tuplet','glissando','slide','ornaments',
  'technical','articulations','dynamics','fermata','arpeggiate',
  'non-arpeggiate','accidental-mark','other-notation'];
const RANK=new Map(ORDER.map((x,i)=>[x,i]));
const attrib=(el,key)=>el?.getAttribute(key)??null;
const noteOf=(doc,partId,measureIndex,eventIndex)=>{
  const matches=children(doc?.documentElement,'part')
    .filter(x=>x.getAttribute('id')===partId);
  if(matches.length!==1)fail('변경 대상 악기 식별이 불확실합니다.');
  const note=children(children(matches[0],'measure')[measureIndex],'note')[eventIndex];
  if(!note)fail('변경 대상 음표가 없습니다.');
  return note;
};
const attrs=node=>[...(node?.attributes||[])].map(a=>[a.name,String(a.value)])
  .sort((a,b)=>a[0].localeCompare(b[0]));
const shape=node=>[node.localName,attrs(node),[...(node.children||[])].map(shape),
  node.children?.length?'':String(node.textContent??'')];
const remove=(parent,node)=>{if(node)parent.removeChild(node);};
function stripMarkup(note,allowed){
  const notations=first(note,'notations');
  for(const rule of allowed){
    if(rule.name==='lyric'){
      for(const lyric of children(note,'lyric'))
        if((attrib(lyric,'number')||'1')===String(rule.number))remove(note,lyric);
      continue;
    }
    if(rule.name==='tie'){
      for(const tie of children(note,'tie'))
        if(attrib(tie,'type')===rule.type)remove(note,tie);
      continue;
    }
    if(!notations)continue;
    if(rule.name==='tied'||rule.name==='slur'){
      for(const item of children(notations,rule.name))
        if(attrib(item,'type')===rule.type&&
          (rule.number===undefined||(attrib(item,'number')||'1')===String(rule.number)))
          remove(notations,item);
    }
    if(rule.name==='articulations'||rule.name==='ornaments'){
      for(const group of children(notations,rule.name)){
        for(const child of children(group,rule.kind))remove(group,child);
        if(!group.children.length)remove(notations,group);
      }
    }
  }
  if(notations&&!notations.children.length)remove(note,notations);
}
function checkOrder(note){
  if(children(note,'notations').length>1)fail('기보 표기가 여러 그룹으로 중복되어 있습니다.');
  const notation=first(note,'notations');
  if(notation){
    let previous=-1;
    for(const n of [...notation.children]){
      const rank=RANK.get(n.localName);
      if(rank===undefined||rank<previous)
        fail('MusicXML 기보 요소의 순서가 올바르지 않습니다.');
      previous=rank;
    }
  }
  const direct=[...note.children].map(n=>n.localName);
  const notationIndex=direct.indexOf('notations');
  if(notationIndex>=0&&direct.some((name,i)=>name==='lyric'&&i<notationIndex))
    fail('가사보다 뒤에 기보 표기가 있어 MusicXML 순서가 잘못됐습니다.');
  const typeIndex=direct.indexOf('type');
  if(typeIndex>=0&&direct.some((name,i)=>name==='tie'&&i>typeIndex))
    fail('재생용 붙임줄이 음표 종류 뒤에 있어 MusicXML 순서가 잘못됐습니다.');
}
// Keep the MusicXML <notations> sequence canonical when an existing note
// already carries ties, ornament, articulation, tuplet or a lyric.
export function insertOrderedNotation(notations,item){
  const rank=RANK.get(item?.localName);
  if(notations?.localName!=='notations'||rank===undefined)
    fail('정렬할 수 없는 MusicXML 표현 기호입니다.');
  const later=[...notations.children].find(x=>{
    const at=RANK.get(x.localName);
    return at===undefined||at>rank;
  })||null;
  notations.insertBefore(item,later);
}
export function assertNotationMutation(source,candidate,{partId,targets}={}){
  if(source?.documentElement?.localName!=='score-partwise'||
     candidate?.documentElement?.localName!=='score-partwise'||
     !partId||!Array.isArray(targets)||targets.length<1||targets.length>16)
    fail('기보 편집의 변경 범위가 유효하지 않습니다.');
  const original=source.cloneNode(true),modified=candidate.cloneNode(true);
  for(const target of targets){
    if(!Number.isSafeInteger(target.measureIndex)||target.measureIndex<0||
       !Number.isSafeInteger(target.eventIndex)||target.eventIndex<0||
       !Array.isArray(target.allowed)||!target.allowed.length)
      fail('기보 변경이 허용된 음표 위치가 올바르지 않습니다.');
    const before=noteOf(original,partId,target.measureIndex,target.eventIndex);
    const after=noteOf(modified,partId,target.measureIndex,target.eventIndex);
    const actual=noteOf(candidate,partId,target.measureIndex,target.eventIndex);
    checkOrder(actual);
    stripMarkup(before,target.allowed);
    stripMarkup(after,target.allowed);
  }
  if(JSON.stringify(shape(original.documentElement))!==
     JSON.stringify(shape(modified.documentElement)))
    fail('허용한 표현 기호 외의 음표·가사·성부·다른 파트가 변경되었습니다.');
  if(JSON.stringify(shape(source.documentElement))===
     JSON.stringify(shape(candidate.documentElement)))
    fail('표현 기호의 변경 내용이 없습니다.');
  return true;
}
