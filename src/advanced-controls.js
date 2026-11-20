// Advanced model controls: pitch-only edit in polyphony/tuplets, chord tone add/remove.
// No advanced duration editing, backup/forward rewrite or automatic rhythmic simplification.
import { inspectAdvancedMeasure, editAdvancedScore } from './advanced-score.js';
const $ = id=>document.getElementById(id);
const html=[
'<section class="control-group v3-advanced" aria-label="화음 다성부 셋잇단음 검토">',
'<div class="control-heading"><span>화음·다성부 음정 편집</span><span>10</span></div>',
'<p class="control-hint">다성부·셋잇단음의 박자 구조를 유지하면서 음정과 화음 구성음을 편집합니다. 지원하지 않는 복잡한 구조는 변경하지 않습니다.</p>',
'<div id="v3-advanced-report" class="v3-meter" aria-live="polite">악보를 불러오면 고급 구조 검사를 표시합니다.</div>',
'<div class="v3-note-tools">',
'<div><label for="v3-advanced-step">음이름</label><select id="v3-advanced-step"><option>C</option><option>D</option><option>E</option><option>F</option><option>G</option><option>A</option><option>B</option></select></div>',
'<div><label for="v3-advanced-alter">변화표</label><select id="v3-advanced-alter"><option value="-2">𝄫</option><option value="-1">♭</option><option value="0">♮</option><option value="1">♯</option><option value="2">𝄪</option></select></div>',
'<div><label for="v3-advanced-octave">옥타브</label><select id="v3-advanced-octave"><option>1</option><option>2</option><option>3</option><option selected>4</option><option>5</option><option>6</option><option>7</option><option>8</option></select></div>',
'</div>',
'<div class="v3-actions">',
'<button id="v3-advanced-pitch" type="button" disabled>선택 음표의 음정 변경</button>',
'<button id="v3-chord-add" type="button" disabled>선택 음표에 화음 음 추가</button>',
'<button id="v3-chord-remove" type="button" disabled>화음 구성 음 삭제</button>',
'</div>',
'<p class="control-hint">음정·변화표·옥타브는 이 영역에서 별도로 지정합니다. 원본은 보존되며 기존 실행 취소·다시 실행이 적용됩니다.</p>',
'</section>'
].join('');
export function mountAdvancedControls({state,v3,setMessage}) {
  $('editor-controls').insertAdjacentHTML('beforeend',html);
  let active=null;
  function refresh(){
    const pos=v3.getSelection();
    const report=$('v3-advanced-report');
    if(!state.doc||!pos.partId) {
      report.textContent='선택된 악보가 없습니다.';
      for(const id of ['v3-advanced-pitch','v3-chord-add','v3-chord-remove'])$(id).disabled=true;
      active=null;return;
    }
    try{
      const measure=inspectAdvancedMeasure(state.doc,pos.partId,pos.measureIndex);
      const event=measure.events[pos.eventIndex];
      active={...pos,event,measure};
      if(!event||measure.reason){
        report.textContent=measure.reason ? '읽기 전용: '+measure.reason : '선택한 음표가 없습니다.';
        for(const id of ['v3-advanced-pitch','v3-chord-add','v3-chord-remove'])$(id).disabled=true;
        return;
      }
      const flags=[event.chord?'화음 구성 음':'일반 음표',event.tuplet?'셋잇단음 정보 포함':'일반 길이'];
      report.textContent=measure.number+'마디 · 성부 '+event.voice+' · 보표 '+event.staff+
        ' · 시작 '+event.start+' · 길이 '+event.duration+' · '+flags.join(' / ')+
        (event.protectedMarkup?' · 기보 보호':'');
      const permitted=!state.showBaseline&&!event.rest&&event.editablePitch;
      for(const id of ['v3-advanced-step','v3-advanced-alter','v3-advanced-octave'])$(id).disabled=!permitted;
      $('v3-advanced-step').value=event.step||'C';
      $('v3-advanced-alter').value=String(Number.isInteger(event.alter)?event.alter:0);
      $('v3-advanced-octave').value=String(event.octave||4);
      $('v3-advanced-pitch').disabled=!permitted;
      $('v3-chord-add').disabled=!permitted||event.chord;
      const follower=measure.events[pos.eventIndex+1];
      const chordRoot=!event.chord&&follower?.chord&&
        follower.voice===event.voice&&follower.staff===event.staff;
      $('v3-chord-remove').disabled=!permitted||!(event.chord||chordRoot);
    }catch(error) {
      active=null;report.textContent='구조 검사 실패: '+error.message;
      for(const id of ['v3-advanced-pitch','v3-chord-add','v3-chord-remove'])$(id).disabled=true;
    }
  }
  function apply(action,label){
    if(!active||!state.doc||state.showBaseline)return;
    const {partId,measureIndex,eventIndex}=active;
    const input={
      action,partId,measureIndex,eventIndex,
      step:$('v3-advanced-step').value,alter:Number($('v3-advanced-alter').value),octave:Number($('v3-advanced-octave').value)
    };
    void v3.commitExternal(doc=>editAdvancedScore(doc,input),label);
  }
  $('v3-advanced-pitch').addEventListener('click',()=>apply('pitch','복합 기보 음정 변경'));
  $('v3-chord-add').addEventListener('click',()=>apply('chord-add','화음 구성 음 추가'));
  $('v3-chord-remove').addEventListener('click',()=>apply('chord-remove','화음 구성 음 삭제'));
  return {refresh};
}
