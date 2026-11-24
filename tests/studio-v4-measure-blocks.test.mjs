import test from 'node:test';
import assert from 'node:assert/strict';
import {captureMeasureRange,pasteMeasureRange,duplicateMeasureRange,
  deleteMeasureRange,insertBlankMeasureRange} from '../src/studio-v4-measure-blocks.js';
import {createEditorHistory} from '../src/editor-history.js';
import {transposeMeasurePassage} from '../src/studio-v4-passage-transpose.js';
import {transposeWrittenVoice,respellWrittenVoice} from '../src/studio-v4-voice-transpose.js';
import {addIndependentVoice} from '../src/studio-v4-add-voice.js';
import {moveNoteToRestingVoice} from '../src/studio-v4-voice-transfer.js';
import {transferVoicePhrase,inspectTransferableVoicePhrase,transferVoiceAcrossMeasures} from '../src/studio-v4-voice-phrase.js';
import {editConnectedPitch} from '../src/studio-v4-connected-pitch.js';
import {toggleAdvancedArticulation} from '../src/studio-v4-articulations.js';
import {toggleMusicXmlOrnament,SUPPORTED_ORNAMENTS} from '../src/studio-v4-ornaments.js';
import {editArticulationForVoice} from '../src/studio-v4-articulation-batch.js';
import {insertGraceNote,removeGraceNote,editGraceNote} from '../src/studio-v4-grace-notes.js';
import {inspectAdvancedMeasure} from '../src/advanced-score.js';

// Small deterministic XML DOM for the pure transformations (no browser).
const xmlOwner={
  createElementNS(ns,name){const node=new XmlNode(name);node.namespaceURI=ns;return node;},
  createElement(name){return new XmlNode(name);}
};
class XmlNode {
  constructor(localName,attrs={},children=[],value=''){
    this.localName=localName;this.nodeType=1;this.namespaceURI=null;
    this.ownerDocument=xmlOwner;this._attributes={...attrs};
    this.children=[];this._value=String(value);this.parentNode=null;
    for(const child of children)this.appendChild(child);
  }
  get attributes(){return Object.entries(this._attributes).map(([name,value])=>({name,value}));}
  get childNodes(){return this.children;}
  get firstChild(){return this.children[0]||null;}
  get textContent(){return this.children.length?this.children.map(n=>n.textContent).join(''):this._value;}
  set textContent(value){for(const child of this.children)child.parentNode=null;this.children=[];
    this._value=String(value);}
  getAttribute(name){return Object.hasOwn(this._attributes,name)?this._attributes[name]:null;}
  hasAttribute(name){return Object.hasOwn(this._attributes,name);}
  setAttribute(name,value){this._attributes[name]=String(value);}
  removeAttribute(name){delete this._attributes[name];}
  appendChild(node){return this.insertBefore(node,null);}
  insertBefore(node,before){
    if(node.parentNode)node.parentNode.removeChild(node);
    const i=before===null?-1:this.children.indexOf(before);
    this.children.splice(i<0?this.children.length:i,0,node);
    node.parentNode=this;return node;
  }
  removeChild(node){
    const i=this.children.indexOf(node);if(i<0)throw Error('Not a child');
    this.children.splice(i,1);node.parentNode=null;return node;
  }
  replaceChild(next,previous){this.insertBefore(next,previous);this.removeChild(previous);return previous;}
  cloneNode(deep=false){
    return new XmlNode(this.localName,this._attributes,deep?this.children.map(n=>n.cloneNode(true)):[],this._value);
  }
}
const n=(tag,attrs={},children=[],value='')=>new XmlNode(tag,attrs,children,value);
const leaf=(tag,value)=>n(tag,{},[],String(value));
const first=(node,tag)=>node.children.find(n=>n.localName===tag);
function fixture(count=6,partCount=2){
  const partNodes=Array.from({length:partCount},(_,p)=>n('part',{id:'P'+(p+1)},
    Array.from({length:count},(_,i)=>n('measure',{number:String(i+1)},[
      ...(i===0?[n('attributes',{},[
        leaf('divisions',48),
        n('key',{},[leaf('fifths',0)]),
        n('time',{},[leaf('beats',4),leaf('beat-type',4)]),
        n('clef',{},[leaf('sign','G'),leaf('line',2)])
      ])]:[]),
      n('note',{},[n('rest'),leaf('duration',192),leaf('type','whole')]),
      n('direction',{},[n('direction-type',{},[leaf('words',String(100+p*10+i))])])
    ]))));
  const root=n('score-partwise',{},partNodes);
  return {documentElement:root,cloneNode(){return documentFor(root.cloneNode(true));}};
}
function documentFor(root){
  return {documentElement:root,cloneNode(){return documentFor(root.cloneNode(true));}};
}
const rows=(doc)=>doc.documentElement.children.map(p=>p.children.filter(m=>m.localName==='measure'));
const barNums=doc=>rows(doc)[0].map(m=>m.getAttribute('number'));
const marker=(bar)=>first(first(first(bar,'direction'),'direction-type'),'words').textContent;

