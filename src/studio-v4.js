// J-WOO 4.0 integrated authoring workspace.
// Reuses V3 commitExternal for immutable edits, history, rollback, and re-render.
import {createBlankScore,placeNoteIntoRest,addExpression,setScoreLayoutBreak,appendBlankMeasures,setSimpleKeySignature,setScoreMeasureCount} from './studio-v4-core.js';
import {deleteMeasureRange} from './studio-v4-measure-blocks.js';
import {mountMeasureToolbar} from './studio-v4-measure-toolbar.js';
import {buildPlaybackTimeline,clipPlaybackToMeasures,createAuditionPlayer} from './studio-v4-playback.js';
import {saveLocalDraft,listLocalDrafts,loadLocalDraft,removeLocalDraft} from './studio-v4-drafts.js';
import {saveLocalCheckpoint,listLocalCheckpoints,loadLocalCheckpoint,removeLocalCheckpoint} from './studio-v4-checkpoints.js';
import {createPortableScoreProject,readPortableScoreProject} from './studio-v4-project-archive.js';
import {addIndependentVoice} from './studio-v4-add-voice.js';
import {moveNoteToRestingVoice} from './studio-v4-voice-transfer.js';
import {transferVoicePhrase,transferVoiceAcrossMeasures} from './studio-v4-voice-phrase.js';
import {addEmptyInstrumentPart} from './studio-v4-add-part.js';
import {createVectorPageZip} from './studio-v4-vector.js';
import {createPartSvgZip} from './studio-v4-part-svg.js';
import {createVectorPartPdfZip} from './studio-v4-vector-pdf.js';
import {baseScoreName} from './part-export.js';
import {auditMusicXml,summarizeMusicXmlAudit} from './studio-v4-audit.js';
import {editVoiceRhythm,createEighthTriplet,toggleSlur,addHairpin,nudgeVoiceNoteOnGrid,relocateVoiceNote,replaceVoiceNoteWithRest,splitVoiceNoteWithTie} from './studio-v4-professional.js';
import {editConnectedPitch} from './studio-v4-connected-pitch.js';
import {toggleAdvancedArticulation} from './studio-v4-articulations.js';
import {insertGraceNote,removeGraceNote} from './studio-v4-grace-notes.js';
import {authorTupletGroup} from './studio-v4-tuplet-groups.js';
import {editTupletPitches,inspectEditableTuplet} from './studio-v4-tuplet-pitch-edit.js';
import {rebarWrittenScore} from './studio-v4-rebar-written.js';
import {transposeChordChromatically} from './studio-v4-chord-transpose.js';
import {inspectAdvancedMeasure} from './advanced-score.js';
import {setNoteVerse,toggleSoundingTie} from './studio-v4-composer.js';
import {readChordSymbol,editChordSymbol} from './studio-v4-chords.js';
import {planBatchLyrics,applyBatchLyrics} from './studio-v4-lyrics-batch.js';
import {mountInlineLyricEditor} from './studio-v4-lyrics-floating.js';
import {planPlacedLyricShift,shiftPlacedLyrics} from './studio-v4-lyrics-shift.js';
import {renderPartSvgPages,populateVectorPrintWindow} from './studio-v4-printbook.js';
import {setKeyAtMeasure,setMeterForEmptyTail} from './studio-v4-meter.js';
import {extendVoiceAcrossBarline,toggleSlurAcrossBarline,moveVoiceIntoNextMeasure} from './studio-v4-crossbar.js';
import {applyLayoutCadence,planLayoutCadence} from './studio-v4-layout-cadence.js';
import {planDensityLayout,applyDensityLayout,planIndependentPartLayout,applyIndependentPartLayout} from './studio-v4-auto-layout.js';
import {changeSingleEmptyMeasureMeter} from './studio-v4-meter-single.js';
import './studio-v4.css';

