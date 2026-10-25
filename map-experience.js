/* Map workspace: provider styles, bundled places, planning overlays and local bookmarks. */
(function () {
  'use strict';
  const PREF_KEY = 'lampskene_map_workspace_v1';
  const MAPS = [
    { key:'osm', name:'Street', detail:'OpenStreetMap · everyday navigation', look:'street', id:'btn-osm' },
    { key:'voyager', name:'Clear streets', detail:'Esri · streets and local names', look:'street' },
    { key:'positron', name:'Minimal', detail:'Esri · quiet light background', look:'canvas' },
    { key:'darkmatter', name:'Night streets', detail:'Esri · dark canvas', look:'night' },
    { key:'opentopo', name:'Topographic', detail:'OpenTopoMap · contours and paths', look:'landscape' },
    { key:'orienteering', name:'Orienteering · OSM', detail:'Terrain and marked trails · not a competition map', look:'outdoors' },
    { key:'ortho2006', name:'Stockholm orthophoto', detail:'City aerial survey · historical, 2006', look:'satellite' },
    { key:'ortho2022', name:'Stockholm aerial · HD', detail:'City orthophoto 2022 · 8 cm survey imagery', look:'satellite' },
    { key:'tf-transport', name:'Transit', detail:'Rail, bus and station context', look:'transit', id:'btn-base' },
    { key:'tf-transport-dark', name:'Transit dark', detail:'High contrast for night play', look:'night' },
    { key:'tf-cycle', name:'Cycle', detail:'Cycle routes and elevation', look:'cycle', id:'btn-cycle' },
    { key:'tf-atlas', name:'Atlas', detail:'Clean streets and local detail', look:'street' },
    { key:'tf-atlas-canvas', name:'Canvas', detail:'Quiet background for question zones', look:'canvas' },
    { key:'tf-outdoors', name:'Outdoors', detail:'Paths, parks and open space', look:'outdoors' },
    { key:'tf-landscape', name:'Landscape', detail:'Terrain and natural features', look:'landscape' },
    { key:'tf-neighbourhood', name:'Neighbourhood', detail:'Districts and local context', look:'neighbourhood' },
    { key:'tf-mobile-atlas', name:'Outdoor contrast', detail:'Readable in bright sunlight', look:'contrast' },
    { key:'tf-pioneer', name:'Rail heritage', detail:'Railways in a muted map', look:'pioneer' },
    { key:'satellite', name:'Satellite', detail:'Esri imagery · capture dates vary', look:'satellite' }
  ];
  const validPoint = p => p && Number.isFinite(+p.lat) && Number.isFinite(+p.lng) && Math.abs(+p.lat) <= 90 && Math.abs(+p.lng) <= 180;
  let prefs = { base:'osm', places:false, category:'Rail Station', onlyPossible:false, rings:false, anchor:null, minutes:15, bookmarks:[] };
  try {
    const saved = JSON.parse(localStorage.getItem(PREF_KEY) || 'null');
    if (saved && typeof saved === 'object') prefs = Object.assign(prefs, saved);
  } catch (_) {}
  if (!MAPS.some(m => m.key === prefs.base)) prefs.base = 'osm';
  prefs.bookmarks = Array.isArray(prefs.bookmarks) ? prefs.bookmarks.filter(validPoint).slice(0,30).map(p => ({name:String(p.name || 'Saved place').slice(0,80),lat:+p.lat,lng:+p.lng,category:String(p.category || 'Saved place')})) : [];
  if (!validPoint(prefs.anchor)) prefs.anchor = null;
  if (![10,15,30].includes(+prefs.minutes)) prefs.minutes = 15;
  let placeLayer, ringLayer, bookmarkLayer, refreshTimer, previewMarker, tileHealth = {};
  let allPlaces = [], categoryList = [], toolControl;
  function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (_) {} }
  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(label, action, cls='workspace-btn') {
    const node = el('button', cls, label); node.type = 'button'; node.addEventListener('click', action); return node;
  }
  function section(label, id) {
    const node = el('div', 'workspace-section'); node.id = id;
    node.append(el('div', 'sp-label', label)); document.getElementById('settings-panel').append(node); return node;
  }
  function distanceText(m) { return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m'; }
  function isExcluded(p) {
    return typeof isLatLngInBlueZone === 'function' && isLatLngInBlueZone(+p.lat, +p.lng);
  }
  function buildPlaces() {
    const source = typeof MATCHING_DATA !== 'undefined' ? MATCHING_DATA : {};
    const extra = typeof MEASURING_EXTRA !== 'undefined' ? MEASURING_EXTRA : {};
    const categories = new Set([...Object.keys(source), ...Object.keys(extra)]);
    allPlaces = []; categoryList = [];
    for (const category of categories) {
      const seen = new Set();
      const places = [...(source[category] || []), ...(extra[category] || [])].filter(validPoint);
      if (!places.length) continue;
      categoryList.push(category);
      for (const p of places) {
        const key = `${p.lat}|${p.lng}|${p.name}`;
        if (seen.has(key)) continue; seen.add(key);
        allPlaces.push({ name:String(p.name || 'Unnamed place'), lat:+p.lat, lng:+p.lng, category });
      }
    }
    categoryList.sort();
    if (!categoryList.includes(prefs.category)) prefs.category = categoryList[0];
  }
  function openSettings(target) {
    if (window.appShell?.open) window.appShell.open('settings',{focus:false});
    else if (!document.getElementById('settings-panel').classList.contains('open')) toggleSettingsPanel();
    const group = document.getElementById(target);
    if (group) {
      const details = group.closest('details'); if (details) details.open = true;
      if (window.appShell?.openSettingsSection) { window.appShell.openSettingsSection(target); return; }
      group.scrollIntoView({ block:'start', behavior:'auto' });
    }
  }
  function mountSettings() {
    buildPlaces();
    const oldPills = document.getElementById('btn-osm')?.closest('.sp-pills');
    if (oldPills) {
      const host = oldPills.parentElement; host.id = 'map-style-settings';
      host.querySelector('.sp-label').textContent = 'Map style';
      const gallery = el('div', 'basemap-gallery');
      const filterLabel = el('label','workspace-label','Map collection');
      const filter = el('select'); filter.id='basemap-collection'; filterLabel.htmlFor=filter.id;
      for(const [value,label] of [['popular','Quick picks'],['street','Street & night'],['terrain','Terrain & trails'],['aerial','Aerial imagery'],['all','All backgrounds']]) {
        const option=el('option','',label); option.value=value; filter.append(option);
      }
      for (const item of MAPS) {
        const btn = button('', () => setBase(item.key), 'basemap-option');
        btn.id = item.id || 'base-' + item.key; btn.dataset.base = item.key;
        btn.setAttribute('aria-pressed', String(item.key === prefs.base));
        btn.title = item.detail;
        btn.append(el('span', 'basemap-swatch ' + item.look), el('strong', '', item.name));
        gallery.append(btn);
      }
      const filterMaps=()=>{
        const selected=filter.value;
        gallery.querySelectorAll('[data-base]').forEach(node=>{
          const key=node.dataset.base;
          const category=['satellite','ortho2006','ortho2022'].includes(key)?'aerial':['opentopo','orienteering','tf-outdoors','tf-landscape','tf-cycle'].includes(key)?'terrain':'street';
          node.hidden=selected!=='all' && (selected==='popular'?!['osm','voyager','orienteering','satellite','ortho2006','darkmatter'].includes(key):selected!==category);
        });
      };
      filter.addEventListener('change',filterMaps); filterMaps();
      oldPills.before(filterLabel,filter);
      oldPills.replaceWith(gallery);
    }
    const overlays = section('Map overlays', 'map-overlay-settings');
    // Keep the original controls and their IDs; simply move them into the relevant group.
    for (const id of ['transit-layer-btn','city-boundary-btn']) {
      const control = document.getElementById(id); if (control) overlays.append(control);
    }
    const nativeOpacity = document.getElementById('blue-opacity-slider');
    if (nativeOpacity) {
      const row = nativeOpacity.closest('.sp-slider-row');
      const label = row?.querySelector('label'); if (label) { label.textContent = 'Question shading'; label.htmlFor = nativeOpacity.id; }
      if (row) overlays.append(row);
    } else {
      const opacityLabel = el('label', 'workspace-label', 'Question shading'); opacityLabel.htmlFor = 'question-opacity';
      const opacity = el('input'); opacity.type = 'range'; opacity.id = 'question-opacity'; opacity.min = '12'; opacity.max = '55';
      opacity.value = '30';
      opacity.addEventListener('input', () => { if(typeof setBlueOpacitySetting==='function')setBlueOpacitySetting(opacity.value); });
      overlays.append(opacityLabel, opacity);
    }
    const workspace = section('Seeker workspace', 'map-workspace-settings');
    const categoryLabel = el('label', 'workspace-label', 'Place category'); categoryLabel.htmlFor = 'workspace-category';
    const category = el('select'); category.id = 'workspace-category';
    for (const name of categoryList) { const opt = el('option','',name); opt.value = name; category.append(opt); }
    category.value = prefs.category;
    category.addEventListener('change', () => { prefs.category = category.value; savePrefs(); refreshPlaces(); renderPlaces(); });
    const searchLabel = el('label','workspace-label','Find a place'); searchLabel.htmlFor = 'workspace-search';
    const search = el('input'); search.id = 'workspace-search'; search.type = 'search'; search.placeholder = 'Name in this category…';
    search.addEventListener('input', renderPlaces);
    workspace.append(categoryLabel, category, searchLabel, search);
    const toggles = el('div','workspace-actions');
    const placesToggle = button('Show places on map', () => { prefs.places = !prefs.places; savePrefs(); refreshPlaces(); syncControls(); });
    placesToggle.id = 'workspace-places-toggle';
    const possibleToggle = button('Only possible places', () => { prefs.onlyPossible = !prefs.onlyPossible; savePrefs(); refreshPlaces(); renderPlaces(); syncControls(); });
    possibleToggle.id = 'workspace-possible-toggle';
    toggles.append(placesToggle, possibleToggle); workspace.append(toggles);
    const placeStatus = el('p','workspace-hint'); placeStatus.id = 'workspace-place-status'; workspace.append(placeStatus);
    const results = el('div','workspace-results'); results.id = 'workspace-results'; workspace.append(results);
    const planning = section('Distance planning', 'map-planning-settings');
    planning.append(el('p','workspace-hint','Straight-line walking estimate · 80 m/min'));
    const row = el('div','workspace-actions');
    const rings = button('Walking rings', () => {
      prefs.rings = !prefs.rings; if (!prefs.anchor && map) prefs.anchor = map.getCenter(); savePrefs(); drawRings(); syncControls();
    }); rings.id = 'workspace-rings-toggle';
    row.append(rings, button('Anchor at map center', () => {
      if (!map) return; const p = map.getCenter(); prefs.anchor = {lat:p.lat,lng:p.lng}; prefs.rings = true; savePrefs(); drawRings(); syncControls();
      showToast('Planning anchor set. Panning the map will not move it.');
    })); planning.append(row);
    const minutes = el('select'); minutes.id = 'workspace-minutes'; minutes.setAttribute('aria-label','Maximum walking ring');
    for (const n of [10,15,30]) { const opt = el('option','',n + ' minute outer ring'); opt.value = String(n); minutes.append(opt); }
    minutes.value = String(prefs.minutes);
    minutes.addEventListener('change', () => { prefs.minutes = +minutes.value; savePrefs(); drawRings(); }); planning.append(minutes);
    const bookmarks = section('Saved places', 'map-bookmark-settings');
    const name = el('input'); name.id = 'bookmark-name'; name.placeholder = 'Place name or a short note'; name.maxLength = 80; name.setAttribute('aria-label','Saved place name');
    bookmarks.append(name, button('Save map center', () => {
      if (!map) return; const p = map.getCenter(); addBookmark({name:name.value.trim() || 'Map center',lat:p.lat,lng:p.lng}); name.value = '';
    }));
    const list = el('div','workspace-results'); list.id = 'bookmark-results'; bookmarks.append(list);
    const provider = document.getElementById('tf-key-input');
    if (provider) {
      const hint = provider.parentElement.querySelector('div:last-child');
      if (hint && hint !== provider) hint.textContent = 'Used by all Thunderforest styles. Street and Satellite use separate providers.';
      try { provider.value = localStorage.getItem('lampskene_tf_key') || ''; } catch (_) {}
    }
    syncControls(); renderBookmarks();
  }
  function syncControls() {
    for (const [id,on] of [['workspace-places-toggle',prefs.places],['workspace-possible-toggle',prefs.onlyPossible],['workspace-rings-toggle',prefs.rings]]) {
      const node = document.getElementById(id); if (!node) continue;
      node.classList.toggle('active', !!on); node.setAttribute('aria-pressed', String(!!on));
    }
    document.querySelectorAll('.basemap-option').forEach(btn => {
      const on = btn.dataset.base === activeLayerKey; btn.classList.toggle('active',on); btn.setAttribute('aria-pressed',String(on));
    });
  }
  function initializeLayers() {
    let key = TF_KEY; try { key = localStorage.getItem('lampskene_tf_key') || TF_KEY; } catch (_) {}
    for (const item of MAPS) {
      if (item.key.startsWith('tf-')) {
        const style = item.key.slice(3);
        if (layers[item.key]) layers[item.key].setUrl(`https://api.thunderforest.com/${style}/{z}/{x}/{y}.png?apikey=${encodeURIComponent(key)}`);
        else layers[item.key] = L.tileLayer(`https://api.thunderforest.com/${style}/{z}/{x}/{y}.png?apikey=${encodeURIComponent(key)}`, {
          maxZoom:20, maxNativeZoom:19, detectRetina:false, updateWhenIdle:true, updateWhenZooming:false,
          attribution:'&copy; <a href="https://www.thunderforest.com/">Thunderforest</a>, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
        });
      }
    }
    layers.satellite = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom:20, maxNativeZoom:19, updateWhenIdle:true, updateWhenZooming:false,
      attribution:'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community'
    });
    // CARTO now serves an API-key warning image with HTTP 200. Use keyless tiles.
    for(const [key,style,maxNativeZoom] of [['voyager','World_Street_Map',18],['positron','Canvas/World_Light_Gray_Base',16],['darkmatter','Canvas/World_Dark_Gray_Base',16]]) {
      layers[key]=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/'+style+'/MapServer/tile/{z}/{y}/{x}',{
        maxZoom:22,maxNativeZoom,updateWhenIdle:true,updateWhenZooming:false,
        attribution:'Tiles &copy; Esri, HERE, Garmin, OpenStreetMap contributors'
      });
    }
    for(const key of ['opentopo','orienteering']) layers[key]=L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',{
      maxZoom:20,maxNativeZoom:17,updateWhenIdle:true,updateWhenZooming:false,
      attribution:'Map &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA) · &copy; OpenStreetMap, SRTM'
    });
    layers.ortho2006=L.tileLayer.wms('https://openmap.stockholm.se/bios/wms/app/baggis/web/WMS_STHLM_ORTOFOTO_2006',{
      layers:'p_1002830',format:'image/png',version:'1.1.1',maxZoom:20,maxNativeZoom:19,
      updateWhenIdle:true,updateWhenZooming:false,
      attribution:'Historical orthophoto 2006 &copy; <a href="https://kartor.stockholm/kartor-geodata/">Stockholms stad</a>'
    });
    layers.ortho2022=L.tileLayer.wms('https://openmap.stockholm.se/bios/wms/app/baggis/web/WMS_STHLM_ORTOFOTO_2022',{
      layers:'p_1003220',format:'image/png',version:'1.1.1',maxZoom:22,maxNativeZoom:21,tileSize:512,zoomOffset:-1,
      updateWhenIdle:true,updateWhenZooming:false,
      attribution:'Orthophoto 2022 &copy; <a href="https://kartor.stockholm/kartor-geodata/">Stockholms stad</a>'
    });
    for (const item of MAPS) {
      tileHealth[item.key] = {ok:0,errors:0};
      layers[item.key].on('tileload', () => { tileHealth[item.key].ok++; });
      layers[item.key].on('tileerror', () => {
        const health = tileHealth[item.key]; health.errors++;
        if (activeLayerKey === item.key && item.key !== 'osm' && health.errors >= 5 && health.ok === 0) {
          showToast(item.name + ' is unavailable. Showing Street; check provider access in Settings.', 5000);
          setBase('osm');
        }
      });
    }
    placeLayer = L.layerGroup().addTo(map); ringLayer = L.layerGroup().addTo(map); bookmarkLayer = L.layerGroup().addTo(map);
    L.control.scale({imperial:false,position:'bottomleft'}).addTo(map);
    const requested = prefs.base; activeLayerKey = 'osm'; setBase(requested);
    map.on('moveend', () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { refreshPlaces(); renderPlaces(); },180); });
    map.on('moveend', () => { if (typeof saveState === 'function') saveState(false); });
    drawRings(); drawBookmarks(); refreshPlaces(); renderPlaces(); mountToolbar();
  }
  window.setBase = function (key) {
    if (!map || !layers[key]) return;
    if (key !== activeLayerKey) {
      tileHealth[key] = {ok:0,errors:0};
    }
    activeLayerKey = key;
    window.lampskeneGeo.replaceBaseLayer(map,layers,key);
    prefs.base = key; savePrefs(); syncControls(); renderLegend();
    document.dispatchEvent(new CustomEvent('jetlag:basemap',{detail:{key}}));
  };
  window.applyTFKey = function (value) {
    const key = String(value || '').trim();
    try { key ? localStorage.setItem('lampskene_tf_key',key) : localStorage.removeItem('lampskene_tf_key'); } catch (_) {}
    for (const item of MAPS.filter(item => item.key.startsWith('tf-'))) {
      tileHealth[item.key] = {ok:0,errors:0};
      layers[item.key]?.setUrl(`https://api.thunderforest.com/${item.key.slice(3)}/{z}/{x}/{y}.png?apikey=${encodeURIComponent(key || TF_KEY)}`);
    }
  };
  function renderPlaces() {
    const list = document.getElementById('workspace-results'); if (!list || !map) return;
    const query = (document.getElementById('workspace-search')?.value || '').trim().toLowerCase();
    const center = map.getCenter();
    const rows = allPlaces.filter(p => p.category === prefs.category && (!query || p.name.toLowerCase().includes(query)))
      .filter(p => !prefs.onlyPossible || !isExcluded(p)).map(p => ({...p,distance:map.distance(center,[p.lat,p.lng])})).sort((a,b)=>a.distance-b.distance);
    const frag = document.createDocumentFragment();
    for (const place of rows.slice(0,8)) {
      const row = el('div','workspace-place');
      const view = button('', () => previewPlace(place),'workspace-place-main');
      view.append(el('strong','',place.name),el('small','',`${distanceText(place.distance)} from map center · ${isExcluded(place) ? 'Excluded by answers' : 'Not excluded'}`));
      const save = button('+',() => addBookmark(place),'workspace-place-save'); save.setAttribute('aria-label','Save ' + place.name);
      row.append(view,save); frag.append(row);
    }
    if (!rows.length) frag.append(el('p','workspace-hint','No places match. Try another category or turn off “Only possible places”.'));
    list.replaceChildren(frag);
    const status = document.getElementById('workspace-place-status');
    if (status) status.textContent = `${rows.length} matching places · nearest ${Math.min(rows.length,8)} shown. Bundled data may be incomplete.`;
  }
  function previewPlace(place) {
    if (!map || !validPoint(place)) return;
    const content = el('div','workspace-popup');
    content.append(el('span','workspace-kicker',place.category || 'Saved place'),el('h3','',place.name),el('p','',isExcluded(place) ? 'Excluded by your current question answers.' : 'Not excluded by your current question answers.'));
    const origin = prefs.anchor || map.getCenter(); const distance = map.distance([origin.lat,origin.lng],[place.lat,place.lng]);
    content.append(el('p','workspace-hint',`${distanceText(distance)} from ${prefs.anchor ? 'planning anchor' : 'map center'} · ≈${Math.max(1,Math.round(distance/80))} min straight-line walk`));
    content.append(el('p','workspace-coords',`${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`));
    content.append(button('Save to shortlist',() => addBookmark(place)),button('Plan from this place',() => {
      prefs.anchor = {lat:place.lat,lng:place.lng}; prefs.rings = true; drawRings(); syncControls(); savePrefs(); showToast('Planning rings anchored at ' + place.name);
    }));
    if (previewMarker) map.removeLayer(previewMarker);
    previewMarker = L.marker([place.lat,place.lng],{icon:tearDropIcon('#20b9b3',30)}).addTo(map).bindPopup(content,{maxWidth:280,autoPan:false});
    if (window.appShell?.close) window.appShell.close();
    map.setView([place.lat,place.lng],Math.max(15,map.getZoom()),{animate:false}); previewMarker.openPopup();
  }
  function refreshPlaces() {
    if (!placeLayer || !map) return;
    placeLayer.clearLayers();
    if (prefs.places) {
      const bounds = map.getBounds().pad(.1); const center = map.getCenter();
      const candidates = allPlaces.filter(p => p.category === prefs.category && bounds.contains([p.lat,p.lng]) && (!prefs.onlyPossible || !isExcluded(p)))
        .sort((a,b) => map.distance(center,[a.lat,a.lng])-map.distance(center,[b.lat,b.lng]));
      for (const p of candidates.slice(0,200)) {
        L.circleMarker([p.lat,p.lng],{radius:5,weight:2,color:'#fff',fillColor:isExcluded(p)?'#8192a6':'#20b9b3',fillOpacity:.95})
          .bindTooltip(el('span','',p.name),{direction:'top'}).on('click',() => previewPlace(p)).addTo(placeLayer);
      }
    }
    renderLegend();
  }
  function drawRings() {
    if (!ringLayer || !map) return; ringLayer.clearLayers();
    if (!prefs.rings || !prefs.anchor) { renderLegend(); return; }
    const max = +prefs.minutes;
    for (const minute of [max/3,max*2/3,max].sort((a,b)=>b-a)) {
      L.circle([prefs.anchor.lat,prefs.anchor.lng],{radius:minute*80,color:'#20b9b3',weight:1.5,fillOpacity:.025,dashArray:'5 5',interactive:false}).addTo(ringLayer);
    }
    L.circleMarker([prefs.anchor.lat,prefs.anchor.lng],{radius:5,color:'#fff',weight:2,fillColor:'#20b9b3',fillOpacity:1})
      .bindTooltip(`Planning anchor · ${max} min outer ring`,{direction:'top'}).addTo(ringLayer); renderLegend();
  }
  function addBookmark(place) {
    if (!validPoint(place)) return;
    if (prefs.bookmarks.some(p => Math.abs(p.lat-place.lat)<.00001 && Math.abs(p.lng-place.lng)<.00001)) { showToast('This place is already saved'); return; }
    if (prefs.bookmarks.length >= 30) { showToast('Shortlist full. Remove a saved place first.'); return; }
    prefs.bookmarks.push({name:String(place.name || 'Saved place').slice(0,80),lat:+place.lat,lng:+place.lng,category:place.category || 'Saved place'});
    savePrefs(); renderBookmarks(); drawBookmarks(); showToast('Saved ' + place.name);
  }
  function renderBookmarks() {
    const list = document.getElementById('bookmark-results'); if (!list) return;
    list.replaceChildren();
    if (!prefs.bookmarks.length) list.append(el('p','workspace-hint','Your shortlist is empty. Save promising stations and places for later.'));
    prefs.bookmarks.forEach((place,index) => {
      const row = el('div','workspace-place');
      const go = button(place.name,() => previewPlace(place),'workspace-place-main');
      const remove = button('×',() => { prefs.bookmarks.splice(index,1); savePrefs(); renderBookmarks(); drawBookmarks(); },'workspace-place-save');
      remove.setAttribute('aria-label','Remove saved ' + place.name); row.append(go,remove); list.append(row);
    });
  }
  function drawBookmarks() {
    if (!bookmarkLayer) return; bookmarkLayer.clearLayers();
    prefs.bookmarks.forEach(place => L.circleMarker([place.lat,place.lng],{radius:7,color:'#fff',weight:2,fillColor:'#dfaa40',fillOpacity:1})
      .bindTooltip(el('span','',place.name)).on('click',()=>previewPlace(place)).addTo(bookmarkLayer));
  }
  function fitQuestions() {
    if (!map) return;
    const points = [];
    for (const q of questions) {
      for (const m of [q.marker,q.markerA,q.markerB,q._centerMarker,q._dirMarker]) if (m?.getLatLng) points.push(m.getLatLng());
    }
    if (mode === 'hider' && hiderPin) points.push(hiderPin.getLatLng());
    if (!points.length) { showToast('Add a question to see it on the map'); return; }
    if (window.appShell?.close) window.appShell.close();
    map.fitBounds(L.latLngBounds(points),{padding:[48,64],maxZoom:15,animate:false});
  }
  function mountToolbar() {
    const Control = L.Control.extend({options:{position:'topright'},onAdd:() => {
      const host = el('div','map-workspace-control');
      const controls = el('div','map-workspace-buttons');
      controls.append(button('Layers',()=>openSettings('map-style-settings')),button('Tools',()=>openSettings('map-tools-settings')),button('3D',()=>window.lampskene3D?.open()));
      host.append(controls); const legend=el('div','map-workspace-legend');legend.id='map-workspace-legend';host.append(legend);
      L.DomEvent.disableClickPropagation(host); L.DomEvent.disableScrollPropagation(host); return host;
    }});
    toolControl = new Control().addTo(map); renderLegend();
  }
  function renderLegend() {
    const legend=document.getElementById('map-workspace-legend');if(!legend)return;
    const pieces = [MAPS.find(m=>m.key===activeLayerKey)?.name || 'Street'];
    if (prefs.places) pieces.push(prefs.category);
    if (prefs.rings) pieces.push(`${prefs.minutes} min rings`);
    pieces.push(...(window.lampskeneMapTools?.overlays?.() || []));
    legend.textContent = pieces.join(' · ');
  }
  mountSettings();
  const originalInit = window.initMap;
  window.initMap = function () { originalInit(); initializeLayers(); };
  // Persist independent transit controls too, without saving partial restores.
  for (const name of ['toggleTransitLayer','toggleHideLockedPins','setSlLineDetail','addSlSelectedStation','removeSlSelectedStation','clearSlSelectedStations','toggleSlFerryStops']) {
    const original = window[name]; if (typeof original !== 'function') continue;
    window[name] = function (...args) { const result=original.apply(this,args); saveState(); return result; };
  }
  const rebuild = window.rebuildAll;
  window.rebuildAll = function (...args) { const result=rebuild.apply(this,args); clearTimeout(refreshTimer); refreshTimer=setTimeout(()=>{if(prefs.places)refreshPlaces();if(window.appShell?.activePanel==='settings')renderPlaces();},180); return result; };
  function rasterStyle(key){
    const layer=layers[key];if(!layer)return null;
    let url=layer._url.replace('{s}','a').replace('{r}','');
    if(layer.wmsParams){
      const params=new URLSearchParams({...layer.wmsParams,service:'WMS',request:'GetMap',srs:'EPSG:3857',width:512,height:512});
      url+=(url.includes('?')?'&':'?')+params.toString()+'&bbox={bbox-epsg-3857}';
    }
    return {type:'raster',tiles:[url],tileSize:layer.wmsParams?512:256,maxzoom:layer.options.maxNativeZoom||19,attribution:layer.options.attribution||''};
  }
  window.lampskeneMap = {addBookmark,previewPlace,fitQuestions,openSettings,rasterStyle,styles:MAPS.map(({key,name})=>({key,name}))};
  document.addEventListener('jetlag:referencechange',renderLegend);
})();
