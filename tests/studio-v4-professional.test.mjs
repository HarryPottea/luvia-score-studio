import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectAdvancedMeasure} from '../src/advanced-score.js';
import {authorTupletGroup} from '../src/studio-v4-tuplet-groups.js';
import {rebarWrittenScore} from '../src/studio-v4-rebar-written.js';
import {extendVoiceAcrossBarline,toggleSlurAcrossBarline,moveVoiceIntoNextMeasure} from '../src/studio-v4-crossbar.js';
import {planLayoutCadence,applyLayoutCadence} from '../src/studio-v4-layout-cadence.js';
import {changeSingleEmptyMeasureMeter} from '../src/studio-v4-meter-single.js';
import {
  editVoiceRhythm,createEighthTriplet,toggleSlur,addHairpin,nudgeVoiceNoteOnGrid,relocateVoiceNote,replaceVoiceNoteWithRest,splitVoiceNoteWithTie
} from '../src/studio-v4-professional.js';

// Deterministic DOM supporting the exact MusicXML tree operations used by the
// isolated notation functions. Chromium separately tests real XML DOM parsing.
class Element {
  constructor(localName,attributes={},children=[],raw=''){
    this.localName=localName;this.map={...attributes};this.children=[];this.raw=String(raw);
    this.ownerDocument=null;this.namespaceURI=null;this.parentNode=null;
    for(const child of children)this.appendChild(child);
  }
  get attributes(){return Object.entries(this.map).map(([name,value])=>({name,value}));}
  get textContent(){return this.children.length?this.children.map(x=>x.textContent).join(''):this.raw;}
  set textContent(t){this.raw=String(t);this.children=[];}
  get nextSibling(){if(!this.parentNode)return null;const siblings=this.parentNode.children;return siblings[siblings.indexOf(this)+1]||null;}
  get firstChild(){return this.children[0]||null;}
  getAttribute(k){return this.map[k]??null;}
  setAttribute(k,v){this.map[k]=String(v);}
  removeAttribute(k){delete this.map[k];}
  appendChild(n){this.children.push(n);n.parentNode=this;n.assignDocument(this.ownerDocument);return n;}
  insertBefore(n,old){
    if(!old)return this.appendChild(n);
    const idx=this.children.indexOf(old);
    if(idx<0)throw new Error('Insert into missing sibling');
    if(n.parentNode)n.parentNode.removeChild(n);
    this.children.splice(idx,0,n);n.parentNode=this;n.assignDocument(this.ownerDocument);return n;
  }
  removeChild(n){const idx=this.children.indexOf(n);if(idx<0)throw new Error('Detached child');this.children.splice(idx,1);n.parentNode=null;return n;}
  replaceChild(n,old){const idx=this.children.indexOf(old);if(idx<0)throw new Error('Detached child');this.children[idx]=n;n.parentNode=this;n.assignDocument(this.ownerDocument);old.parentNode=null;return old;}
  remove(){this.parentNode?.removeChild(this);}
  assignDocument(doc){this.ownerDocument=doc;for(const ch of this.children)ch.assignDocument(doc);}
  cloneNode(deep=false){
    const copy=new Element(this.localName,this.map,deep?this.children.map(x=>x.cloneNode(true)):[],this.raw);
    copy.namespaceURI=this.namespaceURI;
    copy.assignDocument(this.ownerDocument);
    return copy;
  }
}
class Doc {
  constructor(root){this.documentElement=root;root.assignDocument(this);}
  createElementNS(ns,name){const n=new Element(name);n.namespaceURI=ns;n.assignDocument(this);return n;}
  cloneNode(){return new Doc(this.documentElement.cloneNode(true));}
}
const E=(name,kids=[],attrs={},raw='')=>new Element(name,attrs,kids,raw);
const T=(name,text)=>E(name,[],{},String(text));
const children=(n,name)=>n.children.filter(c=>c.localName===name);
const first=(n,name)=>n.children.find(c=>c.localName===name);
const voiceNote=(step,octave,duration,type,voice,staff,beam='')=>{
  const nodes=[E('pitch',[T('step',step),T('octave',octave)]),T('duration',duration),
    T('voice',voice),T('type',type),T('staff',staff)];
  if(beam)nodes.push(E('beam',[],{number:'1'},beam));
  return E('note',nodes);
};
const voiceRest=(duration,type,voice,staff)=>E('note',[
  E('rest'),T('duration',duration),T('voice',voice),T('type',type),T('staff',staff)
]);
function fixture({withBeam=false,firstVoiceRest=false}={}){
  const firstNotes=[
    voiceNote('C',4,24,'eighth','1','1',withBeam?'begin':''),
    voiceNote('E',4,24,'eighth','1','1',withBeam?'end':''),
    voiceRest(48,'quarter','1','1'),
    voiceRest(96,'half','1','1'),
  ];
  const measure=E('measure',[
    E('attributes',[
      T('divisions',48),E('time',[T('beats',4),T('beat-type',4)]),T('staves',2),
    ]),
    ...firstNotes,
    E('backup',[T('duration',192)]),
    voiceNote('C',3,48,'quarter','2','2'),
    voiceRest(48,'quarter','2','2'),
    voiceNote('G',3,96,'half','2','2'),
  ],{number:'1'});
  if(firstVoiceRest)measure.children[0+1]=voiceRest(24,'eighth','1','1');
  return new Doc(E('score-partwise',[E('part',[measure],{id:'P1'})]));
}
const params=(eventIndex=0)=>({partId:'P1',measureIndex:0,eventIndex});
const part=doc=>first(doc.documentElement,'part');
const measure=doc=>first(part(doc),'measure');
const notes=doc=>children(measure(doc),'note');
const serialize=doc=>{
  function walk(node){return [node.localName,node.attributes,
    node.children.map(walk),node.children.length?'':node.textContent];}
  return JSON.stringify(walk(doc.documentElement));
};
const secondVoice=doc=>inspectAdvancedMeasure(doc,'P1',0).events
  .filter(x=>x.voice==='2')
  .map(x=>[x.start,x.duration,x.rest,x.step,x.octave]);
