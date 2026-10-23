// Live SL vehicles. Both legacy switches share one feed and measured positions.
let trainsEnabled = false;
let trainMarkers = Object.create(null);
let trainInterval = null;
let countdownInterval = null;
let countdownSecs = 0;
let _markerSize = 5;
const REFRESH_SECS = 15;
const VEHICLE_STALE_MS = 120000;
const VEHICLE_MOTION_MAX_AGE_MS = 45000;
let _routeMap = null;
let _tripMap = null;
let _lastVehicles = null;
let _staticPromise = null;
let _tripPromise = null;
let _vehicleRequest = null;
let _vehicleRequestNumber = 0;
let _vehicleReceivedAt = 0;
let _vehicleError = '';
let _vehiclePaused = false;
let _vehicleSelectedId = '';
let _vehicleFollowId = '';
let _vehicleProjectionOn = false;
let _vehicleProjectionLayers = [];
let _vehicleBoundMap = null;
let _vehicleNextRefreshAt = 0;
const _vehicleObservations = new Map();
const _vehicleFilters = { query:'', type:'all', inView:false };

function csvSplitLine(line) {
  const cols = []; let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && quoted && line[i + 1] === '"') { cur += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) { cols.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  cols.push(cur.trim()); return cols;
}
function parseRoutesCsv(csv) {
  const rows = csv.split(/\r?\n/), hdr = csvSplitLine(rows[0].replace(/^\uFEFF/, ''));
  const id = hdr.indexOf('route_id'), name = hdr.indexOf('route_short_name');
  const col = hdr.indexOf('route_color'), type = hdr.indexOf('route_type');
  const result = Object.create(null);
  if (id < 0 || name < 0) return result;
  for (const row of rows.slice(1)) {
    const c = csvSplitLine(row);
    if (c[id] && c[name]) result[c[id]] = { line:c[name], color:c[col] || '', type:vehicleGtfsType(c[type]) };
  }
  return result;
}
function parseTripsCsv(csv) {
  const rows = csv.split(/\r?\n/), hdr = csvSplitLine(rows[0].replace(/^\uFEFF/, ''));
  const trip = hdr.indexOf('trip_id'), route = hdr.indexOf('route_id');
  const result = Object.create(null);
  if (trip < 0 || route < 0) return result;
  for (const row of rows.slice(1)) { const c = csvSplitLine(row); if (c[trip] && c[route]) result[c[trip]] = c[route]; }
  return result;
}
function vehicleGtfsType(value) {
  if (value === undefined || value === null || value === '') return 'unknown';
  const n = Number(value);
  if (n === 0 || (n >= 900 && n < 1000)) return 'tram';
  if (n === 1 || (n >= 400 && n < 500)) return 'subway';
  if (n === 2 || (n >= 100 && n < 200)) return 'train';
  if (n === 3 || (n >= 700 && n < 800)) return 'bus';
  if (n === 4 || (n >= 1000 && n < 1100)) return 'ferry';
  return 'unknown';
}
function loadStaticData() {
  if (_staticPromise) return _staticPromise;
  _staticPromise = fetch('routes.txt', { cache:'force-cache' })
    .then(r => { if (!r.ok) throw new Error('routes.txt HTTP ' + r.status); return r.text(); })
    .then(csv => { _routeMap = parseRoutesCsv(csv); loadTripsInBackground(); refreshVehiclePresentation(); })
    .catch(err => { console.warn('Route metadata unavailable:', err.message); _routeMap = Object.create(null); _staticPromise = null; });
  return _staticPromise;
}
function loadTripsInBackground() {
  if (_tripPromise) return _tripPromise;
  _tripPromise = fetch('trips.txt', { cache:'force-cache' })
    .then(r => { if (!r.ok) throw new Error('trips.txt HTTP ' + r.status); return r.text(); })
    .then(csv => { _tripMap = parseTripsCsv(csv); refreshVehiclePresentation(); })
    .catch(err => { console.warn('Trip metadata unavailable:', err.message); _tripMap = Object.create(null); _tripPromise = null; });
  return _tripPromise;
}
function resolveVehicle(v) {
  let routeId = String(v.routeId || '');
  if (_routeMap && _routeMap[routeId]) return _routeMap[routeId];
  if (v.tripId && _tripMap && _tripMap[v.tripId]) {
    const tripRoute = _tripMap[v.tripId];
    if (_routeMap && _routeMap[tripRoute]) return _routeMap[tripRoute];
    if (!routeId) routeId = tripRoute;
  }
  const match = routeId.match(/9011001(\d{4})/);
  const line = match && Number(match[1]) > 0 ? String(Number(match[1])) : '';
  const catalog = typeof _slRoutes !== 'undefined' ? _slRoutes[line] : null;
  return { line, color:'', type:catalog ? catalog.type : 'unknown' };
}
function vehicleTransportLabel(type) {
  return ({ bus:'Bus', subway:'Metro', train:'Train', tram:'Tram', light_rail:'Light rail', ferry:'Ferry', unknown:'Vehicle' })[type] || 'Vehicle';
}
function vehicleColor(line) {
  const n = Number(line);
  if (n === 10 || n === 11) return '#0070c0';
  if (n === 13 || n === 14) return '#d71920';
  if (n >= 17 && n <= 19) return '#19a045';
  if (n >= 35 && n <= 48) return '#e83192';
  if (n === 25 || n === 26) return '#00aaad';
  if (n === 27 || n === 28 || n === 29) return '#a05ea6';
  if (n === 12 || n === 21 || n === 22 || n === 30 || n === 31) return '#d77d00';
  if (n === 7) return '#878a83';
  return '#0070c0';
}
function bearingToCompass(b) {
  if (!Number.isFinite(Number(b)) || Number(b) < 0) return '';
  return ['N','NE','E','SE','S','SW','W','NW'][Math.round(Number(b) / 45) % 8];
}
function arrowIcon(color, bearing, selected) {
  const rotation = Number.isFinite(bearing) && bearing >= 0 ? bearing : 0;
  const s = _markerSize * 3 + (selected ? 6 : 0);
  const fill = /^#[\da-f]{3,8}$/i.test(color) ? color : '#0070c0';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + s + '" height="' + s + '" viewBox="0 0 20 20">'
    + (selected ? '<circle cx="10" cy="10" r="9" fill="none" stroke="' + fill + '" stroke-width="1.5"/>' : '')
    + (bearing >= 0 ? '<g transform="rotate(' + rotation + ' 10 10)"><polygon points="10,3 14,16 10,13 6,16" fill="' + fill + '" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/></g>' : '<circle cx="10" cy="10" r="5" fill="' + fill + '" stroke="#fff" stroke-width="1.5"/>')
    + '</svg>';
  return L.divIcon({ html:svg, className:'tracker-vehicle-icon', iconSize:[s,s], iconAnchor:[s / 2,s / 2] });
}
function vehicleNumber(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return NaN;
  return Number(value);
}
function vehicleTimestamp(v, now) {
  const raw = v.timestamp ?? v.positionTimestamp ?? v.updatedAt;
  if (raw === undefined || raw === null || raw === '') return null;
  let value = Number(raw);
  if (!Number.isFinite(value)) value = Date.parse(raw);
  else if (value < 1e12) value *= 1000;
  return Number.isFinite(value) && value > 0 && value <= now + 120000 ? value : null;
}
function normalizeVehicleFeed(data, now) {
  if (!Array.isArray(data)) throw new Error((data && data.error) || 'Invalid vehicle response');
  const result = [], ids = new Set();
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') continue;
    const lat = vehicleNumber(raw.lat), lng = vehicleNumber(raw.lng ?? raw.lon);
    const id = String(raw.id ?? raw.vehicleId ?? '').slice(0,160);
    if (!id || ids.has(id) || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) continue;
    const timestamp = vehicleTimestamp(raw, now);
    if (timestamp !== null && now - timestamp > VEHICLE_STALE_MS) continue;
    const bearing = vehicleNumber(raw.bearing);
    result.push(Object.assign({}, raw, { id, lat, lng, bearing:Number.isFinite(bearing) && bearing >= 0 ? bearing % 360 : -1, timestamp, receivedAt:now }));
    ids.add(id);
  }
  return result;
}
function vehicleDistance(a, b) {
  const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0,1 - h)));
}
function vehicleBearing(a, b) {
  const rad = Math.PI / 180, p1 = a.lat * rad, p2 = b.lat * rad, d = (b.lng - a.lng) * rad;
  return (Math.atan2(Math.sin(d) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(d)) / rad + 360) % 360;
}
function recordVehicleObservations(vehicles, now) {
  const seen = new Set();
  for (const v of vehicles) {
    seen.add(v.id);
    const old = _vehicleObservations.get(v.id), at = v.timestamp ?? now;
    if (old && at <= old.at) {
      // A reused timestamp with changed coordinates is not a valid motion sample.
      if (at === old.at && vehicleDistance(old.vehicle,v) >= 5) _vehicleObservations.set(v.id,{ vehicle:v, at, motion:null });
      continue;
    }
    let motion = null;
    if (old) {
      const seconds = (at - old.at) / 1000, meters = vehicleDistance(old.vehicle,v);
      const maxSpeed = ['train','subway'].includes(resolveVehicle(v).type) ? 60 : 40;
      if (seconds >= 5 && seconds <= 60 && meters >= 5 && meters / seconds <= maxSpeed) {
        motion = { speed:meters / seconds, bearing:vehicleBearing(old.vehicle,v), seconds, meters, at };
      }
    }
    _vehicleObservations.set(v.id, { vehicle:v, at, motion });
  }
  for (const [id, sample] of _vehicleObservations) if (!seen.has(id) || now - sample.at > VEHICLE_STALE_MS) _vehicleObservations.delete(id);
}
function keepLatestVehiclePositions(vehicles, now) {
  return vehicles.map(v => {
    const old = _vehicleObservations.get(v.id);
    if (old && v.timestamp !== null && old.vehicle.timestamp !== null && v.timestamp < old.vehicle.timestamp && now - old.at <= VEHICLE_STALE_MS) {
      return Object.assign({},old.vehicle,{ receivedAt:now });
    }
    return v;
  });
}
function vehicleMotion(v, now) {
  const sample = _vehicleObservations.get(v.id);
  return sample && sample.motion && now - sample.motion.at <= VEHICLE_MOTION_MAX_AGE_MS ? sample.motion : null;
}
function vehicleProjection(v, now) {
  const motion = vehicleMotion(v,now);
  if (!motion) return null;
  const rad = Math.PI / 180, distance = Math.min(600,motion.speed * 20), angular = distance / 6371000;
  const lat = v.lat * rad, lng = v.lng * rad, bearing = motion.bearing * rad;
  const pLat = Math.asin(Math.sin(lat) * Math.cos(angular) + Math.cos(lat) * Math.sin(angular) * Math.cos(bearing));
  const pLng = lng + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat), Math.cos(angular) - Math.sin(lat) * Math.sin(pLat));
  return { lat:pLat / rad, lng:pLng / rad, seconds:20, meters:distance, uncertainty:Math.max(25,distance * 0.35), speed:motion.speed, bearing:motion.bearing };
}
function activeVehicleConsumers() { return trainsEnabled || (typeof _slLineLive !== 'undefined' && _slLineLive); }
function freshVehicleList() {
  if (!_lastVehicles || Date.now() - _vehicleReceivedAt > VEHICLE_STALE_MS) return [];
  return _lastVehicles.filter(v => v.timestamp === null || Date.now() - v.timestamp <= VEHICLE_STALE_MS);
}
function matchesVehicleFilters(v, boundsOverride) {
  const info = resolveVehicle(v), q = _vehicleFilters.query.trim().toLowerCase();
  if (_vehicleFilters.type !== 'all' && info.type !== _vehicleFilters.type) return false;
  if (q && ![info.line,v.id,v.label || '',vehicleTransportLabel(info.type)].join(' ').toLowerCase().includes(q)) return false;
  const bounds = boundsOverride || (map && map.getBounds());
  if (_vehicleFilters.inView && bounds && !bounds.contains([v.lat,v.lng])) return false;
  return true;
}
function displayedVehicleList(boundsOverride) {
  const wanted = typeof routesForSlMap === 'function' ? new Set(routesForSlMap().map(r => String(r.ref))) : new Set();
  return freshVehicleList().filter(v => matchesVehicleFilters(v,boundsOverride) && (trainsEnabled || (typeof _slLineLive !== 'undefined' && _slLineLive && wanted.has(resolveVehicle(v).line))));
}
function vehicleTooltip(v) {
  const info = resolveVehicle(v), dir = bearingToCompass(v.bearing);
  return vehicleTransportLabel(info.type) + (info.line ? ' ' + info.line : ' · ' + String(v.label || v.id).slice(0,20)) + (dir ? ' · ' + dir : '');
}
function renderVehicleLayer(target, vehicles, priority) {
  if (!map) return;
  const seen = new Set();
  for (const v of vehicles) {
    seen.add(v.id);
    const info = resolveVehicle(v), route = typeof _slRoutes !== 'undefined' ? _slRoutes[info.line] : null;
    const color = route ? route._drawColor || route.baseColor || vehicleColor(info.line) : vehicleColor(info.line);
    const icon = arrowIcon(color,v.bearing,v.id === _vehicleSelectedId), tip = vehicleTooltip(v);
    let marker = Object.prototype.hasOwnProperty.call(target,v.id) ? target[v.id] : null;
    if (!marker) {
      marker = L.marker([v.lat,v.lng], { icon, zIndexOffset:priority, keyboard:true, title:tip });
      const tooltip = document.createElement('span'); tooltip.textContent = tip;
      marker.bindTooltip(tooltip, { permanent:false, direction:'top', className:'train-tip' }).addTo(map);
      marker.on('click', () => selectTrackedVehicle(v.id,true));
      Object.defineProperty(target,v.id,{ value:marker, writable:true, configurable:true, enumerable:true });
    } else {
      marker.setLatLng([v.lat,v.lng]); marker.setIcon(icon);
      const tooltip = document.createElement('span'); tooltip.textContent = tip; marker.setTooltipContent(tooltip);
    }
  }
  for (const id of Object.keys(target)) if (!seen.has(id)) { map.removeLayer(target[id]); delete target[id]; }
}
function renderTrainMarkers(vehicles) {
  if (vehicles !== _lastVehicles) _lastVehicles = normalizeVehicleFeed(vehicles,Date.now());
  renderVehicleLayer(trainMarkers,trainsEnabled ? freshVehicleList().filter(v => matchesVehicleFilters(v)) : [],10);
}
function clearAllTrainMarkers() {
  for (const id of Object.keys(trainMarkers)) if (map) map.removeLayer(trainMarkers[id]);
  trainMarkers = Object.create(null); window._trainFirstLoad = false;
}
function clearSlLiveMarkers() {
  for (const id of Object.keys(_slLiveMarkers)) if (map) map.removeLayer(_slLiveMarkers[id]);
  _slLiveMarkers = Object.create(null);
}
function updateSlLineLiveMarkers() {
  _slLastVehicles = _lastVehicles;
  const wanted = new Set(routesForSlMap().map(r => String(r.ref)));
  renderVehicleLayer(_slLiveMarkers,_slLineLive && !trainsEnabled ? freshVehicleList().filter(v => wanted.has(resolveVehicle(v).line) && matchesVehicleFilters(v)) : [],20);
  emitVehicleUpdate();
}
function clearVehicleProjection() {
  for (const layer of _vehicleProjectionLayers) if (map) map.removeLayer(layer);
  _vehicleProjectionLayers = [];
}
function drawVehicleProjection() {
  clearVehicleProjection();
  if (!map || !_vehicleProjectionOn || !activeVehicleConsumers() || _vehiclePaused) return;
  const v = displayedVehicleList().find(v => v.id === _vehicleSelectedId), projection = v && vehicleProjection(v,Date.now());
  if (!projection) return;
  const color = vehicleColor(resolveVehicle(v).line);
  _vehicleProjectionLayers.push(L.polyline([[v.lat,v.lng],[projection.lat,projection.lng]], { color, weight:2, opacity:.75, dashArray:'5 6', interactive:false }).addTo(map));
  _vehicleProjectionLayers.push(L.circle([projection.lat,projection.lng], { color, weight:1, fillOpacity:.08, dashArray:'3 5', radius:projection.uncertainty, interactive:false }).addTo(map));
}
function refreshVehiclePresentation() {
  if (map) { renderTrainMarkers(_lastVehicles || []); updateSlLineLiveMarkers(); drawVehicleProjection(); }
  emitVehicleUpdate();
}
function onMarkerSizeChange(val) {
  _markerSize = Math.max(3,Math.min(12,Number(val) || 5));
  const out = document.getElementById('marker-size-val'); if (out) out.textContent = _markerSize;
  refreshVehiclePresentation();
}
function selectTrackedVehicle(id, openPanel) {
  if (!freshVehicleList().some(v => v.id === id)) return;
  _vehicleSelectedId = id;
  if (_vehicleFollowId && _vehicleFollowId !== id) _vehicleFollowId = '';
  if (openPanel && typeof toggleSlPanel === 'function') toggleSlPanel(true);
  refreshVehiclePresentation();
}
function centerTrackedVehicle(follow) {
  const v = displayedVehicleList().find(v => v.id === _vehicleSelectedId);
  if (!v || !map) return;
  _vehicleFollowId = follow ? v.id : '';
  map.setView([v.lat,v.lng],Math.max(map.getZoom(),14), { animate:false }); emitVehicleUpdate();
}
function bindVehicleMap() {
  if (!map || _vehicleBoundMap === map) return;
  _vehicleBoundMap = map;
  map.on('dragstart', () => { if (_vehicleFollowId) { _vehicleFollowId = ''; emitVehicleUpdate(); } });
  map.on('moveend', () => { if (_vehicleFilters.inView) refreshVehiclePresentation(); });
}
function syncVehicleControls() {
  const btn = document.getElementById('trains-sp-btn'), status = document.getElementById('trains-sp-status'), size = document.getElementById('trains-size-row');
  if (btn) { btn.classList.toggle('sp-active',trainsEnabled); btn.setAttribute('aria-pressed',String(trainsEnabled)); }
  if (status) status.textContent = trainsEnabled ? 'ON' : 'OFF';
  if (size) size.style.display = trainsEnabled ? 'block' : 'none';
  const lineBtn = document.getElementById('sl-live-btn'), lineStatus = document.getElementById('sl-live-status');
  if (lineBtn) { lineBtn.classList.toggle('sp-active',_slLineLive); lineBtn.setAttribute('aria-pressed',String(_slLineLive)); }
  if (lineStatus) lineStatus.textContent = _slLineLive ? 'ON' : 'OFF';
}
function startCountdown() {
  stopCountdown();
  const wrap = document.getElementById('train-countdown'); if (wrap) wrap.style.display = 'flex';
  countdownInterval = setInterval(() => {
    countdownSecs = Math.max(0,Math.ceil((_vehicleNextRefreshAt - Date.now()) / 1000));
    const el = document.getElementById('s-countdown');
    if (el) el.textContent = _vehiclePaused ? 'paused' : _vehicleRequest ? 'syncing' : countdownSecs + 's';
    if (_vehicleReceivedAt && Date.now() - _vehicleReceivedAt > VEHICLE_STALE_MS) {
      clearAllTrainMarkers(); clearSlLiveMarkers(); clearVehicleProjection(); _vehicleFollowId = '';
    } else {
      const expired = (_lastVehicles || []).some(v => v.timestamp !== null && Date.now() - v.timestamp > VEHICLE_STALE_MS && (Object.prototype.hasOwnProperty.call(trainMarkers,v.id) || Object.prototype.hasOwnProperty.call(_slLiveMarkers,v.id)));
      if (expired) { refreshVehiclePresentation(); if (!displayedVehicleList().some(v => v.id === _vehicleFollowId)) _vehicleFollowId = ''; }
      else if (_vehicleProjectionLayers.length) drawVehicleProjection();
    }
    emitVehicleUpdate();
  },1000);
}
function stopCountdown() {
  clearInterval(countdownInterval); countdownInterval = null;
  const wrap = document.getElementById('train-countdown'); if (wrap) wrap.style.display = 'none';
}
function scheduleVehicleRefresh() {
  clearTimeout(trainInterval); trainInterval = null;
  if (!activeVehicleConsumers() || _vehiclePaused || document.hidden) return;
  _vehicleNextRefreshAt = Date.now() + REFRESH_SECS * 1000;
  trainInterval = setTimeout(fetchAndRenderTrains,REFRESH_SECS * 1000);
}
function finishVehicleRequest(request) {
  if (_vehicleRequest !== request) return;
  clearTimeout(request.timeout); request.script.remove();
  window[request.callback] = function() {};
  setTimeout(() => { delete window[request.callback]; },60000);
  _vehicleRequest = null;
}
function cancelVehicleRequest() {
  if (_vehicleRequest) finishVehicleRequest(_vehicleRequest);
}
function fetchAndRenderTrains() {
  if (!activeVehicleConsumers() || !map || _vehiclePaused || _vehicleRequest || document.hidden) return;
  clearTimeout(trainInterval); trainInterval = null; bindVehicleMap();
  const callback = '__lampskeneVehicles' + (++_vehicleRequestNumber);
  const script = document.createElement('script');
  const request = { callback, script, timeout:null }; _vehicleRequest = request;
  window[callback] = function(data) {
    if (_vehicleRequest !== request) return;
    finishVehicleRequest(request);
    if (!activeVehicleConsumers() || _vehiclePaused) return;
    try {
      const now = Date.now(), vehicles = keepLatestVehiclePositions(normalizeVehicleFeed(data,now),now);
      recordVehicleObservations(vehicles,now); _lastVehicles = vehicles; _slLastVehicles = vehicles;
      _vehicleReceivedAt = now; _vehicleError = ''; refreshVehiclePresentation();
      const following = displayedVehicleList().find(v => v.id === _vehicleFollowId);
      if (following) map.panTo([following.lat,following.lng], { animate:false });
      else if (_vehicleFollowId) { _vehicleFollowId = ''; emitVehicleUpdate(); }
    } catch (err) { _vehicleError = String(err.message || 'Invalid response').slice(0,100); emitVehicleUpdate(); }
    scheduleVehicleRefresh();
  };
  const fail = message => {
    if (_vehicleRequest !== request) return;
    finishVehicleRequest(request); _vehicleError = message; emitVehicleUpdate(); scheduleVehicleRefresh();
  };
  script.onerror = () => fail('Live feed unavailable. Retrying in 15 seconds.');
  request.timeout = setTimeout(() => fail('Live feed timed out. Retrying in 15 seconds.'),12000);
  script.src = WORKER_URL + (WORKER_URL.includes('?') ? '&' : '?') + 'cb=' + callback + '&t=' + Date.now();
  script.id = 'train-jsonp-script'; document.head.appendChild(script); emitVehicleUpdate();
}
function fetchSlLineVehicles() { fetchAndRenderTrains(); }
function syncVehiclePolling() {
  syncVehicleControls(); bindVehicleMap();
  clearInterval(_slLiveInterval); _slLiveInterval = null;
  if (activeVehicleConsumers()) {
    loadStaticData(); startCountdown(); refreshVehiclePresentation(); fetchAndRenderTrains();
    if (!_vehicleRequest) scheduleVehicleRefresh();
  } else {
    clearTimeout(trainInterval); trainInterval = null; cancelVehicleRequest(); stopCountdown();
    _vehicleFollowId = ''; _vehiclePaused = false;
    _vehicleSelectedId = '';
    clearAllTrainMarkers(); clearSlLiveMarkers(); clearVehicleProjection(); emitVehicleUpdate();
  }
}
function toggleLiveTrains() {
  if (!map) { showToast('Choose a game mode to use live tracking'); return; }
  trainsEnabled = !trainsEnabled; syncVehiclePolling();
}
function toggleSlLineLive() {
  if (!map) { showToast('Choose a game mode to use live tracking'); return; }
  _slLineLive = !_slLineLive; syncVehiclePolling();
}
function setVehiclePaused(value) {
  _vehiclePaused = Boolean(value); clearTimeout(trainInterval); trainInterval = null;
  if (_vehiclePaused) { cancelVehicleRequest(); _vehicleFollowId = ''; clearVehicleProjection(); }
  else fetchAndRenderTrains();
  emitVehicleUpdate();
}
function setVehicleFilters(changes) {
  if (typeof changes.query === 'string') _vehicleFilters.query = changes.query.slice(0,80);
  if (['all','bus','subway','train','tram','light_rail','ferry','unknown'].includes(changes.type)) _vehicleFilters.type = changes.type;
  if (typeof changes.inView === 'boolean') _vehicleFilters.inView = changes.inView;
  if (_vehicleFollowId && !displayedVehicleList().some(v => v.id === _vehicleFollowId)) _vehicleFollowId = '';
  try { localStorage.setItem('lampskene_tracker_filters_v1',JSON.stringify(_vehicleFilters)); } catch (_) {}
  refreshVehiclePresentation();
}
function vehicleTrackerState(boundsOverride) {
  const now = Date.now(), vehicles = displayedVehicleList(boundsOverride);
  return { enabled:activeVehicleConsumers(), allEnabled:trainsEnabled, linesEnabled:_slLineLive, paused:_vehiclePaused, loading:Boolean(_vehicleRequest), error:_vehicleError, receivedAt:_vehicleReceivedAt, age:_vehicleReceivedAt ? Math.max(0,now - _vehicleReceivedAt) : null, filters:Object.assign({},_vehicleFilters), selectedId:_vehicleSelectedId, followId:_vehicleFollowId, projectionOn:_vehicleProjectionOn, vehicles, total:freshVehicleList().length, selected:vehicles.find(v => v.id === _vehicleSelectedId) || null };
}
function emitVehicleUpdate() {
  if (typeof CustomEvent === 'function') window.dispatchEvent(new CustomEvent('tracker:update'));
}
window.lampskeneTracker = {
  state:vehicleTrackerState, info:resolveVehicle, motion:v => vehicleMotion(v,Date.now()), projection:v => vehicleProjection(v,Date.now()),
  toggleAll:toggleLiveTrains, toggleLines:toggleSlLineLive, pause:setVehiclePaused, filters:setVehicleFilters,
  select:selectTrackedVehicle, center:() => centerTrackedVehicle(false), follow:() => centerTrackedVehicle(true),
  stopFollowing:() => { _vehicleFollowId = ''; emitVehicleUpdate(); },
  refresh:() => { if (_vehiclePaused) setVehiclePaused(false); else fetchAndRenderTrains(); },
  showProjection:value => { _vehicleProjectionOn = Boolean(value); drawVehicleProjection(); emitVehicleUpdate(); }
};
try {
  const filters = JSON.parse(localStorage.getItem('lampskene_tracker_filters_v1') || 'null');
  if (filters && typeof filters === 'object') {
    if (typeof filters.query === 'string') _vehicleFilters.query = filters.query.slice(0,80);
    if (['all','bus','subway','train','tram','light_rail','ferry','unknown'].includes(filters.type)) _vehicleFilters.type = filters.type;
    _vehicleFilters.inView = filters.inView === true;
  }
} catch (_) {}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(trainInterval); trainInterval = null; cancelVehicleRequest(); }
  else if (activeVehicleConsumers() && !_vehiclePaused) { refreshVehiclePresentation(); fetchAndRenderTrains(); }
});
