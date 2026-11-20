import { scanNotationCandidates, applyNotationCandidates, compareScoreMeasures } from './notation-review.js';
import { suggestLayout } from './layout-profile.js';
import { createPartPdfZip } from './pdf-batch.js';
import { baseScoreName } from './part-export.js';

const section = `
<div class="control-group v2-group"><div class="control-heading"><span>음표 표기 검사·수정</span><span>06</span></div>
<p class="control-hint">MusicXML에 기록된 음 길이와 표기값이 일치하지 않는 음표를 찾아 제안합니다. 자동 퀀타이즈가 아니며, 선택한 후보에만 적용됩니다.</p>
<div id="v2-candidates" class="v2-inspector" aria-live="polite"></div>
<div class="v2-actions"><button id="v2-rescan" type="button">후보 다시 검사</button><button id="v2-apply" type="button" disabled>선택된 기보 수정 적용</button><button id="v2-undo" type="button" disabled>음표 수정 되돌리기</button></div>
</div>
<div class="control-group v2-group"><div class="control-heading"><span>원본과 편집본 비교</span><span>07</span></div>
<div class="v2-actions"><button id="v2-view-original" type="button">원본 미리보기</button><button id="v2-view-current" type="button">현재 미리보기</button></div>
<div id="v2-diff" class="v2-inspector" aria-live="polite"></div>
<p class="control-hint">변경된 마디와 음표 표기의 개수를 확인할 수 있습니다. 모든 음악적 차이를 분석하는 기능은 아닙니다.</p>
</div>
<div class="control-group v2-group"><div class="control-heading"><span>조판·파트별 PDF</span><span>08</span></div>
<label for="v2-layout">악보 보표 간격</label><select id="v2-layout"><option value="auto">자동 추천</option><option value="standard">표준</option><option value="comfortable">여유 있게 (가사·보컬)</option><option value="compact">조밀하게 (합주)</option></select>
<p id="v2-layout-hint" class="control-hint"></p>
<button id="v2-batch-pdf" class="part-export-button part-export-batch" type="button">전체 파트 PDF ZIP 저장 (이미지 기반)</button>
<p class="control-hint">각 파트의 악보를 이미지 기반 A4 PDF로 묶습니다(최대 12파트·파트당 14쪽·전체 80쪽). 선명한 벡터 인쇄는 11 / 악보 구성의 ‘파트별 인쇄’를 사용하세요.</p>
</div>
`;

