import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCoalescedPreviewUpdate} from '../src/preview-update-queue.js';

function fakeTimers(){
  const active=new Map();let serial=0;
  return {
    active,
    setTimer(fn,delay){const id=++serial;active.set(id,{fn,delay});return id;},
    clearTimer(id){active.delete(id);},
    fire(){const current=[...active.values()];active.clear();for(const t of current)t.fn();}
  };
}
test('rapid checkbox changes coalesce to a single render of the final view',async()=>{
  const t=fakeTimers();let executed=0,pendingCalls=0;
  const queue=createCoalescedPreviewUpdate({
    run:()=>{executed++;},delay:140,
    setTimer:t.setTimer.bind(t),clearTimer:t.clearTimer.bind(t),
    onPending:()=>{pendingCalls++},
  });
  queue.request();queue.request();queue.request();
  assert.equal(t.active.size,1);
  assert.equal([...t.active.values()][0].delay,140);
  assert.equal(executed,0);
  assert.equal(pendingCalls,3);
  t.fire();await Promise.resolve();await Promise.resolve();
  assert.equal(executed,1);
  assert.equal(queue.pending,false);
});
test('cancellation prevents stale updates without touching score state',async()=>{
  const t=fakeTimers();let renders=0;
  const queue=createCoalescedPreviewUpdate({
    run:()=>{renders++;},setTimer:t.setTimer.bind(t),clearTimer:t.clearTimer.bind(t),
  });
  queue.request();queue.cancel();
  t.fire();await Promise.resolve();
  assert.equal(renders,0);
});
test('only view controls use the deferred queue while musical edits still call transactional render',()=>{
  const js=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
  assert.match(js,/toggle\.checked \? state\.visible\.add\(part\.id\) : state\.visible\.delete\(part\.id\)/);
  assert.match(js,/requestPreviewUpdate\(\);/);
  assert.match(js,/previewUpdater=createCoalescedPreviewUpdate/);
  assert.match(js,/container\.replaceChildren\(\.\.\.stage\.childNodes\)/);
  assert.match(js,/if\(token!==state\.renderToken\)return false/);
  assert.doesNotMatch(js,/const container = \$\('score-container'\); container\.replaceChildren\(\);/);
  assert.match(js,/const rendered = await renderScore\(\)/);
});