const values=doc=>inspectAdvancedMeasure(doc,'P1',0);
test('professional: changing voice-2 note consumes its rest without touching voice-1 or backup',()=>{
  const original=fixture(),before=serialize(original),beforeVoice1=values(original).events.filter(x=>x.voice==='1');
  const {doc}=editVoiceRhythm(original,{...params(4),mode:'duration',type:'half'});
  assert.equal(serialize(original),before);
  assert.equal(first(children(measure(doc),'backup')[0],'duration').textContent,'192');
  assert.deepEqual(values(doc).events.filter(x=>x.voice==='1'),beforeVoice1);
  assert.deepEqual(secondVoice(doc).map(x=>[x[0],x[1]]),[[0,96],[96,96]]);
});
test('professional: separate-voice rest entry emits a note and conserves both clocks',()=>{
  const original=fixture(),v2=secondVoice(original);
  const {doc}=editVoiceRhythm(original,{...params(2),mode:'insert',type:'eighth',step:'A',octave:4});
  assert.equal(notes(doc).length,8);
  assert.deepEqual(secondVoice(doc),v2);
  assert.deepEqual(values(doc).events.filter(x=>x.voice==='1').map(x=>x.duration),[24,24,24,24,96]);
  assert.equal(values(doc).events[2].step,'A');
  assert.equal(values(original).events[2].rest,true);
});
test('professional: shortening a voice note adds an identical-lane rest',()=>{
  const original=fixture(),v2=secondVoice(original);
  const {doc}=editVoiceRhythm(original,{...params(4),mode:'duration',type:'eighth'});
  assert.deepEqual(secondVoice(doc).map(x=>x[1]),[24,24,48,96]);
  assert.deepEqual(v2.map(x=>x[0]),[0,48,96]);
  assert.equal(first(children(measure(doc),'backup')[0],'duration').textContent,'192');
});
test('professional: beamed eighths become a correctly timed 3:2 bracketed triplet',()=>{
  const original=fixture({withBeam:true}),before=serialize(original),v2=secondVoice(original);
  const {doc}=createEighthTriplet(original,{...params(),step:'D',octave:4});
  assert.equal(serialize(original),before);
  assert.equal(notes(doc).length,8);
  assert.deepEqual(secondVoice(doc),v2);
  assert.deepEqual(values(doc).events.slice(0,3).map(x=>[x.start,x.duration,x.tuplet]),[
    [0,16,true],[16,16,true],[32,16,true]
  ]);
  const first3=notes(doc).slice(0,3);
  assert.deepEqual(first3.map(x=>first(x,'beam')?.textContent),['begin','continue','end']);
  assert.deepEqual(first3.map(x=>first(first(x,'time-modification'),'actual-notes').textContent),['3','3','3']);
  assert.equal(first(first(first3[0],'notations'),'tuplet').getAttribute('type'),'start');
  assert.equal(first(first(first3[2],'notations'),'tuplet').getAttribute('type'),'stop');
  assert.throws(()=>editVoiceRhythm(doc,{...params(),mode:'duration',type:'quarter'}),/셋잇단음/);
});
test('professional: hairpin and slur do not change pitch, duration or backup controls',()=>{
  const original=fixture(),before=values(original);
  const slur=toggleSlur(original,{...params(),endEventIndex:1}).doc;
  assert.equal(first(first(notes(slur)[0],'notations'),'slur').getAttribute('type'),'start');
  assert.equal(first(first(notes(slur)[1],'notations'),'slur').getAttribute('type'),'stop');
  const removed=toggleSlur(slur,{...params(),endEventIndex:1}).doc;
  assert.equal(first(notes(removed)[0],'notations'),undefined);
  const wedges=addHairpin(original,{...params(),endEventIndex:1,kind:'crescendo'}).doc;
  const types=children(measure(wedges),'direction')
    .map(d=>first(first(d,'direction-type'),'wedge').getAttribute('type'));
  assert.deepEqual(types,['crescendo','stop']);
  assert.deepEqual(values(wedges).events,before.events);
  assert.deepEqual(values(slur).events.map(x=>[x.start,x.duration]),before.events.map(x=>[x.start,x.duration]));
});
test('professional: reject cross-voice spans, impure beams, impossible tuplets and insufficient rests',()=>{
  const doc=fixture();
  assert.throws(()=>toggleSlur(doc,{...params(),endEventIndex:5}),/같은 성부/);
  assert.throws(()=>addHairpin(doc,{...params(),endEventIndex:5}),/같은 성부/);
  assert.throws(()=>editVoiceRhythm(doc,{...params(4),mode:'duration',type:'whole'}),/쉼표가 충분하지/);
  const bad=fixture({withBeam:true});
  first(notes(bad)[1],'beam').textContent='continue';
  assert.throws(()=>createEighthTriplet(bad,{...params()}),/빔/);
  const noDiv=fixture();
  // Keep the score semantically valid while using divisions=16. The 3:2
  // conversion is impossible because an eighth-triplet requires thirds.
  first(first(measure(noDiv),'attributes'),'divisions').textContent='16';
  for(const item of [...notes(noDiv),...children(measure(noDiv),'backup')])
    first(item,'duration').textContent=String(Number(first(item,'duration').textContent)/3);
  assert.equal(values(noDiv).reason,null);
  assert.throws(()=>createEighthTriplet(noDiv,{...params()}),/divisions/);
  assert.equal(values(doc).reason,null);
});


