// Compact bar-range editing in the score preview; all mutations use V3 history.
import {captureMeasureRange,pasteMeasureRange,duplicateMeasureRange,
  deleteMeasureRange,insertBlankMeasureRange} from './studio-v4-measure-blocks.js';
import {transposeMeasurePassage} from './studio-v4-passage-transpose.js';
import './studio-v4-measure-toolbar.css';

const direct=(n,tag)=>n?[...n.children].filter(c=>c.localName===tag):[];
export function mountMeasureToolbar({state,v3,commit,setMessage}){
  const host=document.createElement('section');
  host.className='jwoo-measure-toolbar';
  host.tabIndex=0;
  host.id='jwoo-measure-toolbar';
  host.setAttribute('aria-label','악보 마디 범위 편집');
  host.innerHTML=[
    '<div class="jwoo-measure-heading"><strong>마디 바로 편집</strong>',
    '<span id="jwoo-block-status" role="status" aria-live="polite">악보를 열면 마디를 선택할 수 있습니다.</span></div>',
    '<div id="jwoo-bar-strip" class="jwoo-bar-strip" role="group" aria-label="편집할 마디 선택"></div>',
    '<div class="jwoo-range-controls">',
    '<label>시작 <input id="jwoo-range-from" type="number" min="1" step="1" disabled></label>',
    '<label>끝 <input id="jwoo-range-to" type="number" min="1" step="1" disabled></label>',
    '<button id="jwoo-range-apply" type="button" disabled>범위 지정</button>',
    '</div>',
    '<div class="jwoo-bar-actions">',
    '<button type="button" data-act="copy">복사</button>',
    '<button type="button" data-act="paste">앞에 붙여넣기</button>',
    '<button type="button" data-act="duplicate">뒤에 복제</button>',
    '<button type="button" data-act="insert">앞에 빈 마디</button>',
    '<button type="button" data-act="delete" class="jwoo-danger">선택 마디 삭제</button>',
    '</div>',
    '<div class="jwoo-transpose-controls">',
    '<label>반음 이동 <input type="number" id="jwoo-transpose-semitones" min="-12" max="12" value="2" step="1" /></label>',
    '<label>임시표 <select id="jwoo-transpose-spelling"><option value="sharp">샤프 우선</option><option value="flat">플랫 우선</option></select></label>',
    '<button type="button" data-act="transpose">선택 구간 음정 일괄 이조</button>',
    '</div>',
    '<p class="jwoo-bar-hint">마디 번호를 누르거나 악보 음표를 클릭해 선택하세요. Shift+클릭은 여러 마디 선택,',
    ' 모바일에서는 시작·끝 번호로 범위를 지정합니다. 모든 파트에 동일하게 적용되며 실행 취소할 수 있습니다.',
    ' 선택 바 안에서는 Ctrl/⌘+C 복사 · Ctrl/⌘+V 붙여넣기 · Ctrl/⌘+D 복제 · Delete 삭제를 사용할 수 있습니다.',
    ' 연결 기호나 조표·박자표 변경이 위험하면 편집을 차단합니다.</p>',
  ].join('');
  document.querySelector('.preview-toolbar').insertAdjacentElement('afterend',host);
  const context=document.createElement('div');
  context.className='jwoo-measure-context';
  context.hidden=true;
  context.setAttribute('role','group');
  context.setAttribute('aria-label','선택 마디 빠른 작업');
  context.innerHTML=[
    '<button type="button" data-context-act="copy">선택 마디 복사</button>',
    '<button type="button" data-context-act="paste">선택 위치 앞에 붙여넣기</button>',
    '<button type="button" data-context-act="duplicate">선택 마디 뒤에 복제</button>',
    '<button type="button" data-context-act="insert">앞에 빈 마디 추가</button>',
    '<button type="button" data-context-act="delete">선택 마디 삭제</button>',
    '<button type="button" data-context-act="transpose">선택 구간 음정 일괄 이조</button>',
  ].join('');
  host.appendChild(context);
  const $=id=>document.getElementById(id);
  let anchor=0,start=0,end=0,clipboard=null,seenDoc=null,barCount=0,selectedCount=0,playingIndex=null;
  const status=$('jwoo-block-status'),strip=$('jwoo-bar-strip');
  const actionButtons=[...host.querySelectorAll('[data-act]')];
  const currentInfo=()=>{
    const parts=direct(state.doc?.documentElement,'part');
    const counts=parts.map(p=>direct(p,'measure').length);
    return counts.length&&counts[0]>0&&counts.every(n=>n===counts[0])?counts[0]:0;
  };
  function notify(message,error=false){status.textContent=message;if(error)setMessage(message,true);}
  function render(){
    const count=currentInfo(),canEdit=!!count&&!state.showBaseline;
    if(state.doc!==seenDoc||count!==barCount){
      seenDoc=state.doc;barCount=count;
      strip.replaceChildren();
      for(let i=0;i<count;i++){
        const b=document.createElement('button');
        b.type='button';b.className='jwoo-bar-chip';
        b.dataset.measureIndex=String(i);b.textContent=String(i+1);
        b.setAttribute('aria-label',(i+1)+'마디 선택');
        b.addEventListener('click',event=>pick(i,event.shiftKey));
        strip.appendChild(b);
      }
    }
    start=Math.max(0,Math.min(start,Math.max(0,count-1)));
    anchor=Math.max(0,Math.min(anchor,Math.max(0,count-1)));
    end=Math.max(start,Math.min(end,Math.max(0,count-1)));
    for(const chip of strip.children){
      const i=Number(chip.dataset.measureIndex);
      chip.disabled=!canEdit;
      chip.classList.toggle('is-selected',i>=start&&i<=end);
      chip.classList.toggle('is-playing',i===playingIndex);
      if(i===playingIndex)chip.setAttribute('aria-current','location');
      else chip.removeAttribute('aria-current');
      chip.setAttribute('aria-pressed',String(i>=start&&i<=end));
    }
    const max=String(Math.max(1,count));
    for(const id of ['jwoo-range-from','jwoo-range-to']){
      $(id).disabled=!canEdit;
      $(id).max=max;
    }
    $('jwoo-range-from').value=count?String(start+1):'';
    $('jwoo-range-to').value=count?String(end+1):'';
    $('jwoo-range-apply').disabled=!canEdit;
    for(const button of actionButtons){
      const action=button.dataset.act;
      button.disabled=!canEdit||(action==='paste'&&!clipboard)||
        (action==='delete'&&count<=end-start+1);
    }
    state.graphicBridge?.highlightMeasureRange?.(start,end);
    if(!count)notify('악보를 열면 마디를 선택할 수 있습니다.');
    else if(state.showBaseline)notify('원본 보기를 끝내면 마디 편집을 사용할 수 있습니다.');
    else notify((start+1)+(start===end?'마디':'–'+(end+1)+'마디')+
      ' 선택 · 전체 '+count+'마디 · '+(clipboard?clipboard.count+'마디 복사본 보관 중':'복사본 없음'));
  }
  function followPlaybackMeasure(index){
    const next=Number.isSafeInteger(index)&&index>=0?index:null;
    if(next===playingIndex)return;
    playingIndex=next;
    for(const chip of strip.children){
      const active=next!==null&&Number(chip.dataset.measureIndex)===next;
      chip.classList.toggle('is-playing',active);
      if(active)chip.setAttribute('aria-current','location');
      else chip.removeAttribute('aria-current');
      if(active&&typeof chip.scrollIntoView==='function')
        chip.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
    }
  }
  function closeContext(){context.hidden=true;}
  function openContext(index,point={}){
    pick(index,false);
    if(state.showBaseline||!currentInfo())return;
    const box=host.getBoundingClientRect();
    const width=208;
    const x=Number.isFinite(point.x)?point.x-box.left:0;
    const y=Number.isFinite(point.y)?point.y-box.top:55;
    context.style.left=Math.max(0,Math.min(x,host.clientWidth-width))+'px';
    context.style.top=Math.max(0,y)+'px';
    for(const button of context.querySelectorAll('[data-context-act]')){
      button.disabled=host.querySelector('[data-act="'+button.dataset.contextAct+'"]').disabled;
    }
    context.hidden=false;
    context.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
  }
  function pick(index,extend=false){
    const count=currentInfo();
    if(!count||state.showBaseline||!Number.isSafeInteger(index)||index<0||index>=count)return;
    closeContext();
    if(!extend){anchor=index;start=index;end=index;}
    else{start=Math.min(anchor,index);end=Math.max(anchor,index);}
    render();
  }
  function setRangeFromFields(){
    const count=currentInfo(),from=Number($('jwoo-range-from').value),to=Number($('jwoo-range-to').value);
    if(!count||!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||
       from<1||to<from||to>count||to-from+1>16){
      notify('시작·끝 마디를 올바르게 입력해 주세요 (한 번에 최대 16마디).',true);
      return;
    }
    anchor=from-1;start=from-1;end=to-1;render();
  }
  $('jwoo-range-apply').addEventListener('click',setRangeFromFields);
  function scope(){
    const count=currentInfo();
    if(!count||state.showBaseline)throw new Error('현재 악보에서만 마디를 편집할 수 있습니다.');
    if(end-start+1>16)throw new Error('한 번에 최대 16마디까지만 편집할 수 있습니다.');
    return {start,end};
  }
  async function execute(action){
    try{
      const region=scope();
      if(action==='transpose'){
        const semitones=Number($('jwoo-transpose-semitones').value);
        const spelling=$('jwoo-transpose-spelling').value;
        if(!Number.isSafeInteger(semitones)||semitones===0||
           semitones<-12||semitones>12||!['sharp','flat'].includes(spelling))
          throw new Error('이조 반음은 -12~+12의 0이 아닌 정수여야 합니다.');
        const before=state.doc;
        await commit(doc=>transposeMeasurePassage(doc,{...region,semitones,spelling}),
          '선택 구간 '+(semitones>0?'+':'')+semitones+'반음 이조');
        if(before!==state.doc){render();}
        return;
      }
      if(action==='copy'){
        clipboard=captureMeasureRange(state.doc,region);
        render();notify(clipboard.count+'마디를 복사했습니다. 붙여넣을 위치를 선택해 주세요.');
        return;
      }
      if(action==='paste'){
        if(!clipboard)throw new Error('복사한 마디가 없습니다.');
        const before=state.doc;
        await commit(doc=>pasteMeasureRange(doc,{clipboard,index:region.start}),'마디 붙여넣기');
        if(before!==state.doc){end=start+clipboard.count-1;render();}
        return;
      }
      if(action==='duplicate'){
        const before=state.doc;
        await commit(doc=>duplicateMeasureRange(doc,region),'선택한 마디 복제');
        if(before!==state.doc){const at=region.end+1;start=at;end=at+region.end-region.start;anchor=at;render();}
        return;
      }
      if(action==='insert'){
        const before=state.doc;
        await commit(doc=>insertBlankMeasureRange(doc,{index:region.start,count:1}),'앞에 빈 마디 삽입');
        if(before!==state.doc){end=start;render();}
        return;
      }
      if(action==='delete'){
        if(!confirm((region.start+1)+'–'+(region.end+1)+
          '마디를 모든 파트에서 삭제할까요? 해당 마디의 음표·가사·코드도 삭제됩니다. 실행 취소로 복원할 수 있습니다.'))return;
        const before=state.doc;
        await commit(doc=>deleteMeasureRange(doc,region),'선택한 마디 범위 삭제');
        if(before!==state.doc){end=start;anchor=start;render();}
      }
    }catch(error){notify('마디 작업 불가: '+(error.message||'지원하지 않는 악보입니다.'),true);}
  }
  actionButtons.forEach(button=>button.addEventListener('click',()=>void execute(button.dataset.act)));
  host.addEventListener('keydown',event=>{
    const target=event.target;
    if(target?.closest?.('input,textarea,select,[contenteditable="true"]')||
      state.showBaseline||!currentInfo())return;
    const key=event.key.toLowerCase();
    let action=null;
    if((event.ctrlKey||event.metaKey)&&!event.altKey){
      if(key==='c')action='copy';
      if(key==='v')action='paste';
      if(key==='d')action='duplicate';
    }else if(!event.ctrlKey&&!event.metaKey&&!event.altKey&&
      (event.key==='Delete'||event.key==='Backspace')&&
      target?.classList?.contains('jwoo-bar-chip'))
      action='delete';
    if(!action||action==='paste'&&!clipboard)return;
    event.preventDefault();event.stopPropagation();
    void execute(action);
  });
  context.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-context-act]');
    if(!button||button.disabled)return;
    closeContext();void execute(button.dataset.contextAct);
  });
  strip.addEventListener('contextmenu',event=>{
    const chip=event.target.closest?.('.jwoo-bar-chip');
    if(!chip||chip.disabled)return;
    event.preventDefault();
    openContext(Number(chip.dataset.measureIndex),{x:event.clientX,y:event.clientY});
  });
  document.addEventListener('pointerdown',event=>{
    if(!context.hidden&&!context.contains(event.target))closeContext();
  },true);
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape')closeContext();
  });
  function reset(){
    closeContext();playingIndex=null;clipboard=null;start=0;end=0;anchor=0;seenDoc=null;barCount=-1;render();
  }
  render();
  return {render,reset,pick,openContext,getRange:scope,followPlaybackMeasure};
}
