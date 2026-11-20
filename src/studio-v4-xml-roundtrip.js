// Structural MusicXML round-trip verification before file export.
// Uses the browser's XML parser, not HTML parsing. Checks unknown markup,
// lyrics, notes, voices, timings, ties and directions without rewriting them.
// This is a loss-detection guard, NOT MusicXML XSD certification.
const MAX_NODES=350000;
const XMLNS='http://www.w3.org/2000/xmlns/';
const fail=message=>{throw new Error(message);};
const element=node=>node?.nodeType===1;
function attributes(node){
  return [...(node?.attributes||[])]
    .filter(a=>a.namespaceURI!==XMLNS&&a.name!=='xmlns'&&!a.name.startsWith('xmlns:'))
    .map(a=>[a.namespaceURI||'',a.localName||a.name,a.value])
    .sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
function normalizedChildren(node){
  const raw=[...(node?.childNodes||node?.children||[])];
  const hasElements=raw.some(element);
  const nodes=[];
  for(const child of raw){
    if(child.nodeType===3||child.nodeType===4){
      const text=child.nodeValue??child.textContent??'';
      if(hasElements&&/^\s*$/.test(text))continue;
      if(nodes.length&&typeof nodes.at(-1)==='string')
        nodes[nodes.length-1]+=text;
      else nodes.push(text);
    }else if(element(child)||child.nodeType===8)
      nodes.push(child);
    else if(child.nodeType!==7)
      fail('XML 직렬화 검사에서 지원하지 않는 노드 종류를 발견했습니다.');
  }
  return nodes;
}
function sameArray(a,b){
  return JSON.stringify(a)===JSON.stringify(b);
}
export function compareMusicXmlTrees(original,reparsed){
  const a=original?.documentElement||original,b=reparsed?.documentElement||reparsed;
  if(!element(a)||!element(b)||a.localName!=='score-partwise'||b.localName!=='score-partwise')
    return {equal:false,reason:'MusicXML partwise 문서의 루트가 올바르지 않습니다.',path:'/'};
  let checkedNodes=0;
  const tasks=[[a,b,'/score-partwise']];
  while(tasks.length){
    const [left,right,path]=tasks.pop();
    if(++checkedNodes>MAX_NODES)return {equal:false,reason:'비교할 노드가 안전 한도를 초과했습니다.',path};
    if(typeof left==='string'||typeof right==='string'){
      if(left!==right)return {equal:false,reason:'텍스트·가사 내용이 달라졌습니다.',path};
      continue;
    }
    if(left.nodeType!==right.nodeType)
      return {equal:false,reason:'노드 종류가 달라졌습니다.',path};
    if(left.nodeType===8){
      if((left.nodeValue??left.textContent)!==(right.nodeValue??right.textContent))
        return {equal:false,reason:'주석 내용이 달라졌습니다.',path};
      continue;
    }
    if(left.localName!==right.localName||
       (left.namespaceURI||'')!==(right.namespaceURI||''))
      return {equal:false,reason:'MusicXML 요소 또는 네임스페이스가 달라졌습니다.',path};
    if(!sameArray(attributes(left),attributes(right)))
      return {equal:false,reason:'MusicXML 속성값이 달라졌습니다.',path};
    const lc=normalizedChildren(left),rc=normalizedChildren(right);
    if(lc.length!==rc.length)return {equal:false,reason:'음표·성부·기보 하위 요소 수가 달라졌습니다.',path};
    for(let i=lc.length-1;i>=0;i--){
      const child=lc[i];
      tasks.push([child,rc[i],path+'/'+(typeof child==='string'?'#text':child.localName||'#comment')+'['+(i+1)+']']);
    }
  }
  return {equal:true,reason:null,checkedNodes,path:null};
}
export function assertMusicXmlRoundTrip(original,xml,{Parser=globalThis.DOMParser}={}){
  if(typeof xml!=='string'||xml.length>10*1024*1024||
     typeof Parser!=='function')
    fail('MusicXML 재검증에 필요한 XML 데이터 또는 파서가 없습니다.');
  let reparsed;
  try{reparsed=new Parser().parseFromString(xml,'application/xml');}
  catch{fail('MusicXML 재파싱이 실패하여 파일 저장을 중단했습니다.');}
  if(!reparsed?.documentElement||reparsed.querySelector?.('parsererror')||
     reparsed.documentElement.localName==='parsererror')
    fail('저장 전 MusicXML 구문 오류가 발견되었습니다.');
  const report=compareMusicXmlTrees(original,reparsed);
  if(!report.equal)
    fail('MusicXML 저장 검증 실패: '+report.reason+' ('+report.path+')');
  return {...report,roundTripValidated:true,xsdValidated:false};
}
