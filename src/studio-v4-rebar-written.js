// Rebar written *single-voice* MusicXML scores without losing note onsets.
//
// Scope intentionally explicit: whole score, simultaneous independent
// monophonic instrument parts, normal/dotted durations, no tuplets, chords,
// independent voices or mid-score directions/key changes. Unsafe scores remain
// untouched and receive a precise refusal instead of destructive rewriting.
const kid=(n,t)=>n?[...n.children].filter(c=>c.localName===t):[];
const first=(n,t)=>kid(n,t)[0]||null;
const val=(n,t)=>first(n,t)?.textContent?.trim()||'';
const isInt=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const reject=text=>{throw new Error(text);};
const METERS=Object.freeze({'2/4':[2,4],'3/4':[3,4],'4/4':[4,4],'3/8':[3,8],'6/8':[6,8]});
const RATIOS=[['whole',4,false],['half',3,true],['half',2,false],
  ['quarter',1.5,true],['quarter',1,false],['eighth',.75,true],
  ['eighth',.5,false],['16th',.375,true],['16th',.25,false],['32nd',.125,false]];
const allowedNote=new Set(['pitch','rest','duration','voice','type','dot','staff','stem','accidental','lyric']);
function make(parent,name,value){
  const d=parent.ownerDocument;
  const n=d.createElementNS?d.createElementNS(parent.namespaceURI??null,name):d.createElement(name);
  if(value!==undefined)n.textContent=String(value);
  return n;
}
function meterOf(part){
  const attrs=first(kid(part,'measure')[0],'attributes');
  const divisions=Number(val(attrs,'divisions')),time=first(attrs,'time');
  const beats=Number(val(time,'beats')),beatType=Number(val(time,'beat-type'));
  if(!isInt(divisions,1,65536)||!METERS[beats+'/'+beatType])
    reject('기존 박자표나 divisions가 지원 범위 밖입니다.');
  const currentTicks=beats*divisions*4/beatType;
  if(!isInt(currentTicks,1,262144))reject('기존 박자의 전체 길이를 표현할 수 없습니다.');
  return {attrs,divisions,beats,beatType,currentTicks};
}
function pieces(ticks,div){
  if(!isInt(ticks,1,262144))reject('음표·쉼표의 박자 길이가 올바르지 않습니다.');
  const values=RATIOS.map(([type,ratio,dotted])=>({type,dotted,duration:ratio*div}))
    .filter(x=>isInt(x.duration,1,262144));
  const list=[];let remaining=ticks;
  for(const item of values){
    while(remaining>=item.duration){
      list.push(item);remaining-=item.duration;
      if(list.length>32)reject('하나의 음표가 너무 많이 분리됩니다.');
    }
  }
  if(remaining)reject('32분음표 단위로 정확히 분할할 수 없는 리듬입니다.');
  return list;
}
function validatePart(part,partId,totalMeasures){
  const measures=kid(part,'measure');
  if(measures.length!==totalMeasures)reject('파트별 마디 수가 다릅니다.');
  const metadata=meterOf(part),laneNames=new Set(),original=[];
  let totalTicks=0;
  for(const [index,m] of measures.entries()){
    const allowed=index===0?new Set(['attributes','note']):new Set(['note']);
    if(m.getAttribute('implicit')==='yes'||[...m.children].some(x=>!allowed.has(x.localName))||
      index===0&&kid(m,'attributes').length!==1)
      reject('못갖춘마디·중간 조표·악상·다성부 등의 복합 마디는 보호합니다.');
    let bar=0;
    for(const note of kid(m,'note')){
      if(note.attributes?.length||[...note.children].some(x=>!allowedNote.has(x.localName))||
        !!first(note,'chord')||!first(note,'type')||!first(note,'duration')||
        !!first(note,'notations')||!first(note,'pitch')&&!first(note,'rest')||
        kid(note,'dot').length>1)
        reject('기존 화음·잇단음·붙임줄·장식 등은 보수적으로 보호합니다.');
      const duration=Number(val(note,'duration')),type=val(note,'type');
      const dotted=kid(note,'dot').length===1;
      const expected=RATIOS.find(x=>x[0]===type&&x[2]===dotted);
      if(!expected||!isInt(duration,1,262144)||duration!==expected[1]*metadata.divisions)
        reject('일반 음표·쉼표의 type/duration이 일치하지 않습니다.');
      const pitch=first(note,'pitch');
      if(pitch){
        if(!'CDEFGAB'.includes(val(pitch,'step'))||!isInt(Number(val(pitch,'octave')),1,8)||
          kid(note,'accidental').length||val(pitch,'alter')&&val(pitch,'alter')!=='0')
          reject('화성·변화표의 기보 의미가 달라질 수 있어 단순 리바링을 중단합니다.');
      }
      const voice=val(note,'voice')||'1',staff=val(note,'staff')||'1';
      laneNames.add(voice+'@'+staff);
      original.push({node:note,duration,absoluteStart:totalTicks+bar,rest:!!first(note,'rest')});
      bar+=duration;
    }
    if(bar!==metadata.currentTicks)reject('모든 기존 마디가 완전한 박자로 채워져 있어야 합니다.');
    totalTicks+=bar;
  }
  if(laneNames.size!==1||original.length>5000)reject('한 파트에 하나의 성부·보표만 지원합니다.');
  return {...metadata,original,totalTicks,partId};
}
function setClock(note,chunk){
  first(note,'duration').textContent=String(chunk.duration);
  first(note,'type').textContent=chunk.type;
  for(const dot of kid(note,'dot'))note.removeChild(dot);
  if(chunk.dotted)note.insertBefore(make(note,'dot'),first(note,'type').nextSibling);
  const stem=first(note,'stem');if(stem)note.removeChild(stem);
}
function appendTie(note,kind){
  const sound=make(note,'tie');sound.setAttribute('type',kind);
  note.insertBefore(sound,first(note,'voice')||first(note,'type'));
  const notation=make(note,'notations'),tied=make(notation,'tied');
  tied.setAttribute('type',kind);notation.appendChild(tied);
  note.insertBefore(notation,first(note,'lyric')||null);
}
function makeContinuation(original,piece,isFirst){
  const note=original.cloneNode(true);
  setClock(note,piece);
  if(!isFirst)for(const tag of ['lyric','accidental'])
    for(const child of kid(note,tag))note.removeChild(child);
  return note;
}
function newMeasure(part,index,sourceFirstAttrs,beats,beatType){
  const m=make(part,'measure');m.setAttribute('number',String(index+1));
  if(index===0){
    const attrs=sourceFirstAttrs.cloneNode(true);
    const time=first(attrs,'time');
    first(time,'beats').textContent=String(beats);
    first(time,'beat-type').textContent=String(beatType);
    m.appendChild(attrs);
  }
  return m;
}
function generatePart(part,sourceReport,targetTicks,beats,beatType){
  const old=sourceReport.original;
  const count=Math.ceil(sourceReport.totalTicks/targetTicks);
  if(count>3000)reject('재구성되는 악보가 3000마디를 초과합니다.');
  const measures=Array.from({length:count},(_,i)=>newMeasure(part,i,sourceReport.attrs,beats,beatType));
  let cursor=0,produced=0;
  for(const event of old){
    const span=[],onset=cursor;let remaining=event.duration;
    while(remaining){
      const room=targetTicks-(cursor%targetTicks);
      const take=Math.min(room,remaining);
      for(const unit of pieces(take,sourceReport.divisions)){
        span.push({...unit,at:cursor});cursor+=unit.duration;remaining-=unit.duration;
      }
    }
    if(cursor-onset!==event.duration)reject('원래 음표의 박자 길이를 보존하지 못했습니다.');
    for(let i=0;i<span.length;i++){
      const item=span[i],note=makeContinuation(event.node,item,i===0);
      if(!event.rest&&span.length>1){
        if(i>0)appendTie(note,'stop');
        if(i<span.length-1)appendTie(note,'start');
      }
      const slot=Math.floor(item.at/targetTicks);
      measures[slot].appendChild(note);produced++;
    }
  }
  // The final bar is padded with explicit rests, never by extending a pitch.
  let remaining=measures.length*targetTicks-cursor;
  for(const p of pieces(remaining||sourceReport.divisions/8,sourceReport.divisions)){
    if(!remaining)break;
    if(p.duration>remaining)reject('마지막 마디의 쉼표를 표현할 수 없습니다.');
    const n=make(part,'note');
    n.appendChild(make(n,'rest'));n.appendChild(make(n,'duration',p.duration));
    n.appendChild(make(n,'type',p.type));
    if(p.dotted)n.appendChild(make(n,'dot'));
    const like=old[0]?.node;
    if(first(like,'voice'))n.insertBefore(make(n,'voice',val(like,'voice')),first(n,'type'));
    if(first(like,'staff'))n.appendChild(make(n,'staff',val(like,'staff')));
    measures.at(-1).appendChild(n);remaining-=p.duration;
  }
  if(remaining)reject('새 악보의 마지막 마디를 정확히 채울 수 없습니다.');
  for(const m of kid(part,'measure'))part.removeChild(m);
  for(const m of measures)part.appendChild(m);
  return {measures:measures.length,originalNotes:old.length,renderedNotes:produced};
}
/**
 * Rebar all written notes in simple one-voice-per-part scores.
 * The transaction is immutable; changes to compound structures fail closed.
 */
