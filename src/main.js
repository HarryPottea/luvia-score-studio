import JSZip from 'jszip';
import { buildPartZip, baseScoreName, safeFileName } from './part-export.js';
import { scanScoreRhythm, applySafeRestCleanup } from './rhythm-dom.js';
import { applyLayoutPreset } from './layout-profile.js';
import { applyFixedA4Profile, fixedA4Profile } from './a4-engraving.js';
import { mountV2Controls } from './v2-controls.js';
import { mountV3Controls } from './v3-controls.js';
import { mountAdvancedControls } from './advanced-controls.js';
import { bindGraphicalEditor } from './score-hit.js';
import { midiToMusicXml } from './midi-import.js';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { sampleScore } from './sample.js';
import { mountStudioV4 } from './studio-v4.js';
import './style.css';

let v4 = null;
const MAX_FILE = 15 * 1024 * 1024;
const MAX_XML = 35 * 1024 * 1024;
const app = document.querySelector('#app');

app.innerHTML = `
  <div class="site-shell">
    <header class="topbar">
      <a class="brand" href="./" aria-label="JaeWoo Score 홈"><span class="brand-mark" aria-hidden="true">J.</span><span>JAEWOO SCORE</span></a>
      <nav class="topnav" aria-label="주 메뉴"><a href="#workspace">STUDIO</a><a href="#guide">HOW IT WORKS</a></nav>
      <div class="top-right"><span class="nav-note">FOR THE MUSIC YOU MAKE</span><button id="open-file" class="top-open" type="button">OPEN SCORE <span aria-hidden="true">↗</span></button></div>
    </header>
    <main>
      <section class="intro" aria-labelledby="hero-title">
        <div class="intro-eyebrow"><span>JAEWOO SCORE STUDIO — 001</span><span>COMPOSITION / NOTATION / PRINT</span></div>
        <h1 id="hero-title"><span>MUSIC TO</span><span>SCORE<span class="hero-period">.</span></span></h1>
        <div class="intro-bottom"><p>Logic Pro에서 내보낸 MusicXML을<br>읽기 좋은 악보로 정리하세요.</p><span class="local-only">파일은 브라우저 안에서만 처리</span></div>
        <div class="process-line" aria-label="작업 순서"><span>01&nbsp; IMPORT MUSICXML</span><i>↗</i><span>02&nbsp; REVIEW PARTS</span><i>↗</i><span>03&nbsp; EXPORT PDF</span><i>↗</i><span>YOUR MUSIC, YOUR FILE.</span></div>
      </section>
      <section class="workspace" id="workspace" aria-labelledby="workspace-title">
        <div class="workspace-heading"><span>01 / YOUR SCORE WORKSPACE</span><span>PREVIEW · A4 PORTRAIT</span></div>
        <div class="work-grid">
          <aside class="controls">
            <span class="workspace-kicker">A WORKSPACE FOR JAEWOO</span>
            <h2 id="workspace-title">악보를<br>직접 다듬다.</h2>
            <p class="workspace-description">음표·쉼표·가사부터 파트별 악보 출력까지 편집합니다.</p>
            <div id="drop-zone" class="drop-zone" role="button" tabindex="0" aria-label="MusicXML 파일 선택"><span class="drop-index">OPEN DOCUMENT</span><strong>악보 파일을 여기에 놓거나 선택</strong><small>.musicxml · .xml · .mxl · .mid · .midi</small><span class="drop-link">+ 파일 선택</span></div>
            <input id="file-input" type="file" accept=".musicxml,.xml,.mxl,.mid,.midi,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml,audio/midi" hidden />
            <div class="sample-action"><button id="try-sample" type="button">예시 악보 보기 <span aria-hidden="true">↗</span></button></div>
            <div id="editor-controls" class="editor-controls" hidden>
              <div class="control-group"><div class="control-heading"><span>곡 정보</span><span>01</span></div><label for="score-title">곡 제목</label><input id="score-title" type="text" maxlength="120" placeholder="곡 제목" /><label for="score-composer">작곡가</label><input id="score-composer" type="text" maxlength="120" placeholder="작곡가" /></div>
              <div class="control-group"><div class="control-heading"><span>파트</span><span>02</span></div><p class="control-hint">이름은 저장 파일에도 반영됩니다. 체크 해제는 미리보기·PDF에만 적용됩니다.</p><div id="parts-list" class="parts-list"></div></div>
              <div class="control-group"><div class="control-heading"><span>보기 설정</span><span>03</span></div><label for="page-orientation">용지 방향</label><select id="page-orientation"><option value="A4_P">A4 세로</option><option value="A4_L">A4 가로</option></select><p id="a4-size-info" class="control-hint" aria-live="polite">A4 자동 조판 · 오선 크기는 악보 구성에 맞춰 고정됩니다.</p><label class="check-row"><input id="measure-numbers" type="checkbox" checked /> 마디 번호 표시</label></div>
              <div class="control-group"><div class="control-heading"><span>개별 파트보</span><span>04</span></div><p class="control-hint">파트를 선택해 미리보기와 인쇄를 전환하거나, 해당 파트만 MusicXML로 저장할 수 있습니다.</p><label for="export-part">파트 선택</label><select id="export-part" aria-label="내보낼 파트 선택"></select><div class="part-tools"><button id="view-part" type="button">선택 파트 보기</button><button id="view-all-parts" type="button">전체 파트 보기</button></div><button class="part-export-button" id="download-part-xml" type="button">선택 파트 MusicXML 저장</button><button class="part-export-button part-export-batch" id="download-all-parts-zip" type="button">전체 파트 MusicXML ZIP 저장</button><p class="control-hint">각 파트를 개별 MusicXML로 묶어 저장합니다. PDF는 파트별 미리보기에서 따로 인쇄합니다.</p></div>
              <div class="control-group"><div class="control-heading"><span>리듬·쉼표 검사</span><span>05</span></div><p class="control-hint">복잡한 리듬은 표시만 합니다. 2/4·3/4·4/4 단일 성부에서 박자 경계가 맞는 연속 쉼표만 병합합니다.</p><div id="rhythm-report" class="rhythm-report" aria-live="polite">악보를 불러오면 검사 결과가 표시됩니다.</div><div class="rhythm-actions"><button id="check-rhythm" type="button">다시 검사</button><button id="apply-rhythm" type="button" disabled>안전한 쉼표 정리 적용</button><button id="undo-rhythm" type="button" disabled>정리 되돌리기</button></div><p class="control-hint">적용 전 원본 파일을 보존하세요. 변경 후에도 악보 표시와 연주 흐름을 검수해 주세요.</p></div>
            </div>
            <div class="privacy-note"><span aria-hidden="true">●</span> 곡 파일은 서버로 전송하지 않습니다.</div>
          </aside>
          <div class="preview-column">
            <div class="preview-toolbar"><div class="preview-summary"><span class="preview-indicator"></span><strong>악보 미리보기</strong><span id="score-info" class="score-info">파일을 열면 악보가 표시됩니다</span></div><div id="output-actions" class="output-actions" hidden><button id="download-xml" type="button">MusicXML 저장</button><button id="print-score" type="button">PDF로 인쇄 ↗</button></div></div>
            <div id="preview-shell" class="preview-shell"><div id="empty-preview" class="empty-preview"><div class="empty-heading"><span>DEMO SCORE / SELECT A FILE</span><span>1 / 1</span></div><div class="empty-sheet"><div class="empty-score-title"><strong>새벽의 스케치</strong><span>Sketch at Dawn</span></div><span class="empty-composer">박재우</span><svg class="score-svg" viewBox="0 0 620 360" xmlns="http://www.w3.org/2000/svg" aria-label="악보 구성 예시"><g fill="none" stroke="#252932" stroke-width="1.1"><path d="M40 36H610M40 49H610M40 62H610M40 75H610M40 88H610M40 163H610M40 176H610M40 189H610M40 202H610M40 215H610M40 290H610M40 303H610M40 316H610M40 329H610M40 342H610"/><path d="M40 36V88M40 163V215M40 290V342M235 290V342M430 290V342M610 290V342M235 36V88M430 36V88M610 36V88M235 163V215M430 163V215M610 163V215"/></g><g fill="#252932" font-family="Georgia,serif"><text x="48" y="87" font-size="62">𝄞</text><text x="90" y="61" font-size="17">4</text><text x="90" y="83" font-size="17">4</text><text x="48" y="214" font-size="62">𝄞</text><text x="90" y="188" font-size="17">4</text><text x="90" y="210" font-size="17">4</text></g><g fill="#252932" stroke="#252932" stroke-width="1.5"><ellipse cx="139" cy="75" rx="7" ry="4.5" transform="rotate(-24 139 75)"/><path d="M145 73V37"/><ellipse cx="180" cy="62" rx="7" ry="4.5" transform="rotate(-24 180 62)"/><path d="M186 60V24"/><ellipse cx="271" cy="55" rx="7" ry="4.5" transform="rotate(-24 271 55)"/><path d="M277 53V17"/><ellipse cx="320" cy="62" rx="7" ry="4.5" transform="rotate(-24 320 62)"/><path d="M326 60V24"/><ellipse cx="375" cy="68" rx="7" ry="4.5" transform="rotate(-24 375 68)"/><path d="M381 66V30"/><ellipse cx="477" cy="62" rx="7" ry="4.5" transform="rotate(-24 477 62)"/><path d="M483 60V24"/><ellipse cx="524" cy="49" rx="7" ry="4.5" transform="rotate(-24 524 49)"/><path d="M530 47V11"/><ellipse cx="565" cy="56" rx="7" ry="4.5" transform="rotate(-24 565 56)"/><path d="M571 54V18"/><ellipse cx="138" cy="202" rx="7" ry="4.5" transform="rotate(-24 138 202)"/><path d="M144 200V164"/><ellipse cx="178" cy="189" rx="7" ry="4.5" transform="rotate(-24 178 189)"/><path d="M184 187V151"/><ellipse cx="275" cy="196" rx="7" ry="4.5" transform="rotate(-24 275 196)"/><path d="M281 194V158"/><ellipse cx="320" cy="202" rx="7" ry="4.5" transform="rotate(-24 320 202)"/><path d="M326 200V164"/><ellipse cx="375" cy="189" rx="7" ry="4.5" transform="rotate(-24 375 189)"/><path d="M381 187V151"/><ellipse cx="477" cy="183" rx="7" ry="4.5" transform="rotate(-24 477 183)"/><path d="M483 181V145"/><ellipse cx="525" cy="190" rx="7" ry="4.5" transform="rotate(-24 525 190)"/><path d="M531 188V152"/><ellipse cx="136" cy="329" rx="7" ry="4.5" transform="rotate(-24 136 329)"/><path d="M142 327V291"/><ellipse cx="179" cy="316" rx="7" ry="4.5" transform="rotate(-24 179 316)"/><path d="M185 314V278"/><ellipse cx="279" cy="309" rx="7" ry="4.5" transform="rotate(-24 279 309)"/><path d="M285 307V271"/><ellipse cx="327" cy="316" rx="7" ry="4.5" transform="rotate(-24 327 316)"/><path d="M333 314V278"/><ellipse cx="479" cy="322" rx="7" ry="4.5" transform="rotate(-24 479 322)"/><path d="M485 320V284"/><ellipse cx="535" cy="309" rx="7" ry="4.5" transform="rotate(-24 535 309)"/><path d="M541 307V271"/></g><g fill="#7b828d" font-size="9" font-family="Arial,sans-serif"><text x="0" y="69">Piano</text><text x="23" y="192">Pno.</text><text x="15" y="320">3</text></g></svg><div class="empty-sheet-foot">예시 악보 · 실제 파일을 열면 교체됩니다</div></div></div><div id="score-container" class="score-container"></div></div>
            <p id="message" class="message" role="status" aria-live="polite"></p>
          </div>
        </div>
      </section>
      <section class="guide" id="guide"><div class="guide-heading"><span>HOW IT WORKS — 001</span><h2>세 단계로,<br>완성된 악보까지.</h2></div><div class="guide-steps"><div><span>01 / IMPORT</span><h3>MusicXML 열기</h3><p>Logic Pro에서 내보낸 .musicxml, .xml, .mxl 파일을 불러옵니다. .logicx 프로젝트는 직접 열 수 없습니다.</p></div><div><span>02 / REVIEW</span><h3>곡과 파트 정리</h3><p>제목·작곡가·악기 이름을 수정하고 표시할 파트를 선택합니다. 음표는 원본을 유지하며, 안전한 쉼표 정리는 사용자 선택 시에만 적용됩니다.</p></div><div><span>03 / EXPORT</span><h3>악보 저장</h3><p>수정한 MusicXML을 내려받거나 브라우저 인쇄 창에서 PDF로 저장합니다.</p></div></div></section>
    </main>
    <footer><span>JAEWOO SCORE STUDIO</span><span>YOUR MUSIC, YOUR FILE. &nbsp; / &nbsp; LOCAL PROCESSING ONLY</span></footer>
  </div>
`;

