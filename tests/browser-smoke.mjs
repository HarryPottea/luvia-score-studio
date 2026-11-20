// Browser-only integration smoke for the built candidate.
// Validates a synthetic MusicXML score end to end; it does NOT certify real Logic exports.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import JSZip from 'jszip';

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
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
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
  await page.locator('#v3-events .v3-event').first().waitFor();
  assert.match(await page.locator('#score-title').inputValue(),/통합 검증/);
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
  await page.selectOption('#v3-length','quarter');
  await page.click('#v4-insert-note');
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
  assert.equal(await page.locator('#v3-length').isDisabled(),true,'Legacy input is locked for polyphonic notation');
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





  await page.fill('#v4-new-title','셋잇단음 편집 검증');
  page.once('dialog',dialog=>dialog.accept());
  await page.click('#v4-new');
  await page.locator('#v3-events .v3-event').first().waitFor();
  await page.selectOption('#v3-length','eighth');
  await page.click('#v4-insert-note');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('성부를 보존한 음표 삽입 완료'));
  await page.locator('#v3-events .v3-event').nth(1).click();
  await page.selectOption('#v3-length','eighth');
  await page.selectOption('#v3-step','E');
  await page.click('#v4-insert-note');
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
  assert.equal(await page.locator('#v3-length').isDisabled(),true);
  await page.selectOption('#v4-pro-step','A');
  await page.selectOption('#v4-pro-octave','3');
  await page.selectOption('#v4-pro-type','quarter');
  await page.click('#v4-insert-note');
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
  await bothPartsTab.close();
  console.log('BROWSER_STAGE=V4_TWO_PART_VECTOR_PRINT_BOOK');
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
  await page.selectOption('#v4-cadence-systems','2');
  await page.click('#v4-cadence-apply');
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('전체 악보 줄·페이지 나눔 완료'),null,{timeout:30000});
  assert.match(await page.locator('#v4-cadence-status').textContent(),/모든 파트 2개/);
  const scoreCadenceDownload=page.waitForEvent('download');
  await page.click('#download-xml');
  const scoreCadenceXml=await fs.readFile(await (await scoreCadenceDownload).path(),'utf8');
  assert.equal((scoreCadenceXml.match(/<print new-system="yes"/g)||[]).length,2,
    'The third bar must start a new system in each part');
  assert.equal((scoreCadenceXml.match(/<print new-page="yes"/g)||[]).length,2,
    'The fifth bar must start a new page in each part');
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
  await page.click('#v4-insert-note');
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
  assert.deepEqual(await shortcuts.allTextContents(),['새 악보','파트','음표','가사','코드','출력']);
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
