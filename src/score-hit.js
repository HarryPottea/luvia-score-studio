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
const signature=e=>e&&e.step&&Number.isInteger(e.alter)&&Number.isInteger(e.octave)&&Number.isInteger(e.start)&&Number.isInteger(e.duration)
  ?[e.start,e.duration,e.step,e.alter,e.octave].join('/') : null;
// Do not infer voice identities from sequence order: duplicated identities stay read-only.
export function matchScoreEvents(events,graphics) {
  const source=new Map(),visual=new Map();
  for(const [list,store] of [[events,source],[graphics,visual]]) {
    for(const e of list) {
      const key=signature(e);
      if(key){const items=store.get(key)||[];items.push(e);store.set(key,items);}
    }
  }
  const matches=[];
  for(const [key,items] of source) {
    const seen=visual.get(key)||[];
    if(items.length===1&&seen.length===1)matches.push({event:items[0],graphic:seen[0]});
  }
  return matches;
}
function sourcePitch(source) {
  // OSMD Pitch.ts uses octXmlDiff=3; serialized MusicXML octaves are 3 higher.
  const short=source?.Pitch?.ToStringShort?.(3);
  if(typeof short!=='string')return null;
  const match=/^([A-G])((?:#{1,2}|b{1,2}|x)?)(-?\d+)$/i.exec(short.trim());
  if(!match)return null;
  const alter=match[2].toLowerCase()==='x'?2:(match[2].match(/#/g)||[]).length-(match[2].match(/b/gi)||[]).length;
  return {step:match[1].toUpperCase(),alter,octave:Number(match[3])};
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
        const expected=measure.events.filter(e=>Number(e.staff)===staff&&e.editablePitch&&!e.protectedMarkup);
        const drawn=[];
        for(const entry of staffEntries)for(const voice of entry.graphicalVoiceEntries||[])for(const gn of voice.notes||[]) {
          const src=gn?.sourceNote;
          if(!src||src.isRest?.()!==false)continue;
          const pitch=sourcePitch(src),time=src.ParentVoiceEntry?.Timestamp?.RealValue,duration=src.Length?.RealValue;
          if(!pitch||!Number.isFinite(time)||!Number.isFinite(duration))continue;
          const start=Math.round(time*measure.divisions*4),length=Math.round(duration*measure.divisions*4);
          if(!close(start/(measure.divisions*4),time)||!close(length/(measure.divisions*4),duration))continue;
          drawn.push({...pitch,start,duration:length,gn});
        }
        for(const pair of matchScoreEvents(expected,drawn)) {
          const element=noteHead(pair.graphic.gn,host);
          if(!element||used.has(element))continue;
          used.add(element);
          found.push({partId:part.id,measureIndex:measure.index,eventIndex:pair.event.eventIndex,
            voice:pair.event.voice,staff,element});
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
export function bindGraphicalEditor({osmd,doc,visibleParts,select,movePitch,announce}) {
  const host=document.getElementById('score-container');
  let targets=[],cleanups=[],selected=null,drag=null,disposed=false;
  const same=(a,b)=>a&&b&&a.partId===b.partId&&a.measureIndex===b.measureIndex&&a.eventIndex===b.eventIndex;
  function highlight(){for(const item of targets)item.element.classList.toggle('jwoo-note-selected',!!same(selected,item));}
  function up(event) {
    if(disposed||!drag||drag.pointerId!==event.pointerId)return;
    const {item,unit,y}=drag;
    drag=null;
    const steps=Math.max(-8,Math.min(8,Math.round((y-event.clientY)/unit)));
    if(steps)movePitch(item,steps);
  }
  function cancel(event){if(drag?.pointerId===event.pointerId)drag=null;}
  function clearHandlers(){for(const off of cleanups)off();cleanups=[];drag=null;}
  function attach(item){
    const el=item.element;
    el.classList.add('jwoo-note-target');el.setAttribute('tabindex','0');
    el.setAttribute('role','button');
    el.setAttribute('aria-label',(item.measureIndex+1)+'마디 '+item.voice+'성부 '+item.staff+'보표 음표');
    addHitArea(el);
    function key(event) {
      if(!['Enter',' ','ArrowUp','ArrowDown'].includes(event.key))return;
      event.preventDefault();selected=item;select(item);highlight();
      if(event.key==='ArrowUp'||event.key==='ArrowDown')movePitch(item,event.key==='ArrowUp'?1:-1);
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
    selected=item;select(item);highlight();
    const box=item.element.getBoundingClientRect();
    drag={item,y:event.clientY,pointerId:event.pointerId,unit:Math.max(7,Math.min(18,box.height*.6))};
    event.preventDefault();event.stopPropagation();
  }
  host?.addEventListener('pointerdown',rootDown,true);
  document.addEventListener('pointerup',up);document.addEventListener('pointercancel',cancel);
  // Observe subtree replacements only; class/attribute changes are not watched.
  // addHitArea modifies childList once, but remap's identity check prevents loops.
  const observer=host?new MutationObserver(remap):null;
  observer?.observe(host,{childList:true,subtree:true});
  remap();
  return {get count(){return targets.length;},highlight(next){selected=next;highlight();},
    dispose(){
      if(disposed)return;disposed=true;
      observer?.disconnect();clearHandlers();
      host?.removeEventListener('pointerdown',rootDown,true);
      document.removeEventListener('pointerup',up);document.removeEventListener('pointercancel',cancel);
    }};
}
