// Compact inspector pages. Move live controls, not copies; values, listeners,
// MusicXML state and undo history remain owned by the existing editors.
export function mountInspectorPages({inspector,editor,groups,sections,unfold}){
  const bar=document.createElement('nav');
  bar.className='studio-inspector-pages';bar.setAttribute('aria-label','세부 기능 선택');
  inspector.querySelector('.workspace-kicker')?.after(bar);
  const allChunks=[];
  function split(index,definitions){
    const body=sections[index]?.querySelector(':scope > .jwoo-v4-section-body');
    if(!body)return [];
    const children=[...body.childNodes];
    const starts=definitions.map((def,i)=>{
      if(i===0)return 0;
      let anchor=body.querySelector(def[2]);
      while(anchor&&anchor.parentElement!==body)anchor=anchor.parentElement;
      return children.indexOf(anchor);
    });
    // If DOM changes, keep every original control reachable in one unsplit page.
    if(starts.some((n,i)=>n<0||(i>0&&n<=starts[i-1])))return [{key:definitions[0][0],label:definitions[0][1],section:index}];
    return definitions.map(([key,label],i)=>{
      const wrapper=document.createElement('div');wrapper.className='studio-inspector-chunk';
      body.insertBefore(wrapper,children[starts[i]]);
      for(const node of children.slice(starts[i],starts[i+1]??children.length))wrapper.append(node);
      allChunks.push(wrapper);return {key,label,section:index,chunk:wrapper};
    });
  }
  const poly=split(1,[['voices','성부 관리'],['pro-note','전문 음표','#v4-pro-step'],['ornament','장식·표현','#v4-articulation-kind'],['move','이동·붙임줄','#v4-split-type']]);
  const rhythm=split(2,[['timeline','성부 시간표'],['tuplets','리듬·잇단음','.v4-rhythm-group'],['harmony','화음·이음줄','.v4-chord-transpose']]);
  const lyrics=split(3,[['lyric','가사 입력'],['batch','일괄 입력','#v4-lyrics-batch-text'],['shift','가사 위치','#v4-lyric-shift-left'],['ties','붙임줄','label[for=v4-tie-next-measure]']]);
  const layout=split(4,[['bars','마디·송폼'],['key-meter','조표·박자','label[for=v4-key]'],['systems','줄·페이지','label[for=v4-layout]'],['vector','벡터 출력','#v4-print-book']]);
  const wrapDetails=(node,label)=>{
    if(!node)return;
    const details=document.createElement('details');details.className='studio-detail';
    const summary=document.createElement('summary');summary.textContent=label;
    node.before(details);details.append(summary,node);
  };
  const toolbar=editor.querySelector('#jwoo-measure-toolbar');
  wrapDetails(toolbar?.querySelector('.jwoo-transpose-controls:not([aria-label])'),'구간 이조·이명동음');
  wrapDetails(toolbar?.querySelector('.jwoo-articulation-controls'),'표현 기호 일괄 편집');
  const group=(index,key,label)=>({group:index,key,label});
  const section=(index,key,label)=>({section:index,key,label});
  const catalogs={
    score:[group(0,'title','곡 정보'),group(1,'parts','악기·파트'),group(2,'paper','용지·보기'),group(6,'compare','원본 비교'),section(6,'audit','구조 검사')],
    notes:[group(8,'basic','음표 편집'),group(9,'advanced','화음·다성부'),section(0,'expression','음표·악상'),...poly,...rhythm,section(5,'play','재생'),group(4,'rests','리듬 검사'),group(5,'notation','표기 검사')],
    lyrics:[...lyrics,group(11,'chord','코드 기호')],
    layout:[...layout.filter(p=>p.key!=='vector'),group(2,'paper','용지·보기')],
    export:[group(3,'parts-export','파트 저장'),group(7,'pdf','조판·PDF'),...layout.filter(p=>p.key==='vector'),group(6,'compare','원본 비교')]
  };
  const selected=new Map();
  let current='file';
  function apply(category,key){
    current=category;
    const choices=catalogs[category]||[];
    const chosen=choices.find(p=>p.key===key)||choices.find(p=>p.key===selected.get(category))||choices[0];
    bar.hidden=!chosen;
    if(!chosen){bar.replaceChildren();allChunks.forEach(c=>c.hidden=false);return;}
    selected.set(category,chosen.key);
    const groupNode=chosen.section!==undefined?editor.querySelector('.v4-editor'):groups[chosen.group];
    for(const g of groups)g.classList.toggle('studio-filter-hidden',g!==groupNode);
    for(const [i,s] of sections.entries())s.classList.toggle('studio-filter-hidden',i!==chosen.section);
    for(const chunk of allChunks)chunk.hidden=!!chosen.chunk&&chunk!==chosen.chunk;
    unfold(groupNode);
    if(chosen.section!==undefined){
      unfold(sections[chosen.section]);
      if(chosen.key==='batch'||chosen.key==='shift')unfold(chosen.chunk?.querySelector('.v4-batch-lyrics'));
    }
    bar.replaceChildren();
    for(const item of choices){
      const b=document.createElement('button');b.type='button';b.dataset.inspectorPage=item.key;
      b.textContent=item.label;b.setAttribute('aria-pressed',String(item===chosen));
      b.addEventListener('click',()=>{apply(category,item.key);inspector.scrollTop=0;});
      bar.append(b);
    }
  }
  function reveal(target){
    const choices=catalogs[current]||[];
    const item=choices.find(p=>p.chunk?.contains(target))||
      choices.find(p=>p.section!==undefined&&!p.chunk&&sections[p.section]?.contains(target))||
      choices.find(p=>p.group!==undefined&&groups[p.group]?.contains(target));
    if(item)apply(current,item.key);
  }
  return {apply,reveal};
}
