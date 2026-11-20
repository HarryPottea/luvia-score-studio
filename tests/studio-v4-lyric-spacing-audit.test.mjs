import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectSvgLyricSpacing,increaseLyricEngravingSpace,adaptLyricRendering}
  from '../src/studio-v4-lyric-spacing-audit.js';

const text=(value,left,top,width=60,height=14)=>({
  localName:'text',textContent:value,
  getBoundingClientRect(){return {left,top,width,height};}
});
const svg=items=>({localName:'svg',querySelectorAll(selector){
  if(selector.includes('osmd-lyrics'))return items;
  return [];
}});
test('reports two same-line overlapping lyric syllables with measured intersection',()=>{
  const result=inspectSvgLyricSpacing([svg([
    text('반짝이는',0,120,80),text('사랑',68,120,45),text('다른 절',68,160,60)
  ])]);
  assert.equal(result.measured,3);
  assert.equal(result.collisions,1);
  assert.equal(result.details[0].a,'반짝이는');
  assert.equal(result.details[0].b,'사랑');
  assert.equal(result.status,'MEASURED');
  assert.equal(result.complete,true);
});
test('nonoverlapping syllables and different vertical verses are not false positives',()=>{
  const result=inspectSvgLyricSpacing([svg([
    text('처음',0,120,30),text('마지막',32,120,40),
    text('합창',10,153,30)
  ])]);
  assert.equal(result.collisions,0);
  assert.equal(result.measured,3);
});
test('overlarge or missing bounding boxes are not asserted as collision free',()=>{
  const invalid={localName:'text',textContent:'비어있는',getBoundingClientRect(){throw Error('font');}};
  const r=inspectSvgLyricSpacing([svg([invalid,text('나',10,20,30)])]);
  assert.equal(r.unknown,1);
  assert.equal(r.complete,false);
  assert.equal(r.status,'PARTIALLY_MEASURED');
  assert.equal(inspectSvgLyricSpacing([svg([invalid,text('나',0,0)])],
    {maxLyrics:1}).status,'MEASUREMENT_LIMIT_EXCEEDED');
  assert.throws(()=>inspectSvgLyricSpacing([svg([])],{minimumOverlapPx:0}),/설정/);
});
test('OSMD lyric spacing uses a bounded adjustment to known engraving rules',()=>{
  const rules={BetweenSyllableMinimumDistance:.5,HorizontalBetweenLyricsDistance:1,
    VerticalBetweenLyricsDistance:2,SomethingUnrelated:5};
  const result=increaseLyricEngravingSpace(rules,{factor:1.5});
  assert.equal(result.adjusted,3);
  assert.equal(result.collisionFreeCertified,false);
  assert.equal(rules.BetweenSyllableMinimumDistance,1.1);
  assert.equal(rules.HorizontalBetweenLyricsDistance,1.85);
  assert.equal(rules.SomethingUnrelated,5);
});
test('adaptive renderer retries only if collision found and stops once cleared',async()=>{
  let calls=0,offset=50;
  const a=text('반짝이는',0,120,65);
  const b={localName:'text',textContent:'사랑',
    getBoundingClientRect(){return {left:offset,top:120,width:40,height:14};}};
  const holder={querySelectorAll(){return [svg([a,b])];}};
  const osmd={EngravingRules:{BetweenSyllableMinimumDistance:1,
    HorizontalBetweenLyricsDistance:1,VerticalBetweenLyricsDistance:1},
    render(){calls++;offset=85;}};
  const result=await adaptLyricRendering(osmd,holder);
  assert.deepEqual({initial:result.initial,remaining:result.remaining,attempts:result.attempts},
    {initial:1,remaining:0,attempts:1});
  assert.equal(calls,1);
  const again=await adaptLyricRendering(osmd,holder);
  assert.equal(again.attempts,0);
  assert.equal(calls,1);
  assert.equal(again.collisionFreeCertified,false);
});
test('bounded retries retain an explicit unresolved-collision warning',async()=>{
  let calls=0;
  const holder={querySelectorAll(){return [svg([text('길게',0,10,100),
    text('길게',50,10,90)])];}};
  const osmd={EngravingRules:{BetweenSyllableMinimumDistance:1},render(){calls++;}};
  const r=await adaptLyricRendering(osmd,holder);
  assert.equal(r.attempts,2);
  assert.equal(r.remaining,1);
  assert.equal(calls,2);
});
