/* Shared, side-effect-free geographic helpers. Coordinates are [longitude, latitude]. */
(function(root) {
  'use strict';
  const validPoint=p=>Boolean(p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat)<=85.051129 && Math.abs(p.lng)<=180);
  // Basemaps are mutually exclusive. Leave independent reference, question and
  // player layers alone, including when recovering from a previous interrupted switch.
  function replaceBaseLayer(map,layers,key) {
    const next=layers?.[key];
    if(!map||!next)return false;
    for(const layer of new Set(Object.values(layers))) {
      if(layer!==next&&map.hasLayer(layer))map.removeLayer(layer);
    }
    next.setZIndex?.(0);
    if(!map.hasLayer(next))next.addTo(map);
    return true;
  }
  const distance=(a,b)=>{
    const r=Math.PI/180, dLat=(b.lat-a.lat)*r, dLng=(b.lng-a.lng)*r;
    const h=Math.sin(dLat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLng/2)**2;
    return 6371008.8*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
  };
  function bearing(a,b) {
    const r=Math.PI/180, dl=(b.lng-a.lng)*r;
    return (Math.atan2(Math.sin(dl)*Math.cos(b.lat*r),Math.cos(a.lat*r)*Math.sin(b.lat*r)-Math.sin(a.lat*r)*Math.cos(b.lat*r)*Math.cos(dl))/r+360)%360;
  }
  function destination(p,metres,degrees) {
    const r=Math.PI/180,d=metres/6371008.8,t=degrees*r,lat=p.lat*r,lng=p.lng*r;
    const out=Math.asin(Math.sin(lat)*Math.cos(d)+Math.cos(lat)*Math.sin(d)*Math.cos(t));
    return {lat:out/r,lng:((lng+Math.atan2(Math.sin(t)*Math.sin(d)*Math.cos(lat),Math.cos(d)-Math.sin(lat)*Math.sin(out)))/r+540)%360-180};
  }
  function vehicleFootprint(p,heading=0,length=12,width=2.6) {
    const c=destination(p,length/2,heading), d=destination(p,length/2,heading+180);
    const pts=[destination(c,width/2,heading-90),destination(c,width/2,heading+90),destination(d,width/2,heading+90),destination(d,width/2,heading-90)];
    return [...pts,pts[0]].map(v=>[v.lng,v.lat]);
  }
  const DETAILS=[
    {key:'bench',name:'Benches',icon:'B',color:'#a57140',query:'["amenity"="bench"]'},
    {key:'toilet',name:'Toilets',icon:'WC',color:'#496cc1',query:'["amenity"="toilets"]'},
    {key:'water',name:'Drinking water',icon:'W',color:'#1b91b8',query:'["amenity"="drinking_water"]'},
    {key:'shelter',name:'Shelters',icon:'S',color:'#9b7335',query:'["amenity"="shelter"]'},
    {key:'picnic',name:'Picnic tables',icon:'P',color:'#688546',query:'["leisure"="picnic_table"]'},
    {key:'crossing',name:'Crossings',icon:'↔',color:'#706788',query:'["highway"="crossing"]'},
    {key:'steps',name:'Steps',icon:'≡',color:'#8e715e',query:'["highway"="steps"]'},
    {key:'entrance',name:'Entrances',icon:'E',color:'#607b8b',query:'["entrance"]["entrance"!="no"]'},
    {key:'viewpoint',name:'Viewpoints',icon:'V',color:'#8b668e',query:'["tourism"="viewpoint"]'},
    {key:'construction',name:'Construction · OSM',icon:'!',color:'#d27c28',query:'[~"^(landuse|highway|building)$"~"^construction$"]'},
    {key:'bicycle',name:'Bike parking',icon:'C',color:'#418572',query:'["amenity"="bicycle_parking"]'},
    {key:'defibrillator',name:'Defibrillators',icon:'+',color:'#c45655',query:'["emergency"="defibrillator"]'},
    {key:'waste',name:'Bins',icon:'D',color:'#778364',query:'["amenity"="waste_basket"]'},
    {key:'tree',name:'Trees',icon:'T',color:'#43874c',query:'["natural"="tree"]'},
    {key:'light',name:'Street lights',icon:'L',color:'#b89b39',query:'["highway"="street_lamp"]'},
    {key:'stop',name:'Bus stops',icon:'SL',color:'#34889c',query:'["highway"="bus_stop"]'}
  ];
  function category(tags) {
    if(tags.amenity==='bench')return 'bench'; if(tags.amenity==='toilets')return 'toilet';
    if(tags.amenity==='drinking_water')return 'water'; if(tags.amenity==='shelter')return 'shelter';
    if(tags.leisure==='picnic_table')return 'picnic'; if(tags.highway==='crossing')return 'crossing';
    if(tags.highway==='steps')return 'steps'; if(tags.entrance && tags.entrance!=='no')return 'entrance';
    if(tags.tourism==='viewpoint')return 'viewpoint'; if([tags.landuse,tags.highway,tags.building].includes('construction'))return 'construction';
    if(tags.amenity==='bicycle_parking')return 'bicycle'; if(tags.emergency==='defibrillator')return 'defibrillator';
    if(tags.amenity==='waste_basket')return 'waste'; if(tags.natural==='tree')return 'tree';
    if(tags.highway==='street_lamp')return 'light'; if(tags.highway==='bus_stop')return 'stop'; return null;
  }
  function overpassQuery(bounds,keys) {
    if(!Array.isArray(bounds)||bounds.length!==4||!bounds.every(Number.isFinite)||bounds[0]>=bounds[2]||bounds[1]>=bounds[3])throw Error('Invalid map bounds');
    const box=bounds.map(v=>v.toFixed(5)).join(',');
    const clauses=DETAILS.filter(d=>keys.includes(d.key)).map(d=>`nwr${d.query}(${box});`);
    if(!clauses.length)throw Error('Choose at least one detail layer');
    return `[out:json][timeout:20][maxsize:16777216];(${clauses.join('')});out center tags geom 1000;`;
  }
  function overpassCircleQuery(center,radius,keys){
    if(!validPoint(center)||!Number.isFinite(radius)||radius<100||radius>1200)throw Error('Choose a search circle between 100 and 1200 metres');
    const clauses=DETAILS.filter(d=>keys.includes(d.key)).map(d=>`nwr${d.query}(around:${Math.round(radius)},${center.lat.toFixed(6)},${center.lng.toFixed(6)});`);
    if(!clauses.length)throw Error('Choose at least one detail layer');
    return `[out:json][timeout:12][maxsize:16777216];(${clauses.join('')});out center tags geom 1000;`;
  }
  function normalizeDetails(data,keys) {
    if(!Array.isArray(data?.elements))throw Error('The map service returned an unreadable response');
    const features=[],seen=new Set();
    for(const item of data.elements.slice(0,1000)) {
      if(!['node','way','relation'].includes(item.type))continue;
      const tags=item.tags||{},key=category(tags),id=`${item.type}/${item.id}`;
      if(!key||!keys.includes(key)||seen.has(id)||tags.access==='private'||tags.access==='no')continue;
      const point={lat:item.lat??item.center?.lat,lng:item.lon??item.center?.lon}; if(!validPoint(point))continue;
      seen.add(id); const definition=DETAILS.find(d=>d.key===key);
      let geometry={type:'Point',coordinates:[point.lng,point.lat]};
      if(['construction','steps'].includes(key)&&Array.isArray(item.geometry)) {
        const coords=item.geometry.filter(v=>validPoint({lat:v.lat,lng:v.lon})).map(v=>[v.lon,v.lat]);
        if(coords.length>1)geometry=coords.length>3&&coords[0][0]===coords.at(-1)[0]&&coords[0][1]===coords.at(-1)[1]?{type:'Polygon',coordinates:[coords]}:{type:'LineString',coordinates:coords};
      }
      const info={}; for(const tag of ['access','wheelchair','fee','opening_hours','capacity','backrest','material','covered','surface','lit','operator','construction','start_date','end_date'])if(tags[tag])info[tag]=String(tags[tag]).slice(0,180);
      features.push({type:'Feature',id,geometry,properties:{id,key,name:String(tags.name||definition.name.replace(' · OSM','')).slice(0,140),lat:point.lat,lng:point.lng,color:definition.color,info}});
    }
    return {type:'FeatureCollection',features,truncated:data.elements.length>=1000,updated:data.osm3s?.timestamp_osm_base||null};
  }
  function normalizeMapDetails(data,keys,center,radius){
    if(!Array.isArray(data?.elements)||!validPoint(center)||!Number.isFinite(radius)||radius<100||radius>600)throw Error('Use a search circle of 100–600 m for the fallback detail service');
    const nodes=new Map(data.elements.filter(e=>e.type==='node').map(e=>[e.id,e]));
    const elements=[];
    for(const item of data.elements){
      if(!keys.includes(category(item.tags||{})))continue;
      const element={type:item.type,id:item.id,tags:item.tags};
      if(item.type==='node'){element.lat=item.lat;element.lon=item.lon;}
      else if(item.type==='way'){
        const geometry=(item.nodes||[]).map(id=>nodes.get(id)).filter(n=>n&&validPoint({lat:n.lat,lng:n.lon})).map(n=>({lat:n.lat,lon:n.lon}));
        if(!geometry.length)continue;
        element.geometry=geometry;element.center={lat:geometry.reduce((sum,p)=>sum+p.lat,0)/geometry.length,lon:geometry.reduce((sum,p)=>sum+p.lon,0)/geometry.length};
      }else continue;
      const point={lat:element.lat??element.center?.lat,lng:element.lon??element.center?.lon};
      if(validPoint(point)&&distance(center,point)<=radius)elements.push(element);
    }
    return normalizeDetails({elements},keys);
  }
  const api={validPoint,replaceBaseLayer,distance,bearing,destination,vehicleFootprint,DETAILS,overpassQuery,overpassCircleQuery,normalizeDetails,normalizeMapDetails};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.lampskeneGeo=api;
})(typeof window==='object'?window:globalThis);
