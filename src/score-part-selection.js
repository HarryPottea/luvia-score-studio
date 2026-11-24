const children=(node,name)=>node?[...node.children].filter(child=>child.localName===name):[];
const first=(node,name)=>children(node,name)[0]||null;

export function listScoreParts(doc){
  if(doc?.documentElement?.localName!=='score-partwise')throw new Error('MusicXML partwise 악보만 지원합니다.');
  const definitions=children(first(doc.documentElement,'part-list'),'score-part');
  const actual=children(doc.documentElement,'part');
  const ids=actual.map(part=>part.getAttribute('id'));
  const definitionIds=definitions.map(part=>part.getAttribute('id'));
  if(!ids.length||ids.some(id=>!id)||new Set(ids).size!==ids.length||
      ids.length!==definitionIds.length||new Set(definitionIds).size!==definitionIds.length||
      definitionIds.some(id=>!ids.includes(id)))
    throw new Error('파트 목록과 실제 악보 파트가 일치하지 않습니다.');
  return definitions.map(def=>({id:def.getAttribute('id'),
    name:first(def,'part-name')?.textContent?.trim()||'이름 없는 파트'}));
}

export function selectScoreParts(doc,selectedIds){
  const parts=listScoreParts(doc),allowed=new Set(parts.map(part=>part.id));
  const selected=new Set(selectedIds);
  if(!selected.size||[...selected].some(id=>!allowed.has(id)))
    throw new Error('불러올 파트를 하나 이상 올바르게 선택해 주세요.');
  const copy=doc.cloneNode(true);
  if(selected.size===parts.length)return copy;
  const list=first(copy.documentElement,'part-list');
  for(const part of children(copy.documentElement,'part'))
    if(!selected.has(part.getAttribute('id')))part.remove();
  for(const def of children(list,'score-part'))
    if(!selected.has(def.getAttribute('id')))def.remove();
  // A filtered set can leave part-group start/stop markers unbalanced.
  for(const group of children(list,'part-group'))group.remove();
  return copy;
}
