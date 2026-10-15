/* Optional visual treatments. These never read or change question/location data. */
(() => {
  'use strict';
  if (window.lampskeneFieldLab) return;
  const KEY = 'lampskene_field_lab_v1';
  const effects = [
    { key: 'radar', name: 'Radar sweep', detail: 'A slow, decorative sweep across the map.' },
    { key: 'glow', name: 'Pin glow', detail: 'A soft pulse around question and player pins.' },
    { key: 'grid', name: 'Tactical grid', detail: 'A quiet screen grid; it is not a coordinate grid.' },
    { key: 'contours', name: 'Contour art', detail: 'Decorative contour lines, unrelated to terrain.' },
    { key: 'paper', name: 'Paper grain', detail: 'A subtle field-notebook texture.' },
    { key: 'vignette', name: 'Focus vignette', detail: 'Gently shades the outer edge of the map.' }
  ];
  const defaults = { unlocked: false, intensity: 40, effects: Object.fromEntries(effects.map(effect => [effect.key, false])) };
  let prefs = { ...defaults, effects: { ...defaults.effects } };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && typeof saved === 'object') {
      prefs.unlocked = saved.unlocked === true;
      const intensity = Number(saved.intensity);
      if (Number.isFinite(intensity)) prefs.intensity = Math.max(0, Math.min(100, intensity));
      for (const { key } of effects) prefs.effects[key] = saved.effects?.[key] === true;
    }
  } catch (_) { /* A bad local preference should never stop the game. */ }
  // Undiscovered effects always stay off, including malformed old preferences.
  if (!prefs.unlocked) prefs.effects = { ...defaults.effects };
  const byId = id => document.getElementById(id);
  const playing = () => typeof mode !== 'undefined' && (mode === 'seeker' || mode === 'hider');
  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let openState = false, registered = false, previousFocus = null, taps = [];
  let pageActive = true;
  const overlay = document.createElement('div');
  overlay.id = 'field-lab-effects'; overlay.setAttribute('aria-hidden', 'true'); overlay.inert = true;
  for (const { key } of effects.filter(effect => effect.key !== 'glow')) {
    const layer = document.createElement('div'); layer.className = 'field-lab-layer field-lab-' + key; layer.dataset.labEffect = key; layer.hidden = true; overlay.append(layer);
  }
  byId('map')?.append(overlay);

  const panel = document.createElement('section');
  panel.id = 'field-lab-panel'; panel.hidden = true; panel.inert = true;
  panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', 'Field Lab visual effects');
  panel.innerHTML = '<header class="field-lab-header"><div><span class="field-lab-eyebrow">Hidden workshop</span><h2>Field Lab</h2></div><button type="button" data-field-lab-close data-shell-close aria-label="Close Field Lab">×</button></header><div class="field-lab-body"><p class="field-lab-intro">Give your map a different atmosphere. These are visual effects; clues, positions and answers stay the same.</p><div class="field-lab-preview" aria-hidden="true"><div class="field-lab-preview-roads"></div><div class="field-lab-preview-grid"></div><div class="field-lab-preview-sweep"></div><span class="field-lab-preview-pin"></span><span class="field-lab-preview-label">STYLE PREVIEW</span></div><div id="field-lab-options" class="field-lab-options"></div><label class="field-lab-intensity" for="field-lab-intensity"><span>Effect intensity <output id="field-lab-intensity-value" for="field-lab-intensity">40%</output></span><input id="field-lab-intensity" type="range" min="0" max="100" step="5" value="40"></label><p class="field-lab-motion-note" id="field-lab-motion-note"></p><div class="field-lab-actions"><button type="button" id="field-lab-preview-button" class="field-lab-primary">Preview on map</button><button type="button" id="field-lab-off">Switch all off</button></div><p class="field-lab-footnote">Saved only on this device. Effects pause behind panels, in 3D and when this page is hidden.</p></div>';
  for (const effect of effects) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'field-lab-option'; button.dataset.labToggle = effect.key;
    button.setAttribute('role', 'switch'); button.setAttribute('aria-checked', String(prefs.effects[effect.key]));
    const copy = document.createElement('span');
    const title = document.createElement('strong'); title.textContent = effect.name;
    const detail = document.createElement('small'); detail.textContent = effect.detail;
    copy.append(title, detail);
    const toggle = document.createElement('span'); toggle.className = 'field-lab-switch'; toggle.setAttribute('aria-hidden', 'true');
    button.append(copy, toggle); panel.querySelector('#field-lab-options').append(button);
    button.addEventListener('click', () => { prefs.effects[effect.key] = !prefs.effects[effect.key]; persist(); render(); });
  }
  document.body.append(panel);
  registered = window.appShell?.registerPanel?.('field-lab', panel, { geometry: false, label: 'Field Lab visual effects' }) === true;

  function persist() { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (_) { /* Local preferences are optional. */ } }
  function state() { return { unlocked: prefs.unlocked, open: openState, intensity: prefs.intensity, effects: { ...prefs.effects }, reducedMotion: Boolean(motion?.matches) }; }
  function render() {
    const any = effects.some(effect => prefs.effects[effect.key]);
    document.body.classList.toggle('field-lab-enabled', prefs.unlocked && any && prefs.intensity > 0);
    document.body.classList.toggle('field-lab-glow-enabled', prefs.unlocked && prefs.effects.glow && prefs.intensity > 0);
    document.body.classList.toggle('field-lab-suspended', !playing() || !pageActive || document.hidden || Boolean(motion?.matches));
    document.body.classList.toggle('field-lab-open', openState);
    document.body.style.setProperty('--field-lab-strength', String(prefs.intensity / 100));
    document.body.style.setProperty('--field-lab-glow-size', (2 + prefs.intensity * .055).toFixed(2) + 'px');
    overlay.hidden = !playing() || !prefs.unlocked || !any || prefs.intensity === 0;
    overlay.querySelectorAll('[data-lab-effect]').forEach(layer => { layer.hidden = !prefs.effects[layer.dataset.labEffect]; });
    panel.querySelectorAll('[data-lab-toggle]').forEach(button => button.setAttribute('aria-checked', String(prefs.effects[button.dataset.labToggle])));
    for (const { key } of effects) panel.dataset[key] = String(prefs.effects[key]);
    byId('field-lab-intensity').value = String(prefs.intensity);
    byId('field-lab-intensity-value').textContent = prefs.intensity + '%';
    byId('field-lab-motion-note').textContent = motion?.matches ? 'Your reduced-motion preference keeps animated effects still.' : 'Map effects pause behind this panel. Preview on map shows the full treatment.';
    byId('field-lab-off').disabled = !any;
    panel.hidden = !openState; panel.inert = !openState; panel.setAttribute('aria-hidden', String(!openState));
    document.querySelectorAll('[data-field-lab-entry]').forEach(button => button.setAttribute('aria-expanded', String(openState)));
  }
  function addEntries() {
    if (!prefs.unlocked) return;
    if (!byId('field-lab-settings') && byId('settings-panel')) {
      const section = document.createElement('div'); section.id = 'field-lab-settings'; section.dataset.settingsCategory = 'appearance';
      section.innerHTML = '<div class="sp-label">Field Lab</div><button type="button" class="sp-btn" data-field-lab-entry aria-controls="field-lab-panel" aria-expanded="false"><span>Visual effects</span><span>Open →</span></button><p class="shell-setting-description">Optional map atmosphere. Every effect can be switched off.</p>';
      byId('settings-panel').append(section); window.appShell?.refreshSettings?.();
    }
    if (!byId('field-lab-menu-entry') && byId('shell-menu-body')) {
      const button = document.createElement('button'); button.id = 'field-lab-menu-entry'; button.type = 'button'; button.className = 'shell-help-link field-lab-menu-entry'; button.dataset.fieldLabEntry = '';
      button.textContent = 'Field Lab'; button.setAttribute('aria-controls', panel.id); button.setAttribute('aria-expanded', 'false'); byId('shell-menu-body').append(button);
    }
  }
  function unlock(trigger) {
    const first = !prefs.unlocked; prefs.unlocked = true; persist(); addEntries(); render();
    if (first && typeof showToast === 'function') showToast('Field Lab unlocked · also in Appearance and Menu');
    return open(trigger);
  }
  function open(trigger) {
    if (!playing()) return false;
    if (document.body.classList.contains('map3d-active')) { if (typeof showToast === 'function') showToast('Close the 3D explorer to open Field Lab'); return false; }
    if (!prefs.unlocked) return false;
    previousFocus = trigger || document.activeElement; openState = true; render();
    if (registered) {
      Promise.resolve(window.appShell.open('field-lab', { focus: false, trigger: previousFocus })).then(ok => { if (ok === false && openState) close(); });
    }
    panel.querySelector('[data-field-lab-close]').focus({ preventScroll: true }); return true;
  }
  function close() {
    if (registered && window.appShell?.activePanel === 'field-lab') window.appShell.close();
    openState = false; render();
    if (!registered && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }
  function switchAllOff() { prefs.effects = { ...defaults.effects }; persist(); render(); }
  function activateShortcut(trigger) {
    const now = Date.now(); taps = taps.filter(time => now - time <= 2000); taps.push(now);
    if (taps.length >= 5) { taps = []; unlock(trigger); }
  }
  const title = document.querySelector('#header h1');
  if (title) {
    title.tabIndex = 0; title.setAttribute('role', 'button'); title.setAttribute('aria-label', 'Jetlag. Press Enter or Space five times quickly to open Field Lab.');
    title.classList.add('field-lab-trigger');
    title.addEventListener('click', () => activateShortcut(title));
    title.addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) { event.preventDefault(); activateShortcut(title); } });
  }
  document.addEventListener('click', event => { const entry = event.target.closest?.('[data-field-lab-entry]'); if (entry) { event.preventDefault(); open(entry); } });
  panel.querySelector('[data-field-lab-close]').addEventListener('click', close);
  byId('field-lab-preview-button').addEventListener('click', close);
  byId('field-lab-off').addEventListener('click', switchAllOff);
  byId('field-lab-intensity').addEventListener('input', event => { prefs.intensity = Math.max(0, Math.min(100, Number(event.target.value) || 0)); persist(); render(); });
  document.addEventListener('jetlag:panelchange', event => { if (!registered) return; openState = event.detail?.panel === 'field-lab'; render(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && openState) { event.preventDefault(); close(); } });
  document.addEventListener('visibilitychange', render);
  document.addEventListener('jetlag:rolechange', render);
  window.addEventListener('pagehide', () => { pageActive = false; render(); });
  window.addEventListener('pageshow', () => { pageActive = true; render(); });
  if (motion?.addEventListener) motion.addEventListener('change', render);
  else motion?.addListener?.(render);
  window.lampskeneFieldLab = { state, open, close, switchAllOff };
  addEntries(); render();
})();
