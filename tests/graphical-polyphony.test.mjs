import test from 'node:test';
import assert from 'node:assert/strict';
import {matchScoreEvents,shiftDiatonicPitch} from '../src/score-hit.js';

const event=(eventIndex,start,duration,step,alter=0,octave=4)=>({eventIndex,start,duration,step,alter,octave});
test('concurrent voices and chord notes are matched by full identity, not list order',()=>{
  const source=[event(0,0,12,'C'),event(1,0,12,'E'),event(2,12,4,'F'),event(3,0,12,'G',0,3)];
  const drawn=[source[3],source[1],source[2],source[0]].map(x=>({...x,svg:true}));
  const matches=matchScoreEvents(source,drawn);
  assert.equal(matches.length,4);
  assert.deepEqual(matches.map(x=>x.event.eventIndex),[0,1,2,3]);
  for(const item of matches)assert.equal(item.event.step,item.graphic.step);
});
test('same pitch, timestamp and duration in different voices is ambiguous and blocked',()=>{
  const source=[event(0,0,12,'C'),event(8,0,12,'C'),event(9,12,12,'D')];
  const drawn=[event(0,0,12,'C'),event(1,0,12,'C'),event(2,12,12,'D')];
  assert.deepEqual(matchScoreEvents(source,drawn).map(x=>x.event.eventIndex),[9]);
});
test('one-sided duplicates and mismatched pitch, octave, accidental or duration are rejected',()=>{
  const source=[event(0,0,12,'C'),event(1,12,12,'D',1,5)];
  assert.deepEqual(matchScoreEvents(source,[event(0,0,12,'C'),event(1,0,12,'C')]),[]);
  assert.deepEqual(matchScoreEvents(source,[event(0,0,12,'C'),event(1,12,12,'D',0,5)]).map(x=>x.event.eventIndex),[0]);
  assert.deepEqual(matchScoreEvents(source,[event(0,0,13,'C'),event(1,12,12,'D',1,4)]),[]);
});
test('drag changes diatonic pitch, not timing or accidental',()=>{
  assert.deepEqual(shiftDiatonicPitch({step:'B',alter:-1,octave:3},1),{step:'C',alter:-1,octave:4});
  assert.throws(()=>shiftDiatonicPitch({step:'G',octave:8},8),/옥타브/);
});
