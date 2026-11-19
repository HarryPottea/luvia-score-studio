// J-WOO 4.0: conservative MusicXML authoring primitives.
// Each edit clones the source and either returns a complete valid candidate or throws.
// No file, storage, network, playback or UI effects occur in this module.
const direct=(node,name)=>node?[...node.children].find(x=>x.localName===name)||null:null;
const children=(node,name)=>node?[...node.children].filter(x=>x.localName===name):[];
const text=(node,name)=>direct(node,name)?.textContent?.trim()||'';
const allowedTypes=[['whole',4],['half',2],['quarter',1],['eighth',.5],['16th',.25],['32nd',.125]];
const steps='CDEFGAB';
const fail=message=>{throw new Error(message);};
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const escapeXml=value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[ch]));
const element=(parent,name,value)=>{
  const doc=parent.ownerDocument;
  const e=doc.createElementNS?doc.createElementNS(parent.namespaceURI||null,name):doc.createElement(name);
  if(value!==undefined)e.textContent=String(value);
  return e;
};
function partAndMeasure(doc,partId,measureIndex) {
  if(doc?.documentElement?.localName!=='score-partwise')fail('MusicXML partwise 악보만 지원합니다.');
  if(typeof partId!=='string'||!partId||!integer(measureIndex,0,20000))fail('파트나 마디 위치가 올바르지 않습니다.');
  const part=children(doc.documentElement,'part').find(x=>x.getAttribute('id')===partId);
  if(!part)fail('지정한 파트가 없습니다.');
  const measure=children(part,'measure')[measureIndex];
  if(!measure)fail('지정한 마디가 없습니다.');
  return {part,measure};
}
function simpleMeasure(measure){
  if([...measure.children].some(x=>['backup','forward'].includes(x.localName)))fail('다성부의 박자 구조는 보호됩니다.');
  for(const note of children(measure,'note')){
    if([...note.children].some(x=>['chord','voice','staff','time-modification','grace','cue','beam'].includes(x.localName)))
      fail('화음·다성부·셋잇단음·빔이 있는 마디는 이 작업에서 보호됩니다.');
  }
}
function noteAt(measure,eventIndex) {
  if(!integer(eventIndex,0,40000))fail('음표 위치가 올바르지 않습니다.');
  const note=children(measure,'note')[eventIndex];
  if(!note)fail('선택한 음표나 쉼표를 찾지 못했습니다.');
  return note;
}
function activeDivisions(part,measureIndex){
  let divisions=0;
  for(let i=0;i<=measureIndex;i++){
    for(const attrs of children(children(part,'measure')[i],'attributes')){
      const d=Number(text(attrs,'divisions'));
      if(d)divisions=d;
    }
  }
  if(!integer(divisions,1,65536))fail('MusicXML divisions를 확인할 수 없습니다.');
  return divisions;
}
function decompose(ticks,divisions){
  const result=[];
  for(const [type,quarter] of allowedTypes){
    const duration=divisions*quarter;
    if(!Number.isInteger(duration))continue;
    while(ticks>=duration&&result.length<64){result.push({type,duration});ticks-=duration;}
  }
  if(ticks!==0||result.length>32)fail('남은 박자를 지원하는 쉼표로 정확히 표현할 수 없습니다.');
  return result;
}
const scorePart=(id,name,clef,measures)=>({
  id,name,clef,measures
});
export function createBlankScore(options={}) {
  const title=String(options.title||'새 악보').trim();
  const composer=String(options.composer||'').trim();
  const mode=options.template||'melody';
  const measures=Number(options.measures??8);
  if(!title||[...title].length>120||[...composer].length>120)fail('제목과 작곡가 이름은 120자 이하로 입력해 주세요.');
  if(!integer(measures,1,64))fail('마디 수는 1~64 사이여야 합니다.');
  const patterns={
    melody:[['P1','Melody','G']],
    vocal:[['P1','Vocal','G']],
    'vocal-piano':[['P1','Vocal','G'],['P2','Piano RH','G'],['P3','Piano LH','F']],
  };
  const requested=patterns[mode];
  if(!requested)fail('지원하지 않는 신규 악보 템플릿입니다.');
  const parts=requested.map(([id,name,clef])=>scorePart(id,name,clef,measures));
  // Piano RH/LH are deliberately separate editable single-staff parts.
  // This is not a full grand-staff voice-editing replacement.
  const defs=parts.map(part=>'<score-part id="'+part.id+'"><part-name>'+escapeXml(part.name)+'</part-name></score-part>').join('');
  const body=parts.map(part=>{
    let xml='<part id="'+part.id+'">';
    for(let i=0;i<part.measures;i++){
      xml+='<measure number="'+(i+1)+'">';
      if(i===0)xml+='<attributes><divisions>16</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>'+part.clef+'</sign><line>'+(part.clef==='F'?4:2)+'</line></clef></attributes>';
      xml+='<note><rest/><duration>64</duration><type>whole</type></note></measure>';
    }
    return xml+'</part>';
  }).join('');
  return '<?xml version="1.0" encoding="utf-8"?>\n'+
    '<score-partwise version="4.0"><work><work-title>'+escapeXml(title)+'</work-title></work>'+
    '<movement-title>'+escapeXml(title)+'</movement-title><identification><creator type="composer">'+escapeXml(composer)+'</creator></identification>'+
    '<defaults><scaling><millimeters>7</millimeters><tenths>40</tenths></scaling></defaults>'+
    '<part-list>'+defs+'</part-list>'+body+'</score-partwise>';
}
export function placeNoteIntoRest(source,{partId,measureIndex,eventIndex,step='C',alter=0,octave=4,type='quarter'}={}){
  if(!steps.includes(step)||step.length!==1||!integer(alter,-2,2)||!integer(octave,1,8))fail('음정 입력값이 올바르지 않습니다.');
  const unit=allowedTypes.find(x=>x[0]===type);
  if(!unit)fail('지원하지 않는 음표 길이입니다.');
  const doc=source.cloneNode(true),{part,measure}=partAndMeasure(doc,partId,measureIndex);
  simpleMeasure(measure);
  const note=noteAt(measure,eventIndex);
  if(!direct(note,'rest')||!direct(note,'duration')||!direct(note,'type')
    ||[...note.children].some(x=>!['rest','duration','type'].includes(x.localName))
    ||note.attributes.length)fail('일반 쉼표만 음표로 분할할 수 있습니다.');
  const duration=Number(text(note,'duration'));
  const divisions=activeDivisions(part,measureIndex);
  const desired=divisions*unit[1];
  if(!Number.isInteger(desired)||!integer(duration,1,262144)||desired>duration)
    fail('선택한 쉼표보다 긴 음표를 삽입할 수 없습니다.');
  const parts=decompose(duration-desired,divisions);
  const p=element(note,'pitch');
  p.appendChild(element(p,'step',step));
  if(alter!==0)p.appendChild(element(p,'alter',alter));
  p.appendChild(element(p,'octave',octave));
  note.replaceChild(p,direct(note,'rest'));
  direct(note,'duration').textContent=String(desired);
  direct(note,'type').textContent=type;
  let anchor=note;
  for(const r of parts){
    const restNote=element(measure,'note');
    restNote.appendChild(element(restNote,'rest'));
    restNote.appendChild(element(restNote,'duration',r.duration));
    restNote.appendChild(element(restNote,'type',r.type));
    measure.insertBefore(restNote,anchor.nextSibling);
    anchor=restNote;
  }
  return {doc,change:{action:'insert-note',partId,measureIndex,eventIndex,createdRests:parts.length}};
}
export function setScoreLayoutBreak(source,{measureIndex,kind}={}){
  if(!['system','page','none'].includes(kind)||!integer(measureIndex,1,20000))
    fail('첫 마디 이후부터 줄바꿈·페이지 나눔을 지정할 수 있습니다.');
  const doc=source.cloneNode(true);
  const parts=children(doc.documentElement,'part');
  if(!parts.length)fail('악보 파트가 없습니다.');
  for(const part of parts){
    const measure=children(part,'measure')[measureIndex];
    if(!measure)fail('일부 파트에 해당 마디가 없어 레이아웃을 변경하지 않습니다.');
    let print=direct(measure,'print');
    if(print&&children(measure,'print').length>1)fail('중복된 인쇄 지시가 있어 수정하지 않습니다.');
    if(!print&&kind!=='none'){
      print=element(measure,'print');
      const attributes=direct(measure,'attributes');
      measure.insertBefore(print,attributes?attributes.nextSibling:measure.firstChild);
    }
    if(!print)continue;
    print.removeAttribute('new-system');print.removeAttribute('new-page');
    if(kind==='system')print.setAttribute('new-system','yes');
    if(kind==='page')print.setAttribute('new-page','yes');
    if(!print.attributes.length&&!print.children.length)measure.removeChild(print);
  }
  return {doc,change:{action:'layout-break',measureIndex,kind}};
}
export function addExpression(source,{partId,measureIndex,eventIndex=0,kind,value}={}){
  if(!['tempo','dynamic','staccato','accent','tenuto'].includes(kind))fail('지원하지 않는 기보 종류입니다.');
  const doc=source.cloneNode(true),{measure}=partAndMeasure(doc,partId,measureIndex);
  simpleMeasure(measure);
  const note=noteAt(measure,eventIndex);
  if(kind==='staccato'||kind==='accent'||kind==='tenuto'){
    if(direct(note,'rest')||[...note.children].some(x=>['grace','cue','chord'].includes(x.localName)))
      fail('일반 음표에만 아티큘레이션을 사용할 수 있습니다.');
    let notations=direct(note,'notations');
    if(children(note,'notations').length>1)fail('복잡한 기보가 있어 추가하지 않습니다.');
    if(!notations){notations=element(note,'notations');note.appendChild(notations);}
    let articulations=direct(notations,'articulations');
    if(children(notations,'articulations').length>1)fail('중복 아티큘레이션이 있습니다.');
    if(!articulations){articulations=element(notations,'articulations');notations.appendChild(articulations);}
    const previous=direct(articulations,kind);
    if(previous){articulations.removeChild(previous);}
    else articulations.appendChild(element(articulations,kind));
    if(!articulations.children.length)notations.removeChild(articulations);
    if(!notations.children.length)note.removeChild(notations);
  }else{
    if(kind==='tempo'&&!integer(Number(value),30,240))fail('템포는 30~240 BPM 사이여야 합니다.');
    if(kind==='dynamic'&&!['pp','p','mp','mf','f','ff'].includes(value))fail('지원하지 않는 셈여림 기호입니다.');
    const direction=element(measure,'direction');
    direction.setAttribute('placement',kind==='tempo'?'above':'below');
    const directionType=element(direction,'direction-type');
    if(kind==='tempo'){
      const metronome=element(directionType,'metronome');
      metronome.appendChild(element(metronome,'beat-unit','quarter'));
      metronome.appendChild(element(metronome,'per-minute',Number(value)));
      directionType.appendChild(metronome);
      direction.appendChild(directionType);
      const sound=element(direction,'sound');sound.setAttribute('tempo',String(Number(value)));direction.appendChild(sound);
    }else{
      const dynamics=element(directionType,'dynamics');dynamics.appendChild(element(dynamics,value));
      directionType.appendChild(dynamics);direction.appendChild(directionType);
    }
    // In a single-voice measure the current cursor is exactly before this note.
    measure.insertBefore(direction,note);
  }
  return {doc,change:{action:'expression',partId,measureIndex,eventIndex,kind,value}};
}

