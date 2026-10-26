/* Optional lazy-loaded 3D explorer. The Leaflet game and its trackers stay authoritative. */
(function() {
  'use strict';
  const geo=window.lampskeneGeo,VERSION='5.24.0';
  const empty=()=>({type:'FeatureCollection',features:[]});
  const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const by=id=>document.getElementById(id);
  let gl=null,loading=null,epoch=0,isOpen=false,lastFocus=null,refreshInterval=null,loadTimer=null;
  let settings={terrain:true,buildings:true,landmarks:true,details:true,questions:true};
  let styleKey='clean',geometrySignature='',moveTimer=null,terrainFallback=false;
  try{styleKey=localStorage.getItem('lampskene_3d_background')||'clean';}catch(_){}
  let nativeBackgroundLayers=[],nativeBuildings=[],landmarkFootprints=null,replacementTimer=null,replacementGeneration=0,replacementWorker=null,replacementBusy=false,replacementDirty=false;
  let vehicleLookup=new Map(),questionLookup=new Map(),lastVehicleSignature='';
  const sourceSignatures=new Map();
  let exploreMode='orbit',explorePoint=null,exploreBearing=0,orbitCamera=null,driveFrame=null,driveTime=0,exploreVariant='city',exploreSpeed=1,lastExplorerUpdate=0;
  let explorerMesh=null,explorerModelKey='',lookYaw=0,lookPitch=0,lookPointer=null,lookFrame=null;
  const pressed=new Set();
  function setBackground(key){
    if(key!=='clean'&&!window.lampskeneMap?.styles?.some(s=>s.key===key))key='clean';
    styleKey=key;by('map3d-style').value=key;if(!gl?.getSource('field-vehicles'))return;
    try{localStorage.setItem('lampskene_3d_background',key);}catch(_){}
    if(gl.getLayer('field-basemap'))gl.removeLayer('field-basemap');if(gl.getSource('field-basemap'))gl.removeSource('field-basemap');
    // Keep the vector background underneath raster tiles blank, so a tile loading
    // at another zoom never exposes a different map or its road labels.
    for(const layer of nativeBackgroundLayers)gl.setLayoutProperty(layer.id,'visibility',key==='clean'&&layer.type!=='symbol'?'visible':'none');
    if(key==='clean')return;
    const source=window.lampskeneMap?.rasterStyle(key);if(!source)return;
    gl.addSource('field-basemap',source);
    const building=gl.getStyle().layers.find(l=>l.type==='fill-extrusion'&&!l.id.startsWith('field-'));
    gl.addLayer({id:'field-basemap',type:'raster',source:'field-basemap',paint:{'raster-opacity':1,'raster-fade-duration':0}},gl.getLayer('field-game-area-solids')?'field-game-area-solids':building?.id||'field-rail-lines');
    // Raster styles already contain their own place labels.
    for(const layer of gl.getStyle().layers)if(layer.type==='symbol'&&!layer.id.startsWith('field-'))gl.setLayoutProperty(layer.id,'visibility','none');
  }
  function refreshGeometry(){
    if(!gl?.getSource('field-question-areas')||!window.lampskeneQuestionGeometry)return;
    const bounds=gl.getBounds();
    const signature=JSON.stringify([settings.questions,bounds.toArray(),(typeof questions==='undefined'?[]:questions).map(q=>[q.id,typeof questionCode==='function'?questionCode(q,true):null]),window.lampskeneQuestions?.previewId,typeof _cityBoundaryOn!=='undefined'&&[_cityBoundaryOn,Boolean(_cityBoundaryData)],typeof _gameAreaMode!=='undefined'&&[_gameAreaMode,Boolean(_gameAreaGeoCache[_gameAreaMode])]]);
    if(signature===geometrySignature)return;geometrySignature=signature;
    try{
      const result=window.lampskeneQuestionGeometry.build(bounds);
      setSourceData('field-question-areas',settings.questions?result.areas:empty());setSourceData('field-question-walls',settings.questions?result.walls:empty());setSourceData('field-game-area',result.gameArea||empty());
    }catch(error){geometrySignature='';console.warn('3D question geometry:',error);status('Question geometry could not be drawn. Return to 2D to inspect.');}
  }
  function stopExploring(restore=false){
    const wasExploring=exploreMode!=='orbit';exploreMode='orbit';pressed.clear();
    if(driveFrame!==null){cancelAnimationFrame(driveFrame);driveFrame=null;}driveTime=0;
    lookPointer=null;lookYaw=0;lookPitch=0;if(lookFrame!==null){cancelAnimationFrame(lookFrame);lookFrame=null;}explorerMesh?.clear();explorerModelKey='';
    if(gl){gl.setCenterClampedToGround?.(true);gl.dragPan?.enable();gl.dragRotate?.enable();gl.doubleClickZoom?.enable();gl.scrollZoom?.enable();}
    if(by('map3d-explore'))by('map3d-explore').value='orbit';if(by('map3d-drive-options'))by('map3d-drive-options').hidden=true;gl?.keyboard?.enable();gl?.getSource('field-explorer')?.setData(empty());
    if(wasExploring&&restore&&gl&&orbitCamera)gl.easeTo({...orbitCamera,duration:400});
  }
  function startExploring(mode){
    if(mode==='orbit'){stopExploring(true);return;}
    if(!gl?.getSource('field-vehicles'))return;
    if(window.matchMedia&&!window.matchMedia('(pointer:fine)').matches){by('map3d-explore').value='orbit';status('Pedestrian, car and boat controls use a desktop keyboard.');return;}
    if(!['walk','car','boat'].includes(mode))return;
    if(exploreMode==='orbit'){orbitCamera={center:gl.getCenter(),zoom:gl.getZoom(),pitch:gl.getPitch(),bearing:gl.getBearing(),elevation:gl.getCenterElevation()};lookYaw=0;lookPitch=0;explorePoint={lat:gl.getCenter().lat,lng:gl.getCenter().lng};exploreBearing=gl.getBearing();}
    exploreMode=mode;lastExplorerUpdate=0;gl.keyboard?.disable();gl.setCenterClampedToGround(false);gl.dragPan.disable();gl.dragRotate.disable();gl.doubleClickZoom.disable();gl.scrollZoom.disable();
    if(!explorerMesh&&window.lampskeneExplorerMesh){try{explorerMesh=window.lampskeneExplorerMesh.create(gl);gl.setLayoutProperty('field-explorer-body','visibility','none');}catch(error){console.warn('Explorer mesh unavailable:',error.message);}}by('map3d-drive-options').hidden=false;by('map3d-car').hidden=mode!=='car';
    by('map3d-explore').value=mode;positionCamera();
    gl.getCanvas().focus({preventScroll:true});
    status('Drag to look · R resets view · W/S move · A/D turn · Q/E sideways · Shift faster · Esc exits');
  }
  function positionCamera(){
    if(!gl||!explorePoint)return;
    const behind={walk:8,car:20,boat:28}[exploreMode]||8,height={walk:5,car:9,boat:12}[exploreMode]||5;
    const ground=settings.terrain?(gl.queryTerrainElevation([explorePoint.lng,explorePoint.lat])||0):0;
    const eye=geo.destination(explorePoint,behind,exploreBearing+180),pitch=Math.max(20,Math.min(85,71+lookPitch)),distance=behind*1.18;
    const aim=geo.destination(eye,distance,exploreBearing+lookYaw),altitude=ground+height-distance/Math.tan(pitch*Math.PI/180);
    const options=gl.calculateCameraOptionsFromTo([eye.lng,eye.lat],ground+height,[aim.lng,aim.lat],altitude);
    gl.jumpTo({...options,pitch,zoom:Math.min(23,options.zoom)});
    if(explorerMesh){
      explorerMesh.set(explorePoint,exploreMode,exploreVariant,exploreBearing,ground);
      const key=exploreMode+'/'+exploreVariant;if(explorerModelKey!==key){explorerModelKey=key;gl.getSource('field-explorer').setData(window.lampskeneModels.explorer(explorePoint,exploreMode,exploreVariant,exploreBearing));}
    }else{
      const now=performance.now();if(!lastExplorerUpdate||now-lastExplorerUpdate>100){lastExplorerUpdate=now;gl.getSource('field-explorer')?.setData(window.lampskeneModels.explorer(explorePoint,exploreMode,exploreVariant,exploreBearing));}
    }
  }
  function lookBy(dx,dy){
    lookYaw=(lookYaw+dx*.23)%360;lookPitch=Math.max(-51,Math.min(14,lookPitch-dy*.18));
    if(lookFrame===null)lookFrame=requestAnimationFrame(()=>{lookFrame=null;positionCamera();});
  }

  function drive(time){
    driveFrame=null;if(!gl||!isOpen||exploreMode==='orbit'||!pressed.size||document.hidden)return;
    const dt=driveTime?Math.min(.1,(time-driveTime)/1000):.016;driveTime=time;
    const turn=(pressed.has('d')||pressed.has('arrowright')?1:0)-(pressed.has('a')||pressed.has('arrowleft')?1:0);
    exploreBearing=(exploreBearing+turn*65*dt+360)%360;
    const forward=(pressed.has('w')||pressed.has('arrowup')?1:0)-(pressed.has('s')||pressed.has('arrowdown')?1:0);
    const sideways=(pressed.has('e')?1:0)-(pressed.has('q')?1:0),speed=({walk:1.5,car:10,boat:5}[exploreMode]||1.5)*exploreSpeed*(pressed.has('shift')?2:1);
    if(!turn&&!forward&&!sideways){driveTime=0;return;}
    if(forward)explorePoint=geo.destination(explorePoint,speed*dt,exploreBearing+(forward<0?180:0));
    if(sideways)explorePoint=geo.destination(explorePoint,speed*dt,exploreBearing+(sideways<0?-90:90));
    positionCamera();driveFrame=requestAnimationFrame(drive);
  }
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
    host.innerHTML='<div id="map3d-canvas"></div><header class="map3d-header"><button type="button" id="map3d-back">Back to game</button></header><div id="map3d-loading" class="map3d-loading" role="status"><strong>Opening 3D map…</strong></div><div class="map3d-toolbar"><button type="button" id="map3d-north">North ↑</button><select id="map3d-explore" aria-label="Desktop exploration"><option value="orbit">Orbit</option><option value="walk">Pedestrian</option><option value="car">Car</option><option value="boat">Boat</option></select><span id="map3d-drive-options" hidden><select id="map3d-car" aria-label="Car model"><option value="city">City car</option><option value="sport">Sports car</option><option value="van">Camper van</option></select><select id="map3d-speed" aria-label="Exploration speed"><option value="0.5">Slow</option><option value="1" selected>Cruise</option><option value="2">Fast</option></select></span></div><details class="map3d-options"><summary>Layers</summary><div class="map3d-layer-content"><label for="map3d-style">Map background</label><select id="map3d-style"></select><div id="map3d-toggles"></div></div></details><div class="map3d-status" id="map3d-status" role="status">Drag to explore · right-drag to look around</div>';
    document.body.append(host);
    const canvas=by('map3d-canvas');
    canvas.addEventListener('pointerdown',event=>{if(exploreMode==='orbit'||![0,2].includes(event.button))return;lookPointer={id:event.pointerId,x:event.clientX,y:event.clientY};canvas.setPointerCapture(event.pointerId);event.preventDefault();event.stopImmediatePropagation();gl?.getCanvas().focus();},true);
    canvas.addEventListener('pointermove',event=>{if(!lookPointer||event.pointerId!==lookPointer.id)return;lookBy(event.clientX-lookPointer.x,event.clientY-lookPointer.y);lookPointer.x=event.clientX;lookPointer.y=event.clientY;event.preventDefault();event.stopImmediatePropagation();},true);
    const release=event=>{if(lookPointer&&event.pointerId===lookPointer.id){lookPointer=null;event.stopImmediatePropagation();}};
    canvas.addEventListener('pointerup',release,true);canvas.addEventListener('pointercancel',release,true);
    canvas.addEventListener('contextmenu',event=>{if(exploreMode!=='orbit')event.preventDefault();});
    by('map3d-back').addEventListener('click',()=>close(true));
    by('map3d-north').addEventListener('click',()=>{if(exploreMode!=='orbit'){lookYaw=-exploreBearing;lookPitch=0;positionCamera();gl.getCanvas().focus();}else gl?.easeTo({bearing:0,duration:350});});
    for(const [key,label] of [['terrain','Terrain'],['buildings','Buildings'],['landmarks','Coloured landmarks'],['questions','Question areas & walls'],['details','Local detail results']]){
      const b=node('button','',label);b.type='button';b.dataset.map3dToggle=key;b.setAttribute('aria-pressed',String(settings[key]));b.addEventListener('click',()=>{settings[key]=!settings[key];syncLayers();});by('map3d-toggles').append(b);
    }
    const transit=node('button','','Live transit');transit.type='button';transit.id='map3d-enable-transit';transit.addEventListener('click',()=>{const tracker=window.lampskeneTracker;if(tracker)tracker.setEnabled(!tracker.state().enabled);refreshAll();});by('map3d-toggles').append(transit);
    const rail=node('button','','SL rail network');rail.type='button';rail.id='map3d-rail';rail.addEventListener('click',()=>{window.lampskeneRail?.toggle();refreshAll();});by('map3d-toggles').append(rail);
    const contours=node('button','','Height contours');contours.type='button';contours.id='map3d-contours';contours.addEventListener('click',()=>{window.lampskeneContours?.toggle();refreshAll();});by('map3d-toggles').append(contours);
    const details=node('button','','Search local details in 2D');details.type='button';details.addEventListener('click',()=>{close(true);window.lampskeneMapTools?.openDetails();});by('map3d-toggles').append(details);
    const clean=node('option','','Clean 3D · no labels');clean.value='clean';by('map3d-style').append(clean);
    for(const item of window.lampskeneMap?.styles||[]){const option=node('option','',item.name);option.value=item.key;by('map3d-style').append(option);}
    by('map3d-style').addEventListener('change',()=>setBackground(by('map3d-style').value));
    by('map3d-explore').addEventListener('change',()=>startExploring(by('map3d-explore').value));
    by('map3d-car').addEventListener('change',()=>{exploreVariant=by('map3d-car').value;lastExplorerUpdate=0;positionCamera();gl?.getCanvas().focus();});
    by('map3d-speed').addEventListener('change',()=>{exploreSpeed=Number(by('map3d-speed').value)||1;gl?.getCanvas().focus();});
    const panel=node('div','workspace-section');panel.id='map-3d-settings';panel.innerHTML='<div class="sp-label">3D map</div>';
    const openButton=node('button','workspace-btn','Open 3D map');openButton.type='button';openButton.addEventListener('click',open);panel.append(openButton);by('settings-panel').append(panel);
  }
  function status(text){by('map3d-status').textContent=text;}
  async function open(){
    if(typeof map==='undefined'||!map)return;
    if(isOpen)return;
    lastFocus=document.activeElement;window.appShell?.close({restoreFocus:false});window.lampskeneQuestions?.closeInspector();window.lampskeneMapTools?.stopMeasure();window.lampskenePosition?.setFollow(false);window.lampskeneTracker?.stopFollowing();
    isOpen=true;const version=++epoch;by('map3d-explorer').hidden=false;document.body.classList.add('map3d-active');by('map3d-loading').hidden=false;by('map3d-loading').removeAttribute('data-state');by('map3d-loading').innerHTML='<strong>Opening 3D map…</strong>';by('map3d-back').focus({preventScroll:true});
    try{
      const lib=await loadLibrary();if(version!==epoch||!isOpen)return;
      const probe=document.createElement('canvas'),context=probe.getContext('webgl2');
      if(!context)throw Error('This browser cannot create a 3D map. The 2D game is still available.');
      context.getExtension('WEBGL_lose_context')?.loseContext();
      lib.setWorkerCount(2);
      geometrySignature='';terrainFallback=false;nativeBackgroundLayers=[];nativeBuildings=[];landmarkFootprints=null;
      const c=map.getCenter();gl=new lib.Map({container:'map3d-canvas',style:'https://tiles.openfreemap.org/styles/liberty',center:[c.lng,c.lat],zoom:Math.max(12,map.getZoom()-1),pitch:55,bearing:0,maxZoom:23,antialias:true,attributionControl:{compact:true},maxPitch:85});
      gl.addControl(new lib.NavigationControl({visualizePitch:true}),'top-right');
      loadTimer=setTimeout(()=>{if(version===epoch&&isOpen&&!gl?.isStyleLoaded()){by('map3d-loading').innerHTML='<strong>3D map is taking longer to load</strong><p>Check your connection, or return to the game and retry.</p>';}},22000);
      gl.on('load',()=>{clearTimeout(loadTimer);loadTimer=null;if(version!==epoch)return;by('map3d-loading').hidden=true;addSources();setBackground(styleKey);syncLayers();refreshAll();window.lampskeneContours?.refresh();if(!document.hidden)refreshInterval=setInterval(refreshAll,5000);});
      gl.on('error',event=>{if(version!==epoch)return;if(event.sourceId==='field-terrain'&&!terrainFallback){terrainFallback=true;gl.setTerrain(null);gl.addSource('field-terrain-backup',{type:'raster-dem',tiles:['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],tileSize:256,maxzoom:14,encoding:'terrarium'});syncLayers();}else if(event.sourceId==='field-terrain-backup'){settings.terrain=false;syncLayers();status('Terrain tiles unavailable.');}else if(event.sourceId!=='field-terrain'&&!gl.isStyleLoaded()){by('map3d-loading').innerHTML='<strong>3D map data unavailable</strong><p>Try again later. Back to game returns to your working map.</p>';}});
      gl.on('webglcontextlost',()=>{status('3D graphics paused by your browser. Return to the game to continue.');});
      gl.on('moveend',()=>{clearTimeout(moveTimer);moveTimer=setTimeout(()=>{refreshAll();window.lampskeneContours?.refresh();scheduleReplacements();},300);});
    }catch(error){if(version===epoch){by('map3d-loading').dataset.state='error';by('map3d-loading').replaceChildren(node('strong','',error.message),node('p','','Use Back to game to continue.'));}}
  }
  function close(useView=false){
    if(!isOpen)return;stopExploring();epoch++;isOpen=false;clearInterval(refreshInterval);refreshInterval=null;clearTimeout(loadTimer);loadTimer=null;clearTimeout(moveTimer);clearTimeout(replacementTimer);replacementGeneration++;replacementWorker?.terminate();replacementWorker=null;replacementBusy=false;replacementDirty=false;
    const camera=gl&&useView?{center:gl.getCenter(),zoom:gl.getZoom()+1}:null;
    gl?.stop();gl?.remove();gl=null;explorerMesh=null;lastVehicleSignature='';sourceSignatures.clear();vehicleLookup.clear();questionLookup.clear();by('map3d-explorer').hidden=true;document.body.classList.remove('map3d-active');
    if(camera&&map)map.setView([camera.center.lat,camera.center.lng],camera.zoom,{animate:false});
    const closeVersion=epoch;
    requestAnimationFrame(()=>{if(isOpen||epoch!==closeVersion||!map)return;map.invalidateSize({pan:false});if(typeof scheduleRebuild==='function')scheduleRebuild();});
    if(lastFocus?.isConnected&&lastFocus.getClientRects().length)lastFocus.focus({preventScroll:true});
  }
  function addSources(){
    nativeBackgroundLayers=gl.getStyle().layers.filter(l=>l.type!=='fill-extrusion'&&l.type!=='background').map(l=>({id:l.id,type:l.type}));
    nativeBuildings=gl.getStyle().layers.filter(l=>l.type==='fill-extrusion').map(l=>({id:l.id,source:l.source,sourceLayer:l['source-layer'],filter:gl.getFilter(l.id)}));
    for(const layer of gl.getStyle().layers.filter(l=>l.type==='fill-extrusion')){
      // Retain the provider's building/part filter. Never mask connected blocks.
      gl.setPaintProperty(layer.id,'fill-extrusion-opacity',1);
      gl.setPaintProperty(layer.id,'fill-extrusion-height',['max',3,['to-number',['coalesce',['get','render_height'],['get','height'],8],8]]);
      gl.setPaintProperty(layer.id,'fill-extrusion-base',['max',0,['coalesce',['to-number',['get','render_min_height']],0]]);
    }
    gl.addSource('field-terrain',{type:'raster-dem',url:'https://tiles.mapterhorn.com/tilejson.json',tileSize:512,encoding:'terrarium'});
    for(const id of ['field-vehicles','field-questions','field-details','field-position','field-players','field-question-areas','field-question-walls','field-game-area','field-rail','field-contours','field-landmarks','field-landmark-labels','field-explorer','field-landmark-neighbours'])gl.addSource(id,{type:'geojson',data:empty()});
    gl.addLayer({id:'field-rail-lines',type:'line',source:'field-rail',paint:{'line-color':['get','color'],'line-width':['interpolate',['linear'],['zoom'],10,2,16,5],'line-opacity':.95}});
    gl.addLayer({id:'field-contour-lines',type:'line',source:'field-contours',paint:{'line-color':'#87623a','line-width':['case',['get','major'],1.7,.8],'line-opacity':.85}});
    gl.addLayer({id:'field-contour-labels',type:'symbol',source:'field-contours',filter:['==',['get','major'],true],layout:{'symbol-placement':'line','text-field':['get','label'],'text-size':11,'symbol-spacing':350,'text-font':['Noto Sans Regular']},paint:{'text-color':'#78512c','text-halo-color':'#fff9e7','text-halo-width':1.5}});
    const firstBuilding=gl.getStyle().layers.find(l=>l.type==='fill-extrusion')?.id;
    gl.addLayer({id:'field-landmark-neighbours',type:'fill-extrusion',source:'field-landmark-neighbours',minzoom:14,paint:{'fill-extrusion-color':'hsl(35,8%,85%)','fill-extrusion-height':['get','height'],'fill-extrusion-base':['get','base'],'fill-extrusion-opacity':1}},firstBuilding);
    // Ground masks drape over the actual 3D terrain. Extruding enormous, thin
    // polygons creates a canopy and depth artefacts at pedestrian camera height.
    gl.addLayer({id:'field-game-area-solids',type:'fill',source:'field-game-area',paint:{'fill-color':'#2f8cff','fill-opacity':.30}},firstBuilding);
    gl.addLayer({id:'field-question-solids',type:'fill',source:'field-question-areas',paint:{'fill-color':'#4882dc','fill-opacity':.30}},firstBuilding);
    gl.addLayer({id:'field-question-boundaries',type:'fill-extrusion',source:'field-question-walls',paint:{'fill-extrusion-color':['get','color'],'fill-extrusion-height':['get','height'],'fill-extrusion-opacity':.48,'fill-extrusion-vertical-gradient':false}});
    gl.addLayer({id:'field-landmark-buildings',type:'fill-extrusion',source:'field-landmarks',minzoom:14,paint:{'fill-extrusion-color':['get','color'],'fill-extrusion-base':['get','base'],'fill-extrusion-height':['get','height'],'fill-extrusion-opacity':1}});
    gl.addLayer({id:'field-landmark-names',type:'symbol',source:'field-landmark-labels',minzoom:14,layout:{'text-field':['get','label'],'text-size':13,'text-offset':[0,1.5],'text-font':['Noto Sans Regular']},paint:{'text-color':'#604050','text-halo-color':'#fff8ed','text-halo-width':2}});
    const target=gl;window.lampskeneLandmarks?.load().then(data=>{if(gl!==target||!isOpen)return;landmarkFootprints=data.footprints;setSourceData('field-landmarks',data.parts);setSourceData('field-landmark-labels',data.labels);syncLayers();scheduleReplacements();}).catch(error=>console.warn('Landmark models:',error.message));
    gl.addLayer({id:'field-explorer-body',type:'fill-extrusion',source:'field-explorer',paint:{'fill-extrusion-color':['get','color'],'fill-extrusion-base':['get','base'],'fill-extrusion-height':['get','height'],'fill-extrusion-opacity':1}});
    gl.addLayer({id:'field-vehicle-bodies',type:'fill-extrusion',source:'field-vehicles',minzoom:12,paint:{'fill-extrusion-color':['get','color'],'fill-extrusion-base':['coalesce',['get','base'],0],'fill-extrusion-height':['get','height'],'fill-extrusion-opacity':1}});
    gl.addLayer({id:'field-vehicle-labels',type:'symbol',source:'field-vehicles',minzoom:13,filter:['!=',['get','line'],''],layout:{'text-field':['get','line'],'text-size':12,'text-offset':[0,-1.1],'text-font':['Noto Sans Regular'],'text-allow-overlap':false},paint:{'text-color':'#20302a','text-halo-color':'#fffdf5','text-halo-width':2}});
    gl.addLayer({id:'field-question-pins',type:'circle',source:'field-questions',paint:{'circle-radius':8,'circle-color':['get','color'],'circle-stroke-color':'#fff','circle-stroke-width':2}});
    gl.addLayer({id:'field-question-labels',type:'symbol',source:'field-questions',layout:{'text-field':['get','label'],'text-size':12,'text-offset':[0,1.4],'text-font':['Noto Sans Regular']},paint:{'text-color':'#20302a','text-halo-color':'#fffdf5','text-halo-width':2}});
    gl.addLayer({id:'field-detail-points',type:'circle',source:'field-details',filter:['==',['geometry-type'],'Point'],paint:{'circle-radius':5,'circle-color':['get','color'],'circle-stroke-color':'#fff','circle-stroke-width':1}});
    gl.addLayer({id:'field-detail-lines',type:'line',source:'field-details',filter:['!=',['geometry-type'],'Point'],paint:{'line-color':['get','color'],'line-width':3}});
    gl.addLayer({id:'field-player-pins',type:'circle',source:'field-players',paint:{'circle-radius':8,'circle-color':'#b76cce','circle-stroke-color':'#fff','circle-stroke-width':2}});
    gl.addLayer({id:'field-player-labels',type:'symbol',source:'field-players',layout:{'text-field':['get','label'],'text-size':13,'text-offset':[0,1.4],'text-font':['Noto Sans Regular']},paint:{'text-color':'#532168','text-halo-color':'#ffffff','text-halo-width':2}});
    gl.addLayer({id:'field-position-pin',type:'circle',source:'field-position',paint:{'circle-radius':9,'circle-color':'#3085d8','circle-stroke-color':'#fff','circle-stroke-width':3}});
    gl.on('click','field-vehicle-bodies',event=>{
      const id=event.features?.[0]?.properties.id,v=vehicleLookup.get(id);if(!v)return;
      window.lampskeneTracker?.select(id,false);const info=window.lampskeneTracker.info(v),content=node('div','map3d-popup');content.append(node('strong','',((info.type||'Vehicle')+' '+(info.line||v.label||'')).trim()),node('p','','Latest received feed position. Shape and size are simplified.'));
      new maplibregl.Popup().setLngLat([v.lng,v.lat]).setDOMContent(content).addTo(gl);
    });
    gl.on('click','field-question-pins',event=>{
      const pin=questionLookup.get(event.features?.[0]?.properties.key);if(!pin)return;
      const content=node('div','map3d-popup');content.append(node('strong','',pin.label));
      const edit=node('button','','Edit in 2D');edit.type='button';edit.addEventListener('click',()=>{close();window.lampskeneQuestions?.preview(pin.id);});content.append(edit);
      new maplibregl.Popup().setLngLat([pin.lng,pin.lat]).setDOMContent(content).addTo(gl);
    });
    gl.on('click','field-detail-points',event=>{const p=event.features?.[0]?.properties;if(!p)return;new maplibregl.Popup().setLngLat(event.lngLat).setDOMContent(node('strong','map3d-popup',p.name||'Map detail')).addTo(gl);});
    gl.on('sourcedata',event=>{if(nativeBuildings.some(l=>l.source===event.sourceId))scheduleReplacements();});
    gl.on('click','field-landmark-buildings',event=>{const p=event.features?.[0]?.properties;if(!p)return;const content=node('div','map3d-popup');content.append(node('strong','',p.name),node('p','','Stylized model · OSM footprint, original colours and facade details.'));new maplibregl.Popup().setLngLat(event.lngLat).setDOMContent(content).addTo(gl);});
    for(const layer of ['field-question-pins','field-vehicle-bodies']){gl.on('mouseenter',layer,()=>gl.getCanvas().style.cursor='pointer');gl.on('mouseleave',layer,()=>gl.getCanvas().style.cursor='');}
  }
  function syncLayers(){
    document.querySelectorAll('[data-map3d-toggle]').forEach(b=>b.setAttribute('aria-pressed',String(settings[b.dataset.map3dToggle])));
    if(!gl||!gl.getSource('field-terrain'))return;
    gl.setTerrain(settings.terrain?{source:terrainFallback?'field-terrain-backup':'field-terrain',exaggeration:1}:null);
    for(const layer of gl.getStyle().layers)if(layer.type==='fill-extrusion'&&!layer.id.startsWith('field-'))gl.setLayoutProperty(layer.id,'visibility',settings.buildings?'visible':'none');
    for(const [flag,layers] of [['questions',['field-question-solids','field-question-boundaries']],['details',['field-detail-points','field-detail-lines']]])for(const id of layers)gl.setLayoutProperty(id,'visibility',settings[flag]?'visible':'none');
    for(const id of ['field-landmark-buildings','field-landmark-names','field-landmark-neighbours'])gl.setLayoutProperty(id,'visibility',settings.buildings&&settings.landmarks?'visible':'none');
    if(!settings.landmarks)for(const l of nativeBuildings)gl.setFilter(l.id,l.filter||null);else scheduleReplacements();
    refreshGeometry();
  }
  function scheduleReplacements(){clearTimeout(replacementTimer);replacementTimer=setTimeout(replaceLandmarkBuildings,exploreMode==='orbit'?180:900);}
  function replaceLandmarkBuildings(){
    if(!gl||!isOpen||!settings.landmarks||!landmarkFootprints||!window.lampskeneLandmarkReplacements)return;
    if(replacementBusy){replacementDirty=true;return;}
    const target=gl,generation=++replacementGeneration;
    try{
      let fresh=false;
      if(!replacementWorker){fresh=true;replacementWorker=new Worker('landmark-replacement-worker.js?v=9');replacementWorker.onmessage=event=>{
        replacementBusy=false;const reply=event.data;
        if(gl!==target||!isOpen||reply.id!==replacementGeneration)return;
        if(reply.error){console.warn('Landmark replacement:',reply.error);return;}
        const all=reply.results.flatMap(r=>r.data.features);
        const apply=()=>{if(gl!==target||!isOpen||reply.id!==replacementGeneration||!settings.landmarks)return;reply.results.forEach((result,i)=>{const layer=nativeBuildings[i];target.setFilter(layer.id,result.ids.length?['all',...(layer.filter?[layer.filter]:[]),['!', ['in',['id'],['literal',result.ids]]]]:layer.filter||null);});};
        const ready=event=>{if(event.sourceId!=='field-landmark-neighbours'||!target.isSourceLoaded('field-landmark-neighbours'))return;target.off('sourcedata',ready);apply();};
        target.on('sourcedata',ready);setSourceData('field-landmark-neighbours',{type:'FeatureCollection',features:all});
        if(target.isSourceLoaded('field-landmark-neighbours')){target.off('sourcedata',ready);apply();}
        if(replacementDirty){replacementDirty=false;scheduleReplacements();}
      };replacementWorker.onerror=()=>{replacementBusy=false;replacementWorker?.terminate();replacementWorker=null;};}
      const groups=nativeBuildings.map(layer=>target.querySourceFeatures(layer.source,{sourceLayer:layer.sourceLayer,...(layer.filter?{filter:layer.filter}:{})}).map(f=>({id:f.id,properties:f.properties,geometry:f.geometry})));
      replacementBusy=true;replacementWorker.postMessage({id:generation,groups,...(fresh?{footprints:landmarkFootprints}:{})});
    }catch(error){replacementBusy=false;console.warn('Landmark replacement:',error.message);}
  }

  function refreshAll(){
    if(document.hidden||!isOpen||!gl?.getSource('field-vehicles'))return;
    const bounds={contains:([lat,lng])=>gl.getBounds().contains([lng,lat])};
    const state=window.lampskeneTracker?.state(bounds),vehicles=state?.vehicles||[];
    vehicleLookup=new Map(vehicles.map(v=>[v.id,v]));
    const detailed=gl.getZoom()>=16;
    const signature=JSON.stringify([detailed,vehicles.map(v=>[v.id,v.lat,v.lng,v.bearing,window.lampskeneTracker.info(v)])]);
    if(signature!==lastVehicleSignature){lastVehicleSignature=signature;const features=vehicles.slice(0,detailed?400:1500).filter(geo.validPoint).flatMap(v=>{const info=window.lampskeneTracker.info(v),bearing=v.bearing>=0?v.bearing:window.lampskeneTracker.motion(v)?.bearing||0;return window.lampskeneModels.vehicle(v,info,bearing,detailed);});gl.getSource('field-vehicles').setData({type:'FeatureCollection',features});}
    const pins=window.lampskeneQuestions?.publicPins?.()||[];questionLookup=new Map(pins.map(p=>[String(p.id)+'/'+p.pin,p]));setSourceData('field-questions',{type:'FeatureCollection',features:pins.filter(geo.validPoint).map(p=>({type:'Feature',geometry:{type:'Point',coordinates:[p.lng,p.lat]},properties:{key:String(p.id)+'/'+p.pin,label:p.label,color:p.color||'#d38c37'}}))});
    const detail=window.lampskeneMapTools?.details()||empty();setSourceData('field-details',detail);
    setSourceData('field-rail',window.lampskeneRail?.data()||empty());setSourceData('field-contours',window.lampskeneContours?.data||empty());refreshGeometry();
    if(typeof getBlueOverlayOpacity==='function')gl.setPaintProperty('field-question-solids','fill-opacity',getBlueOverlayOpacity());
    if(typeof getGameAreaOverlayOpacity==='function')gl.setPaintProperty('field-game-area-solids','fill-opacity',getGameAreaOverlayOpacity());
    updatePosition();
    const players=[];if(typeof trackerMarkers!=='undefined'&&typeof trackerActiveIds!=='undefined')for(const id of trackerActiveIds){const marker=trackerMarkers[id];if(marker&&map.hasLayer(marker)){const p=marker.getLatLng();if(geo.validPoint(p))players.push({type:'Feature',geometry:{type:'Point',coordinates:[p.lng,p.lat]},properties:{id,label:typeof trackerDisplayName==='function'?trackerDisplayName(id,trackerCatalog[id]):id}});}}setSourceData('field-players',{type:'FeatureCollection',features:players});
    by('map3d-enable-transit').setAttribute('aria-pressed',String(Boolean(state?.enabled)));
    by('map3d-enable-transit').textContent='Live transit · '+(state?.enabled?'ON':'OFF');
    by('map3d-rail').setAttribute('aria-pressed',String(Boolean(window.lampskeneRail?.enabled)));by('map3d-contours').setAttribute('aria-pressed',String(Boolean(window.lampskeneContours?.enabled)));
    if(exploreMode==='orbit')status((state?.enabled?(state.paused?'Transit paused · ':vehicles.length+' live vehicles · '):'Live transit off · ')+detail.features.length+' local details');
  }
  function setSourceData(id,data){if(sourceSignatures.get(id)===data)return;const signature=id==='field-contours'?data:JSON.stringify(data);if(sourceSignatures.get(id)===signature)return;const source=gl?.getSource(id);if(source){sourceSignatures.set(id,signature);source.setData(data);}}
  function updatePosition(){if(document.hidden||!isOpen||!gl?.getSource('field-position'))return;const position=window.lampskenePosition?.status;setSourceData('field-position',position?.running&&!position.stale&&geo.validPoint(position.fix)?{type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:[position.fix.lng,position.fix.lat]},properties:{}}]}:empty());}
  mount();window.lampskene3D={open,close,refresh:refreshAll,setBackground,startExploring,stopExploring,get active(){return isOpen;},get map(){return gl;},get exploration(){return exploreMode;},get explorer(){return {point:explorePoint&&{...explorePoint},bearing:exploreBearing,lookYaw,lookPitch,mesh:explorerMesh?.stats||null};}};
  window.addEventListener('tracker:update',refreshAll);document.addEventListener('jetlag:positionchange',updatePosition);document.addEventListener('jetlag:mapdetails',refreshAll);
  for(const event of ['jetlag:railchange','jetlag:contours','jetlag:pinvisibility','jetlag:trackers'])document.addEventListener(event,refreshAll);
  document.addEventListener('keydown',event=>{
    if(!isOpen||exploreMode==='orbit'||event.target?.closest?.('input,select,textarea,button,summary'))return;
    const key=event.key.toLowerCase();if(key==='escape'){event.preventDefault();event.stopImmediatePropagation();stopExploring(true);return;}
    if(key==='r'){event.preventDefault();event.stopImmediatePropagation();lookYaw=0;lookPitch=0;positionCamera();return;}
    if(!['w','a','s','d','q','e','arrowup','arrowdown','arrowleft','arrowright','shift'].includes(key))return;
    event.preventDefault();event.stopImmediatePropagation();pressed.add(key);if(driveFrame===null){driveTime=0;driveFrame=requestAnimationFrame(drive);}
  },true);
  document.addEventListener('keyup',event=>{pressed.delete(event.key.toLowerCase());});
  window.addEventListener('blur',()=>pressed.clear());
  document.addEventListener('visibilitychange',()=>{clearInterval(refreshInterval);refreshInterval=null;if(!isOpen)return;if(document.hidden){pressed.clear();gl?.stop();}else{gl?.resize();refreshAll();refreshInterval=setInterval(refreshAll,5000);}});
  window.addEventListener('pagehide',()=>close());
  document.addEventListener('jetlag:panelchange',e=>{if(e.detail.panel!=='map'&&isOpen)close();});document.addEventListener('jetlag:rolechange',()=>close());
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&isOpen)close();});
})();
