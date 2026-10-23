/* Optional lazy-loaded 3D explorer. The Leaflet game and its trackers stay authoritative. */
(function() {
  'use strict';
  const geo=window.lampskeneGeo,VERSION='5.24.0';
  const empty=()=>({type:'FeatureCollection',features:[]});
  const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const by=id=>document.getElementById(id);
  let gl=null,loading=null,epoch=0,isOpen=false,lastFocus=null,refreshInterval=null,loadTimer=null;
  let settings={terrain:true,buildings:true,vehicles:true,details:true};
  let vehicleLookup=new Map(),questionLookup=new Map(),lastVehicleSignature='';
  const sourceSignatures=new Map();
  function loadLibrary(){
    if(window.maplibregl)return Promise.resolve(window.maplibregl);
    if(loading)return loading;
    loading=new Promise((resolve,reject)=>{
      if(!by('maplibre-css')){const css=node('link');css.id='maplibre-css';css.rel='stylesheet';css.href='vendor/maplibre-gl-'+VERSION+'.css';document.head.append(css);}
      const script=node('script');script.src='vendor/maplibre-gl-'+VERSION+'.js';script.async=true;script.id='maplibre-script';
      const timer=setTimeout(()=>{script.remove();loading=null;reject(Error('3D library timed out. Check your connection and retry.'));},25000);
      script.onload=()=>{clearTimeout(timer);if(window.maplibregl)resolve(window.maplibregl);else{loading=null;reject(Error('3D library did not load.'));}};
      script.onerror=()=>{clearTimeout(timer);script.remove();loading=null;reject(Error('3D library unavailable. Check your connection and retry.'));};document.head.append(script);
    });return loading;
  }
  function mount(){
    const host=node('section','map3d-explorer');host.id='map3d-explorer';host.hidden=true;host.setAttribute('aria-label','3D map explorer');
    host.innerHTML='<div id="map3d-canvas"></div><header class="map3d-header"><div><strong>3D map</strong></div><button type="button" id="map3d-back">Back to game</button></header><div id="map3d-loading" class="map3d-loading" role="status"><strong>Opening 3D map…</strong></div><div class="map3d-toolbar"><button type="button" id="map3d-use-view">Use view in 2D</button><button type="button" id="map3d-north">North ↑</button><button type="button" id="map3d-tilt">Flat</button></div><details class="map3d-options"><summary>Layers</summary><div id="map3d-toggles"></div><p>Edit pins and answer zones in 2D. Terrain and buildings depend on map coverage.</p></details><div class="map3d-status" id="map3d-status" role="status">Two fingers to rotate or tilt</div>';
    document.body.append(host);
    by('map3d-back').addEventListener('click',()=>close());by('map3d-use-view').addEventListener('click',()=>close(true));
    by('map3d-north').addEventListener('click',()=>gl?.easeTo({bearing:0,duration:350}));by('map3d-tilt').addEventListener('click',()=>{if(!gl)return;const pitch=gl.getPitch()>20?0:55;gl.easeTo({pitch,duration:350});by('map3d-tilt').textContent=pitch?'Flat':'Tilt';});
    for(const [key,label] of [['terrain','Terrain'],['buildings','Buildings'],['vehicles','Vehicles'],['details','Local details']]){
      const b=node('button','',label);b.type='button';b.dataset.map3dToggle=key;b.setAttribute('aria-pressed',String(settings[key]));b.addEventListener('click',()=>{settings[key]=!settings[key];syncLayers();});by('map3d-toggles').append(b);
    }
    const transit=node('button','','Enable live transit feed');transit.type='button';transit.id='map3d-enable-transit';transit.addEventListener('click',()=>{if(!window.lampskeneTracker?.state().enabled)window.lampskeneTracker?.toggleAll();});by('map3d-toggles').append(transit);
    const panel=node('div','workspace-section');panel.id='map-3d-settings';panel.innerHTML='<div class="sp-label">3D map</div>';
    const openButton=node('button','workspace-btn','Open 3D map');openButton.type='button';openButton.addEventListener('click',open);panel.append(openButton);by('settings-panel').append(panel);
  }
  function status(text){by('map3d-status').textContent=text;}
  async function open(){
    if(typeof map==='undefined'||!map)return;
    if(isOpen)return;
    lastFocus=document.activeElement;window.appShell?.close({restoreFocus:false});window.lampskeneQuestions?.closeInspector();window.lampskeneMapTools?.stopMeasure();window.lampskenePosition?.setFollow(false);window.lampskeneTracker?.stopFollowing();
    isOpen=true;const version=++epoch;by('map3d-explorer').hidden=false;document.body.classList.add('map3d-active');by('map3d-loading').hidden=false;by('map3d-loading').removeAttribute('data-state');by('map3d-loading').innerHTML='<strong>Opening 3D map…</strong>';by('map3d-tilt').textContent='Flat';by('map3d-back').focus({preventScroll:true});
    try{
      const lib=await loadLibrary();if(version!==epoch||!isOpen)return;
      const probe=document.createElement('canvas'),context=probe.getContext('webgl2');
      if(!context)throw Error('This browser cannot create a 3D map. The 2D game is still available.');
      context.getExtension('WEBGL_lose_context')?.loseContext();
      lib.setWorkerCount(2);
      const c=map.getCenter();gl=new lib.Map({container:'map3d-canvas',style:'https://tiles.openfreemap.org/styles/liberty',center:[c.lng,c.lat],zoom:Math.max(12,map.getZoom()-1),pitch:55,bearing:0,maxZoom:19,antialias:false,attributionControl:{compact:true},maxPitch:70});
      gl.addControl(new lib.NavigationControl({visualizePitch:true}),'top-right');
      loadTimer=setTimeout(()=>{if(version===epoch&&isOpen&&!gl?.isStyleLoaded()){by('map3d-loading').innerHTML='<strong>3D map is taking longer to load</strong><p>Check your connection, or return to the game and retry.</p>';}},22000);
      gl.on('load',()=>{clearTimeout(loadTimer);loadTimer=null;if(version!==epoch)return;by('map3d-loading').hidden=true;addSources();syncLayers();refreshAll();if(!document.hidden)refreshInterval=setInterval(refreshAll,5000);});
      gl.on('error',event=>{if(version!==epoch)return;if(event.sourceId==='field-terrain'){settings.terrain=false;syncLayers();status('Terrain tiles unavailable · buildings and 2D game remain available.');}else if(!gl.isStyleLoaded()){by('map3d-loading').innerHTML='<strong>3D map data unavailable</strong><p>Try again later. Back to game returns to your working map.</p>';}});
      gl.on('webglcontextlost',()=>{status('3D graphics paused by your browser. Return to the game to continue.');});
      gl.on('moveend',refreshAll);
    }catch(error){if(version===epoch){by('map3d-loading').dataset.state='error';by('map3d-loading').replaceChildren(node('strong','',error.message),node('p','','Use Back to game to continue.'));}}
  }
  function close(useView=false){
    if(!isOpen)return;epoch++;isOpen=false;clearInterval(refreshInterval);refreshInterval=null;clearTimeout(loadTimer);loadTimer=null;
    const camera=gl&&useView?{center:gl.getCenter(),zoom:gl.getZoom()+1}:null;
    gl?.stop();gl?.remove();gl=null;lastVehicleSignature='';sourceSignatures.clear();vehicleLookup.clear();questionLookup.clear();by('map3d-explorer').hidden=true;document.body.classList.remove('map3d-active');
    if(camera&&map)map.setView([camera.center.lat,camera.center.lng],camera.zoom,{animate:false});
    const closeVersion=epoch;
    requestAnimationFrame(()=>{if(isOpen||epoch!==closeVersion||!map)return;map.invalidateSize({pan:false});if(typeof scheduleRebuild==='function')scheduleRebuild();});
    if(lastFocus?.isConnected&&lastFocus.getClientRects().length)lastFocus.focus({preventScroll:true});
  }
  function addSources(){
    gl.addSource('field-terrain',{type:'raster-dem',url:'https://tiles.mapterhorn.com/tilejson.json',tileSize:512,encoding:'terrarium'});
    for(const id of ['field-vehicles','field-questions','field-details','field-position','field-players'])gl.addSource(id,{type:'geojson',data:empty()});
    gl.addLayer({id:'field-vehicle-bodies',type:'fill-extrusion',source:'field-vehicles',minzoom:12,paint:{'fill-extrusion-color':['get','color'],'fill-extrusion-height':['get','height'],'fill-extrusion-opacity':1}});
    gl.addLayer({id:'field-vehicle-labels',type:'symbol',source:'field-vehicles',minzoom:13,layout:{'text-field':['get','line'],'text-size':12,'text-offset':[0,-1.1],'text-font':['Noto Sans Regular'],'text-allow-overlap':false},paint:{'text-color':'#20302a','text-halo-color':'#fffdf5','text-halo-width':2}});
    gl.addLayer({id:'field-question-pins',type:'circle',source:'field-questions',paint:{'circle-radius':8,'circle-color':['get','color'],'circle-stroke-color':'#fff','circle-stroke-width':2}});
    gl.addLayer({id:'field-question-labels',type:'symbol',source:'field-questions',layout:{'text-field':['get','label'],'text-size':12,'text-offset':[0,1.4],'text-font':['Noto Sans Regular']},paint:{'text-color':'#20302a','text-halo-color':'#fffdf5','text-halo-width':2}});
    gl.addLayer({id:'field-detail-points',type:'circle',source:'field-details',filter:['==',['geometry-type'],'Point'],paint:{'circle-radius':5,'circle-color':['get','color'],'circle-stroke-color':'#fff','circle-stroke-width':1}});
    gl.addLayer({id:'field-detail-lines',type:'line',source:'field-details',filter:['!=',['geometry-type'],'Point'],paint:{'line-color':['get','color'],'line-width':3}});
    gl.addLayer({id:'field-player-pins',type:'circle',source:'field-players',paint:{'circle-radius':8,'circle-color':'#b76cce','circle-stroke-color':'#fff','circle-stroke-width':2}});
    gl.addLayer({id:'field-position-pin',type:'circle',source:'field-position',paint:{'circle-radius':9,'circle-color':'#3085d8','circle-stroke-color':'#fff','circle-stroke-width':3}});
    gl.on('click','field-vehicle-bodies',event=>{
      const id=event.features?.[0]?.properties.id,v=vehicleLookup.get(id);if(!v)return;
      window.lampskeneTracker?.select(id,false);const info=window.lampskeneTracker.info(v),content=node('div','map3d-popup');content.append(node('strong','',((info.type||'Vehicle')+' '+(info.line||v.label||'')).trim()),node('p','','Latest received feed position. Shape and size are simplified.'));
      new maplibregl.Popup().setLngLat([v.lng,v.lat]).setDOMContent(content).addTo(gl);
    });
    gl.on('click','field-question-pins',event=>{const pin=questionLookup.get(event.features?.[0]?.properties.key);if(!pin)return;close();window.lampskeneQuestions?.preview(pin.id);});
    for(const layer of ['field-question-pins','field-vehicle-bodies']){gl.on('mouseenter',layer,()=>gl.getCanvas().style.cursor='pointer');gl.on('mouseleave',layer,()=>gl.getCanvas().style.cursor='');}
  }
  function syncLayers(){
    document.querySelectorAll('[data-map3d-toggle]').forEach(b=>b.setAttribute('aria-pressed',String(settings[b.dataset.map3dToggle])));
    if(!gl||!gl.getSource('field-terrain'))return;
    gl.setTerrain(settings.terrain?{source:'field-terrain',exaggeration:1.1}:null);
    for(const layer of gl.getStyle().layers)if(layer.type==='fill-extrusion'&&layer.id!=='field-vehicle-bodies')gl.setLayoutProperty(layer.id,'visibility',settings.buildings?'visible':'none');
    for(const [flag,layers] of [['vehicles',['field-vehicle-bodies','field-vehicle-labels']],['details',['field-detail-points','field-detail-lines']]])for(const id of layers)gl.setLayoutProperty(id,'visibility',settings[flag]?'visible':'none');
  }
  function refreshAll(){
    if(document.hidden||!isOpen||!gl?.getSource('field-vehicles'))return;
    const bounds={contains:([lat,lng])=>gl.getBounds().contains([lng,lat])};
    const state=window.lampskeneTracker?.state(bounds),vehicles=state?.vehicles||[];
    vehicleLookup=new Map(vehicles.map(v=>[v.id,v]));
    const signature=JSON.stringify(vehicles.map(v=>[v.id,v.lat,v.lng,v.bearing,window.lampskeneTracker.info(v)]));
    if(signature!==lastVehicleSignature){lastVehicleSignature=signature;const features=vehicles.slice(0,1500).filter(geo.validPoint).map(v=>{const info=window.lampskeneTracker.info(v),bearing=v.bearing>=0?v.bearing:window.lampskeneTracker.motion(v)?.bearing||0;const length={bus:12,subway:42,train:55,tram:28,light_rail:28,ferry:25}[info.type]||10;return {type:'Feature',geometry:{type:'Polygon',coordinates:[geo.vehicleFootprint(v,bearing,length,info.type==='ferry'?7:2.8)]},properties:{id:v.id,line:info.line||'',height:info.type==='ferry'?7:3.4,color:info.color?(/^[0-9a-f]{6}$/i.test(info.color)?'#'+info.color:info.color):'#c07836'}};});gl.getSource('field-vehicles').setData({type:'FeatureCollection',features});}
    const pins=window.lampskeneQuestions?.publicPins?.()||[];questionLookup=new Map(pins.map(p=>[String(p.id)+'/'+p.pin,p]));setSourceData('field-questions',{type:'FeatureCollection',features:pins.filter(geo.validPoint).map(p=>({type:'Feature',geometry:{type:'Point',coordinates:[p.lng,p.lat]},properties:{key:String(p.id)+'/'+p.pin,label:p.label,color:p.color||'#d38c37'}}))});
    const detail=window.lampskeneMapTools?.details()||empty();setSourceData('field-details',detail);
    updatePosition();
    const players=[];if(typeof trackerMarkers!=='undefined'&&typeof trackerActiveIds!=='undefined')for(const id of trackerActiveIds){const marker=trackerMarkers[id];if(marker&&map.hasLayer(marker)&&typeof trackerStatusFor==='function'&&trackerStatusFor(id)==='Live'){const p=marker.getLatLng();if(geo.validPoint(p))players.push({type:'Feature',geometry:{type:'Point',coordinates:[p.lng,p.lat]},properties:{id}});}}setSourceData('field-players',{type:'FeatureCollection',features:players});
    by('map3d-enable-transit').hidden=Boolean(state?.enabled);
    status((state?.enabled?(state.paused?'Transit paused · ':vehicles.length+' live feed vehicles · '):'Live transit off · ')+pins.length+' public question pins · '+detail.features.length+' street details');
  }
  function setSourceData(id,data){const signature=JSON.stringify(data);if(sourceSignatures.get(id)===signature)return;const source=gl?.getSource(id);if(source){sourceSignatures.set(id,signature);source.setData(data);}}
  function updatePosition(){if(document.hidden||!isOpen||!gl?.getSource('field-position'))return;const position=window.lampskenePosition?.status;setSourceData('field-position',position?.running&&!position.stale&&geo.validPoint(position.fix)?{type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:[position.fix.lng,position.fix.lat]},properties:{}}]}:empty());}
  mount();window.lampskene3D={open,close,get active(){return isOpen;},get map(){return gl;}};
  window.addEventListener('tracker:update',refreshAll);document.addEventListener('jetlag:positionchange',updatePosition);document.addEventListener('jetlag:mapdetails',refreshAll);
  document.addEventListener('visibilitychange',()=>{clearInterval(refreshInterval);refreshInterval=null;if(!isOpen)return;if(document.hidden)gl?.stop();else{gl?.resize();refreshAll();refreshInterval=setInterval(refreshAll,5000);}});
  window.addEventListener('pagehide',()=>close());
  document.addEventListener('jetlag:panelchange',e=>{if(e.detail.panel!=='map'&&isOpen)close();});document.addEventListener('jetlag:rolechange',()=>close());
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&isOpen)close();});
})();
