import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { safeFileName, baseScoreName, preparePartEntries, buildPartZip } from '../src/part-export.js';

const parts = [
  { id: 'P1', name: 'Voice' },
  { id: 'P2', name: 'Voice' },
  { id: 'P3', name: 'Piano / Keyboard' },
];
const xmlForPart = (id) => `<?xml version="1.0"?><score-partwise version="4.0"><part id="${id}"><measure number="1"/></part></score-partwise>`;

test('safe filenames strip path syntax but preserve Unicode and meaningful titles', () => {
  assert.equal(safeFileName('../Bad:Name'), '_Bad_Name');
  assert.equal(safeFileName('  보컬  파트  '), '보컬 파트');
  assert.equal(safeFileName('...'), 'score');
  assert.equal(baseScoreName('작곡/메인.musicxml'), '작곡_메인');
});

test('part names are stable and collision-free even with duplicate instrument names', () => {
  const entries = preparePartEntries(parts, '뮤지컬 넘버.musicxml', xmlForPart);
  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map(entry => entry.filename), [
    '뮤지컬 넘버-01-Voice.musicxml',
    '뮤지컬 넘버-02-Voice.musicxml',
    '뮤지컬 넘버-03-Piano _ Keyboard.musicxml',
  ]);
  assert.ok(entries.every(entry => entry.xml.includes('<score-partwise')));
});

test('ZIP contains all individual MusicXML scores without remote API calls', async () => {
  const progress = [];
  const blob = await buildPartZip({
    parts, scoreFilename: 'song.mxl', serializePart: xmlForPart,
    onProgress: (value) => progress.push(value),
  });
  const zip = await JSZip.loadAsync(new Uint8Array(await blob.arrayBuffer()));
  const files = Object.keys(zip.files).sort();
  assert.deepEqual(files, [
    'song-01-Voice.musicxml',
    'song-02-Voice.musicxml',
    'song-03-Piano _ Keyboard.musicxml',
  ]);
  assert.match(await zip.file(files[1]).async('string'), /part id="P2"/);
  assert.ok(progress.length > 0);
  assert.equal(progress.at(-1), 100);
});

test('invalid and oversize archives fail closed before ZIP generation', () => {
  assert.throws(() => preparePartEntries([], 'empty.xml', xmlForPart), /내보낼 파트/);
  assert.throws(() => preparePartEntries([{ id: '', name: 'A' }], 'empty.xml', xmlForPart), /유효하지 않은/);
  assert.throws(() => preparePartEntries([parts[0]], 'score.xml', () => '<not-a-score/>'), /MusicXML/);
  const tooLarge = `<score-partwise>${'x'.repeat(49 * 1024 * 1024)}</score-partwise>`;
  assert.throws(() => preparePartEntries([parts[0]], 'huge.xml', () => tooLarge), /너무 커서/);
});
