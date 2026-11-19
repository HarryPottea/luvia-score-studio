import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {editableScoreRenderOptions} from '../src/osmd-render-policy.js';

const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('single-part rest measures are never auto-condensed',()=>{
  const options=editableScoreRenderOptions({backend:'svg',drawMeasureNumbers:true});
  assert.equal(options.autoGenerateMultipleRestMeasuresFromRestMeasures,false);
  assert.equal(options.backend,'svg');
  assert.equal(options.drawMeasureNumbers,true);
});
test('explicit caller settings cannot restore automatic multi-rest compression',()=>{
  assert.equal(editableScoreRenderOptions({autoGenerateMultipleRestMeasuresFromRestMeasures:true})
    .autoGenerateMultipleRestMeasuresFromRestMeasures,false);
});
test('render options retain caller fields without mutation',()=>{
  const source=Object.freeze({autoResize:false,pageFormat:'A4_P'});
  const options=editableScoreRenderOptions(source);
  assert.notEqual(options,source);
  assert.deepEqual(source,{autoResize:false,pageFormat:'A4_P'});
  assert.equal(options.pageFormat,'A4_P');
});
test('both score preview and vector part output install the same display policy',()=>{
  for(const path of ['src/main.js','src/studio-v4-printbook.js']){
    const source=read(path);
    assert.match(source,/import\s*\{\s*editableScoreRenderOptions\s*\}\s*from\s*['"]\.\/osmd-render-policy\.js['"]/);
    assert.match(source,/new OpenSheetMusicDisplay\([^\n]*editableScoreRenderOptions\(/);
  }
});
