import JSZip from 'jszip';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { sampleScore } from './sample.js';
import './style.css';

const MAX_FILE = 15 * 1024 * 1024;
const MAX_XML = 35 * 1024 * 1024;
const app = document.querySelector('#app');

app.innerHTML = `
  <header class="topbar">
    <a class="brand" href="./" aria-label="LUVIA Score Studio 홈"><span class="brand-staff" aria-hidden="true">𝄞</span><span>LUVIA <b>SCORE</b></span></a>
    <span class="top-note">작곡 파일에서, 읽기 좋은 악보로.</span>
    <a class="guide-link" href="#guide">사용 방법</a>
  </header>
  <main>
    <section class="intro">
      <div class="intro-copy">
        <div class="intro-kicker"><span class="kicker-line"></span> LOGIC PRO → MUSICXML → PDF</div>
        <h1>음악을 쓴 다음,<br><em>악보를 다듬을 시간.</em></h1>
        <p>Logic Pro에서 내보낸 악보 파일을 열고, 제목과 파트 이름을 정리하세요. 화면에서 확인한 뒤 PDF로 저장할 수 있습니다.</p>
        <div class="intro-actions">
          <button class="button button-primary" id="open-file" type="button">악보 파일 열기 <span aria-hidden="true">↗</span></button>
          <button class="button button-text" id="try-sample" type="button">예시 악보 보기</button>
        </div>
        <p class="privacy-note"><span aria-hidden="true">◈</span> 파일은 이 브라우저에서만 처리하며 서버로 전송하지 않습니다.</p>
      </div>
      <div class="hero-score" aria-hidden="true"><div class="hero-score-label">A WORKSPACE FOR THE SCORE</div><div class="hero-stave"><span>♪</span><span>♩</span><span>♫</span><span>♩</span></div><div class="hero-score-bottom"><span>Preview / Refine / Print</span><span>01—04</span></div></div>
    </section>

    <section class="workspace" id="workspace">
      <div class="section-heading"><div><span class="section-index">작업 공간</span><h2>악보 정리</h2></div><span id="file-status" class="file-status">파일을 열어 시작하세요</span></div>
      <div class="work-grid">
        <aside class="controls">
          <div id="drop-zone" class="drop-zone" role="button" tabindex="0" aria-label="MusicXML 파일 선택"><span class="drop-icon">↥</span><strong>파일을 끌어놓거나 선택</strong><small>.musicxml · .xml · .mxl</small><span class="drop-link">파일 선택</span></div>
          <input id="file-input" type="file" accept=".musicxml,.xml,.mxl,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml" hidden />
          <div id="editor-controls" class="editor-controls" hidden>
            <div class="control-group"><div class="control-heading"><span>기본 정보</span><span class="tiny-number">01</span></div><label for="score-title">곡 제목</label><input id="score-title" type="text" maxlength="120" placeholder="곡 제목" /><label for="score-composer">작곡가</label><input id="score-composer" type="text" maxlength="120" placeholder="작곡가" /></div>
            <div class="control-group"><div class="control-heading"><span>파트</span><span class="tiny-number">02</span></div><p class="control-hint">이름은 저장 파일에도 반영됩니다. 눈 아이콘은 미리보기·PDF에만 적용됩니다.</p><div id="parts-list" class="parts-list"></div></div>
            <div class="control-group"><div class="control-heading"><span>보기 설정</span><span class="tiny-number">03</span></div><label for="zoom">확대 <span id="zoom-value">100%</span></label><input id="zoom" type="range" min="60" max="140" value="100" step="10" /><label class="check-row"><input id="measure-numbers" type="checkbox" checked /> 마디 번호 표시</label></div>
          </div>
        </aside>
        <div class="preview-column">
          <div class="preview-toolbar"><div><span class="preview-indicator"></span><strong>미리보기</strong><span id="score-info" class="score-info">MusicXML을 열면 악보가 표시됩니다</span></div><div id="output-actions" class="output-actions" hidden><button id="download-xml" type="button">MusicXML 저장</button><button id="print-score" class="button button-primary compact" type="button">PDF로 인쇄</button></div></div>
          <div id="preview-shell" class="preview-shell"><div id="empty-preview" class="empty-preview"><div class="empty-stave">𝄞  ♩  ♫  ♩</div><strong>여기에 악보가 펼쳐집니다</strong><p>먼저 MusicXML 파일을 열어주세요.<br>Logic Pro의 프로젝트 파일(.logicx)은 직접 열 수 없습니다.</p></div><div id="score-container" class="score-container"></div></div>
          <p id="message" class="message" role="status" aria-live="polite"></p>
        </div>
      </div>
    </section>

    <section class="guide" id="guide"><div class="guide-heading"><span class="section-index">시작하기 전에</span><h2>필요한 것은<br>MusicXML 한 파일.</h2></div><div class="guide-steps"><div><span>1</span><h3>Logic Pro에서 내보내기</h3><p>악보 편집기에서 <b>파일 → 내보내기 → 악보를 MusicXML로</b>를 선택하세요. MIDI 노트가 있는 트랙을 악보로 옮길 수 있습니다.</p></div><div><span>2</span><h3>정보와 파트 정리</h3><p>제목·작곡가·악기 이름을 수정하고, 인쇄할 파트만 표시하세요. 실제 음표와 리듬은 원본을 유지합니다.</p></div><div><span>3</span><h3>저장하거나 PDF로 인쇄</h3><p>정리한 MusicXML을 내려받거나, 브라우저 인쇄 창에서 PDF로 저장하세요. PDF 저장 위치는 사용자가 선택합니다.</p></div></div></section>
  </main>
  <footer><span>LUVIA SCORE STUDIO</span><span>로컬 파일 처리 · 외부 업로드 없음</span></footer>
`;

