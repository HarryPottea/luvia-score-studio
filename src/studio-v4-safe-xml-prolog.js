// Stage 6: explicit MusicXML prolog security / loss-prevention policy.
// External PUBLIC DTD declarations are common in Logic, Finale and W3C
// MusicXML exports. Remove only the prolog DTD declaration so the browser
// XML parser never resolves external resources. Internal entity subsets or
// unexpected DTDs are rejected rather than silently rewriting source data.
const fail=msg=>{throw new Error(msg);};
export function stripExternalMusicXmlDoctype(raw){
  if(typeof raw!=='string'||!raw||raw.length>35*1024*1024)
    fail('MusicXML 입력 크기 또는 형식이 올바르지 않습니다.');
  let pos=raw.charCodeAt(0)===0xfeff?1:0,found=false,result=raw;
  const skipWhitespace=()=>{while(pos<raw.length&&/\s/.test(raw[pos]))pos++;};
  while(pos<raw.length){
    skipWhitespace();
    if(raw.startsWith('<?',pos)){
      const end=raw.indexOf('?>',pos+2);
      if(end<0)fail('XML 선언을 정상적으로 닫지 못했습니다.');
      pos=end+2;continue;
    }
    if(raw.startsWith('<!--',pos)){
      const end=raw.indexOf('-->',pos+4);
      if(end<0)fail('MusicXML 주석이 닫히지 않았습니다.');
      pos=end+3;continue;
    }
    if(raw.startsWith('<!DOCTYPE',pos)){
      if(found)fail('MusicXML 문서에 DOCTYPE이 중복됐습니다.');
      found=true;
      const start=pos;
      pos+=9;
      let quoted=null,closed=false;
      for(;pos<raw.length;pos++){
        const ch=raw[pos];
        if(quoted){if(ch===quoted)quoted=null;continue;}
        if(ch==='"'||ch==="'"){quoted=ch;continue;}
        if(ch==='['||ch===']')
          fail('내부 DTD/ENTITY가 있는 MusicXML은 보안상 직접 가져올 수 없습니다.');
        if(ch==='>'){pos++;closed=true;break;}
      }
      if(!closed)fail('DOCTYPE 선언이 닫히지 않았습니다.');
      const declaration=raw.slice(start,pos);
      if(!/^<!DOCTYPE\s+score-partwise\s+(?:PUBLIC\s+("[^"]*"|'[^']*')\s+("[^"]*"|'[^']*')|SYSTEM\s+("[^"]*"|'[^']*'))\s*>$/i.test(declaration))
        fail('예상하지 않은 MusicXML DTD 선언 형식입니다.');
      result=raw.slice(0,start)+raw.slice(pos);
      continue;
    }
    break;
  }
  if(/<!DOCTYPE\b|<!ENTITY\b/i.test(result))
    fail('MusicXML에 안전하게 제거할 수 없는 XML DTD 또는 ENTITY 선언이 있습니다.');
  return result;
}