test('copy/paste middle range inserts into every part, keeps the original',()=>{
  const source=fixture(),clip=captureMeasureRange(source,{start:1,end:2});
  const {doc,change}=pasteMeasureRange(source,{clipboard:clip,index:4});
  assert.equal(clip.count,2);
  assert.deepEqual(barNums(doc),['1','2','3','4','5','6','7','8']);
  assert.equal(rows(doc)[1].length,8);
  assert.equal(marker(rows(doc)[0][4]),marker(rows(source)[0][1]));
  assert.equal(marker(rows(doc)[0][5]),marker(rows(source)[0][2]));
  assert.equal(marker(rows(doc)[1][4]),marker(rows(source)[1][1]));
  assert.equal(marker(rows(doc)[0][6]),marker(rows(source)[0][4]));
  assert.equal(change.nextMeasureIndex,4);
  assert.equal(rows(source)[0].length,6);
});
test('duplicate a two-bar phrase directly after its location',()=>{
  const source=fixture();
  const result=duplicateMeasureRange(source,{start:1,end:2});
  assert.deepEqual(rows(result.doc)[0].map(marker).slice(0,6),
    ['100','101','102','101','102','103']);
  assert.equal(result.doc.documentElement.children.length,2);
});
test('delete a two-bar block from all parts and preserve remaining order',()=>{
  const source=fixture();
  const result=deleteMeasureRange(source,{start:1,end:2});
  assert.deepEqual(barNums(result.doc),['1','2','3','4']);
  assert.deepEqual(rows(result.doc)[0].map(marker),['100','103','104','105']);
  assert.deepEqual(rows(result.doc)[1].map(marker),['110','113','114','115']);
  assert.deepEqual(barNums(source),['1','2','3','4','5','6']);
});
test('insert a 4/4 blank bar before the selected bar',()=>{
  const source=fixture();
  const result=insertBlankMeasureRange(source,{index:2,count:1});
  assert.deepEqual(barNums(result.doc),['1','2','3','4','5','6','7']);
  assert.equal(rows(result.doc)[0][2].children[0].localName,'note');
  assert.equal(first(rows(result.doc)[0][2].children[0],'rest').localName,'rest');
  assert.equal(marker(rows(result.doc)[0][3]),marker(rows(source)[0][2]));
});
test('copy first bar then paste at the beginning preserves one initial attributes block',()=>{
  const source=fixture();const clipboard=captureMeasureRange(source,{start:0,end:0});
  const result=pasteMeasureRange(source,{clipboard,index:0});
  const measures=rows(result.doc)[0];
  assert.equal(first(measures[0],'attributes')?.localName,'attributes');
  assert.equal(first(measures[1],'attributes'),undefined);
  assert.equal(marker(measures[0]),'100');
  assert.equal(marker(measures[1]),'100');
  assert.deepEqual(barNums(result.doc),['1','2','3','4','5','6','7']);
});
test('delete leading measures carries initial key and meter to the new first bar',()=>{
  const result=deleteMeasureRange(fixture(),{start:0,end:1});
  assert.equal(first(rows(result.doc)[0][0],'attributes')?.localName,'attributes');
  assert.equal(marker(rows(result.doc)[0][0]),'102');
});
test('delete last leading rest even when first sounding bar declares its own key',()=>{
  const source=fixture(3);
  for(const row of rows(source)){
    row[1].insertBefore(n('attributes',{},[n('key',{},[leaf('fifths',2)])]),row[1].firstChild);
    row[1].insertBefore(n('note',{},[n('pitch',{},[leaf('step','C'),leaf('octave',4)]),
      leaf('duration',192),leaf('type','whole')]),row[1].children.find(c=>c.localName==='note'));
    row[1].removeChild(row[1].children.find(c=>c.localName==='note'&&first(c,'rest')));
  }
  const result=deleteMeasureRange(source,{start:0,end:0});
  for(const row of rows(result.doc)){
    assert.equal(row.length,2);
    const attrs=row[0].children.filter(c=>c.localName==='attributes');
    assert.equal(attrs.length,1);
    assert.equal(first(attrs[0],'divisions')?.textContent,'48');
    assert.equal(first(first(attrs[0],'key'),'fifths')?.textContent,'2');
    assert.equal(first(row[0].children.find(c=>c.localName==='note'),'pitch')?.localName,'pitch');
  }
  assert.equal(first(rows(source)[0][0],'attributes')?.localName,'attributes');
});
test('do not move an opening key over a mid-measure key change',()=>{
  const source=fixture(2);
  for(const row of rows(source))row[1].appendChild(n('attributes',{},[
    n('key',{},[leaf('fifths',2)])]));
  assert.throws(()=>deleteMeasureRange(source,{start:0,end:0}),/중간에 조표/);
});
test('copying fragments does not mutate earlier clipboard contents',()=>{
  const source=fixture();const clip=captureMeasureRange(source,{start:1,end:1});
  const changed=source.cloneNode(true);
  first(first(first(rows(changed)[0][1],'direction'),'direction-type'),'words').textContent='CHANGED';
  const result=pasteMeasureRange(changed,{clipboard:clip,index:3});
  assert.equal(marker(rows(result.doc)[0][3]),'101');
});
test('reject mismatched key and meter at insertion destination',()=>{
  const source=fixture();
  for(const part of source.documentElement.children){
    part.children[3].insertBefore(n('attributes',{},[
      n('key',{},[leaf('fifths',1)])
    ]),part.children[3].firstChild);
  }
  const clip=captureMeasureRange(source,{start:1,end:2});
  assert.throws(()=>pasteMeasureRange(source,{clipboard:clip,index:4}),/다릅니다/);
});
test('refuse pasting across different part identifiers',()=>{
  const a=fixture(6,2),b=fixture(6,1);
  const clip=captureMeasureRange(a,{start:1,end:1});
  assert.throws(()=>pasteMeasureRange(b,{clipboard:clip,index:2}),/호환되는/);
});
test('protect slurs and ties in copied bars and at deletion seams',()=>{
  const a=fixture();
  first(a.documentElement.children[0].children[2],'note')
    .appendChild(n('notations',{},[n('slur',{type:'start'})]));
  assert.throws(()=>captureMeasureRange(a,{start:2,end:2}),/종료되지 않은/);
  assert.throws(()=>deleteMeasureRange(a,{start:3,end:3}),/종료되지 않은/);
  assert.equal(rows(a)[0].length,6);
});
test('delete four leading rests without rejecting later repeat or pedal marks',()=>{
  const source=fixture(7);
  for(const row of rows(source)){
    row[6].appendChild(n('barline',{location:'right'},[
      n('repeat',{direction:'backward'})]));
    row[5].appendChild(n('direction',{},[n('direction-type',{},[
      n('pedal',{type:'start'})])]));
  }
  const result=deleteMeasureRange(source,{start:0,end:3});
  assert.equal(rows(result.doc)[0].length,3);
  assert.equal(first(rows(result.doc)[0][2],'barline')?.localName,'barline');
  assert.equal(first(rows(source)[0][6],'barline')?.localName,'barline');
});
test('repeat mark inside deleted bars is still protected',()=>{
  const source=fixture(7);
  rows(source)[0][2].appendChild(n('barline',{},[n('repeat',{direction:'forward'})]));
  assert.throws(()=>deleteMeasureRange(source,{start:0,end:3}),/3마디에 반복·페달/);
});
test('protect structural meter edits and irregular score measurements',()=>{
  const a=fixture();
  rows(a)[0][2].insertBefore(n('attributes',{},[n('time',{},[leaf('beats',3)])]),
    rows(a)[0][2].firstChild);
  assert.throws(()=>captureMeasureRange(a,{start:1,end:2}),/조표·박자표/);
  const b=fixture(); b.documentElement.children[1].removeChild(rows(b)[1].at(-1));
  assert.throws(()=>captureMeasureRange(b,{start:0,end:0}),/파트별 마디 수/);
});
test('cannot delete all bars or exceed 16 selected bars',()=>{
  assert.throws(()=>deleteMeasureRange(fixture(3),{start:0,end:2}),/최소 1마디/);
  assert.throws(()=>captureMeasureRange(fixture(18),{start:0,end:16}),/최대 16마디/);
});
test('a committed block edit supports snapshot-based undo and redo',()=>{
  const history=createEditorHistory(10),source=fixture();
  const next=duplicateMeasureRange(source,{start:1,end:1}).doc;
  history.record(source,next,'마디 복제');
  assert.equal(rows(history.undo(next).doc)[0].length,6);
  assert.equal(rows(history.redo(source).doc)[0].length,7);
});


function pitched(note,step='C',octave=4){
  const rest=first(note,'rest');if(rest)note.removeChild(rest);
  note.insertBefore(n('pitch',{},[leaf('step',step),leaf('octave',octave)]),note.firstChild);
  return note;
}
function addLink(note,kind,type,number='1'){
  const notations=first(note,'notations')||note.appendChild(n('notations'));
  if(kind==='tie'){
    note.insertBefore(n('tie',{type}),first(note,'type'));
    notations.appendChild(n('tied',{type}));
  }else notations.appendChild(n(kind,{type,number}));
}
function connectedBars(){
  const score=fixture();
  for(const part of score.documentElement.children){
    const bars=part.children;
    addLink(pitched(first(bars[1],'note')),'tie','start');
    addLink(pitched(first(bars[2],'note')),'tie','stop');
    addLink(first(bars[1],'note'),'slur','start');
    addLink(first(bars[2],'note'),'slur','stop');
  }
  return score;
}
test('complete cross-bar ties and slurs are copied with all parts',()=>{
  const source=connectedBars(),clip=captureMeasureRange(source,{start:1,end:2});
  const copied=pasteMeasureRange(source,{clipboard:clip,index:3}).doc;
  for(const row of rows(copied)){
    assert.equal(first(row[3].children.find(x=>x.localName==='note'),'tie').getAttribute('type'),'start');
    assert.equal(first(row[4].children.find(x=>x.localName==='note'),'tie').getAttribute('type'),'stop');
    assert.equal(first(row[1].children.find(x=>x.localName==='note'),'tie').getAttribute('type'),'start');
  }
  assert.equal(rows(source)[0].length,6);
});
test('closed cross-bar ties and slurs may be deleted as a complete selected block',()=>{
  const source=connectedBars(),result=deleteMeasureRange(source,{start:1,end:2});
  assert.deepEqual(rows(result.doc)[0].map(marker),['100','103','104','105']);
  assert.deepEqual(rows(result.doc)[1].map(marker),['110','113','114','115']);
  assert.equal(rows(source)[0].length,6);
});
test('partial links crossing selection boundary are blocked before mutation',()=>{
  const source=connectedBars();
  assert.throws(()=>captureMeasureRange(source,{start:1,end:1}),/선택 구간 밖/);
  assert.throws(()=>deleteMeasureRange(source,{start:2,end:2}),/선택 구간 밖/);
  assert.throws(()=>insertBlankMeasureRange(source,{index:2}),/마디를 가로지르는/);
  assert.equal(rows(source)[0].length,6);
});
test('a closed slur within a neighboring measure does not block boundary edits',()=>{
  const source=fixture(),bar=rows(source)[0][1];
  const a=pitched(first(bar,'note'));
  first(a,'duration').textContent='96';first(a,'type').textContent='half';
  const b=n('note',{},[n('pitch',{},[leaf('step','C'),leaf('octave',4)]),
    leaf('duration','96'),leaf('type','half')]);bar.insertBefore(b,bar.children.at(-1));
  addLink(a,'slur','start');addLink(b,'slur','stop');
  const clip=captureMeasureRange(source,{start:1,end:1});
  const result=pasteMeasureRange(source,{clipboard:clip,index:2});
  assert.equal(rows(result.doc)[0].length,7);
  assert.equal(rows(result.doc)[0][2].children.filter(x=>x.localName==='note').length,2);
});
test('a tuplet group that closes inside one selected bar is preserved',()=>{
  const source=fixture(),bar=rows(source)[0][1];
  const note=pitched(first(bar,'note'));
  addLink(note,'tuplet','start');
  const finish=n('note',{},[n('pitch',{},[leaf('step','D'),leaf('octave',4)]),
    leaf('duration','96'),leaf('type','half')]);
  first(note,'duration').textContent='96';first(note,'type').textContent='half';
  addLink(finish,'tuplet','stop');
  bar.insertBefore(finish,bar.children.at(-1));
  const clip=captureMeasureRange(source,{start:1,end:1});
  assert.equal(pasteMeasureRange(source,{clipboard:clip,index:2}).doc.documentElement.children.length,2);
});
test('score-wide unmatched connection marks remain safely blocked',()=>{
  const source=fixture();
  addLink(pitched(first(rows(source)[0][1],'note')),'tie','stop');
  assert.throws(()=>captureMeasureRange(source,{start:3,end:3}),/앞부분과 맞지/);
  assert.equal(rows(source)[0].length,6);
});