const intro=[
  '<section class="v4-create" aria-label="새 악보와 임시 저장">',
  '<div class="v4-heading"><strong>J-WOO 4.0 COMPOSE</strong><span>NEW SCORE / LOCAL DRAFTS</span></div>',
  '<label for="v4-new-title">새 악보 제목</label><input id="v4-new-title" type="text" maxlength="120" placeholder="새 악보" value="새 악보" />',
  '<label for="v4-new-template">악보 구성</label><select id="v4-new-template"><option value="melody">멜로디 한 파트</option><option value="vocal">보컬 한 파트</option><option value="vocal-piano">보컬 + 피아노 양손(그랜드 스태프)</option></select>',
  '<label for="v4-new-measures">새 악보 생성 시 초기 마디 수 (4/4)</label><select id="v4-new-measures"><option>4</option><option selected>8</option><option>16</option><option>32</option></select>',
  '<button id="v4-new" type="button">+ 새 악보 작성</button>',
  '<div class="v4-draft-area"><strong>현재 악보에 악기 추가</strong>',
  '<label for="v4-add-part-name">새 파트 이름</label>',
  '<input id="v4-add-part-name" type="text" maxlength="80" value="New Part" />',
  '<label for="v4-add-part-type">악보·보표 유형</label>',
  '<select id="v4-add-part-type"><option value="melody">선율·높은음자리</option><option value="vocal">보컬</option><option value="bass">베이스·낮은음자리</option><option value="piano">피아노 양손·두 보표</option></select>',
  '<button id="v4-add-part" type="button" disabled>빈 악기 파트 추가</button>',
  '<p id="v4-add-part-status" class="v4-tiny" role="status" aria-live="polite">기존 악보의 박자·조표를 따라 빈 악기 파트를 추가합니다. 복잡한 다중 박자 악보는 보호됩니다.</p></div>',
  '<p class="v4-tiny">피아노는 하나의 파트 안에 높은음·낮은음자리표 두 보표와 독립 성부를 사용합니다. 4.0 전문 기보 입력을 활용하세요.</p>',
  '<p class="v4-tiny">위 초기 마디 수는 <strong>새 악보 작성</strong>을 누를 때만 적용됩니다. 현재 악보는 아래에서 변경하세요.</p>',
  '<div class="v4-draft-area"><label for="v4-current-total">현재 악보의 총마디 수 (파트마다 동일)</label>',
  '<div class="v4-inline"><input id="v4-current-total" type="number" min="1" max="128" step="1" placeholder="악보를 먼저 열어주세요" disabled />',
  '<button id="v4-apply-total" type="button" disabled>현재 악보 마디 수 적용</button></div>',
  '<p id="v4-total-status" class="v4-tiny" role="status">악보를 열면 현재 마디 수가 표시됩니다. 변경 후 Enter 또는 적용 버튼을 누르세요.</p>',
  '<p class="v4-tiny">마디를 늘리면 끝에 쉼표 마디가 추가됩니다. 줄일 때는 완전히 빈 마지막 마디만 삭제할 수 있어 음표는 보존됩니다.</p></div>',
  '<div class="v4-draft-area"><label for="v4-draft-select">기기에 임시 저장된 악보</label><select id="v4-draft-select"><option value="">불러오는 중…</option></select>',
  '<div class="v4-inline"><button id="v4-restore" type="button" disabled>임시 저장 복원</button><button id="v4-delete-draft" type="button" disabled>임시본 삭제</button></div>',
  '<p id="v4-draft-status" class="v4-tiny" role="status">기기 저장소를 확인합니다.</p></div>',
  '<div class="v4-draft-area"><strong>복원 시점 직접 보관 (덮어쓰기 방지)</strong>',
  '<label for="v4-checkpoint-label">복원 시점 메모</label><input id="v4-checkpoint-label" type="text" maxlength="80" placeholder="예: 후렴 편집 전" />',
  '<button id="v4-checkpoint-save" type="button" disabled>현재 악보를 복원 시점으로 저장</button>',
  '<label for="v4-checkpoint-select">이 기기에 보관된 복원 시점</label>',
  '<select id="v4-checkpoint-select"><option value="">불러오는 중…</option></select>',
  '<div class="v4-inline"><button id="v4-checkpoint-restore" type="button" disabled>선택 시점 복원</button>',
  '<button id="v4-checkpoint-delete" type="button" disabled>선택 시점 삭제</button></div>',
  '<p id="v4-checkpoint-status" class="v4-tiny" role="status">각 시점은 별도 저장되며 자동 저장에 덮어써지지 않습니다.</p>',
  '<p class="v4-tiny">최대 20개 · 총 32MiB. 삭제는 직접 확인해야 합니다. 이 브라우저의 저장소에만 보관됩니다.',
  ' 기기 초기화·브라우저 데이터 삭제에 대비해 MusicXML 파일도 별도 저장하세요.</p></div>',
  '<div class="v4-draft-area"><strong>프로젝트 파일로 전체 백업·복원</strong>',
  '<div class="v4-inline"><button id="v4-project-export" type="button" disabled>현재 악보 + 복원 시점 ZIP 백업</button>',
  '<button id="v4-project-import" type="button">프로젝트 ZIP 불러오기</button></div>',
  '<input id="v4-project-file" type="file" accept=".jwoo,.zip" hidden />',
  '<p id="v4-project-status" class="v4-tiny" role="status" aria-live="polite">.jwoo 프로젝트 파일은 MusicXML과 각 복원 시점의 SHA-256 검증 정보를 함께 보관합니다.</p>',
  '<p class="v4-tiny">브라우저 저장 데이터가 지워져도 별도로 보관한 프로젝트 파일에서 복원할 수 있습니다. 기존 악보를 교체하기 전 확인을 요청합니다.</p></div>',
  '</section>',
].join('');
const panel=[
  '<section class="control-group v4-editor" aria-label="4.0 작곡·기보·재생">',
  '<div class="control-heading"><span>작곡·가사·악보 구성</span><span>11</span></div>',
  '<p class="control-hint">09 / 음표 편집에서 파트·마디·음표를 선택하거나, 오른쪽 악보의 음표를 직접 클릭하세요. 변경 내용은 실행 취소할 수 있습니다.</p>',
  '<p class="v4-subhead">01 / 음표와 악상</p>',
  '<button id="v4-insert-note" type="button">선택 쉼표에 지정한 음정·길이의 음표 삽입</button>',
  '<p class="v4-tiny">09 / 음표 편집에 입력된 음정·길이를 사용합니다. 남는 박자는 쉼표로 채우며, 안전하게 처리할 수 없는 성부는 보호합니다.</p>',
  '<div class="v4-inline"><div><label for="v4-tempo">템포 (BPM)</label><input id="v4-tempo" type="number" min="30" max="240" value="100" /></div><div><label for="v4-dynamic">셈여림</label><select id="v4-dynamic"><option>pp</option><option>p</option><option>mp</option><option selected>mf</option><option>f</option><option>ff</option></select></div></div>',
  '<div class="v4-inline"><button id="v4-add-tempo" type="button">템포 기보</button><button id="v4-add-dynamic" type="button">셈여림 기보</button></div>',
  '<label for="v4-articulation">아티큘레이션</label><select id="v4-articulation"><option value="staccato">스타카토</option><option value="tenuto">테누토</option><option value="accent">악센트</option></select>',
  '<button id="v4-apply-articulation" type="button">선택 음표에 추가 / 해제</button>',
  '<p class="v4-subhead">02 / 다성부·셋잇단음·이음줄</p>',
  '<p class="v4-tiny">선택한 악기 파트 전체에 독립적인 빈 성부를 추가한 뒤 09 / 음표 편집에서 해당 성부의 쉼표를 선택해 입력할 수 있습니다.</p>',
  '<div class="v4-inline"><div><label for="v4-add-voice-number">추가 성부</label>',
  '<select id="v4-add-voice-number"><option value="2">2성부</option><option value="3">3성부</option><option value="4">4성부</option></select></div>',
  '<div><label for="v4-add-voice-staff">악기 보표</label>',
  '<select id="v4-add-voice-staff"><option value="1">위/첫째 보표</option><option value="2">둘째 보표</option></select></div></div>',
  '<button id="v4-add-voice" type="button">선택 악기에 새 독립 성부 생성</button>',
  '<p id="v4-add-voice-status" class="v4-tiny" role="status" aria-live="polite">기존 음표·가사·리듬을 이동하지 않고 새로운 성부를 만듭니다. 기존 성부 번호와 겹치면 생성하지 않습니다.</p>',
  '<div class="v4-inline"><label for="v4-transfer-voice">선택 음표 이동 대상 성부</label>',
  '<select id="v4-transfer-voice"><option value="1">1성부</option><option value="2" selected>2성부</option><option value="3">3성부</option><option value="4">4성부</option></select>',
  '<button id="v4-transfer-note" type="button">다른 성부의 빈 쉼표로 음표 이동</button></div>',
  '<p id="v4-transfer-status" class="v4-tiny" role="status" aria-live="polite">선택 음표의 박자 구간을 포함하는 다른 성부의 쉼표로 음표·가사를 이동합니다. 앞·뒤의 남는 박자는 정확한 쉼표로 나누고 원래 성부 시간은 보존합니다.</p>',
  '<label for="v4-transfer-phrase-end">구간 이동 마지막 음표 목록 번호 (선택 음표부터, 1부터 시작)</label>',
  '<div class="v4-inline"><input id="v4-transfer-phrase-end" type="number" min="2" max="9999" step="1" value="4" />',
  '<button id="v4-transfer-phrase" type="button">연속 음표를 다른 성부로 일괄 이동</button></div>',
  '<p id="v4-transfer-phrase-status" class="v4-tiny" role="status" aria-live="polite">선택한 음표부터 마지막 목록 번호까지 연속된 2~16개 음표를 대상 성부의 빈 박자 공간으로 옮깁니다. 가사도 함께 이동합니다.</p>',
  '<label for="v4-transfer-measures-end">여러 마디 이동 마지막 마디 번호 (1부터 시작)</label>',
  '<div class="v4-inline"><input id="v4-transfer-measures-end" type="number" min="2" max="256" step="1" value="2" />',
  '<button id="v4-transfer-measures" type="button">연속 마디 전체 성부 이동</button></div>',
  '<p id="v4-transfer-measures-status" class="v4-tiny" role="status" aria-live="polite">선택한 음표가 속한 성부를 시작 마디부터 마지막 마디까지(2~8마디) 대상 성부로 이동합니다. 각 마디의 박자 전체를 채운 일반 음표 성부만 지원합니다.</p>',
  '<p class="v4-tiny">악보에서 음표를 선택하세요. 같은 성부의 박자 합계를 유지하며, 지원하지 않는 복합 표기는 보호합니다.</p>',
  '<p class="v4-tiny">다성부 악보에서는 09 / 음표 편집의 일부 입력이 제한되므로, 아래의 별도 음정·길이 설정을 사용하세요.</p>',
  '<div class="v4-inline"><div><label for="v4-pro-step">음이름</label><select id="v4-pro-step"><option>C</option><option>D</option><option>E</option><option>F</option><option>G</option><option>A</option><option>B</option></select></div><div><label for="v4-pro-octave">옥타브</label><select id="v4-pro-octave"><option>2</option><option>3</option><option selected>4</option><option>5</option><option>6</option><option>7</option></select></div></div>',
  '<label for="v4-pro-alter">변화표</label><select id="v4-pro-alter"><option value="-2">𝄫</option><option value="-1">♭</option><option value="0" selected>♮</option><option value="1">♯</option><option value="2">𝄪</option></select>',
  '<label for="v4-pro-type">음표 길이</label><select id="v4-pro-type"><option value="whole">온음표</option><option value="half">2분음표</option><option value="half-dotted">점2분음표</option><option value="quarter" selected>4분음표</option><option value="quarter-dotted">점4분음표</option><option value="eighth">8분음표</option><option value="eighth-dotted">점8분음표</option><option value="16th">16분음표</option><option value="16th-dotted">점16분음표</option><option value="32nd">32분음표</option></select>',
  '<button id="v4-pro-insert" type="button">전문 입력 · 선택 쉼표에 음표 삽입</button>',
  '<div class="v4-inline"><button id="v4-pro-duration" type="button">선택 음표 길이 변경</button><button id="v4-pro-to-rest" type="button">선택 음표 → 쉼표</button></div>',
  '<button id="v4-connected-pitch" type="button">선택 음표·붙임줄 전체 음정 변경</button>',
  '<div class="v4-inline"><label for="v4-articulation-kind">아티큘레이션</label>',
  '<select id="v4-articulation-kind"><option value="staccato">스타카토</option>',
  '<option value="staccatissimo">스타카티시모</option><option value="tenuto">테누토</option>',
  '<option value="accent">악센트</option><option value="strong-accent">강한 악센트</option>',
  '<option value="detached-legato">포르타토</option><option value="spiccato">스피카토</option></select>',
  '<button id="v4-articulation-toggle" type="button">선택 음표에 표현 기호 추가 / 해제</button></div>',
  '<p class="v4-tiny">다성부·붙임줄·잇단음·가사·화음 첫 음표에서도 박자를 변경하지 않고 표현 기호만 수정합니다. 실행 취소가 가능합니다.</p>',
  '<div class="v4-inline"><label class="v4-timeline-move-check"><input id="v4-grace-slash" type="checkbox" checked /> 짧은 꾸밈음 (빗금 표시)</label>',
  '<button id="v4-grace-insert" type="button">선택 음표 앞에 꾸밈음 삽입</button>',
  '<button id="v4-grace-remove" type="button">선택한 꾸밈음 삭제</button></div>',
  '<p class="v4-tiny">음이름·변화표·옥타브는 위의 전문 음정 입력값을 사용합니다. 꾸밈음은 음표의 박자를 소비하지 않으며 가사와 다른 성부의 시간을 바꾸지 않습니다.</p>',
  '<p class="v4-tiny">위의 음이름·변화표·옥타브를 사용합니다. 붙임줄의 시작·중간·끝 중 어느 음표를 선택해도 연결된 모든 음표의 음정을 함께 바꾸고 가사·리듬·이음줄은 보존합니다. 악보에서 직접 선택할 수 없는 보호 음표는 09 / 음표 목록에서 선택하세요.</p>',
  '<p class="v4-tiny">다성부에서도 성부·보표를 유지합니다. 가사·붙임줄·화음·셋잇단음 등 복합 기보는 보호됩니다.</p>',
  '<div class="v4-inline"><div><label for="v4-split-type">붙임줄로 나눌 첫 음표 길이</label><select id="v4-split-type"><option value="half">2분음표</option><option value="quarter" selected>4분음표</option><option value="eighth">8분음표</option><option value="16th">16분음표</option><option value="32nd">32분음표</option></select></div><button id="v4-split-tie" type="button">선택 음표 분할·붙임줄 연결</button></div>',
  '<p class="v4-tiny">선택 음표를 정확한 길이의 두 음표로 나누고 재생·기보용 붙임줄을 함께 만듭니다. 가사는 첫 음표에 보존합니다. 분할 가능한 길이만 적용됩니다.</p>',
  '<div class="v4-crossbar"><p class="v4-subhead">마디 경계 · 이어지는 음표</p>',
  '<div class="v4-inline"><div><label for="v4-crossbar-type">다음 마디에서 이어질 음표 길이</label><select id="v4-crossbar-type"><option value="half">2분음표</option><option value="quarter" selected>4분음표</option><option value="eighth">8분음표</option><option value="16th">16분음표</option><option value="32nd">32분음표</option></select></div>',
  '<button id="v4-crossbar-extend" type="button">마디 넘어 붙임줄로 연장</button></div>',
  '<button id="v4-crossbar-move" type="button">선택 음표를 다음 마디 첫 박자로 이동</button>',
  '<p class="v4-tiny">위의 연장과 달리 실제 음표를 다음 마디로 옮깁니다. 원래 위치는 같은 길이의 쉼표로 바꾸며, 다음 마디에 충분한 쉼표가 있는 경우만 이동합니다.</p>',
  '<p class="v4-tiny">현재 마디 끝 음표와 다음 마디 첫 쉼표를 연결합니다. 기존 음정·가사·성부는 보존하고, 다른 성부는 변경하지 않습니다.</p></div>',
  '<label for="v4-grid-step">시작 위치 이동 간격</label><select id="v4-grid-step"><option value="eighth">8분음표</option><option value="16th" selected>16분음표</option><option value="32nd">32분음표</option></select>',
  '<div class="v4-inline"><button id="v4-nudge-earlier" type="button">← 선택 음표를 앞 쉼표로 이동</button><button id="v4-nudge-later" type="button">선택 음표를 뒤 쉼표로 이동 →</button></div>',
  '<div class="v4-relocate-panel"><label for="v4-relocate-beat">선택 음표를 이동할 박자 위치 (1부터, 4분음표 기준)</label>',
  '<div class="v4-inline"><input id="v4-relocate-beat" type="number" min="1" step="any" value="1" aria-describedby="v4-relocate-status" /><button id="v4-relocate-note" type="button">지정한 박자로 이동</button></div>',
  '<p id="v4-relocate-status" class="v4-tiny" role="status" aria-live="polite">음표를 선택한 후 목표 박자를 입력하세요. 2.5는 두 번째 박자의 중간입니다.</p>',
  '<label class="v4-timeline-move-check"><input id="v4-timeline-move" type="checkbox" /> 시간표에서 쉼표를 눌러 선택 음표 이동</label>',
  '<label class="v4-timeline-move-check"><input id="v4-timeline-insert" type="checkbox" /> 시간표에서 쉼표를 눌러 새 음표 입력</label>',
  '<p class="v4-tiny">새 음표 입력은 위 음이름·변화표·옥타브·길이 설정을 사용합니다. 두 모드 중 하나만 선택할 수 있습니다.</p>',
  '<p class="v4-tiny">같은 성부·보표의 연속된 쉼표 안에서 이동합니다. 다른 음표·마디·붙임줄·셋잇단음·빔은 넘지 않습니다. 변경은 실행 취소할 수 있습니다.</p></div>',
  '<p class="v4-subhead">현재 마디 성부 시간표</p>',
  '<p class="v4-tiny">음표를 선택해 위치를 확인하세요. Shift+←/→로 한 격자씩 이동하거나, 위에서 이동·입력 모드를 선택하고 빈 쉼표를 클릭하세요.</p>',
  '<div id="v4-beat-grid" class="v4-beat-grid" role="group" aria-label="마디 성부별 음표 시작 위치" tabindex="0"></div>',
  '<label class="v4-timeline-move-check v4-keyboard-enable"><input id="v4-keys-enabled" type="checkbox" /> 키보드 작곡 단축키 사용 (선택 기능)</label>',
  '<p class="v4-tiny">편집 화면에서 영문 N: 선택 쉼표에 음표 입력 · R: 음표를 쉼표로 변경 · [ / ]: 앞/뒤 쉼표로 한 격자 이동. 텍스트 입력 중에는 작동하지 않습니다.</p>',
  '<button id="v4-pro-triplet" type="button">4·8·16분음표 두 개 → 셋잇단음 세 개</button>',
  '<p class="v4-tiny">같은 성부·보표의 동일 길이 음표 두 개를 선택하세요. 3:2 박자를 정확히 표현할 수 있는 경우에만 변환합니다. 복잡한 빔·가사·붙임줄은 보호됩니다.</p>',
  '<div class="v4-common-tuplets"><p class="v4-subhead">잇단음 그룹 · 3:2 / 5:4 / 6:4 / 7:4</p>',
  '<div class="v4-inline"><div><label for="v4-tuplet-ratio">잇단음 비율</label><select id="v4-tuplet-ratio"><option value="3:2">3:2 · 셋잇단음</option><option value="5:4" selected>5:4 · 다섯잇단음</option><option value="6:4">6:4 · 여섯잇단음</option><option value="7:4">7:4 · 일곱잇단음</option></select></div>',
  '<div><label for="v4-tuplet-unit">기본 음표 길이</label><select id="v4-tuplet-unit"><option value="quarter">4분음표</option><option value="eighth">8분음표</option><option value="16th" selected>16분음표</option><option value="32nd">32분음표</option></select></div></div>',
  '<button id="v4-tuplet-author" type="button">선택 위치부터 잇단음 그룹 만들기</button>',
  '<label for="v4-tuplet-pitches">기존 잇단음 그룹 음정 일괄 수정</label>',
  '<div class="v4-inline"><input id="v4-tuplet-pitches" type="text" maxlength="180" placeholder="C4 D4 Eb4 F#4 G4" aria-describedby="v4-tuplet-pitches-status" />',
  '<button id="v4-tuplet-pitches-apply" type="button">선택 잇단음 음정 수정</button></div>',
  '<p id="v4-tuplet-pitches-status" class="v4-tiny" role="status" aria-live="polite">잇단음 중 한 음표를 선택하고 그룹 안의 3~7개 음정을 띄어쓰기로 입력하세요. 리듬·가사·다른 성부는 유지합니다.</p>',
  '<p class="v4-tiny">3:2는 원래 음표 2개, 5:4·6:4·7:4는 4개가 필요합니다. 동일 성부의 동일 길이 일반 음표가 연속되어야 하며, 생성되는 추가 음은 위 음이름·변화표·옥타브를 사용합니다.</p>',
  '<p class="v4-tiny">분할값이 부족하면 해당 파트의 MusicXML divisions를 정확히 확장합니다. 복잡한 빔·붙임줄·화음·보호된 표시가 있으면 변경하지 않습니다.</p></div>',
  '<div class="v4-chord-transpose"><p class="v4-subhead">화음 전체 반음 이동</p>',
  '<div class="v4-inline"><div><label for="v4-chord-semitones">반음 이동 (음수는 아래로)</label><input id="v4-chord-semitones" type="number" min="-12" max="12" step="1" value="2" /></div>',
  '<div><label for="v4-chord-spelling">변화표 선택</label><select id="v4-chord-spelling"><option value="sharp" selected>샤프 기준</option><option value="flat">플랫 기준</option></select></div></div>',
  '<button id="v4-chord-transpose" type="button">선택 화음 전체 이동</button>',
  '<p class="v4-tiny">화음의 아무 음이나 선택한 후 사용하세요. 모든 구성 음을 같은 반음 수만큼 이동하며, 성부와 음표 길이는 변경하지 않습니다. 기존 붙임줄·특수 기보는 보호합니다.</p></div>',
  '<label for="v4-pro-end">이음줄·크레셴도 끝 음표의 목록 번호 (1부터 시작)</label>',
  '<input id="v4-pro-end" type="number" min="2" max="9999" step="1" value="2" />',
  '<label for="v4-slur-next-measure">이음줄 끝 마디</label><select id="v4-slur-next-measure"><option value="0">현재 마디</option><option value="1">다음 마디</option><option value="2">2마디 뒤</option><option value="3">3마디 뒤</option><option value="4">4마디 뒤</option><option value="8">8마디 뒤</option></select>',
  '<button id="v4-pro-slur" type="button">선택 음표부터 끝 음표까지 이음줄 추가 / 해제</button>',
  '<label for="v4-pro-wedge">셈여림 변화</label><select id="v4-pro-wedge"><option value="crescendo">크레셴도 &lt;</option><option value="diminuendo">디미누엔도 &gt;</option></select>',
  '<button id="v4-pro-hairpin" type="button">선택 음표부터 끝 음표까지 셈여림 변화 추가</button>',
  '<p class="v4-subhead">03 / 보컬 가사 · 붙임줄</p>',
  '<p class="v4-tiny">가사는 선택된 선율 음표에 입력하며, 1~12절을 독립적으로 수정할 수 있습니다. 붙임줄은 같은 음정의 연속된 음표를 연결합니다.</p>',
  '<div class="v4-inline"><div><label for="v4-lyric-verse">가사 절 번호</label><input id="v4-lyric-verse" type="number" min="1" max="12" step="1" value="1" /></div><div><label for="v4-lyric-syllabic">음절 연결</label><select id="v4-lyric-syllabic"><option value="single">단일 음절</option><option value="begin">시작</option><option value="middle">중간</option><option value="end">끝</option></select></div></div>',
  '<label for="v4-lyric-text">가사 (한국어·영어 지원)</label><input id="v4-lyric-text" type="text" maxlength="100" placeholder="이 음표에 들어갈 한 음절" />',
  '<label for="v4-lyric-extend">멜리스마 연장선</label><select id="v4-lyric-extend"><option value="none">없음</option><option value="start">연장 시작</option><option value="continue">연장 계속</option><option value="stop">연장 종료</option></select>',
  '<div class="v4-inline"><button id="v4-lyric-set" type="button">가사 입력·교체</button><button id="v4-lyric-remove" type="button">선택 절 가사 삭제</button></div>',
  '<div class="v4-batch-lyrics" role="group" aria-label="스마트 가사 일괄 입력">',
  '<p class="v4-subhead">03A / 스마트 가사 일괄 입력</p>',
  '<p class="v4-tiny">악보에서 시작 음표를 선택하고 가사 전체를 붙여넣으세요. 한글은 글자마다 한 음표에 배치하며 공백은 단어 경계입니다. 단독 _ 기호는 앞 음절의 멜리스마를 다음 음표로 연장합니다.</p>',
  '<label for="v4-lyrics-batch-text">붙여넣을 가사 (선택한 절에 적용)</label>',
  '<textarea id="v4-lyrics-batch-text" rows="5" maxlength="20000" placeholder="오늘도 너를 생각해&#10;우리 함께 걷던 그 길"></textarea>',
  '<label class="v4-batch-check"><input id="v4-lyrics-batch-overwrite" type="checkbox" /> 이미 입력된 해당 절 가사 덮어쓰기 (기본 보호)</label>',
  '<div class="v4-inline"><button id="v4-lyrics-batch-preview" type="button">배치 가능 여부 확인</button><button id="v4-lyrics-batch-apply" type="button">가사 전체 적용</button></div>',
  '<p id="v4-lyrics-batch-status" class="v4-tiny" role="status" aria-live="polite">성부·보표·음표 수를 확인한 후 원자적으로 적용합니다. 기존 음정과 박자는 변경하지 않습니다.</p>',
  '</div>',
  '<div class="v4-batch-lyrics" role="group" aria-label="배치 후 가사 위치 수정">',
  '<p class="v4-subhead">03B / 배치 후 가사 위치 수정</p>',
  '<p class="v4-tiny">악보에서 가사가 있는 음표를 선택하세요. 선택한 절의 음절부터 뒤에 연속된 가사를 한 음표씩 밀거나 당깁니다. 다른 절·성부·음정·박자는 유지됩니다. 빈 음표가 없거나 멜리스마를 훼손할 위험이 있으면 적용하지 않습니다.</p>',
  '<div class="v4-inline"><button id="v4-lyric-shift-left" type="button">← 이후 가사 한 음표 당기기</button><button id="v4-lyric-shift-right" type="button">이후 가사 한 음표 밀기 →</button></div>',
  '<p id="v4-lyric-shift-status" class="v4-tiny" role="status" aria-live="polite">이동할 가사 음절을 선택하고 방향을 눌러 주세요. 09 / 음표 편집의 실행 취소·다시 실행과 연결됩니다.</p>',
  '</div>',
  '<label for="v4-tie-next-measure">붙임줄 끝 마디</label><select id="v4-tie-next-measure"><option value="0">현재 마디</option><option value="1">다음 마디</option></select>',
  '<button id="v4-tie-toggle" type="button">선택 음표와 끝 음표의 붙임줄 연결 / 해제</button>',
  '<p class="v4-tiny">끝 음표 번호는 02 / 이음줄·셈여림 변화에서 지정합니다. 붙임줄은 같은 성부·음정에만 적용됩니다.</p>',
  '<p class="v4-subhead">04 / 악보 확장·조표·조판</p>',
  '<label for="v4-measure-count">빈 4/4 마디 추가</label><select id="v4-measure-count"><option value="1">1마디</option><option value="4" selected>4마디</option><option value="8">8마디</option><option value="16">16마디</option></select>',
  '<button id="v4-add-measures" type="button">모든 파트에 빈 마디 추가</button>',
  '<div class="v4-measure-delete" role="group" aria-label="악보 마디 삭제">',
  '<p id="v4-delete-measure-status" class="v4-tiny" role="status">09 / 음표 편집에서 삭제할 마디를 선택해 주세요.</p>',
  '<button id="v4-delete-measure" type="button" disabled>선택한 마디 삭제</button>',
  '<p class="v4-tiny">선택한 마디를 모든 파트에서 삭제하고 뒤의 마디를 당깁니다. 해당 마디의 음표·가사·코드도 삭제되며, 실행 취소로 되돌릴 수 있습니다. 복잡한 연결 기호나 조표·박자표 변경은 보호됩니다.</p></div>',
  '<label for="v4-key">조표 (장조 표기·음정 자체는 변경하지 않음)</label>',
  '<select id="v4-key"><option value="-3">E♭ (플랫 3)</option><option value="-2">B♭ (플랫 2)</option><option value="-1">F (플랫 1)</option><option value="0" selected>C (변화표 없음)</option><option value="1">G (샤프 1)</option><option value="2">D (샤프 2)</option><option value="3">A (샤프 3)</option><option value="4">E (샤프 4)</option><option value="5">B (샤프 5)</option></select>',
  '<button id="v4-apply-key" type="button">모든 파트 조표 변경</button>',
  '<button id="v4-key-from-measure" type="button">선택 마디부터 모든 파트 조표 변경</button>',
  '<label for="v4-meter">선택 마디 이후 비어 있는 구간의 박자표</label><select id="v4-meter"><option value="2/4">2/4</option><option value="3/4" selected>3/4</option><option value="4/4">4/4</option><option value="6/8">6/8</option><option value="3/8">3/8</option><option value="2/2">2/2</option></select>',
  '<div class="v4-inline"><button id="v4-meter-empty" type="button">선택 마디 이후 빈 구간 박자 변경</button>',
  '<button id="v4-meter-single" type="button">선택한 빈 마디만 박자 변경</button></div>',
  '<p class="v4-tiny">선택한 빈 마디만 변경하면 다음 마디에는 기존 박자표를 자동 복구합니다. 다른 음표가 작성된 마디를 자동으로 재분할하지는 않습니다.</p>',
  '<div class="v4-written-rebar"><p class="v4-subhead">작성된 악보 전체 리바링 · 최대 4개 성부</p>',
  '<div class="v4-inline"><div><label for="v4-rebar-meter">새 박자표</label><select id="v4-rebar-meter"><option value="2/4">2/4</option><option value="3/4" selected>3/4</option><option value="4/4">4/4</option><option value="3/8">3/8</option><option value="6/8">6/8</option></select></div>',
  '<button id="v4-rebar-written" type="button">작성된 음표를 새 박자로 재분할</button></div>',
  '<p class="v4-tiny">모든 파트가 최대 4개의 독립 성부·보표로 구분되고 각 성부의 마디 시간이 정확할 때 전체 악보를 재분할합니다. 기존 음표 길이와 순서를 보존하며, 마디를 넘는 긴 음표는 붙임줄로 연결합니다. 마지막 마디의 부족한 박자는 쉼표로 채웁니다.</p>',
  '<p class="v4-tiny">기존 단순 화음도 음정별 붙임줄로 재분할하며, 각 성부의 원래 리듬과 가사는 보존합니다. 잇단음·이미 연결된 붙임줄·중간 조표·악상·특수 표기는 보호합니다. 실행 전 원본 MusicXML을 별도로 저장하세요.</p></div>',
  '<label for="v4-layout">선택한 마디부터</label><select id="v4-layout"><option value="system">새 줄 시작</option><option value="page">새 페이지 시작</option><option value="none">줄·페이지 나눔 해제</option></select>',
  '<button id="v4-apply-layout" type="button">악보 전체 파트에 나눔 지시 적용</button>',
  '<p class="v4-tiny">MusicXML에 인쇄 지시를 기록합니다. 실제 줄·페이지 구분 반영 여부는 렌더러 및 브라우저에서 확인하세요.</p>',
  '<div class="v4-cadence-panel"><p class="v4-subhead">악보 전체 자동 줄·페이지 나눔 계획</p>',
  '<div class="v4-inline"><div><label for="v4-cadence-bars">한 줄에 배치할 마디 수</label><select id="v4-cadence-bars"><option value="2">2마디</option><option value="3">3마디</option><option value="4" selected>4마디</option><option value="5">5마디</option><option value="6">6마디</option><option value="8">8마디</option></select></div>',
  '<div><label for="v4-cadence-systems">한 페이지에 배치할 줄 수</label><select id="v4-cadence-systems"><option value="2">2줄</option><option value="3">3줄</option><option value="4" selected>4줄</option><option value="5">5줄</option><option value="6">6줄</option></select></div></div>',
  '<label class="v4-timeline-move-check"><input id="v4-cadence-replace" type="checkbox" /> 기존 수동 줄·페이지 나눔 대체 허용</label>',
  '<button id="v4-cadence-apply" type="button">모든 파트에 줄·페이지 나눔 적용</button>',
  '<p id="v4-cadence-status" class="v4-tiny" role="status" aria-live="polite">모든 파트의 마디 수가 같아야 합니다. 기존 수동 나눔은 기본적으로 보호됩니다.</p>',
  '<button id="v4-auto-layout" type="button">곡 밀도 기반 자동 줄·페이지 나눔</button>',
  '<p id="v4-auto-layout-status" class="v4-tiny" role="status" aria-live="polite">음표·가사·화음 밀도에 따라 모든 파트의 줄과 페이지 시작을 자동 제안합니다.</p>',
  '<button id="v4-part-layout" type="button">악기별 파트보 개별 자동 조판</button>',
  '<p id="v4-part-layout-status" class="v4-tiny" role="status" aria-live="polite">보컬과 피아노 등의 밀도가 다르면 각 악기의 줄바꿈과 페이지 나눔을 독립적으로 계산합니다. 기존 수동 지시는 보호됩니다.</p>',
  '<p class="v4-tiny">이 기능은 MusicXML 줄·페이지 나눔을 한꺼번에 작성합니다. 음표·가사 충돌을 자동 해소하는 조판 엔진은 아닙니다.</p></div>',
  '<button id="v4-print-book" type="button">모든 파트 벡터 악보 인쇄 · PDF로 저장</button>',
  '<p class="v4-tiny">새 창에서 모든 악기를 개별 페이지로 나눈 후 브라우저 인쇄 → PDF로 저장합니다. 미리보기의 조판 간격 선택도 파트보에 적용됩니다. 표준 출력에서는 악보 SVG를 JPEG로 변환하지 않습니다.</p>',
  '<button id="v4-part-svg-zip" type="button">모든 파트 SVG ZIP 저장 (벡터)</button>',
  '<button id="v4-part-pdf-zip" type="button">파트별 PDF ZIP 생성 (음표·오선 벡터)</button>',
  '<label class="v4-timeline-move-check"><input id="v4-pdf-unicode-raster" type="checkbox" /> 한글·특수문자 텍스트만 고해상도 이미지로 포함 (하이브리드 PDF)</label>',
  '<label for="v4-pdf-local-font">선택한 로컬 TTF를 PDF에 내장해 한글 벡터 글자로 출력 (선택 사항)</label>',
  '<input id="v4-pdf-local-font" type="file" accept=".ttf,font/ttf" />',
  '<p class="v4-tiny">직접 사용할 권리가 있는 TTF 글꼴만 선택하세요. 최대 8MiB이며 브라우저에서만 읽고 서버로 보내거나 보관하지 않습니다. 글꼴의 한글 포함·내장 가능 여부와 PDF 내장 객체를 검사합니다. 글꼴을 선택하면 하이브리드 이미지보다 벡터 글자를 우선합니다.</p>',
  '<p class="v4-tiny">음표·오선을 벡터 PDF로 묶습니다. 한글은 선택한 로컬 TTF의 글자·내장 검사가 통과하면 벡터로 출력하며, TTF가 없으면 이미지 옵션으로 하이브리드 출력하거나 브라우저 벡터 인쇄를 사용하세요. 폰트·시각적 품질은 PDF 뷰어에서 확인해야 합니다.</p>',
  '<p class="v4-tiny">각 악기 파트의 모든 SVG 페이지를 각각 이름 붙여 압축합니다. 이미지로 변환하지 않지만 PDF 파일은 아닙니다.</p>',
  '<button id="v4-vector-zip" type="button">현재 미리보기 SVG ZIP 저장</button>',
  '<p class="v4-tiny">벡터 PDF는 미리보기 상단 ‘인쇄 · PDF 저장’을 이용하세요. 08 / 파트별 PDF ZIP은 이미지 기반 출력입니다.</p>',
  '<p class="v4-subhead">05 / 간이 청음</p>',
  '<div class="v4-inline"><button id="v4-play" type="button">▶ 악보 재생</button><button id="v4-play-range" type="button">▶ 선택 마디 청음</button><button id="v4-stop" type="button" disabled>■ 정지</button></div>',
  '<label class="v4-timeline-move-check"><input id="v4-loop-range" type="checkbox" /> 선택 마디 반복 청음 (■ 정지로 종료)</label>',
  '<p id="v4-play-status" class="v4-tiny" role="status">Web Audio 기반 간이 신시사이저 · 음악적 표현과 실제 악기 음색을 재현하지 않습니다.</p>',
  '<p id="v4-playing-measure" class="v4-tiny" role="status" aria-live="off">악보 재생 위치를 여기에서 표시합니다.</p>',
  '<p class="v4-subhead">06 / 음악 구조 무결성 검사</p>',
  '<button id="v4-audit-run" type="button">현재 악보의 박자·성부·연결 기호 검사</button>',
  '<p id="v4-audit-result" class="v4-tiny" role="status">검사 전입니다. 저장 전 최신 악보를 검사해 주세요.</p>',
  '<div id="v4-audit-details" class="v4-audit-details" aria-live="polite"></div>',
  '<p class="v4-tiny">기본 음악 구조 검사입니다. XSD 인증, Logic 호환성 검증, 인쇄물의 시각적 정확성을 대체하지 않습니다. 오류가 있어도 원본 백업을 위한 MusicXML 저장은 차단하지 않습니다.</p>',
  '</section>',
].join('');

