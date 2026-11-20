// Remove a complete MusicXML measure at the same index in every part.
// This is an immutable operation: unsafe structural boundaries are rejected.
const direct=(node,tag)=>node?[...node.children].find(child=>child.localName===tag)||null:null;
const children=(node,tag)=>node?[...node.children].filter(child=>child.localName===tag):[];
const fail=message=>{throw new Error(message);};
const validIndex=value=>Number.isSafeInteger(value)&&value>=0&&value<=20000;
const boundaryTags=new Set([
  'tie','tied','slur','wedge','pedal','octave-shift','dashes',
  'glissando','slide','bracket','ending','repeat','segno','coda',
  'dalsegno','dacapo','fine'
]);
function containsBoundary(node){
  for(const child of node.children){
    if(boundaryTags.has(child.localName)||containsBoundary(child))return true;
  }
  return false;
}
function checkedParts(source,index){
  if(source?.documentElement?.localName!=='score-partwise')
    fail('MusicXML partwise 형식 악보만 마디를 삭제할 수 있습니다.');
  const parts=children(source.documentElement,'part');
  if(!parts.length||parts.length>12)fail('1~12개 파트의 악보만 지원합니다.');
  const bars=parts.map(part=>children(part,'measure'));
  const length=bars[0].length;
  if(length<=1)fail('악보에 최소 1마디는 남겨야 합니다.');
  if(!validIndex(index)||index>=length)fail('삭제할 마디를 다시 선택해 주세요.');
  if(bars.some(items=>items.length!==length))
    fail('파트별 마디 수가 달라 삭제하지 않았습니다.');
  // Nonstandard measure numbers (e.g. 3a) may encode editorial identities.
  // Never rewrite those labels to ordinary numeric measure numbers.
  const original=bars[0].map(m=>m.getAttribute('number'));
  if(original.some(value=>!/^(0|[1-9]\d*)$/.test(value??'')))
    fail('특수 마디 번호를 가진 악보는 자동 재번호 지정하지 않습니다.');
  const start=Number(original[0]);
  if(!Number.isSafeInteger(start)||original.some((value,i)=>Number(value)!==start+i)||
    bars.some(items=>items.some((bar,i)=>bar.getAttribute('number')!==original[i])))
    fail('파트별 마디 번호가 연속적으로 일치하지 않아 삭제하지 않았습니다.');
  for(const items of bars){
    const removed=items[index];
    if(containsBoundary(removed))
      fail((index+1)+'마디에 붙임줄·이음줄·반복·연결 악상 등 보호할 구조가 있습니다. 먼저 연결을 정리해 주세요.');
    if(index>0&&children(removed,'attributes').length)
      fail((index+1)+'마디에 조표·박자표·보표 설정 변경이 있어 삭제를 차단했습니다.');
    if(index===0){
      if(children(removed,'attributes').length>1)
        fail('첫 마디에 여러 속성 변경이 있어 안전하게 옮길 수 없습니다.');
      if(direct(removed,'attributes')&&children(items[1],'attributes').length)
        fail('두 번째 마디에도 조표·박자표 설정이 있어 첫 마디 속성을 자동 이동하지 않습니다.');
    }
    if(index===length-1){
      const nextFinal=children(removed,'barline').filter(bar=>bar.getAttribute('location')!=='left');
      const previousFinal=children(items[index-1],'barline').filter(bar=>bar.getAttribute('location')!=='left');
      if(nextFinal.length>1||(nextFinal.length&&previousFinal.length))
        fail('끝마디 종지선이 중복될 위험이 있어 삭제하지 않았습니다.');
    }
  }
  return {parts,bars,length,start};
}
export function deleteScoreMeasure(source,{measureIndex}={}){
  const {length,start}=checkedParts(source,measureIndex);
  const doc=source.cloneNode(true);
  for(const part of children(doc.documentElement,'part')){
    const bars=children(part,'measure');
    const removed=bars[measureIndex];
    if(measureIndex===0){
      // A generated score stores essential key/meter/clef/divisions here.
      // Move the complete initial attributes block to the new first bar.
      const initial=direct(removed,'attributes');
      if(initial){
        const newFirst=bars[1];
        const afterPrint=[...newFirst.children].find(node=>node.localName!=='print')||null;
        newFirst.insertBefore(initial.cloneNode(true),afterPrint);
      }
    }
    if(measureIndex===length-1){
      // Preserve an ordinary final barline when shortening the score.
      for(const barline of children(removed,'barline')){
        if(barline.getAttribute('location')!=='left')bars[measureIndex-1].appendChild(barline.cloneNode(true));
      }
    }
    part.removeChild(removed);
    children(part,'measure').forEach((bar,i)=>bar.setAttribute('number',String(start+i)));
  }
  return {doc,change:{action:'delete-measure',measureIndex,from:length,to:length-1}};
}
