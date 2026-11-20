import test from 'node:test';
import assert from 'node:assert/strict';
import {matchScoreEvents} from '../src/score-hit.js';
import {editAdvancedScore,inspectAdvancedMeasure} from '../src/advanced-score.js';

// Small deterministic XML DOM: stage-1 invariants are checked without browser state.
class El {
  constructor(localName,children=[],text='',attrs={}){
    this.localName=localName;this.children=[];this.raw=String(text);this.map={...attrs};
    this.parentNode=null;this.ownerDocument=null;this.namespaceURI=null;
    for(const item of children)this.appendChild(item);
  }
  get textContent(){return this.children.length?this.children.map(x=>x.textContent).join(''):this.raw;}
  set textContent(v){this.raw=String(v);this.children=[];}
  get attributes(){return Object.entries(this.map).map(([name,value])=>({name,value}));}
  get nextSibling(){if(!this.parentNode)return null;const a=this.parentNode.children;return a[a.indexOf(this)+1]||null;}
  getAttribute(k){return this.map[k]??null;}
  setAttribute(k,v){this.map[k]=String(v);}
  removeAttribute(k){delete this.map[k];}
  appendChild(e){this.children.push(e);e.parentNode=this;e.assign(this.ownerDocument);return e;}
  insertBefore(e,other){if(!other)return this.appendChild(e);const at=this.children.indexOf(other);if(at<0)throw Error('missing sibling');this.children.splice(at,0,e);e.parentNode=this;e.assign(this.ownerDocument);return e;}
  replaceChild(e,other){const at=this.children.indexOf(other);if(at<0)throw Error('missing child');this.children[at]=e;e.parentNode=this;e.assign(this.ownerDocument);other.parentNode=null;return other;}
  removeChild(e){const at=this.children.indexOf(e);if(at<0)throw Error('missing child');this.children.splice(at,1);e.parentNode=null;return e;}
  assign(doc){this.ownerDocument=doc;for(const el of this.children)el.assign(doc);}
  cloneNode(deep=true){return new El(this.localName,deep?this.children.map(x=>x.cloneNode(true)):[],this.raw,this.map);}
}
class Doc{
  constructor(root){this.documentElement=root;root.assign(this);}
  createElementNS(ns,name){const el=new El(name);el.namespaceURI=ns;el.assign(this);return el;}
  cloneNode(){return new Doc(this.documentElement.cloneNode(true));}
}
const e=(n,children=[])=>new El(n,children);
const t=(n,value)=>new El(n,[],String(value));
const note=(step,lyric='')=>e('note',[
  ...(step==='G'?[e('chord')]:[]),
  e('pitch',[t('step',step),t('octave',4)]),
  t('duration',192),t('voice',1),t('type','whole'),
  ...(lyric?[e('lyric',[t('text',lyric)])]:[])
]);
function chordScore(){
  return new Doc(e('score-partwise',[new El('part',[
    new El('measure',[
      e('attributes',[t('divisions',48),e('time',[t('beats',4),t('beat-type',4)])]),
      note('C','별빛'),note('G'),
    ],'',{number:'1'})
  ],'',{id:'P1'})]));
}
const local=n=>n.children.filter(x=>x.localName==='note');
test('identical pitches in simultaneous voices resolve only by explicit voice identity',()=>{
  const source=[{step:'C',alter:0,octave:4,start:0,duration:48,voice:'1',staff:'1',eventIndex:0},
    {step:'C',alter:0,octave:4,start:0,duration:48,voice:'2',staff:'1',eventIndex:1}];
  const drawn=[{...source[1],gn:'voice2'},{...source[0],gn:'voice1'}];
  const map=matchScoreEvents(source,drawn);
  assert.equal(map.length,2);
  assert.equal(map.find(x=>x.event.eventIndex===0).graphic.gn,'voice1');
  assert.equal(map.find(x=>x.event.eventIndex===1).graphic.gn,'voice2');
  assert.equal(matchScoreEvents(source,drawn.map(({voice,...x})=>x)).length,0);
});
test('unison duplicates inside the same voice remain non-interactive',()=>{
  const source=[{step:'D',alter:0,octave:4,start:0,duration:48,voice:'1',staff:'1'},
    {step:'D',alter:0,octave:4,start:0,duration:48,voice:'1',staff:'1'}];
  assert.equal(matchScoreEvents(source,source.map((x,i)=>({...x,gn:i}))).length,0);
});
test('removing a chord root promotes the next pitch without dropping Korean lyrics',()=>{
  const source=chordScore();
  const before=inspectAdvancedMeasure(source,'P1',0);
  const result=editAdvancedScore(source,{partId:'P1',measureIndex:0,eventIndex:0,action:'chord-remove'});
  const after=inspectAdvancedMeasure(result.doc,'P1',0);
  assert.equal(before.reason,null);assert.equal(after.reason,null);
  assert.equal(after.events.length,1);assert.equal(after.events[0].chord,false);
  assert.equal(after.events[0].step,'G');assert.equal(after.events[0].start,0);
  assert.equal(after.events[0].duration,192);
  const retained=local(result.doc.documentElement.children[0].children[0]);
  assert.equal(retained[0].children.find(x=>x.localName==='lyric').textContent,'별빛');
  assert.equal(inspectAdvancedMeasure(source,'P1',0).events.length,2,'immutable original');
});
test('removing the upper chord pitch preserves anchor and returns a fresh document',()=>{
  const source=chordScore();
  const output=editAdvancedScore(source,{partId:'P1',measureIndex:0,eventIndex:1,action:'chord-remove'});
  assert.notEqual(output.doc,source);
  const audit=inspectAdvancedMeasure(output.doc,'P1',0);
  assert.equal(audit.reason,null);
  assert.equal(audit.events.length,1);assert.equal(audit.events[0].step,'C');
});
test('non-chord note cannot be removed as a chord tone',()=>{
  const once=editAdvancedScore(chordScore(),{partId:'P1',measureIndex:0,eventIndex:1,action:'chord-remove'});
  assert.throws(()=>editAdvancedScore(once.doc,{partId:'P1',measureIndex:0,eventIndex:0,action:'chord-remove'}),/화음/);
});
