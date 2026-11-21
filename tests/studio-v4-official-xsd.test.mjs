import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {verifyW3cCorpusSchema,verifyOfficialMusicXml4Fixtures,
  validateMusicXml4Files} from './musicxml4-validator.mjs';
import {readFile,writeFile,rm,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('stage6: official W3C XSD, ten independent scores, and one edited baseline obey MusicXML 4.0',{timeout:120000},async t=>{
  const probe=spawnSync('java',['--version'],{encoding:'utf8',timeout:10000});
  if((probe.error||probe.status!==0)&&!process.env.CI){
    t.skip('Independent Java XMLSchema runtime unavailable locally');
    return;
  }
  const p=await verifyW3cCorpusSchema();
  assert.equal(p.status,'PASS_MUSICXML4_INDEPENDENT_XSD');
  assert.equal(p.files,11);
  assert.equal(p.fixtureHashes,13);
  assert.match(p.output,/negatives=2 internet=disabled/);
});
test('stage6: pinned third-party schema and fixture integrity is fail-closed',async()=>{
  const p=await verifyOfficialMusicXml4Fixtures();
  assert.equal(p.verified.length,13);
  assert.equal(p.manifest.schema.ref,'v4.0');
  assert.equal(Object.keys(p.manifest.corpus.files).length,10);
});
test('stage6: an invalid MusicXML export must fail independent XSD', {timeout:120000},async t=>{
  const probe=spawnSync('java',['--version'],{encoding:'utf8',timeout:10000});
  if((probe.error||probe.status!==0)&&!process.env.CI){
    t.skip('Independent Java XMLSchema runtime unavailable locally');return;
  }
  const temp=await mkdtemp(join(tmpdir(),'jwoo-invalid-musicxml-'));
  try{
    const original=await readFile('tests/fixtures/complex-voices-original.musicxml','utf8');
    const corrupt=original.replace('<part-list>','<not-in-musicxml/>\n<part-list>');
    const bad=join(temp,'schema-invalid.musicxml');
    await writeFile(bad,corrupt);
    await assert.rejects(()=>validateMusicXml4Files([bad]),/XSD failed|invalid|FAILED/);
  }finally{await rm(temp,{recursive:true,force:true});}
});
