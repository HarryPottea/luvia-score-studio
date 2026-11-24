// Presentation-only workspace navigation. Existing editor nodes, listeners,
// history and MusicXML state remain in place inside the inspector.
const menus=[
  ['file','파일','새 악보 · 열기 · 복원'],
  ['score','악보','제목 · 파트 · 보기'],
  ['notes','음표','음정 · 리듬 · 악상'],
  ['lyrics','가사·코드','가사 · 코드 기호'],
  ['layout','조판','마디 · 용지 · 줄바꿈'],
  ['export','출력','파트 · PDF · 저장'],
];
const groupMenus={
  0:['score'],1:['score'],2:['score','layout'],3:['export'],
  4:['notes'],5:['notes'],6:['score','export'],7:['layout','export'],
  8:['notes'],9:['notes'],10:['notes','lyrics','layout'],11:['lyrics'],
};
const v4Sections={
  notes:[0,1,2,5],lyrics:[3],layout:[4],score:[4,6],export:[],
};
function unfold(element){
  if(!element)return;
  for(const body of [element.querySelector(':scope > .jwoo-fold-body'),element.querySelector(':scope > .jwoo-panel-body'),element.querySelector(':scope > .jwoo-v4-section-body')]){
    if(body?.hidden){
      const toggle=element.querySelector(':scope > .control-heading .jwoo-fold-toggle, :scope > .v4-subhead .jwoo-fold-toggle');
      toggle?.click();
    }
  }
}
export function mountWorkspaceShell(){
  const workspace=document.querySelector('.workspace');
  const grid=workspace?.querySelector('.work-grid');
  const inspector=grid?.querySelector('.controls');
  const editor=document.getElementById('editor-controls');
  const tools=document.getElementById('jwoo-score-tools');
  if(!workspace||!grid||!inspector||!editor||!tools)return;
  const menu=document.createElement('nav');
  menu.className='studio-menubar';menu.setAttribute('aria-label','악보 작업 메뉴');
  const list=document.createElement('div');list.className='studio-menu-list';
  for(const [key,label,description] of menus){
    const button=document.createElement('button');button.type='button';
    button.dataset.studioMenu=key;button.textContent=label;
    button.title=description;
    button.setAttribute('aria-controls','studio-inspector');
    button.setAttribute('aria-expanded','false');
    list.append(button);
  }
  const close=document.createElement('button');close.type='button';
  close.className='studio-panel-close';close.textContent='설정창 닫기 ×';
  close.setAttribute('aria-label','설정창 닫기');
  menu.append(list,close);
  grid.before(menu);
  tools.classList.add('studio-tool-rail');
  grid.prepend(tools);
  inspector.id='studio-inspector';
  const heading=inspector.querySelector('.workspace-kicker');
  if(heading)heading.textContent='J-WOO / INSPECTOR';
  const emptyActions=document.createElement('div');
  emptyActions.className='studio-empty-actions';
  for(const [label,target] of [['＋ 새 악보','#v4-new'],['파일 열기','#open-file']]){
    const button=document.createElement('button');button.type='button';button.textContent=label;
    button.addEventListener('click',()=>document.querySelector(target)?.click());
    emptyActions.append(button);
  }
  document.querySelector('.empty-score-state')?.append(emptyActions);
  const groups=[...editor.children].filter(el=>el.classList.contains('control-group'));
  groups.forEach((group,index)=>group.dataset.studioGroups=(groupMenus[index]||['notes']).join(' '));
  const sections=[...editor.querySelectorAll('.v4-editor > .jwoo-panel-body > .jwoo-v4-section')];
  let active='file';
  function render(){
    const open=workspace.classList.contains('studio-panel-open');
    workspace.dataset.studioMenu=active;
    for(const button of list.children){
      const selected=open&&button.dataset.studioMenu===active;
      button.classList.toggle('is-active',selected);
      button.setAttribute('aria-expanded',String(selected));
    }
    inspector.setAttribute('aria-label',(menus.find(row=>row[0]===active)?.[1]||'')+' 설정');
    const file=active==='file';
    inspector.querySelector('.v4-create')?.classList.toggle('studio-filter-hidden',!file);
    inspector.querySelector('.drop-zone')?.classList.toggle('studio-filter-hidden',!file);
    inspector.querySelector('.settings-action')?.classList.toggle('studio-filter-hidden',file);
    for(const group of groups){
      group.classList.toggle('studio-filter-hidden',!group.dataset.studioGroups.split(' ').includes(active));
    }
    sections.forEach((section,index)=>section.classList.toggle('studio-filter-hidden',!(v4Sections[active]||[]).includes(index)));
    if(!file){
      const preferred={score:0,notes:8,lyrics:10,layout:10,export:7}[active];
      const candidate=groups[preferred];
      unfold(candidate);
      if(candidate?.classList.contains('v4-editor')){
        const section=sections.find(item=>!item.classList.contains('studio-filter-hidden'));
        unfold(section);
        if(active==='lyrics')unfold(section?.querySelector('.v4-batch-lyrics'));
      }
    }
  }
  function openMenu(key){
    if(active===key&&workspace.classList.contains('studio-panel-open')){
      workspace.classList.remove('studio-panel-open');
    }else{
      active=key;workspace.classList.add('studio-panel-open');
      if(key!=='file'&&editor.hidden&&document.querySelector('.site-shell.has-active-score')){
        document.getElementById('toggle-settings')?.click();
      }
    }
    render();
  }
  list.addEventListener('click',event=>{
    const button=event.target.closest('[data-studio-menu]');
    if(button)openMenu(button.dataset.studioMenu);
  });
  close.addEventListener('click',()=>{workspace.classList.remove('studio-panel-open');render();});
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&workspace.classList.contains('studio-panel-open')){
      workspace.classList.remove('studio-panel-open');render();
    }
  });
  // Existing shortcut buttons must reveal their inspector category first.
  editor.addEventListener('click',event=>{
    const button=event.target.closest('.jwoo-quick-link');
    if(!button)return;
    const label=button.textContent.trim();
    const key=({새악보:'file',파트:'score',음표:'notes',마디:'layout',가사:'lyrics',코드:'lyrics',출력:'export'})[label.replace(/\s/g,'')];
    if(key){active=key;workspace.classList.add('studio-panel-open');render();}
  },true);
  const firstLoad=new MutationObserver(()=>{
    if(document.querySelector('.site-shell.has-active-score')&&workspace.dataset.studioInitial==='false'){
      workspace.dataset.studioInitial='true';
      workspace.classList.remove('studio-panel-open');render();
    }
  });
  firstLoad.observe(document.querySelector('.site-shell'),{attributes:true,attributeFilter:['class']});
  workspace.dataset.studioInitial='false';
  workspace.classList.add('studio-panel-open');
  render();
}
