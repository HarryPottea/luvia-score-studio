import test from 'node:test';
import assert from 'node:assert/strict';
import {setNoteVerse,toggleSoundingTie} from '../src/studio-v4-composer.js';
import {toggleSlur} from '../src/studio-v4-professional.js';
import {toggleAdvancedArticulation} from '../src/studio-v4-articulations.js';
import {toggleMusicXmlOrnament} from '../src/studio-v4-ornaments.js';
import {insertGraceNote,editGraceNote,removeGraceNote} from '../src/studio-v4-grace-notes.js';
import {assertNotationMutation,insertOrderedNotation} from '../src/studio-v4-notation-guard.js';
import {setKeyAtMeasure,setMeterForEmptyTail} from '../src/studio-v4-meter.js';
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
  assert.throws(()=>toggleSoundingTie(original,{partId:'P1',measureIndex:0,eventIndex:1,endMeasureIndex:0,endEventIndex:3}),/연속된/);
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

function blankMeterScore(){
  const attrs=()=>el('attributes',[
    text('divisions',48),el('time',[text('beats',4),text('beat-type',4)]),
  ]);
  const upper=()=>el('note',[el('rest'),text('duration',192),text('voice',1),text('type','whole'),text('staff',1)]);
  const lower=()=>el('note',[el('rest'),text('duration',192),text('voice',2),text('type','whole'),text('staff',2)]);
  const vocal=()=>el('note',[el('rest'),text('duration',192),text('type','whole')]);
  const vocalMeasures=[0,1].map(i=>el('measure',[
    ...(i===0?[attrs()]:[]),vocal(),
  ],{number:String(i+1)}));
  const pianoMeasures=[0,1].map(i=>el('measure',[
    ...(i===0?[el('attributes',[text('divisions',48),
      el('time',[text('beats',4),text('beat-type',4)]),text('staves',2)])]:[]),
    upper(),el('backup',[text('duration',192)]),lower(),
  ],{number:String(i+1)}));
  return new Document(el('score-partwise',[
    el('part',vocalMeasures,{id:'P1'}),
    el('part',pianoMeasures,{id:'P2'}),
  ]));
}
test('composer: part-synchronized mid-score key change preserves all pitches and timing',()=>{
  const src=score(),before=serializer(src);
  const changed=setKeyAtMeasure(src,{measureIndex:1,fifths:-3}).doc;
  assert.equal(serializer(src),before);
  const attrs=get(measure(changed,1),'attributes');
  assert.ok(attrs);
  assert.equal(get(get(attrs,'key'),'fifths').textContent,'-3');
  assert.deepEqual(gets(measure(changed,1),'note').map(n=>get(n,'duration').textContent),['48','48','48','48']);
  assert.throws(()=>setKeyAtMeasure(src,{measureIndex:1,fifths:9}),/조표/);
});
test('composer: empty 3/4 rebar keeps vocal and two-staff piano voices precisely aligned',()=>{
  const src=blankMeterScore(),before=serializer(src);
  const result=setMeterForEmptyTail(src,{measureIndex:0,beats:3,beatType:4});
  const doc=result.doc;
  assert.equal(serializer(src),before);
  for(const part of gets(doc.documentElement,'part')){
    for(const m of gets(part,'measure')){
      const notes=gets(m,'note');
      assert.ok(notes.every(n=>get(n,'duration').textContent==='144'));
      assert.ok(notes.every(n=>get(n,'type').textContent==='half'));
      assert.ok(notes.every(n=>gets(n,'dot').length===1));
      const backup=get(m,'backup');
      if(backup)assert.equal(get(backup,'duration').textContent,'144');
    }
    const time=get(get(gets(part,'measure')[0],'attributes'),'time');
    assert.equal(get(time,'beats').textContent,'3');
    assert.equal(get(time,'beat-type').textContent,'4');
  }
});
test('composer: meter change refuses already-written score and unsupported meter',()=>{
  const src=score();
  assert.throws(()=>setMeterForEmptyTail(src,{measureIndex:1,beats:3,beatType:4}),/자동 박자 변경/);
  assert.throws(()=>setMeterForEmptyTail(src,{measureIndex:0,beats:5,beatType:8}),/2\/4/);
});

