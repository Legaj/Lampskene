const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('contours use real five metre levels, DEM pixel centres, batching and cached tiles',async()=>{
 const pixels=new Uint8ClampedArray(36);for(let i=0;i<9;i++){pixels[i*4]=128;pixels[i*4+1]=(i%3)*5;pixels[i*4+3]=255;}
 let fetches=0,result;const ctx={importScripts(){},mlcontour:require('../vendor/maplibre-contour-0.1.0.js'),AbortSignal,Float32Array,Map,Set,Math,Promise,
  fetch:async()=>{fetches++;return{ok:true,blob:async()=>({})};},createImageBitmap:async()=>({width:3,height:3,close(){}}),
  OffscreenCanvas:class{getContext(){return{drawImage(){},getImageData:()=>({data:pixels})};}},postMessage:r=>result=r};ctx.self=ctx;
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('contour-worker.js','utf8'),ctx);await ctx.onmessage({data:{id:1,tiles:[[100,200,14]]}});
 assert.equal(result.failed,0);assert.equal(result.features.length,2);assert.ok(result.features.every(f=>f.geometry.type==='MultiLineString'&&f.properties.ele%5===0));
 const first=result.features.find(f=>f.properties.ele===0).geometry.coordinates[0][0];assert.ok(Math.abs(first[0]-((100+.5/3)/2**14*360-180))<1e-10,'isolines align with DEM sample centres');
 await ctx.onmessage({data:{id:2,tiles:[[100,200,14]]}});assert.equal(fetches,1,'cached tiles are not downloaded or retraced');
});
