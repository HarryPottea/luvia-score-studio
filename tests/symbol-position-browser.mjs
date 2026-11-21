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
  assert.deepEqual(errors,[]);
  console.log('Symbol placement: MusicXML, preview, SVG export, reload passed');
}finally{
  await browser?.close();
  server.kill('SIGTERM');
}