test('transpose a two-bar vocal+piano passage preserving source, lyrics and timing',()=>{
  const score=fixture();
  for(const row of rows(score)){
    pitched(first(row[1],'note'),'C',4);
    pitched(first(row[2],'note'),'D',4);
  }
  const sung=first(rows(score)[0][1],'note');
  sung.appendChild(n('lyric',{number:'1'},[leaf('text','반짝이')]));
  const beforeDuration=first(sung,'duration').textContent;
  const result=transposeMeasurePassage(score,{start:1,end:2,semitones:2,spelling:'sharp'});
  for(const row of rows(result.doc)){
    assert.equal(first(first(row[1],'note'),'pitch').textContent,'D4');
    assert.equal(first(first(row[2],'note'),'pitch').textContent,'E4');
    assert.equal(first(row[1].children.find(x=>x.localName==='note'),'duration').textContent,beforeDuration);
  }
  assert.equal(first(first(rows(result.doc)[0][1],'note'),'lyric').textContent,'반짝이');
  assert.equal(first(first(rows(score)[0][1],'note'),'pitch').textContent,'C4');
  assert.equal(result.change.notes,4);
});
test('transpose a single instrument without modifying another part',()=>{
  const score=fixture();
  pitched(first(rows(score)[0][1],'note'),'C',4);
  pitched(first(rows(score)[1][1],'note'),'C',4);
  const result=transposeMeasurePassage(score,{partId:'P1',start:1,end:1,semitones:-1,spelling:'flat'});
  assert.equal(first(first(rows(result.doc)[0][1],'note'),'pitch').textContent,'B3');
  assert.equal(first(first(rows(result.doc)[1][1],'note'),'pitch').textContent,'C4');
  assert.equal(result.change.notes,1);
});
test('preserve a fully selected crossbar tie and slur with adjusted matching pitches',()=>{
  const score=connectedBars();
  const result=transposeMeasurePassage(score,{start:1,end:2,semitones:2});
  const firstNote=first(rows(result.doc)[0][1],'note'),secondNote=first(rows(result.doc)[0][2],'note');
  assert.equal(first(firstNote,'pitch').textContent,'D4');
  assert.equal(first(first(firstNote,'notations'),'tied').getAttribute('type'),'start');
  assert.equal(first(first(secondNote,'notations'),'tied').getAttribute('type'),'stop');
  assert.equal(first(firstNote,'duration').textContent,'192');
});
test('reject partial tied phrases, harmony symbols, and unsupported inputs without mutation',()=>{
  const score=connectedBars();
  assert.throws(()=>transposeMeasurePassage(score,{start:1,end:1,semitones:2}),/선택 구간 밖/);
  const a=fixture();
  pitched(first(rows(a)[0][1],'note'),'C',4);
  rows(a)[0][1].appendChild(n('harmony',{},[leaf('kind','major')]));
  assert.throws(()=>transposeMeasurePassage(a,{start:1,end:1}),/루트가 없거나/);
  assert.throws(()=>transposeMeasurePassage(a,{start:1,end:1,transposeChordSymbols:false}),/코드 기호/);
  assert.equal(first(first(rows(a)[0][1],'note'),'pitch').textContent,'C4');
  assert.throws(()=>transposeMeasurePassage(a,{start:1,end:1,semitones:0}),/반음 이동/);
});
test('reject transposing instruments and out-of-range octaves without mutation',()=>{
  const score=fixture();
  pitched(first(rows(score)[0][1],'note'),'B',9);
  assert.throws(()=>transposeMeasurePassage(score,{start:1,end:1,semitones:12}),/기존 음정|음역/);
  const b=fixture();
  pitched(first(rows(b)[0][1],'note'),'C',4);
  first(rows(b)[0][0],'attributes').appendChild(n('transpose',{},[leaf('chromatic',-2)]));
  assert.throws(()=>transposeMeasurePassage(b,{start:1,end:1}),/이조 악기/);
});


test('reject duplicate part IDs and missing pitch octave during passage transpose',()=>{
  const score=fixture();
  score.documentElement.children[1].setAttribute('id','P1');
  pitched(first(rows(score)[0][1],'note'),'C',4);
  assert.throws(()=>transposeMeasurePassage(score,{start:1,end:1}),/ID/);
  const second=fixture();
  const note=pitched(first(rows(second)[0][1],'note'),'C',4);
  const oct=first(first(note,'pitch'),'octave');
  oct.textContent='';
  assert.throws(()=>transposeMeasurePassage(second,{start:1,end:1}),/옥타브/);
  assert.equal(first(first(note,'pitch'),'step').textContent,'C');
});


function harmonyFixture(){
  const source=fixture();
  const firstPart=rows(source)[0][1];
  const pitchedNote=pitched(first(firstPart,'note'),'C',4);
  const chord=n('harmony',{},[
    n('root',{},[leaf('root-step','C')]),
    n('kind',{text:'maj7'},[], 'major-seventh'),
    n('bass',{},[leaf('bass-step','G')])
  ]);
  firstPart.insertBefore(chord,pitchedNote);
  return {source,chord};
}
test('transpose chord roots and slash bass simultaneously with written notes',()=>{
  const {source,chord}=harmonyFixture();
  const before=[first(first(chord,'root'),'root-step').textContent,
    first(first(chord,'bass'),'bass-step').textContent];
  const result=transposeMeasurePassage(source,{start:1,end:1,semitones:2});
  const bar=rows(result.doc)[0][1],newChord=first(bar,'harmony');
  assert.equal(first(first(newChord,'root'),'root-step').textContent,'D');
  assert.equal(first(first(newChord,'bass'),'bass-step').textContent,'A');
  assert.equal(first(newChord,'kind').textContent,'major-seventh');
  assert.equal(first(first(bar,'note'),'pitch').textContent,'D4');
  assert.equal(result.change.notes,1);
  assert.equal(result.change.chords,1);
  assert.deepEqual([
    first(first(chord,'root'),'root-step').textContent,
    first(first(chord,'bass'),'bass-step').textContent
  ],before);
});
test('flat preference transposes chord root and preserves quality and lyric',()=>{
  const {source}=harmonyFixture();
  first(rows(source)[0][1],'note').appendChild(n('lyric',{},[leaf('text','하늘')]));
  const result=transposeMeasurePassage(source,{start:1,end:1,semitones:1,spelling:'flat'});
  const bar=rows(result.doc)[0][1],chord=first(bar,'harmony');
  assert.equal(first(first(chord,'root'),'root-step').textContent,'D');
  assert.equal(first(first(chord,'root'),'root-alter').textContent,'-1');
  assert.equal(first(first(chord,'bass'),'bass-step').textContent,'A');
  assert.equal(first(first(chord,'bass'),'bass-alter').textContent,'-1');
  assert.equal(first(first(bar,'note'),'lyric').textContent,'하늘');
});
test('complex chord spellings fail before mutating source',()=>{
  const {source,chord}=harmonyFixture();
  chord.appendChild(n('function',{},[],'VI'));
  assert.throws(()=>transposeMeasurePassage(source,{start:1,end:1,semitones:3}),/복잡한 코드/);
  assert.equal(first(first(chord,'root'),'root-step').textContent,'C');
  assert.equal(first(first(rows(source)[0][1],'note'),'pitch').textContent,'C4');
});


test('add a full second voice to one part without rewriting the companion part',()=>{
  const source=fixture(4,2);
  const result=addIndependentVoice(source,{partId:'P1',voice:'2',staff:1});
  assert.equal(result.change.measures,4);
  assert.equal(result.change.rests,4);
  for(let i=0;i<4;i++){
    const created=rows(result.doc)[0][i];
    assert.equal(created.children.filter(n=>n.localName==='backup').length,1);
    assert.equal(created.children.filter(n=>n.localName==='note').length,2);
    assert.equal(created.children.find(n=>n.localName==='backup').textContent,'192');
    const newRest=created.children.filter(n=>n.localName==='note')[1];
    assert.equal(first(newRest,'voice').textContent,'2');
    assert.equal(first(newRest,'duration').textContent,'192');
    assert.equal(first(newRest,'rest').localName,'rest');
  }
  assert.equal(rows(result.doc)[1][0].children.filter(n=>n.localName==='note').length,1);
  assert.equal(rows(source)[0][0].children.filter(n=>n.localName==='note').length,1);
  assert.throws(()=>addIndependentVoice(result.doc,{partId:'P1',voice:'2'}),/이미 사용/);
});
test('a 3/4 second voice is spelled as a dotted half rest with an exact clock',()=>{
  const source=fixture(1,1),bar=rows(source)[0][0],attrs=first(bar,'attributes');
  first(first(attrs,'time'),'beats').textContent='3';
  const note=first(bar,'note');first(note,'duration').textContent='144';
  first(note,'type').textContent='half';note.appendChild(n('dot'));
  const result=addIndependentVoice(source,{partId:'P1',voice:'2',staff:1});
  const next=rows(result.doc)[0][0].children.filter(n=>n.localName==='note')[1];
  assert.equal(first(next,'duration').textContent,'144');
  assert.equal(first(next,'type').textContent,'half');
  assert.equal(first(next,'dot').localName,'dot');
});
test('reject partial measure voice addition while leaving original intact',()=>{
  const source=fixture(2,1);
  first(first(rows(source)[0][1],'note'),'duration').textContent='48';
  assert.throws(()=>addIndependentVoice(source,{partId:'P1'}),/완전하지 않아/);
  assert.equal(rows(source)[0][0].children.filter(n=>n.localName==='backup').length,0);
  assert.equal(rows(source)[0][1].children.filter(n=>n.localName==='note').length,1);
});


