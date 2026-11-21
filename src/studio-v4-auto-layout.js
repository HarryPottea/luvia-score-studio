// MusicXML-aware automatic system/page break planner.
import {assertScopedScoreMutation} from './studio-v4-structural-guard.js';
import {balanceMusicSystems} from './studio-v4-system-balance.js';
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
    const expressions=all(bar,'direction');
    const expressionCharacters=expressions.reduce((n,d)=>
      n+[...d.textContent].length,0);
    const ornaments=notes.reduce((n,note)=>{
      const notations=first(note,'notations');
      return n+all(notations,'ornaments').reduce((m,g)=>m+g.children.length,0)+
        all(notations,'articulations').reduce((m,g)=>m+g.children.length,0);
    },0);
    const accidentals=notes.filter(n=>first(n,'accidental')).length;
    // Horizontal pressure is estimated from real lyrical, harmonic and
    // expression markup, not only nominal note counts. The actual SVG audit
    // below remains authoritative for supported measured collisions.
    const weight=7+3.1*actualNotes+1.4*chords+
      1.2*harmonies+1.4*expressions.length+
      0.28*Math.min(90,expressionCharacters)+1.1*ornaments+
      1.15*accidentals+1.65*lyricsMax+
      0.18*lyricsTotal+all(bar,'attributes').length*3;
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
// Preserve continuity when possible: a line break inside an open tie/slur or
// hairpin is not necessarily invalid MusicXML, but is a worse engraving choice.
// These are soft costs: long connecting phrases can still cross systems.
function connectionPenalties(parts,length){
  const seams=Array(length+1).fill(0);
  for(const part of parts){
    const open=new Set();
    for(const [i,bar] of all(part,'measure').entries()){
      for(const item of bar.children){
        const markers=[];
        if(item.localName==='note'){
          const voice=text(item,'voice')||'1',staff=text(item,'staff')||'1';
          const pitch=first(item,'pitch');
          const pitchKey=[voice,staff,text(pitch,'step'),
            text(pitch,'alter')||'0',text(pitch,'octave')].join('/');
          const sounding=all(item,'tie');
          const tied=sounding.length?sounding:all(first(item,'notations'),'tied');
          for(const t of tied)markers.push(['tie:'+pitchKey,t.getAttribute('type')]);
          for(const slur of all(first(item,'notations'),'slur'))
            markers.push(['slur:'+voice+':'+staff+':'+(slur.getAttribute('number')||'1'),
              slur.getAttribute('type')]);
        }
        if(item.localName==='direction'){
          for(const kind of all(item,'direction-type'))
            for(const wedge of all(kind,'wedge')){
              const type=wedge.getAttribute('type');
              markers.push(['wedge:'+(wedge.getAttribute('number')||'1'),
                type==='stop'?'stop':type==='crescendo'||type==='diminuendo'?'start':'continue']);
            }
        }
        // A continuation may stop and start on the same note; preserve it.
        for(const [key,type] of markers)if(type==='stop')open.delete(key);
        for(const [key,type] of markers)if(type==='start')open.add(key);
      }
      if(i+1<length)seams[i+1]+=Math.min(280,open.size*140);
    }
  }
  return seams;
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
  // Multiple lyric verses and above/below-staff expressions need additional
  // vertical clearance; otherwise an A4 page may be filled on paper but clip
  // the final OSMD glyph bounds.
  const verticalExtra=parts.reduce((total,part)=>{
    let verses=0,expression=0;
    for(const bar of all(part,'measure')){
      for(const note of all(bar,'note'))verses=Math.max(verses,all(note,'lyric').length);
      expression=Math.max(expression,all(bar,'direction').length+
        all(bar,'note').reduce((n,note)=>{
          const symbols=first(note,'notations');
          return n+all(symbols,'ornaments').length+all(symbols,'articulations').length;
        },0));
    }
    return total+Math.min(3.5,Math.max(0,verses-1)*.9+
      (verses?0.7:0)+Math.min(1.2,expression*.32));
  },0);
  const systemHeightUnits=Math.max(2,staves*2.5)+2+verticalExtra;
  const systemsPerPage=Math.max(1,Math.min(7,
    Math.floor((pageFormat==='A4_L'?17:28)/systemHeightUnits)));
  const penalties=connectionPenalties(parts,len);
  const sourceBreaks=parts.map(breaksAt);
  const manual=Array(len).fill('none');
  if(!replaceExisting){
    for(let i=1;i<len;i++){
      const declared=new Set(sourceBreaks.map(row=>row[i]).filter(x=>x!=='none'));
      if(declared.size>1)
        fail((i+1)+'마디의 수동 줄·페이지 지시가 파트마다 달라 자동 조판하지 않습니다.');
      manual[i]=[...declared][0]||'none';
    }
  }
  const hardBreaks=manual.map((type,i)=>type==='none'?null:i)
    .filter(i=>i!==null&&i>0);
  const balanced=balanceMusicSystems(widths,{capacity,maxBars,
    breakPenalties:penalties,hardBreaks});
  const starts=balanced.systemStarts,systemWeights=balanced.systemWeights,
    systemBars=balanced.systemBars;
  const expected=Array(len).fill('none');
  let systemsOnPage=0,pages=1;
  for(let k=1;k<starts.length;k++){
    const at=starts[k];
    // Never reinterpret an explicit manual system start as a page break.
    // A4 overflow is independently checked against the rendered page geometry.
    const newPage=manual[at]==='page'||manual[at]!=='system'&&
      systemsOnPage+1>=systemsPerPage;
    expected[at]=newPage?'page':'system';
    if(newPage){pages++;systemsOnPage=0;}
    else systemsOnPage++;
  }
  // An authored new-page is never weakened to a system break.
  for(const at of hardBreaks)if(manual[at]==='page'&&expected[at]!=='page')
    fail('수동 페이지 나눔 보존에 실패했습니다.');
  return {pageFormat,totalMeasures:len,parts:parts.length,totalStaves:staves,
    widths,capacity,systemStarts:starts,systems:starts.length,
    systemsPerPage,pages,manualBreaks:hardBreaks,manualPages:hardBreaks.filter(i=>manual[i]==='page'),
    systemWeights,systemBars,expected,breakPenaltyTotal:penalties.reduce((a,b)=>a+b,0),
    balancePolicy:balanced.policy,
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
  assertScopedScoreMutation(source,doc,{partIds:all(doc.documentElement,'part')
    .map(p=>p.getAttribute('id')),start:0,end:plan.totalMeasures-1,kind:'layout'});
  return {doc,change:{action:'density-automatic-layout',systems:plan.systems,
    pagesEstimated:plan.pages,staves:plan.totalStaves,
    collisionVerified:false}};
}


// Parts may have very different engraving densities (for example, a Korean
// vocal lyric line versus an instrumental rest-heavy score). Independent part
// layout intentionally gives each player different system/page turns instead
// of forcing the full-score cadence on every extracted part.
export function planIndependentPartLayout(source,options={}){
  if(source?.documentElement?.localName!=='score-partwise')
    fail('MusicXML partwise 악보만 파트별 조판할 수 있습니다.');
  const parts=all(source.documentElement,'part');
  if(!parts.length||parts.length>12)
    fail('개별 파트 자동 조판은 1~12개 악기만 지원합니다.');
  const ids=parts.map(p=>p.getAttribute('id'));
  if(ids.some(id=>!id)||new Set(ids).size!==ids.length)
    fail('파트 식별자가 중복되거나 비어 있어 개별 조판하지 않습니다.');
  const partPlans=parts.map((part,index)=>{
    // Read-only facade: reuses the same single-part density planning rules.
    const partial={documentElement:{localName:'score-partwise',children:[part]}};
    const plan=planDensityLayout(partial,options);
    return {...plan,partId:ids[index]};
  });
  return {partPlans,parts:partPlans.length,systems:partPlans.reduce((n,p)=>n+p.systems,0),
    pagesEstimated:partPlans.reduce((n,p)=>n+p.pages,0),
    kind:'INDEPENDENT_PART_DENSITY_HEURISTIC_NOT_COLLISION_CERTIFIED'};
}
export function applyIndependentPartLayout(source,options={}){
  const plan=planIndependentPartLayout(source,options),doc=source.cloneNode(true);
  const copies=new Map(all(doc.documentElement,'part').map(p=>[p.getAttribute('id'),p]));
  for(const target of plan.partPlans){
    const part=copies.get(target.partId);
    const measures=all(part,'measure');
    for(let i=1;i<measures.length;i++){
      const bar=measures[i],expected=target.expected[i];
      let print=first(bar,'print');
      if(!print&&expected==='none')continue;
      if(!print){
        print=make(bar,'print');
        bar.insertBefore(print,bar.firstChild);
      }
      print.removeAttribute('new-page');
      print.removeAttribute('new-system');
      if(expected==='page')print.setAttribute('new-page','yes');
      else if(expected==='system')print.setAttribute('new-system','yes');
      if(!print.attributes.length&&!print.children.length)bar.removeChild(print);
    }
  }
  assertScopedScoreMutation(source,doc,{partIds:plan.partPlans.map(p=>p.partId),
    start:0,end:Math.max(...plan.partPlans.map(p=>p.totalMeasures))-1,kind:'layout'});
  return {doc,change:{action:'independent-part-density-layout',parts:plan.parts,
    systems:plan.systems,pagesEstimated:plan.pagesEstimated,collisionVerified:false}};
}
