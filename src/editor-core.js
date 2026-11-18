// J-WOO 3.0 score model and guarded MusicXML operations.
// The original document is immutable: every operation returns a fresh cloned DOM.
// Unsupported notation is inspected but never rewritten by these operations.
const DIRECT = (node, tag) => node ? [...node.children].find(el => el.localName === tag) ?? null : null;
const MANY = (node, tag) => node ? [...node.children].filter(el => el.localName === tag) : [];
const TEXT = (node, tag) => DIRECT(node, tag)?.textContent?.trim() ?? '';
const INT = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
export const EDIT_TYPES = ['whole', 'half', 'quarter', 'eighth', '16th', '32nd'];
const FACTORS = { whole: 4, half: 2, quarter: 1, eighth: .5, '16th': .25, '32nd': .125 };
const PITCH_STEPS = 'CDEFGAB';
const BLOCKED_NOTES = new Set(['chord', 'grace', 'cue', 'time-modification', 'staff', 'notations', 'tie']);
function make(parent, name, value = null) {
  const doc = parent.ownerDocument;
  const element = doc.createElementNS ? doc.createElementNS(parent.namespaceURI ?? null, name) : doc.createElement(name);
  if (value !== null) element.textContent = String(value);
  return element;
}
function getPart(doc, partId) {
  if (doc?.documentElement?.localName !== 'score-partwise') throw new Error('MusicXML partwise 악보만 편집할 수 있습니다.');
  const part = MANY(doc.documentElement, 'part').find(el => el.getAttribute('id') === partId);
  if (!part) throw new Error('선택한 악기 파트를 찾지 못했습니다.');
  return part;
}
function locate(doc, partId, measureIndex) {
  if (!Number.isSafeInteger(measureIndex) || measureIndex < 0) throw new Error('마디 번호가 올바르지 않습니다.');
  const part = getPart(doc, partId);
  const measure = MANY(part, 'measure')[measureIndex];
  if (!measure) throw new Error('선택한 마디를 찾지 못했습니다.');
  return { part, measure };
}
function durationFor(type, divisions) {
  if (!EDIT_TYPES.includes(type)) throw new Error('지원하지 않는 음표 길이입니다.');
  const value = divisions * FACTORS[type];
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('이 악보의 divisions로는 선택한 음표 길이를 정확하게 표현할 수 없습니다.');
  return value;
}
function decomposeDuration(value, divisions) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('잘못된 쉼표 길이입니다.');
  let remainder = value;
  const result = [];
  for (const type of EDIT_TYPES) {
    const unit = divisions * FACTORS[type];
    if (!Number.isSafeInteger(unit) || unit <= 0) continue;
    while (remainder >= unit) {
      result.push({ type, duration: unit });
      remainder -= unit;
      if (result.length > 32) throw new Error('쉼표 분할 수가 너무 많습니다.');
    }
  }
  if (remainder !== 0) throw new Error('쉼표로 정확히 분해할 수 없는 길이입니다.');
  return result;
}
function plainRest(note) {
  return !!DIRECT(note, 'rest') && !DIRECT(note,'pitch') && !DIRECT(note,'lyric')
    && ![...note.children].some(el => ['notations','tie','beam','time-modification','staff','dot','chord','grace','cue'].includes(el.localName))
    && !DIRECT(note,'voice') || false;
}
// Individual rest eligibility is stricter than general note interpretation.
function consumableRest(note) {
  if (!note || !DIRECT(note,'rest') || DIRECT(note,'pitch')) return false;
  if (DIRECT(note,'voice') && TEXT(note,'voice') !== '1') return false;
  if (DIRECT(note,'rest').attributes?.length) return false;
  return [...note.children].every(el => ['rest','duration','type','voice'].includes(el.localName))
    && !note.attributes?.length && INT(TEXT(note,'duration')) !== null && EDIT_TYPES.includes(TEXT(note,'type'));
}
function noteProtected(note, action) {
  const forbidden = action === 'lyric' ? ['chord','grace','cue','time-modification','staff'] : [...BLOCKED_NOTES,'beam'];
  return [...note.children].some(el => forbidden.includes(el.localName));
}
function eligibleMeasure(measure, divisions, beats, beatType) {
  if (!divisions || ![2,3,4,6].includes(beats) || ![4,8].includes(beatType)) return '박자/분할 정보가 지원되지 않습니다.';
  if (measure.getAttribute('implicit') === 'yes') return '못갖춘마디는 직접 수정하지 않습니다.';
  const children = [...measure.children];
  if (MANY(measure,'attributes').length > 1 || children.some(el => ['backup','forward'].includes(el.localName))) return '여러 성부나 박자 변경이 포함된 마디입니다.';
  if (children.some((el,index) => el.localName === 'attributes' && children.slice(0,index).some(prior => prior.localName === 'note'))) return '마디 안에서 분할/박자가 변경됩니다.';
  let total = 0;
  for (const note of MANY(measure,'note')) {
    if (DIRECT(note,'chord') || DIRECT(note,'grace') || DIRECT(note,'cue') || DIRECT(note,'time-modification') || DIRECT(note,'staff')) return '화음·장식음·셋잇단음·여러 보표는 보호됩니다.';
    if (DIRECT(note,'voice') && TEXT(note,'voice') !== '1') return '여러 성부는 보호됩니다.';
    const duration = INT(TEXT(note,'duration'));
    if (!duration) return '음표 길이를 해석할 수 없습니다.';
    total += duration;
  }
  const max = divisions * beats * 4 / beatType;
  if (!Number.isSafeInteger(max) || total !== max) return '마디 길이가 정확히 채워지지 않아 편집을 차단합니다.';
  return null;
}
function gatherMeasure(part, index, inherited) {
  const measure = MANY(part,'measure')[index], state = { ...inherited };
  if (!measure) return null;
  for (const attrs of MANY(measure,'attributes')) {
    const divisions = TEXT(attrs,'divisions');
    if (divisions) state.divisions = INT(divisions);
    const time = DIRECT(attrs,'time');
    if (time) { state.beats = INT(TEXT(time,'beats')); state.beatType = INT(TEXT(time,'beat-type')); }
  }
  return { measure, state };
}
export function inspectScore(doc) {
  if (doc?.documentElement?.localName !== 'score-partwise') throw new Error('MusicXML partwise 형식이 아닙니다.');
  const parts=[];
  const definitions = new Map(MANY(DIRECT(doc.documentElement,'part-list'),'score-part').map(x=>[x.getAttribute('id'),TEXT(x,'part-name')]));
  for (const part of MANY(doc.documentElement,'part')) {
    const id = part.getAttribute('id');
    const measures=[];
    let inherited = {divisions:null,beats:null,beatType:null};
    const totalMeasures=MANY(part,'measure');
    for (let index=0;index<totalMeasures.length;index++) {
      const current=gatherMeasure(part,index,inherited);
      inherited=current.state;
      const {measure,state}=current;
      const reason=eligibleMeasure(measure,state.divisions,state.beats,state.beatType);
      let offset=0;
      const events=MANY(measure,'note').map((note,eventIndex)=>{
        const rest=!!DIRECT(note,'rest'), pitch=DIRECT(note,'pitch');
        const duration=INT(TEXT(note,'duration'))||0;
        const event={
          eventIndex, start:offset, duration, type:TEXT(note,'type'), rest, editable:!reason&&!noteProtected(note,'note'),
          step:TEXT(pitch,'step'), octave:INT(TEXT(pitch,'octave')),
          alter:TEXT(pitch,'alter') === '' ? 0 : Number(TEXT(pitch,'alter')),
          lyric:TEXT(DIRECT(note,'lyric'),'text'),
          tied:!!DIRECT(note,'tie'), complex:noteProtected(note,'note'),
        };
        offset+=duration;
        return event;
      });
      measures.push({
        index, number:measure.getAttribute('number')||String(index+1), divisions:state.divisions, beats:state.beats, beatType:state.beatType,
        reason, events, total:offset,
      });
    }
    parts.push({id,name:definitions.get(id)||id||'미지정 파트',measures});
  }
  return {parts};
}
function getEditable(doc,{partId,measureIndex,eventIndex},action) {
  const {measure}=locate(doc,partId,measureIndex);
  const view=inspectScore(doc).parts.find(p=>p.id===partId)?.measures[measureIndex];
  if (!view || view.reason) throw new Error(view?.reason||'편집할 수 없는 마디입니다.');
  if (!Number.isSafeInteger(eventIndex)||eventIndex<0) throw new Error('음표 위치가 올바르지 않습니다.');
  const note=MANY(measure,'note')[eventIndex];
  if (!note) throw new Error('음표 위치가 변경되었습니다.');
  if (noteProtected(note,action)) throw new Error('이음줄·빔·다성부·셋잇단음 등 보호 표기가 포함되어 변경하지 않습니다.');
  return {measure,note,view,event:view.events[eventIndex]};
}
function swapPitch(note,step,alter,octave) {
  if (!PITCH_STEPS.includes(step) || step.length!==1 || !Number.isSafeInteger(alter)||alter<-2||alter>2||!Number.isSafeInteger(octave)||octave<1||octave>8) throw new Error('음정 입력값이 올바르지 않습니다.');
  const old= DIRECT(note,'pitch');
  const pitch=make(note,'pitch');
  pitch.append(make(pitch,'step',step));
  if (alter!==0) pitch.append(make(pitch,'alter',alter));
  pitch.append(make(pitch,'octave',octave));
  if (old) note.replaceChild(pitch,old);
  else {
    const rest=DIRECT(note,'rest');
    if (!rest) throw new Error('음표의 피치 위치를 찾을 수 없습니다.');
    note.replaceChild(pitch,rest);
  }
  for(const tag of ['accidental','stem','notehead']) for(const element of MANY(note,tag)) note.removeChild(element);
  for(const attr of ['default-x','default-y','relative-x','relative-y']) note.removeAttribute(attr);
}
function restize(note) {
  const pitch=DIRECT(note,'pitch');
  if (!pitch) throw new Error('쉼표로 바꿀 음표가 아닙니다.');
  if (MANY(note,'lyric').length) throw new Error('가사가 있는 음표는 자동 삭제하지 않습니다. 먼저 가사를 지워주세요.');
  note.replaceChild(make(note,'rest'),pitch);
  for(const tag of ['accidental','stem','notehead','beam']) for(const el of MANY(note,tag)) note.removeChild(el);
  for(const attr of ['default-x','default-y','relative-x','relative-y']) note.removeAttribute(attr);
}
function createRest(measure, duration, type) {
  const note=make(measure,'note');
  note.append(make(note,'rest'),make(note,'duration',duration));
  note.append(make(note,'type',type));
  return note;
}
function shorten(measure,note,newDuration,divisions,newType) {
  const before=INT(TEXT(note,'duration'));
  const delta=before-newDuration;
  const rests=decomposeDuration(delta,divisions);
  DIRECT(note,'duration').textContent=String(newDuration);
  DIRECT(note,'type').textContent=newType;
  let cursor=note;
  for(const r of rests) {
    const rest=createRest(measure,r.duration,r.type);
    measure.insertBefore(rest,cursor.nextSibling);
    cursor=rest;
  }
}
function lengthen(measure,note,targetDuration,divisions,newType) {
  let shortage=targetDuration-INT(TEXT(note,'duration'));
  const consumed=[];
  let cursor=note.nextSibling;
  while(shortage>0 && cursor) {
    if (cursor.localName!=='note'||!consumableRest(cursor)) break;
    const dur=INT(TEXT(cursor,'duration'));
    const take=Math.min(shortage,dur);
    consumed.push({node:cursor,take,left:dur-take});
    shortage-=take; cursor=cursor.nextSibling;
  }
  if(shortage>0) throw new Error('뒤따르는 일반 쉼표의 길이가 부족하여 음표를 늘릴 수 없습니다.');
  // All validation must succeed before editing the cloned document.
  const replacements=consumed.map(c=>({node:c.node,rest:decomposeDuration(c.left,divisions)}));
  DIRECT(note,'duration').textContent=String(targetDuration);
  DIRECT(note,'type').textContent=newType;
  for(const item of replacements) {
    for(const r of item.rest) measure.insertBefore(createRest(measure,r.duration,r.type),item.node);
    measure.removeChild(item.node);
  }
}
function editLyric(note,text) {
  if (DIRECT(note,'rest')) throw new Error('쉼표에는 가사를 입력할 수 없습니다.');
  if (typeof text!=='string'||[...text].length>80) throw new Error('가사는 80자 이하로 입력해 주세요.');
  const lyrics=MANY(note,'lyric');
  if(lyrics.length>1) throw new Error('여러 절의 가사는 보호됩니다. 전문 편집기에서 수정해 주세요.');
  const value=text.trim();
  if(!value) {for(const l of lyrics) note.removeChild(l);return;}
  let lyric=lyrics[0];
  if(lyric && [...lyric.children].some(c=>!['syllabic','text'].includes(c.localName))) throw new Error('멜리스마·복잡한 가사 형식은 보호됩니다.');
  if(!lyric){lyric=make(note,'lyric');lyric.setAttribute('number','1');note.appendChild(lyric);}
  const textEl=DIRECT(lyric,'text');
  if (textEl) textEl.textContent=value;
  else lyric.appendChild(make(lyric,'text',value));
  if(!DIRECT(lyric,'syllabic')) lyric.insertBefore(make(lyric,'syllabic','single'),lyric.firstChild);
}
export function editScoreEvent(source, operation) {
  if(!source || !operation || typeof operation!=='object') throw new Error('악보 편집 요청이 올바르지 않습니다.');
  const action=operation.action;
  if(!['pitch','duration','to-rest','from-rest','lyric'].includes(action)) throw new Error('지원하지 않는 편집 명령입니다.');
  const doc=source.cloneNode(true);
  const {measure,note,view,event}=getEditable(doc,operation,action==='lyric'?'lyric':'note');
  if(action==='pitch') {
    if(event.rest) throw new Error('쉼표의 음정을 수정할 수 없습니다.');
    swapPitch(note,operation.step,operation.alter,operation.octave);
  } else if(action==='to-rest') {
    if(event.rest) throw new Error('이미 쉼표입니다.');
    restize(note);
  } else if(action==='from-rest') {
    if(!event.rest || !consumableRest(note)) throw new Error('일반 쉼표만 음표로 바꿀 수 있습니다.');
    swapPitch(note,operation.step,operation.alter,operation.octave);
  } else if(action==='lyric') {
    editLyric(note,operation.text);
  } else if(action==='duration') {
    if(event.rest || MANY(note,'dot').length || MANY(note,'beam').length) throw new Error('단순 무부점 음표만 길이를 편집할 수 있습니다.');
    const target=durationFor(operation.type,view.divisions);
    if(target<event.duration) shorten(measure,note,target,view.divisions,operation.type);
    else if(target>event.duration) lengthen(measure,note,target,view.divisions,operation.type);
    else DIRECT(note,'type').textContent=operation.type;
  }
  const after=inspectScore(doc).parts.find(p=>p.id===operation.partId)?.measures[operation.measureIndex];
  if (!after || after.reason || after.total!==view.total) throw new Error('변경 후 박자 유효성 확인에 실패했습니다. 원본을 유지합니다.');
  return {doc, change:{action,partId:operation.partId,measureIndex:operation.measureIndex,eventIndex:operation.eventIndex}};
}
