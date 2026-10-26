/* Preset facts from Jetlag v2, pp. 8–14. Repeat costs are linear draw/keep rounds. */
(function(root){
  'use strict';
  const distance=m=>m>=1000?(m/1000)+' km':m+' m';
  const entry=(type,id,label,extra={})=>({id:type+'/'+id,type,label,draw:type==='photo'?2:['extras','endgame'].includes(type)?4:3,keep:['extras','endgame'].includes(type)?2:1,minutes:type==='photo'?12:type==='extras'?5:3,...extra});
  const radar=[250,500,1000,2000,5000,10000,15000,20000,25000].map(m=>entry('radar',m,distance(m),{meters:m}));
  const thermo=[2000,5000,250].map(m=>entry('thermo',m,distance(m),{meters:m,endgame:m===250}));
  const angles=[10,20,45,65,90,120],angle=[
    entry('angle',3000,'3 km',{meters:3000,modes:{default:angles,bidirectional:angles.slice(0,5),triple:angles.slice(0,4)}}),
    entry('angle',2000,'2 km',{meters:2000,modes:{bidirectional:angles.slice(0,5),triple:angles.slice(0,4)}}),
    ...[[1000,5000],[500,10000],[200,15000]].map(([meters,exclude])=>entry('angle',meters,distance(meters),{meters,exclude,modes:{excludeRadius:angles}}))
  ];
  const places=[['airport','Airport',['Airport','Airports']],['park','Park',['Park','Parks']],['amusement','Amusement park',['Amusement Park','Amusement Parks']],['zoo','Zoo',['Zoo','Zoos']],['golf','Golf course',['Golf Course','Golf Courses']],['museum','Museum',['Museum','Museums']],['theater','Theater',['Theater','Theatre','Theatres']],['hospital','Hospital',['Hospital','Hospitals']],['library','Library',['Library','Libraries']],['church','Church',['Church','Churches']],['ikea','IKEA',['IKEA']],['coop','Coop',['Coop']]];
  const matching=[places[0],['line','Transit line',['SL Line','Transit Line']],['street','Street or path',[]],['name-length','Station name length',[]],['commune','Commune',['Commune','Kommun','Municipality','Municipalities']],['district','City district',['City District','District','Districts','Stadsdel','Stadsdelar']],...places.slice(1)].map(([id,label,aliases])=>entry('matching',id,label,{aliases}));
  const measuring=[places[0],['rail','Rail station',['Rail Station']],['sl-station','SL station',['SL Station']],['sea-level','Sea level',[]],['water','Body of water',[]],['coast','Coastline',[]],...places.slice(1)].map(([id,label,aliases])=>entry('measuring',id,label,{aliases}));
  const photo=[['tree','A tree','Include the whole tree, root to tip.'],['sky','The sky','Phone flat on the ground, pointing up; default lens, no zoom.'],['self','Yourself','Selfie at arm’s length; stay still after receiving the question.'],['widest-street','Widest street','Include both sides of the street.'],['tallest','Tallest structure in sightline','Include top and both sides; top in the upper third.'],['station-building','Building visible from station','Stand outside an entrance; include roof and both sides.'],['busiest-street','Busiest street','Include at least a 2 × 3 m area of the footpath.'],['restaurant','Restaurant front','Show at least 5 m of frontage; text and logos may be hidden.'],['sun','The sun','3× zoom; centre the sun, or estimate its position when obscured.'],['water','Largest body of water','Include the coast and about 5 m of water; no swimming pools.']].map(([id,label,note])=>entry('photo',id,label,{note,manual:true}));
  const extras=[entry('extras','trace','Trace nearest path / road',{endgame:true,manual:true,minutes:6,note:'North-up tracing of at least 15 m; your hiding spot must be on that path.'}),entry('extras','building','Measuring building',{endgame:true,manual:true,note:'Closer or further from a qualifying building than the seekers?'})];
  const mapExtras=[entry('matching','extra-trainstation','Train station',{aliases:['Train Station'],note:'Additional map category.'}),entry('matching','extra-tramstop','Tram stop',{aliases:['Tram Stop'],note:'Additional map category.'}),entry('measuring','extra-aquarium','Aquarium',{aliases:['Aquarium'],note:'Additional map category.'})];
  const catalogue=[...radar,entry('radar','custom','Custom'),...thermo,entry('thermo','custom','Custom'),...angle,entry('angle','custom','Custom'),...matching,...measuring,...mapExtras,...photo,...extras,entry('endgame','check','Endgame question',{manual:true,note:'Are we within 300 m of your station?'})];
  const normalize=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const byId=id=>catalogue.find(e=>e.id===id)||null;
  function sizeFor(q){
    if(q.questionPreset==='custom')return null;
    const chosen=byId(q.questionPreset);if(chosen?.meters&&chosen.type===q.type)return chosen;
    if(q.type==='radar'){const m=Number(q.radius)*(q.unit==='KM'?1000:1);return radar.find(e=>Math.abs(e.meters-m)<.01)||null;}
    if(q.type==='thermo')return thermo.find(e=>Number(q.questionDistance)===e.meters)||null;
    if(q.type==='angle')return angle.find(e=>Number(q.questionDistance)===e.meters&&e.modes[q.mode]?.includes(Number(q.angle))&&(!e.exclude||Number(q.excludeRadius)===e.exclude))||null;
    return null;
  }
  function keyFor(q,state={events:[]}){
    if(!q)return null;
    if(q.questionUsageKey&&definition(q.questionUsageKey)?.type===q.type)return q.questionUsageKey;
    if(['radar','thermo','angle'].includes(q.type)){
      const custom=q.type+'/custom';if(q.questionPreset==='custom')return custom;
      const chosen=byId(q.questionPreset);if(chosen?.type===q.type&&chosen.meters)return chosen.id;
      const preset=sizeFor(q);if(!preset)return custom;
      // A manually entered matching value uses whichever category costs less.
      return count(state,custom)<count(state,preset.id)?custom:preset.id;
    }
    if(['matching','measuring'].includes(q.type))return catalogue.find(e=>e.type===q.type&&e.aliases?.some(a=>normalize(a)===normalize(q.subcat)))?.id||q.type+'/extra-'+normalize(q.subcat);
    return null;
  }
  function definition(key){return byId(key)||(['matching/extra-','measuring/extra-'].some(p=>key?.startsWith(p))?entry(key.split('/')[0],key.split('/')[1],key.split('/extra-')[1]):null);}
  function cleanState(state){
    const events=[],seen=new Set();
    for(const e of Array.isArray(state?.events)?state.events:[]){if(!e||typeof e.id!=='string'||e.id.length>180||typeof e.key!=='string'||!definition(e.key)||seen.has(e.id))continue;seen.add(e.id);events.push({id:e.id,key:e.key,at:Number(e.at)||0,voided:!!e.voided,source:e.source==='question'?'question':'manual'});}
    return {version:1,events:events.slice(-3000)};
  }
  const count=(state,key)=>state.events.filter(e=>e.key===key&&!e.voided).length;
  function cost(state,key){const def=definition(key);if(!def)return null;const used=count(state,key);return {used,multiplier:used+1,draw:def.draw,keep:def.keep,minutes:def.minutes};}
  const api={catalogue,byId,definition,keyFor,sizeFor,cleanState,count,cost,distance,angles,types:['radar','thermo','angle','matching','measuring','photo','extras','endgame']};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.lampskeneQuestionRules=api;
})(typeof window!=='undefined'?window:globalThis);
