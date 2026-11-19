import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBlankScore,placeNoteIntoRest,addExpression,setScoreLayoutBreak,
  appendBlankMeasures,setSimpleKeySignature,setScoreMeasureCount,
} from '../src/studio-v4-core.js';
import {buildPlaybackTimeline} from '../src/studio-v4-playback.js';

// Minimal deterministic XML DOM with the operations used by the pure editor.
class Element {
  constructor(localName,attributes={},children=[],raw=''){
    this.localName=localName;this.map={...attributes};this.children=[];this.raw=String(raw);
    this.parentNode=null;this.ownerDocument=null;this.namespaceURI=null;
    for(const child of children)this.appendChild(child);
  }
  get attributes(){return Object.entries(this.map).map(([name,value])=>({name,value}));}
  get textContent(){return this.children.length?this.children.map(x=>x.textContent).join(''):this.raw;}
  set textContent(value){this.raw=String(value);this.children=[];}
  get firstChild(){return this.children[0]||null;}
  get nextSibling(){
    if(!this.parentNode)return null;
    const siblings=this.parentNode.children;return siblings[siblings.indexOf(this)+1]||null;
  }
  getAttribute(name){return this.map[name]??null;}
  setAttribute(name,value){this.map[name]=String(value);}
  removeAttribute(name){delete this.map[name];}
  appendChild(child){this.children.push(child);child.parentNode=this;child.assignDocument(this.ownerDocument);return child;}
  insertBefore(child,before){
    if(!before)return this.appendChild(child);
    const idx=this.children.indexOf(before);
    if(idx<0)throw new Error('Cannot insert before detached element');
    this.children.splice(idx,0,child);child.parentNode=this;child.assignDocument(this.ownerDocument);return child;
  }
  replaceChild(next,old){
    const idx=this.children.indexOf(old);if(idx<0)throw new Error('Detached old child');
    this.children[idx]=next;next.parentNode=this;next.assignDocument(this.ownerDocument);old.parentNode=null;return old;
  }
  removeChild(child){
    const idx=this.children.indexOf(child);if(idx<0)throw new Error('Detached child');
    this.children.splice(idx,1);child.parentNode=null;return child;
  }
  remove(){this.parentNode?.removeChild(this);}
  assignDocument(doc){this.ownerDocument=doc;for(const child of this.children)child.assignDocument(doc);}
  cloneNode(deep=false){return new Element(this.localName,this.map,deep?this.children.map(x=>x.cloneNode(true)):[],this.raw);}
}
class Document{
  constructor(root){this.documentElement=root;root.assignDocument(this);}
  createElementNS(namespace,name){const e=new Element(name);e.namespaceURI=namespace;e.assignDocument(this);return e;}
  cloneNode(){return new Document(this.documentElement.cloneNode(true));}
}
const el=(name,kids=[],attrs={},value='')=>new Element(name,attrs,kids,value);
const num=(name,v)=>el(name,[],{},String(v));
const first=(node,name)=>node.children.find(x=>x.localName===name);
const many=(node,name)=>node.children.filter(x=>x.localName===name);
const attrs=(beats=4,beatType=4)=>{
  return el('attributes',[
    num('divisions',16),
    el('time',[num('beats',beats),num('beat-type',beatType)]),
  ]);
};
const pitch=(step='C',octave=4)=>el('pitch',[num('step',step),num('octave',octave)]);
const note=(duration=16,type='quarter',extra=[])=>el('note',[pitch(),num('duration',duration),num('type',type),...extra]);
const rest=(duration=64,type='whole')=>el('note',[el('rest'),num('duration',duration),num('type',type)]);
function fixture({parts=1,beats=4,noteKind='rest',complex=false}={}){
  const result=[];
  for(let i=0;i<parts;i++){
    const content=[attrs(beats),noteKind==='rest'?rest():note()];
    if(complex)content.push(el('backup',[num('duration',16)]));
    const measure=el('measure',content,{number:'1'});
    result.push(el('part',[measure],{id:'P'+(i+1)}));
  }
  return new Document(el('score-partwise',result));
}
const firstPart=doc=>many(doc.documentElement,'part')[0];
const firstMeasure=doc=>many(firstPart(doc),'measure')[0];
const firstNote=doc=>many(firstMeasure(doc),'note')[0];

