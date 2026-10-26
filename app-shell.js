/* Enhances the existing game DOM without replacing game controls or state. */
(() => {
  'use strict';
  if (window.appShell) return;

  const panels = { questions: 'sidebar', transit: 'sl-panel', curses: 'curse-panel', settings: 'settings-panel' };
  const buttonTargets = {
    'menu-btn': 'questions', 'mnav-questions-btn': 'questions', 'sl-btn': 'transit',
    'mnav-sl-btn': 'transit', 'curse-btn': 'curses', 'mnav-curses-btn': 'curses',
    'settings-btn': 'settings', 'mnav-settings-btn': 'settings'
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
  let settingsCategory = null;
  let questionAction = null;

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
    if (activePanel !== 'questions') closeQuestionActions();
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
    if (target === 'settings' && activePanel !== 'settings' && !options.preserveCategory && byId('shell-settings-home')) selectSettingsCategory(null, { focus: false });
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
    if (!byId('mnav-map-btn')) {
      const mapButton = document.createElement('button'); mapButton.id = 'mnav-map-btn'; mapButton.className = 'mnav-btn'; nav.prepend(mapButton);
    }
    buttonTargets['mnav-map-btn'] = 'map';
    ['mnav-map-btn', 'mnav-questions-btn', 'mnav-sl-btn', 'mnav-curses-btn', 'mnav-settings-btn'].forEach(id => { const button = byId(id); if (button) nav.append(button); });
    const labels = { questions: 'Questions', transit: 'SL', curses: 'Curses', settings: 'Settings', map: 'Map', menu: 'Menu' };
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
    byId('curse-btn')?.setAttribute('aria-label', 'Open curses');
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
          if (name === 'transit') title.textContent = 'SL';
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

  function closeQuestionActions() {
    questionAction = null;
    if (document.activeElement?.closest?.('.shell-question-action-sheet')) document.activeElement.blur();
    if (typeof typePickerOpen !== 'undefined') typePickerOpen = false;
    const picker = byId('type-picker'); if (picker) picker.style.display = 'none';
    document.querySelectorAll('.shell-question-action-sheet').forEach(sheet => { sheet.hidden = true; });
    document.querySelectorAll('[data-question-import]').forEach(button => button.setAttribute('aria-expanded', 'false'));
  }

  function showQuestionImport(role, trigger) {
    const sheet = byId(`shell-${role}-import`);
    if (!sheet) return;
    const wasOpen = !sheet.hidden;
    closeQuestionActions();
    if (wasOpen) return;
    if (role === 'seeker' && typeof _seekerQuestionCodeMenu !== 'undefined' && !_seekerQuestionCodeMenu && typeof toggleSeekerQuestionCodeMenu === 'function') toggleSeekerQuestionCodeMenu();
    questionAction = role + '-import'; sheet.hidden = false;
    trigger?.setAttribute('aria-expanded', 'true');
    byId(role + '-code-field')?.focus({ preventScroll: true });
  }

  function setupQuestionWorkspace() {
    const panel = byId('sidebar');
    const heading = byId('sidebar-header');
    if (!panel || !heading) return;
    heading.querySelector('.shell-panel-subtitle')?.remove();
    const tools = byId('question-tools');
    if (tools) {
      const drawer = document.createElement('details'); drawer.id = 'shell-question-filters';
      const summary = document.createElement('summary'); summary.className = 'shell-sr-only'; summary.textContent = 'Search and filter questions'; summary.tabIndex = -1; drawer.append(summary, tools); heading.after(drawer);
      const filters = document.createElement('button'); filters.type = 'button'; filters.className = 'shell-question-filter-button';
      filters.innerHTML = icon('settings'); filters.setAttribute('aria-label', 'Search and filter questions'); filters.setAttribute('aria-controls', drawer.id); filters.setAttribute('aria-expanded', 'false');
      heading.querySelector('[data-shell-close]')?.before(filters);
      filters.addEventListener('click', () => { drawer.open = !drawer.open; if (drawer.open) byId('question-search')?.focus({ preventScroll: true }); });
      drawer.addEventListener('toggle', () => filters.setAttribute('aria-expanded', String(drawer.open)));
      const count = byId('question-count'); if (count) { count.classList.add('shell-question-count'); heading.querySelector('.shell-panel-heading')?.append(count); }
      byId('question-search')?.setAttribute('aria-label', 'Search your questions');
    }
    const seeker = byId('seeker-footer');
    if (seeker) {
      const add = seeker.querySelector('.add-q-btn');
      if (add) {
        add.textContent = '+ Question'; add.addEventListener('click', () => {
          if (byId('shell-seeker-import')) byId('shell-seeker-import').hidden = true;
          if (byId('shell-hider-import')) byId('shell-hider-import').hidden = true;
          document.querySelectorAll('[data-question-import]').forEach(button => button.setAttribute('aria-expanded', 'false'));
          questionAction = typeof typePickerOpen !== 'undefined' && typePickerOpen ? 'add' : null;
        });
      }
      const picker = byId('type-picker'); if (picker) { picker.classList.add('shell-question-type-sheet'); panel.append(picker); }
      const originalImport = byId('seeker-code-input-wrap');
      if (originalImport) {
        const sheet = makeQuestionImport('seeker', 'Import code', originalImport); panel.append(sheet);
        const button = document.createElement('button'); button.type = 'button'; button.className = 'shell-question-import-button'; button.textContent = 'Paste code'; button.dataset.questionImport = 'seeker';
        button.setAttribute('aria-controls', sheet.id); button.setAttribute('aria-expanded', 'false'); button.addEventListener('click', () => showQuestionImport('seeker', button)); seeker.append(button);
      }
    }
    const hider = byId('hider-footer');
    if (hider) {
      const originalImport = hider.querySelector('.code-input-wrap');
      if (originalImport) {
        const sheet = makeQuestionImport('hider', 'Import code', originalImport); panel.append(sheet);
        const button = document.createElement('button'); button.type = 'button'; button.className = 'add-q-btn'; button.textContent = 'Import question'; button.dataset.questionImport = 'hider';
        button.setAttribute('aria-controls', sheet.id); button.setAttribute('aria-expanded', 'false'); button.addEventListener('click', () => showQuestionImport('hider', button)); hider.prepend(button);
      }
      const endgame = hider.querySelector('[onclick*="addEndgameCard"]');
      if (endgame) { endgame.textContent = 'Endgame'; endgame.classList.add('shell-endgame-button'); endgame.style.margin = '0'; hider.append(endgame); }
      hider.querySelectorAll(':scope > .code-input-wrap').forEach(wrap => { if (!wrap.children.length) wrap.remove(); });
    }
    const togglePicker = window.toggleTypePicker;
    if (typeof togglePicker === 'function') window.toggleTypePicker = function (...args) {
      const willOpen = typeof typePickerOpen !== 'undefined' ? !typePickerOpen : true;
      closeQuestionActions();
      if (!willOpen) return;
      const result = togglePicker.apply(this, args); questionAction = 'add'; return result;
    };
    for (const [role,footer] of [['seeker',seeker],['hider',hider]]) if(footer){
      const paste=document.createElement('button');paste.type='button';paste.className='shell-question-import-button';paste.textContent='Quick paste';paste.dataset.clipboardPaste=role;paste.dataset.questionImport=role;paste.setAttribute('aria-controls','shell-'+role+'-import');paste.setAttribute('aria-expanded','false');
      paste.addEventListener('click',async()=>{
        closeQuestionActions();showQuestionImport(role,paste);
        const field=byId(role+'-code-field');
        try{
          if(!navigator.clipboard?.readText)throw Error('Clipboard unavailable');
          const text=(await navigator.clipboard.readText()).trim();
          if(typeof mode!=='undefined'&&mode!==role)return;
          if(!text){showToast('Clipboard is empty. You can paste or type a code below.');return;}
          field.value=text;field.dispatchEvent(new Event('input',{bubbles:true}));
          const decode=window[role==='hider'?'decodeAndAdd':'seekerDecodeAndAdd'];if(typeof decode==='function')decode();
        }catch(_){showToast('Touch and hold the code field to paste, or type a code.');field?.focus({preventScroll:true});}
      });footer.append(paste);
    }
    for (const footer of [seeker, hider]) if (footer) {
      const toolbar = document.createElement('div'); toolbar.className = 'shell-question-toolbar';
      footer.querySelectorAll(':scope > button').forEach(button => toolbar.append(button)); footer.append(toolbar);
    }
    for (const [name, role] of [['seekerDecodeAndAdd', 'seeker'], ['decodeAndAdd', 'hider']]) {
      const decode = window[name]; if (typeof decode !== 'function') continue;
      window[name] = function (...args) {
        const field = byId(role + '-code-field'); const before = field?.value;
        const result = decode.apply(this, args);
        if (before && field && !field.value) closeQuestionActions();
        return result;
      };
    }
    const quickAdd = window.quickAddOrCode;
    if (typeof quickAdd === 'function') window.quickAddOrCode = function (...args) {
      if (currentRole() === 'hider') {
        open('questions', { focus: false });
        showQuestionImport('hider', document.querySelector('[data-question-import="hider"]'));
        return;
      }
      return quickAdd.apply(this, args);
    };
  }

  function makeQuestionImport(role, title, content) {
    const sheet = document.createElement('section'); sheet.id = `shell-${role}-import`; sheet.className = 'shell-question-action-sheet'; sheet.hidden = true;
    const head = document.createElement('div'); head.className = 'shell-question-sheet-heading';
    const label = document.createElement('strong'); label.textContent = title;
    const close = document.createElement('button'); close.type = 'button'; close.className = 'shell-close-button'; close.innerHTML = icon('close'); close.setAttribute('aria-label', 'Close code entry'); close.addEventListener('click', closeQuestionActions);
    head.append(label, close); sheet.append(head, content);
    return sheet;
  }

  const settingGroups = [
    { key: 'map', title: 'Map & layers', icon: 'map', labels: ['Map Layer', 'Map style', 'Map overlays', 'Map providers', 'Thunderforest Key'] },
    { key: 'game', title: 'Game & questions', icon: 'questions', labels: ['Game', 'Game Area', 'Curses', 'Questions', 'Round'] },
    { key: 'appearance', title: 'Appearance', icon: 'settings', labels: ['Layout', 'Display', 'Appearance', 'Performance', 'Comfort'] },
    { key: 'account', title: 'Account & GPS', icon: 'menu', labels: ['Account', 'Location Sharing', 'Trackers', 'GPS'] },
    { key: 'places', title: 'Places & planning', icon: 'questions', labels: ['Seeker workspace', 'Distance planning', 'Saved places', 'Place layers', 'Places'] },
    { key: 'advanced-map', title: 'Map tools', icon: 'map', labels: ['Map tools', 'Map combinations', 'Local details', '3D explorer', 'Custom map sources'] },
    { key: 'transit', title: 'Transit', icon: 'transit', hint: 'Live vehicles, routes and stops', labels: ['Live Trains', 'Live Transit', 'SL Data'] },
    { key: 'other', title: 'More tools', icon: 'settings', hint: 'Additional game options', labels: [] }
  ];

  function setupAppearance() {
    const legacy = byId('theme-sp-btn');
    if (!legacy || typeof THEMES === 'undefined') return;
    legacy.hidden = true;
    const picker = document.createElement('div'); picker.className = 'shell-theme-picker'; picker.setAttribute('role', 'group'); picker.setAttribute('aria-label', 'Interface theme');
    for (const theme of THEMES) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.themeChoice = theme;
      button.innerHTML = `<span class="shell-theme-dot" aria-hidden="true"></span><span>${safeText(THEME_LABELS[theme])}</span><span class="shell-theme-check" aria-hidden="true">✓</span>`;
      button.addEventListener('click', () => applyTheme(theme)); picker.append(button);
    }
    legacy.after(picker);
    const sync = () => picker.querySelectorAll('[data-theme-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === currentTheme)));
    document.addEventListener('jetlag:themechange', sync); sync();
  }

  function refreshSettings() {
    const panel = byId('settings-panel');
    const body = byId('shell-settings-body');
    if (!panel || !body) return;
    const ungrouped = Array.from(panel.children).filter(child => child !== body && child.querySelector?.(':scope > .sp-label'));
    for (const section of ungrouped) {
      const label = section.querySelector('.sp-label')?.textContent.trim();
      if (label === 'Location Sharing' && !section.id) section.id = 'position-settings-host';
      section.classList.remove('advanced-only');
      const definition = settingGroups.find(group => group.key === section.dataset.settingsCategory) || settingGroups.find(group => group.labels.includes(label)) || settingGroups[settingGroups.length - 1];
      const group = body.querySelector(`[data-shell-group="${definition.key}"]`);
      section.classList.add('shell-settings-section');
      if (definition.key === 'advanced-map') {
        const disclosure = document.createElement('details'); disclosure.className = 'shell-setting-disclosure';
        const summary = document.createElement('summary'); summary.textContent = label;
        section.querySelector('.sp-label')?.remove();
        disclosure.append(summary, section); group?.append(disclosure);
        disclosure.addEventListener('toggle', () => { if (disclosure.open && !byId('shell-settings-search')?.value.trim()) group.querySelectorAll('.shell-setting-disclosure').forEach(other => { if (other !== disclosure && other.open) other.open = false; }); });
      } else group?.append(section);
    }
    filterSettings();
  }

  function selectSettingsCategory(key, options = {}) {
    settingsCategory = settingGroups.some(group => group.key === key) ? key : null;
    const search = byId('shell-settings-search'); if (search) search.value = '';
    const searchWrap = byId('shell-settings-search-wrap'); if (searchWrap) searchWrap.hidden = true;
    byId('shell-settings-search-toggle')?.setAttribute('aria-expanded', 'false');
    filterSettings(); byId('shell-settings-body').scrollTop = 0;
    if (options.focus !== false) {
      if (settingsCategory) byId('shell-settings-category-title')?.focus({ preventScroll: true });
      else byId('shell-settings-home')?.querySelector('button:not([hidden])')?.focus({ preventScroll: true });
    }
  }

  function openSettingsSection(id, options = {}) {
    refreshSettings();
    const section = typeof id === 'string' ? byId(id) : id;
    const group = section?.closest('.shell-settings-group');
    open('settings', { focus: false, ...options });
    if (!group) { selectSettingsCategory(null, { focus: false }); return false; }
    selectSettingsCategory(group.dataset.shellGroup, { focus: false });
    const disclosure = section.closest('.shell-setting-disclosure'); if (disclosure) disclosure.open = true;
    section.scrollIntoView({ block: 'start', behavior: 'auto' });
    return true;
  }

  function registerPanel(name, panelOrId, options = {}) {
    const panel = typeof panelOrId === 'string' ? byId(panelOrId) : panelOrId;
    if (!name || !panel?.id) return false;
    panels[name] = panel.id;
    if (options.geometry !== false) panel.classList.add('shell-aux-panel');
    panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', options.label || name);
    panel.inert = activePanel !== name; panel.setAttribute('aria-hidden', String(panel.inert));
    observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
    return true;
  }

  function filterSettings() {
    const term = (byId('shell-settings-search')?.value || '').trim().toLocaleLowerCase();
    const body = byId('shell-settings-body');
    if (!body) return;
    let matches = 0;
    byId('shell-settings-home').hidden = Boolean(term || settingsCategory);
    byId('shell-settings-category-bar').hidden = !term && !settingsCategory;
    byId('settings-panel').dataset.settingsView = term ? 'search' : settingsCategory || 'home';
    byId('shell-settings-category-title').textContent = term ? 'Search settings' : settingGroups.find(group => group.key === settingsCategory)?.title || 'Settings';
    body.querySelectorAll('.shell-settings-group').forEach(group => {
      let visible = 0;
      const title = group.querySelector('summary')?.textContent.toLocaleLowerCase() || '';
      group.querySelectorAll('.shell-settings-section').forEach(section => {
        const sectionTitle = section.closest('.shell-setting-disclosure')?.querySelector('summary')?.textContent.toLocaleLowerCase() || '';
        const matched = !term || (title + ' ' + sectionTitle + ' ' + section.textContent.toLocaleLowerCase()).includes(term);
        const disclosure = section.closest('.shell-setting-disclosure');
        if (disclosure) { disclosure.hidden = !matched; if (term && matched) disclosure.open = true; }
        section.hidden = !matched;
        if (matched) visible++;
      });
      const hasSections = Boolean(group.querySelector('.shell-settings-section'));
      const categoryButton = byId('shell-settings-home').querySelector(`[data-settings-category="${group.dataset.shellGroup}"]`);
      if (categoryButton) categoryButton.hidden = !hasSections;
      group.hidden = !visible || (!term && settingsCategory !== group.dataset.shellGroup);
      if (!group.hidden) group.open = true;
      matches += visible;
    });
    byId('shell-settings-empty').hidden = !term || Boolean(matches);
  }

  function setupSettings() {
    const panel = byId('settings-panel');
    if (!panel) return;
    const legacyHead = panel.querySelector(':scope > .settings-head');
    // Settings categories expose their own controls; no global visibility switch.
    if (legacyHead) legacyHead.hidden = true;
    const themeSection = byId('theme-sp-btn')?.parentElement;
    if (themeSection) panel.prepend(themeSection);
    panel.querySelectorAll('.advanced-only').forEach(node => node.classList.remove('advanced-only'));
    setupAppearance();
    const areaLabel = byId('area-mode-normal')?.closest('.sp-pills')?.previousElementSibling;
    if (areaLabel?.classList.contains('sp-label')) {
      const section = document.createElement('div'); section.dataset.settingsCategory = 'game';
      const areaButtons = areaLabel.nextElementSibling; section.append(areaLabel, areaButtons);
      if (byId('area-opacity-row')) section.append(byId('area-opacity-row'));
      panel.append(section);
    }
    const search = document.createElement('div'); search.className = 'shell-settings-search'; search.id = 'shell-settings-search-wrap'; search.hidden = true;
    search.innerHTML = '<input id="shell-settings-search" type="search" placeholder="Search all settings…" aria-label="Search all settings" autocomplete="off">';
    const body = document.createElement('div'); body.id = 'shell-settings-body';
    const home = document.createElement('div'); home.id = 'shell-settings-home'; home.className = 'shell-settings-categories';
    settingGroups.forEach(group => {
      const category = document.createElement('button'); category.type = 'button'; category.className = 'shell-settings-category'; category.dataset.settingsCategory = group.key;
      category.innerHTML = `${icon(group.icon)}<span><strong>${safeText(group.title)}</strong></span><span aria-hidden="true">›</span>`;
      category.addEventListener('click', () => selectSettingsCategory(group.key)); home.append(category);
    });
    body.append(home);
    settingGroups.forEach(group => {
      const details = document.createElement('details'); details.className = 'shell-settings-group'; details.dataset.shellGroup = group.key;
      details.open = true; details.innerHTML = `<summary>${safeText(group.title)}</summary>`; body.append(details);
    });
    const categoryBar = document.createElement('div'); categoryBar.id = 'shell-settings-category-bar'; categoryBar.className = 'shell-settings-category-bar'; categoryBar.hidden = true;
    categoryBar.innerHTML = '<button type="button" class="shell-settings-back" aria-label="Back to settings categories">‹ Back</button><h3 id="shell-settings-category-title" tabindex="-1">Settings</h3>';
    categoryBar.querySelector('button').addEventListener('click', () => selectSettingsCategory(null));
    const empty = document.createElement('div'); empty.id = 'shell-settings-empty'; empty.className = 'shell-settings-empty'; empty.hidden = true;
    empty.textContent = 'No matching settings. Try “map”, “lines” or “theme”.'; body.append(empty);
    panel.append(search, categoryBar, body);
    // Put search immediately below the fixed heading, before the scrolling groups.
    panel.querySelector('.shell-panel-header').after(search);
    search.after(categoryBar);
    const searchToggle = document.createElement('button'); searchToggle.type = 'button'; searchToggle.id = 'shell-settings-search-toggle'; searchToggle.className = 'shell-close-button';
    searchToggle.innerHTML = '<svg class="shell-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>';
    searchToggle.setAttribute('aria-label', 'Search all settings'); searchToggle.setAttribute('aria-controls', search.id); searchToggle.setAttribute('aria-expanded', 'false');
    panel.querySelector('.shell-panel-header [data-shell-close]').before(searchToggle);
    searchToggle.addEventListener('click', () => {
      search.hidden = !search.hidden; searchToggle.setAttribute('aria-expanded', String(!search.hidden));
      if (!search.hidden) byId('shell-settings-search').focus({ preventScroll: true });
      else { byId('shell-settings-search').value = ''; filterSettings(); }
    });
    refreshSettings();
    byId('shell-settings-search').addEventListener('input', filterSettings);
    const descriptions = {
      'trains-sp-btn': 'Show available live vehicle positions. Updates depend on the transit feed.',
      'sl-live-btn': 'Limit live vehicles to the lines you selected in Transit.',
      'move-lock-setting-btn': 'Lock question pins after a 60-second move window.',
      'seeker-code-menu-btn': 'Allow importing question and answer codes from the Import code button.',
      'bottom-bar-btn': 'Phones always show the navigation dock. This preference also shows it on larger screens.',
      'city-boundary-btn': 'Shade areas outside Stockholm to keep the search focused.',
      'hide-locked-btn': 'Reduce map clutter while keeping locked clues in your Questions list.'
    };
    for (const [id, text] of Object.entries(descriptions)) {
      const button = byId(id);
      if (!button) continue;
      button.title = text;
    }
    const layoutTitle = byId('bottom-bar-btn')?.querySelector('span');
    if (layoutTitle) layoutTitle.textContent = 'Navigation dock on desktop';
    const label = byId('marker-size-slider')?.parentElement?.querySelector('label');
    if (label) label.setAttribute('for', 'marker-size-slider');
    for (const [id, text] of [['panel-width-slider','Question panel'],['zone-radius-slider','Hiding radius'],['tracker-pull-seconds-new','Tracker refresh']]) {
      const label = byId(id)?.closest('.sp-slider-row')?.querySelector('label');
      if (label) { label.textContent = text; label.htmlFor = id; }
    }
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
    dialog.innerHTML = '<section class="shell-help-card" role="dialog" aria-modal="true" aria-labelledby="shell-help-title" tabindex="-1"><div class="shell-panel-header"><div class="shell-panel-heading"><div class="shell-help-eyebrow">Stockholm field guide</div><h2 id="shell-help-title">Your next move.</h2></div><button type="button" class="shell-close-button" data-shell-help-close aria-label="Close guide"></button></div><p id="shell-help-intro"></p><ol class="shell-help-steps" id="shell-help-steps"></ol><details class="shell-guide-more"><summary>Map, transit & player trackers</summary><p>Blue shading rules an area out. Clear areas remain possible based on the answers you recorded. Use View map on a question to inspect its actual pins and coverage.</p><p>Transit shows public vehicles from the available feed. Menu → Trackers shows the player devices shared with your account. Their age and accuracy matter: a reported position is not a guaranteed current location.</p><p>Settings → Map & layers changes backgrounds and overlays. Places & planning helps you compare places and keep a shortlist. Account & GPS contains your own location controls.</p></details><div class="shell-help-actions"><button type="button" class="shell-primary" data-shell-guide-start>Open Questions</button><button type="button" class="shell-secondary" data-shell-help-close>Close guide</button></div></section>';
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
      ['Add a question', 'Open Questions → Add question. Choose a clue, then open its details to set it up. Search and filters are tucked into the small filter button at the top.'],
      ['Set the question on the map', 'Use the question’s pin controls, drag unlocked markers to the right location and review the preview before sending a code.'],
      ['Record the answer', 'Use Import code for the hider’s answer, or choose the answer in the question card. Tap the selected bottom tab or the close button to return to the map.']
    ] : [
      ['Set your hiding location', 'Open Questions and use the hiding-location card to place your pin. Lock it once you are happy with the position.'],
      ['Import a question', 'Open Questions → Import question and paste the seeker’s code. Check the preview and your hiding pin before copying the answer.'],
      ['Use your curse deck', 'The Curses button is in the top bar. Browse effects, unlock your deck to edit it, and check requirements before playing a card.']
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
      if (account.parentElement !== destination) { if (started) destination.prepend(account); else destination.append(account); }
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
    coach.hidden = true;
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
    if (questionAction === 'add' && toggle?.style.display === 'none') questionAction = null;
    const actualOpen = Object.entries(panels).filter(([, id]) => byId(id).classList.contains('open')).map(([name]) => name);
    if (activePanel && !actualOpen.includes(activePanel)) applyPanelState(null);
  }

  function scheduleSync() { if (!queuedSync) { queuedSync = true; queueMicrotask(syncUI); } }

  document.body.classList.add('app-shell');
  setupMainMenu(); setupNavigation(); setupPanelHeaders(); setupScrollablePanels(); setupQuestionWorkspace(); setupSettings(); setupWelcome(); setupHelp();
  window.appShell = { open, close, closeAll: close, closePanels: () => close({ restoreFocus: false }), toggle, refreshSettings, openSettingsSection, selectSettingsCategory, registerPanel, showHelp, get activePanel() { return activePanel; } };
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

  window.addEventListener('keydown', event => {
    const help = byId('shell-help');
    if (event.key === 'Escape') {
      if (!help.hidden || questionAction || byId('shell-question-filters')?.open || activePanel) event.stopImmediatePropagation();
      if (!help.hidden) { event.preventDefault(); closeHelp(); }
      else if (questionAction) { event.preventDefault(); closeQuestionActions(); }
      else if (byId('shell-question-filters')?.open) { event.preventDefault(); byId('shell-question-filters').open = false; }
      else if (activePanel) { event.preventDefault(); close(); }
    }
    if (event.key === 'Tab' && !help.hidden) {
      const focusable = Array.from(help.querySelectorAll('button, input, [tabindex="0"]')).filter(node => !node.hidden && !node.disabled);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }, true);
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