const $ = (id) => document.getElementById(id);
const state = { doc: null, originalDoc: null, filename: '', visible: new Set(), osmd: null, renderToken: 0, undoRhythmDoc: null, showBaseline: false, graphicBridge: null };
const input = $('file-input');
const drop = $('drop-zone');

function directChild(parent, tag) { return [...parent.children].find(el => el.localName === tag) ?? null; }
function childText(parent, tag) { return directChild(parent, tag)?.textContent?.trim() ?? ''; }
function ensureChild(parent, tag) { let child = directChild(parent, tag); if (!child) { child = parent.ownerDocument.createElement(tag); parent.appendChild(child); } return child; }
function parseXml(raw) {
  // MusicXML exports commonly contain a DTD. Strip it before DOMParser so a file never fetches external references.
  const safe = raw.replace(/<!DOCTYPE[\s\S]*?(?:\[[\s\S]*?\]\s*)?>|<!DOCTYPE[^>]*>/gi, '');
  const doc = new DOMParser().parseFromString(safe, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('MusicXML 내용을 읽지 못했습니다. 파일이 손상되었는지 확인해주세요.');
  if (doc.documentElement.localName !== 'score-partwise') throw new Error('현재는 MusicXML partwise 악보만 지원합니다. Logic Pro에서 다시 내보내주세요.');
  if (!doc.querySelector('part-list score-part, part')) throw new Error('악기 파트가 없는 MusicXML입니다.');
  return doc;
}

async function xmlFromFile(file) {
  if (file.size > MAX_FILE) throw new Error('파일이 너무 큽니다. 15MB 이하의 MusicXML 파일을 선택해주세요.');
  const name = file.name.toLowerCase();
  if (!/\.(musicxml|xml|mxl)$/.test(name)) throw new Error('지원하는 파일 형식은 .musicxml, .xml, .mxl입니다.');
  if (!name.endsWith('.mxl')) return file.text();
  const zip = await JSZip.loadAsync(file);
  const container = zip.file('META-INF/container.xml');
  if (!container) throw new Error('MXL 안에서 악보 위치 정보를 찾지 못했습니다.');
  const containerText = await container.async('string');
  const containerDoc = new DOMParser().parseFromString(containerText, 'application/xml');
  const path = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
  if (!path || path.startsWith('/') || path.includes('..')) throw new Error('MXL의 악보 경로가 올바르지 않습니다.');
  const entry = zip.file(path);
  if (!entry || entry._data?.uncompressedSize > MAX_XML) throw new Error('MXL의 악보가 없거나 너무 큽니다.');
  const xml = await entry.async('string');
  if (xml.length > MAX_XML) throw new Error('압축 해제한 악보가 너무 큽니다.');
  return xml;
}

function scoreParts() {
  if (!state.doc) return [];
  const list = state.doc.querySelector('part-list');
  return list ? [...list.children].filter(el => el.localName === 'score-part').map(el => ({ id: el.getAttribute('id'), name: childText(el, 'part-name') || '이름 없는 파트', element: el })) : [];
}

function setMessage(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); }
function showLoaded() {
  $('editor-controls').hidden = false;
  $('output-actions').hidden = false;
  $('empty-preview').hidden = true;
  $('drop-zone').classList.add('has-file');
  $('drop-zone').querySelector('strong').textContent = state.filename;
  $('drop-zone').querySelector('.drop-link').textContent = '+ 다른 파일 열기';
  const root = state.doc.documentElement;
  $('score-title').value = childText(root, 'movement-title') || childText(directChild(root, 'work') ?? root, 'work-title');
  const identification = directChild(root, 'identification');
  $('score-composer').value = identification ? [...identification.children].find(el => el.localName === 'creator' && el.getAttribute('type') === 'composer')?.textContent ?? '' : '';
  const parts = scoreParts();
  state.visible = new Set(parts.map(part => part.id));
  renderPartInputs();
  refreshRhythmReport();
  v2.refresh();
  v3.reset();
  $('score-info').textContent = `${parts.length}개 파트 · ${state.doc.querySelectorAll('part > measure').length}개 마디`;
}

