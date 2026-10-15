/* Your GPS dot is local. Firebase player trackers keep their existing separate flow. */
(() => {
  'use strict';
  if (window.lampskenePosition) return;

  const profiles = {
    balanced: { label: 'Balanced', enableHighAccuracy: false, maximumAge: 5000, timeout: 20000 },
    live: { label: 'Precise', enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    saver: { label: 'Battery saver', enableHighAccuracy: false, maximumAge: 30000, timeout: 30000 }
  };
  const byId = id => document.getElementById(id);
  const positionIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/></svg>';
  const state = { running: false, follow: false, pending: false, profile: 'balanced', permission: 'unknown', fix: null, error: null, open: false };
  let watchId = null;
  let generation = 0;
  let boundMap = null;
  let centerNextFix = false;
  let lastFollowAt = 0;
  let returnFocus = null;
  let oneShotPending = null;
  let oneShotEpoch = 0;
  let shellIntegrated = false;
  const coreUpdateOwnLocation = typeof window.updateOwnLocation === 'function' ? window.updateOwnLocation : null;
  const coreSyncLocationUi = typeof window._syncLocationUi === 'function' ? window._syncLocationUi : null;

  try {
    const saved = JSON.parse(localStorage.getItem('jetlag_location_prefs_v1') || '{}');
    if (profiles[saved.preferredProfile || saved.mode]) state.profile = saved.preferredProfile || saved.mode;
  } catch (_) { /* Location is always off until a player asks for it. */ }

  function gameMap() { return typeof map !== 'undefined' && map ? map : null; }
  function playing() { return typeof mode !== 'undefined' && (mode === 'seeker' || mode === 'hider'); }
  function toast(message) { if (typeof showToast === 'function') showToast(message, 3200); }
  function fixAge(fix = state.fix) { return fix ? Math.max(0, Date.now() - fix.timestamp) : Infinity; }
  function fresh(fix = state.fix) { return fixAge(fix) < 45000; }
  function snapshot() {
    return { ...state, fix: state.fix ? { ...state.fix } : null, stale: !fresh(), sharing: false };
  }
  function emit() { document.dispatchEvent(new CustomEvent('jetlag:positionchange', { detail: snapshot() })); }
  function saveProfile() {
    try {
      const prefs = JSON.parse(localStorage.getItem('jetlag_location_prefs_v1') || '{}');
      localStorage.setItem('jetlag_location_prefs_v1', JSON.stringify({ ...prefs, mode: 'off', preferredProfile: state.profile }));
    } catch (_) { /* private browsing */ }
  }
  function normalizedFix(position) {
    const coords = position?.coords;
    if (!coords || !Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude) || Math.abs(coords.latitude) > 90 || Math.abs(coords.longitude) > 180) return null;
    const timestamp = Number.isFinite(position.timestamp) && position.timestamp > 0 ? Math.min(position.timestamp, Date.now()) : Date.now();
    return {
      lat: coords.latitude, lng: coords.longitude,
      accuracy: Number.isFinite(coords.accuracy) && coords.accuracy >= 0 ? coords.accuracy : null,
      heading: Number.isFinite(coords.heading) ? ((coords.heading % 360) + 360) % 360 : null,
      speed: Number.isFinite(coords.speed) && coords.speed >= 0 ? coords.speed : null,
      timestamp
    };
  }
  function removeOwnDot() {
    const currentMap = gameMap();
    if (currentMap && typeof _ownLocationMarker !== 'undefined' && _ownLocationMarker) currentMap.removeLayer(_ownLocationMarker);
    if (currentMap && typeof _ownAccuracyCircle !== 'undefined' && _ownAccuracyCircle) currentMap.removeLayer(_ownAccuracyCircle);
    if (typeof _ownLocationMarker !== 'undefined') _ownLocationMarker = null;
    if (typeof _ownAccuracyCircle !== 'undefined') _ownAccuracyCircle = null;
  }
  function syncLegacy() {
    if (typeof _locationMode !== 'undefined') _locationMode = state.running ? state.profile : 'off';
    if (typeof _geoWatchId !== 'undefined') _geoWatchId = watchId;
    if (coreSyncLocationUi) coreSyncLocationUi();
  }
  function center(fix = state.fix, first = false) {
    const currentMap = gameMap();
    if (!currentMap || !fix) return;
    const point = [fix.lat, fix.lng];
    if (first) {
      const targetZoom = fix.accuracy !== null && fix.accuracy > 300 ? 14 : 16;
      currentMap.setView(point, Math.max(currentMap.getZoom(), targetZoom), { animate: false });
    } else currentMap.panTo(point, { animate: false });
  }
  function acceptPosition(position) {
    const fix = normalizedFix(position);
    if (!fix || (state.fix && fix.timestamp < state.fix.timestamp)) return false;
    state.fix = fix;
    state.pending = false;
    state.error = null;
    state.permission = 'granted';
    if (coreUpdateOwnLocation) coreUpdateOwnLocation(position);
    // Core historically stamped receipt time. Keep the actual measurement age visible.
    if (typeof _ownLocation !== 'undefined' && _ownLocation) _ownLocation.ts = fix.timestamp;
    if (typeof _ownAccuracyCircle !== 'undefined' && _ownAccuracyCircle && fix.accuracy === null) {
      gameMap()?.removeLayer(_ownAccuracyCircle); _ownAccuracyCircle = null;
    }
    if (typeof _ownLocationMarker !== 'undefined' && _ownLocationMarker?.bindTooltip) {
      _ownLocationMarker.bindTooltip(`<div class="loc-tip">Your local GPS<br>${fix.accuracy === null ? 'Accuracy unavailable' : `Accuracy ±${Math.round(fix.accuracy)} m`}</div>`, { permanent: false });
    }
    if (centerNextFix && fresh(fix)) { centerNextFix = false; center(fix, true); }
    else if (state.follow && fresh(fix) && Date.now() - lastFollowAt > 900) { lastFollowAt = Date.now(); center(fix); }
    render(); emit();
    return true;
  }
  function errorDetails(error) {
    if (!window.isSecureContext) return { code: 'insecure', title: 'A secure connection is required', text: 'Open the game using its HTTPS address to use GPS.' };
    if (error?.code === 1) return { code: 'denied', title: 'Location access is blocked', text: 'Allow Location for this site in your browser’s site permissions, then tap Try GPS again. On a phone, also check system Location Services.' };
    if (error?.code === 3) return { code: 'timeout', title: 'Still waiting for a GPS signal', text: 'Try near a window or outside. Keep this page open, then try again. Your last dot may be out of date.' };
    return { code: 'unavailable', title: 'GPS is unavailable', text: 'Check that your phone’s Location Services are on. Move to a clearer signal and try again.' };
  }
  function clearWatch() {
    generation++;
    if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    state.running = false;
    state.pending = false;
    state.follow = false;
    centerNextFix = false;
    syncLegacy();
  }
  function fail(error, fromWatch = true) {
    const details = errorDetails(error);
    if (fromWatch || error?.code === 1) clearWatch();
    state.error = details;
    state.pending = false;
    if (error?.code === 1) { state.permission = 'denied'; removeOwnDot(); }
    render(); emit();
    toast(details.title);
  }
  function start(profile = state.profile, options = {}) {
    if (!profiles[profile]) profile = 'balanced';
    clearWatch();
    state.profile = profile;
    state.error = null;
    if (!navigator.geolocation || !window.isSecureContext) {
      fail({ code: 2 }); open(); return false;
    }
    state.running = true;
    state.pending = true;
    state.follow = options.follow === true;
    centerNextFix = options.center !== false;
    const token = generation;
    try {
      watchId = navigator.geolocation.watchPosition(
        position => { if (token === generation && state.running) acceptPosition(position); },
        error => { if (token === generation && state.running) { fail(error); open(); } },
        { ...profiles[profile] }
      );
      // Some test/browser shims invoke a denied callback synchronously.
      if (!state.running) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    } catch (_) { fail({ code: 2 }); open(); return false; }
    saveProfile(); syncLegacy(); render(); emit();
    return state.running;
  }
  function stop() {
    clearWatch(); oneShotEpoch++;
    oneShotPending = null;
    state.error = null;
    removeOwnDot(); saveProfile(); render(); emit();
  }
  function locate() {
    close();
    window.appShell?.closeAll({ restoreFocus: false });
    if (state.running && fresh()) { center(state.fix, true); return; }
    start(state.profile, { center: true, follow: false });
  }
  function setFollow(follow) {
    if (!follow) { state.follow = false; render(); emit(); return; }
    close(); window.appShell?.closeAll({ restoreFocus: false });
    if (!state.running) { start(state.profile, { center: true, follow: true }); return; }
    state.follow = true;
    if (fresh()) center(state.fix, true);
    else centerNextFix = true;
    render(); emit();
  }
  function requestFix(options = {}) {
    if (state.fix && fixAge() < 10000 && state.permission !== 'denied') return Promise.resolve({ ...state.fix });
    if (oneShotPending) return oneShotPending;
    if (!navigator.geolocation || !window.isSecureContext) {
      const error = errorDetails({ code: 2 }); state.error = error; render(); emit(); open(); return Promise.reject(new Error(error.title));
    }
    const epoch = oneShotEpoch;
    state.pending = true; state.error = null; render(); emit();
    const pending = new Promise((resolve, reject) => {
      const success = position => {
        if (epoch !== oneShotEpoch) { reject(new Error('GPS request cancelled')); return; }
        const fix = normalizedFix(position);
        if (!fix || Date.now() - fix.timestamp >= 45000) { fail({ code: 2 }, false); reject(new Error('GPS returned an invalid or old position')); return; }
        acceptPosition(position);
        resolve({ ...state.fix });
      };
      const failure = error => {
        if (epoch === oneShotEpoch) { fail(error, false); open(); }
        reject(new Error(errorDetails(error).title));
      };
      try { navigator.geolocation.getCurrentPosition(success, failure, { enableHighAccuracy: options.precise !== false, maximumAge: 10000, timeout: 20000 }); }
      catch (_) { failure({ code: 2 }); }
    }).finally(() => { if (oneShotPending === pending) oneShotPending = null; });
    oneShotPending = pending;
    return pending;
  }
  function open(trigger) {
    if (!playing()) return;
    if (!shellIntegrated) window.appShell?.closeAll({ restoreFocus: false });
    returnFocus = trigger instanceof HTMLElement ? trigger : document.activeElement;
    state.open = true; render();
    if (shellIntegrated) window.appShell.open('position', { focus: false, trigger: returnFocus });
    byId('position-panel')?.querySelector('[data-position-close]')?.focus({ preventScroll: true });
  }
  function close(restoreFocus = false) {
    state.open = false; render();
    if (shellIntegrated && window.appShell.activePanel === 'position') window.appShell.close({ restoreFocus: false });
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }
  function bindMap() {
    const currentMap = gameMap();
    if (!currentMap || currentMap === boundMap) return;
    boundMap = currentMap;
    currentMap.on('dragstart', () => {
      if (!state.follow) return;
      state.follow = false; render(); emit(); toast('Follow paused — explore the map freely');
    });
  }
  function setText(id, text) { const node = byId(id); if (node && node.textContent !== text) node.textContent = text; }
  function render() {
    if (!byId('position-controls')) return;
    bindMap();
    byId('position-controls').hidden = !playing() || state.open;
    const panel = byId('position-panel');
    panel.hidden = !state.open || !playing(); panel.inert = panel.hidden;
    byId('position-options-btn').setAttribute('aria-expanded', String(!panel.hidden));
    byId('position-locate-btn').classList.toggle('is-following', state.follow);
    setText('position-locate-label', state.follow ? 'Following' : 'Locate');
    const stale = state.fix && !fresh();
    const accuracy = state.fix?.accuracy !== null && state.fix ? `±${Math.round(state.fix.accuracy)} m` : 'Accuracy unknown';
    const age = state.fix ? Math.floor(fixAge() / 1000) : null;
    const ageLabel = age === null ? 'No position yet' : age < 60 ? `${age}s ago` : `${Math.floor(age / 60)}m ago`;
    const summary = state.error ? 'GPS needs attention' : state.pending ? 'Finding you…' : state.running ? stale ? 'GPS signal stale' : accuracy : 'GPS off';
    setText('position-locate-status', summary);
    setText('position-status-title', state.error?.title || (state.pending ? 'Finding your position…' : state.running ? stale ? 'Last position is out of date' : state.follow ? 'Following your position' : 'Your GPS is on' : 'Your GPS is off'));
    setText('position-status-detail', state.error?.text || (state.pending ? 'Allow Location when your browser asks. A first fix can take a few seconds.' : state.running ? stale ? 'The dot shows the last GPS reading. Wait for a new signal before using it as a question pin.' : 'Your dot and accuracy circle are visible on this device. Dragging the map pauses follow.' : 'Tap Locate me to show your dot. This does not share a player tracker.'));
    const quality = !state.fix ? '' : stale ? 'stale' : state.fix.accuracy === null || state.fix.accuracy > 100 ? 'uncertain' : 'good';
    byId('position-status-card').dataset.quality = quality;
    if (typeof _ownLocationMarker !== 'undefined' && _ownLocationMarker?.setOpacity) _ownLocationMarker.setOpacity(stale ? 0.5 : 1);
    if (typeof _ownAccuracyCircle !== 'undefined' && _ownAccuracyCircle?.setStyle) _ownAccuracyCircle.setStyle({ opacity: stale ? 0.2 : 0.35, fillOpacity: stale ? 0.03 : 0.08 });
    byId('position-facts').hidden = !state.fix;
    setText('position-accuracy', accuracy);
    setText('position-age', ageLabel);
    setText('position-coordinate-value', state.fix ? `${state.fix.lat.toFixed(5)}, ${state.fix.lng.toFixed(5)}` : '');
    setText('position-accuracy-note', state.fix?.accuracy > 100 ? 'Wide accuracy circle: check the pin before sending a question.' : 'The circle is an estimate of GPS uncertainty, not a search zone.');
    const follow = byId('position-follow-btn');
    follow.setAttribute('aria-pressed', String(state.follow)); follow.textContent = state.follow ? 'Pause follow' : 'Follow my movement';
    byId('position-stop-btn').disabled = !state.running && !state.pending && !(typeof _ownLocationMarker !== 'undefined' && _ownLocationMarker);
    byId('position-copy-btn').disabled = !state.fix;
    setText('position-start-label', state.error ? 'Try GPS again' : 'Locate me');
    const profile = byId('position-profile');
    if (profile && document.activeElement !== profile) profile.value = state.profile;
  }
  function setup() {
    const controls = document.createElement('div'); controls.id = 'position-controls'; controls.hidden = true;
    controls.innerHTML = `<button type="button" id="position-locate-btn" aria-label="Locate me on the map">${positionIcon}<span><strong id="position-locate-label">Locate</strong><small id="position-locate-status">GPS off</small></span></button><button type="button" id="position-options-btn" aria-label="Open position and GPS controls" aria-controls="position-panel" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4"/></svg></button>`;
    const panel = document.createElement('section'); panel.id = 'position-panel'; panel.hidden = true; panel.inert = true; panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', 'Your position and GPS');
    panel.innerHTML = `<header class="position-panel-header"><div><h2>Your position</h2><p>A local GPS dot. Sharing stays separate.</p></div><button type="button" data-position-close aria-label="Close position controls">×</button></header><div class="position-panel-body"><section id="position-status-card" class="position-status-card"><strong id="position-status-title" role="status" aria-live="polite">Your GPS is off</strong><p id="position-status-detail"></p><dl id="position-facts" hidden><div><dt>Accuracy</dt><dd id="position-accuracy"></dd></div><div><dt>GPS reading</dt><dd id="position-age"></dd></div></dl><p class="position-help" id="position-accuracy-note"></p></section><div class="position-main-actions"><button type="button" id="position-start-btn" class="position-primary">${positionIcon}<span id="position-start-label">Locate me</span></button><button type="button" id="position-follow-btn" aria-pressed="false">Follow my movement</button><button type="button" id="position-stop-btn">Stop & hide my dot</button></div><label class="position-profile-label" for="position-profile">GPS quality<select id="position-profile"><option value="balanced">Balanced · everyday use</option><option value="live">Precise · more battery</option><option value="saver">Battery saver · slower fixes</option></select></label><p class="position-help">Balanced works well outdoors. Precise can help with a question pin; it does not guarantee a more accurate signal.</p><details class="position-details"><summary>Coordinates & tracker sharing</summary><div><output id="position-coordinate-value"></output><button type="button" id="position-copy-btn">Copy my coordinates</button><p>GPS here shows only your own dot. To send this phone’s position to approved players, open the separate tracker page and explicitly start sharing there.</p><a href="tracker-phone.html" target="_blank" rel="noopener">Open phone tracker ↗</a><button type="button" id="position-players-btn">View approved player trackers</button></div></details></div>`;
    document.body.append(controls, panel);
    shellIntegrated = window.appShell?.registerPanel?.('position', panel, { geometry: false, label: 'Your position and GPS' }) === true;
    byId('position-locate-btn').addEventListener('click', locate);
    byId('position-options-btn').addEventListener('click', event => state.open ? close(true) : open(event.currentTarget));
    panel.querySelector('[data-position-close]').addEventListener('click', () => close(true));
    byId('position-start-btn').addEventListener('click', locate);
    byId('position-follow-btn').addEventListener('click', () => setFollow(!state.follow));
    byId('position-stop-btn').addEventListener('click', stop);
    byId('position-profile').addEventListener('change', event => {
      state.profile = profiles[event.target.value] ? event.target.value : 'balanced'; saveProfile();
      if (state.running) start(state.profile, { center: false, follow: state.follow });
      else render();
    });
    byId('position-copy-btn').addEventListener('click', async () => {
      if (!state.fix) return;
      try { await navigator.clipboard.writeText(`${state.fix.lat.toFixed(6)}, ${state.fix.lng.toFixed(6)}`); toast('Your coordinates copied'); }
      catch (_) { toast('Copy is unavailable. Your coordinates are shown above.'); }
    });
    byId('position-players-btn').addEventListener('click', () => { close(); if (typeof openTrackerMenu === 'function') openTrackerMenu(); });
    // Keep original controls callable, but give the settings menu one clear entry.
    const legacy = byId('position-settings-host') || byId('loc-mode-btn')?.closest('.settings-section');
    if (legacy) {
      const label = legacy.querySelector(':scope > .sp-label'); if (label) label.textContent = 'Position & player trackers';
      const legacyGrid = byId('loc-mode-btn')?.parentElement; if (legacyGrid) legacyGrid.hidden = true;
      if (byId('loc-transit-btn')) byId('loc-transit-btn').hidden = true;
      const shortcut = document.createElement('button'); shortcut.type = 'button'; shortcut.className = 'sp-btn position-settings-link';
      shortcut.innerHTML = '<span>Your position & GPS</span><span>Open →</span>';
      shortcut.addEventListener('click', event => open(event.currentTarget));
      if (label) label.after(shortcut); else legacy.prepend(shortcut);
    }
    document.addEventListener('jetlag:panelchange', event => {
      if (shellIntegrated) state.open = event.detail?.panel === 'position';
      else if (event.detail?.panel !== 'map') state.open = false;
      // Working on a question or another tool must not move the map beneath it.
      if (!['map', 'position'].includes(event.detail?.panel) && state.follow) { state.follow = false; emit(); }
      bindMap(); render();
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && state.open) { event.preventDefault(); close(true); } });
    const role = byId('mode-badge');
    if (role) new MutationObserver(() => { if (!playing() && (state.running || state.pending)) stop(); if (!playing()) close(); render(); }).observe(role, { childList: true, characterData: true, subtree: true });
    if (navigator.permissions?.query) navigator.permissions.query({ name: 'geolocation' }).then(permission => {
      const update = () => {
        state.permission = permission.state;
        if (permission.state === 'denied' && (state.running || state.pending)) { oneShotEpoch++; fail({ code: 1 }); }
        else { render(); emit(); }
      };
      update(); permission.addEventListener?.('change', update);
    }).catch(() => {});
    window.addEventListener('pagehide', () => { clearWatch(); oneShotEpoch++; });
    const header = byId('header');
    if (header) new MutationObserver(() => {
      if (!playing() && (state.running || state.pending)) stop();
      if (!playing()) close(); render();
    }).observe(header, { attributes: true, attributeFilter: ['style'] });
    document.addEventListener('visibilitychange', () => { render(); emit(); });
    setInterval(() => { render(); if (state.running && state.fix && !fresh()) emit(); }, 5000);
    render();
  }

  window.lampskenePosition = { locate, open, close, stop, setFollow, requestFix, get status() { return snapshot(); } };
  // Preserve old public functions while routing them through the same GPS session.
  window.startLocationMode = next => next === 'off' ? stop() : start(next, { center: false });
  window.centerOwnLocation = locate;
  window.toggleOnTransit = () => state.running ? stop() : locate();
  window.cycleLocationMode = () => open();
  window.initLocationSharing = () => { syncLegacy(); render(); };
  window._getGPS = callback => requestFix().then(fix => {
    if (fix.accuracy !== null && fix.accuracy > 100) toast(`GPS accuracy ±${Math.round(fix.accuracy)} m — check your question pin`);
    callback(fix.lat, fix.lng);
  }).catch(() => {});
  setup();
})();
