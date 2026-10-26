const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const geo=require('../map-utils.js');
function models(){const c={lampskeneGeo:geo};c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync('models-3d.js','utf8'),c);vm.runInContext(fs.readFileSync('city-landmarks-3d.js','utf8'),c);vm.runInContext(fs.readFileSync('landmarks-3d.js','utf8'),c);return c;}
function validParts(parts){for(const f of parts){assert.equal(f.geometry.type,'Polygon');assert.ok(f.properties.height>=f.properties.base);assert.ok(f.geometry.coordinates[0].every(([lng,lat])=>geo.validPoint({lat,lng})));assert.deepEqual(f.geometry.coordinates[0][0],f.geometry.coordinates[0].at(-1));}}
test('close vehicle models provide valid windows, roof and body geometry for every supported mode',()=>{
  const c=models(),vehicle={id:'test',lat:59.34,lng:18.05};
  for(const type of ['bus','subway','train','tram','light_rail','ferry']){
    const detailed=c.lampskeneModels.vehicle(vehicle,{type,line:'4',color:'#0070c0'},90,true);validParts(detailed);assert.ok(detailed.length>8);
    assert.equal(detailed.filter(f=>f.properties.line==='4').length,1,'one label per vehicle');
    assert.equal(c.lampskeneModels.vehicle(vehicle,{type,line:'4'},90,false).length,1,'distant vehicles remain light');
  }
});
test('landmarks use the Norra Real and user-selected Vanadis corner footprints and finite model dimensions',()=>{
  const c=models(),data=JSON.parse(fs.readFileSync('city-landmark-footprints.geojson','utf8')),result=c.lampskeneLandmarks.build(data);
  validParts(result.parts.features);assert.equal(result.labels.features.length,26);assert.ok(result.parts.features.length>100);
  assert.ok(result.labels.features.some(f=>f.properties.name.includes('Vanadisvägen')));
  assert.ok(result.replacementPoints.coordinates.length>40);
});

test('all third-person avatars and car variants have finite closed model geometry',()=>{
  const c=models(),point={lat:59.3451,lng:18.0396};
  for(const [mode,variant] of [['walk','city'],['boat','city'],['car','city'],['car','sport'],['car','van']]){
    const model=c.lampskeneModels.explorer(point,mode,variant,43);validParts(model.features);assert.ok(model.features.length>=5);
  }
});

test('expanded landmarks include civic buildings, preserve courtyard holes and bound facade detail',()=>{
  const c=models(),data=JSON.parse(fs.readFileSync('city-landmark-footprints.geojson','utf8')),result=c.lampskeneLandmarks.build(data);
  for(const name of ['Stockholms stadshus','Stockholms slott','Riksdagshuset','Avicii Arena','Stockholms stadsbibliotek','Nordiska museet'])assert.ok(result.labels.features.some(f=>f.properties.name===name),name);
  const palace=result.parts.features.filter(f=>f.properties.name==='Stockholms slott');assert.ok(palace.some(f=>f.geometry.coordinates.length>1),'palace courtyard remains open');
  assert.ok(result.parts.features.length<6500,'landmark detail remains bounded');
});

test('older pages keep their original landmarks and never cut out unsupported new models',()=>{
  const c={lampskeneGeo:geo};c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync('landmarks-3d.js','utf8'),c);
  const result=c.lampskeneLandmarks.build(JSON.parse(fs.readFileSync('city-landmark-footprints.geojson','utf8')));
  assert.equal(result.labels.features.length,3);assert.equal(result.footprints.features.length,3);
});
