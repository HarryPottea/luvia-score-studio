// A tiny presentation-only observer for the sticky score preview.
// Scroll layout is entirely CSS; this adds the subtle settled state only.
// No score data, editor history, or scroll position is modified.
export function isPreviewPinned({position,previewTop,previewHeight,containerTop,containerBottom,stickyTop}){
  return position==='sticky' && containerTop<stickyTop-8 &&
    containerBottom>stickyTop+previewHeight+8 &&
    Math.abs(previewTop-stickyTop)<3;
}

export function mountStickyPreview(){
  const preview=document.querySelector('.preview-column');
  const grid=document.querySelector('.work-grid');
  if(!preview||!grid)return ()=>{};
  let scheduled=false,disposed=false;
  const update=()=>{
    scheduled=false;
    if(disposed)return;
    const rect=preview.getBoundingClientRect();
    const parent=grid.getBoundingClientRect();
    const style=getComputedStyle(preview);
    const stickyTop=parseFloat(style.top);
    const pinned=Number.isFinite(stickyTop)&&isPreviewPinned({
      position:style.position,previewTop:rect.top,previewHeight:rect.height,
      containerTop:parent.top,containerBottom:parent.bottom,stickyTop,
    });
    preview.classList.toggle('is-pinned',pinned);
  };
  const schedule=()=>{
    if(disposed||scheduled)return;
    scheduled=true;
    window.requestAnimationFrame(update);
  };
  window.addEventListener('scroll',schedule,{passive:true});
  window.addEventListener('resize',schedule,{passive:true});
  schedule();
  return ()=>{
    disposed=true;
    window.removeEventListener('scroll',schedule);
    window.removeEventListener('resize',schedule);
    preview.classList.remove('is-pinned');
  };
}
