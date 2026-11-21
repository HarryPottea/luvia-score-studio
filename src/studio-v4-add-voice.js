// Add a fully timed independent voice to an existing MusicXML instrument part.
// Existing musical events are never shifted; empty rests are appended in a new
// <backup> lane for each complete measure. Conservatively refuses pickup,
// partial, corrupt, and unusual meter/divisions structures.
import {inspectAdvancedMeasure} from './advanced-score.js';

const all=(node,t)=>node?[...node.children].filter(n=>n.localName===t):[];
const one=(node,t)=>all(node,t)[0]||null;
const value=(node,t)=>one(node,t)?.textContent?.trim()||'';
const fail=m=>{throw new Error(m);};
const int=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
function element(parent,tag,text){
  const d=parent.ownerDocument;
  const e=d.createElementNS?d.createElementNS(parent.namespaceURI??null,tag):d.createElement(tag);
  if(text!==undefined)e.textContent=String(text);
  return e;
}
const DURATIONS=Object.freeze([
  ['whole',4,false],['half',3,true],['half',2,false],
  ['quarter',1.5,true],['quarter',1,false],['eighth',.75,true],
  ['eighth',.5,false],['16th',.375,true],['16th',.25,false],
  ['32nd',.125,false]
]);
function restPieces(total,divisions){
  const result=[];let left=total;
  for(const [type,quarters,dot] of DURATIONS){
    const ticks=quarters*divisions;
    if(!int(ticks,1,262144))continue;
    while(left>=ticks){
      result.push({duration:ticks,type,dot});
      left-=ticks;
      if(result.length>32)fail('새 성부에 필요한 쉼표가 너무 많습니다.');
    }
  }
  if(left!==0)fail('현재 박자·divisions에서는 새 성부의 쉼표 길이를 정확히 표기할 수 없습니다.');
  return result;
}
function inspectMeasure(bar,{divisions,beats,beatType,staves,voice}){
  let cursor=0,seenNote=false;
  if(bar.getAttribute('implicit')==='yes'||bar.getAttribute('non-controlling')==='yes')
    fail('못갖춘마디·비표준 마디는 새 성부를 자동 추가하지 않습니다.');
  for(const elt of bar.children){
    const kind=elt.localName;
    if(kind==='attributes'){
      if(seenNote&&(one(elt,'time')||one(elt,'divisions')||one(elt,'staves')))
        fail('마디 중간에 박자·분할·보표 수가 달라져 성부 추가를 차단합니다.');
      const d=value(elt,'divisions'),time=one(elt,'time'),st=value(elt,'staves');
      if(d!==''){const v=Number(d);if(!int(v,1,65536))fail('divisions 값이 유효하지 않습니다.');divisions=v;}
      if(time){
        const n=Number(value(time,'beats')),bt=Number(value(time,'beat-type'));
        if(!int(n,1,32)||![1,2,4,8,16].includes(bt))
          fail('비표준 박자표는 자동 성부 생성 범위 밖입니다.');
        beats=n;beatType=bt;
      }
      if(st!==''){const v=Number(st);if(!int(v,1,16))fail('보표 수가 잘못되었습니다.');staves=v;}
    }else if(kind==='note'){
      seenNote=true;
      if((value(elt,'voice')||'1')===voice)fail('선택한 성부 번호가 이미 사용 중입니다.');
      const dur=value(elt,'duration');
      const amount=Number(dur);
      if(one(elt,'grace'))continue;
      if(!int(amount,1,1000000))fail('기존 음표·쉼표 길이를 확인할 수 없습니다.');
      if(!one(elt,'chord'))cursor+=amount;
    }else if(kind==='backup'||kind==='forward'){
      seenNote=true;
      const amount=Number(value(elt,'duration'));
      if(!int(amount,1,1000000))fail('시간 이동 표기가 올바르지 않습니다.');
      cursor+=(kind==='backup'?-amount:amount);
      if(cursor<0)fail('성부 시간표가 마디 시작보다 앞서 있습니다.');
    }
  }
  if(!int(divisions,1,65536)||!int(beats,1,32)||![1,2,4,8,16].includes(beatType))
    fail('박자표·시간 분할 정보를 확인할 수 없습니다.');
  const ticks=divisions*beats*4/beatType;
  if(!int(ticks,1,262144)||cursor!==ticks)
    fail('기존 마디가 완전하지 않아 새 성부를 안전하게 추가하지 않습니다.');
  return {divisions,beats,beatType,staves,ticks};
}
export function addIndependentVoice(source,{partId,voice='2',staff=1}={}){
  if(source?.documentElement?.localName!=='score-partwise'||typeof partId!=='string'||!partId||
     !/^[2-4]$/.test(String(voice))||!int(staff,1,16))
    fail('파트·새 성부(2~4)·보표 번호를 확인해 주세요.');
  const parts=all(source.documentElement,'part'),part=parts.find(p=>p.getAttribute('id')===partId);
  const original=all(part,'measure');
  if(!part||!original.length||original.length>128)
    fail('새 성부를 추가할 파트를 찾지 못했거나 악보가 너무 깁니다.');
  const targetVoice=String(voice),plans=[];let context={divisions:0,beats:0,beatType:0,staves:1};
  for(const [index,bar] of original.entries()){
    context=inspectMeasure(bar,{...context,voice:targetVoice});
    if(staff>context.staves)
      fail((index+1)+'마디의 지정된 보표 번호가 악기 범위를 벗어났습니다.');
    const pieces=restPieces(context.ticks,context.divisions);
    const originalAudit=inspectAdvancedMeasure(source,partId,index);
    if(originalAudit.reason)fail((index+1)+'마디의 성부 구조를 확인할 수 없습니다: '+originalAudit.reason);
    plans.push({ticks:context.ticks,pieces,originalCount:originalAudit.events.length});
  }
  const doc=source.cloneNode(true),copyPart=all(doc.documentElement,'part')
    .find(p=>p.getAttribute('id')===partId);
  const copyBars=all(copyPart,'measure');
  for(const [index,bar] of copyBars.entries()){
    const plan=plans[index],ending=all(bar,'barline').find(b=>b.getAttribute('location')!=='left')||null;
    const backup=element(bar,'backup');
    backup.appendChild(element(backup,'duration',plan.ticks));
    bar.insertBefore(backup,ending);
    for(const item of plan.pieces){
      const n=element(bar,'note');
      n.appendChild(element(n,'rest'));
      n.appendChild(element(n,'duration',item.duration));
      n.appendChild(element(n,'voice',targetVoice));
      n.appendChild(element(n,'type',item.type));
      if(item.dot)n.appendChild(element(n,'dot'));
      n.appendChild(element(n,'staff',staff));
      bar.insertBefore(n,ending);
    }
    const audit=inspectAdvancedMeasure(doc,partId,index);
    const added=audit.events.filter(e=>String(e.voice)===targetVoice&&String(e.staff)===String(staff));
    if(audit.reason||audit.events.length!==plan.originalCount+plan.pieces.length||
       added.length!==plan.pieces.length||
       added.reduce((n,e)=>n+e.duration,0)!==plan.ticks||added.some(e=>!e.rest))
      fail('추가된 성부의 박자·보표 검증에 실패했습니다.');
  }
  return {doc,change:{action:'add-independent-voice',partId,voice:targetVoice,staff,
    measures:plans.length,rests:plans.reduce((n,p)=>n+p.pieces.length,0),
    nextMeasureIndex:0,nextEventIndex:0}};
}
