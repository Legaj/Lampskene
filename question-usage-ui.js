/* Small question catalogue, preset pickers and round usage previews. */
(() => {
  'use strict';
  const rules=window.lampskeneQuestionRules,usage=window.lampskeneQuestionUsage;
  const names={radar:'Radar',thermo:'Thermo',angle:'Angle',matching:'Matching',measuring:'Measuring',photo:'Photos',extras:'Extras',endgame:'Endgame'};
  const node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
  const text=(e,value)=>{if(e&&e.textContent!==value)e.textContent=value;};
  const button=(label,action,cls='usage-button')=>{const e=node('button',cls,label);e.type='button';e.addEventListener('click',action);return e;};
  let category='radar',filter='',playedOnly=false,painting=false,scheduled=0,lastList='',applying=false;
  function schedule(){if(!scheduled)scheduled=requestAnimationFrame(()=>{scheduled=0;sync();});}
  const cardFor=q=>document.getElementById((q.type==='angle'?'angle-card-':'q-card-')+q.id);
  const defFor=q=>rules.sizeFor(q);
  const costLabel=key=>{const cost=usage.cost(key);return cost?'×'+cost.multiplier+' next':'';};
  function costText(q){const s=usage.summary(q);if(!s)return '';return(s.definition.label==='Custom'?'Custom · ':'')+(s.asked?'Played · ':'Cost ×'+s.multiplier+' · ')+s.draw+' draw / '+s.keep+' keep'+(s.used?' · Next ×'+s.multiplier:'');}
  function changed(q){
    if(typeof invalidateQuestionAnswer==='function')invalidateQuestionAnswer(q);
    if(q.type==='radar'){redrawQuestionOverlay(q);redrawOutlineCircle(q);}
    if(q.type==='angle'){angleQuestionUpdateGeometry(q);renderAngleCard(q);showAnglePreview(q);redrawQuestionOverlay();}
    if(typeof saveState==='function')saveState();window.lampskeneQuestions?.sync();schedule();
  }
  function applyPreset(q,id){
    if(q.locked||q.hiderMode)return;const preset=rules.byId(id);if(!preset||preset.type!==q.type)return;
    applying=true;try{
      q.questionUsageKey=null;q.questionPreset=id;q.questionDistance=preset.meters;
      if(q.type==='radar'){q.unit=preset.meters>=1000?'KM':'M';q.radius=String(preset.meters/(q.unit==='KM'?1000:1));}
      else q.questionUnit=preset.meters>=1000?'KM':'M';
      if(q.type==='angle'){
        if(!preset.modes[q.mode])q.mode=Object.keys(preset.modes)[0];
        if(!preset.modes[q.mode].includes(Number(q.angle)))q.angle=preset.modes[q.mode].includes(45)?45:preset.modes[q.mode][0];
        q.excludeRadius=preset.exclude||0;
      }
      changed(q);
    }finally{applying=false;}
  }
  function options(select,items,value){
    const signature=JSON.stringify(items);if(select.dataset.options!==signature){select.replaceChildren(...items.map(([v,label])=>{const e=node('option','',label);e.value=v;return e;}));select.dataset.options=signature;}
    if(select.value!==value)select.value=value;
  }
  function presetSelect(q){
    const select=node('select','usage-preset');select.setAttribute('aria-label',names[q.type]+' size preset');
    select.addEventListener('change',()=>{if(['custom','auto'].includes(select.value)){q.questionUsageKey=null;q.questionPreset=select.value;if(typeof saveState==='function')saveState();schedule();}else applyPreset(q,select.value);});return select;
  }
  function updateSize(q,card){
    if(q.hiderMode||!['radar','thermo','angle'].includes(q.type))return;
    const body=card.querySelector('.qe-adjustment-fields');if(!body)return;
    let select=body.querySelector('.usage-preset');
    if(q.type==='radar'){
      const row=body.querySelector('.radius-group');if(!row)return;row.classList.add('usage-radius-row');if(!select){select=presetSelect(q);row.append(select);}
      const input=row.querySelector('input');if(input&&(document.activeElement!==input||rules.byId(q.questionPreset))&&input.value!==String(q.radius||''))input.value=q.radius||'';
      row.querySelectorAll('.unit-btn').forEach(b=>b.classList.toggle('active',b.id==='unit-'+(q.unit==='KM'?'km':'m')+'-'+q.id));
    }else{
      let field=body.querySelector('.usage-size-fields');
      if(!field){
        field=node('div','usage-size-fields');field.append(node('label','q-label','Question size'));
        const row=node('div','usage-radius-row'),input=node('input','usage-size-input');input.type='number';input.min='1';input.step='any';input.placeholder='Custom';input.setAttribute('aria-label',names[q.type]+' travel distance');
        const units=node('div','unit-toggle');
        for(const unit of ['M','KM']){const b=button(unit==='M'?'m':'km',()=>{if(q.locked)return;q.questionUnit=unit;q.questionUsageKey=null;q.questionPreset='auto';q.questionDistance=Number(input.value)*(unit==='KM'?1000:1);if(typeof saveState==='function')saveState();schedule();},'unit-btn');b.dataset.unit=unit;units.append(b);}
        input.addEventListener('input',()=>{q.questionDistance=Number(input.value)*(q.questionUnit==='KM'?1000:1);q.questionUsageKey=null;q.questionPreset='auto';if(typeof saveState==='function')saveState();schedule();});
        select=presetSelect(q);row.append(input,units,select);field.append(row,node('small','usage-size-note'));body.prepend(field);
      }
      const input=field.querySelector('input'),unit=q.questionUnit||'M';
      const value=q.questionDistance>0?String(q.questionDistance/(unit==='KM'?1000:1)):'';if((document.activeElement!==input||rules.byId(q.questionPreset))&&input.value!==value)input.value=value;
      field.querySelectorAll('[data-unit]').forEach(b=>{b.classList.toggle('active',b.dataset.unit===unit);b.disabled=!!q.locked;});
      let actual=0;try{actual=q.type==='thermo'?map.distance([q.latA,q.lngA],[q.latB,q.lngB]):map.distance([q.center.lat,q.center.lng],[q.direction.lat,q.direction.lng]);}catch(_){}
      const preset=defFor(q),note=field.querySelector('.usage-size-note');
      text(note,(q.questionDistance>0?(q.type==='angle'?'Minimum ':'Target ')+rules.distance(q.questionDistance)+' · ':'')+'Pins '+rules.distance(Math.round(actual))+(preset?.endgame?' · Endgame only':''));
      note.classList.toggle('usage-short-distance',q.type==='angle'&&q.questionDistance>actual+.5);
      input.disabled=!!q.locked;
    }
    const entries=rules.catalogue.filter(e=>e.type===q.type&&e.meters);
    const resolved=usage.summary(q);
    options(select,[['auto','Best cost'+(resolved?' · '+resolved.definition.label+' ×'+resolved.multiplier:'')],['custom','Custom · '+costLabel(q.type+'/custom')],...entries.map(e=>[e.id,e.label+(e.endgame?' · EG':'')+' · '+costLabel(e.id)])],rules.byId(q.questionPreset)?.id||(q.questionPreset==='custom'?'custom':'auto'));select.disabled=!!q.locked;
    if(q.type==='angle'){
      const angleInput=body.querySelector('input[onchange*="setAngleQuestionAngle"]');if(!angleInput)return;
      let degrees=body.querySelector('.usage-degrees');if(!degrees){degrees=node('select','usage-degrees');degrees.setAttribute('aria-label','Angle degree preset');angleInput.parentElement.classList.add('usage-angle-row');angleInput.after(degrees);degrees.addEventListener('change',()=>{if(degrees.value==='custom')return;applying=true;try{setAngleQuestionAngle(q.id,Number(degrees.value));}finally{applying=false;}schedule();});}
      const list=defFor(q)?.modes?.[q.mode]||rules.angles.filter(a=>q.mode!=='triple'||a<=90);
      options(degrees,[['custom','Custom angle'],...list.map(a=>[String(a),a+'°'])],list.includes(Number(q.angle))?String(q.angle):'custom');degrees.disabled=!!q.locked;
    }
  }
  function updateCard(q,card){
    const summary=card.querySelector('.qe-summary');if(!summary)return;
    let line=summary.querySelector('.usage-card-cost');if(!line){line=node('span','usage-card-cost');summary.querySelector('.qe-description')?.after(line);}
    text(line,costText(q));line.title='Repeat the normal draw/keep separately for each cost multiplier.';
    updateSize(q,card);
    if(['matching','measuring'].includes(q.type))for(const option of card.querySelectorAll('select option')){
      const key=rules.keyFor({...q,questionUsageKey:null,subcat:option.value});if(!option.dataset.usageLabel)option.dataset.usageLabel=option.textContent;text(option,option.dataset.usageLabel+' · '+costLabel(key));
    }
  }
  function mapSubcategory(entry){
    const available=entry.type==='matching'&&typeof getAllMatchingData==='function'?Object.keys(getAllMatchingData()):entry.type==='measuring'&&typeof MEASURING_SUBCATS!=='undefined'?MEASURING_SUBCATS:[];
    return available.find(name=>entry.aliases?.some(a=>a.toLowerCase()===name.toLowerCase()));
  }
  function addQuestionFor(entry){
    window.appShell?.open('questions',{focus:false});const old=new Set(questions);
    if(entry.type==='angle')addAngleQuestion();else if(['radar','thermo'].includes(entry.type))addQuestion(entry.type);else if(entry.type==='matching')addMatchingQuestion();else if(entry.type==='measuring')addMeasuringQuestion();
    const q=questions.find(q=>!old.has(q));if(!q)return;
    if(entry.meters)applyPreset(q,entry.id);
    const subcat=mapSubcategory(entry);if(subcat){if(entry.type==='matching')setMatchingSubcat(q.id,subcat);else setMeasuringSubcat(q.id,subcat);}
    window.lampskeneQuestions?.edit(q.id);schedule();
  }
  const panel=node('section');panel.id='question-checklist';panel.inert=true;panel.setAttribute('aria-hidden','true');
  panel.innerHTML='<header class="shell-panel-header"><div class="shell-panel-heading"><div class="shell-panel-title">Question tracker</div><div class="shell-panel-subtitle" id="usage-total"></div></div><button type="button" class="shell-close-button" data-shell-close aria-label="Close question tracker">×</button></header><div class="usage-tabs" role="group" aria-label="Question categories"></div><div class="usage-filter"><input type="search" id="usage-search" placeholder="Find a question…" aria-label="Find a question"><button type="button" id="usage-played-filter" aria-pressed="false">Played</button></div><div class="usage-list" id="usage-list"></div><details class="usage-help"><summary>How tracking works</summary><p>Lock a question to mark it played. Unlocking or deleting its card keeps its history. Use the checkbox to correct a mistake; + logs another use, including a veto.</p><p>Repeat costs are ×2, ×3 and so on. Repeat each normal draw/keep separately. Angle options share a counter for their travel distance. EG means endgame only.</p><p>Sizes and costs: v2 rulebook, pages 8–14. Typed values use the cheaper of their matching size and Custom; ties use the preset.</p></details>';
  document.body.append(panel);
  const tabs=panel.querySelector('.usage-tabs');for(const type of rules.types){const b=button(names[type],()=>{category=type;lastList='';renderList();});b.dataset.category=type;tabs.append(b);}
  panel.querySelector('#usage-search').addEventListener('input',event=>{filter=event.target.value;renderList();});
  panel.querySelector('#usage-played-filter').addEventListener('click',()=>{playedOnly=!playedOnly;renderList();});
  function renderList(){
    const state=usage.getState();text(panel.querySelector('#usage-total'),usage.count+' played this round');
    tabs.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.category===category)));
    panel.querySelector('#usage-played-filter').setAttribute('aria-pressed',String(playedOnly));
    const entries=rules.catalogue.filter(e=>e.type===category&&(!filter||e.label.toLowerCase().includes(filter.toLowerCase()))&&(!playedOnly||rules.count(state,e.id)>0));
    const signature=JSON.stringify([category,filter,playedOnly,state,typeof mode==='undefined'?null:mode]);if(lastList===signature)return;lastList=signature;
    const list=panel.querySelector('#usage-list');list.replaceChildren();
    for(const entry of entries){
      const cost=rules.cost(state,entry.id),row=node('div','usage-row'),checkbox=node('input');checkbox.type='checkbox';checkbox.checked=cost.used>0;checkbox.setAttribute('aria-label',entry.label+' played');checkbox.addEventListener('change',()=>usage.setPlayed(entry.id,checkbox.checked));
      const details=node('details','usage-entry'),summary=node('summary'),label=node('strong','',entry.label+(entry.endgame?' · EG':'')),meta=node('span','usage-row-meta',cost.used?cost.used+' used · '+costLabel(entry.id):entry.draw+' draw / '+entry.keep+' keep · '+entry.minutes+' min');summary.append(label,meta);details.append(summary);
      const note=node('div','usage-entry-content');
      if(entry.modes)for(const [mode,angles]of Object.entries(entry.modes))note.append(node('p','',({default:'Single',bidirectional:'Double',triple:'Triple',excludeRadius:'Exclude '+rules.distance(entry.exclude)})[mode]+': '+angles.join('°, ')+'°'));
      if(entry.note)note.append(node('p','',entry.note));
      note.append(node('p','',cost.multiplier+' × (draw '+entry.draw+', keep '+entry.keep+') · '+entry.minutes+' min'));
      const actions=node('div','usage-entry-actions');if(typeof mode!=='undefined'&&mode==='seeker'&&(entry.meters||mapSubcategory(entry)))actions.append(button('Add question',()=>addQuestionFor(entry)));
      if(cost.used)actions.append(button('Undo last use',()=>usage.undo(entry.id)));if(actions.children.length)note.append(actions);details.append(note);
      const again=button('+',()=>usage.add(entry.id),'usage-again');again.setAttribute('aria-label','Log another '+entry.label+' use');again.title='Log another use';const checkWrap=node('label','usage-check');checkWrap.append(checkbox);row.append(checkWrap,details,again);list.append(row);
    }
    if(!entries.length)list.append(node('p','usage-empty','No questions match.'));
  }
  function sync(){
    if(painting)return;painting=true;
    try{
      for(const q of typeof questions!=='undefined'?questions:[]){const card=cardFor(q);if(card)updateCard(q,card);}
      if(!panel.inert)renderList();
      const picker=document.getElementById('type-picker');if(picker)for(const option of picker.querySelectorAll('.type-option')){
        const handler=option.getAttribute('onclick')||'',type=handler.includes('addAngle')?'angle':handler.includes('addMatching')?'matching':handler.includes('addMeasuring')?'measuring':handler.includes("'radar'")?'radar':handler.includes("'thermo'")?'thermo':null;
        if(!type)continue;let preview=option.querySelector('.usage-add-preview');if(!preview){preview=node('small','usage-add-preview');option.append(preview);}const entries=rules.catalogue.filter(e=>e.type===type),used=entries.filter(e=>usage.cost(e.id)?.used).length;text(preview,used+' / '+entries.length+' played · 3 draw / 1 keep');
      }
      const inspector=document.querySelector('.qe-map-inspector');if(inspector&&!inspector.hidden){const q=questions.find(q=>String(q.id)===String(window.lampskeneQuestions?.previewId));if(q){let line=inspector.querySelector('.usage-inspector-cost');if(!line){line=node('small','usage-inspector-cost');inspector.append(line);}text(line,costText(q));}}
    }finally{painting=false;}
  }
  for(const name of ['onRadiusChange','setUnit','setAngleQuestionAngle','setAngleExcludeRadius']){
    const original=window[name];if(typeof original==='function')window[name]=function(id,...args){const q=questions.find(q=>String(q.id)===String(id));if(q&&!q.locked&&!applying){q.questionUsageKey=null;q.questionPreset='auto';}return original.call(this,id,...args);};
  }
  for(const name of ['setMatchingSubcat','setMeasuringSubcat']){const original=window[name];if(typeof original==='function')window[name]=function(id,...args){const q=questions.find(q=>String(q.id)===String(id));if(q&&!q.locked)q.questionUsageKey=null;return original.call(this,id,...args);};}
  const setMode=window.setAngleQuestionMode;if(typeof setMode==='function')window.setAngleQuestionMode=function(id,mode){const q=questions.find(q=>String(q.id)===String(id)),preset=q&&defFor(q);if(q&&!q.locked&&preset){if(!preset.modes?.[mode]){q.questionUsageKey=null;q.questionPreset='auto';}else if(!preset.modes[mode].includes(Number(q.angle)))q.angle=preset.modes[mode].includes(45)?45:preset.modes[mode][0];}return setMode.call(this,id,mode);};
  document.addEventListener('jetlag:questionusage',schedule);document.addEventListener('jetlag:rolechange',schedule);document.addEventListener('jetlag:panelchange',event=>{if(event.detail.panel==='checklist'){lastList='';renderList();}});
  window.lampskeneQuestionUsageUI={sync,schedule,applyPreset,open:()=>window.appShell?.open('checklist')};
})();
