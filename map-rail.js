/* The bundled, coloured SL rail network: metro, commuter rail, local trains and trams. */
(() => {
  'use strict';
  function data(){
    if(typeof _transitLayerOn==='undefined'||!_transitLayerOn)return {type:'FeatureCollection',features:[]};
    return {type:'FeatureCollection',features:getSLTransitLines().flatMap(line=>(line.segments||[]).filter(s=>s.length>1).map(coords=>({type:'Feature',geometry:{type:'LineString',coordinates:coords},properties:{name:line.name,color:line.colour||'#3895ba'}})))};
  }
  const toggle=window.toggleTransitLayer;
  window.toggleTransitLayer=function(){const result=toggle.apply(this,arguments);document.dispatchEvent(new CustomEvent('jetlag:railchange'));return result;};
  const button=document.getElementById('transit-layer-btn');if(button){const label=button.querySelector('span');if(label)label.textContent='SL rail network';button.title='Coloured metro, train and tram routes · no buses';}
  window.lampskeneRail={data,toggle:()=>window.toggleTransitLayer(),get enabled(){return typeof _transitLayerOn!=='undefined'&&_transitLayerOn;}};
})();
