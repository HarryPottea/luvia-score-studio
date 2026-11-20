import test from 'node:test';
import assert from 'node:assert/strict';
import {rebarWrittenScore} from '../src/studio-v4-rebar-written.js';

class N {
  constructor(localName,attrs={},children=[],value=''){
    this.localName=localName;this.nodeType=1;this.ownerDocument=this;this.namespaceURI=null;
    this.parentNode=null;this._attrs={...attrs};this._value=String(value);this.children=[];
    for(const item of children)this.appendChild(item);
  }
  get attributes(){return Object.entries(this._attrs).map(([name,value])=>({name,value}));}
  get firstChild(){return this.children[0]||null;}
  get nextSibling(){if(!this.parentNode)return null;const s=this.parentNode.children;return s[s.indexOf(this)+1]||null;}
  get textContent(){return this.children.length?this.children.map(x=>x.textContent).join(''):this._value;}
  set textContent(value){this.children.forEach(x=>x.parentNode=null);this.children=[];this._value=String(value);}
  getAttribute(name){return this._attrs[name]??null;}
  setAttribute(name,value){this._attrs[name]=String(value);}
  createElementNS(_ns,tag){return new N(tag);}
  createElement(tag){return new N(tag);}
  appendChild(node){return this.insertBefore(node,null);}
  insertBefore(node,next){
    if(node.parentNode)node.parentNode.removeChild(node);
    const at=next===null?-1:this.children.indexOf(next);
    this.children.splice(at<0?this.children.length:at,0,node);node.parentNode=this;return node;
  }
  removeChild(node){const i=this.children.indexOf(node);if(i===-1)throw Error('not child');this.children.splice(i,1);node.parentNode=null;return node;}
  replaceChild(next,prev){this.insertBefore(next,prev);this.removeChild(prev);return prev;}
  cloneNode(deep=false){return new N(this.localName,this._attrs,deep?this.children.map(x=>x.cloneNode(true)):[],this._value);}
}
const n=(tag,kids=[],attrs={},value='')=>new N(tag,attrs,kids,value);
const t=(tag,value)=>n(tag,[],{},value);
const all=(node,tag)=>node?[...node.children].filter(x=>x.localName===tag):[];
const first=(node,tag)=>all(node,tag)[0];
const val=(node,tag)=>first(node,tag)?.textContent||'';
const pitch=(step,octave=4)=>n('pitch',[t('step',step),t('octave',octave)]);
function note(step,duration,type,{chord=false,lyric=null,voice='1'}={}){
  return n('note',[
    ...(chord?[n('chord')]:[]),
    pitch(step),t('duration',duration),t('voice',voice),t('type',type),
    ...(lyric?[n('lyric',[t('text',lyric)],{number:'1'})]:[])
  ]);
}
const rest=(length,type,voice='1')=>n('note',[
  n('rest'),t('duration',length),t('voice',voice),t('type',type)
]);
function create(){
  const attrs=n('attributes',[t('divisions',48),
    n('key',[t('fifths',0)]),
    n('time',[t('beats',4),t('beat-type',4)]),
    n('clef',[t('sign','G'),t('line',2)])]);
  const bar1=n('measure',[attrs,note('C',192,'whole',{lyric:'반짝이는'}),
    note('E',192,'whole',{chord:true}),
    note('G',192,'whole',{chord:true})],{number:'1'});
  const bar2=n('measure',[note('D',48,'quarter'),
    note('F',48,'quarter',{chord:true}),
    rest(96,'half'),rest(48,'quarter')],{number:'2'});
  const accomp=[
    n('measure',[n('attributes',[t('divisions',48),
      n('key',[t('fifths',0)]),
      n('time',[t('beats',4),t('beat-type',4)]),
      n('clef',[t('sign','F'),t('line',4)])]),
      rest(192,'whole')],{number:'1'}),
    n('measure',[rest(192,'whole')],{number:'2'})
  ];
  const root=n('score-partwise',[
    n('part-list',[
      n('score-part',[t('part-name','Vocal')],{id:'P1'}),
      n('score-part',[t('part-name','Bass')],{id:'P2'})
    ]),
    n('part',[bar1,bar2],{id:'P1'}),n('part',accomp,{id:'P2'})
  ],{version:'4.0'});
  function wrap(r){return {documentElement:r,cloneNode(){return wrap(r.cloneNode(true));}};}
  return wrap(root);
}
function bars(doc,partIndex=0){
  return all(all(doc.documentElement,'part')[partIndex],'measure');
}
function scoreEvents(doc){
  return bars(doc).flatMap(bar=>all(bar,'note').map(note=>({
    step:val(first(note,'pitch'),'step'),
    duration:Number(val(note,'duration')),chord:!!first(note,'chord'),
    ties:all(note,'tie').map(t=>t.getAttribute('type')),
    tied:all(first(note,'notations')||n('notations'),'tied').map(x=>x.getAttribute('type')),
    lyric:val(first(note,'lyric')||n('lyric'),'text')
  })));
}
test('rebar simple three-tone whole-note chord, preserving every pitch and Korean lyric',()=>{
  const source=create(),before=scoreEvents(source);
  const result=rebarWrittenScore(source,{meter:'3/4'});
  assert.equal(result.change.originalMeasures,2);
  assert.equal(result.change.newMeasures,3);
  assert.equal(result.change.parts,2);
  assert.equal(result.change.simpleChordsPreserved,true);
  const measures=bars(result.doc);
  assert.equal(measures.length,3);
  const opening=all(measures[0],'note');
  assert.equal(opening.length,3);
  assert.deepEqual(opening.map(x=>val(first(x,'pitch'),'step')),['C','E','G']);
  assert.deepEqual(opening.map(x=>!!first(x,'chord')),[false,true,true]);
  assert.deepEqual(opening.map(x=>Number(val(x,'duration'))),[144,144,144]);
  assert.ok(opening.every(x=>all(x,'tie').map(t=>t.getAttribute('type')).join(',')==='start'));
  assert.ok(opening.every(x=>all(first(x,'notations'),'tied')[0]?.getAttribute('type')==='start'));
  assert.equal(val(first(opening[0],'lyric'),'text'),'반짝이는');
  assert.equal(first(opening[1],'lyric'),undefined);
  const continuation=all(measures[1],'note').slice(0,3);
  assert.deepEqual(continuation.map(x=>val(first(x,'pitch'),'step')),['C','E','G']);
  assert.ok(continuation.every(x=>all(x,'tie').some(t=>t.getAttribute('type')==='stop')));
  assert.equal(val(first(continuation[0],'lyric')||n('lyric'),'text'),'');
  // The separately stored original remains unchanged.
  assert.deepEqual(scoreEvents(source),before);
  assert.equal(bars(source).length,2);
  assert.equal(bars(result.doc,1).length,3);
  // Chord markers do not consume extra rhythmic duration in any new measure.
  for(const measure of measures){
    const length=all(measure,'note').reduce((sum,n)=>sum+
      (first(n,'chord')?0:Number(val(n,'duration'))),0);
    assert.equal(length,144);
  }
});
test('chord tones are tied through multiple splits with their original chord marker',()=>{
  const source=create();
  const result=rebarWrittenScore(source,{meter:'2/4'});
  const measures=bars(result.doc);
  assert.equal(measures.length,4);
  for(const measure of measures.slice(0,2)){
    const firstChord=all(measure,'note').slice(0,3);
    assert.deepEqual(firstChord.map(x=>!!first(x,'chord')),[false,true,true]);
    assert.deepEqual(firstChord.map(x=>Number(val(x,'duration'))),[96,96,96]);
  }
});
test('reject corrupted chord duration and accidental/ornamentation without mutating source',()=>{
  const source=create(),before=scoreEvents(source);
  const opening=all(bars(source)[0],'note');
  first(opening[1],'duration').textContent='96';
  assert.throws(()=>rebarWrittenScore(source,{meter:'3/4'}),/type\/duration|동일한 길이/);
  first(opening[1],'duration').textContent='192';
  opening[0].appendChild(n('notations',[n('slur',[],{type:'start'})]));
  assert.throws(()=>rebarWrittenScore(source,{meter:'3/4'}),/보호합니다/);
  opening[0].removeChild(first(opening[0],'notations'));
  assert.deepEqual(scoreEvents(source),before);
});
test('protect duplicated or orphan chord notes',()=>{
  const source=create(),bar=bars(source)[0],opening=all(bar,'note');
  first(opening[1],'pitch').replaceChild(t('step','C'),first(first(opening[1],'pitch'),'step'));
  assert.throws(()=>rebarWrittenScore(source,{meter:'3/4'}),/중복된 화음/);
  first(opening[1],'pitch').replaceChild(t('step','E'),first(first(opening[1],'pitch'),'step'));
  bar.insertBefore(n('note',[n('chord'),pitch('A'),t('duration',192),t('type','whole')]),opening[0]);
  assert.throws(()=>rebarWrittenScore(source,{meter:'3/4'}),/앞선 일반 음표/);
});


