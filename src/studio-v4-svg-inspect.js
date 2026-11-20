// Read-only browser-SVG safety preflight used by print and PDF exporters.
export function inspectPrintableSvg(svg){
  if(!svg||svg.localName!=='svg')throw new Error('악보 SVG 페이지가 유효하지 않습니다.');
  if(svg.querySelector('script, foreignObject, iframe, image'))
    throw new Error('원격 이미지나 실행 요소가 포함된 SVG는 인쇄하지 않습니다.');
  for(const node of [svg,...svg.querySelectorAll('*')]){
    for(const attr of [...node.attributes]){
      if(/^on/i.test(attr.name))throw new Error('악보 SVG에 이벤트 실행 속성이 있습니다.');
      if(['href','xlink:href','src'].includes(attr.name.toLowerCase())&&
        /^(?:https?:|\/\/|data:|javascript:)/i.test(attr.value.trim()))
        throw new Error('외부 리소스가 참조된 악보 SVG는 인쇄하지 않습니다.');
    }
  }
  return true;
}
