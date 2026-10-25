/* One question renderer feeds both the Leaflet masks and the 3D solids.
 * Clipping happens in Leaflet's projected coordinates, before converting to GeoJSON. */
(() => {
  'use strict';
  const empty=()=>({type:'FeatureCollection',features:[]});
  const colors={radar:'#e3994b',thermo:'#cab037',angle:'#a47cce',matching:'#3da984',measuring:'#3d9dab'};
  function build(bounds){
    if(typeof map==='undefined'||!map||!window.polygonClipping)return {areas:empty(),walls:empty()};
    const pc=window.polygonClipping,geo=window.lampskeneGeo;
    const nw=map.latLngToLayerPoint(L.latLng(bounds.getNorth(),bounds.getWest()));
    const se=map.latLngToLayerPoint(L.latLng(bounds.getSouth(),bounds.getEast()));
    const box=[Math.min(nw.x,se.x),Math.min(nw.y,se.y),Math.max(nw.x,se.x),Math.max(nw.y,se.y)];
    const pad=Math.max(...box.map(Math.abs),1000)*6;
    const world=[[[box[0],box[1]],[box[2],box[1]],[box[2],box[3]],[box[0],box[3]],[box[0],box[1]]]];
    let current=null;const excluded=[],walls=[],seen=new Set();
    const ring=pts=>{
      if(!pts||pts.length<3||!pts.every(p=>p.length===2&&p.every(Number.isFinite)))return null;
      const result=pts.map(p=>[...p]);if(result[0][0]!==result.at(-1)[0]||result[0][1]!==result.at(-1)[1])result.push([...result[0]]);
      return result;
    };
    const clipped=(pts,holes=[])=>{
      const r=ring(pts);if(!r)return [];
      return pc.intersection(world,[r,...holes.map(ring).filter(Boolean)]);
    };
    const union=polys=>polys.length?pc.union(...polys):[];
    function segment(a,b){
      // Liang–Barsky clips walls without introducing a wall around the viewport.
      const dx=b[0]-a[0],dy=b[1]-a[1];let lo=0,hi=1;
      for(const [p,q] of [[-dx,a[0]-box[0]],[dx,box[2]-a[0]],[-dy,a[1]-box[1]],[dy,box[3]-a[1]]]){
        if(p===0){if(q<0)return;continue;}const t=q/p;
        if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>hi)return;
      }
      const first=map.layerPointToLatLng(L.point(a[0]+lo*dx,a[1]+lo*dy));
      const last=map.layerPointToLatLng(L.point(a[0]+hi*dx,a[1]+hi*dy));
      if(geo.distance(first,last)<.05)return;
      const bearing=geo.bearing(first,last),width=.55;
      const corners=[geo.destination(first,width,bearing-90),geo.destination(last,width,bearing-90),geo.destination(last,width,bearing+90),geo.destination(first,width,bearing+90)];
      const coords=corners.map(p=>[p.lng,p.lat]);coords.push(coords[0]);
      walls.push({type:'Feature',geometry:{type:'Polygon',coordinates:[coords]},properties:{id:current?.id??'area',color:colors[current?.type]||'#4882dc',height:current?.id===window.lampskeneQuestions?.previewId?65:32}});
    }
    function outline(points){
      if(!current)return;const r=ring(points);if(!r)return;
      const signature=String(current.id)+JSON.stringify(r);if(seen.has(signature))return;seen.add(signature);
      for(let i=1;i<r.length;i++)segment(r[i-1],r[i]);
    }
    function outside(shapes){
      const valid=union(shapes.map(s=>clipped(s)).filter(s=>s.length));
      excluded.push(valid.length?pc.difference(world,valid):[world]);
      shapes.forEach(outline);
    }
    function inside(shape,holes=[]){const poly=clipped(shape,holes);if(poly.length)excluded.push(poly);outline(shape);holes.forEach(outline);}
    const renderer={pad,question:q=>{current=q;},addYesPath:s=>outside([s]),addYesPathMulti:outside,addNoPath:inside,addMaskedWorldPath:outside};
    rebuildAll(renderer);
    // Pending questions have a boundary to inspect, without ruling out any area.
    const pending=questions.filter(q=>q.type==='thermo'? !['A','B'].includes(q.closer):q.type==='matching'||q.type==='measuring'? !['yes','no','closer','further'].includes(q.answer):!['inside','outside'].includes(q.zone));
    rebuildAll({...renderer,skipCityBoundary:true,questions:pending.map(q=>({...q,zone:'outside',closer:'A',answer:q.type==='measuring'?'further':'no'})),addYesPath:shapes=>outline(shapes),addYesPathMulti:shapes=>shapes.forEach(outline),addNoPath:shape=>outline(shape),addMaskedWorldPath:shapes=>shapes.forEach(outline)});
    const combined=union(excluded.filter(p=>p.length));
    const project=p=>{const ll=map.layerPointToLatLng(L.point(p[0],p[1]));return [ll.lng,ll.lat];};
    const areas={type:'FeatureCollection',features:combined.map(poly=>({type:'Feature',geometry:{type:'Polygon',coordinates:poly.map(r=>r.map(project))},properties:{height:3,color:'#4882dc'}}))};
    return {areas,walls:{type:'FeatureCollection',features:walls}};
  }
  window.lampskeneQuestionGeometry={build};
})();