test('chromatic F-sharp chord tone preserves explicit sharp on onset, suppresses on tied continuation',()=>{
  const source=create(),bar=bars(source)[0],tone=all(bar,'note')[1];
  const writtenPitch=first(tone,'pitch');
  writtenPitch.insertBefore(t('alter',1),first(writtenPitch,'octave'));
  tone.appendChild(t('accidental','sharp'));
  const result=rebarWrittenScore(source,{meter:'3/4'});
  assert.equal(result.change.chromaticPitchesPreserved,true);
  const opening=all(bars(result.doc)[0],'note')[1],
    continuation=all(bars(result.doc)[1],'note')[1];
  assert.equal(val(first(opening,'pitch'),'alter'),'1');
  assert.equal(val(first(continuation,'pitch'),'alter'),'1');
  assert.equal(val(opening,'accidental'),'sharp');
  assert.equal(first(continuation,'accidental'),undefined);
  assert.equal(first(opening,'tie').getAttribute('type'),'start');
  assert.equal(first(continuation,'tie').getAttribute('type'),'stop');
  assert.equal(val(tone,'accidental'),'sharp');
});
test('unsupported accidental decorations are blocked without rewriting original chord',()=>{
  const source=create(),bar=bars(source)[0],tone=all(bar,'note')[1];
  const written=first(tone,'pitch');
  written.insertBefore(t('alter',1),first(written,'octave'));
  const accidental=t('accidental','sharp');
  accidental.setAttribute('parentheses','yes');
  tone.appendChild(accidental);
  assert.throws(()=>rebarWrittenScore(source,{meter:'3/4'}),/장식적 임시표|변화표/);
  assert.equal(val(first(tone,'pitch'),'alter'),'1');
  assert.equal(accidental.getAttribute('parentheses'),'yes');
});
