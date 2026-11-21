import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectSvgPageBounds} from '../src/studio-v4-page-bounds.js';
const svg=({viewBox='0 0 300 400',ink={x:10,y:10,width:280,height:380},
  width='300',height='400',throwBox=false}={})=>({
    localName:'svg',getAttribute(k){return ({viewBox,width,height})[k]||null;},
    getBBox(){if(throwBox)throw Error('hidden');return ink;}
  });
test('A4-like page with fully contained notation reports no detected overflow',()=>{
  const report=inspectSvgPageBounds([svg(),svg({ink:{x:5,y:15,width:280,height:370}})]);
  assert.equal(report.measuredPages,2);
  assert.equal(report.overflowPages,0);
  assert.equal(report.unknownPages,0);
  assert.equal(report.complete,true);
  assert.equal(report.overflowFreeCertified,false);
});
test('flag left, top and right external notation with exact page references',()=>{
  const report=inspectSvgPageBounds([
    svg({ink:{x:-6,y:10,width:300,height:380}}),
    svg({ink:{x:10,y:-4,width:300,height:410}})
  ],{tolerance:2});
  assert.equal(report.overflowPages,2);
  assert.equal(report.details[0].page,1);
  assert.equal(report.details[0].left,6);
  assert.equal(report.details[1].page,2);
  assert.equal(report.details[1].top,4);
  assert.equal(report.details[1].right,10);
});
test('invisible or unmeasurable page is unknown, never certified clean',()=>{
  const unmeasured=svg({viewBox:'',width:'210mm',height:'297mm',throwBox:true});
  const report=inspectSvgPageBounds([unmeasured,svg()]);
  assert.equal(report.unknownPages,1);
  assert.equal(report.measuredPages,1);
  assert.equal(report.complete,false);
  assert.equal(report.status,'PARTIALLY_MEASURED');
  assert.throws(()=>inspectSvgPageBounds([]),/옵션/);
});
test('valid pixel width and height provide bounds when viewBox is absent',()=>{
  const report=inspectSvgPageBounds([svg({viewBox:'',width:'300px',height:'400px'})]);
  assert.equal(report.measuredPages,1);
  assert.equal(report.overflowPages,0);
});

test('an empty SVG bounding box is not a validated zero-overflow page',()=>{
  const result=inspectSvgPageBounds([svg({ink:{x:0,y:0,width:0,height:0}})]);
  assert.equal(result.measuredPages,0);
  assert.equal(result.unknownPages,1);
  assert.equal(result.complete,false);
});
