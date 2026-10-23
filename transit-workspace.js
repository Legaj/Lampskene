/* A single, stable SL workspace. Existing feed and route controls retain their handlers. */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const panel = byId('sl-panel'), body = byId('shell-transit-body');
  if (!panel || !body || byId('sl-workspace-tabs')) return;
  const tracker = byId('sl-tracker-section'), departures = byId('sl-departure-board');
  const header = panel.querySelector('.sl-header');
  panel.classList.add('sl-workspace');
  const title = header?.querySelector('.sl-header-title'); if (title) title.textContent = 'SL';
  header?.querySelector('.shell-panel-subtitle')?.remove();
  header?.querySelector(':scope > span')?.remove();

  const tabs = document.createElement('div'); tabs.id = 'sl-workspace-tabs';
  tabs.className = 'sl-workspace-tabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'SL tools');
  const pages = {}, buttons = {}, scrollPositions = { routes:0, live:0, departures:0 };
  let active = '', selecting = false;
  for (const [key, label] of [['routes','Routes'], ['live','Live'], ['departures','Departures']]) {
    const button = document.createElement('button'); button.id = 'sl-tab-' + key; button.type = 'button';
    button.textContent = label; button.dataset.slTab = key; button.setAttribute('role','tab');
    button.setAttribute('aria-controls','sl-page-' + key); button.setAttribute('aria-selected','false'); button.tabIndex = -1;
    const page = document.createElement('section'); page.id = 'sl-page-' + key; page.className = 'sl-workspace-page';
    page.setAttribute('role','tabpanel'); page.setAttribute('aria-labelledby',button.id); page.tabIndex = 0; page.hidden = true;
    tabs.append(button); body.append(page); pages[key] = page; buttons[key] = button;
    button.addEventListener('click', () => select(key));
  }
  header?.after(tabs);
  const search = panel.querySelector('.sl-search-wrap'), results = byId('sl-search-results');
  if (search) {
    pages.routes.append(search);
    const input = byId('sl-search-input'); if (input) { input.placeholder = 'Line or stop'; input.setAttribute('aria-label','Search SL lines or stops'); input.autocomplete = 'off'; }
  }

  // These map controls belong beside route selection, rather than in a second settings menu.
  const layers = document.createElement('details'); layers.id = 'sl-route-layers'; layers.className = 'sl-workspace-drawer';
  const layerSummary = document.createElement('summary'); layerSummary.textContent = 'Map layers';
  const layerBody = document.createElement('div'); layerBody.className = 'sl-layer-controls'; layers.append(layerSummary, layerBody);
  pages.routes.append(layers);
  const slData = byId('sl-bus-all-btn')?.closest('.shell-settings-section');
  if (slData) {
    slData.querySelector(':scope > .sp-label')?.remove();
    slData.classList.remove('shell-settings-section', 'advanced-only'); slData.hidden = false;
    layerBody.append(slData);
  }
  const transitOverlay = byId('transit-layer-btn');
  if (transitOverlay) {
    transitOverlay.querySelector('span')?.replaceChildren(document.createTextNode('Network overlay'));
    layerBody.prepend(transitOverlay);
  }
  const labels = {
    'sl-bus-all-btn':'Bus routes', 'sl-ferry-all-btn':'Ferry routes', 'sl-subway-all-btn':'Metro routes',
    'sl-tram-all-btn':'Tram routes', 'sl-train-all-btn':'Train routes', 'sl-blue-zone-bus-btn':'Buses in blue', 'sl-ferry-stops-btn':'Ferry stops'
  };
  for (const [id, label] of Object.entries(labels)) { const button = byId(id); if (button?.firstElementChild) button.firstElementChild.textContent = label; }
  for (const [id,label] of [['sl-detail-fast','Simple'],['sl-detail-medium','Detail'],['sl-detail-data','Full']]) {
    const button = byId(id); if (button) { button.textContent = label; button.setAttribute('aria-label', label + ' route geometry'); }
  }
  const geometry = byId('sl-detail-fast')?.parentElement;
  if (geometry) { geometry.setAttribute('role','group'); geometry.setAttribute('aria-label','Route geometry detail'); }
  if (!layerBody.children.length) layers.remove();

  const selected = document.createElement('details'); selected.id = 'sl-on-map'; selected.className = 'sl-workspace-drawer'; selected.open = true;
  const selectedSummary = document.createElement('summary'); selectedSummary.textContent = 'On map'; selected.append(selectedSummary);
  const routeSelection = byId('sl-selected-list')?.closest('.sl-section'), stationSelection = byId('sl-stations-section');
  if (routeSelection) selected.append(routeSelection); if (stationSelection) selected.append(stationSelection);
  pages.routes.append(selected); if (results) pages.routes.append(results);

  if (tracker) { pages.live.append(tracker); tracker.open = false; tracker.querySelector(':scope > summary')?.setAttribute('tabindex','-1'); }
  const vehicleDetail = byId('tracker-detail'), vehicleResults = tracker?.querySelector('.tracker-results-head');
  if (vehicleDetail && vehicleResults) vehicleResults.before(vehicleDetail);
  if (departures) { pages.departures.append(departures); departures.open = false; departures.querySelector(':scope > summary')?.setAttribute('tabindex','-1'); }
  // Keep the old toggle IDs for synchronization, without a competing second set of live switches.
  const oldLiveSection = byId('trains-sp-btn')?.closest('.shell-settings-section');
  const markerSize = byId('trains-size-row');
  if (markerSize) {
    const appearance = document.createElement('details'); appearance.className = 'sl-workspace-drawer sl-live-appearance';
    const summary = document.createElement('summary'); summary.textContent = 'Marker size'; appearance.append(summary,markerSize);
    const filters = tracker?.querySelector('.tracker-view-filter');
    if (filters) filters.after(appearance); else pages.live.append(appearance);
    markerSize.classList.add('sl-marker-size'); markerSize.querySelector('label')?.replaceChildren(document.createTextNode('Size'));
  }
  if (oldLiveSection) {
    const compatibility = document.createElement('div'); compatibility.hidden = true; compatibility.inert = true;
    oldLiveSection.classList.remove('shell-settings-section'); compatibility.append(oldLiveSection); panel.append(compatibility);
  }
  for (const page of Object.values(pages)) body.append(page);
  window.appShell?.refreshSettings?.();

  function select(key, options = {}) {
    if (!pages[key] || selecting) return false;
    selecting = true;
    if (active) scrollPositions[active] = body.scrollTop;
    active = key; panel.dataset.slPage = key;
    for (const [name,page] of Object.entries(pages)) {
      page.hidden = name !== key; page.inert = name !== key;
      buttons[name].setAttribute('aria-selected',String(name === key)); buttons[name].tabIndex = name === key ? 0 : -1;
    }
    if (tracker) tracker.open = key === 'live';
    if (departures) departures.open = key === 'departures';
    body.scrollTop = scrollPositions[key] || 0;
    if (options.focus) buttons[key].focus({ preventScroll:true });
    selecting = false; return true;
  }
  tabs.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault(); const keys = Object.keys(pages), index = keys.indexOf(active);
    select(event.key === 'Home' ? keys[0] : event.key === 'End' ? keys[keys.length - 1] : keys[(index + (event.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length], { focus:true });
  });
  tracker?.addEventListener('toggle', () => { if (tracker.open && active !== 'live') select('live'); });
  departures?.addEventListener('toggle', () => { if (departures.open && active !== 'departures') select('departures'); });

  function syncSelections() {
    const routes = byId('sl-selected-list')?.querySelectorAll('.sl-line-item').length || 0;
    const stops = byId('sl-selected-stations-list')?.querySelectorAll('.sl-line-item').length || 0;
    selected.hidden = routes + stops === 0;
    const label = ['On map', routes ? routes + (routes === 1 ? ' route' : ' routes') : '', stops ? stops + (stops === 1 ? ' stop' : ' stops') : ''].filter(Boolean).join(' · ');
    selectedSummary.textContent = label;
    if (routeSelection) routeSelection.hidden = routes === 0;
  }
  let lastVehicle = '';
  function syncSwitches() {
    layerBody.querySelectorAll('.sp-btn').forEach(button => button.setAttribute('aria-pressed',String(button.classList.contains('sp-active'))));
    geometry?.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed',String(button.classList.contains('active'))));
    const state = window.lampskeneTracker?.state?.();
    if (state) {
      buttons.live.classList.toggle('is-live',state.enabled && !state.paused && !state.error && state.age !== null && state.age <= 120000);
      if (vehicleDetail) vehicleDetail.hidden = !state.selectedId;
      if (state.selectedId && state.selectedId !== lastVehicle && panel.classList.contains('open')) { select('live'); body.scrollTop = 0; }
      lastVehicle = state.selectedId;
    }
  }
  const selectionObserver = new MutationObserver(syncSelections);
  for (const id of ['sl-selected-list','sl-selected-stations-list']) if (byId(id)) selectionObserver.observe(byId(id),{ childList:true });
  new MutationObserver(syncSwitches).observe(layerBody,{ subtree:true, attributes:true, attributeFilter:['class'] });
  window.addEventListener('tracker:update',syncSwitches);
  window.lampskeneTransit = { select, get activeTab() { return active; } };
  syncSelections(); syncSwitches(); select('routes');
})();
