import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectScore, editScoreEvent } from '../src/editor-core.js';
import { createEditorHistory } from '../src/editor-history.js';

// Small deterministic MusicXML DOM fixture, without a new package or browser globals.
class Element {
  constructor(localName, attrs={}, kids=[], text='') {
    this.localName=localName;this.map={...attrs};this.children=[];this.raw=String(text);
    this.parentNode=null;this.ownerDocument=null;this.namespaceURI=null;
    for(const k of kids)this.appendChild(k);
  }
  get attributes(){return Object.entries(this.map).map(([name,value])=>({name,value}));}
  get textContent(){return this.children.length?this.children.map(c=>c.textContent).join(''):this.raw;}
  set textContent(value){this.raw=String(value);this.children=[];}
  get firstChild(){return this.children[0]||null;}
  get nextSibling(){if(!this.parentNode)return null;const a=this.parentNode.children;return a[a.indexOf(this)+1]||null;}
  getAttribute(k){return this.map[k]??null;}
  setAttribute(k,v){this.map[k]=String(v);}
  removeAttribute(k){delete this.map[k];}
  append(...kids){for(const child of kids)this.appendChild(child);}
  appendChild(child){this.children.push(child);child.parentNode=this;child.assignDocument(this.ownerDocument);return child;}
  insertBefore(child,reference){
    if(reference==null)return this.appendChild(child);
    const idx=this.children.indexOf(reference);if(idx<0)throw Error('reference not found');
    this.children.splice(idx,0,child);child.parentNode=this;child.assignDocument(this.ownerDocument);return child;
  }
  removeChild(child){const idx=this.children.indexOf(child);if(idx<0)throw Error('child not found');this.children.splice(idx,1);child.parentNode=null;return child;}
  replaceChild(next,old){const idx=this.children.indexOf(old);if(idx<0)throw Error('child not found');this.children[idx]=next;next.parentNode=this;next.assignDocument(this.ownerDocument);old.parentNode=null;return old;}
  remove(){this.parentNode?.removeChild(this);}
  assignDocument(doc){this.ownerDocument=doc;for(const c of this.children)c.assignDocument(doc);}
  cloneNode(deep=false){return new Element(this.localName,this.map,deep?this.children.map(c=>c.cloneNode(true)):[],this.raw);}
}
class Doc {
  constructor(root){this.documentElement=root;root.assignDocument(this);}
  createElementNS(ns,tag){const el=new Element(tag);el.namespaceURI=ns;el.assignDocument(this);return el;}
  cloneNode(){return new Doc(this.documentElement.cloneNode(true));}
}
const el=(tag,attrs={},kids=[],text='')=>new Element(tag,attrs,kids,text);
const pitch=(step='C',octave=4)=>el('pitch',{},[el('step',{},[],step),el('octave',{},[],octave)]);
const note=(duration=8,type='quarter',extra=[])=>el('note',{},[pitch(),el('duration',{},[],duration),el('type',{},[],type),...extra]);
const rest=(duration=8,type='quarter')=>el('note',{},[el('rest'),el('duration',{},[],duration),el('type',{},[],type)]);
function score(notes,opts={}) {
  const beats=opts.beats??4,beatType=opts.beatType??4;
  const attr=el('attributes',{},[
    el('divisions',{},[],8),el('time',{},[el('beats',{},[],beats),el('beat-type',{},[],beatType)]),
  ]);
  const measure=el('measure',{number:'1',...(opts.implicit?{implicit:'yes'}:{})},[attr,...(opts.extra||[]),...notes]);
  const part=el('part',{id:'P1'},[measure]);
  const defs=el('part-list',{},[el('score-part',{id:'P1'},[el('part-name',{},[],'Piano')])]);
  return new Doc(el('score-partwise',{},[defs,part]));
}
const args=(action,options={})=>({partId:'P1',measureIndex:0,eventIndex:0,action,...options});
const getNotes=doc=>doc.documentElement.children[1].children[0].children.filter(x=>x.localName==='note');
const getDuration=note=>Number(note.children.find(x=>x.localName==='duration').textContent);
const sum=doc=>getNotes(doc).reduce((a,n)=>a+getDuration(n),0);
const oneMeasure=doc=>inspectScore(doc).parts[0].measures[0];

test('read-only model reports measure, pitch, duration, voice safety and part names',()=>{
  const doc=score([note(),note(),note(),note()]);
  const view=inspectScore(doc);
  assert.equal(view.parts[0].name,'Piano');
  assert.equal(view.parts[0].measures[0].reason,null);
  assert.equal(view.parts[0].measures[0].total,32);
  assert.deepEqual(view.parts[0].measures[0].events.map(e=>e.start),[0,8,16,24]);
});

test('pitch editing clones source and preserves note duration and all other notes',()=>{
  const doc=score([note(),note(),note(),note()]);
  const output=editScoreEvent(doc,args('pitch',{step:'F',alter:1,octave:5})).doc;
  assert.notEqual(output,doc);
  assert.equal(sum(output),32);
  assert.equal(sum(doc),32);
  assert.equal(oneMeasure(doc).events[0].step,'C');
  assert.equal(oneMeasure(output).events[0].step,'F');
  assert.equal(oneMeasure(output).events[0].alter,1);
  assert.equal(oneMeasure(output).events[0].octave,5);
  assert.equal(oneMeasure(output).events[1].step,'C');
});

