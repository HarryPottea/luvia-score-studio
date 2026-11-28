import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {chromium} from 'playwright';
const url='http://127.0.0.1:4173/';
const server=spawn('node',['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4173','--strictPort'],{stdio:'inherit'});
let browser;
try{
  let ready=false;
  for(let i=0;i<80;i++){try{if((await fetch(url)).ok){ready=true;break;}}catch{}await sleep(250);}
  assert.ok(ready);
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.goto(url);
  const note='<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>';
  const attrs='<attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>';
  const xml='<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Vocal</part-name></score-part></part-list><part id="P1">'+Array.from({length:80},(_,i)=>'<measure number="'+(i+1)+'">'+(i===0?attrs:'')+note.repeat(4)+'</measure>').join('')+'</part></score-partwise>';
  await page.locator('#file-input').setInputFiles({name:'multi-page.musicxml',mimeType:'application/vnd.recordare.musicxml+xml',buffer:Buffer.from(xml)});
  await page.waitForFunction(()=>document.querySelectorAll('.studio-page').length>=2&&document.querySelector('#preview-shell')?.getAttribute('aria-busy')==='false');
  const buttons=page.locator('.studio-page');
  const n=await buttons.count();
  // Check actual image decoding and score ink, not just the presence of an icon.
  const thumbnails=async()=>page.evaluate(async()=>{
    const images=[...document.querySelectorAll('.studio-page-image')];
    const sources=[...document.querySelectorAll('#score-container svg')].filter(svg=>!svg.parentElement?.closest('svg'));
    return Promise.all(images.map(async(img,i)=>{
      await img.decode();
      const xml=await (await fetch(img.src)).text();
      const svg=new DOMParser().parseFromString(xml,'image/svg+xml').documentElement;
      const raster=document.createElement('canvas');raster.width=100;raster.height=142;
      const ctx=raster.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,100,142);
      ctx.drawImage(img,0,0,100,142);
      const pixels=ctx.getImageData(0,0,100,142).data;
      let ink=0;for(let p=0;p<pixels.length;p+=4)if(pixels[p]<180&&pixels[p+1]<180&&pixels[p+2]<180)ink++;
      return {url:img.src,width:img.naturalWidth,height:img.naturalHeight,ink,
        glyphs:svg.querySelectorAll('path').length,sourceGlyphs:sources[i].querySelectorAll('path').length,
        overlays:svg.querySelectorAll('.jwoo-hit-area,.jwoo-selection-ring,.jwoo-note-drag-preview').length};
    }));
  });
  const initialThumbs=await thumbnails();
  assert.equal(initialThumbs.length,n);
  assert.ok(initialThumbs.every(t=>t.width>0&&t.height>0&&t.ink>50&&t.glyphs>0&&t.glyphs===t.sourceGlyphs&&t.overlays===0),JSON.stringify(initialThumbs));
  assert.equal(new Set(initialThumbs.map(t=>t.url)).size,n);
  console.log('REAL_THUMBNAILS_PASS: decoded score SVG with real ink for every page');
  const geometry=()=>page.evaluate(()=>{const c=document.getElementById('preview-shell'),r=c.getBoundingClientRect();return {top:c.scrollTop,scrollHeight:c.scrollHeight,height:c.clientHeight,body:window.scrollY,docHeight:document.documentElement.scrollHeight,viewport:innerHeight,rectTop:r.top,rectBottom:r.bottom,overflow:getComputedStyle(c).overflowY,header:document.querySelector('.topbar').getBoundingClientRect().top};});
  const initial=await geometry();
  console.log('INITIAL',JSON.stringify(initial),n);
  assert.ok(initial.scrollHeight>initial.height+100,'Multi-page canvas must have internal overflow');
  assert.ok(initial.rectBottom<=initial.viewport+1);
  assert.equal(initial.body,0);assert.ok(initial.docHeight<=initial.viewport+1);
  await buttons.nth(1).click();
  await page.waitForFunction(()=>document.querySelector('.studio-page[data-page="1"]')?.getAttribute('aria-current')==='page');
  const second=await geometry();assert.ok(second.top>100);assert.equal(second.body,0);
  await buttons.last().click();
  await page.waitForFunction(i=>document.querySelector('.studio-page[data-page="'+i+'"]')?.getAttribute('aria-current')==='page',n-1);
  assert.equal((await geometry()).body,0);
  await buttons.first().click();
  await page.waitForFunction(()=>document.getElementById('preview-shell').scrollTop<=2);
  const box=await page.locator('#preview-shell').boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.wheel(0,850);
  await page.waitForFunction(()=>document.getElementById('preview-shell').scrollTop>100);
  assert.equal((await geometry()).body,0);
  await page.locator('.studio-panel-close').click();
  const closed=await geometry();assert.ok(closed.scrollHeight>closed.height+100);assert.equal(closed.body,0);
  await buttons.nth(1).click();await page.waitForFunction(()=>document.querySelector('.studio-page[data-page="1"]')?.getAttribute('aria-current')==='page');
  const previousRevision=await page.locator('#score-container').getAttribute('data-render-revision');
  await page.locator('button[data-studio-menu="score"]').click();
  const paper=page.locator('#page-orientation');
  if(!await paper.isVisible())await page.locator('.control-group').filter({has:paper}).locator('.control-heading .jwoo-fold-toggle').click();
  await paper.selectOption('A4_L');
  await page.waitForFunction(rev=>document.querySelector('#score-container')?.dataset.renderRevision!==rev&&document.querySelector('#preview-shell')?.getAttribute('aria-busy')==='false',previousRevision);
  const refreshed=await thumbnails();
  assert.ok(refreshed.length>0&&refreshed.every(t=>t.width>t.height&&t.ink>50&&!initialThumbs.some(old=>old.url===t.url)),JSON.stringify(refreshed));
  console.log('THUMBNAIL_REFRESH_PASS: real landscape score images after re-render');
  await page.setViewportSize({width:390,height:844});
  await page.locator('#preview-shell').evaluate(e=>e.scrollTop=0);
  const mobile=await geometry();console.log('MOBILE',JSON.stringify(mobile));
  assert.ok(mobile.scrollHeight>mobile.height+100);assert.ok(mobile.docHeight<=mobile.viewport+1);assert.equal(mobile.body,0);
  const mb=await page.locator('#preview-shell').boundingBox();
  await page.mouse.move(mb.x+mb.width/2,mb.y+mb.height/2);await page.mouse.wheel(0,600);
  await page.waitForFunction(()=>document.getElementById('preview-shell').scrollTop>100);
  assert.equal((await geometry()).body,0);
  console.log('SCORE_SCROLL_PASS: actual multi-page score, page navigation, wheel, docked/closed inspector, mobile viewport');
}finally{await browser?.close();server.kill('SIGTERM');}
