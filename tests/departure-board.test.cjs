const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'..','departure-board.js'),'utf8');
const fixtureTime = Date.parse('2026-10-14T07:00:00Z');
const departure = overrides => ({ line:{ id:14, designation:'14', transport_mode:'METRO' }, destination:'Mörby centrum', state:'EXPECTED', scheduled:'2026-10-14T09:02:00', expected:'2026-10-14T09:05:00', journey:{ id:1 }, stop_point:{ id:20, designation:'2' }, deviations:[], ...overrides });
function helpers() {
  const context = { Intl, Date, document:{ getElementById() { return null; } } };
  vm.createContext(context); vm.runInContext(source,context); return context;
}
function uiHarness(options = {}) {
  let now = fixtureTime, timerId = 0;
  const ids = new Map(), timers = new Map(), requests = [], storage = new Map(), observers = [], documentEvents = {};
  class Element {
    constructor(tag = 'div') { this.tagName = tag; this.children = []; this.events = {}; this.dataset = {}; this.style = {}; this.value = ''; this.open = false; this.hidden = false; this.className = ''; this.textContent = ''; this.classList = { contains:name => this.className.split(' ').includes(name) }; }
    set innerHTML(html) { for (const match of html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g)) { const node = new Element(match[1]); node.id = match[2]; if (node.tagName === 'select') node.value = 'all'; ids.set(node.id,node); } }
    set id(value) { this._id = value; ids.set(value,this); }
    get id() { return this._id; }
    get firstChild() { return this.children[0] || null; }
    get nextSibling() { return this.parent ? this.parent.children[this.parent.children.indexOf(this) + 1] || null : null; }
    append(...nodes) { for (const node of nodes) { node.remove(); this.children.push(node); node.parent = this; } }
    appendChild(node) { this.append(node); }
    after(node) { this.parent.insertBefore(node,this.nextSibling); }
    insertBefore(node,reference) { if (reference === node) return; node.remove(); const index = reference ? this.children.indexOf(reference) : -1; this.children.splice(index < 0 ? this.children.length : index,0,node); node.parent = this; }
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this),1); this.parent = null; }
    replaceChildren(...nodes) { for (const child of this.children.slice()) child.remove(); this.append(...nodes); }
    addEventListener(name,fn) { this.events[name] = fn; }
    emit(name) { if (this.events[name]) this.events[name]({ target:this }); }
    querySelector() { return this.children[0]; }
  }
  const panel = new Element(); panel.id = 'sl-panel'; const header = new Element(); panel.append(header);
  class FixedDate extends Date { static now() { return now; } }
  const context = {
    Date:FixedDate, Intl, AbortController, console,
    document:{ hidden:false, getElementById:id => ids.get(id) || null, createElement:tag => new Element(tag), addEventListener(name,fn) { documentEvents[name] = fn; } },
    localStorage:{ getItem:key => storage.get(key) || null, setItem:(key,value) => storage.set(key,value) },
    MutationObserver:class { constructor(callback) { observers.push(callback); } observe() {} },
    setTimeout(fn,delay) { const id = ++timerId; timers.set(id,{ fn,delay,repeat:false }); return id; }, clearTimeout(id) { timers.delete(id); },
    setInterval(fn,delay) { const id = ++timerId; timers.set(id,{ fn,delay,repeat:true }); return id; }, clearInterval(id) { timers.delete(id); },
    map:{ getZoom:() => 12, removeLayer() {}, setView() {} }, matchMedia:() => ({ matches:false }),
    toggleSlPanel(value) { panel.className = value ? 'open' : ''; observers.forEach(fn => fn()); },
    fetch(url,args) {
      requests.push({ url,signal:args.signal });
      if (options.fetch) return options.fetch(url,args);
      const payload = url.includes('/sites?') ? [{ id:9192, name:'Slussen', lat:59.32, lon:18.07 },{ id:1080, name:'Stockholm City', lat:59.33, lon:18.05 }] : url.includes('/departures') ? { departures:[departure({ destination:'<img src=x onerror=alert(1)>' })] } : [];
      return Promise.resolve({ ok:true, headers:{ get() { return null; } }, json:() => Promise.resolve(payload) });
    }
  };
  context.window = context; vm.createContext(context); vm.runInContext(source,context);
  const board = ids.get('sl-departure-board');
  return {
    context, ids, timers, requests, panel, board, storage,
    async open() { context.toggleSlPanel(true); board.open = true; board.emit('toggle'); await new Promise(resolve => setImmediate(resolve)); },
    close() { board.open = false; board.emit('toggle'); },
    async choose(name) { const search = ids.get('departure-station-search'); search.value = name; search.emit('input'); ids.get('departure-site-results').children[0].emit('click'); await new Promise(resolve => setImmediate(resolve)); },
    async flush() { await new Promise(resolve => setImmediate(resolve)); },
    advance(ms) { now += ms; }, fireAgeTimer() { for (const t of timers.values()) if (t.repeat) t.fn(); },
    fireRefresh() { const item = Array.from(timers.entries()).find(([_,timer]) => !timer.repeat && timer.delay >= 1000 && timer.delay <= 60000 && timer.delay !== 15000); if (item) { timers.delete(item[0]); item[1].fn(); } }
  };
}

