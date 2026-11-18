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
    const sourceFirst=graphical[0]?.sourceNote;
    const firstTimestamp=sourceFirst?.getAbsoluteTimestamp?.()?.RealValue;
    if(!Number.isFinite(firstTimestamp))continue;
    const elements=new Set(),matches=[];
    let valid=true;
    for(let i=0;i<graphical.length;i++){
      const gn=graphical[i];
      if(!gn?.sourceNote||typeof gn.sourceNote.isRest!=='function'||gn.sourceNote.isRest()) {valid=false;break;}
      const sourceNote=gn.sourceNote, event=measure.events[i];
      const name=sourceNote.Pitch?.ToStringShort?.();
      const duration=sourceNote.Length?.RealValue;
      const absolute=sourceNote.getAbsoluteTimestamp?.()?.RealValue;
      const expectedLength=event.duration/(measure.divisions*4);
      const expectedDelta=(event.start-measure.events[0].start)/(measure.divisions*4);
      if(typeof name!=='string'||name[0]?.toUpperCase()!==event.step||
        !Number.isFinite(duration)||Math.abs(duration-expectedLength)>1e-6||
        !Number.isFinite(absolute)||Math.abs((absolute-firstTimestamp)-expectedDelta)>1e-6){valid=false;break;}
      const heads=typeof gn.getNoteheadSVGs==='function'?gn.getNoteheadSVGs():[];
      const group=typeof gn.getSVGGElement==='function'?gn.getSVGGElement():null;
      const candidates=[...(Array.isArray(heads)&&heads.length===1?heads:[]),group].filter(Boolean);
      // OSMD may return a rendered glyph reference detached from the live SVG tree.
      // Never attach handlers to invisible/detached nodes; prefer a connected group.
      const head=candidates.find(el=>el.isConnected===true) || candidates.find(el=>typeof el.addEventListener==='function');
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
  const graphical=graphicalTargets(osmd,doc,visibleParts);
  const host=document.getElementById('score-container');
  const model=visibleParts.length===1?inspectScore(doc).parts.find(part=>part.id===visibleParts[0]):null;
  const allNotes=model?.measures.reduce((total,measure)=>total+measure.events.length,0);
  // Never attach based on a subset or to another document's detached glyph nodes.
  const enabled=!!host&&graphical.length>0&&graphical.length<=320&&graphical.length===allNotes;
  let selected=null,drag=null,disposed=false;
  const elements=()=> {
    if(!enabled||disposed)return [];
    const glyphs=[...host.querySelectorAll('svg .vf-notehead')];
    return glyphs.length===graphical.length && glyphs.every(el=>host.contains(el)) ? glyphs : [];
  };
  function update(){
    const glyphs=elements();
    for(const [i,el] of glyphs.entries()){
      const item=graphical[i];
      el.classList.add('jwoo-note-target');
      el.setAttribute('tabindex','0');
      el.setAttribute('role','button');
      el.setAttribute('aria-label','악보 '+(item.measureIndex+1)+'마디 '+(item.eventIndex+1)+'번째 음표 선택');
      el.classList.toggle('jwoo-note-selected',!!selected&&selected.partId===item.partId&&selected.measureIndex===item.measureIndex&&selected.eventIndex===item.eventIndex);
    }
    return glyphs.length;
  }
  function findEvent(event){
    let element=event.target?.closest?.('.vf-notehead');
    if(!element){
      const noteGroup=event.target?.closest?.('.vf-stavenote');
      const inside=noteGroup?.querySelectorAll?.('.vf-notehead');
      if(inside?.length===1) element=inside[0];
    }
    const glyphs=elements();
    if(!element||!glyphs.length)return null;
    const i=glyphs.indexOf(element);
    return i>=0?{element,item:graphical[i]}:null;
  }
  function pointerDown(event){
    if(event.button!==0)return;
    const found=findEvent(event);
    if(!found)return;
    const rect=found.element.getBoundingClientRect();
    drag={id:event.pointerId,y:event.clientY,unit:Math.max(7,Math.min(18,rect.height*.6)),item:found.item};
    selected={partId:found.item.partId,measureIndex:found.item.measureIndex,eventIndex:found.item.eventIndex};
    select(selected);
    update();
    event.preventDefault();
  }
  function pointerUp(event){
    if(!drag||drag.id!==event.pointerId)return;
    const steps=Math.max(-8,Math.min(8,Math.round((drag.y-event.clientY)/drag.unit)));
    const item=drag.item;drag=null;
    if(steps!==0)movePitch(item,steps);
  }
  function keyDown(event){
    if(!['Enter',' ','ArrowUp','ArrowDown'].includes(event.key))return;
    const found=findEvent(event);
    if(!found)return;
    event.preventDefault();
    selected={partId:found.item.partId,measureIndex:found.item.measureIndex,eventIndex:found.item.eventIndex};
    select(selected);update();
    if(event.key==='ArrowUp'||event.key==='ArrowDown')movePitch(found.item,event.key==='ArrowUp'?1:-1);
  }
  host?.addEventListener('pointerdown',pointerDown);
  host?.addEventListener('keydown',keyDown);
  document.addEventListener('pointerup',pointerUp);
  const observer=enabled?new MutationObserver(()=>{if(!disposed)update();}):null;
  observer?.observe(host,{childList:true,subtree:true});
  const count=update();
  announce?.(count);
  return {
    count,
    highlight(nextSelection){selected=nextSelection;update();},
    dispose(){
      disposed=true;observer?.disconnect();
      host?.removeEventListener('pointerdown',pointerDown);
      host?.removeEventListener('keydown',keyDown);
      document.removeEventListener('pointerup',pointerUp);
    },
  };
}
