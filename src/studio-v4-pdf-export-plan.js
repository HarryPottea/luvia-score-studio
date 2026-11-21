// Stage 5 PDF export scope. The full score is a reserved, virtual output
// group, never a MusicXML part. Keep this separate from normal part IDs.
export const FULL_SCORE_EXPORT_ID='__JWOO_FULL_SCORE__';
const fail=m=>{throw new Error(m);};
export function prepareScoreAndPartExport(doc,parts){
  if(doc?.documentElement?.localName!=='score-partwise'||
     !Array.isArray(parts)||parts.length<1||parts.length>12)
    fail('전체 악보·파트보 PDF는 MusicXML 악기 1~12개를 지원합니다.');
  const live=[...doc.documentElement.children]
    .filter(p=>p.localName==='part').map(p=>p.getAttribute('id'));
  if(live.length!==parts.length||live.some(id=>!id||id===FULL_SCORE_EXPORT_ID)||
     new Set(live).size!==live.length||
     parts.some((p,i)=>!p||p.id!==live[i]||typeof p.name!=='string'||!p.name))
    fail('MusicXML의 전체 파트 순서·이름을 확인할 수 없어 출력하지 않습니다.');
  return [{id:FULL_SCORE_EXPORT_ID,name:'Full Score',fullScore:true},
    ...parts.map(p=>({id:p.id,name:p.name}))];
}
