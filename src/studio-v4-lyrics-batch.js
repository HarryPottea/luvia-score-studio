// J-WOO 4.0 Korean lyric paste. Immutable MusicXML edits; no file/network I/O.
// Each Hangul syllable occupies one melodic note. A standalone '_' extends the
// previous syllable by one more note; spaces separate words, not note slots.
import {inspectAdvancedMeasure} from './advanced-score.js';

const children=(node,name)=>node?[...node.children].filter(n=>n.localName===name):[];
const child=(node,name)=>children(node,name)[0]||null;
const value=(node,name)=>child(node,name)?.textContent?.trim()||'';
const error=message=>{throw new Error(message);};
const validInt=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const HANGUL=/^[가-힣]$/u;
const PUNCT=/^[\p{P}\p{S}]+$/u;
const INVALID=/[\x00-\x08\x0b-\x1f\x7f]/;
const segmenter=new Intl.Segmenter('ko',{granularity:'grapheme'});

function wordSyllables(word){
  const pieces=[];
  let latin='';
  const flush=()=>{if(latin){pieces.push(latin);latin='';}};
  for(const grapheme of segmenter.segment(word)){
    const char=grapheme.segment;
    if(HANGUL.test(char)) {flush();pieces.push(char);}
    else if(PUNCT.test(char)){
      if(latin)latin+=char;
      else if(pieces.length)pieces[pieces.length-1]+=char;
      else latin+=char;
    }else latin+=char;
  }
  flush();
  return pieces;
}

export function parseBatchLyrics(text){
  if(typeof text!=='string'||text.length>20000||INVALID.test(text))
    error('가사는 20,000자 이내의 일반 텍스트로 입력해 주세요.');
  const words=text.trim().split(/\s+/u).filter(Boolean);
  if(!words.length)error('일괄 입력할 가사를 붙여넣어 주세요.');
  const tokens=[];
  for(const word of words){
    if(word==='_'){
      if(!tokens.length)error('멜리스마 연장 기호 _ 앞에 가사 음절이 필요합니다.');
      let previous=tokens.length-1;
      if(tokens[previous].kind==='extension'){
        tokens[previous].extend='continue';
        while(previous>=0&&tokens[previous].kind==='extension')previous--;
      }
      if(previous>=0&&tokens[previous].kind==='text')tokens[previous].extend='start';
      tokens.push({kind:'extension',text:'',extend:'stop'});
      continue;
    }
    const syllables=word.split(/[-‐‑‒–]/u).flatMap(wordSyllables);
    if(!syllables.length)continue;
    syllables.forEach((part,index)=>{
      if([...part].length>100)error('한 음표에 입력하는 가사는 100자를 넘을 수 없습니다.');
      tokens.push({kind:'text',text:part,
        syllabic:syllables.length===1?'single':index===0?'begin':index===syllables.length-1?'end':'middle',
        extend:'none'});
    });
    if(tokens.length>4000)error('한 번에 입력할 수 있는 가사 위치는 최대 4,000개입니다.');
  }
  if(!tokens.some(t=>t.kind==='text'))error('입력할 가사 음절을 찾지 못했습니다.');
  return tokens;
}

function noteLyric(note,verse){
  const matches=children(note,'lyric').filter(n=>(n.getAttribute('number')||'1')===verse);
  if(matches.length>1)error('선택한 절 번호의 가사가 중복된 음표가 있어 변경을 차단했습니다.');
  const found=matches[0]||null;
  if(found){
    const attrs=[...found.attributes].map(x=>x.name);
    if(attrs.some(n=>n!=='number')||[...found.children].some(n=>!['syllabic','text','extend'].includes(n.localName)))
      error('복잡한 기존 가사가 있어 자동으로 덮어쓰지 않습니다. 해당 음표를 개별 수정해 주세요.');
  }
  return found;
}
function soundingStop(note){
  return children(note,'tie').some(t=>t.getAttribute('type')==='stop')||
    children(child(note,'notations'),'tied').some(t=>t.getAttribute('type')==='stop');
}
function pitched(note){
  return !!child(note,'pitch')&&!child(note,'rest')&&!child(note,'grace')&&
    !child(note,'cue')&&!child(note,'unpitched');
}

