import test from 'node:test';
import assert from 'node:assert/strict';
import {setNoteVerse,toggleSoundingTie} from '../src/studio-v4-composer.js';
class E {
  constructor(localName,attrs={},children=[],raw=''){
    this.localName=localName;this.map={...attrs};this.children=[];this.raw=String(raw);
    this.ownerDocument=null;this.namespaceURI=null;this.parentNode=null;
    for(const node of children)this.appendChild(node);
  }
  get attributes(){return Object.entries(this.map).map(([name,value])=>({name,value}));}
  get textContent(){return this.children.length?this.children.map(x=>x.textContent).join(''):this.raw;}
  set textContent(v){this.raw=String(v);this.children=[];}
  get nextSibling(){if(!this.parentNode)return null;const siblings=this.parentNode.children;return siblings[siblings.indexOf(this)+1]||null;}
  get firstChild(){return this.children[0]||null;}
  getAttribute(name){return this.map[name]??null;}
  setAttribute(name,value){this.map[name]=String(value);}
  removeAttribute(name){delete this.map[name];}
  assignDocument(doc){this.ownerDocument=doc;for(const c of this.children)c.assignDocument(doc);}
  appendChild(child){if(child.parentNode)child.parentNode.removeChild(child);this.children.push(child);child.parentNode=this;child.assignDocument(this.ownerDocument);return child;}
  insertBefore(child,before){
    if(!before)return this.appendChild(child);
    const index=this.children.indexOf(before);if(index<0)throw Error('Invalid sibling');
    if(child.parentNode)child.parentNode.removeChild(child);
    this.children.splice(index,0,child);child.parentNode=this;child.assignDocument(this.ownerDocument);return child;
  }
  removeChild(child){
    const index=this.children.indexOf(child);if(index<0)throw Error('Detached child');
    this.children.splice(index,1);child.parentNode=null;return child;
  }
  cloneNode(deep){return new E(this.localName,this.map,deep?this.children.map(x=>x.cloneNode(true)):[],this.raw);}
}
class Document {
  constructor(root){this.documentElement=root;root.assignDocument(this);}
  createElementNS(ns,name){const node=new E(name);node.namespaceURI=ns;node.assignDocument(this);return node;}
  cloneNode(){return new Document(this.documentElement.cloneNode(true));}
}
const el=(name,children=[],attrs={},raw='')=>new E(name,attrs,children,raw);
const text=(name,value)=>el(name,[],{},String(value));
const get=(n,name)=>n.children.find(x=>x.localName===name);
const gets=(n,name)=>n.children.filter(x=>x.localName===name);
const pitched=(step='C',duration=48,voice=1,staff=1)=>el('note',[
  el('pitch',[text('step',step),text('octave',4)]),
  text('duration',duration),text('voice',voice),text('type','quarter'),text('staff',staff),
]);
function score(){
  return new Document(el('score-partwise',[el('part',[
    el('measure',[
      el('attributes',[text('divisions',48),el('time',[text('beats',4),text('beat-type',4)])]),
      pitched('G'),pitched('C'),pitched('C'),pitched('C'),
    ],{number:'1'}),
    el('measure',[
      pitched('C'),pitched('D'),pitched('E'),pitched('F'),
    ],{number:'2'}),
  ],{id:'P1'})]));
}
const measure=(doc,index)=>gets(get(doc.documentElement,'part'),'measure')[index];
const note=(doc,index,measureIndex=0)=>gets(measure(doc,measureIndex),'note')[index];
const serializer=doc=>{
  function walk(node){return [node.localName,node.attributes,node.children.map(walk),node.children.length?'':node.textContent];}
  return JSON.stringify(walk(doc.documentElement));
};
test('composer: two independent Korean lyric verses and melisma retain all other note data',()=>{
  const original=score(),before=serializer(original);
  const v1=setNoteVerse(original,{partId:'P1',measureIndex:0,eventIndex:0,verse:1,text:'한',syllabic:'begin'}).doc;
  const v2=setNoteVerse(v1,{partId:'P1',measureIndex:0,eventIndex:0,verse:2,text:'two',syllabic:'single'}).doc;
  const v3=setNoteVerse(v2,{partId:'P1',measureIndex:0,eventIndex:0,verse:1,text:'하',syllabic:'middle',extend:'start'}).doc;
  assert.equal(serializer(original),before);
  assert.equal(gets(note(v3,0),'lyric').length,2);
  assert.deepEqual(gets(note(v3,0),'lyric').map(x=>x.getAttribute('number')),['1','2']);
  assert.equal(get(gets(note(v3,0),'lyric')[0],'text').textContent,'하');
  assert.equal(get(gets(note(v3,0),'lyric')[1],'text').textContent,'two');
  assert.equal(get(gets(note(v3,0),'lyric')[0],'extend').getAttribute('type'),'start');
  const deleted=setNoteVerse(v3,{partId:'P1',measureIndex:0,eventIndex:0,verse:1,mode:'remove'}).doc;
  assert.equal(gets(note(deleted,0),'lyric').length,1);
  assert.equal(gets(note(deleted,0),'lyric')[0].getAttribute('number'),'2');
  assert.deepEqual(gets(note(deleted,0),'lyric')[0].children.map(x=>x.localName),['syllabic','text']);
});
test('composer: extend-only lyric is legal but empty accidental text is rejected',()=>{
  const original=score();
  const extended=setNoteVerse(original,{partId:'P1',measureIndex:0,eventIndex:0,verse:2,extend:'stop'}).doc;
  assert.deepEqual(gets(note(extended,0),'lyric')[0].children.map(x=>x.localName),['extend']);
  assert.throws(()=>setNoteVerse(original,{partId:'P1',measureIndex:0,eventIndex:0,text:''}),/가사 또는/);
  assert.throws(()=>setNoteVerse(original,{partId:'P1',measureIndex:0,eventIndex:0,verse:15,text:'안'}),/1~12/);
  assert.throws(()=>setNoteVerse(original,{partId:'P1',measureIndex:0,eventIndex:0,text:'\u0001'}),/100자/);
});
test('composer: tied sound and notation start/stop can be toggled across barlines',()=>{
  const original=score(),before=serializer(original);
  const args={partId:'P1',measureIndex:0,eventIndex:3,endMeasureIndex:1,endEventIndex:0};
  const tied=toggleSoundingTie(original,args).doc;
  assert.equal(serializer(original),before);
  assert.equal(gets(note(tied,3),'tie')[0].getAttribute('type'),'start');
  assert.equal(gets(note(tied,0,1),'tie')[0].getAttribute('type'),'stop');
  assert.equal(get(get(note(tied,3),'notations'),'tied').getAttribute('type'),'start');
  assert.equal(get(get(note(tied,0,1),'notations'),'tied').getAttribute('type'),'stop');
  assert.ok(note(tied,3).children.findIndex(x=>x.localName==='tie')<
    note(tied,3).children.findIndex(x=>x.localName==='voice'));
  assert.equal(serializer(toggleSoundingTie(tied,args).doc),before);
});
test('composer: singing-tie refuses skips, mismatched pitches and different voices',()=>{
  const original=score();
  assert.throws(()=>toggleSoundingTie(original,{partId:'P1',measureIndex:0,eventIndex:0,endMeasureIndex:0,endEventIndex:2}),/연속된/);
  assert.throws(()=>toggleSoundingTie(original,{partId:'P1',measureIndex:0,eventIndex:3,endMeasureIndex:1,endEventIndex:1}),/같은 음정/);
  assert.throws(()=>toggleSoundingTie(original,{partId:'P1',measureIndex:0,eventIndex:3,endMeasureIndex:5,endEventIndex:0}),/연속된 마디/);
  const mutated=score();
  get(note(mutated,0,1),'voice').textContent='2';
  assert.throws(()=>toggleSoundingTie(mutated,{partId:'P1',measureIndex:0,eventIndex:3,endMeasureIndex:1,endEventIndex:0}),/같은 음정.*같은 성부/);
});
test('composer: malformed partial existing sounding tie cannot be silently normalized',()=>{
  const original=score();
  note(original,3).insertBefore(el('tie',[],{type:'start'}),get(note(original,3),'voice'));
  assert.throws(()=>toggleSoundingTie(original,{
    partId:'P1',measureIndex:0,eventIndex:3,endMeasureIndex:1,endEventIndex:0,
  }),/재생·시각/);
});
