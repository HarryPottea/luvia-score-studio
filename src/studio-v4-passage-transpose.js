// Chromatic passage transpose over a contiguous selection of measures.
// Preserves voice/staff timing, tuplets, sounding/written ties, lyrics, and
// non-selected parts. Chord symbols and transposing instruments fail closed.
import {assertClosedMeasureRange} from './studio-v4-measure-links.js';

const all=(node,tag)=>node?[...node.children].filter(n=>n.localName===tag):[];
const first=(node,tag)=>all(node,tag)[0]||null;
const text=(node,tag)=>first(node,tag)?.textContent?.trim()||'';
const fail=reason=>{throw new Error(reason);};
const integer=(x,lo,hi)=>Number.isSafeInteger(x)&&x>=lo&&x<=hi;
const semitone=Object.freeze({C:0,D:2,E:4,F:5,G:7,A:9,B:11});
const sharp=Object.freeze([['C',0],['C',1],['D',0],['D',1],['E',0],['F',0],
  ['F',1],['G',0],['G',1],['A',0],['A',1],['B',0]]);
const flat=Object.freeze([['C',0],['D',-1],['D',0],['E',-1],['E',0],
  ['F',0],['G',-1],['G',0],['A',-1],['A',0],['B',-1],['B',0]]);
const noteMIDI=note=>{
  const pitch=first(note,'pitch');
  if(!pitch)return null;
  if([...pitch.children].some(n=>!['step','alter','octave'].includes(n.localName))||
     all(pitch,'step').length!==1||all(pitch,'octave').length!==1||
     all(pitch,'alter').length>1)
    fail('음표의 복합 음정 표기는 이조하지 않습니다.');
  const step=text(pitch,'step'),octaveText=text(pitch,'octave');
  if(!/^(0|[1-9][0-9]*)$/.test(octaveText))fail('음표의 옥타브가 비어 있거나 잘못됐습니다.');
  const octave=Number(octaveText);
  const altered=text(pitch,'alter'),alter=altered===''?0:Number(altered);
  if(!(step in semitone)||!integer(octave,0,9)||!integer(alter,-2,2))
    fail('악보의 음정 또는 옥타브 표기를 확인할 수 없습니다.');
  const midi=(octave+1)*12+semitone[step]+alter;
  if(!integer(midi,0,127))fail('기존 음정이 지원 가능한 범위를 벗어났습니다.');
  return midi;
};
function node(parent,tag,value){
  const d=parent.ownerDocument;
  const n=d.createElementNS?
    d.createElementNS(parent.namespaceURI??null,tag):d.createElement(tag);
  if(value!==undefined)n.textContent=String(value);
  return n;
}
function replacePitch(note,midi,spelling){
  const pitch=first(note,'pitch'),[step,alter]=(spelling==='flat'?flat:sharp)[midi%12];
  const octave=Math.floor(midi/12)-1;
  if(!integer(octave,0,9))fail('이조한 음이 지원 음역 밖입니다.');
  for(const old of [...pitch.children])pitch.removeChild(old);
  pitch.appendChild(node(pitch,'step',step));
  if(alter)pitch.appendChild(node(pitch,'alter',alter));
  pitch.appendChild(node(pitch,'octave',octave));

  const existing=all(note,'accidental');
  const explicitlyMarked=existing.length>0;
  for(const mark of existing)note.removeChild(mark);
  if(alter||explicitlyMarked){
    const style=alter===1?'sharp':alter===-1?'flat':'natural';
    const accidental=node(note,'accidental',style);
    // Accidentals precede time-modification, stem, staff, beams and notations
    // in MusicXML. This also supports ordinary multi-voice/tied notes.
    const before=[...note.children].find(n=>[
      'time-modification','stem','notehead','notehead-text','staff','beam',
      'notations','lyric','play','listen'].includes(n.localName))||null;
    note.insertBefore(accidental,before);
  }
}
function measureList(part){return all(part,'measure');}
export function transposeMeasurePassage(source,{
  start,end,semitones=2,spelling='sharp',partId=null
}={}){
  if(source?.documentElement?.localName!=='score-partwise')
    fail('MusicXML partwise 악보만 이조할 수 있습니다.');
  if(!integer(semitones,-12,12)||semitones===0||!['sharp','flat'].includes(spelling)||
     (partId!==null&&(typeof partId!=='string'||!partId)))
    fail('반음 이동 범위(-12~+12), 변화표 또는 파트 설정을 확인해 주세요.');
  const parts=all(source.documentElement,'part');
  const partIds=parts.map(p=>p.getAttribute('id'));
  if(partIds.some(id=>!id)||new Set(partIds).size!==partIds.length)
    fail('악기 파트 ID가 비어 있거나 중복되어 이조를 보호합니다.');
  const bars=parts.map(measureList);
  if(!parts.length||parts.length>12||!bars[0]?.length||bars[0].length>128||
     bars.some(b=>b.length!==bars[0].length))
    fail('파트별 마디 수가 동일한 1~12파트 악보만 지원합니다.');
  if(!integer(start,0,bars[0].length-1)||!integer(end,start,bars[0].length-1)||
     end-start+1>16)
    fail('한 번에 1~16마디 범위만 이조할 수 있습니다.');
  const selected=parts.filter(p=>partId===null||p.getAttribute('id')===partId);
  if(!selected.length)fail('선택한 악기 파트를 찾을 수 없습니다.');
  // All intact ties/slurs/wedges must remain inside the copied interval.
  assertClosedMeasureRange(selected,start,end);
  const changes=[];
  for(const p of selected){
    if(measureList(p).some(b=>all(b,'attributes').some(a=>first(a,'transpose'))))
      fail('이조 악기는 실제 연주 음정과 기보 음정이 달라 자동 이조를 보호합니다.');
    const pid=p.getAttribute('id');
    for(let index=start;index<=end;index++){
      const bar=measureList(p)[index];
      if(all(bar,'harmony').length)
        fail('선택 범위에 코드 기호가 있습니다. 코드와 음표의 불일치를 피하기 위해 이조를 보호합니다.');
      if(bar.getAttribute('implicit')==='yes'||bar.getAttribute('non-controlling')==='yes')
        fail('못갖춘마디·특수 마디 번호의 이조는 별도 확인이 필요합니다.');
      const notes=all(bar,'note');
      for(const [eventIndex,n] of notes.entries()){
        if(first(n,'rest'))continue;
        if(first(n,'unpitched')||first(n,'grace')||first(n,'cue'))
          fail('타악기·꾸밈음·큐 음표는 일괄 이조하지 않습니다.');
        if(n.attributes?.length||all(n,'accidental').length>1||
           all(n,'accidental').some(a=>a.attributes?.length||a.children.length))
          fail('복합 임시표·음표 속성은 일괄 이조하지 않습니다.');
        const original=noteMIDI(n);
        if(original===null)fail('음표의 음정 데이터가 없습니다.');
        const target=original+semitones;
        if(!integer(target,12,127))
          fail('선택한 음표의 이조 결과가 지원 음역을 벗어납니다.');
        changes.push({pid,index,eventIndex,midi:target});
      }
    }
  }
  if(!changes.length)fail('선택한 구간에 이조할 음표가 없습니다.');
  const doc=source.cloneNode(true);
  const copyParts=new Map(all(doc.documentElement,'part').map(p=>[p.getAttribute('id'),p]));
  for(const change of changes){
    const n=all(measureList(copyParts.get(change.pid))[change.index],'note')[change.eventIndex];
    replacePitch(n,change.midi,spelling);
    if(noteMIDI(n)!==change.midi)
      fail('이조한 음표의 음정 확인에 실패했습니다.');
  }
  return {doc,change:{action:'transpose-measure-passage',partId,start,end,semitones,
    spelling,notes:changes.length,nextMeasureIndex:start,nextEventIndex:0}};
}