export function planBatchLyrics(doc,{partId,measureIndex,eventIndex,verse=1,text,overwrite=false}={}){
  if(!validInt(Number(verse),1,12))error('가사 절 번호는 1~12 사이여야 합니다.');
  if(typeof partId!=='string'||!partId||!validInt(measureIndex,0,3000)||!validInt(eventIndex,0,50000))
    error('먼저 악보에서 가사를 시작할 음표를 선택해 주세요.');
  if(doc?.documentElement?.localName!=='score-partwise')error('MusicXML partwise 악보만 지원합니다.');
  const part=children(doc.documentElement,'part').find(n=>n.getAttribute('id')===partId);
  if(!part)error('선택한 악기 파트를 찾지 못했습니다.');
  const measures=children(part,'measure'),initial=measures[measureIndex];
  if(!initial)error('선택한 마디를 찾지 못했습니다.');
  const startAudit=inspectAdvancedMeasure(doc,partId,measureIndex);
  if(startAudit.reason)error('선택한 마디는 자동 배치할 수 없습니다: '+startAudit.reason);
  const selected=startAudit.events[eventIndex];
  const startNote=children(initial,'note')[eventIndex];
  if(!selected||!startNote||selected.rest||selected.chord||!pitched(startNote)||soundingStop(startNote))
    error('가사 시작 위치로 일반 선율 음표를 선택해 주세요. 붙임줄의 뒤 음표나 화음 구성 음표는 시작할 수 없습니다.');
  const laneVoice=selected.voice,laneStaff=selected.staff;
  const tokens=parseBatchLyrics(text),assignments=[];
  let skippedRests=0,skippedTies=0,occupied=0,slot=0;
  const verseText=String(Number(verse));
  for(let m=measureIndex;m<measures.length&&slot<tokens.length;m++){
    const audit=m===measureIndex?startAudit:inspectAdvancedMeasure(doc,partId,m);
    if(audit.reason)error((m+1)+'마디의 성부 시간 정보를 확인할 수 없습니다: '+audit.reason);
    const noteNodes=children(measures[m],'note');
    const events=audit.events.filter(e=>e.voice===laneVoice&&e.staff===laneStaff&&!e.chord)
      .sort((a,b)=>a.start-b.start||a.eventIndex-b.eventIndex);
    const startTime=selected.start;
    for(const event of events){
      if(slot>=tokens.length)break;
      if(m===measureIndex&&(event.start<startTime||event.start===startTime&&event.eventIndex<eventIndex))continue;
      const note=noteNodes[event.eventIndex];
      if(!note)error('음표 위치가 악보와 일치하지 않습니다.');
      if(event.rest){skippedRests++;continue;}
      if(!pitched(note))error((m+1)+'마디에 보호된 기보가 있어 자동 배치를 중단했습니다.');
      if(soundingStop(note)){skippedTies++;continue;}
      const existing=noteLyric(note,verseText);
      if(existing){
        if(!overwrite)error((m+1)+'마디의 '+verseText+'절 가사가 이미 있습니다. 덮어쓰기를 선택하거나 시작 음표를 변경해 주세요.');
        occupied++;
      }
      assignments.push({measureIndex:m,eventIndex:event.eventIndex,token:tokens[slot++]});
    }
  }
  if(slot!==tokens.length)error('가사 위치 '+tokens.length+'개 중 '+slot+'개만 배치할 수 있습니다. 악보 끝이나 선택 성부의 음표 수를 확인해 주세요. 변경 사항은 없습니다.');
  return {partId,verse:Number(verse),voice:laneVoice,staff:laneStaff,
    tokens:tokens.length,syllables:tokens.filter(t=>t.kind==='text').length,
    extensions:tokens.filter(t=>t.kind==='extension').length,
    skippedRests,skippedTies,occupied,assignments};
}

function element(parent,tag,content){
  const doc=parent.ownerDocument;
  const node=doc.createElementNS?doc.createElementNS(parent.namespaceURI||null,tag):doc.createElement(tag);
  if(content!==undefined)node.textContent=String(content);
  return node;
}
function writeLyric(note,verse,token){
  const prior=noteLyric(note,verse);
  if(prior)note.removeChild(prior);
  const lyric=element(note,'lyric');lyric.setAttribute('number',verse);
  if(token.kind==='text'){
    lyric.appendChild(element(lyric,'syllabic',token.syllabic));
    lyric.appendChild(element(lyric,'text',token.text));
  }
  if(token.extend!=='none'){
    const extend=element(lyric,'extend');extend.setAttribute('type',token.extend);lyric.appendChild(extend);
  }
  const next=children(note,'lyric').find(n=>{
    const number=Number(n.getAttribute('number')||'1');
    return Number.isFinite(number)&&number>Number(verse);
  })||child(note,'play')||child(note,'listen');
  note.insertBefore(lyric,next||null);
}
export function applyBatchLyrics(source,options){
  const plan=planBatchLyrics(source,options);
  const result=source.cloneNode(true);
  const part=children(result.documentElement,'part').find(n=>n.getAttribute('id')===plan.partId);
  const measures=children(part,'measure');
  for(const item of plan.assignments){
    const note=children(measures[item.measureIndex],'note')[item.eventIndex];
    if(!note)error('일괄 입력 중 음표 위치가 변경되어 적용하지 않았습니다.');
    writeLyric(note,String(plan.verse),item.token);
  }
  return {doc:result,change:{action:'batch-lyrics',partId:plan.partId,verse:plan.verse,
    count:plan.tokens,syllables:plan.syllables,extensions:plan.extensions}};
}