test('retune complete tied phrase across two bars preserving lyrics, slurs, timing and other part',()=>{
  const score=connectedBars();
  const originalFirst=first(rows(score)[0][1],'note');
  originalFirst.appendChild(n('lyric',{number:'1'},[leaf('text','반짝이는')]));
  const result=editConnectedPitch(score,{partId:'P1',measureIndex:1,eventIndex:0,
    step:'F',alter:1,octave:5});
  const a=first(rows(result.doc)[0][1],'note'),b=first(rows(result.doc)[0][2],'note');
  assert.equal(first(a,'pitch').textContent,'F15');
  assert.equal(first(b,'pitch').textContent,'F15');
  assert.equal(first(a,'duration').textContent,'192');
  assert.equal(first(b,'duration').textContent,'192');
  assert.equal(first(a,'lyric').textContent,'반짝이는');
  assert.equal(first(first(a,'notations'),'tied').getAttribute('type'),'start');
  assert.equal(first(first(b,'notations'),'tied').getAttribute('type'),'stop');
  assert.equal(first(a,'tie').getAttribute('type'),'start');
  assert.equal(first(first(rows(result.doc)[1][1],'note'),'pitch').textContent,'C4');
  assert.equal(first(originalFirst,'pitch').textContent,'C4');
  assert.equal(result.change.connectedNotes,2);
  assert.equal(result.change.measures,2);
});
test('retune a continuation chain with start/stop at the middle note',()=>{
  const source=fixture();
  const bars=rows(source)[0];
  for(const i of [1,2,3])pitched(first(bars[i],'note'),'D',4);
  addLink(first(bars[1],'note'),'tie','start');
  addLink(first(bars[2],'note'),'tie','stop');
  addLink(first(bars[2],'note'),'tie','start');
  addLink(first(bars[3],'note'),'tie','stop');
  const result=editConnectedPitch(source,{partId:'P1',measureIndex:2,eventIndex:0,
    step:'E',alter:-1,octave:4});
  for(const i of [1,2,3]){
    assert.equal(first(first(rows(result.doc)[0][i],'note'),'pitch').textContent,'E-14');
  }
  assert.equal(first(first(rows(result.doc)[0][4],'note'),'rest').localName,'rest');
  assert.equal(result.change.connectedNotes,3);
});
test('pitch edits do not alter unrelated unconnected notes or tuplets',()=>{
  const source=fixture(),bar=rows(source)[0][1];
  const firstNote=pitched(first(bar,'note'),'C',4);
  const second=n('note',{},[n('pitch',{},[leaf('step','E'),leaf('octave',4)]),
    leaf('duration',96),leaf('type','half')]);
  first(firstNote,'duration').textContent='96';first(firstNote,'type').textContent='half';
  bar.appendChild(second);
  const result=editConnectedPitch(source,{partId:'P1',measureIndex:1,eventIndex:1,
    step:'G',alter:0,octave:4});
  const editedNotes=rows(result.doc)[0][1].children.filter(x=>x.localName==='note');
  assert.equal(first(editedNotes[0],'pitch').textContent,'C4');
  assert.equal(first(editedNotes[1],'pitch').textContent,'G4');
  assert.equal(first(second,'pitch').textContent,'E4');
});
test('reject orphan or mismatched ties and duplicated chord tone without mutation',()=>{
  const source=connectedBars();
  const before=first(first(rows(source)[0][1],'note'),'pitch').textContent;
  const tied=first(first(rows(source)[0][2],'note'),'notations');
  first(tied,'tied').setAttribute('type','start');
  assert.throws(()=>editConnectedPitch(source,{partId:'P1',measureIndex:1,eventIndex:0,
    step:'D'}),/서로 다르거나/);
  assert.equal(first(first(rows(source)[0][1],'note'),'pitch').textContent,before);
  const a=fixture(),bar=rows(a)[0][1];
  pitched(first(bar,'note'),'C',4);
  first(bar,'note').appendChild(n('notations',{},[n('slur',{number:'1',type:'start'})]));
  const anchor=first(bar,'note');
  const chord=n('note',{},[n('chord'),n('pitch',{},[leaf('step','E'),leaf('octave',4)]),
    leaf('duration',192),leaf('type','whole')]);
  bar.appendChild(chord);
  assert.throws(()=>editConnectedPitch(a,{partId:'P1',measureIndex:1,eventIndex:0,
    step:'E',octave:4}),/중복/);
  assert.equal(first(first(anchor,'pitch'),'step').textContent,'C');
});
test('unsupported accidental ornamentation is blocked while preserving original',()=>{
  const source=fixture(),bar=rows(source)[0][1];
  const note=pitched(first(bar,'note'),'C',4);
  note.appendChild(n('accidental',{parentheses:'yes'},[],'natural'));
  assert.throws(()=>editConnectedPitch(source,{partId:'P1',measureIndex:1,eventIndex:0,
    step:'D'}),/특수 임시표/);
  assert.equal(first(note,'pitch').textContent,'C4');
});


test('transfer a written note and Korean lyric to a simultaneous empty second voice',()=>{
  const score=fixture(3,2);
  for(const bar of rows(score)[0]){
    const note=first(bar,'note');
    note.replaceChild(n('pitch',{},[leaf('step','C'),leaf('octave',4)]),
      first(note,'rest'));
  }
  const sourceNote=first(rows(score)[0][0],'note');
  sourceNote.appendChild(n('lyric',{number:'1'},[leaf('text','하늘')]));
  const twoVoices=addIndependentVoice(score,{partId:'P1',voice:'2',staff:1}).doc;
  const result=moveNoteToRestingVoice(twoVoices,{partId:'P1',measureIndex:0,
    eventIndex:0,targetVoice:'2'});
  const bar=rows(result.doc)[0][0],newNotes=bar.children.filter(x=>x.localName==='note');
  assert.equal(newNotes.length,2);
  assert.ok(first(newNotes[0],'rest'));
  assert.equal(first(newNotes[0],'duration').textContent,'192');
  assert.equal(first(newNotes[1],'pitch').textContent,'C4');
  assert.equal(first(newNotes[1],'voice').textContent,'2');
  assert.equal(first(newNotes[1],'lyric').textContent,'하늘');
  assert.equal(first(newNotes[1],'duration').textContent,'192');
  assert.equal(result.change.movedLyrics,1);
  assert.equal(result.change.nextEventIndex,1);
  assert.equal(first(first(rows(twoVoices)[0][0],'note'),'pitch').textContent,'C4');
  assert.equal(first(first(rows(twoVoices)[0][0],'note'),'lyric').textContent,'하늘');
  assert.equal(first(first(rows(result.doc)[1][0],'note'),'rest').localName,'rest');
  assert.equal(first(rows(result.doc)[0][1],'note').children.some(x=>x.localName==='pitch'),true);
});
test('transfer refuses missing matching rest, mismatched beat, same voice and decorated tie',()=>{
  const source=fixture(1,1),note=first(rows(source)[0][0],'note');
  note.replaceChild(n('pitch',{},[leaf('step','D'),leaf('octave',4)]),first(note,'rest'));
  assert.throws(()=>moveNoteToRestingVoice(source,{partId:'P1',
    measureIndex:0,eventIndex:0,targetVoice:'2'}),/빈 쉼표/);
  const two=addIndependentVoice(source,{partId:'P1',voice:'2'}).doc;
  assert.throws(()=>moveNoteToRestingVoice(two,{partId:'P1',
    measureIndex:0,eventIndex:0,targetVoice:'1'}),/다른 대상 성부/);
  const bar=rows(two)[0][0],rest=bar.children.filter(x=>x.localName==='note')[1];
  first(rest,'duration').textContent='96';
  assert.throws(()=>moveNoteToRestingVoice(two,{partId:'P1',
    measureIndex:0,eventIndex:0,targetVoice:'2'}),/빈 쉼표/);
  first(rest,'duration').textContent='192';
  first(bar,'note').appendChild(n('notations',{},[n('slur',{type:'start'})]));
  assert.throws(()=>moveNoteToRestingVoice(two,{partId:'P1',
    measureIndex:0,eventIndex:0,targetVoice:'2'}),/일반 음표|보호된/);
  assert.equal(first(first(bar,'note'),'pitch').textContent,'D4');
});


