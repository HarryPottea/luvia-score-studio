import JSZip from 'jszip';

const MAX_TOTAL_XML_CHARS = 48 * 1024 * 1024;

/** Convert untrusted MusicXML titles and part names into safe, predictable download filenames. */
export function safeFileName(value, fallback = 'score') {
  const cleaned = String(value ?? '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').replace(/\s+/g, ' ').replace(/^\.+|\.+$/g, '').trim().slice(0, 72);
  return cleaned || fallback;
}

export function baseScoreName(filename) {
  return safeFileName(String(filename ?? '').replace(/\.(musicxml|xml|mxl)$/i, ''));
}

/** Each archive member contains one part; numbered names prevent duplicate instrument names from colliding. */
export function preparePartEntries(parts, scoreFilename, serializePart) {
  if (!Array.isArray(parts) || parts.length === 0) throw new Error('내보낼 파트가 없습니다.');
  if (typeof serializePart !== 'function') throw new Error('파트 직렬화 함수를 사용할 수 없습니다.');
  const stem = baseScoreName(scoreFilename);
  let totalChars = 0;
  return parts.map((part, index) => {
    if (!part || typeof part.id !== 'string' || !part.id) throw new Error('유효하지 않은 악기 파트가 있습니다.');
    const xml = serializePart(part.id);
    if (typeof xml !== 'string' || !/<score-partwise(?:\s|>)/.test(xml)) throw new Error('파트 MusicXML 내용을 만들지 못했습니다.');
    totalChars += xml.length;
    if (totalChars > MAX_TOTAL_XML_CHARS) throw new Error('파트별 자료가 너무 커서 일괄 압축할 수 없습니다. 파트를 개별 저장해주세요.');
    const number = String(index + 1).padStart(2, '0');
    const name = safeFileName(part.name, `part-${number}`);
    return { filename: `${stem}-${number}-${name}.musicxml`, xml };
  });
}

/** Compress the parts locally in the browser; does not call any network API. */
export async function buildPartZip({ parts, scoreFilename, serializePart, onProgress }) {
  const entries = preparePartEntries(parts, scoreFilename, serializePart);
  const zip = new JSZip();
  for (const entry of entries) zip.file(entry.filename, entry.xml);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 5 } },
    (metadata) => { if (typeof onProgress === 'function') onProgress(Math.max(0, Math.min(100, Math.floor(metadata.percent)))); });
}
