// The J-WOO copyright refers to the score-editor software and document output,
// not authorship or ownership of the musical work displayed in an imported score.
export const J_WOO_COPYRIGHT='© 2026 PARKJAEWOO. All rights reserved.';
const FORMATS={A4_P:{width:210,height:297},A4_L:{width:297,height:210}};
function viewBoxOf(svg){
  const raw=svg.getAttribute?.('viewBox');
  if(typeof raw==='string'&&raw.trim()){
    const nums=raw.trim().split(/[\s,]+/).map(Number);
    if(nums.length===4&&nums.every(Number.isFinite)&&nums[2]>0&&nums[3]>0)
      return {x:nums[0],y:nums[1],width:nums[2],height:nums[3]};
  }
  const px=s=>/^\d+(?:\.\d+)?(?:px)?$/.test(s||'')?parseFloat(s):NaN;
  const w=px(svg.getAttribute?.('width')),h=px(svg.getAttribute?.('height'));
  if(Number.isFinite(w)&&Number.isFinite(h)&&w>0&&h>0)
    return {x:0,y:0,width:w,height:h};
  throw new Error('저작권 표시에 필요한 SVG 페이지 치수를 확인할 수 없습니다.');
}
export function stampSoftwareCopyright(svgs,pageFormat='A4_P'){
  const format=FORMATS[pageFormat];
  if(!format)throw new Error('저작권 표시에는 A4 세로 또는 가로 규격이 필요합니다.');
  if(!Array.isArray(svgs)||svgs.some(svg=>svg?.localName!=='svg'))
    throw new Error('저작권을 표시할 악보 SVG가 유효하지 않습니다.');
  for(const svg of svgs){
    const box=viewBoxOf(svg);
    const factor=box.height/format.height;
    // A4 engraving reserves 12 mm of margin; the notice baseline is
    // 5.5 mm above the lower edge, outside the notation area.
    const baseline=box.y+box.height-5.5*factor;
    for(const previous of svg.querySelectorAll('[data-jwoo-software-copyright]'))
      previous.remove();
    const text=svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg','text');
    text.setAttribute('data-jwoo-software-copyright','true');
    text.setAttribute('x',String(box.x+box.width/2));
    text.setAttribute('y',String(baseline));
    text.setAttribute('font-size',String(2.25*factor));
    text.setAttribute('font-family','Arial, Helvetica, sans-serif');
    text.setAttribute('font-weight','400');
    text.setAttribute('fill','#454545');
    text.setAttribute('text-anchor','middle');
    text.setAttribute('pointer-events','none');
    text.textContent=J_WOO_COPYRIGHT;
    svg.appendChild(text);
  }
  return svgs.length;
}
