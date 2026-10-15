/* On-demand street details and deliberate map tools. No background location queries. */
(function() {
  'use strict';
  const geo=window.lampskeneGeo, KEY='lampskene_field_map_v2';
  const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const btn=(label,fn,cls='workspace-btn')=>{const n=node('button',cls,label);n.type='button';n.addEventListener('click',fn);return n;};
  const by=id=>document.getElementById(id);
  const section=(name,id)=>{const n=node('div','workspace-section');n.id=id;n.append(node('div','sp-label',name));by('settings-panel').append(n);return n;};
  const hint=text=>node('p','workspace-hint',text);
  const format=m=>m>=1000?(m/1000).toFixed(2)+' km':Math.round(m)+' m';
  let prefs={details:['bench','toilet','water'],labels:false,trails:false,combos:[],sources:[]};
  try{const p=JSON.parse(localStorage.getItem(KEY)||'null');if(p&&typeof p==='object')prefs={...prefs,...p};}catch(_){}
  prefs.details=Array.isArray(prefs.details)?prefs.details.filter(k=>geo.DETAILS.some(d=>d.key===k)):['bench'];
  prefs.combos=Array.isArray(prefs.combos)?prefs.combos.filter(c=>c&&typeof c.name==='string'&&typeof c.base==='string').slice(0,6):[];
  prefs.sources=Array.isArray(prefs.sources)?prefs.sources.filter(validSource).slice(0,3):[];
  const persist=()=>{try{localStorage.setItem(KEY,JSON.stringify(prefs));}catch(_){}};
  let detailLayer,measureLayer,labelsLayer,trailsLayer,request=null,version=0,nextRequest=0,loadedBounds=null;
  let detailData={type:'FeatureCollection',features:[]},detailStatus='Choose details, then load this area.',measureMode=false,points=[],sourceLayers=new Map();
  const cache=new Map();

  function mount() {
    const tools=section('Map tools','map-tools-settings');
    tools.append(hint('Fast actions for the map in front of you.'));
    const actions=node('div','field-action-grid');
    actions.append(btn('Fit question pins',()=>window.lampskeneMap.fitQuestions()),btn('Measure distance',startMeasure),btn('Save map center',()=>{
      if(!map)return;const c=map.getCenter();window.lampskeneMap.addBookmark({lat:c.lat,lng:c.lng,name:'Map center '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})});
    }),btn('Copy map coordinates',()=>copyCenter()),btn('Open 3D explorer',()=>window.lampskene3D?.open()),btn('Find my position',()=>window.lampskenePosition?.locate()));
    tools.append(actions);
    const overlays=node('div','field-toggle-list');
    for(const [key,label] of [['labels','Street labels over imagery'],['trails','Marked walking trails']]){
      const control=btn(label,()=>{prefs[key]=!prefs[key];syncOverlays();persist();});control.dataset.fieldOverlay=key;overlays.append(control);
    }
    tools.append(overlays,hint('Measurements follow straight lines. Walking routes can be longer. Marked trails come from Waymarked Trails.'));
    mountDetails();mountCombinations();mountCustomSources();
    const bar=node('div','field-measure-bar');bar.id='field-measure-bar';bar.hidden=true;
    const readout=node('div');readout.append(node('strong','','Measure distance'),node('span','','Tap map points to trace your route'));readout.lastChild.id='field-measure-readout';
    const controls=node('div','workspace-actions');controls.append(btn('Undo',()=>{points.pop();renderMeasure();}),btn('Done',finishMeasure),btn('Clear',stopMeasure));
    bar.append(readout,controls);document.body.append(bar);
  }
  function mountDetails() {
    const host=section('Local details','map-detail-settings');
    host.append(hint('Find mapped benches, water, entrances and more. Loads a local area up to 2.4 km across; zoom in for a smaller search.'));
    const grid=node('div','field-detail-grid');
    for(const d of geo.DETAILS) {
      const b=btn('',()=>{prefs.details=prefs.details.includes(d.key)?prefs.details.filter(k=>k!==d.key):[...prefs.details,d.key];persist();syncDetailButtons();renderDetails();detailStatus='Selection changed. Load this area for new details.';updateDetailStatus();},'field-detail-toggle');
      b.dataset.detail=d.key;const mark=node('span','field-detail-mark',d.icon);mark.style.setProperty('--detail-color',d.color);b.append(mark,node('span','',d.name));grid.append(b);
    }
    host.append(grid);
    const actions=node('div','workspace-actions');const load=btn('Load this area',loadDetails);load.id='field-detail-load';
    actions.append(load,btn('Clear map details',()=>{cancelRequest();detailData={type:'FeatureCollection',features:[]};loadedBounds=null;renderDetails();detailStatus='Map details cleared.';updateDetailStatus();}));
    const status=hint(detailStatus);status.id='field-detail-status';status.setAttribute('role','status');
    host.append(actions,status);
    const results=node('div','field-nearby-list');results.id='field-detail-results';host.append(results);
    host.append(hint('OpenStreetMap is community mapped, not a complete inventory. Missing dots do not mean a place is absent. Private access features are filtered.'));
    const source=node('a','field-source-link','Map data © OpenStreetMap contributors · ODbL');source.href='https://www.openstreetmap.org/copyright';source.target='_blank';source.rel='noopener';host.append(source);
    const works=node('details','field-source-details');works.append(node('summary','','Construction & official city maps'));
    works.append(hint('Orange construction features are recorded in OSM; they are not live road closures. Use official sources for current works and planning.'));
    for(const [label,url] of [['Live traffic & roadworks · Trafiken.nu','https://trafiken.nu/stockholm/'],['Stockholm maps & geodata','https://kartor.stockholm/kartor-geodata/'],['City traffic layers · API key required','https://openstreetws.stockholm.se/home/']]) {
      const link=node('a','field-source-link',label+' ↗');link.href=url;link.target='_blank';link.rel='noopener';works.append(link);
    }
    host.append(works);syncDetailButtons();
  }
  function syncDetailButtons(){document.querySelectorAll('[data-detail]').forEach(b=>b.setAttribute('aria-pressed',String(prefs.details.includes(b.dataset.detail))));}
  function updateDetailStatus(){if(by('field-detail-status'))by('field-detail-status').textContent=detailStatus;const b=by('field-detail-load');if(b){b.disabled=Boolean(request);b.textContent=request?'Loading details…':'Load this area';}}
  function queryBounds(){
    const c=map.getCenter(),v=map.getBounds();
    const north=geo.destination(c,1200,0).lat,south=geo.destination(c,1200,180).lat;
    const east=geo.destination(c,1200,90).lng,west=geo.destination(c,1200,270).lng;
    return [Math.max(south,v.getSouth()),Math.max(west,v.getWest()),Math.min(north,v.getNorth()),Math.min(east,v.getEast())];
  }
  function cancelRequest(){version++;request?.abort();request=null;updateDetailStatus();}
  async function loadDetails(){
    if(!map)return;
    if(map.getZoom()<14){detailStatus='Zoom in to street level (14+) to load local details.';updateDetailStatus();showToast(detailStatus);return;}
    if(!prefs.details.length){detailStatus='Choose at least one detail layer.';updateDetailStatus();return;}
    const bounds=queryBounds(),keys=[...prefs.details].sort(),key=JSON.stringify([bounds.map(v=>+v.toFixed(3)),keys]);
    const saved=cache.get(key);if(saved&&Date.now()-saved.at<600000){detailData=saved.data;loadedBounds=bounds;renderDetails();detailStatus='Cached local details · '+detailData.features.length+' features. Reload available after 10 minutes.';updateDetailStatus();return;}
    if(Date.now()<nextRequest){detailStatus='Please wait '+Math.ceil((nextRequest-Date.now())/1000)+' seconds before another area request.';updateDetailStatus();return;}
    cancelRequest();const current=version,controller=new AbortController();request=controller;nextRequest=Date.now()+15000;
    detailStatus='Loading selected details near this map view…';updateDetailStatus();
    const timeout=setTimeout(()=>controller.abort(),25000);
    try{
      const response=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',body:new URLSearchParams({data:geo.overpassQuery(bounds,keys)}),signal:controller.signal});
      if(!response.ok)throw Error(response.status===429?'The map service is busy. Wait a moment and retry.':'Detail service unavailable ('+response.status+'). Retry shortly.');
      const raw=await response.json();if(current!==version)return;
      detailData=geo.normalizeDetails(raw,keys);loadedBounds=bounds;cache.set(key,{data:detailData,at:Date.now()});if(cache.size>8)cache.delete(cache.keys().next().value);
      renderDetails();detailStatus=detailData.features.length+' mapped features · '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+(detailData.truncated?' · Result limit reached; zoom in for more.':raw.remark?' · Service returned partial data; retry in a smaller area.':'.');
    }catch(error){if(current===version)detailStatus=error.name==='AbortError'?'Detail request timed out. Try a smaller area.':error.message;}
    finally{clearTimeout(timeout);if(current===version){request=null;updateDetailStatus();}}
  }
  function renderDetails(){
    if(!detailLayer)return;detailLayer.clearLayers();
    const visible=detailData.features.filter(f=>prefs.details.includes(f.properties.key));
    for(const feature of visible){
      const p=feature.properties,style={color:p.color,weight:3,fillColor:p.color,fillOpacity:.16};
      const layer=feature.geometry.type==='Point'?L.circleMarker([p.lat,p.lng],{...style,radius:6,fillOpacity:.92,color:'#fff',weight:1.5}):L.geoJSON(feature,{style});
      layer.bindTooltip(node('span','',p.name));layer.bindPopup(()=>detailPopup(feature),{maxWidth:290,autoPanPadding:[24,110]});layer.addTo(detailLayer);
    }
    const list=by('field-detail-results');if(list){const center=map.getCenter(),near=[...visible].sort((a,b)=>geo.distance(center,a.properties)-geo.distance(center,b.properties)).slice(0,8);
      list.replaceChildren(...near.map(f=>{const b=btn('',()=>{window.appShell?.close();map.setView([f.properties.lat,f.properties.lng],Math.max(17,map.getZoom()));L.popup({maxWidth:290}).setLatLng([f.properties.lat,f.properties.lng]).setContent(detailPopup(f)).openOn(map);},'field-nearby');b.append(node('strong','',f.properties.name),node('small','',format(geo.distance(center,f.properties))+' from map center'));return b;}));
    }
    document.dispatchEvent(new CustomEvent('jetlag:mapdetails',{detail:{data:{type:'FeatureCollection',features:visible}}}));
  }
  function detailPopup(feature){
    const p=feature.properties,content=node('div','workspace-popup');content.append(node('span','workspace-kicker',geo.DETAILS.find(d=>d.key===p.key)?.name||'Map detail'),node('h3','',p.name));
    const info=node('dl','field-feature-info');for(const [k,v] of Object.entries(p.info)){info.append(node('dt','',k.replaceAll('_',' ')),node('dd','',v));}content.append(info);
    if(p.key==='construction')content.append(hint('OSM construction record; current access and completion are unverified.'));
    content.append(btn('Save this place',()=>window.lampskeneMap.addBookmark({lat:p.lat,lng:p.lng,name:p.name,category:p.key})));
    const link=node('a','field-source-link','View mapped feature ↗');link.href='https://www.openstreetmap.org/'+p.id;link.target='_blank';link.rel='noopener';content.append(link);return content;
  }
  function startMeasure(){
    if(!map)return;measureMode=true;points=[];window.appShell?.close();document.body.classList.add('field-measuring');by('field-measure-bar').hidden=false;renderMeasure();showToast('Tap points on the map. Done keeps the measurement visible.');
  }
  function stopMeasure(){measureMode=false;points=[];measureLayer?.clearLayers();document.body.classList.remove('field-measuring');by('field-measure-bar').hidden=true;}
  function finishMeasure(){measureMode=false;document.body.classList.remove('field-measuring');if(points.length<2){stopMeasure();return;}showToast('Measurement kept on map. Clear removes it.');}
  function renderMeasure(){
    if(!measureLayer)return;measureLayer.clearLayers();let total=0;
    for(let i=1;i<points.length;i++)total+=geo.distance(points[i-1],points[i]);
    if(points.length>1)L.polyline(points,{color:'#c7853d',weight:4,dashArray:'6 5',interactive:false}).addTo(measureLayer);
    points.forEach((p,i)=>L.circleMarker(p,{radius:5,color:'#fff',weight:2,fillColor:'#c7853d',fillOpacity:1,interactive:false}).bindTooltip(String(i+1),{permanent:true,direction:'top'}).addTo(measureLayer));
    by('field-measure-readout').textContent=points.length?format(total)+' · '+Math.round(total/80)+' min straight-line walk'+(points.length>1?' · '+Math.round(geo.bearing(points.at(-2),points.at(-1)))+'° last leg':' · tap next point'):'Tap map points to measure';
  }
  async function copyCenter(){if(!map)return;const c=map.getCenter();try{await navigator.clipboard.writeText(c.lat.toFixed(6)+', '+c.lng.toFixed(6));showToast('Map coordinates copied');}catch(_){showToast(c.lat.toFixed(6)+', '+c.lng.toFixed(6),6000);}}
  function syncOverlays(){
    if(!map)return;
    for(const [key,layer] of [['labels',labelsLayer],['trails',trailsLayer]]){if(!layer)continue;prefs[key]?layer.addTo(map):map.removeLayer(layer);document.querySelectorAll('[data-field-overlay="'+key+'"]').forEach(b=>b.setAttribute('aria-pressed',String(!!prefs[key])));}
  }
  function mountCombinations(){
    const host=section('Map combinations','map-combo-settings');host.append(hint('One tap changes the background and reference layers. Question answers stay in place.'));
    const grid=node('div','field-action-grid');
    for(const c of [{name:'Street essentials',base:'voyager',details:['bench','toilet','water']},{name:'Aerial + labels',base:'satellite',labels:true},{name:'Orienteering + trails',base:'orienteering',trails:true},{name:'Quiet question map',base:'positron'},{name:'Night transit',base:'darkmatter'}])grid.append(btn(c.name,()=>applyCombo(c)));
    host.append(grid);const label=node('label','workspace-label','Save your current combination');const input=node('input');input.id='field-combo-name';input.maxLength=40;input.placeholder='e.g. Park search';label.htmlFor=input.id;
    host.append(label,input,btn('Save combination',()=>{if(!map)return;const name=input.value.trim();if(!name){input.focus();return;}if(prefs.combos.length>=6){showToast('Six combinations saved. Remove one first.');return;}prefs.combos.push({name,base:activeLayerKey,labels:!!prefs.labels,trails:!!prefs.trails,details:[...prefs.details],opacity:typeof getBlueOverlayOpacity==='function'?getBlueOverlayOpacity():.3});input.value='';persist();renderCombos();}));
    const list=node('div','field-combo-list');list.id='field-combo-list';host.append(list);renderCombos();
  }
  function applyCombo(c){
    if(!map)return;setBase(c.base);prefs.labels=!!c.labels;prefs.trails=!!c.trails;if(Array.isArray(c.details))prefs.details=c.details.filter(k=>geo.DETAILS.some(d=>d.key===k));
    if(Number.isFinite(c.opacity)&&typeof setBlueOpacitySetting==='function')setBlueOpacitySetting(c.opacity*100);
    syncDetailButtons();syncOverlays();renderDetails();persist();showToast(c.name+' applied'+(c.details?' · load local details when ready':''));
  }
  function renderCombos(){const list=by('field-combo-list');if(!list)return;list.replaceChildren(...prefs.combos.map((c,i)=>{const row=node('div','workspace-place');row.append(btn(c.name,()=>applyCombo(c),'workspace-place-main'),btn('×',()=>{prefs.combos.splice(i,1);persist();renderCombos();},'workspace-place-save'));row.lastChild.setAttribute('aria-label','Remove '+c.name+' combination');return row;}));}
  function validSource(s){try{return s&&typeof s.name==='string'&&s.name.length<=60&&['xyz','wms'].includes(s.type)&&new URL(s.url).protocol==='https:'&&!new URL(s.url).username&&!new URL(s.url).password&&(s.type!=='wms'||typeof s.layers==='string'&&s.layers.length>0);}catch(_){return false;}}
  function mountCustomSources(){
    const host=section('Custom map sources','map-custom-settings');host.append(hint('Add an HTTPS XYZ or WMS overlay from a provider you may use. This supports local orienteering maps and city planning layers when their provider grants access. Sources are stored on this device.'));
    const form=node('form','field-source-form');
    for(const [id,label,placeholder] of [['name','Name','My local map'],['url','Service URL','https://provider.example/tiles/{z}/{x}/{y}.png'],['layers','WMS layer names','Layer names from the provider'],['attribution','Attribution','Map © provider']]){const l=node('label','workspace-label',label),i=node('input');i.id='field-source-'+id;i.name=id;i.maxLength=id==='url'?2000:120;i.placeholder=placeholder;i.required=['name','url'].includes(id);l.htmlFor=i.id;form.append(l,i);}
    const type=node('select');type.id='field-source-type';type.name='type';for(const [value,label] of [['xyz','XYZ tiles'],['wms','WMS 1.1.1']]){const opt=node('option','',label);opt.value=value;type.append(opt);}const typeLabel=node('label','workspace-label','Source type');typeLabel.htmlFor=type.id;form.prepend(typeLabel,type);
    const submit=node('button','workspace-btn','Add overlay');submit.type='submit';form.append(submit);
    form.addEventListener('submit',event=>{event.preventDefault();if(prefs.sources.length>=3){showToast('Three custom overlays saved. Remove one first.');return;}const values=Object.fromEntries(new FormData(form));values.name=values.name.trim();values.url=values.url.trim();values.layers=values.layers.trim();if(!validSource(values)||(values.type==='xyz'&&!['{z}','{x}','{y}'].every(t=>values.url.includes(t)))){showToast('Use an HTTPS URL, XYZ placeholders, or a WMS URL and layer name.');return;}prefs.sources.push({...values,id:'custom-'+Date.now(),enabled:true,opacity:.65});persist();renderSources();syncSources();form.reset();});
    host.append(form);const list=node('div','field-source-list');list.id='field-source-list';host.append(list);renderSources();
  }
  function escapeAttribution(text){return String(text||'Custom map source').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function syncSources(){
    if(!map)return;for(const [id,l] of sourceLayers)if(!prefs.sources.some(s=>s.id===id)){map.removeLayer(l);sourceLayers.delete(id);}
    for(const s of prefs.sources){
      let layer=sourceLayers.get(s.id);if(!layer){const options={maxZoom:20,maxNativeZoom:19,opacity:Number.isFinite(s.opacity)?s.opacity:.65,updateWhenIdle:true,updateWhenZooming:false,attribution:escapeAttribution(s.attribution)};layer=s.type==='wms'?L.tileLayer.wms(s.url,{...options,layers:s.layers,format:'image/png',transparent:true,version:'1.1.1'}):L.tileLayer(s.url,options);let errors=0,loaded=0;layer.on('tileload',()=>loaded++);layer.on('tileerror',()=>{if(++errors>=5&&!loaded&&s.enabled){s.enabled=false;map.removeLayer(layer);persist();renderSources();showToast(s.name+' unavailable. Check URL, layer name and provider access.',5000);}});sourceLayers.set(s.id,layer);}
      s.enabled?layer.addTo(map):map.removeLayer(layer);layer.setOpacity(Number.isFinite(s.opacity)?s.opacity:.65);
    }
  }
  function renderSources(){const list=by('field-source-list');if(!list)return;list.replaceChildren(...prefs.sources.map((s,index)=>{const row=node('div','field-source-card');const toggle=btn(s.name,()=>{s.enabled=!s.enabled;persist();syncSources();renderSources();});toggle.setAttribute('aria-pressed',String(!!s.enabled));const range=node('input');range.type='range';range.min='10';range.max='100';range.value=String(Math.round((s.opacity||.65)*100));range.setAttribute('aria-label',s.name+' opacity');range.addEventListener('input',()=>{s.opacity=+range.value/100;sourceLayers.get(s.id)?.setOpacity(s.opacity);persist();});const remove=btn('Remove',()=>{prefs.sources.splice(index,1);persist();syncSources();renderSources();});row.append(toggle,range,remove);return row;}));}
  function init(){
    detailLayer=L.layerGroup().addTo(map);measureLayer=L.layerGroup().addTo(map);
    labelsLayer=L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',{maxZoom:20,maxNativeZoom:18,pane:'overlayPane',opacity:.9,updateWhenZooming:false,attribution:'Reference labels &copy; Esri'});
    trailsLayer=L.tileLayer('https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png',{maxZoom:20,maxNativeZoom:18,pane:'overlayPane',updateWhenZooming:false,attribution:'Trails &copy; <a href="https://hiking.waymarkedtrails.org/">Waymarked Trails</a>, OpenStreetMap'});
    syncOverlays();syncSources();
    map.on('click',e=>{if(measureMode){points.push({lat:e.latlng.lat,lng:e.latlng.lng});renderMeasure();}});
    map.on('moveend',()=>{if(loadedBounds){detailStatus='Map moved · '+detailData.features.length+' loaded features. Load this area to refresh.';updateDetailStatus();}});
    map.on('zoomstart',()=>document.body.classList.add('field-map-moving'));map.on('zoomend',()=>document.body.classList.remove('field-map-moving'));
  }
  document.addEventListener('jetlag:basemap',event=>{if(event.detail.key==='orienteering'){prefs.trails=true;persist();syncOverlays();}});
  document.addEventListener('jetlag:panelchange',e=>{if(e.detail.panel!=='map'&&measureMode)finishMeasure();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&measureMode)finishMeasure();});
  mount();const original=window.initMap;window.initMap=function(){original.apply(this,arguments);init();};
  window.lampskeneMapTools={consumesMapClick:()=>measureMode,startMeasure,stopMeasure,loadDetails,details:()=>({type:'FeatureCollection',features:detailData.features.filter(f=>prefs.details.includes(f.properties.key))}),open:()=>window.appShell?.openSettingsSection('map-tools-settings')};
})();