test('move quarter note into an entire second-voice rest and retain dotted-half remainder',()=>{
  const source=fixture(1,2),bar=rows(source)[0][0],note=first(bar,'note');
  note.replaceChild(n('pitch',{},[leaf('step','G'),leaf('octave',4)]),first(note,'rest'));
  first(note,'duration').textContent='48';first(note,'type').textContent='quarter';
  note.appendChild(n('lyric',{number:'1'},[leaf('text','노래')]));
  bar.insertBefore(n('note',{},[n('rest'),leaf('duration',144),leaf('type','half'),n('dot')]),
    first(bar,'direction'));
  const before=addIndependentVoice(source,{partId:'P1',voice:'2'}).doc;
  const result=moveNoteToRestingVoice(before,{partId:'P1',measureIndex:0,eventIndex:0,
    targetVoice:'2'});
  const events=rows(result.doc)[0][0].children.filter(x=>x.localName==='note');
  assert.equal(events.length,4);
  assert.equal(first(events[0],'rest').localName,'rest');
  assert.equal(first(events[0],'duration').textContent,'48');
  assert.equal(first(events[1],'rest').localName,'rest');
  assert.equal(first(events[1],'duration').textContent,'144');
  assert.equal(first(events[2],'pitch').textContent,'G4');
  assert.equal(first(events[2],'duration').textContent,'48');
  assert.equal(first(events[2],'type').textContent,'quarter');
  assert.equal(first(events[2],'voice').textContent,'2');
  assert.equal(first(events[2],'lyric').textContent,'노래');
  assert.equal(first(events[3],'rest').localName,'rest');
  assert.equal(first(events[3],'duration').textContent,'144');
  assert.equal(first(events[3],'type').textContent,'half');
  assert.equal(first(events[3],'dot').localName,'dot');
  assert.equal(first(events[3],'voice').textContent,'2');
  assert.equal(result.change.splitRestCount,1);
  assert.equal(first(first(rows(before)[0][0],'note'),'pitch').textContent,'G4');
  assert.equal(first(first(rows(result.doc)[1][0],'note'),'rest').localName,'rest');
});


test('transfer a second-beat quarter note into an interior of a whole-bar rest',()=>{
  const source=fixture(1,1),bar=rows(source)[0][0],firstRest=first(bar,'note');
  first(firstRest,'duration').textContent='48';
  first(firstRest,'type').textContent='quarter';
  bar.insertBefore(n('note',{},[
    n('pitch',{},[leaf('step','F'),leaf('octave',4)]),
    leaf('duration',48),leaf('type','quarter'),
    n('lyric',{number:'1'},[leaf('text','달빛')])
  ]),first(bar,'direction'));
  bar.insertBefore(n('note',{},[n('rest'),leaf('duration',96),leaf('type','half')]),
    first(bar,'direction'));
  const expanded=addIndependentVoice(source,{partId:'P1',voice:'2'}).doc;
  const result=moveNoteToRestingVoice(expanded,{partId:'P1',
    measureIndex:0,eventIndex:1,targetVoice:'2'});
  const notes=rows(result.doc)[0][0].children.filter(x=>x.localName==='note');
  assert.deepEqual(notes.map(note=>first(note,'duration').textContent),
    ['48','48','96','48','48','96']);
  assert.deepEqual(notes.map(note=>Boolean(first(note,'pitch'))),
    [false,false,false,false,true,false]);
  assert.equal(first(notes[4],'pitch').textContent,'F4');
  assert.equal(first(notes[4],'lyric').textContent,'달빛');
  assert.deepEqual(notes.slice(3).map(note=>first(note,'voice').textContent),
    ['2','2','2']);
  assert.equal(result.change.splitRestCount,2);
  assert.equal(result.change.nextEventIndex,4);
  assert.equal(first(rows(expanded)[0][0].children.filter(x=>x.localName==='note')[1],
    'pitch').textContent,'F4');
});


function phraseFixture(){
  const score=fixture(2,2),bar=rows(score)[0][0],old=first(bar,'note'),
    direction=first(bar,'direction');
  bar.removeChild(old);
  for(const [i,step] of ['C','D','E','F'].entries()){
    const note=n('note',{},[
      n('pitch',{},[leaf('step',step),leaf('octave',4)]),
      leaf('duration',48),leaf('voice','1'),leaf('type','quarter'),
      ...(i===1?[n('lyric',{number:'1'},[leaf('text','별빛')])]:[])
    ]);
    bar.insertBefore(note,direction);
  }
  bar.insertBefore(n('backup',{},[leaf('duration',192)]),direction);
  bar.insertBefore(n('note',{},[
    n('rest'),leaf('duration',192),leaf('voice','2'),leaf('type','whole')
  ]),direction);
  return score;
}
test('transfer all four quarter notes from voice 1 to voice 2 in one immutable action',()=>{
  const source=phraseFixture();
  const plan=inspectTransferableVoicePhrase(source,{partId:'P1',
    measureIndex:0,startEventIndex:0,endEventIndex:3,targetVoice:'2'});
  assert.deepEqual(plan.notes.map(n=>n.step),['C','D','E','F']);
  const result=transferVoicePhrase(source,{partId:'P1',
    measureIndex:0,startEventIndex:0,endEventIndex:3,targetVoice:'2'});
  const notes=rows(result.doc)[0][0].children.filter(x=>x.localName==='note');
  assert.equal(notes.length,8);
  assert.deepEqual(notes.filter(n=>first(n,'voice').textContent==='1')
    .map(n=>first(n,'rest')?.localName),['rest','rest','rest','rest']);
  const voiced=notes.filter(n=>first(n,'voice').textContent==='2');
  assert.deepEqual(voiced.map(n=>first(first(n,'pitch'),'step').textContent),
    ['C','D','E','F']);
  assert.deepEqual(voiced.map(n=>first(n,'duration').textContent),
    ['48','48','48','48']);
  assert.equal(first(voiced[1],'lyric').textContent,'별빛');
  assert.equal(rows(result.doc)[0][0].children.filter(n=>n.localName==='backup').length,1);
  assert.equal(result.change.movedNotes,4);
  assert.equal(result.change.movedLyrics,1);
  assert.equal(result.change.splitRestCount,3);
  assert.equal(first(first(rows(source)[0][0],'note'),'pitch').textContent,'C4');
  assert.equal(first(first(rows(result.doc)[1][0],'note'),'rest').localName,'rest');
});
test('voice phrase transfer refuses protected, incomplete, and occupied target lanes',()=>{
  const source=phraseFixture(),bar=rows(source)[0][0],notes=bar.children.filter(n=>n.localName==='note');
  const params={partId:'P1',measureIndex:0,startEventIndex:0,endEventIndex:3,targetVoice:'2'};
  assert.throws(()=>transferVoicePhrase(source,{...params,endEventIndex:0}),/2~16개/);
  notes[1].appendChild(n('notations',{},[n('slur',{number:'1',type:'start'})]));
  assert.throws(()=>transferVoicePhrase(source,params),/복잡한 기보/);
  notes[1].removeChild(first(notes[1],'notations'));
  notes[4].replaceChild(n('pitch',{},[leaf('step','G'),leaf('octave',4)]),first(notes[4],'rest'));
  assert.throws(()=>transferVoicePhrase(source,params),/빈 쉼표/);
  assert.equal(first(notes[0],'pitch').textContent,'C4');
});


function multibarPhraseFixture(){
  const source=phraseFixture(),bar=rows(source)[0][1],old=first(bar,'note'),
    dir=first(bar,'direction');
  bar.removeChild(old);
  for(const [i,step] of ['G','A'].entries()){
    const note=n('note',{},[
      n('pitch',{},[leaf('step',step),leaf('octave',4)]),
      leaf('duration',96),leaf('voice','1'),leaf('type','half'),
      ...(i===0?[n('lyric',{number:'1'},[leaf('text','달빛')])]:[])
    ]);
    bar.insertBefore(note,dir);
  }
  bar.insertBefore(n('backup',{},[leaf('duration',192)]),dir);
  bar.insertBefore(n('note',{},[
    n('rest'),leaf('duration',192),leaf('voice','2'),leaf('type','whole')
  ]),dir);
  return source;
}
test('atomic two-bar voice migration preserves rhythms and Korean lyrics in both measures',()=>{
  const source=multibarPhraseFixture();
  const result=transferVoiceAcrossMeasures(source,{
    partId:'P1',startMeasureIndex:0,endMeasureIndex:1,
    sourceVoice:'1',targetVoice:'2',staff:'1'});
  assert.equal(result.change.measures,2);
  assert.equal(result.change.movedNotes,6);
  assert.equal(result.change.movedLyrics,2);
  for(const [i,expect] of [[0,['C','D','E','F']],[1,['G','A']]]){
    const notes=rows(result.doc)[0][i].children.filter(n=>n.localName==='note');
    const sourceNotes=notes.filter(n=>first(n,'voice').textContent==='1');
    const moved=notes.filter(n=>first(n,'voice').textContent==='2');
    assert.equal(sourceNotes.length,expect.length);
    assert.ok(sourceNotes.every(n=>!!first(n,'rest')));
    assert.deepEqual(moved.map(n=>first(first(n,'pitch'),'step').textContent),expect);
    assert.equal(rows(result.doc)[0][i].children.filter(n=>n.localName==='backup').length,1);
  }
  const movedFirst=rows(result.doc)[0][0].children.filter(n=>n.localName==='note'&&
    first(n,'voice').textContent==='2');
  const movedSecond=rows(result.doc)[0][1].children.filter(n=>n.localName==='note'&&
    first(n,'voice').textContent==='2');
  assert.equal(first(movedFirst[1],'lyric').textContent,'별빛');
  assert.equal(first(movedSecond[0],'lyric').textContent,'달빛');
  assert.equal(first(first(rows(source)[0][0],'note'),'pitch').textContent,'C4');
  assert.equal(first(first(rows(source)[1][0],'note'),'rest').localName,'rest');
});
test('cross-bar voice transfer is refused atomically if a later bar has no target rest',()=>{
  const source=multibarPhraseFixture(),bar=rows(source)[0][1];
  const rest=bar.children.filter(n=>n.localName==='note').at(-1);
  rest.replaceChild(n('pitch',{},[leaf('step','B'),leaf('octave',4)]),first(rest,'rest'));
  assert.throws(()=>transferVoiceAcrossMeasures(source,{
    partId:'P1',startMeasureIndex:0,endMeasureIndex:1,
    sourceVoice:'1',targetVoice:'2',staff:'1'}),/빈 쉼표/);
  assert.equal(first(first(rows(source)[0][0],'note'),'pitch').textContent,'C4');
  assert.equal(first(first(rows(source)[0][1],'note'),'pitch').textContent,'G4');
});