const $ = (id) => document.getElementById(id);
const state = { doc: null, filename: '', visible: new Set(), osmd: null, renderToken: 0 };
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
  $('file-status').textContent = state.filename;
  const root = state.doc.documentElement;
  $('score-title').value = childText(root, 'movement-title') || childText(directChild(root, 'work') ?? root, 'work-title');
  const identification = directChild(root, 'identification');
  $('score-composer').value = identification ? [...identification.children].find(el => el.localName === 'creator' && el.getAttribute('type') === 'composer')?.textContent ?? '' : '';
  const parts = scoreParts();
  state.visible = new Set(parts.map(part => part.id));
  renderPartInputs();
  $('score-info').textContent = `${parts.length}개 파트 · ${state.doc.querySelectorAll('part > measure').length}개 마디`;
}

function renderPartInputs() {
  const list = $('parts-list'); list.replaceChildren();
  scoreParts().forEach((part, i) => {
    const row = document.createElement('div'); row.className = 'part-row';
    const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = state.visible.has(part.id); toggle.setAttribute('aria-label', `${part.name} 미리보기 표시`);
    toggle.addEventListener('change', () => { toggle.checked ? state.visible.add(part.id) : state.visible.delete(part.id); if (!state.visible.size) { state.visible.add(part.id); toggle.checked = true; setMessage('미리보기에는 최소 한 개의 파트가 필요합니다.'); return; } renderScore(); });
    const name = document.createElement('input'); name.type = 'text'; name.maxLength = 80; name.value = part.name; name.setAttribute('aria-label', `${i + 1}번 파트 이름`);
    name.addEventListener('change', () => { ensureChild(part.element, 'part-name').textContent = name.value.trim() || part.name; renderScore(); });
    row.append(toggle, name); list.append(row);
  });
}

function previewDocument() {
  const copy = state.doc.cloneNode(true);
  for (const part of [...copy.querySelectorAll('part')]) if (!state.visible.has(part.getAttribute('id'))) part.remove();
  for (const def of [...copy.querySelectorAll('part-list > score-part')]) if (!state.visible.has(def.getAttribute('id'))) def.remove();
  return copy;
}

async function renderScore() {
  if (!state.doc) return;
  const token = ++state.renderToken;
  const container = $('score-container'); container.replaceChildren();
  try {
    const osmd = new OpenSheetMusicDisplay(container, { autoResize: true, backend: 'svg', drawTitle: true, drawComposer: true, drawMeasureNumbers: $('measure-numbers').checked, pageFormat: 'A4_P' });
    osmd.zoom = Number($('zoom').value) / 100;
    await osmd.load(previewDocument());
    if (token !== state.renderToken) return;
    osmd.render(); state.osmd = osmd;
    setMessage('악보가 준비되었습니다. 변경 사항은 MusicXML 저장에 반영됩니다.');
  } catch (error) {
    if (token !== state.renderToken) return;
    setMessage(`악보 렌더링에 실패했습니다: ${error.message || '지원하지 않는 표기일 수 있습니다.'}`, true);
  }
}

async function openScore(raw, filename) {
  try {
    state.doc = parseXml(raw); state.filename = filename;
    showLoaded(); await renderScore();
    $('workspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { setMessage(error.message || '파일을 열지 못했습니다.', true); }
}

async function handleFile(file) { if (!file) return; setMessage('파일을 읽고 있습니다…'); try { await openScore(await xmlFromFile(file), file.name); } catch (error) { setMessage(error.message || '파일을 읽지 못했습니다.', true); } }

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
  renderScore();
});
$('score-composer').addEventListener('change', () => {
  if (!state.doc) return;
  const identification = ensureChild(state.doc.documentElement, 'identification');
  let creator = [...identification.children].find(el => el.localName === 'creator' && el.getAttribute('type') === 'composer');
  if (!creator) { creator = state.doc.createElement('creator'); creator.setAttribute('type', 'composer'); identification.appendChild(creator); }
  creator.textContent = $('score-composer').value.trim(); renderScore();
});
$('zoom').addEventListener('input', () => { $('zoom-value').textContent = `${$('zoom').value}%`; if (state.osmd) { state.osmd.zoom = Number($('zoom').value) / 100; state.osmd.render(); } });
$('measure-numbers').addEventListener('change', renderScore);
$('download-xml').addEventListener('click', () => {
  if (!state.doc) return;
  const serialized = new XMLSerializer().serializeToString(state.doc);
  const xml = /^\s*<\?xml\b/i.test(serialized) ? serialized : `<?xml version="1.0" encoding="utf-8"?>\n${serialized}`;
  const url = URL.createObjectURL(new Blob([xml], { type: 'application/vnd.recordare.musicxml+xml' }));
  const link = document.createElement('a'); link.href = url; link.download = `${(state.filename.replace(/\.(musicxml|xml|mxl)$/i, '') || 'score')}-정리.musicxml`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000); setMessage('MusicXML 파일을 저장했습니다.');
});
$('print-score').addEventListener('click', () => { if (state.doc) window.print(); });
