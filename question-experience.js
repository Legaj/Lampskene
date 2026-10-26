/* Practical question cards. All map previews use public question positions. */
(() => {
  'use strict';
  const views = new Map();
  const placeSearch = new Map();
  let previewLayer = null, previewId = null, previewSignature = '';
  let selectedId = null, selectedPin = null, inspector = null;
  const markerBindings = new WeakMap();
  let frame = 0;
  let showCoordinates = false;
  try { showCoordinates = window.localStorage?.getItem('lampskene_question_coordinates') === 'true'; } catch (_) {}
  const byId = id => questions.find(q => String(q.id) === String(id));
  const cardFor = q => document.getElementById(`q-card-${q.id}`) || document.getElementById(`angle-card-${q.id}`);
  const distanceLabel = value => !Number.isFinite(Number(value)) ? '—' : value >= 1000 ? `${(value / 1000).toFixed(1)} km` : `${Math.round(value)} m`;
  const answerFor = q => q.type === 'thermo' ? q.closer : ['matching','measuring'].includes(q.type) ? q.answer : q.zone;
  const pointFor = q => q.center || (q.hiderMode&&['matching','measuring'].includes(q.type) ? {lat:q.seekerLat,lng:q.seekerLng} : {lat:q.lat ?? q.latA,lng:q.lng ?? q.lngA});
  const categoryLocations = q => q.type === 'matching' ? getAllMatchingData()[q.subcat] || [] : q.type === 'measuring' ? getMeasuringLocs(q.subcat) : [];
  const setText = (node, value) => { if (node && node.textContent !== value) node.textContent=value; };
  const typeLabel = q => ({radar:'Radar',thermo:'Thermometer',matching:'Matching',measuring:'Measuring',angle:'Angle'}[q.type] || 'Question');
  const shortType = q => ({radar:'Radar',thermo:'Thermo',matching:'Match',measuring:'Measure',angle:'Angle'}[q.type] || 'Question');
  const icons = {
    radar:'<circle cx="12" cy="12" r="8"/><path d="M12 4v8l6-4"/><circle cx="12" cy="12" r="2"/>',
    thermo:'<path d="M8 5v10a4 4 0 1 0 8 0V5a4 4 0 0 0-8 0Z"/><path d="M12 8v10"/>',
    matching:'<path d="m9 15 6-6m-5-2 2-2a5 5 0 0 1 7 7l-2 2m-3 3-2 2a5 5 0 0 1-7-7l2-2"/>',
    measuring:'<path d="m4 15 11-11 5 5L9 20H4v-5Z"/><path d="m10 9 2 2m2-6 2 2m-10 6 2 2"/>',
    angle:'<path d="M4 18 20 5M4 18h16M11 18a7 7 0 0 0-2-5"/>',
    map:'<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15"/>',
  };
  const iconMarkup = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.radar}</svg>`;
  const readyToAsk = q => q.type==='radar' ? !!getRadiusMeters(q) : ['matching','measuring'].includes(q.type) ? !!q.nearestId : true;
  const pinOptions = q => q.type==='thermo' ? [['thermoA','Pin A'],['thermoB','Pin B']] : q.type==='angle' ? [['angleCenter','Center'],['angleDirection','Direction']] : [[q.type,'Question pin']];
  const pinPoint = (q,pin) => pin==='thermoB' ? {lat:q.latB,lng:q.lngB} : pin==='thermoA' ? {lat:q.latA,lng:q.lngA} : pin==='angleDirection' ? q.direction : pointFor(q);
  const geometrySignature = q => JSON.stringify([q.type,pointFor(q),q.latA,q.lngA,q.latB,q.lngB,q.direction,q.radius,q.unit,q.nearestId,q.subcat,q.seekerDist,q.angle,q.mode,q.excludeRadius,q.locked,typeof _hideLockedPins !== 'undefined' && _hideLockedPins]);
  function publicPins() {
    const colors={radar:'#d78442',thermo:'#c6a92f',matching:'#3da984',measuring:'#3d9dab',angle:'#9a75c2'};
    if(typeof questions==='undefined')return [];
    return questions.filter(q=>Object.hasOwn(colors,q.type) && !(q.locked && typeof _hideLockedPins !== 'undefined' && _hideLockedPins)).flatMap(q=>pinOptions(q).flatMap(([pin,name])=>{
      const point=pinPoint(q,pin);if(!point||!validQuestionPoint(point.lat,point.lng))return [];
      return [{id:q.id,type:q.type,pin,label:`${typeLabel(q)} #${q.id} · ${name}`,lat:point.lat,lng:point.lng,color:pin==='thermoB'?'#cf8440':colors[q.type]}];
    }));
  }
  const button = (label, action, className='qe-btn') => {
    const el=document.createElement('button'); el.type='button'; el.className=className; el.textContent=label; el.addEventListener('click',action); return el;
  };

  function overview(q) {
    const answer=answerFor(q) || 'pending';
    const status={pending:'Pending',inside:'Inside',outside:'Outside',yes:'Same',no:'Different',closer:'Closer',further:'Further',A:'Pin A',B:'Pin B'}[answer] || 'Pending';
    let description='', instruction='';
    if(q.type==='radar') {
      description=getRadiusMeters(q) ? `${distanceLabel(getRadiusMeters(q))} radius` : 'Set radius';
      instruction=!getRadiusMeters(q) ? 'Set radius' : '';
    }
    if(q.type==='thermo') {
      description=`A ↔ B · ${distanceLabel(map.distance([q.latA,q.lngA],[q.latB,q.lngB]))}`;
    }
    if(q.type==='matching') {
      description=`${q.subcat} · ${q.nearestName || 'No place found at this pin'}`;
      instruction=q.nearestId ? '' : 'Choose a category or move pin';
    }
    if(q.type==='measuring') {
      description=`${q.subcat} · ${q.nearestName || 'No place found'}${q.nearestId ? ' · '+distanceLabel(q.seekerDist) : ''}`;
      instruction=q.nearestId ? '' : 'Choose a category or move pin';
    }
    if(q.type==='angle') {
      const modeLabel={default:'Single',bidirectional:'Double',triple:'Triple',excludeRadius:'Exclude center'}[q.mode] || q.mode;
      description=`${q.angle}° · ${modeLabel}${q.mode==='excludeRadius' ? ' · '+distanceLabel(q.excludeRadius)+' excluded' : ''}`;
    }
    if(q.hiderMode) instruction=getActiveHiderPin() ? '' : 'Place hiding pin';
    return {status,description,instruction,answer};
  }

  function makePreview(q) {
    if(!['matching','measuring'].includes(q.type))return null;
    const detail=document.createElement('details'); detail.className='qe-preview';
    const summary=document.createElement('summary'); summary.textContent='Places'; detail.append(summary);
    const search=document.createElement('input'); search.type='search'; search.placeholder='Find place'; search.className='qe-place-search'; search.setAttribute('aria-label','Search '+q.subcat+' places');
    search.value=placeSearch.get(String(q.id)) || ''; detail.append(search);
    const count=document.createElement('p'); count.className='qe-place-count'; detail.append(count);
    const list=document.createElement('div'); list.className='qe-places'; detail.append(list);
    search.addEventListener('input',()=>{placeSearch.set(String(q.id),search.value); renderPlaces(q,detail);});
    detail.addEventListener('toggle',()=>{if(detail.open)renderPlaces(q,detail);const state=views.get(String(q.id));if(state)state.preview=detail.open;});
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
    if(!body || body.querySelector('.qe-adjustment-fields'))return;
    const answer=body.querySelector('.zone-toggle,.closer-toggle');
    const answerBlock=answer?.parentElement;
    const copy=body.querySelector('.copy-btn');
    const removals=Array.from(body.querySelectorAll(':scope > .remove-btn,:scope > [id^="remove-row-"]'));
    const fields=Array.from(body.children).filter(node=>node!==answerBlock&&node!==copy&&!removals.includes(node));
    const contents=document.createElement('div');contents.className='qe-adjustment-fields';
    const pins=document.createElement('div');pins.className='qe-pin-actions';
    const coords=document.createElement('details');coords.className='qe-coordinates';
    const heading=document.createElement('summary');heading.textContent='Coordinates';coords.append(heading);
    const coordinates=document.createElement('div');coordinates.className='qe-coordinate-values';coords.append(coordinates);
    for(const field of fields){
      if(field.classList.contains('icon-btns')){pins.append(...Array.from(field.children));continue;}
      if(field.matches('.coord-disp') || (field.matches('.q-label')&&/position/i.test(field.textContent)) || field.querySelector('.coord-disp,.thermo-dist,[id^="match-nearest-"],[id^="meas-nearest-"],[id^="meas-dist-"]') || /^(match-dist|match-note)-/.test(field.id))coordinates.append(field);
      else contents.append(field);
    }
    body.replaceChildren(contents);
    if(pins.children.length)contents.append(pins);
    if(coordinates.children.length)contents.append(coords);
    const places=makePreview(q);if(places)body.append(places);
    if(removals.length){const manage=document.createElement('div');manage.className='qe-manage';manage.append(...removals);body.append(manage);}
    const summary=cardFor(q).querySelector('.qe-summary');
    const controls=document.createElement('div');controls.className='qe-compact-controls';
    if(answer){
      answer.classList.add('qe-inline-answer');answer.setAttribute('role','group');answer.setAttribute('aria-label',typeLabel(q)+' answer');
      controls.append(answer);
    }
    if(copy){copy.classList.add('qe-send-code');copy.textContent='Copy';copy.title='Copy question code';copy.setAttribute('aria-label','Copy '+typeLabel(q)+' question '+q.id+' code');controls.append(copy);}
    if(q.hiderMode){const copyAnswerButton=button('Copy',()=>copyAnswer(q.id),'qe-btn qe-answer-copy');copyAnswerButton.title='Copy answer code';copyAnswerButton.setAttribute('aria-label','Copy '+typeLabel(q)+' answer '+q.id);controls.append(copyAnswerButton);}
    const view=button('',()=>preview(q.id),'qe-btn qe-map-btn');view.innerHTML=iconMarkup('map');view.title='Show on map';view.setAttribute('aria-label','Show '+typeLabel(q)+' question '+q.id+' on map');controls.append(view);
    summary.append(controls);
    for(const el of contents.querySelectorAll('.icon-btn')){
      const action=el.getAttribute('onclick') || '';
      if(action.includes('goToThermoPin'))el.textContent=action.includes("'A'")?'Pin A':'Pin B';
      else if(action.includes('goToAnglePin'))el.textContent=action.includes("'center'")?'Center':'Direction';
      else if(action.includes('goToSeekerPin'))el.textContent='Pin';
      else if(action.includes('setMyLocation_thermo'))el.textContent=action.includes('thermoA')?'GPS A':'GPS B';
      else if(action.includes('setMyLocation'))el.textContent='GPS';
      else if(action.includes('toggleThermoBorder'))el.textContent='Boundary';
      else if(action.includes('toggleMatchingVoronoi'))el.textContent='Borders';
      else if(action.includes('openMoveWindow'))el.textContent='Move 60s';
      el.title=el.textContent;
    }
    for(const el of contents.querySelectorAll('.aq-mode')){
      const action=el.getAttribute('onclick') || '';
      el.textContent=action.includes("'bidirectional'")?'Double':action.includes("'triple'")?'Triple':action.includes("'excludeRadius'")?'Exclude':'Single';
      el.parentElement.classList.add('qe-angle-modes');
    }
    body.querySelectorAll('.remove-btn').forEach(el=>{el.textContent='Delete';el.setAttribute('aria-label','Delete '+typeLabel(q)+' question '+q.id);});
    body.querySelectorAll('input,select').forEach(el=>{
      if(!el.getAttribute('aria-label'))el.setAttribute('aria-label',el.closest('div')?.querySelector('.q-label')?.textContent || (q.type==='angle'?'Angle in degrees':'Question setting'));
    });
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
    setText(detail.querySelector('.qe-place-count'),candidates.length ? `${Math.min(candidates.length,12)} / ${candidates.length}` : 'No places found');
    candidates.slice(0,12).forEach(({loc,p,dist})=>{
      const row=document.createElement('div'); row.className='qe-place'+(loc.id===q.nearestId?' nearest':'');
      const info=document.createElement('div'); info.className='qe-place-info';
      const name=document.createElement('strong');name.textContent=loc.name || loc.id;
      const meta=document.createElement('span');
      meta.textContent=loc.type==='polygon' ? 'Area' : loc.type ? 'Route' : `${distanceLabel(dist)}${loc.id===q.nearestId?' · Nearest':''}`;
      info.append(name,meta); row.append(info);
      const action=button('Show',()=>focusPlace(loc),'qe-btn qe-place-action'); action.disabled=!p; action.setAttribute('aria-label','Show '+(loc.name || loc.id)+' on map'); row.append(action);
      list.append(row);
    });
  }

  function enhance(q) {
    const card=cardFor(q);if(!card)return;
    let state=views.get(String(q.id));
    if(!state){state={expanded:questions[questions.length-1]===q,preview:false};views.set(String(q.id),state);if(state.expanded)for(const [id,other]of views)if(id!==String(q.id)){other.expanded=false;const item=byId(id);if(item)update(item);}}
    if(!card.querySelector('.qe-summary')){
      card.classList.add('qe-card');
      const summary=document.createElement('div');summary.className='qe-summary';
      const description=document.createElement('p');description.className='qe-description';summary.append(description);
      const header=card.querySelector('.q-card-header');
      if(header){
        const title=header.querySelector('.q-title');if(title){title.textContent=shortType(q);title.title=typeLabel(q);}
        const originalIcon=header.firstElementChild;if(originalIcon&&!originalIcon.classList.contains('q-title'))originalIcon.remove();
        const glyph=document.createElement('span');glyph.className='qe-type-icon';glyph.innerHTML=iconMarkup(q.type);header.prepend(glyph);
        const badge=document.createElement('span');badge.className='qe-status';header.append(badge);
        const toggle=button('',()=>setExpanded(q,!state.expanded,true),'qe-card-toggle qe-details-btn');header.append(toggle);header.after(summary);
      }else card.prepend(summary);
      if(['matching','measuring'].includes(q.type))card.querySelectorAll('select').forEach(el=>el.setAttribute('aria-label',q.type+' place category'));
    }
    organizeBody(q,card.querySelector('.q-card-body'));
    const explorer=card.querySelector('.qe-preview');if(explorer&&state.preview)explorer.open=true;
    bindQuestionPins(q);update(q);
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
    const status=card.querySelector('.qe-status');setText(status,data.status);status.dataset.state=data.answer;
    status.title=q.locked?'Position locked':questionMoveAllowed(q)?'Position editable':'Movement protected';
    card.classList.toggle('qe-locked',!!q.locked);
    card.classList.toggle('qe-expanded',!!state.expanded);
    const body=card.querySelector('.q-card-body');if(body){body.hidden=!state.expanded;setText(body.querySelector('.qe-workflow'),data.instruction);}
    const toggle=card.querySelector('.qe-details-btn');toggle.setAttribute('aria-expanded',String(state.expanded));
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
      card.querySelectorAll('.zone-btn,.closer-btn').forEach(el=>{
        const handler=el.getAttribute('onclick') || '';el.classList.remove('active-pend','active-in','active-out','active-a','active-b');
        if(handler.includes(`'${data.answer}'`)){const active={pending:'active-pend',inside:'active-in',outside:'active-out',yes:'active-in',no:'active-out',closer:'active-in',further:'active-out',A:'active-a',B:'active-b'}[data.answer];if(active)el.classList.add(active);}
        el.setAttribute('aria-pressed',String(handler.includes(`'${data.answer}'`)));
        const value=['pending','inside','outside','yes','no','closer','further','A','B'].find(value=>handler.includes(`'${value}'`));
        if(value){el.textContent={pending:'—',inside:'Inside',outside:'Outside',yes:'Same',no:'Diff.',closer:'Closer',further:'Further',A:'A',B:'B'}[value];el.title={pending:'Clear answer',A:'Closer to pin A',B:'Closer to pin B',yes:'Same place or area',no:'Different place or area'}[value] || el.textContent;el.setAttribute('aria-label',el.title);}
        el.disabled=value!=='pending'&&!readyToAsk(q);
      });
      const lockPrefix={radar:'lock',thermo:'tlock',matching:'mlock',measuring:'measlock',angle:'aq-lock'}[q.type];
      const lockBtn=document.getElementById(`${lockPrefix}-btn-${q.id}`);if(lockBtn){setText(lockBtn,q.locked?'Unlock':'Lock');lockBtn.classList.toggle('locked',!!q.locked);lockBtn.setAttribute('aria-pressed',String(!!q.locked));}
      for(const [prefix,on,label] of [['tborder',typeof thermoBorderVisible==='function'?thermoBorderVisible(q):q.thermoBorder,'Boundary'],['mvoronoi',q.showVoronoi,'Borders']]){
        const control=document.getElementById(`${prefix}-btn-${q.id}`);if(control){setText(control,label);control.setAttribute('aria-pressed',String(!!on));}
      }
      const nearest=body.querySelector(`[id="match-nearest-${q.id}"],[id="meas-nearest-${q.id}"]`);if(nearest)setText(nearest,q.nearestName || 'No place found');
      const distance=body.querySelector(`[id="meas-dist-${q.id}"]`);if(distance)setText(distance,q.nearestId?distanceLabel(q.seekerDist):'—');
      card.querySelectorAll('.copy-btn').forEach(el=>el.disabled=!readyToAsk(q));
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
    inspector.innerHTML='<div class="qe-inspector-header"><div><h2 id="qe-inspector-title"></h2></div></div><div class="qe-inspector-main"><div class="qe-inspector-state"><span class="qe-status"></span><span class="qe-inspector-lock"></span></div><p class="qe-inspector-description"></p><div class="qe-inspector-answer"></div><div class="qe-inspector-actions"></div><details class="qe-pin-tools"><summary>Pin tools</summary><div class="qe-pin-tools-body"></div></details></div>';
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
    if(q.type==='thermo')return [['pending','Clear'],['A','A'],['B','B']];
    if(q.type==='matching')return [['pending','Clear'],['yes','Same'],['no','Diff.']];
    if(q.type==='measuring')return [['pending','Clear'],['closer','Closer'],['further','Further']];
    return [['pending','Clear'],['inside','Inside'],['outside','Outside']];
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
    setText(inspector.querySelector('.qe-inspector-lock'),q.hiderMode?'Seeker pin':q.locked?'Locked':questionMoveAllowed(q)?'Movable':'Protected');
    setText(inspector.querySelector('.qe-inspector-description'),data.description);
    const answer=inspector.querySelector('.qe-inspector-answer');
    const contentKey=JSON.stringify([q.id,q.type,!!q.hiderMode]);
    if(answer.dataset.state!==contentKey){
      answer.dataset.state=contentKey;answer.replaceChildren();
      if(q.hiderMode){const note=document.createElement('p');note.className='qe-workflow';answer.append(note);}
      else {
        const label=document.createElement('span');label.className='qe-inspector-answer-label';label.textContent='Answer';
        const choices=document.createElement('div');choices.className='qe-quick-answer';
        for(const [value,label]of answerChoices(q)){const btn=button(label,()=>recordAnswer(q.id,value),'qe-btn');btn.dataset.answer=value;choices.append(btn);}answer.append(label,choices);
      }
      const actions=inspector.querySelector('.qe-inspector-actions');actions.replaceChildren();
      actions.append(button(q.hiderMode?'Copy answer':'Copy question',()=>copyFromInspector(byId(q.id)),'qe-btn qe-inspector-copy'),button('Edit',()=>editQuestion(q.id),'qe-btn qe-inspector-edit'));
    }
    if(q.hiderMode)setText(answer.querySelector('.qe-workflow'),data.instruction);
    else answer.querySelectorAll('[data-answer]').forEach(btn=>{btn.setAttribute('aria-pressed',String(data.answer===btn.dataset.answer));btn.disabled=btn.dataset.answer!=='pending'&&!readyToAsk(q);});
    const copy=inspector.querySelector('.qe-inspector-copy');copy.disabled=q.hiderMode?data.answer==='pending'||!getActiveHiderPin():!readyToAsk(q);
    // Preserve the pin picker and focus while a GPS response or answer arrives.
    const tools=inspector.querySelector('.qe-pin-tools-body');
    const toolKey=JSON.stringify([q.id,selectedPin,q.locked,questionMoveAllowed(q),q.hiderMode]);
    if(tools.dataset.state!==toolKey){
      tools.dataset.state=toolKey;tools.replaceChildren();
      if(pinOptions(q).length>1){const label=document.createElement('label');label.className='qe-pin-picker';label.textContent='Pin';const select=document.createElement('select');for(const [value,name]of pinOptions(q)){const option=document.createElement('option');option.value=value;option.textContent=name;option.selected=value===selectedPin;select.append(option);}select.addEventListener('change',()=>{selectedPin=select.value;updateInspector();});label.append(select);tools.append(label);}
      const row=document.createElement('div');row.className='qe-pin-action-grid';
      row.append(button('All pins',()=>preview(q.id)),button('Center',()=>{const pos=pinPoint(q,selectedPin);if(pos&&validQuestionPoint(pos.lat,pos.lng))map.setView([pos.lat,pos.lng],Math.max(map.getZoom(),15),{animate:false});}));
      if(!q.hiderMode){
        row.append(button(q.locked?'Unlock':'Lock',()=>lockQuestion(q)));
        const gps=button('GPS',()=>{const id=q.id,pin=selectedPin;_getGPS((lat,lng)=>{if(byId(id)===q&&moveInspectorPin(id,pin,{lat,lng}))preview(id,{pin});});});gps.disabled=!questionMoveAllowed(q);row.append(gps);
        const center=button('Map center',()=>{const position=map.getCenter();moveInspectorPin(q.id,selectedPin,{lat:position.lat,lng:position.lng});});center.disabled=!questionMoveAllowed(q);row.append(center);
        if(q.type!=='radar'&&!q.locked&&!questionMoveAllowed(q))row.append(button('Move 60s',()=>{openMoveWindow(q.id);updateInspector();}));
      }
      tools.append(row);
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
    const pin=(p,label,key)=>{if(!p||!validQuestionPoint(p.lat,p.lng))return;points.push([p.lat,p.lng]);if(q.locked && typeof _hideLockedPins !== 'undefined' && _hideLockedPins)return;L.circleMarker([p.lat,p.lng],{radius:8,color:'#fff',weight:2,fillColor:'#16879a',fillOpacity:1,interactive:true,bubblingMouseEvents:false}).bindTooltip(questionEscapeHtml(label),{permanent:false,direction:'top'}).on('click',()=>openInspector(q.id,key)).addTo(previewLayer);};
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
      const placed=name==='hider'?!!hiderPin:!!endgamePin;
      const locked=name==='hider'?hiderPinLocked:endgamePinLocked;
      const go=document.getElementById(`${name}-goto-btn`),lock=document.getElementById(`${name}-lock-btn`);
      if(go){go.disabled=false;go.classList.remove('disabled');setText(go,placed?'Map':'Place pin');}
      if(lock){lock.disabled=!placed;setText(lock,locked?'Unlock':'Lock');lock.setAttribute('aria-pressed',String(locked));}
    }
    if(previewId!==null && !byId(previewId))clearPreview();
    if(previewId!==null){const current=byId(previewId);if(current&&previewSignature!==geometrySignature(current))preview(current.id,{open:false,fit:false});}
    updateInspector();
    for(const id of views.keys())if(!byId(id)){views.delete(id);placeSearch.delete(id);}
    const list=document.getElementById('question-list');if(list && !questions.length && mode==='seeker' && !list.querySelector('.qe-empty')){
      const empty=document.createElement('div');empty.className='qe-empty';empty.innerHTML='<strong>No questions</strong>';list.append(empty);
    }
    if(questions.length)document.querySelectorAll('.qe-empty').forEach(el=>el.remove());
    if(typeof _updateQuestionTools==='function')_updateQuestionTools();
    window.lampskeneQuestionUsageUI?.sync();
  }
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(sync);};
  const hooks=['addQuestion','addMatchingQuestion','addMeasuringQuestion','addAngleQuestion','setZone','setCloser','setMatchingAnswer','setMeasuringAnswer','setAngleZone','onRadiusChange','setUnit','toggleSeekerLock','toggleThermoLock','toggleThermoBorder','toggleMatchingVoronoi','toggleMatchingLock','toggleMeasuringLock','toggleAngleLock','toggleHiderLock','toggleEndgameLock','setMoveLockEnabled','openMoveWindow','applyQuestionMoveLocks','setMatchingSubcat','setMeasuringSubcat','setAngleQuestionAngle','setAngleQuestionMode','setAngleExcludeRadius','applyPinMove','recordPinMove','placeSeekerPin','placeThermoPin','placeSeekerMatchingPin','placeSeekerMeasuringPin','angleQuestionSetupMap','placeHiderPin','placeEndgamePin','checkAllHiderRadars','checkHiderRadar','checkHiderThermo','checkHiderMatching','checkHiderMeasuring','checkHiderAngle','decodeAndAdd','seekerDecodeAndAdd','removeQuestion','removeAngleQuestion','restoreState','switchMode','chooseMode','updateMatchingNearest','updateMeasuringNearest','_startEndgame','_endgameExitLocal'];
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
  document.addEventListener('jetlag:pinvisibility',schedule);
  const coordinateHost=document.getElementById('hide-locked-btn')?.parentElement;
  if(coordinateHost){
    const toggle=button('Show question coordinates',()=>{
      showCoordinates=!showCoordinates;
      try{window.localStorage?.setItem('lampskene_question_coordinates',String(showCoordinates));}catch(_){}
      syncCoordinates();
    },'sp-btn');
    toggle.id='question-coordinates-toggle';coordinateHost.append(toggle);
  }
  function syncCoordinates(){
    document.body?.classList?.toggle('qe-show-coordinates',showCoordinates);
    const toggle=document.getElementById('question-coordinates-toggle');
    toggle?.setAttribute('aria-pressed',String(showCoordinates));
    if(toggle)toggle.textContent='Question coordinates · '+(showCoordinates?'ON':'OFF');
  }
  syncCoordinates();
  window.lampskeneQuestions={sync:schedule,preview,clearPreview,copyAnswer,focusPlace,inspect:openInspector,closeInspector,edit:editQuestion,publicPins,get previewId(){return previewId;}};
  schedule();
})();
