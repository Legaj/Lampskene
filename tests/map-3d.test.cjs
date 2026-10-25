const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function fixture(){
  const elements=new Map(),frames=[],instances=[],views=[],classes=new Set();let invalidations=0;
  const node=tag=>({tag,hidden:false,dataset:{},style:{},children:[],setAttribute(){},removeAttribute(){},append(...children){this.children.push(...children);},addEventListener(){},focus(){},getContext:()=>({getExtension:()=>null})});
  const document={activeElement:null,hidden:false,createElement:node,head:node('head'),body:{append(){},classList:{add:value=>classes.add(value),remove:value=>classes.delete(value)}},getElementById(id){if(!elements.has(id))elements.set(id,node('div'));return elements.get(id);},querySelectorAll:()=>[],addEventListener(){}};
  class Explorer {
    constructor(){instances.push(this);this.handlers=new Map();this.removed=0;this.stopped=0;}
    getSource(){return null;}addControl(){}on(event,fn){this.handlers.set(event,fn);}getCenter(){return {lat:60,lng:19};}getZoom(){return 13;}stop(){this.stopped++;}remove(){this.removed++;}
  }
  const ctx={document,console,map:{getCenter:()=>({lat:59,lng:18}),getZoom:()=>12,setView:(...args)=>views.push(args),invalidateSize(){invalidations++;}},lampskeneGeo:require('../map-utils.js'),
    maplibregl:{Map:Explorer,NavigationControl:class{},setWorkerCount(){}},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},requestAnimationFrame:fn=>frames.push(fn),addEventListener(){}};
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'..','map-3d.js'),'utf8'),ctx);
  return {api:ctx.lampskene3D,frames,instances,views,classes,elements,get invalidations(){return invalidations;}};
}

test('closing 3D releases its renderer and refreshes 2D once without stale cameras',async()=>{
  const f=fixture();await f.api.open();assert.equal(f.instances.length,1);
  f.api.close(true);f.api.close();
  assert.equal(f.instances[0].stopped,1);assert.equal(f.instances[0].removed,1);
  assert.equal(f.api.map,null);assert.equal(f.api.active,false);assert.equal(f.classes.has('map3d-active'),false);
  assert.equal(f.views.length,1);assert.equal(f.views[0][0][0],60);assert.equal(f.views[0][1],14);
  f.frames.shift()();assert.equal(f.invalidations,1);
});

test('closing while 3D opens cancels stale renderer creation and stale refresh',async()=>{
  const f=fixture();const opening=f.api.open();f.api.close();await opening;
  assert.equal(f.instances.length,0,'closing before the library resolves prevents renderer creation');
  await f.api.open();f.frames.shift()();
  assert.equal(f.invalidations,0,'the previous close cannot reset a reopened explorer');
  assert.equal(f.instances.length,1);f.api.close();f.frames.shift()();assert.equal(f.invalidations,1);
});
