import test from 'node:test';
import assert from 'node:assert/strict';
import {matchScoreEvents} from '../src/score-hit.js';

test('a uniquely timed musical rest maps to its drawn rest',()=>{
  const source=[{rest:true,start:0,duration:192,eventIndex:0}];
  const graphic=[{rest:true,start:0,duration:192,gn:'rest-glyph'}];
  const mapped=matchScoreEvents(source,graphic);
  assert.equal(mapped.length,1);
  assert.equal(mapped[0].event.eventIndex,0);
  assert.equal(mapped[0].graphic.gn,'rest-glyph');
});
test('rests and notes at identical times never cross-map',()=>{
  const source=[
    {rest:true,start:0,duration:48,eventIndex:0},
    {step:'C',alter:0,octave:4,start:0,duration:48,eventIndex:1},
  ];
  const graphics=[
    {step:'C',alter:0,octave:4,start:0,duration:48,gn:'note'},
    {rest:true,start:0,duration:48,gn:'rest'},
  ];
  const matches=matchScoreEvents(source,graphics);
  assert.equal(matches.length,2);
  assert.equal(matches.find(x=>x.event.rest).graphic.gn,'rest');
  assert.equal(matches.find(x=>!x.event.rest).graphic.gn,'note');
});
test('ambiguous overlapping rest glyphs are deliberately not directly editable',()=>{
  const source=[
    {rest:true,start:0,duration:48,eventIndex:0,voice:'1'},
    {rest:true,start:0,duration:48,eventIndex:1,voice:'2'},
  ];
  const graphics=[{rest:true,start:0,duration:48,gn:'first'},
    {rest:true,start:0,duration:48,gn:'second'}];
  assert.equal(matchScoreEvents(source,graphics).length,0);
});
test('missing rest timing never binds to a rendered SVG glyph',()=>{
  assert.equal(matchScoreEvents([{rest:true,start:0,duration:undefined}],
    [{rest:true,start:0,duration:48}]).length,0);
});
