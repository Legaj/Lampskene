/* A provider feature may contain a whole block. Preserve every part outside
 * the actual custom footprints instead of hiding nearby buildings wholesale. */
(() => {
  'use strict';
  const box=geometry=>{const out=[Infinity,Infinity,-Infinity,-Infinity];function walk(v){if(typeof v[0]==='number'){out[0]=Math.min(out[0],v[0]);out[1]=Math.min(out[1],v[1]);out[2]=Math.max(out[2],v[0]);out[3]=Math.max(out[3],v[1]);}else v.forEach(walk);}walk(geometry.coordinates);return out;};
  const overlaps=(a,b)=>a[0]<b[2]&&a[2]>b[0]&&a[1]<b[3]&&a[3]>b[1];
  const polygons=g=>g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
  const preparedTargets=new WeakMap();
  function targetsFor(footprints){
    if(preparedTargets.has(footprints))return preparedTargets.get(footprints);
    const pc=window.polygonClipping,geo=window.lampskeneGeo;
    const targets=footprints.features.map(f=>{
      let geometry=f.geometry;
      // Allow for the provider's quantised vertices without cutting out a block.
      const strips=[];
      for(const poly of polygons(geometry))for(const ring of poly)for(let i=1;i<ring.length;i++){
        const a={lat:ring[i-1][1],lng:ring[i-1][0]},b={lat:ring[i][1],lng:ring[i][0]},length=geo.distance(a,b);
        if(length>.05){const bearing=geo.bearing(a,b),mid=geo.destination(a,length/2,bearing);strips.push([geo.vehicleFootprint(mid,bearing,length+1.6,1.6)]);}
      }
      try{geometry={type:'MultiPolygon',coordinates:pc.union(polygons(geometry),...strips)};}catch(_){}
      return {geometry,bounds:box(geometry)};
    });preparedTargets.set(footprints,targets);return targets;
  }
  function build(native,footprints){
    const pc=window.polygonClipping,targets=targetsFor(footprints),hidden=new Set(),prepared=[];
    for(const f of native){
      if(f.id===undefined||f.id===null||!['Polygon','MultiPolygon'].includes(f.geometry?.type))continue;
      const bounds=box(f.geometry),cuts=targets.filter(t=>overlaps(bounds,t.bounds));
      prepared.push({f,cuts});if(!cuts.length)continue;
      try{if(cuts.some(t=>pc.intersection(polygons(f.geometry),polygons(t.geometry)).length))hidden.add(f.id);}catch(_){}
    }
    const features=[],seen=new Set();
    for(const {f,cuts} of prepared){
      if(!hidden.has(f.id))continue;
      const key=f.id+JSON.stringify(f.geometry);if(seen.has(key))continue;seen.add(key);
      // If clipping fails, preserve the provider geometry. Losing neighbours is
      // worse than a temporary overlap with a stylised landmark.
      let geometry=polygons(f.geometry);try{if(cuts.length)geometry=pc.difference(geometry,...cuts.map(t=>polygons(t.geometry)));}catch(_){}
      if(geometry.length)features.push({type:'Feature',geometry:{type:'MultiPolygon',coordinates:geometry},properties:{height:Math.max(3,Number(f.properties?.render_height??f.properties?.height??8)||8),base:Math.max(0,Number(f.properties?.render_min_height)||0)}});
    }
    return {ids:[...hidden].sort((a,b)=>a-b),data:{type:'FeatureCollection',features}};
  }
  window.lampskeneLandmarkReplacements={build};
})();
