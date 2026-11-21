import './score-toolstrip.css';

const icons={
  note:'<path d="M14 3v13.5a3.5 3.5 0 1 1-2-3.35V6l8-2v8.5a3.5 3.5 0 1 1-2-3.35V2z"/>',
  lyric:'<path d="M4 5h16M7 5v14m10-14v14M5 19h4m6 0h4"/>',
  move:'<path d="M12 2v20M2 12h20m-10-10-3 3m3-3 3 3m-3 17-3-3m3 3 3-3M2 12l3-3m-3 3 3 3m17-3-3-3m3 3-3 3"/>',
  measure:'<path d="M4 3v18m16-18v18M4 7h16M4 17h16m-10-10v10"/>',
};

export function mountScoreToolstrip(){
  const preview=document.querySelector('.preview-toolbar');
  if(!preview||document.getElementById('jwoo-score-tools'))return;
  const host=document.createElement('div');
  host.id='jwoo-score-tools';host.className='jwoo-score-tools';
  host.setAttribute('role','toolbar');host.setAttribute('aria-label','악보 편집 도구');
  const definitions=[
    ['note','음표 입력','선택한 쉼표에 현재 설정의 음표를 입력합니다.'],
    ['lyric','가사 입력','악보의 음표를 눌러 가사를 입력하는 모드를 켜거나 끕니다.'],
    ['move','기호 이동','쉼표·조표·박자표·음자리표를 직접 끌어 옮깁니다.'],
    ['measure','마디 작업','세부 설정의 마디 범위 도구로 이동합니다.'],
  ];
  for(const [kind,name,description] of definitions){
    const button=document.createElement('button');
    button.type='button';button.className='jwoo-score-tool';
    button.dataset.tool=kind;button.dataset.help=name+' — '+description;
    button.setAttribute('aria-label',name+'. '+description);
    button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+icons[kind]+'</svg>';
    if(kind==='lyric'||kind==='move')button.setAttribute('aria-pressed','false');
    let hold=null,longPress=false;
    button.addEventListener('pointerdown',event=>{
      if(event.pointerType==='mouse')return;
      longPress=false;
      hold=setTimeout(()=>{longPress=true;button.classList.add('show-help');},650);
    });
    for(const type of ['pointerup','pointercancel','pointerleave'])button.addEventListener(type,()=>{
      if(hold!==null)clearTimeout(hold);
      hold=null;
      if(type==='pointercancel'||type==='pointerleave')button.classList.remove('show-help');
    });
    button.addEventListener('click',event=>{
      if(longPress){event.preventDefault();longPress=false;return;}
      if(kind==='note')document.getElementById('v4-insert-note')?.click();
      if(kind==='lyric')document.getElementById('v4-lyric-mode-button')?.click();
      if(kind==='move'){
        const check=document.getElementById('v4-symbol-drag');
        if(check&&!check.disabled){check.checked=!check.checked;check.dispatchEvent(new Event('change',{bubbles:true}));}
      }
      if(kind==='measure')document.querySelector('.jwoo-quick-link[aria-label="마디 설정으로 이동"]')?.click();
      sync();
      if(event.pointerType==='touch'){
        button.classList.add('show-help');
        setTimeout(()=>button.classList.remove('show-help'),1800);
      }
    });
    host.append(button);
  }
  preview.insertAdjacentElement('afterend',host);
  const $=kind=>host.querySelector('[data-tool="'+kind+'"]');
  function sync(){
    const drag=document.getElementById('v4-symbol-drag');
    const lyric=document.getElementById('v4-lyric-mode-button');
    const open=!!document.querySelector('#score-container svg');
    $('note').disabled=!open;
    $('lyric').disabled=!open||!!lyric?.disabled;
    $('move').disabled=!open||!!drag?.disabled;
    $('measure').disabled=!open;
    $('lyric').setAttribute('aria-pressed',String(lyric?.getAttribute('aria-pressed')==='true'));
    $('move').setAttribute('aria-pressed',String(!!drag?.checked));
  }
  document.addEventListener('jwoo:score-updated',sync);
  document.getElementById('v4-symbol-drag')?.addEventListener('change',sync);
  const lyric=document.getElementById('v4-lyric-mode-button');
  if(lyric)new MutationObserver(sync).observe(lyric,{attributes:true,attributeFilter:['aria-pressed','disabled']});
  sync();
}
