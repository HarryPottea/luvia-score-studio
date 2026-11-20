// Add a new, empty, clock-correct instrument part to an existing score.
// Existing part XML trees are never mutated. The new part receives the same
// meter/key/divisions timeline as the source score, with optional piano staves.
const all=(node,tag)=>node?[...node.children].filter(c=>c.localName===tag):[];
const first=(node,tag)=>all(node,tag)[0]||null;
const text=(node,tag)=>first(node,tag)?.textContent?.trim()||'';
const valid=(n,lo,hi)=>Number.isSafeInteger(n)&&n>=lo&&n<=hi;
const fail=x=>{throw new Error(x);};
function make(parent,tag,value){
  const d=parent.ownerDocument;
  const node=d.createElementNS?d.createElementNS(parent.namespaceURI??null,tag):d.createElement(tag);
  if(value!==undefined)node.textContent=String(value);
  return node;
}
const durationTypes=[
  ['whole',4,0],['half',3,1],['half',2,0],
  ['quarter',1.5,1],['quarter',1,0],['eighth',.75,1],
  ['eighth',.5,0],['16th',.375,1],['16th',.25,0],
  ['32nd',.125,0]
];
function restLengths(ticks,divisions){
  let remaining=ticks;
  const out=[];
  for(const [type,beats,dots] of durationTypes){
    const length=divisions*beats;
    if(!valid(length,1,1000000))continue;
    while(remaining>=length){
      out.push({type,length,dots});remaining-=length;
      if(out.length>32)fail('새 파트의 쉼표 수가 너무 많습니다.');
    }
  }
  if(remaining!==0)fail('이 박자는 지원하는 쉼표로 정확하게 표현할 수 없습니다.');
  return out;
}
function scanMeterAndKey(parts,length){
  const reference=all(parts[0],'measure');
  let clock={divisions:null,beats:null,beatType:null,key:null};
  const states=[];
  for(let i=0;i<length;i++){
    const measure=reference[i],children=[...measure.children];
    if(measure.getAttribute('implicit')==='yes'||measure.getAttribute('non-controlling')==='yes')
      fail('못갖춘마디 또는 비표준 마디에는 파트를 자동 추가하지 않습니다.');
    const attrs=all(measure,'attributes');
    if(attrs.some(a=>children.indexOf(a)>children.findIndex(n=>n.localName==='note')&&
      children.some(n=>n.localName==='note')))
      fail('마디 중간 박자 변경이 있어 악기 추가를 보호합니다.');
    for(const a of attrs){
      if(first(a,'divisions')){
        const d=Number(text(a,'divisions'));
        if(!valid(d,1,65536))fail('MusicXML divisions 값이 올바르지 않습니다.');
        clock.divisions=d;
      }
      if(first(a,'time')){
        const t=first(a,'time'),beats=Number(text(t,'beats')),type=Number(text(t,'beat-type'));
        if(all(t,'beats').length!==1||all(t,'beat-type').length!==1||
           !valid(beats,1,32)||![2,4,8,16].includes(type))
          fail('복합 박자표는 빈 악기 추가를 지원하지 않습니다.');
        clock.beats=beats;clock.beatType=type;
      }
      if(first(a,'key'))clock.key=first(a,'key');
    }
    const {divisions,beats,beatType}=clock;
    const ticks=divisions*beats*4/beatType;
    if(!valid(ticks,1,262144))fail('기보용 마디 길이를 정확하게 계산할 수 없습니다.');
    states.push({...clock,ticks,number:measure.getAttribute('number')||String(i+1)});
  }
  // Polymeter or inconsistent divisions across original parts could make a
  // new independent part disagree with the score's timeline.
  for(const p of parts.slice(1)){
    const bars=all(p,'measure');
    for(let i=0;i<length;i++){
      for(const a of all(bars[i],'attributes')){
        const d=first(a,'divisions'),t=first(a,'time'),k=first(a,'key');
        if(d&&Number(d.textContent)!==states[i].divisions)
          fail('기존 파트들의 divisions가 달라 안전한 파트 추가가 불가능합니다.');
        if(t&&(Number(text(t,'beats'))!==states[i].beats||
          Number(text(t,'beat-type'))!==states[i].beatType))
          fail('파트마다 서로 다른 박자표가 있어 자동 파트 추가를 보호합니다.');
        if(k&&states[i].key&&text(k,'fifths')!==text(states[i].key,'fifths'))
          fail('기존 파트의 조표가 서로 달라 새 악기의 조표를 결정할 수 없습니다.');
      }
    }
  }
  return states;
}
function rest(measure,{type,length,dots},voice,staff){
  const note=make(measure,'note');
  note.appendChild(make(note,'rest'));
  note.appendChild(make(note,'duration',length));
  note.appendChild(make(note,'voice',voice));
  note.appendChild(make(note,'type',type));
  if(dots)note.appendChild(make(note,'dot'));
  note.appendChild(make(note,'staff',staff));
  return note;
}
const CLEFS=Object.freeze({
  melody:[['G',2]],vocal:[['G',2]],bass:[['F',4]],piano:[['G',2],['F',4]]
});
export function addEmptyInstrumentPart(source,{name='New part',instrument='melody'}={}){
  if(source?.documentElement?.localName!=='score-partwise'||
     typeof name!=='string'||!name.trim()||[...name].length>80||
     !Object.hasOwn(CLEFS,instrument))
    fail('악기 이름 또는 추가할 악기 종류가 올바르지 않습니다.');
  const parts=all(source.documentElement,'part'),partList=first(source.documentElement,'part-list');
  if(!partList||!parts.length||parts.length>=12)
    fail('악기 목록이 없거나 허용된 12파트를 초과합니다.');
  const length=all(parts[0],'measure').length;
  if(!valid(length,1,128)||parts.some(p=>all(p,'measure').length!==length))
    fail('기존 파트들의 마디 수가 서로 달라 새 악기를 추가하지 않습니다.');
  const ids=new Set(parts.map(p=>p.getAttribute('id')));
  for(const entry of all(partList,'score-part')){
    const id=entry.getAttribute('id');
    if(!id||ids.has(id)===false)fail('악기 목록과 MusicXML 파트 ID가 일치하지 않습니다.');
  }
  if(ids.has(null)||ids.size!==parts.length||all(partList,'score-part').length!==parts.length)
    fail('기존 악기 파트 ID가 중복되거나 누락됐습니다.');
  const states=scanMeterAndKey(parts,length);
  let next=1;
  while(ids.has('P'+next))next++;
  const id='P'+next,doc=source.cloneNode(true),root=doc.documentElement,
    list=first(root,'part-list'),newPart=make(root,'part');
  newPart.setAttribute('id',id);
  const definition=make(list,'score-part');
  definition.setAttribute('id',id);
  definition.appendChild(make(definition,'part-name',name.trim()));
  list.appendChild(definition);
  const piano=instrument==='piano',clefs=CLEFS[instrument];
  let prior=null;
  for(const state of states){
    const bar=make(newPart,'measure');bar.setAttribute('number',state.number);
    const attrs=make(bar,'attributes'),firstBar=prior===null;
    if(firstBar||state.divisions!==prior.divisions)
      attrs.appendChild(make(attrs,'divisions',state.divisions));
    if(firstBar||state.key!==prior.key){
      if(state.key)attrs.appendChild(state.key.cloneNode(true));
    }
    if(firstBar||state.beats!==prior.beats||state.beatType!==prior.beatType){
      const time=make(attrs,'time');
      time.appendChild(make(time,'beats',state.beats));
      time.appendChild(make(time,'beat-type',state.beatType));
      attrs.appendChild(time);
    }
    if(firstBar){
      if(piano)attrs.appendChild(make(attrs,'staves',2));
      for(const [i,[sign,line]] of clefs.entries()){
        const clef=make(attrs,'clef');
        if(piano)clef.setAttribute('number',String(i+1));
        clef.appendChild(make(clef,'sign',sign));
        clef.appendChild(make(clef,'line',line));
        attrs.appendChild(clef);
      }
    }
    if(attrs.children.length)bar.appendChild(attrs);
    const durations=restLengths(state.ticks,state.divisions);
    for(const p of durations)bar.appendChild(rest(bar,p,'1',1));
    if(piano){
      const backup=make(bar,'backup');
      backup.appendChild(make(backup,'duration',state.ticks));
      bar.appendChild(backup);
      for(const p of durations)bar.appendChild(rest(bar,p,'2',2));
    }
    newPart.appendChild(bar);
    prior=state;
  }
  root.appendChild(newPart);
  return {doc,change:{action:'add-instrument-part',partId:id,instrument,
    measures:length,staves:clefs.length,name:name.trim()}};
}
