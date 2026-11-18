// Read-only, conservative MusicXML notation review. No MIDI timing recovery is attempted.
const child = (n, name) => n ? [...n.children].find(x => x.localName === name) ?? null : null;
const children = (n, name) => n ? [...n.children].filter(x => x.localName === name) : [];
const txt = (n, name) => child(n, name)?.textContent?.trim() ?? '';
const positive = (s) => /^\d+$/.test(String(s)) && Number.isSafeInteger(Number(s)) && Number(s) > 0 ? Number(s) : null;
const TYPES = [['whole', 4], ['half', 2], ['quarter', 1], ['eighth', .5], ['16th', .25], ['32nd', .125]];
const COMPLEX = new Set(['chord','grace','cue','beam','time-modification','staff','tie','notations']);

function measureSafe(m, divisions, beats, beatType) {
  if (!divisions || ![2,3,4].includes(beats) || beatType !== 4 || m.getAttribute('implicit') === 'yes') return false;
  const all = [...m.children];
  if (children(m, 'attributes').length > 1 || all.some(n => ['backup','forward'].includes(n.localName))) return false;
  if (all.some((n,i) => n.localName === 'attributes' && all.slice(0,i).some(x => x.localName === 'note'))) return false;
  let total = 0;
  for (const n of children(m,'note')) {
    if ([...n.children].some(el => COMPLEX.has(el.localName))) return false;
    if (child(n,'voice') && txt(n,'voice') !== '1') return false;
    const duration = positive(txt(n,'duration'));
    if (!duration) return false;
    total += duration;
  }
  return total === divisions * beats;
}

export function scanNotationCandidates(doc) {
  if (!doc || doc.documentElement?.localName !== 'score-partwise') throw new Error('MusicXML partwise 형식만 지원합니다.');
  const candidates = []; let skipped = 0; let checked = 0;
  for (const part of children(doc.documentElement,'part')) {
    const id = part.getAttribute('id');
    let divisions, beats, beatType;
    for (const [measureIndex,m] of children(part,'measure').entries()) {
      for (const a of children(m,'attributes')) {
        const d = txt(a,'divisions'); if (d) divisions=positive(d);
        const time = child(a,'time');
        if (time) { beats=positive(txt(time,'beats')); beatType=positive(txt(time,'beat-type')); }
      }
      if (!id || !measureSafe(m,divisions,beats,beatType)) { skipped++; continue; }
      checked++;
      for (const [noteIndex,note] of [...m.children].entries()) {
        if (note.localName !== 'note' || child(note,'rest') || !child(note,'pitch') || !child(note,'type')) continue;
        if (children(note,'dot').length !== 0) continue; // Dotted notes need a separate metrical model.
        const duration = positive(txt(note,'duration'));
        const matching = TYPES.filter(([_,factor]) => Number.isSafeInteger(divisions*factor) && divisions*factor===duration);
        if (matching.length !== 1) continue;
        const nextType = matching[0][0]; const oldType = txt(note,'type');
        if (oldType === nextType || !TYPES.some(([t])=>t===oldType)) continue;
        const number = m.getAttribute('number') || String(measureIndex+1);
        const pitch = child(note,'pitch');
        const pitchName = `${txt(pitch,'step')}${txt(pitch,'alter') ? '('+txt(pitch,'alter')+')' : ''}${txt(pitch,'octave')}`;
        const key = `${id}::${measureIndex}::${noteIndex}`;
        candidates.push({ key, partId:id, measureIndex, measureNumber:number, noteIndex, pitch:pitchName, fromType:oldType, toType:nextType, duration });
      }
    }
  }
  return { candidates, skipped, checked };
}

/** Explicit, selected notation-only patch: duration and pitch remain byte-identical in the cloned DOM. */
export function applyNotationCandidates(original, keys) {
  const available = scanNotationCandidates(original).candidates;
  const selected = new Set(keys);
  const picked = available.filter(c => selected.has(c.key));
  if (picked.length !== selected.size) throw new Error('선택한 수정 후보 중 유효하지 않은 항목이 있습니다. 다시 검사해 주세요.');
  if (picked.length > 300) throw new Error('한 번에 수정할 수 있는 음표 수를 초과했습니다.');
  const doc = original.cloneNode(true);
  for (const c of picked) {
    const part = children(doc.documentElement,'part').find(p=>p.getAttribute('id')===c.partId);
    const measure = children(part,'measure')[c.measureIndex];
    const note = measure?.children[c.noteIndex];
    if (!note || note.localName!=='note' || txt(note,'type')!==c.fromType || positive(txt(note,'duration'))!==c.duration) throw new Error('수정 대상이 변경되었습니다.');
    child(note,'type').textContent=c.toType;
  }
  return { doc, applied:picked };
}

function snapshot(doc) {
  const result=new Map();
  if (!doc) return result;
  for (const part of children(doc.documentElement,'part')) {
    const partId=part.getAttribute('id') || '(unknown)';
    for (const [i,m] of children(part,'measure').entries()) {
      const serial=children(m,'note').map(n=>{
        const pitch=child(n,'pitch');
        const lyric=children(n,'lyric').map(l=>txt(l,'text')).join('|');
        return [child(n,'rest')?'rest':`${txt(pitch,'step')}${txt(pitch,'alter')}${txt(pitch,'octave')}`,txt(n,'duration'),txt(n,'type'),String(children(n,'dot').length),txt(n,'voice'),lyric,children(n,'tie').map(t=>t.getAttribute('type')).join('/')].join(':');
      });
      result.set(`${partId}::${i}`, { partId, measureIndex:i, number:m.getAttribute('number')||String(i+1), notes:serial });
    }
  }
  return result;
}

export function compareScoreMeasures(original, revised, maxEntries=80) {
  const before=snapshot(original), after=snapshot(revised);
  const keys = new Set([...before.keys(),...after.keys()]);
  const changed=[];
  for (const key of keys) {
    const a=before.get(key), b=after.get(key);
    const oldNotes=a?.notes??[], newNotes=b?.notes??[];
    if (JSON.stringify(oldNotes)===JSON.stringify(newNotes)) continue;
    let different=0;
    for (let i=0;i<Math.max(oldNotes.length,newNotes.length);i++) if(oldNotes[i]!==newNotes[i]) different++;
    changed.push({partId:(a||b).partId,measureNumber:(a||b).number,differenceCount:different,oldCount:oldNotes.length,newCount:newNotes.length});
  }
  return {changed:changed.slice(0,maxEntries),total:changed.length,truncated:changed.length>maxEntries};
}
