const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const geo=require('../map-utils.js');

test('basemap replacement removes every stale basemap while preserving independent layers',()=>{
  const active=new Set(),removed=[];
  const map={hasLayer:layer=>active.has(layer),removeLayer(layer){removed.push(layer);active.delete(layer);}};
  const make=name=>({name,zIndex:1,setZIndex(value){this.zIndex=value;},addTo(){active.add(this);return this;}});
  const street=make('street'),terrain=make('terrain'),aerial=make('aerial'),question=make('question'),trail=make('trail');
  [street,terrain,question,trail].forEach(layer=>active.add(layer));
  const layers={street,terrain,aerial,alias:street};
  assert.equal(geo.replaceBaseLayer(map,layers,'aerial'),true);
  assert.deepEqual([...active],[question,trail,aerial]);assert.equal(aerial.zIndex,0);
  assert.equal(removed.length,2,'aliases never remove a layer twice');
  active.delete(aerial);geo.replaceBaseLayer(map,layers,'aerial');
  assert.ok(active.has(aerial),'same selection repairs a missing layer');
  assert.equal(geo.replaceBaseLayer(map,layers,'missing'),false);
  assert.deepEqual([...active],[question,trail,aerial],'unknown style never clears the working map');
});

test('distance, compass bearing and 3D vehicle footprint retain physical dimensions',()=>{
  const origin={lat:59.3293,lng:18.0686};
  const east=geo.destination(origin,100,90);
  assert.ok(Math.abs(geo.distance(origin,east)-100)<.001);
  assert.ok(Math.abs(geo.bearing(origin,east)-90)<.001);
  for(const heading of [0,90,195,359]){
    const ring=geo.vehicleFootprint(origin,heading,12,2.6),p=ring.map(([lng,lat])=>({lat,lng}));
    assert.deepEqual(ring[0],ring.at(-1));
    assert.ok(Math.abs(geo.distance(p[0],p[1])-2.6)<.005);
    assert.ok(Math.abs(geo.distance(p[1],p[2])-12)<.005);
    assert.ok(p.every(geo.validPoint));
  }
});
test('detail requests allow known categories only and bound service resources',()=>{
  const q=geo.overpassQuery([59.32,18.05,59.34,18.08],['bench','construction','"];out;']);
  assert.match(q,/\[timeout:20\]/);assert.match(q,/out center tags geom 1000/);
  assert.match(q,/amenity.*bench/);assert.match(q,/construction/);assert.ok(!q.includes('"];out;'));
  assert.throws(()=>geo.overpassQuery([60,18,59,19],['bench']));
  assert.throws(()=>geo.overpassQuery([59,18,60,19],['unknown']));
});
test('OSM detail normalization excludes private access, rejects invalid data and preserves polygons',()=>{
  const data={elements:[
    {type:'node',id:1,lat:59.3,lon:18,tags:{amenity:'bench',name:'<img src=x onerror=alert(1)>',backrest:'yes'}},
    {type:'node',id:1,lat:59.3,lon:18,tags:{amenity:'bench'}},
    {type:'node',id:2,lat:59.3,lon:18,tags:{amenity:'bench',access:'private'}},
    {type:'node',id:3,lat:'59.3',lon:18,tags:{amenity:'bench'}},
    {type:'node',id:4,lat:100,lon:18,tags:{amenity:'bench'}},
    {type:'way',id:5,center:{lat:59.3,lon:18},tags:{landuse:'construction'},geometry:[{lat:59.3,lon:18},{lat:59.31,lon:18},{lat:59.31,lon:18.01},{lat:59.3,lon:18}]}]};
  const result=geo.normalizeDetails(data,['bench','construction']);
  assert.equal(result.features.length,2);assert.equal(result.features[1].geometry.type,'Polygon');
  assert.equal(result.features[0].properties.name,'<img src=x onerror=alert(1)>','labels remain data for textContent renderers');
  assert.equal(result.features[0].properties.info.backrest,'yes');
  assert.throws(()=>geo.normalizeDetails({},['bench']));
});
function overlayFixture(){
  const make=tag=>({tag,attrs:{},children:[],style:{removeProperty(key){delete this[key];}},setAttribute(k,v){this.attrs[k]=String(v);},appendChild(n){this.children.push(n);return n;},insertBefore(n){this.children.unshift(n);},querySelector(selector){return this.children.find(c=>c.tag===selector)||null;},set innerHTML(v){this.children=[];},get innerHTML(){return '';}});
  const frames=[],handlers=new Map(),group=make('g');
  const ctx={console,setInterval(){},setTimeout(){},clearTimeout(){},requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},cancelAnimationFrame(){},navigator:{},document:{createElementNS:(ns,tag)=>make(tag),getElementById:()=>null},
    map:{on(events,fn){for(const e of events.split(' ')){const rows=handlers.get(e)||[];rows.push(fn);handlers.set(e,rows);}},getSize:()=>({x:390,y:600}),getBounds:()=>({pad(){return this;},getNorthWest:()=>({lat:1000,lng:-1000}),getSouthEast:()=>({lat:-1000,lng:1000})}),latLngToLayerPoint:p=>({x:p.lng,y:-p.lat})},
    L:{svg:()=>({_rootGroup:group,addTo(){return this;}}),latLng:(lat,lng)=>({lat,lng})},questions:[],getAllMatchingData:()=>({})};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'..','questions.js'),'utf8'),ctx);
  ctx.addCityBoundaryMaskPath=()=>{};
  return {ctx,frames,handlers,group,run:s=>vm.runInContext(s,ctx)};
}
test('exclusion geometry stays on Leaflet zoom transforms and coalesces end-of-gesture rebuilds',()=>{
  const f=overlayFixture();let builds=0;f.ctx.rebuildAll=()=>builds++;f.ctx.rebuildVoronoiLines=()=>{};f.run('ensureOverlay()');
  assert.equal(f.handlers.has('zoom'),false);assert.equal(f.handlers.has('move'),false);
  for(let i=0;i<10;i++)for(const fn of f.handlers.get('moveend'))fn();
  assert.equal(f.frames.length,1);assert.equal(builds,0);f.frames.shift()();assert.equal(builds,1);
  const overlay=f.group.children[0];overlay.style.opacity='1';f.run('setBlueOverlayOpacity(.3)');
  assert.equal(overlay.attrs.opacity,'0.3');assert.equal(overlay.style.opacity,undefined);
});
test('measuring mask keeps every visible valid circle and excludes views without any valid circle',()=>{
  const f=overlayFixture();f.run('ensureOverlay()');
  const circles=Array.from({length:300},(_,i)=>[[i,0],[i+1,1],[i,2],[i-1,1]]);
  f.ctx.holes=circles;f.run('addMaskedWorldPath(holes)');
  const root=f.group.children[0],mask=root.children.find(c=>c.tag==='defs').children[0];
  assert.equal(mask.children.filter(c=>c.tag==='circle').length,300,'never silently drop valid places after 240 circles');
  f.run('_overlaySvg.innerHTML="";addMaskedWorldPath([[[10000,0],[10001,1],[10000,2],[9999,1]]])');
  assert.equal(root.children.filter(c=>c.tag==='path').length,1,'all offscreen holes still leave the visible view excluded');
});
test('two measuring answers remain separate constraints instead of accepting their combined union',()=>{
  const f=overlayFixture(),calls=[];f.run('ensureOverlay()');
  f.ctx.getMeasuringLocs=key=>[{lat:59.3,lng:key==='first'?18:19}];f.ctx.addMaskedWorldPath=pts=>calls.push(pts);
  f.ctx.questions=[{type:'measuring',subcat:'first',answer:'closer',seekerDist:100},{type:'measuring',subcat:'second',answer:'closer',seekerDist:200}];
  f.run('rebuildAll()');assert.equal(calls.length,2);assert.equal(calls[0].length,1);assert.equal(calls[1].length,1);
});
test('zero-distance measuring answers still render their constraint',()=>{
  const f=overlayFixture();f.run('ensureOverlay()');
  f.ctx.getMeasuringLocs=()=>[{lat:59.3,lng:18}];
  f.ctx.questions=[{type:'measuring',subcat:'Park',answer:'closer',seekerDist:0}];
  f.run('rebuildAll()');
  assert.equal(f.group.children[0].children.filter(c=>c.tag==='path').length,1);
});
test('overlapping and duplicate valid polygons use a union mask, never winding-cancel their overlap',()=>{
  const f=overlayFixture();f.run('ensureOverlay()');
  f.ctx.polygons=[[[0,0],[10,0],[10,10],[0,10]],[[0,0],[10,0],[10,10],[0,10]]];f.run('addYesPathMulti(polygons)');
  const root=f.group.children[0],mask=root.children.find(c=>c.tag==='defs').children[0];
  assert.equal(mask.children.filter(c=>c.tag==='path'&&c.attrs.fill==='black').length,2);
  assert.match(root.children.find(c=>c.tag==='path').attrs.mask,/valid-area-mask/);
});

