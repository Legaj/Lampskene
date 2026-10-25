/* Real 5 m elevation contours, cached and shared by the 2D and 3D maps. */
(() => {
  'use strict';
  const empty={type:'FeatureCollection',features:[]};
  let enabled=false,data=empty,layer=null,worker=null,version=0,timer=null,loading=false,lastKey='',pendingKey='';
  const tileX=(lng,z)=>Math.floor((lng+180)/360*2**z);
  const tileY=(lat,z)=>Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*2**z);
  const tell=message=>{const status=document.getElementById('contour-status');if(status)status.textContent=message;};
  function sync(){
    document.querySelectorAll('[data-contour-toggle]').forEach(b=>{b.setAttribute('aria-pressed',String(enabled));b.textContent='Height contours · '+(enabled?'ON':'OFF');});
    if(!enabled&&layer){map.removeLayer(layer);layer=null;}
    if(enabled&&typeof map!=='undefined'&&map){
      if(!layer)layer=L.geoJSON(null,{interactive:false,renderer:L.canvas({padding:.2}),style:f=>({color:'#88663c',weight:f.properties.major?1.6:.7,opacity:.75})}).addTo(map);
      layer.clearLayers();layer.addData(data);
    }
    document.dispatchEvent(new CustomEvent('jetlag:contours'));
  }
  function refresh(){
    if(!enabled||document.hidden||typeof map==='undefined'||!map)return;
    const explorer=window.lampskene3D?.map,center=explorer?explorer.getCenter():map.getCenter(),zoom=explorer?explorer.getZoom():map.getZoom();
    if(zoom<13){tell('Zoom in to see 5 m height contours.');if(data!==empty){data=empty;lastKey='';sync();}return;}
    const geo=window.lampskeneGeo,radius=zoom>=16?450:800,z=14,n=geo.destination(center,radius,0),s=geo.destination(center,radius,180),w=geo.destination(center,radius,270),e=geo.destination(center,radius,90),tiles=[];
    for(let x=tileX(w.lng,z);x<=tileX(e.lng,z);x++)for(let y=tileY(n.lat,z);y<=tileY(s.lat,z);y++)tiles.push([x,y,z]);
    const key=JSON.stringify(tiles);if(lastKey===key||pendingKey===key||loading)return;
    try{
      if(!worker){worker=new Worker('contour-worker.js?v=7');worker.onmessage=event=>{
        const result=event.data;if(result.id!==version)return;loading=false;const completedKey=pendingKey;pendingKey='';
        if(!enabled)return;
        if(result.error||!result.features?.length){tell(result.error||'Elevation service unavailable. Toggle contours to retry.');return;}
        data={type:'FeatureCollection',features:result.features};lastKey=completedKey;sync();
        tell('5 m contours · bold every 25 m · estimated ground elevation'+(result.failed?' · some tiles unavailable':''));refresh();
      };worker.onerror=()=>{loading=false;pendingKey='';worker.terminate();worker=null;tell('Contours could not load. Toggle to retry.');};}
      loading=true;pendingKey=key;tell('Loading elevation contours…');worker.postMessage({id:++version,tiles});
    }catch(_){loading=false;pendingKey='';tell('This browser cannot generate height contours.');}
  }
  function set(on){enabled=Boolean(on);if(!enabled){version++;worker?.terminate();worker=null;loading=false;pendingKey='';}sync();if(enabled)refresh();else tell('5 m spacing · bold every 25 m. Based on elevation data.');}
  const host=document.getElementById('map-overlay-settings');
  if(host){const b=document.createElement('button');b.type='button';b.className='workspace-btn';b.dataset.contourToggle='';b.addEventListener('click',()=>set(!enabled));const p=document.createElement('p');p.className='workspace-hint';p.id='contour-status';host.append(b,p);}
  const init=window.initMap;window.initMap=function(){init.apply(this,arguments);map.on('moveend',()=>{clearTimeout(timer);timer=setTimeout(refresh,600);});};
  window.lampskeneContours={set,toggle:()=>set(!enabled),refresh,get enabled(){return enabled;},get data(){return enabled?data:empty;},get loading(){return loading;}};
  sync();tell('5 m spacing · bold every 25 m. Based on elevation data.');
})();
