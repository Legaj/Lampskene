const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'position-experience.js'), 'utf8');

function fixture(options = {}) {
  const elements = new Map(), documentEvents = new Map(), windowEvents = new Map(), events = [], watches = new Map(), cleared = [], singleRequests = [], movements = [], updated = [], observers = [], intervals = [];
  let nextWatch = 0, now = 1760000000000;
  class Element {
    constructor(id = '') { this.id = id; this.attrs = {}; this.dataset = {}; this.hidden = false; this.disabled = false; this.isConnected = true; this.textContent = ''; this.listeners = new Map(); this.style = {}; this.children = []; this.value = ''; this.classList = { toggle() {} }; }
    set innerHTML(html) {
      this.html = html;
      for (const match of html.matchAll(/\bid="([^"]+)"/g)) elements.set(match[1], new Element(match[1]));
      if (html.includes('data-position-close')) this.closeButton = new Element('close');
    }
    get innerHTML() { return this.html || ''; }
    setAttribute(name, value) { this.attrs[name] = value; }
    addEventListener(type, fn) { this.listeners.set(type, fn); }
    querySelector(selector) { return selector === '[data-position-close]' ? this.closeButton : null; }
    closest() { return null; }
    focus() { document.activeElement = this; }
    append(...children) { for (const child of children) { this.children.push(child); if (child.id) elements.set(child.id, child); } }
  }
  for (const id of ['mode-badge', 'header']) elements.set(id, new Element(id));
  const document = {
    body: new Element('body'), activeElement: null,
    createElement() { return new Element(); }, getElementById(id) { return elements.get(id) || null; },
    addEventListener(type, fn) { if (!documentEvents.has(type)) documentEvents.set(type, []); documentEvents.get(type).push(fn); },
    dispatchEvent(event) { events.push(event); for (const fn of documentEvents.get(event.type) || []) fn(event); }
  };
  const saved = new Map([['jetlag_location_prefs_v1', JSON.stringify({ mode: options.savedMode || 'off', name: 'Player' })]]);
  const mapHandlers = new Map();
  const ctx = {
    document, HTMLElement: Element, console, mode: 'seeker', isSecureContext: options.secure !== false,
    map: { on(type, fn) { mapHandlers.set(type, fn); }, removeLayer() {}, getZoom: () => 12, setView: (...args) => movements.push(['setView', ...args]), panTo: (...args) => movements.push(['panTo', ...args]) },
    localStorage: { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) },
    navigator: { geolocation: {
      watchPosition(success, error, config) { const id = nextWatch++; watches.set(id, { success, error, config }); if (options.synchronousDeny) error({ code: 1 }); return id; },
      clearWatch(id) { cleared.push(id); },
      getCurrentPosition(success, error, config) { singleRequests.push({ success, error, config }); }
    }, clipboard: { writeText: async () => {} } },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    MutationObserver: class { constructor(callback) { this.callback = callback; } observe(node) { observers.push([node, this.callback]); } },
    Date: class extends Date { static now() { return now; } },
    setInterval(fn) { intervals.push(fn); return intervals.length; },
    addEventListener(type, fn) { windowEvents.set(type, fn); },
    showToast() {}, appShell: {
      activePanel: null,
      closeAll() { this.close(); },
      close() { this.activePanel = null; if (options.integrated) document.dispatchEvent({ type: 'jetlag:panelchange', detail: { panel: 'map' } }); },
      registerPanel: options.integrated ? () => true : undefined,
      open(name) { this.activePanel = name; if (options.integrated) document.dispatchEvent({ type: 'jetlag:panelchange', detail: { panel: name } }); }
    },
    _ownLocation: null, _ownLocationMarker: null, _ownAccuracyCircle: null, _locationMode: 'off', _geoWatchId: null,
    _syncLocationUi() {},
    updateOwnLocation(position) {
      updated.push(position);
      ctx._ownLocation = { lat: position.coords.latitude, lng: position.coords.longitude, ts: now };
      ctx._ownLocationMarker = { bindTooltip() {}, setOpacity() {} };
      ctx._ownAccuracyCircle = { setStyle() {} };
    }
  };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(source, ctx);
  const position = (lat = 59.3, timestamp = now, accuracy = 15) => ({ coords: { latitude: lat, longitude: 18.1, accuracy, heading: null, speed: null }, timestamp });
  return { ctx, api: ctx.lampskenePosition, elements, watches, cleared, singleRequests, movements, updated, events, mapHandlers, saved, windowEvents, observers, intervals, position, advance(ms) { now += ms; } };
}

test('GPS and tracker sharing stay off on load even with a saved GPS preference', () => {
  const f = fixture({ savedMode: 'live' });
  assert.equal(f.watches.size, 0); assert.equal(f.singleRequests.length, 0);
  assert.equal(f.api.status.running, false); assert.equal(f.api.status.sharing, false); assert.equal(f.api.status.profile, 'live');
  f.ctx.initLocationSharing(); assert.equal(f.watches.size, 0);
});

test('Locate starts one local session and centers only after a valid fresh fix', () => {
  const f = fixture(); f.api.locate();
  assert.equal(f.watches.size, 1); assert.equal(f.api.status.pending, true); assert.equal(f.movements.length, 0);
  f.watches.get(0).success(f.position());
  assert.equal(f.api.status.running, true); assert.equal(f.api.status.pending, false); assert.equal(f.api.status.fix.accuracy, 15);
  assert.equal(f.movements.length, 1); assert.equal(f.movements[0][0], 'setView'); assert.equal(f.ctx._geoWatchId, 0);
  f.watches.get(0).success(f.position(59.31));
  assert.equal(f.movements.length, 1, 'ordinary updates must not drag the player around');
  assert.equal(JSON.parse(f.saved.get('jetlag_location_prefs_v1')).mode, 'off', 'reloading must not resume a watch');
});

