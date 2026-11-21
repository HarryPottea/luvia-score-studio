import test from 'node:test';
import assert from 'node:assert/strict';
import {stampSoftwareCopyright,J_WOO_COPYRIGHT} from '../src/studio-v4-software-copyright.js';
function fakePage(){
  const children=[];
  const svg={localName:'svg',children,
    getAttribute(key){return key==='viewBox'?'0 0 794 1123':null;},
    querySelectorAll(key){return key==='[data-jwoo-software-copyright]'?
      children.filter(n=>n.attributes['data-jwoo-software-copyright']):[];},
    ownerDocument:{createElementNS(_namespace,localName){
      return {localName,attributes:{},setAttribute(key,val){this.attributes[key]=val;},
        remove(){const index=children.indexOf(this);if(index>=0)children.splice(index,1);},
        textContent:''};
    }},
    appendChild(node){children.push(node);}
  };
  return svg;
}
test('every page receives the PARKJAEWOO software notice in A4 portrait and landscape',()=>{
  for(const format of ['A4_P','A4_L']){
    const pages=[fakePage(),fakePage()];
    assert.equal(stampSoftwareCopyright(pages,format),2);
    for(const page of pages){
      const footer=page.children[0];
      assert.equal(footer.textContent,J_WOO_COPYRIGHT);
      assert.equal(footer.attributes['text-anchor'],'middle');
      assert.equal(footer.attributes['data-jwoo-software-copyright'],'true');
      assert.ok(Number(footer.attributes.y)>1000);
    }
  }
});
test('re-render does not duplicate notice',()=>{
  const page=fakePage();stampSoftwareCopyright([page]);
  stampSoftwareCopyright([page]);assert.equal(page.children.length,1);
});
test('fails safely when SVG dimensions are missing or format is unsupported',()=>{
  const p=fakePage();p.getAttribute=()=>null;
  assert.throws(()=>stampSoftwareCopyright([p]),/치수/);
  assert.throws(()=>stampSoftwareCopyright([fakePage()],'US_LETTER'),/A4/);
});
