import test from 'node:test';
import assert from 'node:assert/strict';
import { A4_FORMATS, PRINT_MARGIN_MM, fixedA4Profile, recommendStaffHeightMm, applyFixedA4Profile } from '../src/a4-engraving.js';

const el=(localName,children=[],textContent='')=>({localName,children,textContent});
function documentFor(stavesPerPart,withStaffNumbers=true){
  const parts=stavesPerPart.map(n=>{
    const attributes=n>1?[el('staves',[],String(n))]:[];
    const staffNodes=withStaffNumbers&&n>1?[el('note',[el('staff',[],String(n))])]:[];
    return el('part',[el('measure',[el('attributes',attributes),...staffNodes])]);
  });
  return {documentElement:el('score-partwise',parts)};
}
const equivalentStaffMm=p=>40*p.zoom*p.widthMm/p.pageWidthPx;
const equivalentMarginMm=p=>10*p.zoom*p.marginInUnits*p.widthMm/p.pageWidthPx;
function equalApprox(a,b,tolerance=.0001){assert.ok(Math.abs(a-b)<tolerance,String(a)+' != '+String(b));}

test('A4 fixed profile preserves actual staff size and 12mm margins in portrait and landscape',()=>{
  for(const pageFormat of ['A4_P','A4_L'])for(const count of [[1],[2],[1,2],[1,1,1,1,1]]) {
    const doc=documentFor(count);
    const p=fixedA4Profile(doc,pageFormat);
    const expected=count.reduce((a,b)=>a+b,0)>=5?5.8:count.reduce((a,b)=>a+b,0)>=2?6.5:7;
    assert.equal(p.staffHeightMm,expected);
    assert.equal(p.marginMm,PRINT_MARGIN_MM);
    equalApprox(equivalentStaffMm(p),expected);
    equalApprox(equivalentMarginMm(p),PRINT_MARGIN_MM);
    equalApprox(p.pageWidthPx/p.pageHeightPx,A4_FORMATS[pageFormat].widthMm/A4_FORMATS[pageFormat].heightMm);
  }
});
test('part views get 7mm, piano and vocal accompaniment 6.5mm, larger scores 5.8mm',()=>{
  assert.equal(recommendStaffHeightMm(documentFor([1])),7);
  assert.equal(recommendStaffHeightMm(documentFor([2])),6.5);
  assert.equal(recommendStaffHeightMm(documentFor([1,2])),6.5);
  assert.equal(recommendStaffHeightMm(documentFor([2,2,1])),5.8);
  assert.equal(recommendStaffHeightMm(documentFor([1,1,1,1,1,1,1])),5.8);
});
test('OSMD rendering rules receive the same absolute physical print margins',()=>{
  const rules={PageLeftMargin:5,PageRightMargin:5,PageTopMargin:5,PageBottomMargin:5};
  const osmd={EngravingRules:rules,zoom:1};
  const doc=documentFor([2]);
  const p=applyFixedA4Profile(osmd,doc);
  equalApprox(osmd.zoom,p.zoom);
  for(const name of ['PageLeftMargin','PageRightMargin','PageTopMargin','PageBottomMargin'])
    equalApprox(rules[name],p.marginInUnits);
});
test('invalid page format is rejected instead of silently changing print geometry',()=>{
  assert.throws(()=>fixedA4Profile(documentFor([1]),'Letter'),/A4/);
});