// Add complete empty 4/4 measures to a score with independent single-staff parts.
// Never synthesize incomplete grand-staff voices or alter existing measures.
export function appendBlankMeasures(source,{count=4}={}){
  if(!integer(count,1,16))fail('한 번에 1~16마디만 추가할 수 있습니다.');
  if(source?.documentElement?.localName!=='score-partwise')fail('MusicXML partwise 악보만 지원합니다.');
  const doc=source.cloneNode(true),parts=children(doc.documentElement,'part');
  if(!parts.length||parts.length>12)fail('마디 확장 지원 범위를 벗어난 악보입니다.');
  const allMeasures=parts.map(part=>children(part,'measure'));
  if(allMeasures.some(list=>list.length!==allMeasures[0].length))fail('파트별 마디 수가 달라 추가하지 않습니다.');
  const start=allMeasures[0].length;
  if(!start||start+count>128)fail('마디 수는 최대 128개까지 지원합니다.');
  const allNumbers=[];
  for(let index=0;index<parts.length;index++){
    const part=parts[index],measures=allMeasures[index];
    let divisions=0,beats=0,beatType=0,staffCount=1;
    for(const measure of measures){
      if([...measure.children].some(x=>['backup','forward'].includes(x.localName)) ||
        children(measure,'note').some(note=>direct(note,'staff')||direct(note,'voice')))
        fail('다성부·복수 보표 악보의 자동 마디 추가는 보호됩니다.');
      for(const attrs of children(measure,'attributes')){
        const d=Number(text(attrs,'divisions'));
        if(d)divisions=d;
        const t=direct(attrs,'time');
        if(t){beats=Number(text(t,'beats'));beatType=Number(text(t,'beat-type'));}
        const st=Number(text(attrs,'staves'));
        if(st>1)staffCount=st;
      }
    }
    const previous=Number(measures[measures.length-1].getAttribute('number'));
    if(!integer(previous,1,20000)||!integer(divisions,1,65536)
       ||beats!==4||beatType!==4||staffCount!==1)
      fail('마지막 박자가 4/4이고 단일 보표인 악보만 마디를 추가할 수 있습니다.');
    allNumbers.push(previous);
    const duration=divisions*4;
    for(let k=1;k<=count;k++){
      const measure=element(part,'measure');
      measure.setAttribute('number',String(previous+k));
      const note=element(measure,'note');
      note.appendChild(element(note,'rest'));
      note.appendChild(element(note,'duration',duration));
      note.appendChild(element(note,'type','whole'));
      measure.appendChild(note);part.appendChild(measure);
    }
  }
  if(new Set(allNumbers).size!==1)fail('파트별 마디 번호가 일치하지 않아 변경하지 않습니다.');
  return {doc,change:{action:'append-measures',count}};
}
export function setSimpleKeySignature(source,{fifths=0}={}){
  if(!integer(fifths,-7,7))fail('조표는 플랫 7개에서 샤프 7개 사이여야 합니다.');
  if(source?.documentElement?.localName!=='score-partwise')fail('MusicXML partwise 악보만 지원합니다.');
  const doc=source.cloneNode(true),parts=children(doc.documentElement,'part');
  if(!parts.length||parts.length>12)fail('조표 변경 지원 범위를 벗어난 악보입니다.');
  const prior=new Set();
  for(const part of parts){
    const measures=children(part,'measure');
    if(!measures.length)fail('비어 있는 악보 파트를 수정하지 않습니다.');
    if(measures.some(measure=>children(measure,'attributes').some(a=>direct(a,'transpose'))))
      fail('이조 악기 파트가 포함된 악보의 전체 조표는 변경하지 않습니다.');
    const measure=measures[0],existing=direct(measure,'attributes');
    if(children(measure,'attributes').length>1)fail('첫 마디에 여러 속성 정보가 있어 변경하지 않습니다.');
    if(existing&&children(existing,'key').length>1)fail('복합 조표가 있어 변경하지 않습니다.');
    if(existing&&direct(existing,'key')){
      const key=direct(existing,'key'),f=Number(text(key,'fifths'));
      if(!integer(f,-7,7)||key.getAttribute('number'))fail('복잡한 조표 정보가 있어 변경하지 않습니다.');
      prior.add(f);
    }
  }
  if(prior.size>1)fail('파트별로 서로 다른 조표가 있어 일괄 변경하지 않습니다.');
  for(const part of parts){
    const measure=children(part,'measure')[0];
    let attrs=direct(measure,'attributes');
    if(!attrs){attrs=element(measure,'attributes');measure.insertBefore(attrs,measure.firstChild);}
    let key=direct(attrs,'key');
    if(!key){
      key=element(attrs,'key');
      const reference=direct(attrs,'time')||direct(attrs,'staves')||direct(attrs,'clef');
      attrs.insertBefore(key,reference||null);
    }
    let f=direct(key,'fifths');
    if(!f){f=element(key,'fifths');key.insertBefore(f,key.firstChild);}
    f.textContent=String(fifths);
    // Existing pitches are deliberately unchanged. Key signatures affect notation only.
  }
  return {doc,change:{action:'key-signature',fifths}};
}
