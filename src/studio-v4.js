// J-WOO 4.0 integrated authoring workspace.
// Reuses V3 commitExternal for immutable edits, history, rollback, and re-render.
import {createBlankScore,placeNoteIntoRest,addExpression,setScoreLayoutBreak,appendBlankMeasures,setSimpleKeySignature} from './studio-v4-core.js';
import {buildPlaybackTimeline,createAuditionPlayer} from './studio-v4-playback.js';
import {saveLocalDraft,listLocalDrafts,loadLocalDraft,removeLocalDraft} from './studio-v4-drafts.js';
import {createVectorPageZip} from './studio-v4-vector.js';
import {baseScoreName} from './part-export.js';
import './studio-v4.css';

const intro=[
  '<section class="v4-create" aria-label="새 악보와 임시 저장">',
  '<div class="v4-heading"><strong>J-WOO 4.0 COMPOSE</strong><span>NEW SCORE / LOCAL DRAFTS</span></div>',
  '<label for="v4-new-title">새 악보 제목</label><input id="v4-new-title" type="text" maxlength="120" placeholder="새 악보" value="새 악보" />',
  '<label for="v4-new-template">악보 구성</label><select id="v4-new-template"><option value="melody">멜로디 한 파트</option><option value="vocal">보컬 한 파트</option><option value="vocal-piano">보컬 + 피아노 양손(3개 단일 보표 파트)</option></select>',
  '<label for="v4-new-measures">마디 수 (4/4)</label><select id="v4-new-measures"><option>4</option><option selected>8</option><option>16</option><option>32</option></select>',
  '<button id="v4-new" type="button">+ 새 악보 작성</button>',
  '<p class="v4-tiny">피아노 템플릿은 양손을 각각 편집 가능한 단일 보표 파트로 만듭니다. 전문 그랜드 스태프와 동일하지 않습니다.</p>',
  '<div class="v4-draft-area"><label for="v4-draft-select">기기에 임시 저장된 악보</label><select id="v4-draft-select"><option value="">불러오는 중…</option></select>',
  '<div class="v4-inline"><button id="v4-restore" type="button" disabled>임시 저장 복원</button><button id="v4-delete-draft" type="button" disabled>임시본 삭제</button></div>',
  '<p id="v4-draft-status" class="v4-tiny" role="status">기기 저장소를 확인합니다.</p></div>',
  '</section>',
].join('');
const panel=[
  '<section class="control-group v4-editor" aria-label="4.0 작곡·기보·재생">',
  '<div class="control-heading"><span>4.0 통합 악보 작업</span><span>11</span></div>',
  '<p class="control-hint">위 3.0 영역에서 악기·마디·음표를 먼저 선택하세요. 편집은 동일한 실행 취소·다시 실행 기록과 연결됩니다.</p>',
  '<p class="v4-subhead">01 / 음표와 악상</p>',
  '<button id="v4-insert-note" type="button">선택 쉼표에 지정한 음정·길이의 음표 삽입</button>',
  '<p class="v4-tiny">3.0의 음이름·변화표·옥타브·길이 값을 사용합니다. 남은 박자는 정확한 쉼표로 분할합니다. 복잡한 성부는 보호됩니다.</p>',
  '<div class="v4-inline"><div><label for="v4-tempo">템포 (BPM)</label><input id="v4-tempo" type="number" min="30" max="240" value="100" /></div><div><label for="v4-dynamic">셈여림</label><select id="v4-dynamic"><option>pp</option><option>p</option><option>mp</option><option selected>mf</option><option>f</option><option>ff</option></select></div></div>',
  '<div class="v4-inline"><button id="v4-add-tempo" type="button">템포 기보</button><button id="v4-add-dynamic" type="button">셈여림 기보</button></div>',
  '<label for="v4-articulation">아티큘레이션</label><select id="v4-articulation"><option value="staccato">스타카토</option><option value="tenuto">테누토</option><option value="accent">악센트</option></select>',
  '<button id="v4-apply-articulation" type="button">선택 음표에 추가 / 해제</button>',
  '<p class="v4-subhead">02 / 악보 확장·조표·조판</p>',
  '<label for="v4-measure-count">빈 4/4 마디 추가</label><select id="v4-measure-count"><option value="1">1마디</option><option value="4" selected>4마디</option><option value="8">8마디</option><option value="16">16마디</option></select>',
  '<button id="v4-add-measures" type="button">모든 파트에 빈 마디 추가</button>',
  '<label for="v4-key">조표 (장조 표기·음정 자체는 변경하지 않음)</label>',
  '<select id="v4-key"><option value="-3">E♭ (플랫 3)</option><option value="-2">B♭ (플랫 2)</option><option value="-1">F (플랫 1)</option><option value="0" selected>C (변화표 없음)</option><option value="1">G (샤프 1)</option><option value="2">D (샤프 2)</option><option value="3">A (샤프 3)</option><option value="4">E (샤프 4)</option><option value="5">B (샤프 5)</option></select>',
  '<button id="v4-apply-key" type="button">모든 파트 조표 변경</button>',
  '<label for="v4-layout">선택한 마디부터</label><select id="v4-layout"><option value="system">새 줄 시작</option><option value="page">새 페이지 시작</option><option value="none">줄·페이지 나눔 해제</option></select>',
  '<button id="v4-apply-layout" type="button">악보 전체 파트에 나눔 지시 적용</button>',
  '<p class="v4-tiny">MusicXML에 인쇄 지시를 기록합니다. 실제 줄·페이지 구분 반영 여부는 렌더러 및 브라우저에서 확인하세요.</p>',
  '<button id="v4-vector-zip" type="button">벡터 SVG 페이지 ZIP 저장</button>',
  '<p class="v4-tiny">벡터 PDF는 상단의 ‘PDF로 인쇄 → PDF로 저장’을 사용하세요. 기존 ‘파트 PDF ZIP’은 JPEG 기반이므로 인쇄 전 검수가 필요합니다.</p>',
  '<p class="v4-subhead">03 / 간이 청음</p>',
  '<div class="v4-inline"><button id="v4-play" type="button">▶ 악보 재생</button><button id="v4-stop" type="button" disabled>■ 정지</button></div>',
  '<p id="v4-play-status" class="v4-tiny" role="status">Web Audio 기반 간이 신시사이저 · 음악적 표현과 실제 악기 음색을 재현하지 않습니다.</p>',
  '</section>',
].join('');

