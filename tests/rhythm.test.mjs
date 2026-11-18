import test from 'node:test';
import assert from 'node:assert/strict';
import { findSafeRestPairs } from '../src/rhythm-rules.js';
import { scanScoreRhythm, applySafeRestCleanup } from '../src/rhythm-dom.js';

// Tiny deterministic XML-node fixture: tests DOM orchestration without a new production dependency.
class Node {
  constructor(localName, attrs = {}, children = [], text = '') {
    this.localName = localName; this.map = { ...attrs }; this.children = children; this.text = String(text);
  }
  get attributes() { return Object.entries(this.map).map(([name, value]) => ({ name, value })); }
  get textContent() { return this.children.length ? this.children.map(child => child.textContent).join('') : this.text; }
  set textContent(value) { this.text = String(value); this.children = []; }
  getAttribute(name) { return this.map[name] ?? null; }
  removeAttribute(name) { delete this.map[name]; }
  removeChild(child) {
    const at = this.children.indexOf(child);
    if (at < 0) throw new Error('child missing');
    this.children.splice(at, 1);
  }
  cloneNode(deep = false) { return new Node(this.localName, this.map, deep ? this.children.map(child => child.cloneNode(true)) : [], this.text); }
}
class Doc {
  constructor(root) { this.documentElement = root; }
  cloneNode() { return new Doc(this.documentElement.cloneNode(true)); }
}
const node = (tag, attrs = {}, children = [], text = '') => new Node(tag, attrs, children, text);
const rest = (duration, type, extras = []) => node('note', {}, [node('rest'), node('duration', {}, [], duration), node('type', {}, [], type), ...extras]);
const note = (duration, type, extras = []) => node('note', {}, [node('pitch', {}, [node('step', {}, [], 'C'), node('octave', {}, [], '4')]), node('duration', {}, [], duration), node('type', {}, [], type), ...extras]);
const attrs = (divisions = 8, beats = 4, beatType = 4) => node('attributes', {}, [
  node('divisions', {}, [], divisions),
  node('time', {}, [node('beats', {}, [], beats), node('beat-type', {}, [], beatType)]),
]);
function score(children, { beats = 4, beatType = 4, prefix = [], measureAttrs = {} } = {}) {
  const measure = node('measure', { number: '1', ...measureAttrs }, [attrs(8, beats, beatType), ...prefix, ...children]);
  const part = node('part', { id: 'P1' }, [measure]);
  return new Doc(node('score-partwise', {}, [part]));
}
const getNotes = doc => doc.documentElement.children[0].children[0].children.filter(child => child.localName === 'note');
const durationSum = doc => getNotes(doc).map(item => Number(item.children.find(child => child.localName === 'duration').textContent)).reduce((a, b) => a + b, 0);

test('aligned eighth rests merge into a quarter rest without affecting notes or time', () => {
  const original = score([rest(4, 'eighth'), rest(4, 'eighth'), note(8, 'quarter'), note(8, 'quarter'), note(8, 'quarter')]);
  assert.equal(scanScoreRhythm(original).candidates.length, 1);
  const output = applySafeRestCleanup(original);
  assert.equal(output.changes, 1);
  assert.equal(getNotes(original).length, 5);
  assert.equal(getNotes(output.doc).length, 4);
  assert.equal(durationSum(original), durationSum(output.doc));
  assert.equal(getNotes(output.doc)[0].children.find(child => child.localName === 'type').textContent, 'quarter');
});

test('four consecutive sixteenth rests consolidate over two passes into one quarter rest', () => {
  const original = score([...Array.from({ length: 4 }, () => rest(2, '16th')), ...Array.from({ length: 3 }, () => note(8, 'quarter'))]);
  assert.equal(scanScoreRhythm(original).candidates.length, 2);
  const output = applySafeRestCleanup(original);
  assert.equal(output.changes, 3);
  assert.equal(getNotes(output.doc).length, 4);
  assert.equal(durationSum(output.doc), 32);
});

test('rest pairs crossing metrical boundaries are not rewritten', () => {
  const original = score([note(4, 'eighth'), rest(4, 'eighth'), rest(4, 'eighth'), note(4, 'eighth'), note(8, 'quarter'), note(8, 'quarter')]);
  assert.equal(scanScoreRhythm(original).candidates.length, 0);
});

test('compound time, pickup bars and incomplete bars remain unchanged', () => {
  const sixEight = score([rest(4, 'eighth'), rest(4, 'eighth'), note(4, 'eighth'), note(4, 'eighth'), note(4, 'eighth'), note(4, 'eighth')], { beats: 6, beatType: 8 });
  assert.equal(scanScoreRhythm(sixEight).candidates.length, 0);
  const pickup = score([rest(4, 'eighth'), rest(4, 'eighth'), ...Array.from({ length: 3 }, () => note(8, 'quarter'))], { measureAttrs: { implicit: 'yes' } });
  assert.equal(scanScoreRhythm(pickup).candidates.length, 0);
  const incomplete = score([rest(4, 'eighth'), rest(4, 'eighth'), note(8, 'quarter')]);
  assert.equal(scanScoreRhythm(incomplete).candidates.length, 0);
});

test('polyphony, tuplets, multi-staff and notated rests with extra markup are excluded', () => {
  const full = [rest(4, 'eighth'), rest(4, 'eighth'), ...Array.from({ length: 3 }, () => note(8, 'quarter'))];
  assert.equal(scanScoreRhythm(score(full, { prefix: [node('backup')] })).candidates.length, 0);
  const tuplet = score([rest(4, 'eighth'), rest(4, 'eighth'), note(8, 'quarter', [node('time-modification')]), note(8, 'quarter'), note(8, 'quarter')]);
  assert.equal(scanScoreRhythm(tuplet).candidates.length, 0);
  const multi = score([rest(4, 'eighth'), rest(4, 'eighth'), note(8, 'quarter', [node('staff', {}, [], '2')]), note(8, 'quarter'), note(8, 'quarter')]);
  assert.equal(scanScoreRhythm(multi).candidates.length, 0);
  const special = score([rest(4, 'eighth', [node('notations')]), rest(4, 'eighth'), ...Array.from({ length: 3 }, () => note(8, 'quarter'))]);
  assert.equal(scanScoreRhythm(special).candidates.length, 0);
});

test('complex rhythm warnings do not modify pitched events', () => {
  const scoreWithShortNote = score([note(1, '32nd'), note(31, 'half')]);
  const results = scanScoreRhythm(scoreWithShortNote);
  assert.equal(results.warnings.length, 1);
  assert.equal(results.candidates.length, 0);
});

test('inspection is conservative with input errors and budget boundaries', () => {
  assert.deepEqual(findSafeRestPairs({ divisions: null, beats: 4, beatType: 4, events: [] }), []);
  const original = score([rest(4, 'eighth'), rest(4, 'eighth'), ...Array.from({ length: 3 }, () => note(8, 'quarter'))]);
  assert.throws(() => applySafeRestCleanup(original, 0), /허용되지 않은/);
  assert.throws(() => applySafeRestCleanup(original, 0.5), /허용되지 않은/);
  assert.equal(getNotes(original).length, 5);
});
