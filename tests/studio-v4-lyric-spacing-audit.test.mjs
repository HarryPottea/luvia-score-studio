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


const svgWithHeads=(lyrics,heads)=>({localName:'svg',querySelectorAll(query){
  return query==='.vf-notehead'?heads:lyrics;
}});
const head=(left,top,width=16,height=12)=>({
  localName:'g',getBoundingClientRect(){return {left,top,width,height};}
});
test('engraving measures actual lyric-to-notehead collisions, not only lyric-to-lyric',()=>{
  const r=inspectSvgLyricSpacing([svgWithHeads(
    [text('반짝이는',10,40,74,15)],[head(57,44,18,13)]
  )]);
  assert.equal(r.measured,1);
  assert.equal(r.measuredNoteheads,1);
  assert.equal(r.lyricNoteheadCollisions,1);
  assert.equal(r.collisions,1);
  assert.equal(r.details[0].b,'음표 머리');
  assert.equal(r.complete,true);
});
test('multiple staves or voices with nonintersecting text are not false positives',()=>{
  const r=inspectSvgLyricSpacing([svgWithHeads(
    [text('하늘',12,60,50,12),text('바다',15,85,50,12)],
    [head(25,10,18,12),head(27,135,18,12)]
  )]);
  assert.equal(r.measured,2);
  assert.equal(r.measuredNoteheads,2);
  assert.equal(r.lyricNoteheadCollisions,0);
  assert.equal(r.collisions,0);
});
test('unmeasurable notehead glyphs prevent a false completed-collision-check claim',()=>{
  const broken={localName:'g',getBoundingClientRect(){throw Error('geometry');}};
  const r=inspectSvgLyricSpacing([svgWithHeads([text('별빛',3,4,27)], [broken])]);
  assert.equal(r.unknownNoteheads,1);
  assert.equal(r.complete,false);
  assert.equal(r.status,'PARTIALLY_MEASURED');
});
test('bounded adaptive reflow also handles a lyric-versus-notehead overlap',async()=>{
  let headLeft=35,calls=0;
  const glyph={localName:'g',getBoundingClientRect(){
    return {left:headLeft,top:40,width:18,height:12};
  }};
  const holder={querySelectorAll(){return [svgWithHeads(
    [text('반짝이는',0,40,70,14)],[glyph]
  )];}};
  const osmd={EngravingRules:{BetweenSyllableMinimumDistance:1,
    VerticalBetweenLyricsDistance:1},render(){calls++;headLeft=90;}};
  const r=await adaptLyricRendering(osmd,holder,{maxAttempts:2});
  assert.equal(r.initial,1);
  assert.equal(r.remaining,0);
  assert.equal(r.noteheadCollisions,0);
  assert.equal(r.attempts,1);
  assert.equal(calls,1);
});
