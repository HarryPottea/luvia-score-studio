import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectEditableTuplet,parseTupletPitchSequence,editTupletPitches}
  from '../src/studio-v4-tuplet-pitch-edit.js';

class E{
  constructor(localName,children=[],attrs={},value=''){
    this.localName=localName;this.nodeType=1;this._attrs={...attrs};this._value=String(value);
    this.children=[];this.parentNode=null;this.ownerDocument=this;
    for(const c of children)this.appendChild(c);
  }
  get attributes(){return Object.entries(this._attrs).map(([name,value])=>({name,value}));}
  get textContent(){return this.children.length?this.children.map(c=>c.textContent).join(''):this._value;}
  set textContent(v){this._value=String(v);this.children=[];}
  get firstChild(){return this.children[0]||null;}
  getAttribute(key){return this._attrs[key]??null;}
  setAttribute(key,value){this._attrs[key]=String(value);}
  removeAttribute(key){delete this._attrs[key];}
  createElementNS(_ns,tag){return new E(tag);}
  createElement(tag){return new E(tag);}
  appendChild(node){return this.insertBefore(node,null);}
  insertBefore(node,before){
    if(node.parentNode)node.parentNode.removeChild(node);
    const at=before?this.children.indexOf(before):-1;
    this.children.splice(at<0?this.children.length:at,0,node);
    node.parentNode=this;return node;
  }
  removeChild(node){
    const index=this.children.indexOf(node);
    if(index<0)throw Error('not attached');
    this.children.splice(index,1);node.parentNode=null;return node;
  }
  cloneNode(deep=false){return new E(this.localName,
    deep?this.children.map(c=>c.cloneNode(true)):[],this._attrs,this._value);}
}
const e=(name,c=[],attrs={},v='')=>new E(name,c,attrs,v);
const leaf=(name,v)=>e(name,[],{},v);
const first=(n,k)=>n.children.find(c=>c.localName===k);
const all=(n,k)=>n.children.filter(c=>c.localName===k);
const pitches=n=>all(n,'note').map(x=>first(x,'pitch')?.textContent??'REST');
function makeGroup({ratio='3:2',divisions=48,lyrics=true}={}){
  const [actual,normal]=ratio.split(':').map(Number),ticks=divisions*normal/4/actual;
  assert.ok(Number.isInteger(ticks));
  const group=[];
  for(let i=0;i<actual;i++){
    const notations=[];
    if(i===0)notations.push(e('tuplet',[],{number:'1',type:'start',bracket:'yes'}));
    if(i===actual-1)notations.push(e('tuplet',[],{number:'1',type:'stop'}));
    if(i===0)notations.push(e('slur',[],{number:'1',type:'start'}));
    if(i===actual-1)notations.push(e('slur',[],{number:'1',type:'stop'}));
    group.push(e('note',[
      e('pitch',[leaf('step',i%2?'D':'C'),leaf('octave',4)]),
      leaf('duration',ticks),leaf('voice',1),leaf('type','16th'),
      e('time-modification',[leaf('actual-notes',actual),leaf('normal-notes',normal),
        leaf('normal-type','16th')]),
      e('notations',notations),
      ...(lyrics&&i===0?[e('lyric',[leaf('text','반짝이는')],{number:'1'})]:[])
    ]));
  }
  // Actual duration is 1 quarter (normal 16ths). Fill remaining 3 quarters.
  const ordinary=Array.from({length:3},()=>e('note',[
    e('pitch',[leaf('step','G'),leaf('octave',4)]),leaf('duration',divisions),
    leaf('voice',1),leaf('type','quarter')
  ]));
  const bar=e('measure',[e('attributes',[
    leaf('divisions',divisions),e('time',[leaf('beats',4),leaf('beat-type',4)])]),
    ...group,...ordinary],{number:'1'});
  const part=e('part',[bar],{id:'P1'});
  const root=e('score-partwise',[
    e('part-list',[e('score-part',[leaf('part-name','Vocal')],{id:'P1'})]),part
  ],{version:'4.0'});
  return {documentElement:root,cloneNode(){return copy(root.cloneNode(true));}};
}
function copy(root){return {documentElement:root,cloneNode(){return copy(root.cloneNode(true));}};}
function bar(doc){return all(all(doc.documentElement,'part')[0],'measure')[0];}

