// Closed-boundary check for complete MusicXML measures.
//
// Connections may be copied/deleted as a whole only when their start and stop
// are entirely inside the selected region. Inserting through an open connection
// is blocked. Untouched notes, parts, and links never need to be rewritten.
const all=(n,tag)=>n?[...n.children].filter(c=>c.localName===tag):[];
const first=(n,tag)=>all(n,tag)[0]||null;
const val=(n,tag)=>first(n,tag)?.textContent?.trim()||'';
const reject=reason=>{throw new Error(reason);};
const unsupported=new Set([
  'pedal','octave-shift','dashes','glissando','slide','bracket',
  'ending','repeat','segno','coda','dalsegno','dacapo','fine'
]);
function hasUnsupported(node){
  if(!node)return false;
  for(const c of node.children){
    if(unsupported.has(c.localName)||hasUnsupported(c))return true;
  }
  return false;
}
function eventsAtMeasure(measure){
  const events=[];
  for(const [order,node] of [...measure.children].entries()){
    if(node.localName==='note'){
      const voice=val(node,'voice')||'1';
      const staff=val(node,'staff')||'1';
      const pitch=first(node,'pitch');
      const pitchKey=val(pitch,'step')+'|'+(val(pitch,'alter')||'0')+'|'+val(pitch,'octave');
      const noteKey=voice+'|'+staff+'|'+pitchKey;
      const sound=all(node,'tie'),written=all(first(node,'notations'),'tied');
      if((sound.length||written.length)&&(!pitch||!val(pitch,'step')||!val(pitch,'octave')))
        reject('붙임줄의 음정을 확인할 수 없습니다.');
      for(const link of sound)events.push({order,family:'sound-tie',key:noteKey,type:link.getAttribute('type')});
      for(const link of written)events.push({order,family:'written-tie',key:noteKey,type:link.getAttribute('type')});
      for(const link of all(first(node,'notations'),'slur'))
        events.push({order,family:'slur',key:voice+'|'+staff+'|'+(link.getAttribute('number')||'1'),
          type:link.getAttribute('type')});
      for(const link of all(first(node,'notations'),'tuplet'))
        events.push({order,family:'tuplet',key:voice+'|'+staff+'|'+(link.getAttribute('number')||'1'),
          type:link.getAttribute('type')});
    }
    if(node.localName==='direction'){
      for(const directionType of all(node,'direction-type'))for(const wedge of all(directionType,'wedge'))
        events.push({order,family:'wedge',key:wedge.getAttribute('number')||'1',type:wedge.getAttribute('type')});
    }
  }
  return events;
}
function eventRank(e){return e.type==='stop'?0:e.type==='start'?1:2;}
function consume(open,events){
  // A single note can close a previous tie and start its continuation.
  for(const e of events.slice().sort((a,b)=>a.order-b.order||eventRank(a)-eventRank(b))){
    if(!['start','stop','continue'].includes(e.type)||
      e.type==='continue'&&(e.family==='sound-tie'||e.family==='written-tie'))
      reject('알 수 없는 악상 연결 표기를 자동 편집하지 않습니다.');
    const key=e.family+':'+e.key;
    if(e.type==='start'){
      if(open.has(key))reject('연결 기호의 시작이 중복되어 편집을 중단했습니다.');
      open.add(key);
    }else if(e.type==='stop'){
      if(!open.has(key))reject('연결 기호의 끝이 앞부분과 맞지 않습니다.');
      open.delete(key);
    }else if(!open.has(key)){
      reject('셈여림 연결 표기의 이전 시작점을 찾지 못했습니다.');
    }
  }
}
function statesForPart(part,affected=()=>false){
  const bars=all(part,'measure'),open=new Set(),seams=[new Set()];
  // A malformed sequence in the surrounding score is not safe to move.
  for(const [index,bar] of bars.entries()){
    // Unchanged measures may contain repeat/pedal marks. They do not make a
    // disjoint deletion unsafe; only marks on the edited measures do.
    if(affected(index)&&hasUnsupported(bar))
      reject((index+1)+'마디에 반복·페달·기타 고급 연결 표기가 있어 삭제를 보호합니다.');
    consume(open,eventsAtMeasure(bar));
    seams.push(new Set(open));
  }
  if(open.size)reject('종료되지 않은 붙임줄·이음줄·악상 연결이 있는 악보를 보호합니다.');
  return seams;
}
export function assertClosedMeasureBoundary(parts,index){
  if(!Number.isSafeInteger(index)||index<0)reject('마디 경계가 잘못되었습니다.');
  for(const part of parts){
    const seams=statesForPart(part,i=>i===index-1||i===index);
    if(index>=seams.length)reject('마디 경계가 악보 범위 밖입니다.');
    if(seams[index].size)reject('선택 경계에 마디를 가로지르는 붙임줄·이음줄·셈여림이 있습니다.');
  }
}
export function assertClosedMeasureRange(parts,start,end){
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start)
    reject('연결 검사를 수행할 마디 범위가 올바르지 않습니다.');
  for(const part of parts){
    const seams=statesForPart(part,i=>i>=start&&i<=end);
    if(end+1>=seams.length)reject('선택한 마디가 악보 범위 밖입니다.');
    if(seams[start].size||seams[end+1].size)
      reject('선택 구간 밖으로 이어지는 붙임줄·이음줄·셈여림이 있습니다.');
  }
}
