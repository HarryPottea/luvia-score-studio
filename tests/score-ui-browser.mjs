// Run explicitly with `node tests/score-ui-browser.mjs`.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
import {chromium} from 'playwright';
import JSZip from 'jszip';

const url='http://127.0.0.1:4188/';
const server=spawn('node',['node_modules/vite/bin/vite.js','--host','127.0.0.1',
  '--port','4188','--strictPort'],{stdio:'ignore'});
let browser;
try{
  let ready=false;
  for(let i=0;i<60;i++){
    try{if((await fetch(url)).ok){ready=true;break;}}catch{}
    await sleep(200);
  }
  if(!ready)throw new Error('Test server did not start');
  const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser=await chromium.launch({headless:true,
    ...(existsSync(chrome)?{executablePath:chrome}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:900},acceptDownloads:true});
  page.setDefaultTimeout(9000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);
  await page.click('#v4-new');
  await page.locator('#score-container .jwoo-rest-target').first().waitFor();
  assert.ok(await page.evaluate(()=>
    !!(document.querySelector('#editor-controls')?.compareDocumentPosition(
      document.querySelector('.v4-create'))&Node.DOCUMENT_POSITION_FOLLOWING)));
  assert.equal(await page.locator('.editor-controls>.control-group .jwoo-panel-body').first()
    .evaluate(element=>element.hidden),true);
  await page.locator('[data-tool="erase"]').click();
  assert.equal(await page.locator('[data-tool="erase"]').getAttribute('aria-pressed'),'true');
  await page.locator('#score-container .jwoo-rest-target').first().click();
  await page.waitForFunction(()=>/표시 숨김 완료/.test(document.querySelector('#message')?.textContent||''));
  assert.equal(await page.locator('#score-container .jwoo-rest-target').first()
    .getAttribute('display'),'none');
  await page.locator('[data-tool="erase"]').click();
  await page.locator('.jwoo-quick-link[aria-label="마디 설정으로 이동"]').click();
  assert.equal(await page.locator('#v4-symbol-show').isEnabled(),true);
  await page.click('#v4-symbol-show');
  await page.waitForFunction(()=>/표시 복원 완료/.test(document.querySelector('#message')?.textContent||''));
  assert.notEqual(await page.locator('#score-container .jwoo-rest-target').first()
    .getAttribute('display'),'none');
  await page.locator('[data-tool="erase"]').click();
  await page.locator('#score-container .jwoo-rest-target').first().click();
  await page.waitForFunction(()=>/표시 숨김 완료/.test(document.querySelector('#message')?.textContent||''));
  for(const selector of ['.vf-timesignature','.vf-clef']){
    await page.locator('#score-container '+selector).first().click();
    await page.waitForFunction(()=>/표시 숨김 완료/.test(document.querySelector('#message')?.textContent||''));
    const glyph=page.locator('#score-container '+selector).first();
    assert.ok(await glyph.count()===0||await glyph.getAttribute('display')==='none');
  }
  await page.locator('[data-tool="erase"]').click();
  await page.selectOption('#v4-key','1');
  await page.click('#v4-apply-key');
  await page.locator('#score-container .vf-keysignature').first().waitFor();
  await page.locator('[data-tool="erase"]').click();
  await page.locator('#score-container .vf-keysignature').first().click();
  await page.waitForFunction(()=>/표시 숨김 완료/.test(document.querySelector('#message')?.textContent||''));
  const [download]=await Promise.all([page.waitForEvent('download'),page.click('#download-xml')]);
  const xml=(await readFile(await download.path())).toString();
  for(const tag of ['note','key','time','clef'])
    assert.match(xml,new RegExp('<'+tag+' print-object="no"'));
  assert.match(xml,/<note print-object="no">[\s\S]*?<rest\/>[\s\S]*?<duration>/);
  const [svgDownload]=await Promise.all([page.waitForEvent('download'),
    page.click('#v4-part-svg-zip')]);
  const zip=await JSZip.loadAsync(await readFile(await svgDownload.path()));
  const svgEntry=Object.values(zip.files).find(file=>file.name.endsWith('.svg'));
  assert.ok(svgEntry);
  const svg=await svgEntry.async('string');
  assert.match(svg,/class="vf-notehead[^\"]*"[^>]*display="none"/);
  assert.deepEqual(errors,[]);
  await page.close();

  for(const width of [320,390]){
    const mobile=await browser.newPage({viewport:{width,height:844},isMobile:true,hasTouch:true});
    await mobile.goto(url);
    assert.equal(await mobile.locator('.preview-column').isVisible(),false);
    await mobile.click('#v4-new');
    await mobile.locator('#score-container svg').first().waitFor();
    const geometry=await mobile.evaluate(()=>{
      const rect=selector=>document.querySelector(selector).getBoundingClientRect();
      const actions=rect('#output-actions'),tools=rect('#jwoo-score-tools'),score=rect('.preview-shell');
      const links=document.querySelector('.jwoo-quick-links');
      return {actionsBottom:actions.bottom,toolsTop:tools.top,toolsBottom:tools.bottom,
        scoreTop:score.top,linksWidth:links.scrollWidth,linksClient:links.clientWidth};
    });
    assert.ok(geometry.actionsBottom<=geometry.toolsTop+1);
    assert.ok(geometry.toolsBottom<=geometry.scoreTop+1);
    assert.ok(geometry.linksWidth<=geometry.linksClient+1);
    await mobile.locator('[data-tool="erase"]').tap();
    assert.equal(await mobile.locator('[data-tool="erase"]').getAttribute('aria-pressed'),'true');
    assert.equal(await mobile.locator('.jwoo-score-tools-help').isVisible(),true);
    const visible=await mobile.evaluate(()=>{
      const panel=document.querySelector('.preview-column').getBoundingClientRect();
      const message=document.querySelector('.preview-column .message').getBoundingClientRect();
      return {panelBottom:panel.bottom,messageBottom:message.bottom};
    });
    assert.ok(visible.messageBottom<=visible.panelBottom+1,JSON.stringify(visible));
    await mobile.locator('#score-container .jwoo-rest-target').first().tap();
    await mobile.waitForFunction(()=>/표시 숨김 완료/.test(document.querySelector('#message')?.textContent||''));
    assert.equal(await mobile.locator('#score-container .jwoo-rest-target').first()
      .getAttribute('display'),'none');
    await mobile.close();
  }
  console.log('Score UI: symbol visibility, XML/SVG, desktop and mobile layout passed');
}finally{
  await browser?.close();
  server.kill('SIGTERM');
}