test('professional: nudge a note later into a rest without shifting the other piano voice',()=>{
  const original=fixture(),before=serialize(original),v2=secondVoice(original);
  const result=nudgeVoiceNoteOnGrid(original,{...params(1),direction:'later',grid:'16th'});
  assert.equal(serialize(original),before);
  assert.deepEqual(secondVoice(result.doc),v2);
  const events=values(result.doc).events;
  const shifted=events.find(e=>e.step==='E'&&e.voice==='1');
  assert.equal(shifted.start,36);
  assert.equal(shifted.duration,24);
  assert.equal(events.filter(e=>e.voice==='1'&&!e.chord).reduce((sum,e)=>sum+e.duration,0),192);
  assert.equal(first(children(measure(result.doc),'backup')[0],'duration').textContent,'192');
  assert.deepEqual(events.filter(e=>e.voice==='1'&&e.rest).map(e=>e.duration),[12,24,12,96]);
});
test('professional: nudge a note earlier into an immediate rest with exact grid math',()=>{
  const original=fixture();
  const firstNote=notes(original)[0];
  measure(original).replaceChild(voiceRest(24,'eighth','1','1'),firstNote);
  const before=serialize(original),v2=secondVoice(original);
  const changed=nudgeVoiceNoteOnGrid(original,{...params(1),direction:'earlier',grid:'16th'});
  assert.equal(serialize(original),before);
  assert.deepEqual(secondVoice(changed.doc),v2);
  const events=values(changed.doc).events;
  const moved=events.find(e=>e.step==='E'&&e.voice==='1');
  assert.equal(moved.start,12);
  assert.equal(moved.duration,24);
  assert.deepEqual(events.filter(e=>e.voice==='1'&&e.rest).map(e=>e.duration),[12,12,48,96]);
});
test('professional: protect existing notes when no adjacent rest, no precise subdivision or mismatched voice',()=>{
  const original=fixture(),before=serialize(original);
  assert.throws(()=>nudgeVoiceNoteOnGrid(original,{...params(0),direction:'later',grid:'16th'}),/쉼표/);
  assert.throws(()=>nudgeVoiceNoteOnGrid(original,{...params(1),direction:'earlier',grid:'16th'}),/쉼표/);
  assert.throws(()=>nudgeVoiceNoteOnGrid(original,{...params(1),direction:'later',grid:'64th'}),/올바르지/);
  assert.throws(()=>nudgeVoiceNoteOnGrid(original,{...params(4),direction:'earlier',grid:'16th'}),/쉼표|복잡한/);
  assert.equal(serialize(original),before);
});


test('professional: exact beat placement crosses multiple consecutive rests without touching voice 2',()=>{
  const original=fixture(),unchanged=serialize(original),second=secondVoice(original);
  const result=relocateVoiceNote(original,{...params(1),targetBeat:3,grid:'16th'});
  assert.equal(serialize(original),unchanged);
  assert.deepEqual(secondVoice(result.doc),second);
  const moved=values(result.doc).events.filter(e=>e.voice==='1');
  assert.deepEqual(moved.map(e=>[e.start,e.duration,e.rest,e.step]),[
    [0,24,false,'C'],[24,48,true,''],[72,24,true,''],
    [96,24,false,'E'],[120,48,true,''],[168,24,true,''],
  ]);
  assert.equal(result.change.nextEventIndex,3);
  assert.equal(result.change.fromTick,24);
  assert.equal(result.change.toTick,96);
  assert.equal(first(children(measure(result.doc),'backup')[0],'duration').textContent,'192');
});
test('professional: move left across rest islands, preserving source, original note and beat total',()=>{
  const original=fixture();
  measure(original).replaceChild(voiceRest(24,'eighth','1','1'),notes(original)[0]);
  const serialized=serialize(original);
  const next=relocateVoiceNote(original,{...params(1),targetBeat:1.25,grid:'16th'});
  assert.equal(serialize(original),serialized);
  const events=values(next.doc).events;
  const moved=events.find(e=>e.step==='E');
  assert.equal(moved.start,12);assert.equal(moved.duration,24);
  assert.equal(events.filter(e=>e.voice==='1'&&!e.chord).reduce((sum,e)=>sum+e.duration,0),192);
  assert.deepEqual(secondVoice(next.doc),secondVoice(original));
});
test('professional: reject non-grid targets, occupied notes, crossing backup and protected markup',()=>{
  const original=fixture(),serial=serialize(original);
  assert.throws(()=>relocateVoiceNote(original,{...params(1),targetBeat:1,grid:'16th'}),/연속된 빈 쉼표/);
  assert.throws(()=>relocateVoiceNote(original,{...params(1),targetBeat:2.1,grid:'16th'}),/격자/);
  assert.throws(()=>relocateVoiceNote(original,{...params(1),targetBeat:8,grid:'16th'}),/격자/);
  assert.throws(()=>relocateVoiceNote(original,{...params(1),targetBeat:1.5,grid:'16th'}),/해당 박자/);
  assert.throws(()=>relocateVoiceNote(original,{...params(4),targetBeat:4.5,grid:'16th'}),/연속된 빈 쉼표/);
  const protectedDoc=fixture();
  notes(protectedDoc)[1].appendChild(E('tie',[],{type:'start'}));
  assert.throws(()=>relocateVoiceNote(protectedDoc,{...params(1),targetBeat:3,grid:'16th'}),/붙임줄|복잡한/);
  assert.equal(serialize(original),serial);
});

test('professional: polyphonic note-to-rest preserves full timeline and unrelated notes',()=>{
  const original=fixture(),before=serialize(original),other=secondVoice(original);
  const changed=replaceVoiceNoteWithRest(original,params(1)).doc;
  assert.equal(serialize(original),before);
  assert.deepEqual(secondVoice(changed),other);
  const changedEvents=values(changed).events;
  assert.equal(changedEvents[1].rest,true);
  assert.equal(changedEvents[1].duration,24);
  assert.equal(changedEvents[1].start,24);
  assert.equal(first(children(measure(changed),'backup')[0],'duration').textContent,'192');
  assert.equal(values(changed).reason,null);
});
test('professional: protect lyric-bearing, chord and tupletted notes against implicit deletion',()=>{
  const original=fixture(),lyric=notes(original)[1];
  lyric.appendChild(E('lyric',[T('text','한')]));
  assert.throws(()=>replaceVoiceNoteWithRest(original,params(1)),/가사/);
  assert.equal(first(lyric,'pitch')!==undefined,true);
  const tuple=fixture();notes(tuple)[1].appendChild(E('time-modification',[
    T('actual-notes',3),T('normal-notes',2)]));
  assert.throws(()=>replaceVoiceNoteWithRest(tuple,params(1)),/보호|기보|시간/);
});