export function rebarWrittenScore(source,{meter='3/4'}={}){
  const selected=METERS[meter];if(!selected)
    reject('리바링은 2/4, 3/4, 4/4, 3/8, 6/8 박자를 지원합니다.');
  if(source?.documentElement?.localName!=='score-partwise')
    reject('MusicXML partwise 악보가 필요합니다.');
  const parts=kid(source.documentElement,'part');
  if(!parts.length||parts.length>12)reject('재구성은 1~12개 악기 파트를 지원합니다.');
  const totalMeasures=kid(parts[0],'measure').length;
  if(!totalMeasures)reject('악보에 작성된 마디가 없습니다.');
  const reports=parts.map(p=>validatePart(p,p.getAttribute('id'),totalMeasures));
  const firstReport=reports[0];
  if(reports.some(r=>r.divisions!==firstReport.divisions||
    r.beats!==firstReport.beats||r.beatType!==firstReport.beatType||
    r.totalTicks!==firstReport.totalTicks))
    reject('악기 파트마다 원래 박자 또는 divisions가 달라 리바링하지 않습니다.');
  const targetTicks=firstReport.divisions*selected[0]*4/selected[1];
  if(!isInt(targetTicks,1,262144))reject('새 박자의 마디 길이를 정확히 만들 수 없습니다.');
  if(meter===firstReport.beats+'/'+firstReport.beatType)
    reject('현재 박자와 같은 박자입니다.');
  const candidate=source.cloneNode(true);
  const newParts=kid(candidate.documentElement,'part');
  const changes=newParts.map((p,i)=>generatePart(p,reports[i],targetTicks,...selected));
  return {doc:candidate,change:{action:'written-score-rebar',meter,
    originalMeasures:totalMeasures,newMeasures:changes[0].measures,parts:changes.length,
    paddedTicks:changes[0].measures*targetTicks-firstReport.totalTicks,
    affectedNotes:changes.reduce((n,x)=>n+x.originalNotes,0)}};
}
