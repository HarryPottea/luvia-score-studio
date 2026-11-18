// Strict bridge between OSMD graphical SVG notes and editable MusicXML positions.
// Whenever graphical/source-note counts or voice structure disagree, skip binding.
// The bridge never guesses coordinates for polyphonic, multi-staff or chord measures.
import { inspectScore } from './editor-core.js';
const STEPS='CDEFGAB';
export function shiftDiatonicPitch({step,alter=0,octave},diatonicSteps){
  if(!STEPS.includes(step)||step.length!==1||!Number.isInteger(diatonicSteps)||Math.abs(diatonicSteps)>8||!Number.isInteger(octave))throw new Error('음정 이동 단계가 올바르지 않습니다.');
  const absolute=octave*7+STEPS.indexOf(step)+diatonicSteps;
  const nextOctave=Math.floor(absolute/7),nextStep=STEPS[((absolute%7)+7)%7];
  if(nextOctave<1||nextOctave>8)throw new Error('지원하는 옥타브 범위를 벗어났습니다.');
  return {step:nextStep,alter,octave:nextOctave};
}
export function graphicalTargets(osmd,doc,visibleParts){
  if(!osmd?.GraphicSheet||!doc||!Array.isArray(visibleParts)||visibleParts.length!==1)return [];
  const partId=visibleParts[0];
  const part=inspectScore(doc).parts.find(p=>p.id===partId);
  if(!part)return [];
  const matrices=osmd.GraphicSheet.MeasureList;
  if(!Array.isArray(matrices)||matrices.length<part.measures.length)return [];
  const targets=[];
  for(const measure of part.measures){
    if(measure.reason || !measure.events.length||measure.events.some(e=>e.complex||e.rest||!e.editable))continue;
    const row=matrices[measure.index];
    if(!Array.isArray(row)||row.length!==1||!row[0])continue;
    const entries=row[0].staffEntries;
    if(!Array.isArray(entries))continue;
    const graphical=[];
    for(const entry of entries){
      const voices=entry?.graphicalVoiceEntries;
      if(!Array.isArray(voices)||voices.length!==1)continue;
      const notes=voices[0]?.notes;
      if(!Array.isArray(notes))continue;
      graphical.push(...notes);
    }
    if(graphical.length!==measure.events.length)continue;
    const elements=new Set(),matches=[];
    let valid=true;
    for(let i=0;i<graphical.length;i++){
      const gn=graphical[i];
      if(!gn?.sourceNote||typeof gn.sourceNote.isRest!=='function'||gn.sourceNote.isRest()) {valid=false;break;}
      const heads=typeof gn.getNoteheadSVGs==='function'?gn.getNoteheadSVGs():[];
      const head=Array.isArray(heads)&&heads.length===1?heads[0]:(typeof gn.getSVGGElement==='function'?gn.getSVGGElement():null);
      if(!head||typeof head.addEventListener!=='function'||elements.has(head)){valid=false;break;}
      elements.add(head);
      matches.push({partId,measureIndex:measure.index,eventIndex:i,element:head});
    }
    if(valid)targets.push(...matches);
  }
  return targets;
}
// Attach user interactions only to a verified, uniquely mapped graphical note.
export function bindGraphicalEditor({osmd,doc,visibleParts,select,movePitch,announce}) {
  const targets=graphicalTargets(osmd,doc,visibleParts),bindings=[];
  function highlight(selection){
    for(const item of targets){
      item.element.classList?.toggle('jwoo-note-selected',!!selection&&item.partId===selection.partId&&item.measureIndex===selection.measureIndex&&item.eventIndex===selection.eventIndex);
    }
  }
  for(const item of targets){
    const {element}=item;
    element.classList?.add('jwoo-note-target');
    element.setAttribute?.('tabindex','0');
    element.setAttribute?.('role','button');
    element.setAttribute?.('aria-label','악보 '+(item.measureIndex+1)+'마디 '+(item.eventIndex+1)+'번째 음표 선택');
    const pos={partId:item.partId,measureIndex:item.measureIndex,eventIndex:item.eventIndex};
    let start=null;
    function down(e){
      if(e.button!==0)return;
      start={x:e.clientX,y:e.clientY,id:e.pointerId,height:element.getBoundingClientRect?.().height||12};
      select(pos);
      e.preventDefault();
    }
    function up(e){
      if(!start||e.pointerId!==start.id)return;
      const drag=start.y-e.clientY;
      const px=Math.max(7,Math.min(18,start.height*0.6));
      start=null;
      const steps=Math.max(-8,Math.min(8,Math.round(drag/px)));
      if(steps!==0)movePitch(pos,steps);
    }
    function key(e){
      if(e.key==='Enter'||e.key===' '){e.preventDefault();select(pos);}
      if(e.key==='ArrowUp'||e.key==='ArrowDown') {e.preventDefault();select(pos);movePitch(pos,e.key==='ArrowUp'?1:-1);}
    }
    element.addEventListener('pointerdown',down);
    element.addEventListener('keydown',key);
    const release=e=>up(e);
    document.addEventListener('pointerup',release);
    bindings.push(()=>{element.removeEventListener('pointerdown',down);element.removeEventListener('keydown',key);document.removeEventListener('pointerup',release);});
  }
  announce?.(targets.length);
  return {count:targets.length,highlight,dispose(){for(const unbind of bindings)unbind();}};
}
