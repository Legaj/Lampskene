// Stable, accessible tracker controls layered over the existing SL line picker.
(function () {
  'use strict';
  const tracker = window.lampskeneTracker;
  const panel = document.getElementById('sl-panel');
  if (!tracker || !panel || document.getElementById('sl-tracker-section')) return;
  const section = document.createElement('details');
  section.id = 'sl-tracker-section'; section.className = 'tracker-section';
  section.innerHTML = `
    <summary><span class="tracker-summary-title">Live tracker</span><span id="tracker-summary-status" class="tracker-badge">Off</span></summary>
    <div class="tracker-body">
      <p class="tracker-help">Find a service, select its arrow on the map, then center or follow it. Lines and stops below help plan your next move.</p>
      <div class="tracker-scope" role="group" aria-label="Live vehicle layers">
        <button type="button" id="tracker-all" aria-pressed="false">All vehicles</button>
        <button type="button" id="tracker-lines" aria-pressed="false">Displayed lines</button>
      </div>
      <div class="tracker-feed-row"><span id="tracker-feed-status" role="status" aria-live="polite">Tracking is off</span>
        <div class="tracker-feed-actions"><button type="button" id="tracker-refresh" title="Refresh live positions">Refresh</button><button type="button" id="tracker-pause">Pause</button></div>
      </div>
      <p id="tracker-feed-error" class="tracker-message" hidden></p>
      <div class="tracker-filters">
        <label>Search<input type="search" id="tracker-query" placeholder="Line or vehicle" autocomplete="off" maxlength="80"></label>
        <label>Service<select id="tracker-type"><option value="all">All services</option><option value="bus">Bus</option><option value="subway">Metro</option><option value="train">Train</option><option value="tram">Tram</option><option value="light_rail">Light rail</option><option value="ferry">Ferry</option><option value="unknown">Unidentified</option></select></label>
      </div>
      <div class="tracker-view-filter"><label><input type="checkbox" id="tracker-in-view"> In map view</label><button type="button" id="tracker-reset">Reset</button></div>
      <div class="tracker-results-head"><span id="tracker-results-count">0 vehicles</span><span>Choose one to inspect</span></div>
      <div id="tracker-vehicle-list" class="tracker-vehicle-list" aria-label="Live vehicles"></div>
      <p id="tracker-empty" class="tracker-empty">Turn on a live vehicle layer to begin.</p>
      <button type="button" id="tracker-more" class="tracker-more" hidden>Show more vehicles</button>
      <div id="tracker-detail" class="tracker-detail" aria-label="Selected vehicle">
        <div class="tracker-detail-heading"><span id="tracker-detail-title">Vehicle preview</span><span id="tracker-detail-badge" class="tracker-badge" hidden></span></div>
        <p id="tracker-detail-summary">Select a vehicle in the list or on the map to see its direction, freshness, and nearest mapped stop.</p>
        <dl id="tracker-detail-facts" hidden><div><dt>Direction</dt><dd id="tracker-direction">Unavailable</dd></div><div><dt>Speed</dt><dd id="tracker-movement">Waiting for samples</dd></div><div><dt>Position age</dt><dd id="tracker-position-age">Unknown</dd></div><div><dt>Nearest stop</dt><dd id="tracker-nearest-stop">Unavailable</dd></div></dl>
        <div id="tracker-detail-actions" class="tracker-detail-actions" hidden><button type="button" id="tracker-center">Center</button><button type="button" id="tracker-follow" aria-pressed="false">Follow</button><button type="button" id="tracker-nearby-departures" hidden>Stop departures</button></div>
        <label class="tracker-projection-option" id="tracker-projection-label" hidden><input type="checkbox" id="tracker-projection"> Motion estimate</label>
        <p id="tracker-projection-note" class="tracker-footnote" hidden>A dashed 20-second direction estimate, capped at 600 m. It assumes a straight course and constant speed; the circle illustrates uncertainty.</p>
      </div>
      <p class="tracker-footnote">Markers show received positions; coverage varies by service. The vehicle feed has no stop sequence or delay forecasts. Use the departure board below for SL’s expected departures and disruptions.</p>
    </div>`;
  const header = panel.querySelector('.sl-header');
  header ? header.after(section) : panel.prepend(section);
  const el = id => document.getElementById(id);
  let listLimit = 40, listSignature = '', lastSelection = '', previousFeedState = '';
  const rows = new Map();
  const labels = { bus:'Bus', subway:'Metro', train:'Train', tram:'Tram', light_rail:'Light rail', ferry:'Ferry', unknown:'Vehicle' };
  function text(id,value) { const target = el(id); if (target.textContent !== value) target.textContent = value; }
  function setPressed(id,value) { el(id).setAttribute('aria-pressed',String(value)); }
  function ageText(milliseconds) {
    const seconds = Math.max(0,Math.floor(milliseconds / 1000));
    return seconds < 60 ? seconds + 's ago' : Math.floor(seconds / 60) + 'm ago';
  }
  function metricDistance(meters) { return meters < 1000 ? Math.round(meters / 10) * 10 + ' m' : (meters / 1000).toFixed(1) + ' km'; }
  function nearestStop(vehicle,line) {
    const route = typeof _slRoutes !== 'undefined' ? _slRoutes[line] : null;
    if (!route || !Array.isArray(route.stops) || !route.stops.length) return null;
    let nearest = null;
    for (const stop of route.stops) {
      if (!Number.isFinite(Number(stop.lat)) || !Number.isFinite(Number(stop.lng))) continue;
      const meters = vehicleDistance(vehicle,stop);
      if (!nearest || meters < nearest.meters) nearest = { name:stop.name, meters };
    }
    return nearest;
  }
  function sortedVehicles(vehicles) {
    return vehicles.slice().sort((a,b) => {
      const ai = tracker.info(a), bi = tracker.info(b);
      return String(ai.line || '\uffff').localeCompare(String(bi.line || '\uffff'),undefined,{ numeric:true }) || a.id.localeCompare(b.id,undefined,{ numeric:true });
    });
  }
  function renderRows(state) {
    const vehicles = sortedVehicles(state.vehicles).slice(0,listLimit);
    const signature = [state.receivedAt,state.selectedId,state.filters.query,state.filters.type,state.filters.inView,state.allEnabled,state.linesEnabled,listLimit,vehicles.map(v => v.id + ':' + tracker.info(v).line + ':' + tracker.info(v).type).join('|')].join('~');
    if (signature === listSignature) return;
    listSignature = signature;
    const ids = new Set(vehicles.map(v => v.id));
    for (const [id,row] of rows) if (!ids.has(id)) { row.remove(); rows.delete(id); }
    const container = el('tracker-vehicle-list');
    let previous = null;
    for (const vehicle of vehicles) {
      let row = rows.get(vehicle.id);
      if (!row) {
        row = document.createElement('button'); row.type = 'button'; row.className = 'tracker-vehicle-row';
        row.innerHTML = '<span class="tracker-line-badge"></span><span class="tracker-row-meta"><strong></strong><span></span></span><span class="tracker-row-direction"></span>';
        row.addEventListener('click', () => tracker.select(vehicle.id,false)); rows.set(vehicle.id,row);
      }
      const info = tracker.info(vehicle), line = info.line || '—', label = labels[info.type] || 'Vehicle';
      row.querySelector('.tracker-line-badge').textContent = line;
      row.querySelector('.tracker-line-badge').style.setProperty('--vehicle-color',vehicleColor(info.line));
      row.querySelector('strong').textContent = label + (info.line ? ' ' + line : ' · line unavailable');
      row.querySelector('.tracker-row-meta > span').textContent = 'Vehicle ' + String(vehicle.label || vehicle.id).slice(0,32);
      row.querySelector('.tracker-row-direction').textContent = bearingToCompass(vehicle.bearing) || '—';
      row.setAttribute('aria-pressed',String(vehicle.id === state.selectedId));
      row.setAttribute('aria-label',label + ' ' + line + ', vehicle ' + String(vehicle.label || vehicle.id) + ', ' + (bearingToCompass(vehicle.bearing) || 'direction unknown'));
      const reference = previous ? previous.nextSibling : container.firstChild;
      if (reference !== row) container.insertBefore(row,reference);
      previous = row;
    }
    el('tracker-more').hidden = state.vehicles.length <= listLimit;
    if (!el('tracker-more').hidden) text('tracker-more','Show more · ' + (state.vehicles.length - listLimit) + ' remaining');
  }
  function renderDetail(state) {
    const v = state.selected, hasVehicle = Boolean(v);
    ['tracker-detail-facts','tracker-detail-actions','tracker-projection-label'].forEach(id => { el(id).hidden = !hasVehicle; });
    el('tracker-detail-badge').hidden = !hasVehicle;
    el('tracker-projection-note').hidden = !hasVehicle || !state.projectionOn;
    if (!v) {
      text('tracker-detail-title','Vehicle preview');
      text('tracker-detail-summary',state.selectedId ? 'This vehicle is outside your filters, has left the feed, or is stale. Reset filters or select another vehicle.' : 'Select a vehicle in the list or on the map to see its direction, freshness, and nearest mapped stop.');
      return;
    }
    const info = tracker.info(v), motion = tracker.motion(v), projection = tracker.projection(v), nearest = nearestStop(v,info.line);
    text('tracker-detail-title',(labels[info.type] || 'Vehicle') + (info.line ? ' ' + info.line : ' · unidentified line'));
    text('tracker-detail-badge',state.followId === v.id ? 'Following' : state.paused ? 'Paused' : 'Live');
    text('tracker-detail-summary','Vehicle ' + String(v.label || v.id) + ' · ' + v.lat.toFixed(5) + ', ' + v.lng.toFixed(5));
    text('tracker-direction',bearingToCompass(v.bearing) ? bearingToCompass(v.bearing) : motion ? '~' + bearingToCompass(motion.bearing) : 'Unavailable');
    text('tracker-movement',motion ? '~' + Math.round(motion.speed * 3.6) + ' km/h' : 'Waiting for samples');
    text('tracker-position-age',v.timestamp !== null ? 'Reported ' + ageText(Date.now() - v.timestamp) : 'Received ' + ageText(state.age || 0) + ' · source time unavailable');
    text('tracker-nearest-stop',nearest ? nearest.name + ' · ' + metricDistance(nearest.meters) + ' direct' : 'Unavailable');
    el('tracker-nearby-departures').hidden = !nearest || !window.lampskeneDepartures;
    text('tracker-follow',state.followId === v.id ? 'Unfollow' : 'Follow');
    setPressed('tracker-follow',state.followId === v.id);
    el('tracker-follow').disabled = state.paused;
    el('tracker-projection').checked = state.projectionOn;
    el('tracker-projection').disabled = (!projection || state.paused) && !state.projectionOn;
    if (state.projectionOn) text('tracker-projection-note',projection && !state.paused ? '20s straight-line estimate, max 600 m. Circle = uncertainty.' : 'Waiting for recent movement samples.');
  }
  function render() {
    const state = tracker.state();
    setPressed('tracker-all',state.allEnabled); setPressed('tracker-lines',state.linesEnabled);
    const summary = !state.enabled ? 'Off' : state.paused ? 'Paused' : state.error ? 'Retrying' : state.loading && !state.receivedAt ? 'Connecting' : state.vehicles.length + ' visible';
    text('tracker-summary-status',summary);
    el('tracker-summary-status').classList.toggle('is-live',state.enabled && !state.paused && !state.error && state.age !== null && state.age <= 120000);
    let feed = 'Tracking is off';
    if (state.enabled) feed = state.paused ? 'Paused' : state.loading ? 'Refreshing…' : state.age === null ? 'Connecting…' : state.age > 120000 ? 'Feed stale' : 'Updated ' + ageText(state.age);
    // Updating seconds is useful visually; announce only actual feed state changes.
    const announcementState = [state.enabled,state.paused,state.loading,Boolean(state.error),state.age !== null && state.age > 120000].join('|');
    el('tracker-feed-status').setAttribute('aria-live',announcementState === previousFeedState ? 'off' : 'polite'); previousFeedState = announcementState;
    text('tracker-feed-status',feed);
    el('tracker-feed-error').hidden = !state.error || !state.enabled; text('tracker-feed-error',state.error);
    el('tracker-refresh').disabled = !state.enabled || state.loading;
    el('tracker-pause').disabled = !state.enabled;
    text('tracker-pause',state.paused ? 'Resume' : 'Pause');
    text('tracker-refresh',state.paused ? 'Reconnect' : 'Refresh');
    if (document.activeElement !== el('tracker-query')) el('tracker-query').value = state.filters.query;
    el('tracker-type').value = state.filters.type; el('tracker-in-view').checked = state.filters.inView;
    text('tracker-results-count',state.vehicles.length + ' visible' + (state.total ? ' / ' + state.total + ' in feed' : ''));
    el('tracker-empty').hidden = state.vehicles.length > 0;
    let empty = 'Choose All vehicles or Displayed lines.';
    if (state.enabled) {
      const filtered = state.filters.query || state.filters.type !== 'all' || state.filters.inView;
      empty = state.loading && !state.receivedAt ? 'Connecting…' : state.age !== null && state.age > 120000 ? 'No fresh positions. Refresh to reconnect.' : filtered ? 'No matches. Reset filters or move the map.' : state.linesEnabled && !state.allEnabled ? 'Add routes in Routes, or choose All vehicles.' : 'No vehicles reported.';
    }
    text('tracker-empty',empty);
    renderRows(state); renderDetail(state);
    if (state.selectedId && state.selectedId !== lastSelection) section.open = true;
    lastSelection = state.selectedId;
  }
  el('tracker-all').addEventListener('click',tracker.toggleAll);
  el('tracker-lines').addEventListener('click',tracker.toggleLines);
  el('tracker-refresh').addEventListener('click',tracker.refresh);
  el('tracker-pause').addEventListener('click',() => tracker.pause(!tracker.state().paused));
  el('tracker-query').addEventListener('input',event => { listLimit = 40; tracker.filters({ query:event.target.value }); });
  el('tracker-type').addEventListener('change',event => { listLimit = 40; tracker.filters({ type:event.target.value }); });
  el('tracker-in-view').addEventListener('change',event => { listLimit = 40; tracker.filters({ inView:event.target.checked }); });
  el('tracker-reset').addEventListener('click',() => { listLimit = 40; tracker.filters({ query:'', type:'all', inView:false }); });
  el('tracker-more').addEventListener('click',() => { listLimit += 40; render(); });
  el('tracker-center').addEventListener('click',() => { tracker.center(); if (matchMedia('(max-width: 768px)').matches && typeof toggleSlPanel === 'function') toggleSlPanel(false); });
  el('tracker-follow').addEventListener('click',() => {
    if (tracker.state().followId) tracker.stopFollowing();
    else { tracker.follow(); if (matchMedia('(max-width: 768px)').matches && typeof toggleSlPanel === 'function') toggleSlPanel(false); }
  });
  el('tracker-projection').addEventListener('change',event => tracker.showProjection(event.target.checked));
  el('tracker-nearby-departures').addEventListener('click',() => {
    const vehicle = tracker.state().selected, nearby = vehicle && nearestStop(vehicle,tracker.info(vehicle).line);
    if (nearby && window.lampskeneDepartures) { section.open = false; window.lampskeneDepartures.search(nearby.name); }
  });
  window.addEventListener('tracker:update',render);
  section.addEventListener('toggle',() => { if (section.open) render(); });
  render();
})();
