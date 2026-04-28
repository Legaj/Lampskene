// vehicles.js — live SL trains

let trainsEnabled     = false;
let trainMarkers      = {};
let trainInterval     = null;
let countdownInterval = null;
let countdownSecs     = 0;
let _markerSize       = 5;
const REFRESH_SECS    = 15;

// routeId -> { line, color }  /  tripId -> routeId
let _routeMap     = null;
let _tripMap      = null;
let _lastVehicles = null;

// ── Static data from Neocities ────────────────────────────────
function loadStaticData() {
  return fetch('/routes.txt', { cache: 'force-cache' })
    .then(r => { if (!r.ok) throw new Error('routes.txt HTTP ' + r.status); return r.text(); })
    .then(csv => { _routeMap = parseRoutesCsv(csv); console.log('routes.txt:', Object.keys(_routeMap).length, 'routes'); loadTripsInBackground(); })
    .catch(err => { console.warn('routes.txt missing:', err.message); _routeMap = {}; });
}

function loadTripsInBackground() {
  fetch('/trips.txt', { cache: 'force-cache' })
    .then(r => { if (!r.ok) throw new Error('trips.txt HTTP ' + r.status); return r.text(); })
    .then(csv => { _tripMap = parseTripsCsv(csv); console.log('trips.txt:', Object.keys(_tripMap).length, 'trips'); if (_lastVehicles) { renderTrainMarkers(_lastVehicles); showToast('Line info updated', 1500); } })
    .catch(err => { console.warn('trips.txt missing:', err.message); _tripMap = {}; });
}

function csvSplitLine(line) {
  var cols=[], cur='', inQ=false;
  for (var i=0;i<line.length;i++){var c=line[i];if(c==='"')inQ=!inQ;else if(c===','&&!inQ){cols.push(cur.trim());cur='';}else cur+=c;}
  cols.push(cur.trim()); return cols;
}
function parseRoutesCsv(csv) {
  var map={}, rows=csv.split('\n'), hdr=csvSplitLine(rows[0]);
  var iId=hdr.indexOf('route_id'), iName=hdr.indexOf('route_short_name'), iCol=hdr.indexOf('route_color');
  if(iId<0||iName<0)return map;
  for(var i=1;i<rows.length;i++){var c=csvSplitLine(rows[i]);if(c.length<=Math.max(iId,iName))continue;var id=c[iId].trim(),name=c[iName].trim(),col=iCol>=0?c[iCol].trim():'';if(id&&name)map[id]={line:name,color:col};}
  return map;
}
function parseTripsCsv(csv) {
  var map={}, rows=csv.split('\n'), hdr=csvSplitLine(rows[0]);
  var iTrip=hdr.indexOf('trip_id'), iRoute=hdr.indexOf('route_id');
  if(iTrip<0||iRoute<0)return map;
  for(var i=1;i<rows.length;i++){var c=csvSplitLine(rows[i]);if(c.length<=Math.max(iTrip,iRoute))continue;var tid=c[iTrip].trim(),rid=c[iRoute].trim();if(tid&&rid)map[tid]=rid;}
  return map;
}

function resolveVehicle(v) {
  var routeId = v.routeId || '';
  if (routeId && _routeMap && _routeMap[routeId]) return { line: _routeMap[routeId].line, color: _routeMap[routeId].color };
  if (v.tripId && _tripMap && _tripMap[v.tripId]) {
    var rid = _tripMap[v.tripId];
    if (_routeMap && _routeMap[rid]) return { line: _routeMap[rid].line, color: _routeMap[rid].color };
  }
  // NeTEx fallback
  if (routeId) { var m=routeId.match(/9011001(\d{4})/); if(m){var ln=parseInt(m[1],10);if(ln>0)return{line:String(ln),color:''};} }
  return { line: '', color: '' };
}

// ── Marker helpers ────────────────────────────────────────────
function bearingToCompass(b) {
  if (b < 0) return '';
  return ['N','NE','E','SE','S','SW','W','NW'][Math.round(b/45)%8];
}

function arrowIcon(color, bearing) {
  var r = bearing >= 0 ? bearing : 0;
  var s = _markerSize * 3;
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="'+s+'" height="'+s+'" viewBox="0 0 16 16">'
    + '<g transform="rotate('+r+' 8 8)"><polygon points="8,1 12,14 8,11 4,14" fill="'+color+'" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/></g></svg>';
  return L.divIcon({ html: svg, className: '', iconSize: [s,s], iconAnchor: [s/2,s/2] });
}

function vehicleColor(line) {
  var n = parseInt(String(line||''), 10);
  // Tunnelbana
  if (n===10||n===11||n===13||n===14) return '#FF0000';
  if (n===17||n===18||n===19)         return '#19A045';
  if (n>=20&&n<=24)                    return '#0071A7'; // blue line T20-T24 (if applicable)
  // Pendeltåg
  if (n>=35&&n<=43)                    return '#E83192';
  // Saltsjöbanan
  if (n===26)                          return '#F7A600';
  // Roslagsbanan
  if (n===27||n===28||n===29)          return '#8B4513';
  // Lidingöbanan
  if (n===21)                          return '#00A0E1';
  // Tvärbanan
  if (n===22)                          return '#00A0E1';
  // Spårväg City
  if (n===7)                           return '#E83192';
  // Buses
  if (n>=1&&n<=99)                     return '#0070C0';
  if (n>=100&&n<=399)                  return '#0070C0';
  if (n>=400&&n<=499)                  return '#0070C0';
  if (n>=500&&n<=599)                  return '#F7A600';
  return '#0070C0';
}

