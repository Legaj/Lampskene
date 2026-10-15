/* Enhances the existing game DOM without replacing game controls or state. */
(() => {
  'use strict';
  if (window.appShell) return;

  const panels = { questions: 'sidebar', transit: 'sl-panel', curses: 'curse-panel', settings: 'settings-panel' };
  const buttonTargets = {
    'menu-btn': 'questions', 'mnav-questions-btn': 'questions', 'sl-btn': 'transit',
    'mnav-sl-btn': 'transit', 'curse-btn': 'curses', 'mnav-curses-btn': 'curses',
    'settings-btn': 'settings', 'mnav-settings-btn': 'settings', 'mnav-map-btn': 'map'
  };
  const paths = {
    map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15m6-12v15"/>',
    questions: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8m-8 4h8m-8 4h4"/>',
    transit: '<rect x="5" y="3" width="14" height="15" rx="4"/><path d="M5 10h14M8 21l2-3m6 3-2-3M9 14h.01M15 14h.01"/>',
    curses: '<path d="m12 2 2.5 6.5L21 11l-6.5 2.5L12 20l-2.5-6.5L3 11l6.5-2.5L12 2Z"/><path d="m20 18 1 3m-2-1h3"/>',
    settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="9" cy="18" r="2"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3h.01"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    undo: '<path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12h-3"/>',
    menu: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>'
  };
  const icon = name => `<svg class="shell-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.map}</svg>`;
  const byId = id => document.getElementById(id);
  let activePanel = null;
  let requestVersion = 0;
  let lastRole = null;
  let lastTrigger = null;
  let queuedSync = false;
  let helpTrigger = null;
  let curseLoadPromise = null;

  function currentRole() { return typeof mode !== 'undefined' ? mode : null; }
  function gameStarted() { return currentRole() === 'hider' || currentRole() === 'seeker'; }
  function readPreference(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
  function storePreference(key, value) { try { localStorage.setItem(key, value); } catch (_) { /* private browsing */ } }
  function safeText(text) {
    return String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function applyPanelState(target, restoreFocus = false) {
    const previous = activePanel;
    activePanel = panels[target] ? target : null;
    for (const [name, id] of Object.entries(panels)) {
      const panel = byId(id);
      if (!panel) continue;
      const open = name === activePanel;
      panel.classList.toggle('open', open);
      panel.inert = !open;
      panel.setAttribute('aria-hidden', String(!open));
    }
    if (typeof sidebarOpen !== 'undefined') sidebarOpen = activePanel === 'questions';
    if (typeof _cpOpen !== 'undefined') _cpOpen = activePanel === 'curses';
    document.body.classList.toggle('shell-panel-open', Boolean(activePanel));
    document.body.classList.toggle('sidebar-open', activePanel === 'questions');
    document.body.classList.toggle('settings-open', activePanel === 'settings');
    document.body.dataset.shellPanel = activePanel || 'map';
    for (const [id, name] of Object.entries(buttonTargets)) {
      const button = byId(id);
      if (!button) continue;
      const selected = name === (activePanel || 'map');
      button.classList.toggle('open', selected && !id.startsWith('mnav-'));
      button.classList.toggle('mnav-open', selected && id.startsWith('mnav-'));
      button.setAttribute('aria-expanded', String(selected && name !== 'map'));
      if (id.startsWith('mnav-')) {
        if (selected) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
      }
    }
    if (previous && !activePanel && restoreFocus && lastTrigger?.isConnected && !lastTrigger.hidden) {
      lastTrigger.focus({ preventScroll: true });
    }
    document.dispatchEvent(new CustomEvent('jetlag:panelchange', { detail: { panel: activePanel || 'map' } }));
    if (activePanel === 'questions' && previous !== activePanel && typeof _updateQuestionTools === 'function') _updateQuestionTools();
  }

  function focusPanel(target) {
    const panel = byId(panels[target]);
    if (!panel) return;
    const close = panel.querySelector('[data-shell-close]');
    if (close && document.activeElement && document.activeElement !== document.body) close.focus({ preventScroll: true });
  }

  function showLoadError(container, message, retryTarget) {
    if (!container) return;
    container.innerHTML = `<div class="sl-empty" role="status">${safeText(message)}<br><button type="button" class="shell-help-link" data-shell-retry="${retryTarget}">Try again</button></div>`;
  }

  async function open(target, options = {}) {
    if (!gameStarted()) return false;
    const version = ++requestVersion;
    if (options.trigger) lastTrigger = options.trigger;
    else if (!activePanel && document.activeElement instanceof HTMLElement) lastTrigger = document.activeElement;
    applyPanelState(target, options.restoreFocus);
    if (!panels[target]) return true;
    if (options.focus !== false) focusPanel(target);
    if (target === 'transit') {
      try {
        if (typeof loadSlData === 'function') await loadSlData();
        if (version !== requestVersion || activePanel !== target) return false;
        if (typeof renderSlSelectedList === 'function') renderSlSelectedList();
        if (typeof renderSlSearchResults === 'function') renderSlSearchResults();
      } catch (_) {
        if (version === requestVersion) showLoadError(byId('sl-search-results'), 'Transit data is unavailable. Your map and questions still work.', 'transit');
      }
    } else if (target === 'curses') {
      try {
        if (typeof _CURSES === 'undefined' || !_CURSES) {
          byId('cp-list').innerHTML = '<div class="cp-empty" role="status"><div class="cp-empty-text">Loading your curse library…</div></div>';
        }
        if (!curseLoadPromise) {
          curseLoadPromise = Promise.resolve(typeof _cpLoad === 'function' ? _cpLoad() : false)
            .finally(() => { curseLoadPromise = null; });
        }
        const ok = await curseLoadPromise;
        if (version !== requestVersion || activePanel !== target) return false;
        if (ok && typeof _cpRender === 'function') _cpRender();
        else showLoadError(byId('cp-list'), 'The curse library could not load. Check your connection and try again.', 'curses');
      } catch (_) {
        if (version === requestVersion) showLoadError(byId('cp-list'), 'The curse library could not load. Please try again.', 'curses');
      }
    }
    return true;
  }

  function close(options = {}) { requestVersion++; applyPanelState(null, options.restoreFocus !== false); }
  function toggle(target, force) {
    if (force === false || (force !== true && activePanel === target)) { close(); return Promise.resolve(false); }
    return open(target);
  }

  // Install before the original load handler restores the saved role.
  window.toggleSidebar = force => toggle('questions', force);
  window.toggleSettingsPanel = force => toggle('settings', force);
  window.toggleSlPanel = force => toggle('transit', force);
  window.toggleCursePanel = force => toggle('curses', force);
  window._cpClose = () => { if (activePanel === 'curses') close(); else if (typeof _cpOpen !== 'undefined') _cpOpen = false; };
  if (typeof window.setSettingsPanelOpen === 'function') window.setSettingsPanelOpen = force => {
    if (!force && activePanel !== 'settings') return Promise.resolve(false);
    return toggle('settings', Boolean(force));
  };

  function setupMainMenu() {
    const account = byId('mode-screen')?.querySelector('.account-panel');
    if (!account) return;
    document.body.classList.add('has-account-menu');
    const panel = document.createElement('aside'); panel.id = 'shell-main-menu-panel';
    panel.innerHTML = `<div class="shell-panel-header"><div class="shell-panel-heading"><div class="shell-panel-title">Account & rounds</div><div class="shell-panel-subtitle">Track players and resume your game</div></div><button type="button" class="shell-close-button" data-shell-close aria-label="Close menu">${icon('close')}</button></div><div id="shell-menu-body" class="shell-panel-scroll"></div>`;
    document.body.append(panel); panels.menu = panel.id;
    const button = document.createElement('button'); button.type = 'button'; button.id = 'shell-main-menu-btn'; button.className = 'hdr-btn';
    byId('header-right')?.prepend(button); buttonTargets[button.id] = 'menu';
    const trackerMenu = window.openTrackerMenu;
    if (typeof trackerMenu === 'function') window.openTrackerMenu = function (...args) {
      const result = trackerMenu.apply(this, args);
      if (gameStarted()) open('menu', { focus: false });
      return result;
    };
    const renderTrackers = window.renderTrackerMenus;
    if (typeof renderTrackers === 'function') window.renderTrackerMenus = function (...args) {
      const result = renderTrackers.apply(this, args);
      enhancePlayerTrackers();
      return result;
    };
    enhancePlayerTrackers();
  }

  function enhancePlayerTrackers() {
    const list = byId('main-tracker-list');
    if (!list || typeof trackerCatalog === 'undefined' || typeof trackerIsAvailable !== 'function') return;
    const ids = Object.keys(trackerCatalog).filter(trackerIsAvailable)
      .sort((a, b) => trackerDisplayName(a, trackerCatalog[a]).localeCompare(trackerDisplayName(b, trackerCatalog[b])));
    list.querySelectorAll('.tracker-row').forEach((row, index) => {
      const id = ids[index];
      if (!id) return;
      const toggleButton = row.querySelector('.tracker-row-main .sp-btn');
      if (toggleButton) {
        toggleButton.setAttribute('aria-pressed', String(trackerActiveIds.has(id)));
        toggleButton.setAttribute('aria-label', `Show ${trackerDisplayName(id, trackerCatalog[id])} on the map`);
      }
      let view = row.querySelector('.shell-player-tracker-view');
      if (!view) {
        view = document.createElement('button'); view.type = 'button'; view.className = 'shell-secondary shell-player-tracker-view';
        view.textContent = 'View on map'; row.append(view);
        view.addEventListener('click', () => {
          const loc = trackerLocationMap[id];
          if (!map || !loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng) || Math.abs(loc.lat) > 90 || Math.abs(loc.lng) > 180) return;
          if (!trackerActiveIds.has(id)) toggleUserTracker(id);
          if (typeof drawAppTrackerLocation === 'function') drawAppTrackerLocation(id);
          close({ restoreFocus: false });
          map.setView([loc.lat, loc.lng], Math.max(map.getZoom(), 15), { animate: false });
          trackerMarkers[id]?.openTooltip();
          if (typeof showToast === 'function') showToast(`${trackerDisplayName(id, trackerCatalog[id])} · ${trackerStatusFor(id) === 'Live' ? 'latest position' : 'last reported position'}`);
        });
      }
      const loc = typeof trackerLocationMap !== 'undefined' ? trackerLocationMap[id] : null;
      view.disabled = !gameStarted() || !loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng);
      view.setAttribute('aria-label', `View ${trackerDisplayName(id, trackerCatalog[id])} on the map`);
    });
  }

  function setupNavigation() {
    const nav = byId('mobile-nav');
    if (!nav) return;
    document.body.append(nav);
    nav.setAttribute('aria-label', 'Game navigation');
    nav.setAttribute('role', 'navigation');
    const mapButton = document.createElement('button');
    mapButton.type = 'button'; mapButton.id = 'mnav-map-btn'; mapButton.className = 'mnav-btn';
    mapButton.innerHTML = `<span class="mnav-icon">${icon('map')}</span><span class="mnav-label">Map</span>`;
    nav.prepend(mapButton);
    ['mnav-map-btn', 'mnav-questions-btn', 'mnav-sl-btn', 'mnav-curses-btn', 'mnav-settings-btn'].forEach(id => nav.append(byId(id)));
    const labels = { questions: 'Questions', transit: 'Transit', curses: 'Curses', settings: 'Settings', map: 'Map', menu: 'Menu' };
    for (const [id, target] of Object.entries(buttonTargets)) {
      const button = byId(id);
      if (!button) continue;
      button.type = 'button'; button.removeAttribute('onclick'); button.dataset.shellTarget = target;
      button.classList.remove('advanced-only');
      button.setAttribute('aria-label', labels[target]);
      if (panels[target]) button.setAttribute('aria-controls', panels[target]);
      button.title = labels[target];
      if (id.startsWith('mnav-')) button.innerHTML = `<span class="mnav-icon">${icon(target)}</span><span class="mnav-label">${labels[target]}</span>`;
      else button.innerHTML = `${icon(target)}<span class="hdr-label">${labels[target]}</span>`;
    }
    const headerLeft = byId('header-left');
    if (headerLeft) headerLeft.append(byId('menu-btn'));
    const undo = byId('undo-pin-btn');
    if (undo) { undo.innerHTML = icon('undo'); undo.setAttribute('aria-label', 'Undo the last pin move'); }
    const help = document.createElement('button');
    help.id = 'shell-help-btn'; help.type = 'button'; help.className = 'hdr-btn'; help.dataset.shellHelp = '';
    help.title = 'How to play'; help.setAttribute('aria-label', 'How to play');
    help.innerHTML = `${icon('help')}<span class="hdr-label">Guide</span>`;
    byId('header-right')?.append(help);
    const questionBadge = document.createElement('span');
    questionBadge.id = 'shell-question-badge'; questionBadge.className = 'shell-nav-badge'; questionBadge.hidden = true; questionBadge.setAttribute('aria-hidden', 'true');
    byId('mnav-questions-btn')?.append(questionBadge);
  }

  function setupPanelHeaders() {
    const descriptions = { questions: 'Clues, answers and search zones', transit: 'Routes, stops and live vehicles', curses: 'Effects, rules and your deck', settings: 'Map layers and game preferences' };
    for (const [name, id] of Object.entries(panels)) {
      const panel = byId(id);
      if (!panel) continue;
      panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', name[0].toUpperCase() + name.slice(1));
      let heading = panel.querySelector('#sidebar-header, .sl-header, .cp-header, .shell-panel-header');
      if (name === 'settings') {
        heading = document.createElement('div'); heading.className = 'shell-panel-header';
        heading.innerHTML = '<div class="shell-panel-heading"><div class="shell-panel-title">Settings</div><div class="shell-panel-subtitle">Map layers and game preferences</div></div><button type="button" class="shell-close-button" data-shell-close aria-label="Close settings"></button>';
        panel.prepend(heading);
      } else if (heading) {
        const title = heading.querySelector('.sh-title, .sl-header-title, .cp-header-title');
        if (title) {
          const wrap = document.createElement('div'); wrap.className = 'shell-panel-heading';
          title.before(wrap); wrap.append(title);
          const sub = document.createElement('div'); sub.className = 'shell-panel-subtitle'; sub.textContent = descriptions[name]; wrap.append(sub);
          if (name === 'transit') title.textContent = 'Transit explorer';
          if (name === 'curses') title.textContent = 'Curses';
        }
      }
      const button = heading?.querySelector('button');
      if (button) { button.removeAttribute('onclick'); button.dataset.shellClose = ''; button.innerHTML = icon('close'); button.setAttribute('aria-label', `Close ${name}`); }
      panel.inert = true; panel.setAttribute('aria-hidden', 'true');
    }
    const backdrop = document.createElement('button');
    backdrop.id = 'shell-panel-backdrop'; backdrop.type = 'button'; backdrop.tabIndex = -1;
    backdrop.setAttribute('aria-label', 'Return to the map'); backdrop.dataset.shellClose = '';
    document.body.append(backdrop);
    for (const [id, label] of [['sl-search-input', 'Search transit lines and stops'], ['cp-search-input', 'Search curses'], ['cp-num-input', 'Curse number'], ['tf-key-input', 'Thunderforest map API key'], ['seeker-code-field', 'Question or answer code'], ['hider-code-field', 'Question code from the seeker'], ['marker-size-slider', 'Live vehicle marker size']]) {
      byId(id)?.setAttribute('aria-label', label);
    }
    byId('toast')?.setAttribute('role', 'status');
    byId('toast')?.setAttribute('aria-live', 'polite');
    byId('map')?.setAttribute('aria-label', 'Stockholm game map');
  }

  function setupScrollablePanels() {
    for (const [id, headerSelector, bodyId] of [
      ['sl-panel', '.sl-header', 'shell-transit-body'],
      ['curse-panel', '.cp-header', 'shell-curses-body']
    ]) {
      const panel = byId(id);
      const header = panel?.querySelector(headerSelector);
      if (!panel || !header) continue;
      const scroll = document.createElement('div');
      scroll.id = bodyId; scroll.className = 'shell-panel-scroll';
      for (const child of Array.from(panel.children)) if (child !== header) scroll.append(child);
      panel.append(scroll);
    }
    const switchTab = window._cpSwitchTab;
    if (typeof switchTab === 'function') window._cpSwitchTab = function (...args) {
      const result = switchTab.apply(this, args);
      byId('shell-curses-body').scrollTop = 0;
      return result;
    };
  }

  const settingGroups = [
    { title: 'Map & overlays', labels: ['Map Layer', 'Map style', 'SL Data', 'Map overlays', 'Map providers'] },
    { title: 'Live transit', labels: ['Live Trains', 'Live Transit'] },
    { title: 'Game & seeker tools', labels: ['Game', 'Seeker workspace', 'Distance planning', 'Saved places', 'Curses'] },
    { title: 'Appearance & layout', labels: ['Layout', 'Display', 'Appearance', 'Performance', 'Comfort', 'Advanced controls'] },
    { title: 'Map API key', labels: ['Thunderforest Key'] },
    { title: 'Account & player tracking', labels: ['Account', 'Location Sharing', 'Trackers', 'Round'] }
  ];

  function refreshSettings() {
    const panel = byId('settings-panel');
    const body = byId('shell-settings-body');
    if (!panel || !body) return;
    const ungrouped = Array.from(panel.children).filter(child => child !== body && child.querySelector?.(':scope > .sp-label'));
    for (const section of ungrouped) {
      const label = section.querySelector('.sp-label')?.textContent.trim();
      if (['Live Trains', 'Live Transit', 'SL Data', 'Thunderforest Key', 'Layout'].includes(label)) section.classList.remove('advanced-only');
      const index = settingGroups.findIndex(group => group.labels.includes(label));
      const group = index >= 0 ? body.querySelector(`[data-shell-group="${index}"]`) : body.querySelector('[data-shell-group="other"]');
      section.classList.add('shell-settings-section');
      group?.append(section);
    }
    body.querySelectorAll('.shell-settings-group').forEach(group => group.hidden = !group.querySelector('.shell-settings-section'));
    filterSettings();
  }

  function filterSettings() {
    const term = (byId('shell-settings-search')?.value || '').trim().toLocaleLowerCase();
    const body = byId('shell-settings-body');
    if (!body) return;
    let matches = 0;
    body.querySelectorAll('.shell-settings-group').forEach(group => {
      let visible = 0;
      const title = group.querySelector('summary')?.textContent.toLocaleLowerCase() || '';
      group.querySelectorAll('.shell-settings-section').forEach(section => {
        const matched = !term || (title + ' ' + section.textContent.toLocaleLowerCase()).includes(term);
        section.hidden = !matched;
        if (matched) visible++;
      });
      group.hidden = !visible;
      if (term && visible) group.open = true;
      matches += visible;
    });
    byId('shell-settings-empty').hidden = Boolean(matches);
  }

  function setupSettings() {
    const panel = byId('settings-panel');
    if (!panel) return;
    const legacyHead = panel.querySelector(':scope > .settings-head');
    if (legacyHead) {
      const section = document.createElement('div');
      const label = document.createElement('div'); label.className = 'sp-label'; label.textContent = 'Advanced controls';
      section.append(label, legacyHead); panel.append(section);
    }
    const search = document.createElement('div'); search.className = 'shell-settings-search';
    search.innerHTML = '<input id="shell-settings-search" type="search" placeholder="Find a setting or map layer…" aria-label="Search settings" autocomplete="off">';
    const body = document.createElement('div'); body.id = 'shell-settings-body';
    settingGroups.forEach((group, index) => {
      const details = document.createElement('details'); details.className = 'shell-settings-group'; details.dataset.shellGroup = index;
      details.open = index < 3; details.innerHTML = `<summary>${safeText(group.title)}</summary>`; body.append(details);
    });
    const other = document.createElement('details'); other.className = 'shell-settings-group'; other.dataset.shellGroup = 'other'; other.open = true; other.innerHTML = '<summary>More settings</summary>'; body.append(other);
    const empty = document.createElement('div'); empty.id = 'shell-settings-empty'; empty.className = 'shell-settings-empty'; empty.hidden = true;
    empty.textContent = 'No matching settings. Try “map”, “lines” or “theme”.'; body.append(empty);
    const footer = document.createElement('div'); footer.className = 'shell-settings-footer';
    footer.innerHTML = '<button type="button" class="shell-help-link" data-shell-help>How to use the game →</button>';
    panel.append(search, body, footer);
    // Put search immediately below the fixed heading, before the scrolling groups.
    panel.querySelector('.shell-panel-header').after(search);
    refreshSettings();
    byId('shell-settings-search').addEventListener('input', filterSettings);
    const descriptions = {
      'trains-sp-btn': 'Show available live vehicle positions. Updates depend on the transit feed.',
      'sl-live-btn': 'Limit live vehicles to the lines you selected in Transit.',
      'move-lock-setting-btn': 'Lock question pins after a 60-second move window.',
      'seeker-code-menu-btn': 'Show the code box so seekers can import questions and answers.',
      'bottom-bar-btn': 'Phones always show the navigation dock. This preference also shows it on larger screens.',
      'city-boundary-btn': 'Shade areas outside Stockholm to keep the search focused.',
      'hide-locked-btn': 'Reduce map clutter while keeping locked clues in your Questions list.'
    };
    for (const [id, text] of Object.entries(descriptions)) {
      const button = byId(id);
      if (!button) continue;
      const desc = document.createElement('p'); desc.className = 'shell-setting-description'; desc.id = `${id}-description`; desc.textContent = text;
      button.after(desc); button.setAttribute('aria-describedby', desc.id);
    }
    const layoutTitle = byId('bottom-bar-btn')?.querySelector('span');
    if (layoutTitle) layoutTitle.textContent = 'Navigation dock on desktop';
    const label = byId('marker-size-slider')?.parentElement?.querySelector('label');
    if (label) label.setAttribute('for', 'marker-size-slider');
    new MutationObserver(() => {
      if (Array.from(panel.children).some(child => child !== body && child.querySelector(':scope > .sp-label'))) refreshSettings();
    }).observe(panel, { childList: true });
  }

  function setupWelcome() {
    const screen = byId('mode-screen');
    if (!screen) return;
    const eyebrow = document.createElement('div'); eyebrow.className = 'shell-welcome-eyebrow'; eyebrow.textContent = 'Your city. Your game.'; screen.prepend(eyebrow);
    screen.querySelector('h1').innerHTML = 'JET<span>LAG</span>';
    if (!screen.querySelector('.account-panel')) screen.querySelector(':scope > p').textContent = 'A game of hide and seek across Stockholm.';
    screen.querySelectorAll('.mode-card').forEach(card => {
      const role = card.classList.contains('hider') ? 'hider' : 'seeker';
      card.setAttribute('role', 'button'); card.tabIndex = 0; card.setAttribute('aria-label', `Play as ${role}`);
      const description = document.createElement('div'); description.className = 'shell-role-description';
      description.textContent = role === 'seeker' ? 'Ask questions, compare clues and narrow the search.' : 'Set your hiding spot, answer questions and manage curses.';
      card.append(description);
      card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); card.click(); } });
    });
    const note = document.createElement('div'); note.className = 'shell-welcome-note';
    note.textContent = screen.querySelector('.account-panel') ? 'Start or resume a round, choose your role, and keep your tracker selections together in Menu.' : 'Your questions and map are saved on this device. You can change roles in Settings.';
    screen.append(note);
    const help = document.createElement('button'); help.type = 'button'; help.className = 'shell-help-link'; help.dataset.shellHelp = ''; help.textContent = 'New here? Read the field guide'; screen.append(help);
  }

  function setupHelp() {
    const dialog = document.createElement('div'); dialog.id = 'shell-help'; dialog.hidden = true;
    dialog.innerHTML = '<section class="shell-help-card" role="dialog" aria-modal="true" aria-labelledby="shell-help-title" tabindex="-1"><div class="shell-panel-header"><div class="shell-panel-heading"><div class="shell-help-eyebrow">Stockholm field guide</div><h2 id="shell-help-title">Make every clue count.</h2></div><button type="button" class="shell-close-button" data-shell-help-close aria-label="Close guide"></button></div><p id="shell-help-intro"></p><ol class="shell-help-steps" id="shell-help-steps"></ol><p>Use Transit to inspect routes and stops. Settings contains map styles, overlays and display options. Live positions and forecasts depend on available data; compare them with official journey information when travelling.</p><div class="shell-help-actions"><button type="button" class="shell-primary" data-shell-guide-start>Open Questions</button><button type="button" class="shell-secondary" data-shell-help-close>Got it</button></div></section>';
    dialog.querySelector('.shell-close-button').innerHTML = icon('close');
    document.body.append(dialog);
    const coach = document.createElement('aside'); coach.id = 'shell-map-coach'; coach.className = 'shell-map-coach'; coach.hidden = true;
    coach.innerHTML = `<button type="button" class="shell-close-button" data-shell-coach-close aria-label="Dismiss map tip">${icon('close')}</button><strong id="shell-coach-title"></strong><p id="shell-coach-copy"></p><button type="button" class="shell-help-link" data-shell-guide-start>Open Questions →</button>`;
    document.body.append(coach);
  }

  function showHelp(trigger) {
    const role = currentRole() || 'seeker';
    helpTrigger = trigger || document.activeElement;
    const seeker = role === 'seeker';
    byId('shell-help-intro').textContent = seeker ? 'Build a clear picture of where the hider could be, one answer at a time.' : 'Keep your location and answers consistent, and make your curse deck easy to manage.';
    const steps = seeker ? [
      ['Create a question', 'Open Questions and choose Radar, Thermometer, Matching, Measuring or Angle. Each preview explains what the clue can reveal.'],
      ['Set the question on the map', 'Use the question’s pin controls, drag unlocked markers to the right location and review the preview before sending a code.'],
      ['Record the answer', 'Choose the hider’s answer or paste their answer code. Keep answered clues visible to compare the remaining search zones.']
    ] : [
      ['Set your hiding location', 'Open Questions and use the hiding-location card to place your pin. Lock it once you are happy with the position.'],
      ['Import a question', 'Paste the seeker’s question code into Questions. Check its preview and your hiding position before copying the answer.'],
      ['Manage your curse deck', 'Open Curses to browse effects and add cards. Unlock your deck to make changes; review any requirements before playing a curse.']
    ];
    byId('shell-help-steps').innerHTML = steps.map(([title, text]) => `<li><strong>${safeText(title)}</strong><p>${safeText(text)}</p></li>`).join('');
    byId('shell-help').querySelector('[data-shell-guide-start]').textContent = gameStarted() ? 'Open Questions' : 'Return to menu';
    const dialog = byId('shell-help'); dialog.hidden = false;
    byId('header').inert = true; byId('mobile-nav').inert = true;
    for (const id of Object.values(panels)) byId(id).inert = true;
    byId('mode-screen').inert = true;
    byId('map').inert = true;
    byId('shell-map-coach').inert = true;
    dialog.querySelector('[data-shell-help-close]').focus({ preventScroll: true });
  }

  function closeHelp() {
    byId('shell-help').hidden = true;
    byId('header').inert = false; byId('mobile-nav').inert = false; byId('mode-screen').inert = false; byId('map').inert = false;
    byId('shell-map-coach').inert = false;
    for (const [name, id] of Object.entries(panels)) byId(id).inert = name !== activePanel;
    if (helpTrigger?.isConnected) helpTrigger.focus({ preventScroll: true });
  }

  function syncUI() {
    queuedSync = false;
    const role = currentRole();
    const started = gameStarted();
    const nav = byId('mobile-nav'); nav.hidden = !started;
    const roleBadge = byId('mode-badge');
    if (roleBadge) roleBadge.title = roleBadge.textContent;
    const account = document.querySelector('.account-panel');
    if (account && byId('shell-menu-body')) {
      const destination = started ? byId('shell-menu-body') : byId('mode-screen');
      if (account.parentElement !== destination) destination.append(account);
    }
    const quickActions = byId('quick-actions');
    if (quickActions) quickActions.hidden = !started;
    const coach = byId('shell-map-coach');
    if (role !== lastRole) {
      lastRole = role;
      close({ restoreFocus: false });
      if (typeof _cpTab !== 'undefined') _cpTab = role === 'hider' ? 'deck' : 'browse';
      if (role) {
        byId('shell-coach-title').textContent = role === 'seeker' ? 'Start with a question.' : 'Set your hiding location.';
        byId('shell-coach-copy').textContent = role === 'seeker' ? 'Choose a clue, place its pins and record the answer to narrow the search.' : 'Your location card is in Questions. Place your pin, lock it, then import seeker codes.';
        window.lampskeneQuestions?.sync();
        document.dispatchEvent(new CustomEvent('jetlag:rolechange', { detail: { role } }));
      }
    }
    coach.hidden = !started || readPreference(`jetlag_coach_${role}_v1`) === '1';
    const count = typeof questions !== 'undefined' ? questions.filter(q => !['hide-loc', 'hider-location', 'endgame'].includes(q.type)).length : byId('question-list').querySelectorAll('.q-card').length;
    const badge = byId('shell-question-badge'); badge.hidden = !count; badge.textContent = count > 99 ? '99+' : count;
    for (const button of document.querySelectorAll('.sp-btn')) {
      const status = button.querySelector('span:last-child:not(:first-child)');
      if (status && /^(ON|OFF)$/.test(status.textContent.trim())) button.setAttribute('aria-pressed', String(status.textContent.trim() === 'ON'));
    }
    document.querySelectorAll('#settings-panel .layer-btn').forEach(button => button.setAttribute('aria-pressed', String(button.classList.contains('active'))));
    const toggle = byId('type-picker');
    const addButton = byId('seeker-footer')?.querySelector('.add-q-btn');
    if (toggle && addButton) { addButton.setAttribute('aria-controls', 'type-picker'); addButton.setAttribute('aria-expanded', String(toggle.style.display !== 'none')); }
    const actualOpen = Object.entries(panels).filter(([, id]) => byId(id).classList.contains('open')).map(([name]) => name);
    if (activePanel && !actualOpen.includes(activePanel)) applyPanelState(null);
  }

  function scheduleSync() { if (!queuedSync) { queuedSync = true; queueMicrotask(syncUI); } }

  document.body.classList.add('app-shell');
  setupMainMenu(); setupNavigation(); setupPanelHeaders(); setupScrollablePanels(); setupSettings(); setupWelcome(); setupHelp();
  window.appShell = { open, close, closeAll: close, closePanels: () => close({ restoreFocus: false }), toggle, refreshSettings, showHelp, get activePanel() { return activePanel; } };
  // Keep the preview extensions' original shell name compatible.
  window.lampskeneShell = window.appShell;

  // Capture at window so legacy document handlers cannot close/reopen a dock tab.
  window.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest('[data-shell-target], [data-shell-close], [data-shell-help], [data-shell-help-close], [data-shell-coach-close], [data-shell-guide-start], [data-shell-retry]');
    if (!target) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (target.hasAttribute('data-shell-target')) {
      const name = target.dataset.shellTarget;
      if (name === 'map' || activePanel === name) close({ restoreFocus: false });
      else open(name, { trigger: target });
    } else if (target.hasAttribute('data-shell-close')) close();
    else if (target.hasAttribute('data-shell-help')) showHelp(target);
    else if (target.hasAttribute('data-shell-help-close')) closeHelp();
    else if (target.hasAttribute('data-shell-coach-close')) { storePreference(`jetlag_coach_${currentRole()}_v1`, '1'); byId('shell-map-coach').hidden = true; }
    else if (target.hasAttribute('data-shell-guide-start')) { closeHelp(); if (gameStarted()) open('questions', { trigger: target }); }
    else if (target.hasAttribute('data-shell-retry')) open(target.dataset.shellRetry, { focus: false });
  }, true);

  document.addEventListener('keydown', event => {
    const help = byId('shell-help');
    if (event.key === 'Escape') {
      if (!help.hidden) { event.preventDefault(); closeHelp(); }
      else if (activePanel) { event.preventDefault(); close(); }
    }
    if (event.key === 'Tab' && !help.hidden) {
      const focusable = Array.from(help.querySelectorAll('button, input, [tabindex="0"]')).filter(node => !node.hidden && !node.disabled);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
  byId('shell-help').addEventListener('click', event => { if (event.target === byId('shell-help')) closeHelp(); });
  const observer = new MutationObserver(scheduleSync);
  observer.observe(byId('mode-badge'), { childList: true });
  observer.observe(byId('header'), { attributes: true, attributeFilter: ['style'] });
  observer.observe(byId('question-list'), { childList: true, subtree: true });
  observer.observe(byId('settings-panel'), { childList: true, subtree: true, characterData: true });
  for (const id of Object.values(panels)) observer.observe(byId(id), { attributes: true, attributeFilter: ['class'] });
  observer.observe(byId('type-picker'), { attributes: true, attributeFilter: ['style'] });
  if (byId('timeline-panel')) {
    const timelineObserver = new MutationObserver(() => {
      const timeline = byId('timeline-panel');
      timeline.inert = !timeline.classList.contains('open');
      timeline.setAttribute('aria-hidden', String(timeline.inert));
      if (!timeline.inert && activePanel) close({ restoreFocus: false });
    });
    timelineObserver.observe(byId('timeline-panel'), { attributes: true, attributeFilter: ['class'] });
    byId('timeline-panel').setAttribute('role', 'region');
    byId('timeline-panel').setAttribute('aria-label', 'Round replay timeline');
    byId('timeline-panel').inert = true;
    byId('timeline-scrubber')?.setAttribute('aria-label', 'Replay time within the round');
  }
  // Dock/status preferences change the viewport; panel switches do not.
  if (typeof ResizeObserver === 'function') {
    let resizeFrame = 0;
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        if (typeof map !== 'undefined' && map?.invalidateSize) map.invalidateSize({ animate: false, pan: true, debounceMoveend: true });
      });
    });
    resizeObserver.observe(byId('map'));
  }
  syncUI();
})();
