import test from 'node:test';
import assert from 'node:assert/strict';
import {readInlineLyric,nextInlineLyricPosition,smartLyricTokens}
  from '../src/studio-v4-lyrics-inline.js';
import {setNoteVerse} from '../src/studio-v4-composer.js';

class E {
  constructor(localName,attrs={},children=[],raw=''){
    this.localName=localName;this.map={...attrs};this.children=[];this.raw=String(raw);
    this.ownerDocument=null;this.namespaceURI=null;this.parentNode=null;
    for(const c of children)this.appendChild(c);
  }
  get attributes(){return Object.entries(this.map).map(([name,value])=>({name,value}));}
  get textContent(){return this.children.length?this.children.map(x=>x.textContent).join(''):this.raw;}
  set textContent(value){this.raw=String(value);this.children=[];}
  getAttribute(name){return this.map[name]??null;}
  setAttribute(name,value){this.map[name]=String(value);}
  assignDocument(doc){this.ownerDocument=doc;for(const c of this.children)c.assignDocument(doc);}
  appendChild(c){if(c.parentNode)c.parentNode.removeChild(c);this.children.push(c);c.parentNode=this;c.assignDocument(this.ownerDocument);return c;}
  insertBefore(c,before){if(!before)return this.appendChild(c);
    const i=this.children.indexOf(before);if(i<0)throw Error('Invalid sibling');
    if(c.parentNode)c.parentNode.removeChild(c);this.children.splice(i,0,c);c.parentNode=this;c.assignDocument(this.ownerDocument);return c;}
  removeChild(c){const i=this.children.indexOf(c);if(i<0)throw Error('Not a child');this.children.splice(i,1);c.parentNode=null;return c;}
  cloneNode(deep){return new E(this.localName,this.map,deep?this.children.map(x=>x.cloneNode(true)):[],this.raw);}
}
class D {
  constructor(root){this.documentElement=root;root.assignDocument(this);}
  createElementNS(_,name){const e=new E(name);e.assignDocument(this);return e;}
  cloneNode(){return new D(this.documentElement.cloneNode(true));}
}
const el=(tag,children=[],attrs={},raw='')=>new E(tag,attrs,children,raw);
const t=(tag,v)=>el(tag,[],{},v);
const first=(n,k)=>n?.children.find(x=>x.localName===k);
const nodes=(n,k)=>n?.children.filter(x=>x.localName===k)||[];
const lyric=(verse,textValue,syllabic='single',extend=null)=>el('lyric',[
  t('syllabic',syllabic),t('text',textValue),...(extend?[el('extend',[],{type:extend})]:[])
],{number:String(verse)});
const note=(step,voice,staff,extra=[])=>el('note',[
  el('pitch',[t('step',step),t('octave','4')]),t('duration','4'),t('voice',voice),
  t('type','quarter'),t('staff',staff),...extra
]);
function fixture(){
  const bars=[];
  for(let i=0;i<2;i++){
    const at=i===0?[el('attributes',[
      t('divisions',4),el('time',[t('beats','4'),t('beat-type','4')])
    ])]:[];
    bars.push(el('measure',[
      ...at,
      ...['C','D','E','F'].map(x=>note(x,'1','1')),
      el('backup',[t('duration','16')]),
      ...['G','A','B','C'].map(x=>note(x,'2','2'))
    ],{number:String(i+1)}));
  }
  return new D(el('score-partwise',[el('part',bars,{id:'P1'})]));
}
function at(doc,m,i){return nodes(nodes(doc.documentElement,'part')[0],'measure')[m].children.filter(x=>x.localName==='note')[i];}
function loc(measureIndex,eventIndex){return {partId:'P1',measureIndex,eventIndex};}
test('inline lyrics: Korean words segment into individual syllables and respect melisma',()=>{
  const tokens=smartLyricTokens('우리 함께');
  assert.deepEqual(tokens.map(x=>x.text),['우','리','함','께']);
  assert.deepEqual(tokens.map(x=>x.syllabic),['begin','end','begin','end']);
  const melisma=smartLyricTokens('아 _ _ 너');
  assert.equal(melisma.length,4);
  assert.deepEqual(melisma.map(x=>x.extend),['start','continue','stop','none']);
  assert.deepEqual(smartLyricTokens(''),[]);
});
test('inline lyrics: read selected verse and preserve other verse + extension when edited',()=>{
  const original=fixture();
  at(original,0,0).appendChild(lyric(1,'오','begin','start'));
  at(original,0,0).appendChild(lyric(2,'you','single'));
  const info=readInlineLyric(original,loc(0,0),{verse:1});
  assert.deepEqual([info.text,info.syllabic,info.extend,info.voice,info.staff],
    ['오','begin','start','1','1']);
  const edited=setNoteVerse(original,{...loc(0,0),verse:1,
    text:'아',syllabic:info.syllabic,extend:info.extend}).doc;
  assert.equal(readInlineLyric(edited,loc(0,0),{verse:1}).text,'아');
  assert.equal(readInlineLyric(edited,loc(0,0),{verse:1}).extend,'start');
  assert.equal(readInlineLyric(edited,loc(0,0),{verse:2}).text,'you');
  assert.equal(readInlineLyric(original,loc(0,0),{verse:1}).text,'오');
  assert.equal(first(at(edited,0,0),'duration').textContent,'4');
});
test('inline lyrics: next position follows the selected voice across measure boundaries',()=>{
  const doc=fixture();
  at(doc,0,1).appendChild(el('tie',[],{type:'stop'}));
  assert.deepEqual(nextInlineLyricPosition(doc,loc(0,0)),loc(0,2));
  assert.deepEqual(nextInlineLyricPosition(doc,loc(0,3)),loc(1,0));
  assert.deepEqual(nextInlineLyricPosition(doc,loc(0,4)),loc(0,5));
  assert.equal(nextInlineLyricPosition(doc,loc(1,7)),null);
  assert.throws(()=>readInlineLyric(doc,loc(0,1)),/붙임줄/);
});
test('inline lyrics: protect chord tones, unsupported markup and duplicate verse structures',()=>{
  const doc=fixture();
  at(doc,0,1).insertBefore(el('chord'),at(doc,0,1).children[0]);
  assert.throws(()=>readInlineLyric(doc,loc(0,1)),/화음/);
  const decorated=fixture();
  const l=lyric(1,'사');
  l.appendChild(t('elision','↿'));
  at(decorated,0,0).appendChild(l);
  assert.throws(()=>readInlineLyric(decorated,loc(0,0)),/복합/);
  const duplicate=fixture();
  at(duplicate,0,0).appendChild(lyric(1,'첫'));
  at(duplicate,0,0).appendChild(lyric(1,'둘'));
  assert.throws(()=>readInlineLyric(duplicate,loc(0,0)),/중복/);
  assert.throws(()=>readInlineLyric(duplicate,loc(0,0),{verse:13}),/1~12/);
});
