import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,mkdir} from 'node:fs/promises';
import {setTimeout as sleep} from 'node:timers/promises';
import {chromium} from 'playwright';
const url='http://127.0.0.1:4173/';
const server=spawn('node',['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4173','--strictPort'],{stdio:'inherit'});
let browser;
try{
  let ready=false;
  for(let i=0;i<80;i++){try{if((await fetch(url)).ok){ready=true;break;}}catch{}await sleep(250);}
  assert.ok(ready,'Vite preview must be available');
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
  await page.goto(url);
  await page.locator('#v4-new-measures').selectOption('4');
  await page.click('#v4-new');
  await page.locator('#score-container svg').first().waitFor();
  await page.locator('[data-studio-menu="layout"]').click();
  assert.equal(await page.locator('.studio-navigator').isVisible(),true);
  const geometry=await page.evaluate(()=>{const r=s=>document.querySelector(s).getBoundingClientRect();return {workspaceLeft:r('.workspace').left,workspaceWidth:r('.workspace').width,viewport:innerWidth,navRight:r('.studio-navigator').right,scoreLeft:r('.preview-column').left,scoreRight:r('.preview-column').right,inspectorLeft:r('.controls').left,toolbar:getComputedStyle(document.querySelector('.studio-tool-rail')).backgroundColor};});
  assert.equal(geometry.workspaceLeft,0);assert.equal(geometry.workspaceWidth,geometry.viewport);assert.ok(geometry.navRight<=geometry.scoreLeft+1);assert.ok(geometry.scoreRight<=geometry.inspectorLeft+1);assert.equal(geometry.toolbar,'rgb(246, 246, 235)');
  assert.ok(await page.locator('.studio-page').count()>0);
  const headerGeometry=()=>page.locator('.v4-editor > .control-heading').evaluate(h=>{
    const title=h.querySelector('span:first-child'),toggle=h.querySelector('.jwoo-fold-toggle');
    const range=document.createRange();range.selectNodeContents(title);
    const textRects=[...range.getClientRects()].filter(r=>r.width>0);
    const tr=title.getBoundingClientRect(),br=toggle.getBoundingClientRect();
    return {lines:textRects.length,titleRight:tr.right,toggleLeft:br.left,buttonWidth:br.width,headerWidth:h.clientWidth};
  });
  for(const width of [1440,1000]){
    await page.setViewportSize({width,height:900});
    const header=await headerGeometry();
    assert.equal(header.lines,1,JSON.stringify(header));
    assert.ok(header.titleRight<=header.toggleLeft+1&&header.buttonWidth<header.headerWidth/2,JSON.stringify(header));
  }
  await page.setViewportSize({width:1440,height:1000});
  console.log('INSPECTOR_TITLE_PASS: horizontal heading and compact toggle');
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
  await mkdir('artifacts/browser-smoke',{recursive:true});
  await page.screenshot({path:'artifacts/browser-smoke/editorial-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  const mobile=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,nav:getComputedStyle(document.querySelector('.studio-navigator')).display}));
  assert.equal(mobile.nav,'none');assert.ok(mobile.scroll<=mobile.width+1,JSON.stringify(mobile));
  await page.screenshot({path:'artifacts/browser-smoke/editorial-mobile.png',fullPage:true});
  console.log('EDITORIAL_LAYOUT_PASS: full-width, docked panels, ivory toolbar, mobile');
  console.log('REHEARSAL_BROWSER_PASS: insert, render, replace, MusicXML export, remove');
}finally{await browser?.close();server.kill('SIGTERM');}
