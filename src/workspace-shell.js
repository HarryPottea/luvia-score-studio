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
  const header=document.querySelector('.topbar');
  const brand=header.querySelector('.brand');
  brand.querySelector('span:last-child').textContent='J-WOO.';
  const tagline=document.createElement('span');tagline.className='studio-tagline';tagline.textContent='MUSIC TO SCORE.';
  brand.after(tagline);
  header.insertBefore(menu,header.querySelector('.top-right'));
  tools.classList.add('studio-tool-rail');
  grid.before(tools);
  const left=document.createElement('aside');
  left.className='studio-navigator';left.setAttribute('aria-label','악기 및 페이지 탐색');
  left.innerHTML='<div class="studio-nav-heading"><strong>악기</strong><button type="button" data-nav="score" aria-label="악기 설정">＋</button></div>'+
    '<div class="studio-part-list"></div><div class="studio-nav-heading"><strong>페이지</strong><span class="studio-page-count"></span></div><div class="studio-pages"></div>'+
    '<div class="studio-nav-foot">LOCAL SCORE EDITING</div>';
  grid.prepend(left);
  const foot=document.querySelector('.site-footer');
  const status=document.createElement('div');status.className='studio-status';
  status.innerHTML='<span class="studio-document-name">열린 악보 없음</span><span class="studio-page-status">0 / 0</span><span class="studio-paper-status">A4</span><button type="button" class="studio-fit" aria-label="현재 페이지 처음으로">페이지 처음 ↑</button>';
  foot.prepend(status);
  const canvas=document.getElementById('preview-shell'),score=document.getElementById('score-container');
  const partList=document.getElementById('parts-list');
  const navParts=left.querySelector('.studio-part-list'),navPages=left.querySelector('.studio-pages');
  const pageNodes=()=>[...score.querySelectorAll('svg')].filter(svg=>!svg.parentElement?.closest('svg'));
  function pageOffset(page){
    return canvas.scrollTop+page.getBoundingClientRect().top-canvas.getBoundingClientRect().top-canvas.clientTop;
  }
  function goToPage(index){
    const page=pageNodes()[index];
    if(!page)return;
    const padding=parseFloat(getComputedStyle(canvas).paddingTop)||0;
    const target=Math.max(0,Math.min(pageOffset(page)-padding,canvas.scrollHeight-canvas.clientHeight));
    canvas.scrollTop=target;
    updatePage(index);
  }
  function syncNavigator(){
    navParts.replaceChildren();
    for(const row of partList.querySelectorAll('.part-row')){
      const check=row.querySelector('input[type=checkbox]'),name=row.querySelector('input[type=text]');
      if(!check||!name)continue;
      const item=document.createElement('button');item.type='button';item.className='studio-part';
      item.setAttribute('aria-pressed',String(check.checked));
      const label=document.createElement('span');label.textContent=name.value;
      const eye=document.createElement('span');eye.setAttribute('aria-hidden','true');eye.textContent=check.checked?'●':'○';
      item.append(label,eye);item.title=name.value+' 표시 전환';
      item.addEventListener('click',()=>{check.click();syncNavigator();});
      navParts.append(item);
    }
    const pages=pageNodes();
    navPages.replaceChildren();
    pages.forEach((page,i)=>{
      const button=document.createElement('button');button.type='button';button.className='studio-page';
      button.setAttribute('aria-label',(i+1)+'페이지로 이동');button.dataset.page=String(i);
      const thumbnail=document.createElement('span');thumbnail.className='studio-page-paper';thumbnail.setAttribute('aria-hidden','true');
      const number=document.createElement('span');number.textContent=String(i+1);
      button.append(thumbnail,number);
      button.addEventListener('click',()=>goToPage(i));
      navPages.append(button);
    });
    left.querySelector('.studio-page-count').textContent=String(pages.length);
    const name=document.querySelector('#drop-zone strong')?.textContent;
    status.querySelector('.studio-document-name').textContent=pages.length?name:'열린 악보 없음';
    status.querySelector('.studio-paper-status').textContent=document.getElementById('page-orientation').value==='A4_L'?'A4 가로':'A4 세로';
    updatePage();
  }
  function updatePage(requested){
    const pages=pageNodes();
    const padding=parseFloat(getComputedStyle(canvas).paddingTop)||0;
    const top=canvas.getBoundingClientRect().top+canvas.clientTop+padding+3;
    let index=0;
    for(let i=0;i<pages.length;i++)if(pages[i].getBoundingClientRect().top<=top)index=i;
    const limit=canvas.scrollHeight-canvas.clientHeight;
    if(limit>1&&canvas.scrollTop>=limit-2)index=Math.max(0,pages.length-1);
    if(Number.isInteger(requested)&&limit<=1)index=requested;
    status.querySelector('.studio-page-status').textContent=pages.length?(index+1)+' / '+pages.length:'0 / 0';
    for(const button of navPages.children){
      if(Number(button.dataset.page)===index)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
    }
  }
  canvas.addEventListener('scroll',()=>updatePage(),{passive:true});
  window.addEventListener('resize',()=>requestAnimationFrame(()=>updatePage()),{passive:true});
  if(typeof ResizeObserver==='function')new ResizeObserver(()=>updatePage()).observe(canvas);
  status.querySelector('.studio-fit').addEventListener('click',()=>navPages.querySelector('[aria-current=page]')?.click());
  document.addEventListener('jwoo:score-updated',syncNavigator);
  new MutationObserver(syncNavigator).observe(score,{attributes:true,attributeFilter:['data-render-revision']});
  new MutationObserver(syncNavigator).observe(partList,{childList:true});
  left.querySelector('[data-nav=score]').addEventListener('click',()=>{active='score';workspace.classList.add('studio-panel-open');if(editor.hidden)document.getElementById('toggle-settings')?.click();render();});

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
      if(window.matchMedia('(min-width:1060px)').matches){active='score';workspace.classList.add('studio-panel-open');}
      else workspace.classList.remove('studio-panel-open');
      render();
    }
  });
  firstLoad.observe(document.querySelector('.site-shell'),{attributes:true,attributeFilter:['class']});
  workspace.dataset.studioInitial='false';
  workspace.classList.add('studio-panel-open');
  render();syncNavigator();
}
