import test from 'node:test';
import assert from 'node:assert/strict';
import {preflightVectorPartPages} from '../src/studio-v4-vector-pdf.js';

function svg(strings=[]){
  return {localName:'svg',attributes:[],querySelector:()=>null,
    querySelectorAll:selector=>selector==='text,tspan'?
      strings.map(text=>({textContent:text})) : []};
}
test('vector part PDF preflight groups each score part independently',()=>{
  const pages=[
    {partId:'P1',partName:'Voice',svg:svg(['Verse'])},
    {partId:'P1',partName:'Voice',svg:svg(['Chorus'])},
    {partId:'P2',partName:'Piano',svg:svg(['Allegro'])},
  ];
  const output=preflightVectorPartPages(pages,'A4_P');
  assert.equal(output.parts,2);assert.equal(output.pages,3);
  assert.deepEqual(output.order,['P1','P2']);
  assert.equal(output.groups.get('P1').pages.length,2);
  assert.equal(output.groups.get('P2').pages.length,1);
  assert.equal(output.textFontCertified,false);
});
test('reject unembedded Korean or complex unicode rather than corrupting lyric glyphs',()=>{
  assert.throws(()=>preflightVectorPartPages([
    {partId:'P1',partName:'Voice',svg:svg(['우리의 노래'])}
  ]),/한글·특수문자/);
});
test('block invalid paper, page count, part overflow and active external SVG',()=>{
  const one={partId:'P1',partName:'Voice',svg:svg()};
  assert.throws(()=>preflightVectorPartPages([one],'US_LETTER'),/A4/);
  assert.throws(()=>preflightVectorPartPages([]),/1~80/);
  const many=Array.from({length:13},(_,i)=>({
    partId:'P'+i,partName:'Part'+i,svg:svg()
  }));
  assert.throws(()=>preflightVectorPartPages(many),/12개 파트/);
  const insecure={localName:'svg',attributes:[],
    querySelector:()=>({localName:'script'}),querySelectorAll:()=>[]};
  assert.throws(()=>preflightVectorPartPages([{
    partId:'P1',partName:'Voice',svg:insecure
  }]),/실행 요소/);
});
