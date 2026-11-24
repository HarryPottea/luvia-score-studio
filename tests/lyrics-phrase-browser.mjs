import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';

const server=spawn('node',['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4175','--strictPort'],{stdio:'ignore'});
let browser;
const xml='<?xml version="1.0" encoding="utf-8"?><score-partwise version="4.0">'+
  '<work><work-title>연속 가사</work-title></work><movement-title>연속 가사</movement-title>'+
  '<part-list><score-part id="P1"><part-name>Vocal</part-name></score-part></part-list><part id="P1">'+
  [1,2].map(number=>'<measure number="'+number+'">'+(number===1?
    '<attributes><divisions>16</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>':'')+
    ['C','D','E','F'].map(step=>'<note><pitch><step>'+step+'</step><octave>4</octave></pitch><duration>16</duration><type>quarter</type></note>').join('')+'</measure>').join('')+
  '</part></score-partwise>';
try{
  let ready=false;
  for(let i=0;i<60;i++){
    try{const response=await fetch('http://127.0.0.1:4175/');if(response.ok){ready=true;break;}}catch{}
    await sleep(250);
  }
  assert.ok(ready,'Preview server must start');
  const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser=await chromium.launch({headless:true,args:['--no-sandbox'],
    ...(existsSync(chrome)?{executablePath:chrome}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:950},acceptDownloads:true});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4175/');
  await page.locator('#file-input').setInputFiles({name:'lyric-phrase.musicxml',mimeType:'application/xml',buffer:Buffer.from(xml)});
  await page.locator('#score-container .jwoo-note-target').first().waitFor();
  await page.locator('[data-tool="lyric"]').click();
  await page.locator('#score-container .jwoo-note-target').first().click();
  await page.locator('#v4-inline-lyric-editor:visible').waitFor();
  assert.equal(await page.locator('#v4-inline-phrase').evaluate(el=>document.activeElement===el),true);
  await page.screenshot({path:'/tmp/jwoo-lyric-phrase-desktop.png'});
  await page.fill('#v4-inline-phrase','우리 함께');
  assert.match(await page.locator('#v4-inline-phrase-preview').textContent(),/4개 음표/);
  await page.locator('#v4-inline-phrase').press('Control+Enter');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('연속 가사 편집 완료'),null,{timeout:30000});
  let download=page.waitForEvent('download');await page.click('#download-xml');
  let output=await fs.readFile(await (await download).path(),'utf8');
  assert.equal((output.match(/<lyric number="1">/g)||[]).length,4);
  await page.locator('#score-container .jwoo-note-target').first().click();
  await page.locator('#v4-inline-lyric-editor:visible').waitFor();
  assert.equal(await page.locator('#v4-inline-phrase').inputValue(),'우-리 함-께');
  await page.fill('#v4-inline-phrase','우리');
  await page.click('#v4-inline-phrase-apply');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('연속 가사 편집 완료'),null,{timeout:30000});
  download=page.waitForEvent('download');await page.click('#download-xml');
  output=await fs.readFile(await (await download).path(),'utf8');
  assert.equal((output.match(/<lyric number="1">/g)||[]).length,2);
  // The menu-based inspector may be closed; the document-wide shortcut remains
  // available without reopening settings during lyric editing.
  await page.evaluate(()=>document.activeElement?.blur());
  await page.keyboard.press('Meta+z');
  download=page.waitForEvent('download');await page.click('#download-xml');
  output=await fs.readFile(await (await download).path(),'utf8');
  assert.equal((output.match(/<lyric number="1">/g)||[]).length,4);
  await page.locator('#score-container .jwoo-note-target').first().click();
  await page.locator('#v4-inline-lyric-editor:visible').waitFor();
  await page.click('#v4-inline-shift-right');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('가사 한 음표 밀기 완료'),null,{timeout:30000});
  await page.click('#v4-inline-close');
  download=page.waitForEvent('download');await page.click('#download-xml');
  output=await fs.readFile(await (await download).path(),'utf8');
  assert.equal((output.match(/<lyric number="1">/g)||[]).length,4);
  assert.match(output,/<text>우<\/text>/);
  assert.deepEqual(errors,[]);
  console.log('Lyric phrase desktop browser flow passed: apply, reload, shorten, undo, shift.');
}finally{await browser?.close();server.kill('SIGTERM');}
