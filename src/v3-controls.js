import { inspectScore, editScoreEvent, EDIT_TYPES } from './editor-core.js';
import { createEditorHistory } from './editor-history.js';
const TEMPLATE = [
  '<section class="control-group v3-editor" aria-label="악보 직접 편집">',
  '<div class="control-heading"><span>J-WOO 3.0 악보 편집</span><span>09</span></div>',
  '<p class="control-hint">음표를 선택해 음정·길이·가사를 편집합니다. 삭제는 같은 길이의 쉼표로 바꿔 박자를 보존합니다. 복잡한 다성부·셋잇단음은 읽기 전용입니다.</p>',
  '<label for="v3-part">악기</label><select id="v3-part"></select>',
  '<label for="v3-measure">마디</label><select id="v3-measure"></select>',
  '<div id="v3-meter" class="v3-meter" aria-live="polite">악보를 열면 마디가 표시됩니다.</div>',
  '<div id="v3-events" class="v3-events" role="group" aria-label="마디의 음표·쉼표 목록"></div>',
  '<p id="v3-selection" class="control-hint" aria-live="polite"></p>',
  '<div class="v3-note-tools">',
  '<div><label for="v3-step">음이름</label><select id="v3-step">',
  '<option>C</option><option>D</option><option>E</option><option>F</option><option>G</option><option>A</option><option>B</option></select></div>',
  '<div><label for="v3-alter">변화표</label><select id="v3-alter">',
  '<option value="-2">𝄫</option><option value="-1">♭</option><option value="0">♮</option><option value="1">♯</option><option value="2">𝄪</option></select></div>',
  '<div><label for="v3-octave">옥타브</label><select id="v3-octave">',
  '<option>2</option><option>3</option><option selected>4</option><option>5</option><option>6</option><option>7</option><option>8</option></select></div>',
  '<div><label for="v3-length">길이</label><select id="v3-length">',
  '<option value="whole">온음표</option><option value="half">2분</option><option value="quarter">4분</option>',
  '<option value="eighth">8분</option><option value="16th">16분</option><option value="32nd">32분</option></select></div></div>',
  '<div class="v3-actions"><button id="v3-pitch" type="button">음정 변경 / 음표 넣기</button>',
  '<button id="v3-duration" type="button">길이 변경</button><button id="v3-delete" type="button">음표 → 쉼표</button>',
  '<button id="v3-tie" type="button">다음 음표와 붙임줄 연결/해제</button></div>',
  '<label for="v3-lyric">선택 음표의 가사</label><input id="v3-lyric" type="text" maxlength="80" placeholder="가사 한 음절" />',
  '<button id="v3-lyric-save" class="v3-save-lyric" type="button">가사 수정</button>',
  '<div class="v3-actions v3-history-actions"><button id="v3-undo" type="button" disabled>↶ 되돌리기</button>',
  '<button id="v3-redo" type="button" disabled>↷ 다시 실행</button></div>',
  '<p id="v3-history" class="control-hint"></p>',
  '<p class="control-hint">편집 기록은 브라우저 메모리에만 보존됩니다. 기존 1·2차 편집 기능을 사용하면 3.0 실행 취소 기록은 초기화됩니다.</p>',
  '</section>'
].join('');
const $ = id => document.getElementById(id);
const TYPES = {whole:'온',half:'2분',quarter:'4분',eighth:'8분','16th':'16분','32nd':'32분'};
const ALTER = {'-2':'𝄫','-1':'♭','0':'','1':'♯','2':'𝄪'};
export function mountV3Controls({state,renderScore,refreshRhythmReport,refreshV2,invalidateRhythmUndo,setMessage}) {
  $('editor-controls').insertAdjacentHTML('beforeend',TEMPLATE);
  const history=createEditorHistory(40), selection={partId:'',measureIndex:0,eventIndex:0};
  let busy=false;
  const inspect=()=>state.doc?inspectScore(state.doc):{parts:[]};
  function chosen(model) {
    const part=model.parts.find(p=>p.id===selection.partId);
    const measure=part?.measures[selection.measureIndex];
    return {part,measure,event:measure?.events[selection.eventIndex]};
  }
  function option(parent,value,label) {
    const el=document.createElement('option');el.value=String(value);el.textContent=String(label);parent.append(el);
  }
  function status() {
    const s=history.status();
    $('v3-undo').disabled=busy||!s.undo;
    $('v3-redo').disabled=busy||!s.redo;
    $('v3-history').textContent='실행 취소 '+s.undo+'단계 · 다시 실행 '+s.redo+'단계'+(s.last?' · 최근: '+s.last:'');
  }
  function refresh() {
    const model=inspect(),partSelect=$('v3-part'),measureSelect=$('v3-measure'),list=$('v3-events');
    if(!model.parts.length) {
      partSelect.replaceChildren();measureSelect.replaceChildren();list.replaceChildren();
      $('v3-meter').textContent='편집할 파트가 없습니다.';$('v3-selection').textContent='MusicXML 파일을 열어주세요.';
      status();return;
    }
    if(!model.parts.some(p=>p.id===selection.partId))selection.partId=model.parts[0].id;
    const part=model.parts.find(p=>p.id===selection.partId);
    selection.measureIndex=Math.min(selection.measureIndex,Math.max(0,part.measures.length-1));
    const measure=part.measures[selection.measureIndex];
    if(!measure||selection.eventIndex>=measure.events.length)selection.eventIndex=0;
    partSelect.replaceChildren();for(const p of model.parts)option(partSelect,p.id,p.name);partSelect.value=selection.partId;
    measureSelect.replaceChildren();
    for(const m of part.measures)option(measureSelect,m.index,m.number+'마디'+(m.reason?' · 보호':''));
    measureSelect.value=String(selection.measureIndex);
    $('v3-meter').textContent=measure ?
      (measure.beats??'?')+' / '+(measure.beatType??'?')+' · divisions '+(measure.divisions??'?')+' · '+(measure.reason?'읽기 전용: '+measure.reason:'단일 성부 편집 가능')
      :'마디를 선택해주세요.';
    list.replaceChildren();
    if(measure)for(const e of measure.events) {
      const button=document.createElement('button');button.type='button';
      button.className='v3-event'+(e.eventIndex===selection.eventIndex?' selected':'')+(e.editable?'':' protected');
      const symbol=e.rest?'𝄽':e.step+(ALTER[String(e.alter)]||'')+(e.octave||'');
      button.textContent=(e.eventIndex+1)+' · '+symbol+' · '+(TYPES[e.type]||e.type||'?')+(e.lyric?' · '+e.lyric:'');
      button.title=e.editable?'선택하여 편집':'복잡한 기보: 읽기 전용';
      button.setAttribute('aria-pressed',String(e.eventIndex===selection.eventIndex));
      button.addEventListener('click',()=>{selection.eventIndex=e.eventIndex;refresh();});
      button.addEventListener('keydown',ev=>{
        if(ev.key!=='ArrowLeft'&&ev.key!=='ArrowRight')return;
        ev.preventDefault();
        selection.eventIndex=Math.max(0,Math.min(measure.events.length-1,selection.eventIndex+(ev.key==='ArrowRight'?1:-1)));
        refresh();$('v3-events').querySelector('.v3-event.selected')?.focus();
      });
      list.append(button);
    }
    const {event}=chosen(model);
    const editable=!!event?.editable&&!measure?.reason&&!state.showBaseline;
    for(const id of ['v3-step','v3-alter','v3-octave','v3-length','v3-lyric'])$(id).disabled=!editable;
    $('v3-pitch').disabled=!editable;
    $('v3-duration').disabled=!editable||event.rest;
    $('v3-delete').disabled=!editable||event.rest||!!event.lyric;
    $('v3-lyric-save').disabled=!editable||event.rest;
    const next=measure?.events[selection.eventIndex+1];
    const samePitch=!!event&&!event.rest&&!!next&&!next.rest&&event.step===next.step&&event.alter===next.alter&&event.octave===next.octave;
    $('v3-tie').disabled=!!busy||!!state.showBaseline||!!measure?.reason||!samePitch;
    $('v3-selection').textContent=event?
      (selection.eventIndex+1)+'번째 '+(event.rest?'쉼표':'음표')+' · 시작 '+event.start+'/'+(measure.divisions??'?')+' · 길이 '+event.duration+' · '+(editable?'수정 가능':'보호된 표기 (원본 유지)')
      :'마디에 음표·쉼표가 없습니다.';
    if(event) {
      $('v3-step').value=event.step||'C';
      $('v3-alter').value=String(Number.isInteger(event.alter)?event.alter:0);
      $('v3-octave').value=String(event.octave||4);
      $('v3-length').value=EDIT_TYPES.includes(event.type)?event.type:'quarter';
      $('v3-lyric').value=event.lyric||'';
    }
    status();
  }
  function externalChanged(){history.clear();refresh();}
  function reset(){history.clear();selection.partId='';selection.measureIndex=0;selection.eventIndex=0;refresh();}
  function operation(action,options={}) {return {...selection,action,...options};}
  async function commit(action,options,label) {
    if(!state.doc||busy||state.showBaseline)return;
    busy=true;status();
    const before=state.doc;
    let result=null;
    try{
      result=editScoreEvent(before,operation(action,options));
      state.doc=result.doc;state.showBaseline=false;
      const ok=await renderScore();
      if(state.doc!==result.doc)return;
      if(!ok){
        state.doc=before;await renderScore();
        setMessage('변경 후 악보 렌더링 실패: 원본 상태로 복원했습니다.',true);return;
      }
      history.record(before,result.doc,label);
      invalidateRhythmUndo();refreshRhythmReport();refreshV2();
      setMessage(label+' 완료. 악보와 원본 비교를 확인한 뒤 저장하세요.');
    }catch(error){
      if(state.doc===result?.doc) {state.doc=before;await renderScore();}
      setMessage('악보 편집 실패: '+(error.message||'알 수 없는 오류'),true);
    }finally{busy=false;refresh();}
  }
  async function travel(kind) {
    if(busy||!state.doc||state.showBaseline)return;
    const before=state.doc;
    const item=kind==='undo'?history.undo(before):history.redo(before);
    if(!item)return;
    busy=true;state.doc=item.doc;
    try{
      const ok=await renderScore();
      if(!ok){
        state.doc=before;
        if(kind==='undo')history.redo(item.doc);else history.undo(item.doc);
        await renderScore();setMessage('복원된 악보를 표시하지 못해 변경을 취소했습니다.',true);
      } else {
        invalidateRhythmUndo();refreshRhythmReport();refreshV2();
        setMessage(item.label+(kind==='undo'?' 되돌리기':' 다시 실행')+' 완료');
      }
    }finally{busy=false;refresh();}
  }
  $('v3-part').addEventListener('change',()=>{selection.partId=$('v3-part').value;selection.measureIndex=0;selection.eventIndex=0;refresh();});
  $('v3-measure').addEventListener('change',()=>{selection.measureIndex=Number($('v3-measure').value);selection.eventIndex=0;refresh();});
  $('v3-pitch').addEventListener('click',()=>{
    const e=chosen(inspect()).event;if(!e)return;
    commit(e.rest?'from-rest':'pitch',{step:$('v3-step').value,alter:Number($('v3-alter').value),octave:Number($('v3-octave').value)},e.rest?'쉼표에 음표 넣기':'음정 변경');
  });
  $('v3-duration').addEventListener('click',()=>commit('duration',{type:$('v3-length').value},'음표 길이 편집'));
  $('v3-delete').addEventListener('click',()=>commit('to-rest',{},'음표를 쉼표로 대체'));
  $('v3-tie').addEventListener('click',()=>commit('tie',{},'인접 음표 붙임줄 연결/해제'));
  $('v3-lyric-save').addEventListener('click',()=>commit('lyric',{text:$('v3-lyric').value},'가사 수정'));
  $('v3-undo').addEventListener('click',()=>travel('undo'));
  $('v3-redo').addEventListener('click',()=>travel('redo'));
  document.addEventListener('keydown',ev=>{
    if(!(ev.metaKey||ev.ctrlKey)||ev.altKey||ev.key.toLowerCase()!=='z')return;
    if(ev.target?.closest?.('input,textarea,select,[contenteditable="true"]'))return;
    if(!state.doc||!document.activeElement?.closest?.('.site-shell'))return;
    ev.preventDefault();travel(ev.shiftKey?'redo':'undo');
  });
  return {refresh,reset,externalChanged};
}
