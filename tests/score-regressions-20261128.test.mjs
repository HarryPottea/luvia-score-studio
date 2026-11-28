import test from 'node:test';
import assert from 'node:assert/strict';
import {sourcePitch,matchScoreEvents} from '../src/score-hit.js';
import {renderedLineRanges,planRenderedLineEdit} from '../src/studio-v4-layout-cadence.js';
import {applyLayoutPreset} from '../src/layout-profile.js';
test('numeric OSMD pitch binds natural, sharp, flat, double accidentals without glyph text',()=>{
  for(const [fundamental,step,alter] of [[5,'F',1],[11,'B',-1],[0,'C',0],[2,'D',2],[4,'E',-2]]){
    const p=sourcePitch({Pitch:{FundamentalNote:fundamental,Octave:1,AccidentalHalfTones:alter,ToStringShort:()=> 'invalid'}});
    assert.deepEqual(p,{step,alter,octave:4});
    const event={...p,start:0,duration:4,eventIndex:7};
    assert.equal(matchScoreEvents([event],[{...p,start:0,duration:4}])[0].event.eventIndex,7);
    assert.equal(matchScoreEvents([event],[{...p,alter:alter+1,start:0,duration:4}]).length,0);
  }
  assert.equal(sourcePitch({Pitch:{FundamentalNote:1,Octave:1,AccidentalHalfTones:0}}),null);
});
function ranges(counts){
  const matrix=counts.flatMap(n=>{const sys={};return Array.from({length:n},()=>[{ParentStaffLine:{ParentMusicSystem:sys}}]);});
  return renderedLineRanges({GraphicSheet:{MeasureList:matrix}},matrix.length);
}
function doc(n){
  const node=(localName,children=[])=>({localName,children,getAttribute:()=>null});
  return {documentElement:node('score-partwise',[node('part',Array.from({length:n},()=>node('measure')))])};
}
test('actual overflow row is addressable and preceding three bars are preserved',()=>{
  const rows=ranges([3,1,4,2]);
  assert.deepEqual(rows.map(r=>r.bars),[3,1,4,2]);
  const edit=planRenderedLineEdit(doc(10),{barsPerSystem:4,lineOverrides:{}},rows,2,3);
  assert.equal(edit.start,3);
  assert.deepEqual(edit.options.lineOverrides,{1:3,2:3});
});
test('last singleton borrows from preceding line when possible',()=>{
  const edit=planRenderedLineEdit(doc(9),{barsPerSystem:4,lineOverrides:{}},ranges([4,4,1]),3,2);
  assert.equal(edit.start,7);
  assert.deepEqual(edit.options.lineOverrides,{2:3,3:2});
});
test('unmapped or impossible actual lines fail instead of reporting success',()=>{
  assert.equal(renderedLineRanges({GraphicSheet:{MeasureList:[[]]}},1),null);
  assert.throws(()=>planRenderedLineEdit(doc(3),{barsPerSystem:4,lineOverrides:{}},ranges([2,1]),2,2));
});
test('lyric spacing is applied in engraving units without accumulating',()=>{
  const osmd={EngravingRules:{LyricsYOffsetToStaffHeight:0}};
  applyLayoutPreset(osmd,'standard',null);applyLayoutPreset(osmd,'standard',null);
  assert.equal(osmd.EngravingRules.LyricsYOffsetToStaffHeight,0.8);
});
