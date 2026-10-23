// Public, keyless SL Transport + SL Deviations. Requests follow official fair-use limits.
// https://www.trafiklab.se/api/our-apis/sl/transport/
// https://www.trafiklab.se/api/other-apis/sl/deviations/
const SL_BOARD_REFRESH_MS = 60000;
const SL_BOARD_STALE_MS = 180000;
const slStockholmFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone:'Europe/Stockholm', year:'numeric', month:'2-digit', day:'2-digit',
  hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'
});
function slStockholmParts(epoch) {
  const fields = {};
  for (const part of slStockholmFormatter.formatToParts(new Date(epoch))) if (part.type !== 'literal') fields[part.type] = Number(part.value);
  return [fields.year,fields.month,fields.day,fields.hour,fields.minute,fields.second];
}
function slLocalDateTime(value) {
  if (typeof value !== 'string') return NaN;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return Date.parse(value);
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/);
  if (!match) return NaN;
  const wanted = match.slice(1).map(v => Number(v || 0));
  const civil = Date.UTC(wanted[0],wanted[1] - 1,wanted[2],wanted[3],wanted[4],wanted[5]);
  const candidates = [];
  // Stockholm has UTC+1 / UTC+2. Reject nonexistent or ambiguous DST times.
  for (const offset of [1,2]) {
    const epoch = civil - offset * 3600000;
    if (slStockholmParts(epoch).every((v,i) => v === wanted[i])) candidates.push(epoch);
  }
  return candidates.length === 1 ? candidates[0] : NaN;
}
function slClock(value) {
  const match = typeof value === 'string' && value.match(/T(\d{2}:\d{2})/);
  return match ? match[1] : '';
}
function slNormalizeDeparture(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const line = raw.line || {}, stop = raw.stop_point || {};
  const scheduledAt = slLocalDateTime(raw.scheduled), expectedAt = slLocalDateTime(raw.expected);
  const notices = Array.isArray(raw.deviations) ? raw.deviations : [];
  const cancelled = raw.state === 'CANCELLED' || notices.some(d => d && d.consequence === 'CANCELLED');
  const delay = Number.isFinite(scheduledAt) && Number.isFinite(expectedAt) ? Math.round((expectedAt - scheduledAt) / 60000) : null;
  return {
    key:[raw.journey && raw.journey.id || '',line.id || line.designation || '',raw.scheduled || '',stop.id || stop.designation || '',raw.destination || raw.direction || ''].join('|'),
    line:String(line.designation ?? line.id ?? '—').slice(0,30), mode:String(line.transport_mode || '').toUpperCase(),
    destination:String(raw.destination || raw.direction || 'Destination unavailable').slice(0,180),
    platform:String(stop.designation || '').slice(0,40), stopName:String(stop.name || '').slice(0,180),
    display:String(raw.display || '').slice(0,80), state:String(raw.state || ''), cancelled,
    scheduledAt, expectedAt, scheduledClock:slClock(raw.scheduled), expectedClock:slClock(raw.expected),
    delay, deviations:notices.map(d => String(d && d.message || '').slice(0,500)).filter(Boolean)
  };
}
function slDepartureDue(departure, now) {
  if (departure.cancelled) return 'Cancelled';
  if (Number.isFinite(departure.expectedAt)) {
    const minutes = Math.ceil((departure.expectedAt - now) / 60000);
    if (minutes <= 0) return departure.state === 'ATSTOP' || minutes >= -1 ? 'Due now' : 'Expected earlier';
    return minutes < 60 ? minutes + ' min' : departure.expectedClock;
  }
  if (departure.display) return 'SL: ' + departure.display;
  return departure.scheduledClock ? 'Scheduled ' + departure.scheduledClock : 'Time unavailable';
}
function slNormalizeSites(data, now) {
  if (!Array.isArray(data)) throw new Error('Invalid station response');
  const result = [], seen = new Set();
  for (const raw of data) {
    if (!raw || !/^\d{1,7}$/.test(String(raw.id)) || !raw.name || seen.has(String(raw.id))) continue;
    const until = raw.valid && slLocalDateTime(raw.valid.upto), from = raw.valid && slLocalDateTime(raw.valid.from);
    if (Number.isFinite(until) && until < now || Number.isFinite(from) && from > now) continue;
    result.push({ id:String(raw.id), name:String(raw.name).slice(0,180), note:String(raw.note || '').slice(0,120), lat:Number(raw.lat), lng:Number(raw.lon ?? raw.lng) });
    seen.add(String(raw.id));
  }
  return result;
}
function slNormalizeAlerts(data) {
  if (!Array.isArray(data)) throw new Error('Invalid disruption response');
  const result = [];
  for (const raw of data) {
    if (!raw || !Array.isArray(raw.message_variants)) continue;
    const variant = raw.message_variants.find(v => v.language === 'en') || raw.message_variants.find(v => v.language === 'sv') || raw.message_variants[0];
    if (!variant || !variant.header) continue;
    result.push({ id:String(raw.deviation_case_id || result.length), header:String(variant.header).slice(0,240), details:String(variant.details || '').slice(0,1600), scope:String(variant.scope_alias || '').slice(0,160), importance:Number(raw.priority && raw.priority.importance_level) || 0 });
  }
  return result.sort((a,b) => b.importance - a.importance);
}

