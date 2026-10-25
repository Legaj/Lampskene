const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const pc=require('../vendor/polygon-clipping-0.15.7.js'),geo=require('../map-utils.js');
const ctx={polygonClipping:pc,lampskeneGeo:geo};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync('landmark-replacements.js','utf8'),ctx);
const ring=(x,y,w)=>[[x,y],[x+w,y],[x+w,y+w],[x,y+w],[x,y]];
const area=polys=>polys.reduce((s,p)=>s+p.reduce((s,r,i)=>{let a=0;for(let j=1;j<r.length;j++)a+=r[j-1][0]*r[j][1]-r[j][0]*r[j-1][1];return s+(i?-1:1)*Math.abs(a/2);},0),0);
test('landmark cut-outs preserve neighbours inside grouped features and other tiles sharing the id',()=>{
 const original=[ring(18,59,.002)],far=[ring(18.01,59,.001)],footprint=[ring(18.0005,59.0005,.0006)];
 const native=[{id:1,properties:{render_height:22},geometry:{type:'MultiPolygon',coordinates:[original]}},{id:1,properties:{render_height:22},geometry:{type:'Polygon',coordinates:far}},{id:2,properties:{render_height:8},geometry:{type:'Polygon',coordinates:[ring(18.02,59,.001)]}}];
 const result=ctx.lampskeneLandmarkReplacements.build(native,{features:[{geometry:{type:'Polygon',coordinates:footprint}}]});
 assert.deepEqual(Array.from(result.ids),[1]);assert.equal(result.data.features.length,2);
 const polygons=result.data.features.flatMap(f=>f.geometry.coordinates);assert.equal(pc.intersection(polygons,footprint).length,0,'generic building cannot shine through the landmark');
 assert.ok(area(polygons)>area([original,far])-area([footprint])*1.15,'surrounding geometry survives instead of disappearing with its group');
 assert.equal(pc.intersection(polygons,far).length,1,'other source-tile fragments sharing the id remain present');
});
