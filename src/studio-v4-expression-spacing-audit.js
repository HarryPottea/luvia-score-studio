// Stage 4 read-only collision audit for OSMD/VexFlow expressive SVG ink.
// Does not claim completeness for unknown glyphs, missing SVG metadata or
// intentional collisions in unsupported engraving categories.
const fail=s=>{throw new Error(s);};
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const EXPRESSIONS='.vf-annotation, .vf-dynamics, .vf-articulation, .vf-ornament, .vf-fermata, .osmd-expression text';
const NOTEHEADS='.vf-notehead';
const LYRICS='.osmd-lyrics text, text.osmd-lyrics, [class*="lyric"] text';
function rectangle(node){
  let box=null;
  try{box=node.getBoundingClientRect?.();}catch{}
  if(!box||![box.left,box.top,box.width,box.height].every(finite)||
     box.width<=0||box.height<=0||box.width>5000||box.height>5000)return null;
  return {left:box.left,right:box.left+box.width,top:box.top,
    bottom:box.top+box.height,height:box.height,width:box.width};
}
function overlap(a,b,minimum,vertical=.35){
  if(!a||!b)return false;
  const x=Math.min(a.right,b.right)-Math.max(a.left,b.left);
  const y=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
  return x>minimum&&y>Math.min(a.height,b.height)*vertical;
}
function nodes(svg,selector){
  const set=[...new Set(svg.querySelectorAll(selector))];
  // Several OSMD versions decorate a parent <g> and its text child with
  // overlapping classes; the outer group must not count as an extra mark.
  return set.filter(item=>!set.some(child=>child!==item&&item.contains?.(child)));
}
export function inspectSvgExpressionSpacing(svgs,{
  minimumOverlapPx=1.25,maxExpressions=1000,maxNoteheads=3000
}={}){
  if(!Array.isArray(svgs)||svgs.length<1||svgs.length>80||
     !finite(minimumOverlapPx)||minimumOverlapPx<.25||minimumOverlapPx>10||
     !Number.isSafeInteger(maxExpressions)||maxExpressions<1||maxExpressions>5000||
     !Number.isSafeInteger(maxNoteheads)||maxNoteheads<1||maxNoteheads>10000)
    fail('표현 기호 SVG 검사 옵션이 유효하지 않습니다.');
  let measured=0,unknown=0,measuredNoteheads=0,unknownNoteheads=0,
    collisions=0,noteheadCollisions=0,lyricCollisions=0,expressionCollisions=0,
    expectedElements=0;
  const details=[];
  for(const [pageIndex,svg] of svgs.entries()){
    if(svg?.localName!=='svg'||typeof svg.querySelectorAll!=='function')
      fail('표현 기호 SVG 페이지가 올바르지 않습니다.');
    const ink=nodes(svg,EXPRESSIONS),heads=nodes(svg,NOTEHEADS),
      lyrics=nodes(svg,LYRICS);
    expectedElements+=ink.length;
    if(expectedElements>maxExpressions||heads.length>maxNoteheads)
      return {status:'MEASUREMENT_LIMIT_EXCEEDED',complete:false,measured,unknown,
        measuredNoteheads,unknownNoteheads,collisions,noteheadCollisions,
        lyricCollisions,expressionCollisions,details};
    const targets=[],noteRects=[],lyricRects=[];
    for(const node of ink){
      const box=rectangle(node);
      if(!box){unknown++;continue;}
      targets.push(box);measured++;
    }
    for(const node of heads){
      const box=rectangle(node);
      if(!box){unknownNoteheads++;continue;}
      noteRects.push(box);measuredNoteheads++;
    }
    for(const node of lyrics){
      const box=rectangle(node);
      if(!box)continue;
      lyricRects.push(box);
    }
    const capture=(type,a,b)=>{
      collisions++;
      if(type==='notehead')noteheadCollisions++;
      if(type==='lyric')lyricCollisions++;
      if(type==='expression')expressionCollisions++;
      if(details.length<24)details.push({page:pageIndex+1,kind:type,
        overlapPx:Math.round((Math.min(a.right,b.right)-Math.max(a.left,b.left))*100)/100});
    };
    for(let i=0;i<targets.length;i++){
      const a=targets[i];
      for(let j=i+1;j<targets.length;j++)if(overlap(a,targets[j],minimumOverlapPx))
        capture('expression',a,targets[j]);
      for(const b of noteRects)if(overlap(a,b,minimumOverlapPx))
        capture('notehead',a,b);
      for(const b of lyricRects)if(overlap(a,b,minimumOverlapPx,.55))
        capture('lyric',a,b);
    }
  }
  return {status:unknown||unknownNoteheads?'PARTIALLY_MEASURED':
    collisions?'COLLISIONS_DETECTED':'NO_DETECTED_COLLISIONS',
    complete:unknown===0&&unknownNoteheads===0,
    measured,unknown,measuredNoteheads,unknownNoteheads,collisions,
    noteheadCollisions,lyricCollisions,expressionCollisions,details};
}
export function increaseExpressionEngravingSpace(rules,{factor=1.28}={}){
  if(!rules||!finite(factor)||factor<=1||factor>2)
    fail('표현 기호 조판 간격 설정이 유효하지 않습니다.');
  let adjusted=0;
  for(const prop of ['MinimumDistanceBetweenSystems','StaffDistance',
    'BetweenStaffDistance','DistanceBetweenStaves','VerticalBetweenLyricsDistance',
    'MinimumDistanceBetweenNotes','ArticulationDistance']){
    const old=rules[prop];
    if(finite(old)&&old>0&&old<=40){
      const next=Math.min(42,old*factor+.25);
      if(next>old){rules[prop]=next;adjusted++;}
    }
  }
  return {adjusted};
}
export async function adaptExpressionRendering(osmd,holder,{maxAttempts=2}={}){
  if(typeof osmd?.render!=='function'||typeof holder?.querySelectorAll!=='function'||
     !Number.isSafeInteger(maxAttempts)||maxAttempts<0||maxAttempts>2)
    fail('기보 기호 자동 재조판 환경이 유효하지 않습니다.');
  const check=()=>inspectSvgExpressionSpacing([...holder.querySelectorAll('svg')]);
  const initial=check();let report=initial,attempts=0;
  while(report.collisions>0&&attempts<maxAttempts){
    if(!increaseExpressionEngravingSpace(osmd.EngravingRules).adjusted)break;
    osmd.render();attempts++;report=check();
    if(report.status==='MEASUREMENT_LIMIT_EXCEEDED')break;
  }
  return {initial:initial.collisions,remaining:report.collisions,
    attempts,measured:report.measured,unknown:report.unknown,
    noteheadCollisions:report.noteheadCollisions,lyricCollisions:report.lyricCollisions,
    expressionCollisions:report.expressionCollisions,complete:report.complete,
    status:report.status,collisionFreeCertified:false};
}
