// Browser regression for first-import part selection and the ensuing edit session.
// Optionally set JWOO_IMPORT_FIXTURE to exercise a real multi-part Logic export.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {chromium} from 'playwright';
import JSZip from 'jszip';

const synthetic=`<?xml version="1.0" encoding="utf-8"?>
<score-partwise version="4.0"><work><work-title>파트 선택 회귀</work-title></work>
<movement-title>파트 선택 회귀</movement-title><part-list>
<score-part id="P1"><part-name>piano</part-name></score-part>
<score-part id="P7"><part-name>Melody</part-name></score-part></part-list>
${['P1','P7'].map(id=>`<part id="${id}">${Array.from({length:6},(_,i)=>
  `<measure number="${i+1}">${i===0?'<attributes><divisions>1</divisions><key><fifths>2</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>':''}
  ${id==='P7'&&i<4?'<note><rest/><duration>4</duration><type>whole</type></note>':
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>'}</measure>`).join('')}</part>`).join('')}</score-partwise>`;
const fixture=process.env.JWOO_IMPORT_FIXTURE?await fs.readFile(process.env.JWOO_IMPORT_FIXTURE):Buffer.from(synthetic);
const total=(fixture.toString().match(/<part id=/g)||[]).length;
const base='http://127.0.0.1:4187/';
const server=spawn('node',['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4187','--strictPort'],{stdio:'ignore'});
let browser;
try{
  let ready=false;
  for(let i=0;i<100;i++){
    try{if((await fetch(base)).ok){ready=true;break;}}catch{}
    await sleep(200);
  }
  assert.ok(ready,'preview server must start');
  browser=await chromium.launch({headless:true,
    executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const page=await browser.newPage({viewport:{width:1280,height:900},acceptDownloads:true});
  const errors=[];page.on('pageerror',error=>errors.push(String(error)));
  page.on('dialog',dialog=>dialog.accept());
  await page.goto(base);
  const input=page.locator('#file-input');
  const upload=async(name='multi.musicxml',buffer=fixture)=>input.setInputFiles({name,
    mimeType:name.endsWith('.mxl')?'application/vnd.recordare.musicxml':'application/xml',buffer});
  await upload();
  await page.locator('#part-import-dialog[open]').waitFor();
  assert.equal(await page.locator('#part-import-list input:checked').count(),total);
  assert.equal(await page.locator('#score-info').textContent(),'파일을 열면 악보가 표시됩니다');
  await page.screenshot({path:'/tmp/jwoo-part-import-modal.png'});
  await page.locator('#part-import-none').click();
  assert.equal(await page.locator('#part-import-confirm').isDisabled(),true);
  await page.locator('#part-import-all').click();
  assert.equal(await page.locator('#part-import-list input:checked').count(),total);
  await page.locator('#part-import-none').click();
  await page.locator('#part-import-list input[value="P7"]').check();
  await page.locator('#part-import-confirm').click();
  const initial=total===7?66:6,remaining=initial-4;
  await page.waitForFunction(n=>document.querySelector('#score-info')?.textContent===`1개 파트 · ${n}개 마디`,initial);
  assert.deepEqual(await page.locator('#export-part option').allTextContents(),['Melody']);
  assert.equal(await page.locator('#edit-part').count(),0);
  assert.equal(await page.locator('#return-full-score').count(),0);
  await page.evaluate(()=>{
    document.querySelector('#jwoo-range-from').value='1';
    document.querySelector('#jwoo-range-to').value='4';
    document.querySelector('#jwoo-range-apply').click();
    document.querySelector('#jwoo-measure-toolbar [data-act="delete"]').click();
  });
  await page.waitForFunction(n=>document.querySelector('#score-info')?.textContent===`1개 파트 · ${n}개 마디`,remaining);
  await page.locator('#v3-undo').evaluate(button=>button.click());
  await page.waitForFunction(n=>document.querySelector('#score-info')?.textContent===`1개 파트 · ${n}개 마디`,initial);
  await page.locator('#v3-redo').evaluate(button=>button.click());
  await page.waitForFunction(n=>document.querySelector('#score-info')?.textContent===`1개 파트 · ${n}개 마디`,remaining);
  const downloading=page.waitForEvent('download');
  await page.locator('#download-xml').evaluate(button=>button.click());
  const download=await downloading;
  const saved=await fs.readFile(await download.path());
  const xml=saved.toString();
  assert.match(xml,/<part id="P7">/);
  assert.doesNotMatch(xml,/<part id="P1">/);
  assert.equal((xml.match(/<measure\b/g)||[]).length,remaining);
  const first=xml.match(/<measure[^>]*>[\s\S]*?<\/measure>/)?.[0]||'';
  for(const tag of ['divisions','key','time','clef'])assert.match(first,new RegExp('<'+tag+'[ >]'));
  assert.equal((first.match(/<attributes>/g)||[]).length,1);
  assert.match(first,/<pitch>/,'first sounding bar survives');
  const pdf=await page.pdf({format:'A4',printBackground:true});
  assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
  assert.ok(pdf.length>1000);
  // The downloaded single-part MusicXML must reopen without a selection modal.
  await upload('melody.musicxml',saved);
  await page.waitForFunction(n=>document.querySelector('#score-info')?.textContent===`1개 파트 · ${n}개 마디`,remaining);
  assert.equal(await page.locator('#part-import-dialog[open]').count(),0);
  // Canceling a later import leaves the edited document intact.
  await upload();await page.locator('#part-import-dialog[open]').waitFor();
  await page.locator('#part-import-cancel').click();
  assert.equal(await page.locator('#score-info').textContent(),`1개 파트 · ${remaining}개 마디`);
  // Compressed MXL traverses the same pre-render choice gate.
  const zip=new JSZip();zip.file('META-INF/container.xml',
    '<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>');
  zip.file('score.musicxml',fixture);
  await upload('multi.mxl',await zip.generateAsync({type:'nodebuffer'}));
  await page.locator('#part-import-dialog[open]').waitFor();
  assert.equal(await page.locator('#part-import-list input:checked').count(),total);
  await page.locator('#part-import-cancel').click();
  assert.deepEqual(errors,[]);
  console.log(`PART_IMPORT_PASS parts=${total} edited_bars=${remaining} pdf_bytes=${pdf.length}`);
}finally{await browser?.close();server.kill('SIGTERM');}