function invalidateRhythmUndo() { state.undoRhythmDoc = null; $('undo-rhythm').disabled = true; }
function refreshRhythmReport() {
  const target = $('rhythm-report'); target.replaceChildren();
  if (!state.doc) return;
  let report;
  try { report = scanScoreRhythm(state.doc); }
  catch (error) { target.textContent = `검사 실패: ${error.message || '알 수 없는 오류'}`; $('apply-rhythm').disabled = true; return; }
  const heading = document.createElement('p'); heading.className = 'rhythm-result-heading';
  heading.textContent = `병합 가능한 쉼표 ${report.candidates.length}쌍 · 매우 짧은 음표·쉼표 ${report.warnings.length}개`;
  target.append(heading);
  const names = new Map(scoreParts().map(part => [part.id, part.name]));
  const entries = report.candidates.slice(0, 6).map(c => `${names.get(c.partId) || '파트'} · ${c.measureNumber}마디: ${c.type === 'quarter' ? '8분쉼표 2개 → 4분쉼표' : '16분쉼표 2개 → 8분쉼표'}`);
  if (report.candidates.length > 6) entries.push(`그 외 ${report.candidates.length - 6}쌍의 병합 후보가 있습니다.`);
  const warnings = [...new Set(report.warnings.map(w => `${names.get(w.partId) || '파트'} · ${w.measureNumber}마디: 매우 짧은 음표·쉼표 확인 권장`))].slice(0, 5);
  entries.push(...warnings);
  if (entries.length) {
    const list = document.createElement('ul');
    for (const entry of entries) { const li = document.createElement('li'); li.textContent = entry; list.append(li); }
    target.append(list);
  } else {
    const empty = document.createElement('p'); empty.textContent = '안전한 병합 후보가 없습니다. 복잡한 마디는 자동 변경하지 않습니다.'; target.append(empty);
  }
  $('apply-rhythm').disabled = report.candidates.length === 0;
  $('undo-rhythm').disabled = !state.undoRhythmDoc;
}

