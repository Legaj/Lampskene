const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname,'..','vehicles.js'),'utf8');
function harness(options = {}) {
  let now = 1800000000000, timerId = 0;
  const timers = new Map(), scripts = [], listeners = {}, mapEvents = {}, layers = new Set();
  const elements = new Map();
  const makeElement = tag => ({ tagName:tag, style:{}, attrs:{}, textContent:'', classList:{ toggle() {} }, setAttribute(k,v) { this.attrs[k] = v; }, remove() { this.removed = true; } });
  const makeLayer = () => ({
    addTo() { layers.add(this); return this; }, bindTooltip() { return this; },
    on(name,fn) { this[name] = fn; return this; }, setLatLng(latlng) { this.latlng = latlng; return this; },
    setIcon(icon) { this.icon = icon; return this; }, setTooltipContent() { return this; }
  });
  class TrackerDate extends Date { static now() { return now; } }
  const map = {
    panCount:0, setViewCount:0, removeLayer(layer) { layers.delete(layer); },
    on(name,fn) { mapEvents[name] = fn; }, getBounds() { return { contains:position => position[0] >= 59 && position[0] <= 60 && position[1] >= 17 && position[1] <= 19 }; },
    getZoom() { return 12; }, setView() { this.setViewCount++; }, panTo() { this.panCount++; }
  };
  const context = {
    console:{ warn() {} }, Date:TrackerDate, map,
    _slLineLive:false, _slLiveInterval:null, _slLiveMarkers:{}, _slLastVehicles:null,
    _slRoutes:{ '4':{ ref:'4', type:'bus', baseColor:'#0070c0' }, '43':{ ref:'43', type:'train' } },
    routesForSlMap:() => [{ ref:'4' }], showToast() {}, toggleSlPanel() {},
    WORKER_URL:'https://example.test/live',
    L:{ divIcon:o => o, marker:makeLayer, circle:makeLayer, polyline:makeLayer },
    fetch:options.fetch || (() => Promise.resolve({ ok:true, text:() => Promise.resolve('route_id,route_short_name,route_type\n9011001000400000,4,700\n9011001004300000,43,100') })),
    document:{ hidden:false, addEventListener(name,fn) { listeners[name] = fn; },
      createElement:makeElement, getElementById(id) { if (!elements.has(id)) elements.set(id,makeElement('div')); return elements.get(id); },
      head:{ appendChild(script) { scripts.push(script); } } },
    localStorage:{ getItem() { return null; }, setItem() {} },
    CustomEvent:class { constructor(type) { this.type = type; } },
    dispatchEvent() {},
    setTimeout(fn,delay) { const id = ++timerId; timers.set(id,{ fn,delay,at:now + delay,repeat:false }); return id; },
    setInterval(fn,delay) { const id = ++timerId; timers.set(id,{ fn,delay,at:now + delay,repeat:true }); return id; },
    clearTimeout(id) { timers.delete(id); }, clearInterval(id) { timers.delete(id); }
  };
  context.window = context;
  vm.createContext(context); vm.runInContext(source,context,{ filename:'vehicles.js' });
  return {
    context, map, scripts, timers, elements, layers, events:mapEvents,
    run(code) { return vm.runInContext(code,context); },
    now() { return now; }, advance(ms) { now += ms; },
    activeScripts() { return scripts.filter(s => !s.removed); },
    deliver(data,script = scripts.at(-1)) { context[new URL(script.src).searchParams.get('cb')](data); },
    fireInterval() { for (const timer of timers.values()) if (timer.repeat) timer.fn(); },
    visibility(hidden) { context.document.hidden = hidden; listeners.visibilitychange(); }
  };
}
const vehicle = (id,line = '4',extra = {}) => ({ id, routeId:'9011001' + line.padStart(4,'0') + '0000', lat:59.33, lng:18.07, bearing:90, ...extra });

test('CSV metadata preserves quoted fields, BOM, line types, and trip fallback', () => {
  const h = harness();
  assert.deepEqual(Array.from(h.context.csvSplitLine('"a,b","a""b",4')),['a,b','a"b','4']);
  h.context.routesFixture = '\uFEFFroute_id,route_short_name,route_type\r\na,4,700\r\nb,43,100\r\nc,?,\r\n';
  h.run("_routeMap = parseRoutesCsv(routesFixture); _tripMap = { trip:'b' };");
  assert.equal(h.context.resolveVehicle({ routeId:'a' }).type,'bus');
  assert.equal(h.context.resolveVehicle({ routeId:'b' }).type,'train');
  assert.equal(h.context.resolveVehicle({ routeId:'c' }).type,'unknown');
  assert.equal(h.context.resolveVehicle({ routeId:'unresolved', tripId:'trip' }).line,'43');
  assert.equal(h.context.vehicleColor('10'),'#0070c0');
  assert.equal(h.context.vehicleColor('14'),'#d71920');
});
test('the 3D live-transit switch turns both feed consumers off and reopens all vehicles without pause',()=>{
  const h=harness(),api=h.context.lampskeneTracker;
  h.context.toggleSlLineLive();assert.equal(api.state().enabled,true);assert.equal(api.state().linesEnabled,true);
  api.setEnabled(false);assert.equal(api.state().enabled,false);assert.equal(api.state().allEnabled,false);assert.equal(api.state().linesEnabled,false);
  api.setEnabled(true);assert.equal(api.state().allEnabled,true);assert.equal(api.state().linesEnabled,false);assert.equal(api.state().paused,false);
});

