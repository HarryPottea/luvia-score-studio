import test from 'node:test';
import assert from 'node:assert/strict';
import {stripExternalMusicXmlDoctype} from '../src/studio-v4-safe-xml-prolog.js';
const base='<score-partwise version="4.0"><part-list/></score-partwise>';
const expected=base;
test('stage6: removes external PUBLIC MusicXML 4.0 DTD only, leaves score bytes intact',()=>{
  const raw='<?xml version="1.0" encoding="UTF-8"?>\n'+
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN"\n'+
    '                   "http://www.musicxml.org/dtds/partwise.dtd">\n'+base;
  assert.equal(stripExternalMusicXmlDoctype(raw),
    '<?xml version="1.0" encoding="UTF-8"?>\n\n'+expected);
});
test('stage6: accepts safe SYSTEM declarations with quoted angle brackets in URLs',()=>{
  const raw='<!DOCTYPE score-partwise SYSTEM "https://example.com/a>b.dtd">'+base;
  assert.equal(stripExternalMusicXmlDoctype(raw),base);
});
test('stage6: preserves processing instructions, comments, and verbatim notes without DTD',()=>{
  const raw='<?xml version="1.0"?>\n<!-- by Composer -->\n'+base;
  assert.equal(stripExternalMusicXmlDoctype(raw),raw);
});
test('stage6: rejects internal subset entity definitions rather than corrupting lyrics',()=>{
  const input='<!DOCTYPE score-partwise [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+base;
  assert.throws(()=>stripExternalMusicXmlDoctype(input),/내부 DTD|ENTITY/);
  assert.throws(()=>stripExternalMusicXmlDoctype(base+'<!ENTITY bad "value">'),/ENTITY/);
});
test('stage6: denies malformed or duplicated DOCTYPE declarations',()=>{
  for(const bad of [
    '<!DOCTYPE score-timewise SYSTEM "https://example.com/timewise.dtd">'+base,
    '<!DOCTYPE score-partwise>'+base,
    '<!DOCTYPE score-partwise SYSTEM "https://example.com/schema.dtd"'+base,
    '<!DOCTYPE score-partwise SYSTEM "first.dtd"><!DOCTYPE score-partwise SYSTEM "second.dtd">'+base
  ])assert.throws(()=>stripExternalMusicXmlDoctype(bad),/DTD|DOCTYPE/);
});
test('stage6: denies unsupported XML document types while bounding memory',()=>{
  assert.throws(()=>stripExternalMusicXmlDoctype(null),/크기/);
  assert.throws(()=>stripExternalMusicXmlDoctype(''),/크기/);
  assert.throws(()=>stripExternalMusicXmlDoctype('a'.repeat(35*1024*1024+1)),/크기/);
});
