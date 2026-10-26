const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const rules=require('../question-rules.js');
function fixture(){const saved=new Map(),ctx={lampskeneQuestionRules:rules,activeRoundId:'round-one',_sessionRoundId:'round-one',questions:[],_archivedQuestions:[],document:{dispatchEvent(){}},CustomEvent:class{},localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)},saveState(){}};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync('question-usage.js','utf8'),ctx);return{ctx,api:ctx.lampskeneQuestionUsage,saved};}
const state=(key,n)=>({events:Array.from({length:n},(_,i)=>({id:String(i),key,at:i,voided:false}))});
test('v2 sizes, angle families and base draw/keep values match the rulebook',()=>{
 assert.deepEqual(rules.catalogue.filter(e=>e.type==='radar'&&e.meters).map(e=>e.meters),[250,500,1000,2000,5000,10000,15000,20000,25000]);
 assert.equal(rules.byId('thermo/250').endgame,true);assert.equal(rules.byId('angle/3000').modes.triple.at(-1),65);assert.equal(rules.byId('angle/2000').modes.default,undefined);assert.equal(rules.byId('angle/500').exclude,10000);
 assert.equal(rules.cost(state('radar/500',2),'radar/500').multiplier,3);assert.equal(rules.cost(state('radar/500',2),'radar/500').draw,3);assert.equal(rules.byId('photo/tree').draw,2);assert.equal(rules.byId('extras/trace').minutes,6);
});
test('typed preset-sized values choose the cheaper category and prefer the preset on a tie',()=>{
 const q={type:'radar',radius:'500',unit:'M',questionPreset:'auto'};
 assert.equal(rules.keyFor(q,state('radar/500',1)),'radar/custom');assert.equal(rules.keyFor(q,{events:[]}), 'radar/500');
 assert.equal(rules.keyFor({...q,questionPreset:'radar/500'},state('radar/500',1)),'radar/500');
 assert.equal(rules.keyFor({...q,questionUsageKey:'radar/custom'},state('radar/custom',2)),'radar/custom','played choice remains fixed');
 assert.equal(rules.keyFor({...q,radius:'723'},state('radar/custom',2)),'radar/custom');
});
test('a locked card is counted once, survives deletion and a new round starts fresh',()=>{
 const f=fixture(),q={id:1,type:'radar',radius:'500',unit:'M',locked:true};f.ctx.questions.push(q);f.api.captureLocked();f.api.captureLocked();assert.equal(f.api.count,1);
 q.locked=false;f.api.captureLocked();q.locked=true;f.api.captureLocked();assert.equal(f.api.count,1);
 f.ctx.questions=[];assert.equal(f.api.count,1);f.ctx.activeRoundId='round-two';f.ctx._sessionRoundId='round-two';assert.equal(f.api.count,0);
 f.ctx.activeRoundId='round-one';f.ctx._sessionRoundId='round-one';assert.equal(f.api.count,1);
});
test('automatic cheapest choice is frozen when played and clearing a tick does not re-count a locked card',()=>{
 const f=fixture();f.api.add('radar/500');const q={id:2,type:'radar',radius:'500',unit:'M',questionPreset:'auto',locked:false};f.ctx.questions.push(q);
 assert.equal(f.api.summary(q).key,'radar/custom');q.locked=true;f.api.captureLocked();assert.equal(q.questionUsageKey,'radar/custom');assert.equal(f.api.summary(q).asked,1);
 f.api.setPlayed('radar/custom',false);f.api.captureLocked();assert.equal(f.api.cost('radar/custom').used,0);
 const exported=f.api.getState();f.api.restore(exported);assert.equal(f.api.cost('radar/custom').used,0);
});
test('angle suboptions share their travel-distance counter and archived questions retain usage',()=>{
 const f=fixture(),q={id:'aq1',type:'angle',questionPreset:'angle/3000',questionDistance:3000,angle:45,mode:'default',locked:true};f.ctx.questions.push(q);f.api.captureLocked();
 assert.equal(f.api.summary({...q,questionUsageKey:null,questionUsageToken:null,mode:'triple'}).multiplier,2);
 f.ctx._archivedQuestions=[q];f.ctx.questions=[];f.api.captureLocked();assert.equal(f.api.count,1);
 f.api.add('photo/tree');assert.equal(f.api.cost('photo/tree').multiplier,2);
});
