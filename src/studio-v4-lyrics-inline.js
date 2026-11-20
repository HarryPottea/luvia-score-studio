// Score-anchored lyric editing: read-only selection and safe next-note navigation.
// Text editing is delegated to the existing immutable MusicXML lyric/batch engines.
// No network, file writes, or assumptions about SVG note ordering.
import {inspectAdvancedMeasure} from './advanced-score.js';
import {parseBatchLyrics} from './studio-v4-lyrics-batch.js';

const children=(node,tag)=>node?[...node.children].filter(n=>n.localName===tag):[];
const first=(node,tag)=>children(node,tag)[0]||null;
const text=(node,tag)=>first(node,tag)?.textContent?.trim()||'';
const valid=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const reject=message=>{throw new Error(message);};
const tiedStop=note=>children(note,'tie').some(n=>n.getAttribute('type')==='stop')||
  children(first(note,'notations'),'tied').some(n=>n.getAttribute('type')==='stop');

function lookup(doc,{partId,measureIndex,eventIndex}={}){
  if(doc?.documentElement?.localName!=='score-partwise'||!partId||
    !valid(measureIndex,0,3000)||!valid(eventIndex,0,50000))
    reject('편집할 악기·마디·음표 위치가 올바르지 않습니다.');
  const part=children(doc.documentElement,'part')
    .find(n=>n.getAttribute('id')===partId);
  const measure=children(part,'measure')[measureIndex];
  const note=children(measure,'note')[eventIndex];
  if(!part||!measure||!note)reject('악보에서 선택한 음표를 찾지 못했습니다.');
  const audit=inspectAdvancedMeasure(doc,partId,measureIndex);
  if(audit.reason)reject('기존 마디의 박자 구조가 보호되어 있습니다: '+audit.reason);
  const event=audit.events[eventIndex];
  if(!event||event.rest||event.chord||!first(note,'pitch')||
    first(note,'grace')||first(note,'unpitched'))
    reject('일반 선율 음표에서 가사를 입력할 수 있습니다. 쉼표·화음 구성 음표는 제외됩니다.');
  return {part,measure,note,event,audit};
}

export function readInlineLyric(doc,position,{verse=1}={}){
  const number=Number(verse);
  if(!valid(number,1,12))reject('가사 절은 1~12 사이여야 합니다.');
  const {note,event}=lookup(doc,position);
  const existing=children(note,'lyric')
    .filter(n=>(n.getAttribute('number')||'1')===String(number));
  if(existing.length>1)reject('중복된 절 가사가 있어 편집하지 않습니다.');
  const lyric=existing[0]||null;
  if(lyric&&([...lyric.attributes].some(a=>a.name!=='number')||
    [...lyric.children].some(n=>!['syllabic','text','extend'].includes(n.localName))||
    children(lyric,'text').length>1||children(lyric,'syllabic').length>1||
    children(lyric,'extend').length>1))
    reject('복합 가사 표기는 직접 수정하지 않고 보호합니다.');
  if(!lyric&&tiedStop(note))
    reject('붙임줄로 이어진 음표에는 새로운 가사를 입력하지 않습니다. 첫 음표를 선택해 주세요.');
  return {
    partId:position.partId,measureIndex:position.measureIndex,eventIndex:position.eventIndex,
    voice:event.voice,staff:event.staff,verse:number,
    text:text(lyric,'text'),syllabic:text(lyric,'syllabic')||'single',
    extend:first(lyric,'extend')?.getAttribute('type')||'none',
    exists:!!lyric,tiedContinuation:tiedStop(note),
  };
}

export function nextInlineLyricPosition(doc,position,{verse=1}={}){
  const current=readInlineLyric(doc,position,{verse});
  const part=children(doc.documentElement,'part')
    .find(n=>n.getAttribute('id')===position.partId);
  const measures=children(part,'measure');
  if(measures.length>3000)reject('음표 수가 많아 다음 가사 위치를 찾을 수 없습니다.');
  for(let i=position.measureIndex;i<measures.length;i++){
    const audit=inspectAdvancedMeasure(doc,position.partId,i);
    if(audit.reason)reject('다음 마디의 성부 정보를 확인할 수 없습니다: '+audit.reason);
    const nodes=children(measures[i],'note');
    for(const event of audit.events){
      if(i===position.measureIndex&&event.eventIndex<=position.eventIndex)continue;
      if(event.voice!==current.voice||event.staff!==current.staff||event.rest||
        event.chord||!first(nodes[event.eventIndex],'pitch')||tiedStop(nodes[event.eventIndex]))
        continue;
      const candidate={partId:position.partId,measureIndex:i,eventIndex:event.eventIndex};
      // A complex lyric on the next note is not silently overwritten. Let
      // the caller surface an explicit error instead of skipping across it.
      readInlineLyric(doc,candidate,{verse});
      return candidate;
    }
  }
  return null;
}

export function smartLyricTokens(value){
  if(typeof value!=='string'||!value.trim())return [];
  return parseBatchLyrics(value);
}
