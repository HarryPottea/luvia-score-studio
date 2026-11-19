// Private local-only J-WOO 4.0 draft store (IndexedDB).
// No cookies, tracking, account, background syncing or network requests.
const DATABASE='jwoo-score-studio-drafts-v4';
const STORE='drafts';
const MAX_XML_CHARS=8*1024*1024;
const MAX_DRAFTS=8;
function openDatabase(){
  return new Promise((resolve,reject)=>{
    if(typeof indexedDB==='undefined'){reject(new Error('이 브라우저는 로컬 임시 저장을 지원하지 않습니다.'));return;}
    const request=indexedDB.open(DATABASE,1);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'id'});
    };
    request.onerror=()=>reject(request.error||new Error('로컬 저장소를 열 수 없습니다.'));
    request.onsuccess=()=>resolve(request.result);
    request.onblocked=()=>reject(new Error('기존 저장소가 사용 중입니다.'));
  });
}
async function work(mode,callback){
  const db=await openDatabase();
  try{
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,mode),store=tx.objectStore(STORE);
      let result;
      tx.oncomplete=()=>resolve(result);
      tx.onabort=()=>reject(tx.error||new Error('임시 저장이 중단됐습니다.'));
      tx.onerror=()=>reject(tx.error||new Error('임시 저장에 실패했습니다.'));
      try{callback(store,value=>{result=value;});}catch(error){tx.abort();reject(error);}
    });
  }finally{db.close();}
}
export async function saveLocalDraft({filename,xml}={}){
  if(typeof xml!=='string'||!xml.includes('<score-partwise')||xml.length>MAX_XML_CHARS)
    throw new Error('임시 저장은 8MiB 이하의 MusicXML 악보만 지원합니다. 파일로 직접 저장해 주세요.');
  if(typeof filename!=='string'||!filename.trim())throw new Error('저장할 악보 이름이 없습니다.');
  const name=filename.trim().slice(0,180);
  const draft={id:name,filename:name,xml,savedAt:Date.now(),bytes:new Blob([xml]).size};
  await work('readwrite',(store,done)=>{store.put(draft);done(draft);});
  const all=await listLocalDrafts();
  if(all.length>MAX_DRAFTS){
    await work('readwrite',(store,done)=>{
      for(const old of all.slice(MAX_DRAFTS))store.delete(old.id);
      done(true);
    });
  }
  return {id:draft.id,filename:name,savedAt:draft.savedAt,bytes:draft.bytes};
}
export async function listLocalDrafts(){
  const all=await work('readonly',(store,done)=>{
    const request=store.getAll();
    request.onsuccess=()=>done(request.result);
  });
  return (all||[]).filter(x=>typeof x.xml==='string').sort((a,b)=>b.savedAt-a.savedAt)
    .map(({id,filename,savedAt,bytes})=>({id,filename,savedAt,bytes}));
}
export async function loadLocalDraft(id){
  if(typeof id!=='string'||!id)throw new Error('복원할 악보를 선택해 주세요.');
  const result=await work('readonly',(store,done)=>{
    const request=store.get(id);
    request.onsuccess=()=>done(request.result||null);
  });
  if(!result||typeof result.xml!=='string')throw new Error('임시 저장된 악보가 없습니다.');
  return {...result};
}
export async function removeLocalDraft(id){
  if(typeof id!=='string'||!id)throw new Error('삭제할 악보를 선택해 주세요.');
  return work('readwrite',(store,done)=>{store.delete(id);done(true);});
}
