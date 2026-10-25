const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const geo=require('../map-utils.js'),pc=require('../vendor/polygon-clipping-0.15.7.js');
function fixture(){
  const ctx={console,questions:[],setInterval(){},setTimeout(){},clearTimeout(){},lampskeneGeo:geo,polygonClipping:pc,
    document:{getElementById:()=>null},
    map:{latLngToLayerPoint:p=>({x:(p.lng-18.05)*57000,y:-(p.lat-59.34)*111320}),layerPointToLatLng:p=>({lat:59.34-p.y/111320,lng:18.05+p.x/57000}),distance:(a,b)=>geo.distance({lat:a.lat??a[0],lng:a.lng??a[1]},{lat:b.lat??b[0],lng:b.lng??b[1]})},
    L:{latLng:(lat,lng)=>({lat,lng}),point:(x,y)=>({x,y})},
    getActiveHiderPin(){throw Error('Private hiding position accessed');},
  };
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync('questions.js','utf8'),ctx);
  ctx.getAllMatchingData=()=>({points:[{id:'a',lat:59.34,lng:18.04},{id:'b',lat:59.34,lng:18.06}],area:[{id:'park',type:'polygon',rings:[[[18.04,59.33],[18.06,59.33],[18.06,59.35],[18.04,59.35],[18.04,59.33]]]}]});
  ctx.getMeasuringLocs=()=>[{lat:59.34,lng:18.05},{lat:59.34,lng:18.05},{lat:59.34,lng:18.058}];
  vm.runInContext(fs.readFileSync('question-geometry.js','utf8'),ctx);
  const bounds={getNorth:()=>59.37,getSouth:()=>59.31,getWest:()=>18.00,getEast:()=>18.10};
  return {ctx,build:questions=>{ctx.questions=questions;return ctx.lampskeneQuestionGeometry.build(bounds);}};
}
function inRing(point,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
const excluded=(data,lng,lat)=>data.areas.features.some(f=>inRing([lng,lat],f.geometry.coordinates[0])&&!f.geometry.coordinates.slice(1).some(r=>inRing([lng,lat],r)));

test('3D radar exclusion preserves the allowed circle as a hole and the shared renderer leaves 2D untouched',()=>{
  const f=fixture(),sentinel={innerHTML:'Keep 2D mask'};f.ctx.sentinel=sentinel;vm.runInContext('_overlaySvg=sentinel',f.ctx);
  const result=f.build([{id:1,type:'radar',lat:59.34,lng:18.05,radius:'500',unit:'M',zone:'inside'}]);
  assert.equal(excluded(result,18.05,59.34),false);assert.equal(excluded(result,18.08,59.34),true);
  assert.ok(result.walls.features.length>=40);assert.equal(sentinel.innerHTML,'Keep 2D mask');
});
test('3D thermometer has an excluded half-plane and a real vertical boundary',()=>{
  const result=fixture().build([{id:2,type:'thermo',latA:59.34,lngA:18.04,latB:59.34,lngB:18.06,closer:'A'}]);
  assert.equal(excluded(result,18.03,59.34),false);assert.equal(excluded(result,18.07,59.34),true);
  assert.ok(result.walls.features.length>0);assert.ok(result.walls.features.every(f=>f.properties.height>0));
});
test('3D matching renders point Voronoi and polygon questions using the authoritative 2D logic',()=>{
  const f=fixture();let result=f.build([{id:3,type:'matching',subcat:'points',nearestId:'a',answer:'yes'}]);
  assert.equal(excluded(result,18.03,59.34),false);assert.equal(excluded(result,18.07,59.34),true);
  result=f.build([{id:4,type:'matching',subcat:'area',nearestId:'park',answer:'no'}]);
  assert.equal(excluded(result,18.05,59.34),true);assert.equal(excluded(result,18.08,59.34),false);
});
test('3D measuring preserves the union of overlapping valid circles without filling their overlap',()=>{
  const result=fixture().build([{id:5,type:'measuring',subcat:'points',seekerDist:600,answer:'closer'}]);
  assert.equal(excluded(result,18.05,59.34),false);assert.equal(excluded(result,18.054,59.34),false);assert.equal(excluded(result,18.09,59.34),true);
});
test('3D angle sectors retain excluded inner radius and pending questions have walls without blue areas',()=>{
  const f=fixture(),q={id:'aq6',type:'angle',center:{lat:59.34,lng:18.05},direction:{lat:59.34,lng:18.06},angle:40,mode:'excludeRadius',excludeRadius:100,zone:'inside'};
  let result=f.build([q]);assert.equal(excluded(result,18.05,59.34),true);assert.equal(excluded(result,18.06,59.34),false);assert.equal(excluded(result,18.04,59.34),true);
  result=f.build([{...q,zone:'pending'}]);assert.equal(result.areas.features.length,0);assert.ok(result.walls.features.length>0);
});
test('3D game-area shading stays separate from question shading, including views entirely outside the game',()=>{
  const f=fixture();f.ctx._gameAreaMode='small';f.ctx._gameAreaGeoCache={small:{type:'Polygon',coordinates:[[[18.04,59.33],[18.06,59.33],[18.06,59.35],[18.04,59.35],[18.04,59.33]]]}};
  let result=f.build([]);assert.equal(result.areas.features.length,0);assert.ok(result.gameArea.features.length);
  assert.equal(excluded({areas:result.gameArea},18.05,59.34),false);assert.equal(excluded({areas:result.gameArea},18.09,59.34),true);
  f.ctx._gameAreaGeoCache.small={type:'Polygon',coordinates:[[[19,60],[19.01,60],[19.01,60.01],[19,60.01],[19,60]]]};
  result=f.build([]);assert.equal(excluded({areas:result.gameArea},18.05,59.34),true);
});