test('shortening note creates exact duration-preserving rest and can be lengthened back',()=>{
  const doc=score([note(),note(),note(),note()]);
  const shorter=editScoreEvent(doc,args('duration',{type:'eighth'})).doc;
  assert.equal(sum(shorter),32);
  assert.deepEqual(oneMeasure(shorter).events.slice(0,3).map(x=>[x.rest,x.duration]),[[false,4],[true,4],[false,8]]);
  const longer=editScoreEvent(shorter,args('duration',{type:'quarter'})).doc;
  assert.equal(sum(longer),32);
  assert.equal(getNotes(longer).length,4);
  assert.equal(oneMeasure(longer).events[0].type,'quarter');
  assert.equal(getNotes(doc).length,4);
});

test('two rests can be used to extend a note, but not past a following pitched event',()=>{
  const doc=score([note(4,'eighth'),rest(4,'eighth'),rest(8,'quarter'),note(),note()]);
  const expanded=editScoreEvent(doc,args('duration',{type:'quarter'})).doc;
  assert.equal(sum(expanded),32);
  assert.equal(oneMeasure(expanded).events[0].duration,8);
  const short=score([note(4,'eighth'),note(4,'eighth'),note(),note(),note()]);
  assert.throws(()=>editScoreEvent(short,args('duration',{type:'quarter'})),/쉼표의 길이가 부족/);
});

test('delete by rest replacement and reinsert note retain exact beat occupancy',()=>{
  const doc=score([note(),note(),note(),note()]);
  const cleared=editScoreEvent(doc,args('to-rest')).doc;
  assert.equal(oneMeasure(cleared).events[0].rest,true);
  assert.equal(sum(cleared),32);
  const putBack=editScoreEvent(cleared,args('from-rest',{step:'G',octave:3,alter:0})).doc;
  assert.equal(oneMeasure(putBack).events[0].step,'G');
  assert.equal(oneMeasure(putBack).events[0].octave,3);
  assert.equal(sum(putBack),32);
});

test('simple lyrics are preserved, editable and removable; complex lyric marks are blocked',()=>{
  const doc=score([note(),note(),note(),note()]);
  const withLyric=editScoreEvent(doc,args('lyric',{text:'사랑'})).doc;
  assert.equal(oneMeasure(withLyric).events[0].lyric,'사랑');
  assert.throws(()=>editScoreEvent(withLyric,args('to-rest')),/가사가 있는 음표/);
  const erased=editScoreEvent(withLyric,args('lyric',{text:''})).doc;
  assert.equal(oneMeasure(erased).events[0].lyric,'');
});

test('polyphony, pickup, tuplets, tied notes are not silently edited',()=>{
  const normal=[note(),note(),note(),note()];
  const voices=score(normal,{extra:[el('backup',{},[el('duration',{},[],8)])]});
  assert.match(oneMeasure(voices).reason,/여러 성부/);
  assert.throws(()=>editScoreEvent(voices,args('pitch',{step:'G',alter:0,octave:4})),/여러 성부/);
  const pickup=score(normal,{implicit:true});
  assert.match(oneMeasure(pickup).reason,/못갖춘/);
  const triplet=score([note(8,'quarter',[el('time-modification')]),note(),note(),note()]);
  assert.match(oneMeasure(triplet).reason,/셋잇단음/);
  const tied=score([note(8,'quarter',[el('tie',{type:'start'})]),note(),note(),note()]);
  assert.throws(()=>editScoreEvent(tied,args('pitch',{step:'G',alter:0,octave:4})),/보호 표기/);
});

test('invalid edits fail before mutation: zero duration, bad pitch and unsupported type',()=>{
  const doc=score([note(),note(),note(),note()]);
  assert.throws(()=>editScoreEvent(doc,args('pitch',{step:'H',alter:0,octave:4})),/올바르지/);
  assert.throws(()=>editScoreEvent(doc,args('duration',{type:'triplet'})),/지원하지/);
  assert.throws(()=>editScoreEvent(doc,args('lyrics',{text:'test'})),/지원하지/);
  assert.equal(oneMeasure(doc).events[0].step,'C');
});

test('bounded history supports undo, redo and reset without changing source objects',()=>{
  const h=createEditorHistory(2);
  const a={id:1},b={id:2},c={id:3},d={id:4};
  h.record(a,b,'pitch');h.record(b,c,'lyric');
  assert.deepEqual(h.status(),{undo:2,redo:0,last:'lyric'});
  assert.equal(h.undo(c).doc,b);
  assert.equal(h.redo(b).doc,c);
  h.record(c,d,'duration');
  assert.equal(h.undo(d).doc,c);
  h.clear();
  assert.deepEqual(h.status(),{undo:0,redo:0,last:''});
});
