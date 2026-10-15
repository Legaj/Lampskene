/* Practical question cards. All map previews use public question positions. */
(() => {
  'use strict';
  const views = new Map();
  const placeSearch = new Map();
  let previewLayer = null, previewTimer = null, previewId = null;
  let frame = 0;
  const byId = id => questions.find(q => String(q.id) === String(id));
  const cardFor = q => document.getElementById(`q-card-${q.id}`) || document.getElementById(`angle-card-${q.id}`);
  const distanceLabel = value => value >= 1000 ? `${(value / 1000).toFixed(1)} km` : `${Math.round(value)} m`;
  const answerFor = q => q.type === 'thermo' ? q.closer : ['matching','measuring'].includes(q.type) ? q.answer : q.zone;
  const pointFor = q => q.center || {lat:q.hiderMode ? q.seekerLat ?? q.lat ?? q.latA : q.lat ?? q.latA, lng:q.hiderMode ? q.seekerLng ?? q.lng ?? q.lngA : q.lng ?? q.lngA};
  const categoryLocations = q => q.type === 'matching' ? getAllMatchingData()[q.subcat] || [] : q.type === 'measuring' ? getMeasuringLocs(q.subcat) : [];
  const setText = (node, value) => { if (node && node.textContent !== value) node.textContent=value; };
  const button = (label, action, className='qe-btn') => {
    const el=document.createElement('button'); el.type='button'; el.className=className; el.textContent=label; el.addEventListener('click',action); return el;
  };

  function overview(q) {
    const answer=answerFor(q) || 'pending';
    const status={pending:'Awaiting answer',inside:'Inside',outside:'Outside',yes:'Same place',no:'Different place',closer:'Closer',further:'Further',A:'Closer to A',B:'Closer to B'}[answer] || 'Awaiting answer';
    let description='', instruction='';
    if(q.type==='radar') {
      description=getRadiusMeters(q) ? `${distanceLabel(getRadiusMeters(q))} radius from the question center` : 'Choose a radius around your pin';
      instruction=!getRadiusMeters(q) ? 'Set a positive radius, then preview the circle.' : 'Position the center, copy the code, then record Inside or Outside.';
    }
    if(q.type==='thermo') {
      description=`${distanceLabel(map.distance([q.latA,q.lngA],[q.latB,q.lngB]))} between pins A and B`;
      instruction='Place A and B, copy the code, then record which pin is closer to the hider.';
    }
    if(q.type==='matching') {
      description=`${q.subcat} · ${q.nearestName || 'No place found at this pin'}`;
      instruction=q.nearestId==='none' ? 'Ask whether the hider is also outside every area in this category.' : q.nearestId ? 'Ask whether your nearest place (or containing area) matches the hider’s.' : 'Move the pin into this category’s coverage or choose another category.';
    }
    if(q.type==='measuring') {
      description=`${q.subcat} · ${q.nearestName || 'No place found'}${q.nearestId ? ' · '+distanceLabel(q.seekerDist) : ''}`;
      instruction='Ask if the hider is closer or further from their own nearest place in this category.';
    }
    if(q.type==='angle') {
      const modeLabel={default:'One direction',bidirectional:'Two directions',triple:'Three directions',excludeRadius:'Exclude center'}[q.mode] || q.mode;
      description=`${q.angle}° · ${modeLabel}${q.mode==='excludeRadius' ? ' · '+distanceLabel(q.excludeRadius)+' excluded' : ''}`;
      instruction='Place the center and direction pins, copy the code, then record Inside or Outside.';
    }
    if(q.hiderMode) instruction=getActiveHiderPin() ? 'The answer uses your active hiding pin. Copy only the answer code to the seeker.' : 'Place your hiding pin on the map to calculate the answer.';
    else if(answer!=='pending') instruction='Answer recorded. The blue map area is ruled out; the clear area remains possible.';
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
    const summary=document.createElement('summary'); summary.textContent=['matching','measuring'].includes(q.type) ? 'Places & map preview' : 'Question map preview'; detail.append(summary);
    const geometry=document.createElement('div'); geometry.className='qe-geometry';
    const icon=document.createElement('div'); icon.className='qe-geometry-icon'; icon.innerHTML=geometryIcon(q); geometry.append(icon);
    const text=document.createElement('div');
    const title=document.createElement('strong'); title.textContent='Preview the question';
    const note=document.createElement('p'); note.textContent='The diagram shows the question shape. Open the actual pins and coverage on the map.';
    text.append(title,note); geometry.append(text); detail.append(geometry);
    const actions=document.createElement('div'); actions.className='qe-actions';
    actions.append(button('View on map',()=>preview(q.id)),button('Clear preview',clearPreview)); detail.append(actions);
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
    if(!state){state={expanded:questions[questions.length-1]===q,preview:false};views.set(String(q.id),state);}
    let summary=card.querySelector('.qe-summary');
    if(!summary){
      card.classList.add('qe-card');
      summary=document.createElement('div');summary.className='qe-summary';
      const badge=document.createElement('span');badge.className='qe-status';
      const lock=document.createElement('span');lock.className='qe-lock-state';
      const statusRow=document.createElement('div');statusRow.className='qe-status-row';statusRow.append(badge,lock);
      const description=document.createElement('p');description.className='qe-description';
      const next=document.createElement('p');next.className='qe-next';
      const actions=document.createElement('div');actions.className='qe-actions';
      const viewBtn=button('View map',()=>preview(q.id));
      const detailsBtn=button('Question details',()=>{
        const panel=document.getElementById('sidebar');const scroll=panel ? panel.scrollTop : 0;
        state.expanded=!state.expanded; update(q);
        if(panel)panel.scrollTop=scroll;
      });detailsBtn.classList.add('qe-details-btn');
      actions.append(viewBtn,detailsBtn);
      if(q.hiderMode){
        const copy=button('Copy answer',()=>copyAnswer(q.id));copy.classList.add('qe-answer-copy');actions.prepend(copy);
      }
      summary.append(statusRow,description,next,actions,makePreview(q));
      const header=card.querySelector('.q-card-header'); if(header)header.after(summary);else card.prepend(summary);
      if(state.preview)summary.querySelector('details').open=true;
      if(['matching','measuring'].includes(q.type)) {
        const b=card.querySelector('.q-card-body');
        if(b){b.querySelectorAll('select').forEach(el=>el.setAttribute('aria-label',q.type+' place category'));}
      }
    }
    update(q);
  }

  function update(q) {
    const card=cardFor(q);if(!card)return;
    const summary=card.querySelector('.qe-summary');if(!summary)return;
    card.classList.remove('collapsed');
    card.querySelectorAll('.q-collapse-summary,.q-collapse-chevron').forEach(el=>el.remove());
    const data=overview(q), state=views.get(String(q.id));
    setText(summary.querySelector('.qe-description'),data.description);
    summary.querySelector('.qe-description').title=data.description;
    setText(summary.querySelector('.qe-next'),data.instruction);
    const status=summary.querySelector('.qe-status');setText(status,data.status);status.dataset.state=data.answer;
    setText(summary.querySelector('.qe-lock-state'),q.locked?'Position locked':questionMoveAllowed(q)?'Position editable':'Movement protected');
    const body=card.querySelector('.q-card-body');if(body)body.hidden=!state.expanded;
    const toggle=summary.querySelector('.qe-details-btn');setText(toggle,state.expanded?'Hide details':'Question details');toggle.setAttribute('aria-expanded',String(state.expanded));
    if(body){
      if(!body.id)body.id=`qe-body-${q.id}`;toggle.setAttribute('aria-controls',body.id);
      body.querySelectorAll('input,select,.unit-btn,.aq-mode').forEach(el=>el.disabled=!!q.locked && !q.hiderMode);
      body.querySelectorAll('[onclick*="setMyLocation"]').forEach(el=>el.disabled=!questionMoveAllowed(q));
      body.querySelectorAll('.remove-btn').forEach(el=>{el.disabled=!!q.locked&&!q.hiderMode;});
      const removeRow=document.getElementById(`remove-row-${q.id}`);if(removeRow)removeRow.style.display=q.locked?'none':'';
      const input=body.querySelector(`[id="rad-inp-${q.id}"]`);if(input && document.activeElement!==input && input.value!==String(q.radius))input.value=q.radius;
      if(q.type==='radar'){document.getElementById(`unit-m-${q.id}`)?.classList.toggle('active',q.unit==='M');document.getElementById(`unit-km-${q.id}`)?.classList.toggle('active',q.unit==='KM');}
      // The same CSS state is shared by several answers; assign in one pass.
      body.querySelectorAll('.zone-btn,.closer-btn').forEach(el=>{
        const handler=el.getAttribute('onclick') || '';el.classList.remove('active-pend','active-in','active-out','active-a','active-b');
        if(handler.includes(`'${data.answer}'`)){const active={pending:'active-pend',inside:'active-in',outside:'active-out',yes:'active-in',no:'active-out',closer:'active-in',further:'active-out',A:'active-a',B:'active-b'}[data.answer];if(active)el.classList.add(active);}
        el.setAttribute('aria-pressed',String(handler.includes(`'${data.answer}'`)));
      });
      const lockPrefix={radar:'lock',thermo:'tlock',matching:'mlock',measuring:'measlock',angle:'aq-lock'}[q.type];
      const lockBtn=document.getElementById(`${lockPrefix}-btn-${q.id}`);if(lockBtn){setText(lockBtn,q.locked?'Unlock position':'Lock position');lockBtn.classList.toggle('locked',!!q.locked);lockBtn.setAttribute('aria-pressed',String(!!q.locked));}
      const nearest=body.querySelector(`[id="match-nearest-${q.id}"],[id="meas-nearest-${q.id}"]`);if(nearest)setText(nearest,q.nearestName || 'No place found');
      const distance=body.querySelector(`[id="meas-dist-${q.id}"]`);if(distance)setText(distance,q.nearestId?distanceLabel(q.seekerDist):'—');
      body.querySelectorAll('.copy-btn').forEach(el=>el.disabled=q.type==='radar'?!getRadiusMeters(q):['matching','measuring'].includes(q.type)?!q.nearestId:false);
    }
    const copy=summary.querySelector('.qe-answer-copy');if(copy)copy.disabled=data.answer==='pending'||!getActiveHiderPin();
  }

  function clearPreview() {
    if(previewId!==null && typeof _anglePreviewQuestionId!=='undefined' && _anglePreviewQuestionId===previewId){_anglePreviewLayer?.clearLayers();clearTimeout(_anglePreviewTimer);}
    if(previewLayer){previewLayer.clearLayers();if(map.hasLayer(previewLayer))map.removeLayer(previewLayer);previewLayer=null;}
    clearTimeout(previewTimer);previewId=null;
  }

  function closeForMap() {
    if(window.lampskeneShell?.closePanels)window.lampskeneShell.closePanels();
    else if(window.appShell?.close)window.appShell.close({restoreFocus:false});
    else if(window.matchMedia('(max-width:768px)').matches && sidebarOpen)toggleSidebar();
  }

  function preview(id) {
    const q=byId(id);if(!q || !map)return;
    clearPreview();previewId=q.id;previewLayer=L.layerGroup().addTo(map);
    const style={color:'#16879a',weight:2,dashArray:'6 4',fillColor:'#16879a',fillOpacity:.06,interactive:false};
    const points=[], pos=pointFor(q);
    const pin=(p,label)=>{if(!validQuestionPoint(p.lat,p.lng))return;points.push([p.lat,p.lng]);L.circleMarker([p.lat,p.lng],{radius:7,color:'#fff',weight:2,fillColor:'#16879a',fillOpacity:1}).bindTooltip(questionEscapeHtml(label),{permanent:true,direction:'top'}).addTo(previewLayer);};
    if(q.type==='radar') {
      pin(pos,'Radar center'); const radius=getRadiusMeters(q);
      if(radius){const c=L.circle([pos.lat,pos.lng],{...style,radius}).addTo(previewLayer);points.push(c.getBounds().getNorthEast(),c.getBounds().getSouthWest());}
    } else if(q.type==='thermo') {
      pin({lat:q.latA,lng:q.lngA},'Pin A');pin({lat:q.latB,lng:q.lngB},'Pin B');
      L.polyline([[q.latA,q.lngA],[q.latB,q.lngB]],style).addTo(previewLayer);
    } else if(q.type==='angle') {
      pin(q.center,'Center');pin(q.direction,'Direction');
      L.polyline([[q.center.lat,q.center.lng],[q.direction.lat,q.direction.lng]],style).addTo(previewLayer);showAnglePreview(q,20000);
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
    if(points.length)map.fitBounds(L.latLngBounds(points),{padding:[54,54],maxZoom:15,animate:false});
    closeForMap();
    showToast('Question preview · clears in 20 seconds');previewTimer=setTimeout(clearPreview,20000);
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
    for(const id of views.keys())if(!byId(id)){views.delete(id);placeSearch.delete(id);}
    const list=document.getElementById('question-list');if(list && !questions.length && mode==='seeker' && !list.querySelector('.qe-empty')){
      const empty=document.createElement('div');empty.className='qe-empty';empty.innerHTML='<strong>Start with a question</strong><p>Add a radar, thermometer, matching, measuring or angle question. Copy its code to the hider, then import their answer. Blue areas are ruled out.</p>';list.append(empty);
    }
    if(questions.length)document.querySelectorAll('.qe-empty').forEach(el=>el.remove());
    if(typeof _updateQuestionTools==='function')_updateQuestionTools();
  }
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(sync);};
  const hooks=['addQuestion','addMatchingQuestion','addMeasuringQuestion','addAngleQuestion','setZone','setCloser','setMatchingAnswer','setMeasuringAnswer','setAngleZone','onRadiusChange','setUnit','toggleSeekerLock','toggleThermoLock','toggleMatchingLock','toggleMeasuringLock','toggleAngleLock','toggleHiderLock','toggleEndgameLock','setMoveLockEnabled','openMoveWindow','applyQuestionMoveLocks','setMatchingSubcat','setMeasuringSubcat','setAngleQuestionAngle','setAngleQuestionMode','setAngleExcludeRadius','applyPinMove','recordPinMove','placeHiderPin','placeEndgamePin','checkAllHiderRadars','decodeAndAdd','seekerDecodeAndAdd','removeQuestion','removeAngleQuestion','restoreState','switchMode','chooseMode','updateMatchingNearest','updateMeasuringNearest','_startEndgame','_endgameExitLocal'];
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
  if(typeof window.toggleQuestionCollapse==='function')window.toggleQuestionCollapse=id=>{const q=byId(id),state=views.get(String(id));if(q&&state){state.expanded=!state.expanded;update(q);}};
  if(typeof window._qSetCollapsed==='function')window._qSetCollapsed=(q,collapsed)=>{enhance(q);const state=views.get(String(q.id));if(state){state.expanded=!collapsed;update(q);}};
  const list=document.getElementById('question-list');
  if(list){
    new MutationObserver(records=>{if(records.some(record=>record.type==='childList' && record.target===list))schedule();}).observe(list,{childList:true});
    list.addEventListener('click',e=>{const header=e.target instanceof Element?e.target.closest('.q-card-header'):null;if(!header||e.target.closest('button,input,select'))return;const card=header.closest('.qe-card');if(!card)return;const id=card.id.replace(/^(?:q|angle)-card-/,'');const q=byId(id),state=views.get(String(id));if(q&&state){e.stopImmediatePropagation();state.expanded=!state.expanded;update(q);}},true);
  }
  document.addEventListener('input',e=>{if(e.target.closest('.q-card'))schedule();});
  window.lampskeneQuestions={sync:schedule,preview,clearPreview,copyAnswer,focusPlace};
  schedule();
})();
