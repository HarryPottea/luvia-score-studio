// Inspect final rendered OSMD SVG pages for ink outside their own viewBox.
// SVG bbox is in local coordinate units and includes text, paths, glyphs,
// barlines and ornaments supported by the renderer. Failures to measure are
// explicitly UNKNOWN, never certified as inside bounds. Read-only audit.
const fail=message=>{throw new Error(message);};
const finite=n=>typeof n==='number'&&Number.isFinite(n);
function bounds(svg){
  let box=null;
  const attr=svg.getAttribute?.('viewBox');
  if(typeof attr==='string'&&attr.trim()){
    const values=attr.trim().split(/[\s,]+/).map(Number);
    if(values.length===4&&values.every(finite)&&values[2]>0&&values[3]>0)
      box={x:values[0],y:values[1],width:values[2],height:values[3]};
  }
  if(!box){
    const v=svg.viewBox?.baseVal;
    if(v&&[v.x,v.y,v.width,v.height].every(finite)&&v.width>0&&v.height>0)
      box={x:v.x,y:v.y,width:v.width,height:v.height};
  }
  if(!box){
    const w=svg.getAttribute?.('width'),h=svg.getAttribute?.('height');
    if(/^\d+(?:\.\d+)?(?:px)?$/.test(w||'')&&
       /^\d+(?:\.\d+)?(?:px)?$/.test(h||''))
      box={x:0,y:0,width:parseFloat(w),height:parseFloat(h)};
  }
  return box;
}
export function inspectSvgPageBounds(pages,{tolerance=2,maxPages=80}={}){
  if(!Array.isArray(pages)||pages.length<1||pages.length>maxPages||
     !finite(tolerance)||tolerance<0||tolerance>20||
     !Number.isSafeInteger(maxPages)||maxPages<1||maxPages>80)
    fail('SVG 페이지 경계 검사 옵션이 올바르지 않습니다.');
  let measuredPages=0,unknownPages=0,overflowPages=0;
  const details=[];
  for(const [index,page] of pages.entries()){
    if(page?.localName!=='svg')fail('페이지 경계 검사는 SVG만 처리합니다.');
    const view=bounds(page);
    let ink=null;
    try{ink=page.getBBox?.();}catch{}
    if(!view||!ink||![ink.x,ink.y,ink.width,ink.height].every(finite)||
       ink.width<=0||ink.height<=0){
      unknownPages++;continue;
    }
    measuredPages++;
    const over={
      left:Math.max(0,view.x-ink.x),
      top:Math.max(0,view.y-ink.y),
      right:Math.max(0,ink.x+ink.width-(view.x+view.width)),
      bottom:Math.max(0,ink.y+ink.height-(view.y+view.height))
    };
    if(Object.values(over).some(v=>v>tolerance)){
      overflowPages++;
      if(details.length<12)
        details.push({page:index+1,...Object.fromEntries(
          Object.entries(over).map(([k,v])=>[k,Math.round(v*100)/100]))});
    }
  }
  return {measuredPages,unknownPages,overflowPages,details,
    complete:unknownPages===0,overflowFreeCertified:false,
    status:unknownPages?'PARTIALLY_MEASURED':overflowPages?'OVERFLOW_DETECTED':'NO_DETECTED_OVERFLOW'};
}