const chordPanel=[
  '<section class="control-group v4-chord-editor" aria-label="악보 코드 기호 편집">',
  '<div class="control-heading"><span>코드 기호 입력·수정</span><span>12</span></div>',
  '<p class="control-hint">악보 위 음표를 선택한 뒤 C, Am7, F#maj7, Bb/D처럼 코드를 입력하세요. 음정과 박자는 변경하지 않습니다.</p>',
  '<p id="v4-chord-location" class="v4-tiny" role="status">코드를 넣을 음표를 선택해 주세요.</p>',
  '<label for="v4-chord-input">선택 음표의 코드</label>',
  '<input id="v4-chord-input" type="text" maxlength="24" autocomplete="off" spellcheck="false" placeholder="예: Am7 · F#maj7 · Bb/D" />',
  '<div class="v4-chord-presets" aria-label="자주 사용하는 코드">',
  '<button type="button" data-chord="C">C</button><button type="button" data-chord="Am7">Am7</button>',
  '<button type="button" data-chord="F">F</button><button type="button" data-chord="G7">G7</button>',
  '<button type="button" data-chord="Bb/D">Bb/D</button>',
  '</div>',
  '<div class="v4-inline"><button id="v4-chord-apply" type="button">코드 입력 · 교체</button>',
  '<button id="v4-chord-remove" type="button" disabled>선택 코드 삭제</button></div>',
  '<p id="v4-chord-status" class="v4-tiny" role="status" aria-live="polite">코드 입력 후 적용을 누르면 MusicXML과 악보에 반영됩니다. 실행 취소가 가능합니다.</p>',
  '<p class="v4-tiny">지원 코드: 장·단화음, 6·7·9·11·13, maj7, sus2·sus4, dim·aug, m7b5, add9, 슬래시 코드. 복잡한 기존 화성 기호는 보호됩니다.</p>',
  '</section>',
].join('');

