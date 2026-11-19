// Coalesce rapid view-only changes before expensive score engraving.
// Edits that change MusicXML still use the immediate transactional render path.
export function createCoalescedPreviewUpdate({
  run,delay=140,setTimer=setTimeout,clearTimer=clearTimeout,onPending=()=>{}
}={}){
  if(typeof run!=='function'||!Number.isFinite(delay)||delay<0)
    throw new Error('미리보기 갱신 예약 설정이 올바르지 않습니다.');
  let timer=null,epoch=0;
  function cancel(){
    epoch++;
    if(timer!==null){clearTimer(timer);timer=null;}
  }
  function request(){
    cancel();
    const revision=epoch;
    onPending();
    timer=setTimer(()=>{
      timer=null;
      if(revision!==epoch)return;
      void Promise.resolve().then(()=>{
        if(revision===epoch)return run();
      });
    },delay);
    return revision;
  }
  return {request,cancel,get pending(){return timer!==null;}};
}
