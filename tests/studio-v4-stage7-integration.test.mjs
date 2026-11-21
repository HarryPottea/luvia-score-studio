import test from 'node:test';
import assert from 'node:assert/strict';
import {createEditorHistory} from '../src/editor-history.js';
import {createPortableScoreProject,readPortableScoreProject} from '../src/studio-v4-project-archive.js';
import {assertMusicXmlRoundTrip} from '../src/studio-v4-xml-roundtrip.js';

const xml=(tag,verse='Verse')=>'<?xml version="1.0" encoding="UTF-8"?>'+
  '<score-partwise version="4.0"><work><work-title>'+tag+'</work-title></work>'+
  '<part-list><score-part id="P1"><part-name>Vocal</part-name></score-part></part-list>'+
  '<part id="P1"><measure number="1"><attributes><divisions>48</divisions>'+
  '<time><beats>4</beats><beat-type>4</beat-type></time></attributes>'+
  '<note><pitch><step>C</step><octave>4</octave></pitch><duration>192</duration>'+
  '<type>whole</type><lyric number="1"><text>'+verse+'</text></lyric></note>'+
  '</measure></part></score-partwise>';

test('stage7: failed open restores the entire undo and redo timeline without redoing writes',()=>{
  const history=createEditorHistory(4);
  const first={id:'original'},second={id:'edited'},third={id:'articulated'};
  history.record(first,second,'음표 삽입');
  history.record(second,third,'셈여림 기호');
  const prior=history.undo(third);
  assert.equal(prior.doc,second);
  const saved=history.capture();
  history.record({id:'new'}, {id:'bad'},'실패한 불러오기');
  history.clear();
  history.restore(saved);
  assert.deepEqual(history.status(),{undo:1,redo:1,last:'음표 삽입'});
  assert.equal(history.redo(second).doc,third);
  assert.equal(history.undo(third).doc,second);
  assert.equal(history.undo(second).doc,first);
});
test('stage7: captured editor history is insulated against caller edits',()=>{
  const h=createEditorHistory(2),a={id:'A'},b={id:'B'};
  h.record(a,b,'변경');
  const snapshot=h.capture();
  snapshot.past[0].label='위조';
  assert.equal(h.status().last,'변경');
  assert.throws(()=>h.restore({past:[{label:'broken'}],future:[]}),/안전하게/);
  assert.equal(h.status().undo,1);
});
test('stage7: portable project preserves original, edited version and named recovery points',async()=>{
  const before=xml('곡 A','가사 1'),after=xml('곡 A','가사 2');
  const packet=await createPortableScoreProject({xml:after,filename:'곡 A.musicxml',
    snapshots:[{xml:before,filename:'곡 A.musicxml',label:'편집 전 버전'}]});
  const restored=await readPortableScoreProject(packet.blob);
  assert.equal(restored.xml,after);
  assert.equal(restored.snapshots[0].xml,before);
  assert.equal(restored.snapshots[0].label,'편집 전 버전');
  assert.equal(restored.filename,'곡 A.musicxml');
  assert.match(restored.sha256,/^[a-f0-9]{64}$/);
});
