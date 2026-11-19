import test from 'node:test';
import assert from 'node:assert/strict';
import {parseChordSymbol,readChordSymbol,editChordSymbol} from '../src/studio-v4-chords.js';
class E{
  constructor(localName,attrs={},children=[],raw=''){
    this.localName=localName;this.map={...attrs};this.children=[];this.raw=String(raw);
    this.ownerDocument=null;this.namespaceURI=null;this.parentNode=null;
    for(const n of children)this.appendChild(n);
  }
  get attributes(){return Object.entries(this.map).map(([name,value])=>({name,value}));}
  get textContent(){return this.children.length?this.children.map(x=>x.textContent).join(''):this.raw;}
  set textContent(value){this.raw=String(value);this.children=[];}
  get previousSibling(){if(!this.parentNode)return null;const a=this.parentNode.children;return a[a.indexOf(this)-1]||null;}
  get previousElementSibling(){return this.previousSibling;}
  getAttribute(n){return this.map[n]??null;}
  setAttribute(n,v){this.map[n]=String(v);}
  assignDocument(d){this.ownerDocument=d;for(const c of this.children)c.assignDocument(d);}
  appendChild(n){if(n.parentNode)n.parentNode.removeChild(n);this.children.push(n);n.parentNode=this;n.assignDocument(this.ownerDocument);return n;}
  insertBefore(n,before){
    if(!before)return this.appendChild(n);
    const i=this.children.indexOf(before);if(i<0)throw Error('missing');
    if(n.parentNode)n.parentNode.removeChild(n);
    this.children.splice(i,0,n);n.parentNode=this;n.assignDocument(this.ownerDocument);return n;
  }
  removeChild(n){const i=this.children.indexOf(n);if(i<0)throw Error('missing');this.children.splice(i,1);n.parentNode=null;return n;}
  cloneNode(deep){return new E(this.localName,this.map,deep?this.children.map(c=>c.cloneNode(true)):[],this.raw);}
}
class Document{
  constructor(root){this.documentElement=root;root.assignDocument(this);}
  createElementNS(ns,name){const node=new E(name);node.namespaceURI=ns;node.assignDocument(this);return node;}
  cloneNode(){return new Document(this.documentElement.cloneNode(true));}
}
const el=(name,children=[],attrs={},raw='')=>new E(name,attrs,children,raw);
const txt=(name,value)=>el(name,[],{},String(value));
const one=(n,t)=>n?.children.find(x=>x.localName===t);
const many=(n,t)=>n?.children.filter(x=>x.localName===t)||[];
const note=(step='C',voice=null,staff=null)=>el('note',[
  el('pitch',[txt('step',step),txt('octave',4)]),
  txt('duration',4),...(voice?[txt('voice',voice)]:[]),
  txt('type','quarter'),...(staff?[txt('staff',staff)]:[])
]);
function score(poly=false){
  const attrs=el('attributes',[txt('divisions',4),el('time',[txt('beats',4),txt('beat-type',4)]),
    ...(poly?[txt('staves',2)]:[])]);
  const original=[attrs,...['C','D','E','F'].map(x=>note(x,poly?'1':null,poly?'1':null))];
  if(poly)original.push(el('backup',[txt('duration',16)]),...['G','A','B','C'].map(x=>note(x,'2','2')));
  const root=el('score-partwise',[el('part',[el('measure',original,{number:'1'})],{id:'P1'})]);
  return new Document(root);
}
function sig(doc){
  const measure=one(one(doc.documentElement,'part'),'measure');
  return JSON.stringify(measure.children.filter(x=>['note','backup','forward'].includes(x.localName))
    .map(x=>[x.localName,JSON.stringify(x.children.map(n=>[n.localName,n.textContent]))]));
}
function harmony(doc,part='P1'){
  const measure=one(doc.documentElement.children.find(p=>p.getAttribute('id')===part),'measure');
  return many(measure,'harmony');
}
const pos={partId:'P1',measureIndex:0,eventIndex:1};
test('parse common chord symbols and slash bass without interpreting source code',()=>{
  const names=['C','Cm','Am7','F#maj7','Bb/D','G7','Csus4','Dm7b5','F#dim7','Cadd9'];
  for(const name of names)assert.equal(parseChordSymbol(name).symbol,name);
  assert.equal(parseChordSymbol('B♭/F♯').symbol,'Bb/F#');
  assert.equal(parseChordSymbol('Am7').kind,'minor-seventh');
  for(const invalid of ['H7','C#random','C<script>','', 'C7/G/Db','C 7']){
    assert.throws(()=>parseChordSymbol(invalid));
  }
});
test('chord insert, replace, remove are one immutable operation and preserve all notes',()=>{
  const source=score(),original=sig(source);
  const withChord=editChordSymbol(source,pos,{symbol:'Am7'}).doc;
  assert.notEqual(withChord,source);
  assert.equal(sig(source),original);
  assert.equal(sig(withChord),original);
  assert.equal(harmony(source).length,0);
  assert.equal(harmony(withChord).length,1);
  const h=harmony(withChord)[0];
  assert.equal(one(one(h,'root'),'root-step').textContent,'A');
  assert.equal(one(h,'kind').textContent,'minor-seventh');
  assert.equal(one(h,'kind').getAttribute('text'),'m7');
  assert.equal(readChordSymbol(withChord,pos).symbol,'Am7');
  const measure=one(one(withChord.documentElement,'part'),'measure');
  const noteAt= many(measure,'note')[1];
  assert.equal(noteAt.previousSibling,h);
  const replacement=editChordSymbol(withChord,pos,{symbol:'Bb/D'}).doc;
  assert.equal(harmony(replacement).length,1);
  assert.equal(readChordSymbol(replacement,pos).symbol,'Bb/D');
  assert.equal(one(one(harmony(replacement)[0],'bass'),'bass-step').textContent,'D');
  assert.equal(sig(replacement),original);
  const removed=editChordSymbol(replacement,pos,{mode:'remove'}).doc;
  assert.equal(harmony(removed).length,0);
  assert.equal(sig(removed),original);
});
test('MusicXML add9 includes degree; different staff/voice remains unchanged',()=>{
  const original=score(true),before=sig(original);
  const selected={partId:'P1',measureIndex:0,eventIndex:4};
  const out=editChordSymbol(original,selected,{symbol:'Cadd9'}).doc;
  assert.equal(sig(out),before);
  assert.equal(sig(original),before);
  const h=harmony(out)[0];
  assert.equal(one(h,'staff').textContent,'2');
  assert.equal(one(one(h,'degree'),'degree-value').textContent,'9');
  assert.equal(readChordSymbol(out,selected).voice,'2');
  assert.equal(readChordSymbol(out,selected).symbol,'Cadd9');
});
test('unsupported and complex existing harmony is protected without mutation',()=>{
  const s=score(),before=sig(s);
  assert.throws(()=>editChordSymbol(s,{...pos,eventIndex:10},{symbol:'C'}));
  assert.throws(()=>editChordSymbol(s,pos,{mode:'remove'}),/삭제할 코드/);
  const complex=editChordSymbol(s,pos,{symbol:'C'}).doc;
  const h=harmony(complex)[0];h.appendChild(el('frame',[txt('frame-strings',6)]));
  assert.throws(()=>editChordSymbol(complex,pos,{symbol:'F'}),/복잡한 코드/);
  assert.throws(()=>editChordSymbol(complex,pos,{mode:'remove'}),/복잡한 코드/);
  assert.equal(sig(s),before);
});