test('professional: quarter-note pair becomes a three-note 3:2 quarter triplet',()=>{
  const original=fixture(),measureNode=measure(original);
  for(const note of notes(original).slice(0,2)){
    first(note,'duration').textContent='48';
    first(note,'type').textContent='quarter';
  }
  first(notes(original)[3],'duration').textContent='48';
  first(notes(original)[3],'type').textContent='quarter';
  assert.equal(values(original).reason,null);
  const other=secondVoice(original),before=serialize(original);
  const converted=createEighthTriplet(original,{...params(),step:'F',octave:4}).doc;
  assert.equal(serialize(original),before);
  assert.deepEqual(secondVoice(converted),other);
  assert.deepEqual(values(converted).events.slice(0,3).map(e=>[
    e.start,e.duration,e.type,e.tuplet]),[
    [0,32,'quarter',true],[32,32,'quarter',true],[64,32,'quarter',true]
  ]);
  assert.equal(first(first(notes(converted)[1],'time-modification'),'normal-type').textContent,'quarter');
});
test('professional: sixteenth pair creates precise 3:2 rhythm and preserves backing voice',()=>{
  const original=fixture();
  for(const note of notes(original).slice(0,2)){
    first(note,'duration').textContent='12';
    first(note,'type').textContent='16th';
  }
  measure(original).insertBefore(voiceRest(24,'eighth','1','1'),notes(original)[2]);
  assert.equal(values(original).reason,null);
  const other=secondVoice(original),before=serialize(original);
  const converted=createEighthTriplet(original,{...params(),step:'D',octave:4}).doc;
  assert.equal(serialize(original),before);
  assert.deepEqual(secondVoice(converted),other);
  assert.deepEqual(values(converted).events.slice(0,3).map(e=>[
    e.start,e.duration,e.type,e.tuplet]),[
    [0,8,'16th',true],[8,8,'16th',true],[16,8,'16th',true]
  ]);
  assert.equal(first(first(notes(converted)[1],'time-modification'),'normal-type').textContent,'16th');
});
test('professional: protect the second note lyric when converting into tuplets',()=>{
  const doc=fixture();
  notes(doc)[1].appendChild(E('lyric',[T('text','소중한')]));
  const before=serialize(doc);
  assert.throws(()=>createEighthTriplet(doc,{...params(),step:'G'}),/가사/);
  assert.equal(serialize(doc),before);
});

test('professional: split a polyphonic half note into two tied quarters with exact duration',()=>{
  const original=fixture(),before=serialize(original),unaffectedVoice=values(original).events.filter(x=>x.voice==='1');
  const result=splitVoiceNoteWithTie(original,{...params(6),firstType:'quarter'});
  assert.equal(serialize(original),before,'The input document remains immutable');
  assert.deepEqual(values(result.doc).events.filter(x=>x.voice==='1'),unaffectedVoice);
  assert.deepEqual(secondVoice(result.doc).map(x=>[x[0],x[1],x[3]]),[
    [0,48,'C'],[48,48,''],[96,48,'G'],[144,48,'G']]);
  const halves=notes(result.doc).filter(x=>first(x,'pitch')?.children?.some(y=>y.localName==='step'&&y.textContent==='G'));
  assert.equal(halves.length,2);
  assert.deepEqual(halves.map(x=>first(x,'tie')?.getAttribute('type')),['start','stop']);
  assert.deepEqual(halves.map(x=>first(first(x,'notations'),'tied')?.getAttribute('type')),['start','stop']);
  assert.equal(first(children(measure(result.doc),'backup')[0],'duration').textContent,'192');
});
test('professional: splitting a lyric note preserves the syllable only on the first segment',()=>{
  const original=fixture(),sustained=notes(original)[6];
  sustained.appendChild(E('lyric',[T('text','오늘')]));
  const result=splitVoiceNoteWithTie(original,{...params(6),firstType:'quarter'});
  const pitches=notes(result.doc).filter(x=>first(x,'pitch')?.children?.some(y=>y.localName==='step'&&y.textContent==='G'));
  assert.equal(first(first(pitches[0],'lyric'),'text').textContent,'오늘');
  assert.equal(first(pitches[1],'lyric'),undefined);
  assert.equal(first(sustained,'duration').textContent,'96');
});
test('professional: unrepresentable or protected note splits are blocked',()=>{
  const original=fixture(),serial=serialize(original);
  assert.throws(()=>splitVoiceNoteWithTie(original,{...params(0),firstType:'quarter'}),/나눌 수 없는/);
  assert.throws(()=>splitVoiceNoteWithTie(original,{...params(0),firstType:'32nd'}),/나눌 수 없는/);
  assert.throws(()=>splitVoiceNoteWithTie(original,{...params(2),firstType:'16th'}),/대상이 아닙니다/);
  const marked=fixture();
  notes(marked)[6].appendChild(E('tie',[],{type:'start'}));
  assert.throws(()=>splitVoiceNoteWithTie(marked,{...params(6),firstType:'quarter'}),/보호|복합/);
  assert.equal(serialize(original),serial);
});


function crossbarFixture(){
  const doc=fixture();
  part(doc).appendChild(E('measure',[
    voiceRest(192,'whole','1','1'),
    E('backup',[T('duration',192)]),
    voiceRest(96,'half','2','2'),
    voiceNote('A',3,96,'half','2','2'),
  ],{number:'2'}));
  return doc;
}
const secondMeasure=doc=>children(part(doc),'measure')[1];
const secondAudit=doc=>inspectAdvancedMeasure(doc,'P1',1);

