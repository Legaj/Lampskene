/* Real elevation contours, shared by the 2D and 3D maps. Generated on demand. */
(() => {
  'use strict';
  const empty=()=>({type:'FeatureCollection',features:[]});
  let enabled=false,data=empty(),layer=null,request=null,version=0,timer=null,loading=false;
  const cache=new Map();
  const tileX=(lng,z)=>Math.floor((lng+180)/360*2**z);
  const tileY=(lat,z)=>Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*2**z);
  const coordinate=(x,y,z)=>[x/2**z*360-180,Math.atan(Math.sinh(Math.PI*(1-2*y/2**z)))*180/Math.PI];
  const tell=message=>{const status=document.getElementById('contour-status');if(status)status.textContent=message;};
  function sync(){
    document.querySelectorAll('[data-contour-toggle]').forEach(b=>{b.setAttribute('aria-pressed',String(enabled));b.textContent='Height contours · '+(enabled?'ON':'OFF');});
    if(layer&&map)map.removeLayer(layer);layer=null;
    if(enabled&&typeof map!=='undefined'&&map)layer=L.geoJSON(data,{interactive:false,style:f=>({color:'#88663c',weight:f.properties.major?1.6:.8,opacity:.8})}).addTo(map);
    document.dispatchEvent(new CustomEvent('jetlag:contours'));
  }
  async function elevationTile(x,y,z,signal){
    const key=[x,y,z].join('/');if(cache.has(key))return cache.get(key);
    let response;
    for(const url of [`https://tiles.mapterhorn.com/${z}/${x}/${y}.webp`,`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`]){
      try{response=await fetch(url,{signal});if(response.ok)break;}catch(error){if(signal.aborted)throw error;}
    }
    if(!response?.ok)throw Error('Elevation tiles unavailable');
    const bitmap=await createImageBitmap(await response.blob());
    const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);bitmap.close();
    const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data,heights=new Float32Array(canvas.width*canvas.height);
    for(let i=0;i<heights.length;i++){const n=i*4,value=rgba[n]*256+rgba[n+1]+rgba[n+2]/256-32768;heights[i]=rgba[n+3]&&value>-12000&&value<9000?value:NaN;}
    const tile=mlcontour.HeightTile.fromRawDem({width:canvas.width,height:canvas.height,data:heights});
    const lines=mlcontour.generateIsolines(5,tile,4096,0),features=[];
    for(const [height,paths] of Object.entries(lines))for(const points of paths){
      const coords=[];for(let i=0;i<points.length;i+=2)coords.push(coordinate(x+points[i]/4096,y+points[i+1]/4096,z));
      if(coords.length>1)features.push({type:'Feature',geometry:{type:'LineString',coordinates:coords},properties:{ele:Number(height),label:height+' m',major:Number(height)%25===0}});
    }
    const result={type:'FeatureCollection',features};cache.set(key,result);if(cache.size>16)cache.delete(cache.keys().next().value);return result;
  }
  async function refresh(){
    if(!enabled||document.hidden||typeof map==='undefined'||!map)return;
    const explorer=window.lampskene3D?.map,center=explorer?explorer.getCenter():map.getCenter(),zoom=explorer?explorer.getZoom():map.getZoom();
    if(zoom<12){tell('Zoom in to see the 5 m height contours.');return;}
    request?.abort();const controller=new AbortController();request=controller;const current=++version;
    loading=true;tell('Loading elevation contours…');const timeout=setTimeout(()=>controller.abort(),18000);
    try{
      const geo=window.lampskeneGeo,n=geo.destination(center,1800,0),s=geo.destination(center,1800,180),w=geo.destination(center,1800,270),e=geo.destination(center,1800,90),z=12,jobs=[];
      for(let x=tileX(w.lng,z);x<=tileX(e.lng,z);x++)for(let y=tileY(n.lat,z);y<=tileY(s.lat,z);y++)jobs.push(elevationTile(x,y,z,controller.signal));
      const results=await Promise.allSettled(jobs);if(current!==version||!enabled)return;
      const good=results.filter(r=>r.status==='fulfilled');if(!good.length)throw Error('Elevation service unavailable. Toggle contours to retry.');
      data={type:'FeatureCollection',features:good.flatMap(r=>r.value.features)};sync();
      tell('5 m contours · bold every 25 m · elevation model estimates'+(good.length<results.length?' · some tiles unavailable':''));
    }catch(error){if(current===version&&enabled)tell(error.name==='AbortError'?'Elevation request timed out. Toggle contours to retry.':error.message);}
    finally{clearTimeout(timeout);if(current===version){request=null;loading=false;}}
  }
  function set(on){enabled=Boolean(on);version++;request?.abort();sync();if(enabled)refresh();else tell('5 m spacing · bold every 25 m. Based on elevation data.');}
  const host=document.getElementById('map-overlay-settings');
  if(host){const b=document.createElement('button');b.type='button';b.className='workspace-btn';b.dataset.contourToggle='';b.addEventListener('click',()=>set(!enabled));const p=document.createElement('p');p.className='workspace-hint';p.id='contour-status';host.append(b,p);}
  const init=window.initMap;window.initMap=function(){init.apply(this,arguments);map.on('moveend',()=>{clearTimeout(timer);timer=setTimeout(refresh,600);});};
  window.lampskeneContours={set,toggle:()=>set(!enabled),refresh,get enabled(){return enabled;},get data(){return enabled?data:empty();},get loading(){return loading;}};
  sync();tell('5 m spacing · bold every 25 m. Based on elevation data.');
})();
