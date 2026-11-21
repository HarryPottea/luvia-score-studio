import test from 'node:test';
import assert from 'node:assert/strict';
import {balanceMusicSystems} from '../src/studio-v4-system-balance.js';

test('balance prefers two-bar final system instead of one orphan last bar',()=>{
  const result=balanceMusicSystems([22,22,22,22,22],{capacity:90,maxBars:4});
  assert.deepEqual(result.systemStarts,[0,3]);
  assert.deepEqual(result.systemBars,[3,2]);
  assert.deepEqual(result.systemWeights,[66,44]);
});
test('tie and slur connection penalties discourage breaking at protected seam',()=>{
  const ordinary=balanceMusicSystems([25,25,25,25,25],{capacity:80,maxBars:3});
  const protectedLine=balanceMusicSystems([25,25,25,25,25],{
    capacity:80,maxBars:3,
    breakPenalties:[0,0,0,280,0,0]
  });
  assert.equal(ordinary.systemStarts.length,2);
  assert.deepEqual(protectedLine.systemStarts,[0,2]);
  assert.notDeepEqual(protectedLine.systemStarts,ordinary.systemStarts);
});
test('system plan tolerates one intrinsically oversized measure without pretending it fits',()=>{
  const r=balanceMusicSystems([105,12,12,12],{capacity:84,maxBars:4});
  assert.equal(r.systemBars[0],1);
  assert.equal(r.systemWeights[0],105);
  assert.ok(r.systemStarts.length>=2);
});
test('balanced layout is stable, monotonic, bounded, and rejects corrupt inputs',()=>{
  const weights=Array.from({length:100},(_,i)=>20+i%3);
  const a=balanceMusicSystems(weights,{capacity:110,maxBars:5});
  const b=balanceMusicSystems(weights,{capacity:110,maxBars:5});
  assert.deepEqual(a,b);
  assert.equal(a.systemBars.reduce((x,y)=>x+y,0),100);
  assert.ok(a.systemBars.every(x=>x>0&&x<=5));
  assert.ok(a.systemStarts.every((v,i)=>i===0||v>a.systemStarts[i-1]));
  for(const widths of [[],[0],[NaN],[Infinity],new Array(301).fill(20)])
    assert.throws(()=>balanceMusicSystems(widths),/설정/);
  assert.throws(()=>balanceMusicSystems([20,20],{capacity:0}),/설정/);
  assert.throws(()=>balanceMusicSystems([20,20],{breakPenalties:[0,-1]}),/설정/);
});
