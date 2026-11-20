// In-score lyric editing, mounted as a small anchored popover rather than
// requiring the composer to scroll through the long settings inspector.
// All edits flow through the existing immutable MusicXML + undo transaction.
import {readInlineLyric,nextInlineLyricPosition,smartLyricTokens} from './studio-v4-lyrics-inline.js';
import {applyBatchLyrics,planBatchLyrics} from './studio-v4-lyrics-batch.js';
import {setNoteVerse} from './studio-v4-composer.js';

const html=`
  <div class="jwoo-lyric-pop-header">
    <strong id="v4-inline-location">가사 입력</strong>
    <button type="button" id="v4-inline-close" aria-label="가사 편집창 닫기">×</button>
  </div>
  <label for="v4-inline-verse">가사 절</label>
  <select id="v4-inline-verse" aria-label="편집할 가사 절">
    ${Array.from({length:12},(_,i)=>'<option value="'+(i+1)+'">'+(i+1)+'절</option>').join('')}
  </select>
  <label for="v4-inline-input">음절 또는 문장 입력</label>
  <input type="text" id="v4-inline-input" maxlength="100" autocomplete="off" placeholder="예: 우 / 우리 함께" />
  <p id="v4-inline-preview" class="jwoo-lyric-preview" aria-live="polite">텍스트를 입력하세요.</p>
  <div class="jwoo-lyric-actions">
    <button type="button" id="v4-inline-next" class="primary">저장 · 다음 음표 ↵</button>
    <button type="button" id="v4-inline-save">이 음표만 저장</button>
    <button type="button" id="v4-inline-auto">문장 자동 배치</button>
    <button type="button" id="v4-inline-delete" class="subtle">현재 가사 삭제</button>
  </div>
  <label class="jwoo-lyric-overwrite"><input type="checkbox" id="v4-inline-overwrite" /> 기존 가사 덮어쓰기 허용 (자동 배치)</label>
  <p id="v4-inline-status" class="jwoo-lyric-status" role="status" aria-live="polite">Enter: 저장 후 다음 음표 · Ctrl/⌘+Enter: 자동 배치 · Esc: 닫기</p>
`;