function renderPartInputs() {
  const list = $('parts-list'); list.replaceChildren();
  const selector = $('export-part');
  const selectedId = selector.value;
  selector.replaceChildren();
  scoreParts().forEach((part, i) => {
    const option = document.createElement('option');
    option.value = part.id;
    option.textContent = part.name;
    selector.append(option);
    const row = document.createElement('div'); row.className = 'part-row';
    const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = state.visible.has(part.id); toggle.setAttribute('aria-label', `${part.name} 미리보기 표시`);
    toggle.addEventListener('change', () => {
      toggle.checked ? state.visible.add(part.id) : state.visible.delete(part.id);
      if (!state.visible.size) { state.visible.add(part.id); toggle.checked = true; setMessage('미리보기에는 최소 한 개의 파트가 필요합니다.'); return; }
      renderScore();
    });
    const name = document.createElement('input'); name.type = 'text'; name.maxLength = 80; name.value = part.name; name.setAttribute('aria-label', `${i + 1}번 파트 이름`);
    name.addEventListener('change', () => {
      ensureChild(part.element, 'part-name').textContent = name.value.trim() || part.name;
      invalidateRhythmUndo(); state.showBaseline = false; v2.invalidateUndo(); v3.externalChanged();
      const priorSelection = selector.value;
      renderPartInputs();
      selector.value = priorSelection;
      renderScore(); v2.refresh();
    });
    row.append(toggle, name); list.append(row);
  });
  if ([...selector.options].some(option => option.value === selectedId)) selector.value = selectedId;
}

