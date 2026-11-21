import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBlankScore,placeNoteIntoRest,addExpression,setScoreLayoutBreak,
  appendBlankMeasures,setSimpleKeySignature,setScoreMeasureCount,
} from '../src/studio-v4-core.js';
import {buildPlaybackTimeline,clipPlaybackToMeasures,measureAtPlaybackSecond} from '../src/studio-v4-playback.js';
import {parseBatchLyrics,planBatchLyrics,applyBatchLyrics} from '../src/studio-v4-lyrics-batch.js';

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


// Smart Korean lyric paste: pure MusicXML mutation with voice/verse safety.
function lyricVocalScore({measures=1,parts=1,polyphony=false,tied=false,existing=false}={}){
  const partNodes=[];
  for(let partIndex=0;partIndex<parts;partIndex++){
    const bars=[];
    for(let m=0;m<measures;m++){
      const melody=(voice='1',staff='1')=>el('note',[
        pitch('C',4),num('duration',16),num('voice',voice),num('type','quarter'),num('staff',staff)
      ]);
      const top=Array.from({length:4},()=>melody());
      if(tied&&m===0)top[1].appendChild(el('tie',[],{type:'stop'}));
      if(existing&&m===0){
        top[0].appendChild(el('lyric',[num('syllabic','single'),num('text','옛')],{number:'1'}));
      }
      const measureChildren=[attrs(),...top];
      if(polyphony){
        measureChildren.push(el('backup',[num('duration',64)]));
        measureChildren.push(...Array.from({length:4},()=>melody('2','1')));
      }
      bars.push(el('measure',measureChildren,{number:String(m+1)}));
    }
    partNodes.push(el('part',bars,{id:'P'+(partIndex+1)}));
  }
  return new Document(el('score-partwise',partNodes));
}
const lyricNotes=(doc,p='P1',m=0)=>many(many(doc.documentElement,'part')
  .find(node=>node.getAttribute('id')===p).children.filter(n=>n.localName==='measure')[m],'note');
const verseNode=(note,verse='1')=>many(note,'lyric').find(n=>(n.getAttribute('number')||'1')===verse);
const lyricInput=(text,extras={})=>({partId:'P1',measureIndex:0,eventIndex:0,verse:1,text,...extras});

test('Korean lyrics split by character and retain word syllabic boundaries',()=>{
  assert.deepEqual(parseBatchLyrics('오늘도 너를').map(t=>t.text),['오','늘','도','너','를']);
  assert.deepEqual(parseBatchLyrics('사랑해!').map(t=>t.text),['사','랑','해!']);
  assert.deepEqual(parseBatchLyrics('hel-lo').map(t=>t.syllabic),['begin','end']);
  assert.deepEqual(parseBatchLyrics('오늘').map(t=>t.syllabic),['begin','end']);
  assert.throws(()=>parseBatchLyrics('_ 아'),/앞에/);
});

test('bulk lyric change is an immutable multi-note MusicXML edit',()=>{
  const original=lyricVocalScore();
  const result=applyBatchLyrics(original,lyricInput('우리 함께')).doc;
  assert.deepEqual(lyricNotes(result).map(n=>first(verseNode(n),'text').textContent),['우','리','함','께']);
  assert.deepEqual(lyricNotes(result).map(n=>first(verseNode(n),'syllabic').textContent),['begin','end','begin','end']);
  assert.equal(verseNode(lyricNotes(original)[0]),undefined);
  assert.deepEqual(lyricNotes(result).map(n=>first(n,'duration').textContent),['16','16','16','16']);
});

test('melisma underscore emits MusicXML extend start/continue/stop',()=>{
  const output=applyBatchLyrics(lyricVocalScore(),lyricInput('아 _ _ 너')).doc;
  const lyrics=lyricNotes(output).map(n=>verseNode(n));
  assert.deepEqual(lyrics.map(l=>first(l,'extend')?.getAttribute('type')||'none'),
    ['start','continue','stop','none']);
  assert.equal(first(lyrics[1],'text'),undefined);
  assert.equal(first(lyrics[2],'text'),undefined);
});

test('multi-voice backup and same staff: batch targets selected voice only',()=>{
  const doc=lyricVocalScore({polyphony:true});
  const output=applyBatchLyrics(doc,lyricInput('하늘을 봐',{eventIndex:4})).doc;
  assert.ok(lyricNotes(output).slice(0,4).every(n=>verseNode(n)===undefined));
  assert.deepEqual(lyricNotes(output).slice(4).map(n=>first(verseNode(n),'text').textContent),
    ['하','늘','을','봐']);
  assert.equal(many(firstMeasure(output),'backup').length,1);
});

test('sounding tied note continuation is skipped, not rewritten',()=>{
  const input=lyricVocalScore({tied:true});
  const plan=planBatchLyrics(input,lyricInput('아 너 와'));
  assert.equal(plan.skippedTies,1);
  const output=applyBatchLyrics(input,lyricInput('아 너 와')).doc;
  assert.equal(verseNode(lyricNotes(output)[1]),undefined);
  assert.deepEqual([0,2,3].map(i=>first(verseNode(lyricNotes(output)[i]),'text').textContent),['아','너','와']);
});

