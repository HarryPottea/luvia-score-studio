import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isPreviewPinned} from '../src/sticky-preview.js';

const base={position:'sticky',previewTop:14,previewHeight:700,
  containerTop:-180,containerBottom:2400,stickyTop:14};
test('sticky preview gains elevation only while genuinely pinned',()=>{
  assert.equal(isPreviewPinned(base),true);
  assert.equal(isPreviewPinned({...base,containerTop:55}),false);
  assert.equal(isPreviewPinned({...base,previewTop:29}),false);
  assert.equal(isPreviewPinned({...base,containerBottom:500}),false);
  assert.equal(isPreviewPinned({...base,position:'static'}),false);
});
test('sticky score enhancement is presentation-only and respects print/reduced motion',()=>{
  const css=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
  const script=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
  assert.match(css,/\.workspace\{overflow:visible\}/);
  assert.match(css,/\.preview-column\s*\{\s*position:sticky/);
  assert.match(css,/@media\(max-width:670px\)/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css,/@media print\{\s*\.preview-column\{position:static!important/);
  assert.match(script,/mountStickyPreview\(\)/);
});