const same=(a,b)=>a&&b&&a.partId===b.partId&&a.measureIndex===b.measureIndex&&a.eventIndex===b.eventIndex;
function formatSyllables(text){
  const tokens=smartLyricTokens(text);
  const shown=tokens.slice(0,18).map(t=>t.kind==='extension'?'_':t.text);
  return {tokens,label:shown.join(' · ')+(tokens.length>18?' · …':'')};
}
export function mountInlineLyricEditor({state,v3,commit,setMessage,
  lyricVerseInput,getNoteRect}){
  const button=document.createElement('button');
  button.id='v4-lyric-mode-button';button.type='button';
  button.className='jwoo-lyric-mode-button';
  button.setAttribute('aria-pressed','false');
  button.textContent='가사 입력 모드';
  button.title='켜면 악보의 음표를 클릭해서 가사를 입력합니다. 꺼져도 음표를 더블클릭할 수 있습니다.';
  const toolbar=document.querySelector('.preview-toolbar');
  toolbar?.appendChild(button);
  const help=document.createElement('p');
  help.className='v4-tiny jwoo-lyric-helper';
  help.textContent='악보 위 음표를 더블클릭하면 가사를 직접 수정할 수 있습니다. 악보 미리보기의 ‘가사 입력 모드’를 켜면 한 번 클릭으로 열립니다. 문장을 입력하면 한국어 음절을 자동으로 나눠 배치할 수도 있습니다.';
  document.getElementById('v4-lyric-text')?.insertAdjacentElement('beforebegin',help);
  const editor=document.createElement('section');
  editor.id='v4-inline-lyric-editor';
  editor.className='jwoo-lyric-popover';
  editor.setAttribute('role','dialog');
  editor.setAttribute('aria-label','악보 위 가사 직접 편집');
  editor.hidden=true;editor.innerHTML=html;
  document.body.appendChild(editor);
  const $=id=>document.getElementById(id);
  let openAt=null,busy=false,mode=false,openedDoc=null,lastRect=null;
  const field=$('v4-inline-input'),verse=$('v4-inline-verse');
  const status=$('v4-inline-status'),where=$('v4-inline-location');
  const submitButtons=['v4-inline-next','v4-inline-save','v4-inline-auto','v4-inline-delete'];
  function enabled(){
    return !!state.doc&&!state.showBaseline;
  }
  function updateButton(){
    button.disabled=!enabled();
    if(!enabled())mode=false;
    button.classList.toggle('is-active',mode);
    button.setAttribute('aria-pressed',String(mode));
    button.textContent=mode?'가사 입력 중 · ON':'가사 입력 모드';
  }
  function close(){
    if(busy)return;
    editor.hidden=true;openAt=null;openedDoc=null;lastRect=null;
  }
  function locate(rect){
    if(!rect)return;
    lastRect=rect;
    editor.hidden=false;
    const width=Math.min(350,Math.max(260,window.innerWidth-24));
    editor.style.width=width+'px';
    const left=Math.max(12,Math.min(window.innerWidth-width-12,rect.left||12));
    editor.style.left=left+'px';
    const height=editor.getBoundingClientRect().height;
    const below=(rect.bottom??window.innerHeight/2)+8;
    const above=(rect.top??window.innerHeight/2)-height-8;
    editor.style.top=Math.max(8,Math.min(window.innerHeight-height-8,
      below+height<window.innerHeight-12?below:above))+'px';
  }
  function showStatus(message,isError=false){
    status.textContent=message;status.classList.toggle('is-error',isError);
  }
  function readCurrent(){
    if(!openAt||!enabled())throw new Error('현재 편집할 음표가 없습니다.');
    return readInlineLyric(state.doc,openAt,{verse:Number(verse.value)});
  }
  function refreshLocation(){
    const info=readCurrent();
    where.textContent=(info.measureIndex+1)+'마디 · '+(info.eventIndex+1)+'번째 음표 · '+
      info.voice+'성부 / '+info.staff+'보표';
    field.value=info.text;
    $('v4-inline-delete').disabled=!info.exists;
    $('v4-inline-overwrite').checked=false;
    updatePreview();
    showStatus(info.exists?
      '현재 가사를 불러왔습니다. 해당 절의 기존 멜리스마·음절 연결 정보를 유지합니다.':
      'Enter: 이 음표에 입력 후 다음 음표 · Ctrl/⌘+Enter: 문장 자동 배치');
  }
  function updatePreview(){
    let preview;
    try{
      const {tokens,label}=formatSyllables(field.value);
      preview=tokens.length?
        tokens.length===1?'음절 1개 · '+label:
          tokens.length+'개 위치로 스마트 배치 · '+label:
        '음절 또는 문장을 입력하세요.';
      $('v4-inline-auto').disabled=!tokens.length;
      $('v4-inline-next').disabled=!tokens.length;
      $('v4-inline-save').disabled=!field.value.trim();
    }catch(error){
      preview='입력 확인: '+error.message;
      $('v4-inline-auto').disabled=true;$('v4-inline-next').disabled=true;
      $('v4-inline-save').disabled=true;
    }
    $('v4-inline-preview').textContent=preview;
  }
  function open(position,rect){
    if(busy||!enabled())return false;
    try{
      const requested=Number(lyricVerseInput?.value)||1;
      verse.value=String(requested);
      const info=readInlineLyric(state.doc,position,{verse:requested});
      openAt={partId:info.partId,measureIndex:info.measureIndex,eventIndex:info.eventIndex};
      openedDoc=state.doc;
      editor.hidden=false;
      refreshLocation();
      locate(rect||getNoteRect?.(openAt)||{left:window.innerWidth/2-140,
        bottom:Math.min(window.innerHeight*.4,200)});
      field.focus();field.select();
      return true;
    }catch(error){
      showStatus('가사 편집 불가: '+error.message,true);
      setMessage('가사 직접 편집 불가: '+error.message,true);
      return false;
    }
  }
  async function change(kind){
    if(busy||!openAt||!enabled())return;
    const current={...openAt},textValue=field.value;
    const currentVerse=Number(verse.value);
    let info,next=null,transform,label;
    try{
      info=readCurrent();
      if(kind==='delete'){
        if(!info.exists){showStatus('삭제할 가사가 없습니다.',true);return;}
        transform=doc=>setNoteVerse(doc,{...current,verse:currentVerse,mode:'remove'});
        label='악보 위 가사 삭제';
      }else if(kind==='auto'){
        const plan=planBatchLyrics(state.doc,{...current,verse:currentVerse,
          text:textValue,overwrite:$('v4-inline-overwrite').checked});
        showStatus(plan.tokens+'개 가사 위치 확인 · 기존 '+plan.occupied+'개 덮어쓰기'+
          ' · 편집 결과 저장 중…');
        transform=doc=>applyBatchLyrics(doc,{...current,verse:currentVerse,
          text:textValue,overwrite:$('v4-inline-overwrite').checked});
        label='악보 위 스마트 문장 가사 배치';
      }else{
        if(!textValue.trim())throw new Error('한 음절을 입력하거나 삭제 버튼을 이용해 주세요.');
        if(kind==='next')next=nextInlineLyricPosition(state.doc,current,{verse:currentVerse});
        transform=doc=>setNoteVerse(doc,{...current,verse:currentVerse,text:textValue,
          syllabic:info.syllabic,extend:info.extend,mode:'set'});
        label='악보 위 가사 직접 수정';
      }
    }catch(error){showStatus('적용 불가: '+error.message,true);return;}
    busy=true;
    for(const id of submitButtons)$(id).disabled=true;
    const before=state.doc;
    try{
      await commit(transform,label);
      if(state.doc===before){
        showStatus('변경되지 않았습니다. 악보 편집 메시지를 확인해 주세요.',true);
        return;
      }
      openedDoc=state.doc;
      if(kind==='next'&&next){
        v3.select(next);
        openAt=next;
        refreshLocation();
        locate(getNoteRect?.(next)||lastRect);
        field.focus();
      }else if(kind==='next'){
        showStatus('저장 완료 · 선택 성부의 마지막 가사 음표입니다.');
        field.select();
      }else{
        editor.hidden=true;openAt=null;openedDoc=null;lastRect=null;
      }
    }catch(error){showStatus('저장 실패: '+error.message,true);}
    finally{
      busy=false;
      if(openAt)updatePreview();
    }
  }
  button.addEventListener('click',()=>{
    if(!enabled())return;
    mode=!mode;updateButton();
    if(!mode)close();
    else showStatus('악보 위 음표를 누르면 가사 입력창이 열립니다.');
  });
  $('v4-inline-close').addEventListener('click',close);
  verse.addEventListener('change',()=>{
    if(lyricVerseInput)lyricVerseInput.value=verse.value;
    try{refreshLocation();field.focus();}catch(error){showStatus(error.message,true);}
  });
  field.addEventListener('input',updatePreview);
  field.addEventListener('keydown',event=>{
    if(event.isComposing||event.key!=='Enter')return;
    event.preventDefault();
    void change(event.ctrlKey||event.metaKey?'auto':'next');
  });
  editor.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();close();}
  });
  $('v4-inline-next').addEventListener('click',()=>void change('next'));
  $('v4-inline-save').addEventListener('click',()=>void change('save'));
  $('v4-inline-auto').addEventListener('click',()=>void change('auto'));
  $('v4-inline-delete').addEventListener('click',()=>void change('delete'));
  // The selection object is populated from the source-verified OSMD notehead.
  // No guessing is made from the SVG's linear child order.
  updateButton();
  return {
    isMode:()=>mode&&enabled(),
    openFromScore:(position,element)=>open(position,element?.getBoundingClientRect?.()),
    close,
    onLoaded:()=>{close();updateButton();},
    onRendered:()=>{
      updateButton();
      if(!busy&&!editor.hidden&&state.doc!==openedDoc)close();
    },
  };
}
