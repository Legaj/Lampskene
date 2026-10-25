const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
function between(start,end){return html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));}
function fixture(){
 const database={rounds:{r1:{ownerUid:'owner',name:'Morning',role:'seeker'}}},writes=[],toasts=[];
 const ctx={firebaseDb:{},mainUser:{uid:'owner',email:'owner@test'},mainProfile:{username:'owner'},trackerActiveIds:new Set(),activePartyId:null,activeRoundId:null,
  isRealGoogleUser:()=>true,prompt:()=>null,confirm:()=>false,Date,console,showToast:t=>toasts.push(t),chooseMode(){},activateRound(){},refreshAccountLists:async()=>{},returnToMainMenu(){},
  firebaseApi:{ref:(_,p='')=>p,push:()=>({key:'new-round'}),get:async path=>({val:()=>path.split('/').filter(Boolean).reduce((v,k)=>v?.[k],database)}),update:async(path,values)=>{
   writes.push({path,values});for(const [k,v]of Object.entries(values)){const keys=[...path.split('/'),...k.split('/')].filter(Boolean);let target=database;for(const key of keys.slice(0,-1))target=target[key]??={};target[keys.at(-1)]=v;}
  }}
 };ctx.window=ctx;vm.createContext(ctx);
 vm.runInContext(between('async function createRoundUi(role)', 'function activateRound(')+between('async function renameRoundUi(', 'async function refreshAccountLists()'),ctx);
 return {ctx,database,writes,toasts};
}
test('round names persist with creation and can be read by another client',async()=>{
 const f=fixture();f.ctx.prompt=()=> '  Tomorrow morning  ';await f.ctx.createRoundUi('seeker');
 assert.equal(f.database.rounds['new-round'].name,'Tomorrow morning');assert.equal(f.database.users.owner.rounds['new-round'],true);
 const snapshot=await f.ctx.firebaseApi.get('rounds/new-round');assert.equal(snapshot.val().name,'Tomorrow morning');
});
test('cancelled creation or rename writes nothing; owner rename updates the shared record',async()=>{
 const f=fixture();await f.ctx.createRoundUi('seeker');await f.ctx.renameRoundUi('r1');assert.equal(f.writes.length,0);
 f.ctx.prompt=()=> 'Evening';await f.ctx.renameRoundUi('r1');assert.equal(f.database.rounds.r1.name,'Evening');
 f.ctx.mainUser.uid='guest';await f.ctx.renameRoundUi('r1');assert.equal(f.writes.length,1);
});
test('round deletion requires ownership and confirmation, then removes saved round state',async()=>{
 const f=fixture();await f.ctx.deleteRoundUi('r1');assert.equal(f.writes.length,0);assert.ok(f.database.rounds.r1);
 f.ctx.mainUser.uid='guest';f.ctx.confirm=()=>true;await f.ctx.deleteRoundUi('r1');assert.equal(f.writes.length,0);
 f.ctx.mainUser.uid='owner';await f.ctx.deleteRoundUi('r1');assert.equal(f.database.rounds.r1,null);assert.equal(f.database.roundQuestions.r1,null);assert.equal(f.database.roundEndgame.r1,null);assert.equal(f.database.users.owner.rounds.r1,null);
});
