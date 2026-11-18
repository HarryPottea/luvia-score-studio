import test from 'node:test';
import assert from 'node:assert/strict';
import { midiToMusicXml } from '../src/midi-import.js';
const quad=(n)=>[(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255];
const word=(n)=>[(n>>>8)&255,n&255];
function vlq(value) {
  const out=[value&127];
  while((value>>=7)>0)out.unshift((value&127)|128);
  return out;
}
const meta=(delta,type,bytes)=>[...vlq(delta),0xff,type,...vlq(bytes.length),...bytes];
const event=(delta,...data)=>[...vlq(delta),...data];
function smf(tracks,{ppq=480,format=0}={}) {
  const header=[...Array.from('MThd').map(c=>c.charCodeAt(0)),...quad(6),...word(format),...word(tracks.length),...word(ppq)];
  const bytes=tracks.flatMap(track=>[
    ...Array.from('MTrk').map(c=>c.charCodeAt(0)),...quad(track.length),...track
  ]);
  return new Uint8Array([...header,...bytes]);
}
const name=meta(0,3,[...new TextEncoder().encode('Vocal')]);
const meter=meta(0,0x58,[4,2,24,8]);
const end=meta(0,0x2f,[]);
const line=[...name,...meter,
  ...event(0,0x90,60,90),...event(480,0x80,60,0),
  ...event(0,0x90,62,90),...event(480,0x80,62,0),
  ...end
];
test('import monophonic MIDI 4/4 as an OSMD-compatible MusicXML part',()=>{
  const result=midiToMusicXml(smf([line]),'Test.mid');
  assert.deepEqual(Object.keys(result.report).includes('notes'),true);
  assert.equal(result.report.tracks,1);
  assert.equal(result.report.notes,2);
  assert.equal(result.report.quantizedNotes,0);
  assert.equal(result.report.measures,1);
  assert.match(result.xml,/<score-partwise version="4.0">/);
  assert.match(result.xml,/<movement-title>Test<\/movement-title>/);
  assert.match(result.xml,/<part-name>Vocal<\/part-name>/);
  assert.match(result.xml,/<duration>480<\/duration>/);
  assert.match(result.xml,/<step>C<\/step><octave>4<\/octave>/);
  assert.match(result.xml,/<step>D<\/step><octave>4<\/octave>/);
  assert.match(result.xml,/<rest\/>/);
});
test('quantization is counted and original off-grid ticks are never advertised as unchanged',()=>{
  const offGrid=[...name,...meter,...event(33,0x90,60,90),...event(449,0x80,60,0),...end];
  const r=midiToMusicXml(smf([offGrid]),'Shifted.mid');
  assert.equal(r.report.notes,1);
  assert.equal(r.report.quantizedNotes,1);
  assert.ok(r.report.maxQuantizationErrorTicks>0);
});
test('polyphonic overlapping MIDI fails without producing a misleading score',()=>{
  const chord=[...name,...meter,...event(0,0x90,60,90),...event(0,0x90,64,90),
    ...event(480,0x80,60,0),...event(0,0x80,64,0),...end];
  assert.throws(()=>midiToMusicXml(smf([chord])) ,/음표가 겹칩니다/);
});
test('SMF format 1 separates melodic tracks into multiple part names',()=>{
  const t0=[...meter,...end];
  const t1=[...name,...event(0,0x90,60,90),...event(480,0x80,60,0),...end];
  const t2=[...meta(0,3,[...new TextEncoder().encode('Piano')]),...event(0,0x90,48,90),...event(480,0x80,48,0),...end];
  const r=midiToMusicXml(smf([t0,t1,t2],{format:1}), 'Duet.mid');
  assert.equal(r.report.tracks,2);
  assert.match(r.xml,/<part-name>Piano<\/part-name>/);
  assert.match(r.xml,/<part id="P2">/);
});
test('unsupported time signature and mid-song change fail closed',()=>{
  const wrong=[...meta(0,0x58,[7,3,24,8]),...event(0,0x90,60,90),...event(480,0x80,60,0),...end];
  assert.throws(()=>midiToMusicXml(smf([wrong])),/지원하지 않는 MIDI 박자/);
  const changed=[...meter,...event(0,0x90,60,90),...meta(480,0x58,[3,2,24,8]),...event(0,0x80,60,0),...end];
  assert.throws(()=>midiToMusicXml(smf([changed])),/곡 중간/);
});
test('running status, drum channels, pitch bends and malformed files are guarded',()=>{
  const running=[...meter,...event(0,0x90,60,90),...event(480,60,0),...end];
  assert.equal(midiToMusicXml(smf([running])).report.notes,1);
  const drum=[...meter,...event(0,0x99,36,90),...event(480,0x89,36,0),...end];
  assert.throws(()=>midiToMusicXml(smf([drum])),/드럼/);
  const pitchBend=[...meter,...event(0,0xe0,64,0),...event(0,0x90,60,90),...event(480,0x80,60,0),...end];
  assert.throws(()=>midiToMusicXml(smf([pitchBend])),/피치벤드/);
  assert.throws(()=>midiToMusicXml(new Uint8Array([1,2,3,4])),/MIDI/);
});
