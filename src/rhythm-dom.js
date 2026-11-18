import { findSafeRestPairs } from './rhythm-rules.js';

const direct = (parent, name) => parent ? [...parent.children].find(node => node.localName === name) ?? null : null;
const directText = (parent, name) => direct(parent, name)?.textContent?.trim() ?? '';
const parsePositiveInteger = (value) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const VERY_SHORT_TYPES = new Set(['32nd', '64th', '128th', '256th']);

function isPlainRest(note) {
  const allowedTags = new Set(['rest', 'duration', 'type', 'voice']);
  const allowedAttrs = new Set(['default-x', 'default-y', 'relative-x', 'relative-y']);
  const children = [...note.children];
  const rest = direct(note, 'rest');
  return Boolean(rest && children.length >= 3 && children.every(child => allowedTags.has(child.localName))
    && children.filter(child => child.localName === 'rest').length === 1
    && children.filter(child => child.localName === 'duration').length === 1
    && children.filter(child => child.localName === 'type').length === 1
    && !rest.attributes.length && !rest.children.length
    && [...note.attributes].every(attribute => allowedAttrs.has(attribute.name))
    && (!direct(note, 'voice') || directText(note, 'voice') === '1'));
}

function measureEvents(measure) {
  const children = [...measure.children];
  return children.map((child, index) => {
    if (child.localName !== 'note') return { kind: 'other', index };
    return {
      kind: direct(child, 'rest') ? 'rest' : 'note',
      index, duration: parsePositiveInteger(directText(child, 'duration')),
      type: directText(child, 'type'), safeRest: isPlainRest(child),
    };
  });
}

/** Read-only inspection: candidates are safe 16th→8th or 8th→quarter rest pairs in simple full quarter-meter measures. */
export function scanScoreRhythm(doc) {
  if (!doc || doc.documentElement?.localName !== 'score-partwise') throw new Error('MusicXML partwise 악보만 검사할 수 있습니다.');
  const candidates = [];
  const warnings = [];
  let skippedMeasures = 0;
  let inspectedMeasures = 0;
  for (const part of [...doc.documentElement.children].filter(child => child.localName === 'part')) {
    const partId = part.getAttribute('id');
    let divisions = null;
    let beats = null;
    let beatType = null;
    const measures = [...part.children].filter(child => child.localName === 'measure');
    for (let measureIndex = 0; measureIndex < measures.length; measureIndex++) {
      const measure = measures[measureIndex];
      const number = measure.getAttribute('number') || String(measureIndex + 1);
      const kids = [...measure.children];
      const attrs = kids.filter(child => child.localName === 'attributes');
      for (const attrsEl of attrs) {
        const newDivisions = directText(attrsEl, 'divisions');
        if (newDivisions) divisions = parsePositiveInteger(newDivisions);
        const time = direct(attrsEl, 'time');
        if (time) {
          beats = parsePositiveInteger(directText(time, 'beats'));
          beatType = parsePositiveInteger(directText(time, 'beat-type'));
        }
      }
      for (const note of kids.filter(child => child.localName === 'note')) {
        if (VERY_SHORT_TYPES.has(directText(note, 'type'))) {
          warnings.push({ partId, measureNumber: number, reason: '32분음표 이하의 짧은 음표·쉼표가 있습니다.' });
        }
      }
      // Changes in divisions or time after the measure has started are not safe to interpret as one timeline.
      const attrsAfterNotes = kids.some((child, index) => child.localName === 'attributes' && kids.slice(0, index).some(prev => prev.localName === 'note'));
      const hasPolyphony = kids.some(child => child.localName === 'backup' || child.localName === 'forward');
      const complexNotes = kids.some(child => child.localName === 'note' && (
        ['chord', 'grace', 'cue', 'time-modification', 'staff'].some(tag => direct(child, tag))
        || (direct(child, 'voice') && directText(child, 'voice') !== '1')
      ));
      if (!partId || measure.getAttribute('implicit') === 'yes' || attrs.length > 1 || attrsAfterNotes || hasPolyphony || complexNotes) {
        skippedMeasures++; continue;
      }
      inspectedMeasures++;
      for (const candidate of findSafeRestPairs({ divisions, beats, beatType, events: measureEvents(measure) })) {
        candidates.push({ ...candidate, partId, measureIndex, measureNumber: number });
      }
    }
  }
  return { candidates, warnings, skippedMeasures, inspectedMeasures };
}

/** Return an edited clone. Call only after an explicit user action; no source-document mutation occurs. */
export function applySafeRestCleanup(sourceDoc, maxMerges = 800) {
  if (!Number.isSafeInteger(maxMerges) || maxMerges <= 0) throw new Error('허용되지 않은 변경 제한입니다.');
  const doc = sourceDoc.cloneNode(true);
  let changes = 0;
  for (let pass = 0; pass < 6; pass++) {
    const candidates = scanScoreRhythm(doc).candidates;
    if (!candidates.length) return { doc, changes };
    if (changes + candidates.length > maxMerges) throw new Error('정리 후보가 너무 많습니다. 원본을 유지하고 더 작은 파일로 나눠주세요.');
    const parts = [...doc.documentElement.children].filter(child => child.localName === 'part');
    const ordered = [...candidates].sort((a, b) =>
      a.partId.localeCompare(b.partId) || a.measureIndex - b.measureIndex || b.secondIndex - a.secondIndex);
    for (const item of ordered) {
      const part = parts.find(el => el.getAttribute('id') === item.partId);
      const measure = [...part.children].filter(el => el.localName === 'measure')[item.measureIndex];
      const first = measure?.children[item.firstIndex];
      const second = measure?.children[item.secondIndex];
      if (!first || !second || first.localName !== 'note' || second.localName !== 'note') throw new Error('악보 구조가 변경되어 정리를 중지했습니다.');
      if (!isPlainRest(first) || !isPlainRest(second)) throw new Error('안전한 쉼표 형식이 아니어서 정리를 중지했습니다.');
      direct(first, 'duration').textContent = String(item.duration);
      direct(first, 'type').textContent = item.type;
      for (const name of ['default-x', 'default-y', 'relative-x', 'relative-y']) first.removeAttribute(name);
      measure.removeChild(second);
      changes++;
    }
  }
  return { doc, changes, remainingCandidates: scanScoreRhythm(doc).candidates.length };
}
