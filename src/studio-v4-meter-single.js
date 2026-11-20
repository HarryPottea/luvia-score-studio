// Change a single empty measure's meter, restoring the previous time
// signature at the following measure without re-barring written music.
const all=(n,t)=>n?[...n.children].filter(c=>c.localName===t):[];
const one=(n,t)=>all(n,t)[0]||null;
const txt=(n,t)=>one(n,t)?.textContent?.trim()||'';
const fail=s=>{throw new Error(s);};
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const PRESETS={
  '2/4':['half',0],'3/4':['half',1],'4/4':['whole',0],
  '6/8':['half',1],'3/8':['quarter',1],'2/2':['whole',0],
};
function create(parent,tag,text){
  const d=parent.ownerDocument;
  const n=d.createElementNS?d.createElementNS(parent.namespaceURI??null,tag):d.createElement(tag);
  if(text!==undefined)n.textContent=String(text);
  return n;
}
function atStart(measure){
  let a=one(measure,'attributes');
  if(all(measure,'attributes').length>1)fail('한 마디에 속성 변경이 여러 번 있어 보호합니다.');
  if(a){
    const children=[...measure.children],firstNote=children.findIndex(x=>x.localName==='note');
    if(firstNote>=0&&children.indexOf(a)>firstNote)
      fail('마디 중간의 속성 변경은 자동으로 수정하지 않습니다.');
    return a;
  }
  a=create(measure,'attributes');
  const print=one(measure,'print');
  measure.insertBefore(a,print?print.nextSibling:measure.firstChild);
  return a;
}
function writeTime(measure,beats,beatType){
  const attrs=atStart(measure);
  let time=one(attrs,'time');
  if(!time){
    time=create(attrs,'time');
    attrs.insertBefore(time,one(attrs,'staves')||one(attrs,'clef')||null);
  }
  if([...time.children].some(x=>!['beats','beat-type'].includes(x.localName))||
    all(time,'beats').length>1||all(time,'beat-type').length>1)
    fail('복잡한 복합 박자표는 보수적으로 보호합니다.');
  let b=one(time,'beats'),t=one(time,'beat-type');
  if(!b){b=create(time,'beats');time.insertBefore(b,time.firstChild);}
  if(!t){t=create(time,'beat-type');time.appendChild(t);}
  b.textContent=String(beats);t.textContent=String(beatType);
}
function activeMeter(part,index){
  let divisions=null,beats=null,beatType=null;
  const bars=all(part,'measure');
  for(let i=0;i<=index;i++){
    for(const attrs of all(bars[i],'attributes')){
      if(txt(attrs,'divisions'))divisions=Number(txt(attrs,'divisions'));
      const time=one(attrs,'time');
      if(time){
        beats=Number(txt(time,'beats'));
        beatType=Number(txt(time,'beat-type'));
      }
    }
  }
  if(!integer(divisions,1,65536)||!integer(beats,1,32)||!integer(beatType,1,32))
    fail('원래 박자표·divisions를 확인할 수 없습니다.');
  return {divisions,beats,beatType};
}
export function changeSingleEmptyMeasureMeter(source,{measureIndex,beats=3,beatType=4}={}){
  if(source?.documentElement?.localName!=='score-partwise'||!integer(measureIndex,0,9999)||
    !PRESETS[beats+'/'+beatType])fail('빈 마디의 박자 또는 위치가 지원 범위 밖입니다.');
  const parts=all(source.documentElement,'part');
  const bars=parts.map(p=>all(p,'measure'));
  if(!parts.length||parts.length>20||!bars[0][measureIndex]||
    bars.some(x=>x.length!==bars[0].length))
    fail('모든 파트의 마디 수가 같아야 합니다.');
  const original=parts.map(p=>activeMeter(p,measureIndex));
  if(original.some(x=>x.beats!==original[0].beats||x.beatType!==original[0].beatType))
    fail('악기별 현재 박자표가 달라 변경할 수 없습니다.');
  for(let p=0;p<parts.length;p++){
    const measure=bars[p][measureIndex],m=original[p];
    const oldTicks=m.divisions*m.beats*4/m.beatType;
    const newTicks=m.divisions*Number(beats)*4/Number(beatType);
    if(!integer(oldTicks,1,262144)||!integer(newTicks,1,262144))
      fail('음표의 길이를 정확하게 표현할 수 없습니다.');
    const notes=all(measure,'note'),backups=all(measure,'backup');
    if(![1,2].includes(notes.length)||backups.length!==notes.length-1||
      all(measure,'forward').length||
      [...measure.children].some(c=>!['attributes','print','note','backup'].includes(c.localName)))
      fail('선택한 마디에는 단순한 빈 쉼표만 있어야 합니다.');
    if(notes.length===2&&
      (txt(notes[0],'voice')!=='1'||txt(notes[0],'staff')!=='1'||
      txt(notes[1],'voice')!=='2'||txt(notes[1],'staff')!=='2'))
      fail('그랜드 스태프의 성부 구조를 확인할 수 없습니다.');
    if(notes.some(n=>!one(n,'rest')||n.attributes?.length||one(n,'rest').attributes?.length||
      [...n.children].some(c=>!['rest','duration','voice','type','dot','staff'].includes(c.localName))||
      Number(txt(n,'duration'))!==oldTicks))
      fail('음표·가사 또는 길이가 다른 쉼표가 있어 빈 마디로 처리하지 않습니다.');
    if(backups.some(b=>Number(txt(b,'duration'))!==oldTicks))
      fail('다성부의 이동 박자가 예상과 다릅니다.');
    if(measureIndex+1<bars[p].length){
      const next=bars[p][measureIndex+1];
      if(all(next,'attributes').length>1)fail('다음 마디의 속성이 복잡하여 복원할 수 없습니다.');
      if(!one(one(next,'attributes'),'time')){
        // We will insert a restoring time before existing notes.
        atStart(next.cloneNode(true));
      }
    }
  }
  const doc=source.cloneNode(true);
  for(let p=0;p<parts.length;p++){
    const measure=all(all(doc.documentElement,'part')[p],'measure')[measureIndex];
    const m=original[p],ticks=m.divisions*Number(beats)*4/Number(beatType);
    const [type,dots]=PRESETS[beats+'/'+beatType];
    for(const note of all(measure,'note')){
      one(note,'duration').textContent=String(ticks);
      const mark=one(note,'type')||create(note,'type');
      if(!mark.parentNode)note.insertBefore(mark,one(note,'staff')||null);
      mark.textContent=type;
      for(const dot of all(note,'dot'))note.removeChild(dot);
      for(let i=0;i<dots;i++)note.insertBefore(create(note,'dot'),one(note,'staff')||null);
    }
    for(const backup of all(measure,'backup'))one(backup,'duration').textContent=String(ticks);
    writeTime(measure,beats,beatType);
    const next=all(all(doc.documentElement,'part')[p],'measure')[measureIndex+1];
    if(next&&!one(one(next,'attributes'),'time'))
      writeTime(next,m.beats,m.beatType);
  }
  return {doc,change:{action:'single-empty-bar-meter',measureIndex,beats,beatType,
    restoredAt:measureIndex+1<bars[0].length?measureIndex+1:null}};
}
