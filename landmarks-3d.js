/* Original, lightweight facade/roof details over attributed OSM footprints.
 * These are artistic interpretations, rather than surveyed building models. */
(() => {
  'use strict';
  const geo=window.lampskeneGeo;
  let pending=null;
  const feature=(geometry,properties)=>({type:'Feature',geometry,properties});
  function build(collection){
    const features=[],labels=[],masks=[],replacementPoints=[];
    for(const building of collection.features||[]){
      const ring=building.geometry?.coordinates?.[0],p=building.properties;
      if(!p||!Array.isArray(ring)||ring.length<4||!ring.every(([lng,lat])=>geo.validPoint({lat,lng})))continue;
      const points=ring.slice(0,-1),center={lat:points.reduce((a,v)=>a+v[1],0)/points.length,lng:points.reduce((a,v)=>a+v[0],0)/points.length};
      const padLat=2/111320,padLng=2/(111320*Math.cos(center.lat*Math.PI/180));
      const west=Math.min(...points.map(p=>p[0]))-padLng,east=Math.max(...points.map(p=>p[0]))+padLng,south=Math.min(...points.map(p=>p[1]))-padLat,north=Math.max(...points.map(p=>p[1]))+padLat;
      masks.push([[[west,south],[east,south],[east,north],[west,north],[west,south]]]);
      const hotel=p.model==='budapest',floors=Math.min(6,p.floors||4),floorHeight=hotel?3.8:4.1,height=floors*floorHeight;
      if(!hotel)replacementPoints.push(...points);
      const body=hotel?'#d799ae':'#c6755e',cream=hotel?'#f7dfcf':'#ead3aa',roof=hotel?'#6c496b':'#4c4d60',glass=hotel?'#596773':'#384f5a';
      const common={name:hotel?'Vanadisvägen 44 / Vanadisplan 2':p.name,model:p.model,osm_id:p.osm_id};
      function polygon(coords,base,top,color){features.push(feature({type:'Polygon',coordinates:[coords]},{...common,base,height:top,color}));}
      function scaled(scale){return ring.map(([lng,lat])=>[center.lng+(lng-center.lng)*scale,center.lat+(lat-center.lat)*scale]);}
      function box(point,bearing,length,width,base,top,color){polygon(geo.vehicleFootprint(point,bearing,length,width),base,top,color);}
      function disk(point,radius,base,top,color,sides=8){const coords=Array.from({length:sides},(_,i)=>{const q=geo.destination(point,radius,i*360/sides);return [q.lng,q.lat];});coords.push(coords[0]);polygon(coords,base,top,color);}
      polygon(ring,0,height,body);polygon(scaled(1.003),0,2.1,cream);
      for(let level=1;level<=floors;level++)polygon(scaled(1.004),level*floorHeight-.30,level*floorHeight,cream);
      polygon(scaled(1.012),height,height+.45,cream);
      if(hotel){
        // A stepped mansard roof, pale cornices and two small corner towers.
        polygon(scaled(.99),height+.45,height+1.8,roof);
        polygon(scaled(.91),height+1.8,height+3.0,roof);
        polygon(scaled(.82),height+3,height+3.8,roof);
        for(const corner of [[18.0400229,59.3453985],[18.0402134,59.3452063]]){
          const point={lat:corner[1],lng:corner[0]},inward=geo.destination(point,4,geo.bearing(point,center));
          disk(inward,4.1,height-1,height+3,body);disk(inward,4.35,height+2.7,height+3.1,cream);
          for(let step=0;step<5;step++)disk(inward,4.2-step*.65,height+3.1+step*.85,height+3.95+step*.85,roof);
          disk(inward,.45,height+7.3,height+8.8,'#c4a56c',6);
        }
      }else{
        polygon(ring,height+.45,height+2.6,roof);
        if(floors>2){
          const pavilion={lat:59.34393,lng:18.06158};
          box(pavilion,154,13,13,height,height+3.2,body);
          box(pavilion,154,14,14,height+3.2,height+3.7,cream);
          box(pavilion,154,13,13,height+3.7,height+5,roof);
          box(pavilion,154,8,8,height+5,height+6.3,roof);
        }
      }
      const signed=ring.slice(0,-1).reduce((sum,a,i)=>{const b=ring[i+1];return sum+a[0]*b[1]-b[0]*a[1];},0);
      for(let i=1;i<ring.length;i++){
        const a={lat:ring[i-1][1],lng:ring[i-1][0]},b={lat:ring[i][1],lng:ring[i][0]},length=geo.distance(a,b);
        if(length<5||length>130)continue;
        const bearing=geo.bearing(a,b),count=Math.floor(length/4.8);
        for(let slot=0;slot<count;slot++){
          const pos=geo.destination(geo.destination(a,length*(slot+.5)/count,bearing),.10,bearing+(signed>0?90:-90));
          for(let level=0;level<floors;level++){
            const bottom=level*floorHeight+1.15;
            box(pos,bearing,1.75,.24,bottom-.14,bottom+2.22,cream);
            box(geo.destination(pos,.04,bearing+(signed>0?90:-90)),bearing,1.30,.27,bottom,bottom+2.05,glass);
            box(geo.destination(pos,.10,bearing+(signed>0?90:-90)),bearing,.09,.30,bottom,bottom+2.05,cream);
          }
        }
      }
      // The street-facing entrance gets a small cream portico.
      const door=hotel?{lat:59.3452982,lng:18.0401223}:{lat:59.34392,lng:18.06164};
      box(door,hotel?153:154,4.5,2.7,0,4.0,cream);box(door,hotel?153:154,2.7,2.8,0,3.5,'#4a3846');
      box(door,hotel?153:154,5.5,3.4,3.9,4.35,cream);
      labels.push(feature({type:'Point',coordinates:[center.lng,center.lat]},{...common,label:hotel?'Vanadis · pastel corner':p.name}));
    }
    return {parts:{type:'FeatureCollection',features},labels:{type:'FeatureCollection',features:labels},masks:{type:'MultiPolygon',coordinates:masks},replacementPoints:{type:'MultiPoint',coordinates:replacementPoints}};
  }
  function load(){
    if(!pending)pending=fetch('landmark-footprints.geojson?v=6',{cache:'force-cache'}).then(r=>{if(!r.ok)throw Error('Landmark footprints unavailable');return r.json();}).then(build).catch(error=>{pending=null;throw error;});
    return pending;
  }
  window.lampskeneLandmarks={load,build};
})();