test('crossbar: continue last piano voice note into next bar while preserving the other staff',()=>{
  const source=crossbarFixture(),original=serialize(source),b=secondAudit(source);
  assert.equal(b.reason,null);
  const result=extendVoiceAcrossBarline(source,{...params(6),continuationType:'quarter'});
  assert.equal(serialize(source),original);
  assert.deepEqual(values(result.doc).events.filter(e=>e.voice==='1'),values(source).events.filter(e=>e.voice==='1'));
  assert.deepEqual(secondAudit(result.doc).events.filter(e=>e.voice==='1'),b.events.filter(e=>e.voice==='1'));
  const events=secondAudit(result.doc).events.filter(e=>e.voice==='2');
  assert.deepEqual(events.map(e=>[e.start,e.duration,e.rest,e.step]),[
    [0,48,false,'G'],[48,48,true,''],[96,96,false,'A']
  ]);
  assert.equal(first(children(measure(result.doc),'backup')[0],'duration').textContent,'192');
  assert.equal(first(children(secondMeasure(result.doc),'backup')[0],'duration').textContent,'192');
  const firstBar=children(measure(result.doc),'note')[6];
  const continuation=children(secondMeasure(result.doc),'note')[1];
  assert.equal(first(firstBar,'tie').getAttribute('type'),'start');
  assert.equal(first(continuation,'tie').getAttribute('type'),'stop');
  assert.equal(first(first(firstBar,'notations'),'tied').getAttribute('type'),'start');
  assert.equal(first(first(continuation,'notations'),'tied').getAttribute('type'),'stop');
});
test('crossbar: disallow overwriting written music, unsupported timing, or existing ties',()=>{
  const source=crossbarFixture(),original=serialize(source);
  assert.throws(()=>extendVoiceAcrossBarline(source,{...params(5),continuationType:'quarter'}),/마디 끝/);
  assert.throws(()=>extendVoiceAcrossBarline(source,{...params(6),continuationType:'whole'}),/쉼표보다 긴/);
  assert.throws(()=>extendVoiceAcrossBarline(source,{...params(6),continuationType:'invalid'}),/길이/);
  const noRest=crossbarFixture();
  secondMeasure(noRest).replaceChild(voiceNote('F',3,96,'half','2','2'),children(secondMeasure(noRest),'note')[1]);
  assert.throws(()=>extendVoiceAcrossBarline(noRest,{...params(6),continuationType:'quarter'}),/첫 박자|쉼표/);
  const marked=crossbarFixture();
  children(measure(marked),'note')[6].appendChild(E('tie',[],{type:'start'}));
  assert.throws(()=>extendVoiceAcrossBarline(marked,{...params(6),continuationType:'quarter'}),/보호/);
  assert.equal(serialize(source),original);
});
test('crossbar: cross-measure slurs are reversible and leave voice timing unchanged',()=>{
  const source=crossbarFixture(),original=serialize(source);
  const opts={...params(6),endEventIndex:2};
  const attached=toggleSlurAcrossBarline(source,opts).doc;
  assert.equal(serialize(source),original);
  const from=children(measure(attached),'note')[6],to=children(secondMeasure(attached),'note')[2];
  assert.equal(first(first(from,'notations'),'slur').getAttribute('type'),'start');
  assert.equal(first(first(to,'notations'),'slur').getAttribute('type'),'stop');
  assert.deepEqual(secondAudit(attached).events.map(e=>[e.start,e.duration,e.voice,e.staff]),
    secondAudit(source).events.map(e=>[e.start,e.duration,e.voice,e.staff]));
  const detached=toggleSlurAcrossBarline(attached,opts).doc;
  assert.equal(serialize(detached),original);
});
test('crossbar: slurs cannot silently cross voices or missing measures',()=>{
  const source=crossbarFixture();
  assert.throws(()=>toggleSlurAcrossBarline(source,{...params(6),endEventIndex:0}),/같은 성부/);
  assert.throws(()=>toggleSlurAcrossBarline(source,{...params(6),endEventIndex:99}),/음표가 없습니다/);
  const single=fixture();
  assert.throws(()=>extendVoiceAcrossBarline(single,{...params(6)}),/다음 마디/);
});


function layoutFixture(){
  const doc=fixture(),original=measure(doc);
  for(let i=2;i<=8;i++){
    const copy=original.cloneNode(true);copy.setAttribute('number',String(i));
    part(doc).appendChild(copy);
  }
  const second=part(doc).cloneNode(true);second.setAttribute('id','P2');
  doc.documentElement.appendChild(second);
  return doc;
}
test('engraving: cadence writes repeatable system and page breaks across every part',()=>{
  const original=layoutFixture(),before=serialize(original);
  const planned=planLayoutCadence(original,{barsPerSystem:2,systemsPerPage:2});
  assert.equal(planned.parts,2);
  assert.equal(planned.total,8);
  assert.equal(planned.systemStarts,2);
  assert.equal(planned.pageStarts,1);
  const {doc}=applyLayoutCadence(original,{barsPerSystem:2,systemsPerPage:2});
  assert.equal(serialize(original),before);
  for(const p of children(doc.documentElement,'part')){
    const measures=children(p,'measure');
    assert.equal(first(measures[2],'print').getAttribute('new-system'),'yes');
    assert.equal(first(measures[4],'print').getAttribute('new-page'),'yes');
    assert.equal(first(measures[6],'print').getAttribute('new-system'),'yes');
    assert.equal(first(measures[1],'print'),undefined);
    assert.equal(first(measures[3],'print'),undefined);
    assert.deepEqual(children(measures[7],'note').map(n=>first(n,'duration').textContent),
      children(measure(original),'note').map(n=>first(n,'duration').textContent));
  }
});
test('engraving: manual break conflicts are protected until user opts into replacement',()=>{
  const original=layoutFixture(),measure4=children(part(original),'measure')[3];
  const print=E('print',[],{'new-page':'yes','staff-spacing':'18'});
  measure4.insertBefore(print,measure4.children[0]);
  const before=serialize(original);
  assert.throws(()=>applyLayoutCadence(original,{barsPerSystem:2,systemsPerPage:2}),/수동|충돌/);
  const applied=applyLayoutCadence(original,{barsPerSystem:2,systemsPerPage:2,replaceExisting:true}).doc;
  assert.equal(serialize(original),before);
  const preserved=first(children(part(applied),'measure')[3],'print');
  assert.equal(preserved.getAttribute('new-page'),null);
  assert.equal(preserved.getAttribute('staff-spacing'),'18','Other print settings remain intact');
  assert.throws(()=>planLayoutCadence(original,{barsPerSystem:7,systemsPerPage:2}),/지원 범위/);
});


