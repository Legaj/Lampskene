// curses.js — Curse Panel for Jetlag Stockholm
// Seeker: browse & search only | Hider: full deck management

// ── STATE ─────────────────────────────────────────────────────────────────────
let _CURSES = null;
let _cpOpen = false;
let _cpTab  = 'deck';   // 'deck' | 'browse'
let _cpDeck = [];       // array of curse IDs (hider only)
let _cpLocked = true;
let _cpHistory = [];
let _cpExpanded = new Set(); // expanded item IDs (browse panel)
let _cpDeckExpanded = new Set(); // expanded deck indices
let _cpCollapseExtra = true; // collapse extra info by default

// ── NEW: deck compact-info toggles ───────────────────────────────────────────
let _cpShowStops = true;   // show stops-question + inform badge when collapsed (default ON)
let _cpShowCost  = false;  // show casting cost when collapsed (default OFF)

const _CP_SAVE_KEY = 'jetlag_curses_v1';

function _cpParseCsvRows(text) {
  const rows = [];
  let row = [], cell = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (inQuotes && ch === '"' && next === '"') { cell += '"'; i++; continue; }
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (!inQuotes && ch === ',') { row.push(cell); cell = ''; continue; }
    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && next === '\n') i++;
      row.push(cell);
      if (row.some(v => v !== '')) rows.push(row);
      row = []; cell = '';
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  if (row.some(v => v !== '')) rows.push(row);
  return rows;
}

function _cpNormalizeCurse(row) {
  const stopsValue = String(row.stopsQuestion || '').toLowerCase();
  const questionEffect = row.questionEffect || (stopsValue === 'yes' ? 'Stops Question' : stopsValue === 'no' ? 'Allows Question' : row.stopsQuestion || 'Hinders Asking');
  return Object.assign({}, row, {
    id:parseInt(row.id, 10),
    questionEffect,
    informSeekers:String(row.informSeekers || '').toLowerCase() === 'true' ? 'True' : 'False'
  });
}

function _cpParseCursesCsv(text) {
  const rows = _cpParseCsvRows(text);
  const headers = rows.shift() || [];
  return rows.map(values => {
    const row = {};
    headers.forEach((key, idx) => row[key] = values[idx] || '');
    return _cpNormalizeCurse(row);
  }).filter(c => Number.isFinite(c.id));
}

