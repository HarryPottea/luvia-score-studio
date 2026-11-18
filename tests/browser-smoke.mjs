// Browser-only integration smoke for the built candidate.
// Validates a synthetic MusicXML score end to end; it does NOT certify real Logic exports.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import JSZip from 'jszip';

const url = 'http://127.0.0.1:4173/';
const output = 'artifacts/browser-smoke';
await fs.mkdir(output, {recursive: true});
const server = spawn('node',['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4173','--strictPort'], {stdio: 'pipe'});
let serverOutput='';
server.stderr.on('data', data=>{ serverOutput += data.toString().slice(0,2000); });
let browser, page;
async function ready() {
  for(let i=0;i<80;i++) {
    if(server.exitCode!==null) throw new Error('Vite preview exited unexpectedly: '+serverOutput);
    try {const response=await fetch(url);if(response.ok)return;}catch {}
    await sleep(250);
  }
  throw new Error('Vite preview did not start');
}
try {
  await ready();
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
  const errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.goto(url,{waitUntil:'domcontentloaded'});
  console.log('BROWSER_STAGE=PAGE_OPEN');
  assert.ok((await page.title()).includes('JaeWoo'));
  await page.click('#try-sample');
  await page.locator('#score-container svg').first().waitFor({timeout:30000});
  console.log('BROWSER_STAGE=SCORE_RENDERED');
  await page.locator('#v3-events .v3-event').first().waitFor();
  assert.ok((await page.locator('#v3-events .v3-event').count())>0);
  const info=await page.locator('#v3-meter').textContent();
  assert.match(info,/단일 성부 편집 가능/);

  // Browser interaction with actual OSMD re-render + editable score DOM:
  await page.selectOption('#v3-step','F');
  await page.click('#v3-pitch');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('음정 변경 완료'));
  assert.match(await page.locator('#v3-events .v3-event').first().textContent(),/F4/);
  console.log('BROWSER_STAGE=EDIT_OK');
  await page.click('#v3-undo');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('되돌리기'));
  assert.match(await page.locator('#v3-events .v3-event').first().textContent(),/A4/);
  await page.click('#v3-redo');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('다시 실행'));
  assert.match(await page.locator('#v3-events .v3-event').first().textContent(),/F4/);
  console.log('BROWSER_STAGE=UNDO_REDO_OK');

  // Direct manipulation of a real SVG notehead must change the selected note,
  // then return to its previous pitch on undo.
  const notehead=page.locator('#score-container .jwoo-note-target').first();
  await notehead.waitFor();
  const box=await notehead.boundingBox();
  assert.ok(box&&box.width>0&&box.height>0);
  const beforeDrag=await page.locator('#v3-events .v3-event').first().textContent();
  const point={x:box.x+box.width/2,y:box.y+box.height/2};
  await page.mouse.move(point.x,point.y);
  await page.mouse.down();
  await page.mouse.move(point.x,point.y-Math.max(22,box.height*1.5),{steps:5});
  await page.mouse.up();
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('악보 음표 위아래 이동 완료'));
  const afterDrag=await page.locator('#v3-events .v3-event').first().textContent();
  assert.notEqual(afterDrag,beforeDrag);
  await page.click('#v3-undo');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('되돌리기'));
  assert.equal(await page.locator('#v3-events .v3-event').first().textContent(),beforeDrag);
  console.log('BROWSER_STAGE=SVG_DRAG_AND_UNDO');

  // Existing MusicXML export must preserve 3.0 changes.
  const downloadPromise=page.waitForEvent('download',{timeout:15000});
  await page.click('#download-xml');
  const xmlDownload=await downloadPromise;
  const xmlPath=await xmlDownload.path();
  const xml=await fs.readFile(xmlPath,'utf8');
  assert.match(xml,/<score-partwise/);
  assert.match(xml,/<step>F<\/step><octave>4<\/octave>/);
  console.log('BROWSER_STAGE=MUSICXML_EXPORTED');

  // Browser-produced per-part PDF must be a valid downloadable ZIP with a PDF.
  const pdfEvent=page.waitForEvent('download',{timeout:45000});
  await page.click('#v2-batch-pdf');
  const zipDownload=await pdfEvent;
  const zip=await JSZip.loadAsync(await fs.readFile(await zipDownload.path()));
  const pdfFiles=Object.values(zip.files).filter(x=>!x.dir&&x.name.endsWith('.pdf'));
  assert.equal(pdfFiles.length,1);
  const pdf=await pdfFiles[0].async('uint8array');
  assert.equal(new TextDecoder().decode(pdf.subarray(0,8)),'%PDF-1.4');
  await fs.writeFile(output+'/sample-part.pdf',pdf);
  console.log('BROWSER_STAGE=PDF_EXPORTED');
  await page.screenshot({path:output+'/sample-workspace.png',fullPage:true});

  // Open the deterministic multi-staff, voice + chord + tuplet MusicXML fixture
  // and verify real browser round-trip of a protected, pitch-only advanced edit.
  const fixture=await fs.readFile('tests/fixtures/complex-voices-original.musicxml');
  await page.setInputFiles('#file-input',{name:'complex-voices-original.musicxml',mimeType:'application/xml',buffer:fixture});
  await page.waitForFunction(()=>document.querySelector('#score-info')?.textContent.includes('1개 파트 · 1개 마디'),{timeout:30000});
  await page.locator('#v3-advanced-report').waitFor();
  const advancedReport=await page.locator('#v3-advanced-report').textContent();
  assert.match(advancedReport,/성부 1/);
  assert.equal(await page.locator('#v3-advanced-pitch').isEnabled(),true);
  await page.selectOption('#v3-advanced-step','D');
  await page.click('#v3-advanced-pitch');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('복합 기보 음정 변경 완료'));
  assert.match(await page.locator('#v3-events .v3-event').first().textContent(),/D4/);
  await page.click('#v3-undo');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('되돌리기'));
  assert.match(await page.locator('#v3-events .v3-event').first().textContent(),/C4/);
  console.log('BROWSER_STAGE=ADVANCED_POLYPHONIC_SCORE_ROUNDTRIP');

  // Add and remove an uncomplicated chord tone without changing occupied beats.
  await page.selectOption('#v3-advanced-step','G');
  await page.click('#v3-chord-add');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('화음 구성 음 추가 완료'));
  assert.equal(await page.locator('#v3-events .v3-event').count(),12);
  await page.locator('#v3-events .v3-event').nth(2).click();
  await page.click('#v3-chord-remove');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('화음 구성 음 삭제 완료'));
  assert.equal(await page.locator('#v3-events .v3-event').count(),11);
  console.log('BROWSER_STAGE=CHORD_ADD_REMOVE');
  const complexDownloadPromise=page.waitForEvent('download',{timeout:15000});
  await page.click('#download-xml');
  const complexDownload=await complexDownloadPromise;
  const complexPath=await complexDownload.path();
  await fs.copyFile(complexPath,output+'/complex-roundtrip.musicxml');
  const audit=JSON.parse(execFileSync('python3',[
    'tests/audit_musicxml.py','tests/fixtures/complex-voices-original.musicxml',
    '--compare',complexPath,
  ],{encoding:'utf8'}));
  assert.equal(audit.comparison.status,'STRUCTURE_MATCH');
  assert.equal(audit.comparison.pitchChanges,0);
  console.log('BROWSER_STAGE=COMPLEX_MUSICXML_ROUNDTRIP_VERIFIED');
  await page.screenshot({path:output+'/complex-score.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({status:'PASS_SYNTHETIC_BROWSER',xmlBytes:xml.length,pdfBytes:pdf.length,
    pdfCount:pdfFiles.length,graphicalNoteBindingHint:await page.locator('#v3-graphic-hint').textContent()}));
} catch(error) {
  if(page)await page.screenshot({path:output+'/failure.png',fullPage:true}).catch(()=>{});
  console.error(JSON.stringify({status:'FAIL_BROWSER',error:String(error),pageMessage:page?await page.locator('#message').textContent().catch(()=>null):null}));
  process.exitCode=1;
} finally {
  await browser?.close().catch(()=>{});
  server.kill('SIGTERM');
}
