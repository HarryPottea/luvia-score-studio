import test from 'node:test';
import assert from 'node:assert/strict';
import {planDensityLayout,applyDensityLayout} from '../src/studio-v4-auto-layout.js';

class Element{
  constructor(localName,children=[],props={},value=''){
    this.localName=localName;this._attributes={...props};this._value=String(value);
    this.children=[];this.parentNode=null;this.nodeType=1;this.ownerDocument=this;
    for(const node of children)this.appendChild(node);
  }
  get firstChild(){return this.children[0]||null;}
  get attributes(){return Object.entries(this._attributes).map(([name,value])=>({name,value}));}
  get textContent(){return this.children.length?this.children.map(n=>n.textContent).join(''):this._value;}
  set textContent(value){this._value=String(value);this.children=[];}
  getAttribute(name){return this._attributes[name]??null;}
  setAttribute(name,value){this._attributes[name]=String(value);}
  removeAttribute(name){delete this._attributes[name];}
  appendChild(node){return this.insertBefore(node,null);}
  insertBefore(node,before){
    if(node.parentNode)node.parentNode.removeChild(node);
    const i=before?this.children.indexOf(before):-1;
    this.children.splice(i===-1?this.children.length:i,0,node);node.parentNode=this;return node;
  }
  removeChild(node){
    const i=this.children.indexOf(node);if(i===-1)throw new Error('detached');
    this.children.splice(i,1);node.parentNode=null;return node;
  }
  cloneNode(deep=false){
    return new Element(this.localName,deep?this.children.map(x=>x.cloneNode(true)):[],this._attributes,this._value);
  }
  createElementNS(ns,tag){return new Element(tag);}
  createElement(tag){return new Element(tag);}
}
const el=(tag,children=[],attrs={},value='')=>new Element(tag,children,attrs,value);
const text=(tag,v)=>el(tag,[],{},v);
const first=(node,tag)=>node.children.find(x=>x.localName===tag);
const bars=part=>part.children.filter(x=>x.localName==='measure');
const printed=bar=>first(bar,'print')?.getAttribute('new-system')||first(bar,'print')?.getAttribute('new-page')||'none';
function score({parts=2,count=12,notes=4,lyrics=false}={}){
  const root=el('score-partwise',Array.from({length:parts},(_,p)=>
    el('part',Array.from({length:count},(_,i)=>{
      const events=Array.from({length:notes},(_,k)=>el('note',[
        el('pitch',[text('step','C'),text('octave',4)]),text('duration',48),
        text('type','quarter'),
        ...(lyrics?[el('lyric',[text('text',i%2===0?'매우긴노랫말':'안녕')])]:[])
      ]));
      return el('measure',[
        ...(i===0?[el('attributes',[text('divisions','48'),
          el('time',[text('beats',4),text('beat-type',4)]),
          ...(p===1?[text('staves','2')]:[])])]:[]),...events
      ],{number:String(i+1)});
    }),{id:'P'+p})));
  return {documentElement:root,cloneNode(){return copy(root.cloneNode(true));}};
}
function copy(root){return {documentElement:root,cloneNode(){return copy(root.cloneNode(true));}};}
function marks(doc){return doc.documentElement.children.map(p=>bars(p).map(printed));}

test('automatic layout is deterministic and has matching break indices in each part',()=>{
  const source=score();
  const plan=planDensityLayout(source);
  assert.ok(plan.systems>=2);
  assert.ok(plan.systemsPerPage>=1);
  assert.equal(plan.expected.length,12);
  const changed=applyDensityLayout(source);
  const a=marks(changed.doc);
  assert.deepEqual(a[0],a[1]);
  assert.ok(a[0].some(x=>x!=='none'));
  assert.equal(changed.change.collisionVerified,false);
  assert.deepEqual(marks(source)[0],Array(12).fill('none'));
  assert.equal(plan.expected[0],'none');
});
test('lyrics increase calculated horizontal space, encouraging additional systems',()=>{
  const plain=planDensityLayout(score({lyrics:false}));
  const vocal=planDensityLayout(score({lyrics:true}));
  assert.ok(vocal.systems>=plain.systems);
  assert.ok(vocal.widths.some((n,i)=>n>plain.widths[i]));
});
test('larger landscape capacity keeps at least as many bars per system',()=>{
  const source=score({count:16});
  const portrait=planDensityLayout(source,{pageFormat:'A4_P'});
  const landscape=planDensityLayout(source,{pageFormat:'A4_L'});
  assert.ok(landscape.systems<=portrait.systems);
  assert.ok(landscape.capacity>portrait.capacity);
});
test('manual breaks are preserved unless explicitly allowed to replace',()=>{
  const source=score();
  bars(source.documentElement.children[0])[1].insertBefore(
    el('print',[],{'new-page':'yes'}),bars(source.documentElement.children[0])[1].firstChild);
  assert.throws(()=>planDensityLayout(source),/기존 수동/);
  const result=applyDensityLayout(source,{replaceExisting:true});
  assert.equal(marks(result.doc)[0][1],'none');
  assert.equal(marks(source)[0][1],'yes');
});
test('unbalanced measures and unsupported document never mutate input',()=>{
  const source=score();
  const part=source.documentElement.children[1];
  part.removeChild(bars(part).at(-1));
  assert.throws(()=>planDensityLayout(source),/동일 길이/);
  assert.equal(bars(source.documentElement.children[0]).length,12);
  assert.equal(bars(source.documentElement.children[1]).length,11);
  assert.throws(()=>planDensityLayout(score(),{pageFormat:'LETTER'}),/용지 방향/);
});
