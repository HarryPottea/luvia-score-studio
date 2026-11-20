import test from 'node:test';
import assert from 'node:assert/strict';
import {addEmptyInstrumentPart} from '../src/studio-v4-add-part.js';

class Element{
  constructor(localName,children=[],attrs={},value=''){
    this.nodeType=1;this.localName=localName;this._attrs={...attrs};this._value=String(value);
    this.children=[];this.parentNode=null;this.ownerDocument=this;
    for(const item of children)this.appendChild(item);
  }
  get attributes(){return Object.entries(this._attrs).map(([name,value])=>({name,value}));}
  get textContent(){return this.children.length?this.children.map(x=>x.textContent).join(''):this._value;}
  set textContent(v){this.children=[];this._value=String(v);}
  getAttribute(n){return this._attrs[n]??null;}
  setAttribute(n,v){this._attrs[n]=String(v);}
  createElementNS(_ns,name){return new Element(name);}
  createElement(name){return new Element(name);}
  appendChild(node){this.children.push(node);node.parentNode=this;return node;}
  cloneNode(deep=false){return new Element(this.localName,deep?this.children.map(x=>x.cloneNode(true)):[],this._attrs,this._value);}
}
const e=(tag,children=[],attrs={},value='')=>new Element(tag,children,attrs,value);
const t=(tag,value)=>e(tag,[],{},value);
const all=(node,tag)=>node.children.filter(x=>x.localName===tag);
const first=(node,tag)=>all(node,tag)[0];
function score(){
  const makeTime=(beats)=>e('time',[t('beats',beats),t('beat-type',4)]);
  const firstAttributes=e('attributes',[t('divisions',48),
    e('key',[t('fifths',0)]),makeTime(4),
    e('clef',[t('sign','G'),t('line',2)])]);
  const m1=e('measure',[firstAttributes,e('note',[e('rest'),t('duration',192),t('type','whole')])],{number:'1'});
  const m2=e('measure',[e('attributes',[makeTime(3)]),
    e('note',[e('rest'),t('duration',144),t('type','half'),e('dot')])],{number:'2'});
  const m3=e('measure',[e('attributes',[makeTime(4)]),
    e('note',[e('rest'),t('duration',192),t('type','whole')])],{number:'3'});
  const root=e('score-partwise',[e('part-list',[e('score-part',[t('part-name','Melody')],{id:'P1'})]),
    e('part',[m1,m2,m3],{id:'P1'})],{version:'4.0'});
  return {documentElement:root,cloneNode(){return {documentElement:root.cloneNode(true),cloneNode:this.cloneNode};}};
}
test('appends named melody part with current meter changes and no source mutation',()=>{
  const source=score();
  const result=addEmptyInstrumentPart(source,{name:'새 보컬',instrument:'vocal'});
  const root=result.doc.documentElement,parts=all(root,'part');
  assert.equal(parts.length,2);
  assert.equal(result.change.partId,'P2');
  assert.equal(first(all(root,'part-list')[0],'score-part').getAttribute('id'),'P1');
  assert.equal(all(first(root,'part-list'),'score-part').length,2);
  assert.equal(all(parts[1],'measure').length,3);
  assert.deepEqual(all(parts[1],'measure').map(bar=>
    all(bar,'note').reduce((n,item)=>n+Number(first(item,'duration').textContent),0)),
    [192,144,192]);
  assert.equal(first(all(parts[1],'measure')[1],'attributes').textContent,'34');
  assert.equal(all(source.documentElement,'part').length,1);
  assert.equal(first(first(all(source.documentElement,'part')[0],'measure'),'attributes').textContent.includes('48'),true);
});
test('piano part gets two independent staves and exact backup in each bar',()=>{
  const result=addEmptyInstrumentPart(score(),{name:'Piano',instrument:'piano'});
  const piano=all(result.doc.documentElement,'part')[1];
  const bars=all(piano,'measure');
  assert.equal(first(first(bars[0],'attributes'),'staves').textContent,'2');
  assert.deepEqual(bars.map(x=>Number(first(first(x,'backup'),'duration').textContent)),[192,144,192]);
  assert.ok(bars.every(bar=>all(bar,'note').some(n=>first(n,'staff').textContent==='2')));
  assert.equal(all(first(bars[0],'attributes'),'clef').length,2);
  assert.equal(result.change.staves,2);
});
test('reject conflicting time signatures, uneven parts or unsupported names',()=>{
  const source=score();
  assert.throws(()=>addEmptyInstrumentPart(source,{instrument:'brass'}),/종류/);
  assert.throws(()=>addEmptyInstrumentPart(source,{name:'\n',instrument:'vocal'}),/이름/);
  const root=source.documentElement;
  const second=all(root,'part')[0].cloneNode(true);
  second.setAttribute('id','P2');
  second.children.pop();
  root.appendChild(second);
  root.children[0].appendChild(e('score-part',[t('part-name','Other')],{id:'P2'}));
  assert.throws(()=>addEmptyInstrumentPart(source),/마디 수/);
});
