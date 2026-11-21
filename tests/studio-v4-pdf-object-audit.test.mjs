import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectGeneratedPdfObjects} from '../src/studio-v4-pdf-object-audit.js';

const makePdf=({pages=2,w=595.2756,h=841.8898,image=false,header=true,eof=true}={})=>{
  const parts=[header?'%PDF-1.4\n':'BADPDF\n',
    '1 0 obj\n<</Type /Pages /Count '+pages+'>>\nendobj\n'];
  for(let i=0;i<pages;i++){
    parts.push((i+2)+' 0 obj\n<</Type /Page /Parent 1 0 R /MediaBox [0 0 '+w+' '+h+']>>\nendobj\n');
  }
  if(image)parts.push('99 0 obj\n<</Subtype /Image /Width 64 /Height 64>>\nendobj\n');
  parts.push(' '.repeat(640),eof?'\n%%EOF\n':'\nNo end marker\n');
  return new TextEncoder().encode(parts.join('')).buffer;
};
test('generated PDF object audit recognizes A4 dimensions and all intended pages',()=>{
  const output=inspectGeneratedPdfObjects(makePdf(),{expectedPages:2,w:595.2756,h:841.8898});
  assert.deepEqual(output,{pages:2,mediaBoxesVerified:true,embeddedImages:0,
    vectorGlyphsCertified:false,mode:'VECTOR_ONLY'});
  assert.equal(inspectGeneratedPdfObjects(makePdf({pages:3,w:841.8898,h:595.2756}),
    {expectedPages:3,w:841.8898,h:595.2756}).pages,3);
});
test('generated PDF object audit refuses missing pages, non-A4 and broken headers',()=>{
  const options={expectedPages:2,w:595.2756,h:841.8898};
  assert.throws(()=>inspectGeneratedPdfObjects(makePdf({pages:1}),options),/페이지 수/);
  assert.throws(()=>inspectGeneratedPdfObjects(makePdf({w:590}),options),/A4/);
  assert.throws(()=>inspectGeneratedPdfObjects(makePdf({header:false}),options),/헤더/);
  assert.throws(()=>inspectGeneratedPdfObjects(makePdf({eof:false}),options),/종료/);
});
test('strict vector mode blocks raster images; hybrid Unicode explicitly allows them',()=>{
  const payload=makePdf({image:true}),options={expectedPages:2,w:595.2756,h:841.8898};
  assert.throws(()=>inspectGeneratedPdfObjects(payload,options),/래스터 이미지/);
  const allowed=inspectGeneratedPdfObjects(payload,{...options,imagesAllowed:true});
  assert.equal(allowed.embeddedImages,1);
  assert.equal(allowed.mode,'HYBRID_ALLOWED');
  assert.equal(allowed.vectorGlyphsCertified,false);
});