function filteredDocument(visibleIds, sourceDoc = state.doc) {
  const copy = sourceDoc.cloneNode(true);
  for (const part of [...copy.querySelectorAll('part')]) if (!visibleIds.has(part.getAttribute('id'))) part.remove();
  for (const def of [...copy.querySelectorAll('part-list > score-part')]) if (!visibleIds.has(def.getAttribute('id'))) def.remove();
  // Part-group markers describe multi-part braces. A filtered score can leave their boundaries unmatched.
  // Keep original groups only for the full score; a subset is presented without grouping.
  if (visibleIds.size < scoreParts().length) {
    for (const group of [...copy.querySelectorAll('part-list > part-group')]) group.remove();
  }
  return copy;
}

function previewDocument() { return filteredDocument(state.visible); }

const printPageStyle = document.createElement('style');
document.head.append(printPageStyle);
function updatePrintPageSize() {
  const landscape = $('page-orientation').value === 'A4_L';
  const width=landscape?297:210;
  printPageStyle.textContent = `@media print { @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 0; } .score-container, .score-container>div {width:${width}mm!important;max-width:none!important;} .score-container svg {width:${width}mm!important;max-width:none!important;height:auto!important;} }`;
}

function attachScoreInteractions(osmd){
  state.graphicBridge?.dispose?.();
  state.graphicBridge = null;
  if (state.showBaseline) return;
  state.graphicBridge = bindGraphicalEditor({
    osmd, doc:state.doc, visibleParts:[...state.visible],
    select:position=>v3.select(position),
    movePitch:(position,steps)=>v3.movePitch(position,steps),
    announce:count=>{ const el=document.getElementById('v3-graphic-hint');
      if (el) el.textContent = count ? `악보 화면에서 음표 ${count}개를 직접 선택할 수 있습니다. 음표를 위아래로 움직이거나 ↑↓ 키를 사용하세요.` : '악보에서 안전하게 연결된 음표가 없습니다. 보호된 붙임줄·중복 성부·숨겨진 음표는 편집하지 않습니다.';
    },
  });
  state.graphicBridge.highlight(v3.getSelection());
}
async function renderScore() {
  if (!state.doc) return false;
  const token = ++state.renderToken;
  state.graphicBridge?.dispose?.(); state.graphicBridge = null;
  const container = $('score-container'); container.replaceChildren();
  updatePrintPageSize();
  const format=$('page-orientation').value;
  const renderedDoc = state.showBaseline && state.originalDoc ? filteredDocument(state.visible, state.originalDoc) : previewDocument();
  const a4=fixedA4Profile(renderedDoc,format);
  container.style.width=`${a4.pageWidthPx}px`;
  $('a4-size-info').textContent=`A4 ${format==='A4_L'?'가로':'세로'} · 오선 ${a4.staffHeightMm}mm 고정 · 여백 ${a4.marginMm}mm · 화면 확대는 브라우저 확대 기능을 사용하세요.`;
  try {
    const osmd = new OpenSheetMusicDisplay(container, { autoResize: false, backend: 'svg', drawTitle: true, drawComposer: true, drawMeasureNumbers: $('measure-numbers').checked, pageFormat: $('page-orientation').value });
    await osmd.load(renderedDoc);
    if (token !== state.renderToken) return false;
    applyFixedA4Profile(osmd,renderedDoc,format);
    applyLayoutPreset(osmd, $('v2-layout')?.value || 'standard', renderedDoc);
    osmd.render(); state.osmd = osmd;
    try {attachScoreInteractions(osmd);} catch (error) {console.warn('Note selection unavailable',error);}
    $('score-info').textContent = scoreParts().length+'개 파트 · '+state.doc.querySelectorAll('part > measure').length+'개 마디';
    setMessage('악보가 준비되었습니다. 변경 사항은 MusicXML 저장에 반영됩니다.');
    v4?.onRendered?.();
    return true;
  } catch (error) {
    if (token !== state.renderToken) return false;
    setMessage(`악보 렌더링에 실패했습니다: ${error.message || '지원하지 않는 표기일 수 있습니다.'}`, true);
    return false;
  }
}

