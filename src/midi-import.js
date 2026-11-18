// Constrained Standard MIDI File (SMF) -> MusicXML importer for monophonic pitched tracks.
// MIDI timing is quantized explicitly; original MIDI bytes are never overwritten.
const textDecoder=new TextDecoder('utf-8',{fatal:false});
const MAX_BYTES=5*1024*1024,MAX_TRACKS=24,MAX_PARTS=12,MAX_NOTES=4000,MAX_MEASURES=300;
const TYPE_VALUES=[['whole',4,false],['half',3,true],['half',2,false],['quarter',1.5,true],['quarter',1,false],['eighth',.75,true],['eighth',.5,false],['16th',.375,true],['16th',.25,false]];
function fail(message){throw new Error(message);}
function reader(arrayBuffer) {
  const bytes=arrayBuffer instanceof Uint8Array?arrayBuffer:new Uint8Array(arrayBuffer);
  if(!bytes.length||bytes.length>MAX_BYTES)fail('MIDI 파일은 5MB 이하만 지원합니다.');
  let offset=0;
  const requireBytes=n=>{if(offset+n>bytes.length)fail('MIDI 파일이 중간에서 끝났습니다.');};
  return {
    get offset(){return offset;},get length(){return bytes.length;},
    u8(){requireBytes(1);return bytes[offset++];},
    u16(){requireBytes(2);return ((bytes[offset++]<<8)|bytes[offset++]);},
    u32(){requireBytes(4);return (((bytes[offset++]<<24)>>>0)+(bytes[offset++]<<16)+(bytes[offset++]<<8)+bytes[offset++])>>>0;},
    chunk(n){requireBytes(n);const value=bytes.subarray(offset,offset+n);offset+=n;return value;},
    skip(n){requireBytes(n);offset+=n;},
    vlq(){let n=0;for(let i=0;i<4;i++){const b=this.u8();n=(n<<7)|(b&127);if(!(b&128))return n;}fail('MIDI 가변 길이 데이터가 너무 깁니다.');},
  };
}
const fourCC=r=>textDecoder.decode(r.chunk(4));
function escapeXml(value) {
  return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[ch]));
}
function midiPitch(value) {
  const names=[['C',0],['C',1],['D',0],['D',1],['E',0],['F',0],['F',1],['G',0],['G',1],['A',0],['A',1],['B',0]];
  const [step,alter]=names[value%12];
  return {step,alter,octave:Math.floor(value/12)-1};
}
function splitDuration(duration,ppq) {
  let rest=duration;
  const out=[];
  for(const [type,factor,dotted] of TYPE_VALUES) {
    const ticks=ppq*factor;
    if(!Number.isSafeInteger(ticks))continue;
    while(rest>=ticks) {
      out.push({ticks,type,dotted});
      rest-=ticks;
      if(out.length>80)fail('악보 기보 분할이 너무 복잡합니다.');
    }
  }
  if(rest!==0)fail('음표 길이를 정밀하게 기보할 수 없습니다.');
  return out;
}
function readTracks(bytes) {
  const r=reader(bytes);
  if(fourCC(r)!=='MThd')fail('표준 MIDI 파일 형식이 아닙니다.');
  const headerSize=r.u32();
  if(headerSize<6||headerSize>128)fail('MIDI 헤더가 올바르지 않습니다.');
  const format=r.u16(),count=r.u16(),ppq=r.u16();
  if(format>1||!count||count>MAX_TRACKS||ppq>=0x8000||ppq<24||ppq%4)fail('현재는 PPQ가 4로 나누어지는 SMF 형식 0·1만 지원합니다.');
  r.skip(headerSize-6);
  const tracks=[];let meter=null;let noteCount=0;
  for(let i=0;i<count;i++){
    if(fourCC(r)!=='MTrk')fail('MIDI 트랙 정보가 올바르지 않습니다.');
    const size=r.u32();const end=r.offset+size;
    if(end>r.length)fail('MIDI 트랙 길이가 파일보다 큽니다.');
    let tick=0, running=0, name='';const active=new Map(),notes=[];
    while(r.offset<end){
      tick+=r.vlq();if(tick>100000000)fail('MIDI 길이가 지나치게 큽니다.');
      let status=r.u8();
      if(status<128){if(!running)fail('MIDI 실행 상태를 알 수 없습니다.');status=running; r.skip(-1);}
      else if(status<0xf0)running=status;
      else running=0;
      if(status===0xff){
        const meta=r.u8(),length=r.vlq(),data=r.chunk(length);
        if(meta===0x03 && !name)name=textDecoder.decode(data).slice(0,80);
        if(meta===0x58) {
          if(length<2)fail('MIDI 박자 메타데이터가 불완전합니다.');
          const newMeter={beats:data[0],beatType:2**data[1]};
          if(![2,3,4,6].includes(newMeter.beats)||![4,8].includes(newMeter.beatType))fail('지원하지 않는 MIDI 박자입니다.');
          if(meter && (meter.beats!==newMeter.beats||meter.beatType!==newMeter.beatType))fail('곡 중간 박자 변경은 아직 지원하지 않습니다.');
          meter=newMeter;
        }
        if(meta===0x2f)break;
      } else if(status===0xf0||status===0xf7){
        r.skip(r.vlq());
      } else if(status>=0x80&&status<0xf0){
        const command=status&0xf0,channel=status&15;
        const a=r.u8();const b=command===0xc0||command===0xd0?null:r.u8();
        if((command===0x90&&b>0)||command===0x80||(command===0x90&&b===0)){
          if(channel===9)fail('드럼 채널 MIDI는 아직 지원하지 않습니다.');
          const key=channel+':'+a;
          if(command===0x90&&b>0) {
            if(active.has(key))fail('같은 음이 이전에 종료되지 않았습니다. 다성부 MIDI는 변환하지 않습니다.');
            active.set(key,tick);
          } else {
            const start=active.get(key);
            if(start!==undefined){
              if(tick<=start)fail('길이가 없는 MIDI 음표가 있습니다.');
              notes.push({pitch:a,start,end:tick});
              active.delete(key);noteCount++;
              if(noteCount>MAX_NOTES)fail('음표가 너무 많아 자동 변환하지 않습니다.');
            }
          }
        } else if(command===0xb0&&a===64&&b>=64)fail('서스테인 페달 MIDI는 추가 해석이 필요하여 변환하지 않습니다.');
        else if(command===0xe0&&((a|b)!==64)) {
          // Pitch-bend values are semantically important, so avoid losing them.
          if(a!==0||b!==64)fail('피치벤드가 포함된 MIDI는 지원하지 않습니다.');
        }
      } else fail('지원하지 않는 MIDI 이벤트입니다.');
      if(r.offset>end)fail('MIDI 트랙이 범위를 벗어났습니다.');
    }
    if(active.size)fail('종료되지 않은 MIDI 음표가 있습니다.');
    if(r.offset<end)r.skip(end-r.offset);
    tracks.push({name:name.trim()||('Track '+(i+1)),notes});
  }
  if(!noteCount)fail('MIDI에 음표가 없습니다.');
  return {tracks:tracks.filter(t=>t.notes.length),ppq,meter:meter||{beats:4,beatType:4},noteCount};
}
function notesToEvents(track,ppq,measureTicks) {
  const quantum=ppq/4,sorted=[...track.notes].sort((a,b)=>a.start-b.start||a.end-b.end);
  let shifted=0,maxError=0;
  const quantized=sorted.map(n=>{
    const start=Math.round(n.start/quantum)*quantum,end=Math.max(start+quantum,Math.round(n.end/quantum)*quantum);
    const delta=Math.max(Math.abs(start-n.start),Math.abs(end-n.end));
    if(delta>0)shifted++;
    maxError=Math.max(maxError,delta);
    return {...n,start,end};
  });
  for(let i=1;i<quantized.length;i++)if(quantized[i].start<quantized[i-1].end)fail(track.name+'의 음표가 겹칩니다. 다성부나 자동 퀀타이즈 충돌은 보호됩니다.');
  const events=[];let cursor=0;
  function pushRange(kind,start,end,pitch=0) {
    const grouped=[];
    for(let time=start;time<end;){
      const atBar=Math.floor(time/measureTicks);
      const until=Math.min(end,(atBar+1)*measureTicks);
      for(const piece of splitDuration(until-time,ppq))grouped.push({kind,pitch,measure:atBar,start:time,ticks:piece.ticks,type:piece.type,dotted:piece.dotted}),time+=piece.ticks;
    }
    for(let k=0;k<grouped.length;k++)events.push({...grouped[k],tieStop:kind==='note'&&k>0,tieStart:kind==='note'&&k<grouped.length-1});
  }
  for(const n of quantized) {
    if(n.start>cursor)pushRange('rest',cursor,n.start);
    pushRange('note',n.start,n.end,n.pitch);cursor=n.end;
  }
  return {events,shifted,maxError,lastTick:cursor};
}
function emitNote(e) {
  let xml='<note>';
  if(e.kind==='rest')xml+='<rest/>';
  else {
    const pitch=midiPitch(e.pitch);
    xml+='<pitch><step>'+pitch.step+'</step>'+(pitch.alter?'<alter>'+pitch.alter+'</alter>':'')+'<octave>'+pitch.octave+'</octave></pitch>';
  }
  xml+='<duration>'+e.ticks+'</duration>';
  if(e.tieStop)xml+='<tie type="stop"/>';
  if(e.tieStart)xml+='<tie type="start"/>';
  xml+='<type>'+e.type+'</type>';
  if(e.dotted)xml+='<dot/>';
  if(e.tieStop||e.tieStart)xml+='<notations>'+(e.tieStop?'<tied type="stop"/>':'')+(e.tieStart?'<tied type="start"/>':'')+'</notations>';
  return xml+'</note>';
}
export function midiToMusicXml(source,filename='MIDI Sketch') {
  const parsed=readTracks(source);
  const {ppq,meter}=parsed;
  if(parsed.tracks.length>MAX_PARTS)fail('MIDI 악기 트랙은 최대 12개까지만 지원합니다.');
  const measureTicks=ppq*meter.beats*4/meter.beatType;
  if(!Number.isSafeInteger(measureTicks))fail('MIDI 박자와 PPQ를 정확히 표현할 수 없습니다.');
  const results=parsed.tracks.map(track=>({track,...notesToEvents(track,ppq,measureTicks)}));
  const count=Math.ceil(Math.max(...results.map(result=>result.lastTick))/measureTicks);
  if(count<=0||count>MAX_MEASURES)fail('악보 길이가 지원 범위를 초과했습니다.');
  let shifted=0,maxError=0;
  for(const x of results){shifted+=x.shifted;maxError=Math.max(maxError,x.maxError);}
  const title=escapeXml(String(filename).replace(/\.(mid|midi)$/i,'').slice(0,100));
  let xml='<?xml version="1.0" encoding="utf-8"?><score-partwise version="4.0">';
  xml+='<work><work-title>'+title+'</work-title></work><movement-title>'+title+'</movement-title>';
  xml+='<defaults><scaling><millimeters>7</millimeters><tenths>40</tenths></scaling></defaults>';
  xml+='<part-list>'+results.map((r,i)=>'<score-part id="P'+(i+1)+'"><part-name>'+escapeXml(r.track.name)+'</part-name></score-part>').join('')+'</part-list>';
  for(let i=0;i<results.length;i++){
    const r=results[i];
    xml+='<part id="P'+(i+1)+'">';
    for(let m=0;m<count;m++){
      xml+='<measure number="'+(m+1)+'">';
      if(m===0)xml+='<attributes><divisions>'+ppq+'</divisions><key><fifths>0</fifths></key><time><beats>'+meter.beats+'</beats><beat-type>'+meter.beatType+'</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>';
      for(const e of r.events.filter(e=>e.measure===m))xml+=emitNote(e);
      const occupied=r.events.filter(e=>e.measure===m).reduce((n,e)=>n+e.ticks,0);
      if(occupied<measureTicks){
        const gap=splitDuration(measureTicks-occupied,ppq);
        for(const g of gap)xml+=emitNote({kind:'rest',...g});
      }
      if(occupied>measureTicks)fail('MIDI 마디의 길이가 올바르지 않습니다.');
      xml+='</measure>';
    }
    xml+='</part>';
  }
  xml+='</score-partwise>';
  return {xml,report:{tracks:results.length,notes:parsed.noteCount,quantizedNotes:shifted,maxQuantizationErrorTicks:maxError,ppq,beats:meter.beats,beatType:meter.beatType,measures:count}};
}