test('professional: dotted eighth entry consumes only correct ticks in an independent voice',()=>{
  const source=fixture(),other=secondVoice(source),before=serialize(source);
  const {doc}=editVoiceRhythm(source,{...params(2),mode:'insert',
    type:'eighth-dotted',step:'A',octave:4});
  assert.equal(serialize(source),before);
  assert.deepEqual(secondVoice(doc),other);
  assert.deepEqual(values(doc).events.slice(2,4).map(e=>[e.duration,e.type,e.rest]),[
    [36,'eighth',false],[12,'16th',true]
  ]);
  assert.equal(children(notes(doc)[2],'dot').length,1);
  const removed=replaceVoiceNoteWithRest(doc,params(2)).doc;
  assert.equal(values(removed).events[2].duration,36);
  assert.equal(values(removed).events[2].rest,true);
  assert.equal(children(notes(removed)[2],'dot').length,1);
});
test('professional: dotted quarter duration and tied split preserve unrelated piano voice',()=>{
  const original=fixture(),other=secondVoice(original);
  const shortened=editVoiceRhythm(original,{...params(6),mode:'duration',type:'quarter-dotted'}).doc;
  assert.deepEqual(values(shortened).events.filter(e=>e.voice==='2').map(e=>[e.start,e.duration,e.rest]),[
    [0,48,false],[48,48,true],[96,72,false],[168,24,true]]);
  assert.equal(children(notes(shortened)[6],'dot').length,1);
  const tied=splitVoiceNoteWithTie(shortened,{...params(6),firstType:'quarter'}).doc;
  const second=values(tied).events.filter(e=>e.voice==='2');
  assert.deepEqual(second.map(e=>[e.start,e.duration,e.rest]),[
    [0,48,false],[48,48,true],[96,48,false],[144,24,false],[168,24,true]
  ]);
  assert.equal(children(notes(tied)[6],'dot').length,0);
  assert.equal(children(notes(tied)[7],'dot').length,0);
  assert.equal(first(notes(tied)[6],'tie').getAttribute('type'),'start');
  assert.equal(first(notes(tied)[7],'tie').getAttribute('type'),'stop');
  assert.deepEqual(values(tied).events.filter(e=>e.voice==='1'),
    values(original).events.filter(e=>e.voice==='1'));
  assert.equal(first(children(measure(tied),'backup')[0],'duration').textContent,'192');
});

function isolatedEmptyMeterFixture(){
  const doc=fixture();
  part(doc).appendChild(E('measure',[
    voiceRest(192,'whole','1','1'),E('backup',[T('duration',192)]),
    voiceRest(192,'whole','2','2'),
  ],{number:'2'}));
  const populated=measure(doc).cloneNode(true);
  populated.setAttribute('number','3');
  const attrs=first(populated,'attributes');
  populated.removeChild(attrs);
  part(doc).appendChild(populated);
  return doc;
}
test('meter: change only an empty middle bar and restore 4/4 before following written voices',()=>{
  const original=isolatedEmptyMeterFixture(),before=serialize(original);
  const {doc}=changeSingleEmptyMeasureMeter(original,{measureIndex:1,beats:3,beatType:4});
  assert.equal(serialize(original),before);
  const bars=children(part(doc),'measure');
  const changed=bars[1],following=bars[2];
  assert.equal(first(first(first(changed,'attributes'),'time'),'beats').textContent,'3');
  assert.equal(first(first(first(following,'attributes'),'time'),'beats').textContent,'4');
  assert.deepEqual(children(changed,'note').map(n=>first(n,'duration').textContent),['144','144']);
  assert.deepEqual(children(changed,'note').map(n=>first(n,'type').textContent),['half','half']);
  assert.deepEqual(children(changed,'note').map(n=>children(n,'dot').length),[1,1]);
  assert.equal(first(first(changed,'backup'),'duration').textContent,'144');
  assert.deepEqual(children(following,'note').map(n=>first(n,'duration').textContent),
    children(measure(original),'note').map(n=>first(n,'duration').textContent));
  assert.equal(first(first(following,'backup'),'duration').textContent,'192');
});
test('meter: isolated change refuses written music or missing part clocks',()=>{
  const original=isolatedEmptyMeterFixture(),before=serialize(original);
  assert.throws(()=>changeSingleEmptyMeasureMeter(original,{measureIndex:0,beats:3,beatType:4}),/빈 쉼표|음표·가사/);
  assert.throws(()=>changeSingleEmptyMeasureMeter(original,{measureIndex:1,beats:7,beatType:8}),/지원 범위/);
  const modified=isolatedEmptyMeterFixture();
  const second=children(part(modified),'measure')[1];
  second.replaceChild(voiceNote('C',3,192,'whole','2','2'),children(second,'note')[1]);
  assert.throws(()=>changeSingleEmptyMeasureMeter(modified,{measureIndex:1,beats:2,beatType:4}),/빈 쉼표|음표·가사/);
  assert.equal(serialize(original),before);
});


test('professional: note entry spans two successive rests while leaving the other piano voice unchanged',()=>{
  const original=fixture(),before=serialize(original),other=secondVoice(original);
  // The original 48+96 tick consecutive rests can accommodate a 96 tick half.
  const updated=editVoiceRhythm(original,{...params(2),mode:'insert',
    type:'half',step:'A',octave:4}).doc;
  assert.equal(serialize(original),before);
  assert.deepEqual(secondVoice(updated),other);
  assert.deepEqual(values(updated).events.filter(e=>e.voice==='1').map(e=>
    [e.start,e.duration,e.rest,e.step]),[
    [0,24,false,'C'],[24,24,false,'E'],
    [48,96,false,'A'],[144,48,true,'']
  ]);
  assert.equal(first(children(measure(updated),'backup')[0],'duration').textContent,'192');
  assert.equal(values(updated).reason,null);
});
test('professional: multi-rest entry blocks an occupied beat and leaves source unchanged',()=>{
  const original=fixture(),before=serialize(original);
  assert.throws(()=>editVoiceRhythm(original,{...params(2),mode:'insert',
    type:'whole',step:'A',octave:4}),/연속된 쉼표/);
  const blocked=fixture();
  measure(blocked).insertBefore(E('direction',[E('direction-type',[T('words','rit.')])]),notes(blocked)[3]);
  const old=serialize(blocked);
  assert.throws(()=>editVoiceRhythm(blocked,{...params(2),mode:'insert',
    type:'half',step:'A',octave:4}),/연속된 쉼표/);
  assert.equal(serialize(original),before);
  assert.equal(serialize(blocked),old);
});

