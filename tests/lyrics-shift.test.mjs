import test from 'node:test';
import assert from 'node:assert/strict';
import {shiftPlacedLyrics,planPlacedLyricShift} from '../src/studio-v4-lyrics-shift.js';

// Minimal MusicXML DOM for deterministic, network-free regression testing.
class Element {
  constructor(name,doc){this.localName=name;this.ownerDocument=doc;this.namespaceURI=null;this.children=[];this._text='';this._attrs=new Map();}
  get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}
  set textContent(value){this._text=String(value);this.children=[];}
  get attributes(){return [...this._attrs].map(([name,value])=>({name,value}));}
  getAttribute(name){return this._attrs.get(name)??null;}
  setAttribute(name,value){this._attrs.set(name,String(value));}
  appendChild(n){this.children.push(n);return n;}
  removeChild(n){const i=this.children.indexOf(n);if(i<0)throw Error('not a child');this.children.splice(i,1);return n;}
  insertBefore(n,ref){if(ref===null)return this.appendChild(n);const i=this.children.indexOf(ref);if(i<0)throw Error('not a child');this.children.splice(i,0,n);return n;}
}
class Doc {
  constructor(){this.documentElement=this.createElement('score-partwise');}
  createElement(name){return new Element(name,this);}
  createElementNS(_,name){return this.createElement(name);}
  cloneNode(){const d=new Doc();const copy=n=>{const x=d.createElement(n.localName);x._text=n._text;
    for(const [k,v] of n._attrs)x.setAttribute(k,v);for(const c of n.children)x.appendChild(copy(c));return x;};
    d.documentElement=copy(this.documentElement);return d;}
}
const kids=(n,name)=>n?[...n.children].filter(x=>x.localName===name):[];
const first=(n,name)=>kids(n,name)[0]||null;
function tag(parent,name,value){const el=parent.ownerDocument.createElement(name);if(value!==undefined)el.textContent=value;parent.appendChild(el);return el;}
function fixture(polyphony=false){
  const d=new Doc(),part=tag(d.documentElement,'part');part.setAttribute('id','P1');
  for(let m=0;m<2;m++){
    const measure=tag(part,'measure');measure.setAttribute('number',String(m+1));
    const attrs=tag(measure,'attributes');tag(attrs,'divisions',4);
    const time=tag(attrs,'time');tag(time,'beats',4);tag(time,'beat-type',4);
    const addNote=(step,voice)=>{
      const n=tag(measure,'note');const pitch=tag(n,'pitch');tag(pitch,'step',step);tag(pitch,'octave',4);
      tag(n,'duration',4);tag(n,'voice',voice);tag(n,'type','quarter');return n;
    };
    for(let j=0;j<4;j++)addNote('C','1');
    if(polyphony){tag(measure,'backup').appendChild(d.createElement('duration')).textContent=16;
      for(let j=0;j<4;j++)addNote('D','2');}
  }
  return d;
}
const notes=(d,m=0)=>kids(kids(kids(d.documentElement,'part')[0],'measure')[m],'note');
function addLyric(note,value,verse='1'){
  const lyric=tag(note,'lyric');lyric.setAttribute('number',verse);
  tag(lyric,'syllabic','single');tag(lyric,'text',value);
}
function view(d,m=0,verse='1',start=0,end=4){
  return notes(d,m).slice(start,end).map(n=>first(kids(n,'lyric').find(x=>x.getAttribute('number')===verse),'text')?.textContent||'·');
}
const pick=(eventIndex,opts={})=>({partId:'P1',measureIndex:0,eventIndex,verse:1,direction:'right',...opts});

test('post-paste push moves selected and following lyrics without altering original',()=>{
  const d=fixture();['오','늘','도','우','리'].forEach((v,i)=>addLyric(notes(d,i<4?0:1)[i%4],v));
  const original=view(d);
  const out=shiftPlacedLyrics(d,pick(1)).doc;
  assert.deepEqual(view(out),['오','·','늘','도']);
  assert.deepEqual(view(out,1),['우','리','·','·']);
  assert.deepEqual(view(d),original);
});
test('pull is inverse of push and preserves MusicXML melodic durations',()=>{
  const d=fixture();['오','늘','도','우','리'].forEach((v,i)=>addLyric(notes(d,i<4?0:1)[i%4],v));
  const out=shiftPlacedLyrics(d,pick(1)).doc;
  const restored=shiftPlacedLyrics(out,pick(2,{direction:'left'})).doc;
  assert.deepEqual(view(restored),['오','늘','도','우']);
  assert.deepEqual(view(restored,1),['리','·','·','·']);
  assert.equal(first(notes(restored)[2],'duration').textContent,4);
});
test('full score has no room: reject and leave original untouched',()=>{
  const d=fixture();for(let i=0;i<8;i++)addLyric(notes(d,i<4?0:1)[i%4],String(i));
  assert.throws(()=>shiftPlacedLyrics(d,pick(0)),/빈 가사 위치/);
  assert.deepEqual(view(d),['0','1','2','3']);
});
test('other verse and parallel voice are protected',()=>{
  const d=fixture(true);for(let i=0;i<3;i++)addLyric(notes(d)[4+i],['가','나','다'][i]);
  addLyric(notes(d)[4],'ONE','2');addLyric(notes(d)[0],'보존');
  const out=shiftPlacedLyrics(d,pick(5)).doc;
  assert.deepEqual(view(out,0,'1',4,8),['가','·','나','다']);
  assert.deepEqual(view(out,0,'2',4,8),['ONE','·','·','·']);
  assert.equal(view(out)[0],'보존');
});
test('plan is side-effect free and respects target verse',()=>{
  const d=fixture();for(let i=0;i<3;i++)addLyric(notes(d)[i],['가','나','다'][i]);
  const plan=planPlacedLyricShift(d,pick(1));
  assert.equal(plan.affected,2);
  assert.deepEqual(view(d),['가','나','다','·']);
});
