// questions.js — all question logic (radar, thermometer, hider pin, SVG overlay)

// ── HIDER LOCATION ────────────────────────────────────────────

// Endgame pin — when set, all question checks use this instead of hiderPin
let endgamePin = null;
let endgamePinLocked = false;

// Returns the active location pin (endgame if set, otherwise hider)
function getActiveHiderPin() {
  return endgamePin || hiderPin;
}

function addHiderLocationCard() {
  const ql = document.getElementById('question-list');
  const card = document.createElement('div');
  card.className = 'q-card hide-loc'; card.id = 'hider-loc-card';
  card.innerHTML = `
    <div class="q-card-header">
      <svg width="14" height="16" viewBox="0 0 34 40" style="flex-shrink:0"><path d="M17 38C17 38 2 22 2 13A15 15 0 0 1 32 13C32 22 17 38 17 38Z" fill="#e8557a" stroke="rgba(0,0,0,.25)" stroke-width="1.5"/><circle cx="17" cy="13" r="5.5" fill="rgba(255,255,255,.3)"/></svg>
      <span class="q-title">Hiding Spot</span><span class="q-num">#0</span>
    </div>
    <div class="q-card-body">
      <div class="q-label">Tap the map to place your pin</div>
      <div id="hider-pin-coords" class="coord-disp"></div>
      <div class="icon-btns">
        <button class="icon-btn go-btn disabled" id="hider-goto-btn" onclick="goToHiderPin()">📍 Go to Pin</button>
        <button class="icon-btn disabled" id="hider-lock-btn" onclick="toggleHiderLock()">🔒 Lock</button>
      </div>
    </div>`;
  ql.appendChild(card);
}

function onMapClick(e) {
  if (hiderPinLocked) return;
  placeHiderPin(e.latlng.lat, e.latlng.lng);
}