test('invalid, duplicate, and stale source positions are excluded', () => {
  const h = harness(), now = h.now();
  const list = h.context.normalizeVehicleFeed([
    vehicle('good','4',{ timestamp:now / 1000, bearing:450 }), vehicle('good'),
    vehicle('null','4',{ lat:null }), vehicle('empty','4',{ lng:'' }), vehicle('bounds','4',{ lat:100 }),
    vehicle('stale','4',{ timestamp:(now - 121000) / 1000 }), null,
    vehicle('unknown-bearing','4',{ bearing:null }), vehicle('missing-time')
  ],now);
  assert.equal(list.length,3);
  assert.equal(list[0].bearing,90);
  assert.equal(list[1].bearing,-1);
  assert.equal(list[2].timestamp,null);
  assert.throws(() => h.context.normalizeVehicleFeed({ error:'Worker unavailable' },now),/Worker unavailable/);
});

test('both live switches share one request and never duplicate markers', () => {
  const h = harness();
  h.context.toggleLiveTrains(); h.context.toggleSlLineLive();
  assert.equal(h.activeScripts().length,1);
  h.deliver([vehicle('bus'),vehicle('rail','43')]);
  assert.equal(h.run('Object.keys(trainMarkers).length'),2);
  assert.equal(h.run('Object.keys(_slLiveMarkers).length'),0);
  h.context.toggleLiveTrains();
  assert.equal(h.run('Object.keys(trainMarkers).length'),0);
  assert.equal(h.run('Object.keys(_slLiveMarkers).length'),1);
  const lateScript = h.activeScripts()[0];
  h.context.toggleSlLineLive(); h.deliver([vehicle('late')],lateScript);
  assert.equal(h.context.lampskeneTracker.state().enabled,false);
  assert.equal(h.activeScripts().length,0);
  assert.equal(h.layers.size,0);
  assert.equal(h.run('countdownInterval'),null);
  assert.equal(h.run('trainInterval'),null);
});

test('a delayed metadata load cannot restart polling after rapid disable', async () => {
  let resolveFetch;
  const pending = new Promise(resolve => { resolveFetch = resolve; });
  const h = harness({ fetch:() => pending });
  h.context.toggleLiveTrains(); h.context.toggleLiveTrains();
  resolveFetch({ ok:true, text:() => Promise.resolve('route_id,route_short_name\na,4') });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.context.lampskeneTracker.state().enabled,false);
  assert.equal(h.activeScripts().length,0);
  assert.equal(h.run('trainInterval'),null);
  assert.equal(h.run('countdownInterval'),null);
});

test('JSONP timeout cleans up, allows a retry, and ignores late callbacks', () => {
  const h = harness(); h.context.toggleLiveTrains();
  const old = h.activeScripts()[0], timeout = Array.from(h.timers.values()).find(t => t.delay === 12000);
  timeout.fn();
  assert.equal(h.activeScripts().length,0);
  assert.match(h.context.lampskeneTracker.state().error,/timed out/);
  h.context.fetchAndRenderTrains();
  assert.equal(h.activeScripts().length,1);
  assert.notEqual(old.src,h.activeScripts()[0].src);
  h.deliver([vehicle('late')],old);
  assert.equal(h.context.lampskeneTracker.state().receivedAt,0);
  h.deliver([vehicle('fresh')]);
  assert.equal(h.context.lampskeneTracker.state().error,'');
});

test('source positions expire independently of reception age and paused positions expire', () => {
  const h = harness(); h.context.toggleLiveTrains();
  h.deliver([vehicle('aging','4',{ timestamp:(h.now() - 110000) / 1000 })]);
  assert.equal(h.layers.size,1);
  h.advance(11000); h.fireInterval();
  assert.equal(h.context.lampskeneTracker.state().vehicles.length,0);
  assert.equal(h.layers.size,0);
  h.context.fetchAndRenderTrains(); h.deliver([vehicle('new')]);
  h.context.setVehiclePaused(true); h.advance(121000); h.fireInterval();
  assert.equal(h.layers.size,0);
  assert.equal(h.activeScripts().length,0);
});