test('thermometer boundaries honor global and individual choices and reject coincident pins',()=>{
  const f=overlayFixture(),lines=[],group={clearLayers(){lines.length=0;},addTo(){return this;}};
  f.ctx.L.layerGroup=()=>group;f.ctx.L.point=(x,y)=>({x,y});
  f.ctx.L.polyline=(points,options)=>({addTo(){lines.push({points,options});return this;}});
  f.ctx.map.layerPointToLatLng=p=>({lat:-p.y,lng:p.x});
  f.ctx.questions=[{id:1,type:'thermo',latA:0,lngA:0,latB:1,lngB:1}];
  f.run('redrawThermoBorders()');assert.equal(lines.length,0);
  f.run('setThermoBordersEnabled(true,false)');assert.equal(lines.length,2,'global setting shows a halo and a boundary');
  assert.equal(lines[1].options.className,'thermo-boundary-line');
  f.run('toggleThermoBorder(1)');assert.equal(lines.length,0,'individual off overrides a restored global preference');
  f.run('redrawThermoBorders()');assert.equal(lines.length,0,'the individual choice survives redraw');
  f.run('setThermoBordersEnabled(false,false)');assert.equal(lines.length,0);
  f.ctx.questions[0].thermoBorder=true;f.run('redrawThermoBorders()');assert.equal(lines.length,2,'individual boundary remains usable on its own');
  f.ctx.questions[0].latB=0;f.ctx.questions[0].lngB=0;f.run('redrawThermoBorders()');assert.equal(lines.length,0);
  f.ctx.questions[0].latB=NaN;f.run('redrawThermoBorders()');assert.equal(lines.length,0);
});
