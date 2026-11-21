import { inspectScore, editScoreEvent, EDIT_TYPES } from './editor-core.js';
import { createEditorHistory } from './editor-history.js';
import { inspectAdvancedMeasure, editAdvancedScore } from './advanced-score.js';
import {editVoiceRhythm,relocateVoiceNote,replaceVoiceNoteWithRest} from './studio-v4-professional.js';
const TEMPLATE = [
  '<section class="control-group v3-editor" aria-label="악보 직접 편집">',
  '<div class="control-heading"><span>음표·쉼표 직접 편집</span><span>09</span></div>',
  '<p class="control-hint">악보에서 음표를 선택하거나 아래 목록에서 고르세요. 음정·길이·가사를 수정할 수 있으며, ‘쉼표로 바꾸기’는 박자를 보존합니다. 변경 불가능한 복합 기보는 보호됩니다.</p>',
  '<label for="v3-part">악기</label><select id="v3-part"></select>',
  '<label for="v3-measure">마디</label><select id="v3-measure"></select>',
  '<div id="v3-meter" class="v3-meter" aria-live="polite">악보를 열면 마디가 표시됩니다.</div>',
  '<div id="v3-events" class="v3-events" role="group" aria-label="마디의 음표·쉼표 목록"></div>',
  '<p id="v3-graphic-hint" class="control-hint" aria-live="polite">음표를 클릭해 선택하거나 위아래로 드래그해 음정을 변경하세요. 연결을 확인할 수 없는 음표는 편집되지 않습니다.</p>',
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
  '<div class="v3-actions"><button id="v3-pitch" type="button">음정 변경 · 쉼표에 음표 넣기</button>',
  '<button id="v3-duration" type="button">길이 변경</button><button id="v3-delete" type="button">선택 음표를 쉼표로 바꾸기</button>',
  '<button id="v3-tie" type="button">인접 음표 붙임줄 연결·해제</button></div>',
  '<div class="v3-note-tools"><label for="v3-target-beat">같은 성부 안에서 이동할 박자 위치</label>',
  '<input id="v3-target-beat" type="number" min="1" step="0.25" value="1" />',
  '<button id="v3-move" type="button">선택 음표를 지정 박자로 이동</button></div>',
  '<label for="v3-lyric">선택 음표의 가사</label><input id="v3-lyric" type="text" maxlength="80" placeholder="가사 한 음절" />',
  '<button id="v3-lyric-save" class="v3-save-lyric" type="button">가사 수정</button>',
  '<div class="v3-actions v3-history-actions"><button id="v3-undo" type="button" disabled>↶ 되돌리기</button>',
  '<button id="v3-redo" type="button" disabled>↷ 다시 실행</button></div>',
  '<p id="v3-history" class="control-hint"></p>',
  '<p class="control-hint">실행 취소 기록은 이 탭에서만 유지됩니다. 다른 편집 방식으로 변경하면 일부 기록이 초기화될 수 있으니 작업 중 MusicXML을 저장해 주세요.</p>',
  '</section>'
].join('');
const $ = id => document.getElementById(id);
const TYPES = {whole:'온',half:'2분',quarter:'4분',eighth:'8분','16th':'16분','32nd':'32분'};
const ALTER = {'-2':'𝄫','-1':'♭','0':'','1':'♯','2':'𝄪'};
export function mountV3Controls({state,renderScore,refreshRhythmReport,refreshV2,invalidateRhythmUndo,setMessage}) {
  $('editor-controls').insertAdjacentHTML('beforeend',TEMPLATE);
  const history=createEditorHistory(40), selection={partId:'',measureIndex:0,eventIndex:0};
  let busy=false;
  let selectionChanged=()=>{};
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
    let advanced=null;
    if(measure&&state.doc){
      try{
        const candidate=inspectAdvancedMeasure(state.doc,selection.partId,selection.measureIndex);
        if(candidate.events.length===measure.events.length)advanced=candidate;
      }catch{}
    }
    const note=advanced&&!advanced.reason?advanced.events[selection.eventIndex]:null;
    const simpleEditable=!!event?.editable&&!measure?.reason&&!state.showBaseline;
    const advancedEditable=!!note&&!state.showBaseline;
    const editable=simpleEditable||(advancedEditable&&(note.rest||note.editablePitch));
    for(const id of ['v3-step','v3-alter','v3-octave','v3-length'])$(id).disabled=!editable;
    $('v3-lyric').disabled=!simpleEditable;
    $('v3-pitch').disabled=!editable;
    $('v3-duration').disabled=!simpleEditable||event.rest;
    $('v3-delete').disabled=!(simpleEditable&&!event.rest&&!event.lyric) &&
      !(advancedEditable&&!note.rest&&!note.tuplet&&!note.protectedMarkup);
    $('v3-lyric-save').disabled=!simpleEditable||event.rest;
    const next=measure?.events[selection.eventIndex+1];
    const samePitch=!!event&&!event.rest&&!!next&&!next.rest&&
      event.step===next.step&&event.alter===next.alter&&event.octave===next.octave;
    $('v3-tie').disabled=!!busy||!!state.showBaseline||!!measure?.reason||!samePitch;
    $('v3-move').disabled=!advancedEditable||note.rest||note.chord||note.tuplet||note.protectedMarkup;
    $('v3-target-beat').disabled=$('v3-move').disabled;
    if(note&&advanced?.divisions&&document.activeElement!==$('v3-target-beat'))
      $('v3-target-beat').value=String(1+note.start/advanced.divisions);
    const scoreEvent=advanced?.events[selection.eventIndex]||event;
    $('v3-selection').textContent=event?
      (selection.eventIndex+1)+'번째 '+(scoreEvent.rest?'쉼표':'음표')+
      ' · 시작 '+scoreEvent.start+'/'+(advanced?.divisions??measure.divisions??'?')+
      ' · 길이 '+scoreEvent.duration+
      (advanced?' · 성부 '+scoreEvent.voice+' / 보표 '+scoreEvent.staff:'')+
      ' · '+(editable?'수정 가능':advanced?'전문 편집 도구 사용':'보호된 표기 (원본 유지)')
      :'마디에 음표·쉼표가 없습니다.';
    if(event) {
      $('v3-step').value=event.step||'C';
      $('v3-alter').value=String(Number.isInteger(event.alter)?event.alter:0);
      $('v3-octave').value=String(event.octave||4);
      $('v3-length').value=EDIT_TYPES.includes(event.type)?event.type:'quarter';
      $('v3-lyric').value=event.lyric||'';
    }
    status();
    state.graphicBridge?.highlight?.({...selection});
    selectionChanged({...selection});
  }
  function captureState(){
    return {history:history.capture(),selection:{...selection}};
  }
  function restoreState(snapshot){
    if(!snapshot||!snapshot.history||!snapshot.selection)
      throw new Error('편집 화면 복원 상태가 올바르지 않습니다.');
    history.restore(snapshot.history);
    selection.partId=snapshot.selection.partId;
    selection.measureIndex=snapshot.selection.measureIndex;
    selection.eventIndex=snapshot.selection.eventIndex;
    refresh();
  }
  function externalChanged(){history.clear();refresh();}
  function reset(){history.clear();selection.partId='';selection.measureIndex=0;selection.eventIndex=0;refresh();}
  function operation(action,options={}) {return {...selection,action,...options};}
  async function commitExternal(transform,label) {
    if(!state.doc||busy||state.showBaseline)return;
    busy=true;status();
    const before=state.doc;
    let result=null;
    try{
      result=transform(before);
      state.doc=result.doc;state.showBaseline=false;
      const ok=await renderScore();
      if(state.doc!==result.doc)return;
      if(!ok){
        state.doc=before;await renderScore();
        setMessage('변경 후 악보 렌더링 실패: 원본 상태로 복원했습니다.',true);return;
      }
      history.record(before,result.doc,label);
      // Structural measure operations can remap a bar even when no note-level
      // hint exists. Clamp to a surviving measure after the immutable commit.
      if(Number.isSafeInteger(result.change?.nextMeasureIndex)&&
         result.change.nextMeasureIndex>=0&&
         (result.change.partId===undefined||result.change.partId===selection.partId)){
        const parts=[...result.doc.documentElement.children].filter(n=>n.localName==='part');
        const selectedPart=parts.find(n=>n.getAttribute('id')===selection.partId)||parts[0];
        const length=selectedPart?[...selectedPart.children].filter(n=>n.localName==='measure').length:0;
        if(length)selection.measureIndex=Math.min(result.change.nextMeasureIndex,length-1);
      }
      if(Number.isSafeInteger(result.change?.nextEventIndex)&&
         result.change.nextEventIndex>=0&&
         (result.change.partId===undefined||result.change.partId===selection.partId))
        selection.eventIndex=result.change.nextEventIndex;
      invalidateRhythmUndo();refreshRhythmReport();refreshV2();
      setMessage(label+' 완료. 악보와 원본 비교를 확인한 뒤 저장하세요.');
    }catch(error){
      if(state.doc===result?.doc) {state.doc=before;await renderScore();}
      setMessage('악보 편집 실패: '+(error.message||'알 수 없는 오류'),true);
    }finally{busy=false;refresh();}
  }
  async function commit(action,options,label){
    return commitExternal(before=>editScoreEvent(before,operation(action,options)),label);
  }
  function select(position){
    if(!state.doc||!position)return false;
    const model=inspect();
    const part=model.parts.find(p=>p.id===position.partId);
    const measure=part?.measures[position.measureIndex];
    if(!measure?.events[position.eventIndex])return false;
    selection.partId=position.partId;
    selection.measureIndex=position.measureIndex;
    selection.eventIndex=position.eventIndex;
    refresh();
    return true;
  }
  async function movePitch(position,steps){
    if(!select(position)||busy||state.showBaseline)return;
    const event=chosen(inspect()).event;
    if(!event||event.rest)return;
    const {shiftDiatonicPitch}=await import('./score-hit.js');
    try {
      // Simple scores use the original strict editor. Polyphony/staves use the
      // advanced pitch-only path, which leaves rhythm/backup/forward unchanged.
      if(event.editable) {
        const next=shiftDiatonicPitch({step:event.step,alter:event.alter,octave:event.octave},steps);
        await commit('pitch',next,'악보 음표 위아래 이동');
      } else {
        const complex=inspectAdvancedMeasure(state.doc,position.partId,position.measureIndex);
        const note=complex.events[position.eventIndex];
        if(complex.reason||!note?.editablePitch)throw new Error(complex.reason||'보호된 기보입니다.');
        const next=shiftDiatonicPitch({step:note.step,alter:note.alter,octave:note.octave},steps);
        await commitExternal(doc=>editAdvancedScore(doc,{...position,action:'pitch',...next}),'악보 음표 위아래 이동');
      }
    } catch(error){setMessage('음정 이동 불가: '+error.message,true);}
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
  const currentPitch=()=>({step:$('v3-step').value,alter:Number($('v3-alter').value),
    octave:Number($('v3-octave').value)});
  const currentAdvanced=()=>inspectAdvancedMeasure(state.doc,selection.partId,selection.measureIndex);
  $('v3-pitch').addEventListener('click',()=>{
    const e=chosen(inspect()).event;if(!e)return;
    const advanced=currentAdvanced(),a=advanced.events[selection.eventIndex];
    if(!advanced.reason&&a&&(!e.editable||a.chord||a.voice!=='1'||a.staff!=='1')){
      if(a.rest)void commitExternal(doc=>editVoiceRhythm(doc,{...selection,mode:'insert',
        type:$('v3-length').value,...currentPitch()}),'선택 쉼표에 성부 보존 음표 삽입');
      else void commitExternal(doc=>editAdvancedScore(doc,{...selection,action:'pitch',...currentPitch()}),
        '선택 화음·성부 음표 변경');
    }else void commit(e.rest?'from-rest':'pitch',currentPitch(),e.rest?'쉼표에 음표 넣기':'음정 변경');
  });
  $('v3-duration').addEventListener('click',()=>commit('duration',{type:$('v3-length').value},'음표 길이 편집'));
  $('v3-delete').addEventListener('click',()=>{
    const e=chosen(inspect()).event;if(!e)return;
    const advanced=currentAdvanced(),a=advanced.events[selection.eventIndex];
    if(!advanced.reason&&a&&(!e.editable||a.chord||a.voice!=='1'||a.staff!=='1')){
      const following=advanced.events[selection.eventIndex+1];
      if(a.chord||(following?.chord&&following.voice===a.voice&&following.staff===a.staff))
        void commitExternal(doc=>editAdvancedScore(doc,{...selection,action:'chord-remove'}),
          '선택 화음음 삭제');
      else void commitExternal(doc=>replaceVoiceNoteWithRest(doc,selection),'선택 성부 음표를 쉼표로 변경');
    }else void commit('to-rest',{},'음표를 쉼표로 대체');
  });
  $('v3-move').addEventListener('click',()=>void commitExternal(doc=>
    relocateVoiceNote(doc,{...selection,targetBeat:Number($('v3-target-beat').value),grid:'16th'}),
    '선택 음표 박자 위치 이동'));
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
  function directEdit(position,action){
    if(!select(position)||busy||state.showBaseline)return false;
    const button=action==='insert'?$('v3-pitch'):action==='delete'?$('v3-delete'):null;
    if(!button||button.disabled)return false;
    button.click();return true;
  }
  return {refresh,reset,externalChanged,captureState,restoreState,select,directEdit,getSelection:()=>({...selection}),
    onSelectionChange:callback=>{selectionChanged=typeof callback==='function'?callback:()=>{};},
    commitExternal,movePitch};
}
