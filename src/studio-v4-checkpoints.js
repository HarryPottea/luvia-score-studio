// Explicit, immutable local restore points, separate from overwriteable auto-drafts.
// Lives only in the current browser origin's IndexedDB: not a cloud backup.
const DATABASE='jwoo-score-studio-checkpoints-v4',STORE='checkpoints';
const MAX_COUNT=20,MAX_TOTAL_BYTES=32*1024*1024,MAX_SINGLE_BYTES=8*1024*1024;
const fail=text=>{throw new Error(text);};
function openDatabase(){
  return new Promise((resolve,reject)=>{
    if(typeof indexedDB==='undefined'){reject(new Error('이 브라우저는 로컬 체크포인트를 지원하지 않습니다.'));return;}
    const req=indexedDB.open(DATABASE,1);
    req.onupgradeneeded=()=>{
      if(!req.result.objectStoreNames.contains(STORE))
        req.result.createObjectStore(STORE,{keyPath:'id'});
    };
    req.onerror=()=>reject(req.error||new Error('체크포인트 저장소를 열 수 없습니다.'));
    req.onblocked=()=>reject(new Error('기존 체크포인트 저장소가 사용 중입니다.'));
    req.onsuccess=()=>resolve(req.result);
  });
}
async function requestTransaction(mode,fn){
  const db=await openDatabase();
  try{
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,mode),store=tx.objectStore(STORE);
      let result=null;
      tx.oncomplete=()=>resolve(result);
      tx.onerror=()=>reject(tx.error||new Error('체크포인트 저장이 실패했습니다.'));
      tx.onabort=()=>reject(tx.error||new Error('체크포인트 트랜잭션이 취소되었습니다.'));
      try{fn(store,v=>{result=v;});}catch(error){tx.abort();reject(error);}
    });
  }finally{db.close();}
}
const cryptoAvailable=()=>typeof crypto!=='undefined'&&crypto?.subtle&&typeof crypto.randomUUID==='function';
async function fingerprint(xml){
  if(!cryptoAvailable())fail('안전한 체크포인트 해시 기능을 사용할 수 없습니다.');
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(xml));
  return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function allRecords(){
  const records=await requestTransaction('readonly',(store,done)=>{
    const req=store.getAll();
    req.onsuccess=()=>done(req.result);
  });
  return Array.isArray(records)?records:[];
}
export async function listLocalCheckpoints(){
  const records=await allRecords();
  return records.filter(r=>r&&typeof r.xml==='string'&&typeof r.id==='string')
    .sort((a,b)=>b.savedAt-a.savedAt)
    .map(({id,filename,label,savedAt,bytes,sha256})=>({id,filename,label,savedAt,bytes,sha256}));
}
export async function saveLocalCheckpoint({filename,xml,label=''}={}){
  if(typeof xml!=='string'||!xml.includes('<score-partwise')||!xml.includes('</score-partwise>'))
    fail('체크포인트는 유효한 MusicXML 악보 화면에서만 만들 수 있습니다.');
  if(typeof filename!=='string'||!filename.trim())fail('악보 파일 이름이 필요합니다.');
  if(typeof label!=='string'||label.length>80)fail('복원 시점 설명은 80자 이하여야 합니다.');
  const bytes=new TextEncoder().encode(xml).length;
  if(bytes<1||bytes>MAX_SINGLE_BYTES)fail('한 체크포인트는 최대 8MiB까지 저장할 수 있습니다.');
  const records=await allRecords();
  if(records.length>=MAX_COUNT)fail('체크포인트가 20개입니다. 기존 복원 시점을 직접 삭제한 뒤 다시 저장해 주세요.');
  if(records.reduce((sum,item)=>sum+(item.bytes||0),0)+bytes>MAX_TOTAL_BYTES)
    fail('체크포인트 저장량이 32MiB를 초과합니다. 오래된 복원 시점을 직접 정리해 주세요.');
  const sha256=await fingerprint(xml);
  const savedAt=Date.now();
  const item={id:crypto.randomUUID(),filename:filename.trim().slice(0,180),
    label:label.trim().slice(0,80)||'수동 저장',xml,bytes,sha256,savedAt};
  // Never silently overwrite a prior recovery point.
  await requestTransaction('readwrite',(store,done)=>{store.add(item);done(item.id);});
  return {id:item.id,filename:item.filename,label:item.label,savedAt,bytes,sha256};
}
export async function loadLocalCheckpoint(id){
  if(typeof id!=='string'||!id)fail('복원할 체크포인트를 선택해 주세요.');
  const value=await requestTransaction('readonly',(store,done)=>{
    const req=store.get(id);req.onsuccess=()=>done(req.result||null);
  });
  if(!value||value.id!==id||typeof value.xml!=='string'||typeof value.sha256!=='string')
    fail('요청한 체크포인트를 찾지 못했습니다.');
  const bytes=new TextEncoder().encode(value.xml).length;
  if(bytes!==value.bytes||bytes>MAX_SINGLE_BYTES||await fingerprint(value.xml)!==value.sha256)
    fail('체크포인트의 내용·해시가 일치하지 않아 복원을 차단했습니다.');
  return {...value};
}
export async function removeLocalCheckpoint(id){
  if(typeof id!=='string'||!id)fail('삭제할 체크포인트를 선택해 주세요.');
  return requestTransaction('readwrite',(store,done)=>{
    const req=store.get(id);
    req.onsuccess=()=>{
      if(!req.result){done(false);return;}
      store.delete(id);done(true);
    };
  });
}
