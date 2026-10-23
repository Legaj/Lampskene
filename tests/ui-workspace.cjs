/* Optional browser integration check. Run with Playwright on NODE_PATH. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const out = path.join(root, '.work', 'ui-review');
fs.mkdirSync(out, { recursive: true });
// Authentication is isolated to this HTTP response, never to the production file.
let preview = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .replace(/<script\b[^>]*type="module"[^>]*>[\s\S]*?<\/script>/g, '')
  .replace('window.addEventListener("load", initFirebase);', '')
  .replace(/<script src="map-utils.js[^\"]*"><\/script>/, `<script>
isRealGoogleUser=()=>true;activeRoundId='ui-test';activeRoundIsTest=true;
mainUser={uid:'local-ui-test',email:''};mainProfile={username:'Local UI test'};
window.addEventListener('load',()=>chooseMode('seeker'));
</script>$&`);
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/preview') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(preview); return; }
  const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  const types = { '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.geojson':'application/geo+json', '.svg':'image/svg+xml' };
  fs.readFile(file, (error, bytes) => { res.writeHead(error ? 404 : 200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); res.end(error ? '' : bytes); });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless:true, channel:process.env.BROWSER_CHANNEL || 'msedge' });
  try {
    const page = await browser.newPage({ viewport:{ width:390,height:844 }, hasTouch:true });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/preview`, { waitUntil:'load' });
    await page.waitForFunction(() => typeof map !== 'undefined' && map?.getZoom());
    await page.waitForFunction(() => getComputedStyle(document.getElementById('loading-screen')).display === 'none');
    await page.evaluate(() => { addQuestion('radar'); addQuestion('thermo'); addMatchingQuestion(); addMeasuringQuestion(); addAngleQuestion(); });
    const checkLayout = async label => {
      await page.waitForTimeout(180); // Let the panel's 150ms entry transition finish.
      const size = await page.evaluate(() => ({ width:innerWidth, scroll:document.documentElement.scrollWidth,
        panel:[...document.querySelectorAll('#sidebar,#sl-panel,#settings-panel,#curse-panel')].filter(n=>n.classList.contains('open')).map(n=>({id:n.id,width:n.getBoundingClientRect().width,bottom:n.getBoundingClientRect().bottom})),
        dock:document.getElementById('mobile-nav').getBoundingClientRect().top }));
      assert.ok(size.scroll <= size.width, `${label}: no horizontal overflow`);
      assert.ok(size.panel.length <= 1, `${label}: one workspace at a time`);
      await page.screenshot({ path:path.join(out,label+'.png') });
      if(size.width<=768) for(const panel of size.panel) assert.ok(panel.bottom<=size.dock, `${label}: dock remains accessible ${JSON.stringify(size)}`);
    };
    for (const viewport of [{ width:390,height:844 },{ width:320,height:568 },{ width:844,height:390 },{ width:1440,height:1000 }]) {
      await page.setViewportSize(viewport);
      const prefix = `${viewport.width}x${viewport.height}`;
      await page.evaluate(() => appShell.open('questions')); await checkLayout(prefix+'-questions');
      const card = page.locator('#question-list .q-card').first();
      assert.ok(await card.locator('.qe-compact-controls').isVisible(), 'answers available without expanding');
      await page.evaluate(() => appShell.open('settings')); await checkLayout(prefix+'-settings');
      assert.equal(await page.locator('#shell-settings-home [data-settings-category="transit"]').isVisible(),false);
      await page.evaluate(() => appShell.selectSettingsCategory('appearance'));
      await page.locator('[data-theme-choice="sepia"]').click();
      assert.equal(await page.evaluate(() => currentTheme),'sepia');
      assert.equal(await page.locator('[data-theme-choice="sepia"]').getAttribute('aria-pressed'),'true');
      await checkLayout(prefix+'-sepia');
      await page.evaluate(() => { appShell.open('transit'); lampskeneTransit.select('routes'); }); await checkLayout(prefix+'-routes');
      await page.locator('#sl-tab-live').click();
      assert.equal(await page.locator('#sl-page-routes').isVisible(),false);
      assert.equal(await page.locator('#sl-page-live').isVisible(),true); await checkLayout(prefix+'-live');
      await page.locator('#sl-tab-departures').click(); await checkLayout(prefix+'-departures');
      await page.evaluate(() => appShell.open('curses')); await checkLayout(prefix+'-curses');
    }
    await page.setViewportSize({ width:390,height:844 });
    for (const theme of ['bambu','kelp','dark','light','sepia','ocean','dusk','graphite']) {
      await page.evaluate(theme => { applyTheme(theme); appShell.open('questions'); }, theme);
      assert.equal(await page.evaluate(() => document.body.dataset.theme),theme);
      await checkLayout('theme-'+theme);
    }
    await page.locator('#mnav-map-btn').click();
    await checkLayout('phone-map');
    assert.equal(await page.evaluate(() => appShell.activePanel),null);
    assert.equal(await page.locator('#mnav-map-btn').getAttribute('aria-current'),'page');
    assert.equal(await page.locator('#shell-help-btn').count(),0);
    await page.evaluate(() => { applyTheme('sepia'); switchMode('hider', true); });
    await page.waitForFunction(() => mode === 'hider');
    await page.evaluate(() => appShell.open('questions'));
    await checkLayout('hider-questions');
    assert.ok(await page.locator('#hider-footer').isVisible(),'hider code toolbar is available');
    assert.equal(await page.locator('#hider-goto-btn').isDisabled(),false,'Place pin works before a hiding pin exists');
    await page.locator('#hider-goto-btn').click();
    assert.equal(await page.evaluate(() => appShell.activePanel),null,'Place pin returns to the interactive map');
    await page.evaluate(() => { map.fire('click',{latlng:L.latLng(59.33,18.06)}); appShell.open('questions'); });
    await page.waitForFunction(() => document.getElementById('hider-lock-btn').disabled === false);
    await page.locator('#hider-lock-btn').click();
    assert.equal(await page.evaluate(() => hiderPinLocked),true,'hider lock still works');
    await checkLayout('hider-pin-placed');
    await page.evaluate(() => appShell.open('curses')); await checkLayout('hider-curses');
    assert.deepEqual(errors,[],'no browser JavaScript errors');
    console.log('Browser workspace checks passed. Screenshots:',out);
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode=1; });
