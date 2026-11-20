import test from 'node:test';
import assert from 'node:assert/strict';
import {compareMusicXmlTrees} from '../src/studio-v4-xml-roundtrip.js';
const t=value=>({nodeType:3,nodeValue:value,textContent:value});
const attr=(name,value)=>({name,localName:name,value,namespaceURI:null});
function el(localName,attributes=[],childNodes=[],namespaceURI=null){
  const node={nodeType:1,localName,namespaceURI,attributes,
    childNodes,children:childNodes.filter(x=>x.nodeType===1)};
  node.textContent=childNodes.map(c=>c.textContent||'').join('');
  return node;
}
function score({step='C',lyric='반짝이는',ticks='48',voice='1',extra=false}={}){
  const pitch=el('pitch',[],[el('step',[],[t(step)]),el('octave',[],[t('4')])]);
  const note=el('note',[],[pitch,el('duration',[],[t(ticks)]),
    el('voice',[],[t(voice)]),el('type',[],[t('quarter')]),
    el('lyric',[attr('number','1')],[el('text',[],[t(lyric)])])]);
  const bar=el('measure',[attr('number','1')],[note,...(extra?[el('misc',[],[t('unknown but should be preserved')])]:[])]);
  const part=el('part',[attr('id','P1')],[bar]);
  return el('score-partwise',[attr('version','4.0')],[part]);
}
test('roundtrip semantic tree with Korean lyrics, voice and note timing',()=>{
  const report=compareMusicXmlTrees(score(),score());
  assert.equal(report.equal,true);
  assert.ok(report.checkedNodes>=8);
});
test('semantic roundtrip detects changes to pitch, duration, voice, lyrics',()=>{
  for(const patch of [{step:'D'},{ticks:'96'},{voice:'2'},{lyric:'달빛'},{extra:true}]){
    const report=compareMusicXmlTrees(score(),score(patch));
    assert.equal(report.equal,false);
    assert.ok(report.path.includes('/'),JSON.stringify(report));
  }
});
test('ignores formatting whitespace between MusicXML elements and attribute order',()=>{
  const original=score();
  const formatted=score();
  const part=formatted.children[0];
  const bar=part.children[0];
  const note=bar.children[0];
  formatted.childNodes=[t('\n  '),part,t('\n')];
  part.childNodes=[t('\n    '),bar,t('\n  ')];
  bar.childNodes=[t('\n'),note,t('\n')];
  note.childNodes=[t('\n  '),...note.children,t('\n')];
  const attributes=bar.attributes;
  bar.attributes=[...attributes].reverse();
  assert.equal(compareMusicXmlTrees(original,formatted).equal,true);
});
test('preserves significant lyric whitespace and custom elements',()=>{
  assert.equal(compareMusicXmlTrees(score({lyric:'나 비'}),score({lyric:'나비'})).equal,false);
  assert.equal(compareMusicXmlTrees(score({extra:true}),score({extra:false})).equal,false);
});
test('checks effective XML namespaces rather than mutable namespace prefix declarations',()=>{
  const a=score(),b=score();
  b.children[0].namespaceURI='http://example.org/not-musicxml';
  assert.equal(compareMusicXmlTrees(a,b).equal,false);
  const c=score(),d=score();
  c.attributes.push({namespaceURI:'http://www.w3.org/2000/xmlns/',name:'xmlns:foo',
    localName:'foo',value:'urn:prefix'});
  assert.equal(compareMusicXmlTrees(c,d).equal,true);
});
test('malformed root fails without mutating either input',()=>{
  const a=score(),b=el('score-timewise',[],[]);
  assert.match(compareMusicXmlTrees(a,b).reason,/루트/);
  assert.equal(a.children[0].children[0].children[0].children[0].children[0].textContent,'C');
});
