import test from 'node:test';
import assert from 'node:assert/strict';
import {deleteScoreMeasure} from '../src/studio-v4-measure-delete.js';

class Node {
  constructor(localName,attrs={},children=[]){
    this.localName=localName;this.attr={...attrs};this.children=[];
    for(const child of children)this.appendChild(child);
  }
  get firstChild(){return this.children[0]||null;}
  getAttribute(k){return Object.hasOwn(this.attr,k)?this.attr[k]:null;}
  setAttribute(k,v){this.attr[k]=String(v);}
  appendChild(node){this.children.push(node);return node;}
  insertBefore(node,ref){
    const at=this.children.indexOf(ref);
    this.children.splice(at<0?this.children.length:at,0,node);return node;
  }
  removeChild(node){
    const at=this.children.indexOf(node);
    if(at===-1)throw Error('not a child');
    this.children.splice(at,1);return node;
  }
  cloneNode(){return new Node(this.localName,this.attr,this.children.map(c=>c.cloneNode(true)));}
}
const n=(name,attrs={},kids=[])=>new Node(name,attrs,kids);
const note=()=>n('note',{},[n('pitch'),n('duration')]);
const score=(count=5,parts=2)=>({
  documentElement:n('score-partwise',{},Array.from({length:parts},(_,p)=>n('part',{id:'P'+p},
    Array.from({length:count},(_,i)=>n('measure',{number:String(i+1)},[
      ...(i===0?[n('attributes',{},[n('divisions'),n('time'),n('clef')])]:[]),
      note()
    ]))))),
  cloneNode(){const d=this.documentElement.cloneNode(true);return {documentElement:d,cloneNode:this.cloneNode};}
});
const partBars=(doc,index=0)=>doc.documentElement.children[index].children;
const ids=doc=>partBars(doc).map(bar=>bar.getAttribute('number'));

test('middle measure is deleted from all parts and renumbered',()=>{
  const source=score();const before=partBars(source)[3];
  const {doc,change}=deleteScoreMeasure(source,{measureIndex:2});
  assert.deepEqual(ids(doc),['1','2','3','4']);
  assert.equal(partBars(doc,0).length,4);assert.equal(partBars(doc,1).length,4);
  assert.equal(partBars(doc)[2].children.length,before.children.length);
  assert.equal(change.action,'delete-measure');
  assert.equal(partBars(source).length,5);
});
test('first measure transfers initial attributes to new first measure',()=>{
  const {doc}=deleteScoreMeasure(score(),{measureIndex:0});
  assert.equal(partBars(doc)[0].children[0].localName,'attributes');
  assert.deepEqual(ids(doc),['1','2','3','4']);
});
test('last measure can be removed',()=>{
  const {doc}=deleteScoreMeasure(score(),{measureIndex:4});
  assert.equal(partBars(doc).length,4);
});
test('last barline is retained when removing last measure',()=>{
  const doc=score();partBars(doc).at(-1).appendChild(n('barline',{location:'right'},[n('bar-style')]));
  const result=deleteScoreMeasure(doc,{measureIndex:4});
  assert.equal(partBars(result.doc).at(-1).children.at(-1).localName,'barline');
});
test('cannot delete sole measure',()=>{
  assert.throws(()=>deleteScoreMeasure(score(1),{measureIndex:0}),/최소 1마디/);
});
test('protects ties and slurs; original remains unchanged',()=>{
  const doc=score();partBars(doc)[1].children[0].appendChild(n('notations',{},[n('tied',{type:'start'})]));
  assert.throws(()=>deleteScoreMeasure(doc,{measureIndex:1}),/보호할 구조/);
  assert.equal(partBars(doc).length,5);
});
test('protects internal time or key changes',()=>{
  const doc=score();partBars(doc)[2].appendChild(n('attributes',{},[n('time')]));
  assert.throws(()=>deleteScoreMeasure(doc,{measureIndex:2}),/조표·박자표/);
});
test('rejects asymmetric parts and special measure numbering',()=>{
  const doc=score();partBars(doc,1).pop();
  assert.throws(()=>deleteScoreMeasure(doc,{measureIndex:1}),/파트별 마디 수/);
  const other=score();partBars(other)[1].setAttribute('number','2a');
  assert.throws(()=>deleteScoreMeasure(other,{measureIndex:1}),/특수 마디 번호/);
});
test('rejects first bar when next measure changes attributes',()=>{
  const doc=score();partBars(doc)[1].appendChild(n('attributes',{},[n('time')]));
  assert.throws(()=>deleteScoreMeasure(doc,{measureIndex:0}),/첫 마디 속성/);
});