test('intentional map dragging pauses follow without stopping GPS or player trackers', () => {
  const f = fixture(); f.api.setFollow(true); f.watches.get(0).success(f.position());
  assert.equal(f.api.status.follow, true);
  f.mapHandlers.get('dragstart')();
  assert.equal(f.api.status.follow, false); assert.equal(f.api.status.running, true);
  f.advance(2000); f.watches.get(0).success(f.position(59.32)); assert.equal(f.movements.length, 1);
});

test('stop clears watch ID zero, hides the dot, and ignores a late callback', () => {
  const f = fixture(); f.api.locate(); f.watches.get(0).success(f.position()); f.api.stop();
  assert.deepEqual(f.cleared, [0]); assert.equal(f.ctx._ownLocationMarker, null); assert.equal(f.api.status.running, false);
  f.watches.get(0).success(f.position(59.4)); assert.equal(f.api.status.fix.lat, 59.3);
});

test('permission denial clears the watch and exposes actionable permission guidance', () => {
  const f = fixture(); f.api.locate(); f.watches.get(0).error({ code: 1 });
  assert.equal(f.api.status.permission, 'denied'); assert.equal(f.api.status.running, false); assert.equal(f.api.status.open, true);
  assert.match(f.api.status.error.text, /browser.*site permissions/); assert.deepEqual(f.cleared, [0]);
});

test('a synchronous geolocation denial cannot leave a ghost active watch', () => {
  const f = fixture({ synchronousDeny: true }); f.api.locate();
  assert.equal(f.api.status.running, false); assert.equal(f.ctx._geoWatchId, null); assert.deepEqual(f.cleared, [0]);
});

test('question GPS requests one fresh fix without starting continuous GPS or sharing', async () => {
  const f = fixture(); let result;
  const request = f.ctx._getGPS((lat, lng) => { result = [lat, lng]; });
  assert.equal(f.singleRequests.length, 1); assert.equal(f.watches.size, 0);
  f.singleRequests[0].success(f.position());
  await request;
  assert.deepEqual(result, [59.3, 18.1]); assert.equal(f.api.status.running, false); assert.equal(f.api.status.sharing, false);
  const cached = await f.api.requestFix(); assert.equal(cached.lat, 59.3); assert.equal(f.singleRequests.length, 1);
});

test('stopping cancels a pending question GPS result and allows a new request', async () => {
  const f = fixture(); const pending = f.api.requestFix().catch(error => error.message); f.api.stop();
  const next = f.api.requestFix(); assert.equal(f.singleRequests.length, 2);
  f.singleRequests[0].success(f.position(59.2));
  assert.equal(await pending, 'GPS request cancelled'); assert.equal(f.api.status.fix, null);
  f.singleRequests[1].success(f.position(59.4)); assert.equal((await next).lat, 59.4);
});

test('invalid coordinates and old GPS readings never become question pins', async () => {
  const f = fixture(); const invalid = f.api.requestFix().catch(error => error.message);
  f.singleRequests[0].success(f.position(91)); assert.match(await invalid, /invalid/); assert.equal(f.api.status.fix, null);
  const old = f.api.requestFix().catch(error => error.message);
  const measurement = f.position(); f.advance(60000); f.singleRequests[1].success(measurement);
  assert.match(await old, /old/); assert.equal(f.api.status.fix, null);
});

test('accuracy, actual GPS measurement time and stale state are exposed to other map views', () => {
  const f = fixture(); f.api.locate(); const measurement = f.position(59.3); f.advance(12000); f.watches.get(0).success(measurement);
  assert.equal(f.ctx._ownLocation.ts, measurement.timestamp); assert.equal(f.api.status.stale, false);
  const copy = f.api.status; copy.fix.lat = 0; assert.equal(f.api.status.fix.lat, 59.3, 'public snapshots must not mutate GPS state');
  f.advance(34000); assert.equal(f.api.status.stale, true);
  const event = f.events.find(event => event.type === 'jetlag:positionchange' && event.detail.fix);
  assert.equal(event.detail.fix.accuracy, 15); assert.equal(event.detail.sharing, false);
});

test('leaving the game or unloading clears local GPS without changing tracker data', () => {
  const f = fixture(); f.api.locate(); f.ctx.mode = null;
  f.observers.find(([node]) => node.id === 'header')[1]();
  assert.equal(f.api.status.running, false); assert.equal(f.elements.get('position-controls').hidden, true);
  const g = fixture(); g.api.locate(); g.windowEvents.get('pagehide')(); assert.equal(g.api.status.running, false); assert.deepEqual(g.cleared, [0]);
});

test('the position panel shares the shell’s single-panel state and closes for other tools', () => {
  const f = fixture({ integrated: true });
  f.api.open(); assert.equal(f.ctx.appShell.activePanel, 'position'); assert.equal(f.api.status.open, true); assert.equal(f.elements.get('position-panel').hidden, false);
  f.ctx.appShell.open('questions'); assert.equal(f.api.status.open, false); assert.equal(f.elements.get('position-panel').hidden, true);
  f.api.open(); f.api.close(); assert.equal(f.ctx.appShell.activePanel, null); assert.equal(f.api.status.open, false);
});

test('opening a question or map tool pauses follow so the workspace does not move', () => {
  const f = fixture({ integrated: true });
  f.api.setFollow(true); f.watches.get(0).success(f.position());
  f.ctx.appShell.open('questions'); assert.equal(f.api.status.follow, false); assert.equal(f.api.status.running, true);
});
