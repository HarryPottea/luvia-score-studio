// MusicXML-aware automatic system/page break planner.
//
// This is a spacing heuristic, not a collision-free engraver. All markup is
// preserved except explicitly computed print new-system/new-page flags.
const all=(n,t)=>n?[...n.children].filter(c=>c.localName===t):[];
const first=(n,t)=>all(n,t)[0]||null;
const valid=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const fail=text=>{throw new Error(text);};
const text=(n,t)=>first(n,t)?.textContent?.trim()||'';
function measureWidth(row){
  let total=0;
  for(const bar of row){
    const notes=all(bar,'note');
    // The densest simultaneous stave generally dictates shared system width.
    const actualNotes=notes.filter(n=>!first(n,'chord')).length;
    const chords=notes.filter(n=>first(n,'chord')).length;
    const lyrics=notes.flatMap(n=>all(n,'lyric'))
      .map(n=>[...text(n,'text')].length);
    const lyricsMax=Math.max(0,...lyrics),lyricsTotal=lyrics.reduce((a,b)=>a+b,0);
    const harmonies=all(bar,'harmony').length;
    const expressions=all(bar,'direction').length;
    const weight=7+3.1*actualNotes+1.4*chords+
      1.2*harmonies+0.8*expressions+0.85*lyricsMax+
      0.1*lyricsTotal+all(bar,'attributes').length*3;
    total=Math.max(total,weight);
  }
  return Math.max(8,Math.min(120,total));
}
function staffCount(part){
  let staves=1;
  for(const bar of all(part,'measure')){
    for(const attrs of all(bar,'attributes')){
      const n=Number(text(attrs,'staves'));
      if(valid(n,1,16))staves=Math.max(staves,n);
    }
    for(const note of all(bar,'note')){
      const n=Number(text(note,'staff'));
      if(valid(n,1,16))staves=Math.max(staves,n);
    }
  }
  return staves;
}
function breaksAt(score){
  const printed=[];
  for(const bar of all(score,'measure')){
    const prints=all(bar,'print');
    if(prints.length>1)fail('복수의 print 지정이 있는 마디는 자동 조판하지 않습니다.');
    printed.push(prints[0]?.getAttribute('new-page')==='yes'?'page':
      prints[0]?.getAttribute('new-system')==='yes'?'system':'none');
  }
  return printed;
}
export function planDensityLayout(source,{pageFormat='A4_P',
  replaceExisting=false}={}){
  if(!['A4_P','A4_L'].includes(pageFormat)||typeof replaceExisting!=='boolean')
    fail('용지 방향 또는 기존 인쇄 지시 처리 옵션이 올바르지 않습니다.');
  if(source?.documentElement?.localName!=='score-partwise')
    fail('MusicXML partwise 악보만 자동 조판할 수 있습니다.');
  const parts=all(source.documentElement,'part');
  const rows=parts.map(p=>all(p,'measure'));
  const len=rows[0]?.length||0;
  if(!len||len>300||parts.length>12||rows.some(row=>row.length!==len))
    fail('자동 줄 나눔은 1~12개 악기·300마디 이하의 동일 길이 악보를 지원합니다.');
  const staves=parts.reduce((n,p)=>n+staffCount(p),0);
  if(staves>16)fail('자동 조판에 포함된 총 보표 수가 너무 많습니다.');
  const widths=Array.from({length:len},(_,i)=>measureWidth(rows.map(r=>r[i])));
  const capacity=pageFormat==='A4_L'?116:84;
  const maxBars=pageFormat==='A4_L'?7:6;
  const systemsPerPage=Math.max(1,Math.min(7,
    Math.floor((pageFormat==='A4_L'?17:28)/(Math.max(2,staves*2.5)+2))));
  const starts=[0],systemWeights=[],systemBars=[];
  let width=0,numBars=0;
  for(let i=0;i<len;i++){
    const next=widths[i];
    if(i>0&&(width+next>capacity||numBars>=maxBars)){
      systemWeights.push(width);systemBars.push(numBars);
      starts.push(i);width=0;numBars=0;
    }
    width+=next;numBars++;
  }
  systemWeights.push(width);systemBars.push(numBars);
  const expected=Array(len).fill('none');
  for(let i=1;i<starts.length;i++)
    expected[starts[i]]=i%systemsPerPage===0?'page':'system';
  for(let p=0;p<parts.length;p++){
    const previous=breaksAt(parts[p]);
    for(let i=1;i<len;i++){
      if(previous[i]!=='none'&&!replaceExisting&&previous[i]!==expected[i])
        fail((i+1)+'마디에 기존 수동 페이지·줄 나눔이 있어 자동 배치를 차단했습니다.');
    }
  }
  return {pageFormat,totalMeasures:len,parts:parts.length,totalStaves:staves,
    widths,capacity,systemStarts:starts,systems:starts.length,
    systemsPerPage,pages:Math.ceil(starts.length/systemsPerPage),
    systemWeights,systemBars,expected,
    kind:'DENSITY_HEURISTIC_NOT_COLLISION_CERTIFIED'};
}
function make(bar,tag){
  const doc=bar.ownerDocument;
  return doc.createElementNS?
    doc.createElementNS(bar.namespaceURI??null,tag):doc.createElement(tag);
}
export function applyDensityLayout(source,options={}){
  const plan=planDensityLayout(source,options),doc=source.cloneNode(true);
  for(const part of all(doc.documentElement,'part')){
    const measures=all(part,'measure');
    for(let i=1;i<measures.length;i++){
      const bar=measures[i],expected=plan.expected[i];
      let print=first(bar,'print');
      if(!print&&expected==='none')continue;
      if(!print){
        print=make(bar,'print');
        // MusicXML 4.0 print is allowed before attributes and directions.
        bar.insertBefore(print,bar.firstChild);
      }
      print.removeAttribute('new-page');print.removeAttribute('new-system');
      if(expected==='page')print.setAttribute('new-page','yes');
      else if(expected==='system')print.setAttribute('new-system','yes');
      if(!print.attributes.length&&!print.children.length)bar.removeChild(print);
    }
  }
  return {doc,change:{action:'density-automatic-layout',systems:plan.systems,
    pagesEstimated:plan.pages,staves:plan.totalStaves,
    collisionVerified:false}};
}
