// Run explicitly with `node tests/symbol-position-browser.mjs`.
// Verifies standard MusicXML persistence and the independent SVG print path.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
import {chromium} from 'playwright';
import JSZip from 'jszip';

const url='http://127.0.0.1:4187/';
const server=spawn('node',['node_modules/vite/bin/vite.js','--host','127.0.0.1',
  '--port','4187','--strictPort'],{stdio:'ignore'});
let browser;
try{
  let ready=false;
  for(let i=0;i<60;i++){
    if(server.exitCode!==null)throw new Error('Test server stopped');
    try{if((await fetch(url)).ok){ready=true;break;}}catch{}
    await sleep(200);
  }
  if(!ready)throw new Error('Test server did not start');
  const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser=await chromium.launch({headless:true,
    ...(existsSync(chrome)?{executablePath:chrome}:{})});
  const page=await browser.newPage({acceptDownloads:true});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);
  await page.click('#v4-new');
  await page.locator('#score-container .jwoo-rest-target').first().waitFor();
  await page.fill('#v4-symbol-x','12');
  await page.fill('#v4-symbol-y','8');
  await page.click('#v4-symbol-apply');
  assert.match(await page.locator('#score-container .jwoo-rest-target').first()
    .getAttribute('transform'),/^translate\(/);
  await page.selectOption('#v4-key','1');
  await page.click('#v4-apply-key');
  await page.selectOption('#v4-symbol-kind','key');
  await page.fill('#v4-symbol-x','6');
  await page.fill('#v4-symbol-y','5');
  await page.click('#v4-symbol-apply');
  assert.match(await page.locator('#score-container .vf-keysignature').first()
    .getAttribute('transform'),/^translate\(/);
  const [xmlDownload]=await Promise.all([page.waitForEvent('download'),
    page.click('#download-xml')]);
  const xml=await readFile(await xmlDownload.path());
  assert.match(xml.toString(),/<key relative-x="6" relative-y="5">/);
  assert.match(xml.toString(),/<note relative-x="12" relative-y="8">/);
  const [svgDownload]=await Promise.all([page.waitForEvent('download'),
    page.click('#v4-part-svg-zip')]);
  const zip=await JSZip.loadAsync(await readFile(await svgDownload.path()));
  const svgEntry=Object.values(zip.files).find(file=>file.name.endsWith('.svg'));
  assert.ok(svgEntry,'Part SVG export missing');
  const svg=await svgEntry.async('string');
  assert.match(svg,/class="vf-keysignature" transform="translate\(/);
  assert.match(svg,/class="vf-notehead"[^>]*transform="translate\(/);
  await page.setInputFiles('#file-input',{name:'reopen.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:xml});
  await page.locator('#score-container .vf-keysignature[transform]').first().waitFor();
  assert.match(await page.locator('#score-container .jwoo-rest-target').first()
    .getAttribute('transform'),/^translate\(/);
  assert.equal(await page.locator('#v4-symbol-kind').inputValue(),'key');
  await page.locator('[data-tool="move"]').click();
  assert.equal(await page.locator('#v4-symbol-drag').isChecked(),true);
  assert.equal(await page.locator('#v4-symbol-kind').isDisabled(),true);
  const rest=page.locator('#score-container .jwoo-rest-target').first();
  const beforeDrag=await rest.getAttribute('transform');
  const box=await rest.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.down();
  await page.mouse.move(box.x+box.width/2+30,box.y+box.height/2+12,{steps:4});
  assert.notEqual(await rest.evaluate(element=>element.style.translate),'');
  await page.mouse.up();
  await page.waitForFunction(previous=>document.querySelector('#score-container .jwoo-rest-target')
    ?.getAttribute('transform')!==previous,beforeDrag);
  assert.match(await page.locator('#v4-symbol-status').textContent(),/드롭다운 선택 없이/);
  await page.locator('[data-tool="move"]').click();
  assert.equal(await page.locator('#v4-symbol-drag').isChecked(),false);
  assert.equal(await page.locator('#v4-symbol-kind').isEnabled(),true);
  for(const [kind,x,y,selector] of [
    ['time','10','5','.vf-timesignature'],['clef','8','-3','.vf-clef']]){
    await page.selectOption('#v4-symbol-kind',kind);
    await page.fill('#v4-symbol-x',x);
    await page.fill('#v4-symbol-y',y);
    await page.click('#v4-symbol-apply');
    await page.locator('#score-container '+selector+'[transform]').first().waitFor();
  }
  const [extendedDownload]=await Promise.all([page.waitForEvent('download'),
    page.click('#download-xml')]);
  const extendedXml=await readFile(await extendedDownload.path());
  assert.match(extendedXml.toString(),/<time relative-x="10" relative-y="5">/);
  assert.match(extendedXml.toString(),/<clef relative-x="8" relative-y="-3">/);
  const [extendedSvgDownload]=await Promise.all([page.waitForEvent('download'),
    page.click('#v4-part-svg-zip')]);
  const extendedZip=await JSZip.loadAsync(await readFile(await extendedSvgDownload.path()));
  const extendedSvgEntry=Object.values(extendedZip.files)
    .find(file=>file.name.endsWith('.svg'));
  const extendedSvg=await extendedSvgEntry.async('string');
  assert.match(extendedSvg,/class="vf-timesignature" transform="translate\(/);
  assert.match(extendedSvg,/class="vf-clef" transform="translate\(/);
  await page.setInputFiles('#file-input',{name:'reopen-extended.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:extendedXml});
  await page.locator('#drop-zone strong').getByText('reopen-extended.musicxml').waitFor();
  await page.locator('#score-container .vf-timesignature[transform]').first().waitFor();
  await page.locator('#score-container .vf-clef[transform]').first().waitFor();
  await page.locator('[data-tool="move"]').click();
  assert.equal(await page.locator('#v4-symbol-drag').isChecked(),true);
  const meter=page.locator('#score-container .vf-timesignature').first();
  const meterBefore=await meter.getAttribute('transform');
  const meterBox=await meter.boundingBox();
  await page.mouse.move(meterBox.x+meterBox.width/2,meterBox.y+meterBox.height/2);
  await page.mouse.down();
  await page.mouse.move(meterBox.x+meterBox.width/2+25,meterBox.y+meterBox.height/2+10,{steps:4});
  await page.mouse.up();
  await page.waitForFunction(previous=>document.querySelector('#score-container .vf-timesignature')
    ?.getAttribute('transform')!==previous,meterBefore);
  const clef=page.locator('#score-container .vf-clef').first();
  const clefBefore=await clef.getAttribute('transform');
  const clefBox=await clef.boundingBox();
  await page.mouse.move(clefBox.x+clefBox.width/2,clefBox.y+clefBox.height/2);
  await page.mouse.down();
  await page.mouse.move(clefBox.x+clefBox.width/2+20,clefBox.y+clefBox.height/2+8,{steps:4});
  await page.mouse.up();
  await page.waitForFunction(previous=>document.querySelector('#score-container .vf-clef')
    ?.getAttribute('transform')!==previous,clefBefore);
  assert.deepEqual(errors,[]);
  const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await mobile.goto(url);
  await mobile.click('#v4-new');
  await mobile.locator('[data-tool="move"]').tap();
  assert.equal(await mobile.locator('#v4-symbol-drag').isChecked(),true);
  const touch=await mobile.context().newCDPSession(mobile);
  for(const selector of ['.vf-timesignature','.vf-clef']){
    const symbol=mobile.locator('#score-container '+selector).first();
    await symbol.scrollIntoViewIfNeeded();
    const before=await symbol.getAttribute('transform'),bounds=await symbol.boundingBox();
    const x=bounds.x+bounds.width/2,y=bounds.y+bounds.height/2;
    await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
    await touch.send('Input.dispatchTouchEvent',{type:'touchMove',
      touchPoints:[{x:x+14,y:y+5,id:1}]});
    await touch.send('Input.dispatchTouchEvent',{type:'touchMove',
      touchPoints:[{x:x+24,y:y+10,id:1}]});
    await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await mobile.waitForFunction(({selector,before})=>document.querySelector('#score-container '+selector)
      ?.getAttribute('transform')!==before,{selector,before});
  }
  await mobile.close();
  console.log('Symbol placement: rest, key, time, clef persistence and drag passed');
}finally{
  await browser?.close();
  server.kill('SIGTERM');
}
