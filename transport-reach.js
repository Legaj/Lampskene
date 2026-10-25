/* Deliberate reach searches. SL's public planner provides sampled reachable stops;
 * an optional TravelTime key provides a continuous public-transport isochrone.
 * https://www.trafiklab.se/api/our-apis/sl/journey-planner-2/
 * https://docs.traveltime.com/api/reference/isochrones */
(function(root){
  'use strict';
  const geo=root.lampskeneGeo||(typeof require==='function'?require('./map-utils.js'):null);
  const empty=()=>({type:'FeatureCollection',features:[]});
  function validSearch(origin,start,minutes){
    if(!geo.validPoint(origin)||!Number.isFinite(start)||!Number.isInteger(minutes)||minutes<5||minutes>120)throw Error('Choose a valid start, departure time and 5–120 minute limit.');
  }
  function slQuery(origin,target,date,time){
    if(!geo.validPoint(origin)||!geo.validPoint(target)||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time))throw Error('Invalid SL search');
    const coord=p=>`${p.lng.toFixed(6)}:${p.lat.toFixed(6)}:WGS84[dd.ddddd]`;
    return 'https://journeyplanner.integration.sl.se/v2/trips?'+new URLSearchParams({type_origin:'coord',name_origin:coord(origin),type_destination:'coord',name_destination:coord(target),calc_number_of_trips:'1',language:'en',calc_one_direction:'true',gen_c:'false',itd_date:date.replaceAll('-',''),itd_time:time.replace(':',''),incl_mot_14:'false'});
  }
  function selectTargets(origin,minutes,places){
    const wanted=Math.min(45000,minutes*650),buckets=new Map();
    for(const place of places.filter(geo.validPoint)){
      const distance=geo.distance(origin,place);if(distance<500)continue;
      const sector=Math.floor((geo.bearing(origin,place)+22.5)%360/45),score=Math.abs(Math.log(distance/wanted));
      if(!buckets.has(sector)||score<buckets.get(sector).score)buckets.set(sector,{...place,score});
    }
    return Array.from({length:8},(_,i)=>buckets.get(i)||{...geo.destination(origin,wanted,i*45),name:'Direction '+(i*45)+'°'});
  }
  const cancelled=value=>Boolean(value?.isCancelled||value?.cancelled||value?.properties?.cancelled===true||value?.properties?.isCancelled===true);
  function slReachStops(response,start,minutes){
    if(!Array.isArray(response?.journeys))throw Error('SL returned no readable journey data.');
    const deadline=start+minutes*60000,stops=new Map();
    for(const journey of response.journeys){
      const legs=journey.legs;if(!Array.isArray(legs)||!legs.length||cancelled(journey)||legs.some(cancelled))continue;
      const first=legs[0].origin,departure=Date.parse(first?.departureTimeEstimated||first?.departureTimePlanned);
      // Count waiting from the chosen time; never accept an earlier departure.
      if(!Number.isFinite(departure)||departure<start||departure>deadline)continue;
      for(const leg of legs){
        if(Number(leg.transportation?.product?.class)>=97)continue; // footpaths/transfers
        if(!leg.transportation?.product)continue;
        const points=[leg.origin,...(Array.isArray(leg.stopSequence)?leg.stopSequence:[]),leg.destination];
        for(const stop of points){
          if(!stop||cancelled(stop)||!Array.isArray(stop.coord))continue;
          const point={lat:stop.coord[0],lng:stop.coord[1]};if(!geo.validPoint(point))continue;
          const timestamp=Date.parse(stop.arrivalTimeEstimated||stop.arrivalTimePlanned||stop.departureTimeEstimated||stop.departureTimePlanned);
          if(!Number.isFinite(timestamp)||timestamp<departure||timestamp>deadline)continue;
          const parent=stop.parent?.type==='stop'?stop.parent:stop,id=String(parent.id||stop.id||point.lat+','+point.lng);
          const elapsed=(timestamp-start)/60000;
          if(!stops.has(id)||elapsed<stops.get(id).minutes)stops.set(id,{id,...point,name:String(parent.disassembledName||parent.name||stop.name||'SL stop'),minutes:elapsed,arrival:timestamp,line:String(leg.transportation.disassembledName||leg.transportation.number||'')});
        }
      }
    }
    return [...stops.values()];
  }
  function timeMapRequest(origin,start,minutes){
    validSearch(origin,start,minutes);
    return {departure_searches:[{id:'stockholm-reach',coords:{lat:origin.lat,lng:origin.lng},departure_time:new Date(start).toISOString(),travel_time:minutes*60,transportation:{type:'public_transport'}}]};
  }
  function normalizeArea(raw){
    if(raw?.type!=='FeatureCollection'||!Array.isArray(raw.features))throw Error('TravelTime returned an unreadable area.');
    let vertices=0;
    const ring=r=>Array.isArray(r)&&r.length>=4&&r.every(p=>{vertices++;return vertices<200000&&Array.isArray(p)&&geo.validPoint({lat:p[1],lng:p[0]});})&&r[0][0]===r.at(-1)[0]&&r[0][1]===r.at(-1)[1];
    const polygon=p=>Array.isArray(p)&&p.length&&p.every(ring);
    const features=raw.features.map(f=>{
      const g=f?.geometry;if(!g||!(g.type==='Polygon'?polygon(g.coordinates):g.type==='MultiPolygon'&&g.coordinates.every(polygon)))throw Error('TravelTime returned invalid map coordinates.');
      return {type:'Feature',geometry:g,properties:{source:'TravelTime'}};
    });
    return {type:'FeatureCollection',features};
  }
  const helpers={slQuery,selectTargets,slReachStops,timeMapRequest,normalizeArea};
  if(typeof module==='object'&&module.exports)module.exports=helpers;
  if(!root.document)return;
  const by=id=>document.getElementById(id),node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const button=(text,fn)=>{const b=node('button','workspace-btn',text);b.type='button';b.addEventListener('click',fn);return b;};
  let origin=null,originMarker=null,picking=false,resultLayer=null,resultData=empty(),request=null,version=0,nextRequest=0;
  const cache=new Map();
  function status(text){by('reach-status').textContent=text;}
  function setBusy(){by('reach-search').disabled=Boolean(request);by('reach-stop').hidden=!request;by('reach-search').textContent=request?'Calculating…':'Show reach on map';}
  function stop(){version++;request?.abort();request=null;setBusy();}
  function clearResults(){resultLayer?.remove();resultLayer=null;resultData=empty();}
  function invalidate(){stop();clearResults();status('Settings changed · calculate again.');}
  function cancelPick(){picking=false;if(typeof map!=='undefined')map?.getContainer().style.removeProperty('cursor');}
  function setOrigin(point){
    if(!geo.validPoint(point)||!map)return;cancelPick();invalidate();origin={lat:point.lat,lng:point.lng};originMarker?.remove();
    originMarker=L.marker(origin,{draggable:true,icon:L.divIcon({className:'reach-origin',html:'<span>R</span>',iconSize:[30,30],iconAnchor:[15,15]})}).addTo(map).bindTooltip('Public transport start');
    originMarker.on('dragstart',invalidate);originMarker.on('dragend',()=>{const p=originMarker.getLatLng();origin={lat:p.lat,lng:p.lng};status('Start moved · calculate again.');});
    by('reach-origin-text').textContent='Start set on the map';status('Choose departure time and travel limit.');
  }
  function pickOrigin(){
    if(!map)return;window.lampskene3D?.close(true);window.lampskeneMapTools?.cancelCircle?.();window.lampskeneMapTools?.stopMeasure();window.appShell?.close();
    picking=true;map.getContainer().style.cursor='crosshair';showToast('Click the map to choose the public transport start',6000);
  }
  function drawStops(stops){
    clearResults();resultLayer=L.layerGroup().addTo(map);
    resultData={type:'FeatureCollection',features:stops.map(s=>({type:'Feature',geometry:{type:'Point',coordinates:[s.lng,s.lat]},properties:{name:s.name,minutes:s.minutes,line:s.line}}))};
    for(const s of stops){
      const color=s.minutes<=15?'#319c6d':s.minutes<=30?'#16879a':s.minutes<=60?'#b18522':'#c26531';
      const content=node('div','workspace-popup');content.append(node('strong','',s.name),node('p','',Math.ceil(s.minutes)+' min from selected departure · '+new Date(s.arrival).toLocaleTimeString('sv-SE',{timeZone:'Europe/Stockholm',hour:'2-digit',minute:'2-digit'})),node('p','workspace-hint','Found on a sampled SL journey'+(s.line?' · line '+s.line:'')));
      L.circleMarker([s.lat,s.lng],{radius:6,color:'#fff',weight:1.5,fillColor:color,fillOpacity:.95}).bindTooltip(node('span','',s.name+' · '+Math.ceil(s.minutes)+' min')).bindPopup(content).addTo(resultLayer);
    }
  }
  function drawArea(area){clearResults();resultData=area;resultLayer=L.geoJSON(area,{style:{color:'#16879a',weight:2,fillColor:'#21a68c',fillOpacity:.22}}).addTo(map);}
  async function pause(signal){
    return new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new DOMException('Cancelled','AbortError'));};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},1000);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
  }
  async function fetchSl(point,date,time,controller){
    const attempt=new AbortController(),abort=()=>attempt.abort();controller.signal.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,12000);
    try{const response=await fetch(slQuery(origin,point,date,time),{signal:attempt.signal});if(!response.ok)throw Error('SL planner returned '+response.status);return await response.json();}
    finally{clearTimeout(timer);controller.signal.removeEventListener('abort',abort);}
  }
  async function search(){
    if(!map)return;if(!origin){pickOrigin();return;}
    const value=by('reach-departure').value,start=slLocalDateTime(value),minutes=Number(by('reach-minutes').value),provider=by('reach-provider').value;
    try{validSearch(origin,start,minutes);}catch(error){status(Number.isNaN(start)?'Choose an unambiguous Stockholm departure time. This time may not exist or may occur twice during the clock change.':error.message);return;}
    const appId=by('reach-app-id').value.trim(),apiKey=by('reach-api-key').value.trim();
    if(provider==='traveltime'&&(!appId||!apiKey)){status('Paste your TravelTime application ID and API key to calculate a filled area. SL preview works without a key.');return;}
    const key=JSON.stringify([origin,value,minutes,provider]),saved=cache.get(key);
    if(saved&&Date.now()-saved.at<300000){saved.stops?drawStops(saved.stops):drawArea(saved.area);status(saved.message+' · cached');window.appShell?.close();return;}
    if(Date.now()<nextRequest){status('Please wait '+Math.ceil((nextRequest-Date.now())/1000)+' seconds before another search.');return;}
    stop();clearResults();const current=version,controller=new AbortController();request=controller;nextRequest=Date.now()+60000;setBusy();status('Calculating reach from '+value.replace('T',' ')+' Stockholm time…');
    try{
      if(provider==='sl'){
        const places=typeof MATCHING_DATA!=='undefined'?[...(MATCHING_DATA['Train Station']||[]),...(MATCHING_DATA['Tram Stop']||[])]:[];
        const targets=selectTargets(origin,minutes,places),stops=new Map();let completed=0,successful=0,journeyCount=0;
        for(const target of targets){
          if(controller.signal.aborted)break;
          try{const raw=await fetchSl(target,value.slice(0,10),value.slice(11,16),controller);if(current!==version)return;const found=slReachStops(raw,start,minutes);successful++;journeyCount+=raw.journeys.length;for(const s of found)if(!stops.has(s.id)||s.minutes<stops.get(s.id).minutes)stops.set(s.id,s);}
          catch(error){if(controller.signal.aborted)throw error;}
          completed++;drawStops([...stops.values()]);status('SL preview · '+completed+'/'+targets.length+' directions · '+stops.size+' reachable stops found');
          if(completed<targets.length)await pause(controller.signal);
        }
        if(controller.signal.aborted)return;
        if(!successful)throw Error('SL journey planner is unavailable. Retry shortly.');
        if(!journeyCount){status('SL returned no journeys for this date/time. Choose a date within the available timetable period.');return;}
        const message=stops.size+' reachable stops found on '+journeyCount+' sampled SL journeys within '+minutes+' min · '+value.replace('T',' ')+' Stockholm time. This preview is not exhaustive.';
        status(message);cache.set(key,{at:Date.now(),stops:[...stops.values()],message});
      }else{
        const timeout=setTimeout(()=>controller.abort(),30000);
        let raw;
        try{
          const response=await fetch('https://api.traveltimeapp.com/v4/time-map',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/geo+json','X-Application-Id':appId,'X-Api-Key':apiKey},body:JSON.stringify(timeMapRequest(origin,start,minutes)),signal:controller.signal});
          if(!response.ok)throw Error(response.status===401||response.status===403?'TravelTime rejected these API credentials.':response.status===429?'TravelTime rate limit reached. Retry later.':'TravelTime could not calculate this date/time ('+response.status+').');raw=await response.json();
        }finally{clearTimeout(timeout);}
        if(current!==version)return;const area=normalizeArea(raw);drawArea(area);
        const message=minutes+' min public transport area · '+value.replace('T',' ')+' Stockholm time · TravelTime timetables, walking and transfers. May include operators outside SL.';
        status(message);cache.set(key,{at:Date.now(),area,message});
      }
      if(cache.size>6)cache.delete(cache.keys().next().value);
      window.appShell?.close();showToast('Reach results are on the 2D map',5000);
    }catch(error){if(current===version)status(error.name==='AbortError'?'Reach search timed out or was stopped.':'Reach search failed: '+error.message);}
    finally{if(current===version){request=null;setBusy();}}
  }
  function mount(){
    const host=node('div','workspace-section');host.id='transport-reach-settings';host.dataset.settingsCategory='places';
    host.innerHTML='<div class="sp-label">Public transport reach</div><p class="workspace-hint">Choose a start, departure time and travel limit. SL preview finds reachable stops on eight sampled journeys; it is not a complete travel-time area.</p><p id="reach-origin-text" class="workspace-hint">Choose your start on the 2D map</p><div class="workspace-actions" id="reach-origin-actions"></div><label class="workspace-label" for="reach-departure">Departure · Stockholm time</label><input id="reach-departure" type="datetime-local"><label class="workspace-label" for="reach-minutes">Travel limit</label><select id="reach-minutes"><option value="15">15 minutes</option><option value="30" selected>30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option><option value="90">90 minutes</option><option value="120">120 minutes</option></select><label class="workspace-label" for="reach-provider">Reach display</label><select id="reach-provider"><option value="sl">SL stop preview · no key</option><option value="traveltime">Filled area · TravelTime API</option></select><div id="reach-credentials" hidden><p class="workspace-hint">TravelTime calculates public transport areas in Sweden. Its result can include operators outside SL. Credentials stay in this tab and are sent only to TravelTime.</p><label class="workspace-label" for="reach-app-id">TravelTime application ID</label><input id="reach-app-id" type="text" autocomplete="off" spellcheck="false"><label class="workspace-label" for="reach-api-key">TravelTime API key</label><input id="reach-api-key" type="password" autocomplete="off"><a class="field-source-link" href="https://docs.traveltime.com/api/start/auth" target="_blank" rel="noopener">TravelTime API setup ↗</a></div><div class="workspace-actions" id="reach-actions"></div><p id="reach-status" class="workspace-hint" role="status">Ready to choose a start.</p><p class="workspace-hint">Waiting and transfers count from your chosen departure. Missing SL dots do not rule out a place. Results are separate from your question answers.</p><a class="field-source-link" href="https://www.trafiklab.se/api/our-apis/sl/journey-planner-2/" target="_blank" rel="noopener">Journey data © SL · TravelTime for filled areas ↗</a>';
    by('settings-panel').append(host);
    by('reach-origin-actions').append(button('Choose start on map',pickOrigin),button('Use map center',()=>setOrigin(map.getCenter())));
    const run=button('Show reach on map',search);run.id='reach-search';const cancel=button('Stop search',()=>{stop();status('Search stopped · partial results kept.');});cancel.id='reach-stop';cancel.hidden=true;
    by('reach-actions').append(run,cancel,button('Clear reach',()=>{stop();cancelPick();clearResults();originMarker?.remove();originMarker=null;origin=null;by('reach-origin-text').textContent='Choose your start on the 2D map';status('Reach cleared.');}));
    const fields=slStockholmParts(Date.now());by('reach-departure').value=fields[0]+'-'+String(fields[1]).padStart(2,'0')+'-'+String(fields[2]).padStart(2,'0')+'T'+String(fields[3]).padStart(2,'0')+':'+String(fields[4]).padStart(2,'0');
    for(const id of ['reach-departure','reach-minutes','reach-provider'])by(id).addEventListener('change',()=>{invalidate();by('reach-credentials').hidden=by('reach-provider').value!=='traveltime';});
    const shortcut=button('Public transport reach',()=>window.appShell?.openSettingsSection(host.id));by('map-overlay-settings')?.append(shortcut);
  }
  mount();const init=window.initMap;window.initMap=function(){init.apply(this,arguments);map.on('click',e=>{if(!picking)return;setOrigin({lat:e.latlng.lat,lng:e.latlng.lng});window.appShell?.openSettingsSection('transport-reach-settings');});};
  document.addEventListener('keydown',e=>{if(e.key==='Escape')cancelPick();});
  window.addEventListener('pagehide',stop);document.addEventListener('jetlag:rolechange',()=>{stop();cancelPick();clearResults();originMarker?.remove();originMarker=null;origin=null;});
  root.lampskeneReach={...helpers,pickOrigin,cancelPick,setOrigin,search,stop,get picking(){return picking;},get data(){return resultData;}};
})(typeof window==='object'?window:globalThis);