test('existing verse is protected until overwrite explicitly enabled',()=>{
  const input=lyricVocalScore({existing:true});
  assert.throws(()=>applyBatchLyrics(input,lyricInput('아 너 와 요')),/덮어쓰기/);
  const output=applyBatchLyrics(input,lyricInput('아 너 와 요',{overwrite:true})).doc;
  assert.equal(first(verseNode(lyricNotes(input)[0]),'text').textContent,'옛');
  assert.equal(first(verseNode(lyricNotes(output)[0]),'text').textContent,'아');
  const verse2=applyBatchLyrics(output,lyricInput('봄',{verse:2})).doc;
  assert.equal(first(verseNode(lyricNotes(verse2)[0],'1'),'text').textContent,'아');
  assert.equal(first(verseNode(lyricNotes(verse2)[0],'2'),'text').textContent,'봄');
});

test('complex existing lyrics block bulk overwrites',()=>{
  const input=lyricVocalScore({existing:true});
  verseNode(lyricNotes(input)[0]).appendChild(num('elision',' '));
  assert.throws(()=>applyBatchLyrics(input,lyricInput('가',{overwrite:true})),/복잡한/);
});

test('overflow is atomic; no original note is changed',()=>{
  const input=lyricVocalScore();
  assert.throws(()=>applyBatchLyrics(input,lyricInput('오늘 하루 우리 함께')),/배치할 수 있습니다/);
  assert.ok(lyricNotes(input).every(n=>verseNode(n)===undefined));
});

test('lyrics span multiple measures while another part remains untouched',()=>{
  const input=lyricVocalScore({measures:2,parts:2});
  const output=applyBatchLyrics(input,lyricInput('가나다라마바사아')).doc;
  assert.equal(first(verseNode(lyricNotes(output,'P1',1)[3]),'text').textContent,'아');
  assert.equal(verseNode(lyricNotes(output,'P2')[0]),undefined);
});

test('invalid verse and missing part are rejected',()=>{
  assert.throws(()=>planBatchLyrics(lyricVocalScore(),lyricInput('봄',{verse:13})),/절 번호/);
  assert.throws(()=>planBatchLyrics(lyricVocalScore(),lyricInput('봄',{partId:'other'})),/파트/);
  assert.throws(()=>planBatchLyrics(lyricVocalScore(),lyricInput(' ')),/가사를/);
});


function threeBarAuditionScore({tie=false}={}){
  const measures=[
    el('measure',[attrs(),note(64,'whole',tie?[el('tie',[],{type:'start'})]:[])],{number:'1'}),
    el('measure',[
      el('direction',[el('sound',[],{tempo:'60'})]),
      note(64,'whole',tie?[el('tie',[],{type:'stop'})]:[])
    ],{number:'2'}),
    el('measure',[note(64,'whole')],{number:'3'}),
  ];
  return new Document(el('score-partwise',[el('part',measures,{id:'P1'})]));
}
test('measure audition uses live score tempo for accurate bar boundaries',()=>{
  const original=threeBarAuditionScore();
  const timeline=buildPlaybackTimeline(original,{defaultBpm:120});
  assert.deepEqual(timeline.measureSeconds.map(v=>Math.round(v*100)/100),[0,2,6,10]);
  const portion=clipPlaybackToMeasures(timeline,{start:1,end:1});
  assert.equal(portion.durationSeconds,4);
  assert.deepEqual(portion.selectedMeasures,{start:1,end:1});
  assert.equal(portion.events.length,1);
  assert.equal(portion.events[0].start,0);
  assert.equal(portion.events[0].duration,4);
  assert.equal(timeline.events.length,3);
});
test('selected audition trims a tied note entering from the previous measure',()=>{
  const timeline=buildPlaybackTimeline(threeBarAuditionScore({tie:true}),{defaultBpm:120});
  const excerpt=clipPlaybackToMeasures(timeline,{start:1,end:1});
  assert.equal(excerpt.events.length,1);
  assert.equal(excerpt.events[0].start,0);
  assert.equal(excerpt.events[0].duration,4);
  assert.equal(timeline.events.length,2);
});
test('audition only accepts valid score measure ranges',()=>{
  const timeline=buildPlaybackTimeline(threeBarAuditionScore(),{defaultBpm:120});
  for(const [start,end] of [[-1,0],[2,3],[1,0],[0,3],[1.2,2]])
    assert.throws(()=>clipPlaybackToMeasures(timeline,{start,end}),/범위/);
  assert.deepEqual(timeline.measureSeconds,[0,2,6,10]);
});


test('playhead maps a tempo-changing score to the exact current bar',()=>{
  const whole=buildPlaybackTimeline(threeBarAuditionScore(),{defaultBpm:120});
  assert.deepEqual(whole.measureSeconds,[0,2,6,10]);
  for(const [time,bar] of [[0,0],[1.99,0],[2,1],[5.99,1],[6,2],[9.99,2],[10,2]]){
    assert.equal(measureAtPlaybackSecond(whole,time),bar);
  }
  const excerpt=clipPlaybackToMeasures(whole,{start:1,end:2});
  assert.deepEqual(excerpt.measureSeconds,[0,4,8]);
  assert.equal(excerpt.selectedMeasures.start,1);
  assert.equal(measureAtPlaybackSecond(excerpt,0.1)+excerpt.selectedMeasures.start,1);
  assert.equal(measureAtPlaybackSecond(excerpt,4.1)+excerpt.selectedMeasures.start,2);
});
test('playhead refuses corrupt time boundaries and negative timestamps',()=>{
  assert.equal(measureAtPlaybackSecond({measureSeconds:[]},1),null);
  assert.equal(measureAtPlaybackSecond({measureSeconds:[0,3,2]},1),null);
  assert.equal(measureAtPlaybackSecond({measureSeconds:[0,3]},-1),null);
  assert.equal(measureAtPlaybackSecond({measureSeconds:[0,3]},Number.NaN),null);
});
