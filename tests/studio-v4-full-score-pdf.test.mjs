import test from 'node:test';
import assert from 'node:assert/strict';
import {FULL_SCORE_EXPORT_ID,prepareScoreAndPartExport}
  from '../src/studio-v4-pdf-export-plan.js';
import {preflightVectorPartPages} from '../src/studio-v4-vector-pdf.js';

const svg=(labels=[])=>({
  localName:'svg',attributes:[],querySelector:()=>null,
  querySelectorAll(selector){return selector==='text,tspan'?
    labels.map(textContent=>({textContent})):[];}
});
const score=(names=['P1','P2'])=>({
  documentElement:{localName:'score-partwise',children:names.map(id=>({
    localName:'part',getAttribute(name){return name==='id'?id:null;}
  }))}
});
const page=(partId,partName,labels=[])=>({partId,partName,svg:svg(labels)});
test('stage5: complete full score followed by each source part in stable order',()=>{
  const parts=[{id:'P1',name:'Voice'},{id:'P2',name:'Piano'}];
  const result=prepareScoreAndPartExport(score(),parts);
  assert.deepEqual(result,[
    {id:FULL_SCORE_EXPORT_ID,name:'Full Score',fullScore:true},
    {id:'P1',name:'Voice'},{id:'P2',name:'Piano'}
  ]);
  assert.deepEqual(parts,[{id:'P1',name:'Voice'},{id:'P2',name:'Piano'}],
    'caller-owned data must not be mutated');
});
test('stage5: reject missing, duplicated or reordered parts and reserved score ID',()=>{
  assert.throws(()=>prepareScoreAndPartExport(score(),[]),/1~12개/);
  assert.throws(()=>prepareScoreAndPartExport(score(),[
    {id:'P2',name:'Piano'},{id:'P1',name:'Voice'}]),/순서/);
  assert.throws(()=>prepareScoreAndPartExport(score(['P1','P1']),[
    {id:'P1',name:'Voice'},{id:'P1',name:'Voice'}]),/중복|순서/);
  assert.throws(()=>prepareScoreAndPartExport(score([FULL_SCORE_EXPORT_ID]),
    [{id:FULL_SCORE_EXPORT_ID,name:'Fake'}]),/중복|순서/);
});
test('stage5: A4 score+part preflight keeps full score distinct from playable parts',()=>{
  const pages=[
    page(FULL_SCORE_EXPORT_ID,'Full Score',['Allegro']),
    page(FULL_SCORE_EXPORT_ID,'Full Score',['Rehearsal']),
    page('P1','Voice',['Verse']),page('P1','Voice',['Chorus']),
    page('P2','Piano',['Piano solo'])
  ];
  const report=preflightVectorPartPages(pages,'A4_P',{requireFullScore:true});
  assert.deepEqual(report.order,[FULL_SCORE_EXPORT_ID,'P1','P2']);
  assert.equal(report.pages,5);
  assert.equal(report.parts,2);
  assert.equal(report.fullScorePages,2);
  assert.equal(report.fullScoreIncluded,true);
  assert.equal(report.groups.get(FULL_SCORE_EXPORT_ID).pages.length,2);
  assert.equal(report.groups.get('P1').pages.length,2);
  assert.equal(report.allowUnicodeText,false);
});
test('stage5: malformed score or out-of-order full-score pages cannot be exported',()=>{
  const full=page(FULL_SCORE_EXPORT_ID,'Full Score');
  const one=page('P1','Voice');
  assert.throws(()=>preflightVectorPartPages([one],'A4_P',{requireFullScore:true}),/전체 악보/);
  assert.throws(()=>preflightVectorPartPages([one,full],'A4_P',{requireFullScore:true}),
    /가장 먼저/);
  assert.throws(()=>preflightVectorPartPages([full,one,full],'A4_P',
    {requireFullScore:true}),/가장 먼저/);
  assert.throws(()=>preflightVectorPartPages([full,one],'A4_P'),/전체 악보/);
  assert.throws(()=>preflightVectorPartPages([full],'A4_P',
    {requireFullScore:true}),/개별 파트/);
  assert.throws(()=>preflightVectorPartPages([full,one],'LETTER',
    {requireFullScore:true}),/A4/);
  assert.throws(()=>preflightVectorPartPages([full,one],'A4_P',
    {requireFullScore:'yes'}),/설정/);
});
test('stage5: support 12 parts + full score but block a thirteenth instrument',()=>{
  const names=Array.from({length:12},(_,i)=>'P'+(i+1));
  const parts=names.map(id=>({id,name:id}));
  assert.equal(prepareScoreAndPartExport(score(names),parts).length,13);
  const all=[page(FULL_SCORE_EXPORT_ID,'Full Score'),...parts.map(p=>page(p.id,p.name))];
  assert.equal(preflightVectorPartPages(all,'A4_L',{requireFullScore:true}).parts,12);
  assert.throws(()=>preflightVectorPartPages([...all,page('P13','Extra')],
    'A4_L',{requireFullScore:true}),/최대 12개|12개 파트/);
});
test('stage5: missing Hangul glyph embedding fails closed for both score and parts',()=>{
  const pages=[
    page(FULL_SCORE_EXPORT_ID,'Full Score',['우리 노래']),
    page('P1','Voice',['우리 노래'])
  ];
  assert.throws(()=>preflightVectorPartPages(pages,'A4_P',
    {requireFullScore:true}),/한글·특수문자/);
  const embedded=preflightVectorPartPages(pages,'A4_P',
    {requireFullScore:true,allowUnicodeText:true});
  assert.equal(embedded.fullScoreIncluded,true);
});
