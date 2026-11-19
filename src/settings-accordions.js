// Progressive disclosure for the long inspector. All existing controls remain in
// the DOM with their listeners, values, and undo history intact.
const STORAGE_KEY='jwoo-score-settings-fold-v1';
export function mountSettingsAccordions(){
  const host=document.getElementById('editor-controls');
  if(!host||host.dataset.accordionsReady==='true')return;
  host.dataset.accordionsReady='true';
  const read=()=>{
    try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')||{};}catch{return {};}
  };
  const memory=read();
  const store=()=>{
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(memory));}catch{/*Private mode*/ }
  };
  const toggles=[];
  function labelText(header){
    return header.querySelector('span')?.textContent?.trim()||
      [...header.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join('').trim()||
      header.textContent.trim();
  }
  function setup(header,body,key,name){
    body.id='jwoo-fold-body-'+key;
    body.classList.add('jwoo-fold-body');
    const button=document.createElement('button');
    button.type='button';button.className='jwoo-fold-toggle';
    button.setAttribute('aria-controls',body.id);
    button.dataset.foldKey=key;
    header.appendChild(button);
    const update=collapsed=>{
      body.hidden=collapsed;
      button.setAttribute('aria-expanded',String(!collapsed));
      button.setAttribute('aria-label',name+(collapsed?' 펼치기':' 접기'));
      button.textContent=collapsed?'펼치기 ＋':'접기 −';
      memory[key]=collapsed;store();
    };
    button.addEventListener('click',()=>update(!body.hidden));
    toggles.push({update,key,button,body});
    update(memory[key]===true);
  }
  // Top-level panel accordions. Moving existing nodes preserves event listeners.
  const groups=[...host.querySelectorAll('.control-group')];
  groups.forEach((group,i)=>{
    const heading=[...group.children].find(x=>x.classList.contains('control-heading'));
    if(!heading)return;
    const body=document.createElement('div');
    body.className='jwoo-panel-body';
    while(heading.nextSibling)body.appendChild(heading.nextSibling);
    group.appendChild(body);
    setup(heading,body,'group-'+(i+1),labelText(heading));
  });
  // 4.0 contains long subsections; they get independent second-level toggles.
  const v4=document.querySelector('.v4-editor > .jwoo-panel-body');
  if(v4){
    let current=null,n=0;
    for(const node of [...v4.childNodes]){
      if(node.nodeType===Node.ELEMENT_NODE&&node.classList.contains('v4-subhead')){
        const section=document.createElement('div');
        section.className='jwoo-v4-section';
        const body=document.createElement('div');body.className='jwoo-v4-section-body';
        v4.appendChild(section);section.appendChild(node);section.appendChild(body);
        setup(node,body,'v4-'+(++n),labelText(node));
        current=body;
      }else if(current)current.appendChild(node);
    }
    // 03A / 03B lyric sections retain their own independent toggles.
    let nested=0;
    for(const group of v4.querySelectorAll('.v4-batch-lyrics')){
      const heading=[...group.children].find(x=>x.classList.contains('v4-subhead'));
      if(!heading)continue;
      const body=document.createElement('div');body.className='jwoo-v4-section-body';
      while(heading.nextSibling)body.appendChild(heading.nextSibling);
      group.appendChild(body);
      setup(heading,body,'lyrics-'+(++nested),labelText(heading));
    }
  }
  const bar=document.createElement('div');bar.className='jwoo-fold-all';
  const name=document.createElement('span');name.textContent='세부 설정';bar.append(name);
  for(const [label,collapse] of [['모두 접기',true],['모두 펼치기',false]]){
    const button=document.createElement('button');button.type='button';button.textContent=label;
    button.addEventListener('click',()=>toggles.forEach(item=>item.update(collapse)));
    bar.append(button);
  }
  host.prepend(bar);
}