test('polyphonic cross-measure tied note supports articulation without changing slur or lyric',()=>{
  const source=connectedBars();
  const originalNote=first(rows(source)[0][1],'note');
  originalNote.appendChild(n('lyric',{number:'1'},[leaf('text','반짝이는')]));
  const result=toggleAdvancedArticulation(source,{
    partId:'P1',measureIndex:1,eventIndex:0,kind:'staccato'
  });
  const n1=first(rows(result.doc)[0][1],'note'),
    n2=first(rows(result.doc)[0][2],'note'),
    untouched=first(rows(result.doc)[1][1],'note');
  assert.equal(first(first(first(n1,'notations'),'articulations'),'staccato').localName,'staccato');
  assert.equal(first(n1,'tie').getAttribute('type'),'start');
  assert.equal(first(first(n1,'notations'),'tied').getAttribute('type'),'start');
  assert.equal(first(first(n1,'notations'),'slur').getAttribute('type'),'start');
  assert.equal(first(n2,'tie').getAttribute('type'),'stop');
  assert.equal(first(n1,'lyric').textContent,'반짝이는');
  assert.equal(first(n1,'duration').textContent,'192');
  assert.equal(first(untouched,'notations')?.children.some(x=>x.localName==='articulations'),false);
  assert.equal(first(originalNote,'notations').children.some(x=>x.localName==='articulations'),false);
  assert.equal(result.change.enabled,true);
  const cleared=toggleAdvancedArticulation(result.doc,{
    partId:'P1',measureIndex:1,eventIndex:0,kind:'staccato'
  });
  assert.equal(first(first(rows(cleared.doc)[0][1],'note'),'notations').children
    .some(x=>x.localName==='articulations'),false);
  assert.equal(cleared.change.enabled,false);
});
test('articulation can be toggled on note with two independent written voices',()=>{
  const base=fixture(2,1),bar=rows(base)[0][0];
  pitched(first(bar,'note'),'D',4);
  const poly=addIndependentVoice(base,{partId:'P1',voice:'2',staff:1}).doc;
  const result=toggleAdvancedArticulation(poly,{
    partId:'P1',measureIndex:0,eventIndex:0,kind:'tenuto'
  });
  const notes=rows(result.doc)[0][0].children.filter(x=>x.localName==='note');
  assert.equal(first(first(first(notes[0],'notations'),'articulations'),'tenuto').localName,'tenuto');
  assert.equal(first(notes[1],'rest').localName,'rest');
  assert.equal(first(notes[1],'duration').textContent,'192');
  assert.equal(first(first(rows(poly)[0][0],'note'),'notations'),undefined);
});
test('unsupported articulation input and rests cannot change original score',()=>{
  const score=fixture(1,1),note=first(rows(score)[0][0],'note');
  assert.throws(()=>toggleAdvancedArticulation(score,{
    partId:'P1',measureIndex:0,eventIndex:0,kind:'accent'
  }),/일반 음표/);
  pitched(note,'C',4);
  assert.throws(()=>toggleAdvancedArticulation(score,{
    partId:'P1',measureIndex:0,eventIndex:0,kind:'unknown'
  }),/종류/);
  assert.equal(first(note,'notations'),undefined);
});


test('zero-time grace note insert and delete preserves original voice clock and other part',()=>{
  const source=fixture(2,2),note=first(rows(source)[0][0],'note');
  pitched(note,'C',4);
  note.appendChild(n('lyric',{number:'1'},[leaf('text','햇살')]));
  const initial=inspectAdvancedMeasure(source,'P1',0);
  const inserted=insertGraceNote(source,{partId:'P1',measureIndex:0,eventIndex:0,
    step:'F',alter:1,octave:5,slash:true});
  const notes=rows(inserted.doc)[0][0].children.filter(x=>x.localName==='note');
  assert.equal(notes.length,2);
  assert.equal(first(notes[0],'grace').getAttribute('slash'),'yes');
  assert.equal(first(notes[0],'duration'),undefined);
  assert.equal(first(notes[0],'pitch').textContent,'F15');
  assert.equal(first(notes[0],'accidental').textContent,'sharp');
  assert.equal(first(notes[1],'pitch').textContent,'C4');
  assert.equal(first(notes[1],'duration').textContent,'192');
  assert.equal(first(notes[1],'lyric').textContent,'햇살');
  assert.equal(rows(inserted.doc)[1][0].children.filter(x=>x.localName==='note').length,1);
  assert.equal(inspectAdvancedMeasure(inserted.doc,'P1',0).events[0].duration,0);
  assert.equal(inspectAdvancedMeasure(inserted.doc,'P1',0).events[1].start,initial.events[0].start);
  assert.equal(initial.max,inspectAdvancedMeasure(inserted.doc,'P1',0).max);
  const removed=removeGraceNote(inserted.doc,{partId:'P1',measureIndex:0,eventIndex:0});
  assert.equal(rows(removed.doc)[0][0].children.filter(x=>x.localName==='note').length,1);
  assert.equal(first(first(rows(removed.doc)[0][0],'note'),'lyric').textContent,'햇살');
  assert.equal(first(note,'grace'),undefined);
});
test('grace note can precede sounding tie without disturbing its notation',()=>{
  const source=connectedBars();
  const inserted=insertGraceNote(source,{partId:'P1',measureIndex:1,eventIndex:0,
    step:'D',octave:4,slash:false});
  const notes=rows(inserted.doc)[0][1].children.filter(x=>x.localName==='note');
  assert.equal(first(notes[0],'grace').getAttribute('slash'),'no');
  assert.equal(first(notes[1],'tie').getAttribute('type'),'start');
  assert.equal(first(first(notes[1],'notations'),'tied').getAttribute('type'),'start');
  assert.equal(first(first(rows(inserted.doc)[0][2],'note'),'tie').getAttribute('type'),'stop');
  assert.equal(inspectAdvancedMeasure(inserted.doc,'P1',1).reason,null);
});
test('grace editing blocks rests and refuses deletion when special notation cannot be preserved',()=>{
  const source=fixture(1,1);
  assert.throws(()=>insertGraceNote(source,{partId:'P1',measureIndex:0,eventIndex:0}),/일반 음표/);
  pitched(first(rows(source)[0][0],'note'),'C',4);
  const inserted=insertGraceNote(source,{partId:'P1',measureIndex:0,eventIndex:0});
  const grace=first(rows(inserted.doc)[0][0],'note');
  grace.appendChild(n('notations',{},[n('slur',{number:'1',type:'start'})]));
  assert.throws(()=>removeGraceNote(inserted.doc,{
    partId:'P1',measureIndex:0,eventIndex:0
  }),/복잡한 기보/);
  assert.equal(first(grace,'notations').children.length,1);
  assert.equal(first(first(rows(source)[0][0],'note'),'pitch').textContent,'C4');
});


