import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {setTimeout as sleep} from 'node:timers/promises';
import {chromium} from 'playwright';
const url='http://127.0.0.1:4190/';
const server=spawn('node',['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4190','--strictPort'],{stdio:'ignore'});
let browser;
try{
  let ready=false;
  for(let i=0;i<80;i++){try{if((await fetch(url)).ok){ready=true;break;}}catch{}await sleep(250);}
  assert.ok(ready);
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
  await page.goto(url);
  await page.locator('#v4-new-measures').selectOption('4');
  await page.click('#v4-new');
  await page.locator('#score-container svg').first().waitFor();
  await page.locator('[data-studio-menu="layout"]').click();
  await page.locator('#jwoo-bar-strip .jwoo-bar-chip').nth(1).click();
  const input=page.locator('#jwoo-rehearsal-label');
  const mark=text=>page.locator('#score-container svg text').filter({hasText:new RegExp('^'+text+'$')});
  await input.fill('VERSE 1');
  await page.click('#jwoo-rehearsal-set');
  await mark('VERSE 1').first().waitFor();
  assert.equal(await mark('VERSE 1').count(),1);
  await input.fill('CHORUS');
  await page.click('#jwoo-rehearsal-set');
  await mark('CHORUS').first().waitFor();
  assert.equal(await mark('VERSE 1').count(),0);
  const [download]=await Promise.all([page.waitForEvent('download'),page.click('#download-xml')]);
  const xml=await readFile(await download.path(),'utf8');
  assert.match(xml,/<rehearsal[^>]*>CHORUS<\/rehearsal>/);
  await page.click('#jwoo-rehearsal-remove');
  await page.waitForFunction(()=>!Array.from(document.querySelectorAll('#score-container svg text')).some(n=>n.textContent==='CHORUS'));
  console.log('REHEARSAL_BROWSER_PASS: insert, render, replace, MusicXML export, remove');
}finally{await browser?.close();server.kill('SIGTERM');}