async function openScore(raw, filename) {
  try {
    const parsed = parseXml(raw);
    v4?.beforeOpen?.();
    state.doc = parsed; state.originalDoc = state.doc.cloneNode(true); state.filename = filename; state.undoRhythmDoc = null; state.showBaseline = false; v2.invalidateUndo();
    showLoaded();
    const rendered = await renderScore();
    if (!rendered) return false;
    $('workspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
    v4?.onLoaded?.();
    return true;
  } catch (error) { setMessage(error.message || '파일을 열지 못했습니다.', true); return false; }
}

async function handleFile(file) {
  if (!file) return;
  setMessage('파일을 읽고 있습니다…');
  try {
    if (/\.(mid|midi)$/i.test(file.name)) {
      if (file.size > 5 * 1024 * 1024) throw new Error('MIDI 파일은 5MB 이하만 지원합니다.');
      const result = midiToMusicXml(await file.arrayBuffer(), file.name);
      const title = file.name.replace(/\.(mid|midi)$/i, '') + '.musicxml';
      const loaded = await openScore(result.xml, title);
      if (loaded) setMessage('MIDI ' + result.report.tracks + '개 파트 · ' + result.report.notes + '개 음표를 가져왔습니다. ' +
        result.report.quantizedNotes + '개 음표의 시점/길이가 16분음표 그리드로 조정되었습니다. 원본과 반드시 대조하세요.');
    } else { await openScore(await xmlFromFile(file), file.name); }
  } catch (error) {setMessage(error.message || '파일을 읽지 못했습니다.', true);}
}

$('open-file').addEventListener('click', () => input.click());
drop.addEventListener('click', () => input.click());
drop.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.click(); } });
drop.addEventListener('dragover', event => { event.preventDefault(); drop.classList.add('drag-over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'));
drop.addEventListener('drop', event => { event.preventDefault(); drop.classList.remove('drag-over'); handleFile(event.dataTransfer?.files?.[0]); });
input.addEventListener('change', () => { handleFile(input.files?.[0]); input.value = ''; });
$('try-sample').addEventListener('click', () => openScore(sampleScore, '새벽의 스케치.musicxml'));

$('score-title').addEventListener('change', () => {
  if (!state.doc) return;
  const root = state.doc.documentElement; const title = $('score-title').value.trim();
  ensureChild(ensureChild(root, 'work'), 'work-title').textContent = title;
  ensureChild(root, 'movement-title').textContent = title;
  invalidateRhythmUndo(); state.showBaseline = false; v2.invalidateUndo(); v3.externalChanged();
  renderScore(); v2.refresh();
});
$('score-composer').addEventListener('change', () => {
  if (!state.doc) return;
  const identification = ensureChild(state.doc.documentElement, 'identification');
  let creator = [...identification.children].find(el => el.localName === 'creator' && el.getAttribute('type') === 'composer');
  if (!creator) { creator = state.doc.createElement('creator'); creator.setAttribute('type', 'composer'); identification.appendChild(creator); }
  creator.textContent = $('score-composer').value.trim(); invalidateRhythmUndo(); state.showBaseline = false; v2.invalidateUndo(); v3.externalChanged(); renderScore(); v2.refresh();
});
$('measure-numbers').addEventListener('change', renderScore);
$('check-rhythm').addEventListener('click', () => {
  if (!state.doc) return;
  refreshRhythmReport();
  setMessage('리듬·쉼표 검사를 완료했습니다. 원본은 변경하지 않았습니다.');
});
$('apply-rhythm').addEventListener('click', async () => {
  if (!state.doc || $('apply-rhythm').disabled) return;
  const before = state.doc;
  try {
    const result = applySafeRestCleanup(before);
    if (!result.changes) { refreshRhythmReport(); setMessage('정리할 쉼표가 없습니다.'); return; }
    state.undoRhythmDoc = before;
    state.doc = result.doc; state.showBaseline = false; v2.invalidateUndo();
    refreshRhythmReport();
    const rendered = await renderScore();
    if (state.doc !== result.doc) return; // A newer file superseded this result.
    if (!rendered) {
      state.doc = before;
      state.undoRhythmDoc = null;
      refreshRhythmReport();
      await renderScore();
      setMessage('변경 후 미리보기를 표시할 수 없어 쉼표 정리를 취소했습니다. 원본 상태를 유지합니다.', true);
      return;
    }
    v2.refresh(); v3.externalChanged();
    setMessage(`${result.changes}쌍의 쉼표를 병합했습니다. 음표의 길이와 총 연주시간은 변경하지 않았습니다. 결과를 검수해 주세요.`);
  } catch (error) { setMessage(`쉼표 정리를 적용하지 않았습니다: ${error.message || '검사 오류'}`, true); }
});
$('undo-rhythm').addEventListener('click', async () => {
  if (!state.undoRhythmDoc) return;
  state.doc = state.undoRhythmDoc;
  state.undoRhythmDoc = null;
  refreshRhythmReport(); state.showBaseline = false; v2.refresh(); v3.externalChanged();
  await renderScore();
  setMessage('쉼표 정리를 되돌렸습니다.');
});
$('page-orientation').addEventListener('change', renderScore);
$('view-part').addEventListener('click', () => {
  if (!state.doc || !$('export-part').value) return;
  state.visible = new Set([$('export-part').value]);
  renderPartInputs();
  renderScore();
});
$('view-all-parts').addEventListener('click', () => {
  if (!state.doc) return;
  state.visible = new Set(scoreParts().map(part => part.id));
  renderPartInputs();
  renderScore();
});
function serializeXmlDocument(doc) {
  const serialized = new XMLSerializer().serializeToString(doc);
  return /^\s*<\?xml\b/i.test(serialized) ? serialized : `<?xml version="1.0" encoding="utf-8"?>\n${serialized}`;
}
function downloadXmlDocument(doc, filename) {
  const xml = serializeXmlDocument(doc);
  const url = URL.createObjectURL(new Blob([xml], { type: 'application/vnd.recordare.musicxml+xml' }));
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
$('download-xml').addEventListener('click', () => {
  if (!state.doc) return;
  const base = state.filename.replace(/\.(musicxml|xml|mxl)$/i, '') || 'score';
  downloadXmlDocument(state.doc, `${safeFileName(base)}-정리.musicxml`);
  setMessage('전체 MusicXML 파일을 저장했습니다.');
});
$('download-part-xml').addEventListener('click', () => {
  if (!state.doc) return;
  const id = $('export-part').value;
  const part = scoreParts().find(item => item.id === id);
  if (!part) { setMessage('내보낼 파트를 선택해주세요.', true); return; }
  const base = state.filename.replace(/\.(musicxml|xml|mxl)$/i, '') || 'score';
  downloadXmlDocument(filteredDocument(new Set([id])), `${safeFileName(base)}-${safeFileName(part.name)}.musicxml`);
  setMessage(`${part.name} 파트를 MusicXML로 저장했습니다. 인쇄하려면 ‘선택 파트 보기’ 후 PDF로 인쇄를 누르세요.`);
});
let partZipInProgress = false;
$('download-all-parts-zip').addEventListener('click', async () => {
  if (!state.doc || partZipInProgress) return;
  const parts = scoreParts();
  if (!parts.length) return;
  const button = $('download-all-parts-zip');
  partZipInProgress = true;
  button.disabled = true;
  setMessage(`${parts.length}개 파트의 MusicXML을 준비하고 있습니다…`);
  try {
    const blob = await buildPartZip({
      parts, scoreFilename: state.filename,
      serializePart: (id) => serializeXmlDocument(filteredDocument(new Set([id]))),
      onProgress: (percent) => setMessage(`파트별 악보 압축 중… ${percent}%`),
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${baseScoreName(state.filename)}-전체파트.zip`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    setMessage(`${parts.length}개 파트를 ZIP 파일로 저장했습니다. 각 파일은 별도의 MusicXML 악보입니다.`);
  } catch (error) {
    setMessage(`파트별 ZIP 저장에 실패했습니다: ${error.message || '알 수 없는 오류'}`, true);
  } finally {
    partZipInProgress = false;
    button.disabled = false;
  }
});

$('print-score').addEventListener('click', () => { if (state.doc) window.print(); });

// Install the unified workspace after the existing score editor has initialized.
const v2 = mountV2Controls({ state, $, scoreParts, renderScore, refreshRhythmReport, invalidateRhythmUndo, setMessage,
  onExternalDocChange: () => v3.externalChanged(), onViewChange: () => v3.refresh() });
const v3 = mountV3Controls({ state, renderScore, refreshRhythmReport, refreshV2: () => {v2.invalidateUndo();v2.refresh();}, invalidateRhythmUndo, setMessage });
const advanced = mountAdvancedControls({state,v3,setMessage});
v3.onSelectionChange(() => advanced.refresh());
v4 = mountStudioV4({ state, v3, openScore, setMessage, renderScore });
