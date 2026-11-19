// J-WOO 4.0 part-synchronized in-score key and meter edits.
// A change to a written score cannot be automated safely without re-barring.
// Therefore the time-signature action only changes an empty-score tail.
const kids=(n,tag)=>n?[...n.children].filter(x=>x.localName===tag):[];
const one=(n,tag)=>kids(n,tag)[0]||null;
const text=(n,tag)=>one(n,tag)?.textContent?.trim()||'';
const fail=s=>{throw new Error(s);};
const valid=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const element=(parent,name,value)=>{
  const d=parent.ownerDocument;
  const node=d.createElementNS?d.createElementNS(parent.namespaceURI||null,name):d.createElement(name);
  if(value!==undefined)node.textContent=String(value);
  return node;
};
function validateDoc(source,index){
  if(source?.documentElement?.localName!=='score-partwise'||!valid(index,0,10000))
    fail('유효한 MusicXML 마디를 선택해 주세요.');
  const parts=kids(source.documentElement,'part');
  if(!parts.length||parts.length>20)fail('조표·박자 변경은 최대 20개 파트에서 지원합니다.');
  const lengths=parts.map(p=>kids(p,'measure').length);
  if(new Set(lengths).size!==1||index>=lengths[0])fail('파트별 마디 수가 일치하지 않습니다.');
  return parts;
}
function createAttributesAtStart(measure){
  let attrs=one(measure,'attributes');
  if(kids(measure,'attributes').length>1)
    fail('한 마디에서 여러 속성이 변경되어 자동 조정하지 않습니다.');
  if(attrs){
    const afterNote=[...measure.children].indexOf(attrs)>[...measure.children].findIndex(x=>x.localName==='note');
    if(afterNote&&[...measure.children].some(x=>x.localName==='note'))
      fail('마디 중간 속성 변경은 수정하지 않습니다.');
    return attrs;
  }
  attrs=element(measure,'attributes');
  const previousPrint=kids(measure,'print').at(0);
  const before=previousPrint?previousPrint.nextSibling:measure.firstChild;
  measure.insertBefore(attrs,before);
  return attrs;
}
function keyAt(attrs){
  let key=one(attrs,'key');
  if(key)return key;
  key=element(attrs,'key');
  const before=one(attrs,'time')||one(attrs,'staves')||one(attrs,'clef');
  attrs.insertBefore(key,before||null);
  return key;
}
export function setKeyAtMeasure(source,{measureIndex=0,fifths=0}={}){
  if(!valid(fifths,-7,7))fail('조표는 플랫 7개부터 샤프 7개 사이여야 합니다.');
  const sourceParts=validateDoc(source,measureIndex);
  for(const part of sourceParts){
    if(kids(part,'measure').some(m=>kids(m,'attributes').some(a=>one(a,'transpose'))))
      fail('이조 악기 파트의 조표 일괄 변경은 별도 검수가 필요합니다.');
    const measure=kids(part,'measure')[measureIndex];
    const existing=one(measure,'attributes'),key=one(existing,'key');
    if(key&&(key.getAttribute('number')||[...key.children].some(n=>!['fifths','mode'].includes(n.localName))))
      fail('복합·보표별 조표는 자동으로 덮어쓰지 않습니다.');
  }
  const doc=source.cloneNode(true);
  for(const part of kids(doc.documentElement,'part')){
    const measure=kids(part,'measure')[measureIndex],attrs=createAttributesAtStart(measure);
    const key=keyAt(attrs);
    let fifth=one(key,'fifths');
    if(!fifth){fifth=element(key,'fifths');key.insertBefore(fifth,key.firstChild);}
    fifth.textContent=String(fifths);
  }
  return {doc,change:{action:'measure-key-signature',measureIndex,fifths}};
}
const supportedMeters={
  '2/4':{type:'half',dots:0},
  '3/4':{type:'half',dots:1},
  '4/4':{type:'whole',dots:0},
  '6/8':{type:'half',dots:1},
  '3/8':{type:'quarter',dots:1},
  '2/2':{type:'whole',dots:0},
};
function beatTypeData(beats,beatType){
  const key=beats+'/'+beatType,record=supportedMeters[key];
  if(!record)fail('빈 마디 박자 변경은 2/4, 3/4, 4/4, 6/8, 3/8, 2/2만 지원합니다.');
  return record;
}
function preflightPart(part,from,beats,beatType){
  let div=0;
  const bars=kids(part,'measure');
  for(let i=0;i<bars.length;i++){
    const m=bars[i];
    for(const a of kids(m,'attributes')){
      const n=Number(text(a,'divisions'));
      if(n){if(!valid(n,1,65536))fail('divisions가 유효하지 않습니다.');div=n;}
    }
    if(i<from)continue;
    if(i>from&&kids(m,'attributes').some(a=>one(a,'time')))
      fail('후속 마디에 박자 변경이 있어 전체 악보를 안전하게 다시 나눌 수 없습니다.');
    const rests=kids(m,'note'),backup=kids(m,'backup');
    if(!rests.length||rests.length>2||backup.length>1||kids(m,'forward').length)
      fail('이미 작성된 다성부가 있는 구간은 자동 박자 변경에서 보호됩니다.');
    for(const note of rests){
      if(!one(note,'rest')||one(note,'pitch')||one(note,'chord')||
        [...note.children].some(x=>!['rest','duration','voice','type','dot','staff'].includes(x.localName)))
        fail('음표·가사·복잡한 표기가 있는 구간은 먼저 전문 리바링이 필요합니다.');
    }
    if(rests.length===2){
      if(backup.length!==1||text(rests[0],'voice')!=='1'||text(rests[0],'staff')!=='1'||
        text(rests[1],'voice')!=='2'||text(rests[1],'staff')!=='2')
        fail('그랜드 스태프의 성부 구조를 안전하게 확인하지 못했습니다.');
    }else if(backup.length)fail('복수 성부 시간 이동이 지원되지 않습니다.');
    const current=Number(text(rests[0],'duration'));
    if(!valid(current,1,500000)||rests.some(n=>Number(text(n,'duration'))!==current)||
      backup.length&&Number(text(backup[0],'duration'))!==current)
      fail('빈 마디의 쉼표·성부 길이가 서로 일치하지 않습니다.');
    if(!div)fail('음표 길이를 계산할 divisions가 없습니다.');
  }
  return true;
}
export function setMeterForEmptyTail(source,{measureIndex=0,beats=3,beatType=4}={}){
  const preset=beatTypeData(Number(beats),Number(beatType));
  const sourceParts=validateDoc(source,measureIndex);
  for(const p of sourceParts)preflightPart(p,measureIndex,beats,beatType);
  const doc=source.cloneNode(true);
  for(const part of kids(doc.documentElement,'part')){
    let divisions=0;
    const bars=kids(part,'measure');
    for(let m=0;m<bars.length;m++){
      const measure=bars[m];
      for(const attrs of kids(measure,'attributes')){
        const d=Number(text(attrs,'divisions'));if(d)divisions=d;
      }
      if(m<measureIndex)continue;
      const ticks=divisions*Number(beats)*4/Number(beatType);
      if(!valid(ticks,1,262144))fail('이 악보의 분할값으로 박자를 정확하게 표현할 수 없습니다.');
      for(const note of kids(measure,'note')){
        one(note,'duration').textContent=String(ticks);
        let typ=one(note,'type');
        if(!typ){typ=element(note,'type');note.insertBefore(typ,one(note,'staff')||null);}
        typ.textContent=preset.type;
        for(const dot of kids(note,'dot'))note.removeChild(dot);
        for(let k=0;k<preset.dots;k++){
          const dot=element(note,'dot');
          note.insertBefore(dot,one(note,'staff')||null);
        }
      }
      for(const backup of kids(measure,'backup'))one(backup,'duration').textContent=String(ticks);
    }
    const first=bars[measureIndex],attrs=createAttributesAtStart(first);
    let time=one(attrs,'time');
    if(!time){
      time=element(attrs,'time');
      attrs.insertBefore(time,one(attrs,'staves')||one(attrs,'clef')||null);
    }
    if(kids(time,'beats').length>1||kids(time,'beat-type').length>1)
      fail('복합 박자 변경은 지원하지 않습니다.');
    let b=one(time,'beats'),t=one(time,'beat-type');
    if(!b){b=element(time,'beats');time.insertBefore(b,time.firstChild);}
    if(!t){t=element(time,'beat-type');time.appendChild(t);}
    b.textContent=String(beats);t.textContent=String(beatType);
  }
  return {doc,change:{action:'empty-tail-meter',measureIndex,beats,beatType}};
}
