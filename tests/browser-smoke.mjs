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
  assert.match(v4Text,/<duration>16<\/duration>/);
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
  await page.click('#v4-stop');
  console.log('BROWSER_STAGE=V4_WEB_AUDIO_AUDITION');
  // Explicit restore uses the draft rather than the changed current score.
  await page.click('#try-sample');
  await page.selectOption('#v4-draft-select','통합 검증.musicxml');
  page.once('dialog',dialog=>dialog.accept());
  await page.click('#v4-restore');
  await page.waitForFunction(()=>document.querySelector('#score-title')?.value==='통합 검증',null,{timeout:15000});
  assert.match(await page.locator('#v3-events .v3-event').first().textContent(),/C4/);
  console.log('BROWSER_STAGE=V4_LOCAL_DRAFT_RESTORED');

  await page.click('#try-sample');
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