test('transpose one polyphonic voice while preserving its companion voice, Korean lyrics, and other part',()=>{
  const source=fixture(4,2);
  pitched(first(rows(source)[0][1],'note'),'C',4);
  const withVoices=addIndependentVoice(source,{partId:'P1',voice:'2',staff:1}).doc;
  const bar=rows(withVoices)[0][1],notes=bar.children.filter(x=>x.localName==='note');
  pitched(notes[1],'E',4);
  notes[1].appendChild(n('lyric',{number:'1'},[leaf('text','밤하늘')]));
  const result=transposeWrittenVoice(withVoices,{
    partId:'P1',voice:'2',start:1,end:1,semitones:2});
  const edited=rows(result.doc)[0][1].children.filter(x=>x.localName==='note');
  assert.equal(first(edited[0],'pitch').textContent,'C4');
  assert.equal(first(edited[1],'pitch').textContent,'F14');
  assert.equal(first(edited[1],'lyric').textContent,'밤하늘');
  assert.equal(first(edited[1],'duration').textContent,'192');
  assert.equal(rows(result.doc)[0][1].children.filter(x=>x.localName==='backup').length,1);
  assert.equal(first(first(rows(result.doc)[1][1],'note'),'rest').localName,'rest');
  assert.equal(first(notes[1],'pitch').textContent,'E4');
  assert.deepEqual([result.change.notes,result.change.tuplets,result.change.chords],[1,0,0]);
});
test('voice-scoped transposition preserves complete crossbar tied notes and rejects a cut tie',()=>{
  const source=fixture(4,2);
  for(const index of [1,2])pitched(first(rows(source)[0][index],'note'),'C',4);
  addLink(first(rows(source)[0][1],'note'),'tie','start');
  addLink(first(rows(source)[0][2],'note'),'tie','stop');
  assert.throws(()=>transposeWrittenVoice(source,{
    partId:'P1',voice:'1',start:1,end:1,semitones:2}),/범위 밖/);
  const result=transposeWrittenVoice(source,{
    partId:'P1',voice:'1',start:1,end:2,semitones:2});
  for(const i of [1,2]){
    assert.equal(first(first(rows(result.doc)[0][i],'note'),'pitch').textContent,'D4');
    assert.equal(first(rows(result.doc)[0][i],'note').getAttribute('type'),null);
  }
  assert.equal(first(first(rows(result.doc)[0][1],'note'),'tie').getAttribute('type'),'start');
  assert.equal(first(first(rows(result.doc)[0][2],'note'),'tie').getAttribute('type'),'stop');
  assert.equal(first(first(rows(source)[0][1],'note'),'pitch').textContent,'C4');
});
test('voice-scoped transposition handles a full 3:2 tuplet without changing its rhythm',()=>{
  const source=fixture(3,2),bar=rows(source)[0][1],old=first(bar,'note');
  bar.removeChild(old);
  const quarterTriplet=(step,i)=>n('note',{},[
    n('pitch',{},[leaf('step',step),leaf('octave',4)]),
    leaf('duration',16),leaf('voice','1'),leaf('type','eighth'),
    n('time-modification',{},[leaf('actual-notes',3),leaf('normal-notes',2),
      leaf('normal-type','eighth')]),
    n('notations',{},[...(i===0?[n('tuplet',{number:'1',type:'start'})]:[]),
      ...(i===2?[n('tuplet',{number:'1',type:'stop'})]:[])]),
  ]);
  for(const [i,step] of ['C','D','E'].entries())bar.insertBefore(quarterTriplet(step,i),
    first(bar,'direction'));
  bar.insertBefore(n('note',{},[n('rest'),leaf('duration',144),
    leaf('voice','1'),leaf('type','half'),n('dot')]),first(bar,'direction'));
  const result=transposeWrittenVoice(source,{
    partId:'P1',voice:'1',start:1,end:1,semitones:2,spelling:'flat'});
  const notes=rows(result.doc)[0][1].children.filter(x=>x.localName==='note');
  assert.deepEqual(notes.slice(0,3).map(x=>first(x,'pitch').textContent),['D4','E4','G-14']);
  assert.ok(notes.slice(0,3).every(x=>first(x,'duration').textContent==='16'));
  assert.equal(first(first(notes[0],'notations'),'tuplet').getAttribute('type'),'start');
  assert.equal(first(first(notes[2],'notations'),'tuplet').getAttribute('type'),'stop');
  assert.equal(result.change.tuplets,3);
  assert.equal(first(notes[3],'rest').localName,'rest');
  assert.equal(first(first(bar,'note'),'pitch').textContent,'C4');
});
test('single-voice transposition refuses chord-symbol mismatch and out-of-range pitches',()=>{
  const source=fixture(3,2);
  pitched(first(rows(source)[0][1],'note'),'C',4);
  const harmony=n('harmony',{},[n('root',{},[leaf('root-step','C')]),
    n('kind',{},[],'major')]);
  rows(source)[0][1].insertBefore(harmony,first(rows(source)[0][1],'note'));
  assert.throws(()=>transposeWrittenVoice(source,{
    partId:'P1',voice:'1',start:1,end:1,semitones:2}),/코드 기호/);
  rows(source)[0][1].removeChild(harmony);
  pitched(first(rows(source)[0][1],'note'),'B',8);
  assert.throws(()=>transposeWrittenVoice(source,{
    partId:'P1',voice:'1',start:1,end:1,semitones:12}),/음역/);
  assert.equal(first(first(rows(source)[0][1],'note'),'pitch').textContent,'B8');
});


test('batch articulations add and remove on a voice while preserving a crossbar tie and Korean lyric',()=>{
  const source=fixture(4,2);
  const a=pitched(first(rows(source)[0][1],'note'),'C',4),
    b=pitched(first(rows(source)[0][2],'note'),'C',4);
  addLink(a,'tie','start');addLink(b,'tie','stop');
  a.appendChild(n('lyric',{number:'1'},[leaf('text','계속')]));
  const result=editArticulationForVoice(source,{
    partId:'P1',voice:'1',start:1,end:2,kind:'tenuto',mode:'add'});
  assert.equal(result.change.updatedNotes,2);
  for(const index of [1,2]){
    const note=first(rows(result.doc)[0][index],'note'),
      notations=first(note,'notations');
    assert.ok(first(first(notations,'articulations'),'tenuto'));
    assert.ok(first(notations,'tied'));
    assert.equal(first(note,'duration').textContent,'192');
  }
  assert.equal(first(first(rows(result.doc)[0][1],'note'),'lyric').textContent,'계속');
  assert.equal(first(first(rows(result.doc)[1][1],'note'),'rest').localName,'rest');
  assert.equal(first(first(first(rows(source)[0][1],'note'),'notations'),'articulations'),undefined);
  const removed=editArticulationForVoice(result.doc,{
    partId:'P1',voice:'1',start:1,end:2,kind:'tenuto',mode:'remove'});
  for(const index of [1,2]){
    const note=first(rows(removed.doc)[0][index],'note');
    assert.equal(first(first(note,'notations'),'articulations'),undefined);
    assert.equal(first(first(note,'notations'),'tied').getAttribute('type'),
      index===1?'start':'stop');
  }
});
test('batch articulation preserves other voice, and partially existing marks are idempotently added',()=>{
  const source=fixture(4,1);
  pitched(first(rows(source)[0][1],'note'),'D',4);
  pitched(first(rows(source)[0][2],'note'),'E',4);
  const withVoices=addIndependentVoice(source,{partId:'P1',voice:'2',staff:1}).doc;
  const once=toggleAdvancedArticulation(withVoices,{
    partId:'P1',measureIndex:1,eventIndex:0,kind:'accent'}).doc;
  const edited=editArticulationForVoice(once,{
    partId:'P1',voice:'1',start:1,end:2,kind:'accent',mode:'add'});
  assert.equal(edited.change.updatedNotes,1);
  const secondVoice=rows(edited.doc)[0][1].children.filter(x=>x.localName==='note')[1];
  assert.equal(first(secondVoice,'voice').textContent,'2');
  assert.equal(first(secondVoice,'notations'),undefined);
  assert.throws(()=>editArticulationForVoice(edited.doc,{
    partId:'P1',voice:'1',start:1,end:2,kind:'accent',mode:'add'}),/변경할/);
});
test('batch articulation rejects unsupported note as a whole without source mutation',()=>{
  const source=fixture(4,1);
  const a=pitched(first(rows(source)[0][1],'note'),'C',4);
  const b=pitched(first(rows(source)[0][2],'note'),'D',4);
  b.appendChild(n('notations',{},[]));
  b.appendChild(n('notations',{},[]));
  assert.throws(()=>editArticulationForVoice(source,{
    partId:'P1',voice:'1',start:1,end:2,kind:'staccato',mode:'add'}),/복합 기보/);
  assert.equal(first(a,'notations'),undefined);
  assert.equal(first(b,'notations').children.length,0);
});


test('enharmonic voice-only respelling changes C sharp to D flat without transposing',()=>{
  const source=fixture(3,2),note=pitched(first(rows(source)[0][1],'note'),'C',4);
  const pitch=first(note,'pitch');
  pitch.insertBefore(leaf('alter',1),first(pitch,'octave'));
  note.appendChild(n('lyric',{number:'1'},[leaf('text','고요한')]));
  const changed=respellWrittenVoice(source,{partId:'P1',
    voice:'1',start:1,end:1,spelling:'flat'});
  const newNote=first(rows(changed.doc)[0][1],'note'),
    newPitch=first(newNote,'pitch');
  assert.equal(newPitch.textContent,'D-14');
  assert.equal(first(newNote,'accidental').textContent,'flat');
  assert.equal(first(newNote,'lyric').textContent,'고요한');
  assert.equal(changed.change.action,'respell-written-voice');
  assert.equal(changed.change.semitones,0);
  assert.equal(changed.change.notes,1);
  assert.equal(first(first(rows(changed.doc)[1][1],'note'),'rest').localName,'rest');
  assert.equal(pitch.textContent,'C14');
  assert.throws(()=>respellWrittenVoice(changed.doc,{
    partId:'P1',voice:'1',start:1,end:1,spelling:'flat'}),/이명동음/);
});
test('enharmonic respell consistently changes a crossbar B-sharp tie to C natural in a new octave',()=>{
  const source=fixture(4,1);
  for(const i of [1,2]){
    const note=pitched(first(rows(source)[0][i],'note'),'B',4);
    const p=first(note,'pitch');
    p.insertBefore(leaf('alter',1),first(p,'octave'));
    addLink(note,'tie',i===1?'start':'stop');
  }
  assert.throws(()=>respellWrittenVoice(source,{
    partId:'P1',voice:'1',start:1,end:1,spelling:'sharp'}),/범위 밖/);
  const changed=respellWrittenVoice(source,{
    partId:'P1',voice:'1',start:1,end:2,spelling:'sharp'});
  assert.equal(changed.change.notes,2);
  for(const i of [1,2]){
    const note=first(rows(changed.doc)[0][i],'note');
    assert.equal(first(note,'pitch').textContent,'C5');
    assert.equal(first(note,'tie').getAttribute('type'),i===1?'start':'stop');
  }
  assert.equal(first(first(rows(source)[0][1],'note'),'pitch').textContent,'B14');
});


