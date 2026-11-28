// Safe graphical MusicXML editing: bind individual SVG noteheads, not SVG order.
// Concurrent voices, multiple staves and chords are permitted only with unique identity.
import { listAdvancedMeasures } from './advanced-score.js';
const STEPS='CDEFGAB';
const close=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1e-6;
export function shiftDiatonicPitch({step,alter=0,octave},diatonicSteps){
  if(!STEPS.includes(step)||step.length!==1||!Number.isInteger(diatonicSteps)||Math.abs(diatonicSteps)>8||!Number.isInteger(octave))throw new Error('음정 이동 단계가 올바르지 않습니다.');
  const absolute=octave*7+STEPS.indexOf(step)+diatonicSteps;
  const nextOctave=Math.floor(absolute/7),nextStep=STEPS[((absolute%7)+7)%7];
  if(nextOctave<1||nextOctave>8)throw new Error('지원하는 옥타브 범위를 벗어났습니다.');
  return {step:nextStep,alter,octave:nextOctave};
}
const direct=(node,name)=>node&&[...node.children].find(x=>x.localName===name);
const all=(node,name)=>node?[...node.children].filter(x=>x.localName===name):[];
function staffCount(part) {
  let declared=[];
  let largest=1;
  for(const measure of all(part,'measure')) {
    for(const attrs of all(measure,'attributes')) {
      const staves=direct(attrs,'staves');
      if(staves)declared.push(Number(staves.textContent));
    }
    for(const note of all(measure,'note')) {
      const staff=direct(note,'staff');
      if(staff)largest=Math.max(largest,Number(staff.textContent));
    }
  }
  const count=Math.max(largest,...declared,1);
  // A changing number of staves cannot be indexed into a fixed graphical row.
  return Number.isSafeInteger(count)&&count<=8&&declared.every(x=>x===count)?count:null;
}
function staffOffsets(doc,visibleParts) {
  const wanted=new Set(visibleParts);
  const parts=all(doc?.documentElement,'part').filter(n=>wanted.has(n.getAttribute('id')));
  if(parts.length!==wanted.size||!parts.length)return null;
  const offsets=new Map();
  let total=0;
  for(const part of parts) {
    const count=staffCount(part);
    if(!count)return null;
    offsets.set(part.getAttribute('id'),{offset:total,count});
    total+=count;
  }
  return {offsets,total};
}
const signature=e=>{
  if(!e||!Number.isInteger(e.start)||!Number.isInteger(e.duration))return null;
  if(e.rest===true)return ['rest',e.start,e.duration].join('/');
  return e.step&&Number.isInteger(e.alter)&&Number.isInteger(e.octave)
    ?['note',e.start,e.duration,e.step,e.alter,e.octave].join('/') : null;
};
// Match OSMD's explicit voice identity when available. Unresolved unisons stay read-only.
const laneSignature=e=>{
  const base=signature(e),voice=e?.voice,staff=e?.staff;
  return base!==null&&voice!==undefined&&voice!==null&&String(voice)!==''&&
    staff!==undefined&&staff!==null&&String(staff)!==''
    ?base+'@voice='+String(voice)+'@staff='+String(staff):null;
};
export function matchScoreEvents(events,graphics) {
  const source=new Map(),visual=new Map();
  for(const [list,store] of [[events,source],[graphics,visual]]){
    for(const event of list){
      const key=signature(event);
      if(key===null)continue;
      const found=store.get(key)||[];found.push(event);store.set(key,found);
    }
  }
  const pairs=[];
  for(const [key,group] of source){
    const rendered=visual.get(key)||[];
    if(group.length===1&&rendered.length===1){
      pairs.push({event:group[0],graphic:rendered[0]});continue;
    }
    // Duplicated simultaneous pitches/rests need complete, unambiguous voice
    // evidence. Never pair only a subset: OSMD could renumber voices.
    if(group.length<2||group.length!==rendered.length)continue;
    const byLane=new Map();
    let valid=true;
    for(const item of group){
      const id=laneSignature(item);
      if(id===null||byLane.has(id)){valid=false;break;}
      byLane.set(id,item);
    }
    if(!valid)continue;
    const seen=new Set(),candidate=[];
    for(const item of rendered){
      const id=laneSignature(item),original=id===null?null:byLane.get(id);
      if(!original||seen.has(id)){valid=false;break;}
      seen.add(id);candidate.push({event:original,graphic:item});
    }
    if(valid&&seen.size===group.length)pairs.push(...candidate);
  }
  return pairs;
}
// OSMD 1.9.9 uses numeric natural-note identities and accidental semitones.
// Do not parse VexFlow glyph strings (e.g. explicit natural is "n").
export function sourcePitch(source) {
  const pitch=source?.Pitch;
  if(!pitch)return null;
  const step=({0:'C',2:'D',4:'E',5:'F',7:'G',9:'A',11:'B'})[pitch.FundamentalNote];
  const alter=pitch.AccidentalHalfTones,octave=pitch.Octave+3;
  return step&&Number.isInteger(alter)&&Number.isInteger(pitch.Octave)
    ?{step,alter,octave}:null;
}
function noteHead(gn,host) {
  const group=gn?.getSVGGElement?.();
  const heads=gn?.getNoteheadSVGs?.()||[];
  const valid=el=>el&&el.isConnected===true&&host.contains(el);
  const hit=el=>el?.closest?.('.vf-notehead')||el;
  if(Array.isArray(heads)&&heads.length===1&&valid(heads[0]))return hit(heads[0]);
  const idx=gn?.vfnoteIndex;
  if(Array.isArray(heads)&&heads.length>1&&Number.isInteger(idx)&&valid(heads[idx]))return hit(heads[idx]);
  const live=group?.querySelectorAll?.('.vf-notehead');
  if(live?.length===1&&valid(live[0]))return live[0];
  if(live?.length>1&&Number.isInteger(idx)&&valid(live[idx]))return live[idx];
  return null;
}
function restGlyph(gn,host) {
  const group=gn?.getSVGGElement?.();
  if(!group?.isConnected||!host.contains(group))return null;
  const stave=group.closest?.('.vf-stavenote')||group;
  if(!host.contains(stave))return null;
  // VexFlow 5 renders ordinary rests inside a .vf-notehead group too.
  // This is a rest only because the OSMD sourceNote confirmed isRest().
  const glyphs=stave.querySelectorAll?.('.vf-notehead')||[];
  if(glyphs.length===1)return glyphs[0];
  if(glyphs.length>1)return null;
  const restMarks=stave.querySelectorAll?.('.vf-rest')||[];
  if(restMarks.length===1)return restMarks[0];
  // OSMD and VexFlow expose ordinary rests as a single stavenote group.
  // Unknown or multiple glyphs are not bound to avoid ambiguous hit regions.
  return stave.matches?.('.vf-stavenote')&&
    stave.querySelectorAll?.('.vf-stavenote')?.length===0?stave:null;
}
export function graphicalTargets(osmd,doc,visibleParts,host) {
  if(!osmd?.GraphicSheet||!doc||!Array.isArray(visibleParts)||!host)return [];
  const layout=staffOffsets(doc,visibleParts);
  const matrix=osmd.GraphicSheet.MeasureList;
  if(!layout||!Array.isArray(matrix))return [];
  const found=[],used=new Set();
  for(const part of listAdvancedMeasures(doc)) {
    const location=layout.offsets.get(part.id);
    if(!location)continue;
    for(const measure of part.measures) {
      if(measure.reason||!measure.divisions)continue;
      const row=matrix[measure.index];
      if(!Array.isArray(row)||row.length!==layout.total)continue;
      for(let staff=1;staff<=location.count;staff++) {
        const staffEntries=row[location.offset+staff-1]?.staffEntries;
        if(!Array.isArray(staffEntries))continue;
        const expected=measure.events.filter(e=>Number(e.staff)===staff&&
          e.duration>0&&(e.rest||!!e.step));
        const drawn=[];
        for(const entry of staffEntries)for(const voice of entry.graphicalVoiceEntries||[])for(const gn of voice.notes||[]) {
          const src=gn?.sourceNote;
          if(!src||typeof src.isRest!=='function')continue;
          const rest=src.isRest()===true;
          const pitch=rest?null:sourcePitch(src);
          const time=src.ParentVoiceEntry?.Timestamp?.RealValue,duration=src.Length?.RealValue;
          if(!rest&&!pitch||!Number.isFinite(time)||!Number.isFinite(duration))continue;
          const start=Math.round(time*measure.divisions*4),length=Math.round(duration*measure.divisions*4);
          if(!close(start/(measure.divisions*4),time)||!close(length/(measure.divisions*4),duration))continue;
          const rawVoice=src.ParentVoiceEntry?.ParentVoice?.VoiceId;
           const voice=(typeof rawVoice==='number'||typeof rawVoice==='string')&&
             String(rawVoice)!==''?String(rawVoice):undefined;
           drawn.push({...pitch,start,duration:length,rest,gn,voice,staff:String(staff)});
        }
        for(const pair of matchScoreEvents(expected,drawn)) {
          const rest=pair.event.rest===true;
          const element=rest?restGlyph(pair.graphic.gn,host):noteHead(pair.graphic.gn,host);
          if(!element||used.has(element))continue;
          used.add(element);
          found.push({partId:part.id,measureIndex:measure.index,eventIndex:pair.event.eventIndex,
            voice:pair.event.voice,staff,element,rest});
        }
      }
    }
  }
  return found;
}
function addHitArea(element) {
  const target=element.matches?.('.vf-notehead')?element:(element.closest?.('.vf-notehead')||element);
  if(!target||target.querySelector?.(':scope > .jwoo-hit-area')||typeof target.getBBox!=='function')return;
  let box;
  try{box=target.getBBox();}catch{return;}
  if(!box||![box.x,box.y,box.width,box.height].every(Number.isFinite)||box.width<=0||box.height<=0)return;
  const overlay=target.ownerDocument.createElementNS('http://www.w3.org/2000/svg','rect');
  for(const [key,val] of Object.entries({x:box.x-3,y:box.y-3,width:box.width+6,height:box.height+6,fill:'transparent','pointer-events':'all'}))
    overlay.setAttribute(key,String(val));
  overlay.classList.add('jwoo-hit-area');target.appendChild(overlay);
}
// OSMD autoResize replaces SVG nodes. Rebind after a DOM replacement instead of
// assuming one-off graphical objects survive responsive re-rendering.
export function bindGraphicalEditor({osmd,doc,visibleParts,select,movePitch,announce,
  isLyricMode=()=>false,editLyric=()=>false,onMeasurePointer=()=>{},onDirectEdit=()=>false}) {
  const host=document.getElementById('score-container');
  let targets=[],cleanups=[],selected=null,drag=null,disposed=false;
  const same=(a,b)=>a&&b&&a.partId===b.partId&&a.measureIndex===b.measureIndex&&a.eventIndex===b.eventIndex;
  function markSelected(item,on){
    const el=item.element;
    el.classList.toggle('jwoo-note-selected',on);
    el.setAttribute('aria-pressed',String(on));
    const prior=el.querySelector(':scope > .jwoo-selection-ring');
    if(!on){prior?.remove();return;}
    if(prior)return;
    const area=el.querySelector(':scope > .jwoo-hit-area');
    if(!area)return;
    const x=Number(area.getAttribute('x')),y=Number(area.getAttribute('y'));
    const w=Number(area.getAttribute('width')),h=Number(area.getAttribute('height'));
    if(![x,y,w,h].every(Number.isFinite)||w<=0||h<=0)return;
    const ring=el.ownerDocument.createElementNS('http://www.w3.org/2000/svg','rect');
    for(const [key,val] of Object.entries({
      x:x-2,y:y-2,width:w+4,height:h+4,rx:Math.min(8,(h+4)/2),
      fill:'#d9ff7a','fill-opacity':'0.22',stroke:'#b9fb5d','stroke-width':'2.6',
      'pointer-events':'none'
    }))ring.setAttribute(key,String(val));
    ring.classList.add('jwoo-selection-ring');
    el.insertBefore(ring,el.firstChild);
  }
  let activeRange=null,playbackMeasure=null;
  function highlightPlayback(){
    for(const item of targets)item.element.classList.toggle('jwoo-playback-active',
      playbackMeasure!==null&&item.measureIndex===playbackMeasure);
  }
  function highlightRange(){
    for(const item of targets)item.element.classList.toggle('jwoo-measure-selected',
      !!activeRange&&item.measureIndex>=activeRange.start&&item.measureIndex<=activeRange.end);
  }
  function highlight(){for(const item of targets)markSelected(item,!!same(selected,item));highlightRange();highlightPlayback();}
  function clearDragPreview(){
    if(!drag?.preview)return;
    drag.preview?.remove();
    if(drag.item.element.isConnected)drag.item.element.style.opacity=drag.priorOpacity??'';
  }
  function move(event){
    if(disposed||!drag||drag.pointerId!==event.pointerId)return;
    const delta=Math.max(-8*drag.unit,Math.min(8*drag.unit,event.clientY-drag.y));
    if(!drag.preview&&Math.abs(delta)<3)return;
    if(!drag.preview){
      const original=drag.item.element,svg=original.closest('svg');
      if(!svg||!original.parentNode)return;
      const group=original.ownerDocument.createElementNS('http://www.w3.org/2000/svg','g');
      group.classList.add('jwoo-note-drag-preview');
      const ghost=original.cloneNode(true);
      ghost.removeAttribute('id');ghost.removeAttribute('tabindex');ghost.removeAttribute('role');
      ghost.removeAttribute('aria-pressed');ghost.removeAttribute('aria-label');
      ghost.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
      ghost.querySelectorAll('.jwoo-hit-area,.jwoo-selection-ring').forEach(node=>node.remove());
      group.appendChild(ghost);original.parentNode.appendChild(group);
      drag.preview=group;drag.svg=svg;drag.priorOpacity=original.style.opacity;
      original.style.opacity='0.35';
    }
    const box=drag.svg.getBoundingClientRect();
    const width=drag.svg.viewBox?.baseVal?.width;
    const scale=box.width&&width?width/box.width:1;
    drag.preview.setAttribute('transform',`translate(0 ${delta*scale})`);
  }
  function up(event) {
    if(disposed||!drag||drag.pointerId!==event.pointerId)return;
    const {item,unit,y}=drag;
    clearDragPreview();
    drag=null;
    const steps=Math.max(-8,Math.min(8,Math.round((y-event.clientY)/unit)));
    if(steps)movePitch(item,steps);
  }
  function cancel(event){if(drag?.pointerId===event.pointerId){clearDragPreview();drag=null;}}
  function clearHandlers(){for(const off of cleanups)off();cleanups=[];clearDragPreview();drag=null;}
  function attach(item){
    const el=item.element;
    el.classList.add(item.rest?'jwoo-rest-target':'jwoo-note-target');el.setAttribute('tabindex','0');
    el.setAttribute('role','button');
    el.setAttribute('aria-label',(item.measureIndex+1)+'마디 '+item.voice+'성부 '+item.staff+'보표 '+(item.rest?'쉼표':'음표'));
    addHitArea(el);
    el.setAttribute('aria-pressed','false');
    function key(event) {
      if(!['Enter',' ','ArrowUp','ArrowDown','Delete','Backspace'].includes(event.key))return;
      event.preventDefault();selected=item;onMeasurePointer(item.measureIndex,!!event.shiftKey);select(item);highlight();
      if((event.key==='Delete'||event.key==='Backspace')&&!item.rest){
        onDirectEdit(item,'delete');return;
      }
      if(item.rest&&(event.key==='Enter'||event.key===' ')&&!isLyricMode()){
        onDirectEdit(item,'insert');return;
      }
      if(!item.rest&&isLyricMode()&&(event.key==='Enter'||event.key===' ')){
        editLyric(item,el);return;
      }
      if(!item.rest&&!isLyricMode()&&(event.key==='ArrowUp'||event.key==='ArrowDown'))
        movePitch(item,event.key==='ArrowUp'?1:-1);
    }
    el.addEventListener('keydown',key);
    cleanups.push(()=>el.removeEventListener('keydown',key));
  }
  function remap(){
    if(disposed)return;
    const next=graphicalTargets(osmd,doc,visibleParts,host);
    if(next.length===targets.length&&next.every((v,i)=>v.element===targets[i].element))return;
    clearHandlers();
    targets=next;
    for(const item of targets)attach(item);
    highlight();announce?.(targets.length);
  }
  // VexFlow's chord/stavenote SVG groups can receive pointerdown even when
  // elementFromPoint reports an underlying notehead. Resolve inside exactly
  // one source-verified stave note and one notehead hitbox; never guess.
  function rootDown(event){
    if(disposed||event.button!==0||event.isPrimary===false)return;
    if(drag){clearDragPreview();drag=null;}
    const stave=event.target?.closest?.('.vf-stavenote');
    if(!stave)return;
    const hit=targets.filter(item=>{
      if(item.element.closest?.('.vf-stavenote')!==stave)return false;
      const box=item.element.getBoundingClientRect();
      const pad=4;
      return box.width>0&&box.height>0&&event.clientX>=box.left-pad&&event.clientX<=box.right+pad
        &&event.clientY>=box.top-pad&&event.clientY<=box.bottom+pad;
    });
    if(!hit.length)return;
    const explicit=hit.filter(item=>item.element===event.target||item.element.contains?.(event.target));
    let item=null;
    if(explicit.length===1)item=explicit[0];
    else if(!explicit.length) {
      const ranked=hit.map(candidate=>{
        const b=candidate.element.getBoundingClientRect();
        return {candidate,distance:Math.hypot(event.clientX-(b.left+b.right)/2,event.clientY-(b.top+b.bottom)/2)};
      }).sort((a,b)=>a.distance-b.distance);
      // Nearby chord heads overlap; use the closest only if distinctly closer.
      if(ranked.length===1||ranked[1].distance-ranked[0].distance>=3)item=ranked[0].candidate;
    }
    if(!item)return;
    selected=item;onMeasurePointer(item.measureIndex,!!event.shiftKey);select(item);highlight();
    if(item.rest){
      drag=null;
      event.preventDefault();event.stopPropagation();
      return;
    }
    if(isLyricMode()){
      drag=null;
      editLyric(item,item.element);
      event.preventDefault();event.stopPropagation();
      return;
    }
    const box=item.element.getBoundingClientRect();
    drag={item,y:event.clientY,pointerId:event.pointerId,unit:Math.max(7,Math.min(18,box.height*.6))};
    event.preventDefault();event.stopPropagation();
  }
  function rootDouble(event){
    if(disposed||!selected)return;
    const item=targets.find(item=>same(item,selected));
    if(!item||item.rest||item.element.closest?.('.vf-stavenote')!==event.target?.closest?.('.vf-stavenote'))return;
    const box=item.element.getBoundingClientRect(),pad=5;
    if(event.clientX<box.left-pad||event.clientX>box.right+pad||
      event.clientY<box.top-pad||event.clientY>box.bottom+pad)return;
    drag=null;
    event.preventDefault();event.stopPropagation();
    editLyric(item,item.element);
  }
  function rootContext(event){
    if(disposed||isLyricMode())return;
    const matched=targets.filter(item=>item.element===event.target||
      item.element.contains?.(event.target));
    if(matched.length!==1)return;
    const item=matched[0];
    event.preventDefault();event.stopPropagation();
    drag=null;selected=item;
    onMeasurePointer(item.measureIndex,false,{x:event.clientX,y:event.clientY});
    select(item);highlight();
  }
  host?.addEventListener('contextmenu',rootContext,true);
  host?.addEventListener('pointerdown',rootDown,true);
  host?.addEventListener('dblclick',rootDouble,true);
  document.addEventListener('pointermove',move);
  document.addEventListener('pointerup',up);document.addEventListener('pointercancel',cancel);
  // Observe subtree replacements only; class/attribute changes are not watched.
  // addHitArea modifies childList once, but remap's identity check prevents loops.
  const observer=host?new MutationObserver(remap):null;
  observer?.observe(host,{childList:true,subtree:true});
  remap();
  return {get count(){return targets.length;},highlight(next){selected=next;highlight();},
    highlightMeasureRange(start,end){
      activeRange=Number.isSafeInteger(start)&&Number.isSafeInteger(end)?{start,end}:null;
      highlightRange();
    },
    highlightPlaybackMeasure(measureIndex){
      playbackMeasure=Number.isSafeInteger(measureIndex)&&measureIndex>=0?measureIndex:null;
      highlightPlayback();
    },
    rectFor(next){
      const item=targets.find(item=>same(item,next));
      return item?.element?.getBoundingClientRect?.()||null;
    },
    dispose(){
      if(disposed)return;disposed=true;
      observer?.disconnect();clearHandlers();
      for(const item of targets){markSelected(item,false);item.element.classList.remove('jwoo-playback-active');}
      host?.removeEventListener('contextmenu',rootContext,true);
      host?.removeEventListener('pointerdown',rootDown,true);
      host?.removeEventListener('dblclick',rootDouble,true);
      document.removeEventListener('pointermove',move);
      document.removeEventListener('pointerup',up);document.removeEventListener('pointercancel',cancel);
    }};
}