function placeHiderPin(lat, lng) {
  if (hiderPin) map.removeLayer(hiderPin);
  if (hiderZoneCircle) { map.removeLayer(hiderZoneCircle); hiderZoneCircle = null; }
  hiderPin = L.marker([lat, lng], { icon: tearDropIcon('#e8557a', 34), draggable: true }).addTo(map);
  hiderPin.on('dragend', e => {
    const p = e.target.getLatLng();
    document.getElementById('hider-pin-coords').textContent = `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
    updateHiderZoneCircle(); checkAllHiderRadars(); checkAllHiderThermos(); if(typeof checkAllHiderMatching!=="undefined")checkAllHiderMatching(); if(typeof checkAllHiderMeasuring!=="undefined")checkAllHiderMeasuring();
  });
  document.getElementById('hider-pin-coords').textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  updateHiderZoneCircle(); checkAllHiderRadars(); checkAllHiderThermos(); if(typeof checkAllHiderMatching!=="undefined")checkAllHiderMatching(); if(typeof checkAllHiderMeasuring!=="undefined")checkAllHiderMeasuring();
  ['hider-goto-btn','hider-lock-btn'].forEach(id => document.getElementById(id).classList.remove('disabled'));
  if(typeof saveState!=='undefined')saveState();
}

function goToHiderPin() { if (hiderPin) map.setView(hiderPin.getLatLng(), 15); }

function toggleHiderLock() {
  hiderPinLocked = !hiderPinLocked;
  const btn = document.getElementById('hider-lock-btn');
  if (hiderPinLocked) { btn.textContent='🔓 Locked'; btn.classList.add('locked'); if(hiderPin) hiderPin.dragging.disable(); showToast('Hiding spot locked 🔒'); }
  else                { btn.textContent='🔒 Lock';   btn.classList.remove('locked'); if(hiderPin) hiderPin.dragging.enable(); }
}

function updateHiderZoneCircle() {
  if (hiderZoneCircle) { map.removeLayer(hiderZoneCircle); hiderZoneCircle = null; }
  if (!hiderPin) return;
  const p = hiderPin.getLatLng();
  hiderZoneCircle = L.circle([p.lat, p.lng], {
    radius: HIDER_ZONE_RADIUS, color: '#e8557a', weight: 1.5, opacity: 0.6,
    fillColor: '#e8557a', fillOpacity: 0.07, interactive: false, dashArray: '6 4'
  }).addTo(map);
}

// ── SEEKER QUESTIONS ──────────────────────────────────────────
function addQuestion(type) {
  typePickerOpen = false;
  document.getElementById('type-picker').style.display = 'none';
  qCounter++;
  const id = qCounter;
  const center = map.getCenter();
  if (type === 'radar') {
    const q = { id, type, lat: center.lat, lng: center.lng, radius: '', unit: 'M', zone: 'pending', locked: false };
    questions.push(q); renderSeekerRadarCard(q); placeSeekerPin(q);
  } else if (type === 'thermo') {
    const q = { id, type, latA: center.lat+0.005, lngA: center.lng-0.008, latB: center.lat-0.005, lngB: center.lng+0.008, closer: 'pending', locked: false };
    questions.push(q); renderSeekerThermoCard(q); placeThermoPin(q,'A'); placeThermoPin(q,'B'); updateThermoDistance(q);
  }
  if (!sidebarOpen) toggleSidebar();
}

function placeSeekerPin(q) {
  if (q.marker) map.removeLayer(q.marker);
  q.marker = L.marker([q.lat, q.lng], { icon: tearDropIcon('#ff9950', 32), draggable: !q.locked }).addTo(map);
  q.marker.on('dragend', e => {
    const p = e.target.getLatLng(); q.lat = p.lat; q.lng = p.lng;
    const el = document.getElementById(`coord-disp-${q.id}`);
    if (el) el.textContent = `Pin: ${q.lat.toFixed(5)}, ${q.lng.toFixed(5)}`;
    redrawQuestionOverlay(q); redrawOutlineCircle(q); if(typeof saveState!=='undefined')saveState();
  });
}

function renderSeekerRadarCard(q) {
  const ql = document.getElementById('question-list');
  const card = document.createElement('div');
  card.className = 'q-card radar'; card.id = `q-card-${q.id}`;
  card.innerHTML = `
    <div class="q-card-header">
      <svg width="13" height="16" viewBox="0 0 34 40" style="flex-shrink:0"><path d="M17 38C17 38 2 22 2 13A15 15 0 0 1 32 13C32 22 17 38 17 38Z" fill="#ff9950" stroke="rgba(0,0,0,.25)" stroke-width="1.5"/><circle cx="17" cy="13" r="5.5" fill="rgba(255,255,255,.3)"/></svg>
      <span class="q-title">Radar</span><span class="q-num">#${q.id}</span>
    </div>
    <div class="q-card-body">
      <div><div class="q-label">Radius</div>
        <div class="radius-group">
          <input type="number" min="1" placeholder="e.g. 500" id="rad-inp-${q.id}" oninput="onRadiusChange(${q.id})" />
          <div class="unit-toggle">
            <button class="unit-btn active" id="unit-m-${q.id}"  onclick="setUnit(${q.id},'M')">m</button>
            <button class="unit-btn"        id="unit-km-${q.id}" onclick="setUnit(${q.id},'KM')">km</button>
          </div>
        </div>
      </div>
      <div id="coord-disp-${q.id}" class="coord-disp">Pin: ${q.lat.toFixed(5)}, ${q.lng.toFixed(5)}</div>
      <div class="icon-btns">
        <button class="icon-btn go-btn" onclick="goToSeekerPin(${q.id}); if(sidebarOpen)toggleSidebar();">📍 Go to Pin</button>
        <button class="icon-btn" onclick="setMyLocation_radar(${q.id})">📱 My Loc</button>
        <button class="icon-btn" id="lock-btn-${q.id}" onclick="toggleSeekerLock(${q.id})">🔒 Lock</button>
      </div>
      <div><div class="q-label">Hider is…</div>
        <div class="zone-toggle">
          <button class="zone-btn active-pend" id="zpend-${q.id}" onclick="setZone(${q.id},'pending')">⏳ TBD</button>
          <button class="zone-btn"             id="zin-${q.id}"   onclick="setZone(${q.id},'inside')">✅ Inside</button>
          <button class="zone-btn"             id="zout-${q.id}"  onclick="setZone(${q.id},'outside')">❌ Outside</button>
        </div>
      </div>
      <button class="copy-btn" id="copy-btn-${q.id}" onclick="copyCode(${q.id})">📋 Copy Question Code</button>
      <button class="remove-btn" id="remove-btn-${q.id}" onclick="removeQuestion(${q.id})">✕ Remove Question</button>
    </div>`;
  ql.appendChild(card);
}

function onRadiusChange(id) { const q=questions.find(x=>x.id===id); q.radius=document.getElementById(`rad-inp-${id}`).value; redrawQuestionOverlay(q); redrawOutlineCircle(q); }
function setUnit(id,unit) { const q=questions.find(x=>x.id===id); q.unit=unit; document.getElementById(`unit-m-${id}`).classList.toggle('active',unit==='M'); document.getElementById(`unit-km-${id}`).classList.toggle('active',unit==='KM'); redrawQuestionOverlay(q); redrawOutlineCircle(q); }
function goToSeekerPin(id) { const q=questions.find(x=>x.id===id); map.setView([q.lat,q.lng],14); }
function toggleSeekerLock(id) {
  const q=questions.find(x=>x.id===id); q.locked=!q.locked;
  const btn=document.getElementById(`lock-btn-${id}`); const rb=document.getElementById(`remove-btn-${id}`);
  if(q.locked){btn.textContent='🔓 Locked';btn.classList.add('locked');if(q.marker)q.marker.dragging.disable();if(rb){rb.disabled=true;rb.style.opacity='0.25';rb.style.pointerEvents='none';}showToast(`Radar #${id} locked 🔒`); if(typeof saveState!=='undefined')saveState(); if(typeof applyHideLockedPins!=='undefined')applyHideLockedPins();}
  else{btn.textContent='🔒 Lock';btn.classList.remove('locked');if(q.marker)q.marker.dragging.enable();if(rb){rb.disabled=false;rb.style.opacity='';rb.style.pointerEvents='';}if(typeof applyHideLockedPins!=='undefined')applyHideLockedPins();}
}

// ── THERMOMETER SEEKER ────────────────────────────────────────
function thermoTearDrop(color) {
  return `<svg width="13" height="16" viewBox="0 0 34 40" style="flex-shrink:0"><path d="M17 38C17 38 2 22 2 13A15 15 0 0 1 32 13C32 22 17 38 17 38Z" fill="${color}" stroke="rgba(0,0,0,.25)" stroke-width="1.5"/><circle cx="17" cy="13" r="5.5" fill="rgba(255,255,255,.3)"/></svg>`;
}

function renderSeekerThermoCard(q) {
  const ql = document.getElementById('question-list');
  const card = document.createElement('div');
  card.className = 'q-card thermo'; card.id = `q-card-${q.id}`;
  card.innerHTML = `
    <div class="q-card-header"><span style="font-size:14px">🌡️</span><span class="q-title">Thermometer</span><span class="q-num">#${q.id}</span></div>
    <div class="q-card-body">
      <div class="q-label">Pin positions</div>
      <div style="display:flex;gap:6px;align-items:center;">${thermoTearDrop('#f5d020')}<span style="font-size:9px;color:#f5d020;letter-spacing:1px">PIN A</span><span id="coord-a-${q.id}" class="coord-disp" style="flex:1;text-align:right">${q.latA.toFixed(4)}, ${q.lngA.toFixed(4)}</span></div>
      <div style="display:flex;gap:6px;align-items:center;">${thermoTearDrop('#f59520')}<span style="font-size:9px;color:#f59520;letter-spacing:1px">PIN B</span><span id="coord-b-${q.id}" class="coord-disp" style="flex:1;text-align:right">${q.latB.toFixed(4)}, ${q.lngB.toFixed(4)}</span></div>
      <div style="display:flex;align-items:center;gap:8px;padding:4px 0;"><span class="q-label" style="margin:0">Distance:</span><span class="thermo-dist" id="thermo-dist-${q.id}">—</span></div>
      <div class="icon-btns">
        <button class="icon-btn go-btn" onclick="goToThermoPin(${q.id},'A'); if(sidebarOpen)toggleSidebar();">📍 A</button>
        <button class="icon-btn go-btn" onclick="goToThermoPin(${q.id},'B'); if(sidebarOpen)toggleSidebar();">📍 B</button>
        <button class="icon-btn" onclick="setMyLocation_thermoA(${q.id})">📱 Loc A</button>
        <button class="icon-btn" onclick="setMyLocation_thermoB(${q.id})">📱 Loc B</button>
        <button class="icon-btn" id="tlock-btn-${q.id}" onclick="toggleThermoLock(${q.id})">🔒 Lock</button>
      </div>
      <div><div class="q-label">Hider is closer to…</div>
        <div class="closer-toggle">
          <button class="closer-btn active-pend" id="cpend-${q.id}" onclick="setCloser(${q.id},'pending')">⏳ TBD</button>
          <button class="closer-btn"             id="ca-${q.id}"    onclick="setCloser(${q.id},'A')">🟡 Pin A</button>
          <button class="closer-btn"             id="cb-${q.id}"    onclick="setCloser(${q.id},'B')">🟠 Pin B</button>
        </div>
      </div>
      <button class="copy-btn" style="border-color:rgba(245,208,32,.35);color:#f5d020;background:rgba(245,208,32,.12)" id="tcopy-btn-${q.id}" onclick="copyThermoCode(${q.id})">📋 Copy Question Code</button>
      <button class="remove-btn" id="remove-btn-${q.id}" onclick="removeQuestion(${q.id})">✕ Remove Question</button>
    </div>`;
  ql.appendChild(card);
}

function placeThermoPin(q, pin) {
  const lat=pin==='A'?q.latA:q.latB, lng=pin==='A'?q.lngA:q.lngB, color=pin==='A'?'#f5d020':'#f59520', key=pin==='A'?'markerA':'markerB';
  if(q[key]) map.removeLayer(q[key]);
  q[key]=L.marker([lat,lng],{icon:tearDropIcon(color,30),draggable:!q.locked}).addTo(map);
  q[key].on('dragend',e=>{const p=e.target.getLatLng();if(pin==='A'){q.latA=p.lat;q.lngA=p.lng;}else{q.latB=p.lat;q.lngB=p.lng;}updateThermoDistance(q);const el=document.getElementById(`coord-${pin.toLowerCase()}-${q.id}`);if(el)el.textContent=`${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`;redrawQuestionOverlay(q);if(typeof saveState!=='undefined')saveState();});
}
function updateThermoDistance(q){const dist=map.distance([q.latA,q.lngA],[q.latB,q.lngB]);const el=document.getElementById(`thermo-dist-${q.id}`);if(el)el.textContent=dist>=1000?`${(dist/1000).toFixed(2)} km`:`${Math.round(dist)} m`;}
function goToThermoPin(id,pin){const q=questions.find(x=>x.id===id);map.setView([pin==='A'?q.latA:q.latB,pin==='A'?q.lngA:q.lngB],14);}
function toggleThermoLock(id){
  const q=questions.find(x=>x.id===id);q.locked=!q.locked;
  const btn=document.getElementById(`tlock-btn-${id}`);const rb=document.getElementById(`remove-btn-${id}`);
  if(q.locked){btn.textContent='🔓 Locked';btn.classList.add('locked');if(q.markerA)q.markerA.dragging.disable();if(q.markerB)q.markerB.dragging.disable();if(rb){rb.disabled=true;rb.style.opacity='0.25';rb.style.pointerEvents='none';}showToast(`Thermometer #${id} locked 🔒`); if(typeof saveState!=='undefined')saveState(); if(typeof applyHideLockedPins!=='undefined')applyHideLockedPins();}
  else{btn.textContent='🔒 Lock';btn.classList.remove('locked');if(q.markerA)q.markerA.dragging.enable();if(q.markerB)q.markerB.dragging.enable();if(rb){rb.disabled=false;rb.style.opacity='';rb.style.pointerEvents='';}if(typeof applyHideLockedPins!=='undefined')applyHideLockedPins();}
}
function setCloser(id,closer){const q=questions.find(x=>x.id===id);q.closer=closer;document.getElementById(`cpend-${id}`).className='closer-btn'+(closer==='pending'?' active-pend':'');document.getElementById(`ca-${id}`).className='closer-btn'+(closer==='A'?' active-a':'');document.getElementById(`cb-${id}`).className='closer-btn'+(closer==='B'?' active-b':'');redrawQuestionOverlay(q);}
function copyThermoCode(id){const q=questions.find(x=>x.id===id);const code=`THM-${q.latA.toFixed(5)}-${q.lngA.toFixed(5)}-${q.latB.toFixed(5)}-${q.lngB.toFixed(5)}`;const btn=document.getElementById(`tcopy-btn-${id}`);navigator.clipboard.writeText(code).then(()=>{btn.textContent='✅ Copied!';setTimeout(()=>{btn.textContent='📋 Copy Question Code';},2200);}).catch(()=>showToast(code,5000));}

function setZone(id,zone){
  const q=questions.find(x=>x.id===id);q.zone=zone;
  document.getElementById(`zpend-${id}`).className='zone-btn'+(zone==='pending'?' active-pend':'');
  document.getElementById(`zin-${id}`).className  ='zone-btn'+(zone==='inside' ?' active-in':'');
  document.getElementById(`zout-${id}`).className ='zone-btn'+(zone==='outside'?' active-out':'');
  if(zone==='pending'){redrawOutlineCircle(q);}else{if(outlineCircles[id]){map.removeLayer(outlineCircles[id]);delete outlineCircles[id];}}
  redrawQuestionOverlay(q);
  if(typeof saveState!=='undefined')saveState();
}
function buildCode(q){return `RAD-${q.lat.toFixed(5)}-${q.lng.toFixed(5)}-${q.radius}${q.unit}`;}
function copyCode(id){const q=questions.find(x=>x.id===id);if(!q.radius){showToast('Set a radius first!');return;}const code=buildCode(q);const btn=document.getElementById(`copy-btn-${id}`);navigator.clipboard.writeText(code).then(()=>{btn.textContent='✅ Copied!';btn.classList.add('copied');setTimeout(()=>{btn.textContent='📋 Copy Question Code';btn.classList.remove('copied');},2200);}).catch(()=>showToast(code,5000));}
function getRadiusMeters(q){const v=parseFloat(q.radius);if(!v||isNaN(v))return null;return q.unit==='KM'?v*1000:v;}

function redrawOutlineCircle(q){
  if(outlineCircles[q.id]){map.removeLayer(outlineCircles[q.id]);delete outlineCircles[q.id];}
  const r=getRadiusMeters(q);if(!r)return;
  outlineCircles[q.id]=L.circle([q.lat,q.lng],{radius:r,color:'#ff9950',weight:2,opacity:0.85,fill:false,interactive:false}).addTo(map);
}

// ── SVG ZONE OVERLAY ──────────────────────────────────────
// Design:
//   - One SVG element in Leaflet's overlayPane (moves with map automatically)
//   - SVG has opacity=0.30 so all fills are that tone of blue
//   - Every path uses solid opaque blue (#4882dc)
//   - Each answered question adds its OWN path element(s)
//   - Overlapping blue areas paint the same opaque blue = no stacking, one tone ✓
//   - YES constraint  → worldRect + ccwHole  (blue outside the valid shape)
//   - NO/exclusive    → the shape itself filled (blue inside)
//   - measuring closer → SVG mask (union of circles, black holes = transparent)
//
// "if a pixel is blue in ANY question → value 1 → blue"
// White = value 0 in ALL questions = inside the valid shape of EVERY yes-constraint
//         AND not covered by any no/exclusive shape

let _overlaySvg = null;
let _voronoiSvg = null;
let _closerSvg  = null; // separate layer for measuring-closer (below main overlay)
let _rebuildPending = false;

const BLUE = '#4882dc';
const NS   = 'http://www.w3.org/2000/svg';
const OPAD = 10000;

// ── Signed area helper to detect winding ─────────────────────
// Returns positive for CW in screen y-down space, negative for CCW
function polySignedArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1,y1] = pts[i], [x2,y2] = pts[(i+1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return s; // positive → CW (y-down screen)
}

// Pixel array [[x,y],...] → SVG path string, optionally reversed
function ptsToD(pts, reverse) {
  const a = reverse ? [...pts].reverse() : pts;
  return 'M' + a.map(([x,y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L') + 'Z';
}

// Geo ring [lng,lat] array → pixel [[x,y]] array
function geoRingToPx(ring) {
  return ring.map(([lng, lat]) => {
    const p = map.latLngToLayerPoint(L.latLng(lat, lng));
    return [p.x, p.y];
  });
}

// ringToPixelD: used by voronoi lines code
function ringToPixelD(ring, reverse) {
  return ptsToD(geoRingToPx(ring), reverse);
}

// Circle as pixel [[x,y]] array (CW in y-down screen space)
function circlePxPts(lat, lng, r) {
  const cosLat = Math.cos(lat * Math.PI / 180), pts = [];
  for (let i = 0; i < 80; i++) {
    const a = (i / 80) * 2 * Math.PI;
    const p = map.latLngToLayerPoint(L.latLng(
      lat + (r/111320)*Math.cos(a),
      lng + (r/(111320*cosLat))*Math.sin(a)
    ));
    pts.push([p.x, p.y]);
  }
  return pts; // CW in screen (verified: a=0..2π goes N→E→S→W = CW y-down)
}

// ── Add one blue path to the overlay SVG ─────────────────────
// YES constraint (blue outside shape): worldD + ccwShape hole, nonzero fill
// The "hole" must be CCW in screen space. ensureCCW guarantees it.
function addYesPath(shapePts) {
  const worldD = `M${-OPAD},${-OPAD} L${OPAD},${-OPAD} L${OPAD},${OPAD} L${-OPAD},${OPAD} Z`;
  // Force shapePts to CCW (negative signed area) for use as hole
  const ccw = polySignedArea(shapePts) > 0 ? [...shapePts].reverse() : shapePts;
  const d = worldD + ' ' + ptsToD(ccw, false);
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', BLUE);
  path.setAttribute('fill-rule', 'nonzero');
  path.setAttribute('stroke', 'none');
  _overlaySvg.appendChild(path);
}

// NO/exclusive constraint (blue inside shape): the filled shape, evenodd (handles inner rings)
function addNoPath(outerPts, innerPtsArray) {
  // Force outer to CW (positive area)
  const cw = polySignedArea(outerPts) < 0 ? [...outerPts].reverse() : outerPts;
  let d = ptsToD(cw, false);
  // Inner rings as holes (any winding works with evenodd)
  if (innerPtsArray) for (const inner of innerPtsArray) d += ' ' + ptsToD(inner, false);
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', BLUE);
  path.setAttribute('fill-rule', innerPtsArray && innerPtsArray.length ? 'evenodd' : 'nonzero');
  path.setAttribute('stroke', 'none');
  _overlaySvg.appendChild(path);
}

// ── S-H geometry helpers ──────────────────────────────────────
function _shSide(ax,ay,bx,by,px,py){ return (bx-ax)*(py-ay)-(by-ay)*(px-ax); }
function _shClipEdge(subj,ax,ay,bx,by){
  if(!subj.length) return [];
  const out=[];
  for(let i=0;i<subj.length;i++){
    const [cx,cy]=subj[i],[dx,dy]=subj[(i+1)%subj.length];
    // d1/d2 = side of subject points C,D w.r.t. clip edge A→B
    const d1=_shSide(ax,ay,bx,by,cx,cy);
    const d2=_shSide(ax,ay,bx,by,dx,dy);
    const cs=d1>=0, ds=d2>=0;
    if(cs) out.push([cx,cy]);
    if(cs!==ds){
      // t = parametric position on subject edge C→D where it crosses clip line A→B
      if(Math.abs(d1-d2)>1e-10){
        const t=d1/(d1-d2);
        out.push([cx+t*(dx-cx), cy+t*(dy-cy)]);
      }
    }
  }
  return out;
}
function geoClipByHalfPlane(subj,mx,my,nx,ny){
  const len=Math.sqrt(nx*nx+ny*ny)||1, ux=nx/len, uy=ny/len;
  const px=-uy*OPAD, py=ux*OPAD;
  const ax=mx+px, ay=my+py, bx=mx-px, by=my-py;
  const s=_shSide(ax,ay,bx,by,mx+ux,my+uy);
  return s>=0 ? _shClipEdge(subj,ax,ay,bx,by) : _shClipEdge(subj,bx,by,ax,ay);
}
function geoCirclePoly(lat,lng,r){ return circlePxPts(lat,lng,r); } // alias
function geoPolyToD(pts){ return ptsToD(pts,false); }               // alias

function voronoiCell(loc, allLocs){
  let cell=[[-OPAD,-OPAD],[OPAD,-OPAD],[OPAD,OPAD],[-OPAD,OPAD]];
  const mPx=map.latLngToLayerPoint(L.latLng(loc.lat,loc.lng));
  for(const other of allLocs){
    if(other.id===loc.id) continue;
    const oPx=map.latLngToLayerPoint(L.latLng(other.lat,other.lng));
    cell=geoClipByHalfPlane(cell,(mPx.x+oPx.x)/2,(mPx.y+oPx.y)/2,mPx.x-oPx.x,mPx.y-oPx.y);
    if(!cell.length) break;
  }
  return cell;
}

// ── Ensure SVG elements ───────────────────────────────────────
const SVG_PAD = 600; // kept for worldD size reference

function ensureOverlay(){
  if(_overlaySvg) return;
  // _closerSvg must be appended first so it sits below _overlaySvg in the pane
  _closerSvg = document.createElementNS(NS,'svg');
  _closerSvg.style.cssText='position:absolute;top:0;left:0;width:1px;height:1px;pointer-events:none;overflow:visible;';
  _closerSvg.setAttribute('opacity','0.30');
  map.getPanes().overlayPane.appendChild(_closerSvg);

  _overlaySvg = document.createElementNS(NS,'svg');
  _overlaySvg.style.cssText='position:absolute;top:0;left:0;width:1px;height:1px;pointer-events:none;overflow:visible;';
  _overlaySvg.setAttribute('opacity','0.30');
  map.getPanes().overlayPane.appendChild(_overlaySvg);
  map.on('move zoom viewreset zoomend moveend', scheduleRebuild);
}
function ensureMasterOverlay(){ ensureOverlay(); }
function ensureVoronoiSvg(){
  if(_voronoiSvg) return;
  _voronoiSvg = document.createElementNS(NS,'svg');
  _voronoiSvg.style.cssText='position:absolute;top:0;left:0;width:1px;height:1px;pointer-events:none;overflow:visible;';
  map.getPanes().overlayPane.appendChild(_voronoiSvg);
}

// ── Schedule / trigger rebuild ────────────────────────────────
function scheduleRebuild(){
  if(_rebuildPending) return;
  _rebuildPending = true;
  requestAnimationFrame(() => { _rebuildPending = false; rebuildAll(); rebuildVoronoiLines(); });
}
function redrawQuestionOverlay(){ ensureOverlay(); scheduleRebuild(); }
function clearQuestionOverlay(){  scheduleRebuild(); }
function rebuildMasterPath(){ scheduleRebuild(); }

// ── Main rebuild function ─────────────────────────────────────
function rebuildAll(){
  if(!map || !_overlaySvg) return;
  _overlaySvg.innerHTML = ''; // clear and rebuild
  if(_closerSvg) _closerSvg.innerHTML = '';

  const allData = getAllMatchingData();
  const closerCirclesPts = [];

  for(const q of questions){

    // ── Radar ─────────────────────────────────────────────────
    if(q.type === 'radar'){
      const r = getRadiusMeters(q); if(!r) continue;
      const pts = circlePxPts(q.lat, q.lng, r);
      if(q.zone === 'inside')        addYesPath(pts);   // blue outside circle
      else if(q.zone === 'outside')  addNoPath(pts);    // blue inside circle
    }

    // ── Thermometer ───────────────────────────────────────────
    else if(q.type === 'thermo'){
      if(q.closer !== 'A' && q.closer !== 'B') continue;
      const pA = map.latLngToLayerPoint(L.latLng(q.latA, q.lngA));
      const pB = map.latLngToLayerPoint(L.latLng(q.latB, q.lngB));
      const mx=(pA.x+pB.x)/2, my=(pA.y+pB.y)/2;
      const dx=pB.x-pA.x, dy=pB.y-pA.y;
      const len=Math.sqrt(dx*dx+dy*dy)||1;
      const nx=dx/len, ny=dy/len, bx=-ny, by=nx;
      const inclPin = q.closer==='A' ? pA : pB;
      const indir   = ((inclPin.x-mx)*nx + (inclPin.y-my)*ny) >= 0 ? 1 : -1;
      const exdir   = -indir; // direction toward EXCLUDED half-plane
      const c1x=mx+bx*OPAD, c1y=my+by*OPAD, c2x=mx-bx*OPAD, c2y=my-by*OPAD;
      const c3x=c2x+nx*exdir*OPAD*2, c3y=c2y+ny*exdir*OPAD*2;
      const c4x=c1x+nx*exdir*OPAD*2, c4y=c1y+ny*exdir*OPAD*2;
      const excludedQuad = [[c1x,c1y],[c2x,c2y],[c3x,c3y],[c4x,c4y]];
      addNoPath(excludedQuad); // blue in the excluded half-plane
    }

    // ── Matching ──────────────────────────────────────────────
    else if(q.type === 'matching'){
      if(q.answer !== 'yes' && q.answer !== 'no') continue;
      const locs = allData[q.subcat] || [];
      if(!locs.length) continue;
      const type0 = locs[0].type; // undefined=point, 'polygon', 'polyline'

      if(!type0){
        // ── Point-based: Voronoi cell in pixel space ──────────
        if(locs.length <= 1) continue;
        const ml = locs.find(x => x.id === q.nearestId); if(!ml) continue;
        const mPx = map.latLngToLayerPoint(L.latLng(ml.lat, ml.lng));
        let cell = [[-OPAD,-OPAD],[OPAD,-OPAD],[OPAD,OPAD],[-OPAD,OPAD]];
        for(const other of locs){
          if(other.id === ml.id) continue;
          const oPx = map.latLngToLayerPoint(L.latLng(other.lat, other.lng));
          cell = geoClipByHalfPlane(cell,(mPx.x+oPx.x)/2,(mPx.y+oPx.y)/2,mPx.x-oPx.x,mPx.y-oPx.y);
          if(!cell.length) break;
        }
        if(cell.length < 3) continue;
        if(q.answer === 'yes') addYesPath(cell);  // blue outside cell
        else                   addNoPath(cell);   // blue inside cell
      }

      else if(type0 === 'polygon'){
        // ── Polygon area ──────────────────────────────────────
        const loc = locs.find(x => x.id === q.nearestId); if(!loc) continue;
        const outer = geoRingToPx(loc.rings[0]);
        const inners = loc.rings.slice(1).map(r => geoRingToPx(r));
        if(q.answer === 'yes'){
          addYesPath(outer); // blue outside polygon
          // Inner rings = holes in polygon = NOT valid area for hider → blue
          for(const inner of inners) addNoPath(inner);
        } else {
          addNoPath(outer, inners); // blue inside polygon with inner-ring holes
        }
      }

      else if(type0 === 'polyline'){
        // ── Polyline: pre-computed voronoiCell ────────────────
        const loc = locs.find(x => x.id === q.nearestId); if(!loc) continue;
        if(!loc.voronoiCell || loc.voronoiCell.length < 3) continue;
        const cell = geoRingToPx(loc.voronoiCell);
        if(q.answer === 'yes') addYesPath(cell);
        else                   addNoPath(cell);
      }
    }

    // ── Measuring ─────────────────────────────────────────────
    else if(q.type === 'measuring'){
      if(q.answer === 'pending' || !q.seekerDist) continue;
      const locs = getMeasuringLocs(q.subcat);
      if(!locs.length) continue;
      for(const loc of locs){
        const pts = circlePxPts(loc.lat, loc.lng, q.seekerDist);
        if(q.answer === 'closer') closerCirclesPts.push(pts);
        else                      addNoPath(pts);
      }
    }
  }

  // ── Measuring CLOSER ─────────────────────────────────────────
  // Rendered in _closerSvg which sits BELOW _overlaySvg in the DOM.
  // Blue rect + white circles in the lower layer → white shows through as map.
  // Main overlay (radar, thermo, matching) renders on top, unaffected by white.
  if(closerCirclesPts.length && _closerSvg){
    const bgRect = document.createElementNS(NS,'rect');
    bgRect.setAttribute('x',-OPAD); bgRect.setAttribute('y',-OPAD);
    bgRect.setAttribute('width',OPAD*2); bgRect.setAttribute('height',OPAD*2);
    bgRect.setAttribute('fill',BLUE);
    _closerSvg.appendChild(bgRect);
    for(const pts of closerCirclesPts){
      const cp = document.createElementNS(NS,'path');
      cp.setAttribute('d', ptsToD(pts, false));
      cp.setAttribute('fill','white');
      cp.setAttribute('stroke','none');
      _closerSvg.appendChild(cp);
    }
  }
}

function circleD(lat,lng,r){return ptsToD(circlePxPts(lat,lng,r),false);}


// ── GPS MY LOCATION ───────────────────────────────────────────────────────────
function _getGPS(callback) {
  if (!navigator.geolocation) { showToast('Geolocation not supported'); return; }
  navigator.geolocation.getCurrentPosition(
    pos => callback(pos.coords.latitude, pos.coords.longitude),
    ()  => showToast('Could not get location')
  );
}
function setMyLocation_radar(id) {
  _getGPS((lat,lng) => {
    const q = questions.find(x=>x.id===id); if(!q||q.locked) return;
    q.lat=lat; q.lng=lng;
    if(q.marker) q.marker.setLatLng([lat,lng]);
    const el=document.getElementById(`coord-disp-${id}`);
    if(el) el.textContent=`Pin: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    redrawQuestionOverlay(q); redrawOutlineCircle(q);
    map.setView([lat,lng],15);
  });
}
function setMyLocation_thermoA(id) {
  _getGPS((lat,lng) => {
    const q = questions.find(x=>x.id===id); if(!q||q.locked) return;
    q.latA=lat; q.lngA=lng;
    if(q.markerA) q.markerA.setLatLng([lat,lng]);
    const el=document.getElementById(`coord-a-${id}`);
    if(el) el.textContent=`${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    updateThermoDistance(q); redrawQuestionOverlay(q); map.setView([lat,lng],15);
  });
}
function setMyLocation_thermoB(id) {
  _getGPS((lat,lng) => {
    const q = questions.find(x=>x.id===id); if(!q||q.locked) return;
    q.latB=lat; q.lngB=lng;
    if(q.markerB) q.markerB.setLatLng([lat,lng]);
    const el=document.getElementById(`coord-b-${id}`);
    if(el) el.textContent=`${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    updateThermoDistance(q); redrawQuestionOverlay(q); map.setView([lat,lng],15);
  });
}
function setMyLocation_matching(id) {
  _getGPS((lat,lng) => {
    const q = questions.find(x=>x.id===id); if(!q||q.locked) return;
    q.lat=lat; q.lng=lng;
    if(q.marker) q.marker.setLatLng([lat,lng]);
    const el=document.getElementById(`match-coord-${id}`);
    if(el) el.textContent=`${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    updateMatchingNearest(q); map.setView([lat,lng],15);
  });
}
function setMyLocation_measuring(id) {
  _getGPS((lat,lng) => {
    const q = questions.find(x=>x.id===id); if(!q||q.locked) return;
    q.lat=lat; q.lng=lng;
    if(q.marker) q.marker.setLatLng([lat,lng]);
    const el=document.getElementById(`meas-coord-${id}`);
    if(el) el.textContent=`${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    updateMeasuringNearest(q); map.setView([lat,lng],15);
  });
}

// ── HIDER DECODE ──────────────────────────────────────────────
function decodeAndAdd(){
  const raw=document.getElementById('hider-code-field').value.trim().toUpperCase().replace(/\s/g,'');
  if(!raw)return;
  const radarMatch=raw.match(/^RAD-([\-\d.]+)-([\-\d.]+)-(\d+\.?\d*)(KM|M)$/);
  if(radarMatch){const lat=parseFloat(radarMatch[1]),lng=parseFloat(radarMatch[2]),rad=radarMatch[3],unit=radarMatch[4];qCounter++;const q={id:qCounter,type:'radar',lat,lng,radius:rad,unit,zone:'pending',locked:true,hiderMode:true};questions.push(q);renderHiderRadarCard(q);redrawOutlineCircle(q);checkHiderRadar(q);map.setView([lat,lng],13);document.getElementById('hider-code-field').value='';showToast('Radar question added!');return;}
  const thermoMatch=raw.match(/^THM-([\-\d.]+)-([\-\d.]+)-([\-\d.]+)-([\-\d.]+)$/);
  if(thermoMatch){const latA=parseFloat(thermoMatch[1]),lngA=parseFloat(thermoMatch[2]),latB=parseFloat(thermoMatch[3]),lngB=parseFloat(thermoMatch[4]);qCounter++;const q={id:qCounter,type:'thermo',latA,lngA,latB,lngB,closer:'pending',locked:true,hiderMode:true};questions.push(q);renderHiderThermoCard(q);checkHiderThermo(q);map.setView([(latA+latB)/2,(lngA+lngB)/2],13);document.getElementById('hider-code-field').value='';showToast('Thermometer question added!');return;}
  // MATCHING — parse from original (not uppercased) to preserve case
  const rawOrig = document.getElementById('hider-code-field').value.trim();
  const matchMatch = rawOrig.toUpperCase().startsWith('MAT-')
    ? rawOrig.match(/^MAT-([^-]+)-([\-\d.]+)-([\-\d.]+)-([^-]+)$/i)
    : null;
  if (matchMatch) {
    const subcat = decodeSubcat(matchMatch[1].toLowerCase());
    const seekerLat = parseFloat(matchMatch[2]), seekerLng = parseFloat(matchMatch[3]);
    const nearestId = matchMatch[4].toLowerCase();
    const locs = MATCHING_DATA[subcat] || [];
    const loc  = locs.find(x => x.id === nearestId) || { name: nearestId };
    qCounter++;
    const q = { id: qCounter, type: 'matching', subcat, seekerLat, seekerLng, nearestId, nearestName: loc.name, answer: 'pending', locked: true, hiderMode: true };
    questions.push(q);
    renderHiderMatchingCard(q);
    checkHiderMatching(q);
    document.getElementById('hider-code-field').value = '';
    showToast('Matching question added!');
    return;
  }

  // MEASURING
  if (rawOrig.toUpperCase().startsWith('MEA-')) {
    if (decodeMeasuring(rawOrig)) return;
  }

  showToast('Invalid code — check format');
}

function renderHiderThermoCard(q){const ql=document.getElementById('question-list');const dist=map.distance([q.latA,q.lngA],[q.latB,q.lngB]);const distStr=dist>=1000?`${(dist/1000).toFixed(2)} km`:`${Math.round(dist)} m`;const card=document.createElement('div');card.className='q-card thermo';card.id=`q-card-${q.id}`;card.innerHTML=`<div class="q-card-header"><span style="font-size:14px">🌡️</span><span class="q-title">Thermometer</span><span class="q-num">#${q.id}</span></div><div class="q-card-body"><div style="font-size:10px;color:var(--text2)">Pin A–B distance: <span class="thermo-dist">${distStr}</span></div><div class="icon-btns"><button class="icon-btn go-btn" onclick="map.setView([${q.latA},${q.lngA}],14)">📍 Pin A</button><button class="icon-btn go-btn" onclick="map.setView([${q.latB},${q.lngB}],14)">📍 Pin B</button></div><div id="hider-ans-${q.id}" class="answer-badge waiting">Place your hiding pin first…</div><button class="remove-btn" onclick="removeQuestion(${q.id})">✕ Remove</button></div>`;ql.appendChild(card);}

function checkHiderThermo(q){const _ahp=getActiveHiderPin();if(!_ahp)return;const hp=_ahp.getLatLng();const distA=map.distance([q.latA,q.lngA],[hp.lat,hp.lng]);const distB=map.distance([q.latB,q.lngB],[hp.lat,hp.lng]);const closer=distA<=distB?'A':'B';const el=document.getElementById(`hider-ans-${q.id}`);if(!el)return;q.closer=closer;el.className=closer==='A'?'answer-badge inside':'answer-badge outside';el.textContent=closer==='A'?`🟡 Closer to Pin A (${Math.round(distA)}m vs ${Math.round(distB)}m)`:`🟠 Closer to Pin B (${Math.round(distB)}m vs ${Math.round(distA)}m)`;redrawQuestionOverlay(q);}
function checkAllHiderThermos(){questions.filter(q=>q.hiderMode&&q.type==='thermo').forEach(q=>checkHiderThermo(q));}

function renderHiderRadarCard(q){const ql=document.getElementById('question-list');const rDisp=`${q.radius}${q.unit==='KM'?' km':' m'}`;const card=document.createElement('div');card.className='q-card radar';card.id=`q-card-${q.id}`;card.innerHTML=`<div class="q-card-header"><svg width="13" height="16" viewBox="0 0 34 40" style="flex-shrink:0"><path d="M17 38C17 38 2 22 2 13A15 15 0 0 1 32 13C32 22 17 38 17 38Z" fill="#ff9950" stroke="rgba(0,0,0,.25)" stroke-width="1.5"/><circle cx="17" cy="13" r="5.5" fill="rgba(255,255,255,.3)"/></svg><span class="q-title">Radar</span><span class="q-num">#${q.id}</span></div><div class="q-card-body"><div style="font-size:10px;color:var(--text2)">Radius: <span style="color:var(--radar);font-weight:500">${rDisp}</span></div><div class="coord-disp">Center: ${q.lat.toFixed(5)}, ${q.lng.toFixed(5)}</div><button class="icon-btn go-btn" style="margin-top:2px" onclick="map.setView([${q.lat},${q.lng}],14)">📍 Go to Radar Center</button><div id="hider-ans-${q.id}" class="answer-badge waiting">Place your hiding pin first…</div><button class="remove-btn" onclick="removeQuestion(${q.id})">✕ Remove</button></div>`;ql.appendChild(card);}

function checkHiderRadar(q){const _ahp=getActiveHiderPin();if(!_ahp)return;const hp=_ahp.getLatLng();const r=getRadiusMeters(q);if(!r)return;const dist=map.distance([q.lat,q.lng],[hp.lat,hp.lng]);const inside=dist<=r;const el=document.getElementById(`hider-ans-${q.id}`);if(!el)return;if(inside){el.className='answer-badge inside';el.textContent=`✅ Inside the radar (${Math.round(dist)}m from center)`;q.zone='inside';}else{el.className='answer-badge outside';el.textContent=`❌ Outside the radar (${Math.round(dist)}m from center)`;q.zone='outside';}if(outlineCircles[q.id]){map.removeLayer(outlineCircles[q.id]);delete outlineCircles[q.id];}redrawQuestionOverlay(q);}

function removeQuestion(id){const q=questions.find(x=>x.id===id);if(!q)return;if(q.marker)map.removeLayer(q.marker);if(q.markerA)map.removeLayer(q.markerA);if(q.markerB)map.removeLayer(q.markerB);if(outlineCircles[id]){map.removeLayer(outlineCircles[id]);delete outlineCircles[id];}if(typeof removeMatchingLocMarkers!=='undefined')removeMatchingLocMarkers(id);if(typeof removeAreaFeatures!=='undefined')removeAreaFeatures(id);if(typeof removeMeasuringLocMarkers!=='undefined')removeMeasuringLocMarkers(id);clearQuestionOverlay(id);questions=questions.filter(x=>x.id!==id);const card=document.getElementById(`q-card-${id}`);if(card)card.remove();showToast('Question removed');if(typeof saveState!=='undefined')saveState();}

function checkAllHiderRadars(){questions.filter(q=>q.hiderMode&&q.type==='radar').forEach(q=>checkHiderRadar(q));questions.filter(q=>q.hiderMode&&q.type==='thermo').forEach(q=>checkHiderThermo(q));questions.filter(q=>q.hiderMode&&q.type==='matching').forEach(q=>checkHiderMatching(q));questions.filter(q=>q.hiderMode&&q.type==='measuring').forEach(q=>checkHiderMeasuring(q));}


// ── MATCHING QUESTIONS ────────────────────────────────────────
// Format: seeker places their pin, picks subcategory, sees nearest location.
// Hider inputs code and app checks if THEIR nearest matches.
// Zone overlay: with 1 location → always Yes (no exclusion).
//               with n locations → Voronoi cell of matched location.

// Store map markers for subcategory locations: qId -> [L.circleMarker, ...]
const matchingLocMarkers = {};

function showMatchingLocMarkers(q) {
  removeMatchingLocMarkers(q.id);
  const allData = getAllMatchingData();
  const locs = allData[q.subcat] || [];
  // Skip markers for area types — too complex to show as dots
  if (locs.length && locs[0].type) { matchingLocMarkers[q.id] = []; return; }
  // Only show markers within current map bounds (+ 20% buffer) to avoid flooding
  const bounds = map.getBounds().pad(0.2);
  const visible = locs.filter(loc => bounds.contains(L.latLng(loc.lat, loc.lng)));
  // Cap at 50 markers max
  const toShow = visible.slice(0, 50);
  matchingLocMarkers[q.id] = toShow.map(loc => {
    const isNearest = loc.id === q.nearestId;
    const m = L.circleMarker([loc.lat, loc.lng], {
      radius: isNearest ? 9 : 5,
      fillColor: isNearest ? '#4ade80' : '#a3f0be',
      fillOpacity: isNearest ? 0.95 : 0.55,
      color: '#fff',
      weight: isNearest ? 2 : 1,
      opacity: 0.9,
      interactive: true
    }).bindTooltip(loc.name, { permanent: false, direction: 'top', className: 'train-tip' }).addTo(map);
    return m;
  });
  // Re-render when map moves so markers stay current
  if (!q._markerMoveHandler) {
    q._markerMoveHandler = () => { if (!q.locked && matchingLocMarkers[q.id]) showMatchingLocMarkers(q); };
    map.on('moveend zoomend', q._markerMoveHandler);
  }
}

function removeMatchingLocMarkers(id) {
  if (matchingLocMarkers[id]) {
    matchingLocMarkers[id].forEach(m => map.removeLayer(m));
    delete matchingLocMarkers[id];
  }
  // Remove move handler if present
  const q = questions.find(x => x.id === id);
  if (q && q._markerMoveHandler) {
    map.off('moveend zoomend', q._markerMoveHandler);
    q._markerMoveHandler = null;
  }
}

function addMatchingQuestion() {
  typePickerOpen = false;
  document.getElementById('type-picker').style.display = 'none';
  qCounter++;
  const id = qCounter;
  const center = map.getCenter();
  const allData = getAllMatchingData();
  const HIDDEN_MATCH2 = new Set(['River','SL Transit Line']);
  const subcats = Object.keys(allData).filter(s => !HIDDEN_MATCH2.has(s));
  const q = {
    id, type: 'matching',
    lat: center.lat, lng: center.lng,
    subcat: subcats[0],
    nearestId: null, nearestName: null,
    answer: 'pending', locked: false
  };
  questions.push(q);
  renderSeekerMatchingCard(q);
  placeSeekerMatchingPin(q);
  updateMatchingNearest(q);
  showMatchingLocMarkers(q);
  showAreaFeatures(q);
  if (!sidebarOpen) toggleSidebar();
}

function placeSeekerMatchingPin(q) {
  if (q.marker) map.removeLayer(q.marker);
  q.marker = L.marker([q.lat, q.lng], { icon: tearDropIcon('#4ade80', 32), draggable: !q.locked }).addTo(map);
  q.marker.on('dragend', e => {
    const p = e.target.getLatLng(); q.lat = p.lat; q.lng = p.lng;
    const coordEl = document.getElementById(`match-coord-${q.id}`);
    if (coordEl) coordEl.textContent = `${q.lat.toFixed(4)}, ${q.lng.toFixed(4)}`;
    updateMatchingNearest(q);
  });
}

function updateMatchingNearest(q) {
  const locations = (getAllMatchingData()[q.subcat]) || [];
  if (!locations.length) return;
  // Find nearest/containing location based on type
  let best = null;
  if (locations.length && locations[0].type === 'polygon') {
    best = findContainingArea(q.lng, q.lat, locations) || locations[0];
  } else if (locations.length && locations[0].type === 'polyline') {
    best = findNearestPolyline(q.lng, q.lat, locations);
  } else {
    // Point-based
    let bestDist = Infinity;
    for (const loc of locations) {
      const d = map.distance([q.lat, q.lng], [loc.lat, loc.lng]);
      if (d < bestDist) { bestDist = d; best = loc; }
    }
  }
  q.nearestId   = best ? best.id : null;
  q.nearestName = best ? best.name : '?';

  const el = document.getElementById(`match-nearest-${q.id}`);
  if (el) {
    el.textContent = best ? best.name : '—';
    const distEl = document.getElementById(`match-dist-${q.id}`);
    if (distEl) {
      if (!best) { distEl.textContent = ''; }
      else if (best.type === 'polygon') {
        const contained = pointInPolygon(q.lng, q.lat, best.rings);
        distEl.textContent = contained ? 'You are inside this area' : 'Nearest area (not inside)';
      } else if (best.type === 'polyline') {
        distEl.textContent = 'Nearest line';
      } else {
        const dist = map.distance([q.lat, q.lng], [best.lat, best.lng]);
        distEl.textContent = dist >= 1000 ? `${(dist/1000).toFixed(1)} km away` : `${Math.round(dist)} m away`;
      }
    }
  }
  // If only one location, auto-note that Yes is the only possible answer
  const noteEl = document.getElementById(`match-note-${q.id}`);
  if (noteEl) {
    noteEl.textContent = locations.length === 1
      ? 'Only one location in this category — answer must be Yes'
      : '';
  }
  // Refresh location dot markers to highlight new nearest
  if (!q.locked) showMatchingLocMarkers(q);
  if (!q.locked) showAreaFeatures(q);
  redrawQuestionOverlay(q);
}

function toggleMatchingVoronoi(id) {
  const q = questions.find(x => x.id === id);
  if (!q) return;
  q.showVoronoi = !q.showVoronoi;
  const btn = document.getElementById(`mvoronoi-btn-${id}`);
  if (btn) {
    btn.classList.toggle('locked', q.showVoronoi);
    btn.textContent = q.showVoronoi ? '🔲 Borders ON' : '🔲 Borders';
  }
  rebuildVoronoiLines();
}

function setMatchingSubcat(id, subcat) {
  const q = questions.find(x => x.id === id);
  q.subcat = subcat;
  updateMatchingNearest(q);
  if (!q.locked) { showMatchingLocMarkers(q); showAreaFeatures(q); }
}

function setMatchingAnswer(id, answer) {
  const q = questions.find(x => x.id === id);
  q.answer = answer;
  document.getElementById(`mpend-${id}`).className = 'zone-btn' + (answer==='pending' ? ' active-pend' : '');
  document.getElementById(`myes-${id}`).className  = 'zone-btn' + (answer==='yes'     ? ' active-in'   : '');
  document.getElementById(`mno-${id}`).className   = 'zone-btn' + (answer==='no'      ? ' active-out'  : '');
  redrawQuestionOverlay(q);
  if(typeof saveState!=='undefined')saveState();
}

function toggleMatchingLock(id) {
  const q = questions.find(x => x.id === id);
  q.locked = !q.locked;
  const btn = document.getElementById(`mlock-btn-${id}`);
  const rb  = document.getElementById(`remove-btn-${id}`);
  if (q.locked) {
    btn.textContent='🔓 Locked'; btn.classList.add('locked');
    if (q.marker) q.marker.dragging.disable();
    if (rb) { rb.disabled=true; rb.style.opacity='0.25'; rb.style.pointerEvents='none'; }
    removeMatchingLocMarkers(id);
    removeAreaFeatures(id);
    showToast(`Matching #${id} locked 🔒`); if(typeof saveState!=='undefined')saveState(); if(typeof applyHideLockedPins!=='undefined')applyHideLockedPins();
  } else {
    btn.textContent='🔒 Lock'; btn.classList.remove('locked');
    if (q.marker) q.marker.dragging.enable();
    if (rb) { rb.disabled=false; rb.style.opacity=''; rb.style.pointerEvents=''; }
    showMatchingLocMarkers(q);
    showAreaFeatures(q);
  }
}

function copyMatchingCode(id) {
  const q = questions.find(x => x.id === id);
  if (!q.nearestId) { showToast('Place your pin first'); return; }
  const code = `MAT-${encodeSubcat(q.subcat)}-${q.lat.toFixed(5)}-${q.lng.toFixed(5)}-${q.nearestId}`;
  const btn = document.getElementById(`mcopy-btn-${id}`);
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent='✅ Copied!';
    setTimeout(() => { btn.textContent='📋 Copy Question Code'; }, 2200);
  }).catch(() => showToast(code, 5000));
}

function encodeSubcat(s)  { return s.replace(/\s+/g,'_').toLowerCase(); }
function decodeSubcat(s)  { const sl = s.toLowerCase(); return Object.keys(getAllMatchingData()).find(k => encodeSubcat(k) === sl) || s; }

function renderSeekerMatchingCard(q) {
  const ql   = document.getElementById('question-list');
  const card = document.createElement('div');
  card.className = 'q-card matching'; card.id = `q-card-${q.id}`;
  const HIDDEN_MATCH = new Set(['River','SL Transit Line']);
  const subcats = Object.keys(getAllMatchingData()).filter(s => !HIDDEN_MATCH.has(s));
  const subcatOptions = subcats.map(s =>
    `<option value="${s}" ${s===q.subcat?'selected':''}>${s}</option>`
  ).join('');
  card.innerHTML = `
    <div class="q-card-header">
      <span style="font-size:14px">🔗</span>
      <span class="q-title">Matching</span>
      <span class="q-num">#${q.id}</span>
    </div>
    <div class="q-card-body">
      <div>
        <div class="q-label">Category</div>
        <select class="match-select" onchange="setMatchingSubcat(${q.id}, this.value)">${subcatOptions}</select>
      </div>
      <div class="q-label" style="margin-top:2px">Your position</div>
      <div id="match-coord-${q.id}" class="coord-disp">${q.lat.toFixed(4)}, ${q.lng.toFixed(4)}</div>
      <div style="display:flex;align-items:center;gap:8px;padding:2px 0">
        <span class="q-label" style="margin:0">My nearest:</span>
        <span id="match-nearest-${q.id}" style="font-size:11px;color:#4ade80;font-weight:500">—</span>
      </div>
      <div id="match-dist-${q.id}" class="coord-disp"></div>
      <div id="match-note-${q.id}" style="font-size:9px;color:var(--muted);font-style:italic"></div>
      <div class="icon-btns">
        <button class="icon-btn go-btn" onclick="map.setView([${q.lat},${q.lng}],14);if(sidebarOpen)toggleSidebar();" style="border-color:rgba(74,222,128,.3);color:#4ade80">📍 Go to Pin</button>
        <button class="icon-btn" onclick="setMyLocation_matching(${q.id})">📱 My Loc</button>
        <button class="icon-btn" id="mlock-btn-${q.id}" onclick="toggleMatchingLock(${q.id})">🔒 Lock</button>
        <button class="icon-btn" id="mvoronoi-btn-${q.id}" onclick="toggleMatchingVoronoi(${q.id})">🔲 Borders</button>
      </div>
      <div>
        <div class="q-label">Hider's answer</div>
        <div class="zone-toggle">
          <button class="zone-btn active-pend" id="mpend-${q.id}" onclick="setMatchingAnswer(${q.id},'pending')">⏳ TBD</button>
          <button class="zone-btn"             id="myes-${q.id}"  onclick="setMatchingAnswer(${q.id},'yes')">✅ Yes</button>
          <button class="zone-btn"             id="mno-${q.id}"   onclick="setMatchingAnswer(${q.id},'no')">❌ No</button>
        </div>
      </div>
      <button class="copy-btn" style="border-color:rgba(74,222,128,.35);color:#4ade80;background:rgba(74,222,128,.1)" id="mcopy-btn-${q.id}" onclick="copyMatchingCode(${q.id})">📋 Copy Question Code</button>
      <button class="remove-btn" id="remove-btn-${q.id}" onclick="removeQuestion(${q.id})">✕ Remove Question</button>
    </div>`;
  ql.appendChild(card);
}

// ── HIDER MATCHING ────────────────────────────────────────────

function renderHiderMatchingCard(q) {
  const ql   = document.getElementById('question-list');
  const card = document.createElement('div');
  card.className = 'q-card matching'; card.id = `q-card-${q.id}`;
  card.innerHTML = `
    <div class="q-card-header">
      <span style="font-size:14px">🔗</span>
      <span class="q-title">Matching</span>
      <span class="q-num">#${q.id}</span>
    </div>
    <div class="q-card-body">
      <div style="font-size:10px;color:var(--text2)">Category: <span style="color:#4ade80;font-weight:500">${q.subcat}</span></div>
      <div style="font-size:10px;color:var(--text2)">Seeker's nearest: <span style="color:#4ade80;font-weight:500">${q.nearestName}</span></div>
      <button class="icon-btn go-btn" style="margin-top:4px;border-color:rgba(74,222,128,.3);color:#4ade80" onclick="map.setView([${q.seekerLat},${q.seekerLng}],14)">📍 Seeker's Pin</button>
      <div id="hider-ans-${q.id}" class="answer-badge waiting">Place your hiding pin first…</div>
      <button class="remove-btn" onclick="removeQuestion(${q.id})">✕ Remove</button>
    </div>`;
  ql.appendChild(card);
}

function checkHiderMatching(q) {
  const _ahp = getActiveHiderPin(); if (!_ahp) return;
  const hp  = _ahp.getLatLng();
  const locs = (getAllMatchingData()[q.subcat]) || [];
  if (!locs.length) return;
  let best = null;
  if (locs[0].type === 'polygon') {
    best = findContainingArea(hp.lng, hp.lat, locs) || locs[0];
  } else if (locs[0].type === 'polyline') {
    best = findNearestPolyline(hp.lng, hp.lat, locs);
  } else {
    let bestDist = Infinity;
    for (const loc of locs) {
      const d = map.distance([hp.lat, hp.lng], [loc.lat, loc.lng]);
      if (d < bestDist) { bestDist = d; best = loc; }
    }
  }
  const match = best.id === q.nearestId;
  q.answer = match ? 'yes' : 'no';
  const el = document.getElementById(`hider-ans-${q.id}`);
  if (!el) return;
  if (match) {
    el.className = 'answer-badge inside';
    el.textContent = `✅ Yes — both nearest to ${best.name}`;
  } else {
    el.className = 'answer-badge outside';
    el.textContent = `❌ No — your nearest is ${best.name}`;
  }
  redrawQuestionOverlay(q);
}

function checkAllHiderMatching() {
  questions.filter(q => q.hiderMode && q.type === 'matching').forEach(q => checkHiderMatching(q));
}

// ── VORONOI BOUNDARY LINES ────────────────────────────────────

function ensureVoronoiSvg() {
  if (_voronoiSvg) return;
  _voronoiSvg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  _voronoiSvg.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;overflow:visible;';
  map.getPanes().overlayPane.appendChild(_voronoiSvg);
}

function rebuildVoronoiLines() {
  if (!map) return;
  const anyActive = questions.some(q => q.type === 'matching' && q.showVoronoi);
  if (!anyActive) { if (_voronoiSvg) _voronoiSvg.innerHTML=''; return; }
  ensureVoronoiSvg();
  _voronoiSvg.innerHTML = '';
  const bounds = map.getBounds().pad(0.3);
  const allData = getAllMatchingData();

  function addLine(x1,y1,x2,y2){
    const line=document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1',x1.toFixed(1)); line.setAttribute('y1',y1.toFixed(1));
    line.setAttribute('x2',x2.toFixed(1)); line.setAttribute('y2',y2.toFixed(1));
    line.setAttribute('stroke','#1a3a6e');
    line.setAttribute('stroke-width','3');
    line.setAttribute('opacity','0.8');
    _voronoiSvg.appendChild(line);
  }

  for (const q of questions) {
    if (q.type !== 'matching' || !q.showVoronoi) continue;
    const locs = allData[q.subcat] || [];
    if (locs.length <= 1) continue;
    const type0 = locs[0] && locs[0].type;

    if (type0 === 'polygon' || type0 === 'polyline') {
      // Area/polyline: draw edges of each loc's voronoiCell polygon
      const visibleLocs = locs.filter(loc => {
        if (!loc.voronoiCell || loc.voronoiCell.length < 3) return false;
        return loc.voronoiCell.some(([lng,lat]) => bounds.contains(L.latLng(lat,lng)));
      });
      for (const loc of visibleLocs) {
        const cell = loc.voronoiCell;
        for (let i=0; i<cell.length; i++) {
          const [lng1,lat1] = cell[i];
          const [lng2,lat2] = cell[(i+1)%cell.length];
          const p1 = map.latLngToLayerPoint(L.latLng(lat1,lng1));
          const p2 = map.latLngToLayerPoint(L.latLng(lat2,lng2));
          addLine(p1.x,p1.y,p2.x,p2.y);
        }
      }
    } else {
      // Point-based: draw bisector edges from Voronoi cell polygons
      const visibleLocs = locs.filter(loc => bounds.contains(L.latLng(loc.lat, loc.lng)));
      if (!visibleLocs.length) continue;
      const drawn = new Set();
      for (const locA of visibleLocs) {
        const cellA = voronoiCell(locA, locs);
        if (cellA.length < 3) continue;
        for (let i = 0; i < cellA.length; i++) {
          const [x1,y1] = cellA[i];
          const [x2,y2] = cellA[(i+1) % cellA.length];
          const emx=(x1+x2)/2, emy=(y1+y2)/2;
          const mPx = map.latLngToLayerPoint(L.latLng(locA.lat, locA.lng));
          let nearestOther = null, nearestD = Infinity;
          for (const locB of locs) {
            if (locB.id === locA.id) continue;
            const oPx = map.latLngToLayerPoint(L.latLng(locB.lat, locB.lng));
            const diff = Math.abs(Math.hypot(emx-mPx.x, emy-mPx.y) - Math.hypot(emx-oPx.x, emy-oPx.y));
            if (diff < nearestD) { nearestD = diff; nearestOther = locB; }
          }
          if (!nearestOther || nearestD > 20) continue;
          const edgeKey = [locA.id, nearestOther.id].sort().join('|') + '_' + i;
          if (drawn.has(edgeKey)) continue;
          drawn.add(edgeKey);
          addLine(x1,y1,x2,y2);
        }
      }
    }
  }
}


function getAllMatchingData() {
  const result = {};
  if (typeof MATCHING_DATA !== 'undefined')
    Object.assign(result, MATCHING_DATA);
  if (typeof MATCHING_AREA_DATA !== 'undefined')
    Object.assign(result, MATCHING_AREA_DATA);
  // Split Supermarket into IKEA and Coop sub-entries for matching
  if (result['Supermarket']) {
    result['IKEA'] = result['Supermarket'].filter(x =>
      x.name.toLowerCase().includes('ikea') || x.id.includes('ikea'));
    result['Coop'] = result['Supermarket'].filter(x =>
      x.name.toLowerCase().includes('coop') || x.id.includes('coop'));
    delete result['Supermarket'];
  }
  // Also rename Churches → Church for consistency with measuring
  if (result['Churches'] && !result['Church']) {
    result['Church'] = result['Churches'];
    delete result['Churches'];
  }
  return result;
}

// Point-in-polygon test (ray casting). coords = [[lng,lat], ...]
function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i=0, j=ring.length-1; i<ring.length; j=i++) {
    const xi=ring[i][0], yi=ring[i][1];
    const xj=ring[j][0], yj=ring[j][1];
    if (((yi>lat)!==(yj>lat)) && (lng < (xj-xi)*(lat-yi)/(yj-yi)+xi))
      inside = !inside;
  }
  return inside;
}

function pointInPolygon(lng, lat, rings) {
  // First ring = outer, subsequent = holes (even-odd via XOR)
  if (!rings.length) return false;
  let inside = pointInRing(lng, lat, rings[0]);
  for (let i=1; i<rings.length; i++)
    if (pointInRing(lng, lat, rings[i])) inside = !inside;
  return inside;
}

// Find which area feature contains the point
function findContainingArea(lng, lat, locs) {
  for (const loc of locs) {
    if (loc.type === 'polygon') {
      if (pointInPolygon(lng, lat, loc.rings)) return loc;
    }
  }
  return null;
}

// Find nearest polyline feature to a point
function findNearestPolyline(lng, lat, locs) {
  let best = null, bestDist = Infinity;
  for (const loc of locs) {
    if (loc.type !== 'polyline') continue;
    for (const seg of (loc.segments || [])) {
      for (let i=0; i<seg.length-1; i++) {
        const [ax,ay] = seg[i], [bx,by] = seg[i+1];
        const dx=bx-ax, dy=by-ay;
        const t = dx||dy ? Math.max(0,Math.min(1,((lng-ax)*dx+(lat-ay)*dy)/(dx*dx+dy*dy))) : 0;
        const d = Math.hypot(lng-(ax+t*dx), lat-(ay+t*dy));
        if (d < bestDist) { bestDist=d; best=loc; }
      }
    }
  }
  return best;
}

// Find nearest or containing location for any category
function findMatchingArea(lng, lat, locs) {
  if (!locs.length) return null;
  const type0 = locs[0].type;
  if (type0 === 'polygon') return findContainingArea(lng, lat, locs) || locs[0];
  if (type0 === 'polyline') return findNearestPolyline(lng, lat, locs);
  return null;
}

// ── Overlay for polygon areas ──────────────────────────────────
// "Yes" = hider inside same polygon → fill outside blue (world - polygon hole)
// "No"  = hider in different polygon → fill that polygon blue
// Uses a separate SVG path element so it doesn't interfere with validPoly clipping


// ── AREA FEATURE DISPLAY LAYERS ───────────────────────────────
// Show polygons/polylines on the map when a matching question uses them
const _areaLayers = {}; // qId -> array of L.layer

function showAreaFeatures(q) {
  removeAreaFeatures(q.id);
  const locs = getAllMatchingData()[q.subcat] || [];
  if (!locs.length || !locs[0].type) return;
  const layers = [];
  const matchedId = q.nearestId;

  for (const loc of locs) {
    const isNearest = loc.id === matchedId;
    if (loc.type === 'polygon') {
      // Convert [lng,lat] rings to Leaflet [lat,lng]
      const latLngs = loc.rings.map(ring =>
        ring.map(([lng, lat]) => [lat, lng])
      );
      const poly = L.polygon(latLngs, {
        color: isNearest ? '#4ade80' : '#a3f0be',
        weight: isNearest ? 2.5 : 1.5,
        fill: isNearest,
        fillColor: '#4ade80',
        fillOpacity: isNearest ? 0.12 : 0,
        opacity: isNearest ? 0.9 : 0.5,
        interactive: true
      }).bindTooltip(loc.name, { permanent: false, direction: 'center', className: 'train-tip' })
        .addTo(map);
      layers.push(poly);
    } else if (loc.type === 'polyline') {
      const lineColor = loc.colour || '#4488cc'; // default blue for rivers etc.
      let tooltipAdded = false;
      for (const seg of (loc.segments || [])) {
        const latLngs = seg.map(([lng, lat]) => [lat, lng]);
        const line = L.polyline(latLngs, {
          color: lineColor,
          weight: isNearest ? 4 : 2,
          opacity: isNearest ? 0.95 : 0.35,
          interactive: true
        }).addTo(map);
        if (!tooltipAdded) {
          line.bindTooltip(loc.name, { permanent: false, direction: 'center', className: 'train-tip' });
          tooltipAdded = true;
        }
        layers.push(line);
      }
    }
  }
  _areaLayers[q.id] = layers;
}

function removeAreaFeatures(id) {
  if (_areaLayers[id]) {
    _areaLayers[id].forEach(l => map.removeLayer(l));
    delete _areaLayers[id];
  }
}

function refreshAreaFeatures(q) {
  if (!q.locked) showAreaFeatures(q);
}

// ── MEASURING QUESTION ────────────────────────────────────────────────────────
// "Compared to me, are you closer or further from [nearest X]?"
// Seeker records distance R to nearest of chosen type.
// Closer: hider inside at least one circle of radius R → circles white, outside blue.
// Further: hider outside all circles → circles blue, outside white.

// ── Overlay SVG ───────────────────────────────────────────────────────────────

// ── Nearest finder ────────────────────────────────────────────────────────────
function findNearestMeasuringLoc(lat, lng, subcat) {
  const locs = getMeasuringLocs(subcat);
  if (!locs.length) return { loc: null, dist: 0 };
  let best = null, bestDist = Infinity;
  for (const loc of locs) {
    const d = map.distance([lat, lng], [loc.lat, loc.lng]);
    if (d < bestDist) { bestDist = d; best = loc; }
  }
  return { loc: best, dist: Math.round(bestDist) };
}

// ── Show location markers for measuring ───────────────────────────────────────
const _measLayers = {};

function showMeasuringLocMarkers(q) {
  removeMeasuringLocMarkers(q.id);
  const locs = getMeasuringLocs(q.subcat);
  if (!locs.length) return;
  const bounds = map.getBounds().pad(0.3);
  const visible = locs.filter(loc => bounds.contains(L.latLng(loc.lat, loc.lng)));
  const layers = visible.slice(0, 60).map(loc => {
    const isNearest = loc.id === q.nearestId;
    return L.circleMarker([loc.lat, loc.lng], {
      radius: isNearest ? 9 : 5,
      fillColor: isNearest ? '#06b6d4' : '#67e8f9',
      fillOpacity: isNearest ? 0.95 : 0.55,
      color: '#fff', weight: isNearest ? 2 : 1, opacity: 0.9
    }).bindTooltip(loc.name, { permanent: false, direction: 'top', className: 'train-tip' }).addTo(map);
  });
  _measLayers[q.id] = layers;
  if (!q._measMoveHandler) {
    q._measMoveHandler = () => { if (!q.locked) showMeasuringLocMarkers(q); };
    map.on('moveend zoomend', q._measMoveHandler);
  }
}

function removeMeasuringLocMarkers(id) {
  if (_measLayers[id]) { _measLayers[id].forEach(l => map.removeLayer(l)); delete _measLayers[id]; }
  const q = questions.find(x => x.id === id);
  if (q && q._measMoveHandler) { map.off('moveend zoomend', q._measMoveHandler); q._measMoveHandler = null; }
}

// ── Seeker card ───────────────────────────────────────────────────────────────
function addMeasuringQuestion() {
  typePickerOpen = false;
  document.getElementById('type-picker').style.display = 'none';
  qCounter++;
  const id = qCounter;
  const center = map.getCenter();
  const subcats = typeof MEASURING_SUBCATS !== 'undefined' ? MEASURING_SUBCATS : ['Park'];
  const q = {
    id, type: 'measuring',
    lat: center.lat, lng: center.lng,
    subcat: subcats[0],
    nearestId: null, nearestName: null, seekerDist: 0,
    answer: 'pending', locked: false
  };
  questions.push(q);
  renderSeekerMeasuringCard(q);
  placeSeekerMeasuringPin(q);
  updateMeasuringNearest(q);
  showMeasuringLocMarkers(q);
  if (!sidebarOpen) toggleSidebar();
}

function placeSeekerMeasuringPin(q) {
  if (q.marker) map.removeLayer(q.marker);
  q.marker = L.marker([q.lat, q.lng], { icon: tearDropIcon('#06b6d4', 32), draggable: !q.locked }).addTo(map);
  q.marker.on('dragend', e => {
    const p = e.target.getLatLng(); q.lat = p.lat; q.lng = p.lng;
    const el = document.getElementById(`meas-coord-${q.id}`);
    if (el) el.textContent = `${q.lat.toFixed(4)}, ${q.lng.toFixed(4)}`;
    updateMeasuringNearest(q);
  });
}

function updateMeasuringNearest(q) {
  const { loc, dist } = findNearestMeasuringLoc(q.lat, q.lng, q.subcat);
  q.nearestId = loc ? loc.id : null;
  q.nearestName = loc ? loc.name : '—';
  q.seekerDist = dist;
  const nEl = document.getElementById(`meas-nearest-${q.id}`);
  if (nEl) nEl.textContent = loc ? loc.name : '—';
  const dEl = document.getElementById(`meas-dist-${q.id}`);
  if (dEl) dEl.textContent = dist >= 1000 ? `${(dist/1000).toFixed(2)} km` : `${dist} m`;
  if (!q.locked) showMeasuringLocMarkers(q);
  redrawQuestionOverlay();
}

function setMeasuringSubcat(id, subcat) {
  const q = questions.find(x => x.id === id);
  q.subcat = subcat;
  updateMeasuringNearest(q);
}

function setMeasuringAnswer(id, answer) {
  const q = questions.find(x => x.id === id);
  q.answer = answer;
  document.getElementById(`mpend-meas-${id}`).className = 'zone-btn' + (answer==='pending' ? ' active-pend' : '');
  document.getElementById(`mcloser-${id}`).className   = 'zone-btn' + (answer==='closer'  ? ' active-in'   : '');
  document.getElementById(`mfurther-${id}`).className  = 'zone-btn' + (answer==='further' ? ' active-out'  : '');
  redrawQuestionOverlay();
  if(typeof saveState!=='undefined')saveState();
}

function toggleMeasuringLock(id) {
  const q = questions.find(x => x.id === id);
  q.locked = !q.locked;
  const btn = document.getElementById(`measlock-btn-${id}`);
  const rb  = document.getElementById(`remove-btn-${id}`);
  if (q.locked) {
    btn.textContent='🔓 Locked'; btn.classList.add('locked');
    if (q.marker) q.marker.dragging.disable();
    if (rb) { rb.disabled=true; rb.style.opacity='0.25'; rb.style.pointerEvents='none'; }
    removeMeasuringLocMarkers(id);
    showToast(`Measuring #${id} locked 🔒`); if(typeof saveState!=='undefined')saveState(); if(typeof applyHideLockedPins!=='undefined')applyHideLockedPins();
  } else {
    btn.textContent='🔒 Lock'; btn.classList.remove('locked');
    if (q.marker) q.marker.dragging.enable();
    if (rb) { rb.disabled=false; rb.style.opacity=''; rb.style.pointerEvents=''; }
    showMeasuringLocMarkers(q);
  }
}

function copyMeasuringCode(id) {
  const q = questions.find(x => x.id === id);
  if (!q.nearestId) { showToast('Place your pin first'); return; }
  const code = `MEA-${encodeSubcat(q.subcat)}-${q.lat.toFixed(5)}-${q.lng.toFixed(5)}-${q.nearestId}-${q.seekerDist}`;
  const btn = document.getElementById(`meascopy-btn-${id}`);
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = '✅ Copied!';
    setTimeout(() => { btn.textContent = '📋 Copy Question Code'; }, 2200);
  }).catch(() => showToast(code, 5000));
}

function renderSeekerMeasuringCard(q) {
  const ql = document.getElementById('question-list');
  const card = document.createElement('div');
  card.className = 'q-card measuring'; card.id = `q-card-${q.id}`;
  const subcats = typeof MEASURING_SUBCATS !== 'undefined' ? MEASURING_SUBCATS : ['Park'];
  const opts = subcats.map(s => `<option value="${s}" ${s===q.subcat?'selected':''}>${s}</option>`).join('');
  card.innerHTML = `
    <div class="q-card-header">
      <span style="font-size:14px">📏</span>
      <span class="q-title">Measuring</span>
      <span class="q-num">#${q.id}</span>
    </div>
    <div class="q-card-body">
      <div>
        <div class="q-label">Category</div>
        <select class="match-select" onchange="setMeasuringSubcat(${q.id}, this.value)">${opts}</select>
      </div>
      <div class="q-label" style="margin-top:4px">Your position</div>
      <div id="meas-coord-${q.id}" class="coord-disp">${q.lat.toFixed(4)}, ${q.lng.toFixed(4)}</div>
      <div style="display:flex;align-items:center;gap:8px;padding:3px 0">
        <span class="q-label" style="margin:0">My nearest:</span>
        <span id="meas-nearest-${q.id}" style="font-size:11px;color:#06b6d4;font-weight:500">—</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="q-label" style="margin:0">My distance:</span>
        <span id="meas-dist-${q.id}" style="font-size:11px;color:#06b6d4;font-weight:500">—</span>
      </div>
      <div class="icon-btns">
        <button class="icon-btn go-btn" onclick="map.setView([${q.lat},${q.lng}],14);if(sidebarOpen)toggleSidebar();" style="border-color:rgba(6,182,212,.3);color:#06b6d4">📍 Go to Pin</button>
        <button class="icon-btn" onclick="setMyLocation_measuring(${q.id})">📱 My Loc</button>
        <button class="icon-btn" id="measlock-btn-${q.id}" onclick="toggleMeasuringLock(${q.id})">🔒 Lock</button>
      </div>
      <div>
        <div class="q-label">Hider is…</div>
        <div class="zone-toggle">
          <button class="zone-btn active-pend" id="mpend-meas-${q.id}" onclick="setMeasuringAnswer(${q.id},'pending')">⏳ TBD</button>
          <button class="zone-btn"             id="mcloser-${q.id}"    onclick="setMeasuringAnswer(${q.id},'closer')">🟢 Closer</button>
          <button class="zone-btn"             id="mfurther-${q.id}"   onclick="setMeasuringAnswer(${q.id},'further')">🔴 Further</button>
        </div>
      </div>
      <button class="copy-btn" style="border-color:rgba(6,182,212,.35);color:#06b6d4;background:rgba(6,182,212,.1)" id="meascopy-btn-${q.id}" onclick="copyMeasuringCode(${q.id})">📋 Copy Question Code</button>
      <button class="remove-btn" id="remove-btn-${q.id}" onclick="removeQuestion(${q.id})">✕ Remove Question</button>
    </div>`;
  ql.appendChild(card);
}

// ── Hider side ────────────────────────────────────────────────────────────────
function renderHiderMeasuringCard(q) {
  const ql = document.getElementById('question-list');
  const card = document.createElement('div');
  card.className = 'q-card measuring'; card.id = `q-card-${q.id}`;
  const distStr = q.seekerDist >= 1000 ? `${(q.seekerDist/1000).toFixed(2)} km` : `${q.seekerDist} m`;
  card.innerHTML = `
    <div class="q-card-header">
      <span style="font-size:14px">📏</span>
      <span class="q-title">Measuring</span>
      <span class="q-num">#${q.id}</span>
    </div>
    <div class="q-card-body">
      <div style="font-size:10px;color:var(--text2)">Category: <span style="color:#06b6d4;font-weight:500">${q.subcat}</span></div>
      <div style="font-size:10px;color:var(--text2)">Seeker nearest: <span style="color:#06b6d4;font-weight:500">${q.nearestName}</span></div>
      <div style="font-size:10px;color:var(--text2)">Seeker distance: <span style="color:#06b6d4;font-weight:500">${distStr}</span></div>
      <button class="icon-btn go-btn" style="margin-top:4px;border-color:rgba(6,182,212,.3);color:#06b6d4" onclick="map.setView([${q.seekerLat},${q.seekerLng}],14)">📍 Seeker's Pin</button>
      <div id="hider-ans-${q.id}" class="answer-badge waiting">${getActiveHiderPin() ? '⏳ Calculating…' : 'Place your hiding pin first…'}</div>
      <button class="remove-btn" onclick="removeQuestion(${q.id})">✕ Remove</button>
    </div>`;
  ql.appendChild(card);
}

function checkHiderMeasuring(q) {
  const _ahp = getActiveHiderPin(); if (!_ahp) return;
  const hp = _ahp.getLatLng();
  const { loc, dist } = findNearestMeasuringLoc(hp.lat, hp.lng, q.subcat);
  if (!loc) {
    const el = document.getElementById(`hider-ans-${q.id}`);
    if (el) { el.className = 'answer-badge waiting'; el.textContent = 'No locations found for this category'; }
    return;
  }
  const el = document.getElementById(`hider-ans-${q.id}`); if (!el) return;
  const closer = dist < q.seekerDist;
  q.answer = closer ? 'closer' : 'further';
  const hiderDistStr = dist >= 1000 ? `${(dist/1000).toFixed(2)} km` : `${dist} m`;
  const seekerDistStr = q.seekerDist >= 1000 ? `${(q.seekerDist/1000).toFixed(2)} km` : `${q.seekerDist} m`;
  if (closer) {
    el.className = 'answer-badge inside';
    el.textContent = `🟢 Closer — ${hiderDistStr} to ${loc.name} (seeker: ${seekerDistStr})`;
  } else {
    el.className = 'answer-badge outside';
    el.textContent = `🔴 Further — ${hiderDistStr} to ${loc.name} (seeker: ${seekerDistStr})`;
  }
  redrawQuestionOverlay();
}

function checkAllHiderMeasuring() {
  questions.filter(q => q.hiderMode && q.type === 'measuring').forEach(q => checkHiderMeasuring(q));
}

// ── Decode ────────────────────────────────────────────────────────────────────
function decodeMeasuring(rawOrig) {
  const m = rawOrig.match(/^MEA-([^-]+)-([\-\d.]+)-([\-\d.]+)-([^-]+)-(\d+)$/i);
  if (!m) return false;
  const subcat = decodeSubcat(m[1].toLowerCase());
  const seekerLat = parseFloat(m[2]), seekerLng = parseFloat(m[3]);
  const nearestId = m[4].toLowerCase();
  const seekerDist = parseInt(m[5]);
  const locs = getMeasuringLocs(subcat);
  const loc = locs.find(x => x.id === nearestId) || { name: nearestId };
  qCounter++;
  const q = {
    id: qCounter, type: 'measuring', subcat,
    seekerLat, seekerLng, nearestId, nearestName: loc.name,
    seekerDist, answer: 'pending', locked: true, hiderMode: true
  };
  questions.push(q);
  renderHiderMeasuringCard(q);
  checkHiderMeasuring(q);
  showMeasuringLocMarkers(q);
  map.setView([seekerLat, seekerLng], 13);
  document.getElementById('hider-code-field').value = '';
  showToast('Measuring question added!');
  return true;
}

// ── ENDGAME ───────────────────────────────────────────────────────────────────
function addEndgameCard() {
  // Only one endgame card at a time
  if (document.getElementById('endgame-card')) {
    showToast('Endgame location already added');
    return;
  }

  const ql = document.getElementById('question-list');
  const card = document.createElement('div');
  card.id = 'endgame-card';
  card.className = 'q-card hide-loc';
  card.style.borderColor = 'rgba(232,85,122,.5)';
  card.style.background = 'rgba(232,85,122,.07)';
  card.innerHTML = `
    <div class="q-card-header" style="background:rgba(232,85,122,.12)">
      <svg width="14" height="16" viewBox="0 0 34 40" style="flex-shrink:0"><path d="M17 38C17 38 2 22 2 13A15 15 0 0 1 32 13C32 22 17 38 17 38Z" fill="#e8557a" stroke="rgba(0,0,0,.25)" stroke-width="1.5"/><circle cx="17" cy="13" r="5.5" fill="rgba(255,255,255,.3)"/></svg>
      <span class="q-title" style="color:#e8557a">🏁 Endgame Spot</span>
    </div>
    <div class="q-card-body">
      <div class="q-label">Tap the map to place your endgame pin</div>
      <div id="endgame-pin-coords" class="coord-disp">Not placed yet</div>
      <div class="icon-btns">
        <button class="icon-btn go-btn" id="endgame-goto-btn" onclick="goToEndgamePin()" style="border-color:rgba(232,85,122,.4);color:#e8557a" disabled>📍 Go to Pin</button>
        <button class="icon-btn" id="endgame-lock-btn" onclick="toggleEndgameLock()" disabled>🔒 Lock</button>
      </div>
      <div id="endgame-status" class="answer-badge waiting" style="margin-top:4px">Place your endgame pin on the map…</div>
    </div>`;
  ql.appendChild(card);

  // Switch map click to place endgame pin
  map.off('click', onMapClick);
  map.on('click', onEndgameMapClick);
  showToast('Tap the map to place your endgame location');
}

function onEndgameMapClick(e) {
  placeEndgamePin(e.latlng.lat, e.latlng.lng);
}

function placeEndgamePin(lat, lng) {
  if (endgamePinLocked) return;
  if (endgamePin) map.removeLayer(endgamePin);

  endgamePin = L.marker([lat, lng], {
    icon: tearDropIcon('#e8557a', 36),
    draggable: true
  }).addTo(map);

  endgamePin.on('dragend', e => {
    if (endgamePinLocked) return;
    const p = e.target.getLatLng();
    updateEndgameCoords(p.lat, p.lng);
    checkAllHiderRadars();
  });

  updateEndgameCoords(lat, lng);

  // Restore normal hider map click
  map.off('click', onEndgameMapClick);
  map.on('click', onMapClick);

  // Enable buttons
  const gotoBtn = document.getElementById('endgame-goto-btn');
  const lockBtn = document.getElementById('endgame-lock-btn');
  if (gotoBtn) gotoBtn.disabled = false;
  if (lockBtn) lockBtn.disabled = false;

  // Re-run all checks with new endgame pin
  checkAllHiderRadars();
  if (typeof saveState !== 'undefined') saveState();
}

function updateEndgameCoords(lat, lng) {
  const el = document.getElementById('endgame-pin-coords');
  if (el) el.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  const status = document.getElementById('endgame-status');
  if (status) {
    status.className = 'answer-badge inside';
    status.textContent = `🏁 Endgame location set — all questions now answer from here`;
  }
}

function goToEndgamePin() {
  if (endgamePin) map.setView(endgamePin.getLatLng(), 15);
}

function toggleEndgameLock() {
  endgamePinLocked = !endgamePinLocked;
  const btn = document.getElementById('endgame-lock-btn');
  if (endgamePinLocked) {
    if (btn) { btn.textContent = '🔓 Locked'; btn.classList.add('locked'); }
    if (endgamePin) endgamePin.dragging.disable();
    showToast('Endgame location locked 🔒');
    if (typeof applyHideLockedPins !== 'undefined') applyHideLockedPins();
  } else {
    if (btn) { btn.textContent = '🔒 Lock'; btn.classList.remove('locked'); }
    if (endgamePin) endgamePin.dragging.enable();
    if (typeof applyHideLockedPins !== 'undefined') applyHideLockedPins();
  }
  if (typeof saveState !== 'undefined') saveState();
}

// ── SEEKER DECODE (paste hider answer codes) ──────────────────────────────────
// Hider copies a code from their question card — seeker pastes it here.
// The code format is the same as what seeker generates, so we parse it and
// find the matching existing seeker question to apply the answer to.

function seekerDecodeAndAdd() {
  const field = document.getElementById('seeker-code-field');
  if (!field) return;
  const raw = field.value.trim();
  if (!raw) return;

  const upper = raw.toUpperCase().replace(/\s/g, '');

  // ── RADAR ─────────────────────────────────────────────────────────────────
  const radarMatch = upper.match(/^RAD-([\-\d.]+)-([\-\d.]+)-(\d+\.?\d*)(KM|M)$/);
  if (radarMatch) {
    const lat = parseFloat(radarMatch[1]), lng = parseFloat(radarMatch[2]);
    const rad = radarMatch[3], unit = radarMatch[4];
    // Find matching radar question
    const q = questions.find(x =>
      x.type === 'radar' && !x.hiderMode &&
      Math.abs(x.lat - lat) < 0.0001 && Math.abs(x.lng - lng) < 0.0001
    );
    if (!q) { showToast('No matching Radar question found'); return; }
    // Determine answer: the seeker now knows where the hider answered from
    // But a radar code alone doesn't carry the answer — it's the question code
    // We need the hider to have answered it. The hider answer is embedded in
    // the fact that they sent it, but the answer itself (inside/outside) needs
    // to be inferred or is part of an extended code.
    // For now just show the question on map and prompt the seeker to set zone.
    map.setView([lat, lng], 14);
    showToast(`Radar #${q.id} found — set Inside/Outside from the card`);
    if (!sidebarOpen) toggleSidebar();
    field.value = '';
    return;
  }

  // ── THERMOMETER ───────────────────────────────────────────────────────────
  const thermoMatch = upper.match(/^THM-([\-\d.]+)-([\-\d.]+)-([\-\d.]+)-([\-\d.]+)$/);
  if (thermoMatch) {
    const latA = parseFloat(thermoMatch[1]), lngA = parseFloat(thermoMatch[2]);
    const latB = parseFloat(thermoMatch[3]), lngB = parseFloat(thermoMatch[4]);
    const q = questions.find(x =>
      x.type === 'thermo' && !x.hiderMode &&
      Math.abs(x.latA - latA) < 0.0001 && Math.abs(x.lngA - lngA) < 0.0001
    );
    if (!q) { showToast('No matching Thermometer question found'); return; }
    map.setView([(latA+latB)/2, (lngA+lngB)/2], 13);
    showToast(`Thermometer #${q.id} found — set A/B from the card`);
    if (!sidebarOpen) toggleSidebar();
    field.value = '';
    return;
  }

  // ── MATCHING ──────────────────────────────────────────────────────────────
  // Format: MAT-{subcat}-{seekerLat}-{seekerLng}-{nearestId}
  // The hider sends back the same code the seeker generated — it contains
  // whether they matched (same nearestId) or not, but not explicitly yes/no.
  // We decode it and match it to the existing seeker question,
  // then auto-compute yes/no based on whether nearestIds match.
  const matchMatch = raw.match(/^MAT-([^-]+)-([\-\d.]+)-([\-\d.]+)-([^-]+)$/i);
  if (matchMatch) {
    const subcat = decodeSubcat(matchMatch[1].toLowerCase());
    const seekerLat = parseFloat(matchMatch[2]), seekerLng = parseFloat(matchMatch[3]);
    const nearestId = matchMatch[4].toLowerCase();
    const q = questions.find(x =>
      x.type === 'matching' && !x.hiderMode &&
      Math.abs(x.lat - seekerLat) < 0.0001 && Math.abs(x.lng - seekerLng) < 0.0001
    );
    if (!q) { showToast('No matching Matching question found'); return; }
    const answer = (nearestId === (q.nearestId || '').toLowerCase()) ? 'yes' : 'no';
    setMatchingAnswer(q.id, answer);
    showToast(`Matching #${q.id}: ${answer === 'yes' ? '✅ Yes — same nearest' : '❌ No — different nearest'}`);
    if (!sidebarOpen) toggleSidebar();
    field.value = '';
    if(typeof saveState!=='undefined') saveState();
    return;
  }

  // ── MEASURING ─────────────────────────────────────────────────────────────
  // Format: MEA-{subcat}-{seekerLat}-{seekerLng}-{nearestId}-{seekerDist}
  // The hider's answer (closer/further) isn't in the code — this is the seeker's
  // OWN code they generated. When the hider sends it back it means "I answered this".
  // We need a different approach: the hider should send closer/further explicitly.
  // Support: MEA-{subcat}-{seekerLat}-{seekerLng}-{nearestId}-{seekerDist}-CLOSER
  //       or MEA-{subcat}-{seekerLat}-{seekerLng}-{nearestId}-{seekerDist}-FURTHER
  const measMatch = raw.match(/^MEA-([^-]+)-([\-\d.]+)-([\-\d.]+)-([^-]+)-(\d+)(?:-(CLOSER|FURTHER))?$/i);
  if (measMatch) {
    const subcat = decodeSubcat(measMatch[1].toLowerCase());
    const seekerLat = parseFloat(measMatch[2]), seekerLng = parseFloat(measMatch[3]);
    const seekerDist = parseInt(measMatch[5]);
    const answerHint = measMatch[6] ? measMatch[6].toLowerCase() : null;
    const q = questions.find(x =>
      x.type === 'measuring' && !x.hiderMode &&
      Math.abs(x.lat - seekerLat) < 0.0001 && Math.abs(x.lng - seekerLng) < 0.0001
    );
    if (!q) { showToast('No matching Measuring question found'); return; }
    if (answerHint) {
      setMeasuringAnswer(q.id, answerHint);
      showToast(`Measuring #${q.id}: ${answerHint === 'closer' ? '🟢 Closer' : '🔴 Further'}`);
    } else {
      showToast(`Measuring #${q.id} found — set Closer/Further from the card`);
    }
    if (!sidebarOpen) toggleSidebar();
    field.value = '';
    if(typeof saveState!=='undefined') saveState();
    return;
  }

  showToast('Could not match code to any question');
}
