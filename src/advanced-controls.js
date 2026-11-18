// Advanced model controls: pitch-only edit in polyphony/tuplets, chord tone add/remove.
// No advanced duration editing, backup/forward rewrite or automatic rhythmic simplification.
import { inspectAdvancedMeasure, editAdvancedScore } from './advanced-score.js';
const $ = id=>document.getElementById(id);
const html=[
'<section class="control-group v3-advanced" aria-label="화음 다성부 셋잇단음 검토">',
'<div class="control-heading"><span>화음·다성부·셋잇단음</span><span>10</span></div>',
'<p class="control-hint">기존 박자·성부·셋잇단음 길이를 유지한 채 개별 음정과 단순 화음 음을 편집합니다. 복잡한 기보 자체의 길이·구성 변경은 보호됩니다.</p>',
'<div id="v3-advanced-report" class="v3-meter" aria-live="polite">악보를 불러오면 고급 구조 검사를 표시합니다.</div>',
'<div class="v3-actions">',
'<button id="v3-advanced-pitch" type="button" disabled>선택 음표의 음정 변경</button>',
'<button id="v3-chord-add" type="button" disabled>선택 음표에 화음 음 추가</button>',
'<button id="v3-chord-remove" type="button" disabled>화음 구성 음 삭제</button>',
'</div>',
'<p class="control-hint">음정·변화표·옥타브는 위 3.0 편집기의 입력값을 사용합니다. 원본은 보존되며 기존 실행 취소·다시 실행이 적용됩니다.</p>',
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
      $('v3-advanced-pitch').disabled=!permitted;
      $('v3-chord-add').disabled=!permitted||event.chord;
      $('v3-chord-remove').disabled=!permitted||!event.chord;
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
      step:$('v3-step').value,alter:Number($('v3-alter').value),octave:Number($('v3-octave').value)
    };
    void v3.commitExternal(doc=>editAdvancedScore(doc,input),label);
  }
  $('v3-advanced-pitch').addEventListener('click',()=>apply('pitch','복합 기보 음정 변경'));
  $('v3-chord-add').addEventListener('click',()=>apply('chord-add','화음 구성 음 추가'));
  $('v3-chord-remove').addEventListener('click',()=>apply('chord-remove','화음 구성 음 삭제'));
  return {refresh};
}