test('crossbar: moving an onset to the next bar preserves both piano voices and selection',()=>{
  const source=crossbarFixture(),before=serialize(source);
  const leftVoice=values(source).events.filter(e=>e.voice==='1');
  const rightVoice=secondAudit(source).events.filter(e=>e.voice==='1');
  const moved=moveVoiceIntoNextMeasure(source,params(6));
  assert.equal(serialize(source),before);
  assert.deepEqual(values(moved.doc).events.filter(e=>e.voice==='1'),leftVoice);
  assert.deepEqual(secondAudit(moved.doc).events.filter(e=>e.voice==='1'),rightVoice);
  assert.deepEqual(values(moved.doc).events.filter(e=>e.voice==='2')
    .map(e=>[e.start,e.duration,e.rest,e.step]),[
    [0,48,false,'C'],[48,48,true,''],[96,96,true,'']
  ]);
  assert.deepEqual(secondAudit(moved.doc).events.filter(e=>e.voice==='2')
    .map(e=>[e.start,e.duration,e.rest,e.step]),[
    [0,96,false,'G'],[96,96,false,'A']
  ]);
  assert.equal(moved.change.nextMeasureIndex,1);
  assert.equal(moved.change.nextEventIndex,1);
  assert.equal(first(children(measure(moved.doc),'backup')[0],'duration').textContent,'192');
  assert.equal(first(children(secondMeasure(moved.doc),'backup')[0],'duration').textContent,'192');
});
test('crossbar: moving a lyric note preserves attached lyric and rejects key changes',()=>{
  const source=crossbarFixture();
  notes(source)[6].appendChild(E('lyric',[T('text','함께')]));
  const result=moveVoiceIntoNextMeasure(source,params(6)).doc;
  assert.equal(first(first(children(secondMeasure(result),'note')[1],'lyric'),'text').textContent,'함께');
  assert.equal(first(notes(source)[6],'pitch')!==undefined,true);
  const keyed=crossbarFixture();
  const attrs=E('attributes',[E('key',[T('fifths',1)])]);
  secondMeasure(keyed).insertBefore(attrs,secondMeasure(keyed).children[0]);
  assert.throws(()=>moveVoiceIntoNextMeasure(keyed,params(6)),/조표/);
});
test('crossbar: move cannot silently overwrite a note, bridge a longer rest or lose source',()=>{
  const source=crossbarFixture(),before=serialize(source);
  assert.throws(()=>moveVoiceIntoNextMeasure(source,params(5)),/마디 끝/);
  const occupied=crossbarFixture();
  secondMeasure(occupied).replaceChild(voiceNote('F',3,96,'half','2','2'),
    children(secondMeasure(occupied),'note')[1]);
  assert.throws(()=>moveVoiceIntoNextMeasure(occupied,params(6)),/쉼표/);
  const tooShort=crossbarFixture();
  const rest=children(secondMeasure(tooShort),'note')[1];
  first(rest,'duration').textContent='48';first(rest,'type').textContent='quarter';
  secondMeasure(tooShort).insertBefore(voiceRest(48,'quarter','2','2'),
    children(secondMeasure(tooShort),'note')[2]);
  assert.throws(()=>moveVoiceIntoNextMeasure(tooShort,params(6)),/짧습니다/);
  assert.equal(serialize(source),before);
});


test('crossbar: multi-measure slur connects endpoints while preserving the intervening bar',()=>{
  const original=crossbarFixture();
  const extra=secondMeasure(original).cloneNode(true);extra.setAttribute('number','3');
  part(original).appendChild(extra);
  const untouched=serialize(original);
  const middle=serialize(new Doc(secondMeasure(original).cloneNode(true)));
  const options={...params(6),endMeasureOffset:2,endEventIndex:2};
  const connected=toggleSlurAcrossBarline(original,options).doc;
  assert.equal(serialize(original),untouched);
  assert.equal(serialize(new Doc(secondMeasure(connected).cloneNode(true))),middle);
  const opening=first(first(notes(connected)[6],'notations'),'slur');
  const closing=first(first(children(children(part(connected),'measure')[2],'note')[2],'notations'),'slur');
  assert.equal(opening.getAttribute('type'),'start');
  assert.equal(closing.getAttribute('type'),'stop');
  const restored=toggleSlurAcrossBarline(connected,options).doc;
  assert.equal(serialize(restored),untouched);
  assert.throws(()=>toggleSlurAcrossBarline(original,{...options,endMeasureOffset:9}),/거리/);
});

function groupedTupletFixture(type='16th'){
  const source=fixture(),m=measure(source);
  const old=children(m,'note'),duration=type==='16th'?12:type==='eighth'?24:48;
  for(let i=0;i<4;i++){
    const next=voiceNote(['C','E','G','B'][i],4,duration,type,'1','1');
    m.replaceChild(next,old[i]);
  }
  const beforeBackup=first(m,'backup'),unused=192-4*duration;
  if(unused>=96){m.insertBefore(voiceRest(96,'half','1','1'),beforeBackup);}
  const remaining=unused-(unused>=96?96:0);
  if(remaining>=48)m.insertBefore(voiceRest(48,'quarter','1','1'),beforeBackup);
  if(remaining%48)throw Error('Unsupported test duration');
  assert.equal(inspectAdvancedMeasure(source,'P1',0).reason,null);
  return source;
}
for(const [ratio,type,expectedFactor,actual,normal] of [
  ['3:2','16th',1,3,2],
  ['5:4','16th',5,5,4],
  ['6:4','16th',1,6,4],
  ['7:4','16th',7,7,4],
  ['5:4','eighth',5,5,4],
]){
  test('tuplets: '+ratio+' '+type+' uses exact ticks and preserves unrelated voices',()=>{
    const source=groupedTupletFixture(type),saved=serialize(source);
    const original=inspectAdvancedMeasure(source,'P1',0);
    const result=authorTupletGroup(source,{...params(),ratio,type,step:'D',octave:5});
    const after=inspectAdvancedMeasure(result.doc,'P1',0);
    assert.equal(serialize(source),saved);
    assert.equal(result.change.divisionsScale,expectedFactor);
    assert.equal(after.divisions,original.divisions*expectedFactor);
    assert.equal(after.reason,null);
    const groups=after.events.slice(0,actual),slot=original.divisions*expectedFactor/({quarter:1,eighth:2,'16th':4,'32nd':8}[type])*normal/actual;
    assert.equal(groups.length,actual);
    assert.ok(groups.every(e=>e.tuplet&&e.duration===slot&&!e.rest));
    assert.deepEqual(groups.slice(0,normal).map(e=>e.step),['C','E','G','B'].slice(0,normal));
    assert.ok(groups.slice(normal).every(e=>e.step==='D'&&e.octave===5));
    const remaining=after.events.filter(e=>e.voice==='2');
    const originalOther=original.events.filter(e=>e.voice==='2');
    assert.deepEqual(remaining.map(e=>[e.start,e.duration,e.rest,e.step]),
      originalOther.map(e=>[e.start*expectedFactor,e.duration*expectedFactor,e.rest,e.step]));
    assert.equal(first(first(notes(result.doc)[0],'notations'),'tuplet').getAttribute('type'),'start');
    assert.equal(first(first(notes(result.doc)[actual-1],'notations'),'tuplet').getAttribute('type'),'stop');
    assert.equal(first(first(notes(result.doc)[actual-1],'time-modification'),'actual-notes').textContent,String(actual));
  });
}
test('tuplets: protect pre-existing lyrics, unsupported settings and MusicXML source',()=>{
  const source=groupedTupletFixture(),saved=serialize(source);
  assert.throws(()=>authorTupletGroup(source,{...params(),ratio:'9:8',type:'16th'}),/비율|길이/);
  assert.throws(()=>authorTupletGroup(source,{...params(3),ratio:'5:4',type:'16th'}),/부족|연속|일반 음표/);
  assert.equal(serialize(source),saved);
  const decorated=groupedTupletFixture(),node=notes(decorated)[1];
  node.appendChild(E('tie',[],{type:'start'}));
  assert.throws(()=>authorTupletGroup(decorated,{...params(),ratio:'5:4',type:'16th'}),/기존 붙임줄|일반 음표/);
  const lyric=groupedTupletFixture();
  notes(lyric)[1].appendChild(E('lyric',[T('text','가')]));
  const next=authorTupletGroup(lyric,{...params(),ratio:'5:4',type:'16th'}).doc;
  assert.equal(first(first(notes(next)[1],'lyric'),'text').textContent,'가');
  assert.equal(first(notes(next)[4],'lyric'),undefined);
});

