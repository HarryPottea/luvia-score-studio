// MusicXML harmony symbols attached to an explicit melodic note position.
// Immutable transformations; no changes to pitches, rhythm, voices or lyrics.
import {inspectAdvancedMeasure} from './advanced-score.js';

const children=(n,name)=>n?[...n.children].filter(x=>x.localName===name):[];
const child=(n,name)=>children(n,name)[0]||null;
const value=(n,name)=>child(n,name)?.textContent?.trim()||'';
const deny=m=>{throw new Error(m);};
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const KINDS=Object.freeze({
  '': 'major',m:'minor','7':'dominant',maj7:'major-seventh',m7:'minor-seventh',
  mMaj7:'minor-major-seventh','6':'major-sixth',m6:'minor-sixth',
  '9':'dominant-ninth',maj9:'major-ninth',m9:'minor-ninth',
  '11':'dominant-11th','13':'dominant-13th',
  dim:'diminished',dim7:'diminished-seventh',aug:'augmented',
  sus2:'suspended-second',sus4:'suspended-fourth',m7b5:'half-diminished',
  add9:'major',
});
const ALTERS={'#':1,b:-1};
const ACCIDENTAL=n=>n===1?'#':n===-1?'b':'';
const noteNodes=measure=>children(measure,'note');

function validPosition(doc,{partId,measureIndex,eventIndex}={}){
  if(doc?.documentElement?.localName!=='score-partwise')deny('MusicXML partwise 악보만 지원합니다.');
  if(typeof partId!=='string'||!partId||!integer(measureIndex,0,3000)||!integer(eventIndex,0,50000))
    deny('먼저 악보의 코드 위치가 될 음표를 선택해 주세요.');
  const part=children(doc.documentElement,'part').find(p=>p.getAttribute('id')===partId);
  const measure=children(part,'measure')[measureIndex];
  const note=noteNodes(measure)[eventIndex];
  if(!note)deny('선택한 파트·마디·음표를 확인할 수 없습니다.');
  const inspected=inspectAdvancedMeasure(doc,partId,measureIndex);
  const e=inspected.events[eventIndex];
  if(inspected.reason||!e||e.rest||e.chord||!child(note,'pitch')||child(note,'grace')||
    child(note,'cue')||child(note,'unpitched'))
    deny('쉼표·화음 보조음·장식음이나 시간 구조가 불확실한 음표에는 코드를 넣지 않습니다.'+
      (inspected.reason?' '+inspected.reason:''));
  // A chord belongs to the selected note's MusicXML time cursor and staff,
  // never to another part or concurrently sounding voice by inference.
  return {part,measure,note,event:e};
}
function beforeNoteHarmony(note){
  let previous=note.previousElementSibling||note.previousSibling||null;
  let remote=false,harmonies=[];
  while(previous){
    const name=previous.localName;
    if(['note','backup','forward','attributes','barline'].includes(name))break;
    if(name==='harmony')harmonies.push(previous);
    else if(name!=='direction')break;
    if(name==='direction')remote=true;
    previous=previous.previousElementSibling||previous.previousSibling||null;
  }
  if(harmonies.length>1||remote&&harmonies.length)
    deny('기존 코드가 여러 개이거나 다른 지시와 겹쳐 있어 자동으로 수정하지 않습니다.');
  return harmonies[0]||null;
}
function make(parent,name,content){
  const doc=parent.ownerDocument;
  const n=doc.createElementNS?doc.createElementNS(parent.namespaceURI||null,name):doc.createElement(name);
  if(content!==undefined)n.textContent=String(content);
  return n;
}
function pitchMarkup(parent,container,step,alter,prefix){
  const outer=make(parent,container);
  outer.appendChild(make(outer,prefix+'-step',step));
  if(alter)outer.appendChild(make(outer,prefix+'-alter',alter));
  return outer;
}
export function parseChordSymbol(input){
  if(typeof input!=='string'||!input.trim()||[...input].length>24)
    deny('C, Am7, F#maj7, Bb/D 형식으로 코드를 입력해 주세요 (24자 이내).');
  const normalized=input.trim().replace(/[♯＃]/gu,'#').replace(/[♭]/gu,'b');
  const matched=/^([A-G])([#b]?)(mMaj7|m7b5|maj7|maj9|dim7|sus2|sus4|add9|m7|m6|m9|dim|aug|11|13|9|7|6|m)?(?:\/([A-G])([#b]?))?$/i.exec(normalized);
  if(!matched)deny('지원 코드: C, Cm, C7, Cmaj7, Cm7, Cadd9, Csus4, F#dim7, Bb/D 등입니다.');
  const [,root,accidental,rawSuffix='',bass,bassAccidental='']=matched;
  const suffix=Object.keys(KINDS).find(k=>k.toLowerCase()===rawSuffix.toLowerCase());
  if(suffix===undefined)deny('지원하지 않는 코드 종류입니다.');
  const base=root.toUpperCase(),bassName=bass?.toUpperCase()||null;
  const symbol=base+accidental+suffix+(bassName?'/'+bassName+bassAccidental:'');
  return {symbol,root:base,alter:ALTERS[accidental]||0,suffix,kind:KINDS[suffix],
    bass:bassName,bassAlter:ALTERS[bassAccidental]||0};
}
function builtHarmony(note,parsed,staff){
  const harmony=make(note,'harmony');
  harmony.appendChild(pitchMarkup(harmony,'root',parsed.root,parsed.alter,'root'));
  const kind=make(harmony,'kind',parsed.kind);
  kind.setAttribute('text',parsed.suffix);
  harmony.appendChild(kind);
  if(parsed.bass)harmony.appendChild(pitchMarkup(harmony,'bass',parsed.bass,parsed.bassAlter,'bass'));
  if(parsed.suffix==='add9'){
    const degree=make(harmony,'degree');
    degree.appendChild(make(degree,'degree-value',9));
    degree.appendChild(make(degree,'degree-alter',0));
    degree.appendChild(make(degree,'degree-type','add'));
    harmony.appendChild(degree);
  }
  if(staff!=='1')harmony.appendChild(make(harmony,'staff',staff));
  return harmony;
}
function existingSymbol(harmony){
  const allowed=new Set(['root','kind','bass','degree','staff']);
  if(!harmony||harmony.attributes?.length||
      [...harmony.children].some(x=>!allowed.has(x.localName)))return null;
  const root=child(harmony,'root'),kind=child(harmony,'kind'),bass=child(harmony,'bass');
  if(!root||!kind||children(harmony,'root').length!==1||children(harmony,'kind').length!==1||
     children(harmony,'bass').length>1||children(harmony,'staff').length>1)return null;
  const rootStep=value(root,'root-step'),rootAlter=Number(value(root,'root-alter')||0);
  const bassStep=bass?value(bass,'bass-step'):null,bassAlter=Number(value(bass,'bass-alter')||0);
  if(!/^[A-G]$/.test(rootStep)||![-1,0,1].includes(rootAlter)||
    bass&&!/^[A-G]$/.test(bassStep)||![-1,0,1].includes(bassAlter))return null;
  const suffix=Object.keys(KINDS).find(k=>KINDS[k]===kind.textContent.trim()&&
    k===(kind.getAttribute('text')??k)) ??
    Object.keys(KINDS).find(k=>KINDS[k]===kind.textContent.trim()&&k!=='add9');
  if(suffix===undefined)return null;
  const degrees=children(harmony,'degree');
  if(degrees.length&&!(suffix==='add9'&&degrees.length===1&&
    value(degrees[0],'degree-value')==='9'&&value(degrees[0],'degree-alter')==='0'&&
    value(degrees[0],'degree-type')==='add'))return null;
  if(suffix==='add9'&&degrees.length!==1)return null;
  const symbol=rootStep+ACCIDENTAL(rootAlter)+suffix+
    (bassStep?'/'+bassStep+ACCIDENTAL(bassAlter):'');
  return {symbol,staff:value(harmony,'staff')||'1'};
}
export function readChordSymbol(doc,position){
  const {note,event}=validPosition(doc,position);
  const harmony=beforeNoteHarmony(note);
  if(!harmony)return {exists:false,symbol:'',editable:true,voice:event.voice,staff:event.staff};
  const parsed=existingSymbol(harmony);
  return {exists:true,symbol:parsed?.symbol||'',editable:!!parsed,
    voice:event.voice,staff:event.staff};
}
export function editChordSymbol(source,position,{symbol='',mode='set'}={}){
  if(!['set','remove'].includes(mode))deny('코드 편집 요청이 올바르지 않습니다.');
  const parsed=mode==='set'?parseChordSymbol(symbol):null;
  const {note,event}=validPosition(source,position);
  const existing=beforeNoteHarmony(note);
  if(existing&&!existingSymbol(existing))deny('기존의 복잡한 코드 기호는 덮어쓰거나 삭제하지 않습니다.');
  if(mode==='remove'&&!existing)deny('선택한 음표에 삭제할 코드가 없습니다.');
  const candidate=source.cloneNode(true);
  const target=validPosition(candidate,position);
  const prior=beforeNoteHarmony(target.note);
  if(prior)target.measure.removeChild(prior);
  if(parsed)target.measure.insertBefore(builtHarmony(target.note,parsed,event.staff),target.note);
  // No source notes, timing, backup/forward, lyrics, or parts are mutated.
  return {doc:candidate,change:{action:mode==='set'?'chord-symbol-set':'chord-symbol-remove',
    ...position,symbol:parsed?.symbol||''}};
}
