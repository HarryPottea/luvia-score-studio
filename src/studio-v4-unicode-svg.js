// Render unsupported Unicode SVG *text only* to local high-resolution PNGs.
// The musical staff, notehead, paths, barlines, and other non-text shapes stay
// vector for svg2pdf. This is a hybrid PDF, not fully vector text.
const NS='http://www.w3.org/2000/svg';
const fail=message=>{throw new Error(message);};
const unicode=text=>/[^\x00-\x7f]/.test(text||'');
const FONT_PROPS=['font-family','font-size','font-weight','font-style','font-stretch',
  'letter-spacing','word-spacing','text-anchor','dominant-baseline','fill','stroke',
  'stroke-width','fill-opacity','opacity'];
const styles=(source,target)=>{
  const computed=getComputedStyle(source);
  for(const prop of FONT_PROPS){
    const value=computed.getPropertyValue(prop);
    if(value)target.style.setProperty(prop,value);
  }
};
async function imageForText(node,{scale=3}={}){
  let box;
  try{box=node.getBBox();}catch{fail('한글 SVG 글자 윤곽을 확인할 수 없습니다.');}
  if(!box||!Number.isFinite(box.x)||!Number.isFinite(box.y)||
    !Number.isFinite(box.width)||!Number.isFinite(box.height)||
    box.width<=0||box.height<=0)
    fail('SVG 글자 영역을 확인할 수 없어 하이브리드 PDF를 중단합니다.');
  const margin=3,bw=box.width+2*margin,bh=box.height+2*margin;
  const pw=Math.ceil(bw*scale),ph=Math.ceil(bh*scale);
  if(pw>4096||ph>4096||pw*ph>7000000)
    fail('글자 이미지가 안전한 크기 제한을 초과합니다.');
  const miniature=document.createElementNS(NS,'svg');
  miniature.setAttribute('xmlns',NS);
  miniature.setAttribute('width',String(pw));
  miniature.setAttribute('height',String(ph));
  miniature.setAttribute('viewBox',[box.x-margin,box.y-margin,bw,bh].join(' '));
  const copy=node.cloneNode(true);
  copy.removeAttribute('transform');
  styles(node,copy);
  const a=[...node.querySelectorAll('tspan')],b=[...copy.querySelectorAll('tspan')];
  for(let i=0;i<Math.min(a.length,b.length);i++)styles(a[i],b[i]);
  miniature.appendChild(copy);
  const markup=new XMLSerializer().serializeToString(miniature);
  const uri=URL.createObjectURL(new Blob([markup],{type:'image/svg+xml'}));
  const image=new Image();
  try{
    image.src=uri;await image.decode();
  }catch{fail('브라우저 글꼴을 이미지로 옮기지 못했습니다. 기존 벡터 인쇄 기능을 사용하세요.');}
  finally{URL.revokeObjectURL(uri);}
  const canvas=document.createElement('canvas');
  canvas.width=pw;canvas.height=ph;
  const ctx=canvas.getContext('2d',{alpha:true});
  if(!ctx)fail('텍스트 렌더링용 캔버스를 사용할 수 없습니다.');
  ctx.drawImage(image,0,0,pw,ph);
  const data=canvas.toDataURL('image/png');
  if(!data.startsWith('data:image/png;base64,'))
    fail('로컬 이미지 변환 결과가 올바르지 않습니다.');
  const replacement=document.createElementNS(NS,'image');
  replacement.setAttribute('x',String(box.x-margin));
  replacement.setAttribute('y',String(box.y-margin));
  replacement.setAttribute('width',String(bw));
  replacement.setAttribute('height',String(bh));
  replacement.setAttribute('href',data);
  replacement.setAttribute('preserveAspectRatio','none');
  const transform=node.getAttribute('transform');
  if(transform)replacement.setAttribute('transform',transform);
  node.parentNode.replaceChild(replacement,node);
}
export async function rasterizeUnicodeSvgText(svg,{maxText=240}={}){
  if(typeof document==='undefined'||typeof Image==='undefined'||
    svg?.localName!=='svg')
    fail('텍스트 변환은 브라우저 SVG에서만 지원합니다.');
  const container=document.createElement('div');
  container.style.cssText='position:fixed;left:-100000px;top:0;'+
    'visibility:hidden;pointer-events:none;z-index:-1;width:900px;';
  document.body.appendChild(container);
  container.appendChild(svg);
  let processed=0;
  try{
    const nodes=[...svg.querySelectorAll('text')].filter(n=>unicode(n.textContent));
    if(nodes.length>maxText)
      fail('한글 글자 요소가 많아 하이브리드 변환 상한을 초과합니다.');
    for(const node of nodes){
      await imageForText(node);
      processed++;
    }
  }finally{container.remove();}
  return {svg,rasterizedTextCount:processed};
}