test('motion uses two plausible samples, caps projection, and rejects jumps and repeated timestamps', () => {
  const h = harness();
  const first = h.context.normalizeVehicleFeed([vehicle('moving','4',{ timestamp:h.now() / 1000 })],h.now())[0];
  h.context.recordVehicleObservations([first],h.now());
  assert.equal(h.context.vehicleProjection(first,h.now()),null);
  h.advance(15000);
  const second = h.context.normalizeVehicleFeed([vehicle('moving','4',{ lng:18.074, timestamp:h.now() / 1000 })],h.now())[0];
  h.context.recordVehicleObservations([second],h.now());
  const projection = h.context.vehicleProjection(second,h.now());
  assert.ok(projection && projection.meters > 0 && projection.meters <= 600);
  assert.ok(projection.lng > second.lng); assert.equal(projection.seconds,20);
  h.context.recordVehicleObservations([second],h.now());
  assert.ok(h.context.vehicleProjection(second,h.now()));
  h.advance(46000);
  assert.equal(h.context.vehicleProjection(second,h.now()),null);
  h.advance(15000);
  const jump = h.context.normalizeVehicleFeed([vehicle('moving','4',{ lat:60, lng:20, timestamp:h.now() / 1000 })],h.now())[0];
  h.context.recordVehicleObservations([jump],h.now());
  assert.equal(h.context.vehicleProjection(jump,h.now()),null);
});

test('selection leaves the map still; deliberate follow moves on fresh data and map drag releases it', () => {
  const h = harness(); h.context.toggleLiveTrains(); h.deliver([vehicle('seek')]);
  h.context.selectTrackedVehicle('seek',false);
  assert.equal(h.map.panCount,0); assert.equal(h.map.setViewCount,0);
  h.context.centerTrackedVehicle(true); assert.equal(h.map.setViewCount,1);
  h.advance(15000); h.context.fetchAndRenderTrains(); h.deliver([vehicle('seek','4',{ lng:18.071 })]);
  assert.equal(h.map.panCount,1);
  h.events.dragstart(); assert.equal(h.context.lampskeneTracker.state().followId,'');
  h.advance(15000); h.context.fetchAndRenderTrains(); h.deliver([vehicle('seek','4',{ lng:18.072 })]);
  assert.equal(h.map.panCount,1);
});

test('out-of-order source samples cannot move a marker backwards', () => {
  const h = harness(); h.context.toggleLiveTrains();
  h.deliver([vehicle('ordered','4',{ lng:18.08, timestamp:h.now() / 1000 })]);
  h.advance(15000); h.context.fetchAndRenderTrains();
  h.deliver([vehicle('ordered','4',{ lng:18.07, timestamp:(h.now() - 20000) / 1000 })]);
  assert.equal(h.context.lampskeneTracker.state().vehicles[0].lng,18.08);
});

test('marker IDs cannot mutate object prototypes and filters remove follow', () => {
  const h = harness(); h.context.toggleSlLineLive(); h.deliver([vehicle('__proto__'),vehicle('other')]);
  assert.equal(h.run('Object.keys(_slLiveMarkers).length'),2);
  h.context.selectTrackedVehicle('other',false); h.context.centerTrackedVehicle(true);
  h.context.setVehicleFilters({ query:'__proto__' });
  assert.equal(h.context.lampskeneTracker.state().vehicles.length,1);
  assert.equal(h.context.lampskeneTracker.state().followId,'');
});

test('hidden tabs stop network polling and resume through one fresh request', () => {
  const h = harness(); h.context.toggleLiveTrains();
  h.visibility(true); assert.equal(h.activeScripts().length,0);
  assert.equal(h.run('trainInterval'),null);
  h.context.fetchAndRenderTrains(); assert.equal(h.activeScripts().length,0);
  h.visibility(false); assert.equal(h.activeScripts().length,1);
  h.visibility(false); assert.equal(h.activeScripts().length,1);
});
test('3D viewport filtering uses its supplied bounds without changing shared transit preferences',()=>{
  const h=harness();h.context.toggleLiveTrains();h.deliver([vehicle('city'),vehicle('north','4',{lat:59.8,lng:18.2})]);
  h.context.setVehicleFilters({inView:true});
  const north=h.context.lampskeneTracker.state({contains:([lat,lng])=>lat>59.7&&lng<18.3});
  assert.deepEqual(Array.from(north.vehicles,v=>v.id),['north']);
  assert.equal(h.context.lampskeneTracker.state().vehicles.length,2,'normal game map keeps its own bounds');
  assert.equal(north.filters.inView,true);
});
