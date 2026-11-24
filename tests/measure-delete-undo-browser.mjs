// Run explicitly with `node tests/measure-delete-undo-browser.mjs`.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const url='http://127.0.0.1:4189/';
const server=spawn('node',['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1',
  '--port','4189','--strictPort'],{stdio:'ignore'});
let browser;
try{
  let ready=false;
  for(let i=0;i<60;i++){
    try{if((await fetch(url)).ok){ready=true;break;}}catch{}
    await sleep(200);
  }
  assert.ok(ready,'Preview server must start');
  const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser=await chromium.launch({headless:true,
    ...(existsSync(chrome)?{executablePath:chrome}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:900},acceptDownloads:true});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>void dialog.accept());
  await page.goto(url);
  await page.selectOption('#v4-new-measures','8');
  await page.click('#v4-new');
  await page.locator('#score-container .jwoo-rest-target').first().waitFor();
  await page.locator('button[data-studio-menu="layout"]').click();
  await page.locator('.jwoo-bar-chip[data-measure-index="1"]').click();
  await page.locator('.jwoo-bar-chip[data-measure-index="3"]').click({modifiers:['Shift']});
  assert.match(await page.locator('#v4-delete-measure-status').textContent(),/2–4마디/);
  await page.click('#v4-delete-measure');
  await page.waitForFunction(()=>document.querySelectorAll('.jwoo-bar-chip').length===5);
  assert.equal(await page.locator('#v4-current-total').inputValue(),'5');
  // A render may leave focus on body; the score's history shortcut still applies.
  await page.evaluate(()=>document.activeElement?.blur());
  await page.keyboard.press('Meta+z');
  await page.waitForFunction(()=>document.querySelectorAll('.jwoo-bar-chip').length===8);
  assert.equal(await page.locator('#v4-current-total').inputValue(),'8');
  await page.fill('#jwoo-range-from','1');
  await page.fill('#jwoo-range-to','7');
  await page.click('#jwoo-range-apply');
  await page.click('#v4-delete-measure');
  await page.waitForFunction(()=>document.querySelectorAll('.jwoo-bar-chip').length===1);
  assert.equal(await page.locator('#v4-delete-measure').isDisabled(),true);
  assert.match(await page.locator('#v4-delete-measure-status').textContent(),/최소 한 마디/);
  const openingRest='<?xml version="1.0" encoding="utf-8"?><score-partwise version="4.0">'+
    '<work><work-title>첫 쉼표 삭제</work-title></work><movement-title>첫 쉼표 삭제</movement-title>'+
    '<part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list><part id="P1">'+
    '<measure number="1"><attributes><divisions>48</divisions><key><fifths>0</fifths></key>'+
    '<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>'+
    '<note><rest/><duration>192</duration><type>whole</type></note></measure>'+
    '<measure number="2"><note><rest/><duration>192</duration><type>whole</type></note></measure>'+
    '<measure number="3"><note><rest/><duration>192</duration><type>whole</type></note></measure>'+
    '<measure number="4"><attributes><key><fifths>2</fifths></key></attributes>'+
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>192</duration><type>whole</type></note>'+
    '</measure></part></score-partwise>';
  await page.locator('#file-input').setInputFiles({name:'opening-rest.musicxml',
    mimeType:'application/xml',buffer:Buffer.from(openingRest)});
  await page.waitForFunction(()=>document.querySelectorAll('.jwoo-bar-chip').length===4);
  if(!await page.locator('.jwoo-bar-chip[data-measure-index="0"]').isVisible())
    await page.locator('button[data-studio-menu="layout"]').click();
  for(const remaining of [3,2,1]){
    await page.locator('.jwoo-bar-chip[data-measure-index="0"]').click();
    await page.click('#v4-delete-measure');
    await page.waitForFunction(count=>document.querySelectorAll('.jwoo-bar-chip').length===count,
      remaining);
  }
  const download=page.waitForEvent('download');
  await page.click('#download-xml');
  const output=await readFile(await (await download).path(),'utf8');
  assert.equal((output.match(/<measure number=/g)||[]).length,1);
  assert.match(output,/<fifths>2<\/fifths>/);
  assert.match(output,/<step>C<\/step>/);
  assert.equal(await page.locator('#score-container .jwoo-note-target').count(),1,
    'the first sounding note must remain directly editable');
  assert.deepEqual(errors,[]);
  console.log('Measure range delete, Cmd+Z, minimum bar and opening rest removal passed.');
}finally{await browser?.close();server.kill('SIGTERM');}
