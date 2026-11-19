// J-WOO 4.0 integrated authoring workspace.
// Reuses V3 commitExternal for immutable edits, history, rollback, and re-render.
import {createBlankScore,placeNoteIntoRest,addExpression,setScoreLayoutBreak,appendBlankMeasures,setSimpleKeySignature} from './studio-v4-core.js';
import {buildPlaybackTimeline,createAuditionPlayer} from './studio-v4-playback.js';
import {saveLocalDraft,listLocalDrafts,loadLocalDraft,removeLocalDraft} from './studio-v4-drafts.js';
import {createVectorPageZip} from './studio-v4-vector.js';
import {baseScoreName} from './part-export.js';
import {auditMusicXml,summarizeMusicXmlAudit} from './studio-v4-audit.js';
import {editVoiceRhythm,createEighthTriplet,toggleSlur,addHairpin,nudgeVoiceNoteOnGrid} from './studio-v4-professional.js';
import {inspectAdvancedMeasure} from './advanced-score.js';
import {setNoteVerse,toggleSoundingTie} from './studio-v4-composer.js';
import {renderPartSvgPages,populateVectorPrintWindow} from './studio-v4-printbook.js';
import {setKeyAtMeasure,setMeterForEmptyTail} from './studio-v4-meter.js';
import './studio-v4.css';

