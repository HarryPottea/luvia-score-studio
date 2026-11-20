// Rebar conservative written MusicXML scores, including independent voices and simple chords.
//
// Scope intentionally explicit: whole score, simultaneous independent
// instrument parts, normal/dotted durations and basic simultaneous chord tones.
// Existing tuplets, ties, ornaments and mid-score directions/key changes are blocked. Unsafe scores remain
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
const allowedNote=new Set(['chord','pitch','rest','duration','voice','type','dot','staff','stem','accidental','lyric']);
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
  const metadata=meterOf(part),lanes=[],laneKeys=[];
  const expectedBar=metadata.currentTicks;
  let totalNotes=0;
  for(const [index,m] of measures.entries()){
    const permitted=index===0?new Set(['attributes','note','backup']):
      new Set(['note','backup']);
    if(m.getAttribute('implicit')==='yes'||
      [...m.children].some(x=>!permitted.has(x.localName))||
      index===0&&kid(m,'attributes').length!==1)
      reject('못갖춘마디·중간 조표·악상 등 복합 마디는 리바링에서 보호합니다.');
    const groups=[[]],newNotes=[];
    for(const element of m.children){
      if(element.localName==='note'){
        newNotes.push(element);groups.at(-1).push(element);
      }else if(element.localName==='backup'){
        const duration=Number(val(element,'duration'));
        if(!isInt(duration,1,262144)||duration!==expectedBar||
          !groups.at(-1).length||groups.length>=4||
          [...element.children].some(n=>n.localName!=='duration'))
          reject('성부 시간 이동은 마디 전체 길이의 backup만 허용합니다.');
        groups.push([]);
      }
    }
    if(groups.some(g=>!g.length))reject('비어 있는 성부가 있어 마디를 나눌 수 없습니다.');
    const keys=[];
    for(const [groupIndex,notes] of groups.entries()){
      let offset=0,groupKey='';
      for(const note of notes){
        totalNotes++;
        if(totalNotes>5000)reject('리바링 가능한 전체 음표 수를 초과합니다.');
        if(note.attributes?.length||
          [...note.children].some(x=>!allowedNote.has(x.localName))||
          !first(note,'type')||!first(note,'duration')||
          !!first(note,'notations')||!first(note,'pitch')&&!first(note,'rest')||
          ['chord','pitch','rest','duration','voice','type','staff','stem','accidental']
            .some(tag=>kid(note,tag).length>1)||
          kid(note,'dot').length>1||!!first(note,'pitch')&&!!first(note,'rest'))
          reject('중복된 성부·보표나 기존 화음·잇단음·붙임줄·장식은 리바링에서 보호합니다.');
        const duration=Number(val(note,'duration')),type=val(note,'type');
        const dotted=kid(note,'dot').length===1;
        const expected=RATIOS.find(x=>x[0]===type&&x[2]===dotted);
        if(!expected||!isInt(duration,1,262144)||
          duration!==expected[1]*metadata.divisions)
          reject('음표·쉼표의 type/duration이 일치하지 않습니다.');
        const pitch=first(note,'pitch');
        if(pitch){
          const alterRaw=val(pitch,'alter'),alter=alterRaw===''?0:Number(alterRaw);
          const acc=kid(note,'accidental');
          const spellings=new Map([[-2,'flat-flat'],[-1,'flat'],[0,'natural'],
            [1,'sharp'],[2,'double-sharp']]);
          if(val(pitch,'step').length!==1||!'CDEFGAB'.includes(val(pitch,'step'))||
             !isInt(Number(val(pitch,'octave')),1,8)||
             !Number.isInteger(alter)||!spellings.has(alter)||
             kid(pitch,'step').length!==1||kid(pitch,'octave').length!==1||
             kid(pitch,'alter').length>1||
             [...pitch.children].some(x=>!['step','alter','octave'].includes(x.localName))||
             acc.length>1||acc.some(a=>a.attributes?.length||a.children.length||
               a.textContent.trim()!==spellings.get(alter)))
            reject('지원하지 않는 변화표·미분음 또는 장식적 임시표는 리바링에서 보호합니다.');
        }
        const key=(val(note,'voice')||'1')+'@'+(val(note,'staff')||'1');
        if(!groupKey)groupKey=key;
        if(groupKey!==key)reject('한 성부 블록에 서로 다른 성부·보표가 있습니다.');
        if(!lanes[groupIndex])lanes[groupIndex]=[];
        if(first(note,'chord')){
          const prior=lanes[groupIndex].at(-1);
          if(!prior||prior.rest||!first(note,'pitch')||
             first(note,'chord').attributes?.length||
             first(note,'chord').children.length||
             kid(note,'lyric').length||prior.duration!==duration)
            reject('화음 음표는 앞선 일반 음표와 동일한 길이여야 하며 별도 가사는 지원하지 않습니다.');
          const sig=val(first(note,'pitch'),'step')+':' +
            (val(first(note,'pitch'),'alter')||'0')+':' +
            val(first(note,'pitch'),'octave');
          const existing=[prior.node,...prior.tones].map(n=>
            val(first(n,'pitch'),'step')+':' +
            (val(first(n,'pitch'),'alter')||'0')+':' +
            val(first(n,'pitch'),'octave'));
          if(prior.tones.length>=7||existing.includes(sig))
            reject('8개를 넘거나 음정이 중복된 화음은 리바링하지 않습니다.');
          prior.tones.push(note);
        }else{
          lanes[groupIndex].push({node:note,tones:[],duration,
            absoluteStart:index*expectedBar+offset,rest:!!first(note,'rest')});
          offset+=duration;
        }
      }
      if(offset!==expectedBar)reject('모든 성부가 마디 전체 박자를 채워야 재분할할 수 있습니다.');
      keys.push(groupKey);
    }
    if(index===0){
      if(new Set(keys).size!==keys.length)reject('같은 성부가 분리되어 반복됩니다.');
      laneKeys.push(...keys);
    }else if(JSON.stringify(keys)!==JSON.stringify(laneKeys))
      reject('마디마다 성부 순서·보표가 달라 보수적으로 보호합니다.');
  }
  if(lanes.length<1||lanes.length>4)reject('1~4개의 독립 성부만 리바링할 수 있습니다.');
  return {...metadata,lanes,laneKeys,totalTicks:expectedBar*measures.length,partId,
    originalNotes:totalNotes};
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
  let notation=first(note,'notations');
  if(!notation){
    notation=make(note,'notations');
    note.insertBefore(notation,first(note,'lyric')||null);
  }
  const tied=make(notation,'tied');
  tied.setAttribute('type',kind);notation.appendChild(tied);
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
function generatePart(part,report,targetTicks,beats,beatType){
  const count=Math.ceil(report.totalTicks/targetTicks);
  if(count<1||count>3000)reject('재구성된 마디 수가 범위 밖입니다.');
  const measures=Array.from({length:count},(_,i)=>
    newMeasure(part,i,report.attrs,beats,beatType));
  const events=Array.from({length:count},()=>
    Array.from({length:report.lanes.length},()=>[]));
  let renderedNotes=0;
  for(const [voiceIndex,original] of report.lanes.entries()){
    let cursor=0;
    for(const event of original){
      if(event.absoluteStart!==cursor)reject('원래 성부의 절대 시작 시간이 불연속입니다.');
      const span=[],onset=cursor;
      let remaining=event.duration;
      while(remaining){
        const room=targetTicks-(cursor%targetTicks);
        const take=Math.min(room,remaining);
        for(const unit of pieces(take,report.divisions)){
          span.push({...unit,at:cursor});
          cursor+=unit.duration;remaining-=unit.duration;
        }
      }
      if(cursor-onset!==event.duration)reject('원래 음표 길이를 보존하지 못했습니다.');
      for(let i=0;i<span.length;i++){
        const unit=span[i],note=makeContinuation(event.node,unit,i===0);
        if(!event.rest&&span.length>1){
          if(i>0)appendTie(note,'stop');
          if(i<span.length-1)appendTie(note,'start');
        }
        const out=events[Math.floor(unit.at/targetTicks)][voiceIndex];
        out.push(note);
        renderedNotes++;
        // A chord is one onset but multiple MusicXML <note> elements. Every
        // tone is duration-matched to the anchor; each receives its own
        // sounded/written continuation ties when an onset crosses barlines.
        for(const tone of event.tones){
          const chordTone=makeContinuation(tone,unit,i===0);
          if(!first(chordTone,'chord'))
            reject('화음 음표의 동시 발음 표시가 누락되었습니다.');
          if(span.length>1){
            if(i>0)appendTie(chordTone,'stop');
            if(i<span.length-1)appendTie(chordTone,'start');
          }
          out.push(chordTone);
          renderedNotes++;
        }
      }
    }
    if(cursor!==report.totalTicks)reject('원본 성부 길이가 일치하지 않습니다.');
    let padding=count*targetTicks-cursor;
    for(const unit of padding?pieces(padding,report.divisions):[]){
      const n=make(part,'note');
      n.appendChild(make(n,'rest'));n.appendChild(make(n,'duration',unit.duration));
      const like=original[0]?.node;
      if(first(like,'voice'))n.appendChild(make(n,'voice',val(like,'voice')));
      n.appendChild(make(n,'type',unit.type));
      if(unit.dotted)n.appendChild(make(n,'dot'));
      if(first(like,'staff'))n.appendChild(make(n,'staff',val(like,'staff')));
      const index=Math.floor(cursor/targetTicks);
      events[index][voiceIndex].push(n);
      padding-=unit.duration;cursor+=unit.duration;
    }
    if(padding||cursor!==count*targetTicks)
      reject('마지막 마디의 성부 쉼표 길이를 맞출 수 없습니다.');
  }
  for(const [measureIndex,groups] of events.entries()){
    for(const [voiceIndex,notes] of groups.entries()){
      const total=notes.reduce((sum,n)=>sum+(first(n,'chord')?0:Number(val(n,'duration'))),0);
      if(total!==targetTicks)
        reject((measureIndex+1)+'마디의 성부 박자 합계가 올바르지 않습니다.');
      if(voiceIndex>0){
        const backup=make(measures[measureIndex],'backup');
        backup.appendChild(make(backup,'duration',targetTicks));
        measures[measureIndex].appendChild(backup);
      }
      for(const n of notes)measures[measureIndex].appendChild(n);
    }
  }
  for(const m of kid(part,'measure'))part.removeChild(m);
  for(const m of measures)part.appendChild(m);
  return {measures:count,originalNotes:report.originalNotes,renderedNotes,
    voices:report.lanes.length};
}
/**
 * Rebar regular written notes, independent 1-4 voices and simple chords.
 * Tuplets, existing ties and expressive markings still fail closed.
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
    affectedNotes:changes.reduce((n,x)=>n+x.originalNotes,0),
    maxVoices:Math.max(...changes.map(x=>x.voices)),
    simpleChordsPreserved:true,chromaticPitchesPreserved:true}};
}
