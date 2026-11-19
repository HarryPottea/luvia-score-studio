// J-WOO 4.0: read-only MusicXML musical-structure preflight.
// Does not claim schema/XSD validation, exact semantics for all MusicXML
// extensions, renderer collision checks, or a real Logic round-trip.
const direct=(node,tag)=>node?[...node.children].find(x=>x.localName===tag)||null:null;
const many=(node,tag)=>node?[...node.children].filter(x=>x.localName===tag):[];
const text=(node,tag)=>direct(node,tag)?.textContent?.trim()||'';
const natural=x=>/^(0|[1-9]\d*)$/.test(String(x))&&Number.isSafeInteger(Number(x))?Number(x):null;
const positive=x=>{const n=natural(x);return n>0?n:null;};
const quarterFactors={maxima:32,long:16,breve:8,whole:4,half:2,quarter:1,eighth:.5,'16th':.25,'32nd':.125,'64th':.0625,'128th':.03125};
const statusCounts=(issues)=>{
  const errors=issues.filter(i=>i.severity==='ERROR').length;
  const warnings=issues.filter(i=>i.severity==='WARNING').length;
  return {errors,warnings,status:errors?'BLOCKED':warnings?'REVIEW':'CLEAN'};
};
const pitchOf=n=>{
  const pitch=direct(n,'pitch');
  return pitch?[text(pitch,'step'),text(pitch,'alter')||'0',text(pitch,'octave')].join(':'):'';
};
function timeSignature(attributes,previous){
  const time=direct(attributes,'time');
  if(!time)return previous;
  const beats=positive(text(time,'beats'));
  const beatType=positive(text(time,'beat-type'));
  return beats&&beatType&&[1,2,4,8,16,32].includes(beatType)&&beats<=32
    ?{beats,beatType,supported:true}:{beats:null,beatType:null,supported:false};
}
function tupletLength(note,divisions){
  const time=direct(note,'time-modification');
  const kind=text(note,'type');
  if(!time||!quarterFactors[kind])return null;
  const actual=positive(text(time,'actual-notes'));
  const normal=positive(text(time,'normal-notes'));
  if(!actual||!normal||actual>64||normal>64)return {valid:false};
  let dots=1,fraction=.5;
  for(const _ of many(note,'dot')){dots+=fraction;fraction/=2;}
  const expected=divisions*quarterFactors[kind]*dots*normal/actual;
  return {valid:Number.isFinite(expected)&&expected>0,expected};
}
export function auditMusicXml(doc,{maxIssues=150}={}){
  const issues=[];
  let notes=0,measures=0,chords=0,tuplets=0,partsAnalyzed=0,unverified=0;
  const add=(severity,code,message,part='',measure='')=>{
    if(issues.length<maxIssues)issues.push({severity,code,message,part,measure});
  };
  const partNodes=many(doc?.documentElement,'part');
  if(doc?.documentElement?.localName!=='score-partwise'||!partNodes.length){
    add('ERROR','ROOT','파트가 있는 score-partwise MusicXML 문서가 아닙니다.');
    return {status:'BLOCKED',errors:1,warnings:0,issues,stats:{parts:0,measures:0,notes:0,chords:0,tuplets:0,unverified:0},coverage:'BASIC_MUSICAL_TIMING_ONLY'};
  }
  if(!Number.isInteger(maxIssues)||maxIssues<1||maxIssues>500)throw new Error('검사 보고서 크기 제한이 잘못되었습니다.');
  if(partNodes.length>64)add('ERROR','PART_LIMIT','악기 파트가 64개를 초과합니다.');
  const ids=new Set();
  const list=direct(doc.documentElement,'part-list');
  const definitions=new Map(many(list,'score-part').map(x=>[x.getAttribute('id'),text(x,'part-name')]));
  for(const part of partNodes){
    const id=part.getAttribute('id')||'';
    const label=definitions.get(id)||id||'미확인';
    if(!id||ids.has(id))add('ERROR','PART_ID','중복되거나 비어 있는 파트 ID가 있습니다.',label);
    ids.add(id);partsAnalyzed++;
    let divisions=null,meter=null;
    const openTies=new Map(),openSlurs=new Set(),openWedges=new Set();
    const barNodes=many(part,'measure');
    if(!barNodes.length)add('ERROR','EMPTY_PART','마디가 없는 악기 파트입니다.',label);
    if(barNodes.length>3000)add('ERROR','MEASURE_LIMIT','파트의 마디 수가 검사 상한을 초과합니다.',label);
    for(let index=0;index<Math.min(barNodes.length,3000);index++){
      const measure=barNodes[index],bar=measure.getAttribute('number')||String(index+1);
      measures++;
      let cursor=0,lastStart=null,lastDuration=0,lastVoice='',lastStaff='',maxEnd=0;
      let passedNotes=false;
      const lanes=new Map();
      if(many(measure,'attributes').length>2)add('WARNING','MULTIPLE_ATTRIBUTES','마디에 복수의 기보 속성이 포함됩니다. 수동 검수가 필요합니다.',label,bar);
      for(const node of [...measure.children]){
        const tag=node.localName;
        if(tag==='attributes'){
          if(passedNotes)add('WARNING','MID_MEASURE_ATTRIBUTES','마디 중간의 박자·조표 변경은 추가 검수가 필요합니다.',label,bar);
          const d=text(node,'divisions');
          if(d){
            const n=positive(d);
            if(!n||n>1048576)add('ERROR','BAD_DIVISIONS','음악 시간 분할값 divisions가 유효하지 않습니다.',label,bar);
            else divisions=n;
          }
          meter=timeSignature(node,meter);
          if(meter&&!meter.supported){unverified++;add('WARNING','COMPOSITE_METER','복합·비표준 박자는 검사 범위를 벗어납니다.',label,bar);}
          continue;
        }
        if(tag==='backup'||tag==='forward'){
          if(!divisions){add('ERROR','NO_DIVISIONS','성부 시간 이동 전에 divisions가 정의되지 않았습니다.',label,bar);continue;}
          const duration=positive(text(node,'duration'));
          if(!duration){add('ERROR','BAD_TIME_MOVE','성부 시간 이동이 양의 정수가 아닙니다.',label,bar);continue;}
          cursor+=(tag==='backup'?-duration:duration);
          if(cursor<0){add('ERROR','NEGATIVE_TIME','backup이 마디 시작 전으로 이동합니다.',label,bar);cursor=0;}
          if(cursor>maxEnd)maxEnd=cursor;
          lastStart=null;
          continue;
        }
        if(tag==='direction'){
          const w=direct(direct(node,'direction-type'),'wedge');
          if(w){
            const key=w.getAttribute('number')||'1',type=w.getAttribute('type');
            if(type==='crescendo'||type==='diminuendo')openWedges.add(key);
            else if(type==='stop'){
              if(!openWedges.has(key))add('WARNING','WEDGE_UNMATCHED_STOP','셈여림 쐐기의 시작이 확인되지 않습니다.',label,bar);
              openWedges.delete(key);
            }
          }
          continue;
        }
        if(tag!=='note')continue;
        notes++;passedNotes=true;
        if(notes>150000){add('ERROR','NOTE_LIMIT','검사 가능한 음표 수 상한을 초과했습니다.',label,bar);break;}
        const isChord=!!direct(node,'chord'),isRest=!!direct(node,'rest'),isGrace=!!direct(node,'grace');
        const voice=text(node,'voice')||'1',staff=text(node,'staff')||'1';
        const ticks=isGrace?0:positive(text(node,'duration'));
        if(!isGrace&&!ticks){add('ERROR','BAD_NOTE_DURATION','음표·쉼표의 길이가 양의 정수가 아닙니다.',label,bar);continue;}
        const start=isChord?lastStart:cursor;
        if(isChord){
          chords++;
          if(lastStart===null||lastDuration!==ticks||voice!==lastVoice||staff!==lastStaff||isRest)
            add('ERROR','INVALID_CHORD','화음의 기준 음표·길이·성부·보표가 맞지 않습니다.',label,bar);
        }else{
          lastStart=start;lastDuration=ticks;lastVoice=voice;lastStaff=staff;
          const lane=voice+'@'+staff;
          if(!lanes.has(lane))lanes.set(lane,[]);
          lanes.get(lane).push({start,end:start+ticks});
          cursor+=ticks;
        }
        if(!isRest&&!isGrace&&!pitchOf(node)&&!direct(node,'unpitched'))
          add('ERROR','MISSING_PITCH','음표에 음정 정보가 없습니다.',label,bar);
        maxEnd=Math.max(maxEnd,start+ticks,cursor);
        const tuple=tupletLength(node,divisions);
        if(!isGrace&&!direct(node,'time-modification')&&divisions){
          const type=text(node,'type'),base=quarterFactors[type];
          if(base){
            let dottedFactor=1,additional=.5;
            for(const _ of many(node,'dot')){dottedFactor+=additional;additional/=2;}
            const expected=divisions*base*dottedFactor;
            if(Math.abs(expected-ticks)>.05)
              add('WARNING','NOTE_TYPE_DURATION','음표 기보 길이(type·dot)와 실제 duration이 일치하지 않습니다.',label,bar);
          }
        }
        if(direct(node,'time-modification')){
          tuplets++;
          if(!tuple?.valid)add('WARNING','TUPLET_UNSUPPORTED','셋잇단음·잇단음의 시간 비율을 검증할 수 없습니다.',label,bar);
          else if(Math.abs(tuple.expected-ticks)>.05){
            add('ERROR','TUPLET_DURATION','잇단음의 duration과 type·ratio가 맞지 않습니다.',label,bar);
          }
        }
        const pitch=pitchOf(node);
        const tieKey=[voice,staff,pitch].join('/');
        for(const tie of many(node,'tie')){
          if(!pitch){add('WARNING','TIE_NO_PITCH','붙임줄이 음정 없는 표기에 사용됐습니다.',label,bar);continue;}
          const type=tie.getAttribute('type');
          if(type==='stop'){
            if(!openTies.has(tieKey))add('WARNING','TIE_UNMATCHED_STOP','붙임줄 시작 음표를 찾지 못했습니다.',label,bar);
            openTies.delete(tieKey);
          }else if(type==='start'){
            if(openTies.has(tieKey))add('WARNING','TIE_REPEAT_START','붙임줄 시작이 중복됐습니다.',label,bar);
            openTies.set(tieKey,true);
          }
        }
        for(const slur of many(direct(node,'notations'),'slur')){
          const key=slur.getAttribute('number')||'1',type=slur.getAttribute('type');
          if(type==='start')openSlurs.add(key);
          if(type==='stop'){
            if(!openSlurs.has(key))add('WARNING','SLUR_UNMATCHED_STOP','이음줄 시작 기호를 찾지 못했습니다.',label,bar);
            openSlurs.delete(key);
          }
        }
      }
      for(const lane of lanes.values()){
        lane.sort((a,b)=>a.start-b.start);
        for(let n=1;n<lane.length;n++){
          if(lane[n].start<lane[n-1].end)
            add('ERROR','VOICE_OVERLAP','한 성부에서 음표 시간이 겹칩니다.',label,bar);
        }
      }
      if(!divisions)add('ERROR','MISSING_DIVISIONS','분할값 divisions가 정의되지 않았습니다.',label,bar);
      if(meter?.supported&&divisions){
        const expected=divisions*meter.beats*4/meter.beatType;
        if(!Number.isSafeInteger(expected)||expected<=0)add('WARNING','METER_UNVERIFIED','박자 길이를 정확히 계산할 수 없습니다.',label,bar);
        else if(maxEnd>expected+.001)add('ERROR','MEASURE_OVERFULL','마디에 표기된 박자가 박자표를 초과합니다.',label,bar);
        else if(maxEnd<expected-.001&&measure.getAttribute('implicit')!=='yes')
          add('WARNING','MEASURE_UNDERFULL','마디 길이가 박자표보다 짧습니다. 못갖춘마디·숨겨진 쉼표를 확인하세요.',label,bar);
      }else if(!meter){unverified++;add('WARNING','METER_UNKNOWN','박자표가 없어 마디 길이를 검증할 수 없습니다.',label,bar);}
      if(notes>150000)break;
    }
    for(const key of openTies.keys())add('WARNING','TIE_OPEN','끝 음표가 없는 붙임줄이 있습니다: '+key,label);
    for(const key of openSlurs)add('WARNING','SLUR_OPEN','닫히지 않은 이음줄 번호가 있습니다: '+key,label);
    for(const key of openWedges)add('WARNING','WEDGE_OPEN','닫히지 않은 셈여림 기호 번호가 있습니다: '+key,label);
    if(notes>150000)break;
  }
  const result=statusCounts(issues);
  return {...result,issues,stats:{parts:partsAnalyzed,measures,notes,chords,tuplets,unverified},
    truncated:issues.length>=maxIssues,
    coverage:'BASIC_MUSICAL_TIMING_ONLY',schemaValidated:false,visualLayoutVerified:false,
    externalMusicXmlRoundtripVerified:false};
}
export function summarizeMusicXmlAudit(report){
  const r=report||{};
  const label=r.status==='BLOCKED'?'심각한 악보 구조 오류 발견':
    r.status==='REVIEW'?'검토가 필요한 악보':'기본 음악 구조 검사 통과';
  return label+' · 오류 '+(r.errors??0)+'건 · 주의 '+(r.warnings??0)+
    '건 · '+(r.stats?.parts??0)+'파트 / '+(r.stats?.measures??0)+'마디 / '+(r.stats?.notes??0)+'음표';
}