function writtenScoreFixture(){
  const attrs=E('attributes',[T('divisions',48),
    E('time',[T('beats',4),T('beat-type',4)]),
    E('clef',[T('sign','G'),T('line',2)])]);
  return new Doc(E('score-partwise',[E('part',[
    E('measure',[attrs,voiceNote('C',4,96,'half','1','1'),
      voiceNote('E',4,96,'half','1','1')],{number:'1'}),
    E('measure',[voiceNote('G',4,96,'half','1','1'),
      voiceNote('B',4,96,'half','1','1')],{number:'2'}),
  ],{id:'P1'})]));
}
test('rebarring: 4/4 written melody becomes three 3/4 measures with tied split and final rest',()=>{
  const source=writtenScoreFixture(),before=serialize(source);
  const result=rebarWrittenScore(source,{meter:'3/4'}),bars=children(part(result.doc),'measure');
  assert.equal(serialize(source),before);
  assert.equal(result.change.originalMeasures,2);
  assert.equal(result.change.newMeasures,3);
  assert.equal(result.change.paddedTicks,48);
  assert.deepEqual(bars.map(m=>children(m,'note').map(n=>[
    first(first(n,'pitch')||E('rest'),'step')?.textContent||'rest',
    first(n,'duration').textContent
  ])),[
    [['C','96'],['E','48']],
    [['E','48'],['G','96']],
    [['B','96'],['rest','48']]
  ]);
  assert.equal(first(first(bars[0],'attributes'),'time').children[0].textContent,'3');
  assert.equal(first(first(children(bars[0],'note')[1],'notations'),'tied').getAttribute('type'),'start');
  assert.equal(first(first(children(bars[1],'note')[0],'notations'),'tied').getAttribute('type'),'stop');
  assert.equal(first(children(bars[1],'note')[0],'tie').getAttribute('type'),'stop');
  assert.equal(first(children(bars[0],'note')[1],'tie').getAttribute('type'),'start');
});
test('rebarring: preserve lyric on original attack, restore music timing across two parts',()=>{
  const source=writtenScoreFixture();
  const lyric=E('lyric',[T('text','기억')]);
  children(measure(source),'note')[1].appendChild(lyric);
  const p2=part(source).cloneNode(true);p2.setAttribute('id','P2');
  source.documentElement.appendChild(p2);
  const before=serialize(source);
  const result=rebarWrittenScore(source,{meter:'3/8'}),parts=children(result.doc.documentElement,'part');
  assert.equal(serialize(source),before);
  assert.equal(result.change.parts,2);
  assert.equal(result.change.newMeasures,6);
  for(const p of parts){
    const bars=children(p,'measure');
    assert.equal(bars.length,6);
    for(const m of bars)assert.equal(children(m,'note')
      .reduce((n,x)=>n+Number(first(x,'duration').textContent),0),72);
    const marked=bars.flatMap(m=>children(m,'note')).filter(n=>
      first(first(n,'lyric')||E('empty'),'text')?.textContent==='기억');
    assert.equal(marked.length,1,'Lyric should stay on the first tied segment');
  }
});
test('rebarring: reject polyphony, meter anomalies, decorated music and unchanged source',()=>{
  const original=writtenScoreFixture(),before=serialize(original);
  assert.throws(()=>rebarWrittenScore(original,{meter:'9/8'}),/지원/);
  assert.throws(()=>rebarWrittenScore(original,{meter:'4/4'}),/같은 박자/);
  assert.throws(()=>rebarWrittenScore(fixture(),{meter:'3/4'}),/복합|성부/);
  const annotated=writtenScoreFixture();
  const lastMeasure=children(part(annotated),'measure')[1];
  lastMeasure.insertBefore(E('direction',[E('direction-type',[T('words','rit.')])]),lastMeasure.children[0]);
  assert.throws(()=>rebarWrittenScore(annotated,{meter:'3/4'}),/복합 마디|보호/);
  const altered=writtenScoreFixture();
  first(children(measure(altered),'note')[1],'pitch').appendChild(T('alter',1));
  assert.throws(()=>rebarWrittenScore(altered,{meter:'3/4'}),/변화표/);
  assert.equal(serialize(original),before);
});