test('SL local timestamps use Stockholm independently of host timezone and handle DST safely', () => {
  const h = helpers();
  assert.equal(h.slLocalDateTime('2026-10-14T09:00:00'),Date.parse('2026-10-14T07:00:00Z'));
  assert.equal(h.slLocalDateTime('2026-01-14T09:00:00'),Date.parse('2026-01-14T08:00:00Z'));
  assert.equal(h.slLocalDateTime('2026-10-14T09:00:00+02:00'),Date.parse('2026-10-14T07:00:00Z'));
  assert.ok(Number.isNaN(h.slLocalDateTime('2026-03-29T02:30:00')));
  assert.ok(Number.isNaN(h.slLocalDateTime('2026-10-25T02:30:00')));
  assert.ok(Number.isNaN(h.slLocalDateTime('2026-13-14T09:00:00')));
});

test('departure preview derives actual SL delay, respects cancellations, and retains platform', () => {
  const h = helpers(), d = h.slNormalizeDeparture(departure());
  assert.equal(d.delay,3); assert.equal(d.platform,'2'); assert.equal(h.slDepartureDue(d,fixtureTime),'5 min');
  const cancelled = h.slNormalizeDeparture(departure({ deviations:[{ consequence:'CANCELLED', message:'Inställd' }] }));
  assert.equal(h.slDepartureDue(cancelled,fixtureTime),'Cancelled');
  assert.equal(h.slNormalizeDeparture(departure({ deviations:{} })).deviations.length,0);
  const uncertain = h.slNormalizeDeparture(departure({ expected:'2026-10-25T02:30:00', display:'5 min' }));
  assert.equal(h.slDepartureDue(uncertain,fixtureTime),'SL: 5 min');
});

test('station normalization removes expired and duplicate IDs without converting incompatible IDs', () => {
  const h = helpers(), sites = h.slNormalizeSites([
    { id:9192, name:'Slussen', lat:59.32, lon:18.07 },{ id:9192, name:'Duplicate' },
    { id:42, name:'Expired', valid:{ upto:'2025-01-01T00:00:00' } },
    { id:42, name:'Future', valid:{ from:'2027-01-01T00:00:00' } },
    { id:300109001, name:'Old lookup identifier' },null
  ],fixtureTime);
  assert.equal(sites.length,1); assert.equal(sites[0].id,'9192'); assert.equal(sites[0].lng,18.07);
});

test('real disruption structure prefers English when available and sorts importance', () => {
  const h = helpers(), alerts = h.slNormalizeAlerts([
    { deviation_case_id:1, priority:{ importance_level:2 }, message_variants:[{ language:'sv', header:'Information', details:'Text' }] },
    { deviation_case_id:2, priority:{ importance_level:7 }, message_variants:[{ language:'sv', header:'Inställd' },{ language:'en', header:'Cancelled', details:'Service cancelled' }] },null
  ]);
  assert.equal(alerts[0].header,'Cancelled'); assert.equal(alerts[1].header,'Information');
  assert.throws(() => h.slNormalizeAlerts({ error:'failed' }),/Invalid disruption/);
});

test('departure board uses explicit station selection, CORS requests, and a minute refresh limit', async () => {
  const h = uiHarness();
  assert.equal(h.requests.length,0); await h.open(); assert.equal(h.requests.length,1);
  await h.choose('Slussen'); assert.equal(h.requests.length,3);
  assert.ok(h.requests.some(r => r.url.endsWith('/sites/9192/departures')));
  assert.ok(h.requests.some(r => r.url.endsWith('/messages?site=9192')));
  const state = h.context.lampskeneDepartures.state(); assert.equal(state.departures.length,1); assert.equal(state.selected.id,'9192');
  await h.context.lampskeneDepartures.refresh(); assert.equal(h.requests.length,3);
  h.advance(60000); await h.context.lampskeneDepartures.refresh(); assert.equal(h.requests.length,5);
  h.close(); assert.equal(Array.from(h.timers.values()).some(t => t.repeat),false);
});

test('expanded departure rows survive refresh and remote labels remain text content', async () => {
  const h = uiHarness(); await h.open(); await h.choose('Slussen');
  const list = h.ids.get('departure-list'), row = list.children[0]; row.open = true;
  assert.equal(row.children[0].children[1].children[0].textContent,'<img src=x onerror=alert(1)>');
  h.advance(60000); await h.context.lampskeneDepartures.refresh();
  assert.equal(list.children[0],row); assert.equal(row.open,true);
});

test('stale departures disappear and switching stations never reuses the previous station board', async () => {
  const h = uiHarness(); await h.open(); await h.choose('Slussen');
  h.advance(181000); h.fireAgeTimer();
  assert.equal(h.context.lampskeneDepartures.state().departures.length,0);
  assert.equal(h.ids.get('departure-list').children.length,0);
  await h.choose('Stockholm'); assert.equal(h.context.lampskeneDepartures.state().selected.id,'1080');
  assert.ok(h.requests.some(r => r.url.endsWith('/sites/1080/departures')));
});

test('closing board aborts an in-flight request and ignores delayed results', async () => {
  let resolveBoard;
  const h = uiHarness({ fetch:async (url) => {
    if (url.includes('/sites?')) return { ok:true, headers:{ get() { return null; } }, json:async () => [{ id:9192, name:'Slussen' }] };
    if (url.includes('/departures')) return new Promise(resolve => { resolveBoard = resolve; });
    return { ok:true, headers:{ get() { return null; } }, json:async () => [] };
  } });
  await h.open(); await h.choose('Slussen'); assert.equal(h.context.lampskeneDepartures.state().loading,true);
  const request = h.requests.find(r => r.url.includes('/departures')); h.close(); assert.equal(request.signal.aborted,true);
  resolveBoard({ ok:true, headers:{ get() { return null; } }, json:async () => ({ departures:[departure()] }) }); await h.flush();
  assert.equal(h.context.lampskeneDepartures.state().receivedAt,0);
  assert.equal(h.context.lampskeneDepartures.state().departures.length,0);
});