test('existing grace note pitch, accidental, slash and written type can be edited without affecting rhythm',()=>{
  const source=fixture(2,2),main=first(rows(source)[0][0],'note');
  pitched(main,'C',4);
  main.appendChild(n('lyric',{number:'1'},[leaf('text','반짝이는')]));
  const original=insertGraceNote(source,{partId:'P1',measureIndex:0,eventIndex:0,
    step:'F',alter:1,octave:5,slash:true});
  const changed=editGraceNote(original.doc,{partId:'P1',measureIndex:0,eventIndex:0,
    step:'B',alter:-1,octave:4,slash:false,type:'16th'});
  const notes=rows(changed.doc)[0][0].children.filter(x=>x.localName==='note');
  assert.equal(first(notes[0],'grace').getAttribute('slash'),'no');
  assert.equal(first(notes[0],'pitch').textContent,'B-14');
  assert.equal(first(notes[0],'type').textContent,'16th');
  assert.equal(first(notes[0],'accidental').textContent,'flat');
  assert.equal(first(notes[0],'duration'),undefined);
  assert.equal(first(notes[1],'duration').textContent,'192');
  assert.equal(first(notes[1],'lyric').textContent,'반짝이는');
  assert.equal(inspectAdvancedMeasure(changed.doc,'P1',0).events[0].duration,0);
  assert.equal(inspectAdvancedMeasure(changed.doc,'P1',0).events[1].duration,192);
  assert.equal(rows(changed.doc)[1][0].children.filter(x=>x.localName==='note').length,1);
  assert.equal(first(first(rows(original.doc)[0][0],'note'),'pitch').textContent,'F15');
  assert.equal(changed.change.action,'edit-grace-note');
});

test('grace note can return to natural pitch, and unchanged settings are blocked',()=>{
  const source=fixture(1,1);
  pitched(first(rows(source)[0][0],'note'),'D',4);
  const added=insertGraceNote(source,{partId:'P1',measureIndex:0,eventIndex:0,
    step:'G',alter:1,octave:4});
  const retuned=editGraceNote(added.doc,{partId:'P1',measureIndex:0,eventIndex:0,
    step:'G',alter:0,octave:4,slash:true,type:'eighth'});
  const note=first(rows(retuned.doc)[0][0],'note');
  assert.equal(first(note,'pitch').textContent,'G4');
  assert.equal(first(note,'accidental').textContent,'natural');
  assert.throws(()=>editGraceNote(retuned.doc,{partId:'P1',measureIndex:0,
    eventIndex:0,step:'G',alter:0,octave:4,slash:true,type:'eighth'}),/이미 같은/);
});
test('complex grace notation is never rewritten and target must be an existing grace note',()=>{
  const source=fixture(1,1);
  pitched(first(rows(source)[0][0],'note'),'D',4);
  assert.throws(()=>editGraceNote(source,{partId:'P1',measureIndex:0,
    eventIndex:0}),/기존 꾸밈음/);
  const added=insertGraceNote(source,{partId:'P1',measureIndex:0,eventIndex:0});
  const grace=first(rows(added.doc)[0][0],'note');
  grace.appendChild(n('notations',{},[n('slur',{number:'1',type:'start'})]));
  assert.throws(()=>editGraceNote(added.doc,{partId:'P1',measureIndex:0,
    eventIndex:0,step:'E',alter:0,octave:4}),/기존 꾸밈음/);
  assert.equal(first(grace,'pitch').textContent,'C4');
  assert.throws(()=>editGraceNote(source,{partId:'P1',measureIndex:0,
    eventIndex:0,type:'quarter'}),/표기|설정/);
});


test('new 32nd grace note may be authored without using even one rhythmic tick',()=>{
  const source=fixture(1,1),firstNote=first(rows(source)[0][0],'note');
  pitched(firstNote,'D',4);
  const created=insertGraceNote(source,{partId:'P1',measureIndex:0,eventIndex:0,
    step:'E',alter:-1,octave:5,slash:false,type:'32nd'});
  const notes=rows(created.doc)[0][0].children.filter(x=>x.localName==='note');
  assert.equal(first(notes[0],'type').textContent,'32nd');
  assert.equal(first(notes[0],'grace').getAttribute('slash'),'no');
  assert.equal(first(notes[0],'pitch').textContent,'E-15');
  assert.equal(first(notes[0],'duration'),undefined);
  assert.equal(first(notes[1],'duration').textContent,'192');
  assert.equal(inspectAdvancedMeasure(created.doc,'P1',0).reason,null);
  assert.equal(created.change.type,'32nd');
  assert.throws(()=>insertGraceNote(source,{partId:'P1',measureIndex:0,eventIndex:0,
    type:'quarter'}),/설정/);
});


test('ornament toggle preserves tied vocal note, Korean lyric, second voice and other part',()=>{
  const source=fixture(3,2),a=pitched(first(rows(source)[0][1],'note'),'C',4),
    b=pitched(first(rows(source)[0][2],'note'),'C',4);
  addLink(a,'tie','start');addLink(b,'tie','stop');
  a.appendChild(n('lyric',{number:'1'},[leaf('text','별빛')]));
  const poly=addIndependentVoice(source,{partId:'P1',voice:'2',staff:1}).doc;
  const added=toggleMusicXmlOrnament(poly,{partId:'P1',measureIndex:1,
    eventIndex:0,kind:'trill-mark'});
  const bar=rows(added.doc)[0][1],note=first(bar,'note'),nts=first(note,'notations');
  assert.equal(first(first(nts,'ornaments'),'trill-mark').localName,'trill-mark');
  assert.equal(first(nts,'tied').getAttribute('type'),'start');
  assert.equal(first(note,'tie').getAttribute('type'),'start');
  assert.equal(first(note,'duration').textContent,'192');
  assert.equal(first(note,'lyric').textContent,'별빛');
  const second=bar.children.filter(x=>x.localName==='note')[1];
  assert.equal(first(second,'voice').textContent,'2');
  assert.equal(first(second,'rest').localName,'rest');
  assert.equal(first(first(rows(added.doc)[1][1],'note'),'rest').localName,'rest');
  assert.equal(first(first(rows(poly)[0][1],'note'),'notations').children.length,1);
  const removed=toggleMusicXmlOrnament(added.doc,{partId:'P1',measureIndex:1,
    eventIndex:0,kind:'trill-mark'});
  const undone=first(rows(removed.doc)[0][1],'note');
  assert.equal(first(first(undone,'notations'),'ornaments'),undefined);
  assert.equal(first(first(undone,'notations'),'tied').getAttribute('type'),'start');
  assert.equal(removed.change.enabled,false);
});

test('all supported ornament symbols are independently toggleable without changing pitch',()=>{
  for(const kind of SUPPORTED_ORNAMENTS){
    const source=fixture(1,1),note=pitched(first(rows(source)[0][0],'note'),'D',4);
    const result=toggleMusicXmlOrnament(source,{partId:'P1',measureIndex:0,
      eventIndex:0,kind});
    assert.equal(first(first(first(rows(result.doc)[0][0],'note'),'notations'),'ornaments')
      .children[0].localName,kind);
    assert.equal(result.change.enabled,true);
    assert.equal(first(first(rows(result.doc)[0][0],'note'),'pitch').textContent,'D4');
    assert.equal(first(note,'notations'),undefined);
  }
});
test('ornaments safely refuse rests, unknown marks and complex pre-existing groups',()=>{
  const source=fixture(1,1);
  assert.throws(()=>toggleMusicXmlOrnament(source,{partId:'P1',measureIndex:0,
    eventIndex:0,kind:'trill-mark'}),/일반 음표/);
  const note=pitched(first(rows(source)[0][0],'note'),'D',4);
  assert.throws(()=>toggleMusicXmlOrnament(source,{partId:'P1',measureIndex:0,
    eventIndex:0,kind:'unknown-ornament'}),/종류/);
  note.appendChild(n('notations',{},[n('ornaments',{placement:'below'},
    [n('trill-mark')])]));
  assert.throws(()=>toggleMusicXmlOrnament(source,{partId:'P1',measureIndex:0,
    eventIndex:0,kind:'trill-mark'}),/복잡한/);
  assert.equal(first(first(first(note,'notations'),'ornaments'),'trill-mark').localName,
    'trill-mark');
});
