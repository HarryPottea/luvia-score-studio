// In-memory snapshots only: no browser storage and no uploads.
export function createEditorHistory(maxEntries=40) {
  if(!Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>100) throw new Error('기록 보존 개수가 올바르지 않습니다.');
  const past=[],future=[];
  return {
    record(before,after,label='악보 편집') {
      if(!before||!after||before===after) throw new Error('편집 기록 대상이 올바르지 않습니다.');
      past.push({doc:before,label});
      if(past.length>maxEntries) past.shift();
      future.length=0;
    },
    undo(current) {
      if(!current||!past.length) return null;
      const item=past.pop();
      future.push({doc:current,label:item.label});
      return {doc:item.doc,label:item.label};
    },
    redo(current) {
      if(!current||!future.length) return null;
      const item=future.pop();
      past.push({doc:current,label:item.label});
      return {doc:item.doc,label:item.label};
    },
    clear(){past.length=0;future.length=0;},
    status(){return {undo:past.length,redo:future.length,last:past.at(-1)?.label||''};},
  };
}
