/* Real Chromium checks for map controls, local-detail recovery and 3D geometry. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.work','map-update');fs.mkdirSync(out,{recursive:true});
const preview=fs.readFileSync(path.join(root,'index.html'),'utf8')
  .replace(/<script\b[^>]*type="module"[^>]*>[\s\S]*?<\/script>/g,'')
  .replace('window.addEventListener("load", initFirebase);','')
  .replace(/<script src="map-utils.js[^\"]*"><\/script>/,`<script>isRealGoogleUser=()=>true;activeRoundId='map-update-test';activeRoundIsTest=true;mainUser={uid:'local-map-test',email:''};mainProfile={username:'Map test'};window.addEventListener('load',()=>chooseMode('seeker'));</script>$&`);
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');if(url.pathname==='/preview'){res.writeHead(200,{'Content-Type':'text/html'});res.end(preview);return;}
  const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  const types={'.js':'application/javascript','.css':'text/css','.json':'application/json','.geojson':'application/geo+json'};
  fs.readFile(file,(error,bytes)=>{res.writeHead(error?404:200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(error?'':bytes);});
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'chrome'});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/preview`,{waitUntil:'load'});
    await page.waitForFunction(()=>typeof map!=='undefined'&&map?.getZoom()&&getComputedStyle(document.getElementById('loading-screen')).display==='none');
    await page.evaluate(()=>{map.setView([59.342,18.048],15);addQuestion('radar');questions[0].radius='500';redrawOutlineCircle(questions[0]);lampskeneQuestions.preview(questions[0].id);});
    await page.evaluate(()=>toggleSeekerLock(questions[0].id));
    assert.equal(await page.evaluate(()=>questions[0].marker.getElement().style.display),'none','locked question pin hides');
    assert.equal(await page.evaluate(()=>lampskeneQuestions.publicPins().length),0,'3D pins respect locked visibility');
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(()=>Object.values(map._layers).filter(l=>l.options?.radius===8&&l.options?.fillColor==='#16879a').length),0,'preview duplicates disappear on lock');
    await page.evaluate(()=>{toggleHideLockedPins();});
    assert.equal(await page.evaluate(()=>questions[0].marker.getElement().style.display),'','visibility preference restores marker');
    await page.evaluate(()=>{toggleSeekerLock(questions[0].id);appShell.open('questions');});
    assert.equal(await page.locator('#q-card-1 .move-window-btn').count(),0,'radar has no 60 second button');
    assert.equal(await page.locator('#q-card-1 .qe-coordinates').isVisible(),false,'coordinates default off');
    await page.evaluate(()=>{appShell.open('settings');appShell.selectSettingsCategory('game');});
    await page.locator('#question-coordinates-toggle').click();
    await page.evaluate(()=>{appShell.open('questions');lampskeneQuestions.edit(1);});
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#q-card-1 .qe-coordinates>summary').isVisible(),true);
    let dialog=page.waitForEvent('dialog');const cancelled=page.evaluate(()=>removeQuestion(1));let prompt=await dialog;assert.match(prompt.message(),/Delete radar/);await prompt.dismiss();await cancelled;
    assert.equal(await page.evaluate(()=>questions.length),1,'cancel preserves question');
    dialog=page.waitForEvent('dialog');const deletion=page.evaluate(()=>removeQuestion(1));prompt=await dialog;await prompt.accept();await deletion;
    assert.equal(await page.evaluate(()=>questions.length),0,'confirm deletes question');
    await page.evaluate(()=>{addAngleQuestion();lampskeneQuestions.edit(questions[0].id);});
    for(const width of [320,390,1440]){
      await page.setViewportSize({width,height:1000});await page.waitForTimeout(180);
      const boxes=await page.locator('.qe-angle-modes .aq-mode').evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width};}));
      assert.equal(boxes.length,4);assert.ok(boxes.every(b=>Math.abs(b.y-boxes[0].y)<1),'four angle modes share one row');
      await page.screenshot({path:path.join(out,'angle-'+width+'.png')});
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.evaluate(()=>{addQuestion('radar');const q=questions.at(-1);q.radius='500';q.zone='inside';addQuestion('thermo');questions.at(-1).closer='A';redrawQuestionOverlay();});
    const geometry=await page.evaluate(()=>{const g=lampskeneQuestionGeometry.build({getNorth:()=>59.36,getSouth:()=>59.32,getWest:()=>18.02,getEast:()=>18.08});return{areas:g.areas.features.length,walls:g.walls.features.length,finite:JSON.stringify(g).includes('null')};});
    assert.ok(geometry.areas>0&&geometry.walls>0,JSON.stringify(geometry));assert.equal(geometry.finite,false);
    // First server fails; the backup provides real-shaped OSM data.
    let attempts=0;
    await page.route('**/api/interpreter?*',async route=>{attempts++;if(attempts===1)await route.fulfill({status:503,body:'busy'});else await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({elements:[{type:'node',id:1,lat:59.342,lon:18.048,tags:{amenity:'bench',name:'Test bench'}}]})});});
    await page.evaluate(()=>{lampskeneMapTools.chooseCircle();map.fire('click',{latlng:L.latLng(59.342,18.048)});});
    await page.locator('#field-detail-load').click();await page.waitForFunction(()=>lampskeneMapTools.details().features.length===1);assert.equal(attempts,2,'detail search recovers via backup');
    await page.evaluate(()=>lampskene3D.open());
    await page.waitForFunction(()=>lampskene3D.map?.getSource('field-vehicles'),undefined,{timeout:45000});
    await page.evaluate(()=>{lampskene3D.refresh();lampskene3D.map.jumpTo({center:[18.048,59.342],zoom:16,pitch:78});});
    await page.waitForTimeout(1800);await page.screenshot({path:path.join(out,'3d-map.png')});
    assert.equal(await page.evaluate(()=>lampskene3D.map.getMaxPitch()),85);
    assert.ok(await page.evaluate(async()=>(await lampskene3D.map.getSource('field-question-walls').getData()).features.length>0));
    assert.equal(await page.evaluate(async()=>(await lampskene3D.map.getSource('field-details').getData()).features.length),1);
    await page.evaluate(()=>lampskene3D.setBackground('tf-transport'));
    assert.match(await page.evaluate(()=>lampskene3D.map.getSource('field-basemap').tiles[0]),/thunderforest/);
    await page.evaluate(()=>lampskene3D.startExploring('walk'));
    assert.equal(await page.evaluate(()=>lampskene3D.exploration),'walk');
    const start=await page.evaluate(()=>lampskene3D.map.getCenter().toArray());
    await page.locator('#map3d-canvas canvas').focus();await page.keyboard.down('w');await page.waitForTimeout(350);await page.keyboard.up('w');
    assert.notDeepEqual(await page.evaluate(()=>lampskene3D.map.getCenter().toArray()),start,'pedestrian moves camera');
    await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>lampskene3D.exploration),'orbit');assert.equal(await page.evaluate(()=>lampskene3D.active),true);
    await page.evaluate(()=>lampskene3D.close());assert.deepEqual(errors,[],'no browser errors');
    console.log('Map update browser checks passed. Screenshots:',out);
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