(function () {
  'use strict';
  const panel = document.getElementById('sl-panel');
  if (!panel || document.getElementById('sl-departure-board')) return;
  const board = document.createElement('details'); board.id = 'sl-departure-board'; board.className = 'departure-board';
  board.innerHTML = `
    <summary><span>Departure board</span><span id="departure-summary" class="departure-badge">Choose station</span></summary>
    <div class="departure-body">
      <p class="departure-help">Check SL’s expected departures, platforms, cancellations, and disruptions before choosing your next move.</p>
      <label class="departure-search-label">Stop<input type="search" id="departure-station-search" placeholder="Station or stop" autocomplete="off" maxlength="100"></label>
      <p id="departure-site-status" class="departure-note" role="status">Station list loads when this board opens.</p>
      <div id="departure-site-results" class="departure-site-results" aria-label="Matching stations"></div>
      <button type="button" id="departure-site-retry" hidden>Retry station list</button>
      <div id="departure-selected" class="departure-selected" hidden><span><strong id="departure-station-title"></strong><small id="departure-station-note"></small></span><button type="button" id="departure-station-map" aria-label="Show selected stop on map">Map</button></div>
      <div id="departure-toolbar" class="departure-toolbar" hidden><label>Service<select id="departure-mode"><option value="all">All services</option><option value="BUS">Bus</option><option value="METRO">Metro</option><option value="TRAIN">Train</option><option value="TRAM">Tram</option><option value="FERRY">Ferry</option></select></label><button type="button" id="departure-refresh">Refresh</button></div>
      <p id="departure-status" class="departure-note" role="status" aria-live="polite">Select a station to load departures.</p>
      <p id="departure-error" class="departure-error" hidden></p>
      <div id="departure-list" class="departure-list" aria-label="Upcoming departures"></div>
      <div id="departure-disruptions" class="departure-disruptions" hidden><div class="departure-alert-heading">Station disruptions <span id="departure-alert-count"></span></div><p id="departure-alert-status" class="departure-note"></p><div id="departure-alert-list"></div></div>
      <p class="departure-footnote">Stockholm time · SL estimates · updates every minute</p>
      <a class="departure-source" href="https://www.trafiklab.se/api/our-apis/sl/transport/" target="_blank" rel="noopener">Live data: SL via Trafiklab</a>
    </div>`;
  const tracker = document.getElementById('sl-tracker-section');
  tracker ? tracker.after(board) : panel.querySelector('.sl-header').after(board);
  const el = id => document.getElementById(id);
  let sites = [], sitesPromise = null, selected = null, departures = [], alerts = [];
  let receivedAt = 0, alertsAt = 0, lastAttempt = 0, loading = false, error = '', alertsError = '';
  let refreshTimer = null, ageTimer = null, request = null, generation = 0, siteMarker = null, signature = '';
  const departureRows = new Map(), alertRows = new Map();
  let departureEmpty = null;
  const siteCacheKey = 'lampskene_sl_sites_v1', selectedKey = 'lampskene_sl_board_site_v1';
  const modeLabels = { BUS:'Bus', METRO:'Metro', TRAIN:'Train', TRAM:'Tram', SHIP:'Ferry', FERRY:'Ferry', TAXI:'Taxi' };
  function text(id,value) { const target = el(id); if (target.textContent !== value) target.textContent = value; }
  function age(value) { const seconds = Math.max(0,Math.floor((Date.now() - value) / 1000)); return seconds < 60 ? seconds + 's ago' : Math.floor(seconds / 60) + 'm ago'; }
  function actionable() { return board.open && panel.classList.contains('open') && !document.hidden; }
  function remaining() { return Math.max(0,SL_BOARD_REFRESH_MS - (Date.now() - lastAttempt)); }
  function stopTimers() { clearTimeout(refreshTimer); refreshTimer = null; clearInterval(ageTimer); ageTimer = null; }
  function abortRequest() { generation++; if (request) request.abort(); request = null; loading = false; }
  async function getJson(url,signal) {
    const response = await fetch(url,{ signal, mode:'cors', credentials:'omit', headers:{ Accept:'application/json' } });
    if (!response.ok) throw new Error(response.status === 429 ? 'SL is limiting requests. Try again after one minute.' : 'SL feed unavailable (HTTP ' + response.status + ').');
    const ageHeader = response.headers && response.headers.get('age');
    const responseAge = Math.max(0,Number(ageHeader) || 0) * 1000;
    return { data:await response.json(), at:Date.now() - responseAge };
  }
  function renderStationSearch() {
    const query = el('departure-station-search').value.trim().toLocaleLowerCase('sv');
    const results = el('departure-site-results'); results.replaceChildren();
    if (query.length < 2) { text('departure-site-status',sites.length ? 'Enter 2+ letters.' : sitesPromise ? 'Loading stops…' : 'Stops unavailable. Retry.'); return; }
    const matches = sites.filter(site => (site.name + ' ' + site.note).toLocaleLowerCase('sv').includes(query)).sort((a,b) => Number(!a.name.toLocaleLowerCase('sv').startsWith(query)) - Number(!b.name.toLocaleLowerCase('sv').startsWith(query)) || a.name.localeCompare(b.name,'sv'));
    text('departure-site-status',matches.length ? matches.length + ' stops' + (matches.length > 12 ? ' · first 12 shown' : '') : sites.length ? 'No matching stop.' : 'Loading stops…');
    for (const site of matches.slice(0,12)) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'departure-site-result';
      const name = document.createElement('strong'), note = document.createElement('span'); name.textContent = site.name; note.textContent = site.note || 'SL station ' + site.id;
      button.append(name,note); button.addEventListener('click',() => selectSite(site)); results.appendChild(button);
    }
  }
  function loadSites(force) {
    if (sitesPromise) return sitesPromise;
    if (sites.length && !force) { renderStationSearch(); return Promise.resolve(sites); }
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(),15000);
    el('departure-site-retry').hidden = true; text('departure-site-status','Loading SL station list…');
    sitesPromise = getJson('https://transport.integration.sl.se/v1/sites?expand=true',controller.signal)
      .then(response => {
        sites = slNormalizeSites(response.data,Date.now());
        try { localStorage.setItem(siteCacheKey,JSON.stringify({ at:Date.now(), sites })); } catch (_) {}
        if (!selected) {
          try { const saved = localStorage.getItem(selectedKey), site = sites.find(s => s.id === saved); if (site) selectSite(site); } catch (_) {}
        }
        return sites;
      }).catch(err => {
        text('departure-site-status',err.name === 'AbortError' ? 'Station list timed out. Retry to reconnect.' : 'Station list unavailable. SL may be busy or unreachable.');
        el('departure-site-retry').hidden = false;
        return sites;
      }).finally(() => { clearTimeout(timeout); sitesPromise = null; if (sites.length) renderStationSearch(); });
    return sitesPromise;
  }
  function selectSite(site) {
    if (selected && selected.id === site.id) { render(); refresh(); return; }
    abortRequest(); clearTimeout(refreshTimer); refreshTimer = null;
    if (siteMarker && typeof map !== 'undefined' && map) map.removeLayer(siteMarker); siteMarker = null;
    selected = site; departures = []; alerts = []; receivedAt = 0; alertsAt = 0; error = ''; alertsError = ''; signature = '';
    el('departure-site-results').replaceChildren(); el('departure-station-search').value = site.name;
    text('departure-site-status','');
    try { localStorage.setItem(selectedKey,site.id); } catch (_) {}
    render(); refresh();
  }
  function renderDepartures() {
    const now = Date.now(), stale = !receivedAt || now - receivedAt > SL_BOARD_STALE_MS, mode = el('departure-mode').value;
    const list = el('departure-list');
    const visible = stale ? [] : departures.filter(d => (mode === 'all' || d.mode === mode || mode === 'FERRY' && d.mode === 'SHIP') && d.state !== 'DEPARTED' && (!Number.isFinite(d.expectedAt) || d.expectedAt > now - 120000)).sort((a,b) => (a.expectedAt || a.scheduledAt || Infinity) - (b.expectedAt || b.scheduledAt || Infinity)).slice(0,24);
    const nextSignature = [receivedAt,mode,stale,Math.floor(now / 60000),visible.map(d => d.line + d.destination + d.expectedClock + d.cancelled).join('|')].join('~');
    if (signature === nextSignature) return; signature = nextSignature;
    const seen = new Set(visible.map(d => d.key));
    for (const [key,parts] of departureRows) if (!seen.has(key)) { parts.row.remove(); departureRows.delete(key); }
    if (departureEmpty) { departureEmpty.remove(); departureEmpty = null; }
    let previous = null;
    for (const d of visible) {
      let parts = departureRows.get(d.key);
      if (!parts) {
        const row = document.createElement('details'), summary = document.createElement('summary');
        const badge = document.createElement('span'); badge.className = 'departure-line';
        const meta = document.createElement('span'); meta.className = 'departure-row-meta';
        const destination = document.createElement('strong'), sub = document.createElement('span'); meta.append(destination,sub);
        const due = document.createElement('span'); due.className = 'departure-due'; summary.append(badge,meta,due); row.append(summary);
        const detail = document.createElement('div'); detail.className = 'departure-row-detail';
        const times = document.createElement('p'), notices = document.createElement('div'); detail.append(times,notices); row.append(detail);
        parts = { row,badge,destination,sub,due,times,notices,noticeSignature:'' }; departureRows.set(d.key,parts);
      }
      parts.row.className = 'departure-row' + (d.cancelled ? ' is-cancelled' : '');
      parts.badge.textContent = d.line; parts.destination.textContent = d.destination;
      parts.sub.textContent = (modeLabels[d.mode] || 'Service') + (d.platform ? ' · platform ' + d.platform : '') + (d.delay > 0 && !d.cancelled ? ' · +' + d.delay + ' min' : '');
      parts.due.textContent = slDepartureDue(d,now);
      parts.times.textContent = 'Scheduled ' + (d.scheduledClock || 'unavailable') + ' · SL expected ' + (d.expectedClock || 'unavailable') + (d.platform ? ' · platform ' + d.platform : '');
      const noticeSignature = [d.cancelled,...d.deviations].join('|');
      if (parts.noticeSignature !== noticeSignature) {
        parts.noticeSignature = noticeSignature; parts.notices.replaceChildren();
        for (const message of d.deviations) { const p = document.createElement('p'); p.className = 'departure-deviation'; p.textContent = message; parts.notices.append(p); }
        if (!d.deviations.length && d.cancelled) { const p = document.createElement('p'); p.textContent = 'Cancelled by SL.'; parts.notices.append(p); }
      }
      const reference = previous ? previous.nextSibling : list.firstChild;
      if (reference !== parts.row) list.insertBefore(parts.row,reference);
      previous = parts.row;
    }
    if (selected && !loading && !stale && !visible.length) {
      departureEmpty = document.createElement('p'); departureEmpty.className = 'departure-empty'; departureEmpty.textContent = mode !== 'all' ? 'No departures for this service.' : 'No upcoming departures.'; list.append(departureEmpty);
    }
  }
  function renderAlerts() {
    const list = el('departure-alert-list'), stale = !alertsAt || Date.now() - alertsAt > SL_BOARD_STALE_MS;
    const id = [alertsAt,stale,alertsError].join('|');
    if (list.dataset.version === id) return; list.dataset.version = id;
    const visible = stale ? [] : alerts.slice(0,8), seen = new Set(visible.map(alert => alert.id));
    for (const [key,parts] of alertRows) if (!seen.has(key)) { parts.detail.remove(); alertRows.delete(key); }
    text('departure-alert-count',!stale && alerts.length ? String(alerts.length) : '');
    text('departure-alert-status',alertsError || (stale ? 'Loading disruptions…' : alerts.length ? 'Updated ' + age(alertsAt) : 'No disruptions reported.'));
    if (stale) return;
    let previous = null;
    for (const alert of visible) {
      let parts = alertRows.get(alert.id);
      if (!parts) {
        const detail = document.createElement('details'); detail.className = 'departure-alert';
        const summary = document.createElement('summary'), scope = document.createElement('p'), body = document.createElement('p');
        detail.append(summary,scope,body); parts = { detail,summary,scope,body }; alertRows.set(alert.id,parts);
      }
      parts.summary.textContent = alert.header; parts.scope.textContent = alert.scope; parts.body.textContent = alert.details;
      const reference = previous ? previous.nextSibling : list.firstChild;
      if (reference !== parts.detail) list.insertBefore(parts.detail,reference);
      previous = parts.detail;
    }
  }
  function render() {
    const stale = receivedAt && Date.now() - receivedAt > SL_BOARD_STALE_MS;
    text('departure-summary',selected ? selected.name : 'Choose station');
    ['departure-selected','departure-toolbar','departure-disruptions'].forEach(id => { el(id).hidden = !selected; });
    if (selected) { text('departure-station-title',selected.name); text('departure-station-note',selected.note || ''); }
    el('departure-station-map').disabled = !selected || !Number.isFinite(selected.lat) || !Number.isFinite(selected.lng) || typeof map === 'undefined' || !map;
    el('departure-refresh').disabled = loading || remaining() > 0;
    el('departure-refresh').title = remaining() > 0 ? 'Next refresh in ' + Math.ceil(remaining() / 1000) + ' seconds' : 'Refresh this station';
    text('departure-refresh',loading ? 'Refreshing…' : remaining() > 0 ? 'Refresh ' + Math.ceil(remaining() / 1000) + 's' : 'Refresh');
    const status = !selected ? '' : loading ? 'Loading departures…' : stale ? 'Feed stale · estimates hidden' : receivedAt ? 'Updated ' + age(receivedAt) : remaining() > 0 ? 'Update in ' + Math.ceil(remaining() / 1000) + 's' : 'Waiting for departures…';
    text('departure-status',status); el('departure-error').hidden = !error; text('departure-error',error);
    renderDepartures(); renderAlerts();
  }
  function schedule() {
    clearTimeout(refreshTimer); refreshTimer = null;
    if (selected && actionable()) refreshTimer = setTimeout(refresh,Math.max(1000,remaining()));
  }
  async function refresh() {
    if (!selected || !actionable() || loading) return;
    if (remaining() > 0) { render(); schedule(); return; }
    const siteId = selected.id, requestId = ++generation;
    loading = true; lastAttempt = Date.now(); request = new AbortController(); const controller = request;
    const timeout = setTimeout(() => controller.abort(),15000); render();
    const results = await Promise.allSettled([
      getJson('https://transport.integration.sl.se/v1/sites/' + encodeURIComponent(siteId) + '/departures',controller.signal),
      getJson('https://deviations.integration.sl.se/v1/messages?site=' + encodeURIComponent(siteId),controller.signal)
    ]);
    clearTimeout(timeout);
    if (requestId !== generation || !selected || selected.id !== siteId) return;
    request = null; loading = false;
    const [departureResult,alertResult] = results;
    if (departureResult.status === 'fulfilled') {
      try {
        if (!Array.isArray(departureResult.value.data.departures)) throw new Error('Invalid departure response');
        departures = departureResult.value.data.departures.map(slNormalizeDeparture).filter(Boolean);
        receivedAt = departureResult.value.at; error = '';
      } catch (_) { error = 'SL returned an unreadable departure board. Try again after one minute.'; }
    } else error = departureResult.reason.name === 'AbortError' ? 'SL request timed out. Retrying after one minute.' : String(departureResult.reason.message || 'Live departures unavailable.');
    if (alertResult.status === 'fulfilled') {
      try { alerts = slNormalizeAlerts(alertResult.value.data); alertsAt = alertResult.value.at; alertsError = ''; }
      catch (_) { alertsError = 'SL disruption response could not be read.'; }
    } else alertsError = 'Disruption feed unavailable. Departure notices may still appear above.';
    signature = ''; render(); schedule();
  }
  function syncActive() {
    if (!actionable()) { stopTimers(); abortRequest(); return; }
    if (!ageTimer) ageTimer = setInterval(render,1000);
    loadSites(); render(); if (selected) refresh();
  }
  try {
    const cache = JSON.parse(localStorage.getItem(siteCacheKey) || 'null');
    if (cache && Date.now() - cache.at < 86400000 && Array.isArray(cache.sites)) {
      sites = slNormalizeSites(cache.sites,Date.now());
      const saved = localStorage.getItem(selectedKey); selected = sites.find(s => s.id === saved) || null;
      if (selected) el('departure-station-search').value = selected.name;
    }
  } catch (_) {}
  el('departure-station-search').addEventListener('input',() => { renderStationSearch(); if (!sites.length) loadSites(); });
  el('departure-site-retry').addEventListener('click',() => loadSites(true));
  el('departure-refresh').addEventListener('click',refresh);
  el('departure-mode').addEventListener('change',() => { signature = ''; render(); });
  el('departure-station-map').addEventListener('click',() => {
    if (!selected || typeof map === 'undefined' || !map || !Number.isFinite(selected.lat) || !Number.isFinite(selected.lng)) return;
    if (siteMarker) map.removeLayer(siteMarker);
    const tooltip = document.createElement('span'); tooltip.textContent = selected.name;
    siteMarker = L.circleMarker([selected.lat,selected.lng],{ radius:8, color:'#55ddaa', fillColor:'#55ddaa', fillOpacity:.3, weight:2 }).bindTooltip(tooltip,{ direction:'top', className:'train-tip' }).addTo(map);
    map.setView([selected.lat,selected.lng],Math.max(map.getZoom(),15),{ animate:false });
    if (matchMedia('(max-width: 768px)').matches && typeof toggleSlPanel === 'function') toggleSlPanel(false);
  });
  board.addEventListener('toggle',syncActive); document.addEventListener('visibilitychange',syncActive);
  new MutationObserver(syncActive).observe(panel,{ attributes:true, attributeFilter:['class'] });
  window.lampskeneDepartures = {
    open:() => { if (typeof toggleSlPanel === 'function') toggleSlPanel(true); board.open = true; syncActive(); },
    search:name => { if (typeof toggleSlPanel === 'function') toggleSlPanel(true); board.open = true; el('departure-station-search').value = String(name || ''); loadSites().then(renderStationSearch); syncActive(); },
    refresh, state:() => ({ selected, loading, receivedAt, alertsAt, error, alertsError, departures:receivedAt && Date.now() - receivedAt <= SL_BOARD_STALE_MS ? departures : [], alerts:alertsAt && Date.now() - alertsAt <= SL_BOARD_STALE_MS ? alerts : [] })
  };
  render();
})();