export function mountStudioV4({state,v3,openScore,setMessage,renderScore}){
  const $=id=>document.getElementById(id);
  document.querySelector('.settings-action').insertAdjacentHTML('afterend',intro);
  $('editor-controls').insertAdjacentHTML('beforeend',panel);
  $('editor-controls').insertAdjacentHTML('beforeend',chordPanel);
  let saveTimer=null,pending=null,skipRendered=false,currentRenderedDoc=null,writing=false;
  let changingMeasureCount=false;
  let disabledDraft=false;
  let measureToolbar=null;
  let savingCheckpoint=false;
  let checkpointNotice=null;
  let projectBusy=false;
  const player=createAuditionPlayer({
    onState:playing=>{
      $('v4-play').disabled=playing;
      $('v4-play-range').disabled=playing;
      $('v4-stop').disabled=!playing;
      if(!playing&&/재생 중|반복 중|선택 마디/.test($('v4-play-status').textContent))
        $('v4-play-status').textContent='재생 종료 · 새 재생을 시작할 수 있습니다.';
    },
    onPosition:position=>{
      const index=position?.measureIndex??null;
      $('v4-playing-measure').textContent=index===null?'청음 중인 마디 없음':
        (index+1)+'마디 재생 중'+(position.loopCycle?' · 반복 '+(position.loopCycle+1)+'회차':'');
      measureToolbar?.followPlaybackMeasure(index);
      state.graphicBridge?.highlightPlaybackMeasure?.(index);
    },
  });
  const localeTime=ms=>new Date(ms).toLocaleString('ko-KR',{dateStyle:'short',timeStyle:'short'});
  function draftStatus(text){$('v4-draft-status').textContent=text;}
  function checkpointStatus(text){$('v4-checkpoint-status').textContent=text;}
  async function refreshCheckpoints(){
    try{
      const list=await listLocalCheckpoints(),select=$('v4-checkpoint-select');
      const previous=select.value;
      select.replaceChildren();
      const blank=document.createElement('option');
      blank.value='';blank.textContent=list.length?'복원할 시점 선택':'보관된 시점 없음';
      select.append(blank);
      for(const record of list){
        const item=document.createElement('option');
        item.value=record.id;
        item.textContent=record.filename+' · '+record.label+' · '+localeTime(record.savedAt);
        select.append(item);
      }
      if(list.some(x=>x.id===previous))select.value=previous;
      $('v4-checkpoint-restore').disabled=!select.value;
      $('v4-checkpoint-delete').disabled=!select.value;
      if(!savingCheckpoint&&!checkpointNotice)checkpointStatus(list.length+'개 복원 시점 보관 중 · 자동 임시 저장과 독립');
    }catch(error){
      $('v4-checkpoint-restore').disabled=true;
      $('v4-checkpoint-delete').disabled=true;
      if(!checkpointNotice)checkpointStatus('체크포인트 목록을 읽을 수 없습니다: '+(error.message||'브라우저 제한'));
    }
  }
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
    checkpointNotice=null;
    measureToolbar?.reset();
    inlineLyrics.close();
    flushPending();
    player.stop();
    skipRendered=true;
    currentRenderedDoc=null;
  }
  function onRendered(){
    inlineLyrics.onRendered();
    syncCurrentMeasureCount();
    syncMeasureDelete();
    $('v4-checkpoint-save').disabled=!state.doc||state.showBaseline||savingCheckpoint;
    $('v4-project-export').disabled=!state.doc||state.showBaseline||projectBusy;
    $('v4-add-part').disabled=!state.doc||state.showBaseline;
    measureToolbar?.render();
    renderVoiceGrid();
    syncChordSelection();
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
  function onLoaded(){inlineLyrics.onLoaded();measureToolbar?.reset();syncCurrentMeasureCount();syncMeasureDelete();syncChordSelection();$('v4-checkpoint-save').disabled=!state.doc||state.showBaseline||savingCheckpoint;$('v4-project-export').disabled=!state.doc||state.showBaseline||projectBusy;$('v4-add-part').disabled=!state.doc||state.showBaseline;void refreshDrafts();void refreshCheckpoints();}
  $('v4-new').addEventListener('click',async()=>{
    if(state.doc&&!confirm('새 악보를 만들면 현재 작업 화면이 교체됩니다. 먼저 MusicXML 파일로 저장했는지 확인해 주세요. 계속할까요?'))return;
    try{
      const xml=createBlankScore({title:$('v4-new-title').value,template:$('v4-new-template').value,measures:Number($('v4-new-measures').value)});
      const ok=await openScore(xml,($('v4-new-title').value.trim()||'새 악보')+'.musicxml');
      if(ok){setMessage('새 악보 생성 완료 · 쉼표를 선택해 4.0 음표 삽입 기능으로 작곡을 시작하세요.');}
    }catch(error){setMessage('새 악보 생성 실패: '+error.message,true);}
  });
  function currentMeasureCount(){
    if(!state.doc)return null;
    const parts=[...state.doc.documentElement.children].filter(n=>n.localName==='part');
    const counts=parts.map(p=>[...p.children].filter(n=>n.localName==='measure').length);
    return counts.length&&counts[0]>0&&counts.every(n=>n===counts[0])?counts[0]:null;
  }
  function syncMeasureDelete(){
    const current=currentMeasureCount(),button=$('v4-delete-measure'),status=$('v4-delete-measure-status');
    const index=v3.getSelection().measureIndex;
    const available=current!==null&&current>1&&!state.showBaseline;
    button.disabled=!available;
    status.textContent=!state.doc?'악보를 열면 마디 삭제를 사용할 수 있습니다.':
      current===null?'파트별 마디 수가 달라 마디 삭제를 사용할 수 없습니다.':
      current<=1?'악보에 최소 한 마디는 남겨야 합니다.':
      state.showBaseline?'원본 보기를 종료한 뒤 마디를 삭제할 수 있습니다.':
      '선택: '+(Math.min(index,current-1)+1)+'마디 / 총 '+current+
      '마디 · 09 / 음표 편집에서 삭제할 마디를 선택하세요.';
  }
  function syncCurrentMeasureCount(){
    if(changingMeasureCount)return;
    const current=currentMeasureCount(),control=$('v4-current-total');
    control.disabled=current===null;
    $('v4-apply-total').disabled=current===null;
    control.value=current===null?'':String(current);
    $('v4-total-status').textContent=current===null?
      '악보가 없거나 파트별 마디 수가 달라 편집할 수 없습니다.':
      '현재 '+current+'마디 · 모든 파트 동일 · 변경 후 Enter 또는 적용 버튼을 누르세요.';
  }
  async function applyCurrentMeasureCount(){
    if(changingMeasureCount||!state.doc)return;
    const current=currentMeasureCount(),target=Number($('v4-current-total').value);
    if(current===null){setMessage('파트별 마디 수가 같아야 변경할 수 있습니다.',true);return;}
    if(!Number.isSafeInteger(target)||target<1||target>128){
      $('v4-total-status').textContent='총마디 수는 1~128 사이의 정수를 입력해 주세요.';
      $('v4-current-total').value=String(current);
      return;
    }
    if(target===current){
      $('v4-total-status').textContent='현재 악보가 이미 '+current+'마디입니다.';
      return;
    }
    if(target<current&&!confirm('마지막 '+(current-target)+
      '개 마디를 삭제하려고 합니다. 비어 있는 마디만 삭제되며 음표·기호가 있는 마디는 보호됩니다. 계속할까요?')){
      $('v4-current-total').value=String(current);
      $('v4-total-status').textContent='마디 수 변경을 취소했습니다. 현재 '+current+'마디입니다.';
      return;
    }
    changingMeasureCount=true;
    $('v4-current-total').disabled=true;
    $('v4-apply-total').disabled=true;
    $('v4-total-status').textContent=current+'마디 → '+target+'마디 변경 중…';
    try{
      await commit(doc=>setScoreMeasureCount(doc,{total:target}), '현재 악보 총마디 수 변경');
      const after=currentMeasureCount();
      $('v4-total-status').textContent=after===target?
        '적용 완료 · '+current+' → '+after+'마디 · 악보와 MusicXML 저장에 반영됐습니다.':
        '변경되지 않았습니다. 기존 '+(after??current)+'마디를 보존했습니다. 아래 오류 메시지를 확인하세요.';
    }catch(error){
      $('v4-total-status').textContent='마디 수 변경 실패: '+error.message;
      setMessage('마디 수 변경 실패: '+error.message,true);
    }finally{
      changingMeasureCount=false;
      const after=currentMeasureCount();
      $('v4-current-total').disabled=after===null;
      $('v4-apply-total').disabled=after===null;
      $('v4-current-total').value=after===null?'':String(after);
    }
  }
  $('v4-add-part').addEventListener('click',async()=>{
    if(!state.doc||state.showBaseline)return;
    const instrument=$('v4-add-part-type').value,name=$('v4-add-part-name').value,
      status=$('v4-add-part-status');
    const prior=state.doc;
    let createdId=null;
    await commit(doc=>{
      const result=addEmptyInstrumentPart(doc,{instrument,name});
      createdId=result.change.partId;
      return result;
    },'악기 파트 추가');
    if(state.doc!==prior&&createdId){
      v3.select({partId:createdId,measureIndex:0,eventIndex:0});
      status.textContent=createdId+' · '+name.trim()+' 파트 추가 완료 · 첫 쉼표를 선택해 음표를 입력할 수 있습니다.';
    }else status.textContent='새 파트 추가가 적용되지 않았습니다. 위 오류 메시지와 박자 구조를 확인해 주세요.';
  });
  $('v4-transfer-measures').addEventListener('click',async()=>{
    if(!state.doc)return;
    const previous=state.doc,status=$('v4-transfer-measures-status');
    try{
      const position=selected();
      const audit=inspectAdvancedMeasure(state.doc,position.partId,position.measureIndex);
      const selectedEvent=audit.events[position.eventIndex];
      if(!selectedEvent||selectedEvent.rest)
        throw new Error('이동할 일반 음표를 먼저 선택해 주세요.');
      await commit(doc=>transferVoiceAcrossMeasures(doc,{
        partId:position.partId,startMeasureIndex:position.measureIndex,
        endMeasureIndex:Number($('v4-transfer-measures-end').value)-1,
        sourceVoice:selectedEvent.voice,targetVoice:$('v4-transfer-voice').value,
        staff:selectedEvent.staff
      }),'연속 마디의 성부 전체 이동');
      status.textContent=state.doc!==previous?
        '연속 마디 성부 이동 완료 · 원래 박자·다른 파트 보존':
        '연속 마디 성부 이동이 적용되지 않았습니다. 대상 쉼표를 확인하세요.';
    }catch(error){
      status.textContent='연속 마디 이동 차단: '+(error.message||'악보 구조 오류');
      setMessage(status.textContent,true);
    }
  });
  $('v4-transfer-phrase').addEventListener('click',async()=>{
    const previous=state.doc,status=$('v4-transfer-phrase-status');
    const position=selected(),finalIndex=Number($('v4-transfer-phrase-end').value)-1;
    await commit(doc=>transferVoicePhrase(doc,{
      ...position,startEventIndex:position.eventIndex,endEventIndex:finalIndex,
      targetVoice:$('v4-transfer-voice').value
    }),'연속 음표를 대상 성부로 일괄 이동');
    status.textContent=state.doc!==previous?
      '연속 음표·가사 성부 이동 완료 · 원래 성부 박자 및 다른 파트 보존':
      '구간 이동이 적용되지 않았습니다. 대상 성부의 쉼표와 구간을 확인하세요.';
  });
  $('v4-transfer-note').addEventListener('click',async()=>{
    const previous=state.doc,status=$('v4-transfer-status');
    await commit(doc=>moveNoteToRestingVoice(doc,{...selected(),
      targetVoice:$('v4-transfer-voice').value}),'다른 성부의 동일 박자 쉼표로 음표 이동');
    status.textContent=state.doc!==previous?
      '성부 간 음표·가사 이동 완료 · 각 성부의 박자는 유지했습니다.':
      '이동되지 않았습니다. 대상 성부의 같은 위치·길이 쉼표를 확인하세요.';
  });
  $('v4-add-voice').addEventListener('click',async()=>{
    if(!state.doc||state.showBaseline)return;
    const position=selected(),voice=$('v4-add-voice-number').value,
      staff=Number($('v4-add-voice-staff').value),status=$('v4-add-voice-status');
    const before=state.doc;
    await commit(doc=>addIndependentVoice(doc,{partId:position.partId,voice,staff}),
      '선택 파트 '+voice+'성부 생성');
    status.textContent=state.doc!==before?
      voice+'성부 생성 완료 · 기존 리듬 보존 · 새 성부의 쉼표를 선택해 음표를 입력하세요.':
      '새 성부가 생성되지 않았습니다. 오류 메시지와 파트·보표 설정을 확인하세요.';
  });
  $('v4-current-total').addEventListener('change',()=>void applyCurrentMeasureCount());
  $('v4-apply-total').addEventListener('click',()=>void applyCurrentMeasureCount());

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
  $('v4-checkpoint-save').addEventListener('click',async()=>{
    if(!state.doc||state.showBaseline||savingCheckpoint)return;
    savingCheckpoint=true;$('v4-checkpoint-save').disabled=true;
    try{
      const xml=new XMLSerializer().serializeToString(state.doc);
      const saved=await saveLocalCheckpoint({filename:state.filename,xml,label:$('v4-checkpoint-label').value});
      await refreshCheckpoints();
      $('v4-checkpoint-select').value=saved.id;
      $('v4-checkpoint-restore').disabled=false;
      $('v4-checkpoint-delete').disabled=false;
      checkpointNotice=saved.label+' · '+localeTime(saved.savedAt)+' 복원 시점 저장 완료 (SHA-256 확인 가능)';
      checkpointStatus(checkpointNotice);
    }catch(error){checkpointStatus('체크포인트 저장 실패: '+(error.message||'저장소 제한'));}
    finally{savingCheckpoint=false;$('v4-checkpoint-save').disabled=!state.doc||state.showBaseline;}
  });
  $('v4-checkpoint-select').addEventListener('change',()=>{
    const selected=!!$('v4-checkpoint-select').value;
    $('v4-checkpoint-restore').disabled=!selected;
    $('v4-checkpoint-delete').disabled=!selected;
  });
  $('v4-checkpoint-restore').addEventListener('click',async()=>{
    const id=$('v4-checkpoint-select').value;
    if(!id||state.showBaseline)return;
    if(state.doc&&!confirm('현재 작업 화면을 선택한 복원 시점으로 교체합니다. 현재 내용을 MusicXML로 저장했나요?'))return;
    try{
      const saved=await loadLocalCheckpoint(id);
      const ok=await openScore(saved.xml,saved.filename);
      checkpointNotice=ok?'무결성 검사 통과 · '+saved.label+' · '+localeTime(saved.savedAt)+' 복원 완료':
        '복원본 MusicXML을 표시하지 못했습니다. 원래 화면과 저장된 시점을 확인해 주세요.';
      checkpointStatus(checkpointNotice);
    }catch(error){checkpointStatus('체크포인트 복원 차단: '+(error.message||'무결성 확인 실패'));}
  });
  $('v4-checkpoint-delete').addEventListener('click',async()=>{
    const id=$('v4-checkpoint-select').value;if(!id)return;
    if(!confirm('선택한 복원 시점을 이 브라우저에서 영구 삭제할까요? 이 작업은 되돌릴 수 없습니다.'))return;
    try{
      await removeLocalCheckpoint(id);
      await refreshCheckpoints();
      checkpointNotice='선택한 복원 시점을 삭제했습니다. 다른 복원 시점은 유지됩니다.';
      checkpointStatus(checkpointNotice);
    }catch(error){checkpointStatus('복원 시점 삭제 실패: '+(error.message||'저장소 제한'));}
  });
  const projectStatus=message=>{$('v4-project-status').textContent=message;};
  function projectButtons(){
    $('v4-project-export').disabled=projectBusy||!state.doc||state.showBaseline;
    $('v4-project-import').disabled=projectBusy;
  }
  $('v4-project-export').addEventListener('click',async()=>{
    if(projectBusy||!state.doc||state.showBaseline)return;
    projectBusy=true;projectButtons();
    try{
      const filename=state.filename||'score.musicxml';
      const xml=new XMLSerializer().serializeToString(state.doc);
      const entries=(await listLocalCheckpoints()).filter(x=>x.filename===filename);
      const snapshots=[];
      for(const item of entries){
        const saved=await loadLocalCheckpoint(item.id);
        snapshots.push({filename:saved.filename,xml:saved.xml,label:saved.label});
      }
      const output=await createPortableScoreProject({xml,filename,snapshots});
      const url=URL.createObjectURL(output.blob),anchor=document.createElement('a');
      anchor.href=url;anchor.download=output.filename;anchor.click();
      setTimeout(()=>URL.revokeObjectURL(url),10000);
      projectStatus('프로젝트 파일 생성 완료 · '+output.snapshots+
        '개 복원 시점 포함 · '+output.bytes+'바이트 · SHA-256 보호 · 다운로드 파일은 별도로 보관하세요.');
    }catch(error){projectStatus('프로젝트 백업 실패: '+(error.message||'파일을 저장할 수 없습니다.'));}
    finally{projectBusy=false;projectButtons();}
  });
  $('v4-project-import').addEventListener('click',()=>{
    if(projectBusy)return;
    $('v4-project-file').click();
  });
  $('v4-project-file').addEventListener('change',async()=>{
    const file=$('v4-project-file').files?.[0];
    $('v4-project-file').value='';
    if(!file||projectBusy)return;
    if(state.doc&&!confirm('프로젝트를 불러오면 현재 악보 화면이 교체됩니다. 먼저 현재 악보를 저장했나요?'))return;
    projectBusy=true;projectButtons();
    try{
      const restored=await readPortableScoreProject(file);
      const loaded=await openScore(restored.xml,restored.filename);
      if(!loaded)throw new Error('백업 악보가 렌더링되지 않았습니다. 기존 프로젝트 파일은 변경되지 않았습니다.');
      let savedCount=0,reason='';
      for(const item of restored.snapshots){
        try{
          await saveLocalCheckpoint({filename:item.filename,xml:item.xml,label:item.label});
          savedCount++;
        }catch(error){reason=error.message||'저장소 용량 제한';break;}
      }
      await refreshCheckpoints();
      projectStatus('검증된 프로젝트 복원 완료 · SHA-256 일치 · '+restored.snapshots.length+
        '개 중 '+savedCount+'개 복원 시점 보관'+
        (reason?' · 나머지 미보관: '+reason+' · 원본 ZIP은 계속 보관하세요.':''));
    }catch(error){projectStatus('프로젝트 복원 차단: '+(error.message||'파일의 무결성 검사가 실패했습니다.'));}
    finally{projectBusy=false;projectButtons();}
  });
  async function commit(transform,label){
    if(!state.doc){setMessage('먼저 악보를 열어 주세요.',true);return;}
    if(state.showBaseline){setMessage('원본 보기에서 편집할 수 없습니다. 현재 악보 보기로 전환해 주세요.',true);return;}
    await v3.commitExternal(transform,label);
  }
  function selected(){return v3.getSelection();}
  measureToolbar=mountMeasureToolbar({state,v3,commit,setMessage});
  const inlineLyrics=mountInlineLyricEditor({
    state,v3,commit,setMessage,lyricVerseInput:$('v4-lyric-verse'),
    getNoteRect:position=>state.graphicBridge?.rectFor?.(position),
  });

  function syncChordSelection(){
    const where=$('v4-chord-location'),input=$('v4-chord-input');
    const apply=$('v4-chord-apply'),remove=$('v4-chord-remove');
    if(!state.doc||state.showBaseline){
      where.textContent='악보를 연 뒤 음표를 선택해 주세요.';
      input.disabled=true;apply.disabled=true;remove.disabled=true;return;
    }
    try{
      const position=selected();
      const found=readChordSymbol(state.doc,position);
      const part=[...state.doc.documentElement.children].find(p=>p.localName==='part'&&p.getAttribute('id')===position.partId);
      const name=part?.getAttribute('id')||'선택 파트';
      where.textContent=name+' · '+(position.measureIndex+1)+'마디 · '+(position.eventIndex+1)+
        '번째 음표 · 성부 '+found.voice+' / 보표 '+found.staff+
        (found.exists?(found.editable?' · 현재 코드 '+found.symbol:' · 복잡한 코드 보호'):' · 코드 없음');
      input.value=found.symbol;
      input.disabled=!found.editable;
      apply.disabled=!found.editable;remove.disabled=!found.editable||!found.exists;
    }catch(error){
      where.textContent='코드를 넣을 수 없는 음표입니다: '+(error.message||'위치 확인 실패');
      input.disabled=true;apply.disabled=true;remove.disabled=true;
    }
  }
  $('v4-chord-apply').addEventListener('click',()=>void commit(doc=>editChordSymbol(doc,selected(),{
    symbol:$('v4-chord-input').value,mode:'set'
  }),'코드 기호 입력·교체'));
  $('v4-chord-remove').addEventListener('click',()=>void commit(doc=>editChordSymbol(doc,selected(),{
    mode:'remove'
  }),'코드 기호 삭제'));
  $('v4-chord-input').addEventListener('keydown',event=>{
    if(event.key==='Enter'&&!event.isComposing){
      event.preventDefault();$('v4-chord-apply').click();
    }
  });
  for(const button of document.querySelectorAll('.v4-chord-presets [data-chord]')){
    button.addEventListener('click',()=>{
      if($('v4-chord-input').disabled)return;
      $('v4-chord-input').value=button.dataset.chord;
      $('v4-chord-input').focus();
    });
  }

  function renderVoiceGrid(){
    const host=$('v4-beat-grid');
    host.replaceChildren();
    const pos=v3.getSelection();
    if(!state.doc||!pos.partId){host.textContent='악보를 열면 성부 시간표가 표시됩니다.';return;}
    let audit;
    try{audit=inspectAdvancedMeasure(state.doc,pos.partId,pos.measureIndex);}
    catch(error){host.textContent='시간표 확인 실패: '+error.message;return;}
    if(audit.reason){host.textContent='이 마디는 보호된 기보입니다: '+audit.reason;return;}
    const chosen=audit.events[pos.eventIndex];
    if(chosen&&!chosen.rest&&Number.isInteger(audit.divisions)&&audit.divisions>0){
      $('v4-relocate-beat').value=String(1+chosen.start/audit.divisions);
      $('v4-relocate-status').textContent='현재 '+(1+chosen.start/audit.divisions)+
        '박자 · '+chosen.voice+'성부 / '+chosen.staff+'보표 · 이동 격자: '+$('v4-grid-step').selectedOptions[0]?.textContent;
    }
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
        entry.addEventListener('click',()=>{
          if(e.rest&&$('v4-timeline-insert').checked){
            v3.select({partId:pos.partId,measureIndex:pos.measureIndex,eventIndex:e.eventIndex});
            void commit(doc=>editVoiceRhythm(doc,{...selected(),mode:'insert',
              type:$('v4-pro-type').value,step:$('v4-pro-step').value,
              alter:Number($('v4-pro-alter').value),octave:Number($('v4-pro-octave').value),
            }),'성부 시간표에서 음표 입력');
            return;
          }
          if(e.rest&&$('v4-timeline-move').checked){
            const current=selected(),chosen=audit.events[current.eventIndex];
            if(!chosen||chosen.rest||chosen.voice!==e.voice||chosen.staff!==e.staff){
              $('v4-relocate-status').textContent='먼저 같은 성부·보표의 이동할 음표를 선택해 주세요.';
              return;
            }
            const targetBeat=1+e.start/audit.divisions;
            $('v4-relocate-beat').value=String(targetBeat);
            void commit(doc=>relocateVoiceNote(doc,{...current,targetBeat,
              grid:$('v4-grid-step').value}),'시간표에서 음표 위치 이동');
            return;
          }
          v3.select({partId:pos.partId,measureIndex:pos.measureIndex,eventIndex:e.eventIndex});
        });
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

  for(const [id,other] of [['v4-timeline-move','v4-timeline-insert'],
    ['v4-timeline-insert','v4-timeline-move']]){
    $(id).addEventListener('change',()=>{
      if($(id).checked)$(other).checked=false;
    });
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
  $('v4-relocate-note').addEventListener('click',()=>{
    const position=selected(),targetBeat=Number($('v4-relocate-beat').value);
    void commit(doc=>relocateVoiceNote(doc,{...position,targetBeat,
      grid:$('v4-grid-step').value}),'음표를 지정한 박자로 이동');
  });
  document.addEventListener('keydown',event=>{
    if(!$('v4-keys-enabled').checked||!state.doc||state.showBaseline||
      event.ctrlKey||event.metaKey||event.altKey||event.isComposing||event.repeat)return;
    const target=event.target;
    if(target?.closest?.('input,textarea,select,button,[contenteditable="true"]'))return;
    if(!document.activeElement?.closest?.('.site-shell'))return;
    const key=event.key.toLowerCase();
    if(!['n','r','[',']'].includes(key))return;
    event.preventDefault();
    const current=selected();
    if(key==='n')void commit(doc=>editVoiceRhythm(doc,{...current,mode:'insert',
      type:$('v4-pro-type').value,step:$('v4-pro-step').value,
      alter:Number($('v4-pro-alter').value),octave:Number($('v4-pro-octave').value)}),
      '키보드 음표 입력');
    if(key==='r')void commit(doc=>replaceVoiceNoteWithRest(doc,current),'키보드 음표를 쉼표로 변경');
    if(key==='['||key===']')
      void commit(doc=>nudgeVoiceNoteOnGrid(doc,{...current,
        direction:key==='['?'earlier':'later',grid:$('v4-grid-step').value}),
        '키보드 음표 시작 위치 이동');
  });
  $('v4-pro-insert').addEventListener('click',()=>void commit(doc=>editVoiceRhythm(doc,{
    ...selected(),mode:'insert',step:$('v4-pro-step').value,
    alter:Number($('v4-pro-alter').value),octave:Number($('v4-pro-octave').value),
    type:$('v4-pro-type').value,
  }),'전문 음표 입력'));
  $('v4-grace-insert').addEventListener('click',()=>void commit(doc=>insertGraceNote(doc,{
    ...selected(),step:$('v4-pro-step').value,alter:Number($('v4-pro-alter').value),
    octave:Number($('v4-pro-octave').value),slash:$('v4-grace-slash').checked
  }),'꾸밈음 추가'));
  $('v4-grace-remove').addEventListener('click',()=>void commit(doc=>removeGraceNote(doc,selected()),
    '꾸밈음 삭제'));
  $('v4-articulation-toggle').addEventListener('click',()=>void commit(
    doc=>toggleAdvancedArticulation(doc,{...selected(),
      kind:$('v4-articulation-kind').value}),
    '아티큘레이션 기호 추가 / 해제'
  ));
  $('v4-connected-pitch').addEventListener('click',()=>void commit(doc=>editConnectedPitch(doc,{
    ...selected(),step:$('v4-pro-step').value,alter:Number($('v4-pro-alter').value),
    octave:Number($('v4-pro-octave').value)
  }),'붙임줄 연결 음표 전체 음정 변경'));
  $('v4-pro-duration').addEventListener('click',()=>void commit(doc=>editVoiceRhythm(doc,{
    ...selected(),mode:'duration',type:$('v4-pro-type').value,
  }),'성부별 음표 길이 변경'));
  $('v4-pro-to-rest').addEventListener('click',()=>void commit(doc=>replaceVoiceNoteWithRest(doc,{
    ...selected(),
  }),'다성부 음표를 쉼표로 대체'));
  $('v4-split-tie').addEventListener('click',()=>void commit(doc=>splitVoiceNoteWithTie(doc,{
    ...selected(),firstType:$('v4-split-type').value,
  }),'음표 분할·붙임줄 연결'));
  $('v4-crossbar-extend').addEventListener('click',()=>void commit(doc=>
    extendVoiceAcrossBarline(doc,{...selected(),continuationType:$('v4-crossbar-type').value}),
    '다음 마디로 음표 붙임줄 연장'));
  $('v4-crossbar-move').addEventListener('click',()=>void commit(doc=>
    moveVoiceIntoNextMeasure(doc,selected()),'선택 음표를 다음 마디로 이동'));
  $('v4-chord-transpose').addEventListener('click',()=>void commit(doc=>
    transposeChordChromatically(doc,{...selected(),
      semitones:Number($('v4-chord-semitones').value),spelling:$('v4-chord-spelling').value,
    }),'화음 전체 반음 이동'));
  $('v4-tuplet-author').addEventListener('click',()=>void commit(doc=>authorTupletGroup(doc,{
    ...selected(),ratio:$('v4-tuplet-ratio').value,type:$('v4-tuplet-unit').value,
    step:$('v4-pro-step').value,alter:Number($('v4-pro-alter').value),
    octave:Number($('v4-pro-octave').value),
  }),'잇단음 그룹 생성'));
  $('v4-tuplet-pitches-apply').addEventListener('click',async()=>{
    const status=$('v4-tuplet-pitches-status'),params=selected();
    try{
      const group=inspectEditableTuplet(state.doc,params);
      const previous=state.doc;
      await commit(doc=>editTupletPitches(doc,{...params,
        pitches:$('v4-tuplet-pitches').value}),'기존 잇단음 그룹 음정 일괄 수정');
      status.textContent=state.doc!==previous?
        group.actual+':'+group.normal+' 잇단음 음정 변경 완료 · 박자·가사·성부 보존':
        '변경되지 않았습니다. 위 오류 메시지를 확인하세요.';
    }catch(error){
      status.textContent='잇단음 음정 수정 차단: '+(error.message||'입력 오류');
      setMessage(status.textContent,true);
    }
  });
  $('v4-pro-triplet').addEventListener('click',()=>void commit(doc=>createEighthTriplet(doc,{
    ...selected(),step:$('v4-pro-step').value,alter:Number($('v4-pro-alter').value),
    octave:Number($('v4-pro-octave').value),
  }),'8분음표 셋잇단음 변환'));
  const span=()=>({...selected(),endEventIndex:Number($('v4-pro-end').value)-1});
  $('v4-pro-slur').addEventListener('click',()=>void commit(doc=>
    Number($('v4-slur-next-measure').value)>0?
      toggleSlurAcrossBarline(doc,{...span(),
        endMeasureOffset:Number($('v4-slur-next-measure').value)}):
      toggleSlur(doc,span()),'이음줄 추가·해제'));
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
  function batchOptions(){
    return {...selected(),verse:Number($('v4-lyric-verse').value),
      text:$('v4-lyrics-batch-text').value,overwrite:$('v4-lyrics-batch-overwrite').checked};
  }
  function batchPreview(options=batchOptions()){
    const status=$('v4-lyrics-batch-status');
    try{
      const plan=planBatchLyrics(state.doc,options);
      status.textContent='배치 가능 · '+plan.syllables+'개 가사 음절 · 멜리스마 '+plan.extensions+
        '개 · 선택 성부 '+plan.voice+' / 보표 '+plan.staff+
        ' · 건너뛴 쉼표 '+plan.skippedRests+'개 · 붙임줄 뒤 음표 '+plan.skippedTies+
        '개'+(plan.occupied?' · 덮어쓸 기존 가사 '+plan.occupied+'개':'')+
        ' · 아직 악보는 변경하지 않았습니다.';
      return plan;
    }catch(error){
      status.textContent='배치 불가 · '+(error.message||'입력과 음표 선택을 확인해 주세요.');
      return null;
    }
  }
  $('v4-lyrics-batch-preview').addEventListener('click',()=>batchPreview());
  $('v4-lyrics-batch-apply').addEventListener('click',async()=>{
    const options=batchOptions(),plan=batchPreview(options);
    if(!plan)return;
    const prior=state.doc;
    await commit(doc=>applyBatchLyrics(doc,options),'스마트 가사 일괄 입력');
    $('v4-lyrics-batch-status').textContent=state.doc!==prior?
      '적용 완료 · '+plan.syllables+'개 음절 및 멜리스마 '+plan.extensions+
        '개를 해당 성부의 '+plan.verse+'절에 입력했습니다. 3.0 실행 취소 버튼으로 한 번에 되돌릴 수 있습니다.':
      '적용되지 않았습니다. 상단 상태 메시지에서 원인을 확인해 주세요.';
  });
  $('v4-lyrics-batch-text').addEventListener('keydown',event=>{
    if((event.metaKey||event.ctrlKey)&&event.key==='Enter'){
      event.preventDefault();$('v4-lyrics-batch-apply').click();
    }
  });
  async function movePlacedLyric(direction){
    const status=$('v4-lyric-shift-status');
    if(!state.doc){status.textContent='악보를 먼저 열어 주세요.';return;}
    const options={...selected(),verse:Number($('v4-lyric-verse').value),direction};
    let plan;
    try {plan=planPlacedLyricShift(state.doc,options);}
    catch(error){status.textContent='이동 불가 · '+(error.message||'가사 선택을 확인해 주세요.');return;}
    const before=state.doc;
    await commit(doc=>shiftPlacedLyrics(doc,options),
      direction==='right'?'가사 한 음표 밀기':'가사 한 음표 당기기');
    status.textContent=state.doc!==before?
      '이동 완료 · '+plan.affected+'개 가사 위치 수정 · '+plan.verse+
        '절 / 성부 '+plan.voice+' / 보표 '+plan.staff+
        ' · 실행 취소로 되돌릴 수 있습니다.':
      '악보가 변경되지 않았습니다. 위 편집 상태 메시지를 확인해 주세요.';
  }
  $('v4-lyric-shift-left').addEventListener('click',()=>void movePlacedLyric('left'));
  $('v4-lyric-shift-right').addEventListener('click',()=>void movePlacedLyric('right'));
  $('v4-tie-toggle').addEventListener('click',()=>void commit(doc=>toggleSoundingTie(doc,{
    ...selected(),endMeasureIndex:selected().measureIndex+Number($('v4-tie-next-measure').value),
    endEventIndex:Number($('v4-pro-end').value)-1,
  }),'실제 붙임줄 연결·해제'));
  $('v4-add-measures').addEventListener('click',()=>void commit(doc=>appendBlankMeasures(doc,{count:Number($('v4-measure-count').value)}),'빈 마디 추가'));
  $('v4-delete-measure').addEventListener('click',async()=>{
    const current=currentMeasureCount(),index=selected().measureIndex;
    if(!state.doc||current===null||current<=1||!Number.isSafeInteger(index)||index<0||index>=current)return;
    if(!confirm((index+1)+'마디를 모든 파트에서 삭제합니다. 해당 마디에 있는 음표·쉼표·가사·코드도 함께 삭제됩니다. 09 / 음표 편집의 실행 취소로 복원할 수 있습니다. 계속할까요?'))return;
    const before=state.doc;
    await commit(doc=>deleteMeasureRange(doc,{start:index,end:index}),'선택한 '+(index+1)+'마디 삭제');
    if(state.doc!==before){
      syncMeasureDelete();
      $('v4-delete-measure-status').textContent=(index+1)+'마디 삭제 완료 · '+current+' → '+(current-1)+'마디 · 실행 취소 가능';
    }
  });
  $('v4-apply-key').addEventListener('click',()=>void commit(doc=>setSimpleKeySignature(doc,{fifths:Number($('v4-key').value)}),'전체 조표 변경'));
  $('v4-key-from-measure').addEventListener('click',()=>void commit(doc=>setKeyAtMeasure(doc,{measureIndex:selected().measureIndex,fifths:Number($('v4-key').value)}),'선택 마디 조표 변경'));
  $('v4-meter-empty').addEventListener('click',()=>void commit(doc=>{
    const [beats,beatType]=$('v4-meter').value.split('/').map(Number);
    return setMeterForEmptyTail(doc,{measureIndex:selected().measureIndex,beats,beatType});
  },'빈 구간 박자표 변경'));
  $('v4-meter-single').addEventListener('click',()=>void commit(doc=>{
    const [beats,beatType]=$('v4-meter').value.split('/').map(Number);
    return changeSingleEmptyMeasureMeter(doc,{measureIndex:selected().measureIndex,beats,beatType});
  },'선택 빈 마디 박자표 변경'));
  $('v4-rebar-written').addEventListener('click',()=>{
    if(!state.doc)return;
    const requested=$('v4-rebar-meter').value;
    if(!window.confirm('전체 작성 악보의 마디 구성을 변경합니다. 원본 MusicXML을 저장하셨습니까?'))return;
    void commit(doc=>rebarWrittenScore(doc,{meter:requested}),'작성된 악보 전체 리바링');
  });

  $('v4-apply-layout').addEventListener('click',()=>void commit(doc=>setScoreLayoutBreak(doc,{
    measureIndex:selected().measureIndex,kind:$('v4-layout').value,
  }),'줄·페이지 나눔'));
  $('v4-cadence-apply').addEventListener('click',async()=>{
    if(!state.doc)return;
    const options={barsPerSystem:Number($('v4-cadence-bars').value),
      systemsPerPage:Number($('v4-cadence-systems').value),
      replaceExisting:$('v4-cadence-replace').checked};
    const status=$('v4-cadence-status');
    let plan;
    try{
      plan=planLayoutCadence(state.doc,options);
    }catch(error){
      status.textContent='나눔 적용 불가: '+(error.message||'설정 확인이 필요합니다.');
      setMessage(status.textContent,true);return;
    }
    const before=state.doc;
    await commit(doc=>applyLayoutCadence(doc,options),'전체 악보 줄·페이지 나눔');
    if(state.doc!==before){
      status.textContent='모든 파트 '+plan.parts+'개 · '+plan.total+'마디 · 새 줄 시작 '+
        plan.systemStarts+'곳 · 페이지 시작 '+plan.pageStarts+'곳 기록 완료';
    }else status.textContent='악보가 변경되지 않았습니다. 위 편집 상태를 확인해 주세요.';
  });
  $('v4-auto-layout').addEventListener('click',async()=>{
    if(!state.doc)return;
    const options={pageFormat:$('page-orientation').value,
      replaceExisting:$('v4-cadence-replace').checked};
    const status=$('v4-auto-layout-status');
    let plan;
    try{plan=planDensityLayout(state.doc,options);}
    catch(error){
      status.textContent='자동 조판 계획 차단: '+(error.message||'악보 설정을 확인해 주세요.');
      setMessage(status.textContent,true);return;
    }
    const before=state.doc;
    await commit(doc=>applyDensityLayout(doc,options),'악보 밀도 기반 자동 줄·페이지 나눔');
    status.textContent=state.doc!==before?
      '자동 배치 적용 · '+plan.totalMeasures+'마디 · '+plan.systems+'줄 · 예상 '+plan.pages+
      '페이지 · 모든 '+plan.parts+'파트 동기화 · 시각적 겹침은 인쇄 전에 확인해 주세요.':
      '자동 배치를 적용하지 못했습니다. 이전 악보를 보존했습니다.';
  });
  $('v4-part-layout').addEventListener('click',async()=>{
    if(!state.doc)return;
    const options={pageFormat:$('page-orientation').value,
      replaceExisting:$('v4-cadence-replace').checked};
    const status=$('v4-part-layout-status');
    let plan;
    try{plan=planIndependentPartLayout(state.doc,options);}
    catch(error){status.textContent='개별 파트보 조판 차단: '+(error.message||'설정 오류');setMessage(status.textContent,true);return;}
    const before=state.doc;
    await commit(doc=>applyIndependentPartLayout(doc,options),'악기별 독립 줄·페이지 나눔');
    status.textContent=state.doc!==before?
      '악기 '+plan.parts+'파트 · 파트별 합계 '+plan.systems+'줄 · 예상 '+plan.pagesEstimated+
      '페이지 · 각 악기별 페이지를 별도 검수하세요.':
      '개별 조판을 적용하지 못했습니다. 기존 악보와 수동 지시를 보존했습니다.';
  });
  $('v4-play').addEventListener('click',async()=>{
    if(!state.doc)return;
    try{
      const timeline=buildPlaybackTimeline(state.doc,{defaultBpm:Number($('v4-tempo').value)});
      await player.play(timeline);
      $('v4-play-status').textContent='재생 중 · '+timeline.events.length+'음 · 약 '+Math.ceil(timeline.durationSeconds)+'초 · '+timeline.tempoChanges.map(x=>x.bpm+' BPM').join(' → ')
        +(timeline.warnings.length?' · 주의: '+timeline.warnings.join(' / '):'');
    }catch(error){player.stop();setMessage('간이 재생 실패: '+error.message,true);}
  });
  $('v4-play-range').addEventListener('click',async()=>{
    if(!state.doc)return;
    try{
      const region=measureToolbar.getRange();
      const full=buildPlaybackTimeline(state.doc,{defaultBpm:Number($('v4-tempo').value)});
      const excerpt=clipPlaybackToMeasures(full,region);
      const loop=$('v4-loop-range').checked;
      await player.play(excerpt,{loop});
      $('v4-play-status').textContent='선택 마디 '+(region.start+1)+
        (region.start===region.end?'':'–'+(region.end+1))+
        ' · '+excerpt.events.length+'음 · '+Math.ceil(excerpt.durationSeconds)+
        '초'+(loop?' · 반복 중 (정지 버튼으로 종료)':'')+
        (excerpt.warnings.length?' · 주의: '+excerpt.warnings.join(' / '):'');
    }catch(error){
      player.stop();setMessage('선택 마디 청음 실패: '+(error.message||'알 수 없는 오류'),true);
    }
  });
  $('v4-stop').addEventListener('click',()=>player.stop());
  const boundsStatus=pages=>{
    const audit=pages?.pageBoundsAudit;
    if(!audit)return ' · 페이지 경계 검사 정보 없음';
    if(audit.overflowPages)return ' · 페이지 밖 기보 의심 '+audit.overflowPages+'페이지';
    if(audit.unknownPages)return ' · 페이지 경계 미검증 '+audit.unknownPages+'페이지';
    return ' · 페이지 경계 초과 미탐지(육안 확인 필요)';
  };
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
        layout:$('v2-layout')?.value||'auto',
        measureNumbers:$('measure-numbers').checked,
        onProgress:detail=>setMessage('벡터 파트보 생성: '+detail)});
      if(win.closed){setMessage('인쇄용 창이 닫혀 출력이 취소됐습니다.',true);return;}
      const output=populateVectorPrintWindow(win,{pages,
        pageFormat,title:state.filename+' · J-WOO 벡터 파트보'});
      const lyricAudit=pages.lyricAudit;
      setMessage('벡터 파트보 '+output.pages+
        '페이지 준비 완료 · 가사 위치 자동 보정 '+(lyricAudit?.attempts||0)+
        '회 ·'+(lyricAudit?.remaining?' 남은 가사 겹침 의심 '+lyricAudit.remaining+'건 (음표 머리 '+(lyricAudit.noteheadCollisions||0)+'건 포함) ·':
          lyricAudit?.complete?' SVG 측정상 가사 겹침 0건 ·':
          ' 가사 위치 검사 미완료 ('+(lyricAudit?.measuredLyrics||0)+'/'+
            (lyricAudit?.expectedLyrics||0)+') ·')+
        boundsStatus(pages)+
        ' · 새 창의 인쇄/PDF 저장 버튼을 누르세요. 음표·가사·폰트·페이지의 시각적 검수는 필요합니다.');
    }catch(error){
      if(!win.closed)win.document.body.textContent='벡터 파트보 생성 실패: '+error.message;
      setMessage('벡터 파트보를 만들지 못했습니다: '+error.message,true);
    }finally{button.disabled=false;}
  });
  $('v4-part-svg-zip').addEventListener('click',async()=>{
    if(!state.doc)return;
    const button=$('v4-part-svg-zip');button.disabled=true;
    try{
      const names=new Map([...state.doc.querySelectorAll('part-list > score-part')].map(p=>[
        p.getAttribute('id'),p.querySelector('part-name')?.textContent||p.getAttribute('id'),
      ]));
      const parts=[...state.doc.documentElement.children].filter(n=>n.localName==='part')
        .map(p=>({id:p.getAttribute('id'),name:names.get(p.getAttribute('id'))||p.getAttribute('id')}));
      const pages=await renderPartSvgPages({doc:state.doc,parts,
        pageFormat:$('page-orientation').value,layout:$('v2-layout')?.value||'auto',
        measureNumbers:$('measure-numbers').checked,
        onProgress:detail=>setMessage('파트별 벡터 파일 준비: '+detail)});
      const result=await createPartSvgZip({pages,filename:state.filename});
      const url=URL.createObjectURL(result.blob),anchor=document.createElement('a');
      anchor.href=url;anchor.download=result.filename;anchor.click();
      setTimeout(()=>URL.revokeObjectURL(url),10000);
      setMessage('파트별 SVG '+result.parts+'개 파트 · '+result.pages+
        '페이지 ZIP 저장 완료 · 가사 보정 '+(pages.lyricAudit?.attempts||0)+'회 ·'+
        (pages.lyricAudit?.remaining?' 겹침 의심 '+pages.lyricAudit.remaining+'건 (음표 머리 '+(pages.lyricAudit.noteheadCollisions||0)+'건 포함) ·':
          pages.lyricAudit?.complete?' 측정상 겹침 0건 ·':
          ' 가사 위치 검사 미완료 ·')+
        boundsStatus(pages)+' · SVG는 벡터이지만 PDF 파일은 아닙니다.');
    }catch(error){setMessage('파트별 벡터 ZIP 생성 실패: '+error.message,true);}
    finally{button.disabled=false;}
  });
  $('v4-part-pdf-zip').addEventListener('click',async()=>{
    if(!state.doc)return;
    const button=$('v4-part-pdf-zip');button.disabled=true;
    try{
      const names=new Map([...state.doc.querySelectorAll('part-list > score-part')].map(p=>[
        p.getAttribute('id'),p.querySelector('part-name')?.textContent||p.getAttribute('id'),
      ]));
      const parts=[...state.doc.documentElement.children].filter(n=>n.localName==='part')
        .map(p=>({id:p.getAttribute('id'),name:names.get(p.getAttribute('id'))||p.getAttribute('id')}));
      const pageFormat=$('page-orientation').value;
      const pages=await renderPartSvgPages({doc:state.doc,parts,pageFormat,
        layout:$('v2-layout')?.value||'auto',
        measureNumbers:$('measure-numbers').checked,
        onProgress:detail=>setMessage('파트별 벡터 PDF 렌더링: '+detail)});
      const result=await createVectorPartPdfZip({pages,filename:state.filename,pageFormat,
        allowUnicodeText:$('v4-pdf-unicode-raster').checked,
        fontFile:$('v4-pdf-local-font').files?.[0]||null,
        onProgress:(count,total)=>setMessage('벡터 PDF 페이지 변환: '+count+' / '+total)});
      const url=URL.createObjectURL(result.blob),a=document.createElement('a');
      a.href=url;a.download=result.filename;a.click();
      setTimeout(()=>URL.revokeObjectURL(url),10000);
      setMessage('파트별 '+(result.hybridTextCount?'하이브리드':'벡터')+' PDF '+result.parts+
        '개 파트 · '+result.pages+'페이지 ZIP 저장 · 한글 이미지 '+result.hybridTextCount+
        '개 · TTF 벡터 글자 '+(result.embeddedVectorTextCount||0)+
        '개 · 가사 간격 자동 보정 '+(pages.lyricAudit?.attempts||0)+'회 ·'+
        (pages.lyricAudit?.remaining?' 남은 겹침 의심 '+pages.lyricAudit.remaining+'건 (음표 머리 '+(pages.lyricAudit.noteheadCollisions||0)+'건 포함) ·':
          pages.lyricAudit?.complete?' 측정상 겹침 0건 ·':
          ' 가사 위치 검사 미완료 ('+(pages.lyricAudit?.measuredLyrics||0)+'/'+
            (pages.lyricAudit?.expectedLyrics||0)+') ·')+
        boundsStatus(pages)+' · 실제 글꼴·악보·페이지를 PDF 뷰어에서 검수해 주세요.');
    }catch(error){
      setMessage('벡터 PDF ZIP 생성 차단: '+(error.message||'지원하지 않는 SVG 표기입니다.'),true);
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
  void refreshCheckpoints();
  return {beforeOpen,onRendered,onLoaded,onMeasurePointer:(index,extend=false,context)=>context?measureToolbar?.openContext(index,context):measureToolbar?.pick(index,extend),onSelectionChange:()=>{renderVoiceGrid();syncChordSelection();syncMeasureDelete();inlineLyrics.onSelectionChange(selected());},
    lyricMode:()=>inlineLyrics.isMode(),
    openLyricFromScore:(position,element)=>inlineLyrics.openFromScore(position,element),
    stop:()=>player.stop()};
}