// ── LOAD ──────────────────────────────────────────────────────────────────────
async function _cpLoad(force=false) {
  if (_CURSES && !force) return true;
  try {
    const r = await fetch('curses.csv?v=' + Date.now(), { cache:'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    _CURSES = _cpParseCursesCsv(await r.text());
    _cpRestoreState();
    _cpSyncDeckToCurses();
    return true;
  } catch (e) {
    showToast('Could not load curses.csv - ' + e.message);
    return false;
  }
}

// ── TOGGLE ────────────────────────────────────────────────────────────────────
async function toggleCursePanel() {
  if (_cpOpen) { _cpClose(); return; }
  const ok = await _cpLoad(true);
  if (!ok) return;
  document.getElementById('settings-panel')?.classList.remove('open');
  document.getElementById('settings-btn')?.classList.remove('open');
  _cpOpen = true;
  document.getElementById('curse-panel').classList.add('open');
  document.getElementById('curse-btn').classList.add('open');
  document.getElementById('mnav-curses-btn')?.classList.add('mnav-open');
  _cpRender();
}

function _cpClose() {
  _cpOpen = false;
  document.getElementById('curse-panel').classList.remove('open');
  document.getElementById('curse-btn').classList.remove('open');
  document.getElementById('mnav-curses-btn')?.classList.remove('mnav-open');
}

document.addEventListener('click', function(e) {
  if (!_cpOpen) return;
  const panel = document.getElementById('curse-panel');
  const btn   = document.getElementById('curse-btn');
  const mbtn  = document.getElementById('mnav-curses-btn');
  const fab   = document.getElementById('curse-fab');
  if (panel && btn && !panel.contains(e.target) && !btn.contains(e.target) && !(mbtn && mbtn.contains(e.target)) && !(fab && fab.contains(e.target))) {
    _cpClose();
  }
}, true);

// ── RENDER PANEL ─────────────────────────────────────────────────────────────
function _cpRender() {
  if (!_CURSES) return;
  const isHider = (typeof mode !== 'undefined' && mode === 'hider');

  const tabs      = document.getElementById('cp-tabs');
  const deckStats = document.getElementById('cp-deck-stats');
  const searchWrap= document.getElementById('cp-search-wrap');
  const quickAdd  = document.getElementById('cp-quick-add');

  if (!isHider) {
    _cpTab = 'browse';
    tabs.style.display       = 'none';
    deckStats.style.display  = 'none';
    searchWrap.style.display = 'block';
    if (quickAdd) quickAdd.style.display = 'none';
    const headerNote = document.getElementById('cp-seeker-note');
    if (headerNote) headerNote.style.display = 'block';

    // Render deck-options bar hidden for seeker
    const optBar = document.getElementById('cp-deck-options');
    if (optBar) optBar.style.display = 'none';

    _cpRenderBrowse();
    return;
  }

  const headerNote = document.getElementById('cp-seeker-note');
  if (headerNote) headerNote.style.display = 'none';
  tabs.style.display = 'flex';

  document.getElementById('cp-tab-deck').textContent   = `MY DECK (${_cpDeck.length})`;
  document.getElementById('cp-tab-deck').classList.toggle('active', _cpTab === 'deck');
  document.getElementById('cp-tab-browse').classList.toggle('active', _cpTab === 'browse');

  if (_cpTab === 'deck') {
    searchWrap.style.display  = 'none';
    if (quickAdd) quickAdd.style.display = 'none';
    deckStats.style.display   = 'flex';
    _cpUpdateStats();
    // Show deck options bar
    const optBar = document.getElementById('cp-deck-options');
    if (optBar) optBar.style.display = 'flex';
    _cpUpdateDeckOptionButtons();
    _cpRenderDeck();
  } else {
    searchWrap.style.display  = 'block';
    if (quickAdd) quickAdd.style.display = 'flex';
    deckStats.style.display   = 'none';
    const optBar = document.getElementById('cp-deck-options');
    if (optBar) optBar.style.display = 'none';
    _cpRenderBrowse();
  }
}

function _cpSwitchTab(tab) {
  _cpTab = tab;
  document.getElementById('cp-search-input').value = '';
  _cpExpanded.clear();
  _cpRender();
}

// ── DECK STATS BAR ────────────────────────────────────────────────────────────
function _cpUpdateStats() {
  const countEl = document.getElementById('cp-deck-count-val');
  const lockBtn = document.getElementById('cp-lock-btn');
  if (countEl) countEl.textContent = _cpDeck.length;
  if (lockBtn) {
    if (_cpLocked) {
      lockBtn.textContent = '🔒 LOCKED';
      lockBtn.className = 'cp-lock-btn';
    } else {
      lockBtn.textContent = '🔓 UNLOCKED';
      lockBtn.className = 'cp-lock-btn cp-unlocked';
    }
  }
}

function _cpToggleLock() {
  _cpLocked = !_cpLocked;
  _cpUpdateStats();
  _cpRenderDeck();
  _cpSaveState();
  showToast(_cpLocked ? 'Deck locked 🔒' : 'Deck unlocked — remove cards with care');
}

// ── DECK OPTION TOGGLES (stops + cost) ───────────────────────────────────────
function _cpUpdateDeckOptionButtons() {
  const stopsBtn = document.getElementById('cp-opt-stops-btn');
  const costBtn  = document.getElementById('cp-opt-cost-btn');
  if (stopsBtn) stopsBtn.classList.toggle('cp-opt-active', _cpShowStops);
  if (costBtn)  costBtn.classList.toggle('cp-opt-active', _cpShowCost);
}

function _cpToggleShowStops() {
  _cpShowStops = !_cpShowStops;
  _cpUpdateDeckOptionButtons();
  _cpSaveState();
  _cpRenderDeck();
}

function _cpToggleShowCost() {
  _cpShowCost = !_cpShowCost;
  _cpUpdateDeckOptionButtons();
  _cpSaveState();
  _cpRenderDeck();
}

// ── RENDER DECK (hider) ───────────────────────────────────────────────────────
function _cpRenderDeck() {
  const list = document.getElementById('cp-list');
  if (!_cpDeck.length) {
    list.innerHTML = `
      <div class="cp-empty">
        <div class="cp-empty-icon">🃏</div>
        <div class="cp-empty-text">No curses in deck</div>
        <div class="cp-empty-sub">Switch to Browse to add curses</div>
      </div>`;
    return;
  }
  list.innerHTML = _cpDeck.map((id, idx) => {
    const c = _CURSES.find(x => x.id === id);
    return c ? _cpDeckCardHTML(c, idx) : '';
  }).join('');
}

function _cpDeckCardHTML(c, idx) {
  const expanded = _cpDeckExpanded.has(idx);

  // Build compact-info line shown when collapsed
  let compactInfo = '';
  if (!expanded) {
    const parts = [];
    if (_cpShowStops) {
      parts.push(_cpQuestionBadge(c, true) + _cpInformBadge(c, true));
    }
    if (_cpShowCost && c.castingCost) {
      parts.push(`<div class="cp-compact-cost">${_esc(c.castingCost)}</div>`);
    }
    if (parts.length) compactInfo = `<div class="cp-compact-info">${parts.join('')}</div>`;
  }

  return `
    <div class="cp-item ${expanded ? 'cp-expanded' : ''}" id="cpd-${idx}">
      <div class="cp-item-header" onclick="_cpToggleDeckCard(${idx})">
        <span class="cp-num">#${String(c.id).padStart(2,'0')}</span>
        <span class="cp-name">${_esc(c.name)}</span>
        ${_cpDotHTML(c)}
        <svg class="cp-chevron" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg>
      </div>
      ${compactInfo}
      <div class="cp-item-body">
        ${_cpCardBodyHTML(c, 'deck', idx)}
      </div>
    </div>`;
}

function _cpToggleDeckCard(idx) {
  if (_cpDeckExpanded.has(idx)) _cpDeckExpanded.delete(idx);
  else _cpDeckExpanded.add(idx);
  const el = document.getElementById(`cpd-${idx}`);
  if (el) el.classList.toggle('cp-expanded');
  // Re-render single card to update compact info visibility
  const c = _CURSES.find(x => x.id === _cpDeck[idx]);
  if (el && c) el.outerHTML = _cpDeckCardHTML(c, idx);
}

// ── RENDER BROWSE ─────────────────────────────────────────────────────────────
function _cpRenderBrowse(query) {
  const input = document.getElementById('cp-search-input');
  query = (query !== undefined ? query : (input ? input.value.trim() : ''));
  const ql = query.toLowerCase().trim();

  const filtered = ql
    ? _CURSES.filter(c => {
        const rawNum = ql.replace(/^#/, '').trim();
        const isNumericSearch = /^\d+$/.test(rawNum);
        if (isNumericSearch && String(c.id) === rawNum) return true;

        return c.name.toLowerCase().includes(ql) ||
          (c.cardInfo  || '').toLowerCase().includes(ql) ||
          (c.castingCost || '').toLowerCase().includes(ql) ||
          (c.extraInfo || '').toLowerCase().includes(ql) ||
          (isNumericSearch && String(c.id).includes(rawNum));
      })
    : _CURSES;

  const list = document.getElementById('cp-list');
  if (!filtered.length) {
    list.innerHTML = `<div class="cp-empty"><div class="cp-empty-icon">🔍</div><div class="cp-empty-text">No curses found</div></div>`;
    return;
  }
  list.innerHTML = filtered.map(c => _cpBrowseItemHTML(c)).join('');
}

function _cpBrowseItemHTML(c) {
  const expanded = _cpExpanded.has(c.id);
  const inDeck   = _cpDeck.includes(c.id);
  const isHider  = (typeof mode !== 'undefined' && mode === 'hider');
  return `
    <div class="cp-item ${expanded ? 'cp-expanded' : ''}" id="cpb-${c.id}">
      <div class="cp-item-header" onclick="_cpToggleBrowseItem(${c.id})">
        <span class="cp-num">#${String(c.id).padStart(2,'0')}</span>
        <span class="cp-name">${_esc(c.name)}</span>
        ${_cpDotHTML(c)}
        <svg class="cp-chevron" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg>
      </div>
      <div class="cp-item-body">
        ${_cpCardBodyHTML(c, 'browse', null)}
        ${isHider ? `
        <button class="cp-action-btn ${inDeck ? 'cp-in-deck' : ''}" onclick="event.stopPropagation();_cpAddToDeck(${c.id})" id="cp-add-btn-${c.id}">
          ${inDeck ? '✅ In Deck' : '＋ Add to Deck'}
        </button>` : ''}
      </div>
    </div>`;
}

function _cpToggleBrowseItem(id) {
  if (_cpExpanded.has(id)) _cpExpanded.delete(id);
  else _cpExpanded.add(id);
  const el = document.getElementById(`cpb-${id}`);
  if (el) el.classList.toggle('cp-expanded');
}

// ── SHARED CARD BODY ──────────────────────────────────────────────────────────
function _cpCardBodyHTML(c, context, deckIdx) {
  const hasExtra = c.extraInfo && c.extraInfo.trim();
  const extraSection = hasExtra ? `
    <div style="margin-top:8px">
      <button class="cp-extra-toggle" onclick="event.stopPropagation();_cpToggleExtra(this)">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="transition:transform .2s;flex-shrink:0"><path d="m6 9 6 6 6-6"/></svg>
        <span>${_cpCollapseExtra ? 'Show Extra Info & Rulings' : 'Hide Extra Info'}</span>
      </button>
      <div class="cp-extra-content" style="display:${_cpCollapseExtra ? 'none' : 'block'}">
        <div class="cp-section-label" style="margin-top:8px">EXTRA INFO & RULINGS</div>
        <div class="cp-text">${_esc(c.extraInfo).replace(/\n/g,'<br>')}</div>
      </div>
    </div>` : '';

  return `
    ${c.cardInfo ? `
    <div class="cp-section-label">EFFECT</div>
    <div class="cp-text">${_esc(c.cardInfo).replace(/\n/g,'<br>')}</div>` : ''}
    ${c.castingCost ? `
    <div class="cp-section-label" style="margin-top:10px">CASTING COST</div>
    <div class="cp-text">${_esc(c.castingCost).replace(/\n/g,'<br>')}</div>` : ''}
    ${extraSection}
    <div class="cp-badges" style="margin-top:10px">
      ${_cpQuestionBadge(c, false)}
      ${_cpInformBadge(c, false)}
    </div>
    ${context === 'deck' && deckIdx !== null && !_cpLocked ? `
    <button class="cp-remove-btn" style="margin-top:8px" onclick="event.stopPropagation();_cpRemove(${deckIdx})">✕ Remove from Deck</button>` : ''}`;
}

function _cpToggleExtra(btn) {
  const content = btn.nextElementSibling;
  const icon = btn.querySelector('svg');
  const span = btn.querySelector('span');
  const isHidden = content.style.display === 'none';
  content.style.display = isHidden ? 'block' : 'none';
  if (icon) icon.style.transform = isHidden ? 'rotate(180deg)' : '';
  if (span) span.textContent = isHidden ? 'Hide Extra Info' : 'Show Extra Info & Rulings';
}

// ── QUICK ADD BY NUMBER ───────────────────────────────────────────────────────
function _cpQuickAdd() {
  const input = document.getElementById('cp-num-input');
  if (!input) return;
  const val = parseInt(input.value.trim());
  if (isNaN(val)) { showToast('Enter a valid curse number'); return; }
  const c = _CURSES.find(x => x.id === val);
  if (!c) { showToast(`No curse #${val} found`); return; }
  if (_cpDeck.includes(c.id)) { showToast(`#${val} already in deck`); return; }
  _cpAddToDeck(c.id);
  input.value = '';
  input.focus();
}

function _cpQuickJump() {
  const input = document.getElementById('cp-num-input');
  if (!input) return;
  const val = parseInt(input.value.trim());
  if (isNaN(val)) return;
  const c = _CURSES.find(x => x.id === val);
  if (!c) { showToast(`No curse #${val}`); return; }
  const searchInput = document.getElementById('cp-search-input');
  if (searchInput) { searchInput.value = c.name; _cpRenderBrowse(c.name); }
  requestAnimationFrame(() => {
    const el = document.getElementById(`cpb-${c.id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      if (!_cpExpanded.has(c.id)) { _cpExpanded.add(c.id); el.classList.add('cp-expanded'); }
    }
  });
}

// ── DECK MANAGEMENT ───────────────────────────────────────────────────────────
function _cpAddToDeck(id) {
  const c = _CURSES.find(x => x.id === id);
  if (!c) return;
  _cpDeck.push(id);
  _cpHistory.push({ id, name: c.name, action: 'add', time: Date.now() });
  _cpSaveState();
  showToast(`Added: ${c.name}`, 2000);
  const btn = document.getElementById(`cp-add-btn-${id}`);
  if (btn) { btn.textContent = '✅ In Deck'; btn.classList.add('cp-in-deck'); }
  const tabEl = document.getElementById('cp-tab-deck');
  if (tabEl) tabEl.textContent = `MY DECK (${_cpDeck.length})`;
}

function _cpRemove(deckIdx) {
  if (_cpLocked) { showToast('Unlock the deck first'); return; }
  const id = _cpDeck[deckIdx];
  const c  = _CURSES.find(x => x.id === id);
  _cpDeck.splice(deckIdx, 1);
  _cpDeckExpanded.delete(deckIdx);
  _cpHistory.push({ id, name: c ? c.name : '?', action: 'remove', time: Date.now() });
  _cpSaveState();
  showToast(`Removed: ${c ? c.name : 'card'}`);
  _cpRenderDeck();
  _cpUpdateStats();
}

// ── COLLAPSE EXTRA SETTING ────────────────────────────────────────────────────
function _cpToggleCollapseExtra() {
  _cpCollapseExtra = !_cpCollapseExtra;
  const btn = document.getElementById('cp-collapse-extra-btn');
  const st  = document.getElementById('cp-collapse-extra-status');
  if (btn) btn.classList.toggle('sp-active', _cpCollapseExtra);
  if (st)  st.textContent = _cpCollapseExtra ? 'ON' : 'OFF';
  _cpSaveState();
  if (_cpOpen) _cpRender();
}

// ── PERSIST ───────────────────────────────────────────────────────────────────
function _cpSaveState() {
  try {
    localStorage.setItem(_CP_SAVE_KEY, JSON.stringify({
      deck: _cpDeck,
      locked: _cpLocked,
      history: _cpHistory.slice(-50),
      collapseExtra: _cpCollapseExtra,
      showStops: _cpShowStops,
      showCost: _cpShowCost,
    }));
  } catch(e) {}
}

function _cpRestoreState() {
  try {
    const raw = localStorage.getItem(_CP_SAVE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.deck)    _cpDeck    = s.deck;
    if (s.locked !== undefined) _cpLocked = s.locked;
    if (s.history) _cpHistory = s.history;
    if (s.collapseExtra !== undefined) _cpCollapseExtra = s.collapseExtra;
    if (s.showStops !== undefined) _cpShowStops = s.showStops;
    if (s.showCost  !== undefined) _cpShowCost  = s.showCost;
  } catch(e) {}
}

function _cpSyncDeckToCurses() {
  if (!_CURSES) return;
  const validIds = new Set(_CURSES.map(c => c.id));
  const before = _cpDeck.length;
  _cpDeck = _cpDeck.filter(id => validIds.has(id));
  if (_cpDeck.length !== before) _cpSaveState();
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function _cpStopColor(v) {
  const effect = _cpQuestionEffect(v);
  const group = _cpQuestionGroup(effect);
  if (group === 'red') return '#e8557a';
  if (group === 'green') return '#55ddaa';
  if (group === 'orange') return '#ff8a2a';
  return '#f5d020';
}

function _cpQuestionEffect(cOrValue) {
  const raw = typeof cOrValue === 'object'
    ? String(cOrValue.questionEffect || cOrValue.stopsQuestion || '')
    : String(cOrValue || '');
  const v = raw.toLowerCase();
  if (v === 'yes' || v === 'stops question' || v === 'stops q') return 'Stops Question';
  if (v === 'no' || v === 'allows question' || v === 'allows q') return 'Allows Question';
  if (v.includes('acquired') || v.includes('conditional') || v.includes('until done')) return raw || 'Conditional';
  if (v === 'hinders asking' || v === 'hinders') return 'Hinders Asking';
  return 'Hinders Asking';
}

function _cpQuestionGroup(effect) {
  const v = String(effect || '').toLowerCase();
  if (v === 'stops question') return 'red';
  if (v === 'allows question') return 'green';
  if (v.includes('acquired') || v.includes('conditional') || v.includes('until done')) return 'orange';
  return 'yellow';
}

function _cpQuestionBadge(c, compact) {
  const effect = _cpQuestionEffect(c);
  const group = _cpQuestionGroup(effect);
  const cls = group === 'red' ? 'cp-badge-red' : group === 'green' ? 'cp-badge-green' : group === 'orange' ? 'cp-badge-orange' : 'cp-badge-yellow';
  const label = compact ? effect.replace(' Question', ' Q') : effect;
  const style = compact ? ' style="font-size:7px;padding:2px 5px"' : '';
  return `<span class="cp-badge ${cls}"${style}>${label}</span>`;
}

function _cpInformBadge(c, compact) {
  const visible = c.informSeekers === 'True';
  const cls = visible ? 'cp-badge-blue' : 'cp-badge-dim';
  const label = visible ? 'Inform Seekers' : 'Hidden';
  const style = compact ? ' style="font-size:7px;padding:2px 5px"' : '';
  return `<span class="cp-badge ${cls}"${style}>${label}</span>`;
}

function _cpDotHTML(c) {
  const effect = _cpQuestionEffect(c);
  const inform = c.informSeekers === 'True';
  return `<div class="cp-dot-row"><div class="cp-dot" style="background:${_cpStopColor(c)}" title="${effect}"></div><div class="cp-dot ${inform ? 'cp-dot-info' : 'cp-dot-hidden'}" title="${inform ? 'Inform seekers' : 'Hidden from seekers'}"></div></div>`;
}

function _esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}
