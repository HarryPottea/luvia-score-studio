import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {createPortableScoreProject,readPortableScoreProject}
  from '../src/studio-v4-project-archive.js';

const xml=title=>'<?xml version="1.0" encoding="utf-8"?>'+
  '<score-partwise version="4.0"><work><work-title>'+title+
  '</work-title></work><part-list><score-part id="P1"><part-name>Vocal</part-name>'+
  '</score-part></part-list><part id="P1"><measure number="1">'+
  '<attributes><divisions>48</divisions><time><beats>4</beats>'+
  '<beat-type>4</beat-type></time></attributes>'+
  '<note><pitch><step>C</step><octave>4</octave></pitch>'+
  '<duration>192</duration><type>whole</type>'+
  '<lyric number="1"><text>별빛</text></lyric></note></measure></part></score-partwise>';
function fileFromBlob(blob){return new Blob([blob],{type:'application/zip'});}
test('portable backup preserves Korean lyrics and named recovery versions byte for byte',async()=>{
  const source=xml('겨울 노래'),before=xml('첫 버전');
  const exported=await createPortableScoreProject({xml:source,filename:'겨울 노래.musicxml',
    snapshots:[{xml:before,filename:'겨울 노래.musicxml',label:'수정 전'}]});
  assert.match(exported.filename,/\.jwoo$/);
  assert.equal(exported.snapshots,1);
  const restored=await readPortableScoreProject(fileFromBlob(exported.blob));
  assert.equal(restored.xml,source);
  assert.equal(restored.filename,'겨울 노래.musicxml');
  assert.equal(restored.snapshots.length,1);
  assert.equal(restored.snapshots[0].xml,before);
  assert.equal(restored.snapshots[0].label,'수정 전');
  assert.match(restored.sha256,/^[a-f0-9]{64}$/);
});
test('portable archive rejects tampered score even if ZIP CRC is valid',async()=>{
  const archive=await createPortableScoreProject({xml:xml('A'),filename:'a.musicxml'});
  const z=await JSZip.loadAsync(await archive.blob.arrayBuffer());
  z.file('score.musicxml',xml('B'));
  const corrupted=await z.generateAsync({type:'blob'});
  await assert.rejects(readPortableScoreProject(fileFromBlob(corrupted)),/SHA-256/);
});
test('portable archive rejects unexpected executables or hidden extra entries',async()=>{
  const archive=await createPortableScoreProject({xml:xml('A'),filename:'a.musicxml'});
  const z=await JSZip.loadAsync(await archive.blob.arrayBuffer());
  z.file('unexpected.js','alert("unsafe")');
  const extra=await z.generateAsync({type:'blob'});
  await assert.rejects(readPortableScoreProject(fileFromBlob(extra)),/예상하지 않은/);
});
test('portable archive refuses unsafe XML and invalid input before any file is saved',async()=>{
  await assert.rejects(createPortableScoreProject({xml:'<!DOCTYPE score-partwise>'+
    xml('A'),filename:'a.musicxml'}),/안전한/);
  await assert.rejects(createPortableScoreProject({xml:xml('A'),filename:'../escape.xml'}),/이름/);
  await assert.rejects(createPortableScoreProject({xml:xml('A'),filename:'a.musicxml',
    snapshots:[{xml:xml('B'),filename:'x.musicxml',label:'\nunsafe'}]}),/설명/);
  await assert.rejects(createPortableScoreProject({xml:xml('A'),filename:'a.musicxml',
    snapshots:new Array(21).fill({xml:xml('B'),filename:'x.musicxml'})}),/목록/);
});
test('missing snapshot data is blocked even if manifest references it',async()=>{
  const archive=await createPortableScoreProject({xml:xml('A'),filename:'a.musicxml',
    snapshots:[{xml:xml('B'),filename:'a.musicxml',label:'old'}]});
  const z=await JSZip.loadAsync(await archive.blob.arrayBuffer());
  z.remove('versions/0001.musicxml');
  const trimmed=await z.generateAsync({type:'blob'});
  await assert.rejects(readPortableScoreProject(fileFromBlob(trimmed)),/누락/);
});
