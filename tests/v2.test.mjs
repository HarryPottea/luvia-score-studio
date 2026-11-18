import test from 'node:test';
import assert from 'node:assert/strict';
import { scanNotationCandidates, applyNotationCandidates, compareScoreMeasures } from '../src/notation-review.js';
import { suggestLayout, resolveLayoutPreset, applyLayoutPreset } from '../src/layout-profile.js';
import { makePdfFromJpegPages } from '../src/pdf-bytes.js';

class Node {
  constructor(localName, attrs={}, children=[], text=''){this.localName=localName;this.attrs={...attrs};this.children=children;this.text=String(text);}
  get textContent(){return this.children.length?this.children.map(x=>x.textContent).join(''):this.text;}
  set textContent(v){this.text=String(v);this.children=[];}
  getAttribute(name){return this.attrs[name]??null;}
  cloneNode(deep=false){return new Node(this.localName,this.attrs,deep?this.children.map(x=>x.cloneNode(true)):[],this.text);}
}
class Doc {constructor(root){this.documentElement=root;}cloneNode(){return new Doc(this.documentElement.cloneNode(true));}}
const el=(name,attrs={},children=[],text='')=>new Node(name,attrs,children,text);
const note=(duration,type,extra=[])=>el('note',{},[
  el('pitch',{},[el('step',{},[],'C'),el('octave',{},[],'4')]),
  el('duration',{},[],duration),el('type',{},[],type),...extra
]);
const rest=(duration,type)=>el('note',{},[el('rest'),el('duration',{},[],duration),el('type',{},[],type)]);
function score(notes,beats=4){
  return new Doc(el('score-partwise',{},[el('part',{id:'P1'},[el('measure',{number:'5'},[
    el('attributes',{},[el('divisions',{},[],'8'),el('time',{},[el('beats',{},[],String(beats)),el('beat-type',{},[],'4')])]),...notes
  ])])]));
}
const getNote=doc=>doc.documentElement.children[0].children[0].children[1];

test('notation proposals fix one mismatched type but do not touch its note duration or pitch',()=>{
  const before=score([note(8,'eighth'),note(8,'quarter'),note(8,'quarter'),note(8,'quarter')]);
  const report=scanNotationCandidates(before);
  assert.equal(report.candidates.length,1);
  assert.equal(report.candidates[0].toType,'quarter');
  assert.equal(report.candidates[0].measureNumber,'5');
  const result=applyNotationCandidates(before,[report.candidates[0].key]);
  assert.equal(getNote(before).children[2].textContent,'eighth');
  assert.equal(getNote(result.doc).children[2].textContent,'quarter');
  assert.equal(getNote(result.doc).children[1].textContent,'8');
  assert.equal(compareScoreMeasures(before,result.doc).total,1);
  assert.equal(compareScoreMeasures(before,before).total,0);
});

test('only explicitly selected notes are changed; invalid selection fails closed',()=>{
  const before=score([note(8,'eighth'),note(8,'eighth'),note(8,'quarter'),note(8,'quarter')]);
  const all=scanNotationCandidates(before).candidates;
  assert.equal(all.length,2);
  assert.equal(scanNotationCandidates(applyNotationCandidates(before,[all[0].key]).doc).candidates.length,1);
  assert.throws(()=>applyNotationCandidates(before,['fake']),/유효하지 않은/);
});

test('complex and incomplete bars are never given automatic note fixes',()=>{
  const beamed=score([note(8,'eighth',[el('beam',{},[],'begin')]),...Array.from({length:3},()=>note(8,'quarter'))]);
  assert.equal(scanNotationCandidates(beamed).candidates.length,0);
  const compound=score([note(8,'eighth'),...Array.from({length:3},()=>note(8,'quarter'))],6);
  assert.equal(scanNotationCandidates(compound).candidates.length,0);
  const short=score([note(8,'eighth'),note(8,'quarter')]);
  assert.equal(scanNotationCandidates(short).candidates.length,0);
  const tie=score([note(8,'eighth',[el('tie',{type:'start'})]),...Array.from({length:3},()=>note(8,'quarter'))]);
  assert.equal(scanNotationCandidates(tie).candidates.length,0);
  const dotted=score([note(8,'eighth',[el('dot')]),...Array.from({length:3},()=>note(8,'quarter'))]);
  assert.equal(scanNotationCandidates(dotted).candidates.length,0);
});

test('layout profile recommends extra spacing for vocal scores, and allows user override',()=>{
  const vocal=score([note(8,'quarter',[el('lyric',{},[el('text',{},[],'안녕')])]),...Array.from({length:3},()=>note(8,'quarter'))]);
  assert.equal(suggestLayout(vocal).preset,'comfortable');
  assert.equal(resolveLayoutPreset('auto',vocal),'comfortable');
  const fakeOsmd={EngravingRules:{MinimumDistanceBetweenSystems:10,StaffDistance:8,BetweenStaffDistance:7}};
  assert.equal(applyLayoutPreset(fakeOsmd,'compact',vocal),'compact');
  assert.equal(fakeOsmd.EngravingRules.StaffDistance,7.52);
});

test('PDF writer produces valid xref offsets and A4 per-page objects',()=>{
  const pdf=makePdfFromJpegPages([
    {jpeg:new Uint8Array([255,216,255,217]),width:100,height:200},
    {jpeg:new Uint8Array([255,216,255,217]),width:100,height:200},
  ],'A4_P');
  const text=new TextDecoder('latin1').decode(pdf);
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.match(text,/\/Count 2 \/Kids \[3 0 R 6 0 R\]/);
  assert.equal((text.match(/\/MediaBox \[0 0 595.28 841.89\]/g)||[]).length,2);
  const xref=Number(text.match(/startxref\n(\d+)\n%%EOF/)?.[1]);
  assert.equal(text.slice(xref,xref+4),'xref');
  const entries=text.slice(xref).split('\n').slice(2,10);
  assert.equal(entries.length,8);
  assert.equal(text.slice(Number(entries[1].slice(0,10)),Number(entries[1].slice(0,10))+7),'1 0 obj');
});

test('PDF writer rejects missing, oversize and malformed image data',()=>{
  assert.throws(()=>makePdfFromJpegPages([]),/올바르지/);
  assert.throws(()=>makePdfFromJpegPages([{jpeg:new Uint8Array(),width:0,height:1}]),/올바르지/);
  assert.throws(()=>makePdfFromJpegPages([{jpeg:new Uint8Array([1]),width:1,height:1}],'not-a-size'),/올바르지/);
});
