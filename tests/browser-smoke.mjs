// Browser-only integration smoke for the built candidate.
// Validates a synthetic MusicXML score end to end; it does NOT certify real Logic exports.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import { chromium } from 'playwright';
import JSZip from 'jszip';
import {validateMusicXml4Files} from './musicxml4-validator.mjs';

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
  const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser=await chromium.launch({headless:true,args:['--no-sandbox'],
    ...(existsSync(chrome)?{executablePath:chrome}:{})});
  page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
  const errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.goto(url,{waitUntil:'domcontentloaded'});
  console.log('BROWSER_STAGE=PAGE_OPEN');
  assert.equal(await page.locator('#try-sample').count(),0,'No sample-score action is exposed');
  assert.equal(await page.locator('#empty-preview svg').count(),0,'No decorative sample score is shown');
  assert.match(await page.locator('#empty-preview').textContent(),/아직 열린 악보가 없습니다/);
  assert.equal(await page.locator('#toggle-settings').isDisabled(),true);
  assert.equal(await page.locator('#editor-controls').isVisible(),false);
  console.log('BROWSER_STAGE=BLANK_START_NO_SAMPLE');
  assert.ok((await page.title()).includes('JaeWoo'));

  // Brand assets must be served as real resources, not SPA fallback HTML.
  const svgIcon=page.locator('link[rel="icon"][type="image/svg+xml"]');
  assert.equal(await svgIcon.getAttribute('href'),'./jwoo-favicon-20261119.svg');
  assert.equal(await page.locator('link[rel="apple-touch-icon"]').getAttribute('sizes'),'180x180');
  assert.equal(await page.locator('link[rel="apple-touch-icon"]').getAttribute('href'),'./jwoo-touch-v3-180.png');
  assert.equal(await page.locator('meta[name="apple-mobile-web-app-capable"]').getAttribute('content'),'yes');
  // A Web Manifest was introduced alongside the icon and is being removed
  // experimentally to restore the iOS 26 pre-icon independent launch behavior.
  // Keep the older manifest URL available for previously installed users.
  assert.equal(await page.locator('link[rel="manifest"]').count(),0,'Pre-icon iOS install did not require a web manifest');
  for(const [file,size] of [['jwoo-favicon-20261119.png',32],['jwoo-touch-v3-180.png',180],['jwoo-app-v3-192.png',192]]) {
    const response=await page.request.get(new URL(file,url).href);
    assert.equal(response.status(),200,file+' must be served');
    const bytes=await response.body();
    assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a',file+' must be a PNG');
    assert.equal(bytes.readUInt32BE(16),size,file+' width');
    assert.equal(bytes.readUInt32BE(20),size,file+' height');
  }
  const svgResponse=await page.request.get(new URL('jwoo-favicon-20261119.svg',url).href);
  assert.equal(svgResponse.status(),200);
  assert.match(await svgResponse.text(),/fill="#D9FF7A"/);
  const manifestResponse=await page.request.get(new URL('jwoo-app-v3.webmanifest',url).href);
  assert.equal(manifestResponse.status(),200);
  const manifest=await manifestResponse.json();
  assert.equal(manifest.short_name,'J-WOO');
  assert.ok(manifest.icons.some(item=>item.sizes==='192x192'));
  // Safari's two icon consumers must receive the same *actual pixels*.
  // A PNG header alone cannot detect an accidentally wrong or corrupt icon.
  const painted=await page.evaluate(async()=>{
    const check=async(url)=>{
      const img=new Image(); img.src=url; await img.decode();
      const can=document.createElement('canvas');can.width=img.naturalWidth;can.height=img.naturalHeight;
      const c=can.getContext('2d',{willReadFrequently:true});c.drawImage(img,0,0);
      const at=(x,y)=>[...c.getImageData(Math.round(x*can.width),Math.round(y*can.height),1,1).data];
      return {size:can.width,dot:at(.8,.73),background:at(.04,.04),glyph:at(.7,.3)};
    };
    return {apple:await check('./jwoo-touch-v3-180.png'),manifest:await check('./jwoo-app-v3-192.png')};
  });
  for(const item of Object.values(painted)){
    assert.deepEqual(item.dot.slice(0,3),[216,254,121],'Icon must contain lime J. dot');
    assert.deepEqual(item.background.slice(0,3),[23,24,21],'Icon must have matching dark background');
    assert.deepEqual(item.glyph.slice(0,3),[245,245,234],'Icon must contain ivory J glyph');
  }
  assert.equal(manifest.icons[0].src,'./jwoo-app-v3-192.png');
  console.log('BROWSER_STAGE=IOS_TOUCH_AND_PWA_ICONS_PIXELS_MATCH',JSON.stringify(painted));
  const baselineResponse=await page.request.get(new URL('ios-preicon-baseline.html',url).href);
  assert.equal(baselineResponse.status(),200,'Pre-icon iOS install diagnostic must be served');
  const baselineHtml=await baselineResponse.text();
  assert.match(baselineHtml,/J-WOO — iPhone 원형 설치 테스트/);
  assert.doesNotMatch(baselineHtml,/<link\\s+rel=["']manifest["']/i,'Baseline must not attach a manifest');
  assert.doesNotMatch(baselineHtml,/<link\\s+rel=["']apple-touch-icon["']/i,'Baseline must not attach apple icon metadata');
  assert.doesNotMatch(baselineHtml,/<meta\\s+name=["']apple-mobile-web-app-capable["']/i,'Baseline must preserve pre-icon setup');
  console.log('BROWSER_STAGE=IOS_PREICON_BASELINE_READY');
  console.log('BROWSER_STAGE=J_WOO_ICONS_LOADED');

  // J-WOO 4.0 integrated composer: new score -> rest entry -> notation ->
  // layout directive -> local draft persistence -> SVG export -> audition.
  assert.equal(await page.locator('#v4-new').count(),1);
  await page.fill('#v4-new-title','통합 검증');
  await page.selectOption('#v4-new-measures','4');
  await page.click('#v4-new');
  // CI exercises every advanced control, while the user-facing inspector now
  // starts compact. Keep this test's editing controls available throughout.
  await page.locator('.jwoo-fold-all button').getByText('모두 펼치기').click();
  await page.locator('#v3-events .v3-event').first().waitFor();
  assert.match(await page.locator('#score-title').inputValue(),/통합 검증/);
  assert.equal(await page.locator('#score-container svg text[data-jwoo-software-copyright]').count()>0,true,'Score page must display software copyright');
  const visibleRights=await page.locator('#score-container svg text[data-jwoo-software-copyright]').first().textContent();
  assert.equal(visibleRights,'© 2026 PARKJAEWOO. All rights reserved.');
  assert.equal(await page.locator('#toggle-settings').isEnabled(),true);
  assert.equal(await page.locator('#toggle-settings').getAttribute('aria-expanded'),'true');
  const originalTitle=await page.locator('#score-title').inputValue();
  await page.click('#toggle-settings');
  assert.equal(await page.locator('#editor-controls').isVisible(),false);
  assert.equal(await page.locator('#toggle-settings').getAttribute('aria-expanded'),'false');
  await page.click('#toggle-settings');
  assert.equal(await page.locator('#editor-controls').isVisible(),true);
  assert.equal(await page.locator('#toggle-settings').getAttribute('aria-expanded'),'true');
  assert.equal(await page.locator('#score-title').inputValue(),originalTitle,
    'Toggling settings must preserve edited score state');
  console.log('BROWSER_STAGE=SETTINGS_TOGGLE_DOES_NOT_REPLACE_SCORE');
  const directRestDiagnostic=await page.evaluate(()=>({
    mappedRests:document.querySelectorAll('#score-container .jwoo-rest-target').length,
    noteheads:document.querySelectorAll('#score-container .vf-notehead').length,
    stavenotes:document.querySelectorAll('#score-container .vf-stavenote').length,
    vfRests:document.querySelectorAll('#score-container .vf-rest').length,
    graphicHint:document.querySelector('#v3-graphic-hint')?.textContent,
    example:[...document.querySelectorAll('#score-container .vf-stavenote')].slice(0,2)
      .map(x=>x.outerHTML.slice(0,650))
  }));
  console.log('BROWSER_STAGE=V4_REST_MAP_DIAGNOSTIC',JSON.stringify(directRestDiagnostic));
  await page.waitForFunction(()=>document.querySelectorAll('#score-container .jwoo-rest-target').length>0,
    null,{timeout:15000});
  const restHead=page.locator('#score-container .jwoo-rest-target').first();
  const restBounds=await restHead.boundingBox();
  assert.ok(restBounds?.width>0&&restBounds?.height>0,'SVG rest lacks clickable bounds');
  await restHead.click();
  console.log('BROWSER_STAGE=V4_CLICK_DIRECTLY_ON_NOTATED_REST');
  await page.selectOption('#v3-length','quarter');
  await page.locator('[data-tool="note"]').click();
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('음표 삽입 완료'));
  assert.match(await page.locator('#v3-events .v3-event').first().textContent(),/C4/);
  assert.ok((await page.locator('#v3-events .v3-event').count())>=2);
  await page.fill('#v4-tempo','108');
  await page.click('#v4-add-tempo');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('템포 기보 완료'));
  await page.click('#v4-add-dynamic');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('셈여림 기보 완료'));
  await page.click('#v4-apply-articulation');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('아티큘레이션 토글 완료'));
  await page.selectOption('#v4-measure-count','1');
  await page.click('#v4-add-measures');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('빈 마디 추가 완료'));
  assert.match(await page.locator('#score-info').textContent(),/5개 마디/);
  await page.selectOption('#v4-key','-1');
  await page.click('#v4-apply-key');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('전체 조표 변경 완료'));
  console.log('BROWSER_STAGE=V4_MEASURE_EXTENSION_AND_KEY_SIGNATURE');
  await page.selectOption('#v3-measure','1');
  await page.click('#v4-apply-layout');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('줄·페이지 나눔 완료'));
  const v4XmlPromise=page.waitForEvent('download');
  await page.click('#download-xml');
  const v4Xml=await v4XmlPromise;
  const v4Text=await fs.readFile(await v4Xml.path(),'utf8');
  assert.match(v4Text,/<direction-type>/);
  assert.match(v4Text,/<metronome>/);
  assert.match(v4Text,/<staccato/);
  assert.match(v4Text,/<fifths>-1<\/fifths>/);
  assert.equal((v4Text.match(/<measure number="/g)||[]).length,5);
  assert.match(v4Text,/new-system="yes"/);
  assert.match(v4Text,/<duration>48<\/duration>/);
  assert.match(v4Text,/<step>C<\/step>/);
  console.log('BROWSER_STAGE=V4_AUTHORING_MUSICXML_ROUNDTRIP');
  await page.waitForFunction(()=>[...document.querySelectorAll('#v4-draft-select option')].some(x=>x.value==='통합 검증.musicxml'),null,{timeout:12000});
  console.log('BROWSER_STAGE=V4_IDB_AUTOSAVE_PERSISTED');
  // Confirm that downloaded vector pages are SVG instead of raster JPEG PDF.
  const v4VectorPromise=page.waitForEvent('download',{timeout:30000});
  await page.click('#v4-vector-zip');
  const v4VectorDownload=await v4VectorPromise;
  const v4VectorBytes=await fs.readFile(await v4VectorDownload.path());
  const v4VectorZip=await JSZip.loadAsync(v4VectorBytes);
  const v4Pages=Object.keys(v4VectorZip.files).filter(x=>x.endsWith('.svg'));
  assert.ok(v4Pages.length>=1);
  assert.match(await v4VectorZip.file(v4Pages[0]).async('string'),/<svg[\s>]/);
  assert.match(await v4VectorZip.file(v4Pages[0]).async('string'),/data-jwoo-software-copyright="true"/, 'Exported SVG must retain the PARKJAEWOO software footer');
  console.log('BROWSER_STAGE=V4_VECTOR_SVG_EXPORTED');
  await page.click('#v4-play');
  await page.waitForFunction(()=>document.querySelector('#v4-play-status')?.textContent.includes('재생 중'),null,{timeout:15000});
  assert.equal(await page.locator('#v4-stop').isEnabled(),true);
  assert.match(await page.locator('#v4-play-status').textContent(),/108 BPM/);
  await page.click('#v4-stop');
  console.log('BROWSER_STAGE=V4_WEB_AUDIO_AUDITION');
  // Explicit restore uses the draft rather than the changed current score.
  // Replace the current score deliberately, then verify draft restore still works.
  // The removed sample-score action must not be part of the app's workflow.
  await page.fill('#v4-new-title','임시 복원 대상');
  page.once('dialog',dialog=>dialog.accept());
  await page.click('#v4-new');
  await page.waitForFunction(()=>document.querySelector('#score-title')?.value==='임시 복원 대상',null,{timeout:15000});
  await page.selectOption('#v4-draft-select','통합 검증.musicxml');
  page.once('dialog',dialog=>dialog.accept());
  await page.click('#v4-restore');
  await page.waitForFunction(()=>document.querySelector('#score-title')?.value==='통합 검증',null,{timeout:15000});
  assert.match(await page.locator('#v3-events .v3-event').first().textContent(),/C4/);
  console.log('BROWSER_STAGE=V4_LOCAL_DRAFT_RESTORED');

  // Use a test-only MusicXML fixture to exercise representative real notation.
  // It is not bundled into the public application and has no sample UI button.
  const notationFixture=await fs.readFile(new URL('./fixtures/browser-smoke-notation.musicxml',import.meta.url));
  await page.setInputFiles('#file-input',{name:'notation-fixture.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:notationFixture});
  await page.waitForFunction(()=>document.querySelector('#score-title')?.value==='새벽의 스케치',null,{timeout:30000});
  await page.waitForFunction(()=>document.querySelector('#preview-shell')?.getAttribute('aria-busy')==='false',null,{timeout:30000});
  await page.locator('#score-container svg').first().waitFor({timeout:30000});
  console.log('BROWSER_STAGE=SCORE_RENDERED');
  assert.equal(await page.locator('#zoom').count(),0,'Legacy zoom slider must not control print size');
  assert.match(await page.locator('#a4-size-info').textContent(),/오선 7mm 고정/);
  const a4Portrait=await page.evaluate(()=>{
    const host=document.querySelector('#score-container');
    const svg=host?.querySelector('svg');
    const group=svg?.querySelector('.staffline');
    return {containerWidth:host?.getBoundingClientRect().width,
      svgWidth:svg?.getBoundingClientRect().width,svgHeight:svg?.getBoundingClientRect().height,
      staffLineBounds:group?.getBoundingClientRect().toJSON()};
  });
  console.log('BROWSER_STAGE=A4_PORTRAIT_GEOMETRY '+JSON.stringify(a4Portrait));
  const staffHeightPx=await page.locator('#score-container .staffline .vf-measure').first().evaluate(group=>{
    const lines=[...group.children].filter(el=>el.localName==='path'&&/^M[-\d.]+ [-\d.]+L[-\d.]+ [-\d.]+$/.test(el.getAttribute('d')||'')).slice(0,5);
    if(lines.length!==5)throw new Error('The five staffline paths could not be identified');
    return lines[4].getBoundingClientRect().top-lines[0].getBoundingClientRect().top;
  });
  assert.ok(Math.abs(staffHeightPx/(96/25.4)-7)<0.4,'Printed single-staff size must be approximately 7mm');
  console.log('BROWSER_STAGE=A4_STAFF_MEASURED '+staffHeightPx.toFixed(3)+'px');

  await page.selectOption('#page-orientation','A4_L');
  await page.waitForFunction(()=>Math.abs(document.querySelector('#score-container svg')?.getBoundingClientRect().width-297*96/25.4)<3);
  const landscape=await page.locator('#score-container svg').first().boundingBox();
  assert.ok(Math.abs(landscape.height-landscape.width*210/297)<3);
  assert.match(await page.locator('#a4-size-info').textContent(),/A4 가로/);
  await page.selectOption('#page-orientation','A4_P');
  await page.waitForFunction(()=>Math.abs(document.querySelector('#score-container svg')?.getBoundingClientRect().width-210*96/25.4)<3);
  console.log('BROWSER_STAGE=A4_LANDSCAPE_AND_PORTRAIT_OK');


  assert.ok(Math.abs(a4Portrait.containerWidth-210*96/25.4)<2,'A4 page should have a fixed physical CSS width');
  assert.ok(Math.abs(a4Portrait.svgWidth-a4Portrait.containerWidth)<2,'Rendered SVG should fill A4 width');
  assert.ok(Math.abs(a4Portrait.svgHeight-a4Portrait.containerWidth*297/210)<3,'Rendered SVG should have A4 aspect ratio');

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
  const diagnostic=await page.evaluate(()=>{
    const targets=[...document.querySelectorAll('#score-container .jwoo-note-target')];
    const first=targets[0],rect=first?.getBoundingClientRect();
    return {count:targets.length,hint:document.querySelector('#v3-graphic-hint')?.textContent,
      first:first?{tag:first.tagName,width:rect?.width,height:rect?.height,display:getComputedStyle(first).display}:null,
      graphics:document.querySelectorAll('#score-container svg').length,
      allJwoo:document.querySelectorAll('.jwoo-note-target').length,
      insideGlyph:document.querySelectorAll('#score-container svg .vf-notehead').length,
      allGlyph:document.querySelectorAll('.vf-notehead').length,
      glyphSamples:[...document.querySelectorAll('#score-container svg [class]')].slice(0,40).map(el=>({tag:el.tagName,cls:el.getAttribute('class'),connected:el.isConnected}))};
  });
  console.log('BROWSER_STAGE=SVG_TARGET_DIAGNOSTIC '+JSON.stringify(diagnostic));
  assert.ok(diagnostic.count>0,'No mapped SVG note targets after redo');
  const notehead=page.locator('#score-container .jwoo-note-target').first();
  await notehead.scrollIntoViewIfNeeded();
  await notehead.hover({timeout:10000});
  const box=await notehead.boundingBox();
  assert.ok(box&&box.width>0&&box.height>0);
  const beforeDrag=await page.locator('#v3-events .v3-event').first().textContent();
  const point={x:box.x+box.width/2,y:box.y+box.height/2};
  await page.mouse.move(point.x,point.y);
  const hit=await page.evaluate(({x,y})=>{
    const el=document.elementFromPoint(x,y);
    return {tag:el?.tagName,cls:el?.getAttribute('class'),parent:el?.parentElement?.getAttribute('class')};
  },point);
  console.log('BROWSER_STAGE=SVG_HIT_TARGET '+JSON.stringify({...hit,point,box,
    viewport:await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollY:window.scrollY}))}));
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
  assert.ok(new TextDecoder('latin1').decode(pdf).includes('/MediaBox [0 0 595.28 841.89]'),'PDF physical size must be A4 portrait');
  await fs.writeFile(output+'/sample-part.pdf',pdf);
  console.log('BROWSER_STAGE=PDF_EXPORTED');
  await page.screenshot({path:output+'/sample-workspace.png',fullPage:true});

  // Open the deterministic multi-staff, voice + chord + tuplet MusicXML fixture
  // and verify real browser round-trip of a protected, pitch-only advanced edit.
  const fixture=await fs.readFile('tests/fixtures/complex-voices-original.musicxml');
  await page.setInputFiles('#file-input',{name:'complex-voices-original.musicxml',mimeType:'application/xml',buffer:fixture});
  await page.waitForFunction(()=>document.querySelector('#score-info')?.textContent.includes('1개 파트 · 1개 마디'),{timeout:30000});
  await page.locator('#v3-advanced-report').waitFor();
  // Real OSMD SVG mapping: grand staff with chord, tuplet and concurrent voices.
  const polyphonicTargets=await page.locator('#score-container .jwoo-note-target').count();
  assert.match(await page.locator('#a4-size-info').textContent(),/오선 6.5mm 고정/);
  const pianoStaffHeightPx=await page.locator('#score-container .staffline .vf-measure').first().evaluate(group=>{
    const lines=[...group.children].filter(el=>el.localName==='path'&&/^M[-\d.]+ [-\d.]+L[-\d.]+ [-\d.]+$/.test(el.getAttribute('d')||'')).slice(0,5);
    if(lines.length!==5)throw new Error('Piano staff lines not found');
    return lines[4].getBoundingClientRect().top-lines[0].getBoundingClientRect().top;
  });
  assert.ok(Math.abs(pianoStaffHeightPx/(96/25.4)-6.5)<0.4,'Piano staff must be approximately 6.5mm');
  console.log('BROWSER_STAGE=A4_PIANO_STAFF_MEASURED '+pianoStaffHeightPx.toFixed(3)+'px');

  console.log('BROWSER_STAGE=POLYPHONIC_GRAPHIC_TARGETS '+JSON.stringify({
    count:polyphonicTargets,hint:await page.locator('#v3-graphic-hint').textContent()
  }));
  assert.ok(polyphonicTargets>=2,'Grand-staff fixture did not expose distinct editable noteheads');
  // Playwright hover waits for the SVG target to become stable and scrolls
  // it into view; manual smooth scrolling would leave moving coordinates.
  // Select a non-chord notehead: chord tones can overlap at 6.5mm staff size.
  const complexHead=page.locator('#score-container .jwoo-note-target').nth(3);
  await complexHead.hover({timeout:12000});
  const rect=await complexHead.boundingBox();
  assert.ok(rect&&rect.width>0&&rect.height>0);
  const center={x:rect.x+rect.width/2,y:rect.y+rect.height/2};
  console.log('BROWSER_STAGE=COMPLEX_HIT_DIAG '+JSON.stringify(await page.evaluate(({x,y})=>{
    const el=document.elementFromPoint(x,y);
    return {x,y,viewport:{w:innerWidth,h:innerHeight},rect:document.querySelector('#score-container .jwoo-note-target')?.getBoundingClientRect().toJSON(),
      tag:el?.tagName,cls:el?.getAttribute('class'),parent:el?.parentElement?.getAttribute('class'),
      targetCount:document.querySelectorAll('#score-container .jwoo-note-target').length};
  },center)));
  await page.evaluate(()=>{
    window.__pointerTrace=[];
    for(const type of ['pointerdown','pointerup','pointercancel'])
      document.addEventListener(type,ev=>window.__pointerTrace.push({
        type,id:ev.pointerId,x:ev.clientX,y:ev.clientY,
        target:ev.target?.getAttribute?.('class'),
        parent:ev.target?.parentElement?.getAttribute?.('class')
      }),true);
  });
  await page.mouse.move(center.x,center.y);
  await page.mouse.down();
  await page.mouse.move(center.x,center.y-Math.max(22,rect.height*1.5),{steps:5});
  await page.mouse.up();
  console.log('BROWSER_STAGE=COMPLEX_POST_DRAG '+JSON.stringify({message:await page.locator('#message').textContent(),selection:await page.locator('#v3-selection').textContent(),trace:await page.evaluate(()=>window.__pointerTrace)}));
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('악보 음표 위아래 이동 완료'),null,{timeout:12000});
  await page.click('#v3-undo');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('되돌리기'));
  console.log('BROWSER_STAGE=POLYPHONIC_NOTE_DRAG_AND_UNDO');
  // The drag can select either member of a closely spaced piano chord.
  // Explicitly select the first XML event for the subsequent independent edit check.
  await page.locator('#v3-events .v3-event').first().click();
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
  // Import the same complex-polyphonic fixture through an actual compressed MXL
  // container, without embedding a real composer's private project in the repo.
  const mxlFixture=new JSZip();
  mxlFixture.file('META-INF/container.xml',
    '<?xml version="1.0" encoding="utf-8"?>'+
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'+
    '<rootfiles><rootfile full-path="music/complex.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>');
  mxlFixture.file('music/complex.musicxml',await fs.readFile('tests/fixtures/complex-voices-original.musicxml','utf8'));
  const mxlBuffer=await mxlFixture.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
  await page.locator('#file-input').setInputFiles({name:'complex-polyphony.mxl',mimeType:'application/vnd.recordare.musicxml',buffer:mxlBuffer});
  await page.waitForFunction(()=>document.querySelector('#drop-zone strong')?.textContent==='complex-polyphony.mxl' &&
    document.querySelector('#message')?.textContent?.includes('악보가 준비되었습니다.'),null,{timeout:20000});
  assert.ok((await page.locator('#score-container svg').count())>0);
  console.log('BROWSER_STAGE=V4_COMPLEX_MXL_FILE_IMPORTED');

  // Professional annotations on complex multi-staff, multi-voice MusicXML.
  await page.locator('#v3-events .v3-event').nth(5).click();
  await page.fill('#v4-pro-end','7');
  await page.click('#v4-pro-slur');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('이음줄 추가·해제 완료'));
  await page.click('#v4-pro-hairpin');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('셈여림 변화 기보 완료'));
  const annotatedDownloadPromise=page.waitForEvent('download');
  await page.click('#download-xml');
  const annotatedText=await fs.readFile(await (await annotatedDownloadPromise).path(),'utf8');
  assert.match(annotatedText,/<slur[^>]+type="start"/);
  assert.match(annotatedText,/<slur[^>]+type="stop"/);
  assert.match(annotatedText,/<wedge[^>]+type="crescendo"/);
  assert.match(annotatedText,/<wedge[^>]+type="stop"/);
  assert.match(annotatedText,/<backup><duration>48<\/duration><\/backup>/);
  console.log('BROWSER_STAGE=V4_COMPLEX_SLUR_HAIRPIN_MUSICXML');

  const polyphonicRhythm='<?xml version="1.0" encoding="utf-8"?><score-partwise version="4.0">'+
    '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>'+
    '<part id="P1"><measure number="1">'+
    '<attributes><divisions>48</divisions><time><beats>4</beats><beat-type>4</beat-type></time>'+
    '<staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef>'+
    '<clef number="2"><sign>F</sign><line>4</line></clef></attributes>'+
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>48</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>'+
    '<note><rest/><duration>48</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>'+
    '<note><pitch><step>E</step><octave>4</octave></pitch><duration>96</duration><voice>1</voice><type>half</type><staff>1</staff></note>'+
    '<backup><duration>192</duration></backup>'+
    '<note><pitch><step>G</step><octave>3</octave></pitch><duration>96</duration><voice>2</voice><type>half</type><staff>2</staff></note>'+
    '<note><rest/><duration>96</duration><voice>2</voice><type>half</type><staff>2</staff></note>'+
    '</measure></part></score-partwise>';
  await page.locator('#file-input').setInputFiles({name:'polyphonic-rhythm.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(polyphonicRhythm)});
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('악보가 준비되었습니다.'));
  await page.locator('#v3-events .v3-event').first().click();
  assert.equal(await page.locator('#v3-duration').isDisabled(),true,
    'Legacy simple duration operation is protected for polyphony');
  assert.equal(await page.locator('#v3-pitch').isEnabled(),true,
    'Stage1 graphical pitch editing is enabled for supported polyphonic notes');
  await page.selectOption('#v4-pro-type','half');
  await page.click('#v4-pro-duration');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('성부별 음표 길이 변경 완료'));
  const polyDownloadPromise=page.waitForEvent('download');
  await page.click('#download-xml');
  const polyText=await fs.readFile(await (await polyDownloadPromise).path(),'utf8');
  assert.match(polyText,/<step>C<\/step><octave>4<\/octave><\/pitch><duration>96<\/duration>/);
  assert.match(polyText,/<backup><duration>192<\/duration><\/backup>/);
  assert.match(polyText,/<step>G<\/step><octave>3<\/octave><\/pitch><duration>96<\/duration>/);
  console.log('BROWSER_STAGE=V4_POLYPHONIC_RHYTHM_EDIT');
  await page.selectOption('#v4-split-type','quarter');
  await page.click('#v4-split-tie');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('음표 분할·붙임줄 연결 완료'),null,{timeout:30000});
  const splitXmlDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const splitXml=await fs.readFile(await (await splitXmlDownload).path(),'utf8');
  assert.match(splitXml,/<tie type="start"\s*\/>/);
  assert.match(splitXml,/<tie type="stop"\s*\/>/);
  assert.match(splitXml,/<tied type="start"\s*\/>/);
  assert.match(splitXml,/<tied type="stop"\s*\/>/);
  assert.match(splitXml,/<backup><duration>192<\/duration><\/backup>/);
  console.log('BROWSER_STAGE=V4_SPLIT_POLYPHONIC_NOTE_WITH_SOUNDING_TIE');


  // Multi-staff direct beat-grid onset editing, while preserving an independent voice.
  const nudgeXml='<?xml version="1.0" encoding="utf-8"?><score-partwise version="4.0">'+
    '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>'+
    '<part id="P1"><measure number="1">'+
    '<attributes><divisions>48</divisions><time><beats>4</beats><beat-type>4</beat-type></time>'+
    '<staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef>'+
    '<clef number="2"><sign>F</sign><line>4</line></clef></attributes>'+
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>24</duration><voice>1</voice><type>eighth</type><staff>1</staff></note>'+
    '<note><pitch><step>E</step><octave>4</octave></pitch><duration>24</duration><voice>1</voice><type>eighth</type><staff>1</staff></note>'+
    '<note><rest/><duration>48</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>'+
    '<note><rest/><duration>96</duration><voice>1</voice><type>half</type><staff>1</staff></note>'+
    '<backup><duration>192</duration></backup>'+
    '<note><pitch><step>G</step><octave>3</octave></pitch><duration>96</duration><voice>2</voice><type>half</type><staff>2</staff></note>'+
    '<note><rest/><duration>96</duration><voice>2</voice><type>half</type><staff>2</staff></note>'+
    '</measure></part></score-partwise>';
  await page.locator('#file-input').setInputFiles({name:'piano-grid-shift.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(nudgeXml)});
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('악보가 준비되었습니다.'));
  assert.equal(await page.locator('.v4-beat-lane').count(),2);
  await page.locator('.v4-beat-event').filter({hasText:'E4'}).click();
  assert.equal(await page.locator('#v3-events .v3-event.selected').count(),1);
  await page.selectOption('#v4-grid-step','16th');
  await page.click('#v4-nudge-later');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('성부 음표 시작 위치 이동 완료'));
  const nudgedXmlDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const nudgedXml=await fs.readFile(await (await nudgedXmlDownload).path(),'utf8');
  assert.match(nudgedXml,/<rest\/><duration>12<\/duration><voice>1<\/voice><type>16th<\/type><staff>1<\/staff>/);
  assert.match(nudgedXml,/<step>E<\/step><octave>4<\/octave><\/pitch><duration>24<\/duration>/);
  assert.match(nudgedXml,/<backup><duration>192<\/duration><\/backup>/);
  assert.match(nudgedXml,/<step>G<\/step><octave>3<\/octave><\/pitch><duration>96<\/duration>/);
  console.log('BROWSER_STAGE=V4_POLYPHONIC_BEAT_GRID_ONSET_EDIT');
  // One transaction moves a selected pitch across more than one rest, and
  // the selection follows that same pitch after the rest list is rebuilt.
  await page.fill('#v4-relocate-beat','3');
  await page.click('#v4-relocate-note');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('음표를 지정한 박자로 이동 완료'),null,{timeout:30000});
  const exactPosition=await page.locator('#v3-selection').textContent();
  assert.match(exactPosition,/시작 96\/48/);
  assert.match(await page.locator('#v4-relocate-beat').inputValue(),/^3$/);
  const movedXmlDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const movedXml=await fs.readFile(await (await movedXmlDownload).path(),'utf8');
  assert.match(movedXml,/<step>E<\/step><octave>4<\/octave><\/pitch><duration>24<\/duration>/);
  assert.match(movedXml,/<backup><duration>192<\/duration><\/backup>/);
  console.log('BROWSER_STAGE=V4_EXACT_BEAT_RELOCATION_PRESERVES_SELECTION');

  // With explicit mode enabled, clicking an empty rest in the timeline moves
  // the selected note there; ordinary clicks continue to select an event.
  await page.locator('#v4-timeline-move').check();
  await page.locator('.v4-beat-lane').first().locator('.v4-beat-event.rest').last().click();
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('시간표에서 음표 위치 이동 완료'),null,{timeout:30000});
  assert.match(await page.locator('#v3-selection').textContent(),/시작 168\/48/);
  assert.equal(await page.locator('#v3-events .v3-event.selected').count(),1);
  console.log('BROWSER_STAGE=V4_TIMELINE_REST_CLICK_RELOCATES_NOTE');

  await page.click('#v4-pro-to-rest');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('다성부 음표를 쉼표로 대체 완료'),null,{timeout:30000});
  const removedXmlDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const removedXml=await fs.readFile(await (await removedXmlDownload).path(),'utf8');
  assert.doesNotMatch(removedXml,/<step>E<\/step><octave>4<\/octave>/);
  assert.match(removedXml,/<step>G<\/step><octave>3<\/octave>/);
  assert.match(removedXml,/<backup><duration>192<\/duration><\/backup>/);
  console.log('BROWSER_STAGE=V4_POLYPHONIC_NOTE_TO_REST_SAFE');
  await page.selectOption('#v4-pro-type','eighth');
  await page.selectOption('#v4-pro-step','F');
  await page.locator('#v4-timeline-insert').check();
  assert.equal(await page.locator('#v4-timeline-move').isChecked(),false);
  await page.locator('.v4-beat-lane').first().locator('.v4-beat-event.rest').last().click();
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('성부 시간표에서 음표 입력 완료'),null,{timeout:30000});
  const insertedXmlDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const insertedXml=await fs.readFile(await (await insertedXmlDownload).path(),'utf8');
  assert.match(insertedXml,/<step>F<\/step><octave>4<\/octave>/);
  assert.match(insertedXml,/<backup><duration>192<\/duration><\/backup>/);
  assert.match(insertedXml,/<step>G<\/step><octave>3<\/octave>/);
  console.log('BROWSER_STAGE=V4_DIRECT_TIMELINE_NOTE_ENTRY');
  await page.locator('#v4-timeline-insert').uncheck();
  await page.locator('.v4-beat-lane').first().locator('.v4-beat-event.rest').first().click();
  assert.match(await page.locator('#v3-selection').textContent(),/쉼표/);
  await page.locator('#v4-keys-enabled').check();
  await page.locator('#v4-beat-grid').focus();
  await page.keyboard.press('n');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('키보드 음표 입력 완료'),null,{timeout:30000});
  await page.locator('#v4-beat-grid').focus();
  await page.keyboard.press('r');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('키보드 음표를 쉼표로 변경 완료'),null,{timeout:30000});
  await page.locator('#v4-keys-enabled').uncheck();
  console.log('BROWSER_STAGE=V4_OPT_IN_KEYBOARD_NOTE_COMPOSING');
  // The professional editor can now consume a run of same-lane rests rather
  // than requiring the selected rest to fit the entire note by itself.
  await page.locator('#file-input').setInputFiles({name:'piano-multirest-entry.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(nudgeXml)});
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('악보가 준비되었습니다.'),null,{timeout:30000});
  await page.locator('#v3-events .v3-event').nth(2).click();
  await page.selectOption('#v4-pro-type','half');
  await page.selectOption('#v4-pro-step','A');
  await page.click('#v4-pro-insert');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('전문 음표 입력 완료'),null,{timeout:30000});
  const longEntryDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const longEntryXml=await fs.readFile(await (await longEntryDownload).path(),'utf8');
  assert.match(longEntryXml,/<step>A<\/step><octave>4<\/octave><\/pitch><duration>96<\/duration>/);
  assert.match(longEntryXml,/<step>G<\/step><octave>3<\/octave><\/pitch><duration>96<\/duration>/);
  assert.match(longEntryXml,/<backup><duration>192<\/duration><\/backup>/);
  console.log('BROWSER_STAGE=V4_MULTI_REST_SINGLE_NOTE_ENTRY');


  const crossbarScore='<?xml version="1.0" encoding="utf-8"?><score-partwise version="4.0">'+
    '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>'+
    '<part id="P1"><measure number="1"><attributes><divisions>48</divisions>'+
    '<time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>'+
    '<clef number="1"><sign>G</sign><line>2</line></clef>'+
    '<clef number="2"><sign>F</sign><line>4</line></clef></attributes>'+
    '<note><rest/><duration>192</duration><voice>1</voice><type>whole</type><staff>1</staff></note>'+
    '<backup><duration>192</duration></backup>'+
    '<note><pitch><step>G</step><octave>3</octave></pitch><duration>96</duration><voice>2</voice><type>half</type><staff>2</staff></note>'+
    '<note><pitch><step>B</step><octave>3</octave></pitch><duration>96</duration><voice>2</voice><type>half</type><staff>2</staff></note>'+
    '</measure><measure number="2">'+
    '<note><rest/><duration>192</duration><voice>1</voice><type>whole</type><staff>1</staff></note>'+
    '<backup><duration>192</duration></backup>'+
    '<note><rest/><duration>96</duration><voice>2</voice><type>half</type><staff>2</staff></note>'+
    '<note><pitch><step>A</step><octave>3</octave></pitch><duration>96</duration><voice>2</voice><type>half</type><staff>2</staff></note>'+
    '</measure></part></score-partwise>';
  await page.locator('#file-input').setInputFiles({name:'crossbar-voice.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(crossbarScore)});
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('악보가 준비되었습니다.'),null,{timeout:30000});
  await page.locator('#v3-events .v3-event').nth(2).click();
  assert.match(await page.locator('#v3-selection').textContent(),/96\/48/);
  await page.selectOption('#v4-crossbar-type','quarter');
  await page.click('#v4-crossbar-extend');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('다음 마디로 음표 붙임줄 연장 완료'),null,{timeout:30000});
  const crossbarDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const crossbarEditedXml=await fs.readFile(await (await crossbarDownload).path(),'utf8');
  assert.equal((crossbarEditedXml.match(/<tie type="start"\s*\/>/g)||[]).length,1);
  assert.equal((crossbarEditedXml.match(/<tie type="stop"\s*\/>/g)||[]).length,1);
  assert.equal((crossbarEditedXml.match(/<backup><duration>192<\/duration><\/backup>/g)||[]).length,2);
  assert.match(crossbarEditedXml,/<step>B<\/step><octave>3<\/octave>/);
  console.log('BROWSER_STAGE=V4_CROSSBAR_SUSTAINING_NOTE_WITH_VOICE_TIMING');

  await page.fill('#v4-pro-end','4');
  await page.selectOption('#v4-slur-next-measure','1');
  await page.click('#v4-pro-slur');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('이음줄 추가·해제 완료'),null,{timeout:30000});
  const crossSlurDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const crossSlurXml=await fs.readFile(await (await crossSlurDownload).path(),'utf8');
  assert.match(crossSlurXml,/<slur type="start" number="1"\s*\/>/);
  assert.match(crossSlurXml,/<slur type="stop" number="1"\s*\/>/);
  assert.equal((crossSlurXml.match(/<backup><duration>192<\/duration><\/backup>/g)||[]).length,2);
  console.log('BROWSER_STAGE=V4_CROSSBAR_SLUR_ADDED_AND_EXPORTED');
  // Moving a pitch to another bar is distinct from lengthening it with a
  // sounding tie: it must retain one source attack and update the selection.
  await page.locator('#file-input').setInputFiles({name:'crossbar-onset-move.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(crossbarScore)});
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('악보가 준비되었습니다.'),null,{timeout:30000});
  await page.locator('#v3-events .v3-event').nth(2).click();
  await page.click('#v4-crossbar-move');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('선택 음표를 다음 마디로 이동 완료'),null,{timeout:30000});
  assert.equal(await page.locator('#v3-measure').inputValue(),'1');
  assert.match(await page.locator('#v3-selection').textContent(),/시작 0\/48/);
  const crossMovedDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const crossMovedXml=await fs.readFile(await (await crossMovedDownload).path(),'utf8');
  assert.equal((crossMovedXml.match(/<step>B<\/step><octave>3<\/octave>/g)||[]).length,1);
  assert.equal((crossMovedXml.match(/<backup><duration>192<\/duration><\/backup>/g)||[]).length,2);
  assert.match(crossMovedXml,/<step>A<\/step><octave>3<\/octave>/);
  console.log('BROWSER_STAGE=V4_CROSSBAR_ONSET_MOVE_AND_SELECTION');







  await page.selectOption('#v4-new-template','melody');
  await page.fill('#v4-new-title','점음표 전문 입력');
  page.once('dialog',dialog=>dialog.accept());
  await page.click('#v4-new');
  await page.locator('#v3-events .v3-event').first().waitFor();
  await page.selectOption('#v4-pro-step','A');
  await page.selectOption('#v4-pro-type','quarter-dotted');
  await page.click('#v4-pro-insert');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('전문 음표 입력 완료'),null,{timeout:30000});
  const dottedDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const dottedXml=await fs.readFile(await (await dottedDownload).path(),'utf8');
  assert.match(dottedXml,/<duration>72<\/duration><type>quarter<\/type><dot\s*\/>/);
  console.log('BROWSER_STAGE=V4_EXACT_DOTTED_NOTE_COMPOSED_AND_EXPORTED');

  await page.fill('#v4-new-title','셋잇단음 편집 검증');
  page.once('dialog',dialog=>dialog.accept());
  await page.click('#v4-new');
  await page.locator('#v3-events .v3-event').first().waitFor();
  await page.selectOption('#v3-length','eighth');
  await page.locator('[data-tool="note"]').click();
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('성부를 보존한 음표 삽입 완료'));
  await page.locator('#v3-events .v3-event').nth(1).click();
  await page.selectOption('#v3-length','eighth');
  await page.selectOption('#v3-step','E');
  await page.locator('[data-tool="note"]').click();
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('성부를 보존한 음표 삽입 완료'));
  await page.locator('#v3-events .v3-event').first().click();
  await page.selectOption('#v4-pro-step','D');
  await page.click('#v4-pro-triplet');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('셋잇단음 변환 완료'));
  const tripletDownloadPromise=page.waitForEvent('download');
  await page.click('#download-xml');
  const tripletText=await fs.readFile(await (await tripletDownloadPromise).path(),'utf8');
  assert.equal((tripletText.match(/<actual-notes>3<\/actual-notes>/g)||[]).length,3);
  assert.match(tripletText,/<tuplet[^>]+type="start"/);
  assert.match(tripletText,/<tuplet[^>]+type="stop"/);
  assert.match(tripletText,/<step>D<\/step><octave>4<\/octave>/);
  assert.match(tripletText,/<duration>16<\/duration>/);
  console.log('BROWSER_STAGE=V4_TRIPLET_AUTHORING_RENDERED');

  // Genuine grand-staff Piano: one instrument, two clefs/voices, same timeline.
  await page.selectOption('#v4-new-template','vocal-piano');
  await page.fill('#v4-new-title','보컬 피아노 양손 검증');
  page.once('dialog',dialog=>dialog.accept());
  await page.click('#v4-new');
  await page.waitForFunction(()=>document.querySelector('#score-info')?.textContent.startsWith('2개 파트'));
  await page.selectOption('#v3-part','P2');
  assert.equal(await page.locator('#v3-events .v3-event').count(),2);
  await page.locator('#v3-events .v3-event').nth(1).click();
  assert.equal(await page.locator('#v3-pitch').isEnabled(),true,
    'Stage1 enables direct rest insertion for a valid grand-staff voice');
  assert.equal(await page.locator('#v3-duration').isDisabled(),true,
    'Legacy single-voice duration change remains blocked for grand staff');
  await page.selectOption('#v4-pro-step','A');
  await page.selectOption('#v4-pro-octave','3');
  await page.selectOption('#v4-pro-type','quarter');
  await page.locator('[data-tool="note"]').click();
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('성부를 보존한 음표 삽입 완료'));
  await page.selectOption('#v4-measure-count','1');
  await page.click('#v4-add-measures');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('빈 마디 추가 완료'));
  const grandDownloadPromise=page.waitForEvent('download');
  await page.click('#download-xml');
  const grandText=await fs.readFile(await (await grandDownloadPromise).path(),'utf8');
  assert.equal((grandText.match(/<part id="/g)||[]).length,2);
  assert.match(grandText,/<staves>2<\/staves>/);
  assert.match(grandText,/<clef number="2"><sign>F<\/sign><line>4<\/line><\/clef>/);
  assert.match(grandText,/<step>A<\/step><octave>3<\/octave><\/pitch><duration>48<\/duration><voice>2<\/voice><type>quarter<\/type><staff>2<\/staff>/);
  assert.equal((grandText.match(/<backup><duration>192<\/duration><\/backup>/g)||[]).length,5);
  console.log('BROWSER_STAGE=V4_GRAND_STAFF_PIANO_CREATED_EDITED_EXTENDED');
  await page.click('#v4-audit-run');
  await page.waitForFunction(()=>document.querySelector('#v4-audit-result')?.textContent.includes('기본 음악 구조 검사 통과'));
  assert.match(await page.locator('#v4-audit-result').textContent(),/오류 0건/);
  assert.match(await page.locator('#v4-audit-result').textContent(),/주의 0건/);
  assert.match(await page.locator('#v4-audit-result').textContent(),/XSD|검사범위/);
  assert.match(await page.locator('#v4-audit-details').textContent(),/Logic 왕복·시각 품질은 미검증/);
  console.log('BROWSER_STAGE=V4_SCORE_INTEGRITY_PREFLIGHT_CLEAN');

  // Mid-score key and time signatures on an otherwise empty voice/staff tail.
  await page.selectOption('#v3-measure','1');
  await page.selectOption('#v4-meter','3/4');
  await page.click('#v4-meter-empty');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('빈 구간 박자표 변경 완료'));
  await page.selectOption('#v4-key','1');
  await page.click('#v4-key-from-measure');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('선택 마디 조표 변경 완료'));
  const revisedScorePromise=page.waitForEvent('download');
  await page.click('#download-xml');
  const revisedScoreXml=await fs.readFile(await (await revisedScorePromise).path(),'utf8');
  assert.equal((revisedScoreXml.match(/<beats>3<\/beats><beat-type>4<\/beat-type>/g)||[]).length,2);
  assert.equal((revisedScoreXml.match(/<fifths>1<\/fifths>/g)||[]).length,2);
  assert.ok((revisedScoreXml.match(/<backup><duration>144<\/duration><\/backup>/g)||[]).length>=1);
  console.log('BROWSER_STAGE=V4_MID_SCORE_METER_KEY_EDITED');
  await page.selectOption('#v4-meter','2/4');
  await page.click('#v4-meter-single');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('선택 빈 마디 박자표 변경 완료'),null,{timeout:30000});
  const isolatedMeterDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const isolatedMeterXml=await fs.readFile(await (await isolatedMeterDownload).path(),'utf8');
  assert.equal((isolatedMeterXml.match(/<beats>2<\/beats><beat-type>4<\/beat-type>/g)||[]).length,2);
  assert.equal((isolatedMeterXml.match(/<beats>3<\/beats><beat-type>4<\/beat-type>/g)||[]).length,2);
  assert.ok((isolatedMeterXml.match(/<backup><duration>96<\/duration><\/backup>/g)||[]).length>=1);
  assert.ok((isolatedMeterXml.match(/<backup><duration>144<\/duration><\/backup>/g)||[]).length>=1);
  console.log('BROWSER_STAGE=V4_ISOLATED_EMPTY_METER_AND_FOLLOWING_RESTORE');


  // Both the vocal and true grand-staff Piano parts must be present in one
  // vector print book, in their original part order.
  const bothPartsPopup=page.waitForEvent('popup');
  await page.click('#v4-print-book');
  const bothPartsTab=await bothPartsPopup;
  await bothPartsTab.locator('.sheet svg').nth(1).waitFor({timeout:45000});
  const printedPartIds=await bothPartsTab.locator('.sheet').evaluateAll(
    list=>[...new Set(list.map(x=>x.dataset.partId))]);
  assert.deepEqual(printedPartIds,['P1','P2']);
  const bookPdf=await bothPartsTab.pdf({printBackground:true,preferCSSPageSize:true});
  assert.equal(bookPdf.subarray(0,5).toString(),'%PDF-');
  assert.ok(bookPdf.length>1800);
  assert.equal(await bothPartsTab.locator('#jwoo-print-part-select').count(),1);
  assert.equal(await bothPartsTab.locator('.sheet svg text[data-jwoo-software-copyright]').count()>0,true,'Print book must contain the software footer');
  await bothPartsTab.selectOption('#jwoo-print-part-select','P2');
  const visiblePartIds=await bothPartsTab.locator('.sheet:visible').evaluateAll(
    list=>[...new Set(list.map(x=>x.dataset.partId))]);
  assert.deepEqual(visiblePartIds,['P2'],'Individual part print must not include other instruments');
  const individualPdf=await bothPartsTab.pdf({printBackground:true,preferCSSPageSize:true});
  assert.equal(individualPdf.subarray(0,5).toString(),'%PDF-');
  assert.ok(individualPdf.length>1000,'Native print keeps an instrument-specific vector PDF');
  await bothPartsTab.selectOption('#jwoo-print-part-select','all');
  assert.deepEqual(await bothPartsTab.locator('.sheet:visible').evaluateAll(
    list=>[...new Set(list.map(x=>x.dataset.partId))]),['P1','P2']);
  await bothPartsTab.close();
  console.log('BROWSER_STAGE=V4_PART_SPECIFIC_NATIVE_VECTOR_PDF_PRINT');
  const partSvgZipDownload=page.waitForEvent('download',{timeout:45000});
  await page.click('#v4-part-svg-zip');
  const partSvgZip=await partSvgZipDownload;
  assert.match(partSvgZip.suggestedFilename(),/-part-svg\.zip$/);
  const partSvgZipBytes=await fs.readFile(await partSvgZip.path());
  const partSvgArchive=await JSZip.loadAsync(partSvgZipBytes);
  const svgNames=Object.keys(partSvgArchive.files).filter(name=>name.endsWith('.svg')).sort();
  assert.ok(svgNames.length>=2,'Both parts must receive their own vector pages');
  assert.ok(svgNames.some(name=>name.startsWith('01-')));
  assert.ok(svgNames.some(name=>name.startsWith('02-')));
  for(const name of svgNames){
    const text=await partSvgArchive.file(name).async('string');
    assert.match(text,/<svg[\s>]/);
    assert.doesNotMatch(text,/<image[\s>]|<script[\s>]/i);
  }
  console.log('BROWSER_STAGE=V4_INDIVIDUAL_PART_VECTOR_SVG_ZIP');
  await page.selectOption('#v4-cadence-bars','2');
  assert.equal(await page.locator('#v4-cadence-systems').count(),0,
    'Page line count must not require a separate setting');
  await page.click('#v4-cadence-apply');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('전체 악보 줄당 마디 수 적용 완료'),null,{timeout:30000});
  assert.match(await page.locator('#v4-cadence-status').textContent(),/모든 파트 2개/);
  const scoreCadenceDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const scoreCadenceXml=await fs.readFile(await (await scoreCadenceDownload).path(),'utf8');
  assert.equal((scoreCadenceXml.match(/<print new-system="yes"/g)||[]).length,4,
    'The third and fifth bars must start new systems in each part');
  assert.equal((scoreCadenceXml.match(/<print new-page="yes"/g)||[]).length,0,
    'Page boundaries must be left to automatic pagination');
  assert.match(scoreCadenceXml,/<backup><duration>144<\/duration><\/backup>/);
  console.log('BROWSER_STAGE=V4_MULTIPART_CADENCE_SYSTEM_PAGE_WRITTEN');





  // Real browser MusicXML edit + export of multi-verse Korean lyric, melisma,
  // and sounding + visible tie across the bar line.
  const vocalXml='<?xml version="1.0" encoding="utf-8"?><score-partwise version="4.0">'+
    '<part-list><score-part id="P1"><part-name>Vocal</part-name></score-part></part-list>'+
    '<part id="P1"><measure number="1"><attributes><divisions>48</divisions>'+
    '<time><beats>4</beats><beat-type>4</beat-type></time>'+
    '<clef><sign>G</sign><line>2</line></clef></attributes>'+
    '<note><rest/><duration>144</duration><type>half</type><dot/></note>'+
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>48</duration><type>quarter</type></note>'+
    '</measure><measure number="2">'+
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>48</duration><type>quarter</type></note>'+
    '<note><rest/><duration>144</duration><type>half</type><dot/></note>'+
    '</measure></part></score-partwise>';
  await page.locator('#file-input').setInputFiles({name:'vocal-lyric-tie.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(vocalXml)});
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('악보가 준비되었습니다.'));
  await page.locator('#v3-events .v3-event').nth(1).click();
  await page.fill('#v4-lyric-text','바람');
  await page.fill('#v4-lyric-verse','1');
  await page.selectOption('#v4-lyric-extend','start');
  await page.click('#v4-lyric-set');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('가사 입력·교체 완료'));
  await page.fill('#v4-lyric-text','wind');
  await page.fill('#v4-lyric-verse','2');
  await page.selectOption('#v4-lyric-extend','none');
  await page.click('#v4-lyric-set');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('가사 입력·교체 완료'));
  await page.selectOption('#v4-tie-next-measure','1');
  await page.fill('#v4-pro-end','1');
  await page.click('#v4-tie-toggle');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('실제 붙임줄 연결·해제 완료'));
  const composerDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const composerXml=await fs.readFile(await (await composerDownload).path(),'utf8');
  assert.match(composerXml,/<lyric number="1"><syllabic>single<\/syllabic><text>바람<\/text><extend type="start"\/><\/lyric>/);
  assert.match(composerXml,/<lyric number="2"><syllabic>single<\/syllabic><text>wind<\/text><\/lyric>/);
  assert.equal((composerXml.match(/<tie type="start"\/>/g)||[]).length,1);
  assert.equal((composerXml.match(/<tie type="stop"\/>/g)||[]).length,1);
  assert.equal((composerXml.match(/<tied type="start"\/>/g)||[]).length,1);
  assert.equal((composerXml.match(/<tied type="stop"\/>/g)||[]).length,1);
  assert.match(composerXml,/<duration>144<\/duration>/);
  console.log('BROWSER_STAGE=V4_KOREAN_LYRICS_AND_CROSS_BAR_TIE');

  await page.click('#v4-play');
  await page.waitForFunction(()=>document.querySelector('#v4-play-status')?.textContent?.includes('재생 중'));
  assert.match(await page.locator('#v4-play-status').textContent(),/1음/);
  await page.click('#v4-stop');
  await page.locator('#file-input').setInputFiles({name:'vocal-lyric-tie-roundtrip.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(composerXml)});
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('악보가 준비되었습니다.'));
  assert.ok((await page.locator('#score-container svg').count())>0);
  console.log('BROWSER_STAGE=V4_TIED_PLAYBACK_AND_XML_REIMPORT');


  // The native print book keeps the score as live SVG vector graphics and
  // produces a PDF through Chromium's own print engine (not via JPEG pages).
  const popupPromise=page.waitForEvent('popup');
  await page.click('#v4-print-book');
  const printTab=await popupPromise;
  await printTab.locator('.sheet svg').first().waitFor({timeout:45000});
  assert.match(await printTab.locator('.sheet svg text[data-jwoo-software-copyright]').first().textContent(),/© 2026 PARKJAEWOO/);
  assert.ok(await printTab.locator('.sheet svg path').count()>0);
  assert.equal(await printTab.locator('.controls button').textContent(),'인쇄 / PDF 저장');
  const vectorPdf=await printTab.pdf({printBackground:true,preferCSSPageSize:true});
  assert.equal(vectorPdf.subarray(0,5).toString(),'%PDF-');
  assert.ok(vectorPdf.length>1000);
  await printTab.close();
  console.log('BROWSER_STAGE=V4_NATIVE_VECTOR_PART_PDF_PRINTED');

  // Regression: changing a current score's *total* measures must update the
  // MusicXML + rendered page, not merely a "new score" preset selector.
  await page.fill('#v4-new-title','실제 마디 수 변경');
  await page.selectOption('#v4-new-template','vocal-piano');
  await page.selectOption('#v4-new-measures','4');
  page.once('dialog',dialog=>dialog.accept());
  await page.click('#v4-new');
  await page.waitForFunction(()=>document.querySelector('#score-info')?.textContent.includes('2개 파트 · 4개 마디'));
  assert.equal(await page.locator('#v4-current-total').inputValue(),'4');
  await page.locator('#v4-current-total').fill('9');
  await page.locator('#v4-current-total').press('Enter');
  await page.waitForFunction(()=>document.querySelector('#score-info')?.textContent.includes('2개 파트 · 9개 마디'),null,{timeout:30000});
  assert.equal(await page.locator('#v4-current-total').inputValue(),'9');
  assert.match(await page.locator('#v4-total-status').textContent(),/적용 완료/);
  const grownDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const grownXml=await fs.readFile(await (await grownDownload).path(),'utf8');
  assert.equal((grownXml.match(/<measure number="/g)||[]).length,18);
  assert.equal((grownXml.match(/<backup><duration>192<\/duration><\/backup>/g)||[]).length,9);
  console.log('BROWSER_STAGE=V4_EXISTING_SCORE_MEASURE_INCREASE');

  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#v4-current-total').fill('5');
  await page.locator('#v4-current-total').press('Enter');
  await page.waitForFunction(()=>document.querySelector('#score-info')?.textContent.includes('2개 파트 · 5개 마디'),null,{timeout:30000});
  assert.equal(await page.locator('#v4-current-total').inputValue(),'5');
  const reducedDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const reducedXml=await fs.readFile(await (await reducedDownload).path(),'utf8');
  assert.equal((reducedXml.match(/<measure number="/g)||[]).length,10);
  console.log('BROWSER_STAGE=V4_EMPTY_TAIL_MEASURE_REDUCTION');

  await page.selectOption('#v3-part','P1');
  await page.selectOption('#v3-measure','4');
  await page.locator('#v3-events .v3-event').first().click();
  await page.selectOption('#v3-length','quarter');
  await page.locator('[data-tool="note"]').click();
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('음표 삽입 완료'),null,{timeout:30000});
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#v4-current-total').fill('4');
  await page.locator('#v4-current-total').press('Enter');
  await page.waitForFunction(()=>document.querySelector('#v4-total-status')?.textContent.includes('변경되지 않았습니다'),null,{timeout:30000});
  assert.equal(await page.locator('#v4-current-total').inputValue(),'5');
  assert.match(await page.locator('#score-info').textContent(),/2개 파트 · 5개 마디/);
  console.log('BROWSER_STAGE=V4_WRITTEN_TAIL_MEASURE_PROTECTED');

  // Regression: switching to only the Melody part must not collapse visible
  // whole-rest bars when measure count changes. The other part stays in XML.
  await page.selectOption('#export-part','P1');
  await page.click('#view-part');
  await page.waitForFunction(()=>document.querySelector('#score-container .staffline .vf-measure'),null,{timeout:30000});
  await page.locator('#v4-current-total').fill('8');
  await page.locator('#v4-current-total').press('Enter');
  await page.waitForFunction(()=>document.querySelector('#v4-total-status')?.textContent.includes('적용 완료'),null,{timeout:30000});
  assert.equal(await page.locator('#v4-current-total').inputValue(),'8');
  const soloVisibleMeasures=await page.locator('#score-container .staffline .vf-measure').count();
  assert.equal(soloVisibleMeasures,8,'Melody-only preview should show eight distinct measures, not condensed multirests');
  const soloXmlEvent=page.waitForEvent('download');
  await page.click('#download-xml');
  const soloXml=await fs.readFile(await (await soloXmlEvent).path(),'utf8');
  assert.equal((soloXml.match(/<measure number="/g)||[]).length,16,'Both original parts retain eight measures');
  const soloPartEvent=page.waitForEvent('download');
  await page.click('#download-part-xml');
  const singlePartXml=await fs.readFile(await (await soloPartEvent).path(),'utf8');
  assert.equal((singlePartXml.match(/<measure number="/g)||[]).length,8);
  await page.click('#view-all-parts');
  await page.waitForFunction(()=>document.querySelectorAll('#score-container .staffline .vf-measure').length>=16,null,{timeout:30000});
  console.log('BROWSER_STAGE=V4_SOLO_MELODY_MEASURE_COUNT_VISIBLE');







  // Smart Korean lyric paste in the real browser: editor -> XML -> undo/redo -> reimport.
  const lyricPasteXml='<?xml version="1.0" encoding="utf-8"?>'
    +'<score-partwise version="4.0"><work><work-title>스마트 가사 검증</work-title></work>'
    +'<movement-title>스마트 가사 검증</movement-title>'
    +'<part-list><score-part id="P1"><part-name>Vocal</part-name>'
    +'<score-instrument id="I1"><instrument-name>Voice</instrument-name></score-instrument>'
    +'</score-part></part-list><part id="P1"><measure number="1">'
    +'<attributes><divisions>16</divisions><key><fifths>0</fifths></key>'
    +'<time><beats>4</beats><beat-type>4</beat-type></time>'
    +'<clef><sign>G</sign><line>2</line></clef></attributes>'
    +['C','D','E','F'].map(step=>'<note><pitch><step>'+step+
      '</step><octave>4</octave></pitch><duration>16</duration><type>quarter</type></note>').join('')
    +'</measure></part></score-partwise>';
  await page.locator('#file-input').setInputFiles({name:'smart-korean-lyrics.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(lyricPasteXml)});
  await page.waitForFunction(()=>document.querySelector('#score-info')?.textContent.includes('1개 파트 · 1개 마디'));
  await page.selectOption('#v3-part','P1');
  await page.selectOption('#v3-measure','0');
  await page.locator('#v3-events .v3-event').first().click();
  await page.fill('#v4-lyric-verse','1');
  await page.fill('#v4-lyrics-batch-text','우리 함께');
  await page.click('#v4-lyrics-batch-preview');
  assert.match(await page.locator('#v4-lyrics-batch-status').textContent(),/배치 가능 · 4개 가사 음절/);
  await page.click('#v4-lyrics-batch-apply');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('스마트 가사 일괄 입력 완료'),null,{timeout:30000});
  assert.match(await page.locator('#v4-lyrics-batch-status').textContent(),/적용 완료/);
  assert.equal(await page.locator('#v3-undo').isEnabled(),true);
  const pasteDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const pasteXml=await fs.readFile(await (await pasteDownload).path(),'utf8');
  for(const syllable of ['우','리','함','께'])assert.match(pasteXml,new RegExp('<text>'+syllable+'</text>'));
  assert.equal((pasteXml.match(/<lyric number="1">/g)||[]).length,4);
  assert.equal((pasteXml.match(/<duration>16<\/duration>/g)||[]).length,4);
  await page.click('#v3-undo');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('스마트 가사 일괄 입력 되돌리기'));
  const undoDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const undoXml=await fs.readFile(await (await undoDownload).path(),'utf8');
  assert.doesNotMatch(undoXml,/<lyric number="1">/);
  await page.click('#v3-redo');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('스마트 가사 일괄 입력 다시 실행'));
  await page.fill('#v4-lyric-verse','2');
  await page.fill('#v4-lyrics-batch-text','아 _ _ 너');
  await page.click('#v4-lyrics-batch-apply');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('스마트 가사 일괄 입력 완료'),null,{timeout:30000});
  const melismaDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const melismaXml=await fs.readFile(await (await melismaDownload).path(),'utf8');
  for(const type of ['start','continue','stop'])assert.match(melismaXml,new RegExp('<extend type="'+type+'"/>'));
  assert.equal((melismaXml.match(/<lyric number="1">/g)||[]).length,4);
  assert.equal((melismaXml.match(/<lyric number="2">/g)||[]).length,4);
  await page.locator('#file-input').setInputFiles({name:'smart-korean-lyrics-roundtrip.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(melismaXml)});
  await page.waitForFunction(()=>document.querySelector('#score-info')?.textContent.includes('1개 파트 · 1개 마디'));
  assert.ok((await page.locator('#score-container svg').count())>0);
  console.log('BROWSER_STAGE=V4_SMART_KOREAN_LYRICS_UNDO_REDO_XML_REIMPORT');

  // The composer can edit the lyric directly on a mapped score notehead.
  // Single-click is opt-in so pitch dragging stays safe in normal mode.
  const scoreHeads=page.locator('#score-container .jwoo-note-target');
  assert.ok(await scoreHeads.count()>=4,'Mapped noteheads must be available for direct lyric editing');
  await page.locator('[data-tool="lyric"]').click();
  assert.equal(await page.locator('#v4-lyric-mode-button').getAttribute('aria-pressed'),'true');
  await scoreHeads.first().click();
  await page.locator('#v4-inline-lyric-editor:visible').waitFor();
  await page.locator('.jwoo-lyric-advanced summary').click();
  assert.equal(await page.locator('#v4-inline-input').inputValue(),'아');
  assert.equal(await page.locator('#v4-inline-verse').inputValue(),'2',
    'Current verse follows the active global lyric verse, initially last used 2');
  await page.selectOption('#v4-inline-verse','1');
  assert.equal(await page.locator('#v4-inline-input').inputValue(),'우');
  await page.fill('#v4-inline-input','아');
  await page.click('#v4-inline-save');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('악보 위 가사 직접 수정 완료'),null,{timeout:30000});
  const directFile=page.waitForEvent('download');
  await page.click('#download-xml');
  const directXml=await fs.readFile(await (await directFile).path(),'utf8');
  assert.match(directXml,/<lyric number="1"><syllabic>begin<\/syllabic><text>아<\/text><\/lyric>/);
  assert.match(directXml,/<lyric number="2">/);
  console.log('BROWSER_STAGE=V4_DIRECT_NOTEHEAD_LYRIC_EDIT');

  // A full Korean sentence becomes syllable-aligned verse 3 in one transaction.
  await page.locator('#score-container .jwoo-note-target').first().click();
  await page.selectOption('#v4-inline-verse','3');
  await page.fill('#v4-inline-input','우리 함께');
  assert.match(await page.locator('#v4-inline-preview').textContent(),/4개 위치로 스마트 배치/);
  await page.locator('#v4-inline-input').press('Control+Enter');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('악보 위 스마트 문장 가사 배치 완료'),null,{timeout:30000});
  const sentenceFile=page.waitForEvent('download');
  await page.click('#download-xml');
  const sentenceXml=await fs.readFile(await (await sentenceFile).path(),'utf8');
  assert.equal((sentenceXml.match(/<lyric number="3">/g)||[]).length,4);
  for(const syllable of ['우','리','함','께'])
    assert.match(sentenceXml,new RegExp('<text>'+syllable+'</text>'));
  assert.equal((sentenceXml.match(/<lyric number="1">/g)||[]).length,4);
  assert.equal((sentenceXml.match(/<lyric number="2">/g)||[]).length,4);
  console.log('BROWSER_STAGE=V4_SCORE_ANCHORED_SMART_SENTENCE_BATCH');

  // Press Enter to insert one syllable and advance inside the same voice.
  await page.locator('#score-container .jwoo-note-target').first().click();
  await page.selectOption('#v4-inline-verse','4');
  await page.fill('#v4-inline-input','별');
  await page.locator('#v4-inline-input').press('Enter');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('악보 위 가사 직접 수정 완료'),null,{timeout:30000});
  assert.match(await page.locator('#v4-inline-location').textContent(),/2번째 음표/);
  assert.equal(await page.locator('#v4-inline-input').inputValue(),'');
  await page.fill('#v4-inline-input','빛');
  await page.locator('#v4-inline-input').press('Enter');
  await page.waitForFunction(()=>document.querySelector('#v4-inline-location')?.textContent?.includes('3번째 음표'),null,{timeout:30000});
  const continuousFile=page.waitForEvent('download');
  await page.click('#download-xml');
  const continuousXml=await fs.readFile(await (await continuousFile).path(),'utf8');
  assert.match(continuousXml,/<lyric number="4"><syllabic>single<\/syllabic><text>별<\/text><\/lyric>/);
  assert.match(continuousXml,/<lyric number="4"><syllabic>single<\/syllabic><text>빛<\/text><\/lyric>/);
  assert.equal((continuousXml.match(/<lyric number="4">/g)||[]).length,2);
  console.log('BROWSER_STAGE=V4_ENTER_TO_NEXT_NOTE_LYRIC_FLOW');

  // Cancel popover and disable mode: the normal pitch-edit interaction returns.
  await page.locator('#v4-inline-input').press('Escape');
  assert.equal(await page.locator('#v4-inline-lyric-editor').isVisible(),false);
  await page.locator('[data-tool="lyric"]').click();
  assert.equal(await page.locator('#v4-lyric-mode-button').getAttribute('aria-pressed'),'false');
  const reselect=page.locator('#score-container .jwoo-note-target').nth(1);
  await reselect.dblclick();
  await page.locator('#v4-inline-lyric-editor:visible').waitFor();
  assert.equal(await page.locator('#v4-inline-input').inputValue(),'빛');
  await page.click('#v4-inline-close');
  console.log('BROWSER_STAGE=V4_DOUBLE_CLICK_SCORE_LYRIC_EDIT_WITH_MODE_OFF');
  await page.locator('#v3-events .v3-event').nth(2).click();
  await page.click('#v4-inline-selected');
  await page.locator('#v4-inline-lyric-editor:visible').waitFor();
  assert.match(await page.locator('#v4-inline-location').textContent(),/3번째 음표/);
  assert.equal(await page.locator('#v4-inline-input').inputValue(),'');
  await page.click('#v4-inline-close');
  console.log('BROWSER_STAGE=V4_SELECTED_NOTE_INLINE_LYRIC_FALLBACK');


  // Sticky score follows the long inspector instead of scrolling away.
  // A4 SVG dimensions must be stable, and the score viewport remains scrollable.
  await page.evaluate(()=>document.querySelector('#v4-lyrics-batch-text')
    .scrollIntoView({block:'center',behavior:'instant'}));
  await page.waitForFunction(()=>document.querySelector('.preview-column')?.classList.contains('is-pinned'),null,{timeout:10000});
  const stickyDesktop=await page.evaluate(()=>{
    const preview=document.querySelector('.preview-column');
    const shell=document.querySelector('#preview-shell');
    const svg=document.querySelector('#score-container svg');
    return {top:preview.getBoundingClientRect().top,position:getComputedStyle(preview).position,
      height:preview.getBoundingClientRect().height,shellHeight:shell.clientHeight,
      scrollHeight:shell.scrollHeight,svgWidth:svg?.getBoundingClientRect().width,
      viewportHeight:window.innerHeight};
  });
  assert.equal(stickyDesktop.position,'sticky');
  assert.ok(Math.abs(stickyDesktop.top-14)<4,'Desktop score should follow at 14px from viewport top');
  assert.ok(stickyDesktop.height<=stickyDesktop.viewportHeight-20,'Pinned preview must fit in viewport');
  assert.ok(stickyDesktop.scrollHeight>stickyDesktop.shellHeight,'Long score pages remain independently scrollable');
  assert.ok(Math.abs(stickyDesktop.svgWidth-210*96/25.4)<3,'Sticky score must keep fixed A4 geometry');
  const internalScroll=await page.evaluate(()=>{
    const shell=document.querySelector('#preview-shell');
    const available=shell.scrollHeight-shell.clientHeight;
    const target=Math.min(90,available);
    shell.scrollTop=target;
    return {available,target,actual:shell.scrollTop,overflowY:getComputedStyle(shell).overflowY};
  });
  assert.equal(internalScroll.overflowY,'auto');
  assert.ok(internalScroll.available>0,'The score viewport should have independently scrollable content');
  assert.ok(Math.abs(internalScroll.actual-internalScroll.target)<=2,'Preview scroll position remains under user control');
  await page.screenshot({path:output+'/sticky-desktop.png'});
  console.log('BROWSER_STAGE=FOLLOW_ALONG_SCORE_DESKTOP '+JSON.stringify(stickyDesktop));

  // Phone: the score appears above the settings, with a compact sticky viewport.
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>document.querySelector('#v4-lyrics-batch-text')
    .scrollIntoView({block:'center',behavior:'instant'}));
  await page.waitForFunction(()=>document.querySelector('.preview-column')?.classList.contains('is-pinned'),null,{timeout:10000});
  const stickyPhone=await page.evaluate(()=>{
    const preview=document.querySelector('.preview-column');
    const shell=document.querySelector('#preview-shell');
    return {top:preview.getBoundingClientRect().top,height:preview.getBoundingClientRect().height,
      shellHeight:shell.clientHeight,position:getComputedStyle(preview).position,
      order:getComputedStyle(preview).order,viewportHeight:window.innerHeight};
  });
  assert.equal(stickyPhone.position,'sticky');
  assert.equal(stickyPhone.order,'-1');
  assert.ok(Math.abs(stickyPhone.top)<4,'Phone score should remain pinned at top of viewport');
  assert.ok(stickyPhone.height<400,'Phone score must not cover most of the settings');
  assert.ok(stickyPhone.shellHeight<=190,'Phone preview is compact and scrollable');
  await page.screenshot({path:output+'/sticky-phone.png'});
  console.log('BROWSER_STAGE=FOLLOW_ALONG_SCORE_PHONE '+JSON.stringify(stickyPhone));

  // Printing must restore unbounded A4 pages, without clipping the sticky shell.
  await page.emulateMedia({media:'print'});
  const printPreview=await page.evaluate(()=>({
    position:getComputedStyle(document.querySelector('.preview-column')).position,
    maxHeight:getComputedStyle(document.querySelector('#preview-shell')).maxHeight,
    overflow:getComputedStyle(document.querySelector('#preview-shell')).overflow,
  }));
  assert.equal(printPreview.position,'static');
  assert.equal(printPreview.maxHeight,'none');
  assert.equal(printPreview.overflow,'visible');
  await page.emulateMedia({media:'screen'});
  await page.setViewportSize({width:1440,height:1000});
  console.log('BROWSER_STAGE=FOLLOW_ALONG_SCORE_PRINT_UNCLIPPED');


  // Section-level inspector toggles preserve live inputs and their event handlers.
  const allGroups=await page.locator('#editor-controls .control-group').count();
  assert.ok(allGroups>=12,'Every main settings panel has an accordion');
  assert.equal(await page.locator('#editor-controls .control-group>.control-heading>.jwoo-fold-toggle').count(),allGroups);
  assert.ok(await page.locator('.jwoo-v4-section>.v4-subhead .jwoo-fold-toggle').count()>=6);
  const chordToggle=page.locator('.v4-chord-editor>.control-heading>.jwoo-fold-toggle');
  assert.equal(await chordToggle.getAttribute('aria-expanded'),'true');
  await chordToggle.click();
  assert.equal(await chordToggle.getAttribute('aria-expanded'),'false');
  assert.equal(await page.locator('#v4-chord-input').isVisible(),false);
  await chordToggle.click();
  assert.equal(await chordToggle.getAttribute('aria-expanded'),'true');
  assert.equal(await page.locator('#v4-chord-input').isVisible(),true);
  const innerToggle=page.locator('.jwoo-v4-section>.v4-subhead .jwoo-fold-toggle').first();
  await innerToggle.click();
  assert.equal(await innerToggle.getAttribute('aria-expanded'),'false');
  await innerToggle.click();
  assert.equal(await innerToggle.getAttribute('aria-expanded'),'true');
  console.log('BROWSER_STAGE=INSPECTOR_ACCORDIONS_PRESERVE_CONTROL_STATE');

  // Edit a true MusicXML harmony event at a user-selected note and check the
  // original lyrics, notes, undo/redo and SVG selection affordance.
  await page.locator('#v3-events .v3-event').nth(1).click();
  await page.waitForFunction(()=>document.querySelector('#v4-chord-input')?.disabled===false);
  assert.equal(await page.locator('#score-container .jwoo-note-selected .jwoo-selection-ring').count(),1,
    'Selected notehead has a visible, non-destructive SVG ring');
  assert.equal(await page.locator('#score-container .jwoo-note-selected').getAttribute('aria-pressed'),'true');
  assert.match(await page.locator('.jwoo-selected-location').textContent(),/선택 · 1마디 \/ 2번 음표/);
  await page.fill('#v4-chord-input','Am7');
  await page.click('#v4-chord-apply');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('코드 기호 입력·교체 완료'),null,{timeout:30000});
  assert.match(await page.locator('#v4-chord-location').textContent(),/현재 코드 Am7/);
  const chordDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const chordXml=await fs.readFile(await (await chordDownload).path(),'utf8');
  assert.match(chordXml,/<harmony>/);
  assert.match(chordXml,/<root-step>A<\/root-step>/);
  assert.match(chordXml,/<kind text="m7">minor-seventh<\/kind>/);
  assert.equal((chordXml.match(/<duration>16<\/duration>/g)||[]).length,4,'Rhythm remains unchanged');
  assert.equal((chordXml.match(/<lyric number="1">/g)||[]).length,4,'Existing verse 1 is preserved');
  assert.equal((chordXml.match(/<lyric number="2">/g)||[]).length,4,'Existing verse 2 is preserved');
  assert.ok(await page.locator('#score-container svg').count()>0,'Chord-annotated score renders');
  console.log('BROWSER_STAGE=MUSICXML_CHORD_SYMBOL_RENDER_AND_ROUNDTRIP');

  await page.click('#v3-undo');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('코드 기호 입력·교체 되돌리기'));
  assert.match(await page.locator('#v4-chord-location').textContent(),/코드 없음/);
  await page.click('#v3-redo');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('코드 기호 입력·교체 다시 실행'));
  assert.match(await page.locator('#v4-chord-location').textContent(),/현재 코드 Am7/);
  await page.click('#v4-chord-remove');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('코드 기호 삭제 완료'));
  assert.match(await page.locator('#v4-chord-location').textContent(),/코드 없음/);
  assert.equal(await page.locator('#score-container .jwoo-selection-ring').count(),1);
  console.log('BROWSER_STAGE=CHORD_SYMBOL_UNDO_REDO_REMOVE');

  // Toggle entire sections, then restore them without losing the loaded score.
  await page.getByRole('button',{name:'모두 접기'}).click();
  assert.equal(await page.locator('#v4-chord-input').isVisible(),false);
  await page.getByRole('button',{name:'모두 펼치기'}).click();
  assert.equal(await page.locator('#v4-chord-input').isVisible(),true);
  assert.ok(await page.locator('#score-container svg').count()>0);
  await page.screenshot({path:output+'/chords-accordions-selection.png',fullPage:true});
  console.log('BROWSER_STAGE=ALL_FOLD_UNFOLD_PRESERVES_SCORE');


  // Responsiveness regression: consecutive changes to part visibility must be
  // acknowledged immediately, show the existing score while pending, and
  // engrave only the final state instead of 3 full SVG render passes.
  await page.selectOption('#v4-new-template','vocal-piano');
  await page.selectOption('#v4-new-measures','8');
  page.once('dialog',dialog=>dialog.accept());
  await page.click('#v4-new');
  await page.waitForFunction(()=>document.querySelector('#score-info')?.textContent.includes('2개 파트 · 8개 마디')&&
    document.querySelector('#preview-shell')?.getAttribute('aria-busy')==='false',null,{timeout:30000});
  const rapid=await page.evaluate(()=>{
    const inputs=[...document.querySelectorAll('#parts-list input[type="checkbox"]')];
    if(inputs.length!==2||inputs.some(x=>!x.checked))return {failure:'expected two checked parts',count:inputs.length};
    const checkbox=inputs[1],container=document.querySelector('#score-container');
    const oldSvg=container.querySelector('svg'),initialRevision=Number(container.dataset.renderRevision);
    checkbox.click();
    const immediate={checked:checkbox.checked,svgUnchanged:container.querySelector('svg')===oldSvg,
      pending:document.querySelector('#preview-shell').getAttribute('aria-busy')};
    checkbox.click();checkbox.click();
    return {immediate,finalChecked:checkbox.checked,initialRevision};
  });
  assert.equal(rapid.immediate.checked,false);
  assert.equal(rapid.immediate.svgUnchanged,true,'Score stays visible while rendering is scheduled');
  assert.equal(rapid.immediate.pending,'true','The UI acknowledges change immediately');
  assert.equal(rapid.finalChecked,false);
  await page.waitForFunction(()=>document.querySelector('#preview-shell')?.getAttribute('aria-busy')==='false'&&
    Number(document.querySelector('#score-container')?.dataset.renderRevision)>0,null,{timeout:30000});
  const finalRevision=await page.locator('#score-container').getAttribute('data-render-revision');
  assert.equal(Number(finalRevision)-rapid.initialRevision,1,'Three rapid toggles produce one render');
  assert.equal(await page.locator('#parts-list input[type="checkbox"]').nth(1).isChecked(),false);
  assert.ok(await page.locator('#score-container .staffline .vf-measure').count()>=8);
  const didUndo=await page.evaluate(()=>{
    const box=document.querySelectorAll('#parts-list input[type="checkbox"]')[1];
    const container=document.querySelector('#score-container'),revision=Number(container.dataset.renderRevision);
    box.click();box.click();
    return {revision,checked:box.checked};
  });
  assert.equal(didUndo.checked,false);
  await page.waitForTimeout(250);
  assert.equal(Number(await page.locator('#score-container').getAttribute('data-render-revision')),
    didUndo.revision,'A cancelled visibility change should avoid any score rendering');
  await page.locator('#view-all-parts').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('#parts-list input[type="checkbox"]')].every(x=>x.checked)&&
    document.querySelector('#preview-shell')?.getAttribute('aria-busy')==='false',null,{timeout:30000});
  assert.ok(await page.locator('#score-container .staffline .vf-measure').count()>=16);
  console.log('BROWSER_STAGE=PART_VISIBILITY_IMMEDIATE_AND_COALESCED');

  // The measure-number checkbox uses the same coalesced view renderer.
  const measureRefresh=await page.evaluate(()=>{
    const input=document.querySelector('#measure-numbers');
    const before=Number(document.querySelector('#score-container').dataset.renderRevision);
    input.click();
    return {checked:input.checked,revision:before,busy:document.querySelector('#preview-shell').getAttribute('aria-busy')};
  });
  assert.equal(measureRefresh.checked,false);
  assert.equal(measureRefresh.busy,'true');
  await page.waitForFunction(()=>document.querySelector('#preview-shell')?.getAttribute('aria-busy')==='false',null,{timeout:30000});
  assert.equal(Number(await page.locator('#score-container').getAttribute('data-render-revision')),
    measureRefresh.revision+1);
  assert.equal(await page.locator('#measure-numbers').isChecked(),false);
  await page.screenshot({path:output+'/fast-part-visibility.png'});
  console.log('BROWSER_STAGE=MEASURE_VISIBILITY_COALESCED');


  // UI copy/layout polish: copyright name is exactly the intended English mark,
  // onboarding accurately describes creation/import/editing, and shortcuts
  // expand only the accordions needed to reach existing functional controls.
  assert.equal((await page.locator('.footer-credit').textContent()).trim(),
    '© 2026 PARKJAEWOO. All rights reserved.');
  assert.match(await page.locator('.intro-bottom').textContent(),/MusicXML·MIDI/);
  assert.match(await page.locator('#guide').textContent(),/음표·가사·코드 편집/);
  assert.match(await page.locator('.workspace-heading').textContent(),/SCORE PREVIEW · A4/);
  const heroBefore=await page.evaluate(()=>({
    active:document.querySelector('.site-shell').classList.contains('has-active-score'),
    fontSize:parseFloat(getComputedStyle(document.querySelector('.intro h1')).fontSize),
  }));
  assert.equal(heroBefore.active,true);
  assert.ok(heroBefore.fontSize<=105,'Loaded workspace uses a compact hero instead of landing-sized type');
  const shortcuts=page.locator('.jwoo-quick-link');
  assert.deepEqual(await shortcuts.allTextContents(),['새 악보','파트','음표','마디','가사','코드','출력']);
  const unchangedRevision=Number(await page.locator('#score-container').getAttribute('data-render-revision'));
  await page.getByRole('button',{name:'모두 접기'}).click();
  assert.equal(await page.locator('#v4-lyrics-batch-text').isVisible(),false);
  await page.getByRole('button',{name:'가사 설정으로 이동'}).click();
  assert.equal(await page.locator('#v4-lyrics-batch-text').isVisible(),true);
  assert.equal(await page.locator('#v4-chord-input').isVisible(),false);
  await page.getByRole('button',{name:'코드 설정으로 이동'}).click();
  assert.equal(await page.locator('#v4-chord-input').isVisible(),true);
  await page.getByRole('button',{name:'출력 설정으로 이동'}).click();
  assert.equal(await page.locator('#v4-print-book').isVisible(),true);
  await page.getByRole('button',{name:'파트 설정으로 이동'}).click();
  assert.equal(await page.locator('#parts-list').isVisible(),true);
  assert.equal(Number(await page.locator('#score-container').getAttribute('data-render-revision')),
    unchangedRevision,'Inspector shortcuts never rewrite or re-render the score');
  await page.screenshot({path:output+'/ui-refinement-desktop.png'});
  console.log('BROWSER_STAGE=POLISHED_INSPECTOR_QUICK_ACCESS_AND_COPYRIGHT');

  await page.setViewportSize({width:390,height:844});
  const mobileUi=await page.evaluate(()=>{
    const quick=document.querySelector('.jwoo-quick-links');
    const copyright=document.querySelector('.footer-credit');
    return {quickWidth:quick.getBoundingClientRect().width,
      quickScrollWidth:quick.scrollWidth,
      copyright:getComputedStyle(copyright).fontSize,
      pageWidth:document.documentElement.clientWidth};
  });
  assert.ok(mobileUi.quickWidth<=mobileUi.pageWidth,'Shortcut bar fits the mobile layout');
  assert.ok(mobileUi.quickScrollWidth>=mobileUi.quickWidth,'Shortcut bar can scroll horizontally');
  assert.equal(await page.locator('.footer-credit').textContent(),'© 2026 PARKJAEWOO. All rights reserved.');
  await page.getByRole('button',{name:'새 악보 설정으로 이동'}).click();
  assert.equal(await page.locator('#v4-new').isVisible(),true);
  const newScoreScrollMargin=await page.locator('#v4-new')
    .evaluate(el=>parseFloat(getComputedStyle(el).scrollMarginTop));
  assert.ok(newScoreScrollMargin>=300,'The new-score shortcut must account for the mobile sticky preview');
  await page.screenshot({path:output+'/ui-refinement-mobile.png'});
  await page.setViewportSize({width:1440,height:1000});
  console.log('BROWSER_STAGE=POLISHED_MOBILE_NAVIGATION_AND_ENGLISH_CREDIT');


  // Functional 4.0 completion slice: the real browser must retain note timing
  // when re-barring written music, and produce exact non-3:2 MusicXML tuplets.
  await page.getByRole('button',{name:'모두 펼치기'}).click();
  const writtenScore='<?xml version="1.0" encoding="UTF-8"?>'+
    '<score-partwise version="4.0"><work><work-title>Written rebar</work-title></work>'+
    '<movement-title>Written rebar</movement-title>'+
    '<part-list><score-part id="P1"><part-name>Vocal</part-name></score-part></part-list>'+
    '<part id="P1"><measure number="1"><attributes><divisions>48</divisions>'+
    '<time><beats>4</beats><beat-type>4</beat-type></time>'+
    '<clef><sign>G</sign><line>2</line></clef></attributes>'+
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>96</duration><type>half</type></note>'+
    '<note><pitch><step>E</step><octave>4</octave></pitch><duration>96</duration><type>half</type></note>'+
    '</measure><measure number="2">'+
    '<note><pitch><step>G</step><octave>4</octave></pitch><duration>96</duration><type>half</type></note>'+
    '<note><pitch><step>B</step><octave>4</octave></pitch><duration>96</duration><type>half</type></note>'+
    '</measure></part></score-partwise>';
  await page.locator('#file-input').setInputFiles({name:'written-rebar.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(writtenScore)});
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('악보가 준비되었습니다.'),null,{timeout:30000});
  await page.selectOption('#v4-rebar-meter','3/4');
  page.once('dialog',dialog=>dialog.accept());
  await page.click('#v4-rebar-written');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('작성된 악보 전체 리바링 완료'),null,{timeout:30000});
  const rebarFile=page.waitForEvent('download');
  await page.click('#download-xml');
  const rebarText=await fs.readFile(await (await rebarFile).path(),'utf8');
  assert.equal((rebarText.match(/<measure number="/g)||[]).length,3);
  assert.equal((rebarText.match(/<tie type="start"\s*\/>/g)||[]).length,1);
  assert.equal((rebarText.match(/<tie type="stop"\s*\/>/g)||[]).length,1);
  assert.match(rebarText,/<beats>3<\/beats><beat-type>4<\/beat-type>/);
  assert.match(await page.locator('#score-info').textContent(),/3개 마디/);
  console.log('BROWSER_STAGE=V4_WRITTEN_NOTES_REBARRED_INTO_3_4');

  const chordRebarScore='<?xml version="1.0" encoding="utf-8"?>'+
    '<score-partwise version="4.0"><part-list><score-part id="P1">'+
    '<part-name>Vocal</part-name></score-part></part-list>'+
    '<part id="P1"><measure number="1">'+
    '<attributes><divisions>48</divisions><time><beats>4</beats>'+
    '<beat-type>4</beat-type></time><clef><sign>G</sign>'+
    '<line>2</line></clef></attributes>'+
    ['C','E','G'].map((step,i)=>'<note>'+
      (i?'<chord/>':'')+'<pitch><step>'+step+
      '</step><octave>4</octave></pitch><duration>192</duration>'+
      '<type>whole</type>'+
      (!i?'<lyric number="1"><text>반짝이는</text></lyric>':'')+
      '</note>').join('')+
    '</measure><measure number="2">'+
    ['D','F'].map((step,i)=>'<note>'+(i?'<chord/>':'')+
      '<pitch><step>'+step+'</step><octave>4</octave></pitch>'+
      '<duration>48</duration><type>quarter</type></note>').join('')+
    '<note><rest/><duration>96</duration><type>half</type></note>'+
    '<note><rest/><duration>48</duration><type>quarter</type></note>'+
    '</measure></part></score-partwise>';
  await page.locator('#file-input').setInputFiles({name:'chord-rebar.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(chordRebarScore)});
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('악보가 준비되었습니다.'),
    null,{timeout:30000});
  await page.selectOption('#v4-rebar-meter','3/4');
  page.once('dialog',dialog=>dialog.accept());
  await page.click('#v4-rebar-written');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('작성된 악보 전체 리바링 완료'),
    null,{timeout:30000});
  const chordRebarDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const chordRebarXml=await fs.readFile(await (await chordRebarDownload).path(),'utf8');
  assert.equal((chordRebarXml.match(/<measure number="/g)||[]).length,3);
  assert.equal((chordRebarXml.match(/<chord\s*\/>/g)||[]).length,5);
  assert.equal((chordRebarXml.match(/<tie type="start"\s*\/>/g)||[]).length,3);
  assert.equal((chordRebarXml.match(/<tie type="stop"\s*\/>/g)||[]).length,3);
  assert.match(chordRebarXml,/<text>반짝이는<\/text>/);
  assert.match(chordRebarXml,/<beats>3<\/beats><beat-type>4<\/beat-type>/);
  console.log('BROWSER_STAGE=V4_SIMULTANEOUS_CHORD_TONES_REBARRED_WITH_INDEPENDENT_TIES');


  const fiveToFour='<?xml version="1.0" encoding="utf-8"?><score-partwise version="4.0">'+
    '<part-list><score-part id="P1"><part-name>Vocal</part-name></score-part></part-list>'+
    '<part id="P1"><measure number="1"><attributes><divisions>48</divisions>'+
    '<time><beats>4</beats><beat-type>4</beat-type></time>'+
    '<clef><sign>G</sign><line>2</line></clef></attributes>'+
    ['C','D','E','F'].map(step=>'<note><pitch><step>'+step+'</step><octave>4</octave>'+
    '</pitch><duration>12</duration><type>16th</type></note>').join('')+
    '<note><rest/><duration>96</duration><type>half</type></note>'+
    '<note><rest/><duration>48</duration><type>quarter</type></note>'+
    '</measure></part></score-partwise>';
  await page.locator('#file-input').setInputFiles({name:'five-in-four.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(fiveToFour)});
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('악보가 준비되었습니다.'),null,{timeout:30000});
  await page.locator('#v3-events .v3-event').first().click();
  await page.selectOption('#v4-tuplet-ratio','5:4');
  await page.selectOption('#v4-tuplet-unit','16th');
  await page.selectOption('#v4-pro-step','G');
  await page.selectOption('#v4-pro-octave','4');
  await page.click('#v4-tuplet-author');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('잇단음 그룹 생성 완료'),null,{timeout:30000});
  const groupFile=page.waitForEvent('download');
  await page.click('#download-xml');
  const grouped=await fs.readFile(await (await groupFile).path(),'utf8');
  assert.match(grouped,/<divisions>240<\/divisions>/);
  assert.equal((grouped.match(/<actual-notes>5<\/actual-notes>/g)||[]).length,5);
  assert.equal((grouped.match(/<normal-notes>4<\/normal-notes>/g)||[]).length,5);
  assert.match(grouped,/<tuplet[^>]*type="start"/);
  assert.match(grouped,/<tuplet[^>]*type="stop"/);
  assert.match(grouped,/<step>G<\/step><octave>4<\/octave>/);
  console.log('BROWSER_STAGE=V4_EXACT_PENTUPLET_WITH_SCALED_DIVISIONS_AND_XML');
  await page.click('#v4-audit-run');
  await page.waitForFunction(()=>document.querySelector('#v4-audit-result')?.textContent?.includes('기본 음악 구조 검사 통과'),null,{timeout:30000});
  assert.match(await page.locator('#v4-audit-result').textContent(),/오류 0건/);
  console.log('BROWSER_STAGE=V4_NEW_TUPLET_MUSIC_XML_STRUCTURAL_AUDIT_CLEAN');

  const tupletTm='<time-modification><actual-notes>3</actual-notes>'+
    '<normal-notes>2</normal-notes><normal-type>eighth</normal-type></time-modification>';
  const tupletMixed='<?xml version="1.0" encoding="utf-8"?>'+
    '<score-partwise version="4.0"><part-list><score-part id="P1">'+
    '<part-name>Vocal</part-name></score-part></part-list><part id="P1">'+
    '<measure number="1"><attributes><divisions>48</divisions>'+
    '<time><beats>4</beats><beat-type>4</beat-type></time>'+
    '<clef><sign>G</sign><line>2</line></clef></attributes>'+
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration>'+
    '<type>eighth</type>'+tupletTm+
    '<notations><tuplet number="1" type="start"/></notations>'+
    '<lyric number="1"><text>별빛</text></lyric></note>'+
    '<note><rest/><duration>16</duration><type>eighth</type>'+tupletTm+'</note>'+
    '<note><pitch><step>D</step><octave>4</octave></pitch><duration>16</duration>'+
    '<type>eighth</type>'+tupletTm+
    '<notations><tuplet number="1" type="stop"/></notations></note>'+
    '<note><rest/><duration>144</duration><type>half</type><dot/></note>'+
    '</measure></part></score-partwise>';
  await page.locator('#file-input').setInputFiles({name:'tuplet-rest.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(tupletMixed)});
  await page.waitForFunction(()=>document.querySelectorAll('#v3-events .v3-event').length===4,
    null,{timeout:30000});
  await page.locator('#v3-events .v3-event').first().click();
  await page.fill('#v4-tuplet-pitches','E4 R G4');
  await page.click('#v4-tuplet-pitches-apply');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent
    ?.includes('기존 잇단음 그룹 음정 일괄 수정 완료'),null,{timeout:30000});
  const mixedExport=page.waitForEvent('download');
  await page.click('#download-xml');
  const mixedXml=await fs.readFile(await (await mixedExport).path(),'utf8');
  assert.match(mixedXml,/<step>E<\/step><octave>4<\/octave>/);
  assert.match(mixedXml,/<step>G<\/step><octave>4<\/octave>/);
  assert.equal((mixedXml.match(/<actual-notes>3<\/actual-notes>/g)||[]).length,3);
  assert.match(mixedXml,/<rest\s*\/><duration>16<\/duration><type>eighth<\/type>/);
  assert.match(mixedXml,/<text>별빛<\/text>/);
  console.log('BROWSER_STAGE=V4_MIXED_TUPLET_REST_AND_NOTES_EDIT_WITH_UNCHANGED_RHYTHM');

  const fullChord='<?xml version="1.0" encoding="utf-8"?><score-partwise version="4.0">'+
    '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>'+
    '<part id="P1"><measure number="1"><attributes><divisions>48</divisions>'+
    '<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>'+
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>48</duration><type>quarter</type></note>'+
    '<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>48</duration><type>quarter</type></note>'+
    '<note><rest/><duration>144</duration><type>half</type><dot/></note>'+
    '</measure></part></score-partwise>';
  await page.locator('#file-input').setInputFiles({name:'transpose-full-chord.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(fullChord)});
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('악보가 준비되었습니다.'),null,{timeout:30000});
  await page.locator('#v3-events .v3-event').nth(1).click();
  await page.fill('#v4-chord-semitones','2');
  await page.selectOption('#v4-chord-spelling','sharp');
  await page.click('#v4-chord-transpose');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('화음 전체 반음 이동 완료'),null,{timeout:30000});
  const transposeDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const shifted=await fs.readFile(await (await transposeDownload).path(),'utf8');
  assert.match(shifted,/<step>D<\/step><octave>4<\/octave>/);
  assert.match(shifted,/<step>F<\/step><alter>1<\/alter><octave>4<\/octave>/);
  assert.match(shifted,/<accidental>sharp<\/accidental>/);
  assert.match(shifted,/<rest\s*\/><duration>144<\/duration>/);
  console.log('BROWSER_STAGE=V4_WHOLE_CHORD_SEMITONE_SHIFT_AND_MUSICXML');



  // Two-staff polyphonic rebarring preserves every lane's measure clock.
  await page.locator('#file-input').setInputFiles({name:'piano-voice-rebar.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(crossbarScore)});
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('악보가 준비되었습니다.'),null,{timeout:30000});
  await page.selectOption('#v4-rebar-meter','3/4');
  page.once('dialog',dialog=>dialog.accept());
  await page.click('#v4-rebar-written');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('작성된 악보 전체 리바링 완료'),null,{timeout:30000});
  const polyRebarDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const polyRebarText=await fs.readFile(await (await polyRebarDownload).path(),'utf8');
  assert.equal((polyRebarText.match(/<measure number="/g)||[]).length,3);
  assert.equal((polyRebarText.match(/<backup><duration>144<\/duration><\/backup>/g)||[]).length,3);
  assert.ok((polyRebarText.match(/<tie type="start"\s*\/>/g)||[]).length>=1);
  assert.match(polyRebarText,/<staff>2<\/staff>/);
  assert.match(polyRebarText,/<beats>3<\/beats><beat-type>4<\/beat-type>/);
  assert.doesNotMatch(polyRebarText,/<backup><duration>192<\/duration><\/backup>/);
  console.log('BROWSER_STAGE=V4_MULTIVOICE_GRANDSTAFF_WRITTEN_REBAR');


  // New J-WOO 4.0 bar-block UI: actual Chromium click/serialize roundtrip.
  // This synthetic authored score is not real Logic certification.
  const fourBarScore='<?xml version="1.0" encoding="utf-8"?><score-partwise version="4.0">'+
    '<part-list><score-part id="P1"><part-name>Vocal</part-name></score-part></part-list>'+
    '<part id="P1">'+['C','D','E','F'].map((step,i)=>
      '<measure number="'+(i+1)+'">'+(i===0?
      '<attributes><divisions>48</divisions><key><fifths>0</fifths></key>'+
      '<time><beats>4</beats><beat-type>4</beat-type></time>'+
      '<clef><sign>G</sign><line>2</line></clef></attributes>':'')+
      '<note><pitch><step>'+step+'</step><octave>4</octave></pitch>'+
      '<duration>192</duration><type>whole</type></note></measure>').join('')+
    '</part></score-partwise>';
  await page.locator('#file-input').setInputFiles({name:'jwoo-block-actual-ui.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(fourBarScore)});
  await page.waitForFunction(()=>document.querySelectorAll('#jwoo-bar-strip .jwoo-bar-chip').length===4,
    null,{timeout:30000});
  assert.equal(await page.locator('#jwoo-bar-strip .jwoo-bar-chip').count(),4);
  await page.locator('#jwoo-bar-strip .jwoo-bar-chip').nth(1).click();
  await page.locator('#jwoo-measure-toolbar [data-act="copy"]').click();
  assert.match(await page.locator('#jwoo-block-status').textContent(),/복사했습니다/);
  await page.locator('#jwoo-bar-strip .jwoo-bar-chip').nth(3).click();
  await page.locator('#jwoo-measure-toolbar [data-act="paste"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('#jwoo-bar-strip .jwoo-bar-chip').length===5,
    null,{timeout:30000});
  assert.equal(await page.locator('#jwoo-bar-strip .jwoo-bar-chip').count(),5);
  console.log('BROWSER_STAGE=V4_DIRECT_MEASURE_COPY_PASTE');

  const partPdfZipDownload=page.waitForEvent('download',{timeout:60000});
  await page.click('#v4-part-pdf-zip');
  const pdfZip=await partPdfZipDownload;
  const vectorPartsZip=await JSZip.loadAsync(await fs.readFile(await pdfZip.path()));
  const pdfEntries=Object.keys(vectorPartsZip.files).filter(x=>x.endsWith('.pdf'));
  assert.equal(pdfEntries.length,1);
  const vectorPartPdfBytes=await vectorPartsZip.file(pdfEntries[0]).async('nodebuffer');
  assert.equal(vectorPartPdfBytes.subarray(0,5).toString(),'%PDF-');
  assert.ok(vectorPartPdfBytes.length>1000);
  assert.match(vectorPartPdfBytes.toString('latin1'),/\/Type\s*\/Page/);
  await fs.writeFile(output+'/vector-parts-english.pdf',vectorPartPdfBytes);
  console.log('BROWSER_STAGE=V4_LOCAL_VECTOR_PART_PDF_ZIP');

  await page.locator('#jwoo-measure-toolbar [data-act="duplicate"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('#jwoo-bar-strip .jwoo-bar-chip').length===6,
    null,{timeout:30000});
  await page.fill('#jwoo-range-from','2');
  await page.fill('#jwoo-range-to','3');
  await page.click('#jwoo-range-apply');
  assert.equal(await page.locator('#jwoo-bar-strip .jwoo-bar-chip.is-selected').count(),2);
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#jwoo-measure-toolbar [data-act="delete"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('#jwoo-bar-strip .jwoo-bar-chip').length===4,
    null,{timeout:30000});
  console.log('BROWSER_STAGE=V4_MEASURE_RANGE_DUPLICATE_DELETE');
  await page.locator('#jwoo-bar-strip .jwoo-bar-chip').nth(1).click();
  await page.locator('#v4-play-range').click();
  await page.waitForFunction(()=>document.querySelector('#v4-play-status')?.textContent?.includes('선택 마디'),
    null,{timeout:15000});
  await page.waitForFunction(()=>document.querySelector('#v4-playing-measure')?.textContent?.includes('2마디 재생 중'),
    null,{timeout:15000});
  assert.equal(await page.locator('#jwoo-bar-strip .jwoo-bar-chip.is-playing').count(),1);
  assert.equal(await page.locator('#jwoo-bar-strip .jwoo-bar-chip.is-playing').textContent(),'2');
  assert.equal(await page.locator('#score-container .jwoo-playback-active').count()>0,true);
  await page.locator('#v4-stop').click();
  await page.waitForFunction(()=>document.querySelectorAll('#jwoo-bar-strip .jwoo-bar-chip.is-playing').length===0,
    null,{timeout:15000});
  assert.equal(await page.locator('#score-container .jwoo-playback-active').count(),0);
  console.log('BROWSER_STAGE=V4_SELECTED_MEASURE_AUDITION');
  const rangeSave=page.waitForEvent('download');
  await page.locator('#download-xml').click();
  const rangeXml=await fs.readFile(await (await rangeSave).path(),'utf8');
  assert.equal((rangeXml.match(/<measure number="/g)||[]).length,4);
  assert.equal((rangeXml.match(/<part id="P1">/g)||[]).length,1);
  assert.match(rangeXml,/<step>F<\/step>/);
  console.log('BROWSER_STAGE=V4_BLOCK_EDIT_MUSIC_XML_SAVE');

  await page.fill('#v4-checkpoint-label','마디 편집 후 기준 시점');
  await page.click('#v4-checkpoint-save');
  await page.waitForFunction(()=>document.querySelector('#v4-checkpoint-status')?.textContent?.includes('복원 시점 저장 완료'),
    null,{timeout:15000});
  const recoveryId=await page.locator('#v4-checkpoint-select').inputValue();
  assert.ok(recoveryId.length>12);
  await page.locator('#jwoo-bar-strip .jwoo-bar-chip').nth(1).click();
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#jwoo-measure-toolbar [data-act="delete"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('#jwoo-bar-strip .jwoo-bar-chip').length===3,
    null,{timeout:30000});
  await page.locator('#v4-checkpoint-select').selectOption(recoveryId);
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#v4-checkpoint-restore').click();
  await page.waitForFunction(()=>document.querySelectorAll('#jwoo-bar-strip .jwoo-bar-chip').length===4,
    null,{timeout:30000});
  await page.waitForFunction(()=>document.querySelector('#v4-checkpoint-status')?.textContent?.includes('복원 완료'),null,{timeout:30000});
  assert.match(await page.locator('#v4-checkpoint-status').textContent(),/복원 완료/);
  console.log('BROWSER_STAGE=V4_MANUAL_CHECKPOINT_RESTORE');

  const portableDownload=page.waitForEvent('download',{timeout:30000});
  await page.click('#v4-project-export');
  const portablePath=await (await portableDownload).path();
  const portableFile=await fs.readFile(portablePath);
  const portableArchive=await JSZip.loadAsync(portableFile,{checkCRC32:true});
  const portableManifest=JSON.parse(await portableArchive.file('manifest.json').async('string'));
  assert.equal(portableManifest.format,'J-WOO-PROJECT');
  assert.equal(portableManifest.version,1);
  assert.equal(portableManifest.versions.length>=1,true);
  assert.equal((await portableArchive.file('score.musicxml').async('string')).includes('<score-partwise'),true);
  await page.locator('#jwoo-bar-strip .jwoo-bar-chip').nth(0).click();
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#jwoo-measure-toolbar [data-act="delete"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('#jwoo-bar-strip .jwoo-bar-chip').length===3,
    null,{timeout:30000});
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#v4-project-file').setInputFiles({
    name:'jwoo-recovery.jwoo',mimeType:'application/zip',buffer:portableFile
  });
  await page.waitForFunction(()=>document.querySelector('#v4-project-status')?.textContent?.includes('검증된 프로젝트 복원 완료'),
    null,{timeout:30000});
  assert.equal(await page.locator('#jwoo-bar-strip .jwoo-bar-chip').count(),4);
  assert.match(await page.locator('#v4-project-status').textContent(),/SHA-256 일치/);
  console.log('BROWSER_STAGE=V4_PORTABLE_PROJECT_ARCHIVE_RESTORED_WITH_HISTORY');

  await page.selectOption('#v4-add-voice-number','2');
  await page.selectOption('#v4-add-voice-staff','1');
  await page.click('#v4-add-voice');
  await page.waitForFunction(()=>document.querySelector('#v4-add-voice-status')?.textContent?.includes('2성부 생성 완료'),
    null,{timeout:30000});
  const voiceDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const voiceXml=await fs.readFile(await (await voiceDownload).path(),'utf8');
  assert.equal((voiceXml.match(/<voice>2<\/voice>/g)||[]).length,4);
  assert.equal((voiceXml.match(/<backup><duration>192<\/duration><\/backup>/g)||[]).length,4);
  assert.equal((voiceXml.match(/<rest\s*\/>/g)||[]).length,4);
  assert.equal((voiceXml.match(/<measure number="/g)||[]).length,4);
  console.log('BROWSER_STAGE=V4_INDEPENDENT_SECOND_VOICE_CREATED_WITHOUT_TIMING_SHIFT');





  const autoLayoutScore='<?xml version="1.0" encoding="utf-8"?><score-partwise version="4.0">'+
    '<part-list><score-part id="P1"><part-name>Vocal</part-name></score-part></part-list>'+
    '<part id="P1">'+Array.from({length:12},(_,i)=>
      '<measure number="'+(i+1)+'">'+(i===0?
      '<attributes><divisions>48</divisions><time><beats>4</beats>'+
      '<beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>':'')+
      Array.from({length:4},()=>'<note><pitch><step>C</step><octave>4</octave></pitch>'+
        '<duration>48</duration><type>quarter</type><lyric number="1"><text>반짝이는</text></lyric></note>').join('')+
      '</measure>').join('')+'</part></score-partwise>';
  await page.locator('#file-input').setInputFiles({name:'auto-layout-12bars.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(autoLayoutScore)});
  await page.waitForFunction(()=>document.querySelectorAll('#jwoo-bar-strip .jwoo-bar-chip').length===12,
    null,{timeout:30000});
  await page.click('#v4-auto-layout');
  await page.waitForFunction(()=>document.querySelector('#v4-auto-layout-status')?.textContent?.includes('자동 배치 적용'),
    null,{timeout:30000});
  const autoLayoutFile=page.waitForEvent('download');
  await page.click('#download-xml');
  const autoLayoutXml=await fs.readFile(await (await autoLayoutFile).path(),'utf8');
  assert.equal((autoLayoutXml.match(/<measure number="/g)||[]).length,12);
  assert.ok(/new-system="yes"|new-page="yes"/.test(autoLayoutXml));
  assert.equal((autoLayoutXml.match(/<text>반짝이는<\/text>/g)||[]).length,48);
  console.log('BROWSER_STAGE=V4_DENSITY_AWARE_AUTOMATIC_MUSICXML_LAYOUT');

  // Directly transpose a two-measure Korean-lyric passage in the real editor.
  await page.fill('#jwoo-range-from','2');
  await page.fill('#jwoo-range-to','3');
  await page.click('#jwoo-range-apply');
  await page.fill('#jwoo-transpose-semitones','2');
  await page.selectOption('#jwoo-transpose-spelling','sharp');
  await page.locator('#jwoo-measure-toolbar [data-act="transpose"]').click();
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('선택 구간 +2반음 이조 완료'),
    null,{timeout:30000});
  const shiftedPassageFile=page.waitForEvent('download');
  await page.click('#download-xml');
  const shiftedPassage=await fs.readFile(await (await shiftedPassageFile).path(),'utf8');
  const passageBars=[...shiftedPassage.matchAll(/<measure number="(\d+)"[^>]*>([\s\S]*?)<\/measure>/g)];
  assert.equal(passageBars.length,12);
  for(const [,number,content] of passageBars){
    const expected=Number(number)>=2&&Number(number)<=3?'D':'C';
    assert.equal((content.match(new RegExp('<step>'+expected+'</step>','g'))||[]).length,4);
  }
  assert.equal((shiftedPassage.match(/<text>반짝이는<\/text>/g)||[]).length,48);
  await page.click('#v3-undo');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('되돌리기 완료'),
    null,{timeout:30000});
  const undoPassageFile=page.waitForEvent('download');
  await page.click('#download-xml');
  const undoPassage=await fs.readFile(await (await undoPassageFile).path(),'utf8');
  assert.equal((undoPassage.match(/<step>D<\/step>/g)||[]).length,0);
  console.log('BROWSER_STAGE=V4_KOREAN_LYRIC_PASSAGE_TRANSPOSE_WITH_UNDO');


  await page.click('#v4-part-pdf-zip');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('한글·특수문자'),
    null,{timeout:30000});
  console.log('BROWSER_STAGE=V4_UNEMBEDDED_KOREAN_FONT_VECTOR_PDF_BLOCKED_SAFELY');

  await page.check('#v4-pdf-unicode-raster');
  const hybridPdfDownload=page.waitForEvent('download',{timeout:90000});
  await page.click('#v4-part-pdf-zip');
  const hybridZipFile=await hybridPdfDownload;
  const hybridZip=await JSZip.loadAsync(await fs.readFile(await hybridZipFile.path()));
  const hybridPdfEntries=Object.keys(hybridZip.files).filter(x=>x.endsWith('.pdf'));
  assert.equal(hybridPdfEntries.length,1);
  const hybridPdfBytes=await hybridZip.file(hybridPdfEntries[0]).async('nodebuffer');
  assert.equal(hybridPdfBytes.subarray(0,5).toString(),'%PDF-');
  assert.match(hybridPdfBytes.toString('latin1'),/\/Subtype\s*\/Image/);
  await fs.writeFile(output+'/hybrid-parts-korean.pdf',hybridPdfBytes);
  assert.match(await page.locator('#message').textContent(),/하이브리드/);
  console.log('BROWSER_STAGE=V4_KOREAN_HYBRID_VECTOR_STAFF_PNG_TEXT_PDF_ZIP');

  const extraScorePart='<part id="P2">'+Array.from({length:12},(_,i)=>
    '<measure number="'+(i+1)+'">'+(i===0?
    '<attributes><divisions>48</divisions><time><beats>4</beats><beat-type>4</beat-type></time>'+
    '<clef><sign>F</sign><line>4</line></clef></attributes>':'')+
    '<note><rest/><duration>192</duration><type>whole</type></note></measure>').join('')+'</part>';
  const combinedParts=autoLayoutScore.replace(
    '<part-list><score-part id="P1"><part-name>Vocal</part-name></score-part></part-list>',
    '<part-list><score-part id="P1"><part-name>Vocal</part-name></score-part>'+
    '<score-part id="P2"><part-name>Piano</part-name></score-part></part-list>')
    .replace('</score-partwise>',extraScorePart+'</score-partwise>');
  await page.locator('#file-input').setInputFiles({name:'independent-vocal-piano.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(combinedParts)});
  await page.waitForFunction(()=>document.querySelectorAll('#jwoo-bar-strip .jwoo-bar-chip').length===12,
    null,{timeout:30000});
  await page.click('#v4-part-layout');
  await page.waitForFunction(()=>document.querySelector('#v4-part-layout-status')?.textContent?.includes('악기 2파트'),
    null,{timeout:30000});
  const independentDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const independentXml=await fs.readFile(await (await independentDownload).path(),'utf8');
  const p1=independentXml.match(/<part id="P1">([\s\S]*?)<\/part>/)?.[1]||'';
  const p2=independentXml.match(/<part id="P2">([\s\S]*?)<\/part>/)?.[1]||'';
  const breakCount=part=>(part.match(/new-system="yes"|new-page="yes"/g)||[]).length;
  assert.equal((p1.match(/<measure number="/g)||[]).length,12);
  assert.equal((p2.match(/<measure number="/g)||[]).length,12);
  assert.ok(breakCount(p1)>breakCount(p2));
  assert.equal((p1.match(/<text>반짝이는<\/text>/g)||[]).length,48);
  console.log('BROWSER_STAGE=V4_INDEPENDENT_VOCAL_AND_PIANO_PART_LAYOUT');




  await page.locator('#jwoo-bar-strip .jwoo-bar-chip').nth(1).click();
  await page.locator('#jwoo-bar-strip .jwoo-bar-chip').nth(1).focus();
  assert.equal(await page.locator('#jwoo-bar-strip .jwoo-bar-chip.is-selected').count(),1);
  await page.keyboard.press('ControlOrMeta+c');
  await page.waitForFunction(()=>document.querySelector('#jwoo-block-status')?.textContent?.includes('복사했습니다'),null,{timeout:10000});
  await page.keyboard.press('ControlOrMeta+d');
  await page.waitForFunction(()=>document.querySelectorAll('#jwoo-bar-strip .jwoo-bar-chip').length===13,null,{timeout:30000});
  console.log('BROWSER_STAGE=V4_KEYBOARD_COPY_DUPLICATE_MEASURE');

  const harmonicScore=fourBarScore.replace(
    '<measure number="2"><note>',
    '<measure number="2"><harmony><root><root-step>C</root-step></root>'+
    '<kind text="maj7">major-seventh</kind>'+
    '<bass><bass-step>G</bass-step></bass></harmony><note>');
  await page.locator('#file-input').setInputFiles({name:'harmonic-passage.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(harmonicScore)});
  await page.waitForFunction(()=>document.querySelectorAll('#jwoo-bar-strip .jwoo-bar-chip').length===4,
    null,{timeout:30000});
  await page.fill('#jwoo-range-from','2');
  await page.fill('#jwoo-range-to','2');
  await page.click('#jwoo-range-apply');
  await page.fill('#jwoo-transpose-semitones','2');
  assert.equal(await page.locator('#jwoo-transpose-chords').isChecked(),true);
  await page.locator('#jwoo-measure-toolbar [data-act="transpose"]').click();
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('선택 구간 +2반음 이조 완료'),
    null,{timeout:30000});
  const chordSave=page.waitForEvent('download');
  await page.click('#download-xml');
  const movedChordXml=await fs.readFile(await (await chordSave).path(),'utf8');
  const bar2=movedChordXml.match(/<measure number="2">([\s\S]*?)<\/measure>/)?.[1]||'';
  assert.match(bar2,/<root-step>D<\/root-step>/);
  assert.match(bar2,/<bass-step>A<\/bass-step>/);
  assert.match(bar2,/<step>E<\/step><octave>4<\/octave>/);
  assert.match(bar2,/<kind text="maj7">major-seventh<\/kind>/);
  console.log('BROWSER_STAGE=V4_CHORD_AND_NOTE_SEMITONE_TRANSPOSE_TOGETHER');




  // Production bundles do not expose raw /src/*.js modules. Export is already
  // exercised above; destructive comparisons are covered by the Node suite.
  assert.match(await page.locator('#message').textContent(),/구조 검증 통과/);
  console.log('BROWSER_STAGE=V4_MUSICXML_EXPORT_ROUNDTRIP_GUARD');


  // Existing-score instrument management (not just a new-score template).
  await page.fill('#v4-new-title','파트 생성 통합 검증');
  await page.selectOption('#v4-new-template','melody');
  await page.selectOption('#v4-new-measures','4');
  page.once('dialog',dialog=>dialog.accept());
  await page.click('#v4-new');
  await page.waitForFunction(()=>document.querySelectorAll('#v3-part option').length===1,
    null,{timeout:30000});
  await page.fill('#v4-add-part-name','피아노 양손');
  await page.selectOption('#v4-add-part-type','piano');
  await page.click('#v4-add-part');
  await page.waitForFunction(()=>document.querySelector('#v4-add-part-status')?.textContent?.includes('파트 추가 완료'),
    null,{timeout:30000});
  assert.equal(await page.locator('#v3-part option').count(),2);
  assert.equal(await page.locator('#export-part option').count(),2);
  assert.equal(await page.locator('#parts-list input[data-part-id="P2"]').count(),1);
  const newPartXmlEvent=page.waitForEvent('download');
  await page.click('#download-xml');
  const newPartXml=await fs.readFile(await (await newPartXmlEvent).path(),'utf8');
  assert.equal((newPartXml.match(/<part id="P[0-9]+">/g)||[]).length,2);
  assert.match(newPartXml,/<staves>2<\/staves>/);
  assert.equal((newPartXml.match(/<backup><duration>192<\/duration><\/backup>/g)||[]).length,4);
  await page.click('#v3-undo');
  await page.waitForFunction(()=>document.querySelectorAll('#v3-part option').length===1&&
    document.querySelectorAll('#export-part option').length===1,null,{timeout:30000});
  console.log('BROWSER_STAGE=V4_ADD_PIANO_PART_AND_UNDO_WITH_SELECTOR_SYNC');


  // Direct advanced pitch edit of a written+sounding tie across barlines,
  // including Korean lyrics, slur markup, unrelated same-pitch reattacks and undo.
  const tiedPitchScore='<?xml version="1.0" encoding="utf-8"?>'+
    '<score-partwise version="4.0"><part-list>'+
    '<score-part id="P1"><part-name>Vocal</part-name></score-part></part-list>'+
    '<part id="P1"><measure number="1">'+
    '<attributes><divisions>48</divisions><key><fifths>0</fifths></key>'+
    '<time><beats>4</beats><beat-type>4</beat-type></time>'+
    '<clef><sign>G</sign><line>2</line></clef></attributes>'+
    '<note><rest/><duration>144</duration><type>half</type><dot/></note>'+
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>48</duration>'+
    '<tie type="start"/><type>quarter</type>'+
    '<notations><tied type="start"/><slur number="1" type="start"/></notations>'+
    '<lyric number="1"><syllabic>single</syllabic><text>반짝</text></lyric></note></measure>'+
    '<measure number="2"><note><pitch><step>C</step><octave>4</octave></pitch>'+
    '<duration>48</duration><tie type="stop"/><type>quarter</type>'+
    '<notations><tied type="stop"/><slur number="1" type="stop"/></notations></note>'+
    '<note><rest/><duration>144</duration><type>half</type><dot/></note></measure>'+
    '<measure number="3"><note><pitch><step>C</step><octave>4</octave></pitch>'+
    '<duration>192</duration><type>whole</type></note></measure></part></score-partwise>';
  await page.locator('#file-input').setInputFiles({name:'tied-vocal.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(tiedPitchScore)});
  await page.waitForFunction(()=>document.querySelectorAll('#jwoo-bar-strip .jwoo-bar-chip').length===3,
    null,{timeout:30000});
  await page.selectOption('#v3-measure','0');
  await page.locator('#v3-events .v3-event').nth(1).click();
  await page.selectOption('#v4-pro-step','D');
  await page.selectOption('#v4-pro-octave','4');
  await page.selectOption('#v4-pro-alter','0');
  await page.click('#v4-connected-pitch');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('붙임줄 연결 음표 전체 음정 변경 완료'),
    null,{timeout:30000});
  const tiedDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const tiedXml=await fs.readFile(await (await tiedDownload).path(),'utf8');
  const tiedBars=[...tiedXml.matchAll(/<measure number="(\d+)"[^>]*>([\s\S]*?)<\/measure>/g)];
  assert.equal(tiedBars.length,3);
  assert.match(tiedBars[0][2],/<step>D<\/step><octave>4<\/octave>/);
  assert.match(tiedBars[1][2],/<step>D<\/step><octave>4<\/octave>/);
  assert.match(tiedBars[2][2],/<step>C<\/step><octave>4<\/octave>/);
  assert.match(tiedBars[0][2],/<text>반짝<\/text>/);
  assert.match(tiedBars[0][2],/<tied type="start"/);
  assert.match(tiedBars[1][2],/<tied type="stop"/);
  assert.match(tiedBars[0][2],/<slur number="1" type="start"/);
  await page.click('#v3-undo');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('되돌리기 완료'),
    null,{timeout:30000});
  console.log('BROWSER_STAGE=V4_CROSSBAR_TIE_CHAIN_PITCH_CHANGE_AND_UNDO');

  await page.selectOption('#v3-measure','0');
  await page.locator('#v3-events .v3-event').nth(1).click();
  await page.selectOption('#v4-articulation-kind','accent');
  await page.click('#v4-articulation-toggle');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent
    ?.includes('아티큘레이션 기호 추가 / 해제 완료'),null,{timeout:30000});
  const articulationEvent=page.waitForEvent('download');
  await page.click('#download-xml');
  const tiedNoteArticulationXml=await fs.readFile(await (await articulationEvent).path(),'utf8');
  assert.match(tiedNoteArticulationXml,/<notations><tied type="start"\s*\/><slur number="1" type="start"\s*\/><articulations><accent\s*\/><\/articulations><\/notations>/);
  assert.match(tiedNoteArticulationXml,/<text>반짝<\/text>/);
  assert.match(tiedNoteArticulationXml,/<tie type="start"/);
  await page.click('#v3-undo');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('되돌리기 완료'),
    null,{timeout:30000});
  console.log('BROWSER_STAGE=V4_TIED_NOTE_ARTICULATION_WITH_KOREAN_LYRIC_UNDO');

  // Grace notes add no duration. The existing cross-bar tie, voice grid and
  // Korean lyric must survive the insert/delete cycle in the actual editor.
  await page.selectOption('#v3-measure','0');
  await page.locator('#v3-events .v3-event').nth(1).click();
  await page.selectOption('#v4-pro-step','F');
  await page.selectOption('#v4-pro-alter','1');
  await page.selectOption('#v4-pro-octave','5');
  await page.check('#v4-grace-slash');
  await page.click('#v4-grace-insert');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('꾸밈음 추가 완료'),
    null,{timeout:30000});
  const graceDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const graceXml=await fs.readFile(await (await graceDownload).path(),'utf8');
  assert.match(graceXml,/<grace slash="yes"\s*\/>/);
  assert.match(graceXml,/<pitch><step>F<\/step><alter>1<\/alter><octave>5<\/octave><\/pitch>/);
  assert.match(graceXml,/<text>반짝<\/text>/);
  assert.match(graceXml,/<tie type="start"/);
  await page.locator('#v3-events .v3-event').nth(1).click();
  await page.selectOption('#v4-pro-step','G');
  await page.selectOption('#v4-pro-alter','-1');
  await page.selectOption('#v4-pro-octave','4');
  await page.uncheck('#v4-grace-slash');
  await page.selectOption('#v4-grace-type','16th');
  await page.click('#v4-grace-edit');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent
    ?.includes('기존 꾸밈음 음정·기호 수정 완료'),null,{timeout:30000});
  const graceEditedEvent=page.waitForEvent('download');
  await page.click('#download-xml');
  const graceEditedXml=await fs.readFile(await (await graceEditedEvent).path(),'utf8');
  assert.match(graceEditedXml,/<grace slash="no"\s*\/>/);
  assert.match(graceEditedXml,/<pitch><step>G<\/step><alter>-1<\/alter><octave>4<\/octave><\/pitch>/);
  assert.match(graceEditedXml,/<type>16th<\/type><accidental>flat<\/accidental>/);
  assert.match(graceEditedXml,/<text>반짝<\/text>/);
  assert.match(graceEditedXml,/<tie type="start"/);
  console.log('BROWSER_STAGE=V4_REEDIT_EXISTING_GRACE_PITCH_SLASH_TYPE_NO_TIME_SHIFT');
  await page.locator('#v3-events .v3-event').nth(1).click();
  await page.click('#v4-grace-remove');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('꾸밈음 삭제 완료'),
    null,{timeout:30000});
  const cleanedDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const cleanedXml=await fs.readFile(await (await cleanedDownload).path(),'utf8');
  assert.doesNotMatch(cleanedXml,/<grace\b/);
  assert.match(cleanedXml,/<text>반짝<\/text>/);
  console.log('BROWSER_STAGE=V4_ZERO_TIME_GRACE_INSERT_DELETE_CROSSBAR_TIE_PRESERVED');

  await page.selectOption('#v3-measure','0');
  await page.locator('#v3-events .v3-event').nth(1).click();
  await page.selectOption('#v4-ornament-kind','trill-mark');
  await page.click('#v4-ornament-toggle');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent
    ?.includes('음악 장식 기호 추가 / 해제 완료'),null,{timeout:30000});
  const trillEvent=page.waitForEvent('download');
  await page.click('#download-xml');
  const trillXml=await fs.readFile(await (await trillEvent).path(),'utf8');
  assert.match(trillXml,/<ornaments><trill-mark\s*\/><\/ornaments>/);
  assert.match(trillXml,/<tied type="start"/);
  assert.match(trillXml,/<text>반짝<\/text>/);
  await page.click('#v3-undo');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent
    ?.includes('되돌리기 완료'),null,{timeout:30000});
  console.log('BROWSER_STAGE=V4_TRILL_ORNAMENT_WITH_VOCAL_TIE_UNDO');





  // A tiny originally synthesized TTF with Han/Geul glyphs validates actual
  // embedded Unicode vector text without shipping a proprietary font.
  const tinyLocalTTF='AAEAAAAKAIAAAwAgT1MvMkT9GlAAAAEoAAAAYGNtYXD9NYcYAAABlAAAAExnbHlmSbfnvgAAAewAAABOaGVhZGFiQ/YAAACsAAAANmhoZWEFSAH2AAAA5AAAACRobXR4ArwAlgAAAYgAAAAMbG9jYQAaADQAAAHgAAAADG1heHAABwAGAAABCAAAACBuYW1l0XA3DgAAAjwAAAE4cG9zdHTbyAoAAAN0AAAANQABAAAAAQAALhz75l8PPPUAAQPoAAAAAAAAAAAAAAAAAAAAAABGAEYCCALQAAAAAwACAAAAAAAAAAEAAAMg/zgAAAJYADIAZAH0AAEAAAAAAAAAAAAAAAAAAAABAAEAAAAFAAQAAQAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAwJYAZAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAQAAAAAAAAAAAAAAPz8/PwAAACDVXAMg/zgAAAMgAMgAAAAAAAAAAAAAAAAAAAAgAAACWAAyADIAMgAyADIAAAACAAAAAwAAABQAAwABAAAAFAAEADgAAAAKAAgAAgACACAAQa4A1Vz//wAAACAAQa4A1Vz////h/8FSBCqnAAEAAAAAAAAAAAAAAAAAAAAAAA0AGgAnAAEARgBGAggC0AADAAA3ESERRgHCRgKK/XYAAQBGAEYCCALQAAMAADcRIRFGAcJGAor9dgABAEYARgIIAtAAAwAANxEhEUYBwkYCiv12AAAAAAAKAH4AAQAAAAAAAQANAAAAAQAAAAAAAgAHAA0AAQAAAAAAAwANAAAAAQAAAAAABAAVABQAAQAAAAAABgAVACkAAwABBAkAAQAaAD4AAwABBAkAAgAOAFgAAwABBAkAAwAaAD4AAwABBAkABAAqAGYAAwABBAkABgAqAJBKV09PU3ludGhldGljUmVndWxhckpXT09TeW50aGV0aWMgUmVndWxhckpXT09TeW50aGV0aWMtUmVndWxhcgBKAFcATwBPAFMAeQBuAHQAaABlAHQAaQBjAFIAZQBnAHUAbABhAHIASgBXAE8ATwBTAHkAbgB0AGgAZQB0AGkAYwAgAFIAZQBnAHUAbABhAHIASgBXAE8ATwBTAHkAbgB0AGgAZQB0AGkAYwAtAFIAZQBnAHUAbABhAHIAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAAAAwAkAQIBAwNoYW4EZ2V1bAAAAA==';
  const oneBarHangul='<?xml version="1.0" encoding="utf-8"?>'+
    '<score-partwise version="4.0"><work><work-title>Test</work-title></work>'+
    '<part-list><score-part id="P1"><part-name>Vocal</part-name></score-part></part-list>'+
    '<part id="P1"><measure number="1">'+
    '<attributes><divisions>48</divisions><time><beats>4</beats><beat-type>4</beat-type></time>'+
    '<clef><sign>G</sign><line>2</line></clef></attributes>'+
    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>192</duration>'+
    '<type>whole</type><lyric number="1"><text>한글</text></lyric></note>'+
    '</measure></part></score-partwise>';
  await page.locator('#file-input').setInputFiles({name:'test-hangul.ttf-score.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(oneBarHangul)});
  await page.waitForFunction(()=>document.querySelectorAll('#jwoo-bar-strip .jwoo-bar-chip').length===1,
    null,{timeout:30000});
  await page.locator('#v4-pdf-local-font').setInputFiles({name:'synthetic.ttf',
    mimeType:'font/ttf',buffer:Buffer.from(tinyLocalTTF,'base64')});
  await page.uncheck('#v4-pdf-unicode-raster');
  const embeddedVectorZipEvent=page.waitForEvent('download',{timeout:90000});
  await page.click('#v4-part-pdf-zip');
  const embeddedVectorZip=await JSZip.loadAsync(
    await fs.readFile(await (await embeddedVectorZipEvent).path()));
  const embeddedEntries=Object.keys(embeddedVectorZip.files).filter(x=>x.endsWith('.pdf'));
  assert.equal(embeddedEntries.length,1);
  const embeddedBytes=await embeddedVectorZip.file(embeddedEntries[0]).async('nodebuffer');
  assert.match(embeddedBytes.toString('latin1'),/\/FontFile2\b/);
  assert.match(embeddedBytes.toString('latin1'),/\/ToUnicode\b/);
  assert.doesNotMatch(embeddedBytes.toString('latin1'),/\/Subtype\s*\/Image\b/);
  assert.match(await page.locator('#message').textContent(),/TTF 벡터 글자/);
  console.log('BROWSER_STAGE=V4_SYNTHETIC_KOREAN_TTF_EMBEDDED_VECTOR_PDF');


  // Real work: move a quarter note into another voice's full-bar rest.
  // Preserve 4/4 with the trailing dotted-half rest and Korean lyric.
  const voiceSwap='<?xml version="1.0" encoding="utf-8"?>'+
    '<score-partwise version="4.0"><part-list>'+
    '<score-part id="P1"><part-name>Vocal</part-name></score-part></part-list>'+
    '<part id="P1"><measure number="1">'+
    '<attributes><divisions>48</divisions><key><fifths>0</fifths></key>'+
    '<time><beats>4</beats><beat-type>4</beat-type></time>'+
    '<clef><sign>G</sign><line>2</line></clef></attributes>'+
    '<note><pitch><step>C</step><octave>4</octave></pitch>'+
    '<duration>48</duration><voice>1</voice><type>quarter</type>'+
    '<lyric number="1"><text>별빛</text></lyric></note>'+
    '<note><rest/><duration>144</duration><voice>1</voice><type>half</type><dot/></note>'+
    '<backup><duration>192</duration></backup>'+
    '<note><rest/><duration>192</duration><voice>2</voice><type>whole</type></note>'+
    '</measure></part></score-partwise>';
  await page.locator('#file-input').setInputFiles({name:'two-voice.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(voiceSwap)});
  await page.waitForFunction(()=>document.querySelectorAll('#v3-events .v3-event').length===3,
    null,{timeout:30000});
  await page.locator('#v3-events .v3-event').first().click();
  await page.selectOption('#v4-transfer-voice','2');
  await page.click('#v4-transfer-note');
  await page.waitForFunction(()=>document.querySelector('#v4-transfer-status')?.textContent?.includes('이동 완료'),
    null,{timeout:30000});
  const transferXmlEvent=page.waitForEvent('download');
  await page.click('#download-xml');
  const transferXML=await fs.readFile(await (await transferXmlEvent).path(),'utf8');
  assert.match(transferXML,/<note><rest\s*\/><duration>48<\/duration><voice>1<\/voice>/);
  assert.match(transferXML,/<note><pitch><step>C<\/step><octave>4<\/octave><\/pitch><duration>48<\/duration><voice>2<\/voice><type>quarter<\/type>/);
  assert.match(transferXML,/<text>별빛<\/text>/);
  assert.match(transferXML,/<note><rest\s*\/><duration>144<\/duration><voice>2<\/voice><type>half<\/type><dot\s*\/>/);
  assert.equal((transferXML.match(/<backup>/g)||[]).length,1);
  await page.click('#v3-undo');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('되돌리기 완료'),
    null,{timeout:30000});
  console.log('BROWSER_STAGE=V4_MOVE_NOTE_BETWEEN_VOICES_WITH_KOREAN_LYRIC_AND_UNDO');

  const secondBeatTransfer='<?xml version="1.0" encoding="utf-8"?>'+
    '<score-partwise version="4.0"><part-list>'+
    '<score-part id="P1"><part-name>Vocal</part-name></score-part></part-list>'+
    '<part id="P1"><measure number="1">'+
    '<attributes><divisions>48</divisions><time><beats>4</beats><beat-type>4</beat-type></time>'+
    '<clef><sign>G</sign><line>2</line></clef></attributes>'+
    '<note><rest/><duration>48</duration><voice>1</voice><type>quarter</type></note>'+
    '<note><pitch><step>G</step><octave>4</octave></pitch>'+
    '<duration>48</duration><voice>1</voice><type>quarter</type>'+
    '<lyric number="1"><text>달빛</text></lyric></note>'+
    '<note><rest/><duration>96</duration><voice>1</voice><type>half</type></note>'+
    '<backup><duration>192</duration></backup>'+
    '<note><rest/><duration>192</duration><voice>2</voice><type>whole</type></note>'+
    '</measure></part></score-partwise>';
  await page.locator('#file-input').setInputFiles({name:'beat-two-voice.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(secondBeatTransfer)});
  await page.waitForFunction(()=>document.querySelectorAll('#v3-events .v3-event').length===4,
    null,{timeout:30000});
  await page.locator('#v3-events .v3-event').nth(1).click();
  await page.selectOption('#v4-transfer-voice','2');
  await page.click('#v4-transfer-note');
  await page.waitForFunction(()=>document.querySelector('#v4-transfer-status')?.textContent?.includes('이동 완료'),
    null,{timeout:30000});
  const secondBeatXmlEvent=page.waitForEvent('download');
  await page.click('#download-xml');
  const secondBeatXml=await fs.readFile(await (await secondBeatXmlEvent).path(),'utf8');
  assert.match(secondBeatXml,/<note><rest\s*\/><duration>48<\/duration><voice>2<\/voice><type>quarter<\/type>/);
  assert.match(secondBeatXml,/<note><pitch><step>G<\/step><octave>4<\/octave><\/pitch><duration>48<\/duration><voice>2<\/voice><type>quarter<\/type>/);
  assert.match(secondBeatXml,/<note><rest\s*\/><duration>96<\/duration><voice>2<\/voice><type>half<\/type>/);
  assert.match(secondBeatXml,/<text>달빛<\/text>/);
  assert.equal((secondBeatXml.match(/<backup>/g)||[]).length,1);
  console.log('BROWSER_STAGE=V4_TRANSFER_MIDMEASURE_NOTE_INTO_SURROUNDING_RESTS');

  const fourNotePhrase='<?xml version="1.0" encoding="utf-8"?>'+
    '<score-partwise version="4.0"><part-list><score-part id="P1">'+
    '<part-name>Vocal</part-name></score-part></part-list><part id="P1">'+
    '<measure number="1"><attributes><divisions>48</divisions>'+
    '<time><beats>4</beats><beat-type>4</beat-type></time>'+
    '<clef><sign>G</sign><line>2</line></clef></attributes>'+
    ['C','D','E','F'].map((step,i)=>'<note><pitch><step>'+step+
      '</step><octave>4</octave></pitch><duration>48</duration>'+
      '<voice>1</voice><type>quarter</type>'+
      (i===1?'<lyric number="1"><text>별빛</text></lyric>':'')+
      '</note>').join('')+
    '<backup><duration>192</duration></backup>'+
    '<note><rest/><duration>192</duration><voice>2</voice><type>whole</type></note>'+
    '</measure></part></score-partwise>';
  await page.locator('#file-input').setInputFiles({name:'four-note-phrase.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(fourNotePhrase)});
  await page.waitForFunction(()=>document.querySelectorAll('#v3-events .v3-event').length===5,
    null,{timeout:30000});
  await page.locator('#v3-events .v3-event').first().click();
  await page.selectOption('#v4-transfer-voice','2');
  await page.fill('#v4-transfer-phrase-end','4');
  await page.click('#v4-transfer-phrase');
  await page.waitForFunction(()=>document.querySelector('#v4-transfer-phrase-status')?.textContent?.includes('이동 완료'),
    null,{timeout:30000});
  const phraseDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const phraseXML=await fs.readFile(await (await phraseDownload).path(),'utf8');
  assert.equal((phraseXML.match(/<voice>1<\/voice><type>quarter<\/type>/g)||[]).length,4);
  assert.equal((phraseXML.match(/<voice>2<\/voice><type>quarter<\/type>/g)||[]).length,4);
  for(const step of ['C','D','E','F'])
    assert.match(phraseXML,new RegExp('<step>'+step+'<\\/step><octave>4<\\/octave>'));
  assert.match(phraseXML,/<text>별빛<\/text>/);
  assert.equal((phraseXML.match(/<backup>/g)||[]).length,1);
  await page.click('#v3-undo');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('되돌리기 완료'),
    null,{timeout:30000});
  console.log('BROWSER_STAGE=V4_FOUR_NOTE_PHRASE_TRANSFERS_BETWEEN_VOICES_ATOMICALLY');

  const secondBar='<measure number="2">'+
    ['G','A'].map((step,i)=>'<note><pitch><step>'+step+
      '</step><octave>4</octave></pitch><duration>96</duration>'+
      '<voice>1</voice><type>half</type>'+
      (i===0?'<lyric number="1"><text>달빛</text></lyric>':'')+
      '</note>').join('')+
    '<backup><duration>192</duration></backup>'+
    '<note><rest/><duration>192</duration><voice>2</voice><type>whole</type></note>'+
    '</measure>';
  const twoBarPhrase=fourNotePhrase.replace('</measure></part></score-partwise>',
    '</measure>'+secondBar+'</part></score-partwise>');
  await page.locator('#file-input').setInputFiles({name:'two-bar-voice-phrase.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(twoBarPhrase)});
  await page.waitForFunction(()=>document.querySelectorAll('#jwoo-bar-strip .jwoo-bar-chip').length===2,
    null,{timeout:30000});
  await page.selectOption('#v3-measure','0');
  await page.locator('#v3-events .v3-event').first().click();
  await page.selectOption('#v4-transfer-voice','2');
  await page.fill('#v4-transfer-measures-end','2');
  await page.click('#v4-transfer-measures');
  await page.waitForFunction(()=>document.querySelector('#v4-transfer-measures-status')?.textContent?.includes('이동 완료'),
    null,{timeout:30000});
  const multiBarDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const multiBarXml=await fs.readFile(await (await multiBarDownload).path(),'utf8');
  assert.equal((multiBarXml.match(/<voice>2<\/voice><type>(?:quarter|half)<\/type>/g)||[]).length,6);
  assert.equal((multiBarXml.match(/<voice>1<\/voice><type>(?:quarter|half)<\/type>/g)||[]).length,6);
  assert.equal((multiBarXml.match(/<backup>/g)||[]).length,2);
  assert.match(multiBarXml,/<text>별빛<\/text>/);
  assert.match(multiBarXml,/<text>달빛<\/text>/);
  await page.click('#v3-undo');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('되돌리기 완료'),
    null,{timeout:30000});
  console.log('BROWSER_STAGE=V4_TWO_MEASURE_VOICE_PHRASE_TRANSFER_WITH_UNDO');

  // E06 scoped transposition: shift the selected melodic voice across bars,
  // retaining the independently timed accompaniment rests and Korean lyrics.
  await page.locator('#file-input').setInputFiles({
    name:'polyphonic-voice-transpose.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(twoBarPhrase)
  });
  await page.waitForFunction(()=>document.querySelectorAll('#jwoo-bar-strip .jwoo-bar-chip').length===2,
    null,{timeout:30000});
  await page.fill('#jwoo-range-from','1');
  await page.fill('#jwoo-range-to','2');
  await page.click('#jwoo-range-apply');
  await page.selectOption('#jwoo-transpose-scope','voice');
  await page.selectOption('#jwoo-transpose-voice','1');
  await page.fill('#jwoo-transpose-semitones','2');
  await page.selectOption('#jwoo-transpose-spelling','sharp');
  await page.click('#jwoo-measure-toolbar [data-act="transpose"]');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('이조 완료'),
    null,{timeout:30000});
  const scopedDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const scopedXml=await fs.readFile(await (await scopedDownload).path(),'utf8');
  assert.equal((scopedXml.match(/<voice>1<\/voice>/g)||[]).length,6);
  assert.equal((scopedXml.match(/<voice>2<\/voice>/g)||[]).length,2);
  assert.equal((scopedXml.match(/<backup>/g)||[]).length,2);
  assert.match(scopedXml,/<step>D<\/step><octave>4<\/octave>/);
  assert.match(scopedXml,/<step>F<\/step><alter>1<\/alter><octave>4<\/octave>/);
  assert.match(scopedXml,/<text>별빛<\/text>/);
  assert.match(scopedXml,/<text>달빛<\/text>/);
  assert.equal((scopedXml.match(/<rest\s*\/>/g)||[]).length,2);
  await page.click('#v3-undo');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('되돌리기 완료'),
    null,{timeout:30000});
  console.log('BROWSER_STAGE=V4_SCOPED_VOICE_TRANSPOSITION_AND_UNDO');

  // A multi-measure articulation batch is one undoable edit and preserves
  // the other voice's rests, the original lyrics and all rhythmic offsets.
  await page.locator('#file-input').setInputFiles({
    name:'polyphonic-articulation-batch.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(twoBarPhrase)
  });
  await page.waitForFunction(()=>document.querySelectorAll('#jwoo-bar-strip .jwoo-bar-chip').length===2,
    null,{timeout:30000});
  await page.fill('#jwoo-range-from','1');
  await page.fill('#jwoo-range-to','2');
  await page.click('#jwoo-range-apply');
  await page.selectOption('#jwoo-batch-articulation-kind','accent');
  await page.selectOption('#jwoo-batch-articulation-mode','add');
  await page.selectOption('#jwoo-batch-articulation-voice','1');
  await page.click('#jwoo-measure-toolbar [data-act="articulation"]');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('표현 기호 일괄 적용 완료'),
    null,{timeout:30000});
  const articulationDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const batchArticulationXml=await fs.readFile(await (await articulationDownload).path(),'utf8');
  assert.equal((batchArticulationXml.match(/<accent\s*\/>/g)||[]).length,6);
  assert.equal((batchArticulationXml.match(/<voice>2<\/voice>/g)||[]).length,2);
  assert.equal((batchArticulationXml.match(/<backup>/g)||[]).length,2);
  assert.match(batchArticulationXml,/<text>별빛<\/text>/);
  assert.match(batchArticulationXml,/<text>달빛<\/text>/);
  await page.click('#v3-undo');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('되돌리기 완료'),
    null,{timeout:30000});
  console.log('BROWSER_STAGE=V4_MULTI_MEASURE_ARTICULATION_BATCH_AND_UNDO');

  // Enharmonic-only edit: C#4 -> Db4 in the selected melodic voice, retaining
  // Korean lyrics and the other voice with no sounding-pitch transposition.
  const enharmonicSource=twoBarPhrase.replace(
    '<step>C</step><octave>4</octave>',
    '<step>C</step><alter>1</alter><octave>4</octave>');
  await page.locator('#file-input').setInputFiles({
    name:'enharmonic-vocal-score.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(enharmonicSource)
  });
  await page.waitForFunction(()=>document.querySelectorAll('#jwoo-bar-strip .jwoo-bar-chip').length===2,
    null,{timeout:30000});
  await page.fill('#jwoo-range-from','1');
  await page.fill('#jwoo-range-to','1');
  await page.click('#jwoo-range-apply');
  await page.selectOption('#jwoo-transpose-voice','1');
  await page.selectOption('#jwoo-transpose-spelling','flat');
  await page.click('#jwoo-measure-toolbar [data-act="respell"]');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('이명동음 표기 정리 완료'),
    null,{timeout:30000});
  const respellDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const enharmonicXML=await fs.readFile(await (await respellDownload).path(),'utf8');
  assert.match(enharmonicXML,/<step>D<\/step><alter>-1<\/alter><octave>4<\/octave>/);
  assert.doesNotMatch(enharmonicXML,/<step>C<\/step><alter>1<\/alter><octave>4<\/octave>/);
  assert.equal((enharmonicXML.match(/<voice>2<\/voice>/g)||[]).length,2);
  assert.match(enharmonicXML,/<text>별빛<\/text>/);
  await page.click('#v3-undo');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('되돌리기 완료'),
    null,{timeout:30000});
  console.log('BROWSER_STAGE=V4_ENHARMONIC_RESPPELLING_SAME_SOUNDING_PITCH');







  // Stage 1 direct graphical editing acceptance: chord root, polyphonic rest,
  // note-time movement and Delete are connected to the same undoable XML model.
  const s1Original=await fs.readFile('tests/fixtures/complex-voices-original.musicxml','utf8');
  const s1OldTail='<note><pitch><step>F</step><octave>3</octave></pitch><duration>12</duration><voice>2</voice><type>quarter</type><stem>down</stem><staff>2</staff></note>';
  const s1NewTail='<note><rest/><duration>12</duration><voice>2</voice><type>quarter</type><staff>2</staff></note>';
  const s1Xml=s1Original.replace(s1OldTail,s1NewTail);
  assert.notEqual(s1Xml,s1Original,'stage1 two-voice rest fixture must be constructed');
  await page.locator('#file-input').setInputFiles({
    name:'stage1-multi-staff-direct.musicxml',mimeType:'application/xml',
    buffer:Buffer.from(s1Xml)
  });
  await page.waitForFunction(()=>document.querySelectorAll('#v3-events .v3-event').length===11,
    null,{timeout:30000});
  const s1Targets=page.locator('#score-container .jwoo-note-target');
  const s1TargetCount=await s1Targets.count();
  let selectedChord=false;
  for(let i=0;i<Math.min(s1TargetCount,8);i++){
    const target=s1Targets.nth(i);
    await target.focus();
    await target.press('Enter');
    const label=await page.locator('#v3-advanced-report').textContent();
    if(label?.includes('화음 구성 음')){selectedChord=true;break;}
  }
  assert.ok(selectedChord,'a rendered chord tone must be directly selectable on the SVG');
  console.log('BROWSER_STAGE=STAGE1_CHORD_HEAD_DIRECT_SELECTION');
  await page.locator('#v3-events .v3-event').first().click();
  assert.equal(await page.locator('#v3-chord-remove').isDisabled(),false,
    'chord root is removable with safe promotion');
  await page.click('#v3-chord-remove');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('화음 구성 음 삭제 완료'),
    null,{timeout:30000});
  assert.equal(await page.locator('#v3-events .v3-event').count(),10);
  await page.click('#v3-undo');
  await page.waitForFunction(()=>document.querySelector('#v3-events')?.querySelectorAll('.v3-event').length===11,
    null,{timeout:30000});
  console.log('BROWSER_STAGE=STAGE1_CHORD_ROOT_REMOVE_AND_UNDO');

  const s1Rest=page.locator('#score-container .jwoo-rest-target').first();
  await s1Rest.waitFor({state:'visible',timeout:30000});
  await s1Rest.focus();
  await s1Rest.press('Enter');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('선택 쉼표에 성부 보존 음표 삽입 완료'),
    null,{timeout:30000});
  const s1InsertDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const s1Inserted=await fs.readFile(await (await s1InsertDownload).path(),'utf8');
  assert.ok(s1Inserted.includes('<voice>2</voice>'),'inserted note preserves the second voice');
  assert.doesNotMatch(s1Inserted,/<note><rest\/><duration>12<\/duration><voice>2<\/voice><type>quarter<\/type><staff>2<\/staff><\/note>/);
  await page.click('#v3-undo');
  await page.waitForFunction(()=>document.querySelectorAll('#score-container .jwoo-rest-target').length>0,
    null,{timeout:30000});
  console.log('BROWSER_STAGE=STAGE1_SVG_REST_ENTER_INSERT_AND_UNDO');

  await page.locator('#v3-events .v3-event').nth(9).click();
  assert.equal(await page.locator('#v3-move').isDisabled(),false);
  await page.fill('#v3-target-beat','4');
  await page.click('#v3-move');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('선택 음표 박자 위치 이동 완료'),
    null,{timeout:30000});
  await page.click('#v3-undo');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('되돌리기 완료'),
    null,{timeout:30000});
  console.log('BROWSER_STAGE=STAGE1_SECOND_VOICE_TIME_MOVE_AND_UNDO');

  const s1SecondVoice=page.locator('#score-container .jwoo-note-target[aria-label*="2성부"]').first();
  await s1SecondVoice.waitFor({state:'visible',timeout:30000});
  await s1SecondVoice.focus();
  await s1SecondVoice.press('Delete');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('선택 성부 음표를 쉼표로 변경 완료'),
    null,{timeout:30000});
  await page.click('#v3-undo');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('되돌리기 완료'),
    null,{timeout:30000});
  const s1FinalDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const s1Final=await fs.readFile(await (await s1FinalDownload).path(),'utf8');
  assert.equal((s1Final.match(/<voice>2<\/voice>/g)||[]).length,4);
  assert.ok(s1Final.includes(s1NewTail),'undo must restore original second-voice rest');
  await page.locator('#file-input').setInputFiles({
    name:'stage1-roundtrip.musicxml',mimeType:'application/xml',buffer:Buffer.from(s1Final)
  });
  await page.waitForFunction(()=>document.querySelectorAll('#v3-events .v3-event').length===11,
    null,{timeout:30000});
  assert.ok((await page.locator('#v3-events .v3-event').last().textContent()).includes('𝄽'),
    'exported score re-import retains second-voice rest');
  console.log('BROWSER_STAGE=STAGE1_SVG_DELETE_UNDO_AND_XML_ROUNDTRIP');


  // Stage 2 actual Chromium UI -> MusicXML -> Undo -> import, with two voices.
  const s2Note=(step,duration,type,voice,staff)=>'<note><pitch><step>'+step+
    '</step><octave>'+(staff===2?'3':'4')+'</octave></pitch><duration>'+duration+
    '</duration><voice>'+voice+'</voice><type>'+type+'</type><staff>'+staff+'</staff></note>';
  const s2Rest=(duration,type,voice,staff)=>'<note><rest/><duration>'+duration+
    '</duration><voice>'+voice+'</voice><type>'+type+'</type><staff>'+staff+'</staff></note>';
  const s2Start='<?xml version="1.0"?><score-partwise version="4.0"><part-list>'+
    '<score-part id="P1"><part-name>Piano</part-name></score-part></part-list>'+
    '<part id="P1"><measure number="1"><attributes><divisions>48</divisions>'+
    '<time><beats>4</beats><beat-type>4</beat-type></time>'+
    '<staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef>'+
    '<clef number="2"><sign>F</sign><line>4</line></clef></attributes>';
  const s2Xml=s2Start+s2Note('C',24,'eighth',1,1)+s2Note('E',24,'eighth',1,1)+
    s2Rest(144,'half',1,1).replace('<type>half</type>','<type>half</type><dot/>')+
    '<backup><duration>192</duration></backup>'+
    s2Note('C',48,'quarter',2,2)+s2Rest(48,'quarter',2,2)+
    s2Note('G',96,'half',2,2)+'</measure></part></score-partwise>';
  await page.locator('#file-input').setInputFiles({name:'stage2-polyphonic.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(s2Xml)});
  await page.waitForFunction(()=>document.querySelectorAll('#v3-events .v3-event').length===6,
    null,{timeout:30000});
  await page.locator('#v3-events .v3-event').first().click();
  await page.fill('#v4-rhythm-group-end','2');
  await page.fill('#v4-rhythm-group-types','eighth-dotted,16th');
  await page.click('#v4-rhythm-group-apply');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('성부별 음표·화음 리듬 재분배 완료'),
    null,{timeout:30000});
  const s2Export=page.waitForEvent('download');
  await page.click('#download-xml');
  const s2Changed=await fs.readFile(await (await s2Export).path(),'utf8');
  assert.match(s2Changed,/<step>C<\/step><octave>4<\/octave><\/pitch><duration>36<\/duration>/);
  assert.match(s2Changed,/<step>E<\/step><octave>4<\/octave><\/pitch><duration>12<\/duration>/);
  assert.match(s2Changed,/<backup><duration>192<\/duration><\/backup>/);
  assert.match(s2Changed,/<step>C<\/step><octave>3<\/octave><\/pitch><duration>48<\/duration>/);
  await page.click('#v3-undo');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('되돌리기 완료'),
    null,{timeout:30000});
  console.log('BROWSER_STAGE=STAGE2_POLYPHONIC_RHYTHM_AND_UNDO');

  await page.selectOption('#v4-tuplet-ratio','3:2');
  await page.selectOption('#v4-tuplet-unit','eighth');
  await page.click('#v4-tuplet-author');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('잇단음'),
    null,{timeout:30000});
  await page.locator('#v3-events .v3-event').first().click();
  await page.fill('#v4-tuplet-rhythm-types','quarter,16th,16th');
  await page.click('#v4-tuplet-rhythm-apply');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('잇단음 그룹 리듬 구조 변경 완료'),
    null,{timeout:30000});
  const s2TuExport=page.waitForEvent('download');
  await page.click('#download-xml');
  const s2TuXml=await fs.readFile(await (await s2TuExport).path(),'utf8');
  assert.match(s2TuXml,/<duration>32<\/duration><voice>1<\/voice><type>quarter<\/type>/);
  assert.match(s2TuXml,/<duration>8<\/duration><voice>1<\/voice><type>16th<\/type>/);
  assert.match(s2TuXml,/<actual-notes>3<\/actual-notes><normal-notes>2<\/normal-notes>/);
  await page.click('#v3-undo');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('되돌리기 완료'),
    null,{timeout:30000});
  const s2UndoExport=page.waitForEvent('download');
  await page.click('#download-xml');
  const s2Undone=await fs.readFile(await (await s2UndoExport).path(),'utf8');
  assert.match(s2Undone,/<duration>16<\/duration><voice>1<\/voice><type>eighth<\/type>/);
  await page.locator('#file-input').setInputFiles({name:'stage2-tupler-roundtrip.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(s2TuXml)});
  await page.waitForFunction(()=>document.querySelectorAll('#v3-events .v3-event').length===7,
    null,{timeout:30000});
  console.log('BROWSER_STAGE=STAGE2_TUPLET_RHYTHM_UNDO_AND_MUSICXML_REIMPORT');


  // Stage 3: compose a mixed note stack in the real Chromium UI, then toggle
  // each expression independently. Confirm original tie, slur, multiple lyrics
  // and cross-bar continuation survive every isolated edit and MusicXML roundtrip.
  await page.locator('#file-input').setInputFiles({name:'stage3-tied-vocal.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(tiedPitchScore)});
  await page.waitForFunction(()=>document.querySelectorAll('#v3-events .v3-event').length===2,
    null,{timeout:30000});
  await page.selectOption('#v3-measure','0');
  await page.locator('#v3-events .v3-event').nth(1).click();
  await page.selectOption('#v4-articulation-kind','accent');
  await page.click('#v4-articulation-toggle');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent
    ?.includes('아티큘레이션 기호 추가 / 해제 완료'),null,{timeout:30000});
  await page.selectOption('#v4-ornament-kind','trill-mark');
  await page.click('#v4-ornament-toggle');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent
    ?.includes('음악 장식 기호 추가 / 해제 완료'),null,{timeout:30000});
  await page.fill('#v4-lyric-verse','2');
  await page.fill('#v4-lyric-text','Together');
  await page.click('#v4-lyric-set');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent
    ?.includes('가사 입력·교체 완료'),null,{timeout:30000});
  const stage3Export=page.waitForEvent('download');
  await page.click('#download-xml');
  const stage3Xml=await fs.readFile(await (await stage3Export).path(),'utf8');
  assert.match(stage3Xml,/<notations><tied type="start"\s*\/><slur number="1" type="start"\s*\/><ornaments><trill-mark\s*\/><\/ornaments><articulations><accent\s*\/><\/articulations><\/notations>/);
  assert.match(stage3Xml,/<lyric number="1"><syllabic>single<\/syllabic><text>반짝<\/text><\/lyric>/);
  assert.match(stage3Xml,/<lyric number="2"><syllabic>single<\/syllabic><text>Together<\/text><\/lyric>/);
  console.log('BROWSER_STAGE=STAGE3_COMPLEX_TIE_SLUR_TRILL_ACCENT_TWO_VERSES');

  await page.locator('#v3-events .v3-event').nth(1).click();
  await page.click('#v4-articulation-toggle');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent
    ?.includes('아티큘레이션 기호 추가 / 해제 완료'),null,{timeout:30000});
  const stage3NoAccent=page.waitForEvent('download');
  await page.click('#download-xml');
  const stage3NoAccentXml=await fs.readFile(await (await stage3NoAccent).path(),'utf8');
  assert.doesNotMatch(stage3NoAccentXml,/<articulations><accent\s*\/><\/articulations>/);
  assert.match(stage3NoAccentXml,/<ornaments><trill-mark\s*\/><\/ornaments>/);
  assert.match(stage3NoAccentXml,/<text>반짝<\/text>/);
  assert.match(stage3NoAccentXml,/<text>Together<\/text>/);
  assert.match(stage3NoAccentXml,/<tied type="start"/);
  await page.click('#v3-undo');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('되돌리기 완료'),
    null,{timeout:30000});
  console.log('BROWSER_STAGE=STAGE3_ISOLATED_ARTICULATION_TOGGLE_AND_UNDO');

  await page.selectOption('#v3-measure','0');
  await page.locator('#v3-events .v3-event').nth(1).click();
  await page.selectOption('#v4-slur-next-measure','1');
  await page.fill('#v4-pro-end','1');
  await page.click('#v4-pro-slur');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent
    ?.includes('이음줄 추가·해제 완료'),null,{timeout:30000});
  const stage3NoSlur=page.waitForEvent('download');
  await page.click('#download-xml');
  const stage3NoSlurXml=await fs.readFile(await (await stage3NoSlur).path(),'utf8');
  assert.doesNotMatch(stage3NoSlurXml,/<slur\b/);
  assert.match(stage3NoSlurXml,/<tied type="start"/);
  assert.match(stage3NoSlurXml,/<articulations><accent\s*\/><\/articulations>/);
  assert.match(stage3NoSlurXml,/<ornaments><trill-mark\s*\/><\/ornaments>/);
  await page.click('#v3-undo');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('되돌리기 완료'),
    null,{timeout:30000});
  console.log('BROWSER_STAGE=STAGE3_CROSSBAR_SLUR_TOGGLE_PRESERVES_TIE_LYRICS');

  await page.selectOption('#v3-measure','0');
  await page.locator('#v3-events .v3-event').nth(1).click();
  await page.selectOption('#v4-tie-next-measure','1');
  await page.fill('#v4-pro-end','1');
  await page.click('#v4-tie-toggle');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent
    ?.includes('붙임줄 연결'),null,{timeout:30000});
  const stage3NoTie=page.waitForEvent('download');
  await page.click('#download-xml');
  const stage3NoTieXml=await fs.readFile(await (await stage3NoTie).path(),'utf8');
  assert.doesNotMatch(stage3NoTieXml,/<tie type="(?:start|stop)"/);
  assert.match(stage3NoTieXml,/<slur number="1" type="start"/);
  assert.match(stage3NoTieXml,/<ornaments><trill-mark\s*\/><\/ornaments>/);
  assert.match(stage3NoTieXml,/<text>Together<\/text>/);
  await page.click('#v3-undo');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('되돌리기 완료'),
    null,{timeout:30000});
  console.log('BROWSER_STAGE=STAGE3_SOUNDING_TIE_TOGGLE_PRESERVES_SLUR_AND_EXPRESSIONS');

  await page.selectOption('#v3-measure','0');
  await page.locator('#v3-events .v3-event').nth(1).click();
  await page.fill('#v4-lyric-verse','1');
  await page.fill('#v4-lyric-text','우리');
  await page.click('#v4-lyric-set');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('가사 입력·교체 완료'),
    null,{timeout:30000});
  const stage3LyricEdited=page.waitForEvent('download');
  await page.click('#download-xml');
  const stage3Edited=await fs.readFile(await (await stage3LyricEdited).path(),'utf8');
  assert.match(stage3Edited,/<lyric number="1">[\s\S]*?<text>우리<\/text>/);
  assert.match(stage3Edited,/<lyric number="2">[\s\S]*?<text>Together<\/text>/);
  assert.match(stage3Edited,/<articulations><accent\s*\/><\/articulations>/);
  assert.match(stage3Edited,/<ornaments><trill-mark\s*\/><\/ornaments>/);
  await page.click('#v3-undo');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('되돌리기 완료'),
    null,{timeout:30000});
  const stage3Restored=page.waitForEvent('download');
  await page.click('#download-xml');
  const stage3RestoredXml=await fs.readFile(await (await stage3Restored).path(),'utf8');
  assert.equal(stage3RestoredXml,stage3Xml,'undo must restore the exact stacked notation');
  await page.locator('#file-input').setInputFiles({name:'stage3-complex-roundtrip.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(stage3Xml)});
  await page.waitForFunction(()=>document.querySelectorAll('#v3-events .v3-event').length===2,
    null,{timeout:30000});
  const stage3Roundtrip=page.waitForEvent('download');
  await page.click('#download-xml');
  const stage3Reimported=await fs.readFile(await (await stage3Roundtrip).path(),'utf8');
  // The import/export normalizer may remove the newline between the XML
  // declaration and score root. Compare the XML content, not header spacing.
  const normalizeStage3Xml=xml=>xml.replace(/>\s+</g,'><');
  assert.equal(normalizeStage3Xml(stage3Reimported),normalizeStage3Xml(stage3Xml),
    'real MusicXML reimport keeps all expressions');
  console.log('BROWSER_STAGE=STAGE3_LYRICS_INDEPENDENT_EDIT_UNDO_REIMPORT');

  // Stage 4: a manually authored page break is a hard boundary, not an
  // exception or permission to erase the composer's layout instructions.
  // Render the real, expression-dense Korean vocal part through the same
  // SVG print path used by PDF export. Known lyric/notehead/articulation
  // collisions and page overflow now block export rather than ship bad pages.
  await page.locator('#file-input').setInputFiles({name:'stage4-expression-print.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(stage3Xml)});
  await page.waitForFunction(()=>document.querySelectorAll('#jwoo-bar-strip .jwoo-bar-chip').length===3,
    null,{timeout:30000});
  const stage4PrintEvent=page.waitForEvent('download');
  await page.click('#v4-part-svg-zip');
  const stage4PrintZip=await JSZip.loadAsync(
    await fs.readFile(await (await stage4PrintEvent).path()));
  const stage4SvgFile=Object.keys(stage4PrintZip.files).find(name=>name.endsWith('.svg'));
  assert.ok(stage4SvgFile,'rendered vocal part must have a vector SVG page');
  const stage4SvgSource=await stage4PrintZip.file(stage4SvgFile).async('string');
  assert.match(stage4SvgSource,/<svg\b/);
  assert.match(await page.locator('#message').textContent(),/SVG.*ZIP 저장 완료/);
  console.log('BROWSER_STAGE=STAGE4_COMPLEX_KOREAN_VOCAL_VECTOR_PRINT_NO_KNOWN_COLLISION');

  const stage4Manual=combinedParts.replace('<measure number="7">',
    '<measure number="7"><print new-page="yes"/>');
  assert.notEqual(stage4Manual,combinedParts);
  await page.locator('#file-input').setInputFiles({name:'stage4-manual-page.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(stage4Manual)});
  await page.waitForFunction(()=>document.querySelectorAll('#jwoo-bar-strip .jwoo-bar-chip').length===12,
    null,{timeout:30000});
  await page.uncheck('#v4-cadence-replace');
  await page.click('#v4-auto-layout');
  await page.waitForFunction(()=>document.querySelector('#v4-auto-layout-status')?.textContent?.includes('자동 배치 적용'),
    null,{timeout:30000});
  const stage4FullDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const stage4FullXml=await fs.readFile(await (await stage4FullDownload).path(),'utf8');
  for(const partId of ['P1','P2']){
    const body=stage4FullXml.match(new RegExp('<part id="'+partId+'">([\\s\\S]*?)<\\/part>'))?.[1];
    assert.ok(body,'full score contains synchronized '+partId);
    const forced=body.match(/<measure number="7"[^>]*>([\s\S]*?)<\/measure>/)?.[1];
    assert.match(forced,/<print new-page="yes"/,
      'authored manual page boundary must survive in '+partId);
  }
  await page.click('#v3-undo');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('되돌리기 완료'),
    null,{timeout:30000});
  const stage4UndoDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const stage4Undone=await fs.readFile(await (await stage4UndoDownload).path(),'utf8');
  assert.equal((stage4Undone.match(/<print new-page="yes"/g)||[]).length,1);
  console.log('BROWSER_STAGE=STAGE4_MANUAL_PAGE_BREAK_PRESERVED_ACROSS_FULL_SCORE_AND_UNDO');

  const stage4Individual=combinedParts.replace(
    /(<part id="P2">[\s\S]*?<measure number="8">)/,
    '$1<print new-page="yes"/>');
  await page.locator('#file-input').setInputFiles({name:'stage4-part-page.musicxml',
    mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(stage4Individual)});
  await page.waitForFunction(()=>document.querySelectorAll('#jwoo-bar-strip .jwoo-bar-chip').length===12,
    null,{timeout:30000});
  await page.uncheck('#v4-cadence-replace');
  await page.click('#v4-part-layout');
  await page.waitForFunction(()=>document.querySelector('#v4-part-layout-status')?.textContent?.includes('악기 2파트'),
    null,{timeout:30000});
  const stage4PartsDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const stage4PartsXml=await fs.readFile(await (await stage4PartsDownload).path(),'utf8');
  const stage4Piano=stage4PartsXml.match(/<part id="P2">([\s\S]*?)<\/part>/)?.[1];
  assert.match(stage4Piano.match(/<measure number="8"[^>]*>([\s\S]*?)<\/measure>/)?.[1],
    /<print new-page="yes"/);
  assert.equal((stage4PartsXml.match(/<text>반짝이는<\/text>/g)||[]).length,48);
  console.log('BROWSER_STAGE=STAGE4_INDEPENDENT_PART_HARD_PAGE_BREAK_AND_LYRICS');

  const stage4SvgView=page.locator('#score-container svg').first();
  await stage4SvgView.waitFor({state:'visible',timeout:30000});
  const stage4Bounds=await stage4SvgView.evaluate(svg=>{
    const view=svg.viewBox.baseVal;
    const box=svg.getBBox();
    return {viewWidth:view.width,viewHeight:view.height,
      glyphWidth:box.width,glyphHeight:box.height};
  });
  assert.ok(stage4Bounds.viewWidth>0&&stage4Bounds.viewHeight>0);
  assert.ok(stage4Bounds.glyphWidth>0&&stage4Bounds.glyphHeight>0);
  console.log('BROWSER_STAGE=STAGE4_REAL_RENDERED_PAGE_BOUNDS_MEASURED');

  const assertStage5A4=(pdfBytes,w,h,label)=>{
    const metadata=pdfBytes.toString('latin1');
    const matches=[...metadata.matchAll(/\/MediaBox\s*\[\s*([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s*\]/g)];
    assert.ok(matches.length>0,label+' must contain A4 MediaBox metadata');
    for(const [,x1,y1,x2,y2] of matches){
      assert.ok(Math.abs(Number(x1))<.1&&Math.abs(Number(y1))<.1&&
        Math.abs(Number(x2)-w)<.6&&Math.abs(Number(y2)-h)<.6,
        label+' must preserve the correct physical A4 dimensions');
    }
  };

  // Stage 5: score + every independent part must be downloadable as genuine,
  // non-raster A4 PDF pages in one deterministic ZIP. The legacy part-only
  // export stays available without changing its file naming or behavior.
  const stage5English=combinedParts.replaceAll('반짝이는','Verse');
  await page.locator('#file-input').setInputFiles({
    name:'stage5-english-duo.musicxml',mimeType:'application/vnd.recordare.musicxml+xml',
    buffer:Buffer.from(stage5English)
  });
  await page.waitForFunction(()=>document.querySelectorAll('#jwoo-bar-strip .jwoo-bar-chip').length===12,
    null,{timeout:30000});
  await page.locator('#v4-pdf-local-font').setInputFiles([]);
  await page.uncheck('#v4-pdf-unicode-raster');
  const stage5AllEvent=page.waitForEvent('download',{timeout:120000});
  await page.click('#v4-score-parts-pdf-zip');
  const stage5AllDownload=await stage5AllEvent;
  assert.match(stage5AllDownload.suggestedFilename(),/-full-score-and-parts-pdfs\.zip$/);
  const stage5AllZip=await JSZip.loadAsync(
    await fs.readFile(await stage5AllDownload.path()));
  const stage5PdfNames=Object.keys(stage5AllZip.files).filter(n=>n.endsWith('.pdf')).sort();
  assert.deepEqual(stage5PdfNames,['00-Full-Score.pdf','01-Vocal.pdf','02-Piano.pdf']);
  for(const name of stage5PdfNames){
    const bytes=await stage5AllZip.file(name).async('nodebuffer');
    assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
    assertStage5A4(bytes,595.2756,841.8898,name);
    assert.match(bytes.toString('latin1'),/\/Type\s*\/Page\b/);
    assert.doesNotMatch(bytes.toString('latin1'),/\/Subtype\s*\/Image\b/,
      name+' must preserve non-raster musical notation');
    assert.ok(bytes.length>1000);
  }
  const fullScoreBytes=await stage5AllZip.file('00-Full-Score.pdf').async('nodebuffer');
  const firstPartBytes=await stage5AllZip.file('01-Vocal.pdf').async('nodebuffer');
  assert.notDeepEqual(fullScoreBytes,firstPartBytes,
    'full score and extracted vocal part must be independent PDFs');
  await fs.writeFile(output+'/stage5-full-score-and-parts-english.zip',
    await fs.readFile(await stage5AllDownload.path()));
  console.log('BROWSER_STAGE=STAGE5_FULL_SCORE_AND_TWO_PARTS_VECTOR_A4_PDF_ZIP');

  // A4 landscape must preserve the actual PDF MediaBox, not merely change
  // the preview aspect ratio.
  await page.selectOption('#page-orientation','A4_L');
  await page.waitForFunction(()=>Math.abs(
    document.querySelector('#score-container svg')?.getBoundingClientRect().width-
    297*96/25.4)<3,null,{timeout:30000});
  const stage5LandscapeEvent=page.waitForEvent('download',{timeout:120000});
  await page.click('#v4-score-parts-pdf-zip');
  const stage5LandscapeZip=await JSZip.loadAsync(
    await fs.readFile(await (await stage5LandscapeEvent).path()));
  const stage5LandscapeNames=Object.keys(stage5LandscapeZip.files)
    .filter(name=>name.endsWith('.pdf')).sort();
  assert.deepEqual(stage5LandscapeNames,stage5PdfNames);
  for(const name of stage5LandscapeNames){
    const bytes=await stage5LandscapeZip.file(name).async('nodebuffer');
    assertStage5A4(bytes,841.8898,595.2756,name);
    assert.doesNotMatch(bytes.toString('latin1'),/\/Subtype\s*\/Image\b/);
  }
  console.log('BROWSER_STAGE=STAGE5_LANDSCAPE_FULL_SCORE_AND_PARTS_A4_PDF');
  await page.selectOption('#page-orientation','A4_P');
  await page.waitForFunction(()=>Math.abs(
    document.querySelector('#score-container svg')?.getBoundingClientRect().width-
    210*96/25.4)<3,null,{timeout:30000});

  // User-selected, self-generated two-syllable TTF is embedded separately in
  // both the whole score and its extracted part. No glyph-image substitutions.
  await page.locator('#file-input').setInputFiles({
    name:'stage5-hangul.musicxml',mimeType:'application/vnd.recordare.musicxml+xml',
    buffer:Buffer.from(oneBarHangul)
  });
  await page.waitForFunction(()=>document.querySelectorAll('#jwoo-bar-strip .jwoo-bar-chip').length===1,
    null,{timeout:30000});
  await page.locator('#v4-pdf-local-font').setInputFiles({
    name:'synthetic.ttf',mimeType:'font/ttf',buffer:Buffer.from(tinyLocalTTF,'base64')
  });
  await page.uncheck('#v4-pdf-unicode-raster');
  const stage5HanEvent=page.waitForEvent('download',{timeout:120000});
  await page.click('#v4-score-parts-pdf-zip');
  const stage5HanDownload=await stage5HanEvent;
  const stage5HanZip=await JSZip.loadAsync(
    await fs.readFile(await stage5HanDownload.path()));
  const stage5HanNames=Object.keys(stage5HanZip.files).filter(n=>n.endsWith('.pdf')).sort();
  assert.deepEqual(stage5HanNames,['00-Full-Score.pdf','01-Vocal.pdf']);
  for(const name of stage5HanNames){
    const pdf=await stage5HanZip.file(name).async('nodebuffer');
    const body=pdf.toString('latin1');
    assert.match(body,/\/FontFile2\b/,'embedded TrueType is required in '+name);
    assert.match(body,/\/ToUnicode\b/,'Unicode character mapping is required in '+name);
    assertStage5A4(pdf,595.2756,841.8898,name);
    assert.doesNotMatch(body,/\/Subtype\s*\/Image\b/);
  }
  assert.match(await page.locator('#message').textContent(),/TTF 벡터 글자/);
  await fs.writeFile(output+'/stage5-full-score-and-parts-korean-ttf.zip',
    await fs.readFile(await stage5HanDownload.path()));
  console.log('BROWSER_STAGE=STAGE5_KOREAN_EMBEDDED_TRUE_TYPE_FULL_SCORE_AND_PARTS');


  // Stage 6: independent W3C MusicXML 4.0 XSD will check these *actual*
  // exported documents after the full Chromium test, not just hard-coded
  // original fixtures or strings fabricated by the XSD test itself.
  const stage6Dir=output+'/stage6';
  await fs.mkdir(stage6Dir,{recursive:true});
  for(const [filename,xml] of [
    ['01-polyphonic-rest-and-undo.musicxml',s1Final],
    ['02-tuplet-rebalance.musicxml',s2TuXml],
    ['03-connected-notation-two-lyric-verses.musicxml',stage3Xml],
    ['04-manual-page-break-full-score.musicxml',stage4FullXml],
  ]){
    assert.match(xml,/<score-partwise\s+version="4\.0"/);
    await fs.writeFile(stage6Dir+'/'+filename,xml,'utf8');
  }
  console.log('BROWSER_STAGE=STAGE6_FOUR_REAL_EDITED_MUSICXML_FILES_FOR_INDEPENDENT_XSD');

  // Import an outside corpus compiled by the W3C MusicXML community, with
  // pinned hash verification completed by the independent XSD job.
  // No editing of these external scores is needed for lossless export:
  // unsupported extensions must remain intact or export must be blocked.
  for(const filename of [
    '01a-Pitches-Pitches.musicxml',
    '21b-Chords-TwoNotes.musicxml',
    '61a-Lyrics.musicxml'
  ]){
    const original=await fs.readFile('tests/musicxml4-official/corpus/'+filename,'utf8');
    const normal=original.replace(/<!DOCTYPE[\s\S]*?(?:\[[\s\S]*?\]\s*)?>|<!DOCTYPE[^>]*>/gi,'');
    await page.locator('#file-input').setInputFiles({
      name:filename,mimeType:'application/vnd.recordare.musicxml+xml',
      buffer:Buffer.from(original,'utf8')
    });
    await page.waitForFunction(()=>document.querySelectorAll('#v3-events .v3-event').length>0,
      null,{timeout:30000});
    const exportedEvent=page.waitForEvent('download',{timeout:30000});
    await page.click('#download-xml');
    const exported=await fs.readFile(await (await exportedEvent).path(),'utf8');
    // Compare canonical element/attribute/content signatures using an
    // independent DOM traversal. Drop indentation-only whitespace, but do
    // not drop pitch, duration, lyric, direction or extension nodes.
    const same=await page.evaluate(({before,after})=>{
      const parser=new DOMParser();
      const a=parser.parseFromString(before,'application/xml');
      const b=parser.parseFromString(after,'application/xml');
      const canonical=node=>{
        if(node.nodeType===8)return ['comment',node.nodeValue];
        if(node.nodeType===3||node.nodeType===4){
          const text=node.nodeValue||'';
          return /^\s*$/.test(text)?null:['text',text];
        }
        if(node.nodeType!==1)return null;
        return [node.localName,node.namespaceURI||'',
          [...node.attributes].filter(x=>!x.name.startsWith('xmlns'))
            .map(x=>[x.namespaceURI||'',x.localName,x.value])
            .sort((x,y)=>JSON.stringify(x).localeCompare(JSON.stringify(y))),
          [...node.childNodes].map(canonical).filter(Boolean)];
      };
      return JSON.stringify(canonical(a.documentElement))===
        JSON.stringify(canonical(b.documentElement));
    },{before:normal,after:exported});
    assert.ok(same,'W3C third-party score must not lose XML content: '+filename);
    await fs.writeFile(stage6Dir+'/W3C-'+filename,exported,'utf8');
    console.log('BROWSER_STAGE=STAGE6_W3C_INDEPENDENT_ROUNDTRIP_'+filename);
  }
  assert.deepEqual(errors,[],'no browser JavaScript exceptions during third-party import');
  const stage6Outputs=(await fs.readdir(stage6Dir))
    .filter(name=>name.endsWith('.musicxml')).map(name=>stage6Dir+'/'+name);
  assert.equal(stage6Outputs.length,7,'Four edited and three independent exports required');
  const stage6Schema=await validateMusicXml4Files(stage6Outputs,{expectAtLeast:7});
  assert.equal(stage6Schema.files,7);
  assert.equal(stage6Schema.status,'PASS_MUSICXML4_INDEPENDENT_XSD');
  console.log('BROWSER_STAGE=STAGE6_SEVEN_REAL_EXPORTS_INDEPENDENT_W3C_XSD_PASS');


  const normalizeStage7Xml=xml=>xml
    .replace(/^\uFEFF?\s*<\?xml[^?]*\?>\s*/i,'')
    .replace(/>\s+</g,'><').trim();

  // Stage 7 final acceptance: a single composer session that spans authoring,
  // lyric/expression edits, undo/redo, explicit recovery, browser restart,
  // tamper-resistant project archive, musicxml XSD and vector score/part PDF.
  await page.locator('#file-input').setInputFiles({
    name:'stage7-integrated.musicxml',mimeType:'application/vnd.recordare.musicxml+xml',
    buffer:Buffer.from(stage5English)
  });
  await page.waitForFunction(()=>document.querySelectorAll('#jwoo-bar-strip .jwoo-bar-chip').length===12,
    null,{timeout:30000});
  await page.locator('#v3-events .v3-event').first().click();
  await page.selectOption('#v4-articulation-kind','accent');
  await page.click('#v4-articulation-toggle');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent
    ?.includes('아티큘레이션 기호 추가 / 해제 완료'),null,{timeout:30000});
  await page.fill('#v4-lyric-verse','2');
  await page.fill('#v4-lyric-text','Together');
  await page.click('#v4-lyric-set');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent
    ?.includes('가사 입력·교체 완료'),null,{timeout:30000});
  const stage7EditDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const stage7Edited=await fs.readFile(await (await stage7EditDownload).path(),'utf8');
  assert.match(stage7Edited,/<articulations><accent\s*\/><\/articulations>/);
  assert.match(stage7Edited,/<lyric number="2">[\s\S]*?<text>Together<\/text>/);
  assert.match(stage7Edited,/<text>Verse<\/text>/);
  await page.click('#v3-undo');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('되돌리기 완료'),
    null,{timeout:30000});
  const stage7UndoDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const stage7UndoXml=await fs.readFile(await (await stage7UndoDownload).path(),'utf8');
  assert.doesNotMatch(stage7UndoXml,/<lyric number="2">[\s\S]*?<text>Together<\/text>/);
  assert.match(stage7UndoXml,/<articulations><accent\s*\/><\/articulations>/);
  await page.click('#v3-redo');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('다시 실행 완료'),
    null,{timeout:30000});
  const stage7RedoDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  assert.equal(await fs.readFile(await (await stage7RedoDownload).path(),'utf8'),stage7Edited,
    'Undo/Redo must be a lossless XML roundtrip');
  console.log('BROWSER_STAGE=STAGE7_EDIT_LYRICS_EXPRESSION_UNDO_REDO');

  await page.fill('#v4-checkpoint-label','7단계 최종 통합 작업');
  await page.click('#v4-checkpoint-save');
  await page.waitForFunction(()=>document.querySelector('#v4-checkpoint-status')?.textContent?.includes('복원 시점 저장 완료'),
    null,{timeout:30000});
  const stage7RecoveryId=await page.locator('#v4-checkpoint-select').inputValue();
  assert.match(stage7RecoveryId,/^[\w-]{20,}$/);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(id=>[...document.querySelectorAll('#v4-checkpoint-select option')]
    .some(o=>o.value===id),stage7RecoveryId,{timeout:30000});
  await page.locator('#v4-checkpoint-select').selectOption(stage7RecoveryId);
  await page.click('#v4-checkpoint-restore');
  await page.waitForFunction(()=>document.querySelector('#v4-checkpoint-status')?.textContent?.includes('복원 완료'),
    null,{timeout:30000});
  await page.waitForFunction(()=>document.querySelectorAll('#jwoo-bar-strip .jwoo-bar-chip').length===12,
    null,{timeout:30000});
  const stage7RecoveredEvent=page.waitForEvent('download');
  await page.click('#download-xml');
  assert.equal(normalizeStage7Xml(await fs.readFile(await (await stage7RecoveredEvent).path(),'utf8')),
    normalizeStage7Xml(stage7Edited),
    'Restarted browser must restore every musical element from the SHA-256 checkpoint');
  assert.equal(await page.locator('#v3-undo').isDisabled(),true,
    'Session restart must not reuse unrelated in-memory undo history');
  console.log('BROWSER_STAGE=STAGE7_BROWSER_RELOAD_SHA256_CHECKPOINT_RECOVERY');

  const stage7ArchiveEvent=page.waitForEvent('download',{timeout:30000});
  await page.click('#v4-project-export');
  const stage7ArchiveBytes=await fs.readFile(await (await stage7ArchiveEvent).path());
  const stage7Archive=await JSZip.loadAsync(stage7ArchiveBytes,{checkCRC32:true});
  const stage7Manifest=JSON.parse(await stage7Archive.file('manifest.json').async('string'));
  assert.equal(stage7Manifest.format,'J-WOO-PROJECT');
  assert.equal(stage7Manifest.current.filename,'stage7-integrated.musicxml');
  assert.equal(stage7Manifest.versions.length>=1,true);
  assert.equal(normalizeStage7Xml(await stage7Archive.file('score.musicxml').async('string')),
    normalizeStage7Xml(stage7Edited));
  const stage7Corrupted=await JSZip.loadAsync(stage7ArchiveBytes);
  stage7Corrupted.file('score.musicxml',stage7Edited.replace('Together','Wrong text'));
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#v4-project-file').setInputFiles({
    name:'stage7-corrupted.jwoo',mimeType:'application/zip',
    buffer:await stage7Corrupted.generateAsync({type:'nodebuffer'})
  });
  await page.waitForFunction(()=>document.querySelector('#v4-project-status')?.textContent
    ?.includes('프로젝트 복원 차단'),null,{timeout:30000});
  assert.match(await page.locator('#v4-project-status').textContent(),/SHA-256|해시/);
  const stage7TamperCheck=page.waitForEvent('download');
  await page.click('#download-xml');
  assert.equal(normalizeStage7Xml(await fs.readFile(await (await stage7TamperCheck).path(),'utf8')),
    normalizeStage7Xml(stage7Edited),
    'Rejected tampered project must never overwrite the current unsaved score');
  console.log('BROWSER_STAGE=STAGE7_TAMPERED_PROJECT_REJECTED_WITHOUT_DATA_LOSS');

  // A well-formed but structurally non-renderable MusicXML should be
  // transactional: preserve the score and the existing history.
  await page.locator('#v3-events .v3-event').first().click();
  await page.selectOption('#v4-articulation-kind','tenuto');
  await page.click('#v4-articulation-toggle');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent
    ?.includes('아티큘레이션 기호 추가 / 해제 완료'),null,{timeout:30000});
  const stage7BeforeBadImport=page.waitForEvent('download');
  await page.click('#download-xml');
  const stage7PreFailureXml=await fs.readFile(await (await stage7BeforeBadImport).path(),'utf8');
  assert.equal(await page.locator('#v3-undo').isEnabled(),true);
  const stage7BrokenXml='<?xml version="1.0"?><score-partwise version="4.0">'+
    '<part-list><score-part id="P1"><part-name>Broken</part-name></score-part></part-list>'+
    '<part id="P1"><measure number="1"><note><pitch><step>Q</step><octave>4</octave></pitch>'+
    '<duration>192</duration><type>whole</type></note></measure></part></score-partwise>';
  await page.locator('#file-input').setInputFiles({
    name:'broken-render.musicxml',mimeType:'application/vnd.recordare.musicxml+xml',
    buffer:Buffer.from(stage7BrokenXml)
  });
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent
    ?.includes('기존 작업 보존'),null,{timeout:30000});
  assert.equal(await page.locator('#v3-undo').isEnabled(),true,
    'Rejecting render failure must preserve the previous edit history');
  const stage7RejectedEvent=page.waitForEvent('download');
  await page.click('#download-xml');
  assert.equal(normalizeStage7Xml(await fs.readFile(await (await stage7RejectedEvent).path(),'utf8')),
    normalizeStage7Xml(stage7PreFailureXml),
    'Failed render must roll back to the exact previous score');
  await page.click('#v3-undo');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent
    ?.includes('되돌리기 완료'),null,{timeout:30000});
  const stage7UnwoundEvent=page.waitForEvent('download');
  await page.click('#download-xml');
  assert.equal(normalizeStage7Xml(await fs.readFile(await (await stage7UnwoundEvent).path(),'utf8')),
    normalizeStage7Xml(stage7Edited),
    'Undo after rejected import must still return to the pre-import checkpoint');
  console.log('BROWSER_STAGE=STAGE7_FAILED_RENDER_IMPORT_PRESERVES_EDIT_HISTORY');

  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#v4-project-file').setInputFiles({
    name:'stage7-recovery.jwoo',mimeType:'application/zip',buffer:stage7ArchiveBytes
  });
  await page.waitForFunction(()=>document.querySelector('#v4-project-status')?.textContent
    ?.includes('검증된 프로젝트 복원 완료'),null,{timeout:30000});
  const stage7ValidImportEvent=page.waitForEvent('download');
  await page.click('#download-xml');
  assert.equal(normalizeStage7Xml(await fs.readFile(await (await stage7ValidImportEvent).path(),'utf8')),
    normalizeStage7Xml(stage7Edited));
  console.log('BROWSER_STAGE=STAGE7_PORTABLE_PROJECT_REIMPORT_EXACT_SCORE_RESTORED');

  // The very same restored score must pass independent MusicXML 4.0 XSD and
  // export full score + all parts as genuine A4 vector PDF, without raster staff.
  await fs.writeFile(stage6Dir+'/stage7-integrated-recovery.musicxml',stage7Edited,'utf8');
  const stage7Xsd=await validateMusicXml4Files([stage6Dir+'/stage7-integrated-recovery.musicxml']);
  assert.equal(stage7Xsd.status,'PASS_MUSICXML4_INDEPENDENT_XSD');
  await page.locator('#v4-pdf-local-font').setInputFiles([]);
  await page.uncheck('#v4-pdf-unicode-raster');
  const stage7PdfEvent=page.waitForEvent('download',{timeout:120000});
  await page.click('#v4-score-parts-pdf-zip');
  const stage7Pdf=(await stage7PdfEvent).path();
  const stage7PdfZip=await JSZip.loadAsync(await fs.readFile(await stage7Pdf));
  const stage7PdfNames=Object.keys(stage7PdfZip.files)
    .filter(x=>x.endsWith('.pdf')).sort();
  assert.deepEqual(stage7PdfNames,['00-Full-Score.pdf','01-Vocal.pdf','02-Piano.pdf']);
  for(const filename of stage7PdfNames){
    const pdf=await stage7PdfZip.file(filename).async('nodebuffer');
    assertStage5A4(pdf,595.2756,841.8898,filename);
    assert.doesNotMatch(pdf.toString('latin1'),/\/Subtype\s*\/Image\b/);
  }
  console.log('BROWSER_STAGE=STAGE7_RESTORED_SCORE_XSD_AND_FULL_PART_VECTOR_PDF_PASS');

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
