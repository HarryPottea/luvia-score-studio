// J-WOO 4.0 playback: MusicXML time-axis reader and local Web Audio audition.
// This is an approximate synthesized proof-listen, NOT audio rendering or a DAW.
const direct=(n,t)=>n?[...n.children].find(c=>c.localName===t)||null:null;
const children=(n,t)=>n?[...n.children].filter(c=>c.localName===t):[];
const value=(n,t)=>direct(n,t)?.textContent?.trim()||'';
const stepMidi={C:0,D:2,E:4,F:5,G:7,A:9,B:11};
const fail=message=>{throw new Error(message);};
const validInt=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const round=n=>Math.round(n*1e6)/1e6;
function bpmValue(x){const n=Number(x);return Number.isFinite(n)&&n>=30&&n<=240?n:null;}
function pitchMidi(note) {
  if(direct(note,'rest')||direct(note,'unpitched')||direct(note,'grace'))return null;
  const p=direct(note,'pitch'),step=value(p,'step'),octave=Number(value(p,'octave'));
  const alter=value(p,'alter')===''?0:Number(value(p,'alter'));
  if(!(step in stepMidi)||!validInt(octave,0,9)||!validInt(alter,-2,2))return null;
  const midi=(octave+1)*12+stepMidi[step]+alter;
  return validInt(midi,0,127)?midi:null;
}
export function buildPlaybackTimeline(doc,{defaultBpm=100,maxNotes=3000}={}){
  if(doc?.documentElement?.localName!=='score-partwise')fail('MusicXML partwise 악보만 재생할 수 있습니다.');
  if(!bpmValue(defaultBpm)||!validInt(maxNotes,1,6000))fail('재생 설정이 올바르지 않습니다.');
  const parts=children(doc.documentElement,'part');
  if(!parts.length||parts.length>24)fail('재생할 악보 파트가 없거나 너무 많습니다.');
  const measures=parts.map(part=>children(part,'measure'));
  const maxMeasures=Math.max(...measures.map(list=>list.length));
  if(maxMeasures>400)fail('400마디를 넘는 악보는 간이 재생에서 지원하지 않습니다.');
  const durations=[],starts=[],tempoMarks=[];
  let beats=4,beatType=4,absolute=0;
  const warnings=new Set();
  for(let m=0;m<maxMeasures;m++){
    const primary=measures[0][m];
    for(const attributes of children(primary,'attributes')){
      const time=direct(attributes,'time');
      if(time){
        const nb=Number(value(time,'beats')),nd=Number(value(time,'beat-type'));
        if(validInt(nb,1,32)&&[1,2,4,8,16].includes(nd)){beats=nb;beatType=nd;}
        else fail('복합·비표준 박자 표기를 재생할 수 없습니다.');
      }
    }
    starts.push(absolute);
    durations.push(beats*4/beatType);
    absolute+=durations[m];
  }
  if(absolute>5000)fail('재생 구간이 너무 깁니다.');
  const raw=[];
  for(let p=0;p<parts.length;p++){
    let divisions=0;
    for(let m=0;m<measures[p].length;m++){
      let cursor=0,lastStart=0;
      const measure=measures[p][m];
      for(const elt of measure.children){
        const kind=elt.localName;
        if(kind==='attributes'){
          const d=Number(value(elt,'divisions'));
          if(d){
            if(!validInt(d,1,65536))fail('악보 시간 분할 값이 올바르지 않습니다.');
            divisions=d;
          }
        }else if(kind==='backup'||kind==='forward'){
          if(!divisions)fail('시간 이동 전에 divisions가 필요합니다.');
          const amount=Number(value(elt,'duration'));
          if(!validInt(amount,1,1000000))fail('성부 시간 이동값이 올바르지 않습니다.');
          cursor+=(kind==='forward'?1:-1)*amount/divisions;
          if(cursor<-.000001)fail('음악 시간표에 음수 위치가 있습니다.');
        }else if(kind==='direction'){
          const sound=direct(elt,'sound');
          const tempo=sound?.getAttribute('tempo');
          if(tempo!=null){
            const bpm=bpmValue(tempo);
            if(bpm)tempoMarks.push({quarter:round(starts[m]+cursor),bpm,part:p});
            else warnings.add('일부 템포 표기는 지원 범위를 벗어나 무시했습니다.');
          }
        }else if(kind==='note'){
          if(!divisions)fail('음표의 divisions 정보가 없습니다.');
          const dur=Number(value(elt,'duration'));
          const chord=!!direct(elt,'chord');
          if(!validInt(dur,0,1000000))fail('음표 길이 값이 올바르지 않습니다.');
          const noteStart=chord?lastStart:cursor;
          if(!chord)lastStart=noteStart;
          const midi=pitchMidi(elt);
          if(midi!==null&&dur>0){
            const ties=children(elt,'tie').map(t=>t.getAttribute('type'));
            const beat=round(starts[m]+noteStart);
            raw.push({part:p,voice:value(elt,'voice')||'1',staff:value(elt,'staff')||'1',
              midi,quarter:beat,quarters:dur/divisions,
              tieStart:ties.includes('start'),tieStop:ties.includes('stop')});
            if(raw.length>maxNotes)fail('간이 재생은 최대 '+maxNotes+'개 음표까지만 지원합니다.');
          }else if(direct(elt,'unpitched'))warnings.add('타악기·무음정 음표는 간이 재생에서 제외했습니다.');
          if(!chord)cursor+=dur/divisions;
        }
      }
      if(cursor>durations[m]+.01)warnings.add('일부 성부의 박자 길이가 마디 길이와 달라 청음 위치가 부정확할 수 있습니다.');
    }
    if(measures[p].some(measure=>children(measure,'attributes').some(a=>direct(a,'transpose'))))
      warnings.add('이조 악기 표기는 간이 재생에서 정확하게 반영되지 않을 수 있습니다.');
  }
  const tempoByQuarter=new Map();
  for(const mark of tempoMarks.sort((a,b)=>a.quarter-b.quarter||a.part-b.part)){
    const previous=tempoByQuarter.get(mark.quarter);
    if(previous&&previous.bpm!==mark.bpm)warnings.add('동일 시점의 서로 다른 템포 중 한 값을 사용했습니다.');
    if(!previous)tempoByQuarter.set(mark.quarter,mark);
  }
  const marks=[...tempoByQuarter.values()].sort((a,b)=>a.quarter-b.quarter);
  if(marks[0]?.quarter!==0)marks.unshift({quarter:0,bpm:defaultBpm,part:-1});
  let total=0;
  for(let i=0;i<marks.length;i++){
    marks[i].seconds=total;
    if(i+1<marks.length)total+=(marks[i+1].quarter-marks[i].quarter)*60/marks[i].bpm;
  }
  const secondsAt=quarter=>{
    let lo=0,hi=marks.length-1;
    while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(marks[mid].quarter<=quarter)lo=mid;else hi=mid-1;}
    const item=marks[lo];
    return item.seconds+Math.max(0,quarter-item.quarter)*60/item.bpm;
  };
  // Ties are fused only when same pitch/part/voice/staff and exact adjoining time.
  raw.sort((a,b)=>a.quarter-b.quarter||a.part-b.part||a.midi-b.midi);
  const activeTies=new Map(),merged=[];
  for(const note of raw){
    const key=[note.part,note.voice,note.staff,note.midi].join(':');
    const previous=activeTies.get(key);
    if(note.tieStop&&previous&&Math.abs(previous.quarter+previous.quarters-note.quarter)<.00001){
      previous.quarters+=note.quarters;
      if(!note.tieStart)activeTies.delete(key);
      continue;
    }
    if(note.tieStop)warnings.add('일부 붙임줄의 연결 정보를 확인하지 못해 개별 음표로 재생합니다.');
    const item={...note};
    merged.push(item);
    if(note.tieStart)activeTies.set(key,item);
    else activeTies.delete(key);
  }
  const events=merged.map(n=>({
    part:n.part,midi:n.midi,start:secondsAt(n.quarter),
    duration:Math.max(.04,secondsAt(n.quarter+n.quarters)-secondsAt(n.quarter)),
  }));
  const durationSeconds=Math.max(0,...events.map(n=>n.start+n.duration));
  if(durationSeconds>900)fail('15분을 초과하는 악보는 간이 재생에서 지원하지 않습니다.');
  const measureSeconds=[...starts.map(secondsAt),secondsAt(absolute)];
  return {events,durationSeconds,measureSeconds,
    tempoChanges:marks.map(x=>({quarter:x.quarter,bpm:x.bpm})),warnings:[...warnings]};
}
export function clipPlaybackToMeasures(timeline,{start,end}={}){
  if(!Array.isArray(timeline?.events)||!Array.isArray(timeline?.measureSeconds)||
    timeline.measureSeconds.length<2||!Number.isSafeInteger(start)||
    !Number.isSafeInteger(end)||start<0||end<start||
    end+1>=timeline.measureSeconds.length)
    fail('재생할 마디 범위를 다시 선택해 주세요.');
  const left=timeline.measureSeconds[start],right=timeline.measureSeconds[end+1];
  if(!Number.isFinite(left)||!Number.isFinite(right)||right<=left||
    right-left>900)fail('선택 구간의 재생 시간표가 유효하지 않습니다.');
  const events=[];
  for(const note of timeline.events){
    const nStart=note.start,nEnd=note.start+note.duration;
    if(!Number.isFinite(nStart)||!Number.isFinite(nEnd)||nEnd<=left||nStart>=right)
      continue;
    const from=Math.max(left,nStart),to=Math.min(right,nEnd);
    if(to-from<.04)continue;
    events.push({...note,start:round(from-left),duration:round(to-from)});
  }
  return {events,durationSeconds:round(right-left),
    warnings:[...new Set(timeline.warnings||[])],
    selectedMeasures:{start,end},tempoChanges:timeline.tempoChanges||[],
    measureSeconds:timeline.measureSeconds.slice(start,end+2).map(n=>round(n-left))};
}
// Locate the musical bar by its measured time, never by synthesizer note count.
export function measureAtPlaybackSecond(timeline,seconds){
  const times=timeline?.measureSeconds;
  if(!Array.isArray(times)||times.length<2||!Number.isFinite(seconds)||seconds<0)
    return null;
  if(times.some((v,i)=>!Number.isFinite(v)||(i>0&&v<times[i-1])))return null;
  if(seconds>=times.at(-1))return times.length-2;
  let low=0,high=times.length-2;
  while(low<=high){
    const mid=Math.floor((low+high)/2);
    if(times[mid]<=seconds&&seconds<times[mid+1])return mid;
    if(times[mid]>seconds)high=mid-1;else low=mid+1;
  }
  return null;
}
export function createAuditionPlayer({onState=()=>{},onPosition=()=>{}}={}){
  let context=null,timer=null,events=[],index=0,base=0,active=[],playing=false,repeat=false;
  function stop(){
    if(timer!==null){clearInterval(timer);timer=null;}
    for(const osc of active){try{osc.stop();}catch{}try{osc.disconnect();}catch{}}
    active=[];events=[];playing=false;repeat=false;
    const old=context;context=null;
    if(old)void old.close().catch(()=>{});
    onState(false);
    onPosition(null);
  }
  async function play(timeline,{loop=false}={}){
    stop();
    const Audio=globalThis.AudioContext||globalThis.webkitAudioContext;
    if(!Audio)throw new Error('현재 브라우저는 Web Audio 재생을 지원하지 않습니다.');
    if(!Array.isArray(timeline?.events)||!timeline.events.length)throw new Error('재생할 음표가 없습니다.');
    context=new Audio();
    await context.resume();
    events=timeline.events.slice().sort((a,b)=>a.start-b.start);
    base=context.currentTime+.13;
    index=0;playing=true;repeat=loop===true;onState(true);
    onPosition({measureIndex:(timeline.selectedMeasures?.start||0),seconds:0,loopCycle:0});
    let loopCycle=0,lastMeasureIndex=null;
    const schedule=()=>{
      if(!context||context.state==='closed')return;
      const now=context.currentTime, horizon=now+1.2;
      while(index<events.length&&base+events[index].start<horizon){
        const e=events[index++],start=Math.max(now+.02,base+e.start);
        if(start-base-e.start>.25)continue;
        const end=start+Math.max(.04,Math.min(10,e.duration));
        const osc=context.createOscillator(),gain=context.createGain();
        osc.type='triangle';
        osc.frequency.setValueAtTime(440*Math.pow(2,(e.midi-69)/12),start);
        const level=.055;
        gain.gain.setValueAtTime(.0001,start);
        gain.gain.linearRampToValueAtTime(level,Math.min(end,start+.018));
        gain.gain.setValueAtTime(level,Math.max(start+.018,end-.055));
        gain.gain.exponentialRampToValueAtTime(.0001,end);
        osc.connect(gain).connect(context.destination);osc.start(start);osc.stop(end+.01);
        osc.onended=()=>{try{osc.disconnect();gain.disconnect();}catch{}active=active.filter(x=>x!==osc);};
        active.push(osc);
      }
      const elapsed=Math.max(0,Math.min(timeline.durationSeconds,now-base));
      const inRange=measureAtPlaybackSecond(timeline,elapsed);
      if(inRange!==null){
        const measureIndex=inRange+(timeline.selectedMeasures?.start||0);
        if(measureIndex!==lastMeasureIndex){
          lastMeasureIndex=measureIndex;
          onPosition({measureIndex,seconds:elapsed,loopCycle});
        }
      }
      if(index===events.length&&now>base+timeline.durationSeconds+.3){
        if(repeat){index=0;base=now+.14;loopCycle++;lastMeasureIndex=null;}
        else stop();
      }
    };
    timer=setInterval(schedule,100);
    schedule();
  }
  return {play,stop,get playing(){return playing;}};
}
