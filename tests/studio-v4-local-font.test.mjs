import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLocalTrueType,readLocalTrueType,prepareFontSvg,
  registerPdfTrueType,assertEmbeddedFontInPdf} from '../src/studio-v4-local-font.js';

// Generated original synthetic glyph fixture, not a distributed third-party font.
const tinyTTF='AAEAAAAKAIAAAwAgT1MvMkT9GlAAAAEoAAAAYGNtYXD9NYcYAAABlAAAAExnbHlmSbfnvgAAAewAAABOaGVhZGFiQ/YAAACsAAAANmhoZWEFSAH2AAAA5AAAACRobXR4ArwAlgAAAYgAAAAMbG9jYQAaADQAAAHgAAAADG1heHAABwAGAAABCAAAACBuYW1l0XA3DgAAAjwAAAE4cG9zdHTbyAoAAAN0AAAANQABAAAAAQAALhz75l8PPPUAAQPoAAAAAAAAAAAAAAAAAAAAAABGAEYCCALQAAAAAwACAAAAAAAAAAEAAAMg/zgAAAJYADIAZAH0AAEAAAAAAAAAAAAAAAAAAAABAAEAAAAFAAQAAQAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAwJYAZAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAQAAAAAAAAAAAAAAPz8/PwAAACDVXAMg/zgAAAMgAMgAAAAAAAAAAAAAAAAAAAAgAAACWAAyADIAMgAyADIAAAACAAAAAwAAABQAAwABAAAAFAAEADgAAAAKAAgAAgACACAAQa4A1Vz//wAAACAAQa4A1Vz////h/8FSBCqnAAEAAAAAAAAAAAAAAAAAAAAAAA0AGgAnAAEARgBGAggC0AADAAA3ESERRgHCRgKK/XYAAQBGAEYCCALQAAMAADcRIRFGAcJGAor9dgABAEYARgIIAtAAAwAANxEhEUYBwkYCiv12AAAAAAAKAH4AAQAAAAAAAQANAAAAAQAAAAAAAgAHAA0AAQAAAAAAAwANAAAAAQAAAAAABAAVABQAAQAAAAAABgAVACkAAwABBAkAAQAaAD4AAwABBAkAAgAOAFgAAwABBAkAAwAaAD4AAwABBAkABAAqAGYAAwABBAkABgAqAJBKV09PU3ludGhldGljUmVndWxhckpXT09TeW50aGV0aWMgUmVndWxhckpXT09TeW50aGV0aWMtUmVndWxhcgBKAFcATwBPAFMAeQBuAHQAaABlAHQAaQBjAFIAZQBnAHUAbABhAHIASgBXAE8ATwBTAHkAbgB0AGgAZQB0AGkAYwAgAFIAZQBnAHUAbABhAHIASgBXAE8ATwBTAHkAbgB0AGgAZQB0AGkAYwAtAFIAZQBnAHUAbABhAHIAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAAAAwAkAQIBAwNoYW4EZ2V1bAAAAA==';
const bytes=()=>new Uint8Array(Buffer.from(tinyTTF,'base64'));
const fontObject=()=>({bytes:bytes(),name:'synthetic.ttf',family:'JWOOLocalVectorFont'});
test('validate required Korean codepoints in original synthetic TTF',()=>{
  const report=validateLocalTrueType(bytes(),'한글 A');
  assert.equal(report.validated,true);
  assert.equal(report.characters,4);
  assert.ok(report.glyphCount>=5);
  assert.equal(report.embeddingRestricted,false);
  assert.equal(report.fontQualityCertified,false);
});
test('reject TTF when a required Korean syllable is absent',()=>{
  assert.throws(()=>validateLocalTrueType(bytes(),'반짝'),/필요한 글자/);
  assert.throws(()=>validateLocalTrueType(bytes(),'한글 반짝'),/반짝/);
});
test('reject corrupt headers, faked extra bytes and restricted embedding flags',()=>{
  const bad=bytes();bad[0]=0x4f;
  assert.throws(()=>validateLocalTrueType(bad,'한'),/TrueType/);
  const restricted=bytes();const view=new DataView(restricted.buffer);
  const count=view.getUint16(4,false);
  for(let i=0;i<count;i++){
    const off=12+i*16,tag=String.fromCharCode(...restricted.slice(off,off+4));
    if(tag==='OS/2'){
      const start=view.getUint32(off+8,false);
      view.setUint16(start+8,0x0002,false);break;
    }
  }
  assert.throws(()=>validateLocalTrueType(restricted,'한'),/사용권/);
});
test('read explicitly selected local font without network or storage',async()=>{
  const data=bytes();
  const file={name:'a.ttf',size:data.length,arrayBuffer:async()=>data.slice().buffer};
  const loaded=await readLocalTrueType(file);
  assert.equal(loaded.bytes.byteLength,data.length);
  assert.equal(loaded.family,'JWOOLocalVectorFont');
  await assert.rejects(readLocalTrueType({...file,name:'a.woff'}),/ttf/);
});
test('rewrite only Unicode SVG text to embedded custom family',()=>{
  const createNode=(localName,text='')=>({localName,textContent:text,attrs:{},style:{setProperty(){}},
    setAttribute(k,v){this.attrs[k]=v;},querySelectorAll(){return [];}});
  const ascii=createNode('text','Verse'),korean=createNode('text','한글');
  const svg={localName:'svg',querySelectorAll(){return [ascii,korean];}};
  const report=prepareFontSvg(svg,fontObject());
  assert.equal(report.nodes,1);
  assert.equal(korean.attrs['font-family'],'JWOOLocalVectorFont');
  assert.equal(ascii.attrs['font-family'],undefined);
});
test('register TrueType in jsPDF VFS and require actual font embedding objects',()=>{
  const calls=[];
  const pdf={addFileToVFS(...args){calls.push(args);},
    addFont(...args){calls.push(args);}};
  assert.equal(registerPdfTrueType(pdf,fontObject()).embedded,true);
  assert.equal(calls[0][0],'jwoo-local-vector.ttf');
  assert.ok(calls[0][1].length>500);
  assert.deepEqual(calls[1],['jwoo-local-vector.ttf','JWOOLocalVectorFont','normal']);
  const pdfBytes=new TextEncoder().encode('%PDF-1.4\n/FontFile2 /ToUnicode'+
    ' '.repeat(700)+'\n%%EOF');
  assert.equal(assertEmbeddedFontInPdf(pdfBytes).toUnicodePresent,true);
  assert.throws(()=>assertEmbeddedFontInPdf(new TextEncoder().encode(
    '%PDF-1.4\n'+ ' '.repeat(700)+'\n%%EOF')),/내장되지/);
});
