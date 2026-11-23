// Logic and other MusicXML exports can restate an unchanged clef after rests.
// OSMD already supplies the active clef at every new system, so these explicit
// repeats can become stray in-line clefs when measures are deleted or reflowed.
const children=(node,name)=>node?[...node.children].filter(child=>child.localName===name):[];
const first=(node,name)=>children(node,name)[0]||null;
const signature=clef=>['sign','line','clef-octave-change'].map(tag=>
  first(clef,tag)?.textContent?.trim()||'').join('|');
const staff=clef=>clef.getAttribute('number')||'1';

export function normalizeRedundantClefs(source){
  if(source?.documentElement?.localName!=='score-partwise')
    throw new Error('MusicXML partwise 악보만 음자리표를 정리할 수 있습니다.');
  const doc=source.cloneNode(true);
  let removed=0;
  for(const part of children(doc.documentElement,'part')){
    const active=new Map();
    for(const measure of children(part,'measure')){
      for(const attrs of children(measure,'attributes')){
        for(const clef of children(attrs,'clef')){
          const lane=staff(clef),next=signature(clef),prior=active.get(lane);
          const hasAppearanceSettings=[...clef.attributes].some(attr=>
            !['number'].includes(attr.name));
          if(prior===next&&!hasAppearanceSettings){attrs.removeChild(clef);removed++;}
          else active.set(lane,next);
        }
        if(!attrs.children.length)measure.removeChild(attrs);
      }
    }
  }
  return {doc,removed};
}