export function mountV2Controls({state,$,scoreParts,renderScore,refreshRhythmReport,invalidateRhythmUndo,setMessage,onExternalDocChange=()=>{},onViewChange=()=>{}}) {
  $('editor-controls').insertAdjacentHTML('beforeend',section);
  const candidateList=$('v2-candidates'),diffTarget=$('v2-diff');
  let current=[];
  let undoNoteDoc=null;
  function show(text,parent,tag='p') {const n=document.createElement(tag);n.textContent=text;parent.append(n);return n;}
  function refresh() {
    candidateList.replaceChildren();
    if (!state.doc) return;
    try {
      const report=scanNotationCandidates(state.doc);
      current=report.candidates.slice(0,60);
      show(`검토 가능한 음표 표기 ${report.candidates.length}건 · 보수적으로 제외한 마디 ${report.skipped}개`,candidateList);
      for(const candidate of current) {
        const label=document.createElement('label');label.className='v2-candidate';
        const cb=document.createElement('input');cb.type='checkbox';cb.value=candidate.key;cb.checked=true;
        label.append(cb,document.createTextNode(` ${candidate.partId} · ${candidate.measureNumber}마디 · ${candidate.pitch}: ${candidate.fromType} → ${candidate.toType}`));
        candidateList.append(label);
      }
      if(report.candidates.length>60) show('앞의 60건만 표시합니다. 나머지는 수정 후 다시 검사해 주세요.',candidateList);
      if(!report.candidates.length) show('안전하게 자동 제안할 기보 차이가 없습니다. 복잡한 리듬은 원본을 보존합니다.',candidateList);
      $('v2-apply').disabled=current.length===0;
    } catch(error) { current=[];$('v2-apply').disabled=true;show(`검사 실패: ${error.message}`,candidateList); }
    $('v2-undo').disabled=!undoNoteDoc;
    const comparison=compareScoreMeasures(state.originalDoc,state.doc);
    diffTarget.replaceChildren();
    show(`원본 대비 변경된 마디 ${comparison.total}개`,diffTarget);
    if(comparison.changed.length) {
      const list=document.createElement('ul');
      for(const c of comparison.changed.slice(0,20)) show(`${c.partId} · ${c.measureNumber}마디: 표기·음표 항목 ${c.differenceCount}개 차이`,list,'li');
      if(comparison.total>20) show(`외 ${comparison.total-20}개 마디의 변경이 있습니다.`,list,'li');
      diffTarget.append(list);
    }
    const suggested=suggestLayout(state.doc);
    $('v2-layout-hint').textContent=`추천: ${suggested.preset==='comfortable'?'여유 있게':suggested.preset==='compact'?'조밀하게':'표준'} · ${suggested.reason}`;
    $('v2-view-original').disabled=state.showBaseline;
    $('v2-view-current').disabled=!state.showBaseline;
  }
  function invalidateUndo() {undoNoteDoc=null;$('v2-undo').disabled=true;}
  $('v2-rescan').addEventListener('click',()=>{refresh();setMessage('음표 표기 후보와 원본 대비 변경사항을 다시 검사했습니다.');});
  $('v2-apply').addEventListener('click',async()=>{
    if(!state.doc || $('v2-apply').disabled) return;
    const selected=[...candidateList.querySelectorAll('input:checked')].map(x=>x.value);
    if(!selected.length){setMessage('수정할 후보를 선택해 주세요.');return;}
    const before=state.doc;
    try{
      const edited=applyNotationCandidates(before,selected);
      undoNoteDoc=before;invalidateRhythmUndo();
      state.doc=edited.doc;state.showBaseline=false;
      const ok=await renderScore();
      if(state.doc!==edited.doc)return;
      if(!ok){state.doc=before;undoNoteDoc=null;await renderScore();setMessage('변경 후 렌더링 실패로 원래 악보를 복원했습니다.',true);}
      else setMessage(`${edited.applied.length}건의 음표 모양을 실제 duration에 맞게 수정했습니다. 원본 비교를 확인하세요.`);
      refreshRhythmReport();refresh();onExternalDocChange();
    }catch(error){state.doc=before;undoNoteDoc=null;refresh();setMessage(`음표 수정 실패: ${error.message}`,true);}
  });
  $('v2-undo').addEventListener('click',async()=>{
    if(!undoNoteDoc)return;
    state.doc=undoNoteDoc;undoNoteDoc=null;state.showBaseline=false;
    refreshRhythmReport();refresh();onExternalDocChange();await renderScore();setMessage('직전 음표 표기 수정을 되돌렸습니다.');
  });
  $('v2-view-original').addEventListener('click',async()=>{
    if(!state.originalDoc)return;
    state.showBaseline=true;refresh();onViewChange();await renderScore();
    setMessage('원본 악보 미리보기입니다. 저장은 계속 현재 수정본을 대상으로 합니다.');
  });
  $('v2-view-current').addEventListener('click',async()=>{
    state.showBaseline=false;refresh();onViewChange();await renderScore();setMessage('현재 수정본 미리보기입니다.');
  });
  $('v2-layout').addEventListener('change',async()=>{
    if(!state.doc)return;
    const ok=await renderScore();
    if(ok)setMessage('레이아웃 설정을 변경했습니다. 인쇄 전 페이지 넘김과 가사를 확인하세요.');
  });
  let exporting=false;
  $('v2-batch-pdf').addEventListener('click',async()=>{
    if(!state.doc || exporting)return;
    const button=$('v2-batch-pdf'),source=state.doc.cloneNode(true),originalRef=state.doc;
    const parts=scoreParts().map(p=>({id:p.id,name:p.name}));
    exporting=true;button.disabled=true;
    try{
      const result=await createPartPdfZip({
        doc:source,parts,scoreFilename:state.filename,pageFormat:$('page-orientation').value,layout:$('v2-layout').value,measureNumbers:$('measure-numbers').checked,
        onProgress:message=>setMessage(`파트별 PDF 준비: ${message}`),
      });
      if(state.doc!==originalRef)throw new Error('PDF 생성 중 다른 악보를 불러왔습니다. 다시 실행해 주세요.');
      const url=URL.createObjectURL(result.blob);
      const link=document.createElement('a');link.href=url;link.download=`${baseScoreName(state.filename)}-파트PDF.zip`;link.click();
      setTimeout(()=>URL.revokeObjectURL(url),3000);
      setMessage(`PDF ${result.partCount}개(총 ${result.pageCount}페이지)를 ZIP으로 저장했습니다. 실제 인쇄 품질을 검토하세요.`);
    } catch(error){setMessage(`파트별 PDF 작업 실패: ${error.message || '브라우저 렌더링 오류'}`,true);}
    finally{exporting=false;button.disabled=false;}
  });
  return {refresh,invalidateUndo};
}
