const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
const scripts = Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)).filter(m => !/\bsrc\s*=/.test(m[1]));
function fixture() {
  const elements = new Map(); const values = new Map();
  const classList = () => { const classes=new Set(); return {add:(...a)=>a.forEach(v=>classes.add(v)),remove:(...a)=>a.forEach(v=>classes.delete(v)),contains:v=>classes.has(v),toggle:(v,on)=>{const result=on===undefined?!classes.has(v):on;result?classes.add(v):classes.delete(v);return result;}}; };
  const element = id => ({id,classList:classList(),style:{},dataset:{},textContent:'',innerHTML:'',value:'',addEventListener(){},removeEventListener(){},querySelector(){return null;},querySelectorAll(){return [];},appendChild(){},setAttribute(){},remove(){},focus(){}});
  const document = {
    body:{classList:classList()}, addEventListener(){},querySelectorAll(){return[];},createElement:()=>element('created'),
    getElementById(id){if(!elements.has(id))elements.set(id,element(id));return elements.get(id);}
  };
  const tasks=[];
  const ctx={document,navigator:{maxTouchPoints:0},console,localStorage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},
    setTimeout:fn=>{tasks.push(fn);return tasks.length;},clearTimeout(){},setInterval(){return 1;},clearInterval(){},requestAnimationFrame:fn=>{tasks.push(fn);},confirm:()=>true,location:{reload(){}},addEventListener(){},innerWidth:1200};
  ctx.window=ctx; vm.createContext(ctx);vm.runInContext(scripts[0][2],ctx);
  const firebaseScript=scripts.find(script=>/^\s*let firebaseReady/.test(script[2]));assert.ok(firebaseScript,'Firebase round script exists');vm.runInContext(firebaseScript[2],ctx);
  vm.runInContext("mainUser={uid:'test-user',email:'test@example.invalid'};",ctx);
  ctx.isRealGoogleUser=()=>true;ctx._cpDeck=[];ctx.showToast=()=>{};ctx.syncAccountUi=()=>{};
  ctx.firebaseApi={ref:(db,key)=>key,set:async()=>{},update:async()=>{},get:async()=>({exists:()=>false}),onValue:()=>()=>{}};
  for(const name of ['addHiderLocationCard','onMapClick','scheduleRebuild','redrawThermoBorders','updateUndoPinButton'])ctx[name]=()=>{};
  return {ctx,values,elements,tasks,run:source=>vm.runInContext(source,ctx)};
}
test('question filtering does not continually mutate the observed card list',()=>{
  const f=fixture(),classes=new Set();let writes=0;
  const cls={contains:key=>classes.has(key),toggle:(key,on)=>{writes++;on?classes.add(key):classes.delete(key);}};
  const list={children:[],classList:cls};
  const counter={get textContent(){return this.value||'';},set textContent(value){writes++;this.value=value;}};
  f.elements.set('question-list',list);f.elements.set('question-count',counter);
  f.run('_updateQuestionTools()');assert.ok(writes>0);writes=0;
  f.run('_updateQuestionTools()');assert.equal(writes,0,'unchanged filters must not retrigger MutationObserver');
});
function parseInlineScript(script,i) {
  if(!/\btype\s*=\s*["']module["']/.test(script[1]))return new vm.Script(script[2],{filename:`index inline ${i}`});
  if(typeof vm.SourceTextModule==='function')return new vm.SourceTextModule(script[2],{identifier:`index module ${i}`});
  // Named static imports in the Firebase bootstrap are declarations; transform
  // their bindings for syntax checks when Node runs without --experimental-vm-modules.
  let importIndex=0;
  const classic=script[2].replace(/\bimport\s+\{([^}]+)\}\s+from\s+["'][^"']+["']\s*;/g,(_,bindings)=>{
    importIndex++;
    assert.match(bindings,/^\s*[A-Za-z_$][\w$]*(?:\s+as\s+[A-Za-z_$][\w$]*)?\s*(?:,\s*[A-Za-z_$][\w$]*(?:\s+as\s+[A-Za-z_$][\w$]*)?\s*)*,?\s*$/);
    return `const {${bindings.replace(/\s+as\s+/g,':')}}=__module${importIndex};`;
  });
  assert.ok(importIndex>0,'module imports checked');assert.ok(!/\b(?:import|export)\s/.test(classic),'no unchecked module declaration');
  return new vm.Script(classic,{filename:`index module ${i}`});
}
function mapFixture(f) {
  const removed=[],cleaned=[];
  f.ctx.mapStub={removeLayer:m=>removed.push(m),off:(...args)=>cleaned.push(args),on(){},getCenter:()=>({lat:59.3,lng:18.1}),getZoom:()=>12};
  for(const name of ['removeMatchingLocMarkers','removeAreaFeatures','removeMeasuringLocMarkers'])f.ctx[name]=id=>cleaned.push([name,id]);
  f.ctx.clearAngleQuestionLayers=q=>cleaned.push(['angle',q.id]);
  return {removed,cleaned};
}
const tick=()=>Promise.resolve().then(()=>Promise.resolve());
test('all local scripts parse and every stylesheet/script reference exists',()=>{
  for(const match of html.matchAll(/<(script|link)\b[^>]*(?:src|href)="([^"?#]+)(?:[?#][^"]*)?"/g)){
    if(/^https?:/.test(match[2]))continue;
    const filename=path.join(root,match[2]);assert.ok(fs.existsSync(filename),`${match[2]} exists`);
    if(match[1]==='script')new vm.Script(fs.readFileSync(filename,'utf8'),{filename});
  }
  scripts.forEach(parseInlineScript);
});
test('partial restores never overwrite the saved game',()=>{
  const f=fixture();f.run("mode='seeker'; questions=[{id:7,type:'radar',lat:59.3,lng:18.1,radius:500,unit:'M',zone:'pending'}]; saveState();");
  const before=f.values.get('jetlag_state_v1');
  f.run("_restoringState=true; questions=[]; saveState();");
  assert.equal(f.values.get('jetlag_state_v1'),before);
  f.run("_restoringState=false; saveState();");assert.equal(JSON.parse(f.values.get('jetlag_state_v1')).questions.length,0);
});
test('saved game strips Leaflet instances while retaining answers and independent transit preferences',()=>{
  const f=fixture();
  f.run(`mode='seeker'; const marker={};marker.self=marker;
    questions=[{id:1,type:'radar',lat:59.3,lng:18.1,radius:500,unit:'M',zone:'inside',marker,_centerMarker:marker,_mapMoveHandler:()=>{}}];
    _slSelectedStations.add('Stockholm Central');_slLineDetail='medium';_slFerryStopsOn=true;_transitLayerOn=true;_hideLockedPins=false;saveState();`);
  const state=JSON.parse(f.values.get('jetlag_state_v1'));assert.equal(state.questions[0].zone,'inside');assert.equal(state.questions[0].marker,undefined);
  assert.equal(state.questions[0]._centerMarker,undefined);assert.deepEqual(state.slSelectedStations,['Stockholm Central']);
  assert.equal(state.slLineDetail,'medium');assert.equal(state.slFerryStopsOn,true);assert.equal(state.transitLayerOn,true);assert.equal(state.hideLockedPins,false);
});
test('invalid saved-state shapes are ignored',()=>{
  const f=fixture();
  for(const value of ['{bad json',JSON.stringify({mode:'admin',questions:[]}),JSON.stringify({mode:'seeker',questions:{}})]){
    f.values.set('jetlag_state_v1',value);assert.equal(f.run('loadSavedState()'),false);
  }
  f.values.set('jetlag_state_v1',JSON.stringify({mode:'seeker',questions:[]}));assert.equal(f.run('loadSavedState().mode'),'seeker');
});
test('double role selection creates only one map initialization',()=>{
  const f=fixture();f.ctx.L={};
  f.run("activeRoundId='round-A';");
  f.run("chooseMode('seeker');chooseMode('seeker');chooseMode('hider');");assert.equal(f.tasks.length,1);
});
test('role switch cleans question layers, hidden location and undo state and persists the new role',()=>{
  const f=fixture(); const {removed,cleaned}=mapFixture(f);
  f.run(`let endgamePin={id:'endgame'},endgamePinLocked=true,_pinUndoStack=[{id:1}];
    mode='seeker';map=mapStub;hiderPinLocked=true;questions=[{id:1,type:'matching',marker:{id:'question'},_markerMoveHandler:()=>{}}];switchMode();`);
  const state=JSON.parse(f.values.get('jetlag_state_v1'));assert.equal(state.mode,'hider');assert.equal(state.questions.length,0);
  assert.equal(f.run('hiderPinLocked'),false);assert.equal(f.run('endgamePin'),null);assert.equal(f.run('_pinUndoStack.length'),0);
  assert.equal(removed.length,2);assert.ok(cleaned.some(args=>args[0]==='removeMatchingLocMarkers'));assert.ok(cleaned.some(args=>args[0]==='moveend'));
});
test('new round activation cannot save previous-round questions under the new round',()=>{
  const f=fixture();mapFixture(f);
  f.run("mode='seeker';map=mapStub;activeRoundId='round-A';_sessionRoundId='round-A';questions=[{id:1,type:'radar',lat:59.3,lng:18.1,radius:500,unit:'M',zone:'inside'}];saveState();");
  const before=f.values.get('jetlag_state_v1');
  f.run("activateRound('round-B');saveState();");
  assert.equal(f.values.get('jetlag_state_v1'),before,'old session is preserved until new round becomes ready');
});
test('Firebase draft writes and reads wait until the selected round owns the map session',async()=>{
  const f=fixture();mapFixture(f);let writes=0,reads=0;
  f.ctx.firebaseApi={ref:(db,key)=>key,set:async()=>writes++,update:async()=>{},get:async()=>{reads++;return {exists:()=>false};}};
  f.run("mode='seeker';map=mapStub;firebaseDb={};activeRoundId='round-B';_sessionRoundId='round-A';questions=[{id:1,type:'radar'}];");
  await f.run('saveActiveRoundDraft()');assert.equal(writes,0);
  f.run('questions=[];');assert.equal(await f.run('loadActiveRoundDraft()'),false);assert.equal(reads,0);
});
test('deliberate new round selection reuses map and clears old question state',async()=>{
  const f=fixture();mapFixture(f);let initCalls=0,subscriptions=0;
  f.ctx.initMap=()=>initCalls++;f.ctx.loadActiveRoundDraft=async()=>false;f.ctx.subscribeRoundQuestions=()=>subscriptions++;f.ctx.subscribeRoundEndgame=()=>subscriptions++;
  f.run("mode='seeker';map=mapStub;activeRoundId='round-A';_sessionRoundId='round-A';questions=[{id:9,type:'radar',marker:{}}];activateRound('round-B');chooseMode('seeker');");await tick();
  assert.equal(f.run('map'),f.ctx.mapStub);assert.equal(f.run('questions.length'),0);assert.equal(f.run('_sessionRoundId'),'round-B');assert.equal(initCalls,0);assert.equal(subscriptions,2);
  f.run('saveState()');const state=JSON.parse(f.values.get('jetlag_state_v1'));assert.equal(state.roundId,'round-B');assert.equal(state.questions.length,0);
});
test('stale mode-selection completion cannot subscribe a different round',async()=>{
  const f=fixture();mapFixture(f);let finishDraft,subscriptions=0;
  f.ctx.loadActiveRoundDraft=()=>new Promise(resolve=>finishDraft=resolve);f.ctx.subscribeRoundQuestions=()=>subscriptions++;f.ctx.subscribeRoundEndgame=()=>subscriptions++;
  f.run("mode='seeker';map=mapStub;activeRoundId='round-A';_sessionRoundId='round-A';activateRound('round-B');chooseMode('seeker');activateRound('round-C');");
  finishDraft(false);await tick();assert.equal(subscriptions,0,'old completion leaves the unready round unsubscribed');
});
test('initial delayed map initialization is cancelled after the selected round changes',()=>{
  const f=fixture();mapFixture(f);f.ctx.L={};let initCalls=0;f.ctx.initMap=()=>{initCalls++;f.run('map=mapStub');};
  for(const name of ['initTrackerViewer','_initRevampPreferences','_initFab','_initCurseHold','_initMobileNav','_initStatusBar'])f.ctx[name]=()=>{};
  f.run("activeRoundId='round-A';chooseMode('seeker');activeRoundId='round-B';");f.tasks.shift()();
  assert.equal(initCalls,0);assert.equal(f.run('mode'),null);assert.equal(f.run('_modeStarting'),false);
});
test('draft restoration rejects stale round, changed role and different saved role',async()=>{
  for(const scenario of ['round','role','draft-role']){
    const f=fixture();mapFixture(f);let finishGet,restores=0;
    f.ctx.firebaseApi={ref:(db,key)=>key,get:()=>new Promise(resolve=>finishGet=resolve)};f.ctx.restoreState=()=>restores++;
    f.run("mode='seeker';map=mapStub;firebaseDb={};mainUser={uid:'user-1'};activeRoundId='round-A';_sessionRoundId='round-A';");
    const loading=f.run('loadActiveRoundDraft()');
    if(scenario==='round')f.run("activeRoundId='round-B';_sessionRoundId='round-B';");
    if(scenario==='role')f.run("mode='hider';");
    finishGet({exists:()=>true,val:()=>({mode:scenario==='draft-role'?'hider':'seeker',questions:[{id:1,type:'radar'}]})});
    assert.equal(await loading,false,scenario);assert.equal(restores,0,scenario);
  }
});
test('round subscriptions ignore queued callbacks after the selected round changes',()=>{
  for(const kind of ['questions','endgame']){
    const f=fixture();mapFixture(f);let callback,merged=0;
    f.ctx.firebaseApi={ref:(db,key)=>key,onValue:(ref,handler)=>{callback=handler;return ()=>{};}};
    f.ctx._mergeIncomingQuestions=()=>{merged++;return false;};f.ctx.decorateQuestionSyncButtons=()=>{};f.ctx._startEndgame=()=>merged++;
    f.run("let _endgameActive=false;mode='seeker';map=mapStub;firebaseDb={};activeRoundId='round-A';_sessionRoundId='round-A';");
    f.run(kind==='questions'?'subscribeRoundQuestions()':'subscribeRoundEndgame()');
    f.run("activateRound('round-B');");
    callback({val:()=>kind==='questions'?{q1:{id:1,type:'radar'}}:{active:true,zone:{lat:59.3,lng:18.1,radius:500}}});
    assert.equal(merged,0,kind);
  }
});
test('delayed private endgame pin restore is cancelled after role or round changes',()=>{
  for(const scenario of ['role','round']){
    const f=fixture();mapFixture(f);let placed=0;
    f.ctx.addEndgameCard=()=>placed++;f.ctx.placeEndgamePin=()=>placed++;f.ctx.toggleEndgameLock=()=>{};f.ctx.applyHideLockedPins=()=>{};
    f.run("let endgamePinLocked=false;mode='hider';map=mapStub;activeRoundId='round-A';_sessionRoundId='round-A';restoreState({mode:'hider',roundId:'round-A',questions:[],endgamePin:[59.3,18.1],endgamePinLocked:true});");
    if(scenario==='role')f.run("mode='seeker';");else f.run("activeRoundId='round-B';_sessionRoundId='round-B';");
    while(f.tasks.length)f.tasks.shift()();
    assert.equal(placed,0,scenario);
  }
});
