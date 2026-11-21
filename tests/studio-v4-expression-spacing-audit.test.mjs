import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectSvgExpressionSpacing,increaseExpressionEngravingSpace,
  adaptExpressionRendering} from '../src/studio-v4-expression-spacing-audit.js';

const item=(left,top,width,height,children=[])=>({
  localName:'g',children,
  contains(node){return children.includes(node);},
  getBoundingClientRect(){return {left,top,width,height};}
});
const svg=({expressions=[],heads=[],lyrics=[]}={})=>({
  localName:'svg',
  querySelectorAll(selector){
    if(selector.includes('vf-annotation'))return expressions;
    if(selector.includes('vf-notehead'))return heads;
    if(selector.includes('osmd-lyrics'))return lyrics;
    return [];
  }
});
test('stage4: detects expression against notehead, lyric and expression overlaps separately',()=>{
  const rendered=svg({
    expressions:[item(8,18,26,16),item(29,18,16,14)],
    heads:[item(12,24,12,10)],
    lyrics:[item(12,23,18,12)]
  });
  const r=inspectSvgExpressionSpacing([rendered]);
  assert.equal(r.status,'COLLISIONS_DETECTED');
  assert.equal(r.measured,2);
  assert.equal(r.expressionCollisions,1);
  assert.equal(r.noteheadCollisions,1);
  assert.equal(r.lyricCollisions,1);
  assert.equal(r.collisions,3);
  assert.equal(r.complete,true);
  assert.deepEqual(r.details.map(x=>x.kind),['expression','notehead','lyric']);
});
test('stage4: separate staves, stacked lyrics and remote expressions are not false positives',()=>{
  const rendered=svg({expressions:[item(10,4,18,9),item(10,52,18,9)],
    heads:[item(10,25,14,10),item(12,72,14,9)],
    lyrics:[item(10,94,18,9)]});
  const r=inspectSvgExpressionSpacing([rendered]);
  assert.equal(r.collisions,0);
  assert.equal(r.status,'NO_DETECTED_COLLISIONS');
  assert.equal(r.measured,2);
});
test('stage4: nested expression group is counted once, not double-counted',()=>{
  const nested=item(10,10,13,12),outer=item(9,9,15,14,[nested]);
  const r=inspectSvgExpressionSpacing([svg({expressions:[outer,nested]})]);
  assert.equal(r.measured,1);
  assert.equal(r.collisions,0);
});
test('stage4: unsupported bounds must never claim complete measurements',()=>{
  const invisible={localName:'g',getBoundingClientRect(){throw Error('hidden')}};
  const result=inspectSvgExpressionSpacing([svg({expressions:[invisible],heads:[item(2,2,10,10)]})]);
  assert.equal(result.unknown,1);
  assert.equal(result.complete,false);
  assert.equal(result.status,'PARTIALLY_MEASURED');
});
test('stage4: oversized expression or notehead collections are explicitly unmeasured',()=>{
  const expressions=Array.from({length:4},(_,i)=>item(i*20,10,5,5));
  const r=inspectSvgExpressionSpacing([svg({expressions})],{maxExpressions:3});
  assert.equal(r.status,'MEASUREMENT_LIMIT_EXCEEDED');
  assert.equal(r.complete,false);
});
test('stage4: bounded renderer reflow stops when colliding expressions become clear',async()=>{
  let narrow=true,calls=0;
  const holder={querySelectorAll(){
    return [svg({expressions:[item(10,15,18,15)],
      heads:[item(narrow?12:48,18,12,10)]})];
  }};
  const osmd={EngravingRules:{StaffDistance:4,BetweenStaffDistance:4,
    MinimumDistanceBetweenSystems:8},
    render(){calls++;narrow=false;}};
  const result=await adaptExpressionRendering(osmd,holder);
  assert.equal(result.initial,1);
  assert.equal(result.remaining,0);
  assert.equal(result.attempts,1);
  assert.equal(result.complete,true);
  assert.equal(calls,1);
  assert.ok(osmd.EngravingRules.StaffDistance>4);
});
test('stage4: unresolved collisions are not certified and retries are bounded',async()=>{
  let calls=0;
  const holder={querySelectorAll(){return [svg({expressions:[item(10,10,12,12)],
    heads:[item(12,11,12,10)]})];}};
  const osmd={EngravingRules:{StaffDistance:4},render(){calls++;}};
  const r=await adaptExpressionRendering(osmd,holder,{maxAttempts:2});
  assert.equal(r.remaining,1);
  assert.equal(r.attempts,2);
  assert.equal(r.collisionFreeCertified,false);
  assert.equal(calls,2);
});
test('stage4: invalid input and unusable rendering rules fail safely',async()=>{
  assert.throws(()=>inspectSvgExpressionSpacing([]),/옵션/);
  assert.throws(()=>inspectSvgExpressionSpacing([{}]),/SVG/);
  assert.throws(()=>increaseExpressionEngravingSpace(null),/설정/);
  await assert.rejects(()=>adaptExpressionRendering({},{}),/환경/);
});