// ── Render ────────────────────────────────────────────────────
function renderTrainMarkers(vehicles) {
  _lastVehicles = vehicles;
  var seen = new Set();
  for (var i=0; i<vehicles.length; i++) {
    var v = vehicles[i];
    seen.add(v.id);
    var info    = resolveVehicle(v);
    var color   = vehicleColor(info.line);
    var compass = bearingToCompass(v.bearing);
    var tip     = info.line ? info.line : (v.label||v.id).slice(0,12);
    if (compass) tip += '  ' + compass;
    var hasBearing = v.bearing >= 0;
    if (trainMarkers[v.id]) {
      var m = trainMarkers[v.id];
      m.setLatLng([v.lat, v.lng]); m.setTooltipContent(tip);
      if (hasBearing) m.setIcon(arrowIcon(color, v.bearing));
      else if (m.setStyle) m.setStyle({ fillColor: color, color: color });
    } else {
      var marker;
      if (hasBearing) {
        marker = L.marker([v.lat, v.lng], { icon: arrowIcon(color, v.bearing), zIndexOffset: 10 });
      } else {
        marker = L.circleMarker([v.lat, v.lng], { radius: _markerSize, fillColor: color, fillOpacity: 0.9, color: '#fff', weight: 1.5, opacity: 0.8 });
      }
      marker.bindTooltip(tip, { permanent: false, direction: 'top', className: 'train-tip' }).addTo(map);
      trainMarkers[v.id] = marker;
    }
  }
  for (var id in trainMarkers) {
    if (!seen.has(id)) { map.removeLayer(trainMarkers[id]); delete trainMarkers[id]; }
  }
  if (!window._trainFirstLoad && Object.keys(trainMarkers).length > 0) {
    window._trainFirstLoad = true;
    showToast(Object.keys(trainMarkers).length + ' vehicles on map', 2500);
  }
}

function clearAllTrainMarkers() {
  for (var id in trainMarkers) map.removeLayer(trainMarkers[id]);
  trainMarkers = {}; window._trainFirstLoad = false;
}

function onMarkerSizeChange(val) {
  _markerSize = parseInt(val);
  document.getElementById('marker-size-val').textContent = val;
  if (_lastVehicles) renderTrainMarkers(_lastVehicles);
}

// ── Countdown ─────────────────────────────────────────────────
function startCountdown() {
  countdownSecs = REFRESH_SECS;
  var el = document.getElementById('s-countdown'), wrap = document.getElementById('train-countdown');
  if (wrap) wrap.style.display = 'flex';
  if (el)   el.textContent = REFRESH_SECS + 's';
  countdownInterval = setInterval(function() {
    countdownSecs--;
    if (el) el.textContent = countdownSecs + 's';
    if (countdownSecs <= 0) countdownSecs = REFRESH_SECS;
  }, 1000);
}

function stopCountdown() {
  clearInterval(countdownInterval); countdownInterval = null;
  var wrap = document.getElementById('train-countdown');
  if (wrap) wrap.style.display = 'none';
}

// ── JSONP fetch (bypasses Neocities CSP) ──────────────────────
function fetchAndRenderTrains() {
  if (!trainsEnabled || !map) return;
  countdownSecs = REFRESH_SECS;
  var cbName = '__trainCB';
  var old = document.getElementById('train-jsonp-script');
  if (old) old.remove();
  window[cbName] = function(data) {
    window[cbName] = null;
    if (!trainsEnabled) return;
    try {
      if (!Array.isArray(data)) throw new Error((data&&data.error)||'Not an array');
      renderTrainMarkers(data);
    } catch(e) { showToast('Trains: ' + e.message.slice(0,60), 4000); }
  };
  var script = document.createElement('script');
  script.id = 'train-jsonp-script';
  script.src = WORKER_URL + '?cb=' + cbName + '&t=' + Date.now();
  script.onerror = function() { window[cbName]=null; showToast('Trains: script failed', 3000); };
  document.head.appendChild(script);
}

// ── Toggle ────────────────────────────────────────────────────
function toggleLiveTrains() {
  if (!map) { showToast('Choose a mode first'); return; }
  trainsEnabled = !trainsEnabled;
  var spBtn    = document.getElementById('trains-sp-btn');
  var spStatus = document.getElementById('trains-sp-status');
  var sizeRow  = document.getElementById('trains-size-row');
  if (trainsEnabled) {
    if (spBtn)    spBtn.classList.add('sp-active');
    if (spStatus) spStatus.textContent = 'ON ●';
    if (sizeRow)  sizeRow.style.display = 'block';
    loadStaticData().then(function() {
      fetchAndRenderTrains();
      trainInterval = setInterval(fetchAndRenderTrains, REFRESH_SECS * 1000);
      startCountdown();
    });
  } else {
    if (spBtn)    spBtn.classList.remove('sp-active');
    if (spStatus) spStatus.textContent = 'OFF';
    if (sizeRow)  sizeRow.style.display = 'none';
    clearInterval(trainInterval); trainInterval = null;
    stopCountdown(); clearAllTrainMarkers();
    showToast('Live trains OFF');
  }
}
