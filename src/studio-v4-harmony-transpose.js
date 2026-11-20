// Conservative MusicXML harmony root/bass transposition.
// Only the explicitly supported root and slash-bass notes are rewritten;
// kind, degrees, inversion, staff and other meaning remain byte-equivalent in
// the DOM clone. Unsupported harmony structures are rejected atomically by
// callers rather than leaving chord symbols at an old pitch.
const child=(n,t)=>n?[...n.children].find(x=>x.localName===t)||null:null;
const all=(n,t)=>n?[...n.children].filter(x=>x.localName===t):[];
const fail=message=>{throw new Error(message);};
const CHROMA=Object.freeze({C:0,D:2,E:4,F:5,G:7,A:9,B:11});
const SHARPS=Object.freeze([['C',0],['C',1],['D',0],['D',1],['E',0],['F',0],
  ['F',1],['G',0],['G',1],['A',0],['A',1],['B',0]]);
const FLATS=Object.freeze([['C',0],['D',-1],['D',0],['E',-1],['E',0],
  ['F',0],['G',-1],['G',0],['A',-1],['A',0],['B',-1],['B',0]]);
const ALLOWED_HARMONY=new Set(['root','kind','bass','degree','staff']);
function validatePitch(pitch,prefix){
  if(!pitch||pitch.attributes?.length||pitch.children.length>2||
     pitch.children.some(n=>!new Set([prefix+'-step',prefix+'-alter']).has(n.localName)))
    fail('복잡한 코드 기호의 루트·베이스 구조는 자동 이조하지 않습니다.');
  const stepNodes=all(pitch,prefix+'-step'),alterNodes=all(pitch,prefix+'-alter');
  if(stepNodes.length!==1||alterNodes.length>1||
     stepNodes[0].attributes?.length||stepNodes[0].children.length||
     alterNodes.some(n=>n.attributes?.length||n.children.length))
    fail('코드 음정 구조가 잘못되거나 부가 표시가 있어 보호합니다.');
  const step=stepNodes[0].textContent.trim(),alter=alterNodes.length?
    Number(alterNodes[0].textContent.trim()):0;
  if(!(step in CHROMA)||!Number.isInteger(alter)||alter<-2||alter>2)
    fail('코드 루트 또는 베이스 음정이 지원되지 않습니다.');
  return {step,alter,pitch};
}
function make(parent,name,value){
  const d=parent.ownerDocument,n=d.createElementNS?
    d.createElementNS(parent.namespaceURI??null,name):d.createElement(name);
  n.textContent=String(value);return n;
}
function transposePitch(target,prefix,semitones,spelling){
  const {step,alter}=validatePitch(target,prefix);
  const pc=((CHROMA[step]+alter+semitones)%12+12)%12;
  const [nextStep,nextAlter]=(spelling==='flat'?FLATS:SHARPS)[pc];
  const oldStep=child(target,prefix+'-step');oldStep.textContent=nextStep;
  const oldAlter=child(target,prefix+'-alter');
  if(nextAlter){
    if(oldAlter)oldAlter.textContent=String(nextAlter);
    else target.appendChild(make(target,prefix+'-alter',nextAlter));
  }else if(oldAlter)target.removeChild(oldAlter);
}
export function transposeHarmonyMarkup(harmony,{semitones,spelling='sharp'}={}){
  if(harmony?.localName!=='harmony'||harmony.attributes?.length||
     !Number.isSafeInteger(semitones)||semitones===0||Math.abs(semitones)>12||
     !['sharp','flat'].includes(spelling)||
     harmony.children.some(n=>!ALLOWED_HARMONY.has(n.localName)))
    fail('복잡한 코드 기호 또는 이조 옵션을 안전하게 처리할 수 없습니다.');
  const roots=all(harmony,'root'),kinds=all(harmony,'kind'),
    basses=all(harmony,'bass'),staff=all(harmony,'staff');
  if(roots.length!==1||kinds.length!==1||basses.length>1||staff.length>1||
     kinds[0].textContent.trim()==='none')
    fail('루트가 없거나 특수 화성 기호여서 코드 이조를 중단합니다.');
  // Validate both pitches BEFORE changing either of them. Caller edits a clone.
  validatePitch(roots[0],'root');
  if(basses.length)validatePitch(basses[0],'bass');
  transposePitch(roots[0],'root',semitones,spelling);
  if(basses.length)transposePitch(basses[0],'bass',semitones,spelling);
  return {root:child(roots[0],'root-step').textContent.trim(),
    bass:basses.length?child(basses[0],'bass-step').textContent.trim():null};
}