test('existing three-note tuplet: edit whole pitch sequence from its middle note',()=>{
  const source=makeGroup(),result=editTupletPitches(source,{
    partId:'P1',measureIndex:0,eventIndex:1,pitches:'E4 F#4 G4'});
  assert.deepEqual(pitches(bar(result.doc)).slice(0,3),['E4','F14','G4']);
  assert.equal(result.change.actual,3);
  assert.equal(result.change.editedNotes,3);
  assert.equal(first(first(all(bar(result.doc),'note')[0],'lyric'),'text').textContent,'반짝이는');
  assert.equal(first(all(bar(result.doc),'note')[0],'duration').textContent,'8');
  assert.deepEqual(pitches(bar(source)).slice(0,3),['C4','D4','C4']);
  assert.equal(first(all(bar(result.doc),'note')[0],'notations').children.length,2);
});
test('existing five-note tuplet: preserve decorations and all ordinary notes',()=>{
  const score=makeGroup({ratio:'5:4',divisions:60});
  const before=pitches(bar(score)).slice(5);
  const result=editTupletPitches(score,{partId:'P1',measureIndex:0,eventIndex:4,
    pitches:'D4 Eb4 F4 G4 A4'});
  assert.deepEqual(pitches(bar(result.doc)).slice(0,5),['D4','E-14','F4','G4','A4']);
  assert.deepEqual(pitches(bar(result.doc)).slice(5),before);
  assert.equal(first(all(bar(result.doc),'note')[0],'duration').textContent,'12');
  assert.equal(result.change.normal,4);
});
test('supports seven-note tuplets when all pitches can be written',()=>{
  const score=makeGroup({ratio:'7:4',divisions:70,lyrics:false});
  const spec=inspectEditableTuplet(score,{partId:'P1',measureIndex:0,eventIndex:3});
  assert.equal(spec.count,7);
  const changed=editTupletPitches(score,{partId:'P1',measureIndex:0,eventIndex:3,
    pitches:'C4 D4 E4 F4 G4 A4 B4'});
  assert.equal(changed.change.editedNotes,5);
  assert.equal(pitches(bar(changed.doc))[6],'B4');
});
test('invalid number of pitches, malformed tokens, or missing end are blocked',()=>{
  const s=makeGroup();
  assert.deepEqual(parseTupletPitchSequence('C4, D4, Eb4').map(p=>p.alter),[0,0,-1]);
  assert.throws(()=>parseTupletPitchSequence('C4 Bb4'),/3~7/);
  assert.throws(()=>parseTupletPitchSequence('C4 D4 H9'),/C4/);
  assert.throws(()=>editTupletPitches(s,{partId:'P1',measureIndex:0,eventIndex:1,
    pitches:'C4 D4'}),/3~7/);
  const tuplets=all(first(all(bar(s),'note')[2],'notations'),'tuplet');
  first(all(bar(s),'note')[2],'notations').removeChild(tuplets[0]);
  assert.throws(()=>editTupletPitches(s,{partId:'P1',measureIndex:0,eventIndex:1,
    pitches:'E4 F4 G4'}),/종료되지|종료 기호|시작·끝/);
});
test('tied or overlapping tuplet structure cannot silently change group pitches',()=>{
  const s=makeGroup();
  const note=all(bar(s),'note')[0];
  note.insertBefore(e('tie',[],{type:'start'}),first(note,'type'));
  assert.throws(()=>editTupletPitches(s,{partId:'P1',measureIndex:0,eventIndex:0,
    pitches:'D4 E4 F4'}),/붙임줄/);
  assert.equal(first(note,'pitch').textContent,'C4');
});


test('edit a 3:2 mixed note-rest-note tuplet without consuming its rest beat',()=>{
  const source=makeGroup(),bar0=bar(source),notes=all(bar0,'note');
  const middle=notes[1],pitch=first(middle,'pitch');
  middle.insertBefore(e('rest'),pitch);middle.removeChild(pitch);
  assert.deepEqual(parseTupletPitchSequence('E4 R G4'),[
    {step:'E',alter:0,octave:4},null,{step:'G',alter:0,octave:4}]);
  const result=editTupletPitches(source,{partId:'P1',measureIndex:0,
    eventIndex:1,pitches:'E4 R G4'});
  const group=all(bar(result.doc),'note').slice(0,3);
  assert.deepEqual(pitches(bar(result.doc)).slice(0,3),['E4','REST','G4']);
  assert.deepEqual(group.map(n=>first(n,'duration').textContent),['8','8','8']);
  assert.equal(first(group[1],'rest').localName,'rest');
  assert.equal(first(group[1],'pitch'),undefined);
  assert.equal(result.change.editedNotes,2);
  assert.equal(first(first(group[0],'lyric'),'text').textContent,'반짝이는');
  assert.deepEqual(pitches(bar(source)).slice(0,3),['C4','REST','C4']);
});
test('mixed tuplet cannot rewrite an existing rest to a pitch or a pitch to rest',()=>{
  const source=makeGroup(),notes=all(bar(source),'note');
  const old=first(notes[1],'pitch');
  notes[1].insertBefore(e('rest'),old);notes[1].removeChild(old);
  const options={partId:'P1',measureIndex:0,eventIndex:1};
  assert.throws(()=>editTupletPitches(source,{...options,pitches:'E4 F4 G4'}),/쉼표 위치/);
  assert.throws(()=>editTupletPitches(source,{...options,pitches:'R R G4'}),/새로 만들 수 없습니다/);
  assert.equal(first(notes[1],'rest').localName,'rest');
  assert.equal(first(notes[0],'pitch').textContent,'C4');
});
