/* Chromium checks for presets, played history and compact mobile controls. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.work','question-usage');fs.mkdirSync(out,{recursive:true});
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

    assert.equal(await page.locator('#mnav-map-btn').count(),0);assert.equal(await page.locator('#mnav-checklist-btn').count(),1);
    await page.evaluate(()=>{map.setView([59.34,18.05],15);addQuestion('radar');lampskeneQuestions.edit(questions[0].id);});
    await page.locator('#q-card-1 .usage-preset').selectOption('radar/500');
    assert.equal(await page.evaluate(()=>questions[0].radius),'500');await page.waitForFunction(()=>document.getElementById('rad-inp-1').value==='500');
    const controls=await page.locator('#q-card-1 .usage-radius-row').evaluate(row=>({units:row.querySelector('.unit-toggle').getBoundingClientRect().right,select:row.querySelector('select').getBoundingClientRect().left}));assert.ok(controls.select>=controls.units,'preset sits to the right of m/km');
    await page.evaluate(()=>toggleSeekerLock(1));assert.equal(await page.evaluate(()=>lampskeneQuestionUsage.cost('radar/500').used),1);assert.match(await page.locator('#q-card-1 .usage-card-cost').innerText(),/Next ×2/);
    await page.evaluate(()=>{toggleSeekerLock(1);toggleSeekerLock(1);addQuestion('radar');lampskeneQuestions.edit(questions.at(-1).id);});
    await page.locator('#rad-inp-2').fill('500');assert.equal(await page.evaluate(()=>lampskeneQuestionUsage.summary(questions[1]).key),'radar/custom','unused Custom is cheaper than repeated 500 m');
    await page.evaluate(()=>{toggleSeekerLock(2);addQuestion('radar');lampskeneQuestions.edit(questions.at(-1).id);});
    await page.locator('#rad-inp-3').fill('500');assert.equal(await page.evaluate(()=>lampskeneQuestionUsage.summary(questions[2]).key),'radar/500','matching preset wins equal prices');
    await page.evaluate(()=>toggleSeekerLock(3));assert.equal(await page.evaluate(()=>lampskeneQuestionUsage.cost('radar/500').used),2);
    await page.reload({waitUntil:'load'});await page.waitForFunction(()=>typeof map!=='undefined'&&map?.getZoom()&&getComputedStyle(document.getElementById('loading-screen')).display==='none');
    assert.equal(await page.evaluate(()=>lampskeneQuestionUsage.cost('radar/500').used),2,'history survives reload');assert.equal(await page.evaluate(()=>lampskeneQuestionUsage.cost('radar/custom').used),1);
    await page.evaluate(()=>{addAngleQuestion();lampskeneQuestions.edit(questions.at(-1).id);});
    let angle=await page.evaluate(()=>questions.at(-1).id);await page.locator('#angle-card-'+angle+' .usage-preset').selectOption('angle/3000');
    await page.evaluate(id=>{setAngleQuestionMode(id,'triple');toggleAngleLock(id);},angle);assert.equal(await page.evaluate(()=>lampskeneQuestionUsage.cost('angle/3000').used),1);
    await page.evaluate(()=>{addAngleQuestion();lampskeneQuestions.edit(questions.at(-1).id);});angle=await page.evaluate(()=>questions.at(-1).id);await page.locator('#angle-card-'+angle+' .usage-preset').selectOption('angle/3000');
    assert.match(await page.locator('#angle-card-'+angle+' .usage-card-cost').innerText(),/Cost ×2/);
    await page.evaluate(()=>{addQuestion('thermo');lampskeneQuestions.edit(questions.at(-1).id);});const thermo=await page.evaluate(()=>questions.at(-1).id);await page.locator('#q-card-'+thermo+' .usage-preset').selectOption('thermo/2000');assert.equal(await page.evaluate(()=>questions.at(-1).questionDistance),2000);await page.waitForFunction(()=>document.querySelector('#q-card-'+questions.at(-1).id+' .usage-size-input')?.value==='2',undefined,{timeout:1000});
    for(const width of [320,390,1440]){
      await page.setViewportSize({width,height:844});await page.evaluate(()=>appShell.open('questions'));await page.waitForTimeout(100);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no page overflow');
      await page.screenshot({path:path.join(out,'preset-'+width+'.png')});
      await page.evaluate(()=>lampskeneQuestionUsageUI.open());assert.equal(await page.locator('#question-checklist').isVisible(),true);await page.screenshot({path:path.join(out,'checklist-'+width+'.png')});
      const b=await page.locator('#question-checklist').boundingBox();assert.ok(b.height<=560&&b.width<=390,'tracker stays compact');
    }
    await page.locator('[data-category="photo"]').click();assert.equal(await page.locator('.usage-row').count(),10);const tree=page.locator('.usage-row').first();await tree.locator('input[type=checkbox]').check();await page.waitForFunction(()=>lampskeneQuestionUsage.cost('photo/tree').used===1);await page.locator('.usage-row').first().locator('.usage-again').click();await page.waitForFunction(()=>lampskeneQuestionUsage.cost('photo/tree').multiplier===3);
    await page.locator('[data-category="radar"]').click();const row500=page.locator('.usage-row').filter({has:page.locator('strong',{hasText:/^500 m$/})});await row500.locator('input[type=checkbox]').uncheck();await page.waitForFunction(()=>lampskeneQuestionUsage.cost('radar/500').used===0);await page.evaluate(()=>saveState());assert.equal(await page.evaluate(()=>lampskeneQuestionUsage.cost('radar/500').used),0,'correcting history does not auto-mark locked cards again');
    assert.deepEqual(errors,[],'no browser runtime errors');console.log('Question preset, usage and mobile checks passed. Screenshots:',out);
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