test('stage3: complex symbol stack permits independent edits around two Korean lyric verses and sounding tie',()=>{
  const original=score(),saved=serializer(original);
  const firstPos={partId:'P1',measureIndex:0,eventIndex:1};
  const pair={...firstPos,endEventIndex:2};
  let output=setNoteVerse(original,{...firstPos,verse:1,text:'함께'}).doc;
  output=setNoteVerse(output,{...firstPos,verse:2,text:'Together'}).doc;
  output=toggleAdvancedArticulation(output,{...firstPos,kind:'accent'}).doc;
  output=toggleMusicXmlOrnament(output,{...firstPos,kind:'trill-mark'}).doc;
  output=toggleSlur(output,pair).doc;
  output=toggleSoundingTie(output,pair).doc;
  const enriched=serializer(output),n=note(output,1);
  assert.equal(serializer(original),saved,'source must remain untouched');
  assert.deepEqual(gets(get(n,'notations'),'tied').map(x=>x.getAttribute('type')),['start']);
  assert.deepEqual(get(n,'notations').children.map(x=>x.localName),
    ['tied','slur','ornaments','articulations']);
  assert.equal(get(get(n,'notations'),'ornaments').children[0].localName,'trill-mark');
  assert.equal(get(get(n,'notations'),'articulations').children[0].localName,'accent');
  assert.deepEqual(gets(n,'lyric').map(l=>get(l,'text').textContent),['함께','Together']);

  // Removing each independent symbol must preserve the entire neighboring stack.
  const removedAccent=toggleAdvancedArticulation(output,{...firstPos,kind:'accent'}).doc;
  assert.equal(get(get(note(removedAccent,1),'notations'),'articulations'),undefined);
  assert.ok(get(get(note(removedAccent,1),'notations'),'ornaments'));
  assert.equal(get(note(removedAccent,1),'tie').getAttribute('type'),'start');
  assert.deepEqual(gets(note(removedAccent,1),'lyric').map(l=>get(l,'text').textContent),
    ['함께','Together']);
  const restoredAccent=toggleAdvancedArticulation(removedAccent,{...firstPos,kind:'accent'}).doc;
  assert.equal(serializer(restoredAccent),enriched,'toggle off and back must be byte-structure reversible');

  const removedTrill=toggleMusicXmlOrnament(output,{...firstPos,kind:'trill-mark'}).doc;
  assert.equal(get(get(note(removedTrill,1),'notations'),'ornaments'),undefined);
  assert.ok(get(get(note(removedTrill,1),'notations'),'articulations'));
  assert.ok(get(get(note(removedTrill,1),'notations'),'slur'));
  assert.ok(get(get(note(removedTrill,1),'notations'),'tied'));
  assert.equal(serializer(toggleMusicXmlOrnament(removedTrill,
    {...firstPos,kind:'trill-mark'}).doc),enriched);

  const changedLyric=setNoteVerse(output,{...firstPos,verse:1,text:'우리'}).doc;
  assert.deepEqual(gets(note(changedLyric,1),'lyric').map(l=>get(l,'text').textContent),
    ['우리','Together']);
  assert.deepEqual(get(note(changedLyric,1),'notations').children.map(x=>x.localName),
    ['tied','slur','ornaments','articulations']);
  assert.equal(serializer(setNoteVerse(changedLyric,{...firstPos,verse:1,text:'함께'}).doc),enriched);
  const withoutVerse1=setNoteVerse(output,{...firstPos,verse:1,mode:'remove'}).doc;
  assert.equal(gets(note(withoutVerse1,1),'lyric').length,1);
  assert.equal(get(gets(note(withoutVerse1,1),'lyric')[0],'text').textContent,'Together');

  const untied=toggleSoundingTie(output,pair).doc;
  assert.equal(get(note(untied,1),'tie'),undefined);
  assert.deepEqual(get(note(untied,1),'notations').children.map(x=>x.localName),
    ['slur','ornaments','articulations']);
  assert.equal(serializer(toggleSoundingTie(untied,pair).doc),enriched);
  const unslurred=toggleSlur(output,pair).doc;
  assert.deepEqual(get(note(unslurred,1),'notations').children.map(x=>x.localName),
    ['tied','ornaments','articulations']);
  assert.equal(serializer(toggleSlur(unslurred,pair).doc),enriched);
});
test('stage3: grace insert/edit/remove does not modify tied lyrics or stacked expressions',()=>{
  let output=score();
  const args={partId:'P1',measureIndex:0,eventIndex:1};
  output=setNoteVerse(output,{...args,verse:1,text:'반짝'}).doc;
  output=toggleMusicXmlOrnament(output,{...args,kind:'turn'}).doc;
  output=toggleAdvancedArticulation(output,{...args,kind:'tenuto'}).doc;
  output=toggleSlur(output,{...args,endEventIndex:2}).doc;
  output=toggleSoundingTie(output,{...args,endEventIndex:2}).doc;
  const original=serializer(output);
  const withGrace=insertGraceNote(output,{...args,step:'F',octave:4,type:'eighth',slash:true}).doc;
  const main=note(withGrace,2);
  assert.equal(get(gets(main,'lyric')[0],'text').textContent,'반짝');
  assert.deepEqual(get(main,'notations').children.map(x=>x.localName),
    ['tied','slur','ornaments','articulations']);
  const updated=editGraceNote(withGrace,{...args,step:'A',octave:4,slash:false,type:'16th'}).doc;
  assert.equal(get(get(note(updated,1),'pitch'),'step').textContent,'A');
  assert.equal(get(note(updated,1),'duration'),undefined,'grace remains zero-time');
  assert.equal(get(gets(note(updated,2),'lyric')[0],'text').textContent,'반짝');
  const restored=removeGraceNote(updated,args).doc;
  assert.equal(serializer(restored),original,'ordinary note and entire expression stack unchanged');
});
test('stage3: notation isolation rejects unintended edits to adjacent note, lyric or other part',()=>{
  const original=score();
  const loc={partId:'P1',measureIndex:0,eventIndex:1,
    targets:[{measureIndex:0,eventIndex:1,
      allowed:[{name:'articulations',kind:'accent'}]}]};
  const proper=toggleAdvancedArticulation(original,{partId:'P1',measureIndex:0,
    eventIndex:1,kind:'accent'}).doc;
  assert.equal(assertNotationMutation(original,proper,loc),true);
  const bad=proper.cloneNode(true);
  get(get(note(bad,2),'pitch'),'step').textContent='D';
  assert.throws(()=>assertNotationMutation(original,bad,loc),/허용한 표현/);
  const badLyric=proper.cloneNode(true);
  const lyric=el('lyric',[text('text','유출')],{number:'1'});
  note(badLyric,2).appendChild(lyric);
  assert.throws(()=>assertNotationMutation(original,badLyric,loc),/허용한 표현/);
});
test('stage3: invalid preexisting notation order is safely blocked, never auto-rewritten',()=>{
  const original=score(),target=note(original,1);
  const notation=el('notations',[
    el('articulations',[el('accent')]),el('slur',[],{number:'1',type:'start'})
  ]);
  target.appendChild(notation);
  const before=serializer(original);
  assert.throws(()=>toggleMusicXmlOrnament(original,{partId:'P1',
    measureIndex:0,eventIndex:1,kind:'trill-mark'}),/순서/);
  assert.equal(serializer(original),before);
});
