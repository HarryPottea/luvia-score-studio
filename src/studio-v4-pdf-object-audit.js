// Conservative post-generation inspection of locally created jsPDF files.
// Verifies that a PDF has the intended A4 pages and that an ASCII-only
// vector PDF did not silently become a raster-image PDF. This is a page-object
// integrity guard, NOT a typography/rendering/collision certification.
const fail=message=>{throw new Error(message);};
function numbers(bytes){
  if(bytes instanceof ArrayBuffer)return new Uint8Array(bytes);
  if(bytes instanceof Uint8Array)return bytes;
  fail('PDF의 바이트 형식을 확인할 수 없습니다.');
}
export function inspectGeneratedPdfObjects(bytes,{expectedPages,w,h,imagesAllowed=false}={}){
  const binary=numbers(bytes);
  if(binary.length<500||binary.length>24*1024*1024||
     !Number.isSafeInteger(expectedPages)||expectedPages<1||expectedPages>80||
     !Number.isFinite(w)||!Number.isFinite(h)||w<100||h<100||
     typeof imagesAllowed!=='boolean')
    fail('PDF의 크기 또는 검증 옵션이 올바르지 않습니다.');
  const ascii=new TextDecoder('latin1').decode(binary);
  if(!ascii.startsWith('%PDF-')||!ascii.includes('%%EOF'))
    fail('PDF 파일 헤더 또는 종료 표시가 올바르지 않습니다.');
  // Page dictionaries are uncompressed in jsPDF's regular PDF output.
  const pageObjects=(ascii.match(/\/Type\s*\/Page\b/g)||[]).length;
  const boxes=[...ascii.matchAll(/\/MediaBox\s*\[\s*([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s*\]/g)];
  if(pageObjects!==expectedPages||boxes.length!==expectedPages)
    fail('PDF에 포함된 페이지 수·크기 정보가 요청과 다릅니다.');
  for(const box of boxes){
    const [x1,y1,x2,y2]=box.slice(1).map(Number);
    if(![x1,y1,x2,y2].every(Number.isFinite)||
       Math.abs(x1)>0.1||Math.abs(y1)>0.1||
       Math.abs(x2-w)>0.6||Math.abs(y2-h)>0.6)
      fail('PDF 페이지가 실제 A4 용지 규격으로 생성되지 않았습니다.');
  }
  const images=(ascii.match(/\/Subtype\s*\/Image\b/g)||[]).length;
  if(!imagesAllowed&&images)
    fail('벡터 전용 PDF에 예상하지 않은 래스터 이미지 객체가 포함됐습니다.');
  return {pages:pageObjects,mediaBoxesVerified:true,embeddedImages:images,
    vectorGlyphsCertified:false,mode:imagesAllowed?'HYBRID_ALLOWED':'VECTOR_ONLY'};
}
