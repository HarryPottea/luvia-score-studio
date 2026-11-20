import test from 'node:test';
import assert from 'node:assert/strict';
import {captureMeasureRange,pasteMeasureRange,duplicateMeasureRange,
  deleteMeasureRange,insertBlankMeasureRange} from '../src/studio-v4-measure-blocks.js';
import {createEditorHistory} from '../src/editor-history.js';

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
  assert.throws(()=>captureMeasureRange(a,{start:2,end:2}),/연결·반복/);
  assert.throws(()=>deleteMeasureRange(a,{start:3,end:3}),/연결 기호/);
  assert.equal(rows(a)[0].length,6);
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
