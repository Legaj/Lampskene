/* Practical question cards. All map previews use public question positions. */
(() => {
  'use strict';
  const views = new Map();
  const placeSearch = new Map();
  let previewLayer = null, previewId = null, previewSignature = '';
  let selectedId = null, selectedPin = null, inspector = null;
  const markerBindings = new WeakMap();
  let frame = 0;
  const byId = id => questions.find(q => String(q.id) === String(id));
  const cardFor = q => document.getElementById(`q-card-${q.id}`) || document.getElementById(`angle-card-${q.id}`);
  const distanceLabel = value => !Number.isFinite(Number(value)) ? '—' : value >= 1000 ? `${(value / 1000).toFixed(1)} km` : `${Math.round(value)} m`;
  const answerFor = q => q.type === 'thermo' ? q.closer : ['matching','measuring'].includes(q.type) ? q.answer : q.zone;
  const pointFor = q => q.center || (q.hiderMode&&['matching','measuring'].includes(q.type) ? {lat:q.seekerLat,lng:q.seekerLng} : {lat:q.lat ?? q.latA,lng:q.lng ?? q.lngA});
  const categoryLocations = q => q.type === 'matching' ? getAllMatchingData()[q.subcat] || [] : q.type === 'measuring' ? getMeasuringLocs(q.subcat) : [];
  const setText = (node, value) => { if (node && node.textContent !== value) node.textContent=value; };
  const typeLabel = q => ({radar:'Radar',thermo:'Thermometer',matching:'Matching',measuring:'Measuring',angle:'Angle'}[q.type] || 'Question');
  const readyToAsk = q => q.type==='radar' ? !!getRadiusMeters(q) : ['matching','measuring'].includes(q.type) ? !!q.nearestId : true;
  const pinOptions = q => q.type==='thermo' ? [['thermoA','Pin A'],['thermoB','Pin B']] : q.type==='angle' ? [['angleCenter','Center'],['angleDirection','Direction']] : [[q.type,'Question pin']];
  const pinPoint = (q,pin) => pin==='thermoB' ? {lat:q.latB,lng:q.lngB} : pin==='thermoA' ? {lat:q.latA,lng:q.lngA} : pin==='angleDirection' ? q.direction : pointFor(q);
  const geometrySignature = q => JSON.stringify([q.type,pointFor(q),q.latA,q.lngA,q.latB,q.lngB,q.direction,q.radius,q.unit,q.nearestId,q.subcat,q.seekerDist,q.angle,q.mode,q.excludeRadius]);
  function publicPins() {
    const colors={radar:'#d78442',thermo:'#c6a92f',matching:'#3da984',measuring:'#3d9dab',angle:'#9a75c2'};
    if(typeof questions==='undefined')return [];
    return questions.filter(q=>Object.hasOwn(colors,q.type)).flatMap(q=>pinOptions(q).flatMap(([pin,name])=>{
      const point=pinPoint(q,pin);if(!point||!validQuestionPoint(point.lat,point.lng))return [];
      return [{id:q.id,type:q.type,pin,label:`${typeLabel(q)} #${q.id} · ${name}`,lat:point.lat,lng:point.lng,color:pin==='thermoB'?'#cf8440':colors[q.type]}];
    }));
  }
  const button = (label, action, className='qe-btn') => {
    const el=document.createElement('button'); el.type='button'; el.className=className; el.textContent=label; el.addEventListener('click',action); return el;
  };

  function overview(q) {
    const answer=answerFor(q) || 'pending';
    const status={pending:'Awaiting answer',inside:'Inside',outside:'Outside',yes:'Same place',no:'Different place',closer:'Closer',further:'Further',A:'Closer to A',B:'Closer to B'}[answer] || 'Awaiting answer';
    let description='', instruction='';
    if(q.type==='radar') {
      description=getRadiusMeters(q) ? `${distanceLabel(getRadiusMeters(q))} radius` : 'Set a radius to begin';
      instruction=!getRadiusMeters(q) ? 'Choose a radius in Pins & settings.' : 'Copy the question, then record Inside or Outside.';
    }
    if(q.type==='thermo') {
      description=`${distanceLabel(map.distance([q.latA,q.lngA],[q.latB,q.lngB]))} between pins A and B`;
      instruction='Copy the question, then record the closer pin.';
    }
    if(q.type==='matching') {
      description=`${q.subcat} · ${q.nearestName || 'No place found at this pin'}`;
      instruction=q.nearestId==='none' ? 'Does the hider also sit outside every area in this category?' : q.nearestId ? 'Does the hider have the same nearest place or containing area?' : 'Move your pin or choose another category in Pins & settings.';
    }
    if(q.type==='measuring') {
      description=`${q.subcat} · ${q.nearestName || 'No place found'}${q.nearestId ? ' · '+distanceLabel(q.seekerDist) : ''}`;
      instruction='Is the hider closer or further from their own nearest place?';
    }
    if(q.type==='angle') {
      const modeLabel={default:'One direction',bidirectional:'Two directions',triple:'Three directions',excludeRadius:'Exclude center'}[q.mode] || q.mode;
      description=`${q.angle}° · ${modeLabel}${q.mode==='excludeRadius' ? ' · '+distanceLabel(q.excludeRadius)+' excluded' : ''}`;
      instruction='Copy the question, then record Inside or Outside the cone.';
    }
    if(q.hiderMode) instruction=getActiveHiderPin() ? 'The answer uses your active hiding pin. Copy only the answer code to the seeker.' : 'Place your hiding pin on the map to calculate the answer.';
    else if(answer!=='pending') instruction='Answer saved · blue is ruled out, clear remains possible.';
    return {status,description,instruction,answer};
  }

  function geometryIcon(q) {
    const colors={radar:'#d78442',thermo:'#b49a30',matching:'#3da984',measuring:'#3d9dab',angle:'#9a75c2'};
    let art='';
    if(q.type==='radar') art='<circle cx="44" cy="36" r="25" fill="currentColor" fill-opacity=".13" stroke="currentColor" stroke-dasharray="4 3"/><circle cx="44" cy="36" r="4" fill="currentColor"/><path d="M44 36H69" stroke="currentColor"/>';
    if(q.type==='thermo') art='<path d="M44 5V67" stroke="currentColor" stroke-dasharray="4 3"/><circle cx="22" cy="36" r="5" fill="#c6a92f"/><circle cx="66" cy="36" r="5" fill="#cf8440"/><text x="22" y="59" text-anchor="middle">A</text><text x="66" y="59" text-anchor="middle">B</text>';
    if(q.type==='matching') art='<path d="M0 0H44L57 36L42 72H0Z" fill="currentColor" fill-opacity=".13"/><path d="M44 0L57 36L42 72M57 36H88" stroke="currentColor" fill="none"/><circle cx="25" cy="36" r="5" fill="currentColor"/><circle cx="68" cy="20" r="3" fill="currentColor"/><circle cx="68" cy="56" r="3" fill="currentColor"/>';
    if(q.type==='measuring') art='<circle cx="27" cy="36" r="22" fill="currentColor" fill-opacity=".13" stroke="currentColor" stroke-dasharray="4 3"/><circle cx="65" cy="36" r="22" fill="currentColor" fill-opacity=".13" stroke="currentColor" stroke-dasharray="4 3"/><circle cx="27" cy="36" r="3" fill="currentColor"/><circle cx="65" cy="36" r="3" fill="currentColor"/>';
    if(q.type==='angle') art='<path d="M16 36L82 7V65Z" fill="currentColor" fill-opacity=".15" stroke="currentColor"/><path d="M16 36H82" stroke="currentColor" stroke-dasharray="4 3"/><circle cx="16" cy="36" r="4" fill="currentColor"/><circle cx="61" cy="36" r="3" fill="currentColor"/>';
    return `<svg viewBox="0 0 88 72" aria-hidden="true" style="color:${colors[q.type] || '#668b9a'}"><g fill="currentColor" font-size="11" font-family="sans-serif">${art}</g></svg>`;
  }

  function makePreview(q) {
    const detail=document.createElement('details'); detail.className='qe-preview';
    const summary=document.createElement('summary'); summary.textContent=['matching','measuring'].includes(q.type) ? 'Explore places & coverage' : 'How this question works'; detail.append(summary);
    const geometry=document.createElement('div'); geometry.className='qe-geometry';
    const icon=document.createElement('div'); icon.className='qe-geometry-icon'; icon.innerHTML=geometryIcon(q); geometry.append(icon);
    const text=document.createElement('div');
    const title=document.createElement('strong'); title.textContent=typeLabel(q);
    const note=document.createElement('p'); note.textContent={radar:'Inside or outside a circle around your pin.',thermo:'Which of two pins is closer to the hider?',matching:'Compare each player’s nearest place or containing area.',measuring:'Compare distances to each player’s own nearest place.',angle:'Inside or outside a cone from the center through the direction pin.'}[q.type];
    text.append(title,note); geometry.append(text); detail.append(geometry);
    const actions=document.createElement('div'); actions.className='qe-actions';
    actions.append(button('Open map inspector',()=>preview(q.id))); detail.append(actions);
    if(['matching','measuring'].includes(q.type)) {
      const label=document.createElement('label'); label.className='qe-search-label'; label.textContent='Find a place in this category';
      const search=document.createElement('input'); search.type='search'; search.placeholder='Search place names'; search.className='qe-place-search'; search.setAttribute('aria-label','Search '+q.subcat+' places');
      search.value=placeSearch.get(String(q.id)) || ''; label.append(search); detail.append(label);
      const count=document.createElement('p'); count.className='qe-place-count'; detail.append(count);
      const list=document.createElement('div'); list.className='qe-places'; detail.append(list);
      search.addEventListener('input',()=>{placeSearch.set(String(q.id),search.value); renderPlaces(q,detail);});
      detail.addEventListener('toggle',()=>{if(detail.open)renderPlaces(q,detail);});
    }
    detail.addEventListener('toggle',()=>{const state=views.get(String(q.id));if(state)state.preview=detail.open;});
    return detail;
  }

  function locationPoint(loc) {
    if(validQuestionPoint(loc.lat,loc.lng))return {lat:loc.lat,lng:loc.lng};
    const ring=(loc.rings && loc.rings[0]) || (loc.segments && loc.segments[0]);
    if(ring && ring.length){const mid=ring[Math.floor(ring.length/2)];return {lat:mid[1],lng:mid[0]};}
    if(loc.rects && loc.rects.length){const rect=loc.rects[0];return {lat:(rect[0][1]+rect[1][1])/2,lng:(rect[0][0]+rect[1][0])/2};}
    return null;
  }

  function focusPlace(loc) {
    if(!map)return;
    if(loc.rings || loc.segments){const lines=loc.rings || loc.segments;const coords=lines.flat().map(p=>[p[1],p[0]]);if(coords.length)map.fitBounds(L.latLngBounds(coords),{padding:[48,48],maxZoom:15,animate:false});}
    else {const p=locationPoint(loc);if(p)map.setView([p.lat,p.lng],15,{animate:false});}
    closeForMap();
    showToast(loc.name || 'Place shown on map');
  }

  function setExpanded(q, expanded, reveal=false) {
    const state=views.get(String(q.id));if(!state)return;
    if(expanded) for(const other of questions) {
      const otherState=views.get(String(other.id));
      if(other!==q && otherState?.expanded){otherState.expanded=false;update(other);}
    }
    state.expanded=expanded;update(q);
    if(reveal)requestAnimationFrame(()=>cardFor(q)?.scrollIntoView({block:'nearest',behavior:'auto'}));
  }

  // Reuse the original answer controls and field handlers. Their ids and DOM
  // ownership remain intact for restore, multiplayer and answer-code imports.
  function organizeBody(q, body) {
    if(!body || body.querySelector('.qe-workflow'))return;
    const workflow=document.createElement('p');workflow.className='qe-workflow';
    const answer=body.querySelector('.zone-toggle,.closer-toggle');
    const answerBlock=answer?.parentElement;
    const copy=body.querySelector('.copy-btn');
    const removals=Array.from(body.querySelectorAll(':scope > .remove-btn,:scope > [id^="remove-row-"]'));
    const fields=Array.from(body.children).filter(node=>node!==answerBlock&&node!==copy&&!removals.includes(node));
    const settings=document.createElement('details');settings.className='qe-adjustments';
    const heading=document.createElement('summary');heading.textContent=q.hiderMode?'Question geometry':'Pins & settings';settings.append(heading);
    const contents=document.createElement('div');contents.className='qe-adjustment-fields';contents.append(...fields);settings.append(contents);
    const state=views.get(String(q.id));settings.open=state?.settings ?? (answerFor(q)==='pending');
    settings.addEventListener('toggle',()=>{const current=views.get(String(q.id));if(current)current.settings=settings.open;});
    body.replaceChildren(workflow);
    if(answerBlock){answerBlock.classList.add('qe-answer-section');const label=answerBlock.querySelector('.q-label');if(label)label.textContent=q.type==='thermo'?'Hider is closer to':q.type==='matching'?'Same nearest place / area?':q.type==='measuring'?'Hider’s distance is':'Hider is';body.append(answerBlock);}
    if(copy){copy.classList.add('qe-send-code');copy.textContent='Copy question code';body.append(copy);}
    body.append(settings,makePreview(q));
    if(removals.length){const more=document.createElement('details');more.className='qe-manage';const heading=document.createElement('summary');heading.textContent='Manage question';more.append(heading,...removals);body.append(more);}
  }

  function renderPlaces(q, detail) {
    const list=detail.querySelector('.qe-places'); if(!list)return;
    const query=(placeSearch.get(String(q.id)) || '').trim().toLocaleLowerCase();
    const pos=pointFor(q);
    const locs=categoryLocations(q);
    const candidates=locs.filter(loc=>!query || String(loc.name).toLocaleLowerCase().includes(query)).map(loc=>{
      const p=locationPoint(loc); const dist=p && validQuestionPoint(pos.lat,pos.lng) ? map.distance([pos.lat,pos.lng],[p.lat,p.lng]) : Infinity;
      return {loc,p,dist};
    }).sort((a,b)=>Number(b.loc.id===q.nearestId)-Number(a.loc.id===q.nearestId)||a.dist-b.dist);
    list.replaceChildren();
    setText(detail.querySelector('.qe-place-count'),candidates.length ? `Showing ${Math.min(candidates.length,12)} of ${candidates.length} places · distance from the question pin` : 'No matching places. Try another name or category.');
    candidates.slice(0,12).forEach(({loc,p,dist})=>{
      const row=document.createElement('div'); row.className='qe-place'+(loc.id===q.nearestId?' nearest':'');
      const info=document.createElement('div'); info.className='qe-place-info';
      const name=document.createElement('strong');name.textContent=loc.name || loc.id;
      const meta=document.createElement('span');
      meta.textContent=loc.type==='polygon' ? 'Area · view boundary' : loc.type ? 'Route · view geometry' : `${distanceLabel(dist)} straight-line${loc.id===q.nearestId?' · Nearest':''}`;
      info.append(name,meta); row.append(info);
      const action=button('Show',()=>focusPlace(loc),'qe-btn qe-place-action'); action.disabled=!p; action.setAttribute('aria-label','Show '+(loc.name || loc.id)+' on map'); row.append(action);
      list.append(row);
    });
  }

  function enhance(q) {
    const card=cardFor(q);if(!card)return;
    let state=views.get(String(q.id));
    if(!state){state={expanded:questions[questions.length-1]===q,preview:false};views.set(String(q.id),state);if(state.expanded)for(const [id,other]of views)if(id!==String(q.id)){other.expanded=false;const item=byId(id);if(item)update(item);}}
    let summary=card.querySelector('.qe-summary');
    if(!summary){
      card.classList.add('qe-card');
      summary=document.createElement('div');summary.className='qe-summary';
      const badge=document.createElement('span');badge.className='qe-status';
      const lock=document.createElement('span');lock.className='qe-lock-state';
      const statusRow=document.createElement('div');statusRow.className='qe-status-row';statusRow.append(badge,lock);
      const description=document.createElement('p');description.className='qe-description';
      const actions=document.createElement('div');actions.className='qe-actions';
      const viewBtn=button('View map',()=>preview(q.id));
      const detailsBtn=button('Edit question',()=>setExpanded(q,!state.expanded,true));detailsBtn.classList.add('qe-details-btn');
      actions.append(viewBtn,detailsBtn);
      if(q.hiderMode){
        const copy=button('Copy answer',()=>copyAnswer(q.id));copy.classList.add('qe-answer-copy');actions.prepend(copy);
      }
      summary.append(statusRow,description,actions);
      const header=card.querySelector('.q-card-header'); if(header)header.after(summary);else card.prepend(summary);
      if(header){const toggle=button('Expand question',()=>setExpanded(q,!state.expanded,true),'qe-card-toggle');toggle.setAttribute('aria-label','Expand '+typeLabel(q)+' question '+q.id);header.append(toggle);}
      if(['matching','measuring'].includes(q.type)) {
        const b=card.querySelector('.q-card-body');
        if(b){b.querySelectorAll('select').forEach(el=>el.setAttribute('aria-label',q.type+' place category'));}
      }
    }
    organizeBody(q,card.querySelector('.q-card-body'));
    const preview=card.querySelector('.qe-preview');if(preview&&state.preview)preview.open=true;
    bindQuestionPins(q);
    update(q);
  }

  function update(q) {
    const card=cardFor(q);if(!card)return;
    const summary=card.querySelector('.qe-summary');if(!summary)return;
    card.classList.remove('collapsed');
    card.querySelectorAll('.q-collapse-summary,.q-collapse-chevron').forEach(el=>el.remove());
    const data=overview(q), state=views.get(String(q.id));
    const explorer=card.querySelector('.qe-preview');
    if(['matching','measuring'].includes(q.type)&&explorer){
      const input=explorer.querySelector('.qe-place-search');
      if(state.category!==undefined&&state.category!==q.subcat){placeSearch.delete(String(q.id));if(input)input.value='';}
      state.category=q.subcat;if(input)input.setAttribute('aria-label','Search '+q.subcat+' places');
      const position=pointFor(q), signature=JSON.stringify([q.subcat,q.nearestId,position.lat,position.lng]);
      if(explorer.open&&state.placeSignature!==signature){renderPlaces(q,explorer);state.placeSignature=signature;}
    }
    setText(summary.querySelector('.qe-description'),data.description);
    summary.querySelector('.qe-description').title=data.description;
    const status=summary.querySelector('.qe-status');setText(status,data.status);status.dataset.state=data.answer;
    setText(summary.querySelector('.qe-lock-state'),q.locked?'Position locked':questionMoveAllowed(q)?'Position editable':'Movement protected');
    card.classList.toggle('qe-expanded',!!state.expanded);
    const body=card.querySelector('.q-card-body');if(body){body.hidden=!state.expanded;setText(body.querySelector('.qe-workflow'),data.instruction);}
    const toggle=summary.querySelector('.qe-details-btn');setText(toggle,state.expanded?'Close editor':q.hiderMode?'Details':'Edit question');toggle.setAttribute('aria-expanded',String(state.expanded));
    const headerToggle=card.querySelector('.qe-card-toggle');if(headerToggle){headerToggle.textContent=state.expanded?'−':'+';headerToggle.setAttribute('aria-label',(state.expanded?'Collapse ':'Expand ')+typeLabel(q)+' question '+q.id);headerToggle.setAttribute('aria-expanded',String(state.expanded));}
    if(body){
      if(!body.id)body.id=`qe-body-${q.id}`;toggle.setAttribute('aria-controls',body.id);
      body.querySelectorAll('input,select,.unit-btn,.aq-mode').forEach(el=>el.disabled=!!q.locked && !q.hiderMode);
      body.querySelectorAll('[onclick*="setMyLocation"]').forEach(el=>{el.disabled=!questionMoveAllowed(q);if(!el.dataset.qeLabel){el.dataset.qeLabel='1';el.textContent=el.textContent.replace('📱 My Loc','Use GPS').replace('📱 Loc A','GPS → A').replace('📱 Loc B','GPS → B');}});
      body.querySelectorAll('.remove-btn').forEach(el=>{el.disabled=!!q.locked&&!q.hiderMode;});
      const removeRow=document.getElementById(`remove-row-${q.id}`);if(removeRow)removeRow.style.display=q.locked?'none':'';
      const input=body.querySelector(`[id="rad-inp-${q.id}"]`);if(input && document.activeElement!==input && input.value!==String(q.radius))input.value=q.radius;
      if(q.type==='radar'){document.getElementById(`unit-m-${q.id}`)?.classList.toggle('active',q.unit==='M');document.getElementById(`unit-km-${q.id}`)?.classList.toggle('active',q.unit==='KM');}
      // The same CSS state is shared by several answers; assign in one pass.
      body.querySelectorAll('.zone-btn,.closer-btn').forEach(el=>{
        const handler=el.getAttribute('onclick') || '';el.classList.remove('active-pend','active-in','active-out','active-a','active-b');
        if(handler.includes(`'${data.answer}'`)){const active={pending:'active-pend',inside:'active-in',outside:'active-out',yes:'active-in',no:'active-out',closer:'active-in',further:'active-out',A:'active-a',B:'active-b'}[data.answer];if(active)el.classList.add(active);}
        el.setAttribute('aria-pressed',String(handler.includes(`'${data.answer}'`)));
        if(!el.dataset.qeLabel){el.dataset.qeLabel='1';const value=['pending','inside','outside','yes','no','closer','further','A','B'].find(value=>handler.includes(`'${value}'`));if(value)el.textContent={pending:'Waiting',inside:'Inside',outside:'Outside',yes:'Same',no:'Different',closer:'Closer',further:'Further',A:'Pin A',B:'Pin B'}[value];}
      });
      const lockPrefix={radar:'lock',thermo:'tlock',matching:'mlock',measuring:'measlock',angle:'aq-lock'}[q.type];
      const lockBtn=document.getElementById(`${lockPrefix}-btn-${q.id}`);if(lockBtn){setText(lockBtn,q.locked?'Unlock position':'Lock position');lockBtn.classList.toggle('locked',!!q.locked);lockBtn.setAttribute('aria-pressed',String(!!q.locked));}
      const nearest=body.querySelector(`[id="match-nearest-${q.id}"],[id="meas-nearest-${q.id}"]`);if(nearest)setText(nearest,q.nearestName || 'No place found');
      const distance=body.querySelector(`[id="meas-dist-${q.id}"]`);if(distance)setText(distance,q.nearestId?distanceLabel(q.seekerDist):'—');
      body.querySelectorAll('.copy-btn').forEach(el=>el.disabled=!readyToAsk(q));
    }
    const copy=summary.querySelector('.qe-answer-copy');if(copy)copy.disabled=data.answer==='pending'||!getActiveHiderPin();
  }

  function bindQuestionPins(q) {
    for(const [key,pin] of [['marker',q.type],['markerA','thermoA'],['markerB','thermoB'],['_centerMarker','angleCenter'],['_dirMarker','angleDirection']]){
      const marker=q[key];if(!marker?.on || markerBindings.has(marker))continue;
      const handler=()=>{if(byId(q.id)===q)preview(q.id,{pin});};
      marker.on('click',handler);marker.on('dragend',schedule);markerBindings.set(marker,handler);
      if(!marker.getTooltip?.())marker.bindTooltip?.(questionEscapeHtml(`${typeLabel(q)} #${q.id}${pin==='thermoA'?' · A':pin==='thermoB'?' · B':''}`),{direction:'top',offset:[0,-14],className:'qe-pin-label'});
      const element=marker.getElement?.();if(element){element.classList.add('qe-question-pin');element.setAttribute('aria-label',`${typeLabel(q)} question ${q.id}, ${pinOptions(q).find(item=>item[0]===pin)?.[1] || 'question pin'}. Open question controls.`);element.setAttribute('title',`${typeLabel(q)} #${q.id} · tap for controls`);}
    }
  }

  function createInspector() {
    if(inspector)return inspector;
    inspector=document.createElement('section');inspector.id='qe-map-inspector';inspector.className='qe-map-inspector';inspector.hidden=true;
    inspector.setAttribute('role','region');inspector.setAttribute('aria-labelledby','qe-inspector-title');
    inspector.innerHTML='<div class="qe-inspector-header"><div><span class="qe-eyebrow">Question on map</span><h2 id="qe-inspector-title"></h2></div></div><div class="qe-inspector-main"><div class="qe-inspector-state"><span class="qe-status"></span><span class="qe-inspector-lock"></span></div><p class="qe-inspector-description"></p><div class="qe-inspector-answer"></div><div class="qe-inspector-actions"></div><details class="qe-pin-tools"><summary>Pin tools</summary><div class="qe-pin-tools-body"></div></details></div>';
    const close=button('×',()=>closeInspector(),'qe-inspector-close');close.setAttribute('aria-label','Close question inspector');inspector.querySelector('.qe-inspector-header').append(close);
    inspector.querySelector('.qe-pin-tools').addEventListener('toggle',()=>{if(!inspector.hidden)inspector.dataset.toolsOpen=String(inspector.querySelector('.qe-pin-tools').open);});
    document.body.append(inspector);return inspector;
  }

  function openInspector(id,pin) {
    const q=byId(id);if(!q)return;
    const changed=String(selectedId)!==String(q.id);selectedId=q.id;
    selectedPin=pinOptions(q).some(item=>item[0]===pin)?pin:changed?pinOptions(q)[0][0]:selectedPin;
    const sheet=createInspector();sheet.hidden=false;document.body.classList.add('qe-inspector-open');
    if(changed){sheet.querySelector('.qe-pin-tools').open=false;sheet.querySelector('.qe-inspector-main').scrollTop=0;}
    closeForMap();updateInspector();
  }

  function closeInspector(restoreFocus=false) {
    if(inspector)inspector.hidden=true;document.body.classList.remove('qe-inspector-open');
    const q=byId(selectedId);selectedId=null;selectedPin=null;clearPreview();
    if(restoreFocus)q&&cardFor(q)?.querySelector('.qe-details-btn')?.focus();
  }

  function editQuestion(id) {
    const q=byId(id);if(!q)return;
    closeInspector();
    if(window.appShell?.open)window.appShell.open('questions',{focus:false});
    else if(!sidebarOpen)toggleSidebar();
    enhance(q);setExpanded(q,true,true);
    requestAnimationFrame(()=>cardFor(q)?.querySelector('.q-card-body button:not(:disabled),.q-card-body input:not(:disabled),.q-card-body select:not(:disabled)')?.focus({preventScroll:true}));
  }

  function copyFromInspector(q) {
    if(!q)return;
    if(q.hiderMode){copyAnswer(q.id);return;}
    if(!readyToAsk(q)){showToast('Finish the question settings first');editQuestion(q.id);return;}
    copyQuestionText(questionCode(q),inspector?.querySelector('.qe-inspector-copy'));
  }

  function answerChoices(q) {
    if(q.type==='thermo')return [['pending','Waiting'],['A','Pin A'],['B','Pin B']];
    if(q.type==='matching')return [['pending','Waiting'],['yes','Same'],['no','Different']];
    if(q.type==='measuring')return [['pending','Waiting'],['closer','Closer'],['further','Further']];
    return [['pending','Waiting'],['inside','Inside'],['outside','Outside']];
  }

  function recordAnswer(id,answer) {
    const q=byId(id);if(!q || q.hiderMode || !answerChoices(q).some(item=>item[0]===answer))return;
    if(answer!=='pending'&&!readyToAsk(q)){showToast('Finish the question settings before recording an answer');return;}
    const action={radar:'setZone',thermo:'setCloser',matching:'setMatchingAnswer',measuring:'setMeasuringAnswer',angle:'setAngleZone'}[q.type];
    if(typeof window[action]==='function')window[action](q.id,answer);
    updateInspector();
  }

  function lockQuestion(q) {
    if(q.hiderMode)return;
    const action={radar:'toggleSeekerLock',thermo:'toggleThermoLock',matching:'toggleMatchingLock',measuring:'toggleMeasuringLock',angle:'toggleAngleLock'}[q.type];
    if(typeof window[action]==='function')window[action](q.id);
    updateInspector();
  }

  function moveInspectorPin(id,pin,position) {
    const q=byId(id);if(!q||q.hiderMode||!pinOptions(q).some(item=>item[0]===pin)||!questionMoveAllowed(q))return false;
    if(!position||!validQuestionPoint(position.lat,position.lng))return false;
    const before=pinPoint(q,pin);if(!before)return false;
    if(Math.abs(before.lat-position.lat)<1e-9&&Math.abs(before.lng-position.lng)<1e-9){showToast('The pin is already at that position');return false;}
    recordPinMove(q,pin,{id:q.id,pin,lat:before.lat,lng:before.lng},position);
    applyPinMove({id:q.id,type:q.type,pin},position);
    sync();showToast('Pin moved · previous answer cleared. Undo is available in the header.');return true;
  }

  function updateInspector() {
    if(selectedId===null||!inspector||inspector.hidden)return;
    const q=byId(selectedId);if(!q){closeInspector();return;}
    const data=overview(q);
    setText(inspector.querySelector('h2'),`${typeLabel(q)} #${q.id}`);
    const status=inspector.querySelector('.qe-status');setText(status,data.status);status.dataset.state=data.answer;
    setText(inspector.querySelector('.qe-inspector-lock'),q.hiderMode?'Seeker’s question':q.locked?'Position locked':questionMoveAllowed(q)?'Position editable':'Movement protected');
    setText(inspector.querySelector('.qe-inspector-description'),data.description);
    const answer=inspector.querySelector('.qe-inspector-answer');
    const contentKey=JSON.stringify([q.id,q.type,!!q.hiderMode]);
    if(answer.dataset.state!==contentKey){
      answer.dataset.state=contentKey;answer.replaceChildren();
      if(q.hiderMode){const note=document.createElement('p');note.className='qe-workflow';answer.append(note);}
      else {
        const label=document.createElement('span');label.className='qe-inspector-answer-label';label.textContent=q.type==='thermo'?'Hider is closer to':q.type==='matching'?'Same place / area?':q.type==='measuring'?'Hider’s distance':'Record hider’s answer';
        const choices=document.createElement('div');choices.className='qe-quick-answer';
        for(const [value,label]of answerChoices(q)){const btn=button(label,()=>recordAnswer(q.id,value),'qe-btn');btn.dataset.answer=value;choices.append(btn);}answer.append(label,choices);
      }
      const actions=inspector.querySelector('.qe-inspector-actions');actions.replaceChildren();
      actions.append(button(q.hiderMode?'Copy answer':'Copy question',()=>copyFromInspector(byId(q.id)),'qe-btn qe-inspector-copy'),button(q.hiderMode?'Question details':'Edit question',()=>editQuestion(q.id),'qe-btn qe-inspector-edit'));
    }
    if(q.hiderMode)setText(answer.querySelector('.qe-workflow'),data.instruction);
    else answer.querySelectorAll('[data-answer]').forEach(btn=>{btn.setAttribute('aria-pressed',String(data.answer===btn.dataset.answer));btn.disabled=btn.dataset.answer!=='pending'&&!readyToAsk(q);});
    const copy=inspector.querySelector('.qe-inspector-copy');copy.disabled=q.hiderMode?data.answer==='pending'||!getActiveHiderPin():!readyToAsk(q);
    // Preserve the pin picker and focus while a GPS response or answer arrives.
    const tools=inspector.querySelector('.qe-pin-tools-body');
    const toolKey=JSON.stringify([q.id,selectedPin,q.locked,questionMoveAllowed(q),q.hiderMode]);
    if(tools.dataset.state!==toolKey){
      tools.dataset.state=toolKey;tools.replaceChildren();
      if(pinOptions(q).length>1){const label=document.createElement('label');label.className='qe-pin-picker';label.textContent='Work with';const select=document.createElement('select');for(const [value,name]of pinOptions(q)){const option=document.createElement('option');option.value=value;option.textContent=name;option.selected=value===selectedPin;select.append(option);}select.addEventListener('change',()=>{selectedPin=select.value;updateInspector();});label.append(select);tools.append(label);}
      const row=document.createElement('div');row.className='qe-pin-action-grid';
      row.append(button('Show all pins',()=>preview(q.id)),button('Center this pin',()=>{const pos=pinPoint(q,selectedPin);if(pos&&validQuestionPoint(pos.lat,pos.lng))map.setView([pos.lat,pos.lng],Math.max(map.getZoom(),15),{animate:false});}));
      if(!q.hiderMode){
        row.append(button(q.locked?'Unlock position':'Lock position',()=>lockQuestion(q)));
        const gps=button('Use GPS for pin',()=>{const id=q.id,pin=selectedPin;_getGPS((lat,lng)=>{if(byId(id)===q&&moveInspectorPin(id,pin,{lat,lng}))preview(id,{pin});});});gps.disabled=!questionMoveAllowed(q);row.append(gps);
        const center=button('Place at map center',()=>{const position=map.getCenter();moveInspectorPin(q.id,selectedPin,{lat:position.lat,lng:position.lng});});center.disabled=!questionMoveAllowed(q);row.append(center);
        if(!q.locked&&!questionMoveAllowed(q))row.append(button('Allow moving for 60s',()=>{openMoveWindow(q.id);updateInspector();}));
      }
      tools.append(row);
      const note=document.createElement('p');note.className='qe-workflow';note.textContent=q.hiderMode?'These are the seeker’s public question pins. Your hiding location is never included.':'Moving a pin clears its previous answer. Lock positions to prevent accidental drags.';tools.append(note);
    }
  }

  function clearPreview() {
    if(previewId!==null && typeof _anglePreviewQuestionId!=='undefined' && _anglePreviewQuestionId===previewId){_anglePreviewLayer?.clearLayers();clearTimeout(_anglePreviewTimer);}
    if(previewLayer){previewLayer.clearLayers();if(map.hasLayer(previewLayer))map.removeLayer(previewLayer);previewLayer=null;}
    previewId=null;previewSignature='';
  }

  function closeForMap() {
    if(window.lampskeneShell?.closePanels)window.lampskeneShell.closePanels();
    else if(window.appShell?.close)window.appShell.close({restoreFocus:false});
    else if(window.matchMedia('(max-width:768px)').matches && sidebarOpen)toggleSidebar();
  }

  function preview(id,options={}) {
    const q=byId(id);if(!q || !map)return;
    clearPreview();previewId=q.id;previewSignature=geometrySignature(q);previewLayer=L.layerGroup().addTo(map);
    const style={color:'#16879a',weight:2,dashArray:'6 4',fillColor:'#16879a',fillOpacity:.06,interactive:false};
    const points=[], pos=pointFor(q);
    const pin=(p,label,key)=>{if(!p||!validQuestionPoint(p.lat,p.lng))return;points.push([p.lat,p.lng]);L.circleMarker([p.lat,p.lng],{radius:8,color:'#fff',weight:2,fillColor:'#16879a',fillOpacity:1,interactive:true,bubblingMouseEvents:false}).bindTooltip(questionEscapeHtml(label),{permanent:false,direction:'top'}).on('click',()=>openInspector(q.id,key)).addTo(previewLayer);};
    if(q.type==='radar') {
      pin(pos,'Radar center'); const radius=getRadiusMeters(q);
      if(radius){const c=L.circle([pos.lat,pos.lng],{...style,radius}).addTo(previewLayer);points.push(c.getBounds().getNorthEast(),c.getBounds().getSouthWest());}
    } else if(q.type==='thermo') {
      pin({lat:q.latA,lng:q.lngA},'Pin A','thermoA');pin({lat:q.latB,lng:q.lngB},'Pin B','thermoB');
      L.polyline([[q.latA,q.lngA],[q.latB,q.lngB]],style).addTo(previewLayer);
    } else if(q.type==='angle') {
      pin(q.center,'Center','angleCenter');pin(q.direction,'Direction','angleDirection');
      L.polyline([[q.center.lat,q.center.lng],[q.direction.lat,q.direction.lng]],style).addTo(previewLayer);showAnglePreview(q,3600000);
    } else {
      pin(pos,q.hiderMode?'Seeker’s question pin':'Your question pin');
      const loc=categoryLocations(q).find(item=>item.id===q.nearestId);
      if(loc){
        if(loc.rings)L.polygon(loc.rings.map(ring=>ring.map(p=>[p[1],p[0]])),style).addTo(previewLayer);
        else if(loc.rects)loc.rects.forEach(rect=>L.rectangle([[rect[0][1],rect[0][0]],[rect[1][1],rect[1][0]]],style).addTo(previewLayer));
        else if(loc.segments)L.polyline(loc.segments.map(line=>line.map(p=>[p[1],p[0]])),style).addTo(previewLayer);
        else {const p=locationPoint(loc);if(p){pin(p,loc.name);L.polyline([[pos.lat,pos.lng],[p.lat,p.lng]],style).addTo(previewLayer);}}
        if(q.type==='measuring')categoryLocations(q).filter(item=>item.id===q.nearestId).forEach(item=>{const p=locationPoint(item);if(p && q.seekerDist>0){const c=L.circle([p.lat,p.lng],{...style,radius:q.seekerDist}).addTo(previewLayer);points.push(c.getBounds().getNorthEast(),c.getBounds().getSouthWest());}});
      }
    }
    if(options.open!==false)openInspector(q.id,options.pin);
    if(points.length&&options.fit!==false){const height=inspector&&!inspector.hidden?Math.min(inspector.getBoundingClientRect().height,Math.max(0,map.getSize().y*.48)):0;map.fitBounds(L.latLngBounds(points),{paddingTopLeft:[32,32],paddingBottomRight:[32,Math.max(40,height+16)],maxZoom:15,animate:false});}
  }

  function copyAnswer(id) {
    const q=byId(id);if(!q || !q.hiderMode || !getActiveHiderPin())return;
    const answer=answerFor(q);if(!answer || answer==='pending'){showToast('Place your hiding pin to calculate an answer');return;}
    copyQuestionText(questionCode(q,true),cardFor(q)?.querySelector('.qe-answer-copy'));
  }

  function sync() {
    frame=0;if(typeof questions==='undefined')return;
    questions.forEach(enhance);
    for(const name of ['hider','endgame']){
      const card=document.getElementById(name==='hider'?'hider-loc-card':'endgame-card');if(!card)continue;
      card.classList.add('qe-card');
      const body=card.querySelector('.q-card-body');
      if(body && !body.querySelector('.qe-location-note')){const note=document.createElement('p');note.className='qe-next qe-location-note';note.textContent=name==='hider'?'Place and lock your hiding pin. The cards below calculate answers; share their answer codes with the seeker.':'The endgame pin replaces the hiding pin when calculating every question answer.';body.prepend(note);}
      const placed=name==='hider'?!!hiderPin:!!endgamePin;
      const locked=name==='hider'?hiderPinLocked:endgamePinLocked;
      const go=document.getElementById(`${name}-goto-btn`),lock=document.getElementById(`${name}-lock-btn`);
      if(go)go.disabled=!placed;if(lock){lock.disabled=!placed;setText(lock,locked?'Unlock position':'Lock position');lock.setAttribute('aria-pressed',String(locked));}
    }
    if(previewId!==null && !byId(previewId))clearPreview();
    if(previewId!==null){const current=byId(previewId);if(current&&previewSignature!==geometrySignature(current))preview(current.id,{open:false,fit:false});}
    updateInspector();
    for(const id of views.keys())if(!byId(id)){views.delete(id);placeSearch.delete(id);}
    const list=document.getElementById('question-list');if(list && !questions.length && mode==='seeker' && !list.querySelector('.qe-empty')){
      const empty=document.createElement('div');empty.className='qe-empty';empty.innerHTML='<strong>Your next clue starts here</strong><ol><li>Add a question below.</li><li>Place its pins and copy the code.</li><li>Record or import the hider’s answer.</li></ol><p>Blue is ruled out. Clear areas remain possible. Tap any question pin for quick controls.</p>';list.append(empty);
    }
    if(questions.length)document.querySelectorAll('.qe-empty').forEach(el=>el.remove());
    if(typeof _updateQuestionTools==='function')_updateQuestionTools();
  }
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(sync);};
  const hooks=['addQuestion','addMatchingQuestion','addMeasuringQuestion','addAngleQuestion','setZone','setCloser','setMatchingAnswer','setMeasuringAnswer','setAngleZone','onRadiusChange','setUnit','toggleSeekerLock','toggleThermoLock','toggleMatchingLock','toggleMeasuringLock','toggleAngleLock','toggleHiderLock','toggleEndgameLock','setMoveLockEnabled','openMoveWindow','applyQuestionMoveLocks','setMatchingSubcat','setMeasuringSubcat','setAngleQuestionAngle','setAngleQuestionMode','setAngleExcludeRadius','applyPinMove','recordPinMove','placeSeekerPin','placeThermoPin','placeSeekerMatchingPin','placeSeekerMeasuringPin','angleQuestionSetupMap','placeHiderPin','placeEndgamePin','checkAllHiderRadars','checkHiderRadar','checkHiderThermo','checkHiderMatching','checkHiderMeasuring','checkHiderAngle','decodeAndAdd','seekerDecodeAndAdd','removeQuestion','removeAngleQuestion','restoreState','switchMode','chooseMode','updateMatchingNearest','updateMeasuringNearest','_startEndgame','_endgameExitLocal'];
  hooks.forEach(name=>{const original=window[name];if(typeof original!=='function')return;window[name]=function(...args){const result=original.apply(this,args);sync();return result;};});
  for(const name of ['renderAngleCard','renderSeekerRadarCard','renderSeekerThermoCard','renderSeekerMatchingCard','renderSeekerMeasuringCard','renderHiderRadarCard','renderHiderThermoCard','renderHiderMatchingCard','renderHiderMeasuringCard','renderHiderAngleCard']) {
    const render=window[name];if(typeof render==='function')window[name]=function(q){const result=render(q);enhance(q);return result;};
  }
  ['goToHiderPin','goToSeekerPin','goToThermoPin','goToAnglePin','goToEndgamePin'].forEach(name=>{
    const original=window[name];if(typeof original!=='function')return;
    window[name]=function(...args){const result=original.apply(this,args);closeForMap();return result;};
  });
  // Legacy hider cards focus their public question coordinates inline.
  document.addEventListener('click',e=>{if(e.target instanceof Element && e.target.closest('.q-card .go-btn'))closeForMap();});
  // Keep legacy restore/multiplayer summary entrypoints on the same card UI.
  if(typeof window._qRefreshSummary==='function')window._qRefreshSummary=schedule;
  if(typeof window._qAutoCollapse==='function')window._qAutoCollapse=schedule;
  if(typeof window.toggleQuestionCollapse==='function')window.toggleQuestionCollapse=id=>{const q=byId(id),state=views.get(String(id));if(q&&state)setExpanded(q,!state.expanded);};
  if(typeof window._qSetCollapsed==='function')window._qSetCollapsed=(q,collapsed)=>{enhance(q);setExpanded(q,!collapsed);};
  const list=document.getElementById('question-list');
  if(list){
    new MutationObserver(records=>{if(records.some(record=>record.type==='childList' && record.target===list))schedule();}).observe(list,{childList:true});
    list.addEventListener('click',e=>{const header=e.target instanceof Element?e.target.closest('.q-card-header'):null;if(!header||e.target.closest('button,input,select'))return;const card=header.closest('.qe-card');if(!card)return;const id=card.id.replace(/^(?:q|angle)-card-/,'');const q=byId(id),state=views.get(String(id));if(q&&state){e.stopImmediatePropagation();setExpanded(q,!state.expanded,true);}},true);
  }
  document.addEventListener('input',e=>{if(e.target.closest('.q-card'))schedule();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&inspector&&!inspector.hidden){closeInspector();e.preventDefault();}});
  document.addEventListener('jetlag:rolechange',()=>closeInspector());
  window.lampskeneQuestions={sync:schedule,preview,clearPreview,copyAnswer,focusPlace,inspect:openInspector,closeInspector,edit:editQuestion,publicPins};
  schedule();
})();
