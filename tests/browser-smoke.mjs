// Browser-only integration smoke for the built candidate.
// Validates a synthetic MusicXML score end to end; it does NOT certify real Logic exports.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import JSZip from 'jszip';

const url = 'http://127.0.0.1:4173/';
const output = 'artifacts/browser-smoke';
await fs.mkdir(output, {recursive: true});
const server = spawn('npm',['run','preview','--','--port','4173','--strictPort'], {stdio: 'pipe'});
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
  assert.ok((await page.title()).includes('JaeWoo'));
  await page.click('#try-sample');
  await page.locator('#score-container svg').first().waitFor({timeout:30000});
  await page.locator('#v3-events .v3-event').first().waitFor();
  assert.ok((await page.locator('#v3-events .v3-event').count())>0);
  const info=await page.locator('#v3-meter').textContent();
  assert.match(info,/단일 성부 편집 가능/);

  // Browser interaction with actual OSMD re-render + editable score DOM:
  await page.selectOption('#v3-step','F');
  await page.click('#v3-pitch');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('음정 변경 완료'));
  assert.match(await page.locator('#v3-events .v3-event').first().textContent(),/F4/);
  await page.click('#v3-undo');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('되돌리기'));
  assert.match(await page.locator('#v3-events .v3-event').first().textContent(),/A4/);
  await page.click('#v3-redo');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('다시 실행'));
  assert.match(await page.locator('#v3-events .v3-event').first().textContent(),/F4/);

  // Existing MusicXML export must preserve 3.0 changes.
  const downloadPromise=page.waitForEvent('download',{timeout:15000});
  await page.click('#download-xml');
  const xmlDownload=await downloadPromise;
  const xmlPath=await xmlDownload.path();
  const xml=await fs.readFile(xmlPath,'utf8');
  assert.match(xml,/<score-partwise/);
  assert.match(xml,/<step>F<\/step><octave>4<\/octave>/);

  // Browser-produced per-part PDF must be a valid downloadable ZIP with a PDF.
  const pdfEvent=page.waitForEvent('download',{timeout:90000});
  await page.click('#v2-batch-pdf');
  const zipDownload=await pdfEvent;
  const zip=await JSZip.loadAsync(await fs.readFile(await zipDownload.path()));
  const pdfFiles=Object.values(zip.files).filter(x=>!x.dir&&x.name.endsWith('.pdf'));
  assert.equal(pdfFiles.length,1);
  const pdf=await pdfFiles[0].async('uint8array');
  assert.equal(new TextDecoder().decode(pdf.subarray(0,8)),'%PDF-1.4');
  await fs.writeFile(output+'/sample-part.pdf',pdf);
  await page.screenshot({path:output+'/sample-workspace.png',fullPage:true});
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