export function mountStudioV4({state,v3,openScore,setMessage,renderScore}){
  const $=id=>document.getElementById(id);
  document.querySelector('.sample-action').insertAdjacentHTML('afterend',intro);
  $('editor-controls').insertAdjacentHTML('beforeend',panel);
  let saveTimer=null,pending=null,skipRendered=false,currentRenderedDoc=null,writing=false;
  let disabledDraft=false;
  const player=createAuditionPlayer({onState:playing=>{
    $('v4-play').disabled=playing;
    $('v4-stop').disabled=!playing;
    if(!playing&&$('v4-play-status').textContent.includes('재생 중'))$('v4-play-status').textContent='재생 종료 · 새 재생을 시작할 수 있습니다.';
  }});
  const localeTime=ms=>new Date(ms).toLocaleString('ko-KR',{dateStyle:'short',timeStyle:'short'});
  function draftStatus(text){$('v4-draft-status').textContent=text;}
  async function refreshDrafts(){
    try{
      const list=await listLocalDrafts();
      const select=$('v4-draft-select'),previous=select.value;
      select.replaceChildren();
      const blank=document.createElement('option');
      blank.value='';blank.textContent=list.length?'복원할 악보 선택':'임시 저장된 악보 없음';select.append(blank);
      for(const item of list){
        const o=document.createElement('option');
        o.value=item.id;o.textContent=item.filename+' · '+localeTime(item.savedAt);select.append(o);
      }
      if(list.some(x=>x.id===previous))select.value=previous;
      $('v4-restore').disabled=!select.value;
      $('v4-delete-draft').disabled=!select.value;
      if(!list.length)draftStatus('브라우저 기기에 저장된 임시 악보가 없습니다.');
      else if(!writing)draftStatus(list.length+'개 악보가 이 기기에 보관되어 있습니다. 동기화되지 않습니다.');
    }catch(error){
      disabledDraft=true;
      $('v4-draft-select').replaceChildren();
      $('v4-draft-select').add(new Option('기기 저장소 사용 불가',''));
      $('v4-restore').disabled=true;$('v4-delete-draft').disabled=true;
      draftStatus('자동 저장을 사용할 수 없습니다: '+(error.message||'브라우저 제한'));
    }
  }
  async function saveSnapshot(snapshot){
    if(!snapshot||disabledDraft)return;
    try{
      writing=true;
      const done=await saveLocalDraft(snapshot);
      draftStatus(done.filename+' · '+localeTime(done.savedAt)+' 기기에 임시 저장 완료');
      writing=false;
      await refreshDrafts();
    }catch(error){
      writing=false;
      draftStatus('자동 저장 실패: '+error.message+' · MusicXML 파일로 직접 저장해 주세요.');
    }
  }
  function flushPending(){
    if(saveTimer!==null){clearTimeout(saveTimer);saveTimer=null;}
    const copy=pending;pending=null;
    if(copy)void saveSnapshot(copy);
  }
  function beforeOpen(){
    flushPending();
    player.stop();
    skipRendered=true;
    currentRenderedDoc=null;
  }
  function onRendered(){
    if(state.doc!==currentRenderedDoc){
      player.stop();
      currentRenderedDoc=state.doc;
    }
    if(skipRendered){skipRendered=false;return;}
    if(!state.doc||!state.filename||disabledDraft||state.showBaseline)return;
    try{
      pending={filename:state.filename,xml:new XMLSerializer().serializeToString(state.doc)};
      if(saveTimer!==null)clearTimeout(saveTimer);
      saveTimer=setTimeout(flushPending,900);
      draftStatus('변경 사항을 이 기기에 자동 임시 저장하는 중…');
    }catch(error){draftStatus('자동 저장 준비 실패: '+error.message);}
  }
  function onLoaded(){void refreshDrafts();}
  $('v4-new').addEventListener('click',async()=>{
    if(state.doc&&!confirm('새 악보를 만들면 현재 작업 화면이 교체됩니다. 먼저 MusicXML 파일로 저장했는지 확인해 주세요. 계속할까요?'))return;
    try{
      const xml=createBlankScore({title:$('v4-new-title').value,template:$('v4-new-template').value,measures:Number($('v4-new-measures').value)});
      const ok=await openScore(xml,($('v4-new-title').value.trim()||'새 악보')+'.musicxml');
      if(ok){setMessage('새 악보 생성 완료 · 쉼표를 선택해 4.0 음표 삽입 기능으로 작곡을 시작하세요.');}
    }catch(error){setMessage('새 악보 생성 실패: '+error.message,true);}
  });
  $('v4-draft-select').addEventListener('change',()=>{
    $('v4-restore').disabled=!$('v4-draft-select').value;
    $('v4-delete-draft').disabled=!$('v4-draft-select').value;
  });
  $('v4-restore').addEventListener('click',async()=>{
    const id=$('v4-draft-select').value;if(!id)return;
    if(state.doc&&!confirm('현재 작업 화면을 임시 저장본으로 교체합니다. 현재 악보를 저장했나요?'))return;
    try{
      const saved=await loadLocalDraft(id);
      const ok=await openScore(saved.xml,saved.filename);
      if(ok)draftStatus(saved.filename+' · '+localeTime(saved.savedAt)+' 임시본 복원 완료');
      else draftStatus('복원 파일이 올바른 MusicXML로 렌더링되지 않았습니다.');
    }catch(error){draftStatus('복원 실패: '+error.message);}
  });
  $('v4-delete-draft').addEventListener('click',async()=>{
    const id=$('v4-draft-select').value;if(!id)return;
    if(!confirm('선택한 로컬 임시 저장본을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.'))return;
    try{await removeLocalDraft(id);await refreshDrafts();}catch(error){draftStatus('삭제 실패: '+error.message);}
  });
  async function commit(transform,label){
    if(!state.doc){setMessage('먼저 악보를 열어 주세요.',true);return;}
    if(state.showBaseline){setMessage('원본 보기에서 편집할 수 없습니다. 현재 악보 보기로 전환해 주세요.',true);return;}
    await v3.commitExternal(transform,label);
  }
  function selected(){return v3.getSelection();}
  $('v4-insert-note').addEventListener('click',()=>void commit(doc=>placeNoteIntoRest(doc,{
    ...selected(),step:$('v3-step').value,alter:Number($('v3-alter').value),
    octave:Number($('v3-octave').value),type:$('v3-length').value,
  }),'선택 쉼표에 음표 삽입'));
  $('v4-add-tempo').addEventListener('click',()=>void commit(doc=>addExpression(doc,{
    ...selected(),kind:'tempo',value:Number($('v4-tempo').value),
  }),'템포 기보'));
  $('v4-add-dynamic').addEventListener('click',()=>void commit(doc=>addExpression(doc,{
    ...selected(),kind:'dynamic',value:$('v4-dynamic').value,
  }),'셈여림 기보'));
  $('v4-apply-articulation').addEventListener('click',()=>void commit(doc=>addExpression(doc,{
    ...selected(),kind:$('v4-articulation').value,
  }),'아티큘레이션 토글'));
  $('v4-add-measures').addEventListener('click',()=>void commit(doc=>appendBlankMeasures(doc,{count:Number($('v4-measure-count').value)}),'빈 마디 추가'));
  $('v4-apply-key').addEventListener('click',()=>void commit(doc=>setSimpleKeySignature(doc,{fifths:Number($('v4-key').value)}),'전체 조표 변경'));
  $('v4-apply-layout').addEventListener('click',()=>void commit(doc=>setScoreLayoutBreak(doc,{
    measureIndex:selected().measureIndex,kind:$('v4-layout').value,
  }),'줄·페이지 나눔'));
  $('v4-play').addEventListener('click',async()=>{
    if(!state.doc)return;
    try{
      const timeline=buildPlaybackTimeline(state.doc,{defaultBpm:Number($('v4-tempo').value)});
      await player.play(timeline);
      $('v4-play-status').textContent='재생 중 · '+timeline.events.length+'음 · 약 '+Math.ceil(timeline.durationSeconds)+'초'
        +(timeline.warnings.length?' · 주의: '+timeline.warnings.join(' / '):'');
    }catch(error){player.stop();setMessage('간이 재생 실패: '+error.message,true);}
  });
  $('v4-stop').addEventListener('click',()=>player.stop());
  $('v4-vector-zip').addEventListener('click',async()=>{
    if(!state.doc)return;
    const button=$('v4-vector-zip');button.disabled=true;
    try{
      const svgs=[...document.querySelectorAll('#score-container svg')];
      const blob=await createVectorPageZip({svgs,filename:state.filename});
      const url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download=baseScoreName(state.filename)+'-vector-pages.zip';a.click();
      setTimeout(()=>URL.revokeObjectURL(url),10000);
      setMessage('벡터 SVG '+svgs.length+'페이지 저장 완료 · 서체와 실제 인쇄 품질을 확인해 주세요.');
    }catch(error){setMessage('벡터 SVG 출력 실패: '+error.message,true);}
    finally{button.disabled=false;}
  });
  void refreshDrafts();
  return {beforeOpen,onRendered,onLoaded,stop:()=>player.stop()};
}
