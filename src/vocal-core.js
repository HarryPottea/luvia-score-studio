// J-WOO vocal project adapter. No score mutation or network access.
const all=(n,t)=>Array.from(n?.children||[]).filter(x=>x.localName===t);
const one=(n,t)=>all(n,t)[0];
const val=(n,t)=>one(n,t)?.textContent?.trim()||'';
const fail=m=>{throw new Error(m);};
const int=(x,a,b)=>Number.isSafeInteger(x)&&x>=a&&x<=b;
const tick=q=>{const x=Math.round(q*480);if(Math.abs(x-q*480)>1e-5)fail('480 PPQ로 정확히 표현할 수 없는 리듬입니다.');return x;};
const pitchMap={C:0,D:2,E:4,F:5,G:7,A:9,B:11};
export const STYLES=Object.freeze({neutral:{power:0,breath:0,expression:65,vibrato:0},musical:{power:45,breath:-15,expression:95,vibrato:35},soft:{power:-35,breath:35,expression:80,vibrato:25},sad:{power:-20,breath:25,expression:90,vibrato:45},strong:{power:65,breath:-30,expression:85,vibrato:25}});
export function vocalLanes(doc){
  return all(doc?.documentElement,'part').flatMap(p=>{
    const pairs=new Map();
    for(const m of all(p,'measure'))for(const n of all(m,'note')){
      if(one(n,'rest')||!one(n,'pitch'))continue;
      const voice=val(n,'voice')||'1',staff=val(n,'staff')||'1';
      pairs.set(JSON.stringify([voice,staff]),{partId:p.getAttribute('id'),voice,staff});
    }
    return [...pairs.values()];
  });
}
function parsePart(p,{lyricVerse,selected,voice,staff}){
  let div=0,beats=4,unit=4,absolute=0,active=new Map();
  const bars=[],notes=[],tempos=[],signatures=[];
  for(const [mi,m] of all(p,'measure').entries()){
    let cursor=0,extent=0,last=0;
    if(all(m,'barline').some(b=>one(b,'repeat')||one(b,'ending')))fail('반복·볼타는 실제 연주 순서로 펼친 악보를 사용해 주세요.');
    for(const e of m.children){
      const t=e.localName;
      if(t==='attributes'){
        if(one(e,'divisions')){div=Number(val(e,'divisions'));if(!int(div,1,65536))fail('divisions 오류');}
        if(one(e,'transpose')&&selected)fail('이조 악보는 실음 악보로 변환해 주세요.');
        const time=one(e,'time');
        if(time){
          if(cursor!==0||all(time,'beats').length!==1||all(time,'beat-type').length!==1)fail('복합 또는 마디 내부 박자는 지원하지 않습니다.');
          beats=Number(val(time,'beats'));unit=Number(val(time,'beat-type'));
          if(!int(beats,1,32)||![1,2,4,8,16,32].includes(unit))fail('지원하지 않는 박자입니다.');
          signatures.push({bar_position:mi,beat_per_bar:beats,beat_unit:unit});
        }
      }else if(t==='direction'){
        const sound=one(e,'sound');
        if(sound&&['dacapo','dalsegno','tocoda','fine','segno','coda'].some(a=>sound.hasAttribute(a)))fail('도돌이·다카포 등은 펼친 악보로 입력해 주세요.');
        const tempo=sound?.getAttribute('tempo');
        if(tempo!=null){
          const bpm=Number(tempo),off=Number(val(e,'offset')||0);
          if(!Number.isFinite(bpm)||bpm<20||bpm>400||!Number.isFinite(off)||(off!==0&&!div))fail('템포 정보 오류');
          const position=tick(absolute+cursor+(off?off/div:0));
          if(position<0)fail('음수 템포 위치');
          tempos.push({position,bpm});
        }else if(all(e,'direction-type').some(x=>one(x,'metronome')))fail('숫자 재생 템포(sound tempo)가 없는 메트로놈 표기는 먼저 명시해 주세요.');
      }else if(t==='backup'||t==='forward'){
        const d=Number(val(e,'duration'));
        if(!div||!int(d,1,1000000))fail('시간 이동 오류');
        cursor+=(t==='backup'?-1:1)*d/div;
        if(cursor<-.000001)fail('음수 시간 위치');
        extent=Math.max(extent,cursor);
      }else if(t==='note'){
        const lane=selected&&(val(e,'voice')||'1')===voice&&(val(e,'staff')||'1')===staff;
        if(one(e,'grace')){if(lane)fail('꾸밈음은 일반 음표로 풀어 주세요.');continue;}
        const dur=Number(val(e,'duration')),chord=!!one(e,'chord');
        if(!div||!int(dur,1,1000000))fail('음표 길이 오류');
        const start=chord?last:cursor;
        if(!chord){last=cursor;cursor+=dur/div;}
        extent=Math.max(extent,start+dur/div,cursor);
        if(!lane||one(e,'rest'))continue;
        if(chord||one(e,'unpitched'))fail('보컬은 한 번에 단선율 성부만 선택할 수 있습니다.');
        const pch=one(e,'pitch'),step=val(pch,'step'),oct=Number(val(pch,'octave')),alt=Number(val(pch,'alter')||0);
        const tone=(oct+1)*12+pitchMap[step]+alt;
        if(!int(oct,0,9)||!int(alt,-2,2)||!int(tone,0,127))fail('지원하지 않는 음정입니다.');
        const position=tick(absolute+start),duration=tick(start+dur/div)-tick(start);
        const lyrics=all(e,'lyric').filter(x=>(x.getAttribute('number')||'1')===lyricVerse);
        if(lyrics.length>1||lyrics.some(x=>all(x,'text').length>1||one(x,'elision')))fail('복합 가사 표기를 한 음절씩 정리해 주세요.');
        const lyric=val(lyrics[0],'text');
        const ties=new Set(all(e,'tie').map(x=>x.getAttribute('type')));
        if(ties.has('stop')){
          const prev=active.get(tone);
          if(!prev||prev.position+prev.duration!==position||(lyric&&lyric!==prev.lyric))fail('붙임줄 연결을 확인해 주세요.');
          prev.duration+=duration;
          if(!ties.has('start'))active.delete(tone);
          continue;
        }
        if(active.has(tone))fail('닫히지 않은 붙임줄');
        if(!lyric&&!one(lyrics[0],'extend'))fail((mi+1)+'마디에 가사가 없는 음표가 있습니다. 가사 또는 연음 표기를 입력하세요.');
        const note={position,duration,tone,lyric:lyric||'+',measure:mi};
        notes.push(note);if(ties.has('start'))active.set(tone,note);
      }
    }
    const nominal=beats*4/unit;
    if(extent>nominal+1e-6)fail((mi+1)+'마디의 박자 길이가 넘칩니다.');
    const implicit=m.getAttribute('implicit')==='yes'||(mi===0&&extent>0&&extent<nominal-1e-6);
    const length=implicit?extent:nominal;
    if(!(length>0))fail('빈 못갖춘마디');
    bars.push({start:tick(absolute),end:tick(absolute+length)});
    absolute+=length;
  }
  if(active.size)fail('끝까지 연결되지 않은 붙임줄입니다.');
  return {bars,notes,tempos,signatures};
}
export function buildVocalPlan(doc,{partId,voice='1',staff='1',lyricVerse='1',defaultBpm=120,startMeasure=1,endMeasure=null}={}){
  if(doc?.documentElement?.localName!=='score-partwise')fail('MusicXML 악보를 먼저 열어 주세요.');
  if(!Number.isFinite(defaultBpm)||defaultBpm<20||defaultBpm>400)fail('기본 BPM을 확인해 주세요.');
  const parts=all(doc.documentElement,'part'),p=parts.find(x=>x.getAttribute('id')===partId);
  if(!p||parts.length>24||all(p,'measure').length>400)fail('파트 또는 마디 수를 확인해 주세요.');
  const parsed=parts.map(x=>parsePart(x,{selected:x===p,voice,staff,lyricVerse})),target=parsed[parts.indexOf(p)];
  // Reject inconsistent global time maps instead of guessing alignment.
  for(const a of parsed)if(a.bars.length!==target.bars.length||a.bars.some((v,i)=>v.start!==target.bars[i].start||v.end!==target.bars[i].end))fail('파트별 마디 시간축이 다릅니다. 정렬된 멜로디 악보를 사용해 주세요.');
  const bars=target.bars;endMeasure=endMeasure??bars.length;
  if(!int(startMeasure,1,bars.length)||!int(endMeasure,startMeasure,bars.length))fail('생성 마디 범위를 확인하세요.');
  const left=bars[startMeasure-1].start,right=bars[endMeasure-1].end;
  const notes=target.notes.sort((a,b)=>a.position-b.position||a.tone-b.tone);
  if(notes.length>6000||notes.some((n,i)=>i&&notes[i-1].position+notes[i-1].duration>n.position))fail('겹치는 음표 또는 음표 수 초과');
  const selected=notes.filter(n=>n.position<right&&n.position+n.duration>left);
  if(!selected.length||selected.some(n=>n.position<left||n.position+n.duration>right))fail('음표가 없거나 붙임줄이 범위 경계를 넘습니다.');
  if(selected[0].lyric==='+'||selected.some((n,i)=>n.lyric==='+'&&(!i||selected[i-1].position+selected[i-1].duration!==n.position)))fail('연음은 앞 음절과 함께 생성해야 합니다.');
  const tm=new Map();
  for(const a of parsed)for(const t of a.tempos){if(tm.has(t.position)&&tm.get(t.position)!==t.bpm)fail('파트별 템포가 충돌합니다.');tm.set(t.position,t.bpm);}
  if(!tm.has(0))tm.set(0,defaultBpm);
  const tempos=[...tm].sort((a,b)=>a[0]-b[0]).map(([position,bpm])=>({position,bpm}));
  const activeBpm=tempos.filter(t=>t.position<=left).at(-1).bpm;
  const rangeTempos=[{position:0,bpm:activeBpm},...tempos.filter(t=>t.position>left&&t.position<right).map(t=>({position:t.position-left,bpm:t.bpm}))];
  const plan={notes:selected.map(n=>({...n,position:n.position-left})),tempos:rangeTempos,duration:right-left,measures:bars.slice(startMeasure-1,endMeasure).map(b=>({start:b.start-left,end:b.end-left})),startMeasure};
  validatePlan(plan);return plan;
}
export function secondsAt(plan,position){
  let s=0,prev=0,bpm=plan.tempos[0].bpm;
  for(const t of plan.tempos.slice(1)){if(t.position>=position)break;s+=(t.position-prev)*60/(480*bpm);prev=t.position;bpm=t.bpm;}
  return s+(position-prev)*60/(480*bpm);
}
export function validatePlan(p){
  if(!p||!int(p.duration,1,480*4000)||!Array.isArray(p.notes)||!p.notes.length||p.notes.length>6000||!Array.isArray(p.tempos)||!p.tempos.length||p.tempos.length>2000||p.tempos[0].position!==0)fail('잘못된 보컬 프로젝트');
  let end=0;
  for(const n of p.notes){
    if(!int(n.position,end,p.duration-1)||!int(n.duration,1,p.duration-n.position)||!int(n.tone,0,127)||typeof n.lyric!=='string'||n.lyric.length>80||!(/^[가-힣]+$/.test(n.lyric)||n.lyric==='+'))fail('한글 음절과 단선율 음표만 지원합니다.');
    if(n.lyric==='+'&&(!end||n.position!==end))fail('잘못된 연음');
    end=n.position+n.duration;
  }
  let pos=-1;for(const t of p.tempos){if(!int(t.position,pos+1,p.duration-1)||!Number.isFinite(t.bpm)||t.bpm<20||t.bpm>400)fail('잘못된 템포');pos=t.position;}
  if(secondsAt(p,p.duration)>600)fail('최대 10분까지 생성할 수 있습니다.');
  return p;
}
export function buildUstx(plan,model,style){
  validatePlan(plan);
  if(!model||typeof model.id!=='string'||!model.id||model.id.length>300)fail('설치된 보컬을 선택하세요.');
  const supported=new Set(model.expressions||[]);
  for(const [key,min,max,exp] of [['power',-100,100,'tenc'],['breath',-100,100,'brec'],['expression',0,100,'pexp'],['vibrato',0,100,'vibrato']]){
    if(!int(style?.[key],min,max))fail('잘못된 표현 값');
    if(!supported.has(exp)&&style[key]!==({power:0,breath:0,expression:100,vibrato:0})[key])fail('선택한 보컬은 '+exp+' 표현을 지원하지 않습니다.');
  }
  const curves=[['tenc',style.power,0],['brec',style.breath,0],['pexp',style.expression,100]].filter(([a,v,d])=>supported.has(a)&&v!==d).map(([abbr,y])=>({abbr,xs:[0,plan.duration],ys:[y,y]}));
  const expressions={pexp:{name:'pitch expressiveness (curve)',abbr:'pexp',type:'Curve',min:0,max:100,default_value:100,is_flag:false}};
  const notes=plan.notes.map(n=>({position:n.position,duration:n.duration,tone:n.tone,lyric:n.lyric,pitch:{data:[{x:-40,y:0,shape:'io'},{x:40,y:0,shape:'io'}],snap_first:true},vibrato:{length:style.vibrato,period:175,depth:25,in:10,out:10,shift:0,drift:0,vol_link:0},phoneme_expressions:[],phoneme_overrides:[]}));
  const track={singer:model.id,phonemizer:'OpenUtau.Core.DiffSinger.DiffSingerKoreanPhonemizer',renderer_settings:{renderer:'DIFFSINGER'},track_name:'J-WOO Vocal',volume:0,pan:0,mute:false,solo:false};
  // YAML block header, JSON flow values (valid YAML). No wave parts or external paths.
  const obj={ustx_version:'0.6',name:'J-WOO Vocal Guide',expressions,time_signatures:[{bar_position:0,beat_per_bar:4,beat_unit:4}],tempos:plan.tempos.map(({position,bpm})=>({position,bpm})),tracks:[track],voice_parts:[{name:'Vocal',track_no:0,position:0,duration:plan.duration,notes,curves}],wave_parts:[]};
  return Object.entries(obj).map(([key,value])=>key+': '+JSON.stringify(value)).join('\n')+'\n';
}
