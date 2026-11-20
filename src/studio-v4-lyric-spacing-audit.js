// Read-only geometry inspection of SVG-rendered lyrics.
// OSMD applies its own engraving layout; this detects an important class of
// remaining same-line lyric collisions and may request bounded re-engraving.
// It does NOT prove note/rest/slur/hairpin or font-wide collision freedom.
const fail=x=>{throw new Error(x);};
const finite=n=>typeof n==='number'&&Number.isFinite(n);
export function inspectSvgLyricSpacing(svgs,{minimumOverlapPx=1.25,maxLyrics=400}={}){
  if(!Array.isArray(svgs)||svgs.length>80||!finite(minimumOverlapPx)||
     minimumOverlapPx<0.25||minimumOverlapPx>10||
     !Number.isInteger(maxLyrics)||maxLyrics<1||maxLyrics>1000)
    fail('가사 조판 검사의 SVG 페이지와 크기 설정이 올바르지 않습니다.');
  let measured=0,unknown=0,collisions=0;
  const samples=[];
  for(const svg of svgs){
    if(svg?.localName!=='svg'||typeof svg.querySelectorAll!=='function')
      fail('검사할 악보 SVG 페이지가 올바르지 않습니다.');
    // OSMD 1.x marks lyric containers with "osmd-lyrics". Query a few
    // compatible spellings, but never inspect unrelated titles/measure labels.
    const candidates=[...svg.querySelectorAll('.osmd-lyrics text, text.osmd-lyrics, [class*="lyric"] text')];
    const unique=[...new Set(candidates)].filter(node=>node.localName==='text'&&
      String(node.textContent||'').trim());
    if(measured+unique.length>maxLyrics)
      return {measured,unknown,collisions,details:samples,
        status:'MEASUREMENT_LIMIT_EXCEEDED',complete:false};
    const boxes=[];
    for(const [index,node] of unique.entries()){
      let r=null;
      try{r=node.getBoundingClientRect?.();}catch{}
      if(!r||!finite(r.left)||!finite(r.top)||!finite(r.width)||!finite(r.height)||
         r.width<=0||r.height<=0){unknown++;continue;}
      const label=String(node.textContent).trim().slice(0,30);
      boxes.push({left:r.left,right:r.left+r.width,top:r.top,
        bottom:r.top+r.height,height:r.height,label,index});
      measured++;
    }
    boxes.sort((a,b)=>a.left-b.left);
    for(let i=0;i<boxes.length;i++){
      const a=boxes[i];
      for(let j=i+1;j<boxes.length&&boxes[j].left<a.right-minimumOverlapPx;j++){
        const b=boxes[j],x=Math.min(a.right,b.right)-Math.max(a.left,b.left),
          y=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
        // Require substantial vertical overlap; text in different verses,
        // staves or systems is not counted as a lyric collision.
        if(x>minimumOverlapPx&&y>Math.min(a.height,b.height)*.65){
          collisions++;
          if(samples.length<12)samples.push({a:a.label,b:b.label,
            overlapPx:Math.round(x*100)/100});
        }
      }
    }
  }
  return {measured,unknown,collisions,details:samples,
    status:unknown?'PARTIALLY_MEASURED':'MEASURED',complete:unknown===0};
}
export function increaseLyricEngravingSpace(rules,{factor=1.4}={}){
  if(!rules||!finite(factor)||factor<=1||factor>3)
    fail('조판 간격을 안전하게 조절할 수 없습니다.');
  const props=['BetweenSyllableMinimumDistance','HorizontalBetweenLyricsDistance',
    'VerticalBetweenLyricsDistance'];
  let adjusted=0;
  for(const prop of props){
    const old=rules[prop];
    if(finite(old)&&old>=0&&old<30){
      rules[prop]=Math.min(30,old*factor+0.35);
      adjusted++;
    }
  }
  return {adjusted,collisionFreeCertified:false};
}
export async function adaptLyricRendering(osmd,holder,{maxAttempts=2}={}){
  if(typeof osmd?.render!=='function'||typeof holder?.querySelectorAll!=='function'||
     !Number.isSafeInteger(maxAttempts)||maxAttempts<0||maxAttempts>2)
    fail('반복 조판 환경이 준비되지 않았습니다.');
  const count=()=>inspectSvgLyricSpacing([...holder.querySelectorAll('svg')]);
  const original=count();
  let report=original,attempts=0;
  while(report.collisions>0&&attempts<maxAttempts){
    const {adjusted}=increaseLyricEngravingSpace(osmd.EngravingRules);
    if(adjusted===0)break;
    osmd.render();
    attempts++;
    const next=count();
    // Revert only the *result* if spacing worsened. Rendering this score
    // already ran; caller never mutates source MusicXML.
    report=next;
    if(report.status==='MEASUREMENT_LIMIT_EXCEEDED')break;
  }
  return {initial:original.collisions,remaining:report.collisions,
    lyricElements:report.measured,attempts,complete:report.complete,
    collisionFreeCertified:false,status:report.status};
}