test('new 4.0 MusicXML score escapes names and creates the requested staves',()=>{
  const xml=createBlankScore({title:'C & < D',composer:'A "B"',template:'vocal-piano',measures:4});
  assert.match(xml,/<movement-title>C &amp; &lt; D<\/movement-title>/);
  assert.match(xml,/<creator type="composer">A &quot;B&quot;<\/creator>/);
  assert.equal((xml.match(/<part id="/g)||[]).length,2);
  assert.equal((xml.match(/<measure number="/g)||[]).length,8);
  assert.match(xml,/<staves>2<\/staves>/);
  assert.match(xml,/<clef number="2"><sign>F<\/sign><line>4<\/line><\/clef>/);
  assert.equal((xml.match(/<backup><duration>192<\/duration><\/backup>/g)||[]).length,4);
  assert.throws(()=>createBlankScore({template:'unimplemented'}));
  assert.throws(()=>createBlankScore({measures:65}));
});

test('rest entry splits exact remaining beats, preserves input and rejects polyphony',()=>{
  const doc=fixture();
  const updated=placeNoteIntoRest(doc,{partId:'P1',measureIndex:0,eventIndex:0,step:'F',alter:1,octave:4,type:'quarter'});
  const nodes=many(firstMeasure(updated.doc),'note');
  assert.equal(nodes.length,3);
  assert.equal(many(firstMeasure(doc),'note').length,1);
  assert.equal(nodes.reduce((a,n)=>a+Number(first(n,'duration').textContent),0),64);
  assert.equal(first(first(nodes[0],'pitch'),'step').textContent,'F');
  assert.equal(first(first(nodes[0],'pitch'),'alter').textContent,'1');
  assert.deepEqual(nodes.map(n=>Number(first(n,'duration').textContent)),[16,32,16]);
  assert.throws(()=>placeNoteIntoRest(updated.doc,{partId:'P1',measureIndex:0,eventIndex:0,type:'eighth'}));
  assert.throws(()=>placeNoteIntoRest(fixture({complex:true}),{partId:'P1',measureIndex:0,eventIndex:0}));
  assert.throws(()=>placeNoteIntoRest(doc,{partId:'P1',measureIndex:0,eventIndex:0,type:'32nd',octave:99}));
});

test('tempo/dynamic markers and articulation are notation-preserving, reversible changes',()=>{
  const doc=fixture({noteKind:'note'});
  const tempo=addExpression(doc,{partId:'P1',measureIndex:0,eventIndex:0,kind:'tempo',value:120}).doc;
  assert.equal(first(many(firstMeasure(tempo),'direction')[0],'sound').getAttribute('tempo'),'120');
  const dynamic=addExpression(tempo,{partId:'P1',measureIndex:0,eventIndex:0,kind:'dynamic',value:'mf'}).doc;
  assert.equal(many(firstMeasure(dynamic),'direction').length,2);
  const accented=addExpression(dynamic,{partId:'P1',measureIndex:0,eventIndex:0,kind:'accent'}).doc;
  const n=firstNote(accented);
  assert.ok(first(first(first(n,'notations'),'articulations'),'accent'));
  const removed=addExpression(accented,{partId:'P1',measureIndex:0,eventIndex:0,kind:'accent'}).doc;
  assert.equal(first(firstNote(removed),'notations'),undefined);
  assert.equal(first(firstNote(doc),'notations'),undefined);
  assert.throws(()=>addExpression(doc,{partId:'P1',measureIndex:0,eventIndex:0,kind:'tempo',value:999}));
});

test('append measure and concert key changes keep original document immutable',()=>{
  const doc=fixture({parts:2});
  const added=appendBlankMeasures(doc,{count:4}).doc;
  assert.equal(many(firstPart(doc),'measure').length,1);
  assert.equal(many(firstPart(added),'measure').length,5);
  assert.equal(many(many(added.documentElement,'part')[1],'measure').length,5);
  const keyed=setSimpleKeySignature(added,{fifths:-2}).doc;
  assert.equal(first(first(firstMeasure(keyed),'attributes'),'key').localName,'key');
  assert.equal(first(first(first(firstMeasure(keyed),'attributes'),'key'),'fifths').textContent,'-2');
  assert.equal(first(firstMeasure(doc),'attributes').children.some(x=>x.localName==='key'),false);
  assert.throws(()=>appendBlankMeasures(fixture({beats:3}),{count:1}));
  assert.throws(()=>appendBlankMeasures(fixture({complex:true}),{count:1}));
  assert.throws(()=>setSimpleKeySignature(doc,{fifths:8}));
});

test('system and page breaks change all parts consistently and block first measure',()=>{
  const doc=appendBlankMeasures(fixture({parts:2}),{count:1}).doc;
  const result=setScoreLayoutBreak(doc,{measureIndex:1,kind:'system'}).doc;
  for(const part of many(result.documentElement,'part')){
    assert.equal(first(many(part,'measure')[1],'print').getAttribute('new-system'),'yes');
  }
  const page=setScoreLayoutBreak(result,{measureIndex:1,kind:'page'}).doc;
  assert.equal(first(many(firstPart(page),'measure')[1],'print').getAttribute('new-page'),'yes');
  const cleared=setScoreLayoutBreak(page,{measureIndex:1,kind:'none'}).doc;
  assert.equal(first(many(firstPart(cleared),'measure')[1],'print'),undefined);
  assert.throws(()=>setScoreLayoutBreak(doc,{measureIndex:0,kind:'system'}));
  assert.equal(first(many(firstPart(doc),'measure')[1],'print'),undefined);
});

test('Web Audio timeline uses score tempo instead of fallback and preserves parallel voices',()=>{
  const doc=fixture({noteKind:'note'});
  const measure=firstMeasure(doc);
  const direction=el('direction',[
    el('direction-type',[el('metronome',[num('beat-unit','quarter'),num('per-minute',120)])]),
    el('sound',[],{tempo:'120'}),
  ]);
  measure.insertBefore(direction,firstNote(doc));
  const simultaneous=note(16,'quarter',[num('voice',2)]);
  measure.appendChild(el('backup',[num('duration',16)]));
  measure.appendChild(simultaneous);
  const timeline=buildPlaybackTimeline(doc,{defaultBpm:100});
  assert.equal(timeline.tempoChanges[0].bpm,120);
  assert.equal(timeline.events.length,2);
  assert.ok(timeline.events.every(x=>x.start===0&&Math.abs(x.duration-.5)<.0001));
  assert.throws(()=>buildPlaybackTimeline(doc,{defaultBpm:0}));
});


test('current-score bar total grows and shrinks without changing another instrument or original',()=>{
  const source=fixture({parts:2});
  const grown=setScoreMeasureCount(source,{total:21}).doc;
  assert.equal(many(firstPart(source),'measure').length,1);
  assert.equal(many(firstPart(grown),'measure').length,21);
  assert.equal(many(many(grown.documentElement,'part')[1],'measure').length,21);
  assert.deepEqual(many(firstPart(grown),'measure').map(m=>m.getAttribute('number')),
    Array.from({length:21},(_,i)=>String(i+1)));
  const reduced=setScoreMeasureCount(grown,{total:5}).doc;
  assert.equal(many(firstPart(reduced),'measure').length,5);
  assert.equal(many(many(reduced.documentElement,'part')[1],'measure').length,5);
  assert.equal(many(firstPart(grown),'measure').length,21);
  assert.equal(many(firstPart(source),'measure').length,1);
});

test('bar reduction cannot silently delete composed notes or other tail content',()=>{
  const grown=setScoreMeasureCount(fixture({parts:2}),{total:3}).doc;
  const last=many(firstPart(grown),'measure')[2];
  const lastNote=many(last,'note')[0];
  lastNote.replaceChild(pitch('G',4),first(lastNote,'rest'));
  assert.throws(()=>setScoreMeasureCount(grown,{total:2}),/삭제를 차단/);
  assert.equal(many(firstPart(grown),'measure').length,3);
  assert.throws(()=>setScoreMeasureCount(grown,{total:0}),/1~128/);
  assert.throws(()=>setScoreMeasureCount(grown,{total:129}),/1~128/);
  assert.equal(setScoreMeasureCount(grown,{total:3}).change.unchanged,true);
});

test('grand-staff piano bar count edits preserve synchronized backup and both hands',()=>{
  const attributes=attrs();
  attributes.appendChild(num('staves',2));
  const upper=el('note',[el('rest'),num('duration',64),num('voice',1),num('type','whole'),num('staff',1)]);
  const lower=el('note',[el('rest'),num('duration',64),num('voice',2),num('type','whole'),num('staff',2)]);
  const measure=el('measure',[attributes,upper,el('backup',[num('duration',64)]),lower],{number:'1'});
  const doc=new Document(el('score-partwise',[el('part',[measure],{id:'P1'})]));
  const added=setScoreMeasureCount(doc,{total:4}).doc;
  assert.equal(many(firstPart(added),'measure').length,4);
  for(const bar of many(firstPart(added),'measure').slice(1)){
    assert.equal(many(bar,'backup').length,1);
    assert.equal(first(many(bar,'backup')[0],'duration').textContent,'64');
    assert.deepEqual(many(bar,'note').map(n=>first(n,'voice').textContent),['1','2']);
  }
  const shrunk=setScoreMeasureCount(added,{total:2}).doc;
  assert.equal(many(firstPart(shrunk),'measure').length,2);
  assert.equal(many(firstPart(doc),'measure').length,1);
});
