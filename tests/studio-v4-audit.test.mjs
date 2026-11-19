import test from 'node:test';
import assert from 'node:assert/strict';
import {auditMusicXml,summarizeMusicXmlAudit} from '../src/studio-v4-audit.js';

function e(localName,children=[],attributes={},raw=''){
  const element={
    localName,children,attributes:[],raw,
    getAttribute:key=>Object.hasOwn(attributes,key)?String(attributes[key]):null,
  };
  Object.defineProperty(element,'textContent',{get(){
    return element.children.length?element.children.map(n=>n.textContent).join(''):String(element.raw);
  }});
  return element;
}
const t=(name,value)=>e(name,[],{},String(value));
const E=e;
const measure=(number,content,extra={})=>E('measure',content,{number:String(number),...extra});
const part=(id,measures)=>E('part',measures,{id});
const doc=(parts,definitions=true)=>({documentElement:E('score-partwise',[
  ...(definitions?[E('part-list',parts.map(p=>E('score-part',[t('part-name',p.getAttribute('id'))],{id:p.getAttribute('id')})))]:[]),
  ...parts,
])});
const attrs=(divisions=48,beats=4,beatType=4)=>E('attributes',[
  t('divisions',divisions),E('time',[t('beats',beats),t('beat-type',beatType)])
]);
const pitch=(step='C',octave=4)=>E('pitch',[t('step',step),t('octave',octave)]);
const note=(duration=48,{step='C',octave=4,voice='1',staff='1',chord=false,tuplet=false,ties=[],slurs=[]}={})=>{
  const items=[...(chord?[E('chord')]:[]),pitch(step,octave),t('duration',duration),
    t('voice',voice),t('type',tuplet?'eighth':duration===192?'whole':duration===96?'half':duration===24?'eighth':'quarter'),t('staff',staff)];
  if(tuplet)items.push(E('time-modification',[
    t('actual-notes',3),t('normal-notes',2),t('normal-type','eighth')]));
  for(const type of ties)items.push(E('tie',[],{type}));
  if(slurs.length)items.push(E('notations',slurs.map(type=>E('slur',[],{number:'1',type}))));
  return E('note',items);
};
const rest=(duration,type='quarter',voice='1',staff='1')=>E('note',[
  E('rest'),t('duration',duration),t('voice',voice),t('type',type),t('staff',staff)
]);
const backup=duration=>E('backup',[t('duration',duration)]);
const wedge=(type,number='1')=>E('direction',[
  E('direction-type',[E('wedge',[],{type,number})])
]);
const issues=(report,code)=>report.issues.filter(i=>i.code===code);
test('clean grand-staff two-voice score passes and preserves raw input untouched',()=>{
  const top=[note(96,{voice:'1',staff:'1'}),note(96,{voice:'1',staff:'1'})];
  const bottom=[note(96,{voice:'2',staff:'2'}),rest(96,'half','2','2')];
  const source=doc([part('P1',[measure(1,[attrs(),...top,backup(192),...bottom])])]);
  const before=JSON.stringify(source);
  const r=auditMusicXml(source);
  assert.equal(r.status,'CLEAN');
  assert.deepEqual([r.errors,r.warnings,r.stats.parts,r.stats.notes],[0,0,1,4]);
  assert.equal(r.stats.measures,1);
  assert.equal(JSON.stringify(source),before);
  assert.match(summarizeMusicXmlAudit(r),/기본 음악 구조 검사 통과/);
});
test('exact 3:2 eighth note triplets and matched expression endpoints are clean',()=>{
  const bar=measure(1,[
    attrs(),
    wedge('crescendo'),
    note(16,{tuplet:true,slurs:['start']}),
    note(16,{step:'D',tuplet:true}),
    note(16,{step:'E',tuplet:true,slurs:['stop']}),
    wedge('stop'),
    rest(96,'half'),rest(48,'quarter'),
  ]);
  const report=auditMusicXml(doc([part('P1',[bar])]));
  assert.equal(report.status,'CLEAN',JSON.stringify(report.issues));
  assert.equal(report.stats.tuplets,3);
});
test('overfull measure, negative backup and invalid chord remain blocking defects',()=>{
  const source=doc([part('P1',[measure(1,[
    attrs(),note(192),note(48,{chord:true}),note(48),backup(400),
  ])])]);
  const r=auditMusicXml(source);
  assert.equal(r.status,'BLOCKED');
  assert.ok(issues(r,'INVALID_CHORD').length);
  assert.ok(issues(r,'NEGATIVE_TIME').length);
  assert.ok(issues(r,'MEASURE_OVERFULL').length);
});
test('incomplete bars remain REVIEW and pickup implicit bars do not trigger underfull warning',()=>{
  const half=[attrs(),rest(96,'half')];
  const regular=auditMusicXml(doc([part('P1',[measure(1,half)])]));
  assert.equal(regular.status,'REVIEW');
  assert.equal(issues(regular,'MEASURE_UNDERFULL').length,1);
  const pickup=auditMusicXml(doc([part('P1',[measure(1,half,{implicit:'yes'})])]));
  assert.equal(issues(pickup,'MEASURE_UNDERFULL').length,0);
  assert.equal(pickup.status,'CLEAN');
});
test('broken tuplets, unmatched slurs and open ties are surfaced rather than silently ignored',()=>{
  const source=doc([part('P1',[measure(1,[
    attrs(),note(24,{tuplet:true,slurs:['start'],ties:['start']}),
    rest(168,'half'),
  ])])]);
  const r=auditMusicXml(source);
  assert.equal(r.status,'BLOCKED');
  assert.equal(issues(r,'TUPLET_DURATION').length,1);
  assert.equal(issues(r,'SLUR_OPEN').length,1);
  assert.equal(issues(r,'TIE_OPEN').length,1);
});
test('two chord tones share the same onset and do not duplicate measure length',()=>{
  const source=doc([part('P1',[measure(1,[
    attrs(),
    note(48),
    note(48,{step:'E',chord:true}),
    rest(96,'half'),rest(48),
  ])])]);
  const r=auditMusicXml(source);
  assert.equal(r.status,'CLEAN',JSON.stringify(r.issues));
  assert.equal(r.stats.chords,1);
});
test('invalid score root and bad guard configuration do not claim a clean pass',()=>{
  assert.equal(auditMusicXml(null).status,'BLOCKED');
  const source=doc([part('P1',[measure(1,[attrs(),rest(192,'whole')])])]);
  assert.throws(()=>auditMusicXml(source,{maxIssues:900}));
  assert.equal(auditMusicXml(source).status,'CLEAN');
});
