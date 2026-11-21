// Independent, read-only structural mutation guard for MusicXML operations.
// A transformation may alter explicitly declared domains only. Any hidden
// edits to lyrics, timing, voices, staff, part-list, metadata or other measures
// are rejected before a candidate document reaches the editor history.
const nodes=(p,name)=>p?[...p.children].filter(n=>n.localName===name):[];
const fail=message=>{throw new Error(message);};
const normal=(node,mode)=>{
  if(mode==='pitches'&&['pitch','root','bass'].includes(node.localName))
    return [node.localName,'MUSICAL_PITCH_VALUE_ALLOWED'];
  const attributes=[...node.attributes].map(a=>[a.name,a.value])
    .sort((a,b)=>a[0].localeCompare(b[0]));
  const children=[...node.children].filter(c=>
    !(mode==='pitches'&&node.localName==='note'&&c.localName==='accidental')&&
    !(mode==='layout'&&node.localName==='measure'&&c.localName==='print'));
  return [node.localName,attributes,
    children.length?children.map(c=>normal(c,mode)):(node.textContent||'').trim()];
};
const snapshot=(node,mode)=>JSON.stringify(normal(node,mode));
export function assertScopedScoreMutation(original,candidate,{
  partIds=[],start=0,end=0,kind='pitches'
}={}){
  if(original?.documentElement?.localName!=='score-partwise'||
     candidate?.documentElement?.localName!=='score-partwise'||
     !['pitches','layout'].includes(kind)||!Array.isArray(partIds)||
     !Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start)
    fail('보호할 악보의 변경 범위가 올바르지 않습니다.');
  const oldParts=nodes(original.documentElement,'part'),
    newParts=nodes(candidate.documentElement,'part');
  const ids=oldParts.map(p=>p.getAttribute('id'));
  if(!ids.length||ids.some(x=>!x)||new Set(ids).size!==ids.length||
     newParts.length!==ids.length||
     ids.some((id,i)=>newParts[i].getAttribute('id')!==id)||
     partIds.some(id=>!ids.includes(id)))
    fail('편집 후 악기 파트 구조가 달라졌습니다.');
  const parentWithoutParts=root=>[...root.children]
    .filter(n=>n.localName!=='part').map(n=>snapshot(n,'all'));
  if(JSON.stringify(parentWithoutParts(original.documentElement))!==
     JSON.stringify(parentWithoutParts(candidate.documentElement))||
     JSON.stringify([...original.documentElement.attributes].map(a=>[a.name,a.value]).sort())!==
     JSON.stringify([...candidate.documentElement.attributes].map(a=>[a.name,a.value]).sort()))
    fail('편집 대상 외의 악보 제목·악기 목록·메타데이터가 변경됐습니다.');
  const selected=new Set(partIds),changed=[];
  let preserved=0;
  for(let i=0;i<oldParts.length;i++){
    const oldBars=nodes(oldParts[i],'measure'),newBars=nodes(newParts[i],'measure');
    if(oldBars.length!==newBars.length)fail('편집 후 악보 마디 수가 의도치 않게 변경됐습니다.');
    // Any non-measure content in the part must remain byte-semantically identical.
    const other=p=>[...p.children].filter(n=>n.localName!=='measure')
      .map(n=>snapshot(n,'all'));
    if(JSON.stringify(other(oldParts[i]))!==JSON.stringify(other(newParts[i])))
      fail('편집 대상 외 파트 설정이 변경됐습니다.');
    for(let index=0;index<oldBars.length;index++){
      const allowed=selected.has(ids[i])&&index>=start&&index<=end;
      const mode=allowed?kind:'all';
      const oldSig=snapshot(oldBars[index],mode),
        newSig=snapshot(newBars[index],mode);
      if(oldSig!==newSig)
        fail('보존 대상 음악 구조가 변경됐습니다: '+ids[i]+
          ' / '+(index+1)+'마디 ('+kind+')');
      if(allowed)changed.push({partId:ids[i],measureIndex:index});
      else preserved++;
    }
  }
  return {unchangedMeasures:preserved,allowedMeasures:changed.length,
    kind,guardPassed:true};
}
