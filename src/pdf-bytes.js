const enc = new TextEncoder();
const A4 = { A4_P: [595.28, 841.89], A4_L: [841.89, 595.28] };
const MAX_TOTAL_PAGES = 80;

export function makePdfFromJpegPages(pages, pageFormat='A4_P') {
  if (!Array.isArray(pages) || !pages.length || pages.length>MAX_TOTAL_PAGES || !A4[pageFormat]) throw new Error('PDF 페이지 정보가 올바르지 않습니다.');
  let bytes=0;
  for (const p of pages) {
    if (!(p.jpeg instanceof Uint8Array) || !p.jpeg.length || !Number.isSafeInteger(p.width) || !Number.isSafeInteger(p.height) || p.width<=0 || p.height<=0) throw new Error('PDF 이미지 데이터가 올바르지 않습니다.');
    bytes+=p.jpeg.length;
  }
  if(bytes>70*1024*1024) throw new Error('PDF 결과가 너무 큽니다.');
  const chunks=[], offsets=[0]; let position=0;
  function add(buffer) { const b=typeof buffer==='string'?enc.encode(buffer):buffer; chunks.push(b);position+=b.length; }
  function object(id, pieces) { offsets[id]=position; add(`${id} 0 obj\n`); for(const piece of pieces) add(piece); add('\nendobj\n'); }
  add(enc.encode('%PDF-1.4\n')); add(new Uint8Array([37,226,227,207,211,10]));
  object(1,['<< /Type /Catalog /Pages 2 0 R >>']);
  const ids=pages.map((_,i)=>3+i*3);
  object(2,[`<< /Type /Pages /Count ${pages.length} /Kids [${ids.map(id=>`${id} 0 R`).join(' ')}] >>`]);
  const [W,H]=A4[pageFormat];
  for (let i=0;i<pages.length;i++){
    const p=pages[i],id=ids[i],imageId=id+1,contentId=id+2;
    object(id,[`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`]);
    object(imageId,[`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,p.jpeg,'\nendstream']);
    const command=`q\n${W} 0 0 ${H} 0 0 cm\n/Im0 Do\nQ\n`;
    object(contentId,[`<< /Length ${enc.encode(command).length} >>\nstream\n`,command,'endstream']);
  }
  const xref=position;
  const count=3+pages.length*3;
  add(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for(let id=1;id<count;id++) add(`${String(offsets[id]).padStart(10,'0')} 00000 n \n`);
  add(`trailer\n<< /Root 1 0 R /Size ${count} >>\nstartxref\n${xref}\n%%EOF\n`);
  const out=new Uint8Array(position);let offset=0;
  for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length;}
  return out;
}