const intro=[
  '<section class="v4-create" aria-label="새 악보와 임시 저장">',
  '<div class="v4-heading"><strong>J-WOO 4.0 COMPOSE</strong><span>NEW SCORE / LOCAL DRAFTS</span></div>',
  '<label for="v4-new-title">새 악보 제목</label><input id="v4-new-title" type="text" maxlength="120" placeholder="새 악보" value="새 악보" />',
  '<label for="v4-new-template">악보 구성</label><select id="v4-new-template"><option value="melody">멜로디 한 파트</option><option value="vocal">보컬 한 파트</option><option value="vocal-piano">보컬 + 피아노 양손(그랜드 스태프)</option></select>',
  '<label for="v4-new-measures">마디 수 (4/4)</label><select id="v4-new-measures"><option>4</option><option selected>8</option><option>16</option><option>32</option></select>',
  '<button id="v4-new" type="button">+ 새 악보 작성</button>',
  '<p class="v4-tiny">피아노는 하나의 파트 안에 높은음·낮은음자리표 두 보표와 독립 성부를 사용합니다. 4.0 전문 기보 입력을 활용하세요.</p>',
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
  '<p class="v4-subhead">02 / 다성부·셋잇단음·이음줄</p>',
  '<p class="v4-tiny">3.0 편집 영역에서 음표를 선택하세요. 같은 성부의 박자 합계를 유지하고, 지원하지 않는 복합 기보는 변경하지 않습니다.</p>',
  '<p class="v4-tiny">다성부 악보에서는 기존 3.0 입력란이 잠길 수 있으므로 아래의 독립 입력값을 사용합니다.</p>',
  '<div class="v4-inline"><div><label for="v4-pro-step">음이름</label><select id="v4-pro-step"><option>C</option><option>D</option><option>E</option><option>F</option><option>G</option><option>A</option><option>B</option></select></div><div><label for="v4-pro-octave">옥타브</label><select id="v4-pro-octave"><option>2</option><option>3</option><option selected>4</option><option>5</option><option>6</option><option>7</option></select></div></div>',
  '<label for="v4-pro-alter">변화표</label><select id="v4-pro-alter"><option value="-2">𝄫</option><option value="-1">♭</option><option value="0" selected>♮</option><option value="1">♯</option><option value="2">𝄪</option></select>',
  '<label for="v4-pro-type">음표 길이</label><select id="v4-pro-type"><option value="whole">온음표</option><option value="half">2분음표</option><option value="quarter" selected>4분음표</option><option value="eighth">8분음표</option><option value="16th">16분음표</option><option value="32nd">32분음표</option></select>',
  '<button id="v4-pro-duration" type="button">선택 음표 길이 변경 (성부·박자 보존)</button>',
  '<label for="v4-grid-step">시작 위치 이동 간격</label><select id="v4-grid-step"><option value="eighth">8분음표</option><option value="16th" selected>16분음표</option><option value="32nd">32분음표</option></select>',
  '<div class="v4-inline"><button id="v4-nudge-earlier" type="button">← 선택 음표를 앞 쉼표로 이동</button><button id="v4-nudge-later" type="button">선택 음표를 뒤 쉼표로 이동 →</button></div>',
  '<p class="v4-tiny">음표와 인접한 같은 성부의 쉼표 사이에서 정확한 시작 위치를 옮깁니다. 다른 성부, 기존 화음·붙임줄·셋잇단음·빔은 변경하지 않습니다.</p>',
  '<p class="v4-subhead">현재 마디 성부 시간표</p>',
  '<p class="v4-tiny">다성부·화음도 박자 위치별로 표시됩니다. 음표 블록을 눌러 선택하세요. Shift+←/→는 선택한 음표를 한 격자씩 이동합니다.</p>',
  '<div id="v4-beat-grid" class="v4-beat-grid" role="group" aria-label="마디 성부별 음표 시작 위치"></div>',
  '<button id="v4-pro-triplet" type="button">8분음표 두 개를 셋잇단음 세 개로 (가운데 음정은 3.0 입력값)</button>',
  '<p class="v4-tiny">정확히 분할 가능한 MusicXML divisions의 동일 성부·보표 8분음표 2개가 필요합니다.</p>',
  '<label for="v4-pro-end">이음줄·크레셴도 끝 음표의 목록 번호 (1부터 시작)</label>',
  '<input id="v4-pro-end" type="number" min="2" max="9999" step="1" value="2" />',
  '<button id="v4-pro-slur" type="button">선택 음표부터 끝 음표까지 이음줄 추가 / 해제</button>',
  '<label for="v4-pro-wedge">셈여림 변화</label><select id="v4-pro-wedge"><option value="crescendo">크레셴도 &lt;</option><option value="diminuendo">디미누엔도 &gt;</option></select>',
  '<button id="v4-pro-hairpin" type="button">선택 음표부터 끝 음표까지 셈여림 변화 추가</button>',
  '<p class="v4-subhead">03 / 보컬 가사 · 붙임줄</p>',
  '<p class="v4-tiny">가사는 선택된 선율 음표에 입력하며, 1~12절을 독립적으로 수정할 수 있습니다. 붙임줄은 같은 음정의 연속된 음표를 연결합니다.</p>',
  '<div class="v4-inline"><div><label for="v4-lyric-verse">가사 절 번호</label><input id="v4-lyric-verse" type="number" min="1" max="12" step="1" value="1" /></div><div><label for="v4-lyric-syllabic">음절 연결</label><select id="v4-lyric-syllabic"><option value="single">단일 음절</option><option value="begin">시작</option><option value="middle">중간</option><option value="end">끝</option></select></div></div>',
  '<label for="v4-lyric-text">가사 (한국어·영어 지원)</label><input id="v4-lyric-text" type="text" maxlength="100" placeholder="이 음표에 들어갈 한 음절" />',
  '<label for="v4-lyric-extend">멜리스마 연장선</label><select id="v4-lyric-extend"><option value="none">없음</option><option value="start">연장 시작</option><option value="continue">연장 계속</option><option value="stop">연장 종료</option></select>',
  '<div class="v4-inline"><button id="v4-lyric-set" type="button">가사 입력·교체</button><button id="v4-lyric-remove" type="button">선택 절 가사 삭제</button></div>',
  '<label for="v4-tie-next-measure">붙임줄 끝 마디</label><select id="v4-tie-next-measure"><option value="0">현재 마디</option><option value="1">다음 마디</option></select>',
  '<button id="v4-tie-toggle" type="button">선택 음표와 끝 음표의 붙임줄 연결 / 해제</button>',
  '<p class="v4-tiny">끝 음표 목록 번호는 위 ‘이음줄·크레셴도 끝 음표’에서 지정합니다. 다른 성부·음정으로 연결하면 안전하게 차단됩니다.</p>',
  '<p class="v4-subhead">04 / 악보 확장·조표·조판</p>',
  '<label for="v4-measure-count">빈 4/4 마디 추가</label><select id="v4-measure-count"><option value="1">1마디</option><option value="4" selected>4마디</option><option value="8">8마디</option><option value="16">16마디</option></select>',
  '<button id="v4-add-measures" type="button">모든 파트에 빈 마디 추가</button>',
  '<label for="v4-key">조표 (장조 표기·음정 자체는 변경하지 않음)</label>',
  '<select id="v4-key"><option value="-3">E♭ (플랫 3)</option><option value="-2">B♭ (플랫 2)</option><option value="-1">F (플랫 1)</option><option value="0" selected>C (변화표 없음)</option><option value="1">G (샤프 1)</option><option value="2">D (샤프 2)</option><option value="3">A (샤프 3)</option><option value="4">E (샤프 4)</option><option value="5">B (샤프 5)</option></select>',
  '<button id="v4-apply-key" type="button">모든 파트 조표 변경</button>',
  '<button id="v4-key-from-measure" type="button">선택 마디부터 모든 파트 조표 변경</button>',
  '<label for="v4-meter">선택 마디 이후 비어 있는 구간의 박자표</label><select id="v4-meter"><option value="2/4">2/4</option><option value="3/4" selected>3/4</option><option value="4/4">4/4</option><option value="6/8">6/8</option><option value="3/8">3/8</option><option value="2/2">2/2</option></select>',
  '<button id="v4-meter-empty" type="button">선택 마디부터 빈 악보 구간 박자 변경</button>',
  '<p class="v4-tiny">이미 음표가 작성된 마디를 자동으로 다시 나누지는 않습니다. 빈 구간의 쉼표·피아노 양손 시간 이동만 정확하게 조정합니다.</p>',
  '<label for="v4-layout">선택한 마디부터</label><select id="v4-layout"><option value="system">새 줄 시작</option><option value="page">새 페이지 시작</option><option value="none">줄·페이지 나눔 해제</option></select>',
  '<button id="v4-apply-layout" type="button">악보 전체 파트에 나눔 지시 적용</button>',
  '<p class="v4-tiny">MusicXML에 인쇄 지시를 기록합니다. 실제 줄·페이지 구분 반영 여부는 렌더러 및 브라우저에서 확인하세요.</p>',
  '<button id="v4-print-book" type="button">모든 파트 벡터 악보 인쇄 · PDF로 저장</button>',
  '<p class="v4-tiny">새 창에서 모든 악기를 개별 페이지로 나눈 후 브라우저 인쇄 → PDF로 저장합니다. 표준 출력에서는 악보 SVG를 JPEG로 변환하지 않습니다.</p>',
  '<button id="v4-vector-zip" type="button">벡터 SVG 페이지 ZIP 저장</button>',
  '<p class="v4-tiny">벡터 PDF는 상단의 ‘PDF로 인쇄 → PDF로 저장’을 사용하세요. 기존 ‘파트 PDF ZIP’은 JPEG 기반이므로 인쇄 전 검수가 필요합니다.</p>',
  '<p class="v4-subhead">05 / 간이 청음</p>',
  '<div class="v4-inline"><button id="v4-play" type="button">▶ 악보 재생</button><button id="v4-stop" type="button" disabled>■ 정지</button></div>',
  '<p id="v4-play-status" class="v4-tiny" role="status">Web Audio 기반 간이 신시사이저 · 음악적 표현과 실제 악기 음색을 재현하지 않습니다.</p>',
  '<p class="v4-subhead">06 / 음악 구조 무결성 검사</p>',
  '<button id="v4-audit-run" type="button">현재 악보의 박자·성부·연결 기호 검사</button>',
  '<p id="v4-audit-result" class="v4-tiny" role="status">검사 전입니다. 저장 전 최신 악보를 검사해 주세요.</p>',
  '<div id="v4-audit-details" class="v4-audit-details" aria-live="polite"></div>',
  '<p class="v4-tiny">기본 음악 구조 검사입니다. XSD 인증, Logic 호환성 검증, 인쇄물의 시각적 정확성을 대체하지 않습니다. 오류가 있어도 원본 백업을 위한 MusicXML 저장은 차단하지 않습니다.</p>',
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
    renderVoiceGrid();
    $('v4-audit-result').textContent='악보 변경 또는 재렌더링됨 · 저장 전 다시 검사해 주세요.';
    $('v4-audit-details').replaceChildren();
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
  function renderVoiceGrid(){
    const host=$('v4-beat-grid');
    host.replaceChildren();
    const pos=v3.getSelection();
    if(!state.doc||!pos.partId){host.textContent='악보를 열면 성부 시간표가 표시됩니다.';return;}
    let audit;
    try{audit=inspectAdvancedMeasure(state.doc,pos.partId,pos.measureIndex);}
    catch(error){host.textContent='시간표 확인 실패: '+error.message;return;}
    if(audit.reason){host.textContent='이 마디는 보호된 기보입니다: '+audit.reason;return;}
    if(!Number.isFinite(audit.max)||audit.max<=0){
      host.textContent='이 마디에서 시간축을 계산할 수 없습니다.';return;
    }
    const groups=new Map();
    for(const event of audit.events){
      const key='성부 '+event.voice+' · 보표 '+event.staff;
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(event);
    }
    const maxTicks=Math.max(audit.max,1);
    const widthPx=Math.max(660,Math.min(3600,Math.ceil(maxTicks/Math.max(1,audit.divisions))*190));
    const step=Number(audit.divisions)||1;
    for(const [name,events] of groups){
      const line=document.createElement('div');line.className='v4-beat-lane';
      const title=document.createElement('div');title.className='v4-beat-label';title.textContent=name;
      const scroll=document.createElement('div');scroll.className='v4-beat-scroll';
      const canvas=document.createElement('div');canvas.className='v4-beat-canvas';
      canvas.style.width=widthPx+'px';
      canvas.style.backgroundSize=Math.max(1,widthPx*step/maxTicks)+'px 100%';
      const sameStart=new Map();
      for(const e of events){
        const key=e.start+'@'+e.duration;
        const tier=sameStart.get(key)||0;
        sameStart.set(key,tier+1);
        const entry=document.createElement('button');
        entry.type='button';
        entry.className='v4-beat-event'+(e.eventIndex===pos.eventIndex?' selected':'')+
          (e.rest?' rest':'')+(e.chord?' chord':'');
        entry.style.left=Math.max(0,(e.start/maxTicks)*widthPx)+'px';
        entry.style.width=Math.max(28,Math.min(widthPx,(e.duration/maxTicks)*widthPx-5))+'px';
        entry.style.top=(6+(tier%3)*26)+'px';
        const symbol=e.rest?'쉼표':e.step+(e.alter===1?'♯':e.alter===-1?'♭':'')+e.octave;
        entry.textContent=symbol;
        entry.title=(e.eventIndex+1)+'번째 · '+name+' · 시작 '+e.start+
          ' · 길이 '+e.duration+' · '+(e.chord?'화음':'음표');
        entry.setAttribute('aria-label',entry.title);
        entry.setAttribute('aria-pressed',String(e.eventIndex===pos.eventIndex));
        entry.addEventListener('click',()=>v3.select({partId:pos.partId,
          measureIndex:pos.measureIndex,eventIndex:e.eventIndex}));
        entry.addEventListener('keydown',ev=>{
          if(!ev.shiftKey||!['ArrowLeft','ArrowRight'].includes(ev.key)||e.rest)return;
          ev.preventDefault();
          v3.select({partId:pos.partId,measureIndex:pos.measureIndex,eventIndex:e.eventIndex});
          void commit(doc=>nudgeVoiceNoteOnGrid(doc,{...selected(),
            direction:ev.key==='ArrowLeft'?'earlier':'later',grid:$('v4-grid-step').value}),
            '성부 음표 시작 위치 이동');
        });
        canvas.append(entry);
      }
      scroll.append(canvas);line.append(title,scroll);host.append(line);
    }
  }

  // Keep backward compatibility with 4.0's original simple-score controls,
  // but never depend on fields disabled for polyphony or tuplets.
  const proFieldIds={'v3-step':'v4-pro-step','v3-alter':'v4-pro-alter',
    'v3-octave':'v4-pro-octave','v3-length':'v4-pro-type'};
  const editInput=id=>$(id).disabled?$(proFieldIds[id]):$(id);
  function pitch(){return {step:editInput('v3-step').value,
    alter:Number(editInput('v3-alter').value),octave:Number(editInput('v3-octave').value)};}
  $('v4-insert-note').addEventListener('click',()=>void commit(doc=>editVoiceRhythm(doc,{
    ...selected(),mode:'insert',...pitch(),type:editInput('v3-length').value,
  }),'성부를 보존한 음표 삽입'));
  for(const [id,direction] of [['v4-nudge-earlier','earlier'],['v4-nudge-later','later']]){
    $(id).addEventListener('click',()=>void commit(doc=>nudgeVoiceNoteOnGrid(doc,{
      ...selected(),direction,grid:$('v4-grid-step').value,
    }),'성부 음표 시작 위치 이동'));
  }
  $('v4-pro-duration').addEventListener('click',()=>void commit(doc=>editVoiceRhythm(doc,{
    ...selected(),mode:'duration',type:$('v4-pro-type').value,
  }),'성부별 음표 길이 변경'));
  $('v4-pro-triplet').addEventListener('click',()=>void commit(doc=>createEighthTriplet(doc,{
    ...selected(),step:$('v4-pro-step').value,alter:Number($('v4-pro-alter').value),
    octave:Number($('v4-pro-octave').value),
  }),'8분음표 셋잇단음 변환'));
  const span=()=>({...selected(),endEventIndex:Number($('v4-pro-end').value)-1});
  $('v4-pro-slur').addEventListener('click',()=>void commit(doc=>toggleSlur(doc,span()),'이음줄 추가·해제'));
  $('v4-pro-hairpin').addEventListener('click',()=>void commit(doc=>addHairpin(doc,{
    ...span(),kind:$('v4-pro-wedge').value,
  }),'셈여림 변화 기보'));
  $('v4-add-tempo').addEventListener('click',()=>void commit(doc=>addExpression(doc,{
    ...selected(),kind:'tempo',value:Number($('v4-tempo').value),
  }),'템포 기보'));
  $('v4-add-dynamic').addEventListener('click',()=>void commit(doc=>addExpression(doc,{
    ...selected(),kind:'dynamic',value:$('v4-dynamic').value,
  }),'셈여림 기보'));
  $('v4-apply-articulation').addEventListener('click',()=>void commit(doc=>addExpression(doc,{
    ...selected(),kind:$('v4-articulation').value,
  }),'아티큘레이션 토글'));
  $('v4-lyric-set').addEventListener('click',()=>void commit(doc=>setNoteVerse(doc,{
    ...selected(),verse:Number($('v4-lyric-verse').value),text:$('v4-lyric-text').value,
    syllabic:$('v4-lyric-syllabic').value,extend:$('v4-lyric-extend').value,mode:'set',
  }),'가사 입력·교체'));
  $('v4-lyric-remove').addEventListener('click',()=>void commit(doc=>setNoteVerse(doc,{
    ...selected(),verse:Number($('v4-lyric-verse').value),mode:'remove',
  }),'선택 절 가사 삭제'));
  $('v4-tie-toggle').addEventListener('click',()=>void commit(doc=>toggleSoundingTie(doc,{
    ...selected(),endMeasureIndex:selected().measureIndex+Number($('v4-tie-next-measure').value),
    endEventIndex:Number($('v4-pro-end').value)-1,
  }),'실제 붙임줄 연결·해제'));
  $('v4-add-measures').addEventListener('click',()=>void commit(doc=>appendBlankMeasures(doc,{count:Number($('v4-measure-count').value)}),'빈 마디 추가'));
  $('v4-apply-key').addEventListener('click',()=>void commit(doc=>setSimpleKeySignature(doc,{fifths:Number($('v4-key').value)}),'전체 조표 변경'));
  $('v4-key-from-measure').addEventListener('click',()=>void commit(doc=>setKeyAtMeasure(doc,{measureIndex:selected().measureIndex,fifths:Number($('v4-key').value)}),'선택 마디 조표 변경'));
  $('v4-meter-empty').addEventListener('click',()=>void commit(doc=>{
    const [beats,beatType]=$('v4-meter').value.split('/').map(Number);
    return setMeterForEmptyTail(doc,{measureIndex:selected().measureIndex,beats,beatType});
  },'빈 구간 박자표 변경'));

  $('v4-apply-layout').addEventListener('click',()=>void commit(doc=>setScoreLayoutBreak(doc,{
    measureIndex:selected().measureIndex,kind:$('v4-layout').value,
  }),'줄·페이지 나눔'));
  $('v4-play').addEventListener('click',async()=>{
    if(!state.doc)return;
    try{
      const timeline=buildPlaybackTimeline(state.doc,{defaultBpm:Number($('v4-tempo').value)});
      await player.play(timeline);
      $('v4-play-status').textContent='재생 중 · '+timeline.events.length+'음 · 약 '+Math.ceil(timeline.durationSeconds)+'초 · '+timeline.tempoChanges.map(x=>x.bpm+' BPM').join(' → ')
        +(timeline.warnings.length?' · 주의: '+timeline.warnings.join(' / '):'');
    }catch(error){player.stop();setMessage('간이 재생 실패: '+error.message,true);}
  });
  $('v4-stop').addEventListener('click',()=>player.stop());
  $('v4-print-book').addEventListener('click',async()=>{
    if(!state.doc)return;
    const win=window.open('','_blank');
    if(!win){setMessage('브라우저가 인쇄용 새 창을 차단했습니다. 팝업을 허용해 주세요.',true);return;}
    win.document.title='J-WOO 벡터 파트보 준비 중';
    win.document.body.textContent='파트별 벡터 악보를 만들고 있습니다. 새 창을 닫지 마세요.';
    const button=$('v4-print-book');button.disabled=true;
    try{
      const partNodes=[...state.doc.documentElement.children].filter(p=>p.localName==='part');
      const names=new Map([...state.doc.querySelectorAll('part-list > score-part')].map(p=>[
        p.getAttribute('id'),p.querySelector('part-name')?.textContent||p.getAttribute('id'),
      ]));
      const parts=partNodes.map(p=>({id:p.getAttribute('id'),name:names.get(p.getAttribute('id'))||p.getAttribute('id')}));
      const pageFormat=$('page-orientation').value;
      const pages=await renderPartSvgPages({doc:state.doc,parts,pageFormat,
        measureNumbers:$('measure-numbers').checked,
        onProgress:detail=>setMessage('벡터 파트보 생성: '+detail)});
      if(win.closed){setMessage('인쇄용 창이 닫혀 출력이 취소됐습니다.',true);return;}
      const output=populateVectorPrintWindow(win,{pages,
        pageFormat,title:state.filename+' · J-WOO 벡터 파트보'});
      setMessage('벡터 파트보 '+output.pages+
        '페이지 준비 완료 · 새 창의 인쇄/PDF 저장 버튼을 누르세요. 실제 품질은 인쇄 미리보기에서 검수해야 합니다.');
    }catch(error){
      if(!win.closed)win.document.body.textContent='벡터 파트보 생성 실패: '+error.message;
      setMessage('벡터 파트보를 만들지 못했습니다: '+error.message,true);
    }finally{button.disabled=false;}
  });
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
  $('v4-audit-run').addEventListener('click',()=>{
    if(!state.doc){setMessage('먼저 악보를 열어 주세요.',true);return;}
    const target=$('v4-audit-details');
    target.replaceChildren();
    try{
      const report=auditMusicXml(state.doc);
      $('v4-audit-result').textContent=summarizeMusicXmlAudit(report)+
        ' · 검사범위: 기본 음악 구조만';
      const summary=document.createElement('p');
      summary.className='v4-tiny';
      summary.textContent='XSD·Logic 왕복·시각 품질은 미검증';
      target.append(summary);
      if(report.truncated){
        const omitted=document.createElement('p');
        omitted.className='v4-tiny';
        omitted.textContent='화면 표시 상한을 초과한 검사 항목 '+report.omittedIssues+
          '건이 추가로 있습니다. 전체 오류·주의 건수에는 포함됩니다.';
        target.append(omitted);
      }
      if(report.issues.length){
        const list=document.createElement('ol');
        list.className='v4-audit-list';
        for(const item of report.issues.slice(0,25)){
          const entry=document.createElement('li');
          entry.textContent=(item.severity==='ERROR'?'오류':'주의')+
            ' ['+item.code+'] '+(item.part?item.part+' / ':'')+
            (item.measure?'마디 '+item.measure+' · ':'')+item.message;
          list.append(entry);
        }
        target.append(list);
        if(report.issues.length>25){
          const more=document.createElement('p');
          more.className='v4-tiny';
          more.textContent='나머지 '+(report.issues.length-25)+
            '건은 화면에서 생략했습니다.';
          target.append(more);
        }
      }
      setMessage(report.errors?
        '음악 구조 오류가 '+report.errors+
          '건 발견됐습니다. 검수하지 않은 악보를 연주자에게 출고하지 마세요.':
        '기본 음악 구조 검사 완료. 조판·인쇄·Logic 왕복 검증은 별도로 필요합니다.',
        report.errors>0);
    }catch(error){
      $('v4-audit-result').textContent='검사 실패: '+error.message;
      setMessage('음악 구조 검사를 완료하지 못했습니다.',true);
    }
  });
  void refreshDrafts();
  return {beforeOpen,onRendered,onLoaded,onSelectionChange:renderVoiceGrid,stop:()=>player.stop()};
}
